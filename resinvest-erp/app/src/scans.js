/* =========================================================================
   ResInvest ERP 3.14 — skany dokumentów i zdjęcia operacji (przeglądarka)
   * Rodzaje: PZ, WZ, MM, kwit wywozowy, zdjęcie tonażu z wagi, zdjęcie zrębki, inny dokument.
   * Serwer: plik wysyłany na /api/scans (zapis w C:\ProgramData\ResInvestERP\skany\SKANY <MIESIĄC> <ROK>\,
     kopia w backups\skany i w folderze firmy). Tryb lokalny: plik w bazie przeglądarki (IndexedDB, „riw-scans”),
     ta sama ścieżka „SKANY <MIESIĄC> <ROK>/…” — kopia skanów jako ZIP z tymi folderami (Administracja).
   * Duże zdjęcia (telefon) są zmniejszane przed wysłaniem do 2560 px (JPEG 86%) — szybkie wysyłanie, czytelne liczby z wagi.
     PDF i HEIC wysyłane bez zmian. Typ pliku sprawdzany po zawartości (sygnaturze), nie po nazwie.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, N_, esc, $, $$, ic, Toast, Modal, Store, ServerBackend, App } = UI;
  const th = s => esc(t(s));
  const MAX_SIDE = 2560, JPEG_Q = 0.86, SHRINK_FROM = 1.5 * 1024 * 1024;

  /* ---------------- magazyn plików trybu lokalnego (IndexedDB) ---------------- */
  const LocalFiles = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((resolve, reject) => {
        if (!root.indexedDB) return reject(new Error(t("Przeglądarka nie obsługuje zapisu plików (IndexedDB)")));
        const rq = indexedDB.open("riw-scans", 1);
        rq.onupgradeneeded = () => { const db = rq.result; if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "id" }); };
        rq.onsuccess = () => { this._db = rq.result; resolve(this._db); };
        rq.onerror = () => reject(rq.error || new Error("IndexedDB"));
      });
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tr = db.transaction("files", mode), st = tr.objectStore("files");
        let out; const rq = fn(st); if (rq) rq.onsuccess = () => { out = rq.result; };
        tr.oncomplete = () => resolve(out); tr.onerror = () => reject(tr.error); tr.onabort = () => reject(tr.error || new Error("abort"));
      });
    },
    put(rec) { return this.tx("readwrite", st => st.put(rec)); },
    get(id) { return this.tx("readonly", st => st.get(id)); },
    all() { return this.tx("readonly", st => st.getAll()); }
  };

  /** Zmniejszenie dużego zdjęcia (canvas). PDF / HEIC / małe pliki — bez zmian. */
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < SHRINK_FROM || typeof createImageBitmap !== "function") return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      if (k >= 1 && file.type === "image/jpeg") { bmp.close && bmp.close(); return file; }
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
      const blob = await new Promise(res => c.toBlob(res, "image/jpeg", JPEG_Q));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg", { type: "image/jpeg" }) : file;
    } catch (e) { return file; }
  }
  const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " kB";
  const isImg = s => /^image\/(jpeg|png|webp)$/.test(s.type);

  const Scans = {
    KINDS: R.SCAN_KINDS,
    /** Rodzaj domyślny dla operacji: PZ przy zakupie, WZ przy sprzedaży, MM przy przesunięciu. */
    defaultKind(op) { return op.type === "ZAKUP" ? "PZ" : op.type === "MM" ? "MM" : op.type === "SPRZEDAZ" ? "WZ" : "KWIT"; },
    canAdd(op) { return !!op && App.can("scans.add") && R.Scans.access(App.user(), op); },
    canDelete(op) { return !!op && App.can("scans.delete") && R.Scans.access(App.user(), op); },
    /** Wysłanie pliku: serwer (zapis w folderze skanów) albo tryb lokalny (IndexedDB + polecenie w danych). */
    async upload(opId, kind, file0) {
      const op = R.byId(Store.state.operations, opId);
      if (!op) return { ok: false, error: t("Nie znaleziono operacji") };
      if (file0.size > R.SCAN_MAX_BYTES * 3) return { ok: false, error: t("Plik jest za duży (najwięcej {n} MB)", { n: R.SCAN_MAX_BYTES / 1048576 }) };
      const file = await shrink(file0);
      if (file.size > R.SCAN_MAX_BYTES) return { ok: false, error: t("Plik jest za duży (najwięcej {n} MB)", { n: R.SCAN_MAX_BYTES / 1048576 }) };
      const head = new Uint8Array(await file.slice(0, 16).arrayBuffer()), type = R.scanSniff(head);
      if (!type) return { ok: false, error: t("Dozwolone pliki: PDF, JPG, PNG, WEBP, HEIC, TIFF") };
      if (Store.mode === "server") {
        const have = ServerBackend.haveRev();
        const q = new URLSearchParams({ opId, kind, name: file0.name || "" }); if (have !== null) q.set("haveRev", String(have));
        let r, data;
        try { r = await fetch("/api/scans?" + q, { method: "POST", headers: { "X-RIW": "1", "Content-Type": type, "Accept-Language": UI.I18N.lang }, credentials: "same-origin", body: file }); }
        catch (e) { return { ok: false, error: t("Brak połączenia z serwerem — nic nie zapisano.") }; }
        try { data = await r.json(); } catch (e) { data = { ok: false, error: t("Nieprawidłowa odpowiedź serwera") }; }
        if (data && data.ok && ServerBackend.applyPayload(data) === null) await ServerBackend.loadState(true);
        return data || { ok: false };
      }
      // tryb lokalny: plik w bazie przeglądarki, metadane w danych (ta sama komenda co na serwerze)
      const id = R.uid("sc").replace(/[^a-z0-9_]/gi, "").toLowerCase();
      const rel = `${R.scanFolder(op.date)}/${R.scanFileName(op, kind, id, R.SCAN_TYPES[type])}`;
      try { await LocalFiles.put({ id, blob: file, type, name: file0.name || rel.split("/").pop(), file: rel, at: new Date().toISOString() }); }
      catch (e) { return { ok: false, error: t("Nie udało się zapisać pliku w przeglądarce: {m}", { m: e.message }) }; }
      return Store.exec("scan.attach", { opId, scan: { id, kind, name: file0.name || "", file: rel, type, size: file.size, sha: "" } }, N_("Skany dokumentów"));
    },
    /** Adres do podglądu / pobrania pliku. */
    async url(op, sc) {
      if (Store.mode === "server") return `/api/scans/file?opId=${encodeURIComponent(op.id)}&id=${encodeURIComponent(sc.id)}`;
      const rec = await LocalFiles.get(sc.id);
      return rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
    },
    /** Panel skanów w szczegółach operacji: lista według rodzaju, miniatury zdjęć, dodawanie (pliki, aparat, przeciągnij i upuść). */
    panelHtml(op) {
      const list = R.Scans.live(op), add = this.canAdd(op), del = this.canDelete(op), def = this.defaultKind(op);
      const groups = Object.keys(R.SCAN_KINDS).map(k => [k, list.filter(s => s.kind === k)]).filter(([, l]) => l.length);
      return `<div class="scans" data-scans-op="${esc(op.id)}">
        ${add ? `<div class="scan-add">
          <div class="field"><label for="scan-kind">${th("Rodzaj")}</label><select class="ctrl" id="scan-kind">${Object.entries(R.SCAN_KINDS).map(([k, l]) => `<option value="${k}" ${k === def ? "selected" : ""}>${esc(t(l))}</option>`).join("")}</select></div>
          <label class="btn" for="scan-file">${ic("up", 15)} ${th("Dodaj pliki")}</label><input type="file" id="scan-file" class="sr-only" multiple accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/tiff,.heic,.tif,.tiff">
          <label class="btn" for="scan-cam">${ic("eye", 15)} ${th("Zrób zdjęcie")}</label><input type="file" id="scan-cam" class="sr-only" accept="image/*" capture="environment">
          <div class="scan-drop" id="scan-drop">${th("…albo przeciągnij pliki tutaj (PDF, JPG, PNG, WEBP, HEIC, TIFF; do 25 MB)")}</div>
          <div class="scan-progress hidden" id="scan-progress" role="status"></div></div>` : ""}
        ${groups.length ? groups.map(([k, l]) => `<div class="scan-group"><h5>${esc(t(R.SCAN_KINDS[k]))} <small class="dim">(${l.length})</small></h5><ul class="scan-list">${l.map(s => `
          <li class="scan-item" data-scan="${esc(s.id)}"><button type="button" class="scan-thumb" data-scan-open="${esc(s.id)}" aria-label="${esc(t("Otwórz {n}", { n: s.name }))}">${isImg(s) ? `<img alt="" loading="lazy" data-thumb="${esc(s.id)}">` : `<span class="scan-ico">${s.type === "application/pdf" ? "PDF" : esc((R.SCAN_TYPES[s.type] || "").toUpperCase())}</span>`}</button>
            <div class="scan-meta"><b title="${esc(s.name)}">${esc(s.name)}</b><small>${esc(kb(s.size))} · ${esc(s.by)} · ${esc(R.Dates.ts(s.at))}</small><small class="mono dim" title="${esc(s.file)}">${esc(s.folder || s.file.split("/")[0])}</small></div>
            <div class="scan-act"><button type="button" class="btn sm" data-scan-dl="${esc(s.id)}">${ic("dl", 13)} ${th("Pobierz")}</button>${del ? `<button type="button" class="btn sm danger" data-scan-del="${esc(s.id)}" aria-label="${esc(t("Usuń skan {n}", { n: s.name }))}">${ic("trash", 13)}</button>` : ""}</div></li>`).join("")}</ul></div>`).join("")
          : `<p class="dim" id="scan-empty">${th("Brak skanów i zdjęć w tej operacji.")}</p>`}
      </div>`;
    },
    /** Wstawienie panelu w kontener i obsługa zdarzeń; `after` — odświeżenie po zmianie. */
    mount(box, opId) {
      if (!box) return;
      const op = () => R.byId(Store.state.operations, opId);
      const render = () => { const o = op(); if (!o) return; box.innerHTML = this.panelHtml(o); bind(); };
      const progress = txt => { const p = $("#scan-progress", box); if (p) { p.textContent = txt || ""; p.classList.toggle("hidden", !txt); } };
      const send = async files => {
        const kind = ($("#scan-kind", box) || {}).value || this.defaultKind(op());
        let ok = 0; const errs = [];
        for (let i = 0; i < files.length; i++) {
          progress(t("Wysyłanie {a} z {b}: {n}", { a: i + 1, b: files.length, n: files[i].name }));
          const r = await this.upload(opId, kind, files[i]);
          if (r && r.ok) ok++; else errs.push(`${files[i].name}: ${(r && r.error) || t("błąd")}`);
        }
        progress("");
        if (ok) Toast.ok(t("Dodano skany: {n}", { n: ok }));
        if (errs.length) Toast.err(t("Nie dodano części plików"), errs.slice(0, 3).join(" · "));
        render(); App.render({ keepForm: true });
      };
      const bind = async () => {
        const f = $("#scan-file", box), c = $("#scan-cam", box), d = $("#scan-drop", box);
        if (f) f.onchange = () => { const l = Array.from(f.files || []); f.value = ""; if (l.length) send(l); };
        if (c) c.onchange = () => { const l = Array.from(c.files || []); c.value = ""; if (l.length) send(l); };
        if (d) {
          ["dragenter", "dragover"].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.add("on"); }));
          ["dragleave", "drop"].forEach(ev => d.addEventListener(ev, e => { e.preventDefault(); d.classList.remove("on"); }));
          d.addEventListener("drop", e => { const l = Array.from((e.dataTransfer && e.dataTransfer.files) || []); if (l.length) send(l); });
        }
        const o = op(); if (!o) return;
        const byId = id => R.Scans.live(o).find(s => s.id === id);
        $$("[data-scan-open]", box).forEach(b => b.onclick = async () => { const s = byId(b.dataset.scanOpen), u = s && await this.url(o, s); if (u) root.open(u, "_blank", "noopener"); });
        $$("[data-scan-dl]", box).forEach(b => b.onclick = async () => {
          const s = byId(b.dataset.scanDl), u = s && await this.url(o, s); if (!u) return Toast.err(t("Nie znaleziono pliku skanu"));
          const a = document.createElement("a"); a.href = Store.mode === "server" ? u + "&download=1" : u; a.download = s.name || s.file.split("/").pop(); document.body.appendChild(a); a.click(); a.remove();
        });
        $$("[data-scan-del]", box).forEach(b => b.onclick = async () => {
          const s = byId(b.dataset.scanDel); if (!s) return;
          const r = await Modal.confirm({ title: t("Usunąć skan z operacji?"), text: t("„{n}” zniknie z operacji. Plik zostaje w folderze skanów i w kopii zapasowej, a usunięcie trafia do dziennika audytu.", { n: s.name }), ok: t("Usuń skan"), danger: true, input: { label: t("Powód (opcjonalnie)") } });
          if (!r.ok) return;
          const res = await Store.exec("scan.remove", { opId, scanId: s.id, reason: r.value || "" }, N_("Skany dokumentów"));
          if (res && res.ok) { Toast.ok(t("Skan usunięty z operacji")); render(); } else Toast.err(t("Nie usunięto"), (res && res.error) || "");
        });
        // miniatury zdjęć (leniwie)
        for (const img of $$("[data-thumb]", box)) {
          const s = byId(img.dataset.thumb); if (!s) continue;
          img.onerror = () => { const sp = document.createElement("span"); sp.className = "scan-ico"; sp.textContent = (R.SCAN_TYPES[s.type] || "IMG").toUpperCase(); img.replaceWith(sp); };
          const u = await this.url(o, s); if (u) img.src = u;
        }
      };
      render();
    },
    /** Tryb lokalny: kopia wszystkich skanów jako ZIP (foldery „SKANY <MIESIĄC> <ROK>”). */
    async exportZip() {
      const files = await LocalFiles.all();
      if (!files.length) { Toast.info(t("Brak skanów w tej przeglądarce")); return; }
      const parts = [];
      for (const f of files) parts.push({ name: f.file, data: new Uint8Array(await f.blob.arrayBuffer()) });
      const zip = root.RIW_OFFICE ? root.RIW_OFFICE.zip(parts) : null;
      if (!zip) { Toast.err(t("Nie udało się utworzyć pliku ZIP")); return; }
      UI.download(`ResInvest_skany_${new Date().toISOString().slice(0, 10)}.zip`, zip, "application/zip");
      Toast.ok(t("Kopia skanów pobrana"), t("{n} plików", { n: files.length }));
    },
    LocalFiles
  };
  UI.Scans = Scans;
})(typeof globalThis !== "undefined" ? globalThis : this);
