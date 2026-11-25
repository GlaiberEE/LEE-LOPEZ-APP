'use strict';
// Fase 3 — Plan de pago a cada sub y qué toca pagarle.
//  - Tres planes: 50/50 (mitad al empezar, mitad al terminar), por avance (% de su trabajo hecho) o un solo pago al final.
//    Para trabajos chicos (menos de $3,500, se cambia en ajustes) la app sugiere un solo pago al final.
//  - La app calcula cuánto toca pagar ahora con lo que va de sus tareas, lo ya pagado y lo que está esperando autorización.
//  - Cada pago a un sub lo autorizan los dos dueños (ver guard.js): uno lo pide y el otro lo aprueba. Se puede apagar por compañía.
//  - Los subs nunca ven nada de esto: es dinero de la compañía.
const { keyOf } = require('./papers');

const PLANS = ['50_50', 'progreso', 'final'];
const meta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const smallCents = db => { const v = Number(meta(db, 'sub_small_cents')); return Number.isFinite(v) && v >= 0 ? v : 350000; };
const dualOn = db => meta(db, 'sub_pay_dual') !== '0';
const suggested = (db, agreed) => (agreed > 0 && agreed < smallCents(db) ? 'final' : '50_50');

// Tareas del sub en la obra: las de su usuario, o las de sus trades si no tiene usuario.
function subTasks(db, s) {
  if (s.user_id) {
    const t = db.prepare("SELECT id, title, status, inspection_type FROM tasks WHERE job_id=? AND assignee_id=? AND inspection_type=''").all(s.job_id, s.user_id);
    if (t.length) return t;
  }
  const trades = String(s.trades || '').split(',').filter(Boolean);
  if (!trades.length) return [];
  return db.prepare(`SELECT id, title, status FROM tasks WHERE job_id=? AND inspection_type='' AND trade IN (${trades.map(() => '?').join(',')})`).all(s.job_id, ...trades);
}
// Pagos a este sub que esperan al otro dueño.
const pendingOf = (db, s) => db.prepare("SELECT id, summary, amount_cents, user_id, first_by, created_at, body FROM change_requests WHERE status='pendiente' AND route='POST /api/subs/:id/payments' AND path=?")
  .all(`/api/subs/${s.id}/payments`).map(r => { let b = {}; try { b = JSON.parse(r.body); } catch { /* */ } return { id: r.id, amount_cents: Number(b.amount_cents) || r.amount_cents || 0, by: r.user_id, first_by: r.first_by, created_at: r.created_at, stage: b.stage || '' }; });

function plan(db, s) {
  const agreed = s.agreed_cents || 0;
  const kind = PLANS.includes(s.pay_plan) ? s.pay_plan : suggested(db, agreed);
  const tasks = subTasks(db, s);
  const done = tasks.filter(t => t.status === 'hecho').length;
  const jobOn = !!db.prepare("SELECT 1 FROM jobs WHERE id=? AND status IN ('activo','terminado')").get(s.job_id);
  const jobDone = !!db.prepare("SELECT 1 FROM jobs WHERE id=? AND status='terminado'").get(s.job_id);
  // Sin tareas ligadas: empieza cuando la obra está activa y termina cuando la obra se termina.
  const started = tasks.length ? tasks.some(t => t.status !== 'pendiente') : jobOn;
  const finished = tasks.length ? done === tasks.length : jobDone;
  const autoPct = tasks.length ? Math.round(done * 100 / tasks.length) : 0;
  const pct = s.progress_pct != null ? s.progress_pct : autoPct;
  const paid = db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM sub_payments WHERE sub_id=?').get(s.id).v;
  const pending = pendingOf(db, s);
  const waiting = pending.reduce((a, p) => a + p.amount_cents, 0);
  let stages;
  if (kind === '50_50') {
    const a = Math.round(agreed / 2);
    stages = [{ key: 'inicio', pct: 50, amount_cents: a, ready: !!started }, { key: 'final', pct: 50, amount_cents: agreed - a, ready: finished }];
  } else if (kind === 'final') stages = [{ key: 'final', pct: 100, amount_cents: agreed, ready: finished }];
  else stages = [{ key: 'avance', pct, amount_cents: Math.round(agreed * pct / 100), ready: pct > 0 }];
  // Lo pagado y lo que espera autorización se aplican en orden a las etapas.
  let pool = paid + waiting, due = 0, next = null;
  for (const st of stages) {
    const covered = Math.min(st.amount_cents, pool); pool -= covered;
    st.covered_cents = covered; st.left_cents = st.amount_cents - covered;
    if (st.left_cents > 0 && st.ready) due += st.left_cents;
    if (!next && st.left_cents > 0) next = st;
  }
  const p = db.prepare('SELECT w9_file FROM sub_papers WHERE key=?').get(keyOf(s));
  return { plan: kind, chosen: PLANS.includes(s.pay_plan), suggested: suggested(db, agreed), small_cents: smallCents(db), dual: dualOn(db),
    agreed_cents: agreed, paid_cents: paid, waiting_cents: waiting, owed_cents: agreed - paid, due_now_cents: due,
    tasks_total: tasks.length, tasks_done: done, auto_pct: autoPct, pct, pct_manual: s.progress_pct != null,
    stages, next: next && { key: next.key, pct: next.pct, amount_cents: next.left_cents, ready: next.ready }, awaiting: pending, w9: !!(p && p.w9_file) };
}

function routes(db, add, h) {
  const { requireRole, fail, intId, jobOr404, oneOf } = h;
  const subOr404 = (user, id) => { const s = db.prepare('SELECT * FROM subs WHERE id=?').get(intId(id)); if (!s) fail(404, 'No encontrado'); jobOr404(db, user, s.job_id); return s; };
  add('GET', '/api/subs/:id/pay-plan', ({ user, params }) => { requireRole(user, 'owner'); return plan(db, subOr404(user, params.id)); });
  add('PUT', '/api/subs/:id/pay-plan', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const s = subOr404(user, params.id);
    const p = body.plan === '' || body.plan == null ? '' : oneOf(body.plan, PLANS, 'plan de pago');
    let pct = s.progress_pct;
    if ('progress_pct' in body) { pct = body.progress_pct === '' || body.progress_pct == null ? null : Math.round(Number(body.progress_pct)); if (pct != null && !(pct >= 0 && pct <= 100)) fail(400, 'El avance va de 0% a 100%'); }
    db.prepare('UPDATE subs SET pay_plan=?, progress_pct=? WHERE id=?').run(p, pct, s.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,'editar','plan de pago a sub',?,?,?)").run(user.pmId || user.id, s.id, s.job_id, `Plan de pago de ${s.name}: ${p || 'sugerido'}${pct != null ? ` · avance ${pct}%` : ''}`);
    return plan(db, db.prepare('SELECT * FROM subs WHERE id=?').get(s.id));
  });
  // Ajustes de la compañía: monto de "trabajo chico" y si cada pago lo autorizan los dos dueños.
  add('GET', '/api/sub-pay/settings', ({ user }) => { requireRole(user, 'owner'); return { small_cents: smallCents(db), dual: dualOn(db) }; });
  add('PUT', '/api/sub-pay/settings', ({ user, body }) => {
    requireRole(user, 'owner'); if (user.isPm) fail(403, 'Esto solo lo pueden cambiar los dueños');
    if ('small_cents' in body) { const v = Math.round(Number(body.small_cents)); if (!(v >= 0 && v <= 100000000)) fail(400, 'Monto inválido'); setMeta(db, 'sub_small_cents', v); }
    if ('dual' in body) setMeta(db, 'sub_pay_dual', body.dual === false || body.dual === '0' ? '0' : '1');
    db.prepare("INSERT INTO audit_log(user_id,action,entity,summary) VALUES(?,'editar','ajustes de pagos a subs',?)").run(user.id, `Trabajo chico: ${(smallCents(db) / 100).toFixed(2)} · dos dueños: ${dualOn(db) ? 'sí' : 'no'}`);
    return { small_cents: smallCents(db), dual: dualOn(db) };
  });
  // Lo que toca pagar a subs en todas las obras (para Inicio y Dinero).
  add('GET', '/api/sub-pay/due', ({ user }) => {
    requireRole(user, 'owner');
    const out = [];
    for (const s of db.prepare("SELECT s.* FROM subs s JOIN jobs j ON j.id=s.job_id WHERE j.status IN ('activo','terminado') AND s.agreed_cents>0").all()) {
      try { jobOr404(db, user, s.job_id); } catch { continue; }
      const p = plan(db, s);
      if (p.due_now_cents > 0) out.push({ sub_id: s.id, job_id: s.job_id, name: s.name, client_name: (db.prepare('SELECT client_name FROM jobs WHERE id=?').get(s.job_id) || {}).client_name, plan: p.plan, stage: p.next && p.next.key, due_now_cents: p.due_now_cents, w9: p.w9 });
    }
    return out;
  });
}
module.exports = { PLANS, plan, routes, dualOn, smallCents, suggested };
