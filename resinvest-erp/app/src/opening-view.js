/* =========================================================================
   ResInvest ERP 3.15 — Stany początkowe magazynów (ekran)

   Edytor dla administratora przy przenoszeniu danych do programu: magazyn (RiC Zabrze, RiC Brąszewice,
   RiC Rokitki i inne aktywne), data stanu, tabela produktów: stan początkowy (suma dokumentów BO),
   stan bieżący, nowa wartość i różnica. Zapis → komenda „stock.opening” (silnik: R.Opening):
   dokument „Bilans otwarcia” z samymi różnicami, wcześniejsze dokumenty BO zostają w historii.
   Tylko odczyt dla osób bez uprawnienia „Magazyny — dodawanie i edycja”.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, N_, esc, $, $$, ic, Toast, Modal, Store, App, Views } = UI;
  const { fmtQ, Dates, Units, NumParse, EPS } = R;
  const O = R.Opening;
  const th = s => esc(t(s));
  const SRC = N_("Stany początkowe magazynów");

  /** Stan formularza między odświeżeniami: magazyn, data, wpisane (niezapisane) wartości. */
  const form = () => App.tabs.opening || (App.tabs.opening = { whId: "", date: "", values: {} });
  const parse = v => { const n = NumParse.parse(v); return n.ok ? R.rq(n.value) : null; };

  Views.stanypoczatkowe = {
    html() {
      const S = Store.state, f = form(), edit = App.can("warehouses.edit");
      const whs = S.warehouses.filter(w => w.active !== false && R.canAccessWh(App.user(), w.id));
      if (!whs.some(w => w.id === f.whId)) { f.whId = (whs[0] || {}).id || ""; f.values = {}; }
      if (!f.date) f.date = App.today();
      const wh = R.byId(S.warehouses, f.whId);
      const rows = wh ? O.sheet(S, wh.id) : [];
      const docs = wh ? O.documents(S, wh.id) : [];
      const empty = wh && !docs.length && !S.operations.some(o => o.whId === wh.id);
      const body = rows.map(r => {
        const typed = f.values[r.productId];
        const next = typed === undefined || typed === "" ? null : parse(typed);
        const delta = next === null ? null : R.rq(next - r.opening);
        return `<tr data-orow="${esc(r.productId)}"><td><b>${esc(r.name)}</b>${r.active ? "" : ` <span class="badge">${th("nieaktywny")}</span>`}<br><small class="dim">${esc(r.code || "")}</small></td>
          <td>${esc(Units.label(r.unit))}</td>
          <td class="r" data-oopen="${esc(r.productId)}">${esc(fmtQ(r.opening))}</td>
          <td class="r dim" data-ocur="${esc(r.productId)}">${esc(fmtQ(r.current))}</td>
          <td class="r">${edit ? `<input class="ctrl num-in r" inputmode="decimal" autocomplete="off" data-oin="${esc(r.productId)}" aria-label="${esc(t("Nowy stan początkowy: {p}", { p: r.name }))}" value="${esc(typed === undefined ? "" : typed)}" placeholder="${esc(fmtQ(r.opening))}">
            <div class="msg hidden" data-omsg="${esc(r.productId)}"></div>` : "—"}</td>
          <td class="r" data-odelta="${esc(r.productId)}">${delta === null || Math.abs(delta) <= EPS ? "" : `<span class="${delta > 0 ? "pos" : "neg"}">${delta > 0 ? "+" : ""}${esc(fmtQ(delta))}</span>`}</td></tr>`;
      }).join("");
      return `<div class="page-head"><div class="titles"><h2>${th("Stany początkowe magazynów")}</h2>
          <p>${th("Stan każdego produktu w magazynie na dzień rozpoczęcia pracy w programie — wpisywany przy przenoszeniu danych. Zapis tworzy dokument „Bilans otwarcia” z różnicami; wcześniejsze dokumenty zostają w historii.")}</p></div>
          <div class="actions"><a class="btn" href="#/stany">${ic("layers", 15)} ${th("Stany magazynowe")}</a></div></div>
        <div class="card"><div class="card-b">
          <div class="row wrap">
            <div class="field"><label for="op-wh">${th("Magazyn")}</label><select class="ctrl" id="op-wh">${whs.map(w => `<option value="${esc(w.id)}" ${w.id === f.whId ? "selected" : ""}>${esc(w.name)}</option>`).join("")}</select></div>
            <div class="field"><label for="op-date">${th("Data stanu początkowego")}</label><input class="ctrl" type="date" id="op-date" value="${esc(f.date)}" max="${esc(App.today())}" ${edit ? "" : "disabled"}><div class="msg hidden" data-omsg="date"></div></div>
          </div>
          ${empty ? `<div class="info-line">${ic("layers", 15)}<span>${th("Ten magazyn nie ma jeszcze stanu ani operacji — wpisz stany z ostatniej inwentaryzacji albo z dotychczasowego systemu.")}</span></div>` : ""}
          ${wh && R.lockedMonth(S, wh.id) ? `<div class="info-line warn">${ic("alert", 15)}<span>${esc(t("Okres zamknięty do {ym} — data stanu początkowego musi być późniejsza.", { ym: R.lockedMonth(S, wh.id) }))}</span></div>` : ""}
          ${edit ? "" : `<div class="info-line">${ic("shield", 15)}<span>${th("Podgląd — stany początkowe wpisuje administrator.")}</span></div>`}
        </div></div>
        <div class="card mt4"><div class="card-h"><h3>${esc(wh ? wh.name : t("Brak magazynu"))}</h3><span class="sub">${th("ilości w jednostce magazynowej produktu")}</span></div>
          ${rows.length ? `<div class="tbl-wrap"><table class="tbl" id="op-table"><thead><tr><th>${th("Produkt")}</th><th>${th("Jednostka")}</th><th class="r">${th("Stan początkowy (BO)")}</th><th class="r">${th("Stan bieżący")}</th><th class="r">${th("Nowy stan początkowy")}</th><th class="r">${th("Zmiana")}</th></tr></thead>
            <tbody>${body}</tbody></table></div>` : `<div class="card-b"><p class="muted">${th("Brak produktów — dodaj je w kartotece Produkty.")}</p></div>`}
          ${edit && rows.length ? `<div class="card-b row wrap"><button class="btn primary" type="button" id="op-save">${ic("check", 15)} ${th("Zapisz stany początkowe")}</button>
            <button class="btn" type="button" id="op-reset">${th("Wyczyść wpisane wartości")}</button>
            <span class="help">${th("Puste pole = bez zmiany. Wartość 0 usuwa stan początkowy produktu (dokumentem z różnicą).")}</span></div>` : ""}
        </div>
        <div class="card mt4"><div class="card-h"><h3>${th("Dokumenty bilansu otwarcia")}</h3></div>
          ${docs.length ? `<div class="tbl-wrap"><table class="tbl" id="op-docs"><thead><tr><th>${th("Numer")}</th><th>${th("Data")}</th><th class="r">${th("Pozycje")}</th></tr></thead>
            <tbody>${docs.map(d => `<tr><td class="mono">${esc(d.no)}</td><td>${esc(Dates.pl(d.date))}</td><td class="r">${d.lines}</td></tr>`).join("")}</tbody></table></div>`
            : `<div class="card-b"><p class="muted">${th("Brak dokumentów bilansu otwarcia w tym magazynie.")}</p></div>`}</div>`;
    },
    bind(page) {
      const f = form();
      const wh = $("#op-wh", page); if (wh) wh.onchange = () => { f.whId = wh.value; f.values = {}; App.render(); };
      const dt = $("#op-date", page); if (dt) dt.onchange = () => { f.date = dt.value; };
      // różnica liczona na bieżąco w komórce — bez przerysowania całego ekranu przy każdym znaku
      $$("[data-oin]", page).forEach(inp => inp.oninput = () => {
        const pid = inp.dataset.oin; f.values[pid] = inp.value;
        const cell = $(`[data-odelta="${pid}"]`, page), r = O.sheet(Store.state, f.whId).find(x => x.productId === pid);
        const next = inp.value === "" ? null : parse(inp.value), d = next === null || !r ? null : R.rq(next - r.opening);
        if (cell) cell.innerHTML = d === null || Math.abs(d) <= EPS ? "" : `<span class="${d > 0 ? "pos" : "neg"}">${d > 0 ? "+" : ""}${esc(fmtQ(d))}</span>`;
        const msg = $(`[data-omsg="${pid}"]`, page); if (msg) msg.classList.toggle("hidden", !(inp.value !== "" && next === null));
        if (msg && inp.value !== "" && next === null) msg.textContent = NumParse.parse(inp.value).error;
      });
      const reset = $("#op-reset", page); if (reset) reset.onclick = () => { f.values = {}; App.render(); };
      const save = $("#op-save", page);
      if (save) save.onclick = async () => {
        const lines = Object.entries(f.values).filter(([, v]) => v !== "").map(([productId, qty]) => ({ productId, qty }));
        if (!lines.length) { Toast.info(t("Brak zmian do zapisania"), t("Wpisz nowy stan początkowy przy wybranych produktach.")); return; }
        const whName = App.whName(f.whId);
        const ok = await Modal.confirm({ title: t("Zapisać stany początkowe?"), text: t("Magazyn {w}, data {d}: zmiana stanu początkowego {n} produktów. Powstanie dokument „Bilans otwarcia” z różnicami.", { w: whName, d: Dates.pl(f.date), n: lines.length }), ok: t("Zapisz") });
        if (!ok.ok) return;
        save.disabled = true;
        const res = await Store.exec("stock.opening", { whId: f.whId, date: f.date, lines }, SRC);
        save.disabled = false;
        $$("[data-omsg]", page).forEach(x => x.classList.add("hidden"));
        if (!res.ok) {
          for (const [k, msg] of Object.entries(res.errors || {})) {
            const x = $(`[data-omsg="${k.startsWith("p:") ? k.slice(2) : k}"]`, page);
            if (x) { x.textContent = msg; x.classList.remove("hidden"); }
          }
          Toast.err(t("Nie zapisano"), res.error); return;
        }
        f.values = {};
        Toast.ok(t("Zapisano stany początkowe"), t("{w}: dokument {no}, zmienione pozycje: {n}", { w: whName, no: res.no, n: res.changes.length }));
        App.render();
      };
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
