'use strict';
// Trabajadores por hora: tiempo extra, nómina semanal, reportes por trabajador y por obra.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-lab-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => { let cookie = ''; const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) }; };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: u => call('DELETE', u, { reason: 'Corrección de prueba' }) }; };
  const owner = client();
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
  await owner.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
  return { srv, owner, client, close: () => new Promise(r => srv.close(r)) };
}
// Hora local de Texas (CST, UTC-6 en noviembre) → UTC "YYYY-MM-DD HH:MM"
const utc = (day, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(`${day}T00:00:00Z`); d.setUTCHours(h + 6, m); return d.toISOString().replace('T', ' ').slice(0, 16); };

test('por hora: tiempo extra después de 40 h, gasto en cada obra, nómina pagada y cerrada, reportes', async () => {
  const T = await start();
  try {
    const w = (await T.owner.post('/api/users', { name: 'Juan', username: 'juan', password: 'otra-clave-larga-1', role: 'worker', pay_type: 'hora', rate_cents: 2000 })).body;
    const sub = (await T.owner.post('/api/users', { name: 'Pedro Sub', username: 'pedro', password: 'otra-clave-larga-1', role: 'worker', pay_type: 'sub' })).body;
    const ws = (await T.owner.get('/api/labor/workers')).body;
    assert.equal(ws.find(x => x.id === w.id).pay_type, 'hora'); assert.equal(ws.find(x => x.id === w.id).rate_cents, 2000);
    assert.equal(ws.find(x => x.id === sub.id).pay_type, 'sub');
    const A = (await T.owner.post('/api/jobs', { template: 'base',  client_name: 'Smith', address: '1 Main', status: 'activo' })).body;
    const B = (await T.owner.post('/api/jobs', { template: 'base',  client_name: 'Jones', address: '2 Oak', status: 'activo' })).body;
    // Semana lunes 2026-11-09 … domingo 11-15: 4 días de 10 h en Smith (40 h) y un sábado de 5 h en Jones (todo extra).
    for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) {
      const r = await T.owner.post('/api/time', { user_id: w.id, job_id: A.id, in_at: utc(d, '07:00'), out_at: utc(d, '17:00') });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    await T.owner.post('/api/time', { user_id: w.id, job_id: B.id, in_at: utc('2026-11-14', '08:00'), out_at: utc('2026-11-14', '13:00') });
    const pr = (await T.owner.get('/api/payroll?week=2026-11-12')).body;
    assert.equal(pr.week, '2026-11-09'); assert.equal(pr.end, '2026-11-15');
    const j = pr.people.find(p => p.user_id === w.id);
    assert.equal(j.minutes, 45 * 60); assert.equal(j.ot_minutes, 5 * 60);
    assert.equal(j.total_cents, 45 * 2000 + 5 * 1000, '40 h × $20 + 5 h × $30');
    // Gasto en las obras: Smith 40 h normales; Jones 5 h + la mitad extra.
    const labA = (await T.owner.get(`/api/jobs/${A.id}/labor`)).body, labB = (await T.owner.get(`/api/jobs/${B.id}/labor`)).body;
    assert.equal(labA.total_cents, 80000); assert.equal(labB.total_cents, 15000);
    assert.equal(labB.workers[0].ot_extra_cents, 5000);
    const expB = (await T.owner.get(`/api/jobs/${B.id}`)).body.expenses.filter(e => e.category === 'mano_obra').reduce((a, e) => a + e.amount_cents, 0);
    assert.equal(expB, 15000, 'el tiempo extra cuenta en el costo de la obra');
    // Reporte por trabajador y por obra
    const rep = (await T.owner.get('/api/labor/report?from=2026-11-01&to=2026-11-30')).body;
    assert.equal(rep.total_cents, 95000); assert.equal(rep.ot_minutes, 300);
    assert.equal(rep.by_worker[0].name, 'Juan'); assert.equal(rep.by_worker[0].jobs.length, 2);
    assert.deepEqual(rep.by_job.map(x => [x.client_name, x.cost_cents]), [['Smith', 80000], ['Jones', 15000]]);
    // Corregir horas antes de pagar recalcula el extra: quitar el sábado → sin tiempo extra.
    const ents = (await T.owner.get('/api/time?from=2026-11-01&to=2026-11-30')).body.entries;
    const sat = ents.find(e => e.job_id === B.id);
    assert.equal((await T.owner.del(`/api/time/${sat.id}`)).status, 200);
    assert.equal((await T.owner.get('/api/payroll?week=2026-11-09')).body.people[0].ot_minutes, 0);
    assert.equal((await T.owner.get(`/api/jobs/${B.id}/labor`)).body.total_cents, 0);
    await T.owner.post('/api/time', { user_id: w.id, job_id: B.id, in_at: utc('2026-11-14', '08:00'), out_at: utc('2026-11-14', '13:00') });
    // Pagar la semana: queda cerrada
    const pay = await T.owner.post('/api/payroll/pay', { user_id: w.id, week: '2026-11-10', method: 'Zelle' });
    assert.equal(pay.status, 200); assert.equal(pay.body.total_cents, 95000);
    assert.equal((await T.owner.post('/api/payroll/pay', { user_id: w.id, week: '2026-11-09' })).status, 400, 'no se paga dos veces');
    const p2 = (await T.owner.get('/api/payroll?week=2026-11-09')).body.people[0];
    assert.ok(p2.paid); assert.equal(p2.paid.method, 'Zelle');
    assert.equal((await T.owner.post('/api/time', { user_id: w.id, job_id: A.id, in_at: utc('2026-11-13', '07:00'), out_at: utc('2026-11-13', '09:00') })).status, 400, 'semana pagada: no se agregan horas');
    assert.equal((await T.owner.del(`/api/time/${ents[0].id}`)).status, 400, 'semana pagada: no se borran horas');
    assert.equal((await T.owner.del(`/api/payroll/${p2.paid.id}`)).status, 200);
    assert.equal((await T.owner.post('/api/time', { user_id: w.id, job_id: A.id, in_at: utc('2026-11-13', '07:00'), out_at: utc('2026-11-13', '09:00') })).status, 200, 'sin pago, se puede corregir');
    // Sin tiempo extra (si lo apagan) se recalcula
    await T.owner.put('/api/settings/labor', { ot_on: false });
    assert.equal((await T.owner.get('/api/payroll?week=2026-11-09')).body.people[0].ot_minutes, 0);
    assert.equal((await T.owner.get(`/api/jobs/${B.id}/labor`)).body.total_cents, 10000);
    // El trabajador nunca ve dinero
    const jc = T.client(); await jc.post('/api/login', { username: 'juan', password: 'otra-clave-larga-1' });
    for (const u of ['/api/payroll', '/api/labor/report', '/api/labor/workers', `/api/jobs/${A.id}/labor`]) assert.equal((await jc.get(u)).status, 403, u);
  } finally { await T.close(); }
});
