'use strict';
// Generador de PDF sencillo, sin paquetes externos (tamaño carta, Helvetica).
// Coordenadas desde la esquina superior izquierda, en puntos (72 = 1 pulgada).
const fs = require('node:fs');
const path = require('node:path');

const W = 612, H = 792;

// Helvetica usa WinAnsi: letras con acento y ñ están; estos signos se traducen a su código.
const WIN = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
function encode(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    let c = ch.codePointAt(0);
    if (WIN[ch]) c = WIN[ch];
    else if (ch === '→') { out += '->'; continue; }
    else if (c > 255) c = 63; // '?'
    if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += String.fromCharCode(c);
  }
  return out;
}
// Anchos aproximados de Helvetica (por 1000) para alinear números y cortar renglones.
const NARROW = new Set([...' ,.;:!|il\'Ijft[]()']);
const WIDE = new Set([...'mwMW@']);
function textWidth(s, size, bold) {
  let w = 0;
  for (const ch of String(s ?? '')) {
    if (/[0-9$]/.test(ch)) w += 556; else if (NARROW.has(ch)) w += 278; else if (WIDE.has(ch)) w += 833;
    else if (ch === '-') w += 333; else if (/[A-Z]/.test(ch)) w += 667; else w += 530;
  }
  return w * size / 1000 * (bold ? 1.05 : 1);
}
function wrap(s, size, maxW, bold) {
  const lines = [];
  for (const para of String(s ?? '').split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const tryLine = cur ? cur + ' ' + word : word;
      if (textWidth(tryLine, size, bold) <= maxW || !cur) cur = tryLine; else { lines.push(cur); cur = word; }
    }
    lines.push(cur);
  }
  return lines;
}
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { w: 1, h: 1 };
}
const rgb = hex => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(v => v.toFixed(3)).join(' '); };

class PDF {
  constructor() { this.pages = []; this.images = []; this.addPage(); }
  addPage() { this.cur = []; this.pages.push(this.cur); return this; }
  text(x, y, s, { size = 10, bold = false, color = '#1d1d1d', align = 'left' } = {}) {
    let tx = x; const w = textWidth(s, size, bold);
    if (align === 'right') tx = x - w; else if (align === 'center') tx = x - w / 2;
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${tx.toFixed(2)} ${(H - y - size).toFixed(2)} Td (${encode(s)}) Tj ET`);
    return this;
  }
  line(x1, y1, x2, y2, { width = 0.6, color = '#cfcfc8' } = {}) {
    this.cur.push(`${width} w ${rgb(color)} RG ${x1} ${H - y1} m ${x2} ${H - y2} l S`); return this;
  }
  rect(x, y, w, h, { fill = '#f2f2ee' } = {}) { this.cur.push(`${rgb(fill)} rg ${x} ${H - y - h} ${w} ${h} re f`); return this; }
  image(buf, x, y, w) {
    const { w: iw, h: ih } = jpegSize(buf);
    const h = w * ih / iw;
    let idx = this.images.findIndex(i => i.buf === buf);
    if (idx < 0) { this.images.push({ buf, iw, ih }); idx = this.images.length - 1; }
    this.cur.push(`q ${w} 0 0 ${h} ${x} ${H - y - h} cm /Im${idx} Do Q`);
    return h;
  }
  toBuffer() {
    const objs = [];
    const addObj = s => { objs.push(s); return objs.length; };
    const catalog = addObj(null), pagesId = addObj(null);
    const f1 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgIds = this.images.map(im => addObj({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.iw} /Height ${im.ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.buf.length} >>`, data: im.buf }));
    const xo = imgIds.map((id, i) => `/Im${i} ${id} 0 R`).join(' ');
    const pageIds = this.pages.map((ops, i) => {
      const content = Buffer.from(ops.join('\n') + `\nBT /F1 8 Tf 0.5 0.5 0.5 rg ${W - 72} 24 Td (${i + 1} / ${this.pages.length}) Tj ET`, 'latin1');
      const cId = addObj({ dict: `<< /Length ${content.length} >>`, data: content });
      return addObj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${cId} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> /XObject << ${xo} >> >> >>`);
    });
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
    const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    const offsets = []; let pos = parts[0].length;
    objs.forEach((o, i) => {
      offsets.push(pos);
      const chunk = typeof o === 'string' ? Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')
        : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${o.dict}\nstream\n`, 'latin1'), o.data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      parts.push(chunk); pos += chunk.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
}

// ===== Documento con formato de la empresa =====
const LOGO = fs.readFileSync(path.join(__dirname, 'assets', 'logo-print.jpg'));
const NAVY = '#02175D', MUTED = '#666660', LIME = '#4E6B12';
const money = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Arma un documento: encabezado, datos, tabla(s), totales, notas.
//   spec = { title, number, meta: [[label, value]], from: [lineas], to: [lineas], sections: [{ heading, rows: [{desc, qty, unit, amount, note}], total? }], totals: [[label, cents, bold]], notes: [texto], footer }
function buildDocument(spec, L) {
  const pdf = new PDF();
  const M = 48, R = W - 48;
  let y = 40;
  const header = () => {
    if (spec.logo !== false) pdf.image(LOGO, M, y, 150);
    else pdf.text(M, y + 8, spec.company || '', { size: 18, bold: true, color: '#181818' });
    pdf.text(R, y + 2, spec.title, { size: 20, bold: true, color: NAVY, align: 'right' });
    if (spec.number) pdf.text(R, y + 28, spec.number, { size: 11, color: MUTED, align: 'right' });
    if (spec.badge) pdf.text(R, y + 44, spec.badge, { size: 10, bold: true, color: LIME, align: 'right' });
    y += 72;
    pdf.line(M, y, R, y, { width: 1.2, color: '#181818' }); y += 14;
  };
  const ensure = need => { if (y + need > H - 60) { pdf.addPage(); y = 40; header(); } };
  header();
  // Bloques De / Para y datos
  const colW = (R - M) / 3;
  const blocks = [[L.from, spec.from], [L.to, spec.to], [L.details, (spec.meta || []).map(([k, v]) => `${k}: ${v}`)]];
  let maxH = 0;
  blocks.forEach(([label, lines], i) => {
    if (!lines || !lines.length) return;
    let yy = y; const x = M + i * colW;
    pdf.text(x, yy, label.toUpperCase(), { size: 8, bold: true, color: MUTED }); yy += 13;
    lines.filter(Boolean).forEach((ln, k) => wrap(ln, 9.5, colW - 12, k === 0).forEach(w => { pdf.text(x, yy, w, { size: 9.5, bold: k === 0 }); yy += 12.5; }));
    maxH = Math.max(maxH, yy - y);
  });
  y += maxH + 14;
  if (spec.description) { wrap(spec.description, 10.5, R - M).forEach(l => { ensure(16); pdf.text(M, y, l, { size: 10.5 }); y += 14; }); y += 6; }
  // Tablas
  const cx = { qty: R - 190, unit: R - 95, amt: R };
  for (const sec of spec.sections || []) {
    ensure(60);
    if (sec.heading) { pdf.text(M, y, sec.heading, { size: 11, bold: true, color: NAVY }); y += 18; }
    pdf.rect(M, y - 4, R - M, 18, { fill: '#181818' });
    pdf.text(M + 6, y, L.desc, { size: 8.5, bold: true, color: '#ffffff' });
    if (!sec.simple) { pdf.text(cx.qty, y, L.qty, { size: 8.5, bold: true, color: '#ffffff', align: 'right' }); pdf.text(cx.unit, y, L.price, { size: 8.5, bold: true, color: '#ffffff', align: 'right' }); }
    pdf.text(cx.amt - 6, y, L.amount, { size: 8.5, bold: true, color: '#ffffff', align: 'right' });
    y += 20;
    for (const r of sec.rows) {
      const descLines = wrap(r.desc, 9.5, (sec.simple ? R - 120 : cx.qty - 60) - M);
      const noteLines = r.note ? wrap(r.note, 8, (sec.simple ? R - 120 : cx.qty - 60) - M) : [];
      ensure(descLines.length * 12.5 + noteLines.length * 10 + 8);
      const top = y;
      descLines.forEach(l => { pdf.text(M + 6, y, l, { size: 9.5 }); y += 12.5; });
      noteLines.forEach(l => { pdf.text(M + 6, y, l, { size: 8, color: MUTED }); y += 10; });
      if (!sec.simple) { pdf.text(cx.qty, top, String(r.qty ?? ''), { size: 9.5, align: 'right' }); pdf.text(cx.unit, top, r.unit != null ? money(r.unit) : '', { size: 9.5, align: 'right' }); }
      pdf.text(cx.amt - 6, top, r.amount != null ? money(r.amount) : '', { size: 9.5, align: 'right', color: r.muted ? MUTED : '#1d1d1d' });
      y += 4; pdf.line(M, y, R, y); y += 6;
    }
    if (sec.total != null) { ensure(20); pdf.text(cx.unit, y, sec.totalLabel || L.subtotal, { size: 9.5, bold: true, align: 'right' }); pdf.text(cx.amt - 6, y, money(sec.total), { size: 9.5, bold: true, align: 'right' }); y += 22; }
    y += 6;
  }
  // Totales
  if (spec.totals && spec.totals.length) {
    ensure(spec.totals.length * 18 + 10);
    spec.totals.forEach(([label, c, strong]) => {
      if (strong) { const bx = Math.min(R - 230, R - 120 - textWidth(label, 11.5, true) - 12); pdf.rect(bx, y - 5, R - bx, 22, { fill: '#BADA55' }); }
      pdf.text(R - 120, y, label, { size: strong ? 11.5 : 10, bold: !!strong, align: 'right' });
      pdf.text(R - 6, y, money(c), { size: strong ? 11.5 : 10, bold: !!strong, align: 'right' });
      y += strong ? 26 : 17;
    });
  }
  // Notas
  for (const n of (spec.notes || []).filter(Boolean)) {
    ensure(30); y += 6;
    wrap(n, 9, R - M).forEach(l => { ensure(13); pdf.text(M, y, l, { size: 9, color: MUTED }); y += 12; });
  }
  // Firmas
  if (spec.signatures) {
    ensure(70); y += 34;
    const signed = spec.signatures.some(s => s && s.image);
    if (signed) { ensure(120); y += 50; }
    spec.signatures.forEach((s, i) => {
      const x = M + i * ((R - M) / 2 + 10);
      const label = typeof s === 'string' ? s : s.label;
      if (s && s.image) {
        // Firma electrónica: imagen encima de la línea y datos de la firma debajo.
        const { w: iw, h: ih } = jpegSize(s.image);
        const wMax = 170, hMax = 58; const k = Math.min(wMax / iw, hMax / ih);
        pdf.image(s.image, x, y - ih * k - 2, iw * k);
      }
      pdf.line(x, y, x + (R - M) / 2 - 20, y, { width: 0.8, color: '#555555' });
      pdf.text(x, y + 5, label, { size: 8.5, color: MUTED });
      (s && s.lines || []).forEach((ln, k) => pdf.text(x, y + 18 + k * 11, ln, { size: 7.5, color: MUTED }));
    });
  }
  pdf.pages.forEach(p => p.push(`BT /F1 8 Tf 0.5 0.5 0.5 rg 48 24 Td (${encode(spec.footer || '')}) Tj ET`));
  return pdf.toBuffer();
}

module.exports = { PDF, buildDocument, money, textWidth, wrap };
