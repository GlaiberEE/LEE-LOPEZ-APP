'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-pro-'));
  const srv = createServer({ dataDir: dir, ...opts });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`; srv.base = base;
  const client = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      const ct = r.headers.get('content-type') || '';
      return { status: r.status, body: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
    };
    return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), put: (u, b) => call('PUT', u, b || {}), del: (u, b) => call('DELETE', u, b) };
  };
  const owner = client();
  await owner.post('/api/setup', { name: 'Glaiber', username: 'glaiber', password: 'una-clave-larga-1' });
  await owner.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
  const mkUser = async (name, role) => { const r = await owner.post('/api/users', { name, username: name.toLowerCase(), password: 'otra-clave-larga-1', role }); return r.body.id; };
  const subId = await mkUser('Pedro', 'worker');
  const otherSub = await mkUser('Luis', 'worker');
  const cliId = await mkUser('Cliente', 'client');
  const job = (await owner.post('/api/jobs', { template: 'base',  client_name: 'Smith', address: '1 Main St', status: 'activo' })).body;
  await owner.put(`/api/jobs/${job.id}`, { client_user_id: cliId });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Pedro', trade: 'concreto', agreed_cents: 100000, user_id: subId });
  await owner.post(`/api/jobs/${job.id}/subs`, { name: 'Luis', trade: 'eléctrico', agreed_cents: 100000, user_id: otherSub });
  const as = async (u, pw = 'otra-clave-larga-1') => { const c = client(); await c.post('/api/login', { username: u, password: pw }); return c; };
  const pmId = await mkUser('Mario', 'pm');
  await owner.put(`/api/jobs/${job.id}`, { pm_id: pmId });
  await owner.put(`/api/users/${subId}`, { trade: 'Concreto' });
  await owner.put(`/api/users/${otherSub}`, { trade: 'Electricidad' });
  return { srv, dir, owner, job, sub: await as('pedro'), luis: await as('luis'), cli: await as('cliente'), pm: await as('mario'), subId, otherSub, pmId, mkUser, as };
}


const JPG = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'lib', 'assets', 'logo-print.jpg')).toString('base64');

test('reporte diario del PM, nota del día, ficha mensual, evaluación y calificación del cliente', async () => {
  const { srv, owner, pm, job, cli } = await start();
  try {
    const t0 = await pm.post(`/api/jobs/${job.id}/tasks`, { title: 'Colar base', planned_date: '2026-11-18' }); const t = t0.body;
    await pm.put(`/api/tasks/${t.id}`, { status: 'hecho' });
    await pm.post(`/api/jobs/${job.id}/logs`, { client_notes: 'Se coló la base' });
    assert.equal((await pm.post('/api/pm/notes', { did: '' })).status, 400);
    assert.equal((await pm.post('/api/pm/notes', { did: 'Coordiné el colado', problems: 'Llovió en la tarde', next_steps: 'Estructura el lunes' })).status, 200);
    const mine = (await pm.get('/api/pm/daily')).body;
    assert.equal(mine.pms.length, 1);
    assert.ok(mine.pms[0].total >= 3, JSON.stringify(mine.pms[0].counts));
    assert.equal(mine.pms[0].note.problems, 'Llovió en la tarde');
    const all = (await owner.get('/api/pm/daily')).body;
    assert.equal(all.pms[0].name, 'Mario');
    assert.equal((await pm.get(`/api/pm/${all.pms[0].id}/scorecard`)).status, 403, 'el PM no ve su ficha de calificación');
    // Cliente califica al terminar
    assert.equal((await cli.post(`/api/jobs/${job.id}/rating`, { stars: 5 })).status, 400, 'todavía no termina');
    await owner.put(`/api/jobs/${job.id}`, { status: 'terminado', end_date: '2026-11-30', completed_date: new Date().toISOString().slice(0, 10), reason: 'Terminado' });
    assert.equal((await cli.post(`/api/jobs/${job.id}/rating`, { stars: 5, comment: 'Excelente' })).status, 200);
    await owner.post(`/api/pm/${all.pms[0].id}/review`, { score: 4, comments: 'Buen trabajo, comunicar antes los atrasos' });
    const sc = (await owner.get(`/api/pm/${all.pms[0].id}/scorecard`)).body;
    assert.equal(sc.parts.cliente, 5); assert.equal(sc.parts.duenos, 4);
    assert.equal(sc.data.finished, 1); assert.equal(sc.data.late, 0);
    assert.ok(sc.overall >= 4, 'calificación general ' + sc.overall);
    assert.equal(sc.history.length, 6);
    assert.equal(sc.notes.length, 1);
  } finally { srv.close(); }
});

test('tablero del día: paso actual, siguiente sub, avisar, confirmar y alertas', async () => {
  const { srv, owner, pm, job, sub, subId, otherSub, luis } = await start();
  try {
    const d = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    for (const x of (await owner.get(`/api/jobs/${job.id}`)).body.tasks) await owner.del(`/api/tasks/${x.id}`, { reason: 'Prueba del tablero' });
    await owner.post(`/api/jobs/${job.id}/tasks`, { title: 'Estructura', planned_date: d(-3), planned_end: d(-1), assignee_id: subId });
    const t2 = (await owner.post(`/api/jobs/${job.id}/tasks`, { title: 'Electricidad', planned_date: d(1), assignee_id: otherSub })).body;
    let b = (await owner.get('/api/board')).body;
    const jb = b.jobs.find(x => x.job_id === job.id);
    assert.equal(jb.current.title, 'Estructura'); assert.equal(jb.next.title, 'Electricidad'); assert.equal(jb.next.assignee.name, 'Luis');
    assert.ok(jb.alerts.some(a => a.kind === 'late'), 'estructura atrasada');
    assert.ok(jb.alerts.some(a => a.kind === 'not_confirmed'), 'Luis no ha confirmado');
    // Avisar y confirmar
    const n = await owner.post(`/api/tasks/${t2.id}/notify`);
    assert.equal(n.body.assignee.name, 'Luis');
    assert.ok((await luis.get('/api/my-next')).body.some(x => x.id === t2.id));
    assert.equal((await sub.post(`/api/tasks/${t2.id}/confirm`)).status, 404, 'solo el asignado confirma');
    assert.equal((await luis.post(`/api/tasks/${t2.id}/confirm`)).status, 200);
    b = (await owner.get('/api/board')).body;
    assert.ok(!b.jobs.find(x => x.job_id === job.id).alerts.some(a => a.kind === 'not_confirmed'));
    // Si cambia la fecha, hay que volver a confirmar
    await owner.put(`/api/tasks/${t2.id}`, { planned_date: d(2) });
    b = (await owner.get('/api/board')).body;
    assert.equal(b.jobs.find(x => x.job_id === job.id).next.confirmed_at, '');
    // El PM ve el tablero solo de sus obras
    const other = (await owner.post('/api/jobs', { template: 'base',  client_name: 'Otra', status: 'activo' })).body;
    const pb = (await pm.get('/api/board')).body;
    assert.ok(pb.jobs.every(x => x.job_id !== other.id));
    assert.ok(pb.jobs.some(x => x.job_id === job.id));
  } finally { srv.close(); }
});

test('plan de trabajo: plan base sin AI, plan con AI, aplicar al calendario y plantillas', async () => {
  const fakeAI = async ({ job }) => JSON.stringify({ tasks: [
    { title: 'Permiso de construcción', days: 1, trade: '', inspection: false },
    { title: 'Colar zapatas', days: 2, trade: 'Concreto', inspection: false, materials: 'Concreto 3000 psi' },
    { title: 'Inspección de zapatas', days: 1, trade: '', inspection: true },
    { title: 'Electricidad rough', days: 2, trade: 'Electricidad', inspection: false },
  ], warnings: ['Confirmar medidas del ' + job.client_name] });
  const { srv, owner, job, subId, otherSub } = await start({ planAI: fakeAI });
  try {
    await owner.put(`/api/jobs/${job.id}`, { description: 'Patio cover 20x14 con 2 ventiladores', project_type: 'patio_cover' });
    const dr = (await owner.post(`/api/jobs/${job.id}/plan/draft`, { start_date: '2026-11-20' })).body; // viernes
    assert.equal(dr.source, 'ai');
    assert.equal(dr.tasks.length, 4);
    assert.equal(dr.tasks[1].assignee_id, subId, 'concreto → Pedro');
    assert.equal(dr.tasks[3].assignee_id, otherSub, 'electricidad → Luis');
    assert.equal(dr.tasks[1].planned_date, '2026-11-23'); // viernes 20 → sábado no cuenta → lunes 23
    assert.match(dr.warnings[0], /Smith/);
    // Ajustar y aplicar
    const edited = dr.tasks.map(t => ({ ...t })); edited[1].days = 3; edited.push({ title: 'Limpieza', days: 1 });
    const ap = await owner.post(`/api/jobs/${job.id}/plan/apply`, { start_date: '2026-11-20', tasks: edited, mode: 'replace' });
    assert.equal(ap.status, 200, JSON.stringify(ap.body)); assert.equal(ap.body.created, 5);
    const tasks = (await owner.get(`/api/jobs/${job.id}`)).body.tasks;
    const z = tasks.find(t => t.title === 'Colar zapatas');
    assert.equal(z.planned_date, '2026-11-23'); assert.equal(z.planned_end, '2026-11-25'); assert.equal(z.assignee_id, subId);
    assert.ok(z.notes.includes('Concreto 3000'));
    assert.ok(tasks.every(t => new Date(t.planned_date + 'T12:00:00Z').getUTCDay() !== 0), 'nunca en domingo');
    assert.equal((await owner.get(`/api/jobs/${job.id}/permits`)).body.length, 1, 'la inspección quedó en permisos');
    // Plantilla
    const tp = await owner.post('/api/plan-templates', { name: 'Patio cover estándar', project_type: 'patio_cover', tasks: edited });
    const fromT = (await owner.post(`/api/jobs/${job.id}/plan/draft`, { template_id: tp.body.id, start_date: '2026-12-01' })).body;
    assert.equal(fromT.source, 'template'); assert.equal(fromT.tasks.length, 5);
  } finally { srv.close(); }
  // Sin AI: plan base por tipo de proyecto
  const s2 = await start();
  try {
    await s2.owner.put(`/api/jobs/${s2.job.id}`, { project_type: 'patio_cover' });
    const dr = (await s2.owner.post(`/api/jobs/${s2.job.id}/plan/draft`, {})).body;
    assert.equal(dr.source, 'base'); assert.ok(dr.tasks.length >= 5);
  } finally { s2.srv.close(); }
});

test('materiales: catálogo con close-up, ficha de la obra, buscador y galería automática al terminar', async () => {
  const { srv, owner, pm, job, cli, sub, mkUser, as } = await start();
  try {
    const m1 = (await owner.post('/api/materials', { zone: 'pintura', kind: 'Stain', brand: 'Sherwin-Williams', name: 'Stain semitransparente', color_name: 'Cedar', color_hex: '#5b3a29', image: JPG })).body;
    assert.ok(m1.image);
    const m2 = (await pm.post('/api/materials', { zone: 'cocina_cubierta', kind: 'Granito', name: 'Granito', color_name: 'Absolute Black', finish: 'Leather' })).body;
    assert.ok(m2.id, 'el PM también agrega materiales');
    assert.equal((await sub.post('/api/materials', { name: 'x' })).status, 403);
    assert.equal((await owner.post('/api/materials', { brand: 'Sherwin-Williams', name: 'Stain semitransparente', color_name: 'Cedar' })).status, 400, 'no duplicados');
    await owner.post(`/api/jobs/${job.id}/materials`, { material_id: m1.id, area: 'Ceiling del patio' });
    await owner.post(`/api/jobs/${job.id}/materials`, { material_id: m2.id, area: 'Cubierta de la cocina' });
    // Fotos: una antes de terminar (vieja) y la final
    const ph0 = await owner.post(`/api/jobs/${job.id}/photos`, { dataUrl: JPG, caption: 'Terminado' }); const ph = ph0.body;
    // Terminar → fotos recientes a la galería
    const fin = await owner.put(`/api/jobs/${job.id}`, { status: 'terminado', reason: 'Fin' });
    const gal = (await owner.get(`/api/jobs/${job.id}/gallery`)).body;
    assert.ok(gal.length >= 1 && gal.every(f => f.gallery === 1), 'fotos finales en galería');
    // Foto subida después también entra sola
    await owner.post(`/api/jobs/${job.id}/photos`, { dataUrl: JPG, caption: 'Detalle' });
    assert.ok((await owner.get(`/api/jobs/${job.id}/gallery`)).body.every(f => f.gallery === 1));
    // Otro cliente (otra obra) busca "cedar" y ve la foto de muestra, sin datos del otro cliente
    const otherCliId = await mkUser('Otra', 'client');
    const other = (await owner.post('/api/jobs', { template: 'base',  client_name: 'Jones', status: 'cotizado' })).body;
    await owner.put(`/api/jobs/${other.id}`, { client_user_id: otherCliId });
    const c2 = await as('otra');
    const found = (await c2.get('/api/materials?q=cedar')).body.materials;
    assert.equal(found.length, 1); assert.equal(found[0].jobs, 1);
    const det = (await c2.get(`/api/materials/${m1.id}`)).body;
    assert.ok(det.gallery.length >= 1); assert.equal(det.used_in, undefined, 'el cliente no ve en qué obras');
    assert.ok(!JSON.stringify(det).includes('Smith'));
    const photoId = det.gallery[0].id;
    assert.equal((await c2.get(`/files/${photoId}`)).status, 200, 'foto de galería visible');
    assert.equal((await c2.get(`/api/materials/${m1.id}/image`)).status, 200, 'close-up visible');
    // Una foto quitada de la galería ya no la ve el otro cliente
    await owner.put(`/api/files/${photoId}/gallery`, { gallery: false });
    assert.equal((await c2.get(`/files/${photoId}`)).status, 404);
    // Ficha de la obra para el cliente dueño
    const ficha = (await cli.get(`/api/jobs/${job.id}/materials`)).body;
    assert.equal(ficha.length, 2); assert.ok(ficha.some(x => x.material.color_name === 'Absolute Black'));
    assert.equal((await owner.del(`/api/materials/${m1.id}`)).status, 400, 'material usado no se borra');
    void ph;
  } finally { srv.close(); }
});

test('ventas: vendedor y herramienta por usuario, citas, estimado enviado, seguimiento, ganado y perdido', async () => {
  const { srv, owner, mkUser, as, pm, pmId, job } = await start();
  try {
    const vid = await mkUser('Vero', 'sales');
    const v = await as('vero');
    // El vendedor no ve dinero ni obras de la compañía
    for (const u of ['/api/jobs', `/api/jobs/${job.id}`, '/api/dashboard', '/api/expenses', '/api/forecast', '/api/users']) assert.equal((await v.get(u)).status, 403, u);
    assert.equal((await v.get(`/api/sales/leads/${job.id}`)).status, 404, 'no es su cliente');
    // Cliente nuevo con cita
    const d = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const l = (await v.post('/api/sales/leads', { client_name: 'García', client_phone: '214-555-0101', address: '12 Oak St', project_type: 'outdoor_kitchen', lead_source: 'Referido',
      appointment: { starts_at: d(0) + ' 16:30', minutes: 90 } })).body;
    assert.equal(l.status, 'prospecto'); assert.equal(l.sales_id, vid);
    let day = (await v.get('/api/sales/day')).body;
    assert.equal(day.appointments.length, 1); assert.equal(day.appointments[0].client_name, 'García');
    assert.equal((await v.get('/api/sales/pipeline')).body.stages.cita.length, 1);
    // Estimado enviado → seguimiento en 3 días
    assert.equal((await v.post(`/api/sales/leads/${l.id}/event`, { kind: 'enviado' })).status, 400, 'falta el monto');
    const sent = (await v.post(`/api/sales/leads/${l.id}/event`, { kind: 'enviado', amount_cents: 4500000 })).body;
    assert.equal(sent.status, 'cotizado'); assert.equal(sent.follow_up_date, d(3)); assert.equal(sent.quoted_cents, 4500000);
    const pl = (await v.get('/api/sales/pipeline')).body;
    assert.equal(pl.stages.estimado.length, 1); assert.equal(pl.totals.estimado.cents, 4500000);
    assert.ok(!JSON.stringify(pl).includes('spent') && !JSON.stringify(pl).includes('profit'));
    await v.post(`/api/sales/leads/${l.id}/event`, { kind: 'llamada', note: 'Lo está pensando', next_date: d(0) });
    day = (await v.get('/api/sales/day')).body;
    assert.equal(day.due.length, 1, 'le toca llamar hoy');
    assert.ok((await v.get('/api/status')).body.user.pending >= 1);
    assert.equal((await v.post(`/api/sales/leads/${l.id}/event`, { kind: 'nota', next_date: d(-2) })).status, 400);
    // Ganado → obra activa y aviso a los dueños
    const won = (await v.post(`/api/sales/leads/${l.id}/event`, { kind: 'ganado', note: 'Firmó' })).body;
    assert.equal(won.status, 'activo');
    assert.equal((await v.post(`/api/sales/leads/${l.id}/event`, { kind: 'nota' })).status, 400, 'ya no está en ventas');
    const hist = (await v.get(`/api/sales/leads/${l.id}`)).body;
    assert.deepEqual(hist.events.map(e => e.kind), ['ganado', 'llamada', 'enviado', 'nota']);
    // Perdido con motivo
    const l2 = (await v.post('/api/sales/leads', { client_name: 'Lopez' })).body;
    assert.equal((await v.post(`/api/sales/leads/${l2.id}/event`, { kind: 'perdido' })).status, 400, 'falta motivo');
    assert.equal((await v.post(`/api/sales/leads/${l2.id}/event`, { kind: 'perdido', reason: 'precio' })).body.status, 'cancelado');
    // Un dueño con la herramienta: ve sus clientes y los sin vendedor; puede asignar
    await owner.put('/api/users/1', { tools: ['ventas'] });
    assert.deepEqual((await owner.get('/api/status')).body.user.tools, ['ventas']);
    assert.equal((await owner.put('/api/users/1', { tools: ['magia'] })).status, 400);
    const web = (await owner.post('/api/sales/leads', { client_name: 'Web lead', sales_id: null })).body;
    assert.ok((await owner.get('/api/sales/day')).body.new_leads.some(x => x.id === web.id));
    assert.ok(!(await v.get('/api/sales/day')).body.new_leads.some(x => x.id === web.id));
    await owner.put(`/api/sales/leads/${web.id}`, { sales_id: vid });
    assert.ok((await v.get('/api/sales/day')).body.new_leads.some(x => x.id === web.id));
    assert.equal((await v.put(`/api/sales/leads/${web.id}`, { sales_id: null })).status, 403);
    const pa = await owner.get('/api/sales/pipeline?who=all'); assert.equal(pa.body.stages.ganado.length, 1);
    // Un PM sin la herramienta no entra; con ella, sí (solo lo suyo)
    assert.equal((await pm.get('/api/sales/day')).status, 403);
    await owner.put(`/api/users/${pmId}`, { tools: 'ventas' });
    const pm2 = await as('mario');
    assert.equal((await pm2.get('/api/sales/day')).status, 200);
    assert.equal((await pm2.get(`/api/sales/leads/${l.id}`)).status, 404);
    // Agenda: el vendedor no agenda en la de otro; el dueño sí le agenda
    assert.equal((await v.post('/api/appointments', { title: 'x', starts_at: d(1) + ' 10:00', user_id: 1 })).status, 403);
    assert.equal((await owner.post('/api/appointments', { title: 'Visita Pérez', starts_at: d(1) + ' 10:00', user_id: vid })).status, 200);
    assert.equal((await v.get(`/api/appointments?from=${d(1)}&to=${d(1)}`)).body.length, 1);
    const ap = (await v.get(`/api/appointments?from=${d(0)}&to=${d(0)}`)).body[0];
    assert.equal((await v.put(`/api/appointments/${ap.id}`, { status: 'hecho', result: 'Midió el patio' })).status, 200);
  } finally { srv.close(); }
});

test('recuperar acceso: pedido sin revelar usuarios, contraseña temporal, cambio obligatorio y vencimiento', async () => {
  const { srv, owner, mkUser, as } = await start();
  try {
    const anon = async (u, b) => { const r = await fetch(srv.base + u, { method: 'POST', headers: { 'content-type': 'application/json', origin: srv.base }, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
    await owner.put(`/api/users/${await mkUser('Raul', 'worker')}`, { name: 'Raúl Gómez', phone: '(214) 555-0142' });
    // Mismo resultado exista o no
    assert.deepEqual((await anon('/api/recover', { ident: 'nadie-existe' })).body, { ok: true });
    assert.deepEqual((await anon('/api/recover', { ident: '214 555 0142' })).body, { ok: true });
    const reqs = (await owner.get('/api/access-requests')).body;
    const mine = reqs.find(r => r.user && r.user.name === 'Raúl Gómez');
    assert.ok(mine, 'encontró a Raúl por teléfono');
    assert.ok(reqs.some(r => !r.user && r.ident === 'nadie-existe'));
    // Temporal
    const g = (await owner.post(`/api/access-requests/${mine.id}/temp`)).body;
    assert.match(g.temp, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    assert.ok(!(await owner.get('/api/access-requests')).body.some(r => r.id === mine.id), 'ya resuelto');
    // Entra con la temporal: solo puede cambiar la contraseña
    const r = await as(g.user.username, g.temp);
    assert.equal((await r.get('/api/status')).body.user.must_change, true);
    assert.equal((await r.get('/api/jobs')).status, 403);
    assert.equal((await r.post('/api/me/password', { current: g.temp, password: g.temp })).status, 400, 'no la misma');
    assert.equal((await r.post('/api/me/password', { current: g.temp, password: 'mi-clave-nueva-123' })).status, 200);
    assert.equal((await r.get('/api/status')).body.user.must_change, false);
    assert.equal((await r.get('/api/jobs')).status, 200);
    // Vencida: no entra
    const g2 = (await owner.post(`/api/users/${g.user.id}/temp-password`)).body;
    srv.db.prepare("UPDATE users SET temp_expires=datetime('now','-1 minute') WHERE id=?").run(g.user.id);
    const login = await anon('/api/login', { username: g.user.username, password: g2.temp });
    assert.equal(login.status, 401); assert.match(login.body.error, /venció/);
    // Queda en el historial
    assert.ok(srv.db.prepare("SELECT 1 FROM audit_log WHERE summary LIKE 'Contraseña temporal%'").get());
  } finally { srv.close(); }
});

test('dos empresas: información separada, activar con los mismos dueños, entrar a las dos y subs de una sola', async () => {
  const { srv, owner, job, mkUser } = await start();
  try {
    // El cliente HTTP del helper guarda una sola cookie; aquí usamos uno que guarda todas.
    const jar = () => { const ck = {};
      const call = async (m, u, b) => { const r = await fetch(srv.base + u, { method: m, headers: { 'content-type': 'application/json', origin: srv.base, cookie: Object.entries(ck).map(([k, v]) => `${k}=${v}`).join('; ') }, body: b ? JSON.stringify(b) : undefined });
        for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); ck[kv.slice(0, i)] = kv.slice(i + 1); }
        const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : null }; };
      return { get: u => call('GET', u), post: (u, b) => call('POST', u, b || {}), ck }; };
    const g = jar();
    await g.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
    let cs = (await g.get('/api/companies')).body;
    assert.deepEqual(cs.map(c => c.key), ['ee', 'jkl']);
    assert.equal(cs[1].empty, true); assert.equal(cs[1].signed_in, false);
    assert.equal((await g.get('/api/status')).body.company.name, 'Elevated Exteriors');
    // Activar JKL: se copian los dueños y queda adentro
    assert.equal((await g.post('/api/companies/jkl/activate')).status, 200);
    const st = (await g.get('/api/status')).body;
    assert.equal(st.company.name, 'JKL Homes'); assert.equal(st.user.username, 'glaiber');
    // Información separada
    assert.equal((await g.get('/api/jobs')).body.length, 0, 'JKL empieza vacía');
    assert.equal((await g.get(`/api/jobs/${job.id}`)).status, 404);
    const jj = (await g.post('/api/jobs', { template: 'base',  client_name: 'Garcia baño', status: 'activo' })).body;
    await g.post('/api/companies/switch', { key: 'ee' });
    assert.ok(!(await g.get('/api/jobs')).body.some(x => x.client_name === 'Garcia baño'));
    await g.post('/api/companies/switch', { key: 'jkl' });
    assert.ok((await g.get('/api/jobs')).body.some(x => x.id === jj.id));
    // Entrar de nuevo: entra a las dos empresas de una vez
    const g2 = jar();
    await g2.post('/api/login', { username: 'glaiber', password: 'una-clave-larga-1' });
    assert.ok(g2.ck.ee_sid && g2.ck.ee_sid_jkl);
    cs = (await g2.get('/api/companies')).body; assert.ok(cs.every(c => c.signed_in));
    // Un sub que solo existe en JKL entra directo a JKL
    await g.post('/api/users', { name: 'Tile Guy', username: 'tile', password: 'otra-clave-larga-1', role: 'worker' });
    const t = jar();
    const lr = await t.post('/api/login', { username: 'tile', password: 'otra-clave-larga-1' });
    assert.equal(lr.status, 200);
    assert.equal((await t.get('/api/status')).body.company.key, 'jkl');
    assert.equal((await t.get('/api/status')).body.user.username, 'tile');
    // Un usuario de EE no se puede activar empresa
    const pedro = jar(); await pedro.post('/api/login', { username: 'pedro', password: 'otra-clave-larga-1' });
    assert.equal((await pedro.get('/api/status')).body.company.key, 'ee');
    void owner; void mkUser;
  } finally { srv.close(); }
});

test('partidas: vendido, costo con lo comprometido a subs, margen, alerta, reparto y margen por oficio', async () => {
  const { srv, owner, job, pm } = await start();
  try {
    await owner.put(`/api/jobs/${job.id}`, { quoted_cents: 5000000, reason: 'contrato' });
    const pc = (await owner.post(`/api/jobs/${job.id}/lines`, { trade: 'Patio cover', crew: 'Carpintería', sold_cents: 3500000 })).body;
    assert.equal(pc.code, 'PATIO-01'); assert.equal(pc.trade, 'PATIO COVER');
    const el = (await owner.post(`/api/jobs/${job.id}/lines`, { code: 'ELECT-01', trade: 'Electrical', sold_cents: 800000 })).body;
    assert.equal((await owner.post(`/api/jobs/${job.id}/lines`, { code: 'ELECT-01', trade: 'x' })).status, 400, 'código repetido');
    // Material del patio cover y el sub de electricidad acordado en $5,000 (sin pagar todavía)
    const ex = (await owner.post(`/api/jobs/${job.id}/expenses`, { date: '2026-11-10', category: 'material', description: 'Madera', amount_cents: 1000000 })).body;
    await owner.put(`/api/expenses/${ex.id}/line`, { line_id: pc.id });
    const d = (await owner.get(`/api/jobs/${job.id}`)).body;
    const luis = d.subs.find(s => s.name === 'Luis');
    await owner.put(`/api/subs/${luis.id}`, { agreed_cents: 500000, reason: 'acuerdo' });
    await owner.put(`/api/subs/${luis.id}/line`, { line_id: el.id });
    let L = (await owner.get(`/api/jobs/${job.id}/lines`)).body;
    const lp = L.lines.find(x => x.id === pc.id), le = L.lines.find(x => x.id === el.id);
    assert.equal(lp.cost_cents, 1000000); assert.equal(lp.margin_pct, 71.4);
    assert.equal(le.committed_cents, 500000); assert.equal(le.margin_cents, 300000);
    assert.equal(L.totals.diff_cents, 700000, 'el contrato tiene $7,000 que no están en partidas');
    // Pagarle al sub: el gasto cae solo en su partida y lo comprometido baja
    await owner.post(`/api/subs/${luis.id}/payments`, { date: '2026-11-12', amount_cents: 200000, method: 'Zelle', reason: 'pago' });
    L = (await owner.get(`/api/jobs/${job.id}/lines`)).body;
    const le2 = L.lines.find(x => x.id === el.id);
    assert.equal(le2.spent_cents, 200000); assert.equal(le2.committed_cents, 300000); assert.equal(le2.cost_cents, 500000);
    // Margen proyectado de la obra
    const m = (await owner.get(`/api/jobs/${job.id}`)).body.money;
    assert.ok(m.projectedCost >= 1000000 + 500000);
    // Reparto
    const sp = (await owner.get(`/api/jobs/${job.id}/split`)).body;
    assert.deepEqual(sp.split.map(x => x.pct), [35, 35, 30]);
    assert.equal(sp.shares[0].cents, Math.round(sp.base_cents * 0.35));
    const sf = await owner.put('/api/settings/finance', { profit_split: [{ name: 'Jack', pct: 30 }, { name: 'Glaiber', pct: 30 }, { name: 'PM', pct: 10 }, { name: 'EE', pct: 30 }] }); assert.equal(sf.status, 200, JSON.stringify(sf.body));
    assert.equal((await owner.put('/api/settings/finance', { profit_split: [{ name: 'Jack', pct: 50 }] })).status, 400, 'debe sumar 100');
    await owner.put(`/api/jobs/${job.id}/split`, { split: [{ name: 'Jack', pct: 50 }, { name: 'Glaiber', pct: 50 }] });
    assert.equal((await owner.get(`/api/jobs/${job.id}/split`)).body.custom, true);
    assert.equal((await pm.get(`/api/jobs/${job.id}/split`)).status, 403, 'el PM no ve el reparto');
    assert.equal((await pm.get('/api/reports/split')).status, 403);
    // Alerta de margen: subir el costo del patio cover
    const ex2 = (await owner.post(`/api/jobs/${job.id}/expenses`, { date: '2026-11-11', category: 'material', description: 'Más madera', amount_cents: 2800000 })).body;
    await owner.put(`/api/expenses/${ex2.id}/line`, { line_id: pc.id });
    const al = (await owner.get('/api/margin-alerts')).body;
    const a = al.jobs.find(x => x.id === job.id);
    assert.ok(a && a.low, JSON.stringify(al)); assert.equal(a.negative_lines[0].code, 'PATIO-01');
    const tr = (await owner.get('/api/reports/trades')).body.rows;
    assert.equal(tr.find(r => r.trade === 'PATIO COVER').flag, 'bajo');
    // Borrar una partida no borra lo gastado: queda sin partida
    await owner.del(`/api/lines/${pc.id}`);
    L = (await owner.get(`/api/jobs/${job.id}/lines`)).body;
    assert.equal(L.unassigned.spent_cents, 3800000);
  } finally { srv.close(); }
});

test('importar libros de Excel: partidas, materiales por ticket, subs y pagos, change orders, lecciones y duplicados', async () => {
  const { srv, owner, pm } = await start();
  try {
    const f = n => 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', n)).toString('base64');
    assert.equal((await pm.post('/api/import/xlsx/preview', { file: f('obra-activa.xlsx') })).status, 403, 'el PM no importa');
    assert.equal((await owner.post('/api/import/xlsx/preview', { file: 'data:text/plain;base64,aGVsbG8=' })).status, 400);
    const pv = (await owner.post('/api/import/xlsx/preview', { file: f('obra-activa.xlsx'), name: 'obra-activa.xlsx' })).body;
    assert.equal(pv.job.client_name, 'JOHN & JANE SAMPLE');
    assert.equal(pv.job.address, '100 Ejemplo Ln, DALLAS, TX');
    assert.equal(pv.lines.length, 4); assert.equal(pv.lines[0].sold_cents, 3581500);
    assert.equal(pv.project_type, 'outdoor_living');
    assert.equal(pv.materials.items, 4); assert.equal(pv.materials.tickets, 3);
    const eng = pv.subs.find(s => s.name === 'John Engineer'), exp = pv.subs.find(s => s.name === 'EXPRESS ELECTRIC'), ser = pv.subs.find(s => s.name === 'SERGIO RAMIREZ');
    assert.equal(eng.paid_in_full, true, 'Zelle = pagado');
    assert.equal(exp.paid_in_full, false, '"NOT a payment" no es pago');
    assert.equal(ser.paid_cents, 175000, 'CHECK1');
    assert.ok(pv.warnings.some(w => w.includes('PERMIT-01')));
    const cm = (await owner.post('/api/import/xlsx/commit', { file: f('obra-activa.xlsx'), name: 'obra-activa.xlsx', project_type: 'patio_cover' })).body;
    assert.ok(cm.job_id, JSON.stringify(cm));
    const d = (await owner.get(`/api/jobs/${cm.job_id}`)).body;
    assert.equal(d.job.project_type, 'patio_cover'); assert.equal(d.job.quoted_cents, 8178054);
    const L = (await owner.get(`/api/jobs/${cm.job_id}/lines`)).body;
    const pc = L.lines.find(l => l.code === 'PC-01');
    assert.equal(pc.spent_cents, 130902 + 39836 + 6316, 'materiales de PC-01');
    assert.equal(pc.committed_cents, 826500, 'Olivas acordado y sin pagar');
    const el = L.lines.find(l => l.code === 'ELECT-01');
    assert.equal(el.committed_cents, 353000);
    assert.ok(L.lines.find(l => l.code === 'PERMIT-01'), 'partida creada por el sub');
    assert.equal(L.lines.find(l => l.code === 'PERMIT-01').spent_cents, 90000, 'el ingeniero quedó pagado');
    const k = L.lines.find(l => l.code === 'KITCHEN-01');
    assert.equal(k.spent_cents, 22560 + 175000); assert.equal(k.committed_cents, 175000);
    assert.equal((await owner.get(`/api/jobs/${cm.job_id}/closeout`)).body.links.length, 2);
    // No se importa dos veces
    assert.ok((await owner.post('/api/import/xlsx/preview', { file: f('obra-activa.xlsx') })).body.duplicate);
    assert.equal((await owner.post('/api/import/xlsx/commit', { file: f('obra-activa.xlsx') })).status, 400);
    // Obra terminada con change order, pase directo, lección y revisión final
    const pv2 = (await owner.post('/api/import/xlsx/preview', { file: f('obra-terminada.xlsx') })).body;
    assert.equal(pv2.job.status, 'terminado'); assert.equal(pv2.job.start_date, '2026-04-15'); assert.equal(pv2.job.completed_date, '2026-07-30');
    assert.equal(pv2.lines.find(l => l.code === 'SP-01').pass_through, true);
    const c2 = (await owner.post('/api/import/xlsx/commit', { file: f('obra-terminada.xlsx'), paid_rows: [2] })).body;
    const d2 = (await owner.get(`/api/jobs/${c2.job_id}`)).body;
    assert.equal(d2.money.contract, 4358200, 'contrato = original + change order');
    assert.equal(d2.changes.length, 1);
    const L2 = (await owner.get(`/api/jobs/${c2.job_id}/lines`)).body;
    assert.equal(L2.lines.find(l => l.code === 'SP-01').sold_total_cents, 200000, '1,500 + 500 de change order');
    assert.equal(L2.lines.find(l => l.code === 'SP-01').spent_cents, 78000, 'Hardy Leaf marcado pagado');
    assert.ok(L2.lines.find(l => l.code === 'PC-01').description.includes('528 sqft'));
    const co = (await owner.get(`/api/jobs/${c2.job_id}/closeout`)).body;
    assert.equal(co.lessons.length, 1); assert.equal(co.lessons[0].cost_cents, 450000); assert.equal(co.review.profitable, 'YES');
    assert.equal(d2.tasks[0].status, 'hecho');
  } finally { srv.close(); }
});

test('agentes: llave de lectura o escritura, papel de operador, reglas de PM, empresa de la llave y quitar la llave', async () => {
  const { srv, owner, job, pm } = await start();
  try {
    const bot = (key, m, u, b) => fetch(srv.base + u, { method: m, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
      .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
    assert.equal((await pm.post('/api/agents', { name: 'x' })).status, 403, 'el PM no crea agentes');
    const a = (await owner.post('/api/agents', { name: 'Grok operaciones', kind: 'operador' })).body;
    assert.equal(a.name, '🤖 Grok operaciones'); assert.equal(a.role, 'pm'); assert.equal(a.pm_all, true);
    assert.ok(!(await owner.get('/api/users')).body.some(u => u.id === a.id), 'no sale en la lista del equipo');
    const ro = (await owner.post(`/api/agents/${a.id}/keys`, { can_write: false })).body.key;
    const rw = (await owner.post(`/api/agents/${a.id}/keys`, { can_write: true })).body.key;
    assert.match(ro, /^eek_ee_/);
    // Leer
    assert.equal((await bot('nada', 'GET', '/api/jobs')).status, 401);
    const jobs = await bot(ro, 'GET', '/api/jobs');
    assert.equal(jobs.status, 200); assert.ok(jobs.body.some(j => j.id === job.id), 've todas las obras');
    assert.equal((await bot(ro, 'GET', `/api/jobs/${job.id}/lines`)).status, 200);
    assert.equal((await bot(ro, 'POST', `/api/jobs/${job.id}/tasks`, { title: 'x' })).status, 403, 'solo lectura');
    // Escribir con la llave de escritura
    const tk = await bot(rw, 'POST', `/api/jobs/${job.id}/tasks`, { title: 'Revisar gutters' });
    assert.equal(tk.status, 200, JSON.stringify(tk.body));
    // Dinero grande: queda esperando a un dueño
    let ex = await bot(rw, 'POST', `/api/jobs/${job.id}/expenses`, { date: '2026-11-20', category: 'material', description: 'Madera', amount_cents: 900000 });
    assert.equal(ex.status, 428, 'pide el motivo');
    ex = await bot(rw, 'POST', `/api/jobs/${job.id}/expenses`, { date: '2026-11-20', category: 'material', description: 'Madera', amount_cents: 900000, reason: 'Compra grande de madera' });
    assert.equal(ex.body.pending, true, JSON.stringify(ex));
    // Lo que nunca puede hacer
    for (const [m, u] of [['GET', '/api/reports/split'], ['PUT', '/api/settings/finance'], ['POST', '/api/agents'], ['POST', '/api/users'], ['GET', '/api/forecast']]) assert.equal((await bot(rw, m, u, m === 'GET' ? undefined : {})).status, 403, u);
    const reqs = (await owner.get('/api/change-requests')).body;
    assert.ok(JSON.stringify(reqs).includes('🤖'), 'la solicitud dice que fue el agente');
    // Instrucciones para el bot
    const man = await bot(ro, 'GET', '/api/agent/manual');
    assert.equal(man.status, 200); assert.ok(man.body.text.includes('Authorization: Bearer')); assert.ok(man.body.openapi.paths['/api/jobs']);
    // Quitar la llave / apagar al agente
    const keys = (await owner.get('/api/agents')).body[0].keys;
    await owner.del(`/api/agent-keys/${keys.find(k => !k.can_write).id}`);
    assert.equal((await bot(ro, 'GET', '/api/jobs')).status, 401);
    await owner.put(`/api/agents/${a.id}`, { active: false });
    assert.equal((await bot(rw, 'GET', '/api/jobs')).status, 401);
    // Una llave de una empresa no sirve en otra
    assert.equal((await bot(rw.replace('eek_ee_', 'eek_jkl_'), 'GET', '/api/jobs')).status, 401);
  } finally { srv.close(); }
});
