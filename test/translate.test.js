'use strict';
// v2.13: traducción automática. Se usa un traductor de prueba (sin internet) que marca los textos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const T = require('../lib/translate');

// Traductor falso: detecta español por palabras comunes y "traduce" agregando una marca.
let calls = 0;
const fake = async text => {
  calls++;
  const es = /\b(el|la|los|las|de|que|en|una|viga|caja|mañana|puedes)\b/i.test(text);
  return es ? { source: 'es', es: text, en: `[EN] ${text}` } : { source: 'en', es: `[ES] ${text}`, en: text };
};

async function start() {
  T.setTestProvider(fake);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-tr-'));
  const sent = [];
  const srv = createServer({ dataDir: dir, smsSend: async m => { sent.push(m); return { sid: 'SM1', status: 'queued' }; } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}) };
  };
  const owner = client();
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
  await owner.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
  const mk = async (name, role, lang, phone = '') => (await owner.post('/api/users', { name, username: name.toLowerCase(), password: 'otra-clave-larga-1', role, lang, phone })).body.id;
  const jack = await mk('Jack', 'pm', 'en', '(214) 555-0101');
  const salomon = await mk('Salomon', 'worker', 'es', '(214) 555-0102');
  const job = (await owner.post('/api/jobs', { client_name: 'Smith', address: '1 Main St', status: 'activo' })).body;
  await owner.put(`/api/jobs/${job.id}`, { pm_id: jack });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Salomon', trade: 'Concreto', agreed_cents: 100000, user_id: salomon });
  const as = async u => { const c = client(); await c.post('/api/login', { username: u, password: 'otra-clave-larga-1' }); return c; };
  return { srv, owner, job, ids: { jack, salomon }, jackC: await as('jack'), sal: await as('salomon'), sent };
}

test('Salomón escribe en español y Jack (PM, inglés) lo lee en inglés; la respuesta de Jack le llega a Salomón en español', async () => {
  const { srv, job, jackC, sal } = await start();
  try {
    const c = (await sal.post('/api/issues', { job_id: job.id, title: 'La viga viene torcida', body: 'La viga del lado norte viene torcida, no sigo hasta que me digan.' })).body;
    // Jack lee el caso en inglés, con el original guardado.
    const jv = (await jackC.get(`/api/issues/${c.id}`)).body;
    assert.equal(jv.title_tr, '[EN] La viga viene torcida');
    assert.equal(jv.messages[0].body, 'La viga del lado norte viene torcida, no sigo hasta que me digan.', 'el original siempre va');
    assert.equal(jv.messages[0].body_tr, '[EN] La viga del lado norte viene torcida, no sigo hasta que me digan.');
    assert.equal(jv.messages[0].body_from, 'es');
    // En la lista de Jack también.
    const list = (await jackC.get('/api/issues')).body;
    assert.equal(list[0].title_tr, '[EN] La viga viene torcida');
    // Salomón ve su propio texto sin traducir.
    const sv = (await sal.get(`/api/issues/${c.id}`)).body;
    assert.equal(sv.title_tr, undefined); assert.equal(sv.messages[0].body_tr, undefined);
    // Jack contesta en inglés → Salomón lo lee en español.
    await jackC.post(`/api/issues/${c.id}/messages`, { body: 'Send me a close-up photo please.' });
    const sv2 = (await sal.get(`/api/issues/${c.id}`)).body;
    assert.equal(sv2.messages.at(-1).body_tr, '[ES] Send me a close-up photo please.');
    // Lo mismo que ya se tradujo no se vuelve a pagar.
    const before = calls;
    await jackC.get(`/api/issues/${c.id}`); await sal.get(`/api/issues/${c.id}`);
    assert.equal(calls, before, 'usa lo guardado');
    // "Mis pendientes" de Jack, en inglés.
    assert.ok((await jackC.get('/api/my-pending')).body.some(x => x.title_tr === '[EN] La viga viene torcida'));
  } finally { srv.close(); T.setTestProvider(null); }
});

test('textos: a quien habla otro idioma se le manda traducido y se guarda lo que se escribió', async () => {
  const { srv, owner, ids, sent } = await start();
  try {
    process.env.TWILIO_ACCOUNT_SID = 'AC1'; process.env.TWILIO_AUTH_TOKEN = 't'; process.env.TWILIO_FROM = '+12145550000';
    const st = (await owner.get('/api/sms/status')).body;
    assert.equal(st.translate, true);
    assert.equal(st.enabled, true);
    const r = await owner.post('/api/sms/send', { user_id: ids.jack, body: 'Mañana llega la madera a las 8' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(sent.at(-1).body, /\[EN\] Mañana llega la madera a las 8/);
    assert.equal(r.body.original, 'Mañana llega la madera a las 8');
    // Sin traducir si se apaga la casilla.
    await owner.post('/api/sms/send', { user_id: ids.jack, body: 'Mañana sin traducir', translate: false });
    assert.match(sent.at(-1).body, /Mañana sin traducir/); assert.doesNotMatch(sent.at(-1).body, /\[EN\]/);
    // A quien habla el mismo idioma, va igual.
    await owner.post('/api/sms/send', { user_id: ids.salomon, body: 'Mañana llega la madera' });
    assert.doesNotMatch(sent.at(-1).body, /\[EN\]/);
  } finally { srv.close(); T.setTestProvider(null); delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM; }
});

test('sin clave de AI no traduce y nada falla', async () => {
  const { srv, job, jackC, sal } = await start();
  try {
    T.setTestProvider(null);
    const keys = [process.env.ANTHROPIC_API_KEY, process.env.XAI_API_KEY]; delete process.env.ANTHROPIC_API_KEY; delete process.env.XAI_API_KEY;
    const c = (await sal.post('/api/issues', { job_id: job.id, title: 'La caja eléctrica', body: 'La caja está donde va el granito.' }));
    assert.equal(c.status, 200);
    const jv = (await jackC.get(`/api/issues/${c.body.id}`)).body;
    assert.equal(jv.title_tr, undefined); assert.equal(jv.messages[0].body, 'La caja está donde va el granito.');
    if (keys[0]) process.env.ANTHROPIC_API_KEY = keys[0]; if (keys[1]) process.env.XAI_API_KEY = keys[1];
  } finally { srv.close(); }
});

test('el traductor nunca cambia lo que no es texto y entiende la respuesta de la AI', () => {
  assert.equal(T.worth('12'), false); assert.equal(T.worth('$1,500'), false); assert.equal(T.worth('👍'), false); assert.equal(T.worth('ok listo'), true);
  const p = T.parse('Aquí va: {"source":"es","es":"Hola","en":"Hello"} gracias');
  assert.deepEqual(p, { source: 'es', es: 'Hola', en: 'Hello' });
  assert.throws(() => T.parse('sin json'));
});
