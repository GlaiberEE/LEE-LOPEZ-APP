'use strict';
// Leer los libros de Excel / Google Sheets directo desde Google Drive (para importar obras).
//  - Usa una "cuenta de servicio" de Google (un robot con su propio correo …@….iam.gserviceaccount.com).
//    Ustedes comparten con ese correo la carpeta de Drive donde están los libros (solo lectura). Nada más.
//  - Variable en Render: GOOGLE_SERVICE_ACCOUNT_JSON = el contenido completo del archivo .json de la llave.
//    Opcional: GOOGLE_DRIVE_FOLDER_ID = la carpeta con la que abre (lo que va después de /folders/ en la dirección).
//  - Solo lectura (drive.readonly). La app nunca cambia ni borra nada en Drive.
const crypto = require('node:crypto');

const SHEET = 'application/vnd.google-apps.spreadsheet';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FOLDER = 'application/vnd.google-apps.folder';
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function account() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) return null;
  try {
    const j = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    if (!j.client_email || !j.private_key) return null;
    return { email: j.client_email, key: j.private_key.replace(/\\n/g, '\n'), tokenUri: j.token_uri || 'https://oauth2.googleapis.com/token' };
  } catch { return null; }
}
const folderId = () => { const v = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim(); const m = /folders\/([A-Za-z0-9_-]+)/.exec(v); return m ? m[1] : v; };

let cached = null; // { token, exp, email }
async function token(f) {
  const a = account(); if (!a) throw Object.assign(new Error('Google Drive no está conectado todavía'), { status: 400 });
  if (cached && cached.email === a.email && cached.exp > Date.now() + 60e3) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: a.email, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: a.tokenUri, iat: now, exp: now + 3600 }));
  const sig = b64u(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claim}`), a.key));
  const r = await f(a.tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error('Google no aceptó la llave de la cuenta de servicio: ' + (j.error_description || j.error || r.status)), { status: 502 });
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000, email: a.email };
  return cached.token;
}

async function api(f, url, asBuffer) {
  const r = await f(url, { headers: { authorization: `Bearer ${await token(f)}` } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
    throw Object.assign(new Error(r.status === 404 ? 'No se encontró en Drive (¿la carpeta está compartida con la cuenta de la app?)' : 'Google Drive: ' + msg), { status: r.status === 404 ? 404 : 502 });
  }
  return asBuffer ? Buffer.from(await r.arrayBuffer()) : r.json();
}

module.exports = function driveRoutes(db, add, h, opts = {}) {
  const { requireRole, fail } = h;
  const f = opts.fetch || ((...a) => fetch(...a));
  const owner = u => { requireRole(u, 'owner'); if (u.isPm || u.is_agent) fail(403, 'Esto solo lo pueden hacer los dueños'); };
  const run = async fn => { try { return await fn(); } catch (e) { fail(e.status || 502, String(e.message || e)); } };

  add('GET', '/api/import/drive/status', ({ user }) => {
    owner(user);
    const a = account();
    return { enabled: !!a, email: a ? a.email : '', folder: folderId(), bad_json: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !a };
  });

  // Carpetas y libros. Sin carpeta: todo lo que compartieron con la cuenta de la app.
  add('GET', '/api/import/drive/files', ({ user, query }) => run(async () => {
    owner(user);
    const folder = String(query.get('folder') || folderId() || '').replace(/[^A-Za-z0-9_-]/g, '');
    const text = String(query.get('q') || '').replace(/['\\]/g, ' ').trim().slice(0, 80);
    const types = `(mimeType='${SHEET}' or mimeType='${XLSX}' or mimeType='${FOLDER}')`;
    const q = [`trashed=false`, types, folder && !text ? `'${folder}' in parents` : '', text ? `name contains '${text}'` : ''].filter(Boolean).join(' and ');
    const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({ q, pageSize: '200', orderBy: 'folder,modifiedTime desc',
      fields: 'files(id,name,mimeType,modifiedTime,size)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
    const j = await api(f, url);
    let here = null;
    if (folder && !text) { try { here = await api(f, `https://www.googleapis.com/drive/v3/files/${folder}?fields=id,name,parents&supportsAllDrives=true`); } catch { here = { id: folder, name: '' }; } }
    // ¿Ya se importó? (se guarda el id del libro de Drive al importar)
    const done = new Set(db.prepare("SELECT drive_id FROM jobs WHERE drive_id<>''").all().map(r => r.drive_id));
    return { folder: here ? { id: here.id, name: here.name, parent: (here.parents || [])[0] || '' } : null, root: folderId(),
      files: (j.files || []).map(x => ({ id: x.id, name: x.name, kind: x.mimeType === FOLDER ? 'folder' : x.mimeType === SHEET ? 'sheet' : 'xlsx', modified: x.modifiedTime, imported: done.has(x.id) })) };
  }));

  // Un libro, como archivo .xlsx (Google Sheets se exporta a Excel), listo para el importador.
  add('GET', '/api/import/drive/file/:id', ({ user, params }) => run(async () => {
    owner(user);
    const id = String(params.id).replace(/[^A-Za-z0-9_-]/g, '');
    const meta = await api(f, `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`);
    if (![SHEET, XLSX].includes(meta.mimeType)) fail(400, 'Ese archivo no es una hoja de cálculo');
    const buf = meta.mimeType === SHEET
      ? await api(f, `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(XLSX)}`, true)
      : await api(f, `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, true);
    if (buf.length > 15 * 1024 * 1024) fail(413, 'Archivo de Excel demasiado grande');
    return { id, name: meta.name.endsWith('.xlsx') ? meta.name : meta.name + '.xlsx', file: `data:${XLSX};base64,${buf.toString('base64')}` };
  }));
};
module.exports.account = account;
module.exports._reset = () => { cached = null; };
