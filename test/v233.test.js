'use strict';
// v2.33 — Categorías y listas que ajusta cada compañía.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-v233-'));
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
const g = client(), jack = client(), mario = client();
let job;
test('preparación', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/users', { name: 'Jack', username: 'jack', password: 'contrasena-j-123', role: 'owner' });
  await g.post('/api/users', { name: 'Mario', username: 'mario', password: 'contrasena-m-123', role: 'pm' });
  await mario.post('/api/login', { username: 'mario', password: 'contrasena-m-123' });
  job = (await g.post('/api/jobs', { template: 'base', client_name: 'Thompson', address: '1 Oak', project_type: 'otro', status: 'activo' })).data.id;
});

test('landfill ya viene en los gastos de la compañía', async () => {
  const c = (await g.get('/api/catalog')).data;
  assert.ok(c.companyCategories.some(x => x.key === 'basura' && /landfill/i.test(x.es)));
  assert.ok(c.trades.length >= 20, 'el catálogo trae los trades');
});

test('un dueño agrega una categoría de la compañía y se puede usar', async () => {
  const r = await g.post('/api/lists/empresa', { es: 'Llantas de traila', en: 'Trailer tires' });
  assert.equal(r.status, 200); assert.match(r.data.key, /^x_/);
  const e = await g.post('/api/company-expenses', { date: '2026-11-20', category: r.data.key, description: 'Llanta 15"', amount_cents: 18900 });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal((await g.post('/api/lists/empresa', { es: 'llantas de traila' })).status, 409, 'no repite nombres');
  const l = (await g.get('/api/lists')).data.find(x => x.list === 'empresa').items.find(x => x.key === r.data.key);
  assert.equal(l.used, 1);
});

test('cambiar el nombre y esconder; lo que la app necesita no se esconde', async () => {
  const r = await g.put('/api/lists/gasto/basura', { es: 'Dumpster y landfill', en: 'Dumpster & landfill' });
  assert.equal(r.data.es, 'Dumpster y landfill');
  assert.equal((await g.put('/api/lists/gasto/retrabajo', { hidden: true })).data.hidden, true);
  assert.equal((await g.put('/api/lists/gasto/material', { hidden: true })).status, 400);
  const c = (await g.get('/api/catalog')).data.categories;
  assert.ok(c.find(x => x.key === 'retrabajo').hidden, 'escondida pero sigue en el catálogo para los nombres viejos');
  // Un gasto de obra con una categoría agregada.
  const k = (await g.post('/api/lists/gasto', { es: 'Comida de la cuadrilla' })).data.key;
  assert.equal((await g.post(`/api/jobs/${job}/expenses`, { date: '2026-11-20', category: k, description: 'Tacos', amount_cents: 4500 })).status, 200);
  assert.ok(require('node:fs').existsSync(dir));
});

test('formas de pago y trades nuevos', async () => {
  const p = (await g.post('/api/lists/pago', { es: 'Tarjeta Home Depot', en: 'Home Depot card' })).data.key;
  assert.equal((await g.post(`/api/jobs/${job}/expenses`, { date: '2026-11-21', category: 'material', description: 'Madera', amount_cents: 10000, pay_method: p })).status, 200);
  const tr = (await g.post('/api/lists/trade', { es: 'Soldadura', en: 'Welding' })).data.key;
  assert.equal(require('../lib/trades').tradeOk(tr), tr);
});

test('solo los dueños cambian las listas', async () => {
  assert.equal((await mario.post('/api/lists/empresa', { es: 'Algo' })).status, 403);
  assert.equal((await client().get('/api/lists')).status, 401);
  assert.ok(server.db.prepare("SELECT 1 FROM audit_log WHERE entity='listas'").get(), 'queda en el historial');
});

test('v2.34: formas de pago a los subs editables', async () => {
  const r = await g.post('/api/lists/pagosub', { es: 'Cash App', en: 'Cash App' });
  assert.equal(r.data.key, 'Cash App', 'la clave es el nombre, como los pagos de siempre');
  assert.equal((await g.put('/api/lists/pagosub/Cheque', { en: 'Paper check' })).data.en, 'Paper check');
  assert.equal((await g.put('/api/lists/pagosub/Otro', { hidden: true })).status, 400);
  assert.equal((await g.put('/api/lists/pagosub/Tarjeta', { hidden: true })).data.hidden, true);
  const c = (await g.get('/api/catalog')).data.subPayMethods;
  assert.ok(c.some(x => x.key === 'Cash App') && c.at(-1).key === 'Otro', '"Otro" va al final');
  assert.ok(require('../lib/lists').keys(server.db, 'pagosub').includes('Cash App'), 'el pago a sub acepta la nueva forma');
});
