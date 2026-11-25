'use strict';
// Plantillas de tareas por tipo de obra (editables por cada compañía) y SCHEDULE a una obra que ya existe.
//  - La app YA NO mete tareas solas al crear una obra. Se escoge: la plantilla de la compañía, la sugerida de la app,
//    o en blanco (para agregarlas a mano o importar el SCHEDULE).
//  - Cada tipo de obra puede tener una plantilla "por defecto": es la que sale escogida al crear la obra.
//  - Quitar tareas: solo las que no tienen historia (pendientes, sin fotos, sin avisos, sin cobro ligado, sin horas).
//    Lo que ya tiene algo se queda y se dice por qué.
const C = require('./catalog');
const I = require('./importer');
const { tx } = require('./db');
const { schedule } = require('./plan');
const TR = require('./trades');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
// Títulos de las listas que la app ponía sola (en español e inglés).
const BUILTIN = new Set([...C.LEGACY_TASKS, ...C.PROJECT_TYPES.flatMap(p => p.tasks)].flatMap(([es, en]) => [norm(es), norm(en)]));

function cleanTasks(list, fail) {
  const tasks = (Array.isArray(list) ? list : []).slice(0, 80).map(t => ({
    title: String((t && t.title) || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    days: Math.max(1, Math.min(60, Math.round(Number(t && t.days) || 1))),
    trade: TR.tradeKey((t && t.trade) || '') || TR.guessTrade(t && t.title),
    inspection: !!(t && t.inspection),
    notes: String((t && t.notes) || '').trim().slice(0, 300),
  })).filter(t => t.title);
  if (!tasks.length) fail(400, 'La plantilla no tiene tareas');
  return tasks;
}
const suggested = lang => C.PROJECT_TYPES.map(p => ({ project_type: p.key, name: p[lang === 'en' ? 'en' : 'es'],
  tasks: p.tasks.map(([es, en, trade, days, insp]) => ({ title: lang === 'en' ? en : es, days: days || 1, trade: trade || '', inspection: !!insp, notes: '' })) }));

// Por qué una tarea no se puede quitar (vacío = sí se puede).
function blockers(db, t) {
  const why = [];
  if (t.status !== 'pendiente') why.push(t.status === 'hecho' ? 'ya está hecha' : 'está en progreso');
  if (db.prepare("SELECT 1 FROM files WHERE task_id=? LIMIT 1").get(t.id)) why.push('tiene fotos');
  if (db.prepare('SELECT 1 FROM notices WHERE task_id=? LIMIT 1').get(t.id)) why.push('tiene avisos al sub');
  if (db.prepare('SELECT 1 FROM payment_milestones WHERE task_id=? LIMIT 1').get(t.id)) why.push('tiene un cobro ligado');
  return why;
}

// Pone una lista de tareas en una obra (con fechas si hay fecha de inicio). Las marcadas como inspección
// crean también su renglón en Permisos e inspecciones.
// Quién hace cada trade en la obra: el crew/sub de la obra (con usuario) que tiene ese trade. Si son dos, nadie (se escoge a mano).
function crewFor(db, jobId) {
  const subs = db.prepare('SELECT s.user_id, s.trades, s.trade, u.trades utrades, u.trade utrade FROM subs s JOIN users u ON u.id=s.user_id WHERE s.job_id=? AND u.active=1').all(jobId);
  return trade => {
    if (!trade) return null;
    const who = [...new Set(subs.filter(s => TR.hasTrade(s.trades || s.utrades, trade) || (!s.trades && !s.utrades && TR.guessTrade(s.trade || s.utrade) === trade)).map(s => s.user_id))];
    return who.length === 1 ? who[0] : null;
  };
}
function insertTasks(db, jobId, tasks, start, opts = {}) {
  const dated = start ? schedule(start, tasks, opts) : tasks.map(t => ({ ...t, planned_date: '', planned_end: '' }));
  const crew = crewFor(db, jobId);
  let pos = db.prepare('SELECT COALESCE(MAX(position),0) m FROM tasks WHERE job_id=?').get(jobId).m;
  const ins = db.prepare('INSERT INTO tasks(job_id,position,title,planned_date,planned_end,notes,days,trade,assignee_id,inspection_type) VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const t of dated) {
    pos += 10;
    const trade = t.inspection ? '' : (TR.tradeKey(t.trade) || TR.guessTrade(t.title));
    const itype = t.inspection ? require('./inspections').guessType(t.title) : '';
    const tid = Number(ins.run(jobId, pos, t.title, t.planned_date, t.planned_end, t.notes || '', t.days || null, trade, t.inspection ? null : (t.assignee_id || crew(trade)), itype).lastInsertRowid);
    if (t.inspection) db.prepare("INSERT INTO permits(job_id,kind,name,status,date,notes,task_id,insp_type) VALUES(?,'inspeccion',?,'pendiente',?,'',?,?)").run(jobId, t.title, t.planned_date || '', tid, itype);
  }
  return dated;
}
// Qué tareas pone una obra nueva: body.template = 'blank' | 'base' | <id>. Sin nada: la plantilla por defecto del tipo, o en blanco.
function tasksForNewJob(db, body, type, fail) {
  let key = body.template;
  if (key == null || key === '') key = body.applyTemplate === true ? 'base' : (db.prepare('SELECT id FROM plan_templates WHERE project_type=? AND is_default=1').get(type) || {}).id || 'blank';
  if (key === 'blank') return [];
  if (key === 'base') return suggested('es').find(p => p.project_type === type)?.tasks || [];
  const t = db.prepare('SELECT * FROM plan_templates WHERE id=?').get(Number(key));
  if (!t) fail(400, 'Plantilla no encontrada');
  return JSON.parse(t.tasks);
}

module.exports = { BUILTIN, insertTasks, tasksForNewJob, blockers, crewFor };

module.exports.routes = function templateRoutes(db, add, h) {
  const { requireRole, fail, str, intId, jobOr404, date, today } = h;
  const owner = u => { requireRole(u, 'owner'); if (u.isPm || u.is_agent) fail(403, 'Esto solo lo pueden hacer los dueños'); };
  const types = new Set(C.PROJECT_TYPES.map(p => p.key));
  const log = (u, action, id, summary) => db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)').run(u.pmId || u.id, action, 'tareas', id, summary);
  const out = t => ({ id: t.id, name: t.name, project_type: t.project_type, is_default: !!t.is_default, tasks: JSON.parse(t.tasks), updated_at: t.updated_at || t.created_at });
  const setDefault = (id, type) => { db.prepare('UPDATE plan_templates SET is_default=0 WHERE project_type=? AND id<>?').run(type, id); db.prepare('UPDATE plan_templates SET is_default=1 WHERE id=?').run(id); };

  add('GET', '/api/task-templates', ({ user }) => {
    requireRole(user, 'owner');
    return { saved: db.prepare('SELECT * FROM plan_templates ORDER BY project_type, is_default DESC, name').all().map(out), suggested: suggested(user.lang) };
  });
  add('POST', '/api/task-templates', ({ user, body }) => {
    owner(user);
    const type = types.has(body.project_type) ? body.project_type : 'otro';
    const id = Number(db.prepare("INSERT INTO plan_templates(name,project_type,tasks,created_by,updated_at) VALUES(?,?,?,?,datetime('now'))")
      .run(str(body.name, 120) || 'Plantilla', type, JSON.stringify(cleanTasks(body.tasks, fail)), user.id).lastInsertRowid);
    if (body.is_default) setDefault(id, type);
    log(user, 'crear', id, `Plantilla nueva: ${str(body.name, 120) || 'Plantilla'}`);
    return out(db.prepare('SELECT * FROM plan_templates WHERE id=?').get(id));
  });
  add('PUT', '/api/task-templates/:id', ({ user, params, body }) => {
    owner(user);
    const t = db.prepare('SELECT * FROM plan_templates WHERE id=?').get(intId(params.id)); if (!t) fail(404, 'Plantilla no encontrada');
    const type = 'project_type' in body ? (types.has(body.project_type) ? body.project_type : 'otro') : t.project_type;
    db.prepare("UPDATE plan_templates SET name=?, project_type=?, tasks=?, updated_at=datetime('now') WHERE id=?")
      .run('name' in body ? (str(body.name, 120) || t.name) : t.name, type, 'tasks' in body ? JSON.stringify(cleanTasks(body.tasks, fail)) : t.tasks, t.id);
    if (type !== t.project_type) db.prepare('UPDATE plan_templates SET is_default=0 WHERE id=?').run(t.id);
    if ('is_default' in body) { if (body.is_default) setDefault(t.id, type); else db.prepare('UPDATE plan_templates SET is_default=0 WHERE id=?').run(t.id); }
    log(user, 'editar', t.id, `Plantilla: ${t.name}`);
    return out(db.prepare('SELECT * FROM plan_templates WHERE id=?').get(t.id));
  });
  add('DELETE', '/api/task-templates/:id', ({ user, params }) => {
    owner(user);
    const t = db.prepare('SELECT * FROM plan_templates WHERE id=?').get(intId(params.id)); if (!t) fail(404, 'Plantilla no encontrada');
    db.prepare('DELETE FROM plan_templates WHERE id=?').run(t.id);
    log(user, 'borrar', t.id, `Plantilla: ${t.name}`);
    return { ok: true };
  });

  // Poner una plantilla en una obra que ya existe (se agregan al final, o reemplazan las tareas que se pueden quitar).
  add('POST', '/api/jobs/:id/apply-template', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const tasks = tasksForNewJob(db, { template: body.template === 'blank' ? 'base' : body.template }, job.project_type, fail);
    if (!tasks.length) fail(400, 'La plantilla no tiene tareas');
    return tx(db, () => {
      const removed = body.mode === 'replace' ? removeFree(job.id, user, 'Se cambió por una plantilla') : 0;
      const start = date(body.start_date, 'fecha de inicio') || job.start_date || '';
      insertTasks(db, job.id, tasks, start);
      return { ok: true, created: tasks.length, removed };
    });
  });

  // ----- Quitar tareas que no tienen historia (las 16 que la app ponía sola, por ejemplo) -----
  const removeFree = (jobId, user, why, onlyIds = null) => {
    const rows = db.prepare('SELECT * FROM tasks WHERE job_id=?').all(jobId).filter(t => (!onlyIds || onlyIds.has(t.id)) && !blockers(db, t).length);
    for (const t of rows) db.prepare('DELETE FROM tasks WHERE id=?').run(t.id);
    if (rows.length) log(user, 'borrar', jobId, `${why}: se quitaron ${rows.length} tarea(s)`);
    return rows.length;
  };
  add('GET', '/api/jobs/:id/task-cleanup', ({ user, params }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    return db.prepare('SELECT id, title, status, planned_date FROM tasks WHERE job_id=? ORDER BY position, id').all(job.id)
      .map(t => ({ ...t, auto: BUILTIN.has(norm(t.title)), blocked: blockers(db, t) }));
  });
  add('POST', '/api/jobs/:id/task-cleanup', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const ids = new Set((Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger));
    if (!ids.size) fail(400, 'Escoja las tareas que quiere quitar');
    return tx(db, () => ({ ok: true, removed: removeFree(job.id, user, 'Limpieza de tareas', ids) }));
  });

  // ----- Asignar por trade: un crew puede quedarse con varios trades de un jalón -----
  // map = { techo: 12, carpinteria: 12, electricidad: 15, pintura: null }. No toca tareas hechas.
  add('POST', '/api/jobs/:id/assign-by-trade', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const map = body && typeof body.map === 'object' && body.map ? body.map : fail(400, 'Escoja quién hace cada trade');
    let changed = 0;
    return tx(db, () => {
      for (const [k, v] of Object.entries(map)) {
        const trade = TR.tradeOk(k); if (!trade) fail(400, 'Trade desconocido');
        const uid = v == null || v === '' ? null : Number(v);
        if (uid != null && !db.prepare("SELECT 1 FROM users WHERE id=? AND role='worker' AND active=1").get(uid)) fail(400, 'Sub no válido');
        changed += Number(db.prepare("UPDATE tasks SET assignee_id=? WHERE job_id=? AND trade=? AND status<>'hecho'").run(uid, job.id, trade).changes);
        // Si el crew no estaba en la obra, se agrega (sin monto) para que vea la obra; sus trades se suman.
        if (uid != null) {
          const s = db.prepare('SELECT * FROM subs WHERE job_id=? AND user_id=?').get(job.id, uid);
          const u = db.prepare('SELECT name, trade, trades FROM users WHERE id=?').get(uid);
          if (!s) db.prepare('INSERT INTO subs(job_id,name,trade,agreed_cents,user_id,trades) VALUES(?,?,?,0,?,?)').run(job.id, u.name, u.trade || '', uid, TR.tradeList([...String(u.trades || '').split(','), trade]));
          else if (!TR.hasTrade(s.trades, trade)) db.prepare('UPDATE subs SET trades=? WHERE id=?').run(TR.tradeList([...String(s.trades || u.trades || '').split(','), trade]), s.id);
        }
      }
      log(user, 'editar', job.id, `Asignar por trade: ${changed} tarea(s)`);
      return { ok: true, changed };
    });
  });

  // ----- SCHEDULE (de la hoja de la obra) a una obra que ya existe -----
  const readSchedule = body => {
    let rows;
    if (body.file) {
      const m = /^data:[^;]*;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.file));
      if (!m) fail(400, 'Suba el archivo de Excel (.xlsx)');
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > 15 * 1024 * 1024) fail(413, 'Archivo de Excel demasiado grande');
      if (buf.slice(0, 2).toString() !== 'PK') fail(400, 'No es un archivo de Excel (.xlsx). En Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx)');
      let sheets; try { sheets = I.readSheets(buf); } catch { fail(400, 'No se pudo leer el archivo de Excel'); }
      rows = I.findSheet(sheets, 'SCHEDULE', 'CRONOGRAMA') || (Object.keys(sheets).length === 1 ? Object.values(sheets)[0] : null);
      if (!rows) fail(400, 'El libro no tiene la tab SCHEDULE');
    } else rows = I.rowsFromText(str(body.text, 200000));
    const tasks = I.parseScheduleRows(rows).slice(0, 200);
    if (!tasks.length) fail(400, 'No se encontraron tareas. Copie la tab SCHEDULE con sus encabezados (TASK NAME…) o una tarea por renglón.');
    return tasks;
  };
  const lineFor = (jobId, code) => code ? (db.prepare('SELECT id FROM job_lines WHERE job_id=? AND UPPER(code)=?').get(jobId, code.toUpperCase()) || {}).id || null : null;

  add('POST', '/api/jobs/:id/schedule/preview', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const tasks = readSchedule(body);
    const current = db.prepare('SELECT * FROM tasks WHERE job_id=?').all(job.id);
    const have = new Set(current.map(t => norm(t.title)));
    return { tasks: tasks.map(t => ({ ...t, exists: have.has(norm(t.title)), line: !!lineFor(job.id, t.code) })),
      current: current.length, removable: current.filter(t => !blockers(db, t).length).length };
  });
  add('POST', '/api/jobs/:id/schedule/apply', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const skip = new Set((Array.isArray(body.skip) ? body.skip : []).map(Number));
    const tasks = readSchedule(body).filter((_, i) => !skip.has(i));
    if (!tasks.length) fail(400, 'No hay tareas que importar');
    return tx(db, () => {
      const removed = body.mode === 'replace' ? removeFree(job.id, user, 'Se reemplazó con el SCHEDULE') : 0;
      const have = new Set(db.prepare('SELECT title FROM tasks WHERE job_id=?').all(job.id).map(t => norm(t.title)));
      let pos = db.prepare('SELECT COALESCE(MAX(position),0) m FROM tasks WHERE job_id=?').get(job.id).m, created = 0, skipped = 0;
      const ins = db.prepare('INSERT INTO tasks(job_id,position,title,status,planned_date,planned_end,done_date,notes,line_id,trade,assignee_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
      const crew = crewFor(db, job.id);
      for (const t of tasks) {
        if (have.has(norm(t.title))) { skipped++; continue; }
        pos += 10; created++; have.add(norm(t.title));
        const trade = /inspec/i.test(t.title) ? '' : TR.guessTrade(t.title);
        ins.run(job.id, pos, t.title, t.status, t.planned_date, t.planned_end, t.status === 'hecho' ? (t.done_date || t.planned_end || t.planned_date || today()) : '', t.notes, lineFor(job.id, t.code), trade, crew(trade));
      }
      const dates = tasks.flatMap(t => [t.planned_date, t.planned_end]).filter(Boolean).sort();
      if (dates.length) db.prepare("UPDATE jobs SET start_date=CASE WHEN start_date='' THEN ? ELSE start_date END, end_date=CASE WHEN end_date='' THEN ? ELSE end_date END WHERE id=?").run(dates[0], dates.at(-1), job.id);
      log(user, 'crear', job.id, `SCHEDULE importado: ${created} tarea(s)${removed ? `, ${removed} quitada(s)` : ''}`);
      return { ok: true, created, skipped, removed };
    });
  });
};
