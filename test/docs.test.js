'use strict';
// v2.27 — Documentos: papeles de la compañía, contrato, plantillas y garantías.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const D = require('../lib/docs');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-docs-'));
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
    return { status: res.status, type, data: type.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer()) };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const g = client(), ofi = client(), cont = client(), pm = client(), cli = client(), luis = client();
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n% prueba\n').toString('base64');
let job, ids = {};
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); };

test('preparación', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  const mk = async (name, role) => (await g.post('/api/users', { name, username: name.toLowerCase(), password: 'contrasena-' + name.toLowerCase(), role })).data.id;
  ids.ofi = await mk('Ofi', 'admin'); ids.cont = await mk('Cont', 'accountant'); ids.pm = await mk('Pema', 'pm'); ids.cli = await mk('Clie', 'client'); ids.luis = await mk('Luis', 'worker');
  for (const [c, u] of [[ofi, 'ofi'], [cont, 'cont'], [pm, 'pema'], [cli, 'clie'], [luis, 'luis']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await g.post('/api/jobs', { client_name: 'Melbourne', address: '5020 Melbourne Dr', project_type: 'patio_cover', status: 'activo', quoted_cents: 2500000, start_date: '2026-11-02', description: 'Patio cover 438 sqft' })).data.id;
  server.db.prepare('UPDATE jobs SET pm_id=?, client_user_id=? WHERE id=?').run(ids.pm, ids.cli, job);
  await g.post(`/api/jobs/${job}/subs`, { name: 'Luis', user_id: ids.luis, agreed_cents: 1000 });
});

test('papeles de la compañía: la oficina los sube, el PM y la contadora los ven, solo un dueño borra', async () => {
  const r = await ofi.post('/api/company-docs', { kind: 'registro', title: 'Registro de contratista Plano', city: 'Plano', expires: iso(20), file: PDF });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.state, 'por_vencer');
  await g.post('/api/company-docs', { kind: 'seguro', title: 'General liability', expires: iso(200) });
  assert.equal((await pm.get('/api/company-docs')).data.docs.length, 2);
  assert.equal((await cont.get('/api/company-docs')).status, 200);
  assert.equal((await pm.post('/api/company-docs', { title: 'x' })).status, 403);
  assert.equal((await cont.post('/api/company-docs', { title: 'x' })).status, 403);
  assert.equal((await luis.get('/api/company-docs')).status, 403);
  assert.equal((await cli.get('/api/company-docs')).status, 403);
  assert.equal((await ofi.del(`/api/company-docs/${r.data.id}`)).status, 403);
  assert.equal((await pm.get(`/api/company-docs/${r.data.id}/file`)).status, 200);
});

test('aviso 30 días antes y el día que vence, una sola vez', async () => {
  const gid = server.db.prepare("SELECT id FROM users WHERE username='glaiber'").get().id;
  const n0 = server.db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(gid).n;
  D.tick(server.db); D.tick(server.db);
  const got = server.db.prepare('SELECT title, body FROM notifications WHERE user_id=? ORDER BY id').all(gid).slice(n0);
  assert.equal(got.length, 1); assert.match(got[0].body, /Registro de contratista Plano/);
  assert.equal(server.db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=?').get(ids.ofi).n >= 1, true, 'a la oficina también');
});

test('plantillas: contrato con los datos de la obra; firmado ya no se borra', async () => {
  const t = (await g.get('/api/doc-templates')).data;
  assert.equal(t.templates.length, 3);
  const r = await pm.post(`/api/jobs/${job}/generate`, { template: 'contrato' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.kind, 'contrato');
  const f = await g.get(`/api/job-docs/${r.data.id}/file`);
  const s = f.data.toString('latin1');
  assert.ok(s.startsWith('%PDF-')); assert.ok(s.includes('CONSTRUCTION AGREEMENT')); assert.ok(s.includes('Melbourne')); assert.ok(s.includes('$25,000.00'));
  // El sub nunca ve el contrato aunque se marque para compartir.
  await g.put(`/api/job-docs/${r.data.id}`, { share_subs: true, share_client: true });
  assert.ok(!(await luis.get(`/api/jobs/${job}/docs`)).data.docs.some(d => d.kind === 'contrato'));
  assert.ok((await cli.get(`/api/jobs/${job}/docs`)).data.docs.some(d => d.kind === 'contrato'), 'el cliente sí');
  assert.equal((await pm.post(`/api/job-docs/${r.data.id}/signed`)).status, 403, 'firmado lo marca un dueño');
  assert.equal((await g.post(`/api/job-docs/${r.data.id}/signed`, { file: PDF })).status, 200);
  assert.equal((await g.del(`/api/job-docs/${r.data.id}`)).status, 423);
  // Cambiar la plantilla y volver a la original.
  assert.equal((await pm.put('/api/doc-templates/contrato', { body: 'x'.repeat(30) })).status, 403);
  assert.equal((await g.put('/api/doc-templates/contrato', { body: '# MY CONTRACT\nFor {{client_name}} at {{job_address}}\n{{signatures}}' })).status, 200);
  const r2 = await g.post(`/api/jobs/${job}/generate`, { template: 'contrato' });
  assert.ok((await g.get(`/api/job-docs/${r2.data.id}/file`)).data.toString('latin1').includes('MY CONTRACT'));
  assert.equal((await g.put('/api/doc-templates/contrato', { reset: true })).data.custom, false);
  assert.equal((await ofi.post(`/api/jobs/${job}/generate`, { template: 'contrato' })).status, 403);
});

test('change order y garantía', async () => {
  const co = (await g.post(`/api/jobs/${job}/changes`, { date: '2026-11-10', description: 'Agregar 2 luces', cost_cents: 10000, price_cents: 45000 })).data;
  const coId = co.id || server.db.prepare('SELECT id FROM change_orders WHERE job_id=?').get(job).id;
  const r = await g.post(`/api/jobs/${job}/generate`, { template: 'change_order', co_id: coId });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok((await g.get(`/api/job-docs/${r.data.id}/file`)).data.toString('latin1').includes('$450.00'));
  assert.equal((await g.post(`/api/jobs/${job}/generate`, { template: 'garantia' })).status, 400, 'sin fecha de terminado');
  server.db.prepare("UPDATE jobs SET completed_date='2026-11-20' WHERE id=?").run(job);
  // Garantía de fábrica: inicio + años.
  const w = await pm.post(`/api/jobs/${job}/warranties`, { item: 'Calentador', brand: 'Infratech', model: 'C-series', serial: 'A123', starts: '2026-11-20', years: 3, file: PDF });
  assert.equal(w.status, 200, JSON.stringify(w.data)); assert.equal(w.data.expires, '2029-11-20');
  const ws = (await cli.get(`/api/jobs/${job}/warranties`)).data;
  assert.equal(ws.workmanship.until, '2027-11-20'); assert.equal(ws.items.length, 1);
  assert.equal((await luis.get(`/api/jobs/${job}/warranties`)).status, 403);
  const gr = await g.post(`/api/jobs/${job}/generate`, { template: 'garantia' });
  const txt = (await g.get(`/api/job-docs/${gr.data.id}/file`)).data.toString('latin1');
  assert.ok(txt.includes('WARRANTY CERTIFICATE') && txt.includes('Infratech') && txt.includes('November 20, 2027'));
  assert.equal((await pm.del(`/api/warranties/${w.data.id}`)).status, 403);
  assert.equal((await g.del(`/api/warranties/${w.data.id}`)).status, 200);
});
