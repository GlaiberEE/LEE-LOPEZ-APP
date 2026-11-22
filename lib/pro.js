'use strict';
const BUDGET = new WeakMap();
// Funciones "pro" (v1.6):
//  1) Firma del cliente (estimado y change orders) + pago en línea (link de pago)
//  2) Presupuesto por categoría con alertas
//  3) Reloj de entrada/salida con GPS → costo de mano de obra
//  4) Permisos e inspecciones
//  5) Reporte diario con fotos para el cliente
//  6) Garantía y mantenimiento (recordatorios y reseñas)
//  7) Prospectos desde la página web
//  8) Ganancia por tipo de proyecto y por origen del cliente
//  9) Exportar para QuickBooks / contador (CSV)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('./catalog');
const { tx } = require('./db');
const { notify, owners } = require('./push');
const LAB = require('./labor');

const PERMIT_STATUS = ['pendiente', 'solicitado', 'programada', 'aprobado', 'rechazado'];
const FOLLOWUPS = [
  { kind: 'review', days: 7 },     // 1 semana después: pedir reseña y referidos
  { kind: 'm6', months: 6 },       // 6 meses: revisión de mantenimiento
  { kind: 'm11', months: 11 },     // 11 meses: la garantía vence pronto
];
const meters = (a, b, c, d) => {
  const R = 6371000, r = x => x * Math.PI / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};
const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };
const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const addMonths = (d, m) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
const addDaysIso = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const usd = c => (c / 100).toFixed(2);

module.exports = function proRoutes(db, add, h) {
  const { requireRole, fail, str, need, date, needDate, oneOf, intId, cents, today, jobOr404, canSeeJob, saveImage, money, warrantyUntil } = h;
  const sigDir = path.join(db.dataDir, 'signatures');
  fs.mkdirSync(sigDir, { recursive: true });
  const meta = k => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value || '';
  const setMeta = (k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
  const catLabel = (k, l = 'es') => (C.CATEGORIES.find(c => c.key === k) || {})[l] || k;

  // ===================== Ajustes de la empresa =====================
  const payOn = () => meta('pay_enabled') === '1';
  const settings = () => ({ pay_enabled: payOn(), pay_link: meta('pay_link'), pay_info: meta('pay_info'), review_link: meta('review_link'), company_phone: meta('company_phone') });
  add('GET', '/api/settings', ({ user }) => { requireRole(user, 'owner'); return { ...settings(), quickbooks: { connected: false, available: false } }; });
  add('PUT', '/api/settings', ({ user, body }) => {
    requireRole(user, 'owner');
    for (const k of ['pay_link', 'review_link']) if (k in body) {
      const v = str(body[k], 500);
      if (v && !/^https:\/\/[^\s]+$/i.test(v)) fail(400, 'El link debe empezar con https://');
      setMeta(k, v);
    }
    if ('pay_info' in body) setMeta('pay_info', str(body.pay_info, 600));
    if ('pay_enabled' in body) setMeta('pay_enabled', body.pay_enabled === true || body.pay_enabled === 'si' ? '1' : '0');
    if ('company_phone' in body) setMeta('company_phone', str(body.company_phone, 40));
    return settings();
  });

  // ===================== 1) Firma del cliente =====================
  const estimateText = job => JSON.stringify({ job: job.id, client: job.client_name, address: job.address, description: job.description, amount: job.quoted_cents });
  const coText = co => JSON.stringify({ co: co.id, job: co.job_id, description: co.description, amount: co.price_cents, date: co.date });
  const hash = s => crypto.createHash('sha256').update(s).digest('hex');
  const sigOut = s => s && { id: s.id, signer_name: s.signer_name, signed_at: s.signed_at, amount_cents: s.amount_cents, doc_hash: s.doc_hash.slice(0, 16), valid: true };
  const estimateSig = job => db.prepare("SELECT * FROM signatures WHERE job_id=? AND target='estimate' ORDER BY id DESC LIMIT 1").get(job.id);
  const coSig = id => db.prepare("SELECT * FROM signatures WHERE target='change_order' AND target_id=? ORDER BY id DESC LIMIT 1").get(id);

  add('GET', '/api/jobs/:id/signing', ({ user, params }) => {
    requireRole(user, 'owner', 'client');
    const job = jobOr404(db, user, intId(params.id));
    const es = estimateSig(job);
    // Una firma vale solo si el estimado no cambió después de firmar.
    const esValid = es && (es.doc_hash === hash(estimateText(job)) || (job.proposal_hash && es.doc_hash === job.proposal_hash));
    const cos = db.prepare("SELECT id, date, description, price_cents, status FROM change_orders WHERE job_id=? AND status<>'rechazado' ORDER BY date, id").all(job.id)
      .map(c => { const s = coSig(c.id); const full = db.prepare('SELECT * FROM change_orders WHERE id=?').get(c.id);
        return { ...c, signature: s ? { ...sigOut(s), valid: s.doc_hash === hash(coText(full)) } : null }; });
    const m = money(db, job.id);
    return {
      estimate: { amount_cents: job.quoted_cents, description: job.description, status: job.status,
        can_sign: ['prospecto', 'cotizado'].includes(job.status) && job.quoted_cents > 0 && !esValid,
        signature: es ? { ...sigOut(es), valid: !!esValid } : null },
      change_orders: cos,
      // Pagos en línea: apagados hasta que los dueños los activen en Mi cuenta.
      pay: payOn() ? { link: job.pay_link || meta('pay_link'), info: meta('pay_info'), balance_cents: m.balanceDue } : null,
    };
  });

  add('POST', '/api/jobs/:id/sign', ({ user, params, body, ip, ua }) => {
    requireRole(user, 'client');
    const job = jobOr404(db, user, intId(params.id));
    if (body.agree !== true) fail(400, 'Debe aceptar firmar electrónicamente');
    const name = need(body.name, 'nombre completo', 120);
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.signature || ''));
    if (!m) fail(400, 'Falta la firma');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 500 || buf.length > 600 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) fail(400, 'Falta la firma');
    const target = oneOf(body.target, ['estimate', 'change_order'], 'qué firma');
    let targetId = null, amount = 0, text = '', summary = '';
    if (target === 'estimate') {
      if (!['prospecto', 'cotizado'].includes(job.status) || !job.quoted_cents) fail(400, 'Este estimado ya no se puede firmar');
      const es = estimateSig(job);
      if (es && es.doc_hash === hash(estimateText(job))) fail(400, 'Este estimado ya está firmado');
      amount = job.quoted_cents; text = estimateText(job); summary = (job.description || '').slice(0, 300);
    } else {
      const co = db.prepare('SELECT * FROM change_orders WHERE id=? AND job_id=?').get(intId(body.target_id), job.id);
      if (!co || co.status === 'rechazado') fail(404, 'Change order no encontrado');
      const s = coSig(co.id);
      if (s && s.doc_hash === hash(coText(co))) fail(400, 'Este change order ya está firmado');
      targetId = co.id; amount = co.price_cents; text = coText(co); summary = co.description.slice(0, 300);
    }
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO signatures(job_id,target,target_id,signer_name,user_id,amount_cents,doc_hash,summary,ip,ua) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(job.id, target, targetId, name, user.id, amount, hash(text), summary, String(ip || '').slice(0, 60), String(ua || '').slice(0, 200)).lastInsertRowid);
      fs.writeFileSync(path.join(sigDir, `${id}.jpg`), buf);
      if (target === 'estimate') db.prepare("UPDATE jobs SET signed_at=datetime('now') WHERE id=?").run(job.id);
      else db.prepare("UPDATE change_orders SET status='aprobado' WHERE id=?").run(targetId);
      notify(db, owners(db), 'signed', { who: name, x: target === 'estimate' ? 'el estimado' : 'un change order', job: job.client_name }, `#/obra/${job.id}`);
      return { ok: true, id };
    });
  });

  add('GET', '/api/signatures/:id/image', ({ user, params }) => {
    requireRole(user, 'owner', 'client');
    const s = db.prepare('SELECT * FROM signatures WHERE id=?').get(intId(params.id));
    if (!s || !canSeeJob(db, user, s.job_id)) fail(404, 'No encontrado');
    const f = path.join(sigDir, `${s.id}.jpg`);
    if (!fs.existsSync(f)) fail(404, 'No encontrado');
    return { $buffer: fs.readFileSync(f), $type: 'image/jpeg', $name: `firma-${s.id}.jpg` };
  });

  add('PUT', '/api/jobs/:id/pay-link', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const v = str(body.pay_link, 500);
    if (v && !/^https:\/\/[^\s]+$/i.test(v)) fail(400, 'El link debe empezar con https://');
    db.prepare('UPDATE jobs SET pay_link=? WHERE id=?').run(v, job.id);
    return { ok: true };
  });

  // ===================== 2) Presupuesto por categoría =====================
  const budgetRows = jobId => {
    const b = Object.fromEntries(db.prepare('SELECT category, cents FROM budgets WHERE job_id=?').all(jobId).map(r => [r.category, r.cents]));
    const s = Object.fromEntries(db.prepare('SELECT category, SUM(amount_cents) v FROM expenses WHERE job_id=? GROUP BY category').all(jobId).map(r => [r.category, r.v]));
    return C.CATEGORIES.map(c => ({ category: c.key, budget_cents: b[c.key] || 0, spent_cents: s[c.key] || 0,
      pct: b[c.key] ? Math.round((s[c.key] || 0) * 100 / b[c.key]) : null })).filter(r => r.budget_cents || r.spent_cents);
  };
  add('GET', '/api/jobs/:id/budget', ({ user, params }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const rows = budgetRows(job.id);
    const tb = rows.reduce((a, r) => a + r.budget_cents, 0), ts = rows.reduce((a, r) => a + r.spent_cents, 0);
    return { rows, total_budget_cents: tb, total_spent_cents: ts, contract_cents: money(db, job.id).contract, planned_profit_cents: tb ? money(db, job.id).contract - tb : null };
  });
  add('PUT', '/api/jobs/:id/budget', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const items = body.items && typeof body.items === 'object' ? body.items : {};
    tx(db, () => {
      for (const c of C.CATEGORIES) if (c.key in items) {
        const v = cents(items[c.key] ?? 0, catLabel(c.key));
        if (v) db.prepare('INSERT INTO budgets(job_id,category,cents) VALUES(?,?,?) ON CONFLICT(job_id,category) DO UPDATE SET cents=excluded.cents').run(job.id, c.key, v);
        else db.prepare('DELETE FROM budgets WHERE job_id=? AND category=?').run(job.id, c.key);
        db.prepare("DELETE FROM followups WHERE job_id=? AND kind LIKE ?").run(job.id, `budget:${c.key}:%`);
      }
    });
    return { ok: true };
  });
  const budgetAlerts = () => {
    const out = [];
    for (const j of db.prepare("SELECT id, client_name FROM jobs WHERE status IN ('activo','cotizado') AND id IN (SELECT job_id FROM budgets)").all()) {
      for (const r of budgetRows(j.id)) if (r.budget_cents && r.pct >= 90) out.push({ job_id: j.id, client_name: j.client_name, ...r });
    }
    return out.sort((a, b) => b.pct - a.pct);
  };
  add('GET', '/api/budget/alerts', ({ user }) => { requireRole(user, 'owner'); return budgetAlerts(); });
  // Aviso push una sola vez al pasar 90% y otra al pasar 100%.
  const budgetCheck = jobId => {
    try {
      const j = db.prepare('SELECT client_name FROM jobs WHERE id=?').get(jobId); if (!j) return;
      for (const r of budgetRows(jobId)) {
        if (!r.budget_cents) continue;
        for (const lvl of [90, 100]) {
          if (r.pct >= lvl && !db.prepare('SELECT 1 FROM followups WHERE job_id=? AND kind=?').get(jobId, `budget:${r.category}:${lvl}`)) {
            db.prepare('INSERT INTO followups(job_id,kind) VALUES(?,?)').run(jobId, `budget:${r.category}:${lvl}`);
            notify(db, owners(db), 'budget', { x: `${catLabel(r.category)} ${r.pct}%`, job: j.client_name }, `#/obra/${jobId}/presupuesto`);
          }
        }
      }
    } catch (e) { console.error('[presupuesto]', e.message); }
  };
  BUDGET.set(db, budgetCheck); // una por empresa (cada empresa tiene su base de datos)

  // ===================== 3) Reloj con GPS =====================
  const gps = (b, p) => ({ lat: num(b[p + 'lat'] ?? b.lat, -90, 90), lng: num(b[p + 'lng'] ?? b.lng, -180, 180), acc: num(b.acc, 0, 100000) });
  const distTo = (job, g) => (job.lat != null && job.lng != null && g.lat != null && g.lng != null) ? meters(job.lat, job.lng, g.lat, g.lng) : null;
  const openEntry = uid => db.prepare("SELECT * FROM time_entries WHERE user_id=? AND out_at=''").get(uid);
  const minutesBetween = (a, b) => Math.max(0, Math.round((Date.parse(b.replace(' ', 'T') + 'Z') - Date.parse(a.replace(' ', 'T') + 'Z')) / 60000));
  // Guarda / actualiza el gasto de mano de obra de una entrada.
  const laborExpense = e => {
    const u = db.prepare('SELECT name FROM users WHERE id=?').get(e.user_id) || {};
    const amount = Math.round(e.minutes / 60 * e.rate_cents);
    const desc = `Horas: ${u.name || ''} (${(e.minutes / 60).toFixed(2)} h)`;
    if (!e.rate_cents || !amount) { if (e.expense_id) { db.prepare('DELETE FROM expenses WHERE id=?').run(e.expense_id); db.prepare('UPDATE time_entries SET expense_id=NULL WHERE id=?').run(e.id); } return; }
    if (e.expense_id && db.prepare('SELECT 1 FROM expenses WHERE id=?').get(e.expense_id)) {
      db.prepare('UPDATE expenses SET amount_cents=?, description=?, date=?, job_id=? WHERE id=?').run(amount, desc, e.in_at.slice(0, 10), e.job_id, e.expense_id);
    } else {
      const id = Number(db.prepare("INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,created_by) VALUES(?,?,'mano_obra',?,'',?,?,?)")
        .run(e.job_id, e.in_at.slice(0, 10), desc, u.name || '', amount, e.user_id).lastInsertRowid);
      db.prepare('UPDATE time_entries SET expense_id=? WHERE id=?').run(id, e.id);
    }
    budgetCheck(e.job_id);
  };
  const entryOut = (e, forOwner) => {
    const j = db.prepare('SELECT client_name, address FROM jobs WHERE id=?').get(e.job_id) || {};
    const o = { id: e.id, job_id: e.job_id, client_name: j.client_name, address: j.address, in_at: e.in_at, out_at: e.out_at,
      minutes: e.out_at ? e.minutes : minutesBetween(e.in_at, nowIso()), in_dist: e.in_dist, out_dist: e.out_dist, note: e.note,
      open: !e.out_at, forgot: !e.out_at && minutesBetween(e.in_at, nowIso()) > 14 * 60 };
    if (forOwner) Object.assign(o, { user_id: e.user_id, user_name: (db.prepare('SELECT name FROM users WHERE id=?').get(e.user_id) || {}).name,
      cost_cents: Math.round(o.minutes / 60 * e.rate_cents), rate_cents: e.rate_cents, in_lat: e.in_lat, in_lng: e.in_lng, out_lat: e.out_lat, out_lng: e.out_lng, edited: !!e.edited_by });
    return o;
  };
  add('GET', '/api/clock', ({ user }) => {
    requireRole(user, 'worker');
    const open = openEntry(user.id);
    const week = db.prepare("SELECT * FROM time_entries WHERE user_id=? AND in_at >= datetime('now','-7 days') ORDER BY id DESC").all(user.id);
    return { open: open ? entryOut(open) : null, recent: week.map(e => entryOut(e)), week_minutes: week.reduce((a, e) => a + (e.out_at ? e.minutes : minutesBetween(e.in_at, nowIso())), 0) };
  });
  add('POST', '/api/clock/in', ({ user, body }) => {
    requireRole(user, 'worker');
    const jobId = intId(body.job_id);
    if (!canSeeJob(db, user, jobId)) fail(404, 'Obra no encontrada');
    if (openEntry(user.id)) fail(400, 'Ya tiene una entrada abierta: marque salida primero');
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
    const g = gps(body, 'in_');
    const rate = (db.prepare('SELECT rate_cents FROM users WHERE id=?').get(user.id) || {}).rate_cents || 0;
    const id = Number(db.prepare('INSERT INTO time_entries(user_id,job_id,in_at,in_lat,in_lng,in_acc,in_dist,rate_cents) VALUES(?,?,?,?,?,?,?,?)')
      .run(user.id, jobId, nowIso(), g.lat, g.lng, g.acc, distTo(job, g), rate).lastInsertRowid);
    return entryOut(db.prepare('SELECT * FROM time_entries WHERE id=?').get(id));
  });
  add('POST', '/api/clock/out', ({ user, body }) => {
    requireRole(user, 'worker');
    const e = openEntry(user.id); if (!e) fail(400, 'No tiene una entrada abierta');
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(e.job_id);
    const g = gps(body, 'out_'); const out = nowIso();
    return tx(db, () => {
      db.prepare('UPDATE time_entries SET out_at=?, out_lat=?, out_lng=?, out_acc=?, out_dist=?, minutes=?, note=? WHERE id=?')
        .run(out, g.lat, g.lng, g.acc, distTo(job, g), minutesBetween(e.in_at, out), str(body.note, 300), e.id);
      const done = db.prepare('SELECT * FROM time_entries WHERE id=?').get(e.id);
      laborExpense(done);
      LAB.syncOT(db, done.user_id, LAB.weekOfEntry(db, done));
      return entryOut(done);
    });
  });
  add('GET', '/api/time', ({ user, query }) => {
    requireRole(user, 'owner');
    const from = date(query.get('from'), 'desde') || addDaysIso(today(), -13), to = date(query.get('to'), 'hasta') || today();
    const rows = db.prepare('SELECT * FROM time_entries WHERE substr(in_at,1,10) BETWEEN ? AND ? ORDER BY in_at DESC LIMIT 1000').all(from, to).map(e => entryOut(e, true));
    const byUser = {};
    for (const r of rows) { const b = byUser[r.user_id] ||= { user_id: r.user_id, user_name: r.user_name, minutes: 0, cost_cents: 0 }; b.minutes += r.minutes; b.cost_cents += r.cost_cents; }
    return { from, to, entries: rows, by_user: Object.values(byUser) };
  });
  add('PUT', '/api/time/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const e = db.prepare('SELECT * FROM time_entries WHERE id=?').get(intId(params.id)); if (!e) fail(404, 'No encontrado');
    const t = (v, l) => { const s = str(v, 19).replace('T', ' '); if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) fail(400, `Hora inválida: ${l}`); return s.length === 16 ? s + ':00' : s; };
    const inAt = 'in_at' in body ? t(body.in_at, 'entrada') : e.in_at;
    const outAt = 'out_at' in body ? t(body.out_at, 'salida') : e.out_at;
    if (!outAt) fail(400, 'Falta: salida');
    if (outAt <= inAt) fail(400, 'La salida debe ser después de la entrada');
    const jobId = body.job_id ? intId(body.job_id) : e.job_id;
    const oldWeek = LAB.weekOfEntry(db, e), newWeek = LAB.weekOfEntry(db, { in_at: inAt });
    if (LAB.isPaid(db, e.user_id, oldWeek) || LAB.isPaid(db, e.user_id, newWeek)) fail(400, 'Esa semana ya se marcó como pagada. Quite el pago en Nómina para corregir horas.');
    return tx(db, () => {
      db.prepare('UPDATE time_entries SET in_at=?, out_at=?, minutes=?, job_id=?, note=?, edited_by=? WHERE id=?')
        .run(inAt, outAt, minutesBetween(inAt, outAt), jobId, 'note' in body ? str(body.note, 300) : e.note, user.id, e.id);
      laborExpense(db.prepare('SELECT * FROM time_entries WHERE id=?').get(e.id));
      LAB.syncOT(db, e.user_id, oldWeek); if (newWeek !== oldWeek) LAB.syncOT(db, e.user_id, newWeek);
      return { ok: true };
    });
  });
  add('DELETE', '/api/time/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const e = db.prepare('SELECT * FROM time_entries WHERE id=?').get(intId(params.id)); if (!e) fail(404, 'No encontrado');
    const wk = LAB.weekOfEntry(db, e);
    if (LAB.isPaid(db, e.user_id, wk)) fail(400, 'Esa semana ya se marcó como pagada. Quite el pago en Nómina para corregir horas.');
    tx(db, () => { if (e.expense_id) db.prepare('DELETE FROM expenses WHERE id=?').run(e.expense_id); db.prepare('DELETE FROM time_entries WHERE id=?').run(e.id); LAB.syncOT(db, e.user_id, wk); });
    return { ok: true };
  });
  // Dueño: anotar horas a mano (para quien no marca en el teléfono).
  add('POST', '/api/time', ({ user, body }) => {
    requireRole(user, 'owner');
    if (user.isPm || user.is_agent) fail(403, 'Esto solo lo pueden hacer los dueños');
    const w = db.prepare("SELECT id, rate_cents FROM users WHERE id=? AND role='worker'").get(intId(body.user_id)); if (!w) fail(404, 'Trabajador no encontrado');
    const jobId = intId(body.job_id); if (!db.prepare('SELECT 1 FROM jobs WHERE id=?').get(jobId)) fail(404, 'Obra no encontrada');
    const t = (v, l) => { const s = str(v, 19).replace('T', ' '); if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) fail(400, `Hora inválida: ${l}`); return s.length === 16 ? s + ':00' : s; };
    const inAt = t(body.in_at, 'entrada'), outAt = t(body.out_at, 'salida');
    if (outAt <= inAt) fail(400, 'La salida debe ser después de la entrada');
    if (minutesBetween(inAt, outAt) > 16 * 60) fail(400, 'Más de 16 horas en una sola entrada: revise las horas');
    const wk = LAB.weekOfEntry(db, { in_at: inAt });
    if (LAB.isPaid(db, w.id, wk)) fail(400, 'Esa semana ya se marcó como pagada. Quite el pago en Nómina para corregir horas.');
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO time_entries(user_id,job_id,in_at,out_at,minutes,rate_cents,note,edited_by) VALUES(?,?,?,?,?,?,?,?)')
        .run(w.id, jobId, inAt, outAt, minutesBetween(inAt, outAt), w.rate_cents || 0, str(body.note, 300) || 'Anotado por un dueño', user.id).lastInsertRowid);
      laborExpense(db.prepare('SELECT * FROM time_entries WHERE id=?').get(id));
      LAB.syncOT(db, w.id, wk);
      return { ok: true, id };
    });
  });
  add('PUT', '/api/users/:id/rate', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const u = db.prepare("SELECT id FROM users WHERE id=? AND role='worker'").get(intId(params.id)); if (!u) fail(404, 'No encontrado');
    const r = cents(body.rate_cents ?? 0, 'pago por hora');
    db.prepare("UPDATE users SET rate_cents=?, pay_type=? WHERE id=?").run(r, r ? 'hora' : 'sub', u.id);
    return { ok: true };
  });
  add('PUT', '/api/jobs/:id/location', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const lat = num(body.lat, -90, 90), lng = num(body.lng, -180, 180);
    if (body.clear) db.prepare('UPDATE jobs SET lat=NULL, lng=NULL WHERE id=?').run(job.id);
    else { if (lat == null || lng == null) fail(400, 'Ubicación inválida'); db.prepare('UPDATE jobs SET lat=?, lng=? WHERE id=?').run(lat, lng, job.id); }
    return { ok: true };
  });

  // ===================== 4) Permisos e inspecciones =====================
  const permitFields = (b, cur = {}) => {
    const kind = oneOf(b.kind ?? cur.kind ?? 'permiso', ['permiso', 'inspeccion'], 'tipo');
    return { kind, name: need(b.name ?? cur.name, 'nombre', 140), number: str(b.number ?? cur.number, 80), status: oneOf(b.status ?? cur.status ?? 'pendiente', PERMIT_STATUS, 'estado'),
      date: date(b.date ?? cur.date, 'fecha'), notes: str(b.notes ?? cur.notes, 2000) };
  };
  add('GET', '/api/jobs/:id/permits', ({ user, params }) => {
    requireRole(user, 'owner', 'worker');
    const job = jobOr404(db, user, intId(params.id));
    const rows = db.prepare("SELECT * FROM permits WHERE job_id=? ORDER BY CASE WHEN date='' THEN 1 ELSE 0 END, date, id").all(job.id);
    return user.role === 'owner' ? rows : rows.filter(p => p.kind === 'inspeccion').map(({ id, kind, name, status, date: d }) => ({ id, kind, name, status, date: d }));
  });
  add('POST', '/api/jobs/:id/permits', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const f = permitFields(body);
    const id = Number(db.prepare('INSERT INTO permits(job_id,kind,name,number,status,date,notes) VALUES(?,?,?,?,?,?,?)').run(job.id, f.kind, f.name, f.number, f.status, f.date, f.notes).lastInsertRowid);
    return { id };
  });
  add('PUT', '/api/permits/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const p = db.prepare('SELECT * FROM permits WHERE id=?').get(intId(params.id)); if (!p || !canSeeJob(db, user, p.job_id)) fail(404, 'No encontrado');
    const f = permitFields(body, p);
    db.prepare('UPDATE permits SET kind=?, name=?, number=?, status=?, date=?, notes=? WHERE id=?').run(f.kind, f.name, f.number, f.status, f.date, f.notes, p.id);
    return { ok: true };
  });
  add('DELETE', '/api/permits/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const p = db.prepare('SELECT * FROM permits WHERE id=?').get(intId(params.id)); if (!p || !canSeeJob(db, user, p.job_id)) fail(404, 'No encontrado');
    db.prepare('DELETE FROM permits WHERE id=?').run(p.id);
    return { ok: true };
  });
  add('GET', '/api/permits/upcoming', ({ user }) => {
    requireRole(user, 'owner');
    return db.prepare(`SELECT p.*, j.client_name FROM permits p JOIN jobs j ON j.id=p.job_id
      WHERE p.status NOT IN ('aprobado') AND j.status NOT IN ('cancelado','terminado') ORDER BY CASE WHEN p.date='' THEN 1 ELSE 0 END, p.date LIMIT 50`).all()
      .map(p => ({ ...p, overdue: !!p.date && p.date < today() && p.status !== 'aprobado', soon: !!p.date && p.date >= today() && p.date <= addDaysIso(today(), 7) }));
  });

  // ===================== 5) Reporte diario =====================
  const logOut = (l, role) => {
    const photos = db.prepare('SELECT id FROM files WHERE log_id=? ORDER BY created_at').all(l.id).map(f => f.id);
    const by = (db.prepare('SELECT name FROM users WHERE id=?').get(l.created_by) || {}).name || '';
    const o = { id: l.id, job_id: l.job_id, date: l.date, client_notes: l.client_notes, crew: l.crew, weather: l.weather, photos, by, shared: !!l.shared };
    if (role === 'owner') o.internal_notes = l.internal_notes;
    return o;
  };
  add('GET', '/api/jobs/:id/logs', ({ user, params }) => {
    requireRole(user, 'owner', 'client');
    const job = jobOr404(db, user, intId(params.id));
    const rows = db.prepare(`SELECT * FROM daily_logs WHERE job_id=? ${user.role === 'client' ? 'AND shared=1' : ''} ORDER BY date DESC, id DESC LIMIT 100`).all(job.id);
    return rows.map(l => require('./translate').addTr(db, logOut(l, user.role), 'client_notes', user.lang));
  });
  add('POST', '/api/jobs/:id/logs', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (photos.length > 12) fail(400, 'Máximo 12 fotos por reporte');
    const clientNotes = str(body.client_notes, 4000);
    if (!clientNotes && !photos.length) fail(400, 'Escriba qué se hizo hoy o agregue fotos');
    return tx(db, () => {
      const id = Number(db.prepare('INSERT INTO daily_logs(job_id,date,client_notes,internal_notes,crew,weather,shared,created_by) VALUES(?,?,?,?,?,?,?,?)')
        .run(job.id, needDate(body.date || today(), 'fecha'), clientNotes, str(body.internal_notes, 4000), str(body.crew, 300), str(body.weather, 80), body.shared === false ? 0 : 1, user.id).lastInsertRowid);
      for (const p of photos) { const f = saveImage(db, user, { dataUrl: p, jobId: job.id, kind: 'photo', caption: str(body.caption, 200) }); db.prepare('UPDATE files SET log_id=? WHERE id=?').run(id, f.id); }
      if (body.shared !== false && job.client_user_id) notify(db, job.client_user_id, 'daily', { job: job.address || job.client_name }, '#/');
      return logOut(db.prepare('SELECT * FROM daily_logs WHERE id=?').get(id), 'owner');
    });
  });
  add('DELETE', '/api/logs/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const l = db.prepare('SELECT * FROM daily_logs WHERE id=?').get(intId(params.id)); if (!l || !canSeeJob(db, user, l.job_id)) fail(404, 'No encontrado');
    const files = db.prepare('SELECT id, mime FROM files WHERE log_id=?').all(l.id);
    db.prepare('DELETE FROM daily_logs WHERE id=?').run(l.id);
    for (const f of files) { try { fs.unlinkSync(path.join(db.dataDir, 'files', `${f.id}.${f.mime === 'image/png' ? 'png' : f.mime === 'image/webp' ? 'webp' : 'jpg'}`)); } catch { /* */ } }
    return { ok: true };
  });

  // ===================== 6) Garantía, mantenimiento y reseñas =====================
  add('GET', '/api/followups', ({ user }) => {
    requireRole(user, 'owner');
    const horizon = addDaysIso(today(), 14);
    const out = [];
    for (const j of db.prepare("SELECT * FROM jobs WHERE status='terminado' AND completed_date<>''").all()) {
      const cu = j.client_user_id ? db.prepare('SELECT lang FROM users WHERE id=?').get(j.client_user_id) : null;
      for (const f of FOLLOWUPS) {
        const due = f.days ? addDaysIso(j.completed_date, f.days) : addMonths(j.completed_date, f.months);
        if (due > horizon || db.prepare('SELECT 1 FROM followups WHERE job_id=? AND kind=?').get(j.id, f.kind)) continue;
        if (due < addDaysIso(today(), -120)) continue; // muy viejo: ya no tiene caso
        out.push({ job_id: j.id, client_name: j.client_name, address: j.address, phone: j.client_phone, email: j.client_email, lang: cu ? cu.lang : 'es',
          kind: f.kind, due, overdue: due < today(), warranty_until: warrantyUntil(j), project_type: j.project_type });
      }
    }
    return { items: out.sort((a, b) => a.due.localeCompare(b.due)), review_link: meta('review_link'), company_phone: meta('company_phone') };
  });
  add('POST', '/api/followups', ({ user, body }) => {
    requireRole(user, 'owner');
    const jobId = intId(body.job_id);
    jobOr404(db, user, jobId);
    const kind = oneOf(body.kind, FOLLOWUPS.map(f => f.kind), 'tipo');
    db.prepare('INSERT INTO followups(job_id,kind) VALUES(?,?) ON CONFLICT(job_id,kind) DO NOTHING').run(jobId, kind);
    return { ok: true };
  });

  // ===================== 7) Prospectos desde la página web =====================
  const leadHits = new Map();
  add('POST', '/api/public/lead', ({ body, ip }) => {
    if (str(body.website, 200)) return { ok: true }; // trampa para robots: se ignora sin avisar
    const now = Date.now(), key = String(ip || '');
    const hits = (leadHits.get(key) || []).filter(t => now - t < 3600e3);
    if (hits.length >= 5) fail(429, 'Demasiadas solicitudes. Intente más tarde o llámenos.');
    hits.push(now); leadHits.set(key, hits);
    if (leadHits.size > 5000) leadHits.clear();
    const day = db.prepare("SELECT COUNT(*) n FROM jobs WHERE lead_source='Web' AND created_at >= datetime('now','-1 day')").get().n;
    if (day >= 100) fail(429, 'Demasiadas solicitudes. Intente más tarde o llámenos.');
    const name = need(body.name, 'nombre', 120);
    const phone = str(body.phone, 40), email = str(body.email, 120);
    if (!phone && !email) fail(400, 'Déjenos un teléfono o un email para contactarle');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email inválido');
    const type = C.PROJECT_TYPES.some(p => p.key === body.project_type) ? body.project_type : 'otro';
    const msg = str(body.message, 3000);
    const budget = str(body.budget, 60), when = str(body.timeline, 60);
    const desc = [msg, budget && `Presupuesto: ${budget}`, when && `Para cuándo: ${when}`].filter(Boolean).join('\n');
    const id = Number(db.prepare(`INSERT INTO jobs(client_name,client_phone,client_email,address,project_type,description,status,lead_source,follow_up_date,lead_new)
      VALUES(?,?,?,?,?,?,'prospecto','Web',?,1)`).run(name, phone, email, str(body.address, 250), type, desc, today()).lastInsertRowid);
    notify(db, owners(db), 'lead', { who: name, x: (C.PROJECT_TYPES.find(p => p.key === type) || {}).es || '' }, `#/obra/${id}/datos`);
    return { ok: true };
  });
  add('GET', '/api/leads/new', ({ user }) => {
    requireRole(user, 'owner');
    return db.prepare('SELECT id, client_name, client_phone, client_email, address, project_type, description, created_at FROM jobs WHERE lead_new=1 ORDER BY id DESC').all();
  });
  add('POST', '/api/jobs/:id/lead-seen', ({ user, params }) => {
    requireRole(user, 'owner');
    db.prepare('UPDATE jobs SET lead_new=0 WHERE id=?').run(intId(params.id));
    return { ok: true };
  });

  // ===================== 8) Ganancia por tipo y por origen =====================
  add('GET', '/api/reports/profit', ({ user, query }) => {
    requireRole(user, 'owner');
    const year = Number(query.get('year')) || new Date().getUTCFullYear();
    const jobs = db.prepare("SELECT * FROM jobs WHERE substr(COALESCE(NULLIF(start_date,''), created_at),1,4)=?").all(String(year));
    const won = j => ['activo', 'terminado'].includes(j.status);
    const types = {}, sources = {};
    for (const j of jobs) {
      const s = (j.lead_source || '').trim() || '—';
      const so = sources[s] ||= { source: s, leads: 0, won: 0, contract_cents: 0 };
      so.leads++;
      if (!won(j)) continue;
      const m = money(db, j.id);
      so.won++; so.contract_cents += m.contract;
      const t = types[j.project_type] ||= { project_type: j.project_type, jobs: 0, finished: 0, contract_cents: 0, spent_cents: 0, profit_cents: 0, rework_cents: 0 };
      t.jobs++; if (j.status === 'terminado') t.finished++;
      t.contract_cents += m.contract; t.spent_cents += m.spent; t.profit_cents += m.profit; t.rework_cents += m.rework;
    }
    const tl = Object.values(types).map(t => ({ ...t, margin_pct: t.contract_cents ? Math.round(t.profit_cents * 1000 / t.contract_cents) / 10 : null, avg_contract_cents: Math.round(t.contract_cents / t.jobs) }))
      .sort((a, b) => b.profit_cents - a.profit_cents);
    const sl = Object.values(sources).map(s => ({ ...s, close_pct: s.leads ? Math.round(s.won * 100 / s.leads) : 0 })).sort((a, b) => b.contract_cents - a.contract_cents);
    const tot = tl.reduce((a, t) => ({ contract_cents: a.contract_cents + t.contract_cents, profit_cents: a.profit_cents + t.profit_cents, jobs: a.jobs + t.jobs }), { contract_cents: 0, profit_cents: 0, jobs: 0 });
    return { year, by_type: tl, by_source: sl, totals: { ...tot, margin_pct: tot.contract_cents ? Math.round(tot.profit_cents * 1000 / tot.contract_cents) / 10 : null } };
  });

  // ===================== 9) Exportar para QuickBooks / contador =====================
  add('GET', '/api/export/:kind', ({ user, params, query }) => {
    requireRole(user, 'owner');
    const kind = oneOf(params.kind, ['gastos', 'pagos', 'bills', 'horas'], 'qué exportar');
    const from = date(query.get('from'), 'desde') || `${new Date().getUTCFullYear()}-01-01`, to = date(query.get('to'), 'hasta') || today();
    let rows;
    if (kind === 'gastos') {
      rows = [['Date', 'Payee', 'Account', 'Amount', 'Memo', 'Customer', 'Paid by']].concat(
        db.prepare(`SELECT e.*, j.client_name, s.name sub_name FROM expenses e JOIN jobs j ON j.id=e.job_id LEFT JOIN subs s ON s.id=e.sub_id
          WHERE e.date BETWEEN ? AND ? ORDER BY e.date, e.id`).all(from, to)
          .map(e => [e.date, e.vendor || e.sub_name || '', catLabel(e.category, 'en'), usd(e.amount_cents), e.description, e.client_name, e.bought_by || '']));
    } else if (kind === 'pagos') {
      rows = [['Date', 'Customer', 'Amount', 'Payment method', 'Memo']].concat(
        db.prepare('SELECT p.*, j.client_name, j.address FROM payments p JOIN jobs j ON j.id=p.job_id WHERE p.date BETWEEN ? AND ? ORDER BY p.date, p.id').all(from, to)
          .map(p => [p.date, p.client_name, usd(p.amount_cents), p.method || '', [p.address, p.note].filter(Boolean).join(' · ')]));
    } else if (kind === 'bills') {
      rows = [['Bill No', 'Vendor', 'Bill Date', 'Due Date', 'Amount', 'Customer', 'Memo', 'Paid']].concat(
        db.prepare(`SELECT d.*, j.client_name, u.name sub_name FROM sub_docs d JOIN jobs j ON j.id=d.job_id LEFT JOIN users u ON u.id=d.sub_user_id
          WHERE d.type='invoice' AND d.status='aprobado' AND d.date BETWEEN ? AND ? ORDER BY d.date, d.id`).all(from, to)
          .map(d => [d.number, d.sub_name || '', d.date, d.due_date || '', usd(d.total_cents), d.client_name, d.description, d.paid_at ? 'Yes' : 'No']));
    } else {
      rows = [['Date', 'Worker', 'Customer', 'Clock in', 'Clock out', 'Hours', 'Cost']].concat(
        db.prepare("SELECT t.*, j.client_name, u.name FROM time_entries t JOIN jobs j ON j.id=t.job_id JOIN users u ON u.id=t.user_id WHERE t.out_at<>'' AND substr(t.in_at,1,10) BETWEEN ? AND ? ORDER BY t.in_at").all(from, to)
          .map(t => [t.in_at.slice(0, 10), t.name, t.client_name, t.in_at.slice(11, 16) + ' UTC', t.out_at.slice(11, 16) + ' UTC', (t.minutes / 60).toFixed(2), usd(Math.round(t.minutes / 60 * t.rate_cents))]));
    }
    return { $buffer: Buffer.from(csv(rows), 'utf8'), $type: 'text/csv; charset=utf-8', $name: `elevated-${kind}-${from}_${to}.csv`, $attach: true };
  });

  // Pendientes extra para el número rojo del dueño.

};

module.exports.budgetCheck = (db, jobId) => { const f = BUDGET.get(db); if (f) f(jobId); };
