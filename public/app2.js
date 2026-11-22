'use strict';
/* Elevated Exteriors · v2.0
   Pantallas nuevas: ventas (agenda, citas y seguimiento de estimados), tablero del día, reporte y calificación de PMs,
   plan de trabajo con AI, catálogo y galería de materiales. Usa las utilidades de app.js ($, api, t, formDialog…). */

const HAS_TOOL = k => !!ME && (ME.tools || []).includes(k);
const SELLS = () => !!ME && (ME.role === 'sales' || HAS_TOOL('ventas'));
const addDaysL = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const hhmm = s => { const [h, m] = String(s || '').slice(11, 16).split(':').map(Number); if (Number.isNaN(h)) return ''; return LANG === 'en' ? `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : `${h}:${String(m).padStart(2, '0')}`; };
const dayLabel = d => new Date(d + 'T12:00:00').toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const mapLink = a => a ? `<a href="https://maps.google.com/?q=${encodeURIComponent(a)}" target="_blank" rel="noopener">📍 ${esc(a)}</a>` : '';
const telLink = p => p ? `<a href="tel:${esc(String(p).replace(/[^\d+]/g, ''))}">📞 ${esc(p)}</a>` : '';
const waLink = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '').replace(/^(?=\d{10}$)/, '1')}?text=${encodeURIComponent(text)}`;
function readAnyFile(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error(t('No se pudo leer el archivo'))); r.readAsDataURL(file); });
}

// =====================================================================
// VENTAS
// =====================================================================
const EVENT_LABEL = () => ({ llamada: t('Llamada'), mensaje: t('Mensaje'), visita: t('Visita'), nota: t('Nota'), enviado: t('Estimado enviado'), ganado: t('Ganado'), perdido: t('Perdido') });
const LOST_LABEL = () => ({ precio: t('Precio'), tiempo: t('Tiempo de entrega'), otra_compania: t('Se fue con otra compañía'), no_contesta: t('Ya no contesta'), pospuesto: t('Lo pospuso'), otro: t('Otro') });
const APPT_KIND = () => ({ cita: t('Cita con cliente'), visita: t('Visita / medir'), llamada: t('Llamada'), seguimiento: t('Seguimiento'), otro: t('Otro') });
const STAGES = () => [['nuevo', t('Nuevos')], ['cita', t('Con cita')], ['estimado', t('Estimado enviado')], ['ganado', t('Ganados')], ['perdido', t('Perdidos')]];
let SALES_WHO = '';

async function salesWhoSelect() {
  if (ME.role !== 'owner') return '';
  const team = await api('GET', '/api/sales/team').catch(() => []);
  return `<select id="who" aria-label="${t('Ver')}"><option value="">${t('Mis clientes y sin vendedor')}</option><option value="all" ${SALES_WHO === 'all' ? 'selected' : ''}>${t('Todo el equipo')}</option>
    ${team.filter(u => u.id !== ME.id).map(u => `<option value="${u.id}" ${String(SALES_WHO) === String(u.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>`;
}
function bindWho(app, again) { const w = $('#who', app); if (w) w.onchange = () => { SALES_WHO = w.value; again(); }; }
const whoQ = (sep = '?') => SALES_WHO ? `${sep}who=${encodeURIComponent(SALES_WHO)}` : '';

function salesTabs(on) {
  return `<nav class="tabs">${[['#/ventas', t('Mi día')], ['#/ventas/clientes', t('Clientes y estimados')], ['#/ventas/agenda', t('Agenda')]].map(([h, l]) => `<a href="${h}" class="${h === on ? 'on' : ''}">${esc(l)}</a>`).join('')}</nav>`;
}
const leadFieldsForm = (x = {}) => [
  { name: 'client_name', label: t('Nombre del cliente'), required: true, value: x.client_name },
  { name: 'client_phone', label: t('Teléfono'), type: 'tel', value: x.client_phone },
  { name: 'client_email', label: t('Correo'), type: 'email', value: x.client_email },
  { name: 'address', label: t('Dirección'), value: x.address, full: true },
  { name: 'project_type', label: t('Tipo de proyecto'), type: 'select', value: x.project_type || 'patio_cover', options: CAT.projectTypes.map(p => [p.key, L(p)]) },
  { name: 'lead_source', label: t('¿Cómo nos conoció?'), value: x.lead_source, hint: t('Ej. Referido, Google, Facebook, Nextdoor, letrero') },
  { name: 'description', label: t('Qué quiere'), type: 'textarea', value: x.description },
];
async function newLeadDialog(after) {
  const team = ME.role === 'owner' ? await api('GET', '/api/sales/team').catch(() => []) : [];
  const v = await formDialog({ title: t('Cliente nuevo'), submit: t('Guardar'), fields: [...leadFieldsForm(),
    { name: 'appt', label: t('Cita (opcional)'), type: 'datetime', hint: t('Si ya quedaron de verse, ponga el día y la hora') },
    { name: 'minutes', label: t('Duración'), type: 'select', value: '60', options: [['30', '30 min'], ['60', '1 h'], ['90', '1 h 30'], ['120', '2 h']] },
    ...(team.length > 1 ? [{ name: 'sales_id', label: t('Vendedor'), type: 'select', value: String(ME.id), options: [['', t('— sin vendedor —')], ...team.map(u => [u.id, u.name])] }] : []),
  ], onSubmit: async v => {
    const body = { ...v, appointment: v.appt ? { starts_at: v.appt, minutes: Number(v.minutes) } : undefined };
    if ('sales_id' in v) body.sales_id = v.sales_id ? Number(v.sales_id) : null;
    delete body.appt; delete body.minutes;
    await api('POST', '/api/sales/leads', body);
  } });
  if (v) { toast(t('Cliente guardado')); after(); }
}
async function apptDialog(a, after, lead) {
  const isNew = !a || !a.id;
  a = a || {};
  const team = ME.role === 'owner' && isNew ? await api('GET', '/api/sales/team').catch(() => []) : [];
  const v = await formDialog({ title: isNew ? t('Nueva cita') : t('Editar cita'), submit: t('Guardar'), fields: [
    { name: 'title', label: t('Título'), required: true, value: a.title || (lead ? t('Cita · {x}', { x: lead.client_name }) : '') , full: true },
    { name: 'kind', label: t('Tipo'), type: 'select', value: a.kind || 'cita', options: Object.entries(APPT_KIND()) },
    { name: 'starts_at', label: t('Día y hora'), type: 'datetime', required: true, value: (a.starts_at || '').replace(' ', 'T') },
    { name: 'minutes', label: t('Duración'), type: 'select', value: String(a.minutes || 60), options: [['15', '15 min'], ['30', '30 min'], ['60', '1 h'], ['90', '1 h 30'], ['120', '2 h'], ['180', '3 h']] },
    { name: 'address', label: t('Dirección'), value: a.address ?? (lead && lead.address) ?? '', full: true },
    { name: 'phone', label: t('Teléfono'), type: 'tel', value: a.phone ?? (lead && lead.client_phone) ?? '' },
    ...(team.length > 1 ? [{ name: 'user_id', label: t('En la agenda de'), type: 'select', value: String(ME.id), options: team.map(u => [u.id, u.name]) }] : []),
    { name: 'notes', label: t('Notas'), type: 'textarea', value: a.notes },
  ], extraButton: isNew ? null : { label: t('Borrar'), danger: true, onClick: () => api('DELETE', `/api/appointments/${a.id}`) },
  onSubmit: v => isNew ? api('POST', '/api/appointments', { ...v, job_id: lead ? lead.id : undefined, minutes: Number(v.minutes), user_id: v.user_id ? Number(v.user_id) : undefined })
    : api('PUT', `/api/appointments/${a.id}`, { ...v, minutes: Number(v.minutes) }) });
  if (v) { toast(t('Guardado')); after(); }
}
async function apptDone(a, after) {
  const v = await formDialog({ title: t('¿Cómo le fue? · {x}', { x: a.title }), submit: t('Marcar hecha'), fields: [
    { name: 'status', label: t('Resultado'), type: 'select', value: 'hecho', options: [['hecho', t('Sí se hizo')], ['no_llego', t('El cliente no llegó / no estaba')], ['cancelado', t('Se canceló')]] },
    { name: 'result', label: t('Qué pasó / qué sigue'), type: 'textarea' },
  ], onSubmit: v => api('PUT', `/api/appointments/${a.id}`, v) });
  if (v) { toast(t('Guardado')); after(); }
}
// Seguimiento de un cliente: llamada, estimado enviado, ganado, perdido…
async function leadEvent(lead, kind, after) {
  const L2 = EVENT_LABEL();
  const nextDef = addDaysL(today(), kind === 'enviado' ? 3 : 2);
  const fields = [];
  if (kind === 'enviado') fields.push({ name: 'amount_cents', label: t('Monto del estimado ($)'), type: 'money', required: true, value: centsToInput(lead.quoted_cents) });
  if (kind === 'perdido') fields.push({ name: 'reason', label: t('¿Por qué se perdió?'), type: 'select', required: true, value: 'precio', options: Object.entries(LOST_LABEL()) });
  if (!['ganado', 'perdido'].includes(kind)) fields.push({ name: 'next_date', label: t('Volver a llamar el'), type: 'date', value: nextDef, hint: t('La app se lo recuerda ese día') });
  fields.push({ name: 'note', label: kind === 'ganado' ? t('Notas para el equipo (anticipo, fecha que quiere empezar…)') : t('Notas'), type: 'textarea' });
  const intro = kind === 'ganado' ? t('El cliente pasa a <b>Obras activas</b> y se avisa a los dueños para poner contrato, fechas y plan de trabajo.') : '';
  const v = await formDialog({ title: `${L2[kind]} · ${lead.client_name}`, intro, submit: kind === 'ganado' ? t('¡Ganado!') : t('Guardar'), fields,
    onSubmit: v => api('POST', `/api/sales/leads/${lead.id}/event`, { kind, ...v }) });
  if (v) { toast(kind === 'ganado' ? '🎉 ' + t('¡Trabajo ganado!') : t('Guardado')); after(); }
}
function leadActions(c) {
  return `<div class="row wrap lead-acts" data-lead="${c.id}">
    <button class="sm" data-ev="llamada">📞 ${t('Llamé')}</button><button class="sm" data-ev="mensaje">💬 ${t('Mensaje')}</button>
    ${c.status === 'prospecto' ? `<button class="sm" data-appt>📅 ${t('Cita')}</button>` : ''}
    <button class="sm" data-ev="enviado">📄 ${c.status === 'cotizado' ? t('Reenvié estimado') : t('Envié estimado')}</button>
    <button class="sm primary" data-ev="ganado">✓ ${t('Ganado')}</button><button class="sm" data-ev="perdido">✕ ${t('Perdido')}</button></div>`;
}
function bindLeadActions(root, cards, after) {
  $$('[data-lead]', root).forEach(el => {
    const c = cards.find(x => x.id === Number(el.dataset.lead)); if (!c) return;
    $$('[data-ev]', el).forEach(b => { b.onclick = e => { e.preventDefault(); e.stopPropagation(); leadEvent(c, b.dataset.ev, after); }; });
    const ap = $('[data-appt]', el); if (ap) ap.onclick = e => { e.preventDefault(); e.stopPropagation(); apptDialog(null, after, c); };
  });
}
function leadCard(c, { actions = true } = {}) {
  const ev = c.last_event;
  return `<div class="lead ${c.overdue ? 'late' : ''}"><a href="#/ventas/cliente/${c.id}" class="lead-main">
    <div class="row between"><b>${esc(c.client_name)}</b>${c.quoted_cents ? `<b>${fmt0(c.quoted_cents)}</b>` : ''}</div>
    <div class="small muted">${[esc(typeLabel(c.project_type)), c.lead_source && esc(c.lead_source), c.sales_name && (SALES_WHO ? '👤 ' + esc(c.sales_name) : '')].filter(Boolean).join(' · ')}</div>
    <div class="small">${[c.estimate_sent_date && t('Estimado enviado hace {n} días', { n: c.days_since_sent }), c.follow_up_date && (c.overdue ? `<span class="neg">⏰ ${t('Tocaba llamar el {d}', { d: fdate(c.follow_up_date) })}</span>` : t('Llamar el {d}', { d: fdate(c.follow_up_date) })),
      c.next_appt && '📅 ' + fdate(c.next_appt.starts_at.slice(0, 10)) + ' ' + hhmm(c.next_appt.starts_at)].filter(Boolean).join(' · ')}</div>
    ${ev ? `<div class="small muted">↳ ${EVENT_LABEL()[ev.kind] || ev.kind}${ev.note ? ': ' + esc(ev.note.slice(0, 90)) : ''}</div>` : ''}</a>
    <div class="row wrap small">${telLink(c.client_phone)} ${c.client_phone ? `<a href="sms:${esc(c.client_phone.replace(/[^\d+]/g, ''))}">💬 SMS</a>` : ''}</div>
    ${actions ? leadActions(c) : ''}</div>`;
}
function apptRow(a) {
  const st = { hecho: `<span class="badge b-hecho">${t('Hecha')}</span>`, cancelado: `<span class="badge b-cancelado">${t('Cancelada')}</span>`, no_llego: `<span class="badge b-urg">${t('No llegó')}</span>` }[a.status] || '';
  return `<div class="appt ${a.status}" data-appt-id="${a.id}"><div class="when"><b>${hhmm(a.starts_at)}</b><span class="small muted">${a.minutes} min</span></div>
    <div style="flex:1;min-width:0"><div><b>${esc(a.title)}</b> <span class="small muted">${APPT_KIND()[a.kind] || ''}</span> ${st}</div>
      <div class="small row wrap">${mapLink(a.address)} ${telLink(a.phone)}${a.job_id ? ` <a href="#/ventas/cliente/${a.job_id}">${t('Ver cliente')}</a>` : ''}${SALES_WHO && a.user_name ? ` · 👤 ${esc(a.user_name)}` : ''}</div>
      ${a.notes ? `<div class="small muted">📝 ${esc(a.notes)}</div>` : ''}${a.result ? `<div class="small">↳ ${esc(a.result)}</div>` : ''}</div>
    <div class="actions">${a.status === 'pendiente' ? `<button class="sm primary" data-done>✓</button>` : ''}<button class="sm" data-edit>✎</button></div></div>`;
}
function bindAppts(root, list, after) {
  $$('[data-appt-id]', root).forEach(el => {
    const a = list.find(x => x.id === Number(el.dataset.apptId)); if (!a) return;
    const d = $('[data-done]', el); if (d) d.onclick = () => apptDone(a, after);
    $('[data-edit]', el).onclick = () => apptDialog(a, after);
  });
}

async function viewSalesHome(app, date) {
  const d = date || today();
  const again = () => viewSalesHome(app, d);
  const [r, who] = await Promise.all([api('GET', `/api/sales/day?date=${d}${whoQ('&')}`), salesWhoSelect()]);
  const s = r.stats;
  const isToday = d === today();
  app.innerHTML = `<div class="row between wrap"><h1 style="margin:0">${ME.role === 'sales' ? t('Hola, {x}', { x: esc(ME.name.split(' ')[0]) }) : t('Ventas')}</h1>
      <div class="row wrap">${who}<button id="nl" class="primary">${t('+ Cliente nuevo')}</button><button id="na">${t('+ Cita')}</button></div></div>
    ${salesTabs('#/ventas')}
    <div class="card"><div class="money-strip">
      <div><span>${t('Estimados abiertos')}</span><b>${s.open_n}</b><span class="small">${fmt0(s.open_cents)}</span></div>
      <div><span>${t('Ganados este mes')}</span><b>${s.won_month_n}</b><span class="small">${fmt0(s.won_month_cents)}</span></div>
      <div><span>${t('Cierre (90 días)')}</span><b>${s.close_pct_90 == null ? '—' : s.close_pct_90 + '%'}</b><span class="small">${t('de estimados enviados')}</span></div>
    </div></div>
    <div class="row between daynav"><button class="sm" id="prev">‹</button><b>${isToday ? t('Hoy') + ' · ' : ''}${esc(dayLabel(d))}</b><button class="sm" id="next">›</button>${isToday ? '' : `<button class="sm" id="tod">${t('Hoy')}</button>`}</div>
    <div class="grid two">
      <div class="card"><h2>📅 ${t('Citas del día')}</h2>${r.appointments.length ? r.appointments.map(apptRow).join('') : `<p class="empty">${t('No hay citas este día.')}</p>`}</div>
      <div class="card ${r.due.some(c => c.overdue) ? 'notices' : ''}"><h2>📞 ${t('Toca dar seguimiento')} ${r.due.length ? `<span class="badge b-late">${r.due.length}</span>` : ''}</h2>
        ${r.due.length ? r.due.map(c => leadCard(c)).join('') : `<p class="empty">${t('Nada pendiente. ¡Bien!')}</p>`}</div>
    </div>
    ${r.new_leads.length ? `<div class="card"><h2>✨ ${t('Clientes nuevos por atender')} <span class="badge b-en_progreso">${r.new_leads.length}</span></h2>
      <p class="small muted">${t('Llámelos y agende la visita. Los que llegan por la página web aparecen aquí solos.')}</p>${r.new_leads.map(c => leadCard(c)).join('')}</div>` : ''}
    <div class="card"><h2>🗓️ ${t('Próximos 7 días')}</h2>${r.upcoming.length ? r.upcoming.map(a => `<div class="small upc"><b>${esc(fdateIn(LANG, a.starts_at.slice(0, 10)))} ${hhmm(a.starts_at)}</b> · ${esc(a.title)}${a.address ? ' · ' + esc(a.address) : ''}</div>`).join('') : `<p class="empty">${t('Sin citas próximas.')}</p>`}</div>`;
  bindWho(app, again);
  $('#prev', app).onclick = () => viewSalesHome(app, addDaysL(d, -1));
  $('#next', app).onclick = () => viewSalesHome(app, addDaysL(d, 1));
  if ($('#tod', app)) $('#tod', app).onclick = () => viewSalesHome(app);
  $('#nl', app).onclick = () => newLeadDialog(again);
  $('#na', app).onclick = () => apptDialog(null, again);
  bindAppts(app, r.appointments, again);
  bindLeadActions(app, [...r.due, ...r.new_leads], again);
}

async function viewSalesPipeline(app) {
  const again = () => viewSalesPipeline(app);
  const [r, who] = await Promise.all([api('GET', '/api/sales/pipeline' + whoQ()), salesWhoSelect()]);
  app.innerHTML = `<div class="row between wrap"><h1 style="margin:0">${t('Clientes y estimados')}</h1><div class="row wrap">${who}<button id="nl" class="primary">${t('+ Cliente nuevo')}</button></div></div>
    ${salesTabs('#/ventas/clientes')}
    <div class="field" style="max-width:24rem"><input id="q" placeholder="${t('Buscar cliente, teléfono o dirección…')}" aria-label="${t('Buscar')}"></div>
    <div class="pipeline">${STAGES().map(([k, l]) => `<section class="stage st-${k}"><header><b>${esc(l)}</b><span class="small muted">${r.totals[k].n}${r.totals[k].cents ? ' · ' + fmt0(r.totals[k].cents) : ''}</span></header>
      ${r.stages[k].map(c => `<div class="pcard" data-s="${esc([c.client_name, c.client_phone, c.address, c.description].join(' ').toLowerCase())}">${leadCard(c, { actions: false })}</div>`).join('') || `<p class="empty small">—</p>`}</section>`).join('')}</div>
    <p class="small muted">${t('Ganados y perdidos: últimos 90 días.')}</p>`;
  bindWho(app, again);
  $('#nl', app).onclick = () => newLeadDialog(again);
  $('#q', app).oninput = e => { const q = e.target.value.trim().toLowerCase(); $$('.pcard', app).forEach(p => { p.hidden = q && !p.dataset.s.includes(q); }); };
  bindLeadActions(app, Object.values(r.stages).flat(), again);
}

async function viewSalesAgenda(app, from) {
  const f = from || today();
  const again = () => viewSalesAgenda(app, f);
  const [list, who] = await Promise.all([api('GET', `/api/appointments?from=${f}&to=${addDaysL(f, 30)}${whoQ('&')}`), salesWhoSelect()]);
  const byDay = {};
  for (const a of list) (byDay[a.starts_at.slice(0, 10)] ||= []).push(a);
  app.innerHTML = `<div class="row between wrap"><h1 style="margin:0">${t('Agenda')}</h1><div class="row wrap">${who}<button id="na" class="primary">${t('+ Cita')}</button></div></div>
    ${salesTabs('#/ventas/agenda')}
    <div class="row daynav"><button class="sm" id="prev">‹ ${t('Antes')}</button><b>${t('Del {a} al {b}', { a: fdate(f), b: fdate(addDaysL(f, 30)) })}</b><button class="sm" id="next">${t('Después')} ›</button></div>
    ${Object.keys(byDay).length ? Object.entries(byDay).map(([d, as]) => `<div class="card"><h2 style="text-transform:capitalize">${d === today() ? t('Hoy') + ' · ' : ''}${esc(dayLabel(d))}</h2>${as.map(apptRow).join('')}</div>`).join('')
    : `<div class="card empty">${t('No hay citas en estos días.')}</div>`}`;
  bindWho(app, again);
  $('#prev', app).onclick = () => viewSalesAgenda(app, addDaysL(f, -30));
  $('#next', app).onclick = () => viewSalesAgenda(app, addDaysL(f, 30));
  $('#na', app).onclick = () => apptDialog(null, again);
  bindAppts(app, list, again);
}

async function viewLead(app, id) {
  const again = () => viewLead(app, id);
  const c = await api('GET', `/api/sales/leads/${id}`);
  const open = ['prospecto', 'cotizado'].includes(c.status);
  const team = ME.role === 'owner' ? await api('GET', '/api/sales/team').catch(() => []) : [];
  app.innerHTML = `<a href="#/ventas/clientes" class="small">← ${t('Clientes y estimados')}</a>
    <div class="row between wrap" style="margin-top:.3rem"><div><h1 style="margin:0">${esc(c.client_name)}</h1>
      <div class="muted">${esc(typeLabel(c.project_type))}${c.lead_source ? ' · ' + esc(c.lead_source) : ''}</div></div>
      <div class="row wrap"><span class="badge b-${c.status}">${statusLabel(c.status)}</span>${open ? `<button id="ed">${t('Editar')}</button>` : ''}${open && ME.role === 'owner' ? `<a class="btn primary" href="#/obra/${c.id}/propuesta">📝 ${t('Armar propuesta')}</a>` : ''}
      ${['activo', 'terminado'].includes(c.status) && ME.role !== 'sales' ? `<a class="btn" href="#/obra/${c.id}">${t('Abrir obra')}</a>` : ''}</div></div>
    <div class="grid two" style="margin-top:1rem">
      <div class="card"><h2>${t('Contacto')}</h2><div class="kv">
        <div>${telLink(c.client_phone) || '—'}</div>${c.client_email ? `<div><a href="mailto:${esc(c.client_email)}">✉️ ${esc(c.client_email)}</a></div>` : ''}<div>${mapLink(c.address)}</div></div>
        ${c.description ? `<h3>${t('Qué quiere')}</h3><div style="white-space:pre-wrap">${esc(c.description)}</div>` : ''}
        ${team.length ? `<div class="field" style="margin-top:1rem"><label>${t('Vendedor')}</label><select id="sid"><option value="">${t('— sin vendedor —')}</option>${team.map(u => `<option value="${u.id}" ${u.id === c.sales_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>` : ''}</div>
      <div class="card"><h2>${t('Estimado')}</h2>
        ${c.quoted_cents ? `<div class="big-num">${fmt(c.quoted_cents)}</div>` : `<p class="muted">${t('Todavía no se envía estimado.')}</p>`}
        ${c.estimate_sent_date ? `<p class="small">${t('Enviado el {d} (hace {n} días)', { d: fdate(c.estimate_sent_date), n: c.days_since_sent })}</p>` : ''}
        ${c.follow_up_date && open ? `<p class="${c.overdue ? 'neg' : ''}">⏰ ${t('Próximo seguimiento: {d}', { d: fdate(c.follow_up_date) })}</p>` : ''}
        ${c.won_date ? `<p class="pos">🎉 ${t('Ganado el {d}', { d: fdate(c.won_date) })}</p>` : ''}${c.lost_reason ? `<p class="neg">${t('Perdido')}: ${esc(LOST_LABEL()[c.lost_reason] || c.lost_reason)}</p>` : ''}
        ${open ? leadActions(c) : ''}</div></div>
    <div class="grid two">
      <div class="card"><div class="row between"><h2>📅 ${t('Citas')}</h2>${open ? `<button class="sm" id="na">${t('+ Cita')}</button>` : ''}</div>${c.appointments.length ? c.appointments.map(a => apptRow({ ...a, job_id: null })).join('') : `<p class="empty">${t('Sin citas.')}</p>`}</div>
      <div class="card"><div class="row between"><h2>🕑 ${t('Historial')}</h2>${open ? `<button class="sm" id="nn">${t('+ Nota')}</button>` : ''}</div>
        <ul class="timeline">${c.events.map(e => `<li><span class="small muted">${esc(fdate(e.at.slice(0, 10)))} · ${esc(e.user_name || '')}</span><div><b>${EVENT_LABEL()[e.kind] || esc(e.kind)}</b>${e.amount_cents ? ' · ' + fmt0(e.amount_cents) : ''}${e.note ? ' — ' + esc(e.note) : ''}${e.next_date ? `<div class="small muted">${t('Siguiente: {d}', { d: fdate(e.next_date) })}</div>` : ''}</div></li>`).join('')}</ul></div></div>`;
  if ($('#ed', app)) $('#ed', app).onclick = async () => { if (await formDialog({ title: t('Editar cliente'), fields: leadFieldsForm(c), onSubmit: v => api('PUT', `/api/sales/leads/${id}`, v) })) again(); };
  if ($('#sid', app)) $('#sid', app).onchange = e => act(() => api('PUT', `/api/sales/leads/${id}`, { sales_id: e.target.value ? Number(e.target.value) : null }), t('Vendedor asignado'));
  if ($('#na', app)) $('#na', app).onclick = () => apptDialog(null, again, c);
  if ($('#nn', app)) $('#nn', app).onclick = () => leadEvent(c, 'nota', again);
  bindLeadActions(app, [c], again);
  bindAppts(app, c.appointments, again);
}

// Tarjeta de ventas en el inicio del dueño o del PM que tiene la herramienta.
async function salesHomeCard(box) {
  if (!SELLS() || ME.role === 'sales') { box.remove(); return; }
  const r = await api('GET', '/api/sales/day');
  box.className = 'card' + (r.due.some(c => c.overdue) ? ' notices' : '');
  box.innerHTML = `<div class="row between"><h2>💼 ${t('Mis ventas hoy')}</h2><a class="btn sm" href="#/ventas">${t('Abrir ventas')}</a></div>
    <div class="row wrap small"><span>📅 ${t('{n} cita(s) hoy', { n: r.appointments.filter(a => a.status === 'pendiente').length })}</span><span>📞 ${t('{n} seguimiento(s)', { n: r.due.length })}</span><span>✨ ${t('{n} cliente(s) nuevo(s)', { n: r.new_leads.length })}</span>
      <span>· ${t('Estimados abiertos')}: <b>${r.stats.open_n}</b> (${fmt0(r.stats.open_cents)})</span></div>
    ${r.appointments.filter(a => a.status === 'pendiente').slice(0, 4).map(a => `<div class="small">• <b>${hhmm(a.starts_at)}</b> ${esc(a.title)}${a.address ? ' · ' + esc(a.address) : ''}</div>`).join('')}`;
}

// =====================================================================
// TABLERO DEL DÍA
// =====================================================================
async function viewBoard(app) {
  const again = () => viewBoard(app);
  const b = await api('GET', '/api/board');
  const p = b.todo;
  const chip = (n, label, href, warn) => n ? `<a class="pchip ${warn ? 'warn' : ''}" href="${href}"><b>${n}</b> ${esc(label)}</a>` : '';
  const who = x => x && x.assignee ? x.assignee : null;
  const stat = x => !x ? '' : !x.assignee ? `<span class="badge b-urg">${t('Sin sub')}</span>` : x.confirmed_at ? `<span class="badge b-hecho">✓ ${t('Confirmó')}</span>`
    : x.notice === 'enviado' ? `<span class="badge b-pendiente">${t('Aviso enviado')}</span>` : x.notified_at ? `<span class="badge b-pendiente">${t('Avisado, sin confirmar')}</span>` : `<span class="badge b-late">${t('Sin avisar')}</span>`;
  const AL = a => ({ no_plan: '🗒️ ' + t('No tiene plan de trabajo'), late: '⏰ ' + t('{n} tarea(s) atrasada(s), hasta {d} días ({x})', { n: a.n, d: a.days, x: taskTitle(a.title) }),
    no_sub: '👷 ' + t('Falta asignar quién hace: {x}', { x: taskTitle(a.title) }), not_confirmed: '❓ ' + t('{w} no ha confirmado {x} ({d})', { w: a.who, x: taskTitle(a.title), d: fdate(a.date) }) }[a.kind] || a.kind);
  const step = (label, x) => x ? `<div class="bstep"><span class="small muted">${label}</span><div><b>${esc(taskTitle(x.title))}</b> <span class="small muted">${x.planned_date ? dateRange(x) : t('sin fecha')}</span></div>
    <div class="row wrap small">${who(x) ? `👷 ${esc(who(x).name)}${who(x).trade ? ' · ' + esc(who(x).trade) : ''}` : ''} ${stat(x)}
      ${who(x) && !x.confirmed_at ? `<button class="sm" data-notify="${x.id}">📣 ${x.notified_at ? t('Avisar otra vez') : t('Avisar')}</button>` : ''}</div></div>` : '';
  app.innerHTML = `<div class="row between"><h1 style="margin:0">${t('Hoy')} · <span style="text-transform:capitalize">${esc(dayLabel(b.today))}</span></h1><button id="rf" class="sm">↻</button></div>
    <div class="pchips">${chip(p.approvals, t('autorizaciones'), '#/', true)}${chip(p.inspections.length, t('inspecciones esta semana'), '#/hoy')}${chip(p.docs.length, t('estimados/invoices de subs por revisar'), '#/', true)}
      ${chip(p.notices.length, t('avisos respondidos'), '#/')}${chip(p.cases.length, t('casos abiertos'), '#/casos', p.cases.some(c => c.urgent))}${chip(p.scans, t('tickets por asignar'), '#/')}
      ${p.unpaid_invoices && p.unpaid_invoices.n ? chip(p.unpaid_invoices.n, t('invoices aprobados sin pagar ({m})', { m: fmt0(p.unpaid_invoices.v) }), '#/cuentas') : ''}</div>
    ${p.inspections.length ? `<div class="card"><h2>🏛️ ${t('Inspecciones próximas')}</h2>${p.inspections.map(i => `<div class="small"><b>${fdate(i.date)}</b> · ${esc(i.name)} · <a href="#/obra/${i.job_id}/permisos">${esc(i.client_name)}</a></div>`).join('')}</div>` : ''}
    ${b.jobs.length ? b.jobs.map(j => `<div class="card bjob ${j.alerts.some(a => ['late', 'no_sub'].includes(a.kind)) ? 'notices' : ''}">
      <div class="row between wrap"><div><a href="#/obra/${j.job_id}"><h2 style="margin:0">${esc(j.client_name)}</h2></a><div class="small muted">${[esc(j.address), j.pm_name && 'PM: ' + esc(j.pm_name), j.end_date && t('Fin {d}', { d: fdate(j.end_date) })].filter(Boolean).join(' · ')}</div></div>
        <div class="row" style="min-width:10rem"><div class="bar" style="flex:1"><span style="width:${j.progress.total ? Math.round(j.progress.done * 100 / j.progress.total) : 0}%"></span></div><span class="small">${j.progress.done}/${j.progress.total}</span></div></div>
      ${j.alerts.length ? `<div class="balerts">${j.alerts.map(a => `<div class="small ${['late', 'no_sub'].includes(a.kind) ? 'neg' : ''}">${AL(a)}</div>`).join('')}</div>` : ''}
      ${j.alerts.some(a => a.kind === 'no_plan') ? `<a class="btn sm" href="#/obra/${j.job_id}/tareas">🤖 ${t('Hacer plan de trabajo')}</a>` : ''}
      <div class="bsteps">${step(t('Ahora'), j.current)}${step(t('Sigue'), j.next)}${step(t('Después'), j.after_next)}</div></div>`).join('')
    : `<div class="card empty">${t('No hay obras activas.')}</div>`}`;
  $('#rf', app).onclick = again;
  $$('[data-notify]', app).forEach(bt => { bt.onclick = () => notifySub(Number(bt.dataset.notify), again); });
}
async function notifySub(taskId, after) {
  const r = await api('POST', `/api/tasks/${taskId}/notify`);
  const a = r.assignee || {}, lang = a.lang || 'es';
  const when = r.task.planned_date ? fdateIn(lang, r.task.planned_date) + (r.task.planned_end ? ' – ' + fdateIn(lang, r.task.planned_end) : '') : '';
  const msg = tl(lang, 'Hola {n}, le toca: {x} en {j}{d}. ¿Me confirma por favor? Puede confirmar en la app de Elevated Exteriors.', { n: (a.name || '').split(' ')[0], x: taskTitle(r.task.title), j: r.job.address || r.job.client_name, d: when ? ' · ' + when : '' });
  toast(t('Se le mandó notificación a {x}', { x: a.name }));
  if (a.phone) {
    await formDialog({ title: t('Avisar a {x}', { x: a.name }), submit: t('Listo'), intro: `<p class="small muted">${t('Ya le llegó la notificación en la app. Si quiere, mándele también este WhatsApp:')}</p>
      <div class="card small" style="white-space:pre-wrap">${esc(msg)}</div><p><a class="btn primary" target="_blank" rel="noopener" href="${waLink(a.phone, msg)}">WhatsApp</a> <a class="btn" href="sms:${esc(a.phone.replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(msg)}">SMS</a></p>`,
      fields: [], onSubmit: async () => {} });
  }
  after();
}
// Sub: sus próximas tareas, con botón para confirmar.
async function workerNextCard(box) {
  const list = await api('GET', '/api/my-next').catch(() => []);
  if (!list.length) { box.remove(); return; }
  box.className = 'card' + (list.some(x => !x.confirmed_at) ? ' notices' : '');
  box.innerHTML = `<h2>📌 ${t('Mis próximas tareas')}</h2>${list.map(x => `<div class="nexttask" data-id="${x.id}"><div style="flex:1"><b>${esc(taskTitle(x.title))}</b>
      <div class="small muted">${esc(x.address || x.client_name)} · ${dateRange(x)}</div></div>
      ${x.confirmed_at ? `<span class="badge b-hecho">✓ ${t('Confirmada')}</span>` : `<button class="primary sm" data-ok>${t('Confirmo que voy')}</button>`}</div>`).join('')}`;
  $$('[data-ok]', box).forEach(b => { b.onclick = async () => { await act(() => api('POST', `/api/tasks/${b.closest('[data-id]').dataset.id}/confirm`), t('Confirmada. Gracias')); workerNextCard(box); }; });
}

// =====================================================================
// REPORTE Y CALIFICACIÓN DE PROJECT MANAGERS
// =====================================================================
const GROUP_LABEL = () => ({ tareas: t('Tareas'), cliente: t('Reportes al cliente'), fotos: t('Fotos'), casos: t('Casos'), subs: t('Subs y avisos'), dinero: t('Gastos y pagos'), permisos: t('Permisos'), materiales: t('Materiales'), planes: t('Planes de trabajo'), otro: t('Otro') });
const PART_INFO = () => ({
  puntualidad: [t('Puntualidad'), t('Obras terminadas a tiempo (fecha fin) este mes')],
  presupuesto: [t('Presupuesto'), t('Gastado contra presupuesto de sus obras')],
  calidad: [t('Calidad'), t('Retrabajo como % del contrato (menos es mejor)')],
  cliente: [t('Cliente'), t('Estrellas que dieron los clientes al terminar')],
  disciplina: [t('Disciplina'), t('Notas diarias escritas y solicitudes rechazadas')],
  duenos: [t('Dueños'), t('Su evaluación de este mes')],
});
const stars = n => n == null ? '—' : `<span class="stars" title="${n}">${'★'.repeat(Math.round(n))}${'☆'.repeat(5 - Math.round(n))}</span> <b>${n}</b>`;

function pmDayBlock(p) {
  const G = GROUP_LABEL();
  return `<div class="pmday"><div class="row between wrap"><h3 style="margin:0">${esc(p.name)}</h3><span class="small">${t('{n} acciones registradas', { n: p.total })}</span></div>
    <div class="row wrap small">${Object.entries(p.counts).map(([k, n]) => `<span class="pchip"><b>${n}</b> ${esc(G[k] || k)}</span>`).join('') || `<span class="muted">${t('Sin actividad registrada este día.')}</span>`}</div>
    ${p.tasks_done.length ? `<div class="small"><b>✓ ${t('Tareas terminadas')}:</b> ${p.tasks_done.map(x => esc(taskTitle(x.title)) + ' (' + esc(x.client_name) + ')').join(', ')}</div>` : ''}
    ${p.note ? `<div class="pmnote"><div><b>${t('Qué hizo')}:</b> ${trx(p.note.did, p.note.did_tr, p.note.did_from, { inline: true })}</div>${p.note.problems ? `<div><b>${t('Problemas')}:</b> ${trx(p.note.problems, p.note.problems_tr, p.note.problems_from, { inline: true })}</div>` : ''}${p.note.next_steps ? `<div><b>${t('Qué sigue')}:</b> ${trx(p.note.next_steps, p.note.next_steps_tr, p.note.next_steps_from, { inline: true })}</div>` : ''}</div>`
      : `<div class="small neg">✎ ${t('No escribió su nota del día.')}</div>`}
    ${p.items.length ? `<details><summary class="small">${t('Ver detalle')}</summary><ul class="small acts">${p.items.map(i => `<li><span class="muted">${esc(i.at.slice(11, 16))} UTC</span> · ${esc(G[i.group] || i.group)}${i.client_name ? ' · ' + esc(i.client_name) : ''}${i.detail ? ' · ' + esc(i.detail) : ''}</li>`).join('')}</ul></details>` : ''}</div>`;
}

async function viewPmReports(app, opts = {}) {
  const day = opts.day || addDaysL(today(), new Date().getHours() < 12 ? -1 : 0);
  const month = opts.month || today().slice(0, 7);
  const again = o => viewPmReports(app, { day, month, ...o });
  const d = await api('GET', `/api/pm/daily?date=${day}`);
  app.innerHTML = `<h1>${t('Project managers')}</h1>
    <div class="card"><div class="row between wrap"><h2 style="margin:0">📋 ${t('Reporte del día')}</h2><div class="row"><button class="sm" id="pv">‹</button><input type="date" id="dd" value="${day}"><button class="sm" id="nx">›</button></div></div>
      ${d.pms.length ? d.pms.map(pmDayBlock).join('') : `<p class="empty">${t('Todavía no hay project managers. Agréguelos en Equipo y accesos.')}</p>`}</div>
    <div id="cards"></div>`;
  $('#dd', app).onchange = e => again({ day: e.target.value });
  $('#pv', app).onclick = () => again({ day: addDaysL(day, -1) });
  $('#nx', app).onclick = () => again({ day: addDaysL(day, 1) });
  const box = $('#cards', app);
  for (const p of d.pms) {
    const sc = await api('GET', `/api/pm/${p.id}/scorecard?month=${month}`);
    const c = document.createElement('div'); c.className = 'card'; box.appendChild(c);
    const P = PART_INFO(), D = sc.data;
    const detail = { puntualidad: t('{a} de {b} a tiempo', { a: D.finished - D.late, b: D.finished }) + (D.late ? ' · ' + t('{n} días tarde en promedio', { n: D.avg_days_late }) : ''),
      presupuesto: D.budget_cents ? `${fmt0(D.spent_cents)} / ${fmt0(D.budget_cents)} (${D.variance_pct > 0 ? '+' : ''}${D.variance_pct}%)` : t('Sin presupuestos'),
      calidad: t('Retrabajo {m}', { m: fmt0(D.rework_cents) }), cliente: D.rating_all_n ? t('{n} calificación(es)', { n: D.rating_all_n }) : t('Sin calificaciones'),
      disciplina: t('{a} notas de {b} días hábiles', { a: D.notes, b: D.workdays }) + (D.requests.rejected ? ' · ' + t('{n} solicitudes rechazadas', { n: D.requests.rejected }) : ''),
      duenos: sc.reviews.length ? sc.reviews.map(r => `${esc(r.owner_name)}: ${r.score}`).join(' · ') : t('Sin evaluar') };
    const maxH = 5;
    c.innerHTML = `<div class="row between wrap"><h2 style="margin:0">⭐ ${esc(p.name)} · ${t('Calificación del mes')}</h2><input type="month" value="${month}" data-m></div>
      <div class="scorehead"><div class="big-num">${sc.overall == null ? '—' : sc.overall}</div><div class="small muted">${t('de 5 · promedio ponderado de lo que sí tiene datos')}</div>
        <div class="spark" aria-label="${t('Últimos 6 meses')}">${sc.history.map(h => `<span title="${h.month}: ${h.overall ?? '—'}" style="height:${h.overall ? Math.round(h.overall / maxH * 100) : 4}%"></span>`).join('')}</div></div>
      <div class="parts">${Object.keys(P).map(k => `<div class="part"><div class="row between"><b>${P[k][0]}</b><span>${sc.parts[k] == null ? '<span class="muted">—</span>' : sc.parts[k]}</span></div>
        <div class="bar"><span style="width:${sc.parts[k] ? sc.parts[k] / 5 * 100 : 0}%"></span></div><div class="small muted">${P[k][1]} · ${t('peso {w}%', { w: sc.weights[k] })}</div><div class="small">${detail[k]}</div></div>`).join('')}</div>
      <div class="small muted">${t('Obras activas: {a} · Tareas atrasadas: {b} · Contratos terminados: {c} · Margen: {d} · Casos resueltos: {e}', { a: D.active, b: D.overdue_tasks, c: fmt0(D.contracts_cents), d: D.margin_pct == null ? '—' : D.margin_pct + '%', e: D.cases_resolved })}</div>
      ${sc.reviews.filter(r => r.comments).map(r => `<div class="small pmnote">“${esc(r.comments)}” — ${esc(r.owner_name)}</div>`).join('')}
      <div class="row wrap" style="margin-top:.75rem"><button class="primary sm" data-rev>${t('Evaluar este mes')}</button>${sc.notes.length ? `<button class="sm" data-notes>${t('Ver sus notas ({n})', { n: sc.notes.length })}</button>` : ''}</div>`;
    $('[data-m]', c).onchange = e => again({ month: e.target.value });
    $('[data-rev]', c).onclick = async () => {
      const mine = sc.reviews.find(r => r.owner_name === ME.name) || {};
      if (await formDialog({ title: t('Evaluación de {x} · {m}', { x: p.name, m: month }), intro: t('Cada dueño da su calificación. Cuenta 15% de la calificación del mes.'), fields: [
        { name: 'score', label: t('Calificación'), type: 'select', required: true, value: String(mine.score || 4), options: [5, 4, 3, 2, 1].map(n => [n, '★'.repeat(n) + ' ' + n]) },
        { name: 'comments', label: t('Comentarios (qué hace bien, qué mejorar)'), type: 'textarea', value: mine.comments },
      ], onSubmit: v => api('POST', `/api/pm/${p.id}/review`, { month, score: Number(v.score), comments: v.comments }) })) again();
    };
    const nb = $('[data-notes]', c); if (nb) nb.onclick = () => formDialog({ title: t('Notas de {x}', { x: p.name }), submit: t('Cerrar'), fields: [],
      intro: sc.notes.map(n => `<div class="pmnote"><b>${fdate(n.date)}</b><div>${esc(n.did_tr || n.did)}</div>${n.problems ? `<div class="small">⚠️ ${esc(n.problems_tr || n.problems)}</div>` : ''}${n.next_steps ? `<div class="small">➡️ ${esc(n.next_steps_tr || n.next_steps)}</div>` : ''}</div>`).join(''), onSubmit: async () => {} });
  }
}
// PM: su nota del día (y lo que la app registró).
async function pmNoteCard(box) {
  const d = await api('GET', '/api/pm/daily');
  const p = d.pms[0]; if (!p) { box.remove(); return; }
  box.className = 'card' + (p.note ? '' : ' notices');
  box.innerHTML = `<div class="row between"><h2>📋 ${t('Mi reporte de hoy')}</h2><span class="small">${t('{n} acciones registradas', { n: p.total })}</span></div>
    ${p.note ? `<div class="pmnote"><div><b>${t('Qué hice')}:</b> ${esc(p.note.did)}</div>${p.note.problems ? `<div><b>${t('Problemas')}:</b> ${esc(p.note.problems)}</div>` : ''}${p.note.next_steps ? `<div><b>${t('Qué sigue')}:</b> ${esc(p.note.next_steps)}</div>` : ''}</div>`
      : `<p class="small muted">${t('Al final del día escriba en 1 minuto qué hizo, qué problemas hubo y qué sigue. Los dueños lo ven en su reporte.')}</p>`}
    <button class="${p.note ? 'sm' : 'primary'}" id="wn">${p.note ? t('Editar nota') : t('Escribir nota del día')}</button>`;
  $('#wn', box).onclick = async () => {
    if (await formDialog({ title: t('Nota del día'), fields: [
      { name: 'did', label: t('¿Qué hizo hoy?'), type: 'textarea', required: true, value: p.note ? p.note.did : '' },
      { name: 'problems', label: t('Problemas o atrasos'), type: 'textarea', value: p.note ? p.note.problems : '' },
      { name: 'next_steps', label: t('¿Qué sigue mañana?'), type: 'textarea', value: p.note ? p.note.next_steps : '' },
    ], onSubmit: v => api('POST', '/api/pm/notes', v) })) { toast(t('Guardado')); pmNoteCard(box); }
  };
}
// Cliente: calificar el proyecto al terminar.
async function clientRatingCard(app, j) {
  if (j.status !== 'terminado') return;
  const r = await api('GET', `/api/jobs/${j.id}/rating`).catch(() => null); if (!r) return;
  const c = document.createElement('div'); c.className = 'card rating';
  const portal = $('.portal', app) || app; portal.insertBefore(c, portal.children[1]);
  const draw = (sel, comment = '', saved) => {
    c.innerHTML = `<h2>${saved ? t('¡Gracias por su calificación!') : t('¿Cómo le fue con su proyecto?')}</h2>
      <div class="starpick" role="radiogroup" aria-label="${t('Calificación')}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-s="${n}" class="${n <= sel ? 'on' : ''}" aria-label="${n}">★</button>`).join('')}</div>
      <textarea id="rc" placeholder="${t('Cuéntenos (opcional)')}">${esc(comment)}</textarea><button class="primary" id="rs">${saved ? t('Actualizar') : t('Enviar')}</button>`;
    $$('[data-s]', c).forEach(b => { b.onclick = () => draw(Number(b.dataset.s), $('#rc', c).value, saved); });
    $('#rs', c).onclick = async () => { if (!sel) { toast(t('Elija de 1 a 5 estrellas'), true); return; } await act(() => api('POST', `/api/jobs/${j.id}/rating`, { stars: sel, comment: $('#rc', c).value }), t('¡Gracias!')); draw(sel, $('#rc', c).value, true); };
  };
  draw(r.rating ? r.rating.stars : 0, r.rating ? r.rating.comment : '', !!r.rating);
}

// =====================================================================
// PLAN DE TRABAJO CON AI
// =====================================================================
function localSchedule(start, tasks, saturdays) {
  const ok = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w !== 0 && (saturdays || w !== 6); };
  let d = start; while (!ok(d)) d = addDaysL(d, 1);
  return tasks.map(x => {
    const days = Math.max(1, Math.round(Number(x.days) || 1));
    const s = d; let e = d;
    for (let k = 1; k < days; k++) { e = addDaysL(e, 1); while (!ok(e)) e = addDaysL(e, 1); }
    d = addDaysL(e, 1); while (!ok(d)) d = addDaysL(d, 1);
    return { ...x, days, planned_date: s, planned_end: days > 1 ? e : '' };
  });
}
async function planCard(box, d, { id, workers, reload }) {
  if (!BOSS()) return;
  const c = document.createElement('div'); c.className = 'card planai';
  box.insertBefore(c, box.firstChild);
  c.innerHTML = `<div class="row between wrap"><div><h2 style="margin:0">🤖 ${t('Plan de trabajo con AI')}</h2>
    <div class="small muted">${t('Sube el estimado o invoice (PDF o foto) y la AI propone las tareas, el orden, los días y qué sub hace cada una. Usted lo ajusta antes de guardarlo.')}</div></div>
    <button class="primary" id="mkplan">${d.tasks.length ? t('Rehacer o agregar plan') : t('Hacer plan de trabajo')}</button></div>`;
  $('#mkplan', c).onclick = () => planDialog(d, { id, workers, reload });
}
async function planDialog(d, { id, workers, reload }) {
  const [st, templates] = await Promise.all([api('GET', '/api/plan/status'), api('GET', '/api/plan-templates')]);
  const mine = templates.filter(x => x.project_type === d.job.project_type);
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog" novalidate><h2>🤖 ${t('Plan de trabajo para {x}', { x: esc(d.job.client_name) })}</h2><div class="error"></div>
    ${st.ai ? '' : `<div class="intro small">${t('La AI no está configurada: se usará el plan base del tipo de proyecto (o una plantilla). Para activar la AI vea el LEEME.')}</div>`}
    <div class="fields">
      <div class="field full"><label>${t('Estimado o invoice del cliente (PDF o foto)')}</label><input type="file" id="pf" accept="application/pdf,image/*"><div class="hint">${t('Opcional si la obra ya tiene la descripción del trabajo.')}</div></div>
      <div class="field"><label>${t('Empezar el')}</label><input type="date" id="ps" value="${esc(d.job.start_date || addDaysL(today(), 1))}"></div>
      <div class="field"><label>${t('Partir de')}</label><select id="pt"><option value="">${st.ai ? t('AI (leer el estimado)') : t('Plan base')}</option>${mine.concat(templates.filter(x => !mine.includes(x))).map(x => `<option value="${x.id}">${t('Plantilla')}: ${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field full"><label class="check"><input type="checkbox" id="psat"> ${t('Se trabaja también los sábados')}</label></div>
      <div class="field full"><label>${t('Instrucciones extra (opcional)')}</label><textarea id="px" placeholder="${t('Ej. el cliente quiere la cocina antes de Navidad; el granito tarda 3 semanas')}"></textarea></div>
    </div><div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Proponer plan')}</button></div></form>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  $('[data-x]', dlg).onclick = close; dlg.addEventListener('cancel', close);
  $('form', dlg).onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', dlg); btn.disabled = true; btn.textContent = t('Pensando… (puede tardar 30 segundos)');
    try {
      const f = $('#pf', dlg).files[0];
      let file;
      if (f) file = /^image\//.test(f.type) ? await compressImage(f, 2000, 0.85) : await readAnyFile(f);
      const r = await api('POST', `/api/jobs/${id}/plan/draft`, { file, start_date: $('#ps', dlg).value, template_id: $('#pt', dlg).value || undefined, saturdays: $('#psat', dlg).checked, extra: $('#px', dlg).value });
      close();
      planEditor(d, r, { id, workers, saturdays: $('#psat', dlg) ? $('#psat', dlg).checked : false, reload });
    } catch (err) { $('.error', dlg).textContent = err.message; btn.disabled = false; btn.textContent = t('Proponer plan'); }
  };
  dlg.showModal();
}
function planEditor(d, draft, { id, workers, saturdays, reload }) {
  let rows = draft.tasks.map(x => ({ ...x }));
  let start = draft.start_date, sat = saturdays;
  const dlg = document.createElement('dialog'); dlg.className = 'wide';
  const wopts = sel => `<option value="">${t('— sin asignar —')}</option>${workers.map(w => `<option value="${w.id}" ${String(w.id) === String(sel ?? '') ? 'selected' : ''}>${esc(w.name)}${w.trade ? ' (' + esc(w.trade) + ')' : ''}</option>`).join('')}`;
  const SRC = { ai: t('Propuesto por la AI'), base: t('Plan base del tipo de proyecto'), template: t('Desde plantilla') };
  const draw = () => {
    rows = localSchedule(start, rows, sat);
    const end = rows.length ? (rows.at(-1).planned_end || rows.at(-1).planned_date) : start;
    dlg.innerHTML = `<div class="pe"><div class="row between wrap"><h2 style="margin:0">${t('Revise y ajuste el plan')}</h2><span class="badge b-en_progreso">${SRC[draft.source] || ''}</span></div>
      ${draft.warnings.length ? `<div class="card notices small">${draft.warnings.map(w => '⚠️ ' + esc(w)).join('<br>')}</div>` : ''}
      <div class="row wrap"><label class="small">${t('Empieza')} <input type="date" id="es" value="${start}"></label><label class="check small"><input type="checkbox" id="esat" ${sat ? 'checked' : ''}> ${t('Sábados')}</label>
        <span class="small">${t('{n} tareas · termina el {d}', { n: rows.length, d: `<b>${fdate(end)}</b>` })}</span></div>
      <div class="pe-rows">${rows.map((x, i) => `<div class="pe-row" data-i="${i}"><span class="n">${i + 1}</span>
        <input data-k="title" value="${esc(x.title)}" aria-label="${t('Tarea')}">
        <label class="small">${t('Días')}<input data-k="days" type="number" min="1" max="60" value="${x.days}"></label>
        <select data-k="assignee_id" aria-label="${t('Quién la hace')}">${wopts(x.assignee_id)}</select>
        <label class="check small"><input type="checkbox" data-k="inspection" ${x.inspection ? 'checked' : ''}> ${t('Inspección')}</label>
        <span class="small muted dates">${dateRange(x)}</span>
        <input data-k="materials" value="${esc(x.materials || '')}" placeholder="${t('Material a pedir / recibir')}" class="wide-in">
        <span class="row"><button type="button" class="sm" data-up>↑</button><button type="button" class="sm" data-dn>↓</button><button type="button" class="sm danger" data-rm>✕</button></span></div>`).join('')}</div>
      <button type="button" class="sm" id="addr">${t('+ Agregar tarea')}</button>
      <div class="foot"><button type="button" id="tpl" style="margin-right:auto">${t('Guardar como plantilla')}</button><button type="button" data-x>${t('Cancelar')}</button>
        ${d.tasks.length ? `<select id="mode"><option value="append">${t('Agregar a las tareas actuales')}</option><option value="replace">${t('Reemplazar tareas pendientes')}</option></select>` : ''}
        <button class="primary" type="button" id="apply">${t('Guardar en el calendario')}</button></div></div>`;
    const read = () => $$('.pe-row', dlg).forEach(el => { const x = rows[Number(el.dataset.i)];
      $$('[data-k]', el).forEach(inp => { const k = inp.dataset.k; x[k] = inp.type === 'checkbox' ? inp.checked : k === 'days' ? Number(inp.value) || 1 : k === 'assignee_id' ? (inp.value ? Number(inp.value) : null) : inp.value; }); });
    $$('.pe-row', dlg).forEach(el => {
      const i = Number(el.dataset.i);
      $('[data-k="days"]', el).onchange = () => { read(); draw(); };
      $('[data-up]', el).onclick = () => { read(); if (i > 0) [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); };
      $('[data-dn]', el).onclick = () => { read(); if (i < rows.length - 1) [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); };
      $('[data-rm]', el).onclick = () => { read(); rows.splice(i, 1); draw(); };
    });
    $('#es', dlg).onchange = e => { read(); start = e.target.value || start; draw(); };
    $('#esat', dlg).onchange = e => { read(); sat = e.target.checked; draw(); };
    $('#addr', dlg).onclick = () => { read(); rows.push({ title: '', days: 1, inspection: false, materials: '', notes: '' }); draw(); const last = $$('.pe-row [data-k="title"]', dlg).at(-1); if (last) last.focus(); };
    $('[data-x]', dlg).onclick = close;
    $('#tpl', dlg).onclick = async () => {
      read();
      const v = await formDialog({ title: t('Guardar como plantilla'), fields: [{ name: 'name', label: t('Nombre de la plantilla'), required: true, value: typeLabel(d.job.project_type) + ' ' + t('estándar') }],
        onSubmit: v => api('POST', '/api/plan-templates', { name: v.name, project_type: d.job.project_type, tasks: rows.map(({ title, days, trade, inspection, materials, notes }) => ({ title, days, trade, inspection, materials, notes })) }) });
      if (v) toast(t('Plantilla guardada: la AI la usará de guía en obras parecidas'));
    };
    $('#apply', dlg).onclick = async () => {
      read();
      if (rows.some(x => !String(x.title).trim())) { toast(t('Hay tareas sin nombre'), true); return; }
      const mode = $('#mode', dlg) ? $('#mode', dlg).value : 'append';
      if (mode === 'replace' && !confirm(t('Se borrarán las tareas pendientes de esta obra y se pondrán las del plan. ¿Seguir?'))) return;
      try {
        const r = await api('POST', `/api/jobs/${id}/plan/apply`, { start_date: start, saturdays: sat, mode, tasks: rows });
        if (r && r.pending) { close(); return; }
        toast(t('{n} tareas en el calendario. Termina el {d}', { n: r.created, d: fdate(r.end_date) })); close(); reload();
      } catch (err) { toast(err.message, true); }
    };
  };
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', close);
  document.body.appendChild(dlg); draw(); dlg.showModal();
}

// =====================================================================
// MATERIALES Y GALERÍA
// =====================================================================
let MAT_ZONES = null;
const zoneName = z => (MAT_ZONES || []).find(x => x.key === z) ? L((MAT_ZONES || []).find(x => x.key === z)) : z;
function swatch(m, big) {
  const cls = 'swatch' + (big ? ' big' : '');
  if (m.image) return `<div class="${cls}" style="background-image:url('${m.image}')" role="img" aria-label="${esc(m.name)}"></div>`;
  if (m.color_hex) return `<div class="${cls}" style="background:${esc(m.color_hex)}" role="img" aria-label="${esc(m.color_name || m.name)}"></div>`;
  return `<div class="${cls} none">${esc((m.name || '?').slice(0, 2).toUpperCase())}</div>`;
}
const matTitle = m => [m.color_name, m.name].filter(Boolean).join(' · ');
const matSub = m => [m.brand, m.kind, m.finish].filter(Boolean).join(' · ');

async function viewMaterials(app, opts = {}) {
  const q = opts.q ?? '', zone = opts.zone ?? '';
  const r = await api('GET', `/api/materials?q=${encodeURIComponent(q)}&zone=${encodeURIComponent(zone)}`);
  MAT_ZONES = r.zones;
  const staff = BOSS();
  const used = new Set(r.materials.map(m => m.zone));
  const isClient = ME.role === 'client';
  app.innerHTML = `<div class="${isClient ? 'portal' : ''}"><div class="row between wrap"><h1 style="margin:0">${t('Materiales y colores')}</h1>${staff ? `<button class="primary" id="nm">${t('+ Material')}</button>` : ''}</div>
    <p class="small muted">${t('Busque por nombre, color o marca. Cada material muestra su muestra de cerca y fotos de trabajos terminados donde lo usamos.')}</p>
    <div class="field"><input id="mq" type="search" placeholder="${t('Ej. cedar, granito negro, Hardie, stain…')}" value="${esc(q)}" aria-label="${t('Buscar material')}"></div>
    <div class="zchips"><button class="${zone ? '' : 'on'}" data-z="">${t('Todo')}</button>${r.zones.filter(z => used.has(z.key) || z.key === zone || !q).map(z => `<button class="${z.key === zone ? 'on' : ''}" data-z="${z.key}">${esc(L(z))}</button>`).join('')}</div>
    ${r.materials.length ? `<div class="matgrid">${r.materials.map(m => `<button class="mat" data-id="${m.id}">${swatch(m)}<div class="mat-txt"><b>${esc(matTitle(m))}</b><div class="small muted">${esc(matSub(m))}</div>
      <div class="small">${esc(zoneName(m.zone))}${m.jobs ? ' · ' + t('en {n} proyecto(s)', { n: m.jobs }) : ''}</div></div>
      ${m.photos.length ? `<div class="mat-ph">${m.photos.map(id => `<img src="/files/${id}" alt="" loading="lazy">`).join('')}</div>` : ''}</button>`).join('')}</div>`
    : `<div class="card empty">${q ? t('No encontramos “{x}”. Pruebe con otra palabra.', { x: esc(q) }) : t('Todavía no hay materiales en el catálogo.')}</div>`}</div>`;
  let tm;
  $('#mq', app).oninput = e => { clearTimeout(tm); tm = setTimeout(() => viewMaterials(app, { q: e.target.value, zone }).then(() => { const i = $('#mq', app); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }), 300); };
  $$('[data-z]', app).forEach(b => { b.onclick = () => viewMaterials(app, { q, zone: b.dataset.z }); });
  $$('.mat', app).forEach(b => { b.onclick = () => materialDetail(Number(b.dataset.id), () => viewMaterials(app, { q, zone })); });
  if ($('#nm', app)) $('#nm', app).onclick = () => materialForm(null, () => viewMaterials(app, { q, zone }));
}
async function materialDetail(id, after) {
  const m = await api('GET', `/api/materials/${id}`);
  const staff = BOSS();
  const dlg = document.createElement('dialog'); dlg.className = 'wide matdlg';
  dlg.innerHTML = `<div class="row between"><h2 style="margin:0">${esc(matTitle(m))}</h2><button class="sm" data-x aria-label="${t('Cerrar')}">✕</button></div>
    <div class="matdet">${m.image ? `<img class="closeup" src="${m.image}" alt="${t('Muestra de cerca')}" data-zoom>` : swatch(m, true)}
      <div><div class="kv"><div><span class="muted small">${t('Zona')}</span> ${esc(zoneName(m.zone))}</div>${m.brand ? `<div><span class="muted small">${t('Marca')}</span> ${esc(m.brand)}</div>` : ''}
        ${m.kind ? `<div><span class="muted small">${t('Tipo')}</span> ${esc(m.kind)}</div>` : ''}${m.color_name ? `<div><span class="muted small">${t('Color')}</span> ${esc(m.color_name)}${m.color_hex ? ` <span class="dotc" style="background:${esc(m.color_hex)}"></span>` : ''}</div>` : ''}
        ${m.finish ? `<div><span class="muted small">${t('Acabado')}</span> ${esc(m.finish)}</div>` : ''}</div>${m.notes ? `<p class="small">${esc(m.notes)}</p>` : ''}
        ${m.used_in ? `<p class="small muted">${t('Usado en')}: ${m.used_in.map(j => `<a href="#/obra/${j.id}/materiales">${esc(j.client_name)}</a>${j.area ? ' (' + esc(j.area) + ')' : ''}`).join(', ') || '—'}</p>` : ''}
        ${staff ? `<button class="sm" data-ed>✎ ${t('Editar')}</button>` : ''}</div></div>
    <h3>${t('Trabajos terminados con este material')}</h3>
    ${m.gallery.length ? `<div class="photos">${m.gallery.map(p => `<figure><img src="/files/${p.id}" data-view="${p.id}" alt="" loading="lazy"><figcaption>${esc(typeLabel(p.project_type))}${p.caption ? ' · ' + esc(p.caption) : ''}</figcaption></figure>`).join('')}</div>`
    : `<p class="empty">${t('Todavía no hay fotos de trabajos terminados con este material.')}</p>`}`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  $('[data-x]', dlg).onclick = close; dlg.addEventListener('cancel', close); dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  $$('[data-view]', dlg).forEach(i => { i.onclick = () => viewPhoto(i.dataset.view); });
  const z = $('[data-zoom]', dlg); if (z) z.onclick = () => { const v = document.createElement('dialog'); v.className = 'viewer'; v.innerHTML = `<img src="${m.image}" alt="">`; v.onclick = () => { v.close(); v.remove(); }; document.body.appendChild(v); v.showModal(); };
  const ed = $('[data-ed]', dlg); if (ed) ed.onclick = () => { close(); materialForm(m, after); };
  dlg.showModal();
}
async function materialForm(m, after) {
  if (!MAT_ZONES) MAT_ZONES = (await api('GET', '/api/materials?q=%23none%23')).zones;
  m = m || {};
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog" novalidate><h2>${m.id ? t('Editar material') : t('Nuevo material')}</h2><div class="error"></div><div class="fields">
    <div class="field"><label>${t('Zona')} *</label><select name="zone">${MAT_ZONES.map(z => `<option value="${z.key}" ${z.key === (m.zone || 'ceiling') ? 'selected' : ''}>${esc(L(z))}</option>`).join('')}</select></div>
    <div class="field"><label>${t('Material')} *</label><input name="name" value="${esc(m.name || '')}" placeholder="${t('Ej. Tongue & groove pino, Granito, Stain')}"></div>
    <div class="field"><label>${t('Nombre del color')}</label><input name="color_name" value="${esc(m.color_name || '')}" placeholder="${t('Ej. Cedar, Absolute Black, Arctic White')}"></div>
    <div class="field"><label>${t('Color (muestra)')}</label><div class="row"><input type="color" name="color_hex" value="${esc(m.color_hex || '#8a6a4f')}"><label class="check small"><input type="checkbox" name="nohex" ${m.id && !m.color_hex ? 'checked' : ''}> ${t('Sin color')}</label></div></div>
    <div class="field"><label>${t('Marca')}</label><input name="brand" value="${esc(m.brand || '')}" placeholder="Sherwin-Williams, James Hardie…"></div>
    <div class="field"><label>${t('Tipo / línea')}</label><input name="kind" value="${esc(m.kind || '')}"></div>
    <div class="field"><label>${t('Acabado')}</label><input name="finish" value="${esc(m.finish || '')}" placeholder="${t('Mate, satinado, leather, semitransparente…')}"></div>
    <div class="field full"><label>${t('Foto de cerca (close-up)')}</label><input type="file" name="image" accept="image/*" capture="environment"><div class="hint">${t('Una foto de cerca de la muestra o del material instalado, con buena luz.')}</div></div>
    <div class="field full"><label>${t('Notas')}</label><textarea name="notes">${esc(m.notes || '')}</textarea></div></div>
    <div class="foot">${m.id && ME.role === 'owner' ? `<button type="button" class="danger" data-del style="margin-right:auto">${t('Borrar')}</button>` : ''}<button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Guardar')}</button></div></form>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  $('[data-x]', dlg).onclick = close; dlg.addEventListener('cancel', close);
  const del = $('[data-del]', dlg);
  if (del) del.onclick = async () => { if (!confirm(t('¿Seguro?'))) return; try { await api('DELETE', `/api/materials/${m.id}`); close(); after(); } catch (e) { $('.error', dlg).textContent = e.message; } };
  $('form', dlg).onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = $('button[type=submit]', dlg);
    try {
      btn.disabled = true;
      const body = { zone: f.zone.value, name: f.name.value.trim(), color_name: f.color_name.value.trim(), color_hex: f.nohex.checked ? '' : f.color_hex.value, brand: f.brand.value.trim(), kind: f.kind.value.trim(), finish: f.finish.value.trim(), notes: f.notes.value.trim() };
      if (!body.name) throw new Error(t('Falta: {x}', { x: t('Material') }));
      if (f.image.files[0]) body.image = await compressImage(f.image.files[0], 1400, 0.88);
      const r = m.id ? await api('PUT', `/api/materials/${m.id}`, body) : await api('POST', '/api/materials', body);
      close(); toast(t('Guardado')); after(r);
    } catch (err) { $('.error', dlg).textContent = err.message; btn.disabled = false; }
  };
  dlg.showModal();
}
async function pickMaterial(jobId, after) {
  const r = await api('GET', '/api/materials'); MAT_ZONES = r.zones;
  const dlg = document.createElement('dialog'); dlg.className = 'wide';
  dlg.innerHTML = `<div class="row between"><h2 style="margin:0">${t('Agregar material a la ficha')}</h2><button class="sm" data-x>✕</button></div>
    <div class="row wrap"><input id="pq" type="search" placeholder="${t('Buscar…')}" style="flex:1"><button id="pnew" class="primary">${t('+ Material nuevo')}</button></div>
    <div class="matgrid pick">${r.materials.map(m => `<button class="mat" data-id="${m.id}" data-s="${esc([m.name, m.color_name, m.brand, m.kind, zoneName(m.zone)].join(' ').toLowerCase())}">${swatch(m)}<div class="mat-txt"><b>${esc(matTitle(m))}</b><div class="small muted">${esc(zoneName(m.zone))} · ${esc(matSub(m))}</div></div></button>`).join('')}</div>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  const choose = async (mid, name) => {
    close();
    const v = await formDialog({ title: t('¿Dónde se usó? · {x}', { x: name }), fields: [{ name: 'area', label: t('Área'), hint: t('Ej. Ceiling del patio, Fascia, Cubierta de la isla') }, { name: 'note', label: t('Nota (cantidad, código, lote)') }],
      onSubmit: v => api('POST', `/api/jobs/${jobId}/materials`, { material_id: mid, ...v }) });
    if (v) after();
  };
  $('[data-x]', dlg).onclick = close; dlg.addEventListener('cancel', close);
  $('#pq', dlg).oninput = e => { const q = e.target.value.trim().toLowerCase(); $$('.mat', dlg).forEach(b => { b.hidden = q && !b.dataset.s.includes(q); }); };
  $$('.mat', dlg).forEach(b => { b.onclick = () => { const m = r.materials.find(x => x.id === Number(b.dataset.id)); choose(m.id, matTitle(m)); }; });
  $('#pnew', dlg).onclick = () => { close(); materialForm(null, nm => { if (nm && nm.id) choose(nm.id, matTitle(nm)); else after(); }); };
  dlg.showModal();
}
// Pestaña "Materiales" de la obra: ficha técnica por zona + qué fotos van a la galería.
async function tabMaterials(box, d, { id, reload }) {
  const [list, photos, zr] = await Promise.all([api('GET', `/api/jobs/${id}/materials`), api('GET', `/api/jobs/${id}/gallery`), MAT_ZONES ? null : api('GET', '/api/materials?q=%23none%23')]);
  if (zr) MAT_ZONES = zr.zones;
  const byZone = {};
  for (const x of list) (byZone[x.material.zone] ||= []).push(x);
  const nGal = photos.filter(p => p.gallery).length;
  box.innerHTML = `<div class="card"><div class="row between wrap"><h2 style="margin:0">🎨 ${t('Ficha de materiales')}</h2><button class="primary" id="addm">${t('+ Material')}</button></div>
      <p class="small muted">${t('El cliente ve esta ficha en su portal: qué material y color se usó en cada parte.')}</p>
      ${list.length ? Object.entries(byZone).map(([z, xs]) => `<h3>${esc(zoneName(z))}</h3>${xs.map(x => `<div class="specrow" data-jm="${x.jm_id}">${swatch(x.material)}<div style="flex:1;min-width:0"><b>${esc(matTitle(x.material))}</b>
        <div class="small muted">${esc(matSub(x.material))}</div>${x.area || x.note ? `<div class="small">${[x.area && esc(x.area), x.note && esc(x.note)].filter(Boolean).join(' · ')}</div>` : ''}</div>
        <button class="sm" data-see>${t('Ver')}</button><button class="sm danger" data-rm>✕</button></div>`).join('')}`).join('')
      : `<p class="empty">${t('Agregue el ceiling, la fascia, el stain o pintura, la cubierta de la cocina…')}</p>`}</div>
    <div class="card"><h2>🖼️ ${t('Galería de trabajos terminados')}</h2>
      <p class="small muted">${t('Al marcar la obra como Terminado, las fotos finales entran solas a la galería (y las que suba después). Aparecen en el catálogo de materiales, sin nombre ni dirección del cliente. Toque ★ para quitar o poner una foto.')}</p>
      <p class="small"><b>${t('{a} de {b} fotos en la galería', { a: nGal, b: photos.length })}</b></p>
      ${photos.length ? `<div class="photos gal">${photos.map(p => `<figure class="${p.gallery ? 'ing' : ''}"><img src="/files/${p.id}" data-view="${p.id}" alt="" loading="lazy">
        <button class="star ${p.gallery ? 'on' : ''}" data-g="${p.id}" title="${p.gallery ? t('Quitar de la galería') : t('Poner en la galería')}">★</button><figcaption>${esc(p.caption || '')} ${fdate(p.created_at.slice(0, 10))}</figcaption></figure>`).join('')}</div>`
      : `<p class="empty">${t('Sin fotos todavía.')}</p>`}</div>`;
  $('#addm', box).onclick = () => pickMaterial(id, reload);
  $$('[data-jm]', box).forEach(el => {
    const x = list.find(y => y.jm_id === Number(el.dataset.jm));
    $('[data-see]', el).onclick = () => materialDetail(x.material.id, reload);
    $('[data-rm]', el).onclick = async () => { if (await confirmDialog(t('¿Quitar {x} de la ficha?', { x: matTitle(x.material) }), t('Quitar'))) { await act(() => api('DELETE', `/api/job-materials/${x.jm_id}`), t('Quitado')); reload(); } };
  });
  $$('[data-view]', box).forEach(i => { i.onclick = () => viewPhoto(i.dataset.view); });
  $$('[data-g]', box).forEach(b => { b.onclick = async () => { const on = !b.classList.contains('on'); await act(() => api('PUT', `/api/files/${b.dataset.g}/gallery`, { gallery: on }), on ? t('En la galería') : t('Quitada de la galería')); tabMaterials(box, d, { id, reload }); }; });
}
// Portal del cliente: materiales de su proyecto.
async function clientMaterialsCard(app, j) {
  const list = await api('GET', `/api/jobs/${j.id}/materials`).catch(() => []);
  const c = document.createElement('div'); c.className = 'card';
  const portal = $('.portal', app) || app;
  const before = [...portal.children].find(x => x.tagName === 'P') || null;
  portal.insertBefore(c, before);
  c.innerHTML = `<div class="row between wrap"><h2 style="margin:0">🎨 ${t('Materiales de su proyecto')}</h2><a class="btn sm" href="#/materiales">${t('Ver catálogo de materiales')}</a></div>
    ${list.length ? `<div class="speclist">${list.map(x => `<button class="specrow" data-mid="${x.material.id}">${swatch(x.material)}<div style="flex:1;text-align:left"><div class="small muted">${esc(x.area || zoneName(x.material.zone))}</div><b>${esc(matTitle(x.material))}</b>
      <div class="small muted">${esc(matSub(x.material))}</div></div><span class="small">${t('Ver')} ›</span></button>`).join('')}</div>`
    : `<p class="small muted">${t('Aquí aparecerán los materiales y colores de su proyecto. Mientras, puede ver nuestro catálogo con fotos de trabajos terminados.')}</p>`}`;
  $$('[data-mid]', c).forEach(b => { b.onclick = () => materialDetail(Number(b.dataset.mid), () => {}); });
}
async function v2ClientCards(app, j) {
  await clientRatingCard(app, j).catch(e => console.error(e));
  await clientMaterialsCard(app, j).catch(e => console.error(e));
}

// =====================================================================
// RECUPERAR ACCESO
// =====================================================================
let LAST_PW = '';
async function forgotDialog() {
  const v = await formDialog({ title: t('Recuperar acceso'), submit: t('Pedir ayuda'),
    intro: t('Escriba su nombre, su usuario o su teléfono. Les llega un aviso a los dueños y le mandan una contraseña temporal por WhatsApp o mensaje.'),
    fields: [{ name: 'ident', label: t('Nombre, usuario o teléfono'), required: true }],
    onSubmit: v => api('POST', '/api/recover', v) });
  if (v) await formDialog({ title: t('¡Listo!'), submit: t('Entendido'), fields: [], onSubmit: async () => {},
    intro: t('Avisamos a los dueños. En cuanto lo vean le mandan su usuario y una contraseña temporal. La temporal dura 24 horas; al entrar le pedirá poner una nueva.') });
}
// Alguien que nunca ha tenido usuario: pide acceso y los dueños se lo crean.
async function newAccessDialog() {
  const v = await formDialog({ title: t('Pedir acceso a la app'), submit: t('Mandar pedido'),
    intro: t('Nadie se crea su propio usuario: lo crea un dueño de la empresa. Deje sus datos y le mandamos su usuario y una contraseña temporal por texto o WhatsApp.'),
    fields: [
      { name: 'name', label: t('Su nombre completo'), required: true },
      { name: 'phone', label: t('Su teléfono'), type: 'tel', required: true },
      { name: 'kind', label: t('¿Quién es usted?'), type: 'select', value: 'cliente', options: [['cliente', t('Cliente (tengo una obra con ustedes)')], ['trabajador', t('Trabajador o subcontratista')], ['oficina', t('Trabajo en la oficina / project manager')], ['otro', t('Otro')]] },
      { name: 'note', label: t('¿Algo más? (opcional)'), hint: t('Ej. la dirección de su obra o quién le dijo que pidiera acceso') },
    ], onSubmit: v => api('POST', '/api/access-new', v) });
  if (v) await formDialog({ title: t('¡Listo!'), submit: t('Entendido'), fields: [], onSubmit: async () => {},
    intro: t('Ya les avisamos a los dueños. En cuanto lo aprueben le llega por texto o WhatsApp su usuario y una contraseña temporal. Al entrar la primera vez, la app le pide poner su propia contraseña.') });
}
// Pantalla obligatoria al entrar con contraseña temporal.
function viewMustChange(app) {
  app.innerHTML = `<div class="login"><form class="card" id="mcf"><div class="row" style="justify-content:flex-end">${langButton()}</div>
    ${brandHtml('')}<h2>${t('Ponga su propia contraseña')}</h2>
    <p class="small muted">${t('Entró con una contraseña temporal. Escoja una nueva que solo usted sepa (mínimo 10 caracteres).')}</p>
    <div class="error" id="mce"></div>
    ${LAST_PW ? '' : `<div class="field"><label for="mt">${t('Contraseña temporal')}</label><input id="mt" type="password" autocomplete="current-password" required></div>`}
    <div class="field"><label for="m1">${t('Nueva contraseña')}</label><input id="m1" type="password" autocomplete="new-password" required></div>
    <div class="field"><label for="m2">${t('Repita la nueva contraseña')}</label><input id="m2" type="password" autocomplete="new-password" required></div>
    <button class="primary" style="width:100%;justify-content:center">${t('Guardar y entrar')}</button>
    <p style="text-align:center;margin:.8rem 0 0"><a href="#" id="mco" class="small">${t('Cerrar sesión')}</a></p></form></div>`;
  bindLang(app);
  $('#mco').onclick = e => { e.preventDefault(); logout(); };
  $('#mcf').onsubmit = async e => {
    e.preventDefault();
    const n1 = $('#m1').value, n2 = $('#m2').value;
    if (n1 !== n2) { $('#mce').textContent = t('Las dos contraseñas no son iguales'); return; }
    try {
      await api('POST', '/api/me/password', { current: LAST_PW || $('#mt').value, password: n1 });
      LAST_PW = ''; toast(t('Contraseña guardada')); location.hash = '#/'; boot();
    } catch (err) { $('#mce').textContent = err.message; }
  };
}
// Mostrar la contraseña temporal y mandarla por WhatsApp o mensaje, en el idioma de la persona.
async function showTempAccess(r) {
  const u = r.user, lang = u.lang || 'es';
  const msg = r.invite
    ? tl(lang, 'Hola {n}, ya tiene acceso a la app de {co}. Ábrala aquí: {url} · Usuario: {u} · Contraseña temporal: {p} (vale 7 días). Al entrar la primera vez le pedirá poner su propia contraseña.', { n: u.name.split(' ')[0], co: COMPANY.name, url: location.origin, u: u.username, p: r.temp })
    : tl(lang, 'Hola {n}, este es su acceso a la app de Elevated Exteriors: {url} · Usuario: {u} · Contraseña temporal: {p} (vale 24 horas). Al entrar le pedirá poner una nueva.', { n: u.name.split(' ')[0], url: location.origin, u: u.username, p: r.temp });
  if (BOSS() && !SMSST) await loadSmsStatus();
  const canSms = u.phone && SMSST && SMSST.enabled;
  await formDialog({ title: r.invite ? t('Mándele su acceso a {x}', { x: u.name }) : t('Acceso temporal para {x}', { x: u.name }), submit: t('Listo'), fields: [], onSubmit: async () => {},
    intro: `<div class="tempbox"><div><span class="muted small">${t('Usuario')}</span><b>${esc(u.username)}</b></div><div><span class="muted small">${t('Contraseña temporal')}</span><b class="mono">${esc(r.temp)}</b></div></div>
      <p class="small muted">${r.invite ? t('Vale 7 días. Al entrar la primera vez, la app le pide poner su propia contraseña; usted nunca la sabrá. Si se le vence, dele otra desde Equipo y accesos → ✎ → Contraseña temporal.') : t('Vale 24 horas. Al entrar, la app le pedirá poner su propia contraseña. Sus sesiones abiertas se cerraron.')}</p>
      <div class="card small" style="white-space:pre-wrap">${esc(msg)}</div>
      <p class="row wrap">${canSms ? `<button type="button" class="btn primary" id="sendacc" data-uid="${u.id}">💬 ${t('Mandar por texto desde la app')}</button>` : ''}${u.phone ? `<a class="btn${canSms ? '' : ' primary'}" target="_blank" rel="noopener" href="${waLink(u.phone, msg)}">WhatsApp</a><a class="btn" href="sms:${esc(u.phone.replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(msg)}">SMS</a>` : `<span class="small">${t('Esta persona no tiene teléfono guardado: dígaselo en persona o por llamada.')}</span>`}
      <button type="button" class="btn" id="cpy">${t('Copiar mensaje')}</button></p>` });
}
document.addEventListener('click', async e => {
  const b = e.target && e.target.closest && e.target.closest('#sendacc'); if (!b) return;
  const box = b.closest('dialog').querySelector('.card.small'); b.disabled = true;
  try { await api('POST', '/api/sms/send', { user_id: Number(b.dataset.uid), body: box.textContent, translate: false }); b.textContent = '✅ ' + t('Mandado'); toast(t('Mandado')); }
  catch (err) { b.disabled = false; toast(err.message, true); }
});
document.addEventListener('click', e => { if (e.target && e.target.id === 'cpy') { const box = e.target.closest('dialog').querySelector('.card.small'); navigator.clipboard && navigator.clipboard.writeText(box.textContent).then(() => toast(t('Copiado'))); } });
async function accessRequestsCard(box, after) {
  if (!ME || ME.role !== 'owner') { box.remove(); return; }
  const list = await api('GET', '/api/access-requests');
  if (!list.length) { box.remove(); return; }
  const users = list.some(r => !r.user) ? await api('GET', '/api/users') : [];
  box.className = 'card notices';
  const KIND = { cliente: t('Cliente'), trabajador: t('Trabajador o sub'), oficina: t('Oficina / PM'), otro: t('Otro') };
  box.innerHTML = `<h2>🔑 ${t('Piden acceso a la app')}</h2>${list.map(r => r.kind && !r.user ? `<div class="accreq" data-id="${r.id}" data-new><div style="flex:1;min-width:0">
      <b>${esc(r.ident)}</b> <span class="badge b-en_progreso">${t('Nuevo')}</span> <span class="small muted">· ${esc(KIND[r.kind] || r.kind)} · ${esc(r.phone)}</span>
      ${r.note ? `<div class="small">“${esc(r.note)}”</div>` : ''}<div class="small muted">${t('Nunca ha tenido usuario')} · ${esc(fdate(r.created_at.slice(0, 10)))}</div></div>
      <button class="primary sm" data-create>${t('Crear usuario')}</button><button class="sm" data-no>${t('Descartar')}</button></div>`
    : `<div class="accreq" data-id="${r.id}"><div style="flex:1;min-width:0">
      ${r.user ? `<b>${esc(r.user.name)}</b> <span class="small muted">· ${t('usuario')} <b>${esc(r.user.username)}</b> · ${esc(ROLE()[r.user.role] || r.user.role)}</span>`
        : `<b>“${esc(r.ident)}”</b> <span class="small muted">· ${t('No sabemos quién es: elija la persona')}</span> <select data-u><option value="">—</option>${users.filter(u => u.active).map(u => `<option value="${u.id}">${esc(u.name)} (${esc(u.username)})</option>`).join('')}</select>`}
      <div class="small muted">${t('Escribió: “{x}”', { x: esc(r.ident) })} · ${esc(fdate(r.created_at.slice(0, 10)))}</div></div>
      <button class="primary sm" data-give>${t('Dar contraseña temporal')}</button><button class="sm" data-no>${t('Descartar')}</button></div>`).join('')}
    <p class="small muted">${t('Si no reconoce el pedido, descártelo. La pantalla de entrada nunca dice si un usuario existe.')}</p>`;
  $$('[data-id]', box).forEach(el => {
    const id = el.dataset.id;
    if (el.hasAttribute('data-new')) {
      const r = list.find(x => String(x.id) === id);
      $('[data-create]', el).onclick = async () => {
        const first = r.ident.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').split(/\s+/);
        const made = await newUserDialog({ request_id: r.id, name: r.ident, phone: r.phone, username: first.length > 1 ? first[0] + '.' + first[first.length - 1][0] : first[0],
          role: { cliente: 'client', trabajador: 'worker', oficina: 'pm' }[r.kind] || 'worker', lang: r.kind === 'cliente' ? 'en' : 'es',
          intro: `<p class="small muted">${t('Revise que sea quien dice ser antes de darle acceso. A un cliente, después ábrale su obra: en la obra, tarjeta “Acceso del cliente”.')}</p>` });
        if (made) after();
      };
      $('[data-no]', el).onclick = async () => { await act(() => api('POST', `/api/access-requests/${id}/dismiss`), t('Descartado')); after(); };
      return;
    }
    $('[data-give]', el).onclick = async () => {
      const sel = $('[data-u]', el);
      if (sel && !sel.value) { toast(t('Elija a qué persona le da el acceso'), true); return; }
      try { const r = await api('POST', `/api/access-requests/${id}/temp`, sel ? { user_id: Number(sel.value) } : {}); await showTempAccess(r); after(); } catch (err) { toast(err.message, true); }
    };
    $('[data-no]', el).onclick = async () => { await act(() => api('POST', `/api/access-requests/${id}/dismiss`), t('Descartado')); after(); };
  });
}

// =====================================================================
// EMPRESAS (Elevated Exteriors / JKL Homes): cada una con su propia información
// =====================================================================
let COMPANY = { key: 'ee', name: 'Elevated Exteriors', logo: true };
let COMPANIES = [];
function brandHtml(cls) {
  return COMPANY.logo ? `<img class="${cls}" src="/brand/ee-logo.png" alt="${esc(COMPANY.name)}">` : `<div class="wordmark ${cls ? 'wm-' + cls : ''}">${esc(COMPANY.name)}</div>`;
}
function companySwitcher(compact) {
  if (!ME || COMPANIES.length < 2) return '';
  const usable = COMPANIES.filter(c => c.signed_in || (ME.role === 'owner' && c.empty));
  if (usable.length < 2) return '';
  return `<button class="cosw ${compact ? 'sm' : ''}" data-cosw title="${t('Cambiar de empresa')}">🏢 ${compact ? '' : esc(COMPANY.name) + ' '}▾</button>`;
}
async function companySheet() {
  const d = document.createElement('dialog'); d.className = 'sheet cosheet';
  d.innerHTML = `<div class="grab"></div><h2>${t('Empresa')}</h2><p class="small muted">${t('Cada empresa tiene su propia información: obras, clientes, subs, dinero y reportes no se mezclan.')}</p>
    <div class="sheet-list">${COMPANIES.map(c => `<button data-k="${c.key}" ${c.current ? 'class="on"' : ''}><b>${esc(c.name)}</b>
      <span class="small muted">${c.current ? '✓ ' + t('Aquí está ahora') : c.signed_in ? t('Entrar') : c.empty && ME.role === 'owner' ? t('Activar: copiar a los dueños') : t('Pedirá su usuario y contraseña')}</span></button>`).join('')}</div>
    <button data-x>${t('Cerrar')}</button>`;
  document.body.appendChild(d);
  const close = () => { d.close(); d.remove(); };
  $('[data-x]', d).onclick = close; d.addEventListener('cancel', close); d.addEventListener('click', e => { if (e.target === d) close(); });
  $$('[data-k]', d).forEach(b => { b.onclick = async () => {
    const c = COMPANIES.find(x => x.key === b.dataset.k);
    if (c.current) return close();
    try {
      if (c.empty && ME.role === 'owner') {
        if (!(await confirmDialog(t('Se activará {x} con los mismos dueños (mismo usuario y contraseña). Empieza vacía: sin obras, clientes ni subs de la otra empresa.', { x: c.name }), t('Activar')))) return;
        await api('POST', `/api/companies/${c.key}/activate`);
      } else await api('POST', '/api/companies/switch', { key: c.key });
      location.hash = '#/'; location.reload();
    } catch (err) { toast(err.message, true); }
  }; });
  d.showModal();
}

// =====================================================================
// PARTIDAS, MARGEN Y REPARTO DE GANANCIA
// =====================================================================
let FIN_ALERT = 35;
const pctTxt = v => v == null ? '—' : v + '%';
async function tabLines(box, d, { id, reload }) {
  const r = await api('GET', `/api/jobs/${id}/lines`);
  FIN_ALERT = r.alert_pct;
  const low = l => l.sold_total_cents > 0 && (l.margin_cents < 0 || (l.margin_pct ?? 100) < r.alert_pct);
  const U = r.unassigned;
  box.innerHTML = `<div class="card"><div class="row between wrap"><div><h2 style="margin:0">🧾 ${t('Partidas: lo que se vendió')}</h2>
      <div class="small muted">${t('Costo = lo gastado en la partida + lo que falta pagar a sus subs. Margen en rojo si baja de {x}%.', { x: r.alert_pct })}</div></div>
      <button class="primary" id="addl">${t('+ Partida')}</button></div>
    ${r.lines.length ? `<div class="table-wrap"><table class="lines"><thead><tr><th>${t('Código')}</th><th>${t('Partida')}</th><th>${t('Cuadrilla')}</th><th class="num">${t('Vendido')}</th><th class="num">${t('Gastado')}</th><th class="num">${t('Falta a subs')}</th><th class="num">${t('Costo')}</th><th class="num">${t('Margen')}</th><th class="num">%</th><th></th></tr></thead><tbody>
      ${r.lines.map(l => `<tr class="${low(l) ? 'lowrow' : ''}" data-l="${l.id}"><td><b>${esc(l.code)}</b></td><td>${esc(l.trade)}${l.pass_through ? ` <span class="badge b-pendiente" title="${t('Se le cobra al cliente lo que cueste de verdad')}">${t('pase directo')}</span>` : ''}
          ${l.description ? `<div class="small muted ldesc">${esc(l.description.slice(0, 160))}${l.description.length > 160 ? '…' : ''}</div>` : ''}${l.subs.length ? `<div class="small">👷 ${l.subs.map(s => esc(s.name)).join(', ')}</div>` : ''}</td>
        <td class="small">${esc(l.crew || '')}</td><td class="num">${fmt0(l.sold_total_cents)}${l.change_orders_cents ? `<div class="small muted">+${fmt0(l.change_orders_cents)} CO</div>` : ''}</td>
        <td class="num">${fmt0(l.spent_cents)}</td><td class="num">${l.committed_cents ? fmt0(l.committed_cents) : '—'}</td><td class="num"><b>${fmt0(l.cost_cents)}</b></td>
        <td class="num ${l.margin_cents < 0 ? 'neg' : ''}"><b>${fmt0(l.margin_cents)}</b></td><td class="num ${low(l) ? 'neg' : ''}">${pctTxt(l.margin_pct)}${l.sold_total_cents && !l.cost_cents ? `<div class="small muted">${t('sin costos aún')}</div>` : ''}</td>
        <td><button class="sm" data-ed>✎</button></td></tr>`).join('')}
      <tr class="total"><td></td><td><b>${t('Total partidas')}</b></td><td></td><td class="num"><b>${fmt0(r.totals.sold_cents)}</b></td><td></td><td></td><td class="num"><b>${fmt0(r.totals.cost_cents)}</b></td><td class="num"><b>${fmt0(r.totals.margin_cents)}</b></td><td class="num"><b>${pctTxt(r.totals.margin_pct)}</b></td><td></td></tr>
      </tbody></table></div>` : `<p class="empty">${t('Agregue lo que se vendió: patio cover, attachment, electricidad, cocina… o impórtelo desde su libro de Excel (Obras → Importar).')}</p>`}
    ${r.lines.length && r.totals.diff_cents ? `<p class="small ${Math.abs(r.totals.diff_cents) > 100 ? 'neg' : ''}">⚠️ ${t('El contrato es {a} y las partidas suman {b}: diferencia de {c}.', { a: fmt0(r.totals.contract_cents), b: fmt0(r.totals.sold_cents), c: fmt0(r.totals.diff_cents) })}</p>` : ''}
    <p class="small muted">${t('Costo y margen de la obra incluyen lo que no tiene partida.')}</p></div>
  ${U.expenses.length || U.subs.length ? `<div class="card notices"><h2>📌 ${t('Sin partida')} · ${fmt0(U.cost_cents)}</h2><p class="small muted">${t('Asigne cada gasto o sub a su partida para ver el margen real de cada cosa vendida.')}</p>
    ${U.subs.map(s => `<div class="assign" data-sub="${s.id}"><div style="flex:1"><b>👷 ${esc(s.name)}</b> <span class="small muted">${esc(s.trade || '')} · ${t('acordado')} ${fmt0(s.agreed_cents)}</span></div>${lineSelect(r.lines)}</div>`).join('')}
    ${U.expenses.slice(0, 60).map(e => `<div class="assign" data-exp="${e.id}"><div style="flex:1"><b>${fmt0(e.amount_cents)}</b> <span class="small">${esc(e.description)}</span> <span class="small muted">${esc(e.vendor || '')} · ${fdate(e.date)}</span></div>${lineSelect(r.lines)}</div>`).join('')}
    ${U.expenses.length > 60 ? `<p class="small muted">${t('Y {n} más…', { n: U.expenses.length - 60 })}</p>` : ''}</div>` : ''}`;
  $('#addl', box).onclick = () => lineDialog(id, null, reload);
  $$('[data-l]', box).forEach(tr => { $('[data-ed]', tr).onclick = () => lineDialog(id, r.lines.find(l => l.id === Number(tr.dataset.l)), reload); });
  $$('[data-sub] select, [data-exp] select', box).forEach(sel => { sel.onchange = async () => {
    const row = sel.closest('.assign'); if (!sel.value) return;
    const url = row.dataset.sub ? `/api/subs/${row.dataset.sub}/line` : `/api/expenses/${row.dataset.exp}/line`;
    await act(() => api('PUT', url, { line_id: Number(sel.value) }), t('Asignado')); tabLines(box, d, { id, reload });
  }; });
}
const lineSelect = lines => `<select aria-label="${t('Partida')}"><option value="">${t('Elegir partida…')}</option>${lines.map(l => `<option value="${l.id}">${esc(l.code)} · ${esc(l.trade)}</option>`).join('')}</select>`;
async function lineDialog(jobId, l, after) {
  l = l || {};
  const v = await formDialog({ title: l.id ? t('Editar partida {x}', { x: l.code }) : t('Nueva partida'), submit: t('Guardar'), fields: [
    { name: 'trade', label: t('Partida (lo que se vendió)'), required: true, value: l.trade, hint: t('Ej. PATIO COVER, ATTACHMENT, ELECTRICAL, OUTDOOR KITCHEN') },
    { name: 'code', label: t('Código'), value: l.code, hint: t('Si lo deja vacío, se pone solo (ej. PATIO-01)') },
    { name: 'crew', label: t('Cuadrilla (quién lo construye)'), value: l.crew },
    { name: 'sold_cents', label: t('Vendido ($)'), type: 'money', value: centsToInput(l.sold_cents || 0) },
    { name: 'est_cost_cents', label: t('Costo estimado ($, opcional)'), type: 'money', value: centsToInput(l.est_cost_cents || 0) },
    { name: 'status', label: t('Estado'), type: 'select', value: l.status || 'pendiente', options: [['pendiente', t('Pendiente')], ['activo', t('En proceso')], ['terminado', t('Terminado')]] },
    { name: 'pass_through', label: t('Pase directo: se le cobra al cliente lo que cueste de verdad (ej. sprinklers)'), type: 'check', value: !!l.pass_through },
    { name: 'description', label: t('Descripción'), type: 'textarea', value: l.description },
  ], extraButton: l.id ? { label: t('Borrar'), danger: true, onClick: () => api('DELETE', `/api/lines/${l.id}`) } : null,
  onSubmit: v => l.id ? api('PUT', `/api/lines/${l.id}`, v) : api('POST', `/api/jobs/${jobId}/lines`, v) });
  if (v) after();
}
// Reparto de ganancia de la obra (solo dueños).
async function splitStrip(box, jobId) {
  if (!box) return;
  const s = await api('GET', `/api/jobs/${jobId}/split`);
  box.className = 'card split';
  box.innerHTML = `<div class="row between wrap"><div class="small"><b>🤝 ${t('Reparto de ganancia')}</b> · ${s.basis === 'real' ? t('ganancia real') : t('ganancia proyectada')} ${fmt0(s.base_cents)}${s.custom ? ` · <span class="badge b-pendiente">${t('especial en esta obra')}</span>` : ''}</div>
    <button class="sm" id="spe">${t('Cambiar en esta obra')}</button></div>
    <div class="row wrap split-shares">${s.shares.map(x => `<div><span class="small muted">${esc(x.name)} · ${x.pct}%</span><b class="${x.cents < 0 ? 'neg' : ''}">${fmt0(x.cents)}</b></div>`).join('')}</div>`;
  $('#spe', box).onclick = () => splitDialog(s.split, s.custom, v => api('PUT', `/api/jobs/${jobId}/split`, { split: v }), () => splitStrip(box, jobId), true);
}
async function splitDialog(split, custom, save, after, perJob) {
  const rows = split.map(x => ({ ...x }));
  const dlg = document.createElement('dialog');
  const draw = () => {
    const sum = Math.round(rows.reduce((a, x) => a + (Number(x.pct) || 0), 0) * 100) / 100;
    dlg.innerHTML = `<form method="dialog" novalidate><h2>${perJob ? t('Reparto de esta obra') : t('Reparto normal de ganancias')}</h2><div class="error"></div>
      <p class="small muted">${perJob ? t('Solo para esta obra. Para volver al reparto normal, use “Usar el normal”.') : t('Se usa en todas las obras que no tengan uno especial. Si contratan un PM con porcentaje, agréguelo aquí.')}</p>
      ${rows.map((x, i) => `<div class="row splitrow" data-i="${i}"><input data-k="name" value="${esc(x.name)}" placeholder="${t('Nombre')}"><input data-k="pct" type="number" step="0.5" min="0" max="100" value="${x.pct}" style="width:6rem"><span>%</span><button type="button" class="sm danger" data-rm>✕</button></div>`).join('')}
      <button type="button" class="sm" id="adds">${t('+ Persona')}</button>
      <p class="${sum === 100 ? 'pos' : 'neg'}"><b>${t('Total')}: ${sum}%</b>${sum === 100 ? '' : ' · ' + t('debe sumar 100%')}</p>
      <div class="foot">${perJob && custom ? `<button type="button" id="norm" style="margin-right:auto">${t('Usar el normal')}</button>` : ''}<button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Guardar')}</button></div></form>`;
    const read = () => $$('.splitrow', dlg).forEach(el => { const x = rows[Number(el.dataset.i)]; x.name = $('[data-k=name]', el).value; x.pct = Number($('[data-k=pct]', el).value); });
    $$('.splitrow input', dlg).forEach(inp => { inp.onchange = () => { read(); draw(); }; });
    $$('[data-rm]', dlg).forEach(b => { b.onclick = () => { read(); rows.splice(Number(b.closest('.splitrow').dataset.i), 1); draw(); }; });
    $('#adds', dlg).onclick = () => { read(); rows.push({ name: '', pct: 0 }); draw(); };
    $('[data-x]', dlg).onclick = close;
    if ($('#norm', dlg)) $('#norm', dlg).onclick = async () => { await save(null); close(); after(); };
    $('form', dlg).onsubmit = async e => { e.preventDefault(); read(); try { await save(rows); close(); toast(t('Guardado')); after(); } catch (err) { $('.error', dlg).textContent = err.message; } };
  };
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', close);
  document.body.appendChild(dlg); draw(); dlg.showModal();
}
// Inicio del dueño: obras con margen bajo, partidas en negativo y márgenes sospechosos (faltan costos).
async function marginAlertsCard(box) {
  const r = await api('GET', '/api/margin-alerts').catch(() => null);
  if (!r || !r.jobs.length) { box.remove(); return; }
  FIN_ALERT = r.alert_pct;
  box.className = 'card notices';
  box.innerHTML = `<h2>📉 ${t('Margen: revisar')}</h2>${r.jobs.slice(0, 12).map(j => `<div class="malert"><a href="#/obra/${j.id}/partidas"><b>${esc(j.client_name)}</b></a> <span class="badge b-${j.status}">${statusLabel(j.status)}</span>
      <span class="${j.low ? 'neg' : ''}"><b>${pctTxt(j.margin_pct)}</b></span>
      <div class="small">${[j.low && t('Margen bajo (menos de {x}%)', { x: r.alert_pct }), j.suspicious && t('Margen demasiado alto: probablemente faltan costos por anotar'),
        j.negative_lines.length && t('Partidas en negativo: {x}', { x: j.negative_lines.map(l => `${l.code} ${fmt0(l.margin_cents)}${l.pass_through ? ' (' + t('pase directo: cobrar al cliente') + ')' : ''}`).join(', ') })].filter(Boolean).join(' · ')}</div></div>`).join('')}`;
}
// Reportes: margen por oficio, reparto de ganancias y configuración.
async function financeReports(app, year) {
  if (ME.role !== 'owner') return;
  const [tr, sp, fs] = await Promise.all([api('GET', `/api/reports/trades?year=${year}`), api('GET', `/api/reports/split?year=${year}`), api('GET', '/api/settings/finance')]);
  const c = document.createElement('div'); app.appendChild(c);
  const maxS = Math.max(1, ...tr.rows.map(r => r.sold_cents));
  c.innerHTML = `<div class="card"><h2>🔨 ${t('Margen por oficio')}</h2><p class="small muted">${t('Todas las partidas de las obras activas y terminadas del año. En rojo, los oficios con margen menor a {x}%.', { x: tr.alert_pct })}</p>
      ${tr.rows.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Oficio')}</th><th class="num">${t('Obras')}</th><th class="num">${t('Vendido')}</th><th class="num">${t('Costo')}</th><th class="num">${t('Margen')}</th><th class="num">%</th></tr></thead><tbody>
      ${tr.rows.map(r => `<tr class="${r.flag === 'bajo' ? 'lowrow' : ''}"><td><b>${esc(r.trade)}</b><div class="bar" style="margin-top:.3rem"><span style="width:${r.sold_cents * 100 / maxS}%"></span></div></td><td class="num">${r.jobs}</td><td class="num">${fmt0(r.sold_cents)}</td><td class="num">${fmt0(r.cost_cents)}</td><td class="num ${r.margin_cents < 0 ? 'neg' : ''}">${fmt0(r.margin_cents)}</td><td class="num ${r.flag === 'bajo' ? 'neg' : ''}"><b>${pctTxt(r.margin_pct)}</b></td></tr>`).join('')}</tbody></table></div>`
      : `<p class="empty">${t('Todavía no hay partidas. Agréguelas en cada obra o importe sus libros de Excel.')}</p>`}</div>
    <div class="card"><div class="row between wrap"><h2 style="margin:0">🤝 ${t('Reparto de ganancias {y}', { y: year })}</h2><button class="sm" id="cfgs">${t('Reparto normal y alerta de margen')}</button></div>
      <p class="small muted">${t('Normal: {x}. Alerta de margen: {p}%. Obras terminadas: ganancia real; obras activas: proyectada.', { x: fs.profit_split.map(x => `${esc(x.name)} ${x.pct}%`).join(' · '), p: fs.margin_alert_pct })}</p>
      <div class="money-strip">${sp.totals.map(x => `<div><span>${esc(x.name)}</span><b>${fmt0(x.real_cents)}</b><span class="small">${x.projected_cents ? t('+ {m} proyectado', { m: fmt0(x.projected_cents) }) : ''}</span></div>`).join('') || `<div><span>—</span><b>—</b></div>`}</div>
      ${sp.rows.length ? `<details style="margin-top:.6rem"><summary class="small">${t('Ver por obra ({n})', { n: sp.rows.length })}</summary><div class="table-wrap"><table><thead><tr><th>${t('Obra')}</th><th class="num">${t('Contrato')}</th><th class="num">${t('Ganancia')}</th><th class="num">%</th>${(sp.rows[0].shares || []).map(x => `<th class="num">${esc(x.name)}</th>`).join('')}</tr></thead><tbody>
        ${sp.rows.map(r => `<tr><td><a href="#/obra/${r.id}">${esc(r.client_name)}</a> <span class="small muted">${r.basis === 'real' ? t('real') : t('proyectada')}${r.custom ? ' · ' + t('especial') : ''}</span></td><td class="num">${fmt0(r.contract_cents)}</td><td class="num ${r.profit_cents < 0 ? 'neg' : ''}">${fmt0(r.profit_cents)}</td><td class="num">${pctTxt(r.margin_pct)}</td>${r.shares.map(x => `<td class="num">${fmt0(x.cents)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : ''}</div>`;
  $('#cfgs', c).onclick = async () => {
    const v = await formDialog({ title: t('Alerta de margen'), fields: [{ name: 'margin_alert_pct', label: t('Avisar cuando el margen baje de (%)'), type: 'number', value: String(fs.margin_alert_pct), required: true }],
      onSubmit: v => api('PUT', '/api/settings/finance', { margin_alert_pct: Number(v.margin_alert_pct) }) });
    if (v !== null) splitDialog(fs.profit_split, false, rows => api('PUT', '/api/settings/finance', { profit_split: rows }), () => { c.remove(); financeReports(app, year); });
  };
}

// =====================================================================
// IMPORTAR LIBROS DE EXCEL (uno por obra)
// =====================================================================
async function importDialog(after) {
  const dlg = document.createElement('dialog'); dlg.className = 'wide';
  dlg.innerHTML = `<div class="row between"><h2 style="margin:0">📥 ${t('Importar obras desde Excel')}</h2><button class="sm" data-x>✕</button></div>
    <p class="small muted">${t('Use los libros de cada obra (PROJECT_INFO, TRADES/SCOPE, MATERIALS, SUBCONTRACTORS…). En Google Sheets: Archivo → Descargar → Microsoft Excel (.xlsx). Puede elegir varios a la vez. Primero verá un resumen; nada se guarda hasta que toque Importar.')}</p>
    <div class="row wrap"><button class="primary" id="xdrive" hidden>📁 ${t('Elegir de Google Drive')}</button>
      <label class="btn">💻 ${t('Subir de mi computadora')}<input type="file" id="xf" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple hidden></label></div>
    <p class="small muted" id="xdoff" hidden>${t('Para elegir los libros directo de Google Drive, un dueño conecta Drive en Mi cuenta → Google Drive.')}</p>
    <div id="xdb"></div><div id="xp"></div>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  const done = () => { close(); if (location.hash === '#/obras') after(); };
  $('[data-x]', dlg).onclick = done; dlg.addEventListener('cancel', done);
  dlg.addEventListener('click', e => { if (e.target.closest && e.target.closest('.ximp a')) close(); });
  api('GET', '/api/import/drive/status').then(st => { if (st.enabled) $('#xdrive', dlg).hidden = false; else $('#xdoff', dlg).hidden = false; }).catch(() => {});
  $('#xdrive', dlg).onclick = () => driveBrowser($('#xdb', dlg), $('#xp', dlg), '');
  $('#xf', dlg).onchange = async e => {
    const box = $('#xp', dlg); box.innerHTML = '';
    for (const f of e.target.files) {
      const c = document.createElement('div'); c.className = 'card ximp'; box.appendChild(c);
      c.innerHTML = `<b>${esc(f.name)}</b> <span class="small muted">${t('Leyendo…')}</span>`;
      try {
        const file = await readAnyFile(f);
        const p = await api('POST', '/api/import/xlsx/preview', { file, name: f.name });
        drawPreview(c, f.name, file, p);
      } catch (err) { c.innerHTML = `<b>${esc(f.name)}</b><div class="neg">${esc(err.message)}</div>`; }
    }
  };
  dlg.showModal();
}
// Explorador de Google Drive dentro de "Importar": carpetas, buscar, elegir varios libros.
async function driveBrowser(box, out, folder, q) {
  box.innerHTML = `<div class="card small muted">${t('Leyendo Google Drive…')}</div>`;
  let r;
  try { r = await api('GET', `/api/import/drive/files?${new URLSearchParams({ folder: folder || '', q: q || '' })}`); }
  catch (err) { box.innerHTML = `<div class="card neg small">${esc(err.message)}</div>`; return; }
  const up = r.folder && r.folder.id !== r.root && r.folder.parent ? r.folder.parent : (r.folder && r.folder.id !== r.root && r.root ? r.root : null);
  box.innerHTML = `<div class="card drive"><div class="row between wrap"><b>📁 ${esc(q ? t('Resultados para “{x}”', { x: q }) : (r.folder && r.folder.name) || t('Compartido con la app'))}</b>
      <form class="row" id="dq"><input id="dqi" placeholder="${t('Buscar por nombre…')}" value="${esc(q || '')}" style="max-width:220px"><button class="sm">${t('Buscar')}</button></form></div>
    ${up || q ? `<a href="#" class="small" data-up="${esc(up || '')}">← ${t('Atrás')}</a>` : ''}
    <div class="drive-list">${r.files.length ? r.files.map(x => x.kind === 'folder'
      ? `<a href="#" class="drive-row" data-folder="${esc(x.id)}">📁 <span>${esc(x.name)}</span></a>`
      : `<label class="drive-row check"><input type="checkbox" data-file="${esc(x.id)}" data-name="${esc(x.name)}" ${x.imported ? 'disabled' : ''}> ${x.kind === 'sheet' ? '🟩' : '📗'} <span>${esc(x.name)}</span>
         <span class="small muted">${x.imported ? '✓ ' + t('ya importado') : esc(fdate(String(x.modified || '').slice(0, 10)))}</span></label>`).join('')
      : `<p class="empty small">${t('No hay libros aquí. Revise que la carpeta esté compartida con la cuenta de la app.')}</p>`}</div>
    <button class="primary" id="dgo" disabled>${t('Revisar los seleccionados')}</button></div>`;
  $$('[data-folder]', box).forEach(a => { a.onclick = e => { e.preventDefault(); driveBrowser(box, out, a.dataset.folder); }; });
  $$('[data-up]', box).forEach(a => { a.onclick = e => { e.preventDefault(); driveBrowser(box, out, a.dataset.up); }; });
  $('#dq', box).onsubmit = e => { e.preventDefault(); driveBrowser(box, out, folder, $('#dqi', box).value.trim()); };
  const sel = () => $$('[data-file]', box).filter(x => x.checked);
  $$('[data-file]', box).forEach(x => { x.onchange = () => { $('#dgo', box).disabled = !sel().length; }; });
  $('#dgo', box).onclick = async () => {
    for (const x of sel()) {
      const c = document.createElement('div'); c.className = 'card ximp'; out.appendChild(c);
      c.innerHTML = `<b>${esc(x.dataset.name)}</b> <span class="small muted">${t('Leyendo…')}</span>`;
      try {
        const d = await api('GET', `/api/import/drive/file/${encodeURIComponent(x.dataset.file)}`);
        const p = await api('POST', '/api/import/xlsx/preview', { file: d.file, name: d.name, drive_id: d.id });
        drawPreview(c, d.name, d.file, p, d.id);
      } catch (err) { c.innerHTML = `<b>${esc(x.dataset.name)}</b><div class="neg">${esc(err.message)}</div>`; }
      x.checked = false; x.disabled = true;
    }
    $('#dgo', box).disabled = true;
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}
async function driveSettingsCard(app) {
  const st = await api('GET', '/api/import/drive/status').catch(() => ({ enabled: false }));
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h2>📁 ${t('Google Drive')}</h2><p>${st.enabled ? `<span class="badge b-hecho">${t('Conectado')}</span>` : `<span class="badge b-pendiente">${t('No conectado')}</span>`}${st.bad_json ? ` <span class="neg small">${t('La llave de Google está mal pegada: copie el archivo .json completo.')}</span>` : ''}</p>
    ${st.enabled ? `<p class="small">${t('Comparta con este correo (como Lector) la carpeta de Drive donde están los libros de cada obra:')}</p>
      <div class="card small mono" style="word-break:break-all" id="drvm">${esc(st.email)}</div><p><button class="btn sm" id="cpdrv">${t('Copiar correo')}</button></p>
      <p class="small muted">${t('Después, en Obras → Importar → Elegir de Google Drive. La app solo lee: nunca cambia ni borra nada en su Drive.')}</p>`
    : `<p class="small muted">${t('Para elegir los libros de Excel / Google Sheets directo de su Drive: cree una cuenta de servicio en Google Cloud, baje su llave .json y péguela completa en Render → Environment como GOOGLE_SERVICE_ACCOUNT_JSON. Los pasos están en la guía.')}</p>`}`;
  app.appendChild(c);
  if ($('#cpdrv', c)) $('#cpdrv', c).onclick = () => navigator.clipboard && navigator.clipboard.writeText(st.email).then(() => toast(t('Copiado')));
}
function drawPreview(c, name, file, p, driveId) {
  const J = p.job;
  const subRow = s => `<label class="check small subrow"><input type="checkbox" data-row="${s.row}" ${s.paid_in_full ? 'checked' : ''} ${s.paid_cents >= s.agreed_cents ? 'disabled checked' : ''}>
    <span><b>${esc(s.name)}</b> ${s.code ? `<span class="muted">${esc(s.code)}</span>` : ''} · ${t('acordado')} ${fmt0(s.agreed_cents)}${s.paid_cents ? ` · ${t('pagado')} ${fmt0(s.paid_cents)}` : ''}
    ${s.notes ? `<span class="muted"> — ${esc(s.notes.slice(0, 90))}</span>` : ''}${s.maybe_paid ? ` <span class="badge b-pendiente">${t('¿pagado?')}</span>` : ''}</span></label>`;
  c.innerHTML = `<div class="row between wrap"><div><b>${esc(J.client_name)}</b> <span class="small muted">${esc(J.address || '')}${J.ref ? ' · ' + esc(J.ref) : ''}</span></div><span class="small muted">${esc(name)}</span></div>
    ${p.duplicate ? `<div class="neg small">⚠️ ${t('Esta obra ya se importó ({x}). No se importará de nuevo.', { x: esc(p.duplicate.client_name) })}</div>` : ''}
    <div class="row wrap small" style="gap:1rem;margin:.4rem 0"><span>${t('Vendido')}: <b>${fmt0(J.sold_cents)}</b></span><span>${t('{n} partidas', { n: p.lines.length })}</span>
      <span>${t('{n} renglones de materiales en {k} tickets ({m})', { n: p.materials.items, k: p.materials.tickets, m: fmt0(p.materials.total_cents) })}</span>
      <span>${t('{n} subs', { n: p.subs.length })}</span>${p.change_orders.length ? `<span>${t('{n} change orders', { n: p.change_orders.length })}</span>` : ''}
      ${p.tasks ? `<span>${t('{n} tareas', { n: p.tasks })}</span>` : ''}${p.links ? `<span>${t('{n} documentos', { n: p.links })}</span>` : ''}${p.lessons ? `<span>${t('{n} lecciones', { n: p.lessons })}</span>` : ''}</div>
    <div class="row wrap"><label class="small">${t('Tipo')} <select data-type>${CAT.projectTypes.map(x => `<option value="${x.key}" ${x.key === p.project_type ? 'selected' : ''}>${esc(L(x))}</option>`).join('')}</select></label>
      <label class="small">${t('Estado')} <select data-status>${CAT.jobStatus.map(x => `<option value="${x.key}" ${x.key === J.status ? 'selected' : ''}>${esc(L(x))}</option>`).join('')}</select></label></div>
    ${p.lines.length ? `<details><summary class="small">${t('Ver partidas')}</summary><table class="small"><tbody>${p.lines.map(l => `<tr><td><b>${esc(l.code)}</b></td><td>${esc(l.trade)}${l.pass_through ? ' · ' + t('pase directo') : ''}</td><td class="num">${fmt0(l.sold_cents)}</td><td class="num muted">${t('costo en Excel')} ${fmt0(l.sheet_cost_cents)}</td></tr>`).join('')}</tbody></table></details>` : ''}
    ${p.subs.length ? `<div class="small" style="margin-top:.4rem"><b>${t('Subs: marque los que ya están pagados completos')}</b> <span class="muted">${t('(los que dicen Zelle, cheque o “paid” ya vienen marcados; revise los de “¿pagado?”)')}</span></div>${p.subs.map(subRow).join('')}` : ''}
    ${p.warnings.length ? `<div class="small warnbox">${p.warnings.map(w => '⚠️ ' + esc(w)).join('<br>')}</div>` : ''}
    ${p.duplicate ? '' : `<button class="primary" data-go style="margin-top:.6rem">${t('Importar esta obra')}</button>`}`;
  const go = $('[data-go]', c);
  if (go) go.onclick = async () => {
    go.disabled = true; go.textContent = t('Importando…');
    try {
      const paid_rows = $$('[data-row]', c).filter(x => x.checked && !x.disabled).map(x => Number(x.dataset.row));
      const r = await api('POST', '/api/import/xlsx/commit', { file, name, drive_id: driveId || undefined, project_type: $('[data-type]', c).value, status: $('[data-status]', c).value, paid_rows });
      c.innerHTML = `✅ <b>${esc(J.client_name)}</b> ${t('importada.')} <a href="#/obra/${r.job_id}/partidas">${t('Ver partidas y margen')}</a>`;
    } catch (err) { go.disabled = false; go.textContent = t('Importar esta obra'); toast(err.message, true); }
  };
}
// Pestaña Datos: documentos, lecciones aprendidas y revisión final (su ISSUES / FINAL_REVIEW).
async function closeoutCards(box, d, id) {
  const r = await api('GET', `/api/jobs/${id}/closeout`);
  const c = document.createElement('div'); box.appendChild(c);
  const again = () => { c.remove(); closeoutCards(box, d, id); };
  const R = r.review;
  c.innerHTML = `<div class="card"><div class="row between"><h2 style="margin:0">📎 ${t('Documentos (enlaces)')}</h2><button class="sm" id="adlk">${t('+ Enlace')}</button></div>
      ${r.links.length ? r.links.map(l => `<div class="assign"><div style="flex:1"><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(l.label || l.url)}</a>${l.note ? `<div class="small muted">${esc(l.note)}</div>` : ''}</div><button class="sm danger" data-dl="${l.id}">✕</button></div>`).join('') : `<p class="empty small">${t('Planos, invoice al cliente, estimados de subs en Drive…')}</p>`}</div>
    <div class="card"><div class="row between"><h2 style="margin:0">🧠 ${t('Lecciones aprendidas')}</h2><button class="sm" id="adls">${t('+ Lección')}</button></div>
      ${r.lessons.length ? r.lessons.map(l => `<div class="assign"><div style="flex:1"><b>${esc(l.issue)}</b>${l.line_code ? ` <span class="muted small">${esc(l.line_code)}</span>` : ''}${l.cost_cents ? ` <span class="neg small">−${fmt0(l.cost_cents)}</span>` : ''}
        <div class="small">${[l.cause && t('Causa') + ': ' + esc(l.cause), l.lesson && '💡 ' + esc(l.lesson), l.avoid_repeat && esc(l.avoid_repeat)].filter(Boolean).join(' · ')}</div></div><button class="sm danger" data-dls="${l.id}">✕</button></div>`).join('') : `<p class="empty small">${t('Qué salió mal, por qué, cuánto costó y qué hacer la próxima vez.')}</p>`}</div>
    <div class="card"><div class="row between"><h2 style="margin:0">🏁 ${t('Revisión final')}</h2><button class="sm" id="edrv">${t('Editar')}</button></div>
      ${R.profitable || R.worked || R.didnt || R.notes ? `<div class="kv small"><div><b>${t('¿Fue rentable?')}</b> ${esc(R.profitable || '—')} · <b>${t('Nivel de estrés (1–5)')}</b> ${esc(R.stress || '—')}</div>
        ${R.worked ? `<div><b>${t('Qué funcionó')}:</b> ${esc(R.worked)}</div>` : ''}${R.didnt ? `<div><b>${t('Qué no funcionó')}:</b> ${esc(R.didnt)}</div>` : ''}${R.notes ? `<div><b>${t('Notas de los dueños')}:</b> ${esc(R.notes)}</div>` : ''}</div>` : `<p class="empty small">${t('Al terminar la obra: ¿fue rentable?, estrés, qué funcionó y qué no.')}</p>`}</div>`;
  $('#adlk', c).onclick = async () => { if (await formDialog({ title: t('Nuevo enlace'), fields: [{ name: 'label', label: t('Nombre'), required: true }, { name: 'url', label: 'URL (https://…)', required: true }, { name: 'note', label: t('Notas'), type: 'textarea' }], onSubmit: v => api('POST', `/api/jobs/${id}/links`, v) })) again(); };
  $$('[data-dl]', c).forEach(b => { b.onclick = async () => { await act(() => api('DELETE', `/api/job-links/${b.dataset.dl}`), t('Quitado')); again(); }; });
  $('#adls', c).onclick = async () => { if (await formDialog({ title: t('Lección aprendida'), fields: [
    { name: 'issue', label: t('¿Qué pasó?'), required: true }, { name: 'cause', label: t('Causa') }, { name: 'cost_cents', label: t('Costo ($)'), type: 'money', value: '0.00' },
    { name: 'lesson', label: t('Lección: qué hacer la próxima vez'), type: 'textarea' }, { name: 'avoid_repeat', label: t('Evitar o repetir'), type: 'select', value: 'EVITAR', options: [['EVITAR', t('Evitar')], ['REPETIR', t('Repetir')]] },
    { name: 'line_code', label: t('Partida (código, opcional)') }], onSubmit: v => api('POST', `/api/jobs/${id}/lessons`, v) })) again(); };
  $$('[data-dls]', c).forEach(b => { b.onclick = async () => { await act(() => api('DELETE', `/api/lessons/${b.dataset.dls}`), t('Quitado')); again(); }; });
  $('#edrv', c).onclick = async () => { if (await formDialog({ title: t('Revisión final'), fields: [
    { name: 'profitable', label: t('¿Fue rentable?'), type: 'select', value: R.profitable || '', options: [['', '—'], ['YES', t('Sí')], ['NO', t('No')], ['MAS O MENOS', t('Más o menos')]] },
    { name: 'stress', label: t('Nivel de estrés (1–5)'), type: 'select', value: R.stress || '', options: [['', '—'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']] },
    { name: 'worked', label: t('Qué funcionó'), type: 'textarea', value: R.worked }, { name: 'didnt', label: t('Qué no funcionó'), type: 'textarea', value: R.didnt },
    { name: 'notes', label: t('Notas de los dueños'), type: 'textarea', value: R.notes }], onSubmit: v => api('PUT', `/api/jobs/${id}/review`, v) })) again(); };
}

// =====================================================================
// AGENTES (bots de AI como Grok) con llave de acceso
// =====================================================================
async function agentsCard(app) {
  const list = await api('GET', '/api/agents');
  const c = document.createElement('div'); c.className = 'card'; app.appendChild(c);
  const again = () => { c.remove(); agentsCard(app); };
  const KIND = { operador: t('Operador de obras: ve todas las obras, como un PM'), vendedor: t('Vendedor: agenda, clientes y estimados') };
  c.innerHTML = `<div class="row between wrap"><h2 style="margin:0">🤖 ${t('Agentes de AI (Grok, ChatGPT, Claude…)')}</h2><div class="row"><a class="btn sm" href="#/agentes">${t('Instrucciones para el bot')}</a><button class="primary sm" id="nag">${t('+ Agente')}</button></div></div>
    <p class="small muted">${t('Un agente entra con una llave, nunca con contraseña. Tiene las mismas reglas que un PM o un vendedor: lo que mueve dinero espera a un dueño y todo queda en el Historial con 🤖. No puede cambiar usuarios, reparto, ajustes ni autorizar nada.')}</p>
    ${list.length ? list.map(a => `<div class="agent ${a.active ? '' : 'off'}" data-a="${a.id}"><div class="row between wrap"><div><b>${esc(a.name)}</b> <span class="small muted">${esc(KIND[a.kind] || '')}</span>${a.active ? '' : ` <span class="badge b-cancelado">${t('Apagado')}</span>`}</div>
        <div class="row"><button class="sm" data-key="0">🔑 ${t('Llave de solo lectura')}</button><button class="sm" data-key="1">🔑 ${t('Llave de lectura y escritura')}</button><button class="sm ${a.active ? 'danger' : ''}" data-act>${a.active ? t('Apagar') : t('Encender')}</button></div></div>
      ${a.keys.length ? `<table class="small keys"><tbody>${a.keys.map(k => `<tr class="${k.revoked_at ? 'muted' : ''}"><td><code>${esc(k.prefix)}…</code></td><td>${k.can_write ? t('lectura y escritura') : t('solo lectura')}</td>
        <td>${k.last_used_at ? t('usada {n} veces, la última {d}', { n: k.uses, d: esc(k.last_used_at.slice(0, 16)) }) : t('sin usar')}</td><td>${k.revoked_at ? t('quitada') : `<button class="sm danger" data-rk="${k.id}">${t('Quitar')}</button>`}</td></tr>`).join('')}</tbody></table>` : ''}</div>`).join('')
      : `<p class="empty small">${t('Todavía no hay agentes.')}</p>`}`;
  $('#nag', c).onclick = async () => {
    const v = await formDialog({ title: t('Nuevo agente'), fields: [
      { name: 'name', label: t('Nombre'), required: true, hint: t('Ej. Grok operaciones, Grok compras') },
      { name: 'kind', label: t('Papel'), type: 'select', value: 'operador', options: Object.entries(KIND) },
      { name: 'lang', label: t('Idioma'), type: 'select', value: 'es', options: [['es', 'Español'], ['en', 'English']] },
    ], onSubmit: v => api('POST', '/api/agents', v) });
    if (v) again();
  };
  $$('[data-a]', c).forEach(el => {
    const a = list.find(x => x.id === Number(el.dataset.a));
    $$('[data-key]', el).forEach(b => { b.onclick = async () => {
      const w = b.dataset.key === '1';
      if (w && !(await confirmDialog(t('Con esta llave el agente podrá crear y cambiar cosas (tareas, gastos, reportes…). Lo que mueva dinero esperará a un dueño. ¿Crear la llave?'), t('Crear')))) return;
      const r = await api('POST', `/api/agents/${a.id}/keys`, { can_write: w });
      await formDialog({ title: t('Llave para {x}', { x: a.name }), submit: t('Ya la copié'), fields: [], onSubmit: async () => {},
        intro: `<p class="neg small"><b>${t('Cópiela ahora: no se vuelve a mostrar.')}</b></p><div class="card small mono" style="word-break:break-all" id="keyv">${esc(r.key)}</div>
          <p><button type="button" class="btn" id="cpk">${t('Copiar llave')}</button></p>
          <h3>${t('Para Grok (grok.com/connectors)')}</h3><p class="small">${t('Toque New Connector → Custom y pegue esta dirección:')}</p>
          <div class="card small mono" style="word-break:break-all" id="mcpv">${esc(location.origin + '/mcp/' + r.key)}</div>
          <p><button type="button" class="btn" id="cpm">${t('Copiar dirección para Grok')}</button></p>
          <p class="small muted">${esc(t('Otros bots: mande la llave como encabezado Authorization: Bearer <llave>. Si la llave o la dirección se pierde o alguien más la ve, quítela y cree otra.'))}</p>` });
      again();
    }; });
    $('[data-act]', el).onclick = async () => { await act(() => api('PUT', `/api/agents/${a.id}`, { active: !a.active }), t('Guardado')); again(); };
    $$('[data-rk]', el).forEach(b => { b.onclick = async () => { if (await confirmDialog(t('El agente dejará de entrar con esa llave en este momento. ¿Quitarla?'), t('Quitar'))) { await act(() => api('DELETE', `/api/agent-keys/${b.dataset.rk}`), t('Quitada')); again(); } }; });
  });
}
document.addEventListener('click', e => { if (e.target && e.target.id === 'cpm') { const v = document.getElementById('mcpv'); if (v && navigator.clipboard) navigator.clipboard.writeText(v.textContent).then(() => toast(t('Copiado'))); } });
document.addEventListener('click', e => { if (e.target && e.target.id === 'cpk') { const v = document.getElementById('keyv'); if (v && navigator.clipboard) navigator.clipboard.writeText(v.textContent).then(() => toast(t('Copiado'))); } });
async function viewAgentManual(app) {
  const m = await api('GET', `/api/agent/manual?base=${encodeURIComponent(location.origin)}`);
  app.innerHTML = `<a href="#/equipo" class="small">← ${t('Equipo y accesos')}</a><h1>🤖 ${t('Instrucciones para el agente')}</h1>
    <p class="small muted">${t('Copie este texto en las instrucciones de su bot (Grok, ChatGPT, Claude…) y ponga su llave como encabezado. Si su herramienta acepta OpenAPI (Actions / function calling), use el segundo bloque.')}</p>
    <div class="card"><div class="row between"><h2 style="margin:0">${t('Instrucciones')}</h2><button class="sm" data-copy="mt">${t('Copiar')}</button></div><pre id="mt" class="manual">${esc(m.text)}</pre></div>
    <div class="card"><div class="row between"><h2 style="margin:0">OpenAPI</h2><button class="sm" data-copy="mo">${t('Copiar')}</button></div><pre id="mo" class="manual">${esc(JSON.stringify(m.openapi, null, 2))}</pre></div>`;
  $$('[data-copy]', app).forEach(b => { b.onclick = () => navigator.clipboard && navigator.clipboard.writeText($('#' + b.dataset.copy, app).textContent).then(() => toast(t('Copiado'))); });
}


// =====================================================================
// TEXTOS (SMS) con subs y clientes desde el número de la empresa
// =====================================================================
let SMSST = { enabled: false };
async function loadSmsStatus() { if (!BOSS()) return; try { SMSST = await api('GET', '/api/sms/status'); } catch { SMSST = { enabled: false }; } }
const smsTime = s => { const d = new Date(s.replace(' ', 'T') + 'Z'); return d.toLocaleString(LANG === 'en' ? 'en-US' : 'es-MX', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }); };
async function viewTexts(app, phone) {
  await loadSmsStatus();
  const threads = await api('GET', '/api/sms/threads');
  const off = !SMSST.enabled ? `<div class="card warn small">${t('Los textos todavía no están conectados. Un dueño los activa en Mi cuenta → Mensajes de texto (cuenta de Twilio). Mientras tanto puede ver aquí las conversaciones guardadas.')}</div>` : '';
  app.innerHTML = `<div class="row between wrap"><h1 style="margin:0">💬 ${t('Textos')}</h1>${SMSST.enabled ? `<button class="primary" id="nsms">${t('+ Texto nuevo')}</button>` : ''}</div>
    ${SMSST.enabled ? `<p class="small muted">${t('Se mandan desde el número de la empresa: {n}. Las respuestas llegan aquí.', { n: esc(SMSST.from) })}</p>` : ''}${off}
    <div class="sms-wrap ${phone ? 'has-thread' : ''}"><div class="sms-list card">${threads.length ? threads.map(th => `<a class="sms-th ${th.phone === phone ? 'on' : ''}" href="#/textos/${encodeURIComponent(th.phone)}">
      <div class="row between"><b>${esc(th.name || th.phone)}</b>${th.unread ? `<span class="badge b-late">${th.unread}</span>` : ''}</div>
      <div class="small muted">${esc(th.role_label ? t(th.role_label) : th.phone)} · ${smsTime(th.last.created_at)}</div>
      <div class="small one-line">${th.last.direction === 'out' ? '↗ ' : ''}${esc(th.last.body)}</div></a>`).join('') : `<p class="empty small">${t('Todavía no hay textos.')}</p>`}</div>
    <div class="sms-thread card" id="smsth">${phone ? '' : `<p class="empty small">${t('Elija una conversación o mande un texto nuevo.')}</p>`}</div></div>`;
  if ($('#nsms')) $('#nsms').onclick = () => newTextDialog();
  if (phone) await showThread($('#smsth'), phone, () => viewTexts(app, phone));
}
async function showThread(el, phone, reload) {
  const d = await api('GET', `/api/sms/thread?phone=${encodeURIComponent(phone)}`);
  el.innerHTML = `<div class="row between wrap"><div><a href="#/textos" class="small mobile-only">← ${t('Textos')}</a><h2 style="margin:0">${esc(d.contact.name || phone)}</h2>
      <div class="small muted">${esc(d.contact.role_label ? t(d.contact.role_label) : '')} · <a href="tel:${esc(phone)}">${esc(phone)}</a></div></div></div>
    <div class="sms-msgs">${d.messages.map(m => `<div class="sms-m ${m.direction}"><div class="bubble">${trx(m.body, m.body_tr, m.body_from)}${m.original ? `<div class="sms-orig small">🌐 ${t('Se mandó traducido. Usted escribió:')} “${esc(m.original)}”</div>` : ''}</div>
      <div class="small muted">${smsTime(m.created_at)}${m.by_name ? ' · ' + esc(m.by_name) : ''}${m.status === 'error' ? ` · <span class="neg">${t('No se mandó')}: ${esc(m.error)}</span>` : ''}</div></div>`).join('') || `<p class="empty small">${t('Todavía no hay textos.')}</p>`}</div>
    ${SMSST.enabled ? `<form class="sms-send" id="smsf"><textarea id="smsb" rows="2" maxlength="1000" placeholder="${t('Escriba el mensaje…')}" required></textarea><button class="primary">${t('Mandar')}</button></form>
      ${SMSST.translate ? `<label class="check small"><input type="checkbox" id="smstr" checked> 🌐 ${t('Si la persona habla otro idioma, mandárselo traducido')}</label>` : ''}
      <p class="small muted">${t('No ponga precios ni costos internos en un texto a un sub o cliente.')}</p>` : ''}`;
  const box = $('.sms-msgs', el); box.scrollTop = box.scrollHeight;
  if ($('#smsf', el)) $('#smsf', el).onsubmit = async e => {
    e.preventDefault(); const b = $('button', e.target); b.disabled = true;
    try { await api('POST', '/api/sms/send', { phone, body: $('#smsb', el).value, translate: $('#smstr', el) ? $('#smstr', el).checked : true }); toast(t('Texto mandado')); reload(); }
    catch (err) { toast(err.message, true); b.disabled = false; }
  };
}
async function newTextDialog(preset) {
  const contacts = await api('GET', '/api/sms/contacts');
  const v = await formDialog({ title: t('Texto nuevo'), submit: t('Mandar'), fields: [
    { name: 'phone', label: t('Para'), type: 'select', required: true, value: preset && preset.phone, options: [['', '—'], ...contacts.map(c => [c.phone, `${c.name} · ${t(c.role_label)}`])] },
    ...(ME.role === 'owner' ? [{ name: 'other', label: t('U otro número'), type: 'tel', hint: t('Solo dueños') }] : []),
    { name: 'body', label: t('Mensaje'), type: 'textarea', required: true, value: preset && preset.text },
    ...(SMSST.translate ? [{ name: 'translate', label: '🌐 ' + t('Si la persona habla otro idioma, mandárselo traducido'), type: 'check', value: true }] : []),
  ], onSubmit: v => api('POST', '/api/sms/send', { phone: v.other || v.phone, body: v.body, translate: SMSST.translate ? !!v.translate : false }) });
  if (v) { toast(t('Texto mandado')); location.hash = '#/textos/' + encodeURIComponent(v.other ? '' : v.phone); }
}
// Botón "Texto desde la app" junto a WhatsApp / Mensaje de texto en los avisos.
document.addEventListener('click', async e => {
  const b = e.target && e.target.closest && e.target.closest('[data-smsapp]'); if (!b) return;
  e.preventDefault(); b.disabled = true;
  try { await api('POST', '/api/sms/send', { phone: b.dataset.phone, body: b.dataset.text, translate: false }); toast(t('Texto mandado')); b.textContent = '✓ ' + t('Mandado'); }
  catch (err) { toast(err.message, true); b.disabled = false; }
});
async function smsSettingsCard(app) {
  const st = await api('GET', '/api/sms/status').catch(() => ({ enabled: false }));
  const c = document.createElement('div'); c.className = 'card';
  const hook = `${location.origin}/sms/twilio/${COMPANY.key}`;
  c.innerHTML = `<h2>💬 ${t('Mensajes de texto')}</h2><p>${st.enabled ? `<span class="badge b-hecho">${t('Activados')}</span> ${esc(st.from)}` : `<span class="badge b-pendiente">${t('No configurados')}</span>`}</p>
    <p class="small muted">${st.enabled ? t('Las respuestas llegan a Textos. En Twilio, el número debe tener esta dirección en "A message comes in" (HTTP POST):') : t('Para mandar y recibir textos desde el número de la empresa: cree la cuenta de Twilio, compre un número, ponga TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN y TWILIO_FROM en Render → Environment, y en Twilio ponga esta dirección en "A message comes in" (HTTP POST):')}</p>
    <div class="card small mono" style="word-break:break-all">${esc(hook)}</div>`;
  app.appendChild(c);
}

// =====================================================================
// TRABAJADORES POR HORA: nómina semanal, reporte por trabajador y por obra, horas a mano
// =====================================================================
const hrs = m => (Math.round((m || 0) / 6) / 10).toLocaleString(LANG === 'en' ? 'en-US' : 'es-MX', { minimumFractionDigits: 1 }) + ' h';
const fdShort = d => new Date(d + 'T12:00:00').toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-MX', { day: 'numeric', month: 'short' });
async function viewHours(app, tab = 'nomina', arg = '') {
  const TABS = [['nomina', '💵 ' + t('Nómina de la semana')], ['reporte', '📊 ' + t('Reporte')], ['entradas', '⏱️ ' + t('Entradas y salidas')], ['trabajadores', '👷 ' + t('Trabajadores y pago')]];
  app.innerHTML = `<div class="row between wrap"><h1 style="margin:0">${t('Trabajadores por hora')}</h1><button class="primary" id="addh">${t('+ Anotar horas')}</button></div>
    <p class="small muted">${t('Para quien se paga por hora (no subs). Las horas se suman solas como gasto de mano de obra en cada obra, con el tiempo extra incluido.')}</p>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/horas/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="hbox"></div>`;
  $('#addh').onclick = async () => { if (await addHoursDialog()) viewHours(app, tab, arg); };
  const box = $('#hbox');
  if (tab === 'reporte') return laborReport(box, arg);
  if (tab === 'entradas') return hoursEntries(box, () => viewHours(app, tab, arg));
  if (tab === 'trabajadores') return laborWorkers(box, () => viewHours(app, tab, arg));
  return payrollWeek(box, arg, w => { location.hash = `#/horas/nomina/${w}`; });
}
async function addHoursDialog(preset = {}) {
  const [workers, jobs] = await Promise.all([api('GET', '/api/labor/workers'), api('GET', '/api/jobs')]);
  const today = new Date(); const p = n => String(n).padStart(2, '0');
  const day = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
  return formDialog({ title: t('Anotar horas'), submit: t('Guardar'), intro: t('Para quien no marcó entrada y salida en su teléfono.'), fields: [
    { name: 'user_id', label: t('Trabajador'), type: 'select', required: true, value: preset.user_id, options: [['', '—'], ...workers.filter(w => w.active).map(w => [w.id, w.name + (w.pay_type === 'hora' ? ` · ${fmt(w.rate_cents)}/h` : ` · ${t('sin pago por hora')}`)])] },
    { name: 'job_id', label: t('Obra'), type: 'select', required: true, value: preset.job_id, options: [['', '—'], ...jobs.filter(j => ['activo', 'cotizado', 'terminado'].includes(j.status)).map(j => [j.id, j.client_name])] },
    { name: 'day', label: t('Día'), type: 'date', required: true, value: day },
    { name: 'start', label: t('Entrada'), type: 'time', required: true, value: '07:00' },
    { name: 'end', label: t('Salida'), type: 'time', required: true, value: '15:30' },
    { name: 'lunch', label: t('Comida sin pago (minutos)'), type: 'number', value: '30', hint: t('Se resta de la salida') },
    { name: 'note', label: t('Nota') },
  ], onSubmit: v => {
    const inAt = new Date(`${v.day}T${v.start}`); let out = new Date(`${v.day}T${v.end}`);
    if (out <= inAt) out = new Date(out.getTime() + 86400000);
    out = new Date(out.getTime() - (Number(v.lunch) || 0) * 60000);
    const iso = d => d.toISOString().replace('T', ' ').slice(0, 16);
    return api('POST', '/api/time', { user_id: v.user_id, job_id: v.job_id, in_at: iso(inAt), out_at: iso(out), note: v.note });
  } }).then(r => { if (r) toast(t('Guardado')); return r; });
}
async function payrollWeek(box, week, go) {
  const d = await api('GET', `/api/payroll${week ? '?week=' + week : ''}`);
  const S = d.settings;
  box.innerHTML = `<div class="card"><div class="row between wrap"><div class="row"><button class="sm" data-w="${d.prev}">‹</button><h2 style="margin:0">${t('Semana del {a} al {b}', { a: fdShort(d.week), b: fdShort(d.end) })}</h2><button class="sm" data-w="${d.next}">›</button></div>
      <span class="small muted">${S.ot_on ? t('Tiempo extra: {m}× después de {h} h por semana', { m: S.ot_mult, h: S.ot_hours }) : t('Sin tiempo extra')} · ${S.week_start === 'dom' ? t('semana de domingo a sábado') : t('semana de lunes a domingo')} <a href="#" id="ots">${t('Cambiar')}</a></span></div>
    ${d.people.length ? `<div class="table-wrap"><table class="payroll"><thead><tr><th>${t('Trabajador')}</th><th class="num">${t('Horas')}</th><th class="num">${t('Extra')}</th><th class="num">${t('Pago/h')}</th><th class="num">${t('A pagar')}</th><th>${t('Estado')}</th></tr></thead><tbody>
      ${d.people.map((p, i) => `<tr><td><b>${esc(p.name)}</b><div class="small muted">${p.jobs.map(j => `${esc(j.client_name)} ${hrs(j.minutes)}`).join(' · ')}</div>${p.open_entries ? `<div class="small neg">⚠️ ${t('Tiene una entrada sin salida: corríjala en Entradas y salidas')}</div>` : ''}</td>
        <td class="num" data-l="${t('Horas')}">${hrs(p.minutes)}<div class="small muted">${t('{n} días', { n: p.days })}</div></td><td class="num ${p.ot_minutes ? 'neg' : ''}" data-l="${t('Extra')}">${p.ot_minutes ? hrs(p.ot_minutes) : '—'}</td><td class="num" data-l="${t('Pago/h')}">${fmt(p.rate_cents)}</td>
        <td class="num" data-l="${t('A pagar')}"><b>${fmt(p.paid ? p.paid.total_cents : p.total_cents)}</b>${p.ot_extra_cents ? `<div class="small muted">${t('incluye {x} de extra', { x: fmt(p.ot_extra_cents) })}</div>` : ''}</td>
        <td>${p.paid ? `<span class="badge b-hecho">✓ ${t('Pagado')}</span><div class="small muted">${esc(fdayLocal(p.paid.at))}${p.paid.method ? ' · ' + esc(p.paid.method) : ''}</div><button class="sm link" data-unpay="${p.paid.id}">${t('Quitar pago')}</button>`
          : `<button class="sm primary" data-pay="${i}" ${p.open_entries || !p.minutes ? 'disabled' : ''}>${t('Marcar pagado')}</button>`}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>${t('Total')}</th><th class="num">${hrs(d.people.reduce((a, p) => a + p.minutes, 0))}</th><th></th><th></th><th class="num">${fmt(d.total_cents)}</th><th class="small">${d.unpaid_cents ? t('Falta pagar {x}', { x: fmt(d.unpaid_cents) }) : '✓'}</th></tr></tfoot></table></div>`
      : `<p class="empty">${t('Nadie trabajó por hora esta semana.')}</p>`}
    <p class="small muted">${t('Al marcar pagado, esa semana queda cerrada: para corregir horas, primero quite el pago. La app no calcula impuestos de nómina; esos los ve su contador.')}</p></div>`;
  $$('[data-w]', box).forEach(b => { b.onclick = () => go(b.dataset.w); });
  $('#ots', box).onclick = async e => {
    e.preventDefault();
    if (await formDialog({ title: t('Nómina y tiempo extra'), fields: [
      { name: 'week_start', label: t('La semana de pago empieza'), type: 'select', value: S.week_start, options: [['lun', t('Lunes')], ['dom', t('Domingo')]] },
      { name: 'ot_on', label: t('Pagar tiempo extra'), type: 'check', value: S.ot_on },
      { name: 'ot_hours', label: t('Después de cuántas horas por semana'), type: 'number', value: S.ot_hours },
      { name: 'ot_mult', label: t('Se paga a (×)'), type: 'number', value: S.ot_mult, hint: t('La ley federal pide 1.5× después de 40 h para empleados por hora') }],
      onSubmit: v => api('PUT', '/api/settings/labor', { week_start: v.week_start, ot_on: !!v.ot_on, ot_hours: Number(v.ot_hours), ot_mult: Number(v.ot_mult) }) })) { toast(t('Guardado')); payrollWeek(box, week, go); }
  };
  $$('[data-pay]', box).forEach(b => { b.onclick = async () => {
    const p = d.people[Number(b.dataset.pay)];
    if (await formDialog({ title: t('Pagar a {x}', { x: p.name }), submit: t('Marcar pagado'), intro: `<p>${t('Semana del {a} al {b}', { a: fdShort(d.week), b: fdShort(d.end) })}: <b>${hrs(p.minutes)}</b>${p.ot_minutes ? ` (${t('{x} de tiempo extra', { x: hrs(p.ot_minutes) })})` : ''} → <b>${fmt(p.total_cents)}</b></p>`, fields: [
      { name: 'method', label: t('Cómo se pagó'), type: 'select', value: 'Zelle', options: [['Zelle', 'Zelle'], ['Cheque', t('Cheque')], ['Efectivo', t('Efectivo')], ['Nómina', t('Servicio de nómina')], ['Otro', t('Otro')]] },
      { name: 'note', label: t('Nota (número de cheque, etc.)') }],
      onSubmit: v => api('POST', '/api/payroll/pay', { user_id: p.user_id, week: d.week, ...v }) })) { toast(t('Pagado')); payrollWeek(box, week, go); }
  }; });
  $$('[data-unpay]', box).forEach(b => { b.onclick = async () => { if (!confirm(t('¿Quitar el pago? La semana se abre otra vez para corregir horas.'))) return; await act(() => api('DELETE', `/api/payroll/${b.dataset.unpay}`), t('Listo')); payrollWeek(box, week, go); }; });
}
async function laborReport(box, arg) {
  const [from0, to0, view0] = String(arg || '').split('_');
  const p = n => String(n).padStart(2, '0'); const now = new Date(); const iso = d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const to = to0 || iso(now), from = from0 || iso(new Date(now.getFullYear(), now.getMonth(), 1)), view = view0 || 'trabajador';
  const r = await api('GET', `/api/labor/report?from=${from}&to=${to}`);
  const quick = [[t('Este mes'), iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)], [t('Mes pasado'), iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))],
    [t('Últimos 90 días'), iso(new Date(now.getTime() - 89 * 864e5)), iso(now)], [t('Este año'), `${now.getFullYear()}-01-01`, iso(now)]];
  const list = view === 'obra' ? r.by_job : r.by_worker;
  box.innerHTML = `<div class="card"><div class="row wrap" style="gap:.5rem;align-items:flex-end">
      <label class="small">${t('Desde')}<input type="date" id="rf" value="${from}"></label><label class="small">${t('Hasta')}<input type="date" id="rt" value="${to}"></label>
      ${quick.map(([l, a, b]) => `<button class="sm ${a === from && b === to ? 'primary' : ''}" data-q="${a}_${b}">${l}</button>`).join('')}</div>
    <div class="money-strip" style="margin-top:.8rem"><div><span>${t('Gastado en trabajadores por hora')}</span><b>${fmt(r.total_cents)}</b></div><div><span>${t('Horas')}</span><b>${hrs(r.total_minutes)}</b></div><div><span>${t('Tiempo extra')}</span><b>${hrs(r.ot_minutes)}</b></div></div>
    <div class="tabs small"><a href="#/horas/reporte/${from}_${to}_trabajador" class="${view !== 'obra' ? 'on' : ''}">${t('Por trabajador')}</a><a href="#/horas/reporte/${from}_${to}_obra" class="${view === 'obra' ? 'on' : ''}">${t('Por obra')}</a></div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>${view === 'obra' ? t('Obra') : t('Trabajador')}</th><th class="num">${t('Horas')}</th><th class="num">${t('Extra')}</th><th class="num">${t('Gastado')}</th></tr></thead><tbody>
      ${list.map(x => `<tr><td><details><summary><b>${esc(view === 'obra' ? x.client_name : x.name)}</b></summary>
          <div class="small">${(view === 'obra' ? x.workers : x.jobs).map(y => `<div class="row between"><span>${view === 'obra' ? esc(y.name) : `<a href="#/obra/${y.job_id}/subs">${esc(y.client_name)}</a>`}</span><span>${hrs(y.minutes)} · ${fmt(y.cost_cents)}</span></div>`).join('')}</div></details></td>
        <td class="num">${hrs(x.minutes)}</td><td class="num">${x.ot_minutes ? hrs(x.ot_minutes) : '—'}</td><td class="num"><b>${fmt(x.cost_cents)}</b></td></tr>`).join('')}</tbody></table></div>`
      : `<p class="empty">${t('No hay horas en estas fechas.')}</p>`}</div>`;
  const goR = (a, b) => { location.hash = `#/horas/reporte/${a}_${b}_${view}`; };
  $$('[data-q]', box).forEach(b => { b.onclick = () => { const [a, c] = b.dataset.q.split('_'); goR(a, c); }; });
  $('#rf', box).onchange = $('#rt', box).onchange = () => goR($('#rf', box).value, $('#rt', box).value);
}
async function hoursEntries(box, reload) {
  const d = await api('GET', '/api/time');
  box.innerHTML = `<div class="card"><h2>${t('Últimos 14 días')}</h2>${d.entries.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Día')}</th><th>${t('Trabajador')}</th><th>${t('Obra')}</th><th>${t('Entrada')}</th><th>${t('Salida')}</th><th class="num">${t('Horas')}</th><th class="num">${t('Costo')}</th><th></th></tr></thead><tbody>
    ${d.entries.map(e => `<tr data-id="${e.id}" class="${e.forgot ? 'warnrow' : ''}"><td class="nowrap">${fdayLocal(e.in_at)}</td><td>${esc(e.user_name)}</td><td>${esc(e.client_name)}</td>
      <td class="nowrap">${ftime(e.in_at)} ${distLabel(e.in_dist)}</td><td class="nowrap">${e.open ? (e.forgot ? `<b>⚠️ ${t('olvidó marcar salida')}</b>` : `<span class="badge b-en_progreso">${t('trabajando')}</span>`) : ftime(e.out_at) + ' ' + distLabel(e.out_dist)}</td>
      <td class="num">${hm(e.minutes)}</td><td class="num">${fmt(e.cost_cents)}</td><td class="nowrap"><button class="sm" data-ed>✎</button>${e.in_lat != null ? `<a class="btn sm" target="_blank" rel="noopener" href="https://maps.google.com/?q=${e.in_lat},${e.in_lng}">📍</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="empty">${t('Nadie ha marcado entrada todavía.')}</p>`}
    <p class="small muted">${t('El costo es sin tiempo extra; el extra se ve en Nómina y en el Reporte.')}</p></div>`;
  $$('tr[data-id]', box).forEach(tr => {
    const e = d.entries.find(x => x.id === Number(tr.dataset.id));
    $('[data-ed]', tr).onclick = async () => {
      if (await formDialog({ title: t('Corregir horas: {x}', { x: e.user_name }), fields: [
        { name: 'in_at', label: t('Entrada'), type: 'datetime', value: localInput(e.in_at), required: true },
        { name: 'out_at', label: t('Salida'), type: 'datetime', value: localInput(e.out_at || ''), required: true },
        { name: 'note', label: t('Nota'), value: e.note }],
        extraButton: { label: t('Borrar'), danger: true, onClick: () => api('DELETE', `/api/time/${e.id}`) },
        onSubmit: v => api('PUT', `/api/time/${e.id}`, { in_at: inputToUtc(v.in_at), out_at: inputToUtc(v.out_at), note: v.note }) })) { toast(t('Guardado')); reload(); }
    };
  });
}
async function laborWorkers(box, reload) {
  const ws = await api('GET', '/api/labor/workers');
  box.innerHTML = `<div class="card"><h2>${t('Cómo se le paga a cada trabajador')}</h2><p class="small muted">${t('Por hora: sus horas cuentan como gasto en la obra y salen en Nómina. Como sub: se le paga por trabajo (en Subcontratistas de cada obra). Solo lo ven los dueños.')}</p>
    ${ws.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Trabajador')}</th><th>${t('Forma de pago')}</th><th class="num">${t('Pago/h')}</th><th></th></tr></thead><tbody>${ws.map(w => `<tr data-id="${w.id}" class="${w.active ? '' : 'muted'}"><td><b>${esc(w.name)}</b>${w.trade ? `<div class="small muted">${esc(w.trade)}</div>` : ''}</td>
      <td>${w.pay_type === 'hora' ? `<span class="badge b-en_progreso">⏱️ ${t('Por hora')}</span>` : w.pay_type === 'sub' ? `<span class="badge">${t('Como sub')}</span>` : `<span class="muted small">${t('Sin definir')}</span>`}</td>
      <td class="num">${w.pay_type === 'hora' ? fmt(w.rate_cents) : '—'}</td><td><button class="sm" data-ed>${t('Cambiar')}</button></td></tr>`).join('')}</tbody></table></div>`
    : `<p class="empty">${t('Todavía no hay trabajadores. Créelos en Equipo y accesos con el papel Trabajador / Sub.')}</p>`}</div>`;
  $$('tr[data-id]', box).forEach(tr => {
    const w = ws.find(x => x.id === Number(tr.dataset.id));
    $('[data-ed]', tr).onclick = async () => {
      if (await formDialog({ title: w.name, fields: [
        { name: 'pay_type', label: t('Forma de pago'), type: 'select', value: w.pay_type || 'hora', options: [['hora', t('Por hora')], ['sub', t('Como sub (precio por trabajo)')]] },
        { name: 'rate_cents', label: t('Pago por hora ($)'), type: 'money', value: w.rate_cents ? centsToInput(w.rate_cents) : '', hint: t('Solo si es por hora. Las horas que ya marcó guardan el pago que tenían.') }],
        onSubmit: v => api('PUT', `/api/labor/workers/${w.id}`, v) })) { toast(t('Guardado')); reload(); }
    };
  });
}
// En la obra (pestaña Subcontratistas): mano de obra por hora.
async function jobLaborCard(box, jobId) {
  const r = await api('GET', `/api/jobs/${jobId}/labor`).catch(() => null);
  if (!r || !box.isConnected) return;
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<div class="row between wrap"><h2 style="margin:0">⏱️ ${t('Trabajadores por hora')}</h2><button class="sm" id="jah">${t('+ Anotar horas')}</button></div>
    ${r.working.length ? `<p class="small">🟢 ${t('Trabajando ahora')}: ${r.working.map(w => `<b>${esc(w.name)}</b> (${t('desde las {h}', { h: ftime(w.in_at) })})`).join(', ')}</p>` : ''}
    ${r.workers.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Trabajador')}</th><th class="num">${t('Horas')}</th><th class="num">${t('Gastado')}</th><th>${t('Días')}</th></tr></thead><tbody>
      ${r.workers.map(w => `<tr><td><b>${esc(w.name)}</b>${w.trade ? ` <span class="small muted">${esc(w.trade)}</span>` : ''}</td><td class="num">${hrs(w.minutes)}</td><td class="num">${fmt(w.cost_cents)}${w.ot_extra_cents ? `<div class="small muted">${t('incluye {x} de extra', { x: fmt(w.ot_extra_cents) })}</div>` : ''}</td><td class="small">${fdShort(w.first_day)} – ${fdShort(w.last_day)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th>${t('Total')}</th><th class="num">${hrs(r.total_minutes)}</th><th class="num">${fmt(r.total_cents)}</th><th></th></tr></tfoot></table></div>`
    : `<p class="empty small">${t('Nadie ha trabajado por hora en esta obra.')}</p>`}`;
  box.appendChild(c);
  $('#jah', c).onclick = async () => { if (await addHoursDialog({ job_id: jobId })) { c.remove(); jobLaborCard(box, jobId); } };
}

// =====================================================================
// MENÚ SIMPLE: Inicio (Resumen | Hoy), Dinero (Cuentas | Reportes | Proyecciones), Módulos
// =====================================================================
function segHeader(app, items, on) {
  const head = document.createElement('div'); head.className = 'seg seg-page'; head.setAttribute('role', 'tablist');
  head.innerHTML = items.map(([href, label, k]) => `<a href="${href}" class="${k === on ? 'on' : ''}" role="tab" aria-selected="${k === on}">${label}</a>`).join('');
  const inner = document.createElement('div');
  app.replaceChildren(head, inner);
  return inner;
}
async function viewHome(app, tab) {
  const inner = segHeader(app, [['#/', '📋 ' + t('Resumen'), 'resumen'], ['#/hoy', '📍 ' + t('Hoy en las obras'), 'hoy']], tab);
  if (tab === 'hoy') return viewBoard(inner);
  return ME.role === 'pm' ? viewPmHome(inner) : viewDashboard(inner);
}
async function viewMoney(app, tab) {
  const items = [['#/dinero/cuentas', '💵 ' + t('Cuentas'), 'cuentas'], ['#/dinero/reportes', '📊 ' + t('Reportes'), 'reportes'], ['#/dinero/subs', '📁 ' + t('Subs: papeles y 1099'), 'subs'], ['#/dinero/publicidad', '📣 ' + t('Publicidad'), 'publicidad'], ...(MOD('proyecciones') ? [['#/dinero/proyecciones', '🔮 ' + t('Proyecciones'), 'proyecciones']] : [])];
  if (!items.some(i => i[2] === tab)) tab = 'cuentas';
  const inner = segHeader(app, items, tab);
  if (tab === 'reportes') return viewReports(inner);
  if (tab === 'proyecciones') return viewForecast(inner);
  if (tab === 'subs') return viewPapers(inner);
  if (tab === 'publicidad') return viewMarketing(inner);
  return viewAccounts(inner);
}
async function modulesCard(app) {
  const m = await api('GET', '/api/settings/modules').catch(() => null); if (!m) return;
  const L = { horas: [t('Horas y nómina'), t('Trabajadores por hora, tiempo extra y nómina semanal.')], pm: [t('Project managers'), t('Límites, solicitudes y reportes de los PM.')],
    proyecciones: [t('Proyecciones'), t('Pronóstico de los próximos meses. Úselo cuando tenga 12 meses de datos en la app.')], agentes: [t('Agentes de AI (Grok)'), t('Llaves y conexión para bots que leen y anotan en la app.')],
    importar: [t('Importar de Excel / Drive'), t('Para pasar sus libros de cada obra. Apáguelo al terminar.')] };
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h2>🧩 ${t('Módulos de {x}', { x: esc(COMPANY.name) })}</h2><p class="small muted">${t('Apagar un módulo solo lo quita del menú: la información se queda y se vuelve a ver al prenderlo. Cada empresa tiene los suyos.')}</p>
    ${Object.keys(L).map(k => `<label class="check modrow"><input type="checkbox" data-mod="${k}" ${m[k] ? 'checked' : ''}> <span><b>${L[k][0]}</b><br><span class="small muted">${L[k][1]}</span></span></label>`).join('')}`;
  app.appendChild(c);
  $$('[data-mod]', c).forEach(x => { x.onchange = async () => {
    try { COMPANY.modules = await api('PUT', '/api/settings/modules', { [x.dataset.mod]: x.checked }); renderNav(); toast(t('Guardado')); }
    catch (e) { x.checked = !x.checked; toast(e.message, true); }
  }; });
}

// =====================================================================
// PROPUESTA AL CLIENTE Y COBROS POR ETAPAS (pestaña de la obra, solo dueños)
// =====================================================================
const MS_ST = () => ({ pendiente: [t('Pendiente'), ''], por_cobrar: [t('Toca cobrar'), 'b-urg'], facturado: [t('Facturado'), 'b-pendiente'], vencido: [t('Vencido'), 'b-late'], pagado: [t('Pagado'), 'b-hecho'] });
const absUrl = u => location.origin + u;
async function tabProposal(box, d, { id, reload }) {
  const [p, b] = await Promise.all([api('GET', `/api/jobs/${id}/proposal`), api('GET', `/api/jobs/${id}/billing`)]);
  const again = () => tabProposal(box, d, { id, reload });
  const low = p.margin_pct != null && p.margin_pct < p.alert_pct;
  const pdfLinks = `<a class="btn sm" target="_blank" rel="noopener" href="/api/jobs/${id}/proposal/pdf?lang=es">📄 PDF ${t('español')}</a> <a class="btn sm" target="_blank" rel="noopener" href="/api/jobs/${id}/proposal/pdf?lang=en">📄 PDF English</a>`;
  const schedEditor = () => `<div class="sched">${p.schedule.map((s, i) => `<div class="srow" data-i="${i}">
      <input data-k="label" value="${esc(s.label)}" placeholder="${t('Etapa')}"><input data-k="pct" type="number" min="1" max="100" step="0.5" value="${s.pct}" style="max-width:90px"> <span>%</span>
      <select data-k="trigger"><option value="firma" ${s.trigger === 'firma' ? 'selected' : ''}>${t('Al firmar')}</option><option value="tarea" ${s.trigger === 'tarea' ? 'selected' : ''}>${t('Al terminar una tarea')}</option><option value="manual" ${s.trigger === 'manual' ? 'selected' : ''}>${t('Yo aviso cuándo')}</option></select>
      <select data-k="task_id" ${s.trigger === 'tarea' ? '' : 'hidden'}><option value="">—</option>${p.tasks.map(tk => `<option value="${tk.id}" ${tk.id === s.task_id ? 'selected' : ''}>${esc(taskTitle(tk.title))}</option>`).join('')}</select>
      <button class="sm danger" data-del title="${t('Quitar')}">✕</button></div>`).join('')}</div>
    <div class="row between wrap"><span class="small" id="ssum"></span><span class="row"><button class="sm" id="sadd">${t('+ Etapa')}</button><button class="sm primary" id="ssave">${t('Guardar calendario')}</button></span></div>`;
  const bindSched = () => {
    const rows = () => $$('.srow', box).map(r => ({ label: $('[data-k=label]', r).value, pct: Number($('[data-k=pct]', r).value), trigger: $('[data-k=trigger]', r).value, task_id: Number($('[data-k=task_id]', r).value) || null }));
    const sum = () => { const s = rows().reduce((a, r) => a + (r.pct || 0), 0); $('#ssum', box).innerHTML = Math.abs(s - 100) < 0.01 ? `✓ ${t('Suma 100%')}` : `<span class="neg">${t('Suma {x}%: debe ser 100%', { x: Math.round(s * 100) / 100 })}</span>`; };
    $$('.srow', box).forEach(r => {
      $('[data-k=trigger]', r).onchange = e => { $('[data-k=task_id]', r).hidden = e.target.value !== 'tarea'; };
      $('[data-k=pct]', r).oninput = sum;
      $('[data-del]', r).onclick = () => { p.schedule = rows().filter((_, i) => i !== Number(r.dataset.i)); $('#schedbox', box).innerHTML = schedEditor(); bindSched(); };
    });
    $('#sadd', box).onclick = () => { p.schedule = [...rows(), { label: '', pct: 0, trigger: 'manual' }]; $('#schedbox', box).innerHTML = schedEditor(); bindSched(); };
    $('#ssave', box).onclick = async () => { await act(() => api('PUT', `/api/jobs/${id}/proposal`, { schedule: rows() }), t('Guardado')); again(); };
    sum();
  };
  if (!p.signed) {
    box.innerHTML = `<div class="card"><div class="row between wrap"><div><h2 style="margin:0">📝 ${t('Propuesta para el cliente')}</h2>
        <div class="small muted">${p.sent_at ? t('Mandada el {d}.', { d: fdate(p.sent_at) }) : t('Todavía no se ha mandado.')} ${p.changed_after_send ? `<b class="neg">${t('Cambió después de mandarla: vuelva a mandarla para que el cliente firme la versión nueva.')}</b>` : ''}</div></div>
        <div class="row wrap">${pdfLinks}<button class="primary" id="psend">📤 ${p.sent_at ? t('Volver a mandar') : t('Mandar al cliente')}</button></div></div>
      <div class="money-strip"><div><span>${t('Precio al cliente')}</span><b>${fmt(p.total_cents)}</b></div><div><span>${t('Costo estimado')}</span><b>${fmt(p.est_cost_cents)}</b></div>
        <div class="${low ? 'neg' : ''}"><span>${t('Margen estimado')}</span><b>${p.margin_pct == null ? '—' : p.margin_pct + '%'}</b></div></div>
      ${low ? `<p class="small neg">⚠️ ${t('El margen estimado está abajo de {x}%. Revise precios o costos antes de mandarla.', { x: p.alert_pct })}</p>` : ''}</div>
    <div class="card"><div class="row between"><h2 style="margin:0">${t('Partidas (lo que ve el cliente, sin costos)')}</h2><button class="sm primary" id="pl">${t('+ Partida')}</button></div>
      ${p.lines.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Partida')}</th><th class="num">${t('Precio')}</th><th class="num">${t('Costo est.')}</th><th class="num">%</th><th></th></tr></thead><tbody>
        ${p.lines.map(l => `<tr data-l="${l.id}"><td><b>${esc(l.trade)}</b>${l.description ? `<div class="small muted">${esc(l.description.slice(0, 160))}</div>` : ''}</td><td class="num">${fmt(l.sold_cents)}</td><td class="num muted">${l.est_cost_cents ? fmt(l.est_cost_cents) : '—'}</td>
          <td class="num ${l.margin_pct != null && l.margin_pct < p.alert_pct ? 'neg' : ''}">${l.est_cost_cents && l.margin_pct != null ? l.margin_pct + '%' : '—'}</td><td><button class="sm" data-ed>✎</button></td></tr>`).join('')}</tbody></table></div>`
        : `<p class="empty">${t('Agregue cada cosa que va a vender (patio cover, electricidad, cocina…) con su precio y su costo estimado.')}</p>`}</div>
    <div class="card"><h2>${t('Texto de la propuesta')}</h2>
      <div class="field"><label>${t('Descripción del proyecto')}</label><textarea id="pdesc" rows="3">${esc(p.job.description)}</textarea></div>
      <div class="field"><label>${t('Condiciones')}</label><textarea id="pterms" rows="4">${esc(p.terms)}</textarea></div>
      <div class="field" style="max-width:240px"><label>${t('Válida hasta')}</label><input type="date" id="pvalid" value="${esc(p.valid_until)}"></div>
      <button class="primary" id="ptsave">${t('Guardar texto')}</button></div>
    <div class="card"><h2>${t('Calendario de pagos')}</h2><p class="small muted">${t('Cada etapa es un % del contrato. Cuando se cumple (al firmar, al terminar una tarea, o cuando usted lo marque), la app le avisa que toca cobrar.')}</p><div id="schedbox">${schedEditor()}</div></div>`;
    $('#pl', box).onclick = () => lineDialog(id, null, again);
    $$('[data-l]', box).forEach(tr => { $('[data-ed]', tr).onclick = async () => { const all = await api('GET', `/api/jobs/${id}/lines`); lineDialog(id, all.lines.find(x => x.id === Number(tr.dataset.l)), again); }; });
    $('#ptsave', box).onclick = async () => { await act(() => api('PUT', `/api/jobs/${id}/proposal`, { description: $('#pdesc', box).value, terms: $('#pterms', box).value, valid_until: $('#pvalid', box).value }), t('Guardado')); again(); };
    bindSched();
    $('#psend', box).onclick = async () => {
      if (low && !confirm(t('El margen estimado está abajo de {x}%. ¿Mandarla de todos modos?', { x: p.alert_pct }))) return;
      try {
        const r = await api('POST', `/api/jobs/${id}/proposal/send`);
        const url = absUrl(r.url);
        const msg = tl(r.client_lang || 'en', 'Hola {n}, aquí está su propuesta de {c} por {m}. Puede verla y firmarla aquí: {u}', { n: r.client_name, c: r.company, m: fmt(r.total_cents), u: url });
        sendDialog(t('Propuesta lista para mandar'), url, r.client_phone, r.client_email, msg, t('Propuesta de {c}', { c: r.company }));
        again();
      } catch (e) { toast(e.message, true); }
    };
    return;
  }
  const ST = MS_ST();
  box.innerHTML = `<div class="card"><div class="row between wrap"><div><h2 style="margin:0">✅ ${t('Propuesta firmada')}</h2><div class="small muted">${t('Firmada por {n} el {d}.', { n: esc(p.signed.name), d: fdayLocal(p.signed.at) })}</div></div><div class="row wrap">${pdfLinks}${b.link ? `<button class="sm" id="cpl">🔗 ${t('Enlace del cliente')}</button>` : ''}</div></div></div>
    <div class="card"><h2>💵 ${t('Cobros por etapa')}</h2>
      <div class="money-strip"><div><span>${t('Contrato')}</span><b>${fmt(b.contract_cents)}</b></div>${b.cos_cents ? `<div><span>${t('Change orders')}</span><b>${fmt(b.cos_cents)}</b></div>` : ''}<div><span>${t('Pagado')}</span><b>${fmt(b.paid_cents)}</b></div><div><span>${t('Saldo')}</span><b>${fmt(b.balance_cents)}</b></div></div>
      <div class="table-wrap"><table><thead><tr><th>${t('Etapa')}</th><th class="num">${t('Monto')}</th><th>${t('Estado')}</th><th></th></tr></thead><tbody>
      ${b.milestones.map(m => `<tr data-m="${m.id}"><td><b>${esc(m.label)}</b> <span class="small muted">${m.pct}%</span>${m.cos_cents ? `<div class="small muted">${t('incluye change orders: {x}', { x: fmt(m.cos_cents) })}</div>` : ''}
          <div class="small muted">${m.trigger === 'firma' ? t('Al firmar') : m.trigger === 'tarea' ? t('Al terminar: {x}', { x: esc(taskTitle((p.tasks.find(x => x.id === m.task_id) || {}).title || '')) }) : t('Yo aviso cuándo')}</div></td>
        <td class="num">${fmt(m.amount_cents)}${m.covered_cents && m.status !== 'pagado' ? `<div class="small muted">${t('pagado {x}', { x: fmt(m.covered_cents) })}</div>` : ''}</td>
        <td><span class="badge ${ST[m.status][1]}">${ST[m.status][0]}</span>${m.invoice_number ? `<div class="small muted">${esc(m.invoice_number)} · ${t('vence {d}', { d: fdate(m.due_date) })}</div>` : ''}</td>
        <td class="nowrap">${m.status === 'pendiente' ? `<button class="sm" data-ready>${t('Ya toca cobrar')}</button>` : ''}${!m.invoice_number && m.status !== 'pagado' ? `<button class="sm primary" data-inv>${t('Facturar')}</button>` : ''}
          ${m.invoice_number ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/milestones/${m.id}/pdf?lang=es">PDF</a> <a class="btn sm" target="_blank" rel="noopener" href="/api/milestones/${m.id}/pdf?lang=en">EN</a>${m.status !== 'pagado' ? ` <button class="sm" data-resend>📤</button> <button class="sm link" data-void>${t('Anular')}</button>` : ''}` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">${t('Los pagos que registre en "Pagos del cliente" se aplican solos a las etapas, en orden. Los change orders aprobados se cobran en la última etapa.')}</p>
      ${b.milestones.some(m => m.invoice_number) ? '' : `<details><summary class="small">${t('Cambiar el calendario de pagos')}</summary><div id="schedbox">${schedEditor()}</div></details>`}</div>`;
  if ($('#schedbox', box)) bindSched();
  if ($('#cpl', box)) $('#cpl', box).onclick = () => navigator.clipboard && navigator.clipboard.writeText(absUrl(b.link)).then(() => toast(t('Copiado')));
  const sendInv = (r, m) => {
    const url = absUrl(r.url);
    const msg = tl(r.client_lang || 'en', 'Hola {n}, le mandamos el invoice {i} de {c} por {m} ({e}), con vencimiento el {d}. Puede verlo aquí: {u}', { n: r.client_name, i: r.invoice_number, c: r.company, m: fmt(r.amount_cents), e: m.label, d: fdateIn(r.client_lang || 'en', r.due_date), u: url });
    sendDialog(t('Invoice {x} listo', { x: r.invoice_number }), url, r.client_phone, r.client_email, msg, `${r.company} · ${r.invoice_number}`);
  };
  $$('[data-m]', box).forEach(tr => {
    const m = b.milestones.find(x => x.id === Number(tr.dataset.m));
    const q = s => $(s, tr);
    if (q('[data-ready]')) q('[data-ready]').onclick = async () => { await act(() => api('POST', `/api/milestones/${m.id}/ready`), t('Listo')); again(); };
    if (q('[data-inv]')) q('[data-inv]').onclick = async () => {
      const v = await formDialog({ title: t('Facturar: {x}', { x: m.label }), submit: t('Facturar'), intro: `<p><b>${fmt(m.amount_cents)}</b></p>`, fields: [{ name: 'due_days', label: t('Días para pagar'), type: 'number', value: '7' }],
        onSubmit: v => api('POST', `/api/milestones/${m.id}/invoice`, v) });
      if (v) { again(); const r = await api('GET', `/api/jobs/${id}/billing`); const mm = r.milestones.find(x => x.id === m.id); sendInv({ ...p.job, client_lang: p.client_lang, url: r.link + `&inv=${m.id}`, invoice_number: mm.invoice_number, amount_cents: mm.amount_cents, due_date: mm.due_date, company: COMPANY.name }, mm); }
    };
    if (q('[data-resend]')) q('[data-resend]').onclick = () => sendInv({ ...p.job, client_lang: p.client_lang, url: b.link + `&inv=${m.id}`, invoice_number: m.invoice_number, amount_cents: m.amount_cents, due_date: m.due_date, company: COMPANY.name }, m);
    if (q('[data-void]')) q('[data-void]').onclick = async () => { if (!confirm(t('¿Anular el invoice {x}?', { x: m.invoice_number }))) return; await act(() => api('DELETE', `/api/milestones/${m.id}/invoice`), t('Listo')); again(); };
  });
}
function sendDialog(title, url, phone, email, msg, subject) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<h2>${esc(title)}</h2><p class="small muted">${t('Mándeselo al cliente por donde prefiera:')}</p>
    <div class="card small mono" style="word-break:break-all">${esc(url)}</div>
    <div class="row wrap" style="gap:.4rem">${sendButtons(phone, msg, email, subject)}<button class="sm" data-cp>🔗 ${t('Copiar enlace')}</button></div>
    <div class="foot"><button data-x class="primary">${t('Listo')}</button></div>`;
  document.body.appendChild(dlg);
  $('[data-x]', dlg).onclick = () => { dlg.close(); dlg.remove(); };
  $('[data-cp]', dlg).onclick = () => navigator.clipboard && navigator.clipboard.writeText(url).then(() => toast(t('Copiado')));
  dlg.showModal();
}
// Inicio del dueño: lo que toca cobrar y lo vencido.
async function billingDueCard(app) {
  const due = await api('GET', '/api/billing/due').catch(() => []);
  if (!due.length || !app.isConnected) return;
  const c = document.createElement('div'); c.className = 'card notices';
  c.innerHTML = `<h2>💵 ${t('Cobros')}</h2>${due.map(m => `<div class="notice small"><a href="#/obra/${m.job_id}/propuesta"><b>${esc(m.client_name)}</b></a> · ${esc(m.label)} · <b>${fmt(m.amount_cents - m.covered_cents)}</b>
    <span class="badge ${m.status === 'vencido' ? 'b-late' : 'b-urg'}">${m.status === 'vencido' ? t('Vencido desde el {d}', { d: fdate(m.due_date) }) : t('Toca cobrar')}</span></div>`).join('')}`;
  const anchor = app.children[2] || null; app.insertBefore(c, anchor);
}
// Portal del cliente: su calendario de pagos y sus invoices.
async function clientBillingCard(app, j) {
  const b = await api('GET', `/api/jobs/${j.id}/billing`).catch(() => null);
  if (!b || !b.signed || !b.milestones.length || !app.isConnected) return;
  const ST = MS_ST(); ST.por_cobrar = [t('Por pagar'), 'b-pendiente']; ST.facturado = [t('Por pagar'), 'b-pendiente'];
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h2>${t('Calendario de pagos')}</h2><table><tbody>${b.milestones.map(m => `<tr><td><b>${esc(m.label)}</b> <span class="small muted">${m.pct}%</span>${m.invoice_number && m.status !== 'pagado' ? `<div class="small muted">${t('vence {d}', { d: fdate(m.due_date) })}</div>` : ''}</td>
    <td class="num">${fmt(m.amount_cents)}</td><td>${m.status === 'pendiente' ? '' : `<span class="badge ${ST[m.status][1]}">${ST[m.status][0]}</span>`}</td>
    <td>${m.invoice_number ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/milestones/${m.id}/pdf?lang=${LANG}">${esc(m.invoice_number)}</a>` : ''}</td></tr>`).join('')}</tbody></table>`;
  const portal = $('.portal', app); if (portal) portal.insertBefore(c, portal.lastElementChild);
}

// =====================================================================
// PAPELES DE LOS SUBS: W-9, seguro, lien waivers y 1099 (Dinero → Subs: papeles y 1099)
// =====================================================================
const TAXC = () => ({ individual: t('Persona (sole proprietor)'), llc: t('LLC'), llc_corp: t('LLC como corporación'), corp: t('Corporación (C o S)'), otro: t('Otro') });
const LWK = () => ({ cond_parcial: t('Condicional, pago parcial'), incond_parcial: t('Incondicional, pago parcial'), cond_final: t('Condicional, pago final'), incond_final: t('Incondicional, pago final') });
const COI_B = () => ({ ok: ['✓', 'b-hecho'], por_vencer: [t('Vence pronto'), 'b-pendiente'], vencido: [t('Vencido'), 'b-late'], falta: [t('Falta'), ''] });
async function viewPapers(box, year) {
  const r = await api('GET', `/api/papers${year ? '?year=' + year : ''}`);
  const y = Number(r.year), CB = COI_B();
  box.innerHTML = `<div class="card"><div class="row between wrap"><div><h2 style="margin:0">📁 ${t('Papeles de los subs')}</h2>
      <div class="small muted">${t('W-9, seguro con vencimiento, lien waivers de cada pago y lo que hay que reportar en 1099.')}</div></div>
      <div class="row"><button class="sm" data-y="${y - 1}">‹</button><b>${y}</b><button class="sm" data-y="${y + 1}">›</button><a class="btn sm" href="/api/papers-1099?year=${y}">⬇ ${t('Reporte 1099 (CSV)')}</a></div></div>
    <p class="small muted">${t('1099-NEC: a cada sub que no sea corporación y al que le pagaron {x} o más en {y}. Confirme con su contador.', { x: fmt0(r.threshold_cents), y })}</p>
    ${r.people.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Sub')}</th><th>W-9</th><th>${t('Seguro')}</th><th class="num">${t('Pagado en {y}', { y })}</th><th>1099</th><th>${t('Lien waivers')}</th><th></th></tr></thead><tbody>
      ${r.people.map(p => `<tr data-k="${esc(p.key)}" class="${p.active ? '' : 'muted'}"><td><b>${esc(p.name)}</b>${p.trade ? `<div class="small muted">${esc(p.trade)}</div>` : ''}</td>
        <td>${p.w9 ? `<span class="badge b-hecho">✓</span><div class="small muted">${esc(TAXC()[p.tax_class] || '')}</div>` : `<span class="badge ${p.needs_1099 ? 'b-late' : ''}">${t('Falta')}</span>`}</td>
        <td><span class="badge ${CB[p.coi][1]}">${CB[p.coi][0]}</span>${p.coi_expires ? `<div class="small muted">${t('vence {d}', { d: fdate(p.coi_expires) })}</div>` : ''}</td>
        <td class="num">${fmt0(p.paid_year_cents)}</td><td>${p.needs_1099 ? `<span class="badge b-pendiente">${t('Sí')}</span>` : '—'}</td>
        <td>${p.payments ? (p.missing_waivers ? `<span class="neg small">${t('Faltan {n} de {m}', { n: p.missing_waivers, m: p.payments })}</span>` : `<span class="badge b-hecho">✓ ${p.payments}</span>`) : '—'}</td>
        <td><button class="sm" data-open>${t('Abrir')}</button></td></tr>`).join('')}</tbody></table></div>`
      : `<p class="empty">${t('Cuando agregue subs a sus obras, aparecen aquí.')}</p>`}
    <p class="small muted">${t('Formas oficiales:')} <a href="${r.links.w9}" target="_blank" rel="noopener">W-9 (IRS)</a> · <a href="${r.links.lien_forms}" target="_blank" rel="noopener">${t('Lien waivers de Texas (Property Code 53.284)')}</a>. ${t('En Texas el waiver solo vale si usa esas formas tal cual: imprímalas, que el sub las firme y súbalas aquí.')}</p></div>`;
  $$('[data-y]', box).forEach(b => { b.onclick = () => viewPapers(box, b.dataset.y); });
  $$('[data-open]', box).forEach(b => { b.onclick = () => paperDialog(b.closest('tr').dataset.k, () => viewPapers(box, r.year)); });
}
async function paperDialog(key, after) {
  const p = await api('GET', `/api/papers/${encodeURIComponent(key)}`);
  const dlg = document.createElement('dialog'); dlg.className = 'wide';
  const fileLink = (n, label) => n ? `<a target="_blank" rel="noopener" href="/api/papers-file/${encodeURIComponent(n)}">📎 ${label}</a>` : '';
  const CB = COI_B();
  dlg.innerHTML = `<div class="row between"><h2 style="margin:0">${esc(p.name)}</h2><button class="sm" data-x>✕</button></div>
    <div class="grid two" style="margin-top:.6rem">
      <form class="card" id="pw9"><h3>W-9</h3><p class="small">${p.w9_file ? `✓ ${t('Recibido el {d}', { d: fdate(p.w9_date) })} · ${fileLink(p.w9_file, t('Ver'))}` : `<span class="neg">${t('Falta el W-9')}</span>`}</p>
        <div class="field"><label>${t('Tipo de negocio (casilla 3 del W-9)')}</label><select name="tax_class"><option value="">—</option>${Object.entries(TAXC()).map(([k, l]) => `<option value="${k}" ${k === p.tax_class ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label>${p.w9_file ? t('Cambiar W-9 (foto o PDF)') : t('Subir W-9 (foto o PDF)')}</label><input type="file" name="w9" accept="image/*,application/pdf"></div>
        <button class="primary sm">${t('Guardar')}</button></form>
      <form class="card" id="pcoi"><h3>${t('Seguro (certificado)')}</h3><p class="small"><span class="badge ${CB[p.coi][1]}">${CB[p.coi][0]}</span> ${fileLink(p.coi_file, t('Ver certificado'))}</p>
        <div class="field"><label>${t('Vence el')}</label><input type="date" name="coi_expires" value="${esc(p.coi_expires)}"></div>
        <div class="field"><label>${t('Aseguradora')}</label><input name="coi_carrier" value="${esc(p.coi_carrier)}"></div>
        <div class="field"><label>${t('Certificado (foto o PDF)')}</label><input type="file" name="coi" accept="image/*,application/pdf"></div>
        <button class="primary sm">${t('Guardar')}</button></form></div>
    <div class="card"><h3>${t('Pagos y lien waivers')}</h3>${p.payments.length ? `<table class="small"><tbody>${p.payments.map(x => `<tr data-p="${x.id}"><td class="nowrap">${fdate(x.date)}</td><td>${esc(x.client_name)}</td><td class="num">${fmt(x.amount_cents)}</td>
      <td>${x.waiver ? `✓ ${esc(LWK()[x.waiver.kind])} · ${fileLink(x.waiver.file, t('Ver'))}` : `<button class="sm" data-lw>${t('Subir waiver')}</button>`}</td></tr>`).join('')}</tbody></table>` : `<p class="empty small">${t('Todavía no hay pagos a este sub.')}</p>`}</div>
    <div class="foot"><button data-x class="primary">${t('Listo')}</button></div>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); after(); };
  $$('[data-x]', dlg).forEach(b => { b.onclick = close; });
  const file = async inp => inp.files[0] ? readDocFile(inp.files[0]) : undefined;
  $('#pw9', dlg).onsubmit = async e => { e.preventDefault(); const f = e.target; try { await api('PUT', `/api/papers/${encodeURIComponent(key)}`, { tax_class: f.tax_class.value, w9: await file(f.w9) }); toast(t('Guardado')); dlg.close(); dlg.remove(); paperDialog(key, after); } catch (err) { toast(err.message, true); } };
  $('#pcoi', dlg).onsubmit = async e => { e.preventDefault(); const f = e.target; try { await api('PUT', `/api/papers/${encodeURIComponent(key)}`, { coi_expires: f.coi_expires.value, coi_carrier: f.coi_carrier.value, coi: await file(f.coi) }); toast(t('Guardado')); dlg.close(); dlg.remove(); paperDialog(key, after); } catch (err) { toast(err.message, true); } };
  $$('[data-lw]', dlg).forEach(b => { b.onclick = async () => {
    const id = Number(b.closest('tr').dataset.p);
    const v = await formDialog({ title: t('Lien waiver'), submit: t('Guardar'), intro: `<p class="small">${t('Suba el waiver firmado por el sub, en la forma oficial de Texas.')}</p>`, fields: [
      { name: 'kind', label: t('Tipo'), type: 'select', value: 'incond_parcial', options: Object.entries(LWK()) },
      { name: 'file', label: t('Waiver firmado (foto o PDF)'), type: 'doc', required: true }],
      onSubmit: v => api('POST', `/api/papers/${encodeURIComponent(key)}/waivers`, { sub_payment_id: id, kind: v.kind, file: v.file }) });
    if (v) { toast(t('Guardado')); dlg.close(); dlg.remove(); paperDialog(key, after); }
  }; });
  dlg.showModal();
}
async function papersAlertCard(app) {
  const a = await api('GET', '/api/papers-alerts').catch(() => []);
  if (!a.length || !app.isConnected) return;
  const c = document.createElement('div'); c.className = 'card notices';
  c.innerHTML = `<div class="row between"><h2>📁 ${t('Papeles de subs')}</h2><a class="btn sm" href="#/dinero/subs">${t('Ver')}</a></div>${a.map(x => `<div class="notice small"><b>${esc(x.name)}</b> · ${x.kind === 'w9' ? t('falta el W-9 (ya le pagaron {x} este año)', { x: fmt0(x.paid_cents) }) : x.kind === 'vencido' ? `<span class="neg">${t('seguro vencido el {d}', { d: fdate(x.date) })}</span>` : t('el seguro vence el {d}', { d: fdate(x.date) })}</div>`).join('')}`;
  app.insertBefore(c, app.children[2] || null);
}

// =====================================================================
// PUBLICIDAD: costo por cliente ganado (Dinero → Publicidad)
// =====================================================================
async function viewMarketing(box, months = 6) {
  const r = await api('GET', `/api/marketing?months=${months}`);
  const T = r.totals;
  box.innerHTML = `<div class="card"><div class="row between wrap"><div><h2 style="margin:0">📣 ${t('¿Qué publicidad trae clientes?')}</h2>
      <div class="small muted">${t('Anote cuánto gasta cada mes en cada canal. La app lo cruza con los prospectos, estimados y ventas de ese canal.')}</div></div>
      <div class="row"><select id="mm" style="width:auto">${[3, 6, 12, 24].map(n => `<option value="${n}" ${n === r.months ? 'selected' : ''}>${t('Últimos {n} meses', { n })}</option>`).join('')}</select><button class="primary" id="addsp">${t('+ Gasto en publicidad')}</button></div></div>
    <div class="money-strip"><div><span>${t('Gastado')}</span><b>${fmt0(T.spend_cents)}</b></div><div><span>${t('Prospectos')}</span><b>${T.leads}</b></div><div><span>${t('Ventas ganadas')}</span><b>${T.won} · ${fmt0(T.won_cents)}</b></div>
      <div><span>${t('Costo por cliente ganado')}</span><b>${T.won && T.spend_cents ? fmt0(Math.round(T.spend_cents / T.won)) : '—'}</b></div></div>
    ${r.rows.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Canal')}</th><th class="num">${t('Gastado')}</th><th class="num">${t('Prospectos')}</th><th class="num">${t('Estimados')}</th><th class="num">${t('Ganadas')}</th><th class="num">${t('Vendido')}</th><th class="num">${t('Costo por prospecto')}</th><th class="num">${t('Costo por venta')}</th><th class="num">${t('Retorno')}</th></tr></thead><tbody>
      ${r.rows.map(c => `<tr><td><b>${esc(t(c.channel))}</b></td><td class="num">${c.spend_cents ? fmt0(c.spend_cents) : '—'}</td><td class="num">${c.leads}</td><td class="num">${c.sent}</td><td class="num">${c.won}${c.close_pct != null ? `<div class="small muted">${c.close_pct}%</div>` : ''}</td>
        <td class="num">${fmt0(c.won_cents)}</td><td class="num">${c.cost_per_lead_cents != null ? fmt0(c.cost_per_lead_cents) : '—'}</td><td class="num"><b>${c.cost_per_won_cents != null ? fmt0(c.cost_per_won_cents) : '—'}</b></td>
        <td class="num ${c.return_x != null && c.return_x < 1 ? 'neg' : ''}">${c.return_x != null ? c.return_x + '×' : '—'}</td></tr>`).join('')}</tbody></table></div>`
      : `<p class="empty">${t('Todavía no hay datos. Anote lo que gastó este mes y ponga de dónde vino cada prospecto.')}</p>`}
    <p class="small muted">${t('Retorno = lo vendido entre lo gastado (3× quiere decir que cada $1 trajo $3 en ventas). Los referidos casi no cuestan: cuídelos con la petición de reseña al terminar cada obra.')}</p></div>
    ${r.spends.length ? `<div class="card"><h3>${t('Gastos anotados')}</h3><table class="small"><tbody>${r.spends.map(s => `<tr><td>${esc(s.month)}</td><td>${esc(t(s.channel))}</td><td class="num">${fmt0(s.amount_cents)}</td><td class="muted">${esc(s.note)}</td><td><button class="sm link" data-dsp="${s.id}">✕</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;
  $('#mm', box).onchange = e => viewMarketing(box, Number(e.target.value));
  const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#addsp', box).onclick = async () => { if (await formDialog({ title: t('Gasto en publicidad'), fields: [
    { name: 'month', label: t('Mes'), type: 'month', value: ym, required: true },
    { name: 'channel', label: t('Canal'), type: 'select', value: 'Google', options: r.channels_known.map(c => [c, t(c)]) },
    { name: 'amount_cents', label: t('Monto ($)'), type: 'money', required: true }, { name: 'note', label: t('Nota') }],
    onSubmit: v => api('POST', '/api/marketing/spend', v) })) { toast(t('Guardado')); viewMarketing(box, months); } };
  $$('[data-dsp]', box).forEach(b => { b.onclick = async () => { await act(() => api('DELETE', `/api/marketing/spend/${b.dataset.dsp}`), t('Borrado')); viewMarketing(box, months); }; });
}

// =====================================================================
// CIERRE DE OBRA: pendientes finales y firma de entrega del cliente (pestaña Tareas, dueños)
// =====================================================================
async function closeoutCard(box, jobId) {
  const r = await api('GET', `/api/jobs/${jobId}/closeout-list`).catch(() => null);
  if (!r || !box.isConnected) return;
  const c = document.createElement('div'); c.className = 'card';
  const open = r.items.filter(i => i.status !== 'hecho').length;
  c.innerHTML = `<div class="row between wrap"><h2 style="margin:0">🏁 ${t('Entrega de la obra')}</h2>${r.signed ? `<span class="badge b-hecho">✓ ${t('Firmada por {n} el {d}', { n: esc(r.signed.name), d: fdayLocal(r.signed.at) })}</span>` : `<button class="sm" id="pnew">${t('+ Pendiente')}</button>`}</div>
    <p class="small muted">${t('Antes de entregar, anote lo que falta (retoques, limpieza, un foco). Cuando todo esté hecho, pida la firma del cliente: la obra queda terminada, empieza la garantía y al cliente se le pide una reseña.')}</p>
    ${r.items.length ? `<ul class="punch">${r.items.map(i => `<li data-p="${i.id}"><label class="check"><input type="checkbox" ${i.status === 'hecho' ? 'checked' : ''} ${r.signed ? 'disabled' : ''}> <span>${esc(i.text)}</span></label>${r.signed ? '' : `<button class="sm link" data-del>✕</button>`}</li>`).join('')}</ul>` : `<p class="empty small">${t('Sin pendientes anotados.')}</p>`}
    ${r.signed ? `<p><a class="btn sm" target="_blank" rel="noopener" href="/api/jobs/${jobId}/closeout-signature">✍️ ${t('Ver firma')}</a></p>` : `<button class="primary" id="preq" ${open ? 'disabled' : ''}>✍️ ${r.requested ? t('Volver a mandar la firma de entrega') : t('Pedir firma de entrega al cliente')}</button>${open ? ` <span class="small muted">${t('Faltan {n} pendientes', { n: open })}</span>` : ''}`}`;
  box.appendChild(c);
  const again = () => { c.remove(); closeoutCard(box, jobId); };
  if ($('#pnew', c)) $('#pnew', c).onclick = async () => { if (await formDialog({ title: t('Pendiente de entrega'), fields: [{ name: 'text', label: t('Qué falta'), required: true }], onSubmit: v => api('POST', `/api/jobs/${jobId}/punch`, v) })) again(); };
  $$('[data-p]', c).forEach(li => {
    const cb = $('input', li); if (cb) cb.onchange = async () => { await api('PUT', `/api/punch/${li.dataset.p}`, { status: cb.checked ? 'hecho' : 'pendiente' }).catch(e => toast(e.message, true)); again(); };
    const del = $('[data-del]', li); if (del) del.onclick = async () => { await act(() => api('DELETE', `/api/punch/${li.dataset.p}`), t('Borrado')); again(); };
  });
  if ($('#preq', c)) $('#preq', c).onclick = async () => {
    try {
      const q = await api('POST', `/api/jobs/${jobId}/closeout-request`);
      const url = absUrl(q.url);
      sendDialog(t('Firma de entrega lista para mandar'), url, q.client_phone, q.client_email,
        tl(q.client_lang || 'en', 'Hola {n}, terminamos su proyecto. Por favor revíselo y firme la entrega aquí: {u} ¡Gracias por elegir a {c}!', { n: q.client_name, u: url, c: q.company }), `${q.company}`);
      again();
    } catch (e) { toast(e.message, true); }
  };
}
