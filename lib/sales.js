'use strict';
// Ventas: agenda del día, citas con clientes nuevos y seguimiento de estimados entregados.
//  - Lo usan los vendedores (papel "sales") y cualquier dueño o PM con la herramienta "ventas" prendida.
//  - El vendedor solo ve SUS clientes y el monto de SUS estimados. Nunca costos, gastos, ganancias ni pagos.
//  - Las horas de las citas se guardan en hora local del negocio (America/Chicago): "YYYY-MM-DD HH:MM".
const { notify, owners } = require('./push');
const { tzDate } = require('./pmreport');

const TZ = () => process.env.APP_TZ || 'America/Chicago';
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const nowLocal = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const minutesBetween = (a, b) => Math.round((Date.parse(b.replace(' ', 'T') + ':00Z') - Date.parse(a.replace(' ', 'T') + ':00Z')) / 60000);

const KINDS = ['cita', 'visita', 'llamada', 'seguimiento', 'otro'];
const EVENTS = ['llamada', 'mensaje', 'visita', 'nota', 'enviado', 'ganado', 'perdido'];
const LOST = ['precio', 'tiempo', 'otra_compania', 'no_contesta', 'pospuesto', 'otro'];

const tools = u => String((u && u.tools) || '').split(',').filter(Boolean);
const canSell = u => !!u && (u.role === 'owner' || u.role === 'sales' || (u.role === 'pm' && tools(u).includes('ventas')));
const SALES_KEYS = ['GET /api/sales/day', 'GET /api/sales/pipeline', 'GET /api/sales/leads/:id', 'POST /api/sales/leads', 'PUT /api/sales/leads/:id',
  'POST /api/sales/leads/:id/event', 'GET /api/appointments', 'POST /api/appointments', 'PUT /api/appointments/:id', 'DELETE /api/appointments/:id', 'GET /api/sales/team'];
// Lo único que puede abrir un vendedor (además de sus rutas de ventas).
const INSP_KEYS = ['GET /api/plan', 'POST /api/plan/items', 'PUT /api/plan/items/:id', 'DELETE /api/plan/items/:id', 'GET /api/inspection-types', 'POST /api/inspection-types', 'PUT /api/inspection-types/:id', 'DELETE /api/inspection-types/:id'];
const SALES_ALLOW = new Set([...SALES_KEYS, ...INSP_KEYS, 'GET /api/digest', 'PUT /api/digest/settings', 'GET /api/agent/manual', 'GET /api/status', 'POST /api/logout', 'POST /api/me/lang', 'POST /api/me/password', 'POST /api/me/mfa/start',
  'POST /api/me/mfa/confirm', 'POST /api/me/mfa/disable', 'GET /api/push/latest', 'GET /api/push/key', 'POST /api/push/subscribe', 'POST /api/push/unsubscribe',
  'POST /api/push/test', 'GET /api/notifications', 'GET /api/catalog', 'GET /api/materials', 'GET /api/materials/:id', 'GET /api/materials/:id/image']);

function enter(db, key, ctx, fail) {
  const u = ctx.user;
  if (u && u.role === 'sales' && !SALES_ALLOW.has(key)) fail(403, 'Esto no es parte de sus herramientas');
  return ctx;
}

module.exports = function salesRoutes(db, add, h) {
  const { requireRole, fail, str, need, intId, date, cents, oneOf } = h;
  const need2 = u => { if (!canSell(u)) fail(403, 'Esto no es parte de sus herramientas'); };
  const today = () => tzDate(TZ());
  const isOwner = u => u.role === 'owner';
  // Qué clientes ve: el vendedor y el PM, solo los suyos. El dueño: los suyos y los que no tienen vendedor ("me"), o todos ("all").
  const scope = (u, who) => {
    if (!isOwner(u)) return { sql: 'j.sales_id=?', args: [u.id] };
    if (who === 'all') return { sql: '1=1', args: [] };
    if (who && /^\d+$/.test(String(who))) return { sql: 'j.sales_id=?', args: [Number(who)] };
    return { sql: '(j.sales_id=? OR j.sales_id IS NULL)', args: [u.id] };
  };
  const apptScope = (u, who) => {
    if (!isOwner(u)) return { sql: 'a.user_id=?', args: [u.id] };
    if (who === 'all') return { sql: '1=1', args: [] };
    if (who && /^\d+$/.test(String(who))) return { sql: 'a.user_id=?', args: [Number(who)] };
    return { sql: 'a.user_id=?', args: [u.id] };
  };
  const userName = id => id ? ((db.prepare('SELECT name FROM users WHERE id=?').get(id) || {}).name || '') : '';
  const leadOr404 = (u, id) => {
    const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(intId(id));
    if (!j) fail(404, 'No encontrado');
    if (!isOwner(u) && j.sales_id !== u.id) fail(404, 'No encontrado');
    return j;
  };
  const nextAppt = jobId => db.prepare("SELECT id, starts_at, kind, title FROM appointments WHERE job_id=? AND status='pendiente' AND starts_at>=? ORDER BY starts_at LIMIT 1").get(jobId, today() + ' 00:00') || null;
  const lastEvent = jobId => db.prepare('SELECT kind, note, at FROM sales_events WHERE job_id=? ORDER BY id DESC LIMIT 1').get(jobId) || null;
  // Lo que ve el vendedor de un cliente: datos de contacto y el monto del estimado. Nada de costos.
  const card = j => {
    const t = today();
    return { id: j.id, client_name: j.client_name, client_phone: j.client_phone, client_email: j.client_email, address: j.address, project_type: j.project_type,
      description: j.description, status: j.status, quoted_cents: j.quoted_cents, lead_source: j.lead_source, lead_new: !!j.lead_new,
      estimate_sent_date: j.estimate_sent_date || '', follow_up_date: j.follow_up_date || '', won_date: j.won_date || '', lost_reason: j.lost_reason || '',
      days_since_sent: j.estimate_sent_date ? Math.round((Date.parse(t) - Date.parse(j.estimate_sent_date)) / 864e5) : null,
      overdue: !!(j.follow_up_date && j.follow_up_date < t && ['prospecto', 'cotizado'].includes(j.status)),
      sales_id: j.sales_id || null, sales_name: userName(j.sales_id), created_at: j.created_at, next_appt: nextAppt(j.id), last_event: lastEvent(j.id) };
  };
  const stage = (c) => {
    if (c.status === 'cotizado') return 'estimado';
    if (c.status === 'prospecto') return c.next_appt ? 'cita' : 'nuevo';
    if (c.status === 'cancelado') return c.lost_reason ? 'perdido' : null;
    if (['activo', 'terminado'].includes(c.status)) return c.won_date ? 'ganado' : null;
    return null;
  };
  const stats = (u, who) => {
    const s = scope(u, who), month = today().slice(0, 7);
    const q = (extra, ...a) => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(quoted_cents),0) v FROM jobs j WHERE ${s.sql} AND ${extra}`).get(...s.args, ...a);
    const open = q("j.status='cotizado'");
    const won = q("j.won_date LIKE ?", month + '%');
    const lost = q("j.status='cancelado' AND j.lost_reason<>'' AND substr(j.created_at,1,7)<=?", month);
    const sent90 = q("j.estimate_sent_date>=?", addDays(today(), -90));
    const won90 = q("j.won_date>=? AND j.estimate_sent_date<>''", addDays(today(), -90));
    return { open_n: open.n, open_cents: open.v, won_month_n: won.n, won_month_cents: won.v,
      close_pct_90: sent90.n ? Math.round(won90.n * 100 / sent90.n) : null, lost_total: lost.n };
  };

  add('GET', '/api/sales/team', ({ user }) => {
    requireRole(user, 'owner');
    return db.prepare("SELECT id, name, role FROM users WHERE active=1 AND (role IN ('owner','sales') OR (role='pm' AND (','||tools||',') LIKE '%,ventas,%')) ORDER BY role, name").all();
  });

  // Mi día: citas de hoy, seguimientos que tocan (o ya se pasaron), leads nuevos y números del mes.
  add('GET', '/api/sales/day', ({ user, query }) => {
    need2(user);
    const d = query.get('date') ? date(query.get('date'), 'fecha') : today();
    const a = apptScope(user, query.get('who')), s = scope(user, query.get('who'));
    const appts = db.prepare(`SELECT a.*, j.client_name FROM appointments a LEFT JOIN jobs j ON j.id=a.job_id WHERE ${a.sql} AND substr(a.starts_at,1,10)=? ORDER BY a.starts_at`).all(...a.args, d)
      .map(x => ({ ...x, user_name: userName(x.user_id) }));
    const due = db.prepare(`SELECT j.* FROM jobs j WHERE ${s.sql} AND j.status IN ('prospecto','cotizado') AND j.follow_up_date<>'' AND j.follow_up_date<=? ORDER BY j.follow_up_date, j.id`).all(...s.args, d).map(card);
    const fresh = db.prepare(`SELECT j.* FROM jobs j WHERE ${s.sql} AND j.status='prospecto' AND (j.lead_new=1 OR NOT EXISTS (SELECT 1 FROM sales_events e WHERE e.job_id=j.id)) ORDER BY j.id DESC LIMIT 30`).all(...s.args)
      .map(card).filter(c => !c.next_appt && !due.some(x => x.id === c.id));
    const week = db.prepare(`SELECT a.*, j.client_name FROM appointments a LEFT JOIN jobs j ON j.id=a.job_id WHERE ${a.sql} AND a.status='pendiente' AND substr(a.starts_at,1,10)>? AND substr(a.starts_at,1,10)<=? ORDER BY a.starts_at`).all(...a.args, d, addDays(d, 7));
    return { date: d, appointments: appts, due, new_leads: fresh, upcoming: week, stats: stats(user, query.get('who')) };
  });

  add('GET', '/api/sales/pipeline', ({ user, query }) => {
    need2(user);
    const s = scope(user, query.get('who')), since = addDays(today(), -90);
    const rows = db.prepare(`SELECT j.* FROM jobs j WHERE ${s.sql} AND (j.status IN ('prospecto','cotizado') OR j.won_date>=? OR (j.status='cancelado' AND j.lost_reason<>'' AND j.created_at>=?)) ORDER BY j.follow_up_date='' , j.follow_up_date, j.id DESC`).all(...s.args, since, since);
    const stages = { nuevo: [], cita: [], estimado: [], ganado: [], perdido: [] };
    for (const j of rows) { const c = card(j); const st = stage(c); if (st) stages[st].push(c); }
    const sum = k => stages[k].reduce((a, c) => a + (c.quoted_cents || 0), 0);
    return { stages, totals: Object.fromEntries(Object.keys(stages).map(k => [k, { n: stages[k].length, cents: sum(k) }])), stats: stats(user, query.get('who')) };
  });

  add('GET', '/api/sales/leads/:id', ({ user, params }) => {
    need2(user);
    const j = leadOr404(user, params.id);
    return { ...card(j), notes: isOwner(user) ? j.notes : undefined,
      events: db.prepare('SELECT e.*, u.name user_name FROM sales_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.job_id=? ORDER BY e.id DESC').all(j.id),
      appointments: db.prepare('SELECT * FROM appointments WHERE job_id=? ORDER BY starts_at DESC').all(j.id) };
  });

  const leadFields = (b, j) => {
    const f = {};
    const set = (k, v) => { if (k in b) f[k] = v(); };
    set('client_name', () => need(b.client_name, 'nombre del cliente', 120));
    set('client_phone', () => str(b.client_phone, 40)); set('client_email', () => str(b.client_email, 120)); set('address', () => str(b.address, 200));
    set('description', () => str(b.description, 4000)); set('lead_source', () => str(b.lead_source, 60));
    if ('project_type' in b) f.project_type = oneOf(b.project_type || 'otro', require('./catalog').PROJECT_TYPES.map(p => p.key), 'tipo de proyecto');
    if ('follow_up_date' in b) f.follow_up_date = b.follow_up_date ? date(b.follow_up_date, 'fecha de seguimiento') : '';
    void j; return f;
  };

  add('POST', '/api/sales/leads', ({ user, body }) => {
    need2(user);
    const f = { project_type: 'otro', ...leadFields({ client_name: body.client_name, ...body }) };
    let salesId = user.id;
    if (isOwner(user) && 'sales_id' in body) salesId = body.sales_id ? intId(body.sales_id) : null;
    if (salesId && !canSell(db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(salesId))) fail(400, 'Esa persona no tiene la herramienta de ventas');
    const cols = Object.keys(f);
    const id = Number(db.prepare(`INSERT INTO jobs(${cols.join(',')},status,sales_id,lead_new) VALUES(${cols.map(() => '?').join(',')},'prospecto',?,?)`).run(...cols.map(k => f[k]), salesId, body.appointment && body.appointment.starts_at ? 0 : 1).lastInsertRowid);
    db.prepare("INSERT INTO sales_events(job_id,user_id,kind,note) VALUES(?,?,'nota',?)").run(id, user.id, str(body.note, 1000) || 'Cliente nuevo registrado');
    if (body.appointment && body.appointment.starts_at) createAppt(user, { ...body.appointment, job_id: id, title: body.appointment.title || `Cita · ${f.client_name}`, address: body.appointment.address ?? f.address, phone: body.appointment.phone ?? f.client_phone });
    if (salesId && salesId !== user.id) notify(db, salesId, 'lead_assigned', { x: f.client_name }, '#/ventas');
    return card(db.prepare('SELECT * FROM jobs WHERE id=?').get(id));
  });

  add('PUT', '/api/sales/leads/:id', ({ user, body, params }) => {
    need2(user);
    const j = leadOr404(user, params.id);
    if (!isOwner(user) && !['prospecto', 'cotizado'].includes(j.status)) fail(400, 'Este cliente ya no está en ventas');
    const f = leadFields(body, j);
    if ('sales_id' in body) {
      if (!isOwner(user)) fail(403, 'Solo los dueños asignan vendedor');
      const sid = body.sales_id ? intId(body.sales_id) : null;
      if (sid && !canSell(db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(sid))) fail(400, 'Esa persona no tiene la herramienta de ventas');
      f.sales_id = sid;
      if (sid && sid !== j.sales_id && sid !== user.id) notify(db, sid, 'lead_assigned', { x: j.client_name }, '#/ventas');
    }
    const cols = Object.keys(f);
    if (cols.length) db.prepare(`UPDATE jobs SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`).run(...cols.map(k => f[k]), j.id);
    return card(db.prepare('SELECT * FROM jobs WHERE id=?').get(j.id));
  });

  // Seguimiento: llamada, mensaje, visita, nota, estimado enviado, ganado o perdido.
  add('POST', '/api/sales/leads/:id/event', ({ user, body, params }) => {
    need2(user);
    const j = leadOr404(user, params.id);
    const kind = oneOf(body.kind, EVENTS, 'tipo de seguimiento');
    if (!['prospecto', 'cotizado'].includes(j.status)) fail(400, 'Este cliente ya no está en ventas');
    const note = str(body.note, 1000), t = today();
    const next = body.next_date ? date(body.next_date, 'próximo seguimiento') : '';
    if (next && next < t) fail(400, 'El próximo seguimiento no puede ser en el pasado');
    let amount = null;
    if (kind === 'enviado') {
      amount = body.amount_cents != null && body.amount_cents !== '' ? cents(body.amount_cents, 'monto del estimado') : j.quoted_cents;
      if (!amount) fail(400, 'Escriba el monto del estimado');
      db.prepare("UPDATE jobs SET status='cotizado', quoted_cents=?, estimate_sent_date=?, follow_up_date=?, lead_new=0 WHERE id=?").run(amount, t, next || addDays(t, 3), j.id);
    } else if (kind === 'ganado') {
      db.prepare("UPDATE jobs SET status='activo', won_date=?, follow_up_date='', lead_new=0 WHERE id=?").run(t, j.id);
      notify(db, owners(db).filter(id => id !== user.id), 'sale_won', { x: j.client_name, who: user.name }, `#/obra/${j.id}`);
    } else if (kind === 'perdido') {
      const reason = oneOf(body.reason, LOST, 'motivo');
      db.prepare("UPDATE jobs SET status='cancelado', lost_reason=?, follow_up_date='', lead_new=0 WHERE id=?").run(reason, j.id);
    } else {
      db.prepare('UPDATE jobs SET follow_up_date=?, lead_new=0 WHERE id=?').run(next || j.follow_up_date || '', j.id);
    }
    db.prepare('INSERT INTO sales_events(job_id,user_id,kind,note,amount_cents,next_date) VALUES(?,?,?,?,?,?)')
      .run(j.id, user.id, kind, kind === 'perdido' ? [body.reason, note].filter(Boolean).join(' · ') : note, amount, next);
    return card(db.prepare('SELECT * FROM jobs WHERE id=?').get(j.id));
  });

  // ===== agenda =====
  const startsAt = v => {
    const s = String(v || '').trim().replace('T', ' ').slice(0, 16);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s) || Number.isNaN(Date.parse(s.replace(' ', 'T') + ':00Z'))) fail(400, 'Fecha y hora inválidas');
    return s;
  };
  function createAppt(user, b) {
    let owner = user.id;
    if (b.user_id && Number(b.user_id) !== user.id) {
      if (!isOwner(user)) fail(403, 'Solo puede agendar en su propia agenda');
      const u = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(intId(b.user_id));
      if (!canSell(u)) fail(400, 'Esa persona no tiene la herramienta de ventas');
      owner = u.id;
    }
    let jobId = null;
    if (b.job_id) jobId = leadOr404(user, b.job_id).id;
    const kind = oneOf(b.kind || 'cita', KINDS, 'tipo de cita');
    const id = Number(db.prepare('INSERT INTO appointments(user_id,job_id,kind,title,starts_at,minutes,address,phone,notes) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(owner, jobId, kind, need(b.title, 'título', 160), startsAt(b.starts_at), Math.min(Math.max(Number(b.minutes) || 60, 15), 600),
        str(b.address, 200), str(b.phone, 40), str(b.notes, 1000)).lastInsertRowid);
    if (owner !== user.id) notify(db, owner, 'appt_new', { x: b.title, d: startsAt(b.starts_at) }, '#/ventas');
    return db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  }
  const apptOr404 = (user, id) => {
    const a = db.prepare('SELECT * FROM appointments WHERE id=?').get(intId(id));
    if (!a || (!isOwner(user) && a.user_id !== user.id)) fail(404, 'No encontrado');
    return a;
  };

  add('GET', '/api/appointments', ({ user, query }) => {
    need2(user);
    const from = query.get('from') ? date(query.get('from'), 'desde') : today(), to = query.get('to') ? date(query.get('to'), 'hasta') : addDays(from, 30);
    const a = apptScope(user, query.get('who'));
    return db.prepare(`SELECT a.*, j.client_name FROM appointments a LEFT JOIN jobs j ON j.id=a.job_id WHERE ${a.sql} AND substr(a.starts_at,1,10)>=? AND substr(a.starts_at,1,10)<=? ORDER BY a.starts_at`).all(...a.args, from, to)
      .map(x => ({ ...x, user_name: userName(x.user_id) }));
  });
  add('POST', '/api/appointments', ({ user, body }) => { need2(user); return createAppt(user, body); });
  add('PUT', '/api/appointments/:id', ({ user, params, body }) => {
    need2(user);
    const a = apptOr404(user, params.id);
    const f = {};
    if ('title' in body) f.title = need(body.title, 'título', 160);
    if ('starts_at' in body) { f.starts_at = startsAt(body.starts_at); if (f.starts_at !== a.starts_at) f.reminded_at = ''; }
    if ('minutes' in body) f.minutes = Math.min(Math.max(Number(body.minutes) || 60, 15), 600);
    if ('kind' in body) f.kind = oneOf(body.kind, KINDS, 'tipo de cita');
    for (const k of ['address', 'phone']) if (k in body) f[k] = str(body[k], 200);
    if ('notes' in body) f.notes = str(body.notes, 1000);
    if ('result' in body) f.result = str(body.result, 1000);
    if ('status' in body) f.status = oneOf(body.status, ['pendiente', 'hecho', 'cancelado', 'no_llego'], 'estado');
    const cols = Object.keys(f);
    if (cols.length) db.prepare(`UPDATE appointments SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`).run(...cols.map(k => f[k]), a.id);
    // Una cita hecha con un cliente queda en su historial.
    if (f.status === 'hecho' && a.job_id && a.status !== 'hecho')
      db.prepare("INSERT INTO sales_events(job_id,user_id,kind,note) VALUES(?,?,'visita',?)").run(a.job_id, user.id, f.result || a.title);
    return db.prepare('SELECT * FROM appointments WHERE id=?').get(a.id);
  });
  add('DELETE', '/api/appointments/:id', ({ user, params }) => {
    need2(user);
    const a = apptOr404(user, params.id);
    db.prepare('DELETE FROM appointments WHERE id=?').run(a.id);
    return { ok: true };
  });
};

// Para el contador de pendientes: seguimientos que tocan hoy o ya se pasaron, y leads nuevos sin atender.
module.exports.pendingFor = (db, u) => {
  if (!canSell(u) || u.role === 'owner' && !tools(u).includes('ventas')) return 0;
  const t = tzDate(TZ());
  const mine = u.role === 'owner' ? '(sales_id=? OR sales_id IS NULL)' : 'sales_id=?';
  return db.prepare(`SELECT COUNT(*) n FROM jobs WHERE ${mine} AND status IN ('prospecto','cotizado') AND ((follow_up_date<>'' AND follow_up_date<=?) OR lead_new=1)`).get(u.id, t).n;
};

// Recordatorios: aviso 1 hora antes de cada cita y, en la mañana, cuántas citas y llamadas tiene el día.
module.exports.tick = function tick(db) {
  try {
    const now = nowLocal(), day = now.slice(0, 10), hour = Number(now.slice(11, 13));
    const soon = db.prepare("SELECT a.*, j.client_name FROM appointments a LEFT JOIN jobs j ON j.id=a.job_id WHERE a.status='pendiente' AND a.reminded_at='' AND substr(a.starts_at,1,10)=?").all(day);
    for (const a of soon) {
      const m = minutesBetween(now, a.starts_at);
      if (m >= 0 && m <= 75) {
        db.prepare('UPDATE appointments SET reminded_at=? WHERE id=?').run(now, a.id);
        notify(db, a.user_id, 'appt_soon', { x: a.title, d: a.starts_at.slice(11), job: a.address || a.client_name || '' }, '#/ventas');
      }
    }
    if (hour >= 7 && hour < 10) {
      const users = db.prepare("SELECT * FROM users WHERE active=1 AND (role='sales' OR (','||tools||',') LIKE '%,ventas,%')").all();
      for (const u of users) {
        const k = 'sales_day_' + u.id;
        if ((db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value === day) continue;
        db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, day);
        const appts = db.prepare("SELECT COUNT(*) n FROM appointments WHERE user_id=? AND status='pendiente' AND substr(starts_at,1,10)=?").get(u.id, day).n;
        const calls = module.exports.pendingFor(db, u);
        if (appts || calls) notify(db, u.id, 'sales_day', { x: appts, n: calls }, '#/ventas');
      }
    }
  } catch (e) { console.error('[ventas]', e.message); }
};
module.exports.enter = enter;
module.exports.canSell = canSell;
module.exports.SALES_KEYS = SALES_KEYS;
module.exports.INSP_KEYS = INSP_KEYS;
module.exports.minutesBetween = minutesBetween;
