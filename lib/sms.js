'use strict';
// Mensajes de texto (SMS) con subs, trabajadores y clientes, desde el número de la empresa (Twilio).
//  - Se activa con las variables TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM (número +1…).
//    Una segunda empresa usa su propio número: TWILIO_FROM_<CLAVE> (por ejemplo TWILIO_FROM_JKL).
//  - Las respuestas llegan a /sms/twilio/<empresa> (Twilio las firma; sin firma válida se rechazan).
//  - Dueños ven todas las conversaciones; un PM solo las de la gente de sus obras.
//  - Lo que se manda lo escribe una persona: la app nunca pone dinero ni costos en un texto.
const crypto = require('node:crypto');
const { notify, owners } = require('./push');

// Teléfono en formato internacional (+1XXXXXXXXXX). Vacío si no parece un teléfono.
function e164(p) {
  const raw = String(p || '').trim();
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) d = '1' + d;
  if (d.length < 11 || d.length > 15) return '';
  return '+' + d;
}

function config(db) {
  const co = require('./company').info(db);
  const sid = process.env.TWILIO_ACCOUNT_SID || '', token = process.env.TWILIO_AUTH_TOKEN || '';
  const from = e164(process.env['TWILIO_FROM_' + String(co.key).toUpperCase().replace(/-/g, '_')] || (co.primary ? process.env.TWILIO_FROM : ''));
  return { sid, token, from, enabled: !!(sid && token && from), co };
}

async function twilioSend({ sid, token, from, to, body }) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST', signal: ctrl.signal,
      headers: { authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
    return { sid: j.sid || '', status: j.status || 'queued' };
  } finally { clearTimeout(timer); }
}

// Firma de Twilio: HMAC-SHA1(token, URL + cada parámetro ordenado nombre+valor), en base64.
function validSignature(token, url, params, signature) {
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(data).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ¿Quién es este número? Primero una persona con cuenta; si no, el cliente de una obra.
function whoIs(db, phone) {
  const users = db.prepare("SELECT id, name, role, phone, lang, active FROM users WHERE phone<>'' AND is_agent=0").all().filter(u => e164(u.phone) === phone);
  const u = users.find(x => x.active !== 0) || users[0];
  const jobs = db.prepare("SELECT id, client_name, client_phone, client_user_id, pm_id, status FROM jobs WHERE client_phone<>'' ORDER BY CASE status WHEN 'activo' THEN 0 WHEN 'cotizado' THEN 1 WHEN 'prospecto' THEN 2 ELSE 3 END, id DESC").all().filter(j => e164(j.client_phone) === phone);
  let job = jobs[0] || null;
  if (u && !job) {
    job = db.prepare("SELECT id, client_name, pm_id FROM jobs WHERE client_user_id=? ORDER BY CASE status WHEN 'activo' THEN 0 ELSE 1 END, id DESC").get(u.id)
      || db.prepare(`SELECT j.id, j.client_name, j.pm_id FROM jobs j WHERE j.status='activo' AND (j.id IN (SELECT job_id FROM subs WHERE user_id=?) OR j.id IN (SELECT job_id FROM tasks WHERE assignee_id=?)) ORDER BY j.id DESC`).get(u.id, u.id) || null;
  }
  return { user: u || null, job };
}

const ROLE = { owner: 'Dueño', pm: 'Project manager', sales: 'Ventas', worker: 'Sub / trabajador', client: 'Cliente' };

module.exports = function smsRoutes(db, add, h, opts = {}) {
  const { requireRole, fail, str, intId, canSeeJob } = h;
  const sender = opts.send || twilioSend;
  const boss = u => { requireRole(u, 'owner'); };

  // Contactos que esta persona puede textear (por teléfono).
  function contacts(user) {
    const map = new Map();
    const put = (phone, c) => { const p = e164(phone); if (!p || map.has(p)) return; map.set(p, { phone: p, ...c }); };
    const pm = user.isPm;
    const visibleJobs = db.prepare("SELECT id, client_name, client_phone, client_user_id, status FROM jobs WHERE status NOT IN ('cancelado') ORDER BY CASE status WHEN 'activo' THEN 0 WHEN 'cotizado' THEN 1 WHEN 'prospecto' THEN 2 ELSE 3 END, id DESC")
      .all().filter(j => canSeeJob(db, user, j.id));
    const jobIds = new Set(visibleJobs.map(j => j.id));
    const people = db.prepare("SELECT id, name, role, phone, lang, active FROM users WHERE phone<>'' AND is_agent=0 AND active=1 AND id<>?").all(user.pmId || user.id);
    for (const u of people) {
      if (pm) {
        const onJob = db.prepare('SELECT job_id FROM subs WHERE user_id=? UNION SELECT job_id FROM tasks WHERE assignee_id=? UNION SELECT id FROM jobs WHERE client_user_id=?').all(u.id, u.id, u.id).some(r => jobIds.has(r.job_id ?? r.id));
        if (!onJob && u.role !== 'owner') continue;
      }
      put(u.phone, { name: u.name, role: u.role, role_label: ROLE[u.role] || u.role, user_id: u.id, lang: u.lang || 'es' });
    }
    for (const j of visibleJobs) if (j.client_phone) put(j.client_phone, { name: j.client_name, role: 'client', role_label: ROLE.client, job_id: j.id, user_id: j.client_user_id || null });
    return [...map.values()];
  }
  const canText = (user, phone) => (user.role === 'owner' && !user.isPm && !user.is_agent) || contacts(user).some(c => c.phone === phone);

  add('GET', '/api/sms/status', ({ user }) => {
    boss(user);
    const c = config(db);
    return { enabled: c.enabled, from: c.from, unread: db.prepare("SELECT COUNT(*) n FROM sms WHERE direction='in' AND read_at=''").get().n };
  });

  add('GET', '/api/sms/contacts', ({ user }) => { boss(user); return contacts(user); });

  // Conversaciones: una por número, la más reciente primero.
  add('GET', '/api/sms/threads', ({ user }) => {
    boss(user);
    const allowed = user.role === 'owner' && !user.isPm && !user.is_agent ? null : new Set(contacts(user).map(c => c.phone));
    const names = new Map(contacts(user).map(c => [c.phone, c]));
    const rows = db.prepare(`SELECT s.phone, MAX(s.id) last_id, SUM(CASE WHEN s.direction='in' AND s.read_at='' THEN 1 ELSE 0 END) unread
      FROM sms s GROUP BY s.phone ORDER BY last_id DESC LIMIT 200`).all();
    return rows.filter(r => !allowed || allowed.has(r.phone)).map(r => {
      const last = db.prepare('SELECT body, direction, created_at, status, error FROM sms WHERE id=?').get(r.last_id);
      const who = names.get(r.phone) || (() => { const w = whoIs(db, r.phone); return w.user ? { name: w.user.name, role: w.user.role, role_label: ROLE[w.user.role] } : w.job ? { name: w.job.client_name, role: 'client', role_label: ROLE.client } : null; })();
      return { phone: r.phone, unread: r.unread, name: who ? who.name : '', role_label: who ? who.role_label : '', last };
    });
  });

  add('GET', '/api/sms/thread', ({ user, query }) => {
    boss(user);
    const phone = e164(query.get('phone'));
    if (!phone) fail(400, 'Teléfono inválido');
    if (!canText(user, phone)) fail(404, 'Conversación no encontrada');
    const msgs = db.prepare(`SELECT s.id, s.direction, s.body, s.status, s.error, s.created_at, s.job_id, u.name by_name FROM sms s LEFT JOIN users u ON u.id=s.created_by
      WHERE s.phone=? ORDER BY s.id DESC LIMIT 200`).all(phone).reverse();
    if (!user.is_agent) db.prepare("UPDATE sms SET read_at=datetime('now') WHERE phone=? AND direction='in' AND read_at=''").run(phone);
    const c = contacts(user).find(x => x.phone === phone);
    const w = c ? null : whoIs(db, phone);
    return { phone, contact: c || (w && w.user ? { name: w.user.name, role_label: ROLE[w.user.role] } : w && w.job ? { name: w.job.client_name, role_label: ROLE.client, job_id: w.job.id } : { name: '', role_label: '' }), messages: msgs };
  });

  add('POST', '/api/sms/send', async ({ user, body }) => {
    boss(user);
    const c = config(db);
    if (!c.enabled) fail(400, 'Los mensajes de texto no están configurados todavía (falta la cuenta de Twilio)');
    let phone = e164(body.phone);
    if (!phone && body.user_id) { const u = db.prepare('SELECT phone FROM users WHERE id=?').get(intId(body.user_id)); phone = e164(u && u.phone); }
    if (!phone) fail(400, 'Esta persona no tiene un teléfono válido registrado');
    if (!canText(user, phone)) fail(403, 'No puede mandar textos a este número');
    const text = String(body.body || '').trim().slice(0, 1200);
    if (!text) fail(400, 'Escriba el mensaje');
    const jobId = body.job_id ? intId(body.job_id) : (whoIs(db, phone).job || {}).id || null;
    if (jobId && !canSeeJob(db, user, jobId)) fail(404, 'Obra no encontrada');
    // Para cumplir las reglas de las compañías de teléfono: el texto dice quién lo manda, y el primero explica cómo dejar de recibirlos.
    const who = whoIs(db, phone), en = who.user && who.user.lang === 'en';
    let out = text.toLowerCase().startsWith(c.co.name.toLowerCase()) ? text : `${c.co.name}: ${text}`;
    const first = !db.prepare("SELECT 1 FROM sms WHERE phone=? AND direction='out' AND status<>'error' LIMIT 1").get(phone);
    if (first) out += en ? '\nReply STOP to opt out.' : '\nResponda STOP para no recibir más textos.';
    const id = Number(db.prepare("INSERT INTO sms(phone,direction,body,user_id,job_id,status,created_by) VALUES(?,?,?,?,?,'enviando',?)")
      .run(phone, 'out', out, who.user ? who.user.id : null, jobId, user.pmId || user.id).lastInsertRowid);
    try {
      const r = await sender({ sid: c.sid, token: c.token, from: c.from, to: phone, body: out });
      db.prepare('UPDATE sms SET status=?, sid=? WHERE id=?').run(r.status || 'queued', r.sid || '', id);
    } catch (e) {
      const msg = String(e.message || e).slice(0, 300);
      db.prepare("UPDATE sms SET status='error', error=? WHERE id=?").run(msg, id);
      fail(502, 'No se pudo mandar el texto: ' + msg);
    }
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.pmId || user.id, 'crear', 'texto', id, `Texto a ${who.user ? who.user.name : phone}`);
    return db.prepare('SELECT id, direction, body, status, error, created_at FROM sms WHERE id=?').get(id);
  });
};

// Texto que llega (Twilio → /sms/twilio/<empresa>). Devuelve el XML vacío que Twilio espera.
function inbound(db, params) {
  const phone = e164(params.From);
  const text = String(params.Body || '').slice(0, 1600);
  if (!phone) return;
  const sid = String(params.MessageSid || '').slice(0, 64);
  if (sid && db.prepare('SELECT 1 FROM sms WHERE sid=?').get(sid)) return; // Twilio a veces reintenta
  const w = whoIs(db, phone);
  db.prepare("INSERT INTO sms(phone,direction,body,user_id,job_id,status,sid) VALUES(?,?,?,?,?,'recibido',?)").run(phone, 'in', text, w.user ? w.user.id : null, w.job ? w.job.id : null, sid);
  const to = [...owners(db)];
  if (w.job && w.job.pm_id) to.push(w.job.pm_id);
  notify(db, to, 'sms_in', { who: w.user ? w.user.name : w.job ? w.job.client_name : phone, x: text.slice(0, 90) }, '#/textos/' + encodeURIComponent(phone));
}

module.exports.e164 = e164;
module.exports.config = config;
module.exports.validSignature = validSignature;
module.exports.inbound = inbound;
module.exports.twilioSend = twilioSend;
