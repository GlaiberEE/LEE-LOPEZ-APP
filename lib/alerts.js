'use strict';
// Avisos push después de cada acción importante. Se ejecutan DESPUÉS de que la acción salió bien
// y nunca la hacen fallar. Cada aviso va a quien le toca, en su idioma (ver push.js).
const { notify, owners } = require('./push');

module.exports = function after(db, key, ctx, res) {
  const { user, params = {} } = ctx;
  if (/\/api\/tasks|\/api\/board|\/reschedule|\/api\/notices/.test(key)) { try { require('./billing').check(db); } catch (e) { console.error('[cobros]', e.message); } }
  if (!user) return;
  const job = id => db.prepare('SELECT id, client_name, client_user_id FROM jobs WHERE id=?').get(id) || { client_name: '' };
  // Todos los que participan en un caso por parte de la empresa y los subs del caso.
  const caseCrew = i => { const j = db.prepare('SELECT pm_id FROM jobs WHERE id=?').get(i.job_id) || {};
    return [...new Set([...owners(db), j.pm_id, i.assignee_id, ...require('./issues').membersOf(db, i)].filter(Boolean))]; };
  // A los subs el aviso los lleva a la obra (no tienen la pantalla de Casos).
  const sendCase = (i, ids, kind, v) => { const w = require('./issues').membersOf(db, i);
    notify(db, ids.filter(id => !w.includes(id)), kind, v, '#/casos'); notify(db, ids.filter(id => w.includes(id)), kind, v, `#/obra/${i.job_id}`); };
  const H = {
    // Casos: le avisa a todos los que participan (dueños, PM de la obra, responsable, subs del caso), menos a quien escribió.
    'POST /api/issues': () => {
      const i = db.prepare('SELECT * FROM issues WHERE id=?').get(res && res.id); if (!i) return;
      const v = { x: i.title, who: user.name, job: job(i.job_id).client_name };
      const me = user.pmId || user.id;
      const crew = caseCrew(i).filter(id => id !== me && id !== i.assignee_id);
      sendCase(i, crew, 'issue_new', v);
      if (i.assignee_id && i.assignee_id !== me) sendCase(i, [i.assignee_id], 'issue_assigned', { ...v, d: i.due_date ? ' · ' + i.due_date : '' });
      if (i.client_visible && user.role !== 'client') notify(db, job(i.job_id).client_user_id, 'issue_new', v, '#/');
    },
    'POST /api/issues/:id/messages': () => {
      const i = db.prepare('SELECT * FROM issues WHERE id=?').get(Number(params.id)); if (!i) return;
      const m = db.prepare('SELECT visibility FROM issue_messages WHERE id=?').get(res && res.id) || {};
      const v = { x: i.title, who: user.name, job: job(i.job_id).client_name };
      const me = user.pmId || user.id;
      const workers = require('./issues').membersOf(db, i);
      const company = caseCrew(i).filter(id => !workers.includes(id));
      const to = m.visibility === 'interno' ? caseCrew(i) : company;
      sendCase(i, to.filter(id => id !== me), 'issue_msg', v);
      if (m.visibility === 'cliente' && user.role !== 'client') notify(db, job(i.job_id).client_user_id, 'issue_msg', v, '#/');
    },
    'PUT /api/issues/:id/plan': () => {
      if (!res || !res.changed_assignee || !res.assignee_id || res.assignee_id === (user.pmId || user.id)) return;
      const i = db.prepare('SELECT * FROM issues WHERE id=?').get(Number(params.id)); if (!i) return;
      sendCase(i, [res.assignee_id], 'issue_assigned', { x: i.title, job: job(i.job_id).client_name, d: i.due_date ? ' · ' + i.due_date : '' });
    },
    'POST /api/issues/:id/members': () => {
      if (!res || !res.added) return;
      const i = db.prepare('SELECT * FROM issues WHERE id=?').get(Number(params.id)); if (!i) return;
      sendCase(i, [res.user_id], 'issue_added', { x: i.title, who: user.name, job: job(i.job_id).client_name });
    },
    'POST /api/docs': () => {
      if (user.role !== 'worker') return;
      const d = db.prepare('SELECT * FROM sub_docs WHERE sub_user_id=? ORDER BY id DESC LIMIT 1').get(user.id); if (!d) return;
      notify(db, owners(db), 'doc_new', { who: user.name, x: d.number, job: job(d.job_id).client_name }, '#/');
    },
    'PUT /api/docs/:id': () => {
      if (user.role !== 'worker') return;
      const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(Number(params.id)); if (!d) return;
      notify(db, owners(db), 'doc_new', { who: user.name, x: d.number, job: job(d.job_id).client_name }, '#/');
    },
    'POST /api/docs/:id/unlock': () => {
      const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(Number(params.id)); if (!d) return;
      notify(db, owners(db), 'doc_unlock', { who: user.name, x: d.number, job: job(d.job_id).client_name }, '#/');
    },
    'POST /api/docs/:id/decide': () => {
      const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(Number(params.id)); if (!d || !d.sub_user_id) return;
      if (!['aceptado', 'aprobado', 'rechazado'].includes(d.status)) return;
      const r = { aceptado: ['aceptado', 'accepted'], aprobado: ['aprobado', 'approved'], rechazado: ['rechazado', 'rejected'] }[d.status];
      const u = db.prepare('SELECT lang FROM users WHERE id=?').get(d.sub_user_id) || {};
      notify(db, d.sub_user_id, 'doc_decided', { x: d.number, r: r[u.lang === 'en' ? 1 : 0], job: job(d.job_id).client_name }, '#/docs');
    },
    'POST /api/docs/:id/unlock-decide': () => {
      const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(Number(params.id)); if (!d || !d.sub_user_id || d.unlock === 'pedido') return;
      const ok = d.unlock === 'autorizado';
      const u = db.prepare('SELECT lang FROM users WHERE id=?').get(d.sub_user_id) || {};
      notify(db, d.sub_user_id, 'doc_decided', { x: d.number, r: u.lang === 'en' ? (ok ? 'unlocked for changes' : 'not unlocked') : (ok ? 'autorizado para corregir' : 'no autorizado para corregir'), job: job(d.job_id).client_name }, '#/docs');
    },
    'POST /api/tasks/:id/reschedule': () => {
      for (const n of db.prepare("SELECT n.*, t.title FROM notices n JOIN tasks t ON t.id=n.task_id WHERE n.created_by=? AND n.status='enviado' AND n.created_at >= datetime('now','-1 minute')").all(user.id)) {
        notify(db, n.to_user_id, 'notice_sub', { x: n.title, job: job(n.job_id).client_name }, '#/');
      }
    },
    'POST /api/tasks/:id/delay': () => {
      const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(params.id)); if (!t) return;
      notify(db, owners(db), 'notice_owner', { who: user.name, x: t.title, job: job(t.job_id).client_name }, '#/');
    },
    'POST /api/notices/:id/respond': () => {
      const n = db.prepare('SELECT n.*, t.title FROM notices n JOIN tasks t ON t.id=n.task_id WHERE n.id=?').get(Number(params.id)); if (!n) return;
      notify(db, owners(db), 'notice_owner', { who: user.name, x: n.title, job: job(n.job_id).client_name }, '#/');
    },
    'POST /api/scans': () => {
      if (user.role !== 'worker' || !res || res.status !== 'por_asignar') return;
      notify(db, owners(db), 'scan_todo', { who: user.name }, '#/');
    },
  };
  // Presupuesto: revisar después de cualquier cosa que agregue o cambie un gasto.
  const bc = jobId => { if (jobId) require('./pro').budgetCheck(db, jobId); };
  const exp = id => (db.prepare('SELECT job_id FROM expenses WHERE id=?').get(id) || {}).job_id;
  // Pagos a subs registrados como gasto a la antigua: pasarlos al registro de pagos.
  if (key === 'POST /api/jobs/:id/expenses' || key === 'PUT /api/expenses/:id') {
    try {
      const SP = require('./subpay'); SP.migrate(db);
      if (key === 'PUT /api/expenses/:id') {
        const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(Number(params.id));
        if (e) db.prepare('UPDATE sub_payments SET amount_cents=?, date=?, sub_id=COALESCE(?, sub_id) WHERE expense_id=?').run(e.amount_cents, e.date, e.sub_id, e.id);
        if (e && !e.sub_id) db.prepare('DELETE FROM sub_payments WHERE expense_id=?').run(e.id);
      }
    } catch (x) { console.error('[pagos subs]', x.message); }
  }
  // Si cambian las fechas, la confirmación del sub ya no vale: tiene que volver a confirmar.
  try {
    if (key === 'PUT /api/tasks/:id' && ctx.body && ('planned_date' in ctx.body || 'planned_end' in ctx.body || 'assignee_id' in ctx.body))
      db.prepare("UPDATE tasks SET confirmed_at='', notified_at='' WHERE id=?").run(Number(params.id));
    if (key === 'POST /api/tasks/:id/reschedule' || key === 'POST /api/notices/:id/accept') {
      const jid = key.includes('tasks') ? (db.prepare('SELECT job_id FROM tasks WHERE id=?').get(Number(params.id)) || {}).job_id : (db.prepare('SELECT job_id FROM notices WHERE id=?').get(Number(params.id)) || {}).job_id;
      if (jid) db.prepare("UPDATE tasks SET confirmed_at='' WHERE job_id=? AND status<>'hecho'").run(jid);
    }
  } catch (x) { console.error('[confirmación]', x.message); }
  require('./materials').autoGallery(db, key, ctx);
  const budgetKeys = {
    'POST /api/jobs/:id/expenses': () => bc(Number(params.id)),
    'PUT /api/expenses/:id': () => bc(exp(Number(params.id))),
    'POST /api/scans': () => res && res.job_id && res.status === 'guardado' && bc(res.job_id),
    'POST /api/scans/:id/file': () => res && bc(res.job_id),
    'POST /api/scans/:id/move': () => res && bc(res.job_id),
    'POST /api/docs/:id/decide': () => bc((db.prepare('SELECT job_id FROM sub_docs WHERE id=?').get(Number(params.id)) || {}).job_id),
  };
  if (budgetKeys[key]) { try { budgetKeys[key](); } catch (e) { console.error('[presupuesto]', e.message); } }
  const f = H[key];
  if (f) { try { f(); } catch (e) { console.error('[aviso]', e.message); } }
};
