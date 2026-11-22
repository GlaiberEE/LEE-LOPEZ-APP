'use strict';
// Papeles de los subs: W-9, seguro, lien waivers y 1099.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%fake\n').toString('base64');

test('papeles de subs: W-9, seguro con aviso, waiver por pago, 1099 con umbral del año', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-pap-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  let cookie = '';
  const call = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const ct = r.headers.get('content-type') || '';
    return { status: r.status, type: ct, body: ct.includes('json') ? await r.json() : await r.text() }; };
  try {
    await call('POST', '/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
    await call('POST', '/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
    const job = (await call('POST', '/api/jobs', { client_name: 'Smith', address: '1 Main', status: 'activo' })).body;
    const s1 = (await call('POST', `/api/jobs/${job.id}/subs`, { name: 'Express Electric', trade: 'Electricidad', agreed_cents: 500000 })).body;
    const s2 = (await call('POST', `/api/jobs/${job.id}/subs`, { name: 'Olivas Construction', trade: 'Estructura', agreed_cents: 300000 })).body;
    const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()).slice(0, 4);
    const p1 = await call('POST', `/api/subs/${s1.id}/payments`, { date: `${y}-03-01`, amount_cents: 250000, method: 'Zelle' });
    assert.equal(p1.status, 200, JSON.stringify(p1.body));
    await call('POST', `/api/subs/${s2.id}/payments`, { date: `${y}-03-02`, amount_cents: 150000, method: 'Cheque' });
    let r = (await call('GET', `/api/papers?year=${y}`)).body;
    const E = r.people.find(p => p.name === 'Express Electric'), O = r.people.find(p => p.name === 'Olivas Construction');
    assert.equal(r.threshold_cents, Number(y) >= 2026 ? 200000 : 60000);
    assert.equal(E.paid_year_cents, 250000); assert.equal(E.needs_1099, true, 'pasó el umbral y no hay W-9 que diga corporación');
    assert.equal(O.needs_1099, Number(y) < 2026, 'Olivas: $1,500 está debajo de $2,000 en 2026');
    assert.equal(E.coi, 'falta'); assert.equal(E.missing_waivers, 1);
    // aviso: falta el W-9 a quien ya pasó el umbral
    assert.ok((await call('GET', '/api/papers-alerts')).body.some(a => a.name === 'Express Electric' && a.kind === 'w9'));
    // subir W-9 (corporación → no necesita 1099) y seguro por vencer
    const soon = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
    assert.equal((await call('PUT', `/api/papers/${encodeURIComponent(E.key)}`, { tax_class: 'corp', w9: PDF, coi: PDF, coi_expires: soon, coi_carrier: 'Acme' })).status, 200);
    assert.equal((await call('PUT', `/api/papers/${encodeURIComponent(E.key)}`, { w9: 'data:text/plain;base64,aGk=' })).status, 400, 'solo foto o PDF');
    r = (await call('GET', `/api/papers?year=${y}`)).body;
    const E2 = r.people.find(p => p.key === E.key);
    assert.equal(E2.w9, true); assert.equal(E2.needs_1099, false); assert.equal(E2.coi, 'por_vencer');
    assert.ok((await call('GET', '/api/papers-alerts')).body.some(a => a.key === E.key && a.kind === 'por_vencer'));
    // waiver del pago
    const d = (await call('GET', `/api/papers/${encodeURIComponent(E.key)}`)).body;
    assert.match(d.w9_file, /^w9-/);
    assert.equal((await call('GET', `/api/papers-file/${d.w9_file}`)).type, 'application/pdf');
    const w = await call('POST', `/api/papers/${encodeURIComponent(E.key)}/waivers`, { sub_payment_id: d.payments[0].id, kind: 'incond_parcial', file: PDF });
    assert.equal(w.status, 200);
    assert.equal((await call('POST', `/api/papers/${encodeURIComponent(E.key)}/waivers`, { sub_payment_id: d.payments[0].id, kind: 'incond_parcial', file: PDF })).status, 400, 'un waiver por pago');
    assert.equal((await call('GET', `/api/papers?year=${y}`)).body.people.find(p => p.key === E.key).missing_waivers, 0);
    // reporte CSV
    const csv = await call('GET', `/api/papers-1099?year=${y}`);
    assert.match(csv.type, /text\/csv/); assert.match(csv.body, /Express Electric/); assert.match(csv.body, /Olivas Construction/);
    // umbral manual (ej. 2027 ajustado por inflación)
    assert.equal((await call('PUT', '/api/papers-threshold/2027', { threshold_cents: 210000 })).body.threshold_cents, 210000);
    assert.equal((await call('GET', '/api/papers-file/../../db.sqlite')).status, 404);
  } finally { srv.close(); }
});
