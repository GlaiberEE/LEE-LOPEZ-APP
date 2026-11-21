'use strict';
// Seguridad para cambiar lo que ya se registró (dinero):
//  1) BITÁCORA: cada alta, cambio o borrado de dinero queda guardado (quién, cuándo, antes → después, motivo).
//  2) MOTIVO obligatorio para editar o borrar un registro de dinero.
//  3) DOS DUEÑOS para cambios de $1,000 o más (y siempre para borrar una obra o reabrir un periodo cerrado):
//     el cambio NO se aplica hasta que el otro dueño lo autoriza. Un "no" lo detiene.
//  4) CIERRE DE PERIODO: nada con fecha anterior al cierre se puede crear, cambiar ni borrar.
//  5) CHOQUES: si dos personas editan lo mismo a la vez, el segundo cambio se rechaza y pide recargar;
//     y una solicitud aprobada no se aplica si el registro cambió mientras esperaba.
const crypto = require('node:crypto');
const { DUAL_APPROVAL_CENTS } = require('./catalog');
const { notify, owners } = require('./push');

const ALWAYS = Number.MAX_SAFE_INTEGER;
const usd = c => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const num = v => Number(v);
const changed = (row, body, k) => k in body && String(body[k] ?? '') !== String(row[k] ?? '');
const centsOf = (body, k, dflt) => (k in body ? Math.round(Number(body[k])) : dflt);
const hash = row => crypto.createHash('sha256').update(JSON.stringify(row, Object.keys(row || {}).sort())).digest('hex');
const minutesBetween = (a, b) => Math.max(0, Math.round((Date.parse(String(b).replace(' ', 'T') + 'Z') - Date.parse(String(a).replace(' ', 'T') + 'Z')) / 60000));

// ---------- Qué se protege ----------
function specs(db) {
  const get = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(num(id));
  const S = {};
  // Gastos
  S['PUT /api/expenses/:id'] = { entity: 'gasto', load: p => get('expenses', p.id), date: r => r.date,
    when: (r, b) => ['amount_cents', 'date', 'category', 'sub_id', 'job_id'].some(k => changed(r, b, k)),
    amount: (r, b) => Math.abs(centsOf(b, 'amount_cents', r.amount_cents) - r.amount_cents), newDate: b => b.date,
    summary: (r, b) => `Gasto "${r.description}" ${usd(r.amount_cents)} → ${usd(centsOf(b, 'amount_cents', r.amount_cents))}` };
  S['DELETE /api/expenses/:id'] = { entity: 'gasto', load: p => get('expenses', p.id), date: r => r.date, when: () => true,
    amount: r => r.amount_cents, summary: r => `Borrar gasto "${r.description}" ${usd(r.amount_cents)}` };
  // Pagos del cliente
  S['DELETE /api/payments/:id'] = { entity: 'pago del cliente', load: p => get('payments', p.id), date: r => r.date, when: () => true,
    amount: r => r.amount_cents, summary: r => `Borrar pago del cliente ${usd(r.amount_cents)} (${r.method || '—'}, ${r.date})` };
  // Pagos a subs
  S['DELETE /api/sub-payments/:id'] = { entity: 'pago a sub', load: p => get('sub_payments', p.id), date: r => r.date, when: () => true,
    amount: r => r.amount_cents, summary: r => `Borrar pago a sub ${usd(r.amount_cents)} (${r.method}${r.reference ? ' ' + r.reference : ''}, ${r.date})` };
  S['POST /api/docs/:id/paid'] = { entity: 'pagos de invoice', load: p => get('sub_docs', p.id), date: r => r.paid_at || r.date,
    when: (r, b) => b.paid === false && db.prepare('SELECT COUNT(*) n FROM sub_payments WHERE doc_id=?').get(r.id).n > 0,
    amount: r => db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM sub_payments WHERE doc_id=?').get(r.id).v,
    summary: r => `Quitar los pagos del invoice ${r.number}` };
  // Change orders ya aprobados
  S['PUT /api/changes/:id'] = { entity: 'change order', load: p => get('change_orders', p.id), date: r => r.date,
    when: (r, b) => r.status === 'aprobado' && ['price_cents', 'cost_cents', 'status', 'date'].some(k => changed(r, b, k)),
    amount: (r, b) => (b.status && b.status !== 'aprobado') ? Math.abs(r.price_cents) : Math.max(Math.abs(centsOf(b, 'price_cents', r.price_cents) - r.price_cents), Math.abs(centsOf(b, 'cost_cents', r.cost_cents) - r.cost_cents)),
    newDate: b => b.date,
    summary: (r, b) => b.status && b.status !== 'aprobado' ? `Change order aprobado "${r.description}" ${usd(r.price_cents)} → ${b.status}` : `Change order aprobado "${r.description}" ${usd(r.price_cents)} → ${usd(centsOf(b, 'price_cents', r.price_cents))}` };
  S['DELETE /api/changes/:id'] = { entity: 'change order', load: p => get('change_orders', p.id), date: r => r.date, when: r => r.status === 'aprobado',
    amount: r => Math.abs(r.price_cents), summary: r => `Borrar change order aprobado "${r.description}" ${usd(r.price_cents)}` };
  // Precio de una obra ya contratada, y borrar obras
  S['PUT /api/jobs/:id'] = { entity: 'obra', load: p => get('jobs', p.id), when: (r, b) => ['activo', 'terminado'].includes(r.status) && changed(r, b, 'quoted_cents'),
    amount: (r, b) => Math.abs(centsOf(b, 'quoted_cents', r.quoted_cents) - r.quoted_cents), job: r => r.id,
    summary: (r, b) => `Precio de la obra ${r.client_name}: ${usd(r.quoted_cents)} → ${usd(centsOf(b, 'quoted_cents', r.quoted_cents))}` };
  S['DELETE /api/jobs/:id'] = { entity: 'obra', load: p => get('jobs', p.id), when: () => true, amount: () => ALWAYS, job: r => r.id,
    summary: r => `BORRAR la obra ${r.client_name} con todo su historial` };
  // Acuerdos con subs
  S['PUT /api/subs/:id'] = { entity: 'acuerdo con sub', load: p => get('subs', p.id), when: (r, b) => changed(r, b, 'agreed_cents'),
    amount: (r, b) => Math.abs(centsOf(b, 'agreed_cents', r.agreed_cents) - r.agreed_cents),
    summary: (r, b) => `Acordado con ${r.name}: ${usd(r.agreed_cents)} → ${usd(centsOf(b, 'agreed_cents', r.agreed_cents))}` };
  S['DELETE /api/subs/:id'] = { entity: 'acuerdo con sub', load: p => get('subs', p.id), when: () => true, amount: r => r.agreed_cents,
    summary: r => `Borrar a ${r.name} de la obra (acordado ${usd(r.agreed_cents)})` };
  // Horas (cuando cuestan dinero)
  S['PUT /api/time/:id'] = { entity: 'horas', load: p => get('time_entries', p.id), date: r => r.in_at.slice(0, 10), when: () => true,
    amount: (r, b) => { const m = b.in_at && b.out_at ? minutesBetween(String(b.in_at).replace('T', ' '), String(b.out_at).replace('T', ' ')) : r.minutes; return Math.abs(Math.round((m - r.minutes) / 60 * r.rate_cents)); },
    newDate: b => b.in_at ? String(b.in_at).slice(0, 10) : '', summary: r => `Corregir horas del ${r.in_at.slice(0, 10)}` };
  S['DELETE /api/time/:id'] = { entity: 'horas', load: p => get('time_entries', p.id), date: r => r.in_at.slice(0, 10), when: () => true,
    amount: r => Math.round(r.minutes / 60 * r.rate_cents), summary: r => `Borrar horas del ${r.in_at.slice(0, 10)}` };
  // Reabrir un periodo cerrado
  S['PUT /api/lock'] = { entity: 'cierre de periodo', load: () => ({ id: 0, date: lockDate(db) }), noLock: true, when: (r, b) => !!r.date && (!b.date || b.date < r.date),
    amount: () => ALWAYS, summary: (r, b) => `Reabrir periodo cerrado: ${r.date} → ${b.date || 'sin cierre'}` };
  return S;
}
// Altas de dinero: se revisa el cierre de periodo y se anotan en la bitácora.
const CREATES = {
  'POST /api/jobs/:id/payments': { entity: 'pago del cliente', date: b => b.date, amount: b => num(b.amount_cents) || 0, job: p => num(p.id) },
  'POST /api/jobs/:id/expenses': { entity: 'gasto', date: b => b.date, amount: b => num(b.amount_cents) || 0, job: p => num(p.id) },
  'POST /api/subs/:id/payments': { entity: 'pago a sub', date: b => b.date, amount: b => num(b.amount_cents) || 0, job: (p, db) => (db.prepare('SELECT job_id FROM subs WHERE id=?').get(num(p.id)) || {}).job_id },
  'POST /api/jobs/:id/changes': { entity: 'change order', date: b => b.date, amount: b => num(b.price_cents) || 0, job: p => num(p.id) },
};
const lockDate = db => (db.prepare("SELECT value FROM meta WHERE key='lock_date'").get() || {}).value || '';
const jobOfRow = r => r.job_id ?? null;

function audit(db, { user, action, entity, entity_id, job_id, summary, before, after, amount, reason, request_id }) {
  db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,job_id,summary,before,after,amount_cents,reason,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(user ? user.id : null, action, entity, entity_id ?? null, job_id ?? null, String(summary || '').slice(0, 400),
      before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '', Math.min(Number.MAX_SAFE_INTEGER, amount || 0) === ALWAYS ? 0 : (amount || 0), String(reason || '').slice(0, 500), request_id ?? null);
}

function make(db) {
  const SPEC = specs(db);
  const lockedMsg = d => `Periodo cerrado hasta el ${d}: no se puede crear, cambiar ni borrar nada con esa fecha o antes. Para cambiarlo, reabran el periodo en Mi cuenta.`;
  const checkLock = d => { const L = lockDate(db); if (L && d && String(d).slice(0, 10) <= L) throw Object.assign(new Error(lockedMsg(L)), { status: 423 }); };

  // Solicitud para que un dueño autorice (la usan los PMs y los cambios grandes de dueños).
  function request(ctx, fail, { entity, row, jobId, summary, amount, why = [], keepHash = true }) {
    const { user, body = {} } = ctx;
    const reason = String(body.reason || '').trim();
    if (reason.length < 3) fail(428, 'Escriba el motivo del cambio', { needReason: true, summary: summary + (why.length ? ' — ' + why.join('; ') : '') });
    const others = owners(db).filter(id => id !== user.id);
    if (!others.length) fail(400, 'No hay un dueño activo que pueda autorizar');
    const { reason: _r, _expect, ...clean } = body;
    const full = summary + (why.length ? ` (${why.join('; ')})` : '');
    const id = Number(db.prepare(`INSERT INTO change_requests(user_id,method,path,route,body,entity,entity_id,job_id,summary,amount_cents,before,before_hash,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(user.id, ctx.key.split(' ')[0], ctx.path, ctx.key, JSON.stringify(clean), entity, row && row.id != null ? row.id : null, jobId ?? null,
      full, amount === ALWAYS ? 0 : (amount || 0), row ? JSON.stringify(row) : '', row && keepHash ? hash(row) : '', reason).lastInsertRowid);
    audit(db, { user, action: 'solicitud', entity, entity_id: row && row.id, job_id: jobId, summary: full, before: row, amount, reason, request_id: id });
    notify(db, others, 'change_req', { who: user.name, x: full }, '#/');
    return { pending: { pending: true, request_id: id, summary: full, message: user.isPm ? 'Enviado a los dueños para que lo autoricen. No se aplica hasta que un dueño lo apruebe.' : 'Cambio enviado al otro dueño para que lo autorice. No se aplica hasta que lo apruebe.' } };
  }

  // Antes de ejecutar la acción. Regresa { pending } si el cambio debe esperar a un dueño.
  function before(key, ctx0, fail) {
    const ctx = { ...ctx0, key };
    const { user, params = {}, body = {} } = ctx;
    if (!user || user.role !== 'owner') return null; // la ruta misma rechaza al que no debe
    const PM = require('./pm');
    const isPm = user.isPm && !ctx.approved;
    const c = CREATES[key];
    if (c) {
      try { checkLock(c.date(body)); } catch (e) { fail(e.status, e.message); }
      if (isPm) { const pr = PM.rule(db, key, ctx, fail); if (pr) return request(ctx, fail, { entity: c.entity, row: null, jobId: c.job(params, db), summary: pr.summary, amount: pr.amount, why: pr.why }); }
      // Un dueño tampoco se reembolsa solo: si hay otro dueño, lo autoriza él.
      const reimb = body.reimburse === true || body.reimburse === 'si' || body.reimburse === 1;
      if (!ctx.approved && !user.isPm && key === 'POST /api/jobs/:id/expenses' && reimb && owners(db).some(id => id !== user.id))
        return request(ctx, fail, { entity: c.entity, row: null, jobId: c.job(params, db), summary: `Reembolso a ${user.name}: ${usd(Number(body.amount_cents) || 0)} "${body.description || ''}"`, amount: Number(body.amount_cents) || 0, why: ['un reembolso a un dueño lo autoriza el otro dueño'] });
      return { create: c };
    }
    const spec = SPEC[key];
    if (!spec) {
      if (isPm) { const pr = PM.rule(db, key, ctx, fail); if (pr) return request(ctx, fail, { entity: 'autorización', row: null, jobId: null, summary: pr.summary, amount: pr.amount, why: pr.why }); }
      return null;
    }
    const row = spec.load(params, body); if (!row) return null;
    if (!spec.noLock) {
      try { if (spec.date) checkLock(spec.date(row)); if (spec.newDate && spec.newDate(body)) checkLock(spec.newDate(body)); } catch (e) { fail(e.status, e.message); }
    }
    // Choque: alguien lo cambió mientras se editaba.
    if (body._expect && typeof body._expect === 'object') {
      for (const [k, v] of Object.entries(body._expect)) if (String(row[k] ?? '') !== String(v ?? '')) fail(409, 'Alguien cambió este registro mientras usted lo editaba. Cierre, recargue y vuelva a intentar.', { conflict: true });
    }
    const governed = spec.when(row, body);
    const g = { spec, row, governed, key };
    // Project manager: cualquier cambio o borrado de dinero (y lo que marquen sus reglas) lo autoriza un dueño, sin importar el monto.
    if (isPm) {
      const pr = PM.rule(db, key, ctx, fail);
      if (pr || governed) return request(ctx, fail, { entity: spec.entity, row, jobId: spec.job ? spec.job(row) : jobOfRow(row), summary: pr ? pr.summary : spec.summary(row, body), amount: pr ? pr.amount : spec.amount(row, body), why: pr ? pr.why : ['los cambios de dinero los autoriza un dueño'] });
    }
    if (!governed) return g;
    if (ctx.approved) return { ...g, reason: ctx.approved.reason, request: ctx.approved };
    const reason = String(body.reason || '').trim();
    if (reason.length < 3) fail(428, 'Escriba el motivo del cambio', { needReason: true, summary: spec.summary(row, body) });
    const amount = spec.amount(row, body);
    const others = owners(db).filter(id => id !== user.id);
    if (others.length && amount >= DUAL_APPROVAL_CENTS) {
      const { reason: _r, _expect, ...clean } = body;
      const summary = spec.summary(row, body);
      const id = Number(db.prepare(`INSERT INTO change_requests(user_id,method,path,route,body,entity,entity_id,job_id,summary,amount_cents,before,before_hash,reason)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(user.id, key.split(' ')[0], ctx.path, key, JSON.stringify(clean), spec.entity, row.id, spec.job ? spec.job(row) : jobOfRow(row),
        summary, amount === ALWAYS ? 0 : amount, JSON.stringify(row), hash(row), reason).lastInsertRowid);
      audit(db, { user, action: 'solicitud', entity: spec.entity, entity_id: row.id, job_id: spec.job ? spec.job(row) : jobOfRow(row), summary, before: row, amount, reason, request_id: id });
      notify(db, others, 'change_req', { who: user.name, x: summary }, '#/');
      return { pending: { pending: true, request_id: id, summary, message: 'Cambio enviado al otro dueño para que lo autorice. No se aplica hasta que lo apruebe.' } };
    }
    return { ...g, reason };
  }

  // Después de ejecutar: bitácora.
  function after(key, ctx, g, res) {
    if (!g) return;
    try {
      const { user, params = {}, body = {} } = ctx;
      if (g.create) {
        audit(db, { user, action: 'crear', entity: g.create.entity, entity_id: res && res.id, job_id: g.create.job(params, db), amount: g.create.amount(body),
          summary: `${g.create.entity} ${usd(g.create.amount(body))}${body.date ? ' · ' + body.date : ''}${body.method ? ' · ' + body.method : ''}`, after: body.receipt ? { ...body, receipt: '[foto]' } : body });
        return;
      }
      const afterRow = key.startsWith('DELETE') ? null : g.spec.load(params, body);
      const isDel = key.startsWith('DELETE') || (key === 'POST /api/docs/:id/paid' && body.paid === false);
      if (!g.governed && !isDel && JSON.stringify(afterRow) === JSON.stringify(g.row)) return;
      audit(db, { user, action: isDel ? 'borrar' : 'editar', entity: g.spec.entity, entity_id: g.row.id, job_id: g.spec.job ? g.spec.job(g.row) : jobOfRow(g.row),
        summary: g.spec.summary(g.row, body), before: g.row, after: afterRow, amount: g.spec.amount(g.row, body), reason: g.reason || '', request_id: g.request ? g.request.id : null });
    } catch (e) { console.error('[bitácora]', e.message); }
  }
  return { before, after, SPEC, lockDate: () => lockDate(db), hash };
}

function routes(db, add, h, G, dispatch) {
  const { requireRole, fail, str, intId, date } = h;
  const out = r => {
    const u = db.prepare('SELECT name FROM users WHERE id=?').get(r.user_id) || {};
    const d = r.decided_by ? (db.prepare('SELECT name FROM users WHERE id=?').get(r.decided_by) || {}) : {};
    const j = r.job_id ? (db.prepare('SELECT client_name FROM jobs WHERE id=?').get(r.job_id) || {}) : {};
    let proposed = {}; try { proposed = JSON.parse(r.body); } catch { /* */ }
    let beforeRow = {}; try { beforeRow = JSON.parse(r.before); } catch { /* */ }
    return { id: r.id, created_at: r.created_at, by: u.name || '', user_id: r.user_id, method: r.method, route: r.route, entity: r.entity, entity_id: r.entity_id, job_id: r.job_id,
      client_name: j.client_name || '', summary: r.summary, amount_cents: r.amount_cents, reason: r.reason, status: r.status, decided_by_name: d.name || '', decided_at: r.decided_at,
      decision_note: r.decision_note, proposed: Object.fromEntries(Object.entries(proposed).filter(([k]) => !['receipt', 'confirm'].includes(k))), before: beforeRow };
  };
  add('GET', '/api/change-requests', ({ user }) => {
    requireRole(user, 'owner');
    const pend = db.prepare("SELECT * FROM change_requests WHERE status='pendiente' ORDER BY id").all();
    return { to_approve: pend.filter(r => r.user_id !== user.id).map(out), mine: pend.filter(r => r.user_id === user.id).map(out),
      recent: db.prepare("SELECT * FROM change_requests WHERE status<>'pendiente' ORDER BY id DESC LIMIT 20").all().map(out) };
  });
  add('POST', '/api/change-requests/:id/decide', async ({ user, params, body }) => {
    requireRole(user, 'owner');
    const r = db.prepare('SELECT * FROM change_requests WHERE id=?').get(intId(params.id));
    if (!r) fail(404, 'No encontrado');
    if (r.status !== 'pendiente') fail(400, 'Esta solicitud ya se decidió');
    if (r.user_id === user.id) fail(403, 'El cambio lo tiene que autorizar el otro dueño');
    const note = str(body.note, 500);
    const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : fail(400, 'Decisión inválida');
    const requester = db.prepare('SELECT * FROM users WHERE id=?').get(r.user_id);
    if (action === 'reject') {
      db.prepare("UPDATE change_requests SET status='rechazado', decided_by=?, decided_at=datetime('now'), decision_note=? WHERE id=?").run(user.id, note, r.id);
      audit(db, { user, action: 'rechazar', entity: r.entity, entity_id: r.entity_id, job_id: r.job_id, summary: r.summary, reason: note, request_id: r.id });
      if (requester) notify(db, requester.id, 'change_decided', { x: r.summary, r: 'NO autorizado' }, '#/');
      return out(db.prepare('SELECT * FROM change_requests WHERE id=?').get(r.id));
    }
    // ¿Cambió el registro mientras esperaba? Entonces no se aplica.
    const spec = G.SPEC[r.route];
    const pathParams = (() => { const re = new RegExp('^' + r.route.split(' ')[1].replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'); return (re.exec(r.path) || {}).groups || {}; })();
    const current = r.before_hash && spec ? spec.load(pathParams, {}) : null;
    if (r.before_hash && (!current || G.hash(current) !== r.before_hash)) {
      db.prepare("UPDATE change_requests SET status='conflicto', decided_by=?, decided_at=datetime('now'), decision_note=? WHERE id=?").run(user.id, 'El registro cambió mientras esperaba la autorización', r.id);
      audit(db, { user, action: 'conflicto', entity: r.entity, entity_id: r.entity_id, job_id: r.job_id, summary: r.summary, reason: 'El registro cambió mientras esperaba', request_id: r.id });
      fail(409, 'El registro cambió mientras esperaba la autorización, así que este cambio NO se aplicó. Pidan el cambio de nuevo con los datos actuales.', { conflict: true });
    }
    if (!requester || !requester.active) fail(400, 'El dueño que pidió el cambio ya no está activo');
    let result;
    try {
      result = await dispatch(r.method, r.path, { user: requester, params: pathParams, body: JSON.parse(r.body), query: new URLSearchParams(), approved: r, path: r.path });
    } catch (e) {
      db.prepare("UPDATE change_requests SET status='conflicto', decided_by=?, decided_at=datetime('now'), decision_note=? WHERE id=?").run(user.id, e.message, r.id);
      throw e;
    }
    db.prepare("UPDATE change_requests SET status='aprobado', decided_by=?, decided_at=datetime('now'), decision_note=? WHERE id=?").run(user.id, note, r.id);
    audit(db, { user, action: 'aprobar', entity: r.entity, entity_id: r.entity_id, job_id: r.job_id, summary: r.summary, reason: note, request_id: r.id });
    notify(db, requester.id, 'change_decided', { x: r.summary, r: 'autorizado y aplicado' }, '#/');
    return { ...out(db.prepare('SELECT * FROM change_requests WHERE id=?').get(r.id)), result };
  });
  add('POST', '/api/change-requests/:id/cancel', ({ user, params }) => {
    requireRole(user, 'owner');
    const r = db.prepare('SELECT * FROM change_requests WHERE id=?').get(intId(params.id));
    if (!r || r.user_id !== user.id) fail(404, 'No encontrado');
    if (r.status !== 'pendiente') fail(400, 'Esta solicitud ya se decidió');
    db.prepare("UPDATE change_requests SET status='cancelado', decided_by=?, decided_at=datetime('now') WHERE id=?").run(user.id, r.id);
    audit(db, { user, action: 'cancelar', entity: r.entity, entity_id: r.entity_id, job_id: r.job_id, summary: r.summary, request_id: r.id });
    return { ok: true };
  });
  add('GET', '/api/audit', ({ user, query }) => {
    requireRole(user, 'owner');
    const jobId = query.get('job_id') ? intId(query.get('job_id')) : null;
    const rows = db.prepare(`SELECT a.*, u.name user_name, j.client_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN jobs j ON j.id=a.job_id
      ${jobId ? 'WHERE a.job_id=?' : ''} ORDER BY a.id DESC LIMIT 300`).all(...(jobId ? [jobId] : []));
    return rows.map(a => ({ ...a, before: a.before ? JSON.parse(a.before) : null, after: a.after ? JSON.parse(a.after) : null }));
  });
  // Cierre de periodo: cerrar lo pasa un dueño; reabrir necesita al otro dueño (ver SPEC 'PUT /api/lock').
  add('GET', '/api/lock', ({ user }) => { requireRole(user, 'owner'); return { date: G.lockDate() }; });
  add('PUT', '/api/lock', ({ user, body }) => {
    requireRole(user, 'owner');
    const d = date(body.date, 'fecha de cierre') || '';
    const prev = G.lockDate();
    db.prepare("INSERT INTO meta(key,value) VALUES('lock_date',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(d);
    if (!prev || (d && d > prev)) audit(db, { user, action: 'cerrar periodo', entity: 'cierre de periodo', summary: `Periodo cerrado hasta ${d}${prev ? ' (antes ' + prev + ')' : ''}`, reason: str(body.reason, 300) });
    return { date: d };
  });

}

module.exports = { make, routes, audit };
