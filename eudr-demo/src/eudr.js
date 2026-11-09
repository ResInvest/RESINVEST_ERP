/* eudr.js */
/* =========================================================================
   ResInvest ERP 3.12 (demo EUDR) — warstwa S: rozporządzenie o wylesianiu
   (UE) 2023/1115 zmienione rozporządzeniem (UE) 2025/2650 — „EUDR”.

   Bez DOM — działa w przeglądarce, na serwerze i w testach (Node).
   Moduł NAKŁADKOWY: nie zmienia księgi, dokumentów ani operacji. Dane EUDR
   są w osobnej gałęzi stanu `state.eudr` i zmieniają się WYŁĄCZNIE komendami
   usługi (Service) — z kontrolą uprawnień, dostępu do magazynu i audytem:
     settings  — data stosowania, wielkość firmy, okres puli, zakres produktów,
     suppliers — profil EUDR dostawcy (rola w łańcuchu, kraj, identyfikator
                 deklaracji uproszczonej, weryfikacja),
     records   — dane EUDR transakcji (po id operacji): numery referencyjne
                 DDS / identyfikatory deklaracji, gatunek, okres pozyskania,
                 działki, dokumenty legalności, ocena ryzyka, własne DDS,
     plots     — działki (geolokalizacja: punkt albo wielokąt GeoJSON WGS84).
   Ocena (evaluate) jest liczona na bieżąco z operacji i danych EUDR — nie jest
   zapisywana, więc korekta / anulowanie dokumentu od razu zmienia wynik.
   Sprzedaż ze stanu dostaje numery z „puli” magazynu: zakupy i produkcje,
   które zasiliły stan sprzedanego produktu (lub jego surowca) w okresie puli
   przed datą wydania, oraz przyjęcia MM (pula magazynu źródłowego).
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  if (!R.Service && typeof require === "function") require("./service.js");
  if (!R.TradeStats && typeof require === "function") require("./tradestats.js");
  const { rq, byId, Dates } = R;
  const t = (s, p) => R.I18N.t(s, p);
  const N_ = s => s;
  const Lx = R.Lx;
  const str = v => String(v == null ? "" : v).trim();
  const TS = () => R.TradeStats;

  /* ------------------------------------------------------------------ */
  /* Słowniki                                                            */
  /* ------------------------------------------------------------------ */
  const CONFIG = Object.assign({
    applyFrom: "2026-12-30",          // duże i średnie przedsiębiorstwa, sektor drzewny (dawniej EUTR)
    applyFromSmall: "2027-06-30",     // pozostałe mikro i małe przedsiębiorstwa
    lookbackDays: 90,                 // okres puli magazynu dla sprzedaży ze stanu
    refPattern: "^\\d{2}[A-Z]{2}[A-Z0-9]{8,12}$"
  }, root.RIW_EUDR_CONFIG || {});

  /** Rola dostawcy w łańcuchu dostaw EUDR (wyznacza obowiązki ResInvest przy zakupie). */
  const SUPPLIER_ROLES = {
    OPERATOR: { label: N_("Operator — wprowadza drewno do obrotu i składa DDS"), short: N_("Operator (DDS)") },
    MSPO: { label: N_("Mikro / mały producent pierwotny — jednorazowa deklaracja uproszczona"), short: N_("Deklaracja uproszczona") },
    DOWNSTREAM: { label: N_("Podmiot dalszy / handlowiec — odsprzedaje towar już wprowadzony do obrotu"), short: N_("Podmiot dalszy") },
    NO_DDS: { label: N_("Dostawca nie składa DDS (np. inwestor wycinki, zakup na pniu) — ResInvest jest operatorem"), short: N_("Bez DDS — ResInvest operatorem") },
    NON_EU: { label: N_("Dostawca spoza UE — ResInvest jest importerem (operatorem)"), short: N_("Spoza UE — import") }
  };
  /** Rola ResInvest Commodities w transakcji. */
  const OUR_ROLES = {
    OPERATOR: { label: N_("Operator — własne oświadczenie DDS"), short: N_("Operator") },
    FIRST_DOWNSTREAM: { label: N_("Pierwszy podmiot dalszy — przetwarza (rąbanie) i zbiera numery referencyjne"), short: N_("Pierwszy podmiot dalszy") },
    FIRST_TRADER: { label: N_("Pierwszy handlowiec — odsprzedaje bez przetworzenia i zbiera numery referencyjne"), short: N_("Pierwszy handlowiec") },
    DOWNSTREAM: { label: N_("Dalszy podmiot w łańcuchu — numery referencyjne zalecane"), short: N_("Dalszy podmiot") },
    SELLER: { label: N_("Sprzedaż — przekazanie numerów referencyjnych odbiorcy"), short: N_("Sprzedaż") }
  };
  const STATUS = {
    OK: { label: N_("Kompletne"), cls: "ok" },
    UWAGI: { label: N_("Uwagi"), cls: "warn" },
    BRAKI: { label: N_("Braki"), cls: "err" },
    POZA: { label: N_("Poza zakresem"), cls: "" }
  };
  const RISK_LEVELS = { NEGLIGIBLE: N_("Ryzyko znikome"), NON_NEGLIGIBLE: N_("Ryzyko nieznikome — działania ograniczające") };
  const COMPANY_SIZES = { duza: N_("Duże przedsiębiorstwo"), srednia: N_("Średnie przedsiębiorstwo"), mala: N_("Małe przedsiębiorstwo"), mikro: N_("Mikroprzedsiębiorstwo") };
  const REF_KINDS = { DDS: N_("Numer referencyjny DDS"), DECL: N_("Identyfikator deklaracji uproszczonej") };
  /** Kraje UE — klasyfikacja Komisji (rozporządzenie wykonawcze 2025/1093): ryzyko niskie. */
  const EU = ["AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];
  const isEU = c => EU.includes(str(c).toUpperCase());
  /** Zakres wg kategorii produktu (załącznik I EUDR, dział 44). Produkty tonowe (PKS, łupina) — do weryfikacji kodu CN. */
  const CAT_SCOPE = {
    drewno: { inScope: true, cn: "4401 11 / 4401 12 · 4403" },
    zrebka: { inScope: true, cn: "4401 21 / 4401 22" },
    agro: { inScope: false, cn: "", check: true }
  };
  const SPECIES = ["sosna zwyczajna (Pinus sylvestris)", "świerk pospolity (Picea abies)", "dąb szypułkowy (Quercus robur)", "buk zwyczajny (Fagus sylvatica)",
    "brzoza brodawkowata (Betula pendula)", "olsza czarna (Alnus glutinosa)", "modrzew europejski (Larix decidua)", "topola (Populus spp.)", "mieszanka gatunków liściastych", "mieszanka gatunków iglastych"];
  const LIMITS = { refs: 50, docs: 20, plots: 50, text: 200, note: 1000 };

  /* ------------------------------------------------------------------ */
  /* Dostęp do danych                                                    */
  /* ------------------------------------------------------------------ */
  const DEFAULT_SETTINGS = () => ({ applyFrom: CONFIG.applyFrom, companySize: "srednia", lookbackDays: CONFIG.lookbackDays, operatorId: "", registered: false, products: {} });
  function data(state) {
    const e = (state && state.eudr) || {};
    return {
      version: 1,
      settings: Object.assign(DEFAULT_SETTINGS(), e.settings || {}),
      suppliers: e.suppliers || {}, records: e.records || {}, plots: Array.isArray(e.plots) ? e.plots : []
    };
  }
  /** Data stosowania dla firmy: mikro / małe poza sektorem drzewnym mają późniejszy termin — ResInvest (drewno) stosuje termin ogólny. */
  const applyFromOf = st => Dates.isISO(st.applyFrom) ? st.applyFrom : CONFIG.applyFrom;
  const record = (state, opId) => data(state).records[opId] || null;
  const isLive = op => TS().isLive(op);

  function productScope(state, productId) {
    const p = byId(state.products, productId);
    const ov = data(state).settings.products[productId] || {};
    const base = CAT_SCOPE[p && p.cat] || { inScope: false, cn: "", check: true };
    return { inScope: typeof ov.inScope === "boolean" ? ov.inScope : base.inScope, cn: str(ov.cn) || base.cn, check: !!base.check && typeof ov.inScope !== "boolean" };
  }

  function guessCountry(p) {
    const n = str(p && p.name);
    if (str(p && p.country)) return str(p.country).toUpperCase();
    if (/\bB\.?V\.?$/i.test(n)) return "NL";
    if (/\bGmbH\b/i.test(n)) return "DE";
    if (/\bs\.\s?r\.\s?o\.?$/i.test(n)) return "CZ";
    return "PL";
  }
  /** Profil EUDR kontrahenta: zapisany albo domyślny (nadleśnictwo → operator; firma → podmiot dalszy). */
  function supplierProfile(state, partnerId) {
    const p = byId(state.partners, partnerId);
    const saved = data(state).suppliers[partnerId] || null;
    const kind = R.partnerKind(p);
    const def = { role: kind === "nadlesnictwo" ? "OPERATOR" : "DOWNSTREAM", country: guessCountry(p), declarationId: "", contact: "", note: "", verifiedAt: "", verifiedBy: "" };
    const prof = Object.assign({ partnerId, name: p ? p.name : "", city: p ? str(p.city) : "", kind, saved: !!saved }, def, saved || {});
    prof.risk = isEU(prof.country) ? "LOW" : "STANDARD";
    if (!saved) prof.role = isEU(prof.country) ? prof.role : "NON_EU";
    return prof;
  }
  /** Partner nadleśnictwa po nazwie (produkcja w lesie bez zakupu w operacji). */
  const ndlPartner = (state, ndl) => ndl ? state.partners.find(p => R.partnerKind(p) === "nadlesnictwo" && R.ndlName(p).toLowerCase() === str(ndl).toLowerCase()) || null : null;

  /* ------------------------------------------------------------------ */
  /* Ocena transakcji                                                    */
  /* ------------------------------------------------------------------ */
  const refList = rec => ((rec && rec.refs) || []).filter(r => str(r.ref));
  const RE = () => new RegExp(CONFIG.refPattern);
  function statusOf(checks, inScope) {
    if (!inScope) return "POZA";
    if (checks.some(c => c.lvl === "err")) return "BRAKI";
    if (checks.some(c => c.lvl === "warn")) return "UWAGI";
    return "OK";
  }

  /**
   * Strona wejścia (surowiec): zakup albo produkcja w lesie bez zakupu (sprzedaż bezpośrednia).
   * Zwraca null, gdy operacja nie ma wejścia z zewnątrz.
   */
  function inputSide(state, op) {
    if (op.purchase) return { productId: op.purchase.productId, partnerId: op.purchase.supplierId, partnerName: op.purchase.supplierName, qty: op.purchase.qty, unit: op.purchase.unit, weightT: op.purchase.weightT, weightMode: op.purchase.weightMode };
    const Pr = op.production;
    if (Pr && Pr.mode && Pr.mode !== "stock" && Pr.rawProductId) {
      const np = ndlPartner(state, Pr.ndl);
      return { productId: Pr.rawProductId, partnerId: np ? np.id : "", partnerName: np ? np.name : (Pr.ndl ? `Nadleśnictwo ${Pr.ndl}` : str(Pr.investSite)), qty: Pr.consumeQty, unit: Pr.consumeUnit, weightT: null, weightMode: "auto" };
    }
    return null;
  }

  /** Ocena wejścia: rola ResInvest, wymagania, braki. */
  function evaluateInput(state, op, memo) {
    if (memo && memo.has(op.id)) return memo.get(op.id);
    const r = evaluateInput0(state, op);
    if (memo) memo.set(op.id, r);
    return r;
  }
  function evaluateInput0(state, op) {
    const side = inputSide(state, op);
    if (!side) return null;
    const D = data(state), rec = D.records[op.id] || {};
    const scope = productScope(state, side.productId);
    const prof = side.partnerId ? supplierProfile(state, side.partnerId) : null;
    const checks = [];
    const add = (lvl, code, k, p) => checks.push({ lvl, code, msg: Lx(k, p) });
    let role;
    if (!prof) role = "OPERATOR";
    else if (prof.role === "NO_DDS" || prof.role === "NON_EU" || !isEU(prof.country)) role = "OPERATOR";
    else if (prof.role === "DOWNSTREAM") role = "DOWNSTREAM";
    else role = op.production ? "FIRST_DOWNSTREAM" : "FIRST_TRADER";
    const refs = refList(rec);
    const declId = prof && prof.role === "MSPO" ? str(prof.declarationId) : "";
    if (scope.inScope) {
      if (role === "OPERATOR") {
        if (!str(rec.ownDds && rec.ownDds.ref)) add("err", "OWN_DDS", N_("ResInvest jest operatorem — wymagane własne oświadczenie DDS (numer referencyjny z systemu informacyjnego UE)"));
        if (!(rec.plotIds || []).length && !str(rec.geojson)) add("err", "GEO", N_("Brak geolokalizacji działek pozyskania"));
        if (!str(rec.species)) add("err", "SPECIES", N_("Brak gatunku drewna (nazwa zwyczajowa i naukowa)"));
        if (!Dates.isISO(rec.harvestFrom) || !Dates.isISO(rec.harvestTo)) add("err", "HARVEST", N_("Brak okresu pozyskania (data od–do)"));
        if (!(rec.docs || []).filter(Boolean).length) add("err", "LEGAL", N_("Brak dokumentów legalności pozyskania (np. zezwolenie na usunięcie drzew, umowa, protokół)"));
        if (!rec.riskLevel) add(prof && isEU(prof.country) ? "warn" : "err", "RISK", prof && isEU(prof.country) ? N_("Kraj niskiego ryzyka — zapisz wynik uproszczonej oceny ryzyka") : N_("Brak oceny ryzyka (kraj spoza UE)"));
        else if (rec.riskLevel === "NON_NEGLIGIBLE") add("err", "RISK_OPEN", N_("Ryzyko nieznikome — towaru nie wolno wprowadzić do obrotu przed jego ograniczeniem"));
      } else if (role === "DOWNSTREAM") {
        if (!refs.length && !declId) add("warn", "REF_REC", N_("Dostawca jest dalszym podmiotem — zalecane numery referencyjne z łańcucha (wymagane przez odbiorców)"));
      } else if (!refs.length && !declId) {
        add("err", "REF", prof && prof.role === "MSPO" ? N_("Brak identyfikatora deklaracji uproszczonej dostawcy") : N_("Brak numeru referencyjnego DDS od dostawcy"));
      }
      const re = RE();
      for (const r of refs) if (!re.test(str(r.ref).toUpperCase())) add("warn", "REF_FMT", N_("Numer {r} ma nietypowy format — sprawdź w systemie informacyjnym UE"), { r: r.ref });
      if (prof && !prof.verifiedAt) add("warn", "SUPPLIER", N_("Profil EUDR dostawcy „{n}” niezweryfikowany"), { n: prof.name });
    } else if (scope.check) add("info", "CN", N_("Sprawdź kod CN produktu — jeżeli należy do załącznika I (np. 2306 60 — palma olejowa), włącz produkt w ustawieniach EUDR"));
    const m = TS().measures(state, side.productId, side.qty, side.unit);
    return {
      side: "IN", opId: op.id, no: op.no, date: op.date, whId: op.whId, partnerId: side.partnerId, partnerName: side.partnerName || (prof && prof.name) || "",
      productId: side.productId, productName: (byId(state.products, side.productId) || {}).name || "", cn: str(rec.cn) || scope.cn,
      qty: rq(side.qty || 0), unit: side.unit, mp: m.mp, m3: m.m3, t: side.weightMode === "manual" && side.weightT ? rq(side.weightT) : m.t,
      role, supplierRole: prof ? prof.role : "", inScope: scope.inScope, refs: refs.map(r => Object.assign({}, r)).concat(declId ? [{ ref: declId, kind: "DECL", from: "profil dostawcy" }] : []),
      ownDds: rec.ownDds || null, checks, status: statusOf(checks.filter(c => c.lvl !== "info"), scope.inScope)
    };
  }

  /**
   * Źródła sprzedaży ze stanu (pula magazynu): wpisy księgi zwiększające stan sprzedanego produktu
   * albo jego surowca (produkcja na magazynie) w okresie puli; MM — pula magazynu źródłowego (jeden poziom).
   */
  /**
   * Indeks stanu (wydajność): księga i produkcje wg magazynu, operacje wg id. Budowany raz na wersję stanu
   * (rewizja + liczności kolekcji) — bez niego sprzedaż ze stanu przeglądałaby całą księgę (koszt kwadratowy).
   */
  const IDX = new WeakMap();
  function index(state) {
    const x0 = IDX.get(state);
    if (x0 && x0.rev === state.rev && x0.nl === state.ledger.length && x0.no === state.operations.length) return x0;
    const x = { rev: state.rev, nl: state.ledger.length, no: state.operations.length, op: new Map(), led: new Map(), prod: new Map() };
    const add = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    for (const o of state.operations) { x.op.set(o.id, o); if (o.type === "PRODUKCJA" && o.production) add(x.prod, o.whId, o); }
    for (const l of state.ledger) add(x.led, l.whId, l);
    IDX.set(state, x);
    return x;
  }
  function poolSources(state, whId, productId, date, days, depth = 0) {
    const from = Dates.addDays(date, -days), X = index(state), ledger = X.led.get(whId) || [];
    const raw = new Set();
    for (const op of X.prod.get(whId) || []) if (isLive(op) && op.production.outProductId === productId && op.date <= date && op.date >= from) raw.add(op.production.rawProductId);
    const prods = new Set([productId, ...raw]);
    const src = new Map(), info = { qtyIn: 0, opening: false };
    // operacja, której produkt w całości wyszedł w tej samej transakcji (łańcuch zakup → sprzedaż), nie zasila stanu
    const net = new Map();
    for (const l of ledger) if (l.opId && prods.has(l.productId) && !l.direct) net.set(l.opId, (net.get(l.opId) || 0) + l.qty);
    for (const l of ledger) {
      if (l.opId && !((net.get(l.opId) || 0) > 1e-6)) continue;
      // produkcja sprzedana bezpośrednio z lasu (direct) nie zasila stanu — nie należy do puli
      if (l.whId !== whId || !(l.qty > 0) || l.direct || l.date > date || l.date < from || !prods.has(l.productId)) continue;
      if (l.cat === "BO") { info.opening = true; continue; }
      const op = l.opId ? X.op.get(l.opId) : null;
      if (!op || !isLive(op)) continue;
      if (l.productId === productId) info.qtyIn = rq(info.qtyIn + l.qty);
      if (l.cat === "MM" && op.type === "MM") {
        if (depth < 1) for (const [k, v] of poolSources(state, op.whId, productId, op.date, days, depth + 1).src) src.set(k, Object.assign({ via: op.no }, v));
        continue;
      }
      if (op.type === "PRODUKCJA") continue;                 // surowiec produkcji na placu pochodzi z zakupów — są w puli
      if (inputSide(state, op)) src.set(op.id, { opId: op.id });
    }
    return { src, info };
  }

  /** Numery referencyjne do przekazania odbiorcy + źródła i kompletność. */
  function traceSale(state, op, memo) {
    const D = data(state), rec = D.records[op.id] || {}, st = D.settings;
    const days = Math.max(7, Math.min(365, Number(st.lookbackDays) || CONFIG.lookbackDays));
    if (rec.traceMode === "manual") return { method: "MANUAL", sources: [], refs: refList(rec).map(r => Object.assign({ from: "ręcznie" }, r)), info: {} };
    let ids = [], info = {}, method = "OP";
    if (inputSide(state, op)) ids = [op.id];
    else {
      method = "POOL";
      const P = poolSources(state, op.whId, op.sale.productId, op.date, days);
      ids = [...P.src.keys()]; info = Object.assign(P.info, { days });
    }
    const X = index(state);
    const sources = ids.map(id => evaluateInput(state, X.op.get(id), memo)).filter(Boolean);
    const seen = new Set(), refs = [];
    for (const s of sources) for (const r of s.refs.concat(s.ownDds && s.ownDds.ref ? [{ ref: s.ownDds.ref, kind: "DDS", from: "własne DDS" }] : [])) {
      const k = str(r.ref).toUpperCase(); if (!k || seen.has(k)) continue; seen.add(k);
      refs.push(Object.assign({ fromNo: s.no, fromPartner: s.partnerName }, r));
    }
    for (const r of refList(rec)) { const k = str(r.ref).toUpperCase(); if (!seen.has(k)) { seen.add(k); refs.push(Object.assign({ from: "ręcznie" }, r)); } }
    return { method, sources, refs, info };
  }

  function evaluateSale(state, op, memo) {
    if (!op.sale) return null;
    const scope = productScope(state, op.sale.productId);
    const tr = traceSale(state, op, memo);
    const checks = [];
    const add = (lvl, code, k, p) => checks.push({ lvl, code, msg: Lx(k, p) });
    if (scope.inScope) {
      if (!tr.refs.length) add("err", "OUT_REF", N_("Brak numerów referencyjnych do przekazania odbiorcy"));
      for (const s of tr.sources) if (s.status === "BRAKI") add("err", "SRC", N_("Źródło {no} ({p}) ma braki danych EUDR"), { no: s.no, p: s.partnerName });
      if (tr.method === "POOL") {
        if (!tr.sources.length) add("err", "POOL_EMPTY", N_("Brak zakupów w puli magazynu z ostatnich {d} dni — nie można wskazać pochodzenia"), { d: tr.info.days });
        else if (tr.info.qtyIn + 1e-6 < op.sale.stockQty) add("warn", "POOL_COVER", N_("Przyjęcia z ostatnich {d} dni ({a}) nie pokrywają sprzedaży ({b}) — część towaru ze starszego zapasu"), { d: tr.info.days, a: R.fmtQ(tr.info.qtyIn), b: R.fmtQ(op.sale.stockQty) });
        if (tr.info.opening) add("warn", "OPENING", N_("W puli jest stan otwarcia (bilans otwarcia) bez numerów referencyjnych"));
      }
    } else if (scope.check) add("info", "CN", N_("Sprawdź kod CN produktu — jeżeli należy do załącznika I, włącz produkt w ustawieniach EUDR"));
    const S = op.sale, m = TS().measures(state, S.productId, S.qty, S.unit), buyer = byId(state.partners, S.buyerId);
    return {
      side: "OUT", opId: op.id, no: op.no, date: op.date, whId: op.whId, partnerId: S.buyerId, partnerName: buyer ? buyer.name : "",
      productId: S.productId, productName: (byId(state.products, S.productId) || {}).name || "", cn: str((record(state, op.id) || {}).cn) || scope.cn,
      qty: rq(S.qty), unit: S.unit, mp: m.mp, m3: m.m3, t: S.weightT ? rq(S.weightT) : m.t, role: "SELLER", inScope: scope.inScope,
      refs: tr.refs, trace: { method: tr.method, sources: tr.sources.map(s => ({ opId: s.opId, no: s.no, date: s.date, partnerName: s.partnerName, status: s.status })), info: tr.info },
      checks, status: statusOf(checks.filter(c => c.lvl !== "info"), scope.inScope)
    };
  }

  /** Wiersze rejestru EUDR (wejście i wyjście transakcji) w zakresie. f: { from, to, whIds?, side?, status? }. */
  function register(state, f = {}) {
    const applyFrom = applyFromOf(data(state).settings);
    const out = [], memo = new Map();             // ocena źródła liczona raz na zestawienie (wiele sprzedaży z tej samej puli)
    for (const op of state.operations) {
      if (!isLive(op) || (f.from && op.date < f.from) || (f.to && op.date > f.to)) continue;
      if (f.whIds && !f.whIds.includes(op.whId)) continue;
      for (const r of [f.side === "OUT" ? null : evaluateInput(state, op, memo), f.side === "IN" ? null : evaluateSale(state, op, memo)]) {
        if (!r || (f.status && r.status !== f.status)) continue;
        r.beforeApply = r.date < applyFrom;
        r.whName = (byId(state.warehouses, r.whId) || {}).name || "";
        out.push(r);
      }
    }
    return out.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.no).localeCompare(String(a.no)));
  }

  /** Raport okresu: liczby i ilości wg statusu, gotowość, braki. */
  function report(state, f = {}) {
    const rows = register(state, f), D = data(state);
    const inScope = rows.filter(r => r.inScope);
    const by = side => {
      const rs = inScope.filter(r => r.side === side), o = { count: rs.length };
      for (const s of Object.keys(STATUS)) { const x = rs.filter(r => r.status === s); o[s] = { count: x.length, sum: TS().totals(x) }; }
      return o;
    };
    const ready = inScope.filter(r => r.status === "OK" || r.status === "UWAGI").length;
    const partners = new Set(rows.filter(r => r.side === "IN" && r.partnerId).map(r => r.partnerId));
    const verified = [...partners].filter(id => (D.suppliers[id] || {}).verifiedAt).length;
    return {
      rows, IN: by("IN"), OUT: by("OUT"), readyPct: inScope.length ? Math.round(ready / inScope.length * 100) : 100,
      inScope: inScope.length, outOfScope: rows.length - inScope.length, missing: inScope.filter(r => r.status === "BRAKI"),
      suppliers: { total: partners.size, verified }, plots: D.plots.length, applyFrom: applyFromOf(D.settings)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Eksport: CSV rejestru, GeoJSON działek, projekt DDS                 */
  /* ------------------------------------------------------------------ */
  const CSV_HEAD = ["Data", "Nr dokumentu", "Kierunek", "Magazyn", "Kontrahent", "Produkt", "Kod CN", "Ilość", "Jednostka", "MP", "m³ (ekw.)", "t",
    "Rola ResInvest", "Status EUDR", "Numery referencyjne", "Numery weryfikacyjne", "Uwagi"];
  function csvRows(state, f) {
    return register(state, f).map(r => [r.date, r.no, r.side === "IN" ? "Zakup / surowiec" : "Sprzedaż", r.whName, r.partnerName, r.productName, r.cn,
      r.qty, r.unit === "m3" ? "m³" : r.unit, r.mp, r.m3, r.t, t((OUR_ROLES[r.role] || {}).short || r.role), t(STATUS[r.status].label),
      r.refs.map(x => x.ref).join(" | "), r.refs.map(x => x.ver || "").filter(Boolean).join(" | "), r.checks.map(c => R.I18N.tr(c.msg)).join(" · ")]);
  }
  /** Działki → FeatureCollection (WGS84): wielokąt, gdy podany; w przeciwnym razie punkt. */
  function geojson(state, plotIds) {
    const D = data(state), ids = plotIds ? new Set(plotIds) : null;
    return {
      type: "FeatureCollection",
      features: D.plots.filter(p => !ids || ids.has(p.id)).map(p => {
        let geometry = null;
        if (p.polygon) { try { geometry = JSON.parse(p.polygon); } catch (e) { geometry = null; } }
        if (!geometry) geometry = { type: "Point", coordinates: [Number(p.lon), Number(p.lat)] };
        return { type: "Feature", geometry, properties: { ProducerCountry: "PL", ProductionPlace: [p.ndl ? `Nadleśnictwo ${p.ndl}` : "", p.lesnictwo ? `Leśnictwo ${p.lesnictwo}` : "", p.address].filter(Boolean).join(", "), Area: p.areaHa != null ? Number(p.areaHa) : null, plotId: p.id } };
      })
    };
  }
  /** Projekt oświadczenia DDS (ResInvest jako operator) — pola zgodne z formularzem systemu informacyjnego UE; do weryfikacji z API TRACES. */
  function ddsDraft(state, opId) {
    const op = byId(state.operations, opId), ev = op && evaluateInput(state, op);
    if (!ev) return null;
    const rec = record(state, opId) || {}, st = data(state).settings;
    return {
      draft: true, generatedFrom: op.no, activityType: "DOMESTIC", operatorType: "OPERATOR", operatorId: st.operatorId || "",
      commodities: [{ hsHeading: (ev.cn || "").split(/[ ·/]/)[0] || "4401", description: ev.productName, netWeightKg: ev.t !== null ? Math.round(ev.t * 1000) : null,
        volumeM3: ev.m3, species: rec.species || "", harvest: { from: rec.harvestFrom || "", to: rec.harvestTo || "" },
        producers: [{ country: "PL", name: ev.partnerName, geometryGeojson: geojson(state, rec.plotIds || []) }] }],
      legalityDocuments: rec.docs || [], riskAssessment: { level: rec.riskLevel || "", note: rec.riskNote || "" }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Walidacja i komendy                                                 */
  /* ------------------------------------------------------------------ */
  const clip = (v, n) => str(v).slice(0, n);
  function cleanRefs(list, errs) {
    const out = [], seen = new Set();
    for (const r of Array.isArray(list) ? list : []) {
      const ref = str(r && r.ref).toUpperCase().replace(/\s+/g, "");
      if (!ref) continue;
      if (!/^[A-Z0-9\-/]{6,40}$/.test(ref)) { errs.push(t("Numer „{r}”: dozwolone litery, cyfry, „-” i „/”, długość 6–40", { r: ref })); continue; }
      if (seen.has(ref)) continue;
      seen.add(ref);
      out.push({ ref, ver: clip(r.ver, 40).toUpperCase(), kind: REF_KINDS[r.kind] ? r.kind : "DDS", from: clip(r.from, 60) });
    }
    if (out.length > LIMITS.refs) errs.push(t("Najwyżej {n} numerów referencyjnych", { n: LIMITS.refs }));
    return out;
  }
  function opFor(state, opId, ctx) {
    const op = byId(state.operations, str(opId));
    if (!op || !isLive(op)) return { error: t("Nieznana lub anulowana operacja") };
    if (!R.canAccessWh(ctx.user, op.whId)) return { error: t("Brak dostępu do magazynu operacji"), code: "FORBIDDEN" };
    return { op };
  }
  /** Zmiana gałęzi `eudr`: kopia → zmiana → podstawienie (rekordy zamrożone na serwerze nie są modyfikowane w miejscu). */
  function mutate(state, ctx, fn) {
    const next = R.clone(data(state));
    const res = fn(next);
    if (!res || !res.ok) return res || { ok: false, error: t("Operacja odrzucona") };
    state.eudr = next;
    state.rev += 1;
    return res;
  }
  const summary = rec => ({ numery: (rec.refs || []).map(r => r.ref).join(", "), dds: (rec.ownDds && rec.ownDds.ref) || "", gatunek: rec.species || "", dzialki: (rec.plotIds || []).length, dokumenty: (rec.docs || []).length, ryzyko: rec.riskLevel || "" });

  function saveRecord(state, opId, input, ctx) {
    const o = opFor(state, opId, ctx);
    if (o.error) return { ok: false, error: o.error, code: o.code };
    const op = o.op, a = input || {}, errs = [];
    const D = data(state);
    const rec = {
      refs: cleanRefs(a.refs, errs), cn: clip(a.cn, 30), species: clip(a.species, 120),
      harvestFrom: str(a.harvestFrom), harvestTo: str(a.harvestTo),
      plotIds: [...new Set((Array.isArray(a.plotIds) ? a.plotIds : []).map(str).filter(Boolean))],
      docs: (Array.isArray(a.docs) ? a.docs : []).map(x => clip(x, LIMITS.text)).filter(Boolean),
      geojson: str(a.geojson).slice(0, 20000), riskLevel: RISK_LEVELS[a.riskLevel] ? a.riskLevel : "", riskNote: clip(a.riskNote, LIMITS.note),
      ownDds: a.ownDds && str(a.ownDds.ref) ? { ref: str(a.ownDds.ref).toUpperCase().replace(/\s+/g, ""), ver: clip(a.ownDds.ver, 40).toUpperCase(), status: a.ownDds.status === "SUBMITTED" ? "SUBMITTED" : "DRAFT" } : null,
      traceMode: a.traceMode === "manual" ? "manual" : "auto", note: clip(a.note, LIMITS.note)
    };
    for (const k of ["harvestFrom", "harvestTo"]) if (rec[k] && !Dates.isISO(rec[k])) errs.push(t("Niepoprawna data okresu pozyskania"));
    if (Dates.isISO(rec.harvestFrom) && Dates.isISO(rec.harvestTo) && rec.harvestFrom > rec.harvestTo) errs.push(t("Okres pozyskania: data „od” jest późniejsza niż „do”"));
    if (rec.harvestTo && Dates.isISO(rec.harvestTo) && rec.harvestTo > op.date) errs.push(t("Okres pozyskania nie może kończyć się po dacie transakcji ({d})", { d: Dates.pl(op.date) }));
    if (rec.plotIds.length > LIMITS.plots) errs.push(t("Najwyżej {n} działek", { n: LIMITS.plots }));
    const unknown = rec.plotIds.filter(id => !D.plots.some(p => p.id === id));
    if (unknown.length) errs.push(t("Nieznana działka: {d}", { d: unknown.join(", ") }));
    if (rec.docs.length > LIMITS.docs) errs.push(t("Najwyżej {n} dokumentów", { n: LIMITS.docs }));
    if (rec.geojson) { const g = checkGeometry(rec.geojson); if (g) errs.push(g); }
    if (rec.ownDds && !/^[A-Z0-9\-/]{6,40}$/.test(rec.ownDds.ref)) errs.push(t("Niepoprawny numer własnego DDS"));
    if (errs.length) return { ok: false, error: errs[0], errors: errs };
    return mutate(state, ctx, E => {
      const before = E.records[op.id] || null;
      const history = ((before && before.history) || []).concat([{ ts: ctx.now || new Date().toISOString(), userId: ctx.user.id, userName: ctx.user.name }]).slice(-50);
      E.records[op.id] = Object.assign({ opId: op.id, opNo: op.no }, rec, { updatedAt: ctx.now || new Date().toISOString(), updatedBy: ctx.user.name, history });
      R.audit(state, ctx, { entity: "eudr", entityId: op.id, opNo: op.no, event: "eudr", whId: op.whId, act: Lx("EUDR: dane transakcji {no} zapisane", { no: op.no }), before: before ? summary(before) : null, after: summary(rec) });
      return { ok: true, rec: E.records[op.id] };
    });
  }

  /** GeoJSON: Polygon / MultiPolygon / Point, współrzędne WGS84 (dł., szer.), pierścień zamknięty. Zwraca komunikat błędu albo "". */
  function checkGeometry(text) {
    let g; try { g = JSON.parse(text); } catch (e) { return t("Geometria: niepoprawny JSON"); }
    if (g && g.type === "Feature") g = g.geometry;
    const pt = c => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
    const ring = r => Array.isArray(r) && r.length >= 4 && r.every(pt) && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
    if (!g || !g.type) return t("Geometria: brak typu");
    if (g.type === "Point") return pt(g.coordinates) ? "" : t("Geometria: niepoprawny punkt");
    if (g.type === "Polygon") return Array.isArray(g.coordinates) && g.coordinates.length && g.coordinates.every(ring) ? "" : t("Geometria: wielokąt musi mieć zamknięty pierścień (≥ 4 punkty, pierwszy = ostatni)");
    if (g.type === "MultiPolygon") return Array.isArray(g.coordinates) && g.coordinates.length && g.coordinates.every(p => Array.isArray(p) && p.every(ring)) ? "" : t("Geometria: niepoprawny MultiPolygon");
    return t("Geometria: dozwolone Point, Polygon, MultiPolygon");
  }

  function saveSupplier(state, partnerId, input, ctx) {
    const p = byId(state.partners, str(partnerId));
    if (!p) return { ok: false, error: t("Nieznany kontrahent") };
    const a = input || {};
    if (!SUPPLIER_ROLES[a.role]) return { ok: false, error: t("Wybierz rolę dostawcy w łańcuchu EUDR") };
    const country = str(a.country).toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return { ok: false, error: t("Kod kraju: dwie litery (ISO 3166), np. PL") };
    if (a.role === "MSPO" && !str(a.declarationId)) return { ok: false, error: t("Producent z deklaracją uproszczoną — podaj identyfikator deklaracji") };
    if (a.role === "NON_EU" && isEU(country)) return { ok: false, error: t("Kraj {c} jest w UE — wybierz inną rolę", { c: country }) };
    const rec = { role: a.role, country, declarationId: str(a.declarationId).toUpperCase().slice(0, 40), contact: clip(a.contact, LIMITS.text), note: clip(a.note, LIMITS.note),
      verifiedAt: a.verified ? (ctx.today || Dates.localToday()) : "", verifiedBy: a.verified ? ctx.user.name : "" };
    return mutate(state, ctx, E => {
      const before = E.suppliers[p.id] || null;
      if (before && a.verified && before.verifiedAt) { rec.verifiedAt = before.verifiedAt; rec.verifiedBy = before.verifiedBy; }
      E.suppliers[p.id] = rec;
      R.audit(state, ctx, { entity: "eudr", entityId: p.id, opNo: p.name, event: "eudr", act: Lx("EUDR: profil dostawcy {n} — {r}", { n: p.name, r: { t: SUPPLIER_ROLES[rec.role].short } }), before, after: rec });
      return { ok: true, rec };
    });
  }

  function savePlot(state, input, ctx) {
    const a = input || {}, errs = [];
    const lat = R.NumParse.value(a.lat, NaN), lon = R.NumParse.value(a.lon, NaN);
    const polygon = str(a.polygon);
    if (!str(a.ndl) && !str(a.address)) errs.push(t("Podaj nadleśnictwo albo adres / lokalizację działki"));
    if (!polygon && !(Number.isFinite(lat) && Number.isFinite(lon))) errs.push(t("Podaj współrzędne (szer., dł.) albo wielokąt GeoJSON"));
    if (Number.isFinite(lat) && (lat < -90 || lat > 90)) errs.push(t("Szerokość geograficzna poza zakresem −90…90"));
    if (Number.isFinite(lon) && (lon < -180 || lon > 180)) errs.push(t("Długość geograficzna poza zakresem −180…180"));
    if (polygon) { const g = checkGeometry(polygon); if (g) errs.push(g); }
    const area = str(a.areaHa) === "" ? null : R.NumParse.value(a.areaHa, NaN);
    if (area !== null && !(area > 0)) errs.push(t("Powierzchnia musi być większa od 0 ha"));
    if (errs.length) return { ok: false, error: errs[0], errors: errs };
    const warnings = [];
    if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat >= 49 && lat <= 55 && lon >= 14 && lon <= 24.2)) warnings.push(t("Współrzędne leżą poza Polską — sprawdź kolejność (szerokość, długość)"));
    if (area !== null && area > 4 && !polygon) warnings.push(t("Działka powyżej 4 ha — EUDR wymaga wielokąta (granic), nie punktu"));
    return mutate(state, ctx, E => {
      const id = str(a.id) && E.plots.some(p => p.id === str(a.id)) ? str(a.id) : `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const rec = { id, ndl: clip(a.ndl, 80), lesnictwo: clip(a.lesnictwo, 80), address: clip(a.address, 120), areaHa: area, lat: Number.isFinite(lat) ? rq(lat) : null, lon: Number.isFinite(lon) ? rq(lon) : null, polygon, note: clip(a.note, LIMITS.text) };
      const i = E.plots.findIndex(p => p.id === id), before = i >= 0 ? E.plots[i] : null;
      if (i >= 0) E.plots[i] = rec; else E.plots.push(rec);
      R.audit(state, ctx, { entity: "eudr", entityId: id, opNo: rec.address || rec.lesnictwo || id, event: "eudr", act: Lx(before ? "EUDR: działka zmieniona ({a})" : "EUDR: nowa działka ({a})", { a: [rec.ndl, rec.lesnictwo, rec.address].filter(Boolean).join(" · ") }), before, after: rec });
      return { ok: true, rec, warnings };
    });
  }
  function removePlot(state, id, ctx) {
    const D = data(state), p = D.plots.find(x => x.id === str(id));
    if (!p) return { ok: false, error: t("Nieznana działka") };
    const used = Object.values(D.records).filter(r => (r.plotIds || []).includes(p.id)).map(r => r.opNo);
    if (used.length) return { ok: false, error: t("Działka jest wskazana w transakcjach: {l} — najpierw usuń ją z tych transakcji", { l: used.slice(0, 5).join(", ") }) };
    return mutate(state, ctx, E => {
      E.plots = E.plots.filter(x => x.id !== p.id);
      R.audit(state, ctx, { entity: "eudr", entityId: p.id, opNo: p.address || p.lesnictwo || p.id, event: "eudr", act: Lx("EUDR: działka usunięta"), before: p, after: null });
      return { ok: true };
    });
  }
  function saveSettings(state, input, ctx) {
    const a = input || {};
    if (a.applyFrom !== undefined && !Dates.isISO(a.applyFrom)) return { ok: false, error: t("Niepoprawna data stosowania") };
    const days = a.lookbackDays !== undefined ? R.NumParse.value(a.lookbackDays, NaN) : null;
    if (days !== null && !(days >= 7 && days <= 365)) return { ok: false, error: t("Okres puli: od 7 do 365 dni") };
    if (a.companySize !== undefined && !COMPANY_SIZES[a.companySize]) return { ok: false, error: t("Wybierz wielkość przedsiębiorstwa") };
    const products = {};
    for (const [pid, v] of Object.entries(a.products || {})) {
      if (!byId(state.products, pid)) return { ok: false, error: t("Nieznany produkt") };
      products[pid] = { inScope: !!(v && v.inScope), cn: clip(v && v.cn, 30) };
    }
    return mutate(state, ctx, E => {
      const before = Object.assign({}, E.settings);
      if (a.applyFrom !== undefined) E.settings.applyFrom = a.applyFrom;
      if (days !== null) E.settings.lookbackDays = Math.round(days);
      if (a.companySize !== undefined) E.settings.companySize = a.companySize;
      if (a.operatorId !== undefined) E.settings.operatorId = clip(a.operatorId, 40);
      if (a.registered !== undefined) E.settings.registered = !!a.registered;
      if (a.products) E.settings.products = Object.assign({}, E.settings.products, products);
      R.audit(state, ctx, { entity: "eudr", entityId: "settings", opNo: "EUDR", event: "eudr", act: Lx("EUDR: ustawienia zmienione"), before, after: E.settings });
      return { ok: true, settings: E.settings };
    });
  }
  /**
   * Import numerów referencyjnych (np. zestawienie z nadleśnictwa): wiersze { docNo, ref, ver }.
   * Dopasowanie po numerze dokumentu operacji (PZ / WZ / numer serii); numery dopisywane bez duplikatów.
   */
  function importRefs(state, rows, ctx) {
    if (!Array.isArray(rows) || !rows.length) return { ok: false, error: t("Brak wierszy do importu") };
    if (rows.length > 2000) return { ok: false, error: t("Najwyżej 2000 wierszy w jednym imporcie") };
    const byNo = new Map();
    for (const op of state.operations) if (isLive(op) && R.canAccessWh(ctx.user, op.whId)) {
      byNo.set(str(op.no).toUpperCase(), op);
      for (const d of op.documents || []) if (d.no) byNo.set(str(d.no).toUpperCase(), op);
    }
    const unmatched = [], bad = [], add = new Map();
    for (const r of rows) {
      const op = byNo.get(str(r.docNo).toUpperCase());
      if (!op) { unmatched.push(str(r.docNo)); continue; }
      const e = []; const ref = cleanRefs([{ ref: r.ref, ver: r.ver, kind: r.kind }], e)[0];
      if (!ref) { bad.push(`${str(r.docNo)}: ${e[0] || t("pusty numer")}`); continue; }
      if (!add.has(op.id)) add.set(op.id, []);
      add.get(op.id).push(Object.assign(ref, { from: "import" }));
    }
    if (!add.size) return { ok: false, error: t("Żaden wiersz nie pasuje do dokumentów w dostępnych magazynach"), unmatched, bad };
    return mutate(state, ctx, E => {
      let added = 0;
      for (const [opId, refs] of add) {
        const op = byId(state.operations, opId), cur = E.records[opId] || { opId, opNo: op.no, refs: [] };
        const have = new Set((cur.refs || []).map(x => x.ref));
        const fresh = refs.filter(x => !have.has(x.ref));
        added += fresh.length;
        E.records[opId] = Object.assign({}, cur, { refs: (cur.refs || []).concat(fresh), updatedAt: ctx.now || new Date().toISOString(), updatedBy: ctx.user.name });
      }
      R.audit(state, ctx, { entity: "eudr", entityId: "import", opNo: "EUDR", event: "eudr", act: Lx("EUDR: import numerów referencyjnych — {n} nowych, {o} transakcji", { n: added, o: add.size }), before: null, after: { dopasowane: add.size, niedopasowane: unmatched.length, bledne: bad.length } });
      return { ok: true, added, matched: add.size, unmatched, bad };
    });
  }

  /* ------------------------------------------------------------------ */
  /* Rejestracja: uprawnienia, komendy usługi, widok serwera             */
  /* ------------------------------------------------------------------ */
  R.PERMS["eudr.edit"] = N_("EUDR — numery referencyjne i dane transakcji");
  R.PERMS["eudr.manage"] = N_("EUDR — dostawcy, działki i ustawienia");
  const grant = (role, perm) => { const l = R.ROLE_DEFAULTS[role]; if (Array.isArray(l) && !l.includes(perm)) l.push(perm); };
  grant("kierownik", "eudr.edit"); grant("kierownik", "eudr.manage"); grant("magazynier", "eudr.edit");

  const S = R.Service;
  if (S) {
    Object.assign(S.COMMANDS, {
      "eudr.record.save": { perm: "eudr.edit", run: (s, a, c) => saveRecord(s, a.opId, a.rec, c) },
      "eudr.refs.import": { perm: "eudr.edit", run: (s, a, c) => importRefs(s, a.rows, c) },
      "eudr.supplier.save": { perm: "eudr.manage", run: (s, a, c) => saveSupplier(s, a.partnerId, a.rec, c) },
      "eudr.plot.save": { perm: "eudr.manage", run: (s, a, c) => savePlot(s, a.rec, c) },
      "eudr.plot.remove": { perm: "eudr.manage", run: (s, a, c) => removePlot(s, a.id, c) },
      "eudr.settings.save": { perm: "eudr.manage", run: (s, a, c) => saveSettings(s, a.settings, c) }
    });
    // izolacja magazynów: użytkownik widzi dane EUDR wyłącznie operacji ze swoich magazynów
    const project = S.project;
    S.project = function (state, user) {
      const out = project.call(this, state, user);
      if (!out || !out.projected || !state.eudr) return out;
      const ids = new Set(out.operations.map(o => o.id));
      const E = data(state);
      out.eudr = Object.assign({}, E, { records: Object.fromEntries(Object.entries(E.records).filter(([id]) => ids.has(id))) });
      return out;
    };
  }

  R.EUDR = {
    CONFIG, SUPPLIER_ROLES, OUR_ROLES, STATUS, RISK_LEVELS, COMPANY_SIZES, REF_KINDS, CAT_SCOPE, SPECIES, EU, isEU,
    data, record, productScope, supplierProfile, inputSide, evaluateInput, evaluateSale, traceSale, poolSources, register, report,
    CSV_HEAD, csvRows, geojson, ddsDraft, checkGeometry, applyFromOf,
    saveRecord, saveSupplier, savePlot, removePlot, saveSettings, importRefs
  };
  if (typeof module !== "undefined" && module.exports) module.exports = R.EUDR;
})(typeof globalThis !== "undefined" ? globalThis : this);
