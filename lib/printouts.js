'use strict';
const CO = db => require('./company').info(db);
const path = require('node:path');
const fs = require('node:fs');
// PDFs para imprimir o mandar: documentos de los subs y resumen/estimado para el cliente.
const { buildDocument, money } = require('./pdf');
const C = require('./catalog');

const TXT = {
  es: { from: 'De', to: 'Para', details: 'Datos', desc: 'Descripción', qty: 'Cant.', price: 'Precio', amount: 'Importe', subtotal: 'Subtotal',
    estimate: 'ESTIMADO', invoice: 'INVOICE', change_order: 'CHANGE ORDER', summary: 'RESUMEN DE CONTRATO', date: 'Fecha', due: 'Pagar antes del',
    project: 'Proyecto', address: 'Dirección', ref: 'Estimado', work: 'Trabajo', cos: 'Change orders', original: 'Estimado original', cosApproved: 'Change orders aprobados',
    total: 'TOTAL', totalWithCos: 'TOTAL CON CHANGE ORDERS', pending: 'Pendiente de aprobación (no incluido en el total)', paidOn: 'Pagado el', invoicedBefore: 'Facturado antes',
    thisInvoice: 'Este invoice', remaining: 'Pendiente por facturar', estTotal: 'Total del estimado con change orders', type: 'Tipo', start: 'Inicio', end: 'Fin estimado',
    price: 'Precio', projectPrice: 'Precio del proyecto', contract: 'TOTAL DEL CONTRATO', paid: 'Pagado', balance: 'Saldo', payments: 'Pagos recibidos',
    warranty: 'Todo el trabajo tiene garantía de 1 año a partir de la fecha de terminación.', warrantyUntil: 'Garantía hasta el', generated: 'Generado el',
    status: { enviado: 'POR REVISAR', aceptado: 'ACEPTADO', aprobado: 'APROBADO', rechazado: 'RECHAZADO', pagado: 'PAGADO', correccion: 'CORRECCIÓN POR REVISAR' },
    signClient: 'Firma del cliente / fecha', paymentsMade: 'Pagos realizados', eSigned: 'Firmado electrónicamente por', code: 'Código de verificación', co: 'Change order', signCompany: 'Elevated Exteriors / fecha', notes: 'Notas', quote: 'ESTIMADO', none: '—' },
  en: { from: 'From', to: 'To', details: 'Details', desc: 'Description', qty: 'Qty', price: 'Price', amount: 'Amount', subtotal: 'Subtotal',
    estimate: 'ESTIMATE', invoice: 'INVOICE', change_order: 'CHANGE ORDER', summary: 'CONTRACT SUMMARY', date: 'Date', due: 'Due by',
    project: 'Project', address: 'Address', ref: 'Estimate', work: 'Work', cos: 'Change orders', original: 'Original estimate', cosApproved: 'Approved change orders',
    total: 'TOTAL', totalWithCos: 'TOTAL WITH CHANGE ORDERS', pending: 'Pending approval (not included in total)', paidOn: 'Paid on', invoicedBefore: 'Previously invoiced',
    thisInvoice: 'This invoice', remaining: 'Remaining to invoice', estTotal: 'Estimate total with change orders', type: 'Type', start: 'Start', end: 'Estimated finish',
    projectPrice: 'Project price', contract: 'CONTRACT TOTAL', paid: 'Paid', balance: 'Balance', payments: 'Payments received',
    warranty: 'All work carries a 1-year warranty from the completion date.', warrantyUntil: 'Warranty through', generated: 'Generated on',
    status: { enviado: 'PENDING REVIEW', aceptado: 'ACCEPTED', aprobado: 'APPROVED', rechazado: 'REJECTED', pagado: 'PAID', correccion: 'CORRECTION PENDING REVIEW' },
    signClient: 'Client signature / date', paymentsMade: 'Payments made', eSigned: 'Electronically signed by', code: 'Verification code', co: 'Change order', signCompany: 'Elevated Exteriors / date', notes: 'Notes', quote: 'ESTIMATE', none: '—' },
};
const fdate = (s, lang) => s ? new Date(s.slice(0, 10) + 'T12:00:00Z').toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
const pickLang = (q, user) => (q === 'en' || q === 'es') ? q : (user.lang === 'en' ? 'en' : 'es');
const safe = s => String(s || '').replace(/[^\w.-]+/g, '-').slice(0, 60);
const parse = s => { try { return JSON.parse(s); } catch { return []; } };

module.exports = function printoutRoutes(db, add, H) {
  const { requireRole, fail, intId, jobOr404, canSeeJob } = H;

  // ===== estimado / invoice / change order de un sub =====
  add('GET', '/api/docs/:id/pdf', ({ user, params, query }) => {
    requireRole(user, 'owner', 'worker');
    const d = db.prepare('SELECT * FROM sub_docs WHERE id=?').get(intId(params.id));
    if (!d || !canSeeJob(db, user, d.job_id) || (user.role === 'worker' && d.sub_user_id !== user.id)) fail(404, 'Documento no encontrado');
    const lang = pickLang(query.get('lang'), user), T = TXT[lang];
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(d.job_id);
    const sub = db.prepare('SELECT name, phone, trade FROM users WHERE id=?').get(d.sub_user_id) || {};
    const lines = parse(d.lines);
    const est = d.from_estimate_id ? db.prepare('SELECT * FROM sub_docs WHERE id=?').get(d.from_estimate_id) : null;
    const status = d.prev ? 'correccion' : d.paid_at ? 'pagado' : d.status;
    const spec = {
      title: T[d.type], number: '# ' + d.number, badge: T.status[status],
      from: [sub.name, sub.trade, sub.phone], to: [CO(db).name, CO(db).city],
      meta: [[T.date, fdate(d.date, lang)], ...(d.due_date ? [[T.due, fdate(d.due_date, lang)]] : []), [T.project, job.client_name], [T.address, job.address || T.none],
        ...(est ? [[T.ref, est.number]] : [])],
      description: d.description,
      sections: [{ heading: T.work, rows: lines.map(l => ({ desc: l.desc, qty: l.qty, unit: l.unit_cents, amount: l.amount_cents })), total: d.total_cents }],
      totals: [], notes: [d.notes && `${T.notes}: ${d.notes}`],
      footer: `${T.generated} ${fdate(new Date().toISOString(), lang)} · ${CO(db).name}`,
    };
    if (d.type === 'estimate') {
      const cos = db.prepare("SELECT * FROM sub_docs WHERE from_estimate_id=? AND type='change_order' AND status<>'rechazado' ORDER BY id").all(d.id);
      const ok = cos.filter(c => c.status === 'aceptado' && !c.prev);
      const coSum = ok.reduce((s, c) => s + c.total_cents, 0);
      if (cos.length) {
        spec.sections.push({ heading: T.cos, rows: cos.map(c => ({ desc: `${c.number} — ${c.description}`, note: c.status !== 'aceptado' || c.prev ? T.pending : fdate(c.date, lang),
          qty: '', unit: null, amount: c.total_cents, muted: c.status !== 'aceptado' })), total: coSum, totalLabel: T.cosApproved });
      }
      spec.totals = cos.length ? [[T.original, d.total_cents], [T.cosApproved, coSum], [T.totalWithCos, d.total_cents + coSum, true]] : [[T.total, d.total_cents, true]];
    } else {
      spec.totals = [[T.total, d.total_cents, true]];
      if (d.type === 'invoice' && est) {
        const coSum = db.prepare("SELECT COALESCE(SUM(total_cents),0) v FROM sub_docs WHERE from_estimate_id=? AND type='change_order' AND status='aceptado'").get(est.id).v;
        const before = db.prepare("SELECT COALESCE(SUM(total_cents),0) v FROM sub_docs WHERE from_estimate_id=? AND type='invoice' AND status<>'rechazado' AND id<?").get(est.id, d.id).v;
        const whole = est.total_cents + coSum;
        spec.notes.push(`${T.estTotal} (${est.number}): ${money(whole)} · ${T.invoicedBefore}: ${money(before)} · ${T.thisInvoice}: ${money(d.total_cents)} · ${T.remaining}: ${money(whole - before - d.total_cents)}`);
      }
      const pays = db.prepare('SELECT * FROM sub_payments WHERE doc_id=? ORDER BY date, id').all(d.id);
      if (pays.length) {
        const paidSum = pays.reduce((a, p) => a + p.amount_cents, 0);
        spec.sections.push({ heading: T.paymentsMade, simple: true, rows: pays.map(p => ({ desc: `${fdate(p.date, lang)} · ${p.method}${p.reference ? ' ' + p.reference : ''}`, amount: p.amount_cents })) });
        spec.totals.push([T.paid, paidSum], [T.balance, d.total_cents - paidSum, true]);
      } else if (d.paid_at) spec.notes.push(`${T.paidOn} ${fdate(d.paid_at, lang)}${d.paid_method ? ' · ' + d.paid_method : ''}`);
    }
    return { $buffer: buildDocument({ ...spec, logo: CO(db).logo, company: CO(db).name }, T), $type: 'application/pdf', $name: `${safe(d.number)}-${safe(job.client_name)}.pdf` };
  });

  // ===== para el cliente: estimado (si aún no empieza) o resumen de contrato, con change orders y pagos =====
  add('GET', '/api/jobs/:id/pdf', ({ user, params, query }) => {
    requireRole(user, 'owner', 'client');
    const job = jobOr404(db, user, intId(params.id));
    const lang = pickLang(query.get('lang'), user), T = TXT[lang];
    const cos = db.prepare("SELECT * FROM change_orders WHERE job_id=? AND status<>'rechazado' ORDER BY date, id").all(job.id);
    const pays = db.prepare('SELECT * FROM payments WHERE job_id=? ORDER BY date, id').all(job.id);
    const ok = cos.filter(c => c.status === 'aprobado');
    const coSum = ok.reduce((s, c) => s + c.price_cents, 0);
    const contract = job.quoted_cents + coSum, paid = pays.reduce((s, p) => s + p.amount_cents, 0);
    const type = C.PROJECT_TYPES.find(p => p.key === job.project_type) || {};
    const isQuote = ['prospecto', 'cotizado'].includes(job.status);
    let warranty = '';
    if (job.completed_date) { const w = new Date(job.completed_date + 'T12:00:00Z'); w.setUTCMonth(w.getUTCMonth() + C.WARRANTY_MONTHS); warranty = w.toISOString().slice(0, 10); }
    const spec = {
      title: isQuote ? T.quote : T.summary, number: '# P-' + String(job.id).padStart(4, '0'),
      from: [CO(db).name, CO(db).city], to: [job.client_name, job.address, job.client_phone, job.client_email],
      meta: [[T.date, fdate(new Date().toISOString(), lang)], [T.type, type[lang] || type.es || ''], ...(job.start_date ? [[T.start, fdate(job.start_date, lang)]] : []),
        ...(job.end_date ? [[T.end, fdate(job.end_date, lang)]] : [])],
      description: job.description,
      sections: [{ heading: T.projectPrice, simple: true, rows: [{ desc: job.description || type[lang] || '', amount: job.quoted_cents }] }],
      totals: [], notes: [], footer: `${T.generated} ${fdate(new Date().toISOString(), lang)} · ${CO(db).name} · ${CO(db).city}`,
    };
    if (cos.length) spec.sections.push({ heading: T.cos, simple: true, total: coSum, totalLabel: T.cosApproved,
      rows: cos.map(c => ({ desc: c.description, note: c.status === 'aprobado' ? fdate(c.date, lang) : T.pending, amount: c.price_cents, muted: c.status !== 'aprobado' })) });
    spec.totals = [[T.projectPrice, job.quoted_cents], ...(cos.length ? [[T.cosApproved, coSum]] : []), [T.contract, contract, true]];
    if (pays.length) {
      spec.sections.push({ heading: T.payments, simple: true, rows: pays.map(p => ({ desc: `${fdate(p.date, lang)}${p.method ? ' · ' + p.method : ''}`, amount: p.amount_cents })) });
      spec.totals.push([T.paid, paid], [T.balance, contract - paid, true]);
    }
    spec.notes.push(warranty ? `${T.warrantyUntil} ${fdate(warranty, lang)}. ${T.warranty}` : T.warranty);
    // Firmas electrónicas del cliente (solo si el documento no cambió después de firmar).
    const crypto = require('node:crypto');
    const hash = x => crypto.createHash('sha256').update(x).digest('hex');
    const sigFile = id => { try { return fs.readFileSync(path.join(db.dataDir, 'signatures', `${id}.jpg`)); } catch { return null; } };
    const es = db.prepare("SELECT * FROM signatures WHERE job_id=? AND target='estimate' ORDER BY id DESC LIMIT 1").get(job.id);
    const esText = JSON.stringify({ job: job.id, client: job.client_name, address: job.address, description: job.description, amount: job.quoted_cents });
    const sigLines = s => [`${T.eSigned} ${s.signer_name}`, `${fdate(s.signed_at.slice(0, 10), lang)} ${s.signed_at.slice(11, 16)} UTC · IP ${s.ip || '—'}`, `${T.code}: ${s.doc_hash.slice(0, 16)}`];
    if (es && es.doc_hash === hash(esText) && sigFile(es.id)) spec.signatures = [{ label: T.signClient, image: sigFile(es.id), lines: sigLines(es) }, T.signCompany.replace('Elevated Exteriors', CO(db).name)];
    else if (isQuote) spec.signatures = [T.signClient, T.signCompany.replace('Elevated Exteriors', CO(db).name)];
    for (const c of cos) {
      const s = db.prepare("SELECT * FROM signatures WHERE target='change_order' AND target_id=? ORDER BY id DESC LIMIT 1").get(c.id);
      if (s && s.doc_hash === hash(JSON.stringify({ co: c.id, job: c.job_id, description: c.description, amount: c.price_cents, date: c.date }))) {
        spec.notes.push(`${T.co} "${c.description.slice(0, 60)}": ${T.eSigned} ${s.signer_name} · ${fdate(s.signed_at.slice(0, 10), lang)} · ${T.code} ${s.doc_hash.slice(0, 16)}`);
      }
    }
    return { $buffer: buildDocument({ ...spec, logo: CO(db).logo, company: CO(db).name }, T), $type: 'application/pdf', $name: `${isQuote ? 'Estimate' : 'Contract'}-${safe(job.client_name)}.pdf` };
  });
};
module.exports.TXT = TXT; module.exports.fdate = fdate;
