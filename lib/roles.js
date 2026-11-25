'use strict';
// Fase 7 — Puestos y permisos.
//  - Administración ("admin"): oficina. Registra tickets y gastos generales de la compañía; escanea tickets y los archiva.
//    No ve precios de contrato, ganancias, pagos del cliente ni pagos a subs; no aprueba nada; no borra ni cambia
//    lo ya registrado (eso lo hace un dueño). No puede registrar un reembolso a su nombre.
//    Con el permiso "gastos_obras" ve también la lista de gastos de las obras.
//  - Contadora ("accountant"): solo ver y bajar. Gastos, tickets, ganancia por tipo, exportes y el reporte 1099.
//    No puede cambiar nada. Con el permiso "reparto" ve también el reparto de ganancia entre socios.
//  - Los dos entran "como dueño" pero marcados (isOffice) y solo a las rutas de su lista. Lo que no está en la lista: 403.
//  - Permisos por persona (columna tools): ventas (dueño, PM), cuadrilla (trabajador/sub: encargado de cuadrilla),
//    gastos_obras (administración), reparto (contadora). "Ve todas las obras" del PM es la columna pm_all.
const PERSONAL = ['GET /api/status', 'POST /api/logout', 'POST /api/me/lang', 'POST /api/me/password', 'POST /api/me/mfa/start', 'POST /api/me/mfa/confirm',
  'POST /api/me/mfa/disable', 'GET /api/push/latest', 'GET /api/push/key', 'POST /api/push/subscribe', 'POST /api/push/unsubscribe', 'POST /api/push/test',
  'GET /api/notifications', 'GET /api/catalog', 'GET /api/digest', 'PUT /api/digest/settings', 'GET /api/agent/manual', 'GET /api/plan', 'POST /api/plan/items', 'PUT /api/plan/items/:id', 'DELETE /api/plan/items/:id'];
const ADMIN = new Set([...PERSONAL,
  'GET /api/company-expenses', 'POST /api/company-expenses',
  'GET /api/receipts', 'POST /api/receipts', 'GET /api/receipts/:id/file', 'GET /api/receipts/settings',
  'GET /api/scans', 'POST /api/scans', 'GET /api/scans/status', 'GET /api/scans/:id/file', 'POST /api/scans/:id/file', 'POST /api/scans/:id/discard', 'POST /api/scans/:id/move',
  'GET /api/jobs', 'GET /api/expenses', 'GET /api/materials', 'GET /api/materials/:id', 'GET /api/materials/:id/image']);
const ACCOUNTANT = new Set([...PERSONAL,
  'GET /api/company-expenses', 'GET /api/receipts', 'GET /api/receipts/:id/file', 'GET /api/expenses', 'GET /api/accounting.csv', 'GET /api/export/:kind',
  'GET /api/reports/profit', 'GET /api/reports/trades', 'GET /api/reports/split', 'GET /api/papers', 'GET /api/papers-1099', 'GET /api/papers-file/:name', 'GET /api/jobs', 'GET /api/office']);
ADMIN.add('GET /api/office');
['GET /api/company-docs', 'GET /api/company-docs/:id/file'].forEach(k => { ADMIN.add(k); ACCOUNTANT.add(k); });
['GET /api/month-close', 'GET /api/month-close/zip'].forEach(k => ACCOUNTANT.add(k));
['GET /api/inventory', 'GET /api/inventory/:id/history', 'GET /api/inventory/:id/:what'].forEach(k => { ADMIN.add(k); ACCOUNTANT.add(k); });
['POST /api/inventory', 'PUT /api/inventory/:id', 'POST /api/inventory/:id/move', 'POST /api/inventory/:id/seen'].forEach(k => ADMIN.add(k));
['GET /api/expenses/review', 'POST /api/expenses/:id/reviewed', 'GET /api/jobs/:id/selections', 'GET /api/selections/pending'].forEach(k => ADMIN.add(k));
['POST /api/company-docs', 'PUT /api/company-docs/:id'].forEach(k => ADMIN.add(k));

// Permisos por persona: cuáles existen y a qué puesto le tocan.
const PERMS = { ventas: ['owner', 'pm'], cuadrilla: ['worker'], gastos_obras: ['admin'], reparto: ['accountant'] };
const TOOLS = Object.keys(PERMS);
const has = (u, k) => String((u && u.tools) || '').split(',').includes(k);
const isOffice = u => !!u && (u.role === 'admin' || u.role === 'accountant');

function enter(db, key, ctx, fail) {
  const u = ctx.user;
  if (!isOffice(u)) return ctx;
  const allow = u.role === 'admin' ? ADMIN : ACCOUNTANT;
  if (!allow.has(key)) fail(403, 'Esto no es parte de su puesto');
  if (u.role === 'admin' && key === 'GET /api/expenses' && !has(u, 'gastos_obras')) fail(403, 'Esto no es parte de su puesto');
  if (u.role === 'accountant' && key === 'GET /api/reports/split' && !has(u, 'reparto')) fail(403, 'Esto no es parte de su puesto');
  if (u.role === 'admin' && key === 'POST /api/receipts' && ctx.body && ctx.body.pay_method === 'propio') fail(403, 'Un reembolso a su nombre lo registra un dueño');
  if (u.role === 'admin' && key === 'POST /api/receipts' && ctx.body && ctx.body.dup_reason) fail(403, 'Un ticket repetido solo lo puede guardar un dueño');
  if (key === 'GET /api/office' || key === 'GET /api/status' || key === 'POST /api/logout') return ctx;
  // Lo personal (idioma, contraseña, avisos, su plan): se maneja como un vendedor, que solo puede lo suyo.
  if (PERSONAL.includes(key)) return { ...ctx, user: { ...u, role: 'sales', isOffice: true, office: u.role, officeId: u.id } };
  return { ...ctx, user: { ...u, role: 'owner', isOffice: true, office: u.role, officeId: u.id } };
}

// Lo que regresa una consulta: la oficina no ve precios ni ganancias de las obras.
function filter(db, key, user, res) {
  if (!user || !user.isOffice || res == null) return res;
  if (key === 'GET /api/jobs' && Array.isArray(res) && user.office === 'admin')
    return res.map(j => ({ id: j.id, client_name: j.client_name, address: j.address, project_type: j.project_type, status: j.status, start_date: j.start_date, end_date: j.end_date }));
  return res;
}

function routes(db, add, h) {
  const { fail } = h;
  // Inicio de la oficina: lo que le toca hoy.
  add('GET', '/api/office', ({ user }) => {
    if (!isOffice(user)) fail(403, 'Esto no es parte de su puesto');
    const month = new Date().toISOString().slice(0, 7);
    const out = { role: user.role, perms: String(user.tools || '').split(',').filter(Boolean) };
    out.scans_waiting = db.prepare("SELECT COUNT(*) n FROM scans WHERE status='por_asignar'").get().n;
    out.receipts_month = db.prepare('SELECT COUNT(*) n FROM receipts WHERE substr(date,1,7)=?').get(month).n;
    out.company_month_cents = db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM company_expenses WHERE substr(date,1,7)=?').get(month).v;
    if (user.role === 'admin') out.mine_month = db.prepare('SELECT COUNT(*) n FROM receipts WHERE created_by=? AND substr(date,1,7)=?').get(user.id, month).n;
    return out;
  });
}

module.exports = { enter, filter, routes, PERMS, TOOLS, has, isOffice, ADMIN, ACCOUNTANT };
