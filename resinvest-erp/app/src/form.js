/* =========================================================================
   ResInvest ERP 3.0 — warstwa A (cd.): formularz „Nowa operacja” i korekta
   Formularz tylko zbiera dane i pokazuje plan z silnika (RIW.planOperation);
   zapis idzie wyłącznie przez Store.exec (komendy usługi) — w trybie
   lokalnym i serwerowym identycznie.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, tp, N_, esc, $, $$, ic, fid, str, lsGet, lsSet, ssGet, ssSet, Toast, Modal, Store, App, Views, statusBadge, DRAFT_KEY } = UI;
  const { NumParse, fmt, fmtQ, money, Units, Dates, Stock } = R;
  const DBG = root.RIW_DEBUG;
  const eg = x => t("np. {x}", { x });
  const SRC_NEW = N_("Formularz „Nowa operacja”"), SRC_CORR = N_("Korekta dokumentu"), SRC_REVIEW = N_("Operacje do zatwierdzenia");

  /* ------------------------------------------------------------------ */
  /* Samouczek przy polach (HTML dozwolony w tłumaczeniach)              */
  /* ------------------------------------------------------------------ */
  const HELP = {
    "date": N_("<b>Co:</b> dzień operacji. <b>Po co:</b> decyduje o miesiącu księgowania i numeracji dokumentów. Nie może być z przyszłości ani z okresu zamkniętego."),
    "purchase.supplierName": N_("<b>Co:</b> nazwa dostawcy — <b>wpisz ręcznie</b> albo wybierz z podpowiedzi. Nowa nazwa zostanie dopisana do kartoteki Kontrahenci przy zatwierdzeniu operacji. <b>Po co:</b> trafia na dokument PZ; ustawia podstawę (KZR / Deklaracja)."),
    "purchase.supplierKind": N_("<b>Co:</b> grupa dostawcy. <b>Firma branży drzewnej / przedsiębiorstwo drzewne</b> → podstawa domyślnie <b>KZR</b>. <b>Nadleśnictwo</b> → podstawa domyślnie <b>Deklaracja</b> i dodatkowe pole <b>Leśnictwo</b>."),
    "purchase.lesnictwo": N_("<b>Co:</b> leśnictwo w wybranym nadleśnictwie. Wybierz zapisane z listy albo wpisz nowe — po zatwierdzeniu pojawi się na liście. <b>Przykład:</b> Wielopole."),
    "transport.own.runCount": N_("<b>Co:</b> ile kursów wykonała flota własna. Po wpisaniu np. <b>4</b> pojawią się 4 osobne rubryki: pojazd, kierowca, km, stawka, ilość i waga rzeczywista. <b>Przykład:</b> 4 kursy × 100 MP = 400 MP."),
    "purchase.basis": N_("<b>Co:</b> podstawa pochodzenia biomasy. Ustawia się automatycznie według grupy dostawcy (firma → KZR, nadleśnictwo → Deklaracja) — możesz ją zmienić. <b>Deklaracja</b> — oświadczenie dostawcy, <b>KZR</b> — dostawa rozliczana w systemie certyfikacji KZR."),
    "purchase.productId": N_("<b>Co:</b> kupowany towar. <b>Po co:</b> ustala jednostkę magazynową i dozwolone jednostki (ustawiane w module Produkty)."),
    "purchase.qty": N_("<b>Co:</b> ilość z dokumentu dostawcy, w jednostce wybranej obok. Możesz wpisać <b>12,50</b> albo <b>12.50</b> lub wkleić <b>1 250,50</b>."),
    "purchase.unit": N_("<b>Co:</b> w czym podajesz ilość (np. drewno w m³ z kwitu). Zmiana jednostki <b>przelicza wpisaną ilość</b> — stan magazynu się nie zmienia. <b>1 m³ drewna = 4 MP</b>."),
    "purchase.priceUnit": N_("<b>Co:</b> za jaką jednostkę płacimy (np. drewno w m³, cena za wyprodukowane MP). <b>Po co:</b> koszt zakupu = ilość przeliczona na tę jednostkę × cena."),
    "purchase.price": N_("<b>Co:</b> cena netto za 1 jednostkę zakupu (wybraną obok). <b>Po co:</b> koszt zakupu = ilość w jednostce zakupu × cena."),
    "purchase.weightMode": N_("<b>Orientacyjna</b> = przelicznik produktu (zrębka 0,33 t/MP). <b>Ręczna</b> = waga rzeczywista z kwitu wagowego. Masa nie zmienia ilości na stanie."),
    "purchase.weightManual": N_("<b>Co:</b> waga z wagi samochodowej (kwit wagowy), w tonach. <b>Przykład:</b> 19,20."),
    "production.type": N_("<b>Co:</b> rodzaj wyprodukowanej zrębki — wskazuje produkt wynikowy i wymagane dane pochodzenia."),
    "production.rawProductId": N_("<b>Co:</b> surowiec, z którego powstaje produkt. Musi być innym produktem niż produkt wyjściowy."),
    "production.outProductId": N_("<b>Co:</b> produkt, który powstaje. <b>Przelicznik:</b> 1 m³ drewna = 4 MP zrębki."),
    "production.outQty": N_("<b>Co:</b> ile produktu powstało (np. MP zrębki). <b>Zużycie surowca liczy system:</b> MP ÷ 4 = m³. Nie można wyprodukować więcej, niż pozwala stan surowca."),
    "production.consumeQty": N_("<b>Co:</b> ile zakupionego surowca idzie do rębaka (puste = cały zakup). Tyle system odejmie ze stanu (RW)."),
    "production.rawCost": N_("<b>Co:</b> koszt drewna z lasu, jeśli rozliczasz go w tej operacji (opcjonalnie)."),
    "production.diffReason": N_("<b>Co:</b> przyczyna, gdy wynik jest mniejszy niż zużycie × 4. Wymagana tylko przy różnicy."),
    "production.chipRate": N_("<b>Co:</b> cena za rąbanie w zł za 1 MP zrębki. Domyślnie <b>10,00 zł/MP</b> — możesz zmienić. <b>Koszt rąbania = MP × cena.</b>"),
    "production.ndl": N_("<b>Co:</b> nadleśnictwo z kwitu wywozowego. <b>Przykład:</b> Rudy Raciborskie."),
    "production.lesnictwo": N_("<b>Co:</b> leśnictwo z kwitu wywozowego. <b>Przykład:</b> Stanica."),
    "production.kwit": N_("<b>Co:</b> numer kwitu wywozowego Lasów Państwowych. <b>Przykład:</b> KW 0217/09/2026."),
    "production.investSite": N_("<b>Co:</b> gdzie prowadzono wycinkę i dla jakiej inwestycji."),
    "production.sourceDoc": N_("<b>Co:</b> numer decyzji lub protokołu wycinki (opcjonalnie)."),
    "production.chipperId": N_("<b>Co:</b> rębak z modułu Flota (opcjonalnie). Operator uzupełni się sam."),
    "production.operatorId": N_("<b>Co:</b> operator rębaka. Zmiana dotyczy tylko tej produkcji."),
    "sale.productId": N_("<b>Co:</b> towar, który jest już na magazynie. Lista pokazuje tylko towary ze stanem."),
    "sale.qty": N_("<b>Co:</b> ilość do sprzedaży. Nie może przekroczyć stanu dostępnego."),
    "sale.unit": N_("<b>Co:</b> jednostka ilości i ceny, zgodna z towarem."),
    "sale.price": N_("<b>Co:</b> cena netto sprzedaży za 1 jednostkę. <b>Przychód = ilość × cena.</b>"),
    "sale.buyerId": N_("<b>Co:</b> kupujący / odbiorca. Wymagany."),
    "sale.qtyMP": N_("<b>Co:</b> ile sprzedajesz z tej produkcji. Puste = cała produkcja. Nie więcej niż wyprodukowano."),
    "sale.priceUnit": N_("<b>Co:</b> jednostka ceny. Przy cenie za tonę przychód liczony jest z masy (MP × 0,33 t)."),
    "mm.productId": N_("<b>Co:</b> towar przesuwany między magazynami. Stan ogółem firmy się nie zmienia."),
    "mm.qty": N_("<b>Co:</b> ilość do przesunięcia. Nie więcej niż stan w magazynie źródłowym."),
    "mm.fromWhId": N_("<b>Co:</b> magazyn, z którego towar wychodzi. Lista zawiera magazyny, do których masz dostęp."),
    "mm.toWhId": N_("<b>Co:</b> magazyn, do którego towar jest wysyłany. Musi być inny niż magazyn źródłowy."),
    "mm.weightMode": N_("<b>Automatyczny</b> = przelicznik produktu (np. zrębka 0,33 t/MP). <b>Ręczny</b> = tonaż z kwitu wagowego. Tonaż nie zmienia ilości na stanie."),
    "mm.weightManual": N_("<b>Co:</b> tonaż ładunku z wagi (kwit wagowy), w tonach. <b>Przykład:</b> 16,40."),
    "transport.place": N_("<b>Co:</b> dokąd jedzie ładunek (miejsce dostawy). Trafia na dokumenty jako „Miejsce transportu”."),
    "transport.mode": N_("<b>Co:</b> kto wiezie ładunek. <b>Transport nie zmienia stanu</b> — to wyłącznie koszt i karta transportu (TR)."),
    "transport.external.company": N_("<b>Co:</b> firma przewozowa. <b>Przykład:</b> ESI Logistics."),
    "transport.external.companyCount": N_("Wpisz ilość firm zewnętrznych, którym zlecono transport."),
    "transport.external.includedInPrice": N_("Zaznacz, gdy transport jest wliczony w cenę towaru. Koszt transportu tej operacji = 0 zł."),
    "transport.train.trainNo": N_("<b>Co:</b> numer składu. <b>Przykład:</b> RC 50931."),
    "transport.train.carrier": N_("<b>Co:</b> przewoźnik kolejowy. <b>Przykład:</b> PKP Cargo."),
    "transport.train.docNo": N_("<b>Co:</b> numer listu przewozowego (CIM / SMGS)."),
    "transport.train.loadPlace": N_("<b>Co:</b> bocznica / stacja załadunku."),
    "transport.train.wagonCount": N_("<b>Co:</b> liczba wagonów w składzie. <b>Przykład:</b> 20."),
    "transport.train.capacity": N_("<b>Co:</b> ładowność jednego wagonu (opcjonalnie) — w MP albo w tonach. Kontrola przeładowania."),
    "transport.train.sameT": N_("<b>Co:</b> tonaż jednego wagonu — trafi do każdego wagonu. <b>Przykład:</b> 20 × 60 t = 1 200 t."),
    "transport.train.price": N_("<b>Co:</b> stawka frachtu kolejowego. Ilość do rozliczenia wynika z tonażu składu."),
    "transport.train.priceUnit": N_("<b>Co:</b> za co płacimy przewoźnikowi: t, MP czy m³."),
    "extras.enabled": N_("<b>Co:</b> prace towarzyszące operacji (zakup, sprzedaż, produkcja, MM), np. holowanie, rozładunek, podgarnianie pryzm, praca ładowarką. Każda pozycja to osobny zapis z kosztem — rodzaj wybierasz z kartoteki <b>Dodatkowe operacje</b>, pojazd (opcjonalnie) z <b>Floty</b>. Koszt obniża wynik operacji; stan magazynu się nie zmienia."),
    "sale.weightMode": N_("<b>AUTO</b> = przelicznik firmowy produktu (np. 1 MP = 0,33 t). <b>RĘCZNY</b> = tonaż z wagi rzeczywistej — zapisany na dokumencie i nigdy nie nadpisywany automatycznie."),
    "sale.weightManual": N_("<b>Co:</b> tonaż z kwitu wagowego, w tonach. <b>Przykład:</b> 20,35."),
    "docNos.PZ": N_("<b>Co:</b> numer PZ z dokumentu (wpisz ręcznie, np. <b>PZ/11</b>). Numer musi być unikalny w magazynie w danym roku."),
    "docNos.WZ": N_("<b>Co:</b> numer WZ (wpisz ręcznie, np. <b>WZ/27</b>). Numer musi być unikalny w magazynie w danym roku."),
    "docNos.MM": N_("<b>Co:</b> numer MM (wpisz ręcznie, np. <b>MM/5</b>). Numer musi być unikalny w magazynie źródłowym w danym roku."),
    "docDate": N_("<b>Co:</b> data wystawienia dokumentu (np. data z dokumentu dostawcy). Puste = data przyjęcia (data operacji). <b>Data przyjęcia</b> to dzień przyjęcia / wydania towaru; datę i godzinę utworzenia wpisu zapisuje system."),
    "production.operatorName": N_("<b>Co:</b> operator rębaka firmy zewnętrznej (opcjonalnie) — domyślnie z kartoteki rębaka."),
    "notes": N_("<b>Co:</b> dodatkowe informacje (opcjonalnie)."),
    "extDoc": N_("<b>Co:</b> numer dokumentu zewnętrznego (faktura, kwit wagowy, zlecenie) — opcjonalnie.")
  };

  /* ------------------------------------------------------------------ */
  /* Kontrolki formularza                                                */
  /* ------------------------------------------------------------------ */
  function setPath(o, path, v) {
    const ks = path.split("."); let cur = o;
    for (let i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] == null) cur[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; cur = cur[ks[i]]; }
    cur[ks[ks.length - 1]] = v;
  }
  function field({ key, label, req, control, span, help = true, calc = "" }) {
    return `<div class="field ${span || ""}" data-field="${esc(key)}">
      <label for="${fid(key)}">${esc(label)}${req ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>
      ${control}
      <div class="calc" data-calc="${esc(key)}">${calc}</div>
      <div class="msg hidden" data-msg="${esc(key)}" role="alert"></div>
      ${(typeof help === "string" ? help : help && HELP[key]) ? `<div class="help tut">${t(typeof help === "string" ? help : HELP[key])}</div>` : ""}
    </div>`;
  }
  const textIn = (key, v, { placeholder = "", list = "", disabled = false } = {}) =>
    `<input class="ctrl" type="text" id="${fid(key)}" data-bind="${esc(key)}" value="${esc(v)}" placeholder="${esc(placeholder)}" autocomplete="off" ${list ? `list="${list}"` : ""} ${disabled ? "disabled" : ""}>`;
  const numIn = (key, v, { suffix = "", placeholder = "" } = {}) =>
    `<div class="input-wrap"><input class="ctrl num-in" type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
      id="${fid(key)}" data-bind="${esc(key)}" data-num value="${esc(v)}" placeholder="${esc(placeholder)}">${suffix ? `<span class="suffix">${esc(suffix)}</span>` : ""}</div>`;
  const selIn = (key, options, v, { struct = false, disabled = false } = {}) =>
    `<select class="ctrl" id="${fid(key)}" data-bind="${esc(key)}" ${struct ? "data-struct" : ""} ${disabled ? "disabled" : ""}>${options.map(o =>
      `<option value="${esc(o.v)}" ${String(o.v) === String(v == null ? "" : v) ? "selected" : ""} ${o.disabled ? "disabled" : ""}>${esc(o.l)}</option>`).join("")}</select>`;
  const outBox = (key, html) => `<output class="ctrl num-in out" id="${fid(key)}" data-out="${esc(key)}">${html}</output>`;
  const optCard = (key, { checked, disabled, title, text, struct = true, radio = false, attrs = "", id = "" }) =>
    `<label class="opt ${radio ? "radio" : ""} ${disabled && checked ? "locked" : ""} ${disabled && !checked ? "dis" : ""}">
      <input type="checkbox" ${key || id ? `id="${id || fid(key)}"` : ""} ${key ? `data-bind="${esc(key)}"` : ""} ${struct ? "data-struct" : ""} ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} ${attrs}>
      <span class="box">${ic("check", 13)}</span><span class="ct"><b>${esc(title)}</b><span>${esc(text)}</span></span></label>`;
  const section = (n, id, title, sub, body, off) => `<section class="sec ${off ? "off" : ""}" aria-labelledby="h-${id}">
      <div class="sec-h"><span class="n">${n}</span><div><h3 id="h-${id}">${esc(title)}</h3><p>${esc(sub)}</p></div></div>
      <div class="sec-b">${body || ""}</div></section>`;
  const pick = l => ({ v: "", l: `— ${l} —` });

  /* ------------------------------------------------------------------ */
  /* Nowa operacja / korekta                                             */
  /* ------------------------------------------------------------------ */
  const PRESETS = {
    zakup: d => { d.type = "ZAKUP"; d.purchase.productId = "pr_drewno"; d.purchase.unit = "m3"; },
    lancuch: d => { d.type = "ZAKUP"; d.purchase.productId = "pr_drewno"; d.purchase.unit = "m3"; d.production.enabled = true; d.sale.enabled = true; d.sale.direct = true; },
    wz: d => { d.type = "SPRZEDAZ"; d.sale.direct = false; },
    produkcja: d => { d.type = "PRODUKCJA"; d.production.rawProductId = "pr_drewno"; d.production.outProductId = "pr_zr_lesna"; },
    bezposrednia: d => { d.type = "SPRZEDAZ"; d.sale.direct = true; d.production.rawProductId = "pr_drewno"; d.production.outProductId = "pr_zr_lesna"; },
    mm: d => { d.type = "MM"; d.mm.fromWhId = App.user().whId; }
  };
  const CANCEL_REASONS = [N_("pomyłka operatora"), N_("dokument wprowadzony podwójnie"), N_("dostawa nie dotarła"), N_("błędny kontrahent"), N_("błędny magazyn"), N_("inny")];
  const errorsWord = n => tp("{n} błąd|{n} błędy|{n} błędów", n);

  const Form = {
    mode: "new", op: null, draft: null, touched: new Set(), showAll: false, saving: false, plan: null, corr: null, review: null,

    /* ---------- cykl życia szkicu ---------- */
    ensureDraft(preset, draftId) {
      this.mode = "new"; this.op = null; this.corr = null;
      if (draftId) {
        const rec = R.byId(Store.state.drafts, draftId);
        // operacja przekazana do zatwierdzenia, otwarta przez kierownika / administratora → przegląd i decyzja
        if (rec && rec.status === "PENDING" && rec.userId !== Store.userId && R.canApprove(App.user(), rec.whId)) {
          this.review = { id: rec.id, whId: rec.whId, userName: rec.userName, submittedAt: rec.submittedAt };
          this.draft = Object.assign(R.clone(rec.draft), { draftId: rec.id, _user: Store.userId }); this.touched = new Set(); this.showAll = true; return;
        }
        this.review = null;
        if (rec) { this.draft = Object.assign(R.clone(rec.draft), { idemKey: R.uid("idem"), draftId: rec.id }); this.touched = new Set(); this.showAll = false; this.persist(); return; }
      }
      if (this.review) { this.review = null; this.draft = null; }
      const stored = ssGet(DRAFT_KEY, null);
      if (!this.draft && stored) {
        try { const d = JSON.parse(stored); if (d && d.idemKey && d.type && d._user === Store.userId && !Store.state.operations.some(o => o.idemKey === d.idemKey)) this.draft = d; } catch (e) {}
      }
      if (this.draft && (Store.state.operations.some(o => o.idemKey === this.draft.idemKey) || this.draft._user !== Store.userId)) this.draft = null;
      if (!this.draft || preset) this.reset(preset);
    },
    /**
     * Szybki wpis: kopia zatwierdzonej operacji na dziś — te same strony, produkty, ilości, ceny, pojazdy, km i stawki;
     * bez numerów dokumentów (numeracja automatyczna), kwitów, wag rzeczywistych, uwag i przyczyn różnic.
     */
    repeatFrom(opId) {
      const op = R.byId(Store.state.operations, opId);
      if (!op || !op.input) return false;
      const d = Object.assign(R.FleetPick.resolveDraft(Store.state, R.Templates.instantiate(op.input, { today: App.today() })), { _user: Store.userId, _repeatOf: op.no });
      this.mode = "new"; this.op = null; this.corr = null; this.review = null;
      this.draft = d; this.touched = new Set(); this.showAll = false; this.persist();
      return true;
    },
    /** „Powtórz ostatnią”: ostatnia operacja użytkownika w bieżącym magazynie, a gdy brak — ostatnia w magazynie. */
    lastOwnOp() {
      const ops = Store.state.operations, wh = App.wh() && App.wh().id;
      const ok = o => o.input && !o.deleted && o.status !== "CANCELLED" && (!wh || o.whId === wh);
      let any = null;
      for (let i = ops.length - 1; i >= 0; i--) { const o = ops[i]; if (!ok(o)) continue; if (o.userId === Store.userId) return o; if (!any) any = o; }
      return any;
    },
    /* ---------------- 3.11: szybki wpis klawiaturą i kursy ---------------- */
    enterNav() { return lsGet("riw.enterNav", "1") !== "0"; },
    /** Pola formularza w kolejności wpisywania (widoczne, aktywne; bez pól tylko do odczytu). */
    focusables() {
      const form = $("#opf"); if (!form) return [];
      return $$("input[data-bind]:not([type=checkbox]):not([type=radio]), select[data-bind], textarea[data-bind]", form).filter(x => !x.disabled && !x.readOnly && x.offsetParent !== null);
    },
    moveFocus(from, dir) {
      const list = this.focusables(), i = list.indexOf(from);
      const next = i < 0 ? null : list[i + dir];
      if (next) { next.focus(); if (next.select && next.tagName === "INPUT") next.select(); return; }
      if (dir > 0) this.save();                       // ostatnie pole + Enter = zapis (podsumowanie przed zatwierdzeniem)
    },
    /** „+1 kurs jak poprzedni / jak ten”: kopia kursu (pojazd, kierowca, km, stawka, ilość) bez kwitu i wagi; fokus na kwicie. */
    addRunLike(m, idx) {
      const X = m === "own" ? this.ownRuns() : this.extRuns();
      const n = Math.max(0, Math.floor(NumParse.value(X.runCount, 0)) || 0);
      if (n >= 50) { Toast.warn(t("Maksymalnie {n} kursów w jednej operacji", { n: 50 })); return; }
      const src = X.runs[idx === null ? n - 1 : idx] || (m === "own" ? R.blankRun() : R.blankExtRun());
      const copy = Object.assign(m === "own" ? R.blankRun() : R.blankExtRun(), R.clone(src), { kwit: "", kwitM3: "", weightT: "" });
      X.runs = X.runs.slice(0, n).concat(copy); X.runCount = String(n + 1);
      this.touched.add(`transport.${m}.runCount`);
      this.persist(); this.rerender();
      const k = f => fid(`transport.${m}.runs.${n}.${f}`);
      const target = document.getElementById(k("kwit")) || document.getElementById(k("weightT")) || document.getElementById(k("qty"));
      if (target) { target.focus(); target.scrollIntoView({ block: "center" }); }
      Toast.ok(t("Dodano kurs {n}", { n: n + 1 }), t("Ten sam pojazd, kierowca, km i stawka — wpisz kwit i wagę."));
    },

    /** Kwity z wagi → kursy formularza (własne i zewnętrzne); brakujące kursy dopisywane jak poprzedni. */
    importScale() {
      const S = Store.state, d = this.draft, mode = d.transport.mode;
      const useOwn = mode === "own" || mode === "mixed", useExt = mode === "external" || mode === "mixed";
      const list = [];
      if (useOwn) this.ownRuns().runs.slice(0, Math.floor(NumParse.value(this.ownRuns().runCount, 0)) || 0).forEach((r, i) => {
        const v = R.byId(S.fleet.vehicles, r.vehicleId), reg = v ? v.reg : R.FleetPick.split(r.vehicleReg).head;
        list.push({ m: "own", i, reg, kwit: r.kwit, weightT: r.weightT, label: t("Kurs {n}", { n: i + 1 }) + (mode === "mixed" ? " · " + t("własny") : "") + (reg ? " · " + reg : "") });
      });
      if (useExt) this.extRuns().runs.slice(0, Math.floor(NumParse.value(this.extRuns().runCount, 0)) || 0).forEach((r, i) => {
        list.push({ m: "external", i, reg: r.reg, kwit: r.kwit, weightT: r.weightT, label: t("Kurs {n}", { n: i + 1 }) + (mode === "mixed" ? " · " + t("zewnętrzny") : "") + (r.reg ? " · " + r.reg : "") });
      });
      UI.ScaleImport.open(list, rows => {
        let added = 0, filled = 0;
        for (const row of rows) {
          let tgt = typeof row.run === "number" ? list[row.run] : null;
          if (row.run === "new") {
            const m = useOwn ? "own" : "external", X = m === "own" ? this.ownRuns() : this.extRuns();
            const n = Math.max(0, Math.floor(NumParse.value(X.runCount, 0)) || 0);
            if (n >= 50) continue;
            const prev = X.runs[n - 1];
            const copy = Object.assign(m === "own" ? R.blankRun() : R.blankExtRun(), prev ? R.clone(prev) : {}, { kwit: "", kwitM3: "", weightT: "", qty: "" });
            X.runs = X.runs.slice(0, n).concat(copy); X.runCount = String(n + 1); added++;
            tgt = { m, i: n, reg: "" };
          }
          if (!tgt) continue;
          const run = (tgt.m === "own" ? this.ownRuns() : this.extRuns()).runs[tgt.i], tk = row.ticket;
          if (tk.no) run.kwit = tk.no;
          if (tk.netT !== null) run.weightT = fmtQ(tk.netT);
          if (tk.reg) {
            if (tgt.m === "external") { if (!String(run.reg || "").trim() || row.run === "new") run.reg = tk.reg; }
            else {
              const p = R.FleetPick.vehicle(S, tk.reg), cur = R.byId(S.fleet.vehicles, run.vehicleId);
              const curReg = cur ? cur.reg : R.FleetPick.split(run.vehicleReg).head;   // ten sam numer (inny zapis) — bez zmiany
              if (R.FleetPick.regKey(curReg) !== R.FleetPick.regKey(tk.reg)) {
                if (p && p.rec && p.rec.owner !== "external") { run.vehicleId = p.rec.id; run.vehicleReg = ""; const dd = R.byId(S.fleet.drivers, p.rec.driverId); if (dd && row.run === "new") { run.driverId = dd.id; run.driverName = ""; } }
                else if (p && p.fresh) { run.vehicleId = ""; run.vehicleReg = tk.reg; }
              }
            }
          }
          filled++;
        }
        this.touched.add("transport.runs");
        this.persist(); this.rerender();
        Toast.ok(t("Wczytano kwity: {n}", { n: filled }), added ? t("Dodano kursów: {n}", { n: added }) : t("Sprawdź ilości w kursach."));
      }, { canAdd: true });
    },

    /* ---------------- 3.11: szablony operacji ---------------- */
    /** Liczniki użycia szablonów (wygoda jednego stanowiska — kolejność przycisków). */
    tplUses() { try { return JSON.parse(lsGet("riw.tplUses", "{}")) || {}; } catch (e) { return {}; } },
    /** Szablony dla bieżącego magazynu: najczęściej używane najpierw, potem alfabetycznie. */
    tplList() {
      const S = Store.state, uses = this.tplUses();
      return R.Templates.visible(S, App.user(), this.whId()).sort((a, b) => (uses[b.id] || 0) - (uses[a.id] || 0) || a.name.localeCompare(b.name, "pl"));
    },
    tplBar() {
      if (this.mode !== "new" || this.review) return "";
      const list = this.tplList(), top = list.slice(0, 8);
      return `<div class="tpl-bar" id="tpl-bar" role="toolbar" aria-label="${esc(t("Szablony operacji"))}">
        <span class="tpl-h">${ic("star", 15)} ${esc(t("Szablony"))}</span>
        ${top.map((x, i) => `<button class="tpl-chip" type="button" data-tpl="${esc(x.id)}" title="${esc(x.summary || "")}">${i < 9 ? `<kbd>Alt+${i + 1}</kbd>` : ""}${esc(x.name)}${x.shared ? "" : ` <small class="dim">${esc(t("prywatny"))}</small>`}</button>`).join("") || `<span class="dim">${esc(t("Brak szablonów — wypełnij formularz i zapisz go jako szablon."))}</span>`}
        <span class="spacer"></span>
        ${list.length > top.length ? `<button class="btn sm ghost" type="button" id="tpl-more">${esc(t("Wszystkie ({n})", { n: list.length }))}</button>` : ""}
        <button class="btn sm" type="button" id="tpl-save">${ic("plus", 14)} ${esc(t("Zapisz jako szablon"))}</button>
        ${list.length ? `<button class="btn sm ghost" type="button" id="tpl-manage">${esc(t("Zarządzaj"))}</button>` : ""}
      </div>`;
    },
    /** Szablon → formularz na dziś (pyta, gdy formularz zawiera wpisane dane). */
    async applyTemplate(id) {
      const tp = R.byId(Store.state.templates || [], id);
      if (!tp) return;
      if (this.touched && this.touched.size) {
        const r = await Modal.confirm({ title: t("Użyć szablonu „{n}”?", { n: tp.name }), text: t("Dane wpisane w formularzu zostaną zastąpione danymi szablonu."), ok: t("Użyj szablonu") });
        if (!r.ok) return;
      }
      this.draft = Object.assign(R.FleetPick.resolveDraft(Store.state, R.Templates.instantiate(tp.draft, { today: App.today() })), { _user: Store.userId, _tpl: tp.name });
      this.touched = new Set(); this.showAll = false; this.persist();
      const u = this.tplUses(); u[id] = (u[id] || 0) + 1; lsSet("riw.tplUses", JSON.stringify(u));
      App.render();
      Toast.ok(t("Szablon „{n}”", { n: tp.name }), t("Uzupełnij ilości, numery kwitów i wagi — Ctrl+Enter zatwierdza."));
      this.focusFirstEmpty();
    },
    /** Zapis bieżącego formularza jako szablonu (nazwa, wspólny / prywatny, magazyn). */
    saveTemplateDialog() {
      const d = this.draft, wh = this.whId(), def = R.Templates.describe(Store.state, d);
      const m = Modal.open({ id: "tpl-dialog", title: t("Zapisz jako szablon"), sub: esc(def),
        body: `<div class="field"><label for="tpl-name">${esc(t("Nazwa szablonu"))} <span class="req">*</span></label>
            <input class="ctrl" id="tpl-name" maxlength="${R.Templates.NAME_MAX}" placeholder="${esc(t("np. Las Rybnik → Zabrze, Scania, Kowalski"))}" value="${esc(d._tpl || "")}">
            <div class="msg hidden" id="tpl-msg" role="alert"></div></div>
          <label class="inline-opt mt3"><input type="checkbox" id="tpl-shared" checked> ${esc(t("Wspólny — widoczny dla wszystkich w magazynie"))}</label>
          <label class="inline-opt mt2"><input type="checkbox" id="tpl-allwh"> ${esc(t("Dla wszystkich magazynów (zamiast tylko {w})", { w: App.whName(wh) }))}</label>
          <p class="dim mt3">${esc(t("Szablon zapamiętuje strony, produkty, ceny, transport, pojazdy, kierowców, km i stawki. Daty, numery dokumentów, kwity i wagi wpisuje się przy każdej operacji."))}</p>`,
        footer: `<button class="btn ghost" type="button" data-no>${esc(t("Anuluj"))}</button><button class="btn primary" type="button" id="tpl-ok">${ic("check", 15)} ${esc(t("Zapisz szablon"))}</button>` });
      $("[data-no]", m.el).onclick = () => m.close();
      const go = async () => {
        const rec = { name: $("#tpl-name", m.el).value, shared: $("#tpl-shared", m.el).checked, whId: $("#tpl-allwh", m.el).checked ? "" : wh, draft: R.clone(d) };
        const res = await Store.exec("template.save", { rec }, N_("Szablony operacji"));
        if (res && res.ok) { m.close(); Toast.ok(t("Zapisano szablon „{n}”", { n: res.rec.name }), res.rec.summary); App.render(); }
        else { const msg = $("#tpl-msg", m.el); msg.textContent = (res && res.error) || t("Nie zapisano"); msg.classList.remove("hidden"); }
      };
      $("#tpl-ok", m.el).onclick = go;
      $("#tpl-name", m.el).onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); go(); } };
    },
    /** Lista wszystkich szablonów: użyj, zmień nazwę, usuń (autor albo kierownik). */
    manageTemplates() {
      const me = App.user(), canEdit = x => x.userId === me.id || App.can("master.edit");
      const rows = () => this.tplList().map(x => `<tr data-row="${esc(x.id)}"><td><b>${esc(x.name)}</b><br><small class="dim">${esc(x.summary || "")}</small></td>
          <td>${x.shared ? esc(t("wspólny")) : esc(t("prywatny"))}<br><small class="dim">${esc(x.whId ? App.whName(x.whId) : t("wszystkie magazyny"))}</small></td><td><small>${esc(x.userName || "")}</small></td>
          <td class="r nowrap"><button class="btn sm primary" type="button" data-use="${esc(x.id)}">${esc(t("Użyj"))}</button>
          ${canEdit(x) ? `<button class="btn sm ghost" type="button" data-ren="${esc(x.id)}">${esc(t("Nazwa"))}</button><button class="btn sm ghost" type="button" data-del="${esc(x.id)}" aria-label="${esc(t("Usuń szablon {n}", { n: x.name }))}">${ic("trash", 14)}</button>` : ""}</td></tr>`).join("");
      const m = Modal.open({ id: "tpl-manage-dlg", title: t("Szablony operacji"), wide: true,
        body: `<div class="tbl-wrap"><table class="tbl" id="tpl-table"><thead><tr><th>${esc(t("Szablon"))}</th><th>${esc(t("Dostęp"))}</th><th>${esc(t("Autor"))}</th><th></th></tr></thead><tbody>${rows()}</tbody></table></div>` });
      const bind = () => {
        $$("[data-use]", m.el).forEach(b => b.onclick = () => { m.close(); this.applyTemplate(b.dataset.use); });
        $$("[data-del]", m.el).forEach(b => b.onclick = async () => {
          const tp = R.byId(Store.state.templates, b.dataset.del);
          const r = await Modal.confirm({ title: t("Usunąć szablon „{n}”?", { n: tp.name }), text: t("Szablon zniknie z listy u wszystkich użytkowników. Operacje utworzone z szablonu nie zmieniają się."), ok: t("Usuń"), danger: true });
          if (!r.ok) return;
          const res = await Store.exec("template.remove", { id: tp.id }, N_("Szablony operacji"));
          if (res && res.ok) { Toast.ok(t("Usunięto szablon")); $("#tpl-table tbody", m.el).innerHTML = rows(); bind(); App.render(); } else Toast.err(t("Nie usunięto"), res && res.error);
        });
        $$("[data-ren]", m.el).forEach(b => b.onclick = async () => {
          const tp = R.byId(Store.state.templates, b.dataset.ren);
          const r = await Modal.confirm({ title: t("Zmień nazwę szablonu"), text: tp.summary || "", ok: t("Zapisz"), input: { label: t("Nazwa szablonu"), required: true, placeholder: tp.name } });
          if (!r.ok) return;
          const res = await Store.exec("template.save", { rec: { id: tp.id, name: r.value, shared: tp.shared, whId: tp.whId } }, N_("Szablony operacji"));
          if (res && res.ok) { Toast.ok(t("Zapisano szablon „{n}”", { n: res.rec.name })); $("#tpl-table tbody", m.el).innerHTML = rows(); bind(); App.render(); } else Toast.err(t("Nie zapisano"), res && res.error);
        });
      };
      bind();
    },
    /** Fokus na pierwszym pustym polu wymaganym (szybki wpis po szablonie / powtórzeniu). */
    focusFirstEmpty() {
      setTimeout(() => {
        const form = $("#opf"); if (!form) return;
        const el = $$("[data-bind]", form).find(x => !x.disabled && x.offsetParent !== null && (x.tagName === "INPUT" && x.type === "text") && !String(x.value).trim() && x.closest(".field") && x.closest(".field").querySelector(".req"));
        if (el) el.focus();
      }, 30);
    },
    /** Ostatni kurs pojazdu (km, stawka) — podpowiedź przy wyborze auta. */
    lastRunOf(vehicleId) {
      const ops = Store.state.operations;
      for (let i = ops.length - 1; i >= 0; i--) {
        const o = ops[i], own = o.input && o.input.transport && o.input.transport.own;
        if (o.deleted || !own || !Array.isArray(own.runs)) continue;
        for (let j = own.runs.length - 1; j >= 0; j--) if (own.runs[j].vehicleId === vehicleId && (own.runs[j].km || own.runs[j].rate)) return own.runs[j];
      }
      return null;
    },
    startCorrection(opId) {
      const op = R.byId(Store.state.operations, opId);
      this.mode = "correct"; this.op = op;
      if (!op) { this.draft = null; return; }
      if (!this.draft || this.draft._corrOf !== op.id || this.draft._corrRev !== op.corrections.length) {
        this.draft = Object.assign(R.blankDraft({ today: op.date }), R.clone(op.input), { idemKey: "corr", _corrOf: op.id, _corrRev: op.corrections.length, date: op.date, type: op.type });
        this.corr = { reason: "", reasonText: "", key: R.uid("corr") };
        this.touched = new Set(); this.showAll = false;
      }
    },
    reset(preset) {
      const d = R.blankDraft({ today: App.today() });
      d.production.chipRate = fmt(Store.state.config.chipRateDefault, 2);
      if (PRESETS[preset]) PRESETS[preset](d);
      d._user = Store.userId;
      this.draft = d; this.touched = new Set(); this.showAll = false;
      d.transport.place = this.defaultPlace();
      this.persist();
    },
    persist() { if (this.mode === "new" && this.draft && !this.review) { this.draft._user = Store.userId; ssSet(DRAFT_KEY, JSON.stringify(this.draft)); } },
    defaultPlace() {
      const d = this.draft;
      if (!d) return App.wh() ? App.wh().name : "";
      if (d.type === "MM") { const w = R.byId(Store.state.warehouses, d.mm.toWhId); if (w) return w.name; }
      if (d.type === "SPRZEDAZ" || (d.type === "ZAKUP" && d.sale.enabled)) { const b = App.partner(d.sale.buyerId); if (b) return b.name; }
      return App.wh() ? App.wh().name : "";
    },
    /** Zasoby floty dostępne w magazynie operacji: przypisane do niego i wspólne (oraz już wybrany — dane historyczne). */
    /** 3.11: etykiety pól floty „wybierz albo wpisz” (numer rejestracyjny na początku — wygodne wpisywanie). */
    vehLabel(v) { return `${v.reg} · ${v.name}`; },
    vehText(r) { const v = R.byId(Store.state.fleet.vehicles, r.vehicleId); return v ? this.vehLabel(v) : String(r.vehicleReg || ""); },
    driverText(r, veh) { const d = R.byId(Store.state.fleet.drivers, r.driverId || (!r.driverName && veh ? veh.driverId : "")); return d ? d.name : String(r.driverName || ""); },
    chipLabel(c) { return c.owner === "external" ? `${c.name} — ${c.company || t("firma zewnętrzna")}${c.reg ? " (" + c.reg + ")" : ""}` : c.name; },
    fleetOf(kind, keepId) { const wh = this.whId(); return Store.state.fleet[kind].filter(x => !x.whId || x.whId === wh || x.id === keepId || (kind === "vehicles" && this.draft && JSON.stringify(this.draft.transport).includes(`"${x.id}"`))); },
    /** Aktywne pojazdy firm zewnętrznych dostępne w magazynie operacji; podana firma — tylko jej pojazdy (gdy ma je w kartotece). */
    extVehicles(company) {
      const all = this.fleetOf("vehicles", null).filter(v => v.owner === "external" && v.status === "aktywny");
      const c = String(company || "").trim().toLowerCase();
      const mine = c ? all.filter(v => String(v.company || "").trim().toLowerCase() === c) : [];
      return mine.length ? mine : all;
    },
    whId() {
      if (this.mode === "correct" && this.op) return this.op.whId;
      if (this.review) return this.review.whId;
      // MM: magazyn źródłowy wybrany w formularzu (domyślnie — magazyn aktywny użytkownika)
      const d = this.draft;
      if (d && d.type === "MM" && d.mm && d.mm.fromWhId && R.byId(Store.state.warehouses, d.mm.fromWhId)) return d.mm.fromWhId;
      return App.user().whId;
    },
    /** Magazyny, z których użytkownik może wysłać MM: dostępne dla niego i aktywne (oraz już wybrany — dane historyczne). */
    sourceWarehouses(keepId) {
      const acc = R.whAccess(App.user());
      return Store.state.warehouses.filter(w => (acc === null || acc.includes(w.id)) && (w.active !== false || w.id === keepId));
    },
    /** Co zrobi przycisk główny: przegląd (zatwierdź przekazaną), zatwierdzenie bezpośrednie albo przekazanie do zatwierdzenia. */
    action() { return this.review ? "approve" : (!Store.state.config.requireApproval || R.canApprove(App.user(), this.whId())) ? "commit" : "submit"; },
    /** Tekst w polu dostawcy: wpisana nazwa albo nazwa wybranego kontrahenta (starsze szkice / korekta). */
    supplierText() {
      const P = this.draft.purchase;
      if (!P.supplierName && P.supplierId) P.supplierName = (App.partner(P.supplierId) || {}).name || "";
      return P.supplierName || "";
    },
    /** Grupa dostawcy: wybór użytkownika, a przy starszych szkicach — z kartoteki wybranego dostawcy. */
    supplierKind() {
      const P = this.draft.purchase;
      if (R.SUPPLIER_KINDS[P.supplierKind]) return P.supplierKind;
      const s = App.partner(P.supplierId);
      return s ? R.partnerKind(s) : "firma";
    },
    /** Zapisane leśnictwa nadleśnictwa: z kartoteki + z wcześniejszych operacji (nowe dopisują się same). */
    lesnictwa(supplierId) {
      const S = Store.state, set = new Set(((App.partner(supplierId) || {}).lesnictwa) || []);
      for (const o of S.operations) {
        if (o.purchase && o.purchase.supplierId === supplierId && o.purchase.lesnictwo) set.add(o.purchase.lesnictwo);
        if (o.purchase && o.purchase.supplierId === supplierId && o.production && o.production.lesnictwo) set.add(o.production.lesnictwo);
      }
      return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b, "pl"));
    },
    /** Jednostka towaru przewożonego (ilość w kursie). */
    shippedUnit() {
      const d = this.draft, p = id => App.product(id);
      if (d.type === "SPRZEDAZ" && !d.sale.direct && p(d.sale.productId)) return p(d.sale.productId).unit;
      if (d.type === "SPRZEDAZ" && d.sale.direct) return "MP";
      if (d.type === "MM" && p(d.mm.productId)) return p(d.mm.productId).unit;
      if (d.type === "ZAKUP" && d.production.enabled) return "MP";
      return p(d.purchase.productId) ? p(d.purchase.productId).unit : "MP";
    },
    /** Produkcja leśna (z nadleśnictwa / typ „leśna”) — kwity wywozowe w kursach. */
    isForest() {
      const d = this.draft;
      return d.production.type === "lesna" && ((d.type === "ZAKUP" && !!d.production.enabled) || (d.type === "SPRZEDAZ" && !!d.sale.direct));
    },
    hasRuns() { return ["own", "external", "mixed"].includes(this.draft.transport.mode); },
    extRuns() {
      const X = this.draft.transport.external;
      if (!Array.isArray(X.runs)) this.draft.transport.external = { companyCount: "1", company: X.company || "", includedInPrice: !!X.includedInPrice, runCount: "1", runs: [Object.assign(R.blankExtRun(), { reg: X.reg || "", km: X.km || "", freight: X.includedInPrice ? "" : (X.freight || "") })] };
      const E = this.draft.transport.external;
      if (E.companyCount === undefined || E.companyCount === "") E.companyCount = "1";
      return E;
    },
    /** Liczba firm transportu zewnętrznego zadeklarowana w formularzu (1–10). */
    extCompanyCount() { return Math.max(1, Math.min(R.MAX_EXT_COMPANIES, Math.floor(NumParse.value(this.extRuns().companyCount, 1)) || 1)); },
    /** Podpowiedzi firm przewozowych: firmy wpisane w kursach tej operacji, kartoteka przewoźników i właściciele pojazdów floty zewnętrznej. */
    extCompanies() {
      const S = Store.state, X = this.extRuns(), seen = new Set(), out = [];
      for (const c of X.runs.map(r => r.company).concat([X.company], S.carriers || [], this.extVehicles("").map(v => v.company))) {
        const v = String(c || "").trim(), k = v.toLowerCase();
        if (v && !seen.has(k)) { seen.add(k); out.push(v); }
      }
      return out;
    },
    ownRuns() {
      const O = this.draft.transport.own;
      if (!Array.isArray(O.runs)) { this.draft.transport.own = O.vehicleId !== undefined ? { runCount: "1", runs: [Object.assign(R.blankRun(), { vehicleId: O.vehicleId || "", driverId: O.driverId || "", km: O.km || "", rate: O.rate || "" })] } : { runCount: "1", runs: [R.blankRun()] }; }
      return this.draft.transport.own;
    },

    /* ---------- pola produkcji (trzy ścieżki) ---------- */
    productionFields(mode) {
      const S = Store.state, d = this.draft, P_ = d.production;
      const chipper = R.byId(S.fleet.chippers, P_.chipperId);
      const active = p => p.active !== false;
      const woods = S.products.filter(p => p.cat === "drewno" && active(p));
      const outs = S.products.filter(p => p.unit === "MP" && active(p));
      const stock = Stock.byProduct(S, this.whId());
      let head = "";
      if (mode === "stock") {
        const raw = App.product(P_.rawProductId), out = App.product(P_.outProductId);
        const ru = raw ? Units.label(raw.unit) : "", ou = out ? Units.label(out.unit) : "MP";
        head = `
          ${field({ key: "production.wh", label: t("Magazyn"), control: outBox("production.wh", esc(App.whName(this.whId()))), help: false })}
          ${field({ key: "production.rawProductId", label: t("Surowiec (ze stanu)"), req: true, span: "span2", control: selIn("production.rawProductId", [pick(t("wybierz surowiec"))].concat(S.products.filter(p => active(p) && (stock.get(p.id) || 0) > R.EPS || p.id === P_.rawProductId).map(p => ({ v: p.id, l: t("{p} — na stanie {q} {u}", { p: p.name, q: fmtQ(stock.get(p.id) || 0), u: Units.label(p.unit) }) }))), P_.rawProductId, { struct: true }) })}
          ${field({ key: "production.stock", label: t("Stan surowca"), control: outBox("production.stock", "—"), help: false })}
          ${field({ key: "production.outProductId", label: t("Produkt wyjściowy"), req: true, span: "span2", control: selIn("production.outProductId", [pick(t("wybierz produkt"))].concat(S.products.filter(active).map(p => ({ v: p.id, l: `${p.name} (${Units.label(p.unit)})` }))), P_.outProductId, { struct: true }) })}
          ${field({ key: "production.outQty", label: ou ? t("Ilość produkcji ({u})", { u: ou }) : t("Ilość produkcji"), req: true, control: numIn("production.outQty", P_.outQty, { suffix: ou, placeholder: eg("500") }) })}
          ${field({ key: "production.consume", label: ru ? t("Zużycie surowca ({u}) — auto", { u: ru }) : t("Zużycie surowca — auto"), control: outBox("production.consume", "—"), help: false })}
          ${field({ key: "production.after", label: t("Stan surowca po produkcji"), control: outBox("production.after", "—"), help: false })}
          ${field({ key: "production.orient", label: t("Masa ≈ t · energia ≈ GJ"), span: "span2", control: outBox("production.orient", "—"), help: false })}
          <div class="field" data-field="production.factor"><span class="lbl">${esc(t("Przelicznik"))}</span><output class="ctrl num-in out" data-out="production.factorTxt">—</output><div class="msg hidden" data-msg="production.factor" role="alert"></div></div>`;
      } else if (mode === "direct") {
        head = `
          ${field({ key: "production.rawProductId", label: t("Surowiec z lasu (nie ze stanu)"), req: true, span: "span2", control: selIn("production.rawProductId", [pick(t("wybierz surowiec"))].concat(woods.map(p => ({ v: p.id, l: `${p.name} (${Units.label(p.unit)})` }))), P_.rawProductId, { struct: true }) })}
          ${field({ key: "production.outProductId", label: t("Produkt wyjściowy"), req: true, span: "span2", control: selIn("production.outProductId", [pick(t("wybierz produkt"))].concat(outs.map(p => ({ v: p.id, l: p.name }))), P_.outProductId, { struct: true }) })}
          ${field({ key: "production.outQty", label: t("Wyprodukowano (MP)"), req: true, control: numIn("production.outQty", P_.outQty, { suffix: "MP", placeholder: eg("600") }) })}
          ${field({ key: "production.rawQty", label: t("Surowiec zużyty (m³) — auto"), control: outBox("production.rawQty", "—"), help: false })}
          ${field({ key: "production.rawCost", label: t("Koszt surowca (zł)"), span: "span2", control: numIn("production.rawCost", P_.rawCost, { suffix: "zł", placeholder: t("opcjonalnie") }) })}
          <div class="field span-all" data-field="production.factor"><div class="msg hidden" data-msg="production.factor" role="alert"></div></div>`;
      } else {
        const u = Units.label(d.purchase.unit);
        head = `${field({ key: "production.consumeQty", label: t("Zużycie surowca ({u})", { u }), span: "span2", control: numIn("production.consumeQty", P_.consumeQty, { suffix: u, placeholder: t("cały zakup") }) })}
          ${field({ key: "production.outQty", label: t("Wyprodukowano (MP)"), control: numIn("production.outQty", P_.outQty, { suffix: "MP", placeholder: t("auto: zużycie × 4") }) })}
          ${field({ key: "production.diffReason", label: t("Przyczyna różnicy"), control: selIn("production.diffReason", [pick(t("brak różnicy"))].concat(Object.entries(R.DIFF_REASONS).map(([k, v]) => ({ v: k, l: t(v) }))), P_.diffReason) })}`;
      }
      const origin = mode === "stock" ? "" : (P_.type === "lesna" ? `
          ${field({ key: "production.ndl", label: t("Nadleśnictwo"), req: true, control: textIn("production.ndl", P_.ndl, { placeholder: eg("Rudy Raciborskie"), list: "dl-ndl" }) })}
          ${field({ key: "production.lesnictwo", label: t("Leśnictwo"), req: true, control: textIn("production.lesnictwo", P_.lesnictwo, { placeholder: eg("Stanica") }) })}
          ${this.hasRuns() ? `<div class="field span2" data-field="production.kwit"><span class="lbl">${esc(t("Kwity wywozowe"))}</span><div class="info-line">${ic("receipt", 15)}<span>${t("Numery kwitów wywozowych, m³, MP i tony wpisujesz <b>w każdym kursie</b> w sekcji „Miejsce i transport”.")}</span></div></div>`
            : field({ key: "production.kwit", label: t("Nr kwitu wywozowego"), req: true, span: "span2", control: textIn("production.kwit", P_.kwit, { placeholder: eg("KW 0217/09/2026") }) + `<div class="help">${esc(t("Bez kursów transportu kwit wpisuje się tutaj. Przy transporcie własnym / zewnętrznym — w każdym kursie."))}</div>` })}` : `
          ${field({ key: "production.investSite", label: t("Miejsce wycinki / inwestycja"), req: true, span: "span2", control: textIn("production.investSite", P_.investSite, { placeholder: eg("Obwodnica Gliwic") }) })}
          ${field({ key: "production.sourceDoc", label: t("Nr dokumentu źródłowego"), span: "span2", control: textIn("production.sourceDoc", P_.sourceDoc, { placeholder: eg("Protokół wycinki 17/2026") }) })}`);
      return `<div class="fgrid four">
          ${mode !== "stock" ? field({ key: "production.type", label: t("Rodzaj produkcji"), req: true, span: "span2", control: selIn("production.type", Object.entries(R.PROD_TYPES).map(([k, v]) => ({ v: k, l: t(v.label) })), P_.type, { struct: true }) }) + "<div class=\"span2\"></div>" : ""}
          ${head}
          ${field({ key: "production.chipRate", label: t("Cena za rąbanie [zł/MP]"), control: numIn("production.chipRate", P_.chipRate, { suffix: "zł/MP", placeholder: fmt(10, 2) }) })}
          ${field({ key: "production.chipCost", label: t("Koszt rąbania"), control: outBox("production.chipCost", "—"), help: false })}
          ${origin}
          ${field({ key: "production.chipperId", label: t("Rębak (wybierz z Floty albo wpisz nowy)"), span: "span2", control: textIn("production.chipperName", this.chipperText(P_), { placeholder: t("opcjonalnie — wybierz z listy albo wpisz nazwę"), list: "dl-chippers" }) })}
          ${field({ key: "production.operatorId", label: chipper && chipper.owner === "external" ? t("Operator (firma zewnętrzna)") : t("Operator rębaka (wybierz albo wpisz nowego)"), span: "span2", control: textIn("production.operatorName", this.operatorText(P_, chipper), { placeholder: chipper && chipper.owner === "external" ? (chipper.operatorName || t("opcjonalnie")) : t("wybierz z listy albo wpisz imię i nazwisko"), list: "dl-operators" }) + (chipper && chipper.owner === "external" ? `<div class="help">${esc(t("Rębak firmy {c}{r}", { c: chipper.company || "—", r: chipper.reg ? " · " + chipper.reg : "" }))}</div>` : "") })}
        </div>
        <datalist id="dl-ndl">${["Rudy Raciborskie", "Rybnik", "Katowice", "Brynek", "Gliwice"].map(x => `<option value="${esc(x)}">`).join("")}</datalist>
        <datalist id="dl-chippers">${this.fleetOf("chippers", P_.chipperId).map(c => `<option value="${esc(this.chipLabel(c))}" label="${esc(c.status !== "aktywny" ? t("{s} — wróci do pracy", { s: t(R.ASSET_STATUS[c.status]) }) : c.owner === "external" ? t("Rębak firmy zewnętrznej") : t("Rębak własny"))}">`).join("")}</datalist>
        <datalist id="dl-operators">${this.fleetOf("operators", P_.operatorId).map(o => `<option value="${esc(o.name)}">`).join("")}</datalist>`;
    },
    chipperText(P_) { const c = R.byId(Store.state.fleet.chippers, P_.chipperId); return c ? this.chipLabel(c) : String(P_.chipperName || ""); },
    operatorText(P_, chipper) {
      if (chipper && chipper.owner === "external") return String(P_.operatorName || "");
      const o = R.byId(Store.state.fleet.operators, P_.operatorId || (!P_.operatorName && chipper ? chipper.operatorId : ""));
      return o ? o.name : String(P_.operatorName || "");
    },
    /** Operacje dodatkowe (holowanie, ładowarka…) — pole wyboru + pozycje z kartoteki; osobne rekordy z kosztem. */
    extrasHtml(n) {
      const S = Store.state, d = this.draft, X = this.extras(), on = !!X.enabled, corr = this.mode === "correct";
      const types = (S.extraTypes || []).filter(x => x.active !== false || X.items.some(i => i.typeId === x.id));
      const vehicles = S.fleet.vehicles.filter(v => (!v.whId || v.whId === this.whId() || X.items.some(i => i.vehicleId === v.id)));
      const rows = on ? X.items.map((it, i) => {
        const k = f => `extras.items.${i}.${f}`, ty = R.byId(S.extraTypes, it.typeId);
        const uLbl = ty && ty.unit ? t(R.EXTRA_UNITS[ty.unit] || ty.unit) : t("ilość");
        return `<div class="run-card" data-extra="${i}">
          <div class="run-h"><b>${esc(t("Operacja dodatkowa {n}", { n: i + 1 }))}</b><span class="spacer"></span><span class="run-cost" data-out="extra.${i}.cost">—</span>
            ${X.items.length > 1 ? `<button class="btn ghost sm" type="button" data-extra-del="${i}" aria-label="${esc(t("Usuń pozycję {n}", { n: i + 1 }))}">${ic("x", 14)}</button>` : ""}</div>
          <div class="fgrid four">
            ${field({ key: k("typeId"), label: t("Rodzaj operacji (Kartoteki → Dodatkowe operacje)"), req: true, span: "span2", help: false, control: selIn(k("typeId"), [pick(t("wybierz rodzaj"))].concat(types.map(x => ({ v: x.id, l: x.name + (x.active === false ? " — " + t("nieaktywny") : "") + (x.rate !== null && x.rate !== undefined ? ` · ${fmt(x.rate)} zł/${x.unit ? t(R.EXTRA_UNITS[x.unit] || x.unit) : t("ryczałt")}` : "") }))), it.typeId, { struct: true }) })}
            ${field({ key: k("vehicleId"), label: t("Pojazd z Floty (opcjonalnie)"), span: "span2", help: false, control: selIn(k("vehicleId"), [pick(t("bez pojazdu"))].concat(vehicles.map(v => ({ v: v.id, l: `${v.reg} · ${v.name}${v.status !== "aktywny" ? " — " + t(R.ASSET_STATUS[v.status]) : ""}`, disabled: v.status === "wycofany" && v.id !== it.vehicleId }))), it.vehicleId) })}
            ${field({ key: k("qty"), label: t("Ilość ({u})", { u: uLbl }), help: false, control: numIn(k("qty"), it.qty, { placeholder: t("opcjonalnie") }) })}
            ${field({ key: k("rate"), label: t("Stawka (zł)"), help: false, control: numIn(k("rate"), it.rate, { suffix: "zł", placeholder: ty && ty.rate !== null && ty.rate !== undefined ? fmt(ty.rate) : t("opcjonalnie") }) })}
            ${field({ key: k("cost"), label: t("Koszt (zł)"), req: true, help: false, control: numIn(k("cost"), it.cost, { suffix: "zł", placeholder: t("kwota albo ilość × stawka") }) })}
            ${field({ key: k("desc"), label: t("Opis"), help: false, control: textIn(k("desc"), it.desc, { placeholder: eg(t("Holowanie rębaka z drogi leśnej")) }) })}
          </div></div>`;
      }).join("") : "";
      return section(n, "extras", t("Operacje dodatkowe"), t("Prace towarzyszące operacji z kosztem — np. holowanie, rozładunek, podgarnianie pryzm, praca ładowarką."), `
        <div class="scope one" data-field="extras.enabled">${optCard("extras.enabled", { checked: on, disabled: false, title: t("Dodaj operację dodatkową"), text: t("Rodzaj z kartoteki, opcjonalnie pojazd z floty, koszt i opis. Każda pozycja jest osobnym zapisem powiązanym z tą operacją.") })}
          <div class="msg hidden" data-msg="extras.enabled" role="alert"></div></div>
        <div class="help tut">${t(HELP["extras.enabled"])}</div>
        ${on ? `<div class="runs" id="extras-list">${rows}</div>
          <div class="row wrap mt3"><button class="btn" type="button" id="extra-add" ${X.items.length >= R.MAX_EXTRAS ? "disabled" : ""}>${ic("plus", 15)} ${esc(t("Dodaj kolejną operację dodatkową"))}</button>
          <span class="dim" data-out="extras.total"></span></div>
          <div class="msg hidden" data-msg="extras.items" role="alert"></div>
          ${!types.length ? `<div class="info-line warn mt3">${ic("alert", 15)}<span>${esc(t("Kartoteka „Dodatkowe operacje” jest pusta — dodaj rodzaje w Kartoteki → Dodatkowe operacje."))}</span></div>` : ""}` : ""}
        ${corr ? "" : ""}`);
    },
    extras() {
      const d = this.draft;
      if (!d.extras || !Array.isArray(d.extras.items)) d.extras = { enabled: !!(d.extras && d.extras.enabled), items: [R.blankExtra()] };
      if (!d.extras.items.length) d.extras.items.push(R.blankExtra());
      return d.extras;
    },
    /** Numeracja dokumentów PZ / WZ / MM: lista „Automatycznie / Ręcznie”, przy ręcznej — pole numeru z podpowiedzią; data dokumentu. */
    docNoFields(types) {
      const d = this.draft, corr = this.mode === "correct";
      if (!d.docNos) d.docNos = { PZ: "", WZ: "", MM: "" };
      if (!d.docNoMode) d.docNoMode = {};
      const op = this.op, unified = R.unifiedNumbering(Store.state);
      // jedna seria WZ: jedno pole numeracji dla całej transakcji (zakup, produkcja, sprzedaż, MM…)
      if (unified) {
        const sn = R.seriesNoOf(d);
        if (!d.docNoMode.WZ) { d.docNoMode.WZ = sn.mode; if (sn.mode === "manual" && !String(d.docNos.WZ || "").trim()) d.docNos.WZ = sn.no; }
        types = [R.DOC_SERIES];
      }
      return types.map(ty => {
        const key = `docNos.${ty}`;
        if (corr) { const doc = op && (unified ? op.documents[0] : op.documents.find(x => x.type === ty)); return field({ key, label: t("Nr {t}", { t: ty }), help: false, control: outBox(key, esc(doc ? doc.no : "—")) }); }
        const sug = R.suggestDocNo(Store.state, ty, this.whId(), d.date), mode = R.docNoModeOf(d, ty);
        d.docNoMode[ty] = mode;
        const sel = field({ key: `docNoMode.${ty}`, label: t("Numeracja {t}", { t: ty }), req: true, help: false,
          control: selIn(`docNoMode.${ty}`, [{ v: "auto", l: t("Automatycznie — {s}", { s: sug }) }, { v: "manual", l: t("Ręcznie — wpisz numer") }], mode, { struct: true }) });
        if (mode !== "manual") return sel;
        return sel + field({ key, label: t("Nr {t} (ręcznie)", { t: ty }), req: true, control: textIn(key, d.docNos[ty], { placeholder: eg(`${ty}/11`) }) + `<div class="help">${t("Podpowiedź: <b>{s}</b>", { s: esc(sug) })} <button class="btn ghost sm" type="button" data-use-no="${ty}" data-no="${esc(sug)}">${esc(t("użyj"))}</button></div>` });
      }).join("") + field({ key: "docDate", label: t("Data dokumentu"), control: `<input class="ctrl" type="date" id="${fid("docDate")}" data-bind="docDate" value="${esc(d.docDate || "")}" max="${esc(App.today())}">` });
    },
    buyers(currentId) { return Store.state.partners.filter(p => (p.active !== false || p.id === currentId) && ["buyer", "both"].includes(p.role)); },
    saleOfOutputFields() {
      const d = this.draft;
      return `<div class="fgrid four">
        ${field({ key: "sale.buyerId", label: t("Odbiorca"), req: true, span: "span2", control: selIn("sale.buyerId", [pick(t("wybierz odbiorcę"))].concat(this.buyers(d.sale.buyerId).map(p => ({ v: p.id, l: p.name }))), d.sale.buyerId, { struct: true }) })}
        ${field({ key: "sale.qtyMP", label: t("Ilość sprzedaży (MP)"), control: numIn("sale.qtyMP", d.sale.qtyMP, { suffix: "MP", placeholder: t("cała produkcja") }) })}
        ${field({ key: "sale.weight", label: t("Masa · energia"), control: outBox("sale.weight", "—"), help: false })}
        ${this.saleWeightFields()}
        ${field({ key: "sale.price", label: t("Cena sprzedaży (zł/{u})", { u: d.sale.priceUnit }), req: true, control: numIn("sale.price", d.sale.price, { suffix: `zł/${d.sale.priceUnit}`, placeholder: eg("90") }) })}
        ${field({ key: "sale.priceUnit", label: t("Cena za"), control: selIn("sale.priceUnit", [{ v: "MP", l: "MP" }, { v: "t", l: t("t (tonę)") }], d.sale.priceUnit, { struct: true }) })}
        ${field({ key: "sale.revenue", label: t("Przychód ze sprzedaży"), span: "span2", control: outBox("sale.revenue", "—"), help: false })}
      </div>`;
    },

    /** Tonaż sprzedaży: AUTO (przelicznik) / RĘCZNY (waga) — prezentacja „60 MP | 19,80 t | AUTO”. */
    saleWeightFields() {
      const d = this.draft, m = d.sale.weightMode === "manual" ? "manual" : "auto";
      return `${field({ key: "sale.weightMode", label: t("Tonaż"), req: true, control: selIn("sale.weightMode", [{ v: "auto", l: t("Automatyczny / przelicznik firmowy") }, { v: "manual", l: t("Ręczny — z wagi rzeczywistej") }], m, { struct: true }) })}
        ${m === "manual" ? field({ key: "sale.weightManual", label: t("Tonaż z wagi (t)"), req: true, control: numIn("sale.weightManual", d.sale.weightManual, { suffix: "t", placeholder: eg(fmt(20.35, 2)) }) })
          : field({ key: "sale.weightAuto", label: t("Tonaż wyliczony"), control: outBox("sale.weightAuto", "—"), help: false })}
        ${field({ key: "sale.tonLine", label: t("Ilość | tonaż | źródło"), span: "span2", control: outBox("sale.tonLine", "—"), help: false })}`;
    },
    sectionsHtml() {
      const S = Store.state, d = this.draft, wh = R.byId(S.warehouses, this.whId());
      const type = d.type, corr = this.mode === "correct";
      const active = p => p.active !== false;
      const typeCard = (tt, title, text) => optCard("", { checked: type === tt, disabled: corr, struct: false, radio: true, id: `f-type-${tt}`, title, text, attrs: `data-type="${tt}"` });
      let n = 1;
      const receipt = d.type !== "SPRZEDAZ";   // zakup, produkcja, MM — „Data przyjęcia” (dzień przyjęcia towaru na magazyn)
      let html = section(n++, "type", corr ? t("Korygowany dokument") : t("Rodzaj operacji"), corr ? t("Rodzaju operacji, magazynu i daty dokumentu nie zmienia się korektą — w razie potrzeby anuluj dokument i wprowadź nowy.") : t("Każdy rodzaj działa samodzielnie — wypełniasz tylko to, co jest potrzebne."), `
        <div class="scope four" role="group" aria-label="${esc(t("Rodzaj operacji"))}">
          ${typeCard("ZAKUP", t("Zakup"), t("Dostawca → magazyn. Opcjonalnie produkcja i sprzedaż bezpośrednia z lasu."))}
          ${typeCard("SPRZEDAZ", t("Sprzedaż"), t("Magazyn → odbiorca albo sprzedaż bezpośrednia po produkcji w lesie."))}
          ${typeCard("PRODUKCJA", t("Produkcja na magazynie"), t("Surowiec ze stanu → produkt na stanie. Bez transportu."))}
          ${typeCard("MM", t("Przesunięcie MM"), t("Magazyn → inny magazyn firmy. Stan firmy bez zmian."))}
        </div>
        <div class="info-line mt3">${ic("layers", 15)}<span>${corr ? t("Magazyn: <b>{w}</b> — magazyn dokumentu.", { w: esc(wh ? wh.name : "—") }) : type === "MM" ? t("Magazyn źródłowy i docelowy wybierasz w sekcji przesunięcia.") : t("Magazyn: <b>{w}</b> — wynika z zalogowanego użytkownika ({u}).", { w: esc(wh ? wh.name : "—"), u: esc(App.user().name) })}</span></div>
        <div class="fgrid four mt4">${field({ key: "date", label: receipt ? t("Data przyjęcia") : t("Data operacji"), req: true, help: receipt ? N_("Wprowadź datę przyjęcia produktu na magazyn.") : true, control: `<input class="ctrl" type="date" id="${fid("date")}" data-bind="date" value="${esc(d.date)}" max="${esc(App.today())}" ${corr ? "disabled" : ""}>` })}</div>`);

      if (type === "ZAKUP") {
        const prod = App.product(d.purchase.productId);
        const isWood = prod && prod.cat === "drewno";
        const sKind = this.supplierKind();
        const suppliers = S.partners.filter(p => (p.active !== false || p.id === d.purchase.supplierId) && ["supplier", "both"].includes(p.role) && R.partnerKind(p) === sKind);
        const kindCard = (k, text) => optCard("", { checked: sKind === k, struct: false, radio: true, id: `f-skind-${k}`, title: t(R.SUPPLIER_KINDS[k].label), text, attrs: `data-skind="${k}"` });
        const units = prod ? Units.allowed(prod) : Units.LIST;
        const u = Units.label(d.purchase.unit), pu = Units.label(d.purchase.priceUnit || d.purchase.unit);
        // 1) zakres zakupu: produkcja i sprzedaż bezpośrednia z lasu — wybierane przed grupą dostawcy
        const legacySale = d.sale.enabled && !d.sale.direct;
        const directOn = d.sale.enabled && !!d.sale.direct;
        html += section(n++, "purchase", t("Zakup"), t("Najpierw zakres zakupu, potem dostawca, produkt, ilość i cena."), `
          <div class="field span-all" data-field="purchase.scope"><span class="lbl">${esc(t("Zakres zakupu (opcjonalnie)"))}</span>
          <div class="scope two mb3" role="group" aria-label="${esc(t("Zakres zakupu"))}">
            ${optCard("production.enabled", { checked: d.production.enabled, disabled: corr, title: t("+ Produkcja z automatycznym zużyciem"), text: t("Zużycie zakupionego drewna (RW) i przyjęcie zrębki (PW) w tej samej operacji. Produkt zakupu: drewno.") })}
            ${legacySale
              ? optCard("sale.enabled", { checked: true, disabled: corr, title: t("+ Sprzedaż wyniku produkcji"), text: t("Wydanie zrębki z tej produkcji do odbiorcy (WZ).") })
              : optCard("sale.direct", { checked: directOn, disabled: corr, title: t("+ Sprzedaż bezpośrednia z lasu (bez magazynowania)"), text: t("las → produkcja → odbiorca. Zrębka z tej produkcji trafia od razu do odbiorcy i nie zwiększa stanu magazynu. Włącza produkcję.") })}
          </div></div>
          <div class="fgrid four">
            <div class="field span-all" data-field="purchase.supplierKind"><span class="lbl">${esc(t("Dostawca — wybierz grupę"))} <span class="req" aria-hidden="true">*</span></span>
              <div class="scope two" role="group" aria-label="${esc(t("Grupa dostawcy"))}">${kindCard("firma", t("Tartaki, zakłady i firmy leśne. Podstawa domyślnie: KZR."))}${kindCard("nadlesnictwo", t("Lasy Państwowe. Podstawa domyślnie: Deklaracja. Dodatkowo: leśnictwo."))}</div>
              <div class="help tut">${t(HELP["purchase.supplierKind"])}</div></div>
            ${field({ key: "purchase.supplierName", label: sKind === "nadlesnictwo" ? t("Nadleśnictwo") : t("Dostawca (firma)"), req: true, span: "span2", control: textIn("purchase.supplierName", this.supplierText(), { placeholder: sKind === "nadlesnictwo" ? t("wpisz lub wybierz, np. Nadleśnictwo Rybnik") : t("wpisz lub wybierz, np. Lander Agro"), list: "dl-suppliers" }) + `<datalist id="dl-suppliers">${suppliers.map(p => `<option value="${esc(p.name)}">`).join("")}</datalist>` })}
            ${sKind === "nadlesnictwo" ? field({ key: "purchase.lesnictwo", label: t("Leśnictwo"), req: true, control: textIn("purchase.lesnictwo", d.purchase.lesnictwo, { placeholder: t("wybierz lub wpisz nowe"), list: "dl-lesn" }) + `<datalist id="dl-lesn">${this.lesnictwa(d.purchase.supplierId).map(x => `<option value="${esc(x)}">`).join("")}</datalist>` }) : ""}
            ${field({ key: "purchase.basis", label: t("Podstawa"), req: true, span: sKind === "nadlesnictwo" ? "" : "span2", control: selIn("purchase.basis", [{ v: "DEKL", l: t("Deklaracja") }, { v: "KZR", l: "KZR" }], d.purchase.basis) })}
            ${field({ key: "purchase.productId", label: t("Produkt / surowiec"), req: true, span: "span2", control: selIn("purchase.productId", [pick(t("wybierz produkt"))].concat(S.products.filter(p => (active(p) || p.id === d.purchase.productId) && (!d.production.enabled || p.cat === "drewno" || p.id === d.purchase.productId)).map(p => ({ v: p.id, l: `${p.name} (${Units.label(p.unit)})` }))), d.purchase.productId, { struct: true, disabled: corr }) })}
            ${field({ key: "purchase.qty", label: t("Ilość"), req: true, control: numIn("purchase.qty", d.purchase.qty, { suffix: u, placeholder: eg("20") }) })}
            ${field({ key: "purchase.unit", label: t("Jednostka ilości"), req: true, control: selIn("purchase.unit", units.map(x => ({ v: x, l: Units.label(x) })), d.purchase.unit, { struct: true }) })}
            ${field({ key: "purchase.priceUnit", label: t("Jednostka zakupu (cena za)"), req: true, control: selIn("purchase.priceUnit", units.map(x => ({ v: x, l: Units.label(x) })), d.purchase.priceUnit || d.purchase.unit, { struct: true }) })}
            ${field({ key: "purchase.price", label: t("Cena jednostkowa (zł/{u})", { u: pu }), req: true, control: numIn("purchase.price", d.purchase.price, { suffix: `zł/${pu}`, placeholder: eg("230") }) })}
            ${field({ key: "purchase.cost", label: t("Koszt całkowity zakupu"), control: outBox("purchase.cost", "—"), help: false })}
            ${field({ key: "purchase.weightMode", label: t("Masa"), req: true, control: selIn("purchase.weightMode", [{ v: "auto", l: t("Orientacyjna (przelicznik)") }, { v: "manual", l: t("Ręczna — waga rzeczywista") }], d.purchase.weightMode, { struct: true }) })}
            ${d.purchase.weightMode === "manual"
              ? field({ key: "purchase.weightManual", label: t("Waga rzeczywista (t)"), req: true, control: numIn("purchase.weightManual", d.purchase.weightManual, { suffix: "t", placeholder: eg(fmt(19.2, 2)) }) })
              : field({ key: "purchase.weightAuto", label: t("Masa · energia (orientacyjnie)"), control: outBox("purchase.weightAuto", "—"), help: false })}
            ${this.docNoFields(d.sale.enabled ? ["PZ", "WZ"] : ["PZ"])}
          </div>`);
        html += d.production.enabled ? section(n++, "prod", t("Produkcja z automatycznym zużyciem"), t("Zakupione drewno jest od razu dostępne do pobrania. Kolejność: zakup → zużycie → produkcja."), this.productionFields("chain")) : "";
        html += d.sale.enabled ? (directOn
          ? section(n++, "sale", t("Sprzedaż bezpośrednia z lasu"), t("Zrębka z tej produkcji trafia od razu do odbiorcy — bez przyjęcia na magazyn. Sprzedaż nie może przekroczyć produkcji."), this.saleOfOutputFields())
          : section(n++, "sale", t("Sprzedaż wyniku produkcji"), t("Sprzedajemy zrębkę z tej produkcji. Zmniejsza stan zrębki."), this.saleOfOutputFields())) : "";
      } else if (type === "SPRZEDAZ") {
        const direct = !!d.sale.direct;
        const toggle = `<div class="scope one mb3">${optCard("sale.direct", { checked: direct, disabled: corr, title: t("Sprzedaż bezpośrednia po produkcji / prosto z lasu"), text: t("las → produkcja → sprzedaż → odbiorca. Towar NIE jest pobierany z magazynu i nie zwiększa stanu.") })}</div>`;
        if (!direct) {
          const stock = Stock.byProduct(corr ? Object.assign({}, S, { ledger: S.ledger.filter(l => l.opId !== this.op.id) }) : S, this.whId());
          const prods = S.products.filter(p => (stock.get(p.id) || 0) > R.EPS || p.id === d.sale.productId);
          const prod = App.product(d.sale.productId);
          const units = prod ? Units.allowed(prod) : [];
          const u = Units.label(d.sale.unit);
          html += section(n++, "sale", t("Sprzedaż z magazynu (WZ)"), t("Towar, który już jest na stanie → odbiorca. WZ odejmuje sprzedaną ilość ze stanu."), toggle + `
            <div class="fgrid four">
              ${field({ key: "sale.productId", label: t("Towar z magazynu"), req: true, span: "span2", control: selIn("sale.productId", [pick(t("wybierz towar"))].concat(prods.map(p => ({ v: p.id, l: `${p.name} — ${fmtQ(stock.get(p.id) || 0)} ${Units.label(p.unit)}` }))), d.sale.productId, { struct: true, disabled: corr }) })}
              ${field({ key: "sale.onStock", label: t("Stan dostępny"), control: outBox("sale.onStock", "—"), help: false })}
              ${field({ key: "sale.after", label: t("Stan po WZ"), control: outBox("sale.after", "—"), help: false })}
              ${field({ key: "sale.qty", label: t("Ilość"), req: true, control: numIn("sale.qty", d.sale.qty, { suffix: u, placeholder: eg("500") }) })}
              ${field({ key: "sale.unit", label: t("Jednostka"), req: true, control: prod ? selIn("sale.unit", units.map(x => ({ v: x, l: Units.label(x) })), d.sale.unit, { struct: true }) : outBox("sale.unit", esc(t("wybierz towar"))) })}
              ${field({ key: "sale.price", label: t("Cena sprzedaży (zł/{u})", { u }), req: true, control: numIn("sale.price", d.sale.price, { suffix: `zł/${u}`, placeholder: eg("90") }) })}
              ${field({ key: "sale.revenue", label: t("Wartość sprzedaży"), control: outBox("sale.revenue", "—"), help: false })}
              ${field({ key: "sale.buyerId", label: t("Kupujący / odbiorca"), req: true, span: "span2", control: selIn("sale.buyerId", [pick(t("wybierz odbiorcę"))].concat(this.buyers(d.sale.buyerId).map(p => ({ v: p.id, l: p.name }))), d.sale.buyerId, { struct: true }) })}
              ${field({ key: "sale.weight", label: t("Masa · energia (orientacyjnie)"), span: "span2", control: outBox("sale.weight", "—"), help: false })}
              ${this.saleWeightFields()}
              ${this.docNoFields(["WZ"])}
            </div>`);
        } else {
          html += section(n++, "sale", t("Sprzedaż bezpośrednia"), t("las → produkcja → sprzedaż. Bez zakupu i bez pobierania z magazynu."), toggle);
          html += section(n++, "prod", t("Produkcja (w lesie)"), t("Surowiec, produkt i ilość. Zużycie surowca liczy system (MP ÷ 4 = m³)."), this.productionFields("direct"));
          html += section(n++, "sale2", t("Odbiorca i cena"), t("Sprzedaż nie może przekroczyć ilości wyprodukowanej."), this.saleOfOutputFields() + `<div class="fgrid four mt3">${this.docNoFields(["WZ"])}</div>`);
        }
      } else if (type === "PRODUKCJA") {
        html += section(n++, "prod", t("Produkcja na magazynie"), t("Podajesz ilość wyprodukowaną — zużycie surowca liczy system (MP ÷ 4 = m³). Bez zakupu, bez transportu, bez odbiorcy."), this.productionFields("stock"));
      } else if (type === "MM") {
        const M = d.mm;
        const stock = Stock.byProduct(corr ? Object.assign({}, S, { ledger: S.ledger.filter(l => l.opId !== this.op.id) }) : S, this.whId());
        const prods = S.products.filter(p => (stock.get(p.id) || 0) > R.EPS || p.id === M.productId);
        const prod = App.product(M.productId);
        const u = Units.label(M.unit);
        const src = this.whId(), wMode = M.weightMode === "manual" ? "manual" : "auto";
        const twoStage = corr ? !!(this.op.mm && this.op.mm.twoStage) : R.mmMode(S.config) === "two";
        const srcList = corr ? S.warehouses.filter(w => w.id === src) : this.sourceWarehouses(src);
        const dstList = S.warehouses.filter(w => w.active !== false || w.id === M.toWhId);
        html += section(n++, "mm", t("Przesunięcie międzymagazynowe (MM)"), twoStage
          ? t("Wysłanie z magazynu źródłowego; magazyn docelowy przyjmuje towar przyciskiem „Przyjmij MM”.")
          : t("Rozchód z magazynu źródłowego i przychód w docelowym — jednym dokumentem MM."), `
          <div class="info-line ${twoStage ? "warn" : ""} mb3" id="mm-mode-info">${ic(twoStage ? "truck" : "swap", 15)}<span>${twoStage
            ? t("Tryb <b>dwuetapowy</b>: po zatwierdzeniu towar schodzi ze stanu źródła, a dokument ma status <b>W DRODZE</b>. Stan magazynu docelowego wzrośnie dopiero po przyjęciu MM (z ilością faktycznie przyjętą).")
            : t("Tryb <b>jednoetapowy</b>: zatwierdzenie jednocześnie zmniejsza stan źródła i zwiększa stan magazynu docelowego.")}</span></div>
          <div class="fgrid four">
            ${field({ key: "mm.fromWhId", label: t("Magazyn źródłowy"), req: true, control: selIn("mm.fromWhId", srcList.map(w => ({ v: w.id, l: w.name })), src, { struct: true, disabled: corr || srcList.length < 2 && srcList.some(w => w.id === src) }) })}
            ${field({ key: "mm.toWhId", label: t("Magazyn docelowy"), req: true, control: selIn("mm.toWhId", [pick(t("wybierz magazyn"))].concat(dstList.map(w => ({ v: w.id, l: w.id === src ? `${w.name} — ${t("magazyn źródłowy")}` : w.name }))), M.toWhId, { struct: true, disabled: corr }) })}
            ${field({ key: "mm.productId", label: t("Towar"), req: true, span: "span2", control: selIn("mm.productId", [pick(t("wybierz towar"))].concat(prods.map(p => ({ v: p.id, l: `${p.name} — ${fmtQ(stock.get(p.id) || 0)} ${Units.label(p.unit)}` }))), M.productId, { struct: true, disabled: corr }) })}
            ${field({ key: "mm.qty", label: t("Ilość"), req: true, control: numIn("mm.qty", M.qty, { suffix: u, placeholder: eg("300") }) })}
            ${field({ key: "mm.unit", label: t("Jednostka"), req: true, control: prod ? selIn("mm.unit", Units.allowed(prod).map(x => ({ v: x, l: Units.label(x) })), M.unit, { struct: true }) : outBox("mm.unit", esc(t("wybierz towar"))) })}
            ${field({ key: "mm.weightMode", label: t("Tonaż"), req: true, control: selIn("mm.weightMode", [{ v: "auto", l: t("Automatyczny (przelicznik)") }, { v: "manual", l: t("Ręczny — z kwitu wagowego") }], wMode, { struct: true }) })}
            ${wMode === "manual"
              ? field({ key: "mm.weightManual", label: t("Tonaż z wagi (t)"), req: true, control: numIn("mm.weightManual", M.weightManual, { suffix: "t", placeholder: eg(fmt(16.4, 2)) }) })
              : field({ key: "mm.weightAuto", label: t("Tonaż wyliczony"), control: outBox("mm.weightAuto", "—"), help: false })}
            ${field({ key: "mm.srcBal", label: t("Źródło: stan przed → po"), span: "span2", control: outBox("mm.srcBal", "—"), help: false })}
            ${field({ key: "mm.dstBal", label: twoStage ? t("Cel: stan teraz → po przyjęciu") : t("Cel: stan przed → po"), span: "span2", control: outBox("mm.dstBal", "—"), help: false })}
            ${this.docNoFields(["MM"])}
          </div>`);
      }

      html += this.extrasHtml(n++); // operacje dodatkowe — w każdym rodzaju operacji
      if (type !== "PRODUKCJA") html += this.transportHtml(n++);
      html += section(n++, "notes", t("Uwagi i dokument zewnętrzny"), "", `<div class="fgrid four">
        ${field({ key: "extDoc", label: t("Nr dokumentu zewnętrznego"), span: "span2", control: textIn("extDoc", d.extDoc, { placeholder: t("np. FV 123/09/2026, kwit wagowy") }) })}
        ${field({ key: "notes", label: t("Uwagi do operacji"), span: "span2", control: `<textarea class="ctrl" id="${fid("notes")}" data-bind="notes" rows="2">${esc(d.notes)}</textarea>` })}</div>`);
      return html;
    },

    transportHtml(n) {
      const S = Store.state, T = this.draft.transport, mode = T.mode;
      const tr = T.train;
      const useOwn = mode === "own" || mode === "mixed", useExt = mode === "external" || mode === "mixed";
      const forest = this.isForest();
      const runsHint = `<div class="help">${esc(t("Podaj liczbę kursów — rubryki pojawią się automatycznie."))}</div>`;
      let modeHtml = "";
      if (mode === "supplier") modeHtml += `<div class="info-line mt4">${ic("truck", 15)}<span>${esc(t("Transport zapewnia dostawca {c} — koszt jest wliczony w cenę zakupu; operacja nie ma dokumentu TR ani kosztu transportu.", { c: this.supplierText() || t("(wpisz dostawcę)") }))}</span></div>`;
      if (useOwn) {
        const O = this.ownRuns();
        const count = Math.max(0, Math.min(50, Math.floor(NumParse.value(O.runCount, 0)) || 0));
        const u = Units.label(this.shippedUnit());
        // 3.11: pojazd i kierowca — wybór z kartoteki (także wcześniej używane / wycofane) albo wpisanie nowego (jak w firmach zewnętrznych)
        const ownVeh = this.fleetOf("vehicles", null).filter(v => v.owner !== "external");
        const ownVehList = `<datalist id="dl-own-veh">${ownVeh.map(v => `<option value="${esc(this.vehLabel(v))}" label="${esc(v.status !== "aktywny" ? t("{s} — wróci do pracy", { s: t(R.ASSET_STATUS[v.status]) }) : t("na stanie"))}">`).join("")}</datalist>
          <datalist id="dl-drivers">${this.fleetOf("drivers", null).map(x => `<option value="${esc(x.name)}">`).join("")}</datalist>`;
        const runs = [];
        for (let i = 0; i < count; i++) {
          const r = O.runs[i] || R.blankRun(), veh = R.byId(S.fleet.vehicles, r.vehicleId), k = f => `transport.own.runs.${i}.${f}`;
          runs.push(`<div class="run-card" data-run="${i}">
            <div class="run-h"><b>${esc(t("Kurs {n}", { n: i + 1 }))}</b><span class="spacer"></span><span class="run-cost" data-out="run.${i}.cost">—</span><button class="btn ghost sm run-dup" type="button" data-run-dup="own.${i}" title="${esc(t("Dodaj kolejny kurs z tym samym pojazdem, kierowcą, km i stawką — bez kwitu i wagi"))}">${ic("plus", 13)} ${esc(t("+1 jak ten"))}</button></div>
            <div class="fgrid four">
              ${field({ key: k("vehicleId"), label: t("Pojazd floty własnej (wybierz albo wpisz nr rej.)"), req: true, span: "span2", help: false, control: textIn(k("vehicleReg"), this.vehText(r), { placeholder: t("wybierz z listy albo wpisz nowy, np. WGM 12345"), list: "dl-own-veh" }) })}
              ${field({ key: k("driverId"), label: t("Kierowca (wybierz albo wpisz nowego)"), req: true, span: "span2", help: false, control: textIn(k("driverName"), this.driverText(r, veh), { placeholder: t("wybierz z listy albo wpisz imię i nazwisko"), list: "dl-drivers" }) })}
              ${field({ key: k("kwit"), label: forest ? t("Nr kwitu wywozowego") : t("Nr kwitu wagowego"), req: forest, help: false, control: textIn(k("kwit"), r.kwit, { placeholder: forest ? eg("KW 0217/09/2026") : t("opcjonalnie — z wagi") }) })}
              ${forest ? field({ key: k("kwitM3"), label: t("m³ z kwitu"), help: false, control: numIn(k("kwitM3"), r.kwitM3, { suffix: "m³", placeholder: eg("25") }) }) : ""}
              ${field({ key: k("qty"), label: forest ? t("MP na aucie (m³ × 4)") : t("Ilość w kursie ({u})", { u }), req: count > 1, help: false, control: numIn(k("qty"), r.qty, { suffix: u, placeholder: forest ? t("auto z m³") : count > 1 ? eg("100") : t("cała ilość") }) })}
              ${field({ key: k("weightT"), label: forest ? t("Tony (z kwitu / wagi)") : t("Waga rzeczywista (t)"), help: false, control: numIn(k("weightT"), r.weightT, { suffix: "t", placeholder: forest ? t("z kwitu") : t("z kwitu wagowego") }) })}
              ${field({ key: k("km"), label: t("Kilometry"), req: true, help: false, control: numIn(k("km"), r.km, { suffix: "km", placeholder: eg("45") }) })}
              ${field({ key: k("rate"), label: t("Stawka (zł/km)"), help: false, control: numIn(k("rate"), r.rate, { suffix: "zł/km", placeholder: fmtQ(S.config.kmRateDefault) }) })}
            </div></div>`);
        }
        modeHtml += `${mode === "mixed" ? `<h4 class="mini-h mt4">${esc(t("Kursy floty własnej"))}</h4>` : ""}<div class="fgrid four mt4">
          ${field({ key: "transport.own.runCount", label: t("Liczba kursów"), req: true, control: numIn("transport.own.runCount", O.runCount, { suffix: t("szt."), placeholder: eg("4") }) })}
          <div class="field span3"><span class="lbl">&nbsp;</span><div class="help">${esc(t("Każdy kurs: pojazd z floty własnej, kierowca (domyślny z pojazdu, można zmienić dla kursu), km, stawka, ilość i waga z wagi rzeczywistej. Koszt = km × stawka, sumowany dla wszystkich kursów."))}</div></div>
        </div>
        <div class="runs" id="own-runs">${runs.join("") || runsHint}</div>${count ? `<div class="row wrap mt3"><button class="btn" type="button" data-run-dup="own.last" id="own-run-plus">${ic("plus", 15)} ${esc(t("+1 kurs jak poprzedni"))}</button><span class="dim">${esc(t("ten sam pojazd, kierowca, km i stawka — wpisz tylko kwit i wagę"))}</span></div>` : ""}${ownVehList}`;
      }
      if (useExt) {
        const X = this.extRuns();
        const count = Math.max(0, Math.min(50, Math.floor(NumParse.value(X.runCount, 0)) || 0));
        const u = Units.label(this.shippedUnit()), inc = !!X.includedInPrice;
        const coCount = this.extCompanyCount(), multiCo = coCount > 1;
        const runs = [];
        for (let i = 0; i < count; i++) {
          const r = X.runs[i] || R.blankExtRun(), k = f => `transport.external.runs.${i}.${f}`;
          runs.push(`<div class="run-card" data-xrun="${i}">
            <div class="run-h"><b>${esc(t("Kurs {n}", { n: i + 1 }))}</b><span class="spacer"></span><span class="run-cost" data-out="xrun.${i}.cost">—</span><button class="btn ghost sm run-dup" type="button" data-run-dup="external.${i}" title="${esc(t("Dodaj kolejny kurs z tym samym pojazdem, kierowcą, km i stawką — bez kwitu i wagi"))}">${ic("plus", 13)} ${esc(t("+1 jak ten"))}</button></div>
            <div class="fgrid four">
              ${multiCo ? field({ key: k("company"), label: t("Firma transportowa"), req: true, span: "span2", help: false, control: textIn(k("company"), r.company, { placeholder: t("wybierz z listy albo wpisz nową firmę"), list: "dl-carriers" }) }) : ""}
              ${field({ key: k("reg"), label: t("Nr rejestracyjny"), req: true, help: false, control: textIn(k("reg"), r.reg, { placeholder: eg("ESI 18734"), list: "dl-ext-veh" }) })}
              ${field({ key: k("driver"), label: t("Kierowca"), help: false, control: textIn(k("driver"), r.driver, { placeholder: t("imię i nazwisko") }) })}
              ${field({ key: k("kwit"), label: forest ? t("Nr kwitu wywozowego") : t("Nr kwitu wagowego"), req: forest, help: false, control: textIn(k("kwit"), r.kwit, { placeholder: forest ? eg("KW 0217/09/2026") : t("opcjonalnie — z wagi") }) })}
              ${forest ? field({ key: k("kwitM3"), label: t("m³ z kwitu"), help: false, control: numIn(k("kwitM3"), r.kwitM3, { suffix: "m³", placeholder: eg("25") }) }) : ""}
              ${field({ key: k("qty"), label: forest ? t("MP na aucie (m³ × 4)") : t("Ilość w kursie ({u})", { u }), req: count > 1, help: false, control: numIn(k("qty"), r.qty, { suffix: u, placeholder: forest ? t("auto z m³") : count > 1 ? eg("100") : t("cała ilość") }) })}
              ${field({ key: k("weightT"), label: forest ? t("Tony (z kwitu / wagi)") : t("Waga rzeczywista (t)"), help: false, control: numIn(k("weightT"), r.weightT, { suffix: "t", placeholder: forest ? t("z kwitu") : t("z kwitu wagowego") }) })}
              ${field({ key: k("km"), label: t("Kilometry"), req: !inc && str(r.freight) === "", help: false, control: numIn(k("km"), r.km, { suffix: "km", placeholder: eg("80") }) })}
              ${field({ key: k("rate"), label: t("Stawka (zł/km)"), help: false, control: numIn(k("rate"), r.rate, { suffix: "zł/km", placeholder: fmtQ(S.config.kmRateDefault) }) })}
              ${inc ? "" : field({ key: k("freight"), label: t("Fracht kursu (zł) — opcjonalnie"), span: "span2", help: false, control: numIn(k("freight"), r.freight, { suffix: "zł", placeholder: t("z faktury; puste = km × stawka") }) })}
            </div></div>`);
        }
        // flota zewnętrzna: pojazdy firm przewozowych z kartoteki — podpowiedzi numerów (najpierw wybranej firmy)
        const extVeh = this.extVehicles(multiCo ? "" : X.company);
        const carriers = this.extCompanies();
        const coSel = field({ key: "transport.external.companyCount", label: t("Liczba firm przewidzianych do transportu"), req: true, span: "span2",
          control: selIn("transport.external.companyCount", Array.from({ length: R.MAX_EXT_COMPANIES }, (_, i) => ({ v: String(i + 1), l: String(i + 1) })), String(coCount), { struct: true }) });
        modeHtml += `${mode === "mixed" ? `<h4 class="mini-h mt4">${esc(t("Kursy firmy zewnętrznej"))}</h4>` : ""}<datalist id="dl-ext-veh">${extVeh.map(v => `<option value="${esc(v.reg)}" label="${esc(`${v.company} · ${v.name}${v.driverName ? " · " + v.driverName : ""}`)}">`).join("")}</datalist><div class="fgrid four mt4">
          ${coSel}
          ${field({ key: "transport.external.runCount", label: t("Liczba kursów"), req: true, control: numIn("transport.external.runCount", X.runCount, { suffix: t("szt."), placeholder: eg("4") }) })}
          <div></div>
          ${multiCo ? `<div class="field span-all"><div class="help">${esc(t("Kilka firm: w każdym kursie wybierz firmę z listy albo wpisz nową nazwę."))}</div></div>`
            : field({ key: "transport.external.company", label: t("Firma transportowa"), req: true, span: "span2", control: textIn("transport.external.company", X.company, { placeholder: eg("ESI Logistics"), list: "dl-carriers" }) })}
          <datalist id="dl-carriers">${carriers.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
          <div class="field span-all" data-field="transport.external.includedInPrice">
            ${optCard("transport.external.includedInPrice", { checked: inc, title: t("Transport wliczony w cenę"), text: t("Koszt transportu tej operacji = 0 zł (kursy i ilości nadal są ewidencjonowane).") })}</div>
        </div>
        <div class="runs" id="ext-runs">${runs.join("") || runsHint}</div>${count ? `<div class="row wrap mt3"><button class="btn" type="button" data-run-dup="external.last" id="external-run-plus">${ic("plus", 15)} ${esc(t("+1 kurs jak poprzedni"))}</button><span class="dim">${esc(t("ten sam pojazd, kierowca, km i stawka — wpisz tylko kwit i wagę"))}</span></div>` : ""}`;
      }
      if (useOwn || useExt) modeHtml += `<div class="row wrap mt3 scale-row"><button class="btn" type="button" id="scale-import">${ic("scale", 15)} ${esc(t("Wczytaj kwity z wagi"))}</button><span class="dim">${esc(t("plik z programu wagi, kod QR / czytnik albo aparat — numer kwitu, waga netto i nr rej. wpiszą się do kursów"))}</span></div>`;
      if (useOwn || useExt) modeHtml += `<div class="field mt3" data-field="transport.runs"><span class="lbl">${esc(mode === "mixed" ? t("Podsumowanie kursów (flota własna + firma zewnętrzna)") : t("Podsumowanie kursów"))}</span><div data-out="runs.summary"></div><div class="msg hidden" data-msg="transport.runs" role="alert"></div></div>`;
      if (mode === "train") {
        const count = Math.max(0, Math.min(S.config.maxWagons, Math.floor(NumParse.value(tr.wagonCount, 0)) || 0));
        const each = tr.tonMode === "each";
        const rows = [];
        if (each) for (let i = 0; i < count; i++) {
          const k = `transport.train.wagonT.${i}`;
          rows.push(`<tr data-field="${k}"><td class="c"><b>${i + 1}</b></td><td>${numIn(k, (tr.wagonT || [])[i] || "", { suffix: "t", placeholder: eg(fmt(58.4, 1)) })}<div class="msg hidden" data-msg="${k}" role="alert"></div></td></tr>`);
        }
        modeHtml = `<div class="fgrid four mt4">
          ${field({ key: "transport.train.trainNo", label: t("Nr składu"), control: textIn("transport.train.trainNo", tr.trainNo, { placeholder: eg("RC 50931") }) })}
          ${field({ key: "transport.train.carrier", label: t("Przewoźnik kolejowy"), control: textIn("transport.train.carrier", tr.carrier, { placeholder: eg("PKP Cargo") }) })}
          ${field({ key: "transport.train.docNo", label: t("Nr dokumentu przewozowego"), control: textIn("transport.train.docNo", tr.docNo, { placeholder: eg("CIM 5093/09") }) })}
          ${field({ key: "transport.train.loadPlace", label: t("Miejsce załadunku"), control: textIn("transport.train.loadPlace", tr.loadPlace, { placeholder: eg("Bocznica Gliwice") }) })}
          ${field({ key: "transport.train.wagonCount", label: t("Liczba wagonów"), req: true, control: numIn("transport.train.wagonCount", tr.wagonCount, { suffix: t("szt."), placeholder: eg("20") }) })}
          ${field({ key: "transport.train.capacity", label: t("Ładowność wagonu"), control: numIn("transport.train.capacity", tr.capacity, { suffix: tr.capUnit, placeholder: t("opcjonalnie") }) })}
          ${field({ key: "transport.train.capUnit", label: t("Jednostka ładowności"), control: selIn("transport.train.capUnit", [{ v: "t", l: t("tony (t)") }, { v: "MP", l: "MP" }], tr.capUnit, { struct: true }) })}
          <div></div>
          <div class="field span-all" data-field="transport.train.tonMode"><span class="lbl">${esc(t("Tonaż wagonów — wybierz sposób"))}</span>
            <div class="scope two">
              ${optCard("", { checked: !each, struct: false, radio: true, id: "f-ton-same", title: t("Tonaż taki sam dla wszystkich wagonów"), text: t("Podajesz jedną wartość — system mnoży przez liczbę wagonów."), attrs: 'data-ton="same"' })}
              ${optCard("", { checked: each, struct: false, radio: true, id: "f-ton-each", title: t("Wpisz tonaż każdego wagonu osobno"), text: t("System generuje listę wagonów i sumuje tonaż składu."), attrs: 'data-ton="each"' })}
            </div></div>
          ${!each ? field({ key: "transport.train.sameT", label: t("Tonaż jednego wagonu"), req: true, control: numIn("transport.train.sameT", tr.sameT, { suffix: "t", placeholder: eg("60") }) }) : ""}
          ${each ? `<div class="field span-all"><span class="lbl">${esc(t("Tonaż każdego wagonu"))}</span>${count ? `<div class="tbl-wrap wagons-tbl"><table class="tbl" id="wagon-table"><thead><tr><th class="c" style="width:80px">${esc(t("Wagon"))}</th><th>${esc(t("Tonaż"))}</th></tr></thead><tbody>${rows.join("")}</tbody><tfoot><tr><td>${esc(t("Razem"))}</td><td class="r" data-out="train.sumT">—</td></tr></tfoot></table></div>` : `<div class="help">${esc(t("Podaj liczbę wagonów — lista wygeneruje się automatycznie."))}</div>`}</div>` : ""}
          ${field({ key: "transport.train.price", label: t("Cena frachtu"), req: true, control: numIn("transport.train.price", tr.price, { suffix: `zł/${Units.label(tr.priceUnit)}`, placeholder: eg("25") }) })}
          ${field({ key: "transport.train.priceUnit", label: t("Cena za"), control: selIn("transport.train.priceUnit", [{ v: "t", l: t("t (tonę)") }, { v: "MP", l: "MP" }, { v: "m3", l: "m³" }], tr.priceUnit, { struct: true }) })}
          <div class="field span-all"><span class="lbl">${esc(t("Podsumowanie składu"))}</span><div class="train-sum" data-out="train.summary"></div></div>
        </div>`;
      }
      const buyers = S.partners.filter(p => ["buyer", "both"].includes(p.role) && p.active !== false);
      return section(n, "tr", t("Miejsce i transport"), t("Transport nie zmienia stanu magazynowego — to osobny koszt operacji."), `
        <div class="fgrid">${field({ key: "transport.place", label: t("Miejsce transportu / dostawy"), req: true, span: "span-all", control: textIn("transport.place", T.place, { placeholder: eg("RiC Zabrze"), list: "dl-places" }) + `<datalist id="dl-places">${S.warehouses.filter(w => w.active !== false).map(w => `<option value="${esc(w.name)}">`).concat(buyers.map(b => `<option value="${esc(b.name)}">`)).join("")}</datalist>` })}</div>
        <div class="field mt4" data-field="transport.mode"><span class="lbl">${esc(t("Rodzaj transportu — własny i zewnętrzny można zaznaczyć razem (np. 3 kursy flotą własną + 2 kursy firmą zewnętrzną); pociąg osobno"))}</span>
          <div class="scope" role="group" aria-label="${esc(t("Rodzaj transportu"))}">
            ${optCard("", { checked: useOwn, struct: false, id: "f-mode-own", title: t("Transport własny"), text: t("Kursy pojazdami z Floty, koszt = km × stawka."), attrs: 'data-mode="own"' })}
            ${optCard("", { checked: useExt, struct: false, id: "f-mode-external", title: t("Transport zewnętrzny"), text: t("Kursy firmy przewozowej, km × stawka albo fracht."), attrs: 'data-mode="external"' })}
            ${optCard("", { checked: mode === "train", struct: false, radio: true, id: "f-mode-train", title: t("Pociąg"), text: t("Wagony, tonaż, podsumowanie składu."), attrs: 'data-mode="train"' })}
            ${this.draft.type === "ZAKUP" ? optCard("", { checked: mode === "supplier", struct: false, radio: true, id: "f-mode-supplier", title: t("Transport w cenie zakupu — zapewnia dostawca (firma)"), text: t("Dostawca przywozi towar na swój koszt; bez kursów i bez kosztu transportu."), attrs: 'data-mode="supplier"' }) : ""}
          </div>
          <div class="help tut">${t(HELP["transport.mode"])}</div></div>
        ${modeHtml}`);
    },

    html(params) {
      if (this.mode === "correct") {
        const op = this.op;
        if (!op) return `<div class="empty">${esc(t("Nie znaleziono dokumentu do korekty."))}</div>`;
        const perm = R.OP_TYPES[op.type].correctPerm;
        const deny = op.status === "CANCELLED" ? t("Dokument jest anulowany — nie można go korygować. Wprowadź nową operację.")
          : !App.can("documents.correct") ? t("Twoja rola nie ma uprawnienia „{p}”.", { p: "documents.correct" })
          : !App.can(perm) ? t("Twoja rola nie ma uprawnienia „{p}”.", { p: perm })
          : (App.user().whId !== op.whId && App.user().role !== "admin") ? t("Korektę wykonuje użytkownik magazynu {w} albo Administrator.", { w: App.whName(op.whId) }) : "";
        const head = `<div class="page-head"><div class="titles"><h2>${esc(t("KOREKTA dokumentu nr {no}", { no: op.no }))}</h2>
          <p>${esc(t(R.OP_TYPES[op.type].label))}${op.direct ? " — " + esc(t("bezpośrednia")) : ""} · ${esc(Dates.pl(op.date))} · ${esc(App.whName(op.whId))} · ${statusBadge(op.status)} ${esc(t("Popraw pola — system pokaże oryginał, korektę, różnicę i wpływ na stan. Dokument pierwotny pozostaje w historii."))}</p></div>
          <div class="actions"><button class="btn ghost" type="button" id="corr-cancel">${ic("x", 15)} ${esc(t("Porzuć korektę"))}</button></div></div>`;
        if (deny) return head + `<div class="info-line err" id="corr-deny">${ic("alert", 15)}<span>${esc(deny)}</span></div>`;
        return head + this.layout(true);
      }
      if (!App.can("op.create")) {
        return `<div class="page-head"><div class="titles"><h2>${esc(t("Nowa operacja"))}</h2></div></div>
          <div class="info-line err">${ic("alert", 15)}<span>${t("Rola <b>{r}</b> nie pozwala tworzyć operacji. Zaloguj się kontem z odpowiednimi uprawnieniami.", { r: esc(App.roleLabel(App.user().role)) })}</span></div>`;
      }
      const rv = this.review, rec = this.draft.draftId ? R.byId(Store.state.drafts, this.draft.draftId) : null;
      if (rv) return `<div class="page-head"><div class="titles"><h2>${esc(t("Operacja do zatwierdzenia"))} ${statusBadge("PENDING")}</h2>
          <p>${esc(t("Wprowadził: {u} · przekazano {d} · magazyn {w}. Sprawdź dane — możesz je poprawić przed zatwierdzeniem albo odrzucić z podaniem powodu.", { u: rv.userName, d: Dates.ts(rv.submittedAt), w: App.whName(rv.whId) }))}</p></div>
          <div class="actions"><button class="btn ghost" type="button" id="review-close">${ic("x", 15)} ${esc(t("Zamknij przegląd"))}</button></div></div>` + this.layout(false);
      return `<div class="page-head"><div class="titles"><h2>${esc(t("Nowa operacja"))}${this.draft.draftId ? ` <span class="badge st-DRAFT">${esc(t("wersja robocza"))}</span>` : ""}</h2>
          ${rec && rec.rejectReason ? `<div class="info-line err mt2" id="reject-info">${ic("alert", 15)}<span>${esc(t("Odrzucona przez {u} ({d}): {r}. Popraw i przekaż ponownie.", { u: rec.rejectedBy, d: Dates.ts(rec.rejectedAt), r: rec.rejectReason }))}</span></div>` : ""}
          ${this.draft._tpl ? `<div class="info-line ok mt2" id="tpl-info">${ic("star", 15)}<span>${esc(t("Z szablonu „{n}” na dziś. Uzupełnij ilości, numery kwitów i wagi — Ctrl+Enter zatwierdza.", { n: this.draft._tpl }))}</span></div>` : ""}
          ${this.draft._repeatOf ? `<div class="info-line ok mt2" id="repeat-info">${ic("undo", 15)}<span>${esc(t("Kopia operacji {n} na dziś. Uzupełnij numery kwitów i wagi — Ctrl+Enter zatwierdza.", { n: this.draft._repeatOf }))}</span></div>` : ""}
          ${rec && rec.status === "PENDING" ? `<div class="info-line mt2">${ic("clock", 15)}<span>${esc(t("Operacja czeka na zatwierdzenie. Zmiana i zapis wycofa ją do wersji roboczej."))}</span></div>` : ""}
          <p>${t("Zakup, sprzedaż z magazynu, produkcja na magazynie, produkcja ze sprzedażą bezpośrednią albo przesunięcie MM. Pola z <span class=\"req\">*</span> są wymagane. Przed zatwierdzeniem zobaczysz podsumowanie.")}</p></div>
          <div class="actions">
            ${(() => { const lo = this.lastOwnOp(); return lo ? `<button class="btn" type="button" id="repeat-last" data-op="${esc(lo.id)}" data-no="${esc(lo.no)}" title="${esc(t("Kopia na dziś: te same strony, produkty, ilości, pojazdy i stawki — bez numerów kwitów"))}">${ic("undo", 15)} ${esc(t("Powtórz ostatnią"))} <small class="dim">${esc(lo.no)}</small></button>` : ""; })()}
            <label class="inline-opt"><input type="checkbox" id="tut-toggle" ${lsGet("riw.tutorial", "1") !== "0" ? "checked" : ""}> ${esc(t("Samouczek pod polami"))}</label>
            <label class="inline-opt" title="${esc(t("Enter przechodzi do następnego pola, Shift+Enter — do poprzedniego; na ostatnim polu Enter zapisuje operację"))}"><input type="checkbox" id="enter-nav" ${this.enterNav() ? "checked" : ""}> ${esc(t("Enter = następne pole"))}</label>
            <button class="btn ghost" type="button" id="form-reset">${ic("x", 15)} ${esc(t("Wyczyść"))}</button>
          </div></div>` + this.tplBar() + this.layout(false);
    },
    layout(corr) {
      return `<div class="op-layout">
          <form id="opf" novalidate autocomplete="off">${this.sectionsHtml()}</form>
          <aside class="summary" id="summary" aria-label="${esc(t("Podsumowanie operacji"))}">
            ${corr ? `<div class="card corr-card"><div class="card-h"><h3>${esc(t("Korekta — podgląd"))}</h3><span id="corr-badge"></span></div><div class="card-b" id="corr-preview"></div></div>` : ""}
            <div class="card"><div class="card-h"><h3>${esc(t("Przebieg operacji"))}</h3><span class="sub">${esc(t("kolejność księgowania"))}</span></div><div class="card-b" id="sum-flow"></div></div>
            <div class="card"><div class="card-h"><h3 id="sum-bal-h">${esc(t("Stan w magazynie"))}</h3></div><div id="sum-bal"></div></div>
            <div class="card"><div class="card-h"><h3>${esc(t("Koszty i przychód"))}</h3></div><div class="card-b" id="sum-money"></div></div>
            <div class="card"><div class="card-h"><h3>${esc(t("Plan dokumentów"))}</h3><span class="sub">${esc(corr ? t("dokumenty pierwotne") : t("powstaną przy zatwierdzeniu"))}</span></div><div id="sum-docs"></div></div>
            <div class="card"><div class="card-h"><h3>${esc(t("Kontrola"))}</h3><span id="sum-badge"></span></div>
              <div class="card-b"><div id="sum-errs"></div>
                ${corr ? `<div class="field mt4"><label for="corr-reason">${esc(t("Powód korekty"))} <span class="req">*</span></label>
                    <select class="ctrl" id="corr-reason"><option value="">— ${esc(t("wybierz powód"))} —</option>${R.CORRECTION_REASONS.map(r => `<option value="${esc(r)}" ${this.corr.reason === r ? "selected" : ""}>${esc(t(r))}</option>`).join("")}</select>
                    <input class="ctrl mt2" id="corr-reason-text" placeholder="${esc(this.corr.reason === "inny" ? t("opis powodu (wymagany)") : t("opis / własny powód (opcjonalnie)"))}" value="${esc(this.corr.reasonText)}"><div class="msg hidden" id="corr-reason-msg" role="alert"></div></div>
                  <button class="btn primary lg mt4" type="button" data-save style="width:100%">${ic("check", 16)} ${esc(t("Zatwierdź korektę…"))}</button>`
                : this.review ? `<button class="btn primary lg mt4" type="button" data-save style="width:100%">${ic("check", 16)} ${esc(t("Zatwierdź dokument…"))}</button>
                   <button class="btn danger mt2" type="button" data-reject style="width:100%">${ic("x", 15)} ${esc(t("Odrzuć…"))}</button>`
                : `<button class="btn primary lg mt4" type="button" data-save style="width:100%">${ic(this.action() === "submit" ? "up" : "check", 16)} ${esc(this.saveLabel())}</button>
                   <button class="btn mt2" type="button" data-draft style="width:100%">${ic("file", 15)} ${esc(t("Zapisz jako roboczy"))}</button>
                   ${this.action() === "submit" ? `<p class="help mt2">${esc(t("Operację zatwierdza kierownik magazynu — do tego czasu nie ma numeru i nie zmienia stanów."))}</p>` : ""}`}</div></div>
          </aside>
        </div>
        <div class="save-bar no-print"><div class="sb-info" id="sb-info"></div><button class="btn primary lg" type="button" data-save>${ic("check", 16)} ${esc(corr ? t("Zatwierdź korektę…") : this.saveLabel())}</button></div>`;
    },
    saveLabel() { const a = this.action(); return a === "submit" ? t("Przekaż do zatwierdzenia…") : a === "approve" ? t("Zatwierdź dokument…") : t("Zatwierdź…"); },

    bind(page) {
      const cc = $("#corr-cancel", page);
      if (cc) cc.onclick = () => { const id = this.op && this.op.id; this.draft = null; this.mode = "new"; location.hash = "#/operacje"; if (id) setTimeout(() => root.OpDetail && root.OpDetail.open(id), 50); };
      const form = $("#opf", page);
      if (!form) return;
      const tt = $("#tut-toggle", page);
      if (tt) tt.onchange = e => { lsSet("riw.tutorial", e.target.checked ? "1" : "0"); document.body.classList.toggle("no-tutorial", !e.target.checked); };
      const fr = $("#form-reset", page);
      if (fr) fr.onclick = async () => {
        const r = await Modal.confirm({ title: t("Wyczyścić formularz?"), text: t("Wszystkie wpisane dane tej operacji zostaną usunięte. Zapisana wersja robocza pozostaje na liście operacji."), ok: t("Wyczyść"), danger: true });
        if (r.ok) { this.reset(); this.rerender(); App.render(); }
      };
      form.addEventListener("input", e => this.onEdit(e, false));
      form.addEventListener("change", e => this.onEdit(e, true));
      form.addEventListener("focusout", e => {
        const el = e.target;
        if (!el.dataset || !el.dataset.bind) return;
        this.touched.add(el.dataset.bind);
        if (el.hasAttribute("data-num")) {
          const r = NumParse.parse(el.value);
          if (r.ok) {
            const nice = el.dataset.bind === "production.chipRate" ? fmt(r.value, 2) : fmtQ(r.value, 6);
            if (nice !== el.value) { el.value = nice; setPath(this.draft, el.dataset.bind, nice); this.persist(); }
          }
        }
        this.refresh();
      });
      form.addEventListener("click", e => {
        const b = e.target.closest && e.target.closest("button");
        if (!b || !form.contains(b)) return;
        if (b.id === "extra-add") { const X = this.extras(); if (X.items.length < R.MAX_EXTRAS) X.items.push(R.blankExtra()); this.persist(); this.rerender(); const el = document.getElementById(fid(`extras.items.${X.items.length - 1}.typeId`)); if (el) el.focus(); return; }
        if (b.dataset.extraDel !== undefined) { const X = this.extras(); X.items.splice(+b.dataset.extraDel, 1); this.persist(); this.rerender(); return; }
        if (b.dataset.useNo) { this.draft.docNos[b.dataset.useNo] = b.dataset.no; (this.draft.docNoMode || (this.draft.docNoMode = {}))[b.dataset.useNo] = "manual"; this.touched.add(`docNos.${b.dataset.useNo}`); this.persist(); this.rerender(); }
      });
      form.addEventListener("submit", e => { e.preventDefault(); this.save(); });
      // Ctrl+S / Ctrl+Enter — zatwierdzenie (podsumowanie przed zapisem)
      form.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "s" || e.key === "Enter")) { e.preventDefault(); this.save(); return; }
        // 3.11: obsługa samą klawiaturą — Enter przechodzi do następnego pola (Shift+Enter — do poprzedniego), na ostatnim polu zapis
        if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey && this.enterNav() && e.target.matches("input:not([type=checkbox]):not([type=radio]), select")) {
          e.preventDefault();
          this.moveFocus(e.target, e.shiftKey ? -1 : 1);
        }
      });
      if (!page._tplKeys) page._tplKeys = true, page.addEventListener("keydown", e => {
        if (!$("#tpl-bar", page) || !e.altKey || e.ctrlKey || e.metaKey || !/^Digit[1-9]$/.test(e.code)) return;
        const b = $$("[data-tpl]", page)[Number(e.code.slice(5)) - 1];
        if (b) { e.preventDefault(); this.applyTemplate(b.dataset.tpl); }
      });
      form.addEventListener("click", e => {
        if (e.target.closest("#scale-import")) { this.importScale(); return; }
        const b = e.target.closest("[data-run-dup]"); if (!b) return;
        const [m, which] = b.dataset.runDup.split(".");
        this.addRunLike(m, which === "last" ? null : Number(which));
      });
      const en = $("#enter-nav", page); if (en) en.onchange = () => lsSet("riw.enterNav", en.checked ? "1" : "0");
      $$("[data-tpl]", page).forEach(b => { b.onclick = () => this.applyTemplate(b.dataset.tpl); });
      const ts = $("#tpl-save", page); if (ts) ts.onclick = () => this.saveTemplateDialog();
      const tm = $("#tpl-manage", page); if (tm) tm.onclick = () => this.manageTemplates();
      const tmo = $("#tpl-more", page); if (tmo) tmo.onclick = () => this.manageTemplates();
      const rp = $("#repeat-last", page); if (rp) rp.onclick = () => { if (this.repeatFrom(rp.dataset.op)) { App.render(); Toast.ok(t("Kopia operacji {n} na dziś", { n: rp.dataset.no }), t("Sprawdź ilości i dopisz numery kwitów — reszta jest uzupełniona.")); } };
      $$("[data-save]", page).forEach(b => b.onclick = () => this.save());
      $$("[data-draft]", page).forEach(b => b.onclick = () => this.saveDraft());
      $$("[data-reject]", page).forEach(b => b.onclick = () => this.reject());
      const rc = $("#review-close", page);
      if (rc) rc.onclick = () => { this.review = null; this.draft = null; location.hash = "#/operacje"; };
      const rs = $("#corr-reason", page), rt = $("#corr-reason-text", page);
      if (rs) rs.onchange = () => { this.corr.reason = rs.value; rt.placeholder = rs.value === "inny" ? t("opis powodu (wymagany)") : t("opis / własny powód (opcjonalnie)"); this.reasonMsg(false); };
      if (rt) rt.oninput = () => { this.corr.reasonText = rt.value; this.reasonMsg(false); };
      this.refresh();
    },

    onEdit(e, isChange) {
      const el = e.target, d = this.draft;
      if (isChange && el.dataset) {
        if (el.dataset.type !== undefined) {
          if (!el.checked) { el.checked = true; return; }
          const prevType = d.type;
          d.type = el.dataset.type;
          d.sale.enabled = false; d.production.enabled = false;
          if (prevType === "ZAKUP" || d.type === "ZAKUP") d.sale.direct = false;
          if (d.transport.mode === "supplier" && d.type !== "ZAKUP") d.transport.mode = "none";
          if (d.type === "PRODUKCJA" || (d.type === "SPRZEDAZ" && d.sale.direct)) { if (!d.production.rawProductId) d.production.rawProductId = "pr_drewno"; if (!d.production.outProductId) d.production.outProductId = "pr_zr_lesna"; }
          if (!d.transport.placeTouched) d.transport.place = this.defaultPlace();
          this.touched = new Set(); this.showAll = false;
          this.persist(); this.rerender(); return;
        }
        if (el.dataset.skind !== undefined) {
          if (!el.checked) { el.checked = true; return; }
          const k = el.dataset.skind, P = d.purchase;
          P.supplierKind = k; P.basis = R.SUPPLIER_KINDS[k].basis;
          const s = App.partner(P.supplierId);
          if (s && R.partnerKind(s) !== k) { P.supplierId = ""; P.supplierName = ""; P.lesnictwo = ""; }
          this.persist(); this.rerender(); return;
        }
        if (el.dataset.mode !== undefined) {
          // własny i zewnętrzny łączą się (tryb „mixed”); pociąg wyklucza pozostałe
          const m = d.transport.mode, want = el.dataset.mode;
          let own = m === "own" || m === "mixed", ext = m === "external" || m === "mixed";
          if (want === "train" || want === "supplier") { own = ext = false; d.transport.mode = el.checked ? want : "none"; }
          else {
            if (want === "own") own = el.checked; else ext = el.checked;
            d.transport.mode = own && ext ? "mixed" : own ? "own" : ext ? "external" : "none";
          }
          this.touched.add("transport.mode"); this.persist(); this.rerender(); return;
        }
        if (el.dataset.ton !== undefined) {
          d.transport.train.tonMode = el.dataset.ton;
          this.persist(); this.rerender(); return;
        }
      }
      const key = el.dataset && el.dataset.bind;
      if (!key) return;
      if (!isChange && (el.type === "checkbox" || el.tagName === "SELECT" || el.type === "date")) return;
      // rębak wybrany / wpisany — po opuszczeniu pola odświeżenie opisu operatora (własny / firmy zewnętrznej); po przejściu fokusu
      if (isChange && key === "production.chipperName") { setTimeout(() => { if ($("#opf")) this.rerender(); }, 0); return; }
      if (isChange && el.tagName === "INPUT" && el.type === "text") return;
      const v = el.type === "checkbox" ? el.checked : el.value;
      const prev = key === "purchase.unit" ? d.purchase.unit : undefined;
      setPath(d, key, v);
      this.touched.add(key);
      this.sideEffects(key, v, prev);
      this.persist();
      const supChanged = this._supplierChanged; this._supplierChanged = false;
      if (el.hasAttribute("data-struct") || supChanged || key === "transport.train.wagonCount" || key === "transport.own.runCount" || key === "transport.external.runCount") this.rerender();
      else this.refresh();
    },

    sideEffects(key, v, prev) {
      const d = this.draft, S = Store.state;
      if (key === "purchase.unit" && prev && prev !== v) {
        // zmiana jednostki ilości przelicza wpisaną ilość (ta sama fizyczna ilość, stan bez zmian); cena zostaje „za” poprzednią jednostkę
        const p = App.product(d.purchase.productId), conv = x => { const r = NumParse.parse(x); if (!p || !r.ok) return x; try { return fmtQ(Units.convert(r.value, prev, v, p, S.config), 6); } catch (e) { return x; } };
        if (!d.purchase.priceUnit) d.purchase.priceUnit = prev;
        if (String(d.purchase.qty).trim() !== "") d.purchase.qty = conv(d.purchase.qty);
        if (String(d.production.consumeQty || "").trim() !== "") d.production.consumeQty = conv(d.production.consumeQty);
      }
      if (key === "purchase.productId") {
        const p = App.product(v);
        if (p) { d.purchase.unit = p.unit; d.purchase.priceUnit = ""; }
        if (!p || p.cat !== "drewno") { d.production.enabled = false; d.sale.enabled = false; d.sale.direct = false; }
      }
      if (key === "sale.productId") { const p = App.product(v); if (p) d.sale.unit = p.unit; }
      if (key === "mm.productId") { const p = App.product(v); if (p) d.mm.unit = p.unit; }
      if (key === "mm.unit" && prev && prev !== v) {
        // zmiana jednostki przelicza wpisaną ilość (ta sama fizyczna ilość)
        const p = App.product(d.mm.productId), r = NumParse.parse(d.mm.qty);
        if (p && r.ok) { try { d.mm.qty = fmtQ(Units.convert(r.value, prev, v, p, S.config), 6); } catch (e) {} }
      }
      if (key === "mm.fromWhId") {
        // inny magazyn źródłowy = inny stan; towar spoza stanu nowego źródła zostaje (walidacja pokaże brak stanu)
        const p = App.product(d.mm.productId);
        if (p && !(Stock.balance(S, v, p.id) > R.EPS) && !String(d.mm.qty).trim()) d.mm.productId = "";
      }
      if (key === "production.type" && R.PROD_TYPES[v] && d.type !== "PRODUKCJA") d.production.outProductId = R.PROD_TYPES[v].productId;
      if (key === "production.enabled" && !v) { d.sale.enabled = false; d.sale.direct = false; }
      if (d.type === "ZAKUP" && (key === "production.enabled" || key === "sale.direct") && v) {
        // produkcja i sprzedaż bezpośrednia z lasu dotyczą drewna — produkt zakupu ustawiany automatycznie
        const p = App.product(d.purchase.productId);
        if (!p || p.cat !== "drewno") { const w = S.products.find(x => x.id === "pr_drewno" && x.active !== false) || S.products.find(x => x.cat === "drewno" && x.active !== false); if (w) { d.purchase.productId = w.id; d.purchase.unit = w.unit; d.purchase.priceUnit = ""; } }
        d.production.enabled = true;
        if (key === "sale.direct") d.sale.enabled = true;
      }
      if (d.type === "ZAKUP" && key === "sale.direct" && !v) d.sale.enabled = false;
      if (key === "extras.enabled" && v) this.extras();
      const runKey = key.match(/^transport\.own\.runs\.(\d+)\.(vehicleId|vehicleReg)$/);
      if (runKey) {
        // pojazd wybrany z listy albo wpisany: numer zgodny z kartoteką → istniejący pojazd; inny → nowy (dopisany przy zatwierdzeniu)
        const i = runKey[1], run = d.transport.own.runs[+i];
        let veh = null;
        if (runKey[2] === "vehicleId") veh = R.byId(S.fleet.vehicles, v);
        else { const p = R.FleetPick.vehicle(S, v); veh = p && p.rec && p.rec.owner !== "external" ? p.rec : null; }
        const prevId = run.vehicleId;
        run.vehicleId = veh ? veh.id : "";
        if (veh && veh.id !== prevId) {
          // kierowca domyślny pojazdu (gdy pole kierowcy jest puste albo zawierało domyślnego poprzedniego pojazdu)
          const prevVeh = R.byId(S.fleet.vehicles, prevId), dEl = document.getElementById(fid(`transport.own.runs.${i}.driverName`));
          const curDriver = String(run.driverName || "").trim(), prevDefault = prevVeh ? (R.byId(S.fleet.drivers, prevVeh.driverId) || {}).name : "";
          if (!curDriver && !run.driverId || (run.driverId && prevVeh && run.driverId === prevVeh.driverId) || (curDriver && curDriver === prevDefault)) {
            const dd = R.byId(S.fleet.drivers, veh.driverId);
            run.driverId = dd ? dd.id : ""; run.driverName = dd ? dd.name : "";
            if (dEl) dEl.value = run.driverName;
          }
          // szybki wpis: km i stawka z ostatniego kursu tego auta (tylko puste pola)
          const last = this.lastRunOf(veh.id);
          if (last) for (const f of ["km", "rate"]) if (!String(run[f] || "").trim() && last[f]) { run[f] = last[f]; const el = document.getElementById(fid(`transport.own.runs.${i}.${f}`)); if (el) el.value = run[f]; }
        }
      }
      const drvKey = key.match(/^transport\.own\.runs\.(\d+)\.driverName$/);
      if (drvKey) {
        const run = d.transport.own.runs[+drvKey[1]], p = R.FleetPick.person(S.fleet.drivers, v);
        run.driverId = p && p.rec ? p.rec.id : "";
      }
      if (key === "production.chipperName") {
        // rębak z listy albo wpisany (nowy rębak własny); operator domyślny rębaka własnego podpowiadany
        const P = d.production, p = R.FleetPick.chipper(S, v), c = p && p.rec ? p.rec : null, prevId = P.chipperId;
        P.chipperId = c ? c.id : "";
        if (c && c.id !== prevId) {
          const oEl = document.getElementById(fid("production.operatorName"));
          if (c.owner === "external") { P.operatorId = ""; P.operatorName = c.operatorName || ""; }
          else { const o = R.byId(S.fleet.operators, c.operatorId); P.operatorId = o ? o.id : ""; P.operatorName = o ? o.name : ""; }
          if (oEl) oEl.value = P.operatorName;
        }
      }
      if (key === "production.operatorName") {
        const P = d.production, c = R.byId(S.fleet.chippers, P.chipperId);
        const p = c && c.owner === "external" ? null : R.FleetPick.person(S.fleet.operators, v);
        P.operatorId = p && p.rec ? p.rec.id : "";
      }
      const xregKey = key.match(/^transport\.external\.runs\.(\d+)\.reg$/);
      if (xregKey) {
        // numer z floty zewnętrznej → kierowca i firma podpowiadane z kartoteki (wpisane ręcznie nie są nadpisywane)
        const norm = x => String(x || "").replace(/\s+/g, "").toUpperCase();
        const veh = S.fleet.vehicles.find(x => x.owner === "external" && norm(x.reg) === norm(v));
        const X = this.extRuns(), run = X.runs[+xregKey[1]];
        if (veh && run) {
          if (!String(run.driver || "").trim() && veh.driverName) { run.driver = veh.driverName; const el = document.getElementById(fid(`transport.external.runs.${xregKey[1]}.driver`)); if (el) el.value = run.driver; }
          if (this.extCompanyCount() > 1) {
            if (!String(run.company || "").trim() && veh.company) { run.company = veh.company; const el = document.getElementById(fid(`transport.external.runs.${xregKey[1]}.company`)); if (el) el.value = run.company; }
          } else if (!String(X.company || "").trim() && veh.company) { X.company = veh.company; const el = document.getElementById(fid("transport.external.company")); if (el) el.value = X.company; }
        }
      }
      const m3Key = key.match(/^transport\.(own|external)\.runs\.(\d+)\.kwitM3$/);
      if (m3Key) {
        const r = NumParse.parse(v), run = d.transport[m3Key[1]].runs[+m3Key[2]];
        if (r.ok && r.value > 0) {
          run.qty = fmtQ(R.rq(r.value * S.config.m3_mp), 6);                  // m³ z kwitu × 4 = MP na aucie
          const el = document.getElementById(fid(`transport.${m3Key[1]}.runs.${m3Key[2]}.qty`));
          if (el) el.value = run.qty;
        }
      }
      if (key === "transport.external.runCount") {
        const X = this.extRuns(), n = Math.max(0, Math.min(50, Math.floor(NumParse.value(v, 0)) || 0));
        const arr = X.runs.slice(0, n);
        while (arr.length < n) { const prev = arr[arr.length - 1]; arr.push(prev ? Object.assign(R.blankExtRun(), { company: prev.company || "", km: prev.km, rate: prev.rate }) : R.blankExtRun()); }
        X.runs = arr;
      }
      if (key === "transport.external.companyCount") {
        // przejście 1 → kilka firm: dotychczasowa firma trafia do pustych kursów; kilka → 1: pierwsza firma z kursów
        const X = this.extRuns();
        if (this.extCompanyCount() > 1) { if (String(X.company || "").trim()) X.runs.forEach(r => { if (!String(r.company || "").trim()) r.company = X.company; }); }
        else if (!String(X.company || "").trim()) { const f = X.runs.find(r => String(r.company || "").trim()); if (f) X.company = f.company; }
      }
      if (key === "transport.own.runCount") {
        const O = this.ownRuns(), n = Math.max(0, Math.min(50, Math.floor(NumParse.value(v, 0)) || 0));
        const arr = O.runs.slice(0, n);
        // nowy kurs przejmuje pojazd, kierowcę, km i stawkę z poprzedniego — zwykle kursy są powtarzalne
        while (arr.length < n) { const prev = arr[arr.length - 1]; arr.push(prev ? Object.assign(R.blankRun(), { vehicleId: prev.vehicleId, vehicleReg: prev.vehicleReg || "", driverId: prev.driverId, driverName: prev.driverName || "", km: prev.km, rate: prev.rate }) : R.blankRun()); }
        O.runs = arr;
      }
      if (key === "purchase.supplierName") {
        // nazwa zgodna z kartoteką → istniejący dostawca; inna → nowy (dopisany przy zatwierdzeniu)
        const name = String(v).trim().replace(/\s+/g, " ").toLowerCase();
        const s = name ? S.partners.find(p => ["supplier", "both"].includes(p.role) && p.name.trim().toLowerCase() === name) : null;
        const prevId = d.purchase.supplierId;
        d.purchase.supplierId = s ? s.id : "";
        if (s) { const k = R.partnerKind(s); if (k !== d.purchase.supplierKind || s.id !== prevId) { d.purchase.supplierKind = k; d.purchase.basis = R.SUPPLIER_KINDS[k].basis; } }
        if (this.supplierKind() === "nadlesnictwo") { d.production.type = "lesna"; d.production.ndl = R.ndlName({ name: String(v).trim() }); }
        if (s ? s.id !== prevId : !!prevId) { d.purchase.lesnictwo = ""; this._supplierChanged = true; }
      }
      if (key === "purchase.lesnictwo" && this.supplierKind() === "nadlesnictwo") d.production.lesnictwo = v;
      if (key === "transport.place") d.transport.placeTouched = true;
      if ((key === "sale.buyerId" || key === "sale.enabled" || key === "sale.direct" || key === "mm.toWhId") && !d.transport.placeTouched) d.transport.place = this.defaultPlace();
      if (key === "sale.direct" && v && d.type === "SPRZEDAZ") { if (!d.production.rawProductId) d.production.rawProductId = "pr_drewno"; if (!d.production.outProductId) d.production.outProductId = "pr_zr_lesna"; }
      if (key === "transport.train.wagonCount") {
        const n = Math.max(0, Math.min(S.config.maxWagons, Math.floor(NumParse.value(v, 0)) || 0));
        const arr = (d.transport.train.wagonT || []).slice(0, n);
        while (arr.length < n) arr.push("");
        d.transport.train.wagonT = arr;
      }
    },

    rerender() {
      const form = $("#opf"); if (!form) return;
      const act = document.activeElement;
      const id = act && act.id && form.contains(act) ? act.id : null;
      let caret = null; try { caret = act && act.selectionStart; } catch (e) {}
      const y = root.scrollY;
      form.innerHTML = this.sectionsHtml();
      if (id) {
        const el = document.getElementById(id);
        if (el) { el.focus({ preventScroll: true }); try { if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); } catch (e) {} }
      }
      root.scrollTo(0, y);
      this.refresh();
    },

    ctx() {
      const c = App.ctx(this.mode === "correct" ? SRC_CORR : this.review ? SRC_REVIEW : SRC_NEW);
      if (this.review) c.user = Object.assign({}, c.user, { whId: this.review.whId });   // plan w magazynie operacji
      return c;
    },
    /** Plan bieżącego formularza: dla korekty — plan na stanie bez skutków korygowanej operacji (jak w silniku). */
    computePlan() {
      const S = Store.state;
      if (this.mode === "correct") {
        const view = Object.assign({}, S, { ledger: S.ledger.filter(l => l.opId !== this.op.id) });
        const plan = R.planOperation(view, Object.assign(R.clone(this.draft), { date: this.op.date }), Object.assign(this.ctx(), { user: Object.assign({}, App.user(), { whId: this.op.whId }), correction: true }));
        this.corrPlan = plan.ok ? R.planCorrection(S, this.op.id, this.draft, this.ctx()) : null;
        return plan;
      }
      return R.planOperation(S, this.draft, this.ctx());
    },

    /** Przeliczenie na żywo — podmienia wyłącznie teksty wynikowe, pola wejściowe zostają nietknięte. */
    refresh() {
      const form = $("#opf"); if (!form || !form.isConnected || !this.draft || !Store.state) return null;
      const S = Store.state, cfg = S.config;
      const plan = this.plan = this.computePlan();
      DBG.plan = plan; DBG.corrPlan = this.corrPlan;
      const n = plan.norm;
      const out = (key, html) => { const el = form.querySelector(`[data-out="${key}"]`); if (el) el.innerHTML = html; };
      $$("[data-calc]", form).forEach(c => { c.innerHTML = ""; });      // bez tego opisy wyliczeń dopisywały się przy każdym przeliczeniu
      $$("[data-num]", form).forEach(el => {
        const c = form.querySelector(`[data-calc="${el.dataset.bind}"]`);
        const r = NumParse.parse(el.value);
        if (c) c.innerHTML = r.ok && el.value.trim() !== fmtQ(r.value, 6) && el.value.trim() !== fmt(r.value, 2) ? t("odczytano: <b>{v}</b>", { v: fmtQ(r.value, 6) }) : "";
      });
      const add = (key, html) => { const el = form.querySelector(`[data-calc="${key}"]`); if (el && html) el.innerHTML = (el.innerHTML ? el.innerHTML + " · " : "") + html; };
      const qn = (q, pid) => App.qtyNative(q, pid);
      const orient = (q, pid) => { const p = App.product(pid); if (!p) return "—"; const o = Units.orient(q, p, cfg); return `${p.unit === "t" ? "" : "≈ "}${fmt(o.t, 2)} t · ≈ ${fmt(o.gj, 1)} GJ`; };

      if (n.purchase) {
        const P = n.purchase, p = App.product(P.productId);
        if (P.qty !== null && p && P.unit !== p.unit) add("purchase.qty", t("= <b>{q}</b> na stanie", { q: esc(qn(P.stockQty, p.id)) }));
        if (P.newSupplier) add("purchase.supplierName", `<span class="badge info">${esc(t("nowy dostawca"))}</span> ` + esc(t("zostanie dopisany do kartoteki ({g}) przy zatwierdzeniu", { g: t(R.SUPPLIER_KINDS[P.newSupplier.kind].label) })));
        else if (P.supplierId) add("purchase.supplierName", esc(t("z kartoteki ✓")));
        if (P.qty !== null && P.price !== null) add("purchase.price", P.priceUnit && P.priceUnit !== P.unit && P.priceQty !== null
          ? `${fmtQ(P.qty)} ${Units.label(P.unit)} = ${fmtQ(P.priceQty)} ${Units.label(P.priceUnit)} × ${fmt(P.price)} zł`
          : `${fmtQ(P.qty)} ${Units.label(P.unit)} × ${fmt(P.price)} zł`);
        out("purchase.cost", P.qty !== null && P.price !== null ? money(P.cost) : "—");
        out("purchase.weightAuto", P.qty !== null && p ? orient(P.stockQty, p.id) : "—");
        if (P.qty !== null) add("purchase.weightManual", esc(t("orientacyjnie: {q} t — ilość na stanie się nie zmienia", { q: fmtQ(P.autoWeight) })));
      }
      if (n.production) {
        const X = n.production, outP = App.product(X.outProductId), raw = App.product(X.rawProductId);
        if (X.mode !== "stock") add("production.type", t("produkt wynikowy: <b>{p}</b>", { p: esc(outP ? outP.name : "—") }));
        if (X.mode === "stock") {
          const onStock = n.available ? n.available.stock : 0;
          out("production.stock", raw ? esc(qn(onStock, raw.id)) : "—");
          out("production.consume", raw && X.consumeQty !== null ? `<b>${esc(qn(X.consumeQty, raw.id, 6))}</b>` : "—");
          out("production.after", raw && X.consumeQty !== null ? `<span class="${onStock - X.consumeQty < -R.EPS ? "neg" : ""}">${esc(qn(R.rq(onStock - X.consumeQty), raw.id))}</span>` : "—");
          out("production.factorTxt", X.factor ? `1 ${Units.label(raw.unit)} = ${fmtQ(X.factor)} ${Units.label(outP.unit)}` : "—");
          if (X.factor && X.outQty) add("production.outQty", esc(t("{a} {u} ÷ {f} = {b} {r} surowca", { a: fmtQ(X.outQty, 6), u: Units.label(outP.unit), f: fmtQ(X.factor), b: fmtQ(X.consumeQty, 6), r: Units.label(raw.unit) })));
          out("production.orient", outP && X.outQty ? orient(X.outQty, outP.id) : "—");
        }
        if (X.mode === "direct") out("production.rawQty", raw && X.consumeQty !== null ? `${esc(qn(X.consumeQty, raw.id, 6))} <small class="dim">${esc(t("nie ze stanu"))}</small>` : "—");
        if (X.mode === "chain" && n.available) add("production.consumeQty", t("dostępne: <b>{q} {u}</b>", { q: fmtQ(n.available.total), u: Units.label(n.available.unit) }) + (n.available.purchase ? " " + esc(t("(stan {a} + zakup {b})", { a: fmtQ(n.available.stock), b: fmtQ(n.available.purchase) })) : "") + (X.maxOut !== null ? " · " + esc(t("= maks. {q} MP", { q: fmtQ(X.maxOut) })) : ""));
        out("production.chipCost", money(X.chippingCost));
        if (X.outUnit === "MP") add("production.chipCost", `${fmtQ(X.outQty)} MP × ${fmt(X.chipRate)} zł/MP`);
      }
      if (n.sale) {
        const Sa = n.sale, p = App.product(Sa.productId);
        out("sale.revenue", money(Sa.revenue));
        out("sale.weight", p ? orient(Sa.stockQty, p.id) : "—");
        if (Sa.fromStock && p) {
          out("sale.onStock", esc(qn(Sa.onStock, p.id)));
          out("sale.after", `<span class="${Sa.after < -R.EPS ? "neg" : ""}">${esc(qn(Sa.after, p.id))}</span>`);
          if (Sa.qty !== null && Sa.unit !== p.unit) add("sale.qty", esc(t("= {q} ze stanu", { q: qn(Sa.stockQty, p.id) })));
          if (Sa.qty !== null && Sa.price !== null) add("sale.revenue", `${fmtQ(Sa.qty)} ${Units.label(Sa.unit)} × ${fmt(Sa.price)} zł`);
        } else {
          add("sale.qtyMP", t("maks. <b>{q} MP</b> (produkcja)", { q: fmtQ(n.production ? n.production.outQty : 0) }));
          if (Sa.price !== null) add("sale.revenue", Sa.priceUnit === "t" ? `${fmtQ(Sa.weightT)} t × ${fmt(Sa.price)} zł/t` : `${fmtQ(Sa.qty)} MP × ${fmt(Sa.price)} zł/MP`);
        }
      }
      if (n.sale) {
        const Sa = n.sale, p = App.product(Sa.productId);
        if (p) {
          out("sale.weightAuto", `${p.unit === "t" ? "" : "≈ "}<b>${esc(fmt(Sa.autoWeight || 0, 2))} t</b>`);
          out("sale.tonLine", Sa.qty !== null ? `<b>${esc(fmtQ(Sa.qty))} ${Units.label(Sa.unit)}</b> | <b>${esc(fmt(Sa.weightT, 2))} t</b> | <span class="badge ${Sa.weightMode === "manual" ? "warn" : "info"}">${esc(t(R.WEIGHT_SOURCES[Sa.weightMode] || "AUTO"))}</span>` : "—");
          if (Sa.weightMode === "manual" && Sa.qty !== null) add("sale.weightManual", esc(t("z przelicznika: {q} t — ilość na stanie się nie zmienia", { q: fmtQ(Sa.autoWeight) })));
        }
      }
      if (n.extras && n.extras.length) {
        n.extras.forEach((x, i) => out(`extra.${i}.cost`, x.costBasis === "qtyRate" && x.qty !== null && x.rate !== null ? `${fmtQ(x.qty)} × ${fmt(x.rate)} zł = <b>${money(x.cost)}</b>` : `<b>${money(x.cost)}</b>`));
        out("extras.total", t("Razem operacje dodatkowe: <b>{m}</b>", { m: money(plan.totals.extraCost) }));
      }
      if (n.mm) {
        const M = n.mm, p = App.product(M.productId);
        const b = w => plan.balances.find(x => x.whId === w && x.productId === M.productId);
        const src = b(this.whId()), dst = b(M.toWhId);
        out("mm.srcBal", p && src ? `${esc(qn(src.before, p.id))} → <b>${esc(qn(src.after, p.id))}</b>` : p ? esc(qn(M.onStock, p.id)) : "—");
        if (M.twoStage) {
          const toWh = R.byId(S.warehouses, M.toWhId);
          const now = p && toWh ? (this.mode === "correct" ? Stock.balance(Object.assign({}, S, { ledger: S.ledger.filter(l => l.opId !== this.op.id) }), toWh.id, p.id) : Stock.balance(S, toWh.id, p.id)) : null;
          out("mm.dstBal", p && toWh && toWh.id !== this.whId() ? `${esc(qn(now, p.id))} → <b>${esc(qn(R.rq(now + (M.stockQty || 0)), p.id))}</b> <small class="dim" style="margin-left:6px">${esc(t("po przyjęciu"))}</small>` : "—");
        } else out("mm.dstBal", p && dst ? `${esc(qn(dst.before, p.id))} → <b>${esc(qn(dst.after, p.id))}</b>` : "—");
        if (p && M.qty !== null && M.unit !== p.unit) add("mm.qty", `= ${esc(qn(M.stockQty, p.id))}`);
        out("mm.weightAuto", p && M.qty !== null ? `${p.unit === "t" ? "" : "≈ "}<b>${esc(fmt(M.autoWeight, 2))} t</b>` : "—");
        if (M.weightMode === "manual" && M.qty !== null && p) add("mm.weightManual", esc(t("z przelicznika: {q} t — ilość na stanie się nie zmienia", { q: fmtQ(M.autoWeight) })));
      }
      const T = n.transport;
      const ownP = T.mode === "own" ? T : T.mode === "mixed" ? T.own : null;
      const extP = T.mode === "external" ? T : T.mode === "mixed" ? T.external : null;
      if (ownP || extP) out("runs.summary", runsSummary(T));
      if (ownP) {
        (ownP.runs || []).forEach((r, i) => {
          out(`run.${i}.cost`, `${fmtQ(r.km)} km × ${fmt(r.rate)} zł/km = <b>${money(r.cost)}</b>`);
          if (r.driverOverridden && !r.newDriver) add(`transport.own.runs.${i}.driverId`, `<span style="color:var(--warn)">${esc(t("kierowca zmieniony tylko dla tego kursu"))}</span>`);
          if (r.newVehicle) add(`transport.own.runs.${i}.vehicleId`, `<span class="badge info">${esc(t("nowy pojazd"))}</span> ` + esc(t("zostanie dopisany do Floty przy zatwierdzeniu")));
          else if (r.reactivate) add(`transport.own.runs.${i}.vehicleId`, `<span class="badge warn">${esc(t("wraca do pracy"))}</span>`);
          else if (r.vehicleId) add(`transport.own.runs.${i}.vehicleId`, esc(t("z kartoteki ✓")));
          if (r.newDriver) add(`transport.own.runs.${i}.driverId`, `<span class="badge info">${esc(t("nowy kierowca"))}</span> ` + esc(t("zostanie dopisany do Floty przy zatwierdzeniu")));
          else if (r.driverId && r.defaultDriverId === r.driverId) add(`transport.own.runs.${i}.driverId`, esc(t("domyślny dla pojazdu")));
        });
      }
      if (extP) (extP.runs || []).forEach((r, i) => out(`xrun.${i}.cost`, extP.includedInPrice ? t("wliczony w cenę · <b>{m}</b>", { m: money(0) }) : r.freight !== null ? t("fracht = <b>{m}</b>", { m: money(r.cost) }) : `${fmtQ(r.km)} km × ${fmt(r.rate)} zł/km = <b>${money(r.cost)}</b>`));
      if (T.mode === "train") {
        out("train.sumT", `<b>${fmtQ(T.totalT)} t</b>`);
        const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
        out("train.summary", `<dl class="money-list" id="train-summary">
          ${row(t("Liczba wagonów"), `${T.wagonCount}`)}
          ${T.capacity !== null ? row(t("Łączna ładowność ({u})", { u: T.capUnit }), `${T.wagonCount} × ${fmtQ(T.capacity)} = <b>${fmtQ(T.totalCapacity)} ${T.capUnit}</b>`) : ""}
          ${T.tonMode === "each" ? row(t("Tonaż wagonów"), T.wagonT.length ? T.wagonT.map((x, i) => `${i + 1}: ${fmtQ(x)}`).join(" · ") + " t" : "—") : row(t("Tonaż wagonu"), `${T.wagonCount} × ${fmtQ(T.wagonT[0] || 0)} t`)}
          ${row(t("Łączny tonaż składu"), `<b data-train-total>${fmtQ(T.totalT)} t</b> <small class="dim">≈ ${fmtQ(T.totalMP)} MP · ≈ ${fmt(R.Units.energy(T.totalT, cfg), 0)} GJ</small>`)}
          ${row(t("Miejsce załadunku"), esc(T.loadPlace || "—"))}
          ${row(t("Miejsce dostawy"), esc(T.place || "—"))}
          ${row(t("Przewoźnik"), esc(T.carrier || "—"))}
          ${row(t("Nr dokumentu"), esc(T.docNo || "—"))}
          ${row(t("Koszt transportu"), `<b data-train-cost>${money(T.cost)}</b> <small class="dim">(${fmtQ(T.basisQty)} ${Units.label(T.priceUnit)} × ${fmt(T.price)} zł)</small>`)}
        </dl>`);
      }

      $$("[data-msg]", form).forEach(m => {
        const key = m.dataset.msg, msg = plan.errors[key];
        const show = msg && (this.showAll || this.touched.has(key) || key === "production.factor" || key === "transport.runs" || (key === "production.outQty" && plan.errorCodes[key] === "STOCK"));
        m.classList.toggle("hidden", !show);
        m.innerHTML = show ? ic("alert", 13) + `<span>${esc(msg)}</span>` : "";
        const input = document.getElementById(fid(key));
        if (input) { input.classList.toggle("invalid", !!show); input.setAttribute("aria-invalid", show ? "true" : "false"); }
      });
      this.summary(plan);
      if (this.mode === "correct") this.correctionPreview(plan);
      return plan;
    },

    summary(plan) {
      if (!$("#summary")) return;
      const name = id => (App.product(id) || {}).name || "—";
      const unitOf = id => Units.label((App.product(id) || {}).unit || "");
      const flow = plan.postings.map(p => `<li><span class="d">${p.doc}</span>
          <span>${p.step}. ${esc(t(R.KINDS[p.kind].label))}${p.direct ? " " + esc(t("(bezpośrednio)")) : ""} — ${esc(name(p.productId))}${p.whId !== plan.whId ? ` <small class="dim">[${esc(App.whName(p.whId))}]</small>` : ""}<br><small class="dim">${esc(t("stan {a} → {b}", { a: App.qtyNative(p.before, p.productId), b: App.qtyNative(p.after, p.productId) }))}</small></span>
          <span class="q ${p.qty > 0 ? "plus" : "minus"}">${p.qty > 0 ? "+" : ""}${fmtQ(p.qty)} ${unitOf(p.productId)}</span></li>`).join("")
        + (plan.norm.transport.mode !== "none" ? `<li><span class="d">${plan.norm.transport.mode === "supplier" ? "—" : "TR"}</span><span>${esc(t(R.TRANSPORT_MODES[plan.norm.transport.mode]))} — ${esc(transportText(plan.norm.transport))}<br><small class="dim">${esc(t("koszt {m} · wpływ na stan: brak", { m: money(plan.norm.transport.cost) }))}</small></span><span class="q zero">0</span></li>` : "");
      const bal = plan.balances.map(b => `<tr><td>${esc(name(b.productId))}${b.whId !== plan.whId ? `<br><small class="dim">${esc(App.whName(b.whId))}</small>` : ""}</td><td class="r">${esc(App.qtyNative(b.before, b.productId))}</td><td class="r"><b>${esc(App.qtyNative(b.after, b.productId))}</b></td></tr>`).join("");
      const tt = plan.totals;
      const docs = plan.documents.map(dc => `<tr><td><span class="badge ${dc.type === "TR" ? "info" : dc.stock === "+" ? "ok" : dc.stock === "±" ? "" : "warn"}" title="${esc(t(R.DOC_LABEL[dc.type] || dc.type))}">${esc(dc.series || dc.type)}</span></td>
          <td>${esc(dc.type === "TR" ? t(R.TRANSPORT_MODES[dc.transport.mode]) : name(dc.productId))}${dc.partner ? `<br><small class="dim">${esc(dc.partner)}</small>` : dc.toWh ? `<br><small class="dim">→ ${esc(dc.toWh)}</small>` : ""}</td>
          <td class="r">${dc.qty !== null ? esc(fmtQ(dc.qty) + " " + Units.label(dc.unit)) : "—"}</td>
          <td class="r">${dc.value ? esc(money(dc.value)) : "—"}</td>
          <td>${esc(dc.place || "—")}</td><td class="c">${esc(dc.stock === "brak" ? t("brak") : dc.stock)}</td></tr>`).join("");
      const errs = plan.errorList, nErr = errs.length;
      const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
      set("sum-flow", flow ? `<ol class="flow" id="flow">${flow}</ol>` : `<p class="dim">${esc(t("Uzupełnij formularz, aby zobaczyć przebieg."))}</p>`);
      set("sum-bal-h", esc(this.mode === "correct" ? t("Stan w magazynie {w} (bez korygowanego dokumentu)", { w: App.whName(this.whId()) }) : t("Stan w magazynie {w}", { w: App.whName(this.whId()) })));
      set("sum-bal", bal ? `<div class="tbl-wrap"><table class="tbl" id="bal"><thead><tr><th>${esc(t("Produkt"))}</th><th class="r">${esc(t("Przed"))}</th><th class="r">${esc(t("Po operacji"))}</th></tr></thead><tbody>${bal}</tbody></table></div>` : `<div class="card-b dim">—</div>`);
      set("sum-money", `<dl class="money-list" id="money">
          ${tt.purchaseCost ? `<dt>${esc(t("Koszt zakupu"))}</dt><dd data-sum="purchase">${money(tt.purchaseCost)}</dd>` : ""}
          ${tt.rawCost ? `<dt>${esc(t("Koszt surowca z lasu"))}</dt><dd data-sum="raw">${money(tt.rawCost)}</dd>` : ""}
          ${plan.norm.production ? `<dt>${esc(t("Koszt rąbania"))}</dt><dd data-sum="chipping">${money(tt.chippingCost)}</dd>` : ""}
          ${tt.extraCost ? `<dt>${esc(t("Operacje dodatkowe"))}</dt><dd data-sum="extras">${money(tt.extraCost)}</dd>` : ""}
          <dt>${esc(t("Koszt transportu"))}</dt><dd data-sum="transport">${money(tt.transportCost)}</dd>
          <dt>${esc(t("Przychód ze sprzedaży"))}</dt><dd data-sum="revenue">${money(tt.revenue)}</dd>
          <dt class="total">${esc(t("Wynik operacji"))}</dt><dd class="total" data-sum="result" style="color:${tt.result < 0 ? "var(--warn)" : "var(--ok)"}">${money(tt.result)}</dd></dl>`);
      set("sum-docs", docs ? `<div class="tbl-wrap"><table class="tbl" id="plan-docs"><thead><tr><th>${esc(t("Dok."))}</th><th>${esc(t("Treść"))}</th><th class="r">${esc(t("Ilość"))}</th><th class="r">${esc(t("Wartość"))}</th><th>${esc(t("Miejsce"))}</th><th class="c">${esc(t("Stan"))}</th></tr></thead><tbody>${docs}</tbody></table></div>` : `<div class="card-b dim">—</div>`);
      set("sum-badge", nErr ? `<span class="badge err">${esc(errorsWord(nErr))}</span>` : `<span class="badge ok">${esc(t("gotowe do zatwierdzenia"))}</span>`);
      set("sum-errs", (nErr ? `<ul class="err-list" id="err-list">${errs.map(e => `<li><button type="button" data-goto="${esc(e.field)}">${esc(this.fieldLabel(e.field))}${esc(e.msg)}</button></li>`).join("")}</ul>` : `<p class="muted">${esc(t("Wszystkie wymagane pola są poprawne."))}</p>`)
        + (plan.warnings.length ? `<ul class="warn-list mt3">${plan.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""));
      $$("[data-goto]", $("#summary")).forEach(b => b.onclick = () => {
        const el = document.getElementById(fid(b.dataset.goto)) || document.querySelector(`[data-field="${b.dataset.goto}"]`);
        this.showAll = true; this.refresh();
        if (el) { el.scrollIntoView({ block: "center" }); if (el.focus) el.focus({ preventScroll: true }); }
      });
      const info = $("#sb-info");
      if (info) info.innerHTML = nErr ? `<span style="color:var(--err)">${esc(t("{n} do poprawy", { n: nErr }))}</span> · ${money(tt.result)}` : esc(t("Gotowe · wynik {m}", { m: money(tt.result) }));
      if (this.saving) $$("[data-save]").forEach(b => { b.disabled = true; });
    },

    /** Oryginał / korekta / różnica / wpływ na stan / stan przed i po. */
    correctionPreview(plan) {
      const box = $("#corr-preview"); if (!box) return;
      const pc = this.corrPlan;
      if (!plan.ok) { box.innerHTML = `<p class="muted">${esc(t("Popraw błędy formularza — podgląd korekty pojawi się automatycznie."))}</p>`; $("#corr-badge").innerHTML = `<span class="badge err">${esc(t("błędy"))}</span>`; return; }
      if (!pc || !pc.ok) {
        const noChange = pc && pc.code === "NO_CHANGE";
        box.innerHTML = `<div class="info-line ${noChange ? "" : "err"}">${ic("alert", 15)}<span>${esc(pc ? pc.error : t("Brak podglądu"))}</span></div>`;
        $("#corr-badge").innerHTML = noChange ? `<span class="badge">${esc(t("bez zmian"))}</span>` : `<span class="badge err">${esc(t("odrzucona"))}</span>`; return;
      }
      const name = id => (App.product(id) || {}).name || "—";
      $("#corr-badge").innerHTML = `<span class="badge ${pc.descriptiveOnly ? "info" : "warn"}">${esc(pc.descriptiveOnly ? t("korekta opisowa") : pc.deltas.length ? t("korekta ilościowa") : t("korekta wartościowa"))}</span>`;
      const ch = pc.changes.map(c => `<tr><td>${esc(t(c.label))}</td><td class="r">${esc(c.beforeText)}</td><td class="r"><b>${esc(c.afterText)}</b></td><td class="r">${c.diff !== null ? `<span class="${c.diff < 0 ? "neg" : "pos"}">${c.diff > 0 ? "+" : ""}${esc(fmtQ(c.diff, 6))}${c.unit ? " " + esc(c.unit) : ""}</span>` : esc(t("zmiana"))}</td></tr>`).join("");
      const eff = pc.deltas.map(x => `<tr><td>${esc(name(x.productId))}<br><small class="dim">${esc(App.whName(x.whId))} · ${esc(t(R.CATS[x.cat] || x.cat))}${x.direct ? " " + esc(t("(bezp.)")) : ""}</small></td><td class="r"><span class="${x.qty < 0 ? "neg" : "pos"}">${x.qty > 0 ? "+" : ""}${esc(App.qtyNative(x.qty, x.productId, 6))}</span></td><td class="r">${esc(App.qtyNative(x.before, x.productId))}</td><td class="r"><b>${esc(App.qtyNative(x.after, x.productId))}</b></td></tr>`).join("");
      const VD = { purchaseCost: N_("Koszt zakupu"), rawCost: N_("Koszt surowca"), chippingCost: N_("Koszt rąbania"), extraCost: N_("Operacje dodatkowe"), revenue: N_("Przychód"), transportCost: N_("Transport") };
      const vd = Object.entries(pc.valueDelta).filter(([k, v]) => Math.abs(v) > 0.004 && k !== "result").map(([k, v]) => `<dt>${esc(t(VD[k] || k))}</dt><dd><span class="${v < 0 ? "neg" : "pos"}">${v > 0 ? "+" : ""}${money(v)}</span></dd>`).join("");
      box.innerHTML = `<div class="tbl-wrap"><table class="tbl" id="corr-changes"><thead><tr><th>${esc(t("Pole"))}</th><th class="r">${esc(t("Oryginał"))}</th><th class="r">${esc(t("Korekta"))}</th><th class="r">${esc(t("Różnica"))}</th></tr></thead><tbody>${ch || `<tr><td colspan="4" class="dim">${esc(t("Zmiana wyłącznie wyliczeń (koszt / wartość)."))}</td></tr>`}</tbody></table></div>
        <h4 class="mini-h">${esc(t("Wpływ na stan (dokument KOR z datą {d})", { d: Dates.pl(App.today()) }))}</h4>
        ${eff ? `<div class="tbl-wrap"><table class="tbl" id="corr-effect"><thead><tr><th>${esc(t("Produkt"))}</th><th class="r">${esc(t("Zmiana"))}</th><th class="r">${esc(t("Stan przed"))}</th><th class="r">${esc(t("Stan po"))}</th></tr></thead><tbody>${eff}</tbody></table></div>` : `<p class="muted">${esc(t("Brak wpływu na stan magazynowy."))}</p>`}
        ${vd ? `<h4 class="mini-h">${esc(t("Różnica wartości"))}</h4><dl class="money-list">${vd}<dt class="total">${esc(t("Wynik operacji"))}</dt><dd class="total">${money(pc.totalsBefore.result)} → ${money(pc.totalsAfter.result)}</dd></dl>` : ""}`;
    },

    fieldLabel(key) {
      if (key.startsWith("transport.train.wagonT.")) return t("Wagon {n}: ", { n: +key.split(".").pop() + 1 });
      const box = document.querySelector(`[data-field="${key}"]`);
      const lab = box && box.querySelector(":scope > label, :scope > .lbl");
      const txt = lab ? lab.textContent.replace("*", "").replace(/ /g, " ").trim() : "";
      return txt ? txt + ": " : "";
    },
    reasonMsg(show, text) {
      const m = $("#corr-reason-msg"); if (!m) return;
      m.classList.toggle("hidden", !show); m.innerHTML = show ? ic("alert", 13) + `<span>${esc(text)}</span>` : "";
    },
    /** Powód korekty w postaci kanonicznej: „kategoria — opis” (kategoria tłumaczona przy wyświetlaniu). */
    reasonValue() {
      const r = this.corr.reason, tx = this.corr.reasonText.trim();
      if (!r) return { error: t("Wybierz powód korekty") };
      if (r === "inny" && !tx) return { error: t("Opisz powód korekty") };
      return { value: tx ? `${r} — ${tx}` : r };
    },

    async saveDraft() {
      if (this.saving || this.mode !== "new") return;
      const d = R.clone(this.draft); delete d._user;
      const res = await Store.exec("draft.save", { draft: d }, SRC_NEW);
      if (!res.ok) { Toast.err(t("Nie zapisano wersji roboczej"), res.error); return; }
      this.draft.draftId = res.id; this.persist();
      Toast.ok(t("Zapisano wersję roboczą"), t("Bez numeru dokumentu i bez wpływu na stan. Znajdziesz ją w „Operacjach”."));
      App.render();
    },

    /** Zatwierdzenie: walidacja → podsumowanie → potwierdzenie → zapis atomowy (jeden raz). */
    async save() {
      if (this.saving) return;
      this.showAll = true;
      const plan = this.refresh();
      if (!plan) return;
      if (!plan.ok) {
        Toast.err(t("Nie można zatwierdzić — popraw formularz"), this.fieldLabel(plan.errorList[0].field) + plan.errorList[0].msg);
        const el = document.getElementById(fid(plan.errorList[0].field)) || document.querySelector(`[data-field="${plan.errorList[0].field}"]`);
        if (el) { el.scrollIntoView({ block: "center" }); if (el.focus) el.focus({ preventScroll: true }); }
        return;
      }
      if (this.mode === "correct") return this.confirmCorrection();
      const action = this.action();
      const ok = await this.confirmDialog(plan, action);
      if (!ok) return;
      this.saving = true;
      $$("[data-save]").forEach(b => { b.disabled = true; b.dataset.label = b.innerHTML; b.innerHTML = esc(t("Zapisywanie…")); });
      const draft = R.clone(this.draft); delete draft._user;
      const res = action === "approve" ? await Store.exec("op.approve", { id: this.review.id, draft }, SRC_REVIEW)
        : await Store.exec(action === "submit" ? "op.submit" : "op.commit", { draft }, SRC_NEW);
      this.saving = false;
      $$("[data-save]").forEach(b => { b.disabled = false; if (b.dataset.label) b.innerHTML = b.dataset.label; });
      if (!res || !res.ok) { Toast.err(t("Nie zapisano — nic nie zostało zaksięgowane"), res ? res.error : t("Nieznany błąd")); this.refresh(); return; }
      if (action === "submit" && res.pending) {
        Toast.ok(t("Przekazano do zatwierdzenia"), t("Kierownik magazynu {w} zobaczy operację w kolejce „Do zatwierdzenia”.", { w: App.whName(this.whId()) }));
        this.reset(); App.go("operacje"); return;
      }
      if (action === "approve") { this.review = null; this.draft = null; }
      if (res.duplicate) Toast.info(t("Operacja była już zapisana"), t("Ochrona przed podwójnym zapisem — nie powstały nowe dokumenty."));
      else Toast.ok(t("Dokument zatwierdzony"), res.op.documents.map(x => x.no).join(" · "));
      const op = res.op;
      if (action === "approve") { location.hash = "#/operacje"; App.render(); root.OpDetail.open(op.id, { justSaved: true }); return; }
      const keep = { type: this.draft.type, direct: this.draft.sale.direct, from: this.draft.mm && this.draft.mm.fromWhId };
      this.reset();
      this.draft.type = keep.type; this.draft.sale.direct = keep.direct;
      if (keep.type === "MM") this.draft.mm.fromWhId = keep.from || App.user().whId;
      if (keep.type === "PRODUKCJA" || keep.direct) PRESETS[keep.type === "PRODUKCJA" ? "produkcja" : "bezposrednia"](this.draft);
      this.draft.transport.place = this.defaultPlace();
      this.persist();
      App.render();
      root.OpDetail.open(op.id, { justSaved: true });
    },

    /** Okno podsumowania przed zatwierdzeniem. */
    /** Odrzucenie operacji przekazanej do zatwierdzenia (powód wymagany; wraca do autora jako wersja robocza). */
    async reject() {
      if (!this.review) return;
      const r = await Modal.confirm({ title: t("Odrzucić operację?"), text: t("Operacja wróci do autora ({u}) jako wersja robocza z Twoim komentarzem.", { u: this.review.userName }), ok: t("Odrzuć"), danger: true, input: { label: t("Powód odrzucenia"), required: true } });
      if (!r.ok) return;
      const res = await Store.exec("op.reject", { id: this.review.id, reason: r.value }, SRC_REVIEW);
      if (!res.ok) return Toast.err(t("Nie odrzucono"), res.error);
      Toast.ok(t("Operacja odrzucona"), t("Autor zobaczy powód przy wersji roboczej."));
      this.review = null; this.draft = null; App.go("operacje");
    },
    confirmDialog(plan, action = "commit") {
      return new Promise(resolve => {
        const S = Store.state, cfg = S.config, n = plan.norm, X = n.production;
        const name = id => (App.product(id) || {}).name || "—";
        const kv = [];
        const add = (k, v) => { if (v !== undefined && v !== null && v !== "") kv.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`); };
        add(t("Rodzaj"), esc(t(R.OP_TYPES[plan.type].label) + (n.sale && n.sale.direct ? " — " + t("sprzedaż bezpośrednia") : "")));
        add(t("Magazyn"), esc(App.whName(plan.whId)));
        add(t("Data"), esc(Dates.pl(plan.date)));
        add(t("Użytkownik"), esc(plan.user.name));
        if (n.purchase) { add(t("Dostawca"), esc(n.purchase.supplierName) + (n.purchase.newSupplier ? ` <span class="badge info">${esc(t("nowy — zostanie dodany do kartoteki"))}</span>` : "")); add(t("Zakup"), `${esc(fmtQ(n.purchase.qty))} ${Units.label(n.purchase.unit)} ${esc(name(n.purchase.productId))}${n.purchase.priceUnit && n.purchase.priceUnit !== n.purchase.unit ? ` = ${esc(fmtQ(n.purchase.priceQty))} ${Units.label(n.purchase.priceUnit)}` : ""} × ${fmt(n.purchase.price)} zł/${Units.label(n.purchase.priceUnit || n.purchase.unit)} = <b>${money(n.purchase.cost)}</b>`); }
        if (X) {
          const raw = App.product(X.rawProductId), outP = App.product(X.outProductId);
          if (raw) add(X.mode === "direct" ? t("Surowiec (z lasu, nie ze stanu)") : t("Surowiec"), esc(raw.name));
          if (raw && X.consumeQty !== null) add(t("Zużycie surowca"), `<b>${esc(App.qtyNative(X.consumeQty, raw.id, 6))}</b>${X.factor && X.mode !== "chain" ? ` <small class="dim">(${fmtQ(X.outQty, 6)} ÷ ${fmtQ(X.factor)})</small>` : ""}`);
          if (outP) add(t("Produkt wyjściowy"), `${esc(outP.name)} — <b>${esc(App.qtyNative(X.outQty, outP.id, 6))}</b>`);
          if (outP) { const o = Units.orient(X.outQty, outP, cfg); add(t("Masa · energia (orientacyjnie)"), `≈ ${fmt(o.t, 2)} t · ≈ ${fmt(o.gj, 1)} GJ`); }
          if (X.outUnit === "MP") add(t("Cena za rąbanie / koszt"), `${fmt(X.chipRate)} zł/MP → <b>${money(X.chippingCost)}</b>`);
          if (X.chipperName) add(t("Rębak"), esc(X.chipperOwner === "external" ? `${X.chipperName} — ${X.chipperCompany}${X.operatorName ? " · " + X.operatorName : ""}` : `${X.chipperName}${X.operatorName ? " · " + X.operatorName : ""}`));
        }
        if (n.extras && n.extras.length) add(t("Operacje dodatkowe"), n.extras.map(x => `${esc(x.typeName)}${x.reg ? ` <small class="dim">(${esc(x.reg)})</small>` : ""}: <b>${money(x.cost)}</b>${x.desc ? ` <small class="dim">— ${esc(x.desc)}</small>` : ""}`).join("<br>"));
        const nos = plan.documents.filter(dc => dc.manualNo).map(dc => `${dc.type}: <b>${esc(dc.manualNo)}</b>`);
        add(t("Numery dokumentów"), nos.length ? nos.join(" · ") + ` <small class="dim">${esc(t("(ręczne)"))}</small>` : esc(t("automatyczne")));
        if (n.docDate && n.docDate !== plan.date && plan.documents.some(dc => R.DOC_NO_TYPES.includes(dc.type))) add(t("Data dokumentu"), esc(Dates.pl(n.docDate)));
        if (n.sale) { add(t("Odbiorca"), esc((App.partner(n.sale.buyerId) || {}).name)); add(t("Sprzedaż"), `${esc(fmtQ(n.sale.qty))} ${Units.label(n.sale.unit)} | ${esc(fmt(n.sale.weightT, 2))} t | ${esc(t(R.WEIGHT_SOURCES[n.sale.weightMode] || "AUTO"))} → <b>${money(n.sale.revenue)}</b>`); }
        if (n.mm) {
          add(t("Przesunięcie"), `${esc(App.whName(plan.whId))} → <b>${esc(n.mm.toWhName)}</b>: ${esc(fmtQ(n.mm.qty))} ${Units.label(n.mm.unit)} ${esc(name(n.mm.productId))}`);
          add(t("Tonaż"), `${esc(fmtQ(n.mm.weightT))} t ${n.mm.weightMode === "manual" ? esc(t("(z wagi)")) : esc(t("(z przelicznika)"))}`);
          add(t("Tryb MM"), n.mm.twoStage ? `<span class="badge warn">${esc(t("W DRODZE"))}</span> ${esc(t("stan magazynu docelowego wzrośnie po przyjęciu MM"))}` : esc(t("jednoetapowy — przychód w magazynie docelowym od razu")));
        }
        if (n.transport.mode !== "none") add(t("Transport"), `${esc(t(R.TRANSPORT_MODES[n.transport.mode]))} — ${esc(transportText(n.transport))} · ${money(n.transport.cost)}`);
        if (plan.type !== "PRODUKCJA") add(t("Miejsce transportu"), esc(n.transport.place));
        add(t("Wynik operacji"), `<b>${money(plan.totals.result)}</b>`);
        const bal = plan.balances.map(b => `<tr><td>${esc(name(b.productId))}<br><small class="dim">${esc(App.whName(b.whId))}</small></td><td class="r">${esc(App.qtyNative(b.before, b.productId))}</td><td class="r"><span class="${b.after < b.before ? "neg" : "pos"}">${b.after - b.before > 0 ? "+" : ""}${esc(fmtQ(b.after - b.before, 6))}</span></td><td class="r"><b>${esc(App.qtyNative(b.after, b.productId))}</b></td></tr>`).join("");
        let done = false;
        const m = Modal.open({
          title: action === "submit" ? t("Podsumowanie przed przekazaniem") : t("Podsumowanie przed zatwierdzeniem"),
          sub: esc(action === "submit" ? t("Operacja trafi do kierownika magazynu. Numer dokumentu i zmiana stanów nastąpią dopiero po zatwierdzeniu.") : t("Sprawdź dane — po zatwierdzeniu dokument otrzyma numer i status ZATWIERDZONY. Zmiany później wyłącznie przez korektę lub anulowanie.")), wide: true, id: "confirm-op",
          body: `<div class="grid g2 confirm-grid"><dl class="money-list">${kv.join("")}</dl>
            <div><h4 class="mini-h">${esc(t("Stan magazynowy"))}</h4><div class="tbl-wrap"><table class="tbl" id="confirm-bal"><thead><tr><th>${esc(t("Produkt"))}</th><th class="r">${esc(t("Przed"))}</th><th class="r">${esc(t("Zmiana"))}</th><th class="r">${esc(t("Po"))}</th></tr></thead><tbody>${bal}</tbody></table></div>
            <h4 class="mini-h">${esc(t("Dokumenty"))}</h4><p>${plan.documents.some(d => d.series) ? `<span class="badge">${esc(R.DOC_SERIES)}</span> <small class="dim">${esc(plan.documents.map(d => t(R.DOC_LABEL[d.type] || d.type)).join(" · "))}</small>` : plan.documents.map(d => `<span class="badge">${d.type}</span>`).join(" ")}</p>
            ${plan.warnings.length ? `<ul class="warn-list mt3">${plan.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}</div></div>`,
          footer: `<button class="btn ghost" type="button" data-no>${esc(t("Wróć do edycji"))}</button><button class="btn primary" type="button" data-yes id="confirm-yes">${ic("check", 15)} ${esc(action === "submit" ? t("Przekaż do zatwierdzenia") : t("Zatwierdź dokument"))}</button>`,
          onClose: () => { if (!done) resolve(false); }
        });
        $("[data-no]", m.el).onclick = () => m.close();
        $("[data-yes]", m.el).onclick = e => { e.currentTarget.disabled = true; done = true; m.close(); resolve(true); };
      });
    },

    async confirmCorrection() {
      const rv = this.reasonValue();
      if (rv.error) { this.reasonMsg(true, rv.error); Toast.err(t("Podaj powód korekty — pole nie może być puste"), rv.error); const el = $("#corr-reason"); if (el) el.focus(); return; }
      const pc = this.corrPlan;
      if (!pc || !pc.ok) { Toast.err(t("Korekta odrzucona"), pc ? pc.error : t("Brak podglądu")); return; }
      const op = this.op;
      const ok = await Modal.confirm({ title: t("Zatwierdzić korektę dokumentu {no}?", { no: op.no }), text: t("Powstanie dokument KOREKTA z datą {d}. Powód: {r}. Dokument pierwotny pozostaje w historii ze statusem SKORYGOWANY.", { d: Dates.pl(App.today()), r: R.trReason(rv.value) }), ok: t("Zatwierdź korektę") });
      if (!ok.ok) return;
      this.saving = true;
      const draft = R.clone(this.draft); delete draft._corrOf; delete draft._corrRev; delete draft._user;
      const res = await Store.exec("op.correct", { opId: op.id, draft, reason: rv.value, corrKey: this.corr.key }, SRC_CORR);
      this.saving = false;
      if (!res.ok) { Toast.err(t("Korekta odrzucona — nic nie zapisano"), res.error); this.refresh(); return; }
      Toast.ok(t("Korekta zatwierdzona"), `${res.no || ""} → ${op.no}`);
      this.draft = null; this.mode = "new";
      location.hash = "#/operacje";
      setTimeout(() => root.OpDetail.open(op.id), 30);
    }
  };

  /** Podsumowanie kursów (transport własny i zewnętrzny): ilość, tony, km, koszt. */
  function runsSummary(T) {
    if (!T.runs || !T.runs.length) return "—";
    const U = Units.label(T.qtyUnit || ""), mixed = T.mode === "mixed";
    // kolumna „Przewoźnik”: transport mieszany albo kilka firm zewnętrznych
    const multiCo = !mixed && T.mode === "external" && new Set(T.runs.map(r => String(r.company || "").toLowerCase()).filter(Boolean)).size > 1, showWho = mixed || multiCo;
    const kw = T.runs.some(r => r.kwit || (r.kwitM3 !== null && r.kwitM3 !== undefined));
    const who = r => (r.kind || T.mode) === "own" ? t("Flota własna") : (r.company || T.company || t("Firma zewnętrzna"));
    const drv = r => ((r.kind || T.mode) === "own" ? r.driverName : r.driver) || "—";
    const basis = r => (r.kind || T.mode) === "own" || r.costBasis === "km × stawka" ? `${fmt(r.rate)} zł/km` : esc(t(r.costBasis));
    const part = P => P ? `${P.runs.length} × ${P.kind === "own" ? esc(t("flota własna")) : esc(P.company || t("firma zewnętrzna"))}: ${fmtQ(P.totalQty)} ${U}, ${money(P.cost)}` : "";
    const lead = showWho ? 4 : 3;
    // zapełnienie naczepy / kontenerów (MP w kursie ÷ pojemność pojazdu z kartoteki)
    const fillOn = T.runs.some(r => r.fillPct !== null && r.fillPct !== undefined);
    const fillCell = r => r.fillPct === null || r.fillPct === undefined ? `<td class="r dim">—</td>` : `<td class="r nowrap ${r.fillPct > 100 ? "neg" : r.fillPct >= 85 ? "pos" : ""}" title="${esc(t("{q} MP z {c} MP", { q: fmtQ(r.qtyMP || 0), c: fmtQ(r.capacityMP || 0) }))}">${fmt(r.fillPct, 1)}%</td>`;
    const over = T.limitQty > 0 && T.totalQty > T.limitQty + R.EPS;
    const th = s => esc(t(s));
    return `<div class="tbl-wrap"><table class="tbl" id="runs-summary"><thead><tr><th>${th("Kurs")}</th>${showWho ? `<th>${th("Przewoźnik")}</th>` : ""}<th>${th("Pojazd")}</th><th>${th("Kierowca")}</th>${kw ? `<th>${th("Kwit wywozowy")}</th><th class="r">m³</th>` : ""}<th class="r">km</th><th class="r">${th("Rozliczenie")}</th><th class="r">${th("Ilość")}</th><th class="r">${kw ? th("Tony") : th("Waga rzecz.")}</th>${fillOn ? `<th class="r">${th("Zapełnienie")}</th>` : ""}<th class="r">${th("Koszt")}</th></tr></thead><tbody>
      ${T.runs.map(r => `<tr data-run-kind="${esc(r.kind || T.mode)}"><td>${r.no}</td>${showWho ? `<td>${esc(who(r))}</td>` : ""}<td>${esc(r.reg || "—")}</td><td>${esc(drv(r))}</td>${kw ? `<td class="mono nowrap">${esc(r.kwit || "—")}</td><td class="r">${r.kwitM3 !== null && r.kwitM3 !== undefined ? fmtQ(r.kwitM3) : "—"}</td>` : ""}<td class="r">${fmtQ(r.km)}</td><td class="r">${basis(r)}</td><td class="r">${fmtQ(r.qty)} ${U}</td><td class="r">${r.weightT !== null ? fmtQ(r.weightT) + " t" : "—"}</td>${fillOn ? fillCell(r) : ""}<td class="r">${money(r.cost)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="${lead}">${esc(t("Razem: {x}", { x: tp("{n} kurs|{n} kursy|{n} kursów", T.runs.length) }))}${T.mode === "external" ? ` · ${esc(T.company || "")}` : ""}</td>${kw ? `<td></td><td class="r" data-runs-m3>${T.totalM3 !== null && T.totalM3 !== undefined ? fmtQ(T.totalM3) + " m³" : "—"}</td>` : ""}<td class="r">${fmtQ(T.km)}</td><td></td><td class="r" data-runs-qty>${fmtQ(T.totalQty)} ${U}</td><td class="r" data-runs-t>${T.totalWeightT !== null ? fmtQ(T.totalWeightT) + " t" : "—"}${T.weightMissing && T.totalWeightT !== null ? ` <small class="dim">${esc(t("(bez {n})", { n: T.weightMissing }))}</small>` : ""}</td>${fillOn ? `<td class="r nowrap" data-runs-fill>${T.avgFillPct !== null && T.avgFillPct !== undefined ? esc(t("śr. {p}%", { p: fmt(T.avgFillPct, 1) })) : "—"}</td>` : ""}<td class="r" data-runs-cost>${money(T.cost)}${T.includedInPrice && !mixed ? ` <small class="dim">${esc(t("(wliczony w cenę)"))}</small>` : ""}</td></tr></tfoot></table></div>
      ${T.limitQty > 0 ? `<p class="help mt2" data-runs-limit>${t("Ilość do przewiezienia: <b>{a}</b> · w kursach: <b>{b}</b>", { a: `${fmtQ(T.limitQty)} ${U}`, b: `${fmtQ(T.totalQty)} ${U}` })} · <span class="${over ? "neg" : T.remainingQty > R.EPS ? "" : "pos"}">${esc(over ? t("przekroczono o {q}", { q: `${fmtQ(-T.remainingQty)} ${U}` }) : T.remainingQty > R.EPS ? t("pozostało {q}", { q: `${fmtQ(T.remainingQty)} ${U}` }) : t("wszystko rozwiezione ✓"))}</span></p>` : ""}
      ${multiCo && T.companies && T.companies.length ? `<p class="help mt2" data-runs-companies>${T.companies.map(c => `${esc(c.company)}: ${tp("{n} kurs|{n} kursy|{n} kursów", c.runs)}, ${fmtQ(c.qty)} ${U}, ${money(c.cost)}`).join(" · ")}</p>` : ""}
      ${mixed ? `<p class="help mt2" data-runs-split>${part(T.own)} · ${part(T.external)}${T.external.includedInPrice ? " " + esc(t("(wliczony w cenę)")) : ""}</p>` : ""}`;
  }
  function transportText(x) {
    if (x.mode === "mixed") return t("własny {a} × · {c} {b} × · {q}", { a: x.own.runs.length, c: x.external.company || t("zewnętrzny"), b: x.external.runs.length, q: `${fmtQ(x.totalQty)} ${Units.label(x.qtyUnit || "")}` });
    if (x.mode === "own") { const n = (x.runs || [x]).length; return (n > 1 ? tp("{n} kurs|{n} kursy|{n} kursów", n) + " · " : "") + ([x.reg, x.driverName].filter(Boolean).join(" · ") || t("uzupełnij pojazd")); }
    if (x.mode === "external") { const n = (x.runs || [x]).length; return [x.company, n > 1 ? tp("{n} kurs|{n} kursy|{n} kursów", n) : "", x.reg].filter(Boolean).join(" · ") || t("uzupełnij przewoźnika"); }
    if (x.mode === "train") return [x.trainNo, t("{n} wag.", { n: x.wagonCount }), `${fmtQ(x.totalT)} t`].filter(Boolean).join(" · ");
    if (x.mode === "supplier") return t("dostawca: {c} — koszt w cenie zakupu", { c: x.company || "—" });
    return "";
  }

  Views.nowa = {
    html(params) {
      if (Form.mode !== "new") Form.draft = null;
      if (params.repeat && Form.repeatFrom(params.repeat)) { history.replaceState(null, "", "#/nowa"); return Form.html(params); }
      Form.ensureDraft(params.preset, params.draft);
      if (params.preset || params.draft) history.replaceState(null, "", "#/nowa");
      return Form.html(params);
    },
    bind(page) { Form.bind(page); }
  };
  Views.korekta = {
    html(params) { Form.startCorrection(params.op); return Form.html(params); },
    bind(page) { Form.bind(page); }
  };

  Object.assign(UI, { Form, transportText, runsSummary, CANCEL_REASONS, PRESETS });
  root.RIWForm = Form;
})(typeof globalThis !== "undefined" ? globalThis : this);
