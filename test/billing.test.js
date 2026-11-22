'use strict';
// Propuesta al cliente con firma en línea y cobros por etapas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const JPG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7), Buffer.from([0xff, 0xd9])]).toString('base64');

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-bill-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => { let cookie = ''; const call = async (method, url, body, extra = {}) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie, ...extra }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, type: ct, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: (u, b) => call('DELETE', u, b) }; };
  const owner = client();
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
  await owner.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
  return { owner, client, base, close: () => new Promise(r => srv.close(r)) };
}

test('propuesta: partidas → enviar → el cliente la ve sin costos y firma → obra activa con cobros por etapa', async () => {
  const T = await start();
  try {
    const job = (await T.owner.post('/api/jobs', { client_name: 'Smith', client_phone: '214 555 0199', address: '1 Main', status: 'prospecto', project_type: 'patio_cover' })).body;
    assert.equal((await T.owner.post(`/api/jobs/${job.id}/proposal/send`)).status, 400, 'sin partidas no se manda');
    await T.owner.post(`/api/jobs/${job.id}/lines`, { trade: 'PATIO COVER', sold_cents: 2000000, est_cost_cents: 1200000, description: 'Cedar 20x14' });
    await T.owner.post(`/api/jobs/${job.id}/lines`, { trade: 'ELECTRICAL', sold_cents: 500000, est_cost_cents: 300000 });
    const p = (await T.owner.get(`/api/jobs/${job.id}/proposal`)).body;
    assert.equal(p.total_cents, 2500000); assert.equal(p.margin_pct, 40); assert.equal(p.schedule.length, 3);
    // calendario: 30% al firmar, 40% al terminar una tarea, 30% a mano
    const task = p.tasks[3];
    const bad = await T.owner.put(`/api/jobs/${job.id}/proposal`, { schedule: [{ label: 'A', pct: 50, trigger: 'firma' }, { label: 'B', pct: 40, trigger: 'manual' }] });
    assert.equal(bad.status, 400, 'deben sumar 100');
    assert.equal((await T.owner.put(`/api/jobs/${job.id}/proposal`, { terms: 'Garantía 1 año', valid_until: '2099-01-01',
      schedule: [{ label: 'Anticipo', pct: 30, trigger: 'firma' }, { label: 'Estructura', pct: 40, trigger: 'tarea', task_id: task.id }, { label: 'Final', pct: 30, trigger: 'manual' }] })).status, 200);
    const sent = (await T.owner.post(`/api/jobs/${job.id}/proposal/send`)).body;
    assert.match(sent.url, /^\/propuesta\.html\?t=[A-Za-z0-9_-]{20,}$/);
    const token = new URL('http://x' + sent.url).searchParams.get('t');
    const st = (await T.owner.get(`/api/jobs/${job.id}`)).body.job;
    assert.equal(st.status, 'cotizado'); assert.equal(st.quoted_cents, 2500000);
    // el cliente (sin cuenta) abre el enlace: nunca ve costos
    const anon = T.client();
    const pub = await anon.get(`/api/public/proposal/${token}`);
    assert.equal(pub.status, 200);
    assert.ok(!JSON.stringify(pub.body).includes('est_cost') && !JSON.stringify(pub.body).includes('1200000'), 'sin costos');
    assert.equal(pub.body.total_cents, 2500000); assert.equal(pub.body.can_sign, true);
    assert.deepEqual(pub.body.schedule.map(s => s.amount_cents), [750000, 1000000, 750000]);
    const pdf = await anon.get(`/api/public/proposal/${token}/pdf?lang=en`);
    assert.equal(pdf.type, 'application/pdf'); assert.equal(pdf.body.slice(0, 4).toString(), '%PDF');
    assert.equal((await anon.get('/api/public/proposal/abcdefghijklmnopqrstuvwxyz')).status, 404);
    // si cambia después de mandarla, el dueño lo ve
    await T.owner.post(`/api/jobs/${job.id}/lines`, { trade: 'GUTTERS', sold_cents: 100000 });
    assert.equal((await T.owner.get(`/api/jobs/${job.id}/proposal`)).body.changed_after_send, true);
    // firmar
    assert.equal((await anon.post(`/api/public/proposal/${token}/sign`, { name: 'John Smith', agree: false, signature: JPG })).status, 400);
    assert.equal((await anon.post(`/api/public/proposal/${token}/sign`, { name: 'John Smith', agree: true, signature: 'x' })).status, 400);
    const sg = await anon.post(`/api/public/proposal/${token}/sign`, { name: 'John Smith', agree: true, signature: JPG });
    assert.equal(sg.status, 200, JSON.stringify(sg.body));
    assert.equal((await anon.post(`/api/public/proposal/${token}/sign`, { name: 'John Smith', agree: true, signature: JPG })).status, 400, 'no se firma dos veces');
    const after = (await T.owner.get(`/api/jobs/${job.id}`)).body.job;
    assert.equal(after.status, 'activo'); assert.equal(after.quoted_cents, 2600000);
    // cobros: el anticipo ya toca cobrar
    let b = (await T.owner.get(`/api/jobs/${job.id}/billing`)).body;
    assert.deepEqual(b.milestones.map(m => [m.label, m.amount_cents, m.status]), [['Anticipo', 780000, 'por_cobrar'], ['Estructura', 1040000, 'pendiente'], ['Final', 780000, 'pendiente']]);
    assert.equal((await T.owner.get('/api/billing/due')).body.length, 1);
    // facturar el anticipo
    const inv = (await T.owner.post(`/api/milestones/${b.milestones[0].id}/invoice`, { due_days: 7 })).body;
    assert.match(inv.invoice_number, /^INV-\d{4}-0001$/);
    assert.equal((await T.owner.get(`/api/milestones/${b.milestones[0].id}/pdf?lang=es`)).body.slice(0, 4).toString(), '%PDF');
    assert.equal((await anon.get(`/api/public/proposal/${token}/invoice/${b.milestones[0].id}`)).type, 'application/pdf', 'el cliente abre su invoice desde el enlace');
    // terminar la tarea → la etapa 2 toca cobrar
    await T.owner.put(`/api/tasks/${task.id}`, { status: 'hecho' });
    b = (await T.owner.get(`/api/jobs/${job.id}/billing`)).body;
    assert.equal(b.milestones[1].status, 'por_cobrar');
    // pagos: se aplican en orden
    await T.owner.post(`/api/jobs/${job.id}/payments`, { date: '2026-11-21', amount_cents: 780000, method: 'Zelle' });
    b = (await T.owner.get(`/api/jobs/${job.id}/billing`)).body;
    assert.equal(b.milestones[0].status, 'pagado'); assert.equal(b.balance_cents, 2600000 - 780000);
    // change order aprobado se cobra en la última etapa
    const pubAfter = (await anon.get(`/api/public/proposal/${token}`)).body;
    assert.equal(pubAfter.signed.name, 'John Smith'); assert.equal(pubAfter.can_sign, false); assert.equal(pubAfter.invoices.length, 1);
    // el calendario ya no cambia si hay invoices
    assert.equal((await T.owner.put(`/api/jobs/${job.id}/proposal`, { schedule: [{ label: 'Todo', pct: 100, trigger: 'manual' }] })).status, 400);
  } finally { await T.close(); }
});

test('propuesta vencida no se firma', async () => {
  const T = await start();
  try {
    const job = (await T.owner.post('/api/jobs', { client_name: 'Lee', address: '2 Oak', status: 'prospecto' })).body;
    await T.owner.post(`/api/jobs/${job.id}/lines`, { trade: 'FIRE PIT', sold_cents: 800000 });
    await T.owner.put(`/api/jobs/${job.id}/proposal`, { valid_until: '2020-01-01' });
    const token = new URL('http://x' + (await T.owner.post(`/api/jobs/${job.id}/proposal/send`)).body.url).searchParams.get('t');
    const anon = T.client();
    const pub = (await anon.get(`/api/public/proposal/${token}`)).body;
    assert.equal(pub.expired, true); assert.equal(pub.can_sign, false);
    assert.equal((await anon.post(`/api/public/proposal/${token}/sign`, { name: 'Ann Lee', agree: true, signature: JPG })).status, 400);
  } finally { await T.close(); }
});
