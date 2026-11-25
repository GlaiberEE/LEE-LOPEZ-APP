'use strict';
// Listas fijas de la empresa, en español (es) e inglés (en).

const CATEGORIES = [
  { key: 'material', es: 'Material', en: 'Materials' },
  { key: 'mano_obra', es: 'Mano de obra (horas)', en: 'Labor (hours)' },
  { key: 'subcontratistas', es: 'Subcontratistas', en: 'Subcontractors' },
  { key: 'permisos', es: 'Permisos y registro', en: 'Permits & registration' },
  { key: 'renta_equipo', es: 'Renta de equipo', en: 'Equipment rental' },
  { key: 'basura', es: 'Basura, acarreo y landfill', en: 'Trash, hauling & landfill' },
  { key: 'retrabajo', es: 'Retrabajo y arreglos', en: 'Rework & fixes' },
  { key: 'otro', es: 'Otro', en: 'Other' },
];

// Gastos generales de la empresa (no son de una obra): la herramienta va aquí.
const COMPANY_CATEGORIES = [
  { key: 'herramienta', es: 'Herramienta', en: 'Tools' },
  { key: 'equipo', es: 'Equipo y maquinaria', en: 'Equipment & machinery' },
  { key: 'vehiculo', es: 'Vehículos y trailers', en: 'Vehicles & trailers' },
  { key: 'gasolina', es: 'Gasolina', en: 'Fuel' },
  { key: 'seguro', es: 'Seguros', en: 'Insurance' },
  { key: 'oficina', es: 'Oficina y papelería', en: 'Office & supplies' },
  { key: 'software', es: 'Software y teléfono', en: 'Software & phone' },
  { key: 'marketing', es: 'Marketing', en: 'Marketing' },
  { key: 'licencias', es: 'Licencias y registros', en: 'Licenses & registrations' },
  { key: 'seguridad', es: 'Uniformes y seguridad', en: 'Uniforms & safety' },
  { key: 'reparaciones', es: 'Reparación y mantenimiento', en: 'Repairs & maintenance' },
  { key: 'renta', es: 'Renta (oficina o bodega)', en: 'Rent (office or yard)' },
  { key: 'basura', es: 'Basura y landfill', en: 'Trash & landfill' },
  { key: 'otro', es: 'Otro', en: 'Other' },
];
// Cómo se pagó un ticket.
const PAY_METHODS = [
  { key: 'tarjeta', es: 'Tarjeta de la compañía', en: 'Company card' },
  { key: 'cod', es: 'C.O.D. (se paga al recibir)', en: 'C.O.D.' },
  { key: 'cheque', es: 'Cheque de la compañía', en: 'Company check' },
  { key: 'zelle', es: 'Zelle / transferencia', en: 'Zelle / transfer' },
  { key: 'efectivo', es: 'Efectivo', en: 'Cash' },
  { key: 'propio', es: 'Dinero propio (reembolso)', en: 'Own money (reimbursement)' },
  { key: 'otro', es: 'Otro', en: 'Other' },
];
const DEFAULT_VENDORS = ["Lowe's", 'Home Depot', 'ABC Supply', 'Leroy Jordan', 'Amazon'];

// Plantillas sugeridas por tipo de obra, armadas por TRADE (estudio de mercado, nov 2026: guías de permisos de
// ciudades de Texas, orden de trades de baños y cocinas, y cómo trabaja Elevated Exteriors).
// Cada tarea: [español, inglés, trade, días, ¿inspección?]. El trade es de la misma lista que fotos y materiales
// (lib/trades.js). Las inspecciones no tienen trade: las agenda la oficina. Son solo el punto de partida:
// cada compañía las copia y las ajusta en Obras → Plantillas.
const I = (es, en) => [es, en, '', 1, true];
const PERMIT = [['Medir y hacer planos', 'Measure and draw plans', 'planos', 2], ['Someter permiso', 'Submit permit', 'planos', 1], ['Esperar aprobación del permiso', 'Wait for permit approval', 'planos', 5]];
const LOCATE = ['Llamar al 811 (ubicar líneas)', 'Call 811 (utility locate)', 'excavacion', 2];
const PROJECT_TYPES = [
  { key: 'patio_cover', es: 'Patio cover', en: 'Patio cover', tasks: [
    ...PERMIT, LOCATE, ['Excavar pilares y armar varilla', 'Dig piers and set rebar', 'excavacion', 1], I('Inspección de pilares (antes de colar)', 'Pier inspection (before pouring)'),
    ['Colar pilares', 'Pour piers', 'concreto', 1], ['Postes y vigas', 'Posts and beams', 'carpinteria', 2], ['Rafters y unión a la casa', 'Rafters and ledger to the house', 'carpinteria', 2],
    ['Deck del techo', 'Roof decking', 'carpinteria', 1], ['Underlayment, flashing y tejas', 'Underlayment, flashing and shingles', 'techo', 2],
    ['Eléctrico rough (abanico, luces, contactos)', 'Rough electrical (fan, lights, outlets)', 'electricidad', 1], I('Inspección de framing y eléctrico rough', 'Framing and rough electrical inspection'),
    ['Cielo de cedro T&G', 'Cedar T&G ceiling', 'carpinteria', 2], ['Forrar postes y vigas (trim)', 'Wrap posts and beams (trim)', 'carpinteria', 2], ['Stain / pintura', 'Stain / paint', 'pintura', 2],
    ['Terminar eléctrico (abanicos y luces)', 'Finish electrical (fans and lights)', 'electricidad', 1], ['Punch list y limpieza', 'Punch list and clean up', 'limpieza', 1],
    I('Inspección final', 'Final inspection'), ['Fotos finales y walk-through con el cliente', 'Final photos and client walk-through', 'limpieza', 1]] },
  { key: 'outdoor_living', es: 'Outdoor living', en: 'Outdoor living', tasks: [
    ...PERMIT, LOCATE, ['Excavar pilares y zapatas', 'Dig piers and footings', 'excavacion', 2], I('Inspección de pilares y zapatas', 'Pier and footing inspection'),
    ['Colar pilares y zapatas', 'Pour piers and footings', 'concreto', 1], ['Postes, vigas y rafters', 'Posts, beams and rafters', 'carpinteria', 3], ['Deck del techo', 'Roof decking', 'carpinteria', 1],
    ['Techo', 'Roofing', 'techo', 2], ['Block de cocina y base de chimenea', 'Kitchen block and fireplace base', 'piedra', 3], ['Caja de fuego y chimenea', 'Firebox and chimney', 'piedra', 3],
    ['Gas rough', 'Rough gas', 'gas', 1], ['Plomería rough (fregadero)', 'Rough plumbing (sink)', 'plomeria', 1], ['Eléctrico rough', 'Rough electrical', 'electricidad', 2],
    ['A/V y bajo voltaje rough (bocinas, TV)', 'Rough A/V and low voltage (speakers, TV)', 'av', 1], I('Inspección rough: framing, eléctrico, plomería y gas', 'Rough inspection: framing, electrical, plumbing and gas'),
    ['Confirmar con foto plugs, A/V, luz y gas antes de forrar', 'Confirm plugs, A/V, lights and gas with photos before closing', 'otro', 1],
    ['Cielo de cedro T&G', 'Cedar T&G ceiling', 'carpinteria', 2], ['Forrar postes y vigas (trim)', 'Wrap posts and beams (trim)', 'carpinteria', 2], ['Piedra de cocina y chimenea', 'Kitchen and fireplace stone', 'piedra', 4],
    ['Medida de cubierta', 'Countertop template', 'cubierta', 1], ['Instalar cubierta (5–10 días después de la medida)', 'Install countertop (5–10 days after template)', 'cubierta', 1], ['Stain / pintura', 'Stain / paint', 'pintura', 2],
    ['Instalar parrilla y refrigerador', 'Install grill and fridge', 'equipos', 1], ['Terminar eléctrico y A/V', 'Finish electrical and A/V', 'electricidad', 1], ['Terminar gas', 'Finish gas', 'gas', 1],
    ['Punch list y limpieza', 'Punch list and clean up', 'limpieza', 1], I('Inspección final', 'Final inspection'), ['Fotos finales y walk-through con el cliente', 'Final photos and client walk-through', 'limpieza', 1]] },
  { key: 'outdoor_kitchen', es: 'Cocina exterior', en: 'Outdoor kitchen', tasks: [
    ['Medir y diseñar', 'Measure and design', 'planos', 1], ['Permiso aparte para la cocina', 'Separate permit for the kitchen', 'planos', 1], ['Esperar aprobación del permiso', 'Wait for permit approval', 'planos', 5],
    LOCATE, ['Trazo y excavación de zapata', 'Layout and footing excavation', 'excavacion', 1], I('Inspección de zapata', 'Footing inspection'), ['Colar zapata o losa', 'Pour footing or slab', 'concreto', 1],
    ['Estructura de block o metal', 'Block or steel structure', 'piedra', 3], ['Gas rough', 'Rough gas', 'gas', 1], ['Plomería rough', 'Rough plumbing', 'plomeria', 1], ['Eléctrico rough (GFCI)', 'Rough electrical (GFCI)', 'electricidad', 1],
    I('Inspección rough y prueba de presión de gas', 'Rough inspection and gas pressure test'), ['Piedra / acabado', 'Stone / veneer', 'piedra', 3], ['Medida de cubierta', 'Countertop template', 'cubierta', 1],
    ['Instalar cubierta (5–10 días después de la medida)', 'Install countertop (5–10 days after template)', 'cubierta', 1], ['Instalar equipos', 'Install appliances', 'equipos', 1],
    ['Terminar gas, plomería y eléctrico', 'Finish gas, plumbing and electrical', 'gas', 1], ['Limpieza', 'Clean up', 'limpieza', 1], I('Inspección final de gas y liberación del medidor', 'Final gas inspection and meter release')] },
  { key: 'fireplace', es: 'Chimenea', en: 'Fireplace', tasks: [
    ['Hacer planos', 'Draw plans', 'planos', 1], ['Someter permiso', 'Submit permit', 'planos', 1], ['Esperar aprobación del permiso', 'Wait for permit approval', 'planos', 5], LOCATE,
    ['Excavar zapata y armar varilla', 'Dig footing and set rebar', 'excavacion', 1], I('Inspección de zapata', 'Footing inspection'), ['Colar zapata', 'Pour footing', 'concreto', 1],
    ['Base de block y losa del hogar', 'Block base and hearth slab', 'piedra', 2], ['Caja de fuego con ladrillo refractario', 'Firebox with firebrick', 'piedra', 2], ['Gas rough (si aplica)', 'Rough gas (if needed)', 'gas', 1],
    I('Inspección de mampostería y gas rough', 'Masonry and rough gas inspection'), ['Chimenea y flue', 'Chimney and flue', 'piedra', 3], ['Piedra exterior', 'Stone veneer', 'piedra', 4],
    ['Hogar y repisa (hearth y mantel)', 'Hearth and mantel', 'piedra', 1], ['Tapa y matachispas', 'Chimney cap and spark arrestor', 'piedra', 1], ['Terminar gas (quemador o troncos)', 'Finish gas (burner or logs)', 'gas', 1],
    ['Limpieza', 'Clean up', 'limpieza', 1], I('Inspección final', 'Final inspection')] },
  { key: 'fire_pit', es: 'Fire pit', en: 'Fire pit', tasks: [
    ['Medir y marcar', 'Measure and lay out', 'planos', 1], LOCATE, ['Excavar y base de grava', 'Excavate and gravel base', 'excavacion', 1], ['Línea de gas', 'Gas line', 'gas', 1], I('Inspección de gas', 'Gas inspection'),
    ['Block', 'Block', 'piedra', 1], ['Piedra y tapa', 'Stone and cap', 'piedra', 2], ['Quemador y prueba', 'Burner and test', 'gas', 1], ['Limpieza', 'Clean up', 'limpieza', 1]] },
  { key: 'tv_wall', es: 'Muro de piedra para TV', en: 'Stone TV wall', tasks: [
    ['Medir y diseñar', 'Measure and design', 'planos', 1], ['Enmarcar el muro', 'Frame the wall', 'carpinteria', 2], ['Eléctrico rough', 'Rough electrical', 'electricidad', 1],
    ['Bajo voltaje rough (TV, bocinas)', 'Rough low voltage (TV, speakers)', 'av', 1], I('Inspección rough', 'Rough inspection'),
    ['Confirmar con foto TV, bocinas y contactos antes de cerrar', 'Confirm TV, speakers and outlets with photos before closing', 'otro', 1], ['Backer y malla', 'Backer and lath', 'piedra', 1],
    ['Piedra', 'Stone', 'piedra', 3], ['Repisa o nicho', 'Mantel or niche', 'carpinteria', 1], ['Terminar A/V y montaje de TV', 'Finish A/V and TV mount', 'av', 1], ['Limpieza', 'Clean up', 'limpieza', 1]] },
  // Interiores (normalmente JKL Homes).
  { key: 'bano', es: 'Remodelación de baño', en: 'Bathroom remodel', tasks: [
    ['Diseño y permiso', 'Design and permit', 'planos', 2], ['Proteger áreas y demolición', 'Protect areas and demolition', 'demolicion', 2], ['Framing y bloqueo', 'Framing and blocking', 'carpinteria', 1],
    ['Plomería rough', 'Rough plumbing', 'plomeria', 2], ['Eléctrico rough y extractor', 'Rough electrical and exhaust fan', 'electricidad', 1], I('Inspección rough (no se cierra sin aprobarla)', 'Rough inspection (do not close walls before it passes)'),
    ['Aislamiento, drywall y cement board', 'Insulation, drywall and cement board', 'drywall', 3], ['Impermeabilizar y prueba de inundación de 24 h', 'Waterproofing and 24-hour flood test', 'azulejo', 2],
    ['Azulejo de regadera y piso', 'Shower and floor tile', 'azulejo', 4], ['Pintura', 'Paint', 'pintura', 2], ['Vanity y gabinetes', 'Vanity and cabinets', 'gabinetes', 1], ['Cubierta', 'Countertop', 'cubierta', 1],
    ['Terminar plomería (sanitario y llaves)', 'Finish plumbing (toilet and faucets)', 'plomeria', 1], ['Terminar eléctrico', 'Finish electrical', 'electricidad', 1],
    ['Cristal de regadera (se mide después del azulejo; tarda 1–3 semanas)', 'Shower glass (measured after tile; 1–3 weeks)', 'vidrio', 1], ['Accesorios, punch list y limpieza', 'Accessories, punch list and clean up', 'limpieza', 1],
    I('Inspección final', 'Final inspection')] },
  { key: 'cocina_interior', es: 'Remodelación de cocina', en: 'Kitchen remodel', tasks: [
    ['Diseño y pedir gabinetes (6–10 semanas antes)', 'Design and order cabinets (6–10 weeks ahead)', 'planos', 2], ['Permiso', 'Permit', 'planos', 1], ['Proteger áreas y demolición', 'Protect areas and demolition', 'demolicion', 2],
    ['Framing / cambios de muros', 'Framing / wall changes', 'carpinteria', 1], ['Plomería rough', 'Rough plumbing', 'plomeria', 1], ['Eléctrico rough', 'Rough electrical', 'electricidad', 2],
    ['Campana y ventilación', 'Hood and ventilation', 'otro', 1], I('Inspección rough', 'Rough inspection'), ['Aislamiento y drywall', 'Insulation and drywall', 'drywall', 4], ['Pisos', 'Flooring', 'pisos', 2],
    ['Instalar gabinetes', 'Install cabinets', 'gabinetes', 3], ['Medida de cubierta (solo con gabinetes fijos)', 'Countertop template (only with cabinets fixed)', 'cubierta', 1],
    ['Instalar cubierta (5–10 días después de la medida)', 'Install countertop (5–10 days after template)', 'cubierta', 1], ['Backsplash', 'Backsplash', 'azulejo', 2],
    ['Terminar plomería, eléctrico y equipos', 'Finish plumbing, electrical and appliances', 'equipos', 1], ['Pintura, herrajes y limpieza', 'Paint, hardware and clean up', 'pintura', 2], I('Inspección final', 'Final inspection')] },
  { key: 'remodelacion', es: 'Remodelación interior', en: 'Interior remodel', tasks: [
    ['Diseño y permiso', 'Design and permit', 'planos', 2], ['Proteger áreas y demolición', 'Protect areas and demolition', 'demolicion', 2], ['Framing', 'Framing', 'carpinteria', 2],
    ['Plomería rough', 'Rough plumbing', 'plomeria', 1], ['Eléctrico rough', 'Rough electrical', 'electricidad', 2], ['HVAC (ductos)', 'HVAC (ducts)', 'otro', 1], I('Inspección rough', 'Rough inspection'),
    ['Aislamiento', 'Insulation', 'drywall', 1], ['Drywall: colgar, encintar y textura', 'Drywall: hang, tape and texture', 'drywall', 4], ['Primer y pintura', 'Primer and paint', 'pintura', 3],
    ['Pisos', 'Flooring', 'pisos', 3], ['Trim y puertas', 'Trim and doors', 'carpinteria', 2], ['Terminar plomería y eléctrico', 'Finish plumbing and electrical', 'electricidad', 1],
    ['Punch list y limpieza', 'Punch list and clean up', 'limpieza', 1], I('Inspección final', 'Final inspection')] },
  { key: 'otro', es: 'Otro', en: 'Other', tasks: [['Inicio de proyecto', 'Project start', '', 1], ['Limpieza', 'Clean up', 'limpieza', 1]] },
];
// Tareas que la app ponía sola antes de v2.15 (para reconocerlas, traducirlas y poder quitarlas).
const LEGACY_TASKS = [["Hacer planos", "Make plans"], ["Someter planos para permiso", "Submit plans for permit"], ["Esperar aprobación / modificación del permiso", "Wait for permit approval / revisions"], ["Inicio de proyecto", "Project start"], ["Excavar pilares, armar jaula de varilla, colocar y apuntalar postes", "Dig piers, build rebar cages, set and brace posts"], ["Inspección de pilares (se puede seguir enmarcando; no rellenar huecos)", "Pier inspection (framing can continue; do not fill holes)"], ["Colar concreto en pilares (solo con inspección aprobada)", "Pour pier concrete (only after inspection passes)"], ["Enmarcar el patio cover", "Frame the patio cover"], ["Tejas (shingles)", "Shingles"], ["Electricidad (rough)", "Rough electrical"], ["Pedir inspección de rough frame + rough eléctrico", "Call for rough framing + rough electrical inspections"], ["Cerrar techo y forrar postes, vigas y paredes (con ambas inspecciones aprobadas)", "Close ceiling and wrap posts, beams and walls (after both inspections pass)"], ["Pintura / stain", "Paint / stain"], ["Terminar electricidad", "Finish electrical"], ["Limpieza", "Clean up"], ["Inspección final", "Final inspection"], ["Esperar aprobación del permiso", "Wait for permit approval"], ["Trazo y excavación de base", "Layout and base excavation"], ["Inspección de base / cimiento", "Footing inspection"], ["Colar base", "Pour footing"], ["Estructura (block / metal)", "Structure (block / steel)"], ["Gas, electricidad y plomería (rough)", "Rough gas, electrical and plumbing"], ["Inspección rough", "Rough inspection"], ["Piedra / acabado exterior", "Stone / veneer"], ["Medida de cubierta (template)", "Countertop template"], ["Instalar cubierta", "Install countertop"], ["Instalar equipos (parrilla, refrigerador, etc.)", "Install appliances (grill, fridge, etc.)"], ["Terminar gas y electricidad", "Finish gas and electrical"], ["Excavar cimiento", "Dig footing"], ["Inspección de cimiento", "Footing inspection"], ["Colar cimiento", "Pour footing"], ["Estructura de block / caja de fuego", "Block structure / firebox"], ["Chimenea / tiro", "Chimney / flue"], ["Línea de gas (si aplica)", "Gas line (if needed)"], ["Inspección", "Inspection"], ["Piedra", "Stone"], ["Hogar y repisa (hearth & mantel)", "Hearth & mantel"], ["Trazo", "Layout"], ["Excavación y base", "Excavation and base"], ["Block", "Block"], ["Piedra y tapa", "Stone and cap"], ["Prueba de gas", "Gas test"], ["Estructura / enmarcado", "Framing"], ["Electricidad y bajo voltaje (rough)", "Rough electrical and low voltage"], ["Repisa / nicho", "Mantel / niche"], ["Preparar montaje de TV", "TV mount prep"], ["Proteger áreas y demolición", "Protect areas and demolition"], ["Plomería (rough)", "Rough plumbing"], ["Enmarcado y bloqueo", "Framing and blocking"], ["Tablaroca / cement board", "Drywall / cement board"], ["Impermeabilizar regadera", "Waterproof shower"], ["Azulejo de regadera y piso", "Shower and floor tile"], ["Pintura", "Paint"], ["Gabinetes y cubierta", "Cabinets and countertop"], ["Terminar plomería y electricidad", "Finish plumbing and electrical"], ["Cristal de regadera", "Shower glass"], ["Accesorios y detalles", "Hardware and punch list"], ["Plomería y electricidad (rough)", "Rough plumbing and electrical"], ["Tablaroca y pintura", "Drywall and paint"], ["Instalar gabinetes", "Install cabinets"], ["Backsplash", "Backsplash"], ["Instalar equipos", "Install appliances"], ["Enmarcado", "Framing"], ["Tablaroca", "Drywall"], ["Pisos", "Flooring"], ["Trim y puertas", "Trim and doors"]];

const JOB_STATUS = [
  { key: 'prospecto', es: 'Prospecto', en: 'Lead' },
  { key: 'cotizado', es: 'Cotizado', en: 'Estimate sent' },
  { key: 'activo', es: 'En obra', en: 'In progress' },
  { key: 'terminado', es: 'Terminado', en: 'Completed' },
  { key: 'cancelado', es: 'Cancelado', en: 'Cancelled' },
];

const WARRANTY_MONTHS = 12;

// Cambios a estimados/invoices ya aceptados de más de esta cantidad necesitan a los 2 dueños.
// (Si en la app hay un solo dueño activo, basta con uno.)
const DUAL_APPROVAL_CENTS = 100000; // $1,000

// Motivos para mover una tarea de fecha.
const DELAY_REASONS = [
  { key: 'inspeccion', es: 'Inspección pendiente o rechazada', en: 'Inspection pending or failed' },
  { key: 'clima', es: 'Clima', en: 'Weather' },
  { key: 'material', es: 'Material no llegó', en: 'Material delay' },
  { key: 'permiso', es: 'Permiso', en: 'Permit' },
  { key: 'cliente', es: 'Pedido del cliente', en: 'Client request' },
  { key: 'sub', es: 'Disponibilidad del sub', en: 'Sub availability' },
  { key: 'tarea_anterior', es: 'Se movió la tarea anterior', en: 'Previous task was moved' },
  { key: 'otro', es: 'Otro', en: 'Other' },
];

// Pares [español, inglés] de todas las tareas de plantilla, para mostrar
// cada tarea en el idioma de quien la lee.
function taskPairs() {
  const seen = new Map();
  for (const [es, en] of LEGACY_TASKS) seen.set(es, en);
  for (const t of PROJECT_TYPES) for (const [es, en] of t.tasks) seen.set(es, en);
  return [...seen.entries()];
}

module.exports = { CATEGORIES, COMPANY_CATEGORIES, PAY_METHODS, DEFAULT_VENDORS, PROJECT_TYPES, LEGACY_TASKS, JOB_STATUS, WARRANTY_MONTHS, DELAY_REASONS, DUAL_APPROVAL_CENTS, taskPairs };
