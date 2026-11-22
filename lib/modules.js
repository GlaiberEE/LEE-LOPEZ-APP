'use strict';
// Módulos que cada empresa prende o apaga (solo quitan el menú: los datos se quedan).
const KEYS = ['horas', 'pm', 'proyecciones', 'agentes', 'importar'];
const getMeta = (db, k) => (db.prepare('SELECT value FROM meta WHERE key=?').get(k) || {}).value;
function modules(db) {
  let saved = {}; try { saved = JSON.parse(getMeta(db, 'modules') || '{}') || {}; } catch { /* */ }
  const has = sql => !!db.prepare(sql).get();
  // Sin elección guardada: prendido solo si ya se usa.
  const def = {
    horas: has("SELECT 1 FROM users WHERE role='worker' AND (pay_type='hora' OR rate_cents>0) LIMIT 1") || has('SELECT 1 FROM time_entries LIMIT 1'),
    pm: has("SELECT 1 FROM users WHERE role='pm' AND is_agent=0 LIMIT 1"),
    proyecciones: false,
    agentes: has('SELECT 1 FROM users WHERE is_agent=1 LIMIT 1'),
    importar: true,
  };
  return Object.fromEntries(KEYS.map(k => [k, typeof saved[k] === 'boolean' ? saved[k] : def[k]]));
}
function routes(db, add, h) {
  const { requireRole, fail } = h;
  add('GET', '/api/settings/modules', ({ user }) => { requireRole(user, 'owner'); return modules(db); });
  add('PUT', '/api/settings/modules', ({ user, body }) => {
    requireRole(user, 'owner'); if (user.isPm || user.is_agent) fail(403, 'Esto solo lo pueden hacer los dueños');
    const cur = modules(db);
    for (const k of KEYS) if (k in body) cur[k] = !!body[k];
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('modules', JSON.stringify(cur));
    db.prepare("INSERT INTO audit_log(user_id,action,entity,entity_id,summary) VALUES(?,?,?,?,?)").run(user.id, 'editar', 'configuracion', 0,
      'Módulos: ' + KEYS.map(k => `${k} ${cur[k] ? 'prendido' : 'apagado'}`).join(', '));
    return cur;
  });
}
module.exports = { modules, routes, KEYS };
