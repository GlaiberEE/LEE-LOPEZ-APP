'use strict';
const SP = require('./subpay');
// Estimados e invoices que mandan los subs.
//   Estimado aceptado  -> se suma a lo acordado con el sub (compromiso, todavía no es gasto).
//   Invoice aprobado   -> se registra como GASTO de la obra (la ganancia se recalcula sola).
//   Invoice pagado     -> solo se marca pagado (no crea otro gasto, así no se cuenta doble).
//   Change order del sub -> trabajo adicional sobre un estimado aceptado; al aceptarlo se suma a lo acordado
//     y aparece en el PDF del estimado.
// Correcciones (regla: lo aceptado NO se cambia sin autorización de un dueño):
//   - Mientras no se ha revisado, el sub lo puede corregir. Si fue rechazado, lo corrige y lo reenvía.
//   - Ya aceptado/aprobado: el sub NO puede cambiarlo. Solo puede PEDIR PERMISO (con motivo). Si un dueño
//     autoriza, el sub puede corregirlo una vez; esa corrección vuelve al dueño para revisión final y la
//     contabilidad no cambia hasta que la apruebe. Si la rechaza, vuelve la versión aprobada.
//   - El dueño corrige: se aplica de inmediato y el gasto / lo acordado se ajustan por la diferencia.
//   - Un invoice ya pagado no se cambia (se manda uno nuevo por la diferencia).
//   - Todo queda en el historial.
const { tx } = require('./db');
const { DUAL_APPROVAL_CENTS } = require('./catalog');
//   - Cambios de más de $1,000 (antes o después): hacen falta LOS DOS dueños (permiso, aprobación de la
//     corrección y corrección directa de un dueño). Un "no" de cualquiera basta para detenerlo.

const EDITABLE = ['number', 'date', 'due_date', 'description', 'lines', 'total_cents', 'notes'];

module.exports = function subdocRoutes(db, add, H) {
  const { requireRole, fail, str, date, needDate, oneOf, intId, jobOr404, canSeeJob, cents, today, saveImage, removeFileRows } = H;

  // Renglones: [{ desc, qty, unit_cents }] -> total calculado aquí (no se confía en el total que manda el teléfono).
  function cleanLines(raw) {
    if (!Array.isArray(raw) || !raw.length) fail(400, 'Agregue al menos un renglón');
    if (raw.length > 60) fail(400, 'Demasiados renglones');
    let total = 0;
    const lines = raw.map((l, i) => {
      const desc = str(l && l.desc, 300); if (!desc) fail(400, `Falta: descripción del renglón ${i + 1}`);
      const qty = Number(l.qty ?? 1);
      if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6 || Math.round(qty * 100) !== qty * 100) fail(400, `Cantidad inválida en el renglón ${i + 1}`);
      const unit = cents(l.unit_cents, `precio del renglón ${i + 1}`);
      const amount = Math.round(qty * unit);
      total += amount;
      return { desc, qty, unit_cents: unit, amount_cents: amount };
    });
    if (total <= 0) fail(400, 'El total debe ser mayor que cero');
    return { lines, total };
  }

  const parseIds = x => { try { return JSON.parse(x || '[]'); } catch { return []; } };
  // v2.31: cuenta también al dueño desactivado. Si el otro dueño está desactivado, el cambio grande espera (no se salta la regla).
  const activeOwners = () => db.prepare("SELECT COUNT(*) n FROM users WHERE role='owner' AND is_agent=0").get().n;
  // ¿Cuántos dueños deben aprobar un cambio a este documento?
  const needed = (d, newTotal = d.total_cents) => {
    const prevTotal = d.prev ? (JSON.parse(d.prev).total_cents || 0) : d.total_cents;
    return Math.max(prevTotal, newTotal, d.total_cents) > DUAL_APPROVAL_CENTS ? Math.min(2, activeOwners()) : 1;
  };
  const names = ids => ids.length ? db.prepare(`SELECT name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(r => r.name) : [];
  const history = (docId, userId, action, before, after, note = '') =>
    db.prepare('INSERT INTO doc_history(doc_id,user_id,action,total_before,total_after,note) VALUES(?,?,?,?,?,?)').run(docId, userId, action, before ?? null, after ?? null, str(note, 600));
  const get = id => db.prepare('SELECT * FROM sub_docs WHERE id=?').get(id);

  const out = d => {
    const j = db.prepare('SELECT client_name, address FROM jobs WHERE id=?').get(d.job_id) || {};
    const u = db.prepare('SELECT name, phone, lang, trade FROM users WHERE id=?').get(d.sub_user_id) || {};
    const file = db.prepare('SELECT id, mime FROM files WHERE doc_id=? ORDER BY created_at DESC LIMIT 1').get(d.id);
    const parse = (x, dflt) => { try { return JSON.parse(x); } catch { return dflt; } };
    const prev = d.prev ? parse(d.prev, null) : null;
    const r = { ...d, lines: parse(d.lines, []), prev: prev ? { ...prev, lines: parse(prev.lines, []) } : null,
      client_name: j.client_name, address: j.address, sub_name: u.name, sub_phone: u.phone, sub_lang: u.lang || 'es',
      file_id: file ? file.id : null, file_mime: file ? file.mime : null,
      unlock_ok: parseIds(d.unlock_ok), corr_ok: parseIds(d.corr_ok), unlock_ok_names: names(parseIds(d.unlock_ok)), corr_ok_names: names(parseIds(d.corr_ok)),
      approvals_needed: needed(d), dual_limit_cents: DUAL_APPROVAL_CENTS,
      paid_cents: d.type === 'invoice' ? SP.invoicePaid(db, d.id) : 0,
      payments: d.type === 'invoice' ? db.prepare('SELECT id, date, amount_cents, method, reference, note FROM sub_payments WHERE doc_id=? ORDER BY date, id').all(d.id) : [],
      history: db.prepare('SELECT h.at, h.action, h.total_before, h.total_after, h.note, u.name user_name FROM doc_history h LEFT JOIN users u ON u.id=h.user_id WHERE doc_id=? ORDER BY h.id').all(d.id) };
    if (d.type === 'estimate') {
      r.invoiced_cents = db.prepare("SELECT COALESCE(SUM(total_cents),0) v FROM sub_docs WHERE from_estimate_id=? AND type='invoice' AND status<>'rechazado'").get(d.id).v;
      r.change_orders = db.prepare("SELECT id, number, date, description, total_cents, status, prev FROM sub_docs WHERE from_estimate_id=? AND type='change_order' AND status<>'rechazado' ORDER BY id").all(d.id)
        .map(c => ({ ...c, prev: undefined, pending: c.status === 'enviado' }));
      r.with_cos_cents = d.total_cents + r.change_orders.filter(c => c.status === 'aceptado').reduce((s, c) => s + c.total_cents, 0);
    }
    if (d.from_estimate_id) { const e = db.prepare('SELECT number, total_cents FROM sub_docs WHERE id=?').get(d.from_estimate_id); r.estimate = e || null; }
    return r;
  };
  const docOr404 = (user, id) => {
    const d = get(intId(id));
    if (!d || !canSeeJob(db, user, d.job_id) || (user.role === 'worker' && d.sub_user_id !== user.id)) fail(404, 'Documento no encontrado');
    return d;
  };
  const nextNumber = (userId, type) => {
    const n = db.prepare('SELECT COUNT(*) n FROM sub_docs WHERE sub_user_id=? AND type=?').get(userId, type).n + 1;
    return `${{ estimate: 'EST', invoice: 'INV', change_order: 'CO' }[type]}-${String(n).padStart(4, '0')}`;
  };
  // Lee los campos que se pueden corregir.
  function fieldsFrom(body, d) {
    const { lines, total } = cleanLines(body.lines);
    return { number: str(body.number, 40) || d.number, date: needDate(body.date || d.date, 'fecha'),
      due_date: d.type === 'invoice' ? date(body.due_date, 'fecha de pago') : '', description: str(body.description, 1000) || lines[0].desc,
      lines: JSON.stringify(lines), total_cents: total, notes: str(body.notes, 1500) };
  }
  const writeFields = (id, f) => db.prepare(`UPDATE sub_docs SET ${EDITABLE.map(k => k + '=?').join(',')} WHERE id=?`).run(...EDITABLE.map(k => f[k]), id);
  const snapshot = d => JSON.stringify({ status: d.status, ...Object.fromEntries(EDITABLE.map(k => [k, d[k]])) });

  // Ajusta lo acordado y el gasto cuando cambia el total de un documento ya aceptado/aprobado.
  function applyDifference(d, newTotal, newNumber, newDesc) {
    const diff = newTotal - d.total_cents;
    if (diff && d.added_to_agreed && d.sub_id) db.prepare('UPDATE subs SET agreed_cents = agreed_cents + ? WHERE id=?').run(diff, d.sub_id);
    if (d.type === 'invoice' && d.expense_id) {
      db.prepare('UPDATE expenses SET amount_cents=?, description=? WHERE id=?').run(newTotal, `Invoice ${newNumber} — ${newDesc}`.slice(0, 300), d.expense_id);
    }
  }

  // ===== lista =====
  add('GET', '/api/docs', ({ user, query }) => {
    requireRole(user, 'owner', 'worker');
    const job = query.get('job') ? intId(query.get('job')) : null;
    if (job) jobOr404(db, user, job);
    const where = [], args = [];
    if (user.role === 'worker') { where.push('sub_user_id=?'); args.push(user.id); }
    if (job) { where.push('job_id=?'); args.push(job); }
    const rows = db.prepare(`SELECT * FROM sub_docs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE status WHEN 'enviado' THEN 0 ELSE 1 END, date DESC, id DESC LIMIT 300`).all(...args);
    return rows.map(out);
  });

  // ===== el sub manda un estimado o invoice =====
  add('POST', '/api/docs', ({ user, body }) => {
    requireRole(user, 'worker');
    const jobId = intId(body.job_id);
    const job = jobOr404(db, user, jobId);
    if (job.status === 'cancelado') fail(400, 'La obra está cancelada');
    const type = oneOf(body.type, ['estimate', 'invoice', 'change_order'], 'tipo');
    let fromEst = null;
    if (body.from_estimate_id) {
      const e = docOr404(user, body.from_estimate_id);
      if (!['invoice', 'change_order'].includes(type) || e.type !== 'estimate' || e.status !== 'aceptado' || e.job_id !== jobId) fail(400, 'Solo un estimado aceptado de esta obra se puede convertir en invoice');
      fromEst = e.id;
    }
    if (type === 'change_order' && !fromEst) fail(400, 'Un change order debe ser de un estimado aceptado');
    const f = fieldsFrom(body, { type, number: str(body.number, 40) || nextNumber(user.id, type), date: today() });
    return tx(db, () => {
      const id = Number(db.prepare(`INSERT INTO sub_docs(job_id,sub_user_id,type,${EDITABLE.join(',')},from_estimate_id) VALUES(?,?,?,${EDITABLE.map(() => '?').join(',')},?)`)
        .run(jobId, user.id, type, ...EDITABLE.map(k => f[k]), fromEst).lastInsertRowid);
      history(id, user.id, 'enviado', null, f.total_cents);
      if (body.file) saveImage(db, user, { dataUrl: body.file, jobId, docId: id, kind: 'receipt', allowPdf: true });
      return out(get(id));
    });
  });

  // ===== permiso para corregir algo ya aceptado/aprobado =====
  add('POST', '/api/docs/:id/unlock', ({ user, params, body }) => {
    requireRole(user, 'worker');
    const d = docOr404(user, params.id);
    if (!['aceptado', 'aprobado'].includes(d.status)) fail(400, 'Solo se pide permiso para algo ya aceptado o aprobado');
    if (d.paid_at || (d.type === 'invoice' && SP.invoicePaid(db, d.id) > 0)) fail(400, 'Este invoice ya tiene pagos: para una diferencia, mande un invoice nuevo');
    if (d.unlock === 'pedido') fail(400, 'Ya pidió permiso: espere la respuesta del dueño');
    const reason = str(body.reason, 600); if (!reason) fail(400, 'Falta: motivo');
    db.prepare("UPDATE sub_docs SET unlock='pedido', unlock_reason=?, unlock_note='', unlock_ok='[]' WHERE id=?").run(reason, d.id);
    history(d.id, user.id, 'permiso_pedido', null, null, reason);
    return out(get(d.id));
  });
  add('POST', '/api/docs/:id/unlock-decide', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const d = docOr404(user, params.id);
    if (d.unlock !== 'pedido') fail(400, 'No hay una solicitud de permiso pendiente');
    const ok = oneOf(body.action, ['authorize', 'deny'], 'decisión') === 'authorize';
    const note = str(body.note, 600);
    if (!ok) {
      db.prepare("UPDATE sub_docs SET unlock='negado', unlock_note=?, unlock_ok='[]' WHERE id=?").run(note, d.id);
      history(d.id, user.id, 'permiso_negado', null, null, note);
      return out(get(d.id));
    }
    const got = parseIds(d.unlock_ok);
    if (got.includes(user.id)) fail(400, 'Usted ya autorizó: falta el otro dueño');
    got.push(user.id);
    const done = got.length >= needed(d);
    db.prepare('UPDATE sub_docs SET unlock=?, unlock_ok=?, unlock_note=? WHERE id=?').run(done ? 'autorizado' : 'pedido', JSON.stringify(done ? [] : got), note || d.unlock_note, d.id);
    history(d.id, user.id, done ? 'permiso_autorizado' : 'permiso_autorizado_1', null, null, note);
    return out(get(d.id));
  });

  // ===== corregir =====
  add('PUT', '/api/docs/:id', ({ user, params, body }) => {
    requireRole(user, 'owner', 'worker');
    const d = docOr404(user, params.id);
    if (d.paid_at || (d.type === 'invoice' && SP.invoicePaid(db, d.id) > 0)) fail(400, 'Este invoice ya tiene pagos: para una diferencia, mande un invoice nuevo');
    if (user.role === 'worker' && ['aceptado', 'aprobado'].includes(d.status) && d.unlock !== 'autorizado') {
      fail(403, 'Ya fue aceptado: para cambiarlo necesita la autorización de un dueño');
    }
    const f = fieldsFrom(body, d);
    const reason = str(body.reason, 600);
    return tx(db, () => {
      if (user.role === 'owner' && ['aceptado', 'aprobado'].includes(d.status) && needed(d, f.total_cents) > 1) {
        // Más de $1,000: la corrección del dueño queda esperando la aprobación del otro dueño.
        db.prepare('UPDATE sub_docs SET prev=? WHERE id=?').run(snapshot(d), d.id);
        writeFields(d.id, f);
        db.prepare("UPDATE sub_docs SET status='enviado', corr_ok=? WHERE id=?").run(JSON.stringify([user.id]), d.id);
        history(d.id, user.id, 'corregido_dueno_pendiente', d.total_cents, f.total_cents, reason);
      } else if (user.role === 'owner' && d.prev) {
        // Corrige una corrección pendiente: las aprobaciones empiezan de nuevo (cuenta la suya).
        writeFields(d.id, f);
        db.prepare('UPDATE sub_docs SET corr_ok=? WHERE id=?').run(JSON.stringify([user.id]), d.id);
        history(d.id, user.id, 'corregido_dueno_pendiente', d.total_cents, f.total_cents, reason);
      } else if (user.role === 'owner') {
        // El dueño corrige: se aplica ya y se ajusta la contabilidad si ya estaba aceptado/aprobado.
        if (['aceptado', 'aprobado'].includes(d.status)) applyDifference(d, f.total_cents, f.number, f.description);
        writeFields(d.id, f);
        history(d.id, user.id, 'corregido_dueno', d.total_cents, f.total_cents, reason);
      } else if (d.status === 'enviado') {
        writeFields(d.id, f);
        history(d.id, user.id, 'corregido', d.total_cents, f.total_cents, reason);
      } else if (d.status === 'rechazado') {
        // Si era una corrección rechazada, ya se restauró antes; aquí es un documento rechazado que se reenvía.
        writeFields(d.id, f);
        db.prepare("UPDATE sub_docs SET status='enviado', decided_at='', decided_by=NULL WHERE id=?").run(d.id);
        history(d.id, user.id, 'reenviado', d.total_cents, f.total_cents, reason);
      } else {
        // Ya aceptado/aprobado: queda como corrección por revisar; la contabilidad no cambia todavía.
        // Solo llega aquí con permiso autorizado; el permiso se usa una sola vez.
        if (!d.prev) db.prepare('UPDATE sub_docs SET prev=? WHERE id=?').run(snapshot(d), d.id);
        writeFields(d.id, f);
        db.prepare("UPDATE sub_docs SET status='enviado', revision=revision+1, unlock='', corr_ok='[]' WHERE id=?").run(d.id);
        history(d.id, user.id, 'correccion_pedida', d.total_cents, f.total_cents, reason);
      }
      if (body.file) saveImage(db, user, { dataUrl: body.file, jobId: d.job_id, docId: d.id, kind: 'receipt', allowPdf: true });
      return out(get(d.id));
    });
  });

  add('DELETE', '/api/docs/:id', ({ user, params }) => {
    requireRole(user, 'worker');
    const d = docOr404(user, params.id);
    if (d.status !== 'enviado' || d.prev) fail(400, 'Ya fue revisado: no se puede retirar');
    const files = db.prepare('SELECT id, mime FROM files WHERE doc_id=?').all(d.id);
    db.prepare('DELETE FROM files WHERE doc_id=?').run(d.id);
    db.prepare('DELETE FROM sub_docs WHERE id=?').run(d.id);
    removeFileRows(db, files);
    return { ok: true };
  });

  // ===== el dueño decide =====
  function agreementFor(d) {
    let s = db.prepare('SELECT * FROM subs WHERE job_id=? AND user_id=? ORDER BY id LIMIT 1').get(d.job_id, d.sub_user_id);
    if (!s) {
      const u = db.prepare('SELECT name, trade FROM users WHERE id=?').get(d.sub_user_id);
      const id = Number(db.prepare('INSERT INTO subs(job_id,name,trade,agreed_cents,user_id) VALUES(?,?,?,0,?)').run(d.job_id, u.name, u.trade || '', d.sub_user_id).lastInsertRowid);
      s = db.prepare('SELECT * FROM subs WHERE id=?').get(id);
    }
    return s;
  }

  add('POST', '/api/docs/:id/decide', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const d = docOr404(user, params.id);
    if (d.status !== 'enviado') fail(400, 'Este documento ya fue revisado');
    const action = oneOf(body.action, ['accept', 'reject'], 'decisión');
    const note = str(body.note, 600);
    return tx(db, () => {
      // --- corrección de algo que ya estaba aprobado ---
      if (d.prev) {
        const prev = JSON.parse(d.prev);
        if (action === 'reject') {
          writeFields(d.id, prev);                        // vuelve la versión aprobada
          db.prepare("UPDATE sub_docs SET status=?, prev='', owner_note=?, corr_ok='[]' WHERE id=?").run(prev.status, note, d.id);
          history(d.id, user.id, 'correccion_rechazada', d.total_cents, prev.total_cents, note);
          return out(get(d.id));
        }
        const got = parseIds(d.corr_ok);
        if (got.includes(user.id)) fail(400, 'Usted ya aprobó: falta el otro dueño');
        got.push(user.id);
        if (got.length < needed(d)) {
          db.prepare('UPDATE sub_docs SET corr_ok=? WHERE id=?').run(JSON.stringify(got), d.id);
          history(d.id, user.id, 'correccion_aprobada_1', prev.total_cents, d.total_cents, note);
          return out(get(d.id));
        }
        {
          applyDifference({ ...d, total_cents: prev.total_cents }, d.total_cents, d.number, d.description);
          db.prepare("UPDATE sub_docs SET status=?, prev='', corr_ok='[]', owner_note=?, decided_by=?, decided_at=datetime('now') WHERE id=?").run(prev.status, note, user.id, d.id);
          history(d.id, user.id, 'correccion_aprobada', prev.total_cents, d.total_cents, note);
        }
        return out(get(d.id));
      }
      if (action === 'reject') {
        db.prepare("UPDATE sub_docs SET status='rechazado', owner_note=?, decided_by=?, decided_at=datetime('now') WHERE id=?").run(note, user.id, d.id);
        history(d.id, user.id, 'rechazado', d.total_cents, d.total_cents, note);
        return out(get(d.id));
      }
      const s = agreementFor(d);
      // Estimados: por defecto se suman a lo acordado. Invoices: solo si no vienen de un estimado ya aceptado.
      const addToAgreed = body.add_to_agreed !== undefined ? !!body.add_to_agreed : (d.type !== 'invoice' || !d.from_estimate_id);
      if (addToAgreed) db.prepare('UPDATE subs SET agreed_cents = agreed_cents + ? WHERE id=?').run(d.total_cents, s.id);
      if (d.type !== 'invoice') {
        db.prepare("UPDATE sub_docs SET status='aceptado', sub_id=?, added_to_agreed=?, owner_note=?, decided_by=?, decided_at=datetime('now') WHERE id=?")
          .run(s.id, addToAgreed ? 1 : 0, note, user.id, d.id);
        history(d.id, user.id, 'aceptado', d.total_cents, d.total_cents, note);
      } else {
        const expDate = needDate(body.expense_date || d.date, 'fecha del gasto');
        const expId = Number(db.prepare(`INSERT INTO expenses(job_id,date,category,description,vendor,bought_by,amount_cents,sub_id,created_by)
          VALUES(?,?,'subcontratistas',?,?,'',?,?,?)`).run(d.job_id, expDate, `Invoice ${d.number} — ${d.description}`.slice(0, 300), s.name, d.total_cents, s.id, user.id).lastInsertRowid);
        const paid = !!body.paid;
        db.prepare(`UPDATE sub_docs SET status='aprobado', sub_id=?, expense_id=?, added_to_agreed=?, owner_note=?, decided_by=?, decided_at=datetime('now'),
          paid_at='', paid_method='' WHERE id=?`).run(s.id, expId, addToAgreed ? 1 : 0, note, user.id, d.id);
        if (paid) SP.addPayment(db, user, s, { docId: d.id, date: date(body.paid_date, 'fecha de pago') || today(), amount: d.total_cents, method: SP.METHODS.includes(body.paid_method) ? body.paid_method : (SP.guessMethod(body.paid_method) || 'Otro'), reference: SP.METHODS.includes(body.paid_method) ? str(body.paid_reference, 80) : str(body.paid_method, 60) });
        history(d.id, user.id, 'aprobado', d.total_cents, d.total_cents, note);
        if (paid) history(d.id, user.id, 'pagado', null, null, str(body.paid_method, 60));
      }
      return out(get(d.id));
    });
  });

  add('POST', '/api/docs/:id/paid', ({ user, params, body }) => {
    requireRole(user, 'owner');
    const d = docOr404(user, params.id);
    if (d.type !== 'invoice' || d.status !== 'aprobado') fail(400, 'Solo un invoice aprobado se puede marcar como pagado');
    // "Marcar pagado" = registrar un pago por lo que falta. "No pagado" = borrar los pagos de este invoice.
    if (body.paid === false) {
      db.prepare('DELETE FROM sub_payments WHERE doc_id=?').run(d.id);
      SP.syncInvoice(db, d.id);
      history(d.id, user.id, 'no_pagado', null, null);
    } else {
      const left = d.total_cents - SP.invoicePaid(db, d.id);
      const s = db.prepare('SELECT * FROM subs WHERE id=?').get(d.sub_id);
      if (left > 0 && s) {
        const m = String(body.method || '');
        SP.addPayment(db, user, s, { docId: d.id, date: date(body.date, 'fecha de pago') || today(), amount: left,
          method: SP.METHODS.includes(m) ? m : (SP.guessMethod(m) || 'Otro'), reference: SP.METHODS.includes(m) ? str(body.reference, 80) : str(m, 80) });
      }
      history(d.id, user.id, 'pagado', null, null, str(body.method, 60));
    }
    return out(get(d.id));
  });
};
