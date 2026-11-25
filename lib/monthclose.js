'use strict';
// Fase 8, parte 2 — Cierre de mes para la contadora.
//  - Revisión antes de cerrar: tickets sin foto, tickets por asignar, invoices de subs por aprobar y gastos de reembolso.
//  - Paquete del mes (.zip): todos los archivos para Excel/QuickBooks del mes y las fotos de los tickets, con un LEEME.
//  - "Cerrar el mes": usa el cierre de periodo que ya existe (nadie cambia nada de ese mes; reabrir necesita al otro dueño).
//  - Lo ven los dueños y la contadora; cerrar lo hace un dueño.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ===== ZIP mínimo (deflate), sin dependencias =====
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  const now = new Date(); const dt = ((now.getFullYear() - 1980) << 25) | ((now.getMonth() + 1) << 21) | (now.getDate() << 16) | (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const comp = zlib.deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(dt >>> 0, 10);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, name, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(dt >>> 0, 12);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, name);
    off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}

const lastDay = m => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function routes(db, add, h, dispatch) {
  const { requireRole, fail } = h;
  const month = v => { const m = String(v || ''); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) fail(400, 'Mes inválido (AAAA-MM)'); return m; };
  const can = u => { requireRole(u, 'owner'); if (u.isPm || (u.isOffice && u.office !== 'accountant')) fail(403, 'Esto solo lo pueden ver los dueños y la contadora'); };
  // Revisión del mes antes de cerrarlo.
  add('GET', '/api/month-close', ({ user, query }) => {
    can(user);
    const m = month(query.get('month')), from = m + '-01', to = lastDay(m);
    const lock = (db.prepare("SELECT value FROM meta WHERE key='lock_date'").get() || {}).value || '';
    const q = (sql, ...a) => db.prepare(sql).get(...a).n;
    const checks = [
      { key: 'sin_foto', n: q("SELECT COUNT(*) n FROM receipts WHERE date BETWEEN ? AND ? AND file=''", from, to), es: 'Tickets sin foto', en: 'Receipts without a photo', link: '#/gastos' },
      { key: 'por_asignar', n: q("SELECT COUNT(*) n FROM scans WHERE status='por_asignar' AND substr(created_at,1,10) BETWEEN ? AND ?", from, to), es: 'Tickets escaneados sin obra', en: 'Scanned receipts without a job', link: '#/gastos' },
      { key: 'invoices_subs', n: q("SELECT COUNT(*) n FROM sub_docs WHERE type='invoice' AND status NOT IN ('aprobado','rechazado') AND date BETWEEN ? AND ?", from, to), es: 'Invoices de subs sin aprobar', en: 'Sub invoices not approved', link: '#/' },
      { key: 'pendientes', n: q("SELECT COUNT(*) n FROM change_requests WHERE status='pendiente'"), es: 'Cambios esperando aprobación', en: 'Changes waiting for approval', link: '#/' },
    ];
    const totals = {
      job_expenses_cents: db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE date BETWEEN ? AND ?').get(from, to).v,
      company_expenses_cents: db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM company_expenses WHERE date BETWEEN ? AND ?').get(from, to).v,
      client_payments_cents: db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE date BETWEEN ? AND ?').get(from, to).v,
      receipts: q('SELECT COUNT(*) n FROM receipts WHERE date BETWEEN ? AND ?', from, to),
    };
    return { month: m, from, to, lock_date: lock, closed: !!lock && lock >= to, checks, totals, can_close: user.role === 'owner' && !user.isOffice && !user.isPm && !user.is_agent };
  });
  // Paquete del mes: CSVs + fotos de los tickets.
  add('GET', '/api/month-close/zip', async ({ user, query }) => {
    can(user);
    const m = month(query.get('month')), from = m + '-01', to = lastDay(m);
    const qs = new URLSearchParams({ from, to });
    const files = [];
    const get = async (p, name) => { try { const r = await dispatch('GET', p, { user, query: qs, body: {} }); if (r && r.$buffer) files.push({ name, data: r.$buffer }); } catch { /* sin datos */ } };
    await get('/api/accounting.csv', `${m}/expenses-all-${m}.csv`);
    for (const k of ['gastos', 'pagos', 'bills']) await get(`/api/export/${k}`, `${m}/quickbooks-${({ gastos: 'expenses', pagos: 'client-payments', bills: 'sub-bills' })[k]}-${m}.csv`);
    const rdir = path.join(db.dataDir, 'receipts');
    let photos = 0;
    for (const r of db.prepare("SELECT * FROM receipts WHERE date BETWEEN ? AND ? AND file<>'' ORDER BY date, id").all(from, to)) {
      try { files.push({ name: `${m}/receipts/${r.date}_${String(r.vendor).replace(/[^\w.-]+/g, '_').slice(0, 30)}_${r.ticket || r.id}.${EXT[r.mime] || 'jpg'}`, data: fs.readFileSync(path.join(rdir, r.file)) }); photos++; } catch { /* */ }
    }
    const co = require('./company').info(db);
    files.unshift({ name: `${m}/README.txt`, data: [`${co.name} — month package ${m}`, '', `Period: ${from} to ${to}`, `Receipt photos: ${photos}`, '',
      'expenses-all: job and company expenses (subtotal, tax, total, payment method).', 'quickbooks-expenses / client-payments / sub-bills: ready to import in QuickBooks.',
      'receipts/: photo of each receipt, named date_vendor_ticket.', '', `Generated ${new Date().toISOString()}`].join('\r\n') });
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.officeId || user.id, 'exportar', 'cierre de mes', 0, `Paquete del mes ${m} (${files.length} archivos)`);
    return { $buffer: zip(files), $type: 'application/zip', $name: `${co.key}-month-${m}.zip`, $attach: true };
  });
}

module.exports = { routes, zip, crc32, lastDay };
