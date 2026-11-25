'use strict';
// Pagos a subs: cada pago con fecha, monto, forma de pago (Zelle, cheque, depósito directo…), referencia y nota.
//  - Pago a un INVOICE aprobado (puede ser parcial): el invoice ya es gasto de la obra, el pago no suma otro gasto.
//    Cuando lo pagado llega al total, el invoice queda "pagado" solo.
//  - Pago al ACUERDO de la obra (sin invoice): sí es gasto de la obra (se crea el gasto y la ganancia se recalcula).
const { tx } = require('./db');

const METHODS = ['Zelle', 'Cheque', 'Depósito directo', 'Transferencia', 'Efectivo', 'Tarjeta', 'Otro'];

function guessMethod(text) {
  const t = String(text || '').toLowerCase();
  if (/zelle/.test(t)) return 'Zelle';
  if (/che(que|ck)|#\d/.test(t)) return 'Cheque';
  if (/dep[oó]sito|direct dep|ach/.test(t)) return 'Depósito directo';
  if (/transfer|wire/.test(t)) return 'Transferencia';
  if (/efectivo|cash/.test(t)) return 'Efectivo';
  if (/tarjeta|card/.test(t)) return 'Tarjeta';
  return t ? 'Otro' : '';
}
const invoicePaid = (db, docId) => db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM sub_payments WHERE doc_id=?').get(docId).v;
// Deja el invoice como pagado / no pagado según la suma de sus pagos.
function syncInvoice(db, docId) {
  const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(docId); if (!d) return;
  const paid = invoicePaid(db, docId);
  if (paid >= d.total_cents && d.total_cents > 0) {
    const last = db.prepare('SELECT date, method FROM sub_payments WHERE doc_id=? ORDER BY date DESC, id DESC LIMIT 1').get(docId);
    db.prepare('UPDATE sub_docs SET paid_at=?, paid_method=? WHERE id=?').run(last.date, last.method, docId);
  } else db.prepare("UPDATE sub_docs SET paid_at='', paid_method='' WHERE id=?").run(docId);
}
// Pasa los pagos de versiones anteriores (gastos con sub e invoices marcados pagados) al registro nuevo. Se puede correr varias veces.
function migrate(db) {
  tx(db, () => {
    const legacy = db.prepare(`SELECT e.* FROM expenses e WHERE e.sub_id IS NOT NULL
      AND e.id NOT IN (SELECT expense_id FROM sub_docs WHERE expense_id IS NOT NULL)
      AND e.id NOT IN (SELECT expense_id FROM sub_payments WHERE expense_id IS NOT NULL)`).all();
    for (const e of legacy) {
      const s = db.prepare('SELECT job_id FROM subs WHERE id=?').get(e.sub_id); if (!s) continue;
      db.prepare('INSERT INTO sub_payments(sub_id,job_id,date,amount_cents,method,reference,note,expense_id,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(e.sub_id, s.job_id, e.date, e.amount_cents, guessMethod(e.vendor + ' ' + e.description), '', e.description || '', e.id, e.created_by);
    }
    for (const d of db.prepare("SELECT * FROM sub_docs WHERE type='invoice' AND status='aprobado' AND paid_at<>'' AND sub_id IS NOT NULL AND id NOT IN (SELECT doc_id FROM sub_payments WHERE doc_id IS NOT NULL)").all()) {
      db.prepare('INSERT INTO sub_payments(sub_id,job_id,doc_id,date,amount_cents,method,note,created_by) VALUES(?,?,?,?,?,?,?,?)')
        .run(d.sub_id, d.job_id, d.id, d.paid_at, d.total_cents, d.paid_method ? (METHODS.includes(d.paid_method) ? d.paid_method : guessMethod(d.paid_method) || 'Otro') : '', d.paid_method || '', d.decided_by);
    }
  });
}
// Registra un pago (usado por la ruta y por "Marcar pagado" de los invoices).
function addPayment(db, user, s, { docId = null, date, amount, method, reference = '', note = '' }) {
  let expenseId = null;
  if (!docId) {
    const desc = `Pago a ${s.name}${method ? ' · ' + method : ''}${reference ? ' ' + reference : ''}${note ? ' — ' + note : ''}`.slice(0, 300);
    expenseId = Number(db.prepare(`INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,sub_id,created_by) VALUES(?,?,'subcontratistas',?,?,?,?,?,?)`)
      .run(s.job_id, date, desc, s.name, user.name || '', amount, s.id, user.id).lastInsertRowid);
  }
  const id = Number(db.prepare('INSERT INTO sub_payments(sub_id,job_id,doc_id,date,amount_cents,method,reference,note,expense_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(s.id, s.job_id, docId, date, amount, method, reference, note, expenseId, user.id).lastInsertRowid);
  if (docId) syncInvoice(db, docId);
  return { id, expense_id: expenseId };
}
function summary(db, subId) {
  const s = db.prepare('SELECT * FROM subs WHERE id=?').get(subId);
  const payments = db.prepare(`SELECT p.*, d.number doc_number, u.name by_name FROM sub_payments p LEFT JOIN sub_docs d ON d.id=p.doc_id LEFT JOIN users u ON u.id=p.created_by
    WHERE p.sub_id=? ORDER BY p.date, p.id`).all(subId);
  const invoices = db.prepare("SELECT id, number, date, due_date, description, total_cents, paid_at FROM sub_docs WHERE sub_id=? AND type='invoice' AND status='aprobado' ORDER BY date, id").all(subId)
    .map(i => { const paid = invoicePaid(db, i.id); return { ...i, paid_cents: paid, remaining_cents: Math.max(0, i.total_cents - paid) }; });
  const paid = payments.reduce((a, p) => a + p.amount_cents, 0);
  return { sub: s, payments, invoices, agreed_cents: s.agreed_cents, paid_cents: paid, owed_cents: s.agreed_cents - paid,
    due_now_cents: invoices.reduce((a, i) => a + i.remaining_cents, 0) };
}

function routes(db, add, h) {
  const { requireRole, fail, str, needDate, cents, oneOf, intId, jobOr404, saveImage } = h;
  const subOr404 = (user, id) => { const s = db.prepare('SELECT * FROM subs WHERE id=?').get(intId(id)); if (!s) fail(404, 'No encontrado'); jobOr404(db, user, s.job_id); return s; };
  add('GET', '/api/subs/:id/payments', ({ user, params }) => {
    requireRole(user, 'owner');
    return { ...summary(db, subOr404(user, params.id).id), methods: METHODS };
  });
  add('POST', '/api/subs/:id/payments', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const s = subOr404(user, params.id);
    const amount = cents(body.amount_cents, 'monto');
    if (amount <= 0) fail(400, 'El monto debe ser mayor a 0');
    const date = needDate(body.date, 'fecha');
    const method = oneOf(body.method || 'Zelle', require('./lists').keys(db, 'pagosub'), 'forma de pago');
    const reference = str(body.reference, 80), note = str(body.note, 300);
    let docId = null;
    if (body.doc_id) {
      const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(intId(body.doc_id));
      if (!d || d.type !== 'invoice' || d.status !== 'aprobado' || d.sub_id !== s.id) fail(400, 'Ese invoice no es de este sub o no está aprobado');
      const left = d.total_cents - invoicePaid(db, d.id);
      if (amount > left) fail(400, `El pago es mayor que lo que falta del invoice (${(left / 100).toFixed(2)})`);
      docId = d.id;
    }
    return tx(db, () => {
      const r = addPayment(db, user, s, { docId, date, amount, method, reference, note });
      if (body.receipt) saveImage(db, user, { dataUrl: body.receipt, jobId: s.job_id, expenseId: r.expense_id, docId, kind: 'receipt', allowPdf: true });
      if (s.user_id) require('./push').notify(db, s.user_id, 'sub_paid', { x: '$' + (amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }), job: (db.prepare('SELECT client_name FROM jobs WHERE id=?').get(s.job_id) || {}).client_name || '' }, '#/mis-pagos');
      return { ...r, ...summary(db, s.id) };
    });
  });
  add('DELETE', '/api/sub-payments/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const p = db.prepare('SELECT * FROM sub_payments WHERE id=?').get(intId(params.id)); if (!p) fail(404, 'No encontrado');
    jobOr404(db, user, p.job_id);
    tx(db, () => {
      db.prepare('DELETE FROM sub_payments WHERE id=?').run(p.id);
      if (p.expense_id) db.prepare('DELETE FROM expenses WHERE id=?').run(p.expense_id);
      if (p.doc_id) syncInvoice(db, p.doc_id);
    });
    return { ok: true };
  });
}
module.exports = { METHODS, guessMethod, invoicePaid, syncInvoice, migrate, addPayment, summary, routes };
