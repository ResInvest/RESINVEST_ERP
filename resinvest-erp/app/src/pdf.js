/* =========================================================================
   Warstwa P: generator dokumentów — ten sam model treści daje
   * PDF (prawdziwy dokument: tekst wektorowy, osadzona czcionka z polskimi
     znakami, warstwa tekstowa do wyszukiwania i kopiowania),
   * HTML do wydruku (DRUKUJ).
   Bez bibliotek zewnętrznych. Działa w przeglądarce i w Node (testy).

   Model dokumentu:
   { title, subtitle, number, orientation: "portrait" | "landscape",
     meta: [[etykieta, wartość], …], generatedAt, generatedBy, system,
     blocks: [ { type: "h", text } | { type: "p", text, muted } |
               { type: "kv", rows: [[k, v], …], cols: 2 } |
               { type: "table", columns: [{ label, w, align }], rows: [[…]], foot: […], bold: [indeksy wierszy], note } |
               { type: "kpis", items: [[etykieta, wartość, opis], …] } |
               { type: "signatures", labels: […] } | { type: "space", h } ] }
   ========================================================================= */
(function (root) {
  "use strict";

  const MM = 72 / 25.4;
  const SIZES = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] };
  const C = {
    ink: [0.09, 0.13, 0.11], muted: [0.36, 0.42, 0.39], line: [0.8, 0.84, 0.82], brand: [0.118, 0.42, 0.271],
    brandLight: [0.91, 0.95, 0.925], zebra: [0.972, 0.98, 0.975], err: [0.7, 0.13, 0.13], white: [1, 1, 1]
  };
  const SPACE_LIKE = /[\u00A0\u2007\u2009\u202F\u2002\u2003]/;

  function b64ToBytes(b64) {
    if (typeof atob === "function") { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const num = n => { const r = Math.round(n * 1000) / 1000; return (Object.is(r, -0) ? 0 : r).toString(); };
  const hex4 = n => n.toString(16).padStart(4, "0").toUpperCase();
  function utf16hex(s, bom = true) { let h = bom ? "FEFF" : ""; for (const ch of String(s)) { const c = ch.codePointAt(0); if (c > 0xFFFF) { const v = c - 0x10000; h += hex4(0xD800 + (v >> 10)) + hex4(0xDC00 + (v & 0x3FF)); } else h += hex4(c); } return `<${h}>`; }

  /* ------------------------------------------------------------------ */
  /* Czcionka                                                            */
  /* ------------------------------------------------------------------ */
  class Font {
    constructor(key, m) {
      this.key = key; this.m = m; this.used = new Map();         // gid → znak (ToUnicode)
      this.scale = 1000 / m.unitsPerEm;
      this.qGid = m.cmap["63"] || 0;
    }
    gid(ch) {
      let c = ch.codePointAt(0);
      if (SPACE_LIKE.test(ch)) c = 32;
      const g = this.m.cmap[String(c)];
      return g === undefined ? this.qGid : g;
    }
    width(s, size) { let w = 0; for (const ch of String(s)) w += this.m.widths[this.gid(ch)] || 0; return w * this.scale * size / 1000; }
    encode(s) {
      let h = "";
      for (const ch of String(s)) { const g = this.gid(ch); if (!this.used.has(g)) this.used.set(g, SPACE_LIKE.test(ch) ? " " : ch); h += hex4(g); }
      return `<${h}>`;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Dokument PDF (niski poziom)                                         */
  /* ------------------------------------------------------------------ */
  class Doc {
    constructor(opts = {}) {
      const fonts = opts.fonts || root.RIW_FONTS;
      if (!fonts || !fonts.regular || !fonts.bold) throw new Error("Brak czcionek PDF (RIW_FONTS)");
      this.fontsSrc = fonts;
      this.fonts = { R: new Font("R", fonts.regular), B: new Font("B", fonts.bold) };
      [this.W, this.H] = SIZES[opts.orientation === "landscape" ? "landscape" : "portrait"];
      this.info = { title: opts.title || "", author: opts.author || "", subject: opts.subject || "" };
      this.locale = /^[a-z]{2}-[A-Z]{2}$/.test(opts.locale || "") ? opts.locale : "pl-PL";
      this.pages = [];
      this.addPage();
    }
    addPage() { this.page = { ops: [] }; this.pages.push(this.page); return this.page; }
    op(s) { this.page.ops.push(s); }
    color(c, stroke) { return `${num(c[0])} ${num(c[1])} ${num(c[2])} ${stroke ? "RG" : "rg"}`; }
    width(s, font = "R", size = 9) { return this.fonts[font].width(s, size); }
    text(x, y, s, o = {}) {
      const font = this.fonts[o.font || "R"], size = o.size || 9;
      s = String(s == null ? "" : s);
      if (o.maxWidth && font.width(s, size) > o.maxWidth) { while (s.length > 1 && font.width(s + "…", size) > o.maxWidth) s = s.slice(0, -1); s += "…"; }
      const w = font.width(s, size);
      const xx = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
      this.op(`BT /F${font.key} ${num(size)} Tf ${this.color(o.color || C.ink)} ${num(xx)} ${num(this.H - y)} Td ${font.encode(s)} Tj ET`);
      return w;
    }
    wrap(s, font = "R", size = 9, maxW = 100) {
      const out = [];
      for (const para of String(s == null ? "" : s).split("\n")) {
        const words = para.split(/ +/);
        let line = "";
        for (const w of words) {
          const t = line ? line + " " + w : w;
          if (this.width(t, font, size) <= maxW || !line) line = t;
          else { out.push(line); line = w; }
          while (this.width(line, font, size) > maxW && line.length > 1) {         // bardzo długie słowo
            let cut = line.length - 1;
            while (cut > 1 && this.width(line.slice(0, cut), font, size) > maxW) cut--;
            out.push(line.slice(0, cut)); line = line.slice(cut);
          }
        }
        out.push(line);
      }
      return out;
    }
    line(x1, y1, x2, y2, o = {}) { this.op(`${this.color(o.color || C.line, true)} ${num(o.width || 0.6)} w ${num(x1)} ${num(this.H - y1)} m ${num(x2)} ${num(this.H - y2)} l S`); }
    rect(x, y, w, h, o = {}) {
      const p = `${num(x)} ${num(this.H - y - h)} ${num(w)} ${num(h)} re`;
      if (o.fill && o.stroke) this.op(`${this.color(o.fill)} ${this.color(o.stroke, true)} ${num(o.width || 0.6)} w ${p} B`);
      else if (o.fill) this.op(`${this.color(o.fill)} ${p} f`);
      else this.op(`${this.color(o.stroke || C.line, true)} ${num(o.width || 0.6)} w ${p} S`);
    }

    output() {
      const objs = [];                 // [ {str} | {head, bin} ]
      const add = o => { objs.push(o); return objs.length; };
      const catalog = add(null), pagesId = add(null);
      const fontIds = {};
      for (const k of ["R", "B"]) fontIds[k] = this.fontObjects(k, add);
      const kids = [];
      for (const p of this.pages) {
        const content = p.ops.join("\n");
        const cId = add({ str: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` });
        kids.push(add({ str: `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.W)} ${num(this.H)}] /Resources << /Font << /FR ${fontIds.R} 0 R /FB ${fontIds.B} 0 R >> >> /Contents ${cId} 0 R >>` }));
      }
      objs[catalog - 1] = { str: `<< /Type /Catalog /Pages ${pagesId} 0 R /Lang (${this.locale || "pl-PL"}) >>` };
      objs[pagesId - 1] = { str: `<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>` };
      const now = new Date(), pad = n => String(n).padStart(2, "0");
      const d = `D:${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
      const infoId = add({ str: `<< /Title ${utf16hex(this.info.title)} /Author ${utf16hex(this.info.author)} /Subject ${utf16hex(this.info.subject)} /Producer ${utf16hex("ResInvest ERP — generator PDF")} /CreationDate (${d}) >>` });

      const chunks = [], offsets = [];
      let len = 0;
      const push = x => { const b = typeof x === "string" ? latin1(x) : x; chunks.push(b); len += b.length; };
      push("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
      objs.forEach((o, i) => {
        offsets.push(len);
        if (o.bin) { push(`${i + 1} 0 obj\n${o.head}\nstream\n`); push(o.bin); push("\nendstream\nendobj\n"); }
        else push(`${i + 1} 0 obj\n${o.str}\nendobj\n`);
      });
      const xref = len;
      push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join(""));
      push(`trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      const out = new Uint8Array(len);
      let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
      return out;
    }
    fontObjects(k, add) {
      const f = this.fonts[k], m = f.m, src = this.fontsSrc[k === "R" ? "regular" : "bold"];
      const data = b64ToBytes(src.data);
      const fileId = add({ head: `<< /Length ${data.length} /Length1 ${src.length} /Filter /FlateDecode >>`, bin: data });
      const sc = v => Math.round(v * f.scale);
      const desc = add({ str: `<< /Type /FontDescriptor /FontName /${m.name} /Flags 32 /FontBBox [${m.bbox.map(sc).join(" ")}] /ItalicAngle 0 /Ascent ${sc(m.ascent)} /Descent ${sc(m.descent)} /CapHeight ${sc(m.capHeight)} /StemV ${k === "B" ? 120 : 80} /FontFile2 ${fileId} 0 R >>` });
      const gids = [...f.used.keys()].sort((a, b) => a - b);
      const W = gids.map(g => `${g} [${Math.round(m.widths[g] * f.scale)}]`).join(" ");
      const cid = add({ str: `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${m.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /CIDToGIDMap /Identity /DW 500 /W [${W}] >>` });
      const bf = gids.map(g => `<${hex4(g)}> ${utf16hex(f.used.get(g), false)}`);
      const blocks = [];
      for (let i = 0; i < bf.length; i += 100) blocks.push(`${Math.min(100, bf.length - i)} beginbfchar\n${bf.slice(i, i + 100).join("\n")}\nendbfchar`);
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join("\n")}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      const tu = add({ str: `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream` });
      return add({ str: `<< /Type /Font /Subtype /Type0 /BaseFont /${m.name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>` });
    }
  }
  function latin1(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xFF; return u; }

  /* ------------------------------------------------------------------ */
  /* Teksty stałe dokumentu w bieżącym języku (i18n.js)                   */
  /* ------------------------------------------------------------------ */
  function labels() {
    const I = root.RIW_I18N, t = (s, p) => I ? I.t(s, p) : s.replace(/\{(\w+)\}/g, (m, k) => p && p[k] !== undefined ? p[k] : m);
    return {
      tagline: t("ResInvest Commodities · biomasa"), no: t("Nr {no}"), generated: t("Wygenerowano: {d}"), by: t("przez: {u}"), page: t("Strona {a} z {b}"),
      empty: t("Brak danych w wybranym okresie."), alarm: [t("NIESPÓJNY"), t("BRAK WYCENY"), t("ANULOWANY")], locale: I ? I.info().locale : "pl-PL", lang: I ? I.lang : "pl"
    };
  }
  const fillL = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => p[k] !== undefined ? p[k] : m);
  const alarmOf = L => v => typeof v === "string" && L.alarm.some(x => v.startsWith(x));

  /* ------------------------------------------------------------------ */
  /* Układ dokumentu firmowego (nagłówek, stopka, bloki)                 */
  /* ------------------------------------------------------------------ */
  function render(model) {
    const L = model.labels || labels();
    const doc = new Doc({ orientation: model.orientation, title: model.title, author: model.generatedBy || "", subject: model.subtitle || "", locale: L.locale });
    const M = 14 * MM, W = doc.W, H = doc.H, CW = W - 2 * M, TOP = 30 * MM, BOTTOM = H - 16 * MM;
    let y = 0;
    const header = () => {
      doc.rect(M, 10 * MM, 9 * MM, 9 * MM, { fill: C.brand });
      doc.text(M + 4.5 * MM, 16.2 * MM, "RiC", { font: "B", size: 9, color: C.white, align: "center" });
      doc.text(M + 12 * MM, 13.6 * MM, model.system || "ResInvest ERP", { font: "B", size: 11, color: C.brand });
      doc.text(M + 12 * MM, 18.2 * MM, L.tagline, { size: 7.5, color: C.muted });
      doc.text(W - M, 13.6 * MM, model.number ? fillL(L.no, { no: model.number }) : "", { font: "B", size: 9, align: "right" });
      doc.text(W - M, 18.2 * MM, model.headerRight || "", { size: 7.5, color: C.muted, align: "right" });
      doc.line(M, 22 * MM, W - M, 22 * MM, { color: C.brand, width: 1.2 });
      y = TOP;
    };
    const newPage = () => { doc.addPage(); header(); };
    const need = h => { if (y + h > BOTTOM) newPage(); };
    header();

    doc.text(M, y, model.title, { font: "B", size: 16 }); y += 7 * MM;
    if (model.subtitle) { for (const l of doc.wrap(model.subtitle, "R", 10, CW)) { doc.text(M, y, l, { size: 10, color: C.muted }); y += 5 * MM; } }
    if (model.meta && model.meta.length) {
      y += 1 * MM;
      const colW = CW / 2, lh = 4.6 * MM;
      model.meta.forEach(([k, v], i) => {
        const cx = M + (i % 2) * colW, cy = y + Math.floor(i / 2) * lh;
        doc.text(cx, cy, k + ":", { size: 8, color: C.muted });
        doc.text(cx + 34 * MM, cy, v, { font: "B", size: 8.5, maxWidth: colW - 36 * MM });
      });
      y += Math.ceil(model.meta.length / 2) * lh + 2 * MM;
    }

    for (const b of model.blocks || []) {
      if (b.type === "space") { y += (b.h || 4) * MM; continue; }
      if (b.type === "h") {
        need(14 * MM);
        y += 3 * MM;
        doc.text(M, y, b.text, { font: "B", size: 11.5, color: C.brand });
        y += 2 * MM; doc.line(M, y, M + CW, y, { color: C.line }); y += 4.5 * MM;
        continue;
      }
      if (b.type === "p") {
        for (const l of doc.wrap(b.text, b.bold ? "B" : "R", b.size || 9, CW)) { need(5 * MM); doc.text(M, y, l, { size: b.size || 9, font: b.bold ? "B" : "R", color: b.muted ? C.muted : b.error ? C.err : C.ink }); y += 4.4 * MM; }
        y += 1.5 * MM; continue;
      }
      if (b.type === "kpis") {
        const n = Math.min(b.items.length, doc.W > doc.H ? 6 : 4), gap = 3 * MM, bw = (CW - gap * (n - 1)) / n, bh = 17 * MM;
        for (let i = 0; i < b.items.length; i += n) {
          need(bh + 3 * MM);
          b.items.slice(i, i + n).forEach(([k, v, s], j) => {
            const x = M + j * (bw + gap);
            doc.rect(x, y, bw, bh, { fill: C.zebra, stroke: C.line, width: 0.5 });
            doc.text(x + 3 * MM, y + 5 * MM, k, { size: 7.5, color: C.muted, maxWidth: bw - 6 * MM });
            doc.text(x + 3 * MM, y + 11 * MM, v, { font: "B", size: 12, maxWidth: bw - 6 * MM });
            if (s) doc.text(x + 3 * MM, y + 15 * MM, s, { size: 7, color: C.muted, maxWidth: bw - 6 * MM });
          });
          y += bh + 3 * MM;
        }
        continue;
      }
      if (b.type === "kv") {
        const cols = b.cols || 2, colW = CW / cols, lh = 5 * MM;
        const rows = Math.ceil(b.rows.length / cols);
        for (let r = 0; r < rows; r++) {
          need(lh);
          for (let c = 0; c < cols; c++) {
            const it = b.rows[r + c * rows]; if (!it) continue;
            const x = M + c * colW;
            doc.text(x, y, it[0], { size: 8.5, color: C.muted, maxWidth: colW * 0.45 });
            doc.text(x + colW * 0.46, y, it[1], { size: 9, font: "B", maxWidth: colW * 0.52 });
          }
          y += lh;
        }
        y += 2 * MM; continue;
      }
      if (b.type === "table") { y = table(doc, b, M, CW, y, BOTTOM, newPage, L); continue; }
      if (b.type === "signatures") {
        need(26 * MM);
        y += 14 * MM;
        const n = b.labels.length, gap = 10 * MM, sw = (CW - gap * (n - 1)) / n;
        b.labels.forEach((l, i) => { const x = M + i * (sw + gap); doc.line(x, y, x + sw, y, { color: C.ink, width: 0.5 }); doc.text(x + sw / 2, y + 4 * MM, l, { size: 8, color: C.muted, align: "center" }); });
        y += 10 * MM; continue;
      }
    }
    // stopka z numeracją stron (znana dopiero po złożeniu całości)
    const total = doc.pages.length;
    doc.pages.forEach((p, i) => {
      doc.page = p;
      doc.line(M, H - 11 * MM, W - M, H - 11 * MM, { color: C.line });
      const left = [model.generatedAt ? fillL(L.generated, { d: model.generatedAt }) : "", model.generatedBy ? fillL(L.by, { u: model.generatedBy }) : "", model.footerNote || ""].filter(Boolean).join(" · ");
      doc.text(M, H - 7 * MM, left, { size: 7, color: C.muted, maxWidth: CW - 30 * MM });
      doc.text(W - M, H - 7 * MM, fillL(L.page, { a: i + 1, b: total }), { size: 7, color: C.muted, align: "right" });
    });
    return doc.output();
  }

  function table(doc, b, M, CW, y0, BOTTOM, newPage, L) {
    const isAlarm = alarmOf(L);
    const MMu = MM, size = b.size || 7.8, pad = 1.6 * MMu, lh = size * 1.28;
    const tw = b.columns.reduce((a, c) => a + (c.w || 1), 0);
    const cols = b.columns.map(c => Object.assign({}, c, { width: CW * (c.w || 1) / tw }));
    let y = y0;
    const drawHead = () => {
      const lines = cols.map(c => doc.wrap(c.label, "B", size, c.width - 2 * pad));
      const h = Math.max(...lines.map(l => l.length)) * lh + 2 * pad;
      doc.rect(M, y, CW, h, { fill: C.brandLight });
      let x = M;
      cols.forEach((c, i) => { lines[i].forEach((l, j) => doc.text(c.align === "right" ? x + c.width - pad : x + pad, y + pad + (j + 0.78) * lh, l, { font: "B", size, align: c.align === "right" ? "right" : "left", color: C.brand })); x += c.width; });
      y += h;
      doc.line(M, y, M + CW, y, { color: C.brand, width: 0.8 });
    };
    if (y + 20 * MMu > BOTTOM) { newPage(); y = 30 * MMu; }
    drawHead();
    const all = b.rows.map(r => ({ cells: r, bold: false })).concat(b.foot ? [{ cells: b.foot, bold: true, foot: true }] : []);
    if (!b.rows.length) all.unshift({ cells: [b.empty || L.empty], span: true });
    all.forEach((row, ri) => {
      const isBold = row.bold || (b.bold && b.bold.includes(ri));
      const lines = row.span ? [[String(row.cells[0])]] : cols.map((c, i) => doc.wrap(row.cells[i] == null ? "" : String(row.cells[i]), isBold ? "B" : "R", size, c.width - 2 * pad));
      const h = Math.max(...lines.map(l => l.length)) * lh + 2 * pad;
      if (y + h > BOTTOM) { newPage(); y = 30 * MMu; drawHead(); }
      if (row.foot) doc.rect(M, y, CW, h, { fill: C.brandLight });
      else if (ri % 2 === 1) doc.rect(M, y, CW, h, { fill: C.zebra });
      let x = M;
      if (row.span) doc.text(M + pad, y + pad + 0.78 * lh, lines[0][0], { size, color: C.muted });
      else cols.forEach((c, i) => {
        const red = isAlarm(row.cells[i]);
        lines[i].forEach((l, j) => doc.text(c.align === "right" ? x + c.width - pad : x + pad, y + pad + (j + 0.78) * lh, l, { font: isBold ? "B" : "R", size, align: c.align === "right" ? "right" : "left", color: red ? C.err : C.ink }));
        x += c.width;
      });
      y += h;
      doc.line(M, y, M + CW, y, { color: C.line, width: 0.4 });
    });
    if (b.note) { y += 1.5 * MMu; for (const l of doc.wrap(b.note, "R", 7.5, CW)) { if (y + 4 * MMu > BOTTOM) { newPage(); y = 30 * MMu; } doc.text(M, y + 2.6 * MMu, l, { size: 7.5, color: C.muted }); y += 3.8 * MMu; } }
    return y + 3 * MMu;
  }

  /* ------------------------------------------------------------------ */
  /* Ten sam model jako HTML do wydruku                                  */
  /* ------------------------------------------------------------------ */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function toHTML(model) {
    const L = model.labels || labels(), isAlarm = alarmOf(L);
    const parts = [];
    for (const b of model.blocks || []) {
      if (b.type === "h") parts.push(`<h2>${esc(b.text)}</h2>`);
      else if (b.type === "p") parts.push(`<p class="${b.muted ? "muted" : ""}${b.error ? " err" : ""}${b.bold ? " b" : ""}">${esc(b.text).replace(/\n/g, "<br>")}</p>`);
      else if (b.type === "space") parts.push(`<div style="height:${(b.h || 4)}mm"></div>`);
      else if (b.type === "kpis") parts.push(`<div class="kpis">${b.items.map(([k, v, s]) => `<div class="kpi"><small>${esc(k)}</small><b>${esc(v)}</b>${s ? `<small>${esc(s)}</small>` : ""}</div>`).join("")}</div>`);
      else if (b.type === "kv") parts.push(`<table class="kv">${b.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`);
      else if (b.type === "table") parts.push(`<table class="t"><thead><tr>${b.columns.map(c => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${b.rows.length ? b.rows.map((r, i) => `<tr class="${b.bold && b.bold.includes(i) ? "b" : ""}">${r.map((v, j) => `<td class="${b.columns[j].align === "right" ? "r" : ""}${isAlarm(String(v)) ? " err" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${b.columns.length}" class="muted">${esc(b.empty || L.empty)}</td></tr>`}</tbody>${b.foot ? `<tfoot><tr>${b.foot.map((v, j) => `<td class="${b.columns[j].align === "right" ? "r" : ""}">${esc(v)}</td>`).join("")}</tr></tfoot>` : ""}</table>${b.note ? `<p class="muted small">${esc(b.note)}</p>` : ""}`);
      else if (b.type === "signatures") parts.push(`<div class="sig">${b.labels.map(l => `<div><span></span><small>${esc(l)}</small></div>`).join("")}</div>`);
    }
    const css = `@page{size:A4 ${model.orientation === "landscape" ? "landscape" : "portrait"};margin:14mm}
      body{font:10px/1.35 Arial,"Liberation Sans",sans-serif;color:#17211c;margin:0}
      .hd{display:flex;align-items:center;gap:10px;border-bottom:2px solid #1E6B45;padding-bottom:6px;margin-bottom:10px}
      .mk{width:30px;height:30px;background:#1E6B45;color:#fff;font-weight:700;display:grid;place-items:center;font-size:11px;letter-spacing:-.01em}
      .hd b{color:#1E6B45;font-size:14px}.hd .r{margin-left:auto;text-align:right}
      h1{font-size:20px;margin:6px 0 2px}h2{font-size:13px;color:#1E6B45;border-bottom:1px solid #ccd6d1;padding-bottom:2px;margin:14px 0 6px}
      .muted{color:#5c6b64}.small{font-size:9px}.err{color:#b32121;font-weight:700}.b td,.b{font-weight:700}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin:8px 0}.meta span{color:#5c6b64}
      table{border-collapse:collapse;width:100%;margin:4px 0}th,td{padding:3px 5px;border-bottom:1px solid #dde4e0;text-align:left;vertical-align:top}
      .t thead th{background:#e8f2ec;color:#1E6B45}.t tbody tr:nth-child(even){background:#f8faf9}.t tfoot td{background:#e8f2ec;font-weight:700}
      .r{text-align:right;white-space:nowrap}.kv th{width:38%;color:#5c6b64;font-weight:400}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.kpi{border:1px solid #ccd6d1;background:#f8faf9;padding:6px}.kpi b{display:block;font-size:14px}.kpi small{display:block;color:#5c6b64}
      .sig{display:flex;gap:30px;margin-top:40px}.sig div{flex:1;text-align:center}.sig span{display:block;border-top:1px solid #17211c;margin-bottom:3px}
      .ft{margin-top:16px;border-top:1px solid #ccd6d1;padding-top:4px;color:#5c6b64;font-size:8.5px}
      thead{display:table-header-group}tr{break-inside:avoid}`;
    return `<!DOCTYPE html><html lang="${esc(L.lang)}"><head><meta charset="utf-8"><title>${esc(model.title)}${model.number ? " " + esc(model.number) : ""}</title><style>${css}<\/style></head><body>
      <div class="hd"><div class="mk">RiC</div><div><b>${esc(model.system || "ResInvest ERP")}</b><div class="muted small">${esc(L.tagline)}</div></div><div class="r">${model.number ? `<b>${esc(fillL(L.no, { no: model.number }))}</b>` : ""}<div class="muted small">${esc(model.headerRight || "")}</div></div></div>
      <h1>${esc(model.title)}</h1>${model.subtitle ? `<div class="muted">${esc(model.subtitle)}</div>` : ""}
      ${model.meta && model.meta.length ? `<div class="meta">${model.meta.map(([k, v]) => `<div><span>${esc(k)}:</span> <b>${esc(v)}</b></div>`).join("")}</div>` : ""}
      ${parts.join("\n")}
      <div class="ft">${esc([model.generatedAt ? fillL(L.generated, { d: model.generatedAt }) : "", model.generatedBy ? fillL(L.by, { u: model.generatedBy }) : "", model.footerNote || ""].filter(Boolean).join(" · "))}</div>
      <\/body><\/html>`;
  }

  root.RIW_PDF = { Doc, render, toHTML, labels, MM };
  if (typeof module !== "undefined" && module.exports) module.exports = root.RIW_PDF;
})(typeof globalThis !== "undefined" ? globalThis : this);
