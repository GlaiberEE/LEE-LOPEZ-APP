'use strict';
// v2.3: mensajes de texto (Twilio), conector MCP para Grok y escaneo que archiva en la partida.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('../server');
const SMS = require('../lib/sms');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-v23-'));
  const srv = createServer({ dataDir: dir, ...opts });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; srv.base = base;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body, headers = {}) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
    };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}) };
  };
  const owner = client();
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
  await owner.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
  const mk = async (name, role, phone) => (await owner.post('/api/users', { name, username: name.toLowerCase(), password: 'otra-clave-larga-1', role, phone })).body.id;
  const subId = await mk('Pedro', 'worker', '(972) 555-0101');
  const otherSub = await mk('Luis', 'worker', '972-555-0102');
  const pmId = await mk('Mario', 'pm', '9725550103');
  const job = (await owner.post('/api/jobs', { template: 'base',  client_name: 'Smith', client_phone: '214 555 0199', address: '1 Main St', status: 'activo' })).body;
  const job2 = (await owner.post('/api/jobs', { template: 'base',  client_name: 'Jones', client_phone: '214 555 0177', address: '9 Oak St', status: 'activo' })).body;
  await owner.put(`/api/jobs/${job.id}`, { pm_id: pmId });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Pedro', trade: 'concreto', agreed_cents: 100000, user_id: subId });
  await owner.post(`/api/jobs/${job2.id}/subs`, { name: 'Luis', trade: 'eléctrico', agreed_cents: 100000, user_id: otherSub });
  const as = async u => { const c = client(); await c.post('/api/login', { username: u, password: 'otra-clave-larga-1' }); return c; };
  return { srv, base, dir, owner, as, job, job2, subId, otherSub, pmId, close: () => new Promise(r => srv.close(r)) };
}

test('teléfonos: formato internacional', () => {
  assert.equal(SMS.e164('(972) 555-0101'), '+19725550101');
  assert.equal(SMS.e164('1 972 555 0101'), '+19725550101');
  assert.equal(SMS.e164('+52 81 1234 5678'), '+528112345678');
  assert.equal(SMS.e164('123'), '');
});

test('firma de Twilio', () => {
  const token = 'tok', url = 'https://app.example.com/sms/twilio/ee', params = { From: '+19725550101', Body: 'Hola' };
  const sig = crypto.createHmac('sha1', token).update(url + 'BodyHolaFrom+19725550101').digest('base64');
  assert.ok(SMS.validSignature(token, url, params, sig));
  assert.ok(!SMS.validSignature(token, url, { ...params, Body: 'otro' }, sig));
  assert.ok(!SMS.validSignature(token, url, params, ''));
});

test('textos: sin Twilio no se mandan; con Twilio se mandan, llegan respuestas y cada quien ve lo suyo', async () => {
  const sent = [];
  const T = await start({ smsSend: async m => { sent.push(m); return { sid: 'SM' + sent.length, status: 'queued' }; } });
  try {
    const off = await T.owner.post('/api/sms/send', { phone: '9725550101', body: 'Hola' });
    assert.equal(off.status, 400, 'sin configurar');
    process.env.TWILIO_ACCOUNT_SID = 'AC123'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '(469) 555-0000';
    const st = (await T.owner.get('/api/sms/status')).body;
    assert.equal(st.enabled, true); assert.equal(st.from, '+14695550000');
    // contactos del dueño: subs, PM y clientes de las obras
    const cs = (await T.owner.get('/api/sms/contacts')).body.map(c => c.phone);
    for (const p of ['+19725550101', '+19725550102', '+19725550103', '+12145550199', '+12145550177']) assert.ok(cs.includes(p), p);
    const r = await T.owner.post('/api/sms/send', { phone: '(972) 555-0101', body: 'Mañana empieza el concreto' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(sent[0].to, '+19725550101'); assert.equal(sent[0].from, '+14695550000');
    assert.match(sent[0].body, /^Elevated Exteriors: Mañana empieza el concreto\nResponda STOP/, 'dice quién manda y cómo dejar de recibir');
    await T.owner.post('/api/sms/send', { phone: '9725550101', body: 'Otro' });
    assert.ok(!/STOP/.test(sent[1].body), 'el aviso de STOP solo va en el primero');
    // la respuesta llega firmada
    const hook = `${T.base}/sms/twilio/ee`, params = { From: '+19725550101', Body: 'Ok, ahí estaré', MessageSid: 'SMin1' };
    const sig = crypto.createHmac('sha1', 'tok').update(hook + Object.keys(params).sort().map(k => k + params[k]).join('')).digest('base64');
    const bad = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'mala' }, body: new URLSearchParams(params) });
    assert.equal(bad.status, 403, 'sin firma válida no entra');
    const ok = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig }, body: new URLSearchParams(params) });
    assert.equal(ok.status, 200); assert.match(await ok.text(), /<Response><\/Response>/);
    await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig }, body: new URLSearchParams(params) });
    const threads = (await T.owner.get('/api/sms/threads')).body;
    assert.equal(threads[0].phone, '+19725550101'); assert.equal(threads[0].name, 'Pedro'); assert.equal(threads[0].unread, 1, 'el reintento de Twilio no se duplica');
    const st2 = (await T.owner.get('/api/status')).body.user.pending; assert.ok(st2 >= 1, 'cuenta como pendiente');
    const th = (await T.owner.get('/api/sms/thread?phone=%2B19725550101')).body;
    assert.equal(th.messages.length, 3); assert.equal(th.messages[2].direction, 'in'); assert.equal(th.contact.name, 'Pedro');
    assert.equal((await T.owner.get('/api/sms/threads')).body[0].unread, 0, 'leído');
    // el PM solo ve y textea a la gente de sus obras
    const pm = await T.as('mario');
    const pcs = (await pm.get('/api/sms/contacts')).body.map(c => c.phone);
    assert.ok(pcs.includes('+19725550101') && pcs.includes('+12145550199'));
    assert.ok(!pcs.includes('+19725550102') && !pcs.includes('+12145550177'), 'no ve a la gente de otras obras');
    assert.equal((await pm.post('/api/sms/send', { phone: '9725550102', body: 'x' })).status, 403);
    assert.equal((await pm.get('/api/sms/thread?phone=%2B19725550102')).status, 404);
    assert.equal((await pm.post('/api/sms/send', { phone: '2145550199', body: 'Hola, mañana llegamos a las 8' })).status, 200);
    // subs y trabajadores no usan los textos de la empresa
    const sub = await T.as('pedro');
    assert.equal((await sub.get('/api/sms/threads')).status, 403);
    // si Twilio falla, queda marcado y se avisa
    const T2fail = await T.owner.post('/api/sms/send', { phone: '+52 81 1234 5678', body: 'x' });
    assert.equal(T2fail.status, 200, 'un dueño puede textear otro número');
  } finally {
    delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM;
    await T.close();
  }
});

test('textos: error de Twilio queda guardado', async () => {
  const T = await start({ smsSend: async () => { throw new Error('Attempt to send to unsubscribed recipient'); } });
  process.env.TWILIO_ACCOUNT_SID = 'AC123'; process.env.TWILIO_AUTH_TOKEN = 'tok'; process.env.TWILIO_FROM = '4695550000';
  try {
    const r = await T.owner.post('/api/sms/send', { phone: '9725550101', body: 'Hola' });
    assert.equal(r.status, 502); assert.match(r.body.error, /unsubscribed/);
    const th = (await T.owner.get('/api/sms/thread?phone=%2B19725550101')).body;
    assert.equal(th.messages[0].status, 'error');
  } finally {
    delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_FROM;
    await T.close();
  }
});

test('MCP para Grok: herramientas con la llave del agente y sus mismas reglas', async () => {
  const T = await start();
  try {
    const ag = (await T.owner.post('/api/agents', { name: 'Grok', kind: 'operador' })).body;
    const rw = (await T.owner.post(`/api/agents/${ag.id}/keys`, { can_write: true })).body.key;
    const ro = (await T.owner.post(`/api/agents/${ag.id}/keys`, { can_write: false })).body.key;
    const rpc = async (key, body, viaHeader) => {
      const r = await fetch(`${T.base}/mcp${viaHeader ? '' : '/' + key}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(viaHeader ? { authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(body) });
      return { status: r.status, body: r.status === 202 ? null : await r.json() };
    };
    assert.equal((await rpc('eek_ee_' + 'x'.repeat(32), { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).status, 401, 'llave falsa');
    assert.equal((await fetch(`${T.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401, 'sin llave');
    const init = await rpc(rw, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'grok', version: '1' } } });
    assert.equal(init.status, 200); assert.equal(init.body.result.protocolVersion, '2025-06-18'); assert.ok(init.body.result.capabilities.tools);
    assert.equal((await rpc(rw, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const list = await rpc(rw, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, true);
    const names = list.body.result.tools.map(t => t.name);
    for (const n of ['obras', 'obra', 'crear_tarea', 'registrar_gasto', 'mandar_texto', 'leer']) assert.ok(names.includes(n), n);
    const call = (key, name, args) => rpc(key, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } });
    const jobs = JSON.parse((await call(rw, 'obras', {})).body.result.content[0].text);
    assert.ok(jobs.some(j => j.client_name === 'Smith'));
    const tk = await call(rw, 'crear_tarea', { obra_id: T.job.id, title: 'Inspección final', planned_date: '2026-12-01' });
    assert.equal(tk.body.result.isError, false, tk.body.result.content[0].text);
    const d = (await T.owner.get(`/api/jobs/${T.job.id}`)).body;
    assert.ok(d.tasks.some(x => x.title === 'Inspección final'), 'la tarea quedó en la obra');
    const denied = await call(ro, 'crear_tarea', { obra_id: T.job.id, title: 'No debe' });
    assert.equal(denied.body.result.isError, true, 'llave de solo lectura no escribe');
    const blocked = await call(rw, 'leer', { ruta: '/api/agents' });
    assert.equal(blocked.body.result.isError, true, 'no puede ver ni crear agentes');
    assert.equal((await call(rw, 'leer', { ruta: '/api/../files/x' })).body.result.isError, true);
    assert.equal((await rpc(rw, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'borrar_todo' } })).body.error.code, -32602);
    // lo hecho queda en el historial a nombre del agente
    const hist = (await T.owner.get('/api/audit')).body;
    assert.ok(JSON.stringify(hist).includes('Grok'), 'historial con el agente');
  } finally { await T.close(); }
});

test('escaneo: con una partida clara el gasto queda en esa partida', async () => {
  const T = await start({ scanExtractor: async () => ({ vendor: 'Home Depot', date: '2026-11-20', total_cents: 4599, items: ['Concrete mix 80lb', 'Rebar #4'], category: 'material', job_hint: 'EE-0001', text: 'EE-0001', doc_type: 'receipt' }) });
  try {
    const L1 = (await T.owner.post(`/api/jobs/${T.job.id}/lines`, { code: 'L1', trade: 'Concreto', description: 'Losa de concreto', sold_cents: 500000 })).body;
    await T.owner.post(`/api/jobs/${T.job.id}/lines`, { code: 'L2', trade: 'Electricidad', description: 'Luces y contactos', sold_cents: 200000 });
    const s0 = (await T.owner.post('/api/scans', { file: PNG, job_id: T.job.id })).body;
    const s = (await T.owner.post(`/api/scans/${s0.id}/file`, { job_id: s0.job_id, amount_cents: 4599, date: '2026-11-20', vendor: 'Home Depot', category: 'material', description: 'Concrete mix 80lb, Rebar #4' })).body;
    assert.equal(s.status, 'guardado', JSON.stringify(s));
    const lines = (await T.owner.get(`/api/jobs/${T.job.id}/lines`)).body;
    const got = (lines.lines || lines).find(l => l.id === (L1.id || L1.line && L1.line.id));
    assert.ok(got, JSON.stringify(lines).slice(0, 300));
    assert.ok((got.cost_cents || got.actual_cents || got.spent_cents || 0) >= 4599, 'el ticket cuenta en la partida de concreto: ' + JSON.stringify(got));
  } finally { await T.close(); }
});

test('Google Drive: lista la carpeta, baja un Google Sheet como Excel y lo importa una sola vez', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'app@demo.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  process.env.GOOGLE_DRIVE_FOLDER_ID = 'https://drive.google.com/drive/folders/FOLDER1';
  require('../lib/gdrive')._reset();
  const book = fs.readFileSync(path.join(__dirname, 'fixtures', 'obra-activa.xlsx'));
  const calls = [];
  const driveFetch = async (url, o = {}) => {
    calls.push(url);
    const J = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const jwt = new URLSearchParams(o.body).get('assertion').split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(jwt[0] + '.' + jwt[1]), publicKey, Buffer.from(jwt[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      const claim = JSON.parse(Buffer.from(jwt[1], 'base64').toString());
      return ok && claim.scope.endsWith('drive.readonly') ? J({ access_token: 'tok1', expires_in: 3600 }) : J({ error: 'invalid_grant' }, 400);
    }
    assert.equal(o.headers.authorization, 'Bearer tok1');
    if (url.includes('/files?')) {
      const q = new URL(url).searchParams.get('q');
      assert.match(q, /'FOLDER1' in parents/);
      return J({ files: [{ id: 'SUB', name: '2026 obras', mimeType: 'application/vnd.google-apps.folder' }, { id: 'SHEET1', name: 'Smith patio cover', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-11-01T10:00:00Z' }] });
    }
    if (url.includes('/files/FOLDER1?')) return J({ id: 'FOLDER1', name: 'Obras', parents: [] });
    if (url.includes('/files/SHEET1?')) return J({ id: 'SHEET1', name: 'Smith patio cover', mimeType: 'application/vnd.google-apps.spreadsheet' });
    if (url.includes('/files/SHEET1/export')) return new Response(book, { status: 200 });
    if (url.includes('/files/NOPE?')) return J({ error: { message: 'File not found' } }, 404);
    return J({}, 500);
  };
  const T = await start({ driveFetch });
  try {
    const st = (await T.owner.get('/api/import/drive/status')).body;
    assert.equal(st.enabled, true); assert.equal(st.email, 'app@demo.iam.gserviceaccount.com'); assert.equal(st.folder, 'FOLDER1');
    const list = (await T.owner.get('/api/import/drive/files')).body;
    assert.equal(list.folder.name, 'Obras');
    assert.deepEqual(list.files.map(f => f.kind), ['folder', 'sheet']);
    assert.equal(list.files[1].imported, false);
    const d = (await T.owner.get('/api/import/drive/file/SHEET1')).body;
    assert.equal(d.name, 'Smith patio cover.xlsx'); assert.match(d.file, /^data:application\/vnd.openxmlformats/);
    const pv = (await T.owner.post('/api/import/xlsx/preview', { file: d.file, name: d.name, drive_id: d.id })).body;
    assert.ok(pv.job && pv.lines.length, JSON.stringify(pv).slice(0, 200));
    const cm = await T.owner.post('/api/import/xlsx/commit', { file: d.file, name: d.name, drive_id: d.id });
    assert.equal(cm.status, 200, JSON.stringify(cm.body));
    assert.equal((await T.owner.get('/api/import/drive/files')).body.files[1].imported, true, 'queda marcado como importado');
    assert.equal((await T.owner.post('/api/import/xlsx/commit', { file: d.file, name: d.name, drive_id: d.id })).status, 400, 'no se importa dos veces');
    assert.equal((await T.owner.get('/api/import/drive/file/NOPE')).status, 404);
    assert.equal(calls.filter(u => u.includes('oauth2')).length, 1, 'el permiso de Google se reutiliza');
    // un PM no usa Drive
    const pm = await T.as('mario');
    assert.equal((await pm.get('/api/import/drive/files')).status, 403);
  } finally {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON; delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    await T.close();
  }
});
