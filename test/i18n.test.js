'use strict';
// Verifica que todo texto de la interfaz y del servidor tenga traducción al inglés.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { translateError, MESSAGES, LABELS } = require('../lib/i18n');
const C = require('../lib/catalog');

const root = path.join(__dirname, '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/i18n.js'), 'utf8'), sandbox);
const EN = sandbox.window.EN_DICT;

test('cada texto de la interfaz tiene inglés', () => {
  const js = ['public/app.js', 'public/app2.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const keys = [...new Set([...js.matchAll(/\b(?:t\(|tl\(\w+, )'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]))];
  const missing = keys.filter(k => !(k in EN));
  assert.deepEqual(missing, [], 'Faltan traducciones');
  for (const k of keys) {
    const ph = s => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(EN[k]), ph(k), `Los {marcadores} no coinciden en: ${k}`);
  }
});

test('cada mensaje de error del servidor tiene inglés', () => {
  const src = ['lib/api.js', 'server.js', 'lib/sales.js', 'lib/plan.js', 'lib/materials.js', 'lib/board.js', 'lib/pmreport.js', 'lib/recover.js', 'lib/lines.js', 'lib/importer.js', 'lib/agents.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const plain = [...src.matchAll(/(?:fail\(\d+, |HttpError\(\d+, |error: )'([^']+)'/g)].map(m => m[1]);
  for (const m of new Set(plain)) assert.ok(MESSAGES[m], `Sin traducción: ${m}`);
  const labels = [...src.matchAll(/\b(?:need|needDate|cents|oneOf|date)\([^()]*?'([^']+)'(?:, \d+)?(?:, \{[^}]*\})?\)/g)].map(m => m[1]);
  for (const l of new Set(labels)) assert.ok(LABELS[l], `Etiqueta sin traducción: ${l}`);
  assert.equal(translateError('Falta: nombre del cliente', 'en'), 'Missing: client name');
  assert.equal(translateError('Falta: nombre del cliente', 'es'), 'Falta: nombre del cliente');
});

test('catálogo y plantillas en los dos idiomas', () => {
  for (const list of [C.CATEGORIES, C.JOB_STATUS, C.PROJECT_TYPES]) for (const x of list) assert.ok(x.es && x.en, x.key);
  for (const p of C.PROJECT_TYPES) for (const pair of p.tasks) assert.ok(pair.length === 2 && pair[0] && pair[1], p.key);
});
