/* =========================================================================
   ResInvest ERP 3.4 — eksport XLSX i DOCX (Office Open XML) bez bibliotek zewnętrznych
   * działa offline (jeden plik HTML) i w Node (testy): wejście = dane, wyjście = Uint8Array,
   * archiwum ZIP bez kompresji (metoda STORE) + CRC-32 — format czytany przez Excel, LibreOffice,
     Word i Google Docs,
   * XLSX: arkusze z nagłówkiem (pogrubiony, zablokowany wiersz), liczby jako liczby (nie tekst),
   * DOCX: ten sam model dokumentu co wydruk i PDF (bloki kv / h / p / table / signatures).
   ========================================================================= */
(function (root) {
  "use strict";

  const enc = s => new TextEncoder().encode(s);
  const xml = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    // znaki sterujące są niedozwolone w XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  /* ------------------------------------------------------------------ */
  /* ZIP (STORE) + CRC-32                                                */
  /* ------------------------------------------------------------------ */
  const CRC_TABLE = (() => {
    const tb = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; }
    return tb;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /** Data i godzina w formacie DOS (pola nagłówka ZIP). */
  function dosTime(d) {
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }
  /** files: [{ name, data: string | Uint8Array }] → Uint8Array (ZIP). */
  function zip(files, when) {
    const dt = dosTime(when || new Date());
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc(f.name), data = typeof f.data === "string" ? enc(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dt.time, true); h.setUint16(12, dt.date, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dt.time, true); c.setUint16(14, dt.date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* XLSX                                                                */
  /* ------------------------------------------------------------------ */
  function colName(i) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetName(n, used) {
    let s = String(n || "Arkusz").replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Arkusz", base = s, k = 2;
    while (used.has(s.toLowerCase())) { const suf = ` (${k++})`; s = base.slice(0, 31 - suf.length) + suf; }
    used.add(s.toLowerCase());
    return s;
  }
  /** Komórka: liczba skończona → typ liczbowy; reszta → tekst (inline string). Styl 1 = nagłówek pogrubiony. */
  function cell(ref, v, style) {
    const st = style ? ` s="${style}"` : "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    if (v === null || v === undefined || v === "") return style ? `<c r="${ref}"${st}/>` : "";
    return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  }
  /**
   * sheets: [{ name, title?, columns: [label], rows: [[value]], widths?: [number] }] → Uint8Array (.xlsx).
   * Opcjonalny wiersz tytułu nad nagłówkiem; nagłówek pogrubiony i zablokowany przy przewijaniu.
   */
  function xlsx(sheets, meta = {}) {
    const used = new Set();
    const list = (sheets && sheets.length ? sheets : [{ name: "Arkusz", columns: [], rows: [] }]).map(sh => Object.assign({}, sh, { safe: sheetName(sh.name, used) }));
    const files = [];
    files.push({ name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${list.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` });
    files.push({ name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` });
    files.push({ name: "docProps/core.xml", data: coreXml(meta) });
    files.push({ name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${xml(s.safe)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` });
    files.push({ name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
    files.push({ name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EFE8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><bottom style="thin"><color rgb="FF8AA597"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><\/styleSheet>` });
    list.forEach((sh, i) => {
      const cols = sh.columns || [], rows = sh.rows || [];
      const width = sh.widths || cols.map((c, j) => Math.min(60, Math.max(8, String(c).length + 2, ...rows.slice(0, 500).map(r => String(r[j] == null ? "" : r[j]).length + 2))));
      let r = 1;
      const out = [];
      if (sh.title) { out.push(`<row r="${r}">${cell("A" + r, sh.title, 2)}</row>`); r++; if (sh.subtitle) { out.push(`<row r="${r}">${cell("A" + r, sh.subtitle)}</row>`); r++; } r++; }
      const headRow = r;
      if (cols.length) { out.push(`<row r="${r}">${cols.map((c, j) => cell(colName(j) + r, c, 1)).join("")}</row>`); r++; }
      for (const row of rows) { out.push(`<row r="${r}">${row.map((v, j) => cell(colName(j) + r, v)).join("")}</row>`); r++; }
      const pane = cols.length ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
      files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${width.length ? `<cols>${width.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : ""}<sheetData>${out.join("")}</sheetData>${cols.length && rows.length ? `<autoFilter ref="A${headRow}:${colName(cols.length - 1)}${headRow + rows.length}"/>` : ""}</worksheet>` });
    });
    return zip(files);
  }

  function coreXml(meta) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(meta.title || "")}</dc:title><dc:creator>${xml(meta.author || "ResInvest ERP")}</dc:creator><cp:lastModifiedBy>${xml(meta.author || "ResInvest ERP")}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  }

  /* ------------------------------------------------------------------ */
  /* DOCX — model dokumentu: { title, number, headerRight, blocks, generatedAt, generatedBy, system } */
  /* ------------------------------------------------------------------ */
  const run = (text, o = {}) => `<w:r><w:rPr>${o.b ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}${o.sz ? `<w:sz w:val="${o.sz}"/>` : ""}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  const para = (inner, o = {}) => `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ""}${o.align ? `<w:jc w:val="${o.align}"/>` : ""}<w:spacing w:before="${o.before || 0}" w:after="${o.after == null ? 80 : o.after}"/></w:pPr>${inner}</w:p>`;
  const TBL_BORDERS = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="8AA597"/><w:left w:val="single" w:sz="4" w:color="8AA597"/><w:bottom w:val="single" w:sz="4" w:color="8AA597"/><w:right w:val="single" w:sz="4" w:color="8AA597"/><w:insideH w:val="single" w:sz="4" w:color="C9D6CF"/><w:insideV w:val="single" w:sz="4" w:color="C9D6CF"/></w:tblBorders>`;
  const FULL = 9638;    // szerokość tekstu A4 (twipy) przy marginesach 2 cm
  function tc(text, w, o = {}) {
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ""}</w:tcPr>${para(run(text, { b: o.b, sz: 18 }), { align: o.align, after: 0 })}</w:tc>`;
  }
  function table(columns, rows, foot) {
    const total = columns.reduce((a, c) => a + (c.w || 1), 0);
    const ws = columns.map(c => Math.floor(FULL * (c.w || 1) / total));
    const al = c => c.align === "right" ? "right" : c.align === "center" ? "center" : "left";
    const tr = (cells, o) => `<w:tr>${o && o.head ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((v, i) => tc(v, ws[i], { b: o && o.b, fill: o && o.fill, align: al(columns[i]) })).join("")}</w:tr>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="${FULL}" w:type="dxa"/>${TBL_BORDERS}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${ws.map(w => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>
      ${tr(columns.map(c => c.label), { b: true, head: true, fill: "E3EFE8" })}${rows.map(r => tr(r.map(v => v == null ? "" : String(v)))).join("")}${foot ? tr(foot.map(v => v == null ? "" : String(v)), { b: true, fill: "F2F5F3" }) : ""}</w:tbl>${para("", { after: 120 })}`;
  }
  function kvTable(rows) {
    const w1 = Math.floor(FULL * 0.34), w2 = FULL - w1;
    return `<w:tbl><w:tblPr><w:tblW w:w="${FULL}" w:type="dxa"/>${TBL_BORDERS}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${w1}"/><w:gridCol w:w="${w2}"/></w:tblGrid>
      ${rows.map(([k, v]) => `<w:tr>${tc(k, w1, { b: true, fill: "F2F5F3" })}${tc(v, w2)}</w:tr>`).join("")}</w:tbl>${para("", { after: 120 })}`;
  }
  function docx(model) {
    const m = model || {}, body = [];
    body.push(para(run("ResInvest ERP", { b: true, color: "1E6B45", sz: 18 }) + (m.headerRight ? run("   ·   " + m.headerRight, { color: "5B6B63", sz: 18 }) : ""), { after: 60 }));
    body.push(para(run(m.title || "", { b: true, sz: 32 }), { after: 120 }));
    if (m.rangeText || m.number) body.push(para(run([m.number, m.rangeText].filter(Boolean).join(" · "), { color: "5B6B63", sz: 20 }), { after: 160 }));
    for (const b of m.blocks || []) {
      if (b.type === "kv") body.push(kvTable(b.rows || []));
      else if (b.type === "h") body.push(para(run(b.text, { b: true, sz: 24, color: "1E6B45" }), { before: 160, after: 80 }));
      else if (b.type === "p") body.push(para(run(b.text, { b: !!b.bold, color: b.muted ? "5B6B63" : undefined, sz: b.muted ? 18 : 20 })));
      else if (b.type === "table") { body.push(table(b.columns || [], b.rows || [], b.foot)); if (b.note) body.push(para(run(b.note, { color: "5B6B63", sz: 16 }))); }
      else if (b.type === "kpis" && Array.isArray(b.items)) body.push(kvTable(b.items.map(x => [x.label || x[0], x.value || x[1]])));
      else if (b.type === "signatures") {
        const labs = b.labels || [], w = Math.floor(FULL / Math.max(1, labs.length));
        body.push(para("", { before: 480, after: 0 }));
        body.push(`<w:tbl><w:tblPr><w:tblW w:w="${FULL}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${labs.map(() => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid><w:tr>${labs.map(l => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders><w:top w:val="single" w:sz="4" w:color="5B6B63"/></w:tcBorders></w:tcPr>${para(run(l, { color: "5B6B63", sz: 16 }), { align: "center", after: 0 })}</w:tc>`).join("")}</w:tr></w:tbl>`);
      }
    }
    const foot = [m.system, m.generatedAt, m.generatedBy].filter(Boolean).join(" · ");
    if (foot) body.push(para(run(foot, { color: "8AA597", sz: 14 }), { before: 240 }));
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
      { name: "docProps/core.xml", data: coreXml({ title: m.title, author: m.generatedBy }) },
      { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "word/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="20"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>` },
      { name: "word/document.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>` }
    ];
    return zip(files);
  }
  /** Model dokumentu (bloki) → arkusze XLSX: dane ogólne + każda tabela jako osobny arkusz. */
  function modelToSheets(model, labels) {
    const L = Object.assign({ data: "Dane", field: "Pole", value: "Wartość", table: "Tabela" }, labels || {});
    const sheets = [], kv = [];
    let n = 1;
    for (const b of (model && model.blocks) || []) {
      if (b.type === "kv") kv.push(...(b.rows || []));
      if (b.type === "table") sheets.push({ name: `${L.table} ${n++}`, title: model.title, columns: (b.columns || []).map(c => c.label), rows: (b.rows || []).concat(b.foot ? [b.foot] : []) });
    }
    return [{ name: L.data, title: model.title, subtitle: [model.number, model.rangeText].filter(Boolean).join(" · "), columns: [L.field, L.value], rows: kv }].concat(sheets);
  }

  const Office = { zip, crc32, xlsx, docx, modelToSheets, XLSX_MIME: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", DOCX_MIME: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  root.RIW_OFFICE = Office;
  if (typeof module !== "undefined" && module.exports) module.exports = Office;
})(typeof globalThis !== "undefined" ? globalThis : this);
