'use strict';
// Contraseñas, sesiones y código de 6 dígitos (app autenticadora) opcional.
const crypto = require('node:crypto');

const SESSION_DAYS = 30;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function checkPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

const DUMMY = hashPassword('usuario-inexistente-' + crypto.randomBytes(8).toString('hex'));
function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 10 && pw.length <= 200;
}

const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400000;
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(token), userId, expires);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  return { token, expires };
}

function sessionUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(sha(token), Date.now());
  return row || null;
}

function endSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

function endAllSessions(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

// --- Código de 6 dígitos (TOTP, compatible con Google Authenticator / Authy) ---
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
function newTotpSecret() { return base32(crypto.randomBytes(20)); }
function checkTotp(secret, code, now = Date.now()) {
  if (!secret || !/^\d{6}$/.test(String(code || ''))) return false;
  const c = Math.floor(now / 30000);
  for (const d of [-1, 0, 1]) {
    const a = Buffer.from(totpAt(secret, c + d)), b = Buffer.from(String(code));
    if (crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

// --- Freno de intentos fallidos (en memoria) ---
const fails = new Map();
function tooMany(key) {
  const f = fails.get(key);
  return !!(f && f.count >= 5 && Date.now() - f.last < 15 * 60000);
}
function noteFail(key) {
  if (fails.size > 10000) { const now = Date.now(); for (const [k, v] of fails) if (now - v.last > 15 * 60000) fails.delete(k); if (fails.size > 10000) fails.clear(); }
  const f = fails.get(key) || { count: 0, last: 0 };
  if (Date.now() - f.last > 15 * 60000) f.count = 0;
  f.count++; f.last = Date.now(); fails.set(key, f);
}
function clearFails(key) { fails.delete(key); }

module.exports = {
  hashPassword, checkPassword, validPassword, createSession, sessionUser, endSession,
  endAllSessions, newTotpSecret, DUMMY, checkTotp, totpAt, tooMany, noteFail, clearFails, SESSION_DAYS,
};
