// @ts-check
/* =========================================================================
   ResInvest ERP — Skaner dokumentów (program próbny, jeden plik HTML)

   ZDJĘCIE → OCR w przeglądarce (Tesseract, bez internetu, bez kluczy) → POLA → korekta → historia testów.
   Logika walidacji, typów dokumentów i dopasowania kartotek jest wspólna z modułem
   AI Document Scanner Test (src/*.mjs). Nic nie jest zapisywane w ResInvest ERP.
   ========================================================================= */
import { DOC_TYPES, TYPE_SECTIONS, FIELDS_BY_TYPE, FIELD_BY_KEY, fieldLabel, isManualField, fieldsFor } from "../../src/schema.mjs";
import { normalizeExtraction, normalizeField, crossCheck, applyTypeRules } from "../../src/normalize.mjs";
import { extractFromOcr, mergeExtractions } from "../../src/ocr-extract.mjs";
import { loadMasterDataFromObject, matchMasterData, integrationHints } from "../../src/master-data.mjs";
import { preprocess, recognize, getWorker } from "./ocr-engine.mjs";

/** @typedef {import("../../src/normalize.mjs").FieldResult} FieldResult */

const VERSION = "0.2.0";
const LS_HISTORY = "riw.scanner.history.v1", LS_MASTER = "riw.scanner.master.v1", LS_REVIEWER = "riw.scanner.reviewer";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const el = (/** @type {string} */ tag, /** @type {Record<string, any>} */ attrs = {}, /** @type {(Node|string|null|undefined|false)[]} */ children = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c != null && c !== false) e.append(c);
  return e;
};

/* ------------------------------------------------------------------ */
/* Pamięć przeglądarki (historia testów, kartoteki)                     */
/* ------------------------------------------------------------------ */

function lsGet(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }

const EMBEDDED_MASTER = (() => { try { return JSON.parse(($("data-master").textContent || "{}")); } catch { return null; } })();
let master = loadMasterDataFromObject(lsGet(LS_MASTER, null) || EMBEDDED_MASTER, lsGet(LS_MASTER, null) ? "kartoteki wczytane z ERP" : "kartoteki przykładowe");

/* ------------------------------------------------------------------ */
/* Stan                                                                */
/* ------------------------------------------------------------------ */

const state = {
  /** @type {any} bieżący rekord (wynik + korekty) */ rec: null,
  /** @type {Record<string, string|null>} */ edits: {},
  /** @type {string|null} */ editType: null,
  /** @type {ImageBitmap|null} */ bitmap: null,
  rotation: 0,
  fileName: "",
  busy: false,
  pending: false
};

const pct = c => (c == null ? "—" : Math.round(c * 100) + "%");
const level = c => (c == null ? "none" : c >= 0.9 ? "ok" : c >= 0.75 ? "mid" : "low");
const fmtDate = iso => { try { return new Date(iso).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; } };
const currentType = () => state.editType || (state.rec ? state.rec.result.docType.value : "NIEZNANY");
const EMPTY = /** @type {FieldResult} */ ({ value: null, normalized: null, confidence: null, bbox: null, warnings: [], source: "ai" });

function showError(msg) { const b = $("errorBox"); b.textContent = msg || ""; b.hidden = !msg; }
function setBusy(on, text, progress) {
  state.busy = on;
  $("busy").hidden = !on;
  if (text) $("busyText").textContent = text;
  const bar = /** @type {HTMLElement} */ ($("busyBar"));
  bar.style.width = progress != null ? Math.round(progress * 100) + "%" : "0";
  for (const id of ["fileInput", "cameraInput", "btnRotL", "btnRotR"]) /** @type {HTMLInputElement} */ ($(id)).disabled = on;
}

/* ------------------------------------------------------------------ */
/* Analiza                                                             */
/* ------------------------------------------------------------------ */

/** @param {Blob} blob @param {string} name */
async function loadImage(blob, name) {
  showError("");
  try { state.bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" }); }
  catch { showError("Nie udało się odczytać zdjęcia (nieobsługiwany format)."); return; }
  state.rotation = 0; state.fileName = name || "zdjecie";
  await analyze();
}

async function analyze() {
  if (!state.bitmap) return;
  // odczyt w toku → po jego zakończeniu odczytamy jeszcze raz (nowe zdjęcie / obrót / typ), nic nie ginie
  if (state.busy) { state.pending = true; return; }
  setBusy(true, "Przygotowanie zdjęcia…", 0);
  try {
    const canvas = preprocess(state.bitmap, state.rotation);
    showPreview(canvas);
    const t0 = performance.now();
    const twoPass = /** @type {HTMLInputElement} */ ($("chkTwoPass")).checked;
    const hint = /** @type {HTMLSelectElement} */ ($("hintType")).value;
    const page = await recognize(canvas, p => setBusy(true, `${twoPass ? "Odczyt 1/2: " : ""}${p.status}…`, twoPass ? p.progress / 2 : p.progress));
    /** @type {any} */
    let raw = extractFromOcr(page, { hintType: hint });
    let lines = page.lines.length;
    if (twoPass) {
      // przebieg 2: powiększenie ×2 (w granicach pamięci) — porównanie odczytów
      const big = preprocess(state.bitmap, state.rotation, { scale: 2 });
      if (big.width > canvas.width) {
        const page2 = await recognize(big, p => setBusy(true, `Odczyt 2/2: ${p.status}…`, 0.5 + p.progress / 2));
        raw = mergeExtractions(raw, extractFromOcr(page2, { hintType: hint }));
        lines = Math.max(lines, page2.lines.length);
      }
    }
    const result = normalizeExtraction(raw, { hintType: hint === "AUTO" ? null : hint });
    const erpMatches = matchMasterData(result.fields, master);
    result.hints = [...result.hints, ...integrationHints(result.docType.value, erpMatches)];
    state.rec = {
      id: "scan_" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6),
      createdAt: new Date().toISOString(), fileName: state.fileName, rotation: state.rotation,
      engine: { name: "Tesseract.js (lokalnie)", ms: Math.round(performance.now() - t0), lines, twoPass },
      testOnly: true, erpPosted: false, status: "ANALYZED", saved: false,
      aiResult: structuredClone(result), result, erpMatches, corrections: []
    };
    state.edits = {}; state.editType = null;
    render();
  } catch (e) {
    showError("Błąd OCR: " + (e instanceof Error ? e.message : String(e)));
  } finally {
    setBusy(false);
    if (state.pending) { state.pending = false; analyze(); }
  }
}

function showPreview(canvas) {
  const img = /** @type {HTMLImageElement} */ ($("docImage"));
  img.src = canvas.toDataURL("image/jpeg", 0.85);
  $("stage").hidden = false; $("viewerEmpty").hidden = true;
  /** @type {HTMLButtonElement} */ ($("btnZoom")).disabled = false;
}

/* ------------------------------------------------------------------ */
/* Widok wyniku                                                        */
/* ------------------------------------------------------------------ */

/** Pole do pokazania (po zmianie typu przed zapisem — z pełnego odczytu OCR). */
function fieldData(key) {
  const r = state.rec;
  if (state.editType && !fieldsFor(r.result.docType.value).includes(key)) {
    if (isManualField(state.editType, key)) return EMPTY;
    return (r.aiResult.extracted && r.aiResult.extracted[key]) || EMPTY;
  }
  return r.result.fields[key] || EMPTY;
}

function render() {
  const r = state.rec;
  $("resultEmpty").hidden = !!r; $("resultForm").hidden = !r;
  if (!r) return;
  const res = r.result, type = currentType();
  $("resultForm").dataset.scanId = r.id;
  $("scanMeta").textContent = `${fmtDate(r.createdAt)} · OCR ${(r.engine.ms / 1000).toFixed(1)} s${r.saved ? " · zapisano" : ""}${r.status === "REVIEWED" ? " · sprawdzone" : ""}`;
  const sel = /** @type {HTMLSelectElement} */ ($("docType"));
  sel.replaceChildren(...Object.entries(DOC_TYPES).map(([k, v]) => el("option", { value: k, text: v.label })));
  sel.value = type;
  $("docTypeConf").replaceChildren(el("span", { text: res.docType.source === "manual" ? "ustawiono ręcznie" : "pewność rozpoznania" }), el("b", { class: "conf " + level(res.docType.confidence), text: pct(res.docType.confidence) }));
  $("docTypeEvidence").textContent = res.docType.evidence || "";
  const manualKeys = fieldsFor(type).filter(k => isManualField(type, k));
  $("alerts").replaceChildren(
    ...(res.warnings || []).map(w => el("li", { text: w })),
    ...(res.checks || []).map(w => el("li", { text: w })),
    ...(res.hints || []).map(w => el("li", { class: "hint", text: w })),
    ...(manualKeys.length ? [el("li", { class: "info", text: `Wpisz ręcznie: ${manualKeys.map(k => fieldLabel(type, k)).join(", ")}.` })] : [])
  );
  const sections = TYPE_SECTIONS[type] || TYPE_SECTIONS.NIEZNANY;
  $("fields").replaceChildren(...sections.map(sec => el("div", { class: "fsection" }, [el("h3", { class: "fsection-title", text: sec.title }), ...sec.fields.map(fieldRow)])));
  renderBoxes();
  $("rawText").textContent = res.rawText || "(brak tekstu)";
  $("providerNotes").textContent = res.notes || "";
  const corr = r.corrections || [];
  $("corrCount").textContent = corr.length ? `(${corr.length})` : "(brak)";
  $("corrTable").querySelector("tbody")?.replaceChildren(...corr.slice().reverse().map(c => el("tr", {}, [
    el("td", { text: fmtDate(c.at) }), el("td", { text: c.by }), el("td", { text: c.field === "docType" ? "Typ dokumentu" : fieldLabel(type, c.field) }),
    el("td", { text: c.was ?? "—" }), el("td", { text: c.now ?? "—" })
  ])));
  updateSaveState();
}

/** Podpowiedzi do wpisywania ręcznego (kartoteki ERP). */
function datalistFor(key) {
  if (!master) return null;
  const opts = key === "supplier" ? master.partners.filter(p => p.role !== "buyer").map(p => p.name)
    : key === "recipient" ? [...master.partners.filter(p => p.role !== "supplier").map(p => p.name), ...master.warehouses.map(w => w.name)]
      : key === "vehicleReg" || key === "trailerReg" ? master.vehicles.map(v => v.reg).filter(Boolean)
        : key === "forestDistrict" ? master.partners.filter(p => /nadle/i.test(p.name)).map(p => p.name)
          : key === "forestRange" ? master.partners.flatMap(p => p.lesnictwa || [])
            : key === "driver" ? master.drivers.map(d => d.name)
              : key === "product" ? master.products.map(p => p.name) : [];
  if (!opts.length) return null;
  return el("datalist", { id: "dl_" + key }, [...new Set(opts)].map(o => el("option", { value: o })));
}

function fieldRow(key) {
  const type = currentType(), f = fieldData(key), manual = isManualField(type, key);
  const id = "f_" + key;
  const edited = Object.prototype.hasOwnProperty.call(state.edits, key);
  const value = edited ? state.edits[key] : f.value;
  const dl = datalistFor(key);
  const input = /** @type {HTMLInputElement} */ (el("input", {
    id, name: key, value: value ?? "", maxlength: 300, list: dl ? "dl_" + key : null, inputmode: FIELD_BY_KEY[key].kind === "quantity" || FIELD_BY_KEY[key].kind === "weight" ? "decimal" : null,
    placeholder: manual ? "wpisz ręcznie" : "brak na dokumencie (null)", class: (value == null ? "is-null" : "") + (edited ? " changed" : "")
  }));
  input.addEventListener("input", () => {
    const v = input.value.trim(), next = v === "" ? null : v;
    if (next === f.value) delete state.edits[key]; else state.edits[key] = next;
    input.classList.toggle("changed", Object.prototype.hasOwnProperty.call(state.edits, key));
    input.classList.toggle("is-null", next == null);
    updateSaveState();
  });
  input.addEventListener("focus", () => setActive(key));
  input.addEventListener("blur", () => setActive(null));
  const conf = el("div", { class: "conf " + level(f.confidence) }, [el("span", { class: "val", text: manual && f.source !== "manual" ? "ręcznie" : pct(f.confidence) }), el("span", { class: "bar" }, [el("i")])]);
  /** @type {HTMLElement} */ (conf.querySelector("i")).style.width = f.confidence == null ? "0" : Math.round(f.confidence * 100) + "%";
  const erp = state.rec.erpMatches && state.rec.erpMatches[key];
  const meta = el("div", { class: "meta" }, [
    f.source === "manual" ? el("span", { class: "badge manual", text: "ręcznie" }) : f.value != null ? el("span", { class: "badge", text: "OCR" }) : null,
    ...(f.warnings || []).map(w => el("span", { class: "warn", text: "⚠ " + w })),
    erp ? el("span", { class: "erp", text: `Kartoteka ERP: ${erp.label}${erp.score < 1 ? ` (${Math.round(erp.score * 100)}%)` : ""}` }) : null
  ]);
  const row = el("div", { class: "frow" + (manual ? " manual" : ""), "data-key": key }, [el("label", { for: id, text: fieldLabel(type, key) }), input, conf, meta, dl]);
  row.addEventListener("mouseenter", () => setActive(key));
  row.addEventListener("mouseleave", () => { if (document.activeElement !== input) setActive(null); });
  return row;
}

function renderBoxes() {
  const ov = $("overlay");
  const keys = fieldsFor(currentType());
  ov.replaceChildren(...keys.map(k => /** @type {[string, FieldResult]} */ ([k, fieldData(k)])).filter(([, f]) => f.bbox && f.value != null && f.source !== "manual").map(([k, f]) => {
    const [x0, y0, x1, y1] = /** @type {number[]} */ (f.bbox);
    const b = el("button", { type: "button", class: "bbox", "data-key": k, "data-label": fieldLabel(currentType(), k), "aria-label": "Pokaż pole: " + fieldLabel(currentType(), k) });
    Object.assign(b.style, { left: x0 * 100 + "%", top: y0 * 100 + "%", width: (x1 - x0) * 100 + "%", height: (y1 - y0) * 100 + "%" });
    b.addEventListener("click", () => { const i = document.getElementById("f_" + k); if (i) { i.scrollIntoView({ block: "center", behavior: "smooth" }); i.focus(); } });
    b.addEventListener("mouseenter", () => setActive(k));
    b.addEventListener("mouseleave", () => setActive(null));
    return b;
  }));
  ov.classList.toggle("hide-boxes", !/** @type {HTMLInputElement} */ ($("chkBoxes")).checked);
}

function setActive(key) {
  const ov = $("overlay");
  ov.classList.toggle("has-active", !!key);
  let box = null;
  for (const b of Array.from(ov.children)) { const on = /** @type {HTMLElement} */ (b).dataset.key === key; b.classList.toggle("active", on); if (on) box = b; }
  for (const r of Array.from(document.querySelectorAll(".frow"))) r.classList.toggle("active", /** @type {HTMLElement} */ (r).dataset.key === key);
  if (box && $("stage").classList.contains("zoom")) box.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function updateSaveState() {
  const r = state.rec;
  const dirty = !!r && (Object.keys(state.edits).length > 0 || state.editType != null || !r.saved);
  /** @type {HTMLButtonElement} */ ($("btnSave")).disabled = !dirty;
}

/* ------------------------------------------------------------------ */
/* Korekta i zapis (tylko historia testów w tej przeglądarce)          */
/* ------------------------------------------------------------------ */

function applyEdits(markReviewed) {
  const r = state.rec, res = r.result, at = new Date().toISOString();
  const by = /** @type {HTMLInputElement} */ ($("reviewer")).value.trim().slice(0, 80) || "tester";
  lsSet(LS_REVIEWER, by);
  if (state.editType && state.editType !== res.docType.value) {
    r.corrections.push({ at, by, field: "docType", was: res.docType.value, now: state.editType });
    res.docType = { value: state.editType, confidence: 1, evidence: "korekta ręczna", source: "manual" };
    const merged = Object.assign({}, r.aiResult.extracted || r.aiResult.fields);
    for (const [k, f] of Object.entries(res.fields)) if (f && /** @type {any} */ (f).source === "manual") merged[k] = f;
    res.fields = applyTypeRules(state.editType, merged);
  }
  for (const [k, v] of Object.entries(state.edits)) {
    if (!fieldsFor(res.docType.value).includes(k)) continue;
    const cur = res.fields[k];
    const next = normalizeField(k, { value: v, confidence: 1, bbox: cur ? cur.bbox : null }, "manual");
    if ((cur ? cur.value : null) === next.value) continue;
    r.corrections.push({ at, by, field: k, was: cur ? cur.value : null, now: next.value });
    res.fields[k] = next;
  }
  r.erpMatches = matchMasterData(res.fields, master);
  const cc = crossCheck(res.docType.value, res.fields);
  res.checks = cc.warnings;
  res.hints = [...cc.hints, ...integrationHints(res.docType.value, r.erpMatches)];
  if (markReviewed) r.status = "REVIEWED";
  r.saved = true; r.updatedAt = at;
  const hist = lsGet(LS_HISTORY, []).filter(x => x.id !== r.id);
  hist.unshift(r);
  if (!lsSet(LS_HISTORY, hist.slice(0, 300))) showError("Nie udało się zapisać historii w przeglądarce (brak miejsca lub tryb prywatny).");
  state.edits = {}; state.editType = null;
  render(); renderHistory();
}

/* ------------------------------------------------------------------ */
/* Historia, eksport, kartoteki                                        */
/* ------------------------------------------------------------------ */

function renderHistory() {
  const hist = lsGet(LS_HISTORY, []);
  const tbody = $("histTable").querySelector("tbody");
  if (!tbody) return;
  if (!hist.length) { tbody.replaceChildren(el("tr", {}, [el("td", { colspan: 7, class: "muted", text: "Brak zapisanych testów." })])); return; }
  tbody.replaceChildren(...hist.map(h => {
    const f = h.result.fields;
    const del = el("button", { type: "button", class: "btn ghost sm danger", text: "Usuń" });
    del.addEventListener("click", ev => {
      ev.stopPropagation();
      if (!confirm("Usunąć ten wynik testowy z historii przeglądarki?")) return;
      lsSet(LS_HISTORY, lsGet(LS_HISTORY, []).filter(x => x.id !== h.id));
      renderHistory();
    });
    const tr = el("tr", { "data-id": h.id, tabindex: 0, class: state.rec && state.rec.id === h.id ? "current" : "" }, [
      el("td", { text: fmtDate(h.createdAt) }), el("td", { text: h.result.docType.value }),
      el("td", { text: (f.docNumber && f.docNumber.value) || (f.docDate && f.docDate.value) || "—" }),
      el("td", { text: (f.vehicleReg && f.vehicleReg.value) || "—" }), el("td", { text: (f.quantity && f.quantity.value) || "—" }),
      el("td", { text: h.status === "REVIEWED" ? "sprawdzone" : "zapisane" }), el("td", {}, [del])
    ]);
    const open = () => { state.rec = h; state.edits = {}; state.editType = null; $("stage").hidden = true; $("viewerEmpty").hidden = false; $("viewerEmpty").textContent = "Zdjęcia nie przechowuje się w historii (prywatność) — widoczne są zapisane dane."; render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", ev => { if (ev.key === "Enter") open(); });
    return tr;
  }));
}

function download(name, text, type) {
  const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
}

const CSV_COLS = ["docNumber", "docDate", "time", "supplier", "recipient", "product", "forestDistrict", "forestRange", "vehicleReg", "trailerReg", "driver", "quantity", "grossWeight", "tareWeight", "netWeight"];
function exportCsv() {
  const hist = lsGet(LS_HISTORY, []);
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Zapisano", "Typ", "Status", ...CSV_COLS.map(k => FIELD_BY_KEY[k].label), "Korekty"].map(q).join(";")];
  for (const h of hist) rows.push([fmtDate(h.updatedAt || h.createdAt), h.result.docType.value, h.status, ...CSV_COLS.map(k => h.result.fields[k] ? h.result.fields[k].value : ""), h.corrections.length].map(q).join(";"));
  download(`skaner-testy-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + rows.join("\r\n"), "text/csv;charset=utf-8");
}

async function importMaster(file) {
  try {
    const j = JSON.parse(await file.text());
    const md = loadMasterDataFromObject(j, "kartoteki wczytane z ERP");
    if (!md || (!md.products.length && !md.partners.length)) throw new Error("Plik nie zawiera kartotek ResInvest ERP (products / partners / fleet / warehouses).");
    // zapisujemy tylko kartoteki — bez kont użytkowników, operacji i księgi
    lsSet(LS_MASTER, { products: md.products, partners: md.partners, carriers: md.carriers.map(c => c.name), fleet: { vehicles: md.vehicles, drivers: md.drivers }, warehouses: md.warehouses });
    master = md; showMasterInfo(); if (state.rec) { state.rec.erpMatches = matchMasterData(state.rec.result.fields, master); render(); }
  } catch (e) { showError("Kartoteki: " + (e instanceof Error ? e.message : String(e))); }
}

function showMasterInfo() {
  $("masterInfo").textContent = master ? `${master.source}: ${master.partners.length} kontrahentów, ${master.products.length} towarów, ${master.vehicles.length} pojazdów, ${master.warehouses.length} magazynów` : "brak kartotek";
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

function init() {
  $("appVersion").textContent = VERSION;
  const samples = $("samples");
  for (const s of Array.from(document.querySelectorAll("script[data-sample]"))) {
    const label = /** @type {HTMLElement} */ (s).dataset.sample || "przykład";
    samples.append(el("button", { type: "button", class: "btn ghost sm", text: label, onclick: async () => {
      const bin = atob((s.textContent || "").trim()); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      await loadImage(new Blob([u], { type: "image/png" }), label + ".png");
    } }));
  }
  const onPick = ev => { const inp = /** @type {HTMLInputElement} */ (ev.target); const f = inp.files && inp.files[0]; if (f) loadImage(f, f.name); inp.value = ""; };
  $("fileInput").addEventListener("change", onPick);
  $("cameraInput").addEventListener("change", onPick);
  const dz = $("dropZone");
  dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", ev => { ev.preventDefault(); dz.classList.remove("drag"); const f = ev.dataTransfer && ev.dataTransfer.files[0]; if (f) loadImage(f, f.name); });
  $("btnRotL").addEventListener("click", () => { state.rotation = (state.rotation + 270) % 360; analyze(); });
  $("btnRotR").addEventListener("click", () => { state.rotation = (state.rotation + 90) % 360; analyze(); });
  $("hintType").addEventListener("change", () => { if (state.bitmap) analyze(); });
  $("chkTwoPass").addEventListener("change", () => lsSet("riw.scanner.twoPass", /** @type {HTMLInputElement} */ ($("chkTwoPass")).checked));
  /** @type {HTMLInputElement} */ ($("chkTwoPass")).checked = lsGet("riw.scanner.twoPass", true) !== false;
  $("chkBoxes").addEventListener("change", () => { if (state.rec) renderBoxes(); });
  $("btnZoom").addEventListener("click", () => { const on = $("stage").classList.toggle("zoom"); $("btnZoom").textContent = on ? "Dopasuj" : "Powiększ"; });
  $("docType").addEventListener("change", ev => {
    const v = /** @type {HTMLSelectElement} */ (ev.target).value;
    state.editType = v === state.rec.result.docType.value ? null : v;
    for (const k of Object.keys(state.edits)) if (!(FIELDS_BY_TYPE[v] || []).includes(k)) delete state.edits[k];
    render();
  });
  $("resultForm").addEventListener("submit", ev => { ev.preventDefault(); applyEdits(false); });
  $("btnReviewed").addEventListener("click", () => applyEdits(true));
  $("btnExportJson").addEventListener("click", () => download(`skaner-testy-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ _uwaga: "Wyniki TESTOWE skanera — nie są dokumentami ResInvest ERP.", wersja: VERSION, wyniki: lsGet(LS_HISTORY, []) }, null, 2), "application/json"));
  $("btnExportCsv").addEventListener("click", exportCsv);
  $("masterFile").addEventListener("change", ev => { const f = /** @type {HTMLInputElement} */ (ev.target).files?.[0]; if (f) importMaster(f); });
  $("btnMasterReset").addEventListener("click", () => { try { localStorage.removeItem(LS_MASTER); } catch { /* brak dostępu */ } master = loadMasterDataFromObject(EMBEDDED_MASTER, "kartoteki przykładowe"); showMasterInfo(); });
  /** @type {HTMLInputElement} */ ($("reviewer")).value = lsGet(LS_REVIEWER, "") || "";
  showMasterInfo();
  renderHistory();
  // silnik OCR ładuje się w tle (ok. 2–5 s), żeby pierwsze zdjęcie było szybsze
  getWorker().then(() => { $("engineState").textContent = "OCR gotowy (offline)"; $("engineState").classList.add("ok"); })
    .catch(e => { $("engineState").textContent = "OCR niedostępny"; showError("Nie udało się uruchomić OCR: " + (e instanceof Error ? e.message : e)); });
}

init();

// Tryb diagnostyczny (adres z „#debug”): dostęp do potoku OCR dla testów jakości.
if (location.hash.includes("debug")) /** @type {any} */ (window).RIW_DEBUG = { preprocess, recognize, extractFromOcr, normalizeExtraction };
