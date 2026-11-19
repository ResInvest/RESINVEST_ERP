// @ts-check
/* =========================================================================
   AI Document Scanner Test — interfejs (przeglądarka)

   Bez bibliotek zewnętrznych. Dane z serwera wstawiane wyłącznie przez
   textContent / atrybuty (bez innerHTML) — odczyt OCR traktujemy jak dane
   niezaufane. Przeglądarka nie zna i nie przechowuje kluczy API.
   ========================================================================= */

/** @typedef {{ value: string|null, normalized: any, confidence: number|null, bbox: number[]|null, warnings: string[], source: "ai"|"manual" }} FieldResult */

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const el = (/** @type {string} */ tag, /** @type {Record<string, any>} */ attrs = {}, /** @type {(Node|string|null|undefined)[]} */ children = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
};

const state = {
  /** @type {any} */ status: null,
  /** @type {any} */ scan: null,
  /** @type {Record<string, string|null>} */ edits: {},
  /** @type {string|null} */ editDocType: null,
  /** @type {AbortController|null} */ abort: null,
  /** @type {string|null} */ objectUrl: null,
  activeField: /** @type {string|null} */ (null)
};

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function api(path, opts = {}) {
  /** @type {RequestInit} */
  const init = Object.assign({ headers: {}, credentials: /** @type {RequestCredentials} */ ("same-origin") }, opts);
  const res = await fetch(path, init);
  let body = null;
  try { body = await res.json(); } catch { /* brak JSON */ }
  if (!res.ok || !body || body.ok === false) {
    const err = new Error(body && body.error ? body.error : `Błąd serwera (HTTP ${res.status}).`);
    /** @type {any} */ (err).status = res.status;
    throw err;
  }
  return body;
}

/* ------------------------------------------------------------------ */
/* Pomocnicze                                                          */
/* ------------------------------------------------------------------ */

const pct = c => (c == null ? "—" : Math.round(c * 100) + "%");
const level = c => (c == null ? "none" : c >= 0.9 ? "ok" : c >= 0.75 ? "mid" : "low");
const fmtDate = iso => { try { return new Date(iso).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; } };
const typeLabel = t => (state.status && state.status.schema.docTypes[t] ? state.status.schema.docTypes[t].label : t);
const fieldDef = key => state.status.schema.fields.find(f => f.key === key);
/** Etykieta pola dla aktualnego typu (np. „Nr kwitu”, „Numer (ręcznie)”). */
const labelFor = key => { const o = (state.status.schema.labelOverrides || {})[currentDocType()]; return (o && o[key]) || (fieldDef(key) || { label: key }).label; };
const isManual = key => ((state.status.schema.manualFields || {})[currentDocType()] || []).includes(key);

function storageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* tryb prywatny */ } }

function showError(msg) {
  const box = $("errorBox");
  box.textContent = msg || "";
  box.hidden = !msg;
}

function setBusy(on, text) {
  $("busy").hidden = !on;
  if (text) $("busyText").textContent = text;
  for (const id of ["fileInput", "cameraInput"]) /** @type {HTMLInputElement} */ ($(id)).disabled = on;
}

/* ------------------------------------------------------------------ */
/* Przygotowanie obrazu (przeglądarka)                                 */
/* ------------------------------------------------------------------ */

const SEND_AS_IS = ["image/jpeg", "image/png", "image/webp"];

/**
 * Zdjęcie z telefonu bywa duże (12–50 Mpx) lub w HEIC. Zmniejszamy dłuższy bok do limitu
 * i zapisujemy jako JPEG; pliki już małe w obsługiwanym formacie wysyłamy bez zmian
 * (zachowany oryginał = powtarzalny wynik).
 * @param {File|Blob} file
 * @returns {Promise<Blob>}
 */
async function prepareImage(file) {
  const maxSide = state.status ? state.status.limits.clientMaxSide : 2400;
  const maxBytes = state.status ? state.status.limits.maxUploadBytes : 8 * 1024 * 1024;
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("Nie udało się odczytać zdjęcia w przeglądarce (nieobsługiwany format)."); }
  const long = Math.max(bmp.width, bmp.height);
  if (SEND_AS_IS.includes(file.type) && long <= maxSide && file.size <= maxBytes * 0.9) { bmp.close(); return file; }
  const scale = Math.min(1, maxSide / long);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Przeglądarka nie obsługuje canvas.");
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.9));
  if (!blob) throw new Error("Nie udało się przygotować zdjęcia.");
  return blob;
}

/* ------------------------------------------------------------------ */
/* Skanowanie                                                          */
/* ------------------------------------------------------------------ */

async function scanFile(file, name) {
  showError("");
  setBusy(true, "Przygotowanie zdjęcia…");
  try {
    const blob = await prepareImage(file);
    showImage(URL.createObjectURL(blob), true);
    setBusy(true, "Analiza dokumentu… (OCR / AI)");
    state.abort = new AbortController();
    const hint = /** @type {HTMLSelectElement} */ ($("hintType")).value;
    const q = new URLSearchParams({ hint, name: name || (file instanceof File ? file.name : "zdjecie.jpg") });
    const r = await api("/api/scan?" + q.toString(), { method: "POST", body: blob, headers: { "Content-Type": blob.type || "image/jpeg" }, signal: state.abort.signal });
    loadScan(r.scan);
    refreshHistory();
  } catch (e) {
    if (e && e.name === "AbortError") showError("Analiza przerwana.");
    else showError(e instanceof Error ? e.message : String(e));
    $("resultEmpty").hidden = !!state.scan;
  } finally {
    state.abort = null;
    setBusy(false);
  }
}

function showImage(url, isObjectUrl) {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = isObjectUrl ? url : null;
  /** @type {HTMLImageElement} */ ($("docImage")).src = url;
  $("stage").hidden = false;
  $("viewerEmpty").hidden = true;
  /** @type {HTMLButtonElement} */ ($("btnZoom")).disabled = false;
}

/* ------------------------------------------------------------------ */
/* Wynik                                                               */
/* ------------------------------------------------------------------ */

function loadScan(scan) {
  state.scan = scan;
  state.edits = {};
  state.editDocType = null;
  state.activeField = null;
  // keepImages: false — serwer nie przechowuje zdjęcia; zostaje podgląd z przeglądarki (jeśli jest)
  if (scan.image && scan.image.file) showImage(`/api/scans/${encodeURIComponent(scan.id)}/image`, false);
  else if (!state.objectUrl) { $("stage").hidden = true; $("viewerEmpty").hidden = false; $("viewerEmpty").textContent = "Zdjęcie nie jest przechowywane (keepImages: false)."; }
  render();
  for (const tr of Array.from($("histTable").querySelectorAll("tbody tr"))) tr.classList.toggle("current", /** @type {HTMLElement} */ (tr).dataset.id === scan.id);
}

function currentDocType() { return state.editDocType || state.scan.result.docType.value; }

function render() {
  const s = state.scan;
  if (!s) return;
  const r = s.result;
  $("resultEmpty").hidden = true;
  $("resultForm").hidden = false;
  const p = s.provider || {};
  $("scanMeta").textContent = `${fmtDate(s.createdAt)} · ${p.name}${p.simulated ? " (symulacja)" : p.servedBy ? " · " + p.servedBy : ""}${p.ms != null ? " · " + (p.ms / 1000).toFixed(1) + " s" : ""} · rew. ${s.rev}${s.status === "REVIEWED" ? " · sprawdzone" : ""}`;
  $("simBanner").hidden = !p.simulated;

  // typ dokumentu
  const sel = /** @type {HTMLSelectElement} */ ($("docType"));
  sel.replaceChildren(...Object.keys(state.status.schema.docTypes).map(k => el("option", { value: k, text: typeLabel(k) })));
  sel.value = currentDocType();
  const dt = r.docType;
  const confBox = $("docTypeConf");
  confBox.replaceChildren(el("span", { text: dt.source === "manual" ? "ustawiono ręcznie" : "pewność rozpoznania" }), el("b", { class: "conf " + level(dt.confidence), text: pct(dt.confidence) }));
  $("docTypeEvidence").textContent = dt.evidence || "";

  // ostrzeżenia
  const alerts = $("alerts");
  alerts.replaceChildren(
    ...(r.warnings || []).map(w => el("li", { text: w })),
    ...(r.checks || []).map(w => el("li", { text: w })),
    ...(r.hints || []).map(w => el("li", { class: "hint", text: w })),
    ...(p.simulated ? [el("li", { class: "info", text: "Pewności w wyniku symulowanym są przykładowe (nie pochodzą z modelu)." })] : [])
  );

  // pola
  // tylko pola odczytywane dla typu, w sekcjach (np. kwit: Kwit | Transport)
  const sections = state.status.schema.typeSections[currentDocType()] || state.status.schema.typeSections.NIEZNANY;
  $("fields").replaceChildren(...sections.map(sec => el("div", { class: "fsection" }, [
    el("h3", { class: "fsection-title", text: sec.title }),
    ...sec.fields.map(k => fieldRow(k))
  ])));

  renderBoxes();
  /** @type {HTMLAnchorElement} */ ($("btnExport")).href = `/api/scans/${encodeURIComponent(s.id)}/export`;
  $("providerNotes").textContent = r.notes ? "Uwagi: " + r.notes : "Brak uwag providera.";
  $("rawText").textContent = r.rawText || "(provider nie zwrócił tekstu)";
  const corr = s.corrections || [];
  $("corrCount").textContent = corr.length ? `(${corr.length})` : "(brak)";
  $("corrTable").querySelector("tbody")?.replaceChildren(...corr.slice().reverse().map(c => el("tr", {}, [
    el("td", { text: fmtDate(c.at) }), el("td", { text: c.by }), el("td", { text: c.field === "docType" ? "Typ dokumentu" : (fieldDef(c.field) || { label: c.field }).label }),
    el("td", { text: c.was == null ? "null" : c.was }), el("td", { text: c.now == null ? "null" : c.now })
  ])));
  updateSaveState();
}

const EMPTY_FIELD = /** @type {FieldResult} */ ({ value: null, normalized: null, confidence: null, bbox: null, warnings: [], source: "ai" });

/**
 * Dane pola do pokazania. Po zmianie typu (przed zapisem) pola nowego typu pochodzą z pełnego
 * odczytu AI (aiResult.extracted) — tak samo przeliczy je serwer przy zapisie.
 * @param {string} key @returns {FieldResult}
 */
function fieldData(key) {
  const s = state.scan;
  const storedTypeFields = state.status.schema.fieldsByType[s.result.docType.value] || [];
  if (state.editDocType && !storedTypeFields.includes(key)) {
    const ex = s.aiResult && s.aiResult.extracted ? s.aiResult.extracted[key] : null;
    return ex || EMPTY_FIELD;
  }
  return s.result.fields[key] || EMPTY_FIELD;
}

/** @param {string} key */
function fieldRow(key) {
  const f = fieldData(key);
  const id = "f_" + key;
  const edited = Object.prototype.hasOwnProperty.call(state.edits, key);
  const value = edited ? state.edits[key] : f.value;
  const input = /** @type {HTMLInputElement} */ (el("input", { id, name: key, value: value == null ? "" : value, placeholder: isManual(key) ? "wpisz ręcznie" : "null — brak na dokumencie", maxlength: 300, class: (value == null ? "is-null" : "") + (edited ? " changed" : ""), "aria-describedby": id + "_meta" }));
  input.addEventListener("input", () => {
    const v = input.value.trim();
    const next = v === "" ? null : v;
    if (next === f.value) delete state.edits[key]; else state.edits[key] = next;
    input.classList.toggle("changed", Object.prototype.hasOwnProperty.call(state.edits, key));
    input.classList.toggle("is-null", next == null);
    updateSaveState();
  });
  input.addEventListener("focus", () => setActive(key));
  input.addEventListener("blur", () => setActive(null));
  const conf = el("div", { class: "conf " + level(f.confidence), title: f.confidence == null ? "Brak wartości — pewność nie dotyczy" : "Pewność odczytu" }, [
    el("span", { class: "val", text: pct(f.confidence) }),
    el("span", { class: "bar" }, [el("i")])
  ]);
  const bar = /** @type {HTMLElement} */ (conf.querySelector("i"));
  bar.style.width = f.confidence == null ? "0" : Math.round(f.confidence * 100) + "%";
  const erp = state.scan.erpMatches && state.scan.erpMatches[key];
  const meta = el("div", { class: "meta", id: id + "_meta" }, [
    f.source === "manual" ? el("span", { class: "badge manual", text: "ręcznie" }) : f.value != null ? el("span", { class: "badge" + (state.scan.provider.simulated ? " sim" : ""), text: state.scan.provider.simulated ? "symulacja" : "AI" }) : null,
    f.value != null && !f.bbox && f.source !== "manual" ? el("span", { text: "brak współrzędnych" }) : null,
    ...(f.warnings || []).map(w => el("span", { class: "warn", text: "⚠ " + w })),
    erp ? el("span", { class: "erp", text: `Kartoteka ERP: ${erp.label}${erp.score < 1 ? ` (${Math.round(erp.score * 100)}%)` : ""}` }) : null
  ]);
  const row = el("div", { class: "frow" + (isManual(key) ? " manual" : ""), "data-key": key }, [el("label", { for: id, text: labelFor(key) }), input, conf, meta]);
  row.addEventListener("mouseenter", () => setActive(key));
  row.addEventListener("mouseleave", () => { if (document.activeElement !== input) setActive(null); });
  return row;
}

function renderBoxes() {
  const ov = $("overlay");
  const keys = state.status.schema.fieldsByType[currentDocType()] || [];
  ov.replaceChildren(...keys.map(k => /** @type {[string, FieldResult]} */ ([k, fieldData(k)])).filter(([, f]) => f.bbox && f.value != null).map(([k, f]) => {
    const [x0, y0, x1, y1] = f.bbox;
    const b = el("button", { type: "button", class: "bbox", "data-key": k, "data-label": (fieldDef(k) || { label: k }).label, "aria-label": "Pokaż pole: " + (fieldDef(k) || { label: k }).label });
    Object.assign(b.style, { left: x0 * 100 + "%", top: y0 * 100 + "%", width: (x1 - x0) * 100 + "%", height: (y1 - y0) * 100 + "%" });
    b.addEventListener("click", () => { const i = document.getElementById("f_" + k); if (i) { i.scrollIntoView({ block: "center", behavior: "smooth" }); i.focus(); } });
    b.addEventListener("mouseenter", () => setActive(k));
    b.addEventListener("mouseleave", () => setActive(null));
    return b;
  }));
  ov.classList.toggle("hide-boxes", !/** @type {HTMLInputElement} */ ($("chkBoxes")).checked);
}

/** Podświetlenie pola na zdjęciu i na liście. @param {string|null} key */
function setActive(key) {
  state.activeField = key;
  const ov = $("overlay");
  ov.classList.toggle("has-active", !!key);
  let activeBox = null;
  for (const b of Array.from(ov.children)) {
    const on = /** @type {HTMLElement} */ (b).dataset.key === key;
    b.classList.toggle("active", on);
    if (on) activeBox = b;
  }
  for (const r of Array.from(document.querySelectorAll(".frow"))) r.classList.toggle("active", /** @type {HTMLElement} */ (r).dataset.key === key);
  if (activeBox && $("stage").classList.contains("zoom")) activeBox.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function updateSaveState() {
  const dirty = Object.keys(state.edits).length > 0 || state.editDocType != null;
  /** @type {HTMLButtonElement} */ ($("btnSave")).disabled = !dirty;
}

async function saveCorrections(markReviewed) {
  if (!state.scan) return;
  showError("");
  const reviewer = /** @type {HTMLInputElement} */ ($("reviewer")).value.trim();
  storageSet("scanner.reviewer", reviewer);
  const body = { rev: state.scan.rev, reviewer, fields: state.edits, markReviewed: !!markReviewed };
  if (state.editDocType) /** @type {any} */ (body).docType = state.editDocType;
  try {
    const r = await api(`/api/scans/${encodeURIComponent(state.scan.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    loadScan(r.scan);
    refreshHistory();
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
}

/* ------------------------------------------------------------------ */
/* Historia                                                            */
/* ------------------------------------------------------------------ */

async function refreshHistory() {
  try {
    const r = await api("/api/scans");
    const tbody = $("histTable").querySelector("tbody");
    if (!tbody) return;
    if (!r.scans.length) { tbody.replaceChildren(el("tr", {}, [el("td", { colspan: 9, class: "muted", text: "Brak wyników testowych." })])); return; }
    tbody.replaceChildren(...r.scans.map(s => {
      const del = el("button", { type: "button", class: "btn ghost sm danger", text: "Usuń", "aria-label": "Usuń wynik testowy" });
      del.addEventListener("click", async ev => {
        ev.stopPropagation();
        if (!confirm("Usunąć ten wynik testowy? (dane ERP nie są zmieniane)")) return;
        try { await api(`/api/scans/${encodeURIComponent(s.id)}`, { method: "DELETE" }); if (state.scan && state.scan.id === s.id) location.reload(); else refreshHistory(); }
        catch (e) { showError(e instanceof Error ? e.message : String(e)); }
      });
      const tr = el("tr", { "data-id": s.id, class: state.scan && state.scan.id === s.id ? "current" : "", tabindex: 0 }, [
        el("td", { text: fmtDate(s.createdAt) }), el("td", { text: s.docType || "—" }), el("td", { text: s.docNumber || s.docDate || "—" }), el("td", { text: s.vehicleReg || "—" }),
        el("td", { text: pct(s.docTypeConfidence) }), el("td", { text: (s.provider || "—") + (s.simulated ? " (sym.)" : "") }),
        el("td", { text: String(s.corrections) }), el("td", { text: s.status === "REVIEWED" ? "sprawdzone" : "do sprawdzenia" }), el("td", {}, [del])
      ]);
      const open = async () => { try { loadScan((await api(`/api/scans/${encodeURIComponent(s.id)}`)).scan); window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { showError(e instanceof Error ? e.message : String(e)); } };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", ev => { if (ev.key === "Enter") open(); });
      return tr;
    }));
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

async function init() {
  try {
    state.status = await api("/api/status");
  } catch (e) {
    showError("Brak połączenia z serwerem testowym: " + (e instanceof Error ? e.message : e));
    return;
  }
  const st = state.status.provider;
  const pill = $("providerPill");
  pill.textContent = `Provider: ${st.name}${st.model ? " · " + st.model : ""}${st.simulated ? " (symulacja)" : ""}`;
  pill.title = st.label + (st.reason ? " — " + st.reason : "");
  pill.classList.toggle("warn", st.simulated || !st.configured);
  $("simBanner").hidden = !st.simulated;

  const samples = $("samples");
  for (const s of state.status.samples || []) {
    samples.append(el("button", { type: "button", class: "btn ghost sm", text: s.label, onclick: async () => {
      try {
        const res = await fetch("/samples/" + encodeURIComponent(s.file));
        if (!res.ok) throw new Error("Nie udało się pobrać przykładu.");
        await scanFile(await res.blob(), s.file);
      } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
    } }));
  }

  const onPick = ev => { const inp = /** @type {HTMLInputElement} */ (ev.target); const f = inp.files && inp.files[0]; if (f) scanFile(f, f.name); inp.value = ""; };
  $("fileInput").addEventListener("change", onPick);
  $("cameraInput").addEventListener("change", onPick);
  const dz = $("dropZone");
  dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", ev => {
    ev.preventDefault(); dz.classList.remove("drag");
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) scanFile(f, f.name);
  });
  $("btnAbort").addEventListener("click", () => { if (state.abort) state.abort.abort(); });
  $("chkBoxes").addEventListener("change", () => { if (state.scan) renderBoxes(); });
  $("btnZoom").addEventListener("click", () => {
    const on = $("stage").classList.toggle("zoom");
    $("btnZoom").setAttribute("aria-pressed", String(on));
    $("btnZoom").textContent = on ? "Dopasuj" : "Powiększ";
  });
  $("docType").addEventListener("change", ev => {
    const v = /** @type {HTMLSelectElement} */ (ev.target).value;
    state.editDocType = v === state.scan.result.docType.value ? null : v;
    // poprawki pól, których nowy typ nie odczytuje, są porzucane
    const keep = state.status.schema.fieldsByType[currentDocType()] || [];
    for (const k of Object.keys(state.edits)) if (!keep.includes(k)) delete state.edits[k];
    render();
  });
  $("resultForm").addEventListener("submit", ev => { ev.preventDefault(); saveCorrections(false); });
  $("btnReviewed").addEventListener("click", () => saveCorrections(true));
  $("btnRefresh").addEventListener("click", refreshHistory);
  /** @type {HTMLInputElement} */ ($("reviewer")).value = storageGet("scanner.reviewer") || "";
  refreshHistory();
}

init();
