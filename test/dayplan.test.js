'use strict';
// v2.24 — Plan del día: cada quien arma el de mañana; el jefe también (dueños a cualquiera, PM a los subs de sus obras).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-plan-'));
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
const g = client(), mario = client(), vero = client(), luis = client(), pedro = client();
let marioId, veroId, luisId, pedroId, job, tomorrow;
const notes = uid => server.db.prepare('SELECT title, body FROM notifications WHERE user_id=? ORDER BY id').all(uid);

test('preparación', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  const mk = async (name, role, trades) => (await g.post('/api/users', { name, username: name.toLowerCase(), password: 'contrasena-' + name.toLowerCase(), role, trades })).data.id;
  marioId = await mk('Mario', 'pm'); veroId = await mk('Vero', 'sales'); luisId = await mk('Luis', 'worker', ['electricidad']); pedroId = await mk('Pedro', 'worker', ['carpinteria']);
  for (const [c, u] of [[mario, 'mario'], [vero, 'vero'], [luis, 'luis'], [pedro, 'pedro']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await g.post('/api/jobs', { template: 'base', client_name: 'Melbourne', project_type: 'patio_cover', status: 'activo', start_date: '2026-11-02' })).data.id;
  server.db.prepare('UPDATE jobs SET pm_id=? WHERE id=?').run(marioId, job);
  await g.post(`/api/jobs/${job}/subs`, { name: 'Luis', user_id: luisId, agreed_cents: 1000, trades: ['electricidad'] });
  tomorrow = (await luis.get('/api/plan?d=manana')).data.date;
  server.db.prepare("UPDATE tasks SET planned_date=? WHERE id=(SELECT id FROM tasks WHERE job_id=? AND assignee_id=? ORDER BY position LIMIT 1)").run(tomorrow, job, luisId);
});

test('la app sugiere lo que ya sabe y cada quien arma su plan', async () => {
  const p = (await luis.get('/api/plan?d=manana')).data;
  assert.equal(p.mine, true);
  const s = p.suggestions.find(x => x.ref.startsWith('task:'));
  assert.ok(s, 'su tarea de mañana sale sugerida');
  await luis.post('/api/plan/items', { date: 'manana', text: s.text, job_id: s.job_id, ref: s.ref, time: '07:30' });
  await luis.post('/api/plan/items', { date: 'manana', text: 'Recoger cable UF en Home Depot' });
  const p2 = (await luis.get('/api/plan?d=manana')).data;
  assert.equal(p2.items.length, 2); assert.ok(!p2.suggestions.some(x => x.ref === s.ref), 'lo agregado ya no se sugiere');
  assert.equal(p2.items[0].time, '07:30', 'lo que tiene hora va primero');
});

test('el jefe le arma el plan: dueños a cualquiera, PM a los subs de sus obras', async () => {
  // PM a su sub: sí, y sin hora (es contratista).
  const r = await mario.post('/api/plan/items', { user_id: luisId, date: 'manana', text: 'Terminar rough eléctrico', job_id: job, time: '08:00' });
  assert.equal(r.status, 200); assert.equal(r.data.time, '', 'a un sub no se le pone horario');
  assert.equal(r.data.assigned_by, marioId);
  assert.ok(notes(luisId).some(n => /Mario le agregó|Mario added/.test(n.title)));
  assert.equal((await mario.post('/api/plan/items', { user_id: pedroId, date: 'manana', text: 'X' })).status, 403, 'Pedro no está en sus obras');
  assert.equal((await mario.post('/api/plan/items', { user_id: veroId, date: 'manana', text: 'X' })).status, 403, 'el PM no le arma el plan al vendedor');
  assert.equal((await vero.post('/api/plan/items', { user_id: luisId, date: 'manana', text: 'X' })).status, 403, 'el vendedor solo el suyo');
  assert.equal((await luis.get(`/api/plan?user_id=${pedroId}`)).status, 403);
  const own = await g.post('/api/plan/items', { user_id: veroId, date: 'manana', text: 'Llamar a los 3 prospectos de Google', time: '09:00' });
  assert.equal(own.data.time, '09:00', 'al vendedor sí se le puede poner hora');
  // Lo que puso el jefe no se borra ni se cambia; se marca hecho o "no se pudo" con motivo.
  assert.equal((await luis.del(`/api/plan/items/${r.data.id}`)).status, 403);
  assert.equal((await luis.put(`/api/plan/items/${r.data.id}`, { text: 'otra cosa' })).status, 403);
  assert.equal((await luis.put(`/api/plan/items/${r.data.id}`, { status: 'no' })).status, 400, 'hay que decir por qué');
  assert.equal((await luis.put(`/api/plan/items/${r.data.id}`, { status: 'no', reason: 'No llegó el material' })).data.status, 'no');
  assert.ok(notes(marioId).some(n => /no pudo|could not/.test(n.title)), 'el jefe se entera');
  const t = (await g.get('/api/plan/team?d=manana')).data.people;
  assert.ok(t.find(x => x.id === luisId).total >= 3);
  assert.equal((await luis.get('/api/plan/team')).status, 403);
});

test('a las 5 PM llega el aviso; en la noche lo pendiente pasa al siguiente día', async () => {
  const P = require('../lib/dayplan');
  const db = server.db;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  db.prepare("INSERT INTO plan_items(user_id,date,text,created_by) VALUES(?,?,'Pendiente viejo',?)").run(veroId, today, veroId);
  const five = new Date(); five.setUTCHours(23, 30, 0, 0); // 5:30 PM Chicago (invierno)
  P.tick(db, five);
  assert.ok(notes(veroId).some(n => /plan de mañana|Plan tomorrow/.test(n.title)));
  const before = notes(veroId).length; P.tick(db, five); assert.equal(notes(veroId).length, before, 'una vez al día');
  const night = new Date(five.getTime() + 5 * 3600e3); // 10:30 PM
  P.tick(db, night);
  const moved = db.prepare("SELECT * FROM plan_items WHERE user_id=? AND text='Pendiente viejo' ORDER BY id").all(veroId);
  assert.equal(moved[0].status, 'movido'); assert.equal(moved[1].status, 'pendiente'); assert.ok(moved[1].date > today);
});
