'use strict';
// Listas fijas de la empresa, en español (es) e inglés (en).
// Para cambiar una plantilla de tareas, edite este archivo y reinicie la app
// (solo afecta obras nuevas). Cada tarea es [español, inglés].

const CATEGORIES = [
  { key: 'material', es: 'Material', en: 'Materials' },
  { key: 'mano_obra', es: 'Mano de obra (horas)', en: 'Labor (hours)' },
  { key: 'subcontratistas', es: 'Subcontratistas', en: 'Subcontractors' },
  { key: 'permisos', es: 'Permisos y registro', en: 'Permits & registration' },
  { key: 'renta_equipo', es: 'Renta de equipo', en: 'Equipment rental' },
  { key: 'basura', es: 'Basura y acarreo', en: 'Trash & hauling' },
  { key: 'retrabajo', es: 'Retrabajo y arreglos', en: 'Rework & fixes' },
  { key: 'otro', es: 'Otro', en: 'Other' },
];

// Orden base para cualquier obra con estructura (framing).
const FRAMING = [
  ['Hacer planos', 'Make plans'],
  ['Someter planos para permiso', 'Submit plans for permit'],
  ['Esperar aprobación / modificación del permiso', 'Wait for permit approval / revisions'],
  ['Inicio de proyecto', 'Project start'],
  ['Excavar pilares, armar jaula de varilla, colocar y apuntalar postes', 'Dig piers, build rebar cages, set and brace posts'],
  ['Inspección de pilares (se puede seguir enmarcando; no rellenar huecos)', 'Pier inspection (framing can continue; do not fill holes)'],
  ['Colar concreto en pilares (solo con inspección aprobada)', 'Pour pier concrete (only after inspection passes)'],
  ['Enmarcar el patio cover', 'Frame the patio cover'],
  ['Tejas (shingles)', 'Shingles'],
  ['Electricidad (rough)', 'Rough electrical'],
  ['Pedir inspección de rough frame + rough eléctrico', 'Call for rough framing + rough electrical inspections'],
  ['Cerrar techo y forrar postes, vigas y paredes (con ambas inspecciones aprobadas)', 'Close ceiling and wrap posts, beams and walls (after both inspections pass)'],
  ['Pintura / stain', 'Paint / stain'],
  ['Terminar electricidad', 'Finish electrical'],
  ['Limpieza', 'Clean up'],
  ['Inspección final', 'Final inspection'],
];

const PLAN = [['Hacer planos', 'Make plans'], ['Someter planos para permiso', 'Submit plans for permit'], ['Esperar aprobación del permiso', 'Wait for permit approval'], ['Inicio de proyecto', 'Project start']];

// Plantillas sugeridas: revíselas y ajústelas a como trabajan ustedes.
const PROJECT_TYPES = [
  { key: 'patio_cover', es: 'Patio cover', en: 'Patio cover', tasks: FRAMING },
  { key: 'outdoor_living', es: 'Outdoor living', en: 'Outdoor living', tasks: FRAMING },
  { key: 'outdoor_kitchen', es: 'Cocina exterior', en: 'Outdoor kitchen', tasks: [
    ...PLAN, ['Trazo y excavación de base', 'Layout and base excavation'], ['Inspección de base / cimiento', 'Footing inspection'],
    ['Colar base', 'Pour footing'], ['Estructura (block / metal)', 'Structure (block / steel)'], ['Gas, electricidad y plomería (rough)', 'Rough gas, electrical and plumbing'],
    ['Inspección rough', 'Rough inspection'], ['Piedra / acabado exterior', 'Stone / veneer'], ['Medida de cubierta (template)', 'Countertop template'],
    ['Instalar cubierta', 'Install countertop'], ['Instalar equipos (parrilla, refrigerador, etc.)', 'Install appliances (grill, fridge, etc.)'],
    ['Terminar gas y electricidad', 'Finish gas and electrical'], ['Limpieza', 'Clean up'], ['Inspección final', 'Final inspection'],
  ] },
  { key: 'fireplace', es: 'Chimenea', en: 'Fireplace', tasks: [
    ...PLAN, ['Excavar cimiento', 'Dig footing'], ['Inspección de cimiento', 'Footing inspection'], ['Colar cimiento', 'Pour footing'],
    ['Estructura de block / caja de fuego', 'Block structure / firebox'], ['Chimenea / tiro', 'Chimney / flue'], ['Línea de gas (si aplica)', 'Gas line (if needed)'],
    ['Inspección', 'Inspection'], ['Piedra', 'Stone'], ['Hogar y repisa (hearth & mantel)', 'Hearth & mantel'], ['Limpieza', 'Clean up'], ['Inspección final', 'Final inspection'],
  ] },
  { key: 'fire_pit', es: 'Fire pit', en: 'Fire pit', tasks: [
    ['Trazo', 'Layout'], ['Excavación y base', 'Excavation and base'], ['Línea de gas (si aplica)', 'Gas line (if needed)'], ['Block', 'Block'],
    ['Piedra y tapa', 'Stone and cap'], ['Prueba de gas', 'Gas test'], ['Limpieza', 'Clean up'],
  ] },
  { key: 'tv_wall', es: 'Muro de piedra para TV', en: 'Stone TV wall', tasks: [
    ['Hacer planos', 'Make plans'], ['Estructura / enmarcado', 'Framing'], ['Electricidad y bajo voltaje (rough)', 'Rough electrical and low voltage'],
    ['Inspección rough', 'Rough inspection'], ['Piedra', 'Stone'], ['Repisa / nicho', 'Mantel / niche'], ['Preparar montaje de TV', 'TV mount prep'],
    ['Terminar electricidad', 'Finish electrical'], ['Limpieza', 'Clean up'],
  ] },
  // Interiores (normalmente JKL Homes).
  { key: 'bano', es: 'Remodelación de baño', en: 'Bathroom remodel', tasks: [
    ['Proteger áreas y demolición', 'Protect areas and demolition'], ['Plomería (rough)', 'Rough plumbing'], ['Electricidad (rough)', 'Rough electrical'],
    ['Enmarcado y bloqueo', 'Framing and blocking'], ['Inspección rough', 'Rough inspection'], ['Tablaroca / cement board', 'Drywall / cement board'],
    ['Impermeabilizar regadera', 'Waterproof shower'], ['Azulejo de regadera y piso', 'Shower and floor tile'], ['Pintura', 'Paint'],
    ['Gabinetes y cubierta', 'Cabinets and countertop'], ['Terminar plomería y electricidad', 'Finish plumbing and electrical'], ['Cristal de regadera', 'Shower glass'],
    ['Accesorios y detalles', 'Hardware and punch list'], ['Limpieza', 'Clean up'],
  ] },
  { key: 'cocina_interior', es: 'Remodelación de cocina', en: 'Kitchen remodel', tasks: [
    ['Proteger áreas y demolición', 'Protect areas and demolition'], ['Plomería y electricidad (rough)', 'Rough plumbing and electrical'], ['Inspección rough', 'Rough inspection'],
    ['Tablaroca y pintura', 'Drywall and paint'], ['Instalar gabinetes', 'Install cabinets'], ['Medida de cubierta (template)', 'Countertop template'],
    ['Instalar cubierta', 'Install countertop'], ['Backsplash', 'Backsplash'], ['Instalar equipos', 'Install appliances'], ['Terminar plomería y electricidad', 'Finish plumbing and electrical'],
    ['Accesorios y detalles', 'Hardware and punch list'], ['Limpieza', 'Clean up'],
  ] },
  { key: 'remodelacion', es: 'Remodelación interior', en: 'Interior remodel', tasks: [
    ['Proteger áreas y demolición', 'Protect areas and demolition'], ['Enmarcado', 'Framing'], ['Plomería y electricidad (rough)', 'Rough plumbing and electrical'],
    ['Inspección rough', 'Rough inspection'], ['Tablaroca', 'Drywall'], ['Pisos', 'Flooring'], ['Pintura', 'Paint'], ['Trim y puertas', 'Trim and doors'],
    ['Terminar plomería y electricidad', 'Finish plumbing and electrical'], ['Accesorios y detalles', 'Hardware and punch list'], ['Limpieza', 'Clean up'],
  ] },
  { key: 'otro', es: 'Otro', en: 'Other', tasks: [['Inicio de proyecto', 'Project start'], ['Limpieza', 'Clean up']] },
];

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
  for (const t of PROJECT_TYPES) for (const [es, en] of t.tasks) seen.set(es, en);
  return [...seen.entries()];
}

module.exports = { CATEGORIES, PROJECT_TYPES, JOB_STATUS, WARRANTY_MONTHS, DELAY_REASONS, DUAL_APPROVAL_CENTS, taskPairs };
