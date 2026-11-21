'use strict';
// Catálogo de materiales, ficha de materiales por obra y galería de trabajos terminados.
//  - Cada material (marca, nombre, color, acabado) se registra una vez, con su foto de cerca (close-up).
//  - En cada obra se elige qué material va en cada zona (ceiling, fascia, cubierta de cocina…).
//  - El cliente ve la ficha de su obra y puede buscar un material y ver fotos de OTROS trabajos terminados
//    donde se usó (solo fotos marcadas "galería", sin nombres ni direcciones).
//  - Al terminar una obra, sus fotos finales entran solas a la galería (se pueden quitar).
const fs = require('node:fs');
const path = require('node:path');

const ZONES = [
  ['techo', 'Techo', 'Roof'], ['ceiling', 'Ceiling', 'Ceiling'], ['fascia', 'Fascia y trim', 'Fascia and trim'], ['estructura', 'Postes y vigas', 'Posts and beams'],
  ['piso', 'Piso', 'Flooring'], ['cocina_cubierta', 'Cocina: cubierta', 'Kitchen: countertop'], ['cocina_base', 'Cocina: base / revestimiento', 'Kitchen: base / veneer'],
  ['cocina_equipo', 'Cocina: equipo', 'Kitchen: appliances'], ['chimenea', 'Chimenea / fogón', 'Fireplace / fire pit'], ['iluminacion', 'Iluminación y ventiladores', 'Lighting and fans'],
  ['pintura', 'Pintura y stain', 'Paint and stain'], ['otro', 'Otro', 'Other'],
].map(([key, es, en]) => ({ key, es, en }));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

module.exports = function materialRoutes(db, add, h) {
  const { requireRole, fail, str, need, intId, jobOr404, canSeeJob } = h;
  const dir = path.join(db.dataDir, 'materials');
  fs.mkdirSync(dir, { recursive: true });
  const imgPath = id => path.join(dir, `${id}.jpg`);
  const anyUser = u => requireRole(u, 'owner', 'pm', 'sales', 'worker', 'client');
  const staff = u => requireRole(u, 'owner');
  const zoneLabel = (k, l = 'es') => (ZONES.find(z => z.key === k) || ZONES.at(-1))[l];

  const galleryPhotos = (matId, limit = 24) => db.prepare(`SELECT f.id, f.caption, j.project_type FROM files f JOIN jobs j ON j.id=f.job_id
    WHERE f.gallery=1 AND f.kind='photo' AND f.msg_id IS NULL AND f.job_id IN (SELECT job_id FROM job_materials WHERE material_id=?) ORDER BY f.created_at DESC LIMIT ?`).all(matId, limit);
  const out = m => ({ ...m, zone_es: zoneLabel(m.zone, 'es'), zone_en: zoneLabel(m.zone, 'en'), image: m.has_image ? `/api/materials/${m.id}/image` : null,
    jobs: db.prepare('SELECT COUNT(DISTINCT job_id) n FROM job_materials WHERE material_id=?').get(m.id).n, photos: galleryPhotos(m.id, 3).map(p => p.id) });
  const fields = (b, cur = {}) => {
    const hex = str(b.color_hex ?? cur.color_hex, 7);
    if (hex && !/^#[0-9a-fA-F]{6}$/.test(hex)) fail(400, 'Color inválido (use #RRGGBB)');
    return { zone: ZONES.some(z => z.key === (b.zone ?? cur.zone)) ? (b.zone ?? cur.zone) : 'otro', kind: str(b.kind ?? cur.kind, 80), brand: str(b.brand ?? cur.brand, 80),
      name: need(b.name ?? cur.name, 'nombre del material', 120), color_name: str(b.color_name ?? cur.color_name, 80), color_hex: hex, finish: str(b.finish ?? cur.finish, 80), notes: str(b.notes ?? cur.notes, 1000) };
  };
  const saveImg = (id, dataUrl) => {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) fail(400, 'La foto debe ser JPG, PNG o WEBP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 6 * 1024 * 1024) fail(413, 'Foto demasiado grande');
    fs.writeFileSync(imgPath(id), buf);
    fs.writeFileSync(imgPath(id) + '.type', 'image/' + m[1]);
    db.prepare('UPDATE materials SET has_image=1 WHERE id=?').run(id);
  };

  add('GET', '/api/materials', ({ user, query }) => {
    anyUser(user);
    const q = norm(query.get('q')), zone = query.get('zone') || '';
    let rows = db.prepare('SELECT * FROM materials ORDER BY zone, name, color_name').all();
    if (zone) rows = rows.filter(m => m.zone === zone);
    if (q) { const words = q.split(/\s+/).filter(Boolean); rows = rows.filter(m => { const hay = norm([m.name, m.brand, m.color_name, m.kind, m.finish, zoneLabel(m.zone, 'es'), zoneLabel(m.zone, 'en'), m.notes].join(' ')); return words.every(w => hay.includes(w)); }); }
    return { zones: ZONES, materials: rows.map(out).sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name)) };
  });
  add('GET', '/api/materials/:id', ({ user, params }) => {
    anyUser(user);
    const m = db.prepare('SELECT * FROM materials WHERE id=?').get(intId(params.id)); if (!m) fail(404, 'No encontrado');
    const r = { ...out(m), gallery: galleryPhotos(m.id) };
    if (user.role === 'owner' || user.role === 'pm') r.used_in = db.prepare('SELECT DISTINCT j.id, j.client_name, jm.area FROM job_materials jm JOIN jobs j ON j.id=jm.job_id WHERE jm.material_id=?').all(m.id).filter(j => canSeeJob(db, user, j.id));
    return r;
  });
  add('GET', '/api/materials/:id/image', ({ user, params }) => {
    anyUser(user);
    const id = intId(params.id);
    if (!fs.existsSync(imgPath(id))) fail(404, 'No encontrado');
    let type = 'image/jpeg'; try { type = fs.readFileSync(imgPath(id) + '.type', 'utf8'); } catch { /* */ }
    return { $buffer: fs.readFileSync(imgPath(id)), $type: type, $name: `material-${id}.jpg` };
  });
  add('POST', '/api/materials', ({ user, body }) => {
    staff(user);
    const f = fields(body);
    const dup = db.prepare('SELECT id FROM materials WHERE lower(name)=lower(?) AND lower(color_name)=lower(?) AND lower(brand)=lower(?)').get(f.name, f.color_name, f.brand);
    if (dup) fail(400, 'Ese material con ese color ya está en el catálogo');
    const id = Number(db.prepare('INSERT INTO materials(zone,kind,brand,name,color_name,color_hex,finish,notes) VALUES(?,?,?,?,?,?,?,?)').run(f.zone, f.kind, f.brand, f.name, f.color_name, f.color_hex, f.finish, f.notes).lastInsertRowid);
    if (body.image) saveImg(id, body.image);
    return out(db.prepare('SELECT * FROM materials WHERE id=?').get(id));
  });
  add('PUT', '/api/materials/:id', ({ user, params, body }) => {
    staff(user);
    const m = db.prepare('SELECT * FROM materials WHERE id=?').get(intId(params.id)); if (!m) fail(404, 'No encontrado');
    const f = fields(body, m);
    db.prepare('UPDATE materials SET zone=?, kind=?, brand=?, name=?, color_name=?, color_hex=?, finish=?, notes=? WHERE id=?').run(f.zone, f.kind, f.brand, f.name, f.color_name, f.color_hex, f.finish, f.notes, m.id);
    if (body.image) saveImg(m.id, body.image);
    return out(db.prepare('SELECT * FROM materials WHERE id=?').get(m.id));
  });
  add('DELETE', '/api/materials/:id', ({ user, params }) => {
    requireRole(user, 'owner');
    if (user.isPm) fail(403, 'Esto solo lo pueden hacer los dueños');
    const id = intId(params.id);
    if (db.prepare('SELECT 1 FROM job_materials WHERE material_id=?').get(id)) fail(400, 'Ese material ya se usó en obras: no se puede borrar (sí se puede editar)');
    db.prepare('DELETE FROM materials WHERE id=?').run(id);
    for (const f of [imgPath(id), imgPath(id) + '.type']) { try { fs.unlinkSync(f); } catch { /* */ } }
    return { ok: true };
  });

  // Ficha de materiales de una obra.
  add('GET', '/api/jobs/:id/materials', ({ user, params }) => {
    anyUser(user);
    const job = jobOr404(db, user, intId(params.id));
    return db.prepare('SELECT jm.id jm_id, jm.area, jm.note, jm.material_id FROM job_materials jm JOIN materials m ON m.id=jm.material_id WHERE jm.job_id=? ORDER BY m.zone, jm.position, jm.id').all(job.id)
      .map(r => ({ jm_id: r.jm_id, area: r.area, note: r.note, material: out(db.prepare('SELECT * FROM materials WHERE id=?').get(r.material_id)) }));
  });
  add('POST', '/api/jobs/:id/materials', ({ user, params, body }) => {
    staff(user);
    const job = jobOr404(db, user, intId(params.id));
    const m = db.prepare('SELECT id FROM materials WHERE id=?').get(intId(body.material_id)); if (!m) fail(400, 'Material no encontrado');
    const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 n FROM job_materials WHERE job_id=?').get(job.id).n;
    const id = Number(db.prepare('INSERT INTO job_materials(job_id,material_id,area,note,position) VALUES(?,?,?,?,?)').run(job.id, m.id, str(body.area, 120), str(body.note, 300), pos).lastInsertRowid);
    return { id, job_id: job.id };
  });
  add('DELETE', '/api/job-materials/:id', ({ user, params }) => {
    staff(user);
    const r = db.prepare('SELECT * FROM job_materials WHERE id=?').get(intId(params.id)); if (!r) fail(404, 'No encontrado');
    jobOr404(db, user, r.job_id);
    db.prepare('DELETE FROM job_materials WHERE id=?').run(r.id);
    return { ok: true };
  });

  // Galería: fotos de la obra marcadas para mostrar.
  add('GET', '/api/jobs/:id/gallery', ({ user, params }) => {
    staff(user);
    const job = jobOr404(db, user, intId(params.id));
    return db.prepare("SELECT id, caption, gallery, created_at FROM files WHERE job_id=? AND kind='photo' AND msg_id IS NULL ORDER BY created_at DESC").all(job.id);
  });
  add('PUT', '/api/files/:id/gallery', ({ user, params, body }) => {
    staff(user);
    const f = db.prepare('SELECT * FROM files WHERE id=?').get(str(params.id, 64));
    if (!f || !canSeeJob(db, user, f.job_id)) fail(404, 'No encontrado');
    if (f.kind !== 'photo' || f.msg_id) fail(400, 'Solo fotos de la obra pueden ir a la galería');
    db.prepare('UPDATE files SET gallery=? WHERE id=?').run(body.gallery ? 1 : 0, f.id);
    return { ok: true };
  });
};

// Fotos finales a la galería en automático (lo llama alerts.js después de cada acción).
module.exports.autoGallery = function autoGallery(db, key, ctx) {
  try {
    const p = ctx.params || {}, b = ctx.body || {};
    if (key === 'PUT /api/jobs/:id' && b.status === 'terminado') {
      const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(Number(p.id));
      if (!job || job.status !== 'terminado') return;
      if (db.prepare("SELECT 1 FROM followups WHERE job_id=? AND kind='gallery_auto'").get(job.id)) return; // solo la primera vez
      db.prepare("INSERT INTO followups(job_id,kind) VALUES(?,'gallery_auto')").run(job.id);
      const since = new Date(Date.parse((job.completed_date || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z') - 7 * 864e5).toISOString().replace('T', ' ').slice(0, 19);
      const lastTasks = db.prepare('SELECT id FROM tasks WHERE job_id=? ORDER BY position DESC LIMIT 2').all(job.id).map(t => t.id);
      db.prepare(`UPDATE files SET gallery=1 WHERE job_id=? AND kind='photo' AND msg_id IS NULL AND (created_at>=? OR task_id IN (${lastTasks.map(() => '?').join(',') || 'NULL'}))`).run(job.id, since, ...lastTasks);
    }
    if (key === 'POST /api/jobs/:id/photos' || key === 'POST /api/jobs/:id/logs' || key === 'PUT /api/tasks/:id') {
      const jobId = key === 'PUT /api/tasks/:id' ? (db.prepare('SELECT job_id FROM tasks WHERE id=?').get(Number(p.id)) || {}).job_id : Number(p.id);
      const job = jobId && db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId);
      if (job && job.status === 'terminado') db.prepare("UPDATE files SET gallery=1 WHERE job_id=? AND kind='photo' AND msg_id IS NULL AND created_at>=datetime('now','-2 minutes')").run(jobId);
    }
  } catch (e) { console.error('[galería]', e.message); }
};
module.exports.ZONES = ZONES;
