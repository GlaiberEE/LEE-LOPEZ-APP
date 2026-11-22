'use strict';
// Base de datos: un solo archivo SQLite dentro de la carpeta de datos.
// Usa el SQLite que ya trae Node (node:sqlite), sin paquetes externos.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','pm','sales','worker','client')),
  phone TEXT DEFAULT '',
  trade TEXT DEFAULT '',
  lang TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  totp_secret TEXT,
  totp_pending TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_phone TEXT DEFAULT '',
  client_email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  project_type TEXT NOT NULL DEFAULT 'otro',
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'prospecto'
    CHECK (status IN ('prospecto','cotizado','activo','terminado','cancelado')),
  quoted_cents INTEGER NOT NULL DEFAULT 0,
  start_date TEXT DEFAULT '',
  end_date TEXT DEFAULT '',
  completed_date TEXT DEFAULT '',
  follow_up_date TEXT DEFAULT '',
  lead_source TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  client_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','en_progreso','hecho')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  planned_date TEXT DEFAULT '',
  done_date TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS subs (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trade TEXT DEFAULT '',
  agreed_cents INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  vendor TEXT DEFAULT '',
  bought_by TEXT DEFAULT '',
  amount_cents INTEGER NOT NULL,
  sub_id INTEGER REFERENCES subs(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS change_orders (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','aprobado','rechazado'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method TEXT DEFAULT '',
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('photo','receipt')),
  doc_id INTEGER,
  mime TEXT NOT NULL,
  caption TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_tasks_job ON tasks(job_id, position);
CREATE INDEX IF NOT EXISTS ix_exp_job ON expenses(job_id);
CREATE INDEX IF NOT EXISTS ix_files_job ON files(job_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
-- v2: avisos de calendario a subs y novedades para el cliente
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('owner','worker','moved')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  old_date TEXT DEFAULT '',
  new_date TEXT DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'otro',
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','respondido','cerrado')),
  response_date TEXT DEFAULT '',
  response_note TEXT DEFAULT '',
  responded_at TEXT DEFAULT '',
  resolution TEXT DEFAULT '',
  resolved_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_notices_user ON notices(to_user_id, status);
CREATE TABLE IF NOT EXISTS client_updates (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL CHECK (kind IN ('schedule','change_order','status','note')),
  data TEXT NOT NULL DEFAULT '{}',
  note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_updates_job ON client_updates(job_id, id);
-- v3: estimados e invoices que mandan los subs
CREATE TABLE IF NOT EXISTS sub_docs (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sub_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sub_id INTEGER REFERENCES subs(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('estimate','invoice','change_order')),
  number TEXT NOT NULL,
  date TEXT NOT NULL,
  due_date TEXT DEFAULT '',
  description TEXT NOT NULL,
  lines TEXT NOT NULL DEFAULT '[]',
  total_cents INTEGER NOT NULL,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','aceptado','aprobado','rechazado')),
  from_estimate_id INTEGER REFERENCES sub_docs(id) ON DELETE SET NULL,
  owner_note TEXT DEFAULT '',
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT DEFAULT '',
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  paid_at TEXT DEFAULT '',
  paid_method TEXT DEFAULT '',
  added_to_agreed INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  prev TEXT DEFAULT '',
  unlock_ok TEXT NOT NULL DEFAULT '[]',
  corr_ok TEXT NOT NULL DEFAULT '[]',
  unlock TEXT NOT NULL DEFAULT '' CHECK (unlock IN ('','pedido','autorizado','negado')),
  unlock_reason TEXT DEFAULT '',
  unlock_note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS doc_history (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES sub_docs(id) ON DELETE CASCADE,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  total_before INTEGER,
  total_after INTEGER,
  note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_docs_job ON sub_docs(job_id, status);
-- v4: tickets escaneados
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  mime TEXT NOT NULL,
  hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('procesando','por_asignar','guardado','descartado')),
  data TEXT DEFAULT 'null',
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  confidence REAL DEFAULT 0,
  why TEXT DEFAULT '',
  duplicate_of INTEGER,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  error TEXT DEFAULT '',
  filed_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_scans_status ON scans(status);
CREATE INDEX IF NOT EXISTS ix_scans_hash ON scans(hash);
CREATE INDEX IF NOT EXISTS ix_docs_user ON sub_docs(sub_user_id);
-- v5: casos (problemas y preguntas con fotos)
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('problema','pregunta')),
  title TEXT NOT NULL,
  urgent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'abierto' CHECK (status IN ('abierto','esperando_cliente','resuelto')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_role TEXT NOT NULL,
  worker_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  client_visible INTEGER NOT NULL DEFAULT 0,
  decision TEXT DEFAULT '',
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_issues_job ON issues(job_id, status);
CREATE TABLE IF NOT EXISTS issue_messages (
  id INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('interno','cliente')),
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_imsg_issue ON issue_messages(issue_id);
-- v6: firmas, presupuesto, reloj, permisos, reporte diario, garantía, push
CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('estimate','change_order')),
  target_id INTEGER,
  signer_name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  doc_hash TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  ip TEXT DEFAULT '', ua TEXT DEFAULT '',
  signed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_sig_job ON signatures(job_id);
CREATE TABLE IF NOT EXISTS budgets (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, category)
);
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  in_at TEXT NOT NULL, out_at TEXT DEFAULT '',
  in_lat REAL, in_lng REAL, in_acc REAL, in_dist INTEGER,
  out_lat REAL, out_lng REAL, out_acc REAL, out_dist INTEGER,
  minutes INTEGER DEFAULT 0,
  rate_cents INTEGER DEFAULT 0,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  note TEXT DEFAULT '', edited_by INTEGER
);
CREATE INDEX IF NOT EXISTS ix_time_user ON time_entries(user_id, out_at);
CREATE INDEX IF NOT EXISTS ix_time_job ON time_entries(job_id);
CREATE TABLE IF NOT EXISTS permits (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('permiso','inspeccion')),
  name TEXT NOT NULL,
  number TEXT DEFAULT '',
  status TEXT NOT NULL,
  date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_permits_job ON permits(job_id);
CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  client_notes TEXT DEFAULT '',
  internal_notes TEXT DEFAULT '',
  crew TEXT DEFAULT '',
  weather TEXT DEFAULT '',
  shared INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_logs_job ON daily_logs(job_id, date);
CREATE TABLE IF NOT EXISTS followups (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  done_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (job_id, kind)
);
CREATE TABLE IF NOT EXISTS push_subs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT DEFAULT '', url TEXT DEFAULT '#/',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, id);
-- v7: historial de obras pasadas (importado) para las proyecciones
CREATE TABLE IF NOT EXISTS hist_jobs (
  id INTEGER PRIMARY KEY,
  lead_date TEXT DEFAULT '', won_date TEXT DEFAULT '', done_date TEXT DEFAULT '',
  client TEXT DEFAULT '', project_type TEXT NOT NULL DEFAULT 'otro', source TEXT DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0, cost_cents INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 1,
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- v8: pagos a subs (parciales, por invoice o por acuerdo), con forma de pago y referencia
CREATE TABLE IF NOT EXISTS sub_payments (
  id INTEGER PRIMARY KEY,
  sub_id INTEGER NOT NULL REFERENCES subs(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  doc_id INTEGER REFERENCES sub_docs(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT '',
  reference TEXT DEFAULT '',
  note TEXT DEFAULT '',
  expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_subpay_sub ON sub_payments(sub_id);
CREATE INDEX IF NOT EXISTS ix_subpay_doc ON sub_payments(doc_id);
-- v9: seguridad de cambios: bitácora y solicitudes de cambio que autoriza el otro dueño
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  job_id INTEGER,
  summary TEXT DEFAULT '',
  before TEXT DEFAULT '',
  after TEXT DEFAULT '',
  amount_cents INTEGER DEFAULT 0,
  reason TEXT DEFAULT '',
  request_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_audit_job ON audit_log(job_id, id);
CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method TEXT NOT NULL, path TEXT NOT NULL, route TEXT NOT NULL, body TEXT NOT NULL DEFAULT '{}',
  entity TEXT NOT NULL, entity_id INTEGER, job_id INTEGER,
  summary TEXT DEFAULT '', amount_cents INTEGER DEFAULT 0,
  before TEXT DEFAULT '', before_hash TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','aprobado','rechazado','cancelado','conflicto')),
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL, decided_at TEXT DEFAULT '', decision_note TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_creq_status ON change_requests(status);
-- v11: actividad, reportes de PM, calificaciones, tablero, plan de trabajo, materiales
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  job_id INTEGER,
  detail TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_act_user ON activity_log(user_id, at);
CREATE TABLE IF NOT EXISTS pm_notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  did TEXT DEFAULT '', problems TEXT DEFAULT '', next_steps TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, date)
);
CREATE TABLE IF NOT EXISTS pm_reviews (
  id INTEGER PRIMARY KEY,
  pm_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comments TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pm_id, month, owner_id)
);
CREATE TABLE IF NOT EXISTS job_ratings (
  job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plan_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  project_type TEXT NOT NULL DEFAULT 'otro',
  tasks TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  zone TEXT NOT NULL DEFAULT 'otro',
  kind TEXT NOT NULL DEFAULT '',
  brand TEXT DEFAULT '',
  name TEXT NOT NULL,
  color_name TEXT DEFAULT '',
  color_hex TEXT DEFAULT '',
  finish TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  has_image INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_materials (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  area TEXT DEFAULT '',
  note TEXT DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_jm_job ON job_materials(job_id);
CREATE INDEX IF NOT EXISTS ix_jm_mat ON job_materials(material_id);
CREATE TABLE IF NOT EXISTS issue_reads (
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_msg_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (issue_id, user_id)
);
`;

// Cambios de estructura para bases creadas con versiones anteriores (no se pierde nada).
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(tasks)').all().map(c => c.name);
  if (!cols.includes('planned_end')) db.exec("ALTER TABLE tasks ADD COLUMN planned_end TEXT DEFAULT ''");
  const fcols = db.prepare('PRAGMA table_info(files)').all().map(c => c.name);
  if (fcols.length && !fcols.includes('doc_id')) db.exec('ALTER TABLE files ADD COLUMN doc_id INTEGER REFERENCES sub_docs(id) ON DELETE CASCADE');
  const fc2 = db.prepare('PRAGMA table_info(files)').all().map(c => c.name);
  if (fc2.length && !fc2.includes('msg_id')) db.exec('ALTER TABLE files ADD COLUMN msg_id INTEGER REFERENCES issue_messages(id) ON DELETE CASCADE');
  const addCol = (t, c, def) => { const cs = db.prepare(`PRAGMA table_info(${t})`).all().map(x => x.name); if (cs.length && !cs.includes(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
  addCol('files', 'log_id', 'INTEGER REFERENCES daily_logs(id) ON DELETE CASCADE');
  addCol('files', 'permit_id', 'INTEGER REFERENCES permits(id) ON DELETE CASCADE');
  addCol('jobs', 'lat', 'REAL');
  addCol('jobs', 'lng', 'REAL');
  addCol('jobs', 'pay_link', "TEXT DEFAULT ''");
  addCol('jobs', 'lead_new', 'INTEGER NOT NULL DEFAULT 0');
  addCol('jobs', 'signed_at', "TEXT DEFAULT ''");
  addCol('users', 'rate_cents', 'INTEGER NOT NULL DEFAULT 0');
  // v10: rol Project Manager. SQLite no deja cambiar el CHECK: se reconstruye la tabla de usuarios sin perder nada.
  const usql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() || {}).sql || '';
  if (usql && !usql.includes("'sales'")) { // v10: PM · v12: vendedor
    const ucols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec(usql.replace(/CREATE TABLE (IF NOT EXISTS )?"?users"?/, 'CREATE TABLE users_new').replace(/CHECK \(role IN \([^)]*\)\)/, "CHECK (role IN ('owner','pm','sales','worker','client'))"));
      db.exec(`INSERT INTO users_new(${ucols.join(',')}) SELECT ${ucols.join(',')} FROM users`);
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; } finally { db.exec('PRAGMA foreign_keys = ON'); }
  }
  addCol('users', 'pm_limit_cents', 'INTEGER NOT NULL DEFAULT 50000');
  addCol('users', 'pm_month_cents', 'INTEGER NOT NULL DEFAULT 500000');
  addCol('users', 'related_pm_id', 'INTEGER');
  addCol('jobs', 'pm_id', 'INTEGER');
  addCol('expenses', 'reimburse', 'INTEGER NOT NULL DEFAULT 0');
  addCol('tasks', 'notified_at', "TEXT DEFAULT ''");
  addCol('tasks', 'confirmed_at', "TEXT DEFAULT ''");
  addCol('tasks', 'days', 'INTEGER');
  addCol('files', 'gallery', 'INTEGER NOT NULL DEFAULT 0');
  // v12: ventas — rol vendedor, herramientas por usuario, agenda y seguimiento de estimados.
  addCol('users', 'tools', "TEXT NOT NULL DEFAULT ''");
  addCol('jobs', 'sales_id', 'INTEGER');
  addCol('jobs', 'estimate_sent_date', "TEXT DEFAULT ''");
  addCol('jobs', 'won_date', "TEXT DEFAULT ''");
  addCol('jobs', 'lost_reason', "TEXT DEFAULT ''");
  db.exec(`
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'cita',
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 60,
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendiente',
  result TEXT DEFAULT '',
  reminded_at TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_appt_user ON appointments(user_id, starts_at);
CREATE TABLE IF NOT EXISTS sales_events (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  note TEXT DEFAULT '',
  amount_cents INTEGER,
  next_date TEXT DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_sev_job ON sales_events(job_id);
`);
  // v13: recuperar acceso con contraseña temporal.
  addCol('users', 'must_change', 'INTEGER NOT NULL DEFAULT 0');
  addCol('users', 'temp_expires', 'TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS access_requests (
  id INTEGER PRIMARY KEY,
  ident TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendiente',
  resolved_by INTEGER,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
  // v14: partidas (lo que se vendió), margen por partida, reparto de ganancia, importador de libros de Excel.
  db.exec(`
CREATE TABLE IF NOT EXISTS job_lines (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  code TEXT NOT NULL DEFAULT '',
  trade TEXT NOT NULL DEFAULT '',
  crew TEXT DEFAULT '',
  description TEXT DEFAULT '',
  sold_cents INTEGER NOT NULL DEFAULT 0,
  est_cost_cents INTEGER NOT NULL DEFAULT 0,
  pass_through INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendiente',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_lines_job ON job_lines(job_id);
CREATE TABLE IF NOT EXISTS expense_items (
  id INTEGER PRIMARY KEY,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  unit TEXT DEFAULT '',
  qty REAL,
  unit_cost_cents INTEGER,
  total_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_items_exp ON expense_items(expense_id);
CREATE TABLE IF NOT EXISTS job_links (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  label TEXT DEFAULT '',
  url TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS job_lessons (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  line_code TEXT DEFAULT '',
  issue TEXT NOT NULL,
  cause TEXT DEFAULT '',
  cost_cents INTEGER NOT NULL DEFAULT 0,
  lesson TEXT DEFAULT '',
  avoid_repeat TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
  addCol('expenses', 'line_id', 'INTEGER REFERENCES job_lines(id) ON DELETE SET NULL');
  addCol('subs', 'line_id', 'INTEGER REFERENCES job_lines(id) ON DELETE SET NULL');
  addCol('tasks', 'line_id', 'INTEGER REFERENCES job_lines(id) ON DELETE SET NULL');
  addCol('change_orders', 'line_id', 'INTEGER REFERENCES job_lines(id) ON DELETE SET NULL');
  for (const c of ['review_profitable', 'review_stress', 'review_worked', 'review_didnt', 'review_notes', 'import_ref', 'profit_split', 'city']) addCol('jobs', c, "TEXT DEFAULT ''");
  // Un pago o invoice de un sub queda en la partida de ese sub, sin que nadie tenga que acordarse.
  db.exec(`CREATE TRIGGER IF NOT EXISTS tr_exp_line AFTER INSERT ON expenses WHEN NEW.sub_id IS NOT NULL AND NEW.line_id IS NULL
    BEGIN UPDATE expenses SET line_id=(SELECT line_id FROM subs WHERE id=NEW.sub_id) WHERE id=NEW.id; END;`);
  // v15: agentes (bots de AI como Grok) con llave de acceso.
  addCol('users', 'is_agent', 'INTEGER NOT NULL DEFAULT 0');
  addCol('users', 'pm_all', 'INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  can_write INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT DEFAULT '',
  uses INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT DEFAULT ''
);`);
  // v16: mensajes de texto (SMS) con subs y clientes.
  db.exec(`CREATE TABLE IF NOT EXISTS sms (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT '',
  sid TEXT DEFAULT '',
  error TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  read_at TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_sms_phone ON sms(phone, id);`);
  // v17: obras importadas desde un libro de Google Drive (para saber cuál ya se importó).
  addCol('jobs', 'drive_id', "TEXT DEFAULT ''");
  // v18: trabajadores por hora (forma de pago), tiempo extra por semana y nómina pagada.
  addCol('users', 'pay_type', "TEXT DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS ot_expenses (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, week_start, job_id)
);
CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 0,
  ot_minutes INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  method TEXT DEFAULT '', note TEXT DEFAULT '',
  paid_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, week_start)
);`);
  db.exec("UPDATE users SET pay_type='hora' WHERE role='worker' AND rate_cents>0 AND (pay_type IS NULL OR pay_type='')");
  // v19: propuesta al cliente con firma en línea y cobros por etapas.
  for (const c of ['proposal_terms', 'proposal_valid_until', 'proposal_token', 'proposal_sent_hash', 'proposal_signed_at', 'proposal_hash']) addCol('jobs', c, "TEXT DEFAULT ''");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_ptoken ON jobs(proposal_token) WHERE proposal_token<>'';
CREATE TABLE IF NOT EXISTS payment_milestones (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  pct REAL NOT NULL DEFAULT 0,
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('firma','tarea','manual')),
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  ready_at TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  invoiced_at TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_pm_job ON payment_milestones(job_id, position);`);
  // v20: papeles de los subs (W-9, seguro, lien waivers).
  db.exec(`CREATE TABLE IF NOT EXISTS sub_papers (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  tax_class TEXT NOT NULL DEFAULT '',
  w9_file TEXT NOT NULL DEFAULT '', w9_date TEXT NOT NULL DEFAULT '',
  coi_file TEXT NOT NULL DEFAULT '', coi_expires TEXT NOT NULL DEFAULT '', coi_carrier TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lien_waivers (
  id INTEGER PRIMARY KEY,
  sub_key TEXT NOT NULL,
  sub_payment_id INTEGER REFERENCES sub_payments(id) ON DELETE SET NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cond_parcial','incond_parcial','cond_final','incond_final')),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  through_date TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lw_pay ON lien_waivers(sub_payment_id) WHERE sub_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_lw_key ON lien_waivers(sub_key);`);
  // v21: gasto en publicidad por canal y cierre de obra (pendientes finales y firma de entrega del cliente).
  for (const c of ['closeout_requested_at', 'closeout_signed_at', 'closeout_signer', 'closeout_ip']) addCol('jobs', c, "TEXT DEFAULT ''");
  db.exec(`CREATE TABLE IF NOT EXISTS marketing_spend (
  id INTEGER PRIMARY KEY,
  month TEXT NOT NULL,
  channel TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS punch_items (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','hecho')),
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_punch_job ON punch_items(job_id, position);`);
  // v22: personas nuevas que piden acceso desde la pantalla de entrada.
  addCol('access_requests', 'kind', "TEXT NOT NULL DEFAULT ''");
  addCol('access_requests', 'phone', "TEXT NOT NULL DEFAULT ''");
  addCol('access_requests', 'note', "TEXT NOT NULL DEFAULT ''");
  db.prepare("INSERT INTO meta(key,value) VALUES('schema_version','22') ON CONFLICT(key) DO UPDATE SET value='22'").run();
}

function open(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'elevated.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  db.dataDir = dataDir;
  return db;
}

// Ejecuta fn dentro de una transacción (todo o nada).
function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Copia de seguridad consistente de la base (aunque la app esté en uso).
function backup(db, file) {
  db.prepare('VACUUM INTO ?').run(file);
  return file;
}

function autoBackup(db, keep = 14) {
  const dir = path.join(db.dataDir, 'backups');
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `elevated-${stamp}.db`);
  if (!fs.existsSync(file)) backup(db, file);
  const old = fs.readdirSync(dir).filter(f => /^elevated-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  while (old.length > keep) fs.unlinkSync(path.join(dir, old.shift()));
}

module.exports = { open, tx, backup, autoBackup };
