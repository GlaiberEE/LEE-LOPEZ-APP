'use strict';
const CO = db => require('./company').info(db);
// Estados de cuenta:
//  - Cliente: contrato (precio + change orders aprobados), pagos y saldo, con PDF. Lo ven los dueños y ese cliente.
//  - Subs: lo acordado, lo pagado (pagos directos + invoices marcados como pagados) y lo que se le debe.
//    Lo ven los dueños, y cada sub ve SOLO lo suyo (nunca costos ni ganancia de la empresa).
const { buildDocument } = require('./pdf');
const P = require('./printouts');
const SP = require('./subpay');

const LBL = {
  es: { stmt: 'ESTADO DE CUENTA', stmtSub: 'ESTADO DE CUENTA — SUB', contract: 'Precio del proyecto', co: 'Change order', pay: 'Pago recibido', payTo: 'Pago', inv: 'Invoice',
    move: 'Movimientos', total: 'Total del contrato', paid: 'Pagado', balance: 'SALDO PENDIENTE', agreed: 'Acordado', owed: 'POR PAGAR', dueNow: 'Invoices aprobados sin pagar',
    job: 'Obra', asOf: 'Al', notes: 'Si ve algún error, avísenos.', jobs: 'Obras', pending: 'sin pagar', paidOn: 'pagado' },
  en: { stmt: 'ACCOUNT STATEMENT', stmtSub: 'ACCOUNT STATEMENT — SUB', contract: 'Project price', co: 'Change order', pay: 'Payment received', payTo: 'Payment', inv: 'Invoice',
    move: 'Activity', total: 'Contract total', paid: 'Paid', balance: 'BALANCE DUE', agreed: 'Agreed', owed: 'OWED', dueNow: 'Approved invoices not yet paid',
    job: 'Job', asOf: 'As of', notes: 'If you see any error, please let us know.', jobs: 'Jobs', pending: 'unpaid', paidOn: 'paid' },
};

module.exports = function accountRoutes(db, add, h) {
  const { requireRole, fail, intId, jobOr404, today } = h;

  // ---------- Cliente ----------
  function clientStatement(job) {
    const moves = [];
    const start = job.start_date || (job.created_at || '').slice(0, 10) || today();
    moves.push({ date: start, kind: 'contract', desc: job.description ? job.description.split('\n')[0].slice(0, 120) : '', amount_cents: job.quoted_cents });
    for (const c of db.prepare("SELECT * FROM change_orders WHERE job_id=? AND status='aprobado' ORDER BY date, id").all(job.id))
      moves.push({ date: c.date, kind: 'change_order', desc: c.description, amount_cents: c.price_cents });
    for (const p of db.prepare('SELECT * FROM payments WHERE job_id=? ORDER BY date, id').all(job.id))
      moves.push({ date: p.date, kind: 'payment', desc: p.method || '', amount_cents: -p.amount_cents });
    moves.sort((a, b) => (a.kind === 'contract' ? -1 : b.kind === 'contract' ? 1 : a.date.localeCompare(b.date)));
    // El contrato va primero y con la fecha más antigua (a veces el anticipo llega antes de la fecha de inicio).
    const first = moves.slice(1).reduce((d, m) => (m.date < d ? m.date : d), moves[0].date);
    moves[0].date = first;
    let bal = 0; for (const m of moves) { bal += m.amount_cents; m.balance_cents = bal; }
    const contract = moves.filter(m => m.amount_cents > 0).reduce((a, m) => a + m.amount_cents, 0);
    const paid = -moves.filter(m => m.kind === 'payment').reduce((a, m) => a + m.amount_cents, 0);
    const pending = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(price_cents),0) v FROM change_orders WHERE job_id=? AND status='pendiente'").get(job.id);
    const lastPay = moves.filter(m => m.kind === 'payment').pop();
    return { job: { id: job.id, client_name: job.client_name, address: job.address, status: job.status }, moves,
      totals: { contract_cents: contract, paid_cents: paid, balance_cents: contract - paid, pct_paid: contract ? Math.round(paid * 100 / contract) : 0 },
      pending_change_orders: { count: pending.n, amount_cents: pending.v }, last_payment: lastPay ? lastPay.date : '' };
  }
  add('GET', '/api/jobs/:id/statement', ({ user, params }) => {
    requireRole(user, 'owner', 'client');
    return clientStatement(jobOr404(db, user, intId(params.id)));
  });
  add('GET', '/api/jobs/:id/statement/pdf', ({ user, params, query }) => {
    requireRole(user, 'owner', 'client');
    const job = jobOr404(db, user, intId(params.id));
    const lang = ['es', 'en'].includes(query.get('lang')) ? query.get('lang') : (user.lang === 'en' ? 'en' : 'es');
    const T = P.TXT[lang], X = LBL[lang], s = clientStatement(job);
    const kindLabel = m => m.kind === 'contract' ? X.contract : m.kind === 'change_order' ? X.co : X.pay;
    const spec = {
      title: X.stmt, number: '# P-' + String(job.id).padStart(4, '0'),
      from: [CO(db).name, CO(db).city], to: [job.client_name, job.address, job.client_phone, job.client_email],
      meta: [[X.asOf, P.fdate(today(), lang)]],
      sections: [{ heading: X.move, simple: true, rows: s.moves.map(m => ({ desc: `${P.fdate(m.date, lang)} · ${kindLabel(m)}${m.desc ? ' — ' + m.desc : ''}`, amount: m.amount_cents })) }],
      totals: [[X.total, s.totals.contract_cents], [X.paid, s.totals.paid_cents], [X.balance, s.totals.balance_cents, true]],
      notes: [X.notes], footer: `${T.generated} ${P.fdate(today(), lang)} · ${CO(db).name} · ${CO(db).city}`,
    };
    return { $buffer: buildDocument({ ...spec, logo: CO(db).logo, company: CO(db).name }, T), $type: 'application/pdf', $name: `Statement-${String(job.client_name).replace(/[^\w.-]+/g, '-').slice(0, 40)}.pdf` };
  });
  // Dueño: cuentas por cobrar de todas las obras.
  add('GET', '/api/receivables', ({ user }) => {
    requireRole(user, 'owner');
    const rows = db.prepare("SELECT * FROM jobs WHERE status IN ('activo','terminado','cotizado') ORDER BY client_name").all()
      .map(j => { const s = clientStatement(j); return { job_id: j.id, client_name: j.client_name, address: j.address, status: j.status, client_phone: j.client_phone,
        ...s.totals, last_payment: s.last_payment, days_since_payment: s.last_payment ? Math.round((Date.parse(today()) - Date.parse(s.last_payment)) / 864e5) : null }; })
      .filter(r => r.contract_cents > 0 && (r.status !== 'cotizado' || r.paid_cents > 0));
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    return { rows: rows.sort((a, b) => b.balance_cents - a.balance_cents), totals: { contract_cents: sum('contract_cents'), paid_cents: sum('paid_cents'), balance_cents: sum('balance_cents') } };
  });

  // ---------- Subs ----------
  // Un "acuerdo" es una fila de subs (un sub en una obra).
  function agreement(s) {
    const S = SP.summary(db, s.id);
    const job = db.prepare('SELECT id, client_name, address, status FROM jobs WHERE id=?').get(s.job_id) || {};
    const extras = db.prepare("SELECT id, number, type, date, description, total_cents FROM sub_docs WHERE sub_id=? AND type IN ('estimate','change_order') AND status='aceptado' AND added_to_agreed=1 ORDER BY date, id").all(s.id);
    return { sub_id: s.id, job_id: s.job_id, client_name: job.client_name, address: job.address, job_status: job.status, name: s.name, trade: s.trade, user_id: s.user_id,
      agreed_cents: S.agreed_cents, paid_cents: S.paid_cents, owed_cents: S.owed_cents, due_now_cents: S.due_now_cents,
      payments: S.payments.map(p => ({ id: p.id, date: p.date, amount_cents: p.amount_cents, method: p.method, reference: p.reference, note: p.note, doc_number: p.doc_number || '',
        desc: [p.doc_number ? 'Invoice ' + p.doc_number : '', p.method, p.reference].filter(Boolean).join(' · '), kind: p.doc_id ? 'invoice' : 'pago' })),
      invoices: S.invoices.map(i => ({ ...i, paid_at: i.remaining_cents === 0 ? (i.paid_at || i.date) : '' })), extras };
  }
  const groupKey = s => s.user_id ? `u${s.user_id}` : `n${s.name.trim().toLowerCase()}`;
  function payables(filter) {
    const groups = {};
    for (const s of db.prepare("SELECT s.* FROM subs s JOIN jobs j ON j.id=s.job_id WHERE j.status<>'cancelado'").all()) {
      if (filter && !filter(s)) continue;
      const a = agreement(s);
      const g = groups[groupKey(s)] ||= { key: groupKey(s), name: s.name, trade: s.trade, user_id: s.user_id, agreed_cents: 0, paid_cents: 0, owed_cents: 0, due_now_cents: 0, jobs: [] };
      g.agreed_cents += a.agreed_cents; g.paid_cents += a.paid_cents; g.owed_cents += a.owed_cents; g.due_now_cents += a.due_now_cents; g.jobs.push(a);
    }
    return Object.values(groups).sort((a, b) => b.due_now_cents - a.due_now_cents || b.owed_cents - a.owed_cents);
  }
  add('GET', '/api/payables', ({ user }) => {
    requireRole(user, 'owner');
    const list = payables();
    const sum = k => list.reduce((a, g) => a + g[k], 0);
    return { subs: list.map(g => ({ ...g, jobs: g.jobs.map(({ invoices, extras, ...r }) => r) })),
      totals: { agreed_cents: sum('agreed_cents'), paid_cents: sum('paid_cents'), owed_cents: sum('owed_cents'), due_now_cents: sum('due_now_cents') } };
  });
  const subStatement = (user, key) => {
    if (user.role === 'worker') key = `u${user.id}`; // el sub solo ve lo suyo
    const g = payables(s => groupKey(s) === key)[0];
    if (!g) return { name: user.role === 'worker' ? user.name : '', jobs: [], agreed_cents: 0, paid_cents: 0, owed_cents: 0, due_now_cents: 0 };
    return g;
  };
  add('GET', '/api/subs/statement', ({ user, query }) => {
    requireRole(user, 'owner', 'worker');
    return subStatement(user, String(query.get('key') || ''));
  });
  add('GET', '/api/subs/statement/pdf', ({ user, query }) => {
    requireRole(user, 'owner', 'worker');
    const g = subStatement(user, String(query.get('key') || ''));
    if (!g.jobs.length) fail(404, 'No encontrado');
    const lang = ['es', 'en'].includes(query.get('lang')) ? query.get('lang') : (user.lang === 'en' ? 'en' : 'es');
    const T = P.TXT[lang], X = LBL[lang];
    const sections = g.jobs.map(a => ({ heading: `${X.job}: ${a.client_name}${a.address ? ' — ' + a.address : ''}`, simple: true,
      rows: [{ desc: X.agreed, amount: a.agreed_cents },
        ...a.payments.map(p => ({ desc: `${P.fdate(p.date, lang)} · ${X.payTo}${p.desc ? ' — ' + p.desc : ''}`, amount: -p.amount_cents })),
        ...a.invoices.filter(i => i.remaining_cents > 0).map(i => ({ desc: `${P.fdate(i.date, lang)} · ${X.inv} ${i.number} (${X.pending}: ${(i.remaining_cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`, amount: i.total_cents, muted: true }))],
      total: a.owed_cents, totalLabel: X.owed }));
    const spec = { title: X.stmtSub, number: g.trade || '', from: [CO(db).name, CO(db).city], to: [g.name, g.trade],
      meta: [[X.asOf, P.fdate(today(), lang)], [X.jobs, String(g.jobs.length)]], sections,
      totals: [[X.agreed, g.agreed_cents], [X.paid, g.paid_cents], ...(g.due_now_cents ? [[X.dueNow, g.due_now_cents]] : []), [X.owed, g.owed_cents, true]],
      notes: [X.notes], footer: `${T.generated} ${P.fdate(today(), lang)} · ${CO(db).name}` };
    return { $buffer: buildDocument({ ...spec, logo: CO(db).logo, company: CO(db).name }, T), $type: 'application/pdf', $name: `Statement-${String(g.name).replace(/[^\w.-]+/g, '-').slice(0, 40)}.pdf` };
  });
};
