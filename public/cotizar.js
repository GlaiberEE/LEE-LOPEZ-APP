'use strict';
// Formulario público de cotización: crea un prospecto en la app. Bilingüe.
const EN = {
  title: 'Get your free quote', lead: 'Patio covers, outdoor kitchens, fireplaces and more in the Dallas–Fort Worth area. We\'ll contact you within 24 hours.',
  name: 'Name *', phone: 'Phone', email: 'Email', address: 'Project address', type: 'What are you interested in?',
  t_patio: 'Patio cover / pergola', t_living: 'Complete outdoor living space', t_kitchen: 'Outdoor kitchen', t_fireplace: 'Fireplace', t_pit: 'Fire pit', t_tv: 'TV wall', t_other: 'Other',
  budget: 'Approximate budget', b_none: 'Prefer not to say', when: 'When?', w_none: 'Not sure yet', w_soon: '1–3 months', w_mid: '3–6 months', w_late: '6+ months',
  msg: 'Tell us about your project', send: 'Request a quote', privacy: 'We only use your information to contact you about your project.',
  thanks: 'Thank you!', thanks2: 'We received your request. We\'ll contact you soon.',
  e_name: 'Please enter your name', e_contact: 'Leave a phone or email so we can contact you', e_net: 'Could not send. Check your connection or call us.',
};
const ES = {};
// Empresa: cotizar.html?co=jkl manda el prospecto a JKL Homes (cada empresa tiene su propia información).
const CO = new URLSearchParams(location.search).get('co') || '';
if (CO) fetch('/api/status?co=' + encodeURIComponent(CO)).then(r => r.json()).then(st => {
  if (st.company && !st.company.logo) { const img = document.querySelector('header img'); const b = document.createElement('b'); b.textContent = st.company.name; b.style.cssText = 'color:#fff;font-size:1.3rem'; img.replaceWith(b); }
}).catch(() => {});
document.querySelectorAll('[data-t]').forEach(el => { ES[el.dataset.t] = el.textContent; });
Object.assign(ES, { e_name: 'Escriba su nombre', e_contact: 'Déjenos un teléfono o un email para contactarle', e_net: 'No se pudo enviar. Revise su conexión o llámenos.' });
const qs = new URLSearchParams(location.search);
let lang = ['es', 'en'].includes(qs.get('lang')) ? qs.get('lang') : ((navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en');
const T = k => (lang === 'en' ? EN : ES)[k] || k;
function paint() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = T(el.dataset.t); });
  document.getElementById('lang').textContent = lang === 'en' ? 'ES' : 'EN';
}
document.getElementById('lang').onclick = () => { lang = lang === 'en' ? 'es' : 'en'; paint(); };
paint();
document.getElementById('f').onsubmit = async e => {
  e.preventDefault();
  const f = e.target, err = document.getElementById('err'), btn = f.querySelector('button.send');
  const data = Object.fromEntries(new FormData(f).entries());
  err.textContent = '';
  if (!data.name.trim()) { err.textContent = T('e_name'); return; }
  if (!data.phone.trim() && !data.email.trim()) { err.textContent = T('e_contact'); return; }
  btn.disabled = true;
  try {
    const r = await fetch('/api/public/lead' + (CO ? '?co=' + encodeURIComponent(CO) : ''), { method: 'POST', headers: { 'content-type': 'application/json', 'x-lang': lang }, body: JSON.stringify(data) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || T('e_net'));
    f.hidden = true; document.getElementById('ok').hidden = false;
  } catch (x) { err.textContent = x.message || T('e_net'); btn.disabled = false; }
};
