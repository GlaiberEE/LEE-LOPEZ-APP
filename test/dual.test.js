'use strict';
// Doble autorización: cambios de más de $1,000 necesitan a los 2 dueños.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-dual-'));
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
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b) };
}
const glaiber = client(), jack = client(), sub = client();
let job, jackId;
const L = c => [{ desc: 'Trabajo', qty: 1, unit_cents: c }];
const money = async () => (await glaiber.get(`/api/jobs/${job}`)).data.money;
async function accepted(total, type = 'estimate') {
  const d = (await sub.post('/api/docs', { job_id: job, type, lines: L(total) })).data;
  await glaiber.post(`/api/docs/${d.id}/decide`, { action: 'accept' });
  return d.id;
}

test('preparación: un solo dueño todavía', async () => {
  await glaiber.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  const sid = (await glaiber.post('/api/users', { name: 'Sub', username: 'sub1', password: 'contrasena-sub1', role: 'worker' })).data.id;
  await sub.post('/api/login', { username: 'sub1', password: 'contrasena-sub1' });
  job = (await glaiber.post('/api/jobs', { template: 'base',  client_name: 'Smith', project_type: 'fire_pit', status: 'activo', quoted_cents: 2000000 })).data.id;
  const t = (await glaiber.get(`/api/jobs/${job}`)).data.tasks;
  await glaiber.put(`/api/tasks/${t[0].id}`, { assignee_id: sid });
});

test('con un solo dueño activo, basta su autorización (nadie se queda atorado)', async () => {
  const id = await accepted(250000);
  await sub.post(`/api/docs/${id}/unlock`, { reason: 'Cambio' });
  const r = await glaiber.post(`/api/docs/${id}/unlock-decide`, { action: 'authorize' });
  assert.equal(r.data.unlock, 'autorizado');
  assert.equal(r.data.approvals_needed, 1);
});

test('con Jack como segundo dueño: más de $1,000 necesita a los dos para dar permiso', async () => {
  jackId = (await glaiber.post('/api/users', { name: 'Jack', username: 'jack', password: 'contrasena-jack', role: 'owner' })).data.id;
  await jack.post('/api/login', { username: 'jack', password: 'contrasena-jack' });
  const id = await accepted(180000);
  await sub.post(`/api/docs/${id}/unlock`, { reason: 'Se me olvidó un renglón' });
  const g = await glaiber.post(`/api/docs/${id}/unlock-decide`, { action: 'authorize' });
  assert.equal(g.data.unlock, 'pedido', 'falta Jack');
  assert.deepEqual(g.data.unlock_ok_names, ['Glaiber']);
  assert.equal(g.data.approvals_needed, 2);
  assert.equal((await glaiber.post(`/api/docs/${id}/unlock-decide`, { action: 'authorize' })).status, 400, 'no puede autorizar dos veces');
  assert.equal((await sub.put(`/api/docs/${id}`, { lines: L(190000) })).status, 403, 'el sub todavía no puede cambiarlo');
  const pendG = (await glaiber.get('/api/status')).data.user.pending, pendJ = (await jack.get('/api/status')).data.user.pending;
  assert.ok(pendJ > pendG, 'a Jack le aparece pendiente; a Glaiber ya no');
  const j = await jack.post(`/api/docs/${id}/unlock-decide`, { action: 'authorize' });
  assert.equal(j.data.unlock, 'autorizado');
  // la corrección también necesita a los dos
  const m0 = await money();
  await sub.put(`/api/docs/${id}`, { lines: L(195000) });
  const a1 = await jack.post(`/api/docs/${id}/decide`, { action: 'accept' });
  assert.equal(a1.data.status, 'enviado', 'falta Glaiber'); assert.deepEqual(a1.data.corr_ok_names, ['Jack']);
  assert.equal((await money()).subsAgreed, m0.subsAgreed, 'nada cambia con una sola aprobación');
  assert.equal((await jack.post(`/api/docs/${id}/decide`, { action: 'accept' })).status, 400);
  const a2 = await glaiber.post(`/api/docs/${id}/decide`, { action: 'accept' });
  assert.equal(a2.data.status, 'aceptado');
  assert.equal((await money()).subsAgreed, m0.subsAgreed + 15000, 'con los dos, se aplica');
  const acts = a2.data.history.map(h => h.action);
  assert.ok(acts.includes('permiso_autorizado_1') && acts.includes('permiso_autorizado') && acts.includes('correccion_aprobada_1') && acts.includes('correccion_aprobada'));
});

test('un "no" de cualquiera de los dos basta', async () => {
  const id = await accepted(300000);
  await sub.post(`/api/docs/${id}/unlock`, { reason: 'Subir precio' });
  await glaiber.post(`/api/docs/${id}/unlock-decide`, { action: 'authorize' });
  const n = await jack.post(`/api/docs/${id}/unlock-decide`, { action: 'deny', note: 'No' });
  assert.equal(n.data.unlock, 'negado');
  assert.equal((await sub.put(`/api/docs/${id}`, { lines: L(400000) })).status, 403);
});

test('si un dueño corrige directo algo de más de $1,000, espera al otro dueño', async () => {
  const id = await accepted(150000, 'invoice');
  const m0 = await money();
  const r = await glaiber.put(`/api/docs/${id}`, { lines: L(120000), reason: 'Descuento acordado' });
  assert.equal(r.data.status, 'enviado'); assert.equal(r.data.prev.total_cents, 150000); assert.deepEqual(r.data.corr_ok_names, ['Glaiber']);
  assert.equal((await money()).spent, m0.spent, 'el gasto no cambia hasta que Jack apruebe');
  assert.equal((await glaiber.post(`/api/docs/${id}/decide`, { action: 'accept' })).status, 400, 'no se aprueba a sí mismo dos veces');
  const ok = await jack.post(`/api/docs/${id}/decide`, { action: 'accept' });
  assert.equal(ok.data.status, 'aprobado');
  assert.equal((await money()).spent, m0.spent - 30000, 'ya con los dos, el gasto baja $300');
});

test('si Jack rechaza la corrección de Glaiber, vuelve la versión aprobada', async () => {
  const id = await accepted(200000, 'invoice');
  const m0 = await money();
  await glaiber.put(`/api/docs/${id}`, { lines: L(260000) });
  const r = await jack.post(`/api/docs/${id}/decide`, { action: 'reject', note: 'No estamos de acuerdo' });
  assert.equal(r.data.status, 'aprobado'); assert.equal(r.data.total_cents, 200000);
  assert.equal((await money()).spent, m0.spent);
});

test('$1,000 o menos: basta un dueño', async () => {
  const id = await accepted(90000, 'invoice');
  const m0 = await money();
  const r = await glaiber.put(`/api/docs/${id}`, { lines: L(95000) });
  assert.equal(r.data.status, 'aprobado', 'se aplica directo');
  assert.equal((await money()).spent, m0.spent + 5000);
  // pero si el cambio lo lleva a más de $1,000, ya necesita a los dos
  const r2 = await glaiber.put(`/api/docs/${id}`, { lines: L(110000) });
  assert.equal(r2.data.status, 'enviado'); assert.equal(r2.data.approvals_needed, 2);
});

test('desactivar a Jack lo autoriza Jack; y desactivado, la regla no se salta', async () => {
  const r = await glaiber.put(`/api/users/${jackId}`, { active: false });
  assert.ok(r.data.pending, 'un dueño solo no desactiva al otro');
  const reqId = r.data.request_id;
  assert.equal((await jack.post(`/api/change-requests/${reqId}/decide`, { action: 'approve' })).data.status, 'aprobado');
  const id = await accepted(500000);
  await sub.post(`/api/docs/${id}/unlock`, { reason: 'x' });
  assert.notEqual((await glaiber.post(`/api/docs/${id}/unlock-decide`, { action: 'authorize' })).data.unlock, 'autorizado', 'con Jack desactivado no basta un dueño');
});
