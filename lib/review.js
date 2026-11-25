'use strict';
// v2.31: gastos que registra un sub o trabajador quedan "por revisar".
// Cuentan en la obra desde que se registran (es dinero real), pero un dueño o el PM de la obra los revisa:
// "Está bien" los da por buenos; si algo está mal, se corrige o se borra desde la obra (con motivo y bitácora).
const mark = (db, id) => db.prepare('UPDATE expenses SET review=1 WHERE id=?').run(id);

function routes(db, add, h) {
  const { requireRole, fail, intId, canSeeJob } = h;
  const list = user => db.prepare(`SELECT e.id, e.job_id, e.date, e.category, e.description, e.vendor, e.amount_cents, e.reimburse, e.created_at,
      u.name by_name, j.client_name, (SELECT f.id FROM files f WHERE f.expense_id=e.id LIMIT 1) file_id
    FROM expenses e JOIN jobs j ON j.id=e.job_id LEFT JOIN users u ON u.id=e.created_by WHERE e.review=1 ORDER BY e.id`).all()
    .filter(e => canSeeJob(db, user, e.job_id));
  add('GET', '/api/expenses/review', ({ user }) => { requireRole(user, 'owner'); return list(user); });
  add('POST', '/api/expenses/:id/reviewed', ({ user, params }) => {
    requireRole(user, 'owner');
    if (user.is_agent) fail(403, 'Un agente no revisa gastos: lo hace una persona');
    if (user.isOffice && user.office !== 'admin') fail(403, 'No autorizado');
    const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(intId(params.id));
    if (!e || !canSeeJob(db, user, e.job_id)) fail(404, 'No encontrado');
    if (!e.review) return { ok: true, already: true };
    const me = user.pmId || user.officeId || user.id;
    db.prepare("UPDATE expenses SET review=0, reviewed_by=?, reviewed_at=datetime('now') WHERE id=?").run(me, e.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary,amount_cents) VALUES(?,?,?,?,?,?,?)")
      .run(me, 'revisar', 'gasto', e.id, e.job_id, `Gasto revisado: ${e.description}`, e.amount_cents);
    return { ok: true };
  });
}
module.exports = { mark, routes };
