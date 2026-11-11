/* =========================================================================
   ResInvest ERP 3.16 — moduł EUDR: drewno surowe / TRACES (ekrany)

   Jeden ekran „eudr” z menu modułu: Pulpit EUDR, Rejestr drewna, Dostawcy, Dokumentacja, Pochodzenie i GPS,
   Należyta staranność, EUDR TRACES (rejestr DDS, proces kontrolowany, Centrum testów), Audyt, Szkolenia, Instrukcje,
   Raporty, Historia zmian, Administracja. Pasek trybu: ACCEPTANCE (pomarańczowy) / PRODUCTION (czerwony).
   Cała logika w silniku (R.Eudr) — ekran pokazuje wynik i wysyła komendy (Store.exec); pliki: serwer (/api/eudr/files)
   albo — w trybie bez serwera — baza plików przeglądarki (IndexedDB), jak skany dokumentów.
   Teksty modułu po polsku (terminologia prawna EUDR).
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, esc, $, $$, ic, Toast, Modal, Store, App, Views, ServerBackend, download } = UI;
  const E = R.Eudr, P = E.P, { Dates, fmtQ: fq } = R;
  const SRC = "EUDR";
  const ST = () => Store.state;
  const me = () => App.user();
  const can = a => E.allowed(ST(), me(), a);
  const T = () => App.tabs.eudr || (App.tabs.eudr = { tab: "dash", q: "", status: "", color: "", acq: "", arch: false, sel: [], docType: "", docQ: "", showOther: false, hFrom: "", hTo: "", hQ: "", repFrom: "", repTo: "" });
  const fail = res => { Toast.err("Nie zapisano", [res.error, res.errors ? Object.values(res.errors).join("; ") : "", res.blocks ? res.blocks.join("; ") : "", res.missing ? res.missing.join("; ") : ""].filter(Boolean).join(" — ")); };
  const exec = async (cmd, args, okMsg) => { const res = await Store.exec(cmd, args, SRC); if (!res.ok) { if (res.code !== "NOCHANGE") fail(res); } else if (okMsg) Toast.ok(okMsg); return res; };
  const fld = (id, label, inner, cls) => `<div class="field ${cls || ""}"><label for="${id}">${esc(label)}</label>${inner}</div>`;
  const val = v => v === null || v === undefined ? "" : v;
  const inp = (id, v, attrs) => `<input class="ctrl" id="${id}" value="${esc(val(v))}" ${attrs || ""}>`;
  const area = (id, v, rows, attrs) => `<textarea class="ctrl" id="${id}" rows="${rows || 3}" ${attrs || ""}>${esc(val(v))}</textarea>`;
  const sel = (id, opts, v, attrs) => `<select class="ctrl" id="${id}" ${attrs || ""}>${opts.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val(v)) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  const opts = (map, empty) => (empty !== undefined ? [["", empty]] : []).concat(Object.entries(map));
  const gv = (m, id) => { const el = $("#" + id, m && m.el ? m.el : m); return el ? (el.type === "checkbox" ? el.checked : el.value) : undefined; };
  const dpl = d => d ? Dates.pl(d) : "—";
  const dtpl = ts => ts ? `${Dates.pl(String(ts).slice(0, 10))} ${String(ts).slice(11, 16)}` : "—";
  const partnerName = id => { const p = R.byId(ST().partners || [], id); return p ? p.name : ""; };
  const whName = id => App.whName(id);
  const lotOf = id => R.byId(ST().eudrLots || [], id);
  const unitOf = l => { const p = R.byId(ST().products, l.productId); return p ? R.Units.label(p.unit) : ""; };
  const ctx = () => ({ today: App.today() });
  const dot = c => `<span class="eu-dot eu-${esc(c)}" title="${esc(E.COLORS[c] || "")}"></span>`;
  const statusBadge = l => `<span class="badge eu-st-${esc(l.status)}">${esc(E.LOT_STATUS[l.status] || l.status)}</span>`;
  const envBanner = () => E.envOf(ST()) === "PRODUCTION"
    ? `<div class="eu-env eu-env-prod" id="eu-env" role="status">${ic("alert", 16)} <b>TRYB PRODUKCYJNY – OPERACJE MOGĄ WYWOŁYWAĆ SKUTKI PRAWNE</b></div>`
    : `<div class="eu-env eu-env-acc" id="eu-env" role="status">${ic("alert", 16)} <b>TRYB TESTOWY – DANE NIE MAJĄ MOCY PRAWNEJ</b> <span>środowisko ACCEPTANCE</span></div>`;
  const portal = env => { const c = (root.RIW_CONFIG && root.RIW_CONFIG.eudr && root.RIW_CONFIG.eudr.traces) || {}; return (c[env] && (c[env].portal || c[env].base)) || ""; };
  const MENU = [["dash", "Pulpit EUDR", "home"], ["lots", "Rejestr drewna", "layers"], ["suppliers", "Dostawcy", "users"], ["docs", "Dokumentacja", "file"], ["geo", "Pochodzenie i GPS", "globe"],
    ["dd", "Należyta staranność", "shieldCheck"], ["traces", "EUDR TRACES", "server"], ["audit", "Audyt", "clipboard"], ["training", "Szkolenia", "star"], ["guides", "Instrukcje", "list"],
    ["reports", "Raporty", "chart"], ["history", "Historia zmian", "clock"], ["admin", "Administracja", "settings"]];

  /* ------------------------------------------------------------------ */
  /* Pliki dokumentów                                                    */
  /* ------------------------------------------------------------------ */
  const Files = {
    local: () => UI.Scans && UI.Scans.LocalFiles,
    /** Wysłanie pliku i zapis dokumentu (meta: pola dokumentu; id — nowa wersja istniejącego). */
    async upload(meta, file) {
      if (!file) return Store.exec("eudr.doc.save", Object.assign({}, meta, { noFile: true }), SRC);
      if (file.size > E.FILE_MAX) return { ok: false, error: P("Plik jest za duży (najwięcej {n} MB)", { n: E.FILE_MAX / 1048576 }) };
      const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer()), type = E.sniff(head, file.name);
      if (!type) return { ok: false, error: "Dozwolone pliki: PDF, JPG, PNG, WEBP, TIFF, GeoJSON, JSON, XML, CSV, TXT (bez treści aktywnej)" };
      if (Store.mode === "server") {
        const have = ServerBackend.haveRev(), q = new URLSearchParams({ meta: JSON.stringify(meta), name: file.name || "dokument" });
        if (have !== null) q.set("haveRev", String(have));
        let r, data;
        try { r = await fetch("/api/eudr/files?" + q, { method: "POST", headers: { "X-RIW": "1", "Content-Type": type }, credentials: "same-origin", body: file }); }
        catch (e) { return { ok: false, error: "Brak połączenia z serwerem — nic nie zapisano." }; }
        try { data = await r.json(); } catch (e) { data = { ok: false, error: "Nieprawidłowa odpowiedź serwera" }; }
        if (data && data.ok && ServerBackend.applyPayload(data) === null) await ServerBackend.loadState(true);
        return data || { ok: false };
      }
      const LF = this.local();
      if (!LF) return { ok: false, error: "Brak magazynu plików przeglądarki" };
      const id = R.uid("ef").replace(/[^a-z0-9_]/gi, "").toLowerCase(), key = `LOKALNIE/EUDR_${id}.${E.FILE_TYPES[type]}`;
      try { await LF.put({ id: key, blob: file, type, name: file.name || key, file: key, at: new Date().toISOString() }); }
      catch (e) { return { ok: false, error: P("Nie udało się zapisać pliku w przeglądarce: {m}", { m: e.message }) }; }
      return Store.exec("eudr.doc.save", Object.assign({}, meta, { file: { key, name: file.name || key, type, size: file.size, sha: "", local: true } }), SRC);
    },
    async url(d, v) {
      const f = d.versions[(v || d.versions.length) - 1];
      if (!f) return null;
      if (!f.local && Store.mode === "server") return `/api/eudr/files?id=${encodeURIComponent(d.id)}&v=${v || d.versions.length}`;
      const LF = this.local(); if (!LF) return null;
      const rec = await LF.get(f.key).catch(() => null);
      return rec && rec.blob ? URL.createObjectURL(rec.blob) : null;
    },
    async preview(d, v) {
      const f = d.versions[(v || d.versions.length) - 1], u = await this.url(d, v);
      if (!f || !u) return Toast.warn("Plik niedostępny", Store.mode === "server" ? "Plik nie jest zapisany na serwerze" : "Plik zapisano w innej przeglądarce / na innym urządzeniu");
      const img = /^image\/(jpeg|png|webp)$/.test(f.type), pdf = f.type === "application/pdf";
      Modal.open({ title: `${d.no} · ${f.name}`, sub: esc(`${E.DOC_TYPES[d.type]} · wersja ${f.v} · ${dtpl(f.at)} · ${f.by}`), xwide: true,
        body: img ? `<img class="eu-prev-img" src="${esc(u)}" alt="${esc(f.name)}">` : pdf ? `<iframe class="eu-prev-pdf" src="${esc(u)}" title="${esc(f.name)}"></iframe>` : `<p class="muted">Podgląd niedostępny dla tego rodzaju pliku — pobierz plik.</p>`,
        footer: `<button class="btn" type="button" id="eu-dl">${ic("dl", 15)} Pobierz</button>` });
      $("#eu-dl").onclick = () => this.save(d, v);
    },
    async save(d, v) {
      const f = d.versions[(v || d.versions.length) - 1], u = await this.url(d, v);
      if (!u) return Toast.warn("Plik niedostępny");
      const href = u.startsWith("/api/") ? u + "&download=1" : u;
      if (UI.Native && UI.Native.on) return UI.Native.saveUrl(href, f.name, false);
      const a = document.createElement("a"); a.href = href; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    }
  };

  /* ------------------------------------------------------------------ */
  /* Partie — formularz, karta, powiązania                              */
  /* ------------------------------------------------------------------ */
  const prodOpts = () => ST().products.filter(p => p.active !== false).map(p => [p.id, p.name]);
  const supOpts = () => [["", "— wybierz z kartoteki kontrahentów —"]].concat((ST().partners || []).filter(p => p.active !== false && p.role !== "buyer").map(p => [p.id, p.name]));
  const whOpts = () => App.myWarehouses().map(w => [w.id, w.name]);
  function lotDialog(lot, preset) {
    const l = lot || Object.assign({ whId: me().whId, productId: "pr_drewno", acq: "from_trader", wood: { country: "PL" }, origin: { country: "PL", riskCountry: "low" } }, preset || {});
    const w = l.wood || {}, o = l.origin || {};
    const m = Modal.open({ title: lot ? P("Partia {no}", { no: lot.no }) : "Nowa partia drewna", sub: "Dane drewna, dostawcy i pochodzenia. Ilości i ruchy wynikają z dokumentów ERP (PZ, MM, produkcja, WZ).", xwide: true,
      body: `<div class="eu-form">
        <h4 class="eu-h">Drewno</h4>
        ${fld("lf-species", "Gatunek (nazwa polska)", inp("lf-species", w.species))}${fld("lf-latin", "Gatunek — nazwa łacińska", inp("lf-latin", w.speciesLatin, 'placeholder="np. Pinus sylvestris"'))}
        ${fld("lf-kind", "Rodzaj drewna / sortyment", inp("lf-kind", w.kind))}${fld("lf-cn", "Kod CN", inp("lf-cn", w.cn, 'inputmode="numeric" placeholder="4401"'))}
        ${fld("lf-prod", "Produkt (ERP)", sel("lf-prod", prodOpts(), l.productId))}${fld("lf-wh", "Magazyn", sel("lf-wh", whOpts(), l.whId))}
        ${fld("lf-qty", P("Ilość ({u})", { u: unitOf(l) || "jednostka produktu" }), inp("lf-qty", l.qty === undefined ? "" : fq(l.qty), 'inputmode="decimal"'))}${fld("lf-m3", "Objętość m³", inp("lf-m3", l.m3 ? fq(l.m3) : "", 'inputmode="decimal"'))}
        ${fld("lf-t", "Masa netto t", inp("lf-t", l.t ? fq(l.t) : "", 'inputmode="decimal"'))}${fld("lf-recv", "Data przyjęcia", inp("lf-recv", l.receivedDate, 'type="date"'))}
        ${fld("lf-hf", "Pozyskanie od", inp("lf-hf", w.harvestFrom, 'type="date"'))}${fld("lf-ht", "Pozyskanie do", inp("lf-ht", w.harvestTo, 'type="date"'))}
        ${fld("lf-wc", "Kraj pozyskania (ISO)", inp("lf-wc", w.country, 'maxlength="2"'))}${fld("lf-reg", "Region", inp("lf-reg", w.region))}
        ${fld("lf-place", "Miejsce pozyskania", inp("lf-place", w.place), "wide")}
        <h4 class="eu-h">Dostawca i transakcja</h4>
        ${fld("lf-sup", "Dostawca", sel("lf-sup", supOpts(), l.partnerId))}${fld("lf-acq", "Sposób nabycia (rola firmy)", sel("lf-acq", Object.entries(E.ACQ).map(([k, v]) => [k, v.label]), l.acq))}
        ${fld("lf-contract", "Umowa / zamówienie", inp("lf-contract", l.contract))}${fld("lf-tr", "Transport (dokument przewozowy)", inp("lf-tr", l.transport))}
        <h4 class="eu-h">Pochodzenie</h4>
        ${fld("lf-owner", "Nadleśnictwo / właściciel", inp("lf-owner", o.owner))}${fld("lf-plot", "Działka / oddział", inp("lf-plot", o.plot))}
        ${fld("lf-oc", "Kraj (ISO)", inp("lf-oc", o.country, 'maxlength="2"'))}${fld("lf-risk", "Klasyfikacja kraju", sel("lf-risk", opts(E.RISK_COUNTRY, "—"), o.riskCountry))}
        ${fld("lf-lat", "GPS szerokość", inp("lf-lat", o.lat, 'inputmode="decimal" placeholder="50.123456"'))}${fld("lf-lon", "GPS długość", inp("lf-lon", o.lon, 'inputmode="decimal" placeholder="18.123456"'))}
        ${fld("lf-ha", "Powierzchnia działki ha", inp("lf-ha", o.areaHa, 'inputmode="decimal"'))}${fld("lf-legal", "Legalność — uwagi", inp("lf-legal", o.legalNote))}
        ${fld("lf-geo", "Polygon GIS (GeoJSON) — wymagany dla działek powyżej 4 ha", area("lf-geo", o.geojson ? JSON.stringify(JSON.parse(o.geojson), null, 1) : "", 4, 'spellcheck="false" class="ctrl mono"') + `<div class="eu-row"><input type="file" id="lf-geofile" accept=".geojson,.json,application/geo+json,application/json"><small class="muted">Wczytaj plik GeoJSON (WGS84; długość, szerokość)</small></div>`, "wide")}
        ${fld("lf-notes", "Uwagi", area("lf-notes", l.notes, 2), "wide")}
        <div class="msg hidden wide" id="lf-msg"></div></div>`,
      footer: `<button class="btn ghost" type="button" data-x2>Anuluj</button>${!lot || lot.status === "DRAFT" ? `<button class="btn" type="button" id="lf-save">Zapisz szkic</button>` : ""}<button class="btn primary" type="button" id="lf-submit">${lot && lot.status !== "DRAFT" ? "Zapisz" : "Zapisz i przekaż do weryfikacji"}</button>` });
    $("[data-x2]", m.el).onclick = m.close;
    $("#lf-geofile", m.el).onchange = async e => { const f = e.target.files[0]; if (!f) return; const txt = await f.text(); $("#lf-geo", m.el).value = txt; const c = E.checkGeo(txt); Toast[c.ok ? "ok" : "warn"](c.ok ? P("GeoJSON poprawny ({n} obiektów)", { n: c.count }) : "GeoJSON z błędami", c.ok ? "" : c.errors.join("; ")); };
    const go = async submit => {
      const args = { id: lot ? lot.id : undefined, submit, productId: gv(m, "lf-prod"), whId: gv(m, "lf-wh"), qty: gv(m, "lf-qty"), m3: gv(m, "lf-m3"), t: gv(m, "lf-t"), receivedDate: gv(m, "lf-recv"),
        partnerId: gv(m, "lf-sup"), acq: gv(m, "lf-acq"), contract: gv(m, "lf-contract"), transport: gv(m, "lf-tr"), notes: gv(m, "lf-notes"),
        wood: { species: gv(m, "lf-species"), speciesLatin: gv(m, "lf-latin"), kind: gv(m, "lf-kind"), cn: gv(m, "lf-cn"), harvestFrom: gv(m, "lf-hf"), harvestTo: gv(m, "lf-ht"), country: gv(m, "lf-wc"), region: gv(m, "lf-reg"), place: gv(m, "lf-place") },
        origin: { owner: gv(m, "lf-owner"), plot: gv(m, "lf-plot"), country: gv(m, "lf-oc"), riskCountry: gv(m, "lf-risk"), lat: gv(m, "lf-lat"), lon: gv(m, "lf-lon"), areaHa: gv(m, "lf-ha"), legalNote: gv(m, "lf-legal"), geojson: gv(m, "lf-geo") } };
      if (preset && preset.receipt && !lot) args.receipt = preset.receipt;
      const res = await Store.exec("eudr.lot.save", args, SRC);
      const msg = $("#lf-msg", m.el);
      if (!res.ok) { msg.textContent = [res.error, res.errors ? Object.values(res.errors).join("; ") : ""].filter(Boolean).join(" — "); msg.className = "msg err wide"; return; }
      Toast.ok(lot ? "Zapisano partię" : P("Utworzono partię {no}", { no: res.lot.no })); m.close(); App.render();
    };
    const s = $("#lf-save", m.el); if (s) s.onclick = () => go(false);
    $("#lf-submit", m.el).onclick = () => go(true);
  }
  /** Karta partii: dane, obowiązki, pochodzenie, dokumenty, łańcuch, należyta staranność, DDS, historia. */
  function lotCard(id, sub) {
    const l = lotOf(id);
    if (!l) return Toast.warn("Nie znaleziono partii");
    const S = ST(), ev = E.evaluate(S, l, ctx()), ob = ev.ob, w = l.wood || {}, o = l.origin || {}, bal = E.balance(l), tabs = [["data", "Dane"], ["docs", "Dokumenty"], ["trace", "Identyfikowalność"], ["dd", "Należyta staranność"], ["dds", "DDS"], ["hist", "Historia"]];
    const cur = sub || "data";
    const docs = E.docsOfLot(S, l.id), dds = E.ddsOfLot(S, l.id);
    let body = "";
    if (cur === "data") {
      body = `<div class="eu-kv">${[["Status", statusBadge(l) + " " + dot(ev.color) + " " + esc(E.COLORS[ev.color])], ["Gatunek", esc([w.species, w.speciesLatin && `<i>${w.speciesLatin}</i>`].filter(Boolean).join(" — ")) .replace(/&lt;i&gt;|&lt;\/i&gt;/g, "")], ["Kod CN", esc(w.cn || "—")],
        ["Ilość / saldo", esc(`${fq(l.qty)} / ${fq(bal)} ${unitOf(l)}`) + (l.m3 ? esc(` · ${fq(l.m3)} m³`) : "") + (l.t ? esc(` · ${fq(l.t)} t`) : "")], ["Magazyn", esc(whName(l.whId))],
        ["Dostawca", esc(partnerName(l.partnerId) || "—")], ["Sposób nabycia", esc((E.ACQ[l.acq] || {}).label || "—")], ["Przyjęcie (PZ)", esc(l.receipt ? `${l.receipt.opNo} · ${dpl(l.receipt.date)}` : "—")],
        ["Okres pozyskania", esc(`${dpl(w.harvestFrom)} – ${dpl(w.harvestTo)}`)], ["Miejsce", esc([w.place, w.region, w.country].filter(Boolean).join(", ") || "—")],
        ["Pochodzenie", esc([o.owner, o.plot, o.country, E.RISK_COUNTRY[o.riskCountry]].filter(Boolean).join(" · ") || "—")],
        ["Geolokalizacja", esc(o.geojson ? "polygon GIS" : Number.isFinite(o.lat) ? `${o.lat}, ${o.lon}` : "brak") + (o.areaHa ? esc(` · ${fq(o.areaHa)} ha`) : "")],
        ["Partie źródłowe", esc((l.parents || []).map(p => `${p.no} (${fq(p.qty)})`).join(", ") || "—")]].map(([k, v]) => `<div><small>${esc(k)}</small><div>${v}</div></div>`).join("")}</div>
        <div class="eu-ob mt4"><b>Obowiązki:</b> ${esc(ob.roleLabel)}${ob.covered ? esc(` · obowiązuje od ${dpl(ob.applyDate)}${ob.inForce ? "" : " (okres przygotowawczy)"}`) : ""}
        ${ob.docs.length ? `<div class="muted">Wymagane dokumenty: ${esc(ob.docs.map(d => E.DOC_TYPES[d]).join(", "))}</div>` : ""}</div>
        ${ev.blocks.length ? `<div class="info-line err mt4">${ic("ban", 15)}<span>${esc(ev.blocks.join(" · "))}</span></div>` : ""}
        ${ev.missing.length ? `<div class="info-line warn mt4">${ic("alert", 15)}<span><b>Braki:</b> ${esc(ev.missing.join(" · "))}</span></div>` : ""}
        ${ev.warnings.length ? `<div class="info-line mt4">${ic("alert", 15)}<span>${esc(ev.warnings.join(" · "))}</span></div>` : ""}
        ${l.nonconformity ? `<div class="info-line err mt4">${ic("alert", 15)}<span>Niezgodność: ${esc(l.nonconformity.reason)} (${esc(l.nonconformity.by)}, ${dtpl(l.nonconformity.at)})</span></div>` : ""}
        ${l.status === "ARCHIVED" ? `<div class="info-line mt4">${ic("box", 15)}<span>Archiwum: ${esc(l.archivedReason || "")} (${esc(l.archivedBy || "")}, ${dtpl(l.archivedAt)})</span></div>` : ""}
        ${l.demo ? `<div class="info-line mt4">${ic("alert", 15)}<span>DANE FIKCYJNE — przykład do szkolenia</span></div>` : ""}
        <h4 class="eu-h mt4">Powiązania z dokumentami ERP</h4>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Rodzaj</th><th>Dokument</th><th>Data</th><th class="r">Ilość</th><th>Kierunek</th><th>Wpis</th><th></th></tr></thead><tbody>
        ${(l.links || []).map(k => `<tr class="${k.void ? "eu-void" : ""}"><td>${esc(k.kind)}</td><td class="mono">${esc(k.opNo || "")}</td><td>${dpl(k.date)}</td><td class="r">${fq(k.qty)}</td><td>${esc(k.dir === "in" ? "przyjęcie" : k.dir === "move" ? "przesunięcie" : "rozchód")}${k.toLotId ? esc(" → " + ((lotOf(k.toLotId) || {}).no || "")) : ""}${k.forced ? `<br><small class="neg">Obejście blokady: ${esc(k.forced)}</small>` : ""}</td><td><small>${esc(k.by)} · ${dtpl(k.at)}${k.void ? `<br>wycofane: ${esc(k.void.reason)}` : ""}</small></td>
          <td class="r">${!k.void && can("lot.archive") && ["WZ", "MM", "PZ"].includes(k.kind) ? `<button class="btn sm ghost" type="button" data-unlink="${esc(k.id)}">Wycofaj</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">Brak powiązań</td></tr>`}</tbody></table></div>`;
    } else if (cur === "docs") {
      body = `${can("doc.add") && l.status !== "ARCHIVED" ? `<div class="eu-row"><button class="btn primary sm" type="button" id="lc-adddoc">${ic("plus", 14)} Dodaj dokument</button></div>` : ""}${docTable(docs.concat(E.docsOfPartner(S, l.partnerId)))}
        <p class="muted mt4">Dokumenty dostawcy (bez powiązania z partią) są widoczne we wszystkich jego partiach.</p>`;
    } else if (cur === "trace") {
      const tr = E.trace(S, l.id);
      body = `<div class="eu-chain">${tr.steps.map(s => `<div class="eu-step ${s.items.length ? "on" : ""}"><b>${esc(s.label)}</b>${s.items.length ? s.items.map(x => `<small>${esc(x)}</small>`).join("") : `<small class="muted">—</small>`}</div>`).join(`<span class="eu-arrow" aria-hidden="true">→</span>`)}</div>
        <h4 class="eu-h mt4">Pochodzenie (${tr.origins.length})</h4>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Partia źródłowa</th><th>Gatunek</th><th>Właściciel / działka</th><th>Kraj</th><th>Dostawca</th><th>Geolokalizacja</th></tr></thead><tbody>
        ${tr.origins.map(x => { const lt = lotOf(x.lotId) || {}; return `<tr><td class="mono"><a href="#" data-lot="${esc(x.lotId)}">${esc(x.no)}</a></td><td>${esc(x.wood.species || "")}</td><td>${esc([x.origin.owner, x.origin.plot].filter(Boolean).join(" · "))}</td><td>${esc(x.origin.country || "")}</td><td>${esc(partnerName(x.partnerId))}</td><td>${esc(E.lotGeo(lt) ? (lt.origin.geojson ? "polygon" : "punkt") : "brak")}</td></tr>`; }).join("")}</tbody></table></div>
        ${tr.down.filter(d => d.lot).length ? `<h4 class="eu-h mt4">Partie pochodne</h4><p>${tr.down.filter(d => d.lot).map(d => `<a href="#" class="mono" data-lot="${esc(d.lot.id)}">${esc(d.lot.no)}</a>`).join(", ")}</p>` : ""}`;
    } else if (cur === "dd") {
      body = ddSummary(l);
    } else if (cur === "dds") {
      body = `${ddsTable(dds, true)}${can("dds.edit") ? `<div class="eu-row mt4"><button class="btn sm" type="button" id="lc-adddds">${ic("plus", 14)} Nowy wpis DDS dla partii</button></div>` : ""}`;
    } else {
      const H = (S.audit || []).filter(a => a.entity === "eudr" && (a.entityId === l.id)).slice().reverse();
      body = historyTable(H);
    }
    const acts = [];
    if (l.status !== "ARCHIVED") {
      if (can("lot.edit")) acts.push(`<button class="btn" type="button" id="lc-edit">${ic("edit", 15)} Edytuj</button>`);
      if (can("lot.link")) acts.push(`<button class="btn" type="button" id="lc-link">${ic("swap", 15)} Powiąż dokument</button>`, `<button class="btn" type="button" id="lc-split">Podziel</button>`, `<button class="btn" type="button" id="lc-proc">${ic("factory", 15)} Przetwórz</button>`);
      if (l.status === "DRAFT" && can("lot.edit")) acts.push(`<button class="btn" type="button" id="lc-submit">Do weryfikacji</button>`);
      if (can("dd.stage") || can("dd.approve")) acts.push(`<button class="btn primary" type="button" id="lc-dd">${ic("shieldCheck", 15)} Należyta staranność</button>`);
      if (can("lot.status") && l.status !== "NONCONFORM") acts.push(`<button class="btn" type="button" id="lc-nc">Wstrzymaj (niezgodność)</button>`);
      if (can("lot.archive")) acts.push(l.status === "DRAFT" ? `<button class="btn danger" type="button" id="lc-del">${ic("trash", 15)} Usuń szkic</button>` : `<button class="btn" type="button" id="lc-arch">${ic("box", 15)} Archiwizuj</button>`);
    } else if (can("lot.archive")) acts.push(`<button class="btn" type="button" id="lc-rest">Przywróć z archiwum</button>`);
    const m = Modal.open({ title: P("Partia {no}", { no: l.no }), sub: esc(`${w.species || "—"} · ${fq(bal)} ${unitOf(l)} · ${whName(l.whId)}`), xwide: true, id: "eu-lotcard",
      body: `<div class="seg eu-subtabs" role="tablist">${tabs.map(([k, lab]) => `<button type="button" role="tab" data-lt="${k}" aria-pressed="${k === cur}">${esc(lab)}</button>`).join("")}</div><div class="mt4">${body}</div>`,
      footer: `<div class="eu-acts">${acts.join("")}</div>` });
    const reopen = s => { m.close(); lotCard(l.id, s); };
    $$("[data-lt]", m.el).forEach(b => b.onclick = () => reopen(b.dataset.lt));
    $$("[data-lot]", m.el).forEach(a => a.onclick = e => { e.preventDefault(); m.close(); lotCard(a.dataset.lot); });
    bindDocTable(m.el, () => reopen(cur));
    bindDdsTable(m.el, () => reopen(cur));
    const on = (sel_, fn) => { const el = $(sel_, m.el); if (el) el.onclick = fn; };
    on("#lc-edit", () => { m.close(); lotDialog(l); });
    on("#lc-link", () => { m.close(); linkDialog(l); });
    on("#lc-split", () => { m.close(); splitDialog(l); });
    on("#lc-proc", () => { m.close(); processDialog([l.id]); });
    on("#lc-dd", () => { m.close(); T().tab = "dd"; T().ddLot = l.id; App.go ? App.go("eudr") : (location.hash = "#/eudr"); App.render(); });
    on("#lc-adddoc", () => { m.close(); docDialog(null, { lotIds: [l.id] }, () => lotCard(l.id, "docs")); });
    on("#lc-adddds", () => { m.close(); ddsDialog(null, { lotIds: [l.id], partnerId: l.partnerId }); });
    on("#lc-submit", async () => { if ((await exec("eudr.lot.status", { id: l.id, status: "PENDING" }, "Przekazano do weryfikacji")).ok) reopen(cur); });
    on("#lc-nc", async () => { const r = await Modal.confirm({ title: "Wstrzymanie partii", text: "Partia zostanie oznaczona jako niezgodna — wydanie będzie zablokowane.", ok: "Wstrzymaj", danger: true, input: { label: "Opis niezgodności", required: true } }); if (r.ok && (await exec("eudr.lot.status", { id: l.id, status: "NONCONFORM", reason: r.value }, "Partia wstrzymana")).ok) reopen(cur); });
    on("#lc-arch", async () => { const r = await Modal.confirm({ title: "Archiwizacja partii", text: "Partia trafi do archiwum (historia i dokumenty zostają).", ok: "Archiwizuj", input: { label: "Powód", required: true } }); if (r.ok && (await exec("eudr.lot.archive", { id: l.id, reason: r.value }, "Zarchiwizowano")).ok) { m.close(); App.render(); } });
    on("#lc-rest", async () => { if ((await exec("eudr.lot.archive", { id: l.id, action: "restore" }, "Przywrócono")).ok) reopen(cur); });
    on("#lc-del", async () => { const r = await Modal.confirm({ title: "Usunąć szkic partii?", text: "Usunąć można tylko szkic bez powiązań. Wpis zostaje w historii zmian.", ok: "Usuń", danger: true }); if (r.ok && (await exec("eudr.lot.archive", { id: l.id, action: "delete" }, "Usunięto szkic")).ok) { m.close(); App.render(); } });
    $$("[data-unlink]", m.el).forEach(b => b.onclick = async () => { const r = await Modal.confirm({ title: "Wycofanie powiązania", text: "Powiązanie zostanie oznaczone jako wycofane (wpis zostaje).", ok: "Wycofaj", input: { label: "Powód", required: true } }); if (r.ok && (await exec("eudr.lot.unlink", { lotId: l.id, linkId: b.dataset.unlink, reason: r.value }, "Wycofano powiązanie")).ok) reopen(cur); });
  }
  const opLabel = o => `${o.no} · ${dpl(o.date)} · ${whName(o.whId)}`;
  function linkDialog(l) {
    const S = ST(), kinds = [["WZ", "Wydanie / sprzedaż (WZ)"], ["MM", "Przesunięcie MM"], ["PZ", "Przyjęcie (PZ) — uzupełniające"]];
    const opsFor = k => S.operations.filter(o => ({ WZ: ["SPRZEDAZ", "ZAKUP"], MM: ["MM"], PZ: ["ZAKUP"] })[k].includes(o.type) && o.status !== "CANCELLED" && (o.whId === l.whId || o.toWhId === l.whId) && (k !== "WZ" || o.type === "SPRZEDAZ" || (o.input && o.input.sale && o.input.sale.enabled))).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 300);
    const m = Modal.open({ title: P("Powiązanie partii {no} z dokumentem ERP", { no: l.no }), sub: esc(`Saldo partii: ${fq(E.balance(l))} ${unitOf(l)}. Ruch magazynowy pozostaje w dokumencie ERP — tu zapisuje się tylko wskazanie partii.`), wide: true,
      body: `${fld("lk-kind", "Rodzaj dokumentu", sel("lk-kind", kinds, "WZ"))}<div id="lk-opbox"></div>${fld("lk-qty", P("Ilość ({u})", { u: unitOf(l) }), inp("lk-qty", fq(E.balance(l)), 'inputmode="decimal"'))}<div class="msg hidden" id="lk-msg"></div><div id="lk-force" class="hidden"></div>`,
      footer: `<button class="btn ghost" type="button" data-x2>Anuluj</button><button class="btn primary" type="button" id="lk-ok">Powiąż</button>` });
    const fill = () => { const k = gv(m, "lk-kind"), list = opsFor(k); $("#lk-opbox", m.el).innerHTML = fld("lk-op", "Dokument", sel("lk-op", list.length ? list.map(o => [o.id, opLabel(o)]) : [["", "Brak dokumentów tego rodzaju"]])); };
    fill(); $("#lk-kind", m.el).onchange = fill;
    $("[data-x2]", m.el).onclick = m.close;
    let force = false;
    $("#lk-ok", m.el).onclick = async () => {
      const args = { lotId: l.id, kind: gv(m, "lk-kind"), opId: gv(m, "lk-op"), qty: gv(m, "lk-qty") };
      if (force) Object.assign(args, { force: true, reason: gv(m, "lk-reason") });
      const res = await Store.exec("eudr.lot.link", args, SRC), msg = $("#lk-msg", m.el);
      if (!res.ok) {
        msg.className = "msg err"; msg.textContent = [res.error, (res.blocks || []).join(" · "), res.errors ? Object.values(res.errors).join("; ") : ""].filter(Boolean).join(" — ");
        if (res.code === "EUDR_BLOCK" && E.roleOf(ST(), me()) === "admin" && !force) { force = true; const fb = $("#lk-force", m.el); fb.classList.remove("hidden"); fb.innerHTML = fld("lk-reason", "Obejście blokady (tylko Administrator EUDR) — uzasadnienie (min. 20 znaków)", area("lk-reason", "", 2)); }
        return;
      }
      Toast.ok("Powiązano dokument", (res.warnings || []).join(" · ")); m.close(); lotCard(l.id);
    };
  }
  function splitDialog(l) {
    const m = Modal.open({ title: P("Podział partii {no}", { no: l.no }), sub: esc(`Saldo ${fq(E.balance(l))} ${unitOf(l)}. Części zachowują pochodzenie, dokumenty, DDS i wynik należytej staranności.`), wide: true,
      body: `<div id="sp-rows"></div><button class="btn sm" type="button" id="sp-add">${ic("plus", 14)} Dodaj część</button><div class="msg hidden" id="sp-msg"></div>`,
      footer: `<button class="btn ghost" type="button" data-x2>Anuluj</button><button class="btn primary" type="button" id="sp-ok">Podziel</button>` });
    const row = i => `<div class="eu-grid2" data-sp="${i}">${fld("sp-q" + i, P("Część {n} — ilość", { n: i + 1 }), inp("sp-q" + i, "", 'inputmode="decimal"'))}${fld("sp-w" + i, "Magazyn", sel("sp-w" + i, whOpts(), l.whId))}</div>`;
    let n = 2; const draw = () => { $("#sp-rows", m.el).innerHTML = Array.from({ length: n }, (_, i) => row(i)).join(""); };
    draw(); $("#sp-add", m.el).onclick = () => { n++; draw(); };
    $("[data-x2]", m.el).onclick = m.close;
    $("#sp-ok", m.el).onclick = async () => {
      const parts = Array.from({ length: n }, (_, i) => ({ qty: gv(m, "sp-q" + i), whId: gv(m, "sp-w" + i) })).filter(p => p.qty);
      const res = await Store.exec("eudr.lot.split", { id: l.id, parts }, SRC);
      if (!res.ok) { const msg = $("#sp-msg", m.el); msg.className = "msg err"; msg.textContent = res.error; return; }
      Toast.ok(P("Utworzono części: {l}", { l: res.children.map(c => c.no).join(", ") })); m.close(); App.render();
    };
  }
  function processDialog(ids) {
    const S = ST(), src = ids.map(lotOf).filter(Boolean), prods = S.operations.filter(o => o.type === "PRODUKCJA" || (o.type === "ZAKUP" && o.input && o.input.production && o.input.production.enabled)).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 200);
    const m = Modal.open({ title: "Przetworzenie partii (produkcja)", sub: "Partia wyrobu (np. zrębki) zachowuje pochodzenie wszystkich partii surowca.", wide: true,
      body: `${src.map((l, i) => fld("pr-q" + i, P("{no} — zużyto ({u}), saldo {b}", { no: l.no, u: unitOf(l), b: fq(E.balance(l)) }), inp("pr-q" + i, fq(E.balance(l)), 'inputmode="decimal"'))).join("")}
        ${fld("pr-op", "Dokument produkcji (opcjonalnie)", sel("pr-op", [["", "— bez dokumentu —"]].concat(prods.map(o => [o.id, opLabel(o)]))))}
        ${fld("pr-prod", "Wyrób", sel("pr-prod", prodOpts(), "pr_zr_lesna"))}${fld("pr-qty", "Ilość wyrobu (jednostka produktu)", inp("pr-qty", "", 'inputmode="decimal"'))}<div class="msg hidden" id="pr-msg"></div>`,
      footer: `<button class="btn ghost" type="button" data-x2>Anuluj</button><button class="btn primary" type="button" id="pr-ok">Zapisz przetworzenie</button>` });
    $("[data-x2]", m.el).onclick = m.close;
    $("#pr-ok", m.el).onclick = async () => {
      const res = await Store.exec("eudr.lot.process", { inputs: src.map((l, i) => ({ lotId: l.id, qty: gv(m, "pr-q" + i) })), opId: gv(m, "pr-op"), productId: gv(m, "pr-prod"), qty: gv(m, "pr-qty") }, SRC);
      if (!res.ok) { const msg = $("#pr-msg", m.el); msg.className = "msg err"; msg.textContent = res.error; return; }
      Toast.ok(P("Utworzono partię wyrobu {no}", { no: res.lot.no })); m.close(); lotCard(res.lot.id, "trace");
    };
  }
  function receiptsDialog() {
    const list = E.unassignedReceipts(ST(), me());
    const m = Modal.open({ title: "Przyjęcia do przypisania", sub: "Zakupy drewna objętego EUDR bez partii (albo z nieprzypisaną resztą ilości). Partia przejmuje dane z dokumentu — bez ponownego wpisywania.", xwide: true,
      body: `<div class="tbl-wrap"><table class="tbl" id="eu-rcpt"><thead><tr><th>Dokument</th><th>Data</th><th>Magazyn</th><th>Dostawca</th><th>Produkt</th><th class="r">Ilość</th><th class="r">Przypisano</th><th class="r">Reszta</th><th></th></tr></thead><tbody>
        ${list.map(x => { const pu = x.op.input.purchase || {}, pr = R.byId(ST().products, pu.productId); return `<tr><td class="mono">${esc(x.op.no)}</td><td>${dpl(x.op.date)}</td><td>${esc(whName(x.op.whId))}</td><td>${esc(partnerName(pu.supplierId) || pu.supplierName || "")}</td><td>${esc(pr ? pr.name : "")}</td><td class="r">${fq(x.qty)}</td><td class="r">${fq(x.used)}</td><td class="r"><b>${fq(x.rest)}</b></td>
          <td class="r nowrap"><button class="btn sm primary" type="button" data-new="${esc(x.op.id)}">Utwórz partię</button> <button class="btn sm" type="button" data-assign="${esc(x.op.id)}">Przypisz do istniejącej</button></td></tr>`; }).join("") || `<tr><td colspan="9" class="muted">Wszystkie przyjęcia drewna objętego EUDR mają partie.</td></tr>`}</tbody></table></div>` });
    $$("[data-new]", m.el).forEach(b => b.onclick = async () => { const res = await exec("eudr.lot.fromOp", { opId: b.dataset.new }); if (res.ok) { m.close(); Toast.ok(P("Utworzono partię {no}", { no: res.lot.no }), "Uzupełnij gatunek, okres pozyskania i pochodzenie."); lotDialog(lotOf(res.lot.id)); } });
    $$("[data-assign]", m.el).forEach(b => b.onclick = () => {
      const op = R.byId(ST().operations, b.dataset.assign), x = list.find(y => y.op.id === op.id);
      const cand = ST().eudrLots.filter(l => l.status !== "ARCHIVED" && l.whId === op.whId);
      const m2 = Modal.open({ title: P("Przypisanie {no} do partii", { no: op.no }), wide: true,
        body: `${fld("as-lot", "Partia", sel("as-lot", cand.length ? cand.map(l => [l.id, `${l.no} · ${(l.wood || {}).species || ""} · saldo ${fq(E.balance(l))}`]) : [["", "Brak partii w tym magazynie"]]))}${fld("as-qty", "Ilość", inp("as-qty", fq(x.rest), 'inputmode="decimal"'))}`,
        footer: `<button class="btn primary" type="button" id="as-ok">Przypisz</button>` });
      $("#as-ok", m2.el).onclick = async () => { const res = await exec("eudr.lot.link", { lotId: gv(m2, "as-lot"), kind: "PZ", opId: op.id, qty: gv(m2, "as-qty") }, "Przypisano przyjęcie do partii"); if (res.ok) { m2.close(); m.close(); App.render(); } };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Dokumenty                                                           */
  /* ------------------------------------------------------------------ */
  const docBadge = d => `<span class="badge ${d.status === "VERIFIED" ? "ok" : d.status === "REJECTED" ? "err" : d.status === "ARCHIVED" ? "" : "warn"}">${esc(E.DOC_STATUS[d.status] || d.status)}</span>`;
  function docTable(list) {
    return `<div class="tbl-wrap"><table class="tbl eu-doctbl"><thead><tr><th>Nr</th><th>Rodzaj</th><th>Numer / opis</th><th>Partie / dostawca</th><th>Plik</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(d => { const f = d.versions[d.versions.length - 1]; return `<tr><td class="mono nowrap">${esc(d.no)}</td><td>${esc(E.DOC_TYPES[d.type])}</td><td>${esc([d.number, d.title, d.issued && dpl(d.issued), d.validTo && "ważny do " + dpl(d.validTo)].filter(Boolean).join(" · "))}</td>
        <td>${esc((d.lotIds || []).map(id => (lotOf(id) || {}).no).filter(Boolean).join(", ") || partnerName(d.partnerId))}</td><td>${f ? `${esc(f.name)}<br><small class="muted">wersja ${f.v} · ${Math.max(1, Math.round(f.size / 1024))} kB${f.local ? " · w przeglądarce" : ""}</small>` : `<small class="muted">bez pliku</small>`}</td><td>${docBadge(d)}${d.check && d.check.note ? `<br><small>${esc(d.check.note)}</small>` : ""}</td>
        <td class="r nowrap">${f ? `<button class="btn sm ghost" type="button" data-dprev="${esc(d.id)}" title="Podgląd">${ic("eye", 14)}</button><button class="btn sm ghost" type="button" data-ddl="${esc(d.id)}" title="Pobierz">${ic("dl", 14)}</button>` : ""}
          ${can("doc.add") && d.status !== "ARCHIVED" ? `<button class="btn sm ghost" type="button" data-drep="${esc(d.id)}" title="Zastąp plik (nowa wersja)">${ic("refresh", 14)}</button>` : ""}
          ${can("doc.verify") && d.status !== "ARCHIVED" ? `<button class="btn sm ghost" type="button" data-dver="${esc(d.id)}" title="Sprawdź">${ic("check", 14)}</button>` : ""}
          <button class="btn sm ghost" type="button" data-dhist="${esc(d.id)}" title="Wersje i historia">${ic("clock", 14)}</button></td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">Brak dokumentów</td></tr>`}</tbody></table></div>`;
  }
  function bindDocTable(el, after) {
    const D = id => R.byId(ST().eudrDocs, id);
    $$("[data-dprev]", el).forEach(b => b.onclick = () => Files.preview(D(b.dataset.dprev)));
    $$("[data-ddl]", el).forEach(b => b.onclick = () => Files.save(D(b.dataset.ddl)));
    $$("[data-drep]", el).forEach(b => b.onclick = () => docDialog(D(b.dataset.drep), null, after));
    $$("[data-dver]", el).forEach(b => b.onclick = () => verifyDialog(D(b.dataset.dver), after));
    $$("[data-dhist]", el).forEach(b => b.onclick = () => { const d = D(b.dataset.dhist); const H = (ST().audit || []).filter(a => a.entity === "eudr" && a.entityId === d.id).slice().reverse();
      const m = Modal.open({ title: P("Dokument {no} — wersje i historia", { no: d.no }), xwide: true, body: `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Wersja</th><th>Plik</th><th>Dodano</th><th></th></tr></thead><tbody>${d.versions.map(f => `<tr><td>${f.v}</td><td>${esc(f.name)}</td><td>${esc(f.by)} · ${dtpl(f.at)}</td><td class="r"><button class="btn sm ghost" type="button" data-v="${f.v}">${ic("eye", 14)}</button></td></tr>`).join("") || `<tr><td colspan="4" class="muted">Bez pliku</td></tr>`}</tbody></table></div><h4 class="eu-h mt4">Historia</h4>${historyTable(H)}` });
      $$("[data-v]", m.el).forEach(x => x.onclick = () => Files.preview(d, Number(x.dataset.v))); });
  }
  function docDialog(d, preset, after) {
    const p = Object.assign({ lotIds: [], partnerId: "" }, preset || {}, d || {});
    const lots = ST().eudrLots.filter(l => l.status !== "ARCHIVED");
    const m = Modal.open({ title: d ? P("Zastąpienie pliku — {no}", { no: d.no }) : "Nowy dokument EUDR", sub: d ? "Nowy plik zostanie dodany jako kolejna wersja; poprzednie wersje zostają w historii." : "Plik PDF, zdjęcie (JPG / PNG) albo plik GeoJSON / XML. Dokument wiąże się z partią lub dostawcą.", wide: true,
      body: `${d ? "" : `${fld("dc-type", "Rodzaj dokumentu", sel("dc-type", opts(E.DOC_TYPES, "— wybierz —"), p.type))}
        ${fld("dc-lots", "Partie (Ctrl — kilka)", `<select class="ctrl" id="dc-lots" multiple size="5">${lots.map(l => `<option value="${esc(l.id)}" ${p.lotIds.includes(l.id) ? "selected" : ""}>${esc(`${l.no} · ${(l.wood || {}).species || ""} · ${whName(l.whId)}`)}</option>`).join("")}</select>`)}
        ${fld("dc-sup", "Dostawca (dokument dostawcy, np. oświadczenie roczne)", sel("dc-sup", supOpts(), p.partnerId))}
        <div class="eu-grid2">${fld("dc-num", "Numer dokumentu", inp("dc-num", p.number))}${fld("dc-iss", "Data wystawienia", inp("dc-iss", p.issued, 'type="date"'))}${fld("dc-val", "Ważny do", inp("dc-val", p.validTo, 'type="date"'))}${fld("dc-issuer", "Wystawca", inp("dc-issuer", p.issuer))}</div>
        ${fld("dc-title", "Opis", inp("dc-title", p.title))}`}
        ${fld("dc-file", "Plik", `<input type="file" id="dc-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.tif,.tiff,.geojson,.json,.xml,.csv,.txt,application/pdf,image/*" ${d ? "" : ""} capture="environment">`)}
        ${d ? "" : `<label class="inline-opt"><input type="checkbox" id="dc-nofile"> Bez pliku (np. numer referencyjny przekazany w treści e-maila — opisz w polu „Opis”)</label>`}
        <div class="msg hidden" id="dc-msg"></div>`,
      footer: `<button class="btn ghost" type="button" data-x2>Anuluj</button><button class="btn primary" type="button" id="dc-ok">${ic("up", 15)} Zapisz</button>` });
    $("[data-x2]", m.el).onclick = m.close;
    $("#dc-ok", m.el).onclick = async () => {
      const file = $("#dc-file", m.el).files[0], msg = $("#dc-msg", m.el);
      const meta = d ? { id: d.id } : { type: gv(m, "dc-type"), lotIds: [...$("#dc-lots", m.el).selectedOptions].map(o => o.value), partnerId: gv(m, "dc-sup"), number: gv(m, "dc-num"), issued: gv(m, "dc-iss"), validTo: gv(m, "dc-val"), issuer: gv(m, "dc-issuer"), title: gv(m, "dc-title") };
      if (!file && (d || !gv(m, "dc-nofile"))) { msg.className = "msg err"; msg.textContent = "Wybierz plik"; return; }
      $("#dc-ok", m.el).disabled = true;
      const res = await Files.upload(meta, file);
      $("#dc-ok", m.el).disabled = false;
      if (!res.ok) { msg.className = "msg err"; msg.textContent = [res.error, res.errors ? Object.values(res.errors).join("; ") : ""].filter(Boolean).join(" — "); return; }
      Toast.ok(d ? "Dodano nową wersję pliku" : P("Zapisano dokument {no}", { no: res.doc.no })); m.close(); if (after) after(); else App.render();
    };
  }
  function verifyDialog(d, after) {
    const m = Modal.open({ title: P("Sprawdzenie dokumentu {no}", { no: d.no }), sub: esc(E.DOC_TYPES[d.type]), wide: true,
      body: `${fld("vf-st", "Wynik", sel("vf-st", [["VERIFIED", "Sprawdzony — zgodny"], ["REJECTED", "Odrzucony"], ["ARCHIVED", "Archiwum (np. duplikat)"]], "VERIFIED"))}${fld("vf-note", "Uwagi", area("vf-note", "", 3))}<div class="msg hidden" id="vf-msg"></div>`,
      footer: `<button class="btn primary" type="button" id="vf-ok">Zapisz</button>` });
    $("#vf-ok", m.el).onclick = async () => { const res = await Store.exec("eudr.doc.verify", { id: d.id, status: gv(m, "vf-st"), note: gv(m, "vf-note") }, SRC); if (!res.ok) { const g = $("#vf-msg", m.el); g.className = "msg err"; g.textContent = res.error; return; } Toast.ok("Zapisano"); m.close(); if (after) after(); else App.render(); };
  }

  /* ------------------------------------------------------------------ */
  /* Należyta staranność                                                 */
  /* ------------------------------------------------------------------ */
  function ddSummary(l) {
    const dd = l.dd || {}, a = dd.approval;
    const st = (s, label) => `<div class="eu-ddst ${s && s.done ? "ok" : s ? "part" : ""}"><b>${esc(label)}</b><small>${s ? esc(`${s.done ? "zakończony" : "w toku"} · ${s.by} · ${dtpl(s.at)}`) : "nie rozpoczęto"}</small></div>`;
    return `<div class="eu-ddrow">${st(dd.s1, "Etap 1 — informacje")}${st(dd.s2, "Etap 2 — ocena ryzyka" + (dd.s2 && dd.s2.result ? (dd.s2.result === "NEGLIGIBLE" ? ": znikome" : ": nie-znikome") : ""))}${st(dd.s3, "Etap 3 — ograniczanie ryzyka")}
      <div class="eu-ddst ${a ? (a.result === "ACCEPTED" ? "ok" : "bad") : ""}"><b>Wynik końcowy</b><small>${a ? esc(`${a.result === "ACCEPTED" ? "dopuszczona" : "niezgodna"} · ${a.by} (${a.role}) · ${dtpl(a.at)}`) : "brak zatwierdzenia"}</small></div></div>
      ${dd.inherited ? `<p class="muted">Wynik przejęty z partii źródłowych: ${esc(dd.inherited)}</p>` : ""}${a ? `<p><b>Uzasadnienie:</b> ${esc(a.justification)}</p>` : ""}`;
  }
  function ddPanel(l) {
    const S = ST(), dd = l.dd || {}, ob = E.obligations(S, l, ctx()), hints = E.ddHints(S, l, ctx()), s1 = dd.s1 || {}, s2 = dd.s2 || {}, s3 = dd.s3 || {}, ev = E.evaluate(S, l, ctx());
    const lv = [["", "—"], ["low", "niskie"], ["medium", "średnie"], ["high", "wysokie"]];
    return `<div class="card mt4" id="eu-ddpanel"><div class="card-h"><h3>${esc(l.no)} · ${esc((l.wood || {}).species || "")}</h3><div class="eu-row">${statusBadge(l)} ${dot(ev.color)} <small class="muted">${esc(ob.roleLabel)}</small></div></div>
      <div class="card-b">${ddSummary(l)}
      ${!ob.ddRequired ? `<div class="info-line mt4">${ic("alert", 15)}<span>Dla tej partii firma nie działa jako operator — pełna ocena ryzyka (etap 2–3) nie jest wymagana; wystarczy potwierdzenie zebranych informacji (etap 1) i zatwierdzenie.</span></div>` : ""}
      <h4 class="eu-h mt4">Etap 1 — zbieranie informacji (art. 9)</h4>
      <p class="muted">Podpowiedź programu (✓) wynika z danych w systemie — <b>potwierdzasz Ty</b> po sprawdzeniu dokumentów.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Informacja</th><th>Podpowiedź</th><th>Potwierdzam</th><th>Nie dotyczy</th><th>Uwagi</th></tr></thead><tbody>
      ${Object.entries(E.DD1_ITEMS).map(([k, lab]) => { const it = (s1.items || {})[k] || {}; return `<tr><td>${esc(lab)}</td><td>${hints[k] ? `<span class="pos">✓</span>` : `<span class="neg">brak</span>`}</td><td><input type="checkbox" data-d1ok="${k}" ${it.ok ? "checked" : ""}></td><td><input type="checkbox" data-d1na="${k}" ${it.na ? "checked" : ""}></td><td><input class="ctrl" data-d1n="${k}" value="${esc(it.note || "")}"></td></tr>`; }).join("")}</tbody></table></div>
      <label class="inline-opt mt4"><input type="checkbox" id="d1-confirm"> Oświadczam, że osobiście sprawdziłem / sprawdziłam powyższe informacje (nie tylko automatyczną podpowiedź)</label>
      <div class="eu-row"><button class="btn" type="button" data-d1="0">Zapisz roboczo</button><button class="btn primary" type="button" data-d1="1">Zakończ etap 1</button></div>
      ${ob.ddRequired || s2.done ? `<h4 class="eu-h mt4">Etap 2 — ocena ryzyka (art. 10)</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kryterium</th><th>Poziom</th><th>Uzasadnienie / źródło</th></tr></thead><tbody>
      ${Object.entries(E.DD2_CRITERIA).map(([k, lab]) => { const c = (s2.criteria || {})[k] || {}; return `<tr><td>${esc(lab)}${k === "countryRisk" ? `<br><small class="muted">W partii: ${esc(E.RISK_COUNTRY[(l.origin || {}).riskCountry] || "nie podano")}</small>` : ""}</td><td>${sel("d2l-" + k, lv, c.level, `data-d2="${k}"`)}</td><td><input class="ctrl" data-d2n="${k}" value="${esc(c.note || "")}"></td></tr>`; }).join("")}</tbody></table></div>
      <div class="eu-grid2">${fld("d2-res", "Wynik oceny ryzyka", sel("d2-res", [["", "— wybierz —"], ["NEGLIGIBLE", "Ryzyko znikome"], ["NOT_NEGLIGIBLE", "Ryzyko nie-znikome"]], s2.result))}${fld("d2-just", "Uzasadnienie (min. 20 znaków)", area("d2-just", s2.justification, 2))}</div>
      <div class="eu-row"><button class="btn" type="button" data-d2s="0">Zapisz roboczo</button><button class="btn primary" type="button" data-d2s="1">Zakończ etap 2</button></div>
      <h4 class="eu-h mt4">Etap 3 — ograniczanie ryzyka (art. 11)</h4>
      ${fld("d3-meas", "Środki ograniczające ryzyko (dodatkowe dokumenty, audyt dostawcy, weryfikacja w terenie…)", area("d3-meas", s3.measures, 3))}
      ${fld("d3-res", "Ryzyko rezydualne po wdrożeniu środków", sel("d3-res", [["", "—"], ["NEGLIGIBLE", "Znikome"], ["NOT_NEGLIGIBLE", "Nadal nie-znikome"]], s3.residual))}
      <div class="eu-row"><button class="btn primary" type="button" id="d3-save">Zapisz etap 3</button></div>` : ""}
      <h4 class="eu-h mt4">Wynik końcowy — zatwierdzenie</h4>
      ${can("dd.approve") ? `<div class="eu-grid2">${fld("ap-res", "Decyzja", sel("ap-res", [["ACCEPTED", "Dopuszczona — zgodna"], ["REJECTED", "Niezgodna — wstrzymana"]], "ACCEPTED"))}${fld("ap-just", "Uzasadnienie decyzji (min. 20 znaków)", area("ap-just", "", 2))}</div>
      <label class="inline-opt"><input type="checkbox" id="ap-confirm"> Potwierdzam osobiste sprawdzenie dokumentacji. Wynik automatycznej kontroli formularza nie jest podstawą decyzji.</label>
      <div class="eu-row"><button class="btn primary" type="button" id="ap-ok">${ic("shieldCheck", 15)} Zatwierdź wynik</button></div>` : `<p class="muted">Wynik końcowy zatwierdza Osoba odpowiedzialna albo Administrator EUDR.</p>`}
      <div class="msg hidden mt4" id="dd-msg"></div></div></div>`;
  }
  function bindDd(page, l) {
    if (!l) return;
    const msg = r => { const g = $("#dd-msg", page); g.className = "msg err mt4"; g.textContent = [r.error, r.missing ? r.missing.join("; ") : ""].filter(Boolean).join(" — "); };
    const done = r => { if (!r.ok) return msg(r); Toast.ok("Zapisano"); App.render(); };
    $$("[data-d1]", page).forEach(b => b.onclick = async () => {
      const items = {}; for (const k of Object.keys(E.DD1_ITEMS)) items[k] = { ok: $(`[data-d1ok="${k}"]`, page).checked, na: $(`[data-d1na="${k}"]`, page).checked, note: $(`[data-d1n="${k}"]`, page).value };
      done(await Store.exec("eudr.dd.stage", { id: l.id, stage: 1, items, done: b.dataset.d1 === "1", confirm: $("#d1-confirm", page).checked }, SRC));
    });
    $$("[data-d2s]", page).forEach(b => b.onclick = async () => {
      const criteria = {}; for (const k of Object.keys(E.DD2_CRITERIA)) criteria[k] = { level: $(`[data-d2="${k}"]`, page).value, note: $(`[data-d2n="${k}"]`, page).value };
      done(await Store.exec("eudr.dd.stage", { id: l.id, stage: 2, criteria, result: gv(page, "d2-res"), justification: gv(page, "d2-just"), done: b.dataset.d2s === "1" }, SRC));
    });
    const s3 = $("#d3-save", page); if (s3) s3.onclick = async () => done(await Store.exec("eudr.dd.stage", { id: l.id, stage: 3, measures: gv(page, "d3-meas"), residual: gv(page, "d3-res") }, SRC));
    const ap = $("#ap-ok", page); if (ap) ap.onclick = async () => done(await Store.exec("eudr.dd.approve", { id: l.id, result: gv(page, "ap-res"), justification: gv(page, "ap-just"), confirm: $("#ap-confirm", page).checked }, SRC));
  }

  /* ------------------------------------------------------------------ */
  /* Rejestr DDS / TRACES                                               */
  /* ------------------------------------------------------------------ */
  const ddsBadge = d => `<span class="badge ${d.kind === "SIMULATED" ? "info" : ["AVAILABLE", "SUBMITTED"].includes(d.status) ? "ok" : ["REJECTED", "WITHDRAWN", "CANCELLED"].includes(d.status) ? "err" : "warn"}">${esc(E.DDS_STATUS[d.status] || d.status)}</span>`;
  function ddsTable(list, compact) {
    return `<div class="tbl-wrap"><table class="tbl" id="eu-ddstbl"><thead><tr><th>Nr</th><th>Środowisko</th><th>Rodzaj</th><th>Numer referencyjny</th><th>Numer weryfikacyjny</th><th>Data</th><th>Status</th>${compact ? "" : "<th>Dostawca</th><th>Partie</th><th>Odpowiedzialny</th>"}<th></th></tr></thead><tbody>
      ${list.map(d => `<tr class="${d.kind === "SIMULATED" ? "eu-sim" : ""}"><td class="mono nowrap">${esc(d.no)}</td><td><span class="badge ${d.env === "PRODUCTION" ? "err" : "warn"}">${esc(d.env)}</span></td><td>${esc(E.DDS_KINDS[d.kind] || d.kind)}</td>
        <td class="mono">${esc(d.referenceNumber || "—")}${d.kind === "SIMULATED" ? `<br><small>SYMULACJA — nie jest numerem TRACES</small>` : ""}</td><td class="mono">${esc(d.verificationNumber || "—")}</td><td>${dpl(d.date)}</td><td>${ddsBadge(d)}</td>
        ${compact ? "" : `<td>${esc(partnerName(d.partnerId))}</td><td>${esc((d.lotIds || []).map(id => (lotOf(id) || {}).no).filter(Boolean).join(", "))}</td><td>${esc(d.responsible || "")}</td>`}
        <td class="r"><button class="btn sm" type="button" data-dds="${esc(d.id)}">Otwórz</button></td></tr>`).join("") || `<tr><td colspan="${compact ? 8 : 11}" class="muted">Brak wpisów</td></tr>`}</tbody></table></div>`;
  }
  function bindDdsTable(el, after) { $$("[data-dds]", el).forEach(b => b.onclick = () => ddsCard(b.dataset.dds, after)); }
  function ddsDialog(d, preset) {
    const p = Object.assign({ kind: "SUPPLIER", lotIds: [], status: "DRAFT" }, preset || {}, d || {}), env = d ? d.env : E.envOf(ST());
    const lots = ST().eudrLots.filter(l => l.status !== "ARCHIVED");
    const kinds = Object.entries(E.DDS_KINDS).filter(([k]) => !(env === "PRODUCTION" && k === "SIMULATED"));
    const m = Modal.open({ title: d ? P("Wpis {no}", { no: d.no }) : P("Nowy wpis DDS — {e}", { e: env }), sub: env === "PRODUCTION" ? "Ewidencja produkcyjna. Numerów testowych i symulowanych nie wpisuje się tutaj." : "Ewidencja testowa (ACCEPTANCE) — wpisy nie mają mocy prawnej i nie przechodzą do produkcji.", wide: true,
      body: `${d ? "" : fld("dd-kind", "Rodzaj", sel("dd-kind", kinds, p.kind))}
        <div class="eu-grid2">${fld("dd-ref", "Numer referencyjny", inp("dd-ref", p.referenceNumber, 'class="ctrl mono" autocomplete="off"'))}${fld("dd-ver", "Numer weryfikacyjny", inp("dd-ver", p.verificationNumber, 'class="ctrl mono" autocomplete="off"'))}
        ${fld("dd-date", "Data", inp("dd-date", p.date || App.today(), 'type="date"'))}${fld("dd-st", "Status", sel("dd-st", Object.entries(E.DDS_STATUS), p.status))}
        ${fld("dd-int", "Numer wewnętrzny", inp("dd-int", p.internalRef))}${fld("dd-resp", "Osoba odpowiedzialna", inp("dd-resp", p.responsible || me().name))}</div>
        ${fld("dd-sup", "Dostawca", sel("dd-sup", supOpts(), p.partnerId))}
        ${fld("dd-lots", "Partie (Ctrl — kilka)", `<select class="ctrl" id="dd-lots" multiple size="5">${lots.map(l => `<option value="${esc(l.id)}" ${p.lotIds.includes(l.id) ? "selected" : ""}>${esc(`${l.no} · ${(l.wood || {}).species || ""}`)}</option>`).join("")}</select>`)}
        ${fld("dd-ops", "Dokumenty PZ / WZ (Ctrl — kilka)", `<select class="ctrl" id="dd-ops" multiple size="4">${ST().operations.filter(o => o.type === "ZAKUP" || o.type === "SPRZEDAZ").sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 200).map(o => `<option value="${esc(o.id)}" ${(p.opIds || []).includes(o.id) ? "selected" : ""}>${esc(opLabel(o))}</option>`).join("")}</select>`)}
        ${fld("dd-notes", "Uwagi", area("dd-notes", p.notes, 2))}<div class="msg hidden" id="dd-msg2"></div>`,
      footer: `<button class="btn ghost" type="button" data-x2>Anuluj</button><button class="btn primary" type="button" id="dd-ok">Zapisz</button>` });
    $("[data-x2]", m.el).onclick = m.close;
    $("#dd-ok", m.el).onclick = async () => {
      const args = { id: d ? d.id : undefined, kind: d ? undefined : gv(m, "dd-kind"), referenceNumber: gv(m, "dd-ref"), verificationNumber: gv(m, "dd-ver"), date: gv(m, "dd-date"), status: gv(m, "dd-st"), internalRef: gv(m, "dd-int"), responsible: gv(m, "dd-resp"),
        partnerId: gv(m, "dd-sup"), lotIds: [...$("#dd-lots", m.el).selectedOptions].map(o => o.value), opIds: [...$("#dd-ops", m.el).selectedOptions].map(o => o.value), notes: gv(m, "dd-notes") };
      const res = await Store.exec("eudr.dds.save", args, SRC);
      if (!res.ok) { const g = $("#dd-msg2", m.el); g.className = "msg err"; g.textContent = [res.error, res.errors ? Object.values(res.errors).join("; ") : ""].filter(Boolean).join(" — "); return; }
      Toast.ok("Zapisano wpis DDS"); m.close(); ddsCard(res.dds.id);
    };
  }
  async function serverCall(path, body) {
    const have = ServerBackend.haveRev();
    const r = await ServerBackend.api("POST", path, Object.assign({}, body, have !== null ? { haveRev: have } : {}));
    if (r && r.state !== undefined || (r && r.delta)) { if (ServerBackend.applyPayload(r) === null) await ServerBackend.loadState(true); }
    return r || { ok: false, error: "Brak odpowiedzi serwera" };
  }
  function ddsCard(id, after) {
    const S = ST(), d = R.byId(S.eudrDds, id);
    if (!d) return;
    const env = E.envOf(S), same = d.env === env, ds = E.dataset(S, d.lotIds, { internalRef: d.internalRef || d.no });
    const steps = E.DDS_STEPS.map((s, i) => { const st = (d.steps || {})[i + 1]; return `<li class="${st ? "done" : ""}"><span class="eu-sn">${i + 1}</span><div><b>${esc(s)}</b>${st ? `<small>${esc(st.by)} · ${dtpl(st.at)}</small>` : ""}</div>${!st && can("dds.edit") && same && d.kind !== "SIMULATED" ? `<button class="btn sm" type="button" data-step="${i + 1}">Wykonano</button>` : ""}</li>`; }).join("");
    const m = Modal.open({ title: P("{no} · {k}", { no: d.no, k: E.DDS_KINDS[d.kind] }), sub: `${ddsBadge(d)} <span class="badge ${d.env === "PRODUCTION" ? "err" : "warn"}">${esc(d.env)}</span>${!same ? " · wpis z innego środowiska — tylko odczyt" : ""}`, xwide: true,
      body: `<div class="eu-kv">${[["Numer referencyjny", d.referenceNumber || "—"], ["Numer weryfikacyjny", d.verificationNumber || "—"], ["UUID złożenia", d.uuid || "—"], ["Numer wewnętrzny", d.internalRef || "—"], ["Data", dpl(d.date)], ["Dostawca", partnerName(d.partnerId) || "—"],
          ["Partie", (d.lotIds || []).map(x => (lotOf(x) || {}).no).filter(Boolean).join(", ") || "—"], ["Dokumenty ERP", (d.opIds || []).map(x => (R.byId(S.operations, x) || {}).no).filter(Boolean).join(", ") || "—"], ["Odpowiedzialny", d.responsible || "—"], ["Informacja", d.statusInfo || "—"], ["Uwagi", d.notes || "—"]].map(([k, v]) => `<div><small>${esc(k)}</small><div class="${/Numer|UUID/.test(k) ? "mono" : ""}">${esc(v)}</div></div>`).join("")}</div>
        ${d.kind === "SIMULATED" ? `<div class="info-line mt4">${ic("alert", 15)}<span>SYMULACJA — numer nie pochodzi z systemu TRACES i nie może być użyty w obrocie.</span></div>` : ""}
        ${d.kind === "OWN" ? `<h4 class="eu-h mt4">Proces kontrolowany (gdy brak automatycznej integracji)</h4><ol class="eu-steps">${steps}</ol>
        <div class="eu-row mt4"><button class="btn" type="button" id="ex-json">${ic("dl", 14)} Zestaw danych JSON</button><button class="btn" type="button" id="ex-geo">${ic("dl", 14)} GeoJSON działek</button><button class="btn" type="button" id="ex-xml">${ic("dl", 14)} XML (SubmitDdsRequest V4)</button><button class="btn" type="button" id="ex-copy">${ic("clipboard", 14)} Kopiuj dane</button>
          <a class="btn primary" id="eu-portal2" href="${esc(portal(d.env))}" target="_blank" rel="noopener noreferrer">${ic("globe", 14)} OTWÓRZ OFICJALNY SYSTEM EUDR TRACES</a></div>
        ${ds.errors.length ? `<div class="info-line err mt4">${ic("alert", 15)}<span>Braki w zestawie danych: ${esc(ds.errors.join(" · "))}</span></div>` : ds.warnings.length ? `<div class="info-line mt4">${ic("alert", 15)}<span>${esc(ds.warnings.join(" · "))}</span></div>` : `<div class="info-line ok mt4">${ic("check", 15)}<span>Zestaw danych kompletny.</span></div>`}
        ${Store.mode === "server" && same && can("dds.edit") ? `<h4 class="eu-h mt4">Integracja przez usługi sieciowe (serwer firmy)</h4><p class="muted">Wymaga danych dostępowych użytkownika usług sieciowych w server.env serwera. Status sprawdza się nie wcześniej niż po 1 godzinie od złożenia.</p>
          <div class="eu-row">${!d.uuid ? `<button class="btn primary" type="button" id="api-submit">${ic("up", 14)} Złóż przez API (${esc(d.env)})</button>` : `<button class="btn" type="button" id="api-status">${ic("refresh", 14)} Sprawdź status</button>`}</div>` : ""}` : ""}
        <h4 class="eu-h mt4">Historia wpisu</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kiedy</th><th>Kto</th><th>Zmiana</th><th>Status</th></tr></thead><tbody>${(d.history || []).slice().reverse().map(h => `<tr><td>${dtpl(h.at)}</td><td>${esc(h.by)}</td><td>${esc(h.step ? P("krok {s}", { s: h.step }) : h.change)}</td><td>${esc(E.DDS_STATUS[h.status] || h.status || "")}</td></tr>`).join("")}</tbody></table></div>`,
      footer: same && can("dds.edit") ? `<button class="btn" type="button" id="dd-edit">${ic("edit", 15)} Edytuj</button>` : "" });
    const reopen = () => { m.close(); ddsCard(id, after); };
    const on = (s, fn) => { const el = $(s, m.el); if (el) el.onclick = fn; };
    on("#dd-edit", () => { m.close(); ddsDialog(d); });
    $$("[data-step]", m.el).forEach(b => b.onclick = async () => { if ((await exec("eudr.dds.save", { id: d.id, step: Number(b.dataset.step) }, "Zapisano krok")).ok) reopen(); });
    const base = `EUDR_${d.no.replace(/\//g, "-")}`;
    on("#ex-json", () => download(base + ".json", JSON.stringify(ds, null, 2), "application/json"));
    on("#ex-geo", () => download(base + ".geojson", JSON.stringify(E.datasetGeo(ds), null, 2), "application/geo+json"));
    on("#ex-xml", () => download(base + ".xml", `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Treść żądania SubmitDdsRequest (V4) przygotowana w ResInvest ERP — bez nagłówka WS-Security i bez danych dostępowych -->\n` + E.submitXml(ds), "application/xml"));
    on("#ex-copy", async () => { try { await navigator.clipboard.writeText(ds.commodities.map(c => [`Opis: ${c.description}`, `Kod HS: ${c.hsHeading}`, `Gatunek: ${c.commonName} (${c.scientificName})`, `Masa netto kg: ${c.netWeightKg || "—"}`, `Objętość m³: ${c.volumeM3 || "—"}`, ...c.producers.map(p => `Producent: ${p.name} (${p.country})`)].join("\n")).join("\n\n")); Toast.ok("Skopiowano dane do schowka"); } catch (e) { Toast.warn("Schowek niedostępny"); } });
    on("#api-submit", async () => {
      let confirm;
      if (d.env === "PRODUCTION") { const r = await Modal.confirm({ title: "Złożenie oświadczenia w systemie PRODUKCYJNYM", text: "Oświadczenie wywołuje skutki prawne. Aby kontynuować, wpisz PRODUKCJA.", ok: "Złóż", danger: true, input: { label: "Potwierdzenie", required: true } }); if (!r.ok) return; confirm = r.value; }
      else { const r = await Modal.confirm({ title: "Złożenie oświadczenia w środowisku ACCEPTANCE", text: "Środowisko testowe — dane nie mają mocy prawnej.", ok: "Złóż" }); if (!r.ok) return; }
      const res = await serverCall("/api/eudr/traces/submit", { id: d.id, confirm });
      if (!res.ok) return Toast.err("Nie złożono", [res.error, (res.errors || []).join("; ")].filter(Boolean).join(" — "));
      Toast.ok("Oświadczenie złożone", P("UUID: {u}. Numer referencyjny odczytaj po co najmniej 1 godzinie.", { u: res.uuid })); reopen();
    });
    on("#api-status", async () => {
      let confirm;
      if (d.env === "PRODUCTION") { const r = await Modal.confirm({ title: "Odczyt statusu w systemie produkcyjnym", text: "Wpisz PRODUKCJA, aby potwierdzić.", ok: "Sprawdź", input: { label: "Potwierdzenie", required: true } }); if (!r.ok) return; confirm = r.value; }
      const res = await serverCall("/api/eudr/traces/status", { id: d.id, confirm });
      if (!res.ok) return Toast.warn("Status nieodczytany", res.error);
      Toast.ok("Zaktualizowano status", `${res.overview.status} ${res.overview.referenceNumber || ""}`); reopen();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Tabele pomocnicze: historia                                         */
  /* ------------------------------------------------------------------ */
  const showVal = v => v === null || v === undefined ? "" : typeof v === "object" ? Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== "").map(([k, x]) => `${k.replace(/_/g, " ")}: ${typeof x === "object" ? JSON.stringify(x) : x}`).join("; ") : String(v);
  function historyTable(H) {
    return `<div class="tbl-wrap"><table class="tbl eu-hist"><thead><tr><th>Kiedy</th><th>Użytkownik</th><th>Czynność</th><th>Obiekt</th><th>Przed</th><th>Po</th></tr></thead><tbody>
      ${H.slice(0, 500).map(a => `<tr><td class="nowrap">${dtpl(a.ts)}</td><td>${esc(a.userName)}</td><td>${esc(a.action || "")}</td><td class="mono">${esc(a.opNo || "")}</td><td><small>${esc(showVal(a.before))}</small></td><td><small>${esc(showVal(a.after))}</small></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Brak wpisów</td></tr>`}</tbody></table></div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Zakładki modułu                                                     */
  /* ------------------------------------------------------------------ */
  const TABS = {};
  TABS.dash = {
    html() {
      const S = ST(), d = E.dashboard(S, me(), ctx()), k = d.kpi, unas = E.unassignedReceipts(S, me()).length;
      const tile = (key, label, v, sub, color) => `<div class="kpi eu-kpi ${color ? "eu-k-" + color : ""}" data-kpi="${key}"><div class="k-t">${esc(label)}</div><div class="k-v">${esc(String(v))}</div>${sub ? `<div class="k-s">${esc(sub)}</div>` : ""}</div>`;
      return `<div class="eu-kpis" id="eu-kpis">${tile("lots", "Partie drewna", k.lots, P("archiwum: {a}", { a: k.archived }))}${tile("suppliers", "Dostawcy", k.suppliers)}${tile("complete", "Kompletne", k.complete, "", "green")}${tile("missing", "Braki / niezgodności", k.missing, "", "red")}
        ${tile("pending", "Do weryfikacji", k.pending, "", "yellow")}${tile("verified", "Dopuszczone", k.verified, "", "green")}${tile("ddsActive", "Aktywne DDS (produkcja)", k.ddsActive)}${tile("withRef", "Partie z numerem referencyjnym", k.withRef)}</div>
        <div class="eu-legend mt4">${Object.entries(E.COLORS).map(([c, l]) => `<span>${dot(c)} ${esc(l)}</span>`).join("")}</div>
        <div class="eu-cols mt4"><div class="card"><div class="card-h"><h3>Alerty</h3>${unas ? `<button class="btn sm" type="button" id="eu-rcpt-btn">${P("Przyjęcia do przypisania: {n}", { n: unas })}</button>` : ""}</div><div class="card-b"><ul class="eu-alerts" id="eu-alerts">
          ${d.alerts.map(a => `<li class="eu-al-${a.level}">${dot(a.level)} ${a.lotId ? `<a href="#" data-lot="${esc(a.lotId)}" class="mono">${esc(a.no)}</a> ` : ""}${esc(a.text)}</li>`).join("") || `<li class="muted">Brak alertów</li>`}</ul></div></div>
          <div class="card"><div class="card-h"><h3>Ostatnie operacje</h3></div><div class="card-b"><ul class="eu-recent">${d.recent.map(a => `<li><small>${dtpl(a.ts)} · ${esc(a.userName)}</small><br>${esc(a.action)} <span class="mono">${esc(a.opNo || "")}</span></li>`).join("") || `<li class="muted">Brak operacji</li>`}</ul></div></div></div>
        <div class="card mt4"><div class="card-b"><b>Stosowanie obowiązków:</b> ${esc(dpl(d.applyDate))} (wielkość: ${esc((E.profile(S).size))}) · reguły: ${esc(E.rules(S).version)} · środowisko: ${esc(d.env)}
          <p class="muted">Program wspiera organizację należytej staranności. Wynik w programie nie stanowi potwierdzenia zgodności z prawem — decyzje podejmują osoby odpowiedzialne.</p></div></div>`;
    },
    bind(page) {
      const b = $("#eu-rcpt-btn", page); if (b) b.onclick = receiptsDialog;
      $$("[data-kpi]", page).forEach(x => x.onclick = () => { const k = x.dataset.kpi, f = T(); f.tab = k === "suppliers" ? "suppliers" : k === "ddsActive" ? "traces" : "lots"; f.color = k === "missing" ? "red" : k === "complete" ? "green" : ""; f.status = k === "pending" ? "PENDING" : k === "verified" ? "VERIFIED" : ""; App.render(); });
    }
  };
  function filteredLots() {
    const f = T(), S = ST(), q = f.q.trim().toLowerCase();
    return E.visibleLots(S, me()).filter(l => (f.arch || l.status !== "ARCHIVED") && (!f.status || l.status === f.status) && (!f.acq || l.acq === f.acq)
      && (!f.color || E.evaluate(S, l, ctx()).color === f.color)
      && (!q || [l.no, l.wood && l.wood.species, l.wood && l.wood.speciesLatin, l.wood && l.wood.cn, partnerName(l.partnerId), l.receipt && l.receipt.opNo, l.origin && l.origin.owner, l.origin && l.origin.plot].join(" ").toLowerCase().includes(q)))
      .sort((a, b) => a.no < b.no ? 1 : -1);
  }
  TABS.lots = {
    html() {
      const f = T(), list = filteredLots(), S = ST();
      return `<div class="card"><div class="toolbar">
          <div class="field"><label for="lf-q">Szukaj</label><input class="ctrl" id="lf-q" value="${esc(f.q)}" placeholder="nr, gatunek, CN, dostawca, PZ…"></div>
          ${fld("lf-fs", "Status", sel("lf-fs", opts(E.LOT_STATUS, "wszystkie"), f.status))}${fld("lf-fc", "Kolor", sel("lf-fc", opts(E.COLORS, "wszystkie"), f.color))}${fld("lf-fa", "Nabycie", sel("lf-fa", [["", "wszystkie"]].concat(Object.entries(E.ACQ).map(([k, v]) => [k, v.label])), f.acq))}
          <label class="inline-opt"><input type="checkbox" id="lf-arch" ${f.arch ? "checked" : ""}> archiwum</label>
          <div class="eu-row">${can("lot.edit") ? `<button class="btn primary" type="button" id="eu-newlot">${ic("plus", 15)} Nowa partia</button><button class="btn" type="button" id="eu-rcpt">${ic("inbox", 15)} Przyjęcia do przypisania</button>` : ""}
          ${can("lot.link") ? `<button class="btn" type="button" id="eu-merge" ${f.sel.length < 2 ? "disabled" : ""}>Połącz zaznaczone (${f.sel.length})</button><button class="btn" type="button" id="eu-proc" ${!f.sel.length ? "disabled" : ""}>Przetwórz zaznaczone</button>` : ""}</div></div>
        <div class="tbl-wrap"><table class="tbl" id="eu-lots"><thead><tr><th></th><th>Nr partii</th><th>Gatunek</th><th>CN</th><th class="r">Ilość</th><th class="r">Saldo</th><th>Dostawca</th><th>Magazyn</th><th>PZ</th><th>Rola</th><th>Status</th></tr></thead><tbody>
        ${list.map(l => { const ev = E.evaluate(S, l, ctx()); return `<tr data-lotrow="${esc(l.id)}" class="eu-click"><td><input type="checkbox" data-pick="${esc(l.id)}" ${f.sel.includes(l.id) ? "checked" : ""} aria-label="Zaznacz"></td><td class="mono nowrap">${dot(ev.color)} ${esc(l.no)}</td><td>${esc((l.wood || {}).species || "—")}<br><small class="muted"><i>${esc((l.wood || {}).speciesLatin || "")}</i></small></td><td>${esc((l.wood || {}).cn || "")}</td>
          <td class="r">${fq(l.qty)} ${esc(unitOf(l))}</td><td class="r">${fq(E.balance(l))}</td><td>${esc(partnerName(l.partnerId))}</td><td>${esc(whName(l.whId))}</td><td class="mono">${esc(l.receipt ? l.receipt.opNo : (l.parents || []).length ? "z partii" : "—")}</td><td><small>${esc(ev.ob.role)}</small></td><td>${statusBadge(l)}${ev.missing.length && l.status !== "ARCHIVED" ? `<br><small class="neg">braki: ${ev.missing.length}</small>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="11" class="muted">Brak partii</td></tr>`}</tbody></table></div></div>`;
    },
    bind(page) {
      const f = T();
      const q = $("#lf-q", page); q.oninput = () => { f.q = q.value; clearTimeout(f._t); f._t = setTimeout(() => { App.render(); const x = $("#lf-q"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); };
      [["lf-fs", "status"], ["lf-fc", "color"], ["lf-fa", "acq"]].forEach(([id, k]) => $("#" + id, page).onchange = e => { f[k] = e.target.value; App.render(); });
      $("#lf-arch", page).onchange = e => { f.arch = e.target.checked; App.render(); };
      const on = (s, fn) => { const el = $(s, page); if (el) el.onclick = fn; };
      on("#eu-newlot", () => lotDialog(null)); on("#eu-rcpt", receiptsDialog);
      on("#eu-merge", async () => { const r = await Modal.confirm({ title: "Łączenie partii", text: P("Połączyć {n} partii w nową partię? Pochodzenie wszystkich źródeł zostaje zapisane.", { n: f.sel.length }), ok: "Połącz" }); if (r.ok) { const res = await exec("eudr.lot.merge", { ids: f.sel }); if (res.ok) { f.sel = []; Toast.ok(P("Utworzono partię {no}", { no: res.lot.no })); App.render(); } } });
      on("#eu-proc", () => processDialog(f.sel));
      $$("[data-pick]", page).forEach(c => { c.onclick = e => e.stopPropagation(); c.onchange = () => { const id = c.dataset.pick; f.sel = c.checked ? f.sel.concat(id) : f.sel.filter(x => x !== id); App.render(); }; });
      $$("[data-lotrow]", page).forEach(r => r.onclick = () => lotCard(r.dataset.lotrow));
    }
  };
  TABS.suppliers = {
    html() {
      const S = ST(), q = (T().supQ || "").toLowerCase();
      const ids = new Set((S.partners || []).filter(p => p.role !== "buyer").map(p => p.id));
      for (const s of S.eudrSuppliers || []) ids.add(s.partnerId);
      const list = [...ids].map(id => R.byId(S.partners, id)).filter(p => p && (!q || p.name.toLowerCase().includes(q)));
      return `<div class="card"><div class="toolbar"><div class="field"><label for="sp-q">Szukaj dostawcy</label><input class="ctrl" id="sp-q" value="${esc(T().supQ || "")}"></div><p class="muted">Dostawcy pochodzą z kartoteki kontrahentów ERP — moduł EUDR dopisuje tylko dane EUDR (bez drugiej listy dostawców).</p></div>
        <div class="tbl-wrap"><table class="tbl" id="eu-sups"><thead><tr><th>Dostawca</th><th>Miejscowość</th><th>Rola EUDR</th><th>Kraj</th><th>NIP</th><th>Kontakt</th><th>Weryfikacja</th><th class="r">Partie</th><th></th></tr></thead><tbody>
        ${list.map(p => { const s = E.supplierOf(S, p.id) || {}; const n = (S.eudrLots || []).filter(l => l.partnerId === p.id && l.status !== "ARCHIVED").length; return `<tr><td>${esc(p.name)}</td><td>${esc(p.city || "")}</td><td>${esc(E.SUPPLIER_ROLES[s.role] || "—")}</td><td>${esc(s.country || "")}</td><td>${esc(s.nip || p.nip || "")}</td><td>${esc([s.email || p.email, s.phone || p.phone].filter(Boolean).join(" · "))}</td>
          <td><span class="badge ${s.status === "VERIFIED" ? "ok" : s.status === "REJECTED" ? "err" : "warn"}">${esc(E.SUPPLIER_STATUS[s.status || "UNVERIFIED"])}</span>${s.validTo ? `<br><small>do ${dpl(s.validTo)}</small>` : ""}</td><td class="r">${n}</td>
          <td class="r nowrap">${can("supplier.edit") ? `<button class="btn sm" type="button" data-sup="${esc(p.id)}">${ic("edit", 14)} Dane EUDR</button>` : ""} <button class="btn sm ghost" type="button" data-supdocs="${esc(p.id)}">${ic("file", 14)} Dokumenty</button></td></tr>`; }).join("") || `<tr><td colspan="9" class="muted">Brak dostawców</td></tr>`}</tbody></table></div></div>`;
    },
    bind(page) {
      const q = $("#sp-q", page); q.oninput = () => { T().supQ = q.value; clearTimeout(T()._t); T()._t = setTimeout(() => { App.render(); const x = $("#sp-q"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); };
      $$("[data-sup]", page).forEach(b => b.onclick = () => supplierDialog(b.dataset.sup));
      $$("[data-supdocs]", page).forEach(b => b.onclick = () => { const id = b.dataset.supdocs; const m = Modal.open({ title: P("Dokumenty dostawcy {n}", { n: partnerName(id) }), xwide: true, body: `${can("doc.add") ? `<div class="eu-row"><button class="btn sm primary" type="button" id="sd-add">${ic("plus", 14)} Dodaj dokument dostawcy</button></div>` : ""}${docTable((ST().eudrDocs || []).filter(d => d.partnerId === id && d.status !== "ARCHIVED"))}` });
        bindDocTable(m.el, () => { m.close(); App.render(); }); const a = $("#sd-add", m.el); if (a) a.onclick = () => { m.close(); docDialog(null, { partnerId: id }); }; });
    }
  };
  function supplierDialog(pid) {
    const p = R.byId(ST().partners, pid), s = E.supplierOf(ST(), pid) || {};
    const m = Modal.open({ title: P("Dane EUDR — {n}", { n: p.name }), sub: "Nazwa i podstawowe dane pochodzą z kartoteki kontrahentów.", wide: true,
      body: `<div class="eu-grid2">${fld("su-role", "Rola dostawcy", sel("su-role", opts(E.SUPPLIER_ROLES, "—"), s.role))}${fld("su-c", "Kraj (ISO)", inp("su-c", s.country || "PL", 'maxlength="2"'))}
        ${fld("su-addr", "Adres", inp("su-addr", s.address || p.address))}${fld("su-nip", "NIP / numer podatkowy", inp("su-nip", s.nip || p.nip))}
        ${fld("su-contact", "Osoba kontaktowa", inp("su-contact", s.contact))}${fld("su-email", "E-mail", inp("su-email", s.email || p.email, 'type="email"'))}
        ${fld("su-phone", "Telefon", inp("su-phone", s.phone || p.phone))}${fld("su-contract", "Umowa", inp("su-contract", s.contract))}
        ${fld("su-opref", "Numer operatora w systemie EUDR", inp("su-opref", s.operatorRef))}${fld("su-eori", "EORI", inp("su-eori", s.eori))}
        ${fld("su-st", "Status weryfikacji", sel("su-st", Object.entries(E.SUPPLIER_STATUS), s.status || "UNVERIFIED"))}${fld("su-valid", "Weryfikacja ważna do", inp("su-valid", s.validTo, 'type="date"'))}</div>
        ${fld("su-vnote", "Zakres weryfikacji (wymagany przy zmianie na „Zweryfikowany”)", area("su-vnote", "", 2))}${fld("su-notes", "Uwagi", area("su-notes", s.notes, 2))}
        ${s.verification ? `<p class="muted">Ostatnia weryfikacja: ${esc(s.verification.by)} · ${dtpl(s.verification.at)} — ${esc(s.verification.note)}</p>` : ""}<div class="msg hidden" id="su-msg"></div>`,
      footer: `<button class="btn primary" type="button" id="su-ok">Zapisz</button>` });
    $("#su-ok", m.el).onclick = async () => {
      const res = await Store.exec("eudr.supplier.save", { partnerId: pid, role: gv(m, "su-role") || undefined, country: gv(m, "su-c"), address: gv(m, "su-addr"), nip: gv(m, "su-nip"), contact: gv(m, "su-contact"), email: gv(m, "su-email"), phone: gv(m, "su-phone"), contract: gv(m, "su-contract"), operatorRef: gv(m, "su-opref"), eori: gv(m, "su-eori"), status: gv(m, "su-st"), validTo: gv(m, "su-valid"), verifyNote: gv(m, "su-vnote"), notes: gv(m, "su-notes") }, SRC);
      if (!res.ok) { const g = $("#su-msg", m.el); g.className = "msg err"; g.textContent = [res.error, res.errors ? Object.values(res.errors).join("; ") : ""].filter(Boolean).join(" — "); return; }
      Toast.ok("Zapisano dane dostawcy"); m.close(); App.render();
    };
  }
  TABS.docs = {
    html() {
      const f = T(), q = (f.docQ || "").toLowerCase();
      const list = (ST().eudrDocs || []).filter(d => (!f.docType || d.type === f.docType) && (f.docArch || d.status !== "ARCHIVED") && (!q || [d.no, d.number, d.title, partnerName(d.partnerId), (d.lotIds || []).map(id => (lotOf(id) || {}).no).join(" ")].join(" ").toLowerCase().includes(q))).sort((a, b) => a.no < b.no ? 1 : -1);
      return `<div class="card"><div class="toolbar"><div class="field"><label for="dq">Szukaj</label><input class="ctrl" id="dq" value="${esc(f.docQ || "")}"></div>${fld("dt", "Rodzaj", sel("dt", opts(E.DOC_TYPES, "wszystkie"), f.docType))}
        <label class="inline-opt"><input type="checkbox" id="darch" ${f.docArch ? "checked" : ""}> archiwum</label>${can("doc.add") ? `<button class="btn primary" type="button" id="eu-newdoc">${ic("plus", 15)} Dodaj dokument</button>` : ""}</div>${docTable(list)}</div>`;
    },
    bind(page) {
      const f = T();
      const q = $("#dq", page); q.oninput = () => { f.docQ = q.value; clearTimeout(f._t); f._t = setTimeout(() => { App.render(); const x = $("#dq"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); };
      $("#dt", page).onchange = e => { f.docType = e.target.value; App.render(); };
      $("#darch", page).onchange = e => { f.docArch = e.target.checked; App.render(); };
      const b = $("#eu-newdoc", page); if (b) b.onclick = () => docDialog(null);
      bindDocTable(page);
    }
  };
  /** Podgląd geometrii (SVG, bez podkładu mapowego — program działa bez internetu). */
  function geoSvg(g) {
    if (!g) return `<div class="eu-geo-empty">brak</div>`;
    const feats = g.type === "FeatureCollection" ? g.features : [g.type === "Feature" ? g : { geometry: g }];
    const pts = [], shapes = [];
    for (const f of feats) { const gm = f.geometry; if (!gm) continue; if (gm.type === "Point") { pts.push(gm.coordinates); shapes.push({ p: gm.coordinates }); } else { const polys = gm.type === "Polygon" ? [gm.coordinates] : gm.coordinates || []; for (const pl of polys) { (pl[0] || []).forEach(c => pts.push(c)); shapes.push({ r: pl[0] || [] }); } } }
    if (!pts.length) return `<div class="eu-geo-empty">brak</div>`;
    const xs = pts.map(c => c[0]), ys = pts.map(c => c[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), span = Math.max(x1 - x0, y1 - y0, 0.002);
    const X = x => 10 + (x - x0) / span * 100, Y = y => 110 - (y - y0) / span * 100;
    return `<svg class="eu-geo" viewBox="0 0 120 120" role="img" aria-label="Geometria działki">${shapes.map(s => s.p ? `<circle cx="${X(s.p[0])}" cy="${Y(s.p[1])}" r="4"/>` : `<polygon points="${s.r.map(c => `${X(c[0])},${Y(c[1])}`).join(" ")}"/>`).join("")}</svg>`;
  }
  TABS.geo = {
    html() {
      const S = ST(), list = E.visibleLots(S, me()).filter(l => l.status !== "ARCHIVED").sort((a, b) => a.no < b.no ? 1 : -1);
      return `<div class="card"><div class="card-h"><h3>Pochodzenie i geolokalizacja partii</h3></div><div class="card-b"><p class="muted">WGS84, kolejność w GeoJSON: długość, szerokość; najwyżej 6 miejsc po przecinku; działka do 4 ha — punkt, powyżej 4 ha — wielokąt bez otworów. Podgląd schematyczny (bez mapy podkładowej).</p></div>
        <div class="tbl-wrap"><table class="tbl" id="eu-geo"><thead><tr><th>Partia</th><th>Właściciel / działka</th><th>Kraj / ryzyko</th><th>GPS</th><th class="r">ha</th><th>Kontrola</th><th>Podgląd</th><th></th></tr></thead><tbody>
        ${list.map(l => { const o = l.origin || {}, g = E.lotGeo(l), c = g ? E.checkGeo(g) : null, ob = E.obligations(S, l, ctx()); return `<tr><td class="mono"><a href="#" data-lot="${esc(l.id)}">${esc(l.no)}</a></td><td>${esc([o.owner, o.plot].filter(Boolean).join(" · ") || "—")}</td><td>${esc([o.country, E.RISK_COUNTRY[o.riskCountry]].filter(Boolean).join(" · "))}</td>
          <td class="mono">${o.geojson ? "polygon" : Number.isFinite(o.lat) ? esc(`${o.lat}, ${o.lon}`) : "—"}</td><td class="r">${o.areaHa ? fq(o.areaHa) : ""}</td>
          <td>${!g ? `<span class="badge ${ob.geoRequired ? "err" : ""}">${ob.geoRequired ? "wymagana — brak" : "brak"}</span>` : c.ok ? `<span class="badge ok">poprawna</span>` : `<span class="badge err">${esc(c.errors[0])}</span>`}</td><td>${geoSvg(g)}</td>
          <td class="r">${can("lot.edit") && l.status !== "ARCHIVED" ? `<button class="btn sm" type="button" data-geoedit="${esc(l.id)}">${ic("edit", 14)}</button>` : ""}${g ? ` <button class="btn sm ghost" type="button" data-geodl="${esc(l.id)}" title="Pobierz GeoJSON">${ic("dl", 14)}</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="8" class="muted">Brak partii</td></tr>`}</tbody></table></div></div>`;
    },
    bind(page) {
      $$("[data-lot]", page).forEach(a => a.onclick = e => { e.preventDefault(); lotCard(a.dataset.lot); });
      $$("[data-geoedit]", page).forEach(b => b.onclick = () => lotDialog(lotOf(b.dataset.geoedit)));
      $$("[data-geodl]", page).forEach(b => b.onclick = () => { const l = lotOf(b.dataset.geodl); download(`${l.no.replace(/\//g, "-")}.geojson`, JSON.stringify(E.lotGeo(l), null, 2), "application/geo+json"); });
    }
  };
  TABS.dd = {
    html() {
      const S = ST(), f = T(), list = E.visibleLots(S, me()).filter(l => l.status !== "ARCHIVED" && E.obligations(S, l, ctx()).covered).sort((a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1) || (a.no < b.no ? 1 : -1));
      const cur = lotOf(f.ddLot) || list.find(l => l.status === "PENDING") || list[0];
      return `<div class="card"><div class="card-h"><h3>Należyta staranność — partie objęte EUDR</h3></div><div class="card-b"><p class="muted">Trzy etapy: zbieranie informacji, ocena ryzyka, ograniczanie ryzyka; wynik końcowy zatwierdza osoba uprawniona. Partii nie oznacza się jako zgodnej wyłącznie na podstawie automatycznego sprawdzenia formularza.</p>
        ${fld("dd-pick", "Partia", sel("dd-pick", list.map(l => [l.id, `${l.no} · ${(l.wood || {}).species || ""} · ${E.LOT_STATUS[l.status]}`]), cur ? cur.id : ""))}</div></div>${cur ? ddPanel(cur) : `<p class="muted mt4">Brak partii objętych EUDR.</p>`}`;
    },
    bind(page) {
      const p = $("#dd-pick", page); if (p) p.onchange = () => { T().ddLot = p.value; App.render(); };
      const S = ST(), f = T(), cur = lotOf(f.ddLot) || E.visibleLots(S, me()).find(l => l.status === "PENDING" && E.obligations(S, l, ctx()).covered) || E.visibleLots(S, me()).find(l => l.status !== "ARCHIVED" && E.obligations(S, l, ctx()).covered);
      bindDd(page, cur);
    }
  };
  TABS.traces = {
    html() {
      const S = ST(), env = E.envOf(S), f = T(), list = (S.eudrDds || []).filter(d => f.showOther || d.env === env).sort((a, b) => a.no < b.no ? 1 : -1);
      const runs = (S.eudrTests || []).slice().sort((a, b) => a.ts < b.ts ? 1 : -1);
      const last = runs[0];
      return `<div class="eu-cols"><div class="card"><div class="card-h"><h3>Oficjalny system EUDR</h3></div><div class="card-b">
          <a class="btn primary eu-portal" id="eu-portal" href="${esc(portal(env))}" target="_blank" rel="noopener noreferrer">${ic("globe", 16)} OTWÓRZ OFICJALNY SYSTEM EUDR TRACES</a>
          <p class="muted mt4">Otwiera stronę systemu informacyjnego EUDR Komisji Europejskiej (${esc(env)}). Logowanie kontem EU Login odbywa się w systemie Komisji — ResInvest ERP nie zapisuje haseł do TRACES.</p>
          <div id="eu-tinfo" class="mt4">${Store.mode === "server" ? `<small class="muted">Sprawdzanie konfiguracji serwera…</small>` : `<div class="info-line">${ic("alert", 15)}<span>Tryb bez serwera: brak połączenia z systemem EUDR — dostępny proces ręczny (eksport danych, przepisanie numerów). Program nie udaje połączenia z Komisją Europejską.</span></div>`}</div></div></div>
        <div class="card"><div class="card-h"><h3>Centrum testów EUDR</h3><button class="btn sm primary" type="button" id="tc-run" ${can("tests.run") ? "" : "disabled"}>${ic("play", 14)} Uruchom testy</button></div><div class="card-b">
          ${last ? `<p>Ostatni przebieg: ${dtpl(last.ts)} · ${esc(last.env)} · ${esc(last.by)} · ${last.mode === "server" ? "serwer" : "lokalnie"} · <b class="${last.ok ? "pos" : "neg"}">${last.ok ? "bez błędów" : "błędy"}</b></p>
          <ul class="eu-tests" id="eu-tests">${E.TESTS.map(tt => { const r = last.results.find(x => x.key === tt.key); return `<li class="eu-t-${r ? r.status : "NONE"}"><b>${esc(r ? r.status : "—")}</b> ${esc(tt.label)}${r && r.detail ? `<br><small>${esc(r.detail)}</small>` : ""}</li>`; }).join("")}</ul>
          <div class="eu-row">${last.results.some(r => r.status === "FAIL") && can("tests.run") ? `<button class="btn sm" type="button" id="tc-rerun">Powtórz nieudane</button>` : ""}<button class="btn sm" type="button" id="tc-pdf">${ic("pdf", 14)} Raport testów PDF</button></div>` : `<p class="muted">Testy nie były jeszcze uruchamiane.</p>`}
          ${runs.length > 1 ? `<details class="mt4"><summary>Historia (${runs.length})</summary><ul class="eu-recent">${runs.slice(0, 30).map(r => `<li>${dtpl(r.ts)} · ${esc(r.env)} · ${esc(r.by)} · ${r.results.filter(x => x.status === "OK").length} OK / ${r.results.filter(x => x.status === "FAIL").length} błędów / ${r.results.filter(x => x.status === "SKIP").length} pominiętych</li>`).join("")}</ul></details>` : ""}</div></div></div>
        <div class="card mt4"><div class="toolbar"><h3 class="eu-grow">Rejestr DDS i numerów referencyjnych — ${esc(env)}</h3><label class="inline-opt"><input type="checkbox" id="dd-other" ${f.showOther ? "checked" : ""}> pokaż także drugie środowisko (tylko odczyt)</label>${can("dds.edit") ? `<button class="btn primary" type="button" id="dd-new">${ic("plus", 15)} Nowy wpis</button>` : ""}</div>${ddsTable(list)}</div>
        <details class="card mt4" id="eu-access"><summary class="card-h"><h3>Jak uzyskać dostęp do API systemu EUDR</h3></summary><div class="card-b">${guideBody(E.content().guides[0])}
          <p><b>Ustawienia serwera (plik server.env w folderze danych serwera, nie w repozytorium):</b></p><pre class="eu-pre">EUDR_ACC_USERNAME=        # nazwa użytkownika EU Login (ACCEPTANCE)\nEUDR_ACC_AUTH_KEY=        # klucz uwierzytelniający (Web Services Access) — poufny\nEUDR_ACC_CLIENT_ID=       # WebServiceClientId\nEUDR_PROD_USERNAME=\nEUDR_PROD_AUTH_KEY=\nEUDR_PROD_CLIENT_ID=</pre>
          <p class="muted">Samo konto EU Login nie daje dostępu do API. Wsparcie techniczne Komisji: SANTE-TRACES@ec.europa.eu (temat wiadomości zaczynający się od „EUDR API”).</p></div></details>`;
    },
    bind(page) {
      const f = T();
      $("#dd-other", page).onchange = e => { f.showOther = e.target.checked; App.render(); };
      const n = $("#dd-new", page); if (n) n.onclick = () => ddsDialog(null);
      bindDdsTable(page);
      const run = keys => runTests(keys);
      const r = $("#tc-run", page); if (r) r.onclick = () => run();
      const rr = $("#tc-rerun", page); if (rr) rr.onclick = () => { const last = ST().eudrTests.slice().sort((a, b) => a.ts < b.ts ? 1 : -1)[0]; run(last.results.filter(x => x.status === "FAIL").map(x => x.key)); };
      const pd = $("#tc-pdf", page); if (pd) pd.onclick = () => testsPdf();
      if (Store.mode === "server") ServerBackend.api("GET", "/api/eudr/traces/info").then(res => {
        const el = $("#eu-tinfo"); if (!el || !res || !res.ok) return;
        const row = (k, c) => `<tr><td>${esc(k)}</td><td>${c.configured ? `<span class="badge ok">skonfigurowane</span>` : `<span class="badge warn">brak danych w server.env</span>`}</td><td class="mono">${esc(c.username || "—")}</td><td class="mono">${esc(c.clientId || "—")}</td><td><small>${esc(c.base)}</small></td></tr>`;
        el.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Środowisko</th><th>Dane dostępowe</th><th>Użytkownik</th><th>Klient</th><th>Adres usługi</th></tr></thead><tbody>${row("ACCEPTANCE", res.info.ACCEPTANCE)}${row("PRODUCTION", res.info.PRODUCTION)}</tbody></table></div><small class="muted">Wartości są zamaskowane; klucz uwierzytelniający nigdy nie jest przesyłany do przeglądarki.</small>`;
      });
    }
  };
  async function runTests(keys) {
    const env = E.envOf(ST());
    if (Store.mode === "server") {
      let confirm;
      if (env === "PRODUCTION") { const r = await Modal.confirm({ title: "Testy w środowisku PRODUKCYJNYM", text: "Testy połączenia wykonują odczyt z filtrem (bez zmian danych). Wpisz PRODUKCJA, aby potwierdzić.", ok: "Uruchom", input: { label: "Potwierdzenie", required: true } }); if (!r.ok) return; confirm = r.value; }
      Toast.info("Testy w toku…");
      const res = await serverCall("/api/eudr/traces/tests", { keys, confirm });
      if (!res.ok) return Toast.err("Testy nieudane", res.error);
      Toast[res.run.ok ? "ok" : "warn"](res.run.ok ? "Testy zakończone bez błędów" : "Testy wykazały błędy"); App.render();
      return;
    }
    const results = (keys && keys.length ? E.TESTS.filter(t0 => keys.includes(t0.key)) : E.TESTS).map(tt => Object.assign({ key: tt.key, ms: 0 }, E.localTest(ST(), tt.key, ctx())));
    const res = await exec("eudr.tests.record", { results });
    if (res.ok) { Toast[res.run.ok ? "ok" : "warn"](res.run.ok ? "Testy lokalne zakończone" : "Testy wykazały błędy", "Testy połączenia wymagają serwera firmy."); App.render(); }
  }
  function testsPdf() {
    const runs = ST().eudrTests.slice().sort((a, b) => a.ts < b.ts ? 1 : -1), r = runs[0];
    if (!r) return;
    const model = { title: "Raport testów EUDR", subtitle: `${r.env} · ${dtpl(r.ts)}`, orientation: "portrait", rangeText: dtpl(r.ts), whText: "",
      meta: [["Środowisko", r.env], ["Wykonał", r.by], ["Tryb", r.mode === "server" ? "serwer firmy" : "lokalnie (bez połączenia)"], ["Wynik", r.ok ? "bez błędów" : "błędy"]],
      blocks: [{ type: "p", text: r.env === "PRODUCTION" ? "TRYB PRODUKCYJNY – OPERACJE MOGĄ WYWOŁYWAĆ SKUTKI PRAWNE" : "TRYB TESTOWY – DANE NIE MAJĄ MOCY PRAWNEJ", bold: true },
        { type: "table", columns: [{ label: "Test", w: 3 }, { label: "Wynik", w: 0.8 }, { label: "Szczegóły", w: 4 }, { label: "ms", w: 0.6, align: "right" }], rows: r.results.map(x => [(E.TESTS.find(tt => tt.key === x.key) || {}).label || x.key, x.status, x.detail || "", String(x.ms || 0)]) },
        { type: "h", text: "Historia przebiegów" },
        { type: "table", columns: [{ label: "Data", w: 1.6 }, { label: "Środowisko", w: 1.2 }, { label: "Wykonał", w: 1.6 }, { label: "OK", w: 0.6, align: "right" }, { label: "Błędy", w: 0.6, align: "right" }, { label: "Pominięte", w: 0.8, align: "right" }], rows: runs.slice(0, 40).map(x => [dtpl(x.ts), x.env, x.by, String(x.results.filter(y => y.status === "OK").length), String(x.results.filter(y => y.status === "FAIL").length), String(x.results.filter(y => y.status === "SKIP").length)]) },
        { type: "p", text: "Wyniki testów dotyczą konfiguracji i połączenia technicznego; nie potwierdzają zgodności z prawem.", muted: true }] };
    UI.Printer.pdf(model, "RAP", `testy_EUDR_${r.env}`);
  }
  TABS.audit = {
    html() {
      const S = ST(), f = T(), list = (S.eudrAudits || []).slice().sort((a, b) => a.date < b.date ? 1 : -1), cur = R.byId(S.eudrAudits || [], f.auditId);
      if (cur) return auditEditor(cur);
      return `<div class="card"><div class="toolbar"><h3 class="eu-grow">Audyty wewnętrzne EUDR</h3>${can("audit.run") ? `<button class="btn primary" type="button" id="au-new">${ic("plus", 15)} Nowy audyt</button>` : ""}</div>
        <div class="tbl-wrap"><table class="tbl" id="eu-audits"><thead><tr><th>Nr</th><th>Data</th><th>Audytor</th><th>Status</th><th class="r">Wynik</th><th class="r">Niezgodności</th><th>Kolejny audyt</th><th></th></tr></thead><tbody>
        ${list.map(a => `<tr><td class="mono">${esc(a.no)}</td><td>${dpl(a.date)}</td><td>${esc(a.auditor)}</td><td><span class="badge ${a.status === "CLOSED" ? "ok" : "warn"}">${a.status === "CLOSED" ? "zakończony" : "w toku"}</span></td><td class="r">${a.score && a.score.pct !== null ? a.score.pct + " %" : "—"}</td><td class="r">${a.score ? a.score.nc : 0}</td><td>${dpl(a.nextDate)}</td>
          <td class="r nowrap"><button class="btn sm" type="button" data-au="${esc(a.id)}">Otwórz</button> ${a.status === "CLOSED" ? `<button class="btn sm ghost" type="button" data-aupdf="${esc(a.id)}">${ic("pdf", 14)} PDF</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">Brak audytów</td></tr>`}</tbody></table></div>
        <div class="card-b"><p class="muted">Wynik procentowy to wewnętrzny wskaźnik dojrzałości systemu należytej staranności — nie jest certyfikatem ani potwierdzeniem zgodności z prawem.</p></div></div>`;
    },
    bind(page) {
      const f = T();
      const n = $("#au-new", page); if (n) n.onclick = async () => { const res = await exec("eudr.audit.save", { date: App.today() }, "Rozpoczęto audyt"); if (res.ok) { f.auditId = res.audit.id; App.render(); } };
      $$("[data-au]", page).forEach(b => b.onclick = () => { f.auditId = b.dataset.au; App.render(); });
      $$("[data-aupdf]", page).forEach(b => b.onclick = () => auditPdf(R.byId(ST().eudrAudits, b.dataset.aupdf)));
      const back = $("#au-back", page); if (back) back.onclick = () => { f.auditId = ""; App.render(); };
      const a = R.byId(ST().eudrAudits || [], f.auditId);
      if (a) bindAudit(page, a);
    }
  };
  function auditEditor(a) {
    const closed = a.status === "CLOSED", ro = closed || !can("audit.run") ? "disabled" : "", hints = closed ? a.hints || {} : E.auditHints(ST(), ctx());
    const docs = (ST().eudrDocs || []).filter(d => d.status !== "ARCHIVED");
    return `<div class="card"><div class="toolbar"><button class="btn ghost" type="button" id="au-back">← Lista audytów</button><h3 class="eu-grow">${esc(a.no)} · ${dpl(a.date)} · ${closed ? "zakończony" : "w toku"}</h3>${closed ? `<button class="btn" type="button" id="au-pdf">${ic("pdf", 15)} Raport PDF</button>` : ""}</div>
      <div class="card-b"><div class="eu-grid2">${fld("au-auditor", "Audytor", inp("au-auditor", a.auditor, ro))}${fld("au-scope", "Zakres", inp("au-scope", a.scope, ro))}</div>
      <div class="eu-kpis eu-kpis-sm">${[["Wynik (wskaźnik wewnętrzny)", a.score && a.score.pct !== null ? a.score.pct + " %" : "—"], ["Spełnione", a.score ? a.score.ok : 0], ["Częściowo", a.score ? a.score.partial : 0], ["Niezgodności", a.score ? a.score.nc : 0], ["Nieocenione", a.score ? a.score.todo : 13]].map(([k, v]) => `<div class="kpi"><div class="k-t">${esc(k)}</div><div class="k-v">${esc(String(v))}</div></div>`).join("")}</div>
      ${E.AUDIT_AREAS.map((ar, i) => { const x = (a.areas || []).find(y => y.key === ar.key) || {}; return `<details class="eu-area" ${x.status === "NC" || x.status === "PARTIAL" || !x.status || x.status === "TODO" ? "open" : ""}><summary><b>${i + 1}. ${esc(ar.label)}</b> <span class="badge eu-au-${esc(x.status || "TODO")}">${esc(E.AUDIT_STATUS[x.status || "TODO"])}</span></summary>
        <p class="muted"><b>Wymaganie:</b> ${esc(ar.req)}</p><p class="muted"><b>Dane z programu (podpowiedź):</b> ${esc(hints[ar.key] || "—")}</p>
        <div class="eu-grid2">${fld("au-st-" + ar.key, "Status", sel("au-st-" + ar.key, Object.entries(E.AUDIT_STATUS), x.status || "TODO", ro))}${fld("au-person-" + ar.key, "Osoba odpowiedzialna", inp("au-person-" + ar.key, x.person, ro))}
        ${fld("au-res-" + ar.key, "Wynik", area("au-res-" + ar.key, x.result, 2, ro))}${fld("au-gaps-" + ar.key, "Braki", area("au-gaps-" + ar.key, x.gaps, 2, ro))}
        ${fld("au-recs-" + ar.key, "Zalecenia", area("au-recs-" + ar.key, x.recs, 2, ro))}${fld("au-due-" + ar.key, "Termin", inp("au-due-" + ar.key, x.due, 'type="date" ' + ro))}</div>
        ${fld("au-docs-" + ar.key, "Załączniki (dokumenty EUDR)", `<select class="ctrl" id="au-docs-${ar.key}" multiple size="3" ${ro}>${docs.map(d => `<option value="${esc(d.id)}" ${(x.docIds || []).includes(d.id) ? "selected" : ""}>${esc(`${d.no} · ${E.DOC_TYPES[d.type]}`)}</option>`).join("")}</select>`)}</details>`; }).join("")}
      ${fld("au-sum", "Podsumowanie", area("au-sum", a.summary, 3, ro))}${fld("au-next", "Termin kolejnego audytu", inp("au-next", a.nextDate || Dates.addMonths(App.today().slice(0, 7), (E.rules(ST()) && (ST().config.eudr || {}).nextAuditMonths) || 12) + "-01", 'type="date" ' + ro))}
      <div class="msg hidden" id="au-msg"></div>
      ${!ro ? `<div class="eu-row"><button class="btn" type="button" id="au-save">Zapisz</button><button class="btn primary" type="button" id="au-close">${ic("check", 15)} Zakończ audyt</button></div>` : ""}
      <p class="muted mt4">Wynik procentowy nie jest certyfikatem zgodności z prawem.</p></div></div>`;
  }
  function bindAudit(page, a) {
    const pdf = $("#au-pdf", page); if (pdf) pdf.onclick = () => auditPdf(a);
    const collect = close => ({ id: a.id, close, auditor: gv(page, "au-auditor"), scope: gv(page, "au-scope"), summary: gv(page, "au-sum"), nextDate: gv(page, "au-next"),
      areas: E.AUDIT_AREAS.map(ar => ({ key: ar.key, status: gv(page, "au-st-" + ar.key), person: gv(page, "au-person-" + ar.key), result: gv(page, "au-res-" + ar.key), gaps: gv(page, "au-gaps-" + ar.key), recs: gv(page, "au-recs-" + ar.key), due: gv(page, "au-due-" + ar.key), docIds: [...$("#au-docs-" + ar.key, page).selectedOptions].map(o => o.value) })) });
    const go = async close => { const res = await Store.exec("eudr.audit.save", collect(close), SRC); if (!res.ok) { const g = $("#au-msg", page); g.className = "msg err"; g.textContent = [res.error, res.errors ? Object.values(res.errors).join("; ") : ""].filter(Boolean).join(" — "); return; } Toast.ok(close ? "Audyt zakończony" : "Zapisano"); App.render(); };
    const s = $("#au-save", page); if (s) s.onclick = () => go(false);
    const c = $("#au-close", page); if (c) c.onclick = async () => { const r = await Modal.confirm({ title: "Zakończyć audyt?", text: "Po zakończeniu wyników nie można zmienić (kolejny audyt tworzy się jako nowy).", ok: "Zakończ" }); if (r.ok) go(true); };
  }
  function auditPdf(a) {
    const nc = (a.areas || []).filter(x => x.status === "NC" || x.status === "PARTIAL"), S = ST();
    const missingDocs = E.visibleLots(S, me()).filter(l => l.status !== "ARCHIVED").map(l => [l.no, E.evaluate(S, l, ctx()).missing.filter(m => /^Dokument|Geolokalizacja/.test(m))]).filter(([, m]) => m.length);
    const model = { title: "Raport z audytu wewnętrznego EUDR", subtitle: `${a.no} · ${dpl(a.date)}`, orientation: "portrait", rangeText: dpl(a.date), whText: "",
      meta: [["Audytor", a.auditor], ["Zakres", a.scope || "—"], ["Reguły", a.rulesVersion || ""], ["Kolejny audyt", dpl(a.nextDate)]],
      blocks: [{ type: "kpis", items: [["Wynik ogólny (wskaźnik wewnętrzny)", a.score.pct !== null ? a.score.pct + " %" : "—", ""], ["Spełnione", String(a.score.ok), ""], ["Częściowo", String(a.score.partial), ""], ["Niezgodności", String(a.score.nc), ""]] },
        { type: "p", text: "Wynik procentowy jest wewnętrznym wskaźnikiem — nie jest certyfikatem ani potwierdzeniem zgodności z prawem.", muted: true },
        { type: "h", text: "Obszary audytu" },
        { type: "table", columns: [{ label: "Obszar", w: 2.4 }, { label: "Status", w: 1 }, { label: "Wynik", w: 2.4 }, { label: "Osoba", w: 1.2 }, { label: "Termin", w: 1 }], rows: E.AUDIT_AREAS.map((ar, i) => { const x = (a.areas || []).find(y => y.key === ar.key) || {}; return [`${i + 1}. ${ar.label}`, E.AUDIT_STATUS[x.status || "TODO"], x.result || "", x.person || "", x.due ? dpl(x.due) : ""]; }) },
        { type: "h", text: "Niezgodności i zalecenia" },
        { type: "table", columns: [{ label: "Obszar", w: 2 }, { label: "Braki", w: 2.6 }, { label: "Zalecenia", w: 2.6 }, { label: "Termin", w: 1 }], rows: nc.map(x => [(E.AUDIT_AREAS.find(y => y.key === x.key) || {}).label || x.key, x.gaps || "", x.recs || "", x.due ? dpl(x.due) : ""]), empty: "Brak niezgodności." },
        { type: "h", text: "Brakująca dokumentacja (stan na dzień wydruku)" },
        { type: "table", columns: [{ label: "Partia", w: 1.2 }, { label: "Braki", w: 5 }], rows: missingDocs.map(([no, m]) => [no, m.join("; ")]), empty: "Brak braków dokumentacji." },
        a.summary ? { type: "p", text: a.summary } : { type: "space", h: 2 },
        { type: "signatures", labels: ["Audytor", "Osoba odpowiedzialna"] }] };
    UI.Printer.pdf(model, "RAP", `audyt_EUDR_${a.no.replace(/\//g, "-")}`);
  }
  TABS.training = {
    html() {
      const S = ST(), mine = (S.eudrTraining || []).filter(x => x.userId === me().id), C = E.content(), f = T();
      const cur = R.byId(S.eudrTraining || [], f.trId);
      if (cur) return trainingView(cur);
      const row = x => { const m = E.moduleOf(x.moduleKey) || {}; return `<tr><td>${esc(x.userName)}</td><td>${esc(m.title || x.moduleKey)}</td><td><div class="eu-bar"><span style="width:${x.progress || 0}%"></span></div><small>${x.progress || 0} %</small></td><td>${x.score !== undefined ? x.score + " %" : "—"}</td><td>${x.passed ? `<span class="badge ok">zaliczony</span>` : `<span class="badge warn">w toku</span>`}</td><td>${dpl(x.due)}</td><td>${esc(x.trainer || "")}</td><td>${x.confirmedAt ? `${dpl(x.confirmedAt.slice(0, 10))}<br><small class="mono">${esc(x.certNo)}</small>` : "—"}</td>
        <td class="r nowrap">${x.userId === me().id ? `<button class="btn sm primary" type="button" data-tr="${esc(x.id)}">Otwórz</button>` : ""}${can("train.manage") && x.passed && !x.confirmedAt ? ` <button class="btn sm" type="button" data-trc="${esc(x.id)}">Potwierdź</button>` : ""}${x.confirmedAt ? ` <button class="btn sm ghost" type="button" data-trpdf="${esc(x.id)}">${ic("pdf", 14)}</button>` : ""}</td></tr>`; };
      const head = `<thead><tr><th>Pracownik</th><th>Moduł</th><th>Postęp</th><th>Test</th><th>Wynik</th><th>Termin</th><th>Prowadzący</th><th>Potwierdzenie</th><th></th></tr></thead>`;
      return `<div class="card"><div class="card-h"><h3>Moje szkolenia</h3></div><div class="tbl-wrap"><table class="tbl" id="eu-mytr">${head}<tbody>${mine.map(row).join("") || `<tr><td colspan="9" class="muted">Brak przydzielonych szkoleń</td></tr>`}</tbody></table></div></div>
        ${can("train.manage") ? `<div class="card mt4"><div class="toolbar"><h3 class="eu-grow">Szkolenia pracowników</h3>${fld("tr-user", "Pracownik", sel("tr-user", S.users.filter(u => u.status !== "BLOCKED").map(u => [u.id, u.name])))}${fld("tr-mod", "Moduł", sel("tr-mod", C.modules.map(m => [m.key, m.title])))}${fld("tr-due", "Termin", inp("tr-due", "", 'type="date"'))}<button class="btn primary" type="button" id="tr-assign">${ic("plus", 15)} Przydziel</button></div>
          <div class="tbl-wrap"><table class="tbl" id="eu-alltr">${head}<tbody>${(S.eudrTraining || []).map(row).join("") || `<tr><td colspan="9" class="muted">Brak</td></tr>`}</tbody></table></div></div>` : ""}
        <div class="card mt4"><div class="card-b"><b>Moduły:</b> ${C.modules.map(m => esc(m.title)).join(" · ")}<p class="muted">Potwierdzenie ukończenia jest dokumentem wewnętrznym firmy — nie jest oficjalnym certyfikatem Komisji Europejskiej.</p></div></div>`;
    },
    bind(page) {
      const f = T();
      $$("[data-tr]", page).forEach(b => b.onclick = () => { f.trId = b.dataset.tr; App.render(); });
      $$("[data-trc]", page).forEach(b => b.onclick = async () => { if ((await exec("eudr.train.confirm", { id: b.dataset.trc }, "Potwierdzono ukończenie")).ok) App.render(); });
      $$("[data-trpdf]", page).forEach(b => b.onclick = () => trainPdf(R.byId(ST().eudrTraining, b.dataset.trpdf)));
      const a = $("#tr-assign", page); if (a) a.onclick = async () => { if ((await exec("eudr.train.assign", { userId: gv(page, "tr-user"), moduleKey: gv(page, "tr-mod"), due: gv(page, "tr-due") }, "Przydzielono szkolenie")).ok) App.render(); };
      const back = $("#tr-back", page); if (back) back.onclick = () => { f.trId = ""; App.render(); };
      const x = R.byId(ST().eudrTraining || [], f.trId); if (x) bindTraining(page, x);
    }
  };
  function trainingView(x) {
    const m = E.moduleOf(x.moduleKey), C = E.content(), allLessons = x.lessons.length >= m.lessons.length;
    return `<div class="card"><div class="toolbar"><button class="btn ghost" type="button" id="tr-back">← Szkolenia</button><h3 class="eu-grow">${esc(m.title)}</h3><span>${x.progress || 0} %</span></div><div class="card-b">
      ${m.lessons.map((l, i) => `<details class="eu-lesson" ${x.lessons.includes(i) ? "" : "open"}><summary>${x.lessons.includes(i) ? `<span class="pos">✓</span>` : `<span class="eu-sn">${i + 1}</span>`} <b>${esc(l.title)}</b></summary>${l.body.map(p => `<p>${esc(p)}</p>`).join("")}${!x.lessons.includes(i) ? `<button class="btn sm" type="button" data-les="${i}">Oznacz jako przeczytane</button>` : ""}</details>`).join("")}
      ${x.moduleKey === "practice" ? `<h4 class="eu-h mt4">Ćwiczenia — dane fikcyjne (wyniki nie trafiają do rejestru DDS)</h4>${C.scenarios.map(s => { const done = (x.exercises || []).filter(e => e.scenario === s.key).slice(-1)[0]; return `<div class="eu-scn" data-scn="${esc(s.key)}"><b>${esc(s.title)}</b><p>${esc(s.story)}</p><div class="eu-kv">${s.data.map(([k, v]) => `<div><small>${esc(k)}</small><div>${esc(v)}</div></div>`).join("")}</div>
        <div class="eu-grid2">${s.checks.map(c => fld(`sc-${s.key}-${c.key}`, c.label, sel(`sc-${s.key}-${c.key}`, [["", "— wybierz —"]].concat(c.options)))).join("")}</div><button class="btn sm" type="button" data-scnrun="${esc(s.key)}">Sprawdź</button>
        ${done ? `<p class="${done.ok ? "pos" : "neg"}">${done.ok ? "Poprawnie" : "Błędy"} (${dtpl(done.at)})${done.simRef ? ` · numer symulowany <span class="mono">${esc(done.simRef)}</span> — SYMULACJA, nie jest numerem TRACES` : ""}</p>` : ""}</div>`; }).join("")}` : ""}
      <h4 class="eu-h mt4">Test wiedzy (zaliczenie od ${m.pass} %)</h4>
      ${allLessons ? `<ol class="eu-quiz">${m.quiz.map((q, i) => `<li><b>${esc(q.q)}</b>${q.o.map((o, j) => `<label class="inline-opt"><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label>`).join("")}</li>`).join("")}</ol><button class="btn primary" type="button" id="tr-quiz">Wyślij odpowiedzi</button>` : `<p class="muted">Test będzie dostępny po przeczytaniu wszystkich lekcji.</p>`}
      ${(x.attempts || []).length ? `<p class="mt4">Próby: ${x.attempts.map(a => `${a.score} % (${dtpl(a.at)})`).join(" · ")}</p>` : ""}</div></div>`;
  }
  function bindTraining(page, x) {
    $$("[data-les]", page).forEach(b => b.onclick = async () => { if ((await exec("eudr.train.lesson", { id: x.id, lesson: Number(b.dataset.les) })).ok) App.render(); });
    const q = $("#tr-quiz", page); if (q) q.onclick = async () => {
      const m = E.moduleOf(x.moduleKey), answers = m.quiz.map((_, i) => { const c = $(`input[name="q${i}"]:checked`, page); return c ? Number(c.value) : -1; });
      if (answers.includes(-1)) return Toast.warn("Odpowiedz na wszystkie pytania");
      const res = await exec("eudr.train.quiz", { id: x.id, answers });
      if (res.ok) { Toast[res.passed ? "ok" : "warn"](res.passed ? P("Zaliczono — {s} %", { s: res.score }) : P("Nie zaliczono — {s} %", { s: res.score }), res.passed ? "Prowadzący może potwierdzić ukończenie." : P("Błędne pytania: {l}", { l: res.wrong.map(i => i + 1).join(", ") })); App.render(); }
    };
    $$("[data-scnrun]", page).forEach(b => b.onclick = async () => {
      const s = E.content().scenarios.find(y => y.key === b.dataset.scnrun), answers = {};
      for (const c of s.checks) answers[c.key] = gv(page, `sc-${s.key}-${c.key}`);
      const res = await exec("eudr.train.exercise", { id: x.id, scenario: s.key, answers });
      if (res.ok) { Toast[res.passed ? "ok" : "warn"](res.passed ? "Ćwiczenie wykonane poprawnie" : "Ćwiczenie z błędami", res.notice); App.render(); }
    });
  }
  function trainPdf(x) {
    const m = E.moduleOf(x.moduleKey) || {};
    UI.Printer.pdf({ title: "Wewnętrzne potwierdzenie ukończenia szkolenia EUDR", subtitle: x.certNo, orientation: "portrait", rangeText: dpl((x.completedAt || "").slice(0, 10)), whText: "",
      meta: [["Pracownik", x.userName], ["Moduł", m.title || x.moduleKey], ["Wynik testu", `${x.score} %`], ["Data ukończenia", dpl((x.completedAt || "").slice(0, 10))], ["Prowadzący", x.trainer], ["Potwierdził", `${x.confirmedBy} · ${dpl(x.confirmedAt.slice(0, 10))}`]],
      blocks: [{ type: "p", text: "Dokument wewnętrzny firmy potwierdzający ukończenie szkolenia z zakresu rozporządzenia (UE) 2023/1115 (EUDR). Nie jest oficjalnym certyfikatem Komisji Europejskiej ani potwierdzeniem uprawnień.", muted: true },
        { type: "h", text: "Zakres" }, { type: "table", columns: [{ label: "Lekcja", w: 4 }], rows: (m.lessons || []).map(l => [l.title]) },
        { type: "signatures", labels: ["Pracownik", "Prowadzący"] }] }, "RAP", `szkolenie_EUDR_${x.certNo.replace(/\//g, "-")}`);
  }
  function guideBody(g) {
    return `<p><b>Cel:</b> ${esc(g.goal)}</p><div class="eu-flow" aria-label="Schemat">${g.figure.map(s => `<span class="eu-fbox">${esc(s)}</span>`).join(`<span class="eu-arrow" aria-hidden="true">→</span>`)}</div>
      <p><b>Kroki:</b></p><ol>${g.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol><p><b>Przykład (dane fikcyjne):</b> ${esc(g.example)}</p><p><b>Najczęstsze błędy:</b></p><ul>${g.mistakes.map(s => `<li>${esc(s)}</li>`).join("")}</ul>`;
  }
  TABS.guides = {
    html() { return `<div class="card"><div class="card-b"><p class="muted">Instrukcje mają charakter szkoleniowy (stan prawny: rozporządzenie (UE) 2023/1115 zmienione rozporządzeniem (UE) 2025/2650) i nie są poradą prawną.</p></div></div>${E.content().guides.map(g => `<details class="card mt4 eu-guide" id="g-${esc(g.key)}"><summary class="card-h"><h3>${esc(g.title)}</h3></summary><div class="card-b">${guideBody(g)}</div></details>`).join("")}`; },
    bind() {}
  };
  /* ---------------- Raporty ---------------- */
  const inRange = (d, f) => (!f.repFrom || (d || "") >= f.repFrom) && (!f.repTo || (d || "") <= f.repTo);
  function reportData(key) {
    const S = ST(), f = T(), L = E.visibleLots(S, me()).filter(l => inRange(l.receivedDate || (l.createdAt || "").slice(0, 10), f));
    const lotRow = l => { const ev = E.evaluate(S, l, ctx()); return [l.no, (l.wood || {}).species || "", (l.wood || {}).speciesLatin || "", (l.wood || {}).cn || "", fq(l.qty), fq(E.balance(l)), unitOf(l), partnerName(l.partnerId), whName(l.whId), l.receipt ? l.receipt.opNo : "", E.LOT_STATUS[l.status], E.COLORS[ev.color]]; };
    const lotCols = ["Nr partii", "Gatunek", "Nazwa łacińska", "CN", "Ilość", "Saldo", "J.m.", "Dostawca", "Magazyn", "PZ", "Status", "Ocena"];
    switch (key) {
      case "lots": return { title: "Rejestr partii drewna", cols: lotCols, rows: L.map(lotRow) };
      case "suppliers": { const ids = [...new Set(L.map(l => l.partnerId).concat((S.eudrSuppliers || []).map(s => s.partnerId)))].filter(Boolean); return { title: "Rejestr dostawców EUDR", cols: ["Dostawca", "Rola EUDR", "Kraj", "NIP", "Adres", "E-mail", "Weryfikacja", "Ważna do", "Partie"], rows: ids.map(id => { const p = R.byId(S.partners, id) || {}, s = E.supplierOf(S, id) || {}; return [p.name || id, E.SUPPLIER_ROLES[s.role] || "", s.country || "", s.nip || p.nip || "", s.address || p.address || "", s.email || p.email || "", E.SUPPLIER_STATUS[s.status || "UNVERIFIED"], s.validTo || "", String(L.filter(l => l.partnerId === id).length)]; }) }; }
      case "origin": return { title: "Dokumentacja pochodzenia", cols: ["Partia", "Właściciel", "Działka", "Kraj", "Ryzyko kraju", "GPS", "Polygon", "ha", "Okres pozyskania", "Dokumenty"], rows: L.map(l => { const o = l.origin || {}, w = l.wood || {}; return [l.no, o.owner || "", o.plot || "", o.country || "", E.RISK_COUNTRY[o.riskCountry] || "", Number.isFinite(o.lat) ? `${o.lat}, ${o.lon}` : "", o.geojson ? "tak" : "nie", o.areaHa ? fq(o.areaHa) : "", `${w.harvestFrom || ""} – ${w.harvestTo || ""}`, E.docsOfLot(S, l.id).map(d => E.DOC_TYPES[d.type]).join("; ")]; }) };
      case "dds": return { title: P("Rejestr DDS — {e}", { e: E.envOf(S) }), cols: ["Nr", "Środowisko", "Rodzaj", "Numer referencyjny", "Numer weryfikacyjny", "Data", "Status", "Dostawca", "Partie", "Odpowiedzialny"], rows: (S.eudrDds || []).filter(d => d.env === E.envOf(S) && inRange(d.date || (d.createdAt || "").slice(0, 10), f)).map(d => [d.no, d.env, E.DDS_KINDS[d.kind], d.referenceNumber || "", d.verificationNumber || "", d.date || "", E.DDS_STATUS[d.status], partnerName(d.partnerId), (d.lotIds || []).map(id => (lotOf(id) || {}).no).join(", "), d.responsible || ""]) };
      case "incomplete": return { title: "Partie niekompletne", cols: ["Nr partii", "Gatunek", "Dostawca", "Status", "Braki", "Blokady"], rows: L.filter(l => l.status !== "ARCHIVED").map(l => [l, E.evaluate(S, l, ctx())]).filter(([, e]) => e.missing.length || e.blocks.length).map(([l, e]) => [l.no, (l.wood || {}).species || "", partnerName(l.partnerId), E.LOT_STATUS[l.status], e.missing.join("; "), e.blocks.join("; ")]) };
      case "dd": return { title: "Należyta staranność", cols: ["Partia", "Rola", "Etap 1", "Etap 2 / wynik", "Etap 3", "Decyzja", "Zatwierdził", "Data"], rows: L.map(l => { const d = l.dd || {}, a = d.approval || {}; return [l.no, E.obligations(S, l, ctx()).role, d.s1 && d.s1.done ? "zakończony" : d.s1 ? "w toku" : "—", d.s2 ? `${d.s2.done ? "zakończony" : "w toku"} ${d.s2.result || ""}` : "—", d.s3 ? "tak" : "—", a.result === "ACCEPTED" ? "dopuszczona" : a.result === "REJECTED" ? "niezgodna" : d.inherited ? "przejęty" : "—", a.by || "", a.at ? a.at.slice(0, 10) : ""]; }) };
      case "audit": return { title: "Audyty EUDR", cols: ["Nr", "Data", "Audytor", "Status", "Wynik % (wskaźnik)", "Niezgodności", "Kolejny audyt"], rows: (S.eudrAudits || []).filter(a => inRange(a.date, f)).map(a => [a.no, a.date, a.auditor, a.status === "CLOSED" ? "zakończony" : "w toku", a.score && a.score.pct !== null ? String(a.score.pct) : "", String(a.score ? a.score.nc : 0), a.nextDate || ""]) };
      case "history": return { title: "Historia zmian EUDR", cols: ["Kiedy", "Użytkownik", "Czynność", "Obiekt", "Przed", "Po"], rows: (S.audit || []).filter(a => a.entity === "eudr" && inRange(String(a.ts).slice(0, 10), f)).slice().reverse().map(a => [dtpl(a.ts), a.userName, a.action || "", a.opNo || "", showVal(a.before), showVal(a.after)]) };
      case "training": return { title: "Szkolenia EUDR", cols: ["Pracownik", "Moduł", "Postęp %", "Wynik %", "Zaliczony", "Termin", "Prowadzący", "Potwierdzenie", "Data"], rows: (S.eudrTraining || []).map(x => [x.userName, (E.moduleOf(x.moduleKey) || {}).title || x.moduleKey, String(x.progress || 0), x.score !== undefined ? String(x.score) : "", x.passed ? "tak" : "nie", x.due || "", x.trainer || "", x.certNo || "", x.confirmedAt ? x.confirmedAt.slice(0, 10) : ""]) };
    }
    return null;
  }
  const REPORTS = [["lots", "Rejestr partii"], ["suppliers", "Rejestr dostawców"], ["origin", "Dokumentacja pochodzenia"], ["dds", "Rejestr DDS"], ["incomplete", "Partie niekompletne"], ["dd", "Należyta staranność"], ["audit", "Audyt"], ["history", "Historia zmian"], ["training", "Szkolenia"]];
  TABS.reports = {
    html() {
      const f = T();
      return `<div class="card"><div class="toolbar">${fld("rp-from", "Od", inp("rp-from", f.repFrom, 'type="date"'))}${fld("rp-to", "Do", inp("rp-to", f.repTo, 'type="date"'))}<p class="muted">Okres dotyczy daty przyjęcia partii / wpisu.</p></div>
        <div class="tbl-wrap"><table class="tbl" id="eu-reps"><thead><tr><th>Raport</th><th class="r">Wierszy</th><th></th></tr></thead><tbody>${REPORTS.map(([k, l]) => `<tr><td>${esc(l)}</td><td class="r">${reportData(k).rows.length}</td><td class="r nowrap"><button class="btn sm" type="button" data-rpdf="${k}">${ic("pdf", 14)} PDF</button> <button class="btn sm" type="button" data-rxlsx="${k}">${ic("dl", 14)} Excel</button></td></tr>`).join("")}</tbody></table></div></div>`;
    },
    bind(page) {
      const f = T();
      $("#rp-from", page).onchange = e => { f.repFrom = e.target.value; App.render(); };
      $("#rp-to", page).onchange = e => { f.repTo = e.target.value; App.render(); };
      const range = () => [f.repFrom && dpl(f.repFrom), f.repTo && dpl(f.repTo)].filter(Boolean).join(" – ") || "cały okres";
      $$("[data-rpdf]", page).forEach(b => b.onclick = () => { const d = reportData(b.dataset.rpdf); UI.Printer.pdf({ title: d.title, subtitle: `${range()} · ${E.envOf(ST())}`, orientation: "landscape", rangeText: range(), whText: "",
        meta: [["Okres", range()], ["Środowisko", E.envOf(ST())], ["Reguły", E.rules(ST()).version]],
        blocks: [{ type: "table", columns: d.cols.map(c => ({ label: c, w: 1 })), rows: d.rows, empty: "Brak danych", size: 6.8 }, { type: "p", text: "Raport z ResInvest ERP — moduł EUDR. Nie stanowi potwierdzenia zgodności z prawem.", muted: true }] }, "RAP", `EUDR_${b.dataset.rpdf}_${App.today()}`); });
      $$("[data-rxlsx]", page).forEach(b => b.onclick = () => { const d = reportData(b.dataset.rxlsx); UI.xlsxTable(`EUDR_${b.dataset.rxlsx}_${App.today()}`, d.title, d.cols, d.rows, range()); });
    }
  };
  TABS.history = {
    html() {
      const f = T(), q = (f.hQ || "").toLowerCase();
      const H = (ST().audit || []).filter(a => a.entity === "eudr" && (!f.hFrom || String(a.ts).slice(0, 10) >= f.hFrom) && (!f.hTo || String(a.ts).slice(0, 10) <= f.hTo) && (!q || [a.userName, a.action, a.opNo, showVal(a.after), showVal(a.before)].join(" ").toLowerCase().includes(q))).slice().reverse();
      return `<div class="card"><div class="toolbar">${fld("hf", "Od", inp("hf", f.hFrom, 'type="date"'))}${fld("ht", "Do", inp("ht", f.hTo, 'type="date"'))}<div class="field"><label for="hq">Szukaj</label><input class="ctrl" id="hq" value="${esc(f.hQ || "")}"></div><button class="btn" type="button" id="h-xlsx">${ic("dl", 15)} Excel</button></div>
        <div class="card-b"><p class="muted">Dziennik zmian modułu EUDR jest częścią dziennika audytu programu — wpisów nie można usuwać ani zmieniać.</p></div>${historyTable(H)}</div>`;
    },
    bind(page) {
      const f = T();
      $("#hf", page).onchange = e => { f.hFrom = e.target.value; App.render(); };
      $("#ht", page).onchange = e => { f.hTo = e.target.value; App.render(); };
      const q = $("#hq", page); q.oninput = () => { f.hQ = q.value; clearTimeout(f._t); f._t = setTimeout(() => { App.render(); const x = $("#hq"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 250); };
      $("#h-xlsx", page).onclick = () => { const d = reportData("history"); UI.xlsxTable(`EUDR_historia_${App.today()}`, d.title, d.cols, d.rows, ""); };
    }
  };
  TABS.admin = {
    html() {
      const S = ST(), c = S.config.eudr || {}, p = E.profile(S), env = E.envOf(S), isAdm = can("config");
      const ro = isAdm ? "" : "disabled";
      return `<div class="card"><div class="card-h"><h3>Tryb pracy</h3></div><div class="card-b">${envBanner()}
          <p class="mt4">Aktywne środowisko: <b>${esc(env)}</b>${c.envChangedAt ? ` · zmiana: ${esc(c.envChangedBy || "")} ${dtpl(c.envChangedAt)}` : ""}</p>
          ${can("env") ? `<button class="btn ${env === "PRODUCTION" ? "" : "danger"}" type="button" id="env-switch">${env === "PRODUCTION" ? "Przełącz na ACCEPTANCE (test)" : "Przełącz na PRODUCTION"}</button>` : `<p class="muted">Tryb zmienia Administrator EUDR.</p>`}
          <p class="muted mt4">Dane ACCEPTANCE i PRODUCTION są rozdzielone; numery testowe i symulowane nie są przenoszone do ewidencji produkcyjnej.</p></div></div>
        <div class="card mt4"><div class="card-h"><h3>Profil firmy</h3></div><div class="card-b eu-grid2">
          ${fld("ad-co", "Nazwa firmy", inp("ad-co", p.company, ro))}${fld("ad-cc", "Kraj (ISO)", inp("ad-cc", p.country, 'maxlength="2" ' + ro))}
          ${fld("ad-size", "Wielkość przedsiębiorstwa", sel("ad-size", [["large", "Duże"], ["medium", "Średnie"], ["small", "Małe"], ["micro", "Mikro"]], (c.profile || {}).size || "", ro))}${fld("ad-resp", "Osoba odpowiedzialna", inp("ad-resp", p.responsible, ro))}
          ${fld("ad-op", "Numer operatora w systemie EUDR", inp("ad-op", p.operatorRef, ro))}${fld("ad-eori", "EORI", inp("ad-eori", p.eori, ro))}
          <label class="inline-opt"><input type="checkbox" id="ad-eutr" ${p.eutrBefore ? "checked" : ""} ${ro}> Mikro / małe przedsiębiorstwo objęte wcześniej EUTR (stosowanie od 30.12.2026)</label>
          ${fld("ad-rel", "Brak własnego DDS przy wydaniu partii operatora", sel("ad-rel", [["block", "Blokuj (po dacie stosowania)"], ["warn", "Tylko ostrzegaj"]], c.releaseMode || E.RULES.releaseMode, ro))}
          ${fld("ad-aud", "Audyt co (miesięcy)", inp("ad-aud", c.nextAuditMonths || 12, 'inputmode="numeric" ' + ro))}
          <p class="wide">Obowiązki stosuje się od: <b>${esc(dpl(E.applyDate(S)))}</b></p></div></div>
        <div class="card mt4"><div class="card-h"><h3>Produkty i kody CN</h3></div><div class="tbl-wrap"><table class="tbl" id="ad-prods"><thead><tr><th>Produkt</th><th>Kod CN</th><th>Załącznik I</th></tr></thead><tbody>${S.products.map(pr => `<tr><td>${esc(pr.name)}</td><td><input class="ctrl" data-cn="${esc(pr.id)}" value="${esc(p.products[pr.id] || "")}" inputmode="numeric" ${ro}></td><td>${E.inAnnex(S, p.products[pr.id]) ? `<span class="badge ok">objęty</span>` : `<span class="badge">nie</span>`}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="card mt4"><div class="card-h"><h3>Reguły prawne (wersjonowane)</h3></div><div class="card-b"><p>Obowiązujące: <b>${esc(E.rules(S).version)}</b> — ${esc(E.rules(S).source)}</p>
          <p class="muted">Zmianę przepisów wprowadza się tutaj (JSON: version, dates, cutOff, retentionYears, cn, geoAreaHa, docs, releaseMode) — bez przebudowy programu. Puste pole = reguły wbudowane.</p>
          ${area("ad-rules", c.rules ? JSON.stringify(c.rules, null, 1) : "", 6, 'spellcheck="false" class="ctrl mono" ' + ro)}
          <details class="mt4"><summary>Reguły wbudowane</summary><pre class="eu-pre">${esc(JSON.stringify(E.RULES, null, 1))}</pre></details></div></div>
        ${isAdm ? `<div class="eu-row mt4"><button class="btn primary" type="button" id="ad-save">Zapisz konfigurację</button></div>` : ""}
        <div class="card mt4"><div class="card-h"><h3>Role EUDR użytkowników</h3></div><div class="tbl-wrap"><table class="tbl" id="ad-roles"><thead><tr><th>Użytkownik</th><th>Rola w programie</th><th>Rola EUDR</th></tr></thead><tbody>
          ${S.users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(App.roleLabel(u.role))}</td><td>${u.role === "admin" || !isAdm ? esc(E.ROLES[E.roleOf(S, u)]) : sel("rl-" + u.id, [["", P("domyślna ({r})", { r: E.ROLES[({ kierownik: "responsible", magazynier: "warehouse", audytor: "controller", obserwator: "viewer" })[u.role] || "viewer"] })]].concat(Object.entries(E.ROLES)), (c.access || {})[u.id] || "", `data-role="${esc(u.id)}"`)}</td></tr>`).join("")}</tbody></table></div>
          <div class="card-b"><p class="muted">Uprawnienia: Administrator EUDR — wszystko, w tym tryb i konfiguracja; Osoba odpowiedzialna — partie, DDS, zatwierdzanie należytej staranności, szkolenia; Magazynier — partie z przyjęć, powiązania, dokumenty; Kontroler dokumentacji — sprawdzanie dokumentów, etapy należytej staranności, audyt; Podgląd — odczyt i raporty.</p></div></div>`;
    },
    bind(page) {
      const sw = $("#env-switch", page);
      if (sw) sw.onclick = async () => {
        const toProd = E.envOf(ST()) !== "PRODUCTION";
        const r = toProd ? await Modal.confirm({ title: "Przełączenie na PRODUCTION", text: "Operacje w trybie produkcyjnym mogą wywoływać skutki prawne. Aby potwierdzić, wpisz PRODUKCJA.", ok: "Przełącz", danger: true, input: { label: "Potwierdzenie", required: true } })
          : await Modal.confirm({ title: "Przełączenie na ACCEPTANCE", text: "Środowisko testowe — dane nie mają mocy prawnej.", ok: "Przełącz" });
        if (r.ok && (await exec("eudr.env.set", { env: toProd ? "PRODUCTION" : "ACCEPTANCE", confirm: toProd ? r.value : true }, "Zmieniono tryb")).ok) App.render();
      };
      const s = $("#ad-save", page);
      if (s) s.onclick = async () => {
        const products = {}; $$("[data-cn]", page).forEach(i => { products[i.dataset.cn] = i.value; });
        const res = await exec("eudr.config.save", { profile: { company: gv(page, "ad-co"), country: gv(page, "ad-cc"), size: gv(page, "ad-size"), responsible: gv(page, "ad-resp"), operatorRef: gv(page, "ad-op"), eori: gv(page, "ad-eori"), eutrBefore: gv(page, "ad-eutr") },
          releaseMode: gv(page, "ad-rel"), nextAuditMonths: gv(page, "ad-aud"), products, rules: gv(page, "ad-rules") }, "Zapisano konfigurację EUDR");
        if (res.ok) App.render();
      };
      $$("[data-role]", page).forEach(x => x.onchange = async () => { if ((await exec("eudr.access.set", { userId: x.dataset.role, role: x.value || null }, "Zmieniono rolę EUDR")).ok) App.render(); });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Ekran modułu                                                        */
  /* ------------------------------------------------------------------ */
  Views.eudr = {
    html(params) {
      const f = T();
      if (params && params.tab && TABS[params.tab]) f.tab = params.tab;
      if (!can("view")) return `<div class="info-line err">${ic("lock", 15)}<span>Brak dostępu do modułu EUDR — rolę nadaje Administrator EUDR.</span></div>`;
      const visible = MENU.filter(([k]) => k !== "admin" || can("config") || can("env") || E.roleOf(ST(), me()) === "responsible");
      if (!visible.some(([k]) => k === f.tab)) f.tab = "dash";
      return `<div class="page-head"><div class="titles"><h2>EUDR — drewno surowe</h2><p>Rozporządzenie (UE) 2023/1115 zmienione rozporządzeniem (UE) 2025/2650 · partie, pochodzenie, należyta staranność, DDS i system EUDR (TRACES). Rola: ${esc(E.ROLES[E.roleOf(ST(), me())])}</p></div></div>
        ${envBanner()}
        <nav class="eu-menu" id="eu-menu" aria-label="Menu modułu EUDR">${visible.map(([k, l, i]) => `<button type="button" data-eutab="${k}" aria-pressed="${f.tab === k}">${ic(i, 15)} ${esc(l)}</button>`).join("")}</nav>
        <div class="eu-body mt4" id="eu-body" data-tab="${esc(f.tab)}">${TABS[f.tab].html()}</div>`;
    },
    bind(page) {
      if (!can("view")) return;
      $$("[data-eutab]", page).forEach(b => b.onclick = () => { const f = T(); f.tab = b.dataset.eutab; f.auditId = ""; f.trId = ""; if (location.hash.includes("?")) location.hash = "#/eudr"; else App.render(); });
      $$("[data-lot]", page).forEach(a => { if (!a.onclick) a.onclick = e => { e.preventDefault(); lotCard(a.dataset.lot); }; });
      TABS[T().tab].bind(page);
    }
  };
  UI.Eudr = { lotCard, lotDialog, receiptsDialog, Files, reportData, runTests };
})(typeof globalThis !== "undefined" ? globalThis : this);
