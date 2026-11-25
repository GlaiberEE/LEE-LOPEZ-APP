'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-pro-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; srv.base = base;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
    };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: (u, b) => call('DELETE', u, b) };
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
  const pmId = await mkUser('Mario', 'pm');
  const other = (await owner.post('/api/jobs', { template: 'base',  client_name: 'Otra obra', status: 'activo' })).body;
  await owner.put(`/api/jobs/${job.id}`, { pm_id: pmId });
  await owner.put(`/api/users/${otherSub}`, { related_pm_id: pmId }); // Luis es familiar de Mario
  return { srv, dir, owner, job, other, sub: await as('pedro'), luis: await as('luis'), cli: await as('cliente'), pm: await as('mario'), subId, pmId, otherSub, client };
}


const approveLast = async owner => { const r = (await owner.get('/api/change-requests')).body.to_approve.at(-1); return owner.post(`/api/change-requests/${r.id}/decide`, { action: 'approve' }); };

test('PM: solo ve sus obras y no entra a lo de la empresa', async () => {
  const { srv, pm, job, other } = await start();
  try {
    const jobs = (await pm.get('/api/jobs')).body;
    assert.deepEqual(jobs.map(j => j.id), [job.id]);
    assert.equal((await pm.get(`/api/jobs/${other.id}`)).status, 404);
    assert.equal((await pm.get(`/api/jobs/${job.id}`)).status, 200);
    for (const u of ['/api/receivables', '/api/payables', '/api/forecast', '/api/reports/profit', '/api/audit', '/api/settings', '/api/backup', '/api/time', '/api/export/gastos', '/api/pm-activity'])
      assert.equal((await pm.get(u)).status, 403, u);
    assert.equal((await pm.post('/api/users', { name: 'x', username: 'xxx', password: 'una-clave-larga-2', role: 'owner' })).status, 403, 'no crea usuarios');
    assert.equal((await pm.put('/api/lock', { date: '2026-01-01' })).status, 403);
    const users = (await pm.get('/api/users')).body;
    assert.ok(users.every(u => ['worker', 'pm'].includes(u.role)), 'solo ve subs/PMs');
    assert.equal((await pm.get('/api/status')).body.user.role, 'pm');
    // Crea un prospecto: queda asignado a él
    const nj = (await pm.post('/api/jobs', { template: 'base',  client_name: 'Prospecto de Mario' })).body;
    assert.equal((await pm.get(`/api/jobs/${nj.id}`)).status, 200);
  } finally { srv.close(); }
});

test('PM: gastos chicos sí; arriba del límite, partidos o a su nombre los autoriza un dueño', async () => {
  const { srv, owner, pm, job } = await start();
  try {
    const ok = await pm.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 20000, description: 'Tornillos', category: 'material', date: '2026-11-18', vendor: 'Lowes' });
    assert.equal(ok.status, 200); assert.ok(!ok.body.pending, 'debajo de $500: directo');
    const big = await pm.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 80000, description: 'Madera', category: 'material', date: '2026-11-18' });
    assert.equal(big.status, 428, 'pide motivo');
    const big2 = await pm.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 80000, description: 'Madera', category: 'material', date: '2026-11-18', reason: 'Faltó madera para vigas' });
    assert.equal(big2.body.pending, true);
    // Gasto partido: otro de $350 el mismo día en Lowes (con el de $200 pasa $500)
    const split = await pm.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 35000, description: 'Más tornillos', category: 'material', date: '2026-11-18', vendor: 'Lowes', reason: 'Faltaron' });
    assert.equal(split.body.pending, true); assert.match(split.body.summary, /partido/);
    // Reembolso a su propio nombre
    const plain = await pm.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 3000, description: 'Agua', category: 'otro', date: '2026-11-17', bought_by: 'Mario' });
    assert.ok(!plain.body.pending, 'comprar algo él mismo con dinero de la empresa no es reembolso');
    const self = await pm.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 5000, description: 'Gasolina', category: 'otro', date: '2026-11-18', bought_by: 'Mario', reimburse: true, reason: 'Gasolina' });
    assert.equal(self.body.pending, true); assert.match(self.body.summary, /reembolso/);
    // Un dueño autoriza el de la madera
    const m0 = (await owner.get(`/api/jobs/${job.id}`)).body.money.spent;
    const reqs = (await owner.get('/api/change-requests')).body.to_approve;
    assert.equal(reqs.length, 3);
    await owner.post(`/api/change-requests/${reqs[0].id}/decide`, { action: 'approve' });
    assert.equal((await owner.get(`/api/jobs/${job.id}`)).body.money.spent, m0 + 80000);
    // Borrar o cambiar dinero: siempre lo autoriza un dueño, aunque sea poco
    const e = (await owner.get(`/api/jobs/${job.id}`)).body.expenses.find(x => x.amount_cents === 20000);
    assert.equal((await pm.del(`/api/expenses/${e.id}`, { reason: 'Error' })).body.pending, true);
    assert.equal((await pm.put(`/api/expenses/${e.id}`, { amount_cents: 19000, reason: 'Error' })).body.pending, true);
    // El PM no puede autorizar nada
    assert.equal((await pm.post(`/api/change-requests/${reqs[1].id}/decide`, { action: 'approve' })).status, 403);
    // Ve sus propias solicitudes, no las de otros
    const mine = (await pm.get('/api/change-requests')).body;
    assert.equal(mine.to_approve.length, 0); assert.ok(mine.mine.length >= 4);
    // Los dueños ven la alerta de reembolso a su nombre
    const act = (await owner.get('/api/pm-activity')).body.find(a => a.name === 'Mario');
    assert.ok(act); assert.equal(act.jobs.length, 1);
  } finally { srv.close(); }
});

test('PM: no paga subs, no cambia precios ni aprueba lo de su gente', async () => {
  const { srv, owner, pm, job, sub, luis } = await start();
  try {
    const d = (await owner.get(`/api/jobs/${job.id}`)).body;
    const pedro = d.subs.find(s => s.name === 'Pedro');
    // Pagar a un sub → solicitud
    const pay = await pm.post(`/api/subs/${pedro.id}/payments`, { amount_cents: 10000, date: '2026-11-18', method: 'Zelle', reason: 'Avance' });
    assert.equal(pay.body.pending, true);
    await approveLast(owner);
    assert.equal((await owner.get(`/api/subs/${pedro.id}/payments`)).body.paid_cents, 10000);
    // Precio de la obra, cancelar, asignar PM
    assert.equal((await pm.put(`/api/jobs/${job.id}`, { quoted_cents: 999999, reason: 'Más grande' })).body.pending, true);
    assert.equal((await pm.put(`/api/jobs/${job.id}`, { pm_id: null })).status, 403);
    assert.equal((await pm.put(`/api/jobs/${job.id}`, { description: 'Patio cover 20x16', end_date: '2026-12-15' })).status, 200, 'datos de la obra: directo');
    // Aprobar change order → solicitud
    const co = (await pm.post(`/api/jobs/${job.id}/changes`, { description: 'Luces extra', price_cents: 30000, cost_cents: 10000 })).body;
    assert.equal((await pm.put(`/api/changes/${co.id}`, { status: 'aprobado', reason: 'Cliente lo pidió' })).body.pending, true);
    // Invoice chico de Pedro: el PM lo aprueba directo
    const inv = (await sub.post('/api/docs', { job_id: job.id, type: 'invoice', description: 'Postes', lines: [{ desc: 'x', qty: 1, unit_cents: 30000 }] })).body;
    const ap = await pm.post(`/api/docs/${inv.id}/decide`, { action: 'accept' });
    assert.equal(ap.status, 200); assert.ok(!ap.body.pending); assert.equal(ap.body.status, 'aprobado');
    // Invoice grande → dueño
    const inv2 = (await sub.post('/api/docs', { job_id: job.id, type: 'invoice', description: 'Techo', lines: [{ desc: 'x', qty: 1, unit_cents: 90000 }] })).body;
    assert.equal((await pm.post(`/api/docs/${inv2.id}/decide`, { action: 'accept', reason: 'Trabajo hecho' })).body.pending, true);
    // Invoice chico de Luis (relacionado con Mario) → dueño
    const inv3 = (await luis.post('/api/docs', { job_id: job.id, type: 'invoice', description: 'Luz', lines: [{ desc: 'x', qty: 1, unit_cents: 10000 }] })).body;
    const r3 = await pm.post(`/api/docs/${inv3.id}/decide`, { action: 'accept', reason: 'Trabajo de luz' });
    assert.equal(r3.body.pending, true); assert.match(r3.body.summary, /relacionado/);
    // Nadie se cambia sus propios límites: el PM ni siquiera entra a usuarios
    assert.equal((await pm.put(`/api/users/${(await pm.get('/api/status')).body.user.id}`, { pm_limit_cents: 9999999 })).status, 403);
  } finally { srv.close(); }
});
