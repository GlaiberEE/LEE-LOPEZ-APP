'use strict';
// Calendario, reprogramación, avisos a subs y novedades al cliente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createServer } = require('../server');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-sched-'));
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
const owner = client(), pedro = client(), luis = client(), cli = client(), other = client();
let job, tasks, pedroId, luisId;

test('preparación', async () => {
  await owner.post('/api/setup', { name: 'G', username: 'glaiber', password: 'contrasena-g-123' });
  const mk = async (u, role, lang) => (await owner.post('/api/users', { name: u, username: u, password: 'contrasena-' + u, role, lang, phone: '(214) 555-0100' })).data.id;
  pedroId = await mk('pedro', 'worker', 'es'); luisId = await mk('luis', 'worker', 'en');
  const cid = await mk('cli', 'client', 'en'); await mk('other', 'client', 'en');
  for (const [c, u] of [[pedro, 'pedro'], [luis, 'luis'], [cli, 'cli'], [other, 'other']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await owner.post('/api/jobs', { client_name: 'Smith', client_phone: '(972) 555-0199', project_type: 'fire_pit', status: 'cotizado', end_date: '2026-12-20' })).data.id;
  await owner.put(`/api/jobs/${job}`, { client_user_id: cid });
  tasks = (await owner.get(`/api/jobs/${job}`)).data.tasks;   // 7 tareas
  const dates = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06', '2026-12-07'];
  for (let i = 0; i < tasks.length; i++) await owner.put(`/api/tasks/${tasks[i].id}`, { planned_date: dates[i], assignee_id: i === 1 ? pedroId : i >= 3 ? luisId : null });
  await owner.put(`/api/tasks/${tasks[1].id}`, { planned_end: '2026-12-02' });
  assert.equal((await owner.put(`/api/tasks/${tasks[1].id}`, { planned_end: '2026-11-01' })).status, 400, 'fin antes del inicio');
});

test('el inicio de obra se informa al cliente', async () => {
  const r = await owner.put(`/api/jobs/${job}`, { status: 'activo' });
  assert.equal(r.data.clientUpdateRow.kind, 'status');
  assert.equal(r.data.client.lang, 'en');
  const u = (await cli.get(`/api/jobs/${job}`)).data.updates;
  assert.equal(u.length, 1);
});

test('calendario por rol', async () => {
  const all = (await owner.get('/api/calendar?from=2026-12-01&to=2026-12-31')).data;
  assert.equal(all.length, 7);
  assert.equal((await owner.get(`/api/calendar?from=2026-12-01&to=2026-12-31&user=${luisId}`)).data.length, 4);
  const mine = (await pedro.get('/api/calendar?from=2026-12-01&to=2026-12-31')).data;
  assert.deepEqual(mine.map(t => t.id), [tasks[1].id]);
  assert.equal((await pedro.get(`/api/calendar?from=2026-12-01&to=2026-12-31&user=${luisId}`)).data.length, 1, 'el trabajador no puede ver el de otro');
  assert.equal((await cli.get('/api/calendar')).status, 403);
});

test('reprogramar con efecto cascada, avisos y novedad al cliente', async () => {
  const r = await owner.post(`/api/tasks/${tasks[1].id}/reschedule`, { new_date: '2026-12-05', reason: 'inspeccion', note: 'Falló la inspección',
    cascade: true, move_end: true, notify_sub: true, inform_client: true, client_note: 'Esperamos a la ciudad' });
  assert.equal(r.status, 200);
  assert.equal(r.data.moved, 5, 'las 5 tareas siguientes se movieron');
  const t = (await owner.get(`/api/jobs/${job}`)).data.tasks;
  assert.equal(t[1].planned_date, '2026-12-05'); assert.equal(t[1].planned_end, '2026-12-05');
  assert.equal(t[2].planned_date, '2026-12-06'); assert.equal(t[6].planned_date, '2026-12-10');
  assert.equal(t[0].planned_date, '2026-12-01', 'la anterior no se mueve');
  assert.equal((await owner.get(`/api/jobs/${job}`)).data.job.end_date, '2026-12-23');
  // Pedro (su tarea) + Luis (4 tareas movidas)
  assert.equal(r.data.notices.length, 5);
  assert.equal(r.data.notices[0].to.name, 'pedro');
  assert.equal(r.data.clientUpdateRow.kind, 'schedule');
  const data = JSON.parse(r.data.clientUpdateRow.data);
  assert.deepEqual([data.old, data.new, data.moved, data.end_date], ['2026-12-02', '2026-12-05', 5, '2026-12-23']);
  // el cliente ve la novedad pero no el motivo interno
  const cu = (await cli.get(`/api/jobs/${job}`)).data.updates[0];
  assert.equal(cu.note, 'Esperamos a la ciudad');
  assert.ok(!JSON.stringify(cu).includes('Falló la inspección'));
  assert.equal((await other.get(`/api/jobs/${job}/updates`)).status, 404);
});

test('el sub responde con la fecha en que puede regresar y el dueño acepta', async () => {
  const st = (await pedro.get('/api/status')).data.user.pending;
  assert.equal(st, 1);
  const mine = (await pedro.get('/api/notices')).data;
  assert.equal(mine.length, 1);
  const n = mine[0];
  assert.equal(n.reason, 'inspeccion'); assert.equal(n.new_date, '2026-12-05');
  assert.equal((await luis.post(`/api/notices/${n.id}/respond`, { action: 'confirm' })).status, 404, 'no es su aviso');
  assert.equal((await pedro.post(`/api/notices/${n.id}/respond`, { action: 'propose' })).status, 400, 'falta fecha');
  assert.equal((await pedro.post(`/api/notices/${n.id}/respond`, { action: 'propose', date: '2026-12-08', note: 'Estoy en otra obra' })).status, 200);
  assert.equal((await owner.get('/api/status')).data.user.pending, 1);
  const r = await owner.post(`/api/notices/${n.id}/accept`, { cascade: true, inform_client: true });
  assert.equal(r.status, 200);
  const t = (await owner.get(`/api/jobs/${job}`)).data.tasks;
  assert.equal(t[1].planned_date, '2026-12-08');
  assert.equal(t[2].planned_date, '2026-12-09');
  assert.equal((await owner.get('/api/status')).data.user.pending, 0);
  const closed = (await pedro.get('/api/notices')).data.find(x => x.id === n.id);
  assert.equal(closed.resolution, 'aceptado');
  assert.equal((await cli.get(`/api/jobs/${job}`)).data.updates.length, 3);
  // los avisos viejos de Luis se reemplazan por los nuevos
  const ln = (await luis.get('/api/notices')).data.filter(x => x.status === 'enviado');
  assert.equal(ln.length, 4);
});

test('el sub confirma la fecha propuesta', async () => {
  const n = (await luis.get('/api/notices')).data.find(x => x.status === 'enviado');
  assert.equal((await luis.post(`/api/notices/${n.id}/respond`, { action: 'confirm' })).status, 200);
  const after = (await luis.get('/api/notices')).data.find(x => x.id === n.id);
  assert.equal(after.resolution, 'confirmado');
  assert.equal(after.response_date, n.new_date);
});

test('el sub avisa por su cuenta que se atrasa', async () => {
  const tid = tasks[1].id;
  assert.equal((await luis.post(`/api/tasks/${tid}/delay`, { date: '2026-12-20' })).status, 403, 'no es su tarea');
  assert.equal((await pedro.post(`/api/tasks/${tid}/delay`, { reason: 'material' })).status, 400, 'falta fecha');
  const r = await pedro.post(`/api/tasks/${tid}/delay`, { date: '2026-12-11', reason: 'material', note: 'No llegó la madera' });
  assert.equal(r.status, 200);
  const n = (await owner.get('/api/notices')).data.find(x => x.id === r.data.id);
  assert.equal(n.status, 'respondido'); assert.equal(n.response_date, '2026-12-11'); assert.equal(n.response_note, 'No llegó la madera');
  assert.equal((await owner.post(`/api/notices/${n.id}/close`)).status, 200);
  assert.equal((await owner.get(`/api/jobs/${job}`)).data.tasks[1].planned_date, '2026-12-08', 'descartado: no cambia');
});

test('fecha por definir: el sub debe proponer', async () => {
  const r = await owner.post(`/api/tasks/${tasks[3].id}/reschedule`, { reason: 'clima', notify_sub: true });
  assert.equal(r.status, 200);
  const n = r.data.notices[0];
  assert.equal(n.new_date, '');
  assert.equal((await luis.post(`/api/notices/${n.id}/respond`, { action: 'confirm' })).status, 400);
  assert.equal((await luis.post(`/api/notices/${n.id}/respond`, { action: 'propose', date: '2026-12-15' })).status, 200);
  assert.equal((await owner.post(`/api/tasks/${tasks[0].id}/reschedule`, { reason: 'clima' })).status, 400, 'sin fecha y sin asignado');
});

test('change order aprobado se informa al cliente; permisos', async () => {
  const c = (await owner.post(`/api/jobs/${job}/changes`, { description: 'Luces extra', price_cents: 50000, status: 'pendiente' })).data;
  assert.equal(c.clientUpdateRow, null);
  const r = await owner.put(`/api/changes/${c.id}`, { status: 'aprobado' });
  assert.equal(r.data.clientUpdateRow.kind, 'change_order');
  assert.equal((await owner.put(`/api/changes/${c.id}`, { description: 'Luces extra (4)' })).data.clientUpdateRow, null, 'no se repite');
  assert.equal((await pedro.post(`/api/tasks/${tasks[1].id}/reschedule`, { new_date: '2026-12-30' })).status, 403);
  assert.equal((await cli.get('/api/notices')).status, 403);
  const note = await owner.post(`/api/jobs/${job}/updates`, { note: 'Mañana llega el material' });
  assert.equal(note.data.row.kind, 'note');
});

test('migración: una base de la versión anterior se actualiza sin perder datos', () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-old-'));
  const old = new DatabaseSync(path.join(d2, 'elevated.db'));
  old.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente', assignee_id INTEGER, planned_date TEXT DEFAULT '', done_date TEXT DEFAULT '', notes TEXT DEFAULT '');
    INSERT INTO tasks(job_id,title) VALUES (1,'vieja');`);
  old.close();
  const { open } = require('../lib/db');
  const db = open(d2);
  assert.equal(db.prepare('SELECT title, planned_end FROM tasks').get().title, 'vieja');
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, '24');
  db.close(); fs.rmSync(d2, { recursive: true, force: true });
});

test('el sub puede ver el teléfono de los dueños para mandarles su solicitud; no puede cambiar fechas él mismo', async () => {
  await owner.put('/api/users/1', { phone: '(214) 555-0001' });
  const o = (await pedro.get('/api/contacts/owners')).data;
  assert.equal(o.length, 1); assert.equal(o[0].phone, '(214) 555-0001'); assert.equal(o[0].username, undefined);
  assert.equal((await cli.get('/api/contacts/owners')).status, 403);
  const before = (await owner.get(`/api/jobs/${job}`)).data.tasks[1].planned_date;
  await pedro.put(`/api/tasks/${tasks[1].id}`, { planned_date: '2027-01-01', planned_end: '2027-01-02' });
  assert.equal((await owner.get(`/api/jobs/${job}`)).data.tasks[1].planned_date, before, 'la fecha solo cambia cuando el dueño aprueba');
});
