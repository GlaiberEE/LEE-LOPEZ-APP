'use strict';
// Fila de espera de trabajos vendidos y cuándo arrancar cada uno según los subs que se van liberando.
//  - Un trabajo entra a la fila el día que se aprueba su estimado (o se firma la propuesta). Los más viejos van primero.
//  - La app ve cuándo termina cada sub sus tareas en las obras que ya arrancaron y propone la fecha de arranque.
//  - Ustedes marcan qué subs son "clave para empezar" (por omisión, los de las primeras etapas: pilares, framing…).
//  - La app les pregunta a todos los subs del trabajo si pueden en la fecha que les toca; contestan sí o no desde su teléfono.
//  - El porcentaje de listo cuenta solo a los clave. Los demás pueden esperar hasta una semana (se cambia por compañía).
//  - Nada arranca solo: un dueño (o el PM) toca "Arrancar" y la app recorre el schedule a esa fecha.
const TZ = process.env.APP_TZ || 'America/Chicago';
const todayL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const noSunday = iso => { const d = new Date(iso + 'T12:00:00Z'); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const diff = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 864e5);
const meta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const maxWait = db => { const v = Number(meta(db, 'queue_max_wait')); return Number.isFinite(v) && v >= 0 ? v : 7; };
const firstStages = db => { const v = Number(meta(db, 'queue_first_stages')); return v >= 1 && v <= 10 ? v : 3; };
// Tareas de trabajo (no planos ni permisos, no inspecciones).
const WORK = "trade NOT IN ('', 'planos') AND inspection_type='' AND fix_for IS NULL";

// ¿Ya arrancó? Alguna tarea de trabajo empezada o hecha.
const started = (db, jobId) => !!db.prepare(`SELECT 1 FROM tasks WHERE job_id=? AND ${WORK} AND status<>'pendiente'`).get(jobId);
function inQueue(db, j) {
  if (['fuera', 'arrancado'].includes(j.queue_state)) return false;
  if (j.status !== 'activo') return false;
  return !started(db, j.id);
}
// Desde cuándo está libre cada sub: el día después de su última tarea pendiente en las obras que ya arrancaron.
function freeFrom(db, userId, exceptJob) {
  const rows = db.prepare(`SELECT t.job_id, MAX(COALESCE(NULLIF(t.planned_end,''), t.planned_date)) last FROM tasks t JOIN jobs j ON j.id=t.job_id
    WHERE t.assignee_id=? AND t.status<>'hecho' AND j.status='activo' AND t.job_id<>? AND COALESCE(NULLIF(t.planned_end,''), t.planned_date, '')<>'' GROUP BY t.job_id`).all(userId, exceptJob);
  let last = '';
  for (const r of rows) { const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(r.job_id); if (inQueue(db, j)) continue; if (r.last > last) last = r.last; }
  const t = todayL();
  return last && last >= t ? noSunday(addDays(last, 1)) : noSunday(t);
}

// Subs del trabajo: los que tienen tareas asignadas y los subs con usuario de la obra. Con su primera tarea y su etapa.
function candidates(db, job) {
  const tasks = db.prepare(`SELECT * FROM tasks WHERE job_id=? AND ${WORK} ORDER BY position, id`).all(job.id);
  const trades = [...new Set(tasks.map(t => t.trade))];
  const first = tasks.find(t => t.planned_date) || {};
  const by = new Map();
  const add = (uid, name) => { if (uid && !by.has(uid)) by.set(uid, { user_id: uid, name, trades: new Set() }); };
  for (const t of tasks) if (t.assignee_id) { add(t.assignee_id, ''); by.get(t.assignee_id).trades.add(t.trade); }
  for (const s of db.prepare('SELECT user_id, name, trades FROM subs WHERE job_id=? AND user_id IS NOT NULL').all(job.id)) { add(s.user_id, s.name); String(s.trades || '').split(',').filter(Boolean).forEach(x => by.get(s.user_id).trades.add(x)); }
  const out = [];
  for (const c of by.values()) {
    const u = db.prepare("SELECT name, active, role FROM users WHERE id=?").get(c.user_id);
    if (!u || !u.active || u.role !== 'worker') continue;
    const mine = tasks.filter(t => t.assignee_id === c.user_id || (!t.assignee_id && c.trades.has(t.trade)));
    const ft = mine[0];
    const stage = ft ? trades.indexOf(ft.trade) : 99;
    out.push({ user_id: c.user_id, name: u.name, trades: [...c.trades], first_task: ft ? { id: ft.id, title: ft.title, trade: ft.trade } : null, stage,
      offset: ft && ft.planned_date && first.planned_date ? Math.max(0, diff(ft.planned_date, first.planned_date)) : 0 });
  }
  return out.sort((a, b) => a.stage - b.stage || a.name.localeCompare(b.name));
}

// Plan de un trabajo de la fila: fecha propuesta, quién es clave, qué contestó cada uno, cuánto espera y el % de listo.
function planOf(db, job) {
  const rows = Object.fromEntries(db.prepare('SELECT * FROM job_queue_subs WHERE job_id=?').all(job.id).map(r => [r.user_id, r]));
  const fs = firstStages(db), mw = maxWait(db);
  const cands = candidates(db, job).map(c => {
    const r = rows[c.user_id] || {};
    const key = r.key_set ? !!r.is_key : c.stage < fs && c.stage >= 0 && c.stage !== 99;
    return { ...c, key, free_from: freeFrom(db, c.user_id, job.id), row_id: r.id || null, answer: r.answer || '', available_from: r.available_from || '', note: r.note || '', asked_at: r.asked_at || '', needed_date: r.needed_date || '' };
  });
  const keys = cands.filter(c => c.key);
  // Fecha que propone la app: cuando todos los clave ya están libres (o la que ustedes pusieron).
  let start = job.queue_start;
  if (!start) {
    start = noSunday(addDays(todayL(), 1));
    for (const c of keys) { const s = addDays(c.answer === 'no' && c.available_from ? c.available_from : c.free_from, -c.offset); if (s > start) start = noSunday(s); }
  }
  for (const c of cands) {
    if (!c.needed_date || !c.asked_at) c.needed_date = noSunday(addDays(start, c.offset));
    const can = c.answer === 'no' && c.available_from ? c.available_from : c.answer === 'si' ? c.needed_date : c.free_from;
    c.wait_days = Math.max(0, diff(can, c.needed_date));
    c.too_long = !c.key && c.wait_days > mw;
  }
  const yes = keys.filter(c => c.answer === 'si').length;
  const pct = keys.length ? Math.round(yes * 100 / keys.length) : 0;
  const keyNo = keys.some(c => c.answer === 'no');
  const tooLong = cands.some(c => c.too_long);
  const state = !keys.length ? 'sin_clave' : pct === 100 && !tooLong ? 'listo' : pct >= 50 && !keyNo && !tooLong ? 'opcion' : cands.some(c => c.asked_at) ? 'esperando' : 'sin_preguntar';
  const permit = db.prepare("SELECT status FROM permits WHERE job_id=? AND kind='permiso' ORDER BY id LIMIT 1").get(job.id);
  return { job_id: job.id, client_name: job.client_name, address: job.address, project_type: job.project_type, queue_since: job.queue_since || job.won_date || (job.created_at || '').slice(0, 10),
    days_waiting: Math.max(0, diff(todayL(), job.queue_since || job.won_date || (job.created_at || todayL()).slice(0, 10))), proposed_start: start, start_fixed: !!job.queue_start,
    asked: cands.some(c => c.asked_at), subs: cands, readiness_pct: pct, state, max_wait: mw, permit: permit ? permit.status : '', quoted_cents: job.quoted_cents };
}
function queue(db) {
  return db.prepare("SELECT * FROM jobs WHERE status='activo' ORDER BY id").all().filter(j => inQueue(db, j))
    .map(j => planOf(db, j)).sort((a, b) => a.queue_since.localeCompare(b.queue_since) || a.job_id - b.job_id).map((p, i) => ({ ...p, position: i + 1 }));
}
// Cuando un trabajo se vende (estimado aprobado o propuesta firmada), entra a la fila con esa fecha.
function enqueue(db, jobId, day = todayL()) {
  db.prepare("UPDATE jobs SET queue_since=CASE WHEN queue_since='' THEN ? ELSE queue_since END, queue_state=CASE WHEN queue_state IN ('','fuera') THEN 'espera' ELSE queue_state END WHERE id=?").run(day, jobId);
}

function routes(db, add, h) {
  const { requireRole, fail, str, date, intId, jobOr404 } = h;
  const { notify, owners } = require('./push');
  const who = u => u.pmId || u.id;
  const fd = d => d ? d.slice(5).replace('-', '/') : '';
  const queued = (user, id) => { const j = jobOr404(db, user, intId(id)); if (!inQueue(db, j)) fail(400, 'Este trabajo ya no está en la fila de espera'); return j; };
  const upsert = (jobId, uid) => { db.prepare('INSERT INTO job_queue_subs(job_id,user_id) VALUES(?,?) ON CONFLICT(job_id,user_id) DO NOTHING').run(jobId, uid); return db.prepare('SELECT * FROM job_queue_subs WHERE job_id=? AND user_id=?').get(jobId, uid); };

  add('GET', '/api/queue', ({ user }) => { requireRole(user, 'owner'); return { jobs: queue(db), max_wait: maxWait(db), first_stages: firstStages(db) }; });
  // Marcar los subs clave y/o fijar la fecha de arranque.
  add('PUT', '/api/queue/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const j = queued(user, params.id);
    if (Array.isArray(body.key_ids)) {
      const keys = new Set(body.key_ids.map(Number));
      for (const c of candidates(db, j)) { upsert(j.id, c.user_id); db.prepare('UPDATE job_queue_subs SET is_key=?, key_set=1 WHERE job_id=? AND user_id=?').run(keys.has(c.user_id) ? 1 : 0, j.id, c.user_id); }
    }
    if ('start_date' in body) db.prepare('UPDATE jobs SET queue_start=? WHERE id=?').run(body.start_date ? date(body.start_date, 'fecha de arranque') : '', j.id);
    return planOf(db, db.prepare('SELECT * FROM jobs WHERE id=?').get(j.id));
  });
  // Preguntar a todos los subs del trabajo si pueden en la fecha que les toca.
  add('POST', '/api/queue/:id/ask', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const j = queued(user, params.id);
    if (body.start_date) db.prepare('UPDATE jobs SET queue_start=? WHERE id=?').run(date(body.start_date, 'fecha de arranque'), j.id);
    const p = planOf(db, db.prepare('SELECT * FROM jobs WHERE id=?').get(j.id));
    let n = 0;
    for (const c of p.subs) {
      if (body.only && !body.only.map(Number).includes(c.user_id)) continue;
      const need = noSunday(addDays(p.proposed_start, c.offset));
      upsert(j.id, c.user_id);
      db.prepare("UPDATE job_queue_subs SET needed_date=?, answer='', available_from='', note='', asked_at=datetime('now'), answered_at='', answered_by=NULL, is_key=?, key_set=1 WHERE job_id=? AND user_id=?").run(need, c.key ? 1 : 0, j.id, c.user_id);
      notify(db, c.user_id, 'avail_ask', { job: j.address || j.client_name, d: fd(need), x: c.first_task ? c.first_task.title : '' }, '#/');
      n++;
    }
    db.prepare("UPDATE jobs SET queue_state='propuesto', queue_start=? WHERE id=?").run(p.proposed_start, j.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,'editar','fila de espera',?,?,?)").run(who(user), j.id, j.id, `Se preguntó disponibilidad a ${n} subs para arrancar el ${p.proposed_start}`);
    if (!n) fail(400, 'Este trabajo no tiene subs con usuario en la app para preguntarles');
    return { ok: true, asked: n, plan: planOf(db, db.prepare('SELECT * FROM jobs WHERE id=?').get(j.id)) };
  });
  // El sub contesta (o un dueño / PM por él, si contestó por teléfono).
  add('POST', '/api/queue/answers/:id', ({ user, params, body }) => {
    requireRole(user, 'owner', 'worker');
    const r = db.prepare('SELECT * FROM job_queue_subs WHERE id=?').get(intId(params.id));
    if (!r) fail(404, 'No encontrado');
    if (user.role === 'worker' && r.user_id !== user.id) fail(404, 'No encontrado');
    if (user.role !== 'worker') jobOr404(db, user, r.job_id);
    const ans = body.answer === 'si' ? 'si' : body.answer === 'no' ? 'no' : fail(400, 'Conteste sí o no');
    const from = ans === 'no' ? (date(body.available_from, 'fecha') || '') : '';
    if (ans === 'no' && !from) fail(400, 'Diga desde qué fecha sí puede');
    if (from && from <= r.needed_date) fail(400, 'Esa fecha es antes de la que se le pidió: entonces sí puede');
    db.prepare("UPDATE job_queue_subs SET answer=?, available_from=?, note=?, answered_at=datetime('now'), answered_by=? WHERE id=?").run(ans, from, str(body.note, 200), who(user), r.id);
    const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(r.job_id);
    const u = db.prepare('SELECT name FROM users WHERE id=?').get(r.user_id);
    const p = planOf(db, j);
    const to = [...new Set([...owners(db), j.pm_id].filter(Boolean))].filter(id => id !== user.id);
    if (to.length) notify(db, to, 'avail_answer', { who: u.name, x: ans === 'si' ? `✅ ${fd(r.needed_date)}` : `❌ → ${fd(from)}`, job: j.client_name, n: p.readiness_pct + '%' }, '#/fila');
    return { ok: true, plan: p };
  });
  // Calendario del sub para contestar: sus días ocupados en obras activas (sus tareas) y el día que se le pide.
  // Solo ve sus propias tareas y en qué obra; nada de dinero. Lo abre el sub o un dueño/PM que contesta por él.
  add('GET', '/api/queue/answers/:id/calendar', ({ user, params }) => {
    requireRole(user, 'owner', 'worker');
    const r = db.prepare('SELECT * FROM job_queue_subs WHERE id=?').get(intId(params.id));
    if (!r || (user.role === 'worker' && r.user_id !== user.id)) fail(404, 'No encontrado');
    if (user.role !== 'worker') jobOr404(db, user, r.job_id);
    const j = db.prepare('SELECT id, client_name, address FROM jobs WHERE id=?').get(r.job_id);
    const from = addDays(todayL(), -7), to = addDays(r.needed_date || todayL(), 75);
    const rows = db.prepare(`SELECT t.title, t.planned_date, MAX(t.planned_date, COALESCE(NULLIF(t.planned_end,''), t.planned_date)) pend, t.job_id, j.client_name, j.address FROM tasks t JOIN jobs j ON j.id=t.job_id
      WHERE t.assignee_id=? AND t.status<>'hecho' AND j.status='activo' AND t.planned_date<>'' AND t.job_id<>? AND MAX(t.planned_date, COALESCE(NULLIF(t.planned_end,''), t.planned_date))>=? AND t.planned_date<=? ORDER BY t.planned_date`).all(r.user_id, r.job_id, from, to);
    const jobs = [], days = {};
    const waiting = new Set(db.prepare("SELECT * FROM jobs WHERE status='activo'").all().filter(x => inQueue(db, x)).map(x => x.id));
    for (const t of rows) {
      if (waiting.has(t.job_id)) continue; // los que todavía esperan en la fila no son obras activas
      let k = jobs.findIndex(x => x.id === t.job_id);
      if (k < 0) { jobs.push({ id: t.job_id, name: t.address || t.client_name }); k = jobs.length - 1; }
      for (let d = t.planned_date < from ? from : t.planned_date; d <= t.pend && d <= to; d = addDays(d, 1)) (days[d] = days[d] || []).push({ job: k, task: t.title });
    }
    return { id: r.id, job: j.address || j.client_name, client_name: j.client_name, needed_date: r.needed_date, answer: r.answer, available_from: r.available_from, today: todayL(), from, to, jobs, days };
  });
  // Lo que le preguntaron al sub (para su app).
  add('GET', '/api/my-availability', ({ user }) => {
    requireRole(user, 'worker');
    return db.prepare(`SELECT q.id, q.job_id, q.needed_date, q.answer, q.available_from, j.client_name, j.address FROM job_queue_subs q JOIN jobs j ON j.id=q.job_id
      WHERE q.user_id=? AND q.asked_at<>'' AND j.status='activo' AND j.queue_state='propuesto' ORDER BY q.needed_date`).all(user.id);
  });
  // Arrancar: recorre el schedule a la fecha (las tareas que faltan) y avisa a los subs.
  add('POST', '/api/queue/:id/start', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const j = queued(user, params.id);
    const p = planOf(db, j);
    const start = date(body.start_date, 'fecha de arranque') || p.proposed_start;
    const first = db.prepare(`SELECT planned_date FROM tasks WHERE job_id=? AND ${WORK} AND planned_date<>'' AND status<>'hecho' ORDER BY position, id LIMIT 1`).get(j.id);
    const delta = first ? diff(start, first.planned_date) : 0;
    if (delta) for (const t of db.prepare("SELECT id, planned_date, planned_end FROM tasks WHERE job_id=? AND status<>'hecho' AND planned_date<>''").all(j.id))
      db.prepare('UPDATE tasks SET planned_date=?, planned_end=? WHERE id=?').run(noSunday(addDays(t.planned_date, delta)), t.planned_end ? noSunday(addDays(t.planned_end, delta)) : '', t.id);
    // Los que dijeron "no" con fecha: su primera tarea se recorre a cuando sí pueden.
    for (const c of p.subs.filter(c => c.answer === 'no' && c.available_from && c.first_task)) {
      const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(c.first_task.id);
      if (t && (!t.planned_date || t.planned_date < c.available_from)) db.prepare('UPDATE tasks SET planned_date=?, planned_end=CASE WHEN planned_end<>\'\' AND planned_end<? THEN ? ELSE planned_end END WHERE id=?').run(c.available_from, c.available_from, c.available_from, t.id);
    }
    db.prepare("UPDATE jobs SET start_date=?, queue_state='arrancado', queue_start=? WHERE id=?").run(start, start, j.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,'editar','fila de espera',?,?,?)").run(who(user), j.id, j.id, `Arranque de la obra el ${start} (listo ${p.readiness_pct}%, en la fila ${p.days_waiting} días)`);
    const subs = p.subs.map(c => c.user_id);
    if (subs.length) notify(db, subs, 'avail_start', { job: j.address || j.client_name, d: fd(start) }, `#/obra/${j.id}`);
    return { ok: true, start, readiness_pct: p.readiness_pct };
  });
  add('POST', '/api/queue/:id/remove', ({ user, params }) => {
    requireRole(user, 'owner');
    const j = queued(user, params.id);
    db.prepare("UPDATE jobs SET queue_state='fuera' WHERE id=?").run(j.id);
    return { ok: true };
  });
  add('PUT', '/api/queue-settings', ({ user, body }) => {
    requireRole(user, 'owner'); if (user.isPm) fail(403, 'Esto solo lo pueden cambiar los dueños');
    const set = (k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
    if ('max_wait' in body) { const v = Math.round(Number(body.max_wait)); if (!(v >= 0 && v <= 60)) fail(400, 'Días inválidos'); set('queue_max_wait', v); }
    if ('first_stages' in body) { const v = Math.round(Number(body.first_stages)); if (!(v >= 1 && v <= 10)) fail(400, 'Etapas inválidas'); set('queue_first_stages', v); }
    return { max_wait: maxWait(db), first_stages: firstStages(db) };
  });
}
module.exports = { routes, queue, planOf, enqueue, inQueue, freeFrom, candidates };
