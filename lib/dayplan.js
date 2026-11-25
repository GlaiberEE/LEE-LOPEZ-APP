'use strict';
// Plan del día: cada persona (dueño, PM, vendedor, sub) arma la tarde anterior lo que va a hacer mañana.
//  - La app le sugiere lo que ya sabe: sus tareas de mañana, inspecciones, citas, seguimientos de ventas, pendientes y lo que quedó de hoy.
//  - Su jefe también le puede armar el plan: los dueños a cualquiera; el PM a los subs de sus obras. El vendedor y el sub, solo el suyo.
//  - Lo que pone el jefe queda marcado "lo pidió …" y la persona no lo borra: lo marca hecho o dice por qué no se pudo.
//  - A los subs (contratistas 1099) el plan es de tareas y obra, sin horario: la app no guarda hora cuando el jefe le pone algo a un sub.
//  - A las 5 PM llega el aviso de armar el plan de mañana. En la noche, lo que no se hizo pasa al día siguiente.
const TZ = process.env.APP_TZ || 'America/Chicago';
const todayL = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
const hourL = (now = new Date()) => Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }).format(now)) % 24;
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nextWorkday = iso => { let d = addDays(iso, 1); if (new Date(d + 'T12:00:00Z').getUTCDay() === 0) d = addDays(d, 1); return d; };
const meta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

// ¿Puede "me" armarle el plan a "target"?
function canPlan(db, me, targetId) {
  if (!targetId || targetId === me.id) return true;
  const t = db.prepare('SELECT id, role, active FROM users WHERE id=?').get(targetId);
  if (!t || !t.active || t.role === 'client') return false;
  if (me.role === 'owner' && !me.isPm) return true;
  const pmId = me.pmId || (me.role === 'pm' ? me.id : null);
  if (pmId && t.role === 'worker') {
    const all = (db.prepare('SELECT pm_all FROM users WHERE id=?').get(pmId) || {}).pm_all;
    return !!db.prepare(`SELECT 1 FROM jobs j WHERE j.status='activo' AND (${all ? '1=1' : 'j.pm_id=?'}) AND (EXISTS (SELECT 1 FROM tasks t WHERE t.job_id=j.id AND t.assignee_id=?) OR EXISTS (SELECT 1 FROM subs s WHERE s.job_id=j.id AND s.user_id=?))`)
      .get(...(all ? [] : [pmId]), targetId, targetId);
  }
  return false;
}
// A quién le puede armar el plan (para escoger persona).
function team(db, me) {
  const myId = me.pmId || me.id;
  return db.prepare("SELECT id, name, role FROM users WHERE active=1 AND is_agent=0 AND role<>'client' ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'pm' THEN 1 WHEN 'sales' THEN 2 ELSE 3 END, name").all()
    .filter(u => u.id === myId || canPlan(db, { ...me, id: myId }, u.id));
}

// Lo que la app ya sabe de esa persona para ese día.
function suggestions(db, u, date) {
  const out = [];
  const push = (ref, text, job_id, extra = {}) => out.push({ ref, text, job_id: job_id || null, job: job_id ? (db.prepare('SELECT client_name FROM jobs WHERE id=?').get(job_id) || {}).client_name : '', ...extra });
  const scope = u.role === 'pm' ? ((db.prepare('SELECT pm_all FROM users WHERE id=?').get(u.id) || {}).pm_all ? '1=1' : `j.pm_id=${Number(u.id)}`) : u.role === 'owner' ? '1=1' : '0=1';
  // Tareas: las suyas (sub) o las que arrancan ese día en sus obras (PM / dueño); también las atrasadas.
  const tq = u.role === 'worker'
    ? db.prepare(`SELECT t.id, t.title, t.job_id, t.planned_date FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE t.assignee_id=? AND t.status<>'hecho' AND j.status='activo' AND t.planned_date<>'' AND t.planned_date<=? ORDER BY t.planned_date, t.position`).all(u.id, date)
    : db.prepare(`SELECT t.id, t.title, t.job_id, t.planned_date FROM tasks t JOIN jobs j ON j.id=t.job_id WHERE ${scope} AND t.status<>'hecho' AND j.status='activo' AND (t.planned_date=? OR (t.planned_date<>'' AND t.planned_date<? AND t.status='pendiente')) AND t.inspection_type='' ORDER BY t.planned_date, t.position LIMIT 25`).all(date, date);
  for (const t of tq) push(`task:${t.id}`, t.title, t.job_id, { why: t.planned_date < date ? 'atrasada' : 'tarea' });
  // Inspecciones de ese día.
  if (u.role !== 'worker' && u.role !== 'sales') for (const p of db.prepare(`SELECT p.id, p.name, p.job_id FROM permits p JOIN jobs j ON j.id=p.job_id WHERE p.kind='inspeccion' AND p.date=? AND p.status NOT IN ('aprobado','rechazado') AND ${scope}`).all(date)) push(`insp:${p.id}`, p.name, p.job_id, { why: 'inspeccion' });
  // Citas y seguimientos (ventas y dueños con Ventas).
  for (const a of db.prepare("SELECT id, title, job_id, starts_at FROM appointments WHERE user_id=? AND substr(starts_at,1,10)=? ORDER BY starts_at").all(u.id, date)) push(`appt:${a.id}`, a.title, a.job_id, { why: 'cita', time: String(a.starts_at).slice(11, 16) });
  if (u.role === 'sales' || u.role === 'owner') for (const j of db.prepare("SELECT id, client_name FROM jobs WHERE follow_up_date=? AND status IN ('prospecto','cotizado') AND (sales_id=? OR ?)").all(date, u.id, u.role === 'owner' ? 1 : 0)) push(`follow:${j.id}`, `Seguimiento: ${j.client_name}`, j.id, { why: 'seguimiento' });
  // Lo que quedó sin hacer de antes.
  for (const p of db.prepare("SELECT * FROM plan_items WHERE user_id=? AND date<? AND status='pendiente' ORDER BY date, position").all(u.id, date)) push(`carry:${p.id}`, p.text, p.job_id, { why: 'quedo' });
  const have = new Set(db.prepare('SELECT ref FROM plan_items WHERE user_id=? AND date=?').all(u.id, date).map(r => r.ref).filter(Boolean));
  return out.filter(s => !have.has(s.ref));
}

function items(db, userId, date) {
  return db.prepare(`SELECT p.*, j.client_name job, a.name assigned_by_name FROM plan_items p LEFT JOIN jobs j ON j.id=p.job_id LEFT JOIN users a ON a.id=p.assigned_by
    WHERE p.user_id=? AND p.date=? ORDER BY CASE WHEN p.time='' THEN 1 ELSE 0 END, p.time, p.position, p.id`).all(userId, date);
}

// A las 5 PM: aviso de armar el plan de mañana. En la noche: lo que no se hizo pasa al siguiente día hábil.
function tick(db, now = new Date()) {
  const d = todayL(now), h = hourL(now);
  const { notify } = require('./push');
  let n = 0;
  if (h >= 17 && meta(db, 'plan_rem_' + d) !== '1') {
    setMeta(db, 'plan_rem_' + d, '1');
    const to = db.prepare("SELECT id FROM users WHERE active=1 AND is_agent=0 AND role IN ('owner','pm','sales')").all().map(r => r.id);
    if (to.length) { notify(db, to, 'plan_reminder', { d: nextWorkday(d).slice(5).replace('-', '/') }, '#/plan?d=manana'); n += to.length; }
  }
  if (h >= 22 || h < 5) {
    const day = h < 5 ? addDays(d, -1) : d;
    for (const p of db.prepare("SELECT * FROM plan_items WHERE date<=? AND status='pendiente'").all(day)) {
      const to = nextWorkday(day);
      db.prepare("INSERT INTO plan_items(user_id,date,text,job_id,ref,time,position,assigned_by,created_by,carried_from) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(p.user_id, to, p.text, p.job_id, p.ref, p.time, p.position, p.assigned_by, p.created_by, p.id);
      db.prepare("UPDATE plan_items SET status='movido' WHERE id=?").run(p.id);
      n++;
    }
  }
  return n;
}

function routes(db, add, h) {
  const { requireRole, fail, str, date, intId } = h;
  const { notify } = require('./push');
  const meId = u => u.pmId || u.id;
  const me = u => ({ ...u, id: meId(u) });
  const target = (user, q) => { const id = q ? intId(q) : meId(user); if (!canPlan(db, me(user), id)) fail(403, 'No puede armar el plan de esa persona'); return db.prepare('SELECT id, name, role FROM users WHERE id=?').get(id); };
  const pickDate = v => v === 'hoy' || !v ? todayL() : v === 'manana' ? nextWorkday(todayL()) : date(v, 'fecha');
  const itemOr404 = (user, id) => { const it = db.prepare('SELECT * FROM plan_items WHERE id=?').get(intId(id)); if (!it || !canPlan(db, me(user), it.user_id)) fail(404, 'No encontrado'); return it; };

  add('GET', '/api/plan', ({ user, query }) => {
    requireRole(user, 'owner', 'pm', 'sales', 'worker');
    const t = target(user, query.get('user_id'));
    const d = pickDate(query.get('d'));
    const list = items(db, t.id, d);
    return { user: t, date: d, today: todayL(), tomorrow: nextWorkday(todayL()), mine: t.id === meId(user), items: list, suggestions: suggestions(db, t, d),
      done: list.filter(i => i.status === 'hecho').length, total: list.filter(i => i.status !== 'movido').length, team: user.role === 'owner' || user.role === 'pm' ? team(db, user) : [] };
  });
  add('POST', '/api/plan/items', ({ user, body }) => {
    requireRole(user, 'owner', 'pm', 'sales', 'worker');
    const t = target(user, body.user_id);
    const d = pickDate(body.date);
    const text = str(body.text, 300).trim(); if (text.length < 2) fail(400, 'Escriba qué va a hacer');
    const boss = t.id !== meId(user);
    // A un sub, su jefe le pone tareas y obra, no horario.
    const time = boss && t.role === 'worker' ? '' : /^\d{2}:\d{2}$/.test(String(body.time || '')) ? body.time : '';
    const job = body.job_id ? intId(body.job_id) : null;
    const pos = (db.prepare('SELECT MAX(position) m FROM plan_items WHERE user_id=? AND date=?').get(t.id, d).m || 0) + 10;
    const id = Number(db.prepare('INSERT INTO plan_items(user_id,date,text,job_id,ref,time,position,assigned_by,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(t.id, d, text, job, str(body.ref, 60), time, pos, boss ? meId(user) : null, meId(user)).lastInsertRowid);
    // Lo que venía de un día anterior ya no queda pendiente allá.
    const cm = /^carry:(\d+)$/.exec(String(body.ref || '')); if (cm) db.prepare("UPDATE plan_items SET status='movido' WHERE id=? AND user_id=? AND status='pendiente'").run(Number(cm[1]), t.id);
    if (boss) notify(db, t.id, 'plan_assigned', { who: user.name, x: text, d: d.slice(5).replace('-', '/') }, '#/plan?d=' + d);
    return db.prepare('SELECT * FROM plan_items WHERE id=?').get(id);
  });
  add('PUT', '/api/plan/items/:id', ({ user, params, body }) => {
    requireRole(user, 'owner', 'pm', 'sales', 'worker');
    const it = itemOr404(user, params.id);
    const mine = it.user_id === meId(user), creator = it.created_by === meId(user);
    const f = {};
    if ('status' in body) {
      if (!['pendiente', 'hecho', 'no'].includes(body.status)) fail(400, 'Estado inválido');
      if (body.status === 'no' && String(body.reason || '').trim().length < 3) fail(400, 'Diga por qué no se pudo');
      f.status = body.status; f.reason = body.status === 'no' ? str(body.reason, 200) : ''; f.done_at = body.status === 'hecho' ? new Date().toISOString() : '';
    }
    if ('time' in body && (mine || creator)) {
      const tu = db.prepare('SELECT role FROM users WHERE id=?').get(it.user_id) || {};
      f.time = !mine && tu.role === 'worker' ? '' : /^\d{2}:\d{2}$/.test(String(body.time || '')) ? body.time : '';
    }
    if ('position' in body) f.position = Math.round(Number(body.position) || 0);
    if ('text' in body) { if (!creator) fail(403, 'Lo que puso su jefe no se cambia; márquelo hecho o diga por qué no se pudo'); f.text = str(body.text, 300) || it.text; }
    const cols = Object.keys(f);
    if (cols.length) db.prepare(`UPDATE plan_items SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`).run(...cols.map(k => f[k]), it.id);
    // El jefe se entera de lo que no se pudo.
    if (f.status === 'no' && it.assigned_by && it.assigned_by !== meId(user)) notify(db, it.assigned_by, 'plan_missed', { who: user.name, x: it.text, n: f.reason }, '#/plan?user_id=' + it.user_id + '&d=' + it.date);
    return db.prepare('SELECT * FROM plan_items WHERE id=?').get(it.id);
  });
  add('DELETE', '/api/plan/items/:id', ({ user, params }) => {
    requireRole(user, 'owner', 'pm', 'sales', 'worker');
    const it = itemOr404(user, params.id);
    if (it.assigned_by && it.assigned_by !== meId(user) && !(user.role === 'owner' && !user.isPm)) fail(403, 'Lo que puso su jefe no se borra; márquelo hecho o diga por qué no se pudo');
    db.prepare('DELETE FROM plan_items WHERE id=?').run(it.id);
    return { ok: true };
  });
  // Cómo va el plan del equipo (dueños y PM).
  add('GET', '/api/plan/team', ({ user, query }) => {
    requireRole(user, 'owner', 'pm');
    const d = pickDate(query.get('d'));
    return { date: d, people: team(db, user).map(u => { const l = items(db, u.id, d).filter(i => i.status !== 'movido'); return { ...u, total: l.length, done: l.filter(i => i.status === 'hecho').length, no: l.filter(i => i.status === 'no').length }; }) };
  });
}
module.exports = { routes, tick, canPlan, suggestions, nextWorkday };
