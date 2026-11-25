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
// Cliente: al terminar la obra, la encuesta (2 minutos). Solo al final.
async function clientRatingCard(app, j) {
  if (j.status !== 'terminado') return;
  const r = await api('GET', `/api/jobs/${j.id}/survey`).catch(() => null); if (!r || !r.survey) return;
  const c = document.createElement('div'); c.className = 'card rating';
  const portal = $('.portal', app) || app; portal.insertBefore(c, portal.children[1]);
  c.innerHTML = r.survey.answered
    ? `<h2>⭐ ${t('¡Gracias por su opinión!')}</h2><p class="muted">${t('Nos ayuda a mejorar.')}</p>`
    : `<h2>⭐ ${t('¿Cómo le fue con su proyecto?')}</h2><p class="muted">${t('Son 2 minutos. Su opinión sincera nos ayuda a mejorar; sus comentarios los leen solo los dueños de la compañía.')}</p>
       <a class="btn primary" href="${esc(r.survey.url)}${LANG ? '&lang=' + LANG : ''}">${t('Contestar la encuesta')}</a>`;
}

// ===================== v2.32 — Opiniones de clientes (solo dueños) =====================
const SQ = () => ({ q_clean: t('Limpieza'), q_time: t('Puntualidad'), q_comm: t('Comunicación'), q_quality: t('Calidad del trabajo'), q_crew: t('La cuadrilla') });
const starTxt = v => (v == null ? '—' : `${v.toFixed(1)} ★`);
async function viewOpinions(app) {
  const r = await api('GET', '/api/surveys');
  const Q = SQ();
  const bar = v => `<div class="opbar"><span style="width:${v == null ? 0 : v / 5 * 100}%" class="${v != null && v < 4 ? 'lowv' : ''}"></span></div>`;
  const tbl = (title, rows, label = x => esc(x.name || '—')) => rows.length ? `<div class="card"><h2>${title}</h2><div class="table-wrap"><table><thead><tr><th></th><th class="num">${t('Encuestas')}</th><th class="num">${t('Promedio')}</th><th class="num">${t('Bajas')}</th></tr></thead>
    <tbody>${rows.map(x => `<tr><td>${label(x)}</td><td class="num">${x.n}</td><td class="num"><b class="${x.avg != null && x.avg < 4 ? 'neg' : ''}">${starTxt(x.avg)}</b></td><td class="num">${x.low || ''}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  const ans = a => `<div class="opans ${a.low ? 'low' : ''}" data-id="${a.job_id}">
    <div class="row between wrap"><div><b>${esc(a.client_name)}</b> <span class="small muted">· ${typeLabel(a.project_type)} · ${fdate(String(a.answered_at).slice(0, 10))}${a.pm_name ? ' · PM ' + esc(a.pm_name) : ''}</span></div>
      <div>${a.low ? `<span class="badge oplow">${t('Opinión baja')}</span> ` : ''}<b>${starTxt(a.avg)}</b>${a.nps != null ? ` <span class="small muted">· ${t('Recomienda')}: ${a.nps}/10</span>` : ''}</div></div>
    <div class="opq small">${Object.entries(Q).map(([k, l]) => `<span>${l}: <b class="${a[k] <= 2 ? 'neg' : ''}">${a[k]}</b></span>`).join('')}</div>
    ${a.improve ? `<p class="opt"><b>${t('Qué mejorar')}:</b> ${esc(a.improve)}</p>` : ''}${a.liked ? `<p class="opt muted"><b>${t('Lo que le gustó')}:</b> ${esc(a.liked)}</p>` : ''}
    ${a.subs.length ? `<div class="small muted">${t('Trabajaron')}: ${a.subs.map(esc).join(', ')}</div>` : ''}
    ${a.low ? (a.followed_at ? `<div class="small pos">✓ ${t('Contactado por {x}', { x: esc(a.followed_name) })} · ${fdate(String(a.followed_at).slice(0, 10))}${a.followed_note ? ` · ${esc(a.followed_note)}` : ''}</div>`
      : `<div class="row" style="margin-top:.4rem"><button class="sm primary" data-follow>📞 ${t('Ya le llamé')}</button></div>`) : ''}</div>`;
  const toCall = r.answers.filter(a => a.low && !a.followed_at);
  app.innerHTML = `<h1>${t('Opiniones de clientes')}</h1>
    <p class="muted">${t('La encuesta le llega al cliente solo al terminar la obra. Lo que escribe lo ven solo los dueños.')}</p>
    <div class="okpis">
      <div class="card okpi"><div class="small muted">${t('Contestadas')}</div><div class="big">${r.answered} / ${r.sent}</div></div>
      <div class="card okpi"><div class="small muted">${t('Promedio')}</div><div class="big">${starTxt(r.avg)}</div></div>
      <div class="card okpi"><div class="small muted">${t('Recomendación (NPS)')}</div><div class="big">${r.nps == null ? '—' : r.nps}</div><div class="small muted">${t('de -100 a 100')}</div></div>
      <div class="card okpi"><div class="small muted">${t('Por llamar')}</div><div class="big ${r.to_call ? 'neg' : ''}">${r.to_call}</div></div>
    </div>
    ${toCall.length ? `<div class="card op-call"><h2>📞 ${t('Opiniones bajas por atender')}</h2>${toCall.map(ans).join('')}</div>` : ''}
    <div class="card"><h2>${t('En qué vamos bien y en qué mejorar')}</h2>${r.answered ? Object.entries(Q).map(([k, l]) => `<div class="opline"><span>${l}</span>${bar(r.by_question[k])}<b>${starTxt(r.by_question[k])}</b></div>`).join('') : `<p class="muted">${t('Todavía no hay respuestas.')}</p>`}</div>
    <div class="grid2">${tbl(t('Por project manager'), r.by_pm, x => esc(x.name || t('Sin PM')))}${tbl(t('Por tipo de proyecto'), r.by_type, x => typeLabel(x.name))}</div>
    ${tbl(t('Por sub o trabajador'), r.by_sub)}
    <div class="card"><h2>${t('Todas las respuestas')}</h2>${r.answers.length ? r.answers.map(ans).join('') : `<p class="muted">${t('Todavía no hay respuestas.')}</p>`}</div>
    ${r.unanswered.length ? `<div class="card"><h2>⏳ ${t('Sin contestar')}</h2><p class="small muted">${t('El texto para el cliente está listo en Textos. Si no contesta en 3 días, sale un recordatorio (solo uno).')}</p>
      ${r.unanswered.map(p => `<div class="rev-row"><div><b>${esc(p.client_name)}</b><div class="small muted">${t('Enviada')} ${fdate(String(p.created_at).slice(0, 10))}${p.reminded ? ' · ' + t('recordatorio enviado') : ''}</div></div><button class="sm" data-copy="${esc(p.url)}">🔗 ${t('Copiar enlace')}</button></div>`).join('')}</div>` : ''}`;
  $$('[data-follow]', app).forEach(b => { b.onclick = async () => {
    const id = b.closest('[data-id]').dataset.id;
    if (await formDialog({ title: t('Ya le llamé'), fields: [{ name: 'note', label: t('¿Qué se acordó? (opcional)'), type: 'textarea' }], onSubmit: v => api('POST', `/api/surveys/${id}/followed`, v) })) { toast(t('Guardado')); viewOpinions(app); } }; });
  $$('[data-copy]', app).forEach(b => { b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast(t('Enlace copiado')); } catch { prompt('', b.dataset.copy); } }; });
}
// Inicio de los dueños: opiniones bajas por atender.
async function opinionsHomeCard(app) {
  if (ME.role !== 'owner') return;
  const r = await api('GET', '/api/surveys').catch(() => null); if (!r || !r.to_call) return;
  const c = document.createElement('a'); c.className = 'card row between mfa-nag'; c.href = '#/opiniones';
  c.innerHTML = `<span>📞 <b>${t('{n} cliente(s) calificaron bajo', { n: r.to_call })}</b> · ${t('Llámeles para arreglarlo.')}</span><span class="btn sm primary">${t('Ver')}</span>`;
  putTop(app, c);
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
  c.innerHTML = `<div><h2 style="margin:0">📋 ${t('Armar las tareas de la obra')}</h2>
    <div class="small muted">${t('Use una plantilla, importe el SCHEDULE de la hoja de la obra, o deje que la AI proponga el plan leyendo el estimado. Siempre lo revisa antes de guardar.')}</div></div>
    <div class="row wrap" style="margin-top:.6rem"><button class="primary" id="mkplan">${d.tasks.length ? t('Plantilla o AI') : t('Usar plantilla o AI')}</button>
      <button id="imsch">📥 ${t('Importar SCHEDULE')}</button>${d.tasks.length ? `<button id="insp">🏛️ ${t('Inspecciones de la ciudad')}</button>` : ''}${d.tasks.some(x => x.trade && x.status !== 'hecho') ? `<button id="abt">👷 ${t('Asignar por trade')}</button>` : ''}${d.tasks.length ? `<button id="cln">🧹 ${t('Quitar tareas que no se usan')}</button>` : ''}
      ${ME.role === 'owner' ? `<a class="btn" href="#/plantillas">✎ ${t('Editar plantillas')}</a>` : ''}</div>`;
  $('#mkplan', c).onclick = () => planDialog(d, { id, workers, reload });
  $('#imsch', c).onclick = () => scheduleImportDialog(d, { id, reload });
  const cl = $('#cln', c); if (cl) cl.onclick = () => taskCleanupDialog(d, { id, reload });
  const ab = $('#abt', c); if (ab) ab.onclick = () => assignByTradeDialog(d, { id, workers, reload });
  const ins = $('#insp', c); if (ins) ins.onclick = async () => { if (await inspectionsDialog(id, null)) reload(); };
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
      <div class="field"><label>${t('Partir de')}</label><select id="pt"><option value="">${st.ai ? t('AI (leer el estimado)') : t('Plan base')}</option>${st.ai ? `<option value="base">${t('Plantilla sugerida de la app')}</option>` : ''}${mine.concat(templates.filter(x => !mine.includes(x))).map(x => `<option value="${x.id}" ${x.is_default && x.project_type === d.job.project_type && !st.ai ? 'selected' : ''}>${t('Plantilla')}: ${esc(x.name)}${x.is_default ? ' ★' : ''}</option>`).join('')}</select></div>
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
    <div class="field full"><label>${t('Foto de cerca (close-up)')}</label><input type="file" name="image" accept="image/*"><div class="hint">${t('Una foto de cerca de la muestra o del material instalado, con buena luz.')}</div></div>
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
async function pickMaterial(jobId, after, d) {
  const r = await api('GET', '/api/materials'); MAT_ZONES = r.zones;
  const dlg = document.createElement('dialog'); dlg.className = 'wide';
  dlg.innerHTML = `<div class="row between"><h2 style="margin:0">${t('Agregar material a la ficha')}</h2><button class="sm" data-x>✕</button></div>
    <div class="row wrap"><input id="pq" type="search" placeholder="${t('Buscar…')}" style="flex:1"><button id="pnew" class="primary">${t('+ Material nuevo')}</button></div>
    <div class="matgrid pick">${r.materials.map(m => `<button class="mat" data-id="${m.id}" data-s="${esc([m.name, m.color_name, m.brand, m.kind, zoneName(m.zone)].join(' ').toLowerCase())}">${swatch(m)}<div class="mat-txt"><b>${esc(matTitle(m))}</b><div class="small muted">${esc(zoneName(m.zone))} · ${esc(matSub(m))}</div></div></button>`).join('')}</div>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  const choose = async (mid, name) => {
    close();
    const g = d ? guessStage(d) : { task_id: '', trade: '' };
    const m = (r.materials || []).find(x => x.id === mid);
    const tr = guessTrade(m && m.kind, m && m.name, m && zoneName(m.zone)) || g.trade;
    const v = await formDialog({ title: t('¿Dónde se usó? · {x}', { x: name }), fields: [{ name: 'area', label: t('Área'), hint: t('Ej. Ceiling del patio, Fascia, Cubierta de la isla') },
      ...(d ? [{ name: 'task_id', label: t('Etapa'), type: 'select', value: g.task_id, options: [['', t('— general —')], ...(d.tasks || []).map(x => [x.id, taskTitle(x.title)])] }] : []),
      { name: 'trade', label: t('Trade'), type: 'select', value: tr, options: [['', '—'], ...TRADES()] },
      { name: 'note', label: t('Nota (cantidad, código, lote)') }],
      onSubmit: v => api('POST', `/api/jobs/${jobId}/materials`, { material_id: mid, ...v, task_id: v.task_id || null }) });
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
        <div class="small muted">${esc(matSub(x.material))}</div>${x.area || x.note ? `<div class="small">${[x.area && esc(x.area), x.note && esc(x.note)].filter(Boolean).join(' · ')}</div>` : ''}
        ${x.task_title || x.trade ? `<span class="ph-tags">${x.task_title ? `<span>${esc(taskTitle(x.task_title))}</span>` : ''}${x.trade ? `<span class="tr">${esc(tradeLabel(x.trade))}</span>` : ''}</span>` : ''}</div>
        <button class="sm" data-see>${t('Ver')}</button><button class="sm danger" data-rm>✕</button></div>`).join('')}`).join('')
      : `<p class="empty">${t('Agregue el ceiling, la fascia, el stain o pintura, la cubierta de la cocina…')}</p>`}</div>
    <div class="card"><h2>🖼️ ${t('Galería de trabajos terminados')}</h2>
      <p class="small muted">${t('Al marcar la obra como Terminado, las fotos finales entran solas a la galería (y las que suba después). Aparecen en el catálogo de materiales, sin nombre ni dirección del cliente. Toque ★ para quitar o poner una foto.')}</p>
      <p class="small"><b>${t('{a} de {b} fotos en la galería', { a: nGal, b: photos.length })}</b></p>
      ${photos.length ? `<div class="photos gal">${photos.map(p => `<figure class="${p.gallery ? 'ing' : ''}"><img src="/files/${p.id}" data-view="${p.id}" alt="" loading="lazy">
        <button class="star ${p.gallery ? 'on' : ''}" data-g="${p.id}" title="${p.gallery ? t('Quitar de la galería') : t('Poner en la galería')}">★</button><figcaption>${esc(p.caption || '')} ${fdate(p.created_at.slice(0, 10))}</figcaption></figure>`).join('')}</div>`
      : `<p class="empty">${t('Sin fotos todavía.')}</p>`}</div>`;
  $('#addm', box).onclick = () => pickMaterial(id, reload, d);
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
    ${phone ? '' : '<div data-drafts></div>'}<div class="sms-wrap ${phone ? 'has-thread' : ''}"><div class="sms-list card">${threads.length ? threads.map(th => `<a class="sms-th ${th.phone === phone ? 'on' : ''}" href="#/textos/${encodeURIComponent(th.phone)}">
      <div class="row between"><b>${esc(th.name || th.phone)}</b>${th.unread ? `<span class="badge b-late">${th.unread}</span>` : ''}</div>
      <div class="small muted">${esc(th.role_label ? t(th.role_label) : th.phone)} · ${smsTime(th.last.created_at)}</div>
      <div class="small one-line">${th.last.direction === 'out' ? '↗ ' : ''}${esc(th.last.body)}</div></a>`).join('') : `<p class="empty small">${t('Todavía no hay textos.')}</p>`}</div>
    <div class="sms-thread card" id="smsth">${phone ? '' : `<p class="empty small">${t('Elija una conversación o mande un texto nuevo.')}</p>`}</div></div>`;
  if ($('#nsms')) $('#nsms').onclick = () => newTextDialog();
  if ($('[data-drafts]', app)) draftsCard($('[data-drafts]', app), () => viewTexts(app, phone)).catch(e => console.error(e));
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
  await (ME.role === 'pm' ? viewPmHome(inner) : viewDashboard(inner));
  planTodayCard(inner).catch(e => console.error(e));
  historyTodayCard(inner).catch(e => console.error(e));
  if (ME.role === 'owner') docsAlertCard(inner).catch(e => console.error(e));
  draftsHomeCard(inner).catch(e => console.error(e));
  reviewHomeCard(inner).catch(e => console.error(e));
  if (ME.role === 'owner') mfaNagCard(inner);
  opinionsHomeCard(inner).catch(e => console.error(e));
}
async function viewMoney(app, tab) {
  const items = [['#/dinero/cuentas', '💵 ' + t('Cuentas'), 'cuentas'], ['#/dinero/cobros', '🧾 ' + t('Cobros'), 'cobros'], ['#/dinero/reportes', '📊 ' + t('Reportes'), 'reportes'], ['#/dinero/subs', '📁 ' + t('Subs: papeles y 1099'), 'subs'], ['#/dinero/publicidad', '📣 ' + t('Publicidad'), 'publicidad'], ...(MOD('proyecciones') ? [['#/dinero/proyecciones', '🔮 ' + t('Proyecciones'), 'proyecciones']] : [])];
  if (!items.some(i => i[2] === tab)) tab = 'cuentas';
  const inner = segHeader(app, items, tab);
  if (tab === 'cobros') return viewCollections(inner);
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
  if (!p.signed && !b.contracted) {
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
  box.innerHTML = `<div class="card"><div class="row between wrap"><div>${p.signed ? `<h2 style="margin:0">✅ ${t('Propuesta firmada')}</h2><div class="small muted">${t('Firmada por {n} el {d}.', { n: esc(p.signed.name), d: fdayLocal(p.signed.at) })}</div>` : `<h2 style="margin:0">✅ ${t('Contrato de la obra')}</h2><div class="small muted">${t('Viene del estimado aprobado (pestaña Planos).')}</div>`}</div><div class="row wrap">${pdfLinks}${b.link ? `<button class="sm" id="cpl">🔗 ${t('Enlace del cliente')}</button>` : ''}</div></div></div>
    <div class="card"><h2>💵 ${t('Cobros por etapa')}</h2>
      <div class="money-strip"><div><span>${t('Contrato')}</span><b>${fmt(b.contract_cents)}</b></div>${b.cos_cents ? `<div><span>${t('Change orders')}</span><b>${fmt(b.cos_cents)}</b></div>` : ''}<div><span>${t('Pagado')}</span><b>${fmt(b.paid_cents)}</b></div><div><span>${t('Saldo')}</span><b>${fmt(b.balance_cents)}</b></div></div>
      <div class="table-wrap"><table><thead><tr><th>${t('Etapa')}</th><th class="num">${t('Monto')}</th><th>${t('Estado')}</th><th></th></tr></thead><tbody>
      ${b.milestones.map(m => `<tr data-m="${m.id}"><td><b>${esc(m.label)}</b> <span class="small muted">${m.pct}%</span>${m.cos_cents ? `<div class="small muted">${t('incluye change orders: {x}', { x: fmt(m.cos_cents) })}</div>` : ''}
          <div class="small muted">${m.trigger === 'firma' ? t('Al firmar') : m.trigger === 'tarea' ? t('Al terminar: {x}', { x: esc(taskTitle((p.tasks.find(x => x.id === m.task_id) || {}).title || '')) }) : t('Yo aviso cuándo')}</div></td>
        <td class="num">${fmt(m.amount_cents)}${m.covered_cents && m.status !== 'pagado' ? `<div class="small muted">${t('pagado {x}', { x: fmt(m.covered_cents) })}</div>` : ''}</td>
        <td><span class="badge ${ST[m.status][1]}">${ST[m.status][0]}</span>${m.invoice_number ? `<div class="small muted">${esc(m.invoice_number)} · ${t('vence {d}', { d: fdate(m.due_date) })}</div>` : ''}</td>
        <td class="nowrap">${m.status === 'pendiente' ? `<button class="sm" data-ready>${t('Ya toca cobrar')}</button>` : ''}${!m.invoice_number && m.status !== 'pagado' ? `<button class="sm primary" data-inv>${t('Facturar')}</button>` : ''}
          ${m.invoice_number ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/milestones/${m.id}/pdf?lang=es">PDF</a> <a class="btn sm" target="_blank" rel="noopener" href="/api/milestones/${m.id}/pdf?lang=en">EN</a>${m.status !== 'pagado' ? ` <button class="sm" data-resend>📤</button> <button class="sm link" data-void>${t('Anular')}</button>` : ''}` : ''}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">${t('Los pagos que registre en "Pagos del cliente" se aplican solos a las etapas, en orden. Los change orders se cobran aparte, cada uno con su invoice.')}</p>
      ${b.milestones.some(m => m.invoice_number) ? '' : `<details><summary class="small">${t('Cambiar el calendario de pagos')}</summary><div id="schedbox">${schedEditor()}</div></details>`}</div>
    <div class="card"><div class="row between"><h2>🧾 ${t('Change orders: cobro')}</h2><a class="btn sm" href="#/obra/${id}/cambios">${t('Ver change orders')}</a></div>
      ${b.change_orders.filter(c => c.status !== 'rechazado').length ? `<div class="table-wrap"><table><thead><tr><th>${t('Código')}</th><th class="num">${t('Monto')}</th><th>${t('Estado')}</th><th>${t('Trabajo')}</th><th></th></tr></thead><tbody>
        ${b.change_orders.filter(c => c.status !== 'rechazado').map(c => `<tr data-co="${c.id}"><td><b class="code">${esc(c.code)}</b><div class="small muted">${esc(c.description.slice(0, 90))}</div></td><td class="num">${fmt(c.price_cents)}${c.paid_cents && c.state !== 'cobrado' ? `<div class="small muted">${t('cobrado {x}', { x: fmt(c.paid_cents) })}</div>` : ''}</td>
          <td>${c.status === 'pendiente' ? `<span class="badge">${t('Esperando al cliente')}</span>` : `<span class="badge ${(CO_STATE()[c.state] || CO_STATE().aprobado)[1]}">${(CO_STATE()[c.state] || CO_STATE().aprobado)[0]}</span>`}${c.invoice_number ? `<div class="small muted">${esc(c.invoice_number)}${c.state !== 'cobrado' && c.due_date ? ' · ' + t('vence {d}', { d: fdate(c.due_date) }) : ''}</div>` : ''}</td>
          <td class="small">${c.done_at ? '✓ ' + t('Hecho') : '—'}</td>
          <td class="nowrap">${c.status === 'aprobado' && c.price_cents > 0 && !c.invoice_number && c.state !== 'cobrado' ? `<button class="sm primary" data-coinv>${t('Facturar')}</button>` : ''}${c.invoice_number ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/changes/${c.id}/pdf?lang=es">PDF</a> <a class="btn sm" target="_blank" rel="noopener" href="/api/changes/${c.id}/pdf?lang=en">EN</a>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="money-strip small"><div><span>${t('Por cobrar de change orders')}</span><b>${fmt(b.cos_unpaid_cents)}</b></div><div><span>${t('Esperando al cliente')}</span><b>${b.cos_waiting} · ${fmt(b.cos_waiting_cents)}</b></div></div>` : `<p class="empty">${t('Sin change orders.')}</p>`}</div>`;
  $$('[data-coinv]', box).forEach(btn => { btn.onclick = () => coInvoiceDialog(b.change_orders.find(c => c.id === Number(btn.closest('tr').dataset.co)), again); });
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
  c.innerHTML = `<h2>💵 ${t('Cobros')}</h2>${due.map(m => `<div class="notice small"><a href="#/obra/${m.job_id}/${m.kind === 'co' ? 'cambios' : 'propuesta'}"><b>${esc(m.client_name)}</b></a> · ${m.kind === 'co' ? '🧾 ' : ''}${esc(m.label)} · <b>${fmt(m.amount_cents - m.covered_cents)}</b>${m.kind === 'co' && m.status === 'por_cobrar' ? ` <span class="small muted">${t('trabajo hecho, sin facturar')}</span>` : ''}
    <span class="badge ${m.status === 'vencido' ? 'b-late' : 'b-urg'}">${m.status === 'vencido' ? t('Vencido desde el {d}', { d: fdate(m.due_date) }) : t('Toca cobrar')}</span></div>`).join('')}`;
  const anchor = app.children[2] || null; app.insertBefore(c, anchor);
}
// Portal del cliente: su calendario de pagos y sus invoices.
async function clientBillingCard(app, j) {
  const b = await api('GET', `/api/jobs/${j.id}/billing`).catch(() => null);
  if (!b || !b.contracted || !b.milestones.length || !app.isConnected) return;
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

// =====================================================================
// v2.15 PLANTILLAS DE TAREAS (editables por tipo de obra) · SCHEDULE · LIMPIAR TAREAS
// =====================================================================
async function loadTemplates() { return api('GET', '/api/task-templates'); }
// Opciones de "Tareas" al crear una obra, según el tipo de proyecto.
function templateOptions(T, type) {
  const mine = T.saved.filter(x => x.project_type === type), others = T.saved.filter(x => x.project_type !== type);
  const def = mine.find(x => x.is_default);
  return { value: def ? String(def.id) : 'blank', options: [
    ...mine.map(x => [String(x.id), `📋 ${x.name}${x.is_default ? ' ★' : ''} (${t('{n} tareas', { n: x.tasks.length })})`]),
    ['base', `💡 ${t('Plantilla sugerida de la app')} (${t('{n} tareas', { n: (T.suggested.find(s => s.project_type === type) || { tasks: [] }).tasks.length })})`],
    ['blank', `⬜ ${t('En blanco: las agrego o importo el SCHEDULE después')}`],
    ...others.map(x => [String(x.id), `📋 ${x.name} · ${typeLabel(x.project_type)}`]),
  ] };
}

async function viewTemplates(app) {
  const T = await loadTemplates();
  const can = ME.role === 'owner' && !ME.is_agent;
  const byType = CAT.projectTypes.map(p => ({ p, saved: T.saved.filter(x => x.project_type === p.key), sug: T.suggested.find(s => s.project_type === p.key) }));
  app.innerHTML = `<div class="row between wrap"><h1>📋 ${t('Plantillas de tareas')}</h1>${can ? `<button class="primary" id="ntpl">${t('+ Plantilla nueva')}</button>` : ''}</div>
    <p class="muted small" style="margin-top:-.4rem">${t('Al crear una obra se escoge la plantilla. La marcada con ★ sale escogida para ese tipo de obra. Ya no se ponen tareas solas.')}</p>
    ${byType.map(({ p, saved, sug }) => `<div class="card tpl-type"><div class="row between wrap"><h2 style="margin:0">${esc(L(p))}</h2>
      ${can && sug ? `<button class="sm" data-sug="${p.key}">💡 ${t('Empezar desde la sugerida')}</button>` : ''}</div>
      ${saved.length ? saved.map(x => `<div class="tpl-row" data-id="${x.id}"><div><b>${esc(x.name)}</b>${x.is_default ? ` <span class="badge b-hecho">★ ${t('Por defecto')}</span>` : ''}
        <div class="small muted">${t('{n} tareas', { n: x.tasks.length })}: ${esc(x.tasks.slice(0, 6).map(k => k.title).join(' · '))}${x.tasks.length > 6 ? ' …' : ''}</div></div>
        ${can ? `<div class="row"><button class="sm" data-ed>✎ ${t('Editar')}</button><button class="sm" data-dup>${t('Duplicar')}</button>${x.is_default ? '' : `<button class="sm" data-def>★</button>`}<button class="sm danger" data-del>✕</button></div>` : ''}</div>`).join('')
        : `<p class="small muted">${t('Sin plantilla propia. Al crear la obra puede usar la sugerida de la app ({n} tareas) o dejarla en blanco.', { n: sug ? sug.tasks.length : 0 })}</p>`}
    </div>`).join('')}`;
  const reload = () => viewTemplates(app);
  if (!can) return;
  $('#ntpl').onclick = async () => { if (await templateEditor({ name: '', project_type: 'patio_cover', tasks: [{ title: '', days: 1 }] })) reload(); };
  $$('[data-sug]', app).forEach(b => b.onclick = async () => { const s = T.suggested.find(x => x.project_type === b.dataset.sug);
    if (await templateEditor({ name: s.name + ' — ' + (COMPANY.short || COMPANY.name || ''), project_type: s.project_type, tasks: s.tasks.map(x => ({ ...x })), is_default: !T.saved.some(x => x.project_type === s.project_type) })) reload(); });
  $$('.tpl-row', app).forEach(el => {
    const x = T.saved.find(y => y.id === Number(el.dataset.id));
    $('[data-ed]', el).onclick = async () => { if (await templateEditor(x)) reload(); };
    $('[data-dup]', el).onclick = async () => { if (await templateEditor({ ...x, id: undefined, is_default: false, name: x.name + ' (2)', tasks: x.tasks.map(k => ({ ...k })) })) reload(); };
    const df = $('[data-def]', el); if (df) df.onclick = () => act(() => api('PUT', `/api/task-templates/${x.id}`, { is_default: true })).then(reload);
    $('[data-del]', el).onclick = async () => { if (await confirmDialog(t('¿Borrar la plantilla “{x}”? Las obras que ya la usan no cambian.', { x: x.name }))) act(() => api('DELETE', `/api/task-templates/${x.id}`)).then(reload); };
  });
}

// Editor: nombre, tipo, por defecto y la lista de tareas (días, oficio, inspección), con pegar varias de un jalón.
function templateEditor(tpl) {
  return new Promise(resolve => {
    let rows = tpl.tasks.map(x => ({ title: x.title || '', days: x.days || 1, trade: x.inspection ? '' : (tradeKey(x.trade) || guessTrade(x.title)), inspection: !!x.inspection, notes: x.notes || '' }));
    const dlg = document.createElement('dialog'); dlg.className = 'wide';
    const read = () => $$('.te-row', dlg).forEach(el => { const x = rows[Number(el.dataset.i)];
      $$('[data-k]', el).forEach(inp => { const k = inp.dataset.k; x[k] = inp.type === 'checkbox' ? inp.checked : k === 'days' ? Math.max(1, Number(inp.value) || 1) : inp.value; }); });
    const head = { name: tpl.name, project_type: tpl.project_type, is_default: !!tpl.is_default };
    const readHead = () => { head.name = $('#tn', dlg).value; head.project_type = $('#tt', dlg).value; head.is_default = $('#td', dlg).checked; };
    const draw = () => {
      dlg.innerHTML = `<div class="pe"><h2 style="margin:0">${tpl.id ? t('Editar plantilla') : t('Plantilla nueva')}</h2><div class="error"></div>
        <div class="row wrap"><label class="small" style="flex:2">${t('Nombre')}<input id="tn" value="${esc(head.name)}" placeholder="${t('Ej. Patio cover con techo de tejas')}"></label>
          <label class="small" style="flex:1">${t('Tipo de obra')}<select id="tt">${CAT.projectTypes.map(p => `<option value="${p.key}" ${p.key === head.project_type ? 'selected' : ''}>${esc(L(p))}</option>`).join('')}</select></label>
          <label class="check small"><input type="checkbox" id="td" ${head.is_default ? 'checked' : ''}> ★ ${t('Por defecto para este tipo')}</label></div>
        <div class="pe-rows">${rows.map((x, i) => `<div class="te-row" data-i="${i}"><span class="n">${i + 1}</span>
          <input data-k="title" value="${esc(x.title)}" placeholder="${t('Tarea')}" aria-label="${t('Tarea')}">
          <label class="small">${t('Días')}<input data-k="days" type="number" min="1" max="60" value="${x.days}"></label>
          <select data-k="trade" aria-label="${t('Trade')}"><option value="">${x.inspection ? t('— inspección —') : t('— trade —')}</option>${TRADES().map(([k, l]) => `<option value="${k}" ${k === x.trade ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <label class="check small"><input type="checkbox" data-k="inspection" ${x.inspection ? 'checked' : ''}> ${t('Inspección')}</label>
          <span class="row"><button type="button" class="sm" data-up aria-label="${t('Subir')}">↑</button><button type="button" class="sm" data-dn aria-label="${t('Bajar')}">↓</button><button type="button" class="sm danger" data-rm aria-label="${t('Borrar')}">✕</button></span></div>`).join('')}</div>
        <div class="row wrap"><button type="button" class="sm" id="addr">${t('+ Agregar tarea')}</button><button type="button" class="sm" id="paste">📋 ${t('Pegar varias (una por renglón)')}</button></div>
        <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="button" id="sv">${t('Guardar plantilla')}</button></div></div>`;
      $$('.te-row', dlg).forEach(el => { const i = Number(el.dataset.i);
        $('[data-up]', el).onclick = () => { read(); readHead(); if (i > 0) [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); };
        $('[data-dn]', el).onclick = () => { read(); readHead(); if (i < rows.length - 1) [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; draw(); };
        $('[data-rm]', el).onclick = () => { read(); readHead(); rows.splice(i, 1); draw(); }; });
      $('#addr', dlg).onclick = () => { read(); readHead(); rows.push({ title: '', days: 1, trade: '', inspection: false, notes: '' }); draw(); const l = $$('.te-row [data-k="title"]', dlg).at(-1); if (l) l.focus(); };
      $('#paste', dlg).onclick = async () => { read(); readHead();
        const v = await formDialog({ title: t('Pegar varias tareas'), fields: [{ name: 'txt', label: t('Una tarea por renglón (puede copiarlas de la hoja de Google)'), type: 'textarea', required: true }], submit: t('Agregar') , onSubmit: async () => {} });
        if (v) { rows = rows.filter(x => x.title.trim()); v.txt.split('\n').map(l => l.split('\t').find(c => c.trim()) || '').map(l => l.trim()).filter(Boolean)
          .forEach(l => rows.push({ title: l.slice(0, 200), days: 1, trade: /inspec/i.test(l) ? '' : guessTrade(l), inspection: /inspec/i.test(l), notes: '' })); draw(); } };
      $('[data-x]', dlg).onclick = () => close(false);
      $('#sv', dlg).onclick = async () => {
        read(); readHead();
        const tasks = rows.filter(x => x.title.trim());
        if (!head.name.trim()) { $('.error', dlg).textContent = t('Falta: {x}', { x: t('Nombre') }); return; }
        if (!tasks.length) { $('.error', dlg).textContent = t('La plantilla no tiene tareas'); return; }
        try { await api(tpl.id ? 'PUT' : 'POST', tpl.id ? `/api/task-templates/${tpl.id}` : '/api/task-templates', { ...head, tasks }); toast(t('Plantilla guardada')); close(true); }
        catch (err) { $('.error', dlg).textContent = err.message; }
      };
    };
    const close = v => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', e => { e.preventDefault(); close(false); });
    document.body.appendChild(dlg); draw(); dlg.showModal();
  });
}

// Importar el SCHEDULE de la hoja de la obra: pegarlo de Google Sheets o subir el .xlsx. Vista previa antes de guardar.
async function scheduleImportDialog(d, { id, reload }) {
  const dlg = document.createElement('dialog'); dlg.className = 'wide';
  let input = null, pv = null;
  const close = () => { dlg.close(); dlg.remove(); };
  const step1 = () => {
    dlg.innerHTML = `<form method="dialog" novalidate><h2>📥 ${t('Importar el SCHEDULE de la obra')}</h2><div class="error"></div>
      <div class="intro small">${t('En la hoja de la obra abra la tab SCHEDULE, seleccione desde los encabezados (TASK NAME, STATUS, START PLANNED…) hasta la última tarea, cópiela y péguela aquí. También puede subir el libro completo en .xlsx.')}</div>
      <div class="fields"><div class="field full"><label>${t('Pegar aquí')}</label><textarea id="sx" rows="8" placeholder="TRADE ID	TASK NAME	STATUS	START PLANNED	END PLANNED…"></textarea></div>
        <div class="field full"><label>${t('O subir el Excel (.xlsx)')}</label><input type="file" id="sf" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div></div>
      <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Ver vista previa')}</button></div></form>`;
    $('[data-x]', dlg).onclick = close;
    $('form', dlg).onsubmit = async e => { e.preventDefault();
      try { const f = $('#sf', dlg).files[0]; input = f ? { file: await readAnyFile(f) } : { text: $('#sx', dlg).value };
        pv = await api('POST', `/api/jobs/${id}/schedule/preview`, input); step2(); } catch (err) { $('.error', dlg).textContent = err.message; } };
  };
  const ST = TASK_STATUS();
  const step2 = () => {
    dlg.innerHTML = `<div class="pe"><h2 style="margin:0">${t('Revise lo que se va a importar')}</h2><div class="error"></div>
      <div class="pe-rows">${pv.tasks.map((x, i) => `<label class="sch-row ${x.exists ? 'muted' : ''}"><input type="checkbox" data-i="${i}" ${x.exists ? '' : 'checked'}>
        <span><b>${esc(x.title)}</b><span class="small muted"> ${[x.code && (x.line ? '🔗 ' : '') + esc(x.code), ST[x.status], x.planned_date && dateRange(x), x.exists && t('ya está en la obra')].filter(Boolean).join(' · ')}</span></span></label>`).join('')}</div>
      ${pv.current ? `<div class="field"><label>${t('Las {n} tareas que ya tiene la obra', { n: pv.current })}</label><select id="sm">
        <option value="replace">${t('Reemplazar: quitar las {n} que no se han usado (sin fotos, avisos ni avance)', { n: pv.removable })}</option>
        <option value="add">${t('Dejarlas y agregar estas al final')}</option></select></div>` : ''}
      <div class="foot"><button type="button" id="bk" style="margin-right:auto">← ${t('Volver')}</button><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="button" id="go">${t('Importar')}</button></div></div>`;
    $('[data-x]', dlg).onclick = close; $('#bk', dlg).onclick = step1;
    $('#go', dlg).onclick = async () => {
      const skip = $$('[data-i]', dlg).filter(c => !c.checked).map(c => Number(c.dataset.i));
      if (skip.length === pv.tasks.length) { $('.error', dlg).textContent = t('No hay tareas que importar'); return; }
      try { const r = await api('POST', `/api/jobs/${id}/schedule/apply`, { ...input, skip, mode: $('#sm', dlg) ? $('#sm', dlg).value : 'add' });
        toast(t('{n} tareas importadas', { n: r.created }) + (r.removed ? ' · ' + t('{n} quitadas', { n: r.removed }) : '')); close(); reload(); }
      catch (err) { $('.error', dlg).textContent = err.message; }
    };
  };
  document.body.appendChild(dlg); step1(); dlg.addEventListener('cancel', close); dlg.showModal();
}

// Quitar tareas que no se han usado (por ejemplo, las que la app ponía sola). Lo que tiene historia no se puede quitar.
async function taskCleanupDialog(d, { id, reload }) {
  const list = await api('GET', `/api/jobs/${id}/task-cleanup`);
  const WHY = { 'ya está hecha': t('ya está hecha'), 'está en progreso': t('está en progreso'), 'tiene fotos': t('tiene fotos'), 'tiene avisos al sub': t('tiene avisos al sub'), 'tiene un cobro ligado': t('tiene un cobro ligado') };
  const dlg = document.createElement('dialog'); dlg.className = 'wide';
  const auto = list.filter(x => x.auto && !x.blocked.length).length;
  dlg.innerHTML = `<div class="pe"><h2 style="margin:0">🧹 ${t('Quitar tareas que no se usan')}</h2>
    <div class="intro small">${auto ? t('Hay {n} tareas que puso la app sola y no se han usado: ya vienen marcadas.', { n: auto }) : t('Marque las tareas que quiere quitar.')} ${t('Las que ya tienen fotos, avisos, avance o un cobro ligado no se pueden quitar.')}</div>
    <div class="row"><button type="button" class="sm" id="all">${t('Marcar todas las que se pueden')}</button><button type="button" class="sm" id="none">${t('Desmarcar todas')}</button></div>
    <div class="pe-rows">${[...list.filter(x => !x.blocked.length), ...list.filter(x => x.blocked.length)].map((x, i, arr) => `${x.blocked.length && (i === 0 || !arr[i - 1].blocked.length) ? `<h3>🔒 ${t('No se pueden quitar')}</h3>` : ''}<label class="sch-row ${x.blocked.length ? 'muted' : ''}"><input type="checkbox" data-id="${x.id}" ${x.blocked.length ? 'disabled' : x.auto ? 'checked' : ''}>
      <span><b>${esc(taskTitle(x.title))}</b>${x.auto ? ` <span class="badge">${t('automática')}</span>` : ''}${x.blocked.length ? `<span class="small"> · 🔒 ${x.blocked.map(w => WHY[w] || w).join(', ')}</span>` : ''}</span></label>`).join('')}</div>
    <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="danger" type="button" id="go">${t('Quitar las marcadas')}</button></div></div>`;
  const close = () => { dlg.close(); dlg.remove(); };
  $('[data-x]', dlg).onclick = close; dlg.addEventListener('cancel', close);
  $('#all', dlg).onclick = () => $$('[data-id]:not(:disabled)', dlg).forEach(c => { c.checked = true; });
  $('#none', dlg).onclick = () => $$('[data-id]', dlg).forEach(c => { c.checked = false; });
  $('#go', dlg).onclick = async () => {
    const ids = $$('[data-id]:checked', dlg).map(c => Number(c.dataset.id));
    if (!ids.length) { toast(t('Escoja las tareas que quiere quitar'), true); return; }
    try { const r = await api('POST', `/api/jobs/${id}/task-cleanup`, { ids }); toast(t('{n} tareas quitadas', { n: r.removed })); close(); reload(); } catch (err) { toast(err.message, true); }
  };
  document.body.appendChild(dlg); dlg.showModal();
}

// Asignar por trade: cada trade de la obra con su crew. Un crew puede quedarse con varios trades de un jalón.
async function assignByTradeDialog(d, { id, workers, reload }) {
  const pend = d.tasks.filter(x => x.trade && x.status !== 'hecho');
  const trades = [...new Set(pend.map(x => x.trade))].sort((a, b) => TRADES().findIndex(x => x[0] === a) - TRADES().findIndex(x => x[0] === b));
  const onJob = new Set((d.subs || []).map(s => s.user_id).filter(Boolean));
  const tradesOf = w => { const s = (d.subs || []).find(x => x.user_id === w.id && x.trades); return s ? s.trades.split(',') : (w.trades || []); };
  const current = k => { const ids = [...new Set(pend.filter(x => x.trade === k).map(x => x.assignee_id || ''))]; return ids.length === 1 ? String(ids[0]) : ids.length ? 'mix' : ''; };
  const opts = k => { const fit = workers.filter(w => tradesOf(w).includes(k)), rest = workers.filter(w => !fit.includes(w)); const cur = current(k);
    return `<option value="">${t('— sin asignar —')}</option>${cur === 'mix' ? `<option value="mix" selected>${t('(varios — no cambiar)')}</option>` : ''}`
      + (fit.length ? `<optgroup label="${esc(t('Hacen este trade'))}">${fit.map(w => `<option value="${w.id}" ${String(w.id) === cur ? 'selected' : ''}>${esc(w.name)}${onJob.has(w.id) ? ' ✓' : ''}</option>`).join('')}</optgroup>` : '')
      + `<optgroup label="${esc(t('Otros'))}">${rest.map(w => `<option value="${w.id}" ${String(w.id) === cur ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</optgroup>`; };
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog" novalidate><h2>👷 ${t('Asignar por trade')}</h2><div class="error"></div>
    <div class="intro small">${t('Escoja quién hace cada trade. Un mismo crew puede quedarse con varios. Solo cambian las tareas que no están hechas; ✓ = ya está en esta obra.')}</div>
    <div class="abt-rows">${trades.map(k => `<div class="abt-row"><div><b>${esc(tradeLabel(k))}</b><div class="small muted">${t('Por hacer: {n}', { n: pend.filter(x => x.trade === k).length })}</div></div>
      <select data-tr="${k}" aria-label="${esc(tradeLabel(k))}">${opts(k)}</select></div>`).join('')}</div>
    <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Asignar')}</button></div></form>`;
  const close = () => { dlg.close(); dlg.remove(); };
  $('[data-x]', dlg).onclick = close; dlg.addEventListener('cancel', close);
  $('form', dlg).onsubmit = async e => { e.preventDefault();
    const map = {}; $$('[data-tr]', dlg).forEach(s => { if (s.value !== 'mix' && s.value !== current(s.dataset.tr)) map[s.dataset.tr] = s.value ? Number(s.value) : null; });
    if (!Object.keys(map).length) { close(); return; }
    try { const r = await api('POST', `/api/jobs/${id}/assign-by-trade`, { map }); toast(t('{n} tareas asignadas', { n: r.changed })); close(); reload(); } catch (err) { $('.error', dlg).textContent = err.message; } };
  document.body.appendChild(dlg); dlg.showModal();
}

// =====================================================================
// v2.17 TICKETS: número, subtotal + impuesto, forma de pago, foto, dividir entre obras / empresa / personal
// =====================================================================
let RCP_SET = null;
async function receiptSettings() { if (!RCP_SET) { RCP_SET = await api('GET', '/api/receipts/settings'); setTimeout(() => { RCP_SET = null; }, 120000); } return RCP_SET; }
const PAYS = cur => vis(CAT.payMethods, cur).map(p => [p.key, L(p)]);
// Foto del ticket: cámara, o galería / archivos / Google Drive (también PDF, como los de Amazon).
const photoPickHtml = id => `<div class="photo-pick" id="${id}"><label class="btn pp-cam">📷 ${t('Tomar foto')}<input type="file" accept="image/*" capture="environment" hidden></label>
  <label class="btn">🖼️ ${t('Galería o archivos')}<input type="file" accept="image/*,application/pdf" hidden></label><div class="pp-prev small muted">${t('Ninguna foto elegida')}</div></div>`;
// opts: { jobId, scan (escaneado por asignar), after(result) }
async function receiptDialog({ jobId = null, scan = null } = {}) {
  const [st, jobs] = await Promise.all([receiptSettings(), scanJobs()]);
  const da = (scan && scan.data) || {};
  const canCompany = !!st.company, linesCache = {};
  const getLines = async id => { if (!BOSS() || !id) return []; if (!linesCache[id]) linesCache[id] = await api('GET', `/api/jobs/${id}/lines`).then(r => (r.lines || r || []).filter(l => l.status !== 'cancelado')).catch(() => []); return linesCache[id]; };
  const rate = st.tax_rate_bp / 10000;
  const firstJob = jobId || (scan && scan.job_id) || (jobs.length === 1 ? jobs[0].id : '');
  const sub0 = da.subtotal_cents || (da.total_cents && da.tax_cents ? da.total_cents - da.tax_cents : da.total_cents ? Math.round(da.total_cents / (1 + rate)) : 0);
  const state = { taxAuto: !(da.tax_cents != null && sub0 && Math.abs(da.tax_cents - Math.round(sub0 * rate)) > 1), lines: [{ dest: firstJob ? 'obra:' + firstJob : '', category: da.category || 'material', line_id: '', description: '', amount: sub0 ? (sub0 / 100).toFixed(2) : '' }] };
  const dlg = document.createElement('dialog'); dlg.className = 'wide';
  const destOpts = sel => `<option value="">${t('— ¿a dónde va? —')}</option><optgroup label="${esc(t('Obras'))}">${jobs.map(j => `<option value="obra:${j.id}" ${sel === 'obra:' + j.id ? 'selected' : ''}>${esc(j.client_name)} (${jobCode(j.id)})</option>`).join('')}</optgroup>`
    + `${canCompany ? `<option value="empresa" ${sel === 'empresa' ? 'selected' : ''}>🏢 ${t('Gasto general de la empresa')}</option>` : ''}<option value="personal" ${sel === 'personal' ? 'selected' : ''}>🙅 ${t('Personal (no cuenta como gasto)')}</option>`;
  const val = k => $(`#r_${k}`, dlg).value;
  const subtotal = () => toCents(val('sub')) || 0;
  const tax = () => (state.taxAuto ? Math.round(subtotal() * rate) : toCents(val('tax')) || 0);
  const readLines = () => $$('.rl', dlg).forEach(el => { const x = state.lines[Number(el.dataset.i)]; $$('[data-k]', el).forEach(i => { x[i.dataset.k] = i.value; }); });
  const totals = () => {
    const sum = state.lines.reduce((a, l) => a + (toCents(l.amount) || 0), 0), s = subtotal(), diff = s - sum;
    $('#r_taxv', dlg).value = state.taxAuto ? (tax() / 100).toFixed(2) : $('#r_taxv', dlg).value;
    $('#r_total', dlg).textContent = fmt(s + tax());
    const b = $('#r_rest', dlg);
    b.className = 'rest ' + (diff === 0 && s ? 'ok' : 'bad');
    b.textContent = !s ? t('Escriba el subtotal del ticket') : diff === 0 ? '✓ ' + t('Cuadra con el subtotal') : diff > 0 ? t('Falta repartir {m}', { m: fmt(diff) }) : t('Se pasa por {m}', { m: fmt(-diff) });
  };
  const drawLines = async () => {
    const box = $('#r_lines', dlg);
    const parts = await Promise.all(state.lines.map(async (l, i) => {
      const kind = l.dest.startsWith('obra:') ? 'obra' : l.dest;
      const jl = kind === 'obra' ? await getLines(Number(l.dest.slice(5))) : [];
      return `<div class="rl" data-i="${i}">
        <select data-k="dest" aria-label="${esc(t('A dónde va'))}">${destOpts(l.dest)}</select>
        ${kind === 'obra' ? `${jl.length ? `<select data-k="line_id" aria-label="${esc(t('Partida'))}"><option value="">${t('Partida (la app la sugiere)')}</option>${jl.map(x => `<option value="${x.id}" ${String(x.id) === String(l.line_id) ? 'selected' : ''}>${esc([x.code, x.trade].filter(Boolean).join(' '))}</option>`).join('')}</select>` : ''}
          <select data-k="category" aria-label="${esc(t('Categoría'))}">${CATS().filter(c => c.key !== 'subcontratistas' && (BOSS() || c.key !== 'mano_obra')).map(c => `<option value="${c.key}" ${c.key === l.category ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}</select>`
        : kind === 'empresa' ? `<select data-k="category" aria-label="${esc(t('Categoría'))}">${vis(CAT.companyCategories, l.category).map(c => `<option value="${c.key}" ${c.key === l.category ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}</select>
          <input data-k="description" value="${esc(l.description)}" placeholder="${esc(t('Qué es (ej. taladro DeWalt)'))}">` : ''}
        <input data-k="amount" inputmode="decimal" value="${esc(l.amount)}" placeholder="${esc(t('Subtotal $'))}" aria-label="${esc(t('Subtotal $'))}">
        ${state.lines.length > 1 ? `<button type="button" class="sm danger" data-rm aria-label="${esc(t('Quitar'))}">✕</button>` : ''}</div>`;
    }));
    box.innerHTML = parts.join('');
    $$('.rl', box).forEach(el => {
      const i = Number(el.dataset.i);
      $('[data-k="dest"]', el).onchange = e => { readLines(); const l = state.lines[i]; l.dest = e.target.value; l.line_id = ''; l.category = l.dest === 'empresa' ? 'herramienta' : 'material'; drawLines(); };
      $$('[data-k]', el).forEach(x => { x.oninput = () => { readLines(); totals(); }; });
      const rm = $('[data-rm]', el); if (rm) rm.onclick = () => { readLines(); state.lines.splice(i, 1); drawLines(); };
    });
    totals();
  };
  const preview = scan ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/scans/${scan.id}/file">🧾 ${t('Ver ticket')}</a>` : '';
  dlg.innerHTML = `<form method="dialog" novalidate><h2>🧾 ${t('Registrar ticket')}</h2><div class="error"></div>
    ${scan ? `<div class="row small">${preview}<span class="muted">${t('Revise lo que leyó la app.')}</span></div>` : `<div class="field full"><label>${t('Foto del ticket')}</label>${photoPickHtml('r_photo')}</div>`}
    <div class="fields">
      <div class="field"><label>${t('Tienda o proveedor')} *</label><input id="r_vendor" list="r_vlist" value="${esc(da.vendor || '')}" autocomplete="off"><datalist id="r_vlist">${st.vendors.map(v => `<option value="${esc(v)}">`).join('')}</datalist></div>
      <div class="field"><label>${t('Número de ticket')}</label><input id="r_ticket" value="${esc(da.ticket || '')}" placeholder="${esc(t('Ej. 53997'))}"></div>
      <div class="field"><label>${t('Fecha')}</label><input id="r_date" type="date" value="${esc(da.date || today())}"></div>
      <div class="field"><label>${t('Cómo se pagó')}</label><select id="r_pay">${PAYS().map(([k, l]) => `<option value="${k}" ${k === 'tarjeta' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('Subtotal (antes de impuesto) $')} *</label><input id="r_sub" inputmode="decimal" value="${sub0 ? (sub0 / 100).toFixed(2) : ''}"></div>
      <div class="field"><label>${t('Impuesto $')} <span class="small muted">(${(st.tax_rate_bp / 100).toFixed(2)}%)</span></label><div class="row" style="flex-wrap:nowrap"><input id="r_taxv" inputmode="decimal" value="${da.tax_cents != null ? (da.tax_cents / 100).toFixed(2) : ''}"><button type="button" class="sm" id="r_notax">${t('Sin impuesto')}</button></div><input id="r_tax" type="hidden"></div>
    </div>
    <div class="rtotal">${t('Total del ticket')}: <b id="r_total">$0.00</b></div>
    <h3 style="margin:.6rem 0 .3rem">${t('¿A dónde va?')}</h3>
    <div class="small muted" style="margin-bottom:.4rem">${t('Si el ticket trae cosas de varias obras o partidas, divídalo. Lo personal no se registra como gasto.')}</div>
    <div id="r_lines" class="rlines"></div>
    <div class="row between wrap"><button type="button" class="sm" id="r_split">➗ ${t('Dividir el ticket')}</button><span id="r_rest" class="rest"></span></div>
    <div class="dup" id="r_dup" hidden></div>
    <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit" id="r_go">${t('Guardar ticket')}</button></div></form>`;
  const pick = $('.photo-pick', dlg); if (pick) bindPhotoPick(pick);
  $('#r_taxv', dlg).oninput = () => { state.taxAuto = false; $('#r_tax', dlg).value = $('#r_taxv', dlg).value; totals(); };
  $('#r_sub', dlg).oninput = () => { if (state.lines.length === 1) { const l = $('.rl [data-k="amount"]', dlg); if (l) { l.value = val('sub'); state.lines[0].amount = val('sub'); } } totals(); };
  $('#r_notax', dlg).onclick = () => { state.taxAuto = false; $('#r_taxv', dlg).value = '0.00'; $('#r_tax', dlg).value = '0'; totals(); };
  if (!state.taxAuto) $('#r_tax', dlg).value = $('#r_taxv', dlg).value;
  $('#r_split', dlg).onclick = () => { readLines(); const sum = state.lines.reduce((a, l) => a + (toCents(l.amount) || 0), 0), rest = Math.max(0, subtotal() - sum);
    state.lines.push({ dest: '', category: 'material', line_id: '', description: '', amount: rest ? (rest / 100).toFixed(2) : '' }); drawLines(); };
  await drawLines();
  return new Promise(resolve => {
    const close = v => { dlg.close(); dlg.remove(); resolve(v); };
    $('[data-x]', dlg).onclick = () => close(null); dlg.addEventListener('cancel', e => { e.preventDefault(); close(null); });
    let extra = {};
    $('form', dlg).onsubmit = async e => {
      e.preventDefault(); readLines();
      const err = $('.error', dlg); err.textContent = '';
      try {
        if (state.lines.some(l => !l.dest)) throw new Error(t('Diga a qué obra va cada parte del ticket'));
        const pf = pick && pick._files && pick._files[0], photo = pf ? await readDocFile(pf) : null;
        const body = { vendor: val('vendor'), ticket: val('ticket'), date: val('date'), pay_method: val('pay'), subtotal_cents: subtotal(),
          ...(state.taxAuto ? {} : { tax_cents: toCents($('#r_taxv', dlg).value) || 0 }), photo: photo || undefined, scan_id: scan ? scan.id : undefined,
          lines: state.lines.map(l => { const kind = l.dest.startsWith('obra:') ? 'obra' : l.dest; return { kind, job_id: kind === 'obra' ? Number(l.dest.slice(5)) : undefined, line_id: l.line_id ? Number(l.line_id) : undefined, category: l.category, description: l.description, subtotal_cents: toCents(l.amount) || 0 }; }), ...extra };
        const r = await api('POST', '/api/receipts', body);
        if (r && r.pending) { close(r); return; }
        toast(t('Ticket guardado: {m}', { m: fmt(r.total_cents) }) + (r.personal_cents ? ' · ' + t('{m} personal', { m: fmt(r.personal_cents) }) : ''));
        close(r);
      } catch (x) {
        const dup = $('#r_dup', dlg);
        if (x.status === 409 && x.data && x.data.duplicate) {
          dup.hidden = false;
          if (x.data.possible) {
            dup.innerHTML = `⚠️ ${esc(x.message)}<div class="row"><button type="button" class="sm" id="r_same">${t('Sí, es otro ticket')}</button></div>`;
            $('#r_same', dlg).onclick = () => { extra = { confirm_dup: true }; dup.hidden = true; $('form', dlg).requestSubmit(); };
          } else if (x.data.canOverride) {
            dup.innerHTML = `⛔ ${esc(x.message)}<div class="small">${t('Si de verdad es otro ticket (por ejemplo, una devolución y otra compra), escriba por qué:')}</div><div class="row" style="flex-wrap:nowrap"><input id="r_why" placeholder="${esc(t('Motivo'))}"><button type="button" class="sm danger" id="r_force">${t('Registrar de todos modos')}</button></div>`;
            $('#r_force', dlg).onclick = () => { const w = $('#r_why', dlg).value.trim(); if (w.length < 3) { $('#r_why', dlg).focus(); return; } extra = { dup_reason: w }; dup.hidden = true; $('form', dlg).requestSubmit(); };
          } else dup.innerHTML = `⛔ ${esc(x.message)}<div class="small">${t('Si cree que es un error, avísele a un dueño.')}</div>`;
          dup.scrollIntoView({ block: 'nearest' });
        } else err.textContent = x.message;
      }
    };
    document.body.appendChild(dlg); dlg.showModal();
  });
}

// Gastos: pestañas Obras | Empresa | Tickets (Empresa y Tickets solo los dueños).
function expensesHead(own, mode) {
  return `<div class="row between wrap"><h1>${t('Gastos')}</h1><div class="row"><button id="xscan">📷 ${t('Escanear tickets')}</button><button class="primary" id="xrcp">🧾 ${t('Registrar ticket')}</button></div></div>
    ${own ? `<nav class="seg" role="tablist">${[['obras', '🏗️ ' + t('Obras')], ['empresa', '🏢 ' + t('Empresa (gasto general)')], ['tickets', '🧾 ' + t('Tickets')]].filter(([k]) => officeModes().includes(k)).map(([k, l]) => `<button role="tab" class="${k === mode ? 'on' : ''}" data-xm="${k}" aria-selected="${k === mode}">${l}</button>`).join('')}</nav>` : ''}`;
}
function bindExpensesHead(app) {
  $$('[data-xm]', app).forEach(b => { b.onclick = () => { viewExpenses.mode = b.dataset.xm; viewExpenses(app); }; });
  $('#xscan', app).onclick = () => scanFlow(null, () => viewExpenses(app));
  $('#xrcp', app).onclick = async () => { if (await receiptDialog({})) viewExpenses(app); };
}
async function viewCompanyMoney(app, mode) {
  const f = viewCompanyMoney.f || { from: today().slice(0, 7) + '-01', to: today(), category: '' };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const filters = `<div class="fields" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
    <div class="field"><label>${t('Desde')}</label><input type="date" id="cf" value="${f.from}"></div><div class="field"><label>${t('Hasta')}</label><input type="date" id="ct" value="${f.to}"></div>
    ${mode === 'empresa' ? `<div class="field"><label>${t('Categoría')}</label><select id="cc"><option value="">${t('Todas')}</option>${CAT.companyCategories.map(c => `<option value="${c.key}" ${c.key === f.category ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}</select></div>` : ''}
    <div class="field"><label>&nbsp;</label><a class="btn" id="acsv" href="/api/accounting.csv?from=${f.from}&to=${f.to}" download>⬇ ${t('Para la contadora (CSV)')}</a></div></div>`;
  const ccat = k => L(CAT.companyCategories.find(c => c.key === k) || { es: k, en: k });
  const pay = k => L((CAT.payMethods || []).find(p => p.key === k) || { es: '', en: '' });
  if (mode === 'empresa') {
    const d = await api('GET', '/api/company-expenses?' + qs), st = await receiptSettings();
    app.innerHTML = `${expensesHead(true, mode)}<div class="card"><div class="row between wrap"><p class="small muted" style="margin:0">${t('Lo que no es de una obra: herramienta, equipo, vehículos, gasolina, seguros, oficina… La contadora lo recibe aparte de los gastos de obra.')}</p>
      <div class="row"><button class="sm" id="ctax">⚙ ${t('Impuesto {p}%', { p: (st.tax_rate_bp / 100).toFixed(2) })}</button><button id="cadd">${t('+ Gasto de empresa')}</button></div></div>${filters}
      ${Object.keys(d.by_category).length ? `<div class="row small" style="margin:.4rem 0 .8rem">${Object.entries(d.by_category).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="badge b-pendiente">${esc(ccat(k))}: ${fmt0(v)}</span>`).join('')}</div>` : ''}
      <p>${t('{n} gastos · Total {m}', { n: `<b>${d.rows.length}</b>`, m: `<b>${fmt(d.total_cents)}</b>` })}</p>
      ${d.rows.length ? `<div class="table-wrap"><table class="exptable"><thead><tr><th>${t('Fecha')}</th><th>${t('Qué')}</th><th>${t('Categoría')}</th><th>${t('Cómo se pagó')}</th><th class="num">${t('Monto')}</th><th></th></tr></thead><tbody>
        ${d.rows.map(c => `<tr data-id="${c.id}"><td class="nowrap" data-l="${t('Fecha')}">${fdate(c.date)}</td><td class="what">${esc(c.description)}<div class="small muted">${esc(c.vendor)}${c.ticket ? ' #' + esc(c.ticket) : ''}</div></td>
          <td data-l="${t('Categoría')}">${esc(ccat(c.category))}</td><td data-l="${t('Cómo se pagó')}">${esc(pay(c.pay_method))}</td><td class="num" data-l="${t('Monto')}">${fmt(c.amount_cents)}</td>
          <td class="nowrap acts">${c.has_file ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/receipts/${c.receipt_id}/file" title="${t('Ver recibo')}">🧾</a>` : ''}<button class="sm" data-ed>✎</button>${c.receipt_id ? '' : '<button class="sm danger" data-del>✕</button>'}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="empty">${t('No hay gastos de la empresa en este rango.')}</p>`}</div>`;
    const fields = (c = {}) => [
      { name: 'date', label: t('Fecha'), type: 'date', required: true, value: c.date || today() },
      { name: 'category', label: t('Categoría'), type: 'select', value: c.category || 'herramienta', options: vis(CAT.companyCategories, c.category).map(x => [x.key, L(x)]) },
      { name: 'description', label: t('Qué se compró'), required: true, value: c.description || '' },
      { name: 'vendor', label: t('Dónde / a quién'), value: c.vendor || '' }, { name: 'ticket', label: t('Número de ticket'), value: c.ticket || '' },
      { name: 'pay_method', label: t('Cómo se pagó'), type: 'select', value: c.pay_method || 'tarjeta', options: PAYS(c.pay_method).filter(([k]) => k !== 'propio') },
      ...(c.receipt_id ? [] : [{ name: 'amount_cents', label: t('Monto ($)'), type: 'money', required: true, value: c.amount_cents ? centsToInput(c.amount_cents) : '' }]) ];
    $('#cadd', app).onclick = async () => { if (await formDialog({ title: t('Gasto de la empresa'), fields: fields(), onSubmit: v => api('POST', '/api/company-expenses', v) })) viewCompanyMoney(app, mode); };
    $('#ctax', app).onclick = async () => { const v = await formDialog({ title: t('Impuesto de los tickets'), intro: t('Se calcula solo sobre el subtotal de cada ticket. En Texas (DFW) normalmente 8.25%.'),
      fields: [{ name: 'p', label: t('Impuesto (%)'), type: 'number', value: (st.tax_rate_bp / 100).toFixed(2), required: true }], onSubmit: v => api('PUT', '/api/receipts/settings', { tax_rate_bp: Math.round(Number(v.p) * 100) }) });
      if (v) { RCP_SET = null; viewCompanyMoney(app, mode); } };
    $$('tr[data-id]', app).forEach(tr => { const c = d.rows.find(x => x.id === Number(tr.dataset.id));
      $('[data-ed]', tr).onclick = async () => { if (await formDialog({ title: t('Gasto de la empresa'), fields: fields(c), onSubmit: v => api('PUT', `/api/company-expenses/${c.id}`, v) })) viewCompanyMoney(app, mode); };
      const dl = $('[data-del]', tr); if (dl) dl.onclick = async () => { if (await confirmDialog(t('¿Borrar el gasto “{x}” de {m}?', { x: c.description, m: fmt(c.amount_cents) }))) act(() => api('DELETE', `/api/company-expenses/${c.id}`), t('Borrado')).then(() => viewCompanyMoney(app, mode)); }; });
  } else {
    const rows = await api('GET', '/api/receipts?' + qs);
    const where = l => l.kind === 'obra' ? esc(l.client_name) : l.kind === 'empresa' ? '🏢 ' + esc(ccat(l.category)) : '🙅 ' + t('personal');
    const tot = rows.reduce((a, r) => a + r.total_cents, 0), byPay = {};
    for (const r of rows) byPay[r.pay_method || ''] = (byPay[r.pay_method || ''] || 0) + r.total_cents;
    app.innerHTML = `${expensesHead(true, mode)}<div class="card"><p class="small muted">${t('Todos los tickets del periodo, como vienen en el estado de cuenta de la tarjeta. Revise cada viernes que no falte ninguno.')}</p>${filters}
      ${Object.keys(byPay).length ? `<div class="row small" style="margin:.4rem 0 .8rem">${Object.entries(byPay).map(([k, v]) => `<span class="badge b-pendiente">${esc(pay(k) || t('Sin forma de pago'))}: ${fmt0(v)}</span>`).join('')}</div>` : ''}
      <p>${t('{n} tickets · Total {m}', { n: `<b>${rows.length}</b>`, m: `<b>${fmt(tot)}</b>` })}</p>
      ${rows.length ? `<div class="table-wrap"><table class="exptable"><thead><tr><th>${t('Fecha')}</th><th>${t('Ticket')}</th><th>${t('A dónde fue')}</th><th>${t('Cómo se pagó')}</th><th class="num">${t('Impuesto')}</th><th class="num">${t('Total')}</th><th></th></tr></thead><tbody>
        ${rows.map(r => `<tr data-id="${r.id}"><td class="nowrap" data-l="${t('Fecha')}">${fdate(r.date)}</td><td class="what"><b>${esc(r.vendor)}</b>${r.ticket ? ' #' + esc(r.ticket) : ` <span class="badge b-late">${t('sin número')}</span>`}${r.dup_reason ? ` <span class="badge b-late" title="${esc(r.dup_reason)}">${t('duplicado autorizado')}</span>` : ''}<div class="small muted">${t('registró {x}', { x: esc(r.by_name || '') })}</div></td>
          <td data-l="${t('A dónde fue')}" class="small">${r.lines.map(l => `${where(l)} ${fmt(l.amount_cents)}`).join('<br>')}</td><td data-l="${t('Cómo se pagó')}">${esc(pay(r.pay_method))}</td>
          <td class="num" data-l="${t('Impuesto')}">${fmt(r.tax_cents)}</td><td class="num" data-l="${t('Total')}"><b>${fmt(r.total_cents)}</b></td>
          <td class="nowrap acts">${r.has_file ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/receipts/${r.id}/file" title="${t('Ver recibo')}">🧾</a>` : `<span class="badge b-late" title="${t('Sin foto')}">📷?</span>`}<button class="sm danger" data-del>✕</button></td></tr>`).join('')}
      </tbody></table></div>` : `<p class="empty">${t('No hay tickets en este rango.')}</p>`}</div>`;
    $$('tr[data-id]', app).forEach(tr => { const r = rows.find(x => x.id === Number(tr.dataset.id));
      $('[data-del]', tr).onclick = async () => { if (await confirmDialog(t('¿Borrar el ticket de {x} por {m}? También se borran sus gastos en obras y en la empresa.', { x: r.vendor, m: fmt(r.total_cents) }))) act(() => api('DELETE', `/api/receipts/${r.id}`), t('Borrado')).then(() => viewCompanyMoney(app, mode)); }; });
  }
  bindExpensesHead(app); officeTrim(app);
  const upd = () => { viewCompanyMoney.f = { from: $('#cf').value, to: $('#ct').value, category: $('#cc') ? $('#cc').value : '' }; viewCompanyMoney(app, mode); };
  ['#cf', '#ct', '#cc'].forEach(x => { const el = $(x, app); if (el) el.onchange = upd; });
}

// =====================================================================
// v2.18 INSPECCIONES QUE PIDE LA CIUDAD: al aprobar el permiso se capturan y se ponen en el schedule entre los trades
// =====================================================================
const INSP_GROUPS = () => [['cimientos', t('Antes de colar')], ['rough', t('Rough (antes de cerrar o forrar)')], ['final', t('Finales')], ['otra', t('Otras')]];
// Lista de inspecciones: las de la app y las que la compañía agrega porque su ciudad las pide (dueños, PM y vendedores).
async function viewInspectionTypes(app) {
  const d = await api('GET', '/api/inspection-types');
  const G = INSP_GROUPS();
  const mine = d.types.filter(x => x.custom);
  app.innerHTML = `<div class="row between"><h1>🏛️ ${t('Inspecciones de la ciudad')}</h1><button class="primary" id="it_new">${t('+ Nueva inspección')}</button></div>
    <p class="muted">${t('Si su ciudad pide una inspección que no está aquí, agréguela. Después sale en la pregunta de cada obra, en su lugar entre los trades.')}</p>
    <div class="card"><h2>★ ${t('Las de la compañía')} <span class="muted small">${mine.length}</span></h2>
      ${mine.length ? `<div class="ins-list">${mine.map(x => `<div class="it-row"><span><b>${esc(L(x))}</b>${x.en && x.es !== x.en ? `<span class="small muted"> · ${esc(LANG === 'en' ? x.es : x.en)}</span>` : ''}<br><span class="small muted">${esc((G.find(g => g[0] === x.group) || G[3])[1])}${x.after_trade ? ' · ' + t('después de') + ' ' + esc(tradeLabel(x.after_trade)) : ''}${x.by ? ' · ' + t('agregó') + ' ' + esc(x.by) : ''}</span></span>
        <span class="row"><button class="sm" data-ied="${x.id}">✎</button>${x.can_delete ? `<button class="sm danger" data-irm="${x.id}">✕</button>` : ''}</span></div>`).join('')}</div>` : `<p class="muted">${t('Todavía no han agregado ninguna.')}</p>`}</div>
    <div class="card"><h2>${t('Las que ya trae la app')}</h2>${G.filter(([g]) => d.types.some(x => !x.custom && x.group === g)).map(([g, gl]) => `<h3 class="ins-h">${gl}</h3><div class="chips">${d.types.filter(x => !x.custom && x.group === g).map(x => `<span class="chip">${esc(L(x))}</span>`).join('')}</div>`).join('')}</div>`;
  const form = x => formDialog({ title: x ? t('Cambiar inspección') : t('Nueva inspección'), fields: [
    { name: 'name_es', label: t('Nombre en español'), value: x ? x.es : '', required: true, hint: t('ej. Tie-down de huracán') },
    { name: 'name_en', label: t('Nombre en inglés (opcional)'), value: x && x.en !== x.es ? x.en : '', hint: 'e.g. Hurricane tie-down' },
    { name: 'group', label: t('Etapa'), type: 'select', value: x ? x.group : 'otra', options: G.map(([v, l]) => [v, l]) },
    { name: 'after_trade', label: t('Normalmente va después de (trade)'), type: 'select', value: x ? x.after_trade : '', options: [['', t('— la app lo sugiere por la etapa —')], ...TRADES()] },
  ], onSubmit: async v => { if (x) await api('PUT', `/api/inspection-types/${x.id}`, v); else await api('POST', '/api/inspection-types', v); toast(x ? t('Guardado') : t('Agregada a la lista')); setTimeout(() => viewInspectionTypes(app), 0); } });
  $('#it_new').onclick = () => form(null);
  $$('[data-ied]').forEach(b => { b.onclick = () => form(mine.find(x => x.id === Number(b.dataset.ied))); });
  $$('[data-irm]').forEach(b => { b.onclick = async () => { if (!await confirmDialog(t('¿Quitar esta inspección de la lista? Las obras que ya la tienen no cambian.'), t('Sí, quitar'))) return; await api('DELETE', `/api/inspection-types/${b.dataset.irm}`); toast(t('Quitada de la lista')); viewInspectionTypes(app); }; });
}
async function inspectionsDialog(jobId, permitId) {
  const plan = await api('GET', `/api/jobs/${jobId}/inspection-plan${permitId ? `?permit_id=${permitId}` : ''}`);
  const GROUPS = INSP_GROUPS();
  const work = plan.tasks.filter(x => !x.inspection);
  const have = new Set(plan.existing.map(e => e.type));
  const sel = {}; const extra = [];
  const afterOpts = v => `<option value="0" ${v === 0 ? 'selected' : ''}>${t('— al principio —')}</option>${work.map(x => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${esc(taskTitle(x.title))}${x.trade ? ' · ' + esc(tradeLabel(x.trade)) : ''}</option>`).join('')}`;
  const nameOf = k => { const x = plan.types.find(y => y.key === k); return x ? L(x) : k; };
  const dlg = document.createElement('dialog'); dlg.className = 'wide';
  const draw = () => {
    dlg.innerHTML = `<form method="dialog" novalidate><div class="row between"><h2>🏛️ ${plan.permit ? t('¿Qué inspecciones pidió la ciudad?') : t('Inspecciones de la ciudad')}</h2>${plan.can_add ? `<a class="btn sm" href="#/inspecciones" data-list>✎ ${t('Lista de inspecciones')}</a>` : ''}</div><div class="error"></div>
      <div class="intro small">${plan.permit ? `${t('Permiso')}: <b>${esc(plan.permit.name)}</b>${plan.permit.number ? ' #' + esc(plan.permit.number) : ''}. ` : ''}${t('Marque las que vienen en la aprobación de los planos. La app pone cada una en el schedule después de la tarea que va antes; cámbiela si en su obra va en otro lugar.')}</div>
      ${plan.existing.length ? `<h3 class="ins-h">${t('Ya están en el schedule')}</h3><div class="ins-list">${plan.existing.map(e => `<label class="ins-row exist"><input type="checkbox" data-keep="${e.id}" checked ${e.removable ? '' : 'disabled'}><span><b>${esc(taskTitle(e.title))}</b><span class="small muted"> ${e.planned_date ? fdate(e.planned_date) : ''}${e.removable ? '' : ' · 🔒 ' + t('ya tiene avance')}</span></span><span class="small muted">${t('quítele la palomita si la ciudad no la pidió')}</span></label>`).join('')}</div>` : ''}
      ${GROUPS.filter(([g]) => plan.types.some(x => x.group === g)).map(([g, gl]) => `<h3 class="ins-h">${gl}</h3><div class="ins-list">${plan.types.filter(x => x.group === g).map(x => `<div class="ins-row ${sel[x.key] ? 'on' : ''}">
        <label class="check"><input type="checkbox" data-type="${x.key}" ${sel[x.key] ? 'checked' : ''}> <b>${esc(L(x))}</b>${x.custom ? ` <span class="badge co">★ ${t('de la compañía')}</span>` : ''}${have.has(x.key) ? ` <span class="badge" title="${esc(t('Se usa la que ya está y se mueve a este lugar'))}">${t('ya en el schedule')} · ${t('no se duplica')}</span>` : ''}</label>
        ${sel[x.key] ? `<div class="ins-where"><label class="small">${t('Va después de')}<select data-after="${x.key}">${afterOpts(sel[x.key].after)}</select></label><label class="small">${t('Fecha (si ya la sabe)')}<input type="date" data-date="${x.key}" value="${esc(sel[x.key].date || '')}"></label></div>` : ''}</div>`).join('')}</div>`).join('')}
      <h3 class="ins-h">${t('Otra que pidió la ciudad')}</h3><div class="ins-list">${extra.map((x, i) => `<div class="ins-row on"><input data-xname="${i}" value="${esc(x.name)}" placeholder="${esc(t('Nombre (ej. Green Energy, pre-construcción)'))}">
        <div class="ins-where"><label class="small">${t('Va después de')}<select data-xafter="${i}">${afterOpts(x.after)}</select></label><label class="small">${t('Fecha (si ya la sabe)')}<input type="date" data-xdate="${i}" value="${esc(x.date || '')}"></label><button type="button" class="sm danger" data-xrm="${i}">✕</button></div>
        ${plan.can_add ? `<div class="ins-save"><label class="check small"><input type="checkbox" data-xsave="${i}" ${x.save ? 'checked' : ''}> 📌 ${t('Agregarla a la lista para las próximas obras')}</label>${x.save ? `<select data-xgroup="${i}">${GROUPS.map(([g, gl]) => `<option value="${g}" ${x.group === g ? 'selected' : ''}>${gl}</option>`).join('')}</select>` : ''}</div>` : ''}</div>`).join('')}
        <button type="button" class="sm" id="ins_add">${t('+ Otra inspección')}</button></div>
      <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Poner en el schedule')}</button></div></form>`;
    const read = () => { $$('[data-after]', dlg).forEach(s => { sel[s.dataset.after].after = Number(s.value); }); $$('[data-date]', dlg).forEach(s => { sel[s.dataset.date].date = s.value; });
      $$('[data-xname]', dlg).forEach(s => { extra[Number(s.dataset.xname)].name = s.value; }); $$('[data-xafter]', dlg).forEach(s => { extra[Number(s.dataset.xafter)].after = Number(s.value); }); $$('[data-xdate]', dlg).forEach(s => { extra[Number(s.dataset.xdate)].date = s.value; }); $$('[data-xsave]', dlg).forEach(s => { extra[Number(s.dataset.xsave)].save = s.checked; }); $$('[data-xgroup]', dlg).forEach(s => { extra[Number(s.dataset.xgroup)].group = s.value; });
      $$('[data-keep]', dlg).forEach(c => { keep[c.dataset.keep] = c.checked; }); };
    $$('[data-type]', dlg).forEach(c => { c.onchange = () => { read(); if (c.checked) sel[c.dataset.type] = { after: plan.suggest[c.dataset.type] ?? (work.at(-1) || {}).id ?? 0, date: '' }; else delete sel[c.dataset.type]; draw(); }; });
    $('#ins_add', dlg).onclick = () => { read(); extra.push({ name: '', after: (work.at(-1) || {}).id ?? 0, date: '', save: !!plan.can_add, group: 'otra' }); draw(); const l = $$('[data-xname]', dlg).at(-1); if (l) l.focus(); };
    $$('[data-xsave]', dlg).forEach(c => { c.onchange = () => { read(); draw(); }; });
    { const a = $('[data-list]', dlg); if (a) a.onclick = () => close(false); }
    $$('[data-xrm]', dlg).forEach(b => { b.onclick = () => { read(); extra.splice(Number(b.dataset.xrm), 1); draw(); }; });
    $$('[data-keep]', dlg).forEach(c => { if (c.dataset.keep in keep) c.checked = keep[c.dataset.keep]; });
    $('[data-x]', dlg).onclick = () => close(false);
    $('form', dlg).onsubmit = async e => { e.preventDefault(); read();
      const items = [...Object.entries(sel).map(([type, v]) => ({ type, after_task_id: v.after, date: v.date || undefined })), ...extra.filter(x => x.name.trim()).map(x => ({ type: 'otra', name: x.name.trim(), after_task_id: x.after, date: x.date || undefined, save: !!x.save, save_group: x.group || 'otra' }))];
      const remove_task_ids = Object.entries(keep).filter(([, k]) => !k).map(([id]) => Number(id));
      if (!items.length && !remove_task_ids.length && !plan.permit) { $('.error', dlg).textContent = t('Escoja las inspecciones que pidió la ciudad'); return; }
      try { const r = await api('POST', `/api/jobs/${jobId}/inspections`, { permit_id: permitId || undefined, items, remove_task_ids });
        toast(t('{n} inspecciones en el schedule', { n: r.created.length }) + (r.removed ? ' · ' + t('{n} quitadas', { n: r.removed }) : '') + (r.saved && r.saved.length ? ' · ' + t('{n} nuevas en la lista', { n: r.saved.length }) : '')); close(true); }
      catch (err) { $('.error', dlg).textContent = err.message; } };
  };
  const keep = {};
  let close;
  const p = new Promise(res => { close = v => { dlg.close(); dlg.remove(); res(v); }; });
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(false); });
  document.body.appendChild(dlg); draw(); dlg.showModal();
  return p;
}

// ================= v2.20: FASE 3 (pagos a subs), PLANOS / ESTIMADO → INVOICE, SCOPE PARA SUBS =================
// Planos: PDF hasta 25 MB; las fotos se achican poco para que se lean las medidas.
function readPlanFile(file) {
  if (!file) return Promise.resolve(null);
  if (/^image\//.test(file.type)) return compressImage(file, 3200, 0.9);
  if (file.type !== 'application/pdf') return Promise.reject(new Error(t('Use una foto o un PDF')));
  if (file.size > 25 * 1024 * 1024) return Promise.reject(new Error(t('El archivo es muy grande (máximo 25 MB)')));
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error(t('No se pudo leer el archivo'))); r.readAsDataURL(file); });
}
const PAY_PLANS = () => [['50_50', t('50/50: mitad al empezar, mitad al terminar')], ['progreso', t('Por avance (% de su trabajo hecho)')], ['final', t('Un solo pago al final')]];
const payStageLabel = (k, pct) => k === 'inicio' ? t('50% al empezar') : k === 'avance' ? (pct == null ? t('por avance') : t('{p}% de avance', { p: pct })) : pct === 100 ? t('pago al terminar') : t('50% al terminar');
// Renglón del plan de pago debajo de cada sub (solo dueños): plan, qué toca pagar y lo que espera autorización.
async function subPlanRow(tr, s, reload) {
  let p; try { p = await api('GET', `/api/subs/${s.id}/pay-plan`); } catch { return; }
  tr._plan = p;
  const row = document.createElement('tr'); row.className = 'small payplan';
  const planL = (PAY_PLANS().find(x => x[0] === p.plan) || [])[1] || p.plan;
  row.innerHTML = `<td></td><td colspan="5"><div class="pp-line">
    <span>💵 <b>${esc(planL)}</b>${p.chosen ? '' : ` <span class="muted">(${t('sugerido')})</span>`}</span>
    ${p.plan === 'progreso' ? `<span>${t('Avance')}: <b>${p.pct}%</b> ${p.pct_manual ? '' : `<span class="muted">(${t('{a} de {b} tareas', { a: p.tasks_done, b: p.tasks_total })})</span>`}</span>` : ''}
    ${p.due_now_cents > 0 ? `<span class="badge b-pendiente">${t('Toca pagar {m}', { m: fmt(p.due_now_cents) })} · ${esc(payStageLabel(p.next.key, p.next.pct))}</span>` : p.next && p.next.amount_cents > 0 ? `<span class="muted">${t('Siguiente: {x} ({m}) cuando se cumpla', { x: payStageLabel(p.next.key, p.next.pct), m: fmt(p.next.amount_cents) })}</span>` : p.paid_cents >= p.agreed_cents && p.agreed_cents > 0 ? `<span class="badge b-hecho">${t('Pagado completo')}</span>` : p.waiting_cents ? '' : `<span class="muted">${t('Todavía no toca: se paga según avance')}</span>`}
    ${p.awaiting.map(x => `<span class="badge">⏳ ${t('Esperando autorización: {m}', { m: fmt(x.amount_cents) })}</span>`).join('')}
    ${p.w9 ? '' : `<span class="badge b-urg" title="${esc(t('Pídale su W-9 antes de pagarle'))}">${t('Sin W-9')}</span>`}
    <button class="sm" data-plan>✎ ${t('Plan')}</button></div></td>`;
  tr.parentNode.insertBefore(row, tr.nextSibling);
  $('[data-plan]', row).onclick = async () => {
    if (await formDialog({ title: t('Plan de pago de {x}', { x: s.name }), intro: `<p class="small muted">${t('Para trabajos de menos de {m} la app sugiere un solo pago al final.', { m: fmt0(p.small_cents) })}</p>`, fields: [
      { name: 'plan', label: t('Cómo se le paga'), type: 'select', value: p.chosen ? p.plan : '', options: [['', t('Sugerido por la app ({x})', { x: (PAY_PLANS().find(x => x[0] === p.suggested) || [])[1] })], ...PAY_PLANS()] },
      { name: 'progress_pct', label: t('Avance a mano (%)'), type: 'number', value: p.pct_manual ? p.pct : '', hint: t('Solo para "por avance". Vacío = la app lo calcula con sus tareas hechas.') },
    ], onSubmit: v => api('PUT', `/api/subs/${s.id}/pay-plan`, v) })) { toast(t('Guardado')); reload(); }
  };
}
// Mi cuenta (dueños): reglas de pagos a subs y avisos de inspección.
async function rulesCard(app) {
  const [sp, st] = await Promise.all([api('GET', '/api/sub-pay/settings'), api('GET', '/api/settings')]);
  const box = document.createElement('div'); box.className = 'card';
  box.innerHTML = `<h2>💵 ${t('Pagos a subs y avisos')}</h2>
    <label class="check"><input type="checkbox" id="r_dual" ${sp.dual ? 'checked' : ''}> ${t('Cada pago a un sub lo autorizan los dos dueños')}</label>
    <div class="field"><label>${t('Trabajo chico: un solo pago al final si es de menos de ($)')}</label><input id="r_small" inputmode="decimal" value="${centsToInput(sp.small_cents)}" style="max-width:180px"></div>
    <label class="check"><input type="checkbox" id="r_is" ${st.insp_notify_subs ? 'checked' : ''}> ${t('Avisar a los subs cuando pasa una inspección (y al que sigue)')}</label>
    <label class="check"><input type="checkbox" id="r_ic" ${st.insp_notify_client ? 'checked' : ''}> ${t('Avisar al cliente cuando pasa una inspección')}</label>
    <button class="primary" id="r_save">${t('Guardar')}</button>`;
  app.appendChild(box);
  $('#r_save', box).onclick = () => act(async () => {
    await api('PUT', '/api/sub-pay/settings', { dual: $('#r_dual', box).checked, small_cents: toCents($('#r_small', box).value) });
    await api('PUT', '/api/settings', { insp_notify_subs: $('#r_is', box).checked, insp_notify_client: $('#r_ic', box).checked });
  }, t('Guardado'));
}
const DOC_KIND = () => ({ plano: t('Planos'), estimado: t('Estimado'), invoice: 'Invoice', contrato: t('Contrato'), garantia: t('Garantía'), otro: t('Documento') });
const docLink = d => d.has_file ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/job-docs/${d.id}/file">👁 ${t('Ver')}</a><a class="btn sm" href="/api/job-docs/${d.id}/file?download=1">⬇</a>` : '';
const docIcon = d => d.mime === 'application/pdf' ? '📄' : d.has_file ? '🖼️' : '🧾';
// Pestaña Planos de la obra: planos para los subs, estimado → invoice, y el scope sin precios.
async function tabPlans(box, d, { id, reload }) {
  const r = await api('GET', `/api/jobs/${id}/docs`);
  const owner = ME.role === 'owner';
  const planos = r.docs.filter(x => x.kind === 'plano' || x.kind === 'otro'), money = r.docs.filter(x => x.kind === 'estimado' || x.kind === 'invoice');
  box.innerHTML = `${r.missing.planos || r.missing.estimado ? `<div class="card warnbox">⚠️ ${[r.missing.planos && t('Faltan los planos de esta obra.'), r.missing.estimado && t('Falta el estimado.')].filter(Boolean).join(' ')} ${t('Súbalos aquí para que los subs revisen el trabajo.')}</div>` : ''}
    <div class="card"><div class="row between"><h2>📐 ${t('Planos')}</h2><button class="primary" id="up_pl">${t('+ Subir planos')}</button></div>
      <p class="small muted">${t('Los subs de la obra ven los planos y el scope en su app, sin precios ni dinero.')}</p>
      ${planos.length ? `<div class="doc-list">${planos.map(x => `<div class="doc-row" data-id="${x.id}"><span class="doc-ic">${docIcon(x)}</span><div class="doc-main"><b>${esc(x.title)}</b><div class="small muted">${DOC_KIND()[x.kind]} · ${fdate(x.created_at.slice(0, 10))}${x.by ? ' · ' + esc(x.by) : ''}${x.size ? ' · ' + Math.max(1, Math.round(x.size / 1024)) + ' KB' : ''}</div>
        <div class="doc-share"><label class="check small"><input type="checkbox" data-ss ${x.share_subs ? 'checked' : ''}> 👷 ${t('Lo ven los subs')}</label><label class="check small"><input type="checkbox" data-sc ${x.share_client ? 'checked' : ''}> 🏠 ${t('Lo ve el cliente')}</label></div></div>
        <div class="row">${docLink(x)}<button class="sm danger" data-del>✕</button></div></div>`).join('')}</div>` : `<p class="empty">${t('Sin planos todavía.')}</p>`}</div>
    <div class="card"><div class="row between"><h2>🧾 ${t('Estimado e invoice')}</h2>${owner ? `<button id="up_est">${t('+ Subir estimado')}</button>` : ''}</div>
      <p class="small muted">${t('Cuando el cliente aprueba el estimado, tóquele "Aprobado": se convierte en invoice con el mismo monto y, si la obra no tenía contrato, ese es el contrato. Los subs nunca lo ven.')}</p>
      ${money.length ? `<div class="doc-list">${money.map(x => `<div class="doc-row" data-id="${x.id}"><span class="doc-ic">${docIcon(x)}</span><div class="doc-main"><b>${esc(x.kind === 'invoice' ? 'Invoice ' + x.number : x.title)}</b> ${x.status === 'aprobado' ? `<span class="badge b-hecho">${x.kind === 'invoice' ? t('Invoice') : t('Aprobado')}</span>` : `<span class="badge b-pendiente">${t('Esperando al cliente')}</span>`}
        <div class="small muted">${x.number && x.kind !== 'invoice' ? '#' + esc(x.number) + ' · ' : ''}<b>${fmt(x.amount_cents)}</b>${x.approved_at ? ' · ' + t('aprobado el {d}', { d: fdate(x.approved_at.slice(0, 10)) }) : ''}</div>
        ${x.kind === 'invoice' ? `<div class="doc-share"><label class="check small"><input type="checkbox" data-sc ${x.share_client ? 'checked' : ''}> 🏠 ${t('Lo ve el cliente')}</label></div>` : ''}</div>
        <div class="row">${docLink(x)}${owner && x.kind === 'estimado' && x.status !== 'aprobado' ? `<button class="sm primary" data-ok>✅ ${t('Aprobado → invoice')}</button><button class="sm" data-ed>✎</button><button class="sm danger" data-del>✕</button>` : ''}</div></div>`).join('')}</div>` : `<p class="empty">${t('Sin estimado todavía.')}</p>`}</div>
    <div class="card"><div class="row between"><h2>📋 ${t('Scope del trabajo (para los subs)')}</h2>${owner ? `<button class="sm" id="sc_sug">${t('Copiar de lo vendido (sin precios)')}</button>` : ''}</div>
      <p class="small muted">${t('Qué se va a hacer, medidas, materiales y colores. Sin precios: la app no deja guardar montos aquí.')}</p>
      <textarea id="sc_txt" rows="8" placeholder="${esc(t('Ej. Patio cover 20x14 con stain Cedar, techo de shingle, 4 abanicos y 6 luces…'))}">${esc(r.scope_text || '')}</textarea>
      <div class="row" style="margin-top:.5rem"><button class="primary" id="sc_save">${t('Guardar scope')}</button></div></div>`;
  $('#up_pl', box).onclick = async () => { if (await formDialog({ title: t('Subir planos'), fields: [
    { name: 'files', label: t('Planos (PDF o fotos)'), type: 'docs', required: true },
    { name: 'share_subs', label: t('Que los vean los subs de la obra'), type: 'check', value: true },
    { name: 'share_client', label: t('Que los vea el cliente'), type: 'check', value: false }],
    onSubmit: async v => { for (const f of v.files) await api('POST', `/api/jobs/${id}/docs`, { kind: 'plano', title: f.name, file: f.data, share_subs: v.share_subs, share_client: v.share_client }); } })) { toast(t('Planos subidos')); reload(); } };
  const estFields = (x = {}) => [
    ...(x.id ? [] : [{ name: 'file', label: t('Estimado (PDF o foto)'), type: 'doc', required: true }]),
    { name: 'number', label: t('Número del estimado'), value: x.number || '' },
    { name: 'amount_cents', label: t('Monto total ($)'), type: 'money', required: true, value: centsToInput(x.amount_cents) },
    { name: 'share_client', label: t('Que lo vea el cliente en su portal'), type: 'check', value: !!x.share_client }];
  if ($('#up_est', box)) $('#up_est', box).onclick = async () => { if (await formDialog({ title: t('Subir estimado'), fields: estFields(),
    onSubmit: v => api('POST', `/api/jobs/${id}/docs`, { kind: 'estimado', ...v, title: v.number ? t('Estimado') + ' ' + v.number : t('Estimado') }) })) { toast(t('Estimado guardado')); reload(); } };
  $$('.doc-row', box).forEach(el => {
    const x = r.docs.find(y => y.id === Number(el.dataset.id));
    const ss = $('[data-ss]', el); if (ss) ss.onchange = () => act(() => api('PUT', `/api/job-docs/${x.id}`, { share_subs: ss.checked }), t('Guardado'));
    const sc = $('[data-sc]', el); if (sc) sc.onchange = () => act(() => api('PUT', `/api/job-docs/${x.id}`, { share_client: sc.checked }), t('Guardado'));
    const del = $('[data-del]', el); if (del) del.onclick = async () => { if (await confirmDialog(t('¿Borrar este documento?'))) act(() => api('DELETE', `/api/job-docs/${x.id}`), t('Borrado')).then(reload); };
    const ed = $('[data-ed]', el); if (ed) ed.onclick = async () => { if (await formDialog({ title: t('Corregir estimado'), fields: estFields(x), onSubmit: v => api('PUT', `/api/job-docs/${x.id}`, v) })) reload(); };
    const ok = $('[data-ok]', el); if (ok) ok.onclick = async () => {
      if (!await confirmDialog(t('¿El cliente aprobó el estimado de {m}? Se convierte en invoice y ya no se puede cambiar.', { m: fmt(x.amount_cents) }), t('Sí, aprobado'))) return;
      try { const a = await api('POST', `/api/job-docs/${x.id}/approve`); toast(t('Listo: Invoice {n}', { n: a.number }) + (a.contract ? ' · ' + t('ya es el contrato de la obra') : a.contract_unchanged ? ' · ' + t('el contrato de la obra no cambió (ya tenía uno)') : '')); reload(); } catch (e) { toast(e.message, true); }
    };
  });
  if ($('#sc_sug', box)) $('#sc_sug', box).onclick = async () => { const s = await api('GET', `/api/jobs/${id}/scope/suggest`); const ta = $('#sc_txt', box); ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + s.scope_text; ta.focus(); };
  $('#sc_save', box).onclick = () => act(() => api('PUT', `/api/jobs/${id}/scope`, { scope_text: $('#sc_txt', box).value }), t('Scope guardado'));
}
// App del sub: planos y scope de la obra (sin precios).
async function workerPlansCard(app, jobId) {
  const r = await api('GET', `/api/jobs/${jobId}/docs`);
  if (!r.docs.length && !r.scope_text) return;
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h2>📐 ${t('Planos y scope del trabajo')}</h2>
    ${r.docs.length ? `<div class="doc-list">${r.docs.map(x => `<div class="doc-row"><span class="doc-ic">${docIcon(x)}</span><div class="doc-main"><b>${esc(x.title)}</b><div class="small muted">${fdate(x.created_at.slice(0, 10))}</div></div><div class="row">${docLink(x)}</div></div>`).join('')}</div>` : ''}
    ${r.scope_text ? `<h3>${t('Qué se va a hacer')}</h3><div class="scope-text">${esc(r.scope_text_tr || r.scope_text)}</div>${r.scope_text_tr ? `<details class="small muted"><summary>${t('Ver original')}</summary><div class="scope-text">${esc(r.scope_text)}</div></details>` : ''}` : ''}`;
  const tasksCard = [...app.querySelectorAll('.card')].find(x => x.querySelector('.task'));
  app.insertBefore(c, tasksCard || null);
}
// Portal del cliente: documentos que la compañía le compartió (planos, estimado, invoice).
async function clientDocsCard(app, j) {
  const r = await api('GET', `/api/jobs/${j.id}/docs`);
  if (!r.docs.length) return;
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h2>📄 ${t('Documentos de su proyecto')}</h2><div class="doc-list">${r.docs.map(x => `<div class="doc-row"><span class="doc-ic">${docIcon(x)}</span><div class="doc-main"><b>${esc(x.kind === 'invoice' ? 'Invoice ' + x.number : x.title)}</b>${x.amount_cents ? `<div class="small muted">${fmt(x.amount_cents)}</div>` : ''}</div><div class="row">${docLink(x)}</div></div>`).join('')}</div>`;
  ($('.portal', app) || app).appendChild(c);
}
// Inicio del dueño: a qué subs les toca pago según su plan.
async function subDueCard(box) {
  const due = await api('GET', '/api/sub-pay/due');
  if (!due.length) { box.remove(); return; }
  box.className = 'card';
  box.innerHTML = `<h2>💵 ${t('Toca pagar a subs')}</h2><p class="small muted">${t('Según el plan de pago de cada sub y lo que va de sus tareas. Cada pago lo autorizan los dos dueños.')}</p>
    ${due.map(x => `<div class="row between subdue"><span><b>${esc(x.name)}</b> <span class="small muted">· ${esc(x.client_name || '')} · ${esc(payStageLabel(x.stage, x.plan === 'final' ? 100 : x.plan === 'progreso' ? null : 50))}</span>${x.w9 ? '' : ` <span class="badge b-urg">${t('Sin W-9')}</span>`}</span><span class="row"><b>${fmt(x.due_now_cents)}</b><a class="btn sm" href="#/obra/${x.job_id}/subs">${t('Ver')}</a></span></div>`).join('')}`;
}

// ================= v2.21: FASE 4 — CHANGE ORDERS Y COBROS =================
// Facturar un change order y mandárselo al cliente.
async function coInvoiceDialog(c, after) {
  let r;
  const v = await formDialog({ title: t('Facturar change order {x}', { x: c.code }), submit: t('Facturar'), intro: `<p>${esc(c.description)}</p><p><b>${fmt(c.price_cents)}</b></p>`,
    fields: [{ name: 'due_days', label: t('Días para pagar'), type: 'number', value: '7' }], onSubmit: async v => { r = await api('POST', `/api/changes/${c.id}/invoice`, v); } });
  if (!v) return;
  if (after) after();
  const url = absUrl(r.url), l = r.client_lang || 'en';
  const msg = tl(l, 'Hola {n}, le mandamos el invoice {i} de {c} por {m} (change order {e}), con vencimiento el {d}. Puede verlo aquí: {u}', { n: r.client_name, i: r.invoice_number, c: r.company, m: fmtIn(l, r.amount_cents), e: r.code, d: fdateIn(l, r.due_date), u: url });
  sendDialog(t('Invoice {x} listo', { x: r.invoice_number }), url, r.client_phone, r.client_email, msg, `${r.company} · ${r.invoice_number}`);
}
// Dinero → Cobros: por obra, contrato + change orders, cobrado, por cobrar, COs sin cobrar o esperando al cliente, y vencidos.
async function viewCollections(box) {
  const rows = await api('GET', '/api/billing/summary');
  const tot = k => rows.reduce((a, r) => a + r[k], 0);
  box.innerHTML = `<div class="card"><h2>🧾 ${t('Cobros al cliente')}</h2><p class="small muted">${t('Cobrado contra por cobrar de cada obra, con los change orders que faltan de cobrar o que esperan al cliente. Para el cierre del viernes.')}</p>
    <div class="money-strip"><div><span>${t('Contratos + change orders')}</span><b>${fmt(tot('total_cents'))}</b></div><div><span>${t('Cobrado')}</span><b>${fmt(tot('paid_cents'))}</b></div><div><span>${t('Por cobrar')}</span><b>${fmt(tot('balance_cents'))}</b></div>
      <div><span>${t('Change orders sin cobrar')}</span><b>${fmt(tot('cos_unpaid_cents'))}</b></div><div class="${tot('overdue_cents') ? 'lowm' : ''}"><span>${t('Vencido')}</span><b class="${tot('overdue_cents') ? 'neg' : ''}">${fmt(tot('overdue_cents'))}</b></div></div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Obra')}</th><th class="num">${t('Contrato')}</th><th class="num">${t('Change orders')}</th><th class="num">${t('Cobrado')}</th><th class="num">${t('Por cobrar')}</th><th>${t('Change orders sin cobrar')}</th><th>${t('Esperando al cliente')}</th><th class="num">${t('Vencido')}</th></tr></thead><tbody>
      ${rows.map(r => `<tr class="click" data-go="#/obra/${r.job_id}/propuesta"><td><b>${esc(r.client_name)}</b> <span class="badge b-${r.status}">${statusLabel(r.status)}</span></td><td class="num">${fmt0(r.contract_cents)}</td><td class="num">${fmt0(r.cos_cents)}</td><td class="num">${fmt0(r.paid_cents)}</td><td class="num"><b>${fmt0(r.balance_cents)}</b></td>
        <td>${r.cos_unpaid.length ? `${r.cos_unpaid.map(c => `<span class="code small">${esc(c)}</span>`).join(' ')} <span class="small muted">${fmt0(r.cos_unpaid_cents)}</span>` : '—'}</td><td>${r.cos_waiting ? `${r.cos_waiting} · <span class="small">${fmt0(r.cos_waiting_cents)}</span>` : '—'}</td><td class="num ${r.overdue_cents ? 'neg' : ''}">${r.overdue_cents ? fmt0(r.overdue_cents) : '—'}</td></tr>`).join('')}</tbody></table></div>` : `<p class="empty">${t('No hay obras con contrato todavía.')}</p>`}</div>`;
  $$('[data-go]', box).forEach(r => { r.onclick = () => { location.hash = r.dataset.go; }; });
}

// ================= v2.22: FASE 5 — RESULTADO DE INSPECCIONES Y ROUGH-IN ANTES DE CERRAR =================
// Cambiar el estado de una tarea. Si es de cerrar o forrar y falta el rough-in o la inspección, explica qué falta
// y, si es dueño, deja pasar con motivo.
async function setTaskStatus(tid, status, jobId) {
  try { await api('PUT', `/api/tasks/${tid}`, { status }); return true; } catch (e) {
    if (e.status !== 409 || !e.data || !e.data.roughin) { toast(e.message, true); return false; }
    const b = e.data.roughin;
    const list = [...b.items.map(i => `<li>📷 ${esc(i.label || roughLabel(i.key))}</li>`), ...b.inspections.map(x => `<li>🔍 ${esc(t('Pasar la inspección: {x}', { x: taskTitle(x.title) }))}</li>`)].join('');
    let ok = false;
    await formDialog({ title: '🚧 ' + t('No se puede cerrar todavía'), submit: e.data.canOverride ? t('Cerrar de todos modos') : t('Entendido'), danger: !!e.data.canOverride,
      intro: `<p>${t('Antes de cerrar o forrar hay que confirmar con foto lo que va adentro y pasar la inspección. Si se cierra antes, se rompe y se rehace.')}</p><ul class="rough-miss">${list}</ul>
        ${jobId ? `<p><a href="#/obra/${jobId}/tareas" data-rlist>${t('Ver la lista de rough-in')}</a></p>` : ''}`,
      fields: e.data.canOverride ? [{ name: 'override_reason', label: t('Si de verdad hay que cerrar, escriba por qué (queda en el historial)'), type: 'textarea' }] : [],
      onSubmit: async v => { if (!e.data.canOverride) return; if (!v.override_reason || v.override_reason.trim().length < 3) throw new Error(t('Escriba el motivo')); await api('PUT', `/api/tasks/${tid}`, { status, override_reason: v.override_reason }); ok = true; } });
    return ok;
  }
}
const roughLabel = k => ({ plugs: t('Contactos (plugs) y switches en su lugar'), luces: t('Cajas de luces, abanicos y conduit'), av: t('Cables de bocinas, TV y bajo voltaje'), gas: t('Línea de gas y prueba de presión'), plomeria: t('Plomería rough (agua y drenaje)') }[k] || k);
// Resultado de una inspección: pasó, o no pasó con el motivo, fecha de reinspección y tarea para corregir.
async function inspResultDialog(p, result) {
  let res = result;
  if (!res) {
    const pick = await new Promise(r => { const dlg = document.createElement('dialog'); dlg.className = 'pick-res';
      dlg.innerHTML = `<h2>${esc(p.name || t('Inspección'))}</h2><p>${t('¿Cómo le fue en la inspección?')}</p><div class="row"><button class="primary" data-r="paso">✅ ${t('Pasó')}</button><button class="danger" data-r="fallo">❌ ${t('No pasó')}</button><button data-r="">${t('Cancelar')}</button></div>`;
      document.body.appendChild(dlg); dlg.showModal(); $$('[data-r]', dlg).forEach(b => { b.onclick = () => { dlg.close(); dlg.remove(); r(b.dataset.r); }; }); });
    if (!pick) return false; res = pick;
  }
  const fail = res === 'fallo';
  let out;
  const ok = await formDialog({ title: (fail ? '❌ ' + t('No pasó') : '✅ ' + t('Pasó')) + ' · ' + (p.name || ''), submit: fail ? t('Guardar y programar reinspección') : t('Guardar'), danger: fail,
    intro: fail ? `<p class="small muted">${t('Se guarda el motivo, se crea la reinspección y una tarea para corregir antes, al crew de ese trade. Se avisa a los dueños y al PM; al cliente no.')}</p>
      <div class="chips quick-r">${[t('Código nuevo'), t('Falta material o pieza'), t('Falta terminar el trabajo'), t('Medidas / distancias'), t('Faltan papeles o planos')].map(x => `<button type="button" class="chip" data-q="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : `<p class="small muted">${t('Se marca hecha en el schedule y se avisa a los subs y al cliente lo que sigue.')}</p>`,
    fields: [
      ...(fail ? [{ name: 'reason', label: t('¿Por qué no pasó? (lo que dijo el inspector)'), type: 'textarea', required: true }, { name: 'reinspect_date', label: t('Fecha de la reinspección'), type: 'date', hint: t('Si todavía no la sabe, déjela vacía.') }] : []),
      { name: 'date', label: t('Fecha de la inspección'), type: 'date', value: p.date && p.date <= today() ? p.date : today() },
      { name: 'inspector', label: t('Inspector (opcional)'), value: p.inspector || '' },
      { name: 'photo', label: fail ? t('Foto del aviso o de la corrección (opcional)') : t('Foto (opcional)'), type: 'photo', capture: true },
      ...(fail ? [{ name: 'fix', label: t('Crear tarea para corregir antes de la reinspección'), type: 'check', value: true }] : []),
    ],
    onOpen: dlg => { $$('[data-q]', dlg).forEach(b => { b.onclick = () => { const ta = $('[name=reason]', dlg); ta.value = (ta.value ? ta.value + ' — ' : '') + b.dataset.q + ': '; ta.focus(); }; }); },
    onSubmit: async v => { out = await api('POST', `/api/permits/${p.id}/result`, { result: res, ...v, photo: v.photo || undefined }); } });
  if (ok && out) toast(fail ? t('Guardado: reinspección y tarea para corregir creadas') : t('Pasó: avisamos lo que sigue'));
  return !!ok;
}
// Confirmar un renglón del rough-in con foto.
async function roughConfirmDialog(it) {
  return !!(await formDialog({ title: '📷 ' + (it.label || roughLabel(it.key)), submit: t('Confirmar'),
    intro: `<p class="small muted">${t('Tome la foto de cómo quedó antes de que se cierre. Sin foto no se confirma.')}</p>`,
    fields: [{ name: 'photo', label: t('Foto'), type: 'photo', capture: true, required: true }, { name: 'note', label: t('Nota (opcional)') }],
    onSubmit: v => api('POST', `/api/roughin/${it.id}/confirm`, v) }));
}
// Lista de rough-in de la obra (Tareas del dueño/PM y la obra del sub).
async function roughinCard(box, jobId, reload) {
  const r = await api('GET', `/api/jobs/${jobId}/roughin`);
  if (!r.items.length && !r.close_tasks.length) return;
  const boss = ME.role === 'owner' || ME.role === 'pm';
  if (!boss && !r.items.length) return;
  const c = document.createElement('div'); c.className = 'card rough';
  const blocked = r.close_tasks.filter(x => x.blocked && x.status !== 'hecho');
  c.innerHTML = `<div class="row between"><h2>🔌 ${t('Rough-in antes de cerrar')} <span class="badge ${r.done === r.total ? 'b-hecho' : 'b-pendiente'}">${r.done}/${r.total}</span></h2>${boss && ME.role === 'owner' ? `<button class="sm" data-radd>${t('+ Agregar')}</button>` : ''}</div>
    <p class="small muted">${t('Cada cosa que va adentro se confirma con foto. Hasta que esté todo y pase la inspección de rough, la app no deja cerrar ni forrar.')}</p>
    ${blocked.length ? `<div class="rough-block small">🚧 ${t('Frenadas:')} ${blocked.map(x => esc(taskTitle(x.title))).join(', ')}</div>` : r.close_tasks.length ? `<div class="small ok-line">✅ ${t('Ya se puede cerrar.')}</div>` : ''}
    <div class="rough-list">${r.items.map(i => `<div class="rough-row ${i.status}" data-rid="${i.id}"><span class="rough-ic">${i.status === 'ok' ? '✅' : i.status === 'na' ? '➖' : '⬜'}</span>
      <div style="flex:1;min-width:0"><b>${esc(i.label)}</b>${i.trade ? ` <span class="tr-chip small">${esc(tradeLabel(i.trade))}</span>` : ''}
        <div class="small muted">${i.status === 'ok' ? t('Confirmado por {x}', { x: esc(i.by) }) + (i.note ? ' · ' + esc(i.note) : '') : i.status === 'na' ? t('No aplica: {x}', { x: esc(i.note) }) : t('Falta la foto')}</div></div>
      ${i.photo_id ? `<span class="thumb"><img src="/files/${i.photo_id}" data-view="${i.photo_id}" alt="" loading="lazy"></span>` : ''}
      <span class="row">${i.status === 'pendiente' ? `<button class="sm primary" data-rok>📷 ${t('Confirmar')}</button>${ME.role === 'owner' ? `<button class="sm" data-rna>${t('No aplica')}</button>` : ''}` : ME.role === 'owner' ? `<button class="sm link" data-rreset>${t('Reabrir')}</button>` : ''}${ME.role === 'owner' ? '<button class="sm danger" data-rdel>✕</button>' : ''}</span></div>`).join('')}</div>`;
  box.insertBefore(c, box.firstChild);
  if (typeof bindPhotoViews === 'function') bindPhotoViews(c);
  const again = () => { if (reload) reload(); };
  const ad = $('[data-radd]', c); if (ad) ad.onclick = async () => { if (await formDialog({ title: t('Agregar a la lista de rough-in'), fields: [{ name: 'label', label: t('Qué hay que confirmar'), required: true, hint: t('Ej. conduit del switch a la chimenea') }, { name: 'trade', label: t('Trade que lo confirma'), type: 'select', value: '', options: [['', t('— cualquiera —')], ...TRADES()] }], onSubmit: v => api('POST', `/api/jobs/${jobId}/roughin`, v) })) again(); };
  $$('.rough-row', c).forEach(el => {
    const it = r.items.find(x => x.id === Number(el.dataset.rid));
    const okb = $('[data-rok]', el); if (okb) okb.onclick = async () => { if (await roughConfirmDialog(it)) { toast(t('Confirmado')); again(); } };
    const na = $('[data-rna]', el); if (na) na.onclick = async () => { if (await formDialog({ title: t('No aplica: {x}', { x: it.label }), fields: [{ name: 'reason', label: t('¿Por qué no aplica en esta obra?'), required: true }], onSubmit: v => api('POST', `/api/roughin/${it.id}/na`, v) })) again(); };
    const rs = $('[data-rreset]', el); if (rs) rs.onclick = () => act(() => api('POST', `/api/roughin/${it.id}/reset`), t('Listo')).then(again);
    const dl = $('[data-rdel]', el); if (dl) dl.onclick = async () => { if (await confirmDialog(t('¿Quitar de la lista?'), t('Sí, quitar'))) act(() => api('DELETE', `/api/roughin/${it.id}`), t('Quitado')).then(again); };
  });
}

// ================= v2.23: FILA DE ESPERA Y DISPONIBILIDAD DE SUBS =================
const Q_STATE = () => ({ listo: [t('Listo para arrancar'), 'b-hecho'], opcion: [t('Se puede arrancar'), 'b-en_progreso'], esperando: [t('Esperando respuestas'), 'b-pendiente'], sin_preguntar: [t('Sin preguntar'), ''], sin_clave: [t('Marque los subs clave'), 'b-urg'] });
// El sub contesta si puede empezar: un calendario con sus obras activas (sus tareas) y el día que se le pide.
// Toca "Sí puedo" o toca en el calendario el día desde el que sí puede.
const CAL_COLORS = ['#3b7dd8', '#d9822b', '#7a5cc7', '#2f9e6e', '#c2416b', '#8a8a2a'];
async function availDialog(q) {
  let c; try { c = await api('GET', `/api/queue/answers/${q.id}/calendar`); } catch (e) { toast(e.message, true); return false; }
  const need = c.needed_date || q.needed_date;
  let month = need.slice(0, 7), sel = c.answer === 'no' && c.available_from ? c.available_from : '';
  const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
  const mname = s => new Date(s + '-15T12:00:00Z').toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const wd = LANG === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  return await new Promise(resolve => {
    const dlg = document.createElement('dialog'); dlg.className = 'avail-dlg';
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    const grid = () => {
      const [y, m] = month.split('-').map(Number);
      const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const pad = (first.getUTCDay() + 6) % 7;
      let h = wd.map(w => `<div class="cal-wd">${w}</div>`).join('') + '<div></div>'.repeat(pad);
      for (let d = 1; d <= days; d++) {
        const iso = `${month}-${String(d).padStart(2, '0')}`, busy = c.days[iso] || [];
        const past = iso < c.today, sun = new Date(iso + 'T12:00:00Z').getUTCDay() === 0;
        const jobs = [...new Set(busy.map(b => b.job))];
        h += `<button type="button" class="cal-d${past ? ' past' : ''}${sun ? ' sun' : ''}${iso === need ? ' need' : ''}${iso === sel ? ' sel' : ''}${busy.length ? ' busy' : ''}" data-d="${iso}" ${past ? 'disabled' : ''} title="${esc(busy.map(b => `${c.jobs[b.job].name}: ${taskTitle(b.task)}`).join('\n'))}">
          <span class="n">${d}</span><span class="bars">${jobs.slice(0, 3).map(k => `<i style="background:${CAL_COLORS[k % CAL_COLORS.length]}"></i>`).join('')}</span></button>`;
      }
      return h;
    };
    const draw = () => {
      const pick = sel && sel > need ? sel : '';
      dlg.innerHTML = `<h2>📅 ${esc(q.client_name || c.job)}</h2>
        <p>${t('Le pedimos empezar su parte el {d}.', { d: `<b>${fdate(need)}</b>` })} ${t('En el calendario ve sus obras activas; toque el día desde el que sí puede.')}</p>
        ${c.jobs.length ? `<div class="cal-leg small">${c.jobs.map((jb, k) => `<span><i style="background:${CAL_COLORS[k % CAL_COLORS.length]}"></i>${esc(jb.name)}</span>`).join('')}<span><i class="need-i"></i>${t('Día que le pedimos')}</span></div>` : `<p class="small muted">${t('No tiene tareas en otras obras activas en estas fechas.')}</p>`}
        <div class="row between cal-nav"><button type="button" class="sm" data-m="-1" ${month <= c.today.slice(0, 7) ? 'disabled' : ''}>‹</button><b>${mname(month)}</b><button type="button" class="sm" data-m="1">›</button></div>
        <div class="cal-grid">${grid()}</div>
        ${(c.days[need] || []).length ? `<div class="small neg">⚠️ ${t('El {d} ya tiene trabajo en: {x}', { d: fdate(need), x: esc([...new Set(c.days[need].map(x => c.jobs[x.job].name))].join(', ')) })}</div>` : ''}
        <div class="cal-day small" id="cal_info"></div>
        <div class="row wrap cal-btns"><button class="primary" data-yes>✅ ${t('Sí puedo el {d}', { d: fdate(need) })}</button>
          ${pick ? `<button class="danger" data-from>📅 ${t('Puedo desde el {d}', { d: fdate(pick) })}</button>` : `<span class="small muted">${t('¿No puede ese día? Toque en el calendario el día que sí.')}</span>`}
          <button data-x>${t('Cancelar')}</button></div>`;
      $$('[data-m]', dlg).forEach(b => { b.onclick = () => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(b.dataset.m), 1)); month = ym(d.getUTCFullYear(), d.getUTCMonth() + 1); draw(); }; });
      $$('[data-d]', dlg).forEach(b => {
        b.onclick = () => { sel = b.dataset.d; draw(); const busy = c.days[sel] || []; $('#cal_info', dlg).innerHTML = `<span><b>${fdate(sel)}</b> — ${busy.length ? busy.map(x => `${esc(c.jobs[x.job].name)} — ${esc(taskTitle(x.task))}`).join(' · ') : t('libre')}${sel <= need ? ' · ' + t('es antes o igual al día que le pedimos: entonces sí puede') : ''}</span>`; };
      });
      $('[data-x]', dlg).onclick = () => done(false);
      $('[data-yes]', dlg).onclick = async () => { try { await api('POST', `/api/queue/answers/${q.id}`, { answer: 'si' }); toast(t('Gracias: le avisamos cuando arranque')); done(true); } catch (e) { toast(e.message, true); } };
      const fr = $('[data-from]', dlg); if (fr) fr.onclick = async () => { try { await api('POST', `/api/queue/answers/${q.id}`, { answer: 'no', available_from: pick }); toast(t('Listo: avisamos que puede desde el {d}', { d: fdate(pick) })); done(true); } catch (e) { toast(e.message, true); } };
    };
    document.body.appendChild(dlg); draw(); dlg.showModal();
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(false); });
  });
}
// Fila de espera: trabajos vendidos en orden de aprobación, con la fecha que propone la app y quién puede.
async function viewQueue(app) {
  const d = await api('GET', '/api/queue');
  const boss = ME.role === 'owner';
  app.innerHTML = `<div class="row between wrap"><h1>⏳ ${t('Fila de espera')}</h1>${boss ? `<button class="sm" id="q_set">⚙️ ${t('Reglas de la fila')}</button>` : ''}</div>
    <p class="muted">${t('Trabajos vendidos que esperan arrancar, en orden de aprobación. La app propone la fecha según cuándo se liberan los subs, les pregunta a todos y cuenta solo a los clave. Los demás pueden esperar hasta {n} días.', { n: d.max_wait })}</p>
    ${d.jobs.length ? d.jobs.map(j => queueCard(j)).join('') : `<div class="card"><p class="empty">${t('No hay trabajos esperando. Cuando se aprueba un estimado, el trabajo entra aquí.')}</p></div>`}`;
  const again = () => viewQueue(app);
  if ($('#q_set')) $('#q_set').onclick = async () => { if (await formDialog({ title: t('Reglas de la fila'), fields: [
    { name: 'max_wait', label: t('Días que puede esperar un sub que no es clave'), type: 'number', value: String(d.max_wait) },
    { name: 'first_stages', label: t('Cuántas primeras etapas cuentan como clave (si no las marca)'), type: 'number', value: String(d.first_stages) }],
    onSubmit: v => api('PUT', '/api/queue-settings', v) })) again(); };
  $$('.qcard', app).forEach(el => {
    const j = d.jobs.find(x => x.job_id === Number(el.dataset.job));
    const keys = () => $$('[data-key]', el).filter(c => c.checked).map(c => Number(c.dataset.key));
    $$('[data-key]', el).forEach(c => { c.onchange = () => act(() => api('PUT', `/api/queue/${j.job_id}`, { key_ids: keys() }), t('Guardado')).then(again); });
    const sd = $('[data-start]', el); sd.onchange = () => act(() => api('PUT', `/api/queue/${j.job_id}`, { start_date: sd.value }), t('Guardado')).then(again);
    const rs = $('[data-reset]', el); if (rs) rs.onclick = () => act(() => api('PUT', `/api/queue/${j.job_id}`, { start_date: '' }), t('Listo')).then(again);
    $('[data-ask]', el).onclick = async () => {
      if (!confirm(t('¿Preguntarles a los {n} subs si pueden, con arranque el {d}?', { n: j.subs.length, d: fdate(sd.value || j.proposed_start) }))) return;
      try { const r = await api('POST', `/api/queue/${j.job_id}/ask`, { start_date: sd.value || j.proposed_start }); toast(t('Preguntamos a {n} subs', { n: r.asked })); again(); } catch (e) { toast(e.message, true); }
    };
    $('[data-go]', el).onclick = async () => {
      const day = sd.value || j.proposed_start;
      const warn = j.state === 'listo' ? '' : `<p class="neg">⚠️ ${t('Todavía no confirman todos los subs clave ({p}% listo).', { p: j.readiness_pct })}</p>`;
      if (!await confirmDialog(`${warn}${t('¿Arrancar {x} el {d}? La app recorre el schedule a esa fecha y les avisa a los subs.', { x: esc(j.client_name), d: fdate(day) })}`, t('Sí, arrancar'))) return;
      try { await api('POST', `/api/queue/${j.job_id}/start`, { start_date: day }); toast(t('Arranque el {d}', { d: fdate(day) })); location.hash = `#/obra/${j.job_id}/tareas`; } catch (e) { toast(e.message, true); }
    };
    const rm = $('[data-out]', el); if (rm) rm.onclick = async () => { if (await confirmDialog(t('¿Quitar {x} de la fila? Puede volver a entrar si se aprueba otro estimado.', { x: esc(j.client_name) }), t('Sí, quitar'))) act(() => api('POST', `/api/queue/${j.job_id}/remove`), t('Quitado')).then(again); };
    $$('[data-phone]', el).forEach(b => { b.onclick = async () => {
      const s = j.subs.find(x => x.row_id === Number(b.dataset.phone));
      if (await availDialog({ id: s.row_id, client_name: `${s.name} · ${j.client_name}`, needed_date: s.needed_date })) again();
    }; });
  });
}
function queueCard(j) {
  const st = Q_STATE()[j.state] || ['', ''];
  const ansB = s => !s.asked_at ? `<span class="muted small">—</span>` : s.answer === 'si' ? `<span class="badge b-hecho">✅ ${t('Sí')}</span>` : s.answer === 'no' ? `<span class="badge b-urg">❌ ${t('Desde {d}', { d: fdate(s.available_from) })}</span>` : `<span class="badge">⏳ ${t('Sin contestar')}</span>`;
  return `<div class="card qcard" data-job="${j.job_id}">
    <div class="row between wrap"><div><h2 style="margin:0"><span class="qpos">#${j.position}</span> <a href="#/obra/${j.job_id}">${esc(j.client_name)}</a></h2>
      <div class="small muted">${t('Vendido el {d}', { d: fdate(j.queue_since) })} · ${t('{n} días esperando', { n: j.days_waiting })}${j.permit ? ' · ' + t('Permiso: {x}', { x: PERMIT_ST()[j.permit] || j.permit }) : ' · ' + t('sin permiso capturado')}</div></div>
      <span class="badge ${st[1]}">${st[0]}</span></div>
    <div class="qready"><div class="qbar"><span style="width:${j.readiness_pct}%"></span></div><b>${j.readiness_pct}%</b> <span class="small muted">${t('de los subs clave confirmaron')}</span></div>
    <div class="row wrap qstart"><label class="small">${t('Arranque')}: <input type="date" data-start value="${j.proposed_start}"></label>${j.start_fixed ? `<button class="sm link" data-reset>${t('Que la app la proponga')}</button>` : `<span class="small muted">${t('propuesto por la app')}</span>`}</div>
    <div class="table-wrap"><table class="qsubs"><thead><tr><th>⭐ ${t('Clave')}</th><th>${t('Sub')}</th><th>${t('Empieza con')}</th><th>${t('Lo necesitamos')}</th><th>${t('Libre desde')}</th><th>${t('Respuesta')}</th><th>${t('Espera')}</th><th></th></tr></thead><tbody>
      ${j.subs.map(s => `<tr class="${s.key ? 'key' : ''}"><td><input type="checkbox" data-key="${s.user_id}" ${s.key ? 'checked' : ''} title="${esc(t('Clave para empezar'))}"></td><td><b>${esc(s.name)}</b><div class="small muted">${s.trades.map(x => esc(tradeLabel(x))).join(', ')}</div></td>
        <td class="small">${s.first_task ? esc(taskTitle(s.first_task.title)) : '—'}</td><td class="nowrap">${fdate(s.needed_date)}</td><td class="nowrap ${s.free_from > s.needed_date ? 'neg' : ''}">${fdate(s.free_from)}</td>
        <td>${ansB(s)}</td><td class="nowrap ${s.too_long ? 'neg' : ''}">${s.wait_days ? t('{n} días', { n: s.wait_days }) + (s.too_long ? ' ⚠️' : '') : '—'}</td>
        <td>${s.row_id && s.asked_at ? `<button class="sm link" data-phone="${s.row_id}" title="${esc(t('Si le contestó por teléfono'))}">📞</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="8" class="muted">${t('Este trabajo todavía no tiene subs asignados.')}</td></tr>`}</tbody></table></div>
    <div class="row wrap" style="margin-top:.6rem"><button data-ask>📨 ${j.asked ? t('Volver a preguntar') : t('Preguntar a los subs')}</button><button class="${['listo', 'opcion'].includes(j.state) ? 'primary' : ''}" data-go>🚀 ${t('Arrancar el {d}', { d: fdate(j.proposed_start) })}</button>${ME.role === 'owner' ? `<button class="sm link" data-out>${t('Quitar de la fila')}</button>` : ''}</div></div>`;
}

// ================= v2.24: PLAN DEL DÍA =================
const PLAN_WHY = () => ({ tarea: t('Tarea'), atrasada: t('Atrasada'), inspeccion: t('Inspección'), cita: t('Cita'), seguimiento: t('Seguimiento'), quedo: t('Quedó pendiente') });
// Inicio: el plan de hoy arriba, para ir palomeando.
async function planTodayCard(app) {
  const p = await api('GET', '/api/plan?d=hoy');
  const c = document.createElement('div'); c.className = 'card plan-today';
  const open = p.items.filter(i => i.status !== 'movido');
  if (ME.role === 'worker' && !open.length) return; // al sub no se le muestra "no armó plan": menos ruido
  c.innerHTML = `<div class="row between"><h2>📋 ${t('Mi plan de hoy')} ${open.length ? `<span class="badge ${p.done === p.total ? 'b-hecho' : ''}">${p.done}/${p.total}</span>` : ''}</h2><a class="btn sm" href="#/plan?d=manana">${t('Plan de mañana')}</a></div>
    ${open.length ? `<div class="plan-list">${open.map(i => planRow(i, true)).join('')}</div>` : `<p class="small muted">${t('No armó plan para hoy.')} <a href="#/plan">${t('Armarlo ahora')}</a></p>`}`;
  const h = app.querySelector('h1'); const anchor = h ? (h.closest('.row') || h) : null;
  if (anchor && anchor.parentNode === app) app.insertBefore(c, anchor.nextSibling); else app.insertBefore(c, app.firstChild);
  bindPlanRows(c, open, () => { c.remove(); planTodayCard(app); });
}
function planRow(i, compact) {
  return `<div class="plan-row ${i.status}" data-pid="${i.id}"><button type="button" class="pchk" data-done title="${esc(t('Hecho'))}">${i.status === 'hecho' ? '✓' : i.status === 'no' ? '✕' : ''}</button>
    <div class="pmain">${i.time ? `<span class="ptime">${esc(i.time)}</span> ` : ''}<span class="ptext">${esc(taskTitle(i.text))}</span>${i.job ? ` <span class="tr-chip small">${esc(i.job)}</span>` : ''}${i.assigned_by_name ? ` <span class="badge small">${t('lo pidió {x}', { x: esc(i.assigned_by_name.split(' ')[0]) })}</span>` : ''}${i.carried_from ? ` <span class="small muted">↻ ${t('de ayer')}</span>` : ''}
      ${i.status === 'no' ? `<div class="small neg">${t('No se pudo: {x}', { x: esc(i.reason) })}</div>` : ''}</div>
    ${i.status === 'pendiente' ? `<button type="button" class="sm link" data-no>${t('No se pudo')}</button>` : `<button type="button" class="sm link" data-undo>${t('Deshacer')}</button>`}${compact ? '' : `${!i.assigned_by || i.mine_created ? '<button type="button" class="sm danger" data-del>✕</button>' : ''}`}</div>`;
}
function bindPlanRows(box, list, again) {
  $$('.plan-row[data-pid]', box).forEach(el => {
    const it = list.find(x => x.id === Number(el.dataset.pid)); if (!it) return;
    $('[data-done]', el).onclick = () => act(() => api('PUT', `/api/plan/items/${it.id}`, { status: it.status === 'hecho' ? 'pendiente' : 'hecho' })).then(again);
    const no = $('[data-no]', el); if (no) no.onclick = async () => { if (await formDialog({ title: t('¿Por qué no se pudo?'), fields: [{ name: 'reason', label: t('Motivo'), required: true, hint: t('Ej. no llegó el material, llovió, el cliente canceló') }], onSubmit: v => api('PUT', `/api/plan/items/${it.id}`, { status: 'no', reason: v.reason }) })) again(); };
    const un = $('[data-undo]', el); if (un) un.onclick = () => act(() => api('PUT', `/api/plan/items/${it.id}`, { status: 'pendiente' })).then(again);
    const del = $('[data-del]', el); if (del) del.onclick = () => act(() => api('DELETE', `/api/plan/items/${it.id}`)).then(again);
  });
}
// Pantalla del plan: hoy o mañana, de uno mismo o (si es jefe) de alguien de su equipo.
async function viewPlan(app, q) {
  const uid = q.get('user_id') || '', d = q.get('d') || (new Date().getHours() >= 14 ? 'manana' : 'hoy');
  const p = await api('GET', `/api/plan?d=${encodeURIComponent(d)}${uid ? '&user_id=' + uid : ''}`);
  const go = (nd, nu = uid) => { location.hash = `#/plan?d=${nd}${nu ? '&user_id=' + nu : ''}`; };
  const isSub = p.user.role === 'worker' && !p.mine;
  const jobs = ME.role === 'worker' ? [] : await api('GET', '/api/jobs').catch(() => []);
  const list = p.items.filter(i => i.status !== 'movido');
  app.innerHTML = `<div class="row between wrap"><h1 style="margin:0">📋 ${p.mine ? t('Mi plan') : t('Plan de {x}', { x: esc(p.user.name) })}</h1>
      ${p.team.length > 1 ? `<select id="pl_who" style="width:auto">${p.team.map(u => `<option value="${u.id}" ${u.id === p.user.id ? 'selected' : ''}>${esc(u.name)}${u.role === 'worker' ? ' · ' + t('Sub') : u.role === 'pm' ? ' · PM' : u.role === 'sales' ? ' · ' + t('Ventas') : ''}</option>`).join('')}</select>` : ''}</div>
    <nav class="seg"><a href="#" data-d="hoy" class="${p.date === p.today ? 'on' : ''}">${t('Hoy')} · ${fdate(p.today)}</a><a href="#" data-d="manana" class="${p.date === p.tomorrow ? 'on' : ''}">${t('Mañana')} · ${fdate(p.tomorrow)}</a></nav>
    <div class="card"><div class="row between"><h2>${t('Plan del {d}', { d: fdate(p.date) })} ${list.length ? `<span class="badge ${p.done === p.total ? 'b-hecho' : ''}">${p.done}/${p.total}</span>` : ''}</h2></div>
      ${!p.mine ? `<p class="small muted">${isSub ? t('Para subs: diga qué se necesita y en qué obra, sin horario. Son contratistas independientes.') : t('Lo que usted agregue le llega como aviso y queda marcado "lo pidió {x}".', { x: esc(ME.name.split(' ')[0]) })}</p>` : ''}
      ${list.length ? `<div class="plan-list">${list.map(i => planRow({ ...i, mine_created: i.created_by === (ME.pmId || ME.id) }, false)).join('')}</div>` : `<p class="empty">${t('Todavía no hay nada en este plan.')}</p>`}
      <form id="pl_add" class="plan-add"><input name="text" placeholder="${esc(t('¿Qué hay que hacer?'))}" required>${isSub ? '' : `<input name="time" type="time" style="width:auto">`}
        ${jobs.length ? `<select name="job_id" style="width:auto"><option value="">${t('— obra —')}</option>${jobs.filter(j => ['activo', 'cotizado', 'prospecto'].includes(j.status)).map(j => `<option value="${j.id}">${esc(j.client_name)}</option>`).join('')}</select>` : ''}
        <button class="primary">${t('+ Agregar')}</button></form></div>
    ${p.suggestions.length ? `<div class="card"><h2>💡 ${t('La app sugiere')}</h2><p class="small muted">${t('Lo que ya sabemos para ese día. Toque + para ponerlo en el plan.')}</p>
      <div class="plan-list">${p.suggestions.map((s, k) => `<div class="plan-row sug"><span class="badge small">${esc(PLAN_WHY()[s.why] || '')}</span><div class="pmain">${s.time ? `<span class="ptime">${esc(s.time)}</span> ` : ''}${esc(taskTitle(s.text))}${s.job ? ` <span class="tr-chip small">${esc(s.job)}</span>` : ''}</div><button type="button" class="sm primary" data-sug="${k}">+</button></div>`).join('')}</div>
      <button class="sm" id="pl_all">${t('Agregar todo')}</button></div>` : ''}
    ${p.team.length > 1 ? `<div class="card" id="pl_team"></div>` : ''}`;
  const again = () => viewPlan(app, q);
  $$('[data-d]', app).forEach(a => { a.onclick = e => { e.preventDefault(); go(a.dataset.d); }; });
  if ($('#pl_who')) $('#pl_who').onchange = e => go(d, Number(e.target.value) === (ME.pmId || ME.id) ? '' : e.target.value);
  bindPlanRows(app, list, again);
  const add = s => api('POST', '/api/plan/items', { user_id: p.user.id, date: p.date, text: s.text, job_id: s.job_id || null, ref: s.ref || '', time: s.time || '' });
  $('#pl_add').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); try { await add({ text: f.get('text'), time: f.get('time') || '', job_id: f.get('job_id') ? Number(f.get('job_id')) : null }); again(); } catch (er) { toast(er.message, true); } };
  $$('[data-sug]', app).forEach(b => { b.onclick = async () => { try { await add(p.suggestions[Number(b.dataset.sug)]); again(); } catch (er) { toast(er.message, true); } }; });
  if ($('#pl_all')) $('#pl_all').onclick = async () => { for (const s of p.suggestions) { try { await add(s); } catch { /* */ } } again(); };
  const tb = $('#pl_team');
  if (tb) { const tm = await api('GET', `/api/plan/team?d=${p.date}`).catch(() => null); if (tm) {
    tb.innerHTML = `<h2>👥 ${t('Plan del equipo · {d}', { d: fdate(tm.date) })}</h2><div class="table-wrap"><table><tbody>${tm.people.map(u => `<tr class="click" data-u="${u.id}"><td><b>${esc(u.name)}</b> <span class="small muted">${u.role === 'worker' ? t('Sub') : u.role === 'pm' ? 'PM' : u.role === 'sales' ? t('Ventas') : t('Dueño')}</span></td>
      <td>${u.total ? `<div class="bar" style="width:140px"><span style="width:${Math.round(u.done * 100 / u.total)}%"></span></div>` : `<span class="small muted">${t('sin plan')}</span>`}</td><td class="small">${u.total ? t('{a} de {b} hechas', { a: u.done, b: u.total }) : ''}${u.no ? ` · <span class="neg">${t('{n} no se pudo', { n: u.no })}</span>` : ''}</td><td><span class="btn sm">${t('Armar')}</span></td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-u]', tb).forEach(r => { r.onclick = () => go(d, Number(r.dataset.u) === (ME.pmId || ME.id) ? '' : r.dataset.u); });
  } }
}

// ===================== v2.25 — Historial diario de la obra =====================
// Lo que pasó cada día, junto solo. Se guarda en inglés; cada quien lo lee en su idioma. A las 10 PM se cierra solo.
const HIST_KIND = { report: () => t('Reporte del día'), internal: () => '🔒 ' + t('Nota interna') };
async function tabHistory(box, d, { id }) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const h = await api('GET', `/api/jobs/${id}/history${q.get('d') ? '?d=' + encodeURIComponent(q.get('d')) : ''}`);
  const L = LANG === 'en' ? 'en' : 'es';
  const go = day => { location.hash = `#/obra/${id}/historial?d=${day}`; };
  const i = h.days.indexOf(h.date);
  const prev = h.days[i + 1], next = i > 0 ? h.days[i - 1] : null;
  const isToday = h.date === h.today;
  box.innerHTML = `<div class="card hist">
    <div class="row between wrap"><h2>📒 ${t('Historial diario')}</h2>
      <div class="row"><button class="sm" data-prev ${prev ? '' : 'disabled'}>‹</button><input type="date" data-day value="${h.date}" max="${h.today}"><button class="sm" data-next ${next ? '' : 'disabled'}>›</button></div></div>
    <div class="row between wrap hist-status"><div><b>${fdate(h.date)}</b>${isToday ? ` · ${t('hoy')}` : ''}
      ${h.closed ? `<span class="badge b-hecho">🔒 ${h.auto ? t('Cerrado solo a las 10 PM') : t('Cerrado por {x}', { x: esc(h.closed_by) })}</span>` : `<span class="badge">${t('Abierto')}</span> <span class="small muted">${t('Se cierra solo a las 10 PM')}</span>`}</div>
      <div class="row">${h.can_close ? `<button class="sm" data-close>🔒 ${t('Cerrar el día')}</button>` : ''}
        <a class="btn sm" target="_blank" rel="noopener" href="/api/jobs/${id}/history/pdf?d=${h.date}">📄 ${t('PDF del día')}</a>
        <a class="btn sm" target="_blank" rel="noopener" href="/api/jobs/${id}/history/pdf">📚 ${t('PDF de toda la obra')}</a></div></div>
    <p class="small muted">${t('Se junta solo con lo que pasa en la obra. Se guarda en inglés (registro de la compañía); usted lo lee en su idioma. Nunca lleva montos de dinero.')} <a target="_blank" rel="noopener" href="/api/jobs/${id}/history/pdf?d=${h.date}&lang=es">${t('PDF en español')}</a></p>
    ${!h.closed && !h.report ? `<div class="hist-miss"><span>⚠️ ${isToday ? t('Todavía no hay reporte del día.') : t('Ese día no tuvo reporte.')}</span> <button class="sm primary" data-report>${t('+ Reporte de hoy')}</button></div>` : ''}
    ${h.weather && (h.weather[L] || h.weather.en) || h.crew ? `<p class="small">${h.weather && (h.weather[L] || h.weather.en) ? `🌤️ ${esc(h.weather[L] || h.weather.en)}` : ''}${h.crew ? ` · 👷 ${esc(h.crew)}` : ''}</p>` : ''}
    ${h.lines.length ? `<ul class="hist-lines">${h.lines.map(l => `<li><span class="htime">${esc(l.t || '')}</span><span class="hicon">${l.icon}</span><span>${esc(l[L] || l.en)}</span></li>`).join('')}</ul>` : `<p class="empty">${t('Nada registrado ese día.')}</p>`}
    ${h.notes.map(n => `<div class="hist-note ${n.kind}"><div class="small"><b>${HIST_KIND[n.kind] ? HIST_KIND[n.kind]() : ''}</b> · ${esc(n.by)} ${esc(n.t || '')}</div><div>${esc(n[L] || n.orig)}</div>${n[L] && n.orig && n[L] !== n.orig ? `<div class="small muted">${t('Original')}: ${esc(n.orig)}</div>` : ''}</div>`).join('')}
    ${h.photos.length ? `<div class="pp">${h.photos.slice(0, 12).map(p => `<span class="thumb"><img src="/files/${p}" data-view="${p}" alt="" loading="lazy"></span>`).join('')}</div>` : ''}
    ${h.late.length ? `<h3>${t('Notas tardías')}</h3>${h.late.map(n => `<div class="hist-note late"><div class="small"><b>${esc(n.by)}</b> · ${esc(n.t)} · ${fdate(n.d)}</div><div>${esc(n[L] || n.orig)}</div></div>`).join('')}` : ''}
    ${h.closed ? `<form class="row hist-add" data-late><input name="text" placeholder="${esc(t('Nota tardía: algo que faltó de ese día'))}" maxlength="2000"><button class="primary sm">${t('Agregar')}</button></form><p class="small muted">${t('El día cerrado no cambia. Lo que agregue queda con su nombre, fecha y hora.')}</p>` : ''}
  </div>`;
  bindPhotoViews(box);
  $('[data-prev]', box).onclick = () => prev && go(prev);
  $('[data-next]', box).onclick = () => next && go(next);
  $('[data-day]', box).onchange = e => e.target.value && go(e.target.value);
  const rep = $('[data-report]', box); if (rep) rep.onclick = () => dailyDialog(d.job, () => tabHistory(box, d, { id }));
  const cl = $('[data-close]', box); if (cl) cl.onclick = async () => { if (await confirmDialog(t('¿Cerrar el día? Ya no cambia; después solo se agregan notas tardías.'))) act(() => api('POST', `/api/jobs/${id}/history/close`, { date: h.date }), t('Día cerrado')).then(() => tabHistory(box, d, { id })); };
  const lf = $('[data-late]', box); if (lf) lf.onsubmit = e => { e.preventDefault(); const v = lf.text.value.trim(); if (!v) return; act(() => api('POST', `/api/jobs/${id}/history/notes`, { date: h.date, text: v }), t('Guardado')).then(() => tabHistory(box, d, { id })); };
}
// Inicio de dueños y PM: después de las 6:30 PM, las obras que trabajaron hoy y no tienen reporte del día.
async function historyTodayCard(app) {
  const r = await api('GET', '/api/history/today');
  const miss = r.jobs.filter(j => !j.report && !j.closed);
  if (!r.after || !miss.length) return;
  const c = document.createElement('div'); c.className = 'card hist-today';
  c.innerHTML = `<h2>📒 ${t('Falta el reporte del día')}</h2><p class="small muted">${t('Estas obras trabajaron hoy y nadie escribió qué pasó. A las 10 PM el día se cierra solo.')}</p>
    ${miss.map(j => `<a class="row between hist-job" href="#/obra/${j.id}/historial"><span><b>${esc(j.code)}</b> ${esc(j.name)}</span><span class="small muted">${j.lines} ${t('cosas registradas')}</span></a>`).join('')}`;
  const h = app.querySelector('h1'); const anchor = h ? (h.closest('.row') || h) : null;
  if (anchor && anchor.parentNode === app) app.insertBefore(c, anchor.nextSibling); else app.insertBefore(c, app.firstChild);
}

// ===================== v2.26 — Puestos y permisos =====================
// Qué pestañas de Gastos ve cada quien. Administración: empresa y tickets (y obras con el permiso). Contadora: las tres.
function officeModes() {
  if (ME.role === 'admin') return [...((ME.tools || []).includes('gastos_obras') ? ['obras'] : []), 'empresa', 'tickets'];
  return ['obras', 'empresa', 'tickets'];
}
// La oficina no edita ni borra lo ya registrado; la contadora solo ve.
function officeTrim(app) {
  if (!OFFICE()) return;
  $$('[data-ed], [data-del], #ctax', app).forEach(e => e.remove());
  if (ME.role === 'accountant') $$('#cadd, #xscan, #xrcp', app).forEach(e => e.remove());
  if (ME.role === 'admin') $$('#acsv, #csv', app).forEach(e => (e.closest('.field') || e).remove());
}
// Inicio de Administración y de la Contadora.
async function viewOffice(app) {
  const o = await api('GET', '/api/office');
  if (ME.role === 'admin') {
    app.innerHTML = `<div class="row between wrap"><h1>${t('Hola, {x}', { x: esc(ME.name.split(' ')[0]) })}</h1>
      <div class="row"><button class="primary" id="oscan">📷 ${t('Escanear tickets')}</button><button id="orcp">🧾 ${t('Registrar ticket')}</button></div></div>
      <div class="okpis">
        <a class="card okpi" href="#/gastos"><div class="small muted">${t('Tickets por asignar')}</div><div class="big">${o.scans_waiting}</div></a>
        <a class="card okpi" href="#/gastos"><div class="small muted">${t('Tickets este mes')}</div><div class="big">${o.receipts_month}</div><div class="small muted">${t('{n} los subió usted', { n: o.mine_month })}</div></a>
        <a class="card okpi" href="#/gastos"><div class="small muted">${t('Gasto de la empresa este mes')}</div><div class="big">${fmt0(o.company_month_cents)}</div></a></div>
      <div data-scans></div>
      <div class="card small muted">🏢 ${t('Su puesto: <b>Administración</b>. Registra tickets y gastos de la compañía. No ve precios, ganancias ni pagos de las obras; lo que haya que corregir o borrar lo hace un dueño.')}</div>`;
    $('#oscan').onclick = () => scanFlow(null, () => viewOffice(app));
    $('#orcp').onclick = async () => { if (await receiptDialog({})) viewOffice(app); };
    const sb = $('[data-scans]', app); ownerScansCard(sb, () => viewOffice(app)).catch(() => sb.remove());
    planTodayCard(app).catch(() => {});
    docsAlertCard(app).catch(() => {});
    return;
  }
  const y = new Date().getFullYear();
  const f = viewOffice.f || { from: `${y}-01-01`, to: today() };
  const prof = await api('GET', `/api/reports/profit?year=${f.from.slice(0, 4)}`).catch(() => null);
  const q = `from=${f.from}&to=${f.to}`;
  app.innerHTML = `<h1>${t('Contabilidad')}</h1>
    <div class="card"><div class="fields" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="field"><label>${t('Desde')}</label><input type="date" id="af" value="${f.from}"></div><div class="field"><label>${t('Hasta')}</label><input type="date" id="at" value="${f.to}"></div></div>
      <h2>⬇ ${t('Bajar para Excel o QuickBooks')}</h2>
      <div class="dl-grid">
        <a class="btn" href="/api/accounting.csv?${q}" download>🧾 ${t('Gastos de obra y de empresa')}</a>
        <a class="btn" href="/api/export/gastos?${q}" download>🏗️ ${t('Gastos de obra (QuickBooks)')}</a>
        <a class="btn" href="/api/export/pagos?${q}" download>💵 ${t('Pagos de clientes')}</a>
        <a class="btn" href="/api/export/bills?${q}" download>📄 ${t('Invoices de subs aprobados')}</a>
        <a class="btn" href="/api/papers-1099?year=${f.from.slice(0, 4)}" download>🗂️ ${t('Reporte 1099 del año {y}', { y: f.from.slice(0, 4) })}</a>
      </div></div>
    <div class="okpis">
      <div class="card okpi"><div class="small muted">${t('Tickets este mes')}</div><div class="big">${o.receipts_month}</div></div>
      <div class="card okpi"><div class="small muted">${t('Gasto de la empresa este mes')}</div><div class="big">${fmt0(o.company_month_cents)}</div></div>
      ${prof ? `<div class="card okpi"><div class="small muted">${t('Ganancia de obras {y}', { y: prof.year })}</div><div class="big">${fmt0(prof.totals.profit_cents)}</div><div class="small muted">${prof.totals.margin_pct ?? '—'}% · ${t('{n} obras', { n: prof.totals.jobs })}</div></div>` : ''}</div>
    ${prof && prof.by_type.length ? `<div class="card"><h2>${t('Ganancia por tipo de proyecto')}</h2><div class="table-wrap"><table><thead><tr><th>${t('Tipo')}</th><th class="num">${t('Obras')}</th><th class="num">${t('Contrato')}</th><th class="num">${t('Gastado')}</th><th class="num">${t('Ganancia')}</th><th class="num">%</th></tr></thead><tbody>
      ${prof.by_type.map(r => `<tr><td>${esc(typeLabel(r.project_type))}</td><td class="num">${r.jobs}</td><td class="num">${fmt0(r.contract_cents)}</td><td class="num">${fmt0(r.spent_cents)}</td><td class="num">${fmt0(r.profit_cents)}</td><td class="num">${r.margin_pct ?? '—'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div data-mc></div>
    <div class="card small muted">📒 ${t('Su puesto: <b>Contadora</b>. Puede ver y bajar todo lo de dinero, pero no puede cambiar nada. En "Gastos" ve cada gasto y cada ticket con su foto.')}</div>`;
  monthCloseCard($('[data-mc]', app)).catch(e => console.error(e));
  const upd = () => { viewOffice.f = { from: $('#af').value, to: $('#at').value }; viewOffice(app); };
  $('#af').onchange = upd; $('#at').onchange = upd;
}
// Equipo: qué puede hacer cada puesto (tabla clara) — para que el dueño escoja bien.
const PERM_LABEL = () => ({ ventas: t('Herramienta de Ventas (agenda, citas, estimados)'), cuadrilla: t('Encargado de cuadrilla: escribe el reporte del día de sus obras'), gastos_obras: t('Ve los gastos de las obras (sin precios ni ganancias)'), reparto: t('Ve el reparto de ganancia entre socios') });
const PERM_ROLES = { ventas: ['owner', 'pm'], cuadrilla: ['worker'], gastos_obras: ['admin'], reparto: ['accountant'] };
function rolesMatrixCard() {
  const Y = '✅', N = '—', P = '🔸';
  const cols = ['owner', 'pm', 'sales', 'admin', 'accountant', 'worker', 'client'];
  const R = ROLE();
  const rows = [
    [t('Ver obras'), [Y, t('Las suyas'), N, N, t('Solo números'), t('Las suyas'), t('La suya')]],
    [t('Precios, contrato y ganancia'), [Y, Y, t('Sus estimados'), N, Y, N, t('Su precio')]],
    [t('Tareas, fotos y calendario'), [Y, Y, N, N, N, Y, t('Avance')]],
    [t('Escanear y registrar tickets'), [Y, Y, N, Y, N, Y, N]],
    [t('Gastos de la compañía'), [Y, N, N, Y, t('Ver'), N, N]],
    [t('Aprobar pagos y cambios de dinero'), [Y, N, N, N, N, N, N]],
    [t('Reporte del día'), [Y, Y, N, N, N, P, t('Lo ve')]],
    [t('Bajar reportes para la contadora'), [Y, N, N, N, Y, N, N]],
    [t('Agregar usuarios y permisos'), [Y, N, N, N, N, N, N]],
  ];
  return `<div class="card"><h2>🧩 ${t('Puestos y permisos')}</h2><p class="small muted">${t('Qué puede hacer cada puesto. 🔸 = solo con el permiso por persona (se prende al editar a la persona).')}</p>
    <div class="table-wrap"><table class="matrix"><thead><tr><th></th>${cols.map(c => `<th>${esc(R[c])}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(([l, v]) => `<tr><td><b>${esc(l)}</b></td>${v.map(x => `<td class="c">${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="small muted">${t('Nadie más que los dueños ve el dinero de la compañía completa ni aprueba pagos. La oficina y la contadora nunca pueden borrar lo ya registrado.')}</p></div>`;
}
// Encargado de cuadrilla: reporte del día de su obra (interno; lo ven los dueños y el PM, no el cliente).
function crewDailyDialog(job, after) {
  const d = document.createElement('dialog');
  d.innerHTML = `<form novalidate><h2>📒 ${t('Reporte del día')} · ${esc(job.client_name)}</h2>
    <p class="small muted">${t('Lo ven los dueños y el project manager. Queda en el historial de la obra.')}</p><div class="fields">
    <div class="field"><label>${t('Fecha')}</label><input type="date" name="date" value="${today()}" max="${today()}"></div>
    <div class="field"><label>${t('Clima')}</label><input name="weather" placeholder="${esc(t('Soleado, 75°'))}"></div>
    <div class="field full"><label>${t('Cuadrilla')}</label><input name="crew" placeholder="${esc(t('Quiénes trabajaron'))}"></div>
    <div class="field full"><label>${t('Qué se hizo hoy')}</label><textarea name="notes" rows="4" required></textarea></div>
    <div class="field full"><label>${t('Fotos')}</label><div data-pp></div></div></div>
    <p class="error-msg" hidden></p><div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Guardar')}</button></div></form>`;
  document.body.appendChild(d);
  const getPhotos = photoPicker($('[data-pp]', d));
  $('[data-x]', d).onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  $('form', d).onsubmit = async e => {
    e.preventDefault(); const f = e.target, btn = $('button[type=submit]', d); btn.disabled = true;
    try {
      await api('POST', `/api/jobs/${job.id}/logs`, { date: f.date.value, weather: f.weather.value, crew: f.crew.value, client_notes: f.notes.value, photos: getPhotos() });
      d.close(); toast(t('Reporte guardado')); if (after) after();
    } catch (err) { const m = $('.error-msg', d); m.hidden = false; m.textContent = err.message; btn.disabled = false; }
  };
  d.showModal();
}

// ===================== v2.27 — Documentos =====================
const CDOC_KIND = () => ({ licencia: t('Licencia'), seguro: t('Seguro'), registro: t('Registro en una ciudad'), w9: t('W-9 de la compañía'), contrato: t('Contrato o acuerdo'), otro: t('Otro') });
const DSTATE = () => ({ vigente: ['b-hecho', t('Vigente')], por_vencer: ['b-urg', t('Vence pronto')], vencido: ['b-late', t('Vencido')], sin_fecha: ['', t('Sin vencimiento')] });
const dstate = s => { const [c, l] = DSTATE()[s] || ['', s]; return `<span class="badge ${c}">${esc(l)}</span>`; };
// Página Documentos: papeles de la compañía (y plantillas para los dueños).
async function viewCompanyDocs(app) {
  const r = await api('GET', '/api/company-docs');
  const own = ME.role === 'owner' && !ME.is_agent;
  app.innerHTML = `<div class="row between wrap"><h1>${t('Documentos')}</h1>${r.can_manage ? `<button class="primary" id="cd_add">${t('+ Papel de la compañía')}</button>` : ''}</div>
    <div class="card"><h2>🏢 ${t('Papeles de la compañía')}</h2>
      <p class="small muted">${t('Licencias, seguros, registro en cada ciudad, W-9 de la compañía… Le avisamos 30 días antes de que venzan y el día que vencen.')}</p>
      ${r.docs.length ? `<div class="doc-list">${r.docs.map(x => `<div class="doc-row" data-id="${x.id}"><span class="doc-ic">${x.mime === 'application/pdf' ? '📄' : x.has_file ? '🖼️' : '📁'}</span>
        <div class="doc-main"><b>${esc(x.title)}</b> ${dstate(x.state)}<div class="small muted">${esc(CDOC_KIND()[x.kind] || x.kind)}${x.city ? ' · ' + esc(x.city) : ''}${x.number ? ' · #' + esc(x.number) : ''}${x.expires ? ' · ' + t('vence el {d}', { d: fdate(x.expires) }) : ''}</div>${x.notes ? `<div class="small">${esc(x.notes)}</div>` : ''}</div>
        <div class="row">${x.has_file ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/company-docs/${x.id}/file">👁 ${t('Ver')}</a>` : `<span class="badge b-late">${t('Sin archivo')}</span>`}${r.can_manage ? `<button class="sm" data-ed>✎</button>` : ''}${own ? `<button class="sm danger" data-del>✕</button>` : ''}</div></div>`).join('')}</div>`
        : `<p class="empty">${t('Todavía no hay papeles. Suba la licencia, el seguro y el registro de cada ciudad donde trabajan.')}</p>`}</div>
    <div data-tpl></div>`;
  const fields = (x = {}) => [
    { name: 'kind', label: t('Tipo'), type: 'select', value: x.kind || 'registro', options: Object.entries(CDOC_KIND()) },
    { name: 'title', label: t('Nombre'), required: true, value: x.title || '', hint: t('Ej. Registro de contratista — Plano') },
    { name: 'city', label: t('Ciudad (si aplica)'), value: x.city || '' }, { name: 'number', label: t('Número'), value: x.number || '' },
    { name: 'issued', label: t('Desde'), type: 'date', value: x.issued || '' }, { name: 'expires', label: t('Vence'), type: 'date', value: x.expires || '', hint: t('Vacío si no vence') },
    { name: 'file', label: x.id ? t('Archivo nuevo (si lo renovó)') : t('Archivo (PDF o foto)'), type: 'doc' },
    { name: 'notes', label: t('Notas'), type: 'textarea', value: x.notes || '' }];
  const clean = v => { const o = { ...v }; if (!o.file) delete o.file; return o; };
  if ($('#cd_add', app)) $('#cd_add', app).onclick = async () => { if (await formDialog({ title: t('Papel de la compañía'), fields: fields(), onSubmit: v => api('POST', '/api/company-docs', clean(v)) })) { toast(t('Guardado')); viewCompanyDocs(app); } };
  $$('.doc-row', app).forEach(el => { const x = r.docs.find(y => y.id === Number(el.dataset.id));
    const ed = $('[data-ed]', el); if (ed) ed.onclick = async () => { if (await formDialog({ title: x.title, fields: fields(x), onSubmit: v => api('PUT', `/api/company-docs/${x.id}`, clean(v)) })) { toast(t('Guardado')); viewCompanyDocs(app); } };
    const dl = $('[data-del]', el); if (dl) dl.onclick = async () => { if (await confirmDialog(t('¿Borrar “{x}”?', { x: x.title }))) act(() => api('DELETE', `/api/company-docs/${x.id}`), t('Borrado')).then(() => viewCompanyDocs(app)); }; });
  if (own) templatesCard($('[data-tpl]', app)).catch(e => console.error(e));
}
const TPL_NAME = () => ({ contrato: t('Contrato'), change_order: 'Change order', garantia: t('Certificado de garantía') });
async function templatesCard(box) {
  const r = await api('GET', '/api/doc-templates');
  box.className = 'card';
  box.innerHTML = `<h2>📝 ${t('Plantillas')}</h2><p class="small muted">${t('Se llenan solas con los datos de la obra y salen en PDF listo para firmar (en la obra → Contrato y garantías). Cambie el texto a su gusto y pida a su abogado que lo revise.')}</p>
    <div class="doc-list">${r.templates.map(x => `<div class="doc-row" data-k="${x.key}"><span class="doc-ic">📝</span><div class="doc-main"><b>${esc(TPL_NAME()[x.key])}</b> ${x.custom ? `<span class="badge b-en_progreso">${t('Con su texto')}</span>` : `<span class="badge">${t('Texto de la app')}</span>`}</div>
      <div class="row"><button class="sm" data-ed>✎ ${t('Cambiar texto')}</button></div></div>`).join('')}</div>`;
  $$('.doc-row', box).forEach(el => { const x = r.templates.find(y => y.key === el.dataset.k);
    $('[data-ed]', el).onclick = async () => {
      const v = await formDialog({ title: TPL_NAME()[x.key], wide: true,
        intro: t('Los datos van entre llaves dobles, por ejemplo {{client_name}}. Disponibles:') + ' ' + r.fields.map(f => `{{${f}}}`).join(' ') + '. ' + t('Una línea que empieza con # es título; con ## es subtítulo; con - es lista.'),
        extraButton: x.custom ? { label: t('Volver al texto de la app'), onClick: async () => { await api('PUT', `/api/doc-templates/${x.key}`, { reset: true }); toast(t('Listo')); templatesCard(box); } } : null,
        fields: [{ name: 'body', label: t('Texto'), type: 'textarea', rows: 18, value: x.body, required: true }],
        onSubmit: v => api('PUT', `/api/doc-templates/${x.key}`, { body: v.body }) });
      if (v) { toast(t('Guardado')); templatesCard(box); }
    }; });
}
// Pestaña de la obra: contrato, change orders en PDF y garantías.
async function tabDocuments(box, d, { id, reload }) {
  const [r, w] = await Promise.all([api('GET', `/api/jobs/${id}/docs`), api('GET', `/api/jobs/${id}/warranties`)]);
  const owner = ME.role === 'owner' && !ME.is_agent;
  const contr = r.docs.filter(x => x.kind === 'contrato'), gar = r.docs.filter(x => x.kind === 'garantia');
  const cos = (d.changes || []);
  const row = x => `<div class="doc-row" data-id="${x.id}"><span class="doc-ic">${docIcon(x)}</span><div class="doc-main"><b>${esc(x.title)}</b> ${x.status === 'aprobado' ? `<span class="badge b-hecho">✍️ ${t('Firmado')}</span>` : `<span class="badge">${t('Sin firmar')}</span>`}
      <div class="small muted">${fdate(x.created_at.slice(0, 10))}${x.by ? ' · ' + esc(x.by) : ''}${x.approved_at ? ' · ' + t('firmado el {d}', { d: fdate(x.approved_at.slice(0, 10)) }) : ''}</div>
      <div class="doc-share"><label class="check small"><input type="checkbox" data-sc ${x.share_client ? 'checked' : ''}> 🏠 ${t('Lo ve el cliente')}</label></div></div>
    <div class="row">${docLink(x)}${owner && x.status !== 'aprobado' ? `<button class="sm primary" data-sig>✍️ ${t('Firmado')}</button><button class="sm danger" data-del>✕</button>` : ''}</div></div>`;
  box.innerHTML = `<div class="card"><div class="row between wrap"><h2>✍️ ${t('Contrato')}</h2><div class="row"><button class="primary" id="g_con">📝 ${t('Hacer contrato')}</button><button id="u_con">⬆ ${t('Subir contrato')}</button></div></div>
      <p class="small muted">${t('"Hacer contrato" lo llena solo con los datos de la obra (cliente, dirección, precio, pagos, fechas). Imprímalo o mándelo, y cuando esté firmado tóquele "Firmado" y suba la copia firmada: ya no se cambia ni se borra. Los subs nunca lo ven.')}</p>
      ${contr.length ? `<div class="doc-list">${contr.map(row).join('')}</div>` : `<p class="empty">${t('Sin contrato todavía.')}</p>`}
      ${cos.length ? `<div class="row" style="margin-top:.6rem"><select id="co_sel">${cos.map(c => `<option value="${c.id}">${esc(c.code || '#' + c.id)} · ${esc(c.description)} · ${fmt(c.price_cents)}</option>`).join('')}</select><button id="g_co">📝 ${t('Hacer change order en PDF')}</button></div>` : ''}</div>
    <div class="card"><div class="row between wrap"><h2>🛡️ ${t('Garantías')}</h2><div class="row"><button id="w_add">${t('+ Garantía de fábrica')}</button><button id="g_gar" ${w.workmanship.completed ? '' : 'disabled'}>📝 ${t('Certificado de garantía')}</button></div></div>
      <div class="wk">${w.workmanship.completed ? `🛠️ <b>${t('Garantía de trabajo: {n} meses', { n: w.workmanship.months })}</b> · ${t('terminada el {d}', { d: fdate(w.workmanship.completed) })} · ${t('vale hasta el {d}', { d: fdate(w.workmanship.until) })} ${dstate(w.workmanship.state)}`
        : `🛠️ ${t('La garantía de trabajo ({n} meses) empieza cuando la obra se termina.', { n: w.workmanship.months })}`}</div>
      ${w.items.length ? `<div class="doc-list">${w.items.map(x => `<div class="doc-row" data-w="${x.id}"><span class="doc-ic">🏭</span><div class="doc-main"><b>${esc(x.item)}</b> ${dstate(x.state)}<div class="small muted">${esc([x.brand, x.model].filter(Boolean).join(' · '))}${x.serial ? ' · S/N ' + esc(x.serial) : ''} · ${t('hasta el {d}', { d: fdate(x.expires) })}</div>${x.notes ? `<div class="small">${esc(x.notes)}</div>` : ''}</div>
        <div class="row">${x.has_file ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/warranties/${x.id}/file">👁 ${t('Ver')}</a>` : ''}<button class="sm" data-wed>✎</button>${owner ? '<button class="sm danger" data-wdel>✕</button>' : ''}</div></div>`).join('')}</div>`
        : `<p class="small muted">${t('Agregue las garantías de fábrica de lo que se instaló (calentadores, ventiladores, cocina…). El cliente las ve en su portal y le avisamos antes de que venzan.')}</p>`}
      ${gar.length ? `<div class="doc-list">${gar.map(row).join('')}</div>` : ''}</div>`;
  const gen = async (template, extra = {}) => { try { const x = await api('POST', `/api/jobs/${id}/generate`, { template, ...extra }); toast(t('Listo: {x}', { x: x.title })); window.open(`/api/job-docs/${x.id}/file`, '_blank'); reload(); } catch (e) { toast(e.message, true); } };
  $('#g_con', box).onclick = () => gen('contrato');
  if ($('#g_co', box)) $('#g_co', box).onclick = () => gen('change_order', { co_id: Number($('#co_sel', box).value) });
  $('#g_gar', box).onclick = () => gen('garantia');
  $('#u_con', box).onclick = async () => { if (await formDialog({ title: t('Subir contrato'), fields: [{ name: 'file', label: t('Contrato (PDF o foto)'), type: 'doc', required: true }, { name: 'title', label: t('Nombre'), value: t('Contrato') }, { name: 'share_client', label: t('Que lo vea el cliente en su portal'), type: 'check', value: true }],
    onSubmit: v => api('POST', `/api/jobs/${id}/docs`, { kind: 'contrato', ...v }) })) { toast(t('Guardado')); reload(); } };
  const wFields = (x = {}) => [
    { name: 'item', label: t('Qué es'), required: true, value: x.item || '', hint: t('Ej. Calentador eléctrico') }, { name: 'brand', label: t('Marca'), value: x.brand || '' },
    { name: 'model', label: t('Modelo'), value: x.model || '' }, { name: 'serial', label: t('Número de serie'), value: x.serial || '' },
    { name: 'starts', label: t('Desde'), type: 'date', value: x.starts || w.workmanship.completed || today() }, { name: 'years', label: t('Años de garantía'), type: 'number', value: x.id ? '' : '1', hint: t('O ponga la fecha exacta abajo') },
    { name: 'expires', label: t('Vence'), type: 'date', value: x.expires || '' }, { name: 'file', label: t('Garantía o manual (PDF o foto)'), type: 'doc' }, { name: 'notes', label: t('Notas'), type: 'textarea', value: x.notes || '' }];
  const wclean = v => { const o = { ...v }; if (!o.file) delete o.file; if (!o.expires) delete o.expires; return o; };
  $('#w_add', box).onclick = async () => { if (await formDialog({ title: t('Garantía de fábrica'), fields: wFields(), onSubmit: v => api('POST', `/api/jobs/${id}/warranties`, wclean(v)) })) { toast(t('Guardado')); reload(); } };
  $$('[data-w]', box).forEach(el => { const x = w.items.find(y => y.id === Number(el.dataset.w));
    $('[data-wed]', el).onclick = async () => { if (await formDialog({ title: x.item, fields: wFields(x), onSubmit: v => api('PUT', `/api/warranties/${x.id}`, wclean(v)) })) reload(); };
    const dl = $('[data-wdel]', el); if (dl) dl.onclick = async () => { if (await confirmDialog(t('¿Borrar la garantía de {x}?', { x: x.item }))) act(() => api('DELETE', `/api/warranties/${x.id}`), t('Borrado')).then(reload); }; });
  $$('.doc-row[data-id]', box).forEach(el => { const x = r.docs.find(y => y.id === Number(el.dataset.id));
    const sc = $('[data-sc]', el); if (sc) sc.onchange = () => act(() => api('PUT', `/api/job-docs/${x.id}`, { share_client: sc.checked }), t('Guardado'));
    const dl = $('[data-del]', el); if (dl) dl.onclick = async () => { if (await confirmDialog(t('¿Borrar este documento?'))) act(() => api('DELETE', `/api/job-docs/${x.id}`), t('Borrado')).then(reload); };
    const sg = $('[data-sig]', el); if (sg) sg.onclick = async () => { if (await formDialog({ title: t('Marcar como firmado'), intro: t('Ya firmado, este documento no se cambia ni se borra. Suba la copia firmada si la tiene.'), submit: t('Firmado'),
      fields: [{ name: 'file', label: t('Copia firmada (PDF o foto)'), type: 'doc' }], onSubmit: v => api('POST', `/api/job-docs/${x.id}/signed`, v.file ? { file: v.file } : {}) })) { toast(t('Guardado')); reload(); } }; });
}
// Portal del cliente: sus garantías.
async function clientWarrantyCard(app, j) {
  const w = await api('GET', `/api/jobs/${j.id}/warranties`);
  if (!w.workmanship.completed && !w.items.length) return;
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h2>🛡️ ${t('Sus garantías')}</h2>
    ${w.workmanship.completed ? `<div class="wk">🛠️ <b>${t('Garantía de trabajo: {n} meses', { n: w.workmanship.months })}</b> · ${t('vale hasta el {d}', { d: fdate(w.workmanship.until) })}</div>` : ''}
    ${w.items.map(x => `<div class="doc-row"><span class="doc-ic">🏭</span><div class="doc-main"><b>${esc(x.item)}</b><div class="small muted">${esc([x.brand, x.model].filter(Boolean).join(' · '))}${x.serial ? ' · S/N ' + esc(x.serial) : ''} · ${t('hasta el {d}', { d: fdate(x.expires) })}</div></div><div class="row">${x.has_file ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/warranties/${x.id}/file">👁 ${t('Ver')}</a>` : ''}</div></div>`).join('')}`;
  ($('.portal', app) || app).appendChild(c);
}
// Inicio de dueños y oficina: papeles por vencer.
async function docsAlertCard(app) {
  const r = await api('GET', '/api/company-docs');
  const list = r.docs.filter(x => ['vencido', 'por_vencer'].includes(x.state));
  if (!list.length) return;
  const c = document.createElement('div'); c.className = 'card notices';
  c.innerHTML = `<div class="row between"><h2>📁 ${t('Papeles por vencer')}</h2><a class="btn sm" href="#/documentos">${t('Ver documentos')}</a></div>
    ${list.map(x => `<div class="notice small"><span><b>${esc(x.title)}</b> · ${x.state === 'vencido' ? t('venció el {d}', { d: fdate(x.expires) }) : t('vence el {d}', { d: fdate(x.expires) })}</span> ${dstate(x.state)}</div>`).join('')}`;
  const h = app.querySelector('h1'); const anchor = h ? (h.closest('.row') || h) : null;
  if (anchor && anchor.parentNode === app) app.insertBefore(c, anchor.nextSibling); else app.appendChild(c);
}

// ===================== v2.28 — Resumen de la mañana y borradores de texto =====================
async function viewDigest(app, q) {
  const own = ME.role === 'owner' && !ME.is_agent;
  const uid = q.get('u');
  const d = await api('GET', '/api/digest' + (uid && own ? `?user_id=${uid}` : ''));
  const L = LANG === 'en' ? 'en' : 'es';
  const team = own ? await api('GET', '/api/users').catch(() => []) : [];
  app.innerHTML = `<div class="row between wrap"><h1>☀️ ${d.for.id === ME.id ? t('Su día') : t('El día de {x}', { x: esc(d.for.name) })} · ${fdate(d.date)}</h1>
      ${own ? `<select id="dg_who"><option value="">${t('El mío')}</option>${team.filter(u => u.active && !['client', 'accountant'].includes(u.role) && u.id !== ME.id).map(u => `<option value="${u.id}" ${String(u.id) === uid ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}</div>
    ${d.sections.length ? d.sections.map(s => `<div class="card dg"><h2>${s.icon} ${esc(s.title[L])} <span class="badge">${s.items.length}</span></h2>
      ${s.items.map(i => `<a class="dg-item" href="${esc(i.link || '#/')}">${esc(i[L])}</a>`).join('')}</div>`).join('')
      : `<div class="card"><p class="empty">${t('Nada pendiente para hoy. ¡Buen día!')}</p></div>`}
    ${d.for.id === ME.id ? `<div class="card small"><label class="check"><input type="checkbox" id="dg_on" ${d.off ? '' : 'checked'}> ${t('Mandarme este resumen cada mañana a las {h}', { h: d.time })}</label>
      ${own ? `<div class="row" style="margin-top:.5rem"><span>${t('Hora del resumen (para todos)')}:</span><input type="time" id="dg_time" value="${d.time}" style="width:auto"></div>` : ''}</div>` : ''}`;
  const w = $('#dg_who', app); if (w) w.onchange = () => { location.hash = '#/resumen' + (w.value ? '?u=' + w.value : ''); };
  const on = $('#dg_on', app); if (on) on.onchange = () => act(() => api('PUT', '/api/digest/settings', { off: !on.checked }), t('Guardado'));
  const tm = $('#dg_time', app); if (tm) tm.onchange = () => act(() => api('PUT', '/api/digest/settings', { time: tm.value }), t('Guardado'));
}
const DRAFT_KIND = () => ({ encuesta: '⭐ ' + t('Encuesta al cliente'), manana_cliente: '🏠 ' + t('Mañana en su casa'), manana_sub: '👷 ' + t('Mañana para el sub'), insp_cliente: '🏛️ ' + t('Inspección de mañana'), insp_paso: '✅ ' + t('Pasó la inspección'), cobro: '💵 ' + t('Recordatorio de cobro') });
async function draftsCard(box, after) {
  const r = await api('GET', '/api/sms/drafts');
  if (!r.drafts.length) { box.remove(); return; }
  box.className = 'card drafts';
  box.innerHTML = `<h2>✉️ ${t('Textos listos para mandar')} <span class="badge b-late">${r.drafts.length}</span></h2>
    <p class="small muted">${r.enabled ? t('La app los dejó listos. Revíselos, cámbielos si quiere y toque Mandar. Van en el idioma de cada persona y nunca llevan dinero.') : t('La app los dejó listos. Como los textos de la empresa todavía no están conectados, cópielos o ábralos en Mensajes de su teléfono y luego toque "Ya lo mandé".')}</p>
    ${r.drafts.map(d => `<div class="draft" data-id="${d.id}"><div class="row between wrap"><div><b>${esc(d.to)}</b> <span class="small muted">${esc(d.role_label ? t(d.role_label) : '')}${d.client_name ? ' · ' + esc(d.client_name) : ''}</span></div><span class="badge">${esc(DRAFT_KIND()[d.kind] || d.kind)} · ${d.lang === 'en' ? 'EN' : 'ES'}</span></div>
      <textarea rows="3">${esc(d.body)}</textarea>
      <div class="row">${r.enabled ? `<button class="sm primary" data-send>📤 ${t('Mandar')}</button>` : `<a class="btn sm primary" data-open href="sms:${esc(d.phone)}?&body=${encodeURIComponent(d.body)}">📱 ${t('Abrir en Mensajes')}</a><button class="sm" data-copy>📋 ${t('Copiar')}</button><button class="sm" data-done>✔ ${t('Ya lo mandé')}</button>`}<button class="sm" data-drop>✕ ${t('No mandar')}</button></div></div>`).join('')}`;
  $$('.draft', box).forEach(el => { const id = el.dataset.id, ta = $('textarea', el);
    const s = $('[data-send]', el); if (s) s.onclick = () => act(() => api('POST', `/api/sms/drafts/${id}/send`, { body: ta.value }), t('Mandado')).then(after);
    const o = $('[data-open]', el); if (o) ta.oninput = () => { o.href = o.href.split('&body=')[0] + '&body=' + encodeURIComponent(ta.value); };
    const c = $('[data-copy]', el); if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(ta.value); toast(t('Copiado')); } catch { ta.select(); } };
    const dn = $('[data-done]', el); if (dn) dn.onclick = () => act(() => api('POST', `/api/sms/drafts/${id}/done`, { body: ta.value }), t('Guardado')).then(after);
    $('[data-drop]', el).onclick = () => act(() => api('POST', `/api/sms/drafts/${id}/done`, { discard: true }), t('Listo')).then(after); });
}
async function draftsHomeCard(app) {
  const r = await api('GET', '/api/sms/drafts');
  if (!r.drafts.length) return;
  const c = document.createElement('a'); c.className = 'card row between drafts-home'; c.href = '#/textos';
  c.innerHTML = `<span>✉️ <b>${t('Textos listos para mandar')}</b> · ${(r.drafts.length === 1 ? t('1 borrador') : t('{n} borradores', { n: r.drafts.length }))}</span><span class="btn sm">${t('Revisar')}</span>`;
  const h = app.querySelector('h1'); const anchor = h ? (h.closest('.row') || h) : null;
  if (anchor && anchor.parentNode === app) app.insertBefore(c, anchor.nextSibling); else app.appendChild(c);
}

// ===================== v2.31 — Gastos de subs por revisar y verificación =====================
const putTop = (app, c) => { const h = app.querySelector('h1'); const anchor = h ? (h.closest('.row') || h) : null; if (anchor && anchor.parentNode === app) app.insertBefore(c, anchor.nextSibling); else app.prepend(c); };
async function reviewHomeCard(app) {
  const list = await api('GET', '/api/expenses/review');
  if (!list.length) return;
  const c = document.createElement('div'); c.className = 'card review-card';
  const draw = rows => {
    if (!rows.length) { c.remove(); return; }
    c.innerHTML = `<h2>🧾 ${t('Gastos de subs por revisar')} <span class="badge b-pendiente">${rows.length}</span></h2>
      <p class="small muted">${t('Ya cuentan en la obra. Revise que estén bien; si algo está mal, ábralo en la obra para corregirlo o borrarlo.')}</p>
      ${rows.map(e => `<div class="rev-row" data-id="${e.id}"><div><b>${fmt(e.amount_cents)}</b> · ${esc(e.description)}${e.vendor ? ` · ${esc(e.vendor)}` : ''}
        <div class="small muted">${esc(e.by_name || '')} · ${esc(e.client_name)} · ${fdate(e.date)}${e.reimburse ? ` · <b>${t('pide reembolso')}</b>` : ''}</div></div>
        <div class="row">${e.file_id ? `<a class="btn sm" href="/files/${e.file_id}" target="_blank">📷</a>` : ''}<a class="btn sm" href="#/obra/${e.job_id}/gastos">${t('Abrir')}</a><button class="sm primary" data-ok>✓ ${t('Está bien')}</button></div></div>`).join('')}`;
    $$('.rev-row', c).forEach(el => { $('[data-ok]', el).onclick = async () => { await act(() => api('POST', `/api/expenses/${el.dataset.id}/reviewed`), t('Revisado')); draw(rows.filter(x => String(x.id) !== el.dataset.id)); }; });
  };
  draw(list); putTop(app, c);
}
function mfaNagCard(app) {
  if (!ME || ME.mfa || ME.isPm) return;
  const c = document.createElement('a'); c.className = 'card row between mfa-nag'; c.href = '#/cuenta';
  c.innerHTML = `<span>🔐 <b>${t('Proteja su cuenta de dueño')}</b> · ${t('Active la entrada en 2 pasos: así nadie autoriza dinero con su nombre aunque sepa su contraseña.')}</span><span class="btn sm primary">${t('Activar')}</span>`;
  putTop(app, c);
}
async function securityCard(box) {
  const r = await api('GET', '/api/security');
  box.className = 'card';
  box.innerHTML = `<h2>🛡️ ${t('Seguridad de la compañía')}</h2>
    <p class="small muted">${t('Si está encendido, nadie puede autorizar dinero sin su código de 6 dígitos. Para apagarlo hace falta el otro dueño.')}</p>
    <ul class="plain">${r.owners.map(o => `<li>${o.mfa ? '✅' : '⚠️'} ${esc(o.name)} · ${o.mfa ? t('Activada') : t('No activada')}</li>`).join('')}</ul>
    <label class="check"><input type="checkbox" id="mfareq" ${r.mfa_required ? 'checked' : ''}> <span>${t('Exigir el código de 6 dígitos para autorizar dinero')}</span></label>`;
  $('#mfareq', box).onchange = async e => { try { const x = await api('PUT', '/api/security', { mfa_required: e.target.checked }); if (!x.pending) toast(t('Guardado')); } catch (err) { toast(err.message, true); } securityCard(box); };
}

// ===================== v2.29 — Webhooks y cierre de mes =====================
async function hooksCard(app) {
  const r = await api('GET', '/api/webhooks');
  const L = LANG === 'en' ? 'en' : 'es';
  const c = document.createElement('div'); c.className = 'card';
  const evName = k => k === '*' ? t('Todos') : ((r.events.find(e => e.key === k) || {})[L] || k);
  c.innerHTML = `<div class="row between wrap"><h2>🔌 ${t('Conexiones con otros sistemas (webhooks)')}</h2><button id="wh_add">${t('+ Conexión')}</button></div>
    <p class="small muted">${t('La app le avisa sola a otro sistema (su agente Grok, Zapier, Google Sheets…) cuando pasa algo: un gasto, una inspección, un pago, un caso. Cada aviso va firmado con una clave secreta.')}</p>
    ${r.hooks.length ? `<div class="doc-list">${r.hooks.map(h => `<div class="doc-row" data-id="${h.id}"><span class="doc-ic">${h.active ? '🔌' : '⏸️'}</span><div class="doc-main"><b>${esc(h.name)}</b> ${h.last_at ? (h.last_code >= 200 && h.last_code < 300 ? `<span class="badge b-hecho">${t('Funciona')}</span>` : `<span class="badge b-late">${t('Falló')} (${h.last_code || '—'})</span>`) : `<span class="badge">${t('Sin avisos todavía')}</span>`}
      <div class="small muted">${esc(h.url)}</div><div class="small">${h.events.map(evName).map(esc).join(' · ')}</div></div>
      <div class="row"><button class="sm" data-test>${t('Probar')}</button><button class="sm" data-tog>${h.active ? t('Pausar') : t('Prender')}</button><button class="sm" data-key>🔑</button><button class="sm danger" data-del>✕</button></div></div>`).join('')}</div>` : `<p class="empty small">${t('Sin conexiones.')}</p>`}`;
  app.appendChild(c);
  const reload = () => { c.remove(); hooksCard(app); };
  const showSecret = s => formDialog({ title: t('Clave secreta'), submit: t('Listo'), intro: t('Guárdela en el otro sistema: solo se enseña ahora. Cada aviso trae el encabezado X-EE-Signature = sha256=HMAC(clave, cuerpo) para comprobar que viene de la app.'), fields: [{ name: 's', label: t('Clave'), value: s }], onSubmit: () => {} });
  $('#wh_add', c).onclick = async () => { let made = null;
    if (await formDialog({ title: t('Nueva conexión'), fields: [{ name: 'name', label: t('Nombre'), value: 'Grok' }, { name: 'url', label: t('Dirección (https)'), required: true, hint: 'https://…' },
      { name: 'events', label: t('Qué avisos manda'), type: 'checks', value: ['*'], options: [['*', t('Todos')], ...r.events.map(e => [e.key, e[L]])] }],
      onSubmit: async v => { made = await api('POST', '/api/webhooks', { ...v, events: v.events && v.events.length ? v.events : ['*'] }); } })) { await showSecret(made.secret); reload(); } };
  $$('.doc-row', c).forEach(el => { const id = el.dataset.id, h = r.hooks.find(x => x.id === Number(id));
    $('[data-test]', el).onclick = async () => { const x = await api('POST', `/api/webhooks/${id}/test`); toast(x.ok ? t('Contestó bien ({n})', { n: x.code }) : t('No contestó ({n})', { n: x.code || x.error }), !x.ok); reload(); };
    $('[data-tog]', el).onclick = () => act(() => api('PUT', `/api/webhooks/${id}`, { active: !h.active }), t('Guardado')).then(reload);
    $('[data-key]', el).onclick = async () => { if (await confirmDialog(t('¿Hacer una clave nueva? La anterior deja de servir.'))) { const x = await api('POST', `/api/webhooks/${id}/secret`); await showSecret(x.secret); } };
    $('[data-del]', el).onclick = async () => { if (await confirmDialog(t('¿Borrar la conexión {x}?', { x: h.name }))) act(() => api('DELETE', `/api/webhooks/${id}`), t('Borrado')).then(reload); }; });
}
// Cierre de mes: revisar, bajar el paquete para la contadora y cerrar.
async function monthCloseCard(box, m) {
  const prev = () => { const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
  m = m || monthCloseCard.m || prev();
  const r = await api('GET', `/api/month-close?month=${m}`);
  const L = LANG === 'en' ? 'en' : 'es';
  box.className = 'card';
  box.innerHTML = `<div class="row between wrap"><h2>📦 ${t('Cierre de mes')}</h2><input type="month" id="mc_m" value="${m}" max="${today().slice(0, 7)}" style="width:auto"></div>
    <p class="small muted">${t('Antes de mandarle el mes a la contadora: revise lo que falta, baje el paquete (todos los archivos y las fotos de los tickets) y ciérrelo para que nadie cambie nada de ese mes.')}</p>
    <div class="mc-checks">${r.checks.map(c => `<a class="mc-check ${c.n ? 'bad' : 'ok'}" href="${c.link}">${c.n ? '⚠️' : '✅'} ${esc(c[L])}: <b>${c.n}</b></a>`).join('')}</div>
    <div class="row small" style="margin:.5rem 0">${t('Gastos de obra')}: <b>${fmt0(r.totals.job_expenses_cents)}</b> · ${t('Gasto general')}: <b>${fmt0(r.totals.company_expenses_cents)}</b> · ${t('Pagos de clientes')}: <b>${fmt0(r.totals.client_payments_cents)}</b> · ${t('{n} tickets', { n: r.totals.receipts })}</div>
    <div class="row wrap"><a class="btn primary" href="/api/month-close/zip?month=${m}" download>⬇ ${t('Paquete del mes (.zip)')}</a>
      ${r.closed ? `<span class="badge b-hecho">🔒 ${t('Mes cerrado (hasta el {d})', { d: fdate(r.lock_date) })}</span>` : r.can_close ? `<button id="mc_close">🔒 ${t('Cerrar el mes')}</button>` : `<span class="small muted">${t('Lo cierra un dueño.')}</span>`}</div>`;
  $('#mc_m', box).onchange = e => { monthCloseCard.m = e.target.value; monthCloseCard(box, e.target.value); };
  const cl = $('#mc_close', box); if (cl) cl.onclick = async () => {
    if (!await confirmDialog(t('¿Cerrar {m}? Ya nadie podrá agregar, cambiar ni borrar gastos, pagos o tickets de ese mes ni de antes. Para reabrirlo hace falta el otro dueño.', { m }), t('Cerrar el mes'))) return;
    act(() => api('PUT', '/api/lock', { date: r.to }), t('Mes cerrado')).then(() => monthCloseCard(box, m));
  };
}
async function viewMonthClose(app) {
  app.innerHTML = `<h1>${t('Cierre de mes')}</h1><div></div>`;
  await monthCloseCard(app.lastElementChild);
}

// ===================== v2.30 — Inventario de herramienta y equipo =====================
const TOOL_CAT = () => ({ electrica: t('Herramienta eléctrica'), manual: t('Herramienta de mano'), equipo: t('Equipo y maquinaria'), vehiculo: t('Vehículo o trailer'), escalera: t('Escaleras y andamios'), medicion: t('Medición y láser'), seguridad: t('Seguridad'), otro: t('Otro') });
const TOOL_LOC = () => ({ bodega: '🏠 ' + t('Bodega'), obra: '🏗️ ' + t('En obra'), reparacion: '🔧 ' + t('En reparación'), baja: '🗑️ ' + t('Dada de baja') });
const TOOL_ST = () => ({ bien: ['b-hecho', t('Bien')], reparar: ['b-urg', t('Necesita reparación')], perdida: ['b-late', t('No aparece')] });
async function viewInventory(app) {
  const r = await api('GET', '/api/inventory');
  const f = viewInventory.f || { loc: '', cat: '', q: '' };
  const S = r.summary;
  const match = x => (!f.loc ? x.location !== 'baja' : x.location === f.loc) && (!f.cat || x.category === f.cat) && (!f.q || `${x.tag} ${x.name} ${x.brand} ${x.model} ${x.serial} ${x.job_name}`.toLowerCase().includes(f.q.toLowerCase()));
  const rows = r.tools.filter(match);
  const ago = s => { if (!s) return t('nunca'); const d = Math.floor((Date.now() - Date.parse(s.replace(' ', 'T') + 'Z')) / 864e5); return d <= 0 ? t('hoy') : d === 1 ? t('ayer') : t('hace {n} días', { n: d }); };
  app.innerHTML = `<div class="row between wrap"><h1>🧰 ${t('Inventario')}</h1>${r.can_manage ? `<button class="primary" id="iv_add">${t('+ Agregar')}</button>` : ''}</div>
    <div class="okpis">
      <div class="card okpi"><div class="small muted">${t('Herramienta y equipo')}</div><div class="big">${S.items}</div>${r.sees_cost ? `<div class="small muted">${t('Valor de compra')}: ${fmt0(S.value_cents)}</div>` : ''}</div>
      <div class="card okpi"><div class="small muted">${t('En la bodega / en obras')}</div><div class="big">${S.at_bodega} / ${S.at_jobs}</div></div>
      <div class="card okpi"><div class="small muted">${t('Por reparar o sin aparecer')}</div><div class="big">${S.repair + S.lost}</div>${S.warranty_soon ? `<div class="small muted">${t('{n} garantías por vencer', { n: S.warranty_soon })}</div>` : ''}</div></div>
    ${r.pending_expenses.length ? `<div class="card notices"><h2>🧾 ${t('Compras de herramienta sin pasar al inventario')}</h2>${r.pending_expenses.map(e => `<div class="notice small row between"><span>${fdate(e.date)} · <b>${esc(e.description)}</b>${e.vendor ? ' · ' + esc(e.vendor) : ''} · ${fmt(e.amount_cents)}</span><button class="sm" data-pass="${e.id}">${t('Pasar al inventario')}</button></div>`).join('')}</div>` : ''}
    <div class="card"><div class="fields" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
      <div class="field"><label>${t('Dónde')}</label><select id="iv_loc"><option value="">${t('Todo lo que tenemos')}</option>${Object.entries(TOOL_LOC()).map(([k, l]) => `<option value="${k}" ${f.loc === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>${t('Tipo')}</label><select id="iv_cat"><option value="">${t('Todos')}</option>${Object.entries(TOOL_CAT()).map(([k, l]) => `<option value="${k}" ${f.cat === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('Buscar')}</label><input id="iv_q" value="${esc(f.q)}" placeholder="${esc(t('Etiqueta, nombre, marca, serie, obra…'))}"></div></div>
      ${rows.length ? `<div class="doc-list">${rows.map(x => { const [sc, sl] = TOOL_ST()[x.state] || ['', x.state]; return `<div class="doc-row tool" data-id="${x.id}">
        ${x.has_photo ? `<span class="thumb"><img src="/api/inventory/${x.id}/photo" data-view-src="/api/inventory/${x.id}/photo" alt="" loading="lazy"></span>` : `<span class="doc-ic">🧰</span>`}
        <div class="doc-main"><b><span class="code">${x.tag}</span> ${esc(x.name)}</b> <span class="badge ${sc}">${esc(sl)}</span>${x.warranty_state === 'por_vencer' ? ` <span class="badge b-urg">${t('Garantía vence {d}', { d: fdate(x.warranty_until) })}</span>` : ''}
          <div class="small muted">${esc([TOOL_CAT()[x.category], x.brand, x.model].filter(Boolean).join(' · '))}${x.serial ? ' · S/N ' + esc(x.serial) : ''}${r.sees_cost && x.cost_cents ? ' · ' + fmt(x.cost_cents) : ''}</div>
          <div class="small">${TOOL_LOC()[x.location]}${x.location === 'obra' ? ': <b>' + esc(x.job_name) + '</b>' : ''} · ${t('vista {x}', { x: ago(x.last_seen_at) })}</div></div>
        <div class="row">${x.location !== 'baja' ? `<button class="sm primary" data-mv>↔ ${t('Mover')}</button><button class="sm" data-seen title="${esc(t('La vi: sigue donde dice'))}">👁 ${t('La vi')}</button>` : ''}<button class="sm" data-hist>🕓</button>${r.can_manage ? '<button class="sm" data-ed>✎</button>' : ''}</div></div>`; }).join('')}</div>`
        : `<p class="empty">${r.tools.length ? t('Nada con esos filtros.') : t('Todavía no hay nada en el inventario. Agregue la herramienta y el equipo de la compañía.')}</p>`}</div>`;
  const upd = () => { viewInventory.f = { loc: $('#iv_loc').value, cat: $('#iv_cat').value, q: $('#iv_q').value }; viewInventory(app); };
  $('#iv_loc').onchange = upd; $('#iv_cat').onchange = upd; $('#iv_q').onchange = upd;
  const fields = (x = {}, pre = {}) => [
    { name: 'name', label: t('Qué es'), required: true, value: x.name || pre.name || '', hint: t('Ej. Sierra circular, Escalera de 8 ft, Láser de nivel') },
    { name: 'category', label: t('Tipo'), type: 'select', value: x.category || 'electrica', options: Object.entries(TOOL_CAT()) },
    { name: 'brand', label: t('Marca'), value: x.brand || '' }, { name: 'model', label: t('Modelo'), value: x.model || '' }, { name: 'serial', label: t('Número de serie'), value: x.serial || '' },
    ...(x.id ? [] : [{ name: 'qty', label: t('Cuántas'), type: 'number', value: '1', hint: t('Si compró varias iguales, cada una lleva su etiqueta') }]),
    { name: 'purchase_date', label: t('Fecha de compra'), type: 'date', value: x.purchase_date || pre.date || '' }, { name: 'cost_cents', label: t('Costo ($)'), type: 'money', value: x.cost_cents ? centsToInput(x.cost_cents) : pre.amount_cents ? centsToInput(pre.amount_cents) : '' },
    { name: 'vendor', label: t('Dónde se compró'), value: x.vendor || pre.vendor || '' }, { name: 'warranty_until', label: t('Garantía hasta'), type: 'date', value: x.warranty_until || '' },
    ...(x.id ? [{ name: 'state', label: t('Estado'), type: 'select', value: x.state, options: Object.entries(TOOL_ST()).map(([k, [, l]]) => [k, l]) }] : [{ name: 'location', label: t('Dónde queda'), type: 'select', value: 'bodega', options: [['bodega', TOOL_LOC().bodega], ...r.jobs.map(j => ['obra:' + j.id, '🏗️ ' + j.client_name])] }]),
    { name: 'photo', label: t('Foto'), type: 'photo' }, { name: 'file', label: t('Ticket o garantía (PDF o foto)'), type: 'doc' }, { name: 'notes', label: t('Notas'), type: 'textarea', value: x.notes || '' }];
  const clean = v => { const o = { ...v }; ['photo', 'file'].forEach(k => { if (!o[k]) delete o[k]; }); if (o.location && o.location.startsWith('obra:')) { o.job_id = Number(o.location.slice(5)); o.location = 'obra'; } return o; };
  const addDlg = async (pre = {}) => { if (await formDialog({ title: pre.id ? t('Pasar al inventario') : t('Agregar al inventario'), fields: fields({}, pre), onSubmit: async v => { const x = await api('POST', '/api/inventory', { ...clean(v), ...(pre.id ? { company_expense_id: pre.id } : {}) }); toast(t('Listo: {x}', { x: x.tags.join(', ') })); } })) viewInventory(app); };
  if ($('#iv_add', app)) $('#iv_add', app).onclick = () => addDlg();
  $$('[data-pass]', app).forEach(b => { const e = r.pending_expenses.find(x => x.id === Number(b.dataset.pass)); b.onclick = () => addDlg({ id: e.id, name: e.description, vendor: e.vendor, date: e.date, amount_cents: e.amount_cents }); });
  $$('.tool', app).forEach(el => { const x = r.tools.find(y => y.id === Number(el.dataset.id));
    const mv = $('[data-mv]', el); if (mv) mv.onclick = async () => {
      const opts = [['bodega', TOOL_LOC().bodega], ...r.jobs.map(j => ['obra:' + j.id, '🏗️ ' + j.client_name]), ...(ME.role !== 'pm' ? [['reparacion', TOOL_LOC().reparacion]] : []), ...(r.can_manage ? [['baja', TOOL_LOC().baja]] : [])];
      if (await formDialog({ title: t('Mover {x}', { x: x.tag + ' ' + x.name }), intro: t('La herramienta no se presta: queda en la bodega o en una obra.'), submit: t('Mover'),
        fields: [{ name: 'to', label: t('A dónde'), type: 'select', value: x.location === 'obra' ? 'bodega' : (r.jobs[0] ? 'obra:' + r.jobs[0].id : 'bodega'), options: opts }, { name: 'note', label: t('Nota (si se da de baja, por qué)'), value: '' }],
        onSubmit: v => api('POST', `/api/inventory/${x.id}/move`, v.to.startsWith('obra:') ? { location: 'obra', job_id: Number(v.to.slice(5)), note: v.note } : { location: v.to, note: v.note }) })) { toast(t('Movida')); viewInventory(app); } };
    const sn = $('[data-seen]', el); if (sn) sn.onclick = () => act(() => api('POST', `/api/inventory/${x.id}/seen`), t('Anotado')).then(() => viewInventory(app));
    $('[data-hist]', el).onclick = async () => { const h = await api('GET', `/api/inventory/${x.id}/history`); const where = (l, j) => (TOOL_LOC()[l] || l) + (l === 'obra' && j ? ': ' + j : '');
      await formDialog({ title: t('Historial de {x}', { x: x.tag }), submit: t('Cerrar'), intro: h.length ? h.map(m => `${fdate(String(m.at).slice(0, 10))} · ${m.from_loc === m.to_loc && m.from_job === m.to_job ? esc(m.note) : `${esc(where(m.from_loc, m.from_job_name))} → ${esc(where(m.to_loc, m.to_job_name))}${m.note ? ' (' + esc(m.note) + ')' : ''}`} · ${esc(m.by_name || '')}`).join('<br>') : t('Sin movimientos todavía.'), fields: [], onSubmit: () => {} }); };
    const ed = $('[data-ed]', el); if (ed) ed.onclick = async () => { if (await formDialog({ title: x.tag + ' ' + x.name, fields: fields(x),
      extraButton: ME.role === 'owner' && !ME.is_agent ? { label: '✕ ' + t('Borrar'), onClick: async () => { if (await confirmDialog(t('¿Borrar {x} del inventario? Si ya no sirve, mejor dela de baja para que quede el historial.', { x: x.tag }))) { await api('DELETE', `/api/inventory/${x.id}`); toast(t('Borrado')); viewInventory(app); } } } : null,
      onSubmit: v => api('PUT', `/api/inventory/${x.id}`, clean(v)) })) viewInventory(app); }; });
  $$('img[data-view-src]', app).forEach(i => { i.onclick = () => window.open(i.dataset.viewSrc, '_blank'); });
}
// En la obra: la herramienta de la compañía que está ahí.
async function jobToolsCard(box, jobId) {
  const list = await api('GET', `/api/jobs/${jobId}/tools`);
  if (!list.length && ME.role === 'worker') return;
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<h2>🧰 ${t('Herramienta de la compañía en esta obra')}</h2>${list.length ? list.map(x => `<div class="small tool-line"><span class="code">${x.tag}</span> ${esc(x.name)}${x.brand ? ' · ' + esc(x.brand) : ''}${x.state !== 'bien' ? ` <span class="badge b-urg">${esc((TOOL_ST()[x.state] || ['', x.state])[1])}</span>` : ''}</div>`).join('') : `<p class="small muted">${t('No hay herramienta de la compañía en esta obra.')}</p>`}
    ${ME.role !== 'worker' ? `<p class="small"><a href="#/inventario">${t('Ver inventario')}</a></p>` : `<p class="small muted">${t('Es de la compañía: se queda en la obra o regresa a la bodega. Si algo se rompe o no aparece, avísele al encargado.')}</p>`}`;
  box.appendChild(c);
}

// ===================== v2.33 — Categorías y listas que ajusta la compañía =====================
async function viewLists(app, which) {
  const data = await api('GET', '/api/lists');
  const cur = data.find(x => x.list === which) || data[0];
  const owner = ME.role === 'owner' && !ME.isPm;
  const HELP = {
    gasto: t('Para qué se gastó en una obra (material, renta de equipo, basura…).'),
    empresa: t('Gastos de la compañía que no son de una obra: diésel, llantas de la traila, landfill, mantenimiento de camionetas…'),
    pago: t('Cómo se pagó un ticket: tarjeta, cheque, Zelle…'),
    pagosub: t('Cómo se le paga a un sub: Zelle, cheque, depósito directo…'),
    trade: t('Oficios: ordenan tareas, fotos y materiales, y dicen qué hace cada sub.'),
  };
  app.innerHTML = `<h1>🏷️ ${t('Categorías y listas')}</h1>
    <p class="muted">${t('Agregue, cambie el nombre o esconda lo que no usan. Nada se borra: lo que ya tiene gastos conserva su nombre.')}</p>
    <div class="seg lists-seg">${data.map(x => `<a class="btn ${x.list === cur.list ? 'on' : ''}" href="#/listas/${x.list}">${esc(t(x.name))}</a>`).join('')}</div>
    <div class="card"><div class="row between"><div><h2 style="margin:0">${esc(t(cur.name))}</h2><p class="small muted" style="margin:.2rem 0 0">${HELP[cur.list]}</p></div>
      ${owner ? `<button class="primary" id="addli">+ ${t('Agregar')}</button>` : ''}</div>
      <div class="li-rows">${cur.items.map(x => `<div class="li-row ${x.hidden ? 'off' : ''}" data-k="${esc(x.key)}">
        <div class="li-name"><b>${esc(LANG === 'en' ? x.en : x.es)}</b><span class="small muted">${esc(LANG === 'en' ? x.es : x.en)}</span></div>
        <div class="li-tags">${x.custom ? `<span class="badge b-en_progreso">${t('Agregada')}</span>` : ''}${x.hidden ? `<span class="badge b-pendiente">${t('Escondida')}</span>` : ''}${x.locked ? `<span class="small muted" title="${esc(t('La app la necesita: se puede cambiar el nombre, pero no esconder.'))}">🔒</span>` : ''}
          ${x.used ? `<span class="small muted">${x.used === 1 ? t('Usada 1 vez') : t('Usada {n} veces', { n: x.used })}</span>` : ''}</div>
        ${owner ? `<div class="row"><button class="sm" data-ed>${t('Cambiar nombre')}</button>${x.locked ? '' : `<button class="sm" data-hide>${x.hidden ? t('Mostrar') : t('Esconder')}</button>`}</div>` : ''}</div>`).join('')}</div>
      ${owner ? '' : `<p class="small muted">${t('Solo los dueños cambian estas listas.')}</p>`}</div>`;
  const reload = async () => { CAT = await api('GET', '/api/catalog'); viewLists(app, cur.list); };
  const ask = (title, x) => formDialog({ title, fields: [
    { name: 'es', label: t('Nombre en español'), value: x ? x.es : '', required: true },
    { name: 'en', label: t('Nombre en inglés (si lo deja vacío, se usa el de español)'), value: x ? x.en : '' }] });
  if ($('#addli', app)) $('#addli', app).onclick = async () => { const v = await ask(t('Agregar a {x}', { x: t(cur.name) })); if (!v) return; await act(() => api('POST', `/api/lists/${cur.list}`, v), t('Agregada')); reload(); };
  $$('.li-row', app).forEach(el => {
    const x = cur.items.find(i => i.key === el.dataset.k);
    const ed = $('[data-ed]', el), hd = $('[data-hide]', el);
    if (ed) ed.onclick = async () => { const v = await ask(t('Cambiar nombre'), x); if (!v) return; await act(() => api('PUT', `/api/lists/${cur.list}/${encodeURIComponent(x.key)}`, v), t('Guardado')); reload(); };
    if (hd) hd.onclick = async () => { await act(() => api('PUT', `/api/lists/${cur.list}/${encodeURIComponent(x.key)}`, { hidden: !x.hidden }), x.hidden ? t('Visible otra vez') : t('Escondida')); reload(); };
  });
}

// ===================== v2.35 — Selecciones del cliente =====================
// Lo que el cliente tiene que escoger antes de que se necesite. Fecha límite = tarea que lo necesita − días para pedirlo.
const optSw = o => swatch({ image: o.image, color_hex: o.hex, name: o.title, color_name: o.color });
const selLabel = s => (LANG === 'en' ? s.label_en || s.label : s.label);
function selDue(s) {
  if (s.status === 'aprobado') return '';
  if (!s.need_by) return `<span class="small muted">${t('Sin fecha todavía (la tarea no tiene fecha)')}</span>`;
  const d = s.days_left;
  const txt = d < 0 ? t('Atrasada {n} día(s)', { n: -d }) : d === 0 ? t('Hoy es el último día') : t('Escoger antes del {d} (faltan {n} día(s))', { d: fdate(s.need_by), n: d });
  return `<span class="small ${d < 0 ? 'neg' : d <= 3 ? 'warnt' : 'muted'}">${d < 0 ? '⛔' : d <= 3 ? '⏰' : '📅'} ${txt}</span>`;
}
function selBadge(s) {
  if (s.status === 'aprobado') return `<span class="badge b-hecho">✓ ${t('Aprobado')}</span>`;
  if (s.status === 'escogido') return `<span class="badge b-en_progreso">${t('Escogido · falta aprobar')}</span>`;
  return `<span class="badge ${s.late ? 'b-late' : 'b-pendiente'}">${t('Falta escoger')}</span>`;
}
const HOW = () => ({ portal: t('en su portal'), 'en persona': t('en persona'), 'por texto': t('por texto'), 'por correo': t('por correo'), 'por teléfono': t('por teléfono') });

async function selectionsCard(box, jobId, d) {
  const r = await api('GET', `/api/jobs/${jobId}/selections`);
  const c = document.createElement('div'); c.className = 'card selcard'; box.prepend(c);
  const draw = r2 => {
    const list = r2.selections;
    const open = list.filter(s => s.status !== 'aprobado').sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999));
    const done = list.filter(s => s.status === 'aprobado');
    const row = s => `<div class="selrow ${s.late ? 'late' : ''}" data-sid="${s.id}">
      <div class="row between wrap"><div><b>${esc(selLabel(s))}</b> ${selBadge(s)}${s.changed_after_approval && s.status !== 'aprobado' ? ` <span class="badge b-late">${t('Cambió algo aprobado')}</span>` : ''}</div>${selDue(s)}</div>
      ${s.task ? `<div class="small muted">${t('Se necesita para')}: ${esc(taskTitle(s.task.title))}${s.task.planned_date ? ' · ' + fdate(s.task.planned_date) : ''}${s.blocks ? ` · <b class="neg">${t('detiene esta tarea')}</b>` : ''}</div>` : ''}
      ${s.options.length ? `<div class="selopts">${s.options.map(o => `<div class="selopt ${s.choice_option_id === o.id ? 'on' : ''}" data-oid="${o.id}">${optSw(o)}<div><b>${esc(o.title)}</b>${o.color ? `<div class="small muted">${esc(o.color)}</div>` : ''}${o.note ? `<div class="small">${esc(o.note)}</div>` : ''}</div>${s.status !== 'aprobado' ? `<button class="sm ghost" data-rmo="${o.id}" title="${esc(t('Quitar'))}">✕</button>` : ''}</div>`).join('')}</div>` : ''}
      ${s.choice_text && !s.choice_option_id ? `<div class="selchoice">✍️ ${t('El cliente escogió')}: <b>${esc(s.choice_text)}</b></div>` : ''}
      ${s.client_note ? `<div class="small">💬 ${esc(s.client_note)}</div>` : ''}
      ${s.status === 'aprobado' ? `<div class="small muted">✓ ${t('Aprobado por {n} {how} · {d}', { n: esc(s.approved_name), how: HOW()[s.approved_how] || esc(s.approved_how), d: fdate(String(s.approved_at).slice(0, 10)) })}</div>` : ''}
      <div class="row wrap selbtns">${s.status !== 'aprobado' ? `<button class="sm" data-opt>+ ${t('Opción')}</button><button class="sm" data-note>✍️ ${t('Anotar lo que escogió')}</button>${s.status === 'escogido' ? `<button class="sm primary" data-ok>✓ ${t('Marcar aprobado')}</button>` : ''}` : ''}<button class="sm ghost" data-ed>${t('Editar')}</button><button class="sm ghost" data-del>✕</button></div></div>`;
    c.innerHTML = `<div class="row between wrap"><h2 style="margin:0">🎨 ${t('Selecciones del cliente')}</h2><div class="row">${r2.suggest.length ? `<button class="sm" id="selauto">✨ ${t('Armar las de esta obra ({n})', { n: r2.suggest.length })}</button>` : ''}<button class="sm primary" id="seladd">+ ${t('Selección')}</button></div></div>
      <p class="small muted">${t('Lo que el cliente tiene que escoger. Le damos opciones o él escoge por su cuenta, y lo aprueba en su portal. Le llegan recordatorios y ustedes reciben aviso si se atrasa. Al aprobarse, el material pasa a la ficha.')}</p>
      ${list.length ? '' : `<p class="empty">${r2.suggest.length ? t('Toque "Armar las de esta obra" para empezar con lo que normalmente se escoge: {x}.', { x: r2.suggest.map(x => esc(zoneName(x.zone))).join(', ') }) : t('Agregue lo que el cliente tiene que escoger.')}</p>`}
      ${open.map(row).join('')}
      ${done.length ? `<details class="more"><summary>✓ ${t('Ya aprobado')} (${done.length})</summary>${done.map(row).join('')}</details>` : ''}`;
    const reload = async () => draw(await api('GET', `/api/jobs/${jobId}/selections`));
    const tasks = r2.tasks || [];
    const edit = async s => {
      if (!MAT_ZONES) MAT_ZONES = (await api('GET', '/api/materials?q=%23none%23')).zones;
      const v = await formDialog({ title: s ? t('Editar selección') : t('Nueva selección'), fields: [
        { name: 'zone', label: t('Zona'), type: 'select', value: s ? s.zone : 'pintura', options: MAT_ZONES.map(z => [z.key, L(z)]) },
        { name: 'label', label: t('Nombre (opcional, ej.: Stain del cedro)'), value: s ? s.label : '' },
        { name: 'label_en', label: t('Nombre en inglés (opcional)'), value: s ? s.label_en : '' },
        { name: 'task_id', label: t('Se necesita para la tarea'), type: 'select', value: s && s.task ? s.task.id : '', options: [['', t('— la app la busca sola —')], ...tasks.filter(x => x.status !== 'hecho' || (s && s.task && s.task.id === x.id)).map(x => [x.id, taskTitle(x.title) + (x.planned_date ? ' · ' + fdate(x.planned_date) : '')])] },
        { name: 'lead_days', label: t('Días antes para pedirlo'), value: s ? s.lead_days : 7 },
        { name: 'need_by', label: t('O una fecha límite fija (opcional)'), type: 'date', value: s ? s.need_by_manual : '' },
        { name: 'notes', label: t('Nota interna'), type: 'textarea', value: s ? s.notes : '' }] });
      if (!v) return;
      await act(() => (s ? api('PUT', `/api/selections/${s.id}`, v) : api('POST', `/api/jobs/${jobId}/selections`, v)), t('Guardado')); reload();
    };
    $('#seladd', c).onclick = () => edit(null);
    if ($('#selauto', c)) $('#selauto', c).onclick = async () => { const x = await act(() => api('POST', `/api/jobs/${jobId}/selections/auto`), t('Listo')); if (x) draw({ ...r2, selections: x.selections, suggest: [] }); };
    $$('.selrow', c).forEach(el => {
      const s = list.find(x => String(x.id) === el.dataset.sid);
      const b = sel => $(sel, el);
      if (b('[data-ed]')) b('[data-ed]').onclick = () => edit(s);
      if (b('[data-del]')) b('[data-del]').onclick = async () => { if (!confirm(t('¿Quitar esta selección?'))) return; await act(() => api('DELETE', `/api/selections/${s.id}`), t('Quitada')); reload(); };
      $$('[data-rmo]', el).forEach(x => { x.onclick = async () => { await act(() => api('DELETE', `/api/selection-options/${x.dataset.rmo}`), t('Quitada')); reload(); }; });
      if (b('[data-opt]')) b('[data-opt]').onclick = async () => {
        const m = await api('GET', `/api/materials?zone=${encodeURIComponent(s.zone)}`); MAT_ZONES = m.zones;
        const all = m.materials.length ? m.materials : (await api('GET', '/api/materials')).materials;
        const v = await formDialog({ title: t('Opción para {x}', { x: selLabel(s) }), fields: [
          { name: 'material_id', label: t('Del catálogo de materiales (con foto)'), type: 'select', value: '', options: [['', t('— o escriba la opción abajo —')], ...all.map(x => [x.id, [x.brand, x.name, x.color_name].filter(Boolean).join(' · ')])] },
          { name: 'title', label: t('Opción (si no está en el catálogo)'), value: '' },
          { name: 'note', label: t('Nota para el cliente (opcional, ej.: precio extra, tiempo de entrega)'), value: '' }] });
        if (!v) return; await act(() => api('POST', `/api/selections/${s.id}/options`, v), t('Agregada')); reload();
      };
      if (b('[data-note]')) b('[data-note]').onclick = async () => {
        const v = await formDialog({ title: t('Lo que escogió el cliente'), fields: [
          ...(s.options.length ? [{ name: 'option_id', label: t('Una de las opciones'), type: 'select', value: s.choice_option_id || '', options: [['', '—'], ...s.options.map(o => [o.id, o.title])] }] : []),
          { name: 'text', label: t('O escriba lo que escogió (marca, color, modelo)'), value: s.choice_text || '' }] });
        if (!v) return; await act(() => api('POST', `/api/selections/${s.id}/choose`, v.option_id ? { option_id: v.option_id } : { text: v.text }), t('Anotado')); reload();
      };
      if (b('[data-ok]')) b('[data-ok]').onclick = async () => {
        const v = await formDialog({ title: t('¿Cómo lo aprobó el cliente?'), fields: [
          { name: 'how', label: t('Lo aprobó'), type: 'select', value: 'en persona', options: ['en persona', 'por texto', 'por correo', 'por teléfono'].map(k => [k, HOW()[k]]) },
          { name: 'note', label: t('Quién / detalle (opcional)'), value: '' }] });
        if (!v) return; await act(() => api('POST', `/api/selections/${s.id}/approve`, v), t('Aprobado')); reload();
      };
    });
  };
  draw(r);
}

// Portal del cliente: qué le falta escoger, con fotos; aprueba con un toque.
async function clientSelectionsCard(app, j) {
  let r; try { r = await api('GET', `/api/jobs/${j.id}/selections`); } catch { return; }
  if (!r.selections.length) return;
  const c = document.createElement('div'); c.className = 'card selcard client';
  const hero = app.querySelector('.portal .hero'); if (hero) hero.after(c); else app.appendChild(c);
  const draw = list => {
    const open = list.filter(s => s.status !== 'aprobado').sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999));
    const done = list.filter(s => s.status === 'aprobado');
    c.innerHTML = `<h2>🎨 ${open.length ? t('Lo que falta escoger') : t('Sus selecciones')} ${open.length ? `<span class="badge b-late">${open.length}</span>` : ''}</h2>
      ${open.length ? `<p class="small muted">${t('Para pedir los materiales a tiempo y no atrasar su proyecto, escoja antes de la fecha de cada uno.')}</p>` : `<p class="small muted">${t('Todo aprobado. ¡Gracias!')}</p>`}
      ${open.map(s => `<div class="selrow ${s.late ? 'late' : ''}" data-sid="${s.id}">
        <div class="row between wrap"><b class="big">${esc(selLabel(s))}</b>${selDue(s)}</div>
        ${s.options.length ? `<p class="small muted">${t('Toque la que quiere:')}</p><div class="selopts big">${s.options.map(o => `<button type="button" class="selopt pick ${s.choice_option_id === o.id ? 'on' : ''}" data-pick="${o.id}">${optSw(o)}<div><b>${esc(o.title)}</b>${o.color ? `<div class="small muted">${esc(o.color)}</div>` : ''}${o.note ? `<div class="small">${esc(o.note)}</div>` : ''}</div></button>`).join('')}</div>` : ''}
        ${s.status === 'escogido' && s.choice_text && !s.choice_option_id ? `<div class="selchoice">${t('Usted escogió')}: <b>${esc(s.choice_text)}</b></div><div class="row"><button class="primary" data-approve>✓ ${t('Apruebo')}</button><button class="sm ghost" data-write>${t('Cambiar')}</button></div>`
          : `<div class="row"><button class="sm ${s.options.length ? 'ghost' : 'primary'}" data-write>✍️ ${s.options.length ? t('Quiero otra cosa') : t('Escribir lo que quiero')}</button></div>`}</div>`).join('')}
      ${done.length ? `<details class="more" ${open.length ? '' : 'open'}><summary>✓ ${t('Ya aprobado')} (${done.length})</summary>${done.map(s => `<div class="selrow" data-sid="${s.id}"><div class="row between wrap"><span><b>${esc(selLabel(s))}</b>: ${esc(s.choice_text || '')}</span><button class="sm ghost" data-change>${t('Quiero cambiarlo')}</button></div><div class="small muted">✓ ${t('Aprobado el {d}', { d: fdate(String(s.approved_at).slice(0, 10)) })}</div></div>`).join('')}</details>` : ''}`;
    const reload = async () => draw((await api('GET', `/api/jobs/${j.id}/selections`)).selections);
    $$('.selrow', c).forEach(el => {
      const s = list.find(x => String(x.id) === el.dataset.sid);
      $$('[data-pick]', el).forEach(b => { b.onclick = async () => {
        const o = s.options.find(x => String(x.id) === b.dataset.pick);
        if (!confirm(t('¿Aprueba "{o}" para {s}? Con esto lo pedimos.', { o: o.title, s: selLabel(s) }))) return;
        await act(() => api('POST', `/api/selections/${s.id}/approve`, { option_id: o.id }), t('¡Gracias! Quedó aprobado.')); reload();
      }; });
      const write = async (title) => {
        const v = await formDialog({ title, fields: [{ name: 'text', label: t('Qué quiere (marca, color, modelo o enlace)'), value: s.choice_text || '', required: true }, { name: 'note', label: t('Comentario (opcional)'), value: '' }] });
        if (!v) return null; return act(() => api('POST', `/api/selections/${s.id}/choose`, v), t('Recibido'));
      };
      if ($('[data-write]', el)) $('[data-write]', el).onclick = async () => { if (await write(selLabel(s))) reload(); };
      if ($('[data-approve]', el)) $('[data-approve]', el).onclick = async () => { await act(() => api('POST', `/api/selections/${s.id}/approve`, {}), t('¡Gracias! Quedó aprobado.')); reload(); };
      if ($('[data-change]', el)) $('[data-change]', el).onclick = async () => {
        if (!confirm(t('Ya está aprobado y puede que ya lo hayamos pedido. Si lo cambia, le avisamos a la empresa y puede tener un costo extra. ¿Seguir?'))) return;
        if (await write(t('Cambiar {s}', { s: selLabel(s) }))) reload();
      };
    });
  };
  draw(r.selections);
}
