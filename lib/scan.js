'use strict';
// Escaneo de tickets y documentos de gasto.
//  1. Se sube la foto/PDF.  2. Se lee (IA, si está configurada).  3. Se busca la obra:
//     código de obra (EE-0007) > dirección > nombre del cliente > única obra activa de quien escanea.
//  4. Si está seguro (y no es duplicado) se guarda solo como gasto con su recibo; si no, queda
//     "por asignar" con la obra sugerida para confirmarlo con un toque.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tx } = require('./db');
const C = require('./catalog');
const AI = require('./scan-ai');

const AUTO = 0.85;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9#\s-]/g, ' ').replace(/\s+/g, ' ');
const jobCode = id => 'EE-' + String(id).padStart(4, '0');
const COMMON = new Set(['family', 'familia', 'demo', 'casa', 'house', 'the', 'and', 'los', 'las', 'del', 'mrs', 'mr']);

// Busca la obra más probable para el ticket.
function matchJob(db, user, data, canSee) {
  const jobs = (user.role === 'owner'
    ? db.prepare("SELECT * FROM jobs WHERE status IN ('activo','cotizado','prospecto') ORDER BY id").all()
    : db.prepare("SELECT * FROM jobs WHERE status NOT IN ('cancelado','terminado') ORDER BY id").all()).filter(j => canSee(j.id));
  const hint = norm(data ? data.job_hint : ''), all = norm(data ? [data.job_hint, data.text].join(' ') : '');
  const scored = jobs.map(j => {
    let score = 0, why = '';
    const code = new RegExp(`\\bee\\s*-?\\s*0*${j.id}\\b`);
    if (all && code.test(all)) { score = 1; why = 'codigo'; }
    if (score < 0.9 && j.address && all) {
      const a = norm(j.address).split(' ');
      const numb = a.find(w => /^\d+$/.test(w)), street = a.find(w => /^[a-z]{3,}$/.test(w));
      if (numb && street && new RegExp(`\\b${numb}\\b`).test(all) && all.includes(street)) { score = 0.9; why = 'direccion'; }
    }
    if (score < 0.75 && hint) {
      const names = norm(j.client_name).split(' ').filter(w => w.length >= 4 && !COMMON.has(w));
      if (names.some(n => new RegExp(`\\b${n}\\b`).test(hint))) { score = 0.75; why = 'cliente'; }
    }
    return { job: j, score, why };
  });
  // Si quien escanea solo tiene una obra activa, esa es la sugerencia.
  const active = scored.filter(s => s.job.status === 'activo');
  if (active.length === 1 && active[0].score < 0.6) { active[0].score = Math.max(active[0].score, user.role === 'worker' ? 0.86 : 0.6); active[0].why = active[0].why || 'unica'; }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === 0) return { job_id: null, confidence: 0, why: '' };
  const tie = scored[1] && scored[1].score === best.score;
  return { job_id: best.job.id, confidence: tie ? Math.min(best.score, 0.7) : best.score, why: best.why };
}

// ¿A qué partida de la obra va este gasto? Solo si hay una respuesta clara; si no, se queda sin partida.
const WORDS = {
  permisos: ['permit', 'permiso', 'inspection', 'inspeccion', 'city'], basura: ['dumpster', 'haul', 'basura', 'debris', 'trash'],
  renta_equipo: ['rental', 'renta', 'equipment', 'equipo'],
};
const STOP = new Set(['the', 'and', 'for', 'con', 'para', 'los', 'las', 'del', 'una', 'compra', 'material', 'materials', 'materiales', 'otro', 'other', 'item', 'items', 'each', 'pcs', 'unit']);
function guessLine(db, jobId, f, s) {
  const lines = db.prepare("SELECT id, code, trade, description, pass_through FROM job_lines WHERE job_id=? AND status<>'cancelado'").all(jobId);
  if (!lines.length) return null;
  if (lines.length === 1) return lines[0].id;
  let d = null; try { d = JSON.parse(s.data || 'null'); } catch { /* */ }
  const words = new Set(norm([f.description, f.vendor, d && d.items && d.items.join(' '), d && d.job_hint].join(' ')).split(' ').filter(w => w.length >= 4 && !STOP.has(w)));
  for (const w of WORDS[f.category] || []) words.add(w);
  const scored = lines.map(l => {
    const lw = norm([l.code, l.trade, l.description].join(' ')).split(' ').filter(w => w.length >= 4 && !STOP.has(w));
    let score = 0;
    for (const w of lw) for (const x of words) if (x === w || (w.length >= 5 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5))))) { score++; break; }
    if (l.code && new RegExp(`\\b${norm(l.code).replace(/[^a-z0-9]/g, '')}\\b`).test(norm([d && d.job_hint, d && d.text].join(' ')).replace(/[^a-z0-9 ]/g, ''))) score += 3;
    return { id: l.id, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0].score > 0 && (!scored[1] || scored[1].score < scored[0].score) ? scored[0].id : null;
}

module.exports = function scanRoutes(db, add, H, opts = {}) {
  const { requireRole, fail, str, date, oneOf, intId, cents, canSeeJob, today } = H;
  const extractor = opts.extract || AI.extract;
  const aiOn = opts.extract ? () => true : AI.enabled;
  const dir = path.join(db.dataDir, 'scans');
  fs.mkdirSync(dir, { recursive: true });

  const get = id => db.prepare('SELECT * FROM scans WHERE id=?').get(id);
  const out = s => {
    let d = null; try { d = JSON.parse(s.data || 'null'); } catch { /* */ }
    const j = s.job_id ? db.prepare('SELECT id, client_name, address FROM jobs WHERE id=?').get(s.job_id) : null;
    const u = db.prepare('SELECT name FROM users WHERE id=?').get(s.created_by) || {};
    const dup = s.duplicate_of === -1 ? { same_scan: true } : s.duplicate_of ? (db.prepare('SELECT e.id, e.date, e.amount_cents, e.vendor, j.client_name FROM expenses e JOIN jobs j ON j.id=e.job_id WHERE e.id=?').get(s.duplicate_of) || null) : null;
    const exp = s.expense_id ? db.prepare('SELECT id, job_id, amount_cents, date, vendor, category FROM expenses WHERE id=?').get(s.expense_id) : null;
    return { ...s, data: d, job: j ? { ...j, code: jobCode(j.id) } : null, by_name: u.name, duplicate: dup, expense: exp };
  };
  const scanOr404 = (user, id) => {
    const s = get(intId(id));
    if (!s || (user.role !== 'owner' && s.created_by !== user.id)) fail(404, 'Ticket no encontrado');
    if (user.isPm && s.created_by !== user.id && !(s.job_id && canSeeJob(db, user, s.job_id))) fail(404, 'Ticket no encontrado');
    return s;
  };
  const findDuplicate = (data, hash, selfId) => {
    const same = db.prepare("SELECT expense_id FROM scans WHERE hash=? AND id<>? AND status<>'descartado' LIMIT 1").get(hash, selfId || 0);
    if (same) return same.expense_id || -1;
    if (!data || !data.total_cents || !data.date) return null;
    const e = db.prepare('SELECT id, vendor FROM expenses WHERE amount_cents=? AND date=?').all(data.total_cents, data.date)
      .find(x => !data.vendor || !x.vendor || norm(x.vendor).split(' ')[0] === norm(data.vendor).split(' ')[0]);
    return e ? e.id : null;
  };

  // Crea el gasto (con la foto como recibo) a partir de un ticket.
  function fileExpense(user, s, f) {
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(f.job_id);
    if (!job || !canSeeJob(db, user, job.id)) fail(404, 'Obra no encontrada');
    const expId = Number(db.prepare(`INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,created_by) VALUES(?,?,?,?,?,?,?,?)`)
      .run(job.id, f.date, f.category, f.description, f.vendor, f.bought_by, f.amount_cents, user.id).lastInsertRowid);
    const fid = crypto.randomBytes(16).toString('hex');
    fs.copyFileSync(path.join(dir, `${s.id}.${EXT[s.mime]}`), path.join(db.dataDir, 'files', `${fid}.${EXT[s.mime]}`));
    db.prepare("INSERT INTO files(id,job_id,expense_id,kind,mime,created_by) VALUES(?,?,?,'receipt',?,?)").run(fid, job.id, expId, s.mime, s.created_by);
    db.prepare("UPDATE scans SET status='guardado', job_id=?, expense_id=?, filed_at=datetime('now') WHERE id=?").run(job.id, expId, s.id);
    if (f.line_id) db.prepare('UPDATE expenses SET line_id=? WHERE id=? AND job_id=(SELECT job_id FROM job_lines WHERE id=?)').run(f.line_id, expId, f.line_id);
    else { const l = guessLine(db, job.id, f, s); if (l) db.prepare('UPDATE expenses SET line_id=? WHERE id=?').run(l, expId); }
    return expId;
  }
  const describe = (d, vendor) => (d && d.items && d.items.length ? d.items.slice(0, 4).join(', ') : '') || (vendor ? `Compra en ${vendor}` : 'Compra');

  add('GET', '/api/scans/status', ({ user }) => {
    requireRole(user, 'owner', 'worker');
    const prov = opts.extract ? 'prueba' : AI.provider();
    return { ai: aiOn(), provider: prov, model: prov === 'grok' ? AI.XAI_MODEL : AI.MODEL };
  });

  add('GET', '/api/scans', ({ user }) => {
    requireRole(user, 'owner', 'worker');
    const rows = user.role === 'owner'
      ? db.prepare("SELECT * FROM scans WHERE status IN ('por_asignar','error') OR (status='guardado' AND created_at >= datetime('now','-14 days')) ORDER BY CASE status WHEN 'guardado' THEN 1 ELSE 0 END, id DESC LIMIT 200").all()
      : db.prepare("SELECT * FROM scans WHERE created_by=? AND status<>'descartado' ORDER BY id DESC LIMIT 60").all(user.id);
    return rows.map(out);
  });

  // Subir y leer un ticket.
  add('POST', '/api/scans', async ({ user, body }) => {
    requireRole(user, 'owner', 'worker');
    const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.file || ''));
    if (!m) fail(400, 'Archivo inválido (use foto o PDF)');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 9 * 1024 * 1024) fail(413, 'Archivo demasiado grande');
    const ok = m[1] === 'application/pdf' ? buf.slice(0, 5).toString() === '%PDF-' : m[1] === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 : true;
    if (!ok) fail(400, 'El archivo no es una imagen válida');
    let preset = null;
    if (body.job_id) { preset = intId(body.job_id); if (!canSeeJob(db, user, preset)) fail(404, 'Obra no encontrada'); }
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const id = Number(db.prepare("INSERT INTO scans(created_by,mime,hash,status) VALUES(?,?,?,'procesando')").run(user.id, m[1], hash).lastInsertRowid);
    fs.writeFileSync(path.join(dir, `${id}.${EXT[m[1]]}`), buf);

    let data = null, error = '';
    try { data = await extractor({ buf, mime: m[1] }); } catch (e) { error = String(e.message || e).slice(0, 300); }
    const match = preset ? { job_id: preset, confidence: 1, why: 'obra' } : matchJob(db, user, data, jid => canSeeJob(db, user, jid));
    const dup = findDuplicate(data, hash, id);
    db.prepare('UPDATE scans SET data=?, job_id=?, confidence=?, why=?, duplicate_of=?, error=?, status=? WHERE id=?')
      .run(JSON.stringify(data), match.job_id, match.confidence, match.why, dup || null, error, 'por_asignar', id);

    // ¿Se guarda solo?
    if (data && data.total_cents && match.job_id && match.confidence >= AUTO && !dup) {
      tx(db, () => fileExpense(user, get(id), {
        job_id: match.job_id, date: data.date || today(), category: data.category || 'material', amount_cents: data.total_cents,
        vendor: data.vendor, description: describe(data, data.vendor).slice(0, 300), bought_by: user.name,
      }));
    }
    return out(get(id));
  });

  // Confirmar / asignar a mano.
  add('POST', '/api/scans/:id/file', ({ user, body, params }) => {
    requireRole(user, 'owner', 'worker');
    const s = scanOr404(user, params.id);
    if (s.status === 'guardado') fail(400, 'Este ticket ya se guardó');
    const amount = cents(body.amount_cents, 'monto'); if (!amount) fail(400, 'El monto debe ser mayor que cero');
    let cat = oneOf(body.category || 'material', C.CATEGORIES.map(c => c.key), 'categoría');
    if (cat === 'subcontratistas' && user.role !== 'owner') cat = 'otro';
    const d = (() => { try { return JSON.parse(s.data || 'null'); } catch { return null; } })();
    const vendor = str(body.vendor, 120);
    return tx(db, () => {
      fileExpense(user, s, { line_id: body.line_id ? intId(body.line_id) : null, job_id: intId(body.job_id), date: date(body.date, 'fecha') || today(), category: cat, amount_cents: amount,
        vendor, description: (str(body.description, 300) || describe(d, vendor)).slice(0, 300), bought_by: str(body.bought_by, 80) || (db.prepare('SELECT name FROM users WHERE id=?').get(s.created_by) || {}).name || '' });
      return out(get(s.id));
    });
  });

  // Mover a otra obra un ticket que se archivó en la obra equivocada.
  add('POST', '/api/scans/:id/move', ({ user, body, params }) => {
    requireRole(user, 'owner', 'worker');
    const s = scanOr404(user, params.id);
    if (s.status !== 'guardado' || !s.expense_id) fail(400, 'Este ticket todavía no está guardado');
    const to = intId(body.job_id);
    if (!canSeeJob(db, user, to)) fail(404, 'Obra no encontrada');
    tx(db, () => {
      db.prepare('UPDATE expenses SET job_id=? WHERE id=?').run(to, s.expense_id);
      db.prepare('UPDATE files SET job_id=? WHERE expense_id=?').run(to, s.expense_id);
      db.prepare('UPDATE scans SET job_id=?, why=? WHERE id=?').run(to, 'movido', s.id);
    });
    return out(get(s.id));
  });

  add('POST', '/api/scans/:id/discard', ({ user, params }) => {
    requireRole(user, 'owner', 'worker');
    const s = scanOr404(user, params.id);
    if (s.status === 'guardado') fail(400, 'Este ticket ya se guardó: bórrelo desde los gastos de la obra');
    db.prepare("UPDATE scans SET status='descartado' WHERE id=?").run(s.id);
    return { ok: true };
  });

  // La imagen del ticket (solo el dueño o quien lo escaneó).
  add('GET', '/api/scans/:id/file', ({ user, params }) => {
    requireRole(user, 'owner', 'worker');
    const s = scanOr404(user, params.id);
    return { $buffer: fs.readFileSync(path.join(dir, `${s.id}.${EXT[s.mime]}`)), $type: s.mime, $name: `ticket-${s.id}.${EXT[s.mime]}` };
  });
};
module.exports.matchJob = matchJob;
module.exports.guessLine = guessLine;
module.exports.jobCode = jobCode;
