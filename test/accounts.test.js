'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-acc-'));
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
  return { srv, dir, owner, job, sub: await as('pedro'), luis: await as('luis'), cli: await as('cliente'), subId };
}

const F = require('../lib/forecast');

test('estado de cuenta del cliente: contrato, change orders, pagos y saldo', async () => {
  const { srv, owner, job, cli, sub } = await start();
  try {
    await owner.put(`/api/jobs/${job.id}`, { quoted_cents: 2000000, start_date: '2026-10-01', reason: 'Precio del contrato' });
    const co = await owner.post(`/api/jobs/${job.id}/changes`, { description: 'Ventilador', price_cents: 50000, cost_cents: 20000, date: '2026-10-10' });
    await owner.put(`/api/changes/${co.body.id}`, { status: 'aprobado' });
    await owner.post(`/api/jobs/${job.id}/changes`, { description: 'Pendiente', price_cents: 99900, cost_cents: 0 });
    await owner.post(`/api/jobs/${job.id}/payments`, { date: '2026-10-02', amount_cents: 600000, method: 'Cheque' });
    await owner.post(`/api/jobs/${job.id}/payments`, { date: '2026-10-20', amount_cents: 400000, method: 'Zelle' });
    const s = (await cli.get(`/api/jobs/${job.id}/statement`)).body;
    assert.equal(s.totals.contract_cents, 2050000);
    assert.equal(s.totals.paid_cents, 1000000);
    assert.equal(s.totals.balance_cents, 1050000);
    assert.equal(s.pending_change_orders.count, 1, 'el pendiente no suma');
    assert.equal(s.moves.at(-1).balance_cents, 1050000);
    assert.ok(!JSON.stringify(s).includes('cost'), 'el cliente nunca ve costos');
    assert.equal((await sub.get(`/api/jobs/${job.id}/statement`)).status, 403);
    const pdf = await cli.get(`/api/jobs/${job.id}/statement/pdf?lang=en`);
    assert.equal(pdf.status, 200);
    assert.ok(Buffer.from(pdf.body).toString('latin1').includes('ACCOUNT STATEMENT'));
    const rec = (await owner.get('/api/receivables')).body;
    assert.equal(rec.totals.balance_cents, 1050000);
    assert.equal((await cli.get('/api/receivables')).status, 403);
  } finally { srv.close(); }
});

test('estado de cuenta de subs: acordado, pagado, debe; el sub solo ve lo suyo', async () => {
  const { srv, owner, job, sub, luis } = await start();
  try {
    const d = (await owner.get(`/api/jobs/${job.id}`)).body;
    const pedroSub = d.subs.find(s => s.name === 'Pedro'), luisSub = d.subs.find(s => s.name === 'Luis');
    // Pago directo a Pedro
    await owner.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 30000, description: 'Pago parcial', category: 'subcontratistas', date: '2026-11-01', sub_id: pedroSub.id });
    // Invoice de Pedro aprobado sin pagar
    const inv = await sub.post('/api/docs', { job_id: job.id, type: 'invoice', date: '2026-11-05', description: 'Concreto', lines: [{ desc: 'Losa', qty: 1, unit_cents: 20000 }] });
    assert.equal(inv.status, 200, JSON.stringify(inv.body));
    await owner.post(`/api/docs/${inv.body.id}/decide`, { action: 'accept', add_to_agreed: false });
    let pay = (await owner.get('/api/payables')).body;
    const p = pay.subs.find(s => s.name === 'Pedro');
    assert.equal(p.agreed_cents, 100000);
    assert.equal(p.paid_cents, 30000);
    assert.equal(p.owed_cents, 70000);
    assert.equal(p.due_now_cents, 20000);
    // Marcar invoice pagado
    await owner.post(`/api/docs/${inv.body.id}/paid`, { method: 'Zelle', date: '2026-11-10' });
    pay = (await owner.get('/api/payables')).body;
    assert.equal(pay.subs.find(s => s.name === 'Pedro').paid_cents, 50000);
    assert.equal(pay.subs.find(s => s.name === 'Pedro').due_now_cents, 0);
    // El sub ve solo lo suyo, aunque pida otro
    const mine = (await sub.get(`/api/subs/statement?key=u${luisSub.user_id}`)).body;
    assert.equal(mine.name, 'Pedro');
    assert.equal(mine.owed_cents, 50000);
    assert.ok(!JSON.stringify(mine).includes('Luis'));
    assert.equal((await sub.get('/api/payables')).status, 403);
    const pdf = await sub.get('/api/subs/statement/pdf?lang=es');
    assert.equal(pdf.status, 200);
    assert.ok(Buffer.from(pdf.body).toString('latin1').includes('ESTADO DE CUENTA'));
    void luis;
  } finally { srv.close(); }
});

test('importar historial y proyecciones con rangos', async () => {
  const { srv, owner, sub } = await start();
  try {
    assert.equal((await sub.get('/api/forecast')).status, 403);
    // Sin historial: funciona con supuestos generales y avisa que hay pocos datos
    let f = (await owner.get('/api/forecast?horizon=3')).body;
    assert.equal(f.months.length, 3);
    assert.equal(f.data.quality, 'poca');
    // 2 años de historial: 8 prospectos al mes, 50% se cierra, patio covers ~$25k con 35% de margen
    const lines = ['fecha_prospecto,fecha_cierre,fecha_terminado,cliente,tipo,origen,precio,costo,cerrado'];
    const r = F.rng(7);
    for (let m = 0; m < 24; m++) for (let i = 0; i < 8; i++) {
      const d = new Date(Date.UTC(2024, 10 + m, 1 + Math.floor(r() * 27)));
      const won = r() < (i % 2 ? 0.7 : 0.3);
      const price = 2000000 + Math.floor(r() * 1000000);
      const lead = d.toISOString().slice(0, 10);
      const close = new Date(d.getTime() + 20 * 864e5).toISOString().slice(0, 10);
      const done = new Date(d.getTime() + 60 * 864e5).toISOString().slice(0, 10);
      lines.push([lead, won ? close : '', won ? done : '', 'C' + m + i, i % 3 ? 'Patio cover' : 'Cocina exterior', i % 2 ? 'Referido' : 'Google', `"$${(price / 100).toLocaleString('en-US')}"`, won ? (price * 0.65 / 100).toFixed(2) : '', won ? 'si' : 'no'].join(','));
    }
    lines.push('fecha mala,,,X,Patio,Google,100,,si');
    const imp = await owner.post('/api/history/import', { csv: lines.join('\n') });
    assert.equal(imp.status, 200, JSON.stringify(imp.body));
    assert.equal(imp.body.imported, 192);
    assert.equal(imp.body.skipped, 1);
    f = (await owner.get('/api/forecast?horizon=6')).body;
    assert.equal(f.data.quality, 'buena');
    const ref = f.assumptions.by_source.find(s => s.source === 'Referido'), goo = f.assumptions.by_source.find(s => s.source === 'Google');
    assert.ok(ref.p > goo.p + 20, `referido ${ref.p} vs google ${goo.p}`);
    assert.ok(Math.abs(f.assumptions.margin_pct - 35) <= 2, 'margen ' + f.assumptions.margin_pct);
    // ~8 prospectos/mes × 50% × ~$25k ≈ $100k al mes en ventas
    const m2 = f.months[2].bookings;
    assert.ok(m2.p10 <= m2.p50 && m2.p50 <= m2.p90);
    assert.ok(m2.p50 > 5000000 && m2.p50 < 16000000, 'ventas mes 3: ' + m2.p50);
    // Escenario: cerrar 20% más sube las ventas
    const f2 = (await owner.get('/api/forecast?horizon=6&close=1.2')).body;
    assert.ok(f2.totals.bookings.p50 > f.totals.bookings.p50);
    // Mismo día y mismos parámetros → mismo resultado (no cambia cada vez que se abre)
    const f3 = (await owner.get('/api/forecast?horizon=6')).body;
    assert.deepEqual(f3.totals, f.totals);
    // Plantilla y borrar historial
    assert.equal((await owner.get('/api/history/template')).status, 200);
    assert.equal((await owner.get('/api/history')).body.count, 192);
    await owner.del('/api/history');
    assert.equal((await owner.get('/api/history')).body.count, 0);
  } finally { srv.close(); }
});

test('lectura de CSV: fechas, dinero y tipos', () => {
  assert.deepEqual(F.parseCsv('a,b\n"1,5","x ""y"""\n'), [['a', 'b'], ['1,5', 'x "y"']]);
  assert.equal(F.parseDate('3/15/2025'), '2025-03-15');
  assert.equal(F.parseDate('15/03/2025'), '2025-03-15');
  assert.equal(F.parseDate('2025-02-30'), null);
  assert.equal(F.parseMoney('$28,500.50'), 2850050);
  assert.equal(F.parseMoney('abc'), null);
  assert.equal(F.mapType('Pérgola con techo'), 'patio_cover');
  assert.equal(F.mapType('Outdoor kitchen'), 'outdoor_kitchen');
});

test('pagos parciales a subs: por invoice y por acuerdo, con forma de pago y referencia', async () => {
  const { srv, owner, job, sub } = await start();
  try {
    const d = (await owner.get(`/api/jobs/${job.id}`)).body;
    const pedro = d.subs.find(s => s.name === 'Pedro');
    const before = (await owner.get(`/api/jobs/${job.id}`)).body.money;
    // Invoice de $1,000 aprobado (desde un acuerdo de $1,000)
    const inv = (await sub.post('/api/docs', { job_id: job.id, type: 'invoice', date: '2026-11-05', description: 'Estructura', lines: [{ desc: 'Postes', qty: 1, unit_cents: 100000 }] })).body;
    await owner.post(`/api/docs/${inv.id}/decide`, { action: 'accept', add_to_agreed: false });
    // Pago parcial 1: Zelle $400
    let r = await owner.post(`/api/subs/${pedro.id}/payments`, { doc_id: inv.id, amount_cents: 40000, date: '2026-11-06', method: 'Zelle', reference: 'ZL-881' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    let doc = (await owner.get('/api/docs')).body.find(x => x.id === inv.id);
    assert.equal(doc.paid_cents, 40000); assert.equal(doc.paid_at, '', 'parcial: todavía no está pagado');
    // No se puede pagar más de lo que falta
    assert.equal((await owner.post(`/api/subs/${pedro.id}/payments`, { doc_id: inv.id, amount_cents: 70000, date: '2026-11-07', method: 'Cheque' })).status, 400);
    // Pago 2: cheque $600 → queda pagado
    await owner.post(`/api/subs/${pedro.id}/payments`, { doc_id: inv.id, amount_cents: 60000, date: '2026-11-08', method: 'Cheque', reference: '#1042' });
    doc = (await owner.get('/api/docs')).body.find(x => x.id === inv.id);
    assert.equal(doc.paid_at, '2026-11-08'); assert.equal(doc.paid_method, 'Cheque'); assert.equal(doc.payments.length, 2);
    // El invoice ya es gasto: pagarlo no suma otro gasto
    let m = (await owner.get(`/api/jobs/${job.id}`)).body.money;
    assert.equal(m.spent, before.spent + 100000);
    assert.equal(m.subsPaid, before.subsPaid + 100000);
    // Pago al acuerdo (sin invoice) por depósito directo: sí es gasto
    r = await owner.post(`/api/subs/${pedro.id}/payments`, { amount_cents: 25000, date: '2026-11-10', method: 'Depósito directo', reference: 'ACH 5521' });
    m = (await owner.get(`/api/jobs/${job.id}`)).body.money;
    assert.equal(m.spent, before.spent + 125000);
    assert.equal(m.subsOwed, 200000 - 125000, 'acordado $2,000 (Pedro + Luis) − pagado $1,250');
    // El sub ve sus pagos con forma de pago y referencia
    const mine = (await sub.get('/api/subs/statement')).body;
    const pays = mine.jobs[0].payments;
    assert.equal(pays.length, 3);
    assert.ok(pays.some(p => p.method === 'Depósito directo' && p.reference === 'ACH 5521'));
    assert.equal((await sub.post(`/api/subs/${pedro.id}/payments`, { amount_cents: 100, date: '2026-11-10', method: 'Zelle' })).status, 403);
    // Borrar el pago directo borra su gasto
    const direct = (await owner.get(`/api/subs/${pedro.id}/payments`)).body.payments.find(p => !p.doc_id);
    await owner.del(`/api/sub-payments/${direct.id}`, { reason: 'Se registró doble' });
    m = (await owner.get(`/api/jobs/${job.id}`)).body.money;
    assert.equal(m.spent, before.spent + 100000);
    // Borrar un pago del invoice lo regresa a parcial
    const p2 = (await owner.get(`/api/subs/${pedro.id}/payments`)).body.payments.find(p => p.reference === '#1042');
    await owner.del(`/api/sub-payments/${p2.id}`, { reason: 'El cheque rebotó' });
    doc = (await owner.get('/api/docs')).body.find(x => x.id === inv.id);
    assert.equal(doc.paid_at, ''); assert.equal(doc.paid_cents, 40000);
    // Forma de pago inválida
    assert.equal((await owner.post(`/api/subs/${pedro.id}/payments`, { amount_cents: 100, date: '2026-11-10', method: 'Bitcoin' })).status, 400);
    // Pago registrado a la antigua (gasto con sub) entra al registro de pagos
    await owner.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 5000, description: 'Pago cheque #77', vendor: 'Cheque #77', category: 'subcontratistas', date: '2026-11-12', sub_id: pedro.id });
    const all = (await owner.get(`/api/subs/${pedro.id}/payments`)).body.payments;
    assert.ok(all.some(p => p.amount_cents === 5000 && p.method === 'Cheque'));
  } finally { srv.close(); }
});
