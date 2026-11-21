'use strict';
// Partidas: cada obra se controla por lo que se vendió (PC-01 Patio cover, ELECT-01 Electricidad…),
// con vendido, costo y margen en cada renglón, igual que en los libros de Excel de la empresa.
//   Costo de una partida = lo gastado en ella (recibos, pagos e invoices de subs)
//                        + lo que todavía falta pagarle a cada sub de esa partida (lo acordado y no pagado).
// Así el margen es realista desde el primer día, aunque todavía no lleguen los recibos.
const { notify, owners } = require('./push');

const getMeta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
const setMeta = (db, k, v) => db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v);
const pct = (num, den) => den ? Math.round(num * 1000 / den) / 10 : null;

function marginAlert(db) { const v = Number(getMeta(db, 'margin_alert_pct')); return Number.isFinite(v) && v > 0 ? v : 35; }
function defaultSplit(db) {
  try { const s = JSON.parse(getMeta(db, 'profit_split') || ''); if (Array.isArray(s) && s.length) return s; } catch { /* */ }
  const co = require('./company').info(db).name;
  return [{ name: 'Jack', pct: 35 }, { name: 'Glaiber', pct: 35 }, { name: co, pct: 30 }];
}
function jobSplit(db, job) {
  try { const s = JSON.parse(job.profit_split || ''); if (Array.isArray(s) && s.length) return { split: s, custom: true }; } catch { /* */ }
  return { split: defaultSplit(db), custom: false };
}
// Lo que falta pagar a los subs (acordado – ya gastado con ese sub), por obra o por partida.
function subsOutstanding(db, where, arg) {
  return db.prepare(`SELECT COALESCE(SUM(MAX(0, s.agreed_cents - COALESCE((SELECT SUM(e.amount_cents) FROM expenses e WHERE e.sub_id=s.id),0))),0) v FROM subs s WHERE ${where}`).get(arg).v;
}
function projected(db, jobId, m) {
  const out = subsOutstanding(db, 's.job_id=?', jobId);
  const cost = m.spent + out;
  const profit = m.contract - cost;
  return { committed: out, projectedCost: cost, projectedProfit: profit, projectedMarginPct: pct(profit, m.contract) };
}
function lineRows(db, jobId) {
  const lines = db.prepare('SELECT * FROM job_lines WHERE job_id=? ORDER BY position, id').all(jobId);
  return lines.map(l => {
    const spent = db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE line_id=?').get(l.id).v;
    const out = subsOutstanding(db, 's.line_id=?', l.id);
    const co = db.prepare("SELECT COALESCE(SUM(price_cents),0) p, COALESCE(SUM(cost_cents),0) c FROM change_orders WHERE line_id=? AND status='aprobado'").get(l.id);
    const sold = l.sold_cents + co.p;
    const cost = spent + out;
    return { ...l, change_orders_cents: co.p, sold_total_cents: sold, spent_cents: spent, committed_cents: out, cost_cents: cost,
      margin_cents: sold - cost, margin_pct: pct(sold - cost, sold),
      subs: db.prepare('SELECT id, name, agreed_cents FROM subs WHERE line_id=?').all(l.id) };
  });
}

module.exports = function lineRoutes(db, add, h) {
  const { requireRole, fail, str, need, intId, cents, jobOr404, money, canSeeJob } = h;
  const owner = u => { requireRole(u, 'owner'); if (u.isPm) fail(403, 'Esto solo lo pueden hacer los dueños'); };
  const lineOr404 = (user, id) => {
    const l = db.prepare('SELECT * FROM job_lines WHERE id=?').get(intId(id));
    if (!l || !canSeeJob(db, user, l.job_id)) fail(404, 'No encontrado');
    return l;
  };
  const fields = (b, partial) => {
    const f = {};
    const has = k => !partial || k in b;
    if (has('trade')) f.trade = need(b.trade, 'partida', 80).toUpperCase();
    if (has('code')) f.code = str(b.code, 20).toUpperCase().trim();
    if (has('crew')) f.crew = str(b.crew, 80);
    if (has('description')) f.description = str(b.description, 4000);
    if (has('sold_cents')) f.sold_cents = b.sold_cents === '' || b.sold_cents == null ? 0 : cents(b.sold_cents, 'vendido');
    if (has('est_cost_cents')) f.est_cost_cents = b.est_cost_cents === '' || b.est_cost_cents == null ? 0 : cents(b.est_cost_cents, 'costo estimado');
    if (has('pass_through')) f.pass_through = b.pass_through ? 1 : 0;
    if (has('status')) f.status = ['pendiente', 'activo', 'terminado'].includes(b.status) ? b.status : 'pendiente';
    return f;
  };
  const nextCode = (jobId, trade) => {
    const base = String(trade || 'PART').replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase() || 'PART';
    let n = 1; while (db.prepare('SELECT 1 FROM job_lines WHERE job_id=? AND code=?').get(jobId, `${base}-${String(n).padStart(2, '0')}`)) n++;
    return `${base}-${String(n).padStart(2, '0')}`;
  };

  add('GET', '/api/jobs/:id/lines', ({ user, params }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const lines = lineRows(db, job.id);
    const m = money(db, job.id), p = projected(db, job.id, m);
    const unSpent = db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM expenses WHERE job_id=? AND line_id IS NULL').get(job.id).v;
    const unOut = subsOutstanding(db, 's.job_id=? AND s.line_id IS NULL', job.id);
    const sold = lines.reduce((a, l) => a + l.sold_total_cents, 0);
    const alert = marginAlert(db);
    return { lines, alert_pct: alert,
      unassigned: { spent_cents: unSpent, committed_cents: unOut, cost_cents: unSpent + unOut,
        expenses: db.prepare('SELECT id, date, description, vendor, amount_cents, category FROM expenses WHERE job_id=? AND line_id IS NULL ORDER BY date DESC').all(job.id),
        subs: db.prepare('SELECT id, name, trade, agreed_cents FROM subs WHERE job_id=? AND line_id IS NULL').all(job.id) },
      totals: { sold_cents: sold, contract_cents: m.contract, diff_cents: lines.length ? m.contract - sold : 0, cost_cents: p.projectedCost,
        margin_cents: p.projectedProfit, margin_pct: p.projectedMarginPct } };
  });
  add('POST', '/api/jobs/:id/lines', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const job = jobOr404(db, user, intId(params.id));
    const f = fields(body, false);
    if (!f.code) f.code = nextCode(job.id, f.trade);
    if (db.prepare('SELECT 1 FROM job_lines WHERE job_id=? AND code=?').get(job.id, f.code)) fail(400, 'Ya hay una partida con ese código en esta obra');
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 p FROM job_lines WHERE job_id=?').get(job.id).p;
    const id = Number(db.prepare('INSERT INTO job_lines(job_id,code,trade,crew,description,sold_cents,est_cost_cents,pass_through,status,position) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(job.id, f.code, f.trade, f.crew, f.description, f.sold_cents, f.est_cost_cents, f.pass_through, f.status, pos).lastInsertRowid);
    return db.prepare('SELECT * FROM job_lines WHERE id=?').get(id);
  });
  add('PUT', '/api/lines/:id', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const l = lineOr404(user, params.id);
    const f = fields(body, true);
    if (f.code === '') delete f.code;
    if (f.code && f.code !== l.code && db.prepare('SELECT 1 FROM job_lines WHERE job_id=? AND code=? AND id<>?').get(l.job_id, f.code, l.id)) fail(400, 'Ya hay una partida con ese código en esta obra');
    if ('position' in body) f.position = Number(body.position) || 0;
    const cols = Object.keys(f);
    if (cols.length) db.prepare(`UPDATE job_lines SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`).run(...cols.map(k => f[k]), l.id);
    return db.prepare('SELECT * FROM job_lines WHERE id=?').get(l.id);
  });
  add('DELETE', '/api/lines/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    const l = lineOr404(user, params.id);
    // Lo que estaba en la partida no se borra: queda "sin partida" para reasignarlo.
    db.prepare('DELETE FROM job_lines WHERE id=?').run(l.id);
    return { ok: true };
  });
  // Asignar a una partida: gastos y subs (no cambia ningún monto; por eso no necesita autorización).
  const lineForJob = (jobId, lineId) => {
    if (lineId == null || lineId === '') return null;
    const l = db.prepare('SELECT id FROM job_lines WHERE id=? AND job_id=?').get(intId(lineId), jobId);
    if (!l) fail(400, 'Esa partida no es de esta obra');
    return l.id;
  };
  add('PUT', '/api/expenses/:id/line', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const e = db.prepare('SELECT * FROM expenses WHERE id=?').get(intId(params.id));
    if (!e || !canSeeJob(db, user, e.job_id)) fail(404, 'No encontrado');
    db.prepare('UPDATE expenses SET line_id=? WHERE id=?').run(lineForJob(e.job_id, body.line_id), e.id);
    return { ok: true };
  });
  add('PUT', '/api/subs/:id/line', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const s = db.prepare('SELECT * FROM subs WHERE id=?').get(intId(params.id));
    if (!s || !canSeeJob(db, user, s.job_id)) fail(404, 'No encontrado');
    const lid = lineForJob(s.job_id, body.line_id);
    db.prepare('UPDATE subs SET line_id=? WHERE id=?').run(lid, s.id);
    // Lo que ya se le pagó a ese sub se mueve con él.
    db.prepare('UPDATE expenses SET line_id=? WHERE sub_id=?').run(lid, s.id);
    return { ok: true };
  });

  // ===== reparto de ganancia y alerta de margen (solo dueños) =====
  add('GET', '/api/settings/finance', ({ user }) => { owner(user); return { profit_split: defaultSplit(db), margin_alert_pct: marginAlert(db) }; });
  const checkSplit = s => {
    if (!Array.isArray(s) || !s.length || s.length > 8) fail(400, 'El reparto debe tener de 1 a 8 personas');
    const out = s.map(x => ({ name: need(x.name, 'nombre', 60), pct: Math.round(Number(x.pct) * 100) / 100 }));
    if (out.some(x => !Number.isFinite(x.pct) || x.pct < 0 || x.pct > 100)) fail(400, 'Porcentaje inválido');
    if (Math.abs(out.reduce((a, x) => a + x.pct, 0) - 100) > 0.01) fail(400, 'Los porcentajes deben sumar 100%');
    return out;
  };
  add('PUT', '/api/settings/finance', ({ user, body }) => {
    owner(user);
    if ('profit_split' in body) setMeta(db, 'profit_split', JSON.stringify(checkSplit(body.profit_split)));
    if ('margin_alert_pct' in body) {
      const v = Number(body.margin_alert_pct);
      if (!Number.isFinite(v) || v < 1 || v > 90) fail(400, 'Porcentaje inválido');
      setMeta(db, 'margin_alert_pct', String(v));
    }
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'editar', 'configuracion', 0,
      `Reparto: ${defaultSplit(db).map(x => `${x.name} ${x.pct}%`).join(', ')} · Alerta de margen: ${marginAlert(db)}%`);
    notify(db, owners(db).filter(id => id !== user.id), 'settings_changed', { who: user.name }, '#/reportes');
    return { profit_split: defaultSplit(db), margin_alert_pct: marginAlert(db) };
  });
  add('PUT', '/api/jobs/:id/split', ({ user, params, body }) => {
    owner(user);
    const job = jobOr404(db, user, intId(params.id));
    const v = body.split == null || (Array.isArray(body.split) && !body.split.length) ? '' : JSON.stringify(checkSplit(body.split));
    db.prepare('UPDATE jobs SET profit_split=? WHERE id=?').run(v, job.id);
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'editar', 'obra', job.id,
      `Reparto de ${job.client_name}: ${v ? JSON.parse(v).map(x => `${x.name} ${x.pct}%`).join(', ') : 'el normal'}`);
    return jobSplit(db, db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id));
  });
  add('GET', '/api/jobs/:id/split', ({ user, params }) => {
    owner(user);
    const job = jobOr404(db, user, intId(params.id));
    const m = money(db, job.id), p = projected(db, job.id, m);
    const s = jobSplit(db, job);
    const base = job.status === 'terminado' ? m.profit : p.projectedProfit;
    return { ...s, base_cents: base, basis: job.status === 'terminado' ? 'real' : 'proyectada',
      shares: s.split.map(x => ({ ...x, cents: Math.round(base * x.pct / 100) })) };
  });

  // ===== reportes =====
  // Margen por oficio en toda la empresa (su hoja TRADE_CONTROL).
  add('GET', '/api/reports/trades', ({ user, query }) => {
    owner(user);
    const year = Number(query.get('year')) || null;
    const jobs = db.prepare(`SELECT id FROM jobs WHERE status IN ('activo','terminado') ${year ? "AND COALESCE(NULLIF(start_date,''), substr(created_at,1,10)) LIKE ?" : ''}`).all(...(year ? [year + '%'] : []));
    const by = new Map();
    for (const j of jobs) for (const l of lineRows(db, j.id)) {
      const k = l.trade || '—';
      const r = by.get(k) || { trade: k, jobs: new Set(), lines: 0, sold_cents: 0, cost_cents: 0 };
      r.jobs.add(j.id); r.lines++; r.sold_cents += l.sold_total_cents; r.cost_cents += l.cost_cents; by.set(k, r);
    }
    const alert = marginAlert(db);
    const rows = [...by.values()].map(r => ({ trade: r.trade, jobs: r.jobs.size, lines: r.lines, sold_cents: r.sold_cents, cost_cents: r.cost_cents,
      margin_cents: r.sold_cents - r.cost_cents, margin_pct: pct(r.sold_cents - r.cost_cents, r.sold_cents) }))
      .map(r => ({ ...r, flag: r.margin_pct != null && r.margin_pct < alert ? 'bajo' : 'ok' })).sort((a, b) => b.sold_cents - a.sold_cents);
    return { alert_pct: alert, rows };
  });
  // Reparto de ganancias por obra y total por persona (su hoja PROJECTS: PROFIT JACK / GLAIBER / EE).
  add('GET', '/api/reports/split', ({ user, query }) => {
    owner(user);
    const year = Number(query.get('year')) || new Date().getFullYear();
    const jobs = db.prepare("SELECT * FROM jobs WHERE status IN ('activo','terminado') AND COALESCE(NULLIF(start_date,''), substr(created_at,1,10)) LIKE ? ORDER BY start_date, id").all(year + '%');
    const totals = new Map();
    const rows = jobs.map(j => {
      const m = money(db, j.id), p = projected(db, j.id, m);
      const real = j.status === 'terminado';
      const base = real ? m.profit : p.projectedProfit;
      const s = jobSplit(db, j);
      const shares = s.split.map(x => ({ name: x.name, pct: x.pct, cents: Math.round(base * x.pct / 100) }));
      for (const x of shares) { const t = totals.get(x.name) || { name: x.name, real_cents: 0, projected_cents: 0 }; if (real) t.real_cents += x.cents; else t.projected_cents += x.cents; totals.set(x.name, t); }
      return { id: j.id, client_name: j.client_name, status: j.status, contract_cents: m.contract, profit_cents: base, basis: real ? 'real' : 'proyectada',
        margin_pct: real ? m.marginPct : p.projectedMarginPct, custom: s.custom, shares };
    });
    return { year, rows, totals: [...totals.values()] };
  });
  // Obras y partidas con margen bajo (su hoja ALERTS).
  add('GET', '/api/margin-alerts', ({ user }) => {
    requireRole(user, 'owner');
    const alert = marginAlert(db);
    const out = [];
    for (const j of db.prepare("SELECT * FROM jobs WHERE status IN ('activo','terminado') ORDER BY id DESC LIMIT 200").all()) {
      if (!canSeeJob(db, user, j.id)) continue;
      const m = money(db, j.id); if (!m.contract) continue;
      const p = projected(db, j.id, m);
      const bad = lineRows(db, j.id).filter(l => l.sold_total_cents > 0 && l.margin_cents < 0).map(l => ({ code: l.code, trade: l.trade, margin_cents: l.margin_cents, pass_through: !!l.pass_through }));
      const low = p.projectedMarginPct != null && p.projectedMarginPct < alert;
      const suspicious = p.projectedMarginPct != null && p.projectedMarginPct > 85 && m.contract > 0;
      if (low || bad.length || suspicious) out.push({ id: j.id, client_name: j.client_name, status: j.status, margin_pct: p.projectedMarginPct, low, suspicious, negative_lines: bad });
    }
    return { alert_pct: alert, jobs: out };
  });
};
module.exports.projected = projected;
module.exports.lineRows = lineRows;
module.exports.marginAlert = marginAlert;
module.exports.defaultSplit = defaultSplit;
