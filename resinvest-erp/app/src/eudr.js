/* =========================================================================
   ResInvest ERP 3.16 — warstwa E: EUDR — drewno surowe (rozporządzenie (UE) 2023/1115 zmienione rozporządzeniem (UE) 2025/2650)

   Kolekcje stanu (zapis wierszami w bazie serwera — SQLite / PostgreSQL, ta sama transakcja co reszta zmian):
     state.eudrLots       partie drewna surowego (własny identyfikator, pochodzenie, łańcuch: PZ → MM → produkcja → WZ),
     state.eudrDocs       dokumentacja (pliki z wersjami, powiązania z partią i dostawcą),
     state.eudrDds        rejestr DDS / numerów referencyjnych — ROZDZIELONY na środowisko ACCEPTANCE i PRODUCTION,
     state.eudrSuppliers  dane EUDR dostawców — ROZSZERZENIE kartoteki kontrahentów (bez drugiej listy dostawców),
     state.eudrAudits     audyty wewnętrzne (13 obszarów),
     state.eudrTraining   szkolenia pracowników (przydział, postęp, test wiedzy, potwierdzenie wewnętrzne),
     state.eudrTests      historia testów połączenia z systemem informacyjnym EUDR (Centrum testów).
   Konfiguracja: state.config.eudr — profil firmy, tryb ACCEPTANCE / PRODUCTION, reguły (wersjonowane, zmieniane bez
   przebudowy programu), role EUDR użytkowników, przypisanie produktów do kodów CN.

   Zasady:
     * moduł NIE jest drugim systemem magazynowym: ilości i ruchy pochodzą z dokumentów ERP (PZ, MM, produkcja, WZ),
       partia tylko wskazuje dokument i ilość — bez ponownego wpisywania danych,
     * obowiązki wynikają z roli firmy w danej transakcji (operator / podmiot niższego szczebla / handlowiec), kodu CN
       i daty stosowania przepisów — brak numeru DDS nie blokuje automatycznie każdej dostawy,
     * partii nie można oznaczyć jako zgodnej wyłącznie automatycznie: wymagane są decyzje człowieka na etapach
       należytej staranności i zatwierdzenie osoby uprawnionej z uzasadnieniem,
     * dane testowe (ACCEPTANCE, symulacje, szkolenia) nie trafiają do ewidencji produkcyjnej — brak kopiowania,
       numery symulowane są oznaczone i nie są przedstawiane jako numery systemu TRACES,
     * każda zmiana ma wpis w dzienniku audytu (dziennika nie można usunąć); partie się archiwizuje, nie kasuje.
   Teksty modułu są po polsku (terminologia prawna EUDR) — funkcja P() nie przechodzi przez słowniki tłumaczeń.
   Moduł działa w przeglądarce i w Node (serwer, testy).
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  if (!R.EudrContent && typeof require === "function") require("./eudr-content.js");
  const { rq, EPS, byId, canAccessWh, Dates, NumParse, uid } = R;
  /** Tekst polski z parametrami {x}. */
  const P = (s, p) => p ? String(s).replace(/\{(\w+)\}/g, (m, k) => p[k] === undefined || p[k] === null ? m : String(p[k])) : s;
  const str = (v, max) => String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, max || 400);
  const txt = (v, max) => String(v == null ? "" : v).replace(/\r/g, "").trim().slice(0, max || 4000);
  const nowOf = ctx => (ctx && ctx.now) || new Date().toISOString();
  const todayOf = ctx => (ctx && ctx.today) || Dates.localToday();
  const col = (state, k) => Array.isArray(state[k]) ? state[k] : (state[k] = []);
  const put = (state, coll, rec) => { const a = col(state, coll), i = a.findIndex(x => x.id === rec.id); if (i >= 0) a[i] = rec; else a.push(rec); return rec; };
  const drop = (state, coll, id) => { const a = col(state, coll), i = a.findIndex(x => x.id === id); if (i >= 0) a.splice(i, 1); };
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  const deny = msg => ({ ok: false, code: "FORBIDDEN", error: msg || P("Brak uprawnień EUDR do tej czynności.") });
  const bad = (error, extra) => Object.assign({ ok: false, error }, extra || {});
  const COLLS = ["eudrLots", "eudrDocs", "eudrDds", "eudrSuppliers", "eudrAudits", "eudrTraining", "eudrTests"];

  /* ------------------------------------------------------------------ */
  /* Słowniki                                                            */
  /* ------------------------------------------------------------------ */
  const ENVS = { ACCEPTANCE: "ACCEPTANCE — środowisko testowe", PRODUCTION: "PRODUCTION — środowisko produkcyjne" };
  /** Role EUDR (niezależne od ról magazynowych; domyślne przypisanie z roli ERP). */
  const ROLES = {
    admin: "Administrator EUDR", responsible: "Osoba odpowiedzialna", warehouse: "Magazynier",
    controller: "Kontroler dokumentacji", viewer: "Podgląd", none: "Brak dostępu do modułu EUDR"
  };
  const ROLE_FROM_ERP = { admin: "admin", kierownik: "responsible", magazynier: "warehouse", audytor: "controller", obserwator: "viewer" };
  const ACTIONS = {
    view: ["admin", "responsible", "warehouse", "controller", "viewer"],
    "lot.edit": ["admin", "responsible", "warehouse"],
    "lot.link": ["admin", "responsible", "warehouse"],
    "lot.archive": ["admin", "responsible"],
    "lot.status": ["admin", "responsible", "controller"],
    "doc.add": ["admin", "responsible", "warehouse", "controller"],
    "doc.verify": ["admin", "responsible", "controller"],
    "supplier.edit": ["admin", "responsible", "controller"],
    "dd.stage": ["admin", "responsible", "controller"],
    "dd.approve": ["admin", "responsible"],
    "dds.edit": ["admin", "responsible"],
    "audit.run": ["admin", "responsible", "controller"],
    "train.manage": ["admin", "responsible"],
    "train.self": ["admin", "responsible", "warehouse", "controller", "viewer"],
    "tests.run": ["admin", "responsible"],
    "reports": ["admin", "responsible", "warehouse", "controller", "viewer"],
    "config": ["admin"], "env": ["admin"]
  };
  /** Sposób nabycia partii → rola firmy w tej transakcji (art. 2, 4, 5 po zmianie 2025/2650). */
  const ACQ = {
    own_harvest: { label: "Pozyskanie własne / pierwsze wprowadzenie na rynek UE", role: "OPERATOR" },
    import: { label: "Import spoza UE", role: "OPERATOR" },
    export: { label: "Wywóz poza UE (eksport)", role: "OPERATOR" },
    from_operator: { label: "Zakup od operatora, który złożył DDS (pierwszy podmiot niższego szczebla)", role: "DOWNSTREAM_FIRST" },
    from_sme_primary: { label: "Zakup od mikro / małego producenta pierwotnego (deklaracja uproszczona)", role: "DOWNSTREAM_FIRST" },
    from_trader: { label: "Zakup od podmiotu niższego szczebla / handlowca", role: "DOWNSTREAM" },
    not_covered: { label: "Poza zakresem EUDR (kod CN spoza załącznika I, drewno z recyklingu, odpad)", role: "NONE" }
  };
  const OBL_ROLES = {
    OPERATOR: "Operator — należyta staranność i własne oświadczenie DDS przed wprowadzeniem / wywozem",
    DOWNSTREAM_FIRST: "Pierwszy podmiot niższego szczebla — zebranie i przechowanie numeru referencyjnego DDS / identyfikatora deklaracji uproszczonej",
    DOWNSTREAM: "Podmiot niższego szczebla / handlowiec — informacje o dostawcach i odbiorcach (5 lat)",
    NONE: "Brak obowiązków EUDR dla tej partii"
  };
  const LOT_STATUS = { DRAFT: "Szkic", PENDING: "Do weryfikacji", VERIFIED: "Dopuszczona", NONCONFORM: "Niezgodna / wstrzymana", ARCHIVED: "Archiwum" };
  const COLORS = { green: "Kompletna i zweryfikowana", yellow: "Oczekuje na weryfikację / uzupełnienie", red: "Braki lub niezgodność", grey: "Archiwum" };
  const RISK_COUNTRY = { low: "Kraj niskiego ryzyka", standard: "Kraj standardowego ryzyka", high: "Kraj wysokiego ryzyka" };
  const SUPPLIER_ROLES = {
    operator: "Operator (składa DDS)", sme_primary: "Mikro / mały producent pierwotny (deklaracja uproszczona)",
    trader: "Podmiot niższego szczebla / handlowiec", forest_owner: "Właściciel / zarządca lasu (np. nadleśnictwo)",
    importer: "Importer / dostawca spoza UE", other: "Inny"
  };
  const SUPPLIER_STATUS = { UNVERIFIED: "Niezweryfikowany", PENDING: "W trakcie weryfikacji", VERIFIED: "Zweryfikowany", REJECTED: "Odrzucony", EXPIRED: "Weryfikacja wygasła" };
  /** Rodzaje dokumentów. */
  const DOC_TYPES = {
    purchase: "Dokument zakupu / umowa", invoice: "Faktura", wzpz: "Dokument WZ / PZ", transport: "Dokument przewozowy (CMR, kwit wywozowy)",
    legality: "Dokument legalności pozyskania", harvest_right: "Prawo do pozyskania (plan urządzenia lasu, zezwolenie)",
    survey: "Dokumentacja geodezyjna / wypis z rejestru gruntów", map: "Mapa", gps: "Plik GPS / GeoJSON / polygon GIS",
    supplier_statement: "Oświadczenie dostawcy", dds: "Oświadczenie o należytej staranności (DDS)", reference: "Numer referencyjny DDS",
    verification: "Numer weryfikacyjny DDS", sd: "Deklaracja uproszczona (identyfikator)", certificate: "Certyfikat (FSC / PEFC — informacyjnie)",
    other: "Inne"
  };
  const DOC_STATUS = { NEW: "Nowy — do sprawdzenia", VERIFIED: "Sprawdzony", REJECTED: "Odrzucony", ARCHIVED: "Archiwum" };
  const FILE_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/tiff": "tif", "application/geo+json": "geojson", "application/json": "json", "application/xml": "xml", "text/plain": "txt", "text/csv": "csv" };
  const FILE_MAX = 25 * 1048576;
  const DDS_KINDS = { OWN: "Własne DDS (złożone przez firmę)", SUPPLIER: "DDS dostawcy (numer referencyjny otrzymany)", SD: "Deklaracja uproszczona dostawcy", SIMULATED: "SYMULACJA — ćwiczenie (nie jest numerem TRACES)" };
  const DDS_STATUS = {
    DRAFT: "W przygotowaniu (lokalnie)", SUBMITTED: "Złożone (SUBMITTED)", AVAILABLE: "Dostępne (AVAILABLE)", REJECTED: "Odrzucone (REJECTED)",
    WITHDRAWN: "Wycofane (WITHDRAWN)", CANCELLED: "Anulowane (CANCELLED)", ARCHIVED: "Zarchiwizowane (ARCHIVED)", GROUPED: "Zgrupowane (GROUPED)", OBSOLETE: "Nieaktualne (OBSOLETE)"
  };
  const DDS_ACTIVE = ["SUBMITTED", "AVAILABLE", "GROUPED"];
  /** Kontrolowany proces ręczny (gdy brak automatycznej integracji). */
  const DDS_STEPS = [
    "Przygotuj zestaw danych partii w ResInvest ERP (kontrola kompletności)",
    "Pobierz plik danych (JSON / GeoJSON / XML) albo skopiuj dane do schowka",
    "Otwórz oficjalny system EUDR (TRACES) i zaloguj się kontem EU Login firmy",
    "Wprowadź / wczytaj dane w systemie EUDR i złóż oświadczenie",
    "Wpisz w ResInvest ERP numer referencyjny i numer weryfikacyjny nadany przez system EUDR",
    "Sprawdź status oświadczenia (po upływie co najmniej 1 godziny) i powiąż je z partią / dokumentem WZ"
  ];
  /** Obszary audytu wewnętrznego. */
  const AUDIT_AREAS = [
    { key: "role", label: "Rola podmiotu i zakres obowiązków", req: "Ustalono rolę firmy (operator / podmiot niższego szczebla / handlowiec), wielkość i datę stosowania przepisów dla każdego rodzaju transakcji." },
    { key: "lots", label: "Rejestr partii i identyfikowalność", req: "Każda partia drewna objętego EUDR ma własny identyfikator, ilość, kod CN, gatunek oraz powiązanie z dokumentem przyjęcia." },
    { key: "suppliers", label: "Dostawcy i ich weryfikacja", req: "Dostawcy mają uzupełnione dane (nazwa, adres, kraj, kontakt) i aktualny status weryfikacji." },
    { key: "docs", label: "Dokumentacja pochodzenia i legalności", req: "Dla partii zgromadzono dokumenty zakupu, przewozu, legalności pozyskania i prawa do pozyskania." },
    { key: "geo", label: "Geolokalizacja (GPS / polygon GIS)", req: "Dla partii, za które firma odpowiada jako operator, zapisano geolokalizację działek (punkt do 4 ha, wielokąt powyżej 4 ha)." },
    { key: "dd1", label: "Należyta staranność — zbieranie informacji (art. 9)", req: "Informacje z art. 9 zebrane i potwierdzone przez osobę odpowiedzialną." },
    { key: "dd2", label: "Ocena ryzyka (art. 10)", req: "Ocena ryzyka przeprowadzona i udokumentowana z uwzględnieniem kryteriów art. 10 i klasyfikacji kraju." },
    { key: "dd3", label: "Ograniczanie ryzyka (art. 11)", req: "Dla ryzyka nie-znikomego wdrożono i udokumentowano środki ograniczające przed wprowadzeniem do obrotu." },
    { key: "dds", label: "DDS, numery referencyjne i system EUDR (TRACES)", req: "Numery referencyjne i weryfikacyjne zapisane, statusy aktualne, brak mieszania danych testowych z produkcyjnymi." },
    { key: "chain", label: "Ciągłość łańcucha: PZ → MM → produkcja → WZ", req: "Ruchy partii mają odzwierciedlenie w dokumentach ERP; łączenie i dzielenie partii zachowuje pochodzenie." },
    { key: "retention", label: "Przechowywanie dokumentów (5 lat) i kopie zapasowe", req: "Dokumenty przechowywane co najmniej 5 lat, kopie zapasowe wykonywane i sprawdzane." },
    { key: "security", label: "Uprawnienia, historia zmian i bezpieczeństwo danych", req: "Role EUDR przypisane, dziennik zmian kompletny, dane dostępowe do systemu EUDR wyłącznie po stronie serwera." },
    { key: "training", label: "Szkolenia i procedury wewnętrzne", req: "Pracownicy obsługujący EUDR przeszkoleni; procedury wewnętrzne aktualne." }
  ];
  const AUDIT_STATUS = { OK: "Spełnione", PARTIAL: "Częściowo spełnione", NC: "Niezgodność", NA: "Nie dotyczy", TODO: "Nie oceniono" };

  /* ------------------------------------------------------------------ */
  /* Reguły prawne (wersjonowane; nadpisywane w konfiguracji)            */
  /* ------------------------------------------------------------------ */
  const RULES = {
    version: "2025/2650 — stan na 2026-11",
    source: "Rozporządzenie (UE) 2023/1115 zmienione rozporządzeniem (UE) 2025/2650; dokumentacja techniczna API systemu informacyjnego EUDR (V4)",
    dates: { large: "2026-12-30", medium: "2026-12-30", small: "2027-06-30", micro: "2027-06-30", eutrSme: "2026-12-30" },
    cutOff: "2020-12-31",
    retentionYears: 5,
    /** Pozycje załącznika I dla drewna (prefiksy kodów CN / HS). */
    cn: ["4401", "4402", "4403", "4404", "4405", "4406", "4407", "4408", "4409", "4410", "4411", "4412", "4413", "4414", "4415", "4416", "4417", "4418", "4419", "4420", "4421",
      "47", "48", "49", "9401", "9403", "9404", "9406"],
    geoAreaHa: 4,
    /** Dokumenty wymagane wg roli firmy w transakcji. */
    docs: {
      OPERATOR: ["purchase", "transport", "legality", "harvest_right", "gps"],
      DOWNSTREAM_FIRST: ["purchase", "invoice", "transport"],
      DOWNSTREAM: ["purchase", "invoice"],
      NONE: []
    },
    /** Czy brak numeru własnego DDS blokuje wydanie (tylko rola OPERATOR, po dacie stosowania, tryb „block”). */
    releaseMode: "block"
  };
  /** Reguły obowiązujące: wbudowane + nadpisania z konfiguracji (zmiana wymagań bez przebudowy programu). */
  function rules(state) {
    const o = (cfgOf(state).rules) || {};
    return Object.assign({}, RULES, o, { dates: Object.assign({}, RULES.dates, o.dates || {}), docs: Object.assign({}, RULES.docs, o.docs || {}) });
  }
  function cfgOf(state) { return (state.config && state.config.eudr) || {}; }
  const DEFAULT_PRODUCTS = { pr_drewno: "4401", pr_drewno_inw: "4401", pr_zr_lesna: "4401", pr_zr_inw: "4401", pr_zr_tow: "4401" };
  function profile(state) {
    const c = cfgOf(state), p = c.profile || {};
    return { company: p.company || "", country: p.country || "PL", size: p.size || "large", eutrBefore: !!p.eutrBefore, operatorRef: p.operatorRef || "", eori: p.eori || "",
      responsible: p.responsible || "", products: Object.assign({}, DEFAULT_PRODUCTS, c.products || {}) };
  }
  const envOf = state => cfgOf(state).env === "PRODUCTION" ? "PRODUCTION" : "ACCEPTANCE";
  /** Data stosowania obowiązków dla firmy. */
  function applyDate(state) {
    const r = rules(state), p = profile(state);
    if ((p.size === "small" || p.size === "micro") && !p.eutrBefore) return r.dates[p.size];
    return p.size === "small" || p.size === "micro" ? r.dates.eutrSme : r.dates[p.size] || r.dates.large;
  }
  const inAnnex = (state, cn) => { const c = String(cn || "").replace(/\D/g, ""); return !!c && rules(state).cn.some(p => c.startsWith(p)); };

  /* ------------------------------------------------------------------ */
  /* Role i uprawnienia EUDR                                             */
  /* ------------------------------------------------------------------ */
  function roleOf(state, user) {
    if (!user) return "none";
    if (user.role === "admin") return "admin";
    const a = cfgOf(state).access || {};
    if (a[user.id] && ROLES[a[user.id]]) return a[user.id];
    return ROLE_FROM_ERP[user.role] || "viewer";
  }
  const allowed = (state, user, action) => (ACTIONS[action] || []).includes(roleOf(state, user));
  const userOf = ctx => ctx && ctx.user;

  /* ------------------------------------------------------------------ */
  /* Dziennik                                                            */
  /* ------------------------------------------------------------------ */
  function log(state, ctx, entityId, no, action, before, after, whId) {
    const a = R.audit(state, ctx, { entity: "eudr", entityId, opNo: no || "—", event: "eudr", action, before: before || null, after: after || null, source: (ctx && ctx.source) || "EUDR" });
    if (whId) a.whId = whId;
    return a;
  }

  /* ------------------------------------------------------------------ */
  /* Odczyty: partie, saldo, pochodzenie, ocena                          */
  /* ------------------------------------------------------------------ */
  const lots = state => col(state, "eudrLots");
  const lotOf = (state, id) => byId(lots(state), id);
  const OUT_KINDS = ["WZ", "PROD", "SPLIT", "MERGE", "MM"];
  /** Saldo partii w jednostce produktu: ilość przyjęta − rozchody (WZ, przetworzenie, podział, łączenie, MM częściowe). */
  function balance(lot) {
    const out = (lot.links || []).filter(l => !l.void && OUT_KINDS.includes(l.kind) && l.dir === "out").reduce((s, l) => s + (Number(l.qty) || 0), 0);
    return rq((Number(lot.qty) || 0) - out);
  }
  /** Pochodzenie partii: własne albo (dla partii z podziału / łączenia / przetworzenia) wszystkich partii źródłowych. */
  function origins(state, lot, seen) {
    seen = seen || new Set();
    if (!lot || seen.has(lot.id)) return [];
    seen.add(lot.id);
    if (!(lot.parents || []).length) return [{ lotId: lot.id, no: lot.no, origin: lot.origin || {}, wood: lot.wood || {}, partnerId: lot.partnerId, acq: lot.acq }];
    const out = [];
    for (const p of lot.parents) for (const o of origins(state, lotOf(state, p.lotId), seen)) if (!out.some(x => x.lotId === o.lotId)) out.push(o);
    return out;
  }
  /** Łańcuch identyfikowalności: źródła (w górę) i rozchody / partie pochodne (w dół). */
  function trace(state, lotId) {
    const lot = lotOf(state, lotId);
    if (!lot) return null;
    const up = [], down = [];
    const walkUp = (l, d) => { for (const p of l.parents || []) { const x = lotOf(state, p.lotId); if (x && !up.some(u => u.lot.id === x.id)) { up.push({ lot: x, depth: d, qty: p.qty, kind: p.kind }); walkUp(x, d + 1); } } };
    const walkDown = (l, d) => {
      for (const k of l.links || []) if (!k.void && k.dir === "out") {
        down.push({ from: l, link: k, depth: d });
        if (k.toLotId) { const x = lotOf(state, k.toLotId); if (x && !down.some(z => z.lot && z.lot.id === x.id)) { down.push({ lot: x, depth: d + 1 }); walkDown(x, d + 1); } }
      }
    };
    walkUp(lot, 1); walkDown(lot, 1);
    const steps = [];
    const o = origins(state, lot);
    steps.push({ key: "harvest", label: "Pozyskanie", items: o.map(x => [x.origin.owner, x.origin.plot, x.origin.country, x.wood.harvestFrom].filter(Boolean).join(" · ")) });
    steps.push({ key: "supplier", label: "Dostawca", items: [...new Set(o.map(x => partnerName(state, x.partnerId)).filter(Boolean))] });
    const recs = [lot].concat(up.map(u => u.lot)).filter(l => l.receipt);
    steps.push({ key: "transport", label: "Transport", items: recs.map(l => l.receipt.transport).filter(Boolean) });
    steps.push({ key: "receipt", label: "Przyjęcie (PZ)", items: recs.map(l => `${l.receipt.opNo} · ${l.receipt.date}`) });
    steps.push({ key: "lot", label: "Partia", items: [lot.no + (up.length ? P(" (z partii: {p})", { p: up.map(u => u.lot.no).join(", ") }) : "")] });
    steps.push({ key: "purchase", label: "Zakup", items: recs.map(l => l.contract || l.receipt.opNo).filter(Boolean) });
    const all = [lot].concat(down.filter(d => d.lot).map(d => d.lot));
    const linkItems = kind => all.flatMap(l => (l.links || []).filter(k => !k.void && k.kind === kind).map(k => `${k.opNo || l.no} · ${fmtQty(k.qty)}${k.date ? " · " + k.date : ""}`));
    steps.push({ key: "mm", label: "Przesunięcie MM", items: linkItems("MM") });
    steps.push({ key: "process", label: "Przetwarzanie", items: linkItems("PROD") });
    steps.push({ key: "issue", label: "Wydanie (WZ)", items: linkItems("WZ") });
    steps.push({ key: "buyer", label: "Odbiorca", items: [...new Set(all.flatMap(l => (l.links || []).filter(k => !k.void && k.kind === "WZ").map(k => partnerName(state, k.partnerId))).filter(Boolean))] });
    return { lot, up, down, origins: o, steps };
  }
  const fmtQty = v => String(rq(Number(v) || 0)).replace(".", ",");
  const partnerName = (state, id) => { const p = byId(state.partners || [], id); return p ? p.name : ""; };
  const supplierOf = (state, partnerId) => col(state, "eudrSuppliers").find(s => s.partnerId === partnerId) || null;
  const docsOfLot = (state, lotId) => col(state, "eudrDocs").filter(d => d.status !== "ARCHIVED" && (d.lotIds || []).includes(lotId));
  const docsOfPartner = (state, partnerId) => col(state, "eudrDocs").filter(d => d.status !== "ARCHIVED" && d.partnerId === partnerId && !(d.lotIds || []).length);
  const ddsOfLot = (state, lotId) => col(state, "eudrDds").filter(d => (d.lotIds || []).includes(lotId));

  /** Obowiązki dla partii: rola w transakcji, zakres, data, wymagane dokumenty. */
  function obligations(state, lot, ctx) {
    const r = rules(state), acq = ACQ[lot.acq] ? lot.acq : "from_trader";
    const cn = (lot.wood && lot.wood.cn) || "";
    const covered = acq !== "not_covered" && inAnnex(state, cn);
    const role = covered ? ACQ[acq].role : "NONE";
    const date = applyDate(state), today = todayOf(ctx);
    return {
      acq, role, roleLabel: OBL_ROLES[role], covered, applyDate: date, inForce: today >= date,
      docs: covered ? (r.docs[role] || []) : [],
      geoRequired: role === "OPERATOR",
      ddRequired: role === "OPERATOR",
      refRequired: role === "DOWNSTREAM_FIRST" ? (acq === "from_sme_primary" ? "SD" : "DDS") : role === "OPERATOR" ? "OWN" : null,
      releaseMode: cfgOf(state).releaseMode || r.releaseMode
    };
  }
  /** Prosta kontrola GeoJSON: Point / Polygon / MultiPolygon, WGS84 (lon, lat), maks. 6 miejsc po przecinku, bez otworów. */
  function checkGeo(geo) {
    const errs = [];
    let g;
    try { g = typeof geo === "string" ? JSON.parse(geo) : geo; } catch (e) { return { ok: false, errors: ["Nieprawidłowy JSON"] }; }
    if (!g || typeof g !== "object") return { ok: false, errors: ["Brak danych geolokalizacji"] };
    const feats = g.type === "FeatureCollection" ? g.features || [] : g.type === "Feature" ? [g] : [{ type: "Feature", geometry: g }];
    if (!feats.length) errs.push("Brak obiektów (features)");
    const pt = (c, where) => {
      if (!Array.isArray(c) || c.length < 2 || !c.every(n => typeof n === "number" && Number.isFinite(n))) { errs.push(P("{w}: nieprawidłowe współrzędne", { w: where })); return; }
      const [lon, lat] = c;
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) errs.push(P("{w}: współrzędne poza zakresem WGS84 (długość, szerokość)", { w: where }));
      if (c.slice(0, 2).some(n => (String(n).split(".")[1] || "").length > 6)) errs.push(P("{w}: więcej niż 6 miejsc po przecinku", { w: where }));
    };
    let n = 0;
    for (const f of feats) {
      const gm = f && f.geometry; n++;
      const w = P("obiekt {n}", { n });
      if (!gm) { errs.push(P("{w}: brak geometrii", { w })); continue; }
      if (gm.type === "Point") pt(gm.coordinates, w);
      else if (gm.type === "Polygon" || gm.type === "MultiPolygon") {
        const polys = gm.type === "Polygon" ? [gm.coordinates] : gm.coordinates || [];
        for (const poly of polys) {
          if (!Array.isArray(poly) || !poly.length) { errs.push(P("{w}: pusty wielokąt", { w })); continue; }
          if (poly.length > 1) errs.push(P("{w}: wielokąt z otworami nie jest dopuszczony", { w }));
          const ring = poly[0] || [];
          if (ring.length < 4) errs.push(P("{w}: wielokąt musi mieć co najmniej 4 punkty (zamknięty)", { w }));
          else { ring.forEach(c => pt(c, w)); const a = ring[0], b = ring[ring.length - 1]; if (a && b && (a[0] !== b[0] || a[1] !== b[1])) errs.push(P("{w}: wielokąt nie jest zamknięty", { w })); }
        }
      } else errs.push(P("{w}: typ {t} nie jest dopuszczony (Point, Polygon, MultiPolygon)", { w, t: gm.type }));
    }
    return { ok: !errs.length, errors: errs.slice(0, 20), count: feats.length };
  }
  /** GeoJSON partii: z wielokąta GIS albo z punktu GPS. */
  function lotGeo(lot) {
    const o = lot.origin || {};
    if (o.geojson) { try { return JSON.parse(o.geojson); } catch (e) { return null; } }
    if (Number.isFinite(o.lat) && Number.isFinite(o.lon)) return { type: "FeatureCollection", features: [{ type: "Feature", properties: { ProducerName: o.owner || "", ProducerCountry: o.country || "", ProductionPlace: o.plot || "", Area: o.areaHa || undefined }, geometry: { type: "Point", coordinates: [o.lon, o.lat] } }] };
    return null;
  }
  /**
   * Ocena partii: braki, ostrzeżenia, blokady, kolor. Wynik automatyczny jest PODPOWIEDZIĄ —
   * nie zmienia statusu „Dopuszczona” (ten nadaje wyłącznie człowiek w panelu należytej staranności).
   */
  function evaluate(state, lot, ctx) {
    const ob = obligations(state, lot, ctx), w = lot.wood || {}, o = lot.origin || {};
    const missing = [], warnings = [], blocks = [];
    if (lot.status === "ARCHIVED") return { color: "grey", missing, warnings, blocks, ob, complete: false };
    const need = (cond, msg) => { if (!cond) missing.push(msg); };
    need(w.species, "Gatunek (nazwa polska)");
    need(w.cn, "Kod CN");
    need(Number(lot.qty) > 0, "Ilość");
    need(lot.partnerId, "Dostawca");
    need(o.country, "Kraj pozyskania");
    if (ob.covered) {
      need(w.speciesLatin, "Gatunek — nazwa łacińska (wymagana w DDS dla drewna)");
      need(w.harvestFrom, "Data / okres pozyskania");
      if (w.harvestFrom && w.harvestFrom <= rules(state).cutOff && ob.role === "OPERATOR") warnings.push(P("Pozyskanie przed datą graniczną {d} — sprawdź warunek „wolne od wylesiania”", { d: rules(state).cutOff }));
      const docs = docsOfLot(state, lot.id).concat(docsOfPartner(state, lot.partnerId));
      for (const d of ob.docs) if (!docs.some(x => x.type === d && x.status !== "REJECTED")) missing.push(P("Dokument: {d}", { d: DOC_TYPES[d] }));
      if (ob.geoRequired) {
        const g = lotGeo(lot);
        if (!g) missing.push("Geolokalizacja (GPS albo polygon GIS)");
        else {
          const c = checkGeo(g); if (!c.ok) missing.push(P("Geolokalizacja niepoprawna: {e}", { e: c.errors[0] }));
          if (Number(o.areaHa) > rules(state).geoAreaHa && !o.geojson) missing.push(P("Działka powyżej {h} ha — wymagany wielokąt (polygon), nie punkt", { h: rules(state).geoAreaHa }));
        }
      }
      const sup = supplierOf(state, lot.partnerId);
      if (!sup || sup.status !== "VERIFIED") warnings.push("Dostawca bez potwierdzonej weryfikacji EUDR");
      const prod = ddsOfLot(state, lot.id).filter(d => d.env === "PRODUCTION" && d.kind !== "SIMULATED");
      const test = ddsOfLot(state, lot.id).filter(d => d.env !== "PRODUCTION" || d.kind === "SIMULATED");
      if (test.length) warnings.push("Powiązane DDS testowe / symulowane nie są uwzględniane w ocenie zgodności");
      const hasRef = kind => prod.some(d => (kind ? d.kind === kind : true) && d.referenceNumber && DDS_ACTIVE.includes(d.status));
      if (ob.refRequired === "DDS" && !hasRef("SUPPLIER")) warnings.push("Brak numeru referencyjnego DDS dostawcy — uzupełnij przed dalszą sprzedażą (obowiązek zebrania i przechowania)");
      if (ob.refRequired === "SD" && !hasRef("SD")) warnings.push("Brak identyfikatora deklaracji uproszczonej dostawcy");
      if (ob.refRequired === "OWN" && !hasRef("OWN")) {
        const msg = "Brak własnego DDS z numerem referencyjnym — wprowadzenie do obrotu / wywóz niedozwolone";
        if (ob.inForce && ob.releaseMode === "block") blocks.push(msg); else warnings.push(ob.inForce ? msg : P("{m} (obowiązek od {d})", { m: msg, d: ob.applyDate }));
      }
      if (ob.ddRequired) {
        const dd = lot.dd || {};
        if (!(dd.s1 && dd.s1.done)) missing.push("Należyta staranność: etap 1 — zbieranie informacji");
        if (!(dd.s2 && dd.s2.done)) missing.push("Należyta staranność: etap 2 — ocena ryzyka");
        if (dd.s2 && dd.s2.result === "NOT_NEGLIGIBLE" && !(dd.s3 && dd.s3.measures)) missing.push("Należyta staranność: etap 3 — środki ograniczające ryzyko");
      }
    }
    if (lot.status === "NONCONFORM") blocks.push("Partia oznaczona jako niezgodna / wstrzymana");
    const complete = !missing.length;
    const color = blocks.length || (missing.length && lot.status !== "DRAFT") ? "red" : lot.status === "VERIFIED" && complete ? "green" : missing.length ? "red" : "yellow";
    return { color, missing, warnings, blocks, ob, complete };
  }
  /** Kontrola wydania (WZ) partii: blokady według obowiązków firmy, ostrzeżenia. */
  function releaseCheck(state, lot, ctx) {
    const e = evaluate(state, lot, ctx);
    const blocks = e.blocks.slice(), warnings = e.warnings.slice();
    if (e.ob.covered && lot.status !== "VERIFIED") {
      const msg = "Partia nie została dopuszczona w panelu należytej staranności";
      if (e.ob.role === "OPERATOR" && e.ob.inForce && e.ob.releaseMode === "block") blocks.push(msg); else warnings.push(msg);
    }
    return { ok: !blocks.length, blocks, warnings, eval: e };
  }

  /* ------------------------------------------------------------------ */
  /* Pulpit                                                              */
  /* ------------------------------------------------------------------ */
  function visibleLots(state, user) { return lots(state).filter(l => !user || canAccessWh(user, l.whId) || !l.whId); }
  function dashboard(state, user, ctx) {
    const L = visibleLots(state, user), act = L.filter(l => l.status !== "ARCHIVED");
    const ev = new Map(L.map(l => [l.id, evaluate(state, l, ctx)]));
    const env = envOf(state);
    const prodDds = col(state, "eudrDds").filter(d => d.env === "PRODUCTION" && d.kind !== "SIMULATED");
    const sup = new Set(act.map(l => l.partnerId).filter(Boolean));
    for (const s of col(state, "eudrSuppliers")) sup.add(s.partnerId);
    const kpi = {
      lots: act.length, suppliers: sup.size,
      complete: act.filter(l => ev.get(l.id).complete).length,
      missing: act.filter(l => ev.get(l.id).color === "red").length,
      pending: act.filter(l => l.status === "PENDING").length,
      verified: act.filter(l => l.status === "VERIFIED").length,
      ddsActive: prodDds.filter(d => DDS_ACTIVE.includes(d.status)).length,
      withRef: act.filter(l => prodDds.some(d => (d.lotIds || []).includes(l.id) && d.referenceNumber)).length,
      archived: L.length - act.length
    };
    const alerts = [];
    for (const l of act) {
      const e = ev.get(l.id);
      for (const b of e.blocks) alerts.push({ level: "red", lotId: l.id, no: l.no, text: b });
      if (e.missing.length && l.status !== "DRAFT") alerts.push({ level: "red", lotId: l.id, no: l.no, text: P("Braki: {n} — {f}", { n: e.missing.length, f: e.missing[0] }) });
      else if (l.status === "PENDING") alerts.push({ level: "yellow", lotId: l.id, no: l.no, text: "Oczekuje na weryfikację należytej staranności" });
    }
    const today = todayOf(ctx);
    for (const s of col(state, "eudrSuppliers")) if (s.validTo && s.validTo < today && s.status === "VERIFIED") alerts.push({ level: "yellow", partnerId: s.partnerId, text: P("Weryfikacja dostawcy {n} wygasła {d}", { n: partnerName(state, s.partnerId), d: s.validTo }) });
    for (const p of unassignedReceipts(state, user).slice(0, 20)) alerts.push({ level: "yellow", opId: p.op.id, text: P("Przyjęcie {no} ({d}) — drewno objęte EUDR bez partii", { no: p.op.no, d: p.op.date }) });
    const lastAudit = col(state, "eudrAudits").filter(a => a.status === "CLOSED").sort((a, b) => a.date < b.date ? 1 : -1)[0];
    if (lastAudit && lastAudit.nextDate && lastAudit.nextDate < today) alerts.push({ level: "yellow", text: P("Termin kolejnego audytu EUDR minął ({d})", { d: lastAudit.nextDate }) });
    if (!lastAudit) alerts.push({ level: "yellow", text: "Nie przeprowadzono jeszcze audytu wewnętrznego EUDR" });
    const recent = (state.audit || []).filter(a => a.entity === "eudr").slice(-12).reverse();
    return { kpi, alerts: alerts.slice(0, 60), recent, env, applyDate: applyDate(state), ev };
  }
  /** Przyjęcia (zakupy) produktów objętych EUDR bez przypisanej partii lub z nieprzypisaną resztą ilości. */
  function unassignedReceipts(state, user) {
    const pr = profile(state).products, out = [];
    for (const op of state.operations || []) {
      if (op.type !== "ZAKUP" || op.status === "CANCELLED" || op.status === "DELETED" || op.cancelled) continue;
      if (user && !canAccessWh(user, op.whId)) continue;
      const pu = (op.input && op.input.purchase) || {};
      if (!pu.productId || !inAnnex(state, pr[pu.productId])) continue;
      const qty = opQty(state, op);
      const used = lots(state).filter(l => l.receipt && l.receipt.opId === op.id && l.status !== "ARCHIVED").reduce((s, l) => s + (Number(l.qty) || 0), 0);
      if (qty - used > EPS) out.push({ op, qty, used: rq(used), rest: rq(qty - used) });
    }
    return out.sort((a, b) => a.op.date < b.op.date ? 1 : -1);
  }
  /** Ilość zakupu w jednostce produktu (z dokumentu ERP). */
  function opQty(state, op) {
    const pu = (op.input && op.input.purchase) || {}, pr = byId(state.products, pu.productId);
    const q = NumParse.parse(pu.qty);
    if (!q.ok || !pr) return 0;
    if (!pu.unit || pu.unit === pr.unit) return rq(q.value);
    const m3 = R.Units.toM3 ? R.Units.toM3(q.value, pu.unit, pr, state.config) : null;
    const v = m3 != null && R.Units.fromM3 ? R.Units.fromM3(m3, pr.unit, pr, state.config) : null;
    return v != null ? rq(v) : rq(q.value);
  }

  /* ------------------------------------------------------------------ */
  /* Partie: zapis, z dokumentu PZ, powiązania, podział, łączenie        */
  /* ------------------------------------------------------------------ */
  function nextNo(state, prefix, coll, date) {
    const y = String(date || "").slice(0, 4) || "0000", re = new RegExp(`^${prefix}/${y}/(\\d+)$`);
    let max = 0;
    for (const x of col(state, coll)) { const m = re.exec(x.no || ""); if (m) max = Math.max(max, Number(m[1])); }
    return `${prefix}/${y}/${String(max + 1).padStart(4, "0")}`;
  }
  const numOpt = (v, lo, hi) => {
    if (v === "" || v === null || v === undefined) return { ok: true, value: null };
    const n = typeof v === "number" ? { ok: Number.isFinite(v), value: v } : NumParse.parse(v);
    return n.ok && n.value >= lo && n.value <= hi ? { ok: true, value: n.value } : { ok: false };
  };
  const WOOD_FIELDS = ["species", "speciesLatin", "kind", "cn", "country", "region", "place", "harvestFrom", "harvestTo"];
  const ORIGIN_FIELDS = ["owner", "ownerKind", "plot", "country", "region", "riskCountry", "legalNote"];
  function cleanLot(state, a, old, ctx) {
    const errs = {};
    const wood = Object.assign({}, old && old.wood);
    for (const k of WOOD_FIELDS) if (a.wood && a.wood[k] !== undefined) wood[k] = str(a.wood[k], 160);
    if (wood.cn) wood.cn = wood.cn.replace(/[^\d ]/g, "").trim().slice(0, 12);
    for (const k of ["harvestFrom", "harvestTo"]) if (wood[k] && !isDate(wood[k])) errs[k] = "Podaj datę RRRR-MM-DD";
    if (wood.harvestFrom && wood.harvestTo && wood.harvestTo < wood.harvestFrom) errs.harvestTo = "Koniec okresu pozyskania przed jego początkiem";
    const origin = Object.assign({}, old && old.origin);
    for (const k of ORIGIN_FIELDS) if (a.origin && a.origin[k] !== undefined) origin[k] = str(a.origin[k], 300);
    if (origin.country) origin.country = origin.country.toUpperCase().slice(0, 2);
    if (wood.country) wood.country = wood.country.toUpperCase().slice(0, 2);
    if (origin.riskCountry && !RISK_COUNTRY[origin.riskCountry]) errs.riskCountry = "Wybierz klasyfikację kraju";
    if (a.origin) {
      for (const [k, lo, hi] of [["lat", -90, 90], ["lon", -180, 180], ["areaHa", 0, 1e7]]) if (a.origin[k] !== undefined) {
        const n = numOpt(a.origin[k], lo, hi);
        if (!n.ok) errs[k] = "Nieprawidłowa wartość"; else origin[k] = n.value == null ? null : (k === "areaHa" ? rq(n.value) : Math.round(n.value * 1e6) / 1e6);
      }
      if (a.origin.geojson !== undefined) {
        const g = txt(a.origin.geojson, 2000000);
        if (g) { const c = checkGeo(g); if (!c.ok) errs.geojson = c.errors.join("; "); else origin.geojson = JSON.stringify(JSON.parse(g)); } else origin.geojson = "";
      }
    }
    const rec = Object.assign({}, old || {});
    rec.wood = wood; rec.origin = origin;
    if (a.acq !== undefined) { if (!ACQ[a.acq]) errs.acq = "Wybierz sposób nabycia"; else rec.acq = a.acq; }
    if (!rec.acq) rec.acq = "from_trader";
    for (const k of ["contract", "notes", "transport"]) if (a[k] !== undefined) rec[k] = txt(a[k], 2000);
    if (a.partnerId !== undefined) {
      if (a.partnerId && !byId(state.partners || [], a.partnerId)) errs.partnerId = "Wybierz dostawcę z kartoteki kontrahentów";
      else rec.partnerId = a.partnerId || "";
    }
    if (a.whId !== undefined) {
      if (!byId(state.warehouses || [], a.whId)) errs.whId = "Wybierz magazyn";
      else if (!canAccessWh(userOf(ctx), a.whId)) errs.whId = "Brak dostępu do magazynu";
      else rec.whId = a.whId;
    }
    if (a.productId !== undefined) { if (a.productId && !byId(state.products, a.productId)) errs.productId = "Wybierz produkt"; else rec.productId = a.productId || ""; }
    for (const [k, hi] of [["qty", 1e9], ["m3", 1e9], ["t", 1e9]]) if (a[k] !== undefined) {
      const n = numOpt(a[k], 0, hi);
      if (!n.ok) errs[k] = "Nieprawidłowa ilość"; else rec[k] = n.value == null ? 0 : rq(n.value);
    }
    if (a.receivedDate !== undefined) { if (a.receivedDate && !isDate(a.receivedDate)) errs.receivedDate = "Podaj datę"; else rec.receivedDate = a.receivedDate || ""; }
    if (!rec.productId && rec.wood && rec.wood.cn === "") errs.cn = "Podaj kod CN";
    return { rec, errs };
  }
  function saveLot(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "lot.edit")) return deny();
    const old = a.id ? lotOf(state, a.id) : null;
    if (a.id && !old) return bad("Nie znaleziono partii");
    if (old && old.status === "ARCHIVED") return bad("Partia jest w archiwum — przywróć ją, aby edytować");
    if (old && old.whId && !canAccessWh(user, old.whId)) return deny("Brak dostępu do magazynu partii");
    const { rec, errs } = cleanLot(state, a, old, ctx);
    if (!rec.whId) errs.whId = errs.whId || "Wybierz magazyn";
    if (!(Number(rec.qty) > 0)) errs.qty = errs.qty || "Podaj ilość większą od zera";
    if (old && (old.links || []).some(l => !l.void && l.dir === "out") && Number(rec.qty) + EPS < Number(old.qty) - balance(old)) errs.qty = "Ilość mniejsza niż już wydana / przetworzona";
    if (Object.keys(errs).length) return bad("Popraw zaznaczone pola", { errors: errs });
    const ts = nowOf(ctx);
    if (!old) {
      rec.id = uid("el"); rec.no = nextNo(state, "EUDR", "eudrLots", rec.receivedDate || todayOf(ctx));
      rec.status = "DRAFT"; rec.links = []; rec.parents = []; rec.dd = {}; rec.createdAt = ts; rec.createdBy = user.name;
      if (a.receipt) rec.receipt = a.receipt;
    }
    if (a.submit && rec.status === "DRAFT") rec.status = "PENDING";
    // zmiana danych partii dopuszczonej wymaga ponownej weryfikacji
    const changed = old && JSON.stringify([old.wood, old.origin, old.qty, old.partnerId, old.acq]) !== JSON.stringify([rec.wood, rec.origin, rec.qty, rec.partnerId, rec.acq]);
    if (changed && old.status === "VERIFIED") { rec.status = "PENDING"; rec.dd = Object.assign({}, rec.dd, { s3: null, approval: null }); }
    rec.updatedAt = ts; rec.updatedBy = user.name;
    put(state, "eudrLots", rec); state.rev += 1;
    log(state, ctx, rec.id, rec.no, old ? (changed && old.status === "VERIFIED" ? "EUDR — edycja partii dopuszczonej (wymaga ponownej weryfikacji)" : "EUDR — edycja partii") : "EUDR — nowa partia",
      old ? { ilosc: old.qty, gatunek: old.wood && old.wood.species, status: old.status } : null, { ilosc: rec.qty, gatunek: rec.wood.species, kod_CN: rec.wood.cn, status: rec.status }, rec.whId);
    return { ok: true, lot: rec };
  }
  /** Partia z dokumentu przyjęcia (PZ) — dane przepisane z dokumentu ERP, bez ponownego wpisywania. */
  function lotFromOp(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "lot.edit")) return deny();
    const op = byId(state.operations || [], a.opId);
    if (!op || op.type !== "ZAKUP") return bad("Wybierz dokument przyjęcia (zakup)");
    if (!canAccessWh(user, op.whId)) return deny("Brak dostępu do magazynu dokumentu");
    const pend = unassignedReceipts(state, null).find(x => x.op.id === op.id);
    if (!pend) return bad(P("Cała ilość z dokumentu {no} jest już przypisana do partii EUDR — wybierz istniejącą partię", { no: op.no }));
    const pu = op.input.purchase || {}, pr = byId(state.products, pu.productId), prod = (op.input && op.input.production) || {};
    const q = a.qty !== undefined && a.qty !== "" ? NumParse.parse(a.qty) : { ok: true, value: pend.rest };
    if (!q.ok || q.value <= 0 || q.value > pend.rest + EPS) return bad(P("Ilość partii: od 0 do {r} {u}", { r: fmtQty(pend.rest), u: pr ? pr.unit : "" }));
    const sup = byId(state.partners || [], pu.supplierId);
    const supEudr = sup ? supplierOf(state, sup.id) : null;
    const acq = a.acq || (supEudr && supEudr.role === "operator" ? "from_operator" : supEudr && supEudr.role === "sme_primary" ? "from_sme_primary" : sup && sup.kind === "nadlesnictwo" ? "own_harvest" : "from_trader");
    const tr = op.input.transport || {}, runs = ((tr.own && tr.own.runs) || []).map(r => r.kwit).filter(Boolean);
    const m3 = pr && pr.unit === "m3" ? q.value : (R.Units.toM3 ? R.Units.toM3(q.value, pr ? pr.unit : "", pr, state.config) : null);
    const args = Object.assign({
      whId: op.whId, productId: pu.productId, qty: q.value, m3: m3 != null ? rq(m3) : "", t: "", receivedDate: op.date, partnerId: pu.supplierId || "", acq,
      wood: { species: a.species || "", speciesLatin: a.speciesLatin || "", kind: pr ? pr.name : "", cn: profile(state).products[pu.productId] || "", country: "PL", harvestFrom: "", harvestTo: "", place: [prod.ndl, prod.lesnictwo || pu.lesnictwo].filter(Boolean).join(" / ") },
      origin: { owner: prod.ndl ? P("Nadleśnictwo {n}", { n: prod.ndl }) : (sup ? sup.name : ""), plot: prod.kwit || "", country: "PL", riskCountry: "low" },
      transport: runs.length ? P("Kwity wywozowe: {k}", { k: runs.join(", ") }) : (prod.kwit || ""),
      receipt: { opId: op.id, opNo: op.no, date: op.date, qty: rq(q.value), transport: runs.join(", ") || prod.kwit || "" }
    }, a.override || {});
    const r = saveLot(state, args, Object.assign({}, ctx, { source: "EUDR — partia z dokumentu przyjęcia" }));
    if (r.ok) log(state, ctx, r.lot.id, r.lot.no, "EUDR — partia utworzona z dokumentu przyjęcia", null, { dokument: op.no, ilosc: q.value }, op.whId);
    return r;
  }
  const OP_KIND = { PZ: ["ZAKUP"], MM: ["MM"], PROD: ["PRODUKCJA", "ZAKUP"], WZ: ["SPRZEDAZ", "ZAKUP"] };
  /** Powiązanie partii z dokumentem ERP (PZ, MM, przetworzenie, WZ); WZ z kontrolą wydania. */
  function linkOp(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "lot.link")) return deny();
    const lot = lotOf(state, a.lotId);
    if (!lot) return bad("Nie znaleziono partii");
    if (lot.status === "ARCHIVED") return bad("Partia jest w archiwum");
    if (!canAccessWh(user, lot.whId)) return deny("Brak dostępu do magazynu partii");
    const kind = a.kind;
    if (!OP_KIND[kind]) return bad("Wybierz rodzaj dokumentu");
    const op = byId(state.operations || [], a.opId);
    if (!op || !OP_KIND[kind].includes(op.type)) return bad("Wybierz dokument odpowiedniego rodzaju");
    if (op.status === "CANCELLED" || op.cancelled) return bad("Dokument jest anulowany");
    if ((lot.links || []).some(l => !l.void && l.opId === op.id && l.kind === kind)) return bad(P("Dokument {no} jest już powiązany z tą partią", { no: op.no }));
    const q = NumParse.parse(a.qty);
    const bal = balance(lot);
    if (!q.ok || q.value <= 0) return bad("Podaj ilość");
    if (kind !== "PZ" && q.value > bal + EPS) return bad(P("Ilość większa niż saldo partii ({b})", { b: fmtQty(bal) }));
    let warnings = [];
    if (kind === "WZ") {
      const rc = releaseCheck(state, lot, ctx);
      if (!rc.ok && !a.force) return bad("Wydanie partii zablokowane wymaganiami EUDR", { blocks: rc.blocks, warnings: rc.warnings, code: "EUDR_BLOCK" });
      if (!rc.ok && a.force && roleOf(state, user) !== "admin") return deny("Obejście blokady wymaga Administratora EUDR");
      if (!rc.ok && a.force && txt(a.reason).length < 20) return bad("Podaj uzasadnienie obejścia blokady (co najmniej 20 znaków)");
      warnings = rc.warnings.concat(rc.blocks);
    }
    const ts = nowOf(ctx), link = { id: uid("lk"), kind, dir: kind === "PZ" ? "in" : "out", opId: op.id, opNo: op.no, date: op.date, qty: rq(q.value), by: user.name, at: ts };
    if (kind === "WZ") link.partnerId = (op.input && op.input.sale && op.input.sale.buyerId) || "";
    if (a.force) link.forced = txt(a.reason, 500);
    const rec = Object.assign({}, lot, { links: (lot.links || []).concat(link), updatedAt: ts, updatedBy: user.name });
    let child = null;
    if (kind === "MM") {
      const to = op.toWhId || (op.input && op.input.mm && op.input.mm.toWhId);
      if (Math.abs(q.value - bal) <= EPS) { link.dir = "move"; rec.whId = to || rec.whId; link.toWhId = to; }
      else {
        child = makeChild(state, lot, q.value, to || lot.whId, "MM", ctx);
        link.toLotId = child.id; link.toWhId = to;
      }
    }
    if (kind === "PZ" && !rec.receipt) rec.receipt = { opId: op.id, opNo: op.no, date: op.date, qty: rq(q.value) };
    put(state, "eudrLots", rec); if (child) put(state, "eudrLots", child); state.rev += 1;
    log(state, ctx, lot.id, lot.no, P("EUDR — powiązanie partii z dokumentem {k}", { k: kind }), { saldo: bal }, { dokument: op.no, ilosc: link.qty, saldo: balance(rec), partia_pochodna: child ? child.no : undefined, obejscie_blokady: link.forced }, lot.whId);
    return { ok: true, lot: rec, child, warnings };
  }
  /** Wycofanie błędnego powiązania (bez usuwania — wpis zostaje z oznaczeniem „wycofane”). */
  function unlinkOp(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "lot.archive")) return deny();
    const lot = lotOf(state, a.lotId), l = lot && (lot.links || []).find(x => x.id === a.linkId);
    if (!l || l.void) return bad("Nie znaleziono powiązania");
    if (l.toLotId) { const ch = lotOf(state, l.toLotId); if (ch && ((ch.links || []).some(x => !x.void && x.dir === "out") || ch.status !== "DRAFT" && ch.status !== "PENDING")) return bad("Partia pochodna ma już ruchy — wycofaj najpierw je"); }
    if (txt(a.reason).length < 5) return bad("Podaj powód wycofania");
    const ts = nowOf(ctx);
    const rec = Object.assign({}, lot, { links: lot.links.map(x => x.id === l.id ? Object.assign({}, x, { void: { at: ts, by: user.name, reason: txt(a.reason, 500) } }) : x) });
    if (l.dir === "move" && l.toWhId) { const prev = (lot.links || []).filter(x => x.dir === "move" && !x.void && x.id !== l.id).slice(-1)[0]; rec.whId = prev ? prev.toWhId : (a.fromWhId || lot.whId); }
    put(state, "eudrLots", rec);
    if (l.toLotId) { const ch = lotOf(state, l.toLotId); if (ch) put(state, "eudrLots", Object.assign({}, ch, { status: "ARCHIVED", archivedReason: "Wycofane powiązanie źródłowe" })); }
    state.rev += 1;
    log(state, ctx, lot.id, lot.no, "EUDR — wycofanie powiązania z dokumentem", { dokument: l.opNo, ilosc: l.qty }, { powod: txt(a.reason, 500) }, lot.whId);
    return { ok: true, lot: rec };
  }
  function makeChild(state, lot, qty, whId, kind, ctx, extra) {
    const ts = nowOf(ctx), user = userOf(ctx);
    const share = Number(lot.qty) > 0 ? qty / Number(lot.qty) : 0;
    return Object.assign({
      id: uid("el"), no: nextNo(state, "EUDR", "eudrLots", todayOf(ctx)), whId, productId: lot.productId, qty: rq(qty),
      m3: lot.m3 ? rq(lot.m3 * share) : 0, t: lot.t ? rq(lot.t * share) : 0, receivedDate: todayOf(ctx), partnerId: lot.partnerId, acq: lot.acq,
      wood: Object.assign({}, lot.wood), origin: Object.assign({}, lot.origin), contract: lot.contract || "",
      status: lot.status === "VERIFIED" ? "VERIFIED" : "PENDING", dd: lot.status === "VERIFIED" ? Object.assign({}, lot.dd, { inherited: lot.no }) : {},
      parents: [{ lotId: lot.id, no: lot.no, qty: rq(qty), kind }], links: [], createdAt: ts, createdBy: user.name, updatedAt: ts, updatedBy: user.name
    }, extra || {});
  }
  /** Podział partii na części (pochodzenie, dokumenty DDS i wynik należytej staranności przechodzą na części). */
  function splitLot(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "lot.link")) return deny();
    const lot = lotOf(state, a.id);
    if (!lot || lot.status === "ARCHIVED") return bad("Nie znaleziono partii");
    if (!canAccessWh(user, lot.whId)) return deny("Brak dostępu do magazynu partii");
    const parts = (Array.isArray(a.parts) ? a.parts : []).map(p => ({ q: NumParse.parse(p.qty), whId: p.whId || lot.whId }));
    if (!parts.length || parts.some(p => !p.q.ok || p.q.value <= 0)) return bad("Podaj ilości części");
    const sum = parts.reduce((s, p) => s + p.q.value, 0), bal = balance(lot);
    if (sum > bal + EPS) return bad(P("Suma części ({s}) większa niż saldo partii ({b})", { s: fmtQty(sum), b: fmtQty(bal) }));
    for (const p of parts) if (!canAccessWh(user, p.whId)) return deny("Brak dostępu do magazynu części");
    const ts = nowOf(ctx), kids = [];
    let rec = Object.assign({}, lot, { links: (lot.links || []).slice() });
    for (const p of parts) {
      const ch = makeChild(state, lot, p.q.value, p.whId, "SPLIT", ctx);
      put(state, "eudrLots", ch); kids.push(ch);
      rec.links.push({ id: uid("lk"), kind: "SPLIT", dir: "out", qty: rq(p.q.value), toLotId: ch.id, opNo: ch.no, date: todayOf(ctx), by: user.name, at: ts });
    }
    for (const d of ddsOfLot(state, lot.id)) put(state, "eudrDds", Object.assign({}, d, { lotIds: d.lotIds.concat(kids.map(k => k.id)) }));
    for (const d of docsOfLot(state, lot.id)) put(state, "eudrDocs", Object.assign({}, d, { lotIds: d.lotIds.concat(kids.map(k => k.id)) }));
    rec.updatedAt = ts; rec.updatedBy = user.name;
    put(state, "eudrLots", rec); state.rev += 1;
    log(state, ctx, lot.id, lot.no, "EUDR — podział partii", { saldo: bal }, { czesci: kids.map(k => `${k.no}: ${fmtQty(k.qty)}`).join("; "), saldo: balance(rec) }, lot.whId);
    return { ok: true, lot: rec, children: kids };
  }
  /** Łączenie partii (np. mieszanie na placu) — nowa partia z listą wszystkich źródeł i ich pochodzeniem. */
  function mergeLots(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "lot.link")) return deny();
    const src = [...new Set(a.ids || [])].map(id => lotOf(state, id));
    if (src.length < 2 || src.some(l => !l || l.status === "ARCHIVED")) return bad("Wybierz co najmniej dwie aktywne partie");
    if (src.some(l => !canAccessWh(user, l.whId))) return deny("Brak dostępu do magazynu partii");
    if (new Set(src.map(l => l.productId)).size > 1) return bad("Łączyć można partie tego samego produktu");
    if (new Set(src.map(l => l.whId)).size > 1) return bad("Łączyć można partie z jednego magazynu");
    const qtys = src.map(l => balance(l));
    if (qtys.some(q => q <= EPS)) return bad("Partia bez salda nie może być łączona");
    const ts = nowOf(ctx), total = qtys.reduce((s, q) => s + q, 0), base = src[0];
    const anyCovered = src.some(l => obligations(state, l, ctx).covered);
    const mixed = new Set(src.map(l => (l.wood && l.wood.species) || "")).size > 1;
    const rec = makeChild(state, base, total, base.whId, "MERGE", ctx, {
      parents: src.map((l, i) => ({ lotId: l.id, no: l.no, qty: rq(qtys[i]), kind: "MERGE" })),
      m3: rq(src.reduce((s, l, i) => s + (Number(l.m3) || 0) * (Number(l.qty) ? qtys[i] / Number(l.qty) : 0), 0)),
      t: rq(src.reduce((s, l, i) => s + (Number(l.t) || 0) * (Number(l.qty) ? qtys[i] / Number(l.qty) : 0), 0)),
      wood: Object.assign({}, base.wood, mixed ? { species: src.map(l => l.wood && l.wood.species).filter(Boolean).join(" + "), speciesLatin: src.map(l => l.wood && l.wood.speciesLatin).filter(Boolean).join(" + ") } : {}),
      partnerId: new Set(src.map(l => l.partnerId)).size === 1 ? base.partnerId : "",
      status: src.every(l => l.status === "VERIFIED") ? "VERIFIED" : "PENDING",
      dd: src.every(l => l.status === "VERIFIED") ? { inherited: src.map(l => l.no).join(", ") } : {},
      notes: txt(a.notes, 2000)
    });
    put(state, "eudrLots", rec);
    src.forEach((l, i) => put(state, "eudrLots", Object.assign({}, l, { links: (l.links || []).concat({ id: uid("lk"), kind: "MERGE", dir: "out", qty: rq(qtys[i]), toLotId: rec.id, opNo: rec.no, date: todayOf(ctx), by: user.name, at: ts }), updatedAt: ts, updatedBy: user.name })));
    for (const d of col(state, "eudrDds").filter(d => src.some(l => (d.lotIds || []).includes(l.id)))) put(state, "eudrDds", Object.assign({}, d, { lotIds: d.lotIds.concat(rec.id) }));
    state.rev += 1;
    log(state, ctx, rec.id, rec.no, "EUDR — łączenie partii", { partie: src.map(l => l.no).join(", ") }, { nowa_partia: rec.no, ilosc: rec.qty, objete_eudr: anyCovered }, rec.whId);
    return { ok: true, lot: rec };
  }
  /** Przetworzenie (produkcja): partie surowca → partia wyrobu z zachowaniem pochodzenia. */
  function processLots(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "lot.link")) return deny();
    const op = a.opId ? byId(state.operations || [], a.opId) : null;
    if (a.opId && (!op || !OP_KIND.PROD.includes(op.type))) return bad("Wybierz dokument produkcji");
    const inputs = (a.inputs || []).map(x => ({ lot: lotOf(state, x.lotId), q: NumParse.parse(x.qty) }));
    if (!inputs.length || inputs.some(x => !x.lot || x.lot.status === "ARCHIVED" || !x.q.ok || x.q.value <= 0)) return bad("Wybierz partie surowca i ilości");
    for (const x of inputs) { if (!canAccessWh(user, x.lot.whId)) return deny("Brak dostępu do magazynu partii"); if (x.q.value > balance(x.lot) + EPS) return bad(P("Ilość z partii {no} większa niż saldo", { no: x.lot.no })); }
    const pr = byId(state.products, a.productId), q = NumParse.parse(a.qty);
    if (!pr) return bad("Wybierz produkt wyrobu");
    if (!q.ok || q.value <= 0) return bad("Podaj ilość wyrobu");
    const ts = nowOf(ctx), base = inputs[0].lot, cn = profile(state).products[pr.id] || base.wood.cn;
    const rec = makeChild(state, base, q.value, a.whId || base.whId, "PROD", ctx, {
      productId: pr.id, m3: 0, t: 0, parents: inputs.map(x => ({ lotId: x.lot.id, no: x.lot.no, qty: rq(x.q.value), kind: "PROD" })),
      wood: Object.assign({}, base.wood, { cn, kind: pr.name }),
      status: inputs.every(x => x.lot.status === "VERIFIED") ? "VERIFIED" : "PENDING",
      dd: inputs.every(x => x.lot.status === "VERIFIED") ? { inherited: inputs.map(x => x.lot.no).join(", ") } : {},
      production: op ? { opId: op.id, opNo: op.no, date: op.date } : null
    });
    put(state, "eudrLots", rec);
    for (const x of inputs) put(state, "eudrLots", Object.assign({}, x.lot, { links: (x.lot.links || []).concat({ id: uid("lk"), kind: "PROD", dir: "out", qty: rq(x.q.value), toLotId: rec.id, opId: op ? op.id : "", opNo: op ? op.no : rec.no, date: op ? op.date : todayOf(ctx), by: user.name, at: ts }), updatedAt: ts, updatedBy: user.name }));
    for (const d of col(state, "eudrDds").filter(d => inputs.some(x => (d.lotIds || []).includes(x.lot.id)))) put(state, "eudrDds", Object.assign({}, d, { lotIds: d.lotIds.concat(rec.id) }));
    state.rev += 1;
    log(state, ctx, rec.id, rec.no, "EUDR — przetworzenie partii (produkcja)", { partie: inputs.map(x => `${x.lot.no}: ${fmtQty(x.q.value)}`).join("; ") }, { wyrob: pr.name, ilosc: rec.qty, dokument: op ? op.no : "—" }, rec.whId);
    return { ok: true, lot: rec };
  }
  /** Archiwizacja (partii nie usuwa się — historia zostaje); usunięcie tylko szkicu bez powiązań. */
  function archiveLot(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "lot.archive")) return deny();
    const lot = lotOf(state, a.id);
    if (!lot) return bad("Nie znaleziono partii");
    if (!canAccessWh(user, lot.whId)) return deny("Brak dostępu do magazynu partii");
    const ts = nowOf(ctx);
    if (a.action === "delete") {
      const used = (lot.links || []).length || lots(state).some(l => (l.parents || []).some(p => p.lotId === lot.id)) || docsOfLot(state, lot.id).length || ddsOfLot(state, lot.id).length;
      if (lot.status !== "DRAFT" || used) return bad("Usunąć można tylko szkic bez powiązań — pozostałe partie się archiwizuje");
      drop(state, "eudrLots", lot.id); state.rev += 1;
      log(state, ctx, lot.id, lot.no, "EUDR — usunięcie szkicu partii", { ilosc: lot.qty, gatunek: lot.wood && lot.wood.species }, null, lot.whId);
      return { ok: true };
    }
    if (a.action === "restore") {
      if (lot.status !== "ARCHIVED") return bad("Partia nie jest w archiwum");
      const rec = put(state, "eudrLots", Object.assign({}, lot, { status: lot.statusBeforeArchive || "PENDING", archivedAt: null, updatedAt: ts, updatedBy: user.name }));
      state.rev += 1;
      log(state, ctx, lot.id, lot.no, "EUDR — przywrócenie partii z archiwum", { status: "ARCHIVED" }, { status: rec.status }, lot.whId);
      return { ok: true, lot: rec };
    }
    if (lot.status === "ARCHIVED") return bad("Partia jest już w archiwum");
    if (txt(a.reason).length < 5) return bad("Podaj powód archiwizacji");
    const rec = put(state, "eudrLots", Object.assign({}, lot, { status: "ARCHIVED", statusBeforeArchive: lot.status, archivedAt: ts, archivedBy: user.name, archivedReason: txt(a.reason, 500), updatedAt: ts }));
    state.rev += 1;
    log(state, ctx, lot.id, lot.no, "EUDR — archiwizacja partii", { status: lot.status }, { status: "ARCHIVED", powod: rec.archivedReason }, lot.whId);
    return { ok: true, lot: rec };
  }
  /** Zmiana statusu przez kontrolera: przekazanie do weryfikacji, wstrzymanie (niezgodność). „Dopuszczona” — tylko panel należytej staranności. */
  function setLotStatus(state, a, ctx) {
    const user = userOf(ctx);
    const lot = lotOf(state, a.id);
    if (!lot) return bad("Nie znaleziono partii");
    if (!canAccessWh(user, lot.whId)) return deny("Brak dostępu do magazynu partii");
    const to = a.status;
    if (to === "VERIFIED") return bad("Status „Dopuszczona” nadaje wyłącznie zatwierdzenie w panelu należytej staranności");
    if (!["PENDING", "NONCONFORM", "DRAFT"].includes(to)) return bad("Nieprawidłowy status");
    if (to === "PENDING" && lot.status === "DRAFT") { if (!allowed(state, user, "lot.edit")) return deny(); }
    else if (!allowed(state, user, "lot.status")) return deny();
    if (lot.status === "ARCHIVED") return bad("Partia jest w archiwum");
    if (to === "NONCONFORM" && txt(a.reason).length < 10) return bad("Opisz niezgodność (co najmniej 10 znaków)");
    const ts = nowOf(ctx);
    const rec = put(state, "eudrLots", Object.assign({}, lot, { status: to, nonconformity: to === "NONCONFORM" ? { reason: txt(a.reason, 1000), by: user.name, at: ts } : lot.nonconformity || null, updatedAt: ts, updatedBy: user.name }));
    state.rev += 1;
    log(state, ctx, lot.id, lot.no, "EUDR — zmiana statusu partii", { status: lot.status }, { status: to, powod: to === "NONCONFORM" ? rec.nonconformity.reason : undefined }, lot.whId);
    return { ok: true, lot: rec };
  }

  /* ------------------------------------------------------------------ */
  /* Dostawcy (rozszerzenie kartoteki kontrahentów)                      */
  /* ------------------------------------------------------------------ */
  function saveSupplier(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "supplier.edit")) return deny();
    const p = byId(state.partners || [], a.partnerId);
    if (!p) return bad("Wybierz kontrahenta z kartoteki (dostawców nie dubluje się w module EUDR)");
    const old = supplierOf(state, p.id), errs = {};
    const rec = Object.assign({ id: old ? old.id : uid("es"), partnerId: p.id, status: "UNVERIFIED" }, old || {});
    for (const k of ["country", "address", "nip", "contact", "email", "phone", "contract", "operatorRef", "eori", "notes"]) if (a[k] !== undefined) rec[k] = str(a[k], 400);
    if (rec.country) rec.country = rec.country.toUpperCase().slice(0, 2);
    if (a.role !== undefined) { if (!SUPPLIER_ROLES[a.role]) errs.role = "Wybierz rolę dostawcy"; else rec.role = a.role; }
    if (a.validTo !== undefined) { if (a.validTo && !isDate(a.validTo)) errs.validTo = "Podaj datę"; else rec.validTo = a.validTo || ""; }
    if (rec.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) errs.email = "Nieprawidłowy adres e-mail";
    if (rec.nip && !/^[A-Z]{0,2}[0-9 -]{6,16}$/i.test(rec.nip)) errs.nip = "Nieprawidłowy NIP / numer podatkowy";
    if (a.status !== undefined && a.status !== rec.status) {
      if (!SUPPLIER_STATUS[a.status]) errs.status = "Wybierz status";
      else if (a.status === "VERIFIED" && txt(a.verifyNote).length < 10) errs.verifyNote = "Opisz zakres weryfikacji (co najmniej 10 znaków)";
      else { rec.status = a.status; rec.verification = { by: user.name, at: nowOf(ctx), note: txt(a.verifyNote, 1000) }; }
    }
    if (Object.keys(errs).length) return bad("Popraw zaznaczone pola", { errors: errs });
    rec.updatedAt = nowOf(ctx); rec.updatedBy = user.name;
    put(state, "eudrSuppliers", rec); state.rev += 1;
    log(state, ctx, rec.id, p.name, old ? "EUDR — edycja danych dostawcy" : "EUDR — dane dostawcy", old ? { status: old.status, rola: old.role } : null, { status: rec.status, rola: rec.role, weryfikacja: rec.verification ? rec.verification.note : undefined });
    return { ok: true, supplier: rec };
  }

  /* ------------------------------------------------------------------ */
  /* Dokumentacja                                                        */
  /* ------------------------------------------------------------------ */
  /** Wykrycie rodzaju pliku z zawartości (pierwsze bajty) — nie z rozszerzenia nazwy. */
  function sniff(bytes, name) {
    const b = bytes || [];
    const at = (i, arr) => arr.every((v, k) => b[i + k] === v);
    if (at(0, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
    if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (at(0, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
    if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
    if (at(0, [0x49, 0x49, 0x2a, 0x00]) || at(0, [0x4d, 0x4d, 0x00, 0x2a])) return "image/tiff";
    // pliki tekstowe: bez bajtów sterujących; rodzaj z rozszerzenia (GeoJSON, JSON, XML, CSV, TXT)
    const head = Array.from(b.slice ? b.slice(0, 4096) : []);
    if (!head.length || head.some(c => c < 9 || (c > 13 && c < 32 && c !== 27))) return null;
    // treść aktywna (HTML, skrypty, SVG) nie jest przyjmowana także jako plik tekstowy
    const text = head.map(c => String.fromCharCode(c)).join("");
    if (/<\s*(script|html|svg|iframe|object|embed)\b|<\?xml-stylesheet|xmlns\s*=\s*["']http:\/\/www\.w3\.org\/1999\/xhtml/i.test(text)) return null;
    const ext = String(name || "").toLowerCase().split(".").pop();
    if (ext === "geojson") return "application/geo+json";
    if (ext === "json") return "application/json";
    if (ext === "xml" || ext === "gml" || ext === "kml") return "application/xml";
    if (ext === "csv") return "text/csv";
    return "text/plain";
  }
  function docFields(state, a, old) {
    const errs = {}, rec = Object.assign({}, old || {});
    if (a.type !== undefined) { if (!DOC_TYPES[a.type]) errs.type = "Wybierz rodzaj dokumentu"; else rec.type = a.type; }
    for (const k of ["title", "number", "issuer", "notes"]) if (a[k] !== undefined) rec[k] = str(a[k], 300);
    for (const k of ["issued", "validTo"]) if (a[k] !== undefined) { if (a[k] && !isDate(a[k])) errs[k] = "Podaj datę"; else rec[k] = a[k] || ""; }
    if (a.lotIds !== undefined) {
      const ids = [...new Set(Array.isArray(a.lotIds) ? a.lotIds : [a.lotIds])].filter(Boolean);
      if (ids.some(id => !lotOf(state, id))) errs.lotIds = "Nie znaleziono partii"; else rec.lotIds = ids;
    }
    if (!rec.lotIds) rec.lotIds = [];
    if (a.partnerId !== undefined) { if (a.partnerId && !byId(state.partners || [], a.partnerId)) errs.partnerId = "Wybierz kontrahenta"; else rec.partnerId = a.partnerId || ""; }
    if (!rec.type) errs.type = errs.type || "Wybierz rodzaj dokumentu";
    if (!rec.lotIds.length && !rec.partnerId) errs.lotIds = "Powiąż dokument z partią albo dostawcą";
    return { rec, errs };
  }
  const docAccess = (state, user, d) => !(d.lotIds || []).length || d.lotIds.some(id => { const l = lotOf(state, id); return !l || canAccessWh(user, l.whId); });
  /**
   * Zapis dokumentu (metadane; plik dołącza serwer po zapisaniu na dysku albo przeglądarka w trybie bez serwera).
   * file: { key, name, type, size, sha } — zastąpienie pliku dodaje nową wersję (poprzednie zostają w historii).
   */
  function saveDoc(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "doc.add")) return deny();
    const old = a.id ? byId(col(state, "eudrDocs"), a.id) : null;
    if (a.id && !old) return bad("Nie znaleziono dokumentu");
    if (old && !docAccess(state, user, old)) return deny("Brak dostępu do magazynu partii dokumentu");
    if (old && old.status === "ARCHIVED") return bad("Dokument jest w archiwum");
    const { rec, errs } = docFields(state, a, old);
    if (rec.lotIds.some(id => !canAccessWh(user, lotOf(state, id).whId))) errs.lotIds = "Brak dostępu do magazynu partii";
    let file = null;
    if (a.file) {
      const f = a.file;
      if (!FILE_TYPES[f.type]) errs.file = "Dozwolone pliki: PDF, JPG, PNG, WEBP, TIFF, GeoJSON, JSON, XML, CSV, TXT";
      else if (!(f.size > 0) || f.size > FILE_MAX) errs.file = P("Plik jest pusty albo za duży (najwięcej {n} MB)", { n: FILE_MAX / 1048576 });
      else if (!/^[A-Za-z0-9 ._\/-]{3,240}$/.test(String(f.key || ""))) errs.file = "Nieprawidłowe położenie pliku";
      else file = { key: String(f.key), name: str(f.name, 160) || "dokument", type: f.type, size: f.size, sha: str(f.sha, 64), local: !!f.local, at: nowOf(ctx), by: user.name };
    }
    if (!old && !file && !a.noFile) errs.file = errs.file || "Dołącz plik dokumentu";
    if (Object.keys(errs).length) return bad("Popraw zaznaczone pola", { errors: errs });
    const ts = nowOf(ctx);
    if (!old) { rec.id = a.newId && /^ed_[a-z0-9]{6,40}$/.test(a.newId) ? a.newId : uid("ed"); rec.no = nextNo(state, "DOK", "eudrDocs", todayOf(ctx)); rec.status = "NEW"; rec.versions = []; rec.createdAt = ts; rec.createdBy = user.name; rec.env = envOf(state); }
    if (file) { rec.versions = (rec.versions || []).concat(Object.assign({ v: (rec.versions || []).length + 1 }, file)); if (old) { rec.status = "NEW"; rec.verifiedBy = ""; } }
    rec.updatedAt = ts; rec.updatedBy = user.name;
    put(state, "eudrDocs", rec); state.rev += 1;
    const lotNos = rec.lotIds.map(id => lotOf(state, id).no).join(", ");
    log(state, ctx, rec.id, rec.no, !old ? "EUDR — dodanie dokumentu" : file ? "EUDR — zastąpienie pliku dokumentu (nowa wersja)" : "EUDR — edycja opisu dokumentu",
      old ? { wersja: (old.versions || []).length, rodzaj: DOC_TYPES[old.type] } : null, { rodzaj: DOC_TYPES[rec.type], wersja: rec.versions.length, plik: file ? file.name : undefined, partie: lotNos || undefined, dostawca: partnerName(state, rec.partnerId) || undefined },
      rec.lotIds.length ? lotOf(state, rec.lotIds[0]).whId : null);
    return { ok: true, doc: rec };
  }
  function verifyDoc(state, a, ctx) {
    const user = userOf(ctx);
    const d = byId(col(state, "eudrDocs"), a.id);
    if (!d) return bad("Nie znaleziono dokumentu");
    if (a.status === "ARCHIVED") { if (!allowed(state, user, "lot.archive")) return deny(); }
    else if (!allowed(state, user, "doc.verify")) return deny();
    if (!docAccess(state, user, d)) return deny("Brak dostępu do magazynu partii dokumentu");
    if (!["VERIFIED", "REJECTED", "ARCHIVED", "NEW"].includes(a.status)) return bad("Nieprawidłowy status");
    if (a.status === "REJECTED" && txt(a.note).length < 5) return bad("Podaj powód odrzucenia");
    const ts = nowOf(ctx);
    const rec = put(state, "eudrDocs", Object.assign({}, d, { status: a.status, check: { by: user.name, at: ts, note: txt(a.note, 1000) }, verifiedBy: a.status === "VERIFIED" ? user.name : d.verifiedBy, updatedAt: ts }));
    state.rev += 1;
    log(state, ctx, d.id, d.no, a.status === "VERIFIED" ? "EUDR — weryfikacja dokumentu" : a.status === "ARCHIVED" ? "EUDR — archiwizacja dokumentu" : "EUDR — zmiana statusu dokumentu", { status: d.status }, { status: a.status, uwagi: txt(a.note, 1000) || undefined });
    return { ok: true, doc: rec };
  }

  /* ------------------------------------------------------------------ */
  /* Należyta staranność (3 etapy, decyzje człowieka)                    */
  /* ------------------------------------------------------------------ */
  const DD1_ITEMS = {
    description: "Opis produktu, nazwa handlowa, kod CN, gatunek (nazwa zwyczajowa i łacińska)",
    quantity: "Ilość (masa netto / objętość / liczba sztuk)",
    country: "Kraj produkcji (pozyskania)",
    geo: "Geolokalizacja wszystkich działek (punkt / wielokąt)",
    period: "Data lub okres pozyskania",
    supplier: "Nazwa, adres i e-mail dostawcy",
    buyer: "Nazwa, adres i e-mail odbiorcy (gdy wydano)",
    deforestation: "Informacje potwierdzające, że produkt jest wolny od wylesiania (po 31.12.2020)",
    legality: "Informacje potwierdzające legalność pozyskania (prawo kraju produkcji)"
  };
  const DD2_CRITERIA = {
    countryRisk: "Klasyfikacja ryzyka kraju / części kraju (art. 29)",
    forestPresence: "Obecność lasów, ludności rdzennej na obszarze pozyskania",
    complexity: "Złożoność łańcucha dostaw, ryzyko obchodzenia przepisów i mieszania z produktami nieznanego pochodzenia",
    corruption: "Ryzyko korupcji, fałszowania dokumentów, braku egzekwowania prawa",
    concerns: "Uzasadnione wątpliwości, zgłoszenia, informacje o naruszeniach dotyczących dostawcy",
    supplierHistory: "Historia nieprawidłowości dostawcy, certyfikaty i weryfikacje stron trzecich (informacyjnie)"
  };
  /** Automatyczna podpowiedź do etapu 1 — tylko informacja dla osoby weryfikującej. */
  function ddHints(state, lot, ctx) {
    const w = lot.wood || {}, o = lot.origin || {}, sup = byId(state.partners || [], lot.partnerId), es = supplierOf(state, lot.partnerId);
    const docs = docsOfLot(state, lot.id).concat(docsOfPartner(state, lot.partnerId)).filter(d => d.status !== "REJECTED");
    const has = t => docs.some(d => d.type === t);
    const g = lotGeo(lot);
    return {
      description: !!(w.cn && w.species && w.speciesLatin), quantity: Number(lot.qty) > 0, country: !!o.country, geo: !!g && checkGeo(g).ok,
      period: !!w.harvestFrom, supplier: !!(sup && (es && es.address || sup.address) && (es && es.email || sup.email)),
      buyer: !(lot.links || []).some(l => l.kind === "WZ" && !l.void) || (lot.links || []).filter(l => l.kind === "WZ" && !l.void).every(l => !!l.partnerId),
      deforestation: (!!w.harvestFrom && w.harvestFrom > rules(state).cutOff) || has("legality") || has("harvest_right"),
      legality: has("legality") || has("harvest_right")
    };
  }
  function ddStage(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "dd.stage")) return deny();
    const lot = lotOf(state, a.id);
    if (!lot) return bad("Nie znaleziono partii");
    if (!canAccessWh(user, lot.whId)) return deny("Brak dostępu do magazynu partii");
    if (lot.status === "ARCHIVED") return bad("Partia jest w archiwum");
    const ts = nowOf(ctx), dd = Object.assign({}, lot.dd || {}), stage = Number(a.stage);
    if (stage === 1) {
      const items = {};
      for (const k of Object.keys(DD1_ITEMS)) { const it = (a.items || {})[k] || {}; items[k] = { ok: !!it.ok, na: !!it.na, note: txt(it.note, 600) }; }
      const done = !!a.done;
      if (done) {
        if (!a.confirm) return bad("Potwierdź, że informacje zostały sprawdzone przez Ciebie (nie tylko automatycznie)");
        const open = Object.keys(DD1_ITEMS).filter(k => !items[k].ok && !items[k].na);
        if (open.length) return bad(P("Nie potwierdzono pozycji: {k}", { k: open.map(k => DD1_ITEMS[k]).join("; ") }));
        if (Object.keys(items).some(k => items[k].na && items[k].note.length < 5)) return bad("Dla pozycji „nie dotyczy” podaj uzasadnienie");
      }
      dd.s1 = { items, done, hints: ddHints(state, lot, ctx), by: user.name, userId: user.id, at: ts, notes: txt(a.notes, 2000) };
      if (!done) { dd.s2 = dd.s2 && dd.s2.done ? Object.assign({}, dd.s2, { done: false, reopened: ts }) : dd.s2; }
    } else if (stage === 2) {
      if (!(dd.s1 && dd.s1.done)) return bad("Najpierw zakończ etap 1 — zbieranie informacji");
      const crit = {};
      for (const k of Object.keys(DD2_CRITERIA)) { const c = (a.criteria || {})[k] || {}; crit[k] = { level: ["low", "medium", "high"].includes(c.level) ? c.level : "", note: txt(c.note, 600) }; }
      const done = !!a.done;
      if (done) {
        const open = Object.keys(DD2_CRITERIA).filter(k => !crit[k].level);
        if (open.length) return bad(P("Oceń kryteria: {k}", { k: open.map(k => DD2_CRITERIA[k]).join("; ") }));
        if (!["NEGLIGIBLE", "NOT_NEGLIGIBLE"].includes(a.result)) return bad("Wybierz wynik oceny ryzyka");
        if (a.result === "NEGLIGIBLE" && Object.values(crit).some(c => c.level === "high")) return bad("Kryterium o wysokim ryzyku — ryzyko nie może być uznane za znikome bez środków ograniczających");
        if (txt(a.justification).length < 20) return bad("Uzasadnij wynik oceny ryzyka (co najmniej 20 znaków)");
      }
      dd.s2 = { criteria: crit, result: a.result || "", justification: txt(a.justification, 3000), done, by: user.name, userId: user.id, at: ts, country: (lot.origin && lot.origin.riskCountry) || "" };
    } else if (stage === 3) {
      if (!(dd.s2 && dd.s2.done)) return bad("Najpierw zakończ etap 2 — ocena ryzyka");
      if (dd.s2.result === "NOT_NEGLIGIBLE" && txt(a.measures).length < 20) return bad("Opisz środki ograniczające ryzyko (co najmniej 20 znaków)");
      dd.s3 = { measures: txt(a.measures, 4000), docIds: (a.docIds || []).filter(id => byId(col(state, "eudrDocs"), id)), residual: ["NEGLIGIBLE", "NOT_NEGLIGIBLE"].includes(a.residual) ? a.residual : "", by: user.name, userId: user.id, at: ts };
    } else return bad("Nieprawidłowy etap");
    const rec = put(state, "eudrLots", Object.assign({}, lot, { dd, status: lot.status === "DRAFT" ? "PENDING" : lot.status === "VERIFIED" ? "PENDING" : lot.status, updatedAt: ts, updatedBy: user.name }));
    state.rev += 1;
    log(state, ctx, lot.id, lot.no, P("EUDR — należyta staranność, etap {s}{d}", { s: stage, d: (dd["s" + stage] || {}).done ? " (zakończony)" : "" }), null,
      stage === 2 ? { wynik: dd.s2.result, zakonczony: dd.s2.done } : stage === 3 ? { srodki: dd.s3.measures.slice(0, 200) } : { zakonczony: dd.s1.done }, lot.whId);
    return { ok: true, lot: rec };
  }
  /** Zatwierdzenie wyniku końcowego przez osobę uprawnioną — jedyna droga do statusu „Dopuszczona”. */
  function ddApprove(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "dd.approve")) return deny("Wynik końcowy zatwierdza Osoba odpowiedzialna albo Administrator EUDR");
    const lot = lotOf(state, a.id);
    if (!lot) return bad("Nie znaleziono partii");
    if (!canAccessWh(user, lot.whId)) return deny("Brak dostępu do magazynu partii");
    if (lot.status === "ARCHIVED") return bad("Partia jest w archiwum");
    const dd = lot.dd || {}, ob = obligations(state, lot, ctx);
    if (!["ACCEPTED", "REJECTED"].includes(a.result)) return bad("Wybierz wynik: dopuszczona albo niezgodna");
    if (!a.confirm) return bad("Potwierdź osobiste sprawdzenie dokumentacji — automatyczna kontrola formularza nie wystarcza");
    if (txt(a.justification).length < 20) return bad("Uzasadnij decyzję (co najmniej 20 znaków)");
    if (a.result === "ACCEPTED") {
      if (!(dd.s1 && dd.s1.done)) return bad("Brak zakończonego etapu 1 — zbieranie informacji");
      if (ob.ddRequired && !(dd.s2 && dd.s2.done)) return bad("Brak zakończonego etapu 2 — ocena ryzyka");
      if (ob.ddRequired && dd.s2.result === "NOT_NEGLIGIBLE" && !(dd.s3 && dd.s3.measures && dd.s3.residual === "NEGLIGIBLE")) return bad("Ryzyko nie-znikome: wymagane środki ograniczające i ocena ryzyka rezydualnego jako znikomego");
      const e = evaluate(state, Object.assign({}, lot, { status: "PENDING" }), ctx);
      if (e.missing.length) return bad("Partia ma braki — uzupełnij przed dopuszczeniem", { missing: e.missing });
    }
    const ts = nowOf(ctx);
    const approval = { result: a.result, justification: txt(a.justification, 3000), by: user.name, userId: user.id, role: ROLES[roleOf(state, user)], at: ts, manual: true, fourEyes: !!(dd.s1 && dd.s1.userId && dd.s1.userId !== user.id) };
    const rec = put(state, "eudrLots", Object.assign({}, lot, { dd: Object.assign({}, dd, { approval }), status: a.result === "ACCEPTED" ? "VERIFIED" : "NONCONFORM",
      nonconformity: a.result === "REJECTED" ? { reason: approval.justification, by: user.name, at: ts } : null, updatedAt: ts, updatedBy: user.name }));
    state.rev += 1;
    log(state, ctx, lot.id, lot.no, "EUDR — zatwierdzenie kontroli (wynik należytej staranności)", { status: lot.status }, { wynik: a.result === "ACCEPTED" ? "dopuszczona" : "niezgodna", zatwierdzil: user.name, uzasadnienie: approval.justification.slice(0, 300) }, lot.whId);
    return { ok: true, lot: rec };
  }

  /* ------------------------------------------------------------------ */
  /* Rejestr DDS (rozdzielone ACCEPTANCE / PRODUCTION)                   */
  /* ------------------------------------------------------------------ */
  const REF_RE = /^[A-Z0-9]{8,14}$/, VER_RE = /^[A-Z0-9]{5,35}$/;
  function saveDds(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "dds.edit")) return deny();
    const old = a.id ? byId(col(state, "eudrDds"), a.id) : null;
    if (a.id && !old) return bad("Nie znaleziono wpisu DDS");
    const env = old ? old.env : envOf(state);
    const errs = {}, rec = Object.assign({}, old || {});
    if (!old) {
      rec.kind = DDS_KINDS[a.kind] ? a.kind : "";
      if (!rec.kind) errs.kind = "Wybierz rodzaj wpisu";
      if (rec.kind === "SIMULATED" && env === "PRODUCTION") errs.kind = "Symulacji nie zapisuje się w ewidencji produkcyjnej";
    }
    for (const k of ["internalRef", "responsible", "notes", "uuid", "statusInfo"]) if (a[k] !== undefined) rec[k] = str(a[k], 600);
    if (a.referenceNumber !== undefined) rec.referenceNumber = str(a.referenceNumber, 40).toUpperCase().replace(/\s/g, "");
    if (a.verificationNumber !== undefined) rec.verificationNumber = str(a.verificationNumber, 40).toUpperCase().replace(/\s/g, "");
    if (rec.kind === "SIMULATED") {
      if (rec.referenceNumber && !/^SYM-/.test(rec.referenceNumber)) rec.referenceNumber = "SYM-" + rec.referenceNumber;
    } else {
      if (rec.referenceNumber && !REF_RE.test(rec.referenceNumber)) errs.referenceNumber = "Numer referencyjny: 8–14 znaków (litery A–Z, cyfry)";
      if (rec.verificationNumber && !VER_RE.test(rec.verificationNumber)) errs.verificationNumber = "Numer weryfikacyjny: 5–35 znaków (litery A–Z, cyfry)";
      if (rec.referenceNumber && /^SYM-/.test(rec.referenceNumber)) errs.referenceNumber = "Numer symulowany nie może być zapisany jako rzeczywisty";
    }
    if (env === "PRODUCTION" && rec.referenceNumber && col(state, "eudrDds").some(d => d.id !== rec.id && d.env !== "PRODUCTION" && d.referenceNumber === rec.referenceNumber))
      errs.referenceNumber = "Ten numer występuje w ewidencji testowej (ACCEPTANCE) — numerów testowych nie przenosi się do produkcji";
    if (rec.referenceNumber && col(state, "eudrDds").some(d => d.id !== rec.id && d.env === env && d.referenceNumber === rec.referenceNumber && d.kind === rec.kind))
      errs.referenceNumber = "Taki numer referencyjny jest już w rejestrze";
    if (a.date !== undefined) { if (a.date && !isDate(a.date)) errs.date = "Podaj datę"; else rec.date = a.date || ""; }
    if (a.status !== undefined) { if (!DDS_STATUS[a.status]) errs.status = "Wybierz status"; else rec.status = a.status; }
    if (!rec.status) rec.status = "DRAFT";
    if (a.partnerId !== undefined) { if (a.partnerId && !byId(state.partners || [], a.partnerId)) errs.partnerId = "Wybierz kontrahenta"; else rec.partnerId = a.partnerId || ""; }
    if (a.lotIds !== undefined) {
      const ids = [...new Set(a.lotIds || [])];
      if (ids.some(id => !lotOf(state, id))) errs.lotIds = "Nie znaleziono partii";
      else if (ids.some(id => !canAccessWh(user, lotOf(state, id).whId))) errs.lotIds = "Brak dostępu do magazynu partii";
      else rec.lotIds = ids;
    }
    if (a.opIds !== undefined) {
      const ids = [...new Set(a.opIds || [])];
      if (ids.some(id => !byId(state.operations || [], id))) errs.opIds = "Nie znaleziono dokumentu"; else rec.opIds = ids;
    }
    rec.lotIds = rec.lotIds || []; rec.opIds = rec.opIds || [];
    if (rec.kind !== "SIMULATED" && DDS_ACTIVE.includes(rec.status) && rec.kind !== "OWN" && !rec.referenceNumber) errs.referenceNumber = "Podaj numer referencyjny";
    if (Object.keys(errs).length) return bad("Popraw zaznaczone pola", { errors: errs });
    const ts = nowOf(ctx);
    if (!old) { rec.id = uid("dd"); rec.env = env; rec.no = nextNo(state, env === "PRODUCTION" ? "DDS" : "DDS-TEST", "eudrDds", todayOf(ctx)); rec.steps = {}; rec.history = []; rec.createdAt = ts; rec.createdBy = user.name; }
    if (a.step !== undefined) {
      const s = Number(a.step);
      if (!(s >= 1 && s <= DDS_STEPS.length)) return bad("Nieprawidłowy krok");
      const prev = s === 1 || (rec.steps || {})[s - 1];
      if (!prev) return bad("Wykonaj kroki po kolei");
      rec.steps = Object.assign({}, rec.steps, { [s]: { by: user.name, at: ts } });
    }
    const change = old ? Object.keys(rec).filter(k => !["history", "updatedAt", "updatedBy", "steps"].includes(k) && JSON.stringify(rec[k]) !== JSON.stringify(old[k])) : ["nowy"];
    rec.history = (rec.history || []).concat({ at: ts, by: user.name, change: change.join(", "), status: rec.status, step: a.step || undefined });
    rec.updatedAt = ts; rec.updatedBy = user.name;
    put(state, "eudrDds", rec); state.rev += 1;
    log(state, ctx, rec.id, rec.no, !old ? P("EUDR — nowy wpis DDS ({e})", { e: env }) : a.step ? P("EUDR — DDS: krok {s} procesu", { s: a.step }) : P("EUDR — zmiana wpisu DDS ({e})", { e: env }),
      old ? { status: old.status, numer: old.referenceNumber || undefined } : null, { rodzaj: DDS_KINDS[rec.kind], status: rec.status, numer: rec.referenceNumber || undefined, partie: rec.lotIds.map(id => lotOf(state, id).no).join(", ") || undefined, srodowisko: env });
    return { ok: true, dds: rec };
  }

  /* ------------------------------------------------------------------ */
  /* Zestaw danych do systemu EUDR (eksport / komunikat SubmitDds)        */
  /* ------------------------------------------------------------------ */
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const b64 = s => typeof Buffer !== "undefined" ? Buffer.from(s, "utf8").toString("base64") : btoa(unescape(encodeURIComponent(s)));
  /** Zestaw danych dla oświadczenia: z partii (bez danych dostępowych). */
  function dataset(state, lotIds, opt) {
    const o = opt || {}, p = profile(state), list = (lotIds || []).map(id => lotOf(state, id)).filter(Boolean);
    const errors = [], warnings = [];
    if (!list.length) errors.push("Wybierz partie");
    const commodities = list.map((l, i) => {
      const w = l.wood || {}, org = origins(state, l), pr = byId(state.products, l.productId);
      if (!w.cn) errors.push(P("{no}: brak kodu CN", { no: l.no }));
      if (!w.speciesLatin || !w.species) errors.push(P("{no}: brak gatunku (nazwa łacińska i zwyczajowa)", { no: l.no }));
      const kg = Number(l.t) > 0 ? rq(Number(l.t) * 1000) : null;
      const m3 = Number(l.m3) > 0 ? rq(Number(l.m3)) : null;
      if (!kg) warnings.push(P("{no}: brak masy netto (t) — uzupełnij przed złożeniem", { no: l.no }));
      const producers = org.map((x, k) => {
        const lot = lotOf(state, x.lotId), g = lot ? lotGeo(lot) : null;
        if (!g) errors.push(P("{no}: brak geolokalizacji", { no: x.no }));
        else { const c = checkGeo(g); if (!c.ok) errors.push(P("{no}: {e}", { no: x.no, e: c.errors[0] })); }
        return { position: k + 1, country: (x.origin.country || "").toUpperCase(), name: x.origin.owner || partnerName(state, x.partnerId) || "", geojson: g };
      });
      return { position: i + 1, lotNo: l.no, description: str(`${pr ? pr.name : w.kind || ""} — ${w.species || ""} — ${l.no}`, 150), hsHeading: String(w.cn || "").replace(/\D/g, "").slice(0, 6),
        netWeightKg: kg, volumeM3: m3, scientificName: w.speciesLatin || "", commonName: w.species || "", producers };
    });
    const ds = {
      generatedAt: o.now || new Date().toISOString(), environment: envOf(state), operatorRole: o.operatorRole || "OPERATOR", activityType: o.activityType || "DOMESTIC",
      countryOfActivity: o.countryOfActivity || p.country || "PL", internalReferenceNumber: str(o.internalRef || list.map(l => l.no).join("+"), 50), geoLocationConfidential: !!o.confidential,
      operator: { name: p.company, country: p.country, reference: p.operatorRef, eori: p.eori }, commodities, errors, warnings,
      notice: "Zestaw danych przygotowany w ResInvest ERP. Nie zawiera danych dostępowych. Oświadczenie składa się w oficjalnym systemie EUDR."
    };
    return ds;
  }
  /** Treść komunikatu SubmitDdsRequest (V4) — bez nagłówka WS-Security (dodaje go wyłącznie serwer). */
  function submitXml(ds) {
    const C = ds.commodities.map(c => [
      "<dds:commodities>", `<dds:position>${c.position}</dds:position>`, "<dds:descriptors>",
      `<eudrCommon:descriptionOfGoods>${esc(c.description)}</eudrCommon:descriptionOfGoods>`, "<eudrCommon:goodsMeasure>",
      c.netWeightKg ? `<eudrCommon:netWeight>${c.netWeightKg}</eudrCommon:netWeight>` : "",
      c.volumeM3 ? `<eudrCommon:supplementaryUnit>${c.volumeM3}</eudrCommon:supplementaryUnit><eudrCommon:supplementaryUnitQualifier>MTQ</eudrCommon:supplementaryUnitQualifier>` : "",
      "</eudrCommon:goodsMeasure>", "</dds:descriptors>", `<dds:hsHeading>${esc(c.hsHeading)}</dds:hsHeading>`,
      `<dds:speciesInfo><dds:scientificName>${esc(c.scientificName)}</dds:scientificName><dds:commonName>${esc(c.commonName)}</dds:commonName></dds:speciesInfo>`,
      ...c.producers.map(p => `<dds:producers><dds:position>${p.position}</dds:position><dds:country>${esc(p.country)}</dds:country><dds:name>${esc(p.name)}</dds:name>${p.geojson ? `<dds:geometryGeojson>${b64(JSON.stringify(p.geojson))}</dds:geometryGeojson>` : ""}</dds:producers>`),
      "</dds:commodities>"].filter(Boolean).join(""));
    return ["<dds:SubmitDdsRequest>", `<dds:operatorRole>${esc(ds.operatorRole)}</dds:operatorRole>`, "<dds:statement>",
      `<dds:internalReferenceNumber>${esc(ds.internalReferenceNumber)}</dds:internalReferenceNumber>`, `<dds:activityType>${esc(ds.activityType)}</dds:activityType>`,
      `<dds:countryOfActivity>${esc(ds.countryOfActivity)}</dds:countryOfActivity>`, ...C, `<dds:geoLocationConfidential>${ds.geoLocationConfidential ? "true" : "false"}</dds:geoLocationConfidential>`,
      "</dds:statement>", "</dds:SubmitDdsRequest>"].join("");
  }
  /** GeoJSON wszystkich działek zestawu (jeden plik do wczytania w systemie EUDR). */
  function datasetGeo(ds) {
    const features = [];
    for (const c of ds.commodities) for (const p of c.producers) if (p.geojson) for (const f of (p.geojson.features || [])) features.push(Object.assign({}, f, { properties: Object.assign({ ProducerName: p.name, ProducerCountry: p.country }, f.properties || {}) }));
    return { type: "FeatureCollection", features };
  }

  /* ------------------------------------------------------------------ */
  /* Konfiguracja, tryb, role                                            */
  /* ------------------------------------------------------------------ */
  function setConfig(state, patch) { state.config = Object.assign({}, state.config, { eudr: Object.assign({}, cfgOf(state), patch) }); }
  function saveConfig(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "config")) return deny();
    const errs = {}, before = cfgOf(state), patch = {};
    if (a.profile) {
      const p = Object.assign({}, before.profile || {});
      for (const k of ["company", "country", "operatorRef", "eori", "responsible"]) if (a.profile[k] !== undefined) p[k] = str(a.profile[k], 200);
      if (a.profile.size !== undefined) { if (!["large", "medium", "small", "micro"].includes(a.profile.size)) errs.size = "Wybierz wielkość przedsiębiorstwa"; else p.size = a.profile.size; }
      if (a.profile.eutrBefore !== undefined) p.eutrBefore = !!a.profile.eutrBefore;
      if (p.country) p.country = p.country.toUpperCase().slice(0, 2);
      patch.profile = p;
    }
    if (a.releaseMode !== undefined) { if (!["block", "warn"].includes(a.releaseMode)) errs.releaseMode = "Wybierz tryb"; else patch.releaseMode = a.releaseMode; }
    if (a.products !== undefined) {
      const pr = {};
      for (const [id, cn] of Object.entries(a.products || {})) { if (!byId(state.products, id)) continue; const c = String(cn || "").replace(/[^\d]/g, "").slice(0, 10); pr[id] = c; }
      patch.products = pr;
    }
    if (a.rules !== undefined) {
      let r = a.rules;
      if (typeof r === "string") { if (!r.trim()) r = null; else try { r = JSON.parse(r); } catch (e) { errs.rules = "Reguły: nieprawidłowy JSON"; } }
      if (r && typeof r === "object") {
        const allowedKeys = ["version", "source", "dates", "cutOff", "retentionYears", "cn", "geoAreaHa", "docs", "releaseMode"];
        const extra = Object.keys(r).filter(k => !allowedKeys.includes(k));
        if (extra.length) errs.rules = P("Nieznane klucze reguł: {k}", { k: extra.join(", ") });
        else if (r.dates && Object.values(r.dates).some(d => !isDate(d))) errs.rules = "Daty reguł w formacie RRRR-MM-DD";
        else if (r.cn && (!Array.isArray(r.cn) || r.cn.some(c => !/^\d{2,8}$/.test(String(c))))) errs.rules = "Kody CN: lista cyfr";
        else if (r.docs && Object.values(r.docs).some(v => !Array.isArray(v) || v.some(d => !DOC_TYPES[d]))) errs.rules = "Dokumenty wymagane: lista znanych rodzajów";
        else if (!str(r.version)) errs.rules = "Podaj wersję reguł (version)";
        else patch.rules = r;
      } else if (r === null && !errs.rules) patch.rules = null;
    }
    if (a.nextAuditMonths !== undefined) { const n = numOpt(a.nextAuditMonths, 1, 36); if (!n.ok || n.value == null) errs.nextAuditMonths = "Od 1 do 36 miesięcy"; else patch.nextAuditMonths = Math.round(n.value); }
    if (Object.keys(errs).length) return bad("Popraw zaznaczone pola", { errors: errs });
    setConfig(state, patch); state.rev += 1;
    log(state, ctx, "eudr-config", "Konfiguracja EUDR", { profil: before.profile || null, reguly: before.rules ? before.rules.version : RULES.version, tryb_wydania: before.releaseMode || RULES.releaseMode },
      { profil: patch.profile || undefined, reguly: patch.rules ? patch.rules.version : patch.rules === null ? RULES.version : undefined, tryb_wydania: patch.releaseMode, produkty: patch.products ? Object.keys(patch.products).length : undefined });
    return { ok: true, config: cfgOf(state) };
  }
  /** Przełączenie ACCEPTANCE / PRODUCTION — tylko Administrator EUDR, z potwierdzeniem. */
  function setEnv(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "env")) return deny("Tryb zmienia wyłącznie Administrator EUDR");
    if (!ENVS[a.env]) return bad("Wybierz środowisko");
    const cur = envOf(state);
    if (cur === a.env) return bad("To środowisko jest już aktywne");
    if (a.env === "PRODUCTION" && a.confirm !== "PRODUKCJA") return bad("Aby włączyć tryb produkcyjny, wpisz słowo PRODUKCJA");
    if (a.env === "ACCEPTANCE" && a.confirm !== true && a.confirm !== "ACCEPTANCE") return bad("Potwierdź przełączenie");
    setConfig(state, { env: a.env, envChangedAt: nowOf(ctx), envChangedBy: user.name }); state.rev += 1;
    log(state, ctx, "eudr-env", "Tryb EUDR", { srodowisko: cur }, { srodowisko: a.env });
    return { ok: true, env: a.env };
  }
  function setAccess(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "config")) return deny();
    const u = byId(state.users || [], a.userId);
    if (!u) return bad("Nie znaleziono użytkownika");
    if (u.role === "admin") return bad("Administrator programu ma zawsze rolę Administratora EUDR");
    if (a.role && !ROLES[a.role]) return bad("Wybierz rolę EUDR");
    const before = roleOf(state, u), acc = Object.assign({}, cfgOf(state).access || {});
    if (a.role) acc[u.id] = a.role; else delete acc[u.id];
    setConfig(state, { access: acc }); state.rev += 1;
    log(state, ctx, u.id, u.name, "EUDR — zmiana roli użytkownika", { rola: ROLES[before] }, { rola: ROLES[roleOf(state, u)] });
    return { ok: true, role: roleOf(state, u) };
  }

  /* ------------------------------------------------------------------ */
  /* Audyt wewnętrzny                                                    */
  /* ------------------------------------------------------------------ */
  /** Podpowiedzi systemu dla obszarów audytu (dane do oceny — ocenia audytor). */
  function auditHints(state, ctx) {
    const act = lots(state).filter(l => l.status !== "ARCHIVED"), ev = act.map(l => evaluate(state, l, ctx));
    const pct = (n, d) => d ? Math.round(n / d * 100) : null;
    const cov = act.filter((l, i) => ev[i].ob.covered);
    const op = act.filter((l, i) => ev[i].ob.role === "OPERATOR");
    const sups = col(state, "eudrSuppliers");
    const tr = col(state, "eudrTraining");
    const prof = cfgOf(state).profile;
    return {
      role: prof && prof.size ? "Profil firmy uzupełniony" : "Uzupełnij profil firmy (wielkość, rola)",
      lots: P("Partie z dokumentem przyjęcia: {p}%", { p: pct(act.filter(l => l.receipt || (l.parents || []).length).length, act.length) ?? "—" }),
      suppliers: P("Dostawcy zweryfikowani: {v} z {n}", { v: sups.filter(s => s.status === "VERIFIED").length, n: sups.length }),
      docs: P("Partie objęte EUDR bez braków dokumentów: {p}%", { p: pct(cov.filter((l, i) => !ev[act.indexOf(l)].missing.some(m => m.startsWith("Dokument"))).length, cov.length) ?? "—" }),
      geo: P("Partie operatora z poprawną geolokalizacją: {p}%", { p: pct(op.filter(l => { const g = lotGeo(l); return g && checkGeo(g).ok; }).length, op.length) ?? "—" }),
      dd1: P("Partie operatora z zakończonym etapem 1: {p}%", { p: pct(op.filter(l => l.dd && l.dd.s1 && l.dd.s1.done).length, op.length) ?? "—" }),
      dd2: P("Partie operatora z oceną ryzyka: {p}%", { p: pct(op.filter(l => l.dd && l.dd.s2 && l.dd.s2.done).length, op.length) ?? "—" }),
      dd3: P("Partie z ryzykiem nie-znikomym bez środków: {n}", { n: op.filter(l => l.dd && l.dd.s2 && l.dd.s2.result === "NOT_NEGLIGIBLE" && !(l.dd.s3 && l.dd.s3.measures)).length }),
      dds: P("Wpisy DDS produkcyjne: {p}, testowe: {t}", { p: col(state, "eudrDds").filter(d => d.env === "PRODUCTION").length, t: col(state, "eudrDds").filter(d => d.env !== "PRODUCTION").length }),
      chain: P("Wydania przyjęć objętych EUDR bez partii: {n}", { n: unassignedReceipts(state, null).length }),
      retention: P("Dokumenty w module: {n}; okres przechowywania: {y} lat", { n: col(state, "eudrDocs").length, y: rules(state).retentionYears }),
      security: P("Użytkownicy z rolą EUDR inną niż domyślna: {n}", { n: Object.keys(cfgOf(state).access || {}).length }),
      training: P("Szkolenia zaliczone: {z} z {n} przydziałów", { z: tr.filter(x => x.passed).length, n: tr.length })
    };
  }
  function auditScore(areas) {
    const ap = (areas || []).filter(a => a.status && a.status !== "NA" && a.status !== "TODO");
    const pts = ap.reduce((s, a) => s + (a.status === "OK" ? 1 : a.status === "PARTIAL" ? 0.5 : 0), 0);
    return { pct: ap.length ? Math.round(pts / ap.length * 100) : null, ok: ap.filter(a => a.status === "OK").length, partial: ap.filter(a => a.status === "PARTIAL").length, nc: ap.filter(a => a.status === "NC").length, todo: (areas || []).filter(a => !a.status || a.status === "TODO").length };
  }
  function saveAudit(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "audit.run")) return deny();
    const old = a.id ? byId(col(state, "eudrAudits"), a.id) : null;
    if (a.id && !old) return bad("Nie znaleziono audytu");
    if (old && old.status === "CLOSED") return bad("Audyt zakończony — wyników nie zmienia się (przeprowadź kolejny audyt)");
    const errs = {}, rec = Object.assign({}, old || {});
    if (a.date !== undefined) { if (!isDate(a.date)) errs.date = "Podaj datę audytu"; else rec.date = a.date; }
    if (!rec.date) rec.date = todayOf(ctx);
    for (const k of ["auditor", "scope", "summary"]) if (a[k] !== undefined) rec[k] = txt(a[k], 3000);
    if (!rec.auditor) rec.auditor = user.name;
    const areas = AUDIT_AREAS.map(ar => {
      const prev = (rec.areas || []).find(x => x.key === ar.key) || { key: ar.key, status: "TODO" };
      const inp = (a.areas || []).find(x => x.key === ar.key);
      if (!inp) return prev;
      const o = Object.assign({}, prev);
      if (inp.status !== undefined) { if (!AUDIT_STATUS[inp.status]) errs["area_" + ar.key] = "Wybierz status"; else o.status = inp.status; }
      for (const k of ["result", "gaps", "recs", "person"]) if (inp[k] !== undefined) o[k] = txt(inp[k], 3000);
      if (inp.due !== undefined) { if (inp.due && !isDate(inp.due)) errs["due_" + ar.key] = "Podaj termin"; else o.due = inp.due || ""; }
      if (inp.docIds !== undefined) o.docIds = (inp.docIds || []).filter(id => byId(col(state, "eudrDocs"), id));
      return o;
    });
    rec.areas = areas;
    if (a.nextDate !== undefined) { if (a.nextDate && !isDate(a.nextDate)) errs.nextDate = "Podaj datę"; else rec.nextDate = a.nextDate || ""; }
    const sc = auditScore(areas);
    if (a.close) {
      if (sc.todo) errs.areas = P("Oceń wszystkie obszary (pozostało: {n})", { n: sc.todo });
      if (!rec.nextDate) errs.nextDate = "Podaj termin kolejnego audytu";
      for (const ar of areas) if ((ar.status === "NC" || ar.status === "PARTIAL") && (!ar.recs || !ar.due)) errs["area_" + ar.key] = "Dla niezgodności podaj zalecenia i termin";
    }
    if (Object.keys(errs).length) return bad("Popraw zaznaczone pola", { errors: errs });
    const ts = nowOf(ctx);
    if (!old) { rec.id = uid("au"); rec.no = nextNo(state, "AUDYT-EUDR", "eudrAudits", rec.date); rec.status = "OPEN"; rec.createdAt = ts; rec.createdBy = user.name; rec.rulesVersion = rules(state).version; }
    rec.score = sc;
    if (a.close) { rec.status = "CLOSED"; rec.closedAt = ts; rec.closedBy = user.name; rec.hints = auditHints(state, ctx); }
    rec.updatedAt = ts; rec.updatedBy = user.name;
    put(state, "eudrAudits", rec); state.rev += 1;
    log(state, ctx, rec.id, rec.no, a.close ? "EUDR — zakończenie audytu wewnętrznego" : old ? "EUDR — audyt: zapis wyników" : "EUDR — rozpoczęcie audytu wewnętrznego", null,
      { wynik_proc: sc.pct, niezgodnosci: sc.nc, czesciowo: sc.partial, kolejny_audyt: rec.nextDate || undefined });
    return { ok: true, audit: rec };
  }

  /* ------------------------------------------------------------------ */
  /* Szkolenia                                                           */
  /* ------------------------------------------------------------------ */
  const content = () => R.EudrContent || { modules: [], guides: [], scenarios: [] };
  const moduleOf = key => content().modules.find(m => m.key === key);
  function trainAssign(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "train.manage")) return deny();
    const u = byId(state.users || [], a.userId), m = moduleOf(a.moduleKey);
    if (!u) return bad("Wybierz pracownika");
    if (!m) return bad("Wybierz moduł szkolenia");
    if (a.due && !isDate(a.due)) return bad("Podaj termin");
    if (col(state, "eudrTraining").some(x => x.userId === u.id && x.moduleKey === m.key && !x.passed)) return bad("Ten moduł jest już przydzielony pracownikowi");
    const ts = nowOf(ctx);
    const rec = put(state, "eudrTraining", { id: uid("tr"), userId: u.id, userName: u.name, moduleKey: m.key, assignedBy: user.name, assignedAt: ts, due: a.due || "", trainer: str(a.trainer, 160) || user.name, lessons: [], attempts: [], passed: false, progress: 0 });
    state.rev += 1;
    log(state, ctx, rec.id, u.name, "EUDR — przydział szkolenia", null, { modul: m.title, termin: rec.due || undefined, prowadzacy: rec.trainer });
    return { ok: true, training: rec };
  }
  const ownTraining = (state, user, id) => { const r = byId(col(state, "eudrTraining"), id); return r && (r.userId === user.id || allowed(state, user, "train.manage")) ? r : null; };
  function trainLesson(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "train.self")) return deny();
    const r = ownTraining(state, user, a.id), m = r && moduleOf(r.moduleKey);
    if (!r || !m) return bad("Nie znaleziono szkolenia");
    if (r.userId !== user.id) return deny("Postęp oznacza osoba szkolona");
    const idx = Number(a.lesson);
    if (!(idx >= 0 && idx < m.lessons.length)) return bad("Nieprawidłowa lekcja");
    if (r.lessons.includes(idx)) return { ok: true, training: r };
    const lessons = r.lessons.concat(idx).sort((x, y) => x - y);
    const rec = put(state, "eudrTraining", Object.assign({}, r, { lessons, progress: Math.round(lessons.length / (m.lessons.length + 1) * 100), startedAt: r.startedAt || nowOf(ctx) }));
    state.rev += 1;
    log(state, ctx, r.id, user.name, "EUDR — szkolenie: lekcja ukończona", null, { modul: m.title, lekcja: m.lessons[idx].title });
    return { ok: true, training: rec };
  }
  /** Test wiedzy — ocena po stronie silnika (klucz odpowiedzi nie jest przyjmowany z przeglądarki). */
  function trainQuiz(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "train.self")) return deny();
    const r = ownTraining(state, user, a.id), m = r && moduleOf(r.moduleKey);
    if (!r || !m) return bad("Nie znaleziono szkolenia");
    if (r.userId !== user.id) return deny("Test rozwiązuje osoba szkolona");
    if (r.lessons.length < m.lessons.length) return bad("Najpierw ukończ wszystkie lekcje modułu");
    const ans = Array.isArray(a.answers) ? a.answers : [];
    if (ans.length !== m.quiz.length) return bad("Odpowiedz na wszystkie pytania");
    const good = m.quiz.reduce((s, q, i) => s + (Number(ans[i]) === q.a ? 1 : 0), 0);
    const score = Math.round(good / m.quiz.length * 100), passed = score >= (m.pass || 80);
    const ts = nowOf(ctx);
    const rec = put(state, "eudrTraining", Object.assign({}, r, { attempts: r.attempts.concat({ at: ts, score, passed }), passed: r.passed || passed, score: Math.max(r.score || 0, score), completedAt: passed && !r.passed ? ts : r.completedAt || "", progress: passed || r.passed ? 100 : r.progress }));
    state.rev += 1;
    log(state, ctx, r.id, user.name, "EUDR — szkolenie: test wiedzy", null, { modul: m.title, wynik_proc: score, zaliczony: passed });
    return { ok: true, training: rec, score, passed, wrong: m.quiz.map((q, i) => Number(ans[i]) === q.a ? null : i).filter(i => i !== null) };
  }
  /** Wewnętrzne potwierdzenie ukończenia (nie jest certyfikatem Komisji Europejskiej). */
  function trainConfirm(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "train.manage")) return deny();
    const r = byId(col(state, "eudrTraining"), a.id);
    if (!r) return bad("Nie znaleziono szkolenia");
    if (!r.passed) return bad("Potwierdzić można tylko szkolenie z zaliczonym testem");
    if (r.confirmedAt) return bad("Szkolenie jest już potwierdzone");
    const ts = nowOf(ctx);
    const rec = put(state, "eudrTraining", Object.assign({}, r, { confirmedAt: ts, confirmedBy: user.name, certNo: nextNo(state, "SZK-EUDR", "eudrTraining", todayOf(ctx)).replace(/^SZK-EUDR/, "SZK-EUDR") }));
    rec.no = rec.certNo;
    state.rev += 1;
    log(state, ctx, r.id, r.userName, "EUDR — wewnętrzne potwierdzenie ukończenia szkolenia", null, { modul: (moduleOf(r.moduleKey) || {}).title, numer: rec.certNo });
    return { ok: true, training: rec };
  }
  /** Ćwiczenie (scenariusz szkoleniowy): wynik zapisany przy szkoleniu — nie w rejestrze DDS. Numery symulowane z przedrostkiem SYM-. */
  function trainExercise(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "train.self")) return deny();
    const sc = content().scenarios.find(s => s.key === a.scenario);
    if (!sc) return bad("Nie znaleziono scenariusza");
    const r = a.id ? ownTraining(state, user, a.id) : col(state, "eudrTraining").find(x => x.userId === user.id && x.moduleKey === "practice");
    if (!r) return bad("Ćwiczenia wykonuje się w ramach przydzielonego modułu „Praktyczne ćwiczenia”");
    const ans = a.answers || {};
    const checks = sc.checks.map(c => ({ label: c.label, ok: String(ans[c.key] || "").trim().toUpperCase() === String(c.expect).toUpperCase() }));
    const ok = checks.every(c => c.ok), ts = nowOf(ctx);
    const simRef = ok ? "SYM-" + (sc.key.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) + String(Date.parse(ts) % 1e6).padStart(6, "0")) : "";
    const rec = put(state, "eudrTraining", Object.assign({}, r, { exercises: (r.exercises || []).concat({ scenario: sc.key, at: ts, ok, checks, simRef }) }));
    state.rev += 1;
    log(state, ctx, r.id, user.name, "EUDR — ćwiczenie szkoleniowe (dane fikcyjne)", null, { scenariusz: sc.title, wynik: ok ? "poprawnie" : "błędy", numer_symulowany: simRef || undefined });
    return { ok: true, training: rec, checks, passed: ok, simRef, notice: "Numer symulowany — nie jest numerem systemu TRACES i nie trafia do rejestru DDS." };
  }

  /* ------------------------------------------------------------------ */
  /* Centrum testów — testy wykonywane lokalnie (bez sieci)              */
  /* ------------------------------------------------------------------ */
  const TESTS = [
    { key: "config", label: "Konfiguracja profilu firmy i środowiska", net: false },
    { key: "endpoint", label: "Adres usługi z oficjalnej dokumentacji (HTTPS)", net: false, server: true },
    { key: "credentials", label: "Dane dostępowe zapisane po stronie serwera (bez ujawniania wartości)", net: false, server: true },
    { key: "wsse", label: "Nagłówek WS-Security (UsernameToken, PasswordDigest, znacznik czasu)", net: false, server: true },
    { key: "clock", label: "Zgodność zegara serwera (tolerancja 5 minut)", net: true },
    { key: "echo", label: "Połączenie: usługa Echo (tylko ACCEPTANCE)", net: true },
    { key: "geojson", label: "Walidacja geolokalizacji partii (GeoJSON, WGS84, 6 miejsc)", net: false },
    { key: "payload", label: "Kompletność danych DDS (kod CN, gatunek, ilości, producenci)", net: false },
    { key: "separation", label: "Rozdzielenie danych ACCEPTANCE / PRODUCTION", net: false },
    { key: "retrieve", label: "Odczyt statusu DDS po numerze wewnętrznym (getDdsByInternalReference)", net: true }
  ];
  function localTest(state, key, ctx) {
    const act = lots(state).filter(l => l.status !== "ARCHIVED");
    if (key === "config") {
      const p = profile(state), miss = [];
      if (!p.company) miss.push("nazwa firmy"); if (!p.country) miss.push("kraj"); if (!(cfgOf(state).profile || {}).size) miss.push("wielkość przedsiębiorstwa");
      return miss.length ? { status: "FAIL", detail: P("Uzupełnij profil: {m}", { m: miss.join(", ") }) } : { status: "OK", detail: P("Profil: {c}, wielkość {s}, obowiązki od {d}; środowisko {e}", { c: p.company, s: p.size, d: applyDate(state), e: envOf(state) }) };
    }
    if (key === "geojson") {
      const op = act.filter(l => obligations(state, l, ctx).geoRequired);
      const badL = op.filter(l => { const g = lotGeo(l); return !g || !checkGeo(g).ok; });
      if (!op.length) return { status: "SKIP", detail: "Brak partii, za które firma odpowiada jako operator" };
      return badL.length ? { status: "FAIL", detail: P("Partie bez poprawnej geolokalizacji: {l}", { l: badL.slice(0, 8).map(l => l.no).join(", ") }) } : { status: "OK", detail: P("Sprawdzono {n} partii", { n: op.length }) };
    }
    if (key === "payload") {
      const op = act.filter(l => obligations(state, l, ctx).role === "OPERATOR");
      if (!op.length) return { status: "SKIP", detail: "Brak partii do złożenia DDS (rola operatora)" };
      const ds = dataset(state, op.map(l => l.id));
      return ds.errors.length ? { status: "FAIL", detail: ds.errors.slice(0, 6).join("; ") } : { status: "OK", detail: P("Dane kompletne dla {n} partii{w}", { n: op.length, w: ds.warnings.length ? P(" (ostrzeżenia: {k})", { k: ds.warnings.length }) : "" }) };
    }
    if (key === "separation") {
      const dds = col(state, "eudrDds"), test = new Set(dds.filter(d => d.env !== "PRODUCTION").map(d => d.referenceNumber).filter(Boolean));
      const leak = dds.filter(d => d.env === "PRODUCTION" && (d.kind === "SIMULATED" || test.has(d.referenceNumber) || /^SYM-/.test(d.referenceNumber || "")));
      return leak.length ? { status: "FAIL", detail: P("Wpisy produkcyjne z numerami testowymi: {l}", { l: leak.map(d => d.no).join(", ") }) } : { status: "OK", detail: P("Rejestr: produkcja {p}, test {t}; brak numerów testowych w produkcji", { p: dds.filter(d => d.env === "PRODUCTION").length, t: dds.length - dds.filter(d => d.env === "PRODUCTION").length }) };
    }
    return { status: "SKIP", detail: "Test wymaga serwera firmy (dane dostępowe i połączenie są wyłącznie po stronie serwera)" };
  }
  /** Zapis wyników testów (wywołuje serwer po wykonaniu testów sieciowych albo przeglądarka dla testów lokalnych). */
  function recordTests(state, a, ctx) {
    const user = userOf(ctx);
    if (!allowed(state, user, "tests.run")) return deny();
    const env = envOf(state), ts = nowOf(ctx), runId = uid("run");
    const results = (a.results || []).filter(r => TESTS.some(t => t.key === r.key)).map(r => ({ key: r.key, status: ["OK", "FAIL", "SKIP"].includes(r.status) ? r.status : "FAIL", detail: str(r.detail, 600), ms: Number(r.ms) || 0 }));
    if (!results.length) return bad("Brak wyników testów");
    const rec = put(state, "eudrTests", { id: runId, env, ts, by: user.name, mode: a.mode === "server" ? "server" : "local", results, ok: results.every(r => r.status !== "FAIL") });
    state.rev += 1;
    log(state, ctx, rec.id, P("Testy EUDR ({e})", { e: env }), "EUDR — Centrum testów: przebieg testów", null, { srodowisko: env, ok: results.filter(r => r.status === "OK").length, bledy: results.filter(r => r.status === "FAIL").length, pominiete: results.filter(r => r.status === "SKIP").length });
    return { ok: true, run: rec };
  }

  /* ------------------------------------------------------------------ */
  /* Dane przykładowe (fikcyjne, oznaczone)                              */
  /* ------------------------------------------------------------------ */
  function sample(state, today) {
    for (const k of COLLS) if (!Array.isArray(state[k])) state[k] = [];
    if (state.eudrLots.length) return;
    const ts = today + "T08:00:00.000Z", by = "Dane przykładowe";
    state.config = Object.assign({}, state.config, { eudr: Object.assign({ env: "ACCEPTANCE", profile: { company: "PRZYKŁAD — firma fikcyjna", country: "PL", size: "large", responsible: "Anna Górska" }, releaseMode: "block" }, cfgOf(state)) });
    const poly = (lon, lat) => JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { ProducerName: "PRZYKŁAD — działka fikcyjna" }, geometry: { type: "Polygon", coordinates: [[[lon, lat], [lon + 0.004, lat], [lon + 0.004, lat + 0.003], [lon, lat + 0.003], [lon, lat]]] } }] });
    const pz = (state.operations || []).filter(o => o.type === "ZAKUP" && o.whId === "wh_zab");
    const mk = (i, over) => Object.assign({
      id: "el_demo" + i, no: `EUDR/${today.slice(0, 4)}/${String(i).padStart(4, "0")}`, whId: "wh_zab", productId: "pr_drewno", qty: 30, m3: 30, t: 28.6, receivedDate: today,
      partnerId: "pa_ndl_rr", acq: "own_harvest", wood: { species: "Sosna zwyczajna", speciesLatin: "Pinus sylvestris", kind: "Drewno opałowe", cn: "4401", country: "PL", region: "śląskie", place: "PRZYKŁAD — oddział fikcyjny", harvestFrom: "2026-07-01", harvestTo: "2026-07-31" },
      origin: { owner: "PRZYKŁAD — Nadleśnictwo fikcyjne", ownerKind: "nadlesnictwo", plot: "PRZYKŁAD 101-a", country: "PL", riskCountry: "low", areaHa: 3.2, lat: 50.183, lon: 18.356 },
      status: "PENDING", dd: {}, links: [], parents: [], createdAt: ts, createdBy: by, updatedAt: ts, updatedBy: by, demo: true, notes: "DANE FIKCYJNE — przykład do szkolenia"
    }, over);
    state.eudrLots.push(
      mk(1, { receipt: pz[0] ? { opId: pz[0].id, opNo: pz[0].no, date: pz[0].date, qty: 30 } : null }),
      mk(2, { qty: 20, m3: 20, t: 19, acq: "from_operator", partnerId: "pa_drwal", wood: { species: "Buk zwyczajny", speciesLatin: "Fagus sylvatica", kind: "Drewno opałowe", cn: "4401", country: "PL", harvestFrom: "2026-06-10" }, origin: { owner: "PRZYKŁAD — dostawca fikcyjny", country: "PL", riskCountry: "low" } }),
      mk(3, { qty: 15, m3: 15, t: 14, status: "DRAFT", wood: { species: "Dąb", speciesLatin: "", kind: "Drewno opałowe", cn: "4401", country: "PL" }, origin: { country: "PL", riskCountry: "low", geojson: poly(18.35, 50.18), areaHa: 6 } })
    );
    state.eudrSuppliers.push({ id: "es_demo1", partnerId: "pa_ndl_rr", role: "forest_owner", country: "PL", status: "VERIFIED", address: "PRZYKŁAD — adres fikcyjny", email: "przyklad@example.invalid", verification: { by, at: ts, note: "DANE FIKCYJNE — weryfikacja przykładowa" }, updatedAt: ts },
      { id: "es_demo2", partnerId: "pa_drwal", role: "operator", country: "PL", status: "PENDING", updatedAt: ts });
    state.eudrDds.push({ id: "dd_demo1", no: `DDS-TEST/${today.slice(0, 4)}/0001`, env: "ACCEPTANCE", kind: "SIMULATED", referenceNumber: "SYM-PRZYKLAD01", status: "DRAFT", lotIds: ["el_demo1"], opIds: [], notes: "SYMULACJA — dane fikcyjne, nie jest numerem TRACES", steps: {}, history: [{ at: ts, by, change: "nowy", status: "DRAFT" }], createdAt: ts, createdBy: by });
  }

  const Eudr = {
    COLLS, ENVS, ROLES, ACTIONS, ACQ, OBL_ROLES, LOT_STATUS, COLORS, RISK_COUNTRY, SUPPLIER_ROLES, SUPPLIER_STATUS, DOC_TYPES, DOC_STATUS, FILE_TYPES, FILE_MAX,
    DDS_KINDS, DDS_STATUS, DDS_ACTIVE, DDS_STEPS, AUDIT_AREAS, AUDIT_STATUS, DD1_ITEMS, DD2_CRITERIA, RULES, TESTS, P,
    rules, profile, envOf, applyDate, inAnnex, roleOf, allowed, balance, origins, trace, obligations, evaluate, releaseCheck, checkGeo, lotGeo,
    dashboard, unassignedReceipts, opQty, supplierOf, docsOfLot, docsOfPartner, ddsOfLot, ddHints, dataset, submitXml, datasetGeo, auditHints, auditScore,
    sniff, localTest, content, moduleOf, sample, visibleLots,
    saveLot, lotFromOp, linkOp, unlinkOp, splitLot, mergeLots, processLots, archiveLot, setLotStatus, saveSupplier, saveDoc, verifyDoc, ddStage, ddApprove,
    saveDds, saveConfig, setEnv, setAccess, saveAudit, trainAssign, trainLesson, trainQuiz, trainConfirm, trainExercise, recordTests
  };
  R.Eudr = Eudr;
  if (typeof module !== "undefined" && module.exports) module.exports = Eudr;
})(typeof globalThis !== "undefined" ? globalThis : this);
