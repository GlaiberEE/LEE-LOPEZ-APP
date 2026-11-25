'use strict';
// Encuesta pública al cliente (solo al terminar la obra). Bilingüe. Se contesta una vez.
const qs = new URLSearchParams(location.search);
const TOKEN = qs.get('t') || '', CO = qs.get('co') || '';
const api = (m, body) => fetch(`/api/public/survey/${encodeURIComponent(TOKEN)}${CO ? '?co=' + encodeURIComponent(CO) : ''}`,
  { method: m, headers: { 'content-type': 'application/json', 'x-lang': lang }, body: body ? JSON.stringify(body) : undefined }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Error'); return d; });
const TX = {
  en: { h: 'How did your project go?', lead: 'Hi {n}! Thank you for trusting {co}. It takes 2 minutes and your honest answer helps us do better.',
    q_clean: 'Cleanliness', q_clean_s: 'How clean the work area and your home were left', q_time: 'Punctuality', q_time_s: 'Arriving when we said and keeping to the schedule',
    q_comm: 'Communication', q_comm_s: 'Keeping you informed and answering your questions', q_quality: 'Quality of the work', q_quality_s: 'How the finished project turned out',
    q_crew: 'The crew', q_crew_s: 'Courtesy and respect of the people who worked at your home',
    nps: 'How likely are you to recommend us to a friend or neighbor?', n0: 'Not likely', n10: 'Very likely',
    improve: 'What could we do better?', improve_p: 'Please be honest: this is how we improve.', liked: 'What did you like the most? (optional)',
    priv: '🔒 Your comments are read only by the owners of the company.', send: 'Send', need: 'Please answer the 5 star questions.',
    thanks: 'Thank you!', thanks2: 'We received your answers. They help us improve.', low: 'We are sorry something did not go well. One of the owners will contact you.',
    google: 'Would you help us with a Google review?', gbtn: 'Leave a Google review', done: 'This survey was already answered. Thank you!', bad: 'This link is not valid.' },
  es: { h: '¿Cómo le fue con su proyecto?', lead: '¡Hola {n}! Gracias por confiar en {co}. Son 2 minutos y su respuesta sincera nos ayuda a mejorar.',
    q_clean: 'Limpieza', q_clean_s: 'Cómo quedó de limpia el área de trabajo y su casa', q_time: 'Puntualidad', q_time_s: 'Llegar cuando dijimos y cumplir las fechas',
    q_comm: 'Comunicación', q_comm_s: 'Tenerle informado y contestar sus preguntas', q_quality: 'Calidad del trabajo', q_quality_s: 'Cómo quedó el proyecto terminado',
    q_crew: 'La cuadrilla', q_crew_s: 'Amabilidad y respeto de quienes trabajaron en su casa',
    nps: '¿Qué tan probable es que nos recomiende con un amigo o vecino?', n0: 'Nada probable', n10: 'Muy probable',
    improve: '¿Qué podemos mejorar?', improve_p: 'Sea sincero, por favor: así mejoramos.', liked: '¿Qué fue lo que más le gustó? (opcional)',
    priv: '🔒 Sus comentarios los leen solo los dueños de la compañía.', send: 'Enviar', need: 'Conteste las 5 preguntas con estrellas, por favor.',
    thanks: '¡Gracias!', thanks2: 'Recibimos sus respuestas. Nos ayudan a mejorar.', low: 'Sentimos que algo no salió bien. Uno de los dueños se va a comunicar con usted.',
    google: '¿Nos ayudaría con una reseña en Google?', gbtn: 'Dejar reseña en Google', done: 'Esta encuesta ya se contestó. ¡Gracias!', bad: 'Este enlace no es válido.' },
};
const QS = ['q_clean', 'q_time', 'q_comm', 'q_quality', 'q_crew'];
let lang = ['es', 'en'].includes(qs.get('lang')) ? qs.get('lang') : 'en', info = {}, ans = {}, finished = null;
const T = (k, v = {}) => String(TX[lang][k] || k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);

function paint() {
  document.documentElement.lang = lang;
  $('#lang').textContent = lang === 'en' ? 'ES' : 'EN';
  $('#h').textContent = T('h');
  $('#lead').textContent = info.company ? T('lead', { n: info.client, co: info.company }) : '';
  if (finished) return showDone();
  const f = $('#f'), keep = { improve: f.improve ? f.improve.value : '', liked: f.liked ? f.liked.value : '' };
  f.innerHTML = QS.map(k => `<div class="q"><div>${esc(T(k))}<small>${esc(T(k + '_s'))}</small></div>
      <div class="stars" role="radiogroup" aria-label="${esc(T(k))}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-q="${k}" data-v="${n}" aria-label="${n}" class="${ans[k] >= n ? 'on' : ''}">★</button>`).join('')}</div></div>`).join('')
    + `<div class="q"><div>${esc(T('nps'))}</div><div class="nps">${[...Array(11).keys()].map(n => `<button type="button" data-q="nps" data-v="${n}" class="${ans.nps === n ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="ends"><span>${esc(T('n0'))}</span><span>${esc(T('n10'))}</span></div></div>
    <div class="q"><div>${esc(T('improve'))}</div><textarea name="improve" maxlength="3000" placeholder="${esc(T('improve_p'))}">${esc(keep.improve)}</textarea></div>
    <div class="q"><div>${esc(T('liked'))}</div><textarea name="liked" maxlength="3000">${esc(keep.liked)}</textarea></div>
    <div class="priv">${esc(T('priv'))}</div><div class="err" id="err"></div><button class="send" type="submit">${esc(T('send'))}</button>`;
  f.querySelectorAll('[data-q]').forEach(b => { b.onclick = () => { ans[b.dataset.q] = Number(b.dataset.v); paint(); }; });
}
function showDone() {
  $('#f').hidden = true; const ok = $('#ok'); ok.hidden = false;
  if (finished === 'already') { ok.innerHTML = `<h2>${esc(T('done'))}</h2>${info.review_link ? `<p>${esc(T('google'))}</p><a class="google" href="${esc(info.review_link)}" target="_blank" rel="noopener">${esc(T('gbtn'))}</a>` : ''}`; return; }
  ok.innerHTML = `<h2>${esc(T('thanks'))}</h2><p>${esc(finished.low ? T('low') : T('thanks2'))}</p>
    ${finished.review_link ? `<p><b>${esc(T('google'))}</b></p><a class="google" href="${esc(finished.review_link)}" target="_blank" rel="noopener">⭐ ${esc(T('gbtn'))}</a>` : ''}`;
}
$('#lang').onclick = () => { lang = lang === 'en' ? 'es' : 'en'; paint(); };
$('#f').onsubmit = async e => {
  e.preventDefault();
  if (QS.some(k => !ans[k])) { $('#err').textContent = T('need'); return; }
  const btn = e.target.querySelector('.send'); btn.disabled = true;
  try { finished = await api('POST', { ...ans, improve: e.target.improve.value, liked: e.target.liked.value, lang }); paint(); window.scrollTo(0, 0); }
  catch (err) { $('#err').textContent = err.message; btn.disabled = false; }
};
api('GET').then(d => {
  info = d; if (!qs.get('lang')) lang = d.lang === 'es' ? 'es' : 'en';
  if (d.answered) finished = 'already'; else $('#f').hidden = false;
  paint();
}).catch(() => { $('#h').textContent = T('bad'); });
