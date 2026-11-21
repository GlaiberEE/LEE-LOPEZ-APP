'use strict';
// Lector de archivos de Excel (.xlsx) sin paquetes externos: descomprime el ZIP y lee las hojas.
// Devuelve { hojas: { nombre: [[celda, celda…], …] } } con textos, números y booleanos.
const zlib = require('node:zlib');

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('No es un archivo de Excel (.xlsx) válido');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Archivo de Excel dañado');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (!/\.(xml|rels)$/i.test(name)) continue;
    if (usize > 60 * 1024 * 1024) throw new Error('Archivo de Excel demasiado grande');
    const lnlen = buf.readUInt16LE(off + 26), lxlen = buf.readUInt16LE(off + 28);
    const data = buf.slice(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    files[name] = method === 8 ? zlib.inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 }) : data;
  }
  return files;
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] ?? m));
const attr = (s, a) => { const m = new RegExp(`\\b${a}="([^"]*)"`).exec(s); return m ? decode(m[1]) : null; };
const texts = xml => [...String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map(m => decode(m[1] || '')).join('');
const colIndex = ref => { let n = 0; for (const ch of String(ref).replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function readXlsx(buf) {
  const files = unzip(buf);
  const get = n => { const k = Object.keys(files).find(x => x.toLowerCase() === n.toLowerCase()); return k ? files[k].toString('utf8') : ''; };
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => texts(m[1]));
  const rels = {};
  for (const m of get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    let target = attr(m[1], 'Target') || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    rels[attr(m[1], 'Id')] = target;
  }
  const sheets = {};
  for (const m of get('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], 'name'), rid = attr(m[1], 'r:id');
    const xml = get(rels[rid] || '');
    const rows = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const ri = Number(attr(r[1], 'r')) - 1;
      const row = [];
      for (const c of String(r[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = c[1], inner = c[2] || '';
        const ref = attr(a, 'r'), type = attr(a, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        let val = null;
        if (type === 's') val = v ? shared[Number(v[1])] ?? '' : '';
        else if (type === 'inlineStr') val = texts(inner);
        else if (type === 'str' || type === 'e') val = v ? decode(v[1]) : '';
        else if (type === 'b') val = v ? v[1] === '1' : null;
        else if (v) { const n = Number(v[1]); val = Number.isFinite(n) ? n : decode(v[1]); }
        if (val === null || val === '') continue;
        row[ref ? colIndex(ref) : row.length] = val;
      }
      if (row.length) rows[ri >= 0 ? ri : rows.length] = row;
    }
    sheets[name] = Array.from(rows, x => x || []);
  }
  return sheets;
}
module.exports = { readXlsx, unzip };
