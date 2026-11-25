'use strict';
// v2.30 — Inventario de herramienta y equipo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const INV = require('../lib/inventory');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-inv-'));
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
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const g = client(), ofi = client(), pm = client(), cont = client(), luis = client();
let ids = {}, job, other, saw;
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); };

test('preparación', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  for (const [n, r] of [['Ofi', 'admin'], ['Pema', 'pm'], ['Cont', 'accountant'], ['Luis', 'worker']]) ids[n] = (await g.post('/api/users', { name: n, username: n.toLowerCase(), password: 'contrasena-' + n.toLowerCase(), role: r })).data.id;
  for (const [c, u] of [[ofi, 'ofi'], [pm, 'pema'], [cont, 'cont'], [luis, 'luis']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await g.post('/api/jobs', { client_name: 'Melbourne', project_type: 'patio_cover', status: 'activo' })).data.id;
  other = (await g.post('/api/jobs', { client_name: 'Otra', project_type: 'patio_cover', status: 'activo' })).data.id;
  server.db.prepare('UPDATE jobs SET pm_id=? WHERE id=?').run(ids.Pema, job);
  await g.post(`/api/jobs/${job}/subs`, { name: 'Luis', user_id: ids.Luis, agreed_cents: 1000 });
});

test('la oficina pasa al inventario un gasto de herramienta', async () => {
  await g.post('/api/company-expenses', { date: '2026-11-20', category: 'herramienta', description: 'Sierra circular DeWalt', vendor: 'Home Depot', amount_cents: 19900 });
  const inv = (await ofi.get('/api/inventory')).data;
  assert.equal(inv.pending_expenses.length, 1);
  const r = await ofi.post('/api/inventory', { name: 'Sierra circular', category: 'electrica', brand: 'DeWalt', serial: 'DW-1', warranty_until: iso(20), company_expense_id: inv.pending_expenses[0].id });
  assert.equal(r.status, 200, JSON.stringify(r.data)); saw = r.data.ids[0]; assert.equal(r.data.tags[0], 'H-0001');
  const t = (await g.get('/api/inventory')).data.tools[0];
  assert.equal(t.cost_cents, 19900); assert.equal(t.vendor, 'Home Depot'); assert.equal(t.location, 'bodega');
  assert.equal((await ofi.post('/api/inventory', { name: 'x', company_expense_id: inv.pending_expenses[0].id })).status, 409, 'no se pasa dos veces');
  assert.equal((await g.get('/api/inventory')).data.pending_expenses.length, 0);
  const many = await g.post('/api/inventory', { name: 'Escalera 8 ft', category: 'escalera', qty: 3, cost_cents: 30000 });
  assert.equal(many.data.ids.length, 3);
  assert.equal(server.db.prepare('SELECT cost_cents FROM tools_inventory WHERE id=?').get(many.data.ids[0]).cost_cents, 10000);
});

test('el PM la ve sin costos y la mueve entre la bodega y sus obras; no la presta a nadie', async () => {
  const inv = (await pm.get('/api/inventory')).data;
  assert.ok(!('cost_cents' in inv.tools[0]) && !('value_cents' in inv.summary));
  assert.equal(inv.jobs.length, 1, 'solo sus obras');
  assert.equal((await pm.post(`/api/inventory/${saw}/move`, { location: 'obra', job_id: other })).status, 400);
  assert.equal((await pm.post(`/api/inventory/${saw}/move`, { location: 'obra', job_id: job })).status, 200);
  assert.equal((await pm.post(`/api/inventory/${saw}/move`, { location: 'reparacion' })).status, 403);
  assert.equal((await pm.post(`/api/inventory/${saw}/move`, { location: 'baja', note: 'se rompió' })).status, 403);
  assert.equal((await pm.post('/api/inventory', { name: 'x' })).status, 403);
  const h = (await g.get(`/api/inventory/${saw}/history`)).data;
  assert.equal(h[0].to_loc, 'obra'); assert.equal(h[0].to_job_name, 'Melbourne'); assert.equal(h[0].by_name, 'Pema');
});

test('el sub ve la herramienta de su obra sin costos; la contadora ve todo, no cambia', async () => {
  const w = (await luis.get(`/api/jobs/${job}/tools`)).data;
  assert.equal(w.length, 1); assert.ok(!('cost_cents' in w[0]));
  assert.equal((await luis.get('/api/inventory')).status, 403);
  assert.equal((await luis.get(`/api/jobs/${other}/tools`)).status, 404);
  const c = (await cont.get('/api/inventory')).data;
  assert.equal(c.summary.value_cents, 49900);
  assert.equal((await cont.post(`/api/inventory/${saw}/move`, { location: 'bodega' })).status, 403);
});

test('baja con motivo; solo un dueño borra; aviso de garantía una vez', async () => {
  assert.equal((await ofi.post(`/api/inventory/${saw}/move`, { location: 'baja' })).status, 400, 'necesita motivo');
  assert.equal((await ofi.del(`/api/inventory/${saw}`)).status, 403);
  const gid = server.db.prepare("SELECT id FROM users WHERE username='glaiber'").get().id;
  const n0 = server.db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND url='#/inventario'").get(gid).n;
  INV.tick(server.db); INV.tick(server.db);
  assert.equal(server.db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND url='#/inventario'").get(gid).n, n0 + 1);
  assert.equal((await ofi.post(`/api/inventory/${saw}/move`, { location: 'baja', note: 'Se quemó el motor' })).status, 200);
  assert.equal((await g.get('/api/inventory')).data.summary.items, 3);
  assert.equal((await g.del(`/api/inventory/${saw}`)).status, 200);
});
