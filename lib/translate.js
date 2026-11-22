'use strict';
// Traducción automática entre español e inglés de lo que escriben las personas (casos, avisos de atraso,
// notas del día, novedades al cliente y mensajes de texto). Cada quien lee en su idioma; el original siempre se guarda.
//  - Usa la misma clave de AI que la lectura de tickets: ANTHROPIC_API_KEY (Claude) o XAI_API_KEY (Grok).
//  - Sin clave, no traduce y todo sigue igual (nunca hace fallar una acción).
//  - Una sola llamada detecta el idioma y da las dos versiones; se guarda para no volver a pagar por lo mismo.
const crypto = require('node:crypto');

const LANGS = ['es', 'en'];
const API_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';
const MODEL = () => process.env.TRANSLATE_MODEL || 'claude-haiku-5-5';
const XAI_MODEL = () => process.env.XAI_TRANSLATE_MODEL || 'grok-4.3';
const MAX = 4000;
let testProvider = null;

const provider = () => (testProvider ? 'test' : process.env.ANTHROPIC_API_KEY ? 'claude' : process.env.XAI_API_KEY ? 'grok' : '');
const enabled = () => !!provider();
const hash = t => crypto.createHash('sha1').update(String(t)).digest('hex');
// Nada que traducir: vacío, solo números, montos, fechas o emojis.
const worth = t => { const s = String(t || '').trim(); return s.length >= 2 && /[a-záéíóúñü]{2,}/i.test(s); };

const PROMPT = `You translate messages for a construction company in Texas (outdoor living: patio covers, outdoor kitchens, fireplaces). People write in Spanish (Mexican/Texan) or English.
Detect the language of the message and give it in both languages. Keep the meaning and tone; use the words people on a job site use (footing, rough-in, stain, trim, drywall, permiso, cimbra, varilla…).
Never change names, numbers, money amounts, dates, addresses, job codes (like EE-0002) or measurements. If a part is already in the other language, translate it too. Do not add anything.
Return ONLY JSON: {"source":"es" | "en" | "other","es":"<Spanish>","en":"<English>"}
Message:
`;

function parse(txt) {
  const m = String(txt || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Respuesta sin JSON');
  const j = JSON.parse(m[0]);
  const source = ['es', 'en'].includes(j.source) ? j.source : 'other';
  return { source, es: String(j.es || '').slice(0, MAX * 2), en: String(j.en || '').slice(0, MAX * 2) };
}

async function callAI(text) {
  if (testProvider) return testProvider(text);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    if (provider() === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': API_VERSION },
        body: JSON.stringify({ model: MODEL(), max_tokens: 2500, messages: [{ role: 'user', content: PROMPT + text }] }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
      return parse((body.content || []).filter(c => c.type === 'text').map(c => c.text).join(''));
    }
    const res = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.XAI_API_KEY}` },
      body: JSON.stringify({ model: XAI_MODEL(), max_tokens: 2500, temperature: 0, messages: [{ role: 'user', content: PROMPT + text }] }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
    return parse(((body.choices || [])[0] || {}).message?.content || '');
  } finally { clearTimeout(timer); }
}

const table = new WeakSet();
function ready(db) {
  if (table.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS translations (h TEXT NOT NULL, lang TEXT NOT NULL, src TEXT NOT NULL DEFAULT '', out TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (h, lang))`);
  table.add(db);
}

const inflight = new Map(); // h → promesa (para no pedir lo mismo dos veces a la vez)
// Traduce y guarda. Nunca lanza: si falla, regresa null y se reintenta la próxima vez que alguien lo lea.
async function translateOne(db, text) {
  ready(db);
  const t = String(text || '').slice(0, MAX);
  if (!worth(t) || !enabled()) return null;
  const h = hash(t);
  if (db.prepare('SELECT 1 FROM translations WHERE h=? LIMIT 1').get(h)) return true;
  if (inflight.has(h)) return inflight.get(h);
  const p = (async () => {
    try {
      const r = await callAI(t);
      const ins = db.prepare('INSERT OR REPLACE INTO translations(h,lang,src,out) VALUES(?,?,?,?)');
      for (const l of LANGS) ins.run(h, l, r.source, r.source === l ? t : (r[l] || t));
      return true;
    } catch (e) { console.error('[traducción]', e.message); return null; }
    finally { inflight.delete(h); }
  })();
  inflight.set(h, p);
  return p;
}

// Espera las traducciones (al guardar algo), con tiempo máximo para no hacer esperar a nadie.
async function ensure(db, texts, ms = 8000) {
  if (!enabled()) return;
  const list = [...new Set((Array.isArray(texts) ? texts : [texts]).filter(worth))];
  if (!list.length) return;
  await Promise.race([Promise.all(list.map(t => translateOne(db, t))), new Promise(r => setTimeout(r, ms).unref?.())]);
}

// Lo que ve un lector: { tr: texto en su idioma, from: idioma original } si está traducido y es distinto;
// null si no hace falta. Si todavía no está traducido, lo manda traducir en segundo plano.
function forReader(db, text, lang) {
  if (!text || !enabled() || !LANGS.includes(lang)) return null;
  ready(db);
  const t = String(text).slice(0, MAX);
  if (!worth(t)) return null;
  const r = db.prepare('SELECT src, out FROM translations WHERE h=? AND lang=?').get(hash(t), lang);
  if (!r) { translateOne(db, t); return { pending: true }; }
  if (r.src === lang || r.out === t || r.src === 'other' && !r.out) return null;
  return { tr: r.out, from: r.src };
}
// Agrega campos traducidos a un objeto: tr(obj, 'body', lang) → obj.body_tr / obj.body_from
function addTr(db, obj, field, lang) {
  const r = forReader(db, obj[field], lang);
  if (r && r.tr) { obj[field + '_tr'] = r.tr; obj[field + '_from'] = r.from; }
  else if (r && r.pending) obj[field + '_pending'] = true;
  return obj;
}
// Texto en un idioma (para mandar un SMS en el idioma de quien lo recibe). Espera la traducción.
async function toLang(db, text, lang) {
  if (!enabled() || !LANGS.includes(lang) || !worth(text)) return { text, translated: false };
  await translateOne(db, text);
  ready(db);
  const r = db.prepare('SELECT src, out FROM translations WHERE h=? AND lang=?').get(hash(String(text).slice(0, MAX)), lang);
  if (!r || r.src === lang || !r.out || r.out === text) return { text, translated: false, src: r && r.src };
  return { text: r.out, translated: true, src: r.src };
}

module.exports = { enabled, provider, ensure, forReader, addTr, toLang, worth, parse, LANGS,
  setTestProvider: fn => { testProvider = fn; }, _flush: () => Promise.all([...inflight.values()]) };
