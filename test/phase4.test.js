'use strict';
// v2.21 — Fase 4: change orders con código y estado (pendiente → aprobado → facturado → cobrado) y cobros al cliente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-f4-'));
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
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json().catch(() => null) : null, type: ct };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u, b) => call('DELETE', u, b) };
}
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
const g = client(), cli = client(), mario = client();
let job, gas, permit, cliId;
const bill = async () => (await g.get(`/api/jobs/${job}/billing`)).data;
const coOf = async id => (await bill()).change_orders.find(c => c.id === id);

test('preparación: obra con contrato de un estimado aprobado (sin propuesta firmada)', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  cliId = (await g.post('/api/users', { name: 'Cliente', username: 'cliente', password: 'contrasena-cliente', role: 'client' })).data.id;
  const mid = (await g.post('/api/users', { name: 'Mario', username: 'mario', password: 'contrasena-mario', role: 'pm' })).data.id;
  await cli.post('/api/login', { username: 'cliente', password: 'contrasena-cliente' });
  await mario.post('/api/login', { username: 'mario', password: 'contrasena-mario' });
  job = (await g.post('/api/jobs', { template: 'base', client_name: 'Kilmichael', project_type: 'outdoor_kitchen', status: 'prospecto' })).data.id;
  server.db.prepare('UPDATE jobs SET client_user_id=?, pm_id=? WHERE id=?').run(cliId, mid, job);
  const est = (await g.post(`/api/jobs/${job}/docs`, { kind: 'estimado', number: '2001', amount_cents: 10000000, file: PDF })).data;
  await g.post(`/api/job-docs/${est.id}/approve`);
  const b = await bill();
  assert.equal(b.contracted, true, 'ya se puede cobrar aunque no se firmó la propuesta de la app');
  assert.deepEqual(b.milestones.map(m => m.amount_cents), [3000000, 4000000, 3000000]);
});

test('código por categoría con número corrido de la obra: GAS-01, PERMIT-02', async () => {
  gas = (await g.post(`/api/jobs/${job}/changes`, { category: 'GAS', description: 'Línea de gas a la parrilla', price_cents: 120000, cost_cents: 60000 })).data;
  permit = (await g.post(`/api/jobs/${job}/changes`, { category: 'PERMIT', description: 'Permiso aparte de gas', price_cents: 35000 })).data;
  assert.equal(gas.code, 'GAS-01'); assert.equal(permit.code, 'PERMIT-02');
  const own = (await g.post(`/api/jobs/${job}/changes`, { code: 'gran 03', description: 'Granito extra', price_cents: 250000 })).data;
  assert.equal(own.code, 'GRAN-03', 'código escrito a mano, limpio');
  assert.equal((await g.post(`/api/jobs/${job}/changes`, { code: 'GAS-01', description: 'Otro', price_cents: 1 })).status, 409, 'no se repite en la obra');
  const b = await bill();
  assert.equal(b.cos_waiting, 3); assert.equal(b.cos_cents, 0, 'pendientes no suman al contrato');
  const cv = (await cli.get(`/api/jobs/${job}`)).data.changes;
  assert.ok(cv.some(c => c.code === 'GAS-01' && c.state === 'pendiente'), 'el cliente ve el código y el estado');
  assert.equal(cv[0].cost_cents, undefined, 'nunca el costo');
});

test('aprobado → facturado → cobrado; el trabajo hecho va aparte', async () => {
  await g.put(`/api/changes/${gas.id}`, { status: 'aprobado' });
  let c = await coOf(gas.id);
  assert.equal(c.state, 'aprobado'); assert.ok(c.approved_at);
  assert.equal((await bill()).cos_cents, 120000, 'aprobado suma al contrato');
  const inv = (await g.post(`/api/changes/${gas.id}/invoice`, { due_days: 7 })).data;
  assert.match(inv.invoice_number, /^INV-\d{4}-\d{4}$/); assert.match(inv.url, /inv=co/);
  assert.equal((await coOf(gas.id)).state, 'facturado');
  assert.equal((await g.put(`/api/changes/${gas.id}`, { price_cents: 99, reason: 'Ajuste' })).status, 423, 'facturado: no se cambia el monto');
  assert.equal((await g.del(`/api/changes/${gas.id}`, { reason: 'Borrar' })).status, 423);
  // PDF para el dueño y el cliente, y por el enlace público.
  assert.match((await g.get(`/api/changes/${gas.id}/pdf`)).type, /pdf/);
  assert.match((await cli.get(`/api/changes/${gas.id}/pdf`)).type, /pdf/);
  const tok = server.db.prepare('SELECT proposal_token FROM jobs WHERE id=?').get(job).proposal_token;
  const pub = await client().get(`/api/public/proposal/${tok}`);
  assert.ok(pub.data.invoices.some(i => i.id === 'co' + gas.id));
  assert.match((await client().get(`/api/public/proposal/${tok}/invoice/co${gas.id}`)).type, /pdf/);
  // Pago aplicado al CO: cobrado, aunque el trabajo todavía no esté hecho (como el granito pagado por adelantado).
  assert.equal((await g.post(`/api/jobs/${job}/payments`, { amount_cents: 1000, co_id: permit.id })).status, 400, 'a un CO sin aprobar no');
  await g.post(`/api/jobs/${job}/payments`, { date: '2026-11-20', amount_cents: 120000, method: 'Zelle', co_id: gas.id });
  c = await coOf(gas.id);
  assert.equal(c.state, 'cobrado'); assert.equal(c.done_at, '');
  assert.equal((await bill()).milestones[0].covered_cents, 0, 'el pago del CO no se va a las etapas');
  // El PM marca el trabajo hecho; facturar es de dueños.
  assert.equal((await mario.post(`/api/changes/${gas.id}/done`, { done: true })).status, 200);
  assert.ok((await coOf(gas.id)).done_at);
  assert.equal((await mario.post(`/api/changes/${permit.id}/invoice`, {})).status, 403);
});

test('trabajo hecho sin facturar sale en "toca cobrar"; los pagos generales van a etapas y luego a COs', async () => {
  await g.put(`/api/changes/${permit.id}`, { status: 'aprobado' });
  await g.post(`/api/changes/${permit.id}/done`, { done: true });
  const due = (await g.get('/api/billing/due')).data;
  assert.ok(due.some(d => d.kind === 'co' && d.id === permit.id && d.status === 'por_cobrar'));
  // Pago general por todo el contrato + 35,000: cubre las etapas y el sobrante cubre PERMIT-02.
  await g.post(`/api/jobs/${job}/payments`, { date: '2026-11-21', amount_cents: 10035000, method: 'Cheque' });
  const b = await bill();
  assert.ok(b.milestones.every(m => m.status === 'pagado'));
  assert.equal(b.change_orders.find(c => c.id === permit.id).state, 'cobrado');
  assert.equal(b.balance_cents, 0);
  const sum = (await g.get('/api/billing/summary')).data.find(r => r.job_id === job);
  assert.equal(sum.paid_cents, 10155000); assert.equal(sum.cos_waiting, 1, 'GRAN-03 todavía espera al cliente');
  assert.equal((await mario.get('/api/billing/summary')).status, 403, 'cobros: solo dueños');
});

test('el cliente firma el CO: queda aprobado con fecha', async () => {
  const gran = (await g.get(`/api/jobs/${job}`)).data.changes.find(c => c.code === 'GRAN-03');
  const sig = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(800, 1)]).toString('base64');
  assert.equal((await cli.post(`/api/jobs/${job}/sign`, { target: 'change_order', target_id: gran.id, name: 'Mrs. K', agree: true, signature: sig })).status, 200);
  const c = await coOf(gran.id);
  assert.equal(c.state, 'aprobado'); assert.ok(c.approved_at);
});

test('subs ya registrados para escoger al agregar uno a otra obra (sin montos)', async () => {
  await g.post(`/api/jobs/${job}/subs`, { name: 'Joey Plumbing', trade: 'Plomería y gas', agreed_cents: 300000, trades: ['plomeria', 'gas'], notes: 'Trae sus manómetros' });
  const k = (await g.get('/api/subs/known')).data.find(x => x.name === 'Joey Plumbing');
  assert.deepEqual([k.trade, k.trades, k.notes, k.jobs], ['Plomería y gas', ['plomeria', 'gas'], 'Trae sus manómetros', 1]);
  assert.equal(k.agreed_cents, undefined, 'la lista no lleva montos');
  assert.equal((await cli.get('/api/subs/known')).status, 403);
});
