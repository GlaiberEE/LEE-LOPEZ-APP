'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-iss-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
    };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}) };
  };
  const owner = client();
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
  await owner.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
  const mkUser = async (name, role) => { const r = await owner.post('/api/users', { name, username: name.toLowerCase(), password: 'otra-clave-larga-1', role }); return r.body.id; };
  const subId = await mkUser('Pedro', 'worker');
  const otherSub = await mkUser('Luis', 'worker');
  const cliId = await mkUser('Cliente', 'client');
  const job = (await owner.post('/api/jobs', { template: 'base',  client_name: 'Smith', address: '1 Main St', status: 'activo' })).body;
  await owner.put(`/api/jobs/${job.id}`, { client_user_id: cliId });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Pedro', trade: 'concreto', agreed_cents: 100000, user_id: subId });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Luis', trade: 'eléctrico', agreed_cents: 100000, user_id: otherSub });
  const as = async u => { const c = client(); await c.post('/api/login', { username: u, password: 'otra-clave-larga-1' }); return c; };
  return { srv, dir, owner, job, sub: await as('pedro'), luis: await as('luis'), cli: await as('cliente'), subId };
}

test('casos: lo interno nunca llega al cliente y el sub solo ve los suyos', async () => {
  const { srv, owner, job, sub, luis, cli } = await start();
  try {
    // El sub reporta un problema con foto
    const r = await sub.post('/api/issues', { job_id: job.id, title: 'Tubería de gas donde va la zapata', body: 'Encontramos una línea de gas a 30 cm.', urgent: true, photos: [PNG] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const id = r.body.id;
    assert.equal(r.body.status, 'abierto');
    // Dueño lo ve como pendiente
    assert.ok((await owner.get('/api/status')).body.user.pending >= 1);
    const full = (await owner.get(`/api/issues/${id}`)).body;
    assert.equal(full.messages.length, 1);
    const internalPhoto = full.messages[0].photos[0];
    assert.ok(internalPhoto);
    // Al leerlo deja de estar pendiente
    assert.equal((await owner.get('/api/status')).body.user.pending, 0);
    // Cliente y el otro sub no lo ven
    assert.equal((await cli.get('/api/issues')).body.length, 0);
    assert.equal((await cli.get(`/api/issues/${id}`)).status, 404);
    assert.equal((await luis.get(`/api/issues/${id}`)).status, 404);
    assert.equal((await cli.get(`/files/${internalPhoto}`)).status, 404);
    assert.equal((await luis.get(`/files/${internalPhoto}`)).status, 404);
    // La foto del caso no aparece en las fotos de la obra
    assert.equal((await cli.get(`/api/jobs/${job.id}`)).body.photos.length, 0);
    // Respuesta interna al sub
    await owner.post(`/api/issues/${id}/messages`, { body: 'No toquen nada, llamamos a la compañía de gas.', visibility: 'interno' });
    assert.ok((await sub.get('/api/status')).body.user.pending >= 1);
    // Explicación al cliente con la foto elegida
    const m = await owner.post(`/api/issues/${id}/messages`, { body: 'Encontramos una línea de gas. Necesitamos su autorización para mover la zapata 2 pies.', visibility: 'cliente', share_photos: [internalPhoto] });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    const cv = (await cli.get(`/api/issues/${id}`)).body;
    assert.equal(cv.status, 'esperando_cliente');
    assert.equal(cv.messages.length, 1, 'el cliente solo ve el mensaje para él');
    assert.ok(!JSON.stringify(cv).includes('No toquen'));
    assert.ok(!JSON.stringify(cv).includes('30 cm'));
    const shared = cv.messages[0].photos[0];
    assert.notEqual(shared, internalPhoto, 'se comparte una copia, no la foto interna');
    assert.equal((await cli.get(`/files/${shared}`)).status, 200);
    // El sub no ve lo que se habló con el cliente
    const sv = (await sub.get(`/api/issues/${id}`)).body;
    assert.ok(!JSON.stringify(sv).includes('autorización'));
    assert.equal((await sub.get(`/files/${shared}`)).status, 404);
    // Cliente responde -> vuelve a abierto
    await cli.post(`/api/issues/${id}/messages`, { body: 'Sí, autorizo.', photos: [PNG] });
    assert.equal((await owner.get(`/api/issues/${id}`)).body.status, 'abierto');
    // Cierre con decisión interna + mensaje al cliente
    assert.equal((await sub.post(`/api/issues/${id}/resolve`, { decision: 'x' })).status, 403);
    await owner.post(`/api/issues/${id}/resolve`, { decision: 'Mover zapata 2 pies; costo extra lo absorbe la empresa.', client_message: 'Listo, seguimos el jueves.' });
    const cEnd = (await cli.get(`/api/issues/${id}`)).body;
    assert.equal(cEnd.status, 'resuelto');
    assert.ok(!JSON.stringify(cEnd).includes('absorbe'), 'la decisión interna no llega al cliente');
    assert.ok(JSON.stringify(cEnd).includes('seguimos el jueves'));
    assert.ok(JSON.stringify((await sub.get(`/api/issues/${id}`)).body).includes('absorbe'));
  } finally { srv.close(); }
});

test('casos: el cliente pregunta con fotos y el PM abre casos', async () => {
  const { srv, owner, job, sub, luis, cli, subId } = await start();
  try {
    const q = await cli.post('/api/issues', { job_id: job.id, title: '¿Este color de piedra?', body: '¿Es la que escogimos?', photos: [PNG] });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.equal(q.body.kind, 'pregunta');
    assert.equal((await sub.get(`/api/issues/${q.body.id}`)).status, 404, 'el sub no ve preguntas del cliente');
    const list = (await owner.get(`/api/issues?job_id=${job.id}`)).body;
    assert.equal(list.length, 1);
    assert.ok(list[0].unread > 0);
    // PM abre un caso interno e involucra a Pedro
    const pm = await owner.post('/api/issues', { job_id: job.id, title: 'Nivel del piso fuera', body: 'Vi el nivel 1/2" fuera.', worker_id: subId });
    assert.equal(pm.status, 200, JSON.stringify(pm.body));
    assert.equal((await sub.get(`/api/issues/${pm.body.id}`)).status, 200);
    assert.equal((await luis.get(`/api/issues/${pm.body.id}`)).status, 404);
    assert.equal((await cli.get(`/api/issues/${pm.body.id}`)).status, 404);
    // Sub que no es de la obra no puede abrir casos
    const other = await owner.post('/api/jobs', { template: 'base',  client_name: 'Otra', status: 'activo' });
    assert.equal((await sub.post('/api/issues', { job_id: other.body.id, title: 'x', body: 'y' })).status, 404);
    // Las fotos de casos no se pueden borrar
    const det = (await owner.get(`/api/issues/${q.body.id}`)).body;
    assert.ok(det.messages[0].photos.length === 1);
  } finally { srv.close(); }
});
