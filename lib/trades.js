'use strict';
// Trades (oficios): clasifican fotos, materiales y tareas, y dicen qué hace cada crew o sub (puede ser más de uno).
const TRADES = ['planos', 'demolicion', 'excavacion', 'concreto', 'carpinteria', 'techo', 'electricidad', 'av', 'plomeria', 'gas', 'piedra', 'cubierta',
  'drywall', 'azulejo', 'gabinetes', 'pisos', 'pintura', 'vidrio', 'equipos', 'paisajismo', 'limpieza', 'otro'];
// Trades agregados por la compañía (v2.33) usan claves x_… (lib/lists.js).
const tradeOk = v => { const s = String(v || '').trim(); return TRADES.includes(s) || /^x_[a-z0-9_]{1,40}$/.test(s) ? s : ''; };
// Lista de trades (arreglo o "a,b,c") → texto "a,b,c" solo con los válidos, sin repetir.
const tradeList = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map(tradeOk).filter(Boolean))].join(',');
const hasTrade = (list, k) => !!k && String(list || '').split(',').includes(k);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Adivina el trade por el texto (nombre de tarea, oficio escrito a mano, "Concrete", "Electricidad"…).
const RULES = [['av', /\ba\/?v\b|audio|video|bajo voltaje|low voltage|bocina|speaker|\btv\b/], ['electricidad', /electr|luces|lights|abanico|\bfan\b/], ['plomeria', /plom|plumb|fregadero|sink/],
  ['gas', /\bgas\b/], ['demolicion', /demol/], ['concreto', /concret|colar|pour|losa|slab/], ['excavacion', /excav|trazo|811|zapata|footing|pier|pilar/],
  ['techo', /techo|shingle|roof|teja/], ['azulejo', /azulejo|tile|backsplash|impermeab|waterproof/], ['gabinetes', /gabinet|cabinet|vanity/], ['pisos', /piso|floor/],
  ['vidrio', /cristal|vidrio|glass/], ['equipos', /equipos|appliance|parrilla|grill|refriger|fridge/], ['cubierta', /cubierta|granit|counter/],
  ['piedra', /piedra|stone|mason|block|ladrill|brick|chimenea|chimney|firebox|hogar|hearth/], ['drywall', /drywall|tablaroca|aislamiento|insulat|textur/],
  ['pintura', /pint|stain|paint|primer/], ['carpinteria', /carpin|estructur|fram|madera|hardie|siding|fascia|soffit|cedar|cedro|pergol|rafter|poste|post|viga|beam|deck|trim|puerta|door/],
  ['paisajismo', /paisaj|landsc|pasto|grass|riego|irrigat/], ['limpieza', /limpi|clean|punch/], ['planos', /plano|permis|plan\b|plans\b|permit|diseñ|design|medir|measure/]];
function guessTrade(...texts) { const s = norm(texts.filter(Boolean).join(' ')); for (const [k, re] of RULES) if (re.test(s)) return k; return ''; }
// Un trade de plantilla puede venir como clave ("techo") o como texto ("Roofing").
const tradeKey = v => tradeOk(v) || guessTrade(v);
module.exports = { TRADES, tradeOk, tradeList, hasTrade, guessTrade, tradeKey };
