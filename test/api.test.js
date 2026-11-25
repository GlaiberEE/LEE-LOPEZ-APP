'use strict';
// Pruebas automáticas: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { totpAt, newTotpSecret, checkTotp } = require('../lib/auth');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-test-'));
  server = createServer({ dataDir: dir });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); server.db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer() };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u, b = {}) => call('DELETE', u, b) };
}

const owner = client(), worker = client(), worker2 = client(), cli = client(), cli2 = client(), anon = client();
let jobId, job2Id, workerId, worker2Id, clientId, client2Id;

test('configuración inicial y login', async () => {
  assert.equal((await anon.get('/api/status')).data.needsSetup, true);
  assert.equal((await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'corta' })).status, 400);
  assert.equal((await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-segura-1' })).status, 200);
  assert.equal((await anon.post('/api/setup', { name: 'X', username: 'x', password: 'contrasena-segura-1' })).status, 403, 'no se puede repetir');
  assert.equal((await owner.get('/api/status')).data.user.role, 'owner');
  assert.equal((await anon.post('/api/login', { username: 'glaiber', password: 'mala-clave-123' })).status, 401);
});

test('dueño crea usuarios', async () => {
  const mk = async (username, role) => (await owner.post('/api/users', { name: username, username, password: 'contrasena-' + username, role })).data.id;
  workerId = await mk('pedro', 'worker'); worker2Id = await mk('luis', 'worker');
  clientId = await mk('smith', 'client'); client2Id = await mk('jones', 'client');
  for (const [c, u] of [[worker, 'pedro'], [worker2, 'luis'], [cli, 'smith'], [cli2, 'jones']])
    assert.equal((await c.post('/api/login', { username: u, password: 'contrasena-' + u })).status, 200);
  assert.equal((await worker.get('/api/users')).status, 403);
  assert.equal((await cli.post('/api/users', { name: 'h', username: 'hack', password: 'contrasena-larga', role: 'owner' })).status, 403);
});

test('obra con plantilla de tareas', async () => {
  const r = await owner.post('/api/jobs', { template: 'base',  client_name: 'Smith', client_phone: '555', address: '1 Main St', project_type: 'patio_cover',
    description: 'Patio cover 20x14', status: 'activo', quoted_cents: 2500000, start_date: '2026-11-01' });
  jobId = r.data.id;
  const j = (await owner.get(`/api/jobs/${jobId}`)).data;
  assert.equal(j.tasks.length, 20);
  assert.equal(j.tasks[0].title, 'Medir y hacer planos');
  assert.equal(j.tasks[0].trade, 'planos'); assert.equal(j.tasks[5].trade, '', 'la inspección no tiene trade');
  await owner.put(`/api/jobs/${jobId}`, { client_user_id: clientId });
  job2Id = (await owner.post('/api/jobs', { template: 'base',  client_name: 'Jones', project_type: 'fire_pit', quoted_cents: 600000, status: 'activo' })).data.id;
  await owner.put(`/api/jobs/${job2Id}`, { client_user_id: client2Id });
  // asignar tarea a Pedro
  await owner.put(`/api/tasks/${j.tasks[4].id}`, { assignee_id: workerId, planned_date: '2026-11-05' });
  assert.equal((await owner.put(`/api/tasks/${j.tasks[3].id}`, { assignee_id: clientId })).status, 400, 'solo trabajadores');
});

test('cálculos de dinero', async () => {
  await owner.post(`/api/jobs/${jobId}/expenses`, { date: '2026-11-02', category: 'material', description: 'Madera', vendor: 'Home Depot', bought_by: 'Glaiber', amount_cents: 300000, receipt: PNG });
  await owner.post(`/api/jobs/${jobId}/expenses`, { date: '2026-11-03', category: 'retrabajo', description: 'Rehacer viga', amount_cents: 50000 });
  const sub = (await owner.post(`/api/jobs/${jobId}/subs`, { name: 'Roofing Co', trade: 'Techo', agreed_cents: 400000 })).data.id;
  await owner.post(`/api/jobs/${jobId}/expenses`, { date: '2026-11-04', category: 'material', description: 'Pago 1', amount_cents: 150000, sub_id: sub });
  await owner.post(`/api/jobs/${jobId}/changes`, { date: '2026-11-04', description: 'Ventilador extra', cost_cents: 20000, price_cents: 80000, status: 'aprobado' });
  await owner.post(`/api/jobs/${jobId}/changes`, { date: '2026-11-04', description: 'Luces', cost_cents: 10000, price_cents: 40000, status: 'pendiente' });
  await owner.post(`/api/jobs/${jobId}/payments`, { date: '2026-11-01', amount_cents: 1000000, method: 'Cheque' });
  const { money, subs, expenses } = (await owner.get(`/api/jobs/${jobId}`)).data;
  assert.equal(money.contract, 2580000);          // 25,000 + 800 aprobado (el pendiente no cuenta)
  assert.equal(money.spent, 500000);              // 3,000 + 500 + 1,500
  assert.equal(money.rework, 50000);
  assert.equal(money.profit, 2080000);
  assert.equal(money.balanceDue, 1580000);
  assert.equal(money.subsOwed, 250000);
  assert.equal(subs[0].paid_cents, 150000);
  assert.equal(expenses.find(e => e.sub_id).category, 'subcontratistas', 'pago a sub siempre es categoría subcontratistas');
  assert.ok(expenses.find(e => e.description === 'Madera').receipt_id);
  assert.equal((await owner.post(`/api/jobs/${jobId}/expenses`, { category: 'material', description: 'x', amount_cents: 10.5 })).status, 400);
  assert.equal((await owner.post(`/api/jobs/${jobId}/expenses`, { category: 'material', description: 'x', amount_cents: -5 })).status, 400);
  const dash = (await owner.get('/api/dashboard')).data;
  assert.equal(dash.reworkYear, 50000);
  assert.equal(dash.pendingCO.length, 1);
});

test('trabajador: solo sus obras, sin dinero', async () => {
  const list = (await worker.get('/api/jobs')).data;
  assert.deepEqual(list.map(j => j.id), [jobId]);
  assert.equal((await worker2.get('/api/jobs')).data.length, 0);
  const j = (await worker.get(`/api/jobs/${jobId}`)).data;
  assert.equal(j.money, undefined); assert.equal(j.expenses, undefined); assert.equal(j.job.quoted_cents, undefined);
  assert.equal(j.job.client_phone, undefined);
  assert.equal((await worker2.get(`/api/jobs/${jobId}`)).status, 404);
  assert.equal((await worker.get(`/api/jobs/${job2Id}`)).status, 404);
  const mine = j.tasks.find(t => t.mine), other = j.tasks.find(t => !t.mine);
  assert.equal((await worker.put(`/api/tasks/${mine.id}`, { status: 'hecho' })).status, 200);
  assert.equal((await worker.put(`/api/tasks/${other.id}`, { status: 'hecho' })).status, 403);
  assert.equal((await worker.put(`/api/tasks/${mine.id}`, { title: 'cambiado' })).status, 200);
  assert.equal((await owner.get(`/api/jobs/${jobId}`)).data.tasks.find(t => t.id === mine.id).title !== 'cambiado', true, 'no puede cambiar el título');
  assert.equal((await worker.post(`/api/jobs/${jobId}/photos`, { dataUrl: PNG, task_id: mine.id })).status, 200);
  assert.equal((await worker.post(`/api/jobs/${jobId}/expenses`, { category: 'material', description: 'Tornillos', amount_cents: 2500 })).status, 200);
  assert.equal((await worker.get('/api/expenses')).status, 403);
  assert.equal((await worker.get('/api/dashboard')).status, 403);
  assert.equal((await worker.post(`/api/jobs/${jobId}/payments`, { amount_cents: 1 })).status, 403);
  assert.equal((await worker2.post(`/api/jobs/${jobId}/photos`, { dataUrl: PNG })).status, 404);
});

test('cliente: solo su obra, precio y pagos pero no costos', async () => {
  const list = (await cli.get('/api/jobs')).data;
  assert.deepEqual(list.map(j => j.id), [jobId]);
  const j = (await cli.get(`/api/jobs/${jobId}`)).data;
  assert.equal(j.money.contract, 2580000);
  assert.equal(j.money.spent, undefined); assert.equal(j.money.profit, undefined);
  assert.equal(j.expenses, undefined); assert.equal(j.subs, undefined);
  assert.ok(j.changes.every(c => c.cost_cents === undefined));
  assert.ok(j.tasks.every(t => t.assignee_id === undefined));
  assert.equal((await cli2.get(`/api/jobs/${jobId}`)).status, 404);
  assert.equal((await cli.put(`/api/jobs/${jobId}`, { quoted_cents: 1 })).status, 403);
  assert.equal((await cli.post(`/api/jobs/${jobId}/photos`, { dataUrl: PNG })).status, 403);
});

test('archivos protegidos', async () => {
  const j = (await owner.get(`/api/jobs/${jobId}`)).data;
  const photo = j.photos[0].id, receipt = j.expenses.find(e => e.receipt_id).receipt_id;
  assert.equal((await cli.get(`/files/${photo}`)).status, 200);
  assert.equal((await cli2.get(`/files/${photo}`)).status, 404);
  assert.equal((await anon.get(`/files/${photo}`)).status, 404);
  assert.equal((await owner.get(`/files/${receipt}`)).status, 200);
  assert.equal((await worker.get(`/files/${receipt}`)).status, 404, 'recibos solo dueños');
  assert.equal((await cli.get(`/files/${receipt}`)).status, 404);
  assert.equal((await owner.post(`/api/jobs/${jobId}/photos`, { dataUrl: 'data:image/png;base64,AAAA' })).status, 400);
});

test('código de 6 dígitos', async () => {
  const secret = newTotpSecret();
  assert.ok(checkTotp(secret, totpAt(secret, Math.floor(Date.now() / 30000))));
  assert.ok(!checkTotp(secret, '000000') || totpAt(secret, Math.floor(Date.now() / 30000)) === '000000');
  const s = (await owner.post('/api/me/mfa/start')).data.secret;
  assert.equal((await owner.post('/api/me/mfa/confirm', { code: '123' })).status, 400);
  assert.equal((await owner.post('/api/me/mfa/confirm', { code: totpAt(s, Math.floor(Date.now() / 30000)) })).status, 200);
  const fresh = client();
  assert.equal((await fresh.post('/api/login', { username: 'glaiber', password: 'contrasena-segura-1' })).data.needCode, true);
  assert.equal((await fresh.get('/api/jobs')).status, 401, 'sin código no hay sesión');
  assert.equal((await fresh.post('/api/login', { username: 'glaiber', password: 'contrasena-segura-1', code: totpAt(s, Math.floor(Date.now() / 30000)) })).status, 200);
  assert.equal((await fresh.get('/api/jobs')).status, 200);
});

test('seguridad de peticiones', async () => {
  const r = await fetch(base + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
  const r2 = await fetch(base + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(r2.status, 415);
  assert.equal((await fetch(base + '/../server.js')).status !== 200 || !(await (await fetch(base + '/../server.js')).text()).includes('createServer'), true);
  assert.equal((await fetch(base + '/%2e%2e/server.js')).status, 404);
});

test('dueño desactivado pierde acceso; siempre queda un dueño', async () => {
  const me = (await owner.get('/api/status')).data.user.id;
  assert.equal((await owner.put(`/api/users/${me}`, { active: false })).status, 400);
  await owner.put(`/api/users/${workerId}`, { active: false });
  assert.equal((await worker.get('/api/jobs')).status, 401);
});

test('borrar obra pide confirmación y limpia', async () => {
  assert.equal((await owner.del(`/api/jobs/${job2Id}`, { confirm: 'Jones' })).status, 428, 'pide el motivo');
  assert.equal((await owner.del(`/api/jobs/${job2Id}`, { confirm: 'otro', reason: 'Prueba duplicada' })).status, 400);
  assert.equal((await owner.del(`/api/jobs/${job2Id}`, { confirm: 'Jones', reason: 'Prueba duplicada' })).status, 200);
  assert.equal((await owner.get(`/api/jobs/${job2Id}`)).status, 404);
});

test('respaldo descargable', async () => {
  const r = await owner.get('/api/backup');
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(r.data).slice(0, 15).toString(), 'SQLite format 3');
  assert.equal((await cli.get('/api/backup')).status, 403);
});

test('idioma: errores en inglés y preferencia guardada por usuario', async () => {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lang': 'en' }, body: JSON.stringify({ username: 'nadie', password: 'xxxxxxxxxxxx' }) });
  assert.equal((await r.json()).error, 'Wrong username or password');
  const r2 = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lang': 'es' }, body: JSON.stringify({ username: 'nadie', password: 'xxxxxxxxxxxx' }) });
  assert.equal((await r2.json()).error, 'Usuario o contraseña incorrectos');
  assert.equal((await cli.post('/api/me/lang', { lang: 'es' })).status, 200);
  assert.equal((await cli.get('/api/status')).data.user.lang, 'es');
  assert.equal((await cli.post('/api/me/lang', { lang: 'fr' })).status, 400);
  const u = (await owner.post('/api/users', { name: 'Mike', username: 'mike', password: 'contrasena-mike', role: 'worker', lang: 'en' })).data;
  assert.equal(u.lang, 'en');
  assert.equal((await owner.put(`/api/users/${u.id}`, { lang: 'es' })).data.lang, 'es');
});

test('revisión extra: entradas raras no rompen el servidor', async () => {
  const r = await fetch(base + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'null' }, body: '{}' });
  assert.equal(r.status, 403);
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 404);
  const r3 = await fetch(base + '/api/jobs', { template: 'base',  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malo' });
  assert.equal(r3.status, 400);
  const r4 = await fetch(base + '/api/jobs', { template: 'base',  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[1,2]' });
  assert.equal(r4.status, 401);
  // texto con HTML se guarda como texto (la interfaz lo muestra escapado)
  const id = (await owner.post('/api/jobs', { template: 'base',  client_name: '<img src=x onerror=alert(1)>', project_type: 'otro' })).data.id;
  assert.equal((await owner.get(`/api/jobs/${id}`)).data.job.client_name, '<img src=x onerror=alert(1)>');
});

test('fotos y materiales clasificados por etapa y trade', async () => {
  await owner.put(`/api/users/${workerId}`, { active: true });
  for (const [c, u] of [[worker, 'pedro'], [worker2, 'luis'], [cli, 'smith']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  const j = (await owner.get(`/api/jobs/${jobId}`)).data;
  const tk = j.tasks[0], other = (await owner.get(`/api/jobs/${job2Id}`)).data.tasks[0];
  const up = await owner.post(`/api/jobs/${jobId}/photos`, { dataUrl: PNG, task_id: tk.id, trade: 'concreto' });
  assert.equal(up.status, 200);
  let ph = (await owner.get(`/api/jobs/${jobId}`)).data.photos.find(p => p.trade === 'concreto');
  assert.ok(ph && ph.task_id === tk.id, 'la foto guarda etapa y trade');
  // un trade inventado se guarda vacío
  await owner.post(`/api/jobs/${jobId}/photos`, { dataUrl: PNG, trade: '<script>' });
  assert.ok((await owner.get(`/api/jobs/${jobId}`)).data.photos.every(p => p.trade !== '<script>'));
  // reclasificar
  assert.equal((await owner.put(`/api/files/${ph.id}/tag`, { trade: 'techo', caption: 'Techo listo' })).status, 200);
  ph = (await owner.get(`/api/jobs/${jobId}`)).data.photos.find(p => p.id === ph.id);
  assert.equal(ph.trade, 'techo'); assert.equal(ph.caption, 'Techo listo'); assert.equal(ph.task_id, tk.id);
  assert.equal((await owner.put(`/api/files/${ph.id}/tag`, { task_id: other.id })).status, 400, 'etapa de otra obra no');
  // el trabajador solo cambia sus fotos; el cliente nada
  assert.equal((await worker.put(`/api/files/${ph.id}/tag`, { trade: 'gas' })).status, 403);
  const mine = (await owner.get(`/api/jobs/${jobId}`)).data.photos.find(p => p.created_by === workerId);
  if (mine) assert.equal((await worker.put(`/api/files/${mine.id}/tag`, { trade: 'carpinteria' })).status, 200);
  assert.equal((await cli.put(`/api/files/${ph.id}/tag`, { trade: 'gas' })).status, 403);
  assert.equal((await worker2.put(`/api/files/${ph.id}/tag`, { trade: 'gas' })).status, 404);
  // materiales con etapa y trade
  const m = (await owner.post('/api/materials', { zone: 'pintura', kind: 'Stain', brand: 'SW', name: 'Stain prueba', color_name: 'Cedar' })).data;
  assert.equal((await owner.post(`/api/jobs/${jobId}/materials`, { material_id: m.id, area: 'Ceiling', task_id: other.id })).status, 400);
  assert.equal((await owner.post(`/api/jobs/${jobId}/materials`, { material_id: m.id, area: 'Ceiling', task_id: tk.id, trade: 'pintura' })).status, 200);
  const jm = (await owner.get(`/api/jobs/${jobId}/materials`)).data;
  const row = (Array.isArray(jm) ? jm : jm.materials || jm.items).find(x => x.area === 'Ceiling');
  assert.equal(row.trade, 'pintura'); assert.equal(row.task_id, tk.id); assert.ok(row.task_title);
});
