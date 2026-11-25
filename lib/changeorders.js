'use strict';
// Fase 4 — Change orders como objeto propio y su cobro al cliente.
//  - Cada CO tiene código por categoría y número de la obra: GAS-01, PERMIT-02, ELEC-03… (se puede escribir otro).
//  - Estado: pendiente (esperando al cliente) → aprobado (suma al contrato) → facturado → cobrado. También rechazado.
//    "Cobrado" sale solo cuando los pagos del cliente cubren el CO; no se escribe a mano.
//  - "Trabajo hecho" es aparte: un CO puede estar cobrado y el trabajo todavía no (ej. granito pagado por adelantado).
//  - Un pago del cliente se puede aplicar a un CO; si no, los pagos van primero a las etapas del contrato y lo que sobra a los COs.
const CATS = [['CO', 'General', 'General'], ['GAS', 'Gas', 'Gas'], ['ELEC', 'Eléctrico', 'Electrical'], ['AV', 'Audio / video', 'Audio / video'], ['PLUMB', 'Plomería', 'Plumbing'],
  ['PERMIT', 'Permiso / ciudad', 'Permit / city'], ['CONC', 'Concreto', 'Concrete'], ['FRAME', 'Estructura', 'Framing'], ['ROOF', 'Techo', 'Roof'], ['STONE', 'Piedra', 'Stone'],
  ['GRAN', 'Granito / cubierta', 'Granite / countertop'], ['PAINT', 'Pintura / stain', 'Paint / stain'], ['LIGHT', 'Iluminación', 'Lighting'], ['LAND', 'Paisajismo', 'Landscape'], ['CREDIT', 'Crédito al cliente', 'Client credit']];
const PREFIX = new Set(CATS.map(c => c[0]));
const TZ = process.env.APP_TZ || 'America/Chicago';
const todayL = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

// Siguiente código de la obra: PREFIJO-NN, con el número corrido de toda la obra (GAS-01, PERMIT-02…).
function nextCode(db, jobId, prefix) {
  const p = String(prefix || 'CO').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CO';
  const nums = db.prepare("SELECT code FROM change_orders WHERE job_id=? AND code<>''").all(jobId).map(r => Number((/-(\d+)$/.exec(r.code) || [])[1]) || 0);
  return `${p}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0')}`;
}
function cleanCode(v) { return String(v || '').toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').slice(0, 20); }

// Estado de un CO aprobado según su invoice y lo cobrado.
function stateOf(c, paid, today = todayL()) {
  if (c.status !== 'aprobado') return c.status;
  if (c.price_cents <= 0) return 'aprobado';
  if (paid >= c.price_cents) return 'cobrado';
  if (c.invoice_number) return c.due_date && c.due_date < today ? 'vencido' : 'facturado';
  return 'aprobado';
}
// Reparte los pagos del cliente: los marcados a un CO van a ese CO; los demás, a las etapas en orden y lo que sobra a los COs.
function allocate(db, jobId, milestoneTotal) {
  const cos = db.prepare("SELECT * FROM change_orders WHERE job_id=? AND status<>'rechazado' ORDER BY date, id").all(jobId);
  const tagged = Object.fromEntries(db.prepare('SELECT co_id, COALESCE(SUM(amount_cents),0) v FROM payments WHERE job_id=? AND co_id IS NOT NULL GROUP BY co_id').all(jobId).map(r => [r.co_id, r.v]));
  const general = db.prepare('SELECT COALESCE(SUM(amount_cents),0) v FROM payments WHERE job_id=? AND co_id IS NULL').get(jobId).v;
  let left = Math.max(0, general - milestoneTotal);
  const today = todayL();
  const out = cos.map(c => {
    let paid = tagged[c.id] || 0;
    if (c.status === 'aprobado' && c.price_cents > 0 && paid < c.price_cents && left > 0) { const x = Math.min(left, c.price_cents - paid); paid += x; left -= x; }
    return { id: c.id, code: c.code, category: c.category, date: c.date, description: c.description, price_cents: c.price_cents, status: c.status, state: stateOf(c, paid, today),
      paid_cents: paid, left_cents: c.status === 'aprobado' ? Math.max(0, c.price_cents - paid) : 0, done_at: c.done_at, approved_at: c.approved_at,
      invoice_number: c.invoice_number, invoiced_at: c.invoiced_at, due_date: c.due_date };
  });
  return { cos: out, general_cents: general, milestone_paid_cents: Math.min(general, milestoneTotal) };
}

module.exports = { CATS, PREFIX, nextCode, cleanCode, stateOf, allocate };
