'use strict';
// v2.28 — Resumen de la mañana y borradores de mensajes de texto.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const DG = require('../lib/digest');

let server, base, dir;
const sent = [];
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-dig-'));
  process.env.TWILIO_ACCOUNT_SID = 'ACtest'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '+15550000000';
  server = createServer({ dataDir: dir, smsSend: async m => { sent.push(m); return { sid: 'SM' + sent.length, status: 'queued' }; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); server.db.close(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM; });
function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { get: u => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b) };
}
const g = client(), pm = client(), luis = client(), cli = client();
let job, other, ids = {}, today, tom;

test('preparación', async () => {
  await g.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  await g.post('/api/login', { username: 'glaiber', password: 'contrasena-g-123' });
  const mk = async (name, role, extra = {}) => (await g.post('/api/users', { name, username: name.toLowerCase(), password: 'contrasena-' + name.toLowerCase(), role, ...extra })).data.id;
  ids.pm = await mk('Pema', 'pm'); ids.luis = await mk('Luis', 'worker', { phone: '(555) 010-0003' }); ids.cli = await mk('Clie', 'client', { lang: 'en' });
  for (const [c, u] of [[pm, 'pema'], [luis, 'luis'], [cli, 'clie']]) await c.post('/api/login', { username: u, password: 'contrasena-' + u });
  job = (await g.post('/api/jobs', { client_name: 'Melbourne Family', client_phone: '(555) 010-0099', address: '5020 Melbourne Dr', project_type: 'patio_cover', status: 'activo' })).data.id;
  other = (await g.post('/api/jobs', { client_name: 'Otra', project_type: 'patio_cover', status: 'activo' })).data.id;
  server.db.prepare('UPDATE jobs SET pm_id=?, client_user_id=? WHERE id=?').run(ids.pm, ids.cli, job);
  today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); tom = d.toISOString().slice(0, 10);
  const ins = server.db.prepare('INSERT INTO tasks(job_id,position,title,planned_date,assignee_id) VALUES(?,?,?,?,?)');
  ins.run(job, 1, 'Excavar pilares', today, ids.luis);
  ins.run(job, 2, 'Colar concreto', tom, ids.luis);
  ins.run(other, 1, 'Pilares en Otra', today, null);
  server.db.prepare("INSERT INTO permits(job_id,kind,name,date,status) VALUES(?,?,?,?,?)").run(job, 'inspeccion', 'Pier inspection', tom, 'pendiente');
});

test('resumen: cada quien ve su día', async () => {
  const o = (await g.get('/api/digest')).data;
  assert.ok(o.sections.find(s => s.key === 'work').items.length >= 2, 'el dueño ve las dos obras');
  const p = (await pm.get('/api/digest')).data;
  const pw = p.sections.find(s => s.key === 'work');
  assert.equal(pw.items.length, 1, 'el PM solo su obra'); assert.ok(!p.sections.some(s => s.key === 'money'), 'el PM no ve el dinero de la compañía');
  const w = (await luis.get('/api/digest')).data;
  assert.equal(w.sections.find(s => s.key === 'work').items.length, 1); assert.ok(!JSON.stringify(w).includes('$'));
  assert.equal((await cli.get('/api/digest')).status, 403);
  assert.equal((await pm.get(`/api/digest?user_id=${ids.luis}`)).status, 403);
  assert.equal((await g.get(`/api/digest?user_id=${ids.luis}`)).data.for.id, ids.luis);
});

test('a las 6:30 AM llega el aviso, una vez al día; cada quien lo puede apagar; los dueños cambian la hora', async () => {
  await luis.put('/api/digest/settings', { off: true });
  assert.equal((await pm.put('/api/digest/settings', { time: '07:00' })).status, 403);
  assert.equal((await g.put('/api/digest/settings', { time: '06:30' })).status, 200);
  const loc = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
  const mins = (+loc.find(x => x.type === 'hour').value % 24) * 60 + +loc.find(x => x.type === 'minute').value;
  const at = new Date(Date.now() + (6 * 60 + 35 - mins) * 60000);
  if (new Date(today + 'T12:00:00Z').getUTCDay() === 0) server.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('digest_sunday','1')").run();
  const cnt = uid => server.db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND url='#/resumen'").get(uid).n;
  DG.tick(server.db, at); DG.tick(server.db, at);
  const gid = server.db.prepare("SELECT id FROM users WHERE username='glaiber'").get().id;
  assert.equal(cnt(gid), 1); assert.equal(cnt(ids.pm), 1); assert.equal(cnt(ids.luis), 0, 'lo apagó');
});

test('borradores: se arman solos, en el idioma de cada quien, sin dinero; se mandan o se marcan', async () => {
  const r = (await g.get('/api/sms/drafts')).data;
  const kinds = r.drafts.map(d => d.kind).sort();
  assert.deepEqual(kinds, ['insp_cliente', 'manana_cliente', 'manana_sub'].sort(), JSON.stringify(r.drafts));
  const cliD = r.drafts.find(d => d.kind === 'manana_cliente');
  assert.equal(cliD.lang, 'en'); assert.match(cliD.body, /tomorrow/);
  const subD = r.drafts.find(d => d.kind === 'manana_sub');
  assert.equal(subD.lang, 'es'); assert.match(subD.body, /mañana/); assert.ok(!/\d{1,2}:\d{2}/.test(subD.body), 'sin horario');
  assert.ok(!r.drafts.some(d => /\$/.test(d.body)));
  assert.equal((await g.get('/api/sms/drafts')).data.drafts.length, 3, 'no se repiten');
  assert.equal((await pm.get('/api/sms/drafts')).data.drafts.length, 3, 'el PM ve los de su obra');
  const s = await g.post(`/api/sms/drafts/${cliD.id}/send`, { body: cliD.body + ' 👍' });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.ok(sent.at(-1).body.includes('👍') && sent.at(-1).to === '+15550100099');
  assert.equal((await g.post(`/api/sms/drafts/${cliD.id}/send`, {})).status, 409);
  assert.equal((await g.post(`/api/sms/drafts/${subD.id}/done`, { discard: true })).status, 200);
  assert.equal((await g.get('/api/sms/drafts')).data.drafts.length, 1);
  assert.equal((await luis.get('/api/sms/drafts')).status, 403);
});
