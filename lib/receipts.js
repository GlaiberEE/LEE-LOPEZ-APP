'use strict';
// Tickets (recibos) y gastos generales de la empresa.
//  - Un ticket: tienda, número de ticket, fecha, forma de pago, foto, subtotal + impuesto (8.25% por defecto, se puede
//    cambiar por compañía) = total.
//  - Se divide en renglones: a una obra (con su partida y categoría), a gasto general de la empresa (la herramienta va
//    aquí), o personal (no se registra como gasto, solo queda anotado).
//  - Bloqueo de duplicados: la misma tienda + el mismo número de ticket no entra dos veces. Solo un dueño puede pasarlo,
//    escribiendo el motivo (queda en el historial). Sin número de ticket, se avisa si hay otro con el mismo total, fecha y tienda.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('./catalog');
const { tx } = require('./db');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const vkey = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
  .replace(/^thehomedepot/, 'homedepot').replace(/^lowes(homeimprovement)?.*/, 'lowes');
const tkey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
const getMeta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
// Impuesto en "puntos base" (825 = 8.25%).
const taxRate = db => { const v = Number(getMeta(db, 'tax_rate_bp')); return Number.isFinite(v) && v >= 0 && v <= 2000 ? v : 825; };
const usd = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Reparte el impuesto entre renglones en proporción al subtotal; lo que sobra del redondeo va al renglón más grande.
function splitTax(lines, tax) {
  const sub = lines.reduce((a, l) => a + l.subtotal_cents, 0);
  const out = lines.map(l => (sub ? Math.floor((tax * l.subtotal_cents) / sub) : 0));
  let rest = tax - out.reduce((a, b) => a + b, 0);
  const order = lines.map((l, i) => i).sort((a, b) => lines[b].subtotal_cents - lines[a].subtotal_cents);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k]]++;
  return out;
}

module.exports = function receiptRoutes(db, add, H) {
  const { requireRole, fail, str, date, needDate, oneOf, intId, cents, canSeeJob, today, saveImage } = H;
  const dir = path.join(db.dataDir, 'receipts');
  fs.mkdirSync(dir, { recursive: true });
  // v2.33: las listas las ajusta cada compañía (lib/lists.js); se leen al momento.
  const LI = require('./lists');
  const humanOwner = u => u.role === 'owner' && !u.isPm && !u.is_agent;
  const lockDate = () => getMeta(db, 'lock_date') || '';
  const checkLock = d => { const L = lockDate(); if (L && d && d <= L) fail(423, `Periodo cerrado hasta el ${L}: no se puede crear, cambiar ni borrar nada con esa fecha o antes.`); };
  const log = (u, action, entity, id, summary, amount, reason = '') => db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,summary,amount_cents,reason) VALUES(?,?,?,?,?,?,?)')
    .run(u.pmId || u.id, action, entity, id, String(summary).slice(0, 400), amount || 0, reason);

  const readFile = dataUrl => {
    const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) fail(400, 'Archivo inválido (use foto o PDF)');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 9 * 1024 * 1024) fail(413, 'Archivo demasiado grande');
    if (m[1] === 'application/pdf' ? buf.slice(0, 5).toString() !== '%PDF-' : m[1] === 'image/jpeg' && !(buf[0] === 0xff && buf[1] === 0xd8)) fail(400, 'El archivo no es una imagen válida');
    return { buf, mime: m[1] };
  };

  // ¿Ya existe este ticket? (misma tienda + mismo número; o, sin número, mismo total + fecha + tienda)
  function findDup({ vendor, ticket, date: d, total }) {
    const vk = vkey(vendor), tk = tkey(ticket);
    if (tk) {
      const r = db.prepare('SELECT * FROM receipts WHERE ticket_key=? AND (vendor_key=? OR vendor_key=\'\' OR ?=\'\') ORDER BY id LIMIT 1').get(tk, vk, vk);
      if (r) return { kind: 'ticket', receipt_id: r.id, date: r.date, total_cents: r.total_cents, vendor: r.vendor, ticket: r.ticket };
      const e = db.prepare("SELECT e.id, e.date, e.amount_cents, e.vendor, e.ticket, j.client_name FROM expenses e JOIN jobs j ON j.id=e.job_id WHERE e.ticket<>''").all()
        .find(x => tkey(x.ticket) === tk && (!vk || !vkey(x.vendor) || vkey(x.vendor) === vk));
      if (e) return { kind: 'ticket', expense_id: e.id, date: e.date, total_cents: e.amount_cents, vendor: e.vendor, ticket: e.ticket, job: e.client_name };
      return null;
    }
    const r = db.prepare('SELECT * FROM receipts WHERE total_cents=? AND date=?').all(total, d).find(x => !vk || !x.vendor_key || x.vendor_key === vk);
    if (r) return { kind: 'posible', receipt_id: r.id, date: r.date, total_cents: r.total_cents, vendor: r.vendor, ticket: r.ticket };
    const e = db.prepare('SELECT id, date, amount_cents, vendor FROM expenses WHERE amount_cents=? AND date=?').all(total, d).find(x => !vk || !vkey(x.vendor) || vkey(x.vendor) === vk);
    return e ? { kind: 'posible', expense_id: e.id, date: e.date, total_cents: e.amount_cents, vendor: e.vendor } : null;
  }

  add('GET', '/api/receipts/settings', ({ user }) => {
    requireRole(user, 'owner', 'worker');
    const used = db.prepare("SELECT vendor, COUNT(*) n FROM (SELECT vendor FROM receipts UNION ALL SELECT vendor FROM expenses WHERE vendor<>'') GROUP BY lower(vendor) ORDER BY n DESC LIMIT 30").all().map(r => r.vendor).filter(Boolean);
    const vendors = [...C.DEFAULT_VENDORS]; for (const v of used) if (!vendors.some(x => vkey(x) === vkey(v))) vendors.push(v);
    return { tax_rate_bp: taxRate(db), vendors, company: humanOwner(user) };
  });
  add('PUT', '/api/receipts/settings', ({ user, body }) => {
    requireRole(user, 'owner'); if (!humanOwner(user)) fail(403, 'Esto solo lo pueden hacer los dueños');
    const v = Math.round(Number(body.tax_rate_bp));
    if (!Number.isFinite(v) || v < 0 || v > 2000) fail(400, 'Impuesto inválido (0% a 20%)');
    db.prepare("INSERT INTO meta(key,value) VALUES('tax_rate_bp',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(v));
    log(user, 'editar', 'ajustes', 0, `Impuesto de tickets: ${(v / 100).toFixed(2)}%`, 0);
    return { tax_rate_bp: v };
  });

  // Registrar un ticket (con foto o desde un ticket escaneado) y repartirlo.
  add('POST', '/api/receipts', ({ user, body }) => {
    requireRole(user, 'owner', 'worker');
    const vendor = str(body.vendor, 120); if (!vendor) fail(400, 'Escriba la tienda o proveedor');
    const ticket = str(body.ticket, 40);
    const d = needDate(body.date || today(), 'fecha'); checkLock(d);
    const pay = body.pay_method ? oneOf(body.pay_method, LI.keys(db, 'pago'), 'forma de pago') : '';
    const subtotal = cents(body.subtotal_cents, 'subtotal'); if (!subtotal) fail(400, 'Escriba el subtotal del ticket');
    const tax = body.tax_cents == null || body.tax_cents === '' ? Math.round((subtotal * taxRate(db)) / 10000) : cents(body.tax_cents, 'impuesto');
    const total = subtotal + tax;
    const raw = Array.isArray(body.lines) && body.lines.length ? body.lines : fail(400, 'Diga a qué obra va el ticket');
    if (raw.length > 30) fail(400, 'Demasiados renglones');
    const lines = raw.map(l => {
      const kind = oneOf(l.kind || 'obra', ['obra', 'empresa', 'personal'], 'tipo de renglón');
      const sub = cents(l.subtotal_cents, 'monto del renglón'); if (!sub) fail(400, 'Cada renglón necesita su monto');
      if (kind === 'obra') {
        const jobId = intId(l.job_id); if (!canSeeJob(db, user, jobId)) fail(404, 'Obra no encontrada');
        let cat = oneOf(l.category || 'material', LI.keys(db, 'gasto'), 'categoría');
        if (cat === 'subcontratistas') fail(400, 'Los pagos a subs se registran en Subcontratistas, no con un ticket');
        if (user.role === 'worker' && cat === 'mano_obra') cat = 'otro';
        const lineId = l.line_id ? intId(l.line_id) : null;
        if (lineId && !db.prepare('SELECT 1 FROM job_lines WHERE id=? AND job_id=?').get(lineId, jobId)) fail(400, 'Partida no válida para esa obra');
        return { kind, job_id: jobId, line_id: lineId, category: cat, description: str(l.description, 300), subtotal_cents: sub };
      }
      if (kind === 'empresa') {
        if (!humanOwner(user)) fail(403, 'Solo los dueños registran gastos generales de la empresa');
        return { kind, category: oneOf(l.category || 'herramienta', LI.keys(db, 'empresa'), 'categoría'), description: str(l.description, 300), subtotal_cents: sub };
      }
      return { kind, subtotal_cents: sub };
    });
    const sum = lines.reduce((a, l) => a + l.subtotal_cents, 0);
    if (sum !== subtotal) fail(400, `Los renglones suman ${usd(sum)} y el subtotal del ticket es ${usd(subtotal)}`, { lines_cents: sum, subtotal_cents: subtotal });
    if (!lines.some(l => l.kind !== 'personal')) fail(400, 'Un ticket solo personal no se registra');

    // Duplicados
    const dup = findDup({ vendor, ticket, date: d, total });
    const reason = str(body.dup_reason, 300);
    if (dup && dup.kind === 'ticket' && !(humanOwner(user) && reason.length >= 3))
      fail(409, `Ese ticket ya está registrado: ${dup.vendor || vendor} #${dup.ticket || ticket} del ${dup.date} por ${usd(dup.total_cents)}${dup.job ? ` (${dup.job})` : ''}.`, { duplicate: dup, canOverride: humanOwner(user) });
    if (dup && dup.kind === 'posible' && !body.confirm_dup && !reason)
      fail(409, `Parece repetido: ya hay un ticket de ${dup.vendor || vendor} del ${dup.date} por ${usd(dup.total_cents)}. Si es otro ticket, confírmelo.`, { duplicate: dup, possible: true });

    // Foto: nueva, o la del ticket escaneado.
    let file = null, scan = null;
    if (body.scan_id) {
      scan = db.prepare('SELECT * FROM scans WHERE id=?').get(intId(body.scan_id));
      if (!scan || (user.role !== 'owner' && scan.created_by !== user.id)) fail(404, 'Ticket no encontrado');
      if (scan.status === 'guardado') fail(400, 'Este ticket ya se guardó');
      file = { buf: fs.readFileSync(path.join(db.dataDir, 'scans', `${scan.id}.${EXT[scan.mime]}`)), mime: scan.mime };
    } else if (body.photo) file = readFile(body.photo);

    const taxes = splitTax(lines, tax);
    return tx(db, () => {
      const personal = lines.reduce((a, l, i) => a + (l.kind === 'personal' ? l.subtotal_cents + taxes[i] : 0), 0);
      const rid = Number(db.prepare(`INSERT INTO receipts(vendor,vendor_key,ticket,ticket_key,date,subtotal_cents,tax_cents,total_cents,personal_cents,pay_method,scan_id,dup_reason,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(vendor, vkey(vendor), ticket, tkey(ticket), d, subtotal, tax, total, personal, pay, scan ? scan.id : null, dup ? reason : '', user.id).lastInsertRowid);
      if (file) {
        const name = `${rid}-${crypto.randomBytes(6).toString('hex')}.${EXT[file.mime]}`;
        fs.writeFileSync(path.join(dir, name), file.buf);
        db.prepare('UPDATE receipts SET file=?, mime=? WHERE id=?').run(name, file.mime, rid);
      }
      const expenses = [], company = [];
      const boughtBy = str(body.bought_by, 80) || user.name;
      lines.forEach((l, i) => {
        const amount = l.subtotal_cents + taxes[i];
        if (l.kind === 'obra') {
          const desc = l.description || (raw.length > 1 ? `${vendor} #${ticket || rid} (parte)` : `Compra en ${vendor}`);
          const id = Number(db.prepare(`INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,created_by,reimburse,ticket,subtotal_cents,tax_cents,pay_method,receipt_id,line_id)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(l.job_id, d, l.category, desc, vendor, boughtBy, amount, user.id, pay === 'propio' ? 1 : 0, ticket, l.subtotal_cents, taxes[i], pay, rid, l.line_id).lastInsertRowid);
          if (user.role === 'worker') require('./review').mark(db, id);
          if (!l.line_id) { const g = require('./scan').guessLine(db, l.job_id, { description: desc, vendor, category: l.category }, { data: scan ? scan.data : 'null' }); if (g) db.prepare('UPDATE expenses SET line_id=? WHERE id=?').run(g, id); }
          // La foto queda pegada al gasto de cada obra (los recibos de una obra se ven ahí mismo).
          if (file) {
            const fid = crypto.randomBytes(16).toString('hex');
            fs.writeFileSync(path.join(db.dataDir, 'files', `${fid}.${EXT[file.mime]}`), file.buf);
            db.prepare("INSERT INTO files(id,job_id,expense_id,kind,mime,created_by) VALUES(?,?,?,'receipt',?,?)").run(fid, l.job_id, id, file.mime, user.id);
          }
          expenses.push(id);
        } else if (l.kind === 'empresa') {
          company.push(Number(db.prepare(`INSERT INTO company_expenses(date,category,description,vendor,ticket,pay_method,subtotal_cents,tax_cents,amount_cents,receipt_id,created_by)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(d, l.category, l.description || `Compra en ${vendor}`, vendor, ticket, pay, l.subtotal_cents, taxes[i], amount, rid, user.id).lastInsertRowid));
        }
      });
      if (scan) db.prepare("UPDATE scans SET status='guardado', job_id=?, expense_id=?, filed_at=datetime('now') WHERE id=?").run(lines.find(l => l.kind === 'obra')?.job_id || null, expenses[0] || null, scan.id);
      log(user, 'crear', 'ticket', rid, `Ticket ${vendor}${ticket ? ' #' + ticket : ''} ${usd(total)}: ${expenses.length} a obra(s), ${company.length} a la empresa${personal ? `, ${usd(personal)} personal` : ''}`, total, dup ? `Duplicado autorizado: ${reason}` : '');
      return { id: rid, total_cents: total, tax_cents: tax, personal_cents: personal, expenses, company };
    });
  });

  // Lista de tickets (para revisar la semana y conciliar contra la tarjeta).
  add('GET', '/api/receipts', ({ user, query }) => {
    requireRole(user, 'owner'); if (user.isPm) fail(403, 'Esto solo lo pueden ver los dueños');
    const from = date(query.get('from')) || '0000-01-01', to = date(query.get('to')) || '9999-12-31';
    return db.prepare('SELECT r.*, u.name by_name FROM receipts r LEFT JOIN users u ON u.id=r.created_by WHERE r.date BETWEEN ? AND ? ORDER BY r.date DESC, r.id DESC LIMIT 500').all(from, to).map(r => ({
      ...r, has_file: !!r.file,
      lines: [...db.prepare('SELECT e.id, e.job_id, j.client_name, e.category, e.amount_cents FROM expenses e JOIN jobs j ON j.id=e.job_id WHERE e.receipt_id=?').all(r.id).map(x => ({ kind: 'obra', ...x })),
        ...db.prepare('SELECT id, category, amount_cents FROM company_expenses WHERE receipt_id=?').all(r.id).map(x => ({ kind: 'empresa', ...x })),
        ...(r.personal_cents ? [{ kind: 'personal', amount_cents: r.personal_cents }] : [])],
    }));
  });
  add('GET', '/api/receipts/:id/file', ({ user, params }) => {
    requireRole(user, 'owner', 'worker');
    const r = db.prepare('SELECT * FROM receipts WHERE id=?').get(intId(params.id));
    if (!r || !r.file || (user.role !== 'owner' && r.created_by !== user.id) || (user.isPm && r.created_by !== user.pmId)) fail(404, 'No encontrado');
    return { $buffer: fs.readFileSync(path.join(dir, r.file)), $type: r.mime, $name: `ticket-${r.vendor}-${r.ticket || r.id}.${EXT[r.mime]}`.replace(/[^\w.-]+/g, '_') };
  });
  // Borrar un ticket borra sus renglones (gastos de obra y de empresa).
  add('DELETE', '/api/receipts/:id', ({ user, params }) => {
    requireRole(user, 'owner'); if (!humanOwner(user)) fail(403, 'Los recibos son comprobantes: solo los dueños los borran');
    const r = db.prepare('SELECT * FROM receipts WHERE id=?').get(intId(params.id)); if (!r) fail(404, 'No encontrado');
    checkLock(r.date);
    tx(db, () => {
      const files = db.prepare('SELECT f.id, f.mime FROM files f JOIN expenses e ON e.id=f.expense_id WHERE e.receipt_id=?').all(r.id);
      db.prepare('DELETE FROM expenses WHERE receipt_id=?').run(r.id);
      db.prepare('DELETE FROM company_expenses WHERE receipt_id=?').run(r.id);
      db.prepare('DELETE FROM receipts WHERE id=?').run(r.id);
      for (const f of files) { try { fs.unlinkSync(path.join(db.dataDir, 'files', `${f.id}.${EXT[f.mime] || 'jpg'}`)); } catch { /* */ } }
      if (r.file) { try { fs.unlinkSync(path.join(dir, r.file)); } catch { /* */ } }
      log(user, 'borrar', 'ticket', r.id, `Ticket ${r.vendor} #${r.ticket || r.id} ${usd(r.total_cents)}`, r.total_cents);
    });
    return { ok: true };
  });

  // ===== Gastos generales de la empresa =====
  const companyOwner = u => { requireRole(u, 'owner'); if (!humanOwner(u)) fail(403, 'Solo los dueños ven y registran gastos generales de la empresa'); };
  add('GET', '/api/company-expenses', ({ user, query }) => {
    companyOwner(user);
    const from = date(query.get('from')) || '0000-01-01', to = date(query.get('to')) || '9999-12-31';
    const cat = query.get('category') ? oneOf(query.get('category'), LI.keys(db, 'empresa'), 'categoría') : null;
    const rows = db.prepare(`SELECT c.*, r.file receipt_file FROM company_expenses c LEFT JOIN receipts r ON r.id=c.receipt_id WHERE c.date BETWEEN ? AND ? ${cat ? 'AND c.category=?' : ''} ORDER BY c.date DESC, c.id DESC`)
      .all(...[from, to, ...(cat ? [cat] : [])]).map(({ receipt_file, ...c }) => ({ ...c, has_file: !!receipt_file }));
    const byCat = {}; for (const c of rows) byCat[c.category] = (byCat[c.category] || 0) + c.amount_cents;
    return { rows, by_category: byCat, total_cents: rows.reduce((a, c) => a + c.amount_cents, 0) };
  });
  const cfields = b => {
    const f = { date: needDate(b.date || today(), 'fecha'), category: oneOf(b.category, LI.keys(db, 'empresa'), 'categoría'), description: str(b.description, 300) || fail(400, 'Escriba qué se compró'),
      vendor: str(b.vendor, 120), ticket: str(b.ticket, 40), pay_method: b.pay_method ? oneOf(b.pay_method, LI.keys(db, 'pago'), 'forma de pago') : '', amount_cents: cents(b.amount_cents, 'monto') };
    if (!f.amount_cents) fail(400, 'El monto debe ser mayor que cero');
    return f;
  };
  add('POST', '/api/company-expenses', ({ user, body }) => {
    companyOwner(user);
    const f = cfields(body); checkLock(f.date);
    const id = Number(db.prepare('INSERT INTO company_expenses(date,category,description,vendor,ticket,pay_method,amount_cents,created_by) VALUES(?,?,?,?,?,?,?,?)')
      .run(f.date, f.category, f.description, f.vendor, f.ticket, f.pay_method, f.amount_cents, user.id).lastInsertRowid);
    log(user, 'crear', 'gasto de empresa', id, `${f.description} ${usd(f.amount_cents)}`, f.amount_cents);
    return { id };
  });
  add('PUT', '/api/company-expenses/:id', ({ user, params, body }) => {
    companyOwner(user);
    const c = db.prepare('SELECT * FROM company_expenses WHERE id=?').get(intId(params.id)); if (!c) fail(404, 'No encontrado');
    checkLock(c.date);
    const f = cfields({ ...c, ...body }); checkLock(f.date);
    if (c.receipt_id && f.amount_cents !== c.amount_cents) fail(400, 'Este gasto viene de un ticket: para cambiar el monto, borre el ticket y regístrelo de nuevo');
    db.prepare('UPDATE company_expenses SET date=?,category=?,description=?,vendor=?,ticket=?,pay_method=?,amount_cents=? WHERE id=?').run(f.date, f.category, f.description, f.vendor, f.ticket, f.pay_method, f.amount_cents, c.id);
    log(user, 'editar', 'gasto de empresa', c.id, `${f.description} ${usd(f.amount_cents)}`, f.amount_cents);
    return { ok: true };
  });
  add('DELETE', '/api/company-expenses/:id', ({ user, params }) => {
    companyOwner(user);
    const c = db.prepare('SELECT * FROM company_expenses WHERE id=?').get(intId(params.id)); if (!c) fail(404, 'No encontrado');
    checkLock(c.date);
    if (c.receipt_id) fail(400, 'Este gasto viene de un ticket: borre el ticket completo');
    db.prepare('DELETE FROM company_expenses WHERE id=?').run(c.id);
    log(user, 'borrar', 'gasto de empresa', c.id, `${c.description} ${usd(c.amount_cents)}`, c.amount_cents);
    return { ok: true };
  });
  // Para la contadora: gastos de obra y de empresa del periodo en un CSV (los nombres de categoría en inglés).
  add('GET', '/api/accounting.csv', ({ user, query }) => {
    companyOwner(user);
    const from = date(query.get('from')) || '0000-01-01', to = date(query.get('to')) || '9999-12-31';
    const L = (list, k) => (list.find(x => x.key === k) || {}).en || k;
    const GC = LI.get(db, 'gasto'), EC = LI.get(db, 'empresa'), PM = LI.get(db, 'pago');
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Type', 'Job', 'Category', 'Description', 'Vendor', 'Ticket #', 'Payment', 'Subtotal', 'Tax', 'Total']];
    for (const e of db.prepare('SELECT e.*, j.client_name FROM expenses e JOIN jobs j ON j.id=e.job_id WHERE e.date BETWEEN ? AND ? ORDER BY e.date, e.id').all(from, to))
      rows.push([e.date, 'Job', e.client_name, L(GC, e.category), e.description, e.vendor, e.ticket, L(PM, e.pay_method), e.subtotal_cents != null ? (e.subtotal_cents / 100).toFixed(2) : '', e.tax_cents != null ? (e.tax_cents / 100).toFixed(2) : '', (e.amount_cents / 100).toFixed(2)]);
    for (const c of db.prepare('SELECT * FROM company_expenses WHERE date BETWEEN ? AND ? ORDER BY date, id').all(from, to))
      rows.push([c.date, 'Company (overhead)', '', L(EC, c.category), c.description, c.vendor, c.ticket, L(PM, c.pay_method), c.subtotal_cents ? (c.subtotal_cents / 100).toFixed(2) : '', c.tax_cents ? (c.tax_cents / 100).toFixed(2) : '', (c.amount_cents / 100).toFixed(2)]);
    return { $buffer: Buffer.from('﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')), $type: 'text/csv; charset=utf-8', $name: `expenses-${from === '0000-01-01' ? 'all' : from}-${to === '9999-12-31' ? 'today' : to}.csv` };
  });
};
module.exports.vkey = vkey;
module.exports.tkey = tkey;
module.exports.splitTax = splitTax;
