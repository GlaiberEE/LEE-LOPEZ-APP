'use strict';
// Importador de los libros de Excel de cada obra (la plantilla de la empresa en Google Sheets):
// PROJECT_INFO, TRADES/SCOPE, MATERIALS, SUBCONTRACTORS, SALES, SCHEDULE, DOCUMENTS, ISSUES y FINAL_REVIEW.
// Primero muestra una vista previa; nada se guarda hasta que el dueño confirma.
const { readXlsx } = require('./xlsx');
const SP = require('./subpay');

const N = s => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
const clean = s => String(s ?? '').replace(/\s+\(.*?\)\s*$/, '').replace(/\s{2,}/g, ' ').trim();
function toCents(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v).trim();
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[$\s]/g, ''));
  s = s.replace(/[^0-9.]/g, '');
  if (!s) return 0;
  const n = Math.round(Number(s) * 100);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
function toDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return '';
}
const findSheet = (sheets, ...keys) => { const k = Object.keys(sheets).find(n => keys.some(x => N(n).replace(/ /g, '').startsWith(x))); return k ? sheets[k] : null; };
// Encuentra la fila de encabezados (la primera que contenga alguno de los textos) y devuelve el índice de cada columna.
function header(rows, must) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const r = Array.from(rows[i] || [], N);
    if (must.some(m => r.includes(m) || r.some(c => c.startsWith(m)))) {
      const col = (...names) => { for (const raw of names) { const nm = N(raw); const j = r.findIndex(c => c === nm || c.startsWith(nm)); if (j >= 0) return j; } return -1; };
      col.raw = rows[i];
      return { at: i, col, cols: r };
    }
  }
  return null;
}
const cell = (row, j) => (j >= 0 && row ? row[j] : null);
const txt = (row, j) => { const v = cell(row, j); return v == null ? '' : String(v).trim(); };

function guessType(trades, notes) {
  const t = trades.map(N).join(' | ') + ' ' + N(notes);
  if (/BATH|SHOWER|BANO|VANITY/.test(t)) return 'bano';
  if (/CABINET|BACKSPLASH/.test(t) && !/OUTDOOR/.test(t)) return 'cocina_interior';
  const outdoor = ['PATIO', 'PERGOLA', 'ARBOR', 'OUTDOOR KITCHEN', 'FIRE PLACE', 'FIREPLACE', 'FIRE PIT', 'DECK'].filter(k => t.includes(k));
  if (outdoor.length >= 2 || (t.includes('PATIO') && t.includes('KITCHEN'))) return 'outdoor_living';
  if (/PATIO|PERGOLA|ARBOR/.test(t)) return 'patio_cover';
  if (/OUTDOOR KITCHEN/.test(t)) return 'outdoor_kitchen';
  if (/FIRE ?PLACE/.test(t)) return 'fireplace';
  if (/FIRE PIT/.test(t)) return 'fire_pit';
  if (/DRYWALL|SHEETROCK|FLOORING|PAINT|REMODEL/.test(t)) return 'remodelacion';
  return 'otro';
}
const isPaidNote = s => /zelle|paid|pagad|check ?#|cheque|quick ?books|transfer|cash|efectivo/i.test(s) && !/not a payment|no payments|sin pagar/i.test(s);
const refOf = s => { const m = /(?:zelle\s+)?([A-Z]{3,}[A-Za-z0-9]{6,})/.exec(s) || /(?:check|cheque)\s*#\s*(\d+)/i.exec(s); return m ? m[1] : ''; };

function parseBook(buf) {
  const sheets = readXlsx(buf);
  const warnings = [];
  const out = { job: {}, lines: [], materials: [], subs: [], change_orders: [], tasks: [], links: [], lessons: [], review: null, warnings };
  // ---- PROJECT_INFO ----
  const pi = findSheet(sheets, 'PROJECTINFO');
  if (!pi) throw Object.assign(new Error('Este archivo no tiene la hoja PROJECT_INFO: no parece un libro de obra'), { status: 400 });
  const h = header(pi, ['PROJECT ID', 'CLIENT NAME']);
  const r = pi[(h ? h.at : 0) + 1] || [];
  const c = (...n) => h ? h.col(...n) : -1;
  const city = txt(r, c('CITY')), state = txt(r, c('STATE'));
  let address = txt(r, c('ADDRESS'));
  if (address && city && !N(address).includes(N(city))) address = `${address}, ${city}${state ? ', ' + state : ''}`;
  const st = N(txt(r, c('STATUS')));
  const endAct = toDate(cell(r, c('END DATE ACT')));
  out.job = {
    ref: txt(r, c('PROJECT ID')) || txt(r, c('PROJECT NAME')),
    name: txt(r, c('PROJECT NAME')),
    client_name: txt(r, c('CLIENT NAME')) || txt(r, c('PROJECT NAME')),
    address, city,
    status: /COMPLETE|DONE|TERMINAD/.test(st) ? 'terminado' : /CANCEL/.test(st) ? 'cancelado' : /LEAD|PROSPECT/.test(st) ? 'prospecto' : 'activo',
    permit: /YES|SI/.test(N(txt(r, c('PERMIT')))),
    start_date: toDate(cell(r, c('START DATE ACT'))) || toDate(cell(r, c('START PLANNED'))),
    end_date: toDate(cell(r, c('END DATE PLAN'))) || endAct,
    completed_date: endAct,
    sold_cents: toCents(cell(r, c('TOTAL SOLD'))),
    notes: txt(r, c('NOTES')),
  };
  if (!out.job.client_name) throw Object.assign(new Error('No encontramos el nombre del cliente ni del proyecto en PROJECT_INFO'), { status: 400 });
  // ---- TRADES/SCOPE: las partidas ----
  const ts = findSheet(sheets, 'TRADES', 'SCOPE');
  if (ts) {
    const th = header(ts, ['TRADE ID']);
    if (th) {
      const col = th.col;
      const iCode = col('TRADE ID'), iTrade = th.cols.findIndex(x => x.startsWith('TRADE') && x !== 'TRADE ID'), iCrew = col('CREW'), iDesc = col('DESCRIPTION'), iSold = col('SOLD AMOUNT', 'SOLD'),
        iEst = col('ESTIMATED COST'), iStat = col('STATUS'), iRate = col('COST PER SQ'), iArea = col('AREA'), iAct = col('ACTUAL COST');
      const iNote = th.cols.length; // columna sin título al final (notas como "DISCOUNTED 4500…")
      for (const row of ts.slice(th.at + 1)) {
        const code = txt(row, iCode).toUpperCase(), trade = clean(txt(row, iTrade)).toUpperCase();
        if (!code && !trade) continue;
        if (N(code) === 'TRADE ID') continue;
        let desc = txt(row, iDesc).replace(/^\s*[A-Z /&]+\s{3,}/, '').trim();
        const rate = cell(row, iRate), area = cell(row, iArea);
        if (typeof rate === 'number' && typeof area === 'number' && rate && area && !desc.includes(String(area))) desc = `${area} sqft × $${rate.toFixed(2)}\n${desc}`;
        const note = txt(row, iNote) || txt(row, iNote + 1);
        if (note) desc = `${desc}\n${note}`.trim();
        out.lines.push({ code: code || '', trade: trade || code, crew: clean(txt(row, iCrew)), description: desc, sold_cents: toCents(cell(row, iSold)),
          est_cost_cents: Math.max(0, toCents(cell(row, iEst))), sheet_cost_cents: toCents(cell(row, iAct)),
          status: /COMPLETE|DONE/.test(N(txt(row, iStat))) ? 'terminado' : /ACTIVE|PROGRESS/.test(N(txt(row, iStat))) ? 'activo' : 'pendiente',
          pass_through: /PASS[ -]?THROUGH/i.test(desc) ? 1 : 0 });
      }
    }
  } else warnings.push('No tiene hoja TRADES/SCOPE: la obra se importa sin partidas.');
  // ---- MATERIALS: cada renglón del ticket ----
  const ms = findSheet(sheets, 'MATERIALS');
  if (ms) {
    const mh = header(ms, ['MATERIAL NAME']);
    if (mh) {
      const col = mh.col;
      const iCode = col('TRADE ID'), iCat = col('CATEGORY'), iName = col('MATERIAL NAME'), iUnit = col('UNIT'), iQty = col('QUANTITY'), iUC = col('UNIT COST'),
        iTot = col('TOTAL COST'), iVen = col('VENDOR'), iDate = col('DATE');
      for (const row of ms.slice(mh.at + 1)) {
        const name = txt(row, iName); const total = toCents(cell(row, iTot));
        if (!name || !total) continue;
        // El número de ticket va en la columna después de la fecha (si es texto).
        const tk = [cell(row, iDate + 1), cell(row, iDate + 2)].find(x => typeof x === 'string' && x.trim()) || '';
        out.materials.push({ code: txt(row, iCode).toUpperCase(), category: txt(row, iCat), name, unit: txt(row, iUnit),
          qty: typeof cell(row, iQty) === 'number' ? cell(row, iQty) : Number(txt(row, iQty)) || null,
          unit_cost_cents: cell(row, iUC) == null ? null : toCents(cell(row, iUC)), total_cents: total, vendor: txt(row, iVen), date: toDate(cell(row, iDate)), ticket: String(tk).trim() });
      }
    }
  }
  // ---- SUBCONTRACTORS: lo acordado y lo pagado ----
  const ss = findSheet(sheets, 'SUBCONTRACTORS', 'SUBS');
  if (ss) {
    const sh = header(ss, ['CREW NAME']);
    if (sh) {
      const col = sh.col;
      const iCrew = col('CREW NAME'), iScope = col('SCOPE'), iCost = col('COST'), iDate = col('DATE'), iNotes = col('NOTES'), iC1 = col('CHECK1', 'CHECK 1'), iC2 = col('CHECK2', 'CHECK 2');
      ss.slice(sh.at + 1).forEach((row, k) => {
        const crew = txt(row, iCrew); const cost = toCents(cell(row, iCost));
        if (!crew || !cost) return;
        const notes = txt(row, iNotes), date = toDate(cell(row, iDate));
        const payments = [];
        for (const ic of [iC1, iC2]) if (ic >= 0 && toCents(cell(row, ic)) > 0) payments.push({ amount_cents: toCents(cell(row, ic)), date: toDate(cell(row, ic + 1)) || date, method: SP.guessMethod(notes) || 'Cheque', reference: refOf(notes) });
        const paidGuess = !payments.length && isPaidNote(notes);
        out.subs.push({ row: k, code: txt(row, 0).toUpperCase(), name: crew, scope: txt(row, iScope), agreed_cents: cost, date, notes, payments,
          paid_in_full: paidGuess, maybe_paid: !payments.length && !paidGuess && !!date && !/estimate|not a payment/i.test(notes),
          paid_method: SP.guessMethod(notes) || 'Otro', reference: refOf(notes) });
      });
    }
  }
  // ---- SALES: contrato original y change orders ----
  const sa = findSheet(sheets, 'SALES');
  if (sa) {
    const sh = header(sa, ['ORIGINAL CONTRACT']);
    if (sh) for (const row of sa.slice(sh.at + 1)) {
      const code = txt(row, sh.col('TRADE ID')).toUpperCase(), d = txt(row, sh.col('DESCRIPTION'));
      const raw = Array.from(sa[sh.at] || [], x => String(x ?? ''));
      const iP = raw.findIndex(x => /CHANGE\s*ORDER\s*\+/i.test(x)), iM = raw.findIndex(x => /CHANGE\s*ORDER\s*[-−]/i.test(x));
      const plus = toCents(cell(row, iP)), minus = Math.abs(toCents(cell(row, iM)));
      const orig = toCents(cell(row, sh.col('ORIGINAL CONTRACT')));
      if (plus) out.change_orders.push({ code, description: d || `Change order ${code}`, price_cents: plus, original_cents: orig });
      if (minus) out.change_orders.push({ code, description: d || `Change order ${code}`, price_cents: -minus, original_cents: orig });
    }
  }
  // ---- SCHEDULE ----
  const sc = findSheet(sheets, 'SCHEDULE');
  if (sc) {
    const sh = header(sc, ['TASK NAME']);
    if (sh) for (const row of sc.slice(sh.at + 1)) {
      const title = txt(row, sh.col('TASK NAME')); if (!title) continue;
      const s = N(txt(row, sh.col('STATUS')));
      out.tasks.push({ code: txt(row, sh.col('TRADE ID')).toUpperCase(), title, planned_date: toDate(cell(row, sh.col('START PLANNED'))), planned_end: toDate(cell(row, sh.col('END PLANNED'))),
        done_date: toDate(cell(row, sh.col('END ACTUAL'))), status: /DONE|COMPLETE/.test(s) ? 'hecho' : /PROGRESS|ACTIVE/.test(s) ? 'en_progreso' : 'pendiente',
        notes: [txt(row, sh.col('NOTES')), txt(row, sh.col('PRECEDING TASK')) && `Después de: ${txt(row, sh.col('PRECEDING TASK'))}`].filter(Boolean).join(' · ') });
    }
  }
  // ---- DOCUMENTS ----
  const dc = findSheet(sheets, 'DOCUMENTS');
  if (dc) {
    const sh = header(dc, ['DRIVE LINK']);
    if (sh) for (const row of dc.slice(sh.at + 1)) {
      const url = txt(row, sh.col('DRIVE LINK'));
      if (!/^https?:\/\//i.test(url)) continue;
      out.links.push({ label: txt(row, sh.col('TRADE ID')) || 'Documento', url: url.slice(0, 500), note: txt(row, sh.col('NOTES')).slice(0, 1000) });
    }
  }
  // ---- ISSUES y FINAL_REVIEW ----
  const is = findSheet(sheets, 'ISSUES');
  if (is) {
    const sh = header(is, ['ISSUE']);
    if (sh) for (const row of is.slice(sh.at + 1)) {
      const issue = txt(row, sh.col('ISSUE')); if (!issue) continue;
      out.lessons.push({ code: txt(row, sh.col('TRADE ID')).toUpperCase(), issue, cause: txt(row, sh.col('CAUSE')), cost_cents: Math.abs(toCents(cell(row, sh.col('COST IMPACT')))),
        lesson: txt(row, sh.col('LESSON')), avoid_repeat: txt(row, sh.col('AVOID')) });
    }
  }
  const fr = findSheet(sheets, 'FINALREVIEW');
  if (fr) {
    const sh = header(fr, ['PROJECT PROFITABLE']);
    const row = sh && fr[sh.at + 1];
    if (row && row.some(x => x != null && x !== '')) out.review = { profitable: txt(row, sh.col('PROJECT PROFITABLE')), stress: txt(row, sh.col('STRESS')), worked: txt(row, sh.col('WHAT WORKED')), didnt: txt(row, sh.col('WHAT DIDNT')), notes: txt(row, sh.col('OWNER NOTES')) };
  }
  // ---- revisiones ----
  const linesSold = out.lines.reduce((a, l) => a + l.sold_cents, 0);
  if (!out.job.sold_cents) out.job.sold_cents = linesSold;
  const coTotal = out.change_orders.reduce((a, x) => a + x.price_cents, 0);
  out.job.quoted_cents = out.job.sold_cents - coTotal;  // el contrato original; los change orders se suman aparte
  if (out.lines.length && Math.abs(out.job.sold_cents - linesSold) > 100) warnings.push(`El total vendido (${(out.job.sold_cents / 100).toFixed(2)}) no es igual a la suma de las partidas (${(linesSold / 100).toFixed(2)}).`);
  const zero = out.lines.filter(l => l.sold_cents > 0 && !l.sheet_cost_cents).length;
  if (zero) warnings.push(`${zero} partida(s) sin ningún costo anotado todavía: su margen sale en 100%.`);
  const codes = new Set(out.lines.map(l => l.code));
  const orphan = [...new Set([...out.materials, ...out.subs].map(x => x.code).filter(cd => cd && !codes.has(cd)))];
  if (orphan.length) warnings.push(`Códigos que no están en TRADES/SCOPE (se crean como partidas sin venta): ${orphan.join(', ')}.`);
  out.project_type = guessType(out.lines.map(l => l.trade), out.job.notes);
  return out;
}

function summary(p) {
  const matTotal = p.materials.reduce((a, m) => a + m.total_cents, 0);
  const tickets = new Set(p.materials.map(m => [m.code, m.vendor, m.date, m.ticket].join('|'))).size;
  return { job: p.job, project_type: p.project_type, warnings: p.warnings,
    lines: p.lines.map(l => ({ code: l.code, trade: l.trade, crew: l.crew, sold_cents: l.sold_cents, sheet_cost_cents: l.sheet_cost_cents, pass_through: !!l.pass_through })),
    materials: { items: p.materials.length, tickets, total_cents: matTotal },
    subs: p.subs.map(s => ({ row: s.row, code: s.code, name: s.name, scope: s.scope, agreed_cents: s.agreed_cents, date: s.date, notes: s.notes,
      paid_cents: s.payments.reduce((a, x) => a + x.amount_cents, 0), paid_in_full: s.paid_in_full, maybe_paid: s.maybe_paid })),
    change_orders: p.change_orders, tasks: p.tasks.length, links: p.links.length, lessons: p.lessons.length, review: !!p.review };
}

module.exports = function importRoutes(db, add, h) {
  const { requireRole, fail, PROJECT_TYPES } = h;
  const owner = u => { requireRole(u, 'owner'); if (u.isPm) fail(403, 'Esto solo lo pueden hacer los dueños'); };
  const load = body => {
    const m = /^data:[^;]*;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.file || ''));
    if (!m) fail(400, 'Suba el archivo de Excel (.xlsx)');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 15 * 1024 * 1024) fail(413, 'Archivo de Excel demasiado grande');
    if (buf.slice(0, 2).toString() !== 'PK') fail(400, 'No es un archivo de Excel (.xlsx). En Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx)');
    try { return parseBook(buf); } catch (e) { fail(e.status || 400, e.status ? e.message : 'No se pudo leer el archivo de Excel'); }
  };
  const existing = ref => ref ? db.prepare('SELECT id, client_name FROM jobs WHERE import_ref=?').get(ref) : null;

  add('POST', '/api/import/xlsx/preview', ({ user, body }) => {
    owner(user);
    const p = load(body);
    return { ...summary(p), duplicate: existing(p.job.ref) || null };
  });

  add('POST', '/api/import/xlsx/commit', ({ user, body }) => {
    owner(user);
    const p = load(body);
    if (existing(p.job.ref)) fail(400, 'Esa obra ya se importó. Bórrela primero si quiere importarla de nuevo.');
    const type = PROJECT_TYPES.some(x => x.key === body.project_type) ? body.project_type : p.project_type;
    const status = ['prospecto', 'cotizado', 'activo', 'terminado', 'cancelado'].includes(body.status) ? body.status : p.job.status;
    const paidRows = new Set((Array.isArray(body.paid_rows) ? body.paid_rows : p.subs.filter(s => s.paid_in_full).map(s => s.row)).map(Number));
    const today = new Date().toISOString().slice(0, 10);
    db.exec('BEGIN');
    try {
      const J = p.job;
      const jobId = Number(db.prepare(`INSERT INTO jobs(client_name,address,project_type,description,status,quoted_cents,start_date,end_date,completed_date,city,import_ref,notes)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(J.client_name.slice(0, 120), J.address.slice(0, 200), type, [J.name && J.name !== J.client_name ? J.name : '', J.notes].filter(Boolean).join('\n').slice(0, 4000),
        status, Math.max(0, J.quoted_cents), J.start_date, J.end_date, status === 'terminado' ? (J.completed_date || J.end_date) : '', J.city, J.ref, `Importado de Excel (${String(body.name || '').slice(0, 80)})`).lastInsertRowid);
      // Partidas (y las que solo aparecen en materiales o subs).
      const lineId = new Map();
      const addLine = (l, pos) => {
        let code = l.code || `L-${pos}`;
        while (db.prepare('SELECT 1 FROM job_lines WHERE job_id=? AND code=?').get(jobId, code)) code += '*';
        const id = Number(db.prepare('INSERT INTO job_lines(job_id,code,trade,crew,description,sold_cents,est_cost_cents,pass_through,status,position) VALUES(?,?,?,?,?,?,?,?,?,?)')
          .run(jobId, code, (l.trade || code).slice(0, 80), (l.crew || '').slice(0, 80), (l.description || '').slice(0, 4000), l.sold_cents || 0, l.est_cost_cents || 0, l.pass_through || 0, l.status || 'pendiente', pos).lastInsertRowid);
        if (l.code) lineId.set(l.code, id);
        return id;
      };
      p.lines.forEach((l, i) => addLine(l, i + 1));
      const lineFor = code => { if (!code) return null; if (!lineId.has(code)) addLine({ code, trade: code.replace(/-\d+$/, ''), sold_cents: 0 }, lineId.size + 100); return lineId.get(code); };
      // Change orders aprobados (SALES).
      for (const co of p.change_orders) db.prepare("INSERT INTO change_orders(job_id,date,description,cost_cents,price_cents,status,line_id) VALUES(?,?,?,0,?,'aprobado',?)")
        .run(jobId, J.start_date || today, co.description.slice(0, 300), co.price_cents, lineFor(co.code));
      // La venta de la partida es la original cuando hay change orders sobre ella (para no contarlos dos veces).
      for (const co of p.change_orders) if (co.code && lineId.has(co.code) && co.original_cents) db.prepare('UPDATE job_lines SET sold_cents=? WHERE id=?').run(co.original_cents, lineId.get(co.code));
      // Materiales: un gasto por ticket, con cada renglón guardado.
      const groups = new Map();
      for (const m of p.materials) { const k = [m.code, m.vendor, m.date, m.ticket].join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
      for (const items of groups.values()) {
        const f = items[0];
        const total = items.reduce((a, m) => a + m.total_cents, 0);
        const desc = `${f.ticket ? f.ticket + ' · ' : ''}${items.slice(0, 3).map(m => m.name).join(', ')}${items.length > 3 ? ` y ${items.length - 3} más` : ''}`.slice(0, 300);
        const cat = /PERMIT/i.test(f.category) ? 'permisos' : /RENT|EQUIP/i.test(f.category) ? 'renta_equipo' : /DUMP|TRASH|HAUL/i.test(f.category) ? 'basura' : 'material';
        const eid = Number(db.prepare('INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,created_by,line_id) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(jobId, f.date || J.start_date || today, cat, desc, f.vendor.slice(0, 120), '', total, user.id, lineFor(f.code)).lastInsertRowid);
        const ins = db.prepare('INSERT INTO expense_items(expense_id,name,category,unit,qty,unit_cost_cents,total_cents) VALUES(?,?,?,?,?,?,?)');
        for (const m of items) ins.run(eid, m.name.slice(0, 200), m.category.slice(0, 60), m.unit.slice(0, 20), m.qty, m.unit_cost_cents, m.total_cents);
      }
      // Subs: uno por cuadrilla y partida, con lo acordado y los pagos.
      const subKey = new Map();
      for (const s of p.subs) {
        const k = s.name.toUpperCase() + '|' + s.code;
        let sid = subKey.get(k);
        if (!sid) {
          sid = Number(db.prepare('INSERT INTO subs(job_id,name,trade,agreed_cents,notes,line_id) VALUES(?,?,?,?,?,?)')
            .run(jobId, s.name.slice(0, 120), (p.lines.find(l => l.code === s.code) || {}).trade || s.code, 0, '', lineFor(s.code)).lastInsertRowid);
          subKey.set(k, sid);
        }
        db.prepare("UPDATE subs SET agreed_cents=agreed_cents+?, notes=TRIM(notes || ' · ' || ?, ' ·') WHERE id=?").run(s.agreed_cents, [s.scope, s.notes].filter(Boolean).join(' — ').slice(0, 500), sid);
        const sub = db.prepare('SELECT * FROM subs WHERE id=?').get(sid);
        for (const pay of s.payments) SP.addPayment(db, user, sub, { date: pay.date || s.date || J.start_date || today, amount: pay.amount_cents, method: pay.method, reference: pay.reference, note: 'Importado de Excel' });
        const paid = s.payments.reduce((a, x) => a + x.amount_cents, 0);
        if (paidRows.has(s.row) && s.agreed_cents > paid) SP.addPayment(db, user, sub, { date: s.date || J.start_date || today, amount: s.agreed_cents - paid, method: s.paid_method, reference: s.reference, note: 'Importado de Excel' });
      }
      // Cronograma, documentos, lecciones y revisión final.
      p.tasks.forEach((tk, i) => db.prepare('INSERT INTO tasks(job_id,position,title,status,planned_date,planned_end,done_date,notes,line_id) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(jobId, i + 1, tk.title.slice(0, 200), tk.status, tk.planned_date, tk.planned_end, tk.status === 'hecho' ? (tk.done_date || tk.planned_end || tk.planned_date) : '', tk.notes.slice(0, 1000), lineFor(tk.code)));
      for (const l of p.links) db.prepare('INSERT INTO job_links(job_id,label,url,note) VALUES(?,?,?,?)').run(jobId, l.label.slice(0, 120), l.url, l.note);
      for (const l of p.lessons) db.prepare('INSERT INTO job_lessons(job_id,line_code,issue,cause,cost_cents,lesson,avoid_repeat) VALUES(?,?,?,?,?,?,?)').run(jobId, l.code, l.issue.slice(0, 500), l.cause.slice(0, 500), l.cost_cents, l.lesson.slice(0, 1000), l.avoid_repeat.slice(0, 100));
      if (p.review) db.prepare('UPDATE jobs SET review_profitable=?, review_stress=?, review_worked=?, review_didnt=?, review_notes=? WHERE id=?').run(p.review.profitable, p.review.stress, p.review.worked, p.review.didnt, p.review.notes, jobId);
      db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,?,?,?,?,?)").run(user.id, 'crear', 'obra', jobId, jobId, `Importó ${J.client_name} desde Excel (${p.lines.length} partidas, ${p.materials.length} materiales, ${p.subs.length} subs)`);
      db.exec('COMMIT');
      return { ok: true, job_id: jobId };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });

  // Documentos, lecciones aprendidas y revisión final de la obra.
  const jobOk = (user, id) => { requireRole(user, 'owner'); const j = h.jobOr404(db, user, h.intId(id)); return j; };
  add('GET', '/api/jobs/:id/closeout', ({ user, params }) => {
    const j = jobOk(user, params.id);
    return { links: db.prepare('SELECT * FROM job_links WHERE job_id=? ORDER BY id').all(j.id), lessons: db.prepare('SELECT * FROM job_lessons WHERE job_id=? ORDER BY id').all(j.id),
      review: { profitable: j.review_profitable, stress: j.review_stress, worked: j.review_worked, didnt: j.review_didnt, notes: j.review_notes } };
  });
  add('POST', '/api/jobs/:id/links', ({ user, params, body }) => {
    const j = jobOk(user, params.id);
    const url = h.str(body.url, 500); if (!/^https?:\/\//i.test(url)) fail(400, 'El enlace debe empezar con https://');
    db.prepare('INSERT INTO job_links(job_id,label,url,note) VALUES(?,?,?,?)').run(j.id, h.str(body.label, 120), url, h.str(body.note, 1000));
    return { ok: true };
  });
  add('DELETE', '/api/job-links/:id', ({ user, params }) => {
    const l = db.prepare('SELECT * FROM job_links WHERE id=?').get(h.intId(params.id)); if (!l) fail(404, 'No encontrado');
    jobOk(user, l.job_id); db.prepare('DELETE FROM job_links WHERE id=?').run(l.id); return { ok: true };
  });
  add('POST', '/api/jobs/:id/lessons', ({ user, params, body }) => {
    const j = jobOk(user, params.id);
    db.prepare('INSERT INTO job_lessons(job_id,line_code,issue,cause,cost_cents,lesson,avoid_repeat) VALUES(?,?,?,?,?,?,?)')
      .run(j.id, h.str(body.line_code, 20), h.need(body.issue, 'problema', 500), h.str(body.cause, 500), body.cost_cents ? h.cents(body.cost_cents, 'costo') : 0, h.str(body.lesson, 1000), h.str(body.avoid_repeat, 100));
    return { ok: true };
  });
  add('DELETE', '/api/lessons/:id', ({ user, params }) => {
    const l = db.prepare('SELECT * FROM job_lessons WHERE id=?').get(h.intId(params.id)); if (!l) fail(404, 'No encontrado');
    jobOk(user, l.job_id); db.prepare('DELETE FROM job_lessons WHERE id=?').run(l.id); return { ok: true };
  });
  add('PUT', '/api/jobs/:id/review', ({ user, params, body }) => {
    const j = jobOk(user, params.id);
    db.prepare('UPDATE jobs SET review_profitable=?, review_stress=?, review_worked=?, review_didnt=?, review_notes=? WHERE id=?')
      .run(h.str(body.profitable, 20), h.str(body.stress, 10), h.str(body.worked, 2000), h.str(body.didnt, 2000), h.str(body.notes, 2000), j.id);
    return { ok: true };
  });
  // Lecciones de obras anteriores del mismo tipo (para planear y cotizar mejor).
  add('GET', '/api/lessons', ({ user, query }) => {
    requireRole(user, 'owner');
    const type = String(query.get('type') || '');
    return db.prepare(`SELECT l.*, j.client_name, j.project_type FROM job_lessons l JOIN jobs j ON j.id=l.job_id ${type ? 'WHERE j.project_type=?' : ''} ORDER BY l.id DESC LIMIT 100`).all(...(type ? [type] : []));
  });
};
module.exports.parseBook = parseBook;
module.exports.toCents = toCents;
module.exports.toDate = toDate;
