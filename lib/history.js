'use strict';
// Fase 6 — Historial diario de cada obra (Daily log).
//  - Cada día la app junta solo lo que pasó en la obra: tareas empezadas y terminadas, fechas movidas, inspecciones
//    (con resultado), fotos, rough-in confirmado, change orders, casos, tickets (sin montos), avisos de atraso,
//    novedades al cliente, el plan del día y el reporte del día (clima, cuadrilla y notas).
//  - Se guarda en inglés (el registro oficial de la compañía) y también en español para quien lee en español.
//    Lo que escribe la gente se traduce con la misma AI de las traducciones; el original siempre queda.
//  - A las 6:30 PM, si una obra trabajó hoy y nadie escribió el reporte del día, le avisa al encargado (PM o dueños).
//  - A las 10 PM el día se cierra solo: queda congelado y ya no cambia. Lo que llegue después entra como "nota tardía"
//    con fecha, hora y quién la puso (no se borra).
//  - PDF del día o de toda la obra, en inglés (o en español si se pide). Nunca lleva montos de dinero.
//  - Solo dueños y PM de la obra. Subs y clientes no lo ven (el cliente tiene su reporte diario aparte).
const crypto = require('node:crypto');
const tr = require('./translate');
const { utcRange } = require('./pmreport');

const TZ = () => process.env.APP_TZ || 'America/Chicago';
const todayL = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(now);
const minutesL = (now = new Date()) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map(x => [x.type, x.value])); return (+p.hour % 24) * 60 + +p.minute; };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ALERT_AT = 18 * 60 + 30, CLOSE_AT = 22 * 60;
const meta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
const hm = utc => { if (!utc || utc.length < 16) return ''; return new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(utc.replace(' ', 'T') + 'Z')); };
const nowUtc = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const MONTHS = { en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] };
const fd = (iso, lang) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return iso || ''; const [y, m, d] = iso.split('-').map(Number); return lang === 'en' ? `${MONTHS.en[m - 1]} ${d}, ${y}` : `${d} ${MONTHS.es[m - 1]} ${y}`; };

// ===== Texto en cada idioma =====
let PAIRS = null;
function pairs() {
  if (!PAIRS) {
    const p = require('./catalog').taskPairs();
    // También los nombres de las inspecciones de la app (es ↔ en).
    try { for (const t of require('./inspections').TYPES) if (t.es && t.en) p.push([t.es, t.en], ['Inspección: ' + t.es, 'Inspection: ' + t.en], ['Reinspección: ' + t.es, 'Re-inspection: ' + t.en]); } catch { /* */ }
    PAIRS = { en: new Map(p), es: new Map(p.map(([a, b]) => [b, a])) };
  }
  return PAIRS;
}
// Un texto escrito por la gente (o un título de tarea) en el idioma pedido. Si no hay traducción, el original.
function inLang(db, s, lang) {
  if (!s) return '';
  const p = pairs()[lang]; if (p && p.has(s)) return p.get(s);
  // Lo ya traducido se usa aunque hoy no haya clave de AI; si falta y hay clave, se manda traducir.
  try {
    const c = db.prepare('SELECT src, out FROM translations WHERE h=? AND lang=?').get(crypto.createHash('sha1').update(String(s).slice(0, 4000)).digest('hex'), lang);
    if (c) return c.out || s;
  } catch { /* la tabla se crea con la primera traducción */ }
  const r = tr.forReader(db, s, lang);
  return r && r.tr ? r.tr : s;
}
const both = (db, s) => ({ en: inLang(db, s, 'en'), es: inLang(db, s, 'es') });
const firstName = (db, id) => { const n = id && (db.prepare('SELECT name FROM users WHERE id=?').get(id) || {}).name; if (!n) return ''; const w = n.split(' '); return /\.$/.test(w[0]) && w[1] ? w[0] + ' ' + w[1] : w[0]; };

// ===== Lo que pasa y no queda en otra tabla (empezar, terminar, mover una tarea) =====
function event(db, jobId, userId, kind, data) {
  try { db.prepare('INSERT INTO job_events(job_id,user_id,kind,data) VALUES(?,?,?,?)').run(jobId, userId || null, kind, JSON.stringify(data || {})); } catch (e) { console.error('[historial]', e.message); }
}
function taskChange(db, user, t, f) {
  const uid = user.pmId || user.id;
  if (f.status && f.status !== t.status) event(db, t.job_id, uid, f.status === 'hecho' ? 'task_done' : f.status === 'en_progreso' ? 'task_start' : 'task_reopen', { task: t.id, title: f.title || t.title, assignee: f.assignee_id ?? t.assignee_id });
  if ('planned_date' in f && f.planned_date && t.planned_date && f.planned_date !== t.planned_date) event(db, t.job_id, uid, 'task_moved', { task: t.id, title: f.title || t.title, from: t.planned_date, to: f.planned_date });
}

// ===== Junta lo que pasó en una obra un día =====
function compile(db, jobId, day) {
  const [a, b] = utcRange(day, TZ());
  const lines = [];
  const L = (time, icon, kind, en, es) => lines.push({ t: time || '', icon, kind, en, es });
  const T = s => both(db, s);

  const doneByEvent = new Set();
  for (const e of db.prepare('SELECT * FROM job_events WHERE job_id=? AND at>=? AND at<? ORDER BY at, id').all(jobId, a, b)) {
    const d = JSON.parse(e.data || '{}'); const who = firstName(db, e.user_id); const t = T(d.title);
    const by = who ? ` — ${who}` : '';
    if (e.kind === 'task_start') L(hm(e.at), '▶', 'task', `Started: ${t.en}${by}`, `Empezó: ${t.es}${by}`);
    else if (e.kind === 'task_done') { doneByEvent.add(d.task); L(hm(e.at), '✔', 'task', `Finished: ${t.en}${by}`, `Terminó: ${t.es}${by}`); }
    else if (e.kind === 'task_reopen') L(hm(e.at), '↺', 'task', `Back to pending: ${t.en}${by}`, `Regresó a pendiente: ${t.es}${by}`);
    else if (e.kind === 'task_moved') L(hm(e.at), '📅', 'schedule', `Rescheduled: ${t.en} from ${fd(d.from, 'en')} to ${fd(d.to, 'en')}${by}`, `Se movió: ${t.es} del ${fd(d.from, 'es')} al ${fd(d.to, 'es')}${by}`);
  }
  for (const t of db.prepare("SELECT id, title, assignee_id FROM tasks WHERE job_id=? AND done_date=? AND status='hecho' ORDER BY position, id").all(jobId, day)) {
    if (doneByEvent.has(t.id)) continue;
    const x = T(t.title), who = firstName(db, t.assignee_id);
    L('', '✔', 'task', `Completed: ${x.en}${who ? ` (${who})` : ''}`, `Quedó hecha: ${x.es}${who ? ` (${who})` : ''}`);
  }
  // Inspecciones
  for (const p of db.prepare("SELECT * FROM permits WHERE job_id=? AND kind='inspeccion' AND (date=? OR result_at=?) ORDER BY id").all(jobId, day, day)) {
    const x = T(p.name);
    if (p.result_at === day && p.status === 'aprobado') L('', '✅', 'inspection', `Inspection passed: ${x.en}${p.inspector ? ` (inspector ${p.inspector})` : ''}`, `Inspección pasó: ${x.es}${p.inspector ? ` (inspector ${p.inspector})` : ''}`);
    else if (p.result_at === day && p.status === 'rechazado') { const r = T(p.fail_reason); L('', '❌', 'inspection', `Inspection failed: ${x.en}${r.en ? ` — ${r.en}` : ''}`, `Inspección no pasó: ${x.es}${r.es ? ` — ${r.es}` : ''}`); }
    else L('', '🏛️', 'inspection', `Inspection scheduled: ${x.en}${p.result_at ? '' : ' (no result yet)'}`, `Inspección programada: ${x.es}${p.result_at ? '' : ' (sin resultado todavía)'}`);
  }
  // Rough-in confirmado con foto
  const RI = (() => { try { return require('./roughin'); } catch { return null; } })();
  for (const it of db.prepare("SELECT * FROM roughin_items WHERE job_id=? AND confirmed_at>=? AND confirmed_at<? AND status IN ('ok','na') ORDER BY confirmed_at").all(jobId, a, b)) {
    const lab = RI && RI.labelOf ? { en: RI.labelOf(it, 'en'), es: RI.labelOf(it, 'es') } : T(it.label);
    const who = firstName(db, it.confirmed_by);
    if (it.status === 'ok') L(hm(it.confirmed_at), '📷', 'roughin', `Rough-in confirmed with photo: ${lab.en}${who ? ` — ${who}` : ''}`, `Rough-in confirmado con foto: ${lab.es}${who ? ` — ${who}` : ''}`);
    else L(hm(it.confirmed_at), '—', 'roughin', `Rough-in marked not applicable: ${lab.en}`, `Rough-in no aplica: ${lab.es}`);
  }
  // Fotos
  const photos = db.prepare("SELECT id, created_by, mime FROM files WHERE job_id=? AND kind='photo' AND created_at>=? AND created_at<? ORDER BY created_at").all(jobId, a, b);
  if (photos.length) {
    const by = {}; photos.forEach(p => { const n = firstName(db, p.created_by) || '?'; by[n] = (by[n] || 0) + 1; });
    const who = Object.entries(by).map(([n, c]) => `${n} ${c}`).join(', ');
    L('', '🖼️', 'photos', `${photos.length} photo${photos.length === 1 ? '' : 's'} added (${who})`, `${photos.length} foto${photos.length === 1 ? '' : 's'} (${who})`);
  }
  // Change orders (sin precios)
  for (const c of db.prepare('SELECT * FROM change_orders WHERE job_id=? AND (date=? OR substr(approved_at,1,10)=? OR substr(done_at,1,10)=?) ORDER BY id').all(jobId, day, day, day)) {
    const x = T(c.description), code = c.code ? `${c.code} ` : '';
    if (c.date === day) L('', '📝', 'change', `Change order created: ${code}${x.en}`, `Change order nuevo: ${code}${x.es}`);
    if (String(c.approved_at || '').slice(0, 10) === day && c.status === 'aprobado') L('', '👍', 'change', `Change order approved: ${code}${x.en}`, `Change order aprobado: ${code}${x.es}`);
    if (String(c.done_at || '').slice(0, 10) === day) L('', '✔', 'change', `Change order work done: ${code}${x.en}`, `Change order hecho: ${code}${x.es}`);
  }
  // Casos
  for (const i of db.prepare('SELECT * FROM issues WHERE job_id=? AND ((created_at>=? AND created_at<?) OR (resolved_at>=? AND resolved_at<?)) ORDER BY id').all(jobId, a, b, a, b)) {
    const x = T(i.title);
    if (i.created_at >= a && i.created_at < b) L(hm(i.created_at), i.urgent ? '🚨' : '💬', 'case', `Case opened: ${x.en} — ${firstName(db, i.created_by)}`, `Caso abierto: ${x.es} — ${firstName(db, i.created_by)}`);
    if (i.resolved_at && i.resolved_at >= a && i.resolved_at < b) L(hm(i.resolved_at), '✔', 'case', `Case resolved: ${x.en}`, `Caso resuelto: ${x.es}`);
  }
  // Avisos de cambio de fecha
  for (const n of db.prepare('SELECT n.*, t.title FROM notices n JOIN tasks t ON t.id=n.task_id WHERE n.job_id=? AND n.created_at>=? AND n.created_at<? ORDER BY n.id').all(jobId, a, b)) {
    const x = T(n.title), note = T(n.note);
    const dates = n.old_date && n.new_date ? { en: ` ${fd(n.old_date, 'en')} → ${fd(n.new_date, 'en')}`, es: ` ${fd(n.old_date, 'es')} → ${fd(n.new_date, 'es')}` } : { en: '', es: '' };
    L(hm(n.created_at), '⏰', 'schedule', `Date change notice: ${x.en}${dates.en}${note.en ? ` — ${note.en}` : ''} (${firstName(db, n.created_by)})`, `Aviso de cambio de fecha: ${x.es}${dates.es}${note.es ? ` — ${note.es}` : ''} (${firstName(db, n.created_by)})`);
  }
  // Tickets (sin montos)
  for (const r of db.prepare('SELECT DISTINCT r.id, r.vendor, r.ticket, r.created_at FROM receipts r JOIN expenses e ON e.receipt_id=r.id WHERE e.job_id=? AND r.date=? ORDER BY r.id').all(jobId, day)) {
    L(hm(r.created_at), '🧾', 'receipt', `Receipt logged: ${r.vendor}${r.ticket ? ` #${r.ticket}` : ''}`, `Ticket registrado: ${r.vendor}${r.ticket ? ` #${r.ticket}` : ''}`);
  }
  // Novedades al cliente
  const UPD = { schedule: ['Schedule update sent to client', 'Se avisó al cliente del calendario'], change_order: ['Change order sent to client', 'Se mandó al cliente un change order'], status: ['Status update sent to client', 'Se avisó al cliente del estado'], note: ['Update sent to client', 'Se mandó una novedad al cliente'] };
  for (const u of db.prepare('SELECT * FROM client_updates WHERE job_id=? AND created_at>=? AND created_at<? ORDER BY id').all(jobId, a, b)) {
    const [en, es] = UPD[u.kind] || UPD.note; const x = T(u.note);
    L(hm(u.created_at), '📣', 'client', `${en}${x.en ? `: ${x.en}` : ''}`, `${es}${x.es ? `: ${x.es}` : ''}`);
  }
  // Plan del día de la gente en esta obra
  for (const p of db.prepare("SELECT * FROM plan_items WHERE job_id=? AND date=? AND status IN ('hecho','no') ORDER BY position, id").all(jobId, day)) {
    const x = T(p.text), who = firstName(db, p.user_id), r = T(p.reason);
    if (p.status === 'hecho') L(hm(p.done_at), '☑', 'plan', `Plan done: ${x.en} — ${who}`, `Plan hecho: ${x.es} — ${who}`);
    else L(hm(p.done_at), '⚠', 'plan', `Plan not done: ${x.en} — ${who}${r.en ? ` (${r.en})` : ''}`, `Plan no se pudo: ${x.es} — ${who}${r.es ? ` (${r.es})` : ''}`);
  }
  // Reporte del día (lo escribe el PM o un dueño)
  const logs = db.prepare('SELECT * FROM daily_logs WHERE job_id=? AND date=? ORDER BY id').all(jobId, day);
  const notes = [];
  let weather = '', crew = '';
  for (const l of logs) {
    const by = firstName(db, l.created_by), t = hm(l.created_at);
    if (l.weather) weather = l.weather;
    if (l.crew) crew = l.crew;
    if (l.client_notes) notes.push({ kind: 'report', t, by, orig: l.client_notes, ...T(l.client_notes) });
    if (l.internal_notes) notes.push({ kind: 'internal', t, by, orig: l.internal_notes, ...T(l.internal_notes) });
  }
  const logPhotos = logs.length ? db.prepare(`SELECT id, mime FROM files WHERE log_id IN (${logs.map(() => '?').join(',')})`).all(...logs.map(l => l.id)) : [];
  const seen = new Set(); const allPhotos = [...logPhotos, ...photos].filter(p => !seen.has(p.id) && seen.add(p.id));
  // Orden: primero lo que tiene hora, en orden; luego lo del día sin hora.
  lines.sort((x, y) => (x.t ? 0 : 1) - (y.t ? 0 : 1) || x.t.localeCompare(y.t));
  return { lines, notes, weather: both(db, weather), crew, photos: allPhotos.map(p => p.id), jpegs: allPhotos.filter(p => p.mime === 'image/jpeg').map(p => p.id), report: logs.length > 0 };
}
// Textos que hay que traducir para guardar el día en inglés.
function textsOf(db, jobId, day) {
  const [a, b] = utcRange(day, TZ());
  const q = (sql, ...p) => db.prepare(sql).all(...p).flatMap(r => Object.values(r));
  return [
    ...db.prepare('SELECT data FROM job_events WHERE job_id=? AND at>=? AND at<?').all(jobId, a, b).map(e => (JSON.parse(e.data || '{}').title || '')),
    ...q("SELECT title FROM tasks WHERE job_id=? AND done_date=?", jobId, day),
    ...q("SELECT name, fail_reason FROM permits WHERE job_id=? AND kind='inspeccion' AND (date=? OR result_at=?)", jobId, day, day),
    ...q('SELECT description FROM change_orders WHERE job_id=? AND (date=? OR substr(approved_at,1,10)=? OR substr(done_at,1,10)=?)', jobId, day, day, day),
    ...q('SELECT title FROM issues WHERE job_id=? AND ((created_at>=? AND created_at<?) OR (resolved_at>=? AND resolved_at<?))', jobId, a, b, a, b),
    ...q('SELECT n.note, t.title FROM notices n JOIN tasks t ON t.id=n.task_id WHERE n.job_id=? AND n.created_at>=? AND n.created_at<?', jobId, a, b),
    ...q('SELECT note FROM client_updates WHERE job_id=? AND created_at>=? AND created_at<?', jobId, a, b),
    ...q("SELECT text, reason FROM plan_items WHERE job_id=? AND date=? AND status IN ('hecho','no')", jobId, day),
    ...q('SELECT client_notes, internal_notes, weather FROM daily_logs WHERE job_id=? AND date=?', jobId, day),
  ].filter(s => s && !pairs().en.has(s) && !pairs().es.has(s));
}
const hasContent = c => c.lines.length || c.notes.length || c.photos.length;

// ===== Cerrar (congelar) un día =====
function freeze(db, jobId, day, userId) {
  if (db.prepare('SELECT 1 FROM job_days WHERE job_id=? AND date=?').get(jobId, day)) return false;
  const c = compile(db, jobId, day);
  const { jpegs, ...data } = c; data.jpegs = jpegs;
  db.prepare('INSERT INTO job_days(job_id,date,closed_by,auto,data,hash) VALUES(?,?,?,?,?,?)')
    .run(jobId, day, userId || null, userId ? 0 : 1, JSON.stringify(data), crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'));
  return true;
}
async function close(db, jobId, day, userId) {
  if (db.prepare('SELECT 1 FROM job_days WHERE job_id=? AND date=?').get(jobId, day)) return false;
  try { await tr.ensure(db, textsOf(db, jobId, day), 10000); } catch { /* sin traducción se guarda el original */ }
  return freeze(db, jobId, day, userId);
}

// Un día como lo ve alguien: congelado (si ya se cerró) o en vivo.
function dayView(db, jobId, day) {
  const row = db.prepare('SELECT * FROM job_days WHERE job_id=? AND date=?').get(jobId, day);
  const late = db.prepare('SELECT * FROM job_day_notes WHERE job_id=? AND date=? ORDER BY id').all(jobId, day).map(n => ({ id: n.id, at: n.at, t: hm(n.at), d: todayL(new Date(n.at.replace(' ', 'T') + 'Z')), by: firstName(db, n.user_id), orig: n.text, en: n.text_en || inLang(db, n.text, 'en'), es: n.text_es || inLang(db, n.text, 'es') }));
  if (row) {
    const d = JSON.parse(row.data);
    return { ...d, date: day, closed: true, closed_at: row.closed_at, closed_t: hm(row.closed_at), closed_by: firstName(db, row.closed_by), auto: !!row.auto, late };
  }
  const c = compile(db, jobId, day); delete c.jpegs;
  return { ...c, date: day, closed: false, late };
}

// ¿Esta obra trabajó (o tenía trabajo) hoy?
function workedToday(db, job, day, c) {
  if (c && hasContent(c)) return true;
  if (new Date(day + 'T12:00:00Z').getUTCDay() === 0) return false;
  return !!db.prepare("SELECT 1 FROM tasks WHERE job_id=? AND status<>'hecho' AND (status='en_progreso' OR (planned_date<>'' AND planned_date<=? AND (CASE WHEN COALESCE(planned_end,'')<>'' THEN planned_end ELSE planned_date END)>=?)) LIMIT 1").get(job.id, day, day);
}
const ownersOf = db => db.prepare("SELECT id FROM users WHERE role='owner' AND active=1 AND is_agent=0").all().map(r => r.id);
function inCharge(db, job) {
  const pm = job.pm_id && db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(job.pm_id);
  // Encargados de cuadrilla de esa obra (permiso "cuadrilla") también reciben el aviso.
  const crew = db.prepare("SELECT id, tools FROM users WHERE role='worker' AND active=1 AND id IN (SELECT user_id FROM subs WHERE job_id=? AND user_id IS NOT NULL UNION SELECT assignee_id FROM tasks WHERE job_id=? AND assignee_id IS NOT NULL)").all(job.id, job.id)
    .filter(u => String(u.tools || '').split(',').includes('cuadrilla')).map(u => u.id);
  return [...new Set([...(pm ? [pm.id] : ownersOf(db)), ...crew])];
}
// Obras de hoy y si ya tienen reporte (para el aviso y para Inicio).
function todayStatus(db, day = todayL(), jobFilter = null) {
  return db.prepare("SELECT id, client_name, address, pm_id FROM jobs WHERE status='activo' ORDER BY id").all()
    .filter(j => !jobFilter || jobFilter(j))
    .map(j => { const c = compile(db, j.id, day); return { job: j, c, worked: workedToday(db, j, day, c) }; })
    .filter(x => x.worked)
    .map(x => ({ id: x.job.id, code: require('./scan').jobCode(x.job.id), name: x.job.client_name, report: x.c.report, lines: x.c.lines.length, photos: x.c.photos.length, to: inCharge(db, x.job), closed: !!db.prepare('SELECT 1 FROM job_days WHERE job_id=? AND date=?').get(x.job.id, day) }));
}

// ===== Reloj: aviso de las 6:30 PM y cierre de las 10 PM =====
function tick(db, now = new Date()) {
  const day = todayL(now), m = minutesL(now);
  const { notify } = require('./push');
  let n = 0;
  if (m >= ALERT_AT && meta(db, 'hist_alert_' + day) !== '1') {
    setMeta(db, 'hist_alert_' + day, '1');
    const missing = todayStatus(db, day).filter(x => !x.report);
    const per = new Map();
    for (const x of missing) for (const u of x.to) { if (!per.has(u)) per.set(u, []); per.get(u).push(x); }
    for (const [u, list] of per) {
      notify(db, u, 'hist_missing', { n: list.length, x: list.map(x => x.name).join(', ') }, list.length === 1 ? `#/obra/${list[0].id}/historial` : '#/');
      n++;
    }
  }
  // Cierre: a las 10 PM el de hoy; si el servidor estuvo apagado, también los días que quedaron abiertos (últimos 7).
  const upTo = m >= CLOSE_AT ? day : addDays(day, -1);
  if (meta(db, 'hist_closed_upto') !== upTo) {
    const from = addDays(upTo, -6);
    for (const j of db.prepare("SELECT id FROM jobs WHERE status IN ('activo','terminado')").all()) {
      for (let d = from; d <= upTo; d = addDays(d, 1)) {
        if (db.prepare('SELECT 1 FROM job_days WHERE job_id=? AND date=?').get(j.id, d)) continue;
        const c = compile(db, j.id, d);
        if (!hasContent(c)) continue;
        close(db, j.id, d, null).catch(e => console.error('[historial]', e.message));
        n++;
      }
    }
    setMeta(db, 'hist_closed_upto', upTo);
  }
  return n;
}

// ===== PDF =====
function pdf(db, job, days, lang, co) {
  const { PDF, wrap } = require('./pdf');
  const fs = require('node:fs'), path = require('node:path');
  const L = lang === 'en';
  const doc = new PDF();
  const M = 48, R = 612 - 48, H = 792;
  const NAVY = '#02175D', MUTED = '#666660';
  let y = 40;
  const code = require('./scan').jobCode(job.id);
  const head = () => {
    doc.text(M, y, co.name || '', { size: 15, bold: true, color: '#181818' });
    doc.text(R, y, L ? 'DAILY LOG' : 'HISTORIAL DIARIO', { size: 15, bold: true, color: NAVY, align: 'right' });
    y += 20;
    doc.text(M, y, `${code} · ${job.client_name}${job.address ? ' · ' + job.address : ''}`, { size: 9.5, color: MUTED });
    y += 16; doc.line(M, y, R, y, { width: 1.1, color: '#181818' }); y += 12;
  };
  const room = need => { if (y + need > H - 56) { doc.addPage(); y = 40; head(); } };
  head();
  if (!days.length) { doc.text(M, y, L ? 'No activity recorded in this period.' : 'No hay nada registrado en estas fechas.', { size: 10, color: MUTED }); }
  for (const d of days) {
    room(60);
    doc.rect(M, y - 4, R - M, 20, { fill: '#EEF0E4' });
    doc.text(M + 6, y, fd(d.date, lang), { size: 11, bold: true, color: NAVY });
    const st = d.closed ? (L ? `Closed ${d.auto ? 'automatically' : 'by ' + d.closed_by} ${d.closed_t || ''}` : `Cerrado ${d.auto ? 'solo' : 'por ' + d.closed_by} ${d.closed_t || ''}`) : (L ? 'Open (not closed yet)' : 'Abierto (sin cerrar)');
    doc.text(R - 6, y + 1, st, { size: 8, color: MUTED, align: 'right' });
    y += 24;
    const meta2 = [d.weather && (d.weather[lang] || d.weather.en) ? `${L ? 'Weather' : 'Clima'}: ${d.weather[lang] || d.weather.en}` : '', d.crew ? `${L ? 'Crew' : 'Cuadrilla'}: ${d.crew}` : ''].filter(Boolean).join('   ·   ');
    if (meta2) { room(14); doc.text(M, y, meta2, { size: 9, color: MUTED }); y += 15; }
    for (const ln of d.lines) {
      const txt = ln[lang] || ln.en; const ws = wrap(txt, 9.5, R - M - 52);
      room(ws.length * 12.5 + 3);
      doc.text(M, y, ln.t || '', { size: 8.5, color: MUTED });
      ws.forEach((w, i) => doc.text(M + 44, y + i * 12.5, (i ? '' : '• ') + w, { size: 9.5 }));
      y += ws.length * 12.5 + 3;
    }
    if (!d.lines.length && !d.notes.length) { room(14); doc.text(M + 44, y, L ? 'No activity recorded.' : 'Sin actividad registrada.', { size: 9.5, color: MUTED }); y += 14; }
    for (const nt of d.notes) {
      const label = nt.kind === 'internal' ? (L ? 'Internal note' : 'Nota interna') : (L ? 'Daily report' : 'Reporte del día');
      const txt = nt[lang] || nt.en; const ws = wrap(txt, 9.5, R - M - 52);
      room(ws.length * 12.5 + 18); y += 4;
      doc.text(M + 44, y, `${label} — ${nt.by}${nt.t ? ' ' + nt.t : ''}`, { size: 8.5, bold: true, color: NAVY }); y += 12;
      ws.forEach(w => { doc.text(M + 44, y, w, { size: 9.5 }); y += 12.5; });
      if (L && nt.orig && nt.orig !== nt.en) { const os = wrap(`Original: ${nt.orig}`, 8, R - M - 52); room(os.length * 10); os.forEach(w => { doc.text(M + 44, y, w, { size: 8, color: MUTED }); y += 10; }); }
    }
    for (const nt of d.late || []) {
      const ws = wrap(nt[lang] || nt.en, 9.5, R - M - 52);
      room(ws.length * 12.5 + 18); y += 4;
      doc.text(M + 44, y, `${L ? 'Late entry' : 'Nota tardía'} — ${nt.by} · ${nt.at ? fd(todayL(new Date(nt.at.replace(' ', 'T') + 'Z')), lang) + ' ' + nt.t : ''}`, { size: 8.5, bold: true, color: '#8A4B00' }); y += 12;
      ws.forEach(w => { doc.text(M + 44, y, w, { size: 9.5 }); y += 12.5; });
    }
    // Fotos del día (hasta 6, en fila de 3)
    const ph = (d.jpegs || []).slice(0, 6);
    if (ph.length) {
      const w = (R - M - 44 - 16) / 3; let x = M + 44, rowH = 0;
      room(w * 0.8 + 10);
      ph.forEach((id, i) => {
        let buf; try { buf = fs.readFileSync(path.join(db.dataDir, 'files', `${id}.jpg`)); } catch { return; }
        if (i && i % 3 === 0) { y += rowH + 8; rowH = 0; x = M + 44; room(w * 0.8 + 10); }
        const h = doc.image(buf, x, y, w); rowH = Math.max(rowH, Math.min(h, w * 1.4)); x += w + 8;
      });
      y += rowH + 8;
      if ((d.jpegs || []).length > 6) { doc.text(M + 44, y, L ? `+${d.jpegs.length - 6} more photos in the app` : `+${d.jpegs.length - 6} fotos más en la app`, { size: 8, color: MUTED }); y += 12; }
    }
    y += 10;
  }
  doc.pages.forEach(p => p.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg 48 24 Td (${L ? 'Company record. No money amounts.' : 'Registro de la compañía. Sin montos de dinero.'}) Tj ET`));
  return doc.toBuffer();
}

// ===== Rutas =====
function routes(db, add, h) {
  const { requireRole, fail, str, date, intId, jobOr404 } = h;
  const pickDate = v => (!v || v === 'hoy') ? todayL() : date(v, 'fecha');
  const job = (user, id) => {
    requireRole(user, 'owner');
    return jobOr404(db, user, intId(id));
  };
  // Días con algo registrado (para moverse entre días).
  const daysOf = (jobId) => {
    const set = new Set(db.prepare('SELECT date FROM job_days WHERE job_id=?').all(jobId).map(r => r.date));
    db.prepare('SELECT DISTINCT date FROM daily_logs WHERE job_id=?').all(jobId).forEach(r => set.add(r.date));
    set.add(todayL());
    return [...set].sort().reverse().slice(0, 120);
  };

  add('GET', '/api/jobs/:id/history', ({ user, params, query }) => {
    const j = job(user, params.id);
    const day = pickDate(query.get('d'));
    if (day > todayL()) fail(400, 'Ese día todavía no llega');
    const v = dayView(db, j.id, day);
    return { ...v, today: todayL(), days: daysOf(j.id), code: require('./scan').jobCode(j.id), can_close: !v.closed && day <= todayL() };
  });
  add('POST', '/api/jobs/:id/history/close', async ({ user, params, body }) => {
    const j = job(user, params.id);
    const day = pickDate(body.date);
    if (day > todayL()) fail(400, 'Ese día todavía no llega');
    if (db.prepare('SELECT 1 FROM job_days WHERE job_id=? AND date=?').get(j.id, day)) fail(409, 'Ese día ya está cerrado; agregue una nota tardía');
    await close(db, j.id, day, user.pmId || user.id);
    return { ok: true };
  });
  add('POST', '/api/jobs/:id/history/notes', async ({ user, params, body }) => {
    const j = job(user, params.id);
    const day = pickDate(body.date);
    const text = str(body.text, 2000).trim(); if (text.length < 3) fail(400, 'Escriba la nota');
    if (!db.prepare('SELECT 1 FROM job_days WHERE job_id=? AND date=?').get(j.id, day)) fail(409, 'El día sigue abierto: use el reporte del día');
    try { await tr.ensure(db, [text], 8000); } catch { /* */ }
    const id = db.prepare('INSERT INTO job_day_notes(job_id,date,user_id,text,text_en,text_es) VALUES(?,?,?,?,?,?)').run(j.id, day, user.pmId || user.id, text, inLang(db, text, 'en'), inLang(db, text, 'es')).lastInsertRowid;
    return { id: Number(id) };
  });
  add('GET', '/api/jobs/:id/history/pdf', ({ user, params, query }) => {
    const j = job(user, params.id);
    const to = pickDate(query.get('to') || query.get('d'));
    let from = query.get('from') ? date(query.get('from'), 'fecha') : (query.get('d') ? to : null);
    if (!from) from = db.prepare('SELECT MIN(date) d FROM (SELECT date FROM job_days WHERE job_id=? UNION SELECT date FROM daily_logs WHERE job_id=?)').get(j.id, j.id).d || to;
    if (from > to) fail(400, 'La fecha de inicio no puede ser después del final');
    let n = 0; const days = [];
    for (let d = from; d <= to && n < 400; d = addDays(d, 1), n++) {
      const row = db.prepare('SELECT 1 FROM job_days WHERE job_id=? AND date=?').get(j.id, d);
      const v = row ? dayView(db, j.id, d) : (() => { const c = compile(db, j.id, d); return hasContent(c) ? { ...c, date: d, closed: false, late: [] } : null; })();
      if (v && (row || hasContent(v))) days.push(v);
    }
    const lang = query.get('lang') === 'es' ? 'es' : 'en';
    const co = require('./company').info(db);
    const name = `Daily-Log-${require('./scan').jobCode(j.id)}-${from === to ? from : from + '_' + to}.pdf`;
    return { $buffer: pdf(db, j, days, lang, co), $type: 'application/pdf', $name: name };
  });
  // Obras de hoy: cuáles ya tienen reporte del día (para Inicio de dueños y PM).
  add('GET', '/api/history/today', ({ user }) => {
    requireRole(user, 'owner');
    const pmId = user.isPm ? user.pmId : null;
    const all = pmId && (db.prepare('SELECT pm_all FROM users WHERE id=?').get(pmId) || {}).pm_all;
    const list = todayStatus(db, todayL(), j => !pmId || all || j.pm_id === pmId).map(({ to, ...x }) => x);
    return { date: todayL(), after: minutesL() >= ALERT_AT, jobs: list };
  });
}

module.exports = { routes, tick, event, taskChange, compile, close, freeze, dayView, todayStatus, inLang, ALERT_AT };
