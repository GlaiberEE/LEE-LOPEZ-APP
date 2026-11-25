'use strict';
// v2.35 — Selecciones del cliente: lo que el cliente tiene que escoger (stain, piedra, cubierta, luces…) antes de que se necesite.
//  - Cada selección es de una zona de la obra y se liga a la tarea que la necesita. Fecha límite = fecha de esa tarea − días de anticipación
//    (para pedir el material). Si la tarea cambia de fecha, la fecha límite se mueve sola.
//  - Dos formas de trabajar: la empresa le da opciones (con foto del catálogo de materiales) o el cliente escoge por su cuenta y se anota.
//  - El cliente aprueba en su portal (queda su nombre y la fecha). También se puede anotar "lo aprobó en persona / por texto".
//  - Al aprobar, el material entra solo a la Ficha de materiales de la obra (que ven el cliente, los subs y la cuadrilla).
//  - Cambiar algo ya aprobado avisa a los dueños: puede costar un change order.
//  - Los subs y trabajadores solo ven lo aprobado.
const TZ = () => process.env.APP_TZ || 'America/Chicago';
const todayL = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(now);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
const LEAD = 7;

// Qué tarea necesita cada zona (por oficio o por palabras del título).
const ZONE_TASK = {
  techo: { trades: ['techo'], re: /teja|shingle|techo|roof/i },
  ceiling: { re: /cielo|ceiling|t&g/i },
  fascia: { re: /trim|fascia|forrar/i },
  estructura: { re: /postes|vigas|posts|beams/i },
  piso: { re: /piso|floor|paver|losa|slab|stamped/i },
  cocina_cubierta: { re: /cubierta|countertop|granit|quartz/i },
  cocina_base: { trades: ['piedra'], re: /block de cocina|revest|veneer|piedra|stone/i },
  cocina_equipo: { re: /equipo de cocina|appliance|grill|parrilla|instalar equipo/i },
  chimenea: { re: /chimenea|fireplace|fog[oó]n|fire pit/i },
  iluminacion: { trades: ['electricidad'], re: /el[eé]ctric|luces|lights|abanico|fan/i },
  pintura: { trades: ['pintura'], re: /pintura|stain|paint|sellar/i },
};
function guessTask(tasks, zone) {
  const z = ZONE_TASK[zone]; if (!z) return null;
  const open = tasks.filter(t => t.status !== 'hecho');
  const byTrade = z.trades ? open.find(t => z.trades.includes(t.trade) && z.re.test(t.title)) || open.find(t => z.trades.includes(t.trade)) : null;
  return byTrade || open.find(t => z.re.test(t.title)) || null;
}

function routes(db, add, h) {
  const { requireRole, fail, str, intId, canSeeJob } = h;
  const push = () => require('./push');
  const ZONES = require('./materials').ZONES;
  const zoneName = (z, l = 'es') => { const x = ZONES.find(i => i.key === z); return x ? x[l] : z; };
  const staff = u => u && u.role === 'owner' && !u.isOffice; // dueño o PM (el PM entra "como dueño")
  const realOwner = u => u && u.role === 'owner' && !u.isPm && !u.isOffice;
  const meId = u => u.pmId || u.officeId || u.id;
  const job = id => db.prepare('SELECT * FROM jobs WHERE id=?').get(intId(id));
  const sel = id => db.prepare('SELECT * FROM job_selections WHERE id=?').get(intId(id));
  const mustSee = (user, jobId) => { if (!canSeeJob(db, user, jobId)) fail(404, 'No encontrado'); };
  const log = (user, s, txt) => { try { db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(?,?,?,?,?,?)").run(meId(user), 'editar', 'selección', s.id, s.job_id, txt); } catch {} };
  const notifyStaff = (j, kind, vars) => { const ids = [...push().owners(db), j.pm_id].filter(Boolean); push().notify(db, ids, kind, vars, `#/obra/${j.id}/materiales`); };

  // Arma la vista de una selección: fecha límite, días que faltan, atraso y si detiene la tarea.
  function view(s, today = todayL()) {
    const task = s.task_id ? db.prepare('SELECT id, title, planned_date, status, trade FROM tasks WHERE id=?').get(s.task_id) : null;
    const need_by = s.need_by_manual || (task && task.planned_date ? addDays(task.planned_date, -(s.lead_days ?? LEAD)) : '');
    const options = db.prepare(`SELECT o.*, m.name m_name, m.brand m_brand, m.color_name m_color, m.color_hex m_hex, m.finish m_finish, m.has_image m_img
      FROM selection_options o LEFT JOIN materials m ON m.id=o.material_id WHERE o.selection_id=? ORDER BY o.position, o.id`).all(s.id)
      .map(o => ({ id: o.id, material_id: o.material_id, title: o.title || [o.m_brand, o.m_name].filter(Boolean).join(' '), note: o.note,
        color: o.m_color || '', hex: o.m_hex || '', finish: o.m_finish || '', image: o.material_id && o.m_img ? `/api/materials/${o.material_id}/image` : '' }));
    const chosen = s.choice_option_id ? options.find(o => o.id === s.choice_option_id) : null;
    const done = s.status === 'aprobado';
    const days_left = need_by ? daysBetween(today, need_by) : null;
    const late = !done && need_by && days_left < 0;
    return { id: s.id, job_id: s.job_id, zone: s.zone, label: s.label || zoneName(s.zone), label_en: s.label_en || s.label || zoneName(s.zone, 'en'), notes: s.notes,
      status: s.status, choice_text: chosen ? chosen.title : s.choice_text, choice_option_id: s.choice_option_id, client_note: s.client_note,
      approved_at: s.approved_at, approved_name: s.approved_name, approved_how: s.approved_how, changed_after_approval: !!s.changed_after_approval,
      task: task ? { id: task.id, title: task.title, planned_date: task.planned_date, status: task.status } : null,
      lead_days: s.lead_days ?? LEAD, need_by, need_by_manual: s.need_by_manual, days_left, late: !!late, soon: !done && days_left != null && days_left >= 0 && days_left <= 3,
      blocks: !!(late && task && task.status === 'pendiente'), options };
  }
  const listFor = (jobId, user) => {
    let rows = db.prepare('SELECT * FROM job_selections WHERE job_id=? ORDER BY id').all(jobId).map(s => view(s));
    if (user.role === 'worker' || user.role === 'sales') rows = rows.filter(s => s.status === 'aprobado').map(({ options, client_note, ...s }) => s);
    // Las notas que escribe la empresa le llegan al cliente en su idioma (si la traducción está activada).
    if (user.role === 'client') {
      const TR = require('./translate'); const lang = user.lang || 'en';
      const tr = x => { try { const r = x && TR.forReader(db, x, lang); return r && r.tr ? r.tr : x; } catch { return x; } };
      rows = rows.map(s => ({ ...s, notes: undefined, options: s.options.map(o => ({ ...o, note: tr(o.note) })) }));
    }
    return rows;
  };

  add('GET', '/api/jobs/:id/selections', ({ user, params }) => {
    requireRole(user, 'owner', 'pm', 'worker', 'client', 'sales');
    const j = job(params.id); if (!j) fail(404, 'Obra no encontrada'); mustSee(user, j.id);
    const list = listFor(j.id, user);
    const z = new Set(list.map(s => s.zone));
    const tasks = db.prepare('SELECT id, title, trade, status, planned_date FROM tasks WHERE job_id=? ORDER BY position, id').all(j.id);
    const suggest = staff(user) ? Object.keys(ZONE_TASK).filter(k => !z.has(k) && guessTask(tasks, k)).map(k => ({ zone: k, label: zoneName(k), task: guessTask(tasks, k).title })) : [];
    return { selections: list, suggest, tasks: staff(user) ? tasks : undefined };
  });

  const fields = (b, cur = {}, jobId) => {
    const zone = ZONES.some(z => z.key === (b.zone ?? cur.zone)) ? (b.zone ?? cur.zone) : 'otro';
    let task_id = 'task_id' in b ? (b.task_id ? intId(b.task_id) : null) : cur.task_id ?? null;
    if (task_id && !db.prepare('SELECT 1 FROM tasks WHERE id=? AND job_id=?').get(task_id, jobId)) fail(400, 'Esa tarea no es de esta obra');
    const lead = 'lead_days' in b ? Math.max(0, Math.min(90, parseInt(b.lead_days, 10) || 0)) : (cur.lead_days ?? LEAD);
    const nb = 'need_by' in b ? String(b.need_by || '') : (cur.need_by_manual || '');
    if (nb && !/^\d{4}-\d{2}-\d{2}$/.test(nb)) fail(400, 'Fecha inválida');
    return { zone, label: str(b.label ?? cur.label, 80), label_en: str(b.label_en ?? cur.label_en, 80), task_id, lead_days: lead, need_by_manual: nb, notes: str(b.notes ?? cur.notes, 500) };
  };
  add('POST', '/api/jobs/:id/selections', ({ user, params, body }) => {
    requireRole(user, 'owner'); if (!staff(user)) fail(403, 'No autorizado');
    const j = job(params.id); if (!j) fail(404, 'Obra no encontrada'); mustSee(user, j.id);
    const f = fields(body, {}, j.id);
    if (!f.task_id && ZONE_TASK[f.zone]) { const t = guessTask(db.prepare('SELECT * FROM tasks WHERE job_id=?').all(j.id), f.zone); if (t) f.task_id = t.id; }
    const id = Number(db.prepare('INSERT INTO job_selections(job_id,zone,label,label_en,task_id,lead_days,need_by_manual,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(j.id, f.zone, f.label, f.label_en, f.task_id, f.lead_days, f.need_by_manual, f.notes, meId(user)).lastInsertRowid);
    return view(sel(id));
  });
  // Arma de una vez lo que normalmente se escoge en este tipo de obra (según sus tareas).
  add('POST', '/api/jobs/:id/selections/auto', ({ user, params }) => {
    requireRole(user, 'owner'); if (!staff(user)) fail(403, 'No autorizado');
    const j = job(params.id); if (!j) fail(404, 'Obra no encontrada'); mustSee(user, j.id);
    const tasks = db.prepare('SELECT * FROM tasks WHERE job_id=? ORDER BY position, id').all(j.id);
    const have = new Set(db.prepare('SELECT zone FROM job_selections WHERE job_id=?').all(j.id).map(r => r.zone));
    let n = 0;
    for (const z of Object.keys(ZONE_TASK)) {
      if (have.has(z)) continue; const t = guessTask(tasks, z); if (!t) continue;
      db.prepare('INSERT INTO job_selections(job_id,zone,task_id,lead_days,created_by) VALUES(?,?,?,?,?)').run(j.id, z, t.id, LEAD, meId(user)); n++;
    }
    return { added: n, selections: listFor(j.id, user) };
  });
  add('PUT', '/api/selections/:id', ({ user, body, params }) => {
    requireRole(user, 'owner'); if (!staff(user)) fail(403, 'No autorizado');
    const s = sel(params.id); if (!s) fail(404, 'No encontrado'); mustSee(user, s.job_id);
    const f = fields(body, s, s.job_id);
    db.prepare('UPDATE job_selections SET zone=?, label=?, label_en=?, task_id=?, lead_days=?, need_by_manual=?, notes=? WHERE id=?')
      .run(f.zone, f.label, f.label_en, f.task_id, f.lead_days, f.need_by_manual, f.notes, s.id);
    return view(sel(s.id));
  });
  add('DELETE', '/api/selections/:id', ({ user, params }) => {
    requireRole(user, 'owner'); if (!staff(user)) fail(403, 'No autorizado');
    const s = sel(params.id); if (!s) fail(404, 'No encontrado'); mustSee(user, s.job_id);
    if (s.status === 'aprobado' && !realOwner(user)) fail(403, 'Una selección aprobada solo la quita un dueño');
    db.prepare('DELETE FROM job_selections WHERE id=?').run(s.id);
    log(user, s, `Quitó la selección ${s.label || zoneName(s.zone)}`);
    return { ok: true };
  });

  // Opciones que la empresa le da al cliente (del catálogo de materiales, con foto, o solo con nombre).
  add('POST', '/api/selections/:id/options', ({ user, params, body }) => {
    requireRole(user, 'owner'); if (!staff(user)) fail(403, 'No autorizado');
    const s = sel(params.id); if (!s) fail(404, 'No encontrado'); mustSee(user, s.job_id);
    if (s.status === 'aprobado') fail(409, 'Ya está aprobada. Para cambiarla, primero ábrala otra vez.');
    const mid = body.material_id ? intId(body.material_id) : null;
    if (mid && !db.prepare('SELECT 1 FROM materials WHERE id=?').get(mid)) fail(400, 'Ese material no existe');
    const title = str(body.title, 120); if (!mid && !title) fail(400, 'Escriba la opción o escoja un material');
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM selection_options WHERE selection_id=?').get(s.id).p;
    db.prepare('INSERT INTO selection_options(selection_id,material_id,title,note,position) VALUES(?,?,?,?,?)').run(s.id, mid, title, str(body.note, 300), pos);
    return view(sel(s.id));
  });
  add('DELETE', '/api/selection-options/:id', ({ user, params }) => {
    requireRole(user, 'owner'); if (!staff(user)) fail(403, 'No autorizado');
    const o = db.prepare('SELECT * FROM selection_options WHERE id=?').get(intId(params.id)); if (!o) fail(404, 'No encontrado');
    const s = sel(o.selection_id); mustSee(user, s.job_id);
    if (s.choice_option_id === o.id && s.status === 'aprobado') fail(409, 'Esa opción ya está aprobada');
    db.prepare('DELETE FROM selection_options WHERE id=?').run(o.id);
    if (s.choice_option_id === o.id) db.prepare("UPDATE job_selections SET choice_option_id=NULL, status='pendiente' WHERE id=?").run(s.id);
    return view(sel(s.id));
  });

  // Escoger: el cliente toca una opción o escribe lo que quiere; la empresa también puede anotar lo que el cliente escogió.
  add('POST', '/api/selections/:id/choose', ({ user, params, body }) => {
    requireRole(user, 'owner', 'client');
    const s = sel(params.id); if (!s) fail(404, 'No encontrado'); mustSee(user, s.job_id);
    if (user.role === 'owner' && !staff(user)) fail(403, 'No autorizado');
    if (user.is_agent) fail(403, 'Un agente no escoge ni aprueba por el cliente');
    const j = job(s.job_id);
    const opt = body.option_id ? db.prepare('SELECT * FROM selection_options WHERE id=? AND selection_id=?').get(intId(body.option_id), s.id) : null;
    if (body.option_id && !opt) fail(400, 'Esa opción no es de esta selección');
    const text = opt ? '' : str(body.text, 200);
    if (!opt && !text) fail(400, 'Escoja una opción o escriba lo que quiere');
    const wasApproved = s.status === 'aprobado';
    if (wasApproved && user.role === 'owner' && !realOwner(user)) fail(403, 'Cambiar algo ya aprobado lo autoriza un dueño');
    db.prepare(`UPDATE job_selections SET choice_option_id=?, choice_text=?, client_note=?, status='escogido', approved_at='', approved_name='', approved_how='', approved_by=NULL,
      changed_after_approval=CASE WHEN ? THEN 1 ELSE changed_after_approval END WHERE id=?`).run(opt ? opt.id : null, text, str(body.note ?? s.client_note, 300), wasApproved ? 1 : 0, s.id);
    const label = s.label || zoneName(s.zone);
    log(user, s, `${user.role === 'client' ? 'El cliente escogió' : 'Se anotó lo que escogió el cliente'} en ${label}: ${opt ? (opt.title || 'opción ' + opt.id) : text}${wasApproved ? ' (CAMBIO de algo ya aprobado)' : ''}`);
    if (wasApproved) notifyStaff(j, 'selection_changed', { s: label, c: j.client_name });
    return view(sel(s.id));
  });
  // Aprobar: el cliente en su portal (queda su nombre), o la empresa anota cómo lo aprobó (en persona, por texto, por correo).
  add('POST', '/api/selections/:id/approve', ({ user, params, body }) => {
    requireRole(user, 'owner', 'client');
    const s = sel(params.id); if (!s) fail(404, 'No encontrado'); mustSee(user, s.job_id);
    if (user.role === 'owner' && !staff(user)) fail(403, 'No autorizado');
    if (user.is_agent) fail(403, 'Un agente no escoge ni aprueba por el cliente');
    if (s.status === 'aprobado') return view(s);
    let choice = s.choice_option_id || s.choice_text;
    // Si el cliente toca "Apruebo" sobre una opción, se escoge y se aprueba en un paso.
    if (body.option_id) {
      const opt = db.prepare('SELECT * FROM selection_options WHERE id=? AND selection_id=?').get(intId(body.option_id), s.id);
      if (!opt) fail(400, 'Esa opción no es de esta selección');
      db.prepare('UPDATE job_selections SET choice_option_id=?, choice_text=? WHERE id=?').run(opt.id, '', s.id); choice = opt.id;
    }
    if (!choice) fail(400, 'Primero hay que escoger');
    const j = job(s.job_id);
    const how = user.role === 'client' ? 'portal' : (['en persona', 'por texto', 'por correo', 'por teléfono'].includes(body.how) ? body.how : fail(400, 'Diga cómo lo aprobó el cliente'));
    const name = user.role === 'client' ? (str(body.name, 80) || user.name) : (str(body.note, 120) || j.client_name);
    db.prepare("UPDATE job_selections SET status='aprobado', approved_at=datetime('now'), approved_by=?, approved_name=?, approved_how=? WHERE id=?").run(meId(user), name, how, s.id);
    const now = sel(s.id);
    // El material aprobado entra a la ficha de materiales de la obra.
    if (now.choice_option_id) {
      const o = db.prepare('SELECT * FROM selection_options WHERE id=?').get(now.choice_option_id);
      if (o && o.material_id && !db.prepare('SELECT 1 FROM job_materials WHERE job_id=? AND material_id=?').get(j.id, o.material_id)) {
        const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM job_materials WHERE job_id=?').get(j.id).p;
        db.prepare('INSERT INTO job_materials(job_id,material_id,area,note,position) VALUES(?,?,?,?,?)').run(j.id, o.material_id, s.label || zoneName(s.zone), 'Aprobado por el cliente', pos);
      }
    }
    const label = s.label || zoneName(s.zone);
    log(user, s, `Aprobado ${label} (${how === 'portal' ? 'el cliente en su portal' : how}: ${name})`);
    if (user.role === 'client') notifyStaff(j, 'selection_approved', { s: label, c: j.client_name });
    return view(now);
  });

  // Para el Resumen de hoy, Mis pendientes y el aviso en el inicio.
  add('GET', '/api/selections/pending', ({ user }) => {
    requireRole(user, 'owner');
    const today = todayL();
    return db.prepare(`SELECT s.*, j.client_name, j.pm_id FROM job_selections s JOIN jobs j ON j.id=s.job_id WHERE s.status<>'aprobado' AND j.status IN ('activo','vendido','cotizado','prospecto')`).all()
      .filter(s => canSeeJob(db, user, s.job_id)).map(s => ({ ...view(s, today), client_name: s.client_name }))
      .filter(s => s.late || s.soon || s.changed_after_approval).sort((a, b) => (a.days_left ?? 99) - (b.days_left ?? 99));
  });
}

// Recordatorios: al cliente 3 días antes, el día límite y al día siguiente si sigue sin escoger; a los dueños y al PM cuando ya se atrasó.
function tick(db, now = new Date()) {
  const today = todayL(now);
  const push = require('./push');
  const ZONES = require('./materials').ZONES;
  const zoneName = (z, l) => { const x = ZONES.find(i => i.key === z); return x ? x[l] : z; };
  let e164 = () => ''; try { e164 = require('./sms').e164; } catch {}
  const rows = db.prepare(`SELECT s.*, j.client_name, j.client_phone, j.client_user_id, j.pm_id, j.status jstatus FROM job_selections s JOIN jobs j ON j.id=s.job_id
    WHERE s.status<>'aprobado' AND j.status IN ('activo','vendido')`).all();
  for (const s of rows) {
    const task = s.task_id ? db.prepare('SELECT planned_date, status, title FROM tasks WHERE id=?').get(s.task_id) : null;
    const need = s.need_by_manual || (task && task.planned_date ? addDays(task.planned_date, -(s.lead_days ?? LEAD)) : '');
    if (!need) continue;
    const left = daysBetween(today, need);
    const stage = left === 3 ? 'pronto' : left === 0 ? 'hoy' : left === -1 ? 'tarde' : '';
    if (!stage) continue;
    const sent = String(s.reminded || '').split(',');
    if (sent.includes(stage)) continue;
    const lang = (s.client_user_id && (db.prepare('SELECT lang FROM users WHERE id=?').get(s.client_user_id) || {}).lang) || 'en';
    const label = s.label ? (lang === 'en' ? s.label_en || s.label : s.label) : zoneName(s.zone, lang === 'en' ? 'en' : 'es');
    const first = String(s.client_name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || '';
    if (s.client_user_id) push.notify(db, s.client_user_id, stage === 'tarde' ? 'selection_client_late' : 'selection_client', { s: label, d: need }, `#/obra/${s.job_id}`);
    const ph = e164(s.client_phone);
    if (ph) {
      const body = lang === 'en'
        ? { pronto: `Hi ${first}, a reminder: please choose your ${label} by ${need} so we can order it on time. You can do it in your project portal.`,
          hoy: `Hi ${first}, today is the day to choose your ${label} so we can order it and keep your project on schedule. You can do it in your project portal.`,
          tarde: `Hi ${first}, we still need your choice for ${label}. Without it, that part of the work may be delayed. You can choose it in your project portal or reply to this message.` }[stage]
        : { pronto: `Hola ${first}, le recordamos escoger ${label} antes del ${need} para pedirlo a tiempo. Lo puede hacer en el portal de su proyecto.`,
          hoy: `Hola ${first}, hoy es el día para escoger ${label} y pedirlo a tiempo para no atrasar su proyecto. Lo puede hacer en el portal de su proyecto.`,
          tarde: `Hola ${first}, todavía nos falta su decisión de ${label}. Sin ella, esa parte del trabajo se puede atrasar. Escójalo en el portal de su proyecto o conteste este mensaje.` }[stage];
      try {
        db.prepare(`INSERT INTO sms_drafts(ref,kind,phone,user_id,job_id,lang,body,for_date) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(ref) DO NOTHING`)
          .run(`sel:${s.id}:${stage}`, 'seleccion_cliente', ph, s.client_user_id || null, s.job_id, lang === 'en' ? 'en' : 'es', body, today);
      } catch {}
    }
    if (stage === 'tarde') push.notify(db, [...push.owners(db), s.pm_id].filter(Boolean), 'selection_late', { s: zoneName(s.zone, 'es'), c: s.client_name, t: task ? task.title : '' }, `#/obra/${s.job_id}/materiales`);
    db.prepare('UPDATE job_selections SET reminded=? WHERE id=?').run([...sent.filter(Boolean), stage].join(','), s.id);
  }
}

// Lo que está por vencer o atrasado (para el resumen de la mañana y las alertas). Sin rutas: se usa desde otros módulos.
function due(db, today = todayL()) {
  const ZONES = require('./materials').ZONES;
  const zn = (z, l) => { const x = ZONES.find(i => i.key === z); return x ? x[l] : z; };
  return db.prepare(`SELECT s.*, j.client_name, t.planned_date tdate, t.status tstatus, t.title ttitle FROM job_selections s JOIN jobs j ON j.id=s.job_id
      LEFT JOIN tasks t ON t.id=s.task_id WHERE s.status<>'aprobado' AND j.status IN ('activo','vendido')`).all()
    .map(s => {
      const need = s.need_by_manual || (s.tdate ? addDays(s.tdate, -(s.lead_days ?? LEAD)) : '');
      const left = need ? daysBetween(today, need) : null;
      return { id: s.id, job_id: s.job_id, client_name: s.client_name, es: s.label || zn(s.zone, 'es'), en: s.label_en || s.label || zn(s.zone, 'en'), need_by: need, days_left: left,
        late: left != null && left < 0, blocks: left != null && left < 0 && s.tstatus === 'pendiente', task: s.ttitle || '', changed: !!s.changed_after_approval };
    })
    .filter(s => (s.days_left != null && s.days_left <= 3) || s.changed);
}

module.exports = { routes, tick, due, guessTask, ZONE_TASK };
