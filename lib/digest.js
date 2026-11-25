'use strict';
// Fase 8 — Resumen de la mañana (6:30 AM, se puede cambiar la hora).
//  - A cada persona le llega un aviso con SU día; al tocarlo abre "Resumen de hoy" con el detalle.
//  - Dueños: obras con trabajo hoy, inspecciones, lo que espera su aprobación, pagos a subs que tocan, cobros,
//    casos urgentes, papeles por vencer y tickets por asignar.
//  - PM: lo mismo de sus obras, sin dinero de la compañía. Vendedor: sus citas y seguimientos. Sub: sus tareas
//    de hoy y las inspecciones de sus obras (sin horas: son contratistas). Oficina: tickets y papeles.
//  - Los agentes (Eli) lo leen con GET /api/digest; también se les manda por webhook (fase 8, parte 2).
const TZ = () => process.env.APP_TZ || 'America/Chicago';
const todayL = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(now);
const minutesL = (now = new Date()) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map(x => [x.type, x.value])); return (+p.hour % 24) * 60 + +p.minute; };
const meta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const usd = c => (Number(c || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const timeOf = db => { const v = meta(db, 'digest_time') || '06:30'; return /^\d{2}:\d{2}$/.test(v) ? v : '06:30'; };
const tl = (db, s, lang) => { try { return require('./history').inLang(db, s, lang); } catch { return s; } };

// Obras que ve esta persona.
function jobsFor(db, u) {
  if (u.role === 'owner') return db.prepare("SELECT * FROM jobs WHERE status IN ('activo','terminado','cotizado')").all();
  if (u.role === 'pm') return db.prepare(u.pm_all ? "SELECT * FROM jobs WHERE status IN ('activo','terminado','cotizado')" : "SELECT * FROM jobs WHERE pm_id=? AND status IN ('activo','terminado','cotizado')").all(...(u.pm_all ? [] : [u.id]));
  if (u.role === 'worker') return db.prepare("SELECT * FROM jobs WHERE status='activo' AND id IN (SELECT job_id FROM tasks WHERE assignee_id=? UNION SELECT job_id FROM subs WHERE user_id=?)").all(u.id, u.id);
  return [];
}

function build(db, u, day = todayL()) {
  const S = [];
  const sec = (key, icon, es, en, items) => { if (items.length) S.push({ key, icon, title: { es, en }, items }); };
  const it = (es, en, link) => ({ es, en, link: link || '' });
  const jobs = jobsFor(db, u), ids = new Set(jobs.map(j => j.id));
  const active = jobs.filter(j => j.status === 'activo');
  const boss = u.role === 'owner' || u.role === 'pm';

  // 1) Trabajo de hoy
  if (boss || u.role === 'worker') {
    const items = [];
    for (const j of active) {
      const q = u.role === 'worker' ? ' AND assignee_id=?' : '';
      const ts = db.prepare(`SELECT title, assignee_id FROM tasks WHERE job_id=? AND status<>'hecho' AND (status='en_progreso' OR (planned_date<>'' AND planned_date<=? AND (CASE WHEN COALESCE(planned_end,'')<>'' THEN planned_end ELSE planned_date END)>=?))${q} ORDER BY position LIMIT 4`)
        .all(...[j.id, day, day, ...(u.role === 'worker' ? [u.id] : [])]);
      if (!ts.length) continue;
      const who = id => { const n = id && (db.prepare('SELECT name FROM users WHERE id=?').get(id) || {}).name; return n ? n.split(' ')[0] : ''; };
      const list = lang => ts.map(t => tl(db, t.title, lang) + (u.role !== 'worker' && who(t.assignee_id) ? ` (${who(t.assignee_id)})` : '')).join(', ');
      items.push(it(`${j.client_name}: ${list('es')}`, `${j.client_name}: ${list('en')}`, u.role === 'worker' ? `#/obra/${j.id}` : `#/obra/${j.id}/tareas`));
    }
    sec('work', '🏗️', 'Trabajo de hoy', "Today's work", items);
  }
  // 2) Inspecciones de hoy (y sin resultado)
  if (boss || u.role === 'worker') {
    const items = [];
    for (const p of db.prepare("SELECT p.*, j.client_name FROM permits p JOIN jobs j ON j.id=p.job_id WHERE p.kind='inspeccion' AND p.date=? ORDER BY p.id").all(day)) {
      if (!ids.has(p.job_id)) continue;
      items.push(it(`${tl(db, p.name, 'es')} · ${p.client_name}`, `${tl(db, p.name, 'en')} · ${p.client_name}`, boss ? `#/obra/${p.job_id}/permisos` : `#/obra/${p.job_id}`));
    }
    if (boss) for (const p of db.prepare("SELECT p.*, j.client_name FROM permits p JOIN jobs j ON j.id=p.job_id WHERE p.kind='inspeccion' AND p.date<>'' AND p.date<? AND p.result_at='' AND p.status NOT IN ('aprobado','rechazado') ORDER BY p.date").all(day)) {
      if (!ids.has(p.job_id)) continue;
      items.push(it(`¿Pasó? ${tl(db, p.name, 'es')} · ${p.client_name} (sin resultado)`, `Passed? ${tl(db, p.name, 'en')} · ${p.client_name} (no result)`, `#/obra/${p.job_id}/permisos`));
    }
    sec('insp', '🏛️', 'Inspecciones', 'Inspections', items);
  }
  // 3) Dueños: lo que espera su aprobación y el dinero que toca
  if (u.role === 'owner') {
    const pend = db.prepare("SELECT COUNT(*) n FROM change_requests WHERE status='pendiente'").get().n;
    const due = [];
    try {
      const SP = require('./subplan');
      for (const s of db.prepare("SELECT s.* FROM subs s JOIN jobs j ON j.id=s.job_id WHERE j.status IN ('activo','terminado') AND s.agreed_cents>0").all()) { const p = SP.plan(db, s); if (p.due_now_cents > 0) due.push({ s, p }); }
    } catch { /* */ }
    const bills = [];
    try {
      for (const j of active) { const b = require('./billing').billing(db, j.id); for (const m of b.milestones) if (['por_cobrar', 'vencido'].includes(m.status)) bills.push({ j, m }); }
    } catch { /* */ }
    const items = [];
    if (pend) items.push(it(`${pend} cambio(s) esperan su aprobación`, `${pend} change(s) waiting for your approval`, '#/'));
    for (const { s, p } of due.slice(0, 5)) items.push(it(`Pagar a ${s.name}: ${usd(p.due_now_cents)}`, `Pay ${s.name}: ${usd(p.due_now_cents)}`, `#/obra/${s.job_id}/subs`));
    for (const { j, m } of bills.slice(0, 5)) items.push(it(`${m.status === 'vencido' ? 'Cobro vencido' : 'Toca cobrar'}: ${j.client_name} · ${m.label} · ${usd(m.amount_cents)}`, `${m.status === 'vencido' ? 'Overdue' : 'Ready to bill'}: ${j.client_name} · ${m.label} · ${usd(m.amount_cents)}`, `#/obra/${j.id}/propuesta`));
    sec('money', '💵', 'Aprobaciones y dinero', 'Approvals and money', items);
  }
  // 4) Casos urgentes o sin contestar
  if (boss) {
    const items = db.prepare("SELECT i.*, j.client_name FROM issues i JOIN jobs j ON j.id=i.job_id WHERE i.status<>'resuelto' AND (i.urgent=1 OR i.created_at<datetime('now','-1 day')) ORDER BY i.urgent DESC, i.id DESC LIMIT 8").all()
      .filter(i => ids.has(i.job_id)).map(i => it(`${i.urgent ? '🚨 ' : ''}${tl(db, i.title, 'es')} · ${i.client_name}`, `${i.urgent ? '🚨 ' : ''}${tl(db, i.title, 'en')} · ${i.client_name}`, `#/obra/${i.job_id}/casos`));
    sec('cases', '💬', 'Casos abiertos', 'Open cases', items);
  }
  // 4b) Selecciones del cliente que se vencen o ya se atrasaron (v2.35)
  if (boss) {
    let items = [];
    try {
      items = require('./selections').due(db, day).filter(s => ids.has(s.job_id)).sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99)).slice(0, 8).map(s => {
        const es = s.changed ? `Cambió algo aprobado: ${s.es} · ${s.client_name}` : s.late ? `Atrasado: ${s.es} · ${s.client_name}${s.blocks ? ` (detiene: ${tl(db, s.task, 'es')})` : ''}` : `Falta escoger ${s.es} · ${s.client_name} (${s.days_left === 0 ? 'hoy' : `en ${s.days_left} día(s)`})`;
        const en = s.changed ? `Approved item changed: ${s.en} · ${s.client_name}` : s.late ? `Late: ${s.en} · ${s.client_name}${s.blocks ? ` (holds up: ${tl(db, s.task, 'en')})` : ''}` : `${s.en} to choose · ${s.client_name} (${s.days_left === 0 ? 'today' : `in ${s.days_left} day(s)`})`;
        return it(es, en, `#/obra/${s.job_id}/materiales`);
      });
    } catch (e) { console.error('[resumen selecciones]', e.message); }
    sec('selections', '🎨', 'Selecciones del cliente', 'Client selections', items);
  }
  // 5) Vendedores (y quien tenga Ventas): citas y seguimientos de hoy
  const sells = u.role === 'sales' || String(u.tools || '').split(',').includes('ventas');
  if (sells) {
    const items = db.prepare("SELECT * FROM appointments WHERE user_id=? AND substr(starts_at,1,10)=? AND status='pendiente' ORDER BY starts_at").all(u.id, day)
      .map(a => it(`${a.starts_at.slice(11, 16)} ${a.title}`, `${a.starts_at.slice(11, 16)} ${a.title}`, '#/ventas/agenda'));
    const fu = db.prepare("SELECT client_name, id FROM jobs WHERE sales_id=? AND status IN ('prospecto','cotizado') AND follow_up_date<>'' AND follow_up_date<=? ORDER BY follow_up_date LIMIT 6").all(u.id, day);
    fu.forEach(j => items.push(it(`Seguimiento: ${j.client_name}`, `Follow up: ${j.client_name}`, `#/ventas/cliente/${j.id}`)));
    sec('sales', '🤝', 'Citas y seguimientos', 'Appointments and follow-ups', items);
  }
  // 6) Oficina y dueños: tickets por asignar y papeles por vencer
  if (u.role === 'owner' || u.role === 'admin') {
    const items = [];
    const sc = db.prepare("SELECT COUNT(*) n FROM scans WHERE status='por_asignar'").get().n;
    if (sc) items.push(it(`${sc} ticket(s) por asignar a una obra`, `${sc} receipt(s) waiting for a job`, '#/gastos'));
    try {
      const D = require('./docs');
      for (const d of db.prepare("SELECT title, expires FROM company_docs WHERE expires<>''").all()) {
        const st = D.stateOf(d.expires, day);
        if (st === 'vencido') items.push(it(`Vencido: ${d.title} (${d.expires})`, `Expired: ${d.title} (${d.expires})`, '#/documentos'));
        else if (st === 'por_vencer') items.push(it(`Vence pronto: ${d.title} (${d.expires})`, `Expiring soon: ${d.title} (${d.expires})`, '#/documentos'));
      }
    } catch { /* */ }
    sec('office', '📁', 'Oficina', 'Office', items);
  }
  // 7) Su plan de hoy
  const plan = db.prepare("SELECT COUNT(*) n FROM plan_items WHERE user_id=? AND date=? AND status='pendiente'").get(u.id, day).n;
  if (plan) sec('plan', '📋', 'Su plan de hoy', 'Your plan for today', [it(`${plan} cosa(s) en su plan`, `${plan} item(s) in your plan`, '#/plan')]);

  const count = S.reduce((a, s) => a + s.items.length, 0);
  const short = lang => S.map(s => `${s.icon} ${s.items.length} ${s.title[lang].toLowerCase()}`).join(' · ');
  return { date: day, sections: S, count, short: { es: short('es'), en: short('en') } };
}

// Reloj: a la hora del resumen (6:30 AM por omisión), una vez al día, un aviso por persona con algo que ver.
function tick(db, now = new Date()) {
  const day = todayL(now), m = minutesL(now);
  const [hh, mm] = timeOf(db).split(':').map(Number);
  if (m < hh * 60 + mm || m > hh * 60 + mm + 180) return 0;   // si el servidor estuvo apagado, hasta 3 horas después
  if (meta(db, 'digest_' + day) === '1') return 0;
  if (new Date(day + 'T12:00:00Z').getUTCDay() === 0 && meta(db, 'digest_sunday') !== '1') { setMeta(db, 'digest_' + day, '1'); return 0; }
  setMeta(db, 'digest_' + day, '1');
  const { notify } = require('./push');
  let n = 0;
  for (const u of db.prepare("SELECT * FROM users WHERE active=1 AND role NOT IN ('client','accountant')").all()) {
    if (meta(db, 'digest_off_' + u.id) === '1') continue;
    const d = build(db, u, day);
    if (u.is_agent) { try { require('./hooks').emit(db, 'digest', { user_id: u.id, ...d }); } catch { /* */ } continue; }
    if (!d.count) continue;
    notify(db, u.id, 'digest', { x: d.short[u.lang === 'en' ? 'en' : 'es'] }, '#/resumen');
    n++;
  }
  return n;
}

function routes(db, add, h) {
  const { requireRole, fail, intId } = h;
  // Su resumen (o el de alguien de su equipo, para los dueños; los agentes leen el de quien quieran).
  add('GET', '/api/digest', ({ user, query }) => {
    if (!user) fail(401, 'Inicie sesión');
    let u = db.prepare('SELECT * FROM users WHERE id=?').get(user.officeId || user.pmId || user.id);
    if (query.get('user_id')) {
      requireRole(user, 'owner'); if (user.isPm || user.isOffice) fail(403, 'Esto solo lo pueden hacer los dueños');
      u = db.prepare('SELECT * FROM users WHERE id=?').get(intId(query.get('user_id'))) || fail(404, 'No encontrado');
    }
    if (u.role === 'client') fail(403, 'Esto no es parte de su puesto');
    return { ...build(db, u), time: timeOf(db), off: meta(db, 'digest_off_' + u.id) === '1', for: { id: u.id, name: u.name, role: u.role } };
  });
  // Prender o apagar su propio resumen; los dueños cambian la hora.
  add('PUT', '/api/digest/settings', ({ user, body }) => {
    if (!user) fail(401, 'Inicie sesión');
    const uid = user.officeId || user.pmId || user.id;
    if ('off' in body) setMeta(db, 'digest_off_' + uid, body.off ? '1' : '0');
    if ('time' in body) {
      if (!(user.role === 'owner' && !user.isPm && !user.isOffice && !user.is_agent)) fail(403, 'La hora la cambian los dueños');
      if (!/^\d{2}:\d{2}$/.test(String(body.time)) || +body.time.slice(0, 2) > 11) fail(400, 'Ponga una hora de la mañana, por ejemplo 06:30');
      setMeta(db, 'digest_time', body.time);
    }
    return { time: timeOf(db), off: meta(db, 'digest_off_' + uid) === '1' };
  });
}

module.exports = { build, tick, routes, timeOf };
