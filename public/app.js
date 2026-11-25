'use strict';
/* Elevated Exteriors — interfaz bilingüe (español / inglés). JavaScript simple, sin compilación.
   Todo texto visible pasa por t('texto en español'); la traducción al inglés está en i18n.js. */

// ================= idioma =================
let LANG = (() => { try { return localStorage.getItem('ee_lang') || ''; } catch { return ''; } })()
  || (/^es/i.test(navigator.language || '') ? 'es' : 'en');
function t(s, vars) {
  let out = LANG === 'en' ? (window.EN_DICT[s] ?? s) : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return coName(out);
}
// Los mensajes dicen el nombre de la empresa en la que se está trabajando (Elevated Exteriors o JKL Homes).
const coName = s => (typeof COMPANY !== 'undefined' && COMPANY.name !== 'Elevated Exteriors') ? s.replace(/Elevated Exteriors/g, COMPANY.name) : s;
const L = o => (o ? (o[LANG] || o.es || '') : '');   // elige la versión del catálogo en el idioma actual
async function setLang(l) {
  LANG = l === 'en' ? 'en' : 'es';
  try { localStorage.setItem('ee_lang', LANG); } catch { /* sin almacenamiento */ }
  document.documentElement.lang = LANG;
  if (ME) { ME.lang = LANG; try { await api('POST', '/api/me/lang', { lang: LANG }); } catch { /* se intenta la próxima vez */ } }
  renderNav();
  if (ME) route(); else boot();
}
const langButton = () => `<button class="sm lang" data-lang title="${LANG === 'en' ? 'Cambiar a español' : 'Switch to English'}">
  <b class="${LANG === 'es' ? 'on' : ''}">ES</b> | <b class="${LANG === 'en' ? 'on' : ''}">EN</b></button>`;
function bindLang(root = document) { $$('[data-lang]', root).forEach(b => { b.onclick = () => setLang(LANG === 'en' ? 'es' : 'en'); }); }

// ================= utilidades =================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Texto escrito por otra persona: se enseña traducido al idioma de quien lo lee, con "Ver original".
const LNAME = () => ({ es: t('español'), en: t('inglés') });
function trx(orig, tr, from, opts = {}) {
  if (!tr) return esc(orig);
  return `<span class="trx" data-a="${esc(tr)}" data-b="${esc(orig)}">${esc(tr)}</span>${opts.inline ? ' ' : '<br>'}<a href="#" class="tr-tog" data-from="${esc(from || '')}">🌐 ${esc(t('Traducido del {x}', { x: LNAME()[from] || from }))} · ${esc(t('Ver original'))}</a>`;
}
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('.tr-tog'); if (!a) return;
  e.preventDefault(); e.stopPropagation();
  const s = a.previousElementSibling && a.previousElementSibling.classList.contains('trx') ? a.previousElementSibling : a.parentElement.querySelector('.trx');
  if (!s) return;
  const showingOrig = s.dataset.showing === 'b';
  s.textContent = showingOrig ? s.dataset.a : s.dataset.b; s.dataset.showing = showingOrig ? 'a' : 'b';
  a.textContent = '🌐 ' + (showingOrig ? t('Traducido del {x}', { x: LNAME()[a.dataset.from] || a.dataset.from }) + ' · ' + t('Ver original') : t('Original') + ' · ' + t('Ver traducción'));
}, true);
const fmt = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = c => (c < 0 ? '-' : '') + '$' + Math.round(Math.abs(c || 0) / 100).toLocaleString('en-US');
const toCents = s => { const x = String(s ?? '').replace(/[$,\s]/g, ''); if (x === '') return 0; const n = Number(x); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const centsToInput = c => (c ? (c / 100).toFixed(2) : '');
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fdate = s => s ? new Date(s + 'T12:00:00').toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

let ME = null, CAT = null, TASK_EN = new Map(), TASK_ES = new Map();
const typeLabel = k => L(CAT.projectTypes.find(x => x.key === k)) || k;
const catLabel = k => L(CAT.categories.find(c => c.key === k)) || k;
// Categorías para escoger: "Mano de obra (horas)" solo si la compañía tiene gente por hora.
// Lo escondido en Listas no sale para escoger (salvo el valor que ya tiene ese registro).
const vis = (list, cur) => (list || []).filter(x => !x.hidden || x.key === cur);
const CATS = cur => vis(CAT.categories, cur).filter(c => c.key !== 'mano_obra' || MOD('horas'));
const statusLabel = k => L(CAT.jobStatus.find(s => s.key === k)) || k;
// Las tareas de plantilla se muestran en el idioma de quien las lee; las escritas a mano, tal cual.
const taskTitle = s => (LANG === 'en' ? TASK_EN.get(s) : TASK_ES.get(s)) || s;
const TASK_STATUS = () => ({ pendiente: t('Pendiente'), en_progreso: t('En progreso'), hecho: t('Hecho') });
const CO_STATUS = () => ({ pendiente: t('Pendiente'), aprobado: t('Aprobado'), rechazado: t('Rechazado') });
// Fase 4: estado de cobro de un change order aprobado, y categorías para su código.
const CO_STATE = () => ({ aprobado: [t('Sin facturar'), 'b-en_progreso'], facturado: [t('Facturado'), 'b-pendiente'], vencido: [t('Vencido'), 'b-late'], cobrado: [t('Cobrado'), 'b-hecho'] });
const CO_CATS = () => [['CO', t('General')], ['GAS', t('Gas')], ['ELEC', t('Eléctrico')], ['AV', t('Audio / video')], ['PLUMB', t('Plomería')], ['PERMIT', t('Permiso / ciudad')], ['CONC', t('Concreto')], ['FRAME', t('Estructura')], ['ROOF', t('Techo')], ['STONE', t('Piedra')], ['GRAN', t('Granito / cubierta')], ['PAINT', t('Pintura / stain')], ['LIGHT', t('Iluminación')], ['LAND', t('Paisajismo')], ['CREDIT', t('Crédito al cliente')]];
const ROLE = () => ({ owner: t('Dueño'), pm: t('Project manager'), sales: t('Vendedor'), worker: t('Trabajador / Sub'), client: t('Cliente'), admin: t('Administración'), accountant: t('Contadora (solo ver)') });
const OFFICE = () => !!ME && ['admin', 'accountant'].includes(ME.role);
// Herramientas extra que se pueden prender a cualquier persona además de su papel.
const TOOL_LABEL = () => ({ ventas: t('Ventas: agenda, citas y seguimiento de estimados') });
// Dueños y project managers manejan obras (el servidor limita al PM a sus obras y a sus límites).
const BOSS = () => !!ME && (ME.role === 'owner' || ME.role === 'pm');

let loading = 0;
function busy(on) { loading += on ? 1 : -1; document.body.classList.toggle('loading', loading > 0); }
async function api(method, url, body) {
  busy(true);
  let res;
  try {
    res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Lang': LANG }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new Error(t('Sin conexión. Revise su internet e intente de nuevo.')); } finally { busy(false); }
  let data = null; try { data = await res.json(); } catch { /* sin cuerpo */ }
  if (res.status === 401 && ME) { ME = null; location.hash = '#/'; boot(); }
  // Cambiar o borrar dinero pide el motivo: se pregunta y se vuelve a intentar.
  if (res.status === 428 && data && data.needReason) {
    const reason = await reasonDialog(data.summary);
    if (!reason) throw new Error(t('Cambio cancelado: no se guardó nada.'));
    return api(method, url, { ...(body || {}), reason });
  }
  // Autorizar dinero pide el código de 6 dígitos (verificación en dos pasos).
  if (res.status === 428 && data && data.needCode) {
    const code = await codeDialog();
    if (!code) throw new Error(t('Cancelado: no se autorizó nada.'));
    return api(method, url, { ...(body || {}), code });
  }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `Error ${res.status}`), { status: res.status, data });
  // El cambio quedó esperando al otro dueño: avisar claro y no decir "guardado".
  if (data && data.pending === true) {
    PENDING_UNTIL = Date.now() + 4000;
    toast('⏳ ' + (ME && ME.role === 'pm' ? t('Enviado a los dueños para que lo autoricen. No se aplica hasta que un dueño lo apruebe.') : t('Enviado al otro dueño para que lo autorice. No se aplica hasta que lo apruebe.')), false, true);
    if (ME) { ME.pending = ME.pending || 0; }
  }
  return data;
}
let PENDING_UNTIL = 0;
function codeDialog() {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.innerHTML = `<form novalidate><h2>🔐 ${t('Código para autorizar')}</h2>
      <p class="small muted">${t('Abra su app de códigos (Google Authenticator o Authy) y escriba los 6 números.')}</p>
      <div class="field full"><input name="c" inputmode="numeric" autocomplete="one-time-code" maxlength="8" style="font-size:1.6rem;letter-spacing:.3em;text-align:center"></div>
      <p class="error-msg" hidden></p><div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Autorizar')}</button></div></form>`;
    document.body.appendChild(d);
    const done = v => { d.close(); d.remove(); resolve(v); };
    $('[data-x]', d).onclick = () => done(null);
    d.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    $('form', d).onsubmit = e => { e.preventDefault(); const v = e.target.c.value.replace(/\s/g, ''); if (!/^\d{6}$/.test(v)) { const m = $('.error-msg', d); m.hidden = false; m.textContent = t('Son 6 números.'); return; } done(v); };
    d.showModal(); setTimeout(() => d.querySelector('input').focus(), 50);
  });
}
function reasonDialog(summary) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.innerHTML = `<form novalidate><h2>🔒 ${t('Motivo del cambio')}</h2>
      ${summary ? `<div class="compare small">${esc(summary)}</div>` : ''}
      <p class="small muted">${t('Para cambiar o borrar algo de dinero ya registrado hay que escribir el motivo. Queda en el historial con su nombre, la fecha y cómo estaba antes.')}</p>
      <div class="field full"><label>${t('Motivo')} *</label><textarea name="r" rows="3" placeholder="${esc(t('Ej.: se registró doble, el cheque rebotó, error de captura…'))}"></textarea></div>
      <p class="error-msg" hidden></p><div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Continuar')}</button></div></form>`;
    document.body.appendChild(d);
    const done = v => { d.close(); d.remove(); resolve(v); };
    $('[data-x]', d).onclick = () => done(null);
    d.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    $('form', d).onsubmit = e => { e.preventDefault(); const v = e.target.r.value.trim(); if (v.length < 3) { const m = $('.error-msg', d); m.hidden = false; m.textContent = t('Escriba el motivo (mínimo 3 letras).'); return; } done(v); };
    d.showModal(); setTimeout(() => d.querySelector('textarea').focus(), 50);
  });
}

function toast(msg, isErr, force) {
  if (!isErr && !force && Date.now() < PENDING_UNTIL) return; // no tapar el aviso de "espera autorización"
  const el = $('#toast'); el.textContent = msg; el.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toast.h); toast.h = setTimeout(() => { el.className = ''; }, isErr ? 5000 : force ? 4500 : 2500);
}
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; }
}

// Reduce la foto en el teléfono antes de subirla (más rápido, menos espacio).
function compressImage(file, max = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error(t('Seleccione una imagen (foto)')));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('No se pudo leer la imagen'))); };
    img.src = url;
  });
}

// ================= formulario en ventana =================
// fields: [{ name, label, type: text|textarea|date|money|select|photo|password|tel|email, options:[[v,l]], value, required, hint, full }]
// Selector de fotos: cámara o galería/archivos (en Android sale Google Drive y Google Fotos; en iPhone, Fotos y Archivos).
function bindPhotoPick(w) {
  if (!matchMedia('(pointer: coarse)').matches) { const c = $('.pp-cam', w); if (c) c.hidden = true; }
  $$('input[type=file]', w).forEach(inp => { inp.onchange = () => {
    const fs = [...inp.files]; if (!fs.length) return;
    w._files = fs;
    const prev = $('.pp-prev', w);
    prev.innerHTML = `<b>${fs.length === 1 ? t('1 foto elegida') : t('{n} fotos elegidas', { n: fs.length })}</b><div class="pp-thumbs">${fs.slice(0, 8).map(() => '<span></span>').join('')}</div>`;
    const spans = $$('.pp-thumbs span', prev);
    fs.slice(0, 8).forEach((f, i) => { const u = URL.createObjectURL(f); spans[i].style.backgroundImage = `url(${u})`; });
  }; });
}

// Trades (oficios) para clasificar fotos y materiales.
const TRADES_BASE = () => [['planos', t('Planos y permisos')], ['demolicion', t('Demolición')], ['excavacion', t('Excavación y base')], ['concreto', t('Concreto')], ['carpinteria', t('Carpintería / estructura')],
  ['techo', t('Techo')], ['electricidad', t('Electricidad')], ['av', t('Audio / video y bajo voltaje')], ['plomeria', t('Plomería')], ['gas', t('Gas')], ['piedra', t('Piedra / mampostería')],
  ['cubierta', t('Cubierta / granito')], ['drywall', t('Drywall / acabados')], ['azulejo', t('Azulejo')], ['gabinetes', t('Gabinetes')], ['pisos', t('Pisos')], ['pintura', t('Pintura / stain')],
  ['vidrio', t('Vidrio / cristal')], ['equipos', t('Equipos (appliances)')], ['paisajismo', t('Paisajismo')], ['limpieza', t('Limpieza')], ['otro', t('Otro')]];
// v2.33: los trades que la compañía agregó o renombró en Listas (CAT.trades); los escondidos no salen para escoger.
const TRADES_ALL = () => (CAT && CAT.trades ? CAT.trades.map(x => [x.key, L(x), x.hidden]) : TRADES_BASE().map(x => [x[0], x[1], false]));
const TRADES = () => TRADES_ALL().filter(x => !x[2]).map(x => [x[0], x[1]]);
const tradeLabel = k => (TRADES_ALL().find(x => x[0] === k) || [k, k])[1];
// Adivina el trade por el oficio del sub o por el nombre de la tarea.
function guessTrade(...texts) {
  const s = texts.filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rules = [['av', /\ba\/?v\b|audio|video|bajo voltaje|low voltage|bocina|speaker|\btv\b/], ['electricidad', /electr|luces|lights|abanico|\bfan\b/], ['plomeria', /plom|plumb|fregadero|sink/],
    ['gas', /\bgas\b/], ['demolicion', /demol/], ['concreto', /concret|colar|pour|losa|slab/], ['excavacion', /excav|trazo|811|zapata|footing|pier|pilar/],
    ['techo', /techo|shingle|roof|teja/], ['azulejo', /azulejo|tile|backsplash|impermeab|waterproof/], ['gabinetes', /gabinet|cabinet|vanity/], ['pisos', /piso|floor/],
    ['vidrio', /cristal|vidrio|glass/], ['equipos', /equipos|appliance|parrilla|grill|refriger|fridge/], ['cubierta', /cubierta|granit|counter/],
    ['piedra', /piedra|stone|mason|block|ladrill|brick|chimenea|chimney|firebox|hogar|hearth/], ['drywall', /drywall|tablaroca|aislamiento|insulat|textur/],
    ['pintura', /pint|stain|paint|primer/], ['carpinteria', /carpin|estructur|fram|madera|hardie|siding|fascia|soffit|cedar|cedro|pergol|rafter|poste|post|viga|beam|deck|trim|puerta|door/],
    ['paisajismo', /paisaj|landsc|pasto|grass|riego|irrigat/], ['limpieza', /limpi|clean|punch/], ['planos', /plano|permis|plan\b|plans\b|permit|disen|design|medir|measure/]];
  for (const [k, re] of rules) if (re.test(s)) return k;
  return '';
}
const tradeKey = v => (TRADES().some(x => x[0] === v) ? v : guessTrade(v));
const tradeChips = list => (list || []).filter(Boolean).map(k => `<span class="tr-chip">${esc(tradeLabel(k))}</span>`).join('');
// Etapa y trade sugeridos: la tarea en progreso (o la siguiente) y el oficio de quien la hace.
function guessStage(d, taskId) {
  const tasks = d.tasks || [];
  const x = taskId ? tasks.find(y => y.id === Number(taskId)) : (tasks.find(y => y.status === 'en_progreso' && (ME.role !== 'worker' || y.mine)) || tasks.find(y => y.status === 'en_progreso') || tasks.find(y => y.status === 'pendiente'));
  if (!x) return { task_id: '', trade: guessTrade(ME.trade) };
  const sub = (d.subs || []).find(s => s.user_id && s.user_id === x.assignee_id);
  return { task_id: x.id, trade: x.trade || guessTrade(sub && sub.trade, ME.role === 'worker' ? ME.trade : '', taskTitle(x.title)) || guessTrade(ME.trade) };
}
// Subir fotos de avance clasificadas por etapa y trade (varias a la vez, de la cámara o la galería).
async function photoUploadDialog(jobId, d, taskId, after) {
  const g = guessStage(d, taskId);
  const n = await formDialog({ title: t('Subir fotos de avance'), submit: t('Subir'), fields: [
    { name: 'photos', label: t('Fotos'), type: 'photo', required: true, multiple: true },
    { name: 'task_id', label: t('Etapa'), type: 'select', value: g.task_id, options: [['', t('— general —')], ...(d.tasks || []).map(x => [x.id, taskTitle(x.title)])] },
    { name: 'trade', label: t('Trade'), type: 'select', value: g.trade, options: [['', '—'], ...TRADES()] },
    { name: 'caption', label: t('Comentario (opcional)') }],
    onSubmit: async v => { for (const p of v.photos) await api('POST', `/api/jobs/${jobId}/photos`, { dataUrl: p, task_id: v.task_id || null, trade: v.trade, caption: v.caption }); } });
  if (n) { toast(n.photos.length > 1 ? t('{n} fotos subidas', { n: n.photos.length }) : t('Foto subida')); if (after) after(); }
}

function formDialog({ title, fields, submit = t('Guardar'), onSubmit, danger, intro, extraButton, onOpen, wide }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog'); if (wide) d.classList.add('wide');
    const input = f => {
      const id = 'f_' + f.name, req = f.required ? 'required' : '';
      if (f.type === 'textarea') return `<textarea id="${id}" name="${f.name}" ${f.rows ? `rows="${f.rows}"` : ''} ${req}>${esc(f.value)}</textarea>`;
      if (f.type === 'select') return `<select id="${id}" name="${f.name}" ${req}>${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      // Foto: tomarla con la cámara, o elegirla de la galería, Archivos, Google Drive, Google Fotos…
      if (f.type === 'photo') return `<div class="photo-pick" data-photo="${f.name}" id="${id}">
        <label class="btn pp-cam">📷 ${t('Tomar foto')}<input type="file" accept="image/*" capture="environment" ${f.multiple ? 'multiple' : ''} hidden></label>
        <label class="btn">🖼️ ${t('Galería o archivos')}<input type="file" accept="image/*" ${f.multiple ? 'multiple' : ''} hidden></label>
        <div class="pp-prev small muted">${t('Ninguna foto elegida')}</div></div>`;
      if (f.type === 'doc') return `<input id="${id}" name="${f.name}" type="file" accept="image/*,application/pdf" ${req}>`;
      // Varios archivos (planos): PDF o fotos, hasta 25 MB cada uno.
      if (f.type === 'docs') return `<input id="${id}" name="${f.name}" type="file" accept="image/*,application/pdf" multiple>`;
      if (f.type === 'check') return `<label class="check"><input id="${id}" name="${f.name}" type="checkbox" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
      // Varias opciones (por ejemplo, los trades de un crew): chips que se prenden y apagan.
      if (f.type === 'checks') return `<div class="checks" id="${id}" data-checks="${f.name}">${f.options.map(([v, l]) => `<label class="chk"><input type="checkbox" value="${esc(v)}" ${(f.value || []).includes(v) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`;
      if (f.type === 'money') return `<input id="${id}" name="${f.name}" inputmode="decimal" placeholder="0.00" value="${esc(f.value ?? '')}" ${req} autocomplete="off">`;
      if (f.type === 'datetime') return `<input id="${id}" name="${f.name}" type="datetime-local" value="${esc(f.value ?? '')}" ${req}>`;
      return `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}" ${req} ${f.type === 'password' ? 'autocomplete="new-password"' : ''}>`;
    };
    d.innerHTML = `<form method="dialog" novalidate><h2>${esc(title)}</h2>${intro ? `<div class="intro">${intro}</div>` : ''}<div class="error"></div>
      <div class="fields">${fields.map(f => ` <div class="field ${f.full || ['textarea', 'photo', 'doc', 'docs', 'check', 'checks'].includes(f.type) ? 'full' : ''}" ${f.hidden ? 'hidden' : ''}>
        ${f.type === 'check' ? '' : `<label for="f_${f.name}">${esc(f.label)}${f.required ? ' *' : ''}</label>`}${input(f)}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`).join('')}</div>
      <div class="foot">${extraButton ? `<button type="button" data-extra class="${extraButton.danger ? 'danger' : ''}" style="margin-right:auto">${esc(extraButton.label)}</button>` : ''}<button type="button" data-x>${t('Cancelar')}</button><button class="${danger ? 'danger' : 'primary'}" type="submit">${esc(submit)}</button></div></form>`;
    document.body.appendChild(d);
    const close = v => { d.close(); d.remove(); resolve(v); };
    $('[data-x]', d).onclick = () => close(null);
    if (extraButton) $('[data-extra]', d).onclick = async () => {
      if (extraButton.danger && !confirm(t('¿Seguro?'))) return;
      try { await extraButton.onClick(); close({}); } catch (err) { $('.error', d).textContent = err.message; }
    };
    d.addEventListener('cancel', e => { e.preventDefault(); close(null); });
    $('form', d).onsubmit = async e => {
      e.preventDefault();
      const errBox = $('.error', d), btn = $('button[type=submit]', d);
      const v = {};
      try {
        for (const f of fields) {
          const el = $(`[name="${f.name}"]`, d);
          if (f.type === 'check') { v[f.name] = el.checked; continue; }
          if (f.type === 'checks') { v[f.name] = $$(`[data-checks="${f.name}"] input:checked`, d).map(c => c.value); continue; }
          if (f.type === 'photo') {
            const w = $(`[data-photo="${f.name}"]`, d), files = (w && w._files) || [];
            if (f.multiple) { v[f.name] = []; for (const fl of files) v[f.name].push(await compressImage(fl)); if (f.required && !v[f.name].length) throw new Error(t('Falta: {x}', { x: f.label })); }
            else { v[f.name] = files[0] ? await compressImage(files[0]) : null; if (f.required && !v[f.name]) throw new Error(t('Falta: {x}', { x: f.label })); }
            continue;
          }
          if (f.type === 'docs') { v[f.name] = []; for (const fl of el.files) v[f.name].push({ name: fl.name.replace(/\.[^.]+$/, ''), data: await readPlanFile(fl) }); if (f.required && !v[f.name].length) throw new Error(t('Falta: {x}', { x: f.label })); continue; }
          if (f.type === 'doc') { v[f.name] = el.files[0] ? await readDocFile(el.files[0]) : null; if (f.required && !v[f.name]) throw new Error(t('Falta: {x}', { x: f.label })); continue; }
          let val = el.value.trim();
          if (f.required && !val) throw new Error(t('Falta: {x}', { x: f.label }));
          if (f.type === 'money') { val = toCents(val); if (Number.isNaN(val)) throw new Error(t('Monto inválido: {x}', { x: f.label })); }
          v[f.name] = val;
        }
        btn.disabled = true;
        await onSubmit(v);
        close(v);
      } catch (err) { errBox.textContent = err.message; btn.disabled = false; d.scrollTop = 0; }
    };
    $$('.photo-pick', d).forEach(w => bindPhotoPick(w));
    d.showModal();
    if (onOpen) onOpen(d);
    const first = $('input:not([type=file]),select,textarea', d); if (first) first.focus();
  });
}
function confirmDialog(msg, yes = t('Sí, borrar')) {
  return formDialog({ title: msg, fields: [], submit: yes, danger: true, onSubmit: async () => {} }).then(v => !!v);
}
function viewPhoto(id) {
  const d = document.createElement('dialog'); d.className = 'viewer';
  d.innerHTML = `<img src="/files/${esc(id)}" alt="">`;
  d.onclick = () => { d.close(); d.remove(); };
  document.body.appendChild(d); d.showModal();
}

// ================= navegación =================
// Íconos de la barra de abajo (dibujos simples en SVG).
const ICON = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  jobs: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM8.5 11h7M8.5 15h7"/>',
  money: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.7.8 3 2.6 3.5 5.2"/>',
  logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
};
const svg = k => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

// Menú según el papel de la persona y las herramientas que tenga prendidas.
const MOD = k => !!(COMPANY && COMPANY.modules ? COMPANY.modules[k] : ['importar'].includes(k));
const NAV = () => {
  const sells = (ME.tools || []).includes('ventas');
  return {
    owner: [['#/', t('Inicio')], ['#/plan', t('Mi plan')], ['#/calendario', t('Calendario')], ['#/obras', t('Obras')], ['#/fila', t('Fila de espera')], ...(sells ? [['#/ventas', t('Ventas')]] : []), ['#/gastos', t('Gastos')], ['#/dinero', t('Dinero')], ['#/textos', t('Textos')], ['#/casos', t('Casos')], ['#/materiales', t('Materiales')], ['#/equipo', t('Equipo')],
      ...(MOD('horas') ? [['#/horas', t('Horas y nómina')]] : []), ...(MOD('pm') ? [['#/pm', t('Project managers')]] : [])],
    pm: [['#/', t('Inicio')], ['#/plan', t('Mi plan')], ['#/obras', t('Mis obras')], ['#/fila', t('Fila de espera')], ['#/calendario', t('Calendario')], ...(sells ? [['#/ventas', t('Ventas')]] : []), ['#/gastos', t('Gastos')], ['#/textos', t('Textos')], ['#/casos', t('Casos')], ['#/materiales', t('Materiales')]],
    sales: [['#/', t('Mi día')], ['#/plan', t('Mi plan')], ['#/ventas/clientes', t('Clientes y estimados')], ['#/ventas/agenda', t('Agenda')], ['#/materiales', t('Materiales')]],
    worker: [['#/', t('Mis obras')], ['#/calendario', t('Calendario')], ['#/docs', t('Estimados e invoices')], ['#/mis-pagos', t('Mis pagos')]],
    client: [['#/', t('Mi proyecto')], ['#/materiales', t('Materiales')]],
    admin: [['#/', t('Oficina')], ['#/gastos', t('Gastos')], ['#/inventario', t('Inventario')], ['#/documentos', t('Documentos')], ['#/plan', t('Mi plan')]],
    accountant: [['#/', t('Contabilidad')], ['#/gastos', t('Gastos')], ['#/inventario', t('Inventario')], ['#/documentos', t('Documentos')]],
  };
};
// Abajo del menú, más chico: lo que se usa poco.
const NAV2 = () => [...(ME.role !== 'client' && ME.role !== 'accountant' ? [['#/resumen', '☀️ ' + t('Resumen de hoy')]] : []), ...(['owner', 'pm'].includes(ME.role) ? [['#/inventario', t('Inventario')], ['#/documentos', t('Documentos')]] : []), ...(ME.role === 'owner' ? [['#/opiniones', t('Opiniones de clientes')], ['#/listas', t('Categorías y listas')], ['#/cierre', t('Cierre de mes')], ['#/historial', t('Historial')]] : []), ...(['owner', 'pm', 'sales'].includes(ME.role) ? [['#/inspecciones', t('Inspecciones de la ciudad')]] : []), ['#/cuenta', t('Mi cuenta')]];
// Pestañas de la barra de abajo en el teléfono (como una app).
const TABS_MOBILE = () => {
  const sells = (ME.tools || []).includes('ventas');
  return {
    owner: [['#/', t('Inicio'), 'home'], ['#/obras', t('Obras'), 'jobs'], ['#/calendario', t('Calendario'), 'cal'], sells ? ['#/ventas', t('Ventas'), 'team'] : ['#/gastos', t('Gastos'), 'money'], ['more', t('Más'), 'more']],
    pm: [['#/', t('Inicio'), 'home'], ['#/calendario', t('Calendario'), 'cal'], ['#/obras', t('Obras'), 'jobs'], sells ? ['#/ventas', t('Ventas'), 'team'] : ['#/casos', t('Casos'), 'more'], ['more', t('Más'), 'more']],
    sales: [['#/', t('Mi día'), 'home'], ['#/ventas/clientes', t('Clientes'), 'team'], ['#/ventas/agenda', t('Agenda'), 'cal'], ['#/materiales', t('Materiales'), 'jobs'], ['#/cuenta', t('Mi cuenta'), 'user']],
    worker: [['#/', t('Mis obras'), 'jobs'], ['#/calendario', t('Calendario'), 'cal'], ['#/docs', 'Invoices', 'money'], ['#/mis-pagos', t('Mis pagos'), 'money'], ['#/cuenta', t('Mi cuenta'), 'user']],
    client: [['#/', t('Mi proyecto'), 'home'], ['#/materiales', t('Materiales'), 'jobs'], ['#/cuenta', t('Mi cuenta'), 'user']],
    admin: [['#/', t('Oficina'), 'home'], ['#/gastos', t('Gastos'), 'money'], ['#/plan', t('Mi plan'), 'cal'], ['#/cuenta', t('Mi cuenta'), 'user']],
    accountant: [['#/', t('Contabilidad'), 'home'], ['#/gastos', t('Gastos'), 'money'], ['#/cuenta', t('Mi cuenta'), 'user']],
  };
};
async function logout() { await api('POST', '/api/logout'); ME = null; location.hash = '#/'; boot(); }
function renderNav() {
  const nav = $('#nav'), top = $('#topbar'), tab = $('#tabbar');
  document.body.classList.toggle('signed-in', !!ME);
  if (!ME) { nav.hidden = true; top.hidden = true; tab.hidden = true; renderFab(); return; }
  nav.hidden = false; top.hidden = false; tab.hidden = false;
  nav.innerHTML = `${brandHtml('logo')}${companySwitcher()}
    ${NAV()[ME.role].map(([h, l]) => `<a href="${h}">${esc(l)}${h === '#/' && ME.pending ? ` <span class="badge b-late">${ME.pending}</span>` : ''}</a>`).join('')}
    <div class="nav2">${NAV2().map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join('')}<a href="#/ayuda" data-help class="helplink">❓ ${LANG === 'en' ? 'Help' : 'Ayuda'}</a></div>
    <div class="who">${langButton()}<div style="margin-top:.75rem">${esc(ME.name)}</div><button class="sm" id="logout">${t('Cerrar sesión')}</button><div class="appver" title="${t('Versión de la app')}">v${esc(window.APP_VERSION || '')}</div></div>`;
  top.innerHTML = `${brandHtml('')}${companySwitcher(true)}<span style="flex:1"></span><a href="#/ayuda" data-help class="helpbtn" aria-label="${LANG === 'en' ? 'Help' : 'Ayuda'}">?</a>${langButton()}`;
  // Ayuda: abre los temas de la pantalla donde está.
  $$('[data-help]').forEach(a => { a.onclick = e => { e.preventDefault(); const h = (location.hash || '#/').replace(/^#\//, ''); if (!h.startsWith('ayuda')) location.hash = '#/ayuda/' + encodeURIComponent(h || 'inicio'); }; });
  $$('[data-cosw]').forEach(b => { b.onclick = companySheet; });
  tab.innerHTML = TABS_MOBILE()[ME.role].map(([h, l, ic]) => `<a href="${h === 'more' ? '#' : h}" data-tab="${h}" ${h === 'more' ? 'data-more' : ''}>
    <span class="ic">${svg(ic)}${h === '#/' && ME.pending ? `<span class="dot-alert">${ME.pending}</span>` : ''}</span><span class="lb">${esc(l)}</span></a>`).join('');
  $('#logout').onclick = logout;
  const more = $('[data-more]', tab); if (more) more.onclick = e => { e.preventDefault(); moreSheet(); };
  // Tocar la pestaña en la que ya está = recargar la pantalla (como en una app).
  $$('[data-tab]', tab).forEach(a => a.addEventListener('click', () => { if (a.dataset.tab === (location.hash || '#/')) route(); }));
  bindLang(nav); bindLang(top);
  markNav();
  renderFab();
}
function markNav() {
  const h = location.hash || '#/';
  document.body.classList.toggle('on-texts', h.startsWith('#/textos'));
  document.body.classList.toggle('on-summary', /^#\/obra\/\d+\/resumen/.test(h));
  const under = (x, base) => x === base || x.startsWith(base + '/');
  const isOn = href => href === h || (href !== '#/' && href !== 'more' && under(h, href)) || (href === '#/obras' && (h.startsWith('#/obra/') || h.startsWith('#/plantillas')))
    || (href === '#/plan' && h.startsWith('#/plan')) || (href === '#/' && under(h, '#/hoy')) || (href === '#/dinero' && ['#/cuentas', '#/reportes', '#/proyecciones'].some(b => under(h, b)))
    || (href === 'more' && ['#/equipo', '#/cuenta', '#/casos', '#/horas', '#/dinero', '#/cuentas', '#/proyecciones', '#/reportes', '#/historial', '#/pm', '#/materiales', '#/calendario', '#/gastos', '#/textos'].some(b => under(h, b)) && !$(`#tabbar [data-tab="${h}"]`))
    || (href === '#/ventas' && h.startsWith('#/ventas/'));
  $$('#nav a').forEach(a => a.classList.toggle('on', isOn(a.getAttribute('href'))));
  $$('#tabbar [data-tab]').forEach(a => a.classList.toggle('on', isOn(a.dataset.tab)));
}
// Menú "Más" del dueño en el teléfono: hoja que sube desde abajo.
function moreSheet() {
  const d = document.createElement('dialog'); d.className = 'sheet';
  const tabs = new Set(TABS_MOBILE()[ME.role].map(x => x[0]));
  const IC = { '#/equipo': 'team', '#/cuenta': 'user', '#/calendario': 'cal', '#/horas': 'cal', '#/hoy': 'cal', '#/pm': 'team', '#/ventas': 'team', '#/materiales': 'jobs', '#/casos': 'jobs', '#/historial': 'jobs', '#/obras': 'jobs' };
  d.innerHTML = `<div class="grab"></div><div class="sheet-list">
    ${[...NAV()[ME.role], ...NAV2()].filter(([h]) => !tabs.has(h) && h !== '#/').map(([h, l]) => `<a href="${h}">${svg(IC[h] || 'money')}<span>${esc(l)}</span></a>`).join('')}
    <button data-l>${langButton().replace(/<\/?button[^>]*>/g, '')}<span>${t('Idioma')}</span></button>
    <button data-out>${svg('logout')}<span>${t('Cerrar sesión')}</span></button></div>`;
  document.body.appendChild(d);
  const close = () => { d.close(); d.remove(); };
  d.addEventListener('click', e => { if (e.target === d) close(); });
  $$('a', d).forEach(a => { a.onclick = close; });
  $('[data-l]', d).onclick = () => { close(); setLang(LANG === 'en' ? 'es' : 'en'); };
  $('[data-out]', d).onclick = () => { close(); logout(); };
  d.addEventListener('cancel', close);
  d.showModal();
}

// ===== instalar como app =====
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; showInstall(); });
window.addEventListener('appinstalled', () => { installEvt = null; $('#install').hidden = true; });
function showInstall(force) {
  const box = $('#install');
  if (isStandalone()) { box.hidden = true; return; }
  let snoozed = 0; try { snoozed = Number(localStorage.getItem('ee_install_snooze') || 0); } catch { /* */ }
  if (!force && Date.now() < snoozed) return;
  const mobile = matchMedia('(max-width: 820px)').matches;
  if (!force && !mobile) return;
  if (!installEvt && !isIOS()) { if (force) toast(t('Abra la app en el navegador del teléfono (Chrome o Safari) para instalarla.')); return; }
  box.innerHTML = `<img src="/brand/icon-192.png" alt=""><div class="txt"><b>${t('Instale la app')}</b>
    <span>${installEvt ? t('Se abre como una app, con su ícono, sin barra del navegador.') : t('En iPhone: toque Compartir y luego “Agregar a inicio”.')}</span></div>
    ${installEvt ? `<button class="primary sm" data-i>${t('Instalar')}</button>` : ''}<button class="sm link" data-x aria-label="${t('Ahora no')}">✕</button>`;
  box.hidden = false;
  const i = $('[data-i]', box); if (i) i.onclick = async () => { installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; box.hidden = true; };
  $('[data-x]', box).onclick = () => { box.hidden = true; try { localStorage.setItem('ee_install_snooze', String(Date.now() + 7 * 86400000)); } catch { /* */ } };
}
// ================= VERSIÓN DE LA APP Y AVISO DE ACTUALIZACIÓN =================
// CODE_STAMP = la versión con la que se cargó esta pantalla (el servidor la escribe al mandar este archivo).
// Se compara con la del servidor al abrir, al volver a la app y cada 10 minutos: si es distinta, sale un aviso
// arriba con el número de versión. Nunca se recarga sola: la persona podría estar escribiendo algo.
const CODE_STAMP = '__CODE_STAMP__';
const verOf = stamp => String(stamp || '').split('-')[0];
let SW_REG = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => { SW_REG = reg; }).catch(() => {});
  });
}
async function checkVersion(st) {
  try {
    st = st || await fetch('/api/status', { cache: 'no-store', headers: { 'X-Lang': LANG } }).then(r => r.json());
    if (!st || !st.stamp || CODE_STAMP.startsWith('__')) return;
    window.APP_VERSION = verOf(CODE_STAMP);
    if (st.stamp !== CODE_STAMP) showUpdateBar(st.version);
  } catch { /* sin internet: se revisa después */ }
}
setInterval(() => checkVersion(), 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { checkVersion(); if (SW_REG) SW_REG.update().catch(() => {}); } });
function showUpdateBar(newVer) {
  const cur = verOf(CODE_STAMP);
  let bar = $('#updbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'updbar'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
  bar.innerHTML = `<span>✨ <b>${t('Hay una versión nueva de la app')}${newVer ? ` (${esc(newVer)})` : ''}.</b> ${cur && newVer && cur !== newVer ? `<span class="small">${t('Usted tiene la {v}.', { v: esc(cur) })}</span>` : ''}</span>
    <button class="sm primary" data-r>${t('Actualizar ahora')}</button><button class="sm link" data-x aria-label="${t('Ahora no')}">✕</button>`;
  $('[data-r]', bar).onclick = () => updateNow();
  $('[data-x]', bar).onclick = () => { bar.remove(); setTimeout(() => checkVersion(), 30 * 60 * 1000); };
}
// Actualizar: baja la versión nueva, borra la copia vieja guardada en el teléfono y vuelve a abrir.
async function updateNow() {
  const bar = $('#updbar'); if (bar) bar.innerHTML = `<span>⏳ ${t('Actualizando…')}</span>`;
  try { if (SW_REG) await Promise.race([SW_REG.update(), new Promise(r => setTimeout(r, 4000))]); } catch { /* */ }
  try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch { /* */ }
  location.reload();
}
// Después de actualizar: una sola vez, lo nuevo de cada versión que no había visto.
async function showWhatsNew() {
  const cur = verOf(CODE_STAMP); if (!cur || CODE_STAMP.startsWith('__')) return;
  let seen = ''; try { seen = localStorage.getItem('ee_seen_version') || ''; localStorage.setItem('ee_seen_version', cur); } catch { return; }
  if (!seen || seen === cur) return; // primera vez en este teléfono: no hay nada "nuevo" que enseñar
  const newer = (await api('GET', '/api/release-notes').catch(() => [])).filter(r => cmpVer(r.version, seen) > 0 && cmpVer(r.version, cur) <= 0);
  if (!newer.length) return;
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>✨ ${t('Novedades de la versión {v}', { v: esc(cur) })}</h2>
    ${newer.map(r => `<h3 style="margin:.6rem 0 .2rem">${esc(r.version)}</h3><ul>${(LANG === 'en' ? r.en : r.es).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}
    <div class="foot"><button class="primary">${t('Entendido')}</button></div></form>`;
  document.body.appendChild(d); d.addEventListener('close', () => d.remove()); d.showModal();
}
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };

async function route() {
  const root = $('#app');
  if (!ME) return;
  // Cada pantalla se dibuja en su propio contenedor: si el usuario cambia rápido de pantalla,
  // lo que termine tarde de la anterior ya no aparece en la nueva.
  const app = document.createElement('div'); app.className = 'view';
  root.replaceChildren(app);
  markNav();
  // Mantiene al día el número de avisos pendientes del menú.
  api('GET', '/api/status').then(st => { if (st.user && ME && st.user.pending !== ME.pending) { ME.pending = st.user.pending; renderNav(); } }).catch(() => {});
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  try {
    root.className = '';
    if (parts[0].split('?')[0] === 'plan' && ME.role !== 'client') return await viewPlan(app, new URLSearchParams(location.hash.split('?')[1] || ''));
    if (parts[0] === 'cuenta') return await viewAccount(app);
    if (parts[0] === 'calendario' && !['client', 'sales'].includes(ME.role)) return await viewCalendar(app);
    if (parts[0] === 'materiales') return await viewMaterials(app);
    if (parts[0] === 'ventas' && SELLS()) {
      if (parts[1] === 'clientes') return await viewSalesPipeline(app);
      if (parts[1] === 'agenda') return await viewSalesAgenda(app);
      if (parts[1] === 'cliente') return await viewLead(app, Number(parts[2]));
      return await viewSalesHome(app);
    }
    if (parts[0] === 'ayuda') return await viewHelp(app, decodeURIComponent(parts.slice(1).join('/')));
    if (ME.role === 'sales') { await viewSalesHome(app); return planTodayCard(app).catch(e => console.error(e)); }
    if (parts[0] === 'documentos' && ['owner', 'pm', 'admin', 'accountant'].includes(ME.role)) return await viewCompanyDocs(app);
    if (parts[0] === 'inventario' && ['owner', 'pm', 'admin', 'accountant'].includes(ME.role)) return await viewInventory(app);
    if (parts[0].split('?')[0] === 'resumen' && !['client', 'accountant'].includes(ME.role)) return await viewDigest(app, new URLSearchParams(location.hash.split('?')[1] || ''));
    if (OFFICE()) { if (parts[0] === 'gastos') return await viewExpenses(app); return await viewOffice(app); }
    if (BOSS() && (parts[0] === 'hoy' || (!parts[0] && ME.role !== 'worker'))) return await viewHome(app, parts[0] === 'hoy' ? 'hoy' : 'resumen');
    if (parts[0] === 'textos' && BOSS()) return await viewTexts(app, decodeURIComponent(parts[1] || ''));
    if (parts[0] === 'pm' && ME.role === 'owner') return await viewPmReports(app);
    if (parts[0] === 'plantillas' && ME.role === 'owner') return await viewTemplates(app);
    if (parts[0] === 'inspecciones' && ['owner', 'pm', 'sales'].includes(ME.role)) return await viewInspectionTypes(app);
    if (parts[0] === 'fila' && ['owner', 'pm'].includes(ME.role)) return await viewQueue(app);
    if (ME.role === 'pm') {
      if (parts[0] === 'obras') return await viewJobs(app);
      if (parts[0] === 'obra' && parts[2] === 'resumen') return await viewJobSummary(app, Number(parts[1]));
      if (parts[0] === 'obra') return await viewJob(app, Number(parts[1]), (parts[2] || 'tareas').split('?')[0]);
      if (parts[0] === 'gastos') return await viewExpenses(app);
      if (parts[0] === 'casos') return await viewCases(app);
      return await viewPmHome(app);
    }
    if (ME.role === 'owner') {
      if (parts[0] === 'obras') return await viewJobs(app);
      if (parts[0] === 'obra' && parts[2] === 'resumen') return await viewJobSummary(app, Number(parts[1]));
      if (parts[0] === 'obra') return await viewJob(app, Number(parts[1]), (parts[2] || 'tareas').split('?')[0]);
      if (parts[0] === 'gastos') return await viewExpenses(app);
      if (parts[0] === 'casos') return await viewCases(app);
      if (parts[0] === 'horas') return await viewHours(app, parts[1] || 'nomina', parts[2] || '');
      if (parts[0] === 'dinero') return await viewMoney(app, parts[1] || 'cuentas');
      if (parts[0] === 'reportes') return await viewMoney(app, 'reportes');
      if (parts[0] === 'cuentas') return await viewMoney(app, 'cuentas');
      if (parts[0] === 'historial') return await viewAudit(app, parts[1] ? Number(parts[1]) : null);
      if (parts[0] === 'proyecciones') return await viewMoney(app, 'proyecciones');
      if (parts[0] === 'equipo') { await viewUsers(app); if (!ME.is_agent) await hooksCard(app).catch(e => console.error(e)); return MOD('agentes') ? await agentsCard(app) : null; }
      if (parts[0] === 'cierre') return await viewMonthClose(app);
      if (parts[0] === 'opiniones') return await viewOpinions(app);
      if (parts[0] === 'listas') return await viewLists(app, parts[1]);
      if (parts[0] === 'agentes') return await viewAgentManual(app);
      return await viewDashboard(app);
    }
    if (ME.role === 'worker' && parts[0] === 'mis-pagos') return await viewMyPayments(app);
    if (ME.role === 'worker' && parts[0] === 'docs') return await viewWorkerDocs(app, parts[1] === 'new' ? { type: parts[2], job: Number(parts[3]) } : null);
    if (ME.role === 'worker') return parts[0] === 'obra' ? await viewWorkerJob(app, Number(parts[1])) : await viewWorkerHome(app);
    return await viewClient(app, parts[0] === 'obra' ? Number(parts[1]) : null);
  } catch (e) {
    app.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);

// ================= login / configuración =================
async function boot() {
  const app = $('#app');
  document.documentElement.lang = LANG;
  const st = await api('GET', '/api/status');
  ME = st.user; COMPANY = st.company || COMPANY; window.APP_VERSION = CODE_STAMP.startsWith('__') ? (st.version || '') : verOf(CODE_STAMP);
  checkVersion(st);
  COMPANIES = await api('GET', '/api/companies').catch(() => []);
  document.body.dataset.company = COMPANY.key;
  if (ME && ME.lang && ME.lang !== LANG) {   // el idioma elegido por la persona la sigue en cualquier dispositivo
    LANG = ME.lang; document.documentElement.lang = LANG;
    try { localStorage.setItem('ee_lang', LANG); } catch { /* */ }
  }
  document.body.classList.remove('locked');
  renderNav();
  if (!ME) {
    app.className = 'full';
    if (st.needsSetup) return viewSetup(app, st.setupAllowedHere, st.setupNeedsCode);
    return viewLogin(app);
  }
  document.body.classList.toggle('locked', !!(ME && ME.must_change));
  if (ME.must_change) { app.className = 'full'; return viewMustChange(app); }
  CAT = await api('GET', '/api/catalog');
  setTimeout(() => showInstall(), 1500);
  if (BOSS()) loadSmsStatus();
  TASK_EN = new Map(CAT.taskPairs); TASK_ES = new Map(CAT.taskPairs.map(([es, en]) => [en, es]));
  route();
  setTimeout(() => showWhatsNew(), 1200);
}

function viewLogin(app) {
  app.innerHTML = `<div class="login"><form class="card" id="lf"><div class="row" style="justify-content:flex-end">${langButton()}</div>
    ${brandHtml('')}
    <div class="error" id="le"></div>
    <div class="field"><label for="u">${t('Usuario')}</label><input id="u" autocomplete="username" autocapitalize="none" required></div>
    <div class="field"><label for="p">${t('Contraseña')}</label><input id="p" type="password" autocomplete="current-password" required></div>
    <div class="field" id="cf" hidden><label for="c">${t('Código de 6 dígitos')}</label><input id="c" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
    <button class="primary" style="width:100%;justify-content:center">${t('Entrar')}</button>
    <p style="text-align:center;margin:.9rem 0 0"><a href="#" id="forgot" class="small">${t('¿Olvidó su usuario o contraseña?')}</a></p>
    <div class="newacc"><b>${t('¿Es su primera vez?')}</b> <span class="small muted">${t('Su usuario y contraseña se los da {co}.', { co: esc(COMPANY.name) })}</span><button type="button" class="btn" id="newacc">${t('No tengo usuario: pedir acceso')}</button>
      <a href="#" class="small" data-video="instalar" style="margin-top:.4rem">🎬 ${t('Video: cómo instalar y entrar')}</a></div>
    <div class="appver" style="text-align:center">${t('Versión')} ${esc(window.APP_VERSION || '')}</div></form></div>`;
  bindLang(app);
  $('#forgot').onclick = e => { e.preventDefault(); forgotDialog(); };
  $('#newacc').onclick = () => newAccessDialog();
  setTimeout(() => showInstall(), 1200);
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/login', { username: $('#u').value, password: $('#p').value, code: $('#c').value || undefined });
      if (r.needCode) { $('#cf').hidden = false; $('#c').focus(); $('#le').textContent = t('Escriba el código de su app autenticadora'); return; }
      LAST_PW = $('#p').value;
      location.hash = '#/'; boot();
    } catch (err) { $('#le').textContent = err.message; }
  };
}

function viewSetup(app, allowed, needsCode) {
  if (!allowed) {
    app.innerHTML = `<div class="login"><div class="card"><div class="row" style="justify-content:flex-end">${langButton()}</div><img src="/brand/ee-logo.png" alt=""><h2>${t('App sin configurar')}</h2>
      <p>${t('La primera cuenta de dueño se crea desde la misma computadora donde corre la app (http://localhost).')}</p></div></div>`;
    bindLang(app);
    return;
  }
  app.innerHTML = `<div class="login"><form class="card" id="sf"><div class="row" style="justify-content:flex-end">${langButton()}</div><img src="/brand/ee-logo.png" alt="">
    <h2>${t('Primera vez: crear dueño')}</h2><p class="muted small">${t('Esta será la primera cuenta con control total. Después podrá crear la de Jack, trabajadores y clientes.')}</p>
    <div class="error" id="se"></div>
    ${needsCode ? `<div class="field"><label>${t('Código de instalación')}</label><input id="sc" autocapitalize="none" autocomplete="off" required></div>` : ''}
    <div class="field"><label>${t('Nombre')}</label><input id="sn" required></div>
    <div class="field"><label>${t('Usuario (para entrar)')}</label><input id="su" autocapitalize="none" required></div>
    <div class="field"><label>${t('Contraseña (mínimo 10 caracteres)')}</label><input id="sp" type="password" autocomplete="new-password" required></div>
    <button class="primary">${t('Crear y entrar')}</button></form></div>`;
  bindLang(app);
  $('#sf').onsubmit = async e => {
    e.preventDefault();
    try {
      await api('POST', '/api/setup', { name: $('#sn').value, username: $('#su').value, password: $('#sp').value, setupCode: needsCode ? $('#sc').value : undefined });
      await api('POST', '/api/me/lang', { lang: LANG }).catch(() => {});
      boot();
    } catch (err) { $('#se').textContent = err.message; }
  };
}

// Tarjeta de obra (lista en el teléfono).
function jobCards(list) {
  return `<div class="jcards mobile-only">${list.map(j => `<a class="jcard" href="#/obra/${j.id}">
    <div class="row between"><b>${esc(j.client_name)}</b>${j.status ? `<span class="badge b-${j.status}">${statusLabel(j.status)}</span>` : ''}</div>
    <div class="small muted">${[esc(typeLabel(j.project_type)), esc(j.address || '')].filter(Boolean).join(' · ')}</div>
    <div class="row" style="margin:.45rem 0"><div class="bar" style="flex:1"><span style="width:${j.progress.pct}%"></span></div><span class="small">${j.progress.pct}%</span></div>
    <div class="jnums"><div><span>${t('Contrato')}</span><b>${fmt0(j.money.contract)}</b></div><div><span>${t('Ganancia a la fecha')}</span>${j.money.noCosts ? `<b class="muted small">${t('sin costos cargados')}</b>` : `<b class="${j.money.profit < 0 ? 'neg' : ''}">${fmt0(j.money.profit)}</b>`}</div>
      <div><span>${t('Por cobrar')}</span><b>${fmt0(j.money.balanceDue)}</b></div></div></a>`).join('')}</div>`;
}

// ================= DUEÑO: inicio =================
async function viewDashboard(app) {
  const d = await api('GET', '/api/dashboard');
  const maxCat = Math.max(1, ...d.byCategory.map(c => c.total));
  app.innerHTML = `<div class="row between"><h1>${t('Inicio')}</h1><button class="primary desktop-only" id="scanbtn">📷 ${t('Escanear tickets')}</button></div>
  <div class="grid kpis">
    <div class="kpi"><div class="label">${t('Por cobrar a clientes')}</div><div class="value">${fmt0(d.totals.balanceDue)}</div></div>
    <div class="kpi"><div class="label">${t('Debemos a subs')}</div><div class="value">${fmt0(d.totals.subsOwed)}</div></div>
    <div class="kpi"><div class="label">${t('Ganancia a la fecha (en curso)')}</div><div class="value">${fmt0(d.totals.profit)}</div></div>
    <div class="kpi"><div class="label">${t('Retrabajo {y}', { y: d.year })}</div><div class="value">${fmt0(d.reworkYear)}</div></div>
  </div>
  <div class="card"><div class="row between"><h2>${t('Obras en curso')}</h2><a class="btn" href="#/obras">${t('Ver todas')}</a></div>
    ${d.active.length ? `${jobCards(d.active)}<div class="table-wrap desktop-only"><table><thead><tr><th>${t('Cliente')}</th><th>${t('Avance')}</th><th class="num">${t('Contrato')}</th><th class="num">${t('Gastado')}</th><th class="num">${t('Ganancia a la fecha')}</th><th class="num">${t('Por cobrar')}</th></tr></thead><tbody>
    ${d.active.map(j => `<tr class="click" data-go="#/obra/${j.id}"><td><b>${esc(j.client_name)}</b><div class="small muted">${esc(typeLabel(j.project_type))}${j.end_date ? ' · ' + t('termina {d}', { d: fdate(j.end_date) }) : ''}</div></td>
      <td><div class="bar"><span style="width:${j.progress.pct}%"></span></div><div class="small muted">${t('{a}/{b} tareas', { a: j.progress.done, b: j.progress.total })}</div></td>
      <td class="num">${fmt0(j.money.contract)}</td><td class="num">${fmt0(j.money.spent)}</td>
      <td class="num ${j.money.profit < 0 ? 'neg' : ''}">${j.money.noCosts ? `<span class="muted">—</span><div class="small muted">${t('sin costos cargados')}</div>` : `${fmt0(j.money.profit)}${j.money.marginPct != null ? `<div class="small muted">${j.money.marginPct}%</div>` : ''}`}</td>
      <td class="num">${fmt0(j.money.balanceDue)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="empty">${t('No hay obras en curso. Cambie una obra a “En obra” para verla aquí.')}</p>`}
  </div>
  <div class="grid two">
    <div class="card"><h2>${t('Tareas de esta semana')}</h2>
      ${d.tasksSoon.length ? `<table><tbody>${d.tasksSoon.map(x => `<tr class="click" data-go="#/obra/${x.job_id}"><td>${esc(taskTitle(x.title))}<div class="small muted">${esc(x.client_name)}${x.assignee_name ? ' · ' + esc(x.assignee_name) : ''}</div></td>
        <td class="nowrap right">${x.overdue ? `<span class="badge b-late">${t('Atrasada')}</span><br>` : ''}<span class="small">${fdate(x.planned_date)}</span></td></tr>`).join('')}</tbody></table>`
      : `<p class="empty">${t('Sin tareas programadas para los próximos 7 días.')}</p>`}</div>
    <div class="card"><h2>${t('Seguimiento de prospectos')}</h2>
      ${d.followUps.length ? `<table><tbody>${d.followUps.map(f => `<tr class="click" data-go="#/obra/${f.id}"><td><b>${esc(f.client_name)}</b> <span class="badge b-${f.status}">${statusLabel(f.status)}</span>
        <div class="small muted">${esc(f.client_phone)}${f.quoted_cents ? ' · ' + fmt0(f.quoted_cents) : ''}</div></td>
        <td class="nowrap right small">${f.follow_up_date ? `${f.due ? `<span class="badge b-late">${t('Llamar')}</span><br>` : ''}${fdate(f.follow_up_date)}` : `<span class="muted">${t('sin fecha')}</span>`}</td></tr>`).join('')}</tbody></table>`
      : `<p class="empty">${t('No hay prospectos ni cotizaciones abiertas.')}</p>`}</div>
  </div>
  <div class="grid two">
    <div class="card"><h2>${t('Change orders pendientes')}</h2>
      ${d.pendingCO.length ? `<table><tbody>${d.pendingCO.map(c => `<tr class="click" data-go="#/obra/${c.job_id}/cambios"><td>${esc(c.description)}<div class="small muted">${esc(c.client_name)}</div></td><td class="num">${fmt(c.price_cents)}</td></tr>`).join('')}</tbody></table>`
      : `<p class="empty">${t('Nada pendiente de aprobar.')}</p>`}</div>
    <div class="card"><h2>${t('Gastos {y} por categoría', { y: d.year })}</h2>
      ${d.byCategory.length ? CAT.categories.map(c => { const r = d.byCategory.find(x => x.category === c.key); if (!r) return ''; return `<div class="catbar"><span>${esc(L(c))}</span><div class="bar"><span style="width:${Math.round(r.total / maxCat * 100)}%"></span></div><span class="num right">${fmt0(r.total)}</span></div>`; }).join('')
      : `<p class="empty">${t('Todavía no hay gastos este año.')}</p>`}</div>
  </div>`;
  $$('[data-go]', app).forEach(r => { r.onclick = () => { location.hash = r.dataset.go; }; });
  $('#scanbtn').onclick = () => scanFlow(null, () => viewDashboard(app));
  const nb = document.createElement('div'); app.insertBefore(nb, app.children[1]);
  const db2 = document.createElement('div'); app.insertBefore(db2, app.children[2]);
  const sc = document.createElement('div'); app.insertBefore(sc, app.children[3]);
  const cs = document.createElement('div'); app.insertBefore(cs, app.children[1]);
  const crq = document.createElement('div'); app.insertBefore(crq, app.children[1]);
  const arq = document.createElement('div'); app.insertBefore(arq, app.children[1]);
  await accessRequestsCard(arq, () => viewDashboard(app)).catch(e => console.error(e));
  await changeRequestsCard(crq, () => viewDashboard(app)).catch(e => console.error(e));
  if (ME.role === 'owner') { const spd = document.createElement('div'); app.insertBefore(spd, crq.nextSibling); await subDueCard(spd).catch(e => console.error(e)); }
  const pma = document.createElement('div'); app.insertBefore(pma, app.children[2]);
  await pmActivityCard(pma).catch(e => console.error(e));
  const sal = document.createElement('div'); app.insertBefore(sal, app.children[1]);
  await salesHomeCard(sal).catch(e => console.error(e));
  const mal = document.createElement('div'); app.insertBefore(mal, app.children[1]);
  await marginAlertsCard(mal).catch(e => console.error(e));
  await ownerProCards(app, () => viewDashboard(app)).catch(e => console.error(e));
  await billingDueCard(app).catch(e => console.error(e));
  await papersAlertCard(app).catch(e => console.error(e));
  const mp = document.createElement('div'); app.insertBefore(mp, app.children[1]);
  await myPendingCard(mp, () => viewDashboard(app)).catch(e => console.error(e));
  await Promise.all([casesCard(cs, { title: '⚠️ ' + t('Casos abiertos'), onlyOpen: true, showJob: true, after: () => viewDashboard(app) }), ownerNoticesCard(nb, () => viewDashboard(app)), ownerDocsCard(db2, () => viewDashboard(app)), ownerScansCard(sc, () => viewDashboard(app))]);
}

// ================= DUEÑO: obras =================
function jobFormFields(j = {}, pms = []) {
  return [
    ...(ME.role === 'owner' && pms.length ? [{ name: 'pm_id', label: t('Project manager a cargo'), type: 'select', value: j.pm_id ?? '', hint: t('Puede ser un project manager o uno de los dueños. Recibe los avisos y los casos de la obra.'), options: [['', t('— Ninguno (lo manejan los dueños) —')], ...pms.map(p => [p.id, p.role === 'owner' ? `${p.name} (${t('dueño')})` : p.name])] }] : []),
    { name: 'client_name', label: t('Cliente'), required: true, value: j.client_name },
    { name: 'client_phone', label: t('Teléfono'), type: 'tel', value: j.client_phone },
    { name: 'client_email', label: t('Email'), type: 'email', value: j.client_email },
    { name: 'address', label: t('Dirección de la obra'), value: j.address },
    { name: 'project_type', label: t('Tipo de proyecto'), type: 'select', value: j.project_type || 'patio_cover', options: CAT.projectTypes.map(x => [x.key, L(x)]) },
    { name: 'status', label: t('Estado'), type: 'select', value: j.status || 'prospecto', options: CAT.jobStatus.map(s => [s.key, L(s)]) },
    { name: 'quoted_cents', label: t('Precio cotizado al cliente ($)'), type: 'money', value: centsToInput(j.quoted_cents) },
    { name: 'lead_source', label: t('Cómo nos encontró'), value: j.lead_source, hint: t('Google, referido, vecino…') },
    { name: 'start_date', label: t('Fecha de inicio'), type: 'date', value: j.start_date },
    { name: 'end_date', label: t('Fecha estimada de fin'), type: 'date', value: j.end_date },
    { name: 'follow_up_date', label: t('Próximo seguimiento'), type: 'date', value: j.follow_up_date, hint: t('Para prospectos y cotizaciones') },
    ...(j.id ? [{ name: 'completed_date', label: t('Fecha en que se terminó'), type: 'date', value: j.completed_date, hint: t('La garantía (1 año) cuenta desde aquí') }] : []),
    { name: 'description', label: t('Qué se va a hacer'), type: 'textarea', value: j.description },
    { name: 'notes', label: t('Notas internas (solo dueños)'), type: 'textarea', value: j.notes },
  ];
}
async function newJob() {
  let id, made;
  const [pms, T] = await Promise.all([ME.role === 'owner' ? api('GET', '/api/users').then(us => us.filter(u => ['pm', 'owner'].includes(u.role) && u.active)).catch(() => []) : [], loadTemplates().catch(() => ({ saved: [], suggested: [] }))]);
  const fields = jobFormFields({}, pms);
  const o = templateOptions(T, 'patio_cover');
  fields.splice(fields.findIndex(f => f.name === 'project_type') + 1, 0, { name: 'template', label: t('Tareas de la obra'), type: 'select', value: o.value, options: o.options,
    hint: t('Escoja una plantilla, o déjela en blanco para agregar las tareas o importar el SCHEDULE después.') });
  if (ME.role === 'owner') fields.push(
    { name: 'planos', label: t('📐 Planos (PDF o fotos)'), type: 'docs', hint: t('Los verán los subs de la obra, sin precios. Puede subirlos después en la pestaña Planos.') },
    { name: 'estimado', label: t('🧾 Estimado (PDF o foto)'), type: 'doc', hint: t('Cuando el cliente lo apruebe, se convierte en invoice.') },
    { name: 'est_number', label: t('Número del estimado') }, { name: 'est_amount', label: t('Monto del estimado ($)'), type: 'money' });
  const ok = await formDialog({ title: t('Nueva obra'), fields, submit: t('Crear obra'),
    // Al cambiar el tipo de obra, cambian las plantillas que se ofrecen (y la ★ sale escogida).
    onOpen: dlg => { const ty = $('[name=project_type]', dlg), tp = $('[name=template]', dlg);
      ty.onchange = () => { const x = templateOptions(T, ty.value); tp.innerHTML = x.options.map(([v, l]) => `<option value="${esc(v)}" ${v === x.value ? 'selected' : ''}>${esc(l)}</option>`).join(''); }; },
    onSubmit: async ({ planos, estimado, est_number, est_amount, ...v }) => {
      if (estimado && !(est_amount > 0)) throw new Error(t('Escriba el monto del estimado'));
      if (!id) { made = await api('POST', '/api/jobs', v); id = made.id; }
      // Planos y estimado de la obra (si falla uno, la obra ya quedó y se sube después en Planos).
      try {
        for (const p of planos || []) await api('POST', `/api/jobs/${id}/docs`, { kind: 'plano', title: p.name, file: p.data });
        if (estimado) await api('POST', `/api/jobs/${id}/docs`, { kind: 'estimado', file: estimado, number: est_number, amount_cents: est_amount, title: est_number ? t('Estimado') + ' ' + est_number : t('Estimado') });
      } catch (e) { setTimeout(() => toast(t('La obra quedó creada, pero un archivo no se subió: {x}. Súbalo en la pestaña Planos.', { x: e.message }), true), 600); }
    } });
  if (ok) { toast(made.tasks ? t('Obra creada con {n} tareas', { n: made.tasks }) : t('Obra creada. Agregue las tareas o importe el SCHEDULE')); location.hash = `#/obra/${id}`; }
}

async function viewJobs(app) {
  const jobs = await api('GET', '/api/jobs');
  const filter = viewJobs.filter || 'abiertas';
  const shown = jobs.filter(j => filter === 'todas' || (filter === 'abiertas' ? !['terminado', 'cancelado'].includes(j.status) : j.status === filter));
  app.innerHTML = `<div class="row between"><h1>${t('Obras')}</h1><div class="row">${ME.role === 'owner' ? `<a class="btn" href="#/plantillas">📋 ${t('Plantillas')}</a>` : ''}${ME.role === 'owner' && MOD('importar') ? `<button id="imx">📥 ${t('Importar de Excel')}</button>` : ''}<button class="primary" id="nj">${t('+ Nueva obra')}</button></div></div>
    <div class="row" style="margin-bottom:1rem"><select id="flt" style="width:auto">${[['abiertas', t('Abiertas')], ...CAT.jobStatus.map(s => [s.key, L(s)]), ['todas', t('Todas')]]
      .map(([k, l]) => `<option value="${k}" ${k === filter ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select><span class="muted small">${t('{n} obra(s)', { n: shown.length })}</span></div>
    <div class="card">${shown.length ? `${jobCards(shown)}<div class="table-wrap desktop-only"><table><thead><tr><th>${t('Cliente')}</th><th>${t('Estado')}</th><th>${t('Avance')}</th><th class="num">${t('Contrato')}</th><th class="num">${t('Ganancia a la fecha')}</th><th class="num">${t('Por cobrar')}</th></tr></thead><tbody>
      ${shown.map(j => `<tr class="click" data-go="#/obra/${j.id}"><td><b>${esc(j.client_name)}</b><div class="small muted">${esc(typeLabel(j.project_type))}${j.address ? ' · ' + esc(j.address) : ''}</div></td>
        <td><span class="badge b-${j.status}">${statusLabel(j.status)}</span></td>
        <td><div class="bar"><span style="width:${j.progress.pct}%"></span></div><div class="small muted">${j.progress.pct}%</div></td>
        <td class="num">${fmt0(j.money.contract)}</td><td class="num ${j.money.profit < 0 ? 'neg' : ''}">${j.money.noCosts && j.money.contract ? `<span class="muted small">${t('sin costos cargados')}</span>` : fmt0(j.money.profit)}</td><td class="num">${fmt0(j.money.balanceDue)}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="empty">${t('No hay obras en esta lista.')}</p>`}</div>`;
  if ($('#imx')) $('#imx').onclick = () => importDialog(() => viewJobs(app));
  $('#nj').onclick = newJob;
  $('#flt').onchange = e => { viewJobs.filter = e.target.value; viewJobs(app); };
  $$('[data-go]', app).forEach(r => { r.onclick = () => { location.hash = r.dataset.go; }; });
}

const TABS = () => [['tareas', t('Tareas')], ['planos', t('Planos')], ['documentos', t('Contrato y garantías')], ...(ME.role === 'owner' ? [['propuesta', t('Propuesta y cobros')]] : []), ['partidas', t('Partidas')], ['materiales', t('Materiales')], ['gastos', t('Gastos')], ['subs', t('Subcontratistas')], ['cambios', t('Change orders')], ['pagos', t('Pagos del cliente')], ['diario', t('Reporte diario')], ['historial', t('Historial diario')], ['fotos', t('Fotos')], ['permisos', t('Permisos')], ['casos', t('Casos')], ['datos', t('Datos y acceso')]];

// ===== Resumen de la obra para ver e imprimir (dentro de la app, con Volver e Imprimir) =====
async function viewJobSummary(app, id) {
  const d = await api('GET', `/api/jobs/${id}`);
  const j = d.job, m = d.money, isOwner = ME.role === 'owner';
  const mode = isOwner ? (viewJobSummary.mode || 'cliente') : 'cliente';
  const today = new Date().toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const coOk = (d.changes || []).filter(c => c.status === 'aprobado');
  const coPend = (d.changes || []).filter(c => c.status === 'pendiente');
  const base = m.contract - (m.changeOrdersPrice || 0);
  const pays = [...(d.payments || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const tasks = d.tasks || [];
  const ST = { pendiente: t('Pendiente'), en_progreso: t('En progreso'), hecho: t('Hecho') };
  const groups = EXP_GROUPS().filter(g => g[0] !== 'todo').map(([k, l]) => [l, (d.expenses || []).filter(e => inGroup(e, k)).reduce((a, e) => a + e.amount_cents, 0)]);
  const row = (a, b, cls = '') => `<tr class="${cls}"><td>${a}</td><td class="num">${b}</td></tr>`;
  app.innerHTML = `<div class="no-print sum-bar">
      <a class="btn" href="#/obra/${id}/tareas">← ${t('Volver a la obra')}</a>
      ${isOwner ? `<div class="seg" role="group"><button type="button" data-mode="cliente" class="${mode === 'cliente' ? 'on' : ''}">${t('Para el cliente')}</button><button type="button" data-mode="interno" class="${mode === 'interno' ? 'on' : ''}">${t('Interno (con costos)')}</button></div>` : ''}
      <span style="flex:1"></span>
      <button type="button" class="btn" id="pdfbtn">📄 PDF</button>
      <button type="button" class="primary" id="printbtn">🖨 ${t('Imprimir')}</button></div>
    ${mode === 'interno' ? `<p class="no-print small neg">🔒 ${t('Versión interna: incluye costos y ganancia. No se la mande al cliente.')}</p>` : ''}
    <article class="print-doc">
      <header class="pd-head"><div>${COMPANY.logo ? `<img src="/brand/ee-logo.png" alt="" class="pd-logo">` : ''}<b class="pd-co">${esc(COMPANY.name)}</b><div class="small muted">${esc(COMPANY.city || '')}</div></div>
        <div class="pd-title"><h1>${mode === 'interno' ? t('Resumen interno de la obra') : t('Resumen del contrato')}</h1><div class="small">${esc(today)} · ${jobCode(j.id)}</div></div></header>
      <section class="pd-grid">
        <div><span>${t('Cliente')}</span><b>${esc(j.client_name)}</b></div>
        <div><span>${t('Dirección')}</span><b>${esc(j.address || '—')}</b></div>
        <div><span>${t('Tipo de proyecto')}</span><b>${esc(typeLabel(j.project_type))}</b></div>
        <div><span>${t('Estado')}</span><b>${statusLabel(j.status)}</b></div>
        <div><span>${t('Inicio')}</span><b>${j.start_date ? fdate(j.start_date) : '—'}</b></div>
        <div><span>${t('Fin estimado')}</span><b>${j.end_date ? fdate(j.end_date) : '—'}</b></div>
        ${j.warranty_until ? `<div><span>${t('Garantía hasta')}</span><b>${fdate(j.warranty_until)}</b></div>` : ''}
        <div><span>${t('Avance')}</span><b>${d.progress.pct}% · ${t('{a} de {b} tareas', { a: d.progress.done, b: d.progress.total })}</b></div>
      </section>
      ${j.description ? `<h2>${t('Trabajo a realizar')}</h2><p style="white-space:pre-wrap">${esc(j.description)}</p>` : ''}
      <h2>${t('Contrato y pagos')}</h2>
      <table class="pd-table"><tbody>
        ${row(t('Precio original'), fmt(base))}
        ${coOk.map(c => row(`${t('Change order')} · ${fdate(c.date)} · ${esc(c.description)}`, fmt(c.price_cents))).join('')}
        ${row(`<b>${t('Total del contrato')}</b>`, `<b>${fmt(m.contract)}</b>`, 'pd-total')}
        ${pays.map(p => row(`${t('Pago')} · ${fdate(p.date)}${p.method ? ' · ' + esc(payLabel(p.method)) : ''}`, '−' + fmt(p.amount_cents))).join('')}
        ${row(`<b>${t('Pagado')}</b>`, `<b>${fmt(m.paid)}</b>`)}
        ${row(`<b>${t('Saldo pendiente')}</b>`, `<b>${fmt(m.balanceDue)}</b>`, 'pd-total')}
      </tbody></table>
      ${coPend.length ? `<p class="small">${t('Change orders por aprobar')}: ${coPend.map(c => `${c.code ? esc(c.code) + ' ' : ''}${esc(c.description)} (${fmt(c.price_cents)})`).join(' · ')}</p>` : ''}
      ${mode === 'interno' ? `<h2>${t('Costos y ganancia')}</h2>
        <table class="pd-table"><tbody>
          ${groups.map(([l, v]) => row(esc(l), fmt(v))).join('')}
          ${row(`<b>${t('Gastado')}</b>`, `<b>${fmt(m.spent)}</b>`, 'pd-total')}
          ${m.committed ? row(t('Falta pagar a subs'), fmt(m.committed)) : ''}
          ${row(`<b>${t('Ganancia a la fecha')}</b>`, m.noCosts ? t('sin costos cargados todavía') : `<b class="${m.profit < 0 ? 'neg' : ''}">${fmt(m.profit)}${m.marginPct != null ? ' · ' + m.marginPct + '%' : ''}</b>`)}
          ${m.projectedMarginPct != null ? row(t('Margen proyectado'), `${m.projectedMarginPct}%`) : ''}
          ${m.rework ? row(t('Retrabajo'), fmt(m.rework)) : ''}
        </tbody></table>
        ${(d.subs || []).length ? `<h2>${t('Subcontratistas')}</h2><table class="pd-table"><thead><tr><th>${t('Sub')}</th><th class="num">${t('Acordado')}</th><th class="num">${t('Pagado')}</th><th class="num">${t('Debe')}</th></tr></thead><tbody>
          ${d.subs.map(x => `<tr><td>${esc(x.name)}${x.trade ? ` <span class="small muted">· ${esc(x.trade)}</span>` : ''}</td><td class="num">${fmt(x.agreed_cents)}</td><td class="num">${fmt(x.paid_cents)}</td><td class="num">${fmt(Math.max(0, x.agreed_cents - x.paid_cents))}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}
      ${tasks.length ? `<h2>${t('Avance de la obra')}</h2><table class="pd-table pd-tasks"><tbody>
        ${tasks.map(x => `<tr><td>${x.status === 'hecho' ? '✓' : x.status === 'en_progreso' ? '◐' : '○'} ${esc(taskTitle(x.title))}</td><td class="small">${ST[x.status] || ''}</td><td class="num small">${x.status === 'hecho' ? fdate(x.done_date) : x.planned_date ? fdate(x.planned_date) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
      <footer class="pd-foot small muted">${esc(COMPANY.name)} · ${jobCode(j.id)} · ${esc(today)}</footer>
    </article>`;
  $('#printbtn', app).onclick = () => window.print();
  $('#pdfbtn', app).onclick = () => openDoc(`/api/jobs/${id}/pdf?lang=${LANG}`, `${jobCode(j.id)}.pdf`);
  $$('[data-mode]', app).forEach(b => { b.onclick = () => { viewJobSummary.mode = b.dataset.mode; viewJobSummary(app, id); }; });
}

// Abrir un documento (PDF, foto) sin perderse: en la app instalada no hay botón de regresar en una ventana aparte,
// así que se ofrece compartir / imprimir / guardar desde la propia app.
async function openDoc(url, name) {
  if (!isStandalone()) { window.open(url, '_blank', 'noopener'); return; }
  const d = document.createElement('dialog'); d.className = 'docdlg';
  d.innerHTML = `<h2>📄 ${t('Documento')}</h2><p class="small muted" data-st>${t('Preparando…')}</p>
    <div class="row wrap"><button type="button" class="primary" data-share disabled>🖨 ${t('Imprimir o compartir')}</button><a class="btn" data-dl hidden>⬇ ${t('Guardar')}</a><button type="button" data-x>${t('Cerrar')}</button></div>`;
  document.body.appendChild(d); d.showModal();
  const close = () => { d.close(); d.remove(); };
  $('[data-x]', d).onclick = close; d.addEventListener('cancel', e => { e.preventDefault(); close(); });
  try {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(t('No se pudo abrir el documento'));
    const blob = await r.blob();
    const fname = name || (blob.type.includes('pdf') ? 'documento.pdf' : blob.type.includes('png') ? 'imagen.png' : blob.type.includes('jpeg') ? 'imagen.jpg' : 'archivo');
    const file = new File([blob], fname, { type: blob.type });
    const href = URL.createObjectURL(blob);
    const dl = $('[data-dl]', d); dl.href = href; dl.download = fname; dl.hidden = false;
    const sb = $('[data-share]', d);
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      sb.disabled = false; sb.onclick = () => navigator.share({ files: [file], title: fname }).catch(() => {});
      $('[data-st]', d).textContent = t('Listo. “Imprimir o compartir” abre el menú del teléfono (Imprimir, WhatsApp, correo, Archivos).');
    } else { sb.remove(); $('[data-st]', d).textContent = t('Listo. Toque Guardar para bajarlo y abrirlo.'); }
  } catch (e) { $('[data-st]', d).textContent = e.message; }
}
// En la app instalada, los enlaces a documentos de la app (PDF, fotos, archivos) se abren con openDoc.
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[target="_blank"]'); if (!a || !isStandalone()) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || !/^\/(api|files)\//.test(u.pathname)) return;
  e.preventDefault(); openDoc(u.pathname + u.search);
});

async function viewJob(app, id, tab) {
  const [d, users] = await Promise.all([api('GET', `/api/jobs/${id}`), api('GET', '/api/users')]);
  const j = d.job, m = d.money;
  const workers = users.filter(u => u.role === 'worker' && u.active);
  const reload = () => viewJob(app, id, tab);
  app.innerHTML = `<a href="#/obras" class="small">← ${t('Obras')}</a>
  <div class="row between" style="margin-top:.3rem"><div><h1 style="margin:0">${esc(j.client_name)}</h1>
    <div class="muted">${esc(typeLabel(j.project_type))}${j.address ? ' · ' + esc(j.address) : ''} · <span class="code" title="${t('Dígalo al pagar (Job name / PO) para que el ticket se archive solo en esta obra')}">${jobCode(j.id)}</span></div></div>
    <div class="row"><span class="badge b-${j.status}">${statusLabel(j.status)}</span>${j.signed_at ? `<span class="badge b-hecho">✍️ ${t('Firmado')}</span>` : ''}<button id="edit">${t('Editar obra')}</button>
      <a class="btn" href="#/obra/${id}/resumen" title="${t('Estimado o resumen de contrato para el cliente, con change orders y pagos')}">🖨 ${t('Resumen / imprimir')}</a></div></div>
  <div class="card" style="margin-top:1rem"><div class="money-strip">
    <div><span>${t('Contrato')}</span><b>${fmt(m.contract)}</b>${m.changeOrdersPrice ? `<span class="small">${t('incl. {x} en cambios', { x: fmt0(m.changeOrdersPrice) })}</span>` : ''}</div>
    <div><span>${t('Gastado')}</span><b>${fmt(m.spent)}</b></div>
    <div><span>${t('Ganancia a la fecha')}</span>${m.noCosts ? `<b class="muted">—</b><span class="small">${t('sin costos cargados todavía')}</span>` : `<b class="${m.profit < 0 ? 'neg' : 'pos'}">${fmt(m.profit)}</b>${m.marginPct != null ? `<span class="small">${t('{x}% margen', { x: m.marginPct })}</span>` : ''}`}</div>
    <div><span>${t('Cobrado')}</span><b>${fmt(m.paid)}</b></div>
    <div><span>${t('Por cobrar')}</span><b>${fmt(m.balanceDue)}</b></div>
    <div><span>${t('Retrabajo')}</span><b class="${m.rework ? 'neg' : ''}">${fmt(m.rework)}</b></div>
    ${m.committed ? `<div><span>${t('Falta pagar a subs')}</span><b>${fmt(m.committed)}</b></div>` : ''}
    ${m.projectedMarginPct != null ? `<div class="${m.projectedMarginPct < (FIN_ALERT || 35) ? 'lowm' : ''}"><span>${t('Margen proyectado')}</span><b class="${m.projectedProfit < 0 ? 'neg' : ''}">${m.projectedMarginPct}%</b><span class="small">${fmt0(m.projectedProfit)}${m.projectedMarginPct < (FIN_ALERT || 35) ? ' · ⚠️ ' + t('bajo') : ''}</span></div>` : ''}
  </div>
  <div id="splitbox"></div>
  <div class="row" style="margin-top:.75rem"><div class="bar big" style="flex:1"><span style="width:${d.progress.pct}%"></span></div><b>${d.progress.pct}%</b><span class="muted small">${t('{a} de {b} tareas', { a: d.progress.done, b: d.progress.total })}</span></div></div>
  <nav class="tabs">${TABS().map(([k, l]) => `<a href="#/obra/${id}/${k}" class="${k === tab ? 'on' : ''}">${esc(l)}</a>`).join('')}</nav>
  <div id="tab"></div>`;
  $('#edit').onclick = async () => {
    let r;
    if (await formDialog({ title: t('Editar obra'), fields: jobFormFields(j, users.filter(u => ['pm', 'owner'].includes(u.role) && u.active)), onSubmit: async v => { r = await api('PUT', `/api/jobs/${id}`, { ...v, _expect: { quoted_cents: j.quoted_cents, status: j.status } }); } })) { toast(t('Guardado')); reload(); shareIfClient(r); }
  };
  const box = $('#tab');
  const tabs = { tareas: async (box, d, o) => { await tabTasks(box, d, o); await roughinCard(box, o.id, o.reload).catch(e => console.error(e)); if (ME.role === 'owner' && ['activo', 'terminado'].includes(d.job.status)) await closeoutCard(box, o.id); }, gastos: tabExpenses, subs: async (box, d, o) => { await tabSubs(box, d, o); if (ME.role === 'owner') await jobLaborCard(box, o.id); }, cambios: tabChanges, pagos: tabPayments, fotos: tabPhotos, casos: tabCases, datos: tabData, presupuesto: tabBudget, permisos: tabPermits, planos: tabPlans, documentos: tabDocuments, diario: tabDaily, historial: tabHistory, materiales: async (box, d, o) => { await tabMaterials(box, d, o); if (BOSS()) await selectionsCard(box, o.id, d).catch(e => console.error(e)); await jobToolsCard(box, o.id).catch(e => console.error(e)); }, propuesta: tabProposal, partidas: async (box, d, o) => { await tabLines(box, d, o); if (ME.role === 'owner') { const p = document.createElement('p'); p.className = 'small muted'; p.innerHTML = `${t('¿Prefiere verlo por categoría de gasto?')} <a href="#/obra/${o.id}/presupuesto">${t('Presupuesto por categoría')}</a>`; box.appendChild(p); } } };
  if (ME.role === 'owner') splitStrip($('#splitbox'), id).catch(() => {});
  await (tabs[tab] || tabTasks)(box, d, { id, workers, users, reload });
  if (!tabs[tab] || tab === 'tareas') await planCard(box, d, { id, workers, reload });
  if (tab === 'datos' && ME.role === 'owner') await closeoutCards(box, d, id).catch(e => console.error(e));
  if (j.lead_new) api('POST', `/api/jobs/${id}/lead-seen`).catch(() => {});
  if (tab === 'pagos') await ownerStatementCard(box, j);
  if (tab === 'cambios' || tab === 'pagos') { const sc = document.createElement('div'); box.appendChild(sc); await ownerSigningCard(sc, id); }
  if (tab === 'datos') { const lc = document.createElement('div'); box.appendChild(lc); ownerLocationCard(lc, j);
    if (ME.role === 'owner') { const hc = document.createElement('div'); hc.className = 'card'; hc.innerHTML = `<a href="#/historial/${id}">📜 ${t('Historial de cambios de esta obra')}</a>`; box.appendChild(hc); } }
  if (tab === 'subs') {
    const docs = await api('GET', `/api/docs?job=${id}`);
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<h2>${t('Estimados e invoices de subs')}</h2>
      <p class="small muted">${t('Los subs los mandan desde su app. Estimado aceptado = se suma a lo acordado. Invoice aprobado = gasto de la obra (la ganancia se recalcula sola). Toque uno para revisarlo, corregirlo o marcarlo pagado.')}</p>
      ${docRows(docs)}`;
    box.prepend(c);
    bindDocRows(c, docs, reload);
  }
}

function taskPhotos(d, taskId) {
  const ph = d.photos.filter(p => p.task_id === taskId);
  return ph.length ? `<div class="photos" style="grid-template-columns:repeat(auto-fill,minmax(70px,1fr));margin-top:.4rem">${ph.map(p => `<img src="/files/${p.id}" data-view="${p.id}" alt="">`).join('')}</div>` : '';
}
function bindPhotoViews(root) { $$('[data-view]', root).forEach(i => { i.onclick = () => viewPhoto(i.dataset.view); }); }

function tabTasks(box, d, { id, workers, reload }) {
  const wopts = [['', t('— sin asignar —')], ...workers.map(w => [w.id, w.name + (w.trade ? ` (${w.trade})` : '')])];
  const ST = TASK_STATUS();
  box.innerHTML = `<div class="card"><div class="row between"><h2>${t('Tareas')}</h2><button class="primary" id="at">${t('+ Tarea')}</button></div>
    ${d.tasks.length ? d.tasks.map((x, i) => `<div class="task ${x.status} ${x.sel_late ? 'sel-late' : ''}" data-id="${x.id}"><div class="n">${x.status === 'hecho' ? '✓' : i + 1}</div>
      <div><div class="title">${esc(taskTitle(x.title))}${x.trade ? ` <span class="tr-chip">${esc(tradeLabel(x.trade))}</span>` : ''}${x.sel_wait ? ` <a class="sel-wait ${x.sel_late ? 'late' : ''}" href="#/obra/${id}/materiales" title="${esc(t('Espera que el cliente apruebe'))}">🎨 ${x.sel_late ? t('Detenida: falta que el cliente escoja') : t('Espera selección')}: ${esc(x.sel_wait.join(', '))}</a>` : ''}</div>
        <div class="meta">${[x.assignee_name && '👷 ' + esc(x.assignee_name), x.planned_date && t('Programada {d}', { d: dateRange(x) }), x.done_date && t('Hecha {d}', { d: fdate(x.done_date) })].filter(Boolean).join(' · ')}</div>
        ${x.notes ? `<div class="meta">📝 ${esc(x.notes)}</div>` : ''}${taskPhotos(d, x.id)}</div>
      <div class="actions"><select data-st aria-label="${t('Estado')}">${Object.entries(ST).map(([k, l]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="sm" data-ed title="${t('Editar')}">✎</button><button class="sm" data-ph title="${t('Agregar foto')}">📷</button>
        <button class="sm" data-rs title="${t('Reprogramar / avisar atraso')}">📅</button>
        <button class="sm" data-up title="${t('Subir')}">↑</button><button class="sm" data-dn title="${t('Bajar')}">↓</button><button class="sm danger" data-del title="${t('Borrar')}">✕</button></div></div>`).join('')
    : `<p class="empty">${t('Sin tareas. Agregue la primera.')}</p>`}</div>`;
  const taskFields = (x = {}) => [
    { name: 'title', label: t('Tarea'), required: true, value: x.title ? taskTitle(x.title) : '', full: true },
    { name: 'trade', label: t('Trade'), type: 'select', value: x.trade ?? '', options: [['', '—'], ...TRADES()] },
    { name: 'assignee_id', label: t('Quién la hace'), type: 'select', value: x.assignee_id ?? '', options: wopts, hint: x.id ? '' : t('Vacío: la app la asigna al crew de la obra que hace ese trade.') },
    { name: 'planned_date', label: t('Fecha programada'), type: 'date', value: x.planned_date },
    { name: 'planned_end', label: t('Hasta (si dura varios días)'), type: 'date', value: x.planned_end },
    ...(x.id ? [{ name: 'done_date', label: t('Fecha terminada'), type: 'date', value: x.done_date }] : []),
    { name: 'notes', label: t('Notas'), type: 'textarea', value: x.notes },
  ];
  $('#at').onclick = async () => { if (await formDialog({ title: t('Nueva tarea'), fields: taskFields(), onSubmit: v => api('POST', `/api/jobs/${id}/tasks`, v) })) reload(); };
  $$('.task', box).forEach(el => {
    const tid = Number(el.dataset.id), x = d.tasks.find(y => y.id === tid);
    $('[data-st]', el).onchange = e => setTaskStatus(tid, e.target.value, id).then(reload, reload);
    $('[data-up]', el).onclick = () => act(() => api('POST', `/api/tasks/${tid}/move`, { dir: 'up' })).then(reload);
    $('[data-dn]', el).onclick = () => act(() => api('POST', `/api/tasks/${tid}/move`, { dir: 'down' })).then(reload);
    $('[data-ph]', el).onclick = () => photoUploadDialog(id, d, tid, reload);
    $('[data-ed]', el).onclick = async () => {
      if (await formDialog({ title: t('Editar tarea'), fields: taskFields(x), onSubmit: v => {
        // Si no cambió el nombre de una tarea de plantilla, se guarda el original (así sigue traduciéndose).
        const title = v.title === taskTitle(x.title) ? x.title : v.title;
        return api('PUT', `/api/tasks/${tid}`, { ...v, title, assignee_id: v.assignee_id || null });
      } })) reload();
    };
    $('[data-rs]', el).onclick = () => rescheduleDialog({ ...x, job_id: d.job.id }, reload);
    $('[data-del]', el).onclick = async () => {
      if (await confirmDialog(t('¿Borrar la tarea “{x}” y sus fotos?', { x: taskTitle(x.title) }))) act(() => api('DELETE', `/api/tasks/${tid}`), t('Tarea borrada')).then(reload);
    };
  });
  bindPhotoViews(box);
}

function expenseFields(d, e = {}) {
  return [
    { name: 'date', label: t('Fecha'), type: 'date', required: true, value: e.date || today() },
    { name: 'amount_cents', label: t('Monto ($)'), type: 'money', required: true, value: centsToInput(e.amount_cents) },
    { name: 'category', label: t('Categoría'), type: 'select', value: e.category || 'material', options: CATS(e.category).filter(c => c.key !== 'subcontratistas' || !d.subs.length).map(c => [c.key, L(c)]),
      hint: d.subs.length ? t('Pagos a subcontratistas: regístrelos en la pestaña Subcontratistas') : '' },
    { name: 'description', label: t('Qué se compró'), required: true, value: e.description },
    { name: 'vendor', label: t('Dónde / a quién'), value: e.vendor, hint: t('Home Depot, Lowe’s, ciudad…') },
    { name: 'ticket', label: t('Número de ticket'), value: e.ticket || '', hint: t('Con el número, la app no deja registrar el mismo ticket dos veces') },
    { name: 'pay_method', label: t('Cómo se pagó'), type: 'select', value: e.pay_method || '', options: [['', '—'], ...vis(CAT.payMethods, e.pay_method).filter(p => p.key !== 'propio').map(p => [p.key, L(p)])] },
    { name: 'bought_by', label: t('Quién lo compró'), value: e.bought_by ?? ME.name },
    ...(e.id ? [] : [{ name: 'reimburse', label: t('¿Lo pagó con su propio dinero?'), type: 'select', value: 'no', options: [['no', t('No, con dinero de la empresa')], ['si', t('Sí, hay que reembolsarme')]] }]),
    { name: 'receipt', label: e.id ? t('Cambiar foto del recibo') : t('Foto del recibo'), type: 'photo', capture: true },
  ];
}
function tabExpenses(box, d, { id, reload }) {
  const g = tabExpenses.g || 'todo';
  const list = d.expenses.filter(e => inGroup(e, g)), shown = list.reduce((s, e) => s + e.amount_cents, 0);
  const byCat = CAT.categories.map(c => [c, list.filter(e => e.category === c.key).reduce((s, e) => s + e.amount_cents, 0)]).filter(x => x[1]);
  box.innerHTML = `<div class="card"><div class="row between"><h2>${t('Gastos')}</h2><div class="row"><button id="scanj">📷 ${t('Escanear tickets')}</button><button id="rcpj">🧾 ${t('Ticket')}</button><button class="primary" id="ae">${t('+ Gasto')}</button></div></div>
    ${d.expenses.length ? expGroupBar(d.expenses, g) + expGroupSummary(list, g) : ''}
    ${byCat.length > 1 ? `<div class="row small" style="margin:.5rem 0 1rem">${byCat.map(([c, v]) => `<span class="badge ${c.key === 'retrabajo' ? 'b-late' : 'b-pendiente'}">${esc(L(c))}: ${fmt0(v)}</span>`).join('')}</div>` : ''}
    ${list.length ? `<div class="table-wrap"><table class="exptable"><thead><tr><th>${t('Fecha')}</th><th>${t('Qué')}</th><th>${t('Categoría')}</th><th>${t('Compró')}</th><th class="num">${t('Monto')}</th><th></th></tr></thead><tbody>
      ${list.map(e => `<tr data-id="${e.id}"><td class="nowrap" data-l="${t('Fecha')}">${fdate(e.date)}</td><td class="what">${esc(e.description)}<div class="small muted">${esc(e.vendor)}${e.ticket ? ' #' + esc(e.ticket) : ''}${e.tax_cents ? ' · ' + t('impuesto {m}', { m: fmt(e.tax_cents) }) : ''}${e.sub_name ? ' · Sub: ' + esc(e.sub_name) : ''}</div></td>
        <td data-l="${t('Categoría')}">${esc(catLabel(e.category))}</td><td data-l="${t('Compró')}">${esc(e.bought_by)}${e.created_by_name && e.created_by_name !== e.bought_by ? `<div class="small muted">${t('registró {x}', { x: esc(e.created_by_name) })}</div>` : ''}</td>
        <td class="num" data-l="${t('Monto')}">${fmt(e.amount_cents)}</td>
        <td class="nowrap acts">${e.receipt_id ? `<button class="sm" data-view="${e.receipt_id}" title="${t('Ver recibo')}">🧾</button>` : ''}<button class="sm" data-ed>✎</button><button class="sm danger" data-del>✕</button></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4">${t('Total')}${g !== 'todo' ? ' · ' + esc(EXP_GROUPS().find(x => x[0] === g)[1]) : ''}</td><td class="num">${fmt(g === 'todo' ? d.money.spent : shown)}</td><td></td></tr></tfoot></table></div>`
    : `<p class="empty">${d.expenses.length ? t('No hay gastos de este tipo en la obra.') : t('Sin gastos registrados.')}</p>`}</div>`;
  $$('[data-grp]', box).forEach(b => { b.onclick = () => { tabExpenses.g = b.dataset.grp; tabExpenses(box, d, { id, reload }); }; });
  $('#scanj').onclick = () => scanFlow(id, reload);
  $('#rcpj').onclick = async () => { if (await receiptDialog({ jobId: id })) reload(); };
  $('#ae').onclick = async () => { if (await formDialog({ title: t('Nuevo gasto'), fields: expenseFields(d), onSubmit: v => api('POST', `/api/jobs/${id}/expenses`, v) })) { toast(t('Gasto guardado')); reload(); } };
  $$('tr[data-id]', box).forEach(tr => {
    const e = d.expenses.find(x => x.id === Number(tr.dataset.id));
    $('[data-ed]', tr).onclick = async () => {
      const fields = expenseFields(d, e).map(f => f.name === 'category' && e.sub_id ? { ...f, type: 'select', options: [['subcontratistas', catLabel('subcontratistas')]] } : f);
      if (await formDialog({ title: t('Editar gasto'), fields, onSubmit: v => api('PUT', `/api/expenses/${e.id}`, { ...v, sub_id: e.sub_id, receipt: v.receipt || undefined, _expect: { amount_cents: e.amount_cents, date: e.date } }) })) reload();
    };
    $('[data-del]', tr).onclick = async () => { if (await confirmDialog(t('¿Borrar el gasto “{x}” de {m}?', { x: e.description, m: fmt(e.amount_cents) }))) act(() => api('DELETE', `/api/expenses/${e.id}`), t('Borrado')).then(reload); };
  });
  bindPhotoViews(box);
}

async function tabSubs(box, d, { id, workers, reload }) {
  const wopts = [['', t('— sin acceso a la app —')], ...workers.map(w => [w.id, w.name])];
  box.innerHTML = `<div class="card"><div class="row between"><h2>${t('Subcontratistas y personal de esta obra')}</h2><button class="primary" id="as">${t('+ Agregar')}</button></div>
    <p class="small muted">${t('Registre lo acordado con cada persona y cada pago (parcial o completo, con forma de pago y fecha). Los pagos a un invoice no suman otro gasto: el invoice ya es gasto.')}</p>
    ${d.subs.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Nombre')}</th><th>${t('Qué hace')}</th><th class="num">${t('Acordado')}</th><th class="num">${t('Pagado')}</th><th class="num">${t('Le debemos')}</th><th></th></tr></thead><tbody>
      ${d.subs.map(s => `<tr data-id="${s.id}"><td><b>${esc(s.name)}</b>${s.user_name ? `<div class="small muted">${t('usuario: {x}', { x: esc(s.user_name) })}</div>` : ''}</td><td>${esc(s.trade)}${s.trades ? `<div class="tr-chips">${tradeChips(s.trades.split(','))}</div>` : ''}</td>
        <td class="num">${fmt(s.agreed_cents)}</td><td class="num">${fmt(s.paid_cents)}</td><td class="num ${s.agreed_cents - s.paid_cents < 0 ? 'neg' : ''}"><b>${fmt(s.agreed_cents - s.paid_cents)}</b></td>
        <td class="nowrap"><button class="sm primary" data-pay>${t('+ Pago')}</button> <button class="sm" data-ed>✎</button></td></tr>
        ${(s.payments || []).map(p => `<tr class="small paym" data-pid="${p.id}"><td></td><td colspan="2" class="muted">↳ ${fdate(p.date)} · <b>${esc(payLabel(p.method) || '—')}</b>${p.reference ? ' ' + esc(p.reference) : ''}${p.doc_number ? ` · Invoice ${esc(p.doc_number)}` : ''}${p.note ? ` · ${esc(p.note)}` : ''}</td><td class="num muted">${fmt(p.amount_cents)}</td><td></td><td><button class="sm danger" data-pdel title="${t('Borrar pago')}">✕</button></td></tr>`).join('')}`).join('')}
      </tbody><tfoot><tr><td colspan="2">${t('Total')}</td><td class="num">${fmt(d.money.subsAgreed)}</td><td class="num">${fmt(d.money.subsPaid)}</td><td class="num">${fmt(d.money.subsOwed)}</td><td></td></tr></tfoot></table></div>`
    : `<p class="empty">${t('Nadie registrado todavía.')}</p>`}</div>`;
  const subFields = (s = {}) => [
    { name: 'name', label: t('Nombre o empresa'), required: true, value: s.name },
    { name: 'trade', label: t('Qué hace'), value: s.trade, hint: t('Techo, electricidad, concreto…') },
    { name: 'agreed_cents', label: t('Total acordado ($)'), type: 'money', value: centsToInput(s.agreed_cents) },
    { name: 'user_id', label: t('Usuario en la app (opcional)'), type: 'select', value: s.user_id ?? '', options: wopts, hint: t('Si tiene usuario, verá esta obra y sus tareas (sin dinero)') },
    { name: 'trades', label: t('Trades que hace en esta obra'), type: 'checks', value: s.trades ? s.trades.split(',') : [], options: TRADES().filter(x => x[0] !== 'otro'), hint: s.id ? '' : t('Si lo deja vacío y tiene usuario, se usan los trades de su usuario.') },
    { name: 'notes', label: t('Notas'), type: 'textarea', value: s.notes },
  ];
  // Escoger un sub ya registrado (o su usuario) rellena nombre, qué hace, trades, usuario y notas. El monto es de cada obra.
  const fillSub = (dlg, k) => {
    if (!k) return;
    const set = (n, v) => { const el = $(`[name="${n}"]`, dlg); if (el && v != null && v !== '') el.value = v; };
    set('name', k.name); set('trade', k.trade); set('notes', k.notes);
    const u = $('[name="user_id"]', dlg); if (u) u.value = k.user_id ? String(k.user_id) : '';
    $$('[data-checks="trades"] input', dlg).forEach(c => { c.checked = (k.trades || []).includes(c.value); });
    const a = $('[name="agreed_cents"]', dlg); if (a && !a.value) a.focus();
  };
  const known = await api('GET', '/api/subs/known').catch(() => []);
  const pickField = known.length ? [{ name: 'pick', label: t('Escoger un sub ya registrado'), type: 'select', value: '', options: [['', t('— nuevo —')], ...known.map(k => [k.key, k.name + (k.trade ? ` · ${k.trade}` : '') + (k.jobs ? ` · ${k.jobs === 1 ? t('1 obra') : t('{n} obras', { n: k.jobs })}` : '')])], hint: t('Se rellena lo demás; solo escriba lo acordado en esta obra.') }] : [];
  const bindPick = dlg => {
    const p = $('[name="pick"]', dlg); if (p) p.onchange = () => fillSub(dlg, known.find(k => k.key === p.value));
    // Escoger solo el usuario también rellena lo que esté vacío.
    const u = $('[name="user_id"]', dlg); if (u) u.addEventListener('change', () => {
      const k = known.find(x => x.user_id === Number(u.value)); if (!k) return;
      const n = $('[name="name"]', dlg), tr = $('[name="trade"]', dlg);
      if (n && !n.value) n.value = k.name; if (tr && !tr.value) tr.value = k.trade;
      const boxes = $$('[data-checks="trades"] input', dlg); if (!boxes.some(c => c.checked)) boxes.forEach(c => { c.checked = k.trades.includes(c.value); });
    });
  };
  $('#as').onclick = async () => { if (await formDialog({ title: t('Agregar subcontratista / persona'), fields: [...pickField, ...subFields()], onOpen: bindPick, onSubmit: async ({ trades, pick, ...v }) => { const r = await api('POST', `/api/jobs/${id}/subs`, { ...v, user_id: v.user_id || null, ...(trades.length ? { trades } : {}) }); if (r && r.assigned) setTimeout(() => toast(t('Se le asignaron {n} tareas de sus trades', { n: r.assigned })), 300); } })) reload(); };
  $$('tr[data-pid]', box).forEach(tr => {
    $('[data-pdel]', tr).onclick = async () => { if (await confirmDialog(t('¿Borrar este pago? Si era pago al acuerdo, también se borra el gasto.'))) act(() => api('DELETE', `/api/sub-payments/${tr.dataset.pid}`), t('Borrado')).then(reload); };
  });
  $$('tr[data-id]', box).forEach(tr => {
    const s = d.subs.find(x => x.id === Number(tr.dataset.id));
    $('[data-ed]', tr).onclick = async () => { if (await formDialog({ title: t('Editar'), fields: subFields(s), onSubmit: v => api('PUT', `/api/subs/${s.id}`, { ...v, user_id: v.user_id || null, _expect: { agreed_cents: s.agreed_cents } }) })) reload(); };
    $('[data-pay]', tr).onclick = () => subPayDialog(s, { after: reload, suggest: tr._plan });
    if (ME.role === 'owner' && !ME.isPm) subPlanRow(tr, s, reload);
    if (false) $('[data-pay]', tr).onclick = async () => {
      const pend = (await api('GET', `/api/docs?job=${id}`)).filter(x => x.sub_id === s.id && x.type === 'invoice' && x.status === 'aprobado' && !x.paid_at);
      if (await formDialog({ title: t('Pago a {x}', { x: s.name }), submit: t('Registrar pago'),
        intro: pend.length ? `<div class="compare small">${t('Este sub tiene invoices aprobados sin pagar ({x}). Si este pago es por esos invoices, no lo registre aquí: ábralos y toque “Marcar pagado”, para no contar el gasto dos veces.', { x: pend.map(p => p.number + ' ' + fmt(p.total_cents)).join(', ') })}</div>` : '', fields: [
        { name: 'date', label: t('Fecha'), type: 'date', required: true, value: today() },
        { name: 'amount_cents', label: t('Monto ($)'), type: 'money', required: true, value: centsToInput(Math.max(0, s.agreed_cents - s.paid_cents)) },
        { name: 'description', label: t('Concepto'), required: true, value: t('Pago') + (s.trade ? ' — ' + s.trade : '') },
        { name: 'vendor', label: t('Forma de pago'), value: '', hint: t('Cheque #, Zelle, efectivo…') },
        { name: 'receipt', label: t('Foto del recibo / cheque'), type: 'photo' },
      ], onSubmit: v => api('POST', `/api/jobs/${id}/expenses`, { ...v, category: 'subcontratistas', sub_id: s.id, bought_by: ME.name }) })) { toast(t('Pago registrado')); reload(); }
    };
  });
}

function tabChanges(box, d, { id, reload }) {
  const CS = CO_STATUS(), owner = ME.role === 'owner', ST = CO_STATE();
  const ok = d.changes.filter(c => c.status === 'aprobado');
  const unpaid = ok.reduce((a, c) => a + Math.max(0, c.price_cents - (c.paid_cents || 0)) * (c.price_cents > 0 ? 1 : 0), 0);
  const wait = d.changes.filter(c => c.status === 'pendiente');
  box.innerHTML = `<div class="card"><div class="row between"><h2>${t('Change orders')}</h2><button class="primary" id="ac">${t('+ Change order')}</button></div>
    <p class="small muted">${t('Cada cambio o extra del cliente con su código (GAS-01, PERMIT-02…). Aprobado suma al contrato; facturado y cobrado se ven aquí. El trabajo hecho se marca aparte. El cliente ve el precio, nunca el costo.')}</p>
    <div class="money-strip small" style="margin:.6rem 0"><div><span>${t('Aprobados (suman al contrato)')}</span><b>${fmt(ok.reduce((a, c) => a + c.price_cents, 0))}</b></div><div><span>${t('Por cobrar de change orders')}</span><b class="${unpaid ? 'neg' : ''}">${fmt(unpaid)}</b></div><div><span>${t('Esperando al cliente')}</span><b>${wait.length} · ${fmt(wait.reduce((a, c) => a + c.price_cents, 0))}</b></div></div>
    ${d.changes.length ? `<div class="table-wrap"><table class="cotable"><thead><tr><th>${t('Código')}</th><th>${t('Qué cambió')}</th><th class="num">${t('Costo extra')}</th><th class="num">${t('Precio al cliente')}</th><th>${t('Estado')}</th><th>${t('Trabajo')}</th><th></th></tr></thead><tbody>
      ${d.changes.map(c => `<tr data-id="${c.id}"><td class="nowrap"><b class="code">${esc(c.code || '—')}</b><div class="small muted">${fdate(c.date)}</div></td><td>${esc(c.description)}</td><td class="num">${fmt(c.cost_cents)}</td><td class="num">${fmt(c.price_cents)}${c.paid_cents && c.state !== 'cobrado' ? `<div class="small muted">${t('cobrado {x}', { x: fmt(c.paid_cents) })}</div>` : ''}</td>
        <td>${c.invoice_number ? '' : `<select data-st style="width:auto;min-height:32px">${Object.entries(CS).map(([k, l]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
          ${c.status === 'aprobado' ? `<span class="badge ${(ST[c.state] || ST.aprobado)[1]}">${(ST[c.state] || ST.aprobado)[0]}</span>` : ''}${c.invoice_number ? `<div class="small muted">${esc(c.invoice_number)}${c.state !== 'cobrado' && c.due_date ? ' · ' + t('vence {d}', { d: fdate(c.due_date) }) : ''}</div>` : ''}</td>
        <td><label class="check small nowrap" title="${esc(t('El trabajo de este change order ya está hecho'))}"><input type="checkbox" data-done ${c.done_at ? 'checked' : ''} ${c.status === 'rechazado' ? 'disabled' : ''}> ${t('Hecho')}</label></td>
        <td class="nowrap">${owner && c.status === 'aprobado' && c.price_cents > 0 && !c.invoice_number && c.state !== 'cobrado' ? `<button class="sm primary" data-inv>${t('Facturar')}</button>` : ''}
          ${c.invoice_number ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/changes/${c.id}/pdf?lang=es">PDF</a><a class="btn sm" target="_blank" rel="noopener" href="/api/changes/${c.id}/pdf?lang=en">EN</a>${owner && c.state !== 'cobrado' ? `<button class="sm link" data-void>${t('Anular')}</button>` : ''}` : ''}
          <button class="sm" data-ed>✎</button>${c.invoice_number ? '' : '<button class="sm danger" data-del>✕</button>'}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="empty">${t('Sin cambios.')}</p>`}</div>`;
  const coFields = (c = {}) => [
    { name: 'category', label: t('Categoría (para el código)'), type: 'select', value: c.category || 'CO', options: CO_CATS().map(([k, l]) => [k, `${k} — ${l}`]) },
    { name: 'code', label: t('Código'), value: c.code || '', hint: c.id ? '' : t('Vacío = la app lo pone (ej. GAS-01). Puede escribir el suyo.') },
    { name: 'date', label: t('Fecha'), type: 'date', required: true, value: c.date || today() },
    { name: 'status', label: t('Estado'), type: 'select', value: c.status || 'pendiente', options: Object.entries(CS) },
    { name: 'description', label: t('Qué cambió'), type: 'textarea', required: true, value: c.description },
    { name: 'cost_cents', label: t('Costo extra para nosotros ($)'), type: 'money', value: centsToInput(c.cost_cents) },
    { name: 'price_cents', label: t('Precio extra al cliente ($)'), type: 'money', value: centsToInput(c.price_cents), hint: t('Negativo si es un crédito al cliente.') },
  ];
  const clean = (v, c) => { const o = { ...v }; if (c && c.code === v.code && c.category === v.category) delete o.category; if (!o.code) delete o.code; if (c && c.invoice_number) { delete o.status; delete o.price_cents; } return o; };
  $('#ac').onclick = async () => { let r; if (await formDialog({ title: t('Nuevo change order'), fields: coFields(), onSubmit: async v => { r = await api('POST', `/api/jobs/${id}/changes`, clean(v)); } })) { toast(t('Change order {x}', { x: r.code })); reload(); shareIfClient(r); } };
  $$('tr[data-id]', box).forEach(tr => {
    const c = d.changes.find(x => x.id === Number(tr.dataset.id));
    const st = $('[data-st]', tr); if (st) st.onchange = e => act(() => api('PUT', `/api/changes/${c.id}`, { status: e.target.value, _expect: { status: c.status, price_cents: c.price_cents } }), t('Actualizado')).then(r => { reload(); shareIfClient(r); }, reload);
    $('[data-done]', tr).onchange = e => act(() => api('POST', `/api/changes/${c.id}/done`, { done: e.target.checked }), e.target.checked ? t('Trabajo hecho') : t('Actualizado')).then(reload, reload);
    $('[data-ed]', tr).onclick = async () => { let r; if (await formDialog({ title: t('Editar change order {x}', { x: c.code }), fields: coFields(c), onSubmit: async v => { r = await api('PUT', `/api/changes/${c.id}`, { ...clean(v, c), _expect: { status: c.status, price_cents: c.price_cents } }); } })) { reload(); shareIfClient(r); } };
    const del = $('[data-del]', tr); if (del) del.onclick = async () => { if (await confirmDialog(t('¿Borrar este change order?'))) act(() => api('DELETE', `/api/changes/${c.id}`), t('Borrado')).then(reload); };
    const inv = $('[data-inv]', tr); if (inv) inv.onclick = () => coInvoiceDialog(c, reload);
    const vd = $('[data-void]', tr); if (vd) vd.onclick = async () => { if (!confirm(t('¿Anular el invoice {x}?', { x: c.invoice_number }))) return; await act(() => api('DELETE', `/api/changes/${c.id}/invoice`), t('Listo')); reload(); };
  });
}

function tabPayments(box, d, { id, reload }) {
  const cos = d.changes.filter(c => c.status === 'aprobado' && c.price_cents > 0 && c.state !== 'cobrado');
  const coName = idd => (d.changes.find(c => c.id === idd) || {}).code || '';
  box.innerHTML = `<div class="card"><div class="row between"><h2>${t('Pagos del cliente')}</h2><button class="primary" id="ap">${t('+ Pago recibido')}</button></div>
    <div class="money-strip" style="margin:.75rem 0"><div><span>${t('Contrato')}</span><b>${fmt(d.money.contract)}</b></div><div><span>${t('Cobrado')}</span><b>${fmt(d.money.paid)}</b></div><div><span>${t('Por cobrar')}</span><b>${fmt(d.money.balanceDue)}</b></div></div>
    ${d.payments.length ? `<table><thead><tr><th>${t('Fecha')}</th><th>${t('Forma')}</th><th>${t('Nota')}</th><th class="num">${t('Monto')}</th><th></th></tr></thead><tbody>
      ${d.payments.map(p => `<tr data-id="${p.id}"><td>${fdate(p.date)}</td><td>${esc(payLabel(p.method))}</td><td>${p.co_id ? `<span class="badge">→ ${esc(coName(p.co_id))}</span> ` : ''}${esc(p.note)}</td><td class="num">${fmt(p.amount_cents)}</td><td><button class="sm danger" data-del>✕</button></td></tr>`).join('')}
      </tbody></table>` : `<p class="empty">${t('Sin pagos registrados.')}</p>`}</div>`;
  $('#ap').onclick = async () => {
    if (await formDialog({ title: t('Pago recibido del cliente'), submit: t('Registrar'), fields: [
      { name: 'date', label: t('Fecha'), type: 'date', required: true, value: today() },
      { name: 'amount_cents', label: t('Monto ($)'), type: 'money', required: true },
      // Se guarda la palabra en español y se muestra traducida.
      { name: 'method', label: t('Forma de pago'), type: 'select', value: 'Cheque', options: ['Cheque', 'Zelle', 'Transferencia', 'Tarjeta', 'Efectivo', 'Financiamiento', 'Otro'].map(x => [x, t(x)]) },
      { name: 'note', label: t('Nota'), hint: t('Depósito inicial, cheque #1234…') },
      ...(cos.length ? [{ name: 'co_id', label: t('Aplicar a'), type: 'select', value: '', options: [['', t('Contrato (etapas en orden)')], ...cos.map(c => [String(c.id), `Change order ${c.code} — ${t('falta')} ${fmt(c.price_cents - (c.paid_cents || 0))}`])] }] : []),
    ], onSubmit: v => api('POST', `/api/jobs/${id}/payments`, { ...v, co_id: v.co_id ? Number(v.co_id) : null }) })) { toast(t('Pago registrado')); reload(); }
  };
  $$('tr[data-id]', box).forEach(tr => {
    $('[data-del]', tr).onclick = async () => { if (await confirmDialog(t('¿Borrar este pago?'))) act(() => api('DELETE', `/api/payments/${tr.dataset.id}`), t('Borrado')).then(reload); };
  });
}

function photoGrid(photos, d, canDelete, canTag) {
  if (!photos.length) return `<p class="empty">${t('Sin fotos todavía.')}</p>`;
  return `<div class="photos">${photos.map(p => { const x = d.tasks.find(y => y.id === p.task_id);
    return `<figure><img src="/files/${p.id}" data-view="${p.id}" alt="" loading="lazy">${canDelete(p) ? `<button class="del" data-delph="${p.id}" aria-label="${t('Borrar')}">✕</button>` : ''}
    <figcaption>${x || p.trade ? `<span class="ph-tags">${x ? `<span>${esc(taskTitle(x.title))}</span>` : ''}${p.trade ? `<span class="tr">${esc(tradeLabel(p.trade))}</span>` : ''}</span>` : ''}${p.caption ? esc(p.caption) + '<br>' : ''}${fdate(p.created_at.slice(0, 10))}${canTag ? ` · <a href="#" data-tagph="${p.id}">✎ ${t('Clasificar')}</a>` : ''}</figcaption></figure>`; }).join('')}</div>`;
}
function tabPhotos(box, d, { id, reload }) {
  const f = tabPhotos.f || (tabPhotos.f = { stage: '', trade: '' });
  const usedStages = [...new Set(d.photos.map(p => p.task_id).filter(Boolean))], usedTrades = [...new Set(d.photos.map(p => p.trade).filter(Boolean))];
  const shown = d.photos.filter(p => (!f.stage || String(p.task_id || '') === f.stage || (f.stage === 'none' && !p.task_id)) && (!f.trade || (p.trade || 'none') === f.trade));
  box.innerHTML = `<div class="card"><div class="row between"><h2>${t('Fotos de avance')}</h2><button class="primary" id="aph">${t('+ Fotos')}</button></div>
    <p class="small muted">${t('El cliente ve estas fotos en su portal. Cada foto lleva su etapa y su trade.')}</p>
    ${d.photos.length ? `<div class="row wrap photo-filter"><select id="fst"><option value="">${t('Todas las etapas')}</option>${d.tasks.filter(x => usedStages.includes(x.id)).map(x => `<option value="${x.id}" ${f.stage === String(x.id) ? 'selected' : ''}>${esc(taskTitle(x.title))}</option>`).join('')}<option value="none" ${f.stage === 'none' ? 'selected' : ''}>${t('— general —')}</option></select>
      <select id="ftr"><option value="">${t('Todos los trades')}</option>${TRADES().filter(([k]) => usedTrades.includes(k)).map(([k, l]) => `<option value="${k}" ${f.trade === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}<option value="none" ${f.trade === 'none' ? 'selected' : ''}>${t('Sin trade')}</option></select>
      <span class="small muted">${t('{n} fotos', { n: shown.length })}</span></div>` : ''}
    ${photoGrid(shown, d, () => true, true)}</div>`;
  $('#aph').onclick = () => photoUploadDialog(id, d, null, reload);
  if ($('#fst', box)) { $('#fst', box).onchange = e => { f.stage = e.target.value; tabPhotos(box, d, { id, reload }); }; $('#ftr', box).onchange = e => { f.trade = e.target.value; tabPhotos(box, d, { id, reload }); }; }
  $$('[data-tagph]', box).forEach(b => { b.onclick = async e => { e.preventDefault();
    const p = d.photos.find(x => x.id === b.dataset.tagph);
    if (await formDialog({ title: t('Clasificar foto'), fields: [
      { name: 'task_id', label: t('Etapa'), type: 'select', value: p.task_id || '', options: [['', t('— general —')], ...d.tasks.map(x => [x.id, taskTitle(x.title)])] },
      { name: 'trade', label: t('Trade'), type: 'select', value: p.trade || '', options: [['', '—'], ...TRADES()] },
      { name: 'caption', label: t('Comentario'), value: p.caption || '' }],
      onSubmit: v => api('PUT', `/api/files/${p.id}/tag`, { task_id: v.task_id || null, trade: v.trade, caption: v.caption }) })) { toast(t('Guardado')); reload(); }
  }; });
  bindPhotoViews(box);
  $$('[data-delph]', box).forEach(b => { b.onclick = async e => { e.stopPropagation(); if (await confirmDialog(t('¿Borrar esta foto?'))) act(() => api('DELETE', `/api/files/${b.dataset.delph}`), t('Borrada')).then(reload); }; });
}

function tabData(box, d, { id, users, reload }) {
  const j = d.job, clients = users.filter(u => u.role === 'client' && u.active);
  box.innerHTML = `<div class="grid two">
    <div class="card"><h2>${t('Datos')}</h2><table><tbody>
      <tr><th>${t('Teléfono')}</th><td>${j.client_phone ? `<a href="tel:${esc(j.client_phone)}">${esc(j.client_phone)}</a> · <a href="#/textos/${encodeURIComponent(smsPhone(j.client_phone))}">💬 ${t('Textos')}</a>` : '—'}</td></tr>
      <tr><th>${t('Email')}</th><td>${j.client_email ? `<a href="mailto:${esc(j.client_email)}">${esc(j.client_email)}</a>` : '—'}</td></tr>
      <tr><th>${t('Dirección')}</th><td>${j.address ? `<a target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(j.address)}">${esc(j.address)}</a>` : '—'}</td></tr>
      <tr><th>${t('Nos encontró por')}</th><td>${esc(j.lead_source) || '—'}</td></tr>
      <tr><th>${t('Fechas')}</th><td>${fdate(j.start_date) || '?'} → ${fdate(j.end_date) || '?'}</td></tr>
      <tr><th>${t('Terminada')}</th><td>${fdate(j.completed_date) || '—'}</td></tr>
      <tr><th>${t('Garantía hasta')}</th><td>${fdate(j.warranty_until) || t('— (al marcar terminada)')}</td></tr>
      <tr><th>${t('Qué se hace')}</th><td style="white-space:pre-wrap">${esc(j.description) || '—'}</td></tr>
      <tr><th>${t('Notas internas')}</th><td style="white-space:pre-wrap">${esc(j.notes) || '—'}</td></tr></tbody></table></div>
    <div class="card"><h2>${t('Acceso del cliente')}</h2>
      <p class="small muted">${t('El cliente entra con su usuario y ve solo esta obra: avance, fotos, precio y sus pagos. Nunca ve costos ni ganancia.')}</p>
      <div class="field"><label for="cu">${t('Usuario del cliente')}</label><select id="cu"><option value="">${t('— sin acceso —')}</option>
        ${clients.map(c => `<option value="${c.id}" ${c.id === j.client_user_id ? 'selected' : ''}>${esc(c.name)} (${esc(c.username)})</option>`).join('')}</select>
        <div class="hint">${t('Cree el usuario del cliente en “Equipo y accesos” con el rol Cliente.')}</div></div>
      <button class="primary" id="savecu">${t('Guardar acceso')}</button>
      <hr style="margin:1.5rem 0;border:0;border-top:1px solid var(--line)">
      <h3>${t('Borrar obra')}</h3><p class="small muted">${t('Borra la obra con todos sus gastos, pagos, tareas y fotos. No se puede deshacer (salvo con un respaldo).')}</p>
      <button class="danger" id="delj">${t('Borrar esta obra…')}</button></div></div>`;
  const ub = document.createElement('div'); box.appendChild(ub);
  clientUpdatesCard(ub, id);
  $('#savecu').onclick = () => act(() => api('PUT', `/api/jobs/${id}`, { client_user_id: $('#cu').value || null }), t('Acceso guardado')).then(reload);
  $('#delj').onclick = async () => {
    if (await formDialog({ title: t('Borrar obra'), danger: true, submit: t('Borrar para siempre'), fields: [{ name: 'confirm', label: t('Escriba el nombre del cliente: {x}', { x: j.client_name }), required: true, full: true }],
      onSubmit: v => api('DELETE', `/api/jobs/${id}`, v) })) { toast(t('Obra borrada')); location.hash = '#/obras'; }
  };
}

// ================= DUEÑO: gastos de todas las obras =================
// Gastos separados en grupos: materiales, subs y trabajadores, y lo demás.
const EXP_GROUPS = () => [
  ['todo', t('Todo'), null],
  ['material', '🧱 ' + t('Materiales'), ['material']],
  ['gente', '👷 ' + t('Subs y trabajadores'), ['subcontratistas', 'mano_obra']],
  ['otros', '📋 ' + t('Otros gastos'), null],
];
const expGroup = cat => (cat === 'material' ? 'material' : ['subcontratistas', 'mano_obra'].includes(cat) ? 'gente' : 'otros');
const inGroup = (e, g) => !g || g === 'todo' || expGroup(e.category) === g;
function expGroupBar(rows, sel) {
  return `<div class="expgrp" role="group" aria-label="${t('Ver gastos de')}">${EXP_GROUPS().map(([k, l]) => { const r = rows.filter(e => inGroup(e, k));
    return `<button type="button" data-grp="${k}" class="${k === sel ? 'on' : ''}" aria-pressed="${k === sel}"><span>${l}</span><b>${fmt0(r.reduce((s, e) => s + e.amount_cents, 0))}</b><small>${t('{n} gastos', { n: r.length })}</small></button>`; }).join('')}</div>`;
}
// Resumen del grupo: por persona (subs y trabajadores) o por tienda (materiales).
function expGroupSummary(rows, g) {
  if (g !== 'gente' && g !== 'material') return '';
  const PAY = /zelle|cheque|check|efectivo|cash|transfer|venmo|tarjeta|card|paypal/i;
  const person = e => { if (e.sub_name) return e.sub_name;
    const h = /^(?:Horas|Tiempo extra|Hours|Overtime):\s*(.+)\s+\([\d.]+\s*h\b/.exec(e.description || ''); if (h) return h[1];
    if (e.category === 'mano_obra') return e.bought_by || e.created_by_name || e.description;
    return e.vendor && !PAY.test(e.vendor) ? e.vendor : (e.description || '—'); };
  const key = e => (g === 'gente' ? person(e) : (e.vendor || '—'));
  const m = new Map(); rows.forEach(e => { const k = key(e); const x = m.get(k) || { n: 0, c: 0, h: 0 }; x.n++; x.c += e.amount_cents; if (e.category === 'mano_obra') x.h++; m.set(k, x); });
  const list = [...m.entries()].sort((a, b) => b[1].c - a[1].c);
  if (!list.length) return '';
  return `<div class="expsum"><b class="small">${g === 'gente' ? t('Por persona') : t('Por tienda')}</b>${list.map(([k, x]) => `<span class="pchip">${esc(k)}${g === 'gente' && x.h ? ' ⏱' : ''} · <b>${fmt0(x.c)}</b></span>`).join('')}
    ${g === 'gente' ? `<span class="small muted">${t('⏱ = trabajador por hora')}</span>` : ''}</div>`;
}

async function viewExpenses(app) {
  const OWN = (ME.role === 'owner' && !ME.is_agent) || OFFICE();
  const modes = officeModes();
  const mode = OWN ? (modes.includes(viewExpenses.mode) ? viewExpenses.mode : modes[0]) : 'obras';
  if (mode !== 'obras') return viewCompanyMoney(app, mode);
  const f = viewExpenses.f || { from: today().slice(0, 4) + '-01-01', to: today(), category: '' };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const all = await api('GET', '/api/expenses?' + qs);
  const g = viewExpenses.g || 'todo';
  const rows = all.filter(e => inGroup(e, g));
  const total = rows.reduce((s, e) => s + e.amount_cents, 0);
  app.innerHTML = `${expensesHead(OWN, 'obras')}
  <div class="card"><div class="fields" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
    <div class="field"><label>${t('Desde')}</label><input type="date" id="ef" value="${f.from}"></div>
    <div class="field"><label>${t('Hasta')}</label><input type="date" id="et" value="${f.to}"></div>
    <div class="field"><label>${t('Categoría')}</label><select id="ec"><option value="">${t('Todas')}</option>${CATS().map(c => `<option value="${c.key}" ${c.key === f.category ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}</select></div>
    <div class="field"><label>&nbsp;</label><button id="csv">${t('Descargar para Excel (CSV)')}</button></div></div>
    ${expGroupBar(all, g)}${expGroupSummary(rows, g)}
    <p>${t('{n} gastos · Total {m}', { n: `<b>${rows.length}</b>`, m: `<b>${fmt(total)}</b>` })}</p>
    ${rows.length ? `<div class="table-wrap"><table class="exptable"><thead><tr><th>${t('Fecha')}</th><th>${t('Obra')}</th><th>${t('Qué')}</th><th>${t('Categoría')}</th><th>${t('Compró')}</th><th class="num">${t('Monto')}</th></tr></thead><tbody>
      ${rows.map(e => `<tr class="click" data-go="#/obra/${e.job_id}/gastos"><td class="nowrap" data-l="${t('Fecha')}">${fdate(e.date)}</td><td data-l="${t('Obra')}">${esc(e.client_name)}</td><td class="what">${esc(e.description)}<div class="small muted">${esc(e.vendor)}${e.sub_name ? ' · ' + esc(e.sub_name) : ''}</div></td><td data-l="${t('Categoría')}">${esc(catLabel(e.category))}</td><td data-l="${t('Compró')}">${esc(e.bought_by)}</td><td class="num" data-l="${t('Monto')}">${fmt(e.amount_cents)}</td></tr>`).join('')}
    </tbody></table></div>` : `<p class="empty">${t('No hay gastos en este rango.')}</p>`}</div>`;
  bindExpensesHead(app); officeTrim(app);
  const upd = () => { viewExpenses.f = { from: $('#ef').value, to: $('#et').value, category: $('#ec').value }; viewExpenses(app); };
  ['#ef', '#et', '#ec'].forEach(s => { $(s).onchange = upd; });
  $$('[data-grp]', app).forEach(b => { b.onclick = () => { viewExpenses.g = b.dataset.grp; viewExpenses(app); }; });
  if (!OFFICE()) $$('[data-go]', app).forEach(r => { r.onclick = () => { location.hash = r.dataset.go; }; });
  $('#csv').onclick = () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = [t('Fecha'), t('Obra'), t('Qué se compró'), t('Dónde / a quién'), t('Categoría'), t('Quién lo compró'), t('Subcontratista'), t('Monto')];
    const lines = [head.map(q).join(',')]
      .concat(rows.map(e => [e.date, q(e.client_name), q(e.description), q(e.vendor), q(catLabel(e.category)), q(e.bought_by), q(e.sub_name), (e.amount_cents / 100).toFixed(2)].join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
    a.download = `${t('gastos')}${g !== 'todo' ? '-' + g : ''}-${f.from}-${f.to}.csv`; a.click();
  };
}

// ================= DUEÑO: equipo y accesos =================
// Crear usuario: la app inventa la contraseña temporal y enseña el mensaje para mandarle el acceso.
async function newUserDialog(pre = {}) {
  const R = ROLE(), langOpts = [['es', 'Español'], ['en', 'English']];
  let made = null;
  await formDialog({ title: t('Nuevo usuario'), submit: t('Crear y mandar acceso'), intro: pre.intro || '', fields: [
      { name: 'role', label: t('Rol'), type: 'select', value: pre.role || 'worker', options: Object.entries(R) },
      { name: 'lang', label: t('Idioma inicial'), type: 'select', value: pre.lang || 'es', options: langOpts, hint: t('La persona lo puede cambiar después con el botón ES | EN') },
      { name: 'name', label: t('Nombre'), required: true, value: pre.name || '' },
      { name: 'username', label: t('Usuario (para entrar)'), required: true, value: pre.username || '', hint: t('Ej. pedro.g — sin espacios. La contraseña la inventa la app y la persona pone la suya al entrar.') },
      { name: 'phone', label: t('Teléfono'), type: 'tel', value: pre.phone || '', hint: t('Para mandarle su acceso por texto o WhatsApp') },
      { name: 'trade', label: t('Oficio / empresa'), hint: t('Solo para trabajadores y subs') },
      { name: 'trades', label: t('Trades que hace (puede ser más de uno)'), type: 'checks', value: pre.trades || [], options: TRADES().filter(x => x[0] !== 'otro'), hint: t('Al poner una plantilla, la app le asigna sola las tareas de esos trades en las obras donde esté.') },
      { name: 'pay_type', label: t('Si es trabajador: cómo se le paga'), type: 'select', value: 'sub', options: [['sub', t('Como sub (precio por trabajo)')], ['hora', t('Por hora')]] },
      { name: 'rate_cents', label: t('Si es por hora: pago por hora ($)'), type: 'money', hint: t('Solo lo ven los dueños') },
      { name: 'pm_limit_cents', label: t('Si es project manager: límite por gasto ($)'), type: 'money', value: '500', hint: t('Arriba de esto, el gasto lo autoriza un dueño') },
      { name: 'pm_month_cents', label: t('Si es project manager: límite al mes ($)'), type: 'money', value: '5000' },
      { name: 'tool_ventas', label: t('Prender herramienta de Ventas (agenda, citas, estimados)'), type: 'check', hint: t('Los vendedores ya la traen') },
    ], onSubmit: async v => { const { tool_ventas, ...b } = v; if (b.role !== 'worker') { delete b.pay_type; delete b.rate_cents; } else if (b.pay_type === 'hora' && !Number(String(b.rate_cents || '').replace(/[^0-9.]/g, ''))) throw new Error(t('Ponga el pago por hora')); if (b.role !== 'worker') delete b.trades; made = await api('POST', '/api/users', { ...b, request_id: pre.request_id || undefined, tools: tool_ventas && !['sales', 'worker', 'client'].includes(b.role) ? ['ventas'] : [] }); } });
  if (made) { toast(t('Usuario creado')); await showTempAccess({ user: made, temp: made.temp, invite: true }); }
  return made;
}

async function viewUsers(app) {
  const users = await api('GET', '/api/users');
  const R = ROLE();
  app.innerHTML = `<div class="row between"><h1>${t('Equipo y accesos')}</h1><button class="primary" id="nu">${t('+ Usuario')}</button></div>
    <div class="card small muted">${t('<b>Administración:</b> la oficina. Escanea y registra tickets y gastos de la compañía. No ve precios, ganancias ni pagos de las obras, y no borra nada.')} ${t('<b>Contadora (solo ver):</b> ve y baja gastos, tickets, ganancias y el reporte 1099. No puede cambiar nada.')}</div>
    <div class="card small muted">${t('<b>Vendedor:</b> su agenda, sus citas con clientes nuevos y el seguimiento de sus estimados. Ve el monto de sus estimados, nunca costos ni ganancias.')} ${t('<b>Herramientas extra:</b> a cualquier dueño o project manager se le puede prender Ventas para que tenga también su agenda y sus estimados.')}</div>
    <div class="card small muted">${t('<b>Project manager:</b> maneja solo las obras que le asignen; registra y organiza, pero pagos, precios, change orders y cambios de dinero los autoriza un dueño.')} · ${t('<b>Dueño:</b> control total. · <b>Trabajador / Sub:</b> ve solo las obras donde tiene tareas asignadas (o está en Subcontratistas), marca avance, sube fotos y registra compras; nunca ve dinero. · <b>Cliente:</b> ve solo su obra (avance, fotos, precio y sus pagos). · Cada persona puede cambiar el idioma (ES/EN) cuando quiera.')}</div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>${t('Nombre')}</th><th>${t('Usuario')}</th><th>${t('Rol')}</th><th>${t('Idioma')}</th><th>${t('Teléfono')}</th><th>${t('Estado')}</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr data-id="${u.id}"><td><b>${esc(u.name)}</b>${u.trade ? `<div class="small muted">${esc(u.trade)}</div>` : ''}${(u.trades || []).length ? `<div class="tr-chips">${tradeChips(u.trades)}</div>` : ''}</td><td>${esc(u.username)}</td><td>${R[u.role]}${(u.tools || []).map(k => ` <span class="badge b-en_progreso">${esc(({ ventas: t('Ventas'), cuadrilla: t('Encargado de cuadrilla'), gastos_obras: t('Gastos de obras'), reparto: t('Reparto') })[k] || k)}</span>`).join('')}${u.pm_all ? ` <span class="badge b-en_progreso">${t('Todas las obras')}</span>` : ''}${u.mfa ? ` <span class="badge b-hecho">${t('2 pasos')}</span>` : ''}</td>
        <td>${u.lang === 'en' ? 'English' : 'Español'}</td><td>${esc(u.phone)}</td><td>${u.active ? `<span class="badge b-hecho">${t('Activo')}</span>` : `<span class="badge b-cancelado">${t('Sin acceso')}</span>`}</td><td><button class="sm" data-ed>✎</button></td></tr>`).join('')}
    </tbody></table></div></div>${rolesMatrixCard()}`;
  const langOpts = [['es', 'Español'], ['en', 'English']];
  $('#nu').onclick = async () => { if (await newUserDialog()) viewUsers(app); };
  $$('tr[data-id]', app).forEach(tr => {
    const u = users.find(x => x.id === Number(tr.dataset.id));
    $('[data-ed]', tr).onclick = async () => {
      if (await formDialog({ title: t('Editar {x}', { x: u.name }), extraButton: u.id !== ME.id && u.active ? { label: '🔑 ' + t('Contraseña temporal'), onClick: async () => { const r = await api('POST', `/api/users/${u.id}/temp-password`); await showTempAccess(r); } } : null, fields: [
        { name: 'name', label: t('Nombre'), required: true, value: u.name },
        { name: 'lang', label: t('Idioma'), type: 'select', value: u.lang || 'es', options: langOpts },
        { name: 'phone', label: t('Teléfono'), type: 'tel', value: u.phone },
        { name: 'trade', label: t('Oficio / empresa'), value: u.trade },
        ...(u.role === 'worker' ? [{ name: 'trades', label: t('Trades que hace (puede ser más de uno)'), type: 'checks', value: u.trades || [], options: TRADES().filter(x => x[0] !== 'otro') }] : []),
        { name: 'active', label: t('Acceso'), type: 'select', value: u.active ? '1' : '0', options: [['1', t('Activo')], ['0', t('Sin acceso (bloqueado)')]] },
        { name: 'password', label: t('Nueva contraseña (dejar vacío para no cambiar)'), type: 'password' },
        ...(u.role === 'pm' ? [{ name: 'pm_limit_cents', label: t('Límite por gasto ($)'), type: 'money', value: centsToInput(u.pm_limit_cents), hint: t('Arriba de esto, el gasto lo autoriza un dueño') },
          { name: 'pm_month_cents', label: t('Límite al mes ($)'), type: 'money', value: centsToInput(u.pm_month_cents) }] : []),
        ...(u.role === 'worker' && users.some(x => x.role === 'pm') ? [{ name: 'related_pm_id', label: t('¿Es familiar o socio de un project manager?'), type: 'select', value: u.related_pm_id ?? '', options: [['', t('No')], ...users.filter(x => x.role === 'pm').map(x => [x.id, x.name])],
          hint: t('Si sí, ese PM no podrá aprobar nada de esta persona: lo autoriza un dueño.') }] : []),
        ...Object.keys(PERM_ROLES).filter(k => PERM_ROLES[k].includes(u.role)).map(k => ({ name: 'perm_' + k, label: '🔸 ' + PERM_LABEL()[k], type: 'check', value: (u.tools || []).includes(k) })),
        ...(u.role === 'pm' ? [{ name: 'pm_all', label: '🔸 ' + t('Ve y maneja todas las obras (no solo las suyas)'), type: 'check', value: !!u.pm_all }] : []),
        ...(u.mfa && u.id !== ME.id ? [{ name: 'resetMfa', label: t('Código de 2 pasos'), type: 'select', value: '', options: [['', t('Mantener')], ['1', t('Quitar (perdió el teléfono)')]] }] : []),
      ], onSubmit: v0 => { const perms = Object.keys(v0).filter(k => k.startsWith('perm_')); const v = Object.fromEntries(Object.entries(v0).filter(([k]) => !k.startsWith('perm_'))); return api('PUT', `/api/users/${u.id}`, { ...v, ...(perms.length ? { tools: perms.filter(k => v0[k]).map(k => k.slice(5)) } : {}), ...(u.role === 'pm' ? { pm_all: !!v0.pm_all } : {}), active: v.active === '1', password: v.password || undefined, resetMfa: v.resetMfa === '1', ...('related_pm_id' in v ? { related_pm_id: v.related_pm_id || null } : {}) }); } })) {
        if (u.id === ME.id) { boot(); return; }
        toast(t('Guardado')); viewUsers(app);
      }
    };
  });
}

// ================= cuenta (todos) =================
async function viewAccount(app) {
  ME = (await api('GET', '/api/status')).user;
  app.innerHTML = `<h1>${t('Mi cuenta')}</h1><div class="grid two">
    ${ME.role === 'sales' ? `<div class="card"><h2>🏛️ ${t('Inspecciones de la ciudad')}</h2><p class="small muted">${t('Si su ciudad pide una inspección que no está aquí, agréguela. Después sale en la pregunta de cada obra, en su lugar entre los trades.')}</p><a class="btn" href="#/inspecciones">${t('Lista de inspecciones')}</a></div>` : ''}
    <div class="card"><h2>${t('Idioma')}</h2><p class="small muted">${t('Se guarda en su usuario: la app se abrirá en este idioma en cualquier computadora o teléfono.')}</p>
      <div class="row"><button class="${LANG === 'es' ? 'primary' : ''}" data-setlang="es">Español</button><button class="${LANG === 'en' ? 'primary' : ''}" data-setlang="en">English</button></div></div>
    <form class="card" id="pwf"><h2>${t('Cambiar contraseña')}</h2><div class="error" id="pwe"></div>
      <div class="field"><label>${t('Contraseña actual')}</label><input type="password" id="pc" autocomplete="current-password" required></div>
      <div class="field"><label>${t('Nueva contraseña (mínimo 10)')}</label><input type="password" id="pn" autocomplete="new-password" required></div>
      <button class="primary">${t('Guardar')}</button></form>
    <div class="card"><h2>${t('Entrada en 2 pasos')}</h2><p>${ME.mfa ? `<span class="badge b-hecho">${t('Activada')}</span>` : `<span class="badge b-pendiente">${t('No activada')}</span>`}</p>
      <p class="small muted">${t('Además de la contraseña, pide un código de 6 dígitos de una app autenticadora (Google Authenticator, Authy). Recomendado para los dueños.')}</p>
      <div id="mfabox"><button class="${ME.mfa ? 'danger' : 'primary'}" id="mfab">${ME.mfa ? t('Desactivar') : t('Activar')}</button></div></div>
    ${ME.role === 'owner' && !ME.isPm ? '<div id="secbox"></div>' : ''}</div>`;
  if ($('#secbox')) securityCard($('#secbox')).catch(e => console.error(e));
  $$('[data-setlang]', app).forEach(b => { b.onclick = () => setLang(b.dataset.setlang); });
  $('#pwf').onsubmit = async e => {
    e.preventDefault();
    try { await api('POST', '/api/me/password', { current: $('#pc').value, password: $('#pn').value }); toast(t('Contraseña cambiada. Se cerró su sesión en los demás teléfonos y computadoras.')); $('#pwf').reset(); $('#pwe').textContent = ''; }
    catch (err) { $('#pwe').textContent = err.message; }
  };
  $('#mfab').onclick = async () => {
    if (ME.mfa) {
      if (await formDialog({ title: t('Desactivar entrada en 2 pasos'), danger: true, submit: t('Desactivar'), fields: [{ name: 'password', label: t('Contraseña actual'), type: 'password', required: true }],
        onSubmit: v => api('POST', '/api/me/mfa/disable', v) })) viewAccount(app);
      return;
    }
    const s = await api('POST', '/api/me/mfa/start');
    $('#mfabox').innerHTML = `<ol class="small"><li>${t('Abra la app autenticadora → Agregar → “Ingresar clave de configuración”.')}</li>
      <li>${t('Cuenta')}: <b>${esc(COMPANY.name)}</b> · ${t('Clave')}:<br><code style="font-size:1.05rem;letter-spacing:.08em;word-break:break-all">${esc(s.secret.match(/.{1,4}/g).join(' '))}</code></li>
      <li>${t('Escriba el código de 6 dígitos que aparece:')}</li></ol>
      <div class="row"><input id="mc" inputmode="numeric" maxlength="6" style="width:9rem" autocomplete="one-time-code"><button class="primary" id="mok">${t('Activar')}</button></div><div class="error" id="me"></div>`;
    $('#mok').onclick = async () => {
      try { await api('POST', '/api/me/mfa/confirm', { code: $('#mc').value.trim() }); toast(t('Activada')); viewAccount(app); }
      catch (err) { $('#me').textContent = err.message; }
    };
  };
  await pushCard(app);
  if (ME.role === 'owner') { await settingsCard(app); if (!ME.isPm) await rulesCard(app).catch(e => console.error(e)); await lockCard(app); }
  const ib = document.createElement('div'); ib.className = 'card mobile-only';
  ib.innerHTML = `<h2>${t('App en su teléfono')}</h2><p class="small muted">${isStandalone() ? '✓ ' + t('Está usando la app instalada.') : t('Instálela para abrirla con un toque desde su pantalla de inicio.')}</p>
    <div class="row">${isStandalone() ? '' : `<button class="primary" id="inst">${t('Instalar la app')}</button>`}<button id="out">${t('Cerrar sesión')}</button></div>`;
  app.appendChild(ib);
  if ($('#inst')) $('#inst').onclick = () => showInstall(true);
  $('#out').onclick = logout;
  if (ME.role === 'owner') {
    const ai = await api('GET', '/api/scans/status').catch(() => ({ ai: false }));
    const sc = document.createElement('div'); sc.className = 'card';
    sc.innerHTML = `<h2>📷 ${t('Lectura automática de tickets')}</h2><p>${ai.ai ? `<span class="badge b-hecho">${t('Activada')}</span>` : `<span class="badge b-pendiente">${t('No configurada')}</span>`}</p>
      <p class="small muted">${ai.ai ? t('Los tickets se leen solos (tienda, fecha, total), se archivan en la obra correcta y en su partida cuando la app está segura. Lee con: {x}.', { x: ai.provider === 'grok' ? 'Grok (xAI)' : 'Claude' }) : t('Sin la lectura automática, el escaneo guarda la foto y usted llena el monto con un toque. Para activarla, ponga ANTHROPIC_API_KEY (Claude) o XAI_API_KEY (Grok) en Render → Environment.')}</p>`;
    app.appendChild(sc);
    const tc = document.createElement('div'); tc.className = 'card';
    const trOn = !!ai.ai;
    tc.innerHTML = `<h2>🌐 ${t('Traducción automática')}</h2><p>${trOn ? `<span class="badge b-hecho">${t('Activada')}</span>` : `<span class="badge b-pendiente">${t('No configurada')}</span>`}</p>
      <p class="small muted">${trOn ? t('Lo que escribe cada persona (casos, avisos de atraso, notas del día, novedades y reportes al cliente, textos) se traduce solo al idioma de quien lo lee. Siempre puede tocar “Ver original”.') : t('Usa la misma clave que la lectura de tickets. Sin ella, cada quien lee los mensajes en el idioma en que se escribieron.')}</p>`;
    app.appendChild(tc);
    await modulesCard(app);
    await smsSettingsCard(app);
    await driveSettingsCard(app);
    const b = document.createElement('div'); b.className = 'card';
    b.innerHTML = `<h2>${t('Respaldo')}</h2><p class="small muted">${t('La app guarda una copia automática cada día (últimos 14 días) en la carpeta datos/backups. Aquí puede descargar una copia ahora para guardarla en otro lugar (USB, Google Drive). Las fotos están en datos/files.')}</p>
      <a class="btn primary" href="/api/backup">${t('Descargar respaldo de la base de datos')}</a>`;
    app.appendChild(b);
  }
}

// ================= TRABAJADOR =================
// v2.31.1: iconos de línea (propios, estilo moderno: trazo 2, puntas redondeadas). Se pintan con currentColor.
const IC = {
  ticket: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  alert: '<path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.5h.01"/>',
  wallet: '<path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6"/><path d="M17 14h.01"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>',
  send: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 15h6M13 12.5l2.5 2.5-2.5 2.5"/>',
  estimate: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 12h6M9 16h4"/>',
  bag: '<path d="M6 7h12l1 13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
  notebook: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12 8h4M12 12h4"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  hardhat: '<path d="M3 17h18v2H3z"/><path d="M5 17a7 7 0 0 1 14 0"/><path d="M10 10V6h4v4"/>',
  tasks: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9.5 1.5 1.5L11 8.5M7 15l1.5 1.5L11 14M14 10h3M14 15.5h3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
};
const ico = (k, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || ''}</svg>`;
// v2.31: pantalla del sub, sencilla. Botones grandes con dibujo y pocas palabras.
const NOW_ST = ['activo'], LATER_ST = ['prospecto', 'cotizado'];
function bigTiles(list) {
  return `<div class="tiles">${list.map(x => x.href ? `<a class="tile ${x.cls || ''}" href="${x.href}"><span class="ti">${ico(x.ic)}</span><span class="tl">${esc(x.label)}</span></a>`
    : `<button type="button" class="tile ${x.cls || ''}" data-tile="${x.k}"><span class="ti">${ico(x.ic)}</span><span class="tl">${esc(x.label)}</span></button>`).join('')}</div>`;
}
// Escoger obra con botones grandes (si tiene solo una, no pregunta).
function pickJob(jobs, title) {
  if (jobs.length === 1) return Promise.resolve(jobs[0]);
  if (!jobs.length) { toast(t('Todavía no tiene obras asignadas. Pídale al dueño que le asigne una tarea.'), true); return Promise.resolve(null); }
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.innerHTML = `<form method="dialog"><h2>${esc(title || t('¿En qué obra?'))}</h2><div class="pickjobs">${jobs.map(j => `<button type="button" class="pickjob" data-id="${j.id}"><b>${esc(j.client_name)}</b><span class="small muted">${esc(j.address || '')}</span></button>`).join('')}</div>
      <div class="foot"><button type="button" data-x>${t('Cancelar')}</button></div></form>`;
    document.body.appendChild(d);
    const done = v => { d.close(); d.remove(); resolve(v); };
    $('[data-x]', d).onclick = () => done(null); d.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    $$('[data-id]', d).forEach(b => { b.onclick = () => done(jobs.find(j => String(j.id) === b.dataset.id)); });
    d.showModal();
  });
}
async function viewWorkerHome(app) {
  const all = await api('GET', '/api/jobs');
  const jobs = all.filter(j => j.status !== 'cancelado');
  const now = jobs.filter(j => NOW_ST.includes(j.status)), later = jobs.filter(j => LATER_ST.includes(j.status)), done = jobs.filter(j => j.status === 'terminado');
  const first = (ME.name || '').split(' ')[0];
  const card = j => `<a class="card jobcard" href="#/obra/${j.id}">
    <div class="row between"><h2 style="margin:0">${esc(j.client_name)}</h2>${j.myOpenTasks ? `<span class="badge b-en_progreso">${t('{n} tarea(s) mía(s)', { n: j.myOpenTasks })}</span>` : ''}</div>
    <div class="muted small row" style="gap:.3rem">${ico('pin', 'sm')} ${esc(j.address || typeLabel(j.project_type))}</div>
    <div class="row" style="margin-top:.5rem"><div class="bar" style="flex:1"><span style="width:${j.progress.pct}%"></span></div><span class="small">${j.progress.pct}%</span></div></a>`;
  app.innerHTML = `<h1 class="hello">${t('Hola, {x}', { x: esc(first) })}</h1>
    <div id="w_clock"></div>
    ${bigTiles([
      { k: 'ticket', ic: 'ticket', label: t('Foto del ticket'), cls: 'main' },
      { k: 'foto', ic: 'camera', label: t('Foto del trabajo') },
      { k: 'problema', ic: 'alert', label: t('Hay un problema'), cls: 'warn' },
      { href: '#/mis-pagos', ic: 'wallet', label: t('Mis pagos') },
      { href: '#/calendario', ic: 'calendar', label: t('Mi semana') },
      { href: '#/docs', ic: 'send', label: t('Mandar invoice') },
    ])}
    <div id="w_pend"></div><div id="w_next"></div><div id="w_notice"></div>
    <h2 class="sect">${ico('hardhat', 'h')} ${t('Mis obras ahora')}</h2>
    ${now.length ? now.map(card).join('') : `<div class="card empty">${jobs.length ? t('Ahorita no tiene obras en trabajo.') : t('Todavía no tiene obras asignadas. Pídale al dueño que le asigne una tarea.')}</div>`}
    ${later.length ? `<details class="card more"><summary>${ico('clock', 'h')} ${t('Obras que vienen')} (${later.length})</summary>${later.map(card).join('')}</details>` : ''}
    ${done.length ? `<details class="card more"><summary>${ico('check', 'h')} ${t('Obras terminadas')} (${done.length})</summary>${done.map(card).join('')}</details>` : ''}
    <div id="w_cases"></div><div id="w_plan"></div>`;
  const pick = title => pickJob(now.length ? now : jobs, title);
  $('[data-tile="ticket"]', app).onclick = async () => { const j = now.length === 1 ? now[0] : null; scanFlow(j ? j.id : null, () => viewWorkerHome(app)); };
  $('[data-tile="foto"]', app).onclick = async () => { const j = await pick(t('¿De qué obra es la foto?')); if (!j) return; const d = await api('GET', `/api/jobs/${j.id}`); photoUploadDialog(j.id, d, null, () => viewWorkerHome(app)); };
  $('[data-tile="problema"]', app).onclick = async () => { const j = await pick(t('¿En qué obra es el problema?')); if (!j) return; newCaseDialog({ jobId: j.id, after: () => viewWorkerHome(app) }); };
  const reload = () => viewWorkerHome(app);
  planTodayCard($('#w_plan', app)).catch(e => console.error(e));
  await Promise.all([myPendingCard($('#w_pend', app), reload).catch(e => console.error(e)), workerNextCard($('#w_next', app)).catch(e => console.error(e)),
    workerClockCard($('#w_clock', app), jobs, reload), workerNoticesCard($('#w_notice', app), reload),
    casesCard($('#w_cases', app), { title: '⚠️ ' + t('Mis casos'), onlyOpen: true, showJob: true, after: reload }).then(() => { const c = $('#w_cases', app); if (c && !$('[data-case]', c)) c.remove(); }).catch(() => {})]);
}

async function viewWorkerJob(app, id) {
  const d = await api('GET', `/api/jobs/${id}`);
  const reload = () => viewWorkerJob(app, id);
  const j = d.job, ST = TASK_STATUS();
  const crew = (ME.tools || []).includes('cuadrilla');
  const row = (x, i, big) => `<div class="task ${x.status} ${x.mine ? 'mine' : ''} ${big ? 'big' : ''}" data-id="${x.id}"><div class="n">${x.status === 'hecho' ? '✓' : i + 1}</div>
      <div><div class="title">${esc(taskTitle(x.title))}</div><div class="meta">${[x.mine ? `<b>${t('Tarea suya')}</b>` : esc(x.assignee_name || ''), x.planned_date && dateRange(x), x.open_notice ? '⏳' : ''].filter(Boolean).join(' · ')}</div>
      ${x.notes ? `<div class="meta">📝 ${esc(x.notes)}</div>` : ''}${taskPhotos(d, x.id)}</div>
      <div class="actions">${x.mine ? (x.status === 'pendiente' ? `<button class="${big ? 'go' : 'sm'}" data-s="en_progreso">▶ ${t('Empezar')}</button>`
        : x.status === 'en_progreso' ? `<button class="${big ? 'go' : 'sm'} primary" data-s="hecho">✓ ${t('Terminé')}</button>` : `<button class="sm" data-s="en_progreso">${t('Reabrir')}</button>`)
        + `<button class="sm" data-p title="${esc(t('Foto'))}">📷</button><button class="sm" data-n title="${esc(t('Nota'))}">📝</button>` + (x.status !== 'hecho' ? `<button class="sm" data-dl title="${t('Pedir cambio de fecha')}">⏰</button>` : '') : `<span class="badge b-${x.status}">${ST[x.status]}</span>`}</div></div>`;
  const idx = new Map(d.tasks.map((x, i) => [x.id, i]));
  const mine = d.tasks.filter(x => x.mine && x.status !== 'hecho'), others = d.tasks.filter(x => !x.mine && x.status !== 'hecho'), doneT = d.tasks.filter(x => x.status === 'hecho');
  app.innerHTML = `<a href="#/" class="back">← ${t('Mis obras')}</a>
    <h1 style="margin-top:.3rem">${esc(j.client_name)}</h1>
    ${j.address ? `<a class="btn mapbtn" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(j.address)}"><span class="mi">${ico('pin')}</span><span><b>${t('Cómo llegar')}</b><span class="small muted">${esc(j.address)}</span></span></a>` : ''}
    <div class="tiles">
      ${crew ? `<button type="button" class="tile main" id="crewrep"><span class="ti">${ico('notebook')}</span><span class="tl">${t('Reporte del día')}</span></button>` : ''}
      <button type="button" class="tile ${crew ? '' : 'main'}" id="scanw"><span class="ti">${ico('ticket')}</span><span class="tl">${t('Foto del ticket')}</span></button>
      <button type="button" class="tile" id="ph"><span class="ti">${ico('camera')}</span><span class="tl">${t('Foto del trabajo')}</span></button>
      <button type="button" class="tile warn" id="rep"><span class="ti">${ico('alert')}</span><span class="tl">${t('Hay un problema')}</span></button>
      <button type="button" class="tile" id="buy"><span class="ti">${ico('bag')}</span><span class="tl">${t('Compra sin ticket')}</span></button>
      <a class="tile" href="#/docs/new/invoice/${j.id}"><span class="ti">${ico('send')}</span><span class="tl">${t('Mandar invoice')}</span></a>
      <a class="tile" href="#/docs/new/estimate/${j.id}"><span class="ti">${ico('estimate')}</span><span class="tl">${t('Mandar estimado')}</span></a>
    </div>
    <details class="card codebox small"><summary>🏷️ ${t('Código para la tienda')}: <b class="code">${jobCode(j.id)}</b> <span class="muted">(${t('¿qué es?')})</span></summary>${t('Al pagar en la tienda, dé este código como "Job name" o "PO" para que el ticket se archive solo. Después tome foto del ticket con el botón Escanear.')}</details>
    ${j.description ? `<div class="card" style="white-space:pre-wrap">${esc(j.description)}</div>` : ''}
    <div class="card"><h2>${ico('tasks', 'h')} ${t('Mis tareas')}</h2>${mine.length ? mine.map(x => row(x, idx.get(x.id), true)).join('') : `<p class="muted">${t('No tiene tareas pendientes en esta obra.')} 👍</p>`}</div>
    ${others.length ? `<details class="card more"><summary>${ico('tasks', 'h')} ${t('Lo que falta de los demás')} (${others.length})</summary>${others.map(x => row(x, idx.get(x.id))).join('')}</details>` : ''}
    ${doneT.length ? `<details class="card more"><summary>${ico('check', 'h')} ${t('Ya terminado')} (${doneT.length})</summary>${doneT.map(x => row(x, idx.get(x.id))).join('')}</details>` : ''}`;
  bindPhotoViews(app);
  const upPhoto = taskId => photoUploadDialog(id, d, taskId, reload);
  $('#ph').onclick = () => upPhoto(null);
  $('#scanw').onclick = () => scanFlow(id, reload);
  if (crew) $('#crewrep').onclick = () => crewDailyDialog(j, reload);
  $('#rep').onclick = () => newCaseDialog({ jobId: id, after: reload });
  const wAnchor = app.firstElementChild;
  api('GET', `/api/jobs/${id}/permits`).then(ps => { if (!ps.length || !wAnchor.isConnected) return; const pc = document.createElement('div'); pc.className = 'card';
    pc.innerHTML = `<h2>🔍 ${t('Inspecciones')}</h2>${ps.map(p => `<div class="small">${esc(p.name)} · ${p.date ? fdate(p.date) : t('sin fecha')} <span class="badge ${PERMIT_B[p.status]}">${PERMIT_ST()[p.status]}</span></div>`).join('')}`;
    app.insertBefore(pc, $('.card', app).nextSibling); }).catch(() => {});
  workerPlansCard(app, id).catch(() => {});
  jobToolsCard(app, id).catch(() => {});
  { const rb = document.createElement('div'); app.appendChild(rb); roughinCard(rb, id, () => viewWorkerJob(app, id)).catch(() => {}); }
  const cb = document.createElement('div'); app.appendChild(cb);
  casesCard(cb, { jobId: id, title: t('Mis casos en esta obra'), onlyOpen: false, after: reload }).then(() => { if (!$('[data-case]', cb)) cb.remove(); });
  $('#buy').onclick = async () => {
    if (await formDialog({ title: t('Registrar compra'), submit: t('Guardar'), fields: [
      { name: 'amount_cents', label: t('Monto total ($)'), type: 'money', required: true },
      { name: 'description', label: t('Qué compró'), required: true },
      { name: 'vendor', label: t('Dónde'), hint: t('Home Depot, Lowe’s…') },
      { name: 'category', label: t('Tipo'), type: 'select', value: 'material', options: CATS().filter(c => c.key !== 'subcontratistas').map(c => [c.key, L(c)]) },
      { name: 'date', label: t('Fecha'), type: 'date', required: true, value: today() },
      { name: 'receipt', label: t('Foto del recibo'), type: 'photo', capture: true },
    ], onSubmit: v => api('POST', `/api/jobs/${id}/expenses`, v) })) toast(t('Compra registrada. ¡Gracias!'));
  };
  $$('.task[data-id]', app).forEach(el => {
    const tid = Number(el.dataset.id), x = d.tasks.find(y => y.id === tid);
    const s = $('[data-s]', el); if (s) s.onclick = () => setTaskStatus(tid, s.dataset.s, id).then(ok => { if (ok) toast(t('Actualizado')); reload(); });
    const p = $('[data-p]', el); if (p) p.onclick = () => upPhoto(tid);
    const dl = $('[data-dl]', el); if (dl) dl.onclick = () => delayDialog(x, reload, [j.client_name, j.address].filter(Boolean).join(', '));
    const n = $('[data-n]', el); if (n) n.onclick = async () => {
      if (await formDialog({ title: t('Nota'), fields: [{ name: 'notes', label: t('Nota para el dueño'), type: 'textarea', value: x.notes }], onSubmit: v => api('PUT', `/api/tasks/${tid}`, v) })) reload();
    };
  });
}

// ================= CLIENTE =================
async function viewClient(app, id) {
  const jobs = await api('GET', '/api/jobs');
  if (!jobs.length) { app.innerHTML = `<div class="portal"><div class="card empty">${t('Su proyecto aparecerá aquí pronto.')}</div></div>`; return; }
  if (!id && jobs.length > 1) {
    app.innerHTML = `<div class="portal"><h1>${t('Mis proyectos')}</h1>${jobs.map(j => `<a class="card" style="display:block;color:inherit;text-decoration:none" href="#/obra/${j.id}"><b>${esc(j.address || j.client_name)}</b><div class="small muted">${statusLabel(j.status)} · ${j.progress.pct}%</div></a>`).join('')}</div>`;
    return;
  }
  const d = await api('GET', `/api/jobs/${id || jobs[0].id}`);
  const j = d.job, m = d.money, ST = TASK_STATUS();
  app.innerHTML = `<div class="portal">
    <div class="hero"><div class="muted small">${esc(typeLabel(j.project_type))}</div><h1>${esc(j.address || t('Su proyecto'))}</h1>
      <div class="row between"><span class="pct">${d.progress.pct}%</span><span class="badge b-${j.status}">${statusLabel(j.status)}</span></div>
      <div class="bar big"><span style="width:${d.progress.pct}%"></span></div>
      <div class="muted small" style="margin-top:.5rem">${t('{a} de {b} pasos completos', { a: d.progress.done, b: d.progress.total })}${j.end_date && j.status !== 'terminado' ? ' · ' + t('Fin estimado {d}', { d: fdate(j.end_date) }) : ''}</div></div>
    ${d.updates && d.updates.length ? `<div class="card"><h2>${t('Novedades')}</h2><ul class="updates">${d.updates.slice(0, 8).map(u => `<li><span class="small muted">${fdate(u.created_at.slice(0, 10))}</span><div>${esc(updateText(u, LANG))}</div></li>`).join('')}</ul></div>` : ''}
    ${j.description ? `<div class="card"><h2>${t('Trabajo a realizar')}</h2><div style="white-space:pre-wrap">${esc(j.description)}</div></div>` : ''}
    <div class="card"><h2>${t('Avance')}</h2><ul class="steps">${d.tasks.map(x => `<li class="${x.status}"><span class="dot">${x.status === 'hecho' ? '✓' : ''}</span><span style="flex:1">${esc(taskTitle(x.title))}</span>
      <span class="small muted nowrap">${x.status === 'hecho' ? fdate(x.done_date) : ST[x.status]}</span></li>`).join('')}</ul></div>
    <div class="card"><h2>${t('Fotos')}</h2>${d.photos.length ? `<div class="photos">${d.photos.map(p => `<figure><img src="/files/${p.id}" data-view="${p.id}" alt="" loading="lazy"><figcaption>${esc(p.caption)} ${fdate(p.created_at.slice(0, 10))}</figcaption></figure>`).join('')}</div>` : `<p class="empty">${t('Agregaremos fotos conforme avance el trabajo.')}</p>`}</div>
    <div class="card"><h2>${t('Pagos')}</h2><div class="money-strip"><div><span>${t('Total del contrato')}</span><b>${fmt(m.contract)}</b></div><div><span>${t('Pagado')}</span><b>${fmt(m.paid)}</b></div><div><span>${t('Saldo')}</span><b>${fmt(m.balanceDue)}</b></div></div>
      ${d.changes.length ? `<h3 style="margin-top:1rem">${t('Change orders')}</h3><table><tbody>${d.changes.map(c => `<tr><td class="nowrap small"><b>${esc(c.code || '')}</b><br>${fdate(c.date)}</td><td>${esc(c.description_tr || c.description)}</td><td>${c.status !== 'aprobado' ? `<span class="badge b-pendiente">${t('Pendiente')}</span>` : c.state === 'cobrado' ? `<span class="badge b-hecho">${t('Pagado')}</span>` : c.invoice_number ? `<span class="badge ${c.state === 'vencido' ? 'b-late' : 'b-pendiente'}">${t('Por pagar')}</span>` : `<span class="badge b-hecho">${t('Aprobado')}</span>`}</td><td class="num">${fmt(c.price_cents)}${c.invoice_number ? `<div><a class="small" target="_blank" rel="noopener" href="/api/changes/${c.id}/pdf?lang=${LANG}">${esc(c.invoice_number)}</a></div>` : ''}</td></tr>`).join('')}</tbody></table>` : ''}
      ${d.payments.length ? `<h3 style="margin-top:1rem">${t('Historial de pagos')}</h3><table><tbody>${d.payments.map(p => `<tr><td>${fdate(p.date)}</td><td>${esc(payLabel(p.method))}</td><td class="num">${fmt(p.amount_cents)}</td></tr>`).join('')}</tbody></table>` : ''}</div>
    ${j.warranty_until ? `<div class="card"><h2>${t('Garantía')}</h2><p>${t('Su trabajo está cubierto por nuestra garantía de 1 año hasta el {d}.', { d: `<b>${fdate(j.warranty_until)}</b>` })}</p></div>` : ''}
    <p style="text-align:center"><a class="btn primary" target="_blank" rel="noopener" href="/api/jobs/${j.id}/pdf?lang=${LANG}">📄 ${t('Descargar PDF de mi proyecto')}</a></p>
    </div>`;
  bindPhotoViews(app);
  const qb = document.createElement('div'); $('.portal', app).insertBefore(qb, $('.portal', app).children[1]);
  await casesCard(qb, { jobId: j.id, title: '💬 ' + t('Preguntas y avisos'), after: () => viewClient(app, id), newBtn: t('Hacer una pregunta') });
  await clientProCards(app, j, () => viewClient(app, id)).catch(e => console.error(e));
  await clientStatementCard(app, j).catch(e => console.error(e));
  await v2ClientCards(app, j);
  await clientBillingCard(app, j).catch(e => console.error(e));
  await clientDocsCard(app, j).catch(e => console.error(e));
  await clientWarrantyCard(app, j).catch(e => console.error(e));
  await clientSelectionsCard(app, j).catch(e => console.error(e));
}

// ================= CALENDARIO, AVISOS Y NOVEDADES =================
// Texto en un idioma concreto (para mensajes a otra persona, en SU idioma).
function tl(lang, s, vars) {
  let out = lang === 'en' ? (window.EN_DICT[s] ?? s) : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  return coName(out);
}
const fdateIn = (lang, s) => s ? new Date(s + 'T12:00:00').toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const taskTitleIn = (lang, s) => (lang === 'en' ? TASK_EN.get(s) : TASK_ES.get(s)) || s;
const reasonIn = (lang, k) => { const r = (CAT.delayReasons || []).find(x => x.key === k); return r ? r[lang] || r.es : k; };
const dateRange = x => x.planned_end && x.planned_end !== x.planned_date ? `${fdate(x.planned_date)} → ${fdate(x.planned_end)}` : fdate(x.planned_date);
const appUrl = () => location.origin;

// Texto de una novedad para el cliente.
function updateText(u, lang) {
  let d = {}; try { d = JSON.parse(u.data || '{}'); } catch { /* */ }
  let txt = '';
  if (u.kind === 'schedule') {
    txt = tl(lang, '“{task}” se movió del {old} al {new}.', { task: taskTitleIn(lang, d.task), old: fdateIn(lang, d.old) || '—', new: fdateIn(lang, d.new) });
    if (d.moved) txt += ' ' + tl(lang, 'También se ajustaron {n} pasos siguientes.', { n: d.moved });
    if (d.end_date) txt += ' ' + tl(lang, 'Nueva fecha estimada de fin: {d}.', { d: fdateIn(lang, d.end_date) });
  } else if (u.kind === 'change_order') {
    txt = tl(lang, 'Change order aprobado: {x} ({m}).', { x: d.description, m: fmt(d.price) });
  } else if (u.kind === 'status') {
    if (d.status === 'activo') txt = tl(lang, '¡Su proyecto comenzó!') + (d.end_date ? ' ' + tl(lang, 'Fecha estimada de fin: {d}.', { d: fdateIn(lang, d.end_date) }) : '');
    if (d.status === 'terminado') txt = tl(lang, 'Su proyecto está terminado. Garantía hasta el {d}.', { d: fdateIn(lang, d.warranty_until) });
    if (d.status === 'inspeccion') txt = tl(lang, '✅ Pasó la inspección: {x}.', { x: taskTitleIn(lang, d.name) }) + ((d.next || []).length ? ' ' + tl(lang, 'Sigue: {n}{d}.', { n: d.next.map(x => taskTitleIn(lang, x)).join(', '), d: d.next_date ? ' (' + fdateIn(lang, d.next_date) + ')' : '' }) : '');
  }
  const note = ((lang === LANG ? u.note_tr : u.note_client) || u.note || '').trim();
  return [txt, note && note + (/[.!?]$/.test(note) ? '' : '.')].filter(Boolean).join(' ');
}

// Mensajes listos para WhatsApp / texto, en el idioma de quien los recibe.
function noticeMessage(n) {
  const lang = (n.to && n.to.lang) || 'es';
  const v = { name: n.to ? n.to.name.split(' ')[0] : '', task: taskTitleIn(lang, n.task_title), place: n.address || n.client_name, date: fdateIn(lang, n.new_date), reason: reasonIn(lang, n.reason) };
  let m = n.kind === 'moved' ? tl(lang, 'Hola {name}: por un cambio en la obra, “{task}” ({place}) se movió al {date}.', v)
    : n.new_date ? tl(lang, 'Hola {name}: Elevated Exteriors cambió la fecha de “{task}” ({place}) al {date}. Motivo: {reason}.', v)
      : tl(lang, 'Hola {name}: Elevated Exteriors pausó “{task}” ({place}). Motivo: {reason}. La nueva fecha está por definir.', v);
  if (n.note) m += ' ' + n.note.trim() + (/[.!?]$/.test(n.note.trim()) ? '' : '.');
  return m + ' ' + (n.new_date ? tl(lang, 'Por favor confirme o responda en la app con la fecha en que puede regresar: {url}', { url: appUrl() })
    : tl(lang, 'Por favor responda en la app con la fecha en que puede regresar: {url}', { url: appUrl() }));
}
function clientMessage(client, row) {
  const lang = client.lang || 'en';
  let m = tl(lang, 'Hola {name}, le escribe Elevated Exteriors.', { name: (client.name || '').split(' ')[0] }) + ' ' + updateText(row, lang);
  if (client.hasPortal) m += ' ' + tl(lang, 'Vea los detalles en su portal: {url}', { url: appUrl() });
  return m;
}
const smsPhone = p => { const d = phoneDigits(p); return d ? '+' + d : ''; };
const phoneDigits = p => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 10) d = '1' + d; return d; };
function sendButtons(phone, text, email, subject) {
  const d = phoneDigits(phone), body = encodeURIComponent(text);
  const b = [];
  if (d && BOSS() && typeof SMSST !== 'undefined' && SMSST.enabled) b.push(`<button class="sm primary" data-smsapp data-phone="+${d}" data-text="${esc(text)}">💬 ${t('Texto desde la app')}</button>`);
  if (d) b.push(`<a class="btn sm ${BOSS() && typeof SMSST !== 'undefined' && SMSST.enabled ? '' : 'primary'}" target="_blank" rel="noopener" href="https://wa.me/${d}?text=${body}">WhatsApp</a>`,
    `<a class="btn sm" href="sms:+${d}?&body=${body}">${t('Mensaje de texto')}</a>`);
  if (email) b.push(`<a class="btn sm" href="mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject || 'Elevated Exteriors')}&body=${body}">Email</a>`);
  if (!b.length) b.push(`<span class="small muted">${t('Sin teléfono ni email registrado')}</span>`);
  b.push(`<button class="sm" data-copy="${esc(text)}">${t('Copiar')}</button>`);
  return b.join(' ');
}
// Ventana para mandar los avisos por WhatsApp / texto / email.
function shareDialog(res) {
  const items = [];
  for (const n of res.notices || []) {
    items.push(`<div class="share-item"><b>${esc(n.to ? n.to.name : '')}</b> <span class="small muted">· ${t('Sub / trabajador')} · ${n.to && n.to.lang === 'en' ? 'English' : 'Español'}</span>
      <p class="small msg">${esc(noticeMessage(n))}</p><div class="row">${sendButtons(n.to && n.to.phone, noticeMessage(n))}</div></div>`);
  }
  if (res.clientUpdateRow && res.client) {
    const m = clientMessage(res.client, res.clientUpdateRow);
    items.push(`<div class="share-item"><b>${esc(res.client.name)}</b> <span class="small muted">· ${t('Cliente')} · ${res.client.lang === 'en' ? 'English' : 'Español'}</span>
      ${res.client.hasPortal ? `<div class="small pos">✓ ${t('Ya aparece en el portal del cliente.')}</div>` : `<div class="small muted">${t('El cliente no tiene acceso al portal: mándelo por mensaje.')}</div>`}
      <p class="small msg">${esc(m)}</p><div class="row">${sendButtons(res.client.phone, m, res.client.email)}</div></div>`);
  }
  if (!items.length) return;
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${t('Avisar a las personas')}</h2>
    <p class="small muted">${t('Los avisos ya están en la app de cada persona. Para asegurarse de que los vean, mándelos también por mensaje desde su teléfono.')}</p>
    ${items.join('')}<div class="foot"><button class="primary" type="submit">${t('Listo')}</button></div></form>`;
  document.body.appendChild(d);
  $$('[data-copy]', d).forEach(b => { b.onclick = async e => { e.preventDefault(); try { await navigator.clipboard.writeText(b.dataset.copy); toast(t('Copiado')); } catch { toast(t('No se pudo copiar'), true); } }; });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}
function shareIfClient(r) { if (r && r.clientUpdateRow) shareDialog({ notices: [], clientUpdateRow: r.clientUpdateRow, client: r.client }); }

const reasonOptions = () => (CAT.delayReasons || []).filter(r => r.key !== 'tarea_anterior').map(r => [r.key, L(r)]);

// Dueño: reprogramar una tarea / avisar atraso.
async function rescheduleDialog(task, after) {
  let res;
  const who = task.assignee_name;
  const ok = await formDialog({
    title: t('Reprogramar: {x}', { x: taskTitle(task.title) }),
    intro: `<p class="small muted">${t('Fecha actual')}: <b>${task.planned_date ? esc(dateRange(task)) : t('sin fecha')}</b>${who ? ' · ' + t('Asignada a {x}', { x: esc(who) }) : ''}</p>`,
    submit: t('Guardar y avisar'),
    fields: [
      { name: 'new_date', label: t('Nueva fecha'), type: 'date', value: '', hint: t('Déjela vacía si aún no sabe: el sub propondrá la fecha en que puede regresar.') },
      { name: 'new_end', label: t('Hasta (si dura varios días)'), type: 'date', value: '' },
      { name: 'reason', label: t('Motivo'), type: 'select', value: 'inspeccion', options: reasonOptions() },
      { name: 'note', label: t('Nota para el sub (no la ve el cliente)'), type: 'textarea', value: '' },
      { name: 'cascade', label: t('Mover también las tareas siguientes los mismos días'), type: 'check', value: true },
      { name: 'move_end', label: t('Mover también la fecha estimada de fin de la obra'), type: 'check', value: true },
      { name: 'notify_sub', label: who ? t('Avisar a {x} y pedirle que confirme', { x: who }) : t('Avisar al responsable (esta tarea no tiene a nadie asignado)'), type: 'check', value: !!task.assignee_id },
      { name: 'notify_moved', label: t('Avisar también a los subs de las tareas que se muevan'), type: 'check', value: true },
      { name: 'inform_client', label: t('Informar el cambio al cliente'), type: 'check', value: true },
      { name: 'client_note', label: t('Mensaje para el cliente (opcional)'), type: 'textarea', value: '', hint: t('El cliente ve el cambio de fecha y este mensaje, nunca el motivo interno.') },
    ],
    onSubmit: async v => { res = await api('POST', `/api/tasks/${task.id}/reschedule`, v); },
  });
  if (!ok) return;
  toast(t('Calendario actualizado'));
  if (after) after();
  shareDialog(res);
}

// Dueño: aceptar la fecha que propuso el sub.
async function acceptDialog(n, after) {
  let res;
  const ok = await formDialog({
    title: t('Aceptar la fecha de {x}', { x: n.to ? n.to.name : '' }),
    intro: `<p>${t('“{task}” pasa al {d}.', { task: esc(taskTitle(n.task_title)), d: `<b>${fdate(n.response_date)}</b>` })}</p>`,
    submit: t('Aceptar fecha'),
    fields: [
      { name: 'cascade', label: t('Mover también las tareas siguientes los mismos días'), type: 'check', value: true },
      { name: 'move_end', label: t('Mover también la fecha estimada de fin de la obra'), type: 'check', value: true },
      { name: 'notify_moved', label: t('Avisar también a los subs de las tareas que se muevan'), type: 'check', value: true },
      { name: 'inform_client', label: t('Informar el cambio al cliente'), type: 'check', value: true },
      { name: 'client_note', label: t('Mensaje para el cliente (opcional)'), type: 'textarea', value: '' },
    ],
    onSubmit: async v => { res = await api('POST', `/api/notices/${n.id}/accept`, v); },
  });
  if (!ok) return;
  toast(t('Calendario actualizado'));
  if (after) after();
  shareDialog(res);
}

// Trabajador: después de pedir un cambio, le ofrece mandarlo a los dueños por WhatsApp / texto.
async function shareToOwners(req) {
  let owners = [];
  try { owners = (await api('GET', '/api/contacts/owners')).filter(o => o.phone); } catch { return; }
  if (!owners.length) return;
  const msg = lang => {
    const v = { who: ME.name, task: taskTitleIn(lang, req.title), place: req.place || '', d: fdateIn(lang, req.date), reason: reasonIn(lang, req.reason) };
    let m = tl(lang, '{who} pide cambiar la fecha de “{task}” ({place}): puede regresar el {d}. Motivo: {reason}.', v);
    if (req.note) m += ' ' + req.note.trim() + (/[.!?]$/.test(req.note.trim()) ? '' : '.');
    return m + ' ' + tl(lang, 'Apruébelo en la app: {url}', { url: appUrl() });
  };
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${t('Avisar a los dueños')}</h2>
    <p class="small muted">${t('Su solicitud ya está en la app. El calendario no cambia hasta que un dueño la apruebe. Para que la vean rápido, mándeles también un mensaje:')}</p>
    ${owners.map(o => `<div class="share-item"><b>${esc(o.name)}</b><p class="small msg">${esc(msg(o.lang))}</p><div class="row">${sendButtons(o.phone, msg(o.lang))}</div></div>`).join('')}
    <div class="foot"><button class="primary" type="submit">${t('Listo')}</button></div></form>`;
  document.body.appendChild(d);
  $$('[data-copy]', d).forEach(b => { b.onclick = async e => { e.preventDefault(); try { await navigator.clipboard.writeText(b.dataset.copy); toast(t('Copiado')); } catch { toast(t('No se pudo copiar'), true); } }; });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

// Trabajador: avisar que se atrasa en su tarea.
async function delayDialog(x, after, place) {
  let sent;
  if (await formDialog({ title: t('Pedir cambio de fecha: {x}', { x: taskTitle(x.title) }), submit: t('Enviar solicitud'),
    intro: `<p class="small muted">${t('El dueño recibe su solicitud y la aprueba. Cuando la apruebe, la app cambia la fecha sola.')}</p>`, fields: [
    { name: 'date', label: t('¿Qué día puede regresar?'), type: 'date', required: true },
    { name: 'reason', label: t('Motivo'), type: 'select', value: 'sub', options: reasonOptions() },
    { name: 'note', label: t('Nota para el dueño'), type: 'textarea' },
  ], onSubmit: async v => { await api('POST', `/api/tasks/${x.id}/delay`, v); sent = v; } })) {
    toast(t('Solicitud enviada al dueño')); if (after) after();
    shareToOwners({ ...sent, title: x.title, place: place || [x.client_name, x.address].filter(Boolean).join(', ') });
  }
}

function noticeLine(n) {
  const v = { task: esc(taskTitle(n.task_title)), place: esc(n.client_name), who: esc(n.to ? n.to.name : ''), d: fdate(n.response_date), nd: fdate(n.new_date) };
  return v;
}
// Dueño: respuestas de subs y avisos esperando respuesta.
async function ownerNoticesCard(box, refresh) {
  const list = await api('GET', '/api/notices');
  const replied = list.filter(n => n.status === 'respondido'), waiting = list.filter(n => n.status === 'enviado');
  const recent = list.filter(n => n.status === 'cerrado' && n.resolution === 'confirmado').slice(0, 5);
  if (!replied.length && !waiting.length && !recent.length) { box.remove(); return; }
  box.className = 'card notices';
  box.innerHTML = `<h2>📅 ${t('Calendario: avisos a subs')}</h2>
    ${replied.map(n => { const v = noticeLine(n); return `<div class="notice reply" data-id="${n.id}">
      <div>${n.kind === 'worker' ? t('{who} avisa que se atrasa en “{task}” ({place}). Puede regresar el {d}.', v) : t('{who} puede regresar a “{task}” ({place}) el {d}.', v)}
      <div class="small muted">${t('Motivo')}: ${esc(reasonIn(LANG, n.reason))}${n.response_note ? ' · “' + trx(n.response_note, n.response_note_tr, n.response_note_from, { inline: true }) + '”' : ''}</div></div>
      <div class="row"><button class="sm primary" data-acc>${t('Aceptar fecha')}</button><button class="sm" data-cl>${t('Descartar')}</button></div></div>`; }).join('')}
    ${waiting.map(n => { const v = noticeLine(n); return `<div class="notice wait" data-id="${n.id}">
      <div>${t('Esperando respuesta de {who}: “{task}” ({place})', v)} ${n.new_date ? `→ ${v.nd}` : `· <i>${t('fecha por definir')}</i>`}</div>
      <div class="row"><button class="sm" data-rs>${t('Reenviar')}</button><button class="sm" data-cl>${t('Cerrar')}</button></div></div>`; }).join('')}
    ${recent.map(n => { const v = noticeLine(n); return `<div class="notice ok small">✓ ${t('{who} confirmó “{task}” ({place}) para el {d}.', v)}</div>`; }).join('')}`;
  $$('.notice[data-id]', box).forEach(el => {
    const n = list.find(x => x.id === Number(el.dataset.id));
    const acc = $('[data-acc]', el); if (acc) acc.onclick = () => acceptDialog(n, refresh);
    const rs = $('[data-rs]', el); if (rs) rs.onclick = () => shareDialog({ notices: [n] });
    const cl = $('[data-cl]', el); if (cl) cl.onclick = () => act(() => api('POST', `/api/notices/${n.id}/close`), t('Cerrado')).then(async () => { ME.pending = (await api('GET', '/api/status')).user.pending; renderNav(); refresh(); });
  });
}

// Trabajador: avisos que debe contestar.
async function workerNoticesCard(box, refresh) {
  const list = await api('GET', '/api/notices');
  const open = list.filter(n => n.status === 'enviado'), mine = list.filter(n => n.status === 'respondido'), closed = list.filter(n => n.status === 'cerrado' && ['aceptado', 'descartado'].includes(n.resolution)).slice(0, 4);
  if (!open.length && !mine.length && !closed.length) { box.remove(); return; }
  box.className = 'card notices';
  box.innerHTML = `<h2>📅 ${t('Avisos de cambio de fecha')}</h2>
    ${open.map(n => { const v = noticeLine(n); return `<div class="notice reply" data-id="${n.id}">
      <div><b>${v.task}</b> · ${v.place}${n.address ? ' · ' + esc(n.address) : ''}
        <div>${n.new_date ? t('Nueva fecha: {nd}', v) : `<i>${t('Fecha por definir: diga cuándo puede regresar')}</i>`}</div>
        <div class="small muted">${t('Motivo')}: ${esc(reasonIn(LANG, n.reason))}${n.note ? ' · “' + trx(n.note, n.note_tr, n.note_from, { inline: true }) + '”' : ''}</div></div>
      <div class="row">${n.new_date ? `<button class="sm primary" data-ok>${t('Confirmo')}</button>` : ''}<button class="sm ${n.new_date ? '' : 'primary'}" data-pr>${t('Propongo otra fecha')}</button></div></div>`; }).join('')}
    ${mine.map(n => { const v = noticeLine(n); return `<div class="notice wait small">${t('Usted propuso regresar a “{task}” el {d}. Esperando al dueño.', v)}</div>`; }).join('')}
    ${closed.map(n => { const v = noticeLine(n); return `<div class="notice ok small">${n.resolution === 'aceptado' ? '✓ ' + t('Aceptado: “{task}” queda para el {d}.', v) : t('El dueño no aceptó el cambio de “{task}”. Revise su calendario.', v)}</div>`; }).join('')}`;
  const done = async () => { ME.pending = (await api('GET', '/api/status')).user.pending; renderNav(); refresh(); };
  $$('.notice[data-id]', box).forEach(el => {
    const n = list.find(x => x.id === Number(el.dataset.id));
    const ok = $('[data-ok]', el); if (ok) ok.onclick = () => act(() => api('POST', `/api/notices/${n.id}/respond`, { action: 'confirm' }), t('¡Gracias! Fecha confirmada')).then(done);
    $('[data-pr]', el).onclick = async () => {
      if (await formDialog({ title: t('¿Qué día puede regresar?'), submit: t('Enviar'), fields: [
        { name: 'date', label: t('Fecha en que puede regresar'), type: 'date', required: true },
        { name: 'note', label: t('Nota para el dueño'), type: 'textarea' },
      ], onSubmit: async v => { await api('POST', `/api/notices/${n.id}/respond`, { action: 'propose', ...v }); n._sent = v; } })) {
        toast(t('Respuesta enviada')); done();
        shareToOwners({ ...n._sent, title: n.task_title, reason: n.reason, place: [n.client_name, n.address].filter(Boolean).join(', ') });
      }
    };
  });
}

// Dueño: novedades que ve el cliente en su portal.
async function clientUpdatesCard(box, jobId) {
  const r = await api('GET', `/api/jobs/${jobId}/updates`);
  box.className = 'card'; box.style.marginTop = '1rem';
  box.innerHTML = `<div class="row between"><h2>${t('Novedades para el cliente')}</h2><button class="sm primary" id="nmsg">${t('+ Mensaje al cliente')}</button></div>
    <p class="small muted">${t('Los cambios autorizados (fechas, change orders aprobados, inicio y fin de obra) se agregan solos y el cliente los ve en su portal.')}</p>
    ${r.updates.length ? `<ul class="updates">${r.updates.map(u => `<li data-id="${u.id}"><span class="small muted">${fdate(u.created_at.slice(0, 10))}</span>
      <div style="flex:1">${esc(updateText(u, LANG))}</div><span class="nowrap"><button class="sm" data-sh>${t('Enviar')}</button><button class="sm danger" data-del>✕</button></span></li>`).join('')}</ul>`
    : `<p class="empty">${t('Todavía no hay novedades.')}</p>`}`;
  $('#nmsg').onclick = async () => {
    let res;
    if (await formDialog({ title: t('Mensaje al cliente'), fields: [{ name: 'note', label: t('Mensaje'), type: 'textarea', required: true }],
      onSubmit: async v => { res = await api('POST', `/api/jobs/${jobId}/updates`, v); } })) {
      clientUpdatesCard(box, jobId); shareDialog({ notices: [], clientUpdateRow: res.row, client: res.client });
    }
  };
  $$('li[data-id]', box).forEach(li => {
    const u = r.updates.find(x => x.id === Number(li.dataset.id));
    $('[data-sh]', li).onclick = () => shareDialog({ notices: [], clientUpdateRow: u, client: r.client });
    $('[data-del]', li).onclick = async () => { if (await confirmDialog(t('¿Quitar esta novedad del portal del cliente?'))) act(() => api('DELETE', `/api/updates/${u.id}`), t('Borrado')).then(() => clientUpdatesCard(box, jobId)); };
  });
}

// Calendario: vista por mes, semana o día (se recuerda la última que eligió).
async function viewCalendar(app) {
  const now = today();
  const iso = d => d.toISOString().slice(0, 10);
  const D = s => new Date(s + 'T00:00:00Z');
  const add = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  let mode = viewCalendar.mode; if (!mode) { try { mode = localStorage.getItem('ee_calview'); } catch { /* */ } }
  if (!['mes', 'semana', 'dia'].includes(mode)) mode = matchMedia('(max-width: 760px)').matches ? 'semana' : 'mes';
  const cur = viewCalendar.d || now;
  const ym = cur.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  let start, end;
  if (mode === 'mes') {
    const first = new Date(Date.UTC(y, m - 1, 1)), last = new Date(Date.UTC(y, m, 0));
    start = add(iso(first), -first.getUTCDay()); end = add(iso(last), 6 - last.getUTCDay());
  } else if (mode === 'semana') { start = add(cur, -D(cur).getUTCDay()); end = add(start, 6); }
  else { start = end = cur; }
  const who = viewCalendar.user || '';
  const [rows, users] = await Promise.all([
    api('GET', `/api/calendar?from=${start}&to=${end}${who ? '&user=' + who : ''}`),
    BOSS() ? api('GET', '/api/users') : Promise.resolve([]),
  ]);
  const byDay = {};
  for (const r of rows) {
    const s0 = r.planned_date, e = r.planned_end && r.planned_end > s0 ? r.planned_end : s0;
    let d = s0 < start ? start : s0, k = 0;
    while (d <= e && d <= end && k++ < 62) { (byDay[d] = byDay[d] || []).push(r); d = add(d, 1); }
  }
  const late = r => r.status !== 'hecho' && (r.planned_end || r.planned_date) < now;
  const chip = r => `<button class="chip s-${r.status} ${late(r) ? 'late' : ''}" data-t="${r.id}" title="${esc(taskTitle(r.title))} — ${esc(r.client_name)}">
    ${r.open_notices ? '⏳ ' : ''}${esc(taskTitle(r.title))}<span>${esc(r.client_name)}${BOSS() && r.assignee_name ? ' · ' + esc(r.assignee_name) : ''}</span></button>`;
  const ST = { pendiente: t('Pendiente'), en_progreso: t('En progreso'), hecho: t('Hecho') };
  const card = r => `<button class="dcard s-${r.status} ${late(r) ? 'late' : ''}" data-t="${r.id}"><div class="row between"><b>${r.open_notices ? '⏳ ' : ''}${esc(taskTitle(r.title))}</b>
      <span class="badge b-${r.status}">${late(r) ? t('Atrasada') : ST[r.status] || ''}</span></div>
    <div>${esc(r.client_name)}${r.address ? ` · <span class="muted">${esc(r.address)}</span>` : ''}</div>
    <div class="small muted">${esc(dateRange(r))}${r.assignee_name ? ' · 👷 ' + esc(r.assignee_name) : ` · ${t('Sin asignar')}`}</div></button>`;
  const cap = x => x.charAt(0).toUpperCase() + x.slice(1);
  const loc = LANG === 'en' ? 'en-US' : 'es-MX';
  const fmtD = (s, o) => D(s).toLocaleDateString(loc, { timeZone: 'UTC', ...o });
  const title = mode === 'mes' ? cap(fmtD(cur.slice(0, 7) + '-01', { month: 'long', year: 'numeric' }))
    : mode === 'semana' ? `${fmtD(start, { day: 'numeric', month: 'short' })} – ${fmtD(end, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : cap(fmtD(cur, { weekday: 'long', day: 'numeric', month: 'long' }));
  const wd = [...Array(7)].map((_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toLocaleDateString(loc, { weekday: 'short', timeZone: 'UTC' }));
  const days = []; for (let d = start; d <= end; d = add(d, 1)) days.push(d);
  const workers = users.filter(u => u.role === 'worker' && u.active);
  const L = { mes: [t('Mes anterior'), t('Mes siguiente')], semana: [t('Semana anterior'), t('Semana siguiente')], dia: [t('Día anterior'), t('Día siguiente')] }[mode];
  let body;
  if (mode === 'mes') body = `<div class="cal">${wd.map(w => `<div class="cal-h">${esc(w)}</div>`).join('')}
      ${days.map(d => `<div class="cal-d ${d.slice(0, 7) !== ym ? 'out' : ''} ${d === now ? 'today' : ''}"><a href="#" class="num" data-day="${d}">${Number(d.slice(8))}</a>${(byDay[d] || []).map(chip).join('')}</div>`).join('')}</div>
    <div class="agenda">${days.filter(d => d.slice(0, 7) === ym && byDay[d]).map(d => `<div class="ag-day ${d === now ? 'today' : ''}"><a href="#" class="ag-date" data-day="${d}">${esc(cap(fdateIn(LANG, d)))}</a>${byDay[d].map(chip).join('')}</div>`).join('')
      || `<p class="empty">${t('No hay tareas programadas este mes.')}</p>`}</div>`;
  else if (mode === 'semana') body = `<div class="cal-week">${days.map(d => `<div class="cw-d ${d === now ? 'today' : ''}"><a href="#" class="cw-h" data-day="${d}"><span>${esc(cap(fmtD(d, { weekday: 'short' })))}</span><b>${Number(d.slice(8))}</b></a>
      <div class="cw-items">${(byDay[d] || []).map(chip).join('') || `<div class="cw-empty small muted">—</div>`}</div></div>`).join('')}</div>`;
  else body = `<div class="cal-day">${(byDay[cur] || []).map(card).join('') || `<p class="empty">${t('No hay tareas programadas este día.')}</p>`}</div>`;
  app.innerHTML = `<div class="row between wrap"><h1 style="margin:0">${esc(title)}</h1>
    <div class="row wrap calnav"><div class="seg" role="group">${[['dia', t('Día')], ['semana', t('Semana')], ['mes', t('Mes')]].map(([k, l]) => `<button class="${k === mode ? 'on' : ''}" data-mode="${k}" aria-pressed="${k === mode}">${l}</button>`).join('')}</div>
      <span class="row" style="gap:.4rem"><button id="prev" aria-label="${L[0]}">←</button><button id="tod">${t('Hoy')}</button><button id="next" aria-label="${L[1]}">→</button></span></div></div>
    ${BOSS() ? `<div class="row" style="margin:.75rem 0"><select id="who" style="width:auto"><option value="">${t('Todos')}</option>${workers.map(w => `<option value="${w.id}" ${String(w.id) === String(who) ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
      <span class="small muted">${t('Toque una tarea para reprogramarla o avisar un atraso.')}</span></div>`
      : `<p class="small muted">${t('Sus tareas programadas. Toque una para avisar si se va a atrasar.')}</p>`}
    ${mode === 'dia' ? '' : `<div class="legend small"><span class="chip s-pendiente">${t('Pendiente')}</span><span class="chip s-en_progreso">${t('En progreso')}</span><span class="chip s-hecho">${t('Hecho')}</span><span class="chip late">${t('Atrasada')}</span><span>⏳ ${t('esperando respuesta')}</span></div>`}
    ${body}`;
  const go = (d, md = mode) => { viewCalendar.d = d; viewCalendar.mode = md; try { localStorage.setItem('ee_calview', md); } catch { /* */ } viewCalendar(app); };
  const step = k => mode === 'mes' ? go(iso(new Date(Date.UTC(y, m - 1 + k, 1)))) : go(add(cur, k * (mode === 'semana' ? 7 : 1)));
  $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
  $('#tod').onclick = () => go(now);
  $$('[data-mode]', app).forEach(b => { b.onclick = () => go(cur, b.dataset.mode); });
  $$('[data-day]', app).forEach(a => { a.onclick = e => { e.preventDefault(); go(a.dataset.day, 'dia'); }; });
  if ($('#who')) $('#who').onchange = e => { viewCalendar.user = e.target.value; viewCalendar(app); };
  const reload = () => viewCalendar(app);
  $$('[data-t]', app).forEach(b => {
    b.onclick = async () => {
      const r = rows.find(x => x.id === Number(b.dataset.t));
      if (BOSS()) {
        const ch = await formDialog({ title: taskTitle(r.title), intro: `<p>${esc(r.client_name)} · ${esc(dateRange(r))}${r.assignee_name ? ' · 👷 ' + esc(r.assignee_name) : ''}</p>`,
          fields: [{ name: 'go', label: t('¿Qué desea hacer?'), type: 'select', value: 'rs', options: [['rs', t('Reprogramar / avisar atraso')], ['job', t('Abrir la obra')]] }],
          submit: t('Continuar'), onSubmit: async () => {} });
        if (!ch) return;
        if (ch.go === 'job') location.hash = `#/obra/${r.job_id}`; else rescheduleDialog(r, reload);
      } else if (r.status !== 'hecho') delayDialog(r, reload);
      else location.hash = `#/obra/${r.job_id}`;
    };
  });
}

// ================= ESTIMADOS E INVOICES DE SUBS =================
const DOC_STATUS = () => ({ enviado: t('Por revisar'), aceptado: t('Aceptado'), aprobado: t('Aprobado'), rechazado: t('Rechazado') });
const docKind = (type, lang = LANG) => type === 'estimate' ? tl(lang, 'Estimado') : type === 'change_order' ? 'Change order' : 'Invoice';
const pdfLink = d => `/api/docs/${d.id}/pdf?lang=${LANG}`;
const waitingOther = d => d.approvals_needed > 1 && ((d.unlock === 'pedido' && d.unlock_ok.length) || (d.prev && d.corr_ok.length));
const iApproved = d => (d.unlock === 'pedido' && d.unlock_ok.includes(ME.id)) || (d.prev && d.status === 'enviado' && d.corr_ok.includes(ME.id));
const docBadge = d => waitingOther(d) ? `<span class="badge b-cotizado">${t('Falta 1 dueño')}</span>` : d.unlock === 'pedido' ? `<span class="badge b-cotizado">${t('Pide permiso para corregir')}</span>` : d.prev ? `<span class="badge b-cotizado">${t('Corrección por revisar')}</span>` : d.type === 'invoice' && d.status === 'aprobado'
  ? (d.paid_at ? `<span class="badge b-hecho">${t('Pagado')}</span>` : d.paid_cents ? `<span class="badge b-en_progreso">${t('Pago parcial: {a} de {b}', { a: fmt(d.paid_cents), b: fmt(d.total_cents) })}</span>` : `<span class="badge b-en_progreso">${t('Aprobado: por pagar')}</span>`)
  : `<span class="badge ${{ enviado: 'b-cotizado', aceptado: 'b-hecho', rechazado: 'b-rechazado' }[d.status] || ''}">${DOC_STATUS()[d.status]}</span>`;

// Lee un archivo (foto o PDF) para mandarlo.
function readDocFile(file) {
  if (!file) return Promise.resolve(null);
  if (/^image\//.test(file.type)) return compressImage(file, 2000, 0.85);
  if (file.type !== 'application/pdf') return Promise.reject(new Error(t('Use una foto o un PDF')));
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error(t('El PDF es muy grande (máximo 8 MB)')));
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error(t('No se pudo leer el archivo'))); r.readAsDataURL(file); });
}

// Ventana para crear / corregir un estimado o invoice, con renglones.
async function docDialog({ type, jobs, jobId, doc, fromEst, after, asOwner }) {
  const isInv = type === 'invoice';
  const decided = doc && ['aceptado', 'aprobado'].includes(doc.status);
  const isCO = type === 'change_order';
  const lines = doc ? doc.lines.map(l => ({ ...l })) : fromEst && !isCO ? fromEst.lines.map(l => ({ ...l })) : [{ desc: '', qty: 1, unit_cents: 0 }];
  const d = document.createElement('dialog');
  const jobSel = doc || fromEst ? `<input type="hidden" name="job_id" value="${(doc || fromEst).job_id}"><p><b>${esc((doc || fromEst).client_name)}</b> · ${esc((doc || fromEst).address || '')}</p>`
    : `<div class="field full"><label>${t('Obra')} *</label><select name="job_id">${jobs.map(j => `<option value="${j.id}" ${j.id === jobId ? 'selected' : ''}>${esc(j.client_name)}${j.address ? ' — ' + esc(j.address) : ''}</option>`).join('')}</select></div>`;
  const corrNote = !doc ? '' : asOwner ? (decided && doc.approvals_needed > 1 ? t('Es de más de {x}: este cambio necesita también la aprobación del otro dueño. Mientras tanto sigue valiendo la versión aprobada.', { x: fmt0(doc.dual_limit_cents) })
      : decided ? t('Ya está aprobado: al guardar, el gasto y lo acordado se ajustan solos por la diferencia y queda en el historial.') : t('El cambio se guarda y queda en el historial.'))
    : decided ? t('El dueño autorizó la corrección. Al mandarla, el dueño la revisa y mientras tanto sigue valiendo la versión aprobada.')
      : doc.status === 'rechazado' ? t('Corrija lo necesario y se vuelve a mandar al dueño.') : '';
  d.innerHTML = `<form novalidate><h2>${doc ? t('Corregir {x}', { x: docKind(type) + ' ' + doc.number }) : fromEst && isCO ? t('Change order al estimado {x}', { x: fromEst.number }) : fromEst ? t('Invoice del estimado {x}', { x: fromEst.number }) : isInv ? t('Nuevo invoice') : t('Nuevo estimado')}</h2>
    ${fromEst && isCO ? `<p class="small muted">${t('Trabajo adicional que no estaba en el estimado. Cuando el dueño lo acepte, se suma al total y aparece en el PDF del estimado.')}</p>` : ''}
    ${corrNote ? `<p class="small muted">${corrNote}</p>` : ''}
    ${fromEst && !isCO ? `<p class="small muted">${t('Puede cobrar todo o solo una parte (por ejemplo 50%). Ya facturado: {a} de {b}.', { a: fmt(fromEst.invoiced_cents), b: fmt(fromEst.with_cos_cents || fromEst.total_cents) })}</p>` : ''}
    <div class="error"></div><div class="fields">${jobSel}
      <div class="field"><label>${t('Número')}</label><input name="number" value="${esc(doc ? doc.number : '')}" placeholder="${t('Automático')}"></div>
      <div class="field"><label>${t('Fecha')}</label><input type="date" name="date" value="${esc(doc ? doc.date : today())}"></div>
      ${isInv ? `<div class="field"><label>${t('Fecha límite de pago')}</label><input type="date" name="due_date" value="${esc(doc ? doc.due_date : '')}"></div>` : ''}
      <div class="field full"><label>${t('Descripción del trabajo')}</label><input name="description" value="${esc(doc ? doc.description : fromEst ? fromEst.description : '')}"></div></div>
    <label>${t('Renglones')} *</label><div class="lines"></div>
    <button type="button" class="sm" data-addl>${t('+ Renglón')}</button>
    <div class="doc-total">${t('Total')}: <b data-total>$0.00</b></div>
    <div class="field full"><label>${t('Notas')}</label><textarea name="notes">${esc(doc ? doc.notes : '')}</textarea></div>
    ${doc ? `<div class="field full"><label>${t('¿Qué se corrigió?')}</label><input name="reason" placeholder="${t('Ej. se me olvidó un renglón, cambió la cantidad…')}"></div>` : ''}
    <div class="field full"><label>${t('Foto o PDF del documento (opcional)')}</label><input type="file" name="file" accept="image/*,application/pdf"></div>
    <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${!doc ? t('Enviar al dueño') : asOwner ? t('Guardar corrección') : decided || doc.status === 'rechazado' ? t('Mandar corrección') : t('Guardar')}</button></div></form>`;
  document.body.appendChild(d);
  const box = $('.lines', d);
  const draw = () => {
    box.innerHTML = lines.map((l, i) => `<div class="line" data-i="${i}"><input data-k="desc" placeholder="${t('Descripción')}" value="${esc(l.desc)}">
      <input data-k="qty" inputmode="decimal" value="${esc(l.qty)}" aria-label="${t('Cantidad')}"><input data-k="unit" inputmode="decimal" placeholder="0.00" value="${l.unit_cents ? (l.unit_cents / 100).toFixed(2) : ''}" aria-label="${t('Precio')}">
      <span class="amt">${fmt(Math.round((Number(l.qty) || 0) * (l.unit_cents || 0)))}</span>${lines.length > 1 ? '<button type="button" class="sm link" data-rm aria-label="✕">✕</button>' : '<span></span>'}</div>`).join('');
    $$('.line', box).forEach(row => {
      const l = lines[Number(row.dataset.i)];
      $$('input', row).forEach(inp => { inp.oninput = () => {
        if (inp.dataset.k === 'desc') l.desc = inp.value;
        if (inp.dataset.k === 'qty') l.qty = inp.value;
        if (inp.dataset.k === 'unit') l.unit_cents = toCents(inp.value);
        $('.amt', row).textContent = fmt(Math.round((Number(l.qty) || 0) * (l.unit_cents || 0))); total();
      }; });
      const rm = $('[data-rm]', row); if (rm) rm.onclick = () => { lines.splice(Number(row.dataset.i), 1); draw(); };
    });
    total();
  };
  const total = () => { $('[data-total]', d).textContent = fmt(lines.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * (l.unit_cents || 0)), 0)); };
  $('[data-addl]', d).onclick = () => { lines.push({ desc: '', qty: 1, unit_cents: 0 }); draw(); $$('.line input[data-k="desc"]', d).pop().focus(); };
  draw();
  const close = () => { d.close(); d.remove(); };
  $('[data-x]', d).onclick = close;
  d.addEventListener('cancel', e => { e.preventDefault(); close(); });
  $('form', d).onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = $('button[type=submit]', d), err = $('.error', d);
    try {
      if (lines.some(l => Number.isNaN(l.unit_cents))) throw new Error(t('Revise los precios'));
      btn.disabled = true;
      const body = { job_id: Number(f.job_id.value), type, number: f.number.value.trim(), date: f.date.value, due_date: f.due_date ? f.due_date.value : '',
        description: f.description.value.trim(), notes: f.notes.value.trim(), lines: lines.filter(l => l.desc.trim() || l.unit_cents).map(l => ({ desc: l.desc.trim(), qty: Number(l.qty), unit_cents: l.unit_cents })),
        file: await readDocFile(f.file.files[0]), from_estimate_id: fromEst ? fromEst.id : undefined, reason: f.reason ? f.reason.value.trim() : undefined };
      const r = doc ? await api('PUT', `/api/docs/${doc.id}`, body) : await api('POST', '/api/docs', body);
      close(); toast(!doc ? t('Enviado al dueño para su revisión') : asOwner && r.prev ? t('Guardado. Falta la aprobación del otro dueño.') : asOwner ? t('Corrección guardada') : r.status === 'enviado' && (decided || doc.status === 'rechazado') ? t('Corrección enviada al dueño') : t('Guardado'));
      if (after) after();
      if (!doc || (!asOwner && r.status === 'enviado' && (decided || doc.status === 'rechazado'))) notifyOwnersDoc(r);
      if (asOwner && decided && !r.prev) notifySubDoc(r);
      if (asOwner && r.prev) notifyOtherOwner(r);
    } catch (x) { err.textContent = x.message; btn.disabled = false; d.scrollTop = 0; }
  };
  d.showModal();
}

// Mensaje del sub a los dueños avisando que mandó un documento.
async function notifyOwnersDoc(r) {
  let owners = [];
  try { owners = (await api('GET', '/api/contacts/owners')).filter(o => o.phone); } catch { return; }
  if (!owners.length) return;
  const msg = lang => tl(lang, '{who} envió {kind} {num} por {m} para {place}. Revíselo en la app: {url}',
    { who: ME.name, kind: docKind(r.type, lang), num: r.number, m: fmt(r.total_cents), place: [r.client_name, r.address].filter(Boolean).join(', '), url: appUrl() });
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${t('Avisar a los dueños')}</h2><p class="small muted">${t('Ya está en la app del dueño. Para que lo vea rápido, mándele también un mensaje:')}</p>
    ${owners.map(o => `<div class="share-item"><b>${esc(o.name)}</b><p class="small msg">${esc(msg(o.lang))}</p><div class="row">${sendButtons(o.phone, msg(o.lang))}</div></div>`).join('')}
    <div class="foot"><button class="primary" type="submit">${t('Listo')}</button></div></form>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

// Un dueño ya aprobó: avisa al otro dueño para que también lo revise.
async function notifyOtherOwner(r) {
  let owners = [];
  try { owners = (await api('GET', '/api/contacts/owners')).filter(o => o.phone && o.name !== ME.name); } catch { return; }
  if (!owners.length) return;
  const msg = lang => tl(lang, '{who} ya aprobó un cambio de más de {lim} en {kind} {num} ({place}). Falta su aprobación: {url}',
    { who: ME.name, lim: fmt0(r.dual_limit_cents), kind: docKind(r.type, lang), num: r.number, place: [r.client_name, r.address].filter(Boolean).join(', '), url: appUrl() });
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${t('Avisar al otro dueño')}</h2><p class="small muted">${t('Ya le aparece en su app. Para que lo vea rápido, mándele también un mensaje:')}</p>
    ${owners.map(o => `<div class="share-item"><b>${esc(o.name)}</b><p class="small msg">${esc(msg(o.lang))}</p><div class="row">${sendButtons(o.phone, msg(o.lang))}</div></div>`).join('')}
    <div class="foot"><button class="primary" type="submit">${t('Listo')}</button></div></form>`;
  document.body.appendChild(d); d.addEventListener('close', () => d.remove()); d.showModal();
}

async function notifyOwnersPermission(r) {
  let owners = [];
  try { owners = (await api('GET', '/api/contacts/owners')).filter(o => o.phone); } catch { return; }
  if (!owners.length) return;
  const msg = lang => tl(lang, '{who} pide permiso para corregir {kind} {num} ({place}). Motivo: {why}. Autorícelo o niéguelo en la app: {url}',
    { who: ME.name, kind: docKind(r.type, lang), num: r.number, place: [r.client_name, r.address].filter(Boolean).join(', '), why: r.unlock_reason, url: appUrl() });
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${t('Avisar a los dueños')}</h2><p class="small muted">${t('Ya está en la app del dueño. Para que lo vea rápido, mándele también un mensaje:')}</p>
    ${owners.map(o => `<div class="share-item"><b>${esc(o.name)}</b><p class="small msg">${esc(msg(o.lang))}</p><div class="row">${sendButtons(o.phone, msg(o.lang))}</div></div>`).join('')}
    <div class="foot"><button class="primary" type="submit">${t('Listo')}</button></div></form>`;
  document.body.appendChild(d); d.addEventListener('close', () => d.remove()); d.showModal();
}

// Detalle de un documento (renglones, total, archivo).
function docDetail(d) {
  return `<div class="doc-head"><div><b>${docKind(d.type)} ${esc(d.number)}</b> ${docBadge(d)}<div class="small muted">${esc(d.sub_name || '')} · ${esc(d.client_name)} · ${fdate(d.date)}${d.due_date ? ' · ' + t('pagar antes del {d}', { d: fdate(d.due_date) }) : ''}</div></div></div>
    ${d.description ? `<p>${esc(d.description)}</p>` : ''}
    <table class="doc-lines"><thead><tr><th>${t('Descripción')}</th><th class="num">${t('Cant.')}</th><th class="num">${t('Precio')}</th><th class="num">${t('Importe')}</th></tr></thead><tbody>
    ${d.lines.map(l => `<tr><td>${esc(l.desc)}</td><td class="num">${l.qty}</td><td class="num">${fmt(l.unit_cents)}</td><td class="num">${fmt(l.amount_cents)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="3">${t('Total')}</td><td class="num">${fmt(d.total_cents)}</td></tr></tfoot></table>
    ${d.estimate ? `<p class="small muted">${t('Viene del estimado {x} ({m}).', { x: esc(d.estimate.number), m: fmt(d.estimate.total_cents) })}</p>` : ''}
    ${d.type === 'estimate' && d.change_orders && d.change_orders.length ? `<div class="cos"><b>${t('Change orders de este estimado')}</b>${d.change_orders.map(c => `<div class="row between small"><span>${esc(c.number)} — ${esc(c.description)} ${c.status !== 'aceptado' ? `<span class="badge b-cotizado">${t('Por revisar')}</span>` : ''}</span><b>${fmt(c.total_cents)}</b></div>`).join('')}
      <div class="row between"><span>${t('Total con change orders aprobados')}</span><b>${fmt(d.with_cos_cents)}</b></div></div>` : ''}
    ${d.type === 'estimate' && d.status === 'aceptado' ? `<p class="small">${t('Facturado hasta ahora: {a} de {b}.', { a: fmt(d.invoiced_cents), b: fmt(d.with_cos_cents || d.total_cents) })}</p>` : ''}
    ${d.unlock === 'pedido' ? `<div class="compare small"><b>${t('Pide permiso para corregir')}:</b> “${esc(d.unlock_reason)}”</div>` : ''}
    ${ME.role === 'owner' && d.approvals_needed > 1 && (d.unlock === 'pedido' || (d.prev && d.status === 'enviado')) ? `<div class="dual small">👥 ${t('Más de {x}: necesita a los 2 dueños.', { x: fmt0(d.dual_limit_cents) })}
      ${(d.unlock === 'pedido' ? d.unlock_ok_names : d.corr_ok_names).length ? ' ' + t('Ya aprobó: {x}.', { x: esc((d.unlock === 'pedido' ? d.unlock_ok_names : d.corr_ok_names).join(', ')) }) : ''}</div>` : ''}
    ${d.unlock === 'negado' && d.unlock_note ? `<p class="small"><b>${t('Permiso negado')}:</b> ${esc(d.unlock_note)}</p>` : ''}
    ${d.notes ? `<p class="small">📝 ${esc(d.notes)}</p>` : ''}
    ${d.owner_note ? `<p class="small"><b>${t('Nota del dueño')}:</b> ${esc(d.owner_note)}</p>` : ''}
    ${d.type === 'invoice' && d.status === 'aprobado' ? `<div class="paybox"><div class="row between"><b>${d.paid_cents >= d.total_cents ? '✓ ' + t('Pagado completo') : d.paid_cents ? t('Pago parcial') : t('Sin pagar')}</b><span class="small">${t('Pagado {a} de {b}', { a: fmt(d.paid_cents || 0), b: fmt(d.total_cents) })}</span></div>
      <div class="bar"><span style="width:${Math.min(100, Math.round((d.paid_cents || 0) * 100 / (d.total_cents || 1)))}%"></span></div>
      ${(d.payments || []).map(p => `<div class="small">↳ ${fdate(p.date)} · <b>${esc(payLabel(p.method) || '—')}</b>${p.reference ? ' ' + esc(p.reference) : ''} · ${fmt(p.amount_cents)}${p.note ? ' · ' + esc(p.note) : ''}</div>`).join('')}
      ${d.paid_cents < d.total_cents ? `<div class="small muted">${t('Falta: {m}', { m: fmt(d.total_cents - (d.paid_cents || 0)) })}</div>` : ''}</div>` : (d.paid_at ? `<p class="small pos">✓ ${t('Pagado el {d}', { d: fdate(d.paid_at) })}${d.paid_method ? ' · ' + esc(t(d.paid_method)) : ''}</p>` : '')}
    ${d.prev ? `<div class="compare"><b>${t('Corrección')}:</b> ${t('antes {a} → ahora {b}', { a: fmt(d.prev.total_cents), b: `<b>${fmt(d.total_cents)}</b>` })}
      <div class="small muted">${t('Antes')}: ${d.prev.lines.map(l => `${esc(l.desc)} (${l.qty} × ${fmt(l.unit_cents)})`).join(' · ')}</div></div>` : ''}
    <p class="row"><a class="btn sm primary" target="_blank" rel="noopener" href="${pdfLink(d)}">📄 ${t('PDF para imprimir')}</a>
    ${d.file_id ? `<a class="btn sm" target="_blank" rel="noopener" href="/files/${d.file_id}">${d.file_mime === 'application/pdf' ? '📎 ' + t('PDF que mandó el sub') : '🧾 ' + t('Ver foto')}</a>` : ''}</p>
    ${d.history && d.history.length ? `<details class="hist"><summary>${t('Historial')} (${d.history.length})</summary><ul>${d.history.map(h => `<li><span class="small muted">${fdate(h.at.slice(0, 10))}</span>
      ${esc(HIST()[h.action] || h.action)}${h.user_name ? ' · ' + esc(h.user_name) : ''}${h.total_before != null && h.total_after != null && h.total_before !== h.total_after ? ` · ${fmt(h.total_before)} → ${fmt(h.total_after)}` : ''}${h.note ? ` · “${esc(h.note)}”` : ''}</li>`).join('')}</ul></details>` : ''}`;
}
const HIST = () => ({ enviado: t('Enviado'), corregido: t('Corregido por el sub'), reenviado: t('Corregido y reenviado'), correccion_pedida: t('Corrección pedida por el sub'),
  correccion_aprobada: t('Corrección aprobada'), correccion_rechazada: t('Corrección rechazada: vuelve la versión anterior'), corregido_dueno: t('Corregido por el dueño'), permiso_pedido: t('Pidió permiso para corregir'), permiso_autorizado_1: t('Autorizó (falta el otro dueño)'), correccion_aprobada_1: t('Aprobó la corrección (falta el otro dueño)'),
  corregido_dueno_pendiente: t('Corregido por un dueño (espera al otro dueño)'), permiso_autorizado: t('Permiso autorizado'), permiso_negado: t('Permiso negado'),
  aceptado: t('Aceptado'), aprobado: t('Aprobado (registrado como gasto)'), rechazado: t('Rechazado'), pagado: t('Pagado'), no_pagado: t('Marcado como no pagado') });

// Dueño: revisar y aprobar / rechazar.
function reviewDocDialog(doc, after) {
  const isInv = doc.type === 'invoice';
  const dlg = document.createElement('dialog');
  const over = doc.estimate && doc.status === 'enviado' ? doc.total_cents > 0 : false;
  const isCorr = !!doc.prev;
  dlg.innerHTML = `<form novalidate><h2>${isCorr ? t('Revisar corrección') : t('Revisar {x}', { x: docKind(doc.type) })}</h2><div class="error"></div>${docDetail(doc)}
    ${doc.status === 'enviado' && isCorr ? `<div class="decide"><p class="small muted">${isInv ? t('Si la aprueba, el gasto de la obra cambia a {m} y la ganancia se recalcula. Si la rechaza, se queda la versión que ya había aprobado.', { m: fmt(doc.total_cents) })
        : t('Si la aprueba, lo acordado con el sub se ajusta por la diferencia. Si la rechaza, se queda la versión que ya había aceptado.')}</p>
      <div class="field full"><label>${t('Nota para el sub (opcional)')}</label><textarea name="note"></textarea></div><input type="checkbox" name="add" hidden></div>
      <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button type="button" class="danger" data-rej>${t('Rechazar corrección')}</button><button class="primary" type="submit">${t('Aprobar corrección')}</button></div>`
    : doc.status === 'enviado' ? `<div class="decide">
      <p class="small muted">${isInv ? t('Al aprobarlo se registra como gasto de la obra y la ganancia se recalcula sola.') : t('Al aceptarlo se suma a lo acordado con este sub. Todavía no es gasto: lo será cuando apruebe sus invoices.')}</p>
      <label class="check"><input type="checkbox" name="add" ${isInv && doc.estimate ? '' : 'checked'}> ${isInv && doc.estimate ? t('Sumar también a lo acordado (normalmente no: ya se sumó con el estimado)') : t('Sumar al total acordado con este sub')}</label>
      ${isInv ? `<div class="fields"><div class="field"><label>${t('Fecha del gasto')}</label><input type="date" name="exp_date" value="${esc(doc.date)}"></div></div>
        <label class="check"><input type="checkbox" name="paid"> ${t('Ya está pagado completo')}</label>
        <div class="fields" data-pm hidden><div class="field"><label>${t('Forma de pago')}</label><select name="pm">${(SUBPAYS().length ? SUBPAYS() : PAY_METHODS_FALLBACK).map(m => `<option value="${esc(m)}">${esc(payLabel(m))}</option>`).join('')}</select></div>
          <div class="field"><label>${t('Referencia')}</label><input name="pref" placeholder="${t('# de cheque o confirmación')}"></div></div>` : ''}
      <div class="field full"><label>${t('Nota para el sub (opcional)')}</label><textarea name="note"></textarea></div></div>
      <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button type="button" class="danger" data-rej>${t('Rechazar')}</button><button class="primary" type="submit">${isInv ? t('Aprobar') : t('Aceptar')}</button></div>`
    : doc.unlock === 'pedido' ? `<div class="decide"><p class="small muted">${t('Si autoriza, el sub podrá corregirlo una vez y la corrección le vuelve a llegar para aprobarla. Mientras tanto, nada cambia.')}</p>
      <div class="field full"><label>${t('Nota para el sub (opcional)')}</label><textarea name="note"></textarea></div></div>
      <div class="foot"><button type="button" data-x>${t('Cerrar')}</button><button type="button" class="danger" data-deny>${t('Negar')}</button><button type="button" class="primary" data-auth>${t('Autorizar corrección')}</button></div>`
    : `<div class="foot">${!doc.paid_at && !doc.paid_cents && doc.status !== 'rechazado' ? `<button type="button" data-fix>${t('Corregir')}</button>` : ''}${isInv && doc.status === 'aprobado' ? (doc.paid_cents ? `<button type="button" data-unpay>${t('Quitar los pagos de este invoice')}</button>` : '') + (doc.paid_cents < doc.total_cents ? `<button type="button" class="primary" data-pay>${t('Registrar pago')}</button>` : '') : ''}<button type="button" data-x>${t('Cerrar')}</button></div>`}</form>`;
  document.body.appendChild(dlg);
  if (iApproved(doc)) {
    $$('[data-auth], button[type=submit]', dlg).forEach(b => b.remove());
    const fo = $('.foot', dlg); if (fo) fo.insertAdjacentHTML('afterbegin', `<span class="small muted" style="margin-right:auto">✓ ${t('Usted ya aprobó. Falta el otro dueño.')}</span>`);
  }
  const close = () => { dlg.close(); dlg.remove(); };
  $('[data-x]', dlg).onclick = close;
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  const f = $('form', dlg), err = $('.error', dlg);
  if (f.paid) f.paid.onchange = () => { $('[data-pm]', dlg).hidden = !f.paid.checked; };
  const decide = async action => {
    try {
      if (action === 'reject' && !isCorr && !f.note.value.trim()) { f.note.focus(); throw new Error(t('Escriba al sub por qué lo rechaza')); }
      const r = await api('POST', `/api/docs/${doc.id}/decide`, { action, note: f.note.value.trim(),
        ...(isCorr ? {} : { add_to_agreed: f.add.checked }),
        expense_date: f.exp_date ? f.exp_date.value : undefined, paid: f.paid ? f.paid.checked : false, paid_method: f.pm ? f.pm.value : '', paid_reference: f.pref ? f.pref.value.trim() : '' });
      close();
      if (action === 'accept' && isCorr && r.status === 'enviado') {
        toast(t('Aprobado por usted. Falta la aprobación del otro dueño.')); ME.pending = Math.max(0, (ME.pending || 1) - 1); renderNav();
        if (after) after(); notifyOtherOwner(r); return;
      }
      toast(isCorr ? (action === 'reject' ? t('Corrección rechazada') : t('Corrección aprobada')) : action === 'reject' ? t('Rechazado') : isInv ? t('Aprobado: registrado como gasto') : t('Aceptado'));
      ME.pending = Math.max(0, (ME.pending || 1) - 1); renderNav();
      if (after) after();
      notifySubDoc(r);
    } catch (x) { err.textContent = x.message; dlg.scrollTop = 0; }
  };
  f.onsubmit = e => { e.preventDefault(); decide('accept'); };
  const rej = $('[data-rej]', dlg); if (rej) rej.onclick = () => decide('reject');
  const pay = $('[data-pay]', dlg); if (pay) pay.onclick = () => { close(); subPayDialog({ id: doc.sub_id, name: doc.sub_name }, { docId: doc.id, after }); };
  if (false) pay.onclick = async () => {
    close(); let res;
    if (await formDialog({ title: t('Marcar pagado: {x}', { x: 'Invoice ' + doc.number }), fields: [
      { name: 'date', label: t('Fecha de pago'), type: 'date', value: today(), required: true },
      { name: 'method', label: t('Forma de pago'), hint: t('Cheque #, Zelle, efectivo…') }],
    intro: `<p class="small muted">${t('Solo se marca como pagado: el gasto ya se registró al aprobarlo, así no se cuenta doble.')}</p>`,
    onSubmit: async v => { res = await api('POST', `/api/docs/${doc.id}/paid`, v); } })) { toast(t('Marcado como pagado')); if (after) after(); notifySubDoc(res); }
  };
  const unl = async action => {
    try {
      const r = await api('POST', `/api/docs/${doc.id}/unlock-decide`, { action, note: f.note.value.trim() });
      const half = action === 'authorize' && r.unlock === 'pedido';
      close(); toast(half ? t('Autorizado por usted. Falta la autorización del otro dueño.') : action === 'authorize' ? t('Corrección autorizada') : t('Permiso negado'));
      ME.pending = Math.max(0, (ME.pending || 1) - 1); renderNav();
      if (after) after();
      if (half) notifyOtherOwner(r); else notifySubDoc(r);
    } catch (x) { err.textContent = x.message; }
  };
  const au = $('[data-auth]', dlg); if (au) au.onclick = () => unl('authorize');
  const de = $('[data-deny]', dlg); if (de) de.onclick = () => unl('deny');
  const fix = $('[data-fix]', dlg); if (fix) fix.onclick = () => { close(); docDialog({ type: doc.type, doc, asOwner: true, after }); };
  const unpay = $('[data-unpay]', dlg); if (unpay) unpay.onclick = async () => { if (await confirmDialog(t('¿Quitar todos los pagos registrados de este invoice?'))) act(() => api('POST', `/api/docs/${doc.id}/paid`, { paid: false }), t('Actualizado')).then(() => { close(); if (after) after(); }); };
  dlg.showModal();
}

// Mensaje al sub con la decisión, en su idioma.
function notifySubDoc(d) {
  if (!d || !d.sub_phone) return;
  const L2 = d.sub_lang || 'es';
  const v = { name: (d.sub_name || '').split(' ')[0], kind: docKind(d.type, L2), num: d.number, m: fmt(d.total_cents), place: [d.client_name, d.address].filter(Boolean).join(', ') };
  const last = (d.history || []).at(-1) || {};
  let m = last.action === 'permiso_autorizado' ? tl(L2, 'Hola {name}: le autorizamos corregir su {kind} {num} ({place}). Corríjalo en la app y nos llega para aprobarlo.', v)
    : last.action === 'permiso_negado' ? tl(L2, 'Hola {name}: no autorizamos cambiar su {kind} {num} ({place}); se queda como se aceptó.', v)
      : last.action === 'correccion_aprobada' ? tl(L2, 'Hola {name}: aprobamos la corrección de su {kind} {num} ({place}). Nuevo total: {m}.', v)
    : last.action === 'correccion_rechazada' ? tl(L2, 'Hola {name}: no aprobamos la corrección de su {kind} {num} ({place}); queda la versión anterior por {m}.', v)
      : last.action === 'corregido_dueno' ? tl(L2, 'Hola {name}: corregimos su {kind} {num} ({place}). Nuevo total: {m}.', v)
        : d.status === 'rechazado' ? tl(L2, 'Hola {name}: su {kind} {num} por {m} ({place}) fue rechazado.', v)
    : d.paid_at ? tl(L2, 'Hola {name}: su invoice {num} por {m} ({place}) fue pagado.', v)
      : d.type === 'invoice' ? tl(L2, 'Hola {name}: su invoice {num} por {m} ({place}) fue aprobado.', v)
        : tl(L2, 'Hola {name}: su estimado {num} por {m} ({place}) fue aceptado. Cuando haga el trabajo, conviértalo en invoice desde la app.', v);
  const extra = ['permiso_autorizado', 'permiso_negado'].includes(last.action) ? last.note : d.owner_note;
  if (extra) m += ' ' + extra;
  m += ' ' + appUrl();
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<form method="dialog"><h2>${t('Avisar al sub')}</h2><p class="small muted">${t('El sub ya lo ve en su app. Si quiere, mándele también un mensaje:')}</p>
    <div class="share-item"><b>${esc(d.sub_name)}</b><p class="small msg">${esc(m)}</p><div class="row">${sendButtons(d.sub_phone, m)}</div></div>
    <div class="foot"><button class="primary" type="submit">${t('Listo')}</button></div></form>`;
  document.body.appendChild(dlg); dlg.addEventListener('close', () => dlg.remove()); dlg.showModal();
}

// Lista de documentos (para el dueño en la obra y en Inicio).
function docRows(list, opts = {}) {
  if (!list.length) return `<p class="empty">${opts.empty || t('No hay estimados ni invoices.')}</p>`;
  return `<div class="docs">${list.map(d => `<button type="button" class="doc-row" data-doc="${d.id}">
    <span class="dk ${d.type}">${{ estimate: 'EST', invoice: 'INV', change_order: 'CO' }[d.type]}</span>
    <span class="dm"><b>${esc(d.sub_name || '')}</b> · ${esc(d.number)}${opts.showJob ? ' · ' + esc(d.client_name) : ''}<span class="small muted">${esc(d.description)}</span></span>
    <span class="dr"><b>${fmt(d.total_cents)}</b>${docBadge(d)}</span></button>`).join('')}</div>`;
}
function bindDocRows(box, list, after) { $$('[data-doc]', box).forEach(b => { b.onclick = () => reviewDocDialog(list.find(x => x.id === Number(b.dataset.doc)), after); }); }

// Dueño, Inicio: lo que hay que revisar o pagar.
async function ownerDocsCard(box, refresh) {
  const all = await api('GET', '/api/docs');
  const review = all.filter(d => d.status === 'enviado' || d.unlock === 'pedido'), unpaid = all.filter(d => d.type === 'invoice' && d.status === 'aprobado' && !d.paid_at);
  if (!review.length && !unpaid.length) { box.remove(); return; }
  box.className = 'card notices';
  box.innerHTML = `<h2>🧾 ${t('Estimados e invoices de subs')}</h2>
    ${review.length ? `<h3>${t('Por revisar')}</h3>${docRows(review, { showJob: true })}` : ''}
    ${unpaid.length ? `<h3 style="margin-top:.8rem">${t('Invoices aprobados por pagar')} · ${fmt(unpaid.reduce((s, d) => s + d.total_cents, 0))}</h3>${docRows(unpaid, { showJob: true })}` : ''}`;
  bindDocRows(box, all, refresh);
}

// Sub: sus estimados e invoices.
async function viewWorkerDocs(app, newForJob) {
  const [docs, jobs] = await Promise.all([api('GET', '/api/docs'), api('GET', '/api/jobs')]);
  const reload = () => viewWorkerDocs(app);
  const S = DOC_STATUS();
  app.innerHTML = `<h1>${t('Estimados e invoices')}</h1>
    <p class="small muted">${t('Mande sus estimados e invoices al dueño desde aquí. Cuando un estimado sea aceptado, lo puede convertir en invoice.')}</p>
    <div class="row" style="margin-bottom:1rem"><button class="primary" id="ne">+ ${t('Estimado')}</button><button class="primary" id="ni">+ Invoice</button></div>
    ${docs.length ? docs.map(d => `<div class="card wdoc" data-id="${d.id}">
      <div class="row between"><b>${docKind(d.type)} ${esc(d.number)}</b>${docBadge(d)}</div>
      <div class="small muted">${esc(d.client_name)} · ${fdate(d.date)}</div>
      <div class="row between" style="margin-top:.35rem"><span>${esc(d.description)}</span><b>${fmt(d.total_cents)}</b></div>
      ${d.type === 'estimate' && d.status === 'aceptado' ? `<div class="small" style="margin-top:.35rem">${d.change_orders && d.change_orders.length ? t('Con change orders: {x}', { x: fmt(d.with_cos_cents) }) + ' · ' : ''}${t('Facturado: {a} de {b}', { a: fmt(d.invoiced_cents), b: fmt(d.with_cos_cents || d.total_cents) })}</div>` : ''}
      ${d.unlock === 'pedido' ? `<div class="small muted" style="margin-top:.35rem">⏳ ${t('Pidió permiso para corregir. Esperando al dueño.')}</div>` : ''}
      ${d.unlock === 'negado' ? `<div class="small" style="margin-top:.35rem">${t('Permiso negado')}${d.unlock_note ? ': ' + esc(d.unlock_note) : ''}</div>` : ''}
      ${d.owner_note ? `<div class="small" style="margin-top:.35rem"><b>${t('Nota del dueño')}:</b> ${esc(d.owner_note)}</div>` : ''}
      <div class="row" style="margin-top:.6rem"><button class="sm" data-v>${t('Ver')}</button>
        ${d.status === 'enviado' && !d.prev ? `<button class="sm" data-e>${t('Corregir')}</button><button class="sm danger" data-r>${t('Retirar')}</button>` : ''}
        ${d.status === 'rechazado' ? `<button class="sm primary" data-e>${t('Corregir y reenviar')}</button>` : ''}
        ${['aceptado', 'aprobado'].includes(d.status) && !d.paid_at && !d.paid_cents && d.unlock === 'autorizado' ? `<button class="sm primary" data-e>${t('Corregir (autorizado)')}</button>` : ''}
        ${['aceptado', 'aprobado'].includes(d.status) && !d.paid_at && !d.paid_cents && ['', 'negado'].includes(d.unlock) ? `<button class="sm" data-u>${t('Pedir permiso para corregir')}</button>` : ''}
        ${d.type === 'estimate' && d.status === 'aceptado' ? `<button class="sm" data-co>+ Change order</button>` : ''}
        <a class="btn sm" target="_blank" rel="noopener" href="${pdfLink(d)}">📄 PDF</a>
        ${d.type === 'estimate' && d.status === 'aceptado' && d.invoiced_cents < d.total_cents ? `<button class="sm primary" data-c>${t('Convertir en invoice')}</button>` : ''}</div></div>`).join('')
    : `<div class="card empty">${t('Todavía no ha mandado estimados ni invoices.')}</div>`}`;
  if (!jobs.length) { $('#ne').disabled = true; $('#ni').disabled = true; }
  $('#ne').onclick = () => docDialog({ type: 'estimate', jobs, after: reload });
  $('#ni').onclick = () => docDialog({ type: 'invoice', jobs, after: reload });
  $$('.wdoc', app).forEach(c => {
    const d = docs.find(x => x.id === Number(c.dataset.id));
    $('[data-v]', c).onclick = () => { const dl = document.createElement('dialog'); dl.innerHTML = `<form method="dialog">${docDetail(d)}<div class="foot"><button class="primary" type="submit">${t('Cerrar')}</button></div></form>`; document.body.appendChild(dl); dl.addEventListener('close', () => dl.remove()); dl.showModal(); };
    const e = $('[data-e]', c); if (e) e.onclick = () => docDialog({ type: d.type, doc: d, after: reload });
    const r = $('[data-r]', c); if (r) r.onclick = async () => { if (await confirmDialog(t('¿Retirar {x}?', { x: docKind(d.type) + ' ' + d.number }), t('Sí, retirar'))) act(() => api('DELETE', `/api/docs/${d.id}`), t('Retirado')).then(reload); };
    const cv = $('[data-c]', c); if (cv) cv.onclick = () => docDialog({ type: 'invoice', fromEst: d, after: reload });
    const co = $('[data-co]', c); if (co) co.onclick = () => docDialog({ type: 'change_order', fromEst: d, after: reload });
    const u = $('[data-u]', c); if (u) u.onclick = async () => {
      let r;
      if (await formDialog({ title: t('Pedir permiso para corregir {x}', { x: docKind(d.type) + ' ' + d.number }), submit: t('Pedir permiso'),
        intro: `<p class="small muted">${t('Ya fue aceptado, así que para cambiarlo necesita la autorización de un dueño. Explique qué necesita corregir.')}</p>`,
        fields: [{ name: 'reason', label: t('¿Qué necesita corregir y por qué?'), type: 'textarea', required: true }],
        onSubmit: async v => { r = await api('POST', `/api/docs/${d.id}/unlock`, v); } })) {
        toast(t('Solicitud enviada al dueño')); reload(); notifyOwnersPermission(r);
      }
    };
  });
  if (newForJob) docDialog({ type: newForJob.type, jobs, jobId: newForJob.job, after: reload });
}

// ================= ESCANEAR TICKETS =================
const jobCode = id => 'EE-' + String(id).padStart(4, '0');
const WHY = () => ({ codigo: t('por el código de obra en el ticket'), direccion: t('por la dirección en el ticket'), cliente: t('por el nombre del cliente en el ticket'),
  unica: t('es su única obra activa'), obra: t('lo escaneó desde la obra'), movido: t('movido a mano') });
let scanJobsCache = null;
async function scanJobs() {
  if (!scanJobsCache) scanJobsCache = (await api('GET', '/api/jobs')).filter(j => !['cancelado', 'terminado'].includes(j.status))
    .sort((x, y) => (x.status === 'activo' ? 0 : 1) - (y.status === 'activo' ? 0 : 1));
  setTimeout(() => { scanJobsCache = null; }, 60000);
  return scanJobsCache;
}
// Abre la cámara / archivos y sube cada ticket.
function scanFlow(jobId, after) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*,application/pdf'; inp.multiple = true;
  if (/android|iphone|ipad/i.test(navigator.userAgent)) inp.setAttribute('capture', 'environment');
  inp.onchange = async () => {
    const files = [...inp.files]; if (!files.length) return;
    toast(files.length > 1 ? t('Leyendo {n} tickets…', { n: files.length }) : t('Leyendo ticket…'));
    const results = [];
    for (const f of files) {
      try { results.push(await api('POST', '/api/scans', { file: await readDocFile(f), job_id: jobId || undefined })); }
      catch (e) { toast(e.message, true); }
    }
    if (results.length) scanResults(results, after);
  };
  inp.click();
}
function scanSummary(s) {
  const d = s.expense ? { vendor: s.expense.vendor, total_cents: s.expense.amount_cents, date: s.expense.date } : s.data || {};
  return `${esc(d.vendor || t('Proveedor sin leer'))} · <b>${d.total_cents ? fmt(d.total_cents) : '—'}</b>${d.date ? ' · ' + fdate(d.date) : ''}`;
}
// Ventana con el resultado de cada ticket.
async function scanResults(list, after) {
  const jobs = await scanJobs();
  const opts = sel => jobs.map(j => `<option value="${j.id}" ${j.id === sel ? 'selected' : ''}>${esc(j.client_name)} (${jobCode(j.id)})</option>`).join('');
  const d = document.createElement('dialog');
  const render = () => {
    d.innerHTML = `<form method="dialog" novalidate><h2>${t('Tickets escaneados')}</h2>${list.map((s, i) => {
      const da = s.data || {};
      if (s.status === 'guardado') return `<div class="scan ok" data-i="${i}"><div>✓ <b>${t('Guardado en {x}', { x: esc(s.job ? s.job.client_name : '') })}</b></div>
        <div class="small">${scanSummary(s)}</div><div class="small muted">${WHY()[s.why] || ''}</div>
        <div class="row"><select data-mv style="width:auto;min-height:36px">${opts(s.job_id)}</select><button type="button" class="sm" data-move>${t('Cambiar obra')}</button></div></div>`;
      if (s.status === 'descartado') return `<div class="scan small muted">${t('Descartado')}</div>`;
      return `<div class="scan todo" data-i="${i}"><div>${s.job && !s.duplicate ? `<b>👀 ${t('Revise y toque Guardar')}</b> <span class="small muted">· ${t('la app cree que es de')} <b>${esc(s.job.client_name)}</b></span>` : `<b>${t('Por asignar')}</b> ${s.job ? `<span class="small muted">· ${t('sugerida')}: ${esc(s.job.client_name)} (${WHY()[s.why] || ''})</span>` : ''}`}</div>
        ${s.duplicate ? `<div class="compare small">⚠️ ${s.duplicate.same_scan ? t('Esta misma foto ya se había escaneado.') : t('Parece repetido: ya hay un gasto de {m} el {d} en {x}.', { m: fmt(s.duplicate.amount_cents), d: fdate(s.duplicate.date), x: esc(s.duplicate.client_name) })}</div>` : ''}
        ${s.error || !s.data ? `<div class="small muted">${t('No se pudo leer el ticket solo: llene los datos.')}</div>` : ''}
        <div class="fields"><div class="field full"><label>${t('Obra')}</label><select data-k="job_id"><option value="">—</option>${opts(s.job_id)}</select></div>
        <div class="field"><label>${t('Monto ($)')}</label><input data-k="amount" inputmode="decimal" value="${da.total_cents ? (da.total_cents / 100).toFixed(2) : ''}"></div>
        <div class="field"><label>${t('Fecha')}</label><input data-k="date" type="date" value="${esc(da.date || today())}"></div>
        <div class="field"><label>${t('Dónde')}</label><input data-k="vendor" value="${esc(da.vendor || '')}"></div>
        <div class="field"><label>${t('Categoría')}</label><select data-k="category">${CATS().filter(c => BOSS() || c.key !== 'subcontratistas').map(c => `<option value="${c.key}" ${c.key === (da.category || 'material') ? 'selected' : ''}>${esc(L(c))}</option>`).join('')}</select></div></div>
        <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="/api/scans/${s.id}/file">🧾 ${t('Ver ticket')}</a><button type="button" class="sm" data-full>➗ ${t('Con número / dividir')}</button><button type="button" class="sm danger" data-disc>${t('Descartar')}</button><button type="button" class="sm primary" data-save>✓ ${t('Guardar gasto')}</button></div></div>`;
    }).join('')}<div class="foot"><button class="primary" type="submit">${t('Listo')}</button></div></form>`;
    $$('.scan[data-i]', d).forEach(el => {
      const i = Number(el.dataset.i), s = list[i];
      const sv = $('[data-save]', el); if (sv) sv.onclick = async () => {
        const v = k => $(`[data-k="${k}"]`, el).value;
        try {
          if (!v('job_id')) throw new Error(t('Elija la obra'));
          list[i] = await api('POST', `/api/scans/${s.id}/file`, { job_id: Number(v('job_id')), amount_cents: toCents(v('amount')), date: v('date'), vendor: v('vendor'), category: v('category') });
          toast(t('Gasto guardado')); render();
        } catch (e) { toast(e.message, true); }
      };
      const fu = $('[data-full]', el); if (fu) fu.onclick = async () => { const r = await receiptDialog({ scan: s }); if (r && !r.pending) { list[i] = { ...s, status: 'guardado', why: '', job: r.expenses.length ? s.job : null, expense: { vendor: (s.data || {}).vendor, amount_cents: r.total_cents, date: (s.data || {}).date } }; render(); } };
      const ds = $('[data-disc]', el); if (ds) ds.onclick = async () => { await act(() => api('POST', `/api/scans/${s.id}/discard`)); list[i] = { ...s, status: 'descartado' }; render(); };
      const mv = $('[data-move]', el); if (mv) mv.onclick = async () => {
        try { list[i] = await api('POST', `/api/scans/${s.id}/move`, { job_id: Number($('[data-mv]', el).value) }); toast(t('Movido')); render(); } catch (e) { toast(e.message, true); }
      };
    });
  };
  render();
  document.body.appendChild(d);
  d.addEventListener('close', () => { d.remove(); if (after) after(); ME.pending !== undefined && api('GET', '/api/status').then(st => { ME.pending = st.user.pending; renderNav(); }).catch(() => {}); });
  d.showModal();
}
// Dueño: tickets que esperan obra.
async function ownerScansCard(box, refresh) {
  const all = await api('GET', '/api/scans');
  const todo = all.filter(s => s.status === 'por_asignar');
  if (!todo.length) { box.remove(); return; }
  box.className = 'card notices';
  box.innerHTML = `<div class="row between"><h2>📷 ${t('Tickets por asignar')}</h2><button class="sm primary" data-all>${t('Revisar ({n})', { n: todo.length })}</button></div>
    ${todo.slice(0, 5).map(s => `<div class="notice small"><span>${scanSummary(s)} · ${esc(s.by_name || '')}${s.job ? ' · ' + t('sugerida') + ': ' + esc(s.job.client_name) : ''}${s.duplicate ? ' · ⚠️ ' + t('posible repetido') : ''}</span></div>`).join('')}`;
  $('[data-all]', box).onclick = () => scanResults(todo, refresh);
}
// Botón flotante de escanear (teléfono).
function renderFab() {
  let fab = $('#fab');
  if (!ME || !['owner', 'pm', 'admin'].includes(ME.role)) { if (fab) fab.remove(); return; } // el sub tiene su botón grande en la pantalla
  if (!fab) { fab = document.createElement('button'); fab.id = 'fab'; document.body.appendChild(fab); }
  fab.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>${t('Escanear')}</span>`;
  fab.setAttribute('aria-label', t('Escanear ticket'));
  fab.onclick = () => { const m = /^#\/obra\/(\d+)/.exec(location.hash); scanFlow(m ? Number(m[1]) : null, () => route()); };
}

// ================= CASOS: problemas y preguntas con fotos =================
const CASE_ST = () => ({ abierto: BOSS() ? t('Abierto') : t('En revisión'), esperando_cliente: ME.role === 'client' ? t('Esperando su respuesta') : t('Esperando al cliente'), resuelto: t('Resuelto') });
const CASE_BADGE = { abierto: 'b-en_progreso', esperando_cliente: 'b-pendiente', resuelto: 'b-hecho' };
const fstamp = s => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString(LANG === 'en' ? 'en-US' : 'es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
// Responsable y fecha límite de un caso, en una línea.
function caseMeta(c) {
  if (ME.role === 'client') return '';
  const who = c.assignee_name ? `📌 ${c.mine ? t('Le toca a usted') : t('Responsable: {x}', { x: esc(c.assignee_name) })}` : (BOSS() ? `<span class="muted">📌 ${t('Sin responsable')}</span>` : '');
  const due = c.due_date ? `<span class="badge ${c.overdue ? 'b-late' : 'b-pendiente'}">${c.overdue ? t('Vencido') + ' · ' : ''}${t('para el {d}', { d: fdate(c.due_date) })}</span>` : '';
  return [who, due].filter(Boolean).map(x => `<span>${x}</span>`).join('');
}
function caseRows(list, showJob) {
  if (!list.length) return `<p class="empty">${ME.role === 'client' ? t('Si tiene una duda sobre su proyecto, pregúntenos aquí con fotos.') : t('No hay casos. Cuando haya un problema o una duda, ábralo aquí con fotos.')}</p>`;
  return list.map(c => `<div class="case-row ${c.unread ? 'unread' : ''}" data-case="${c.id}">
    <div class="ic">${c.kind === 'pregunta' ? '❓' : '⚠️'}</div>
    <div style="flex:1;min-width:0"><div class="title">${c.urgent ? `<span class="badge b-urg">${t('Urgente')}</span> ` : ''}${esc(c.title_tr || c.title)}${c.title_tr ? ' <span class="small muted" title="' + esc(c.title) + '">🌐</span>' : ''}</div>
      <div class="small muted">${[showJob ? esc(c.client_name) : '', esc(c.by_name), c.last ? fstamp(c.last.at) : ''].filter(Boolean).join(' · ')}</div>
      ${c.last ? `<div class="small ellip">${c.last.by ? `<b>${esc(c.last.by)}:</b> ` : ''}${esc(c.last.body_tr || c.last.body)}</div>` : ''}
      ${c.status !== 'resuelto' && (c.assignee_name || c.due_date) ? `<div class="case-plan small">${caseMeta(c)}</div>` : ''}</div>
    <div class="col-end"><span class="badge ${CASE_BADGE[c.status]}">${CASE_ST()[c.status]}</span>${c.unread ? `<span class="dot-new">${c.unread}</span>` : ''}
      ${BOSS() && c.client_visible ? `<span class="small muted">👁 ${t('cliente')}</span>` : ''}</div></div>`).join('');
}
function bindCaseRows(root, after) { $$('[data-case]', root).forEach(r => { r.onclick = () => openCase(Number(r.dataset.case), after); }); }

// Selector de varias fotos (se achican antes de subir).
function photoPicker(el) {
  const files = [];
  const draw = () => {
    el.innerHTML = `<div class="pp">${files.map((f, i) => `<span class="thumb"><img src="${f}" alt=""><button type="button" data-rm="${i}" aria-label="x">×</button></span>`).join('')}
      <label class="btn sm">📷 ${t('Agregar fotos')}<input type="file" accept="image/*" multiple hidden></label></div>`;
    $('input', el).onchange = async e => {
      for (const f of [...e.target.files].slice(0, 8 - files.length)) { try { files.push(await compressImage(f, 1600, 0.8)); } catch { toast(t('No se pudo leer el archivo'), true); } }
      draw();
    };
    $$('[data-rm]', el).forEach(b => { b.onclick = () => { files.splice(Number(b.dataset.rm), 1); draw(); }; });
  };
  draw();
  return () => files.slice();
}

// "Mis pendientes": lo que le toca a esta persona (casos a su cargo, sin leer o esperando su respuesta, y tareas atrasadas).
async function myPendingCard(box, after) {
  let list = [];
  try { list = await api('GET', '/api/my-pending'); } catch { box.remove(); return; }
  if (!list.length) { box.className = 'card mypend ok'; box.innerHTML = `<h2>✅ ${t('Mis pendientes')}</h2><p class="small muted">${t('No tiene nada pendiente. Aquí le saldrán los casos a su cargo, los que esperan su respuesta y las tareas atrasadas.')}</p>`; return; }
  const WHY = { unread: t('Mensaje nuevo'), your_turn: t('Le toca contestar'), assigned: t('A su cargo') };
  box.className = 'card mypend';
  box.innerHTML = `<div class="row between"><h2>📌 ${t('Mis pendientes')} <span class="badge b-late">${list.length}</span></h2></div>
    ${list.slice(0, 12).map(x => `<div class="pend-row" ${x.kind === 'case' ? `data-pcase="${x.id}"` : x.kind === 'permit_insp' ? `data-pinsp="${x.id}" data-job="${x.job_id}"` : x.kind === 'insp_result' ? `data-pres="${x.id}"` : x.kind === 'roughin' ? `data-prough="${x.id}" data-job="${x.job_id}"` : x.kind === 'avail' ? `data-pavail="${x.id}"` : `data-go="#/obra/${x.job_id}${x.kind === 'selection' ? '/materiales' : ''}"`}>
      <span class="ic">${x.kind === 'selection' ? '🎨' : x.kind === 'case' ? (x.urgent ? '🚨' : '💬') : x.kind === 'permit_insp' ? '🏛️' : x.kind === 'insp_result' ? '⏰' : x.kind === 'roughin' ? '📷' : x.kind === 'avail' ? '📅' : '🗓️'}</span>
      <div style="flex:1;min-width:0"><b>${x.kind === 'selection' ? (x.changed ? t('El cliente cambió algo aprobado: {x}', { x: esc(x.title) }) : t('Falta que el cliente escoja: {x}', { x: esc(x.title) })) + (x.blocks ? ` <span class="badge b-late">${t('Detiene la tarea')}</span>` : '') : x.kind === 'permit_insp' ? t('Permiso aprobado: ¿qué inspecciones pidió la ciudad?') : x.kind === 'insp_result' ? t('¿Pasó la inspección? {x}', { x: esc(x.title) }) : x.kind === 'roughin' ? t('Confirme con foto antes de que cierren: {x}', { x: esc(x.title) }) : x.kind === 'avail' ? t('¿Puede empezar este trabajo el {d}?', { d: fdate(x.due) }) : esc(x.kind === 'task' ? taskTitle(x.title) : (x.title_tr || x.title))}</b><div class="small muted">${esc(x.job)}${x.kind === 'permit_insp' ? ' · ' + esc(x.title) : ''}${x.who ? ' · ' + esc(x.who) : ''}</div></div>
      <div class="col-end">${x.kind === 'case' ? `<span class="badge ${x.why === 'assigned' ? 'b-pendiente' : 'b-en_progreso'}">${WHY[x.why]}</span>` : x.kind === 'permit_insp' ? `<span class="badge b-late">${t('Capturar')}</span>` : x.kind === 'insp_result' ? `<span class="badge b-late">${t('Sin resultado')}</span>` : x.kind === 'roughin' ? `<span class="badge b-pendiente">📷 ${t('Foto')}</span>` : x.kind === 'avail' ? `<span class="badge b-late">${t('Contestar')}</span>` : `<span class="badge ${x.overdue ? 'b-late' : 'b-en_progreso'}">${x.overdue ? t('Atrasada') : t('Hoy')}</span>`}
        ${x.due ? `<span class="small ${x.overdue ? 'neg' : 'muted'}">${x.kind === 'case' && x.overdue ? t('Vencido') + ' · ' : ''}${fdate(x.due)}</span>` : ''}</div></div>`).join('')}
    ${list.length > 12 ? `<p class="small muted">${t('Y {n} más.', { n: list.length - 12 })}</p>` : ''}`;
  $$('[data-pcase]', box).forEach(r => { r.onclick = () => openCase(Number(r.dataset.pcase), after); });
  $$('[data-pres]', box).forEach(r => { r.onclick = async () => { if (await inspResultDialog({ id: Number(r.dataset.pres), name: (list.find(x => x.kind === 'insp_result' && x.id === Number(r.dataset.pres)) || {}).title })) { if (after) after(); else myPendingCard(box, after); } }; });
  $$('[data-prough]', box).forEach(r => { r.onclick = async () => { if (await roughConfirmDialog({ id: Number(r.dataset.prough), label: (list.find(x => x.kind === 'roughin' && x.id === Number(r.dataset.prough)) || {}).title })) { if (after) after(); else myPendingCard(box, after); } }; });
  $$('[data-pavail]', box).forEach(r => { r.onclick = async () => { const x = list.find(y => y.kind === 'avail' && y.id === Number(r.dataset.pavail)); if (await availDialog({ id: x.id, client_name: x.job, needed_date: x.due })) { if (after) after(); else myPendingCard(box, after); } }; });
  $$('[data-pinsp]', box).forEach(r => { r.onclick = async () => { if (await inspectionsDialog(Number(r.dataset.job), Number(r.dataset.pinsp))) { if (after) after(); else myPendingCard(box, after); } }; });
  $$('[data-go]', box).forEach(r => { r.onclick = () => { location.hash = r.dataset.go; }; });
}

// Abrir un caso nuevo.
async function newCaseDialog({ jobId, jobs, after }) {
  const isOwner = BOSS(), isClient = ME.role === 'client';
  let people = [];
  const loadPeople = async jid => { try { people = jid ? await api('GET', `/api/issues-people?job_id=${jid}`) : []; } catch { people = []; } };
  if (isOwner && jobId) await loadPeople(jobId);
  const ROLEN = { owner: t('Dueño'), pm: 'PM', worker: t('Sub') };
  const peopleFields = () => `<div class="field full"><label>${t('Subs en el caso')}</label><div class="pick-people">${people.filter(p => p.role === 'worker').map(p => `<label class="check"><input type="checkbox" name="member" value="${p.id}"> <span>${esc(p.name)}${p.trade ? `<br><span class="small muted">${esc(p.trade)}</span>` : ''}</span></label>`).join('') || `<span class="small muted">${t('Esta obra no tiene subs con acceso a la app.')}</span>`}</div>
      <div class="small muted">${t('Ven y contestan lo interno del caso. Nunca ven lo que se habla con el cliente.')}</div></div>
    <div class="field"><label>${t('Responsable')}</label><select name="assignee"><option value="">${t('— sin responsable —')}</option>${people.map(p => `<option value="${p.id}">${esc(p.name)}${p.me ? ' (' + t('yo') + ')' : ''} · ${ROLEN[p.role] || ''}</option>`).join('')}</select></div>
    <div class="field"><label>${t('Fecha límite')}</label><input type="date" name="due"></div>`;
  const d = document.createElement('dialog');
  d.innerHTML = `<form novalidate><h2>${isClient ? t('Hacer una pregunta') : t('Nuevo caso')}</h2>
    <p class="small muted">${isClient ? t('Explíquenos su duda y mande fotos si ayudan. Le respondemos en la app.')
      : ME.role === 'worker' ? t('Explique el problema y mande fotos. Lo ve solo la empresa: ellos deciden y, si hace falta, hablan con el dueño de la casa. No siga con esa parte hasta que le respondan.')
      : t('Interno: lo ven los dueños (y el sub que elija). Para el cliente: le llega la explicación con las fotos.')}</p>
    <div class="fields">
    ${jobId ? '' : `<div class="field full"><label>${t('Obra')}</label><select name="job_id">${(jobs || []).map(j => `<option value="${j.id}">${esc(j.client_name)}${j.address ? ' — ' + esc(j.address) : ''}</option>`).join('')}</select></div>`}
    ${isClient ? '' : `<div class="field"><label>${t('Tipo')}</label><select name="kind"><option value="problema">⚠️ ${t('Problema u obstáculo')}</option><option value="pregunta">❓ ${t('Pregunta')}</option></select></div>
      <div class="field"><label class="check"><input type="checkbox" name="urgent"> ${t('Urgente: el trabajo está detenido')}</label></div>`}
    ${isOwner ? `<div class="field full"><label>${t('¿Quién lo ve?')}</label><select name="who"><option value="int">${t('Interno (empresa y los subs que elija)')}</option><option value="cli">${t('Para el cliente (dueño de la casa)')}</option></select></div>
      <div data-people class="fields full" style="grid-column:1/-1">${peopleFields()}</div>` : ''}
    <div class="field full"><label>${t('¿De qué se trata?')} *</label><input name="title" maxlength="140" placeholder="${esc(isClient ? t('Ej.: ¿Este es el color de piedra que escogimos?') : t('Ej.: Tubería de gas donde va la zapata'))}"></div>
    <div class="field full"><label>${t('Explicación')} *</label><textarea name="body" rows="5" placeholder="${esc(isClient ? '' : t('Qué encontró, dónde, qué opciones ve y qué necesita que se decida.'))}"></textarea></div>
    <div class="field full"><label>${t('Fotos')}</label><div data-pp></div></div></div>
    <p class="error-msg" hidden></p>
    <div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Enviar')}</button></div></form>`;
  document.body.appendChild(d);
  const getPhotos = photoPicker($('[data-pp]', d));
  $('[data-x]', d).onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  if (isOwner && !jobId) {
    const sel = $('[name=job_id]', d);
    const refresh = async () => { await loadPeople(Number(sel.value)); $('[data-people]', d).innerHTML = peopleFields(); };
    sel.onchange = refresh; refresh();
  }
  $('form', d).onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = $('button[type=submit]', d);
    const who = f.who ? f.who.value : '';
    const memberIds = $$('[name=member]:checked', d).map(x => Number(x.value));
    const body = { job_id: jobId || Number(f.job_id.value), title: f.title.value, body: f.body.value, kind: f.kind ? f.kind.value : 'pregunta', urgent: f.urgent ? f.urgent.checked : false,
      photos: getPhotos(), member_ids: isOwner ? memberIds : undefined, assignee_id: isOwner && f.assignee && f.assignee.value ? Number(f.assignee.value) : undefined,
      due_date: isOwner && f.due ? f.due.value : undefined, to_client: who === 'cli' };
    btn.disabled = true;
    try {
      const c = await api('POST', '/api/issues', body);
      d.close(); toast(t('Enviado'));
      if (after) after();
      caseShare(c, who === 'cli' ? 'cliente' : 'interno', body.title);
    } catch (err) { const m = $('.error-msg', d); m.hidden = false; m.textContent = err.message; btn.disabled = false; }
  };
  d.showModal();
}

// Después de mandar: avisar por WhatsApp a quien corresponde (en su idioma).
async function caseShare(c, visibility, title) {
  const job = c.client_name || '';
  if (ME.role === 'client') return;
  let people = [];
  if (ME.role === 'worker') {
    try { people = (await api('GET', '/api/contacts/owners')).filter(o => o.phone).map(o => ({ ...o, text: tl(o.lang, '{who} abrió un caso en {job}: “{x}”. Véalo con fotos en la app: {url}', { who: ME.name, job, x: title, url: appUrl() }) })); } catch { /* */ }
  } else {
    let full; try { full = await api('GET', `/api/issues/${c.id}`); } catch { return; }
    if (visibility === 'cliente' && full.client) {
      const l = full.client.lang || 'es';
      people.push({ name: full.client.name, phone: full.client.phone, email: full.client.email, lang: l, client: true,
        text: tl(l, 'Elevated Exteriors: tenemos algo que comentarle sobre su proyecto: “{x}”. Véalo con fotos en la app: {url}', { x: title || full.title, url: appUrl() })
          + (full.client.has_portal ? '' : ' ' + tl(l, '(Pídanos su acceso a la app si aún no lo tiene.)')) });
    }
    if (visibility === 'interno') for (const w of (full.workers || (full.worker ? [full.worker] : []))) {
      const l = w.lang || 'es';
      people.push({ name: w.name, phone: w.phone, lang: l, text: tl(l, 'Elevated Exteriors: hay una respuesta sobre “{x}” en {job}. Véala en la app: {url}', { x: title || full.title, job: full.client_name, url: appUrl() }) });
    }
  }
  if (!people.length) return;
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${t('Avisar por mensaje')}</h2><p class="small muted">${t('Ya quedó en la app. Para que lo vean rápido, mándeles también un mensaje:')}</p>
    ${people.map(p => `<div class="share-item"><b>${esc(p.name)}</b> <span class="small muted">· ${p.client ? t('Cliente') : ''} ${p.lang === 'en' ? 'English' : 'Español'}</span><p class="small msg">${esc(p.text)}</p><div class="row">${sendButtons(p.phone, p.text, p.email, 'Elevated Exteriors')}</div></div>`).join('')}
    <div class="foot"><button class="primary" type="submit">${t('Listo')}</button></div></form>`;
  document.body.appendChild(d);
  $$('[data-copy]', d).forEach(b => { b.onclick = async e => { e.preventDefault(); try { await navigator.clipboard.writeText(b.dataset.copy); toast(t('Copiado')); } catch { toast(t('No se pudo copiar'), true); } }; });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

// Ver la conversación de un caso y responder.
async function openCase(id, after) {
  let c;
  try { c = await api('GET', `/api/issues/${id}`); } catch (e) { toast(e.message, true); return; }
  const isOwner = BOSS();
  const d = document.createElement('dialog'); d.className = 'case-dlg';
  const allPhotos = c.messages.flatMap(m => m.visibility === 'interno' ? m.photos : []);
  const draw = () => {
    d.innerHTML = `<form novalidate><div class="row between"><h2 style="margin:0">${c.kind === 'pregunta' ? '❓' : '⚠️'} ${esc(c.title_tr || c.title)}</h2><span class="badge ${CASE_BADGE[c.status]}">${CASE_ST()[c.status]}</span></div>
      <div class="small muted">${esc(c.client_name)}${c.urgent ? ' · <b>' + t('Urgente') + '</b>' : ''}${isOwner ? (c.client_visible ? ' · 👁 ' + t('el cliente lo ve') : ' · 🔒 ' + t('el cliente no lo ve')) : ''}</div>
      ${ME.role !== 'client' ? `<div class="case-plan">${caseMeta(c)}
        ${(c.members || []).length ? `<span>👥 ${c.members.map(m => esc(m.name)).join(', ')}</span>` : isOwner ? `<span class="muted">👥 ${t('Sin subs en el caso')}</span>` : ''}</div>` : ''}
      ${c.status === 'resuelto' && c.decision && ME.role !== 'client' ? `<div class="decision">✔ <b>${t('Decisión')}:</b> ${esc(c.decision)}</div>` : ''}
      <div class="thread">${c.messages.map(m => `<div class="msg-b ${m.mine ? 'mine' : ''} ${m.visibility === 'cliente' && isOwner ? 'to-client' : ''}">
        <div class="small muted">${esc(m.by)} · ${fstamp(m.at)}${isOwner ? ` · ${m.visibility === 'cliente' ? '👁 ' + t('para el cliente') : '🔒 ' + t('interno')}` : ''}</div>
        ${m.body ? `<div class="txt">${trx(m.body, m.body_tr, m.body_from)}</div>` : ''}
        ${m.photos.length ? `<div class="pp">${m.photos.map(p => `<span class="thumb"><img src="/files/${p}" data-view="${p}" alt="" loading="lazy"></span>`).join('')}</div>` : ''}</div>`).join('')}</div>
      <div class="compose">
        ${isOwner ? `<div class="row seg"><label><input type="radio" name="vis" value="interno" checked> 🔒 ${t('Interno')}${(c.members || []).length ? ' (+ ' + c.members.map(m => esc(m.name)).join(', ') + ')' : ''}</label>
          <label><input type="radio" name="vis" value="cliente"> 👁 ${t('Para el cliente')}</label></div>
          <div data-cli hidden class="small">
            ${allPhotos.length ? `<div>${t('Fotos del caso que el cliente puede ver:')}</div><div class="pp">${allPhotos.map(p => `<label class="thumb pick"><img src="/files/${p}" alt=""><input type="checkbox" name="share" value="${p}"></label>`).join('')}</div>` : ''}
            <label class="check"><input type="checkbox" name="wait" checked> ${t('Necesito respuesta o autorización del cliente')}</label>
            <div class="muted">${t('El cliente nunca ve los mensajes internos ni costos. Solo lo que mande aquí.')}</div></div>` : ''}
        <textarea name="body" rows="3" placeholder="${esc(t('Escriba su mensaje…'))}"></textarea>
        <div data-pp></div>
        <p class="error-msg" hidden></p>
        <div class="foot">${isOwner ? (c.status === 'resuelto' ? `<button type="button" data-reopen>${t('Reabrir')}</button>` : `<button type="button" data-resolve>✔ ${t('Cerrar con decisión')}</button>`) + `<button type="button" data-plan>📌 ${t('Responsable y fecha')}</button><button type="button" data-sub>👥 ${t('Subs')}</button>` : ''}
          <button type="button" data-x>${t('Cerrar')}</button><button class="primary" type="submit">${t('Enviar')}</button></div></div></form>`;
    bindPhotoViews(d);
    const getPhotos = photoPicker($('[data-pp]', d));
    const f = $('form', d);
    if (isOwner) $$('[name=vis]', d).forEach(r => { r.onchange = () => { $('[data-cli]', d).hidden = f.vis.value !== 'cliente'; }; });
    $('[data-x]', d).onclick = () => d.close();
    f.onsubmit = async e => {
      e.preventDefault();
      const vis = isOwner ? f.vis.value : undefined;
      const btn = $('button[type=submit]', d); btn.disabled = true;
      try {
        await api('POST', `/api/issues/${id}/messages`, { body: f.body.value, photos: getPhotos(), visibility: vis,
          share_photos: vis === 'cliente' ? $$('[name=share]:checked', d).map(x => x.value) : undefined, wait_client: vis === 'cliente' ? f.wait.checked : undefined });
        toast(t('Enviado'));
        c = await api('GET', `/api/issues/${id}`); draw();
        if (ME.role !== 'client') caseShare(c, vis || 'interno', c.title);
      } catch (err) { const m = $('.error-msg', d); m.hidden = false; m.textContent = err.message; btn.disabled = false; }
    };
    const rs = $('[data-resolve]', d); if (rs) rs.onclick = async () => {
      if (await formDialog({ title: t('Cerrar con decisión'), submit: t('Cerrar caso'), intro: `<p class="small muted">${t('La decisión queda en el historial (la ve el sub, no el cliente). Si quiere, escriba también un mensaje final para el cliente.')}</p>`, fields: [
        { name: 'decision', label: t('Decisión tomada'), type: 'textarea', required: true },
        { name: 'client_message', label: t('Mensaje para el cliente (opcional)'), type: 'textarea' }],
        onSubmit: v => api('POST', `/api/issues/${id}/resolve`, v) })) { toast(t('Caso cerrado')); c = await api('GET', `/api/issues/${id}`); draw(); }
    };
    const ro = $('[data-reopen]', d); if (ro) ro.onclick = async () => { await act(() => api('POST', `/api/issues/${id}/reopen`)); c = await api('GET', `/api/issues/${id}`); draw(); };
    const pl = $('[data-plan]', d); if (pl) pl.onclick = async () => {
      let people = []; try { people = await api('GET', `/api/issues-people?job_id=${c.job_id}`); } catch { /* */ }
      const ROLEN = { owner: t('Dueño'), pm: 'PM', worker: t('Sub') };
      if (await formDialog({ title: t('Responsable y fecha límite'), intro: `<p class="small muted">${t('El responsable recibe el aviso y los recordatorios si el caso se queda sin respuesta. Si es un sub, entra al caso.')}</p>`, fields: [
        { name: 'assignee_id', label: t('Responsable'), type: 'select', value: c.assignee_id || '', options: [['', t('— sin responsable —')], ...people.map(p => [p.id, `${p.name}${p.me ? ' (' + t('yo') + ')' : ''} · ${ROLEN[p.role] || ''}`])] },
        { name: 'due_date', label: t('Fecha límite'), type: 'date', value: c.due_date || '' }],
        onSubmit: v => api('PUT', `/api/issues/${id}/plan`, { assignee_id: v.assignee_id ? Number(v.assignee_id) : null, due_date: v.due_date || '' }) })) { toast(t('Guardado')); c = await api('GET', `/api/issues/${id}`); draw(); }
    };
    const sb = $('[data-sub]', d); if (sb) sb.onclick = async () => {
      let people = []; try { people = (await api('GET', `/api/issues-people?job_id=${c.job_id}`)).filter(p => p.role === 'worker'); } catch { /* */ }
      const now = new Set((c.members || []).map(m => m.id));
      const dd = document.createElement('dialog');
      dd.innerHTML = `<form novalidate><h2>${t('Subs en este caso')}</h2><p class="small muted">${t('Ven y contestan los mensajes internos del caso (nunca lo que se habla con el cliente). Les llega un aviso al agregarlos.')}</p>
        <div class="pick-people">${people.map(p => `<label class="check"><input type="checkbox" value="${p.id}" ${now.has(p.id) ? 'checked' : ''}> <span>${esc(p.name)}${p.trade ? `<br><span class="small muted">${esc(p.trade)}</span>` : ''}</span></label>`).join('') || `<p class="empty">${t('Esta obra no tiene subs con acceso a la app.')}</p>`}</div>
        <p class="error-msg" hidden></p><div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Guardar')}</button></div></form>`;
      document.body.appendChild(dd); dd.addEventListener('close', () => dd.remove()); $('[data-x]', dd).onclick = () => dd.close();
      $('form', dd).onsubmit = async e => {
        e.preventDefault();
        const want = new Set($$('input[type=checkbox]:checked', dd).map(x => Number(x.value)));
        try {
          for (const uid of want) if (!now.has(uid)) await api('POST', `/api/issues/${id}/members`, { user_id: uid });
          for (const uid of now) if (!want.has(uid)) await api('DELETE', `/api/issues/${id}/members/${uid}`);
          dd.close(); toast(t('Guardado')); c = await api('GET', `/api/issues/${id}`); draw();
        } catch (err) { const m = $('.error-msg', dd); m.hidden = false; m.textContent = err.message; }
      };
      dd.showModal();
    };
  };
  draw();
  document.body.appendChild(d);
  d.addEventListener('close', () => { d.remove(); if (after) after(); api('GET', '/api/status').then(st => { if (st.user) { ME.pending = st.user.pending; renderNav(); } }).catch(() => {}); });
  d.showModal();
  const th = $('.thread', d); if (th) th.scrollTop = th.scrollHeight;
}

// Tarjeta de casos (inicio del dueño, obra, portal del cliente, obra del sub).
async function casesCard(box, { jobId, title, onlyOpen, showJob, after, newBtn }) {
  let list = await api('GET', '/api/issues' + (jobId ? `?job_id=${jobId}` : ''));
  if (onlyOpen) list = list.filter(c => c.status !== 'resuelto' || c.unread);
  if (onlyOpen && !list.length && !newBtn) { box.remove(); return; }
  box.className = 'card' + (list.some(c => c.unread || c.urgent && c.status !== 'resuelto') ? ' notices' : '');
  box.innerHTML = `<div class="row between"><h2>${title}</h2><div class="row">${!jobId && BOSS() ? `<a class="btn sm" href="#/casos">${t('Ver todos')}</a>` : ''}${newBtn ? `<button class="sm primary" data-new>${newBtn}</button>` : ''}</div></div>${caseRows(list.slice(0, onlyOpen ? 6 : 100), showJob)}`;
  bindCaseRows(box, after);
  const nb = $('[data-new]', box); if (nb) nb.onclick = async () => newCaseDialog({ jobId, jobs: jobId ? null : await api('GET', '/api/jobs'), after });
}
async function viewCases(app) {
  app.innerHTML = `<h1>${t('Casos')}</h1><p class="muted small">${t('Problemas y preguntas de todas las obras. Lo interno nunca lo ve el cliente.')}</p><div></div>`;
  await casesCard(app.lastElementChild, { title: t('Todos los casos'), showJob: true, after: () => viewCases(app), newBtn: t('+ Nuevo caso') });
}
function tabCases(box, d, { id, reload }) {
  const c = document.createElement('div'); box.appendChild(c);
  casesCard(c, { jobId: id, title: t('Casos de esta obra'), after: reload, newBtn: t('+ Nuevo caso') });
}

// ================= v1.6: FUNCIONES PRO =================
const hm = m => `${Math.floor((m || 0) / 60)}h ${String((m || 0) % 60).padStart(2, '0')}m`;
const utcToLocal = s => s ? new Date(s.replace(' ', 'T') + 'Z') : null;
const ftime = s => s ? utcToLocal(s).toLocaleTimeString(LANG === 'en' ? 'en-US' : 'es-MX', { hour: 'numeric', minute: '2-digit' }) : '';
const fdayLocal = s => s ? utcToLocal(s).toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-MX', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const localInput = s => { if (!s) return ''; const d = utcToLocal(s); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const inputToUtc = v => v ? new Date(v).toISOString().replace('T', ' ').slice(0, 16) : '';
const distLabel = m => m == null ? '' : m < 300 ? `<span class="badge b-hecho">📍 ${t('en la obra')}</span>` : `<span class="badge b-urg">📍 ${t('a {x} de la obra', { x: m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m' })}</span>`;
function getGps() {
  return new Promise(res => {
    if (!navigator.geolocation) return res({});
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }), () => res({}), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}
const PERMIT_ST = () => ({ pendiente: t('Por hacer'), solicitado: t('Solicitado'), programada: t('Programada'), aprobado: t('Aprobado'), rechazado: t('Rechazado / correcciones') });
const PERMIT_B = { pendiente: 'b-pendiente', solicitado: 'b-en_progreso', programada: 'b-en_progreso', aprobado: 'b-hecho', rechazado: 'b-urg' };

// ---------- 2) Presupuesto por categoría ----------
async function tabBudget(box, d, { id, reload }) {
  const b = await api('GET', `/api/jobs/${id}/budget`);
  const rows = CAT.categories.map(c => b.rows.find(r => r.category === c.key) || { category: c.key, budget_cents: 0, spent_cents: 0, pct: null });
  const color = p => p == null ? '' : p >= 100 ? 'over' : p >= 90 ? 'warn' : '';
  box.innerHTML = `<div class="card"><div class="row between"><h2>${t('Presupuesto vs. gastado')}</h2><button class="primary" id="eb">${t('Editar presupuesto')}</button></div>
    <p class="small muted">${t('Ponga cuánto planea gastar en cada categoría. La app avisa (con notificación) cuando una categoría llega al 90% y cuando se pasa.')}</p>
    <div class="money-strip"><div><span>${t('Contrato')}</span><b>${fmt(b.contract_cents)}</b></div><div><span>${t('Presupuesto total')}</span><b>${fmt(b.total_budget_cents)}</b></div>
      <div><span>${t('Gastado')}</span><b>${fmt(b.total_spent_cents)}</b></div><div><span>${t('Ganancia planeada')}</span><b>${b.planned_profit_cents == null ? '—' : fmt(b.planned_profit_cents)}</b></div></div>
    <div class="budget">${rows.filter(r => r.budget_cents || r.spent_cents).map(r => `<div class="brow ${color(r.pct)}"><div class="row between"><b>${esc(L(CAT.categories.find(c => c.key === r.category)))}</b>
      <span class="small">${fmt(r.spent_cents)} / ${r.budget_cents ? fmt(r.budget_cents) : `<span class="muted">${t('sin presupuesto')}</span>`}${r.pct != null ? ` · <b>${r.pct}%</b>` : ''}</span></div>
      <div class="bar"><span style="width:${Math.min(100, r.pct ?? 0)}%"></span></div></div>`).join('') || `<p class="empty">${t('Todavía no hay presupuesto ni gastos.')}</p>`}</div></div>`;
  $('#eb').onclick = async () => {
    if (await formDialog({ title: t('Presupuesto por categoría'), fields: CATS().map(c => ({ name: c.key, label: L(c) + ' ($)', type: 'money', value: centsToInput((rows.find(r => r.category === c.key) || {}).budget_cents || '') })),
      onSubmit: v => api('PUT', `/api/jobs/${id}/budget`, { items: v }) })) { toast(t('Guardado')); reload(); }
  };
}

// ---------- 4) Permisos e inspecciones ----------
async function tabPermits(box, d, { id, reload }) {
  const list = await api('GET', `/api/jobs/${id}/permits`);
  const ST = PERMIT_ST();
  box.innerHTML = `<div class="card"><div class="row between"><h2>${t('Permisos e inspecciones')}</h2><button class="primary" id="ap">${t('+ Agregar')}</button></div>
    <p class="small muted">${t('Lleve aquí cada permiso y cada inspección con su fecha. Las inspecciones también las ven los subs de esta obra (sin las notas).')}</p>
    ${list.length ? list.map(p => `<div class="permit" data-id="${p.id}"><div class="ic">${p.kind === 'permiso' ? '📋' : '🔍'}</div>
      <div style="flex:1;min-width:0"><b>${esc(p.name)}</b>${p.number ? ` <span class="small muted">#${esc(p.number)}</span>` : ''}
        <div class="small muted">${p.date ? fdate(p.date) : t('sin fecha')}${p.attempt > 1 ? ' · ' + t('intento {n}', { n: p.attempt }) : ''}${p.reinspect_of ? ` · ↻ ${t('la anterior no pasó: {x}', { x: esc((list.find(y => y.id === p.reinspect_of) || {}).fail_reason || '') })}` : ''}${p.notes ? ' · ' + esc(p.notes) : ''}</div>
        ${p.kind === 'inspeccion' && p.result_at ? `<div class="small ${p.status === 'aprobado' ? '' : 'neg'}">${p.status === 'aprobado' ? '✅ ' + t('Pasó el {d}', { d: fdate(p.result_at) }) : '❌ ' + t('No pasó el {d}: {x}', { d: fdate(p.result_at), x: esc(p.fail_reason) })}${p.inspector ? ' · ' + esc(p.inspector) : ''}</div>` : ''}
        ${p.kind === 'inspeccion' && !p.result_at && p.date && p.date < today() && !['aprobado', 'rechazado'].includes(p.status) ? `<div class="small neg">⏰ ${t('Ya pasó la fecha y no tiene resultado.')}</div>` : ''}</div>
      ${p.kind === 'inspeccion' && !['aprobado', 'rechazado'].includes(p.status) ? `<button class="sm primary" data-pass>✅ ${t('Pasó')}</button><button class="sm danger" data-fail>❌ ${t('No pasó')}</button>` : `<span class="badge ${PERMIT_B[p.status]}">${p.kind === 'inspeccion' && p.status === 'rechazado' ? t('No pasó') : p.kind === 'inspeccion' && p.status === 'aprobado' ? t('Pasó') : ST[p.status]}</span>`}${p.kind === 'permiso' && p.status === 'aprobado' ? `<button class="sm ${p.inspections_set ? '' : 'primary'}" data-insp="${p.id}">🏛️ ${p.inspections_set ? t('Inspecciones') : t('¿Qué inspecciones pidió?')}</button>` : ''}<button class="sm" data-ed>✎</button></div>
      ${p.kind === 'permiso' && p.status === 'aprobado' && !p.inspections_set ? `<div class="insp-ask small">🏛️ ${t('La ciudad aprobó este permiso. Capture las inspecciones que pidió para ponerlas en el schedule, entre los trades.')}</div>` : ''}`).join('') : `<p class="empty">${t('Sin permisos ni inspecciones.')}</p>`}</div>`;
  const fields = (p = {}) => [
    { name: 'kind', label: t('Tipo'), type: 'select', value: p.kind || 'permiso', options: [['permiso', t('Permiso')], ['inspeccion', t('Inspección')]] },
    { name: 'name', label: t('Nombre'), required: true, value: p.name, hint: t('Ej.: Permiso de construcción, Inspección de zapatas, Final') },
    { name: 'status', label: t('Estado'), type: 'select', value: p.status || 'pendiente', options: Object.entries(ST) },
    { name: 'date', label: t('Fecha (solicitud o inspección)'), type: 'date', value: p.date },
    { name: 'number', label: t('Número de permiso'), value: p.number },
    { name: 'notes', label: t('Notas'), type: 'textarea', value: p.notes, hint: t('Inspector, correcciones pedidas, ciudad…') },
  ];
  let made = null;
  $('#ap').onclick = async () => { if (await formDialog({ title: t('Permiso o inspección'), fields: fields(), onSubmit: async v => { made = await api('POST', `/api/jobs/${id}/permits`, v); } })) { if (made && made.ask_inspections) await inspectionsDialog(id, made.id); reload(); } };
  $$('[data-insp]', box).forEach(b => { b.onclick = async () => { if (await inspectionsDialog(id, Number(b.dataset.insp))) reload(); }; });
  $$('.permit[data-id]', box).forEach(el => {
    const p = list.find(x => x.id === Number(el.dataset.id));
    const ps = $('[data-pass]', el); if (ps) ps.onclick = async () => { if (await inspResultDialog(p, 'paso')) reload(); };
    const fl = $('[data-fail]', el); if (fl) fl.onclick = async () => { if (await inspResultDialog(p, 'fallo')) reload(); };
    $('[data-ed]', el).onclick = async () => {
      let r = null;
      if (await formDialog({ title: t('Permiso o inspección'), fields: fields(p), extraButton: { label: t('Borrar'), danger: true, onClick: () => api('DELETE', `/api/permits/${p.id}`) }, onSubmit: async v => { r = await api('PUT', `/api/permits/${p.id}`, v); } })) {
        if (r && r.ask_inspections) await inspectionsDialog(id, p.id);
        reload();
      }
    };
  });
}

// ---------- 5) Reporte diario ----------
function logCard(l, owner) {
  return `<div class="log" data-id="${l.id}"><div class="row between"><b>${fdate(l.date)}</b><span class="small muted">${[l.weather, l.crew && '👷 ' + esc(l.crew)].filter(Boolean).join(' · ')}${owner && !l.shared ? ' · 🔒 ' + t('no compartido') : ''}</span></div>
    ${l.client_notes ? `<div class="txt">${trx(l.client_notes, l.client_notes_tr, l.client_notes_from)}</div>` : ''}
    ${owner && l.internal_notes ? `<div class="small muted">🔒 ${esc(l.internal_notes)}</div>` : ''}
    ${l.photos.length ? `<div class="pp">${l.photos.map(p => `<span class="thumb"><img src="/files/${p}" data-view="${p}" alt="" loading="lazy"></span>`).join('')}</div>` : ''}
    ${owner ? `<div class="row" style="justify-content:flex-end"><button class="sm danger" data-del>✕</button></div>` : ''}</div>`;
}
async function tabDaily(box, d, { id, reload }) {
  const list = await api('GET', `/api/jobs/${id}/logs`);
  box.innerHTML = `<div class="card"><div class="row between"><h2>${t('Reporte diario')}</h2><button class="primary" id="al">${t('+ Reporte de hoy')}</button></div>
    <p class="small muted">${t('Qué se hizo hoy, con fotos. El cliente lo ve en su app y le llega una notificación. Las notas internas nunca las ve.')}</p>
    ${list.map(l => logCard(l, true)).join('') || `<p class="empty">${t('Sin reportes todavía.')}</p>`}</div>`;
  bindPhotoViews(box);
  $('#al').onclick = () => dailyDialog(d.job, reload);
  $$('.log[data-id]', box).forEach(el => { $('[data-del]', el).onclick = async () => { if (await confirmDialog(t('¿Borrar este reporte?'))) act(() => api('DELETE', `/api/logs/${el.dataset.id}`), t('Borrado')).then(reload); }; });
}
function dailyDialog(job, after) {
  const d = document.createElement('dialog');
  d.innerHTML = `<form novalidate><h2>${t('Reporte del día')} · ${esc(job.client_name)}</h2><div class="fields">
    <div class="field"><label>${t('Fecha')}</label><input type="date" name="date" value="${today()}"></div>
    <div class="field"><label>${t('Clima')}</label><input name="weather" placeholder="${esc(t('Soleado, 75°'))}"></div>
    <div class="field full"><label>${t('Cuadrilla')}</label><input name="crew" placeholder="${esc(t('Quiénes trabajaron'))}"></div>
    <div class="field full"><label>${t('Qué se hizo hoy (lo ve el cliente)')}</label><textarea name="client_notes" rows="4"></textarea></div>
    <div class="field full"><label>🔒 ${t('Notas internas (solo dueños)')}</label><textarea name="internal_notes" rows="2"></textarea></div>
    <div class="field full"><label>${t('Fotos')}</label><div data-pp></div></div>
    <div class="field full"><label class="check"><input type="checkbox" name="shared" checked> ${t('Compartir con el cliente')}</label></div></div>
    <p class="error-msg" hidden></p><div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">${t('Guardar')}</button></div></form>`;
  document.body.appendChild(d);
  const getPhotos = photoPicker($('[data-pp]', d));
  $('[data-x]', d).onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  $('form', d).onsubmit = async e => {
    e.preventDefault(); const f = e.target, btn = $('button[type=submit]', d); btn.disabled = true;
    try {
      await api('POST', `/api/jobs/${job.id}/logs`, { date: f.date.value, weather: f.weather.value, crew: f.crew.value, client_notes: f.client_notes.value, internal_notes: f.internal_notes.value, shared: f.shared.checked, photos: getPhotos() });
      d.close(); toast(t('Reporte guardado')); if (after) after();
    } catch (err) { const m = $('.error-msg', d); m.hidden = false; m.textContent = err.message; btn.disabled = false; }
  };
  d.showModal();
}

// ---------- 1) Firmas (vista del dueño) ----------
async function ownerSigningCard(box, id) {
  const s = await api('GET', `/api/jobs/${id}/signing`);
  const es = s.estimate.signature;
  box.className = 'card';
  box.innerHTML = `<h2>✍️ ${s.pay ? t('Firma del cliente y pago en línea') : t('Firma del cliente')}</h2>
    <p>${es ? (es.valid ? `<span class="badge b-hecho">${t('Estimado firmado')}</span> ${esc(es.signer_name)} · ${fdayLocal(es.signed_at)}`
      : `<span class="badge b-urg">${t('El estimado cambió después de firmarse: hay que volver a firmar')}</span>`)
      : s.estimate.can_sign ? `<span class="badge b-pendiente">${t('Esperando firma del cliente')}</span>` : `<span class="small muted">${t('Para que el cliente firme: obra en Prospecto o Cotizado, con precio y con acceso del cliente.')}</span>`}</p>
    ${s.change_orders.filter(c => c.signature).map(c => `<div class="small">✍️ ${esc(c.description)} · ${esc(c.signature.signer_name)} ${c.signature.valid ? '' : '⚠️ ' + t('cambió después de firmarse')}</div>`).join('')}
    <div class="row" style="margin-top:.6rem">${s.pay ? `<button class="sm" id="pl">💳 ${t('Link de pago de esta obra')}</button>` : ''}${es ? `<a class="btn sm" target="_blank" rel="noopener" href="/api/signatures/${es.id}/image">${t('Ver firma')}</a>` : ''}</div>
    ${s.pay ? `<p class="small muted">${s.pay.link ? t('El cliente ve el botón "Pagar en línea".') : t('Sin link de pago. Póngalo aquí o uno general en Mi cuenta (Stripe, Square o QuickBooks Payments).')}</p>` : ''}`;
  if ($('#pl', box)) $('#pl', box).onclick = async () => {
    if (await formDialog({ title: t('Link de pago de esta obra'), intro: `<p class="small muted">${t('Pegue un link de Stripe, Square o QuickBooks Payments (empieza con https://). Si lo deja vacío se usa el general de Mi cuenta.')}</p>`,
      fields: [{ name: 'pay_link', label: t('Link de pago'), value: s.pay.link }], onSubmit: v => api('PUT', `/api/jobs/${id}/pay-link`, v) })) { toast(t('Guardado')); ownerSigningCard(box, id); }
  };
}
async function ownerLocationCard(box, j) {
  box.className = 'card';
  box.innerHTML = `<h2>📍 ${t('Ubicación de la obra (para el reloj)')}</h2>
    <p class="small muted">${j.lat != null ? t('Guardada. El reloj marca si alguien checa entrada lejos de la obra.') : t('Sin ubicación. Párese en la obra y toque el botón, para que el reloj sepa si los trabajadores checan en el lugar.')}</p>
    <div class="row">${j.lat != null ? `<a class="btn sm" target="_blank" rel="noopener" href="https://maps.google.com/?q=${j.lat},${j.lng}">${t('Ver en el mapa')}</a>` : ''}<button class="sm primary" data-here>${t('Estoy en la obra: guardar ubicación')}</button></div>`;
  $('[data-here]', box).onclick = async () => {
    const g = await getGps();
    if (g.lat == null) return toast(t('No se pudo obtener la ubicación. Permita el acceso a la ubicación.'), true);
    await act(() => api('PUT', `/api/jobs/${j.id}/location`, g), t('Ubicación guardada'));
    j.lat = g.lat; j.lng = g.lng; ownerLocationCard(box, j);
  };
}

// ---------- 3) Reloj: trabajador ----------
async function workerClockCard(box, jobs, refresh) {
  const c = await api('GET', '/api/clock');
  const active = jobs.filter(j => j.status === 'activo');
  box.className = 'card clock' + (c.open ? ' on' : '');
  box.innerHTML = c.open ? `<div class="row between"><div><div class="small muted">⏱️ ${t('Trabajando en')}</div><b>${esc(c.open.client_name)}</b>
      <div class="small">${t('Desde las {h}', { h: ftime(c.open.in_at) })} · <b>${hm(c.open.minutes)}</b> ${distLabel(c.open.in_dist)}</div></div>
      <button class="danger" data-out>${t('Marcar salida')}</button></div><div class="small muted">${t('Esta semana: {x}', { x: hm(c.week_minutes) })}</div>`
    : `<div class="row between"><div><b>⏱️ ${t('Reloj')}</b><div class="small muted">${t('Esta semana: {x}', { x: hm(c.week_minutes) })}</div></div></div>
      ${active.length ? `<div class="row"><select data-job style="flex:1">${active.map(j => `<option value="${j.id}">${esc(j.client_name)}</option>`).join('')}</select><button class="primary" data-in>${t('Marcar entrada')}</button></div>`
        : `<p class="small muted">${t('No tiene obras activas.')}</p>`}`;
  const inB = $('[data-in]', box); if (inB) inB.onclick = async () => {
    inB.disabled = true; toast(t('Tomando ubicación…'));
    const g = await getGps();
    try { await api('POST', '/api/clock/in', { job_id: Number($('[data-job]', box).value), ...g }); toast(t('Entrada marcada')); } catch (e) { toast(e.message, true); }
    workerClockCard(box, jobs, refresh);
  };
  const outB = $('[data-out]', box); if (outB) outB.onclick = async () => {
    outB.disabled = true; toast(t('Tomando ubicación…'));
    const g = await getGps();
    try { const r = await api('POST', '/api/clock/out', g); toast(t('Salida marcada: {x}', { x: hm(r.minutes) })); } catch (e) { toast(e.message, true); }
    workerClockCard(box, jobs, refresh);
  };
}

// ---------- 3) Reloj: página del dueño ----------
// ---------- Dueño: tarjetas del inicio ----------
async function ownerProCards(app, refresh) {
  const anchor = app.firstElementChild;
  const [leads, alerts, permits, fu, time] = await Promise.all([api('GET', '/api/leads/new'), api('GET', '/api/budget/alerts'), api('GET', '/api/permits/upcoming'),
    api('GET', '/api/followups'), api('GET', '/api/time').catch(() => ({ entries: [] }))]);
  const box = document.createElement('div');
  const cards = [];
  if (leads.length) cards.push(`<div class="card notices"><h2>🌐 ${t('Prospectos nuevos de la página web')}</h2>${leads.map(l => `<div class="notice"><a href="#/obra/${l.id}/datos" data-lead="${l.id}"><b>${esc(l.client_name)}</b></a>
    <span class="small muted">${esc(typeLabel(l.project_type))} · ${[l.client_phone, l.client_email].filter(Boolean).map(esc).join(' · ')}</span><div class="small">${esc((l.description || '').slice(0, 140))}</div></div>`).join('')}</div>`);
  const working = time.entries.filter(e => e.open);
  if (working.length) cards.push(`<div class="card"><div class="row between"><h2>⏱️ ${t('Trabajando ahora')}</h2><a class="btn sm" href="#/horas">${t('Horas')}</a></div>${working.map(e => `<div class="small">${e.forgot ? '⚠️ ' : ''}<b>${esc(e.user_name)}</b> · ${esc(e.client_name)} · ${t('desde las {h}', { h: ftime(e.in_at) })} ${distLabel(e.in_dist)}</div>`).join('')}</div>`);
  if (alerts.length) cards.push(`<div class="card notices"><h2>📊 ${t('Presupuesto: categorías al límite')}</h2>${alerts.map(a => `<div class="notice small"><a href="#/obra/${a.job_id}/presupuesto"><b>${esc(a.client_name)}</b></a> · ${esc(L(CAT.categories.find(c => c.key === a.category) || { es: a.category, en: a.category }))}: ${fmt(a.spent_cents)} / ${fmt(a.budget_cents)} <b class="${a.pct >= 100 ? 'neg' : ''}">${a.pct}%</b></div>`).join('')}</div>`);
  const pSoon = permits.filter(p => p.overdue || p.soon || p.status === 'rechazado');
  if (pSoon.length) cards.push(`<div class="card"><h2>🔍 ${t('Permisos e inspecciones próximas')}</h2>${pSoon.map(p => `<div class="notice small"><a href="#/obra/${p.job_id}/permisos"><b>${esc(p.name)}</b></a> · ${esc(p.client_name)} · ${p.date ? fdate(p.date) : ''} <span class="badge ${PERMIT_B[p.status]}">${PERMIT_ST()[p.status]}</span>${p.overdue ? ` <b class="neg">${t('atrasado')}</b>` : ''}</div>`).join('')}</div>`);
  if (fu.items.length) cards.push(`<div class="card"><h2>⭐ ${t('Seguimiento a clientes (reseñas y garantía)')}</h2>${fu.items.map((f, i) => `<div class="notice small"><span><b>${esc(f.client_name)}</b> · ${FU_LABEL()[f.kind]} · ${fdate(f.due)}${f.overdue ? '' : ' (' + t('próximo') + ')'}</span>
    <span class="row"><button class="sm primary" data-fu="${i}">${t('Mandar mensaje')}</button><button class="sm" data-fd="${i}">✓</button></span></div>`).join('')}</div>`);
  if (!cards.length || !anchor || !anchor.isConnected) return; // el usuario ya cambió de pantalla
  box.innerHTML = cards.join('');
  app.insertBefore(box, app.children[2] || null);
  $$('[data-lead]', box).forEach(a => { a.onclick = () => api('POST', `/api/jobs/${a.dataset.lead}/lead-seen`).catch(() => {}); });
  $$('[data-fu]', box).forEach(b => { b.onclick = () => followupShare(fu.items[Number(b.dataset.fu)], fu, refresh); });
  $$('[data-fd]', box).forEach(b => { b.onclick = async () => { const f = fu.items[Number(b.dataset.fd)]; await act(() => api('POST', '/api/followups', { job_id: f.job_id, kind: f.kind }), t('Listo')); refresh(); }; });
}
const FU_LABEL = () => ({ review: t('Pedir reseña y referidos'), m6: t('Revisión de 6 meses'), m11: t('La garantía vence pronto') });
function followupMsg(f, fu) {
  const l = f.lang || 'es', v = { name: f.client_name, review: fu.review_link || '', phone: fu.company_phone || '', d: fdateIn(l, f.warranty_until) };
  if (f.kind === 'review') return tl(l, 'Hola {name}, gracias por confiar en Elevated Exteriors. ¿Nos ayudaría con una reseña? {review} Y si conoce a alguien que quiera mejorar su patio, con gusto le atendemos.', v);
  if (f.kind === 'm6') return tl(l, 'Hola {name}, han pasado 6 meses desde que terminamos su proyecto. ¿Todo bien? Le ofrecemos una revisión de mantenimiento sin costo (sellador, tornillería, limpieza). Responda este mensaje para agendar.', v);
  return tl(l, 'Hola {name}, su garantía de Elevated Exteriors vence el {d}. Si ha notado algo, avísenos antes de esa fecha y lo revisamos sin costo.', v);
}
function followupShare(f, fu, refresh) {
  const msg = followupMsg(f, fu);
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${FU_LABEL()[f.kind]} · ${esc(f.client_name)}</h2>${!fu.review_link && f.kind === 'review' ? `<p class="small muted">${t('Ponga su link de reseñas de Google en Mi cuenta para que salga en el mensaje.')}</p>` : ''}
    <div class="share-item"><p class="small msg">${esc(msg)}</p><div class="row">${sendButtons(f.phone, msg, f.email, 'Elevated Exteriors')}</div></div>
    <div class="foot"><button type="button" data-done>${t('Ya lo mandé')}</button><button class="primary" type="submit">${t('Cerrar')}</button></div></form>`;
  document.body.appendChild(d);
  $$('[data-copy]', d).forEach(b => { b.onclick = async e => { e.preventDefault(); try { await navigator.clipboard.writeText(b.dataset.copy); toast(t('Copiado')); } catch { toast(t('No se pudo copiar'), true); } }; });
  $('[data-done]', d).onclick = async () => { await act(() => api('POST', '/api/followups', { job_id: f.job_id, kind: f.kind }), t('Listo')); d.close(); refresh(); };
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

// ---------- 8 y 9) Reportes, exportar y QuickBooks ----------
async function viewReports(app, year) {
  year = year || new Date().getFullYear();
  const r = await api('GET', `/api/reports/profit?year=${year}`);
  const yrs = [0, 1, 2, 3].map(k => new Date().getFullYear() - k);
  const maxP = Math.max(1, ...r.by_type.map(x => Math.abs(x.profit_cents)));
  app.innerHTML = `<div class="row between"><h1>${t('Reportes')}</h1><select id="yr" style="width:auto">${yrs.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
    <div class="grid kpis"><div class="kpi"><div class="label">${t('Obras ganadas')}</div><div class="value">${r.totals.jobs}</div></div>
      <div class="kpi"><div class="label">${t('Contratos')}</div><div class="value">${fmt0(r.totals.contract_cents)}</div></div>
      <div class="kpi"><div class="label">${t('Ganancia')}</div><div class="value">${fmt0(r.totals.profit_cents)}</div></div>
      <div class="kpi"><div class="label">${t('Margen')}</div><div class="value">${r.totals.margin_pct ?? '—'}%</div></div></div>
    <div class="card"><h2>💰 ${t('Ganancia por tipo de proyecto')}</h2><p class="small muted">${t('Obras activas y terminadas del año. Le dice qué tipo de trabajo le deja más por cada dólar.')}</p>
      ${r.by_type.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Tipo')}</th><th class="num">${t('Obras')}</th><th class="num">${t('Contratos')}</th><th class="num">${t('Ganancia')}</th><th class="num">${t('Margen')}</th><th class="num">${t('Promedio por obra')}</th><th>${t('Retrabajo')}</th></tr></thead><tbody>
      ${r.by_type.map(x => `<tr><td><b>${esc(typeLabel(x.project_type))}</b><div class="bar" style="margin-top:.3rem"><span style="width:${Math.max(0, x.profit_cents) * 100 / maxP}%"></span></div></td><td class="num">${x.jobs}</td><td class="num">${fmt0(x.contract_cents)}</td>
        <td class="num ${x.profit_cents < 0 ? 'neg' : 'pos'}">${fmt0(x.profit_cents)}</td><td class="num"><b>${x.margin_pct ?? '—'}%</b></td><td class="num">${fmt0(x.avg_contract_cents)}</td><td class="num">${fmt0(x.rework_cents)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="empty">${t('Sin obras este año.')}</p>`}</div>
    <div class="card"><h2>📣 ${t('De dónde vienen los clientes')}</h2><p class="small muted">${t('Cuántos prospectos llegaron por cada medio, cuántos se cerraron y cuánto vendieron.')}</p>
      ${r.by_source.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Origen')}</th><th class="num">${t('Prospectos')}</th><th class="num">${t('Cerrados')}</th><th class="num">${t('% cierre')}</th><th class="num">${t('Vendido')}</th></tr></thead><tbody>
      ${r.by_source.map(x => `<tr><td>${esc(x.source)}</td><td class="num">${x.leads}</td><td class="num">${x.won}</td><td class="num">${x.close_pct}%</td><td class="num">${fmt0(x.contract_cents)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="empty">—</p>`}</div>
    <div class="card"><h2>📤 ${t('Exportar para el contador / QuickBooks')}</h2><p class="small muted">${t('Archivos CSV que QuickBooks, Excel o su contador pueden importar.')}</p>
      <div class="row"><input type="date" id="ef" value="${year}-01-01" style="width:auto"><input type="date" id="et" value="${year}-12-31" style="width:auto"></div>
      <div class="row" style="margin-top:.6rem">${[['gastos', t('Gastos')], ['pagos', t('Pagos de clientes')], ['bills', t('Invoices de subs (bills)')], ['horas', t('Horas')]].map(([k, l]) => `<button class="sm" data-exp="${k}">⬇ ${l}</button>`).join('')}</div></div>
    <div class="card qb"><h2>🔗 QuickBooks Online</h2><p><span class="badge b-pendiente">${t('Opción a futuro')}</span></p>
      <p class="small muted">${t('Cuando estén listos, se puede conectar directo para que gastos, pagos e invoices pasen solos a QuickBooks. Requiere una cuenta de QuickBooks Online y registrar la app con Intuit. Mientras tanto use los archivos CSV de arriba.')}</p>
      <button class="sm" disabled>${t('Conectar QuickBooks (próximamente)')}</button></div>`;
  $('#yr').onchange = e => viewReports(app, Number(e.target.value));
  $$('[data-exp]', app).forEach(b => { b.onclick = () => { location.href = `/api/export/${b.dataset.exp}?from=${$('#ef').value}&to=${$('#et').value}`; }; });
  await financeReports(app, year).catch(e => console.error(e));
}

// ---------- 10) Notificaciones push ----------
async function pushCard(app) {
  const box = document.createElement('div'); box.className = 'card';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iphone|ipad/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let sub = null; try { const reg = await navigator.serviceWorker.ready; sub = await reg.pushManager.getSubscription(); } catch { /* */ }
  box.innerHTML = `<h2>🔔 ${t('Notificaciones en este teléfono')}</h2>
    ${!supported ? `<p class="small muted">${isIOS && !standalone ? t('En iPhone: primero instale la app (Compartir → Agregar a inicio) y ábrala desde el ícono. Ahí podrá activar las notificaciones.') : t('Este navegador no permite notificaciones.')}</p>`
      : `<p>${sub ? `<span class="badge b-hecho">${t('Activadas')}</span>` : Notification.permission === 'denied' ? `<span class="badge b-urg">${t('Bloqueadas en los ajustes del teléfono')}</span>` : `<span class="badge b-pendiente">${t('Desactivadas')}</span>`}</p>
      <p class="small muted">${t('Le avisa al momento: casos nuevos, invoices, firmas, cambios de fecha, prospectos de la web y más.')}</p>
      <div class="row">${sub ? `<button class="sm" data-test>${t('Probar')}</button><button class="sm" data-off>${t('Desactivar')}</button>` : `<button class="sm primary" data-on>${t('Activar notificaciones')}</button>`}</div>`}`;
  app.appendChild(box);
  const on = $('[data-on]', box); if (on) on.onclick = async () => {
    try {
      if (await Notification.requestPermission() !== 'granted') throw new Error(t('Permiso negado. Actívelo en los ajustes del teléfono.'));
      const { key } = await api('GET', '/api/push/key');
      const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
      await api('POST', '/api/push/subscribe', { endpoint: s.endpoint });
      toast(t('Notificaciones activadas')); box.remove(); pushCard(app);
    } catch (e) { toast(e.message, true); }
  };
  const te = $('[data-test]', box); if (te) te.onclick = () => act(() => api('POST', '/api/push/test'), t('Enviada: debe llegar en unos segundos'));
  const off = $('[data-off]', box); if (off) off.onclick = async () => { try { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); } catch { /* */ } box.remove(); pushCard(app); };
}
async function settingsCard(app) {
  const s = await api('GET', '/api/settings');
  const box = document.createElement('div'); box.className = 'card';
  box.innerHTML = `<h2>🏢 ${t('Ajustes de la empresa')}</h2><table><tbody>
    <tr><th>${t('Pagos en línea')}</th><td>${s.pay_enabled ? `<span class="badge b-hecho">${t('Activados')}</span>` : `<span class="badge b-pendiente">${t('Apagados')}</span> <span class="small muted">${t('El cliente no ve nada de pagos.')}</span>`}</td></tr>
    ${s.pay_enabled ? `<tr><th>${t('Link de pago general')}</th><td>${s.pay_link ? esc(s.pay_link) : '—'}</td></tr>
    <tr><th>${t('Otras formas de pago')}</th><td style="white-space:pre-wrap">${s.pay_info ? esc(s.pay_info) : '—'}</td></tr>` : ''}
    <tr><th>${t('Link de reseñas de Google')}</th><td>${s.review_link ? esc(s.review_link) : '—'}</td></tr>
    <tr><th>${t('Teléfono de la empresa')}</th><td>${s.company_phone ? esc(s.company_phone) : '—'}</td></tr></tbody></table>
    <div class="row" style="margin-top:.6rem"><button class="sm" data-ed>${t('Editar')}</button>${!ME.isPm ? `<a class="btn sm" href="#/listas">🏷️ ${t('Categorías y listas')}</a>` : ''}<a class="btn sm" target="_blank" rel="noopener" href="/cotizar.html">🌐 ${t('Ver formulario para su página web')}</a></div>
    <p class="small muted">${t('Formulario de cotización para su página web: {url} — póngalo como botón "Pida su cotización" en su sitio. Cada solicitud llega aquí como prospecto nuevo.', { url: location.origin + '/cotizar.html' })}</p>`;
  app.appendChild(box);
  $('[data-ed]', box).onclick = async () => {
    if (await formDialog({ title: t('Ajustes de la empresa'), fields: [
      { name: 'pay_enabled', label: t('Pagos en línea'), type: 'select', value: s.pay_enabled ? 'si' : 'no', options: [['no', t('Apagados (el cliente no ve pagos)')], ['si', t('Activados')]] },
      { name: 'pay_link', label: t('Link de pago general'), value: s.pay_link, hint: t('Stripe, Square o QuickBooks Payments. Empieza con https://') },
      { name: 'pay_info', label: t('Otras formas de pago'), type: 'textarea', value: s.pay_info, hint: t('Ej.: Zelle a pagos@…, cheque a nombre de…') },
      { name: 'review_link', label: t('Link de reseñas de Google'), value: s.review_link },
      { name: 'company_phone', label: t('Teléfono de la empresa'), value: s.company_phone }],
      onSubmit: v => api('PUT', '/api/settings', v) })) { toast(t('Guardado')); box.remove(); settingsCard(app); }
  };
}

// ---------- 1) Cliente: firmar y pagar ----------
function signatureDialog({ title, summary, amount, onSign }) {
  const d = document.createElement('dialog'); d.className = 'sign-dlg';
  d.innerHTML = `<form novalidate><h2>${title}</h2>
    <div class="sign-sum">${summary ? `<div style="white-space:pre-wrap">${esc(summary)}</div>` : ''}<div class="row between" style="margin-top:.4rem"><span>${t('Total')}</span><b>${fmt(amount)}</b></div></div>
    <div class="field"><label>${t('Nombre completo')} *</label><input name="name" autocomplete="name" value="${esc(ME.name || '')}"></div>
    <label>${t('Firme aquí con el dedo')}</label><canvas class="pad" width="600" height="220"></canvas>
    <div class="row between"><button type="button" class="sm" data-clear>${t('Borrar firma')}</button><span class="small muted">${t('Su firma queda guardada con la fecha y hora.')}</span></div>
    <label class="check" style="margin-top:.6rem"><input type="checkbox" name="agree"> ${t('Acepto firmar electrónicamente y que mi firma tenga la misma validez que una firma en papel.')}</label>
    <p class="error-msg" hidden></p><div class="foot"><button type="button" data-x>${t('Cancelar')}</button><button class="primary" type="submit">✍️ ${t('Firmar')}</button></div></form>`;
  document.body.appendChild(d);
  const cv = $('canvas', d), ctx = cv.getContext('2d');
  const reset = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.strokeStyle = '#ccc'; ctx.beginPath(); ctx.moveTo(20, 180); ctx.lineTo(580, 180); ctx.stroke(); };
  reset(); let drawing = false, ink = 0, last = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width, (e.clientY - r.top) * cv.height / r.height]; };
  cv.onpointerdown = e => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); e.preventDefault(); };
  cv.onpointermove = e => { if (!drawing) return; const p = pos(e); ctx.strokeStyle = '#0b1a4a'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); ink += Math.hypot(p[0] - last[0], p[1] - last[1]); last = p; e.preventDefault(); };
  cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
  $('[data-clear]', d).onclick = () => { reset(); ink = 0; };
  $('[data-x]', d).onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  $('form', d).onsubmit = async e => {
    e.preventDefault(); const f = e.target, err = $('.error-msg', d), btn = $('button[type=submit]', d);
    try {
      if (!f.name.value.trim()) throw new Error(t('Escriba su nombre completo'));
      if (ink < 80) throw new Error(t('Firme en el recuadro'));
      if (!f.agree.checked) throw new Error(t('Marque la casilla para aceptar'));
      btn.disabled = true;
      await onSign({ name: f.name.value.trim(), signature: cv.toDataURL('image/jpeg', 0.85), agree: true });
      d.close(); toast(t('¡Firmado! Gracias.'));
    } catch (x) { err.hidden = false; err.textContent = x.message; btn.disabled = false; }
  };
  d.showModal();
}
async function clientProCards(app, j, reload) {
  const portal = $('.portal', app); if (!portal) return;
  const [s, logs] = await Promise.all([api('GET', `/api/jobs/${j.id}/signing`), api('GET', `/api/jobs/${j.id}/logs`)]);
  if (!portal.isConnected) return;
  const top = document.createElement('div');
  const pendCO = s.change_orders.filter(c => c.status === 'pendiente' && !(c.signature && c.signature.valid));
  let html = '';
  if (s.estimate.can_sign) html += `<div class="card sign-card"><h2>✍️ ${t('Su estimado está listo para firmar')}</h2><p>${t('Revise el estimado y fírmelo desde aquí. Total')}: <b>${fmt(s.estimate.amount_cents)}</b></p>
    <div class="row"><a class="btn" target="_blank" rel="noopener" href="/api/jobs/${j.id}/pdf?lang=${LANG}">📄 ${t('Ver estimado')}</a><button class="primary" data-sign-est>✍️ ${t('Firmar estimado')}</button></div></div>`;
  else if (s.estimate.signature && s.estimate.signature.valid) html += `<div class="card small">✅ ${t('Estimado firmado por {x} el {d}', { x: esc(s.estimate.signature.signer_name), d: fdayLocal(s.estimate.signature.signed_at) })}</div>`;
  if (pendCO.length) html += `<div class="card sign-card"><h2>✍️ ${t('Change orders por aprobar')}</h2>${pendCO.map(c => `<div class="notice"><span>${c.code ? `<span class="code small">${esc(c.code)}</span> ` : ''}<b>${esc(c.description_tr || c.description)}</b><br><span class="small">${fmt(c.price_cents)}</span></span><button class="sm primary" data-sign-co="${c.id}">✍️ ${t('Aprobar y firmar')}</button></div>`).join('')}</div>`;
  if (s.pay && (s.pay.link || s.pay.info) && s.pay.balance_cents > 0 && !['prospecto', 'cotizado'].includes(j.status)) html += `<div class="card"><h2>💳 ${t('Pagar')}</h2><p>${t('Saldo pendiente')}: <b>${fmt(s.pay.balance_cents)}</b></p>
    ${s.pay.link ? `<p><a class="btn primary" target="_blank" rel="noopener" href="${esc(s.pay.link)}">💳 ${t('Pagar en línea')}</a></p>` : ''}${s.pay.info ? `<p class="small" style="white-space:pre-wrap">${esc(s.pay.info)}</p>` : ''}
    <p class="small muted">${t('Su pago aparece en "Pagos" cuando lo confirmemos.')}</p></div>`;
  top.innerHTML = html;
  portal.insertBefore(top, portal.children[1]);
  if (logs.length) {
    const lb = document.createElement('div'); lb.className = 'card';
    lb.innerHTML = `<h2>📅 ${t('Reporte diario')}</h2>${logs.slice(0, 10).map(l => logCard(l, false)).join('')}`;
    const after = $$('.card', portal).find(c => /Avance|Progress/.test(c.textContent.slice(0, 20)));
    portal.insertBefore(lb, after || null);
    bindPhotoViews(lb);
  }
  const se = $('[data-sign-est]', top); if (se) se.onclick = () => signatureDialog({ title: t('Firmar estimado'), summary: s.estimate.description, amount: s.estimate.amount_cents,
    onSign: v => api('POST', `/api/jobs/${j.id}/sign`, { ...v, target: 'estimate' }).then(reload) });
  $$('[data-sign-co]', top).forEach(b => { const c = pendCO.find(x => x.id === Number(b.dataset.signCo));
    b.onclick = () => signatureDialog({ title: t('Aprobar change order'), summary: c.description, amount: c.price_cents, onSign: v => api('POST', `/api/jobs/${j.id}/sign`, { ...v, target: 'change_order', target_id: c.id }).then(reload) }); });
}

// ================= v1.7: CUENTAS Y PROYECCIONES =================
// ---------- Cuentas: por cobrar (clientes) y por pagar (subs) ----------
async function viewAccounts(app) {
  const [rec, pay] = await Promise.all([api('GET', '/api/receivables'), api('GET', '/api/payables')]);
  app.innerHTML = `<h1>${t('Cuentas')}</h1>
    <div class="grid kpis"><div class="kpi"><div class="label">${t('Nos deben los clientes')}</div><div class="value">${fmt0(rec.totals.balance_cents)}</div></div>
      <div class="kpi"><div class="label">${t('Debemos a subs (total)')}</div><div class="value">${fmt0(pay.totals.owed_cents)}</div></div>
      <div class="kpi"><div class="label">${t('Invoices de subs por pagar ya')}</div><div class="value">${fmt0(pay.totals.due_now_cents)}</div></div>
      <div class="kpi"><div class="label">${t('Cobrado a clientes')}</div><div class="value">${fmt0(rec.totals.paid_cents)}</div></div></div>
    <div class="card"><h2>💵 ${t('Clientes: cuánto han pagado y cuánto deben')}</h2>${rec.rows.length ? `<div class="table-wrap"><table><thead><tr><th>${t('Cliente')}</th><th class="num">${t('Contrato')}</th><th class="num">${t('Pagado')}</th><th class="num">${t('Debe')}</th><th>${t('Avance de pago')}</th><th>${t('Último pago')}</th><th></th></tr></thead><tbody>
      ${rec.rows.map(r => `<tr data-job="${r.job_id}"><td><a href="#/obra/${r.job_id}/pagos"><b>${esc(r.client_name)}</b></a><div class="small muted">${statusLabel(r.status)}</div></td><td class="num">${fmt(r.contract_cents)}</td><td class="num">${fmt(r.paid_cents)}</td>
        <td class="num ${r.balance_cents > 0 ? '' : 'pos'}"><b>${fmt(r.balance_cents)}</b></td><td style="min-width:110px"><div class="bar"><span style="width:${Math.min(100, r.pct_paid)}%"></span></div><span class="small">${r.pct_paid}%</span></td>
        <td class="small nowrap">${r.last_payment ? fdate(r.last_payment) + (r.days_since_payment > 30 && r.balance_cents > 0 ? ` <b class="neg">(${t('hace {n} días', { n: r.days_since_payment })})</b>` : '') : '—'}</td>
        <td class="nowrap"><a class="btn sm" target="_blank" rel="noopener" href="/api/jobs/${r.job_id}/statement/pdf">📄 PDF</a></td></tr>`).join('')}</tbody></table></div>` : `<p class="empty">—</p>`}</div>
    <div class="card"><h2>👷 ${t('Subs: cuánto se les ha pagado y cuánto se les debe')}</h2><p class="small muted">${t('Pagado = pagos directos + invoices marcados como pagados. "Por pagar ya" = invoices aprobados que todavía no se pagan.')}</p>
      ${pay.subs.length ? pay.subs.map((g, i) => `<details class="subacc"><summary><span><b>${esc(g.name)}</b>${g.trade ? ` <span class="small muted">${esc(g.trade)}</span>` : ''}</span>
        <span class="nums"><span>${t('Acordado')} <b>${fmt(g.agreed_cents)}</b></span><span>${t('Pagado')} <b>${fmt(g.paid_cents)}</b></span><span>${t('Debemos')} <b>${fmt(g.owed_cents)}</b></span>${g.due_now_cents ? `<span class="badge b-urg">${t('Por pagar ya')}: ${fmt(g.due_now_cents)}</span>` : ''}</span></summary>
        <div class="table-wrap"><table><thead><tr><th>${t('Obra')}</th><th class="num">${t('Acordado')}</th><th class="num">${t('Pagado')}</th><th class="num">${t('Debemos')}</th><th class="num">${t('Por pagar ya')}</th></tr></thead><tbody>
        ${g.jobs.map(a => `<tr><td><a href="#/obra/${a.job_id}/subs">${esc(a.client_name)}</a></td><td class="num">${fmt(a.agreed_cents)}</td><td class="num">${fmt(a.paid_cents)}</td><td class="num"><b>${fmt(a.owed_cents)}</b></td><td class="num">${a.due_now_cents ? fmt(a.due_now_cents) : '—'}</td></tr>
          ${(a.payments || []).map(p => `<tr class="small"><td colspan="2" class="muted">↳ ${fdate(p.date)} · <b>${esc(payLabel(p.method) || '—')}</b>${p.reference ? ' ' + esc(p.reference) : ''}${p.doc_number ? ' · Invoice ' + esc(p.doc_number) : ''}</td><td class="num muted">${fmt(p.amount_cents)}</td><td colspan="2"></td></tr>`).join('')}`).join('')}</tbody></table></div>
        <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="/api/subs/statement/pdf?key=${encodeURIComponent(g.key)}">📄 ${t('Estado de cuenta PDF')}</a>${g.user_id ? `<button class="sm" data-share="${i}">💬 ${t('Mandar al sub')}</button>` : ''}</div></details>`).join('') : `<p class="empty">—</p>`}</div>`;
  $$('[data-share]', app).forEach(b => { b.onclick = async () => {
    const g = pay.subs[Number(b.dataset.share)];
    const users = await api('GET', '/api/users'); const u = users.find(x => x.id === g.user_id) || {};
    const l = u.lang || 'es';
    const msg = tl(l, 'Elevated Exteriors: su estado de cuenta. Acordado {a}, pagado {p}, le debemos {o}. Véalo en la app (Mis pagos): {url}', { a: fmtIn(l, g.agreed_cents), p: fmtIn(l, g.paid_cents), o: fmtIn(l, g.owed_cents), url: appUrl() });
    msgDialog({ title: t('Mandar al sub'), people: [{ name: g.name, phone: u.phone, lang: l, text: msg }] });
  }; });
}
const fmtIn = (l, c) => (c / 100).toLocaleString(l === 'en' ? 'en-US' : 'es-MX', { style: 'currency', currency: 'USD' });
function msgDialog({ title, people }) {
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${people.map(p => `<div class="share-item"><b>${esc(p.name)}</b> <span class="small muted">· ${p.lang === 'en' ? 'English' : 'Español'}</span><p class="small msg">${esc(p.text)}</p><div class="row">${sendButtons(p.phone, p.text, p.email, 'Elevated Exteriors')}</div></div>`).join('')}
    <div class="foot"><button class="primary" type="submit">${t('Listo')}</button></div></form>`;
  document.body.appendChild(d);
  $$('[data-copy]', d).forEach(b => { b.onclick = async e => { e.preventDefault(); try { await navigator.clipboard.writeText(b.dataset.copy); toast(t('Copiado')); } catch { toast(t('No se pudo copiar'), true); } }; });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}
// Pestaña Pagos de la obra: estado de cuenta y mandar saldo al cliente.
async function ownerStatementCard(box, job) {
  const s = await api('GET', `/api/jobs/${job.id}/statement`);
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<div class="row between"><h2>📄 ${t('Estado de cuenta del cliente')}</h2><div class="row"><a class="btn sm" target="_blank" rel="noopener" href="/api/jobs/${job.id}/statement/pdf">PDF</a><button class="sm primary" data-send>💬 ${t('Mandar saldo al cliente')}</button></div></div>
    ${stmtTable(s)}${s.pending_change_orders.count ? `<p class="small muted">${t('{n} change order(s) pendiente(s) por {m} no se suman hasta aprobarse.', { n: s.pending_change_orders.count, m: fmt(s.pending_change_orders.amount_cents) })}</p>` : ''}`;
  box.appendChild(c);
  $('[data-send]', c).onclick = async () => {
    let l = 'es';
    if (job.client_user_id) { try { l = ((await api('GET', '/api/users')).find(u => u.id === job.client_user_id) || {}).lang || 'es'; } catch { /* */ } }
    const msg = tl(l, 'Elevated Exteriors: estado de cuenta de su proyecto. Total {c}, pagado {p}, saldo {b}. Lo puede ver y descargar en la app: {url}', { c: fmtIn(l, s.totals.contract_cents), p: fmtIn(l, s.totals.paid_cents), b: fmtIn(l, s.totals.balance_cents), url: appUrl() });
    msgDialog({ title: t('Mandar saldo al cliente'), people: [{ name: job.client_name, phone: job.client_phone, email: job.client_email, lang: l, text: msg }] });
  };
}
function stmtTable(s) {
  const lbl = { contract: t('Precio del proyecto'), change_order: t('Change order'), payment: t('Pago') };
  return `<div class="money-strip" style="margin:.6rem 0"><div><span>${t('Total')}</span><b>${fmt(s.totals.contract_cents)}</b></div><div><span>${t('Pagado')}</span><b>${fmt(s.totals.paid_cents)}</b></div><div><span>${t('Saldo')}</span><b>${fmt(s.totals.balance_cents)}</b></div><div><span>${t('Pagado')} %</span><b>${s.totals.pct_paid}%</b></div></div>
    <div class="bar big" style="margin-bottom:.6rem"><span style="width:${Math.min(100, s.totals.pct_paid)}%"></span></div>
    <div class="table-wrap"><table class="stmt"><thead><tr><th>${t('Concepto')}</th><th class="num">${t('Cargo')}</th><th class="num">${t('Pago')}</th><th class="num">${t('Saldo')}</th></tr></thead><tbody>
    ${s.moves.map(m => `<tr><td><div class="small muted">${fdate(m.date)}</div>${lbl[m.kind]}${m.desc ? ` <span class="small muted">· ${esc(t(m.desc))}</span>` : ''}</td><td class="num" data-l="${t('Cargo')}">${m.amount_cents > 0 ? fmt(m.amount_cents) : ''}</td><td class="num pos" data-l="${t('Pago')}">${m.amount_cents < 0 ? fmt(-m.amount_cents) : ''}</td><td class="num" data-l="${t('Saldo')}"><b>${fmt(m.balance_cents)}</b></td></tr>`).join('')}</tbody></table></div>`;
}
// Cliente: estado de cuenta en su portal.
async function clientStatementCard(app, j) {
  const portal = $('.portal', app); if (!portal) return;
  const s = await api('GET', `/api/jobs/${j.id}/statement`);
  if (!portal.isConnected || !s.totals.contract_cents) return;
  const old = $$('.card', portal).find(c => $('h2', c) && $('h2', c).textContent === t('Pagos'));
  const c = document.createElement('div'); c.className = 'card';
  c.innerHTML = `<div class="row between"><h2>${t('Su cuenta')}</h2><a class="btn sm" target="_blank" rel="noopener" href="/api/jobs/${j.id}/statement/pdf?lang=${LANG}">📄 ${t('Descargar estado de cuenta')}</a></div>${stmtTable(s)}`;
  if (old) old.replaceWith(c); else portal.appendChild(c);
}
// Sub: Mis pagos.
async function viewMyPayments(app) {
  const g = await api('GET', '/api/subs/statement');
  app.innerHTML = `<h1>${t('Mis pagos')}</h1><p class="small muted">${t('Lo acordado con Elevated Exteriors en cada obra, lo que se le ha pagado y lo que falta.')}</p>
    <div class="grid kpis"><div class="kpi"><div class="label">${t('Acordado')}</div><div class="value">${fmt0(g.agreed_cents)}</div></div><div class="kpi"><div class="label">${t('Pagado')}</div><div class="value">${fmt0(g.paid_cents)}</div></div>
      <div class="kpi"><div class="label">${t('Le debemos')}</div><div class="value">${fmt0(g.owed_cents)}</div></div><div class="kpi"><div class="label">${t('Invoices aprobados por pagar')}</div><div class="value">${fmt0(g.due_now_cents)}</div></div></div>
    ${g.jobs.length ? g.jobs.map(a => `<div class="card"><div class="row between"><h2 style="margin:0">${esc(a.client_name)}</h2><span class="small">${t('Le debemos')} <b>${fmt(a.owed_cents)}</b></span></div>
      <div class="small muted">${esc(a.address || '')}</div>
      <table style="margin-top:.5rem"><tbody><tr><td>${t('Acordado')}</td><td class="num"><b>${fmt(a.agreed_cents)}</b></td></tr>
      ${a.payments.map(p => `<tr><td class="small">${fdate(p.date)} · ${t('Pago')} · <b>${esc(payLabel(p.method) || '—')}</b>${p.reference ? ' ' + esc(p.reference) : ''}${p.doc_number ? ' · Invoice ' + esc(p.doc_number) : ''}</td><td class="num pos">−${fmt(p.amount_cents)}</td></tr>`).join('')}
      ${a.invoices.filter(i => i.remaining_cents > 0).map(i => `<tr><td class="small">${fdate(i.date)} · Invoice ${esc(i.number)} <span class="badge b-pendiente">${i.paid_cents ? t('pago parcial: falta {m}', { m: fmt(i.remaining_cents) }) : t('aprobado, por pagar')}</span></td><td class="num">${fmt(i.total_cents)}</td></tr>`).join('')}
      <tr><td><b>${t('Le debemos')}</b></td><td class="num"><b>${fmt(a.owed_cents)}</b></td></tr></tbody></table></div>`).join('')
      : `<div class="card empty">${t('Todavía no hay acuerdos registrados con usted.')}</div>`}
    ${g.jobs.length ? `<a class="btn primary" target="_blank" rel="noopener" href="/api/subs/statement/pdf?lang=${LANG}">📄 ${t('Descargar estado de cuenta')}</a>` : ''}`;
}

// ---------- Proyecciones ----------
const FC = { horizon: 6, close: 1, leads: 1, price: 1, material: 0 };
function monthName(m) { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-MX', { month: 'short', year: '2-digit', timeZone: 'UTC' }); }
// Barras (lo más probable) con bigote del rango P10–P90. Una sola serie por gráfica: sin leyenda.
function rangeChart(rows, key, { cap } = {}) {
  const W = 720, H = 240, L = 64, Rm = 12, T = 14, B = 34;
  const max = Math.max(1, ...rows.map(r => r[key].p90), cap || 0);
  const nice = (() => { const e = Math.pow(10, Math.floor(Math.log10(max))); for (const k of [1, 2, 2.5, 5, 10]) if (k * e >= max) return k * e; return 10 * e; })();
  const y = v => T + (H - T - B) * (1 - v / nice);
  const bw = (W - L - Rm) / rows.length, barW = Math.min(44, bw * 0.5);
  const money = key !== 'active_jobs';
  const lab = v => money ? (v >= 100000000 ? '$' + Math.round(v / 100000000) + 'M' : v >= 100000 ? '$' + Math.round(v / 100000) + 'k' : '$' + Math.round(v / 100)) : String(v);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * nice);
  return `<div class="rchart"><svg viewBox="0 0 ${W} ${H}" role="img" preserveAspectRatio="xMidYMid meet">
    ${ticks.map(v => `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${lab(v)}</text>`).join('')}
    ${cap ? `<line x1="${L}" x2="${W - Rm}" y1="${y(cap)}" y2="${y(cap)}" class="cap"/><text x="${W - Rm}" y="${y(cap) - 5}" text-anchor="end" class="ax">${t('Capacidad')}: ${cap}</text>` : ''}
    ${rows.map((r, i) => { const cx = L + bw * i + bw / 2, v = r[key]; const top = y(v.p50), base = y(0); const h = Math.max(0, base - top);
      return `<g class="mk" data-i="${i}"><rect x="${L + bw * i}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>
        ${h > 0 ? `<path d="M${cx - barW / 2},${base} V${top + Math.min(4, h)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${base} Z" class="bar50"/>` : ''}
        <line x1="${cx}" x2="${cx}" y1="${y(v.p10)}" y2="${y(v.p90)}" class="wh"/><line x1="${cx - 7}" x2="${cx + 7}" y1="${y(v.p90)}" y2="${y(v.p90)}" class="wh"/><line x1="${cx - 7}" x2="${cx + 7}" y1="${y(v.p10)}" y2="${y(v.p10)}" class="wh"/>
        <text x="${cx}" y="${H - B + 18}" text-anchor="middle" class="ax">${monthName(r.month)}</text></g>`; }).join('')}
    <line x1="${L}" x2="${W - Rm}" y1="${y(0)}" y2="${y(0)}" class="base"/></svg><div class="tip" hidden></div></div>`;
}
function bindChart(el, rows, key) {
  const tip = $('.tip', el), money = key !== 'active_jobs', f = v => money ? fmt0(v) : v;
  $$('.mk', el).forEach(g => {
    g.onmouseenter = g.onclick = () => {
      const r = rows[Number(g.dataset.i)], v = r[key];
      tip.innerHTML = `<b>${monthName(r.month)}</b><br>${t('Lo más probable')}: <b>${f(v.p50)}</b><br><span class="muted">${t('Rango')}: ${f(v.p10)} – ${f(v.p90)}</span>`;
      tip.hidden = false;
      const box = el.getBoundingClientRect(), gb = g.getBoundingClientRect();
      tip.style.left = Math.min(box.width - 190, Math.max(0, gb.left - box.left + gb.width / 2 - 90)) + 'px'; tip.style.top = '4px';
      g.classList.add('on');
    };
    g.onmouseleave = () => { tip.hidden = true; g.classList.remove('on'); };
  });
}
async function viewForecast(app) {
  const q = new URLSearchParams(Object.entries(FC).map(([k, v]) => [k, String(v)]));
  const [f, h] = await Promise.all([api('GET', '/api/forecast?' + q), api('GET', '/api/history')]);
  const A = f.assumptions, D = f.data;
  const QL = { poca: t('Pocos datos: los rangos son amplios. Cargue el historial de obras pasadas para afinar.'), media: t('Datos suficientes para una idea razonable. Mejora con más historial.'), buena: t('Buen historial: proyección confiable dentro de los rangos.') };
  const slow = f.months.filter(m => m.prob_negative >= 30);
  const capWarn = f.capacity ? f.months.filter(m => m.active_jobs.p50 > f.capacity) : [];
  const sl = (k, label, min, max, step, fmtv) => `<label class="sl"><span>${label}: <b data-v="${k}">${fmtv(FC[k])}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${FC[k]}" data-k="${k}"></label>`;
  const pctv = v => (v >= 1 ? '+' : '') + Math.round((v - 1) * 100) + '%';
  app.innerHTML = `<div class="row between"><h1>${t('Proyecciones')}</h1><div class="row">${[3, 6, 12].map(n => `<button class="sm ${FC.horizon === n ? 'primary' : ''}" data-h="${n}">${t('{n} meses', { n })}</button>`).join('')}</div></div>
    <div class="card quality q-${D.quality}"><b>${t('Calidad de los datos')}: ${D.quality === 'poca' ? t('poca') : D.quality === 'media' ? t('media') : t('buena')}</b> · ${t('{w} obras ganadas, {l} perdidas, {m} meses de historial', { w: D.won, l: D.lost, m: D.months })}${D.hist ? ` · ${t('{n} del historial importado', { n: D.hist })}` : ''}
      <div class="small">${QL[D.quality]}</div><div class="row" style="margin-top:.5rem"><button class="sm primary" id="imp">⬆ ${t('Importar historial (Excel/CSV)')}</button>${h.count ? `<button class="sm" id="delh">${t('Borrar historial importado ({n})', { n: h.count })}</button>` : ''}</div></div>
    <div class="grid kpis">
      <div class="kpi"><div class="label">${t('Ventas nuevas ({n} meses)', { n: FC.horizon })}</div><div class="value">${fmt0(f.totals.bookings.p50)}</div><div class="small">${fmt0(f.totals.bookings.p10)} – ${fmt0(f.totals.bookings.p90)}</div></div>
      <div class="kpi"><div class="label">${t('Cobros esperados')}</div><div class="value">${fmt0(f.totals.cash_in.p50)}</div><div class="small">${fmt0(f.totals.cash_in.p10)} – ${fmt0(f.totals.cash_in.p90)}</div></div>
      <div class="kpi"><div class="label">${t('Ganancia de lo vendido')}</div><div class="value">${fmt0(f.totals.profit.p50)}</div><div class="small">${fmt0(f.totals.profit.p10)} – ${fmt0(f.totals.profit.p90)}</div></div>
      <div class="kpi"><div class="label">${t('Obras nuevas')}</div><div class="value">${f.totals.new_jobs.p50}</div><div class="small">${f.totals.new_jobs.p10} – ${f.totals.new_jobs.p90}</div></div></div>
    <p class="small muted">${t('Número grande = lo más probable. Abajo = rango: 8 de cada 10 futuros simulados caen entre esos dos valores (2,000 simulaciones con su historial).')}</p>
    ${slow.length ? `<div class="card notices"><b>⚠️ ${t('Meses que pueden salir flojos de efectivo')}:</b> ${slow.map(m => `${monthName(m.month)} (${t('{p}% de probabilidad de gastar más de lo que entra', { p: m.prob_negative })})`).join(' · ')}</div>` : ''}
    ${capWarn.length ? `<div class="card notices"><b>⚠️ ${t('Posible saturación')}:</b> ${t('se esperan más obras al mismo tiempo que su capacidad ({c}) en', { c: f.capacity })} ${capWarn.map(m => monthName(m.month)).join(', ')}.</div>` : ''}
    <div class="card"><h2>${t('Ventas nuevas por mes')}</h2><p class="small muted">${t('Contratos que se espera firmar. Barra = lo más probable; línea = rango.')}</p><div data-c="bookings"></div></div>
    <div class="card"><h2>${t('Cobros esperados por mes')}</h2><p class="small muted">${t('Dinero que entra: saldos de obras activas + anticipos y pagos de lo que se cierre.')}</p><div data-c="cash_in"></div></div>
    <div class="card"><div class="row between"><h2>${t('Obras al mismo tiempo')}</h2><button class="sm" id="cap">${t('Capacidad')}: ${f.capacity || '—'}</button></div><div data-c="active_jobs"></div></div>
    <div class="card"><h2>${t('Tabla por mes')}</h2><div class="table-wrap"><table><thead><tr><th>${t('Mes')}</th><th class="num">${t('Ventas (probable)')}</th><th class="num">${t('Cobros (probable)')}</th><th class="num">${t('Gastos (probable)')}</th><th class="num">${t('Efectivo neto')}</th><th class="num">${t('Riesgo mes negativo')}</th><th class="num">${t('Obras nuevas')}</th></tr></thead><tbody>
      ${f.months.map(m => `<tr><td>${monthName(m.month)}</td><td class="num">${fmt0(m.bookings.p50)}</td><td class="num">${fmt0(m.cash_in.p50)}</td><td class="num">${fmt0(m.cash_out.p50)}</td><td class="num ${m.net.p50 < 0 ? 'neg' : 'pos'}">${fmt0(m.net.p50)}</td><td class="num">${m.prob_negative >= 30 ? `<b class="neg">${m.prob_negative}%</b>` : m.prob_negative + '%'}</td><td class="num">${m.new_jobs.p50}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h2>🧪 ${t('Escenarios: ¿qué pasa si…?')}</h2><div class="sliders">
      ${sl('close', t('Cerramos más o menos'), 0.5, 1.5, 0.05, pctv)}${sl('leads', t('Llegan más o menos prospectos'), 0.5, 2, 0.05, pctv)}
      ${sl('price', t('Subimos o bajamos precios'), 0.8, 1.3, 0.01, pctv)}${sl('material', t('Sube o baja el material'), -0.2, 0.5, 0.05, v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%')}</div>
      <div class="row"><button class="primary" id="run">${t('Recalcular')}</button><button id="reset">${t('Volver a lo normal')}</button></div></div>
    <div class="card"><h2>📐 ${t('En qué se basa (supuestos tomados de su historial)')}</h2><table><tbody>
      <tr><th>${t('Prospectos por mes')}</th><td>${A.leads_per_month}</td></tr><tr><th>${t('Probabilidad general de cierre')}</th><td>${A.close_rate}%</td></tr>
      <tr><th>${t('Obra promedio')}</th><td>${A.avg_deal_cents ? fmt0(A.avg_deal_cents) : t('sin datos (se usa $25,000)')}</td></tr><tr><th>${t('Margen típico')}</th><td>${A.margin_pct}%</td></tr>
      <tr><th>${t('Días de prospecto a firma')}</th><td>${A.days_to_close ?? t('sin datos (14–60)')}</td></tr><tr><th>${t('Duración de una obra (días)')}</th><td>${A.duration_days ?? t('sin datos (30–75)')}</td></tr>
      <tr><th>${t('Anticipo típico')}</th><td>${A.deposit_pct}%</td></tr><tr><th>${t('Material dentro del costo')}</th><td>${A.material_share}%</td></tr>
      <tr><th>${t('Abiertos ahora')}</th><td>${t('{a} prospectos/estimados · {b} obras activas', { a: A.open_deals, b: A.active_jobs })}</td></tr></tbody></table>
      ${A.by_source.length ? `<h3>${t('Probabilidad de cierre por origen')}</h3><table><thead><tr><th>${t('Origen')}</th><th class="num">${t('Ganadas')}</th><th class="num">${t('Perdidas')}</th><th class="num">${t('Probabilidad')}</th></tr></thead><tbody>${A.by_source.map(s => `<tr><td>${esc(s.source)}</td><td class="num">${s.won}</td><td class="num">${s.lost}</td><td class="num"><b>${s.p}%</b></td></tr>`).join('')}</tbody></table>
        <p class="small muted">${t('Con pocos casos, la probabilidad se acerca al promedio general para no exagerar (si un origen tiene 1 de 1, no se asume 100%).')}</p>` : ''}
      ${A.by_type.length ? `<h3>${t('Por tipo de proyecto')}</h3><table><thead><tr><th>${t('Tipo')}</th><th class="num">${t('Obras')}</th><th class="num">${t('Promedio')}</th><th class="num">${t('Margen')}</th></tr></thead><tbody>${A.by_type.map(x => `<tr><td>${esc(typeLabel(x.project_type))}</td><td class="num">${x.jobs}</td><td class="num">${fmt0(x.avg_cents)}</td><td class="num">${x.margin_pct}%</td></tr>`).join('')}</tbody></table>` : ''}
      ${A.season.some(v => v !== 1) ? `<h3>${t('Temporada (1.00 = mes normal)')}</h3><div class="season">${A.season.map((v, i) => `<span><small>${new Date(Date.UTC(2026, i, 15)).toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-MX', { month: 'short', timeZone: 'UTC' })}</small><b class="${v > 1.1 ? 'pos' : v < 0.9 ? 'neg' : ''}">${v.toFixed(2)}</b></span>`).join('')}</div>` : ''}</div>`;
  for (const key of ['bookings', 'cash_in', 'active_jobs']) { const el = $(`[data-c="${key}"]`, app); el.innerHTML = rangeChart(f.months, key, key === 'active_jobs' ? { cap: f.capacity } : {}); bindChart(el, f.months, key); }
  $$('[data-h]', app).forEach(b => { b.onclick = () => { FC.horizon = Number(b.dataset.h); viewForecast(app); }; });
  $$('input[data-k]', app).forEach(i => { i.oninput = () => { const k = i.dataset.k; FC[k] = Number(i.value); $(`[data-v="${k}"]`, app).textContent = k === 'material' ? (FC[k] >= 0 ? '+' : '') + Math.round(FC[k] * 100) + '%' : pctv(FC[k]); }; });
  $('#run', app).onclick = () => { $$('input[data-k]', app).forEach(i => { FC[i.dataset.k] = Number(i.value); }); viewForecast(app); };
  $('#reset', app).onclick = () => { Object.assign(FC, { close: 1, leads: 1, price: 1, material: 0 }); viewForecast(app); };
  $('#cap', app).onclick = async () => { if (await formDialog({ title: t('Capacidad'), intro: `<p class="small muted">${t('¿Cuántas obras pueden llevar al mismo tiempo con su gente actual?')}</p>`, fields: [{ name: 'capacity', label: t('Obras al mismo tiempo'), value: f.capacity || '', required: true }], onSubmit: v => api('PUT', '/api/forecast/capacity', v) })) viewForecast(app); };
  if ($('#delh', app)) $('#delh', app).onclick = async () => { if (await confirmDialog(t('¿Borrar todo el historial importado? Las obras de la app no se tocan.'))) { await act(() => api('DELETE', '/api/history'), t('Borrado')); viewForecast(app); } };
  $('#imp', app).onclick = () => importHistoryDialog(() => viewForecast(app));
}
function importHistoryDialog(after) {
  const d = document.createElement('dialog');
  d.innerHTML = `<form method="dialog"><h2>${t('Importar historial de obras pasadas')}</h2>
    <p class="small">${t('Un renglón por cada prospecto u obra de los últimos 1–2 años (también los que NO se cerraron, para saber la probabilidad de cierre). Guarde su Excel como CSV.')}</p>
    <p class="small muted">${t('Columnas: fecha_prospecto, fecha_cierre, fecha_terminado, cliente, tipo, origen, precio, costo, cerrado (si/no). Fechas como 2025-03-15 o 3/15/2025; precios con o sin $ y comas.')}</p>
    <p><a class="btn sm" href="/api/history/template">⬇ ${t('Descargar plantilla')}</a></p>
    <label class="btn primary">📄 ${t('Elegir archivo CSV')}<input type="file" accept=".csv,text/csv" hidden></label>
    <div class="res small" style="margin-top:.6rem"></div>
    <div class="foot"><button class="primary" type="submit">${t('Cerrar')}</button></div></form>`;
  document.body.appendChild(d);
  $('input', d).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 3e6) return toast(t('Archivo muy grande (máximo 3 MB)'), true);
    try {
      const r = await api('POST', '/api/history/import', { csv: await file.text() });
      $('.res', d).innerHTML = `<b class="pos">✓ ${t('{n} renglones importados', { n: r.imported })}</b>${r.skipped ? `<br>${t('{n} renglones no se pudieron leer', { n: r.skipped })}: ${r.errors.map(x => `${t('fila')} ${x.row} (${t(x.error)})`).join(', ')}` : ''}`;
    } catch (x) { $('.res', d).innerHTML = `<b class="neg">${esc(x.message)}</b>`; }
  };
  d.addEventListener('close', () => { d.remove(); after(); });
  d.showModal();
}

// ---------- Pagos a subs (parciales, con forma de pago) ----------
// v2.34: las formas de pago a los subs las ajustan los dueños en Categorías y listas.
const SUBPAYS = cur => vis(CAT && CAT.subPayMethods, cur).map(x => x.key);
const PAY_METHODS_FALLBACK = ['Zelle', 'Cheque', 'Depósito directo', 'Transferencia', 'Efectivo', 'Tarjeta', 'Otro'];
const payLabelIn = (l, m) => { const x = ((CAT && CAT.subPayMethods) || []).find(i => i.key === m); return x ? (l === 'en' ? x.en || x.es : x.es) : tl(l, m); };
const payLabel = m => (m ? payLabelIn(LANG, m) : '');
async function subPayDialog(s, { docId = null, after, suggest = null } = {}) {
  let info; try { info = await api('GET', `/api/subs/${s.id}/payments`); } catch (e) { toast(e.message, true); return; }
  const dual = suggest && suggest.dual && ME.role === 'owner';
  const open = info.invoices.filter(i => i.remaining_cents > 0);
  const sel = docId ? open.find(i => i.id === docId) : null;
  let res;
  const ok = await formDialog({ title: t('Pago a {x}', { x: s.name || info.sub.name }), submit: dual ? t('Pedir autorización del pago') : t('Registrar pago'),
    intro: `${dual ? `<div class="compare small">🔒 ${t('Cada pago a un sub lo autorizan los dos dueños: se registra cuando el otro dueño lo apruebe.')}</div>` : ''}${suggest && !suggest.w9 ? `<div class="compare small">⚠️ ${t('Este sub no tiene W-9 en Papeles de subs.')}</div>` : ''}<div class="money-strip small" style="margin-bottom:.6rem"><div><span>${t('Acordado')}</span><b>${fmt(info.agreed_cents)}</b></div><div><span>${t('Pagado')}</span><b>${fmt(info.paid_cents)}</b></div><div><span>${t('Le debemos')}</span><b>${fmt(info.owed_cents)}</b></div></div>
      ${open.length && !docId ? `<div class="compare small">${t('Tiene invoices aprobados con saldo: {x}. Si este pago es para uno de ellos, elíjalo en "Aplicar a" (así no se cuenta el gasto dos veces).', { x: open.map(i => `${i.number} (${t('falta')} ${fmt(i.remaining_cents)})`).join(', ') })}</div>` : ''}`,
    fields: [
      ...(open.length ? [{ name: 'doc_id', label: t('Aplicar a'), type: 'select', value: sel ? String(sel.id) : '', options: [['', t('Pago al acuerdo de la obra (sin invoice)')], ...open.map(i => [String(i.id), `Invoice ${i.number} — ${t('falta')} ${fmt(i.remaining_cents)}`])] }] : []),
      { name: 'amount_cents', label: t('Monto ($)'), type: 'money', required: true, value: centsToInput(sel ? sel.remaining_cents : suggest && suggest.due_now_cents > 0 ? suggest.due_now_cents : suggest && suggest.next && suggest.next.amount_cents > 0 ? suggest.next.amount_cents : Math.max(0, info.owed_cents)), hint: suggest && suggest.next ? t('Según su plan toca: {x}', { x: payStageLabel(suggest.next.key, suggest.next.pct) }) : t('Puede ser un pago parcial.') },
      { name: 'date', label: t('Fecha del pago'), type: 'date', required: true, value: today() },
      { name: 'method', label: t('Forma de pago'), type: 'select', value: 'Zelle', options: (SUBPAYS().length ? SUBPAYS() : PAY_METHODS_FALLBACK).map(m => [m, payLabel(m)]) },
      { name: 'reference', label: t('Referencia'), hint: t('# de cheque, confirmación de Zelle o del depósito') },
      { name: 'note', label: t('Nota') },
      { name: 'receipt', label: t('Foto del cheque o comprobante (opcional)'), type: 'photo' },
    ],
    onSubmit: async v => { res = await api('POST', `/api/subs/${s.id}/payments`, { ...v, doc_id: v.doc_id ? Number(v.doc_id) : null }); } });
  if (!ok) return;
  if (res && res.pending) { if (after) after(); return; }
  toast(t('Pago registrado'));
  if (after) after();
  // Avisar al sub por WhatsApp (en su idioma).
  if (info.sub.user_id) {
    try {
      const u = (await api('GET', '/api/users')).find(x => x.id === info.sub.user_id);
      const last = res.payments.at(-1); const l = (u && u.lang) || 'es';
      if (u && last) {
        const msg = tl(l, 'Elevated Exteriors: le enviamos un pago de {m} por {how}{ref}{inv}. Pagado hasta hoy: {p}. Pendiente: {o}. Véalo en la app (Mis pagos).',
          { m: fmtIn(l, last.amount_cents), how: payLabelIn(l, last.method), ref: last.reference ? ' (' + last.reference + ')' : '', inv: last.doc_number ? ' — Invoice ' + last.doc_number : '', p: fmtIn(l, res.paid_cents), o: fmtIn(l, Math.max(0, res.owed_cents)) });
        msgDialog({ title: t('Avisar al sub'), people: [{ name: u.name, phone: u.phone, lang: l, text: msg }] });
      }
    } catch { /* aviso opcional */ }
  }
}

// ================= SEGURIDAD DE CAMBIOS =================
const FIELD_L = () => ({ amount_cents: t('Monto'), date: t('Fecha'), category: t('Categoría'), description: t('Descripción'), price_cents: t('Precio al cliente'), cost_cents: t('Costo'),
  status: t('Estado'), quoted_cents: t('Precio del proyecto'), agreed_cents: t('Acordado'), in_at: t('Entrada'), out_at: t('Salida'), method: t('Forma de pago'), reference: t('Referencia'), note: t('Nota'), vendor: t('Dónde'), name: t('Nombre') });
const isMoneyKey = k => /_cents$/.test(k);
function diffRows(before, proposed) {
  const L = FIELD_L();
  const keys = Object.keys(proposed || {}).filter(k => k in L && String(proposed[k] ?? '') !== String((before || {})[k] ?? ''));
  if (!keys.length) return '';
  const f = (k, v) => v == null || v === '' ? '—' : isMoneyKey(k) ? fmt(Number(v)) : esc(t(String(v)));
  return `<table class="diff"><tbody>${keys.map(k => `<tr><th>${L[k]}</th><td class="neg"><s>${f(k, before[k])}</s></td><td>→</td><td class="pos"><b>${f(k, proposed[k])}</b></td></tr>`).join('')}</tbody></table>`;
}
// Inicio del dueño: cambios que esperan su autorización.
async function changeRequestsCard(box, refresh) {
  const r = await api('GET', '/api/change-requests');
  if (!r.to_approve.length && !r.mine.length) { box.remove(); return; }
  box.className = 'card notices';
  box.innerHTML = `<h2>🔒 ${t('Cambios por autorizar')}</h2>
    ${r.to_approve.map(c => `<div class="creq" data-id="${c.id}"><div><b>${esc(c.by)}</b> ${t('pide')}: <b>${esc(c.summary)}</b>${c.client_name ? ` <span class="small muted">· ${esc(c.client_name)}</span>` : ''}</div>
      <div class="small">${t('Motivo')}: “${esc(c.reason)}” · ${fdayLocal(c.created_at)}${c.first_by_name ? ` · <span class="badge b-hecho">✔ ${t('{x} ya dio su visto bueno', { x: esc(c.first_by_name) })}</span>` : ''}</div>${diffRows(c.before, c.proposed)}
      <div class="row"><input data-note placeholder="${esc(t('Nota (opcional)'))}" style="flex:1;min-width:140px"><button class="sm danger" data-rej>${t('No autorizar')}</button><button class="sm primary" data-ok>✓ ${t('Autorizar')}</button></div></div>`).join('')}
    ${r.mine.length ? `<h3>${t('Mis solicitudes esperando al otro dueño')}</h3>${r.mine.map(c => `<div class="creq mine" data-id="${c.id}"><span class="small">⏳ ${esc(c.summary)} · “${esc(c.reason)}”</span><button class="sm" data-cancel>${t('Cancelar')}</button></div>`).join('')}` : ''}`;
  $$('.creq', box).forEach(el => {
    const id = el.dataset.id, note = () => ($('[data-note]', el) || {}).value || '';
    const ok = $('[data-ok]', el); if (ok) ok.onclick = async () => { try { const r = await api('POST', `/api/change-requests/${id}/decide`, { action: 'approve', note: note() }); toast(r && r.first ? t('Listo: falta que el otro dueño lo autorice') : t('Autorizado: el cambio ya se aplicó')); } catch (e) { toast(e.message, true); } refresh(); };
    const rj = $('[data-rej]', el); if (rj) rj.onclick = async () => { try { await api('POST', `/api/change-requests/${id}/decide`, { action: 'reject', note: note() }); toast(t('No autorizado: no cambió nada')); } catch (e) { toast(e.message, true); } refresh(); };
    const cc = $('[data-cancel]', el); if (cc) cc.onclick = async () => { await act(() => api('POST', `/api/change-requests/${id}/cancel`), t('Solicitud cancelada')); refresh(); };
  });
}
// Historial de cambios (bitácora).
const ACT_L = () => ({ 'visto bueno': t('Dio su visto bueno'), crear: t('Registró'), editar: t('Cambió'), borrar: t('Borró'), solicitud: t('Pidió autorización'), aprobar: t('Autorizó'), rechazar: t('No autorizó'),
  cancelar: t('Canceló su solicitud'), conflicto: t('No se aplicó (el registro cambió)'), 'cerrar periodo': t('Cerró el periodo') });
const ACT_C = { crear: 'b-hecho', editar: 'b-en_progreso', borrar: 'b-urg', solicitud: 'b-pendiente', aprobar: 'b-hecho', rechazar: 'b-urg', cancelar: 'b-pendiente', conflicto: 'b-urg', 'cerrar periodo': 'b-pendiente' };
async function viewAudit(app, jobId) {
  const rows = await api('GET', '/api/audit' + (jobId ? `?job_id=${jobId}` : ''));
  app.innerHTML = `<h1>${t('Historial de cambios')}</h1><p class="small muted">${t('Todo lo que se registra, cambia o borra de dinero queda aquí: quién, cuándo, cómo estaba antes y el motivo. No se puede borrar.')}</p>
    <div class="card">${rows.length ? rows.map(a => `<div class="audit"><div class="row between"><span><span class="badge ${ACT_C[a.action] || ''}">${ACT_L()[a.action] || esc(a.action)}</span> <b>${esc(a.user_name || '—')}</b> · ${esc(t(a.entity))}</span><span class="small muted">${fdayLocal(a.at)} ${ftime(a.at)}</span></div>
      <div>${esc(a.summary)}${a.client_name ? ` <span class="small muted">· <a href="#/obra/${a.job_id}">${esc(a.client_name)}</a></span>` : ''}</div>
      ${a.reason ? `<div class="small">${t('Motivo')}: “${esc(a.reason)}”</div>` : ''}${a.action === 'editar' && a.before && a.after ? diffRows(a.before, a.after) : ''}</div>`).join('') : `<p class="empty">${t('Todavía no hay cambios registrados.')}</p>`}</div>`;
}
// Mi cuenta: cierre de periodo.
async function lockCard(app) {
  const l = await api('GET', '/api/lock');
  const box = document.createElement('div'); box.className = 'card';
  box.innerHTML = `<h2>🔒 ${t('Cierre de periodo')}</h2>
    <p>${l.date ? `<span class="badge b-hecho">${t('Cerrado hasta el {d}', { d: fdate(l.date) })}</span>` : `<span class="badge b-pendiente">${t('Sin cierre')}</span>`}</p>
    <p class="small muted">${t('Cuando el contador ya revisó un mes (o ya lo exportaron a QuickBooks), ciérrenlo: nada con esa fecha o antes se podrá crear, cambiar ni borrar. Reabrir necesita la autorización del otro dueño.')}</p>
    <div class="row"><input type="date" id="lockd" value="${esc(l.date || '')}" style="width:auto"><button class="sm primary" id="lockb">${t('Cerrar hasta esta fecha')}</button>${l.date ? `<button class="sm" id="unlockb">${t('Reabrir')}</button>` : ''}</div>
    <p class="small" style="margin-top:.6rem"><a href="#/historial">📜 ${t('Ver historial de cambios')}</a></p>`;
  app.appendChild(box);
  $('#lockb', box).onclick = async () => { const d = $('#lockd', box).value; if (!d) return toast(t('Elija la fecha'), true);
    try { const r = await api('PUT', '/api/lock', { date: d }); if (!r.pending) toast(t('Periodo cerrado')); box.remove(); lockCard(app); } catch (e) { toast(e.message, true); } };
  const ub = $('#unlockb', box); if (ub) ub.onclick = async () => { try { const r = await api('PUT', '/api/lock', { date: '' }); if (!r.pending) toast(t('Periodo reabierto')); box.remove(); lockCard(app); } catch (e) { toast(e.message, true); } };
}

// ================= PROJECT MANAGER =================
async function viewPmHome(app) {
  ME = (await api('GET', '/api/status')).user;
  const left = Math.max(0, ME.pm_month_cents - (ME.pm_month_spent_cents || 0));
  app.innerHTML = `<h1>${t('Hola, {x}', { x: esc(ME.name.split(' ')[0]) })}</h1>
    <div class="card small pmlim">💼 ${t('Su límite por gasto: {a} · Límite al mes: {b} (le quedan {c})', { a: `<b>${fmt(ME.pm_limit_cents)}</b>`, b: `<b>${fmt(ME.pm_month_cents)}</b>`, c: `<b>${fmt(left)}</b>` })}
      <div class="muted">${t('Arriba de su límite, pagos a subs, precios, change orders y cambios o borrados de dinero se mandan a los dueños para que los autoricen.')}</div></div>
    <div></div><div></div><div></div><div></div><div></div><div></div><div></div>`;
  const [rq, nb, db2, cs, sc, note, sal] = [...app.children].slice(2);
  app.insertBefore(note, app.children[1]); app.insertBefore(sal, app.children[2]);
  const mp = document.createElement('div'); app.insertBefore(mp, app.children[1]);
  await Promise.all([myPendingCard(mp, () => viewPmHome(app)), pmNoteCard(note), salesHomeCard(sal),pmRequestsCard(rq), ownerNoticesCard(nb, () => viewPmHome(app)), ownerDocsCard(db2, () => viewPmHome(app)),
    casesCard(cs, { title: '⚠️ ' + t('Casos abiertos'), onlyOpen: true, showJob: true, after: () => viewPmHome(app) }), ownerScansCard(sc, () => viewPmHome(app))].map(p => p.catch(e => console.error(e))));
  const anchor = app.firstElementChild;
  const jobs = await api('GET', '/api/jobs');
  if (!anchor.isConnected) return; // ya cambió de pantalla
  const jb = document.createElement('div'); jb.className = 'card';
  jb.innerHTML = `<div class="row between"><h2>${t('Mis obras')}</h2><a class="btn sm" href="#/obras">${t('Ver todas')}</a></div>${jobs.length ? jobs.filter(j => !['terminado', 'cancelado'].includes(j.status)).map(j => `<a class="pmjob" href="#/obra/${j.id}"><div class="row between"><b>${esc(j.client_name)}</b><span class="badge b-${j.status}">${statusLabel(j.status)}</span></div>
    <div class="small muted">${[esc(typeLabel(j.project_type)), esc(j.address || '')].filter(Boolean).join(' · ')}</div>
    <div class="row"><div class="bar" style="flex:1"><span style="width:${j.progress.pct}%"></span></div><span class="small">${j.progress.pct}%</span></div></a>`).join('') : `<p class="empty">${t('Los dueños todavía no le asignan obras.')}</p>`}`;
  app.appendChild(jb);
}
async function pmRequestsCard(box) {
  const r = await api('GET', '/api/change-requests');
  if (!r.mine.length && !r.recent.length) { box.remove(); return; }
  const ST = { aprobado: ['b-hecho', t('Autorizado')], rechazado: ['b-urg', t('No autorizado')], cancelado: ['b-pendiente', t('Cancelado')], conflicto: ['b-urg', t('No se aplicó')] };
  box.className = 'card';
  box.innerHTML = `<h2>🔒 ${t('Mis solicitudes a los dueños')}</h2>
    ${r.mine.map(c => `<div class="creq mine" data-id="${c.id}"><span class="small">⏳ ${esc(c.summary)}</span><button class="sm" data-cancel>${t('Cancelar')}</button></div>`).join('')}
    ${r.recent.slice(0, 6).map(c => `<div class="creq mine"><span class="small"><span class="badge ${(ST[c.status] || [])[0]}">${(ST[c.status] || [])[1] || c.status}</span> ${esc(c.summary)}${c.decision_note ? ` · “${esc(c.decision_note)}”` : ''}</span></div>`).join('')}`;
  $$('[data-cancel]', box).forEach(b => { b.onclick = async () => { await act(() => api('POST', `/api/change-requests/${b.closest('[data-id]').dataset.id}/cancel`), t('Solicitud cancelada')); pmRequestsCard(box); }; });
}
// Dueños: vigilancia de project managers.
async function pmActivityCard(box) {
  const list = await api('GET', '/api/pm-activity');
  if (!list.length) { box.remove(); return; }
  const FL = f => f.kind === 'near_limit' ? t('{n} gastos justo debajo de su límite (posible gasto partido)', { n: f.n }) : f.kind === 'self' ? t('{n} gasto(s) a su propio nombre', { n: f.n })
    : f.kind === 'month' ? t('Ya usó más del 80% de su límite del mes ({m})', { m: fmt(f.v) }) : f.kind === 'rejected' ? t('{n} solicitudes no autorizadas este mes', { n: f.n }) : f.kind;
  box.className = 'card' + (list.some(p => p.flags.length) ? ' notices' : '');
  box.innerHTML = `<h2>👷‍♂️ ${t('Project managers (últimos 30 días)')}</h2>${list.map(p => `<div class="pmrow"><div class="row between"><b>${esc(p.name)}${p.active ? '' : ' (' + t('sin acceso') + ')'}</b>
      <span class="small">${t('Gastos: {n} por {m}', { n: p.expenses_30d.n, m: fmt(p.expenses_30d.total_cents) })} · ${t('Aprobó {n} docs por {m}', { n: p.docs_approved_30d.n, m: fmt(p.docs_approved_30d.v) })} · ${t('Este mes: {a} de {b}', { a: fmt(p.month_spent_cents), b: fmt(p.month_cap_cents) })}</span></div>
      <div class="small muted">${t('Obras')}: ${p.jobs.map(j => esc(j.client_name)).join(', ') || '—'}</div>
      ${p.flags.map(f => `<div class="small neg">🚩 ${FL(f)}</div>`).join('')}</div>`).join('')}`;
}

// app2.js (pantallas de la v2) se carga después de este archivo: arrancar cuando ya estén las dos.
window.addEventListener('DOMContentLoaded', () => boot().catch(e => { $('#app').innerHTML = `<div class="card error pad">${esc(e.message)}</div>`; }));
