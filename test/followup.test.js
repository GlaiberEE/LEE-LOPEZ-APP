'use strict';
// v2.12: pendientes y comunicación en los casos: aviso al PM, responsable y fecha límite,
// recordatorio cuando nadie contesta, varios subs en un caso y "Mis pendientes".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');
const FU = require('../lib/followup');

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-fu-'));
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
  const jack = await mk('Jack', 'owner');
  const pedro = await mk('Pedro', 'worker'), luis = await mk('Luis', 'worker'), ana = await mk('Ana', 'worker');
  const mario = await mk('Mario', 'pm', { pm_limit_cents: 50000, pm_month_cents: 500000 });
  const job = (await owner.post('/api/jobs', { template: 'base',  client_name: 'Smith', address: '1 Main St', status: 'activo' })).body;
  await owner.put(`/api/jobs/${job.id}`, { pm_id: mario });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Pedro', trade: 'Carpintería', agreed_cents: 100000, user_id: pedro });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Luis', trade: 'Electricidad', agreed_cents: 100000, user_id: luis });
  const as = async u => { const c = client(); await c.post('/api/login', { username: u, password: 'otra-clave-larga-1' }); return c; };
  const notes = uid => srv.db.prepare('SELECT title, url FROM notifications WHERE user_id=? ORDER BY id').all(uid);
  return { srv, owner, job, ids: { jack, pedro, luis, ana, mario }, pm: await as('mario'), sub: await as('pedro'), luisC: await as('luis'), anaC: await as('ana'), notes };
}

test('casos: el PM recibe aviso, el sub abre y queda a cargo del PM, varios subs y responsable con fecha', async () => {
  const { srv, owner, job, ids, pm, sub, luisC, anaC, notes } = await start();
  try {
    // El sub abre un caso → queda a cargo del PM de la obra, y le llega aviso al PM y a los dos dueños.
    const c = (await sub.post('/api/issues', { job_id: job.id, title: 'Viga torcida', body: 'La viga del lado norte viene torcida.' })).body;
    assert.ok(c.id);
    let full = (await pm.get(`/api/issues/${c.id}`)).body;
    assert.equal(full.assignee_id, ids.mario, 'lo abre un sub: queda a cargo del PM');
    assert.ok(notes(ids.mario).some(n => /Viga torcida/.test(n.title)), 'al PM le llega el aviso');
    assert.ok(notes(ids.jack).some(n => /Viga torcida/.test(n.title)), 'al otro dueño también');

    // El PM contesta → le llega al sub (y a los dueños).
    await pm.post(`/api/issues/${c.id}/messages`, { body: '¿Puedes mandar foto de cerca?' });
    assert.ok(notes(ids.pedro).some(n => /Respuesta en: Viga torcida/.test(n.title)), 'el sub recibe la respuesta del PM');
    assert.match(notes(ids.pedro).at(-1).url, new RegExp(`#/obra/${job.id}`), 'al sub lo lleva a la obra');

    // Agregar a Luis al caso: lo ve, puede contestar y le llega aviso. Ana no trabaja en la obra.
    assert.equal((await luisC.get(`/api/issues/${c.id}`)).status, 404, 'antes no lo ve');
    assert.equal((await pm.post(`/api/issues/${c.id}/members`, { user_id: ids.luis })).status, 200);
    assert.equal((await luisC.get(`/api/issues/${c.id}`)).status, 200, 'ya lo ve');
    assert.ok(notes(ids.luis).some(n => /Lo agregaron al caso/.test(n.title)));
    assert.equal((await pm.post(`/api/issues/${c.id}/members`, { user_id: ids.ana })).status, 400, 'Ana no trabaja en esta obra');
    assert.equal((await anaC.get(`/api/issues/${c.id}`)).status, 404);
    await luisC.post(`/api/issues/${c.id}/messages`, { body: 'La caja eléctrica va ahí, hay que moverla.' });
    assert.ok(notes(ids.pedro).some(n => n.title.includes('Respuesta')), 'Pedro ve lo que escribe Luis');
    assert.equal((await luisC.get('/api/issues')).body.length, 1, 'Luis ve el caso en su lista');

    // Responsable y fecha límite: el dueño se lo pasa a Luis para el viernes.
    const r = await owner.put(`/api/issues/${c.id}/plan`, { assignee_id: ids.luis, due_date: '2026-11-27' });
    assert.equal(r.status, 200);
    assert.ok(notes(ids.luis).some(n => /Le toca resolver: Viga torcida/.test(n.title)));
    full = (await owner.get(`/api/issues/${c.id}`)).body;
    assert.equal(full.assignee_name, 'Luis'); assert.equal(full.due_date, '2026-11-27');
    assert.deepEqual(full.members.map(m => m.name).sort(), ['Luis', 'Pedro']);
    assert.equal((await owner.put(`/api/issues/${c.id}/plan`, { assignee_id: ids.ana })).status, 400, 'no puede ser responsable alguien de fuera');
    assert.equal((await owner.put(`/api/issues/${c.id}/plan`, { due_date: 'mañana' })).status, 400);
    assert.equal((await sub.put(`/api/issues/${c.id}/plan`, { assignee_id: ids.pedro })).status, 403, 'un sub no reparte el trabajo');

    // Quitar a Pedro: deja de verlo.
    assert.equal((await owner.del(`/api/issues/${c.id}/members/${ids.pedro}`)).status, 200);
    assert.equal((await sub.get(`/api/issues/${c.id}`)).status, 404);
    assert.equal((await luisC.get(`/api/issues/${c.id}`)).status, 200, 'Luis sigue');

    // El dueño crea un caso con dos subs, responsable y fecha.
    const c2 = (await owner.post('/api/issues', { job_id: job.id, title: 'Orden de trabajo techo', body: 'Coordinar techo y luz.', member_ids: [ids.pedro, ids.luis], assignee_id: ids.mario, due_date: '2026-11-30' })).body;
    const f2 = (await owner.get(`/api/issues/${c2.id}`)).body;
    assert.deepEqual(f2.members.map(m => m.name).sort(), ['Luis', 'Pedro']);
    assert.equal(f2.assignee_name, 'Mario');
    assert.ok(notes(ids.mario).some(n => /Le toca resolver: Orden de trabajo techo/.test(n.title)));
  } finally { srv.close(); }
});

test('recordatorios: sin respuesta → recordatorio, luego a los dueños; fecha vencida; solo en horario', async () => {
  const { srv, job, ids, sub, pm, notes } = await start();
  try {
    const c = (await sub.post('/api/issues', { job_id: job.id, title: 'Falta material', body: 'No llegó la madera.', urgent: true })).body;
    const db = srv.db;
    const at = h => { const d = new Date(); d.setUTCHours(d.getUTCHours() + h); return d; };
    const noon = d => { const x = new Date(d); x.setUTCHours(18, 0, 0, 0); return x; }; // 12 p.m. en Texas
    // Mover la conversación 5 horas atrás (urgente = 4 horas).
    db.prepare("UPDATE issue_messages SET created_at=datetime('now','-5 hours') WHERE issue_id=?").run(c.id);
    db.prepare("UPDATE issues SET created_at=datetime('now','-5 hours') WHERE id=?").run(c.id);
    const before = notes(ids.mario).length;
    FU.tick(db, new Date(), { anyHour: true });
    assert.equal(notes(ids.mario).length, before + 1, 'recordatorio al responsable (el PM)');
    assert.match(notes(ids.mario).at(-1).title, /Sin respuesta: Falta material/);
    FU.tick(db, new Date(), { anyHour: true });
    assert.equal(notes(ids.mario).length, before + 1, 'no repite el recordatorio');
    // 5 horas después del recordatorio sigue sin respuesta → a los dueños.
    const ownerBefore = notes(ids.jack).length;
    FU.tick(db, at(5), { anyHour: true });
    assert.match(notes(ids.jack).at(-1).title, /Nadie ha contestado: Falta material/);
    assert.equal(notes(ids.jack).length, ownerBefore + 1);
    FU.tick(db, at(10), { anyHour: true });
    assert.equal(notes(ids.jack).length, ownerBefore + 1, 'tampoco repite el aviso a los dueños');
    // El PM contesta: ahora el que debe contestar es el sub, y el reloj empieza de nuevo.
    await pm.post(`/api/issues/${c.id}/messages`, { body: 'Mañana llega, ¿puedes avanzar con otra cosa?' });
    const subBefore = notes(ids.pedro).length;
    FU.tick(db, at(1), { anyHour: true });
    assert.equal(notes(ids.pedro).length, subBefore, 'apenas pasó 1 hora');
    FU.tick(db, at(6), { anyHour: true });
    assert.equal(notes(ids.pedro).length, subBefore + 1, 'ahora le recuerda al sub');
    // Fuera de horario no manda nada.
    db.prepare("UPDATE issues SET reminded_at='', escalated_at='' WHERE id=?").run(c.id);
    const night = new Date(); night.setUTCHours(8, 0, 0, 0); // 2-3 a.m. en Texas
    assert.equal(FU.tick(db, night).sent, 0);
    // Fecha límite vencida: avisa al responsable y a los dueños una sola vez.
    db.prepare("UPDATE issues SET due_date='2026-01-05', assignee_id=? WHERE id=?").run(ids.mario, c.id);
    const m0 = notes(ids.mario).length;
    FU.tick(db, noon(new Date()), { anyHour: true });
    assert.ok(notes(ids.mario).slice(m0).some(n => /Se pasó la fecha: Falta material/.test(n.title)));
    const m1 = notes(ids.mario).length;
    FU.tick(db, noon(new Date()), { anyHour: true });
    assert.equal(notes(ids.mario).filter(n => /Se pasó la fecha/.test(n.title)).length, notes(ids.mario).slice(0, m1).filter(n => /Se pasó la fecha/.test(n.title)).length);
    // Un caso cerrado no recuerda nada.
    db.prepare("UPDATE issues SET status='resuelto', reminded_at='', escalated_at='' WHERE id=?").run(c.id);
    assert.equal(FU.tick(db, at(30), { anyHour: true }).sent, 0);
  } finally { srv.close(); }
});

test('Mis pendientes: casos a su cargo, esperando su respuesta y tareas atrasadas', async () => {
  const { srv, owner, job, ids, sub, pm } = await start();
  try {
    const c = (await sub.post('/api/issues', { job_id: job.id, title: 'Duda de altura', body: '¿A qué altura va la viga?' })).body;
    let mine = (await pm.get('/api/my-pending')).body;
    assert.ok(mine.some(x => x.kind === 'case' && x.id === c.id), 'el PM lo tiene pendiente');
    await pm.post(`/api/issues/${c.id}/messages`, { body: 'A 9 pies.' });
    mine = (await sub.get('/api/my-pending')).body;
    assert.ok(mine.some(x => x.kind === 'case' && x.id === c.id && (x.why === 'unread' || x.why === 'your_turn')), 'el sub tiene que leer/contestar');
    await sub.get(`/api/issues/${c.id}`); // lo lee
    mine = (await sub.get('/api/my-pending')).body;
    assert.ok(mine.some(x => x.id === c.id && x.why === 'your_turn'), 'después de leerlo, sigue siendo su turno');
    await sub.post(`/api/issues/${c.id}/messages`, { body: 'Listo, gracias.' });
    assert.ok(!(await sub.get('/api/my-pending')).body.some(x => x.kind === 'case' && x.id === c.id), 'ya contestó: sale de sus pendientes');
    // Tarea atrasada del sub: le sale a él y al PM.
    await owner.post(`/api/jobs/${job.id}/tasks`, { title: 'Poner postes', assignee_id: ids.pedro, planned_date: '2026-01-10' });
    assert.ok((await sub.get('/api/my-pending')).body.some(x => x.kind === 'task' && x.overdue));
    assert.ok((await pm.get('/api/my-pending')).body.some(x => x.kind === 'task' && x.who === 'Pedro'));
    // El cliente no tiene esta lista.
    assert.equal((await owner.get('/api/my-pending')).status, 200);
  } finally { srv.close(); }
});

test('un dueño puede ser el encargado (PM) de una obra: le tocan los casos y las tareas atrasadas', async () => {
  const { srv, owner, job, ids, sub, notes } = await start();
  try {
    assert.equal((await owner.put(`/api/jobs/${job.id}`, { pm_id: ids.pedro })).status, 400, 'un sub no puede ser encargado');
    assert.equal((await owner.put(`/api/jobs/${job.id}`, { pm_id: ids.jack })).status, 200, 'Jack (dueño) como encargado');
    const c = (await sub.post('/api/issues', { job_id: job.id, title: 'Duda del drenaje', body: '¿Por dónde sale el agua?' })).body;
    const full = (await owner.get(`/api/issues/${c.id}`)).body;
    assert.equal(full.assignee_id, ids.jack, 'el caso queda a cargo de Jack');
    assert.ok(notes(ids.jack).some(n => /Le toca resolver: Duda del drenaje/.test(n.title)));
    const jack = (() => { let cookie = ''; const base = `http://127.0.0.1:${srv.address().port}`;
      return async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
        const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; }; })();
    await jack('POST', '/api/login', { username: 'jack', password: 'otra-clave-larga-1' });
    await owner.post(`/api/jobs/${job.id}/tasks`, { title: 'Cimbra', assignee_id: ids.pedro, planned_date: '2026-01-10' });
    const mine = (await jack('GET', '/api/my-pending')).body;
    assert.ok(mine.some(x => x.kind === 'case' && x.id === c.id), 'el caso le sale a Jack');
    assert.ok(mine.some(x => x.kind === 'task' && x.who === 'Pedro'), 'y las tareas atrasadas de su obra');
    // Y una obra nueva se puede crear ya con un dueño como encargado.
    assert.equal((await owner.post('/api/jobs', { template: 'base',  client_name: 'Lee', address: '2 Oak', pm_id: ids.jack })).status, 200);
    assert.equal((await owner.post('/api/jobs', { template: 'base',  client_name: 'Lee', address: '2 Oak', pm_id: ids.luis })).status, 400);
  } finally { srv.close(); }
});
