'use strict';
// Tablero del día: por cada obra activa, qué paso va hoy, cuál sigue y qué sub sigue (avisado / confirmado),
// atrasos, y los pendientes de la empresa (inspecciones, invoices, casos, tickets, autorizaciones).
const { notify, owners } = require('./push');
const { tzDate } = require('./pmreport');

const TZ = () => process.env.APP_TZ || 'America/Chicago';
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const endOf = t => t.planned_end || t.planned_date || '';

module.exports = function boardRoutes(db, add, h) {
  const { requireRole, fail, intId, canSeeJob } = h;
  const userInfo = id => id ? db.prepare('SELECT id, name, phone, lang, trade FROM users WHERE id=?').get(id) : null;

  function jobBoard(job, today) {
    const tasks = db.prepare('SELECT * FROM tasks WHERE job_id=? ORDER BY position, id').all(job.id);
    const open = tasks.filter(t => t.status !== 'hecho');
    const current = open.find(t => t.status === 'en_progreso') || open[0] || null;
    const after = current ? open.filter(t => t !== current && t.position >= current.position) : [];
    const next = after[0] || null;
    const todayTasks = open.filter(t => t.planned_date && t.planned_date <= today && endOf(t) >= today);
    const overdue = open.filter(t => endOf(t) && endOf(t) < today).map(t => ({ ...t, days_late: Math.round((Date.parse(today) - Date.parse(endOf(t))) / 864e5) }));
    const noticeOpen = id => db.prepare("SELECT status FROM notices WHERE task_id=? AND status IN ('enviado','respondido') ORDER BY id DESC LIMIT 1").get(id);
    const out = t => t && { id: t.id, title: t.title, status: t.status, planned_date: t.planned_date, planned_end: t.planned_end, assignee: userInfo(t.assignee_id),
      notified_at: t.notified_at || '', confirmed_at: t.confirmed_at || '', notice: (noticeOpen(t.id) || {}).status || '' };
    const alerts = [];
    if (!tasks.length) alerts.push({ kind: 'no_plan' });
    if (overdue.length) alerts.push({ kind: 'late', n: overdue.length, days: Math.max(...overdue.map(t => t.days_late)), title: overdue[0].title });
    if (next) {
      const soon = next.planned_date && next.planned_date <= addDays(today, 3);
      if (!next.assignee_id) alerts.push({ kind: 'no_sub', title: next.title });
      else if (soon && !next.confirmed_at) alerts.push({ kind: 'not_confirmed', title: next.title, who: (userInfo(next.assignee_id) || {}).name, date: next.planned_date, notified: !!next.notified_at });
    }
    const pm = job.pm_id ? userInfo(job.pm_id) : null;
    return { job_id: job.id, client_name: job.client_name, address: job.address, end_date: job.end_date, pm_name: pm ? pm.name : '',
      progress: { done: tasks.length - open.length, total: tasks.length },
      current: out(current), next: out(next), after_next: out(after[1] || null), today: todayTasks.map(out), overdue: overdue.map(t => ({ ...out(t), days_late: t.days_late })), alerts };
  }

  add('GET', '/api/board', ({ user }) => {
    requireRole(user, 'owner');
    const today = tzDate(TZ());
    const jobs = db.prepare("SELECT * FROM jobs WHERE status='activo' ORDER BY COALESCE(NULLIF(end_date,''),'9999'), client_name").all().filter(j => canSeeJob(db, user, j.id));
    const ids = new Set(jobs.map(j => j.id));
    const allVisible = db.prepare("SELECT id FROM jobs").all().filter(j => canSeeJob(db, user, j.id)).map(j => j.id);
    const vis = new Set(allVisible);
    const todo = {
      inspections: db.prepare(`SELECT p.id, p.job_id, p.name, p.kind, p.status, p.date, j.client_name FROM permits p JOIN jobs j ON j.id=p.job_id
        WHERE p.status IN ('programada','solicitado','pendiente','rechazado') AND p.date<>'' AND p.date<=? ORDER BY p.date`).all(addDays(today, 7)).filter(r => vis.has(r.job_id)),
      docs: db.prepare("SELECT d.id, d.job_id, d.number, d.type, d.total_cents, j.client_name, u.name sub_name FROM sub_docs d JOIN jobs j ON j.id=d.job_id LEFT JOIN users u ON u.id=d.sub_user_id WHERE d.status='enviado' OR d.unlock='pedido'").all().filter(r => vis.has(r.job_id)),
      cases: db.prepare("SELECT i.id, i.job_id, i.title, i.urgent, i.status, j.client_name FROM issues i JOIN jobs j ON j.id=i.job_id WHERE i.status<>'resuelto' ORDER BY i.urgent DESC, i.updated_at DESC").all().filter(r => vis.has(r.job_id)),
      notices: db.prepare("SELECT n.id, n.job_id, t.title, j.client_name, u.name who FROM notices n JOIN tasks t ON t.id=n.task_id JOIN jobs j ON j.id=n.job_id LEFT JOIN users u ON u.id=n.to_user_id WHERE n.status='respondido'").all().filter(r => vis.has(r.job_id)),
      scans: user.isPm ? db.prepare("SELECT COUNT(*) n FROM scans WHERE status='por_asignar' AND created_by=?").get(user.pmId).n : db.prepare("SELECT COUNT(*) n FROM scans WHERE status='por_asignar'").get().n,
      approvals: user.isPm ? 0 : db.prepare("SELECT COUNT(*) n FROM change_requests WHERE status='pendiente' AND user_id<>?").get(user.id).n,
      unpaid_invoices: user.isPm ? null : db.prepare("SELECT COUNT(*) n, COALESCE(SUM(d.total_cents - COALESCE((SELECT SUM(p.amount_cents) FROM sub_payments p WHERE p.doc_id=d.id),0)),0) v FROM sub_docs d WHERE d.type='invoice' AND d.status='aprobado' AND d.paid_at=''").get(),
    };
    return { today, jobs: jobs.map(j => jobBoard(j, today)), todo }; // (no se llama "pending": así se llaman las respuestas que esperan autorización)
  });

  // Avisar al siguiente sub (deja registro y le manda notificación; el WhatsApp lo manda la app desde el teléfono).
  add('POST', '/api/tasks/:id/notify', ({ user, params }) => {
    requireRole(user, 'owner');
    const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(intId(params.id));
    if (!t || !canSeeJob(db, user, t.job_id)) fail(404, 'Tarea no encontrada');
    if (!t.assignee_id) fail(400, 'Esta tarea no tiene sub asignado');
    db.prepare("UPDATE tasks SET notified_at=datetime('now') WHERE id=?").run(t.id);
    const job = db.prepare('SELECT client_name, address FROM jobs WHERE id=?').get(t.job_id);
    notify(db, t.assignee_id, 'next_task', { x: t.title, job: job.address || job.client_name, d: t.planned_date || '' }, `#/obra/${t.job_id}`);
    return { ok: true, assignee: userInfo(t.assignee_id), job, task: { id: t.id, title: t.title, planned_date: t.planned_date, planned_end: t.planned_end } };
  });

  // El sub confirma su próxima tarea.
  add('POST', '/api/tasks/:id/confirm', ({ user, params }) => {
    requireRole(user, 'worker');
    const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(intId(params.id));
    if (!t || t.assignee_id !== user.id) fail(404, 'Tarea no encontrada');
    db.prepare("UPDATE tasks SET confirmed_at=datetime('now') WHERE id=?").run(t.id);
    const job = db.prepare('SELECT client_name, address, pm_id FROM jobs WHERE id=?').get(t.job_id);
    notify(db, [...owners(db), job.pm_id].filter(Boolean), 'task_confirmed', { who: user.name, x: t.title, job: job.client_name, d: t.planned_date || '' }, '#/hoy');
    return { ok: true };
  });

  // Sub: sus próximas tareas (para confirmar).
  add('GET', '/api/my-next', ({ user }) => {
    requireRole(user, 'worker');
    const today = tzDate(TZ());
    return db.prepare(`SELECT t.id, t.title, t.planned_date, t.planned_end, t.status, t.confirmed_at, t.notified_at, j.id job_id, j.client_name, j.address
      FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE t.assignee_id=? AND t.status<>'hecho' AND j.status='activo' AND t.planned_date<>'' AND t.planned_date<=?
      ORDER BY t.planned_date LIMIT 10`).all(user.id, addDays(today, 14));
  });
};
