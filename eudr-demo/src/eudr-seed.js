/* eudr-seed.js */
/* =========================================================================
   ResInvest ERP 3.12 (demo EUDR) — dane przykładowe obrotu i EUDR

   Rozszerza R.Seed.build(today): po danych wzorcowych 3.11 (sierpień–wrzesień 2026)
   dopisuje transakcje z POPRZEDNIEGO i BIEŻĄCEGO miesiąca względem `today`
   (tylko dni ≤ dziś), żeby pulpit od razu pokazywał obrót miesiąca:
     * zakupy z nadleśnictw (różne leśnictwa) — także z produkcją i sprzedażą,
     * zakupy od firm, prywatnego właściciela lasu (deklaracja uproszczona),
       importera PKS i inwestora wycinki (ResInvest jako operator EUDR),
     * sprzedaż WZ z magazynu do kilku odbiorców (waga z kwitu).
   Każda operacja przechodzi przez silnik (commitOperation) — salda, numeracja
   i audyt są takie jak przy wprowadzaniu z formularza. Dane EUDR (profile
   dostawców, działki, numery referencyjne) powstają komendami modułu EUDR.
   Część transakcji celowo nie ma numerów — rejestr pokazuje braki do uzupełnienia.
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  if (!R.Seed && typeof require === "function") require("./seed.js");
  if (!R.EUDR && typeof require === "function") require("./eudr.js");
  const N_ = s => s;

  const PARTNERS = [
    { id: "pa_ndl_gli", name: "Nadleśnictwo Gliwice", role: "supplier", kind: "nadlesnictwo", lesnictwa: ["Łabędy", "Kozłów", "Wilcze Gardło"], city: "Gliwice", active: true },
    { id: "pa_ndl_bry", name: "Nadleśnictwo Brynek", role: "supplier", kind: "nadlesnictwo", lesnictwa: ["Świerklaniec", "Brynek", "Kalety"], city: "Tworóg", active: true },
    { id: "pa_ndl_kk", name: "Nadleśnictwo Kędzierzyn", role: "supplier", kind: "nadlesnictwo", lesnictwa: ["Sławięcice", "Lenartowice"], city: "Kędzierzyn-Koźle", active: true },
    { id: "pa_ekolas", name: "Eko-Las sp. z o.o.", role: "supplier", kind: "firma", city: "Pyskowice", active: true },
    { id: "pa_nowicki", name: "Gospodarstwo Leśne Jan Nowicki", role: "supplier", kind: "firma", city: "Mikołów", active: true },
    { id: "pa_zdw", name: "Zarząd Dróg Wojewódzkich — wycinka DW 901", role: "supplier", kind: "firma", city: "Gliwice", active: true },
    { id: "pa_ciep_gli", name: "Ciepłownia Gliwice", role: "buyer", city: "Gliwice", active: true },
    { id: "pa_ze_knu", name: "Zakład Energetyczny Knurów", role: "buyer", city: "Knurów", active: true }
  ];

  /** Szablon miesiąca: [dzień, użytkownik, zapis skrócony operacji, dane EUDR]. */
  function plan(v) {
    const x = (a, b) => v % 2 ? b : a;                       // drobne różnice między miesiącami
    // kursy z lasu: każdy z kwitem wywozowym (wymóg silnika) i wagą z kwitu wagowego
    const own2 = (w1, w2) => ({ mode: "own", place: "Ciepłownia Gliwice", own: { runCount: "2", runs: [
      { vehicleId: "ve_scania", driverId: "", km: "34", rate: "5", kwit: `KW 0${410 + v}/1/B`, kwitM3: "25", qty: "100", weightT: w1 },
      { vehicleId: "ve_volvo", driverId: "", km: "34", rate: "5", kwit: `KW 0${410 + v}/2/B`, kwitM3: "25", qty: "100", weightT: w2 }] } });
    const ext = (place, km, freight) => ({ mode: "external", place, external: { company: "DAP Trans", reg: "SZA 7K901", km, freight } });
    const none = { mode: "none", place: "RiC Zabrze" };
    const ndl = (supplierId, lesnictwo, qty, price, more) => Object.assign({ purchase: { supplierKind: "nadlesnictwo", supplierId, lesnictwo, basis: "DEKL", productId: "pr_drewno", qty, unit: "m3", price } , transport: none }, more || {});
    const wz = (productId, qty, buyerId, price, weight, place, km, freight) => ({ type: "SPRZEDAZ", sale: Object.assign({ productId, qty, unit: productId === "pr_pks" ? "t" : "MP", buyerId, price }, weight ? { weightMode: "manual", weightManual: weight } : {}), transport: ext(place, km, freight) });
    return [
      [3, "u_mag", ndl("pa_ndl_rr", "Stanica", x("42", "38"), "215"), { refs: 1, plots: ["Stanica"], species: 0 }],
      [4, "u_mag", { purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: x("90", "96"), unit: "MP", price: "56", weightMode: "manual", weightManual: x("29,8", "31,6") }, transport: none }, { refs: 1 }],
      [5, "u_mag", wz("pr_zr_lesna", x("180", "176"), "pa_ec_zab", "92", x("58,9", "57,4"), "Elektrociepłownia Zabrze S.A.", "12", "640"), null],
      [6, "u_mag", ndl("pa_ndl_ryb", "Golejów", "28", "212", { production: { enabled: true, type: "lesna", kwit: `KW 0${300 + v}/G`, chipperId: "ch_jenz" } }), { refs: 1, plots: ["Golejów"], species: 1 }],
      [8, "u_mag", { purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "20", unit: "m3", price: "230" }, transport: none }, null],
      [9, "u_mag", wz("pr_zr_lesna", x("240", "228"), "pa_ec_kat", "95", x("77,4", "73,9"), "EC Katowice — biomasa", "28", "980"), null],
      [10, "u_mag", ndl("pa_ndl_gli", "Łabędy", x("35", "41"), "209"), { refs: 2, plots: ["Łabędy"], species: 0 }],
      [12, "u_mag", { purchase: { supplierId: "pa_ekolas", basis: "DEKL", productId: "pr_zr_tow", qty: "120", unit: "MP", price: "54", weightMode: "manual", weightManual: "39,2" }, transport: none }, null],
      [13, "u_mag", wz("pr_zr_tow", x("80", "90"), "pa_ciep_ryb", "84", x("26,1", "29,4"), "Ciepłownia Rybnik", "38", "720"), null],
      [14, "u_kier", ndl("pa_ndl_bry", "Świerklaniec", "50", "214", { production: { enabled: true, type: "lesna", kwit: `KW 0${410 + v}/B`, chipperId: "ch_jenz" }, sale: { enabled: true, buyerId: "pa_ciep_gli", price: "93", priceUnit: "MP" }, transport: own2(x("32,6", "31,8"), x("33,1", "32,9")) }), { refs: 1, plots: ["Świerklaniec"], species: 0 }],
      [16, "u_mag", wz("pr_zr_lesna", x("300", "310"), "pa_elektrownia", "89", x("98,2", "101,5"), "Elektrownia Łaziska", "22", "1150"), null],
      [17, "u_mag", { purchase: { supplierId: "pa_nowicki", basis: "DEKL", productId: "pr_drewno", qty: "18", unit: "m3", price: "205" }, transport: none }, { species: 2 }],
      [19, "u_mag", ndl("pa_ndl_rr", "Kuźnia", "30", "215"), { refs: 1, plots: ["Kuźnia"], species: 0 }],
      [20, "u_mag", { purchase: { supplierId: "pa_agro", basis: "DEKL", productId: "pr_pks", qty: x("24", "26"), unit: "t", price: "590" }, transport: none }, null],
      [21, "u_mag", wz("pr_zr_lesna", "150", "pa_ciep_gli", "93", "", "Ciepłownia Gliwice", "18", "560"), null],
      [23, "u_mag", ndl("pa_ndl_kk", "Sławięcice", "24", "211"), null],
      [24, "u_mag", wz("pr_pks", x("20", "22"), "pa_ze_knu", "640", x("20", "22"), "Zakład Energetyczny Knurów", "15", "500"), null],
      [25, "u_kier", { purchase: { supplierId: "pa_zdw", basis: "KZR", productId: "pr_drewno_inw", qty: "40", unit: "m3", price: "150" },
        production: { enabled: true, type: "inwestycyjna", investSite: "DW 901 — przebudowa, km 3+200 – 4+100", sourceDoc: `Protokół wycinki ${v}/2026`, chipperId: "ch_jenz" }, transport: none }, { operator: true }],
      [26, "u_mag", wz("pr_zr_lesna", x("200", "190"), "pa_ec_zab", "92", x("64,0", "61,2"), "Elektrociepłownia Zabrze S.A.", "12", "640"), null]
    ];
  }

  /** Działki (punkty WGS84; wycinka — wielokąt pasa drogowego). */
  const PLOTS = [
    { ndl: "Rudy Raciborskie", lesnictwo: "Stanica", address: "oddz. 112 b", areaHa: "3,2", lat: "50,2108", lon: "18,4127" },
    { ndl: "Rudy Raciborskie", lesnictwo: "Kuźnia", address: "oddz. 87 a", areaHa: "2,7", lat: "50,1985", lon: "18,3264" },
    { ndl: "Rybnik", lesnictwo: "Golejów", address: "oddz. 41 c", areaHa: "1,9", lat: "50,0712", lon: "18,6203" },
    { ndl: "Gliwice", lesnictwo: "Łabędy", address: "oddz. 205 d", areaHa: "3,8", lat: "50,3384", lon: "18,6011" },
    { ndl: "Brynek", lesnictwo: "Świerklaniec", address: "oddz. 64 f", areaHa: "2,4", lat: "50,4361", lon: "18,9302" },
    { ndl: "", lesnictwo: "", address: "Mikołów-Bujaków, dz. ewid. 318/4 (las prywatny)", areaHa: "2,1", lat: "50,1532", lon: "18,8017" },
    { ndl: "", lesnictwo: "", address: "Pas drogowy DW 901, km 3+200 – 4+100", areaHa: "5,6", polygon: JSON.stringify({ type: "Polygon", coordinates: [[[18.6912, 50.2934], [18.7048, 50.2941], [18.7051, 50.2921], [18.6915, 50.2914], [18.6912, 50.2934]]] }) }
  ];
  const SPECIES_PICK = ["sosna zwyczajna (Pinus sylvestris)", "mieszanka gatunków iglastych", "dąb szypułkowy (Quercus robur)"];

  /** Numer referencyjny w formacie systemu informacyjnego UE (RR + kraj + 10 znaków) — deterministyczny dla danych przykładowych. */
  function fakeRef(seed) {
    let h = 2166136261;
    for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    const a = h.toString(36).toUpperCase().padStart(7, "0"), b = (Math.imul(h, 2654435761) >>> 0).toString(36).toUpperCase().padStart(7, "0");
    return { ref: `26PL${(a + b).slice(0, 10)}`, ver: (b + a).slice(2, 10) };
  }

  /** Rozszerzenie danych przykładowych o transakcje miesiąca bieżącego i poprzedniego oraz dane EUDR. */
  function extend(s, today) {
    const D = R.Dates, ymNow = D.ym(today);
    for (const p of PARTNERS) if (!R.byId(s.partners, p.id)) s.partners.push(Object.assign({}, p));
    const user = id => R.byId(s.users, id);
    const ctx = (uid, date) => ({ user: user(uid), today: date, now: date + "T09:00:00.000Z", source: N_("Dane przykładowe") });
    const months = [D.addMonths(ymNow, -1), ymNow].filter(ym => ym >= "2026-09");
    const done = [];
    months.forEach((ym, mi) => {
      const last = ym === ymNow ? Number(today.slice(8, 10)) : 31;
      for (const [day, uid, over, eudr] of plan(mi)) {
        const date = `${ym}-${String(day).padStart(2, "0")}`;
        if (day > last || date > D.monthEnd(ym)) continue;
        const r = R.commitOperation(s, R.Seed.draftOf(date, over), ctx(uid, date));
        if (!r.ok) throw new Error(`Dane przykładowe EUDR (${date}): ${r.error}`);
        if (R.Notify) R.Notify.forOperation(s, r.op, "create", ctx(uid, date));
        done.push({ op: r.op, eudr, ym, mi });
      }
    });
    seedEudr(s, today, done);
    return s;
  }

  function seedEudr(s, today, done) {
    const E = R.EUDR, admin = R.byId(s.users, "u_admin"), kier = R.byId(s.users, "u_kier");
    const c = (u, d) => ({ user: u, today: d || today, now: (d || today) + "T15:00:00.000Z", source: N_("Dane przykładowe") });
    const must = (r, what) => { if (!r || !r.ok) throw new Error(`Dane przykładowe EUDR (${what}): ${r && r.error}`); return r; };
    must(E.saveSettings(s, { applyFrom: E.CONFIG.applyFrom, companySize: "srednia", lookbackDays: 90, registered: false }, c(admin)), "ustawienia");
    const prof = [
      ["pa_ndl_rr", "OPERATOR", "PL", true], ["pa_ndl_ryb", "OPERATOR", "PL", true], ["pa_ndl_gli", "OPERATOR", "PL", true], ["pa_ndl_bry", "OPERATOR", "PL", true], ["pa_ndl_kk", "OPERATOR", "PL", false],
      ["pa_drwal", "DOWNSTREAM", "PL", true], ["pa_lander", "DOWNSTREAM", "PL", false], ["pa_tartak", "DOWNSTREAM", "PL", true],
      ["pa_nowicki", "MSPO", "PL", true, fakeRef("nowicki").ref], ["pa_agro", "DOWNSTREAM", "NL", true], ["pa_zdw", "NO_DDS", "PL", true]
    ];
    for (const [id, role, country, verified, declarationId] of prof) if (R.byId(s.partners, id)) must(E.saveSupplier(s, id, { role, country, verified, declarationId: declarationId || "", contact: id.startsWith("pa_ndl") ? "sekretariat nadleśnictwa — numery DDS na dokumencie WZ (SILP)" : "" }, c(kier)), `dostawca ${id}`);
    const plotId = {};
    for (const p of PLOTS) { const r = must(E.savePlot(s, p, c(kier)), "działka"); plotId[p.lesnictwo || p.address] = r.rec.id; }
    for (const { op, eudr, mi } of done) {
      if (!eudr) continue;
      const rec = { refs: [], plotIds: [], docs: [] };
      for (let i = 0; i < (eudr.refs || 0); i++) rec.refs.push(Object.assign({ kind: "DDS" }, fakeRef(`${op.no}|${i}`)));
      for (const l of eudr.plots || []) if (plotId[l]) rec.plotIds.push(plotId[l]);
      if (eudr.species !== undefined) rec.species = SPECIES_PICK[eudr.species];
      if (op.purchase && op.purchase.supplierId === "pa_nowicki") rec.plotIds.push(plotId["Mikołów-Bujaków, dz. ewid. 318/4 (las prywatny)"]);
      if (eudr.operator) {
        rec.species = "mieszanka gatunków liściastych"; rec.plotIds = [plotId["Pas drogowy DW 901, km 3+200 – 4+100"]];
        // poprzedni miesiąc: DDS złożone; bieżący: projekt w toku (bez dokumentów legalności — rejestr pokaże braki)
        if (mi === 0) Object.assign(rec, { harvestFrom: R.Dates.addDays(op.date, -6), harvestTo: R.Dates.addDays(op.date, -1), docs: ["Decyzja Starosty Gliwickiego — zezwolenie na usunięcie drzew", "Protokół odbioru drewna z wycinki"], riskLevel: "NEGLIGIBLE", riskNote: "Kraj niskiego ryzyka (PL); pas drogowy — brak przekształcenia lasu na cele rolnicze.", ownDds: Object.assign({ status: "SUBMITTED" }, fakeRef(`dds|${op.no}`)) });
        else Object.assign(rec, { harvestFrom: R.Dates.addDays(op.date, -4), harvestTo: op.date, riskLevel: "NEGLIGIBLE" });
      }
      must(E.saveRecord(s, op.id, rec, c(kier, op.date)), `transakcja ${op.no}`);
    }
    // dane wzorcowe 3.11: numery dla zakupu z nadleśnictwa Rybnik (wrzesień) i produkcji w lesie (sprzedaż bezpośrednia)
    for (const op of s.operations) {
      const fromNdl = op.purchase && op.purchase.supplierId === "pa_ndl_ryb" && op.date < "2026-10-01";
      const directForest = op.type === "SPRZEDAZ" && op.direct && op.production && op.production.ndl;
      if ((fromNdl || directForest) && R.TradeStats.isLive(op)) must(E.saveRecord(s, op.id, { refs: [Object.assign({ kind: "DDS" }, fakeRef(`${op.no}|base`))], species: SPECIES_PICK[0] }, c(kier, op.date)), `transakcja ${op.no}`);
    }
  }

  const build = R.Seed.build;
  R.Seed.build = function (today) { return extend(build.call(this, today), today); };
  R.EUDR.Demo = { extend, fakeRef, PARTNERS, PLOTS };
})(typeof globalThis !== "undefined" ? globalThis : this);
