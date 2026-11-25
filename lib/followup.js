'use strict';
// Seguimiento de pendientes:
//  - Recordatorio cuando un caso abierto pasa un rato sin respuesta (4 horas si es urgente, 24 si no).
//    Le llega a quien le toca contestar: si lo último lo escribió la empresa, a los subs del caso;
//    si no, al responsable (o al PM de la obra, o a los dueños).
//  - Si después de otro rato igual sigue sin respuesta, se avisa a los dueños.
//  - Cuando se pasa la fecha límite de un caso, avisa al responsable y a los dueños (una vez).
//  - "Mis pendientes": lo que le toca a cada persona, junto en una lista.
// Los avisos solo salen de 7 a.m. a 8 p.m. (hora de la empresa) para no despertar a nadie.
const { notify, owners } = require('./push');
const { membersOf } = require('./issues');

const TZ = () => process.env.APP_TZ || 'America/Chicago';
const localToday = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: TZ() });
const localHour = (now = new Date()) => Number(now.toLocaleString('en-US', { timeZone: TZ(), hour: 'numeric', hourCycle: 'h23' }));
const sqlNow = now => now.toISOString().replace('T', ' ').slice(0, 19);
const hoursBetween = (a, b) => (new Date(b.replace(' ', 'T') + 'Z') - new Date(a.replace(' ', 'T') + 'Z')) / 3600000;
const WAIT_URGENT = 4, WAIT_NORMAL = 24;

function lastMessage(db, issueId) {
  return db.prepare(`SELECT m.created_at, m.user_id, u.role FROM issue_messages m LEFT JOIN users u ON u.id=m.user_id
    WHERE m.issue_id=? AND m.visibility='interno' ORDER BY m.id DESC LIMIT 1`).get(issueId)
    || db.prepare('SELECT created_at, created_by user_id, created_role role FROM issues WHERE id=?').get(issueId);
}

// Se llama cada 5 minutos desde el servidor. `now` se puede pasar para las pruebas.
function tick(db, now = new Date(), { anyHour = false } = {}) {
  if (!anyHour) { const h = localHour(now); if (h < 7 || h >= 20) return { sent: 0 }; }
  const nowS = sqlNow(now), today = localToday(now);
  let sent = 0;
  const open = db.prepare("SELECT i.*, j.client_name, j.pm_id FROM issues i JOIN jobs j ON j.id=i.job_id WHERE i.status='abierto'").all();
  for (const i of open) {
    const wait = i.urgent ? WAIT_URGENT : WAIT_NORMAL;
    const last = lastMessage(db, i.id);
    const lastAt = last.created_at;
    const v = { x: i.title, job: i.client_name, h: wait };
    const companySaidLast = ['owner', 'pm'].includes(last.role);
    const workers = membersOf(db, i);
    const lead = i.assignee_id ? [i.assignee_id] : i.pm_id ? [i.pm_id] : owners(db);
    const toAnswer = (companySaidLast && workers.length ? workers : lead).filter(id => id !== last.user_id);
    // 1) recordatorio
    if (hoursBetween(lastAt, nowS) >= wait && (!i.reminded_at || i.reminded_at <= lastAt)) {
      if (toAnswer.length) { notify(db, toAnswer.filter(id => !workers.includes(id)), 'issue_remind', v, '#/casos'); notify(db, toAnswer.filter(id => workers.includes(id)), 'issue_remind', v, `#/obra/${i.job_id}`); sent++; }
      db.prepare('UPDATE issues SET reminded_at=? WHERE id=?').run(nowS, i.id);
      continue;
    }
    // 2) sigue sin respuesta otro rato igual → a los dueños
    if (i.reminded_at && i.reminded_at > lastAt && hoursBetween(i.reminded_at, nowS) >= wait && (!i.escalated_at || i.escalated_at <= lastAt)) {
      notify(db, owners(db), 'issue_escalate', { ...v, h: Math.round(hoursBetween(lastAt, nowS)) }, `#/casos`); sent++;
      db.prepare('UPDATE issues SET escalated_at=? WHERE id=?').run(nowS, i.id);
    }
  }
  // 3) fecha límite vencida (abiertos o esperando al cliente)
  const due = db.prepare("SELECT i.*, j.client_name FROM issues i JOIN jobs j ON j.id=i.job_id WHERE i.status<>'resuelto' AND i.due_date<>'' AND i.due_date<? AND i.due_notified<>i.due_date").all(today);
  for (const i of due) {
    const to = [...new Set([...(i.assignee_id ? [i.assignee_id] : []), ...owners(db)])];
    notify(db, to, 'issue_due', { x: i.title, job: i.client_name, d: i.due_date }, `#/casos`); sent++;
    db.prepare('UPDATE issues SET due_notified=due_date WHERE id=?').run(i.id);
  }
  return { sent };
}

// Lo que le toca a una persona. Para PM se usa su propio usuario (role 'pm').
function myPending(db, user) {
  const today = localToday();
  const uid = user.id, role = user.role;
  const items = [];
  const jobScope = role === 'pm'
    ? ((db.prepare('SELECT pm_all FROM users WHERE id=?').get(uid) || {}).pm_all ? '1=1' : `j.pm_id=${Number(uid)}`)
    : '1=1';
  // Casos
  let cases = db.prepare(`SELECT i.*, j.client_name FROM issues i JOIN jobs j ON j.id=i.job_id WHERE i.status<>'resuelto' AND ${jobScope} ORDER BY i.urgent DESC, i.updated_at DESC`).all();
  if (role === 'worker') cases = cases.filter(i => membersOf(db, i).includes(uid));
  for (const i of cases) {
    const last = lastMessage(db, i.id);
    const read = (db.prepare('SELECT last_msg_id FROM issue_reads WHERE issue_id=? AND user_id=?').get(i.id, uid) || {}).last_msg_id || 0;
    const visible = role === 'worker' ? "AND visibility='interno'" : '';
    const unread = db.prepare(`SELECT COUNT(*) n FROM issue_messages WHERE issue_id=? AND id>? AND (user_id IS NULL OR user_id<>?) ${visible}`).get(i.id, read, uid).n;
    const mine = i.assignee_id === uid;
    const yourTurn = role === 'worker' ? ['owner', 'pm'].includes(last.role) && i.status === 'abierto'
      : (mine || (!i.assignee_id && (role === 'owner' || role === 'pm'))) && i.status === 'abierto' && !['owner', 'pm'].includes(last.role);
    if (!(mine || unread || yourTurn)) continue;
    const why = unread ? 'unread' : yourTurn ? 'your_turn' : 'assigned';
    const tt = require('./translate').forReader(db, i.title, user.lang);
    items.push({ kind: 'case', id: i.id, job_id: i.job_id, job: i.client_name, title: i.title, title_tr: tt && tt.tr ? tt.tr : undefined, urgent: !!i.urgent, due: i.due_date || '', overdue: !!i.due_date && i.due_date < today,
      why, mine, unread, waiting_client: i.status === 'esperando_cliente' });
  }
  // v2.35: selecciones del cliente que se vencen en 3 días, ya atrasadas o cambiadas después de aprobar.
  if (role === 'owner' || role === 'pm') {
    try {
      const mine = new Set(db.prepare(`SELECT j.id FROM jobs j WHERE ${jobScope}${role === 'owner' ? ' AND j.pm_id IS NULL' : ''}`).all().map(r => r.id));
      for (const s of require('./selections').due(db, today)) if (mine.has(s.job_id))
        items.push({ kind: 'selection', id: s.id, job_id: s.job_id, job: s.client_name, title: user.lang === 'en' ? s.en : s.es, urgent: s.blocks, overdue: s.late || s.changed, due: s.need_by, changed: s.changed, blocks: s.blocks });
    } catch (e) { console.error('[pendientes selecciones]', e.message); }
  }
  // Permisos aprobados sin las inspecciones que pidió la ciudad: hay que capturarlas para ponerlas en el schedule.
  if (role === 'owner' || role === 'pm') {
    for (const p of db.prepare(`SELECT p.id, p.name, p.job_id, j.client_name FROM permits p JOIN jobs j ON j.id=p.job_id
      WHERE p.kind='permiso' AND p.status='aprobado' AND p.inspections_set=0 AND j.status NOT IN ('terminado','cancelado') AND ${jobScope}`).all())
      items.push({ kind: 'permit_insp', id: p.id, job_id: p.job_id, job: p.client_name, title: p.name, urgent: false, overdue: true, due: '' });
  }
  // Fase 5: inspecciones con fecha pasada y sin resultado (pasó / no pasó).
  if (role === 'owner' || role === 'pm') {
    const I = require('./inspections');
    for (const p of I.noResult(db)) {
      if (role === 'pm' && !db.prepare(`SELECT 1 FROM jobs j WHERE j.id=? AND ${jobScope}`).get(p.job_id)) continue;
      items.push({ kind: 'insp_result', id: p.id, job_id: p.job_id, job: p.client_name, title: p.name, due: p.date, overdue: true, urgent: true });
    }
  }
  // Fila de espera: le preguntaron al sub si puede empezar un trabajo.
  if (role === 'worker') {
    for (const q of db.prepare(`SELECT q.id, q.job_id, q.needed_date, j.client_name FROM job_queue_subs q JOIN jobs j ON j.id=q.job_id
      WHERE q.user_id=? AND q.asked_at<>'' AND q.answer='' AND j.status='activo' AND j.queue_state='propuesto'`).all(uid))
      items.push({ kind: 'avail', id: q.id, job_id: q.job_id, job: q.client_name, title: q.client_name, due: q.needed_date, overdue: false, urgent: true });
  }
  // Fase 5: el sub ve lo que le toca confirmar con foto del rough-in antes de que se cierre.
  if (role === 'worker') {
    const mine = String((db.prepare('SELECT trades FROM users WHERE id=?').get(uid) || {}).trades || '').split(',').filter(Boolean);
    for (const it of db.prepare(`SELECT r.id, r.key, r.label, r.trade, r.job_id, j.client_name FROM roughin_items r JOIN jobs j ON j.id=r.job_id
      WHERE r.status='pendiente' AND j.status='activo' AND EXISTS (SELECT 1 FROM tasks t WHERE t.job_id=r.job_id AND t.assignee_id=?)`).all(uid)) {
      if (it.trade && !mine.includes(it.trade) && !db.prepare('SELECT 1 FROM tasks WHERE job_id=? AND assignee_id=? AND trade=?').get(it.job_id, uid, it.trade)) continue;
      const d = require('./roughin').DEFAULTS.find(x => x.key === it.key);
      items.push({ kind: 'roughin', id: it.id, job_id: it.job_id, job: it.client_name, title: it.label || (d ? d[user.lang === 'en' ? 'en' : 'es'] : it.key), due: '', overdue: false });
    }
  }
  // Tareas: el sub ve las suyas de hoy o atrasadas; el PM ve las atrasadas de sus obras.
  // Un dueño que es encargado (PM) de alguna obra también ve las tareas atrasadas de esas obras.
  const ownerPm = role === 'owner' && !!db.prepare("SELECT 1 FROM jobs WHERE pm_id=? AND status='activo'").get(uid);
  if (role === 'worker' || role === 'pm' || ownerPm) {
    const scope = role === 'worker' ? `t.assignee_id=${Number(uid)} AND t.planned_date<=?` : `${ownerPm ? `j.pm_id=${Number(uid)}` : jobScope} AND t.planned_date<?`;
    const tasks = db.prepare(`SELECT t.id, t.title, t.planned_date, t.status, t.job_id, j.client_name, u.name who FROM tasks t JOIN jobs j ON j.id=t.job_id LEFT JOIN users u ON u.id=t.assignee_id
      WHERE j.status='activo' AND t.status<>'hecho' AND t.planned_date<>'' AND ${scope}
      ORDER BY t.planned_date LIMIT 30`).all(today);
    for (const t of tasks) items.push({ kind: 'task', id: t.id, job_id: t.job_id, job: t.client_name, title: t.title, due: t.planned_date, overdue: t.planned_date < today, who: role !== 'worker' ? t.who || '' : '' });
  }
  const rank = x => (x.urgent ? 0 : 2) + (x.overdue ? 0 : 1) + (x.kind === 'case' ? 0 : 0.5);
  return items.sort((a, b) => rank(a) - rank(b) || String(a.due || '9').localeCompare(String(b.due || '9')));
}

// Cuántos casos tiene alguien a su cargo con algo que hacer (suma al número rojo de Inicio).
function assignedCount(db, uid) {
  return db.prepare("SELECT COUNT(*) n FROM issues WHERE assignee_id=? AND status<>'resuelto' AND (due_date<>'' AND due_date<?)").get(uid, localToday()).n;
}

function routes(db, add, { requireRole }) {
  add('GET', '/api/my-pending', ({ user }) => {
    requireRole(user, 'owner', 'pm', 'worker');
    return myPending(db, user);
  });
}

module.exports = { tick, myPending, assignedCount, routes, localToday };
