'use strict';
// Propuesta al cliente (estimado por partidas, PDF bilingüe, firma en línea sin cuenta) y cobros por etapas.
//  - La propuesta usa las partidas de la obra: el cliente ve cada partida con su precio, nunca el costo.
//  - El cliente firma desde un enlace (/propuesta.html?t=…). Al firmar: la obra pasa a "En obra", se fija el
//    contrato y su calendario de pagos.
//  - Calendario de pagos: cada etapa tiene un % del contrato y un "cuándo": al firmar, al terminar una tarea, o a mano.
//    Cuando se cumple, la app avisa "toca cobrar". El dueño factura (PDF) y se lo manda al cliente.
//    Si una etapa facturada pasa su fecha sin pagarse, sale como vencida.
//  - Lo pagado sale de los pagos del cliente que ya se registran (se aplican en orden a las etapas).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { notify, owners } = require('./push');
const { buildDocument, money: fmtMoney } = require('./pdf');

const getMeta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
const TZ = process.env.APP_TZ || 'America/Chicago';
const todayL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const CO = db => require('./company').info(db);

const DEFAULT_TERMS = {
  es: 'Precio total por el trabajo descrito. Cualquier trabajo adicional se hace con change order firmado antes de empezarlo. Los permisos de la ciudad están incluidos cuando se indica en el alcance. Todo el trabajo tiene garantía de 1 año a partir de la fecha de terminación.',
};
const DEFAULT_SCHEDULE = [
  { label: 'Anticipo al firmar', pct: 30, trigger: 'firma' },
  { label: 'Al terminar la estructura', pct: 40, trigger: 'manual' },
  { label: 'Al terminar la obra', pct: 30, trigger: 'manual' },
];

const T = {
  es: { proposal: 'PROPUESTA', invoice: 'INVOICE', scope: 'Alcance del trabajo', schedule: 'Calendario de pagos', total: 'TOTAL', date: 'Fecha', valid: 'Válida hasta', due: 'Pagar antes del',
    from: 'De', to: 'Para', details: 'Datos', desc: 'Descripción', qty: 'Cant.', price: 'Precio', amount: 'Importe', subtotal: 'Subtotal', terms: 'Condiciones', client: 'Firma del cliente / fecha',
    company: '{c} / fecha', eSigned: 'Firmado electrónicamente por {n} el {d}', code: 'Código de verificación: {c}', stage: 'Etapa', ofContract: '{p}% del contrato', cos: 'Change orders aprobados',
    thisInvoice: 'Este invoice', contract: 'Contrato total (con change orders)', paid: 'Pagado hasta hoy', balance: 'Saldo total del proyecto', payInfo: 'Cómo pagar', thanks: 'Gracias por su confianza.',
    onSign: 'al firmar', onTask: 'al terminar: {t}', manual: 'según avance' },
  en: { proposal: 'PROPOSAL', invoice: 'INVOICE', scope: 'Scope of work', schedule: 'Payment schedule', total: 'TOTAL', date: 'Date', valid: 'Valid until', due: 'Due by',
    from: 'From', to: 'To', details: 'Details', desc: 'Description', qty: 'Qty', price: 'Price', amount: 'Amount', subtotal: 'Subtotal', terms: 'Terms', client: 'Client signature / date',
    company: '{c} / date', eSigned: 'Electronically signed by {n} on {d}', code: 'Verification code: {c}', stage: 'Stage', ofContract: '{p}% of contract', cos: 'Approved change orders',
    thisInvoice: 'This invoice', contract: 'Contract total (with change orders)', paid: 'Paid to date', balance: 'Project balance', payInfo: 'How to pay', thanks: 'Thank you for your business.',
    onSign: 'at signing', onTask: 'when done: {t}', manual: 'per progress' },
};
const fill = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const fdate = (s, lang) => s ? new Date(String(s).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';

function lines(db, jobId) {
  return db.prepare("SELECT id, code, trade, description, sold_cents, est_cost_cents, position FROM job_lines WHERE job_id=? AND status<>'cancelado' ORDER BY position, id").all(jobId);
}
function schedule(db, jobId) { return db.prepare('SELECT * FROM payment_milestones WHERE job_id=? ORDER BY position, id').all(jobId); }
function proposalText(db, job) {
  return JSON.stringify({ job: job.id, d: job.description || '', terms: job.proposal_terms || '', l: lines(db, job.id).map(l => [l.trade, l.description, l.sold_cents]),
    s: schedule(db, job.id).map(m => [m.label, m.pct]) });
}
const total = (db, jobId) => lines(db, jobId).reduce((a, l) => a + l.sold_cents, 0);
const cosApproved = (db, jobId) => db.prepare("SELECT COALESCE(SUM(price_cents),0) c FROM change_orders WHERE job_id=? AND status='aprobado'").get(jobId).c;
const paidTotal = (db, jobId) => db.prepare('SELECT COALESCE(SUM(amount_cents),0) c FROM payments WHERE job_id=?').get(jobId).c;
const trigLabel = (db, m, lang) => m.trigger === 'firma' ? T[lang].onSign : m.trigger === 'tarea' ? fill(T[lang].onTask, { t: (db.prepare('SELECT title FROM tasks WHERE id=?').get(m.task_id) || {}).title || '' }) : T[lang].manual;

// Estado de cada etapa: pendiente → por_cobrar → facturado → pagado (o vencido).
function billing(db, jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  const ms = schedule(db, jobId);
  const contract = job.quoted_cents || total(db, jobId);
  const cos = cosApproved(db, jobId);
  let paidLeft = paidTotal(db, jobId);
  const last = ms.length ? ms[ms.length - 1].id : null;
  const today = todayL();
  const out = ms.map(m => {
    const base = m.amount_cents || Math.round(contract * m.pct / 100);
    const amount = base + (m.id === last ? cos : 0);
    const covered = Math.min(amount, Math.max(0, paidLeft)); paidLeft -= amount;
    const paid = amount > 0 && covered >= amount;
    const status = paid ? 'pagado' : m.invoiced_at ? (m.due_date && m.due_date < today ? 'vencido' : 'facturado') : m.ready_at ? 'por_cobrar' : 'pendiente';
    return { id: m.id, position: m.position, label: m.label, pct: m.pct, trigger: m.trigger, task_id: m.task_id, amount_cents: amount, base_cents: base, cos_cents: m.id === last ? cos : 0,
      covered_cents: covered, status, ready_at: m.ready_at, invoice_number: m.invoice_number, invoiced_at: m.invoiced_at, due_date: m.due_date };
  });
  const paid = paidTotal(db, jobId);
  return { job_id: jobId, contract_cents: contract, cos_cents: cos, total_cents: contract + cos, paid_cents: paid, balance_cents: contract + cos - paid,
    invoiced_cents: out.filter(m => m.invoice_number).reduce((a, m) => a + m.amount_cents, 0), milestones: out, signed: !!job.proposal_signed_at };
}

// Revisa qué etapas ya se cumplieron (tareas terminadas) y avisa "toca cobrar".
function check(db) {
  const rows = db.prepare(`SELECT m.*, j.client_name, j.pm_id FROM payment_milestones m JOIN jobs j ON j.id=m.job_id
    WHERE m.ready_at='' AND j.proposal_signed_at<>'' AND j.status NOT IN ('cancelado') AND (m.trigger='firma' OR (m.trigger='tarea' AND m.task_id IN (SELECT id FROM tasks WHERE status='hecho')))`).all();
  for (const m of rows) {
    db.prepare("UPDATE payment_milestones SET ready_at=datetime('now') WHERE id=?").run(m.id);
    const b = billing(db, m.job_id).milestones.find(x => x.id === m.id);
    if (b && b.status !== 'pagado') notify(db, owners(db), 'bill_ready', { x: m.label, job: m.client_name, n: fmtMoney(b.amount_cents) }, `#/obra/${m.job_id}/propuesta`);
  }
}

function proposalPdf(db, job, lang) {
  const L = T[lang], co = CO(db), ls = lines(db, job.id), tot = total(db, job.id);
  const sig = job.proposal_signed_at ? db.prepare("SELECT * FROM signatures WHERE job_id=? AND target='estimate' ORDER BY id DESC LIMIT 1").get(job.id) : null;
  let sigImg = null; if (sig) { const f = path.join(db.$sigDir || '', `${sig.id}.jpg`); try { sigImg = fs.readFileSync(f); } catch { /* */ } }
  return buildDocument({
    title: L.proposal, number: `P-${String(job.id).padStart(4, '0')}`, logo: co.logo, company: co.name, badge: job.proposal_signed_at ? (lang === 'en' ? 'SIGNED' : 'FIRMADA') : '',
    from: [co.name, co.city || '', getMeta(db, 'company_phone') || ''], to: [job.client_name, job.address, job.client_phone, job.client_email],
    meta: [[L.date, fdate(job.estimate_sent_date || todayL(), lang)], ...(job.proposal_valid_until ? [[L.valid, fdate(job.proposal_valid_until, lang)]] : [])],
    description: job.description || '',
    sections: [
      { heading: L.scope, simple: true, rows: ls.map(l => ({ desc: l.trade, note: l.description, amount: l.sold_cents })) },
      { heading: L.schedule, simple: true, rows: schedule(db, job.id).map(m => ({ desc: `${m.label} — ${fill(L.ofContract, { p: m.pct })}`, note: trigLabel(db, m, lang), amount: Math.round(tot * m.pct / 100) })) },
    ],
    totals: [[L.total, tot, true]],
    notes: [job.proposal_terms ? `${L.terms}: ${job.proposal_terms}` : ''],
    signatures: [sig ? { label: L.client, image: sigImg, lines: [fill(L.eSigned, { n: sig.signer_name, d: fdate(sig.signed_at, lang) }), fill(L.code, { c: sig.doc_hash.slice(0, 16) })] } : L.client, fill(L.company, { c: co.name })],
    footer: `${co.name} · ${L.proposal} P-${String(job.id).padStart(4, '0')}`,
  }, L);
}
function invoicePdf(db, job, msId, lang) {
  const L = T[lang], co = CO(db), b = billing(db, job.id), m = b.milestones.find(x => x.id === msId);
  if (!m || !m.invoice_number) return null;
  const rows = [{ desc: `${m.label} — ${fill(L.ofContract, { p: m.pct })}`, amount: m.base_cents }];
  if (m.cos_cents) rows.push({ desc: L.cos, amount: m.cos_cents });
  return buildDocument({
    title: L.invoice, number: m.invoice_number, logo: co.logo, company: co.name, badge: m.status === 'pagado' ? (lang === 'en' ? 'PAID' : 'PAGADO') : '',
    from: [co.name, co.city || '', getMeta(db, 'company_phone') || ''], to: [job.client_name, job.address],
    meta: [[L.date, fdate(m.invoiced_at, lang)], [L.due, fdate(m.due_date, lang)], [lang === 'en' ? 'Project' : 'Proyecto', `P-${String(job.id).padStart(4, '0')}`]],
    sections: [{ simple: true, rows }],
    totals: [[L.thisInvoice, m.amount_cents, true], [L.contract, b.total_cents], [L.paid, b.paid_cents], [L.balance, b.balance_cents]],
    notes: [getMeta(db, 'pay_info') ? `${L.payInfo}: ${getMeta(db, 'pay_info')}` : '', L.thanks],
    footer: `${co.name} · ${m.invoice_number}`,
  }, L);
}

module.exports = function billingRoutes(db, add, h) {
  const { requireRole, fail, str, intId, need, jobOr404, canSeeJob, sigDir } = h;
  db.$sigDir = sigDir;
  const owner = u => { requireRole(u, 'owner'); if (u.isPm || u.is_agent) fail(403, 'Esto solo lo pueden hacer los dueños'); };
  const pubUrl = (job, extra = '') => `/propuesta.html?t=${job.proposal_token}${CO(db).primary ? '' : '&co=' + CO(db).key}${extra}`;
  const ensureToken = job => {
    if (job.proposal_token) return job.proposal_token;
    const t = crypto.randomBytes(18).toString('base64url');
    db.prepare('UPDATE jobs SET proposal_token=? WHERE id=?').run(t, job.id); job.proposal_token = t; return t;
  };
  const ensureSchedule = job => {
    if (schedule(db, job.id).length) return;
    DEFAULT_SCHEDULE.forEach((s, i) => db.prepare('INSERT INTO payment_milestones(job_id,position,label,pct,trigger) VALUES(?,?,?,?,?)').run(job.id, i + 1, s.label, s.pct, s.trigger));
  };
  const alertPct = () => require('./lines').marginAlert(db);
  const clientLang = job => (job.client_user_id && (db.prepare('SELECT lang FROM users WHERE id=?').get(job.client_user_id) || {}).lang) || 'en';

  // ===== propuesta (dueños) =====
  add('GET', '/api/jobs/:id/proposal', ({ user, params }) => {
    owner(user);
    const job = jobOr404(db, user, intId(params.id));
    ensureSchedule(job);
    const ls = lines(db, job.id), tot = ls.reduce((a, l) => a + l.sold_cents, 0), cost = ls.reduce((a, l) => a + l.est_cost_cents, 0);
    const sig = job.proposal_signed_at ? db.prepare("SELECT signer_name, signed_at FROM signatures WHERE job_id=? AND target='estimate' ORDER BY id DESC LIMIT 1").get(job.id) : null;
    return { job: { id: job.id, client_name: job.client_name, client_phone: job.client_phone, client_email: job.client_email, address: job.address, status: job.status, description: job.description || '' },
      lines: ls.map(l => ({ ...l, margin_pct: l.sold_cents ? Math.round((l.sold_cents - l.est_cost_cents) / l.sold_cents * 1000) / 10 : null })),
      total_cents: tot, est_cost_cents: cost, margin_pct: tot ? Math.round((tot - cost) / tot * 1000) / 10 : null, alert_pct: alertPct(),
      terms: job.proposal_terms || DEFAULT_TERMS.es, valid_until: job.proposal_valid_until || '', sent_at: job.estimate_sent_date || '', link: job.proposal_token ? pubUrl(job) : '',
      signed: sig ? { name: sig.signer_name, at: sig.signed_at } : null, changed_after_send: !!(job.proposal_sent_hash && job.proposal_sent_hash !== sha(proposalText(db, job)) && !sig),
      schedule: schedule(db, job.id).map(m => ({ id: m.id, label: m.label, pct: m.pct, trigger: m.trigger, task_id: m.task_id })),
      tasks: db.prepare('SELECT id, title FROM tasks WHERE job_id=? ORDER BY position, id').all(job.id), client_lang: clientLang(job) };
  });

  add('PUT', '/api/jobs/:id/proposal', ({ user, params, body }) => {
    owner(user);
    const job = jobOr404(db, user, intId(params.id));
    if ('description' in body) db.prepare('UPDATE jobs SET description=? WHERE id=?').run(str(body.description, 4000), job.id);
    if ('terms' in body) db.prepare('UPDATE jobs SET proposal_terms=? WHERE id=?').run(str(body.terms, 4000), job.id);
    if ('valid_until' in body) db.prepare('UPDATE jobs SET proposal_valid_until=? WHERE id=?').run(/^\d{4}-\d{2}-\d{2}$/.test(String(body.valid_until)) ? body.valid_until : '', job.id);
    if (Array.isArray(body.schedule)) {
      const rows = body.schedule.map(s => ({ label: need(s.label, 'etapa', 120), pct: Math.round(Number(s.pct) * 100) / 100, trigger: ['firma', 'tarea', 'manual'].includes(s.trigger) ? s.trigger : 'manual', task_id: s.trigger === 'tarea' ? intId(s.task_id) : null }));
      if (!rows.length || rows.length > 12) fail(400, 'El calendario de pagos debe tener de 1 a 12 etapas');
      if (rows.some(r => !(r.pct > 0 && r.pct <= 100))) fail(400, 'Porcentaje inválido');
      if (Math.abs(rows.reduce((a, r) => a + r.pct, 0) - 100) > 0.01) fail(400, 'Los porcentajes deben sumar 100%');
      for (const r of rows) if (r.trigger === 'tarea' && !db.prepare('SELECT 1 FROM tasks WHERE id=? AND job_id=?').get(r.task_id, job.id)) fail(400, 'Tarea no encontrada');
      const old = schedule(db, job.id);
      if (old.some(m => m.invoice_number)) fail(400, 'Ya hay etapas facturadas: el calendario ya no se puede cambiar');
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM payment_milestones WHERE job_id=?').run(job.id);
        const fixed = job.proposal_signed_at ? job.quoted_cents : 0;
        rows.forEach((r, i) => db.prepare('INSERT INTO payment_milestones(job_id,position,label,pct,trigger,task_id,amount_cents) VALUES(?,?,?,?,?,?,?)')
          .run(job.id, i + 1, r.label, r.pct, r.trigger, r.task_id, fixed ? Math.round(fixed * r.pct / 100) : 0));
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      if (job.proposal_signed_at) check(db);
    }
    return { ok: true };
  });

  add('POST', '/api/jobs/:id/proposal/send', ({ user, params }) => {
    owner(user);
    const job = jobOr404(db, user, intId(params.id));
    if (job.proposal_signed_at) fail(400, 'La propuesta ya está firmada');
    ensureSchedule(job);
    const tot = total(db, job.id);
    if (!tot) fail(400, 'Agregue las partidas con su precio antes de mandar la propuesta');
    ensureToken(job);
    const t = todayL();
    const fresh = db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id);
    db.prepare("UPDATE jobs SET status=CASE WHEN status IN ('prospecto','cotizado') THEN 'cotizado' ELSE status END, quoted_cents=?, estimate_sent_date=?, follow_up_date=?, lead_new=0, proposal_sent_hash=? WHERE id=?")
      .run(tot, t, addDays(t, 3), sha(proposalText(db, fresh)), job.id);
    db.prepare('INSERT INTO sales_events(job_id,user_id,kind,note,amount_cents,next_date) VALUES(?,?,?,?,?,?)').run(job.id, user.id, 'enviado', 'Propuesta mandada desde la app', tot, addDays(t, 3));
    const co = CO(db);
    return { client_lang: clientLang(job), url: pubUrl(job), total_cents: tot, client_phone: job.client_phone, client_email: job.client_email, client_name: job.client_name, company: co.name };
  });

  add('GET', '/api/jobs/:id/proposal/pdf', ({ user, params, query }) => {
    owner(user);
    const job = jobOr404(db, user, intId(params.id));
    const lang = query.get('lang') === 'en' ? 'en' : 'es';
    ensureSchedule(job);
    return { $buffer: proposalPdf(db, job, lang), $type: 'application/pdf', $name: `propuesta-${job.id}.pdf`, $inline: true };
  });

  // ===== cobros =====
  add('GET', '/api/jobs/:id/billing', ({ user, params }) => {
    requireRole(user, 'owner', 'client');
    const job = jobOr404(db, user, intId(params.id));
    if (user.role === 'owner' && (user.isPm || user.is_agent)) fail(403, 'Esto solo lo pueden hacer los dueños');
    const b = billing(db, job.id);
    if (job.proposal_token) b.link = pubUrl(job);
    return b;
  });
  add('POST', '/api/milestones/:id/ready', ({ user, params }) => {
    owner(user);
    const m = db.prepare('SELECT * FROM payment_milestones WHERE id=?').get(intId(params.id)); if (!m) fail(404, 'No encontrado');
    jobOr404(db, user, m.job_id);
    db.prepare("UPDATE payment_milestones SET ready_at=CASE WHEN ready_at='' THEN datetime('now') ELSE ready_at END WHERE id=?").run(m.id);
    return { ok: true };
  });
  add('POST', '/api/milestones/:id/invoice', ({ user, params, body }) => {
    owner(user);
    const m = db.prepare('SELECT * FROM payment_milestones WHERE id=?').get(intId(params.id)); if (!m) fail(404, 'No encontrado');
    const job = jobOr404(db, user, m.job_id);
    if (m.invoice_number) fail(400, 'Esta etapa ya está facturada');
    const days = Math.min(60, Math.max(0, Number(body.due_days ?? 7) || 0));
    const y = todayL().slice(0, 4), seq = Number(getMeta(db, 'inv_seq_' + y) || 0) + 1; setMeta(db, 'inv_seq_' + y, String(seq));
    const num = `INV-${y}-${String(seq).padStart(4, '0')}`;
    ensureToken(job);
    db.prepare("UPDATE payment_milestones SET invoice_number=?, invoiced_at=?, due_date=?, ready_at=CASE WHEN ready_at='' THEN datetime('now') ELSE ready_at END WHERE id=?").run(num, todayL(), addDays(todayL(), days), m.id);
    const b = billing(db, job.id).milestones.find(x => x.id === m.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary,amount_cents) VALUES(?,?,?,?,?,?,?)").run(user.id, 'crear', 'invoice_cliente', m.id, job.id, `${num}: ${m.label} — ${job.client_name}`, b.amount_cents);
    return { ok: true, invoice_number: num, amount_cents: b.amount_cents, due_date: b.due_date, url: pubUrl(job, `&inv=${m.id}`), client_phone: job.client_phone, client_email: job.client_email, client_name: job.client_name, company: CO(db).name };
  });
  add('DELETE', '/api/milestones/:id/invoice', ({ user, params }) => {
    owner(user);
    const m = db.prepare('SELECT * FROM payment_milestones WHERE id=?').get(intId(params.id)); if (!m) fail(404, 'No encontrado');
    jobOr404(db, user, m.job_id);
    db.prepare("UPDATE payment_milestones SET invoice_number='', invoiced_at='', due_date='' WHERE id=?").run(m.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,?,?,?,?,?)").run(user.id, 'borrar', 'invoice_cliente', m.id, m.job_id, `Se anuló ${m.invoice_number}`);
    return { ok: true };
  });
  add('GET', '/api/milestones/:id/pdf', ({ user, params, query }) => {
    requireRole(user, 'owner', 'client');
    const m = db.prepare('SELECT * FROM payment_milestones WHERE id=?').get(intId(params.id)); if (!m) fail(404, 'No encontrado');
    const job = jobOr404(db, user, m.job_id);
    const buf = invoicePdf(db, job, m.id, query.get('lang') === 'en' ? 'en' : (user.lang === 'en' ? 'en' : 'es')); if (!buf) fail(404, 'No encontrado');
    return { $buffer: buf, $type: 'application/pdf', $name: `${m.invoice_number}.pdf`, $inline: true };
  });
  // Para el inicio: lo que toca cobrar y lo vencido.
  add('GET', '/api/billing/due', ({ user }) => {
    owner(user);
    const jobs = db.prepare("SELECT DISTINCT job_id FROM payment_milestones m JOIN jobs j ON j.id=m.job_id WHERE j.proposal_signed_at<>'' AND j.status NOT IN ('cancelado')").all();
    const out = [];
    for (const { job_id } of jobs) {
      const j = db.prepare('SELECT client_name FROM jobs WHERE id=?').get(job_id);
      for (const m of billing(db, job_id).milestones) if (['por_cobrar', 'vencido'].includes(m.status)) out.push({ ...m, job_id, client_name: j.client_name });
    }
    return out.sort((a, b) => (a.status === 'vencido' ? 0 : 1) - (b.status === 'vencido' ? 0 : 1));
  });

  // ===== público: el cliente abre el enlace (sin cuenta) =====
  const byToken = t => { const s = String(t || ''); if (!/^[A-Za-z0-9_-]{20,40}$/.test(s)) fail(404, 'Enlace no válido'); const j = db.prepare('SELECT * FROM jobs WHERE proposal_token=?').get(s); if (!j) fail(404, 'Enlace no válido'); return j; };
  add('GET', '/api/public/proposal/:token', ({ params }) => {
    const job = byToken(params.token);
    const co = CO(db), tot = job.proposal_signed_at ? job.quoted_cents : total(db, job.id);
    const sig = job.proposal_signed_at ? db.prepare("SELECT signer_name, signed_at, doc_hash FROM signatures WHERE job_id=? AND target='estimate' ORDER BY id DESC LIMIT 1").get(job.id) : null;
    const b = job.proposal_signed_at ? billing(db, job.id) : null;
    const expired = !job.proposal_signed_at && job.proposal_valid_until && job.proposal_valid_until < todayL();
    return { company: { name: co.name, logo: co.logo, phone: getMeta(db, 'company_phone') || '' }, client_name: job.client_name, address: job.address, description: job.description || '',
      lines: lines(db, job.id).map(l => ({ trade: l.trade, description: l.description, sold_cents: l.sold_cents })), total_cents: tot, terms: job.proposal_terms || DEFAULT_TERMS.es,
      valid_until: job.proposal_valid_until || '', expired: !!expired, can_sign: !job.proposal_signed_at && !expired && ['prospecto', 'cotizado'].includes(job.status) && tot > 0,
      schedule: schedule(db, job.id).map(m => ({ label: m.label, pct: m.pct, when: trigLabel(db, m, 'es'), when_en: trigLabel(db, m, 'en'), amount_cents: Math.round(tot * m.pct / 100) })),
      signed: sig ? { name: sig.signer_name, at: sig.signed_at, code: sig.doc_hash.slice(0, 16) } : null,
      invoices: b ? b.milestones.filter(m => m.invoice_number).map(m => ({ id: m.id, number: m.invoice_number, label: m.label, amount_cents: m.amount_cents, due_date: m.due_date, status: m.status })) : [],
      balance_cents: b ? b.balance_cents : null, pay_info: getMeta(db, 'pay_info') || '' };
  });
  add('GET', '/api/public/proposal/:token/pdf', ({ params, query }) => {
    const job = byToken(params.token); ensureSchedule(job);
    return { $buffer: proposalPdf(db, job, query.get('lang') === 'en' ? 'en' : 'es'), $type: 'application/pdf', $name: `propuesta-${job.id}.pdf`, $inline: true };
  });
  add('GET', '/api/public/proposal/:token/invoice/:id', ({ params, query }) => {
    const job = byToken(params.token);
    const m = db.prepare('SELECT id FROM payment_milestones WHERE id=? AND job_id=?').get(intId(params.id), job.id); if (!m) fail(404, 'No encontrado');
    const buf = invoicePdf(db, job, m.id, query.get('lang') === 'en' ? 'en' : 'es'); if (!buf) fail(404, 'No encontrado');
    return { $buffer: buf, $type: 'application/pdf', $name: 'invoice.pdf', $inline: true };
  });
  add('POST', '/api/public/proposal/:token/sign', ({ params, body, ip, ua }) => {
    const job = byToken(params.token);
    if (job.proposal_signed_at) fail(400, 'Esta propuesta ya está firmada');
    if (!['prospecto', 'cotizado'].includes(job.status)) fail(400, 'Esta propuesta ya no se puede firmar');
    if (job.proposal_valid_until && job.proposal_valid_until < todayL()) fail(400, 'Esta propuesta ya venció. Pídanos una nueva.');
    if (body.agree !== true) fail(400, 'Debe aceptar firmar electrónicamente');
    const name = need(body.name, 'nombre completo', 120);
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.signature || ''));
    if (!m) fail(400, 'Falta la firma');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 500 || buf.length > 600 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) fail(400, 'Falta la firma');
    const tot = total(db, job.id); if (!tot) fail(400, 'Esta propuesta ya no se puede firmar');
    ensureSchedule(job);
    const text = proposalText(db, job), h = sha(text);
    db.exec('BEGIN');
    try {
      const id = Number(db.prepare("INSERT INTO signatures(job_id,target,target_id,signer_name,user_id,amount_cents,doc_hash,summary,ip,ua) VALUES(?,'estimate',NULL,?,NULL,?,?,?,?,?)")
        .run(job.id, name, tot, h, 'Propuesta P-' + String(job.id).padStart(4, '0'), String(ip || '').slice(0, 60), String(ua || '').slice(0, 200)).lastInsertRowid);
      fs.mkdirSync(sigDir, { recursive: true }); fs.writeFileSync(path.join(sigDir, `${id}.jpg`), buf);
      const t = todayL();
      db.prepare("UPDATE jobs SET status='activo', won_date=?, signed_at=datetime('now'), proposal_signed_at=datetime('now'), proposal_hash=?, quoted_cents=?, follow_up_date='', lead_new=0 WHERE id=?").run(t, h, tot, job.id);
      for (const ms of schedule(db, job.id)) db.prepare('UPDATE payment_milestones SET amount_cents=? WHERE id=?').run(Math.round(tot * ms.pct / 100), ms.id);
      db.prepare('INSERT INTO sales_events(job_id,user_id,kind,note,amount_cents,next_date) VALUES(?,NULL,?,?,?,?)').run(job.id, 'ganado', `Firmó en línea: ${name}`, tot, '');
      db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary,amount_cents) VALUES(NULL,'crear','firma',?,?,?,?)").run(id, job.id, `El cliente firmó la propuesta en línea: ${name}`, tot);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    notify(db, owners(db), 'signed', { who: name, x: 'la propuesta', job: job.client_name }, `#/obra/${job.id}/propuesta`);
    check(db);
    return { ok: true };
  });
};
module.exports.check = check;
module.exports.billing = billing;
