'use strict';
// v2.23 — Fila de espera: los trabajos vendidos esperan en orden de aprobación; la app propone cuándo arrancar
// según los subs que se liberan, les pregunta y cuenta solo a los clave.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-q-'));
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
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b) };
}
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n%%EOF').toString('base64');
const TZ = 'America/Chicago';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const plus = n => { const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const g = client(), framer = client(), pilares = client(), elec = client();
let fId, pId, eId, active, sold, sold2;
const notes = uid => server.db.prepare('SELECT title, body FROM notifications WHERE user_id=? ORDER BY id').all(uid);
const Q = async () => (await g.get('/api/queue')).data.jobs;

test('preparación: una obra en marcha con el framer ocupado y dos trabajos vendidos', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  const mk = async (name, trades) => (await g.post('/api/users', { name, username: name.toLowerCase(), password: 'contrasena-' + name.toLowerCase(), role: 'worker', trades })).data.id;
  fId = await mk('Framer', ['carpinteria']); pId = await mk('Pilares', ['excavacion', 'concreto']); eId = await mk('Luis', ['electricidad']);
  for (const [c, u] of [[framer, 'framer'], [pilares, 'pilares'], [elec, 'luis']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  // Obra en marcha: el framer tiene tareas hasta dentro de 10 días.
  active = (await g.post('/api/jobs', { template: 'base', client_name: 'Melbourne', project_type: 'patio_cover', status: 'activo', start_date: plus(-5) })).data.id;
  await g.post(`/api/jobs/${active}/subs`, { name: 'Framer', user_id: fId, agreed_cents: 100000, trades: ['carpinteria'] });
  server.db.prepare("UPDATE tasks SET planned_end=? WHERE job_id=? AND assignee_id=?").run(plus(10), active, fId);
  server.db.prepare("UPDATE tasks SET status='en_progreso' WHERE id=(SELECT id FROM tasks WHERE job_id=? AND trade='excavacion' LIMIT 1)").run(active);
  // Dos vendidos: entran a la fila el día que se aprueba el estimado.
  const sell = async name => {
    const id = (await g.post('/api/jobs', { template: 'base', client_name: name, project_type: 'patio_cover', status: 'prospecto', start_date: plus(1) })).data.id;
    for (const [n, u, tr] of [['Framer', fId, ['carpinteria']], ['Pilares', pId, ['excavacion', 'concreto']], ['Luis', eId, ['electricidad']]]) await g.post(`/api/jobs/${id}/subs`, { name: n, user_id: u, agreed_cents: 100000, trades: tr });
    const est = (await g.post(`/api/jobs/${id}/docs`, { kind: 'estimado', amount_cents: 3000000, file: PDF })).data;
    await g.post(`/api/job-docs/${est.id}/approve`);
    return id;
  };
  sold = await sell('Kilmichael'); sold2 = await sell('Crestfield');
  server.db.prepare('UPDATE jobs SET queue_since=? WHERE id=?').run(plus(-3), sold2);
});

test('la fila: por fecha de aprobación, con la obra en marcha fuera', async () => {
  const q = await Q();
  assert.deepEqual(q.map(j => j.job_id), [sold2, sold], 'el más viejo primero');
  assert.ok(!q.some(j => j.job_id === active), 'lo que ya arrancó no está en la fila');
  const k = q.find(j => j.job_id === sold);
  assert.equal(k.state, 'sin_preguntar');
  const by = Object.fromEntries(k.subs.map(s => [s.name, s]));
  assert.equal(by.Pilares.key, true, 'primeras etapas: pilares');
  assert.equal(by.Framer.key, true, 'primeras etapas: framing');
  assert.equal(by.Luis.key, false, 'el eléctrico va después');
  assert.ok(by.Framer.free_from > plus(10), 'el framer se libera después de su obra');
  assert.ok(k.proposed_start >= by.Framer.free_from || by.Framer.offset > 0, 'la fecha espera al framer');
  assert.equal((await framer.get('/api/queue')).status, 403, 'los subs no ven la fila');
});

test('marcar los subs clave y preguntarles a todos', async () => {
  let p = (await g.put(`/api/queue/${sold}`, { key_ids: [fId, eId] })).data;
  assert.deepEqual(p.subs.filter(s => s.key).map(s => s.name).sort(), ['Framer', 'Luis']);
  const r = (await g.post(`/api/queue/${sold}/ask`, { start_date: plus(14) })).data;
  assert.equal(r.asked, 3, 'se les pregunta a todos');
  assert.ok(notes(fId).some(n => /¿Puede empezar/.test(n.title) || /Can you start/.test(n.title)));
  const mine = (await framer.get('/api/my-availability')).data;
  assert.equal(mine.length, 1);
  const pend = (await framer.get('/api/my-pending')).data;
  assert.ok((Array.isArray(pend) ? pend : pend.items).some(x => x.kind === 'avail'));
  // El framer dice que sí: 50% (la mitad de los clave).
  assert.equal((await elec.post(`/api/queue/answers/${mine[0].id}`, { answer: 'si' })).status, 404, 'cada quien contesta lo suyo');
  p = (await framer.post(`/api/queue/answers/${mine[0].id}`, { answer: 'si' })).data.plan;
  assert.equal(p.readiness_pct, 50); assert.equal(p.state, 'opcion');
  // Pilares (no clave) puede 4 días después: está bien.
  const pq = (await pilares.get('/api/my-availability')).data[0];
  assert.equal((await pilares.post(`/api/queue/answers/${pq.id}`, { answer: 'no' })).status, 400, 'si no puede, dice desde cuándo');
  p = (await pilares.post(`/api/queue/answers/${pq.id}`, { answer: 'no', available_from: plus(18) })).data.plan;
  const pil = p.subs.find(s => s.name === 'Pilares');
  assert.equal(pil.wait_days, 4); assert.equal(pil.too_long, false); assert.equal(p.state, 'opcion');
  // Luis dice que sí: 100%.
  const lq = (await elec.get('/api/my-availability')).data[0];
  p = (await elec.post(`/api/queue/answers/${lq.id}`, { answer: 'si' })).data.plan;
  assert.equal(p.readiness_pct, 100); assert.equal(p.state, 'listo');
});

test('un sub no clave que tarda más de una semana frena la propuesta', async () => {
  const pq = (await pilares.get('/api/my-availability')).data[0];
  const p = (await pilares.post(`/api/queue/answers/${pq.id}`, { answer: 'no', available_from: plus(25) })).data.plan;
  const pil = p.subs.find(s => s.name === 'Pilares');
  assert.equal(pil.wait_days, 11); assert.equal(pil.too_long, true);
  assert.notEqual(p.state, 'listo');
  await g.put('/api/queue-settings', { max_wait: 14 });
  assert.equal((await Q()).find(j => j.job_id === sold).state, 'listo', 'con 14 días de espera ya cabe');
  await g.put('/api/queue-settings', { max_wait: 7 });
});

test('arrancar: el schedule se recorre a la fecha y el trabajo sale de la fila', async () => {
  const r = (await g.post(`/api/queue/${sold}/start`, { start_date: plus(14) })).data;
  assert.equal(r.start, plus(14));
  const first = server.db.prepare("SELECT planned_date FROM tasks WHERE job_id=? AND trade NOT IN ('','planos') AND inspection_type='' ORDER BY position LIMIT 1").get(sold);
  assert.ok(first.planned_date >= plus(14));
  const pil = server.db.prepare("SELECT planned_date FROM tasks WHERE job_id=? AND assignee_id=? ORDER BY position LIMIT 1").get(sold, pId);
  assert.ok(pil.planned_date >= plus(25), 'la primera tarea de pilares se recorre a cuando puede');
  assert.ok(!(await Q()).some(j => j.job_id === sold));
  assert.ok(notes(eId).some(n => /Arrancamos|We start/.test(n.title)));
  assert.equal(server.db.prepare('SELECT queue_state FROM jobs WHERE id=?').get(sold).queue_state, 'arrancado');
});

test('calendario del sub para contestar: sus días ocupados por obra, sin dinero', async () => {
  const id2 = (await g.post(`/api/queue/${sold2}/ask`, {})).data.plan.subs.find(s => s.user_id === fId).row_id;
  const c = (await framer.get(`/api/queue/answers/${id2}/calendar`)).data;
  assert.ok(c.needed_date);
  assert.ok(c.jobs.some(j => /Melbourne/.test(j.name)), 've la obra activa donde trabaja');
  const mel = c.jobs.findIndex(j => /Melbourne/.test(j.name));
  assert.ok(Object.values(c.days).some(d => d.some(x => x.job === mel)), 'su tarea de Melbourne marca los días ocupados');
  assert.equal(JSON.stringify(c).includes('cents'), false);
  assert.equal((await elec.get(`/api/queue/answers/${id2}/calendar`)).status, 404, 'solo el suyo');
  assert.equal((await g.get(`/api/queue/answers/${id2}/calendar`)).status, 200, 'el dueño también, para contestar por él');
});
