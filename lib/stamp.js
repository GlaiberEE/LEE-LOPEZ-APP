'use strict';
// Versión de la app y huella de la interfaz (versión + contenido de los archivos), calculada una vez al arrancar.
// La huella cambia con cada versión publicada: así el teléfono sabe que tiene que actualizarse.
const fs = require('node:fs');
const path = require('node:path');
const PUBLIC = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const STAMP = (() => {
  const h = require('node:crypto').createHash('sha256');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach(e => {
    const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(js|css|html|webmanifest)$/.test(e.name)) h.update(e.name).update(fs.readFileSync(f));
  });
  walk(PUBLIC);
  return VERSION + '-' + h.digest('hex').slice(0, 8);
})();
module.exports = { VERSION, STAMP };
