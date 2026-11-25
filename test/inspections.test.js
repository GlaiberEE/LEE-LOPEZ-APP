'use strict';
// v2.18: inspecciones que pide la ciudad al aprobar el permiso, puestas en el schedule entre los trades.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

async function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-insp-'));
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
const I = require('../lib/inspections');

test('tipo de inspección por su nombre', () => {
  assert.equal(I.guessType('Inspección de pilares (antes de colar)'), 'pilares');
  assert.equal(I.guessType('Inspección de framing y eléctrico rough'), 'framing');
  assert.equal(I.guessType('Rough inspection and gas pressure test'), 'rough_gas');
  assert.equal(I.guessType('Inspección final'), 'final');
  assert.equal(I.guessType('Green Energy'), 'energia');
});

test('al aprobar el permiso la app pregunta las inspecciones y las pone entre los trades', async () => {
  const { srv, owner, sub } = await start();
  try {
    const j = (await owner.post('/api/jobs', { client_name: 'Melbourne', project_type: 'patio_cover', template: 'base', status: 'activo', start_date: '2026-11-02' })).body;
    const p = (await owner.post(`/api/jobs/${j.id}/permits`, { kind: 'permiso', name: 'Building permit', number: 'BP-2611', status: 'solicitado' })).body;
    assert.ok(!p.ask_inspections);
    assert.equal((await owner.put(`/api/permits/${p.id}`, { status: 'aprobado' })).body.ask_inspections, true, 'al aprobarlo, pregunta');
    assert.deepEqual((await owner.get('/api/permits/needs-inspections')).body.map(x => x.id), [p.id]);
    const plan = (await owner.get(`/api/jobs/${j.id}/inspection-plan?permit_id=${p.id}`)).body;
    const title = id => plan.tasks.find(t => t.id === id)?.title;
    assert.equal(title(plan.suggest.pilares), 'Excavar pilares y armar varilla', 'pilares: después de excavar');
    assert.equal(title(plan.suggest.framing), 'Deck del techo', 'framing: después de la estructura, antes del cielo');
    assert.equal(title(plan.suggest.rough_electrico), 'Eléctrico rough (abanico, luces, contactos)');
    assert.equal(title(plan.suggest.final), 'Punch list y limpieza', 'final: antes del walk-through');
    assert.deepEqual(plan.existing.map(e => e.type), ['pilares', 'framing', 'final'], 'las de la plantilla ya vienen con su tipo');
    // La ciudad pidió: pilares, rough eléctrico aparte del framing, final y Oncor. No pidió la de framing de la plantilla.
    const framingTpl = plan.existing.find(e => e.type === 'framing');
    const pilTpl = plan.existing.find(e => e.type === 'pilares');
    const r = (await owner.post(`/api/jobs/${j.id}/inspections`, { permit_id: p.id, remove_task_ids: [framingTpl.id, pilTpl.id], items: [
      { type: 'pilares', after_task_id: plan.suggest.pilares },
      { type: 'rough_electrico', after_task_id: plan.suggest.rough_electrico },
      { type: 'energia', name: 'Oncor meter release', after_task_id: plan.suggest.energia },
    ] })).body;
    assert.deepEqual([r.created.length, r.removed], [3, 2]);
    const tk = (await owner.get(`/api/jobs/${j.id}`)).body.tasks.map(t => t.title);
    const at = s => tk.findIndex(x => x.startsWith(s));
    assert.ok(at('Inspección: Pilares') === at('Excavar pilares') + 1 && at('Colar pilares') === at('Inspección: Pilares') + 1, 'entre excavar y colar');
    assert.equal(at('Inspección: Rough eléctrico'), at('Eléctrico rough') + 1);
    assert.equal(at('Inspección de framing'), -1, 'la que no pidió la ciudad se quitó');
    const row = srv.db.prepare("SELECT * FROM permits WHERE insp_type='pilares'").get();
    assert.equal(row.parent_id, p.id); assert.ok(row.task_id);
    const ptask = srv.db.prepare('SELECT * FROM tasks WHERE id=?').get(row.task_id);
    const exc = srv.db.prepare("SELECT * FROM tasks WHERE job_id=? AND title LIKE 'Excavar pilares%'").get(j.id);
    assert.ok(ptask.planned_date > (exc.planned_end || exc.planned_date), 'fecha: después de excavar');
    assert.equal(row.status, 'programada'); assert.equal(ptask.assignee_id, null);
    assert.equal((await owner.get('/api/permits/needs-inspections')).body.length, 0, 'ya no pregunta');
    assert.ok(!(await owner.put(`/api/permits/${p.id}`, { status: 'aprobado', notes: 'ok' })).body.ask_inspections);
    // Mover la fecha de la inspección mueve su tarea; aprobarla la marca hecha.
    await owner.put(`/api/permits/${row.id}`, { date: '2026-11-20' });
    assert.equal(srv.db.prepare('SELECT planned_date FROM tasks WHERE id=?').get(row.task_id).planned_date, '2026-11-20');
    await owner.put(`/api/permits/${row.id}`, { status: 'aprobado' });
    assert.equal(srv.db.prepare('SELECT status FROM tasks WHERE id=?').get(row.task_id).status, 'hecho');
    // Si la plantilla ya la traía, no se duplica: se usa la misma tarea y queda ligada al permiso.
    const nFinal = () => srv.db.prepare("SELECT COUNT(*) c FROM tasks WHERE job_id=? AND inspection_type='final'").get(j.id).c;
    const before = nFinal();
    const rf = (await owner.post(`/api/jobs/${j.id}/inspections`, { permit_id: p.id, items: [{ type: 'final', after_task_id: plan.suggest.final, date: '2026-12-15' }] })).body;
    assert.equal(rf.created[0].reused, true); assert.equal(nFinal(), before, 'no se duplicó');
    const frow = srv.db.prepare('SELECT * FROM permits WHERE task_id=?').get(rf.created[0].task_id);
    assert.equal(frow.parent_id, p.id); assert.equal(frow.date, '2026-12-15'); assert.equal(frow.status, 'programada');
    // Al principio y otra con nombre propio.
    assert.equal((await owner.post(`/api/jobs/${j.id}/inspections`, { items: [{ type: 'otra', name: 'Pre-construction meeting', after_task_id: 0 }] })).status, 200);
    assert.equal((await owner.get(`/api/jobs/${j.id}`)).body.tasks[0].title, 'Pre-construction meeting');
    assert.equal((await owner.post(`/api/jobs/${j.id}/inspections`, { items: [{ type: 'otra' }] })).status, 400);
    assert.equal((await sub.get(`/api/jobs/${j.id}/inspection-plan`)).status, 403);
    assert.equal((await sub.post(`/api/jobs/${j.id}/inspections`, { items: [{ type: 'final' }] })).status, 403);
  } finally { srv.close(); }
});

test('la compañía agrega inspecciones que pide su ciudad: dueño, PM y vendedor sí; sub no', async () => {
  const { srv, owner, sub, pm } = await start();
  try {
    await owner.post('/api/users', { name: 'Vero', username: 'vero', password: 'otra-clave-larga-1', role: 'sales' });
    const base = `http://127.0.0.1:${srv.address().port}`;
    let ck = ''; const sc = /* sesión del vendedor */ async (m, u, b) => { const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json', origin: base, cookie: ck }, body: b ? JSON.stringify(b) : undefined }); const h = r.headers.get('set-cookie'); if (h) ck = h.split(';')[0]; return { status: r.status, body: await r.json().catch(() => ({})) }; };
    await sc('POST', '/api/login', { username: 'vero', password: 'otra-clave-larga-1' });
    // Dueño agrega una que va después del trade de techo, antes de forrar.
    const a = await owner.post('/api/inspection-types', { name_es: 'Inspección: Tie-down de huracán', name_en: 'Hurricane tie-down', group: 'rough', after_trade: 'techo' });
    assert.equal(a.status, 200); assert.equal(a.body.type.es, 'Tie-down de huracán', 'sin el "Inspección:" de adelante');
    assert.equal((await owner.post('/api/inspection-types', { name_es: 'hurricane TIE-DOWN' })).status, 409, 'no se repite');
    assert.equal((await owner.post('/api/inspection-types', { name_es: 'Rough eléctrico' })).status, 409, 'ni las de la app');
    const b = await pm.post('/api/inspection-types', { name_es: 'Setback / survey', group: 'cimientos' });
    assert.equal(b.status, 200, 'el PM puede');
    const c = await sc('POST', '/api/inspection-types', { name_es: 'Árbol protegido (arborista)', group: 'otra' });
    assert.equal(c.status, 200, 'el vendedor puede');
    assert.equal((await sc('GET', '/api/inspection-types')).status, 200);
    assert.equal((await sub.post('/api/inspection-types', { name_es: 'X de sub' })).status, 403, 'el sub no');
    assert.equal((await sub.get('/api/inspection-types')).status, 403);
    // Quitar: el dueño o quien la agregó.
    const cid = c.body.type.id, bid = b.body.type.id;
    assert.equal((await pm.del(`/api/inspection-types/${cid}`)).status, 403, 'el PM no quita la del vendedor');
    assert.equal((await pm.put(`/api/inspection-types/${bid}`, { name_en: 'Setback survey' })).status, 200);
    assert.equal((await sc('DELETE', `/api/inspection-types/${cid}`)).status, 200, 'quien la agregó sí');
    assert.ok(!(await owner.get('/api/inspection-types')).body.types.some(x => x.id === cid));
    // Sale en la pregunta de la obra con su lugar sugerido (después del techo).
    const j = (await owner.post('/api/jobs', { client_name: 'Coastal', project_type: 'patio_cover', template: 'base', status: 'activo', start_date: '2026-11-02' })).body;
    const plan = (await owner.get(`/api/jobs/${j.id}/inspection-plan`)).body;
    const tk = plan.types.find(x => x.es === 'Tie-down de huracán'); assert.ok(tk && tk.custom);
    const after = plan.tasks.find(t => t.id === plan.suggest[tk.key]); assert.equal(after.trade, 'techo');
    const r = (await owner.post(`/api/jobs/${j.id}/inspections`, { items: [{ type: tk.key, after_task_id: plan.suggest[tk.key] },
      { type: 'otra', name: 'Fire marshal walk', save: true, save_group: 'final' }] })).body;
    assert.equal(r.created.length, 2); assert.equal(r.saved.length, 1, '"Otra" con palomita queda en la lista');
    assert.ok((await owner.get('/api/inspection-types')).body.types.some(x => x.es === 'Fire marshal walk' && x.group === 'final'));
    const row = srv.db.prepare("SELECT * FROM tasks WHERE job_id=? AND inspection_type=?").get(j.id, tk.key);
    assert.equal(row.title, 'Inspección: Tie-down de huracán');
  } finally { srv.close(); }
});

test('una inspección de la compañía sin su trade en la obra va con las de su etapa, no al final', () => {
  const tasks = [{ id: 1, title: 'Excavar', trade: 'excavacion' }, { id: 2, title: 'Colar', trade: 'concreto' }, { id: 3, title: 'Gas rough', trade: 'gas' }, { id: 4, title: 'Piedra', trade: 'piedra' }, { id: 5, title: 'Limpieza', trade: 'limpieza' }];
  const fakeDb = { prepare: () => ({ all: () => [{ id: 9, group_key: 'rough', name_es: 'Tie-down', name_en: '', after_trade: 'techo' }] }) };
  const x = I.typesFor(fakeDb).find(y => y.key === 'c9');
  assert.equal(I.suggestAfter(tasks, x), 3, 'después del gas rough, antes de la piedra');
  assert.equal(I.guessType('Inspección: Tie-down', I.typesFor(fakeDb)), 'c9');
});
