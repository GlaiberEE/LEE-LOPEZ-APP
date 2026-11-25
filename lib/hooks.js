'use strict';
// Fase 8, parte 2 — Webhooks: la app le avisa sola a otro sistema (su agente Grok, Zapier, Google Sheets…) cuando pasa algo.
//  - Los manejan solo los dueños. Cada conexión tiene su dirección https y una clave secreta para firmar:
//    cada aviso lleva X-EE-Signature: sha256=<HMAC del cuerpo con la clave>, para que el otro sistema compruebe que es de la app.
//  - Se escoge qué eventos manda cada conexión (o todos). Si falla, se reintenta 2 veces; queda bitácora de cada envío.
//  - No se mandan a direcciones internas (localhost, 10.x, 192.168.x…). Solo https.
const crypto = require('node:crypto');

const EVENTS = {
  'job.created': ['Obra nueva', 'New job'], 'job.updated': ['Obra cambió de estado', 'Job status changed'],
  'task.done': ['Tarea terminada', 'Task finished'], 'inspection.result': ['Resultado de inspección', 'Inspection result'],
  'change_order.created': ['Change order nuevo', 'New change order'], 'change_order.updated': ['Change order aprobado o cambiado', 'Change order approved or changed'],
  'expense.created': ['Gasto registrado', 'Expense recorded'], 'receipt.created': ['Ticket registrado', 'Receipt recorded'],
  'payment.received': ['Pago del cliente', 'Client payment'], 'case.opened': ['Caso abierto', 'Case opened'],
  'daily_report.created': ['Reporte del día', 'Daily report'], 'month.closed': ['Mes cerrado', 'Month closed'],
  'digest': ['Resumen de la mañana (para agentes)', 'Morning summary (for agents)'], 'test': ['Prueba', 'Test'],
};
// Qué ruta dispara qué evento (después de que se guardó; lo que espera aprobación no se manda).
const ROUTES = {
  'POST /api/jobs': 'job.created', 'POST /api/permits/:id/result': 'inspection.result', 'POST /api/jobs/:id/changes': 'change_order.created', 'PUT /api/changes/:id': 'change_order.updated',
  'POST /api/jobs/:id/expenses': 'expense.created', 'POST /api/receipts': 'receipt.created', 'POST /api/jobs/:id/payments': 'payment.received',
  'POST /api/issues': 'case.opened', 'POST /api/jobs/:id/logs': 'daily_report.created', 'PUT /api/lock': 'month.closed',
};
const KEEP = ['id', 'job_id', 'status', 'title', 'description', 'vendor', 'ticket', 'date', 'amount_cents', 'price_cents', 'total_cents', 'method', 'result', 'code', 'name', 'client_name', 'urgent', 'kind', 'fail_reason', 'inspector'];
const pick = o => { const out = {}; if (o && typeof o === 'object') for (const k of KEEP) if (o[k] !== undefined && typeof o[k] !== 'object') out[k] = o[k]; return out; };

function safeUrl(u) {
  let x; try { x = new URL(String(u || '')); } catch { return null; }
  if (x.protocol !== 'https:') return null;
  const h = x.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '[::1]' || /^\[?(fc|fd|fe80)/.test(h)) return null;
  return x.toString();
}

let sender = async (url, body, headers) => {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 10000);
  try { const r = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal, redirect: 'manual' }); return r.status; } finally { clearTimeout(timer); }
};
const setSender = fn => { sender = fn; };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function deliver(db, h, event, data) {
  const co = require('./company').info(db);
  const body = JSON.stringify({ event, company: co.key, company_name: co.name, at: new Date().toISOString(), data });
  const sig = 'sha256=' + crypto.createHmac('sha256', h.secret).update(body).digest('hex');
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'LeeLopezApp-Webhook/1', 'X-EE-Event': event, 'X-EE-Signature': sig };
  let code = 0, err = '', tries = 0;
  for (const delay of [0, 2000, 10000]) {
    if (delay) await wait(process.env.NODE_TEST_CONTEXT ? 5 : delay);
    tries++;
    try { code = await sender(h.url, body, headers); err = ''; if (code >= 200 && code < 300) break; } catch (e) { code = 0; err = String(e.message || e).slice(0, 200); }
  }
  const ok = code >= 200 && code < 300;
  try {
    db.prepare('INSERT INTO webhook_log(hook_id,event,code,ok,tries,error,body) VALUES(?,?,?,?,?,?,?)').run(h.id, event, code, ok ? 1 : 0, tries, err, body.slice(0, 2000));
    db.prepare("UPDATE webhooks SET last_at=datetime('now'), last_code=?, fails=CASE WHEN ? THEN 0 ELSE fails+1 END WHERE id=?").run(code, ok ? 1 : 0, h.id);
    db.prepare('DELETE FROM webhook_log WHERE hook_id=? AND id NOT IN (SELECT id FROM webhook_log WHERE hook_id=? ORDER BY id DESC LIMIT 200)').run(h.id, h.id);
  } catch { /* la base pudo cerrarse */ }
  return { ok, code, tries, error: err };
}

// Mandar un evento a las conexiones que lo piden. No detiene a quien lo llama.
function emit(db, event, data) {
  let hooks = [];
  try { hooks = db.prepare('SELECT * FROM webhooks WHERE active=1').all(); } catch { return 0; }
  const want = h => h.events === '*' || String(h.events).split(',').includes(event);
  const list = hooks.filter(h => event !== 'test' && want(h));
  for (const h of list) deliver(db, h, event, data).catch(() => {});
  return list.length;
}
// Después de una ruta que cambió algo.
function after(db, key, ctx, res) {
  let ev = ROUTES[key];
  if (key === 'PUT /api/tasks/:id' && ctx.body && ctx.body.status === 'hecho') ev = 'task.done';
  if (key === 'PUT /api/jobs/:id' && ctx.body && ctx.body.status) ev = 'job.updated';
  if (!ev || !res || res.pending) return;
  const params = ctx.params || {};
  let job = null;
  try {
    const jid = key.startsWith('POST /api/jobs/:id') || key === 'PUT /api/jobs/:id' ? Number(params.id) : key === 'POST /api/jobs' ? Number(res.id) : Number(res.job_id || 0);
    if (jid) { const j = db.prepare('SELECT id, client_name, address, status FROM jobs WHERE id=?').get(jid); if (j) job = { id: j.id, code: require('./scan').jobCode(j.id), client_name: j.client_name, address: j.address, status: j.status }; }
    if (!job && key === 'PUT /api/tasks/:id') { const t = db.prepare('SELECT job_id, title FROM tasks WHERE id=?').get(Number(params.id)); if (t) { const j = db.prepare('SELECT id, client_name, address, status FROM jobs WHERE id=?').get(t.job_id); job = { id: j.id, code: require('./scan').jobCode(j.id), client_name: j.client_name, address: j.address, status: j.status }; } }
    if (!job && key === 'POST /api/permits/:id/result') { const p = db.prepare('SELECT job_id, name FROM permits WHERE id=?').get(Number(params.id)); if (p) { const j = db.prepare('SELECT id, client_name, address, status FROM jobs WHERE id=?').get(p.job_id); job = { id: j.id, code: require('./scan').jobCode(j.id), client_name: j.client_name, address: j.address, status: j.status }; } }
  } catch { /* */ }
  emit(db, ev, { job, ...pick(ctx.body), ...pick(res), by: (ctx.user && (db.prepare('SELECT name FROM users WHERE id=?').get(ctx.user.officeId || ctx.user.pmId || ctx.user.id) || {}).name) || '' });
}

function routes(db, add, h) {
  const { requireRole, fail, str, intId } = h;
  const owner = u => { requireRole(u, 'owner'); if (u.isPm || u.is_agent || u.isOffice) fail(403, 'Las conexiones las manejan los dueños'); };
  const out = x => ({ id: x.id, url: x.url, events: x.events === '*' ? ['*'] : String(x.events).split(',').filter(Boolean), active: !!x.active, last_at: x.last_at, last_code: x.last_code, fails: x.fails, created_at: x.created_at, name: x.name });
  const events = list => { const a = Array.isArray(list) ? list : String(list || '*').split(','); if (!a.length || a.includes('*')) return '*'; const bad = a.filter(e => !EVENTS[e]); if (bad.length) fail(400, 'Evento desconocido'); return a.join(','); };
  add('GET', '/api/webhooks', ({ user }) => { owner(user); return { hooks: db.prepare('SELECT * FROM webhooks ORDER BY id').all().map(out), events: Object.entries(EVENTS).filter(([k]) => k !== 'test').map(([k, [es, en]]) => ({ key: k, es, en })) }; });
  add('POST', '/api/webhooks', ({ user, body }) => {
    owner(user);
    const url = safeUrl(body.url) || fail(400, 'Ponga una dirección https válida (no se permiten direcciones internas)');
    const secret = crypto.randomBytes(24).toString('hex');
    const id = Number(db.prepare('INSERT INTO webhooks(name,url,secret,events,created_by) VALUES(?,?,?,?,?)').run(str(body.name, 80) || new URL(url).hostname, url, secret, events(body.events), user.id).lastInsertRowid);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'crear', 'conexión', id, `Webhook a ${new URL(url).hostname}`);
    return { ...out(db.prepare('SELECT * FROM webhooks WHERE id=?').get(id)), secret };
  });
  add('PUT', '/api/webhooks/:id', ({ user, params, body }) => {
    owner(user);
    const x = db.prepare('SELECT * FROM webhooks WHERE id=?').get(intId(params.id)) || fail(404, 'No encontrado');
    const url = 'url' in body ? (safeUrl(body.url) || fail(400, 'Ponga una dirección https válida (no se permiten direcciones internas)')) : x.url;
    db.prepare('UPDATE webhooks SET name=?, url=?, events=?, active=? WHERE id=?').run('name' in body ? str(body.name, 80) : x.name, url, 'events' in body ? events(body.events) : x.events, 'active' in body ? (body.active ? 1 : 0) : x.active, x.id);
    return out(db.prepare('SELECT * FROM webhooks WHERE id=?').get(x.id));
  });
  add('DELETE', '/api/webhooks/:id', ({ user, params }) => {
    owner(user);
    const x = db.prepare('SELECT * FROM webhooks WHERE id=?').get(intId(params.id)) || fail(404, 'No encontrado');
    db.prepare('DELETE FROM webhooks WHERE id=?').run(x.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'borrar', 'conexión', x.id, `Webhook a ${x.url}`);
    return { ok: true };
  });
  // Mandar una prueba ahora y ver si contestó.
  add('POST', '/api/webhooks/:id/test', async ({ user, params }) => {
    owner(user);
    const x = db.prepare('SELECT * FROM webhooks WHERE id=?').get(intId(params.id)) || fail(404, 'No encontrado');
    return deliver(db, x, 'test', { message: 'Prueba desde la app' });
  });
  // Nueva clave secreta (si se perdió o se filtró).
  add('POST', '/api/webhooks/:id/secret', ({ user, params }) => {
    owner(user);
    const x = db.prepare('SELECT * FROM webhooks WHERE id=?').get(intId(params.id)) || fail(404, 'No encontrado');
    const secret = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE webhooks SET secret=? WHERE id=?').run(secret, x.id);
    return { secret };
  });
  add('GET', '/api/webhooks/:id/log', ({ user, params }) => {
    owner(user);
    return db.prepare('SELECT id, event, code, ok, tries, error, created_at FROM webhook_log WHERE hook_id=? ORDER BY id DESC LIMIT 50').all(intId(params.id));
  });
}

module.exports = { EVENTS, ROUTES, emit, after, routes, safeUrl, setSender, deliver };
