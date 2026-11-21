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
  const job = (await owner.post('/api/jobs', { client_name: 'Smith', address: '1 Main St', status: 'activo' })).body;
  await owner.put(`/api/jobs/${job.id}`, { client_user_id: cliId });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Pedro', trade: 'concreto', agreed_cents: 100000, user_id: subId });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Luis', trade: 'eléctrico', agreed_cents: 100000, user_id: otherSub });
  const as = async u => { const c = client(); await c.post('/api/login', { username: u, password: 'otra-clave-larga-1' }); return c; };
  return { srv, dir, owner, job, sub: await as('pedro'), luis: await as('luis'), cli: await as('cliente'), subId };
}


async function twoOwners() {
  const ctx = await start();
  await ctx.owner.post('/api/users', { name: 'Jack', username: 'jack', password: 'otra-clave-larga-1', role: 'owner' });
  const jack = (() => { let cookie = ''; const base = ctx.srv.base; const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) }; };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: (u, b) => call('DELETE', u, b) }; })();
  await jack.post('/api/login', { username: 'jack', password: 'otra-clave-larga-1' });
  return { ...ctx, jack };
}

test('motivo obligatorio y bitácora con antes/después', async () => {
  const { srv, owner, job } = await twoOwners();
  try {
    const p = (await owner.post(`/api/jobs/${job.id}/payments`, { date: '2026-11-01', amount_cents: 50000, method: 'Zelle' })).body;
    const r1 = await owner.del(`/api/payments/${p.id}`);
    assert.equal(r1.status, 428); assert.equal(r1.body.needReason, true);
    assert.equal((await owner.del(`/api/payments/${p.id}`, { reason: 'Se registró doble' })).status, 200, 'menos de $1,000: un dueño basta, con motivo');
    const log = (await owner.get(`/api/audit?job_id=${job.id}`)).body;
    const del = log.find(a => a.action === 'borrar' && a.entity === 'pago del cliente');
    assert.ok(del); assert.equal(del.reason, 'Se registró doble'); assert.equal(del.before.amount_cents, 50000); assert.equal(del.user_name, 'Glaiber');
    assert.ok(log.find(a => a.action === 'crear' && a.entity === 'pago del cliente'), 'las altas también quedan');
  } finally { srv.close(); }
});

test('$1,000 o más: espera al otro dueño; un "no" lo detiene; no se autoriza a sí mismo', async () => {
  const { srv, owner, jack, job } = await twoOwners();
  try {
    const p = (await owner.post(`/api/jobs/${job.id}/payments`, { date: '2026-11-01', amount_cents: 250000, method: 'Cheque' })).body;
    const r = await owner.del(`/api/payments/${p.id}`, { reason: 'Cheque rebotado' });
    assert.equal(r.status, 200); assert.equal(r.body.pending, true);
    assert.equal((await owner.get(`/api/jobs/${job.id}`)).body.payments.length, 1, 'todavía no se borra');
    assert.ok((await jack.get('/api/status')).body.user.pending >= 1, 'a Jack le aparece pendiente');
    assert.equal((await owner.post(`/api/change-requests/${r.body.request_id}/decide`, { action: 'approve' })).status, 403);
    // Jack dice que no
    await jack.post(`/api/change-requests/${r.body.request_id}/decide`, { action: 'reject', note: 'Sí se cobró, revisé el banco' });
    assert.equal((await owner.get(`/api/jobs/${job.id}`)).body.payments.length, 1);
    // Se pide otra vez y Jack autoriza: ahora sí se aplica
    const r2 = await owner.del(`/api/payments/${p.id}`, { reason: 'Ahora sí rebotó' });
    const a = await jack.post(`/api/change-requests/${r2.body.request_id}/decide`, { action: 'approve', note: 'Confirmado' });
    assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.status, 'aprobado');
    assert.equal((await owner.get(`/api/jobs/${job.id}`)).body.payments.length, 0);
    const log = (await owner.get('/api/audit')).body.map(x => x.action);
    for (const k of ['solicitud', 'rechazar', 'aprobar', 'borrar']) assert.ok(log.includes(k), k);
  } finally { srv.close(); }
});

test('choques: si el registro cambió mientras esperaba, no se aplica; edición simultánea se rechaza', async () => {
  const { srv, owner, jack, job } = await twoOwners();
  try {
    const e = (await owner.post(`/api/jobs/${job.id}/expenses`, { date: '2026-11-03', amount_cents: 300000, description: 'Madera', category: 'material' })).body;
    const r = await owner.put(`/api/expenses/${e.id}`, { amount_cents: 450000, reason: 'Faltó una factura' });
    assert.equal(r.body.pending, true);
    // Mientras tanto Jack corrige el mismo gasto (cambio chico)
    assert.equal((await jack.put(`/api/expenses/${e.id}`, { amount_cents: 310000, reason: 'Impuesto', _expect: { amount_cents: 300000 } })).status, 200);
    // Glaiber, con la pantalla vieja, intenta otra edición: choque
    const c = await owner.put(`/api/expenses/${e.id}`, { description: 'Madera y tornillos', _expect: { amount_cents: 300000 } });
    assert.equal(c.status, 409); assert.equal(c.body.conflict, true);
    // Jack aprueba la solicitud vieja: no se aplica porque el gasto ya cambió
    const a = await jack.post(`/api/change-requests/${r.body.request_id}/decide`, { action: 'approve' });
    assert.equal(a.status, 409);
    const exp = (await owner.get(`/api/jobs/${job.id}`)).body.expenses.find(x => x.id === e.id);
    assert.equal(exp.amount_cents, 310000);
    assert.equal((await owner.get('/api/change-requests')).body.recent[0].status, 'conflicto');
  } finally { srv.close(); }
});

test('cierre de periodo: nada antes de la fecha; reabrir necesita al otro dueño', async () => {
  const { srv, owner, jack, job } = await twoOwners();
  try {
    const e = (await owner.post(`/api/jobs/${job.id}/expenses`, { date: '2026-10-10', amount_cents: 10000, description: 'Clavos', category: 'material' })).body;
    assert.equal((await owner.put('/api/lock', { date: '2026-10-31' })).status, 200);
    assert.equal((await owner.post(`/api/jobs/${job.id}/payments`, { date: '2026-10-15', amount_cents: 1000, method: 'Zelle' })).status, 423);
    assert.equal((await owner.del(`/api/expenses/${e.id}`, { reason: 'x y z' })).status, 423);
    assert.equal((await owner.put(`/api/expenses/${(await owner.post(`/api/jobs/${job.id}/expenses`, { date: '2026-11-05', amount_cents: 500, description: 'x', category: 'material' })).body.id}`, { date: '2026-10-20', reason: 'fecha' })).status, 423, 'tampoco moverlo al periodo cerrado');
    assert.equal((await owner.post(`/api/jobs/${job.id}/payments`, { date: '2026-11-15', amount_cents: 1000, method: 'Zelle' })).status, 200, 'después del cierre sí');
    // Reabrir
    const r = await owner.put('/api/lock', { date: '', reason: 'El contador encontró un error' });
    assert.equal(r.body.pending, true);
    assert.equal((await owner.get('/api/lock')).body.date, '2026-10-31');
    await jack.post(`/api/change-requests/${r.body.request_id}/decide`, { action: 'approve' });
    assert.equal((await owner.get('/api/lock')).body.date, '');
    assert.equal((await owner.del(`/api/expenses/${e.id}`, { reason: 'Corregido' })).status, 200);
  } finally { srv.close(); }
});

test('precio de obra contratada y borrar obra pasan por el otro dueño; lo demás no estorba', async () => {
  const { srv, owner, jack, job, sub } = await twoOwners();
  try {
    await owner.put(`/api/jobs/${job.id}`, { quoted_cents: 2000000, reason: 'Precio inicial' }).then(r => r.body.pending && jack.post(`/api/change-requests/${r.body.request_id}/decide`, { action: 'approve' }));
    assert.equal((await owner.put(`/api/jobs/${job.id}`, { description: 'Patio cover', end_date: '2026-12-20' })).status, 200, 'datos sin dinero: directo, sin motivo');
    const r = await owner.put(`/api/jobs/${job.id}`, { quoted_cents: 2300000, reason: 'Cliente pidió más grande' });
    assert.equal(r.body.pending, true);
    assert.equal((await owner.get(`/api/jobs/${job.id}`)).body.job.quoted_cents, 2000000);
    await jack.post(`/api/change-requests/${r.body.request_id}/decide`, { action: 'approve' });
    assert.equal((await owner.get(`/api/jobs/${job.id}`)).body.job.quoted_cents, 2300000);
    const d = await owner.del(`/api/jobs/${job.id}`, { confirm: 'Smith', reason: 'Se canceló' });
    assert.equal(d.body.pending, true, 'borrar una obra siempre necesita al otro dueño');
    assert.equal((await owner.get(`/api/jobs/${job.id}`)).status, 200);
    // Un sub no puede crear solicitudes
    assert.equal((await sub.del(`/api/payments/1`, { reason: 'hola' })).status, 403);
    // Cancelar mi propia solicitud
    assert.equal((await owner.post(`/api/change-requests/${d.body.request_id}/cancel`)).status, 200);
  } finally { srv.close(); }
});

test('reembolso a un dueño: lo autoriza el otro dueño', async () => {
  const { srv, owner, jack, job } = await twoOwners();
  try {
    const r = await owner.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 4000, description: 'Gasolina', category: 'otro', date: '2026-11-18', reimburse: true, reason: 'Pagué con mi tarjeta' });
    assert.equal(r.body.pending, true);
    const ok = await owner.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 4000, description: 'Clavos', category: 'material', date: '2026-11-18' });
    assert.ok(!ok.body.pending, 'gasto normal: directo');
    await jack.post(`/api/change-requests/${r.body.request_id}/decide`, { action: 'approve' });
    const ex = (await owner.get(`/api/jobs/${job.id}`)).body.expenses.find(e => e.description === 'Gasolina');
    assert.ok(ex); assert.equal(ex.reimburse, 1);
  } finally { srv.close(); }
});
