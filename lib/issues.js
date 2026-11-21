'use strict';
// Casos: problemas u obstáculos que necesitan una decisión, y preguntas del cliente, con fotos.
//  - Un sub o un dueño (project manager) reporta un problema → es INTERNO (empresa + ese sub).
//  - La empresa analiza y, si hace falta, le explica al cliente con un mensaje y las fotos que elija.
//  - El cliente puede preguntar con fotos; solo ve los mensajes marcados para el cliente.
// Lo interno (mensajes y fotos) nunca lo ve el cliente; el sub nunca ve lo que se habla con el cliente.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tx } = require('./db');

const MAX_PHOTOS = 8;

// ¿Quién puede ver el caso?
function canSee(db, user, i) {
  if (!i) return false;
  if (user.isPm) return !!db.prepare('SELECT 1 FROM jobs WHERE id=? AND pm_id=?').get(i.job_id, user.pmId);
  if (user.role === 'owner') return true;
  if (user.role === 'worker') return i.worker_id === user.id;
  if (user.role === 'client') return !!i.client_visible && !!db.prepare('SELECT 1 FROM jobs WHERE id=? AND client_user_id=?').get(i.job_id, user.id);
  return false;
}
// Qué mensajes ve cada quien.
const visFilter = user => user.role === 'owner' ? '' : user.role === 'worker' ? "AND m.visibility='interno'" : "AND m.visibility='cliente'";

function visibleIssues(db, user, jobId) {
  const where = [];
  const args = [];
  if (user.isPm || user.role === 'pm') { where.push('j.pm_id=?'); args.push(user.pmId || user.id); }
  if (jobId) { where.push('i.job_id=?'); args.push(jobId); }
  if (user.role === 'worker') { where.push('i.worker_id=?'); args.push(user.id); }
  if (user.role === 'client') { where.push('i.client_visible=1 AND j.client_user_id=?'); args.push(user.id); }
  return db.prepare(`SELECT i.*, j.client_name, j.address FROM issues i JOIN jobs j ON j.id=i.job_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE i.status WHEN 'resuelto' THEN 1 ELSE 0 END, i.updated_at DESC, i.id DESC LIMIT 300`).all(...args);
}
function unreadFor(db, user, issueId) {
  const r = db.prepare('SELECT last_msg_id FROM issue_reads WHERE issue_id=? AND user_id=?').get(issueId, user.id);
  return db.prepare(`SELECT COUNT(*) n FROM issue_messages m WHERE m.issue_id=? AND m.id>? AND (m.user_id IS NULL OR m.user_id<>?) ${visFilter(user)}`)
    .get(issueId, r ? r.last_msg_id : 0, user.id).n;
}
function unreadCount(db, user) {
  if (user.role === 'pm') user = { ...user, role: 'owner', isPm: true, pmId: user.id };
  if (!['owner', 'worker', 'client'].includes(user.role)) return 0;
  return visibleIssues(db, user).filter(i => i.status !== 'resuelto' || user.role !== 'owner').filter(i => unreadFor(db, user, i.id) > 0).length;
}

module.exports = function issueRoutes(db, add, h) {
  const { requireRole, fail, str, need, oneOf, intId, canSeeJob, saveImage } = h;
  const names = id => (db.prepare('SELECT name, role FROM users WHERE id=?').get(id) || { name: '', role: '' });

  const summary = (user, i) => {
    const last = db.prepare(`SELECT m.body, m.created_at, m.user_id FROM issue_messages m WHERE m.issue_id=? ${visFilter(user)} ORDER BY m.id DESC LIMIT 1`).get(i.id);
    const out = { id: i.id, job_id: i.job_id, client_name: i.client_name, address: i.address, kind: i.kind, title: i.title, urgent: !!i.urgent,
      status: i.status, created_at: i.created_at, updated_at: i.updated_at, created_role: i.created_role, by_name: names(i.created_by).name,
      unread: unreadFor(db, user, i.id), last: last ? { body: last.body.slice(0, 160), at: last.created_at, by: names(last.user_id).name } : null };
    if (user.role === 'owner') Object.assign(out, { client_visible: !!i.client_visible, worker_id: i.worker_id, worker_name: i.worker_id ? names(i.worker_id).name : '' });
    if (i.status === 'resuelto' && user.role !== 'client') out.decision = i.decision;
    return out;
  };
  const issueOr404 = (user, id) => {
    const i = db.prepare('SELECT * FROM issues WHERE id=?').get(intId(id));
    if (!canSee(db, user, i)) fail(404, 'Caso no encontrado');
    return i;
  };
  const savePhotos = (user, issue, msgId, photos) => {
    const list = Array.isArray(photos) ? photos : [];
    if (list.length > MAX_PHOTOS) fail(400, `Máximo ${MAX_PHOTOS} fotos por mensaje`);
    for (const p of list) {
      const { id } = saveImage(db, user, { dataUrl: p, jobId: issue.job_id, kind: 'photo', caption: '' });
      db.prepare('UPDATE files SET msg_id=? WHERE id=?').run(msgId, id);
    }
  };
  // El dueño comparte con el cliente fotos que ya estaban en el caso (se copian: el original sigue interno).
  const shareFiles = (issue, msgId, ids) => {
    for (const fid of (Array.isArray(ids) ? ids : []).slice(0, MAX_PHOTOS)) {
      const f = db.prepare('SELECT f.* FROM files f JOIN issue_messages m ON m.id=f.msg_id WHERE f.id=? AND m.issue_id=?').get(String(fid), issue.id);
      if (!f) fail(400, 'Foto no encontrada en este caso');
      const ext = f.mime === 'image/png' ? 'png' : f.mime === 'image/webp' ? 'webp' : 'jpg';
      const nid = crypto.randomBytes(16).toString('hex');
      fs.copyFileSync(path.join(db.dataDir, 'files', `${f.id}.${ext}`), path.join(db.dataDir, 'files', `${nid}.${ext}`));
      db.prepare("INSERT INTO files(id,job_id,kind,mime,caption,created_by,msg_id) VALUES(?,?,'photo',?,?,?,?)").run(nid, f.job_id, f.mime, f.caption || '', f.created_by, msgId);
    }
  };
  const addMsg = (user, issue, visibility, body) => Number(db.prepare('INSERT INTO issue_messages(issue_id,user_id,visibility,body) VALUES(?,?,?,?)')
    .run(issue.id, user.id, visibility, body).lastInsertRowid);
  const markRead = (user, issueId) => {
    const m = db.prepare('SELECT MAX(id) n FROM issue_messages WHERE issue_id=?').get(issueId).n || 0;
    db.prepare('INSERT INTO issue_reads(issue_id,user_id,last_msg_id) VALUES(?,?,?) ON CONFLICT(issue_id,user_id) DO UPDATE SET last_msg_id=excluded.last_msg_id').run(issueId, user.id, m);
  };
  const touch = (id, status) => db.prepare(`UPDATE issues SET updated_at=datetime('now')${status ? ', status=?' : ''} WHERE id=?`).run(...(status ? [status, id] : [id]));

  add('GET', '/api/issues', ({ user, query }) => {
    requireRole(user, 'owner', 'worker', 'client');
    const jobId = query && query.get('job_id') ? intId(query.get('job_id')) : null;
    if (jobId && !canSeeJob(db, user, jobId)) fail(404, 'Obra no encontrada');
    return visibleIssues(db, user, jobId).map(i => summary(user, i));
  });

  add('GET', '/api/issues/:id', ({ user, params }) => {
    requireRole(user, 'owner', 'worker', 'client');
    const i = issueOr404(user, params.id);
    const msgs = db.prepare(`SELECT m.* FROM issue_messages m WHERE m.issue_id=? ${visFilter(user)} ORDER BY m.id`).all(i.id).map(m => {
      const u = names(m.user_id);
      return { id: m.id, body: m.body, at: m.created_at, by: u.name, by_role: u.role, mine: m.user_id === user.id,
        visibility: user.role === 'owner' ? m.visibility : undefined,
        photos: db.prepare('SELECT id FROM files WHERE msg_id=? ORDER BY created_at').all(m.id).map(f => f.id) };
    });
    const out = summary(user, i);
    markRead(user, i.id);
    out.unread = 0;
    out.messages = msgs;
    if (user.role === 'owner') {
      const j = db.prepare('SELECT client_name, client_phone, client_email, client_user_id FROM jobs WHERE id=?').get(i.job_id);
      const cu = j.client_user_id ? db.prepare('SELECT lang FROM users WHERE id=?').get(j.client_user_id) : null;
      out.client = { name: j.client_name, phone: j.client_phone, email: j.client_email, lang: cu ? cu.lang : 'es', has_portal: !!j.client_user_id };
      const w = i.worker_id ? db.prepare('SELECT name, phone, lang FROM users WHERE id=?').get(i.worker_id) : null;
      out.worker = w;
      out.decision = i.decision;
    }
    return out;
  });

  // Abrir un caso.
  add('POST', '/api/issues', ({ user, body }) => {
    requireRole(user, 'owner', 'worker', 'client');
    const jobId = intId(body.job_id);
    if (!canSeeJob(db, user, jobId)) fail(404, 'Obra no encontrada');
    const kind = oneOf(body.kind || (user.role === 'client' ? 'pregunta' : 'problema'), ['problema', 'pregunta'], 'tipo');
    const title = need(body.title, 'de qué se trata', 140);
    const text = need(body.body, 'la explicación', 4000);
    let workerId = null, clientVisible = 0, visibility = 'interno';
    if (user.role === 'worker') workerId = user.id;
    if (user.role === 'client') { clientVisible = 1; visibility = 'cliente'; }
    if (user.role === 'owner') {
      if (body.worker_id) {
        workerId = intId(body.worker_id);
        const w = db.prepare("SELECT id FROM users WHERE id=? AND role='worker'").get(workerId);
        if (!w || !canSeeJob(db, { id: workerId, role: 'worker' }, jobId)) fail(400, 'Ese sub no trabaja en esta obra');
      }
      if (body.to_client) {
        if (!db.prepare('SELECT client_user_id FROM jobs WHERE id=?').get(jobId).client_user_id && !body.allow_no_portal) { /* se avisa por WhatsApp */ }
        clientVisible = 1; visibility = 'cliente';
      }
    }
    return tx(db, () => {
      const id = Number(db.prepare(`INSERT INTO issues(job_id,kind,title,urgent,status,created_by,created_role,worker_id,client_visible) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(jobId, kind, title, body.urgent ? 1 : 0, user.role === 'owner' && clientVisible ? 'esperando_cliente' : 'abierto', user.id, user.role, workerId, clientVisible).lastInsertRowid);
      const issue = db.prepare('SELECT * FROM issues WHERE id=?').get(id);
      const mid = addMsg(user, issue, visibility, text);
      savePhotos(user, issue, mid, body.photos);
      markRead(user, id);
      return summary(user, { ...issue, ...db.prepare('SELECT client_name, address FROM jobs WHERE id=?').get(jobId) });
    });
  });

  // Responder / agregar fotos. El dueño elige si el mensaje es interno o para el cliente.
  add('POST', '/api/issues/:id/messages', ({ user, params, body }) => {
    requireRole(user, 'owner', 'worker', 'client');
    const i = issueOr404(user, params.id);
    const text = str(body.body, 4000);
    const photos = Array.isArray(body.photos) ? body.photos : [];
    const share = user.role === 'owner' && Array.isArray(body.share_photos) ? body.share_photos : [];
    if (!text && !photos.length && !share.length) fail(400, 'Escriba un mensaje o agregue una foto');
    let visibility = user.role === 'worker' ? 'interno' : user.role === 'client' ? 'cliente' : oneOf(body.visibility || 'interno', ['interno', 'cliente'], 'para quién');
    if (share.length && visibility !== 'cliente') fail(400, 'Compartir fotos solo aplica a mensajes para el cliente');
    return tx(db, () => {
      const mid = addMsg(user, i, visibility, text);
      savePhotos(user, i, mid, photos);
      if (share.length) shareFiles(i, mid, share);
      let status = null;
      if (user.role === 'owner' && visibility === 'cliente') {
        if (!i.client_visible) db.prepare('UPDATE issues SET client_visible=1 WHERE id=?').run(i.id);
        status = body.wait_client === false ? (i.status === 'resuelto' ? null : 'abierto') : 'esperando_cliente';
      }
      if (user.role !== 'owner') status = 'abierto'; // necesita atención de la empresa (reabre si estaba resuelto)
      touch(i.id, status);
      markRead(user, i.id);
      return { ok: true, id: mid };
    });
  });

  // El dueño cierra el caso con la decisión tomada. La decisión es interna (la ve el sub);
  // si quiere, manda también un mensaje final al cliente.
  add('POST', '/api/issues/:id/resolve', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const i = issueOr404(user, params.id);
    const decision = need(body.decision, 'la decisión', 2000);
    const toClient = str(body.client_message, 4000);
    return tx(db, () => {
      db.prepare("UPDATE issues SET status='resuelto', decision=?, resolved_by=?, resolved_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(decision, user.id, i.id);
      addMsg(user, i, 'interno', `✔ ${decision}`);
      if (toClient) { addMsg(user, i, 'cliente', toClient); db.prepare('UPDATE issues SET client_visible=1 WHERE id=?').run(i.id); }
      markRead(user, i.id);
      return { ok: true };
    });
  });

  add('POST', '/api/issues/:id/reopen', ({ user, params }) => {
    requireRole(user, 'owner');
    const i = issueOr404(user, params.id);
    db.prepare("UPDATE issues SET status='abierto', updated_at=datetime('now') WHERE id=?").run(i.id);
    return { ok: true };
  });

  // Meter a un sub en un caso interno (por ejemplo, el PM vio el problema y el sub debe opinar).
  add('POST', '/api/issues/:id/worker', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const i = issueOr404(user, params.id);
    const wid = body.worker_id ? intId(body.worker_id) : null;
    if (wid && !canSeeJob(db, { id: wid, role: 'worker' }, i.job_id)) fail(400, 'Ese sub no trabaja en esta obra');
    db.prepare('UPDATE issues SET worker_id=? WHERE id=?').run(wid, i.id);
    return { ok: true };
  });
};
module.exports.unreadCount = unreadCount;
