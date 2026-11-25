'use strict';
// Fase 5 — Lista de rough-in antes de cerrar o forrar.
// Antes de cerrar el cielo, forrar o poner drywall, cada cosa que va adentro (contactos, cajas de luz, cables de bocinas y TV,
// línea de gas, plomería) se confirma con una foto. Si falta algo, o si una inspección de rough todavía no pasa,
// la app no deja empezar ni marcar hecha la tarea de cerrar. Un dueño puede dejarla pasar escribiendo el motivo (queda en el historial).
// Si se cierra antes, se rompe y se rehace: por eso el freno.
const { CLOSE, isInspection, TYPES } = require('./inspections');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Lo que normalmente se confirma, según los trades de la obra.
const DEFAULTS = [
  { key: 'plugs', trade: 'electricidad', es: 'Contactos (plugs) y switches en su lugar', en: 'Outlets (plugs) and switches in place' },
  { key: 'luces', trade: 'electricidad', es: 'Cajas de luces, abanicos y conduit', en: 'Light boxes, fans and conduit' },
  { key: 'av', trade: 'av', es: 'Cables de bocinas, TV y bajo voltaje', en: 'Speaker, TV and low-voltage wiring' },
  { key: 'gas', trade: 'gas', es: 'Línea de gas y prueba de presión', en: 'Gas line and pressure test' },
  { key: 'plomeria', trade: 'plomeria', es: 'Plomería rough (agua y drenaje)', en: 'Rough plumbing (water and drain)' },
];
const ROUGH_TYPES = new Set(TYPES.filter(t => t.group === 'rough').map(t => t.key));
const isClose = t => !isInspection(t) && CLOSE.test(norm(t.title)) && !/rough/.test(norm(t.title));

// Crea la lista la primera vez, con lo que aplica a los trades de la obra.
function ensure(db, jobId) {
  if (db.prepare('SELECT 1 FROM roughin_items WHERE job_id=?').get(jobId)) return;
  const trades = new Set(db.prepare("SELECT DISTINCT trade FROM tasks WHERE job_id=? AND trade<>''").all(jobId).map(r => r.trade));
  if (!db.prepare('SELECT 1 FROM tasks WHERE job_id=?').all(jobId).length) return;
  if (!db.prepare('SELECT id, title, inspection_type FROM tasks WHERE job_id=?').all(jobId).some(isClose)) return;
  const items = DEFAULTS.filter(d => trades.has(d.trade));
  items.forEach((d, i) => db.prepare('INSERT INTO roughin_items(job_id,key,label,trade,position) VALUES(?,?,?,?,?)').run(jobId, d.key, '', d.trade, (i + 1) * 10));
}
const labelOf = (it, lang) => { const d = DEFAULTS.find(x => x.key === it.key); return it.label || (d ? d[lang === 'en' ? 'en' : 'es'] : it.key); };

// ¿Qué frena cerrar esta tarea? Lo que falta de la lista y las inspecciones de rough que van antes y no han pasado.
function blockers(db, task) {
  if (!isClose(task)) return null;
  ensure(db, task.job_id);
  const items = db.prepare("SELECT * FROM roughin_items WHERE job_id=? AND status='pendiente' ORDER BY position, id").all(task.job_id);
  const insp = db.prepare("SELECT id, title, inspection_type FROM tasks WHERE job_id=? AND status<>'hecho' AND (position<? OR (position=? AND id<?)) AND inspection_type<>'' ORDER BY position")
    .all(task.job_id, task.position, task.position, task.id).filter(t => ROUGH_TYPES.has(t.inspection_type) || /rough/i.test(t.title));
  if (!items.length && !insp.length) return null;
  return { items: items.map(i => ({ id: i.id, key: i.key, label: i.label })), inspections: insp.map(t => ({ id: t.id, title: t.title })) };
}
const blockText = (b, lang = 'es') => [...b.items.map(i => labelOf(i, lang)), ...b.inspections.map(t => (lang === 'en' ? 'inspection: ' : 'inspección: ') + t.title.replace(/^(inspecci[oó]n|inspection)\s*:\s*/i, ''))].join(', ');

function routes(db, add, h) {
  const { requireRole, fail, str, intId, jobOr404, canSeeJob, saveImage } = h;
  const who = u => u.pmId || u.id;
  const itemOr404 = (user, id) => { const it = db.prepare('SELECT * FROM roughin_items WHERE id=?').get(intId(id)); if (!it || !canSeeJob(db, user, it.job_id)) fail(404, 'No encontrado'); return it; };
  const out = (it, lang) => ({ id: it.id, key: it.key, label: labelOf(it, lang), custom: !!it.label, trade: it.trade, status: it.status, photo_id: it.photo_id, note: it.note,
    confirmed_at: it.confirmed_at, by: it.confirmed_by ? ((db.prepare('SELECT name FROM users WHERE id=?').get(it.confirmed_by) || {}).name || '') : '' });
  // El sub confirma lo de su trade (o lo que tenga asignado en la obra); dueños y PM todo.
  const subCan = (user, it) => user.role !== 'worker' || !it.trade || (db.prepare('SELECT trades FROM users WHERE id=?').get(user.id) || {}).trades?.split(',').includes(it.trade)
    || !!db.prepare('SELECT 1 FROM tasks WHERE job_id=? AND assignee_id=? AND trade=?').get(it.job_id, user.id, it.trade);

  add('GET', '/api/jobs/:id/roughin', ({ user, params }) => {
    requireRole(user, 'owner', 'pm', 'worker');
    const job = jobOr404(db, user, intId(params.id));
    ensure(db, job.id);
    const items = db.prepare('SELECT * FROM roughin_items WHERE job_id=? ORDER BY position, id').all(job.id).map(i => out(i, user.lang));
    const close = db.prepare('SELECT * FROM tasks WHERE job_id=? ORDER BY position, id').all(job.id).filter(isClose)
      .map(t => ({ id: t.id, title: t.title, status: t.status, blocked: !!blockers(db, t) }));
    return { items, close_tasks: close, done: items.filter(i => i.status !== 'pendiente').length, total: items.length };
  });
  add('POST', '/api/jobs/:id/roughin', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    ensure(db, job.id);
    const label = str(body.label, 140).trim(); if (label.length < 2) fail(400, 'Escriba qué hay que confirmar');
    const pos = (db.prepare('SELECT MAX(position) m FROM roughin_items WHERE job_id=?').get(job.id).m || 0) + 10;
    const id = Number(db.prepare("INSERT INTO roughin_items(job_id,key,label,trade,position) VALUES(?,'custom',?,?,?)").run(job.id, label, str(body.trade, 30), pos).lastInsertRowid);
    return out(db.prepare('SELECT * FROM roughin_items WHERE id=?').get(id), user.lang);
  });
  // Confirmar con foto (obligatoria).
  add('POST', '/api/roughin/:id/confirm', ({ user, params, body }) => {
    requireRole(user, 'owner', 'pm', 'worker');
    const it = itemOr404(user, params.id);
    if (!subCan(user, it)) fail(403, 'Esto lo confirma quien hace ese trade');
    if (!body.photo) fail(400, 'Tome o escoja la foto de cómo quedó: sin foto no se confirma');
    const f = saveImage(db, user, { dataUrl: body.photo, jobId: it.job_id, kind: 'photo', caption: `Rough-in: ${labelOf(it, 'en')}` });
    db.prepare("UPDATE files SET trade=? WHERE id=?").run(it.trade || '', f.id);
    db.prepare("UPDATE roughin_items SET status='ok', photo_id=?, note=?, confirmed_by=?, confirmed_at=datetime('now') WHERE id=?").run(f.id, str(body.note, 300), who(user), it.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,'editar','rough-in',?,?,?)").run(who(user), it.id, it.job_id, `Rough-in confirmado con foto: ${labelOf(it, 'es')}`);
    return out(db.prepare('SELECT * FROM roughin_items WHERE id=?').get(it.id), user.lang);
  });
  // No aplica en esta obra (dueño o PM), con motivo.
  add('POST', '/api/roughin/:id/na', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const it = itemOr404(user, params.id);
    const why = str(body.reason, 200).trim(); if (why.length < 3) fail(400, 'Escriba por qué no aplica');
    db.prepare("UPDATE roughin_items SET status='na', note=?, confirmed_by=?, confirmed_at=datetime('now') WHERE id=?").run(why, who(user), it.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,'editar','rough-in',?,?,?)").run(who(user), it.id, it.job_id, `Rough-in no aplica: ${labelOf(it, 'es')} — ${why}`);
    return out(db.prepare('SELECT * FROM roughin_items WHERE id=?').get(it.id), user.lang);
  });
  add('POST', '/api/roughin/:id/reset', ({ user, params }) => {
    requireRole(user, 'owner');
    const it = itemOr404(user, params.id);
    db.prepare("UPDATE roughin_items SET status='pendiente', confirmed_by=NULL, confirmed_at='' WHERE id=?").run(it.id);
    return out(db.prepare('SELECT * FROM roughin_items WHERE id=?').get(it.id), user.lang);
  });
  add('DELETE', '/api/roughin/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const it = itemOr404(user, params.id);
    db.prepare('DELETE FROM roughin_items WHERE id=?').run(it.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,'borrar','rough-in',?,?,?)").run(who(user), it.id, it.job_id, `Rough-in quitado de la lista: ${labelOf(it, 'es')}`);
    return { ok: true };
  });
}
module.exports = { routes, blockers, blockText, isClose, ensure, DEFAULTS, labelOf };
