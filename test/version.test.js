'use strict';
// v2.17.1: la app sabe su versión y avisa cuando el servidor tiene una nueva.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const pkg = require('../package.json');

test('versión: status, app.js y sw.js llevan la misma huella; novedades al día', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-ver-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const st = await (await fetch(base + '/api/status')).json();
    assert.equal(st.version, pkg.version);
    assert.ok(st.stamp.startsWith(pkg.version + '-'), 'la huella empieza con la versión');
    const js = await (await fetch(base + '/app.js')).text();
    assert.ok(js.includes(`const CODE_STAMP = ${JSON.stringify(st.stamp)};`), 'app.js sabe con qué versión se cargó');
    const sw = await (await fetch(base + '/sw.js')).text();
    assert.ok(sw.includes(`const VERSION = 'ee-${st.stamp}';`), 'el service worker cambia con cada versión');
    assert.equal((await fetch(base + '/api/release-notes')).status, 401);
    const notes = require('../lib/releases');
    assert.equal(notes[0].version, pkg.version, 'cada versión publicada lleva sus novedades (lib/releases.js)');
    for (const r of notes) assert.ok(r.es.length && r.es.length === r.en.length, `novedades en español e inglés: ${r.version}`);
  } finally { srv.close(); }
});
