'use strict';
// Estimados e invoices de subs: permisos, conversión, gasto automático y ganancia.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-docs-'));
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
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.arrayBuffer() };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: (u, b = {}) => call('DELETE', u, b) };
}
const owner = client(), roof = client(), elec = client(), cli = client();
let job, other, roofId, est, inv1;
const money = async () => (await owner.get(`/api/jobs/${job}`)).data.money;

test('preparación', async () => {
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  const mk = async (u, role) => (await owner.post('/api/users', { name: u, username: u, password: 'contrasena-' + u, role, trade: 'Roofing' })).data.id;
  roofId = await mk('roofer', 'worker'); const elecId = await mk('electric', 'worker'); const cid = await mk('client1', 'client');
  for (const [c, u] of [[roof, 'roofer'], [elec, 'electric'], [cli, 'client1']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await owner.post('/api/jobs', { client_name: 'Smith', project_type: 'patio_cover', status: 'activo', quoted_cents: 3000000 })).data.id;
  other = (await owner.post('/api/jobs', { client_name: 'Jones', project_type: 'fire_pit', status: 'activo' })).data.id;
  await owner.put(`/api/jobs/${job}`, { client_user_id: cid });
  const tasks = (await owner.get(`/api/jobs/${job}`)).data.tasks;
  await owner.put(`/api/tasks/${tasks[8].id}`, { assignee_id: roofId });
  await owner.put(`/api/tasks/${tasks[9].id}`, { assignee_id: elecId });
});

test('el sub manda un estimado (el total lo calcula el servidor)', async () => {
  assert.equal((await roof.post('/api/docs', { job_id: other, type: 'estimate', lines: [{ desc: 'x', qty: 1, unit_cents: 100 }] })).status, 404, 'no es su obra');
  assert.equal((await roof.post('/api/docs', { job_id: job, type: 'estimate', lines: [] })).status, 400);
  assert.equal((await roof.post('/api/docs', { job_id: job, type: 'estimate', lines: [{ desc: 'Tejas', qty: 0, unit_cents: 100 }] })).status, 400);
  const r = await roof.post('/api/docs', { job_id: job, type: 'estimate', description: 'Techo completo', total_cents: 1,
    lines: [{ desc: 'Tejas', qty: 20, unit_cents: 15000 }, { desc: 'Mano de obra', qty: 1, unit_cents: 200000 }], file: PDF });
  assert.equal(r.status, 200);
  est = r.data;
  assert.equal(est.total_cents, 500000, '20 x $150 + $2,000 = $5,000 (ignora el total falso)');
  assert.equal(est.number, 'EST-0001'); assert.equal(est.status, 'enviado'); assert.ok(est.file_id);
  assert.equal((await owner.get('/api/status')).data.user.pending, 1, 'al dueño le aparece por revisar');
  assert.equal((await elec.get('/api/docs')).data.length, 0, 'otro sub no lo ve');
  assert.equal((await elec.get(`/files/${est.file_id}`)).status, 404);
  assert.equal((await roof.get(`/files/${est.file_id}`)).status, 200, 'el sub ve su propio archivo');
  assert.equal((await cli.get(`/files/${est.file_id}`)).status, 404, 'el cliente nunca');
  assert.equal((await cli.get('/api/docs')).status, 403);
  assert.equal((await roof.post(`/api/docs/${est.id}/decide`, { action: 'accept' })).status, 403, 'el sub no se aprueba solo');
});

test('estimado aceptado: se suma a lo acordado, todavía no es gasto', async () => {
  const before = await money();
  const r = await owner.post(`/api/docs/${est.id}/decide`, { action: 'accept' });
  assert.equal(r.data.status, 'aceptado');
  const m = await money();
  assert.equal(m.spent, before.spent, 'no cambia el gasto');
  assert.equal(m.subsAgreed, 500000);
  assert.equal(m.subsOwed, 500000);
  assert.equal((await owner.post(`/api/docs/${est.id}/decide`, { action: 'accept' })).status, 400, 'no se decide dos veces');
});

test('el sub convierte el estimado en invoice (pago parcial) y el dueño lo aprueba: gasto y ganancia automáticos', async () => {
  assert.equal((await elec.post('/api/docs', { job_id: job, type: 'invoice', from_estimate_id: est.id, lines: [{ desc: 'x', qty: 1, unit_cents: 1 }] })).status, 404, 'estimado ajeno');
  const r = await roof.post('/api/docs', { job_id: job, type: 'invoice', from_estimate_id: est.id, number: 'R-778', due_date: '2026-12-15',
    lines: [{ desc: '50% techo', qty: 1, unit_cents: 250000 }] });
  assert.equal(r.status, 200);
  inv1 = r.data;
  assert.equal(inv1.estimate.number, 'EST-0001'); assert.equal(inv1.number, 'R-778');
  const estNow = (await roof.get('/api/docs')).data.find(d => d.id === est.id);
  assert.equal(estNow.invoiced_cents, 250000, 'el estimado muestra lo facturado');
  const before = await money();
  const a = await owner.post(`/api/docs/${inv1.id}/decide`, { action: 'accept' });
  assert.equal(a.data.status, 'aprobado'); assert.ok(a.data.expense_id);
  const m = await money();
  assert.equal(m.spent, before.spent + 250000, 'el invoice aprobado es gasto');
  assert.equal(m.profit, before.profit - 250000, 'la ganancia baja sola');
  assert.equal(m.subsAgreed, 500000, 'viene de un estimado: no se suma otra vez a lo acordado');
  assert.equal(m.unpaidInvoices, 250000);
  assert.equal(m.subsOwed, 500000, 'debemos: $2,500 por facturar + $2,500 aprobado sin pagar');
  const exp = (await owner.get(`/api/jobs/${job}`)).data.expenses.find(e => e.id === a.data.expense_id);
  assert.equal(exp.category, 'subcontratistas'); assert.equal(exp.amount_cents, 250000);
  assert.equal((await owner.del(`/api/expenses/${exp.id}`, { reason: 'prueba' })).status, 400, 'no se borra por error');
});

test('marcar pagado no crea otro gasto (no se cuenta doble)', async () => {
  const before = await money();
  assert.equal((await owner.post(`/api/docs/${est.id}/paid`)).status, 400, 'un estimado no se paga');
  const r = await owner.post(`/api/docs/${inv1.id}/paid`, { method: 'Zelle', date: '2026-12-01' });
  assert.equal(r.data.paid_at, '2026-12-01');
  const m = await money();
  assert.equal(m.spent, before.spent, 'el gasto no cambia');
  assert.equal(m.unpaidInvoices, 0);
  assert.equal(m.subsOwed, 250000, 'solo queda lo que falta facturar');
});

test('invoice sin estimado: se suma a lo acordado; puede venir ya pagado; rechazado no es gasto', async () => {
  const i2 = (await elec.post('/api/docs', { job_id: job, type: 'invoice', lines: [{ desc: 'Rough electrical', qty: 1, unit_cents: 180000 }] })).data;
  assert.equal(i2.number, 'INV-0001');
  const before = await money();
  const a = await owner.post(`/api/docs/${i2.id}/decide`, { action: 'accept', paid: true, paid_method: 'Cheque #55' });
  assert.equal(a.data.paid_method, 'Cheque');
  assert.equal(a.data.payments.length, 1);
  assert.ok(a.data.payments[0].reference.includes('#55'));
  const m = await money();
  assert.equal(m.spent, before.spent + 180000);
  assert.equal(m.subsAgreed, before.subsAgreed + 180000);
  assert.equal(m.subsOwed, before.subsOwed, 'aprobado y pagado: no cambia lo que se debe');
  const i3 = (await elec.post('/api/docs', { job_id: job, type: 'invoice', lines: [{ desc: 'Extra', qty: 2.5, unit_cents: 10000 }] })).data;
  assert.equal(i3.total_cents, 25000, '2.5 x $100');
  await owner.post(`/api/docs/${i3.id}/decide`, { action: 'reject', note: 'No estaba acordado' });
  const m2 = await money();
  assert.equal(m2.spent, m.spent, 'rechazado: no es gasto');
  const seen = (await elec.get('/api/docs')).data.find(d => d.id === i3.id);
  assert.equal(seen.status, 'rechazado'); assert.equal(seen.owner_note, 'No estaba acordado');
});

test('el sub puede corregir o retirar antes de la revisión; el cliente nunca ve nada de esto', async () => {
  const d = (await elec.post('/api/docs', { job_id: job, type: 'estimate', lines: [{ desc: 'Luces', qty: 4, unit_cents: 5000 }] })).data;
  const e = await elec.put(`/api/docs/${d.id}`, { lines: [{ desc: 'Luces', qty: 6, unit_cents: 5000 }] });
  assert.equal(e.data.total_cents, 30000);
  assert.equal((await elec.del(`/api/docs/${d.id}`)).status, 200);
  const c = (await cli.get(`/api/jobs/${job}`)).data;
  const txt = JSON.stringify(c);
  assert.ok(!txt.includes('R-778') && !txt.includes('Rough electrical') && c.money.spent === undefined);
  assert.equal((await owner.post('/api/docs', { job_id: job, type: 'invoice', lines: [{ desc: 'x', qty: 1, unit_cents: 1 }] })).status, 403, 'los documentos los manda el sub');
});

test('correcciones: el sub corrige un estimado ya aceptado; nada cambia hasta que el dueño apruebe', async () => {
  const e = (await elec.post('/api/docs', { job_id: job, type: 'estimate', lines: [{ desc: 'Panel', qty: 1, unit_cents: 100000 }] })).data;
  await owner.post(`/api/docs/${e.id}/decide`, { action: 'accept' });
  const base0 = await money();
  // se le olvidó un renglón: sin permiso NO puede cambiarlo
  const NEW = { reason: 'Se me olvidó el cable', lines: [{ desc: 'Panel', qty: 1, unit_cents: 100000 }, { desc: 'Cable', qty: 1, unit_cents: 20000 }] };
  assert.equal((await elec.put(`/api/docs/${e.id}`, NEW)).status, 403, 'aceptado: sin autorización no se cambia');
  assert.equal((await elec.post(`/api/docs/${e.id}/unlock`, {})).status, 400, 'hay que decir por qué');
  const ask = await elec.post(`/api/docs/${e.id}/unlock`, { reason: 'Se me olvidó el cable' });
  assert.equal(ask.data.unlock, 'pedido');
  assert.equal((await elec.post(`/api/docs/${e.id}/unlock-decide`, { action: 'authorize' })).status, 403, 'el sub no se autoriza solo');
  assert.equal((await elec.put(`/api/docs/${e.id}`, NEW)).status, 403, 'pedido pero no autorizado');
  assert.ok((await owner.get('/api/status')).data.user.pending >= 1, 'al dueño le aparece la solicitud');
  await owner.post(`/api/docs/${e.id}/unlock-decide`, { action: 'authorize', note: 'Ok, corrígelo' });
  const r = await elec.put(`/api/docs/${e.id}`, NEW);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'enviado'); assert.equal(r.data.prev.total_cents, 100000); assert.equal(r.data.total_cents, 120000);
  assert.equal((await money()).subsAgreed, base0.subsAgreed, 'todavía no cambia lo acordado');
  assert.equal((await elec.del(`/api/docs/${e.id}`)).status, 400, 'una corrección no se puede retirar como si fuera nuevo');
  const a = await owner.post(`/api/docs/${e.id}/decide`, { action: 'accept' });
  assert.equal(a.data.status, 'aceptado'); assert.equal(a.data.prev, null);
  assert.equal((await money()).subsAgreed, base0.subsAgreed + 20000, 'se ajusta solo por la diferencia');
  assert.deepEqual(a.data.history.map(h => h.action), ['enviado', 'aceptado', 'permiso_pedido', 'permiso_autorizado', 'correccion_pedida', 'correccion_aprobada']);
  assert.equal(a.data.history[2].note, 'Se me olvidó el cable');
  assert.equal(a.data.unlock, '', 'el permiso se usa una sola vez');
  assert.equal((await elec.put(`/api/docs/${e.id}`, NEW)).status, 403, 'para otro cambio hay que pedir permiso otra vez');
});

test('correcciones: invoice aprobado corregido por el sub y rechazado por el dueño vuelve a la versión aprobada', async () => {
  const i = (await elec.post('/api/docs', { job_id: job, type: 'invoice', lines: [{ desc: 'Trim', qty: 1, unit_cents: 50000 }] })).data;
  await owner.post(`/api/docs/${i.id}/decide`, { action: 'accept' });
  const m0 = await money();
  await elec.post(`/api/docs/${i.id}/unlock`, { reason: 'Fueron más horas' });
  await owner.post(`/api/docs/${i.id}/unlock-decide`, { action: 'authorize' });
  await elec.put(`/api/docs/${i.id}`, { lines: [{ desc: 'Trim', qty: 1, unit_cents: 90000 }] });
  assert.equal((await money()).spent, m0.spent, 'el gasto no cambia mientras se revisa');
  const r = await owner.post(`/api/docs/${i.id}/decide`, { action: 'reject', note: 'Quedamos en $500' });
  assert.equal(r.data.status, 'aprobado'); assert.equal(r.data.total_cents, 50000); assert.equal(r.data.lines[0].unit_cents, 50000);
  assert.equal((await money()).spent, m0.spent);
});

test('correcciones: el dueño corrige un número y el gasto y la ganancia se ajustan solos', async () => {
  const i = (await elec.post('/api/docs', { job_id: job, type: 'invoice', lines: [{ desc: 'Fans', qty: 2, unit_cents: 30000 }] })).data;
  await owner.post(`/api/docs/${i.id}/decide`, { action: 'accept' });
  const m0 = await money();
  const r = await owner.put(`/api/docs/${i.id}`, { reason: 'Era 3 ventiladores', lines: [{ desc: 'Fans', qty: 3, unit_cents: 30000 }] });
  assert.equal(r.data.status, 'aprobado'); assert.equal(r.data.total_cents, 90000);
  const m = await money();
  assert.equal(m.spent, m0.spent + 30000); assert.equal(m.profit, m0.profit - 30000);
  assert.equal(m.subsAgreed, m0.subsAgreed + 30000);
  const exp = (await owner.get(`/api/jobs/${job}`)).data.expenses.find(x => x.id === r.data.expense_id);
  assert.equal(exp.amount_cents, 90000);
  assert.equal(r.data.history.at(-1).action, 'corregido_dueno');
});

test('correcciones: pagado no se cambia; rechazado se corrige y se reenvía; nadie corrige lo ajeno', async () => {
  assert.equal((await roof.put(`/api/docs/${inv1.id}`, { lines: [{ desc: 'x', qty: 1, unit_cents: 1 }] })).status, 400, 'ya pagado');
  assert.equal((await owner.put(`/api/docs/${inv1.id}`, { lines: [{ desc: 'x', qty: 1, unit_cents: 1 }] })).status, 400, 'ya pagado, tampoco el dueño');
  const rej = (await elec.get('/api/docs')).data.find(d => d.status === 'rechazado');
  assert.equal((await roof.put(`/api/docs/${rej.id}`, { lines: [{ desc: 'x', qty: 1, unit_cents: 1 }] })).status, 404);
  const r = await elec.put(`/api/docs/${rej.id}`, { lines: [{ desc: 'Extra acordado', qty: 1, unit_cents: 20000 }] });
  assert.equal(r.data.status, 'enviado'); assert.equal(r.data.history.at(-1).action, 'reenviado');
});

test('permiso negado: sigue sin poder cambiarlo', async () => {
  const e = (await elec.post('/api/docs', { job_id: job, type: 'estimate', lines: [{ desc: 'Bocinas', qty: 2, unit_cents: 10000 }] })).data;
  await owner.post(`/api/docs/${e.id}/decide`, { action: 'accept' });
  await elec.post(`/api/docs/${e.id}/unlock`, { reason: 'Quiero subir el precio' });
  assert.equal((await elec.post(`/api/docs/${e.id}/unlock`, { reason: 'otra vez' })).status, 400, 'no se pide dos veces');
  const r = await owner.post(`/api/docs/${e.id}/unlock-decide`, { action: 'deny', note: 'Se queda como se acordó' });
  assert.equal(r.data.unlock, 'negado');
  assert.equal((await elec.put(`/api/docs/${e.id}`, { lines: [{ desc: 'Bocinas', qty: 2, unit_cents: 20000 }] })).status, 403);
});

test('change orders del sub sobre un estimado aceptado: se suman a lo acordado y al total del estimado', async () => {
  const e = (await roof.post('/api/docs', { job_id: job, type: 'estimate', lines: [{ desc: 'Techo nuevo', qty: 1, unit_cents: 400000 }] })).data;
  assert.equal((await roof.post('/api/docs', { job_id: job, type: 'change_order', from_estimate_id: e.id, lines: [{ desc: 'x', qty: 1, unit_cents: 1 }] })).status, 400, 'solo sobre estimado aceptado');
  assert.equal((await roof.post('/api/docs', { job_id: job, type: 'change_order', lines: [{ desc: 'x', qty: 1, unit_cents: 1 }] })).status, 400, 'necesita estimado');
  await owner.post(`/api/docs/${e.id}/decide`, { action: 'accept' });
  const m0 = await money();
  const co = (await roof.post('/api/docs', { job_id: job, type: 'change_order', from_estimate_id: e.id, description: 'Agregar canaletas', lines: [{ desc: 'Canaletas', qty: 40, unit_cents: 1200 }] })).data;
  assert.equal(co.number, 'CO-0001'); assert.equal(co.total_cents, 48000);
  let est = (await roof.get('/api/docs')).data.find(d => d.id === e.id);
  assert.equal(est.with_cos_cents, 400000, 'pendiente: todavía no cuenta');
  assert.equal(est.change_orders.length, 1);
  await owner.post(`/api/docs/${co.id}/decide`, { action: 'accept' });
  est = (await roof.get('/api/docs')).data.find(d => d.id === e.id);
  assert.equal(est.with_cos_cents, 448000);
  const m = await money();
  assert.equal(m.subsAgreed, m0.subsAgreed + 48000, 'se suma a lo acordado');
  assert.equal(m.spent, m0.spent, 'todavía no es gasto');
});

test('PDF: estimado con change orders, invoice y contrato del cliente; cada quien ve solo lo suyo', async () => {
  const est = (await roof.get('/api/docs')).data.find(d => d.type === 'estimate' && d.change_orders && d.change_orders.length);
  const pdf = await roof.get(`/api/docs/${est.id}/pdf`);
  assert.equal(pdf.status, 200);
  const txt = Buffer.from(pdf.data).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4') && txt.trimEnd().endsWith('%%EOF'));
  assert.ok(txt.includes('CO-0001') && txt.includes('Agregar canaletas'), 'incluye el change order');
  assert.ok(txt.includes('TOTAL CON CHANGE ORDERS'));
  assert.ok(txt.includes('$4,480.00'), 'total con change orders');
  const en = Buffer.from((await owner.get(`/api/docs/${est.id}/pdf?lang=en`)).data).toString('latin1');
  assert.ok(en.includes('TOTAL WITH CHANGE ORDERS'));
  assert.equal((await elec.get(`/api/docs/${est.id}/pdf`)).status, 404, 'otro sub no');
  assert.equal((await cli.get(`/api/docs/${est.id}/pdf`)).status, 403, 'el cliente no');
  const inv = Buffer.from((await owner.get(`/api/docs/${inv1.id}/pdf`)).data).toString('latin1');
  assert.ok(inv.includes('INVOICE') && inv.includes('PAGADO') && inv.includes('EST-0001'));
  // contrato para el cliente: precio, change orders aprobados, pagos y saldo; nunca costos
  await owner.post(`/api/jobs/${job}/changes`, { description: 'Ventilador extra', cost_cents: 11111, price_cents: 60000, status: 'aprobado' });
  await owner.post(`/api/jobs/${job}/payments`, { amount_cents: 1000000, method: 'Cheque' });
  const c = await cli.get(`/api/jobs/${job}/pdf`);
  assert.equal(c.status, 200);
  const ct = Buffer.from(c.data).toString('latin1');
  assert.ok(ct.includes('Ventilador extra') && ct.includes('$30,600.00') && ct.includes('$20,600.00'), 'contrato $30,600 y saldo $20,600');
  assert.ok(!ct.includes('111.11'), 'el costo interno nunca sale en el PDF del cliente');
  assert.equal((await roof.get(`/api/jobs/${job}/pdf`)).status, 403, 'el sub no ve el contrato del cliente');
});
