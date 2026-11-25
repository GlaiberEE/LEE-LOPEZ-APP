'use strict';
// Inventario de herramienta y equipo de la compañía.
//  - Cada cosa tiene su etiqueta (H-0001), dónde está (bodega, una obra, en reparación o dada de baja), su estado,
//    lo que costó, el ticket o gasto de la compañía de donde salió, y su garantía con fecha (aviso 30 días antes).
//  - La herramienta no se presta a personas: se queda en la bodega o en una obra. Cada movimiento queda en el historial
//    con quién la movió y cuándo.
//  - La herramienta es gasto general: al registrar un gasto de empresa de herramienta o equipo se puede pasar al inventario.
//  - Dueños y Administración la manejan (solo un dueño borra). El PM la ve sin costos y la mueve entre la bodega y sus obras.
//    La contadora ve todo con costos. El sub ve qué herramienta de la compañía hay en su obra, sin costos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CATS = ['electrica', 'manual', 'equipo', 'vehiculo', 'escalera', 'medicion', 'seguridad', 'otro'];
const LOCS = ['bodega', 'obra', 'reparacion', 'baja'];
const STATES = ['bien', 'reparar', 'perdida'];
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const TZ = () => process.env.APP_TZ || 'America/Chicago';
const todayL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const looksLike = (buf, mime) => mime === 'application/pdf' ? buf.slice(0, 5).toString() === '%PDF-'
  : mime === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 : mime === 'image/png' ? buf.slice(0, 4).toString('hex') === '89504e47'
    : mime === 'image/webp' ? buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP' : false;
const tagOf = id => 'H-' + String(id).padStart(4, '0');

function routes(db, add, h) {
  const { requireRole, fail, str, intId, date, cents, canSeeJob } = h;
  const dir = path.join(db.dataDir, 'inventory'); fs.mkdirSync(dir, { recursive: true });
  const who = u => u.officeId || u.pmId || u.id;
  const humanOwner = u => u.role === 'owner' && !u.isPm && !u.is_agent && !u.isOffice;
  const manager = u => (u.role === 'owner' && !u.isPm && !u.isOffice) || (u.isOffice && u.office === 'admin');
  const seesCost = u => (u.role === 'owner' && !u.isPm) || (u.isOffice);
  const view = u => { requireRole(u, 'owner', 'pm'); };
  const manage = u => { requireRole(u, 'owner'); if (!manager(u)) fail(403, 'El inventario lo manejan los dueños y la oficina'); };
  const saveFile = dataUrl => {
    const m = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) fail(400, 'Archivo inválido (use PDF o foto)');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 15 * 1024 * 1024) fail(413, 'El archivo es muy grande (máximo 15 MB)');
    if (!looksLike(buf, m[1])) fail(400, 'Archivo inválido (use PDF o foto)');
    const name = `${crypto.randomBytes(12).toString('hex')}.${EXT[m[1]]}`;
    fs.writeFileSync(path.join(dir, name), buf);
    return { file: name, mime: m[1] };
  };
  const jobName = id => id ? ((db.prepare('SELECT client_name FROM jobs WHERE id=?').get(id) || {}).client_name || '') : '';
  const out = (t, u) => {
    const o = { id: t.id, tag: tagOf(t.id), name: t.name, category: t.category, brand: t.brand, model: t.model, serial: t.serial, location: t.location, job_id: t.job_id, job_name: jobName(t.job_id),
      state: t.state, warranty_until: t.warranty_until, warranty_state: !t.warranty_until ? '' : t.warranty_until < todayL() ? 'vencida' : t.warranty_until <= addDays(todayL(), 30) ? 'por_vencer' : 'vigente',
      notes: t.notes, has_photo: !!t.photo, has_file: !!t.file, last_seen_at: t.last_seen_at, purchase_date: t.purchase_date, created_at: t.created_at };
    if (seesCost(u)) Object.assign(o, { cost_cents: t.cost_cents, vendor: t.vendor, company_expense_id: t.company_expense_id });
    return o;
  };
  const toolOr404 = (u, id) => { const t = db.prepare('SELECT * FROM tools_inventory WHERE id=?').get(intId(id)); if (!t) fail(404, 'No encontrado'); return t; };
  const move = (t, u, loc, jobId, note) => {
    db.prepare("UPDATE tools_inventory SET location=?, job_id=?, last_seen_at=datetime('now') WHERE id=?").run(loc, loc === 'obra' ? jobId : null, t.id);
    db.prepare('INSERT INTO tool_moves(tool_id,from_loc,from_job,to_loc,to_job,user_id,note) VALUES(?,?,?,?,?,?,?)').run(t.id, t.location, t.job_id, loc, loc === 'obra' ? jobId : null, who(u), note || '');
  };

  add('GET', '/api/inventory', ({ user, query }) => {
    view(user);
    const pmJob = id => !user.isPm || (id && canSeeJob(db, user, id));
    let rows = db.prepare('SELECT * FROM tools_inventory ORDER BY CASE location WHEN \'baja\' THEN 2 ELSE 0 END, category, name').all();
    if (query.get('job_id')) rows = rows.filter(t => t.job_id === intId(query.get('job_id')));
    const list = rows.map(t => out(t, user));
    const alive = rows.filter(t => t.location !== 'baja');
    const summary = { items: alive.length, at_bodega: alive.filter(t => t.location === 'bodega').length, at_jobs: alive.filter(t => t.location === 'obra').length,
      repair: alive.filter(t => t.location === 'reparacion' || t.state === 'reparar').length, lost: alive.filter(t => t.state === 'perdida').length,
      warranty_soon: list.filter(t => t.location !== 'baja' && t.warranty_state === 'por_vencer').length,
      ...(seesCost(user) ? { value_cents: alive.reduce((a, t) => a + (t.cost_cents || 0), 0) } : {}) };
    const jobs = db.prepare("SELECT id, client_name FROM jobs WHERE status IN ('activo','cotizado') ORDER BY client_name").all().filter(j => pmJob(j.id));
    // Gastos de la compañía de herramienta o equipo que todavía no están en el inventario (para pasarlos).
    const pending = manager(user) ? db.prepare("SELECT id, date, description, vendor, amount_cents FROM company_expenses WHERE category IN ('herramienta','equipo') AND id NOT IN (SELECT company_expense_id FROM tools_inventory WHERE company_expense_id IS NOT NULL) ORDER BY date DESC LIMIT 30").all() : [];
    return { tools: list, summary, jobs, pending_expenses: pending, can_manage: manager(user), sees_cost: seesCost(user), cats: CATS };
  });
  const fields = (b, cur = {}) => {
    const f = {
      name: 'name' in b ? (str(b.name, 120) || fail(400, 'Escriba qué es')) : cur.name,
      category: 'category' in b ? (CATS.includes(b.category) ? b.category : fail(400, 'Categoría inválida')) : cur.category || 'otro',
      brand: 'brand' in b ? str(b.brand, 60) : cur.brand || '', model: 'model' in b ? str(b.model, 60) : cur.model || '', serial: 'serial' in b ? str(b.serial, 60) : cur.serial || '',
      purchase_date: 'purchase_date' in b ? (b.purchase_date ? date(b.purchase_date, 'fecha de compra') : '') : cur.purchase_date || '',
      cost_cents: 'cost_cents' in b ? (b.cost_cents === '' || b.cost_cents == null ? 0 : cents(b.cost_cents, 'costo')) : cur.cost_cents || 0,
      vendor: 'vendor' in b ? str(b.vendor, 80) : cur.vendor || '',
      warranty_until: 'warranty_until' in b ? (b.warranty_until ? date(b.warranty_until, 'garantía') : '') : cur.warranty_until || '',
      state: 'state' in b ? (STATES.includes(b.state) ? b.state : fail(400, 'Estado inválido')) : cur.state || 'bien',
      notes: 'notes' in b ? str(b.notes, 1000) : cur.notes || '',
    };
    if (!f.name) fail(400, 'Escriba qué es');
    return f;
  };
  add('POST', '/api/inventory', ({ user, body }) => {
    manage(user);
    const f = fields(body);
    let ce = null;
    if (body.company_expense_id) {
      ce = db.prepare('SELECT * FROM company_expenses WHERE id=?').get(intId(body.company_expense_id)) || fail(400, 'Ese gasto no existe');
      if (db.prepare('SELECT 1 FROM tools_inventory WHERE company_expense_id=?').get(ce.id) && !body.split) fail(409, 'Ese gasto ya está en el inventario');
      if (!f.cost_cents) f.cost_cents = ce.amount_cents; if (!f.vendor) f.vendor = ce.vendor; if (!f.purchase_date) f.purchase_date = ce.date;
    }
    const loc = LOCS.includes(body.location) && body.location !== 'baja' ? body.location : 'bodega';
    const jobId = loc === 'obra' ? intId(body.job_id) : null;
    if (loc === 'obra' && !db.prepare('SELECT 1 FROM jobs WHERE id=?').get(jobId)) fail(400, 'Escoja la obra');
    const photo = body.photo ? saveFile(body.photo) : null, file = body.file ? saveFile(body.file) : null;
    const qty = Math.min(Math.max(parseInt(body.qty, 10) || 1, 1), 20);
    const ids = [];
    for (let i = 0; i < qty; i++) {
      ids.push(Number(db.prepare(`INSERT INTO tools_inventory(name,category,brand,model,serial,purchase_date,cost_cents,vendor,warranty_until,state,notes,location,job_id,company_expense_id,photo,photo_mime,file,file_mime,created_by,last_seen_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(f.name, f.category, f.brand, f.model, i ? '' : f.serial, f.purchase_date, qty > 1 ? Math.round(f.cost_cents / qty) : f.cost_cents, f.vendor,
        f.warranty_until, f.state, f.notes, loc, jobId, ce ? ce.id : null, photo ? photo.file : '', photo ? photo.mime : '', file ? file.file : '', file ? file.mime : '', who(user)).lastInsertRowid));
    }
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary,amount_cents) VALUES(?,?,?,?,?,?)").run(who(user), 'crear', 'inventario', ids[0], `${qty > 1 ? qty + ' × ' : ''}${f.name} (${ids.map(tagOf).join(', ')})`, f.cost_cents);
    return { ids, tags: ids.map(tagOf) };
  });
  add('PUT', '/api/inventory/:id', ({ user, params, body }) => {
    manage(user);
    const t = toolOr404(user, params.id);
    const f = fields(body, t);
    const photo = body.photo ? saveFile(body.photo) : null, file = body.file ? saveFile(body.file) : null;
    db.prepare('UPDATE tools_inventory SET name=?,category=?,brand=?,model=?,serial=?,purchase_date=?,cost_cents=?,vendor=?,warranty_until=?,state=?,notes=?,photo=?,photo_mime=?,file=?,file_mime=?,warranty_alert_at=? WHERE id=?')
      .run(f.name, f.category, f.brand, f.model, f.serial, f.purchase_date, f.cost_cents, f.vendor, f.warranty_until, f.state, f.notes, photo ? photo.file : t.photo, photo ? photo.mime : t.photo_mime,
        file ? file.file : t.file, file ? file.mime : t.file_mime, f.warranty_until !== t.warranty_until ? '' : t.warranty_alert_at, t.id);
    if (f.state !== t.state) db.prepare('INSERT INTO tool_moves(tool_id,from_loc,from_job,to_loc,to_job,user_id,note) VALUES(?,?,?,?,?,?,?)').run(t.id, t.location, t.job_id, t.location, t.job_id, who(user), `estado: ${t.state} → ${f.state}`);
    return out(db.prepare('SELECT * FROM tools_inventory WHERE id=?').get(t.id), user);
  });
  // Mover: a la bodega, a una obra o a reparación (el PM solo entre la bodega y sus obras). Dar de baja: dueños y oficina.
  add('POST', '/api/inventory/:id/move', ({ user, params, body }) => {
    view(user);
    const t = toolOr404(user, params.id);
    const loc = LOCS.includes(body.location) ? body.location : fail(400, 'Escoja a dónde va');
    if (t.location === 'baja') fail(409, 'Esta herramienta está dada de baja');
    if (user.isPm) {
      if (!['bodega', 'obra'].includes(loc)) fail(403, 'El PM solo la mueve entre la bodega y sus obras');
      if (t.location === 'obra' && !canSeeJob(db, user, t.job_id)) fail(403, 'Esa herramienta está en una obra que no es suya');
    }
    if (loc === 'baja' && !manager(user)) fail(403, 'Dar de baja lo hacen los dueños y la oficina');
    let jobId = null;
    if (loc === 'obra') { jobId = intId(body.job_id); if (!db.prepare('SELECT 1 FROM jobs WHERE id=?').get(jobId) || !canSeeJob(db, user, jobId)) fail(400, 'Escoja la obra'); }
    if (loc === 'baja' && str(body.note, 300).length < 3) fail(400, 'Escriba por qué se da de baja');
    if (loc === t.location && jobId === t.job_id) { db.prepare("UPDATE tools_inventory SET last_seen_at=datetime('now') WHERE id=?").run(t.id); return { ok: true, same: true }; }
    move(t, user, loc, jobId, str(body.note, 300));
    return { ok: true };
  });
  // "La vi": confirmar que sigue donde dice (conteo).
  add('POST', '/api/inventory/:id/seen', ({ user, params }) => {
    view(user);
    const t = toolOr404(user, params.id);
    if (user.isPm && t.location === 'obra' && !canSeeJob(db, user, t.job_id)) fail(403, 'Esa herramienta está en una obra que no es suya');
    db.prepare("UPDATE tools_inventory SET last_seen_at=datetime('now') WHERE id=?").run(t.id);
    return { ok: true };
  });
  add('GET', '/api/inventory/:id/history', ({ user, params }) => {
    view(user);
    const t = toolOr404(user, params.id);
    return db.prepare('SELECT m.*, u.name by_name FROM tool_moves m LEFT JOIN users u ON u.id=m.user_id WHERE m.tool_id=? ORDER BY m.id DESC LIMIT 100').all(t.id)
      .map(m => ({ ...m, from_job_name: jobName(m.from_job), to_job_name: jobName(m.to_job) }));
  });
  add('DELETE', '/api/inventory/:id', ({ user, params }) => {
    requireRole(user, 'owner'); if (!humanOwner(user)) fail(403, 'Solo un dueño borra del inventario (o dé de baja la herramienta)');
    const t = toolOr404(user, params.id);
    db.prepare('DELETE FROM tools_inventory WHERE id=?').run(t.id);
    for (const f of [t.photo, t.file]) if (f && !db.prepare('SELECT 1 FROM tools_inventory WHERE photo=? OR file=?').get(f, f)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* */ } }
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary,amount_cents) VALUES(?,?,?,?,?,?)").run(who(user), 'borrar', 'inventario', t.id, `${tagOf(t.id)} ${t.name}`, t.cost_cents);
    return { ok: true };
  });
  add('GET', '/api/inventory/:id/:what', ({ user, params }) => {
    requireRole(user, 'owner', 'pm', 'worker');
    const t = toolOr404(user, params.id);
    if (user.role === 'worker' && !(t.location === 'obra' && canSeeJob(db, user, t.job_id))) fail(404, 'No encontrado');
    const f = params.what === 'photo' ? t.photo : params.what === 'file' ? t.file : fail(404, 'No encontrado');
    const mime = params.what === 'photo' ? t.photo_mime : t.file_mime;
    if (!f || (params.what === 'file' && user.role === 'worker')) fail(404, 'No encontrado');
    return { $buffer: fs.readFileSync(path.join(dir, f)), $type: mime, $name: `${tagOf(t.id)}.${EXT[mime] || 'jpg'}` };
  });
  // El sub: herramienta de la compañía que hay en su obra (sin costos).
  add('GET', '/api/jobs/:id/tools', ({ user, params }) => {
    requireRole(user, 'owner', 'pm', 'worker');
    const jid = intId(params.id);
    if (!canSeeJob(db, user, jid)) fail(404, 'No encontrado');
    return db.prepare("SELECT * FROM tools_inventory WHERE location='obra' AND job_id=? ORDER BY name").all(jid)
      .map(t => ({ id: t.id, tag: tagOf(t.id), name: t.name, brand: t.brand, model: t.model, state: t.state, has_photo: !!t.photo }));
  });
}

// Aviso: garantía de una herramienta por vencer (30 días), una vez.
function tick(db) {
  const today = todayL(), soon = addDays(today, 30);
  const { notify, owners } = require('./push');
  const to = [...owners(db), ...db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").all().map(r => r.id)];
  let n = 0;
  for (const t of db.prepare("SELECT * FROM tools_inventory WHERE location<>'baja' AND warranty_until<>'' AND warranty_until>=? AND warranty_until<=? AND warranty_alert_at=''").all(today, soon)) {
    db.prepare("UPDATE tools_inventory SET warranty_alert_at=datetime('now') WHERE id=?").run(t.id);
    if (to.length) notify(db, to, 'tool_warranty', { x: `${tagOf(t.id)} ${t.name}`, d: t.warranty_until }, '#/inventario'); n++;
  }
  return n;
}

module.exports = { routes, tick, CATS, LOCS, tagOf };
