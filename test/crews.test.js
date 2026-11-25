'use strict';
// v2.16: cada tarea con su trade; un crew/sub con varios trades; asignación sola y "asignar por trade".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-crew-'));
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
  const pedro = await mk('Pedro', 'worker', { trades: ['carpinteria', 'techo', 'pintura', 'nada'] });
  const luis = await mk('Luis', 'worker', { trades: 'electricidad,av' });
  const jr = await mk('Junior', 'worker', { trades: ['excavacion', 'concreto'] });
  const ana = await mk('Ana', 'worker', { trades: ['electricidad'] });
  const as = async u => { const c = client(); await c.post('/api/login', { username: u, password: 'otra-clave-larga-1' }); return c; };
  return { srv, owner, ids: { pedro, luis, jr, ana }, sub: await as('pedro') };
}
const tasksOf = async (c, id) => (await c.get(`/api/jobs/${id}`)).body.tasks;

test('cada crew con sus trades: la plantilla asigna sola cada tarea al crew que hace ese trade', async () => {
  const { srv, owner, ids } = await start();
  try {
    const users = (await owner.get('/api/users')).body;
    assert.deepEqual(users.find(u => u.id === ids.pedro).trades, ['carpinteria', 'techo', 'pintura'], 'solo trades válidos');
    const j = (await owner.post('/api/jobs', { client_name: 'Melbourne', project_type: 'patio_cover', status: 'activo' })).body;
    for (const [n, id] of [['Pedro', ids.pedro], ['Luis', ids.luis], ['Junior', ids.jr]]) await owner.post(`/api/jobs/${j.id}/subs`, { name: n, user_id: id });
    assert.equal(srv.db.prepare('SELECT trades FROM subs WHERE job_id=? AND user_id=?').get(j.id, ids.pedro).trades, 'carpinteria,techo,pintura', 'el sub trae los trades de su usuario');
    await owner.post(`/api/jobs/${j.id}/apply-template`, { template: 'base' });
    const tk = await tasksOf(owner, j.id);
    const who = trade => [...new Set(tk.filter(t => t.trade === trade).map(t => t.assignee_id))];
    assert.deepEqual(who('carpinteria'), [ids.pedro]); assert.deepEqual(who('techo'), [ids.pedro]); assert.deepEqual(who('pintura'), [ids.pedro]);
    assert.deepEqual(who('electricidad'), [ids.luis]); assert.deepEqual(who('concreto'), [ids.jr]);
    assert.equal(tk.filter(t => t.assignee_id === ids.pedro).length, 7, 'Pedro se queda con 7 tareas de 3 trades');
    assert.ok(tk.filter(t => /Inspecci/.test(t.title)).every(t => !t.assignee_id && !t.trade), 'las inspecciones no se asignan a un sub');
    // Una tarea nueva toma el trade por su nombre y el crew que lo hace.
    await owner.post(`/api/jobs/${j.id}/tasks`, { title: 'Instalar luces extra' });
    const nt = (await tasksOf(owner, j.id)).at(-1);
    assert.deepEqual([nt.trade, nt.assignee_id], ['electricidad', ids.luis]);
    // Dos crews del mismo trade en la obra: nadie, se escoge a mano.
    await owner.post(`/api/jobs/${j.id}/subs`, { name: 'Ana', user_id: ids.ana });
    await owner.post(`/api/jobs/${j.id}/tasks`, { title: 'Contactos GFCI' });
    assert.equal((await tasksOf(owner, j.id)).at(-1).assignee_id, null);
    // El trade de la tarea se puede cambiar.
    assert.equal((await owner.put(`/api/tasks/${nt.id}`, { trade: 'av' })).status, 200);
    assert.equal((await tasksOf(owner, j.id)).find(t => t.id === nt.id).trade, 'av');
  } finally { srv.close(); }
});

test('asignar por trade: un crew se queda con varios trades de un jalón; lo hecho no se toca', async () => {
  const { srv, owner, ids, sub } = await start();
  try {
    const j = (await owner.post('/api/jobs', { client_name: 'Kilmichael', project_type: 'patio_cover', template: 'base', status: 'activo' })).body;
    let tk = await tasksOf(owner, j.id);
    assert.ok(tk.every(t => !t.assignee_id), 'sin crews en la obra, nadie asignado');
    const done = tk.find(t => t.trade === 'carpinteria');
    await owner.put(`/api/tasks/${done.id}`, { status: 'hecho' });
    const r = (await owner.post(`/api/jobs/${j.id}/assign-by-trade`, { map: { carpinteria: ids.pedro, techo: ids.pedro, electricidad: ids.luis } })).body;
    assert.equal(r.changed, 4 + 1 + 2, '4 de carpintería (1 ya hecha), 1 de techo, 2 eléctricas');
    tk = await tasksOf(owner, j.id);
    assert.equal(tk.find(t => t.id === done.id).assignee_id, null, 'la hecha no cambia');
    assert.ok(tk.filter(t => t.trade === 'techo').every(t => t.assignee_id === ids.pedro));
    const s = srv.db.prepare('SELECT trades, agreed_cents FROM subs WHERE job_id=? AND user_id=?').get(j.id, ids.pedro);
    assert.ok(s && s.agreed_cents === 0 && s.trades.includes('techo'), 'el crew queda en la obra para que la vea');
    assert.ok((await sub.get(`/api/jobs/${j.id}`)).status === 200, 'Pedro ya ve la obra');
    // Quitar: null deja sin asignar.
    await owner.post(`/api/jobs/${j.id}/assign-by-trade`, { map: { techo: null } });
    assert.ok((await tasksOf(owner, j.id)).filter(t => t.trade === 'techo').every(t => !t.assignee_id));
    assert.equal((await owner.post(`/api/jobs/${j.id}/assign-by-trade`, { map: { magia: ids.pedro } })).status, 400);
    assert.equal((await owner.post(`/api/jobs/${j.id}/assign-by-trade`, { map: { techo: 999 } })).status, 400);
    assert.equal((await sub.post(`/api/jobs/${j.id}/assign-by-trade`, { map: { techo: ids.pedro } })).status, 403);
    // El SCHEDULE importado también adivina el trade y asigna.
    await owner.post(`/api/jobs/${j.id}/schedule/apply`, { text: 'TASK NAME\tSTATUS\nRough electrical for fans\t\nRe-roof shingles patch\t', mode: 'add' });
    tk = await tasksOf(owner, j.id);
    assert.deepEqual(tk.slice(-2).map(t => [t.trade, t.assignee_id]), [['electricidad', ids.luis], ['techo', ids.pedro]]);
  } finally { srv.close(); }
});

test('al agregar un crew a la obra, se le asignan solas las tareas sin asignar de sus trades', async () => {
  const { srv, owner, ids } = await start();
  try {
    const j = (await owner.post('/api/jobs', { client_name: 'Crestfield', project_type: 'patio_cover', template: 'base', status: 'activo' })).body;
    const r = (await owner.post(`/api/jobs/${j.id}/subs`, { name: 'Pedro', user_id: ids.pedro })).body;
    assert.equal(r.assigned, 7);
    const r2 = (await owner.post(`/api/jobs/${j.id}/subs`, { name: 'Luis', user_id: ids.luis, trades: ['electricidad'] })).body;
    assert.equal(r2.assigned, 2);
    assert.equal(srv.db.prepare('SELECT trades FROM subs WHERE id=?').get(r2.id).trades, 'electricidad', 'en esta obra solo eléctrico');
  } finally { srv.close(); }
});
