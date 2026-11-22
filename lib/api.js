'use strict';
// Todas las rutas /api. Cada ruta revisa el rol antes de tocar datos.
//   owner  (dueño)       : todo
//   worker (trabajador/sub): obras donde tiene tareas asignadas; nunca dinero
//   client (cliente)     : solo su obra; avance, fotos, precio y pagos; nunca costos
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const A = require('./auth');
const C = require('./catalog');
const { tx, backup } = require('./db');

class HttpError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra || null; } }
const fail = (status, msg, extra) => { throw new HttpError(status, msg, extra); };

// ---------- validación ----------
const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const need = (v, label, max) => { const s = str(v, max); if (!s) fail(400, `Falta: ${label}`); return s; };
const date = (v, label = 'fecha') => {
  const s = str(v, 10);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(400, `Fecha inválida: ${label}`);
  return s;
};
const needDate = (v, label) => { const s = date(v, label); if (!s) fail(400, `Falta: ${label}`); return s; };
const cents = (v, label, { allowNegative = false } = {}) => {
  const n = Number(v);
  if (!Number.isInteger(n) || Math.abs(n) > 1e11) fail(400, `Monto inválido: ${label}`);
  if (!allowNegative && n < 0) fail(400, `El monto no puede ser negativo: ${label}`);
  return n;
};
const oneOf = (v, list, label) => { if (!list.includes(v)) fail(400, `Valor inválido: ${label}`); return v; };
const today = () => new Date().toISOString().slice(0, 10);
const intId = v => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) fail(404, 'No encontrado'); return n; };

const CAT_KEYS = C.CATEGORIES.map(c => c.key);
const TYPE_KEYS = C.PROJECT_TYPES.map(t => t.key);
const STATUS_KEYS = C.JOB_STATUS.map(s => s.key);

// ---------- permisos ----------
function requireRole(user, ...roles) {
  if (!user) fail(401, 'Inicie sesión');
  if (!roles.includes(user.role)) fail(403, 'No tiene permiso');
}
function canSeeJob(db, user, jobId) {
  // Un project manager (aunque actúe "como dueño") solo ve las obras que tiene asignadas.
  if (user.isPm || user.role === 'pm') {
    if ((db.prepare('SELECT pm_all FROM users WHERE id=?').get(user.pmId || user.id) || {}).pm_all) return !!db.prepare('SELECT 1 FROM jobs WHERE id=?').get(jobId);
    return !!db.prepare('SELECT 1 FROM jobs WHERE id=? AND pm_id=?').get(jobId, user.pmId || user.id);
  }
  if (user.role === 'owner') return true;
  if (user.role === 'client') return !!db.prepare('SELECT 1 FROM jobs WHERE id=? AND client_user_id=?').get(jobId, user.id);
  if (user.role === 'worker') return !!db.prepare(
    `SELECT 1 FROM tasks WHERE job_id=? AND assignee_id=? UNION SELECT 1 FROM subs WHERE job_id=? AND user_id=?`
  ).get(jobId, user.id, jobId, user.id);
  return false;
}
function jobOr404(db, user, jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  // Mismo mensaje si no existe o si no tiene permiso: no revela qué obras existen.
  if (!job || !canSeeJob(db, user, jobId)) fail(404, 'Obra no encontrada');
  return job;
}

// ---------- dinero por obra ----------
function money(db, jobId) {
  const j = db.prepare('SELECT quoted_cents FROM jobs WHERE id=?').get(jobId);
  const q = sql => db.prepare(sql).get(jobId).v || 0;
  const coPrice = q("SELECT SUM(price_cents) v FROM change_orders WHERE job_id=? AND status='aprobado'");
  const coCost = q("SELECT SUM(cost_cents) v FROM change_orders WHERE job_id=? AND status='aprobado'");
  const spent = q('SELECT SUM(amount_cents) v FROM expenses WHERE job_id=?');
  const rework = q("SELECT SUM(amount_cents) v FROM expenses WHERE job_id=? AND category='retrabajo'");
  const paid = q('SELECT SUM(amount_cents) v FROM payments WHERE job_id=?');
  const subsAgreed = q('SELECT SUM(agreed_cents) v FROM subs WHERE job_id=?');
  // Pagado a subs = registro de pagos (parciales o completos, a invoices o al acuerdo).
  const subsPaid = q('SELECT SUM(amount_cents) v FROM sub_payments WHERE job_id=?');
  const unpaidInvoices = q("SELECT SUM(d.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM sub_payments p WHERE p.doc_id=d.id),0)) v FROM sub_docs d WHERE d.job_id=? AND d.type='invoice' AND d.status='aprobado'");
  const contract = j.quoted_cents + coPrice;
  const profit = contract - spent;
  return {
    quoted: j.quoted_cents, changeOrdersPrice: coPrice, changeOrdersCost: coCost, contract,
    spent, rework, profit, marginPct: contract ? Math.round((profit / contract) * 1000) / 10 : null,
    paid, balanceDue: contract - paid, subsAgreed, subsPaid, unpaidInvoices, subsOwed: subsAgreed - subsPaid,
  };
}
function progress(db, jobId) {
  const r = db.prepare("SELECT COUNT(*) total, SUM(status='hecho') done FROM tasks WHERE job_id=?").get(jobId);
  return { total: r.total, done: r.done || 0, pct: r.total ? Math.round(((r.done || 0) / r.total) * 100) : 0 };
}
function warrantyUntil(job) {
  if (!job.completed_date) return '';
  const d = new Date(job.completed_date + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + C.WARRANTY_MONTHS);
  return d.toISOString().slice(0, 10);
}

// ---------- archivos (fotos y recibos) ----------
const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
function looksLike(buf, mime) {
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (mime === 'image/png') return buf.slice(0, 4).toString('hex') === '89504e47';
  if (mime === 'application/pdf') return buf.slice(0, 5).toString() === '%PDF-';
  if (mime === 'image/webp') return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  return false;
}
function saveImage(db, user, { dataUrl, jobId, taskId = null, expenseId = null, docId = null, kind, caption, allowPdf = false }) {
  const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m || (m[1] === 'application/pdf' && !allowPdf)) fail(400, allowPdf ? 'Archivo inválido (use foto o PDF)' : 'Imagen inválida (use JPG, PNG o WEBP)');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) fail(413, 'Imagen demasiado grande');
  if (!looksLike(buf, m[1])) fail(400, 'El archivo no es una imagen válida');
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(db.dataDir, 'files', `${id}.${MIME[m[1]]}`), buf);
  db.prepare('INSERT INTO files(id,job_id,task_id,expense_id,doc_id,kind,mime,caption,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, jobId, taskId, expenseId, docId, kind, m[1], str(caption, 200), user.id);
  return { id };
}
function removeFileRows(db, rows) {
  for (const f of rows) {
    try { fs.unlinkSync(path.join(db.dataDir, 'files', `${f.id}.${MIME[f.mime]}`)); } catch { /* ya no existe */ }
  }
}

// ---------- vistas por rol ----------
function jobForOwner(db, job) {
  const tasks = db.prepare(`SELECT t.*, u.name assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
    WHERE t.job_id=? ORDER BY t.position, t.id`).all(job.id);
  const photos = db.prepare("SELECT id, task_id, caption, created_at FROM files WHERE job_id=? AND kind='photo' AND msg_id IS NULL ORDER BY created_at DESC").all(job.id);
  const expenses = db.prepare(`SELECT e.*, s.name sub_name, u.name created_by_name,
      (SELECT id FROM files f WHERE f.expense_id=e.id LIMIT 1) receipt_id
    FROM expenses e LEFT JOIN subs s ON s.id=e.sub_id LEFT JOIN users u ON u.id=e.created_by
    WHERE e.job_id=? ORDER BY e.date DESC, e.id DESC`).all(job.id);
  const subs = db.prepare(`SELECT s.*, u.name user_name,
      (SELECT COALESCE(SUM(amount_cents),0) FROM sub_payments p WHERE p.sub_id=s.id) paid_cents
    FROM subs s LEFT JOIN users u ON u.id=s.user_id WHERE s.job_id=? ORDER BY s.id`).all(job.id)
    .map(s => ({ ...s, payments: db.prepare('SELECT p.id, p.date, p.amount_cents, p.method, p.reference, p.note, p.doc_id, d.number doc_number FROM sub_payments p LEFT JOIN sub_docs d ON d.id=p.doc_id WHERE p.sub_id=? ORDER BY p.date, p.id').all(s.id) }));
  const changes = db.prepare('SELECT * FROM change_orders WHERE job_id=? ORDER BY date DESC, id DESC').all(job.id);
  const payments = db.prepare('SELECT * FROM payments WHERE job_id=? ORDER BY date DESC, id DESC').all(job.id);
  const client = job.client_user_id ? db.prepare('SELECT id,name,username FROM users WHERE id=?').get(job.client_user_id) : null;
  return { job: { ...job, warranty_until: warrantyUntil(job) }, client, tasks, photos, expenses, subs, changes, payments,
    money: (m0 => ({ ...m0, ...require('./lines').projected(db, job.id, m0) }))(money(db, job.id)), progress: progress(db, job.id),
    lines_count: db.prepare('SELECT COUNT(*) n FROM job_lines WHERE job_id=?').get(job.id).n };
}
function jobForWorker(db, job, user) {
  const tasks = db.prepare(`SELECT t.id, t.position, t.title, t.status, t.planned_date, t.planned_end, t.done_date, t.notes,
      t.assignee_id, u.name assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
    WHERE t.job_id=? ORDER BY t.position, t.id`).all(job.id)
    .map(t => ({ ...t, mine: t.assignee_id === user.id }));
  const photos = db.prepare("SELECT id, task_id, caption, created_at FROM files WHERE job_id=? AND kind='photo' AND msg_id IS NULL ORDER BY created_at DESC").all(job.id);
  const { id, client_name, address, project_type, description, status, start_date, end_date } = job;
  return { job: { id, client_name, address, project_type, description, status, start_date, end_date },
    tasks, photos, progress: progress(db, job.id) };
}
function jobForClient(db, job) {
  const tasks = db.prepare('SELECT id, position, title, status, done_date FROM tasks WHERE job_id=? ORDER BY position, id').all(job.id);
  const photos = db.prepare("SELECT id, task_id, caption, created_at FROM files WHERE job_id=? AND kind='photo' AND msg_id IS NULL ORDER BY created_at DESC").all(job.id);
  const changes = db.prepare("SELECT id, date, description, price_cents, status FROM change_orders WHERE job_id=? AND status<>'rechazado' ORDER BY date").all(job.id);
  const payments = db.prepare('SELECT id, date, amount_cents, method FROM payments WHERE job_id=? ORDER BY date').all(job.id);
  const m = money(db, job.id);
  const { id, client_name, address, project_type, description, status, start_date, end_date, completed_date } = job;
  const updates = db.prepare('SELECT id, created_at, kind, data, note FROM client_updates WHERE job_id=? ORDER BY id DESC LIMIT 30').all(job.id);
  return { job: { id, client_name, address, project_type, description, status, start_date, end_date, completed_date,
    warranty_until: warrantyUntil(job) }, tasks, photos, changes, payments, updates,
    money: { contract: m.contract, paid: m.paid, balanceDue: m.balanceDue }, progress: progress(db, job.id) };
}

const TOOLS = ['ventas'];
const publicUser = u => ({ id: u.id, name: u.name, username: u.username, role: u.role, phone: u.phone, trade: u.trade,
  lang: u.lang, active: !!u.active, mfa: !!u.totp_secret, created_at: u.created_at,
  pm_limit_cents: u.pm_limit_cents, pm_month_cents: u.pm_month_cents, related_pm_id: u.related_pm_id || null,
  tools: String(u.tools || '').split(',').filter(Boolean), must_change: !!u.must_change, is_agent: !!u.is_agent, pm_all: !!u.pm_all });

function jobFields(b, partial) {
  const f = {};
  const has = k => !partial || k in b;
  if (has('client_name')) f.client_name = need(b.client_name, 'nombre del cliente', 120);
  if (has('client_phone')) f.client_phone = str(b.client_phone, 40);
  if (has('client_email')) f.client_email = str(b.client_email, 120);
  if (has('address')) f.address = str(b.address, 250);
  if (has('project_type')) f.project_type = oneOf(b.project_type || 'otro', TYPE_KEYS, 'tipo de proyecto');
  if (has('description')) f.description = str(b.description, 4000);
  if (has('status')) f.status = oneOf(b.status || 'prospecto', STATUS_KEYS, 'estado');
  if (has('quoted_cents')) f.quoted_cents = cents(b.quoted_cents ?? 0, 'precio cotizado');
  for (const k of ['start_date', 'end_date', 'completed_date', 'follow_up_date']) if (has(k)) f[k] = date(b[k], k);
  if (has('lead_source')) f.lead_source = str(b.lead_source, 80);
  if (has('notes')) f.notes = str(b.notes, 4000);
  if ('pm_id' in b) f.pm_id = b.pm_id ? intId(b.pm_id) : null;
  return f;
}

function checkUserRef(db, id, role) {
  if (id == null || id === '') return null;
  const u = db.prepare('SELECT id, role FROM users WHERE id=?').get(Number(id));
  if (!u || (role && u.role !== role)) fail(400, 'Usuario no válido');
  return u.id;
}

function routes(db, opts = {}) {
  const R = [];
  const after = require('./alerts');
  const G = require('./guard').make(db);
  const PM = require('./pm');
  const PR = require('./pmreport');
  const SA = require('./sales');
  const RC = require('./recover');
  // Toda acción que cambia algo pasa por la capa de seguridad (motivo, dos dueños, cierre de periodo, bitácora).
  const add = (method, pattern, handler) => R.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'),
    handler: async ctx0 => {
      const key = `${method} ${pattern}`;
      const ctx = SA.enter(db, key, PM.enter(db, key, RC.enter(db, key, ctx0, fail), fail), fail); // PMs y vendedores: solo sus rutas y sus obras
      if (method === 'GET') return PM.filter(db, key, ctx.user, await handler(ctx));
      const g = G.before(key, ctx, fail);
      if (g && g.pending) return g.pending;
      const res = await handler(ctx);
      G.after(key, ctx, g, res);
      PM.afterCreate(db, key, ctx, res);
      PR.log(db, key, ctx, res);
      after(db, key, ctx, res);
      return res;
    } });
  const dispatch = (method, path, ctx) => { const r = R.find(x => x.method === method && x.re.test(path)); if (!r) fail(404, 'No encontrado'); return r.handler({ ...ctx, params: r.re.exec(path).groups || {} }); };
  const S = require('./schedule')(db, add, { requireRole, fail, str, date, needDate, oneOf, intId, jobOr404, canSeeJob });
  const updateRow = id => db.prepare('SELECT * FROM client_updates WHERE id=?').get(id);
  require('./subdocs')(db, add, { requireRole, fail, str, date, needDate, oneOf, intId, jobOr404, canSeeJob, cents, today, saveImage, removeFileRows });
  require('./printouts')(db, add, { requireRole, fail, intId, jobOr404, canSeeJob });
  require('./issues')(db, add, { requireRole, fail, str, need, oneOf, intId, canSeeJob, saveImage });
  require('./push').pushRoutes(db, add, { requireRole, fail, str });
  require('./accounts')(db, add, { requireRole, fail, intId, jobOr404, today });
  require('./guard').routes(db, add, { requireRole, fail, str, intId, date }, G, dispatch);
  add('GET', '/api/pm-activity', ({ user }) => { requireRole(user, 'owner'); return PM.activity(db); });
  PR.routes(db, add, { requireRole, fail, str, intId, date, jobOr404, money });
  require('./board')(db, add, { requireRole, fail, intId, canSeeJob });
  require('./agents')(db, add, { requireRole, fail, need, intId, publicUser });
  require('./importer')(db, add, { requireRole, fail, str, need, intId, cents, jobOr404, PROJECT_TYPES: C.PROJECT_TYPES });
  require('./lines')(db, add, { requireRole, fail, str, need, intId, cents, jobOr404, money, canSeeJob });
  require('./recover')(db, add, { requireRole, fail, str, intId });
  require('./sales')(db, add, { requireRole, fail, str, need, intId, date, cents, oneOf });
  require('./plan').routes(db, add, { requireRole, fail, str, date, intId, jobOr404, today }, { planAI: opts.planAI });
  require('./materials')(db, add, { requireRole, fail, str, need, intId, jobOr404, canSeeJob });
  const SP = require('./subpay'); SP.migrate(db);
  SP.routes(db, add, { requireRole, fail, str, needDate, cents, oneOf, intId, jobOr404, saveImage });
  require('./forecast').routes(db, add, { requireRole, fail, str, today, money });
  require('./pro')(db, add, { requireRole, fail, str, need, date, needDate, oneOf, intId, cents, today, jobOr404, canSeeJob, saveImage, money, progress, warrantyUntil });
  require('./modules').routes(db, add, { requireRole, fail });
  require('./papers')(db, add, { requireRole, fail, str, intId, cents });
  require('./growth')(db, add, { requireRole, fail, str, intId, need, cents, jobOr404, canSeeJob, sigDir: require('node:path').join(db.dataDir, 'signatures') });
  require('./billing')(db, add, { requireRole, fail, str, intId, need, jobOr404, canSeeJob, sigDir: require('node:path').join(db.dataDir, 'signatures') });
  require('./labor')(db, add, { requireRole, fail, str, intId, oneOf, today, cents });
  require('./gdrive')(db, add, { requireRole, fail }, { fetch: opts.driveFetch });
  require('./sms')(db, add, { requireRole, fail, str, intId, canSeeJob }, { send: opts.smsSend });
  require('./scan')(db, add, { requireRole, fail, str, date, oneOf, intId, cents, canSeeJob, today }, { extract: opts.scanExtractor });

  // ===== sesión =====
  add('GET', '/api/status', ({ user, isLocal }) => {
    const users = db.prepare('SELECT COUNT(*) n FROM users').get().n;
    let pending = 0;
    if (user && user.role === 'worker') pending = db.prepare("SELECT COUNT(*) n FROM notices WHERE to_user_id=? AND status='enviado'").get(user.id).n;
    if (user && user.role === 'pm') {
      // Lo de sus obras: documentos de subs por revisar, avisos respondidos y tickets suyos por asignar.
      pending = db.prepare("SELECT COUNT(*) n FROM sub_docs d JOIN jobs j ON j.id=d.job_id WHERE j.pm_id=? AND d.status='enviado'").get(user.id).n
        + db.prepare("SELECT COUNT(*) n FROM notices n JOIN jobs j ON j.id=n.job_id WHERE j.pm_id=? AND n.status='respondido'").get(user.id).n
        + db.prepare("SELECT COUNT(*) n FROM scans WHERE created_by=? AND status='por_asignar'").get(user.id).n;
    }
    if (user && user.role === 'owner') {
      // Documentos por revisar, sin contar los que este dueño ya aprobó (esperan al otro dueño).
      const mine = r => { try { return JSON.parse(r || '[]').includes(user.id); } catch { return false; } };
      pending = db.prepare("SELECT COUNT(*) n FROM notices WHERE status='respondido'").get().n
        + db.prepare("SELECT status, unlock, unlock_ok, corr_ok, prev FROM sub_docs WHERE status='enviado' OR unlock='pedido'").all()
          .filter(d => !((d.unlock === 'pedido' && mine(d.unlock_ok)) || (d.status === 'enviado' && d.prev && mine(d.corr_ok)))).length
        + db.prepare("SELECT COUNT(*) n FROM scans WHERE status='por_asignar'").get().n;
    }
    if (user) pending += require('./issues').unreadCount(db, user) + SA.pendingFor(db, user);
    if (user && user.role === 'owner') pending += db.prepare('SELECT COUNT(*) n FROM jobs WHERE lead_new=1').get().n
      + db.prepare("SELECT COUNT(*) n FROM change_requests WHERE status='pendiente' AND user_id<>?").get(user.id).n
      + db.prepare("SELECT COUNT(*) n FROM sms WHERE direction='in' AND read_at=''").get().n;
    const extra = user && user.role === 'pm' ? { pm_month_spent_cents: db.prepare("SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE created_by=? AND substr(created_at,1,7)=substr(datetime('now'),1,7)").get(user.id).v } : {};
    return { needsSetup: users === 0 && require('./company').info(db).primary, setupAllowedHere: users === 0 && (isLocal || !!process.env.SETUP_CODE), setupNeedsCode: users === 0 && !isLocal && !!process.env.SETUP_CODE, company: { ...require('./company').info(db), modules: require('./modules').modules(db) }, user: user ? { ...publicUser(user), ...extra, pending } : null };
  });

  add('POST', '/api/setup', ({ body, isLocal, ip, setCookie }) => {
    if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) fail(403, 'La app ya está configurada');
    if (!isLocal) {
      const code = String(process.env.SETUP_CODE || ''), given = String(body.setupCode || '');
      if (!code) fail(403, 'La configuración inicial solo se puede hacer desde la misma computadora');
      const a = require('node:crypto').createHash('sha256').update(code).digest(), b = require('node:crypto').createHash('sha256').update(given).digest();
      if (A.tooMany('setup|' + ip)) fail(429, 'Demasiados intentos. Espere 15 minutos.');
      if (!require('node:crypto').timingSafeEqual(a, b)) { A.noteFail('setup|' + ip); fail(403, 'Código de instalación incorrecto'); }
    }
    if (!A.validPassword(body.password)) fail(400, 'La contraseña debe tener al menos 10 caracteres');
    const username = need(body.username, 'usuario', 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'Usuario: solo letras, números, punto, guion');
    const id = db.prepare("INSERT INTO users(name,username,pass_hash,role) VALUES(?,?,?,'owner')")
      .run(need(body.name, 'nombre', 80), username, A.hashPassword(body.password)).lastInsertRowid;
    const s = A.createSession(db, Number(id)); setCookie(s);
    return { ok: true };
  });

  add('POST', '/api/login', ({ body, ip, setCookie }) => {
    const username = str(body.username, 40).toLowerCase();
    const key = username + '|' + ip;
    if (A.tooMany(key)) fail(429, 'Demasiados intentos. Espere 15 minutos.');
    const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
    const okPw = A.checkPassword(String(body.password || ''), u ? u.pass_hash : A.DUMMY);   // siempre calcula: no revela si el usuario existe
    if (!u || !okPw) { A.noteFail(key); fail(401, 'Usuario o contraseña incorrectos'); }
    RC.checkLogin(db, u, fail);
    if (u.totp_secret) {
      if (!body.code) return { needCode: true };
      if (!A.checkTotp(u.totp_secret, body.code)) { A.noteFail(key); fail(401, 'Código incorrecto'); }
    }
    A.clearFails(key);
    const s = A.createSession(db, u.id); setCookie(s);
    return { ok: true, user: publicUser(u) };
  });

  add('POST', '/api/logout', ({ token, clearCookie }) => { A.endSession(db, token); clearCookie(); return { ok: true }; });

  add('POST', '/api/me/password', ({ user, body }) => {
    requireRole(user, 'owner', 'pm', 'sales', 'worker', 'client');
    if (!A.checkPassword(String(body.current || ''), user.pass_hash)) fail(400, 'La contraseña actual no es correcta');
    if (!A.validPassword(body.password)) fail(400, 'La nueva contraseña debe tener al menos 10 caracteres');
    if (A.checkPassword(String(body.password), user.pass_hash)) fail(400, 'La nueva contraseña debe ser diferente');
    db.prepare('UPDATE users SET pass_hash=?, must_change=0, temp_expires=NULL WHERE id=?').run(A.hashPassword(body.password), user.id);
    return { ok: true };
  });

  add('POST', '/api/me/lang', ({ user, body }) => {
    requireRole(user, 'owner', 'pm', 'sales', 'worker', 'client');
    db.prepare('UPDATE users SET lang=? WHERE id=?').run(oneOf(body.lang, ['es', 'en'], 'idioma'), user.id);
    return { ok: true };
  });

  add('POST', '/api/me/mfa/start', ({ user }) => {
    requireRole(user, 'owner', 'pm', 'sales', 'worker', 'client');
    const secret = A.newTotpSecret();
    db.prepare('UPDATE users SET totp_pending=? WHERE id=?').run(secret, user.id);
    const label = encodeURIComponent(`${require('./company').info(db).name}:${user.username}`);
    return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Elevated%20Exteriors` };
  });
  add('POST', '/api/me/mfa/confirm', ({ user, body }) => {
    requireRole(user, 'owner', 'pm', 'sales', 'worker', 'client');
    if (!user.totp_pending || !A.checkTotp(user.totp_pending, body.code)) fail(400, 'Código incorrecto. Revise la hora del teléfono.');
    db.prepare('UPDATE users SET totp_secret=totp_pending, totp_pending=NULL WHERE id=?').run(user.id);
    return { ok: true };
  });
  add('POST', '/api/me/mfa/disable', ({ user, body }) => {
    requireRole(user, 'owner', 'pm', 'sales', 'worker', 'client');
    if (!A.checkPassword(String(body.password || ''), user.pass_hash)) fail(400, 'Contraseña incorrecta');
    db.prepare('UPDATE users SET totp_secret=NULL, totp_pending=NULL WHERE id=?').run(user.id);
    return { ok: true };
  });

  add('GET', '/api/catalog', ({ user }) => {
    requireRole(user, 'owner', 'sales', 'worker', 'client');
    return { categories: C.CATEGORIES, projectTypes: C.PROJECT_TYPES.map(({ key, es, en, tasks }) => ({ key, es, en, taskCount: tasks.length })),
      jobStatus: C.JOB_STATUS, warrantyMonths: C.WARRANTY_MONTHS, taskPairs: C.taskPairs(), delayReasons: C.DELAY_REASONS };
  });

  // ===== usuarios (solo dueños) =====
  add('GET', '/api/users', ({ user }) => {
    requireRole(user, 'owner');
    return db.prepare('SELECT * FROM users WHERE is_agent=0 ORDER BY role, name').all().map(publicUser);
  });
  add('POST', '/api/users', ({ user, body }) => {
    requireRole(user, 'owner');
    const username = need(body.username, 'usuario', 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail(400, 'Usuario: solo letras, números, punto, guion (mínimo 3)');
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) fail(400, 'Ese usuario ya existe');
    // Sin contraseña = invitación: la app inventa una temporal (vale 7 días) y al entrar la persona pone la suya.
    const invite = !body.password;
    if (!invite && !A.validPassword(body.password)) fail(400, 'La contraseña debe tener al menos 10 caracteres');
    if (invite) body.password = require('./recover').tempPassword();
    const role = oneOf(body.role, ['owner', 'pm', 'sales', 'worker', 'client'], 'rol');
    const lang = ['es', 'en'].includes(body.lang) ? body.lang : (role === 'client' ? 'en' : 'es');
    const id = db.prepare('INSERT INTO users(name,username,pass_hash,role,phone,trade,lang) VALUES(?,?,?,?,?,?,?)')
      .run(need(body.name, 'nombre', 80), username, A.hashPassword(body.password), role, str(body.phone, 40), str(body.trade, 80), lang).lastInsertRowid;
    pmFields(Number(id), body);
    if (role === 'worker' && body.pay_type) {
      const type = oneOf(body.pay_type, ['hora', 'sub'], 'forma de pago');
      db.prepare('UPDATE users SET pay_type=?, rate_cents=? WHERE id=?').run(type, type === 'hora' ? cents(body.rate_cents ?? 0, 'pago por hora') : 0, Number(id));
    }
    if (invite) db.prepare("UPDATE users SET must_change=1, temp_expires=datetime('now','+7 days') WHERE id=?").run(Number(id));
    if (body.request_id) db.prepare("UPDATE access_requests SET status='resuelto', resolved_by=?, resolved_at=datetime('now'), user_id=? WHERE id=? AND status='pendiente'").run(user.pmId || user.id, Number(id), intId(body.request_id));
    const out = publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(Number(id)));
    return invite ? { ...out, temp: body.password, expires_hours: 168 } : out;
  });
  // Límites del project manager y "relacionado con" (para que un PM no apruebe lo de su gente).
  const pmFields = (id, body) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    // Herramientas extra además del papel (por ejemplo, un dueño que también vende).
    if ('tools' in body) {
      const list = (Array.isArray(body.tools) ? body.tools : String(body.tools || '').split(',')).map(x => String(x).trim()).filter(Boolean);
      const ok = list.filter(x => TOOLS.includes(x));
      if (ok.length !== list.length) fail(400, 'Herramienta desconocida');
      db.prepare('UPDATE users SET tools=? WHERE id=?').run([...new Set(ok)].join(','), id);
    }
    if ('pm_limit_cents' in body) db.prepare('UPDATE users SET pm_limit_cents=? WHERE id=?').run(cents(body.pm_limit_cents ?? 0, 'límite por gasto'), id);
    if ('pm_month_cents' in body) db.prepare('UPDATE users SET pm_month_cents=? WHERE id=?').run(cents(body.pm_month_cents ?? 0, 'límite al mes'), id);
    if ('related_pm_id' in body) {
      const r = body.related_pm_id ? db.prepare("SELECT id FROM users WHERE id=? AND role='pm'").get(intId(body.related_pm_id)) : null;
      if (body.related_pm_id && !r) fail(400, 'Ese project manager no existe');
      if (u.role !== 'worker' && body.related_pm_id) fail(400, 'Solo un sub o trabajador puede estar relacionado con un project manager');
      db.prepare('UPDATE users SET related_pm_id=? WHERE id=?').run(r ? r.id : null, id);
    }
  };
  add('PUT', '/api/users/:id', ({ user, body, params }) => {
    requireRole(user, 'owner');
    const id = intId(params.id);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id); if (!u) fail(404, 'No encontrado');
    const name = 'name' in body ? need(body.name, 'nombre', 80) : u.name;
    const phone = 'phone' in body ? str(body.phone, 40) : u.phone;
    const trade = 'trade' in body ? str(body.trade, 80) : u.trade;
    const active = 'active' in body ? (body.active ? 1 : 0) : u.active;
    const lang = 'lang' in body ? oneOf(body.lang, ['es', 'en'], 'idioma') : u.lang;
    if (u.role === 'owner' && !active) {
      const others = db.prepare("SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1 AND id<>?").get(id).n;
      if (!others) fail(400, 'Debe quedar al menos un dueño activo');
    }
    db.prepare('UPDATE users SET name=?, phone=?, trade=?, active=?, lang=? WHERE id=?').run(name, phone, trade, active, lang, id);
    if (id === user.id && ('pm_limit_cents' in body || 'pm_month_cents' in body)) fail(403, 'Nadie cambia sus propios límites');
    pmFields(id, body);
    if (body.password) {
      if (!A.validPassword(body.password)) fail(400, 'La contraseña debe tener al menos 10 caracteres');
      db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(A.hashPassword(body.password), id);
      if (id !== user.id) A.endAllSessions(db, id);
    }
    if (body.resetMfa && id !== user.id) db.prepare('UPDATE users SET totp_secret=NULL, totp_pending=NULL WHERE id=?').run(id);
    if (!active) A.endAllSessions(db, id);
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  });

  // ===== panel del dueño =====
  add('GET', '/api/dashboard', ({ user }) => {
    requireRole(user, 'owner');
    const jobs = db.prepare("SELECT * FROM jobs WHERE status IN ('activo','cotizado','prospecto') ORDER BY start_date").all();
    const active = jobs.filter(j => j.status === 'activo').map(j => ({ id: j.id, client_name: j.client_name, project_type: j.project_type,
      end_date: j.end_date, money: money(db, j.id), progress: progress(db, j.id) }));
    const t = today();
    const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const tasksSoon = db.prepare(`SELECT t.id, t.title, t.status, t.planned_date, t.job_id, j.client_name, u.name assignee_name
      FROM tasks t JOIN jobs j ON j.id=t.job_id LEFT JOIN users u ON u.id=t.assignee_id
      WHERE j.status='activo' AND t.status<>'hecho' AND t.planned_date<>'' AND t.planned_date<=?
      ORDER BY t.planned_date LIMIT 50`).all(weekEnd).map(x => ({ ...x, overdue: x.planned_date < t }));
    const followUps = jobs.filter(j => ['prospecto', 'cotizado'].includes(j.status))
      .map(j => ({ id: j.id, client_name: j.client_name, client_phone: j.client_phone, status: j.status,
        follow_up_date: j.follow_up_date, quoted_cents: j.quoted_cents, due: !!j.follow_up_date && j.follow_up_date <= t }))
      .sort((a, b) => (a.follow_up_date || '9999').localeCompare(b.follow_up_date || '9999'));
    const sum = k => active.reduce((s, j) => s + j.money[k], 0);
    const yearStart = t.slice(0, 4) + '-01-01';
    const byCategory = db.prepare('SELECT category, SUM(amount_cents) total FROM expenses WHERE date>=? GROUP BY category').all(yearStart);
    const reworkYear = db.prepare("SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE category='retrabajo' AND date>=?").get(yearStart).v;
    const pendingCO = db.prepare(`SELECT c.id, c.job_id, c.description, c.price_cents, j.client_name FROM change_orders c
      JOIN jobs j ON j.id=c.job_id WHERE c.status='pendiente' ORDER BY c.date`).all();
    return { active, tasksSoon, followUps, pendingCO, byCategory, reworkYear, year: t.slice(0, 4),
      totals: { contract: sum('contract'), spent: sum('spent'), profit: sum('profit'), balanceDue: sum('balanceDue'), subsOwed: sum('subsOwed') } };
  });

  // ===== obras =====
  add('GET', '/api/jobs', ({ user }) => {
    requireRole(user, 'owner', 'worker', 'client');
    if (user.role === 'owner') {
      return db.prepare('SELECT * FROM jobs ORDER BY CASE status WHEN \'activo\' THEN 0 WHEN \'cotizado\' THEN 1 WHEN \'prospecto\' THEN 2 ELSE 3 END, id DESC').all()
        .map(j => ({ ...j, money: money(db, j.id), progress: progress(db, j.id) }));
    }
    const rows = user.role === 'client'
      ? db.prepare('SELECT * FROM jobs WHERE client_user_id=? ORDER BY id DESC').all(user.id)
      : db.prepare(`SELECT * FROM jobs WHERE id IN (SELECT job_id FROM tasks WHERE assignee_id=? UNION SELECT job_id FROM subs WHERE user_id=?)
          AND status NOT IN ('cancelado') ORDER BY id DESC`).all(user.id, user.id);
    return rows.map(j => ({ id: j.id, client_name: j.client_name, address: j.address, project_type: j.project_type,
      status: j.status, start_date: j.start_date, end_date: j.end_date, progress: progress(db, j.id),
      myOpenTasks: user.role === 'worker' ? db.prepare("SELECT COUNT(*) n FROM tasks WHERE job_id=? AND assignee_id=? AND status<>'hecho'").get(j.id, user.id).n : undefined }));
  });

  add('POST', '/api/jobs', ({ user, body }) => {
    requireRole(user, 'owner');
    const f = jobFields(body, false);
    return tx(db, () => {
      const cols = Object.keys(f);
      const id = Number(db.prepare(`INSERT INTO jobs(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(k => f[k])).lastInsertRowid);
      if (body.applyTemplate !== false) {
        const tpl = C.PROJECT_TYPES.find(t => t.key === f.project_type);
        const ins = db.prepare('INSERT INTO tasks(job_id,position,title) VALUES(?,?,?)');
        (tpl ? tpl.tasks : []).forEach(([title], i) => ins.run(id, (i + 1) * 10, title));
      }
      return { id };
    });
  });

  add('GET', '/api/jobs/:id', ({ user, params }) => {
    requireRole(user, 'owner', 'worker', 'client');
    const job = jobOr404(db, user, intId(params.id));
    if (user.role === 'owner') return jobForOwner(db, job);
    if (user.role === 'client') return jobForClient(db, job);
    return jobForWorker(db, job, user);
  });

  add('PUT', '/api/jobs/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const f = jobFields(body, true);
    if ('client_user_id' in body) f.client_user_id = checkUserRef(db, body.client_user_id, 'client');
    if (f.status === 'terminado' && !('completed_date' in f) && !job.completed_date) f.completed_date = today();
    const cols = Object.keys(f);
    if (cols.length) db.prepare(`UPDATE jobs SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`).run(...cols.map(k => f[k]), job.id);
    // Inicio y fin de obra se informan al cliente automáticamente.
    let upd = null;
    if (f.status && f.status !== job.status && ['activo', 'terminado'].includes(f.status)) {
      const after = db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
      upd = S.clientUpdate(job.id, 'status', { status: f.status, end_date: after.end_date, warranty_until: warrantyUntil(after) });
    }
    return { ok: true, clientUpdateRow: upd ? updateRow(upd) : null, client: upd ? S.clientOf(job) : null };
  });

  add('DELETE', '/api/jobs/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    if (str(body.confirm, 200) !== job.client_name) fail(400, 'Para borrar, escriba exactamente el nombre del cliente');
    const files = db.prepare('SELECT id, mime FROM files WHERE job_id=?').all(job.id);
    db.prepare('DELETE FROM jobs WHERE id=?').run(job.id);
    removeFileRows(db, files);
    return { ok: true };
  });

  // ===== tareas =====
  add('POST', '/api/jobs/:id/tasks', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const max = db.prepare('SELECT COALESCE(MAX(position),0) m FROM tasks WHERE job_id=?').get(job.id).m;
    const pd = date(body.planned_date), pe = date(body.planned_end, 'fecha fin');
    if (pe && (!pd || pe < pd)) fail(400, 'La fecha de fin no puede ser antes del inicio');
    const id = db.prepare('INSERT INTO tasks(job_id,position,title,assignee_id,planned_date,planned_end,notes) VALUES(?,?,?,?,?,?,?)')
      .run(job.id, max + 10, need(body.title, 'tarea', 200), checkUserRef(db, body.assignee_id, 'worker'), pd, pe, str(body.notes, 2000)).lastInsertRowid;
    return { id: Number(id) };
  });

  const taskOr404 = (user, id) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(intId(id));
    if (!t || !canSeeJob(db, user, t.job_id)) fail(404, 'Tarea no encontrada');
    return t;
  };

  add('PUT', '/api/tasks/:id', ({ user, params, body }) => {
    requireRole(user, 'owner', 'worker');
    const t = taskOr404(user, params.id);
    const f = {};
    if (user.role === 'worker') {
      if (t.assignee_id !== user.id) fail(403, 'Solo puede actualizar sus propias tareas');
      if ('status' in body) f.status = oneOf(body.status, ['pendiente', 'en_progreso', 'hecho'], 'estado');
      if ('notes' in body) f.notes = str(body.notes, 2000);
    } else {
      if ('title' in body) f.title = need(body.title, 'tarea', 200);
      if ('status' in body) f.status = oneOf(body.status, ['pendiente', 'en_progreso', 'hecho'], 'estado');
      if ('assignee_id' in body) f.assignee_id = checkUserRef(db, body.assignee_id, 'worker');
      if ('planned_date' in body) f.planned_date = date(body.planned_date);
      if ('planned_end' in body) f.planned_end = date(body.planned_end, 'fecha fin');
      if ('done_date' in body) f.done_date = date(body.done_date);
      if ('notes' in body) f.notes = str(body.notes, 2000);
    }
    const ps = 'planned_date' in f ? f.planned_date : t.planned_date, pe = 'planned_end' in f ? f.planned_end : t.planned_end;
    if (pe && (!ps || pe < ps)) fail(400, 'La fecha de fin no puede ser antes del inicio');
    if (f.status === 'hecho' && !('done_date' in f) && !t.done_date) f.done_date = today();
    if (f.status && f.status !== 'hecho') f.done_date = '';
    const cols = Object.keys(f);
    if (cols.length) db.prepare(`UPDATE tasks SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`).run(...cols.map(k => f[k]), t.id);
    return { ok: true };
  });

  add('POST', '/api/tasks/:id/move', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const t = taskOr404(user, params.id);
    const list = db.prepare('SELECT id FROM tasks WHERE job_id=? ORDER BY position, id').all(t.job_id).map(r => r.id);
    const i = list.indexOf(t.id), j = i + (body.dir === 'up' ? -1 : 1);
    if (j < 0 || j >= list.length) return { ok: true };
    [list[i], list[j]] = [list[j], list[i]];
    tx(db, () => { const up = db.prepare('UPDATE tasks SET position=? WHERE id=?'); list.forEach((id, k) => up.run((k + 1) * 10, id)); });
    return { ok: true };
  });

  add('DELETE', '/api/tasks/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const t = taskOr404(user, params.id);
    const files = db.prepare('SELECT id, mime FROM files WHERE task_id=?').all(t.id);
    db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
    removeFileRows(db, files);
    return { ok: true };
  });

  // ===== fotos de avance =====
  add('POST', '/api/jobs/:id/photos', ({ user, params, body }) => {
    requireRole(user, 'owner', 'worker');
    const job = jobOr404(db, user, intId(params.id));
    let taskId = null;
    if (body.task_id) {
      const t = taskOr404(user, body.task_id);
      if (t.job_id !== job.id) fail(400, 'La tarea no es de esta obra');
      taskId = t.id;
    }
    return saveImage(db, user, { dataUrl: body.dataUrl, jobId: job.id, taskId, kind: 'photo', caption: body.caption });
  });

  add('DELETE', '/api/files/:id', ({ user, params }) => {
    requireRole(user, 'owner', 'worker');
    const f = db.prepare('SELECT * FROM files WHERE id=?').get(str(params.id, 64));
    if (!f || !canSeeJob(db, user, f.job_id)) fail(404, 'No encontrado');
    if (user.role === 'worker' && (f.created_by !== user.id || f.kind !== 'photo')) fail(403, 'Solo puede borrar sus propias fotos');
    if (user.isPm && f.kind === 'receipt') fail(403, 'Los recibos son comprobantes: solo los dueños los borran');
    if (f.msg_id) fail(400, 'Las fotos de un caso no se borran: son parte del historial');
    db.prepare('DELETE FROM files WHERE id=?').run(f.id);
    removeFileRows(db, [f]);
    return { ok: true };
  });

  // ===== gastos =====
  function expenseFields(b, jobId) {
    const f = {
      date: needDate(b.date || today(), 'fecha'),
      category: oneOf(b.category, CAT_KEYS, 'categoría'),
      description: need(b.description, 'qué se compró', 300),
      vendor: str(b.vendor, 120),
      bought_by: str(b.bought_by, 80),
      amount_cents: cents(b.amount_cents, 'monto'),
      sub_id: null,
      reimburse: b.reimburse === true || b.reimburse === 'si' || b.reimburse === 1 ? 1 : 0,
    };
    if (f.amount_cents === 0) fail(400, 'El monto debe ser mayor que cero');
    if (b.sub_id) {
      const s = db.prepare('SELECT id FROM subs WHERE id=? AND job_id=?').get(Number(b.sub_id), jobId);
      if (!s) fail(400, 'Subcontratista no válido para esta obra');
      f.sub_id = s.id; f.category = 'subcontratistas';
    }
    return f;
  }

  add('POST', '/api/jobs/:id/expenses', ({ user, params, body }) => {
    requireRole(user, 'owner', 'worker');
    const job = jobOr404(db, user, intId(params.id));
    const f = expenseFields(body, job.id);
    if (user.role === 'worker') { f.sub_id = null; if (f.category === 'subcontratistas') fail(400, 'Categoría no permitida'); if (!f.bought_by) f.bought_by = user.name; }
    return tx(db, () => {
      const id = Number(db.prepare(`INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,sub_id,created_by,reimburse)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(job.id, f.date, f.category, f.description, f.vendor, f.bought_by, f.amount_cents, f.sub_id, user.id, f.reimburse).lastInsertRowid);
      if (body.receipt) saveImage(db, user, { dataUrl: body.receipt, jobId: job.id, expenseId: id, kind: 'receipt' });
      return { id };
    });
  });

  const expenseOr404 = (user, id) => {
    const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(intId(id)); if (!e) fail(404, 'No encontrado');
    jobOr404(db, user, e.job_id); return e;
  };
  add('PUT', '/api/expenses/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const e = expenseOr404(user, params.id);
    const f = expenseFields({ ...e, ...body }, e.job_id);
    db.prepare('UPDATE expenses SET date=?,category=?,description=?,vendor=?,bought_by=?,amount_cents=?,sub_id=? WHERE id=?')
      .run(f.date, f.category, f.description, f.vendor, f.bought_by, f.amount_cents, f.sub_id, e.id);
    if (body.receipt) saveImage(db, user, { dataUrl: body.receipt, jobId: e.job_id, expenseId: e.id, kind: 'receipt' });
    return { ok: true };
  });
  add('DELETE', '/api/expenses/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const e = expenseOr404(user, params.id);
    const doc = db.prepare('SELECT number FROM sub_docs WHERE expense_id=?').get(e.id);
    if (doc) fail(400, 'Este gasto viene de un invoice aprobado del sub; no se puede borrar aquí');
    const files = db.prepare('SELECT id, mime FROM files WHERE expense_id=?').all(e.id);
    db.prepare('DELETE FROM expenses WHERE id=?').run(e.id);
    removeFileRows(db, files);
    return { ok: true };
  });

  add('GET', '/api/expenses', ({ user, query }) => {
    requireRole(user, 'owner');
    const from = date(query.get('from')) || '0000-01-01', to = date(query.get('to')) || '9999-12-31';
    const cat = query.get('category');
    const rows = db.prepare(`SELECT e.*, j.client_name, s.name sub_name FROM expenses e JOIN jobs j ON j.id=e.job_id
      LEFT JOIN subs s ON s.id=e.sub_id WHERE e.date BETWEEN ? AND ? ${cat ? 'AND e.category=?' : ''}
      ORDER BY e.date DESC, e.id DESC`).all(...[from, to, ...(cat ? [oneOf(cat, CAT_KEYS, 'categoría')] : [])]);
    return rows;
  });

  // ===== subcontratistas por obra =====
  add('POST', '/api/jobs/:id/subs', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const id = db.prepare('INSERT INTO subs(job_id,name,trade,agreed_cents,user_id,notes) VALUES(?,?,?,?,?,?)')
      .run(job.id, need(body.name, 'nombre', 120), str(body.trade, 120), cents(body.agreed_cents ?? 0, 'total acordado'),
        checkUserRef(db, body.user_id, 'worker'), str(body.notes, 1000)).lastInsertRowid;
    return { id: Number(id) };
  });
  const subOr404 = (user, id) => {
    const s = db.prepare('SELECT * FROM subs WHERE id=?').get(intId(id)); if (!s) fail(404, 'No encontrado');
    jobOr404(db, user, s.job_id); return s;
  };
  add('PUT', '/api/subs/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const s = subOr404(user, params.id);
    db.prepare('UPDATE subs SET name=?, trade=?, agreed_cents=?, user_id=?, notes=? WHERE id=?').run(
      'name' in body ? need(body.name, 'nombre', 120) : s.name, 'trade' in body ? str(body.trade, 120) : s.trade,
      'agreed_cents' in body ? cents(body.agreed_cents, 'total acordado') : s.agreed_cents,
      'user_id' in body ? checkUserRef(db, body.user_id, 'worker') : s.user_id, 'notes' in body ? str(body.notes, 1000) : s.notes, s.id);
    return { ok: true };
  });
  add('DELETE', '/api/subs/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const s = subOr404(user, params.id);
    if (db.prepare('SELECT 1 FROM expenses WHERE sub_id=?').get(s.id) || db.prepare('SELECT 1 FROM sub_payments WHERE sub_id=?').get(s.id)) fail(400, 'Tiene pagos registrados; bórrelos primero');
    db.prepare('DELETE FROM subs WHERE id=?').run(s.id);
    return { ok: true };
  });

  // ===== change orders =====
  add('POST', '/api/jobs/:id/changes', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const id = db.prepare('INSERT INTO change_orders(job_id,date,description,cost_cents,price_cents,status) VALUES(?,?,?,?,?,?)')
      .run(job.id, needDate(body.date || today(), 'fecha'), need(body.description, 'qué cambió', 2000),
        cents(body.cost_cents ?? 0, 'costo', { allowNegative: true }), cents(body.price_cents ?? 0, 'precio', { allowNegative: true }),
        oneOf(body.status || 'pendiente', ['pendiente', 'aprobado', 'rechazado'], 'estado')).lastInsertRowid;
    const co = db.prepare('SELECT * FROM change_orders WHERE id=?').get(Number(id));
    const upd = co.status === 'aprobado' ? S.clientUpdate(job.id, 'change_order', { description: co.description, price: co.price_cents }) : null;
    return { id: Number(id), clientUpdateRow: upd ? updateRow(upd) : null, client: upd ? S.clientOf(job) : null };
  });
  const coOr404 = (user, id) => {
    const c = db.prepare('SELECT * FROM change_orders WHERE id=?').get(intId(id)); if (!c) fail(404, 'No encontrado');
    jobOr404(db, user, c.job_id); return c;
  };
  add('PUT', '/api/changes/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const c = coOr404(user, params.id); const b = { ...c, ...body };
    db.prepare('UPDATE change_orders SET date=?, description=?, cost_cents=?, price_cents=?, status=? WHERE id=?').run(
      needDate(b.date, 'fecha'), need(b.description, 'qué cambió', 2000), cents(b.cost_cents, 'costo', { allowNegative: true }),
      cents(b.price_cents, 'precio', { allowNegative: true }), oneOf(b.status, ['pendiente', 'aprobado', 'rechazado'], 'estado'), c.id);
    // Un change order recién aprobado se informa al cliente.
    const co = db.prepare('SELECT * FROM change_orders WHERE id=?').get(c.id);
    let upd = null;
    if (co.status === 'aprobado' && c.status !== 'aprobado') upd = S.clientUpdate(c.job_id, 'change_order', { description: co.description, price: co.price_cents });
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(c.job_id);
    return { ok: true, clientUpdateRow: upd ? updateRow(upd) : null, client: upd ? S.clientOf(job) : null };
  });
  add('DELETE', '/api/changes/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const c = coOr404(user, params.id);
    db.prepare('DELETE FROM change_orders WHERE id=?').run(c.id);
    return { ok: true };
  });

  // ===== pagos del cliente =====
  add('POST', '/api/jobs/:id/payments', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const amount = cents(body.amount_cents, 'monto'); if (!amount) fail(400, 'El monto debe ser mayor que cero');
    const id = db.prepare('INSERT INTO payments(job_id,date,amount_cents,method,note) VALUES(?,?,?,?,?)')
      .run(job.id, needDate(body.date || today(), 'fecha'), amount, str(body.method, 40), str(body.note, 300)).lastInsertRowid;
    return { id: Number(id) };
  });
  add('DELETE', '/api/payments/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(intId(params.id)); if (!p) fail(404, 'No encontrado');
    jobOr404(db, user, p.job_id);
    db.prepare('DELETE FROM payments WHERE id=?').run(p.id);
    return { ok: true };
  });

  // ===== respaldo =====
  add('GET', '/api/backup', ({ user }) => {
    requireRole(user, 'owner');
    const file = path.join(db.dataDir, 'backups', `descarga-${Date.now()}.db`);
    backup(db, file);
    return { $file: file, $name: `elevated-respaldo-${today()}.db`, $deleteAfter: true };
  });

  return R;
}

// Archivo protegido: se entrega solo si el usuario puede ver la obra.
// Los recibos (dinero) solo los ven los dueños.
function canSeeIssueMsg(db, user, msgId) {
  const r = db.prepare('SELECT m.visibility, i.worker_id, i.client_visible, i.job_id FROM issue_messages m JOIN issues i ON i.id=m.issue_id WHERE m.id=?').get(msgId);
  if (!r) return false;
  if (user.role === 'pm' || user.isPm) return canSeeJob(db, user, r.job_id);
  if (user.role === 'owner') return true;
  if (user.role === 'worker') return r.visibility === 'interno' && r.worker_id === user.id;
  if (user.role === 'client') return r.visibility === 'cliente' && !!r.client_visible;
  return false;
}
function fileFor(db, user, id) {
  if (!user || !/^[a-f0-9]{32}$/.test(id)) return null;
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(id);
  if (!f) return null;
  const fileOut = { path: path.join(db.dataDir, 'files', `${f.id}.${MIME[f.mime]}`), mime: f.mime };
  // Fotos marcadas para la galería: las puede ver cualquier usuario con sesión (sin datos de la obra).
  if (f.gallery && f.kind === 'photo' && !f.msg_id) return fileOut;
  if (!canSeeJob(db, user, f.job_id)) return null;
  // Recibos: solo dueños. Documento de un sub (invoice/estimado): dueños y el sub que lo subió.
  if (f.kind === 'receipt' && user.role !== 'owner' && user.role !== 'pm' && !(f.doc_id && f.created_by === user.id)) return null;
  // Fotos de un caso: según quién puede ver ese mensaje (lo interno nunca lo ve el cliente).
  if (f.msg_id && !canSeeIssueMsg(db, user, f.msg_id)) return null;
  return { path: path.join(db.dataDir, 'files', `${f.id}.${MIME[f.mime]}`), mime: f.mime };
}

module.exports = { routes, fileFor, HttpError, money };
