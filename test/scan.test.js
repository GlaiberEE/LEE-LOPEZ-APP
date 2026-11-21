'use strict';
// Escaneo de tickets con un lector simulado (en producción lo lee la IA).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const { parseResult } = require('../lib/scan-ai');

// El "lector" devuelve lo que diga la primera línea del archivo de prueba (JSON).
const JPG = obj => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(JSON.stringify(obj))]).toString('base64');
const fakeExtract = async ({ buf }) => {
  const o = JSON.parse(buf.slice(3).toString());
  if (o.fail) throw new Error('No se pudo leer el ticket');
  return o.none ? null : { vendor: '', date: '', total_cents: null, tax_cents: null, items: [], category: 'material', job_hint: '', doc_type: 'receipt', text: '', ...o };
};

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-scan-'));
  server = createServer({ dataDir: dir, scanExtractor: fakeExtract });
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
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer() };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b) };
}
const owner = client(), crew = client(), crew2 = client(), cli = client();
let j1, j2, j3;
const spent = async id => (await owner.get(`/api/jobs/${id}`)).data.money.spent;

test('preparación', async () => {
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  const w = (await owner.post('/api/users', { name: 'Pedro', username: 'pedro', password: 'contrasena-pedro', role: 'worker' })).data.id;
  const w2 = (await owner.post('/api/users', { name: 'Luis', username: 'luis', password: 'contrasena-luis', role: 'worker' })).data.id;
  const c = (await owner.post('/api/users', { name: 'C', username: 'cli1', password: 'contrasena-cli1', role: 'client' })).data.id;
  for (const [k, u] of [[crew, 'pedro'], [crew2, 'luis'], [cli, 'cli1']]) await k.post('/api/login', { username: u, password: 'contrasena-' + u });
  j1 = (await owner.post('/api/jobs', { client_name: 'Robert Thompson', address: '4512 Cross Timbers Rd, Flower Mound, TX', project_type: 'patio_cover', status: 'activo' })).data.id;
  j2 = (await owner.post('/api/jobs', { client_name: 'Maria Gonzalez', address: '88 Oak Hollow Ln, Argyle, TX', project_type: 'fire_pit', status: 'activo' })).data.id;
  j3 = (await owner.post('/api/jobs', { client_name: 'Kim', address: '9 Elm St', project_type: 'otro', status: 'activo' })).data.id;
  await owner.put(`/api/jobs/${j1}`, { client_user_id: c });
  const t1 = (await owner.get(`/api/jobs/${j1}`)).data.tasks, t2 = (await owner.get(`/api/jobs/${j2}`)).data.tasks;
  await owner.put(`/api/tasks/${t1[0].id}`, { assignee_id: w }); await owner.put(`/api/tasks/${t2[0].id}`, { assignee_id: w });
  const t3 = (await owner.get(`/api/jobs/${j3}`)).data.tasks; await owner.put(`/api/tasks/${t3[0].id}`, { assignee_id: w2 });
});

test('el lector valida lo que regresa la IA', () => {
  const r = parseResult('Aquí está: {"vendor":"The Home Depot","date":"2026-11-18","total":"$1,234.56","tax":95.1,"items":["2x6x12"],"category":"subcontratistas","job_hint":"PO EE-0007"}');
  assert.equal(r.total_cents, 123456); assert.equal(r.tax_cents, 9510); assert.equal(r.category, 'material', 'nunca subcontratistas desde un ticket');
  assert.equal(parseResult('{"date":"18/11/2026","total":-5}').date, ''); assert.equal(parseResult('{"total":-5}').total_cents, null);
  assert.throws(() => parseResult('no json'));
});

test('con el código de obra en el ticket se guarda solo en esa obra', async () => {
  const before = await spent(j2);
  const r = await owner.post('/api/scans', { file: JPG({ vendor: 'The Home Depot', date: '2026-11-18', total_cents: 48720, items: ['Concreto 80lb x 10'], job_hint: `JOB: EE-${String(j2).padStart(4, '0')}` }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'guardado'); assert.equal(r.data.job_id, j2); assert.equal(r.data.why, 'codigo');
  assert.equal(await spent(j2), before + 48720, 'el gasto ya está en la obra');
  const e = (await owner.get(`/api/jobs/${j2}`)).data.expenses.find(x => x.id === r.data.expense_id);
  assert.equal(e.vendor, 'The Home Depot'); assert.ok(e.receipt_id, 'con la foto como recibo');
});

test('por la dirección de entrega también se reconoce la obra', async () => {
  const r = await owner.post('/api/scans', { file: JPG({ vendor: '84 Lumber', date: '2026-11-17', total_cents: 220000, job_hint: 'Deliver to: 4512 CROSS TIMBERS RD' }) });
  assert.equal(r.data.status, 'guardado'); assert.equal(r.data.job_id, j1); assert.equal(r.data.why, 'direccion');
});

test('si solo hay una pista débil (nombre del cliente), se queda por asignar con la obra sugerida', async () => {
  const r = await owner.post('/api/scans', { file: JPG({ vendor: 'Lowes', date: '2026-11-16', total_cents: 9999, job_hint: 'Customer: Gonzalez' }) });
  assert.equal(r.data.status, 'por_asignar'); assert.equal(r.data.job_id, j2); assert.equal(r.data.why, 'cliente');
  assert.ok((await owner.get('/api/status')).data.user.pending >= 1);
  const before = await spent(j2);
  const f = await owner.post(`/api/scans/${r.data.id}/file`, { job_id: j2, amount_cents: 9999, date: '2026-11-16', vendor: 'Lowes', category: 'material' });
  assert.equal(f.data.status, 'guardado');
  assert.equal(await spent(j2), before + 9999);
  assert.equal((await owner.post(`/api/scans/${r.data.id}/file`, { job_id: j2, amount_cents: 1 })).status, 400, 'no se guarda dos veces');
});

test('el trabajador con una sola obra activa: se guarda solo en esa obra', async () => {
  const r = await crew2.post('/api/scans', { file: JPG({ vendor: 'Ace', date: '2026-11-15', total_cents: 3150 }) });
  assert.equal(r.data.status, 'guardado'); assert.equal(r.data.job_id, j3); assert.equal(r.data.why, 'unica');
  assert.equal((await crew2.get(`/api/jobs/${j3}`)).data.money, undefined, 'y sigue sin ver dinero');
});

test('el trabajador con dos obras y sin pistas: por asignar, solo entre sus obras', async () => {
  const r = await crew.post('/api/scans', { file: JPG({ vendor: 'Ace', date: '2026-11-15', total_cents: 4100 }) });
  assert.equal(r.data.status, 'por_asignar');
  assert.equal((await crew.post(`/api/scans/${r.data.id}/file`, { job_id: j3, amount_cents: 4100 })).status, 404, 'no puede mandarlo a una obra que no es suya');
  assert.equal((await crew.post(`/api/scans/${r.data.id}/file`, { job_id: j1, amount_cents: 4100, category: 'subcontratistas' })).data.status, 'guardado');
  const e = (await owner.get(`/api/jobs/${j1}`)).data.expenses.find(x => x.amount_cents === 4100);
  assert.equal(e.category, 'otro', 'un trabajador no registra pagos a subs');
  assert.equal(e.bought_by, 'Pedro');
});

test('escanear desde la obra la asigna directo', async () => {
  const r = await crew.post('/api/scans', { file: JPG({ vendor: 'Ferguson', date: '2026-11-14', total_cents: 15500 }), job_id: j2 });
  assert.equal(r.data.status, 'guardado'); assert.equal(r.data.job_id, j2);
  assert.equal((await crew2.post('/api/scans', { file: JPG({ total_cents: 1 }), job_id: j1 })).status, 404, 'no en obra ajena');
});

test('duplicados: la misma foto, o mismo monto + fecha + tienda, no se guarda doble', async () => {
  const same = JPG({ vendor: 'The Home Depot', date: '2026-11-18', total_cents: 48720, job_hint: `EE-${String(j2).padStart(4, '0')}` });
  const r = await owner.post('/api/scans', { file: same });
  assert.equal(r.data.status, 'por_asignar', 'misma foto: no se guarda solo'); assert.ok(r.data.duplicate);
  const r2 = await owner.post('/api/scans', { file: JPG({ vendor: 'THE HOME DEPOT #6512', date: '2026-11-18', total_cents: 48720, job_hint: 'otra foto' }) });
  assert.ok(r2.data.duplicate && r2.data.duplicate.amount_cents === 48720, 'mismo ticket fotografiado otra vez');
  assert.equal((await owner.post(`/api/scans/${r2.data.id}/discard`)).status, 200);
});

test('sin lectura (o si falla), queda por asignar para llenarlo a mano; nada se pierde', async () => {
  const r = await owner.post('/api/scans', { file: JPG({ fail: true }) });
  assert.equal(r.data.status, 'por_asignar'); assert.ok(r.data.error);
  const r2 = await owner.post('/api/scans', { file: JPG({ none: true }) });
  assert.equal(r2.data.status, 'por_asignar'); assert.equal(r2.data.data, null);
  assert.equal((await owner.get(`/api/scans/${r2.data.id}/file`)).status, 200, 'la foto se guardó');
});

test('mover a otra obra si se archivó mal; permisos', async () => {
  const r = await owner.post('/api/scans', { file: JPG({ vendor: '84 Lumber', date: '2026-11-13', total_cents: 77700, job_hint: '4512 Cross Timbers' }) });
  const a = await spent(j1), b = await spent(j2);
  const m = await owner.post(`/api/scans/${r.data.id}/move`, { job_id: j2 });
  assert.equal(m.data.job_id, j2);
  assert.equal(await spent(j1), a - 77700); assert.equal(await spent(j2), b + 77700);
  assert.equal((await crew2.get(`/api/scans/${r.data.id}/file`)).status, 404, 'otro trabajador no ve el ticket');
  assert.equal((await cli.get('/api/scans')).status, 403, 'el cliente no');
  assert.equal((await cli.post('/api/scans', { file: JPG({}) })).status, 403);
  assert.equal((await owner.post('/api/scans', { file: 'data:image/jpeg;base64,AAAA' })).status, 400);
});
