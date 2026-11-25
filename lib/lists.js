'use strict';
// v2.33: listas que cada compañía ajusta (sin tocar el código): categorías de gastos de obra, gastos de la compañía,
// formas de pago de tickets y trades. Los dueños agregan, cambian el nombre (es/en) o esconden; nunca se borra
// nada que ya tenga gastos, así los registros viejos siguen con su nombre. Lo escondido no sale en las listas para escoger.
const C = require('./catalog');
const TRADE_BASE = [
  { key: "planos", es: "Planos y permisos", en: "Plans and permits" },
  { key: "demolicion", es: "Demolición", en: "Demolition" },
  { key: "excavacion", es: "Excavación y base", en: "Excavation and footing" },
  { key: "concreto", es: "Concreto", en: "Concrete" },
  { key: "carpinteria", es: "Carpintería / estructura", en: "Carpentry / framing" },
  { key: "techo", es: "Techo", en: "Roofing" },
  { key: "electricidad", es: "Electricidad", en: "Electrical" },
  { key: "av", es: "Audio / video y bajo voltaje", en: "Audio / video and low voltage" },
  { key: "plomeria", es: "Plomería", en: "Plumbing" },
  { key: "gas", es: "Gas", en: "Gas" },
  { key: "piedra", es: "Piedra / mampostería", en: "Stone / masonry" },
  { key: "cubierta", es: "Cubierta / granito", en: "Countertops / granite" },
  { key: "drywall", es: "Drywall / acabados", en: "Drywall / finishes" },
  { key: "azulejo", es: "Azulejo", en: "Tile" },
  { key: "gabinetes", es: "Gabinetes", en: "Cabinets" },
  { key: "pisos", es: "Pisos", en: "Flooring" },
  { key: "pintura", es: "Pintura / stain", en: "Paint / stain" },
  { key: "vidrio", es: "Vidrio / cristal", en: "Glass" },
  { key: "equipos", es: "Equipos (appliances)", en: "Appliances" },
  { key: "paisajismo", es: "Paisajismo", en: "Landscaping" },
  { key: "limpieza", es: "Limpieza", en: "Cleanup" },
  { key: "otro", es: "Otro", en: "Other" },
];
// Formas de pago a los subs: la clave es el nombre en español (así se guardan los pagos desde siempre).
const SUBPAY_BASE = [['Zelle', 'Zelle'], ['Cheque', 'Check'], ['Depósito directo', 'Direct deposit'], ['Transferencia', 'Bank transfer'], ['Efectivo', 'Cash'], ['Tarjeta', 'Card'], ['Otro', 'Other']]
  .map(([es, en]) => ({ key: es, es, en }));
const BASE = { gasto: C.CATEGORIES, empresa: C.COMPANY_CATEGORIES, pago: C.PAY_METHODS, pagosub: SUBPAY_BASE, trade: TRADE_BASE };
// Las que la app necesita para funcionar: se les cambia el nombre, pero no se esconden.
const LOCKED = { gasto: ['material', 'subcontratistas', 'mano_obra', 'otro'], empresa: ['herramienta', 'equipo', 'otro'], pago: ['propio', 'otro'], pagosub: ['Otro'], trade: ['otro'] };
const LISTS = Object.keys(BASE);
const NAMES = { gasto: 'Gastos de obra', empresa: 'Gastos de la compañía', pago: 'Pago de tickets', pagosub: 'Pagos a subs', trade: 'Trades' };

function rows(db, list) {
  try { return db.prepare('SELECT * FROM list_items WHERE list=? ORDER BY sort, id').all(list); } catch { return []; }
}
// La lista completa (con lo escondido marcado). Primero las de fábrica, luego las agregadas.
function get(db, list) {
  const over = new Map(rows(db, list).map(r => [r.key, r]));
  const base = BASE[list].map(b => { const o = over.get(b.key); return { key: b.key, es: (o && o.es) || b.es, en: (o && o.en) || b.en, hidden: !!(o && o.hidden), custom: false, locked: LOCKED[list].includes(b.key) }; });
  const extra = rows(db, list).filter(r => r.custom).map(r => ({ key: r.key, es: r.es, en: r.en || r.es, hidden: !!r.hidden, custom: true, locked: false }));
  // "Otro" siempre al final.
  const last = x => x.key === 'otro' || x.key === 'Otro';
  const all = [...base.filter(x => !last(x)), ...extra, ...base.filter(last)];
  return all;
}
const keys = (db, list) => get(db, list).map(x => x.key);
const label = (db, list, k, lang = 'es') => { const x = get(db, list).find(i => i.key === k); return x ? x[lang] || x.es : k; };
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28);

function routes(db, add, h) {
  const { requireRole, fail, str } = h;
  const onlyOwners = user => { requireRole(user, 'owner'); if (user.isPm || user.isOffice || user.is_agent) fail(403, 'Las listas solo las cambian los dueños'); };
  const okList = l => (LISTS.includes(l) ? l : fail(404, 'Lista no encontrada'));
  const used = (list, key) => {
    const q = { gasto: 'SELECT COUNT(*) n FROM expenses WHERE category=?', empresa: 'SELECT COUNT(*) n FROM company_expenses WHERE category=?', pago: 'SELECT (SELECT COUNT(*) FROM expenses WHERE pay_method=?1) + (SELECT COUNT(*) FROM company_expenses WHERE pay_method=?1) n', pagosub: 'SELECT COUNT(*) n FROM sub_payments WHERE method=?', trade: 'SELECT COUNT(*) n FROM tasks WHERE trade=?' }[list];
    try { return db.prepare(q).get(key).n; } catch { return 0; }
  };
  const log = (user, summary) => db.prepare("INSERT INTO audit_log(user_id,action,entity,summary) VALUES(?,?,?,?)").run(user.id, 'editar', 'listas', summary);
  add('GET', '/api/lists', ({ user }) => {
    requireRole(user, 'owner');
    return LISTS.map(l => ({ list: l, name: NAMES[l], items: get(db, l).map(x => ({ ...x, used: used(l, x.key) })) }));
  });
  add('POST', '/api/lists/:list', ({ user, params, body }) => {
    onlyOwners(user); const list = okList(params.list);
    const es = str(body.es, 60); if (!es) fail(400, 'Escriba el nombre');
    const en = str(body.en, 60) || es;
    if (get(db, list).some(x => x.es.toLowerCase() === es.toLowerCase())) fail(409, 'Ya hay una con ese nombre');
    let key = 'x_' + (slug(es) || 'item'); let n = 2; const ks = keys(db, list); while (ks.includes(key)) key = 'x_' + slug(es) + '_' + n++;
    if (list === 'pagosub') { key = es.slice(0, 40); if (ks.includes(key)) fail(409, 'Ya hay una con ese nombre'); }
    db.prepare('INSERT INTO list_items(list,key,es,en,custom,sort) VALUES(?,?,?,?,1,?)').run(list, key, es, en, Date.now() % 1e9);
    log(user, `${NAMES[list]}: agregó "${es}"`);
    return get(db, list).find(x => x.key === key);
  });
  add('PUT', '/api/lists/:list/:key', ({ user, params, body }) => {
    onlyOwners(user); const list = okList(params.list);
    const cur = get(db, list).find(x => x.key === params.key); if (!cur) fail(404, 'No encontrado');
    const es = 'es' in body ? (str(body.es, 60) || fail(400, 'Escriba el nombre')) : cur.es;
    const en = 'en' in body ? (str(body.en, 60) || es) : cur.en;
    const hidden = 'hidden' in body ? !!body.hidden : cur.hidden;
    if (hidden && cur.locked) fail(400, 'Esta la necesita la app: se le puede cambiar el nombre, pero no esconder');
    db.prepare(`INSERT INTO list_items(list,key,es,en,hidden,custom) VALUES(?,?,?,?,?,?)
      ON CONFLICT(list,key) DO UPDATE SET es=excluded.es, en=excluded.en, hidden=excluded.hidden`).run(list, cur.key, es, en, hidden ? 1 : 0, cur.custom ? 1 : 0);
    const what = [es !== cur.es && `nombre "${cur.es}" → "${es}"`, en !== cur.en && `inglés "${en}"`, hidden !== cur.hidden && (hidden ? 'escondida' : 'visible otra vez')].filter(Boolean).join(', ');
    if (what) log(user, `${NAMES[list]}: ${cur.es}: ${what}`);
    return get(db, list).find(x => x.key === cur.key);
  });
}
module.exports = { get, keys, label, routes, LISTS, BASE, LOCKED };
