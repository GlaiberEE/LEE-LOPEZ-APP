'use strict';
// Inspecciones que pide la ciudad. Cuando aprueban los planos, la ciudad dice qué inspecciones va a haber;
// la app las pregunta y las mete en el schedule de la obra, cada una entre los trades donde va
// (por ejemplo, "Pilares" después de excavar y antes de colar; "Rough eléctrico" antes de forrar el cielo).
const { tx } = require('./db');
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Tipos comunes en DFW. after/before: qué tareas (por trade o por nombre) van antes y después de la inspección.
// group: para ordenarlas en la pantalla.
const T = (key, group, es, en, after, before, re) => ({ key, group, es, en, after, before, re });
const has = (trades, rx) => t => (trades && trades.includes(t.trade)) || (rx && rx.test(norm(t.title)));
const CLOSE = /cielo|ceiling|forr|wrap|drywall|aislamiento|insulat|cement board|t&g|tongue|cerrar|close/;
const POUR = /colar|pour|concreto|concrete|losa|slab/;
const TYPES = [
  T('pilares', 'cimientos', 'Pilares / zapatas (antes de colar)', 'Piers / footings (pre-pour)', has(['excavacion'], /excav|pilar|pier|zapata|footing|varilla|rebar/), has(['concreto'], POUR), /pilar|pier|zapata|footing/),
  T('forms', 'cimientos', 'Forms / cimbra', 'Forms', has(['excavacion'], /cimbra|forms?\b|excav/), has(['concreto'], POUR), /\bforms?\b|cimbra/),
  T('subterranea', 'cimientos', 'Plomería o eléctrico bajo tierra', 'Underground plumbing / electrical', has(['excavacion', 'plomeria', 'electricidad'], /zanja|trench|underground|bajo tierra/), has(['concreto'], POUR), /underground|bajo tierra|subterr/),
  T('losa', 'cimientos', 'Losa (antes de colar)', 'Slab (pre-pour)', has(['excavacion'], /cimbra|forms?\b|varilla|rebar|base/), has(['concreto'], /losa|slab|pour|colar/), /\blosa\b|\bslab\b/),
  T('framing', 'rough', 'Framing / estructura', 'Framing', has(['carpinteria'], /poste|post|viga|beam|rafter|framing|estructura|deck/), has(null, CLOSE), /framing|estructura/),
  T('rough_electrico', 'rough', 'Rough eléctrico', 'Rough electrical', has(['electricidad', 'av'], /rough/), has(null, CLOSE), /rough.*(electr|elec)|electr.*rough/),
  T('rough_plomeria', 'rough', 'Rough de plomería', 'Rough plumbing', has(['plomeria'], /rough/), has(null, CLOSE), /rough.*plom|plumb.*rough|rough plumb/),
  T('rough_gas', 'rough', 'Gas rough + prueba de presión', 'Rough gas + pressure test', has(['gas'], /gas/), has(null, /piedra|stone|cerrar|close|forr|veneer|cubierta|counter/), /gas/),
  T('mecanica', 'rough', 'Mecánica (HVAC / ventilación)', 'Mechanical (HVAC / vent)', has(null, /hvac|ducto|duct|campana|hood|ventila/), has(null, CLOSE), /mecan|mechan|hvac/),
  T('mamposteria', 'rough', 'Chimenea / mampostería', 'Fireplace / masonry', has(['piedra'], /caja de fuego|firebox|chimenea|chimney|block|base/), has(null, /piedra exterior|stone veneer|veneer|tapa|cap/), /chimenea|fireplace|mampost|mason/),
  T('aislamiento', 'rough', 'Aislamiento (energía)', 'Insulation (energy)', has(null, /aislamiento|insulat/), has(null, /drywall|tablaroca/), /aislamiento|insulat/),
  T('final_electrico', 'final', 'Final eléctrico', 'Final electrical', has(['electricidad', 'av'], /termin|finish/), has(['limpieza'], /punch|walk|limpi|clean/), /final.*electr/),
  T('final_plomeria', 'final', 'Final de plomería', 'Final plumbing', has(['plomeria'], /termin|finish/), has(['limpieza'], /punch|walk|limpi|clean/), /final.*plom|final.*plumb/),
  T('final_gas', 'final', 'Final de gas / liberación del medidor', 'Final gas / meter release', has(['gas', 'equipos'], /termin|finish|quemador|burner|equipos|appliance/), has(['limpieza'], /punch|walk|limpi|clean/), /final.*gas|medidor|meter/),
  T('energia', 'final', 'Compañía de luz (Oncor / energía)', 'Utility (Oncor / energy)', has(['electricidad'], /termin|finish/), has(['limpieza'], /walk|fotos finales|final photos/), /oncor|green energy|energia|utility|compania de luz/),
  T('final', 'final', 'Final de la ciudad (construcción)', 'Final building inspection', has(['limpieza', 'pintura', 'electricidad'], /punch|limpi|clean|termin|finish|stain|pint/), has(null, /walk.?through|fotos finales|final photos/), /final/),
];
const BY = Object.fromEntries(TYPES.map(x => [x.key, x]));
const GROUPS = ['cimientos', 'rough', 'final', 'otra'];
const NEVER = () => false;
const BEFORE = { cimientos: has(['concreto'], POUR), rough: has(null, new RegExp(CLOSE.source + '|piedra|stone|veneer|cubierta|counter')), final: has(['limpieza'], /punch|walk|limpi|clean/), otra: NEVER };
// Si la obra no tiene su trade, va donde van las de la app de su misma etapa.
const any = keys => t => keys.some(k => BY[k].after(t));
const AFTER2 = { cimientos: any(['pilares', 'forms', 'losa']), rough: any(['framing', 'rough_electrico', 'rough_plomeria', 'rough_gas']), final: BY.final.after };
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Las que agregó la compañía: van después de su trade (si lo dijeron) y antes de lo que frena su etapa.
const customType = r => ({ key: 'c' + r.id, id: r.id, custom: true, group: r.group_key, es: r.name_es, en: r.name_en || r.name_es, after_trade: r.after_trade, created_by: r.created_by,
  after: r.after_trade ? has([r.after_trade]) : NEVER, after2: AFTER2[r.group_key], before: BEFORE[r.group_key] || NEVER,
  re: new RegExp([r.name_es, r.name_en].filter(Boolean).map(n => esc(norm(n).replace(/^(inspeccion|inspection)\s*:?\s*/, '').trim())).filter(Boolean).join('|') || '$^') });
// Lista completa de esta compañía: las de la app y las suyas activas.
const typesFor = db => [...TYPES, ...db.prepare('SELECT * FROM inspection_types WHERE active=1 ORDER BY id').all().map(customType)];
// Qué tipo es una inspección por su nombre (las de plantilla o las escritas a mano).
function guessType(title, list = TYPES) {
  const s = norm(title);
  for (const x of list) if (x.custom && x.re.test(s)) return x.key;
  for (const x of list) if (!x.custom && x.key !== 'final' && x.re.test(s)) return x.key;
  return /final/.test(s) ? 'final' : 'otra';
}
const isInspection = t => !!t.inspection_type || /inspec/i.test(t.title);
// Después de qué tarea va: la última de los trades de "antes" que esté antes de la primera de "después".
function suggestAfter(tasks, type, list = TYPES) {
  const x = typeof type === 'object' ? type : list.find(y => y.key === type); if (!x) return tasks.length ? tasks[tasks.length - 1].id : null;
  const work = tasks.filter(t => !isInspection(t));
  const bIdx = work.findIndex(x.before);
  const scope = bIdx >= 0 ? work.slice(0, bIdx) : work;
  for (let i = scope.length - 1; i >= 0; i--) if (x.after(scope[i])) return scope[i].id;
  if (x.after2) for (let i = scope.length - 1; i >= 0; i--) if (x.after2(scope[i])) return scope[i].id;
  if (bIdx > 0) return work[bIdx - 1].id;      // nada de "antes": justo antes de lo que frena
  if (bIdx === 0) return 0;                    // al principio
  return work.length ? (x.group === 'final' ? (work.filter(t => !x.before(t)).at(-1) || work.at(-1)).id : work.at(-1).id) : null;
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

// Pasó una inspección: avisa a los subs de la obra y al cliente, con lo que sigue en el schedule.
// Al sub que le toca lo siguiente le llega "Ya puede seguir". Se avisa una sola vez por inspección. Nunca lleva dinero.
function passed(db, taskId) {
  const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  if (!t || t.passed_notice_at || !isInspection(t)) return null;
  const { notify } = require('./push');
  const meta = k => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(t.job_id);
  const rest = db.prepare("SELECT * FROM tasks WHERE job_id=? AND (position>? OR (position=? AND id>?)) AND status<>'hecho' ORDER BY position, id").all(t.job_id, t.position, t.position, t.id);
  const work = rest.filter(x => !isInspection(x));
  const next = work.slice(0, 1).concat(work.slice(1).filter(x => x.planned_date && x.planned_date === (work[0] || {}).planned_date)).slice(0, 3);
  const nextInsp = rest.find(isInspection);
  const name = t.title.replace(/^(inspecci[oó]n|inspection)\s*:\s*/i, '');
  const fd = d => d ? d.slice(5).replace('-', '/') : '';
  const nTxt = next.length ? next.map(x => x.title + (x.planned_date ? ` (${fd(x.planned_date)})` : '')).join(', ') : (nextInsp ? nextInsp.title : '—');
  db.prepare("UPDATE tasks SET passed_notice_at=datetime('now') WHERE id=?").run(t.id);
  const sent = { subs: 0, client: false, next: next.map(x => ({ id: x.id, title: x.title, planned_date: x.planned_date, assignee_id: x.assignee_id })) };
  if (meta('insp_notify_subs') !== '0') {
    const nextPeople = new Set(next.map(x => x.assignee_id).filter(Boolean));
    const subs = new Set([...db.prepare('SELECT user_id FROM subs WHERE job_id=? AND user_id IS NOT NULL').all(t.job_id).map(r => r.user_id),
      ...db.prepare("SELECT DISTINCT assignee_id FROM tasks WHERE job_id=? AND assignee_id IS NOT NULL AND status<>'hecho'").all(t.job_id).map(r => r.assignee_id)]);
    for (const uid of nextPeople) {
      const mine = next.filter(x => x.assignee_id === uid);
      notify(db, uid, 'insp_next_you', { x: name, n: mine.map(x => x.title).join(', '), d: fd(mine[0].planned_date) || '—', job: job.client_name }, `#/obra/${job.id}`);
      sent.subs++;
    }
    const others = [...subs].filter(id => !nextPeople.has(id));
    if (others.length) { notify(db, others, 'insp_passed', { x: name, n: nTxt, job: job.client_name }, `#/obra/${job.id}`); sent.subs += others.length; }
  }
  if (job.client_user_id && meta('insp_notify_client') !== '0') {
    notify(db, job.client_user_id, 'insp_passed', { x: name, n: nTxt, job: job.address || job.client_name }, '#/');
    db.prepare("INSERT INTO client_updates(job_id,kind,data,note) VALUES(?,'status',?,'')").run(job.id, JSON.stringify({ status: 'inspeccion', name, next: next.map(x => x.title), next_date: (next[0] || {}).planned_date || '' }));
    sent.client = true;
  }
  return sent;
}

// Qué trade corrige cuando una inspección no pasa.
const TRADE_OF = { pilares: 'concreto', forms: 'concreto', subterranea: 'electricidad', losa: 'concreto', framing: 'carpinteria', rough_electrico: 'electricidad', rough_plomeria: 'plomeria',
  rough_gas: 'gas', mecanica: 'otro', mamposteria: 'piedra', aislamiento: 'drywall', final_electrico: 'electricidad', final_plomeria: 'plomeria', final_gas: 'gas', energia: 'electricidad', final: '' };
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TZ || 'America/Chicago' }).format(new Date());
// Inspecciones con fecha pasada y sin resultado: después de 24 horas se avisa a los dueños y al PM, una vez.
function noResult(db) {
  return db.prepare(`SELECT p.*, j.client_name, j.pm_id FROM permits p JOIN jobs j ON j.id=p.job_id
    WHERE p.kind='inspeccion' AND p.status NOT IN ('aprobado','rechazado') AND p.date<>'' AND p.date<? AND j.status NOT IN ('terminado','cancelado') ORDER BY p.date`).all(localToday());
}
function tick(db, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: process.env.APP_TZ || 'America/Chicago', hour: 'numeric', hour12: false }).format(now));
  if (hour < 7) return 0;
  const { notify, owners } = require('./push');
  let n = 0;
  for (const p of noResult(db).filter(x => !x.noresult_sent)) {
    notify(db, [...new Set([...owners(db), p.pm_id].filter(Boolean))], 'insp_noresult', { x: p.name, d: p.date.slice(5).replace('-', '/'), job: p.client_name }, `#/obra/${p.job_id}/permisos`);
    db.prepare("UPDATE permits SET noresult_sent=datetime('now') WHERE id=?").run(p.id); n++;
  }
  return n;
}

module.exports = { TYPES, GROUPS, typesFor, guessType, suggestAfter, isInspection, passed, noResult, tick, CLOSE, TRADE_OF };

module.exports.routes = function inspectionRoutes(db, add, H) {
  const { requireRole, fail, str, date, intId, jobOr404, canSeeJob } = H;
  const blockers = (t) => require('./templates').blockers(db, t);
  const out = x => ({ key: x.key, group: x.group, es: x.es, en: x.en, custom: !!x.custom, id: x.id, after_trade: x.after_trade || '' });
  const tasksOf = jobId => db.prepare('SELECT id, title, trade, position, status, planned_date, planned_end, inspection_type FROM tasks WHERE job_id=? ORDER BY position, id').all(jobId);
  const log = (u, id, summary) => db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,'crear','inspecciones',?,?)").run(u.pmId || u.id, id, summary);

  // Lo que la pantalla necesita para preguntar: tipos, tareas de la obra, dónde va cada tipo, y las que ya están.
  add('GET', '/api/jobs/:id/inspection-plan', ({ user, params, query }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const tasks = tasksOf(job.id), list = typesFor(db);
    const suggest = {}; for (const x of list) suggest[x.key] = suggestAfter(tasks, x);
    const existing = tasks.filter(isInspection).map(t => ({ id: t.id, title: t.title, type: t.inspection_type || guessType(t.title, list), status: t.status, planned_date: t.planned_date, removable: !blockers(t).length }));
    const pid = query.get('permit_id') ? intId(query.get('permit_id')) : null;
    const permit = pid ? db.prepare("SELECT id, name, number, status FROM permits WHERE id=? AND job_id=? AND kind='permiso'").get(pid, job.id) : null;
    return { types: list.map(out), can_add: ['owner', 'pm', 'sales'].includes(user.role), tasks: tasks.map(t => ({ id: t.id, title: t.title, trade: t.trade, inspection: isInspection(t), planned_date: t.planned_date, status: t.status })), suggest, existing, permit };
  });

  // Guardar: cada inspección queda como tarea en su lugar del schedule y como renglón en Permisos e inspecciones.
  add('POST', '/api/jobs/:id/inspections', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
    const remove = new Set((Array.isArray(body.remove_task_ids) ? body.remove_task_ids : []).map(Number));
    const permit = body.permit_id ? db.prepare("SELECT * FROM permits WHERE id=? AND job_id=? AND kind='permiso'").get(intId(body.permit_id), job.id) || fail(404, 'Permiso no encontrado') : null;
    if (!items.length && !remove.size && !permit) fail(400, 'Escoja las inspecciones que pidió la ciudad');
    return tx(db, () => {
      // Quitar las que la ciudad no pidió (solo si no tienen historia).
      let removed = 0;
      for (const id of remove) {
        const t = db.prepare('SELECT * FROM tasks WHERE id=? AND job_id=?').get(id, job.id);
        if (!t || !isInspection(t) || blockers(t).length) continue;
        db.prepare("DELETE FROM permits WHERE job_id=? AND kind='inspeccion' AND status='pendiente' AND (task_id=? OR (task_id IS NULL AND name=?))").run(job.id, t.id, t.title);
        db.prepare('DELETE FROM tasks WHERE id=?').run(t.id); removed++;
      }
      // Renumerar para que quepan entre tarea y tarea.
      tasksOf(job.id).forEach((t, i) => db.prepare('UPDATE tasks SET position=? WHERE id=?').run((i + 1) * 100, t.id));
      const created = [], used = {}, reused = new Set(), saved = [];
      let list = typesFor(db), MAP = Object.fromEntries(list.map(x => [x.key, x]));
      for (const it of items) {
        let type = MAP[it.type] ? it.type : 'otra';
        // "Otra" con palomita de "agregar a la lista": queda para las próximas obras de la compañía.
        if (type === 'otra' && it.save && str(it.name, 140)) {
          const k = addType(user, { name_es: it.name, name_en: it.name_en, group: it.save_group || 'otra', after_trade: it.after_trade }, true);
          list = typesFor(db); MAP = Object.fromEntries(list.map(x => [x.key, x])); type = k; saved.push(k);
        }
        const BYT = MAP[type];
        const lbl = BYT ? BYT[user.lang === 'en' ? 'en' : 'es'] : '';
        const name = str(it.name, 140) || (lbl ? (/^(inspecci|inspection)/i.test(lbl) ? lbl : `${user.lang === 'en' ? 'Inspection' : 'Inspección'}: ${lbl}`) : '');
        if (!name) fail(400, 'Escriba el nombre de la inspección');
        const afterId = it.after_task_id === 0 || it.after_task_id === '0' ? 0 : it.after_task_id ? intId(it.after_task_id) : null;
        const after = afterId ? db.prepare('SELECT * FROM tasks WHERE id=? AND job_id=?').get(afterId, job.id) : null;
        if (afterId && !after) fail(400, 'La tarea no es de esta obra');
        const base = after ? after.position : afterId === 0 ? 0 : (db.prepare('SELECT COALESCE(MAX(position),0) m FROM tasks WHERE job_id=?').get(job.id).m);
        used[base] = (used[base] || 0) + 1;
        const d = date(it.date, 'fecha') || (after && (after.planned_end || after.planned_date) ? addDays(after.planned_end || after.planned_date, 1) : '');
        const note = permit ? `${user.lang === 'en' ? 'Required by the city' : 'La pidió la ciudad'}${permit.number ? ` (#${permit.number})` : ''}` : '';
        // Si la plantilla ya traía esa inspección, se usa la misma tarea (se mueve a su lugar) en vez de duplicarla.
        const same = BYT && tasksOf(job.id).find(t => !remove.has(t.id) && !reused.has(t.id) && isInspection(t) && (t.inspection_type || guessType(t.title, list)) === type
          && !db.prepare("SELECT 1 FROM permits WHERE task_id=? AND parent_id IS NOT NULL").get(t.id));
        if (same) {
          reused.add(same.id);
          const nd = date(it.date, 'fecha') || same.planned_date || d;
          db.prepare("UPDATE tasks SET position=?, inspection_type=?, planned_date=?, planned_end=?, notes=CASE WHEN COALESCE(notes,'')='' THEN ? ELSE notes END WHERE id=?").run(base + used[base], type, nd, nd, note, same.id);
          const row = db.prepare("SELECT id FROM permits WHERE job_id=? AND kind='inspeccion' AND (task_id=? OR (task_id IS NULL AND name=?))").get(job.id, same.id, same.title);
          const pid = row ? (db.prepare("UPDATE permits SET task_id=?, insp_type=?, parent_id=COALESCE(parent_id,?), date=CASE WHEN ?<>'' THEN ? ELSE date END, status=CASE WHEN status='pendiente' AND ?<>'' THEN 'programada' ELSE status END WHERE id=?").run(same.id, type, permit ? permit.id : null, nd || '', nd || '', nd || '', row.id), row.id)
            : Number(db.prepare("INSERT INTO permits(job_id,kind,name,status,date,notes,parent_id,task_id,insp_type) VALUES(?,'inspeccion',?,?,?,'',?,?,?)").run(job.id, same.title, nd ? 'programada' : 'pendiente', nd || '', permit ? permit.id : null, same.id, type).lastInsertRowid);
          created.push({ task_id: same.id, permit_id: pid, reused: true });
          continue;
        }
        const tid = Number(db.prepare("INSERT INTO tasks(job_id,position,title,planned_date,planned_end,days,trade,inspection_type,notes) VALUES(?,?,?,?,?,1,'',?,?)")
          .run(job.id, base + used[base], name, d, d, type, note).lastInsertRowid);
        const pid = Number(db.prepare("INSERT INTO permits(job_id,kind,name,status,date,notes,parent_id,task_id,insp_type) VALUES(?,'inspeccion',?,?,?,'',?,?,?)")
          .run(job.id, name, d ? 'programada' : 'pendiente', d, permit ? permit.id : null, tid, type).lastInsertRowid);
        created.push({ task_id: tid, permit_id: pid });
      }
      tasksOf(job.id).forEach((t, i) => db.prepare('UPDATE tasks SET position=? WHERE id=?').run((i + 1) * 10, t.id));
      if (permit) db.prepare('UPDATE permits SET inspections_set=1 WHERE id=?').run(permit.id);
      log(user, job.id, `Inspecciones de la ciudad: ${created.length} agregada(s)${removed ? `, ${removed} quitada(s)` : ''}${permit ? ` (permiso ${permit.name})` : ''}`);
      return { ok: true, created, removed, saved };
    });
  });

  // Lista de inspecciones de la compañía: dueños, PM y vendedores pueden agregar las que pide su ciudad.
  const CAN = ['owner', 'pm', 'sales'];
  const who = u => u.pmId || u.id;
  const { tradeOk } = require('./trades');
  function addType(user, b, reuse) {
    const es = str(b.name_es, 120).replace(/^(inspecci[oó]n|inspection)\s*:\s*/i, '').trim(); if (!es) fail(400, 'Escriba el nombre de la inspección');
    const en = str(b.name_en, 120).replace(/^(inspection|inspecci[oó]n)\s*:\s*/i, '').trim();
    const group = GROUPS.includes(b.group) ? b.group : 'otra';
    const after = b.after_trade && tradeOk(b.after_trade) ? b.after_trade : '';
    const n = norm(es);
    const dupe = typesFor(db).find(x => norm(x.es) === n || norm(x.en) === n || (en && (norm(x.en) === norm(en) || norm(x.es) === norm(en))));
    if (dupe) { if (reuse) return dupe.key; fail(409, 'Esa inspección ya está en la lista'); }
    const id = Number(db.prepare('INSERT INTO inspection_types(group_key,name_es,name_en,after_trade,created_by) VALUES(?,?,?,?,?)').run(group, es, en, after, who(user)).lastInsertRowid);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,'crear','tipo_inspeccion',?,?)").run(who(user), id, `Nueva inspección en la lista: ${es}`);
    return 'c' + id;
  }
  add('GET', '/api/inspection-types', ({ user }) => {
    requireRole(user, ...CAN);
    const names = Object.fromEntries(db.prepare('SELECT id, name FROM users').all().map(u => [u.id, u.name]));
    return { groups: GROUPS, types: typesFor(db).map(x => ({ ...out(x), by: x.custom ? names[x.created_by] || '' : '', can_delete: !!x.custom && (user.role === 'owner' || x.created_by === who(user)) })) };
  });
  add('POST', '/api/inspection-types', ({ user, body }) => {
    requireRole(user, ...CAN);
    const key = addType(user, body || {}, false);
    return { ok: true, key, type: out(typesFor(db).find(x => x.key === key)) };
  });
  const customOr404 = id => db.prepare('SELECT * FROM inspection_types WHERE id=? AND active=1').get(intId(id)) || fail(404, 'Esa inspección no está en la lista');
  add('PUT', '/api/inspection-types/:id', ({ user, params, body }) => {
    requireRole(user, ...CAN);
    const r = customOr404(params.id);
    const es = body.name_es !== undefined ? str(body.name_es, 120).trim() : r.name_es; if (!es) fail(400, 'Escriba el nombre de la inspección');
    const en = body.name_en !== undefined ? str(body.name_en, 120).trim() : r.name_en;
    const group = body.group !== undefined ? (GROUPS.includes(body.group) ? body.group : 'otra') : r.group_key;
    const after = body.after_trade !== undefined ? (body.after_trade && tradeOk(body.after_trade) ? body.after_trade : '') : r.after_trade;
    if (typesFor(db).some(x => x.id !== r.id && (norm(x.es) === norm(es) || norm(x.en) === norm(es)))) fail(409, 'Esa inspección ya está en la lista');
    db.prepare('UPDATE inspection_types SET name_es=?, name_en=?, group_key=?, after_trade=? WHERE id=?').run(es, en, group, after, r.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,'editar','tipo_inspeccion',?,?)").run(who(user), r.id, `Inspección de la lista cambiada: ${es}`);
    return { ok: true };
  });
  // Quitar de la lista: el dueño o quien la agregó. Las obras que ya la tienen no cambian.
  add('DELETE', '/api/inspection-types/:id', ({ user, params }) => {
    requireRole(user, ...CAN);
    const r = customOr404(params.id);
    if (user.role !== 'owner' && r.created_by !== who(user)) fail(403, 'Solo el dueño o quien la agregó la puede quitar');
    db.prepare('UPDATE inspection_types SET active=0 WHERE id=?').run(r.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,'borrar','tipo_inspeccion',?,?)").run(who(user), r.id, `Inspección quitada de la lista: ${r.name_es}`);
    return { ok: true };
  });

  // Permisos aprobados que todavía no tienen sus inspecciones capturadas (la app los pregunta).
  add('GET', '/api/permits/needs-inspections', ({ user }) => {
    requireRole(user, 'owner');
    return db.prepare(`SELECT p.id, p.name, p.number, p.job_id, j.client_name FROM permits p JOIN jobs j ON j.id=p.job_id
      WHERE p.kind='permiso' AND p.status='aprobado' AND p.inspections_set=0 AND j.status NOT IN ('terminado','cancelado') ORDER BY p.id`).all().filter(p => canSeeJob(db, user, p.job_id));
  });

  // ===== Fase 5: resultado de la inspección (pasó / no pasó), motivo y reinspección =====
  add('POST', '/api/permits/:id/result', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const p = db.prepare("SELECT * FROM permits WHERE id=? AND kind='inspeccion'").get(intId(params.id));
    if (!p || !canSeeJob(db, user, p.job_id)) fail(404, 'No encontrado');
    if (p.status === 'aprobado') fail(400, 'Esta inspección ya pasó');
    if (p.status === 'rechazado' && p.result_at) fail(400, 'Esta inspección ya tiene resultado (no pasó); use su reinspección');
    const result = body.result === 'paso' ? 'paso' : body.result === 'fallo' ? 'fallo' : fail(400, 'Escoja si pasó o no pasó');
    const day = date(body.date, 'fecha') || localToday();
    const inspector = str(body.inspector, 80);
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(p.job_id);
    const who = user.pmId || user.id;
    let photoId = null;
    if (body.photo) { photoId = H.saveImage(db, user, { dataUrl: body.photo, jobId: job.id, kind: 'photo', caption: `${result === 'paso' ? 'Inspection passed' : 'Inspection failed'}: ${p.name}` }).id; db.prepare('UPDATE files SET permit_id=? WHERE id=?').run(p.id, photoId); }
    if (result === 'paso') {
      db.prepare("UPDATE permits SET status='aprobado', result_at=?, inspector=?, date=CASE WHEN date='' THEN ? ELSE date END WHERE id=?").run(day, inspector, day, p.id);
      db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,'editar','inspeccion',?,?,?)").run(who, p.id, job.id, `Pasó la inspección: ${p.name}${p.attempt > 1 ? ` (intento ${p.attempt})` : ''}`);
      let n = null;
      if (p.task_id) { db.prepare("UPDATE tasks SET status='hecho', done_date=? WHERE id=? AND status<>'hecho'").run(day, p.task_id); n = passed(db, p.task_id); }
      return { ok: true, result, inspection: n };
    }
    const reason = str(body.reason, 300).trim(); if (reason.length < 3) fail(400, 'Escriba por qué no pasó (lo que dijo el inspector)');
    const re = date(body.reinspect_date, 'fecha de reinspección') || '';
    const base = p.name.replace(/^(reinspecci[oó]n|reinspection)\s*(\d+)?\s*:\s*/i, '');
    let out;
    tx(db, () => {
      db.prepare("UPDATE permits SET status='rechazado', result_at=?, fail_reason=?, inspector=?, date=CASE WHEN date='' THEN ? ELSE date END WHERE id=?").run(day, reason, inspector, day, p.id);
      const rid = Number(db.prepare("INSERT INTO permits(job_id,kind,name,number,status,date,notes,parent_id,task_id,insp_type,reinspect_of,attempt) VALUES(?,'inspeccion',?,?,?,?,?,?,?,?,?,?)")
        .run(job.id, `Reinspección: ${base}`, p.number || '', re ? 'programada' : 'pendiente', re, '', p.parent_id, p.task_id, p.insp_type || '', p.id, (p.attempt || 1) + 1).lastInsertRowid);
      db.prepare('UPDATE permits SET task_id=NULL WHERE id=?').run(p.id);
      let fixId = null;
      if (p.task_id) {
        const t = db.prepare('SELECT * FROM tasks WHERE id=?').get(p.task_id);
        db.prepare("UPDATE tasks SET status='pendiente', done_date='', planned_date=?, planned_end=?, passed_notice_at='', notes=TRIM(COALESCE(notes,'') || ?) WHERE id=?")
          .run(re || t.planned_date, re || t.planned_end || t.planned_date, `\nNo pasó el ${day}: ${reason}`, t.id);
        // Lo que hay que corregir antes de la reinspección, al crew del trade que toca, justo antes de la inspección.
        if (body.fix !== false) {
          const trade = TRADE_OF[t.inspection_type] || TRADE_OF[p.insp_type] || '';
          const crew = trade ? require('./templates').crewFor(db, job.id)(trade) : null;
          db.prepare('UPDATE tasks SET position=position+1 WHERE job_id=? AND position>=?').run(job.id, t.position);
          fixId = Number(db.prepare("INSERT INTO tasks(job_id,title,position,status,planned_date,planned_end,trade,assignee_id,notes,fix_for) VALUES(?,?,?,'pendiente',?,?,?,?,?,?)")
            .run(job.id, `Corregir para reinspección: ${reason}`.slice(0, 140), t.position, localToday(), localToday(), trade, crew || null, `${base} — ${reason}`, rid).lastInsertRowid);
        }
      }
      db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,'editar','inspeccion',?,?,?)").run(who, p.id, job.id, `No pasó la inspección: ${p.name} — ${reason}${re ? ` · reinspección ${re}` : ''}`);
      out = { ok: true, result, reinspection_id: rid, fix_task_id: fixId };
    });
    // Aviso a los dueños, al PM de la obra y al crew que corrige. Al cliente no.
    const { notify, owners } = require('./push');
    const fixer = out.fix_task_id ? (db.prepare('SELECT assignee_id FROM tasks WHERE id=?').get(out.fix_task_id) || {}).assignee_id : null;
    const to = [...new Set([...owners(db), job.pm_id, fixer].filter(Boolean))].filter(id => id !== who);
    if (to.length) notify(db, to, 'insp_failed', { x: base, n: reason, d: re ? re.slice(5).replace('-', '/') : '—', job: job.client_name }, `#/obra/${job.id}/permisos`);
    return out;
  });
};
