'use strict';
// v2.29 — Webhooks y cierre de mes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createServer } = require('../server');
const H = require('../lib/hooks');

let server, base, dir;
const got = [];
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-hooks-'));
  H.setSender(async (url, body, headers) => { got.push({ url, body, headers }); return url.includes('falla') ? 500 : 200; });
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
const g = client(), pm = client(), cont = client(), ofi = client();
let job, hook, secret;
const settle = () => new Promise(r => setTimeout(r, 120));

test('preparación', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  for (const [n, r] of [['Pema', 'pm'], ['Cont', 'accountant'], ['Ofi', 'admin']]) await g.post('/api/users', { name: n, username: n.toLowerCase(), password: 'contrasena-' + n.toLowerCase(), role: r });
  for (const [c, u] of [[pm, 'pema'], [cont, 'cont'], [ofi, 'ofi']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await g.post('/api/jobs', { client_name: 'Melbourne', project_type: 'patio_cover', status: 'activo' })).data.id;
});

test('conexiones: solo dueños, solo https y no internas', async () => {
  assert.equal((await pm.post('/api/webhooks', { url: 'https://example.com/x' })).status, 403);
  assert.equal((await g.post('/api/webhooks', { url: 'http://example.com/x' })).status, 400);
  assert.equal((await g.post('/api/webhooks', { url: 'https://127.0.0.1/x' })).status, 400);
  assert.equal((await g.post('/api/webhooks', { url: 'https://192.168.1.5/x' })).status, 400);
  assert.equal((await g.post('/api/webhooks', { url: 'https://example.com/x', events: ['nada'] })).status, 400);
  const r = await g.post('/api/webhooks', { url: 'https://grok.example.com/hook', events: ['expense.created', 'month.closed'], name: 'Grok' });
  assert.equal(r.status, 200); hook = r.data.id; secret = r.data.secret; assert.equal(secret.length, 48);
  assert.ok(!('secret' in (await g.get('/api/webhooks')).data.hooks[0]), 'la clave solo se ve una vez');
});

test('al registrar un gasto llega el aviso firmado; lo que no pidió no llega', async () => {
  got.length = 0;
  await g.post(`/api/jobs/${job}/expenses`, { description: 'Concreto', amount_cents: 12000, category: 'material', date: '2026-11-20' });
  await g.post(`/api/jobs/${job}/changes`, { date: '2026-11-20', description: 'Luces', price_cents: 1000 });
  await settle();
  assert.equal(got.length, 1, JSON.stringify(got.map(x => x.headers['X-EE-Event'])));
  const m = got[0];
  assert.equal(m.headers['X-EE-Event'], 'expense.created');
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(m.body).digest('hex');
  assert.equal(m.headers['X-EE-Signature'], sig, 'firma válida');
  const b = JSON.parse(m.body);
  assert.equal(b.data.job.code, 'EE-0001'); assert.equal(b.data.amount_cents, 12000);
});

test('prueba, falla con reintentos y bitácora', async () => {
  const t = await g.post(`/api/webhooks/${hook}/test`);
  assert.equal(t.data.ok, true);
  const bad = (await g.post('/api/webhooks', { url: 'https://falla.example.com/x' })).data.id;
  const r = await g.post(`/api/webhooks/${bad}/test`);
  assert.equal(r.data.ok, false); assert.equal(r.data.tries, 3);
  const log = (await g.get(`/api/webhooks/${bad}/log`)).data;
  assert.equal(log[0].ok, 0);
  assert.equal((await g.put(`/api/webhooks/${bad}`, { active: false })).data.active, false);
  assert.equal((await g.del(`/api/webhooks/${bad}`)).status, 200);
});

test('cierre de mes: revisión, paquete .zip y cerrar el mes', async () => {
  const m = '2026-11';
  const r = (await g.get(`/api/month-close?month=${m}`)).data;
  assert.equal(r.closed, false); assert.equal(r.totals.job_expenses_cents, 12000); assert.ok(r.checks.length >= 3);
  assert.equal((await ofi.get(`/api/month-close?month=${m}`)).status, 403, 'la oficina no');
  assert.equal((await pm.get(`/api/month-close?month=${m}`)).status, 403);
  const z = await cont.get(`/api/month-close/zip?month=${m}`);
  assert.equal(z.status, 200); assert.ok(z.type.includes('zip'));
  const buf = z.data; assert.equal(buf.readUInt32LE(0), 0x04034b50);
  // Leer el primer archivo (README) del zip.
  const nlen = buf.readUInt16LE(26), clen = buf.readUInt32LE(18);
  const name = buf.slice(30, 30 + nlen).toString(); const txt = zlib.inflateRawSync(buf.slice(30 + nlen, 30 + nlen + clen)).toString();
  assert.equal(name, `${m}/README.txt`); assert.match(txt, /month package 2026-11/);
  assert.ok(buf.includes(Buffer.from(`${m}/expenses-all-${m}.csv`)));
  got.length = 0;
  assert.equal((await g.put('/api/lock', { date: '2026-11-30' })).status, 200);
  await settle();
  assert.equal((await g.get(`/api/month-close?month=${m}`)).data.closed, true);
  assert.ok(got.some(x => x.headers['X-EE-Event'] === 'month.closed'));
  assert.equal((await g.post(`/api/jobs/${job}/expenses`, { description: 'Tarde', amount_cents: 100, category: 'material', date: '2026-11-21' })).status, 423, 'el mes cerrado no se cambia');
});
