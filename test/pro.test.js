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
  return { srv, dir, owner, job, sub: await as('pedro'), luis: await as('luis'), cli: await as('cliente'), subId };
}

const http = require('node:http');
const JPG = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'lib', 'assets', 'logo-print.jpg')).toString('base64');

test('firma del cliente: estimado y change order, PDF y pago en línea', async () => {
  const { srv, owner, job, cli, sub } = await start();
  try {
    await owner.put(`/api/jobs/${job.id}`, { status: 'cotizado', quoted_cents: 2500000, description: 'Patio cover 20x14', reason: 'Nuevo estimado' });
    let s = (await cli.get(`/api/jobs/${job.id}/signing`)).body;
    assert.equal(s.estimate.can_sign, true);
    assert.equal((await cli.post(`/api/jobs/${job.id}/sign`, { target: 'estimate', name: 'John Smith', signature: JPG })).status, 400, 'debe aceptar');
    assert.equal((await sub.post(`/api/jobs/${job.id}/sign`, { target: 'estimate', name: 'x', signature: JPG, agree: true })).status, 403);
    const r = await cli.post(`/api/jobs/${job.id}/sign`, { target: 'estimate', name: 'John Smith', signature: JPG, agree: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    s = (await cli.get(`/api/jobs/${job.id}/signing`)).body;
    assert.equal(s.estimate.can_sign, false);
    assert.equal(s.estimate.signature.valid, true);
    assert.equal((await cli.post(`/api/jobs/${job.id}/sign`, { target: 'estimate', name: 'John Smith', signature: JPG, agree: true })).status, 400, 'no dos veces');
    assert.ok((await owner.get('/api/status')).body.user.pending >= 0);
    // PDF con la firma
    const pdf = await owner.get(`/api/jobs/${job.id}/pdf?lang=en`);
    const txt = Buffer.from(pdf.body).toString('latin1');
    assert.ok(txt.includes('Electronically signed by John Smith'));
    // Si el dueño cambia el precio, la firma deja de valer
    await owner.put(`/api/jobs/${job.id}`, { quoted_cents: 2600000 });
    s = (await owner.get(`/api/jobs/${job.id}/signing`)).body;
    assert.equal(s.estimate.signature.valid, false);
    assert.equal(s.estimate.can_sign, true);
    // Change order firmado por el cliente queda aprobado
    const co = await owner.post(`/api/jobs/${job.id}/changes`, { description: 'Agregar ventilador', price_cents: 45000, cost_cents: 20000 });
    const r2 = await cli.post(`/api/jobs/${job.id}/sign`, { target: 'change_order', target_id: co.body.id, name: 'John Smith', signature: JPG, agree: true });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    const coRow = (await owner.get(`/api/jobs/${job.id}`)).body.changes.find(c => c.id === co.body.id);
    assert.equal(coRow.status, 'aprobado');
    // Imagen de firma: dueño y cliente sí, sub no
    assert.equal((await owner.get(`/api/signatures/${r.body.id}/image`)).status, 200);
    assert.equal((await sub.get(`/api/signatures/${r.body.id}/image`)).status, 403);
    // Pago en línea
    assert.equal((await owner.put('/api/settings', { pay_link: 'http://inseguro.com' })).status, 400);
    await owner.put('/api/settings', { pay_link: 'https://buy.stripe.com/test_123', pay_info: 'Zelle: pay@elevated.com' });
    s = (await cli.get(`/api/jobs/${job.id}/signing`)).body;
    assert.equal(s.pay, null, 'apagado por defecto: el cliente no ve nada de pagos');
    await owner.put('/api/settings', { pay_enabled: true });
    s = (await cli.get(`/api/jobs/${job.id}/signing`)).body;
    assert.equal(s.pay.link, 'https://buy.stripe.com/test_123');
    assert.equal(s.pay.info, 'Zelle: pay@elevated.com');
  } finally { srv.close(); }
});

test('presupuesto con alertas y reloj con GPS que crea el costo de mano de obra', async () => {
  const { srv, owner, job, sub, subId } = await start();
  try {
    await owner.put(`/api/jobs/${job.id}/budget`, { items: { material: 100000, mano_obra: 50000 } });
    await owner.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 95000, description: 'Madera', category: 'material', date: '2026-11-10' });
    const b = (await owner.get(`/api/jobs/${job.id}/budget`)).body;
    assert.equal(b.rows.find(r => r.category === 'material').pct, 95);
    const al = (await owner.get('/api/budget/alerts')).body;
    assert.equal(al.length, 1);
    assert.equal((await sub.get(`/api/jobs/${job.id}/budget`)).status, 403);
    // Reloj
    await owner.put(`/api/jobs/${job.id}/location`, { lat: 33.0640, lng: -97.1075 });
    await owner.put(`/api/users/${subId}/rate`, { rate_cents: 3000 });
    const i = await sub.post('/api/clock/in', { job_id: job.id, lat: 33.0641, lng: -97.1076, acc: 10 });
    assert.equal(i.status, 200, JSON.stringify(i.body));
    assert.ok(i.body.in_dist < 50, 'cerca de la obra');
    assert.equal(i.body.cost_cents, undefined, 'el sub no ve dinero');
    assert.equal((await sub.post('/api/clock/in', { job_id: job.id })).status, 400, 'no dos entradas');
    const o = await sub.post('/api/clock/out', { lat: 33.2, lng: -97.3 });
    assert.equal(o.status, 200);
    assert.ok(o.body.out_dist > 10000, 'salida lejos queda marcada');
    // El dueño corrige la hora (olvidó marcar): 4 horas → $120
    const t = (await owner.get('/api/time')).body.entries[0];
    const day = t.in_at.slice(0, 10);
    assert.equal((await owner.put(`/api/time/${t.id}`, { in_at: `${day} 13:00`, out_at: `${day} 17:00`, reason: 'Olvidó marcar' })).status, 200);
    const exps = (await owner.get(`/api/jobs/${job.id}`)).body.expenses.filter(e => e.category === 'mano_obra');
    assert.equal(exps.length, 1);
    assert.equal(exps[0].amount_cents, 12000);
    const tt = (await owner.get('/api/time')).body;
    assert.equal(tt.by_user[0].minutes, 240);
    assert.equal((await sub.get('/api/time')).status, 403);
    const csv = Buffer.from((await owner.get('/api/export/horas')).body).toString('utf8');
    assert.ok(csv.includes('4.00'));
    await owner.del?.(`/api/time/${t.id}`);
  } finally { srv.close(); }
});

test('permisos, reporte diario, garantía, prospectos web, reportes y exportar', async () => {
  const { srv, owner, job, cli, sub } = await start();
  try {
    const p = await owner.post(`/api/jobs/${job.id}/permits`, { kind: 'inspeccion', name: 'Inspección de zapatas', status: 'programada', date: '2026-11-20', notes: 'inspector: Bob' });
    assert.equal(p.status, 200);
    assert.equal((await owner.get('/api/permits/upcoming')).body.length, 1);
    const wp = (await sub.get(`/api/jobs/${job.id}/permits`)).body;
    assert.equal(wp.length, 1); assert.equal(wp[0].notes, undefined);
    assert.equal((await cli.get(`/api/jobs/${job.id}/permits`)).status, 403);
    // Reporte diario
    const l = await owner.post(`/api/jobs/${job.id}/logs`, { date: '2026-11-19', client_notes: 'Se colaron las zapatas.', internal_notes: 'Pedro llegó tarde', crew: 'Pedro, Luis', photos: [JPG] });
    assert.equal(l.status, 200, JSON.stringify(l.body));
    const cl = (await cli.get(`/api/jobs/${job.id}/logs`)).body;
    assert.equal(cl.length, 1); assert.equal(cl[0].internal_notes, undefined); assert.equal(cl[0].photos.length, 1);
    assert.equal((await cli.get(`/files/${cl[0].photos[0]}`)).status, 200);
    await owner.post(`/api/jobs/${job.id}/logs`, { client_notes: 'Interno', shared: false });
    assert.equal((await cli.get(`/api/jobs/${job.id}/logs`)).body.length, 1, 'el no compartido no lo ve');
    // Garantía
    await owner.put(`/api/jobs/${job.id}`, { status: 'terminado', completed_date: '2026-05-01' });
    const f = (await owner.get('/api/followups')).body.items;
    assert.ok(f.some(x => x.kind === 'm6'), JSON.stringify(f));
    await owner.post('/api/followups', { job_id: job.id, kind: 'm6' });
    assert.ok(!(await owner.get('/api/followups')).body.items.some(x => x.kind === 'm6'));
    // Prospecto web (sin sesión)
    const anon = { post: async (u, b) => { const r = await fetch(srv.base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; } };
    assert.equal((await anon.post('/api/public/lead', { name: 'Ann' })).status, 400);
    assert.equal((await anon.post('/api/public/lead', { name: 'Ann Lee', phone: '940-555-0100', project_type: 'outdoor_kitchen', message: 'Quiero una cocina' })).status, 200);
    assert.equal((await anon.post('/api/public/lead', { name: 'Robot', phone: '1', website: 'spam.com' })).status, 200);
    const leads = (await owner.get('/api/leads/new')).body;
    assert.equal(leads.length, 1, 'el robot no entra');
    assert.ok((await owner.get('/api/status')).body.user.pending >= 1);
    await owner.post(`/api/jobs/${leads[0].id}/lead-seen`);
    assert.equal((await owner.get('/api/leads/new')).body.length, 0);
    // Reportes
    const rep = (await owner.get('/api/reports/profit?year=' + new Date().getUTCFullYear())).body;
    assert.ok(Array.isArray(rep.by_type) && Array.isArray(rep.by_source));
    assert.ok(rep.by_source.some(s => s.source === 'Web'));
    // Exportar
    await owner.post(`/api/jobs/${job.id}/expenses`, { amount_cents: 1234, description: '=HYPERLINK("x")', category: 'material', date: '2026-11-10', vendor: 'Home Depot' });
    const csv = Buffer.from((await owner.get('/api/export/gastos?from=2026-01-01&to=2026-12-31')).body).toString('utf8');
    assert.ok(csv.includes('Home Depot') && csv.includes('12.34'));
    assert.ok(csv.includes("'=HYPERLINK"), 'protegido contra fórmulas');
    assert.equal((await sub.get('/api/export/gastos')).status, 403);
  } finally { srv.close(); }
});

test('push: suscripción y aviso firmado con VAPID al teléfono', async () => {
  const { srv, owner, job, sub } = await start();
  const got = [];
  const fake = http.createServer((req, res) => { got.push({ url: req.url, auth: req.headers.authorization, ttl: req.headers.ttl }); res.writeHead(201); res.end(); });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  try {
    const key = (await owner.get('/api/push/key')).body.key;
    assert.ok(key.length > 80);
    const ep = `http://127.0.0.1:${fake.address().port}/push/abc`;
    assert.equal((await owner.post('/api/push/subscribe', { endpoint: ep })).status, 200);
    assert.equal((await owner.post('/api/push/subscribe', { endpoint: 'http://evil.com/x' })).status, 400);
    const t = await owner.post('/api/push/test');
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.equal(got.length, 1);
    assert.match(got[0].auth, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    // Verificar la firma del JWT con la clave pública
    const crypto = require('node:crypto');
    const [, jwt] = /t=([^,]+)/.exec(got[0].auth);
    const [h, p, sig] = jwt.split('.');
    const raw = Buffer.from(key.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const pub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
    assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, `http://127.0.0.1:${fake.address().port}`);
    // Un caso del sub avisa al dueño
    await sub.post('/api/issues', { job_id: job.id, title: 'Falta material', body: 'No llegó la madera' });
    await require('../lib/push').flush();
    assert.equal(got.length, 2);
    const latest = (await owner.get('/api/push/latest')).body;
    assert.match(latest.title, /Nuevo caso: Falta material/);
  } finally { srv.close(); fake.close(); }
});
