'use strict';
// Recuperar acceso: la persona lo pide desde la pantalla de entrada, los dueños reciben el aviso
// y con un toque le dan una contraseña temporal (24 horas) que se manda por WhatsApp.
// Al entrar con la temporal, la app obliga a poner una contraseña propia.
const crypto = require('node:crypto');
const A = require('./auth');
const { notify, owners } = require('./push');
const { audit } = require('./guard');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const digits = s => String(s || '').replace(/\D/g, '').slice(-10);
// Sin letras que se confunden (0/O, 1/l/I).
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
function tempPassword() {
  const b = crypto.randomBytes(12);
  let s = ''; for (let i = 0; i < 12; i++) s += ALPHA[b[i] % ALPHA.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
}
const hits = new Map();   // límite de pedidos por IP (en memoria)
function limited(ip) {
  const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 3600e3);
  h.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > 5;
}

// Rutas permitidas mientras la persona tiene que cambiar su contraseña temporal.
const WHILE_TEMP = new Set(['GET /api/status', 'POST /api/logout', 'POST /api/me/password', 'POST /api/me/lang', 'GET /api/catalog']);
function enter(db, key, ctx, fail) {
  const u = ctx.user;
  if (u && u.must_change && !WHILE_TEMP.has(key)) fail(403, 'Primero cambie su contraseña temporal');
  return ctx;
}

module.exports = function recoverRoutes(db, add, h) {
  const { requireRole, fail, str, intId } = h;
  const ownerOnly = u => { requireRole(u, 'owner'); if (u.isPm) fail(403, 'Esto solo lo pueden hacer los dueños'); };
  const userOut = u => u && { id: u.id, name: u.name, username: u.username, role: u.role, phone: u.phone, lang: u.lang, active: !!u.active };

  // Público: no dice si el usuario existe. Siempre responde lo mismo.
  add('POST', '/api/recover', ({ body, ip }) => {
    const ident = str(body.ident, 120).trim();
    if (ident.length < 2) fail(400, 'Escriba su nombre, usuario o teléfono');
    if (limited(ip || '?')) return { ok: true };
    const n = norm(ident), d = digits(ident);
    const all = db.prepare('SELECT * FROM users WHERE active=1').all();
    let match = all.filter(u => u.username === n.replace(/\s/g, '') || norm(u.name) === n || (d.length >= 7 && digits(u.phone) === d));
    if (!match.length && n.length >= 3) match = all.filter(u => norm(u.name).split(' ').includes(n) || norm(u.name).startsWith(n));
    const uid = match.length === 1 ? match[0].id : null;
    if (uid && db.prepare("SELECT 1 FROM access_requests WHERE user_id=? AND status='pendiente' AND created_at>=datetime('now','-1 hour')").get(uid)) return { ok: true };
    db.prepare('INSERT INTO access_requests(ident,user_id,ip) VALUES(?,?,?)').run(ident, uid, String(ip || '').slice(0, 60));
    notify(db, owners(db), 'access_req', { x: uid ? match[0].name : ident }, '#/');
    return { ok: true };
  });

  // Público: alguien nuevo que nunca ha tenido usuario pide que le den acceso.
  add('POST', '/api/access-new', ({ body, ip }) => {
    const name = str(body.name, 80).trim();
    if (name.length < 2) fail(400, 'Escriba su nombre');
    const phone = str(body.phone, 40).trim();
    if (digits(phone).length < 7) fail(400, 'Escriba su teléfono');
    const kind = ['cliente', 'trabajador', 'oficina'].includes(body.kind) ? body.kind : 'otro';
    if (limited(ip || '?')) return { ok: true };
    // Si el teléfono ya es de alguien con usuario, en realidad es recuperar acceso.
    const known = db.prepare('SELECT * FROM users WHERE active=1').all().filter(u => digits(u.phone).length >= 7 && digits(u.phone).slice(-10) === digits(phone).slice(-10));
    const uid = known.length === 1 ? known[0].id : null;
    if (db.prepare("SELECT 1 FROM access_requests WHERE phone=? AND status='pendiente' AND created_at>=datetime('now','-1 hour')").get(phone)) return { ok: true };
    db.prepare('INSERT INTO access_requests(ident,user_id,ip,kind,phone,note) VALUES(?,?,?,?,?,?)').run(name, uid, String(ip || '').slice(0, 60), uid ? '' : kind, phone, str(body.note, 300));
    notify(db, owners(db), uid ? 'access_req' : 'access_new', { x: uid ? known[0].name : name }, '#/');
    return { ok: true };
  });

  add('GET', '/api/access-requests', ({ user }) => {
    ownerOnly(user);
    return db.prepare("SELECT * FROM access_requests WHERE status='pendiente' ORDER BY id DESC LIMIT 30").all()
      .map(r => ({ id: r.id, ident: r.ident, created_at: r.created_at, kind: r.kind || '', phone: r.phone || '', note: r.note || '', user: userOut(r.user_id ? db.prepare('SELECT * FROM users WHERE id=?').get(r.user_id) : null) }));
  });

  function giveTemp(actor, targetId, requestId) {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(intId(targetId));
    if (!u) fail(404, 'No encontrado');
    if (!u.active) fail(400, 'Esa persona está sin acceso: actívela primero en Equipo y accesos');
    const temp = tempPassword();
    db.prepare("UPDATE users SET pass_hash=?, must_change=1, temp_expires=datetime('now','+1 day') WHERE id=?").run(A.hashPassword(temp), u.id);
    A.endAllSessions(db, u.id);
    if (requestId) db.prepare("UPDATE access_requests SET status='resuelto', resolved_by=?, resolved_at=datetime('now'), user_id=? WHERE id=?").run(actor.id, u.id, requestId);
    db.prepare("UPDATE access_requests SET status='resuelto', resolved_by=?, resolved_at=datetime('now') WHERE user_id=? AND status='pendiente'").run(actor.id, u.id);
    audit(db, { user: actor, action: 'editar', entity: 'usuario', entity_id: u.id, summary: `Contraseña temporal para ${u.name} (${u.username})` });
    if (u.id !== actor.id) notify(db, owners(db).filter(id => id !== actor.id), 'access_given', { x: u.name, who: actor.name }, '#/equipo');
    return { ok: true, temp, expires_hours: 24, user: userOut(u) };
  }

  add('POST', '/api/access-requests/:id/temp', ({ user, params, body }) => {
    ownerOnly(user);
    const r = db.prepare('SELECT * FROM access_requests WHERE id=?').get(intId(params.id));
    if (!r) fail(404, 'No encontrado');
    const target = body.user_id || r.user_id;
    if (!target) fail(400, 'Elija a qué persona le da el acceso');
    return giveTemp(user, target, r.id);
  });
  add('POST', '/api/access-requests/:id/dismiss', ({ user, params }) => {
    ownerOnly(user);
    db.prepare("UPDATE access_requests SET status='descartado', resolved_by=?, resolved_at=datetime('now') WHERE id=?").run(user.id, intId(params.id));
    return { ok: true };
  });
  add('POST', '/api/users/:id/temp-password', ({ user, params }) => { ownerOnly(user); return giveTemp(user, params.id, null); });
};

// Al entrar: la contraseña temporal vence a las 24 horas.
module.exports.checkLogin = (db, u, fail) => {
  if (u.must_change && u.temp_expires && db.prepare("SELECT ? < datetime('now') v").get(u.temp_expires).v) fail(401, 'Su contraseña temporal ya venció. Pida una nueva desde “¿Olvidó su usuario o contraseña?”');
};
module.exports.enter = enter;
module.exports.tempPassword = tempPassword;
