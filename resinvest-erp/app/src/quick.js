/* =========================================================================
   ResInvest ERP — szybki wpis (3.11)
   1. Kwity z wagi: wklejenie / czytnik kodów (działa jak klawiatura) / plik programu wagowego (CSV, TXT, JSON) /
      zdjęcie lub aparat z kodem QR → numer kwitu, waga netto i nr rejestracyjny wpisują się do kursów.
      Dekoder QR: wbudowany BarcodeDetector przeglądarki, a gdy go brak — dołączona biblioteka jsQR (offline).
   2. Szybki kurs (telefon): kierowca przy załadunku — wzorzec (szablon albo ostatnia operacja), auto, kwit, waga, zapis.
   Logika (parser kwitów, szablony, zapis operacji) jest w silniku — tu wyłącznie interfejs.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, N_, esc, $, $$, ic, fid, lsGet, lsSet, Toast, Modal, Store, App, Views } = UI;
  const { fmtQ, NumParse, Dates } = R;

  /* ---------------- dekoder QR (aparat / zdjęcie) ---------------- */
  const QR = {
    native: null,
    async detector() {
      if (this.native !== null) return this.native;
      this.native = false;
      try {
        if ("BarcodeDetector" in root) {
          const f = await root.BarcodeDetector.getSupportedFormats();
          if (f.includes("qr_code")) this.native = new root.BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "data_matrix", "pdf417"].filter(x => f.includes(x)) });
        }
      } catch (e) { this.native = false; }
      return this.native;
    },
    /** Odczyt z obrazu / klatki filmu: tekst kodu albo null. */
    async decode(source) {
      const det = await this.detector();
      if (det) { try { const r = await det.detect(source); if (r && r.length) return r[0].rawValue; } catch (e) {} }
      if (typeof root.jsQR !== "function") return null;
      const w = source.videoWidth || source.naturalWidth || source.width, h = source.videoHeight || source.naturalHeight || source.height;
      if (!w || !h) return null;
      const k = Math.min(1, 1280 / Math.max(w, h)), cw = Math.round(w * k), ch = Math.round(h * k);
      const c = document.createElement("canvas"); c.width = cw; c.height = ch;
      const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(source, 0, 0, cw, ch);
      const img = g.getImageData(0, 0, cw, ch), r = root.jsQR(img.data, cw, ch, { inversionAttempts: "attemptBoth" });
      return r && r.data ? r.data : null;
    },
    async fromFile(file) {
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error(t("Nie można odczytać obrazu"))); img.src = url; });
        return await this.decode(img);
      } finally { URL.revokeObjectURL(url); }
    },
    /** Skanowanie aparatem (tylne): onCode(tekst) przy każdym nowym kodzie; zwraca funkcję zatrzymania. */
    async camera(video, onCode, onError) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onError(t("Ta przeglądarka nie udostępnia aparatu (wymagane HTTPS albo plik lokalny w Chrome / Edge / Safari).")); return () => {}; }
      let stream = null, stop = false, last = "", lastAt = 0;
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false }); }
      catch (e) { onError(e && e.name === "NotAllowedError" ? t("Brak zgody na użycie aparatu — zezwól w ustawieniach przeglądarki.") : t("Nie udało się uruchomić aparatu: {m}", { m: e.message || e.name })); return () => {}; }
      video.srcObject = stream; video.setAttribute("playsinline", ""); video.muted = true;
      try { await video.play(); } catch (e) {}
      const tick = async () => {
        if (stop) return;
        if (video.readyState >= 2) {
          const code = await this.decode(video);
          if (code && (code !== last || Date.now() - lastAt > 4000)) { last = code; lastAt = Date.now(); onCode(code); }
        }
        setTimeout(tick, 250);
      };
      tick();
      return () => { stop = true; if (stream) stream.getTracks().forEach(tr => tr.stop()); video.srcObject = null; };
    }
  };
  const beep = () => {
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) {}
    try { const A = root.AudioContext || root.webkitAudioContext; if (!A) return; const a = new A(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 1320; g.gain.value = 0.08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 0.09); setTimeout(() => a.close(), 300); } catch (e) {}
  };
  const readText = file => new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result || "")); fr.onerror = () => bad(fr.error); fr.readAsText(file, "utf-8"); });

  /* ---------------- okno „Kwity z wagi” ---------------- */
  /**
   * runs: [{ label, reg, kwit, weightT }] — kursy formularza (kolejność jak w formularzu);
   * opts.canAdd — czy można dopisać nowe kursy; apply(rows) — rows: [{ ticket, run: indeks | "new" | null }].
   */
  const ScaleImport = {
    open(runs, apply, opts = {}) {
      const used = R.Scale.usedKwity(Store.state);
      let parsed = { tickets: [], errors: [] }, assign = [], stopCam = null;
      const m = Modal.open({ id: "scale-dlg", wide: true, title: t("Kwity z wagi"),
        sub: esc(t("Numer kwitu, waga netto i nr rejestracyjny wpiszą się do kursów. Czytnik kodów (USB / Bluetooth) działa jak klawiatura — zeskanuj kwit do pola poniżej.")),
        onClose: () => { if (stopCam) stopCam(); },
        body: `<div class="scale-src">
            <div class="field"><label for="sc-text">${esc(t("Zeskanuj albo wklej kwit(y)"))}</label>
              <textarea class="ctrl mono" id="sc-text" rows="4" spellcheck="false" placeholder="${esc("KWIT=7096;NETTO=7780;REJ=SGL 4T821")}"></textarea>
              <div class="help">${esc(t("Każdy kod w osobnej linii. Formaty: KWIT=…;NETTO=…;REJ=…, JSON albo CSV z programu wagi (kolumny: kwit, netto lub brutto i tara, nr rej.). Kilogramy przeliczają się na tony."))}</div></div>
            <div class="row wrap gap2">
              <label class="btn" for="sc-file">${ic("dl", 15)} ${esc(t("Plik z wagi (CSV / TXT / JSON)"))}</label><input type="file" id="sc-file" class="sr-only" accept=".csv,.txt,.json,.tsv,text/plain,application/json,text/csv">
              <label class="btn" for="sc-img">${ic("qr", 15)} ${esc(t("Zdjęcie kodu QR"))}</label><input type="file" id="sc-img" class="sr-only" accept="image/*" capture="environment">
              <button class="btn" type="button" id="sc-cam">${ic("qr", 15)} ${esc(t("Skanuj aparatem"))}</button>
            </div>
            <div class="scan-box hidden" id="sc-cam-box"><video id="sc-video" playsinline muted></video><div class="scan-frame" aria-hidden="true"></div>
              <div class="row"><span class="dim" id="sc-cam-msg">${esc(t("Skieruj aparat na kod QR kwitu…"))}</span><span class="spacer"></span><button class="btn sm" type="button" id="sc-cam-stop">${esc(t("Zatrzymaj"))}</button></div></div>
          </div>
          <div id="sc-preview" class="mt4"></div>`,
        footer: `<button class="btn ghost" type="button" data-no>${esc(t("Anuluj"))}</button><button class="btn primary" type="button" id="sc-apply" disabled>${ic("check", 15)} ${esc(t("Wpisz do kursów"))}</button>` });
      const $m = s => $(s, m.el), ta = $m("#sc-text");
      const runOpts = cur => [`<option value="">${esc(t("— pomiń —"))}</option>`].concat(runs.map((r, i) => `<option value="${i}" ${cur === i ? "selected" : ""}>${esc(r.label)}${r.weightT ? " · " + esc(t("ma wagę")) : ""}</option>`))
        .concat(opts.canAdd ? [`<option value="new" ${cur === "new" ? "selected" : ""}>${esc(t("+ nowy kurs"))}</option>`] : []).join("");
      const preview = () => {
        parsed = R.Scale.parse(ta.value);
        const auto = R.Scale.match(parsed.tickets, runs);
        assign = auto.map(a => ({ ticket: a.ticket, run: a.run !== null ? a.run : opts.canAdd ? "new" : null, by: a.by }));
        const box = $m("#sc-preview");
        if (!ta.value.trim()) { box.innerHTML = ""; $m("#sc-apply").disabled = true; return; }
        box.innerHTML = `${parsed.errors.length ? `<ul class="warn-list">${parsed.errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
          ${assign.length ? `<div class="tbl-wrap"><table class="tbl" id="sc-table"><thead><tr><th>${esc(t("Kwit"))}</th><th>${esc(t("Nr rej."))}</th><th class="r">${esc(t("Netto"))}</th><th>${esc(t("Kurs"))}</th></tr></thead><tbody>
            ${assign.map((a, i) => { const dup = a.ticket.no && used.get(a.ticket.no.toUpperCase());
              return `<tr><td class="mono"><b>${esc(a.ticket.no || "—")}</b>${dup ? `<br><span class="badge warn">${esc(t("już w {no}", { no: dup }))}</span>` : ""}</td><td class="mono">${esc(a.ticket.reg || "—")}</td>
                <td class="r num"><b>${a.ticket.netT !== null ? esc(fmtQ(a.ticket.netT)) + " t" : "—"}</b>${a.ticket.grossT !== null ? `<br><small class="dim">${esc(fmtQ(a.ticket.grossT))} − ${esc(fmtQ(a.ticket.tareT || 0))}</small>` : ""}</td>
                <td><select class="ctrl" data-sc="${i}" aria-label="${esc(t("Kurs dla kwitu {k}", { k: a.ticket.no || i + 1 }))}">${runOpts(a.run)}</select>${a.by === "reg" ? `<small class="dim">${esc(t("dopasowano po nr rej."))}</small>` : ""}</td></tr>`; }).join("")}
          </tbody></table></div>` : ""}`;
        $$("[data-sc]", box).forEach(s => s.onchange = () => { const v = s.value; assign[+s.dataset.sc].run = v === "" ? null : v === "new" ? "new" : Number(v); });
        $m("#sc-apply").disabled = !assign.length;
      };
      let deb = null;
      ta.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(preview, 150); });
      // czytnik kodów kończy odczyt Enterem — nowa linia na kolejny kwit (bez wysyłania formularza)
      ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $m("#sc-apply").click(); } });
      const addCode = code => { ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + String(code).trim(); preview(); beep(); };
      $m("#sc-file").onchange = async e => { const f = e.target.files[0]; if (!f) return; try { ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + (await readText(f)).trim(); preview(); } catch (x) { Toast.err(t("Nie odczytano pliku"), x.message); } e.target.value = ""; };
      $m("#sc-img").onchange = async e => {
        const f = e.target.files[0]; if (!f) return; e.target.value = "";
        try { const code = await QR.fromFile(f); if (code) addCode(code); else Toast.warn(t("Nie znaleziono kodu QR na zdjęciu"), t("Zrób zdjęcie bliżej, prosto i przy dobrym świetle.")); }
        catch (x) { Toast.err(t("Nie odczytano zdjęcia"), x.message); }
      };
      $m("#sc-cam").onclick = async () => {
        $m("#sc-cam-box").classList.remove("hidden");
        if (stopCam) return;
        stopCam = await QR.camera($m("#sc-video"), code => { addCode(code); $m("#sc-cam-msg").textContent = t("Odczytano: {c}", { c: String(code).slice(0, 60) }); },
          msg => { $m("#sc-cam-msg").textContent = msg; Toast.err(t("Aparat niedostępny"), msg); stopCam = null; });
      };
      $m("#sc-cam-stop").onclick = () => { if (stopCam) stopCam(); stopCam = null; $m("#sc-cam-box").classList.add("hidden"); };
      $("[data-no]", m.el).onclick = () => m.close();
      $m("#sc-apply").onclick = () => {
        const rows = assign.filter(a => a.run !== null);
        if (!rows.length) { Toast.warn(t("Nie wybrano kursów"), t("Wskaż kurs dla co najmniej jednego kwitu.")); return; }
        if (stopCam) stopCam(); stopCam = null;
        m.close(); apply(rows);
      };
      if (opts.initial) { ta.value = opts.initial; preview(); }
      setTimeout(() => ta.focus(), 30);
      return m;
    }
  };

  /* ---------------- Szybki kurs (telefon) ---------------- */
  const QK_BASE = "riw.quickBase";
  const Quick = {
    st: null,
    /** Wzorce: szablony operacji z transportem i ostatnie operacje magazynu z transportem własnym. */
    bases() {
      const S = Store.state, u = App.user(), wh = App.wh() && App.wh().id;
      const tpls = R.Templates.visible(S, u, wh).filter(x => x.draft && x.draft.transport).map(x => ({ id: "tp:" + x.id, label: x.name, sub: x.summary, draft: x.draft }));
      const ops = [], seen = new Set();
      for (let i = S.operations.length - 1; i >= 0 && ops.length < 6; i--) {
        const o = S.operations[i];
        if (o.deleted || o.status === "CANCELLED" || !o.input || o.whId !== wh || !o.transport || !["own", "mixed"].includes(o.transport.mode)) continue;
        const sum = R.Templates.describe(S, o.input);
        if (seen.has(sum)) continue; seen.add(sum);
        ops.push({ id: "op:" + o.id, label: t("Jak {no}", { no: o.no }), sub: sum, draft: o.input });
      }
      return tpls.concat(ops);
    },
    baseQty(d) {
      const k = d.type === "ZAKUP" ? "purchase" : d.type === "SPRZEDAZ" ? "sale" : d.type === "MM" ? "mm" : null;
      const r0 = d.transport && d.transport.own && d.transport.own.runs && d.transport.own.runs[0];
      return { key: k, qty: (r0 && String(r0.qty || "").trim()) || (k && String(d[k].qty || "").trim()) || "", unit: k ? d[k].unit : "" };
    },
    state() {
      const list = this.bases(), want = lsGet(QK_BASE, "");
      if (!this.st || !list.some(b => b.id === this.st.base)) this.st = { base: (list.find(b => b.id === want) || list[0] || {}).id || "", veh: "", driver: "", kwit: "", weight: "", qty: "", idem: R.uid("idem") };
      return { list, st: this.st, base: list.find(b => b.id === this.st.base) || null };
    },
    html() {
      if (!App.can("op.create")) return `<div class="info-line err">${ic("alert", 15)}<span>${esc(t("Twoja rola nie pozwala tworzyć operacji."))}</span></div>`;
      const { list, st, base } = this.state();
      const S = Store.state;
      if (!list.length) return `<div class="page-head"><div class="titles"><h2>${esc(t("Szybki kurs"))}</h2></div></div>
        <div class="empty">${esc(t("Brak wzorca kursu. Wprowadź pierwszą operację z transportem własnym w „Nowej operacji” i zapisz ją jako szablon — potem kurs wpiszesz tu w kilka sekund."))}<div class="mt3"><a class="btn primary" href="#/nowa">${esc(t("Nowa operacja"))}</a></div></div>`;
      const bq = this.baseQty(base.draft);
      const ownVeh = S.fleet.vehicles.filter(v => v.owner !== "external" && (!v.whId || v.whId === (App.wh() && App.wh().id)));
      const r0 = R.FleetPick.resolveDraft(S, { transport: { own: { runs: [R.clone((base.draft.transport.own && base.draft.transport.own.runs && base.draft.transport.own.runs[0]) || {})] } } }).transport.own.runs[0];
      const defVeh = R.byId(S.fleet.vehicles, r0.vehicleId), defDrv = R.byId(S.fleet.drivers, r0.driverId);
      return `<div class="quick" id="quick">
        <div class="quick-head"><h2>${ic("truck", 20)} ${esc(t("Szybki kurs"))}</h2><p class="dim">${esc(t("Auto, kwit, waga — zapis. Reszta z wzorca."))}</p></div>
        <div class="field"><label for="qk-base">${esc(t("Wzorzec (szablon / poprzednia operacja)"))}</label>
          <select class="ctrl big" id="qk-base">${list.map(b => `<option value="${esc(b.id)}" ${b.id === st.base ? "selected" : ""}>${esc(b.label)}</option>`).join("")}</select>
          <div class="help" id="qk-base-sub">${esc(base.sub)}</div></div>
        <button class="btn big block" type="button" id="qk-scan">${ic("qr", 20)} ${esc(t("Skanuj kwit z wagi"))}</button>
        <div class="field"><label for="qk-veh">${esc(t("Auto (nr rej.)"))} <span class="req">*</span></label>
          <input class="ctrl big" id="qk-veh" list="qk-dl-veh" autocomplete="off" autocapitalize="characters" value="${esc(st.veh || (defVeh ? `${defVeh.reg} · ${defVeh.name}` : String(r0.vehicleReg || "")))}" placeholder="${esc(t("wybierz albo wpisz, np. WGM 12345"))}">
          <datalist id="qk-dl-veh">${ownVeh.map(v => `<option value="${esc(`${v.reg} · ${v.name}`)}">`).join("")}</datalist></div>
        <div class="field"><label for="qk-drv">${esc(t("Kierowca"))} <span class="req">*</span></label>
          <input class="ctrl big" id="qk-drv" list="qk-dl-drv" autocomplete="off" value="${esc(st.driver || (defDrv ? defDrv.name : String(r0.driverName || "")))}" placeholder="${esc(t("wybierz albo wpisz imię i nazwisko"))}">
          <datalist id="qk-dl-drv">${S.fleet.drivers.map(x => `<option value="${esc(x.name)}">`).join("")}</datalist></div>
        <div class="grid2">
          <div class="field"><label for="qk-kwit">${esc(t("Nr kwitu"))}</label><input class="ctrl big mono" id="qk-kwit" autocomplete="off" value="${esc(st.kwit)}" placeholder="7096"></div>
          <div class="field"><label for="qk-qty">${esc(t("Ilość ({u})", { u: R.Units.label(bq.unit || "MP") }))}</label><input class="ctrl big num-in" id="qk-qty" inputmode="decimal" autocomplete="off" value="${esc(st.qty || bq.qty)}" placeholder="${esc(bq.qty || "90")}"></div>
        </div>
        <div class="field"><label for="qk-weight">${esc(t("Waga netto (t)"))}</label>
          <div class="led-wrap"><input class="ctrl led" id="qk-weight" inputmode="decimal" autocomplete="off" value="${esc(st.weight)}" placeholder="0,00"><span class="led-u">t</span></div></div>
        <div class="msg hidden" id="qk-msg" role="alert"></div>
        <button class="btn primary big block" type="button" id="qk-save">${ic("check", 20)} ${esc(t("Zapisz kurs"))}</button>
        <div class="row wrap mt3"><button class="btn ghost sm" type="button" id="qk-full">${esc(t("Otwórz w pełnym formularzu"))}</button><span class="spacer"></span><small class="dim">${esc(t("Data: {d} · magazyn {w}", { d: Dates.pl(App.today()), w: App.whName(App.wh() && App.wh().id) }))}</small></div>
        <div id="qk-last" class="mt4"></div>
      </div>`;
    },
    /** Formularz → dane operacji (wzorzec na dziś + jeden kurs). */
    draft() {
      const { st, base } = this.state(), S = Store.state;
      const d = R.Templates.instantiate(base.draft, { today: App.today() });
      d.idemKey = st.idem;
      d.transport.mode = "own";                                  // szybki kurs = jeden kurs floty własnej
      const prev = (d.transport.own && d.transport.own.runs && d.transport.own.runs[0]) || R.blankRun();
      const vp = R.FleetPick.vehicle(S, st.veh), veh = vp && vp.rec && vp.rec.owner !== "external" ? vp.rec : null;
      const dp = R.FleetPick.person(S.fleet.drivers, st.driver), drv = dp && dp.rec ? dp.rec : null;
      const run = Object.assign(R.blankRun(), { km: prev.km || "", rate: prev.rate || "", qty: st.qty, kwit: st.kwit, weightT: st.weight,
        vehicleId: veh ? veh.id : "", vehicleReg: veh ? "" : st.veh, driverId: drv ? drv.id : "", driverName: drv ? "" : st.driver });
      d.transport.own = { runCount: "1", runs: [run] };
      const bq = this.baseQty(d);
      if (bq.key && String(st.qty).trim()) d[bq.key].qty = st.qty;
      // waga z kwitu = tonaż dokumentu (ręczny), gdy dokument ma tonaż
      if (bq.key && String(st.weight).trim() && "weightManual" in d[bq.key]) { d[bq.key].weightMode = "manual"; d[bq.key].weightManual = st.weight; }
      return d;
    },
    read(page) {
      const v = id => ($("#" + id, page) || {}).value || "";
      Object.assign(this.st, { veh: v("qk-veh"), driver: v("qk-drv"), kwit: v("qk-kwit"), weight: v("qk-weight"), qty: v("qk-qty") });
    },
    bind(page) {
      const q = $("#quick", page); if (!q) return;
      const sel = $("#qk-base", page);
      if (sel) sel.onchange = () => { this.read(page); this.st.base = sel.value; lsSet(QK_BASE, sel.value); this.st.veh = ""; this.st.driver = ""; this.st.qty = ""; App.render(); };
      $$("input", q).forEach(el => el.addEventListener("input", () => { this.read(page); const m = $("#qk-msg", page); m.classList.add("hidden"); }));
      // Enter → następne pole; na ostatnim — zapis
      const order = ["qk-veh", "qk-drv", "qk-kwit", "qk-qty", "qk-weight"];
      q.addEventListener("keydown", e => {
        if (e.key !== "Enter" || !e.target.id || !order.includes(e.target.id)) return;
        e.preventDefault();
        const i = order.indexOf(e.target.id), next = order[i + 1] && $("#" + order[i + 1], page);
        if (next) { next.focus(); next.select && next.select(); } else this.save(page);
      });
      // auto z kartoteki → kierowca domyślny (gdy pole kierowcy puste albo zawiera domyślnego poprzedniego auta);
      // podczas wpisywania numeru — zanim fokus przejdzie do pola kierowcy (bez dopisywania do wpisywanego tekstu)
      let autoDrv = "";
      $("#qk-veh", page).addEventListener("input", () => {
        const p = R.FleetPick.vehicle(Store.state, $("#qk-veh", page).value), v = p && p.rec;
        const dEl = $("#qk-drv", page), cur = dEl.value.trim();
        if (!v || document.activeElement === dEl || (cur && cur !== autoDrv)) return;
        const d = R.byId(Store.state.fleet.drivers, v.driverId);
        if (d && d.name !== cur) { dEl.value = d.name; autoDrv = d.name; this.read(page); }
      });
      $("#qk-scan", page).onclick = () => ScaleImport.open([{ label: t("Ten kurs"), reg: R.FleetPick.split($("#qk-veh", page).value).head, kwit: "", weightT: "" }], rows => {
        const tk = rows[0].ticket;
        if (tk.no) $("#qk-kwit", page).value = tk.no;
        if (tk.netT !== null) $("#qk-weight", page).value = fmtQ(tk.netT);
        if (tk.reg && !$("#qk-veh", page).value.trim()) $("#qk-veh", page).value = tk.reg;
        this.read(page);
        Toast.ok(t("Kwit {k} wczytany", { k: tk.no || "" }), tk.netT !== null ? t("Waga netto {w} t", { w: fmtQ(tk.netT) }) : "");
        $("#qk-save", page).focus();
      });
      $("#qk-save", page).onclick = () => this.save(page);
      $("#qk-full", page).onclick = () => {
        this.read(page);
        const Form = root.RIWForm;
        Form.mode = "new"; Form.op = null; Form.review = null; Form.draft = Object.assign(this.draft(), { _user: Store.userId });
        Form.touched = new Set(); Form.showAll = false; Form.persist();
        location.hash = "#/nowa";
      };
      this.lastInfo(page);
    },
    lastInfo(page) {
      const box = $("#qk-last", page); if (!box || !this.lastNo) return;
      box.innerHTML = `<div class="info-line ok">${ic("check", 15)}<span>${esc(t("Zapisano {no} — kurs {r}, {w} t. Następny kurs: zeskanuj kwit albo wpisz wagę.", { no: this.lastNo, r: this.lastReg || "", w: this.lastW || "—" }))}</span></div>`;
    },
    async save(page) {
      if (this.saving) return;
      this.read(page);
      const msg = $("#qk-msg", page), show = s => { msg.textContent = s; msg.classList.remove("hidden"); };
      if (!this.st.veh.trim()) { show(t("Wybierz albo wpisz auto")); $("#qk-veh", page).focus(); return; }
      const d = this.draft();
      const plan = R.planOperation(Store.state, d, App.ctx(N_("Szybki kurs")));
      if (!plan.ok) {
        const e = plan.errorList[0];
        const map = { vehicleId: "qk-veh", driverId: "qk-drv", kwit: "qk-kwit", weightT: "qk-weight", qty: "qk-qty" };
        const f = Object.keys(map).find(k => e.field.endsWith("." + k));
        show(e.msg + (f ? "" : " " + t("(pole spoza szybkiego kursu — użyj „Otwórz w pełnym formularzu”)")));
        if (f) $("#" + map[f], page).focus();
        return;
      }
      const action = !Store.state.config.requireApproval || R.canApprove(App.user(), App.wh() && App.wh().id) ? "op.commit" : "op.submit";
      this.saving = true; const b = $("#qk-save", page); b.disabled = true;
      const res = await Store.exec(action, { draft: d }, N_("Szybki kurs"));
      this.saving = false; b.disabled = false;
      if (!res || !res.ok) { show(t("Nie zapisano — nic nie zostało zaksięgowane") + (res && res.error ? ": " + res.error : "")); return; }
      beep();
      this.lastNo = res.pending ? t("do zatwierdzenia") : (res.op && res.op.no) || ""; this.lastReg = R.FleetPick.split(this.st.veh).head; this.lastW = this.st.weight;
      Toast.ok(res.pending ? t("Przekazano do zatwierdzenia") : t("Kurs zapisany"), this.lastNo);
      // następny kurs: to samo auto i kierowca, nowy klucz; kwit i waga puste
      Object.assign(this.st, { kwit: "", weight: "", idem: R.uid("idem") });
      App.render();
      setTimeout(() => { const k = $("#qk-kwit"); if (k) k.focus(); }, 30);
    }
  };
  Views.kurs = { html() { return Quick.html(); }, bind(page) { Quick.bind(page); } };

  Object.assign(UI, { ScaleImport, QR, Quick });
})(typeof globalThis !== "undefined" ? globalThis : this);
