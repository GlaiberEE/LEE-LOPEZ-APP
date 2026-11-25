'use strict';
// v2.17 (Fase 2): tickets con número, subtotal + 8.25%, forma de pago, bloqueo de duplicados,
// dividir entre obras / empresa / personal, gastos generales de la empresa y CSV para la contadora.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const R = require('../lib/receipts');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-rcp-'));
  const srv = createServer({ dataDir: dir, ...opts });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
    };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: u => call('DELETE', u) };
  };
  const owner = client();
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
  await owner.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
  const mk = async (name, role) => (await owner.post('/api/users', { name, username: name.toLowerCase(), password: 'otra-clave-larga-1', role })).body.id;
  const pedro = await mk('Pedro', 'worker'); const mario = await mk('Mario', 'pm'); await mk('Jacky', 'owner');
  const a = (await owner.post('/api/jobs', { client_name: 'Melbourne', status: 'activo' })).body.id;
  const b = (await owner.post('/api/jobs', { client_name: 'Kilmichael', status: 'activo' })).body.id;
  await owner.post(`/api/jobs/${a}/subs`, { name: 'Pedro', user_id: pedro });
  await owner.put(`/api/jobs/${b}`, { pm_id: mario });
  const line = (await owner.post(`/api/jobs/${b}/lines`, { code: 'PC-01', trade: 'Roofing', sold_cents: 500000 })).body.id;
  const as = async u => { const c = client(); await c.post('/api/login', { username: u, password: 'otra-clave-larga-1' }); return c; };
  return { srv, owner, a, b, line, pedro, sub: await as('pedro'), pm: await as('mario'), jack: await as('jacky') };
}

test('impuesto repartido sin perder centavos; claves de tienda y ticket', () => {
  const lines = [{ subtotal_cents: 15000 }, { subtotal_cents: 10000 }, { subtotal_cents: 3333 }];
  const t = R.splitTax(lines, 2337);
  assert.equal(t.reduce((x, y) => x + y, 0), 2337);
  assert.equal(R.vkey("LOWE'S HOME IMPROVEMENT #1234"), 'lowes'); assert.equal(R.vkey('The Home Depot'), 'homedepot');
  assert.equal(R.tkey('#053997'), '53997'); assert.equal(R.tkey('53997'), '53997');
});

test('ticket a una obra: subtotal + 8.25% = total, foto pegada al gasto, ajustes', async () => {
  const T = await start();
  try {
    const st = (await T.owner.get('/api/receipts/settings')).body;
    assert.equal(st.tax_rate_bp, 825); assert.ok(st.vendors.includes("Lowe's") && st.vendors.includes('Leroy Jordan'));
    const r = await T.owner.post('/api/receipts', { vendor: "Lowe's", ticket: '53997', date: '2026-10-23', pay_method: 'tarjeta', subtotal_cents: 100000, photo: PNG,
      lines: [{ kind: 'obra', job_id: T.a, category: 'material', description: 'Lumber' }].map(l => ({ ...l, subtotal_cents: 100000 })) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.tax_cents, r.body.total_cents], [8250, 108250]);
    const e = T.srv.db.prepare('SELECT * FROM expenses WHERE id=?').get(r.body.expenses[0]);
    assert.deepEqual([e.amount_cents, e.subtotal_cents, e.tax_cents, e.ticket, e.pay_method, e.receipt_id], [108250, 100000, 8250, '53997', 'tarjeta', r.body.id]);
    assert.ok(T.srv.db.prepare("SELECT 1 FROM files WHERE expense_id=? AND kind='receipt'").get(e.id), 'foto pegada al gasto');
    assert.equal((await T.owner.get(`/api/receipts/${r.body.id}/file`)).status, 200);
    // El impuesto se puede escribir a mano (por ejemplo, entrega sin impuesto).
    const r2 = (await T.owner.post('/api/receipts', { vendor: 'ABC Supply', ticket: 'A-1', date: '2026-11-01', subtotal_cents: 45000, tax_cents: 0, lines: [{ job_id: T.a, subtotal_cents: 45000 }] })).body;
    assert.equal(r2.total_cents, 45000);
    // Cambiar el impuesto: solo un dueño.
    assert.equal((await T.pm.put('/api/receipts/settings', { tax_rate_bp: 800 })).status, 403);
    assert.equal((await T.owner.put('/api/receipts/settings', { tax_rate_bp: 800 })).body.tax_rate_bp, 800);
    assert.equal((await T.owner.put('/api/receipts/settings', { tax_rate_bp: 5000 })).status, 400);
  } finally { T.srv.close(); }
});

test('dividir un ticket entre obras, partida, empresa y personal', async () => {
  const T = await start();
  try {
    const body = { vendor: 'Home Depot', ticket: '7788', date: '2026-11-10', pay_method: 'tarjeta', subtotal_cents: 30000, lines: [
      { kind: 'obra', job_id: T.a, category: 'material', subtotal_cents: 15000 },
      { kind: 'obra', job_id: T.b, line_id: T.line, category: 'material', subtotal_cents: 10000 },
      { kind: 'empresa', category: 'herramienta', description: 'Taladro DeWalt', subtotal_cents: 3000 },
      { kind: 'personal', subtotal_cents: 2000 }] };
    assert.equal((await T.owner.post('/api/receipts', { ...body, subtotal_cents: 31000 })).status, 400, 'los renglones deben sumar el subtotal');
    const r = (await T.owner.post('/api/receipts', body)).body;
    assert.equal(r.total_cents, 32475); assert.equal(r.expenses.length, 2); assert.equal(r.company.length, 1);
    const ex = T.srv.db.prepare('SELECT * FROM expenses WHERE receipt_id=? ORDER BY id').all(r.id);
    const co = T.srv.db.prepare('SELECT * FROM company_expenses WHERE receipt_id=?').get(r.id);
    assert.equal(ex[1].line_id, T.line, 'a su partida');
    assert.equal(ex.reduce((s, e) => s + e.amount_cents, 0) + co.amount_cents + r.personal_cents, 32475, 'todo cuadra con el total');
    assert.equal(r.personal_cents, 2000 + 165, 'lo personal no es gasto, solo queda anotado');
    assert.equal(co.category, 'herramienta');
    const list = (await T.owner.get('/api/receipts?from=2026-11-01')).body;
    assert.deepEqual(list[0].lines.map(l => l.kind), ['obra', 'obra', 'empresa', 'personal']);
    assert.equal((await T.owner.post('/api/receipts', { vendor: 'X', date: '2026-11-10', subtotal_cents: 100, lines: [{ kind: 'personal', subtotal_cents: 100 }] })).status, 400);
  } finally { T.srv.close(); }
});

test('bloqueo de duplicados: misma tienda + mismo ticket; solo un dueño lo pasa con motivo', async () => {
  const T = await start();
  try {
    const t1 = { vendor: "Lowe's", ticket: '53997', date: '2026-10-23', subtotal_cents: 1000, lines: [{ job_id: T.a, subtotal_cents: 1000 }] };
    assert.equal((await T.owner.post('/api/receipts', t1)).status, 200);
    const again = await T.owner.post('/api/receipts', { ...t1, vendor: "LOWE'S HOME IMPROVEMENT", ticket: '#053997', date: '2026-10-24' });
    assert.equal(again.status, 409); assert.equal(again.body.canOverride, true); assert.match(again.body.error, /ya está registrado/);
    assert.equal((await T.sub.post('/api/receipts', { ...t1, dup_reason: 'otro' })).status, 409, 'el sub no lo puede pasar');
    assert.equal((await T.pm.post('/api/receipts', { ...t1, lines: [{ job_id: T.b, subtotal_cents: 1000 }], dup_reason: 'otro' })).status, 409, 'el PM tampoco');
    assert.equal((await T.owner.post('/api/receipts', { ...t1, dup_reason: 'Devolución y recompra' })).status, 200);
    assert.ok(T.srv.db.prepare("SELECT 1 FROM audit_log WHERE entity='ticket' AND reason LIKE 'Duplicado autorizado%'").get());
    // Otra tienda con el mismo número: no es duplicado.
    assert.equal((await T.owner.post('/api/receipts', { ...t1, vendor: 'Home Depot' })).status, 200);
    // Sin número: mismo total, fecha y tienda = "parece repetido", se confirma.
    const n = { vendor: 'Amazon', date: '2026-11-02', subtotal_cents: 5000, lines: [{ job_id: T.a, subtotal_cents: 5000 }] };
    assert.equal((await T.owner.post('/api/receipts', n)).status, 200);
    const p = await T.owner.post('/api/receipts', n); assert.equal(p.status, 409); assert.equal(p.body.possible, true);
    assert.equal((await T.owner.post('/api/receipts', { ...n, confirm_dup: true })).status, 200);
    // Un gasto a mano con el mismo número de ticket también se bloquea.
    const m = await T.owner.post(`/api/jobs/${T.a}/expenses`, { date: '2026-10-25', category: 'material', description: 'x', vendor: "Lowe's", amount_cents: 500, ticket: '53997' });
    assert.equal(m.status, 409);
  } finally { T.srv.close(); }
});

test('quién puede qué: el sub solo a sus obras, nada de empresa; el PM con sus límites', async () => {
  const T = await start();
  try {
    assert.equal((await T.sub.post('/api/receipts', { vendor: 'HD', date: '2026-11-05', subtotal_cents: 2000, lines: [{ job_id: T.a, subtotal_cents: 2000 }] })).status, 200);
    assert.equal((await T.sub.post('/api/receipts', { vendor: 'HD', date: '2026-11-05', subtotal_cents: 2100, lines: [{ job_id: T.b, subtotal_cents: 2100 }] })).status, 404);
    assert.equal((await T.sub.post('/api/receipts', { vendor: 'HD', date: '2026-11-05', subtotal_cents: 2200, lines: [{ kind: 'empresa', category: 'herramienta', subtotal_cents: 2200 }] })).status, 403);
    assert.equal((await T.sub.get('/api/receipts')).status, 403);
    assert.equal((await T.pm.post('/api/receipts', { vendor: 'HD', date: '2026-11-05', subtotal_cents: 2300, lines: [{ kind: 'empresa', category: 'herramienta', subtotal_cents: 2300 }] })).status, 403);
    assert.equal((await T.pm.post('/api/receipts', { vendor: 'HD', ticket: '1', date: '2026-11-05', subtotal_cents: 4000, lines: [{ job_id: T.b, subtotal_cents: 4000 }] })).status, 200);
    const big = await T.pm.post('/api/receipts', { vendor: 'HD', ticket: '2', date: '2026-11-05', subtotal_cents: 900000, lines: [{ job_id: T.b, subtotal_cents: 900000 }] });
    assert.equal(big.status, 428, 'arriba de su límite pide motivo y espera a un dueño');
    const big2 = await T.pm.post('/api/receipts', { vendor: 'HD', ticket: '2', date: '2026-11-05', subtotal_cents: 900000, lines: [{ job_id: T.b, subtotal_cents: 900000 }], reason: 'Material de todo el techo' });
    assert.equal(big2.body.pending, true); assert.equal(T.srv.db.prepare("SELECT COUNT(*) n FROM receipts WHERE ticket='2'").get().n, 0, 'no se aplica hasta que un dueño lo apruebe');
    // Un dueño que pagó con su dinero: lo autoriza el otro dueño.
    const own = await T.owner.post('/api/receipts', { vendor: 'HD', ticket: '3', date: '2026-11-05', pay_method: 'propio', subtotal_cents: 1000, lines: [{ job_id: T.a, subtotal_cents: 1000 }] });
    assert.equal(own.status, 428);
  } finally { T.srv.close(); }
});

test('gastos generales de la empresa, borrar un ticket, cierre de periodo y CSV para la contadora', async () => {
  const T = await start();
  try {
    const c = (await T.owner.post('/api/company-expenses', { date: '2026-11-03', category: 'gasolina', description: 'Gas truck', vendor: 'QT', amount_cents: 6500, pay_method: 'tarjeta' })).body;
    const r = (await T.owner.post('/api/receipts', { vendor: 'Home Depot', ticket: '9', date: '2026-11-04', subtotal_cents: 20000, lines: [{ kind: 'empresa', category: 'herramienta', description: 'Sierra', subtotal_cents: 12000 }, { job_id: T.a, subtotal_cents: 8000 }] })).body;
    const g = (await T.owner.get('/api/company-expenses?from=2026-11-01&to=2026-11-30')).body;
    assert.equal(g.rows.length, 2); assert.equal(g.by_category.gasolina, 6500); assert.equal(g.by_category.herramienta, 12990);
    assert.equal((await T.pm.get('/api/company-expenses')).status, 403); assert.equal((await T.sub.get('/api/company-expenses')).status, 403);
    assert.equal((await T.owner.put(`/api/company-expenses/${c.id}`, { description: 'Gasolina troca' })).status, 200);
    const fromTicket = g.rows.find(x => x.receipt_id);
    assert.equal((await T.owner.del(`/api/company-expenses/${fromTicket.id}`)).status, 400, 'viene de un ticket');
    const csv = (await T.owner.get('/api/accounting.csv?from=2026-11-01&to=2026-11-30')).body;
    assert.match(csv, /Company \(overhead\).*Fuel/); assert.match(csv, /Tools/); assert.match(csv, /"Melbourne"/);
    assert.equal((await T.pm.get('/api/accounting.csv')).status, 403);
    // Borrar el ticket borra sus renglones.
    assert.equal((await T.pm.del(`/api/receipts/${r.id}`)).status, 403);
    assert.equal((await T.owner.del(`/api/receipts/${r.id}`)).status, 200);
    assert.equal(T.srv.db.prepare('SELECT COUNT(*) n FROM expenses WHERE receipt_id=?').get(r.id).n, 0);
    assert.equal(T.srv.db.prepare('SELECT COUNT(*) n FROM company_expenses WHERE receipt_id=?').get(r.id).n, 0);
    // Periodo cerrado.
    await T.owner.put('/api/lock', { date: '2026-11-05' });
    assert.equal((await T.owner.post('/api/company-expenses', { date: '2026-11-05', category: 'otro', description: 'x', amount_cents: 100 })).status, 423);
    assert.equal((await T.owner.post('/api/receipts', { vendor: 'X', date: '2026-11-01', subtotal_cents: 100, lines: [{ job_id: T.a, subtotal_cents: 100 }] })).status, 423);
  } finally { T.srv.close(); }
});

test('ticket escaneado: lee el número y queda bloqueado para no registrarlo dos veces', async () => {
  const T = await start({ scanExtractor: async () => ({ vendor: 'Leroy Jordan', ticket: '912496', date: '2026-11-16', subtotal_cents: 50000, total_cents: 54125, tax_cents: 4125,
    items: ['Hardie board'], category: 'material', job_hint: 'EE-0001', text: 'EE-0001', doc_type: 'receipt' }) });
  try {
    const s0 = (await T.owner.post('/api/scans', { file: PNG })).body;
    const s = (await T.owner.post(`/api/scans/${s0.id}/file`, { job_id: s0.job_id || T.a, amount_cents: 54125, date: '2026-11-16', vendor: 'Leroy Jordan', category: 'material' })).body;
    assert.equal(s.status, 'guardado', JSON.stringify(s));
    const e = T.srv.db.prepare('SELECT * FROM expenses WHERE id=?').get(s.expense_id);
    assert.deepEqual([e.ticket, e.tax_cents, e.subtotal_cents], ['912496', 4125, 50000]);
    const again = await T.owner.post('/api/receipts', { vendor: 'Leroy Jordan', ticket: '912496', date: '2026-11-16', subtotal_cents: 50000, lines: [{ job_id: T.a, subtotal_cents: 50000 }] });
    assert.equal(again.status, 409);
    // Un ticket escaneado que quedó por asignar se registra (y divide) con el mismo formulario.
    const T2scan = (await T.owner.post('/api/scans', { file: PNG.replace('ggg', 'ggh') })).body;
    assert.ok(T2scan.duplicate, 'el segundo escaneo del mismo ticket sale como repetido');
  } finally { T.srv.close(); }
});
