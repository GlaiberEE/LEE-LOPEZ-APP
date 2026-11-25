'use strict';
// v2.20 — Fase 3 (pagos a subs con plan y dos dueños), aviso de inspección pasada, y planos / estimado → invoice / scope para subs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-f3-'));
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
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const g = client(), jack = client(), pedro = client(), cli = client(), mario = client();
let job, pedroId, cliId, marioId, subRow, small;
const notes = uid => server.db.prepare('SELECT title, body FROM notifications WHERE user_id=? ORDER BY id').all(uid);

test('preparación: dos dueños, un sub con usuario, un cliente y un PM', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  const mk = async (name, role) => (await g.post('/api/users', { name, username: name.toLowerCase(), password: 'contrasena-' + name.toLowerCase(), role })).data.id;
  await mk('Jack', 'owner'); pedroId = await mk('Pedro', 'worker'); cliId = await mk('Cliente', 'client'); marioId = await mk('Mario', 'pm');
  for (const [c, u] of [[jack, 'jack'], [pedro, 'pedro'], [cli, 'cliente'], [mario, 'mario']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await g.post('/api/jobs', { template: 'base', client_name: 'Smith', project_type: 'patio_cover', status: 'prospecto', start_date: '2026-11-02' })).data.id;
  server.db.prepare('UPDATE jobs SET client_user_id=?, pm_id=? WHERE id=?').run(cliId, marioId, job);
});

test('plan de pago: 50/50 para trabajos normales y un solo pago al final para los chicos', async () => {
  subRow = (await g.post(`/api/jobs/${job}/subs`, { name: 'Pedro Framing', agreed_cents: 800000, user_id: pedroId, trades: ['carpinteria'] })).data;
  small = (await g.post(`/api/jobs/${job}/subs`, { name: 'Limpieza Rápida', agreed_cents: 90000, trades: ['limpieza'] })).data;
  let p = (await g.get(`/api/subs/${subRow.id}/pay-plan`)).data;
  assert.equal(p.plan, '50_50'); assert.equal(p.chosen, false);
  assert.deepEqual(p.stages.map(s => [s.key, s.amount_cents, s.ready]), [['inicio', 400000, false], ['final', 400000, false]], 'nada listo antes de empezar');
  assert.equal((await g.get(`/api/subs/${small.id}/pay-plan`)).data.plan, 'final', 'menos de $3,500: un solo pago al final');
  // Empieza su primera tarea: toca el 50%.
  const mine = (await g.get(`/api/jobs/${job}`)).data.tasks.filter(t => t.assignee_id === pedroId);
  assert.ok(mine.length > 1, 'se le asignaron sus tareas de carpintería');
  await pedro.put(`/api/tasks/${mine[0].id}`, { status: 'en_progreso' });
  p = (await g.get(`/api/subs/${subRow.id}/pay-plan`)).data;
  assert.equal(p.due_now_cents, 400000); assert.equal(p.next.key, 'inicio');
  // Por avance, con % a mano.
  p = (await g.put(`/api/subs/${subRow.id}/pay-plan`, { plan: 'progreso', progress_pct: 25 })).data;
  assert.equal(p.due_now_cents, 200000); assert.equal(p.pct_manual, true);
  assert.equal((await g.put(`/api/subs/${subRow.id}/pay-plan`, { progress_pct: 120 })).status, 400);
  await g.put(`/api/subs/${subRow.id}/pay-plan`, { plan: '50_50', progress_pct: '' });
  assert.equal((await pedro.get(`/api/subs/${subRow.id}/pay-plan`)).status, 403, 'el sub nunca ve el dinero de la compañía');
  assert.equal((await mario.get(`/api/subs/${subRow.id}/pay-plan`)).status, 403);
});

test('cada pago a un sub lo autorizan los dos dueños', async () => {
  const r = await g.post(`/api/subs/${subRow.id}/payments`, { amount_cents: 400000, date: '2026-11-10', method: 'Zelle' });
  assert.equal(r.data.pending, true, 'Glaiber lo pide, no se aplica todavía');
  assert.equal(server.db.prepare('SELECT COUNT(*) n FROM sub_payments').get().n, 0);
  let p = (await g.get(`/api/subs/${subRow.id}/pay-plan`)).data;
  assert.equal(p.waiting_cents, 400000); assert.equal(p.due_now_cents, 0, 'lo que espera ya no se vuelve a sugerir');
  const list = (await jack.get('/api/change-requests')).data.to_approve;
  assert.equal(list.length, 1); assert.match(list[0].summary, /Pedro Framing/);
  assert.equal((await g.post(`/api/change-requests/${list[0].id}/decide`, { action: 'approve' })).status, 403, 'no se autoriza solo');
  const d = await jack.post(`/api/change-requests/${list[0].id}/decide`, { action: 'approve' });
  assert.equal(d.data.status, 'aprobado');
  assert.equal(server.db.prepare('SELECT SUM(amount_cents) v FROM sub_payments WHERE sub_id=?').get(subRow.id).v, 400000);
  assert.ok(notes(pedroId).some(n => /Pago registrado/.test(n.title)), 'al sub le llega el aviso de su pago');
  p = (await g.get(`/api/subs/${subRow.id}/pay-plan`)).data;
  assert.equal(p.paid_cents, 400000); assert.equal(p.next.key, 'final');
});

test('si lo pide un PM, firman los dos dueños antes de pagar', async () => {
  const r = await mario.post(`/api/subs/${small.id}/payments`, { amount_cents: 50000, date: '2026-11-11', method: 'Cheque', reason: 'Adelanto' });
  assert.equal(r.data.pending, true);
  const id = (await g.get('/api/change-requests')).data.to_approve.find(x => /Limpieza/.test(x.summary)).id;
  const first = await g.post(`/api/change-requests/${id}/decide`, { action: 'approve' });
  assert.equal(first.data.first, true); assert.equal(first.data.status, 'pendiente', 'falta el otro dueño');
  assert.equal(server.db.prepare('SELECT COUNT(*) n FROM sub_payments WHERE sub_id=?').get(small.id).n, 0);
  assert.equal((await g.post(`/api/change-requests/${id}/decide`, { action: 'approve' })).status, 403, 'el mismo dueño no firma dos veces');
  assert.ok(!(await g.get('/api/change-requests')).data.to_approve.some(x => x.id === id));
  const second = await jack.post(`/api/change-requests/${id}/decide`, { action: 'approve' });
  assert.equal(second.data.status, 'aprobado');
  assert.equal(server.db.prepare('SELECT SUM(amount_cents) v FROM sub_payments WHERE sub_id=?').get(small.id).v, 50000);
});

test('la compañía puede apagar la doble firma de pagos a subs', async () => {
  assert.equal((await mario.put('/api/sub-pay/settings', { dual: false })).status, 403);
  const off = await g.put('/api/sub-pay/settings', { dual: false, small_cents: 500000 });
  assert.ok(off.data.pending, 'apagar la doble firma la autoriza el otro dueño');
  assert.equal((await jack.post(`/api/change-requests/${off.data.request_id}/decide`, { action: 'approve' })).data.status, 'aprobado');
  assert.equal((await g.get('/api/sub-pay/settings')).data.dual, false);
  const r = await g.post(`/api/subs/${small.id}/payments`, { amount_cents: 10000, date: '2026-11-12', method: 'Zelle' });
  assert.ok(!r.data.pending, 'se aplica directo');
  await g.put('/api/sub-pay/settings', { dual: true, small_cents: 350000 });
  const due = (await g.get('/api/sub-pay/due')).data;
  assert.ok(Array.isArray(due));
});

test('planos, scope sin precios y estimado que se convierte en invoice', async () => {
  const pl = (await g.post(`/api/jobs/${job}/docs`, { kind: 'plano', title: 'Planos aprobados por la ciudad', file: PDF })).data;
  assert.equal(pl.share_subs, true, 'los planos se comparten con los subs');
  assert.ok(notes(pedroId).some(n => /Planos nuevos/.test(n.title)), 'aviso a los subs de la obra');
  const est = (await g.post(`/api/jobs/${job}/docs`, { kind: 'estimado', number: 'EST-1043', amount_cents: 2850000, file: PDF, share_subs: true })).data;
  assert.equal(est.share_subs, false, 'un estimado nunca se comparte con los subs');
  assert.equal(est.status, 'enviado');
  assert.equal((await g.post(`/api/jobs/${job}/docs`, { kind: 'invoice', file: PDF })).status, 400, 'el invoice sale solo');
  // Scope: sin precios.
  assert.equal((await g.put(`/api/jobs/${job}/scope`, { scope_text: 'Patio cover 20x14 — $12,000' })).status, 400);
  assert.equal((await g.put(`/api/jobs/${job}/scope`, { scope_text: 'Patio cover 20x14 con stain Cedar\n• Techo de shingle\n• 4 abanicos' })).status, 200);
  // El sub ve planos y scope, nunca el estimado ni montos.
  const sv = (await pedro.get(`/api/jobs/${job}/docs`)).data;
  assert.deepEqual(sv.docs.map(d => d.kind), ['plano']);
  assert.equal(sv.docs[0].amount_cents, undefined); assert.match(sv.scope_text, /stain Cedar/); assert.equal(sv.missing, undefined);
  assert.equal((await pedro.get(`/api/job-docs/${est.id}/file`)).status, 404);
  const f = await pedro.get(`/api/job-docs/${pl.id}/file`); assert.equal(f.status, 200); assert.match(f.type, /pdf/);
  // El cliente solo ve lo que se le comparte.
  assert.equal((await cli.get(`/api/jobs/${job}/docs`)).data.docs.length, 0);
  // Aprobar: el estimado pasa a invoice y queda como contrato de la obra.
  assert.equal((await mario.post(`/api/job-docs/${est.id}/approve`)).status, 403, 'aprobar lo hace un dueño');
  const a = (await g.post(`/api/job-docs/${est.id}/approve`)).data;
  assert.equal(a.number, 'INV-1043'); assert.equal(a.contract, true);
  const j = server.db.prepare('SELECT status, quoted_cents FROM jobs WHERE id=?').get(job);
  assert.deepEqual([j.status, j.quoted_cents], ['activo', 2850000]);
  assert.ok(server.db.prepare('SELECT COUNT(*) n FROM payment_milestones WHERE job_id=?').get(job).n >= 1, 'con su calendario de cobros');
  const docs = (await g.get(`/api/jobs/${job}/docs`)).data;
  assert.deepEqual(docs.docs.map(d => [d.kind, d.status]), [['plano', ''], ['estimado', 'aprobado'], ['invoice', 'aprobado']]);
  assert.deepEqual(docs.missing, { planos: false, estimado: false });
  assert.equal((await g.del(`/api/job-docs/${est.id}`)).status, 423, 'un estimado aprobado no se borra');
  assert.equal((await g.put(`/api/job-docs/${a.invoice_id}`, { amount_cents: 1 })).status, 423);
  assert.equal((await g.put(`/api/job-docs/${a.invoice_id}`, { share_client: true })).status, 200);
  const cv = (await cli.get(`/api/jobs/${job}/docs`)).data;
  assert.deepEqual(cv.docs.map(d => [d.kind, d.amount_cents]), [['invoice', 2850000]]);
  assert.equal(cv.scope_text, undefined);
  assert.equal((await pedro.post(`/api/jobs/${job}/docs`, { kind: 'plano', file: PDF })).status, 403);
});

test('pasa una inspección: aviso al cliente y a los subs con lo que sigue', async () => {
  const tasks = (await g.get(`/api/jobs/${job}`)).data.tasks;
  const insp = tasks.find(t => /Inspecci/.test(t.title));
  const idx = tasks.findIndex(t => t.id === insp.id);
  const next = tasks.slice(idx + 1).find(t => !/Inspecci/.test(t.title));
  await g.put(`/api/tasks/${next.id}`, { assignee_id: pedroId, planned_date: '2026-12-01' });
  const before = notes(pedroId).length;
  const r = await g.put(`/api/tasks/${insp.id}`, { status: 'hecho' });
  assert.equal(r.data.inspection.client, true);
  assert.equal(r.data.inspection.next[0].id, next.id);
  const pn = notes(pedroId).slice(before);
  assert.ok(pn.some(n => n.title.startsWith('Ya puede seguir') && n.body.includes('12/01')), 'al que sigue: "Ya puede seguir" con su fecha');
  assert.ok(notes(cliId).some(n => n.title.startsWith('✅')), 'al cliente');
  const u = server.db.prepare("SELECT data FROM client_updates WHERE job_id=? ORDER BY id DESC LIMIT 1").get(job);
  assert.equal(JSON.parse(u.data).status, 'inspeccion');
  const all = notes(cliId).length;
  await g.put(`/api/tasks/${insp.id}`, { status: 'pendiente' }); await g.put(`/api/tasks/${insp.id}`, { status: 'hecho' });
  assert.equal(notes(cliId).length, all, 'se avisa una sola vez');
  // Desde Permisos: aprobar la inspección también avisa.
  const pid = (await g.post(`/api/jobs/${job}/inspections`, { items: [{ type: 'final', after_task_id: next.id }] })).data.created[0].permit_id;
  const r2 = await g.put(`/api/permits/${pid}`, { status: 'aprobado' });
  assert.ok(r2.data.inspection, 'aprobada en Permisos = aviso');
  // Y se puede apagar.
  await g.put('/api/settings', { insp_notify_client: false });
  const pid2 = (await g.post(`/api/jobs/${job}/inspections`, { items: [{ type: 'otra', name: 'Fire marshal', after_task_id: next.id }] })).data.created[0].permit_id;
  assert.equal((await g.put(`/api/permits/${pid2}`, { status: 'aprobado' })).data.inspection.client, false);
});
