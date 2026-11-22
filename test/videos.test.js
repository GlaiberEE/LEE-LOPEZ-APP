'use strict';
// v2.9: videos de ayuda servidos por pedazos (Range), como los pide el iPhone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

test('los videos de ayuda se mandan completos o por pedazos', async () => {
  const srv = createServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ee-vid-')) });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const size = fs.statSync(path.join(__dirname, '..', 'public', 'tutoriales', 'es', 'instalar.mp4')).size;
    const all = await fetch(base + '/tutoriales/es/instalar.mp4');
    assert.equal(all.status, 200); assert.equal(all.headers.get('content-type'), 'video/mp4'); assert.equal(all.headers.get('accept-ranges'), 'bytes');
    assert.equal((await all.arrayBuffer()).byteLength, size);
    const part = await fetch(base + '/tutoriales/es/instalar.mp4', { headers: { range: 'bytes=100-199' } });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 100-199/${size}`);
    assert.equal((await part.arrayBuffer()).byteLength, 100);
    const tail = await fetch(base + '/tutoriales/es/instalar.mp4', { headers: { range: 'bytes=-50' } });
    assert.equal(tail.status, 206); assert.equal((await tail.arrayBuffer()).byteLength, 50);
    const bad = await fetch(base + '/tutoriales/es/instalar.mp4', { headers: { range: `bytes=${size + 10}-` } });
    assert.equal(bad.status, 416); await bad.arrayBuffer();
    for (const lg of ['es', 'en']) for (const v of ['instalar', 'duenos', 'pm', 'subs']) for (const ext of ['mp4', 'jpg']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'tutoriales', lg, v + '.' + ext)), lg + '/' + v + '.' + ext);
  } finally { srv.close(); }
});
