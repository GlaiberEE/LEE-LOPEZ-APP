'use strict';
// Planos, estimado e invoice de cada obra, y el scope (alcance) sin precios para los subs.
//  - Al crear la obra se piden los planos y el estimado (se pueden subir después en la pestaña Planos).
//  - Los planos y el scope los ven los subs de la obra. Nunca ven el estimado, el invoice ni ningún monto.
//  - Cuando el estimado se aprueba, se convierte en invoice (mismo archivo y monto, con su número de invoice) y,
//    si la obra todavía no tenía contrato, queda como contrato: la obra pasa a "En obra" con su calendario de cobros.
//  - Un estimado aprobado o un invoice ya no se cambian ni se borran (solo el nombre y con quién se comparte).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { notify, owners } = require('./push');

const KINDS = ['plano', 'estimado', 'invoice', 'contrato', 'garantia', 'otro'];
const MONEY = ['estimado', 'invoice', 'contrato'];
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 25 * 1024 * 1024;
const TZ = process.env.APP_TZ || 'America/Chicago';
const todayL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const pad = id => String(id).padStart(4, '0');
const looksLike = (buf, mime) => mime === 'application/pdf' ? buf.slice(0, 5).toString() === '%PDF-'
  : mime === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 : mime === 'image/png' ? buf.slice(0, 4).toString('hex') === '89504e47'
    : mime === 'image/webp' ? buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP' : false;

// Número de invoice: el del estimado con INV- adelante (o el código de la obra), sin repetir.
function invoiceNumber(db, job, est) {
  const base = 'INV-' + (String(est && est.number || '').replace(/^(est(imate|imado)?|e)[-\s#]*/i, '').trim() || pad(job.id));
  let n = base, i = 2;
  while (db.prepare("SELECT 1 FROM job_docs WHERE kind='invoice' AND number=?").get(n)) n = `${base}-${i++}`;
  return n;
}
// Propuesta firmada en línea (la de la app): también queda su invoice en Planos y documentos.
function invoiceFromProposal(db, job, totalCents) {
  if (db.prepare("SELECT 1 FROM job_docs WHERE job_id=? AND kind='invoice'").get(job.id)) return null;
  const number = invoiceNumber(db, job, { number: pad(job.id) });
  return Number(db.prepare("INSERT INTO job_docs(job_id,kind,title,number,amount_cents,status,approved_at) VALUES(?,'invoice',?,?,?,'aprobado',datetime('now'))")
    .run(job.id, `Invoice ${number} (propuesta firmada)`, number, totalCents).lastInsertRowid);
}

function routes(db, add, h) {
  const { requireRole, fail, str, intId, cents, jobOr404, canSeeJob } = h;
  const dir = path.join(db.dataDir, 'job-docs'); fs.mkdirSync(dir, { recursive: true });
  const humanOwner = u => u.role === 'owner' && !u.isPm && !u.is_agent;
  const who = u => u.pmId || u.id;
  const audit = (u, action, d, summary, amount = 0) => db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary,amount_cents) VALUES(?,?,?,?,?,?,?)').run(who(u), action, 'documento de obra', d.id, d.job_id, summary, amount);
  const docOr404 = (user, id) => { const d = db.prepare('SELECT * FROM job_docs WHERE id=?').get(intId(id)); if (!d || !canSeeJob(db, user, d.job_id)) fail(404, 'No encontrado'); return d; };
  // Qué ve cada quien: la compañía todo; el sub solo planos y documentos compartidos, sin montos; el cliente lo que se le compartió.
  const visible = (user, d) => user.role === 'owner' || user.role === 'pm' ? true
    : user.role === 'worker' ? !MONEY.includes(d.kind) && !!d.share_subs : user.role === 'client' ? !!d.share_client : false;
  const out = (user, d) => {
    const base = { id: d.id, kind: d.kind, title: d.title, mime: d.mime, size: d.size, has_file: !!d.file, created_at: d.created_at };
    if (user.role === 'worker') return base;
    const extra = { number: d.number, status: d.status, approved_at: d.approved_at, from_id: d.from_id };
    if (user.role === 'client') return { ...base, ...(MONEY.includes(d.kind) ? { ...extra, amount_cents: d.amount_cents } : {}) };
    return { ...base, ...extra, amount_cents: d.amount_cents, share_subs: !!d.share_subs, share_client: !!d.share_client,
      by: (db.prepare('SELECT name FROM users WHERE id=?').get(d.created_by) || {}).name || '' };
  };
  const saveFile = dataUrl => {
    const m = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) fail(400, 'Archivo inválido (use PDF o foto)');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX) fail(413, 'El archivo es muy grande (máximo 25 MB)');
    if (!looksLike(buf, m[1])) fail(400, 'Archivo inválido (use PDF o foto)');
    const name = `${crypto.randomBytes(12).toString('hex')}.${EXT[m[1]]}`;
    fs.writeFileSync(path.join(dir, name), buf);
    return { file: name, mime: m[1], size: buf.length };
  };

  add('GET', '/api/jobs/:id/docs', ({ user, params }) => {
    requireRole(user, 'owner', 'pm', 'worker', 'client');
    const job = jobOr404(db, user, intId(params.id));
    const docs = db.prepare('SELECT * FROM job_docs WHERE job_id=? ORDER BY CASE kind WHEN \'plano\' THEN 0 WHEN \'contrato\' THEN 1 WHEN \'estimado\' THEN 2 WHEN \'invoice\' THEN 3 WHEN \'garantia\' THEN 4 ELSE 5 END, id').all(job.id)
      .filter(d => visible(user, d)).map(d => out(user, d));
    const company = user.role === 'owner' || user.role === 'pm';
    // El scope se lee en el idioma de cada quien (el original siempre se guarda).
    const sc = user.role === 'client' ? {} : require('./translate').addTr(db, { scope_text: job.scope_text || '' }, 'scope_text', user.lang);
    return { docs, scope_text: user.role === 'client' ? undefined : job.scope_text || '', scope_text_tr: sc.scope_text_tr,
      missing: company ? { planos: !docs.some(d => d.kind === 'plano'), estimado: !docs.some(d => d.kind === 'estimado' || d.kind === 'invoice') } : undefined };
  });
  add('POST', '/api/jobs/:id/docs', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const kind = KINDS.includes(body.kind) ? body.kind : fail(400, 'Tipo de documento inválido');
    if (kind === 'invoice') fail(400, 'El invoice sale solo cuando se aprueba el estimado');
    const f = saveFile(body.file);
    const money = MONEY.includes(kind);
    const amount = money && body.amount_cents != null && body.amount_cents !== '' ? cents(body.amount_cents, 'monto') : 0;
    const title = str(body.title, 140) || (kind === 'plano' ? 'Planos' : kind === 'estimado' ? 'Estimado' : kind === 'contrato' ? 'Contrato' : kind === 'garantia' ? 'Garantía' : 'Documento');
    const r = db.prepare('INSERT INTO job_docs(job_id,kind,title,number,file,mime,size,amount_cents,status,share_subs,share_client,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(job.id, kind, title, str(body.number, 40), f.file, f.mime, f.size, amount, kind === 'estimado' ? 'enviado' : '',
        money ? 0 : (body.share_subs === undefined ? (kind === 'plano' ? 1 : 0) : body.share_subs ? 1 : 0), body.share_client ? 1 : 0, who(user));
    const d = db.prepare('SELECT * FROM job_docs WHERE id=?').get(Number(r.lastInsertRowid));
    audit(user, 'crear', d, `${kind === 'plano' ? 'Planos' : kind === 'estimado' ? 'Estimado' : 'Documento'} subido: ${title}${amount ? ' · ' + (amount / 100).toFixed(2) : ''}`, amount);
    if (d.share_subs) {
      const subs = db.prepare('SELECT DISTINCT user_id FROM subs WHERE job_id=? AND user_id IS NOT NULL').all(job.id).map(r => r.user_id);
      if (subs.length) notify(db, subs, 'docs_new', { x: title, job: job.address || job.client_name }, `#/obra/${job.id}`);
    }
    return out(user, d);
  });
  add('GET', '/api/job-docs/:id/file', ({ user, params, query }) => {
    requireRole(user, 'owner', 'pm', 'worker', 'client');
    const d = docOr404(user, params.id);
    if (!visible(user, d) || !d.file) fail(404, 'No encontrado');
    const name = `${d.kind}-${d.number || d.id}-${d.title}`.replace(/[^\w.-]+/g, '_').slice(0, 80) + '.' + EXT[d.mime];
    return { $buffer: fs.readFileSync(path.join(dir, d.file)), $type: d.mime, $name: name, $attach: query.get('download') === '1' };
  });
  add('PUT', '/api/job-docs/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const d = docOr404(user, params.id);
    const locked = d.kind === 'invoice' || d.status === 'aprobado';
    if (locked && ['number', 'amount_cents', 'file'].some(k => k in body)) fail(423, 'Un estimado aprobado o un invoice ya no se cambia. Si hay cambios, hagan un change order.');
    const f = !locked && body.file ? saveFile(body.file) : null;
    const money = MONEY.includes(d.kind);
    db.prepare('UPDATE job_docs SET title=?, number=?, amount_cents=?, share_subs=?, share_client=?, file=?, mime=?, size=? WHERE id=?').run(
      'title' in body ? (str(body.title, 140) || d.title) : d.title, 'number' in body ? str(body.number, 40) : d.number,
      'amount_cents' in body && money ? cents(body.amount_cents, 'monto') : d.amount_cents,
      money ? 0 : 'share_subs' in body ? (body.share_subs ? 1 : 0) : d.share_subs, 'share_client' in body ? (body.share_client ? 1 : 0) : d.share_client,
      f ? f.file : d.file, f ? f.mime : d.mime, f ? f.size : d.size, d.id);
    if (f && d.file) { try { fs.unlinkSync(path.join(dir, d.file)); } catch { /* */ } }
    const n = db.prepare('SELECT * FROM job_docs WHERE id=?').get(d.id);
    if (n.amount_cents !== d.amount_cents) audit(user, 'editar', d, `Estimado ${d.number || d.title}: ${(d.amount_cents / 100).toFixed(2)} → ${(n.amount_cents / 100).toFixed(2)}`, Math.abs(n.amount_cents - d.amount_cents));
    return out(user, n);
  });
  add('DELETE', '/api/job-docs/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const d = docOr404(user, params.id);
    if (d.kind === 'invoice' || d.status === 'aprobado') fail(423, 'Un estimado aprobado o un invoice no se borra');
    db.prepare('DELETE FROM job_docs WHERE id=?').run(d.id);
    if (d.file && !db.prepare('SELECT 1 FROM job_docs WHERE file=?').get(d.file)) { try { fs.unlinkSync(path.join(dir, d.file)); } catch { /* */ } }
    audit(user, 'borrar', d, `Documento borrado: ${d.title}`);
    return { ok: true };
  });
  // El cliente aprobó el estimado: se convierte en invoice y, si la obra no tenía contrato, ese monto es el contrato.
  add('POST', '/api/job-docs/:id/approve', ({ user, params }) => {
    requireRole(user, 'owner');
    if (!humanOwner(user)) fail(403, 'Aprobar el estimado lo hace un dueño');
    const d = docOr404(user, params.id);
    if (d.kind !== 'estimado') fail(400, 'Solo un estimado se aprueba');
    if (d.status === 'aprobado') fail(400, 'Este estimado ya está aprobado');
    if (!(d.amount_cents > 0)) fail(400, 'Escriba el monto del estimado antes de aprobarlo');
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(d.job_id);
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE job_docs SET status='aprobado', approved_by=?, approved_at=datetime('now') WHERE id=?").run(user.id, d.id);
      const number = invoiceNumber(db, job, d);
      const inv = Number(db.prepare("INSERT INTO job_docs(job_id,kind,title,number,file,mime,size,amount_cents,status,from_id,approved_by,approved_at,share_client,created_by) VALUES(?,'invoice',?,?,?,?,?,?,'aprobado',?,?,datetime('now'),?,?)")
        .run(job.id, `Invoice ${number}`, number, d.file, d.mime, d.size, d.amount_cents, d.id, user.id, d.share_client, user.id).lastInsertRowid);
      let contract = false;
      if (['prospecto', 'cotizado'].includes(job.status)) {
        db.prepare("UPDATE jobs SET status='activo', quoted_cents=?, won_date=COALESCE(NULLIF(won_date,''),?), follow_up_date='', lead_new=0 WHERE id=?").run(d.amount_cents, todayL(), job.id);
        if (!db.prepare('SELECT 1 FROM payment_milestones WHERE job_id=?').get(job.id)) {
          [['Anticipo al firmar', 30, 'firma'], ['Al terminar la estructura', 40, 'manual'], ['Al terminar la obra', 30, 'manual']].forEach(([l, p, t], i) =>
            db.prepare('INSERT INTO payment_milestones(job_id,position,label,pct,trigger) VALUES(?,?,?,?,?)').run(job.id, i + 1, l, p, t));
        }
        for (const ms of db.prepare('SELECT id, pct FROM payment_milestones WHERE job_id=?').all(job.id)) db.prepare('UPDATE payment_milestones SET amount_cents=? WHERE id=?').run(Math.round(d.amount_cents * ms.pct / 100), ms.id);
        contract = true;
        require('./queue').enqueue(db, job.id, todayL());
      }
      audit(user, 'aprobar', d, `Estimado ${d.number || d.title} aprobado → ${number}${contract ? ' (contrato de la obra)' : ''}`, d.amount_cents);
      db.exec('COMMIT');
      notify(db, owners(db).filter(id => id !== user.id), 'est_approved', { who: user.name, x: number, job: job.client_name }, `#/obra/${job.id}/planos`);
      try { require('./billing').check(db); } catch { /* */ }
      return { ok: true, invoice_id: inv, number, contract, contract_unchanged: !contract && job.quoted_cents !== d.amount_cents };
    } catch (e) { try { db.exec('ROLLBACK'); } catch { /* */ } throw e; }
  });
  // Scope del trabajo para los subs: sin precios ni dinero.
  add('PUT', '/api/jobs/:id/scope', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const text = str(body.scope_text, 8000);
    if (/\$\s?\d|\d+\.\d{2}\b|\busd\b/i.test(text)) fail(400, 'El scope es para los subs: quite los precios y montos');
    db.prepare('UPDATE jobs SET scope_text=? WHERE id=?').run(text, job.id);
    require('./translate').ensure(db, [text]).catch(() => {});
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,'editar','scope',?,?,?)").run(who(user), job.id, job.id, 'Scope del trabajo para los subs actualizado');
    return { ok: true, scope_text: text };
  });
  // Sugerencia de scope: lo que se vendió (partidas y descripción), sin ningún precio.
  add('GET', '/api/jobs/:id/scope/suggest', ({ user, params }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const T = require('./trades');
    const lines = db.prepare("SELECT trade, description FROM job_lines WHERE job_id=? AND pass_through=0 ORDER BY id").all(job.id);
    const clean = s => String(s || '').replace(/\$\s?[\d,]+(\.\d+)?/g, '').replace(/\s{2,}/g, ' ').trim();
    const rows = lines.map(l => `• ${clean(T.tradeOk(l.trade) ? tradeName(l.trade) : l.trade)}${l.description ? ': ' + clean(l.description) : ''}`).filter(x => x.length > 3);
    return { scope_text: [clean(job.description), ...rows].filter(Boolean).join('\n') };
  });
}
const TRADE_ES = { planos: 'Planos y permisos', demolicion: 'Demolición', excavacion: 'Excavación y base', concreto: 'Concreto', carpinteria: 'Carpintería / estructura', techo: 'Techo', electricidad: 'Electricidad', av: 'Audio / video', plomeria: 'Plomería', gas: 'Gas', piedra: 'Piedra / mampostería', cubierta: 'Cubierta / granito', drywall: 'Drywall / acabados', azulejo: 'Azulejo', gabinetes: 'Gabinetes', pisos: 'Pisos', pintura: 'Pintura / stain', vidrio: 'Vidrio', equipos: 'Equipos', paisajismo: 'Paisajismo', limpieza: 'Limpieza', otro: 'Otro' };
const tradeName = k => TRADE_ES[k] || k;
module.exports = { routes, invoiceFromProposal, invoiceNumber, KINDS };
