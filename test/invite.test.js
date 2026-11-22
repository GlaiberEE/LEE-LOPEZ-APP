'use strict';
// v2.8: usuario nuevo sin contraseña inventada por el dueño, y pedido de acceso de alguien nuevo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-inv-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}) };
  };
  const owner = client();
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
  await owner.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
  return { srv, owner, client };
}

test('alguien nuevo pide acceso, el dueño lo crea sin inventar contraseña y la persona pone la suya', async () => {
  const { srv, owner, client } = await start();
  try {
    const anon = client();
    assert.equal((await anon.post('/api/access-new', { name: 'Ana Pérez', phone: '' })).status, 400);
    assert.equal((await anon.post('/api/access-new', { name: 'Ana Pérez', phone: '214-555-0111', kind: 'cliente', note: '12 Oak St' })).status, 200);
    const reqs = (await owner.get('/api/access-requests')).body;
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].kind, 'cliente'); assert.equal(reqs[0].phone, '214-555-0111'); assert.equal(reqs[0].user, null);
    // Un anónimo no puede ver los pedidos.
    assert.equal((await anon.get('/api/access-requests')).status, 401);

    const made = (await owner.post('/api/users', { name: 'Ana Pérez', username: 'ana.p', role: 'client', phone: '214-555-0111', request_id: reqs[0].id })).body;
    assert.ok(made.temp && made.temp.length >= 10, 'la app inventa la temporal');
    assert.equal(made.expires_hours, 168);
    assert.equal(made.must_change, true);
    assert.equal((await owner.get('/api/access-requests')).body.length, 0, 'el pedido queda resuelto');

    const ana = client();
    assert.equal((await ana.post('/api/login', { username: 'ana.p', password: made.temp })).status, 200);
    assert.equal((await ana.get('/api/jobs')).status, 403, 'primero tiene que poner su contraseña');
    assert.equal((await ana.post('/api/me/password', { current: made.temp, password: 'mi-propia-clave-9' })).status, 200);
    const st = (await ana.get('/api/status')).body;
    assert.equal(st.user.must_change, false);

    // Con contraseña puesta por el dueño sigue funcionando como antes.
    const b = (await owner.post('/api/users', { name: 'Beto', username: 'beto', role: 'worker', password: 'clave-larga-de-beto' })).body;
    assert.equal(b.temp, undefined); assert.equal(b.must_change, false);
  } finally { srv.close(); }
});

test('si el teléfono ya es de alguien con usuario, el pedido es de recuperar acceso', async () => {
  const { srv, owner, client } = await start();
  try {
    await owner.post('/api/users', { name: 'Pedro Gómez', username: 'pedro', role: 'worker', phone: '(972) 555-0101', password: 'clave-larga-de-pedro' });
    await client().post('/api/access-new', { name: 'Pedro', phone: '972 555 0101', kind: 'trabajador' });
    const r = (await owner.get('/api/access-requests')).body[0];
    assert.equal(r.user.username, 'pedro'); assert.equal(r.kind, '');
  } finally { srv.close(); }
});
