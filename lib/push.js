'use strict';
// Notificaciones push (Web Push con VAPID) sin paquetes externos.
// Se manda el aviso SIN contenido (no hace falta cifrar nada); el teléfono despierta a la app,
// y la app pide a este servidor el último aviso del usuario (con su sesión) y lo muestra.
// Funciona en Android (Chrome/Samsung) y en iPhone con la app instalada en la pantalla de inicio (iOS 16.4+).
const crypto = require('node:crypto');

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Textos de los avisos, en el idioma de quien los recibe.
const TXT = {
  issue_new: { es: ['Nuevo caso: {x}', '{who} · {job}'], en: ['New case: {x}', '{who} · {job}'] },
  issue_msg: { es: ['Respuesta en: {x}', '{who} · {job}'], en: ['Reply on: {x}', '{who} · {job}'] },
  doc_new: { es: ['{who} mandó {x}', '{job} · revíselo en la app'], en: ['{who} sent {x}', '{job} · review it in the app'] },
  doc_unlock: { es: ['{who} pide permiso para corregir {x}', '{job}'], en: ['{who} asks permission to fix {x}', '{job}'] },
  doc_decided: { es: ['Su {x} fue {r}', '{job}'], en: ['Your {x} was {r}', '{job}'] },
  notice_sub: { es: ['Cambio de fecha: {x}', '{job} · responda en la app'], en: ['Date change: {x}', '{job} · answer in the app'] },
  notice_owner: { es: ['{who} respondió sobre {x}', '{job}'], en: ['{who} answered about {x}', '{job}'] },
  scan_todo: { es: ['Ticket por asignar', '{who} escaneó un ticket que necesita obra'], en: ['Receipt to assign', '{who} scanned a receipt that needs a job'] },
  lead: { es: ['Nuevo prospecto de la web', '{who} · {x}'], en: ['New website lead', '{who} · {x}'] },
  signed: { es: ['{who} firmó {x}', '{job}'], en: ['{who} signed {x}', '{job}'] },
  daily: { es: ['Reporte del día de su proyecto', '{job}'], en: ['Daily report for your project', '{job}'] },
  budget: { es: ['Presupuesto: {x}', '{job}'], en: ['Budget: {x}', '{job}'] },
  change_req: { es: ['Cambio por autorizar', '{who}: {x}'], en: ['Change to approve', '{who}: {x}'] },
  change_decided: { es: ['Su cambio: {r}', '{x}'], en: ['Your change: {r}', '{x}'] },
  access_req: { es: ['Pidieron recuperar acceso', '{x} olvidó su usuario o contraseña. Dele una contraseña temporal desde Inicio'], en: ['Access recovery requested', '{x} forgot their username or password. Give a temporary password from Home'] },
  access_given: { es: ['Contraseña temporal entregada', '{who} le dio acceso temporal a {x}'], en: ['Temporary password given', '{who} gave temporary access to {x}'] },
  settings_changed: { es: ['Cambió el reparto o la alerta de margen', 'Lo cambió {who}. Véalo en Reportes'], en: ['Profit split or margin alert changed', 'Changed by {who}. See Reports'] },
  lead_assigned: { es: ['Cliente nuevo para usted', '{x}. Véalo en Ventas'], en: ['New lead for you', '{x}. See it in Sales'] },
  appt_new: { es: ['Nueva cita: {x}', '{d}'], en: ['New appointment: {x}', '{d}'] },
  appt_soon: { es: ['Cita a las {d}: {x}', '{job}'], en: ['Appointment at {d}: {x}', '{job}'] },
  sales_day: { es: ['Su día de ventas', 'Citas hoy: {x} · Seguimientos: {n}'], en: ['Your sales day', 'Appointments today: {x} · Follow-ups: {n}'] },
  sale_won: { es: ['¡Trabajo ganado! {x}', 'Lo cerró {who}. Falta poner fechas y contrato'], en: ['Job won! {x}', 'Closed by {who}. Set dates and contract'] },
  pm_daily: { es: ['Reporte de project managers', 'Ya puede ver qué hizo cada PM ayer'], en: ['Project manager report', 'See what each PM did yesterday'] },
  pm_note: { es: ['Su reporte del día', 'Escriba en 1 minuto qué hizo hoy, problemas y qué sigue'], en: ['Your daily report', 'Take 1 minute to write what you did, problems and next steps'] },
  rating: { es: ['Calificación del cliente: {x}', '{who}'], en: ['Client rating: {x}', '{who}'] },
  next_task: { es: ['Su próxima tarea: {x}', '{job} · {d}. Confírmela en la app'], en: ['Your next task: {x}', '{job} · {d}. Confirm it in the app'] },
  task_confirmed: { es: ['{who} confirmó: {x}', '{job} · {d}'], en: ['{who} confirmed: {x}', '{job} · {d}'] },
  test: { es: ['Elevated Exteriors', 'Las notificaciones funcionan ✔'], en: ['Elevated Exteriors', 'Notifications are working ✔'] },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

function keys(db) {
  const get = k => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
  let pub = get('vapid_pub'), priv = get('vapid_priv');
  if (!pub || !priv) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    pub = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
    priv = privateKey.export({ format: 'pem', type: 'pkcs8' });
    const put = db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    put.run('vapid_pub', pub); put.run('vapid_priv', priv);
  }
  return { pub, priv };
}

function vapidHeader(db, endpoint) {
  const { pub, priv } = keys(db);
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.PUSH_CONTACT || 'mailto:office@elevatedexteriors.com' }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: priv, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

async function sendOne(db, sub) {
  try {
    const r = await fetch(sub.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'high', Authorization: vapidHeader(db, sub.endpoint), 'Content-Length': '0' } });
    if (r.status === 404 || r.status === 410) db.prepare('DELETE FROM push_subs WHERE id=?').run(sub.id);
    return r.status;
  } catch { return 0; }
}

// Guarda el aviso y despierta los teléfonos del usuario. Nunca rompe la operación principal.
const pending = new Set();
function notify(db, userIds, kind, vars = {}, url = '#/') {
  try {
    const ids = [...new Set((Array.isArray(userIds) ? userIds : [userIds]).filter(Boolean))];
    for (const uid of ids) {
      const u = db.prepare('SELECT id, lang, active FROM users WHERE id=?').get(uid);
      if (!u || !u.active) continue;
      const [title, body] = (TXT[kind] || TXT.test)[u.lang === 'en' ? 'en' : 'es'];
      db.prepare('INSERT INTO notifications(user_id,title,body,url) VALUES(?,?,?,?)').run(uid, fill(title, vars).slice(0, 120), fill(body, vars).slice(0, 200), url);
      db.prepare("DELETE FROM notifications WHERE user_id=? AND id NOT IN (SELECT id FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50)").run(uid, uid);
      for (const s of db.prepare('SELECT * FROM push_subs WHERE user_id=?').all(uid)) {
        const p = sendOne(db, s); pending.add(p); p.finally(() => pending.delete(p));
      }
    }
  } catch (e) { console.error('[push]', e.message); }
}
const owners = db => db.prepare("SELECT id FROM users WHERE role='owner' AND active=1").all().map(r => r.id);
const flush = () => Promise.all([...pending]);

function pushRoutes(db, add, { requireRole, fail, str }) {
  add('GET', '/api/push/key', ({ user }) => { requireRole(user, 'owner', 'sales', 'worker', 'client'); return { key: keys(db).pub }; });
  add('POST', '/api/push/subscribe', ({ user, body }) => {
    requireRole(user, 'owner', 'sales', 'worker', 'client');
    const ep = str(body.endpoint, 1000);
    let u; try { u = new URL(ep); } catch { fail(400, 'Suscripción inválida'); }
    const local = ['127.0.0.1', 'localhost'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(local && process.env.NODE_ENV !== 'production')) fail(400, 'Suscripción inválida');
    db.prepare('INSERT INTO push_subs(user_id,endpoint) VALUES(?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id').run(user.id, ep);
    return { ok: true };
  });
  add('POST', '/api/push/unsubscribe', ({ user, body }) => {
    requireRole(user, 'owner', 'sales', 'worker', 'client');
    db.prepare('DELETE FROM push_subs WHERE endpoint=? AND user_id=?').run(str(body.endpoint, 1000), user.id);
    return { ok: true };
  });
  add('POST', '/api/push/test', async ({ user }) => {
    requireRole(user, 'owner', 'sales', 'worker', 'client');
    const n = db.prepare('SELECT COUNT(*) n FROM push_subs WHERE user_id=?').get(user.id).n;
    if (!n) fail(400, 'Active primero las notificaciones en este teléfono');
    notify(db, user.id, 'test', {}, '#/cuenta');
    await flush();
    return { ok: true, devices: n };
  });
  // El teléfono pregunta qué mostrar cuando le llega el aviso.
  add('GET', '/api/push/latest', ({ user }) => {
    if (!user) return { title: 'Elevated Exteriors', body: '', url: '#/' };
    const n = db.prepare('SELECT title, body, url FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 1').get(user.id);
    return n || { title: 'Elevated Exteriors', body: '', url: '#/' };
  });
  add('GET', '/api/notifications', ({ user }) => {
    requireRole(user, 'owner', 'sales', 'worker', 'client');
    return db.prepare('SELECT id, title, body, url, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(user.id);
  });
}

module.exports = { notify, owners, flush, keys, vapidHeader, pushRoutes, b64u, fromB64u };
