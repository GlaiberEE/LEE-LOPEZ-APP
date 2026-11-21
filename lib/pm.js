'use strict';
// Rol PROJECT MANAGER (o cualquier autoridad intermedia) con controles y contrapesos:
//  - Solo ve y maneja las obras que los dueños le asignan.
//  - Puede registrar y organizar (tareas, fotos, casos, reportes, gastos chicos, pagos recibidos de clientes).
//  - NO puede mover dinero por su cuenta: pagar a subs, cambiar precios, aprobar change orders, borrar o cambiar
//    registros de dinero, cambiar presupuestos. Todo eso queda como SOLICITUD que autoriza un dueño.
//  - Límite por gasto y límite al mes (los pone cada dueño). Arriba del límite → solicitud.
//  - Nada que lo beneficie: reembolsos a su nombre, subs "relacionados" con él, su propio usuario → solicitud.
//  - Detecta gastos partidos (varios del mismo día y tienda que juntos pasan el límite).
//  - No ve cuentas de la empresa, reportes, proyecciones, usuarios, ajustes, ni el historial completo.

// Qué rutas puede usar. 'raw' = con su propio usuario (status, su cuenta). 'owner' = como dueño, limitado a sus obras.
const RAW = new Set([...require('./sales').SALES_KEYS, 'GET /api/agent/manual', 'POST /api/pm/notes', 'GET /api/pm/daily', 'GET /api/status', 'POST /api/logout', 'POST /api/me/lang', 'POST /api/me/password', 'POST /api/me/mfa/start', 'POST /api/me/mfa/confirm', 'POST /api/me/mfa/disable', 'GET /api/push/latest']);
const AS_OWNER = new Set(['GET /api/jobs/:id/lines', 'POST /api/jobs/:id/lines', 'PUT /api/lines/:id', 'DELETE /api/lines/:id', 'PUT /api/expenses/:id/line', 'PUT /api/subs/:id/line', 'GET /api/margin-alerts', 'GET /api/catalog', 'GET /api/push/key', 'POST /api/push/subscribe', 'POST /api/push/unsubscribe', 'POST /api/push/test', 'GET /api/notifications',
  'GET /api/jobs', 'POST /api/jobs', 'GET /api/jobs/:id', 'PUT /api/jobs/:id', 'GET /api/jobs/:id/pdf', 'GET /api/jobs/:id/updates', 'POST /api/jobs/:id/updates', 'DELETE /api/updates/:id',
  'POST /api/jobs/:id/tasks', 'PUT /api/tasks/:id', 'DELETE /api/tasks/:id', 'POST /api/tasks/:id/move', 'POST /api/tasks/:id/reschedule',
  'GET /api/calendar', 'GET /api/notices', 'POST /api/notices/:id/accept', 'POST /api/notices/:id/close', 'GET /api/contacts/owners',
  'POST /api/jobs/:id/photos', 'DELETE /api/files/:id',
  'GET /api/expenses', 'POST /api/jobs/:id/expenses', 'PUT /api/expenses/:id', 'DELETE /api/expenses/:id',
  'POST /api/jobs/:id/subs', 'PUT /api/subs/:id', 'DELETE /api/subs/:id', 'GET /api/subs/:id/payments', 'POST /api/subs/:id/payments', 'DELETE /api/sub-payments/:id',
  'POST /api/jobs/:id/changes', 'PUT /api/changes/:id', 'DELETE /api/changes/:id',
  'POST /api/jobs/:id/payments', 'DELETE /api/payments/:id', 'GET /api/jobs/:id/statement', 'GET /api/jobs/:id/statement/pdf', 'GET /api/jobs/:id/signing',
  'GET /api/docs', 'GET /api/docs/:id/pdf', 'POST /api/docs/:id/decide', 'POST /api/docs/:id/unlock-decide', 'PUT /api/docs/:id', 'POST /api/docs/:id/paid',
  'GET /api/issues', 'GET /api/issues/:id', 'POST /api/issues', 'POST /api/issues/:id/messages', 'POST /api/issues/:id/resolve', 'POST /api/issues/:id/reopen', 'POST /api/issues/:id/worker',
  'GET /api/jobs/:id/logs', 'POST /api/jobs/:id/logs', 'DELETE /api/logs/:id',
  'GET /api/jobs/:id/permits', 'POST /api/jobs/:id/permits', 'PUT /api/permits/:id', 'DELETE /api/permits/:id',
  'GET /api/jobs/:id/budget', 'PUT /api/jobs/:id/budget', 'PUT /api/jobs/:id/location',
  'GET /api/scans', 'GET /api/scans/status', 'POST /api/scans', 'POST /api/scans/:id/file', 'POST /api/scans/:id/move', 'POST /api/scans/:id/discard', 'GET /api/scans/:id/file',
  'GET /api/materials', 'GET /api/materials/:id', 'GET /api/materials/:id/image', 'POST /api/materials', 'PUT /api/materials/:id', 'GET /api/jobs/:id/materials', 'POST /api/jobs/:id/materials', 'DELETE /api/job-materials/:id', 'GET /api/jobs/:id/gallery', 'PUT /api/files/:id/gallery',
  'GET /api/board', 'POST /api/tasks/:id/notify', 'GET /api/plan/status', 'POST /api/jobs/:id/plan/draft', 'POST /api/jobs/:id/plan/apply', 'GET /api/plan-templates', 'POST /api/plan-templates',
  'GET /api/users', 'GET /api/change-requests', 'POST /api/change-requests/:id/cancel', 'GET /api/signatures/:id/image',
]);

// Un PM ve las obras que tiene asignadas; un "operador" (por ejemplo, un agente de AI de operaciones) puede tener todas.
const pmAll = (db, uid) => !!(db.prepare('SELECT pm_all FROM users WHERE id=?').get(uid) || {}).pm_all;
const pmJobs = (db, uid) => new Set((pmAll(db, uid) ? db.prepare('SELECT id FROM jobs').all() : db.prepare('SELECT id FROM jobs WHERE pm_id=?').all(uid)).map(r => r.id));
const usd = c => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const norm = s => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Antes de la ruta: ¿puede usarla? Si sí, actúa "como dueño" pero marcado como PM (canSeeJob lo limita a sus obras).
function enter(db, key, ctx, fail) {
  const u = ctx.user;
  if (!u || u.role !== 'pm') return ctx;
  if (RAW.has(key)) return ctx;
  if (!AS_OWNER.has(key)) fail(403, 'Esto solo lo pueden hacer los dueños');
  return { ...ctx, user: { ...u, role: 'owner', isPm: true, pmId: u.id } };
}

// Después de una consulta: quitar lo que no es de sus obras.
function filter(db, key, user, res) {
  if (!user || !user.isPm || res == null) return res;
  const mine = pmJobs(db, user.pmId);
  if (key === 'GET /api/jobs' && Array.isArray(res)) return res.filter(j => mine.has(j.id));
  if (key === 'GET /api/users' && Array.isArray(res)) return res.filter(u => ['worker', 'pm'].includes(u.role) && u.active).map(({ id, name, role, trade, phone, lang, active }) => ({ id, name, role, trade, phone, lang, active }));
  if (key === 'GET /api/scans' && Array.isArray(res)) return res.filter(s => (s.job_id && mine.has(s.job_id)) || s.created_by === user.pmId);
  if (key === 'GET /api/change-requests' && res.to_approve) return { to_approve: [], mine: res.mine, recent: res.recent.filter(r => r.user_id === user.pmId) };
  const keep = x => !(x && typeof x === 'object' && 'job_id' in x) || mine.has(x.job_id);
  if (Array.isArray(res)) return res.filter(keep);
  return res;
}

// Reglas de dinero para el PM: regresa { summary, amount } si necesita autorización de un dueño, o null si puede seguir.
function rule(db, key, ctx, fail) {
  const u = ctx.user; if (!u || !u.isPm || ctx.approved) return null;
  const { params = {}, body = {} } = ctx;
  const pm = db.prepare('SELECT * FROM users WHERE id=?').get(u.pmId);
  const lim = pm.pm_limit_cents, cap = pm.pm_month_cents;
  const relatedUser = uid => uid && (uid === pm.id || (db.prepare('SELECT related_pm_id FROM users WHERE id=?').get(uid) || {}).related_pm_id === pm.id);
  const job = id => db.prepare('SELECT * FROM jobs WHERE id=?').get(Number(id)) || {};
  const expenseCheck = (amount, vendor, date, extra = {}) => {
    const why = [];
    if (extra.sub_id) why.push('es un pago a un sub');
    if (amount > lim) why.push(`es mayor que su límite por gasto (${usd(lim)})`);
    const month = db.prepare("SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE created_by=? AND substr(created_at,1,7)=substr(datetime('now'),1,7)").get(pm.id).v;
    if (month + amount > cap) why.push(`pasa su límite del mes (${usd(cap)}; lleva ${usd(month)})`);
    if (extra.reimburse === true || extra.reimburse === 'si' || extra.reimburse === 1) why.push('es un reembolso a su propio nombre (lo pagó con su dinero)');
    if (extra.category === 'mano_obra') why.push('es mano de obra');
    if (vendor && amount <= lim) {
      const same = db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE created_by=? AND date=? AND lower(vendor)=lower(?)').get(pm.id, date || '', vendor).v;
      if (same + amount > lim) why.push(`junto con otros gastos del mismo día en ${vendor} pasa su límite (posible gasto partido)`);
    }
    return why;
  };
  const req = (summary, amount, why) => ({ summary, amount, why });
  switch (key) {
    case 'POST /api/jobs/:id/expenses': {
      const a = Math.round(Number(body.amount_cents) || 0);
      const why = expenseCheck(a, body.vendor, body.date, body);
      return why.length ? req(`Gasto ${usd(a)} "${body.description || ''}" en ${job(params.id).client_name || ''}`, a, why) : null;
    }
    case 'POST /api/scans/:id/file': {
      const a = Math.round(Number(body.amount_cents) || 0);
      const why = expenseCheck(a, body.vendor, body.date, body);
      return why.length ? req(`Gasto de ticket ${usd(a)} ${body.vendor || ''}`, a, why) : null;
    }
    case 'POST /api/subs/:id/payments': {
      const s = db.prepare('SELECT * FROM subs WHERE id=?').get(Number(params.id)) || {};
      return req(`Pago a ${s.name} ${usd(Number(body.amount_cents) || 0)} (${body.method || ''}${body.reference ? ' ' + body.reference : ''})`, Number(body.amount_cents) || 0, ['los pagos a subs los autoriza un dueño']);
    }
    case 'POST /api/jobs/:id/subs': {
      const a = Math.round(Number(body.agreed_cents) || 0);
      const why = [];
      if (a > 0) why.push('compromete dinero (total acordado)');
      if (relatedUser(Number(body.user_id) || null)) why.push('el sub está relacionado con usted');
      return why.length ? req(`Agregar a ${body.name} con acordado ${usd(a)}`, a, why) : null;
    }
    case 'PUT /api/subs/:id': case 'DELETE /api/subs/:id': {
      const s = db.prepare('SELECT * FROM subs WHERE id=?').get(Number(params.id)) || {};
      if (key.startsWith('PUT') && !('agreed_cents' in body) && !('user_id' in body)) return null;
      return req(`${key.startsWith('PUT') ? 'Cambiar' : 'Quitar'} acuerdo con ${s.name}`, s.agreed_cents || 0, ['los acuerdos con subs los autoriza un dueño']);
    }
    case 'POST /api/jobs/:id/changes':
      return body.status === 'aprobado' ? req(`Change order aprobado "${body.description}" ${usd(Number(body.price_cents) || 0)}`, Number(body.price_cents) || 0, ['aprobar un change order cambia el contrato']) : null;
    case 'PUT /api/changes/:id': {
      const c = db.prepare('SELECT * FROM change_orders WHERE id=?').get(Number(params.id)) || {};
      if (body.status === 'aprobado' && c.status !== 'aprobado') return req(`Aprobar change order "${c.description}" ${usd(c.price_cents)}`, c.price_cents, ['aprobar un change order cambia el contrato']);
      return null;
    }
    case 'PUT /api/jobs/:id': {
      if ('pm_id' in body) fail(403, 'Solo los dueños asignan project managers');
      const j = job(params.id);
      const why = [];
      if ('quoted_cents' in body && Number(body.quoted_cents) !== j.quoted_cents) why.push('cambia el precio de la obra');
      if ('client_user_id' in body && (Number(body.client_user_id) || null) !== (j.client_user_id || null)) why.push('cambia el acceso del cliente');
      if (body.status === 'cancelado' && j.status !== 'cancelado') why.push('cancela la obra');
      return why.length ? req(`Cambios en la obra ${j.client_name}`, Math.abs((Number(body.quoted_cents) || j.quoted_cents) - j.quoted_cents), why) : null;
    }
    case 'POST /api/docs/:id/decide': {
      if (body.action !== 'accept') return null;
      const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(Number(params.id)) || {};
      const why = [];
      if (d.total_cents > lim) why.push(`es mayor que su límite (${usd(lim)})`);
      if (relatedUser(d.sub_user_id)) why.push('el sub está relacionado con usted');
      if (body.paid) why.push('lo marca como pagado');
      return why.length ? req(`Aprobar ${d.type === 'invoice' ? 'invoice' : 'estimado'} ${d.number} por ${usd(d.total_cents)}`, d.total_cents, why) : null;
    }
    case 'POST /api/docs/:id/unlock-decide': case 'PUT /api/docs/:id': {
      const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(Number(params.id)) || {};
      return req(`${key.startsWith('PUT') ? 'Corregir' : 'Permiso para corregir'} ${d.number} (${usd(d.total_cents)})`, d.total_cents, ['cambiar un documento ya aceptado lo autoriza un dueño']);
    }
    case 'POST /api/docs/:id/paid': {
      const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(Number(params.id)) || {};
      return req(`Marcar pagado el invoice ${d.number} (${usd(d.total_cents)})`, d.total_cents, ['los pagos a subs los autoriza un dueño']);
    }
    case 'PUT /api/jobs/:id/budget':
      return req(`Cambiar el presupuesto de ${job(params.id).client_name}`, 0, ['el presupuesto lo autoriza un dueño']);
    default: return null;
  }
}

// Después de crear una obra, queda asignada al PM que la creó.
function afterCreate(db, key, ctx, res) {
  if (ctx.user && ctx.user.isPm && key === 'POST /api/jobs' && res && res.id) db.prepare('UPDATE jobs SET pm_id=? WHERE id=?').run(ctx.user.pmId, res.id);
}

// Para los dueños: qué han hecho los PMs y señales de alerta.
function activity(db) {
  return db.prepare("SELECT * FROM users WHERE role='pm' AND is_agent=0 ORDER BY active DESC, name").all().map(pm => {
    const exp = db.prepare("SELECT * FROM expenses WHERE created_by=? AND created_at >= datetime('now','-30 days')").all(pm.id);
    const near = exp.filter(e => e.amount_cents >= pm.pm_limit_cents * 0.9 && e.amount_cents <= pm.pm_limit_cents).length;
    const self = exp.filter(e => e.reimburse).length;
    const month = db.prepare("SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE created_by=? AND substr(created_at,1,7)=substr(datetime('now'),1,7)").get(pm.id).v;
    const reqs = db.prepare("SELECT status, COUNT(*) n FROM change_requests WHERE user_id=? AND created_at >= datetime('now','-30 days') GROUP BY status").all(pm.id);
    const approvedDocs = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) v FROM sub_docs WHERE decided_by=? AND status IN ('aceptado','aprobado') AND decided_at >= datetime('now','-30 days')").get(pm.id);
    const flags = [];
    if (near >= 3) flags.push({ kind: 'near_limit', n: near });
    if (self > 0) flags.push({ kind: 'self', n: self });
    if (month > pm.pm_month_cents * 0.8) flags.push({ kind: 'month', v: month });
    const rej = (reqs.find(r => r.status === 'rechazado') || {}).n || 0;
    if (rej >= 2) flags.push({ kind: 'rejected', n: rej });
    return { id: pm.id, name: pm.name, active: !!pm.active, limit_cents: pm.pm_limit_cents, month_cap_cents: pm.pm_month_cents, month_spent_cents: month,
      jobs: db.prepare("SELECT id, client_name FROM jobs WHERE pm_id=? AND status NOT IN ('cancelado','terminado')").all(pm.id),
      expenses_30d: { n: exp.length, total_cents: exp.reduce((a, e) => a + e.amount_cents, 0) }, docs_approved_30d: approvedDocs,
      requests_30d: Object.fromEntries(reqs.map(r => [r.status, r.n])), flags };
  });
}

module.exports = { enter, filter, rule, afterCreate, activity, pmJobs, RAW, AS_OWNER };
