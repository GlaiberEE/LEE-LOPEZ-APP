'use strict';
// v2.35 — Selecciones del cliente: qué falta escoger, fecha límite, aprobación y recordatorios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const S = require('../lib/selections');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-sel-'));
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
const owner = client(), pm = client(), cli = client(), anon = client(), sub = client();
const db = () => server.db;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
let job, old, pmId;

test('preparación', async () => {
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  pmId = (await owner.post('/api/users', { name: 'Mario', username: 'mario', password: 'contrasena-mario', role: 'pm' })).data.id;
  const cliId = (await owner.post('/api/users', { name: 'Ana Lee', username: 'ana', password: 'contrasena-ana-1', role: 'client', lang: 'es' })).data.id;
  await pm.post('/api/login', { username: 'mario', password: 'contrasena-mario' });
  await cli.post('/api/login', { username: 'ana', password: 'contrasena-ana-1' });
  job = (await owner.post('/api/jobs', { template: 'base', client_name: 'Ana Lee', client_phone: '+19725550101', address: '1 Oak', project_type: 'outdoor_living', status: 'activo' })).data.id;
  old = (await owner.post('/api/jobs', { template: 'base', client_name: 'Viejo', address: '2 Oak', project_type: 'otro', status: 'activo' })).data.id;
  db().prepare('UPDATE jobs SET pm_id=?, client_user_id=? WHERE id=?').run(pmId, cliId, job);
  const sid = (await owner.post('/api/users', { name: 'Pedro', username: 'pedro', password: 'contrasena-pedro', role: 'worker' })).data.id;
  await sub.post('/api/login', { username: 'pedro', password: 'contrasena-pedro' });
  const t0 = db().prepare('SELECT id FROM tasks WHERE job_id=? ORDER BY id LIMIT 1').get(job).id;
  db().prepare('UPDATE tasks SET assignee_id=? WHERE id=?').run(sid, t0);
});


const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let stain, stone;

test('arma sola lo que normalmente se escoge, ligado a la tarea que lo necesita', async () => {
  const r = await owner.post(`/api/jobs/${job}/selections/auto`);
  assert.ok(r.data.added >= 3, JSON.stringify(r.data.selections.map(s => s.zone)));
  const zones = r.data.selections.map(s => s.zone);
  assert.ok(zones.includes('techo') && zones.includes('cocina_base'));
  assert.ok(r.data.selections.every(s => s.task), 'cada una sabe qué tarea la necesita');
  assert.equal((await owner.post(`/api/jobs/${job}/selections/auto`)).data.added, 0, 'no repite');
  stone = r.data.selections.find(s => s.zone === 'cocina_base');
});

test('fecha límite = fecha de la tarea menos los días para pedirlo; se mueve con la tarea', async () => {
  const day = addDays(today, 10);
  db().prepare('UPDATE tasks SET planned_date=? WHERE id=?').run(day, stone.task.id);
  let s = (await owner.get(`/api/jobs/${job}/selections`)).data.selections.find(x => x.id === stone.id);
  assert.equal(s.need_by, addDays(day, -7)); assert.equal(s.days_left, 3); assert.equal(s.soon, true);
  db().prepare('UPDATE tasks SET planned_date=? WHERE id=?').run(addDays(today, 5), stone.task.id);
  s = (await owner.get(`/api/jobs/${job}/selections`)).data.selections.find(x => x.id === stone.id);
  assert.equal(s.late, true); assert.equal(s.blocks, true, 'la tarea no ha empezado: queda detenida');
  const pend = (await pm.get('/api/selections/pending')).data;
  assert.ok(pend.some(x => x.id === stone.id), 'aparece en pendientes del PM');
});

test('opciones de la empresa → el cliente aprueba en su portal → entra a la ficha de materiales', async () => {
  const m = (await owner.post('/api/materials', { zone: 'cocina_base', name: 'Austin Stone', brand: 'Coronado', color_name: 'Cream' })).data;
  await owner.post(`/api/selections/${stone.id}/options`, { material_id: m.id, note: 'La más popular' });
  const v = (await owner.post(`/api/selections/${stone.id}/options`, { title: 'Ledgestone gris' })).data;
  assert.equal(v.options.length, 2);
  // El sub todavía no la ve.
  assert.ok(!(await sub.get(`/api/jobs/${job}/selections`)).data.selections.some(x => x.id === stone.id));
  const c = (await cli.get(`/api/jobs/${job}/selections`)).data.selections.find(x => x.id === stone.id);
  assert.equal(c.options.length, 2);
  const ok = (await cli.post(`/api/selections/${stone.id}/approve`, { option_id: v.options[0].id })).data;
  assert.equal(ok.status, 'aprobado'); assert.equal(ok.approved_how, 'portal'); assert.equal(ok.approved_name, 'Ana Lee');
  assert.ok(db().prepare('SELECT 1 FROM job_materials WHERE job_id=? AND material_id=?').get(job, m.id), 'el material entra a la ficha');
  assert.ok((await sub.get(`/api/jobs/${job}/selections`)).data.selections.some(x => x.id === stone.id), 'ya aprobada, el sub la ve');
  assert.ok(db().prepare("SELECT 1 FROM notifications WHERE title LIKE 'Aprobado:%'").get(), 'aviso a los dueños y al PM');
});

test('el cliente escoge por su cuenta; la empresa anota que lo aprobó en persona', async () => {
  stain = (await owner.post(`/api/jobs/${job}/selections`, { zone: 'pintura', label: 'Stain del cedro', label_en: 'Cedar stain', lead_days: 5 })).data;
  const ch = (await cli.post(`/api/selections/${stain.id}/choose`, { text: 'Sherwin-Williams Cedar Naturaltone' })).data;
  assert.equal(ch.status, 'escogido'); assert.equal(ch.choice_text, 'Sherwin-Williams Cedar Naturaltone');
  assert.equal((await pm.post(`/api/selections/${stain.id}/approve`, {})).status, 400, 'hay que decir cómo lo aprobó');
  const ap = (await pm.post(`/api/selections/${stain.id}/approve`, { how: 'por texto' })).data;
  assert.equal(ap.status, 'aprobado'); assert.equal(ap.approved_how, 'por texto');
});

test('cambiar algo aprobado: el cliente puede, y los dueños reciben aviso; el PM no lo cambia', async () => {
  assert.equal((await pm.post(`/api/selections/${stain.id}/choose`, { text: 'Otro color' })).status, 403);
  const r = (await cli.post(`/api/selections/${stain.id}/choose`, { text: 'Cabot Semi-Transparent Chestnut' })).data;
  assert.equal(r.status, 'escogido'); assert.equal(r.changed_after_approval, true);
  assert.ok(db().prepare("SELECT 1 FROM notifications WHERE title LIKE 'Cambio en algo ya aprobado%'").get());
  assert.ok((await owner.get('/api/selections/pending')).data.some(x => x.id === stain.id));
});

test('recordatorios al cliente: 3 días antes, el día y al día siguiente; una sola vez cada uno', async () => {
  const roof = (await owner.get(`/api/jobs/${job}/selections`)).data.selections.find(x => x.zone === 'techo');
  const now = new Date();
  db().prepare('UPDATE tasks SET planned_date=? WHERE id=?').run(addDays(today, 7 + 3), roof.task.id);
  S.tick(db(), now); S.tick(db(), now);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM sms_drafts WHERE ref=?").get(`sel:${roof.id}:pronto`).n, 1);
  const d = db().prepare("SELECT * FROM sms_drafts WHERE ref=?").get(`sel:${roof.id}:pronto`);
  assert.match(d.body, /Hola Ana/); assert.equal(d.kind, 'seleccion_cliente');
  db().prepare('UPDATE tasks SET planned_date=? WHERE id=?').run(addDays(today, 7 - 1), roof.task.id);
  S.tick(db(), now);
  assert.ok(db().prepare("SELECT 1 FROM sms_drafts WHERE ref=?").get(`sel:${roof.id}:tarde`));
  assert.ok(db().prepare("SELECT 1 FROM notifications WHERE title LIKE 'Selección atrasada%'").get(), 'aviso a dueños y PM cuando se atrasa');
});

test('permisos: el anónimo no ve; el cliente no crea ni da opciones; aprobada solo la quita un dueño', async () => {
  assert.equal((await anon.get(`/api/jobs/${job}/selections`)).status, 401);
  assert.equal((await cli.post(`/api/jobs/${job}/selections`, { zone: 'piso' })).status, 403);
  assert.equal((await cli.post(`/api/selections/${stone.id}/options`, { title: 'x' })).status, 403);
  assert.equal((await pm.del(`/api/selections/${stone.id}`)).status, 403);
  assert.equal((await owner.get(`/api/jobs/${old}/selections`)).data.selections.length, 0);
});
