'use strict';
// Trabajadores por hora (no subs): tiempo extra, nómina semanal y cuánto se ha gastado por trabajador y por obra.
//  - Cada entrada de horas ya guarda su gasto de mano de obra en la obra (pro.js → laborExpense).
//  - Aquí se agrega el TIEMPO EXTRA: lo que pase de N horas en la semana (40 por defecto) se paga a 1.5×.
//    El extra (la mitad adicional) se guarda como gasto de mano de obra en las obras donde se trabajaron esas horas.
//  - Nómina: por semana, cuánto se le debe a cada trabajador; se marca como pagada (y esa semana queda cerrada).
//  - Solo dueños. Trabajadores y subs nunca ven el dinero de la empresa.
const TZ = process.env.APP_TZ || 'America/Chicago';
const getMeta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);

function settings(db) {
  const h = Number(getMeta(db, 'ot_hours')), m = Number(getMeta(db, 'ot_mult'));
  return { week_start: getMeta(db, 'pay_week_start') === 'dom' ? 'dom' : 'lun', ot_on: getMeta(db, 'ot_on') !== '0',
    ot_hours: Number.isFinite(h) && h > 0 ? h : 40, ot_mult: Number.isFinite(m) && m >= 1 ? m : 1.5 };
}
const localDate = utc => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(String(utc).replace(' ', 'T') + 'Z'));
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function weekOf(db, d) {
  const startDow = settings(db).week_start === 'dom' ? 0 : 1;
  const dow = new Date(d + 'T12:00:00Z').getUTCDay();
  return addDays(d, -((dow - startDow + 7) % 7));
}
const weekOfEntry = (db, e) => weekOf(db, localDate(e.in_at));

// Entradas cerradas de una persona en una semana, con su costo normal y su extra por tiempo extra.
function weekCalc(db, userId, week) {
  const s = settings(db), end = addDays(week, 6);
  const rows = db.prepare("SELECT * FROM time_entries WHERE user_id=? AND out_at<>'' ORDER BY in_at").all(userId)
    .filter(e => { const d = localDate(e.in_at); return d >= week && d <= end; });
  let cum = 0; const thr = s.ot_on ? s.ot_hours * 60 : Infinity;
  const out = rows.map(e => {
    const reg = Math.max(0, Math.min(e.minutes, thr - cum)), ot = e.minutes - reg; cum += e.minutes;
    const base = Math.round(e.minutes / 60 * e.rate_cents);
    const extra = ot ? Math.round(ot / 60 * e.rate_cents * (s.ot_mult - 1)) : 0;
    return { ...e, reg_minutes: reg, ot_minutes: ot, base_cents: base, ot_extra_cents: extra };
  });
  return { week, end, entries: out, settings: s };
}

// Vuelve a calcular el gasto de tiempo extra de esa persona en esa semana (se llama cada vez que cambian sus horas).
function syncOT(db, userId, week) {
  const old = db.prepare('SELECT expense_id FROM ot_expenses WHERE user_id=? AND week_start=?').all(userId, week);
  for (const o of old) if (o.expense_id) db.prepare('DELETE FROM expenses WHERE id=?').run(o.expense_id);
  db.prepare('DELETE FROM ot_expenses WHERE user_id=? AND week_start=?').run(userId, week);
  const c = weekCalc(db, userId, week);
  const byJob = new Map();
  for (const e of c.entries) if (e.ot_extra_cents) { const b = byJob.get(e.job_id) || { cents: 0, min: 0 }; b.cents += e.ot_extra_cents; b.min += e.ot_minutes; byJob.set(e.job_id, b); }
  const name = (db.prepare('SELECT name FROM users WHERE id=?').get(userId) || {}).name || '';
  for (const [jobId, b] of byJob) {
    const id = Number(db.prepare("INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,created_by) VALUES(?,?,'mano_obra',?,'',?,?,?)")
      .run(jobId, c.end, `Tiempo extra: ${name} (${(b.min / 60).toFixed(2)} h, semana del ${week})`, name, b.cents, userId).lastInsertRowid);
    db.prepare('INSERT INTO ot_expenses(user_id,week_start,job_id,expense_id) VALUES(?,?,?,?)').run(userId, week, jobId, id);
  }
}
const isPaid = (db, userId, week) => !!db.prepare('SELECT 1 FROM payroll WHERE user_id=? AND week_start=?').get(userId, week);

module.exports = function laborRoutes(db, add, h) {
  const { requireRole, fail, str, intId, oneOf } = h;
  const today = () => localDate(new Date().toISOString().replace('T', ' ').slice(0, 19));
  const owner = u => { requireRole(u, 'owner'); if (u.isPm || u.is_agent) fail(403, 'Esto solo lo pueden hacer los dueños'); };
  const dateQ = (v, def) => { const s = String(v || ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : def; };
  const jobName = id => (db.prepare('SELECT client_name FROM jobs WHERE id=?').get(id) || {}).client_name || '';

  add('GET', '/api/settings/labor', ({ user }) => { owner(user); return settings(db); });
  add('PUT', '/api/settings/labor', ({ user, body }) => {
    owner(user);
    if ('week_start' in body) setMeta(db, 'pay_week_start', oneOf(body.week_start, ['lun', 'dom'], 'inicio de semana'));
    if ('ot_on' in body) setMeta(db, 'ot_on', body.ot_on ? '1' : '0');
    if ('ot_hours' in body) { const v = Number(body.ot_hours); if (!(v >= 1 && v <= 80)) fail(400, 'Horas inválidas'); setMeta(db, 'ot_hours', String(v)); }
    if ('ot_mult' in body) { const v = Number(body.ot_mult); if (!(v >= 1 && v <= 3)) fail(400, 'Multiplicador inválido'); setMeta(db, 'ot_mult', String(v)); }
    // Recalcular el tiempo extra de las semanas que no se han pagado (últimos 6 meses).
    const since = addDays(today(), -186);
    const pairs = new Set(db.prepare("SELECT user_id, in_at FROM time_entries WHERE out_at<>'' AND in_at>=?").all(since).map(e => `${e.user_id}|${weekOfEntry(db, e)}`));
    for (const p of pairs) { const [u, w] = p.split('|'); if (!isPaid(db, Number(u), w)) syncOT(db, Number(u), w); }
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'editar', 'configuracion', 0,
      `Nómina: semana desde ${settings(db).week_start}, tiempo extra ${settings(db).ot_on ? `${settings(db).ot_mult}× después de ${settings(db).ot_hours} h` : 'apagado'}`);
    return settings(db);
  });

  // Trabajadores con su forma de pago (el pago por hora solo lo ven los dueños).
  add('GET', '/api/labor/workers', ({ user }) => {
    owner(user);
    return db.prepare("SELECT id, name, trade, phone, pay_type, rate_cents, active FROM users WHERE role='worker' AND is_agent=0 ORDER BY active DESC, name").all();
  });
  add('PUT', '/api/labor/workers/:id', ({ user, params, body }) => {
    owner(user);
    const w = db.prepare("SELECT id, name FROM users WHERE id=? AND role='worker'").get(intId(params.id)); if (!w) fail(404, 'No encontrado');
    const type = oneOf(body.pay_type, ['hora', 'sub'], 'forma de pago');
    const rate = type === 'hora' ? h.cents(body.rate_cents ?? 0, 'pago por hora') : 0;
    if (type === 'hora' && !rate) fail(400, 'Ponga el pago por hora');
    db.prepare('UPDATE users SET pay_type=?, rate_cents=? WHERE id=?').run(type, rate, w.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'editar', 'trabajador', w.id,
      type === 'hora' ? `${w.name}: por hora, $${(rate / 100).toFixed(2)}/h` : `${w.name}: como sub (precio por trabajo)`);
    return { ok: true };
  });

  // Nómina de una semana: cuánto se le debe a cada trabajador por hora.
  add('GET', '/api/payroll', ({ user, query }) => {
    owner(user);
    const week = weekOf(db, dateQ(query.get('week'), today()));
    const end = addDays(week, 6);
    const ids = new Set(db.prepare("SELECT id FROM users WHERE role='worker' AND active=1 AND (pay_type='hora' OR rate_cents>0)").all().map(r => r.id));
    for (const e of db.prepare('SELECT DISTINCT user_id, in_at FROM time_entries WHERE in_at BETWEEN ? AND ?').all(addDays(week, -1), addDays(end, 2) + ' 23:59:59')) {
      const d = localDate(e.in_at); if (d >= week && d <= end) ids.add(e.user_id);
    }
    const people = [...ids].map(id => {
      const u = db.prepare('SELECT id, name, trade, rate_cents, pay_type FROM users WHERE id=?').get(id); if (!u) return null;
      const c = weekCalc(db, id, week);
      const open = db.prepare("SELECT in_at FROM time_entries WHERE user_id=? AND out_at=''").all(id).filter(e => { const d = localDate(e.in_at); return d >= week && d <= end; }).length;
      const jobs = new Map();
      for (const e of c.entries) { const j = jobs.get(e.job_id) || { job_id: e.job_id, client_name: jobName(e.job_id), minutes: 0, cost_cents: 0 }; j.minutes += e.minutes; j.cost_cents += e.base_cents + e.ot_extra_cents; jobs.set(e.job_id, j); }
      const sum = k => c.entries.reduce((a, e) => a + e[k], 0);
      const paid = db.prepare('SELECT p.*, u.name by_name FROM payroll p LEFT JOIN users u ON u.id=p.paid_by WHERE p.user_id=? AND p.week_start=?').get(id, week);
      return { user_id: id, name: u.name, trade: u.trade, rate_cents: u.rate_cents, minutes: sum('minutes'), reg_minutes: sum('reg_minutes'), ot_minutes: sum('ot_minutes'),
        base_cents: sum('base_cents'), ot_extra_cents: sum('ot_extra_cents'), total_cents: sum('base_cents') + sum('ot_extra_cents'), open_entries: open,
        days: [...new Set(c.entries.map(e => localDate(e.in_at)))].length, jobs: [...jobs.values()],
        paid: paid ? { id: paid.id, at: paid.paid_at, by: paid.by_name, method: paid.method, note: paid.note, total_cents: paid.total_cents } : null };
    }).filter(p => p && (p.minutes || p.open_entries || p.paid)).sort((a, b) => a.name.localeCompare(b.name));
    return { week, end, prev: addDays(week, -7), next: addDays(week, 7), settings: settings(db), people,
      total_cents: people.reduce((a, p) => a + p.total_cents, 0), unpaid_cents: people.filter(p => !p.paid).reduce((a, p) => a + p.total_cents, 0) };
  });

  add('POST', '/api/payroll/pay', ({ user, body }) => {
    owner(user);
    const uid = intId(body.user_id);
    const week = weekOf(db, dateQ(body.week, ''));
    if (!/^\d{4}/.test(week)) fail(400, 'Falta: semana');
    if (isPaid(db, uid, week)) fail(400, 'Esa semana ya está marcada como pagada');
    const end = addDays(week, 6);
    const open = db.prepare("SELECT in_at FROM time_entries WHERE user_id=? AND out_at=''").all(uid).some(e => { const d = localDate(e.in_at); return d >= week && d <= end; });
    if (open) fail(400, 'Tiene una entrada sin salida en esa semana: corríjala antes de pagar');
    const c = weekCalc(db, uid, week);
    if (!c.entries.length) fail(400, 'No hay horas en esa semana');
    const min = c.entries.reduce((a, e) => a + e.minutes, 0), ot = c.entries.reduce((a, e) => a + e.ot_minutes, 0);
    const total = c.entries.reduce((a, e) => a + e.base_cents + e.ot_extra_cents, 0);
    const method = str(body.method, 40), note = str(body.note, 300);
    const id = Number(db.prepare("INSERT INTO payroll(user_id,week_start,minutes,ot_minutes,total_cents,method,note,paid_by,paid_at) VALUES(?,?,?,?,?,?,?,?,datetime('now'))")
      .run(uid, week, min, ot, total, method, note, user.id).lastInsertRowid);
    const name = (db.prepare('SELECT name FROM users WHERE id=?').get(uid) || {}).name;
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'crear', 'nomina', id, `Pagado a ${name}: $${(total / 100).toFixed(2)} (${(min / 60).toFixed(2)} h, semana del ${week})${method ? ' · ' + method : ''}`);
    return { ok: true, id, total_cents: total };
  });
  add('DELETE', '/api/payroll/:id', ({ user, params }) => {
    owner(user);
    const p = db.prepare('SELECT * FROM payroll WHERE id=?').get(intId(params.id)); if (!p) fail(404, 'No encontrado');
    db.prepare('DELETE FROM payroll WHERE id=?').run(p.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'borrar', 'nomina', p.id, `Se quitó el pago de la semana del ${p.week_start}`);
    return { ok: true };
  });

  // Reporte: cuánto se ha gastado en trabajadores por hora, por trabajador y por obra.
  add('GET', '/api/labor/report', ({ user, query }) => {
    owner(user);
    const to = dateQ(query.get('to'), today()), from = dateQ(query.get('from'), addDays(to, -29));
    const jobF = query.get('job') ? intId(query.get('job')) : null;
    // Semanas completas que tocan el rango (para el tiempo extra), luego se filtra por día.
    const rows = db.prepare("SELECT DISTINCT user_id FROM time_entries WHERE out_at<>'' AND in_at BETWEEN ? AND ?").all(addDays(from, -1), addDays(to, 2) + ' 23:59:59');
    const entries = [];
    for (const r of rows) {
      const weeks = new Set(); for (let d = weekOf(db, from); d <= to; d = addDays(d, 7)) weeks.add(d);
      for (const w of weeks) for (const e of weekCalc(db, r.user_id, w).entries) { const d = localDate(e.in_at); if (d >= from && d <= to && (!jobF || e.job_id === jobF)) entries.push({ ...e, day: d }); }
    }
    const names = new Map(db.prepare("SELECT id, name, trade, rate_cents FROM users WHERE role='worker'").all().map(u => [u.id, u]));
    const W = new Map(), J = new Map();
    for (const e of entries) {
      const cost = e.base_cents + e.ot_extra_cents;
      const w = W.get(e.user_id) || { user_id: e.user_id, name: (names.get(e.user_id) || {}).name || '?', trade: (names.get(e.user_id) || {}).trade || '', minutes: 0, ot_minutes: 0, cost_cents: 0, jobs: new Map() };
      w.minutes += e.minutes; w.ot_minutes += e.ot_minutes; w.cost_cents += cost;
      const wj = w.jobs.get(e.job_id) || { job_id: e.job_id, client_name: jobName(e.job_id), minutes: 0, cost_cents: 0 }; wj.minutes += e.minutes; wj.cost_cents += cost; w.jobs.set(e.job_id, wj);
      W.set(e.user_id, w);
      const j = J.get(e.job_id) || { job_id: e.job_id, client_name: jobName(e.job_id), minutes: 0, ot_minutes: 0, cost_cents: 0, workers: new Map() };
      j.minutes += e.minutes; j.ot_minutes += e.ot_minutes; j.cost_cents += cost;
      const jw = j.workers.get(e.user_id) || { user_id: e.user_id, name: w.name, minutes: 0, cost_cents: 0 }; jw.minutes += e.minutes; jw.cost_cents += cost; j.workers.set(e.user_id, jw);
      J.set(e.job_id, j);
    }
    const fin = m => [...m.values()].map(x => ({ ...x, jobs: x.jobs ? [...x.jobs.values()].sort((a, b) => b.cost_cents - a.cost_cents) : undefined, workers: x.workers ? [...x.workers.values()].sort((a, b) => b.cost_cents - a.cost_cents) : undefined }))
      .sort((a, b) => b.cost_cents - a.cost_cents);
    return { from, to, by_worker: fin(W), by_job: fin(J), total_cents: entries.reduce((a, e) => a + e.base_cents + e.ot_extra_cents, 0), total_minutes: entries.reduce((a, e) => a + e.minutes, 0),
      ot_minutes: entries.reduce((a, e) => a + e.ot_minutes, 0) };
  });

  // En la obra: mano de obra por hora desde el principio, por trabajador.
  add('GET', '/api/jobs/:id/labor', ({ user, params }) => {
    owner(user);
    const jobId = intId(params.id);
    if (!db.prepare('SELECT 1 FROM jobs WHERE id=?').get(jobId)) fail(404, 'Obra no encontrada');
    const list = db.prepare("SELECT t.user_id, u.name, u.trade, SUM(t.minutes) minutes, SUM(ROUND(t.minutes / 60.0 * t.rate_cents)) base_cents, MIN(t.in_at) first_at, MAX(t.in_at) last_at, COUNT(*) n FROM time_entries t JOIN users u ON u.id=t.user_id WHERE t.job_id=? AND t.out_at<>'' GROUP BY t.user_id ORDER BY base_cents DESC").all(jobId);
    const ot = new Map(db.prepare('SELECT o.user_id, SUM(e.amount_cents) c FROM ot_expenses o JOIN expenses e ON e.id=o.expense_id WHERE o.job_id=? GROUP BY o.user_id').all(jobId).map(r => [r.user_id, r.c]));
    const working = db.prepare("SELECT u.name, t.in_at FROM time_entries t JOIN users u ON u.id=t.user_id WHERE t.job_id=? AND t.out_at=''").all(jobId);
    const workers = list.map(r => ({ user_id: r.user_id, name: r.name, trade: r.trade, minutes: r.minutes, entries: r.n, first_day: localDate(r.first_at), last_day: localDate(r.last_at),
      ot_extra_cents: ot.get(r.user_id) || 0, cost_cents: Number(r.base_cents) + (ot.get(r.user_id) || 0) }));
    return { workers, working, total_minutes: workers.reduce((a, w) => a + w.minutes, 0), total_cents: workers.reduce((a, w) => a + w.cost_cents, 0) };
  });
};
module.exports.syncOT = syncOT;
module.exports.weekOfEntry = weekOfEntry;
module.exports.isPaid = isPaid;
module.exports.localDate = localDate;
module.exports.settings = settings;
