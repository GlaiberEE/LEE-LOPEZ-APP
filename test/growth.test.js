'use strict';
// Publicidad (costo por cliente ganado) y cierre de obra con firma de entrega.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const JPG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7), Buffer.from([0xff, 0xd9])]).toString('base64');

test('publicidad por canal y entrega de obra firmada por el cliente', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-gro-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const mk = () => { let cookie = ''; return async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => null) }; }; };
  const call = mk(), anon = mk();
  try {
    await call('POST', '/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
    await call('POST', '/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
    const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()).slice(0, 7);
    // 2 prospectos de Google (uno ganado) y uno referido ganado
    const a = (await call('POST', '/api/jobs', { template: 'base',  client_name: 'A', address: '1', status: 'prospecto', lead_source: 'Google Ads' })).body;
    await call('POST', '/api/jobs', { template: 'base',  client_name: 'B', address: '2', status: 'prospecto', lead_source: 'google' });
    const c = (await call('POST', '/api/jobs', { template: 'base',  client_name: 'C', address: '3', status: 'prospecto', lead_source: 'Referido de Smith' })).body;
    for (const j of [a, c]) { await call('POST', `/api/sales/leads/${j.id}/event`, { kind: 'enviado', amount_cents: 2000000 }); await call('POST', `/api/sales/leads/${j.id}/event`, { kind: 'ganado' }); }
    assert.equal((await call('POST', '/api/marketing/spend', { month: ym, channel: 'Google', amount_cents: 50000 })).status, 200);
    assert.equal((await call('POST', '/api/marketing/spend', { month: 'mal', channel: 'Google', amount_cents: 1 })).status, 400);
    const m = (await call('GET', '/api/marketing?months=3')).body;
    const g = m.rows.find(r => r.channel === 'Google'), ref = m.rows.find(r => r.channel === 'Referido');
    assert.equal(g.leads, 2); assert.equal(g.won, 1); assert.equal(g.spend_cents, 50000); assert.equal(g.cost_per_won_cents, 50000); assert.equal(g.return_x, 40);
    assert.equal(ref.won, 1); assert.equal(ref.cost_per_won_cents, null);
    // cierre de obra
    await call('PUT', '/api/settings/pro', { review_link: 'https://g.page/r/ejemplo/review' }).catch(() => {});
    const job = (await call('POST', '/api/jobs', { template: 'base',  client_name: 'Smith', address: '9 Oak', status: 'activo' })).body;
    const it = (await call('POST', `/api/jobs/${job.id}/punch`, { text: 'Retocar pintura del poste' })).body;
    assert.equal((await call('POST', `/api/jobs/${job.id}/closeout-request`)).status, 400, 'con pendientes no se pide la firma');
    await call('PUT', `/api/punch/${it.id}`, { status: 'hecho' });
    const req = (await call('POST', `/api/jobs/${job.id}/closeout-request`)).body;
    const token = new URL('http://x' + req.url).searchParams.get('t');
    const pub = (await anon('GET', `/api/public/closeout/${token}`)).body;
    assert.equal(pub.requested, true); assert.equal(pub.can_sign, true); assert.equal(pub.items[0].done, true);
    assert.equal((await anon('POST', `/api/public/closeout/${token}/sign`, { name: 'John Smith', agree: true, signature: JPG })).status, 200);
    assert.equal((await anon('POST', `/api/public/closeout/${token}/sign`, { name: 'John Smith', agree: true, signature: JPG })).status, 400, 'una vez');
    const j2 = (await call('GET', `/api/jobs/${job.id}`)).body.job;
    assert.equal(j2.status, 'terminado'); assert.ok(j2.completed_date, 'empieza la garantía');
    const cl = (await call('GET', `/api/jobs/${job.id}/closeout-list`)).body;
    assert.equal(cl.signed.name, 'John Smith');
    assert.equal((await call('POST', `/api/jobs/${job.id}/punch`, { text: 'otro' })).status, 400, 'firmada: ya no se agregan pendientes');
  } finally { srv.close(); }
});
