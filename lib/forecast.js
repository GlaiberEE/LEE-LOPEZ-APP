'use strict';
// Proyecciones de los próximos meses con el historial de la empresa (probabilidad y estadística).
//
// Método (simulación Monte Carlo): se simulan miles de "futuros posibles" y se reporta el rango.
//  - Prospectos y estimados abiertos: cada uno se cierra con la probabilidad de su ORIGEN
//    (referido, Google, web…), calculada del historial y ajustada hacia el promedio cuando hay pocos datos
//    (estimación bayesiana: con pocos casos no se confía en un 100% o un 0%).
//  - Prospectos nuevos: llegan cada mes según un proceso de Poisson con el promedio mensual del historial,
//    ajustado por TEMPORADA (índice por mes del año) si hay al menos 12 meses de datos.
//  - Tamaño de cada obra, días para cerrar, duración y margen: se toman al azar de lo que ya pasó
//    (bootstrap) por tipo de proyecto cuando hay datos suficientes.
//  - Cobros: anticipo (el % que suelen dar al firmar) y el resto repartido durante la obra.
//  - Obras activas: se cobra lo que falta y se gasta lo que falta según el margen típico de ese tipo.
// Resultado por mes: P10 (mes malo razonable), P50 (lo más probable), P90 (mes bueno razonable).
const C = require('./catalog');

const DAY = 864e5;
const iso = t => new Date(t).toISOString().slice(0, 10);
const toT = d => Date.parse(String(d).slice(0, 10) + 'T12:00:00Z');
const monthKey = t => iso(t).slice(0, 7);
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function poisson(lambda, r) { if (lambda <= 0) return 0; if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(r))); const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= r(); } while (p > L); return k - 1; }
function normal(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo)); };
const median = a => pct(a, 0.5);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : 0; };
function hashSeed(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------- Datos: obras de la app + historial importado ----------
function records(db, money) {
  const out = [];
  for (const j of db.prepare('SELECT * FROM jobs').all()) {
    const lead = (j.created_at || '').slice(0, 10) || j.start_date || null;
    const r = { src: 'app', id: j.id, lead, type: j.project_type, source: (j.lead_source || '').trim() || '—', status: j.status };
    if (['prospecto', 'cotizado'].includes(j.status)) Object.assign(r, { open: true, price: j.quoted_cents || null });
    else if (j.status === 'cancelado') Object.assign(r, { won: false });
    else {
      const m = money(db, j.id);
      Object.assign(r, { won: true, wonDate: (j.signed_at || '').slice(0, 10) || j.start_date || lead, doneDate: j.status === 'terminado' ? j.completed_date || null : null, price: m.contract,
        cost: j.status === 'terminado' ? m.spent : null, active: j.status === 'activo', endDate: j.end_date || null, balance: m.balanceDue, spent: m.spent, paid: m.paid });
    }
    out.push(r);
  }
  for (const h of db.prepare('SELECT * FROM hist_jobs').all()) {
    out.push({ src: 'hist', lead: h.lead_date || h.won_date || null, type: h.project_type, source: (h.source || '').trim() || '—', won: !!h.won,
      wonDate: h.won ? (h.won_date || h.lead_date || null) : null, doneDate: h.done_date || null, price: h.price_cents || null, cost: h.cost_cents || null });
  }
  return out;
}

function model(db, money, today) {
  const T0 = toT(today);
  const R = records(db, money);
  const leads = R.filter(r => r.lead && toT(r.lead) <= T0);
  const decided = R.filter(r => r.won === true || r.won === false);
  const won = decided.filter(r => r.won);
  const firstLead = leads.length ? Math.min(...leads.map(r => toT(r.lead))) : T0;
  const months = Math.max(1, (T0 - firstLead) / (30.44 * DAY));
  // Probabilidad de cierre (Beta con prior ~40%).
  const wonN = won.length, lostN = decided.length - wonN;
  const pAll = (wonN + 2) / (wonN + lostN + 5);
  const bySource = {};
  for (const r of decided) { const s = bySource[r.source] ||= { source: r.source, won: 0, lost: 0 }; r.won ? s.won++ : s.lost++; }
  const K = 4;
  for (const s of Object.values(bySource)) s.p = (s.won + pAll * K) / (s.won + s.lost + K);
  const pSource = src => (bySource[src] || { p: pAll }).p;
  // Prospectos por mes (últimos 12 meses o lo que haya) y temporada.
  const span = Math.min(12, months);
  const recent = leads.filter(r => toT(r.lead) > T0 - span * 30.44 * DAY);
  const lambda = recent.length / span;
  const byMonth = Array(12).fill(0);
  for (const r of leads) byMonth[new Date(toT(r.lead)).getUTCMonth()]++;
  const years = months / 12;
  const avgPerMonth = leads.length / Math.max(1, months);
  const season = byMonth.map(n => {
    if (years < 1 || !avgPerMonth) return 1;
    const raw = (n / years) / avgPerMonth;
    return Math.round(((years * raw + 1) / (years + 1)) * 100) / 100; // se acerca a 1 cuando hay pocos años
  });
  // Tamaños, tiempos, márgenes.
  const prices = won.filter(r => r.price > 0);
  const priceBy = t => { const a = prices.filter(r => r.type === t).map(r => r.price); return a.length >= 3 ? a : prices.map(r => r.price); };
  const daysToClose = won.filter(r => r.lead && r.wonDate).map(r => Math.round((toT(r.wonDate) - toT(r.lead)) / DAY)).filter(d => d >= 0 && d <= 365);
  const durations = won.filter(r => r.wonDate && r.doneDate).map(r => Math.round((toT(r.doneDate) - toT(r.wonDate)) / DAY)).filter(d => d > 0 && d <= 400);
  const withCost = won.filter(r => r.price > 0 && r.cost > 0);
  const margins = withCost.map(r => (r.price - r.cost) / r.price).filter(m => m > -0.5 && m < 0.95);
  const marginBy = t => { const a = withCost.filter(r => r.type === t).map(r => (r.price - r.cost) / r.price).filter(m => m > -0.5 && m < 0.95); return a.length >= 3 ? a : margins; };
  const mAll = margins.length >= 3 ? { mean: mean(margins), sd: Math.max(0.04, sd(margins)) } : { mean: 0.3, sd: 0.08 };
  const marginStats = t => { const a = marginBy(t); return a.length >= 3 ? { mean: mean(a), sd: Math.max(0.04, sd(a)) } : mAll; };
  // Anticipo: lo cobrado en los primeros 14 días después de firmar, sobre el contrato (obras de la app).
  const deposits = [];
  for (const r of R.filter(x => x.src === 'app' && x.won && x.wonDate && x.price > 0)) {
    const v = db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE job_id=? AND date <= ?').get(r.id, iso(toT(r.wonDate) + 14 * DAY)).v;
    if (v > 0) deposits.push(Math.min(1, v / r.price));
  }
  const deposit = deposits.length >= 3 ? median(deposits.map(x => Math.round(x * 100))) / 100 : 0.3;
  // Parte del costo que es material (para el escenario "sube el material").
  const ex = db.prepare('SELECT category, SUM(amount_cents) v FROM expenses GROUP BY category').all();
  const exTot = ex.reduce((a, r) => a + r.v, 0);
  const materialShare = exTot > 0 ? (ex.find(r => r.category === 'material') || { v: 0 }).v / exTot : 0.45;
  const typeMix = prices.length ? prices.map(r => r.type) : ['patio_cover'];
  // Capacidad: obras al mismo tiempo (máximo histórico) o el valor puesto por los dueños.
  const cap = Number((db.prepare("SELECT value FROM meta WHERE key='capacity_jobs'").get() || {}).value) || 0;
  const quality = wonN >= 30 && months >= 12 ? 'buena' : wonN >= 10 && months >= 6 ? 'media' : 'poca';
  return { T0, R, pAll, bySource, pSource, lambda, season, priceBy, prices, daysToClose, durations, marginStats, mAll, deposit, materialShare, typeMix, cap,
    stats: { leads: leads.length, decided: decided.length, won: wonN, lost: lostN, months: Math.round(months * 10) / 10, quality, hist: R.filter(r => r.src === 'hist').length } };
}

function simulate(M, { horizon = 6, sims = 2000, close = 1, leads = 1, price = 1, material = 0, seed = 1 }) {
  const r = rng(seed);
  const start = new Date(M.T0); const monthsList = [];
  for (let k = 0; k < horizon; k++) { const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k, 1)); monthsList.push(iso(d).slice(0, 7)); }
  const idx = Object.fromEntries(monthsList.map((m, i) => [m, i]));
  const endT = toT(monthsList[horizon - 1] + '-01') + 32 * DAY;
  const lastDay = Date.UTC(new Date(endT).getUTCFullYear(), new Date(endT).getUTCMonth(), 1) - DAY;
  const H = horizon;
  const acc = { bookings: [], cashIn: [], cashOut: [], net: [], active: [], newJobs: [] };
  for (const k of Object.keys(acc)) acc[k] = Array.from({ length: H }, () => []);
  const tot = { bookings: [], cashIn: [], cashOut: [], profit: [], newJobs: [] };
  const sampleDays = () => M.daysToClose.length >= 5 ? pick(M.daysToClose, r) : 14 + Math.floor(r() * 46);
  const sampleDur = () => M.durations.length >= 3 ? pick(M.durations, r) : 30 + Math.floor(r() * 45);
  const samplePrice = t => { const a = M.priceBy(t); return a.length ? pick(a, r) : 2500000; };
  const sampleMargin = t => { const s = M.marginStats(t); return Math.min(0.85, Math.max(-0.3, s.mean + s.sd * normal(r))); };
  const openDeals = M.R.filter(x => x.open);
  const activeJobs = M.R.filter(x => x.active);
  const typicalWait = M.daysToClose.length >= 5 ? median(M.daysToClose) : 35;
  // Reparte un monto en partes iguales por día entre dos fechas y lo suma por mes.
  const spread = (arr, amount, fromT, toT2) => {
    if (amount === 0) return;
    if (toT2 <= fromT) toT2 = fromT + DAY;
    const days = Math.max(1, Math.round((toT2 - fromT) / DAY));
    for (let i = 0; i < days; i++) { const k = idx[monthKey(fromT + i * DAY)]; if (k !== undefined) arr[k] += amount / days; }
  };
  for (let s = 0; s < sims; s++) {
    const bk = Array(H).fill(0), ci = Array(H).fill(0), co = Array(H).fill(0), act = Array(H).fill(0), nj = Array(H).fill(0);
    let profit = 0;
    const won = [];
    // 1) Abiertos
    for (const d of openDeals) {
      let p = M.pSource(d.source) * close;
      const age = d.lead ? (M.T0 - toT(d.lead)) / DAY : 0;
      if (age > 4 * typicalWait) p *= 0.2; else if (age > 2 * typicalWait) p *= 0.5;
      if (r() >= Math.min(0.97, p)) continue;
      let t = (d.lead ? toT(d.lead) : M.T0) + sampleDays() * DAY;
      if (t < M.T0) t = M.T0 + Math.floor(r() * 30) * DAY;
      won.push({ t, value: (d.price || samplePrice(d.type)) * price, type: d.type });
    }
    // 2) Prospectos nuevos
    for (let k = 0; k < H; k++) {
      const m0 = toT(monthsList[k] + '-01');
      const from = Math.max(m0, M.T0);
      const dim = new Date(Date.UTC(new Date(m0).getUTCFullYear(), new Date(m0).getUTCMonth() + 1, 1)) - m0;
      const frac = Math.max(0, (m0 + dim - from) / dim);
      const n = poisson(M.lambda * M.season[new Date(m0).getUTCMonth()] * leads * frac, r);
      for (let i = 0; i < n; i++) {
        if (r() >= Math.min(0.97, M.pAll * close)) continue;
        const leadT = from + r() * (m0 + dim - from);
        const type = pick(M.typeMix, r);
        won.push({ t: leadT + sampleDays() * DAY, value: samplePrice(type) * price, type });
      }
    }
    // 3) Lo que se cierra: ventas, cobros, gastos, capacidad
    for (const w of won) {
      if (w.t > lastDay) continue;
      const k = idx[monthKey(w.t)]; if (k === undefined) continue;
      bk[k] += w.value; nj[k]++;
      const startT = w.t + 14 * DAY, endJ = startT + sampleDur() * DAY;
      const margin = sampleMargin(w.type);
      const cost = w.value * (1 - margin) * (1 + M.materialShare * material);
      profit += w.value - cost;
      const di = idx[monthKey(w.t)]; if (di !== undefined) ci[di] += w.value * M.deposit;
      spread(ci, w.value * (1 - M.deposit), startT, endJ);
      spread(co, cost, startT, endJ);
      for (let q = 0; q < H; q++) { const m0 = toT(monthsList[q] + '-01'); if (startT < m0 + 31 * DAY && endJ >= m0) act[q]++; }
    }
    // 4) Obras activas: lo que falta cobrar y gastar
    for (const a of activeJobs) {
      let end = a.endDate ? toT(a.endDate) : M.T0 + 30 * DAY;
      if (end < M.T0 + 7 * DAY) end = M.T0 + 7 * DAY;
      end += Math.floor(r() * 21) * DAY; // retrasos normales
      spread(ci, Math.max(0, a.balance), M.T0, end);
      const m = sampleMargin(a.type);
      const left = Math.max(0, a.price * (1 - m) - a.spent) * (1 + M.materialShare * material);
      spread(co, left, M.T0, end);
      for (let q = 0; q < H; q++) { const m0 = toT(monthsList[q] + '-01'); if (M.T0 < m0 + 31 * DAY && end >= m0) act[q]++; }
    }
    for (let k = 0; k < H; k++) {
      acc.bookings[k].push(bk[k]); acc.cashIn[k].push(ci[k]); acc.cashOut[k].push(co[k]); acc.net[k].push(ci[k] - co[k]); acc.active[k].push(act[k]); acc.newJobs[k].push(nj[k]);
    }
    tot.bookings.push(bk.reduce((a, b) => a + b, 0)); tot.cashIn.push(ci.reduce((a, b) => a + b, 0)); tot.cashOut.push(co.reduce((a, b) => a + b, 0));
    tot.profit.push(profit); tot.newJobs.push(nj.reduce((a, b) => a + b, 0));
  }
  const band = a => ({ p10: pct(a, 0.1), p50: pct(a, 0.5), p90: pct(a, 0.9) });
  return {
    months: monthsList.map((m, k) => ({ month: m, bookings: band(acc.bookings[k]), cash_in: band(acc.cashIn[k]), cash_out: band(acc.cashOut[k]), net: band(acc.net[k]),
      prob_negative: Math.round(acc.net[k].filter(v => v < 0).length * 100 / sims), active_jobs: band(acc.active[k]), new_jobs: band(acc.newJobs[k]) })),
    totals: { bookings: band(tot.bookings), cash_in: band(tot.cashIn), cash_out: band(tot.cashOut), profit: band(tot.profit), new_jobs: band(tot.newJobs) },
  };
}

module.exports = { model, simulate, records, hashSeed, rng, poisson, pct };

// ---------- Rutas ----------
module.exports.routes = function forecastRoutes(db, add, h) {
  const { requireRole, fail, str, today, money } = h;
  add('GET', '/api/forecast', ({ user, query }) => {
    requireRole(user, 'owner');
    const n = (k, d, lo, hi) => { const v = Number(query.get(k)); return Number.isFinite(v) && query.get(k) !== null && query.get(k) !== '' ? Math.min(hi, Math.max(lo, v)) : d; };
    const params = { horizon: Math.round(n('horizon', 6, 1, 12)), close: n('close', 1, 0.3, 2), leads: n('leads', 1, 0.3, 3), price: n('price', 1, 0.5, 2), material: n('material', 0, -0.5, 1) };
    const M = model(db, money, today());
    const res = simulate(M, { ...params, sims: 2000, seed: hashSeed(today() + JSON.stringify(params)) });
    const capacity = M.cap || null;
    const typeLabel = t => (C.PROJECT_TYPES.find(p => p.key === t) || {}).es || t;
    const types = [...new Set(M.prices.map(p => p.type))];
    return { params, ...res, capacity,
      assumptions: {
        leads_per_month: Math.round(M.lambda * 10) / 10, close_rate: Math.round(M.pAll * 100), deposit_pct: Math.round(M.deposit * 100),
        days_to_close: M.daysToClose.length >= 5 ? median(M.daysToClose) : null, duration_days: M.durations.length >= 3 ? median(M.durations) : null,
        avg_deal_cents: M.prices.length ? Math.round(mean(M.prices.map(p => p.price))) : null, material_share: Math.round(M.materialShare * 100),
        margin_pct: Math.round(M.mAll.mean * 100),
        by_source: Object.values(M.bySource).map(s => ({ source: s.source, won: s.won, lost: s.lost, p: Math.round(s.p * 100) })).sort((a, b) => (b.won + b.lost) - (a.won + a.lost)),
        by_type: types.map(t => ({ project_type: t, label: typeLabel(t), jobs: M.prices.filter(p => p.type === t).length, avg_cents: Math.round(mean(M.priceBy(t))), margin_pct: Math.round(M.marginStats(t).mean * 100) })),
        season: M.season, open_deals: M.R.filter(r => r.open).length, active_jobs: M.R.filter(r => r.active).length,
      },
      data: M.stats };
  });
  add('PUT', '/api/forecast/capacity', ({ user, body }) => {
    requireRole(user, 'owner');
    const v = Math.round(Number(body.capacity) || 0);
    if (v < 0 || v > 100) fail(400, 'Capacidad inválida');
    db.prepare("INSERT INTO meta(key,value) VALUES('capacity_jobs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(v));
    return { ok: true };
  });

  // ---------- Importar historial (CSV) ----------
  const TEMPLATE = 'fecha_prospecto,fecha_cierre,fecha_terminado,cliente,tipo,origen,precio,costo,cerrado\n2025-03-02,2025-03-20,2025-05-01,Juan Pérez,Patio cover,Referido,"$28,500","$18,900",si\n2025-04-11,,,Ana Gómez,Cocina exterior,Google,"$45,000",,no\n';
  add('GET', '/api/history/template', ({ user }) => {
    requireRole(user, 'owner');
    return { $buffer: Buffer.from('﻿' + TEMPLATE, 'utf8'), $type: 'text/csv; charset=utf-8', $name: 'plantilla-historial-elevated.csv', $attach: true };
  });
  add('GET', '/api/history', ({ user }) => {
    requireRole(user, 'owner');
    const r = db.prepare("SELECT COUNT(*) n, SUM(won) w, MIN(COALESCE(NULLIF(lead_date,''),won_date)) a, MAX(COALESCE(NULLIF(won_date,''),lead_date)) b FROM hist_jobs").get();
    return { count: r.n, won: r.w || 0, from: r.a || '', to: r.b || '' };
  });
  add('DELETE', '/api/history', ({ user }) => {
    requireRole(user, 'owner');
    db.prepare('DELETE FROM hist_jobs').run();
    return { ok: true };
  });
  add('POST', '/api/history/import', ({ user, body }) => {
    requireRole(user, 'owner');
    const text = str(body.csv, 3_000_000);
    if (!text.trim()) fail(400, 'El archivo está vacío');
    const rows = parseCsv(text);
    if (rows.length < 2) fail(400, 'El archivo no tiene filas');
    const head = rows[0].map(h => norm(h));
    const col = names => head.findIndex(h => names.some(n => h === n || h.includes(n)));
    const ci = {
      lead: col(['fecha_prospecto', 'fecha prospecto', 'lead date', 'lead_date', 'fecha_contacto', 'fecha']),
      won: col(['fecha_cierre', 'fecha cierre', 'won date', 'close date', 'fecha_venta', 'fecha_firma']),
      done: col(['fecha_terminado', 'fecha terminado', 'completed', 'done date', 'fecha_fin']),
      client: col(['cliente', 'client', 'customer', 'nombre']), type: col(['tipo', 'type', 'proyecto', 'project']),
      source: col(['origen', 'source', 'fuente', 'como nos conocio', 'lead source']), price: col(['precio', 'price', 'contrato', 'contract', 'venta', 'total', 'amount']),
      cost: col(['costo', 'cost', 'gasto', 'expenses']), wonFlag: col(['cerrado', 'won', 'ganado', 'vendido', 'closed']),
    };
    if (ci.lead === ci.won && ci.lead >= 0) ci.lead = -1;
    if (ci.price < 0) fail(400, 'Falta la columna de precio (precio / price)');
    if (ci.lead < 0 && ci.won < 0) fail(400, 'Falta una columna de fecha (fecha_prospecto o fecha_cierre)');
    const errors = []; let imported = 0;
    const ins = db.prepare('INSERT INTO hist_jobs(lead_date,won_date,done_date,client,project_type,source,price_cents,cost_cents,won) VALUES(?,?,?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    try {
      rows.slice(1).forEach((r, i) => {
        if (!r.some(c => String(c).trim())) return;
        const g = k => ci[k] >= 0 ? String(r[ci[k]] ?? '').trim() : '';
        const lead = parseDate(g('lead')), wonD = parseDate(g('won')), done = parseDate(g('done'));
        const priceC = parseMoney(g('price')), costC = parseMoney(g('cost'));
        const flag = g('wonFlag').toLowerCase();
        const won = flag ? /^(s[ií]|y|yes|1|true|x|cerrad|ganad|vendid|won)/.test(flag) : !!wonD || !!done;
        if ((g('lead') && !lead) || (g('won') && !wonD) || (g('done') && !done)) { errors.push({ row: i + 2, error: 'fecha' }); return; }
        if (!lead && !wonD) { errors.push({ row: i + 2, error: 'fecha' }); return; }
        if (priceC == null || (won && !priceC)) { errors.push({ row: i + 2, error: 'precio' }); return; }
        ins.run(lead || '', wonD || (won ? lead : '') || '', done || '', g('client').slice(0, 120), mapType(g('type')), g('source').slice(0, 80), priceC, costC || 0, won ? 1 : 0);
        imported++;
      });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { imported, skipped: errors.length, errors: errors.slice(0, 50) };
  });
};

function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^﻿/, '').trim(); }
function parseCsv(text) {
  const t = text.replace(/^﻿/, '');
  const sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function parseDate(s) {
  if (!s) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y, mo, d;
  if (m) [, y, mo, d] = m;
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) { [, mo, d, y] = m; if (y.length === 2) y = '20' + y; }
  else return null;
  y = Number(y); mo = Number(mo); d = Number(d);
  if (mo > 12 && d <= 12) [mo, d] = [d, mo];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || y < 2000 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}
function parseMoney(s) {
  if (!s) return 0;
  const c = s.replace(/[$\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const v = Number(c.replace(',', '.'));
  return Number.isFinite(v) && v >= 0 && v < 1e8 ? Math.round(v * 100) : null;
}
function mapType(s) {
  const t = norm(s);
  if (!t) return 'otro';
  if (C.PROJECT_TYPES.some(p => p.key === t)) return t;
  if (/cocina|kitchen|grill|asador/.test(t)) return 'outdoor_kitchen';
  if (/chimenea|fireplace/.test(t)) return 'fireplace';
  if (/fogon|fire ?pit|firepit/.test(t)) return 'fire_pit';
  if (/\btv\b|tele/.test(t)) return 'tv_wall';
  if (/living|sala|completo|full/.test(t)) return 'outdoor_living';
  if (/patio|pergol|cover|techo|cubiert/.test(t)) return 'patio_cover';
  return 'otro';
}
module.exports.parseCsv = parseCsv; module.exports.parseDate = parseDate; module.exports.parseMoney = parseMoney; module.exports.mapType = mapType;
