'use strict';
// v2.31 — Seguridad y dinero: una sola regla para todo gasto y la regla de dos dueños sin huecos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { totpAt } = require('../lib/auth');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-v231-'));
  server = createServer({ dataDir: dir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); server.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), cookie: sc };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const g = client(), jack = client(), pedro = client(), pedro2 = client();
let job, jackId, pedroId;
const db = () => server.db;
const code = secret => totpAt(secret, Math.floor(Date.now() / 30000));

test('preparación: con un solo dueño se puede crear el segundo', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  const j = await g.post('/api/users', { name: 'Jack', username: 'jack', password: 'contrasena-j-123', role: 'owner' });
  assert.ok(j.data.id, 'el primer socio se agrega directo');
  jackId = j.data.id;
  pedroId = (await g.post('/api/users', { name: 'Pedro', username: 'pedro', password: 'contrasena-pedro', role: 'worker' })).data.id;
  await jack.post('/api/login', { username: 'jack', password: 'contrasena-j-123' });
  await pedro.post('/api/login', { username: 'pedro', password: 'contrasena-pedro' });
  job = (await g.post('/api/jobs', { template: 'base', client_name: 'Thompson', address: '1 Oak', project_type: 'otro', status: 'activo' })).data.id;
  const t = (await g.get(`/api/jobs/${job}`)).data.tasks;
  await g.put(`/api/tasks/${t[0].id}`, { assignee_id: pedroId });
});

test('un dueño solo ya no crea otro dueño', async () => {
  const r = await g.post('/api/users', { name: 'Fantasma', username: 'fantasma', password: 'contrasena-f-123', role: 'owner' });
  assert.ok(r.data.pending, 'queda esperando al otro dueño');
  assert.ok(!db().prepare("SELECT 1 FROM users WHERE username='fantasma'").get(), 'no se creó');
  const req = db().prepare('SELECT body FROM change_requests WHERE id=?').get(r.data.request_id);
  assert.ok(!/contrasena-f-123/.test(req.body), 'la contraseña no queda guardada en la solicitud');
  await g.post(`/api/change-requests/${r.data.request_id}/cancel`);
});

test('un dueño no cambia la contraseña ni desactiva al otro', async () => {
  assert.equal((await g.put(`/api/users/${jackId}`, { password: 'otra-contrasena-1' })).status, 403);
  const r = await g.put(`/api/users/${jackId}`, { active: false });
  assert.ok(r.data.pending);
  assert.equal(db().prepare('SELECT active FROM users WHERE id=?').get(jackId).active, 1);
  await g.post(`/api/change-requests/${r.data.request_id}/cancel`);
});

test('change order de $1,000 o más: lo autorizan los dos dueños', async () => {
  const small = await g.post(`/api/jobs/${job}/changes`, { description: 'Luz extra', price_cents: 50000, status: 'aprobado' });
  assert.ok(small.data.id && !small.data.pending, 'uno chico pasa directo');
  const big = await g.post(`/api/jobs/${job}/changes`, { description: 'Cocina exterior', price_cents: 250000, status: 'aprobado' });
  assert.ok(big.data.pending, 'uno grande espera');
  assert.equal((await jack.post(`/api/change-requests/${big.data.request_id}/decide`, { action: 'approve' })).data.status, 'aprobado');
  // Aprobar después uno que estaba pendiente también.
  const p = (await g.post(`/api/jobs/${job}/changes`, { description: 'Pérgola', price_cents: 180000 })).data;
  const ap = await g.put(`/api/changes/${p.id}`, { status: 'aprobado' });
  assert.ok(ap.data.pending);
  assert.equal(db().prepare('SELECT status FROM change_orders WHERE id=?').get(p.id).status, 'pendiente');
});

test('apagar la doble firma de pagos a subs necesita al otro dueño', async () => {
  const r = await g.put('/api/sub-pay/settings', { dual: false });
  assert.ok(r.data.pending);
  assert.equal((await g.get('/api/sub-pay/settings')).data.dual, true);
});

test('el sub: periodo cerrado, bitácora y "por revisar"', async () => {
  await g.put('/api/lock', { date: '2026-10-31' });
  const closed = await pedro.post(`/api/jobs/${job}/expenses`, { date: '2026-10-20', category: 'material', description: 'Tornillos', amount_cents: 2500 });
  assert.equal(closed.status, 423, 'un sub no registra en un mes cerrado');
  const ok = await pedro.post(`/api/jobs/${job}/expenses`, { date: '2026-11-20', category: 'material', description: 'Tornillos', amount_cents: 2500, reimburse: true });
  assert.ok(ok.data.id);
  assert.ok(db().prepare("SELECT 1 FROM audit_log WHERE action='crear' AND entity='gasto' AND user_id=?").get(pedroId), 'queda en la bitácora');
  const rev = (await g.get('/api/expenses/review')).data;
  assert.ok(rev.some(e => e.id === ok.data.id && e.reimburse), 'queda por revisar y se ve que pide reembolso');
  assert.equal((await pedro.get('/api/expenses/review')).status, 403);
  await g.post(`/api/expenses/${ok.data.id}/reviewed`);
  assert.equal(db().prepare('SELECT review FROM expenses WHERE id=?').get(ok.data.id).review, 0);
});

test('autorizar pide el código a quien tiene verificación en dos pasos', async () => {
  const s = (await jack.post('/api/me/mfa/start')).data;
  await jack.post('/api/me/mfa/confirm', { code: code(s.secret) });
  const big = await g.post(`/api/jobs/${job}/changes`, { description: 'Chimenea', price_cents: 300000, status: 'aprobado' });
  const noCode = await jack.post(`/api/change-requests/${big.data.request_id}/decide`, { action: 'approve' });
  assert.equal(noCode.status, 428); assert.ok(noCode.data.needCode);
  assert.equal((await jack.post(`/api/change-requests/${big.data.request_id}/decide`, { action: 'approve', code: '000001' })).status, 400);
  assert.equal((await jack.post(`/api/change-requests/${big.data.request_id}/decide`, { action: 'approve', code: code(s.secret) })).data.status, 'aprobado');
});

test('exigir verificación: sin ella no se autoriza; apagarla necesita al otro dueño', async () => {
  assert.equal((await g.put('/api/security', { mfa_required: true })).status, 400, 'primero la propia');
  const s = (await jack.get('/api/security')).data; assert.equal(s.mfa_required, false);
  assert.equal((await jack.put('/api/security', { mfa_required: true })).data.mfa_required, true);
  const big = await jack.post(`/api/jobs/${job}/changes`, { description: 'Bar', price_cents: 150000, status: 'aprobado' });
  const r = await g.post(`/api/change-requests/${big.data.request_id}/decide`, { action: 'approve' });
  assert.equal(r.status, 403, 'Glaiber no tiene verificación: no autoriza');
  const off = await jack.put('/api/security', { mfa_required: false });
  assert.ok(off.data.pending, 'apagarlo lo autoriza el otro dueño');
});

test('cambiar la contraseña cierra las demás sesiones', async () => {
  await pedro2.post('/api/login', { username: 'pedro', password: 'contrasena-pedro' });
  assert.equal((await pedro2.get('/api/status')).data.user.name, 'Pedro');
  assert.equal((await pedro.post('/api/me/password', { current: 'contrasena-pedro', password: 'nueva-contrasena-p' })).data.ok, true);
  assert.equal((await pedro.get('/api/status')).data.user.name, 'Pedro', 'la sesión actual sigue');
  const other = (await pedro2.get('/api/status')).data;
  assert.ok(!other.user, 'la otra sesión se cerró');
});

test('sesiones: 7 días para quien maneja dinero, 30 para subs', async () => {
  const A = require('../lib/auth');
  assert.equal(A.daysFor('owner'), 7); assert.equal(A.daysFor('pm'), 7); assert.equal(A.daysFor('worker'), 30);
  const r = await client().post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  const age = Number(/Max-Age=(\d+)/.exec(r.cookie)[1]);
  assert.ok(age <= 7 * 86400 && age > 6 * 86400);
});
