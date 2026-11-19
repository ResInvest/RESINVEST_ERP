// Renderery dokumentu: PDF (jsPDF + osadzone czcionki), DOCX (oryginalny papier firmowy + fflate)
// i podgląd HTML na żywo. Wszystkie trzy korzystają z tego samego modelu treści (buildDocModel).

const MM = { pageW: 210, pageH: 297, mx: 15, top: 35, bottom: 266, headerH: 210 * 206 / 1550 };
const PT = { s: 7.5, m: 9, l: 10 };
const lineH = (pt) => pt * 0.3528 * 1.3;
const RGB = { ink: [14, 31, 38], border: [60, 74, 80], label: [241, 244, 243], red: [166, 58, 43], grey: [132, 149, 155] };

// --- PDF -------------------------------------------------------------------------------------------
let fontsReady = false;
function pdfDoc() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('LS-R.ttf', ASSETS.fontRegular);
  doc.addFileToVFS('LS-B.ttf', ASSETS.fontBold);
  doc.addFont('LS-R.ttf', 'LS', 'normal');
  doc.addFont('LS-B.ttf', 'LS', 'bold');
  fontsReady = true;
  doc.setFont('LS', 'normal');
  return doc;
}

/** Zawija akapit z częścią pogrubioną (etykieta) na linie o zadanej szerokości. */
function wrapRich(doc, para, width) {
  const size = PT[para.size || 'm'];
  const tokens = [];
  const push = (text, bold) => {
    for (const part of String(text).split(/(\n)/)) {
      if (part === '\n') { tokens.push({ nl: true }); continue; }
      for (const w of part.split(/(\s+)/)) if (w) tokens.push({ text: w, bold });
    }
  };
  if (para.label) push(para.label, true);
  push(para.t, !!para.b);
  const lines = [];
  let cur = []; let curW = 0;
  const flush = () => { while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) cur.pop(); lines.push(cur); cur = []; curW = 0; };
  for (const tok of tokens) {
    if (tok.nl) { flush(); continue; }
    doc.setFont('LS', tok.bold ? 'bold' : 'normal'); doc.setFontSize(size);
    const w = doc.getTextWidth(tok.text);
    if (/^\s+$/.test(tok.text)) { if (cur.length) { cur.push({ ...tok, w }); curW += w; } continue; }
    if (curW + w > width && cur.length) flush();
    if (w > width) { // bardzo długie słowo — tniemy znak po znaku
      let chunk = '';
      for (const ch of tok.text) {
        if (doc.getTextWidth(chunk + ch) > width) { cur.push({ text: chunk, bold: tok.bold, w: doc.getTextWidth(chunk) }); flush(); chunk = ''; }
        chunk += ch;
      }
      cur.push({ text: chunk, bold: tok.bold, w: doc.getTextWidth(chunk) }); curW = doc.getTextWidth(chunk);
      continue;
    }
    cur.push({ ...tok, w }); curW += w;
  }
  flush();
  return lines.map((segs, i) => ({ segs, size, h: lineH(size), gapBefore: i === 0 && para.gap ? 1.6 : 0, bullet: para.bullet && i === 0, indent: para.bullet ? 4 : 0, muted: para.muted }));
}

function layoutCell(doc, cell, width) {
  const out = [];
  for (const para of cell) {
    const indent = para.bullet ? 4 : 0;
    out.push(...wrapRich(doc, para, width - indent));
  }
  return out;
}

function drawLine(doc, line, x, y, color = RGB.ink) {
  let cx = x + line.indent;
  if (line.bullet) { doc.setFont('LS', 'normal'); doc.setFontSize(line.size); doc.setTextColor(...color); doc.text('•', x + 0.6, y); }
  for (const seg of line.segs) {
    doc.setFont('LS', seg.bold ? 'bold' : 'normal');
    doc.setFontSize(line.size);
    doc.setTextColor(...(line.muted ? RGB.grey : color));
    doc.text(seg.text, cx, y);
    cx += seg.w;
  }
}

function renderPdf(model) {
  const doc = pdfDoc();
  const W = MM.pageW - 2 * MM.mx;
  const pad = { x: 2.2, t: 1.9, b: 2.1 };
  let y = MM.top;
  const newPage = () => { doc.addPage(); y = MM.top; };

  if (model.dateLine) {
    doc.setFont('LS', 'normal'); doc.setFontSize(PT.l); doc.setTextColor(...RGB.ink);
    doc.text(model.dateLine, MM.pageW - MM.mx, y, { align: 'right' }); y += 6.5;
  }
  doc.setFont('LS', 'bold'); doc.setFontSize(15); doc.setTextColor(...RGB.ink);
  doc.text(model.title, MM.pageW / 2, y + 2, { align: 'center' }); y += 7;
  if (model.subtitle) { doc.setFontSize(9.5); doc.setTextColor(...RGB.red); doc.text(model.subtitle, MM.pageW / 2, y, { align: 'center' }); y += 5; }
  y += 2;

  for (const row of model.rows) {
    let cols;
    if (row.kind === 'pair') cols = [{ x: MM.mx, w: W / 2, cell: row.cells[0] }, { x: MM.mx + W / 2, w: W / 2, cell: row.cells[1] }];
    else if (row.kind === 'kv') cols = [{ x: MM.mx, w: 62, cell: [{ t: row.label, b: true, size: 'm' }], fill: true }, { x: MM.mx + 62, w: W - 62, cell: row.cell }];
    else cols = [{ x: MM.mx, w: W, cell: row.cell }];
    for (const c of cols) { c.lines = layoutCell(doc, c.cell, c.w - 2 * pad.x); c.i = 0; }
    const heightOf = (c, from = 0) => c.lines.slice(from).reduce((a, l) => a + l.h + l.gapBefore, 0);
    const total = Math.max(...cols.map((c) => heightOf(c))) + pad.t + pad.b;
    if (y + total > MM.bottom && total <= MM.bottom - MM.top) newPage();
    // Rysowanie fragmentami (wiersz dłuższy niż strona dzieli się między strony).
    while (cols.some((c) => c.i < c.lines.length)) {
      const avail = MM.bottom - y - pad.t - pad.b;
      const chunks = cols.map((c) => {
        let hh = 0; let j = c.i;
        while (j < c.lines.length && hh + c.lines[j].h + c.lines[j].gapBefore <= avail) { hh += c.lines[j].h + c.lines[j].gapBefore; j++; }
        return { c, from: c.i, to: j, hh };
      });
      if (chunks.every((ch) => ch.to === ch.from)) { newPage(); continue; }
      const rowH = Math.max(...chunks.map((ch) => ch.hh)) + pad.t + pad.b;
      for (const { c, from, to } of chunks) {
        if (c.fill) { doc.setFillColor(...RGB.label); doc.rect(c.x, y, c.w, rowH, 'F'); }
        doc.setDrawColor(...RGB.border); doc.setLineWidth(0.25); doc.rect(c.x, y, c.w, rowH, 'S');
        let ly = y + pad.t;
        for (let k = from; k < to; k++) {
          const ln = c.lines[k];
          ly += ln.gapBefore + ln.h;
          drawLine(doc, ln, c.x + pad.x, ly - ln.h * 0.28);
        }
        c.i = to;
      }
      y += rowH;
      if (cols.some((c) => c.i < c.lines.length)) newPage();
    }
  }

  // Podpisy
  // Podpisy mogą sięgać tuż nad stopkę (do 271 mm) — nie przenosimy ich samotnie na nową stronę bez potrzeby.
  const sigH = (model.dateLine ? 0 : 8) + 18;
  if (y + 5 + sigH > MM.bottom + 6) newPage();
  y += 5;
  model.signatures.forEach((label, i) => {
    const x = MM.mx + (i * W) / 2;
    const cx = x + W / 4;
    doc.setTextColor(...RGB.ink); doc.setFont('LS', 'normal'); doc.setFontSize(PT.l);
    let sy = y;
    if (!model.dateLine) { doc.text(model.placeDate, x + 2, sy + 3); sy += 8; }
    doc.setDrawColor(...RGB.grey); doc.setLineDashPattern([0.4, 0.8], 0); doc.line(cx - 32, sy + 12, cx + 32, sy + 12); doc.setLineDashPattern([], 0);
    doc.setFontSize(PT.s); doc.text(label, cx, sy + 15.5, { align: 'center' });
  });

  // Nagłówek, stopka, znak wodny i numeracja na każdej stronie
  const pages = doc.getNumberOfPages();
  const header = 'data:image/jpeg;base64,' + ASSETS.header;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.addImage(header, 'JPEG', 0, 0, MM.pageW, MM.headerH, 'letterhead', 'FAST');
    if (model.watermark) {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.09 }));
      doc.setFont('LS', 'bold'); doc.setFontSize(90); doc.setTextColor(...RGB.red);
      doc.text(model.watermark, MM.pageW / 2, MM.pageH / 2 + 15, { align: 'center', angle: 35 });
      doc.restoreGraphicsState();
    }
    let fy = 275;
    model.footer.forEach((line, idx) => {
      doc.setFont('LS', idx === 0 ? 'bold' : 'normal'); doc.setFontSize(6.6); doc.setTextColor(...RGB.ink);
      for (const part of doc.splitTextToSize(line, 140)) { doc.text(part, MM.mx + 11, fy); fy += 2.9; }
    });
    doc.setFont('LS', 'normal'); doc.setFontSize(6.8); doc.setTextColor(...RGB.grey);
    doc.text('Strona', 172, 282);
    doc.setFont('LS', 'bold'); doc.setTextColor(...RGB.ink); doc.text(`${i} / ${pages}`, 180.5, 282);
    if (model.website) { doc.setFontSize(7.2); doc.text(model.website, MM.pageW - MM.mx, 290, { align: 'right' }); }
  }
  doc.setProperties({ title: model.title, subject: model.title, author: 'ResInvest Commodities PL S.A.', creator: `GenResInvest ${BUILD.version}` });
  return doc.output('blob');
}

// --- DOCX ----------------------------------------------------------------------------------------
const xmlEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SZ = { s: 16, m: 19, l: 21 };
function wRun(text, { b = false, sz = 19, color = null } = {}) {
  const parts = String(text).split('\n');
  const rpr = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/>${b ? '<w:b/><w:bCs/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="pl-PL"/></w:rPr>`;
  return parts.map((p, i) => `<w:r>${rpr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEsc(p)}</w:t></w:r>`).join('');
}
function wPara(runs, { align = null, before = 0, after = 0, bullet = false } = {}) {
  const ind = bullet ? '<w:ind w:left="284" w:hanging="284"/>' : '';
  return `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}" w:line="264" w:lineRule="auto"/>${ind}${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>${runs}</w:p>`;
}
function wCellParas(cell) {
  return cell.map((p) => {
    const sz = SZ[p.size || 'm'];
    const runs = (p.bullet ? wRun('•\t', { sz }) : '') + (p.label ? wRun(p.label, { b: true, sz }) : '') + wRun(p.t, { b: !!p.b, sz });
    return wPara(runs, { before: p.gap ? 100 : 0, bullet: p.bullet });
  }).join('') || '<w:p/>';
}
function wCell(width, inner, { span = 1, fill = null } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>${inner}</w:tc>`;
}
const TBL_BORDERS = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((e) => `<w:${e} w:val="single" w:sz="4" w:space="0" w:color="3C4A50"/>`).join('') + '</w:tblBorders>';
const TBL_MAR = '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tblCellMar>';

function renderDocxBody(model) {
  const usable = 9864;
  let body = '';
  if (model.dateLine) body += wPara(wRun(model.dateLine, { sz: 21 }), { align: 'right', after: 200 });
  body += wPara(wRun(model.title, { b: true, sz: 30, color: '0E1F26' }), { align: 'center', after: model.subtitle ? 40 : 200 });
  if (model.subtitle) body += wPara(wRun(model.subtitle, { b: true, sz: 19, color: 'A63A2B' }), { align: 'center', after: 160 });
  if (model.watermark) body += wPara(wRun(`[${model.watermark}]`, { b: true, sz: 19, color: 'A63A2B' }), { align: 'center', after: 160 });
  const kvMode = model.rows.some((r) => r.kind === 'kv');
  const grid = kvMode ? [3400, usable - 3400] : [usable / 2, usable / 2];
  let rows = '';
  for (const r of model.rows) {
    if (r.kind === 'pair') rows += `<w:tr>${wCell(grid[0], wCellParas(r.cells[0]))}${wCell(grid[1], wCellParas(r.cells[1]))}</w:tr>`;
    else if (r.kind === 'kv') rows += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${wCell(grid[0], wCellParas([{ t: r.label, b: true }]), { fill: 'F1F4F3' })}${wCell(grid[1], wCellParas(r.cell))}</w:tr>`;
    else rows += `<w:tr>${wCell(usable, wCellParas(r.cell), { span: 2 })}</w:tr>`;
  }
  body += `<w:tbl><w:tblPr><w:tblW w:w="${usable}" w:type="dxa"/><w:jc w:val="center"/>${TBL_BORDERS}<w:tblLayout w:type="fixed"/>${TBL_MAR}</w:tblPr><w:tblGrid><w:gridCol w:w="${grid[0]}"/><w:gridCol w:w="${grid[1]}"/></w:tblGrid>${rows}</w:tbl>`;
  body += wPara('', { after: 240 });
  const sig = (label) => (model.dateLine ? '' : wPara(wRun(model.placeDate, { sz: 21 }), { after: 600 })) + wPara('', { after: 500 })
    + wPara(wRun('.'.repeat(60), { sz: 16, color: '84959B' }), { align: 'center' }) + wPara(wRun(label, { sz: 16 }), { align: 'center' });
  body += `<w:tbl><w:tblPr><w:tblW w:w="${usable}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${usable / 2}"/><w:gridCol w:w="${usable / 2}"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/></w:trPr>${model.signatures.map((l) => wCell(usable / 2, sig(l))).join('')}</w:tr></w:tbl>`;
  return body;
}

function renderDocx(model) {
  const files = fflate.unzipSync(b64ToBytes(ASSETS.letterhead));
  const xml = fflate.strFromU8(files['word/document.xml']);
  const start = xml.indexOf('<w:body>') + '<w:body>'.length;
  const sectAt = xml.lastIndexOf('<w:sectPr');
  let sect = xml.slice(sectAt, xml.indexOf('</w:body>'));
  sect = sect.replace(/<w:pgMar [^>]*\/>/, '<w:pgMar w:top="1985" w:right="1021" w:bottom="1361" w:left="1021" w:header="0" w:footer="709" w:gutter="0"/>');
  const out = xml.slice(0, start) + renderDocxBody(model) + sect + xml.slice(xml.indexOf('</w:body>'));
  files['word/document.xml'] = fflate.strToU8(out);
  if (files['docProps/core.xml']) {
    let core = fflate.strFromU8(files['docProps/core.xml']);
    core = core.replace(/<dc:title>[^<]*<\/dc:title>|<dc:title\/>/, '').replace('</cp:coreProperties>', `<dc:title>${xmlEsc(model.title)}</dc:title></cp:coreProperties>`);
    files['docProps/core.xml'] = fflate.strToU8(core);
  }
  const zipped = fflate.zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// --- Podgląd HTML (papier A4 na żywo) --------------------------------------------------------
function renderPaper(model) {
  const para = (p) => h('p', { class: `pp sz-${p.size || 'm'}${p.b ? ' b' : ''}${p.bullet ? ' bullet' : ''}${p.gap ? ' gap' : ''}`, dataset: p.field ? { f: p.field } : undefined },
    p.label ? h('strong', {}, p.label) : null, p.t);
  const cell = (c, attrs = {}) => h('td', attrs, c.map(para));
  const rows = model.rows.map((r) => (r.kind === 'pair' ? h('tr', {}, cell(r.cells[0]), cell(r.cells[1]))
    : r.kind === 'kv' ? h('tr', {}, h('th', { scope: 'row' }, r.label), cell(r.cell))
      : h('tr', {}, cell(r.cell, { colspan: 2 }))));
  const kvMode = model.rows.some((r) => r.kind === 'kv');
  return h('article', { class: 'paper', 'aria-label': 'Podgląd dokumentu' },
    h('img', { class: 'paper-head', src: `data:image/jpeg;base64,${ASSETS.header}`, alt: '' }),
    model.watermark ? h('div', { class: 'paper-wm', 'aria-hidden': 'true' }, model.watermark) : null,
    h('div', { class: 'paper-body' },
      model.dateLine ? h('p', { class: 'paper-date', dataset: { f: 'issue_date' } }, model.dateLine) : null,
      h('h2', { class: 'paper-title' }, model.title),
      model.subtitle ? h('p', { class: 'paper-sub' }, model.subtitle) : null,
      h('table', { class: `paper-table${kvMode ? ' kv' : ''}` }, h('tbody', {}, rows)),
      h('div', { class: 'paper-sign' }, model.signatures.map((l) => h('div', {},
        model.dateLine ? null : h('p', { dataset: { f: 'issue_date' } }, model.placeDate), h('span', { class: 'dots' }), h('small', {}, l))))),
    h('footer', { class: 'paper-foot' }, h('div', {}, model.footer.map((l, i) => h('p', { class: i ? '' : 'b' }, l))), h('div', { class: 'paper-www' }, model.website)));
}

async function exportDoc(doc, fmt) {
  const model = buildDocModel(doc);
  const blob = fmt === 'pdf' ? renderPdf(model) : renderDocx(model);
  const name = `${model.fileStem}.${fmt}`;
  downloadBlob(blob, name);
  if (doc.status !== 'draft') {
    await Store.commit(() => null, { action: 'export', entity: doc.type, entityId: doc.id, summary: `Pobrano ${fmt.toUpperCase()}: ${name}` });
  }
  return name;
}
