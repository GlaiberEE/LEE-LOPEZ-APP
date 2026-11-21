'use strict';
// Plan de trabajo: la AI propone las tareas en orden, días, oficio/sub, inspecciones y material a pedir,
// leyendo el estimado de la obra (lo que hay en la app) o el PDF/foto del estimado que se le mandó al cliente.
// Es un BORRADOR: ustedes lo cambian como quieran y solo al aplicarlo se vuelve el calendario de la obra.
// Sin clave de AI, propone un plan base según el tipo de proyecto (y sus plantillas guardadas).
const C = require('./catalog');
const { tx } = require('./db');

const MODEL = process.env.PLAN_MODEL || 'claude-sonnet-5-5';
const API_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
const enabled = () => !!process.env.ANTHROPIC_API_KEY;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Días típicos por palabra clave (para el plan base sin AI).
const DAYS = [[/inspecci|inspection/, 1], [/permiso|permit/, 1], [/excava|base|zapata|footing|concreto|colar|pour/, 2], [/estructura|frame|postes|vigas|framing/, 3],
  [/techo|roof|shingle|teja/, 2], [/electric|luces|lights/, 2], [/plomer|gas|plumb/, 1], [/piedra|stone|block|ladrill/, 3], [/granito|cubierta|counter/, 1],
  [/stain|pintura|paint|sellad/, 2], [/limpieza|clean/, 1], [/entrega|walkthrough|final/, 1]];
const daysFor = t => { const n = norm(t); for (const [re, d] of DAYS) if (re.test(n)) return d; return 1; };
const tradeFor = t => { const n = norm(t);
  if (/electric|luces|lights|ventilador/.test(n)) return 'Electricidad'; if (/plomer|gas|plumb/.test(n)) return 'Plomería';
  if (/techo|roof|shingle|teja/.test(n)) return 'Techo'; if (/concreto|colar|zapata|footing|pour|base/.test(n)) return 'Concreto';
  if (/piedra|stone|block|mampost/.test(n)) return 'Albañilería'; if (/granito|cubierta|counter/.test(n)) return 'Granito';
  if (/stain|pintura|paint/.test(n)) return 'Pintura'; if (/estructura|frame|postes|vigas|carpint/.test(n)) return 'Carpintería'; return ''; };

function basePlan(db, job) {
  const type = C.PROJECT_TYPES.find(p => p.key === job.project_type) || C.PROJECT_TYPES.find(p => p.key === 'otro');
  return type.tasks.map(([es]) => ({ title: es, days: daysFor(es), trade: tradeFor(es), inspection: /inspecci/i.test(es), materials: '', notes: '' }));
}

async function callAI({ job, cos, workers, templates, file, extra }) {
  const system = 'You plan construction jobs for Elevated Exteriors, an outdoor living contractor in the Dallas-Fort Worth area (patio covers, outdoor kitchens, fireplaces, fire pits, TV walls). You write task names in Spanish, short and clear, like a project manager would.';
  const text = `Create a realistic, ordered work plan for this job.
Job: ${job.client_name} · type: ${job.project_type} · contract: $${(job.quoted_cents / 100).toFixed(0)}
Description / estimate: ${job.description || '(see attached estimate)'}
Approved change orders: ${cos.map(c => c.description).join('; ') || 'none'}
${extra ? 'Extra instructions from the owners: ' + extra : ''}
Available subs/crew (name — trade): ${workers.map(w => `${w.name} — ${w.trade || '?'}`).join('; ') || 'none listed'}
${templates.length ? 'Plans this company used before for similar jobs (use them as a guide for order and durations):\n' + templates.map(t => `- ${t.name}: ${JSON.parse(t.tasks).map(x => `${x.title} (${x.days}d)`).join(', ')}`).join('\n') : ''}
Rules: include permit and city inspections where they normally apply in Texas (footing, framing/rough electrical, final); include ordering long-lead materials early (granite, appliances, stone) with the date they are needed; keep each task to the trade that does it; durations in working days (whole numbers, minimum 1); 8 to 25 tasks.
Return ONLY JSON: {"tasks":[{"title": "...", "days": 2, "trade": "Concreto", "inspection": false, "materials": "material to order/receive for this task, or empty", "notes": "short note or empty"}], "warnings": ["anything the owners should double-check"]}`;
  const content = [];
  if (file) content.push(file.mime === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } } : { type: 'image', source: { type: 'base64', media_type: file.mime, data: file.data } });
  content.push({ type: 'text', text });
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': API_VERSION },
      body: JSON.stringify({ model: MODEL, max_tokens: 3000, system, messages: [{ role: 'user', content }] }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
    return (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  } finally { clearTimeout(timer); }
}
// Nunca se confía ciegamente en la respuesta: se limpia y se limita.
function parsePlan(txt) {
  const m = /\{[\s\S]*\}/.exec(String(txt || '')); if (!m) throw new Error('La AI no regresó un plan válido');
  let j; try { j = JSON.parse(m[0]); } catch { throw new Error('La AI no regresó un plan válido'); }
  const tasks = (Array.isArray(j.tasks) ? j.tasks : []).slice(0, 40).map(t => ({ title: String(t.title || '').trim().slice(0, 200), days: Math.max(1, Math.min(30, Math.round(Number(t.days) || 1))),
    trade: String(t.trade || '').slice(0, 60), inspection: !!t.inspection, materials: String(t.materials || '').slice(0, 200), notes: String(t.notes || '').slice(0, 300) })).filter(t => t.title);
  if (!tasks.length) throw new Error('La AI no regresó un plan válido');
  return { tasks, warnings: (Array.isArray(j.warnings) ? j.warnings : []).map(w => String(w).slice(0, 300)).slice(0, 8) };
}
// Fechas en días hábiles (sin domingos; sábados opcionales).
function schedule(start, tasks, { saturdays = false } = {}) {
  const work = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w !== 0 && (saturdays || w !== 6); };
  const next = d => new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  let d = start; while (!work(d)) d = next(d);
  return tasks.map(t => {
    const s = d; let e = d;
    for (let k = 1; k < t.days; k++) { e = next(e); while (!work(e)) e = next(e); }
    d = next(e); while (!work(d)) d = next(d);
    return { ...t, planned_date: s, planned_end: t.days > 1 ? e : '' };
  });
}

module.exports = { parsePlan, schedule, basePlan, daysFor, tradeFor };

module.exports.routes = function planRoutes(db, add, h, opts = {}) {
  const { requireRole, fail, str, date, intId, jobOr404, today } = h;
  const ai = opts.planAI || callAI;
  const workersList = () => db.prepare("SELECT id, name, trade FROM users WHERE role='worker' AND active=1 ORDER BY name").all();
  // Sugerir sub por oficio (primero los que ya trabajan en la obra).
  const suggest = (trade, jobId, workers) => {
    if (!trade) return null;
    const t = norm(trade).slice(0, 5);
    const onJob = new Set(db.prepare('SELECT user_id FROM subs WHERE job_id=? AND user_id IS NOT NULL').all(jobId).map(r => r.user_id));
    const match = workers.filter(w => w.trade && (norm(w.trade).includes(t) || t.includes(norm(w.trade).slice(0, 5))));
    return (match.find(w => onJob.has(w.id)) || match[0] || {}).id || null;
  };

  add('GET', '/api/plan/status', ({ user }) => { requireRole(user, 'owner'); return { ai: enabled() || !!opts.planAI, model: MODEL }; });

  add('POST', '/api/jobs/:id/plan/draft', async ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const workers = workersList();
    let plan, source;
    if (body.template_id) {
      const t = db.prepare('SELECT * FROM plan_templates WHERE id=?').get(intId(body.template_id)); if (!t) fail(404, 'Plantilla no encontrada');
      plan = { tasks: JSON.parse(t.tasks), warnings: [] }; source = 'template';
    } else if (enabled() || opts.planAI) {
      let file = null;
      if (body.file) {
        const m = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.file));
        if (!m) fail(400, 'El archivo del estimado debe ser PDF o foto');
        if (m[2].length > 14e6) fail(413, 'Archivo demasiado grande');
        file = { mime: m[1], data: m[2] };
      }
      if (!file && !(job.description || '').trim()) fail(400, 'Escriba la descripción del trabajo en la obra o suba el estimado (PDF o foto)');
      const cos = db.prepare("SELECT description FROM change_orders WHERE job_id=? AND status='aprobado'").all(job.id);
      const templates = db.prepare('SELECT * FROM plan_templates WHERE project_type=? ORDER BY id DESC LIMIT 3').all(job.project_type);
      try { plan = parsePlan(await ai({ job, cos, workers, templates, file, extra: str(body.extra, 1000) })); source = 'ai'; }
      catch (e) { plan = { tasks: basePlan(db, job), warnings: [`No se pudo usar la AI (${e.message}). Se propone el plan base del tipo de proyecto.`] }; source = 'base'; }
    } else { plan = { tasks: basePlan(db, job), warnings: [] }; source = 'base'; }
    const start = date(body.start_date, 'fecha de inicio') || job.start_date || today();
    const tasks = schedule(start, plan.tasks.map(t => ({ ...t, assignee_id: t.assignee_id || suggest(t.trade, job.id, workers) })), { saturdays: !!body.saturdays });
    return { source, start_date: start, tasks, warnings: plan.warnings, workers, end_date: tasks.length ? (tasks.at(-1).planned_end || tasks.at(-1).planned_date) : start,
      existing: db.prepare("SELECT COUNT(*) n, SUM(status='pendiente') p FROM tasks WHERE job_id=?").get(job.id) };
  });

  add('POST', '/api/jobs/:id/plan/apply', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const start = date(body.start_date, 'fecha de inicio') || today();
    const list = Array.isArray(body.tasks) ? body.tasks.slice(0, 60) : [];
    if (!list.length) fail(400, 'El plan no tiene tareas');
    const clean = list.map(t => ({ title: String(t.title || '').trim().slice(0, 200), days: Math.max(1, Math.min(60, Math.round(Number(t.days) || 1))),
      assignee_id: t.assignee_id ? intId(t.assignee_id) : null, notes: [str(t.notes, 300), t.materials ? 'Material: ' + str(t.materials, 200) : ''].filter(Boolean).join(' · '), inspection: !!t.inspection })).filter(t => t.title);
    for (const t of clean) if (t.assignee_id && !db.prepare("SELECT 1 FROM users WHERE id=? AND role='worker'").get(t.assignee_id)) fail(400, 'Sub no válido');
    const dated = schedule(start, clean, { saturdays: !!body.saturdays });
    return tx(db, () => {
      if (body.mode === 'replace') db.prepare("DELETE FROM tasks WHERE job_id=? AND status='pendiente'").run(job.id);
      let pos = db.prepare('SELECT COALESCE(MAX(position),0) m FROM tasks WHERE job_id=?').get(job.id).m;
      for (const t of dated) {
        pos += 10;
        db.prepare('INSERT INTO tasks(job_id,position,title,assignee_id,planned_date,planned_end,notes,days) VALUES(?,?,?,?,?,?,?,?)').run(job.id, pos, t.title, t.assignee_id, t.planned_date, t.planned_end, t.notes, t.days);
        if (t.inspection) db.prepare("INSERT INTO permits(job_id,kind,name,status,date,notes) VALUES(?,'inspeccion',?,'pendiente',?,'Creada por el plan de trabajo')").run(job.id, t.title, t.planned_date);
      }
      const end = dated.at(-1).planned_end || dated.at(-1).planned_date;
      db.prepare("UPDATE jobs SET start_date=CASE WHEN start_date='' OR ?='replace' THEN ? ELSE start_date END, end_date=? WHERE id=?").run(body.mode || '', start, end, job.id);
      return { ok: true, created: dated.length, end_date: end };
    });
  });

  add('GET', '/api/plan-templates', ({ user }) => { requireRole(user, 'owner'); return db.prepare('SELECT id, name, project_type, tasks, created_at FROM plan_templates ORDER BY project_type, name').all().map(t => ({ ...t, tasks: JSON.parse(t.tasks) })); });
  add('POST', '/api/plan-templates', ({ user, body }) => {
    requireRole(user, 'owner');
    const tasks = (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 60).map(t => ({ title: String(t.title || '').slice(0, 200), days: Math.max(1, Math.round(Number(t.days) || 1)), trade: String(t.trade || '').slice(0, 60), inspection: !!t.inspection, materials: String(t.materials || '').slice(0, 200) })).filter(t => t.title);
    if (!tasks.length) fail(400, 'El plan no tiene tareas');
    const type = C.PROJECT_TYPES.some(p => p.key === body.project_type) ? body.project_type : 'otro';
    const id = Number(db.prepare('INSERT INTO plan_templates(name,project_type,tasks,created_by) VALUES(?,?,?,?)').run(str(body.name, 120) || 'Plantilla', type, JSON.stringify(tasks), user.id).lastInsertRowid);
    return { id };
  });
  add('DELETE', '/api/plan-templates/:id', ({ user, params }) => { requireRole(user, 'owner'); db.prepare('DELETE FROM plan_templates WHERE id=?').run(intId(params.id)); return { ok: true }; });
};
