'use strict';
// Crea una carpeta "datos-demo" con obras y usuarios FICTICIOS para practicar.
// No toca la carpeta "datos" real.   Uso: node demo.js
const fs = require('node:fs');
const path = require('node:path');
const { open, tx } = require('./lib/db');
const { hashPassword } = require('./lib/auth');
const C = require('./lib/catalog');

const dir = path.join(__dirname, 'datos-demo');
fs.rmSync(dir, { recursive: true, force: true });
const db = open(dir);
const pw = hashPassword('demo-demo-123');
// Días en la hora local del negocio (Texas), igual que la app.
const day = n => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: process.env.APP_TZ || 'America/Chicago' });

tx(db, () => {
  const u = (name, username, role, trade = '', phone = '') => Number(db.prepare('INSERT INTO users(name,username,pass_hash,role,trade,lang,phone) VALUES(?,?,?,?,?,?,?)')
    .run(name, username, pw, role, trade, role === 'client' ? 'en' : 'es', phone).lastInsertRowid);
  const owner = u('Dueño Demo', 'dueno', 'owner', '', '(555) 010-0001');
  u('Jack (demo)', 'jack', 'owner', '', '(555) 010-0009');
  const pedro = u('Pedro (demo)', 'pedro', 'worker', 'Carpintería', '(555) 010-0002');
  const luis = u('Luis (demo)', 'luis', 'worker', 'Electricidad', '(555) 010-0003');
  const cli = u('Mrs. Sample', 'cliente', 'client');
  const mario = u('Mario (PM demo)', 'mario', 'pm', 'Project manager', '(555) 010-0005');
  db.prepare("UPDATE users SET trades='carpinteria,techo,pintura,piedra' WHERE id=?").run(pedro);
  db.prepare("UPDATE users SET trades='electricidad,av' WHERE id=?").run(luis);

  const job = (f, typeKey, progressDone) => {
    const id = Number(db.prepare(`INSERT INTO jobs(client_name,client_phone,address,project_type,description,status,quoted_cents,start_date,end_date,follow_up_date,lead_source,client_user_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.name, f.phone, f.address, typeKey, f.desc, f.status, f.quoted, f.start || '', f.end || '', f.follow || '', f.source || '', f.client || null).lastInsertRowid);
    const tpl = C.PROJECT_TYPES.find(t => t.key === typeKey).tasks;
    // Cada tarea con su trade; Pedro hace carpintería, techo y pintura; Luis eléctrico y A/V (un crew, varios trades).
    const crew = tr => (['carpinteria', 'techo', 'pintura', 'piedra'].includes(tr) ? pedro : ['electricidad', 'av'].includes(tr) ? luis : null);
    tpl.forEach(([title, , trade], i) => db.prepare('INSERT INTO tasks(job_id,position,title,status,done_date,assignee_id,planned_date,trade) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, (i + 1) * 10, title, i < progressDone ? 'hecho' : i === progressDone ? 'en_progreso' : 'pendiente',
        i < progressDone ? day(-20 + i) : '', crew(trade), i >= progressDone && i < progressDone + 4 ? day(i - progressDone) : '', trade || ''));
    return id;
  };
  const a = job({ name: 'Sample Family (demo)', phone: '(000) 000-0001', address: '100 Demo Lane, Double Oak, TX', desc: 'Patio cover 20x14 con techo de tejas, 2 ventiladores y 4 luces.',
    status: 'activo', quoted: 2850000, start: day(-21), end: day(14), client: cli, source: 'Google' }, 'patio_cover', 8);
  const b = job({ name: 'Ejemplo Rodríguez (demo)', phone: '(000) 000-0002', address: '200 Prueba Ct, Flower Mound, TX', desc: 'Cocina exterior en L con parrilla y cubierta de granito.',
    status: 'activo', quoted: 3400000, start: day(-7), end: day(30), source: 'Referido' }, 'outdoor_kitchen', 3);
  const johnson = job({ name: 'Prospecto Johnson (demo)', phone: '(000) 000-0003', address: '300 Test Dr, Argyle, TX', desc: 'Fire pit de gas', status: 'cotizado', quoted: 750000, follow: day(-1), source: 'Google' }, 'fire_pit', 0);
  // v2.23: dos trabajos vendidos en la fila de espera (Kilmichael ya preguntó: Pedro sí, Luis falta; Crestfield sin preguntar).
  const queued = (name, addr, desc, quoted, since, type) => {
    const id = job({ name, phone: '(000) 000-0009', address: addr, desc, status: 'activo', quoted, source: 'Referido' }, type, 0);
    db.prepare("UPDATE tasks SET status=CASE WHEN trade='planos' THEN 'hecho' ELSE 'pendiente' END, done_date=CASE WHEN trade='planos' THEN ? ELSE '' END WHERE job_id=?").run(day(-2), id);
    db.prepare("UPDATE tasks SET planned_date='', planned_end='' WHERE job_id=?").run(id);
    let d = 12;
    for (const t of db.prepare("SELECT id, trade FROM tasks WHERE job_id=? AND trade<>'planos' ORDER BY position").all(id)) { db.prepare('UPDATE tasks SET planned_date=?, planned_end=? WHERE id=?').run(day(d), day(d), t.id); d += 1; }
    db.prepare('UPDATE jobs SET queue_since=?, queue_state=?, won_date=? WHERE id=?').run(day(since), 'espera', day(since), id);
    return id;
  };
  const qk = queued('Vendido Kilmichael (demo)', '400 Muestra Ln, Highland Village, TX', 'Patio cover con cocina exterior y calentadores.', 6800000, -9, 'outdoor_living');
  const qc = queued('Vendido Crestfield (demo)', '500 Modelo St, Lantana, TX', 'Patio cover 16x12.', 3100000, -4, 'patio_cover');
  // Luis tiene trabajo en Sample Family a mediados de diciembre (se ve en su calendario al contestar).
  db.prepare("UPDATE tasks SET planned_date=?, planned_end=? WHERE id=(SELECT id FROM tasks WHERE job_id=? AND assignee_id=? AND status='pendiente' AND planned_date='' ORDER BY position DESC LIMIT 1)").run(day(17), day(21), a, luis);
  job({ name: 'Prospecto Lee (demo)', phone: '(000) 000-0004', address: '', desc: 'Muro de piedra para TV', status: 'prospecto', quoted: 0, follow: day(3), source: 'Vecino' }, 'tv_wall', 0);

  const e = (job, date, cat, desc, vendor, by, amt, sub = null) => db.prepare('INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,sub_id) VALUES(?,?,?,?,?,?,?,?)')
    .run(job, date, cat, desc, vendor, by, amt, sub);
  e(a, day(-20), 'permisos', 'Permiso de construcción', 'Ciudad', 'Jack', 45000);
  e(a, day(-15), 'material', 'Madera y herrajes', 'Home Depot', 'Pedro', 612000);
  e(a, day(-14), 'renta_equipo', 'Barrenadora para pilares', 'Sunbelt Rentals', 'Pedro', 28000);
  e(a, day(-12), 'material', 'Concreto y varilla', 'Lowe’s', 'Glaiber', 98000);
  e(a, day(-6), 'retrabajo', 'Rehacer viga mal cortada', 'Home Depot', 'Pedro', 34000);
  e(a, day(-3), 'basura', 'Contenedor de basura', 'Waste Co', 'Jack', 42000);
  const roof = Number(db.prepare('INSERT INTO subs(job_id,name,trade,agreed_cents) VALUES(?,?,?,?)').run(a, 'Techos Demo LLC', 'Techo / tejas', 380000).lastInsertRowid);
  db.prepare("INSERT INTO subs(job_id,name,trade,agreed_cents,user_id,trades) VALUES(?,?,?,?,?,'electricidad,av')").run(a, 'Luis (demo)', 'Electricidad', 220000, luis);
  e(a, day(-4), 'subcontratistas', 'Anticipo techo', 'Cheque #101', 'Glaiber', 190000, roof);
  e(b, day(-6), 'material', 'Block y mortero', 'Home Depot', 'Pedro', 154000);
  e(b, day(-2), 'subcontratistas', 'Plomero gas', 'Zelle', 'Jack', 85000);
  db.prepare("INSERT INTO change_orders(job_id,date,description,cost_cents,price_cents,status,code,category,approved_at,done_at) VALUES(?,?,?,?,?,'aprobado','LIGHT-01','LIGHT',?,?)").run(a, day(-10), 'Agregar 2 luces más', 18000, 45000, day(-9), day(-2));
  db.prepare("INSERT INTO change_orders(job_id,date,description,cost_cents,price_cents,status,code,category) VALUES(?,?,?,?,?,'pendiente','PAINT-02','PAINT')").run(a, day(-1), 'Stain color oscuro en vez de natural', 15000, 60000);
  db.prepare('INSERT INTO payments(job_id,date,amount_cents,method,note) VALUES(?,?,?,?,?)').run(a, day(-25), 1000000, 'Cheque', 'Depósito inicial');
  db.prepare('INSERT INTO payments(job_id,date,amount_cents,method,note) VALUES(?,?,?,?,?)').run(a, day(-8), 900000, 'Zelle', 'Segundo pago');
  db.prepare('INSERT INTO payments(job_id,date,amount_cents,method,note) VALUES(?,?,?,?,?)').run(b, day(-7), 1200000, 'Cheque', 'Depósito');
  // Ejemplos del calendario: tareas de varios días, un aviso respondido y novedades del cliente.
  db.prepare("UPDATE tasks SET planned_end=? WHERE job_id=? AND position=90").run(day(2), a);
  const tb = db.prepare('SELECT id, planned_date FROM tasks WHERE job_id=? AND assignee_id=? AND status<>? ORDER BY position LIMIT 1').get(b, pedro, 'hecho');
  if (tb) db.prepare(`INSERT INTO notices(job_id,task_id,kind,created_by,to_user_id,old_date,reason,note,status,response_date,response_note,responded_at)
    VALUES(?,?,'worker',?,?,?,'material','','respondido',?,'La madera llega el lunes',datetime('now'))`).run(b, tb.id, pedro, pedro, tb.planned_date, day(4));
  // Ejemplos de estimado e invoice mandados por subs, esperando revisión.
  const L = x => JSON.stringify(x);
  db.prepare(`INSERT INTO sub_docs(job_id,sub_user_id,type,number,date,description,lines,total_cents) VALUES(?,?,'estimate','EST-0001',?,?,?,?)`)
    .run(a, luis, day(-2), 'Electricidad completa del patio', L([{ desc: 'Rough eléctrico', qty: 1, unit_cents: 120000, amount_cents: 120000 }, { desc: 'Ventiladores (instalación)', qty: 2, unit_cents: 15000, amount_cents: 30000 }, { desc: 'Luces empotradas', qty: 4, unit_cents: 7500, amount_cents: 30000 }]), 180000);
  db.prepare(`INSERT INTO sub_docs(job_id,sub_user_id,type,number,date,due_date,description,lines,total_cents) VALUES(?,?,'invoice','INV-0001',?,?,?,?,?)`)
    .run(b, pedro, day(-1), day(14), 'Estructura de block', L([{ desc: 'Block y mano de obra', qty: 1, unit_cents: 260000, amount_cents: 260000 }]), 260000);
  db.prepare("INSERT INTO doc_history(doc_id,user_id,action,total_after) SELECT id, sub_user_id, 'enviado', total_cents FROM sub_docs").run();
  db.prepare("INSERT INTO client_updates(job_id,kind,data,note,created_at) VALUES(?,'status',?,'',datetime('now','-21 days'))").run(a, JSON.stringify({ status: 'activo', end_date: day(14) }));
  db.prepare("INSERT INTO client_updates(job_id,kind,data,note,created_at) VALUES(?,'change_order',?,'',datetime('now','-10 days'))").run(a, JSON.stringify({ description: 'Agregar 2 luces más', price: 45000 }));
  // v1.6: presupuesto, permisos, reporte diario, reloj, prospecto web, obra terminada para seguimiento.
  const bud = db.prepare('INSERT INTO budgets(job_id,category,cents) VALUES(?,?,?)');
  bud.run(a, 'material', 900000); bud.run(a, 'subcontratistas', 700000); bud.run(a, 'permisos', 50000); bud.run(a, 'mano_obra', 300000);
  bud.run(b, 'material', 300000); bud.run(b, 'subcontratistas', 400000);
  const per = db.prepare('INSERT INTO permits(job_id,kind,name,number,status,date,notes) VALUES(?,?,?,?,?,?,?)');
  per.run(a, 'permiso', 'Permiso de construcción', 'BP-2026-0142', 'aprobado', day(-30), 'Ciudad de Double Oak');
  per.run(a, 'inspeccion', 'Inspección de zapatas', '', 'aprobado', day(-20), '');
  per.run(a, 'inspeccion', 'Inspección final', '', 'programada', day(3), 'Llamar al inspector un día antes');
  per.run(b, 'permiso', 'Permiso de gas', '', 'solicitado', day(-4), '');
  per.run(b, 'permiso', 'Permiso de construcción', 'BP-2026-0188', 'aprobado', day(-1), 'Ciudad de Flower Mound — aprobado ayer');
  db.prepare("UPDATE permits SET inspections_set=1 WHERE job_id=? AND kind='permiso'").run(a);
  const lg = db.prepare('INSERT INTO daily_logs(job_id,date,client_notes,internal_notes,crew,weather,shared,created_by) VALUES(?,?,?,?,?,?,1,?)');
  lg.run(a, day(-2), 'Se terminó el techo de tejas y se instalaron los ventiladores. Mañana: luces y sellado.', 'Faltan 2 cajas de tornillos', 'Pedro, Luis', 'Soleado, 72°', owner);
  lg.run(a, day(-1), 'Se instalaron las 4 luces empotradas. Queda pendiente el color del stain.', '', 'Luis', 'Nublado, 65°', owner);
  db.prepare('UPDATE users SET rate_cents=2800 WHERE id=?').run(pedro);
  db.prepare("INSERT INTO time_entries(user_id,job_id,in_at,in_lat,in_lng,in_dist,rate_cents) VALUES(?,?,datetime('now','-3 hours'),33.0641,-97.1076,40,2800)").run(pedro, b);
  db.prepare('UPDATE jobs SET lat=33.0640, lng=-97.1075 WHERE id=?').run(b);
  // Trabajador por hora con dos semanas de horas (una con tiempo extra, otra ya pagada).
  db.prepare("UPDATE users SET pay_type='hora' WHERE id=?").run(pedro);
  const juan = u('Juan (demo, por hora)', 'juan', 'worker', 'Ayudante general', '(555) 010-0011');
  db.prepare("UPDATE users SET pay_type='hora', rate_cents=2200 WHERE id=?").run(juan);
  db.prepare("UPDATE users SET pay_type='sub' WHERE id=?").run(luis);
  const LAB = require('./lib/labor');
  const utcAt = (d, h) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCHours(h + 6); return x.toISOString().replace('T', ' ').slice(0, 19); };
  const work = (uid, jobId, d, h1, h2, rate) => {
    const inAt = utcAt(d, h1), outAt = utcAt(d, h2), min = (h2 - h1) * 60;
    const exp = Number(db.prepare("INSERT INTO expenses(job_id,date,category,description,bought_by,amount_cents,created_by) VALUES(?,?,'mano_obra',?,?,?,?)")
      .run(jobId, d, `Horas: ${uid === juan ? 'Juan (demo, por hora)' : 'Pedro (demo)'} (${(min / 60).toFixed(2)} h)`, '', Math.round(min / 60 * rate), uid).lastInsertRowid);
    db.prepare('INSERT INTO time_entries(user_id,job_id,in_at,out_at,minutes,rate_cents,expense_id,note) VALUES(?,?,?,?,?,?,?,?)').run(uid, jobId, inAt, outAt, min, rate, exp, '');
  };
  const wk0 = LAB.settings(db) && (() => { const t = day(0); const dow = new Date(t + 'T12:00:00Z').getUTCDay(); return day(-((dow + 6) % 7)); })();
  const off = (base, n) => { const x = new Date(base + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const last = off(wk0, -7), prev = off(wk0, -14);
  [0, 1, 2, 3, 4].forEach(i => work(juan, i < 3 ? a : b, off(last, i), 7, 16, 2200));
  work(juan, b, off(last, 5), 8, 14, 2200);   // sábado: 6 h más (5 × 9 h + 6 h = 51 h → 11 h de tiempo extra)
  [0, 1, 2, 3].forEach(i => work(pedro, a, off(last, i), 7, 15, 2800));
  [0, 1, 2, 3, 4].forEach(i => work(juan, a, off(prev, i), 7, 15, 2200));
  [last, prev].forEach(w => { LAB.syncOT(db, juan, w); LAB.syncOT(db, pedro, w); });
  db.prepare("INSERT INTO payroll(user_id,week_start,minutes,ot_minutes,total_cents,method,note,paid_by) VALUES(?,?,?,?,?,?,?,?)").run(juan, prev, 40 * 60, 0, 40 * 2200, 'Zelle', '', owner);
  if (day(0) !== wk0) work(juan, a, wk0, 7, 15, 2200);
  // Publicidad de ejemplo (últimos 3 meses) y papeles de un sub.
  for (let k = 0; k < 3; k++) { const m = new Date(day(0) + 'T12:00:00Z'); m.setUTCMonth(m.getUTCMonth() - k); const ym = m.toISOString().slice(0, 7);
    db.prepare('INSERT INTO marketing_spend(month,channel,amount_cents,note) VALUES(?,?,?,?)').run(ym, 'Google', 40000, 'Google Ads');
    db.prepare('INSERT INTO marketing_spend(month,channel,amount_cents,note) VALUES(?,?,?,?)').run(ym, 'Facebook / Instagram', 10000, ''); }
  // Historial de ejemplo: así se ve lo que queda registrado.
  const jkId = db.prepare("SELECT id FROM users WHERE username='jack'").get().id;
  [[owner, 'crear', 'pago del cliente', 2, 'Pago del cliente: Ejemplo Rodríguez (demo) — cheque', 1200000, '', -3],
   [mario, 'solicitud', 'gasto', 2, 'Mario pide registrar compra de $820 en Home Depot (arriba de su límite)', 82000, 'Faltó madera para la estructura', -2],
   [jkId, 'aprobar', 'gasto', 2, 'Aprobó la compra de $820 en Home Depot de Mario', 82000, 'OK', -2],
   [owner, 'editar', 'pago a sub', 2, 'Pago parcial a Pedro (demo): de $900 a $1,000', 100000, 'Se le pagó el material también', -1],
   [jkId, 'solicitud', 'change order', 1, 'Cambio de $1,500 en el change order de Sample Family: necesita la aprobación del otro dueño', 150000, 'Cliente pidió stain oscuro', 0]]
    .forEach(([u, act, ent, job, sum, amt, why, d]) => db.prepare("INSERT INTO audit_log(at,user_id,action,entity,job_id,summary,amount_cents,reason) VALUES(datetime(?,'+15 hours'),?,?,?,?,?,?,?)").run(day(d), u, act, ent, job, sum, amt, why));
  // Plantillas de tareas de la compañía (editables). La ★ sale escogida al crear una obra de ese tipo.
  const tplT = rows => JSON.stringify(rows.map(([title, days, trade, inspection]) => ({ title, days, trade: trade || '', inspection: !!inspection, notes: '' })));
  db.prepare("INSERT INTO plan_templates(name,project_type,tasks,is_default,created_by,updated_at) VALUES(?,?,?,1,?,datetime('now'))").run('Patio cover with fireplace & A/V', 'patio_cover', tplT([
    ['811 locate', 1], ['Dig piers 24x24x36 + rebar', 1, 'Concrete'], ['Pier inspection', 1, '', 1], ['Pour piers', 1, 'Concrete'], ['Framing: posts, beam, rafters', 3, 'Framing'],
    ['Rough electrical + A/V + gas', 2, 'Electrical'], ['Rough inspection (electrical / gas)', 1, '', 1], ['Roof', 2, 'Roofing'], ['Ceiling cedar T&G', 2, 'Framing'],
    ['Stone / fireplace', 3, 'Stone'], ['Paint / stain', 2, 'Paint'], ['Finish electrical + A/V', 1, 'Electrical'], ['Punch list + clean up', 1], ['Final inspection', 1, '', 1]]), owner);
  db.prepare("INSERT INTO plan_templates(name,project_type,tasks,is_default,created_by,updated_at) VALUES(?,?,?,1,?,datetime('now'))").run('Outdoor kitchen', 'outdoor_kitchen', tplT([
    ['Layout + footing', 2, 'Concrete'], ['Footing inspection', 1, '', 1], ['Block structure', 3, 'Stone'], ['Rough gas / electrical / plumbing', 2, 'Plumbing'], ['Rough inspection', 1, '', 1],
    ['Stone veneer', 3, 'Stone'], ['Countertop template + install', 2, 'Granite'], ['Appliances', 1], ['Clean up + final inspection', 1, '', 1]]), owner);
  // Tickets de ejemplo: uno dividido entre dos obras, la empresa (herramienta) y algo personal; y gastos generales.
  { const R = require('./lib/receipts');
    const rc = (vendor, ticket, date, sub, pay, personal = 0) => Number(db.prepare(`INSERT INTO receipts(vendor,vendor_key,ticket,ticket_key,date,subtotal_cents,tax_cents,total_cents,personal_cents,pay_method,created_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(vendor, R.vkey(vendor), ticket, R.tkey(ticket), date, sub, Math.round(sub * 0.0825), sub + Math.round(sub * 0.0825), personal, pay, owner).lastInsertRowid);
    const r1 = rc('Home Depot', '4471-0098', day(-3), 61000, 'tarjeta', 2165);
    const t = R.splitTax([{ subtotal_cents: 32000 }, { subtotal_cents: 14000 }, { subtotal_cents: 13000 }, { subtotal_cents: 2000 }], Math.round(61000 * 0.0825));
    db.prepare(`INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,created_by,ticket,subtotal_cents,tax_cents,pay_method,receipt_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(a, day(-3), 'material', 'Cedar 1x6 T&G, screws', 'Home Depot', 'Dueño Demo', 32000 + t[0], owner, '4471-0098', 32000, t[0], 'tarjeta', r1);
    db.prepare(`INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,created_by,ticket,subtotal_cents,tax_cents,pay_method,receipt_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b, day(-3), 'material', 'Mortar, metal lath', 'Home Depot', 'Dueño Demo', 14000 + t[1], owner, '4471-0098', 14000, t[1], 'tarjeta', r1);
    db.prepare(`INSERT INTO company_expenses(date,category,description,vendor,ticket,pay_method,subtotal_cents,tax_cents,amount_cents,receipt_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(day(-3), 'herramienta', 'DeWalt 20V impact driver', 'Home Depot', '4471-0098', 'tarjeta', 13000, t[2], 13000 + t[2], r1, owner);
    const ce = db.prepare('INSERT INTO company_expenses(date,category,description,vendor,pay_method,amount_cents,created_by) VALUES(?,?,?,?,?,?,?)');
    ce.run(day(-2), 'gasolina', 'Fuel – work truck', 'QT', 'tarjeta', 8640, owner); ce.run(day(-9), 'seguro', 'General liability – monthly', 'Insurance Co.', 'zelle', 42500, owner);
    ce.run(day(-6), 'software', 'Phone plan', 'Verizon', 'tarjeta', 15500, owner); }
  const soon = day(18);
  db.prepare("INSERT INTO sub_papers(key,name,tax_class,w9_file,w9_date,coi_expires,coi_carrier) VALUES(?,?,?,?,?,?,?)").run('u' + pedro, 'Pedro (demo)', 'individual', '', '', soon, 'Texas Mutual');
  db.prepare(`INSERT INTO jobs(client_name,client_phone,client_email,address,project_type,description,status,lead_source,follow_up_date,lead_new)
    VALUES('Ana Web (demo)','(000) 000-0009','ana@example.com','300 Ejemplo Rd, Argyle, TX','outdoor_kitchen','Quiero una cocina exterior con pérgola.\nPresupuesto: $25k–$50k','prospecto','Web',?,1)`).run(day(0));
  db.prepare(`INSERT INTO jobs(client_name,client_phone,address,project_type,description,status,quoted_cents,start_date,completed_date,lead_source)
    VALUES('Terminado García (demo)','(000) 000-0008','400 Muestra St, Double Oak, TX','fire_pit','Fogón de piedra con bancas.','terminado',1450000,?,?,'Referido')`).run(day(-200), day(-185));
  // v1.7: historial de ejemplo (18 meses) para ver las proyecciones. Se puede borrar en Proyecciones.
  {
    let seed = 42; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const season = [0.6, 0.7, 1.1, 1.3, 1.3, 1.1, 0.9, 0.9, 1.1, 1.2, 0.9, 0.6];
    const types = [['Patio cover', 2600000, 0.36], ['Patio cover', 2400000, 0.36], ['Cocina exterior', 4200000, 0.29], ['Fogón', 1300000, 0.42], ['Sala exterior', 6500000, 0.31]];
    const sources = [['Referido', 0.6], ['Google', 0.3], ['Facebook', 0.22], ['Vecino', 0.5], ['Web', 0.3]];
    const ins = db.prepare('INSERT INTO hist_jobs(lead_date,won_date,done_date,client,project_type,source,price_cents,cost_cents,won) VALUES(?,?,?,?,?,?,?,?,?)');
    const map = { 'Patio cover': 'patio_cover', 'Cocina exterior': 'outdoor_kitchen', 'Fogón': 'fire_pit', 'Sala exterior': 'outdoor_living' };
    const base = new Date(); base.setUTCDate(1); base.setUTCMonth(base.getUTCMonth() - 18);
    for (let m = 0; m < 18; m++) {
      const mo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + m, 1));
      const n = Math.round(7 * season[mo.getUTCMonth()] + (rnd() - 0.5) * 3);
      for (let i = 0; i < n; i++) {
        const lead = new Date(mo.getTime() + Math.floor(rnd() * 27) * 864e5);
        const [tn, avg, mg] = types[Math.floor(rnd() * types.length)];
        const [src, p] = sources[Math.floor(rnd() * sources.length)];
        const won = rnd() < p;
        const price = Math.round(avg * (0.75 + rnd() * 0.5) / 100) * 100;
        const close = new Date(lead.getTime() + (10 + Math.floor(rnd() * 40)) * 864e5);
        const done = new Date(close.getTime() + (25 + Math.floor(rnd() * 45)) * 864e5);
        const iso = d => d.toISOString().slice(0, 10);
        ins.run(iso(lead), won ? iso(close) : '', won ? iso(done) : '', 'Histórico ' + (m * 10 + i), map[tn], src, price, won ? Math.round(price * (1 - mg + (rnd() - 0.5) * 0.12)) : 0, won ? 1 : 0);
      }
    }
  }
  // Project manager a cargo de la obra de Rodríguez.
  db.prepare('UPDATE jobs SET pm_id=? WHERE id=?').run(mario, b);
  // Caso de ejemplo: lo abrió Pedro, está a cargo de Mario con fecha límite, y Luis también participa.
  { const iid = Number(db.prepare("INSERT INTO issues(job_id,kind,title,urgent,status,created_by,created_role,worker_id,client_visible,assignee_id,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now','-26 hours'),datetime('now','-3 hours'))")
      .run(b, 'problema', 'Caja eléctrica donde va la cubierta', 1, 'abierto', pedro, 'worker', pedro, 0, mario, day(1)).lastInsertRowid);
    db.prepare('INSERT INTO issue_members(issue_id,user_id,added_by) VALUES(?,?,?)').run(iid, luis, mario);
    const msg = (uid, body, h) => db.prepare("INSERT INTO issue_messages(issue_id,user_id,visibility,body,created_at) VALUES(?,?,'interno',?,datetime('now',?))").run(iid, uid, body, `-${h} hours`);
    msg(pedro, 'Al poner la base de la cubierta salió una caja eléctrica justo donde va el granito. No sigo con esa parte hasta que me digan.', 26);
    msg(mario, '📌 Responsable / In charge: Mario (PM demo) · Fecha límite / Due: ' + day(1), 25);
    msg(mario, '➕ Luis (demo) se unió al caso / joined the case', 25);
    msg(mario, 'Luis, ¿se puede mover la caja 12 pulgadas a la izquierda? Pedro, mientras avanza con el lado sur.', 24);
    msg(luis, 'Sí se puede, pero necesito cortar el muro. Mañana temprano lo hago.', 3); }
  // Pregunta de ejemplo del cliente (esperando respuesta de la empresa).
  { const qid = Number(db.prepare("INSERT INTO issues(job_id,kind,title,urgent,status,created_by,created_role,client_visible,created_at,updated_at) VALUES(?,?,?,0,'abierto',?,'client',1,datetime('now','-5 hours'),datetime('now','-5 hours'))")
      .run(a, 'pregunta', '¿Pueden poner una luz extra en la esquina?', cli).lastInsertRowid);
    db.prepare("INSERT INTO issue_messages(issue_id,user_id,visibility,body,created_at) VALUES(?,?,'cliente',?,datetime('now','-5 hours'))").run(qid, cli, 'Hi! Could you add one more recessed light in the corner by the grill? Let me know the cost.'); }
  // Pago directo a un sub (para ver su estado de cuenta).
  if (!db.prepare('SELECT id FROM subs WHERE job_id=? AND user_id=?').get(b, pedro)) db.prepare('INSERT INTO subs(job_id,name,trade,agreed_cents,user_id) VALUES(?,?,?,?,?)').run(b, 'Pedro (demo)', 'Carpintería', 450000, pedro);
  const ps = db.prepare('SELECT id FROM subs WHERE job_id=? AND user_id=?').get(b, pedro);
  if (ps) db.prepare("INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,sub_id) VALUES(?,?,'subcontratistas','Pago parcial a Pedro','Zelle','Jack',?,?)").run(b, day(-3), 100000, ps.id);
  db.prepare("INSERT INTO meta(key,value) VALUES('pay_info','Zelle: pagos@ejemplo.com · Cheque a nombre de Elevated Exteriors') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  // ===== v2.0: ventas, materiales, galería, reporte de PMs =====
  const assets = path.join(__dirname, 'demo-assets');
  const now = (d, h = '10:00:00') => d + ' ' + h;
  const vero = u('Vero (vendedora demo)', 'vero', 'sales', '', '(555) 010-0007');
  // v2.26: oficina y contadora; Luis es encargado de cuadrilla.
  u('Rosa (oficina demo)', 'rosa', 'admin', '', '(555) 010-0008');
  u('Contadora (demo)', 'contadora', 'accountant', '', '');
  db.prepare("UPDATE users SET tools='cuadrilla' WHERE username='luis'").run();
  db.prepare("UPDATE users SET tools='ventas' WHERE username='jack'").run();
  // v2.24: planes del día (hoy del dueño a medias; mañana de Mario con algo que pidió el dueño; Luis con lo que pidió Mario).
  {
    const pi = db.prepare('INSERT INTO plan_items(user_id,date,text,job_id,time,position,assigned_by,created_by,status,reason) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const tm = (() => { let d = day(1); if (new Date(d + 'T12:00:00Z').getUTCDay() === 0) d = day(2); return d; })();
    pi.run(owner, day(0), 'Walk-through con el cliente en Sample Family', a, '08:00', 10, null, owner, 'hecho', '');
    pi.run(owner, day(0), 'Recoger tejas en ABC Supply', b, '10:30', 20, null, owner, 'hecho', '');
    pi.run(owner, day(0), 'Revisar la reinspección de framing', a, '13:00', 30, null, owner, 'pendiente', '');
    pi.run(owner, day(0), 'Llamar a la contadora por el cierre de mes', null, '', 40, null, owner, 'no', 'No contestó; le dejé mensaje');
    pi.run(mario, tm, 'Revisar el rough-in con Luis antes de cerrar', a, '07:30', 10, owner, owner, 'pendiente', '');
    pi.run(mario, tm, 'Medir la barra de granito en Ejemplo Rodríguez', b, '11:00', 20, null, mario, 'pendiente', '');
    pi.run(luis, tm, 'Cambiar a cable UF del switch al abanico', a, '', 10, mario, mario, 'pendiente', '');
    pi.run(vero, tm, 'Llamar a los 3 prospectos de Google', null, '09:00', 10, owner, owner, 'pendiente', '');
  }
  // v2.25: historial diario (ayer y antier cerrados en inglés; hoy en vivo; una nota tardía).
  {
    const H = require('./lib/history');
    const sha = t => require('node:crypto').createHash('sha1').update(String(t)).digest('hex');
    db.exec("CREATE TABLE IF NOT EXISTS translations (h TEXT NOT NULL, lang TEXT NOT NULL, src TEXT NOT NULL DEFAULT '', out TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (h, lang))");
    const trs = db.prepare('INSERT OR REPLACE INTO translations(h,lang,src,out) VALUES(?,?,?,?)');
    const seed = (es, en) => { trs.run(sha(es), 'es', 'es', es); trs.run(sha(es), 'en', 'es', en); };
    seed('Se terminó el techo de tejas y se instalaron los ventiladores. Mañana: luces y sellado.', 'The shingle roof was finished and the fans were installed. Tomorrow: lights and sealing.');
    seed('Faltan 2 cajas de tornillos', '2 boxes of screws are missing');
    seed('Se instalaron las 4 luces empotradas. Queda pendiente el color del stain.', 'The 4 recessed lights were installed. The stain color is still pending.');
    seed('Soleado, 72°', 'Sunny, 72°'); seed('Nublado, 65°', 'Cloudy, 65°');
    seed('El inspector confirmó por teléfono la cita del viernes.', 'The inspector confirmed Friday\'s appointment by phone.');
    seed('Avance de la cocina', 'Kitchen progress');
    const tk = db.prepare("SELECT id, title FROM tasks WHERE job_id=? AND status<>'hecho' ORDER BY position LIMIT 2").all(a);
    const ev = db.prepare("INSERT INTO job_events(job_id,at,user_id,kind,data) VALUES(?,datetime('now',?),?,?,?)");
    if (tk[0]) ev.run(a, '-6 hours', luis, 'task_start', JSON.stringify({ task: tk[0].id, title: tk[0].title }));
    if (tk[1]) ev.run(a, '-4 hours', mario, 'task_moved', JSON.stringify({ task: tk[1].id, title: tk[1].title, from: day(1), to: day(2) }));
    const done = db.prepare("SELECT id, title FROM tasks WHERE job_id=? AND status='hecho' ORDER BY position DESC LIMIT 2").all(a);
    if (done[0]) { db.prepare('UPDATE tasks SET done_date=? WHERE id=?').run(day(-1), done[0].id); ev.run(a, '-1 day', pedro, 'task_done', JSON.stringify({ task: done[0].id, title: done[0].title })); }
    if (done[1]) db.prepare('UPDATE tasks SET done_date=? WHERE id=?').run(day(-2), done[1].id);
    db.prepare("UPDATE daily_logs SET created_at=datetime('now','-1 day') WHERE job_id=? AND date=?").run(a, day(-1));
    db.prepare("UPDATE daily_logs SET created_at=datetime('now','-2 day') WHERE job_id=? AND date=?").run(a, day(-2));
    H.freeze(db, a, day(-2), null);
    H.freeze(db, a, day(-1), mario);
    db.prepare("INSERT INTO job_day_notes(job_id,date,user_id,at,text,text_en,text_es) VALUES(?,?,?,datetime('now','-20 hours'),?,?,?)")
      .run(a, day(-1), mario, 'El inspector confirmó por teléfono la cita del viernes.', 'The inspector confirmed Friday\'s appointment by phone.', 'El inspector confirmó por teléfono la cita del viernes.');
    db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('hist_closed_upto',?)").run(day(-1));
  }
  // v2.27: papeles de la compañía y garantías de fábrica.
  {
    const fsx = require('node:fs'), pathx = require('node:path');
    const { PDF } = require('./lib/pdf');
    const cdir = pathx.join(db.dataDir, 'company-docs'); fsx.mkdirSync(cdir, { recursive: true });
    const samplePdf = (title) => { const p = new PDF(); p.text(56, 60, title, { size: 16, bold: true }); p.text(56, 90, 'Sample document (demo)', { size: 11 }); return p.toBuffer(); };
    const cd = db.prepare('INSERT INTO company_docs(kind,title,number,city,issued,expires,notes,file,mime,size,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    const put = (kind, title, number, city, issued, expires, notes, withFile) => {
      let f = '', m = '', z = 0;
      if (withFile) { const b = samplePdf(title); f = require('node:crypto').randomBytes(12).toString('hex') + '.pdf'; fsx.writeFileSync(pathx.join(cdir, f), b); m = 'application/pdf'; z = b.length; }
      cd.run(kind, title, number, city, issued, expires, notes, f, m, z, owner);
    };
    put('registro', 'Registro de contratista — Flower Mound', 'FM-2026-0412', 'Flower Mound', day(-345), day(20), '', true);
    put('registro', 'Registro de contratista — Plano', 'PL-88213', 'Plano', day(-200), day(165), '', true);
    put('seguro', 'General liability insurance', 'GL-55120933', '', day(-180), day(185), 'Agente: (demo)', true);
    put('w9', 'W-9 de la compañía', '', '', day(-30), '', '', true);
    put('registro', 'Registro de contratista — Highland Village', 'HV-1188', 'Highland Village', day(-380), day(-15), 'Renovar en la ciudad', false);
    const fin = db.prepare("SELECT id, completed_date FROM jobs WHERE status='terminado' AND completed_date<>'' ORDER BY id LIMIT 1").get();
    if (fin) {
      const add = (item, brand, model, serial, years) => { const d = new Date(fin.completed_date + 'T12:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + years);
        db.prepare('INSERT INTO job_warranties(job_id,item,brand,model,serial,starts,expires,created_by) VALUES(?,?,?,?,?,?,?,?)').run(fin.id, item, brand, model, serial, fin.completed_date, d.toISOString().slice(0, 10), owner); };
      add('Calentador eléctrico', 'Infratech', 'C-Series 4000W', 'INF-33821', 5);
      add('Ventilador de techo', 'Minka-Aire', 'Light Wave 52"', 'MA-77120', 1);
    }
    db.prepare('INSERT INTO job_warranties(job_id,item,brand,model,serial,starts,expires,created_by) VALUES(?,?,?,?,?,?,?,?)').run(a, 'Ventiladores de techo (2)', 'Hunter', 'Dempsey 52"', '', day(-2), day(363), owner);
  }
  // v2.29: una conexión de ejemplo (webhook) para el agente.
  db.prepare("INSERT INTO webhooks(name,url,secret,events,last_at,last_code,created_by) VALUES(?,?,?,?,datetime('now','-2 hours'),200,?)")
    .run('Grok (demo)', 'https://example.com/grok-demo', require('node:crypto').randomBytes(24).toString('hex'), 'expense.created,inspection.result,case.opened,digest', owner);
  // v2.30: inventario de herramienta y equipo.
  {
    const ins = db.prepare("INSERT INTO tools_inventory(name,category,brand,model,serial,purchase_date,cost_cents,vendor,warranty_until,state,notes,location,job_id,created_by,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now',?))");
    const T = (name, cat, brand, model, serial, bought, cost, vendor, warr, state, loc, job, seen, notes = '') => ins.run(name, cat, brand, model, serial, bought, cost, vendor, warr, state, notes, loc, job, owner, seen);
    T('Sierra circular 7-1/4"', 'electrica', 'DeWalt', 'DCS570', 'DW570-88123', day(-300), 19900, 'Home Depot', day(65), 'bien', 'obra', a, '-1 day');
    T('Taladro de impacto', 'electrica', 'Milwaukee', 'M18 FUEL', 'MW-2853-20', day(-200), 17900, "Lowe's", day(165), 'bien', 'obra', a, '-1 day');
    T('Pistola de clavos para framing', 'electrica', 'Paslode', 'CF325XP', 'PS-55821', day(-340), 44900, 'Home Depot', day(25), 'reparar', 'reparacion', null, '-3 days', 'Se traba el gatillo; en el taller');
    T('Escalera de extensión 24 ft', 'escalera', 'Werner', 'D6224-2', '', day(-500), 32900, 'Home Depot', '', 'bien', 'obra', b, '-2 days');
    T('Escalera de tijera 8 ft', 'escalera', 'Little Giant', 'M8', '', day(-420), 15900, "Lowe's", '', 'bien', 'bodega', null, '-6 days');
    T('Láser de nivel', 'medicion', 'Bosch', 'GLL3-330CG', 'BO-7731', day(-150), 38900, 'Amazon', day(215), 'bien', 'bodega', null, '-6 days');
    T('Generador 7500 W', 'equipo', 'Champion', '100538', 'CH-100538-2231', day(-610), 89900, 'Home Depot', day(-10), 'bien', 'bodega', null, '-20 days');
    T('Mezcladora de concreto', 'equipo', 'Kobalt', '4 cu ft', '', day(-700), 32900, "Lowe's", '', 'bien', 'obra', b, '-2 days');
    T('Trailer 6x12', 'vehiculo', 'Big Tex', '35SA', 'VIN-4K1BT1219', day(-900), 410000, 'Big Tex Trailers', '', 'bien', 'bodega', null, '-1 day');
    T('Arnés de seguridad (2)', 'seguridad', '3M', 'DBI-SALA', '', day(-120), 21800, 'Grainger', '', 'perdida', 'obra', b, '-25 days', 'Falta uno desde la semana pasada');
    db.prepare("INSERT INTO company_expenses(date,category,description,vendor,ticket,pay_method,amount_cents,created_by) VALUES(?,?,?,?,?,?,?,?)").run(day(-2), 'herramienta', 'Rotomartillo SDS Plus', 'Home Depot', '5521', 'tarjeta', 22900, owner);
  }
  // v2.31: gastos que registraron los subs, esperando que un dueño los revise.
  {
    const X = db.prepare("INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,created_by,reimburse,review) VALUES(?,?,?,?,?,?,?,?,?,1)");
    X.run(b, day(-1), 'material', 'Tornillos y anclas', 'Home Depot', 'Pedro (demo)', 4870, pedro, 1);
    X.run(b, day(0), 'material', 'Silicón y cinta', "Lowe's", 'Luis (demo)', 2315, luis, 0);
  }
  // Subs de la fila (con usuario) y lo que ya contestaron en Kilmichael.
  for (const id of [qk, qc]) for (const [n, u, tr] of [['Pedro (demo)', pedro, 'carpinteria,techo,pintura'], ['Luis (demo)', luis, 'electricidad,av']])
    db.prepare('INSERT INTO subs(job_id,name,trade,agreed_cents,user_id,trades) VALUES(?,?,?,?,?,?)').run(id, n, '', 0, u, tr);
  db.prepare("UPDATE jobs SET queue_state='propuesto', queue_start=? WHERE id=?").run(day(14), qk);
  db.prepare("INSERT INTO job_queue_subs(job_id,user_id,is_key,key_set,needed_date,answer,asked_at,answered_at,answered_by) VALUES(?,?,1,1,?,'si',datetime('now','-1 day'),datetime('now'),?)").run(qk, pedro, day(16), pedro);
  db.prepare("INSERT INTO job_queue_subs(job_id,user_id,is_key,key_set,needed_date,asked_at) VALUES(?,?,1,1,?,datetime('now','-1 day'))").run(qk, luis, day(19));
  // v2.19: inspecciones que la compañía agregó porque su ciudad las pide.
  const it = db.prepare('INSERT INTO inspection_types(group_key,name_es,name_en,after_trade,created_by) VALUES(?,?,?,?,?)');
  it.run('rough', 'Tie-down de huracán (amarres del techo)', 'Hurricane tie-down', 'techo', owner);
  it.run('otra', 'Árbol protegido (arborista de la ciudad)', 'Protected tree (city arborist)', '', vero);
  // v2.20: planos, estimado → invoice y scope para los subs; plan de pago a subs; un pago esperando al otro dueño.
  const jd = path.join(db.dataDir, 'job-docs'); fs.mkdirSync(jd, { recursive: true });
  const putDoc = (jobId, kind, title, src, extra = {}) => {
    const name = `demo-${jobId}-${kind}-${Math.random().toString(16).slice(2, 8)}.pdf`;
    fs.copyFileSync(path.join(assets, src), path.join(jd, name));
    return Number(db.prepare('INSERT INTO job_docs(job_id,kind,title,number,file,mime,size,amount_cents,status,share_subs,share_client,approved_at,from_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(jobId, kind, title, extra.number || '', name, 'application/pdf', fs.statSync(path.join(jd, name)).size, extra.amount || 0, extra.status || '', kind === 'plano' ? 1 : 0, extra.client ? 1 : 0, extra.approved || '', extra.from || null, owner).lastInsertRowid);
  };
  putDoc(b, 'plano', 'Planos aprobados por la ciudad (A-1)', 'plan-patio.pdf');
  const est = putDoc(b, 'estimado', 'Estimado 1043', 'estimado-1043.pdf', { number: '1043', amount: 3400000, status: 'aprobado', approved: now(day(-9)) });
  putDoc(b, 'invoice', 'Invoice INV-1043', 'estimado-1043.pdf', { number: 'INV-1043', amount: 3400000, status: 'aprobado', approved: now(day(-9)), from: est, client: true });
  putDoc(a, 'plano', 'Planos del patio cover', 'plan-patio.pdf');
  putDoc(johnson, 'estimado', 'Estimado 1051', 'estimado-1043.pdf', { number: '1051', amount: 750000, status: 'enviado' });
  db.prepare('UPDATE jobs SET scope_text=? WHERE id=?').run('Cocina exterior en L, 12 ft x 8 ft, con parrilla de 36", fregadero y refrigerador.\n• Base de block con piedra (stone veneer) gris.\n• Cubierta de granito Absolute Black.\n• Línea de gas de 3/4" a la parrilla — prueba de presión con la ciudad.\n• 2 contactos GFCI y luz bajo la cubierta.', b);
  db.prepare("UPDATE subs SET pay_plan='50_50' WHERE job_id=? AND user_id=?").run(b, pedro);
  db.prepare("UPDATE subs SET pay_plan='progreso', progress_pct=50 WHERE job_id=? AND user_id=?").run(a, luis);
  const ps2 = db.prepare('SELECT id FROM subs WHERE job_id=? AND user_id=?').get(a, luis);
  if (ps2) db.prepare(`INSERT INTO change_requests(user_id,method,path,route,body,entity,job_id,summary,amount_cents,reason) VALUES(?,'POST',?,'POST /api/subs/:id/payments',?,'pago a sub',?,?,?,?)`)
    .run(db.prepare("SELECT id FROM users WHERE username='jack'").get().id, `/api/subs/${ps2.id}/payments`, JSON.stringify({ amount_cents: 110000, date: day(0), method: 'Zelle', reference: '', note: '50% de avance' }), a, 'Pago a Luis (demo) $1,100.00 por Zelle — Sample Family (demo)', 110000, 'Pago a sub');
  // v2.21 (Fase 4): change orders con código y cobro. GAS-01 cobrado pero el trabajo no está hecho (como el granito pagado por adelantado);
  // PERMIT-02 esperando al cliente; GRAN-03 hecho y sin facturar (sale en "toca cobrar").
  const coIns = db.prepare('INSERT INTO change_orders(job_id,date,description,cost_cents,price_cents,status,code,category,approved_at,done_at,invoice_number,invoiced_at,due_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const g1 = Number(coIns.run(b, day(-6), 'Línea de gas de 3/4" para el calentador', 45000, 120000, 'aprobado', 'GAS-01', 'GAS', day(-5), '', 'INV-2026-0091', day(-5), day(2)).lastInsertRowid);
  db.prepare("INSERT INTO payments(job_id,date,amount_cents,method,note,co_id) VALUES(?,?,?,?,?,?)").run(b, day(-3), 120000, 'Zelle', 'Pago del GAS-01', g1);
  coIns.run(b, day(-2), 'Permiso aparte para la línea de gas', 20000, 35000, 'pendiente', 'PERMIT-02', 'PERMIT', '', '', '', '', '');
  coIns.run(b, day(-4), 'Granito extra en la barra (2 ft)', 60000, 95000, 'aprobado', 'GRAN-03', 'GRAN', day(-4), day(-1), '', '', '');
  db.prepare("INSERT INTO client_updates(job_id,kind,data,note,created_at) VALUES(?,'status',?,'',?)").run(a, JSON.stringify({ status: 'inspeccion', name: 'Inspección de framing', next: ['Techo de tejas'], next_date: day(1) }), now(day(0)));
  const jackId = db.prepare("SELECT id FROM users WHERE username='jack'").get().id;
  // Una obra terminada con materiales y fotos en la galería.
  const done = job({ name: 'Terminado Martínez (demo)', phone: '(000) 000-0005', address: '500 Ejemplo Rd, Bartonville, TX', desc: 'Patio cover con cocina exterior y fogón.',
    status: 'terminado', quoted: 5200000, start: day(-70), end: day(-12), source: 'Referido' }, 'outdoor_living', 99);
  db.prepare("UPDATE jobs SET completed_date=?, pm_id=?, won_date=?, sales_id=? WHERE id=?").run(day(-14), mario, day(-80), vero, done);
  db.prepare("UPDATE tasks SET status='hecho', done_date=? WHERE job_id=?").run(day(-14), done);
  const photo = (jobId, file, caption, when, gallery) => {
    const id = require('node:crypto').randomBytes(16).toString('hex');
    fs.copyFileSync(path.join(assets, file), path.join(dir, 'files', id + '.jpg'));
    db.prepare("INSERT INTO files(id,job_id,kind,mime,caption,created_by,created_at,gallery) VALUES(?,?,'photo','image/jpeg',?,?,?,?)").run(id, jobId, caption, owner, now(when), gallery ? 1 : 0);
    return id;
  };
  photo(done, 'g-patio-1.jpg', 'Patio terminado', day(-15), 1);
  photo(done, 'g-patio-2.jpg', 'Cocina exterior', day(-14), 1);
  photo(done, 'g-patio-3.jpg', 'Fogón al atardecer', day(-14), 1);
  photo(b, 'g-kitchen-1.jpg', 'Avance de la cocina', day(-1), 0);
  db.prepare("INSERT INTO followups(job_id,kind) VALUES(?,'gallery_auto')").run(done);
  // v2.22 (Fase 5): la inspección de framing y rough de Sample Family no pasó (cable UF), con reinspección y tarea para corregir;
  // la lista de rough-in a medias (frena "Cielo de cedro" y "Forrar"); y una prueba de gas de ayer sin resultado.
  {
    const it = db.prepare("SELECT * FROM tasks WHERE job_id=? AND title LIKE 'Inspección de framing%'").get(a);
    if (it) {
      const old = Number(db.prepare("INSERT INTO permits(job_id,kind,name,status,date,result_at,fail_reason,inspector,attempt,insp_type) VALUES(?,'inspeccion',?,'rechazado',?,?,?,?,1,'framing')")
        .run(a, it.title, day(-3), day(-3), 'Código nuevo: exige cable UF en lo enterrado', 'Mr. Smith').lastInsertRowid);
      db.prepare("INSERT INTO permits(job_id,kind,name,status,date,notes,task_id,insp_type,reinspect_of,attempt) VALUES(?,'inspeccion',?,'programada',?,?,?,'framing',?,2)")
        .run(a, 'Reinspección: ' + it.title, day(1), '', it.id, old);
      db.prepare("UPDATE tasks SET status='pendiente', done_date='', planned_date=?, planned_end=?, notes=? WHERE id=?").run(day(1), day(1), `No pasó el ${day(-3)}: Código nuevo: exige cable UF en lo enterrado`, it.id);
      db.prepare('UPDATE tasks SET position=position+1 WHERE job_id=? AND position>=?').run(a, it.position);
      db.prepare("INSERT INTO tasks(job_id,title,position,status,planned_date,planned_end,trade,assignee_id,notes) VALUES(?,?,?,'en_progreso',?,?,'electricidad',?,?)")
        .run(a, 'Corregir para reinspección: Código nuevo: exige cable UF en lo enterrado', it.position, day(-1), day(0), luis, 'Cambiar a cable UF del switch al abanico');
      db.prepare("UPDATE tasks SET status='pendiente', done_date='' WHERE job_id=? AND position>?").run(a, it.position);
    }
    const ph = photo(a, 'g-patio-2.jpg', 'Rough-in: Outlets (plugs) and switches in place', day(-4), 0);
    db.prepare("UPDATE files SET trade='electricidad' WHERE id=?").run(ph);
    const ri = db.prepare("INSERT INTO roughin_items(job_id,key,label,trade,status,photo_id,note,confirmed_by,confirmed_at,position) VALUES(?,?,?,?,?,?,?,?,?,?)");
    ri.run(a, 'plugs', '', 'electricidad', 'ok', ph, 'Dos contactos GFCI en los postes', luis, now(day(-4)), 10);
    ri.run(a, 'luces', '', 'electricidad', 'pendiente', null, '', null, '', 20);
    ri.run(a, 'custom', 'Cable de bocinas al poste de la esquina', 'av', 'pendiente', null, '', null, '', 30);
    db.prepare("INSERT INTO permits(job_id,kind,name,status,date,insp_type) VALUES(?,'inspeccion','Prueba de presión de gas','programada',?,'rough_gas')").run(b, day(-1));
  }
  fs.mkdirSync(path.join(dir, 'materials'), { recursive: true });
  const mat = (zone, kind, brand, name, color, hex, finish, img, notes = '') => {
    const id = Number(db.prepare('INSERT INTO materials(zone,kind,brand,name,color_name,color_hex,finish,notes,has_image) VALUES(?,?,?,?,?,?,?,?,?)').run(zone, kind, brand, name, color, hex, finish, notes, img ? 1 : 0).lastInsertRowid);
    if (img) { fs.copyFileSync(path.join(assets, img), path.join(dir, 'materials', id + '.jpg')); fs.writeFileSync(path.join(dir, 'materials', id + '.jpg.type'), 'image/jpeg'); }
    return id;
  };
  const mCedar = mat('pintura', 'Stain semitransparente', 'Sherwin-Williams', 'Stain para madera', 'Cedar', '#b0703f', 'Semitransparente', 'm-cedar.jpg', 'SuperDeck · 2 manos');
  const mWal = mat('pintura', 'Stain sólido', 'Sherwin-Williams', 'Stain para madera', 'Dark Walnut', '#5c3e2c', 'Sólido', 'm-walnut.jpg');
  const mPine = mat('ceiling', 'Tongue & groove', '', 'Pino tongue & groove 1x6', 'Natural', '#c4a076', 'Barnizado', 'm-pine-tg.jpg');
  const mWhite = mat('fascia', 'Fascia y trim', 'James Hardie', 'Hardie Trim', 'Arctic White', '#f2f0ea', 'Liso', 'm-arctic-white.jpg');
  const mGray = mat('estructura', 'Postes envueltos', 'James Hardie', 'Hardie Trim (postes)', 'Iron Gray', '#363a3e', 'Liso', 'm-iron-gray.jpg');
  const mBlack = mat('cocina_cubierta', 'Granito', '', 'Granito', 'Absolute Black', '#161618', 'Leather', 'm-absolute-black.jpg', '3 cm');
  const mWG = mat('cocina_cubierta', 'Granito', '', 'Granito', 'White Ice', '#e4e0d8', 'Pulido', 'm-white-granite.jpg');
  const mStone = mat('cocina_base', 'Piedra', 'Coronado', 'Piedra cultivada', 'Fieldstone', '#968775', 'Natural', 'm-stone-veneer.jpg');
  mat('cocina_equipo', 'Parrilla', 'Blaze', 'Parrilla de gas 32"', 'Acero inoxidable', '#b8b8bc', '', null, 'Premium LTE');
  mat('techo', 'Teja asfáltica', 'GAF', 'Timberline HDZ', 'Charcoal', '#3b3b3d', '', null);
  const jm = (jobId, m, area) => db.prepare('INSERT INTO job_materials(job_id,material_id,area,position) VALUES(?,?,?,?)').run(jobId, m, area, 1);
  jm(done, mPine, 'Ceiling del patio'); jm(done, mCedar, 'Stain del ceiling y vigas'); jm(done, mWhite, 'Fascia'); jm(done, mBlack, 'Cubierta de la cocina'); jm(done, mStone, 'Base de la cocina y fogón');
  jm(a, mPine, 'Ceiling'); jm(a, mWhite, 'Fascia y trim'); jm(b, mWG, 'Cubierta'); jm(b, mStone, 'Base'); jm(b, mGray, 'Postes');
  // v2.35: selecciones del cliente en Sample Family: una aprobada en el portal, una escogida sin aprobar (atrasada), opciones del stain y luces sin escoger.
  {
    const tk = re => (db.prepare('SELECT id FROM tasks WHERE job_id=? ORDER BY position').all(a).find(t => re.test(db.prepare('SELECT title FROM tasks WHERE id=?').get(t.id).title)) || {}).id || null;
    const S = db.prepare("INSERT INTO job_selections(job_id,zone,label,label_en,task_id,lead_days,need_by_manual,status,choice_option_id,choice_text,approved_at,approved_by,approved_name,approved_how,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const O = db.prepare('INSERT INTO selection_options(selection_id,material_id,title,note,position) VALUES(?,?,?,?,?)');
    const s1 = Number(S.run(a, 'ceiling', 'Ceiling', 'Ceiling', tk(/cielo|ceiling/i), 7, day(-6), 'aprobado', null, '', now(day(-8)), cli, 'Mrs. Sample', 'portal', mario).lastInsertRowid);
    const o1 = Number(O.run(s1, mPine, '', '', 1).lastInsertRowid); db.prepare('UPDATE job_selections SET choice_option_id=? WHERE id=?').run(o1, s1);
    S.run(a, 'techo', 'Color de la teja', 'Shingle color', tk(/teja|shingle/i), 7, day(-1), 'escogido', null, 'GAF Timberline HDZ — Charcoal', '', null, '', '', mario);
    const s3 = Number(S.run(a, 'pintura', 'Stain del cedro', 'Cedar stain', tk(/stain|pintura|sellar/i), 5, day(2), 'pendiente', null, '', '', null, '', '', mario).lastInsertRowid);
    O.run(s3, mCedar, '', 'El más claro; deja ver la veta', 1); O.run(s3, mWal, '', 'Más oscuro, combina con la fascia', 2);
    S.run(a, 'iluminacion', 'Abanicos y luces', 'Fans and lights', tk(/el[eé]ctric/i), 10, day(9), 'pendiente', null, '', '', null, '', '', mario);
  }
  // El cliente calificó la obra terminada; nota diaria del PM.
  db.prepare('INSERT INTO job_ratings(job_id,user_id,stars,comment) VALUES(?,?,5,?)').run(done, cli, 'Quedó hermoso, muy limpios y puntuales.');
  db.prepare('INSERT INTO pm_notes(user_id,date,did,problems,next_steps) VALUES(?,?,?,?,?)').run(mario, day(-1), 'Revisé el avance de la cocina de Rodríguez, coordiné la entrega del granito y subí fotos.', 'El granito llega 2 días tarde.', 'Mañana entra el plomero; confirmar a Luis para la electricidad.');
  for (const [r, d] of [['PUT /api/tasks/:id', 'hecho'], ['POST /api/jobs/:id/photos', ''], ['POST /api/jobs/:id/logs', 'Se instaló la base de block'], ['POST /api/tasks/:id/notify', '']])
    db.prepare("INSERT INTO activity_log(user_id,route,job_id,detail,at) VALUES(?,?,?,?,?)").run(mario, r, b, d, day(-1) + ' 18:00:00');
  db.prepare('INSERT INTO plan_templates(name,project_type,tasks) VALUES(?,?,?)').run('Fogón estándar', 'fire_pit', JSON.stringify([
    { title: 'Permiso y marcar área', days: 1 }, { title: 'Excavar y base de grava', days: 1 }, { title: 'Línea de gas', days: 1, trade: 'Plomería' }, { title: 'Inspección de gas', days: 1, inspection: true },
    { title: 'Muro de block y piedra', days: 3, materials: 'Piedra cultivada' }, { title: 'Quemador y prueba', days: 1 }, { title: 'Limpieza y entrega', days: 1 }]));
  // Ventas: clientes de Vero y de Jack, citas y estimados enviados.
  const lead = (f) => Number(db.prepare(`INSERT INTO jobs(client_name,client_phone,client_email,address,project_type,description,status,quoted_cents,lead_source,sales_id,estimate_sent_date,follow_up_date,lead_new,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(f.name, f.phone || '', f.email || '', f.address || '', f.type, f.desc || '', f.status, f.quoted || 0, f.source || '', f.sales ?? null, f.sent || '', f.follow || '', f.isNew ? 1 : 0, now(f.created || day(-5))).lastInsertRowid);
  const ev = (jobId, user, kind, note, at, extra = {}) => db.prepare('INSERT INTO sales_events(job_id,user_id,kind,note,amount_cents,next_date,at) VALUES(?,?,?,?,?,?,?)').run(jobId, user, kind, note, extra.amount ?? null, extra.next || '', now(at));
  const appt = (user, jobId, title, when, hour, address, phone, kind = 'cita', status = 'pendiente') => db.prepare('INSERT INTO appointments(user_id,job_id,kind,title,starts_at,minutes,address,phone,status) VALUES(?,?,?,?,?,?,?,?,?)').run(user, jobId, kind, title, when + ' ' + hour, 60, address, phone, status);
  const l1 = lead({ name: 'García (demo)', phone: '(000) 000-0101', address: '12 Oak St, Highland Village, TX', type: 'outdoor_kitchen', desc: 'Cocina exterior con parrilla y refrigerador', status: 'cotizado', quoted: 3850000, source: 'Referido', sales: vero, sent: day(-6), follow: day(0), created: day(-12) });
  ev(l1, vero, 'visita', 'Medí el área: 14x10', day(-9)); ev(l1, vero, 'enviado', '', day(-6), { amount: 3850000, next: day(-3) }); ev(l1, vero, 'llamada', 'Lo está pensando, quiere ver colores de granito', day(-3), { next: day(0) });
  const l2 = lead({ name: 'Nguyen (demo)', phone: '(000) 000-0102', address: '45 Cedar Ln, Flower Mound, TX', type: 'patio_cover', desc: 'Patio cover 24x16 con ventiladores', status: 'cotizado', quoted: 2990000, source: 'Google', sales: vero, sent: day(-10), follow: day(-2), created: day(-15) });
  ev(l2, vero, 'enviado', '', day(-10), { amount: 2990000, next: day(-2) });
  const l3 = lead({ name: 'Brown (demo)', phone: '(000) 000-0103', address: '9 Elm Ct, Lantana, TX', type: 'fireplace', desc: 'Chimenea de piedra', status: 'prospecto', source: 'Facebook', sales: vero, created: day(-2) });
  appt(vero, l3, 'Visita · Brown (demo)', day(0), '16:30', '9 Elm Ct, Lantana, TX', '(000) 000-0103', 'visita');
  appt(vero, l1, 'Llevar muestras de granito · García', day(0), '11:00', '12 Oak St, Highland Village, TX', '(000) 000-0101');
  appt(vero, null, 'Junta con Jack', day(1), '09:00', 'Oficina', '', 'otro');
  lead({ name: 'Web: Patel (demo)', phone: '(000) 000-0104', email: 'patel@example.com', type: 'patio_cover', desc: 'Llegó por la página: quiere patio cover y luces', status: 'prospecto', source: 'Web', isNew: true, created: day(0) });
  const l5 = lead({ name: 'Wilson (demo)', phone: '(000) 000-0105', address: '70 Pine Rd, Argyle, TX', type: 'outdoor_living', status: 'cotizado', quoted: 6400000, source: 'Referido', sales: jackId, sent: day(-4), follow: day(1), created: day(-9) });
  ev(l5, jackId, 'enviado', 'Versión con fogón y TV', day(-4), { amount: 6400000, next: day(1) });
  appt(jackId, l5, 'Revisar estimado con Wilson', day(1), '18:00', '70 Pine Rd, Argyle, TX', '(000) 000-0105');
  const l6 = lead({ name: 'Davis (demo)', type: 'fire_pit', status: 'cancelado', quoted: 680000, source: 'Google', sales: vero, sent: day(-30), created: day(-40) });
  db.prepare("UPDATE jobs SET lost_reason='precio' WHERE id=?").run(l6); ev(l6, vero, 'perdido', 'precio · Encontró uno más barato', day(-20));
  ev(done, vero, 'ganado', 'Firmó con 30% de anticipo', day(-80));
  // v2.1: un pedido de recuperar acceso esperando a los dueños.
  db.prepare('INSERT INTO access_requests(ident,user_id) VALUES(?,?)').run('Luis', luis);
  // v2.2: partidas (lo que se vendió) con su costo y margen.
  const line = (jobId, code, trade, crew, sold, pos, pass = 0) => Number(db.prepare('INSERT INTO job_lines(job_id,code,trade,crew,sold_cents,position,pass_through) VALUES(?,?,?,?,?,?,?)').run(jobId, code, trade, crew, sold, pos, pass).lastInsertRowid);
  const pcA = line(a, 'PC-01', 'PATIO COVER', 'CARPENTRY CREW', 2100000, 1), roA = line(a, 'ROOF-01', 'ROOFING', 'ROOF CREW', 450000, 2), elA = line(a, 'ELECT-01', 'ELECTRICAL', 'ELECTRICIAN', 300000, 3);
  db.prepare("UPDATE expenses SET line_id=? WHERE job_id=? AND category IN ('material','renta_equipo','basura')").run(pcA, a);
  db.prepare('UPDATE subs SET line_id=? WHERE id=?').run(roA, roof);
  db.prepare('UPDATE subs SET line_id=? WHERE job_id=? AND name=?').run(elA, a, 'Luis (demo)');
  db.prepare('UPDATE expenses SET line_id=(SELECT line_id FROM subs WHERE subs.id=expenses.sub_id) WHERE job_id=? AND sub_id IS NOT NULL').run(a);
  const okB = line(b, 'OK-01', 'OUTDOOR KITCHEN', 'MASONRY CREW', 2200000, 1), ctB = line(b, 'CT-01', 'COUNTER TOP', 'MASONRY CREW', 900000, 2), spB = line(b, 'SP-01', 'SPRINKLERS', 'SPRINKLER CREW', 150000, 3, 1);
  db.prepare('UPDATE subs SET line_id=? WHERE job_id=?').run(okB, b);
  db.prepare("INSERT INTO expenses(job_id,date,category,description,vendor,amount_cents,created_by,line_id) VALUES(?,?,'material','Granito Absolute Black 3 cm','Arlington Marble',?,?,?)").run(b, day(-2), 860000, owner, ctB);
  db.prepare("INSERT INTO expenses(job_id,date,category,description,vendor,amount_cents,created_by,line_id) VALUES(?,?,'subcontratistas','Reparar sprinklers','Hardy Leaf (demo)',?,?,?)").run(b, day(-3), 390000, owner, spB);
  for (const [j, l] of [[done, line(done, 'PC-01', 'PATIO COVER', 'CARPENTRY CREW', 2600000, 1)], [done, line(done, 'OK-01', 'OUTDOOR KITCHEN', 'MASONRY CREW', 1800000, 2)]]) db.prepare('UPDATE expenses SET line_id=? WHERE job_id=? AND line_id IS NULL AND id IN (SELECT id FROM expenses WHERE job_id=? AND line_id IS NULL LIMIT 3)').run(l, j, j);
  line(done, 'FP-01', 'FIRE PLACE', 'MASONRY CREW', 800000, 3);
  db.prepare("INSERT INTO job_lessons(job_id,line_code,issue,cause,cost_cents,lesson,avoid_repeat) VALUES(?,?,?,?,?,?,?)").run(done, 'OK-01', 'La cubierta se midió antes de terminar la piedra', 'Prisa por el template', 65000, 'Hacer el template hasta que la piedra esté terminada', 'EVITAR');
  db.prepare("UPDATE jobs SET review_profitable='YES', review_stress='2', review_worked='Cuadrilla de masonería y comunicación diaria con el cliente', review_didnt='Template de la cubierta' WHERE id=?").run(done);
  db.prepare('INSERT INTO job_links(job_id,label,url,note) VALUES(?,?,?,?)').run(a, 'Planos', 'https://drive.google.com/', 'Planos del permiso (ejemplo)');
  // Textos de ejemplo (como si ya estuvieran conectados con Twilio).
  const ph = id => { const d = String((db.prepare('SELECT phone FROM users WHERE id=?').get(id) || {}).phone || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : '+' + d; };
  const tx = (phone, dir, body, uid, job, ago, by = null, read = true) => db.prepare("INSERT INTO sms(phone,direction,body,user_id,job_id,status,created_by,read_at,created_at) VALUES(?,?,?,?,?,?,?,?,datetime('now',?))")
    .run(phone, dir, body, uid, job, dir === 'out' ? 'delivered' : 'recibido', by, read ? "x" : '', `-${ago} minutes`);
  const pp = ph(pedro);
  tx(pp, 'out', 'Elevated Exteriors: Pedro, mañana a las 8 empezamos los postes en Sample Family. ¿Puede llegar con su cuadrilla?\nResponda STOP para no recibir más textos.', pedro, a, 190, owner);
  tx(pp, 'in', 'Sí, ahí estaremos a las 8 con 3 personas', pedro, a, 172);
  tx(pp, 'out', 'Elevated Exteriors: Perfecto, gracias. El concreto llega a las 9.', pedro, a, 165, owner);
  tx(pp, 'in', 'Ok. Necesito que alguien abra la puerta del patio', pedro, a, 12, null, false);
  tx('+10000000002', 'out', 'Elevated Exteriors: Hola, mañana instalamos la cubierta de granito. Llegamos entre 8 y 9.\nResponda STOP para no recibir más textos.', null, b, 300, owner);
  tx('+10000000002', 'in', 'Gracias! Dejo la reja abierta', null, b, 290);
  // v2.32: opiniones de clientes (encuesta al terminar la obra).
  {
    db.prepare("INSERT INTO meta(key,value) VALUES('survey_since','2026-01-01') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    const J = db.prepare("INSERT INTO jobs(client_name,address,project_type,status,completed_date,client_phone,pm_id) VALUES(?,?,?,'terminado',?,?,?)");
    const smith = Number(J.run('Terminado Smith (demo)', '88 Oak Ridge Dr, Flower Mound, TX', 'patio_cover', day(-20), '+19725550188', null).lastInsertRowid);
    const ortiz = Number(J.run('Ortiz (demo)', '12 Cedar Ln, Argyle, TX', 'fireplace', day(-2), '+19725550112', null).lastInsertRowid);
    const tk = () => require('node:crypto').randomBytes(18).toString('base64url');
    const A = db.prepare(`INSERT INTO job_surveys(job_id,token,lang,created_at,answered_at,q_clean,q_time,q_comm,q_quality,q_crew,nps,improve,liked,low) VALUES(?,?,?,datetime('now',?),datetime('now',?),?,?,?,?,?,?,?,?,?)`);
    const ids = db.prepare("SELECT id, client_name FROM jobs WHERE client_name IN ('Terminado Martínez (demo)','Terminado García (demo)')").all();
    const mart = (ids.find(x => /Mart/.test(x.client_name)) || {}).id, gar = (ids.find(x => /Garc/.test(x.client_name)) || {}).id;
    if (mart) A.run(mart, tk(), 'es', '-13 days', '-12 days', 2, 3, 3, 5, 4, 6, 'Dejaron restos de madera y tornillos en el jardín. Tuve que llamar dos veces para saber cuándo venían.', 'El acabado de la chimenea quedó precioso.', 1);
    if (gar) A.run(gar, tk(), 'es', '-180 days', '-178 days', 5, 5, 4, 5, 5, 10, '', 'Muy limpios y puntuales. Pedro fue muy amable.', 0);
    A.run(smith, tk(), 'en', '-19 days', '-18 days', 5, 4, 5, 5, 5, 9, 'A text the day before would help us plan.', 'Great crew, the patio cover looks amazing.', 0);
    db.prepare("INSERT INTO job_surveys(job_id,token,lang,created_at) VALUES(?,?,'en',datetime('now','-1 days'))").run(ortiz, tk());
    const R = db.prepare("INSERT INTO job_ratings(job_id,stars,comment) VALUES(?,?,'') ON CONFLICT(job_id) DO UPDATE SET stars=excluded.stars");
    if (mart) R.run(mart, 3); if (gar) R.run(gar, 5); R.run(smith, 5);
  }
});
db.close();
// Segunda empresa (JKL Homes): su propia información, con los mismos dueños.
{
  const jdb = open(path.join(dir, 'empresas', 'jkl'));
  require('./lib/company').stamp(jdb, { key: 'jkl', name: 'JKL Homes', city: 'Double Oak, TX', logo: '' }, false);
  const ins = jdb.prepare("INSERT INTO users(name,username,pass_hash,role,phone,lang,active,tools) VALUES(?,?,?,?,?,?,1,?)");
  const o1 = Number(ins.run('Dueño Demo', 'dueno', pw, 'owner', '(555) 010-0001', 'es', '').lastInsertRowid);
  ins.run('Jack (demo)', 'jack', pw, 'owner', '(555) 010-0002', 'es', 'ventas');
  const tile = Number(ins.run('Tile Pro (demo)', 'tilepro', pw, 'worker', '(555) 010-0009', 'es', '').lastInsertRowid);
  const d0 = n => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const bj = Number(jdb.prepare("INSERT INTO jobs(client_name,client_phone,address,project_type,description,status,quoted_cents,start_date,end_date,lead_source) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run('García baño (demo)', '(000) 000-0201', '5600 Demo Dr, Flower Mound, TX', 'bano', 'Remodelación del baño principal: regadera, gabinetes, cubierta y piso.', 'activo', 3028000, d0(-5), d0(25), 'Referido').lastInsertRowid);
  const C = require('./lib/catalog').PROJECT_TYPES.find(x => x.key === 'bano').tasks;
  C.forEach(([es], i) => jdb.prepare('INSERT INTO tasks(job_id,position,title,status,planned_date,assignee_id) VALUES(?,?,?,?,?,?)').run(bj, i + 1, es, i < 2 ? 'hecho' : 'pendiente', d0(-5 + i * 2), /Azulejo/.test(es) ? tile : null));
  const L = (code, trade, sold) => Number(jdb.prepare('INSERT INTO job_lines(job_id,code,trade,sold_cents) VALUES(?,?,?,?)').run(bj, code, trade, sold).lastInsertRowid);
  const sh = L('SHOWER-01', 'MASTER SHOWER', 760000); L('CABINET-01', 'CABINETRY', 400000); L('TILE-02', 'FLOOR TILE LABOR', 78000);
  jdb.prepare('INSERT INTO subs(job_id,name,trade,agreed_cents,user_id,line_id) VALUES(?,?,?,?,?,?)').run(bj, 'Tile Pro (demo)', 'MASTER SHOWER', 380000, tile, sh);
  jdb.prepare("INSERT INTO expenses(job_id,date,category,description,vendor,amount_cents,created_by,line_id) VALUES(?,?,'material','Azulejo y pegamento','Floor & Decor',?,?,?)").run(bj, d0(-2), 145000, o1, sh);
  jdb.prepare("INSERT INTO plan_templates(name,project_type,tasks,is_default,updated_at) VALUES(?,?,?,1,datetime('now'))").run('JKL interior remodel', 'remodelacion', JSON.stringify([
    'Protect areas + demolition', 'Framing', 'Rough plumbing + electrical', 'Rough inspection', 'Insulation', 'Drywall', 'Flooring', 'Paint', 'Trim + doors', 'Finish plumbing + electrical', 'Punch list + clean up']
    .map(title => ({ title, days: /Drywall|Flooring|Paint/.test(title) ? 3 : 1, trade: '', inspection: /inspection/i.test(title), notes: '' }))));
  jdb.close();
}
console.log('Listo: datos de práctica en', dir);
console.log('Usuarios (contraseña para todos: demo-demo-123): dueno, jack (dueño con Ventas), mario (project manager), vero (vendedora), rosa (oficina), contadora (solo ver), pedro, luis (encargado de cuadrilla), juan (por hora), cliente');
