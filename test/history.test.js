'use strict';
// v2.25 — Historial diario de cada obra: se junta solo, se guarda en inglés, aviso 6:30 PM, cierre 10 PM, PDF.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const H = require('../lib/history');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-hist-'));
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
    return { status: res.status, type, data: type.includes('json') ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer()) };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const g = client(), mario = client(), luis = client(), cli = client();
let marioId, luisId, job, otherJob, today, taskId;
const notes = uid => server.db.prepare('SELECT title, body, url FROM notifications WHERE user_id=? ORDER BY id').all(uid);

test('preparación', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  const mk = async (name, role, trades) => (await g.post('/api/users', { name, username: name.toLowerCase(), password: 'contrasena-' + name.toLowerCase(), role, trades })).data.id;
  marioId = await mk('Mario', 'pm'); luisId = await mk('Luis', 'worker', ['electricidad']); await mk('Cli', 'client');
  for (const [c, u] of [[mario, 'mario'], [luis, 'luis'], [cli, 'cli']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await g.post('/api/jobs', { template: 'base', client_name: 'Melbourne', project_type: 'patio_cover', status: 'activo', start_date: '2026-11-02' })).data.id;
  otherJob = (await g.post('/api/jobs', { client_name: 'Otra', project_type: 'patio_cover', status: 'activo' })).data.id;
  server.db.prepare('UPDATE jobs SET pm_id=? WHERE id=?').run(marioId, job);
  await g.post(`/api/jobs/${job}/subs`, { name: 'Luis', user_id: luisId, agreed_cents: 1000, trades: ['electricidad'] });
  today = (await g.get(`/api/jobs/${job}/history`)).data.today;
  taskId = server.db.prepare('SELECT id FROM tasks WHERE job_id=? AND assignee_id=? ORDER BY position LIMIT 1').get(job, luisId).id;
  server.db.prepare('UPDATE tasks SET planned_date=? WHERE id=?').run(today, taskId);
});

test('el día se junta solo: tareas, reporte del día, sin montos', async () => {
  assert.equal((await luis.put(`/api/tasks/${taskId}`, { status: 'en_progreso' })).status, 200);
  assert.equal((await luis.put(`/api/tasks/${taskId}`, { status: 'hecho' })).status, 200);
  await mario.post(`/api/jobs/${job}/logs`, { date: today, weather: 'Soleado', crew: 'Luis', client_notes: 'Se terminó el rough eléctrico', internal_notes: 'Faltó cable UF' });
  const h = (await mario.get(`/api/jobs/${job}/history`)).data;
  assert.equal(h.closed, false);
  assert.ok(h.lines.some(l => l.en.startsWith('Started:') && l.es.startsWith('Empezó:')), 'empezó');
  assert.ok(h.lines.some(l => l.en.startsWith('Finished:') && l.en.includes('Luis')), 'terminó con quién');
  assert.equal(h.notes.length, 2); assert.equal(h.crew, 'Luis');
  assert.ok(!JSON.stringify(h).includes('$'), 'sin montos de dinero');
});

test('solo dueños y el PM de la obra; ni subs ni clientes', async () => {
  assert.equal((await luis.get(`/api/jobs/${job}/history`)).status, 403);
  assert.equal((await cli.get(`/api/jobs/${job}/history`)).status, 403);
  assert.equal((await mario.get(`/api/jobs/${otherJob}/history`)).status, 404, 'el PM solo ve sus obras');
});

test('6:30 PM: aviso al encargado si la obra trabajó y no hay reporte', async () => {
  // La otra obra trabajó hoy (tarea de hoy) y no tiene reporte: le avisa a los dueños (no tiene PM).
  server.db.prepare("INSERT INTO tasks(job_id,position,title,planned_date) VALUES(?,?,?,?)").run(otherJob, 1, 'Pilares', today);
  const at = new Date(); // mover la hora a las 18:31 locales con un reloj falso
  const fake = new Date(at.getTime());
  const loc = new Intl.DateTimeFormat('en-US', { timeZone: process.env.APP_TZ || 'America/Chicago', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(fake);
  const mins = (+loc.find(p => p.type === 'hour').value % 24) * 60 + +loc.find(p => p.type === 'minute').value;
  const t1831 = new Date(fake.getTime() + (18 * 60 + 31 - mins) * 60000);
  const gid = server.db.prepare("SELECT id FROM users WHERE username='glaiber'").get().id;
  const before = notes(gid).length, beforeM = notes(marioId).length;
  H.tick(server.db, t1831);
  const n = notes(gid).slice(before);
  assert.ok(n.some(x => /reporte del día/i.test(x.title) && x.body.includes('Otra')), 'al dueño le llega la de la obra sin PM');
  assert.equal(notes(marioId).length, beforeM, 'Mario ya escribió su reporte: no le llega');
  H.tick(server.db, t1831);
  assert.equal(notes(gid).length, before + n.length, 'una sola vez al día');
});

test('cerrar el día lo congela; después solo notas tardías', async () => {
  assert.equal((await luis.post(`/api/jobs/${job}/history/close`, { date: today })).status, 403);
  assert.equal((await mario.post(`/api/jobs/${job}/history/notes`, { date: today, text: 'Algo más' })).status, 409, 'abierto: use el reporte');
  assert.equal((await mario.post(`/api/jobs/${job}/history/close`, { date: today })).status, 200);
  assert.equal((await mario.post(`/api/jobs/${job}/history/close`, { date: today })).status, 409);
  const h1 = (await g.get(`/api/jobs/${job}/history?d=${today}`)).data;
  assert.equal(h1.closed, true); assert.equal(h1.closed_by, 'Mario'); assert.equal(h1.auto, false);
  // Lo que pase después no cambia el día congelado.
  await mario.post(`/api/jobs/${job}/logs`, { date: today, client_notes: 'Reporte tarde' });
  const h2 = (await g.get(`/api/jobs/${job}/history?d=${today}`)).data;
  assert.equal(h2.notes.length, h1.notes.length, 'congelado');
  assert.equal((await mario.post(`/api/jobs/${job}/history/notes`, { date: today, text: 'El inspector llamó a las 7 PM' })).status, 200);
  const h3 = (await g.get(`/api/jobs/${job}/history?d=${today}`)).data;
  assert.equal(h3.late.length, 1); assert.equal(h3.late[0].by, 'Mario');
  assert.ok(server.db.prepare('SELECT hash FROM job_days WHERE job_id=?').get(job).hash.length === 64);
});

test('10 PM: los días abiertos con algo se cierran solos', async () => {
  const t2201 = new Date(Date.now() + 24 * 3600e3); // mañana a cualquier hora: hoy ya pasó
  H.tick(server.db, t2201);
  await new Promise(r => setTimeout(r, 200));
  const row = server.db.prepare('SELECT * FROM job_days WHERE job_id=? AND date=?').get(otherJob, today);
  // La otra obra no tiene nada registrado (solo una tarea programada): no se crea un día vacío.
  assert.equal(row, undefined);
  server.db.prepare("UPDATE tasks SET status='hecho', done_date=? WHERE job_id=?").run(today, otherJob);
  server.db.prepare("DELETE FROM meta WHERE key='hist_closed_upto'").run();
  H.tick(server.db, t2201);
  await new Promise(r => setTimeout(r, 200));
  const row2 = server.db.prepare('SELECT * FROM job_days WHERE job_id=? AND date=?').get(otherJob, today);
  assert.ok(row2 && row2.auto === 1, 'cerrado solo');
});

test('PDF en inglés (y en español si se pide)', async () => {
  const r = await mario.get(`/api/jobs/${job}/history/pdf?d=${today}`);
  assert.equal(r.status, 200); assert.ok(r.type.includes('pdf'));
  const s = r.data.toString('latin1');
  assert.ok(s.startsWith('%PDF-')); assert.ok(s.includes('DAILY LOG')); assert.ok(s.includes('Late entry'));
  const es = (await mario.get(`/api/jobs/${job}/history/pdf?d=${today}&lang=es`)).data.toString('latin1');
  assert.ok(es.includes('HISTORIAL DIARIO'));
  const all = await g.get(`/api/jobs/${job}/history/pdf`);
  assert.equal(all.status, 200, 'toda la obra');
});
