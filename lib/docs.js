'use strict';
// Fase 7, parte 2 — Documentos.
//  1) Papeles de la compañía: licencias, seguros, registro en cada ciudad, W-9 de la compañía… con fecha de vencimiento.
//     Avisa 30 días antes y el día que vence (a los dueños y a la oficina). Los manejan los dueños y Administración;
//     el PM y la contadora los ven (el PM los necesita para sacar permisos). Solo un dueño los borra.
//  2) Contrato de cada obra: se genera de la plantilla con los datos de la obra (o se sube el firmado). Al marcarlo
//     "firmado" ya no se cambia ni se borra. El cliente lo ve si se le comparte; los subs nunca (lleva precio).
//  3) Plantillas: contrato, change order y certificado de garantía, con los datos de la obra llenados solos.
//     Los dueños pueden cambiar el texto (que su abogado lo revise). Salen en PDF listo para firmar.
//  4) Garantías de cada obra: la garantía de trabajo (1 año desde que se terminó) y las de fábrica de lo que se
//     instaló (calentadores, ventiladores, etc.) con su fecha de vencimiento. El cliente las ve en su portal.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { notify, owners } = require('./push');

const TZ = () => process.env.APP_TZ || 'America/Chicago';
const todayL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMonths = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX = 25 * 1024 * 1024;
const KINDS = ['licencia', 'seguro', 'registro', 'w9', 'contrato', 'otro'];
const usd = c => (Number(c || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fdEn = iso => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || '—'; const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const looksLike = (buf, mime) => mime === 'application/pdf' ? buf.slice(0, 5).toString() === '%PDF-'
  : mime === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 : mime === 'image/png' ? buf.slice(0, 4).toString('hex') === '89504e47'
    : mime === 'image/webp' ? buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP' : false;

// Estado de un papel según su fecha de vencimiento.
const stateOf = (expires, today = todayL()) => !expires ? 'sin_fecha' : expires < today ? 'vencido' : expires <= addDays(today, 30) ? 'por_vencer' : 'vigente';

// ===== Plantillas (en inglés por omisión: el cliente firma en inglés; se pueden cambiar) =====
const DEFAULTS = {
  contrato: { title: 'Construction agreement', body: `# CONSTRUCTION AGREEMENT
This agreement is made on {{today}} between {{company_name}} ("Contractor") and {{client_name}} ("Owner") for the work described below at {{job_address}} (Project {{job_code}}).

## 1. Scope of work
{{description}}
{{scope}}

## 2. Contract price
The contract price is {{contract_total}}.

## 3. Payment schedule
{{payment_schedule}}

## 4. Schedule
Estimated start: {{start_date}}. Estimated completion: {{end_date}}. Dates may change because of weather, permits, inspections or material availability.

## 5. Change orders
Any change to the scope or the price must be agreed in a written change order signed by both parties before that work is done.

## 6. Permits and inspections
Contractor will obtain the permits and inspections the city requires for this work, unless both parties agree otherwise in writing.

## 7. Warranty
Contractor warrants its workmanship for {{warranty_months}} months from the date the work is completed. Manufacturer warranties on installed products are passed on to the Owner.

{{signatures}}` },
  change_order: { title: 'Change order', body: `# CHANGE ORDER {{co_code}}
Project {{job_code}} · {{job_address}}
Owner: {{client_name}} · Date: {{today}}

## Change
{{co_description}}

## Price
Amount of this change order: {{co_price}}
Original contract: {{contract_total}}
New contract total with all approved change orders and this one: {{new_total}}

This change order becomes part of the construction agreement once it is signed by both parties.

{{signatures}}` },
  garantia: { title: 'Warranty certificate', body: `# WARRANTY CERTIFICATE
{{company_name}} warrants the workmanship of the project below for {{warranty_months}} months from completion.

Owner: {{client_name}}
Property: {{job_address}}
Project: {{job_code}} · {{project_type}}
Completed: {{completed_date}}
Workmanship warranty valid until: {{warranty_until}}

## Covered
Defects in the workmanship performed by {{company_name}} under normal use.

## Not covered
Normal wear, damage caused by others or by misuse, and severe weather events. Products are covered by their manufacturer's warranty.

## Manufacturer warranties
{{factory_warranties}}

To request warranty service, contact {{company_name}}{{company_phone_sentence}}.

{{signatures}}` },
};
const KEYS = Object.keys(DEFAULTS);

function routes(db, add, h) {
  const { requireRole, fail, str, intId, date, jobOr404 } = h;
  const dir = path.join(db.dataDir, 'company-docs'); fs.mkdirSync(dir, { recursive: true });
  const jdir = path.join(db.dataDir, 'job-docs'); fs.mkdirSync(jdir, { recursive: true });
  const meta = k => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value || '';
  const who = u => u.officeId || u.pmId || u.id;
  const humanOwner = u => u.role === 'owner' && !u.isPm && !u.is_agent && !u.isOffice;
  const canManage = u => humanOwner(u) || (u.isOffice && u.office === 'admin');
  const canSee = u => u.role === 'owner' || u.role === 'pm';
  const audit = (u, action, entity, id, jobId, summary) => db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary,amount_cents) VALUES(?,?,?,?,?,?,0)').run(who(u), action, entity, id, jobId, summary);
  const saveFile = (dataUrl, where) => {
    const m = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) fail(400, 'Archivo inválido (use PDF o foto)');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX) fail(413, 'El archivo es muy grande (máximo 25 MB)');
    if (!looksLike(buf, m[1])) fail(400, 'Archivo inválido (use PDF o foto)');
    const name = `${crypto.randomBytes(12).toString('hex')}.${EXT[m[1]]}`;
    fs.writeFileSync(path.join(where, name), buf);
    return { file: name, mime: m[1], size: buf.length };
  };

  // ===== 1) Papeles de la compañía =====
  const cdOut = d => ({ ...d, file: undefined, has_file: !!d.file, state: stateOf(d.expires), by: (db.prepare('SELECT name FROM users WHERE id=?').get(d.created_by) || {}).name || '' });
  add('GET', '/api/company-docs', ({ user }) => {
    requireRole(user, 'owner', 'pm');
    const rows = db.prepare("SELECT * FROM company_docs ORDER BY CASE WHEN expires='' THEN 1 ELSE 0 END, expires, title").all().map(cdOut);
    return { docs: rows, kinds: KINDS, alerts: rows.filter(d => ['vencido', 'por_vencer'].includes(d.state)).length, can_manage: canManage(user) };
  });
  const cdFields = (b, cur = {}) => {
    const f = {
      kind: 'kind' in b ? (KINDS.includes(b.kind) ? b.kind : fail(400, 'Tipo de documento inválido')) : cur.kind || 'otro',
      title: 'title' in b ? (str(b.title, 140) || fail(400, 'Escriba el nombre del documento')) : cur.title,
      number: 'number' in b ? str(b.number, 60) : cur.number || '', city: 'city' in b ? str(b.city, 80) : cur.city || '',
      issued: 'issued' in b ? (b.issued ? date(b.issued, 'fecha') : '') : cur.issued || '',
      expires: 'expires' in b ? (b.expires ? date(b.expires, 'vencimiento') : '') : cur.expires || '',
      notes: 'notes' in b ? str(b.notes, 1000) : cur.notes || '',
    };
    if (!f.title) fail(400, 'Escriba el nombre del documento');
    return f;
  };
  add('POST', '/api/company-docs', ({ user, body }) => {
    requireRole(user, 'owner'); if (!canManage(user)) fail(403, 'Los papeles de la compañía los manejan los dueños y la oficina');
    const f = cdFields(body); const file = body.file ? saveFile(body.file, dir) : { file: '', mime: '', size: 0 };
    const id = Number(db.prepare('INSERT INTO company_docs(kind,title,number,city,issued,expires,notes,file,mime,size,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(f.kind, f.title, f.number, f.city, f.issued, f.expires, f.notes, file.file, file.mime, file.size, who(user)).lastInsertRowid);
    audit(user, 'crear', 'papel de la compañía', id, null, `${f.title}${f.expires ? ' · vence ' + f.expires : ''}`);
    return cdOut(db.prepare('SELECT * FROM company_docs WHERE id=?').get(id));
  });
  add('PUT', '/api/company-docs/:id', ({ user, params, body }) => {
    requireRole(user, 'owner'); if (!canManage(user)) fail(403, 'Los papeles de la compañía los manejan los dueños y la oficina');
    const d = db.prepare('SELECT * FROM company_docs WHERE id=?').get(intId(params.id)); if (!d) fail(404, 'No encontrado');
    const f = cdFields(body, d); const file = body.file ? saveFile(body.file, dir) : null;
    // Si se renueva (cambia el vencimiento o el archivo), los avisos empiezan de nuevo.
    const renewed = f.expires !== d.expires || !!file;
    db.prepare('UPDATE company_docs SET kind=?,title=?,number=?,city=?,issued=?,expires=?,notes=?,file=?,mime=?,size=?,updated_at=datetime(\'now\'),alert30_at=?,alert0_at=? WHERE id=?')
      .run(f.kind, f.title, f.number, f.city, f.issued, f.expires, f.notes, file ? file.file : d.file, file ? file.mime : d.mime, file ? file.size : d.size,
        renewed ? '' : d.alert30_at, renewed ? '' : d.alert0_at, d.id);
    if (file && d.file) { try { fs.unlinkSync(path.join(dir, d.file)); } catch { /* */ } }
    audit(user, 'editar', 'papel de la compañía', d.id, null, `${f.title}${f.expires !== d.expires ? ` · vencimiento ${d.expires || '—'} → ${f.expires || '—'}` : ''}${file ? ' · archivo nuevo' : ''}`);
    return cdOut(db.prepare('SELECT * FROM company_docs WHERE id=?').get(d.id));
  });
  add('DELETE', '/api/company-docs/:id', ({ user, params }) => {
    requireRole(user, 'owner'); if (!humanOwner(user)) fail(403, 'Solo un dueño borra un papel de la compañía');
    const d = db.prepare('SELECT * FROM company_docs WHERE id=?').get(intId(params.id)); if (!d) fail(404, 'No encontrado');
    db.prepare('DELETE FROM company_docs WHERE id=?').run(d.id);
    if (d.file) { try { fs.unlinkSync(path.join(dir, d.file)); } catch { /* */ } }
    audit(user, 'borrar', 'papel de la compañía', d.id, null, d.title);
    return { ok: true };
  });
  add('GET', '/api/company-docs/:id/file', ({ user, params, query }) => {
    requireRole(user, 'owner', 'pm');
    const d = db.prepare('SELECT * FROM company_docs WHERE id=?').get(intId(params.id)); if (!d || !d.file) fail(404, 'No encontrado');
    return { $buffer: fs.readFileSync(path.join(dir, d.file)), $type: d.mime, $name: `${d.title}`.replace(/[^\w.-]+/g, '_').slice(0, 80) + '.' + EXT[d.mime], $attach: query.get('download') === '1' };
  });

  // ===== 3) Plantillas =====
  const tpl = key => {
    const r = db.prepare('SELECT * FROM doc_templates WHERE key=?').get(key);
    return { key, title: (r && r.title) || DEFAULTS[key].title, body: (r && r.body) || DEFAULTS[key].body, custom: !!r, updated_at: r ? r.updated_at : '' };
  };
  add('GET', '/api/doc-templates', ({ user }) => {
    requireRole(user, 'owner'); if (user.isOffice) fail(403, 'Esto no es parte de su puesto');
    return { templates: KEYS.map(tpl), fields: FIELDS };
  });
  add('PUT', '/api/doc-templates/:key', ({ user, params, body }) => {
    requireRole(user, 'owner'); if (!humanOwner(user)) fail(403, 'Las plantillas las cambian los dueños');
    const key = KEYS.includes(params.key) ? params.key : fail(404, 'No encontrado');
    if (body.reset) { db.prepare('DELETE FROM doc_templates WHERE key=?').run(key); return tpl(key); }
    const text = String(body.body || '').slice(0, 30000);
    if (text.trim().length < 20) fail(400, 'Escriba el texto de la plantilla');
    db.prepare("INSERT INTO doc_templates(key,title,body,updated_by,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET title=excluded.title, body=excluded.body, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
      .run(key, str(body.title, 100) || DEFAULTS[key].title, text, who(user));
    audit(user, 'editar', 'plantilla', 0, null, `Plantilla ${DEFAULTS[key].title}`);
    return tpl(key);
  });
  // Los datos de la obra que se llenan solos.
  // Lo que escribió la gente va traducido al inglés si ya hay traducción (el documento lo firma el cliente).
  const EN = s => s ? require('./history').inLang(db, s, 'en') : '';
  const values = (job, co) => {
    const B = require('./billing').billing(db, job.id);
    const C = require('./catalog');
    const company = require('./company').info(db);
    const wm = C.WARRANTY_MONTHS || 12;
    const until = job.completed_date ? addMonths(job.completed_date, wm) : '';
    const type = (C.PROJECT_TYPES.find(p => p.key === job.project_type) || {}).en || job.project_type || '';
    const factory = db.prepare('SELECT * FROM job_warranties WHERE job_id=? ORDER BY expires, id').all(job.id);
    const v = {
      company_name: company.name, company_city: company.city || '', company_phone: meta('company_phone'),
      company_phone_sentence: meta('company_phone') ? ` at ${meta('company_phone')}` : '',
      client_name: job.client_name || '', client_phone: job.client_phone || '', client_email: job.client_email || '', job_address: job.address || '',
      job_code: require('./scan').jobCode(job.id), project_type: type, description: EN(job.description), scope: EN(job.scope_text),
      contract_total: usd(B.contract_cents), new_total: usd(B.total_cents), start_date: fdEn(job.start_date), end_date: fdEn(job.end_date), today: fdEn(todayL()),
      warranty_months: String(wm), completed_date: fdEn(job.completed_date), warranty_until: fdEn(until),
      payment_schedule: B.milestones.length ? B.milestones.map(m => `- ${m.label}: ${m.pct}% (${usd(m.amount_cents)})`).join('\n') : `- ${usd(B.contract_cents)} as agreed.`,
      factory_warranties: factory.length ? factory.map(w => `- ${[w.item, w.brand, w.model].filter(Boolean).join(' · ')}${w.serial ? ` (S/N ${w.serial})` : ''}: until ${fdEn(w.expires)}`).join('\n') : '- None recorded.',
      co_code: co ? co.code : '', co_description: co ? EN(co.description) : '', co_price: co ? usd(co.price_cents) : '',
    };
    if (co) v.new_total = usd(B.total_cents + (co.status === 'aprobado' ? 0 : co.price_cents));
    return v;
  };
  const fill = (text, v) => String(text).replace(/\{\{(\w+)\}\}/g, (m, k) => k === 'signatures' ? m : (k in v ? v[k] : m));
  // PDF de una plantilla ya llenada.
  const render = (title, text, co) => {
    const { PDF, wrap } = require('./pdf');
    const doc = new PDF(); const M = 56, R = 612 - 56, Hh = 792; let y = 50;
    const room = n => { if (y + n > Hh - 60) { doc.addPage(); y = 50; } };
    doc.text(M, y, co.name || '', { size: 10, bold: true, color: '#666660' }); y += 22;
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (line.trim() === '{{signatures}}') {
        room(110); y += 30;
        const w = (R - M - 40) / 2;
        [['Owner', 'Client name'], ['Contractor', co.name]].forEach(([l, n], i) => {
          const x = M + i * (w + 40);
          doc.line(x, y, x + w, y, { width: 0.8, color: '#181818' });
          doc.text(x, y + 6, `${l} signature`, { size: 8.5, color: '#666660' });
          doc.line(x, y + 46, x + w, y + 46, { width: 0.8, color: '#181818' });
          doc.text(x, y + 52, i === 0 ? 'Printed name · Date' : `${n} · Date`, { size: 8.5, color: '#666660' });
        });
        y += 80; continue;
      }
      if (!line.trim()) { y += 8; continue; }
      if (line.startsWith('# ')) { room(34); doc.text(M, y, line.slice(2), { size: 17, bold: true, color: '#02175D' }); y += 30; continue; }
      if (line.startsWith('## ')) { room(26); y += 4; doc.text(M, y, line.slice(3), { size: 11.5, bold: true, color: '#02175D' }); y += 18; continue; }
      const bullet = line.startsWith('- ');
      const ws = wrap(bullet ? line.slice(2) : line, 10.5, R - M - (bullet ? 14 : 0));
      ws.forEach((w, i) => { room(15); doc.text(M + (bullet ? 14 : 0), y, (bullet && i === 0 ? '• ' : '') + w, { size: 10.5 }); y += 14.5; });
    }
    doc.pages.forEach(p => p.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg 56 28 Td (${(co.name || '').replace(/[()\\]/g, '')} · ${title.replace(/[()\\]/g, '')}) Tj ET`));
    return doc.toBuffer();
  };
  // Generar el documento de una obra: queda en sus documentos (sin compartir hasta que la compañía decida).
  add('POST', '/api/jobs/:id/generate', ({ user, params, body }) => {
    requireRole(user, 'owner'); if (user.isOffice) fail(403, 'Esto no es parte de su puesto');
    const job = jobOr404(db, user, intId(params.id));
    const key = KEYS.includes(body.template) ? body.template : fail(400, 'Plantilla inválida');
    let co = null;
    if (key === 'change_order') {
      co = db.prepare('SELECT * FROM change_orders WHERE id=? AND job_id=?').get(intId(body.co_id), job.id) || fail(400, 'Escoja el change order');
    }
    if (key === 'garantia' && !job.completed_date) fail(400, 'La garantía empieza cuando la obra se termina: ponga la fecha en que se terminó');
    const t = tpl(key); const company = require('./company').info(db);
    const text = fill(t.body, values(job, co));
    const title = key === 'change_order' ? `Change order ${co.code || co.id}` : `${t.title} · ${require('./scan').jobCode(job.id)}`;
    const buf = render(title, text, company);
    const name = `${crypto.randomBytes(12).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(jdir, name), buf);
    const kind = key === 'garantia' ? 'garantia' : 'contrato'; // el change order va con el contrato: lleva precio, los subs nunca lo ven
    const id = Number(db.prepare('INSERT INTO job_docs(job_id,kind,title,number,file,mime,size,share_subs,share_client,created_by) VALUES(?,?,?,?,?,?,?,0,0,?)')
      .run(job.id, kind, title, co ? (co.code || '') : '', name, 'application/pdf', buf.length, who(user)).lastInsertRowid);
    audit(user, 'crear', 'documento de obra', id, job.id, `Documento generado: ${title}`);
    return { id, title, kind };
  });
  // El contrato quedó firmado: ya no se cambia ni se borra.
  add('POST', '/api/job-docs/:id/signed', ({ user, params, body }) => {
    requireRole(user, 'owner'); if (!humanOwner(user)) fail(403, 'Marcar el contrato como firmado lo hace un dueño');
    const d = db.prepare('SELECT * FROM job_docs WHERE id=?').get(intId(params.id)); if (!d) fail(404, 'No encontrado');
    jobOr404(db, user, d.job_id);
    if (!['contrato', 'garantia'].includes(d.kind)) fail(400, 'Solo un contrato, change order o garantía se marca firmado');
    if (d.status === 'aprobado') fail(400, 'Ya está marcado como firmado');
    const file = body.file ? saveFile(body.file, jdir) : null;
    db.prepare("UPDATE job_docs SET status='aprobado', approved_by=?, approved_at=datetime('now'), file=?, mime=?, size=? WHERE id=?")
      .run(who(user), file ? file.file : d.file, file ? file.mime : d.mime, file ? file.size : d.size, d.id);
    audit(user, 'aprobar', 'documento de obra', d.id, d.job_id, `Firmado: ${d.title}${file ? ' (copia firmada subida)' : ''}`);
    return { ok: true };
  });

  // ===== 4) Garantías de cada obra =====
  const wOut = (w, user) => ({ id: w.id, item: w.item, brand: w.brand, model: w.model, serial: w.serial, starts: w.starts, expires: w.expires, notes: user.role === 'client' ? '' : w.notes,
    has_file: !!w.file, state: stateOf(w.expires) });
  add('GET', '/api/jobs/:id/warranties', ({ user, params }) => {
    requireRole(user, 'owner', 'pm', 'client');
    const job = jobOr404(db, user, intId(params.id));
    const wm = require('./catalog').WARRANTY_MONTHS || 12;
    const until = job.completed_date ? addMonths(job.completed_date, wm) : '';
    return { workmanship: { months: wm, completed: job.completed_date || '', until, state: until ? stateOf(until) : 'sin_fecha' },
      items: db.prepare('SELECT * FROM job_warranties WHERE job_id=? ORDER BY expires, id').all(job.id).map(w => wOut(w, user)) };
  });
  const wFields = (b, cur = {}) => {
    const f = { item: 'item' in b ? (str(b.item, 140) || fail(400, 'Escriba qué es (por ejemplo, Calentador)')) : cur.item,
      brand: 'brand' in b ? str(b.brand, 80) : cur.brand || '', model: 'model' in b ? str(b.model, 80) : cur.model || '', serial: 'serial' in b ? str(b.serial, 80) : cur.serial || '',
      starts: 'starts' in b ? (b.starts ? date(b.starts, 'inicio') : '') : cur.starts || '', notes: 'notes' in b ? str(b.notes, 1000) : cur.notes || '' };
    if (!f.item) fail(400, 'Escriba qué es (por ejemplo, Calentador)');
    let exp = 'expires' in b ? (b.expires ? date(b.expires, 'vencimiento') : '') : cur.expires || '';
    if (!exp && b.years && f.starts) exp = addMonths(f.starts, Math.round(Number(b.years) * 12));
    if (!exp) fail(400, 'Ponga hasta cuándo es la garantía (o el inicio y los años)');
    f.expires = exp;
    return f;
  };
  add('POST', '/api/jobs/:id/warranties', ({ user, params, body }) => {
    requireRole(user, 'owner'); if (user.isOffice) fail(403, 'Esto no es parte de su puesto');
    const job = jobOr404(db, user, intId(params.id));
    const f = wFields(body); const file = body.file ? saveFile(body.file, jdir) : { file: '', mime: '', size: 0 };
    const id = Number(db.prepare('INSERT INTO job_warranties(job_id,item,brand,model,serial,starts,expires,notes,file,mime,size,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(job.id, f.item, f.brand, f.model, f.serial, f.starts, f.expires, f.notes, file.file, file.mime, file.size, who(user)).lastInsertRowid);
    audit(user, 'crear', 'garantía', id, job.id, `Garantía de fábrica: ${f.item} hasta ${f.expires}`);
    return wOut(db.prepare('SELECT * FROM job_warranties WHERE id=?').get(id), user);
  });
  add('PUT', '/api/warranties/:id', ({ user, params, body }) => {
    requireRole(user, 'owner'); if (user.isOffice) fail(403, 'Esto no es parte de su puesto');
    const w = db.prepare('SELECT * FROM job_warranties WHERE id=?').get(intId(params.id)); if (!w) fail(404, 'No encontrado');
    jobOr404(db, user, w.job_id);
    const f = wFields(body, w); const file = body.file ? saveFile(body.file, jdir) : null;
    db.prepare('UPDATE job_warranties SET item=?,brand=?,model=?,serial=?,starts=?,expires=?,notes=?,file=?,mime=?,size=?,alert_at=? WHERE id=?')
      .run(f.item, f.brand, f.model, f.serial, f.starts, f.expires, f.notes, file ? file.file : w.file, file ? file.mime : w.mime, file ? file.size : w.size, f.expires !== w.expires ? '' : w.alert_at, w.id);
    return wOut(db.prepare('SELECT * FROM job_warranties WHERE id=?').get(w.id), user);
  });
  add('DELETE', '/api/warranties/:id', ({ user, params }) => {
    requireRole(user, 'owner'); if (!humanOwner(user)) fail(403, 'Solo un dueño borra una garantía');
    const w = db.prepare('SELECT * FROM job_warranties WHERE id=?').get(intId(params.id)); if (!w) fail(404, 'No encontrado');
    jobOr404(db, user, w.job_id);
    db.prepare('DELETE FROM job_warranties WHERE id=?').run(w.id);
    audit(user, 'borrar', 'garantía', w.id, w.job_id, `Garantía de fábrica: ${w.item}`);
    return { ok: true };
  });
  add('GET', '/api/warranties/:id/file', ({ user, params }) => {
    requireRole(user, 'owner', 'pm', 'client');
    const w = db.prepare('SELECT * FROM job_warranties WHERE id=?').get(intId(params.id)); if (!w || !w.file) fail(404, 'No encontrado');
    jobOr404(db, user, w.job_id);
    return { $buffer: fs.readFileSync(path.join(jdir, w.file)), $type: w.mime, $name: `warranty-${w.item}`.replace(/[^\w.-]+/g, '_').slice(0, 80) + '.' + EXT[w.mime] };
  });
}

const FIELDS = ['company_name', 'company_city', 'company_phone', 'client_name', 'client_phone', 'client_email', 'job_address', 'job_code', 'project_type', 'description', 'scope',
  'contract_total', 'payment_schedule', 'new_total', 'start_date', 'end_date', 'today', 'warranty_months', 'completed_date', 'warranty_until', 'factory_warranties',
  'co_code', 'co_description', 'co_price', 'signatures'];

// Avisos: papeles de la compañía 30 días antes y el día que vencen; garantías de fábrica 30 días antes.
function tick(db) {
  const today = todayL(), soon = addDays(today, 30);
  const to = [...owners(db), ...db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").all().map(r => r.id)];
  let n = 0;
  for (const d of db.prepare("SELECT * FROM company_docs WHERE expires<>''").all()) {
    if (d.expires < today && !d.alert0_at) {
      db.prepare("UPDATE company_docs SET alert0_at=datetime('now'), alert30_at=CASE WHEN alert30_at='' THEN datetime('now') ELSE alert30_at END WHERE id=?").run(d.id);
      if (to.length) notify(db, to, 'doc_expired', { x: d.title, d: d.expires }, '#/documentos'); n++;
    } else if (d.expires >= today && d.expires <= soon && !d.alert30_at) {
      db.prepare("UPDATE company_docs SET alert30_at=datetime('now') WHERE id=?").run(d.id);
      if (to.length) notify(db, to, 'doc_expiring', { x: d.title, d: d.expires }, '#/documentos'); n++;
    }
  }
  for (const w of db.prepare("SELECT w.*, j.client_name FROM job_warranties w JOIN jobs j ON j.id=w.job_id WHERE w.expires>=? AND w.expires<=? AND w.alert_at=''").all(today, soon)) {
    db.prepare("UPDATE job_warranties SET alert_at=datetime('now') WHERE id=?").run(w.id);
    const own = owners(db); if (own.length) notify(db, own, 'warranty_expiring', { x: w.item, job: w.client_name, d: w.expires }, `#/obra/${w.job_id}/documentos`); n++;
  }
  return n;
}

module.exports = { routes, tick, DEFAULTS, KEYS, stateOf, KINDS };
