'use strict';
const T = require('./translate');
// Calendario, reprogramación de tareas, avisos a subs (con su respuesta)
// y novedades que se informan al cliente.
const C = require('./catalog');
const { tx } = require('./db');

const REASON_KEYS = C.DELAY_REASONS.map(r => r.key);

function addDays(d, n) {
  const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
}

module.exports = function scheduleRoutes(db, add, H) {
  const { requireRole, fail, str, date, needDate, oneOf, intId, jobOr404, canSeeJob } = H;

  const taskOr404 = (user, id) => {
    const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(intId(id));
    if (!t || !canSeeJob(db, user, t.job_id)) fail(404, 'Tarea no encontrada');
    return t;
  };
  const userBrief = id => {
    if (!id) return null;
    const u = db.prepare('SELECT id, name, phone, lang FROM users WHERE id=?').get(id);
    return u ? { id: u.id, name: u.name, phone: u.phone, lang: u.lang || 'es' } : null;
  };
  const clientOf = job => {
    const u = job.client_user_id ? db.prepare('SELECT name, phone, lang FROM users WHERE id=?').get(job.client_user_id) : null;
    return { name: job.client_name, phone: job.client_phone || (u && u.phone) || '', email: job.client_email || '',
      lang: (u && u.lang) || 'en', hasPortal: !!u };
  };
  const noticeOut = n => {
    const t = db.prepare('SELECT title, planned_date, planned_end FROM tasks WHERE id=?').get(n.task_id) || {};
    const j = db.prepare('SELECT client_name, address FROM jobs WHERE id=?').get(n.job_id) || {};
    return { ...n, task_title: t.title, task_date: t.planned_date, client_name: j.client_name, address: j.address,
      to: userBrief(n.to_user_id) };
  };

  // Mueve las tareas siguientes (no terminadas y con fecha) el mismo número de días.
  function shiftFollowing(task, delta) {
    if (!delta) return [];
    const rows = db.prepare(`SELECT * FROM tasks WHERE job_id=? AND (position > ? OR (position = ? AND id > ?))
      AND status <> 'hecho' AND planned_date <> '' ORDER BY position, id`).all(task.job_id, task.position, task.position, task.id);
    const up = db.prepare('UPDATE tasks SET planned_date=?, planned_end=? WHERE id=?');
    for (const r of rows) up.run(addDays(r.planned_date, delta), r.planned_end ? addDays(r.planned_end, delta) : '', r.id);
    return rows.map(r => ({ ...r, old_date: r.planned_date, planned_date: addDays(r.planned_date, delta) }));
  }

  const insNotice = db.prepare(`INSERT INTO notices(job_id,task_id,kind,created_by,to_user_id,old_date,new_date,reason,note,status,response_date,responded_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insUpdate = db.prepare('INSERT INTO client_updates(job_id,kind,data,note) VALUES(?,?,?,?)');
  function clientUpdate(jobId, kind, data, note = '') {
    return Number(insUpdate.run(jobId, kind, JSON.stringify(data), str(note, 600)).lastInsertRowid);
  }

  // Núcleo: cambia la fecha de una tarea y hace todo lo que corresponde.
  function reschedule(user, task, o) {
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(task.job_id);
    const out = { notices: [], clientUpdate: null, moved: 0, client: clientOf(job), job: { id: job.id, address: job.address, client_name: job.client_name } };
    const newDate = o.newDate;
    let delta = null, newEnd = job.end_date;
    if (newDate) {
      delta = task.planned_date ? daysBetween(task.planned_date, newDate) : null;
      let end = o.newEnd || (task.planned_end && delta != null ? addDays(task.planned_end, delta) : task.planned_end || '');
      if (end && end < newDate) end = '';
      db.prepare('UPDATE tasks SET planned_date=?, planned_end=? WHERE id=?').run(newDate, end, task.id);
    }
    const moved = o.cascade && delta ? shiftFollowing(task, delta) : [];
    out.moved = moved.length;
    if (o.moveEnd && delta && job.end_date) {
      newEnd = addDays(job.end_date, delta);
      db.prepare('UPDATE jobs SET end_date=? WHERE id=?').run(newEnd, job.id);
    }
    if (o.notifySub && task.assignee_id) {
      const id = Number(insNotice.run(job.id, task.id, 'owner', user.id, task.assignee_id, task.planned_date, newDate || '', o.reason, o.note, 'enviado', '', '').lastInsertRowid);
      out.notices.push(id);
    }
    if (o.notifyMoved) {
      for (const m of moved) {
        if (!m.assignee_id) continue;
        db.prepare("UPDATE notices SET status='cerrado', resolution='reemplazado', resolved_at=datetime('now') WHERE task_id=? AND status='enviado'").run(m.id);
        const id = Number(insNotice.run(job.id, m.id, 'moved', user.id, m.assignee_id, m.old_date, m.planned_date, 'tarea_anterior', '', 'enviado', '', '').lastInsertRowid);
        out.notices.push(id);
      }
    }
    if (o.informClient && newDate && task.planned_date !== newDate) {
      out.clientUpdate = clientUpdate(job.id, 'schedule', { task: task.title, old: task.planned_date, new: newDate, moved: moved.length,
        end_date: newEnd !== job.end_date ? newEnd : '' }, o.clientNote);
    }
    out.notices = out.notices.map(id => noticeOut(db.prepare('SELECT * FROM notices WHERE id=?').get(id)));
    out.clientUpdateRow = out.clientUpdate ? db.prepare('SELECT * FROM client_updates WHERE id=?').get(out.clientUpdate) : null;
    return out;
  }

  const options = b => ({
    newEnd: date(b.new_end, 'fecha fin'),
    reason: oneOf(b.reason || 'otro', REASON_KEYS, 'motivo'),
    note: str(b.note, 600),
    cascade: !!b.cascade, moveEnd: !!b.move_end, notifySub: b.notify_sub !== false, notifyMoved: b.notify_moved !== false,
    informClient: !!b.inform_client, clientNote: str(b.client_note, 600),
  });

  // ===== calendario =====
  add('GET', '/api/calendar', ({ user, query }) => {
    requireRole(user, 'owner', 'worker');
    const from = date(query.get('from'), 'desde') || '0000-01-01', to = date(query.get('to'), 'hasta') || '9999-12-31';
    const who = user.role === 'worker' ? user.id : (query.get('user') ? Number(query.get('user')) : null);
    const rows = db.prepare(`SELECT t.id, t.title, t.status, t.planned_date, t.planned_end, t.job_id, t.assignee_id,
        j.client_name, j.address, j.status job_status, u.name assignee_name,
        (SELECT COUNT(*) FROM notices n WHERE n.task_id=t.id AND n.status<>'cerrado') open_notices
      FROM tasks t JOIN jobs j ON j.id=t.job_id LEFT JOIN users u ON u.id=t.assignee_id
      WHERE t.planned_date<>'' AND t.planned_date<=? AND (CASE WHEN t.planned_end<>'' THEN t.planned_end ELSE t.planned_date END)>=?
        AND j.status NOT IN ('cancelado') ${who ? 'AND t.assignee_id=?' : ''}
      ORDER BY t.planned_date, j.client_name, t.position`).all(...[to, from, ...(who ? [who] : [])]);
    return rows;
  });

  // ===== reprogramar (dueño) =====
  add('POST', '/api/tasks/:id/reschedule', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const task = taskOr404(user, params.id);
    const newDate = date(body.new_date, 'nueva fecha');
    const o = { ...options(body), newDate };
    if (!newDate && !o.notifySub) fail(400, 'Ponga la nueva fecha o avise al sub');
    if (!newDate && !task.assignee_id) fail(400, 'Ponga la nueva fecha o asigne la tarea a alguien');
    if (newDate && o.newEnd && o.newEnd < newDate) fail(400, 'La fecha de fin no puede ser antes del inicio');
    return tx(db, () => {
      if (newDate) db.prepare("UPDATE notices SET status='cerrado', resolution='reemplazado', resolved_at=datetime('now') WHERE task_id=? AND status<>'cerrado'").run(task.id);
      return reschedule(user, task, o);
    });
  });

  // ===== teléfonos de los dueños (para que el sub les mande su solicitud por WhatsApp/texto) =====
  add('GET', '/api/contacts/owners', ({ user }) => {
    requireRole(user, 'owner', 'worker');
    return db.prepare("SELECT name, phone, lang FROM users WHERE role='owner' AND active=1 ORDER BY name").all()
      .map(u => ({ name: u.name, phone: u.phone || '', lang: u.lang || 'es' }));
  });

  // ===== el trabajador avisa que se atrasa en su tarea =====
  add('POST', '/api/tasks/:id/delay', ({ user, params, body }) => {
    requireRole(user, 'worker');
    const task = taskOr404(user, params.id);
    if (task.assignee_id !== user.id) fail(403, 'Solo puede actualizar sus propias tareas');
    const back = needDate(body.date, 'fecha en que puede regresar');
    const id = Number(insNotice.run(task.job_id, task.id, 'worker', user.id, user.id, task.planned_date, '', oneOf(body.reason || 'otro', REASON_KEYS, 'motivo'),
      str(body.note, 600), 'respondido', back, new Date().toISOString().slice(0, 19).replace('T', ' ')).lastInsertRowid);
    db.prepare('UPDATE notices SET response_note=? WHERE id=?').run(str(body.note, 600), id);
    return { id };
  });

  // ===== avisos =====
  add('GET', '/api/notices', ({ user }) => {
    requireRole(user, 'owner', 'worker');
    const rows = user.role === 'owner'
      ? db.prepare("SELECT * FROM notices WHERE status<>'cerrado' OR resolved_at >= datetime('now','-14 days') ORDER BY CASE status WHEN 'respondido' THEN 0 WHEN 'enviado' THEN 1 ELSE 2 END, id DESC LIMIT 200").all()
      : db.prepare("SELECT * FROM notices WHERE to_user_id=? AND (status<>'cerrado' OR resolved_at >= datetime('now','-14 days')) ORDER BY CASE status WHEN 'enviado' THEN 0 WHEN 'respondido' THEN 1 ELSE 2 END, id DESC LIMIT 100").all(user.id);
    return rows.map(n => { const o = noticeOut(n); T.addTr(db, o, 'note', user.lang); T.addTr(db, o, 'response_note', user.lang); return o; });
  });

  const noticeOr404 = (user, id) => {
    const n = db.prepare('SELECT * FROM notices WHERE id=?').get(intId(id));
    if (!n || !canSeeJob(db, user, n.job_id) || (user.role === 'worker' && n.to_user_id !== user.id)) fail(404, 'Aviso no encontrado');
    return n;
  };

  add('POST', '/api/notices/:id/respond', ({ user, params, body }) => {
    requireRole(user, 'worker');
    const n = noticeOr404(user, params.id);
    if (n.status === 'cerrado') fail(400, 'Este aviso ya está cerrado');
    const action = oneOf(body.action, ['confirm', 'propose'], 'respuesta');
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (action === 'confirm') {
      if (!n.new_date) fail(400, 'La fecha está por definir: proponga la fecha en que puede regresar');
      db.prepare("UPDATE notices SET status='cerrado', resolution='confirmado', response_date=new_date, response_note=?, responded_at=?, resolved_at=? WHERE id=?")
        .run(str(body.note, 600), now, now, n.id);
    } else {
      db.prepare("UPDATE notices SET status='respondido', response_date=?, response_note=?, responded_at=? WHERE id=?")
        .run(needDate(body.date, 'fecha en que puede regresar'), str(body.note, 600), now, n.id);
    }
    return { ok: true };
  });

  add('POST', '/api/notices/:id/accept', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const n = noticeOr404(user, params.id);
    if (n.status !== 'respondido' || !n.response_date) fail(400, 'Este aviso no tiene una fecha propuesta');
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(n.task_id);
    return tx(db, () => {
      db.prepare("UPDATE notices SET status='cerrado', resolution='aceptado', resolved_at=datetime('now') WHERE id=?").run(n.id);
      db.prepare("UPDATE notices SET status='cerrado', resolution='reemplazado', resolved_at=datetime('now') WHERE task_id=? AND status<>'cerrado' AND id<>?").run(task.id, n.id);
      return reschedule(user, task, { ...options(body), newDate: n.response_date, notifySub: false });
    });
  });

  add('POST', '/api/notices/:id/close', ({ user, params }) => {
    requireRole(user, 'owner');
    const n = noticeOr404(user, params.id);
    db.prepare("UPDATE notices SET status='cerrado', resolution='descartado', resolved_at=datetime('now') WHERE id=?").run(n.id);
    return { ok: true };
  });

  // ===== novedades para el cliente =====
  add('GET', '/api/jobs/:id/updates', ({ user, params }) => {
    requireRole(user, 'owner', 'client');
    const job = jobOr404(db, user, intId(params.id));
    return { client: user.role === 'owner' ? clientOf(job) : undefined,
      updates: db.prepare('SELECT * FROM client_updates WHERE job_id=? ORDER BY id DESC LIMIT 50').all(job.id).map(u => {
        T.addTr(db, u, 'note', user.lang);
        // El dueño manda la novedad por WhatsApp en el idioma del cliente: se le da la nota ya traducida a ese idioma.
        if (user.role === 'owner' && u.note) { const r = T.forReader(db, u.note, clientOf(job).lang); if (r && r.tr) u.note_client = r.tr; }
        return u; }) };
  });
  add('POST', '/api/jobs/:id/updates', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const note = str(body.note, 600); if (!note) fail(400, 'Falta: mensaje');
    const id = clientUpdate(job.id, 'note', {}, note);
    return { id, row: db.prepare('SELECT * FROM client_updates WHERE id=?').get(id), client: clientOf(job) };
  });
  add('DELETE', '/api/updates/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const u = db.prepare('SELECT * FROM client_updates WHERE id=?').get(intId(params.id)); if (!u) fail(404, 'No encontrado');
    jobOr404(db, user, u.job_id);
    db.prepare('DELETE FROM client_updates WHERE id=?').run(u.id);
    return { ok: true };
  });

  // Para usar desde otras rutas (change orders, estado de obra).
  return { clientUpdate, clientOf };
};

module.exports.addDays = addDays;
