'use strict';
// Elevated Exteriors — servidor. Sin paquetes externos: solo Node.js 22.13+.
// Uso: node server.js   (variables opcionales: PORT, DATA_DIR, HOST)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { open, autoBackup } = require('./lib/db');
const A = require('./lib/auth');
const { routes, fileFor, HttpError } = require('./lib/api');
const { translateError } = require('./lib/i18n');
const CO = require('./lib/company');
const AG = require('./lib/agents');

const PUBLIC = path.join(__dirname, 'public');
// Huella de la interfaz (versión + contenido de los archivos), calculada una vez al arrancar.
const APP_STAMP = (() => {
  const h = require('node:crypto').createHash('sha256');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach(e => {
    const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(js|css|html|webmanifest)$/.test(e.name)) h.update(e.name).update(fs.readFileSync(f));
  });
  walk(PUBLIC);
  return require('./package.json').version + '-' + h.digest('hex').slice(0, 8);
})();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.vtt': 'text/vtt; charset=utf-8' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'",
};

function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Archivo demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function createServer({ dataDir, secureCookies = false, scanExtractor, planAI, smsSend, driveFetch } = {}) {
  // Una base de datos por empresa (Elevated Exteriors, JKL Homes…). Nada se mezcla entre empresas.
  let list = CO.loadConfig(dataDir);
  const companies = new Map();
  const mount = c => {
    const cdb = open(CO.dirFor(dataDir, list, c.key));
    CO.stamp(cdb, c, c.key === list[0].key);
    companies.set(c.key, { ...c, db: cdb, table: routes(cdb, { scanExtractor, planAI, smsSend, driveFetch }) });
  };
  list.forEach(mount);
  const first = list[0].key;
  const cookieName = key => key === first ? 'ee_sid' : `ee_sid_${key}`;
  const db = companies.get(first).db;

  const server = http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
      res.end(body);
    };
    // Idioma de quien usa la app: lo envía la interfaz en cada petición.
    let lang = req.headers['x-lang'] === 'en' ? 'en' : 'es';
    const json = (status, obj) => {
      if (obj && obj.error) obj = { ...obj, error: translateError(obj.error, lang) };
      return send(status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    };
    try {
      const url = new URL(req.url, 'http://x');
      const cookies = parseCookies(req.headers.cookie);
      // --- textos que llegan de Twilio (firmados) ---
      const smsHook = /^\/sms\/twilio\/([a-z0-9-]+)$/.exec(url.pathname);
      if (smsHook) {
        const X = companies.get(smsHook[1]);
        if (!X || req.method !== 'POST') return send(404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
        const SMS = require('./lib/sms');
        const params = Object.fromEntries(new URLSearchParams(await readBody(req, 64 * 1024)));
        const c = SMS.config(X.db);
        const proto = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() : (secureCookies ? 'https' : 'http');
        const full = (process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/$/, '') : `${proto}://${req.headers.host}`) + req.url;
        if (!c.token || !SMS.validSignature(c.token, full, params, req.headers['x-twilio-signature'])) return send(403, 'Firma inválida', { 'Content-Type': 'text/plain; charset=utf-8' });
        SMS.inbound(X.db, params);
        return send(200, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { 'Content-Type': 'text/xml; charset=utf-8' });
      }
      if (url.pathname.startsWith('/.well-known/oauth')) return json(404, { error: 'No encontrado' });
      // --- conector MCP para agentes de AI (Grok y otros) ---
      const mcpM = /^\/mcp(?:\/([A-Za-z0-9_-]+))?\/?$/.exec(url.pathname);
      if (mcpM) {
        const hk = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
        return await require('./lib/mcp').handle(req, res, { key: mcpM[1] || (hk && hk[1]) || '', port: req.socket.localPort, readBody });
      }
      // Empresa de esta petición: ?co= (páginas públicas), si no la que eligió en este navegador, si no la primera.
      // Agentes (bots de AI): entran con una llave "Authorization: Bearer eek_<empresa>_…". La llave decide la empresa.
      const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
      const want = bearer ? AG.companyOfKey(bearer[1]) : (url.searchParams.get('co') || req.headers['x-company'] || cookies.ee_co);
      if (bearer && !companies.has(want)) return json(401, { error: 'Llave inválida' });
      const C = companies.get(want) || companies.get(first);
      const db = C.db, table = C.table;
      const token = bearer ? null : cookies[cookieName(C.key)];
      let user = A.sessionUser(db, token);
      if (bearer) {
        const k = AG.userForKey(db, bearer[1]);
        if (!k) return json(401, { error: 'Llave inválida' });
        if (!AG.rateOk(k.keyId)) return json(429, { error: 'Demasiadas peticiones. Espere un minuto.' });
        if (req.method !== 'GET' && !k.canWrite) return json(403, { error: 'Esta llave es solo de lectura' });
        if (/^\/api\/(login|logout|setup|recover|me\/|companies|agents|agent-keys|settings|import)/.test(url.pathname) || (/^\/api\/users/.test(url.pathname) && req.method !== 'GET'))
          return json(403, { error: 'Esto no es parte de sus herramientas' });
        user = { ...k.user, viaKey: true };
      }
      const cookieBase = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;
      if (!req.headers['x-lang'] && user && user.lang === 'en') lang = 'en';
      // En la nube (TRUST_PROXY=1) la conexión llega del proxy: la IP real es la última que agrega el proxy.
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
      const ip = (process.env.TRUST_PROXY === '1' && xff.length ? xff[xff.length - 1] : req.socket.remoteAddress) || '';
      const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) && !req.headers['x-forwarded-for'];

      // --- archivos protegidos (fotos / recibos) ---
      const fm = /^\/files\/([a-f0-9]{32})$/.exec(url.pathname);
      if (fm && req.method === 'GET') {
        const f = fileFor(db, user, fm[1]);
        if (!f || !fs.existsSync(f.path)) return send(404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
        return send(200, fs.readFileSync(f.path), { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=86400' });
      }

      // --- API ---
      if (url.pathname.startsWith('/api/')) {
        const route = table.find(r => r.method === req.method && r.re.test(url.pathname));
        if (!route && !url.pathname.startsWith('/api/companies')) return json(404, { error: 'Ruta no encontrada' });
        if (req.method !== 'GET') {
          // Protección contra peticiones desde otros sitios (CSRF).
          const origin = req.headers.origin;
          let originHost = null; try { originHost = origin ? new URL(origin).host : null; } catch { originHost = 'invalid'; }
          if (origin && originHost !== req.headers.host) return json(403, { error: 'Origen no permitido' });
          if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(415, { error: 'Se requiere JSON' });
        }
        let body = {};
        if (req.method !== 'GET') {
          const raw = await readBody(req);
          try { body = raw ? JSON.parse(raw) : {}; } catch { return json(400, { error: 'JSON inválido' }); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
        }
        const setCookies = [];
        // --- empresas: lista, cambiar, activar una nueva ---
        if (url.pathname === '/api/companies' && req.method === 'GET') {
          return json(200, list.map(c => { const X = companies.get(c.key); const u = A.sessionUser(X.db, cookies[cookieName(c.key)]);
            return { key: c.key, name: c.name, current: c.key === C.key, signed_in: !!u, empty: !X.db.prepare("SELECT 1 FROM users WHERE role='owner' AND active=1").get() }; }));
        }
        if (url.pathname === '/api/companies/switch' && req.method === 'POST') {
          const k = String(body.key || ''); if (!companies.has(k)) return json(404, { error: 'No encontrado' });
          res.writeHead(200, { ...SECURITY_HEADERS, 'Set-Cookie': `ee_co=${k}; Path=/; SameSite=Strict; Max-Age=${400 * 86400}${secureCookies ? '; Secure' : ''}`, 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: true }));
        }
        const am = /^\/api\/companies\/([a-z0-9-]+)\/activate$/.exec(url.pathname);
        if (am && req.method === 'POST') {
          // Un dueño activa otra empresa: se copian los dueños (mismo usuario y contraseña) a la empresa vacía.
          if (!user || user.role !== 'owner') return json(403, { error: 'Esto solo lo pueden hacer los dueños' });
          const X = companies.get(am[1]); if (!X) return json(404, { error: 'No encontrado' });
          if (X.db.prepare("SELECT 1 FROM users WHERE role='owner'").get()) return json(400, { error: 'Esa empresa ya tiene dueños' });
          const ins = X.db.prepare("INSERT INTO users(name,username,pass_hash,role,phone,lang,totp_secret,active) VALUES(?,?,?,'owner',?,?,?,1)");
          for (const o of db.prepare("SELECT * FROM users WHERE role='owner' AND active=1").all()) ins.run(o.name, o.username, o.pass_hash, o.phone || '', o.lang || 'es', o.totp_secret || null);
          const me = X.db.prepare('SELECT id FROM users WHERE username=?').get(user.username);
          const s = A.createSession(X.db, me.id);
          res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8',
            'Set-Cookie': [`${cookieName(X.key)}=${s.token}; ${cookieBase}; Max-Age=${A.SESSION_DAYS * 86400}`, `ee_co=${X.key}; Path=/; SameSite=Strict; Max-Age=${400 * 86400}${secureCookies ? '; Secure' : ''}`] });
          return res.end(JSON.stringify({ ok: true }));
        }
        const ctx = {
          user, token, ip, isLocal, body, query: url.searchParams, ua: req.headers['user-agent'] || '',
          params: (route && route.re.exec(url.pathname).groups) || {}, path: url.pathname,
          company: C.key,
          setCookie: s => { setCookies.push(`${cookieName(C.key)}=${s.token}; ${cookieBase}; Max-Age=${A.SESSION_DAYS * 86400}`); },
          clearCookie: () => { for (const c of list) setCookies.push(`${cookieName(c.key)}=; ${cookieBase}; Max-Age=0`); },
        };
        if (!route) return json(404, { error: 'Ruta no encontrada' });
        let result;
        try { result = await route.handler(ctx); } catch (e) {
          // Entrar: si el usuario no es de esta empresa pero sí de otra (por ejemplo, un sub que solo trabaja con JKL), entra a esa.
          const other = url.pathname === '/api/login' && e instanceof HttpError && e.status === 401 && list.map(c => companies.get(c.key))
            .find(X => X.key !== C.key && X.db.prepare('SELECT 1 FROM users WHERE username=? AND active=1').get(String(body.username || '').toLowerCase().slice(0, 40)));
          if (!other) throw e;
          const lr = other.table.find(r => r.method === 'POST' && r.re.test('/api/login'));
          result = await lr.handler({ ...ctx, setCookie: s => { setCookies.push(`${cookieName(other.key)}=${s.token}; ${cookieBase}; Max-Age=${A.SESSION_DAYS * 86400}`); } });
          setCookies.push(`ee_co=${other.key}; Path=/; SameSite=Strict; Max-Age=${400 * 86400}${secureCookies ? '; Secure' : ''}`);
          ctx.loginCompany = other.key;
        }
        // Misma persona, mismo usuario y contraseña en otra empresa: entra a las dos de una vez.
        if (url.pathname === '/api/login' && result && result.ok) {
          for (const c of list) {
            if (c.key === (ctx.loginCompany || C.key)) continue;
            const X = companies.get(c.key);
            const u2 = X.db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(body.username || '').toLowerCase().slice(0, 40));
            if (!u2 || u2.must_change || !A.checkPassword(String(body.password || ''), u2.pass_hash)) continue;
            if (u2.totp_secret && !(body.code && A.checkTotp(u2.totp_secret, body.code))) continue;
            setCookies.push(`${cookieName(c.key)}=${A.createSession(X.db, u2.id).token}; ${cookieBase}; Max-Age=${A.SESSION_DAYS * 86400}`);
          }
        }
        if (url.pathname === '/api/logout') for (const c of list) { const X = companies.get(c.key); const tk = cookies[cookieName(c.key)]; if (tk) A.endSession(X.db, tk); }
        const extra = setCookies.length ? { 'Set-Cookie': setCookies } : {};
        if (result && result.$buffer) {
          return send(200, result.$buffer, { ...extra, 'Content-Type': result.$type, 'Content-Disposition': `${result.$attach ? 'attachment' : 'inline'}; filename="${result.$name}"`, 'Cache-Control': 'no-store' });
        }
        if (result && result.$file) {
          const data = fs.readFileSync(result.$file);
          if (result.$deleteAfter) fs.unlinkSync(result.$file);
          return send(200, data, { ...extra, 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${result.$name}"`, 'Cache-Control': 'no-store' });
        }
        res.writeHead(200, { ...SECURITY_HEADERS, ...extra, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(result ?? { ok: true }));
      }

      // --- archivos estáticos de la interfaz ---
      if (req.method !== 'GET') return send(405, 'Método no permitido');
      let p; try { p = decodeURIComponent(url.pathname); } catch { return send(404, 'No encontrado'); }
      if (p === '/' || !path.extname(p)) p = '/index.html';
      const file = path.normalize(path.join(PUBLIC, p));
      if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'No encontrado');
      // La página de cotización se puede poner dentro del sitio web de la empresa (iframe).
      const embed = path.basename(file) === 'cotizar.html' ? { 'X-Frame-Options': '', 'Content-Security-Policy': SECURITY_HEADERS['Content-Security-Policy'].replace("frame-ancestors 'none'", 'frame-ancestors *') } : {};
      const hdr = { ...SECURITY_HEADERS, ...embed, 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
      if (!hdr['X-Frame-Options']) delete hdr['X-Frame-Options'];
      // Videos de ayuda: se mandan por pedazos (el iPhone no los reproduce si no) y sin cargarlos enteros en memoria.
      if (path.extname(file) === '.mp4') {
        const size = fs.statSync(file).size, m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        hdr['Accept-Ranges'] = 'bytes'; hdr['Cache-Control'] = 'public, max-age=86400';
        if (!m) { res.writeHead(200, { ...hdr, 'Content-Length': size }); return fs.createReadStream(file).pipe(res); }
        let a = m[1] === '' ? Math.max(0, size - Number(m[2] || 0)) : Number(m[1]), z = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (a > z || a >= size) { res.writeHead(416, { ...hdr, 'Content-Range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { ...hdr, 'Content-Range': `bytes ${a}-${z}/${size}`, 'Content-Length': z - a + 1 });
        return fs.createReadStream(file, { start: a, end: z }).pipe(res);
      }
      res.writeHead(200, hdr);
      // El service worker lleva una huella de los archivos de la app: cualquier cambio publicado actualiza los teléfonos.
      if (p === '/sw.js') return res.end(fs.readFileSync(file, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = 'ee-${APP_STAMP}';`));
      return res.end(fs.readFileSync(file));
    } catch (e) {
      if (e instanceof HttpError) return json(e.status, { ...(e.extra || {}), error: e.message });
      console.error('[error]', e);
      return json(500, { error: 'Error interno. Revise la ventana del servidor.' });
    }
  });

  server.db = db;
  server.companies = companies;
  server.dbs = () => [...companies.values()].map(c => c.db);
  return server;
}

if (require.main === module) {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error(`Se necesita Node.js 22.13 o más nuevo (tiene ${process.versions.node}). Instale la versión LTS de nodejs.org`);
    process.exit(1);
  }
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'datos'));
  const port = Number(process.env.PORT || 8090);
  const host = process.env.HOST || '127.0.0.1';
  const server = createServer({ dataDir, secureCookies: process.env.SECURE_COOKIES === '1' });
  const runBackup = () => { for (const d of server.dbs()) try { autoBackup(d); } catch (e) { console.error('[respaldo]', e.message); } };
  runBackup(); setInterval(runBackup, 6 * 3600 * 1000).unref();
  // Avisos automáticos (resumen de PMs a las 7 am, recordatorio de nota a las 5 pm).
  const pmTick = () => server.dbs().forEach(d => require('./lib/pmreport').tick(d));
  setTimeout(pmTick, 60 * 1000).unref(); setInterval(pmTick, 30 * 60 * 1000).unref();
  const salesTick = () => server.dbs().forEach(d => { require('./lib/sales').tick(d); try { require('./lib/billing').check(d); } catch (e) { console.error('[cobros]', e.message); } });
  setInterval(salesTick, 5 * 60 * 1000).unref();
  server.listen(port, host, () => {
    console.log('');
    console.log('  Elevated Exteriors — app interna');
    console.log(`  Abierta en: http://localhost:${port}`);
    console.log(`  Datos en:   ${dataDir}`);
    console.log('  Para cerrar: cierre esta ventana o presione Ctrl+C');
    console.log('');
  });
  const stop = () => { server.close(); for (const d of server.dbs()) try { d.close(); } catch { /* */ } process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

module.exports = { createServer };
