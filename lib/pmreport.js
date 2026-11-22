'use strict';
// Reporte diario y calificación de los project managers.
//  - La app anota sola lo que hace cada PM (y cada dueño): tareas, fotos, reportes, casos, aprobaciones, gastos…
//  - El PM escribe al final del día una nota corta: qué hizo, problemas, qué sigue.
//  - Ficha mensual con RESULTADOS (no clics): puntualidad, presupuesto, retrabajo, calificación del cliente,
//    disciplina (notas diarias) y la evaluación de los dueños. Cada parte se explica; nada es caja negra.
const { notify, owners } = require('./push');

// Qué acciones cuentan como actividad y cómo se agrupan.
const GROUPS = {
  tareas: ['PUT /api/tasks/:id', 'POST /api/jobs/:id/tasks', 'POST /api/tasks/:id/reschedule', 'POST /api/tasks/:id/move', 'POST /api/tasks/:id/notify'],
  cliente: ['POST /api/jobs/:id/logs', 'POST /api/jobs/:id/updates'],
  fotos: ['POST /api/jobs/:id/photos'],
  casos: ['POST /api/issues', 'POST /api/issues/:id/messages', 'POST /api/issues/:id/resolve'],
  subs: ['POST /api/docs/:id/decide', 'POST /api/notices/:id/accept', 'POST /api/notices/:id/close'],
  dinero: ['POST /api/jobs/:id/expenses', 'POST /api/scans', 'POST /api/scans/:id/file', 'POST /api/jobs/:id/payments', 'POST /api/jobs/:id/changes', 'POST /api/subs/:id/payments'],
  permisos: ['POST /api/jobs/:id/permits', 'PUT /api/permits/:id'],
  materiales: ['POST /api/jobs/:id/materials'],
  planes: ['POST /api/jobs/:id/plan/apply'],
};
const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, ks]) => ks.map(k => [k, g])));
const JOB_OF = {
  tasks: 'SELECT job_id FROM tasks WHERE id=?', issues: 'SELECT job_id FROM issues WHERE id=?', docs: 'SELECT job_id FROM sub_docs WHERE id=?',
  notices: 'SELECT job_id FROM notices WHERE id=?', permits: 'SELECT job_id FROM permits WHERE id=?', subs: 'SELECT job_id FROM subs WHERE id=?', scans: 'SELECT job_id FROM scans WHERE id=?',
};

function log(db, key, ctx, res) {
  try {
    const u = ctx.user; if (!u || !(u.role === 'owner')) return; // dueños y PMs (que actúan como dueño)
    if (!GROUP_OF[key]) return;
    if (res && res.pending) return; // si quedó esperando autorización, no cuenta todavía
    const p = ctx.params || {};
    let job = null;
    if (key.includes('/api/jobs/:id')) job = Number(p.id);
    else { const tbl = key.split('/')[2].replace('-', ''); const q = JOB_OF[tbl]; if (q && p.id) job = (db.prepare(q).get(Number(p.id)) || {}).job_id ?? null; }
    if (!job && res && res.job_id) job = res.job_id;
    if (!job && key === 'POST /api/issues' && ctx.body) job = Number(ctx.body.job_id) || null;
    const b = ctx.body || {};
    const detail = String(b.status || b.title || b.description || b.client_notes || b.body || b.action || '').slice(0, 140);
    db.prepare('INSERT INTO activity_log(user_id,route,job_id,detail) VALUES(?,?,?,?)').run(u.pmId || u.id, key, job, detail);
  } catch (e) { console.error('[actividad]', e.message); }
}

const ymd = d => d.toISOString().slice(0, 10);
const tzDate = (tz, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const tzHour = (tz, d = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(d)) % 24;
// Convierte un día local (America/Chicago) en el rango UTC con que se guardan las horas.
function utcRange(day, tz) {
  // Diferencia de la zona con UTC a mediodía de ese día (sin depender de la zona del servidor).
  const probe = new Date(day + 'T12:00:00Z');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(probe).map(x => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const offMin = Math.round((probe - local) / 60000);
  const start = new Date(Date.parse(day + 'T00:00:00Z') + offMin * 60000);
  const end = new Date(start.getTime() + 864e5);
  const f = d => d.toISOString().replace('T', ' ').slice(0, 19);
  return [f(start), f(end)];
}
const TZ = () => process.env.APP_TZ || 'America/Chicago';

function daily(db, userId, day) {
  const [a, b] = utcRange(day, TZ());
  const rows = db.prepare(`SELECT a.*, j.client_name FROM activity_log a LEFT JOIN jobs j ON j.id=a.job_id WHERE a.user_id=? AND a.at>=? AND a.at<? ORDER BY a.id`).all(userId, a, b);
  const counts = {}; for (const r of rows) { const g = GROUP_OF[r.route] || 'otro'; counts[g] = (counts[g] || 0) + 1; }
  const done = db.prepare(`SELECT t.title, j.client_name FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE j.pm_id=? AND t.done_date=?`).all(userId, day);
  const note = db.prepare('SELECT did, problems, next_steps, created_at FROM pm_notes WHERE user_id=? AND date=?').get(userId, day) || null;
  return { day, counts, total: rows.length, items: rows.slice(-40).map(r => ({ at: r.at, group: GROUP_OF[r.route] || 'otro', route: r.route, client_name: r.client_name || '', detail: r.detail })),
    tasks_done: done, note, jobs: db.prepare("SELECT id, client_name FROM jobs WHERE pm_id=? AND status IN ('activo','cotizado','prospecto') ORDER BY client_name").all(userId) };
}

function weekdaysIn(month, upTo) {
  const [y, m] = month.split('-').map(Number); let n = 0;
  for (let d = 1; d <= 31; d++) { const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) break; const s = ymd(dt); if (upTo && s > upTo) break; const w = dt.getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

function scorecard(db, pmId, month, money) {
  const today = tzDate(TZ());
  const jobs = db.prepare('SELECT * FROM jobs WHERE pm_id=?').all(pmId);
  const inMonth = d => d && String(d).slice(0, 7) === month;
  const finished = jobs.filter(j => j.status === 'terminado' && inMonth(j.completed_date));
  const late = finished.filter(j => j.end_date && j.completed_date > j.end_date);
  const daysLate = late.map(j => Math.round((Date.parse(j.completed_date) - Date.parse(j.end_date)) / 864e5));
  const active = jobs.filter(j => j.status === 'activo');
  const overdueTasks = db.prepare(`SELECT COUNT(*) n FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE j.pm_id=? AND j.status='activo' AND t.status<>'hecho'
    AND COALESCE(NULLIF(t.planned_end,''), NULLIF(t.planned_date,'')) < ?`).get(pmId, today).n;
  // Presupuesto: obras terminadas este mes (o activas si no hay) con presupuesto.
  const budJobs = (finished.length ? finished : active).map(j => {
    const b = db.prepare('SELECT COALESCE(SUM(cents),0) v FROM budgets WHERE job_id=?').get(j.id).v;
    return b ? { b, spent: money(db, j.id).spent } : null; }).filter(Boolean);
  const bTot = budJobs.reduce((a, x) => a + x.b, 0), sTot = budJobs.reduce((a, x) => a + x.spent, 0);
  const variance = bTot ? (sTot - bTot) / bTot : null;
  const contracts = finished.reduce((a, j) => a + money(db, j.id).contract, 0);
  const profit = finished.reduce((a, j) => a + money(db, j.id).profit, 0);
  const rework = db.prepare(`SELECT COALESCE(SUM(e.amount_cents),0) v FROM expenses e JOIN jobs j ON j.id=e.job_id WHERE j.pm_id=? AND e.category='retrabajo' AND substr(e.date,1,7)=?`).get(pmId, month).v;
  const reworkBase = contracts || active.reduce((a, j) => a + money(db, j.id).contract, 0);
  const ratings = db.prepare('SELECT r.stars FROM job_ratings r JOIN jobs j ON j.id=r.job_id WHERE j.pm_id=? AND substr(r.created_at,1,7)=?').all(pmId, month).map(r => r.stars);
  const ratingsAll = db.prepare('SELECT r.stars FROM job_ratings r JOIN jobs j ON j.id=r.job_id WHERE j.pm_id=?').all(pmId).map(r => r.stars);
  const resolved = db.prepare(`SELECT i.created_at, i.resolved_at FROM issues i JOIN jobs j ON j.id=i.job_id WHERE j.pm_id=? AND i.status='resuelto' AND substr(i.resolved_at,1,7)=?`).all(pmId, month)
    .map(i => (Date.parse(i.resolved_at.replace(' ', 'T') + 'Z') - Date.parse(i.created_at.replace(' ', 'T') + 'Z')) / 36e5).sort((a, b) => a - b);
  const notes = db.prepare('SELECT COUNT(*) n FROM pm_notes WHERE user_id=? AND substr(date,1,7)=?').get(pmId, month).n;
  const workdays = weekdaysIn(month, month === today.slice(0, 7) ? today : null);
  const reqs = db.prepare("SELECT status, COUNT(*) n FROM change_requests WHERE user_id=? AND substr(created_at,1,7)=? GROUP BY status").all(pmId, month);
  const req = k => (reqs.find(r => r.status === k) || {}).n || 0;
  const reviews = db.prepare('SELECT r.score, r.comments, r.created_at, u.name owner_name FROM pm_reviews r LEFT JOIN users u ON u.id=r.owner_id WHERE r.pm_id=? AND r.month=?').all(pmId, month);
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const clamp = v => Math.max(1, Math.min(5, v));
  const r1 = v => v == null ? null : Math.round(v * 10) / 10;
  const parts = {
    puntualidad: finished.length ? clamp(1 + 4 * (1 - late.length / finished.length)) : null,
    presupuesto: variance == null ? null : clamp(variance <= 0 ? 5 : 5 - 4 * Math.min(1, variance / 0.2)),
    calidad: reworkBase ? clamp(5 - 4 * Math.min(1, (rework / reworkBase) / 0.05)) : null,
    cliente: avg(ratings) ?? (ratingsAll.length ? avg(ratingsAll) : null),
    disciplina: workdays ? clamp(1 + 4 * Math.min(1, notes / workdays) - Math.min(1, req('rechazado') * 0.25)) : null,
    duenos: avg(reviews.map(r => r.score)),
  };
  const W = { puntualidad: 20, presupuesto: 20, calidad: 15, cliente: 20, disciplina: 10, duenos: 15 };
  const used = Object.entries(parts).filter(([, v]) => v != null);
  const wSum = used.reduce((a, [k]) => a + W[k], 0);
  const overall = wSum ? used.reduce((a, [k, v]) => a + v * W[k], 0) / wSum : null;
  return {
    month, overall: r1(overall), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r1(v)])), weights: W,
    data: {
      finished: finished.length, late: late.length, avg_days_late: daysLate.length ? Math.round(avg(daysLate)) : 0, active: active.length, overdue_tasks: overdueTasks,
      budget_cents: bTot, spent_cents: sTot, variance_pct: variance == null ? null : Math.round(variance * 1000) / 10,
      contracts_cents: contracts, profit_cents: profit, margin_pct: contracts ? Math.round(profit * 1000 / contracts) / 10 : null, rework_cents: rework,
      ratings: ratings.length, rating_avg: r1(avg(ratings)), rating_all_avg: r1(avg(ratingsAll)), rating_all_n: ratingsAll.length,
      cases_resolved: resolved.length, case_hours_median: resolved.length ? Math.round(resolved[Math.floor(resolved.length / 2)]) : null,
      notes, workdays, requests: { total: reqs.reduce((a, r) => a + r.n, 0), approved: req('aprobado'), rejected: req('rechazado') },
    },
    reviews,
  };
}

function routes(db, add, h) {
  const { requireRole, fail, str, intId, date, jobOr404, money } = h;
  const isPm = u => u.isPm || u.role === 'pm';
  const pmOr404 = id => { const u = db.prepare("SELECT id, name, active, pm_limit_cents, pm_month_cents FROM users WHERE id=? AND role='pm'").get(intId(id)); if (!u) fail(404, 'No encontrado'); return u; };
  const today = () => tzDate(TZ());

  // Nota del día del PM (una por día, se puede corregir el mismo día).
  add('POST', '/api/pm/notes', ({ user, body }) => {
    requireRole(user, 'pm', 'owner');
    const uid = user.pmId || user.id;
    const day = date(body.date, 'fecha') || today();
    if (day !== today() && day !== tzDate(TZ(), new Date(Date.now() - 864e5))) fail(400, 'La nota se escribe el mismo día (o a más tardar al día siguiente)');
    const did = str(body.did, 3000);
    if (!did.trim()) fail(400, 'Escriba qué hizo hoy');
    db.prepare(`INSERT INTO pm_notes(user_id,date,did,problems,next_steps) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id,date) DO UPDATE SET did=excluded.did, problems=excluded.problems, next_steps=excluded.next_steps`).run(uid, day, did, str(body.problems, 2000), str(body.next_steps, 2000));
    return { ok: true };
  });
  // Reporte diario: dueño ve a todos los PMs; el PM se ve a sí mismo.
  add('GET', '/api/pm/daily', ({ user, query }) => {
    requireRole(user, 'pm', 'owner');
    const day = date(query.get('date'), 'fecha') || today();
    if (isPm(user)) return { day, pms: [{ id: user.pmId || user.id, name: user.name, ...daily(db, user.pmId || user.id, day) }] };
    const T = require('./translate'), trn = n => n && ['did', 'problems', 'next_steps'].forEach(k => T.addTr(db, n, k, user.lang));
    return { day, pms: db.prepare("SELECT id, name FROM users WHERE role='pm' AND active=1 AND is_agent=0 ORDER BY name").all().map(p => { const d = { ...p, ...daily(db, p.id, day) }; trn(d.note); return d; }) };
  });
  add('GET', '/api/pm/:id/scorecard', ({ user, params, query }) => {
    requireRole(user, 'owner');
    if (isPm(user)) fail(403, 'Esto solo lo pueden hacer los dueños');
    const pm = pmOr404(params.id);
    const month = /^\d{4}-\d{2}$/.test(query.get('month') || '') ? query.get('month') : today().slice(0, 7);
    const months = [];
    for (let k = 0; k < 6; k++) { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 - k, 1)); const m = ymd(d).slice(0, 7); months.push({ month: m, overall: scorecard(db, pm.id, m, money).overall }); }
    return { pm, ...scorecard(db, pm.id, month, money), history: months.reverse(),
      notes: db.prepare('SELECT date, did, problems, next_steps FROM pm_notes WHERE user_id=? AND substr(date,1,7)=? ORDER BY date DESC').all(pm.id, month)
        .map(n => { ['did', 'problems', 'next_steps'].forEach(k => require('./translate').addTr(db, n, k, user.lang)); return n; }) };
  });
  add('POST', '/api/pm/:id/review', ({ user, params, body }) => {
    requireRole(user, 'owner');
    if (isPm(user)) fail(403, 'Esto solo lo pueden hacer los dueños');
    const pm = pmOr404(params.id);
    const month = /^\d{4}-\d{2}$/.test(body.month || '') ? body.month : today().slice(0, 7);
    const score = Number(body.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) fail(400, 'Calificación de 1 a 5');
    db.prepare(`INSERT INTO pm_reviews(pm_id,month,owner_id,score,comments) VALUES(?,?,?,?,?)
      ON CONFLICT(pm_id,month,owner_id) DO UPDATE SET score=excluded.score, comments=excluded.comments, created_at=datetime('now')`).run(pm.id, month, user.id, score, str(body.comments, 2000));
    return { ok: true };
  });
  // Calificación del cliente al terminar su obra.
  add('GET', '/api/jobs/:id/rating', ({ user, params }) => {
    requireRole(user, 'owner', 'client');
    const job = jobOr404(db, user, intId(params.id));
    return { can_rate: user.role === 'client' && job.status === 'terminado', rating: db.prepare('SELECT stars, comment, created_at FROM job_ratings WHERE job_id=?').get(job.id) || null };
  });
  add('POST', '/api/jobs/:id/rating', ({ user, params, body }) => {
    requireRole(user, 'client');
    const job = jobOr404(db, user, intId(params.id));
    if (job.status !== 'terminado') fail(400, 'Podrá calificar cuando su proyecto esté terminado');
    const stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) fail(400, 'Calificación de 1 a 5');
    db.prepare(`INSERT INTO job_ratings(job_id,user_id,stars,comment) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET stars=excluded.stars, comment=excluded.comment, created_at=datetime('now')`)
      .run(job.id, user.id, stars, str(body.comment, 2000));
    notify(db, owners(db), 'rating', { who: job.client_name, x: '★'.repeat(stars) }, `#/obra/${job.id}`);
    return { ok: true };
  });
}

// Avisos automáticos: 7 am resumen a los dueños; 5 pm recordatorio al PM que no ha escrito su nota.
function tick(db) {
  try {
    const tz = TZ(), hour = tzHour(tz), day = tzDate(tz);
    const sent = k => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value === day;
    const mark = k => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, day);
    const pms = db.prepare("SELECT id, name FROM users WHERE role='pm' AND active=1 AND is_agent=0").all();
    if (!pms.length) return;
    if (hour >= 7 && hour < 10 && !sent('pm_daily_sent')) { mark('pm_daily_sent'); notify(db, owners(db), 'pm_daily', { x: pms.length }, '#/pm'); }
    if (hour >= 17 && hour < 20 && !sent('pm_note_reminder')) {
      mark('pm_note_reminder');
      for (const p of pms) if (!db.prepare('SELECT 1 FROM pm_notes WHERE user_id=? AND date=?').get(p.id, day)) notify(db, p.id, 'pm_note', {}, '#/');
    }
  } catch (e) { console.error('[reporte PM]', e.message); }
}

module.exports = { log, daily, scorecard, routes, tick, GROUPS, utcRange, tzDate };
