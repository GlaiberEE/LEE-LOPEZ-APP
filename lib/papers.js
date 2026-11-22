'use strict';
// Papeles de los subs (solo dueños): W-9, seguro con vencimiento, lien waivers por pago y reporte 1099 del año.
//  - Un "sub" se junta igual que en Cuentas: por su usuario si tiene, si no por su nombre.
//  - Los archivos (W-9, seguro, waivers) se guardan en la carpeta de datos, privados: solo los dueños los abren.
//  - Lien waivers: en Texas solo valen si siguen las formas de la ley (Property Code 53.284). La app NO las redacta:
//    guarda el waiver firmado de cada pago y avisa cuáles faltan.
//  - 1099-NEC: suma lo pagado a cada sub en el año. Umbral: $600 hasta 2025, $2,000 desde 2026 (después se ajusta por inflación;
//    se puede cambiar el número por año).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TZ = process.env.APP_TZ || 'America/Chicago';
const todayL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const getMeta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
const keyOf = s => s.user_id ? `u${s.user_id}` : `n${String(s.name || '').trim().toLowerCase()}`;
const threshold = (db, year) => { const v = Number(getMeta(db, 'thr1099_' + year)); return Number.isFinite(v) && v > 0 ? v : (Number(year) >= 2026 ? 200000 : 60000); };
const KINDS = ['cond_parcial', 'incond_parcial', 'cond_final', 'incond_final'];
const CLASSES = ['individual', 'llc', 'llc_corp', 'corp', 'otro'];
// Corporaciones (C o S) normalmente no reciben 1099-NEC por servicios; las demás sí. Confirmen con su contador.
const needs1099Class = c => !['corp', 'llc_corp'].includes(c);

module.exports = function paperRoutes(db, add, h) {
  const { requireRole, fail, str, intId } = h;
  const dir = path.join(db.dataDir, 'papers'); fs.mkdirSync(dir, { recursive: true });
  const owner = u => { requireRole(u, 'owner'); if (u.isPm || u.is_agent) fail(403, 'Esto solo lo pueden hacer los dueños'); };
  const saveFile = (dataUrl, prefix) => {
    const m = /^data:(image\/jpeg|image\/png|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) fail(400, 'Use una foto o un PDF');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) fail(413, 'El archivo es muy grande (máximo 8 MB)');
    const ok = m[1] === 'application/pdf' ? buf.slice(0, 4).toString() === '%PDF' : m[1] === 'image/png' ? buf[0] === 0x89 && buf[1] === 0x50 : buf[0] === 0xff && buf[1] === 0xd8;
    if (!ok) fail(400, 'Use una foto o un PDF');
    const name = `${prefix}-${crypto.randomBytes(8).toString('hex')}.${m[1] === 'application/pdf' ? 'pdf' : m[1] === 'image/png' ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.join(dir, name), buf);
    return name;
  };
  const people = () => {
    const map = new Map();
    for (const s of db.prepare('SELECT s.*, j.status job_status FROM subs s JOIN jobs j ON j.id=s.job_id').all()) {
      const k = keyOf(s);
      const g = map.get(k) || { key: k, name: s.name, trade: s.trade, user_id: s.user_id, active: false, sub_ids: [] };
      g.sub_ids.push(s.id); if (['activo', 'cotizado'].includes(s.job_status)) g.active = true;
      map.set(k, g);
    }
    return [...map.values()];
  };
  const paperOf = k => db.prepare('SELECT * FROM sub_papers WHERE key=?').get(k) || null;
  const coiState = p => { if (!p || !p.coi_expires) return 'falta'; const t = todayL(); return p.coi_expires < t ? 'vencido' : p.coi_expires <= addDays(t, 30) ? 'por_vencer' : 'ok'; };
  const paymentsOf = ids => ids.length ? db.prepare(`SELECT p.id, p.date, p.amount_cents, p.method, p.job_id, j.client_name, j.address FROM sub_payments p JOIN jobs j ON j.id=p.job_id WHERE p.sub_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.date DESC, p.id DESC`).all(...ids) : [];

  add('GET', '/api/papers', ({ user, query }) => {
    owner(user);
    const year = /^\d{4}$/.test(query.get('year') || '') ? query.get('year') : todayL().slice(0, 4);
    const thr = threshold(db, year);
    const list = people().map(g => {
      const p = paperOf(g.key), pays = paymentsOf(g.sub_ids);
      const paidYear = pays.filter(x => x.date.slice(0, 4) === year).reduce((a, x) => a + x.amount_cents, 0);
      const waived = new Set(db.prepare('SELECT sub_payment_id FROM lien_waivers WHERE sub_key=? AND sub_payment_id IS NOT NULL').all(g.key).map(r => r.sub_payment_id));
      const tax = p ? p.tax_class : '';
      return { key: g.key, name: g.name, trade: g.trade, active: g.active, w9: !!(p && p.w9_file), w9_date: p ? p.w9_date : '', tax_class: tax,
        coi_expires: p ? p.coi_expires : '', coi_carrier: p ? p.coi_carrier : '', coi: coiState(p), paid_year_cents: paidYear,
        needs_1099: paidYear >= thr && (!tax || needs1099Class(tax)), payments: pays.length, missing_waivers: pays.filter(x => !waived.has(x.id)).length };
    }).sort((a, b) => Number(b.active) - Number(a.active) || b.paid_year_cents - a.paid_year_cents);
    return { year, threshold_cents: thr, people: list, links: { lien_forms: 'https://statutes.capitol.texas.gov/Docs/PR/htm/PR.53.htm#53.284', w9: 'https://www.irs.gov/forms-pubs/about-form-w-9' } };
  });

  add('GET', '/api/papers/:key', ({ user, params }) => {
    owner(user);
    const k = decodeURIComponent(params.key);
    const g = people().find(x => x.key === k); if (!g) fail(404, 'No encontrado');
    const p = paperOf(k);
    const waivers = db.prepare('SELECT w.*, j.client_name FROM lien_waivers w LEFT JOIN jobs j ON j.id=w.job_id WHERE w.sub_key=? ORDER BY w.id DESC').all(k);
    const byPay = new Map(waivers.filter(w => w.sub_payment_id).map(w => [w.sub_payment_id, w]));
    return { key: k, name: g.name, trade: g.trade, tax_class: p ? p.tax_class : '', w9_file: p ? p.w9_file : '', w9_date: p ? p.w9_date : '', coi_file: p ? p.coi_file : '',
      coi_expires: p ? p.coi_expires : '', coi_carrier: p ? p.coi_carrier : '', coi: coiState(p), notes: p ? p.notes : '',
      payments: paymentsOf(g.sub_ids).map(x => ({ ...x, waiver: byPay.get(x.id) || null })), waivers };
  });

  add('PUT', '/api/papers/:key', ({ user, params, body }) => {
    owner(user);
    const k = decodeURIComponent(params.key);
    const g = people().find(x => x.key === k); if (!g) fail(404, 'No encontrado');
    const cur = paperOf(k) || { key: k, name: g.name, tax_class: '', w9_file: '', w9_date: '', coi_file: '', coi_expires: '', coi_carrier: '', notes: '' };
    const f = { ...cur };
    if ('tax_class' in body) f.tax_class = body.tax_class ? (CLASSES.includes(body.tax_class) ? body.tax_class : fail(400, 'Valor inválido: tipo')) : '';
    if (body.w9) { f.w9_file = saveFile(body.w9, 'w9'); f.w9_date = todayL(); }
    if (body.coi) f.coi_file = saveFile(body.coi, 'coi');
    if ('coi_expires' in body) f.coi_expires = /^\d{4}-\d{2}-\d{2}$/.test(String(body.coi_expires)) ? body.coi_expires : '';
    if ('coi_carrier' in body) f.coi_carrier = str(body.coi_carrier, 120);
    if ('notes' in body) f.notes = str(body.notes, 1000);
    db.prepare(`INSERT INTO sub_papers(key,name,tax_class,w9_file,w9_date,coi_file,coi_expires,coi_carrier,notes,updated_at) VALUES(?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET name=excluded.name, tax_class=excluded.tax_class, w9_file=excluded.w9_file, w9_date=excluded.w9_date, coi_file=excluded.coi_file,
      coi_expires=excluded.coi_expires, coi_carrier=excluded.coi_carrier, notes=excluded.notes, updated_at=excluded.updated_at`)
      .run(k, g.name, f.tax_class, f.w9_file, f.w9_date, f.coi_file, f.coi_expires, f.coi_carrier, f.notes);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'editar', 'papeles_sub', 0,
      `${g.name}: ${[body.w9 ? 'W-9' : '', body.coi ? 'seguro' : '', 'coi_expires' in body ? 'vence ' + (f.coi_expires || '—') : '', 'tax_class' in body ? 'tipo ' + (f.tax_class || '—') : ''].filter(Boolean).join(', ')}`);
    return { ok: true };
  });

  add('POST', '/api/papers/:key/waivers', ({ user, params, body }) => {
    owner(user);
    const k = decodeURIComponent(params.key);
    const g = people().find(x => x.key === k); if (!g) fail(404, 'No encontrado');
    const kind = KINDS.includes(body.kind) ? body.kind : fail(400, 'Valor inválido: tipo de waiver');
    let pay = null;
    if (body.sub_payment_id) {
      pay = db.prepare(`SELECT * FROM sub_payments WHERE id=? AND sub_id IN (${g.sub_ids.map(() => '?').join(',')})`).get(intId(body.sub_payment_id), ...g.sub_ids);
      if (!pay) fail(404, 'Pago no encontrado');
      if (db.prepare('SELECT 1 FROM lien_waivers WHERE sub_payment_id=?').get(pay.id)) fail(400, 'Ese pago ya tiene su waiver');
    }
    const file = saveFile(body.file, 'lw');
    const id = Number(db.prepare('INSERT INTO lien_waivers(sub_key,sub_payment_id,job_id,kind,amount_cents,through_date,file,created_by) VALUES(?,?,?,?,?,?,?,?)')
      .run(k, pay ? pay.id : null, pay ? pay.job_id : (body.job_id ? intId(body.job_id) : null), kind, pay ? pay.amount_cents : h.cents(body.amount_cents ?? 0, 'monto'),
        /^\d{4}-\d{2}-\d{2}$/.test(String(body.through_date)) ? body.through_date : (pay ? pay.date : todayL()), file, user.id).lastInsertRowid);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'crear', 'lien_waiver', id, `${g.name}: waiver ${kind}`);
    return { ok: true, id };
  });
  add('DELETE', '/api/waivers/:id', ({ user, params }) => {
    owner(user);
    const w = db.prepare('SELECT * FROM lien_waivers WHERE id=?').get(intId(params.id)); if (!w) fail(404, 'No encontrado');
    db.prepare('DELETE FROM lien_waivers WHERE id=?').run(w.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'borrar', 'lien_waiver', w.id, 'Se quitó un lien waiver');
    return { ok: true };
  });

  add('GET', '/api/papers-file/:name', ({ user, params }) => {
    owner(user);
    const n = String(params.name); if (!/^(w9|coi|lw)-[0-9a-f]{16}\.(pdf|jpg|png)$/.test(n)) fail(404, 'No encontrado');
    const f = path.join(dir, n); if (!fs.existsSync(f)) fail(404, 'No encontrado');
    return { $buffer: fs.readFileSync(f), $type: n.endsWith('.pdf') ? 'application/pdf' : n.endsWith('.png') ? 'image/png' : 'image/jpeg', $name: n };
  });

  // Reporte 1099 del año (CSV para el contador).
  add('GET', '/api/papers-1099', ({ user, query }) => {
    owner(user);
    const year = /^\d{4}$/.test(query.get('year') || '') ? query.get('year') : todayL().slice(0, 4);
    const thr = threshold(db, year);
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['Nombre', 'Oficio', 'Tipo (W-9)', 'W-9 en archivo', `Pagado en ${year}`, '¿Necesita 1099-NEC?']];
    for (const g of people()) {
      const p = paperOf(g.key);
      const paid = paymentsOf(g.sub_ids).filter(x => x.date.slice(0, 4) === year).reduce((a, x) => a + x.amount_cents, 0);
      if (!paid) continue;
      const tax = p ? p.tax_class : '';
      rows.push([g.name, g.trade, tax || 'sin W-9', p && p.w9_file ? 'sí' : 'no', (paid / 100).toFixed(2), paid >= thr && (!tax || needs1099Class(tax)) ? 'sí' : 'no']);
    }
    return { $buffer: Buffer.from('﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'utf8'), $type: 'text/csv; charset=utf-8', $name: `1099-${year}.csv`, $attach: true };
  });
  add('PUT', '/api/papers-threshold/:year', ({ user, params, body }) => {
    owner(user);
    const y = String(params.year); if (!/^\d{4}$/.test(y)) fail(400, 'Año inválido');
    setMeta(db, 'thr1099_' + y, String(h.cents(body.threshold_cents ?? 0, 'umbral')));
    return { ok: true, threshold_cents: threshold(db, y) };
  });

  // Para el inicio: seguros vencidos o por vencer, y W-9 que faltan a quien ya pasó el umbral.
  add('GET', '/api/papers-alerts', ({ user }) => {
    owner(user);
    const year = todayL().slice(0, 4), thr = threshold(db, year);
    const out = [];
    for (const g of people()) {
      const p = paperOf(g.key), st = coiState(p);
      if (g.active && (st === 'vencido' || st === 'por_vencer')) out.push({ key: g.key, name: g.name, kind: st, date: p.coi_expires });
      const paid = paymentsOf(g.sub_ids).filter(x => x.date.slice(0, 4) === year).reduce((a, x) => a + x.amount_cents, 0);
      if (paid >= thr && !(p && p.w9_file)) out.push({ key: g.key, name: g.name, kind: 'w9', paid_cents: paid });
    }
    return out;
  });
};
module.exports.threshold = threshold;
module.exports.keyOf = keyOf;
