'use strict';
// Propuesta para el cliente: verla, bajar el PDF, firmar y ver sus invoices. Sin cuenta: el enlace es la llave.
const qs = new URLSearchParams(location.search);
const TOKEN = qs.get('t') || '', CO = qs.get('co') || '';
let lang = ['es', 'en'].includes(qs.get('lang')) ? qs.get('lang') : ((navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en');
const S = {
  es: { title: 'Propuesta para', scope: 'Alcance del trabajo', schedule: 'Calendario de pagos', total: 'Total', terms: 'Condiciones', valid: 'Válida hasta', pdf: 'Bajar PDF',
    sign: 'Firmar y aceptar', name: 'Su nombre completo', draw: 'Firme aquí con el dedo o el mouse', clear: 'Borrar firma', agree: 'Acepto esta propuesta y firmo electrónicamente. Entiendo que mi firma electrónica vale igual que una firma en papel.',
    send: 'Firmar propuesta', sending: 'Firmando…', signed: 'Propuesta firmada por {n} el {d}.', code: 'Código de verificación', thanks: '¡Gracias! Recibimos su firma. Le contactaremos para programar el inicio.',
    expired: 'Esta propuesta ya venció. Contáctenos para una nueva.', invoices: 'Sus invoices', balance: 'Saldo del proyecto', due: 'vence', st: { facturado: 'Por pagar', vencido: 'Vencido', pagado: 'Pagado', por_cobrar: 'Por pagar', pendiente: '' },
    payInfo: 'Cómo pagar', handover: 'Entrega de su proyecto', handoverLead: 'Terminamos su proyecto. Revise que todo esté como lo acordamos y firme la entrega.', handoverAgree: 'Recibí la obra terminada a mi satisfacción y firmo electrónicamente.', handoverSend: 'Firmar entrega', handoverDone: 'Entrega firmada por {n} el {d}. ¡Gracias!', review: '¿Nos ayuda con una reseña? Nos ayuda mucho a crecer.', reviewBtn: 'Dejar una reseña', punch: 'Lo que revisamos antes de entregar', e_name: 'Escriba su nombre completo', e_sig: 'Falta su firma', e_agree: 'Marque la casilla para aceptar', notFound: 'Este enlace no es válido. Pídanos uno nuevo.', call: 'Preguntas: {p}' },
  en: { title: 'Proposal for', scope: 'Scope of work', schedule: 'Payment schedule', total: 'Total', terms: 'Terms', valid: 'Valid until', pdf: 'Download PDF',
    sign: 'Sign and accept', name: 'Your full name', draw: 'Sign here with your finger or mouse', clear: 'Clear signature', agree: 'I accept this proposal and sign electronically. I understand my electronic signature is as valid as a signature on paper.',
    send: 'Sign proposal', sending: 'Signing…', signed: 'Proposal signed by {n} on {d}.', code: 'Verification code', thanks: 'Thank you! We received your signature. We will contact you to schedule the start.',
    expired: 'This proposal has expired. Contact us for a new one.', invoices: 'Your invoices', balance: 'Project balance', due: 'due', st: { facturado: 'Due', vencido: 'Overdue', pagado: 'Paid', por_cobrar: 'Due', pendiente: '' },
    payInfo: 'How to pay', handover: 'Project handover', handoverLead: 'We finished your project. Please check that everything is as agreed and sign the handover.', handoverAgree: 'I received the finished work to my satisfaction and sign electronically.', handoverSend: 'Sign handover', handoverDone: 'Handover signed by {n} on {d}. Thank you!', review: 'Would you leave us a review? It helps us grow.', reviewBtn: 'Leave a review', punch: 'What we checked before handover', e_name: 'Enter your full name', e_sig: 'Your signature is missing', e_agree: 'Check the box to accept', notFound: 'This link is not valid. Ask us for a new one.', call: 'Questions: {p}' },
};
const t = (k, v = {}) => String(S[lang][k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => '$' + (Math.round(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fdate = s => s ? new Date(String(s).slice(0, 10) + 'T12:00:00Z').toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
const api = (method, url, body) => fetch(url + (CO ? (url.includes('?') ? '&' : '?') + 'co=' + encodeURIComponent(CO) : ''), { method, headers: { 'x-lang': lang, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Error'); return j; });
const base = `/api/public/proposal/${encodeURIComponent(TOKEN)}`;
let D = null, done = false, K = null, kdone = false;

async function load() { try { D = await api('GET', base); K = await api('GET', `/api/public/closeout/${encodeURIComponent(TOKEN)}`).catch(() => null); } catch { document.getElementById('m').innerHTML = `<div class="card">${t('notFound')}</div>`; return; } paint(); }
function paint() {
  document.documentElement.lang = lang; document.getElementById('lang').textContent = lang === 'en' ? 'ES' : 'EN';
  document.title = `${D.company.name} · ${t('title')} ${D.client_name}`;
  if (!D.company.logo) document.getElementById('brand').innerHTML = `<b class="co">${esc(D.company.name)}</b>`;
  const co = CO ? '&co=' + encodeURIComponent(CO) : '';
  document.getElementById('m').innerHTML = `
    ${K && K.requested ? `<div id="kbox"></div>` : ''}
    <h1>${t('title')} ${esc(D.client_name)}</h1><p class="muted">${esc(D.address || '')}</p>
    ${D.description ? `<div class="card">${esc(D.description).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="card"><h2>${t('scope')}</h2>${D.lines.map(l => `<div class="row"><div><b>${esc(l.trade)}</b>${l.description ? `<div class="small muted">${esc(l.description).replace(/\n/g, '<br>')}</div>` : ''}</div><div class="amt">${money(l.sold_cents)}</div></div>`).join('')}
      <div class="total"><span>${t('total')}</span><span>${money(D.total_cents)}</span></div></div>
    ${D.schedule && D.schedule.length ? `<div class="card"><h2>${t('schedule')}</h2>${D.schedule.map(s => `<div class="row"><div><b>${esc(s.label)}</b> <span class="muted">(${s.pct}%)</span><div class="small muted">${esc(lang === 'en' ? s.when_en : s.when)}</div></div><div class="amt">${money(s.amount_cents)}</div></div>`).join('')}</div>` : ''}
    <div class="card small"><b>${t('terms')}:</b> ${esc(D.terms)}${D.valid_until ? `<p><b>${t('valid')}:</b> ${fdate(D.valid_until)}</p>` : ''}
      <p><a class="btn" href="${base}/pdf?lang=${lang}${co}" target="_blank" rel="noopener">⬇ ${t('pdf')}</a></p></div>
    ${D.invoices.length ? `<div class="card"><h2>${t('invoices')}</h2>${D.invoices.map(i => `<div class="row"><div><b>${esc(i.number)}</b> · ${esc(i.label)}<div class="small muted">${i.status !== 'pagado' && i.due_date ? t('due') + ' ' + fdate(i.due_date) : ''}</div></div>
        <div class="amt">${money(i.amount_cents)} <span class="badge b-${i.status}">${t('st')[i.status] || ''}</span> <a href="${base}/invoice/${i.id}?lang=${lang}${co}" target="_blank" rel="noopener">PDF</a></div></div>`).join('')}
      <div class="row"><b>${t('balance')}</b><b class="amt">${money(D.balance_cents)}</b></div>${D.pay_info ? `<p class="small"><b>${t('payInfo')}:</b> ${esc(D.pay_info)}</p>` : ''}</div>` : ''}
    <div id="signbox"></div>${D.company.phone ? `<p class="small muted">${t('call', { p: esc(D.company.phone) })}</p>` : ''}`;
  const box = document.getElementById('signbox');
  if (done) box.innerHTML = `<div class="ok">✅ ${t('thanks')}</div>`;
  else if (D.signed) box.innerHTML = `<div class="ok">✅ ${t('signed', { n: esc(D.signed.name), d: fdate(D.signed.at) })}<div class="small muted">${t('code')}: ${esc(D.signed.code)}</div></div>`;
  else if (D.expired) box.innerHTML = `<div class="card">${t('expired')}</div>`;
  else if (D.can_sign) signForm(box, { title: t('sign'), agree: t('agree'), send: t('send'), url: `${base}/sign`, after: () => { done = true; } });
  const kb = document.getElementById('kbox');
  if (kb) {
    const list = K.items.length ? `<p class="small muted">${t('punch')}:</p>${K.items.map(i => `<div class="row"><span>${i.done ? '✅' : '⬜'} ${esc(i.text)}</span></div>`).join('')}` : '';
    const rv = K.review_link ? `<p>${t('review')}</p><p><a class="btn" href="${esc(K.review_link)}" target="_blank" rel="noopener">⭐ ${t('reviewBtn')}</a></p>` : '';
    if (K.signed) kb.innerHTML = `<div class="card"><h2>🏁 ${t('handover')}</h2><div class="ok">✅ ${t('handoverDone', { n: esc(K.signed.name), d: fdate(K.signed.at) })}</div>${rv}</div>`;
    else { kb.innerHTML = `<div class="card"><h2>🏁 ${t('handover')}</h2><p>${t('handoverLead')}</p>${list}<div id="ksign"></div></div>`;
      if (K.can_sign) signForm(document.getElementById('ksign'), { title: '', agree: t('handoverAgree'), send: t('handoverSend'), url: `/api/public/closeout/${encodeURIComponent(TOKEN)}/sign`, after: () => { kdone = true; }, inline: true }); }
  }
  const inv = qs.get('inv'); if (inv) { const a = document.querySelector(`a[href*="/invoice/${CSS.escape(inv)}"]`); if (a) a.scrollIntoView({ block: 'center' }); }
}
function signForm(box, o) {
  box.innerHTML = `<div class="${o.inline ? '' : 'card'}">${o.title ? `<h2>✍️ ${o.title}</h2>` : ''}
    <label>${t('name')}</label><input type="text" data-nm autocomplete="name" maxlength="120">
    <label>${t('draw')}</label><canvas></canvas><button type="button" class="link small" data-clr>${t('clear')}</button>
    <label class="chk"><input type="checkbox" data-ag> <span>${o.agree}</span></label>
    <div class="err" data-er></div><button class="send" data-go>${o.send}</button></div>`;
  const q = s => box.querySelector(s);
  const c = q('canvas'), ctx = c.getContext('2d'); let drawing = false, inked = false;
  const size = () => { const r = c.getBoundingClientRect(); c.width = r.width * 2; c.height = r.height * 2; ctx.scale(2, 2); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; inked = false; };
  size();
  const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener('pointerdown', e => { drawing = true; c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
  c.addEventListener('pointermove', e => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); inked = true; });
  c.addEventListener('pointerup', () => { drawing = false; });
  q('[data-clr]').onclick = size;
  q('[data-go]').onclick = async () => {
    const er = q('[data-er]'), name = q('[data-nm]').value.trim();
    if (name.length < 3) return (er.textContent = t('e_name'));
    if (!inked) return (er.textContent = t('e_sig'));
    if (!q('[data-ag]').checked) return (er.textContent = t('e_agree'));
    const b = q('[data-go]'); b.disabled = true; b.textContent = t('sending'); er.textContent = '';
    try { await api('POST', o.url, { name, agree: true, signature: c.toDataURL('image/jpeg', 0.8) }); o.after(); await load(); }
    catch (e) { er.textContent = e.message; b.disabled = false; b.textContent = o.send; }
  };
}
document.getElementById('lang').onclick = () => { lang = lang === 'en' ? 'es' : 'en'; if (D) paint(); };
load();
