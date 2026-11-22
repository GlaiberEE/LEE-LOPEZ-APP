'use strict';
// 1) Publicidad: cuánto se gasta por canal y cuánto cuesta cada cliente ganado.
// 2) Cierre de obra: lista de pendientes final y firma del cliente "recibí la obra terminada"; al firmar se le pide la reseña.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { notify, owners } = require('./push');

const TZ = process.env.APP_TZ || 'America/Chicago';
const todayL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const getMeta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const CHANNELS = ['Google', 'Referido', 'Facebook / Instagram', 'Página web', 'Nextdoor', 'Letrero / volante', 'Otro'];
const norm = s => { const x = String(s || '').trim(); if (!x) return 'Sin fuente'; const l = x.toLowerCase();
  if (/google|search|gbp|maps/.test(l)) return 'Google'; if (/refer|recom|amig|word/.test(l)) return 'Referido'; if (/face|insta|meta|fb/.test(l)) return 'Facebook / Instagram';
  if (/^web$|página|pagina|website|cotizar/.test(l)) return 'Página web'; if (/nextdoor/.test(l)) return 'Nextdoor'; if (/letrero|volante|yard|sign|flyer/.test(l)) return 'Letrero / volante';
  return x.slice(0, 40); };

module.exports = function growthRoutes(db, add, h) {
  const { requireRole, fail, str, intId, need, jobOr404, canSeeJob, sigDir } = h;
  const owner = u => { requireRole(u, 'owner'); if (u.isPm || u.is_agent) fail(403, 'Esto solo lo pueden hacer los dueños'); };

  // ===== publicidad =====
  add('GET', '/api/marketing', ({ user, query }) => {
    owner(user);
    const months = Math.min(24, Math.max(1, Number(query.get('months')) || 6));
    const t = todayL(); const d = new Date(t.slice(0, 7) + '-01T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - (months - 1));
    const from = d.toISOString().slice(0, 7);
    const C = new Map();
    const ch = k => { const n = norm(k); if (!C.has(n)) C.set(n, { channel: n, spend_cents: 0, leads: 0, sent: 0, won: 0, won_cents: 0 }); return C.get(n); };
    for (const r of db.prepare('SELECT channel, SUM(amount_cents) c FROM marketing_spend WHERE month>=? GROUP BY channel').all(from)) ch(r.channel).spend_cents += r.c;
    for (const j of db.prepare("SELECT lead_source, created_at, estimate_sent_date, won_date, quoted_cents, status FROM jobs").all()) {
      const ld = (j.created_at || '').slice(0, 7);
      if (ld >= from) ch(j.lead_source).leads++;
      if ((j.estimate_sent_date || '').slice(0, 7) >= from) ch(j.lead_source).sent++;
      if ((j.won_date || '').slice(0, 7) >= from && j.status !== 'cancelado') { const c = ch(j.lead_source); c.won++; c.won_cents += j.quoted_cents || 0; }
    }
    const rows = [...C.values()].map(c => ({ ...c, cost_per_lead_cents: c.leads && c.spend_cents ? Math.round(c.spend_cents / c.leads) : null,
      cost_per_won_cents: c.won && c.spend_cents ? Math.round(c.spend_cents / c.won) : null, close_pct: c.sent ? Math.round(c.won / c.sent * 100) : null,
      return_x: c.spend_cents ? Math.round(c.won_cents / c.spend_cents * 10) / 10 : null })).filter(c => c.spend_cents || c.leads || c.won)
      .sort((a, b) => b.won_cents - a.won_cents || b.leads - a.leads);
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    return { from, months, channels_known: [...new Set([...CHANNELS, ...rows.map(r => r.channel).filter(c => c !== 'Sin fuente')])], rows,
      totals: { spend_cents: sum('spend_cents'), leads: sum('leads'), sent: sum('sent'), won: sum('won'), won_cents: sum('won_cents') },
      spends: db.prepare('SELECT id, month, channel, amount_cents, note FROM marketing_spend WHERE month>=? ORDER BY month DESC, channel').all(from) };
  });
  add('POST', '/api/marketing/spend', ({ user, body }) => {
    owner(user);
    const month = /^\d{4}-\d{2}$/.test(String(body.month)) ? body.month : fail(400, 'Mes inválido');
    const channel = norm(need(body.channel, 'canal', 40));
    const amount = h.cents(body.amount_cents ?? 0, 'monto'); if (!amount) fail(400, 'Escriba el monto');
    const id = Number(db.prepare('INSERT INTO marketing_spend(month,channel,amount_cents,note,created_by) VALUES(?,?,?,?,?)').run(month, channel, amount, str(body.note, 200), user.id).lastInsertRowid);
    return { ok: true, id };
  });
  add('DELETE', '/api/marketing/spend/:id', ({ user, params }) => {
    owner(user);
    db.prepare('DELETE FROM marketing_spend WHERE id=?').run(intId(params.id));
    return { ok: true };
  });

  // ===== cierre de obra =====
  const items = jobId => db.prepare('SELECT id, text, status, done_at FROM punch_items WHERE job_id=? ORDER BY position, id').all(jobId);
  add('GET', '/api/jobs/:id/closeout-list', ({ user, params }) => {
    requireRole(user, 'owner', 'client');
    const job = jobOr404(db, user, intId(params.id));
    return { items: items(job.id), requested: !!job.closeout_requested_at, signed: job.closeout_signed_at ? { name: job.closeout_signer, at: job.closeout_signed_at } : null,
      link: job.proposal_token ? `/propuesta.html?t=${job.proposal_token}${require('./company').info(db).primary ? '' : '&co=' + require('./company').info(db).key}` : '' };
  });
  add('POST', '/api/jobs/:id/punch', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    if (job.closeout_signed_at) fail(400, 'El cliente ya firmó la entrega');
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM punch_items WHERE job_id=?').get(job.id).p;
    const id = Number(db.prepare('INSERT INTO punch_items(job_id,text,position,created_by) VALUES(?,?,?,?)').run(job.id, need(body.text, 'pendiente', 300), pos, user.id).lastInsertRowid);
    return { ok: true, id };
  });
  add('PUT', '/api/punch/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const it = db.prepare('SELECT * FROM punch_items WHERE id=?').get(intId(params.id)); if (!it) fail(404, 'No encontrado');
    jobOr404(db, user, it.job_id);
    if ('status' in body) db.prepare("UPDATE punch_items SET status=?, done_at=CASE WHEN ?='hecho' THEN datetime('now') ELSE '' END WHERE id=?").run(body.status === 'hecho' ? 'hecho' : 'pendiente', body.status, it.id);
    if ('text' in body) db.prepare('UPDATE punch_items SET text=? WHERE id=?').run(need(body.text, 'pendiente', 300), it.id);
    return { ok: true };
  });
  add('DELETE', '/api/punch/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const it = db.prepare('SELECT * FROM punch_items WHERE id=?').get(intId(params.id)); if (!it) fail(404, 'No encontrado');
    jobOr404(db, user, it.job_id);
    db.prepare('DELETE FROM punch_items WHERE id=?').run(it.id);
    return { ok: true };
  });
  add('POST', '/api/jobs/:id/closeout-request', ({ user, params }) => {
    requireRole(user, 'owner'); if (user.is_agent) fail(403, 'Esto solo lo pueden hacer los dueños');
    const job = jobOr404(db, user, intId(params.id));
    if (job.closeout_signed_at) fail(400, 'El cliente ya firmó la entrega');
    if (items(job.id).some(i => i.status !== 'hecho')) fail(400, 'Termine primero todos los pendientes de la lista');
    if (!job.proposal_token) db.prepare('UPDATE jobs SET proposal_token=? WHERE id=?').run(job.proposal_token = crypto.randomBytes(18).toString('base64url'), job.id);
    db.prepare("UPDATE jobs SET closeout_requested_at=datetime('now') WHERE id=?").run(job.id);
    const co = require('./company').info(db);
    const lang = (job.client_user_id && (db.prepare('SELECT lang FROM users WHERE id=?').get(job.client_user_id) || {}).lang) || 'en';
    return { url: `/propuesta.html?t=${job.proposal_token}${co.primary ? '' : '&co=' + co.key}`, client_name: job.client_name, client_phone: job.client_phone, client_email: job.client_email, company: co.name, client_lang: lang };
  });

  // Público: el cliente firma la entrega desde el mismo enlace de su propuesta.
  const byToken = t => { const s = String(t || ''); if (!/^[A-Za-z0-9_-]{20,40}$/.test(s)) fail(404, 'Enlace no válido'); const j = db.prepare('SELECT * FROM jobs WHERE proposal_token=?').get(s); if (!j) fail(404, 'Enlace no válido'); return j; };
  add('GET', '/api/public/closeout/:token', ({ params }) => {
    const job = byToken(params.token);
    return { requested: !!job.closeout_requested_at, items: items(job.id).map(i => ({ text: i.text, done: i.status === 'hecho' })),
      can_sign: !!job.closeout_requested_at && !job.closeout_signed_at && !items(job.id).some(i => i.status !== 'hecho'),
      signed: job.closeout_signed_at ? { name: job.closeout_signer, at: job.closeout_signed_at } : null, review_link: getMeta(db, 'review_link') || '' };
  });
  add('POST', '/api/public/closeout/:token/sign', ({ params, body, ip }) => {
    const job = byToken(params.token);
    if (!job.closeout_requested_at) fail(400, 'Todavía no se ha pedido la firma de entrega');
    if (job.closeout_signed_at) fail(400, 'La entrega ya está firmada');
    if (items(job.id).some(i => i.status !== 'hecho')) fail(400, 'Todavía hay pendientes en la lista');
    if (body.agree !== true) fail(400, 'Debe aceptar firmar electrónicamente');
    const name = need(body.name, 'nombre completo', 120);
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.signature || ''));
    if (!m) fail(400, 'Falta la firma');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 500 || buf.length > 600 * 1024 || buf[0] !== 0xff || buf[1] !== 0xd8) fail(400, 'Falta la firma');
    fs.mkdirSync(sigDir, { recursive: true }); fs.writeFileSync(path.join(sigDir, `closeout-${job.id}.jpg`), buf);
    const t = todayL();
    db.prepare("UPDATE jobs SET closeout_signed_at=datetime('now'), closeout_signer=?, closeout_ip=?, status='terminado', completed_date=CASE WHEN completed_date='' THEN ? ELSE completed_date END WHERE id=?")
      .run(name, String(ip || '').slice(0, 60), t, job.id);
    db.prepare("INSERT INTO followups(job_id,kind) VALUES(?, 'review') ON CONFLICT(job_id,kind) DO NOTHING").run(job.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary) VALUES(NULL,'crear','entrega',?,?,?)").run(job.id, job.id, `El cliente firmó la entrega de la obra: ${name}`);
    notify(db, owners(db), 'signed', { who: name, x: 'la entrega de la obra', job: job.client_name }, `#/obra/${job.id}`);
    return { ok: true, review_link: getMeta(db, 'review_link') || '' };
  });
  add('GET', '/api/jobs/:id/closeout-signature', ({ user, params }) => {
    requireRole(user, 'owner', 'client');
    const job = jobOr404(db, user, intId(params.id));
    const f = path.join(sigDir, `closeout-${job.id}.jpg`); if (!fs.existsSync(f)) fail(404, 'No encontrado');
    return { $buffer: fs.readFileSync(f), $type: 'image/jpeg', $name: `entrega-${job.id}.jpg` };
  });
};
module.exports.norm = norm;
