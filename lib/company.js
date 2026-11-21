'use strict';
// Empresas: cada empresa (Elevated Exteriors, JKL Homes…) tiene su propia base de datos y sus propios archivos.
// Nada se mezcla: una obra, un gasto o un cliente de una empresa nunca aparece en la otra.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = [
  { key: 'ee', name: 'Elevated Exteriors', city: 'Double Oak, TX', logo: 'ee' },
  { key: 'jkl', name: 'JKL Homes', city: 'Double Oak, TX', logo: '' },
];
function loadConfig(dataDir) {
  const f = path.join(dataDir, 'empresas.json');
  try { const c = JSON.parse(fs.readFileSync(f, 'utf8')); if (Array.isArray(c) && c.length) return c; } catch { /* sin archivo */ }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(f, JSON.stringify(DEFAULTS, null, 2));
  return DEFAULTS;
}
function saveConfig(dataDir, list) { fs.writeFileSync(path.join(dataDir, 'empresas.json'), JSON.stringify(list, null, 2)); }
// La primera empresa usa la carpeta de datos de siempre (compatibilidad); las demás, datos/empresas/<clave>.
const dirFor = (dataDir, list, key) => key === list[0].key ? dataDir : path.join(dataDir, 'empresas', key);
// Datos de la empresa para PDFs y pantallas.
function info(db) {
  const g = k => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
  return { key: g('company_key') || 'ee', name: g('company_name') || 'Elevated Exteriors', city: g('company_city') || 'Double Oak, TX', logo: (g('company_logo') ?? 'ee') === 'ee', primary: g('company_primary') !== '0' };
}
function stamp(db, c, primary) {
  db.prepare("INSERT INTO meta(key,value) VALUES('company_primary',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(primary ? '1' : '0');
  const put = db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING');
  put.run('company_key', c.key); put.run('company_name', c.name); put.run('company_city', c.city || ''); put.run('company_logo', c.logo || '');
}
module.exports = { loadConfig, saveConfig, dirFor, info, stamp, DEFAULTS };
