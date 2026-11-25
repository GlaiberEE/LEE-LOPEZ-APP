'use strict';
// v2.32: encuesta al cliente SOLO al terminar la obra.
//  - Cuando la obra queda "Terminada", se crea la encuesta: un enlace propio (sin contraseña) y un texto listo para mandar.
//  - 5 preguntas de estrellas (limpieza, puntualidad, comunicación, calidad, trato de la cuadrilla), del 0 al 10 si nos
//    recomendaría, qué podemos mejorar y qué le gustó. Se contesta una vez.
//  - Las respuestas las leen SOLO los dueños (ni PM, ni oficina, ni subs). Al PM solo le llega el promedio de estrellas
//    para su calificación, sin comentarios.
//  - Si califica bajo, aviso inmediato a los dueños para llamarle. Si califica muy bien, se le ofrece la reseña de Google.
const crypto = require('node:crypto');

const TZ = 'America/Chicago';
const todayL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const Q = ['q_clean', 'q_time', 'q_comm', 'q_quality', 'q_crew'];
const meta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value || '';
const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
const first = n => String(n || '').trim().split(/\s+/)[0] || '';
const avgOf = r => { const v = Q.map(k => r[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const isLow = r => Q.some(k => r[k] != null && r[k] <= 2) || (avgOf(r) != null && avgOf(r) < 3.5) || (r.nps != null && r.nps <= 6);

function link(db, s) {
  const co = require('./company').info(db);
  return `${meta(db, 'public_url')}/encuesta.html?t=${s.token}${co.primary ? '' : '&co=' + co.key}`;
}
function smsBody(db, job, s, reminder) {
  const co = require('./company').info(db).name || 'Elevated Exteriors';
  const n = first(job.client_name), url = link(db, s);
  if (s.lang === 'es') return reminder
    ? `Hola ${n}, ¿nos regala 2 minutos? Su opinión sincera sobre su proyecto nos ayuda a mejorar: ${url}`
    : `Hola ${n}, gracias por confiar en ${co}. ¿Cómo le fue con su proyecto? Son 2 minutos y su opinión sincera nos ayuda a mejorar: ${url}`;
  return reminder
    ? `Hi ${n}, could you spare 2 minutes? Your honest feedback on your project helps us improve: ${url}`
    : `Hi ${n}, thank you for trusting ${co}. How did your project go? It takes 2 minutes and your honest feedback helps us improve: ${url}`;
}
function draft(db, job, s, reminder) {
  if (!job.client_phone) return;
  db.prepare(`INSERT INTO sms_drafts(ref,kind,phone,user_id,job_id,lang,body,for_date) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(ref) DO NOTHING`)
    .run(`encuesta:${job.id}:${reminder ? 'r' : '1'}`, 'encuesta', job.client_phone, job.client_user_id || null, job.id, s.lang, smsBody(db, job, s, reminder), '');
}

// Crea la encuesta de una obra terminada (si no existe). Regresa la encuesta.
function ensure(db, job) {
  let s = db.prepare('SELECT * FROM job_surveys WHERE job_id=?').get(job.id);
  if (s) return s;
  const lang = (job.client_user_id && (db.prepare('SELECT lang FROM users WHERE id=?').get(job.client_user_id) || {}).lang) || 'en';
  db.prepare('INSERT INTO job_surveys(job_id,token,lang) VALUES(?,?,?)').run(job.id, crypto.randomBytes(18).toString('base64url'), lang === 'es' ? 'es' : 'en');
  s = db.prepare('SELECT * FROM job_surveys WHERE job_id=?').get(job.id);
  draft(db, job, s, false);
  if (job.client_user_id) require('./push').notify(db, [job.client_user_id], 'survey_client', { who: job.client_name }, '#/');
  return s;
}

function tick(db) {
  let since = meta(db, 'survey_since');
  if (!since) { since = todayL(); setMeta(db, 'survey_since', since); } // las obras que ya estaban terminadas no reciben encuesta
  const jobs = db.prepare(`SELECT * FROM jobs WHERE status='terminado' AND completed_date<>'' AND completed_date>=?
    AND id NOT IN (SELECT job_id FROM job_surveys)`).all(since);
  for (const j of jobs) ensure(db, j);
  // Un solo recordatorio a los 3 días si no ha contestado.
  for (const s of db.prepare(`SELECT * FROM job_surveys WHERE answered_at='' AND reminded_at='' AND created_at<=datetime('now','-3 days')`).all()) {
    const j = db.prepare('SELECT * FROM jobs WHERE id=?').get(s.job_id); if (!j) continue;
    draft(db, j, s, true);
    db.prepare("UPDATE job_surveys SET reminded_at=datetime('now') WHERE job_id=?").run(s.job_id);
  }
}

function routes(db, add, h) {
  const { requireRole, fail, str, intId, jobOr404 } = h;
  const ownerOnly = user => { requireRole(user, 'owner'); if (user.isPm || user.isOffice || user.is_agent) fail(403, 'Las opiniones de los clientes solo las ven los dueños'); };
  const byToken = t => {
    const v = String(t || ''); if (!/^[A-Za-z0-9_-]{20,40}$/.test(v)) fail(404, 'Enlace no válido');
    const s = db.prepare('SELECT * FROM job_surveys WHERE token=?').get(v); if (!s) fail(404, 'Enlace no válido');
    return s;
  };
  const reviewFor = s => (avgOf(s) >= 4.5 && (s.nps == null || s.nps >= 9) ? meta(db, 'review_link') : '');

  // Público: la página de la encuesta.
  add('GET', '/api/public/survey/:token', ({ params }) => {
    const s = byToken(params.token);
    const j = db.prepare('SELECT client_name FROM jobs WHERE id=?').get(s.job_id) || {};
    const co = require('./company').info(db);
    return { company: co.name, client: first(j.client_name), lang: s.lang, answered: !!s.answered_at, review_link: s.answered_at ? reviewFor(s) : '' };
  });
  add('POST', '/api/public/survey/:token', ({ params, body }) => {
    const s = byToken(params.token);
    if (s.answered_at) fail(400, 'Esta encuesta ya se contestó. ¡Gracias!');
    const v = {};
    for (const k of Q) { const n = Number(body[k]); if (!Number.isInteger(n) || n < 1 || n > 5) fail(400, 'Conteste las 5 preguntas con estrellas'); v[k] = n; }
    const nps = body.nps === '' || body.nps == null ? null : Number(body.nps);
    if (nps != null && (!Number.isInteger(nps) || nps < 0 || nps > 10)) fail(400, 'Recomendación del 0 al 10');
    const r = { ...v, nps, improve: str(body.improve, 3000), liked: str(body.liked, 3000) };
    const low = isLow(r) ? 1 : 0;
    db.prepare(`UPDATE job_surveys SET answered_at=datetime('now'), q_clean=?, q_time=?, q_comm=?, q_quality=?, q_crew=?, nps=?, improve=?, liked=?, low=?, lang=? WHERE job_id=?`)
      .run(r.q_clean, r.q_time, r.q_comm, r.q_quality, r.q_crew, nps, r.improve, r.liked, low, ['es', 'en'].includes(body.lang) ? body.lang : s.lang, s.job_id);
    // Para la calificación del PM: solo el promedio de estrellas, sin comentarios.
    const stars = Math.max(1, Math.min(5, Math.round(avgOf(r))));
    db.prepare(`INSERT INTO job_ratings(job_id,user_id,stars,comment) VALUES(?,NULL,?,'') ON CONFLICT(job_id) DO UPDATE SET stars=excluded.stars, created_at=datetime('now')`).run(s.job_id, stars);
    db.prepare("UPDATE sms_drafts SET status='descartado', done_at=datetime('now') WHERE job_id=? AND kind='encuesta' AND status='pendiente'").run(s.job_id);
    const j = db.prepare('SELECT client_name FROM jobs WHERE id=?').get(s.job_id) || {};
    const P = require('./push');
    P.notify(db, P.owners(db), low ? 'survey_low' : 'survey', { who: j.client_name, x: avgOf(r).toFixed(1) }, '#/opiniones');
    return { ok: true, low: !!low, review_link: reviewFor(r) };
  });

  // Cliente con portal: ¿tiene encuesta por contestar?
  add('GET', '/api/jobs/:id/survey', ({ user, params }) => {
    requireRole(user, 'client', 'owner');
    const job = jobOr404(db, user, intId(params.id));
    if (user.role === 'owner') ownerOnly(user);
    let s = db.prepare('SELECT * FROM job_surveys WHERE job_id=?').get(job.id);
    if (!s && job.status === 'terminado' && job.completed_date >= (meta(db, 'survey_since') || '9999')) s = ensure(db, job);
    if (!s) return { survey: null };
    if (user.role === 'client') return { survey: { url: link(db, s).replace(/^https?:\/\/[^/]+/, ''), answered: !!s.answered_at } };
    return { survey: s };
  });

  // Dueños: la sección de opiniones.
  add('GET', '/api/surveys', ({ user }) => {
    ownerOnly(user);
    const rows = db.prepare(`SELECT s.*, j.client_name, j.project_type, j.completed_date, j.pm_id, p.name pm_name, f.name followed_name
      FROM job_surveys s JOIN jobs j ON j.id=s.job_id LEFT JOIN users p ON p.id=j.pm_id LEFT JOIN users f ON f.id=s.followed_by ORDER BY s.created_at DESC`).all();
    const done = rows.filter(r => r.answered_at);
    const avg = (list, k) => { const v = list.map(r => (k ? r[k] : avgOf(r))).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null; };
    const npsList = done.map(r => r.nps).filter(x => x != null);
    const nps = npsList.length ? Math.round((npsList.filter(x => x >= 9).length - npsList.filter(x => x <= 6).length) / npsList.length * 100) : null;
    const group = (keyOf, nameOf) => {
      const m = new Map();
      for (const r of done) for (const k of [].concat(keyOf(r) || [])) { if (!m.has(k)) m.set(k, { name: nameOf(r, k), list: [] }); m.get(k).list.push(r); }
      return [...m.values()].map(g => ({ name: g.name, n: g.list.length, avg: avg(g.list), low: g.list.filter(r => r.low).length })).sort((a, b) => (a.avg ?? 9) - (b.avg ?? 9));
    };
    const subsOf = jobId => db.prepare("SELECT DISTINCT u.id, u.name FROM tasks t JOIN users u ON u.id=t.assignee_id WHERE t.job_id=? AND u.role='worker'").all(jobId);
    const subMap = new Map(done.map(r => [r.job_id, subsOf(r.job_id)]));
    return {
      sent: rows.length, answered: done.length, avg: avg(done), nps,
      by_question: Object.fromEntries(Q.map(k => [k, avg(done, k)])),
      by_pm: group(r => (r.pm_id ? `pm${r.pm_id}` : 'none'), r => r.pm_name || ''),
      by_type: group(r => r.project_type, r => r.project_type),
      by_sub: group(r => subMap.get(r.job_id).map(u => `u${u.id}`), (r, k) => (subMap.get(r.job_id).find(u => `u${u.id}` === k) || {}).name || ''),
      to_call: done.filter(r => r.low && !r.followed_at).length,
      answers: done.map(r => ({ job_id: r.job_id, client_name: r.client_name, project_type: r.project_type, pm_name: r.pm_name || '', answered_at: r.answered_at, lang: r.lang,
        ...Object.fromEntries(Q.map(k => [k, r[k]])), avg: avg([r]), nps: r.nps, improve: r.improve, liked: r.liked, low: !!r.low,
        followed_at: r.followed_at, followed_name: r.followed_name || '', followed_note: r.followed_note, subs: subMap.get(r.job_id).map(u => u.name) })),
      unanswered: rows.filter(r => !r.answered_at).map(r => ({ job_id: r.job_id, client_name: r.client_name, created_at: r.created_at, reminded: !!r.reminded_at, url: link(db, r) })),
    };
  });
  add('POST', '/api/surveys/:id/followed', ({ user, params, body }) => {
    ownerOnly(user);
    const s = db.prepare('SELECT * FROM job_surveys WHERE job_id=?').get(intId(params.id)); if (!s) fail(404, 'No encontrado');
    db.prepare("UPDATE job_surveys SET followed_at=datetime('now'), followed_by=?, followed_note=? WHERE job_id=?").run(user.id, str(body.note, 1000), s.job_id);
    return { ok: true };
  });
}

module.exports = { tick, routes, ensure, isLow, avgOf, Q };
