/* =========================================================================
   Warstwa S: dane startowe.
   * build()   — dane przykładowe (szkolenie, testy): 3 magazyny RiC, konta
                 e-mail firmowe, flota przypisana do magazynów, operacje wzorcowe.
                 Operacje przechodzą przez ten sam silnik co formularz — dane są
                 spójne z regułami (salda, numeracja, audyt).
   * minimal() — start firmy: 3 magazyny, katalog produktów, administrator.
   ========================================================================= */
(function (root) {
  "use strict";
  const RIW = root.RIW;
  const N_ = s => s;

  /** Magazyny firmy (start firmy i dane przykładowe). */
  const WAREHOUSES = [
    { id: "wh_zab", code: "ZAB", name: "RiC Zabrze", address: "ul. Gwarecka 16, 41-800 Zabrze", active: true },
    { id: "wh_bra", code: "BRA", name: "RiC Brąszewice", address: "Brąszewice", active: true },
    { id: "wh_rok", code: "ROK", name: "RiC Rokitki", address: "Rokitki", active: true }
  ];
  /** Konto administratora (e-mail firmowy) — pierwsze logowanie. */
  const ADMIN_EMAIL = "magazyn@resinvest.group";

  /** Kartoteka „Dodatkowe operacje” — pozycje startowe (stawki domyślne można zmienić w programie). */
  function extraTypes(rates) {
    const ts = "2026-08-01T08:00:00.000Z";
    return RIW.DEFAULT_EXTRA_TYPES.map(x => Object.assign({}, x, { rate: rates && rates[x.id] !== undefined ? rates[x.id] : x.rate, active: true, createdAt: ts, updatedAt: ts, createdBy: "System" }));
  }
  function base() {
    const s = RIW.emptyState(root.RIW_CONFIG || null);
    s.extraTypes = extraTypes({ xt_pryzmy: 180, xt_ladowarka: 160 });
    s.warehouses = WAREHOUSES.map(w => Object.assign({}, w));
    // konto: e-mail firmowy = login; magazyn domyślny (whId) + przydzielone (warehouseIds); status konta
    const U = (id, email, name, role, whId, more) => {
      const [firstName, ...rest] = name.split(" ");
      return Object.assign({ id, login: email, email, name, firstName, lastName: rest.join(" "), role, whId, warehouseIds: [whId], status: "ACTIVE", active: true, lang: "", theme: "", notifyAllowed: [], notify: { events: [], email: true } }, more || {});
    };
    // powiadomienia: zgody administratora (notifyAllowed) i zdarzenia włączone przez użytkownika (notify.events)
    const NT = (allowed, enabled) => ({ notifyAllowed: allowed, notify: { events: enabled, email: true } });
    const MGR = ["PZ", "WZ", "PW", "MM", "EXTRA", "APPROVAL", "CORRECTION", "CANCEL", "DELETE"];
    s.users = [
      U("u_admin", ADMIN_EMAIL, "Mateusz Roesner", "admin", "wh_zab", NT([], ["MM", "CORRECTION", "CANCEL", "DELETE"])),
      U("u_kier", "anna.gorska@resinvest.group", "Anna Górska", "kierownik", "wh_zab", Object.assign({ warehouseIds: ["wh_zab", "wh_bra"] }, NT(MGR, ["PZ", "WZ", "MM", "APPROVAL", "CORRECTION", "CANCEL", "DELETE"]))),
      U("u_mag", "adrian.wojciechowski@resinvest.group", "Adrian Wojciechowski", "magazynier", "wh_zab", NT(["MM", "DECISION", "CORRECTION"], ["MM", "DECISION"])),
      U("u_kbra", "tomasz.zajac@resinvest.group", "Tomasz Zając", "kierownik", "wh_bra", NT(MGR, MGR)),
      U("u_bra", "pawel.kaczmarek@resinvest.group", "Paweł Kaczmarek", "magazynier", "wh_bra", NT(["MM", "DECISION"], ["MM", "DECISION"])),
      U("u_krok", "michal.lewandowski@resinvest.group", "Michał Lewandowski", "kierownik", "wh_rok"),
      U("u_rok", "karolina.wisniewska@resinvest.group", "Karolina Wiśniewska", "magazynier", "wh_rok"),
      U("u_view", "beata.nowak@resinvest.group", "Beata Nowak", "obserwator", "wh_zab"),
      U("u_aud", "ewa.krawczyk@resinvest.group", "Ewa Krawczyk", "audytor", "wh_zab"),
      // zaproszenie wysłane, konto jeszcze nieaktywne (nie może się zalogować)
      U("u_inv", "jan.mazur@resinvest.group", "Jan Mazur", "magazynier", "wh_rok", { status: "INVITED", active: false, invitedAt: "2026-09-20T08:00:00.000Z" })
    ];
    s.products = [
      { id: "pr_drewno", code: "DRW-O", name: "Drewno opałowe", cat: "drewno", unit: "m3", active: true },
      { id: "pr_drewno_inw", code: "DRW-I", name: "Drewno z wycinki inwestycyjnej", cat: "drewno", unit: "m3", active: true },
      { id: "pr_zr_lesna", code: "ZR-PL", name: "Zrębka produkcyjna leśna", cat: "zrebka", unit: "MP", active: true },
      { id: "pr_zr_inw", code: "ZR-PI", name: "Zrębka produkcyjna inwestycyjna", cat: "zrebka", unit: "MP", active: true },
      { id: "pr_zr_tow", code: "ZR-T", name: "Zrębka towar", cat: "zrebka", unit: "MP", active: true },
      { id: "pr_pks", code: "PKS", name: "PKS (łupina palmowa)", cat: "agro", unit: "t", active: true },
      { id: "pr_lupina", code: "LUP-N", name: "Łupina nerkowca", cat: "agro", unit: "t", active: true }
    ];
    s.partners = [
      { id: "pa_lander", name: "Lander Agro", role: "supplier", kind: "firma", city: "Gliwice", active: true },
      { id: "pa_ndl_rr", name: "Nadleśnictwo Rudy Raciborskie", role: "supplier", kind: "nadlesnictwo", lesnictwa: ["Stanica", "Kuźnia", "Jankowice", "Rudy"], city: "Kuźnia Raciborska", active: true },
      { id: "pa_ndl_ryb", name: "Nadleśnictwo Rybnik", role: "supplier", kind: "nadlesnictwo", lesnictwa: ["Wielopole", "Paruszowiec", "Golejów"], city: "Rybnik", active: true },
      { id: "pa_drwal", name: "Usługi Leśne Drwal sp. z o.o.", role: "supplier", kind: "firma", city: "Gliwice", active: true },
      { id: "pa_ec_zab", name: "Elektrociepłownia Zabrze S.A.", role: "buyer", city: "Zabrze", active: true },
      { id: "pa_ec_kat", name: "EC Katowice — biomasa", role: "buyer", city: "Katowice", active: true },
      { id: "pa_ciep_ryb", name: "Ciepłownia Rybnik", role: "buyer", city: "Rybnik", active: true },
      { id: "pa_tartak", name: "Tartak Beskid s.c.", role: "both", kind: "firma", city: "Żywiec", active: true },
      { id: "pa_agro", name: "Biomass Trading B.V.", role: "supplier", kind: "firma", city: "Rotterdam", active: true },
      { id: "pa_elektrownia", name: "Elektrownia Łaziska", role: "buyer", city: "Łaziska Górne", active: true }
    ];
    s.carriers = ["ESI Logistics", "DAP Trans", "Transport Kowalski", "PKP Cargo"];
    s.fleet = {
      drivers: [
        { id: "dr_kowalski", name: "Jan Kowalski", phone: "600 100 200", whId: "wh_zab" },
        { id: "dr_nowak", name: "Piotr Nowak", phone: "600 300 400", whId: "wh_zab" },
        { id: "dr_wojcik", name: "Tomasz Wójcik", phone: "600 700 800", whId: "wh_zab" },
        { id: "dr_zielinski", name: "Marek Zieliński", phone: "600 500 600", whId: "wh_bra" },
        { id: "dr_kaminski", name: "Łukasz Kamiński", phone: "600 900 100", whId: "wh_rok" }
      ],
      vehicles: [
        { id: "ve_scania", name: "Scania R450 — ruchoma podłoga", reg: "SGL 4T821", type: "ruchoma_podloga", status: "aktywny", driverId: "dr_kowalski", whId: "wh_zab", body: "ruchoma_podloga", compartments: [{ name: "Naczepa", l: 13.4, w: 2.45, h: 2.8 }], capacityMP: 91.92 },
        { id: "ve_volvo", name: "Volvo FH 500 — ruchoma podłoga", reg: "SZA 12345", type: "ruchoma_podloga", status: "aktywny", driverId: "dr_nowak", whId: "wh_zab", body: "ruchoma_podloga", compartments: [{ name: "Naczepa", l: 13.6, w: 2.48, h: 2.9 }], capacityMP: 97.81 },
        { id: "ve_man", name: "MAN TGX — ciężarowy", reg: "SK 7788X", type: "ciezarowy", status: "serwis", driverId: "dr_zielinski", whId: "wh_bra" },
        { id: "ve_daf", name: "DAF XF 480 — ruchoma podłoga", reg: "ESR 4R210", type: "ruchoma_podloga", status: "aktywny", driverId: "dr_kaminski", whId: "wh_rok", body: "ruchoma_podloga", compartments: [{ name: "Naczepa", l: 13.4, w: 2.45, h: 2.8 }], capacityMP: 91.92 },
        // pojazdy firm zewnętrznych (flota zewnętrzna) — podpowiedzi w kursach transportu zewnętrznego, wspólne dla magazynów
        { id: "ve_ext_esi1", owner: "external", company: "ESI Logistics", name: "Scania — ruchoma podłoga", reg: "ESI 18734", type: "ruchoma_podloga", status: "aktywny", driverId: "", driverName: "Tomasz Lis", whId: "", body: "ruchoma_podloga", compartments: [{ name: "Naczepa", l: 13.4, w: 2.45, h: 2.8 }], capacityMP: 91.92 },
        { id: "ve_ext_esi2", owner: "external", company: "ESI Logistics", name: "Volvo — ruchoma podłoga", reg: "ESI 20511", type: "ruchoma_podloga", status: "aktywny", driverId: "", driverName: "Robert Kania", whId: "", body: "ruchoma_podloga", compartments: [{ name: "Naczepa", l: 13.4, w: 2.45, h: 3.0 }], capacityMP: 98.49 },
        { id: "ve_ext_dap1", owner: "external", company: "DAP Trans", name: "MAN — ruchoma podłoga", reg: "SZA 7K901", type: "ruchoma_podloga", status: "aktywny", driverId: "", driverName: "", whId: "", body: "ruchoma_podloga", compartments: [{ name: "Naczepa", l: 13.0, w: 2.45, h: 2.7 }], capacityMP: 86.0 },
        { id: "ve_ext_dap2", owner: "external", company: "DAP Trans", name: "DAF — wywrotka", reg: "SZA 7K902", type: "wywrotka", status: "aktywny", driverId: "", driverName: "", whId: "" },
        { id: "ve_ext_kow", owner: "external", company: "Transport Kowalski", name: "Mercedes Actros — ciężarowy", reg: "SPY 92FR", type: "ciezarowy", status: "aktywny", driverId: "", driverName: "Marek Kowalski", whId: "", body: "hakowiec", compartments: [{ name: "Kontener na samochodzie", l: 6.5, w: 2.4, h: 2.5 }, { name: "Kontener na przyczepie", l: 7.0, w: 2.4, h: 2.5 }], capacityMP: 81 }
      ],
      operators: [
        { id: "op_lis", name: "Krzysztof Lis", phone: "601 111 222", whId: "wh_zab" },
        { id: "op_mazur", name: "Adam Mazur", phone: "601 333 444", whId: "wh_bra" },
        { id: "op_dudek", name: "Rafał Dudek", phone: "601 555 666", whId: "wh_rok" }
      ],
      chippers: [
        { id: "ch_jenz", name: "Jenz HEM 583", owner: "own", status: "aktywny", operatorId: "op_lis", whId: "wh_zab" },
        { id: "ch_biber", name: "Eschlböck Biber 92", owner: "own", status: "aktywny", operatorId: "op_mazur", whId: "wh_bra" },
        { id: "ch_albach", name: "Albach Diamant 2000", owner: "own", status: "aktywny", operatorId: "op_dudek", whId: "wh_rok" },
        // rębak firmy zewnętrznej (usługa rębania) — dostępny we wszystkich magazynach
        { id: "ch_ext_drwal", name: "Bandit 2590XP", owner: "external", company: "Usługi Leśne Drwal sp. z o.o.", reg: "SGL 7Z412", status: "aktywny", operatorId: "", operatorName: "Zbigniew Kos", info: "Usługa rębania z operatorem; rozliczenie za MP", whId: "" }
      ]
    };
    return s;
  }

  function draftOf(date, over) {
    const d = RIW.blankDraft({ today: date });
    d.date = date;
    d.type = over.type || "ZAKUP";
    for (const k of ["purchase", "production", "sale", "mm"]) Object.assign(d[k], over[k] || {});
    if (over.extras) d.extras = { enabled: true, items: over.extras.map(x => Object.assign(RIW.blankExtra(), x)) };
    if (over.docNos) { Object.assign(d.docNos, over.docNos); for (const k of Object.keys(over.docNos)) if (over.docNos[k]) d.docNoMode[k] = "manual"; }
    if (over.docDate) d.docDate = over.docDate;
    // grupa dostawcy wynika z kartoteki kontrahenta, jeśli nie podano jej wprost
    if (over.purchase && !over.purchase.supplierKind) d.purchase.supplierKind = "";
    if (over.transport) {
      const t = over.transport;
      d.transport.mode = t.mode || "none";
      d.transport.place = t.place || "";
      if (t.own) {
        // zapis skrócony { vehicleId, km, … } = jeden kurs
        if (Array.isArray(t.own.runs)) Object.assign(d.transport.own, t.own);
        else d.transport.own = { runCount: "1", runs: [Object.assign(RIW.blankRun(), t.own)] };
      }
      if (t.external) {
        // zapis skrócony { company, reg, km, freight, includedInPrice } = jeden kurs z frachtem
        const X = t.external;
        if (Array.isArray(X.runs)) Object.assign(d.transport.external, X);
        else d.transport.external = { company: X.company || "", includedInPrice: !!X.includedInPrice, runCount: "1",
          runs: [Object.assign(RIW.blankExtRun(), { reg: X.reg || "", km: X.km || "", freight: X.includedInPrice ? "" : (X.freight || "") })] };
      }
      Object.assign(d.transport.train, t.train || {});
    }
    d.notes = over.notes || "";
    d.extDoc = over.extDoc || "";
    return d;
  }

  /** Buduje kompletny stan przykładowy. `today` — data „systemowa” (RRRR-MM-DD). */
  function build(today) {
    const s = base();
    const user = id => s.users.find(u => u.id === id);
    const ctx = (uid, date) => ({ user: user(uid), today: date, now: date + "T08:00:00.000Z", source: N_("Dane przykładowe") });

    // ilości w jednostce magazynowej produktu: drewno m³, zrębka MP, PKS / łupina t
    RIW.openingBalance(s, "wh_zab", "2026-08-01", [
      { productId: "pr_drewno", qty: 817 }, { productId: "pr_zr_lesna", qty: 8173 },
      { productId: "pr_zr_inw", qty: 120 }, { productId: "pr_zr_tow", qty: 200 },
      { productId: "pr_pks", qty: 728 }, { productId: "pr_lupina", qty: 728 }
    ], ctx("u_admin", "2026-08-01"));
    RIW.openingBalance(s, "wh_bra", "2026-08-01", [
      { productId: "pr_drewno", qty: 30 }, { productId: "pr_zr_lesna", qty: 250 }
    ], ctx("u_admin", "2026-08-01"));

    const ops = [
      ["u_mag", "2026-08-05", {
        purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "30", unit: "m3", price: "230" },
        production: { enabled: true, type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Stanica", kwit: "KW 0142/08/2026", chipperId: "ch_jenz" },
        // operacja dodatkowa: holowanie rębaka pojazdem z floty
        extras: [{ typeId: "xt_holowanie", vehicleId: "ve_scania", cost: "500", desc: "Holowanie rębaka z drogi leśnej" }],
        // trzy kursy własne z rębakiem w lesie → magazyn Zabrze; każdy kurs z własnym kwitem wywozowym (3 × 10 m³ × 4 = 120 MP)
        transport: { mode: "own", place: "RiC Zabrze", own: { runCount: "3", runs: [
          { vehicleId: "ve_scania", driverId: "", km: "45", rate: "5", kwit: "KW 0142/1/08/2026", kwitM3: "10", qty: "40", weightT: "13,4" },
          { vehicleId: "ve_volvo", driverId: "", km: "45", rate: "5", kwit: "KW 0142/2/08/2026", kwitM3: "10", qty: "40", weightT: "12,9" },
          { vehicleId: "ve_scania", driverId: "dr_wojcik", km: "45", rate: "5", kwit: "KW 0142/3/08/2026", kwitM3: "10", qty: "40", weightT: "13,1" }] } }
      }],
      ["u_mag", "2026-08-12", {
        purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "100", unit: "MP", price: "55" },
        // przewoźnik zewnętrzny, 2 kursy rozliczane km × stawka
        transport: { mode: "external", place: "RiC Zabrze", external: { company: "ESI Logistics", runCount: "2", runs: [
          { reg: "ESI 18734", driver: "Tomasz Lis", km: "80", rate: "5,50", freight: "", qty: "50", weightT: "16,4" },
          { reg: "ESI 20511", driver: "Robert Kania", km: "80", rate: "5,50", freight: "", qty: "50", weightT: "16,9" }] } }
      }],
      ["u_kier", "2026-08-20", {
        purchase: { supplierId: "pa_tartak", basis: "KZR", productId: "pr_drewno_inw", qty: "25", unit: "m3", price: "180" },
        production: { enabled: true, type: "inwestycyjna", investSite: "Obwodnica Gliwic — odcinek II", sourceDoc: "Protokół wycinki 17/2026", chipperId: "ch_jenz" },
        sale: { enabled: true, buyerId: "pa_ec_kat", qtyMP: "100", price: "95", priceUnit: "MP" },
        transport: { mode: "train", place: "EC Katowice — bocznica", train: { trainNo: "RC 44120", carrier: "PKP Cargo", docNo: "CIM 4412/08", loadPlace: "Bocznica Gliwice Port", wagonCount: "2", capUnit: "MP", capacity: "120", tonMode: "same", sameT: "16,5", price: "28", priceUnit: "t" } }
      }],
      ["u_mag", "2026-09-03", {
        // numer PZ wpisany ręcznie z dokumentu dostawcy; data dokumentu ≠ data przyjęcia
        docNos: { PZ: "PZ/11" }, docDate: "2026-09-02",
        purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230" },
        production: { enabled: true, type: "lesna", ndl: "Rybnik", lesnictwo: "Wielopole", kwit: "KW 0217/09/2026", chipperId: "ch_jenz" },
        sale: { enabled: true, buyerId: "pa_ec_zab", price: "90", priceUnit: "MP" },
        // jedna produkcja, dwa rodzaje transportu: 3 kursy flotą własną + 2 kursy firmą zewnętrzną (5 × 16 MP = 80 MP)
        transport: { mode: "mixed", place: "Elektrociepłownia Zabrze S.A.",
          own: { runCount: "3", runs: [
            { vehicleId: "ve_volvo", driverId: "", km: "26", rate: "5", kwit: "KW 0217/1/09/2026", kwitM3: "4", qty: "16", weightT: "5,4" },
            { vehicleId: "ve_scania", driverId: "", km: "26", rate: "5", kwit: "KW 0217/2/09/2026", kwitM3: "4", qty: "16", weightT: "5,2" },
            { vehicleId: "ve_volvo", driverId: "", km: "26", rate: "5", kwit: "KW 0217/3/09/2026", kwitM3: "4", qty: "16", weightT: "5,3" }] },
          external: { company: "DAP Trans", includedInPrice: false, runCount: "2", runs: [
            { reg: "SZA 7K901", driver: "Marek Pawlik", km: "26", rate: "6", freight: "", kwit: "KW 0217/4/09/2026", kwitM3: "4", qty: "16", weightT: "5,5" },
            { reg: "SZA 7K902", driver: "Leszek Mróz", km: "26", rate: "6", freight: "", kwit: "KW 0217/5/09/2026", kwitM3: "4", qty: "16", weightT: "5,1" }] } }
      }],
      ["u_bra", "2026-09-08", {
        purchase: { supplierKind: "nadlesnictwo", supplierId: "pa_ndl_ryb", lesnictwo: "Wielopole", basis: "DEKL", productId: "pr_drewno", qty: "15", unit: "m3", price: "210" },
        transport: { mode: "external", place: "RiC Brąszewice", external: { company: "Transport Kowalski", reg: "SPY 92FR", km: "40", includedInPrice: true } }
      }],
      // produkcja na magazynie: drewno ze stanu → zrębka na stan
      ["u_bra", "2026-09-10", {
        type: "PRODUKCJA",
        production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "40", chipperId: "ch_biber", chipRate: "10" },
        extras: [{ typeId: "xt_pryzmy", qty: "2", desc: "Podgarnianie pryzmy P2 po rębaniu" }, { typeId: "xt_plac", cost: "250" }],
        notes: "Rębanie na placu — pryzma P2", extDoc: "KP 12/09/2026"
      }],
      // sprzedaż z magazynu (WZ)
      ["u_bra", "2026-09-12", {
        type: "SPRZEDAZ",
        sale: { productId: "pr_zr_lesna", qty: "100", unit: "MP", buyerId: "pa_ciep_ryb", price: "85", weightMode: "manual", weightManual: "34,6" },
        transport: { mode: "external", place: "Ciepłownia Rybnik", external: { company: "DAP Trans", reg: "SZA 7K901", km: "35", freight: "650" } }
      }],
      // produkcja w lesie + sprzedaż bezpośrednia: stan zrębki bez zmian
      ["u_kier", "2026-09-15", {
        type: "SPRZEDAZ",
        // rąbanie w lesie usługą firmy zewnętrznej (rębak firmy Drwal z operatorem)
        production: { type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Kuźnia", kwit: "KW 0233/09/2026", rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "600", chipperId: "ch_ext_drwal", chipRate: "10" },
        sale: { direct: true, buyerId: "pa_elektrownia", qtyMP: "600", price: "88", priceUnit: "MP" },
        // operacja dodatkowa przy produkcji w lesie: podciągnięcie rębaka ciągnikiem z floty
        extras: [{ typeId: "xt_holowanie", vehicleId: "ve_scania", cost: "350", desc: "Podciągnięcie rębaka na składnicę" }],
        transport: { mode: "train", place: "Elektrownia Łaziska", train: { trainNo: "RC 50931", carrier: "PKP Cargo", docNo: "CIM 5093/09", loadPlace: "Bocznica Kuźnia Raciborska", wagonCount: "5", capUnit: "t", capacity: "60", tonMode: "each", wagonT: ["39,6", "39,8", "39,4", "39,7", "39,5"], price: "25", priceUnit: "t" } }
      }]
    ];
    ops.push(
      // przesunięcie międzymagazynowe (MM, dwuetapowe): wysłanie Zabrze → Brąszewice, przyjęcie w Brąszewicach tego samego dnia
      ["u_kier", "2026-09-16", {
        type: "MM", mm: { fromWhId: "wh_zab", productId: "pr_zr_tow", qty: "50", unit: "MP", toWhId: "wh_bra", weightMode: "manual", weightManual: "16,4" },
        transport: { mode: "own", place: "RiC Brąszewice", own: { vehicleId: "ve_scania", km: "28", rate: "5" } }
      }],
      // zakup wprowadzony omyłkowo — w danych przykładowych jest później anulowany
      ["u_bra", "2026-09-17", {
        purchase: { supplierId: "pa_agro", basis: "DEKL", productId: "pr_lupina", qty: "5", unit: "t", price: "610" },
        transport: { mode: "none", place: "RiC Brąszewice" }, notes: "Pomyłka — dostawa nie dotarła"
      }],
      // produkcja na magazynie z wczoraj (kwit produkcji dnia)
      ["u_bra", "2026-09-22", {
        type: "PRODUKCJA",
        // praca ładowarką (operacja dodatkowa, ilość × stawka z kartoteki)
        production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "20", chipperId: "ch_biber", chipRate: "10" },
        extras: [{ typeId: "xt_ladowarka", qty: "1,5", desc: "Załadunek rębaka" }],
        notes: "Pryzma P3"
      }]
    );
    const byNo = {};
    // powiadomienia z operacji wzorcowych — ten sam mechanizm co przy zatwierdzaniu w programie
    const N = RIW.Notify;
    const notify = (op, kind, c, extra) => { if (N) N.forOperation(s, op, kind, c, extra); };
    // obieg zatwierdzania jest domyślnie wyłączony — magazynier zatwierdza operację sam
    for (const [uid, date, over] of ops) {
      const c = ctx(uid, date);
      const r = RIW.commitOperation(s, draftOf(date, over), c);
      if (!r.ok) throw new Error("Dane przykładowe: " + r.error);
      byNo[`${over.type || "ZAKUP"}@${date}`] = r.op;
      notify(r.op, "create", c);
    }
    // przyjęcie MM przez magazyn docelowy (Brąszewice): pełna ilość, tonaż z wagi
    const mm = byNo["MM@2026-09-16"];
    if (RIW.mmState(mm) === "W_DRODZE") {
      const rr = RIW.receiveTransfer(s, mm.id, { qty: "50", unit: "MP", date: "2026-09-16", weightMode: "manual", weightManual: "16,2", note: "Kwit wagowy BR 0916/1" }, ctx("u_bra", "2026-09-16"));
      if (!rr.ok) throw new Error("Dane przykładowe (przyjęcie MM): " + rr.error);
      notify(rr.op, "mm-received", ctx("u_bra", "2026-09-16"));
    }
    // korekta ilościowa WZ (100 → 90 MP) i anulowanie błędnego zakupu — przez ten sam silnik
    const wz = byNo["SPRZEDAZ@2026-09-12"], cd = RIW.clone(wz.input);
    cd.sale.qty = "90"; cd.sale.weightManual = "31,1";
    const cKor = Object.assign(ctx("u_admin", "2026-09-14"), { user: Object.assign({}, user("u_admin"), { whId: "wh_bra" }) });
    let r = RIW.correctOperation(s, wz.id, cd, "błędnie wpisana ilość — kwit wagowy 90 MP", cKor);
    if (!r.ok) throw new Error("Dane przykładowe (korekta): " + r.error);
    notify(r.op, "correction", cKor, { no: r.no, correction: r.correction });
    const cAn = Object.assign(ctx("u_admin", "2026-09-18"), { user: Object.assign({}, user("u_admin"), { whId: "wh_bra" }) });
    r = RIW.cancelOperation(s, byNo["ZAKUP@2026-09-17"].id, cAn, "pomyłka operatora — dostawa nie dotarła");
    if (!r.ok) throw new Error("Dane przykładowe (anulowanie): " + r.error);
    notify(r.op, "cancel", cAn, { reason: "pomyłka operatora — dostawa nie dotarła" });
    // powiadomienia starsze niż tydzień przed „dziś” danych przykładowych — przeczytane
    const readBefore = RIW.Dates.addDays(today, -7);
    for (const n of s.notices) if (n.ts.slice(0, 10) < readBefore) { n.read = true; n.readAt = n.ts; }
    s.plans = samplePlans(s);
    s.meta.createdAt = new Date().toISOString();
    s.meta.lastMonthCheck = RIW.Dates.ym(today);
    s.meta.sample = true;
    return s;
  }

  /**
   * Plany zakupów [MP] (planer): RiC Zabrze — sierpień i wrzesień 2026 (dni robocze), RiC Brąszewice — kilka dni.
   * Wykonanie planer liczy z operacji wzorcowych (zakup z produkcją, produkcja w lesie, zakup zrębki).
   */
  function samplePlans(s) {
    const out = [], by = "Anna Górska", ts = "2026-08-01T07:30:00.000Z";
    const add = (whId, date, planMP, note) => out.push({ id: `pl_${whId}_${date}`, whId, date, planMP, note: note || "", version: 1, createdAt: ts, createdBy: by, updatedAt: ts, updatedBy: by, updatedById: "u_kier" });
    const special = { "2026-08-05": [120, "Nadl. Rudy Raciborskie — Stanica"], "2026-08-12": [100, "Zrębka towar — Usługi Leśne Drwal"], "2026-08-20": [120, "Wycinka — obwodnica Gliwic"],
      "2026-09-03": [80, "Nadl. Rybnik — Wielopole"], "2026-09-15": [600, "Nadl. Rudy Raciborskie — Kuźnia (pociąg do Łazisk)"] };
    for (let d = "2026-08-03"; d <= "2026-09-30"; d = RIW.Dates.addDays(d, 1)) {
      const wd = (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
      if (special[d]) add("wh_zab", d, special[d][0], special[d][1]);
      else if (wd < 5 && d >= "2026-09-01") add("wh_zab", d, 50);
    }
    add("wh_bra", "2026-09-10", 40, "Rębanie na placu — pryzma P2");
    add("wh_bra", "2026-09-22", 20, "Pryzma P3");
    return out;
  }

  /**
   * Start firmy (instalacja bez danych przykładowych): 3 magazyny RiC, katalog produktów,
   * administrator (e-mail firmowy). Pozostałe kartoteki uzupełnia się w programie.
   */
  function minimal(opts = {}) {
    const s = RIW.emptyState(root.RIW_CONFIG || null);
    const b = base();
    s.products = b.products;
    s.extraTypes = extraTypes();
    s.warehouses = WAREHOUSES.map(w => Object.assign({}, w));
    const email = String(opts.email || opts.login || ADMIN_EMAIL).trim().toLowerCase();
    const name = String(opts.name || "Administrator").trim(), [firstName, ...rest] = name.split(/\s+/);
    s.users = [{ id: "u_admin", login: email, email, name, firstName, lastName: rest.join(" "), role: "admin", whId: "wh_zab", warehouseIds: ["wh_zab"], status: "ACTIVE", active: true, lang: opts.lang || "", theme: "", notifyAllowed: [], notify: { events: [], email: true } }];
    s.carriers = [];
    if (opts.allowSelfRegistration !== undefined) s.config.allowSelfRegistration = !!opts.allowSelfRegistration;
    s.meta.createdAt = new Date().toISOString();
    s.meta.lastMonthCheck = RIW.Dates.ym(opts.today || RIW.Dates.localToday());
    return s;
  }

  RIW.Seed = { build, draftOf, minimal, WAREHOUSES, ADMIN_EMAIL };
})(typeof globalThis !== "undefined" ? globalThis : this);
