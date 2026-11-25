'use strict';
// v2.15: ya no se meten tareas solas; plantillas editables por tipo de obra; limpiar tareas sin historia;
// importar el SCHEDULE (pegado o .xlsx) a una obra que ya existe.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-tpl-'));
  const srv = createServer({ dataDir: dir });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: u => call('DELETE', u) };
  };
  const owner = client();
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
  await owner.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
  const mk = async (name, role, extra = {}) => (await owner.post('/api/users', { name, username: name.toLowerCase(), password: 'otra-clave-larga-1', role, ...extra })).body.id;
  const mario = await mk('Mario', 'pm'); await mk('Pedro', 'worker');
  const as = async u => { const c = client(); await c.post('/api/login', { username: u, password: 'otra-clave-larga-1' }); return c; };
  return { srv, owner, mario, pm: await as('mario'), sub: await as('pedro') };
}
const tasksOf = async (c, id) => (await c.get(`/api/jobs/${id}`)).body.tasks;

test('obra nueva: en blanco por defecto, o con la plantilla de la compañía o la sugerida', async () => {
  const { srv, owner } = await start();
  try {
    const blank = (await owner.post('/api/jobs', { client_name: 'Melbourne', project_type: 'patio_cover', status: 'activo' })).body;
    assert.equal((await tasksOf(owner, blank.id)).length, 0, 'ya no se meten 16 tareas solas');
    const base = (await owner.post('/api/jobs', { client_name: 'Base', project_type: 'patio_cover', template: 'base' })).body;
    assert.equal((await tasksOf(owner, base.id)).length, 20);
    // Plantilla propia, marcada por defecto: sale sola en el tipo de obra.
    const sug = (await owner.get('/api/task-templates')).body.suggested;
    assert.ok(sug.find(s => s.project_type === 'remodelacion').tasks.length > 5, 'trae la remodelación interior de JKL');
    const tpl = (await owner.post('/api/task-templates', { name: 'JKL interior', project_type: 'remodelacion', is_default: true,
      tasks: [{ title: 'Demo', days: 2 }, { title: 'Rough plumbing', days: 1 }, { title: 'Rough inspection', inspection: true }, { title: '' }] })).body;
    assert.equal(tpl.tasks.length, 3); assert.equal(tpl.is_default, true);
    const j = (await owner.post('/api/jobs', { client_name: 'Kitchen', project_type: 'remodelacion', start_date: '2026-12-01' })).body;
    const tk = await tasksOf(owner, j.id);
    assert.deepEqual(tk.map(t => t.title), ['Demo', 'Rough plumbing', 'Rough inspection']);
    assert.equal(tk[0].planned_date, '2026-12-01'); assert.ok(tk[1].planned_date > '2026-12-01', 'con fechas desde el inicio');
    assert.ok(srv.db.prepare("SELECT 1 FROM permits WHERE job_id=? AND kind='inspeccion' AND name='Rough inspection'").get(j.id), 'la inspección queda en Permisos');
    // Solo una por defecto por tipo; editar; quitar.
    const t2 = (await owner.post('/api/task-templates', { name: 'Otra', project_type: 'remodelacion', is_default: true, tasks: [{ title: 'X' }] })).body;
    const saved = (await owner.get('/api/task-templates')).body.saved;
    assert.deepEqual(saved.filter(s => s.is_default).map(s => s.id), [t2.id]);
    const ed = (await owner.put(`/api/task-templates/${tpl.id}`, { tasks: [{ title: 'Demolition', days: 3 }], name: 'JKL' })).body;
    assert.equal(ed.tasks[0].title, 'Demolition'); assert.equal(ed.name, 'JKL');
    assert.equal((await owner.put(`/api/task-templates/${tpl.id}`, { tasks: [] })).status, 400);
    assert.equal((await owner.post('/api/jobs', { client_name: 'Z', template: 99999 })).status, 400);
    assert.equal((await owner.del(`/api/task-templates/${t2.id}`)).status, 200);
    assert.equal((await tasksOf(owner, (await owner.post('/api/jobs', { client_name: 'Y', project_type: 'remodelacion' })).body.id)).length, 0);
  } finally { srv.close(); }
});

test('el PM usa plantillas pero no las cambia; el sub nada', async () => {
  const { srv, owner, mario, pm, sub } = await start();
  try {
    const j = (await owner.post('/api/jobs', { client_name: 'PM', project_type: 'patio_cover', status: 'activo', pm_id: mario })).body;
    await owner.put(`/api/jobs/${j.id}`, { pm_id: mario });
    assert.equal((await pm.get('/api/task-templates')).status, 200);
    assert.equal((await pm.post('/api/task-templates', { name: 'x', tasks: [{ title: 'a' }] })).status, 403);
    assert.equal((await pm.post(`/api/jobs/${j.id}/apply-template`, { template: 'base' })).status, 200);
    assert.equal((await tasksOf(owner, j.id)).length, 20);
    assert.equal((await sub.get('/api/task-templates')).status, 403);
    assert.equal((await sub.post(`/api/jobs/${j.id}/schedule/preview`, { text: 'a' })).status, 403);
    const other = (await owner.post('/api/jobs', { client_name: 'Otra' })).body;
    assert.equal((await pm.post(`/api/jobs/${other.id}/schedule/preview`, { text: 'a' })).status, 404, 'no es su obra');
  } finally { srv.close(); }
});

test('quitar las tareas automáticas: solo las que no tienen historia', async () => {
  const { srv, owner } = await start();
  try {
    const j = (await owner.post('/api/jobs', { client_name: 'Kilmichael', project_type: 'patio_cover', template: 'base', status: 'activo' })).body;
    const tk = await tasksOf(owner, j.id);
    await owner.put(`/api/tasks/${tk[0].id}`, { status: 'hecho' });
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await owner.post(`/api/jobs/${j.id}/photos`, { dataUrl: PNG, task_id: tk[1].id });
    const list = (await owner.get(`/api/jobs/${j.id}/task-cleanup`)).body;
    assert.ok(list.every(t => t.auto), 'las reconoce como las que ponía la app');
    assert.deepEqual(list.filter(t => t.blocked.length).map(t => t.id).sort(), [tk[0].id, tk[1].id].sort());
    const r = (await owner.post(`/api/jobs/${j.id}/task-cleanup`, { ids: list.map(t => t.id) })).body;
    assert.equal(r.removed, 18);
    assert.deepEqual((await tasksOf(owner, j.id)).map(t => t.id).sort(), [tk[0].id, tk[1].id].sort(), 'lo hecho y con fotos se queda');
    assert.ok(srv.db.prepare("SELECT 1 FROM audit_log WHERE entity='tareas' AND summary LIKE '%18 tarea%'").get());
  } finally { srv.close(); }
});

test('SCHEDULE pegado de Google Sheets: vista previa, reemplazar y no duplicar', async () => {
  const { srv, owner } = await start();
  try {
    const j = (await owner.post('/api/jobs', { client_name: 'Melbourne', project_type: 'patio_cover', template: 'base', status: 'activo' })).body;
    await owner.post(`/api/jobs/${j.id}/lines`, { code: 'PC-01', trade: 'Patio cover', sold_cents: 100000 });
    const text = 'TRADE ID\tTASK NAME\tSTATUS\tSTART PLANNED\tEND PLANNED\tEND ACTUAL\tNOTES\n'
      + 'PC-01\t4 piers 24x24x36\tDone\t11/04/2026\t11/04/2026\t11/04/2026\t\n'
      + 'ELEC-01\tRough electrical\tIn progress\t11/07/2026\t\t\tUF cable\n'
      + '\tGas inspection\t\t11/23/2026\t\t\t';
    const pv = (await owner.post(`/api/jobs/${j.id}/schedule/preview`, { text })).body;
    assert.equal(pv.tasks.length, 3); assert.equal(pv.current, 20); assert.equal(pv.removable, 20);
    assert.equal(pv.tasks[0].line, true); assert.equal(pv.tasks[0].status, 'hecho');
    const ap = (await owner.post(`/api/jobs/${j.id}/schedule/apply`, { text, mode: 'replace', skip: [2] })).body;
    assert.deepEqual([ap.created, ap.removed], [2, 20]);
    const tk = await tasksOf(owner, j.id);
    assert.deepEqual(tk.map(t => [t.title, t.status]), [['4 piers 24x24x36', 'hecho'], ['Rough electrical', 'en_progreso']]);
    assert.equal(tk[0].done_date, '2026-11-04'); assert.ok(tk[0].line_id, 'ligada a su partida');
    const again = (await owner.post(`/api/jobs/${j.id}/schedule/apply`, { text, mode: 'add' })).body;
    assert.deepEqual([again.created, again.skipped], [1, 2], 'lo que ya está no se repite');
    assert.equal(srv.db.prepare('SELECT start_date FROM jobs WHERE id=?').get(j.id).start_date, '2026-11-04');
    // Una lista simple también sirve; algo que no tiene tareas no.
    assert.equal((await owner.post(`/api/jobs/${j.id}/schedule/preview`, { text: 'Footing\nFrame\n' })).body.tasks.length, 2);
    assert.equal((await owner.post(`/api/jobs/${j.id}/schedule/preview`, { text: '   ' })).status, 400);
    assert.equal((await owner.post(`/api/jobs/${j.id}/schedule/preview`, { file: 'data:application/octet-stream;base64,AAAA' })).status, 400);
  } finally { srv.close(); }
});
