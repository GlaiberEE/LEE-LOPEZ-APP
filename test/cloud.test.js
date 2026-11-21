'use strict';
// Instalación en la nube: el primer dueño se crea con el código de instalación (SETUP_CODE).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

test('nube: primer dueño solo con el código de instalación', async () => {
  process.env.SETUP_CODE = 'codigo-secreto-123'; process.env.TRUST_PROXY = '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-cloud-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (method, url, body, ip = '203.0.113.7') => fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, 'x-forwarded-for': ip }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json() }));
  try {
    const st = await call('GET', '/api/status');
    assert.equal(st.body.needsSetup, true); assert.equal(st.body.setupAllowedHere, true); assert.equal(st.body.setupNeedsCode, true);
    const user = { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' };
    assert.equal((await call('POST', '/api/setup', user)).status, 403);
    assert.equal((await call('POST', '/api/setup', { ...user, setupCode: 'malo' })).status, 403);
    assert.equal((await call('POST', '/api/setup', { ...user, setupCode: 'codigo-secreto-123' })).status, 200);
    assert.equal((await call('POST', '/api/setup', { ...user, username: 'otro', setupCode: 'codigo-secreto-123' })).status, 403, 'ya configurada');
    // los intentos fallidos de entrar cuentan por la IP real, no por la del proxy
    for (let i = 0; i < 12; i++) await call('POST', '/api/login', { username: 'glaiber', password: 'mala-clave-xx' }, '198.51.100.9');
    const ok = await call('POST', '/api/login', { username: 'glaiber', password: 'una-clave-larga-1' }, '203.0.113.7');
    assert.equal(ok.status, 200, 'el dueño entra desde su IP aunque otra IP falló muchas veces');
  } finally {
    delete process.env.SETUP_CODE; delete process.env.TRUST_PROXY;
    srv.close();
  }
});

test('sin código de instalación, la nube no permite crear el primer dueño', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-cloud-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r = await fetch(base + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-forwarded-for': '203.0.113.7' }, body: JSON.stringify({ name: 'X', username: 'xxx', password: 'una-clave-larga-1', setupCode: '' }) });
    assert.equal(r.status, 403);
  } finally { srv.close(); }
});
