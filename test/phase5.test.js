'use strict';
// v2.22 — Fase 5: inspecciones con resultado (pasó / no pasó), motivo y reinspección, aviso sin resultado,
// y lista de rough-in con fotos que no deja cerrar ni forrar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-f5-'));
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
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), del: u => call('DELETE', u) };
}
const JPG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]).toString('base64');
const g = client(), jack = client(), luis = client(), pedro = client();
let job, luisId, jackId, tasks, insp, cielo, forro;
const T = async () => (await g.get(`/api/jobs/${job}`)).data.tasks;
const notes = uid => server.db.prepare('SELECT title, body FROM notifications WHERE user_id=? ORDER BY id').all(uid);

test('preparación: patio cover con eléctrico, inspección de rough y tareas de cerrar', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  jackId = (await g.post('/api/users', { name: 'Jack', username: 'jack', password: 'contrasena-jack', role: 'owner' })).data.id;
  luisId = (await g.post('/api/users', { name: 'Luis', username: 'luis', password: 'contrasena-luis', role: 'worker', trades: ['electricidad'] })).data.id;
  const pedroId = (await g.post('/api/users', { name: 'Pedro', username: 'pedro', password: 'contrasena-pedro', role: 'worker', trades: ['carpinteria'] })).data.id;
  for (const [c, u] of [[jack, 'jack'], [luis, 'luis'], [pedro, 'pedro']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await g.post('/api/jobs', { template: 'base', client_name: 'Melbourne', project_type: 'patio_cover', status: 'activo', start_date: '2026-11-02' })).data.id;
  await g.post(`/api/jobs/${job}/subs`, { name: 'Luis', user_id: luisId, agreed_cents: 100000, trades: ['electricidad'] });
  await g.post(`/api/jobs/${job}/subs`, { name: 'Pedro', user_id: pedroId, agreed_cents: 100000, trades: ['carpinteria'] });
  tasks = await T();
  insp = tasks.find(t => /framing y eléctrico rough/.test(t.title));
  cielo = tasks.find(t => /Cielo de cedro/.test(t.title)); forro = tasks.find(t => /Forrar postes/.test(t.title));
  assert.ok(insp && cielo && forro);
  assert.equal(cielo.assignee_id, pedroId);
});

test('la lista de rough-in sale sola con lo que aplica a la obra', async () => {
  const r = (await g.get(`/api/jobs/${job}/roughin`)).data;
  assert.deepEqual(r.items.map(i => i.key), ['plugs', 'luces'], 'solo eléctrico en esta obra');
  assert.deepEqual(r.close_tasks.map(t => [t.id, t.blocked]), [[cielo.id, true], [forro.id, true]]);
  assert.equal((await g.post(`/api/jobs/${job}/roughin`, { label: 'Conduit del switch a la chimenea', trade: 'electricidad' })).status, 200);
});

test('no se cierra ni se forra sin la foto del rough-in y sin pasar la inspección', async () => {
  const r = await pedro.put(`/api/tasks/${cielo.id}`, { status: 'en_progreso' });
  assert.equal(r.status, 409); assert.match(r.data.error, /No se puede cerrar todavía/);
  assert.equal(r.data.canOverride, false, 'el sub no lo puede saltar');
  assert.equal(r.data.roughin.items.length, 3); assert.equal(r.data.roughin.inspections.length, 1);
  const o = await g.put(`/api/tasks/${cielo.id}`, { status: 'hecho' });
  assert.equal(o.status, 409); assert.equal(o.data.canOverride, true);
  // Confirmar: con foto, y quien hace ese trade.
  const items = (await luis.get(`/api/jobs/${job}/roughin`)).data.items;
  assert.equal((await luis.post(`/api/roughin/${items[0].id}/confirm`, {})).status, 400, 'sin foto no');
  assert.equal((await pedro.post(`/api/roughin/${items[0].id}/confirm`, { photo: JPG })).status, 403, 'el carpintero no confirma lo eléctrico');
  for (const it of items.slice(0, 2)) assert.equal((await luis.post(`/api/roughin/${it.id}/confirm`, { photo: JPG, note: 'Listo' })).status, 200);
  assert.equal((await luis.post(`/api/roughin/${items[2].id}/na`, { reason: 'x' })).status, 403, '"no aplica" lo dice un dueño');
  assert.equal((await g.post(`/api/roughin/${items[2].id}/na`, { reason: 'Se hace por fuera' })).status, 200);
  const left = await pedro.put(`/api/tasks/${cielo.id}`, { status: 'en_progreso' });
  assert.equal(left.status, 409); assert.equal(left.data.roughin.items.length, 0, 'ya solo falta la inspección');
  const photos = server.db.prepare("SELECT COUNT(*) n FROM files WHERE job_id=? AND caption LIKE 'Rough-in:%'").get(job).n;
  assert.equal(photos, 2);
});

test('no pasó: motivo, reinspección, tarea para corregir y aviso; luego pasó', async () => {
  const pid = server.db.prepare("SELECT id FROM permits WHERE task_id=?").get(insp.id)?.id
    || Number(server.db.prepare("INSERT INTO permits(job_id,kind,name,status,date,task_id) VALUES(?,'inspeccion',?,'programada','2026-11-10',?)").run(job, insp.title, insp.id).lastInsertRowid);
  assert.equal((await g.post(`/api/permits/${pid}/result`, { result: 'fallo' })).status, 400, 'hay que decir por qué');
  const f = (await g.post(`/api/permits/${pid}/result`, { result: 'fallo', reason: 'Código nuevo: exige cable UF', reinspect_date: '2026-11-19', inspector: 'Mr. Smith', photo: JPG })).data;
  assert.ok(f.reinspection_id && f.fix_task_id);
  const old = server.db.prepare('SELECT * FROM permits WHERE id=?').get(pid), re = server.db.prepare('SELECT * FROM permits WHERE id=?').get(f.reinspection_id);
  assert.deepEqual([old.status, old.fail_reason, old.inspector], ['rechazado', 'Código nuevo: exige cable UF', 'Mr. Smith']);
  assert.deepEqual([re.status, re.date, re.attempt, re.reinspect_of, re.task_id], ['programada', '2026-11-19', 2, pid, insp.id]);
  const ts = await T(); const ii = ts.findIndex(t => t.id === insp.id);
  assert.equal(ts[ii - 1].id, f.fix_task_id, 'la corrección va justo antes de la inspección');
  assert.match(ts[ii - 1].title, /Corregir para reinspección: Código nuevo/);
  assert.equal(ts[ii].planned_date, '2026-11-19');
  assert.ok(notes(jackId).some(n => /No pasó la inspección/.test(n.title) && /cable UF/.test(n.body)), 'aviso al otro dueño');
  assert.equal((await g.post(`/api/permits/${pid}/result`, { result: 'paso' })).status, 400, 'la que no pasó no se cambia; se usa su reinspección');
  const ok = (await jack.post(`/api/permits/${f.reinspection_id}/result`, { result: 'paso', date: '2026-11-19' })).data;
  assert.equal(ok.result, 'paso');
  assert.equal((await T()).find(t => t.id === insp.id).status, 'hecho');
  // Ya no hay freno: se puede empezar el cielo.
  assert.equal((await pedro.put(`/api/tasks/${cielo.id}`, { status: 'en_progreso' })).status, 200);
});

test('un dueño puede dejar pasar el freno con motivo (queda en el historial)', async () => {
  const it = (await g.post(`/api/jobs/${job}/roughin`, { label: 'Bocina extra del lado izquierdo', trade: 'av' })).data;
  assert.equal((await g.put(`/api/tasks/${forro.id}`, { status: 'hecho' })).status, 409);
  assert.equal((await g.put(`/api/tasks/${forro.id}`, { status: 'hecho', override_reason: 'El cliente la cambió por una portátil' })).status, 200);
  const a = server.db.prepare("SELECT * FROM audit_log WHERE entity='rough-in' AND reason<>'' ORDER BY id DESC").get();
  assert.match(a.summary, /Bocina extra/); assert.match(a.reason, /portátil/);
  void it;
});

test('inspección sin resultado: pendiente en Inicio y aviso una sola vez después de 24 horas', async () => {
  const id = Number(server.db.prepare("INSERT INTO permits(job_id,kind,name,status,date) VALUES(?,'inspeccion','Inspección de gas','programada','2026-11-01')").run(job).lastInsertRowid);
  const pend = (await g.get('/api/my-pending')).data;
  const items = Array.isArray(pend) ? pend : pend.items;
  assert.ok(items.some(x => x.kind === 'insp_result' && x.id === id));
  const I = require('../lib/inspections');
  const morning = new Date('2026-11-23T15:00:00Z');
  assert.ok(I.tick(server.db, morning) >= 1);
  assert.equal(I.tick(server.db, morning), 0, 'una sola vez');
  assert.ok(notes(jackId).some(n => /sin resultado/.test(n.title)));
});
