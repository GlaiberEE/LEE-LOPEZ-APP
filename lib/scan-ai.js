'use strict';
// Lee un ticket o documento de gasto con IA (Claude). Necesita internet y la variable ANTHROPIC_API_KEY.
// Sin clave, la app sigue funcionando: guarda la foto y usted llena los datos con un toque.
const C = require('./catalog');

const MODEL = process.env.SCAN_MODEL || 'claude-haiku-5-5';
const API_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01';

const PROMPT = `You are reading a purchase receipt, ticket, invoice or delivery ticket for a construction company (outdoor living: patio covers, outdoor kitchens, fireplaces).
Return ONLY a JSON object, no other text, with these keys:
{
 "vendor": store or company name (string, "" if unknown),
 "date": purchase date as "YYYY-MM-DD" ("" if unknown),
 "total": final total paid in dollars as a number (null if unknown),
 "tax": tax in dollars as a number (null if unknown),
 "items": up to 8 short item descriptions (array of strings),
 "category": one of ${C.CATEGORIES.map(c => `"${c.key}"`).join(', ')} (material = building materials/hardware; renta_equipo = equipment rental; basura = dumpster/hauling; permisos = city permits/fees; otro = anything else),
 "job_hint": any job name, PO number, project name, customer name or delivery/job-site address printed on the document, copied exactly ("" if none),
 "doc_type": "receipt" | "invoice" | "delivery" | "other",
 "text": the main readable text of the document, up to 600 characters
}`;

function enabled() { return !!process.env.ANTHROPIC_API_KEY; }

async function extract({ buf, mime }) {
  if (!enabled()) return null;
  const data = buf.toString('base64');
  const block = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data } };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': API_VERSION },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }] }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body.error && body.error.message) || `HTTP ${res.status}`);
    const txt = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    return parseResult(txt);
  } finally { clearTimeout(timer); }
}

// Convierte la respuesta en datos limpios (nunca confía ciegamente en lo que regresa).
function parseResult(txt) {
  const m = /\{[\s\S]*\}/.exec(String(txt || ''));
  if (!m) throw new Error('No se pudo leer el ticket');
  let j; try { j = JSON.parse(m[0]); } catch { throw new Error('No se pudo leer el ticket'); }
  const num = v => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n > 0 && n < 1e7 ? Math.round(n * 100) : null; };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(j.date || '')) ? j.date : '';
  return {
    vendor: String(j.vendor || '').slice(0, 120),
    date,
    total_cents: num(j.total),
    tax_cents: num(j.tax),
    items: Array.isArray(j.items) ? j.items.map(x => String(x).slice(0, 120)).slice(0, 8) : [],
    category: C.CATEGORIES.some(c => c.key === j.category) && j.category !== 'subcontratistas' ? j.category : 'material',
    job_hint: String(j.job_hint || '').slice(0, 300),
    doc_type: ['receipt', 'invoice', 'delivery', 'other'].includes(j.doc_type) ? j.doc_type : 'receipt',
    text: String(j.text || '').slice(0, 1500),
  };
}

module.exports = { extract, enabled, parseResult, MODEL };
