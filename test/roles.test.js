'use strict';
// v2.26 — Puestos y permisos: Administración, Contadora, encargado de cuadrilla y permisos por persona.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-roles-'));
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
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json().catch(() => null) : await res.text() };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const g = client(), ofi = client(), cont = client(), luis = client(), pm = client();
let ids = {}, job;

test('preparación: los puestos nuevos se pueden crear', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  const mk = async (name, role, extra = {}) => { const r = await g.post('/api/users', { name, username: name.toLowerCase(), password: 'contrasena-' + name.toLowerCase(), role, ...extra }); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.id; };
  ids.ofi = await mk('Ofi', 'admin'); ids.cont = await mk('Cont', 'accountant'); ids.luis = await mk('Luis', 'worker'); ids.pm = await mk('Pema', 'pm');
  for (const [c, u] of [[ofi, 'ofi'], [cont, 'cont'], [luis, 'luis'], [pm, 'pema']]) assert.equal((await c.post('/api/login', { username: u, password: 'contrasena-' + u })).status, 200);
  job = (await g.post('/api/jobs', { client_name: 'Melbourne', project_type: 'patio_cover', status: 'activo', contract_cents: 2000000 })).data.id;
  await g.post(`/api/jobs/${job}/subs`, { name: 'Luis', user_id: ids.luis, agreed_cents: 1000 });
  assert.equal((await ofi.get('/api/status')).data.user.role, 'admin', 'el puesto se ve tal cual');
});

test('Administración: gastos de la compañía y tickets, sin dinero de las obras', async () => {
  assert.equal((await ofi.post('/api/company-expenses', { date: '2026-11-20', category: (await g.get('/api/catalog')).data.company_categories?.[0]?.key || 'oficina', description: 'Papel', amount_cents: 2500 })).status, 200);
  assert.equal((await ofi.get('/api/company-expenses')).status, 200);
  const jobs = (await ofi.get('/api/jobs')).data;
  assert.ok(jobs.length && !('money' in jobs[0]) && !('contract_cents' in jobs[0]), 'sin contrato ni ganancia');
  assert.equal((await ofi.get(`/api/jobs/${job}`)).status, 403);
  assert.equal((await ofi.get('/api/reports/profit')).status, 403);
  assert.equal((await ofi.get('/api/expenses')).status, 403, 'sin el permiso no ve gastos de obras');
  assert.equal((await ofi.post(`/api/subs/1/payments`, { amount_cents: 100 })).status, 403);
  assert.equal((await ofi.post('/api/receipts', { vendor: 'X', pay_method: 'propio', lines: [] })).status, 403, 'reembolso a su nombre: no');
  const ce = server.db.prepare('SELECT id FROM company_expenses LIMIT 1').get().id;
  assert.equal((await ofi.del(`/api/company-expenses/${ce}`)).status, 403, 'no borra');
  assert.equal((await ofi.post('/api/users', { name: 'X', username: 'xxx', role: 'owner' })).status, 403);
  // Con el permiso, ve los gastos de las obras.
  assert.equal((await g.put(`/api/users/${ids.ofi}`, { tools: ['gastos_obras'] })).status, 200);
  assert.equal((await ofi.get('/api/expenses')).status, 200);
  assert.equal((await ofi.get('/api/office')).status, 200);
});

test('Contadora: solo ver y bajar', async () => {
  for (const u of ['/api/company-expenses', '/api/receipts', '/api/expenses', '/api/reports/profit', '/api/accounting.csv', '/api/export/gastos', '/api/papers-1099', '/api/jobs'])
    assert.equal((await cont.get(u)).status, 200, u);
  assert.equal((await cont.post('/api/company-expenses', { description: 'x', amount_cents: 1 })).status, 403);
  assert.equal((await cont.put(`/api/jobs/${job}`, { client_name: 'x' })).status, 403);
  assert.equal((await cont.get('/api/reports/split')).status, 403, 'el reparto, solo con permiso');
  await g.put(`/api/users/${ids.cont}`, { tools: ['reparto'] });
  assert.notEqual((await cont.get('/api/reports/split')).status, 403);
});

test('permisos por persona: solo los que le tocan a cada puesto', async () => {
  assert.equal((await g.put(`/api/users/${ids.luis}`, { tools: ['ventas'] })).status, 400);
  assert.equal((await g.put(`/api/users/${ids.ofi}`, { tools: ['cuadrilla'] })).status, 400);
  assert.equal((await g.put(`/api/users/${ids.pm}`, { pm_all: true })).status, 200);
  assert.equal(server.db.prepare('SELECT pm_all FROM users WHERE id=?').get(ids.pm).pm_all, 1);
});

test('encargado de cuadrilla: escribe el reporte del día (interno)', async () => {
  assert.equal((await luis.post(`/api/jobs/${job}/logs`, { client_notes: 'Se pusieron postes' })).status, 403, 'sin permiso no');
  await g.put(`/api/users/${ids.luis}`, { tools: ['cuadrilla'] });
  const r = await luis.post(`/api/jobs/${job}/logs`, { client_notes: 'Se pusieron postes', internal_notes: 'x', weather: 'Sol', crew: 'Luis, Beto' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const row = server.db.prepare('SELECT * FROM daily_logs WHERE job_id=?').get(job);
  assert.equal(row.shared, 0, 'no se le manda al cliente'); assert.equal(row.internal_notes, '');
  const other = (await g.post('/api/jobs', { client_name: 'Otra', project_type: 'patio_cover', status: 'activo' })).data.id;
  assert.notEqual((await luis.post(`/api/jobs/${other}/logs`, { client_notes: 'x' })).status, 200, 'solo sus obras');
});
