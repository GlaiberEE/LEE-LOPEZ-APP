'use strict';
// Fase 8 — Borradores de mensajes de texto: la app deja listos los textos de siempre; una persona los revisa y los manda.
//  - Al cliente: "mañana trabajamos en su casa en…", recordatorio de inspección de mañana, recordatorio de cobro (sin montos).
//  - Al sub: "mañana: tal tarea en tal obra" (sin horario: son contratistas) y "pasó la inspección, ya puede seguir".
//  - Salen en el idioma de quien los recibe. Nunca llevan dinero. No se manda nada solo: siempre lo manda una persona.
//  - Si no hay Twilio, se copian o se abren en Mensajes del teléfono y se marcan "Ya lo mandé".
const TZ = () => process.env.APP_TZ || 'America/Chicago';
const todayL = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(now);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DOW = { es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] };
const MON = { es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'], en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };
const fday = (iso, lang) => { const d = new Date(iso + 'T12:00:00Z'); return lang === 'en' ? `${DOW.en[d.getUTCDay()]}, ${MON.en[d.getUTCMonth()]} ${d.getUTCDate()}` : `${DOW.es[d.getUTCDay()]} ${d.getUTCDate()} de ${MON.es[d.getUTCMonth()]}`; };
const first = n => String(n || '').replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] || '';
const tl = (db, s, lang) => { try { return require('./history').inLang(db, s, lang); } catch { return s; } };
const isInsp = t => { try { return require('./inspections').isInspection(t); } catch { return /inspec/i.test(t.title || ''); } };

function put(db, d) {
  db.prepare(`INSERT INTO sms_drafts(ref,kind,phone,user_id,job_id,lang,body,for_date) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(ref) DO NOTHING`)
    .run(d.ref, d.kind, d.phone, d.user_id || null, d.job_id || null, d.lang, d.body, d.for_date || '');
}
const langOf = (db, uid, fallback) => (uid && (db.prepare('SELECT lang FROM users WHERE id=?').get(uid) || {}).lang) || fallback;

// Arma los borradores que faltan (no repite: cada uno tiene su "ref").
function generate(db, now = new Date()) {
  const { e164 } = require('./sms');
  const today = todayL(now), tom = addDays(today, 1);
  // Los de días pasados ya no sirven.
  db.prepare("UPDATE sms_drafts SET status='vencido' WHERE status='pendiente' AND for_date<>'' AND for_date<?").run(today);
  const jobs = db.prepare("SELECT * FROM jobs WHERE status='activo'").all();
  for (const j of jobs) {
    const tasks = db.prepare("SELECT * FROM tasks WHERE job_id=? AND status<>'hecho' AND planned_date<>'' AND planned_date<=? AND (CASE WHEN COALESCE(planned_end,'')<>'' THEN planned_end ELSE planned_date END)>=? ORDER BY position").all(j.id, tom, tom);
    const work = tasks.filter(t => !isInsp(t));
    // 1) Al cliente: mañana trabajamos en su casa.
    const cphone = e164(j.client_phone);
    if (cphone && work.length) {
      const L = langOf(db, j.client_user_id, 'en');
      const list = work.slice(0, 3).map(t => tl(db, t.title, L).toLowerCase()).join(', ');
      put(db, { ref: `manana:${j.id}:${tom}`, kind: 'manana_cliente', phone: cphone, user_id: j.client_user_id, job_id: j.id, lang: L, for_date: tom,
        body: L === 'en' ? `Hi ${first(j.client_name)}, tomorrow (${fday(tom, 'en')}) our crew will be at your home working on: ${list}. Let us know if you need anything.`
          : `Hola ${first(j.client_name)}, mañana (${fday(tom, 'es')}) nuestra cuadrilla va a estar en su casa trabajando en: ${list}. Cualquier cosa, nos avisa.` });
    }
    // 2) Al sub: lo suyo de mañana (sin horario).
    const bySub = new Map();
    for (const t of work) if (t.assignee_id) { if (!bySub.has(t.assignee_id)) bySub.set(t.assignee_id, []); bySub.get(t.assignee_id).push(t); }
    for (const [uid, ts] of bySub) {
      const u = db.prepare("SELECT * FROM users WHERE id=? AND active=1 AND role='worker'").get(uid); if (!u) continue;
      const ph = e164(u.phone); if (!ph) continue;
      const L = u.lang === 'en' ? 'en' : 'es';
      const list = ts.slice(0, 3).map(t => tl(db, t.title, L)).join(', ');
      put(db, { ref: `msub:${uid}:${j.id}:${tom}`, kind: 'manana_sub', phone: ph, user_id: uid, job_id: j.id, lang: L, for_date: tom,
        body: L === 'en' ? `Hi ${first(u.name)}, tomorrow (${fday(tom, 'en')}): ${list} at ${j.address || j.client_name}. Reply if you can't make it.`
          : `Hola ${first(u.name)}, mañana (${fday(tom, 'es')}): ${list} en ${j.address || j.client_name}. Si no puede, avísenos.` });
    }
    // 3) Al cliente: inspección de mañana.
    for (const p of db.prepare("SELECT * FROM permits WHERE job_id=? AND kind='inspeccion' AND date=? AND result_at=''").all(j.id, tom)) {
      if (!cphone) continue;
      const L = langOf(db, j.client_user_id, 'en');
      put(db, { ref: `insp:${p.id}:${tom}`, kind: 'insp_cliente', phone: cphone, user_id: j.client_user_id, job_id: j.id, lang: L, for_date: tom,
        body: L === 'en' ? `Hi ${first(j.client_name)}, reminder: the city inspection (${tl(db, p.name, 'en')}) is tomorrow, ${fday(tom, 'en')}. Please keep the gate unlocked and pets inside. Thank you!`
          : `Hola ${first(j.client_name)}, le recordamos que mañana (${fday(tom, 'es')}) viene la inspección de la ciudad (${tl(db, p.name, 'es')}). Por favor deje la puerta del patio abierta y las mascotas adentro. ¡Gracias!` });
    }
    // 4) Al sub que sigue: pasó la inspección hoy, ya puede seguir.
    for (const p of db.prepare("SELECT * FROM permits WHERE job_id=? AND kind='inspeccion' AND result_at=? AND status='aprobado'").all(j.id, today)) {
      const next = db.prepare("SELECT * FROM tasks WHERE job_id=? AND status<>'hecho' AND assignee_id IS NOT NULL ORDER BY position, id").all(j.id).filter(t => !isInsp(t)).slice(0, 2);
      for (const t of next) {
        const u = db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(t.assignee_id); if (!u) continue;
        const ph = e164(u.phone); if (!ph) continue;
        const L = u.lang === 'en' ? 'en' : 'es';
        put(db, { ref: `pass:${p.id}:${u.id}`, kind: 'insp_paso', phone: ph, user_id: u.id, job_id: j.id, lang: L, for_date: '',
          body: L === 'en' ? `Good news: the ${tl(db, p.name, 'en')} passed at ${j.address || j.client_name}. You can go ahead with: ${tl(db, t.title, 'en')}.`
            : `Buenas noticias: pasó la ${tl(db, p.name, 'es')} en ${j.address || j.client_name}. Ya puede seguir con: ${tl(db, t.title, 'es')}.` });
      }
    }
    // 5) Al cliente: recordatorio de cobro (sin montos: lo ve en su portal).
    if (cphone) {
      let ms = []; try { ms = require('./billing').billing(db, j.id).milestones; } catch { /* */ }
      for (const m of ms) {
        if (!m.invoice_number || !['facturado', 'vencido'].includes(m.status) || !m.due_date) continue;
        if (m.status === 'facturado' && m.due_date > addDays(today, 2)) continue;
        const L = langOf(db, j.client_user_id, 'en');
        put(db, { ref: `cobro:${m.id}:${m.status}`, kind: 'cobro', phone: cphone, user_id: j.client_user_id, job_id: j.id, lang: L, for_date: '',
          body: m.status === 'vencido'
            ? (L === 'en' ? `Hi ${first(j.client_name)}, a friendly reminder that invoice ${m.invoice_number} was due on ${fday(m.due_date, 'en')}. You can see it in your portal. Thank you!`
              : `Hola ${first(j.client_name)}, le recordamos que el invoice ${m.invoice_number} venció el ${fday(m.due_date, 'es')}. Lo puede ver en su portal. ¡Gracias!`)
            : (L === 'en' ? `Hi ${first(j.client_name)}, a friendly reminder that invoice ${m.invoice_number} is due on ${fday(m.due_date, 'en')}. You can see it in your portal. Thank you!`
              : `Hola ${first(j.client_name)}, le recordamos que el invoice ${m.invoice_number} vence el ${fday(m.due_date, 'es')}. Lo puede ver en su portal. ¡Gracias!`) });
      }
    }
  }
  return db.prepare("SELECT COUNT(*) n FROM sms_drafts WHERE status='pendiente'").get().n;
}

module.exports = { generate };
