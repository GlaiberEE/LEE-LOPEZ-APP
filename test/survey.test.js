'use strict';
// v2.32 — Encuesta al cliente solo al terminar la obra; respuestas solo para los dueños.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const S = require('../lib/survey');

let server, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-survey-'));
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
const owner = client(), pm = client(), cli = client(), anon = client();
const db = () => server.db;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
let job, old, pmId;

test('preparación', async () => {
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'contrasena-g-123' });
  pmId = (await owner.post('/api/users', { name: 'Mario', username: 'mario', password: 'contrasena-mario', role: 'pm' })).data.id;
  const cliId = (await owner.post('/api/users', { name: 'Ana Lee', username: 'ana', password: 'contrasena-ana-1', role: 'client', lang: 'es' })).data.id;
  await pm.post('/api/login', { username: 'mario', password: 'contrasena-mario' });
  await cli.post('/api/login', { username: 'ana', password: 'contrasena-ana-1' });
  job = (await owner.post('/api/jobs', { template: 'base', client_name: 'Ana Lee', client_phone: '+19725550101', address: '1 Oak', project_type: 'patio_cover', status: 'activo' })).data.id;
  old = (await owner.post('/api/jobs', { template: 'base', client_name: 'Viejo', address: '2 Oak', project_type: 'otro', status: 'activo' })).data.id;
  db().prepare('UPDATE jobs SET pm_id=?, client_user_id=? WHERE id=?').run(pmId, cliId, job);
});

test('no se pide al principio ni durante la obra', async () => {
  S.tick(db());
  assert.equal(db().prepare('SELECT COUNT(*) n FROM job_surveys').get().n, 0);
  assert.equal((await cli.get(`/api/jobs/${job}/survey`)).data.survey, null);
});

test('al terminar la obra: encuesta, texto listo y aviso al cliente', async () => {
  db().prepare("UPDATE meta SET value='2000-01-01' WHERE key='survey_since'").run();
  db().prepare("UPDATE jobs SET status='terminado', completed_date=? WHERE id=?").run(today, job);
  db().prepare("UPDATE jobs SET status='terminado', completed_date='1999-01-01' WHERE id=?").run(old);
  S.tick(db());
  const s = db().prepare('SELECT * FROM job_surveys WHERE job_id=?').get(job);
  assert.ok(s && s.token); assert.equal(s.lang, 'es', 'en el idioma del cliente');
  assert.ok(!db().prepare('SELECT 1 FROM job_surveys WHERE job_id=?').get(old), 'las obras viejas no reciben encuesta');
  const d = db().prepare("SELECT * FROM sms_drafts WHERE kind='encuesta' AND job_id=?").get(job);
  assert.ok(d && /encuesta\.html\?t=/.test(d.body) && /Hola Ana/.test(d.body));
  const c = (await cli.get(`/api/jobs/${job}/survey`)).data.survey;
  assert.ok(c.url.startsWith('/encuesta.html?t=') && c.answered === false);
});

test('público: se contesta una vez; calificación baja avisa a los dueños', async () => {
  const tok = db().prepare('SELECT token FROM job_surveys WHERE job_id=?').get(job).token;
  const g = await anon.get(`/api/public/survey/${tok}`);
  assert.equal(g.data.client, 'Ana'); assert.equal(g.data.answered, false);
  assert.equal((await anon.post(`/api/public/survey/${tok}`, { q_clean: 5 })).status, 400, 'faltan preguntas');
  const r = await anon.post(`/api/public/survey/${tok}`, { q_clean: 2, q_time: 4, q_comm: 3, q_quality: 5, q_crew: 5, nps: 6, improve: 'Dejaron basura en el jardín', liked: 'La calidad', lang: 'es' });
  assert.equal(r.data.ok, true); assert.equal(r.data.low, true); assert.equal(r.data.review_link, '', 'a quien califica bajo no se le pide reseña');
  assert.equal((await anon.post(`/api/public/survey/${tok}`, { q_clean: 5, q_time: 5, q_comm: 5, q_quality: 5, q_crew: 5 })).status, 400, 'una sola vez');
  assert.equal(db().prepare('SELECT stars, comment FROM job_ratings WHERE job_id=?').get(job).stars, 4, 'al PM solo le llega el promedio');
  assert.equal(db().prepare('SELECT comment FROM job_ratings WHERE job_id=?').get(job).comment, '', 'sin comentarios');
  assert.equal((await anon.get('/api/public/survey/no-existe-este-enlace-123')).status, 404);
});

test('solo los dueños ven las opiniones', async () => {
  const r = (await owner.get('/api/surveys')).data;
  assert.equal(r.answered, 1); assert.equal(r.to_call, 1);
  assert.equal(r.answers[0].improve, 'Dejaron basura en el jardín');
  assert.equal(r.by_pm[0].name, 'Mario');
  assert.equal((await pm.get('/api/surveys')).status, 403, 'el PM no las ve');
  assert.equal((await cli.get('/api/surveys')).status, 403);
  assert.equal((await owner.post(`/api/surveys/${job}/followed`, { note: 'Vamos a limpiar el sábado' })).data.ok, true);
  assert.equal((await owner.get('/api/surveys')).data.to_call, 0);
});

test('calificación alta: se ofrece la reseña de Google', async () => {
  await owner.put('/api/settings', { review_link: 'https://g.page/r/ejemplo/review' }).catch(() => {});
  db().prepare("INSERT INTO meta(key,value) VALUES('review_link','https://g.page/r/ejemplo/review') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  const j2 = (await owner.post('/api/jobs', { template: 'base', client_name: 'Bob', address: '3 Oak', project_type: 'otro', status: 'activo' })).data.id;
  db().prepare("UPDATE jobs SET status='terminado', completed_date=? WHERE id=?").run(today, j2);
  S.tick(db());
  const tok = db().prepare('SELECT token FROM job_surveys WHERE job_id=?').get(j2).token;
  const r = await anon.post(`/api/public/survey/${tok}`, { q_clean: 5, q_time: 5, q_comm: 5, q_quality: 5, q_crew: 4, nps: 10 });
  assert.equal(r.data.low, false); assert.equal(r.data.review_link, 'https://g.page/r/ejemplo/review');
});

test('un solo recordatorio a los 3 días', () => {
  const j = db().prepare("SELECT id FROM jobs WHERE client_name='Ana Lee'").get().id;
  db().prepare("INSERT INTO jobs(client_name,address,project_type,status,completed_date,client_phone) VALUES('Cara','4 Oak','otro','terminado',?,'+19725550109')").run(today);
  S.tick(db());
  const cid = db().prepare("SELECT id FROM jobs WHERE client_name='Cara'").get().id;
  db().prepare("UPDATE job_surveys SET created_at=datetime('now','-4 days') WHERE job_id=?").run(cid);
  S.tick(db()); S.tick(db());
  assert.equal(db().prepare("SELECT COUNT(*) n FROM sms_drafts WHERE job_id=? AND kind='encuesta'").get(cid).n, 2, 'el primero y un recordatorio');
  assert.ok(j);
});
