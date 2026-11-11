/* =========================================================================
   ResInvest ERP 3.15 — warstwa S: plan placu, pryzmy biomasy, terminarz pociągów, symulacja i realizacja załadunku

   Kolekcje stanu (zapis wierszami w bazie serwera — SQLite / PostgreSQL):
     state.yard       obiekty placu: pryzmy (kind "pile") i infrastruktura (tor, miejsce załadunku, droga, szlaban,
                      waga, kontener, punkt poboru próbek, tablica, ogrodzenie) — położenie w metrach, obrót w stopniach,
     state.trains     terminarz pociągów (transportów kolejowych),
     state.loadPlans  projekty symulacji załadunku, plan zatwierdzony (rezerwacja) i jego realizacja.

   Zasady:
     * pryzma to PODZIAŁ stanu ewidencyjnego (magazyn + produkt) na miejsca na placu — suma ilości pryzm nie może
       przekroczyć stanu z księgi; pryzma nie jest osobnym stanem magazynowym,
     * przydział pryzm do pociągów (kolory) jest LICZONY z terminarza przy każdym odczycie (allocate): rezerwacje
       planów zatwierdzonych, potem przypisania ręczne, potem pryzmy najbliższe miejscu załadunku — ta sama ilość
       nigdy nie trafia do dwóch pociągów,
     * symulacja niczego nie zmienia w magazynie; zatwierdzenie planu rezerwuje ilości (kontrola w tej samej
       transakcji co zapis); stan magazynu zmienia dopiero zakończenie załadunku — zwykłą operacją sprzedaży (WZ),
     * każda zmiana ma wpis w dzienniku audytu.
   Moduł działa w przeglądarce i w Node (serwer, testy).
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  const { rq, EPS, byId, can, canAccessWh, Stock, Units, Dates, NumParse, uid } = R;
  const t = (s, p) => R.I18N.t(s, p);
  const N_ = s => s;
  const str = v => String(v == null ? "" : v).trim().replace(/\s+/g, " ");
  const nowOf = ctx => (ctx && ctx.now) || new Date().toISOString();
  const todayOf = ctx => (ctx && ctx.today) || Dates.localToday();
  const col = (state, k) => Array.isArray(state[k]) ? state[k] : (state[k] = []);

  /** Plac: prostokąt roboczy mapy w metrach (widok z góry). */
  const AREA = { w: 240, h: 160 };
  const INFRA = {
    track: { label: N_("Tor kolejowy"), w: 200, h: 4 }, loading: { label: N_("Miejsce załadunku pociągu"), w: 60, h: 6 },
    road: { label: N_("Droga dojazdowa"), w: 80, h: 7 }, gate: { label: N_("Szlaban"), w: 9, h: 2 },
    scale: { label: N_("Waga najazdowa"), w: 18, h: 4 }, container: { label: N_("Kontener biurowy / socjalny"), w: 6, h: 3 },
    sample: { label: N_("Punkt poboru próbek"), w: 3, h: 3 }, board: { label: N_("Tablica informacyjna"), w: 3, h: 2 },
    fence: { label: N_("Ogrodzenie placu"), w: 100, h: 1 }
  };
  /** Kształt pryzmy → objętość geometryczna z wymiarów (m³ nasypowe, orientacyjnie). */
  const SHAPES = {
    pryzma: { label: N_("Pryzma — przekrój trójkątny"), vol: (L, W, H) => 0.5 * W * H * L },
    trapez: { label: N_("Pryzma — przekrój trapezowy"), vol: (L, W, H, T) => (W + Math.min(T || 0, W)) / 2 * H * L },
    kopula: { label: N_("Pryzma — przekrój kopułowy (parabola)"), vol: (L, W, H) => 2 / 3 * W * H * L },
    stozek: { label: N_("Stożek / kopiec"), vol: (L, W, H) => Math.PI / 3 * (L / 2) * (W / 2) * H },
    prostopadloscian: { label: N_("Prostopadłościan (boks, zasiek)"), vol: (L, W, H) => L * W * H }
  };
  const PILE_STATUS = { AVAILABLE: N_("Dostępna"), BLOCKED: N_("Zablokowana / niezgodna jakościowo"), OFF: N_("Wyłączona z użytkowania") };
  const TRAIN_STATUS = { PLANNED: N_("Zaplanowany"), WAITING: N_("Oczekujący"), PREPARING: N_("Przygotowanie biomasy"), READY: N_("Gotowy do załadunku"),
    LOADING: N_("W trakcie załadunku"), DONE: N_("Zakończony"), DELAYED: N_("Opóźniony"), CANCELLED: N_("Anulowany") };
  const TRAIN_MANUAL = ["PLANNED", "WAITING", "PREPARING", "READY", "DELAYED", "CANCELLED"];
  const PLAN_STATUS = { DRAFT: N_("Projekt symulacji"), APPROVED: N_("Zatwierdzony — rezerwacja"), RUNNING: N_("Załadunek w toku"), PAUSED: N_("Załadunek wstrzymany"), DONE: N_("Zakończony"), CANCELLED: N_("Anulowany") };
  const STRATEGIES = { nearest: N_("Wariant A — najkrótsza trasa ładowarki"), fewest: N_("Wariant B — najmniej pryzm"), fastest: N_("Wariant C — najkrótszy czas załadunku"), manual: N_("Wariant D — ręczny wybór magazyniera") };
  const RESERVING = ["APPROVED", "RUNNING", "PAUSED"];
  /** Kolory pryzm na mapie. */
  const COLORS = { green: N_("Najbliższy pociąg"), orange: N_("Kolejny pociąg"), blue: N_("Dostępna — bez pociągu"), red: N_("Zablokowana / niedostępna"), grey: N_("Wyłączona z użytkowania") };
  /** Parametry symulacji — wartości wyjściowe do zmiany przez użytkownika (szacunkowe, niepotwierdzone pomiarem). */
  const defaultParams = cfg => ({ wagonMP: cfg && cfg.wagonMPDefault > 0 ? cfg.wagonMPDefault : 120, wagons: null, loaders: 1, operators: 1, bucketM3: 5, fill: 0.9, cycleSec: 90, speedKmh: 8, switchMin: 5 });
  const PARAM_LIMITS = { wagonMP: [1, 1000], wagons: [1, 200], loaders: [1, 20], operators: [1, 40], bucketM3: [0.2, 40], fill: [0.1, 1.2], cycleSec: [10, 3600], speedKmh: [1, 40], switchMin: [0, 240] };

  function num(v, lo, hi, optional) {
    if (v === "" || v === null || v === undefined) return optional ? { ok: true, value: null } : { ok: false };
    const n = typeof v === "number" ? { ok: Number.isFinite(v), value: v } : NumParse.parse(v);
    return n.ok && n.value >= lo && n.value <= hi ? { ok: true, value: rq(n.value) } : { ok: false };
  }
  const isTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const deny = msg => ({ ok: false, code: "FORBIDDEN", error: msg });
  function whOk(state, user, whId) {
    const wh = byId(state.warehouses, whId);
    if (!wh) return { ok: false, error: t("Wybierz magazyn") };
    if (!canAccessWh(user, whId)) return deny(t("Brak dostępu do magazynu {w}", { w: wh.name }));
    return { ok: true, wh };
  }
  function log(state, ctx, whId, entityId, no, action, before, after, relatedNo) {
    const a = R.audit(state, ctx, { entity: "yard", entityId, opNo: no || "—", relatedNo: relatedNo || undefined, event: "yard", action, before: before || null, after: after || null, source: (ctx && ctx.source) || N_("Plan placu") });
    a.whId = whId;
    return a;
  }
  /** Podmiana rekordu kolekcji nową wersją (rekordy na serwerze są zamrożone — bez zmiany w miejscu). */
  function put(state, coll, rec) { const a = col(state, coll), i = a.findIndex(x => x.id === rec.id); if (i >= 0) a[i] = rec; else a.push(rec); return rec; }
  function drop(state, coll, id) { const a = col(state, coll), i = a.findIndex(x => x.id === id); if (i >= 0) a.splice(i, 1); }

  /* ------------------------------------------------------------------ */
  /* Odczyty                                                             */
  /* ------------------------------------------------------------------ */
  const piles = (state, whId) => col(state, "yard").filter(o => o.kind === "pile" && (!whId || o.whId === whId));
  const infra = (state, whId) => col(state, "yard").filter(o => o.kind !== "pile" && (!whId || o.whId === whId));
  const trainsOf = (state, whId) => col(state, "trains").filter(x => !whId || x.whId === whId);
  const plansOf = (state, trainId) => col(state, "loadPlans").filter(p => !trainId || p.trainId === trainId);
  const trainKey = x => `${x.loadDate || x.arrivalDate}T${x.loadStart || x.arrivalTime || "00:00"}|${x.no}`;
  const trainActive = x => x.status !== "DONE" && x.status !== "CANCELLED";
  /** Aktywne pociągi magazynu w kolejności terminów załadunku. */
  const queue = (state, whId) => trainsOf(state, whId).filter(trainActive).sort((a, b) => trainKey(a) < trainKey(b) ? -1 : 1);
  /** Objętość geometryczna pryzmy [m³ nasypowe] z wymiarów i kształtu. */
  function geoVolume(p) { const s = SHAPES[p.shape] || SHAPES.pryzma; return rq(s.vol(Number(p.w) || 0, Number(p.h) || 0, Number(p.hei) || 0, Number(p.topW) || 0)); }
  /** Ilości pryzmy: stan ewidencyjny w jednostce produktu oraz przeliczenia istniejącymi przelicznikami ERP. */
  function pileQty(state, p) {
    const pr = byId(state.products, p.productId), cfg = state.config, q = Number(p.qty) || 0;
    // m³ i MP przelicznikami produktu (1 m³ = 4 MP); produkt tonowy bez gęstości nie ma przelicznika
    const f = pr ? Units.factors(pr, cfg) : null, has = !!pr && (pr.unit !== "t" || f.tm3 > 0);
    const m3 = has ? rq(Units.toM3(q, pr.unit, pr, cfg)) : null;
    return { qty: q, unit: pr ? pr.unit : "", mp: has ? rq(Units.fromM3(m3, "MP", pr, cfg)) : null, m3, t: pr ? Units.mass(q, pr, cfg) : null, geo: geoVolume(p) };
  }
  /** Odległość środka pryzmy od najbliższego miejsca załadunku pociągu [m]; brak miejsca załadunku → null. */
  function distance(state, p) {
    const L = infra(state, p.whId).filter(o => o.kind === "loading");
    if (!L.length) return null;
    return rq(Math.min(...L.map(l => Math.hypot(l.x - p.x, l.y - p.y))));
  }
  function loadingPoint(state, whId, from) {
    const L = infra(state, whId).filter(o => o.kind === "loading");
    if (!L.length) return null;
    return L.slice().sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  }
  /** Rezerwacje planów zatwierdzonych / w realizacji: Map pileId → ilość (bez planu `exceptId`). */
  function reserved(state, exceptId) {
    const m = new Map();
    for (const p of col(state, "loadPlans")) if (p.id !== exceptId && RESERVING.includes(p.status)) for (const l of p.lines) m.set(l.pileId, rq((m.get(l.pileId) || 0) + l.qty));
    return m;
  }
  /** Zgodność z ewidencją: stan z księgi, suma pryzm i ilość poza pryzmami — dla każdego produktu magazynu. */
  function consistency(state, whId) {
    const led = Stock.byProduct(state, whId), inP = new Map();
    for (const p of piles(state, whId)) inP.set(p.productId, rq((inP.get(p.productId) || 0) + (Number(p.qty) || 0)));
    const ids = new Set([...inP.keys(), ...[...led].filter(([, q]) => Math.abs(q) > EPS).map(([id]) => id)]);
    return [...ids].map(id => { const pr = byId(state.products, id) || {}, a = led.get(id) || 0, b = inP.get(id) || 0; return { productId: id, name: pr.name || id, unit: pr.unit || "", ledger: a, inPiles: b, free: rq(a - b), over: rq(b - a) > EPS }; })
      .sort((a, b) => a.name < b.name ? -1 : 1);
  }
  const fits = (train, pile, state) => { const pr = byId(state.products, pile.productId); return !!pr && pr.unit === "MP" && (!train.productId || train.productId === pile.productId); };

  /**
   * Automatyczny przydział pryzm do pociągów magazynu (wynik liczony, nie zapisywany):
   *   byTrain: Map trainId → { need, total, shortage, lines: [{ pileId, qty, source: "plan" | "manual" | "auto" }], planId }
   *   byPile:  Map pileId  → { color, free, parts: [{ trainId, qty, source }] }
   *   order:   identyfikatory aktywnych pociągów wg terminu; next — najbliższy pociąg.
   */
  function allocate(state, whId) {
    const P = piles(state, whId), Q = queue(state, whId), plans = col(state, "loadPlans");
    const left = new Map(P.map(p => [p.id, p.status === "AVAILABLE" ? Math.max(0, Number(p.qty) || 0) : 0]));
    const byTrain = new Map(), byPile = new Map(P.map(p => [p.id, { color: "blue", free: 0, parts: [] }]));
    const take = (train, pile, want, source) => {
      const q = rq(Math.min(want, left.get(pile.id) || 0));
      if (!(q > EPS)) return 0;
      left.set(pile.id, rq(left.get(pile.id) - q));
      byTrain.get(train.id).lines.push({ pileId: pile.id, qty: q, source });
      byPile.get(pile.id).parts.push({ trainId: train.id, qty: q, source });
      return q;
    };
    for (const x of Q) byTrain.set(x.id, { need: Number(x.reqQty) || 0, total: 0, shortage: 0, lines: [], planId: null });
    // 1. rezerwacje planów zatwierdzonych / w realizacji
    for (const x of Q) {
      const pl = plans.find(p => p.trainId === x.id && RESERVING.includes(p.status));
      if (!pl) continue;
      const T = byTrain.get(x.id); T.planId = pl.id;
      for (const l of pl.lines) { const pile = byId(P, l.pileId); if (pile) T.total = rq(T.total + take(x, pile, l.qty, "plan")); }
    }
    // 2. pozostałe pociągi w kolejności terminów: przypisania ręczne, potem pryzmy najbliższe miejscu załadunku
    const dist = new Map(P.map(p => [p.id, distance(state, p)]));
    const near = (a, b) => (dist.get(a.id) === null ? 1e9 : dist.get(a.id)) - (dist.get(b.id) === null ? 1e9 : dist.get(b.id)) || (a.no < b.no ? -1 : 1);
    for (const x of Q) {
      const T = byTrain.get(x.id);
      if (!T.planId) {
        const mine = P.filter(p => p.trainId === x.id && fits(x, p, state)).sort(near), free = P.filter(p => !p.trainId && fits(x, p, state)).sort(near);
        for (const [list, src] of [[mine, "manual"], [free, "auto"]]) for (const p of list) { if (T.need - T.total <= EPS) break; T.total = rq(T.total + take(x, p, T.need - T.total, src)); }
      }
      T.shortage = rq(Math.max(0, T.need - T.total));
    }
    const next = Q.length ? Q[0].id : null;
    for (const p of P) {
      const b = byPile.get(p.id); b.free = left.get(p.id) || 0;
      b.color = p.status === "BLOCKED" ? "red" : p.status === "OFF" ? "grey" : b.parts.some(x => x.trainId === next) ? "green" : b.parts.length ? "orange" : "blue";
    }
    return { order: Q.map(x => x.id), next, byTrain, byPile };
  }

  /* ------------------------------------------------------------------ */
  /* Pryzmy i infrastruktura                                             */
  /* ------------------------------------------------------------------ */
  function geom(a, base, errors) {
    const g = {};
    for (const [k, lo, hi] of [["x", 0, AREA.w], ["y", 0, AREA.h], ["w", 0.5, 400], ["h", 0.5, 400]]) {
      const v = a[k] === undefined ? base[k] : a[k], n = num(v, lo, hi);
      if (!n.ok) errors[k] = t("Położenie i wymiary: liczby w granicach placu ({w} × {h} m)", { w: AREA.w, h: AREA.h }); else g[k] = n.value;
    }
    const r = a.rot === undefined ? base.rot || 0 : a.rot, rn = num(r, -360, 360);
    if (!rn.ok) errors.rot = t("Obrót: kąt w stopniach"); else g.rot = ((Math.round(rn.value) % 360) + 360) % 360;
    return g;
  }
  function nextPileNo(state, whId) { const n = Math.max(0, ...piles(state, whId).map(p => parseInt(String(p.no).replace(/\D/g, ""), 10) || 0)); return "P-" + String(n + 1).padStart(3, "0"); }

  const YardPlan = {
    AREA, INFRA, SHAPES, PILE_STATUS, TRAIN_STATUS, TRAIN_MANUAL, PLAN_STATUS, STRATEGIES, COLORS, PARAM_LIMITS, defaultParams,
    piles, infra, trains: trainsOf, plans: plansOf, queue, geoVolume, pileQty, distance, loadingPoint, reserved, consistency, allocate, trainActive,

    /** Utworzenie albo zmiana pryzmy. args: id?, whId, name, productId, supplierId, pzNo, receivedDate, qty, shape, hei, topW, status, moisture, qualityNote, trainId, x, y, w, h, rot */
    savePile(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user;
      if (!can(user, "yard.edit")) return deny(t("Pryzmy i plan placu zmienia osoba z uprawnieniem „Plan placu — pryzmy i infrastruktura”"));
      const old = a.id ? piles(state).find(p => p.id === a.id) : null;
      if (a.id && !old) return { ok: false, error: t("Nie znaleziono pryzmy") };
      const whId = old ? old.whId : str(a.whId), w = whOk(state, user, whId);
      if (!w.ok) return w;
      const errors = {}, base = old || { x: AREA.w / 2, y: AREA.h / 2, w: 40, h: 12, rot: 0, shape: "pryzma", hei: 4, status: "AVAILABLE", qty: 0 };
      const v = k => a[k] === undefined ? base[k] : a[k];
      const g = geom(a, base, errors);
      const productId = str(v("productId")), pr = byId(state.products, productId);
      if (!pr) errors.productId = t("Wybierz rodzaj biomasy (produkt)");
      const shape = str(v("shape")); if (!SHAPES[shape]) errors.shape = t("Wybierz kształt pryzmy");
      const hei = num(v("hei"), 0.1, 60); if (!hei.ok) errors.hei = t("Wysokość pryzmy: od 0,1 do 60 m");
      const topW = num(v("topW"), 0, 400, true); if (!topW.ok) errors.topW = t("Szerokość korony: liczba ≥ 0");
      const qty = num(v("qty"), 0, 1e8); if (!qty.ok) errors.qty = t("Ilość w pryzmie: liczba ≥ 0");
      const status = str(v("status")); if (!PILE_STATUS[status]) errors.status = t("Wybierz status pryzmy");
      const moisture = num(v("moisture"), 0, 100, true); if (!moisture.ok) errors.moisture = t("Wilgotność: od 0 do 100%");
      const name = str(v("name")).slice(0, 60), pzNo = str(v("pzNo")).slice(0, 40), qualityNote = str(v("qualityNote")).slice(0, 200);
      const receivedDate = str(v("receivedDate")); if (receivedDate && !Dates.isISO(receivedDate)) errors.receivedDate = t("Data przyjęcia: RRRR-MM-DD");
      const supplierId = str(v("supplierId")); if (supplierId && !byId(state.partners, supplierId)) errors.supplierId = t("Nieznany dostawca");
      const trainId = str(v("trainId")); const tr = trainId ? byId(col(state, "trains"), trainId) : null;
      if (trainId && (!tr || tr.whId !== whId || !trainActive(tr))) errors.trainId = t("Pociąg musi być aktywny i z tego samego magazynu");
      if (pr && qty.ok) {
        // suma pryzm produktu nie może przekroczyć stanu z księgi; ilość nie może spaść poniżej rezerwacji planów
        const others = piles(state, whId).filter(p => p.productId === productId && (!old || p.id !== old.id)).reduce((s, p) => s + (Number(p.qty) || 0), 0);
        const ledger = Stock.balance(state, whId, productId), max = rq(Math.max(0, ledger - others));
        if (qty.value > max + EPS && !(old && old.productId === productId && qty.value <= old.qty + EPS))
          errors.qty = t("W ewidencji magazynu jest {a} {u}, w innych pryzmach {b} {u} — do tej pryzmy można przypisać najwyżej {c} {u}", { a: R.fmtQ(ledger), b: R.fmtQ(others), c: R.fmtQ(max), u: Units.label(pr.unit) });
        const res = old ? reserved(state).get(old.id) || 0 : 0;
        if (res > EPS && (qty.value < res - EPS || productId !== old.productId || status !== "AVAILABLE"))
          errors.qty = t("Pryzma ma rezerwację {q} {u} w zatwierdzonym planie załadunku — najpierw cofnij zatwierdzenie planu", { q: R.fmtQ(res), u: Units.label(pr.unit) });
      }
      if (Object.keys(errors).length) return { ok: false, errors, error: Object.values(errors)[0] };
      const rec = Object.assign({}, old || { id: uid("yp"), kind: "pile", whId, no: nextPileNo(state, whId), createdAt: nowOf(ctx) }, g,
        { name, productId, supplierId, pzNo, receivedDate, qty: qty.value, shape, hei: hei.value, topW: topW.value, status, moisture: moisture.value, qualityNote, trainId, updatedAt: nowOf(ctx), updatedBy: user.name });
      const brief = p => p ? { nazwa: p.name, produkt: (byId(state.products, p.productId) || {}).name, ilosc: p.qty, wymiary: `${p.w} × ${p.h} × ${p.hei} m`, polozenie: `${p.x}; ${p.y}; ${p.rot}°`, status: p.status, pociag: p.trainId ? (byId(col(state, "trains"), p.trainId) || {}).no : "" } : null;
      if (old && JSON.stringify(brief(old)) === JSON.stringify(brief(rec)) && ["supplierId", "pzNo", "receivedDate", "shape", "topW", "moisture", "qualityNote"].every(k => old[k] === rec[k])) return { ok: false, code: "NOCHANGE", error: t("Brak zmian do zapisania") };
      put(state, "yard", rec); state.rev += 1;
      const what = !old ? N_("Pryzma — utworzenie") : old.qty !== rec.qty ? N_("Pryzma — zmiana ilości") : old.status !== rec.status ? N_("Pryzma — zmiana statusu") : old.trainId !== rec.trainId ? N_("Pryzma — przypisanie do pociągu")
        : (old.w !== rec.w || old.h !== rec.h || old.hei !== rec.hei) ? N_("Pryzma — zmiana wymiarów") : (old.x !== rec.x || old.y !== rec.y || old.rot !== rec.rot) ? N_("Pryzma — zmiana położenia") : N_("Pryzma — zmiana danych");
      log(state, ctx, whId, rec.id, rec.no, what, brief(old), brief(rec));
      return { ok: true, pile: rec };
    },
    /** Przesunięcie / obrót / zmiana rozmiaru obiektu na mapie (pryzma albo infrastruktura). args: id, x, y, w, h, rot */
    moveObject(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user;
      if (!can(user, "yard.edit")) return deny(t("Pryzmy i plan placu zmienia osoba z uprawnieniem „Plan placu — pryzmy i infrastruktura”"));
      const old = byId(col(state, "yard"), a.id);
      if (!old) return { ok: false, error: t("Nie znaleziono obiektu na planie placu") };
      const w = whOk(state, user, old.whId); if (!w.ok) return w;
      const errors = {}, g = geom(a, old, errors);
      if (Object.keys(errors).length) return { ok: false, errors, error: Object.values(errors)[0] };
      if (["x", "y", "w", "h", "rot"].every(k => old[k] === g[k])) return { ok: false, code: "NOCHANGE", error: t("Brak zmian do zapisania") };
      const rec = Object.assign({}, old, g, { updatedAt: nowOf(ctx), updatedBy: user.name });
      put(state, "yard", rec); state.rev += 1;
      const dims = old.w !== rec.w || old.h !== rec.h, isPile = old.kind === "pile";
      log(state, ctx, old.whId, rec.id, isPile ? rec.no : t(INFRA[rec.kind].label), isPile ? (dims ? N_("Pryzma — zmiana wymiarów") : N_("Pryzma — zmiana położenia")) : N_("Plan placu — przesunięcie obiektu"),
        { polozenie: `${old.x}; ${old.y}; ${old.rot}°`, wymiary: `${old.w} × ${old.h} m` }, { polozenie: `${rec.x}; ${rec.y}; ${rec.rot}°`, wymiary: `${rec.w} × ${rec.h} m` });
      return { ok: true, object: rec };
    },
    /** Element infrastruktury placu. args: id?, whId, kind, label, x, y, w, h, rot */
    saveInfra(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user;
      if (!can(user, "yard.edit")) return deny(t("Pryzmy i plan placu zmienia osoba z uprawnieniem „Plan placu — pryzmy i infrastruktura”"));
      const old = a.id ? infra(state).find(o => o.id === a.id) : null;
      if (a.id && !old) return { ok: false, error: t("Nie znaleziono obiektu na planie placu") };
      const kind = old ? old.kind : str(a.kind), def = INFRA[kind];
      if (!def) return { ok: false, error: t("Nieznany rodzaj obiektu") };
      const whId = old ? old.whId : str(a.whId), w = whOk(state, user, whId); if (!w.ok) return w;
      const errors = {}, g = geom(a, old || { x: AREA.w / 2, y: AREA.h / 2, w: def.w, h: def.h, rot: 0 }, errors);
      if (Object.keys(errors).length) return { ok: false, errors, error: Object.values(errors)[0] };
      const rec = Object.assign({}, old || { id: uid("yi"), kind, whId }, g, { label: str(a.label === undefined ? (old ? old.label : "") : a.label).slice(0, 60), updatedAt: nowOf(ctx) });
      put(state, "yard", rec); state.rev += 1;
      log(state, ctx, whId, rec.id, t(def.label), old ? N_("Plan placu — zmiana obiektu") : N_("Plan placu — dodanie obiektu"), old ? { opis: old.label } : null, { rodzaj: def.label, opis: rec.label });
      return { ok: true, object: rec };
    },
    removeObject(state, args, ctx) {
      const user = ctx && ctx.user;
      if (!can(user, "yard.edit")) return deny(t("Pryzmy i plan placu zmienia osoba z uprawnieniem „Plan placu — pryzmy i infrastruktura”"));
      const old = byId(col(state, "yard"), args && args.id);
      if (!old) return { ok: false, error: t("Nie znaleziono obiektu na planie placu") };
      const w = whOk(state, user, old.whId); if (!w.ok) return w;
      if (old.kind === "pile" && col(state, "loadPlans").some(p => p.status !== "DONE" && p.status !== "CANCELLED" && p.lines.some(l => l.pileId === old.id)))
        return { ok: false, error: t("Pryzma {no} jest w planie załadunku — usuń ją z planu albo anuluj plan", { no: old.no }) };
      drop(state, "yard", old.id); state.rev += 1;
      log(state, ctx, old.whId, old.id, old.kind === "pile" ? old.no : t(INFRA[old.kind].label), old.kind === "pile" ? N_("Pryzma — usunięcie z planu placu (ilość wraca do stanu poza pryzmami)") : N_("Plan placu — usunięcie obiektu"), old.kind === "pile" ? { nazwa: old.name, ilosc: old.qty } : { opis: old.label }, null);
      return { ok: true };
    },
    /** Układ wzorcowy infrastruktury (pusty plac): tor, miejsce załadunku, droga, szlaban, waga, kontenery, tablica, punkty prób, ogrodzenie. */
    template(state, args, ctx) {
      const user = ctx && ctx.user, whId = str(args && args.whId);
      if (!can(user, "yard.edit")) return deny(t("Pryzmy i plan placu zmienia osoba z uprawnieniem „Plan placu — pryzmy i infrastruktura”"));
      const w = whOk(state, user, whId); if (!w.ok) return w;
      if (infra(state, whId).length) return { ok: false, error: t("Plan placu ma już infrastrukturę — układ wzorcowy wstawia się na pusty plac") };
      for (const o of YardPlan.templateObjects(whId, () => uid("yi"), nowOf(ctx))) col(state, "yard").push(o);
      state.rev += 1;
      log(state, ctx, whId, "template", "—", N_("Plan placu — wstawienie układu wzorcowego infrastruktury"), null, { magazyn: w.wh.name });
      return { ok: true };
    },
    templateObjects(whId, id, ts) {
      const o = (kind, x, y, w, h, rot, label) => ({ id: id(), kind, whId, x, y, w, h, rot: rot || 0, label: label || "", updatedAt: ts });
      const out = [o("fence", 120, 4, 232, 1, 0), o("fence", 120, 156, 232, 1, 0), o("fence", 4, 80, 152, 1, 90), o("fence", 236, 80, 152, 1, 90),
        o("track", 120, 14, 224, 4, 0, "Tor 1"), o("track", 120, 24, 224, 4, 0, "Tor 2 — załadunek"), o("loading", 125, 33, 70, 6, 0, "Miejsce ładowania pociągu"),
        o("road", 34, 60, 56, 7, 0, "Droga dojazdowa"), o("gate", 12, 60, 9, 2, 90, "Wjazd / wyjazd"), o("scale", 40, 46, 18, 4, 0, "Waga najazdowa"),
        o("container", 20, 74, 6, 3, 0, "Biuro"), o("container", 28, 74, 6, 3, 0, "Socjalny"), o("board", 62, 44, 3, 2, 0, "Tablica")];
      for (let i = 0; i < 5; i++) out.push(o("sample", 95 + i * 15, 42, 3, 3, 0, "P" + (i + 1)));
      return out;
    },

    /* ------------------------------------------------------------------ */
    /* Terminarz pociągów                                                  */
    /* ------------------------------------------------------------------ */
    saveTrain(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user;
      if (!can(user, "trains.edit")) return deny(t("Terminarz pociągów zmienia osoba z uprawnieniem „Terminarz pociągów — planowanie i zatwierdzanie”"));
      const old = a.id ? byId(col(state, "trains"), a.id) : null;
      if (a.id && !old) return { ok: false, error: t("Nie znaleziono pociągu") };
      const whId = old ? old.whId : str(a.whId), w = whOk(state, user, whId); if (!w.ok) return w;
      if (old && old.status === "DONE") return { ok: false, error: t("Pociąg zakończony — danych zrealizowanego załadunku nie można zmienić") };
      const errors = {}, v = k => a[k] === undefined ? (old ? old[k] : "") : a[k];
      const no = str(v("no")).slice(0, 40); if (!no) errors.no = t("Podaj numer pociągu / transportu");
      else if (trainsOf(state, whId).some(x => x.no === no && (!old || x.id !== old.id) && trainActive(x))) errors.no = t("Aktywny pociąg o numerze {no} już jest w terminarzu", { no });
      const buyerId = str(v("buyerId")), buyer = byId(state.partners, buyerId); if (!buyer) errors.buyerId = t("Wybierz odbiorcę z kartoteki kontrahentów");
      const arrivalDate = str(v("arrivalDate")); if (!Dates.isISO(arrivalDate)) errors.arrivalDate = t("Podaj datę planowanego przyjazdu");
      const loadDate = str(v("loadDate")) || arrivalDate; if (str(v("loadDate")) && !Dates.isISO(loadDate)) errors.loadDate = t("Data załadunku: RRRR-MM-DD");
      else if (Dates.isISO(arrivalDate) && loadDate < arrivalDate) errors.loadDate = t("Załadunek nie może być przed przyjazdem pociągu");
      const times = {};
      for (const k of ["arrivalTime", "loadStart", "loadEnd"]) { const x = str(v(k)); if (x && !isTime(x)) errors[k] = t("Godzina w formacie GG:MM"); times[k] = x; }
      if (times.loadStart && times.loadEnd && times.loadEnd <= times.loadStart) errors.loadEnd = t("Zakończenie załadunku musi być po rozpoczęciu");
      const reqQty = num(v("reqQty"), 0.01, 1e7); if (!reqQty.ok) errors.reqQty = t("Podaj wymaganą ilość biomasy w MP (większą od zera)");
      const reqT = num(v("reqT"), 0, 1e7, true); if (!reqT.ok) errors.reqT = t("Wymagana ilość w tonach: liczba ≥ 0");
      const productId = str(v("productId")), pr = productId ? byId(state.products, productId) : null;
      if (productId && (!pr || pr.unit !== "MP")) errors.productId = t("Rodzaj biomasy: produkt prowadzony w MP");
      const status = str(v("status")) || "PLANNED";
      if (!TRAIN_STATUS[status] || (!TRAIN_MANUAL.includes(status) && !(old && old.status === status))) errors.status = t("Ten status ustawia realizacja załadunku");
      if (Object.keys(errors).length) return { ok: false, errors, error: Object.values(errors)[0] };
      const rec = Object.assign({}, old || { id: uid("tr"), whId, createdAt: nowOf(ctx), createdBy: user.name }, { no, buyerId, recipient: buyer.name, arrivalDate, loadDate }, times,
        { reqQty: reqQty.value, reqT: reqT.value, productId, orderNo: str(v("orderNo")).slice(0, 60), notes: str(v("notes")).slice(0, 500), status, updatedAt: nowOf(ctx), updatedBy: user.name });
      const brief = x => x ? { numer: x.no, odbiorca: x.recipient, przyjazd: `${x.arrivalDate} ${x.arrivalTime || ""}`.trim(), zaladunek: `${x.loadDate} ${x.loadStart || ""}–${x.loadEnd || ""}`, MP: x.reqQty, t: x.reqT, status: x.status, zamowienie: x.orderNo } : null;
      if (old && JSON.stringify(brief(old)) === JSON.stringify(brief(rec)) && old.productId === rec.productId && old.notes === rec.notes) return { ok: false, code: "NOCHANGE", error: t("Brak zmian do zapisania") };
      put(state, "trains", rec);
      // anulowanie pociągu zwalnia rezerwacje i przypisania ręczne
      if (status === "CANCELLED") YardPlan._release(state, rec, ctx);
      state.rev += 1;
      log(state, ctx, whId, rec.id, rec.no, !old ? N_("Pociąg — dodanie do terminarza") : old.status !== rec.status ? N_("Pociąg — zmiana statusu") : N_("Pociąg — zmiana danych"), brief(old), brief(rec));
      return { ok: true, train: rec, allocation: YardPlan.summary(state, rec) };
    },
    _release(state, train, ctx) {
      for (const p of plansOf(state, train.id)) if (p.status !== "DONE" && p.status !== "CANCELLED") put(state, "loadPlans", Object.assign({}, p, { status: "CANCELLED", cancelledAt: nowOf(ctx) }));
      for (const p of piles(state, train.whId)) if (p.trainId === train.id) put(state, "yard", Object.assign({}, p, { trainId: "" }));
    },
    removeTrain(state, args, ctx) {
      const user = ctx && ctx.user;
      if (!can(user, "trains.edit")) return deny(t("Terminarz pociągów zmienia osoba z uprawnieniem „Terminarz pociągów — planowanie i zatwierdzanie”"));
      const old = byId(col(state, "trains"), args && args.id);
      if (!old) return { ok: false, error: t("Nie znaleziono pociągu") };
      const w = whOk(state, user, old.whId); if (!w.ok) return w;
      if (old.status === "DONE" || old.status === "LOADING") return { ok: false, error: t("Pociągu w trakcie załadunku albo zakończonego nie można usunąć z terminarza") };
      YardPlan._release(state, old, ctx);
      for (const p of plansOf(state, old.id)) drop(state, "loadPlans", p.id);
      drop(state, "trains", old.id); state.rev += 1;
      log(state, ctx, old.whId, old.id, old.no, N_("Pociąg — usunięcie z terminarza"), { numer: old.no, odbiorca: old.recipient, zaladunek: old.loadDate, MP: old.reqQty }, null);
      return { ok: true };
    },
    /** Podsumowanie przydziału pociągu: zapotrzebowanie, przygotowane pryzmy, niedobór. */
    summary(state, train) {
      const A = allocate(state, train.whId), T = A.byTrain.get(train.id);
      if (!T) return { need: Number(train.reqQty) || 0, total: 0, shortage: 0, lines: [], isNext: false };
      return { need: T.need, total: T.total, shortage: T.shortage, isNext: A.next === train.id, planId: T.planId,
        lines: T.lines.map(l => { const p = byId(col(state, "yard"), l.pileId); return { pileId: l.pileId, no: p ? p.no : "", name: p ? p.name : "", qty: l.qty, source: l.source }; }) };
    },

    /* ------------------------------------------------------------------ */
    /* Symulacja załadunku                                                 */
    /* ------------------------------------------------------------------ */
    params(state, p) {
      const d = defaultParams(state.config), out = {}, errors = {};
      for (const k of Object.keys(d)) {
        const v = p && p[k] !== undefined ? p[k] : d[k], [lo, hi] = PARAM_LIMITS[k], n = num(v, lo, hi, k === "wagons");
        if (!n.ok) errors["params." + k] = t("Parametr symulacji poza zakresem ({a} – {b})", { a: lo, b: hi }); else out[k] = k === "wagons" || k === "loaders" || k === "operators" ? (n.value === null ? null : Math.round(n.value)) : n.value;
      }
      return { params: out, errors };
    },
    /** Pryzmy możliwe do użycia dla pociągu: dostępna ilość po rezerwacjach innych planów, odległość od miejsca załadunku. */
    candidates(state, train, exceptPlanId) {
      const res = reserved(state, exceptPlanId);
      return piles(state, train.whId).filter(p => p.status === "AVAILABLE" && fits(train, p, state) && (!p.trainId || p.trainId === train.id))
        .map(p => ({ pile: p, free: rq(Math.max(0, (Number(p.qty) || 0) - (res.get(p.id) || 0))), dist: distance(state, p) })).filter(c => c.free > EPS);
    },
    /** Propozycja doboru pryzm wg wariantu (bez zapisu). Jeden plan = jeden rodzaj biomasy (jeden dokument WZ). */
    propose(state, trainId, strategy, params, exceptPlanId) {
      const train = byId(col(state, "trains"), trainId);
      if (!train) return { ok: false, error: t("Nie znaleziono pociągu") };
      const P = YardPlan.params(state, params).params, all = YardPlan.candidates(state, train, exceptPlanId);
      if (!all.length) return { ok: true, lines: [], shortage: Number(train.reqQty) || 0 };
      // jeden produkt: wskazany w pociągu albo ten, którego jest najwięcej w dostępnych pryzmach
      const byProd = new Map(); for (const c of all) byProd.set(c.pile.productId, (byProd.get(c.pile.productId) || 0) + c.free);
      const prod = train.productId || [...byProd].sort((a, b) => b[1] - a[1])[0][0], C = all.filter(c => c.pile.productId === prod);
      const d = c => c.dist === null ? 1e9 : c.dist;
      const pick = order => { let left = Number(train.reqQty) || 0; const lines = []; for (const c of order) { if (left <= EPS) break; const q = rq(Math.min(left, c.free)); lines.push({ pileId: c.pile.id, qty: q }); left = rq(left - q); } return lines; };
      const nearest = pick(C.slice().sort((a, b) => d(a) - d(b) || (a.pile.no < b.pile.no ? -1 : 1)));
      const fewest = pick(C.slice().sort((a, b) => b.free - a.free || d(a) - d(b)));
      let lines = strategy === "fewest" ? fewest : nearest;
      if (strategy === "fastest") {
        const time = l => YardPlan.calc(state, train, l, P).timeMin;
        lines = time(fewest) < time(nearest) ? fewest : nearest;
      }
      const total = lines.reduce((s, l) => s + l.qty, 0);
      return { ok: true, lines, productId: prod, shortage: rq(Math.max(0, (Number(train.reqQty) || 0) - total)) };
    },
    /** Kalkulator załadunku (wyniki szacunkowe — z parametrów wpisanych przez użytkownika). */
    calc(state, train, lines, params) {
      const P = params || defaultParams(state.config), cfg = state.config;
      let mp = 0, tons = 0, m3 = 0, cycles = 0, sec = 0, route = 0;
      const rows = lines.map((l, i) => {
        const p = byId(col(state, "yard"), l.pileId), pr = p ? byId(state.products, p.productId) : null, q = Number(l.qty) || 0;
        const dist = p ? distance(state, p) : null, perCycle = Math.max(0.01, P.bucketM3 * P.fill), c = Math.ceil(q / perCycle - 1e-9);
        const travel = dist === null ? 0 : 2 * dist / (P.speedKmh / 3.6);
        mp += q; cycles += c; sec += c * (P.cycleSec + travel); route += dist === null ? 0 : c * 2 * dist;
        if (pr) { tons += Units.mass(q, pr, cfg); m3 += Units.toM3(q, pr.unit, pr, cfg); }
        return { order: i + 1, pileId: l.pileId, no: p ? p.no : "?", name: p ? p.name : "", qty: q, dist, cycles: c, before: p ? Number(p.qty) || 0 : 0, after: p ? rq((Number(p.qty) || 0) - q) : 0 };
      });
      const wagons = P.wagons || Math.ceil(mp / P.wagonMP - 1e-9), need = train ? Number(train.reqQty) || 0 : 0;
      const timeMin = rq((sec / Math.max(1, P.loaders) + Math.max(0, lines.length - 1) * P.switchMin * 60) / 60);
      return { rows, mp: rq(mp), m3: rq(m3), t: rq(tons), wagons, perWagon: wagons ? rq(mp / wagons) : 0, cycles, timeMin, routeM: Math.round(route), piles: lines.length, need, shortage: rq(Math.max(0, need - mp)), surplus: rq(Math.max(0, mp - need)), estimated: true };
    },
    /** Zapis projektu symulacji (wariantu). args: id?, trainId, name, strategy, lines [{ pileId, qty }], params */
    savePlan(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user;
      if (!can(user, "load.run")) return deny(t("Symulację i realizację załadunku prowadzi osoba z uprawnieniem „Załadunek pociągu — symulacja i realizacja”"));
      const old = a.id ? byId(col(state, "loadPlans"), a.id) : null;
      if (a.id && !old) return { ok: false, error: t("Nie znaleziono planu załadunku") };
      const train = byId(col(state, "trains"), old ? old.trainId : str(a.trainId));
      if (!train) return { ok: false, error: t("Wybierz pociąg z terminarza") };
      const w = whOk(state, user, train.whId); if (!w.ok) return w;
      if (!trainActive(train)) return { ok: false, error: t("Pociąg jest zakończony albo anulowany") };
      if (old && old.status !== "DRAFT") {
        if (old.status !== "APPROVED") return { ok: false, error: t("Planu w realizacji albo zakończonego nie można zmienić") };
        if (!can(user, "trains.edit")) return deny(t("Zmiana zatwierdzonego planu wymaga uprawnienia „Terminarz pociągów — planowanie i zatwierdzanie”"));
      }
      const strategy = str(a.strategy === undefined ? (old ? old.strategy : "manual") : a.strategy);
      if (!STRATEGIES[strategy]) return { ok: false, error: t("Nieznany wariant symulacji") };
      const pp = YardPlan.params(state, a.params === undefined ? (old ? old.params : {}) : a.params);
      const errors = Object.assign({}, pp.errors), src = a.lines === undefined ? (old ? old.lines : []) : a.lines, lines = [], seen = new Set();
      if (!Array.isArray(src) || !src.length) errors.lines = t("Plan załadunku musi mieć co najmniej jedną pryzmę");
      const res = reserved(state, old ? old.id : null); let prod = null;
      for (const l of Array.isArray(src) ? src : []) {
        const p = piles(state, train.whId).find(x => x.id === (l && l.pileId)), q = num(l && l.qty, 0.01, 1e7), k = "line:" + (l && l.pileId);
        if (!p) { errors[k] = t("Pryzma spoza magazynu pociągu"); continue; }
        if (seen.has(p.id)) { errors[k] = t("Pryzma {no} powtórzona w planie", { no: p.no }); continue; } seen.add(p.id);
        if (p.status !== "AVAILABLE") { errors[k] = t("Pryzma {no} jest zablokowana albo wyłączona", { no: p.no }); continue; }
        if (!fits(train, p, state)) { errors[k] = t("Pryzma {no}: inny rodzaj biomasy niż w zamówieniu pociągu", { no: p.no }); continue; }
        if (prod && prod !== p.productId) { errors[k] = t("Jeden plan = jeden rodzaj biomasy (jeden dokument WZ) — pryzma {no} ma inny produkt", { no: p.no }); continue; } prod = p.productId;
        if (!q.ok) { errors[k] = t("Pryzma {no}: podaj ilość do pobrania (większą od zera)", { no: p.no }); continue; }
        const free = rq((Number(p.qty) || 0) - (old && old.status === "APPROVED" ? res.get(p.id) || 0 : 0));
        if (q.value > free + EPS) { errors[k] = t("Pryzma {no}: dostępne {a} MP, w planie {b} MP", { no: p.no, a: R.fmtQ(free), b: R.fmtQ(q.value) }); continue; }
        lines.push({ pileId: p.id, qty: q.value });
      }
      if (Object.keys(errors).length) return { ok: false, errors, error: Object.values(errors)[0] };
      const n = plansOf(state, train.id).length + 1;
      const rec = Object.assign({}, old || { id: uid("lp"), trainId: train.id, whId: train.whId, status: "DRAFT", createdAt: nowOf(ctx), createdBy: user.name },
        { name: str(a.name === undefined ? (old ? old.name : "") : a.name).slice(0, 60) || t("Wariant {n}", { n }), strategy, lines, params: pp.params, productId: prod, updatedAt: nowOf(ctx), updatedBy: user.name });
      put(state, "loadPlans", rec); state.rev += 1;
      const c = YardPlan.calc(state, train, lines, pp.params);
      log(state, ctx, train.whId, rec.id, train.no, old ? N_("Symulacja załadunku — zmiana projektu") : N_("Symulacja załadunku — zapis projektu"), old ? { wariant: old.name, MP: old.lines.reduce((s, l) => s + l.qty, 0) } : null, { wariant: rec.name, pryzmy: c.piles, MP: c.mp, wagony: c.wagons, czas_min: c.timeMin });
      return { ok: true, plan: rec, calc: c };
    },
    removePlan(state, args, ctx) {
      const user = ctx && ctx.user, old = byId(col(state, "loadPlans"), args && args.id);
      if (!can(user, "load.run")) return deny(t("Symulację i realizację załadunku prowadzi osoba z uprawnieniem „Załadunek pociągu — symulacja i realizacja”"));
      if (!old) return { ok: false, error: t("Nie znaleziono planu załadunku") };
      const w = whOk(state, user, old.whId); if (!w.ok) return w;
      if (old.status !== "DRAFT" && old.status !== "CANCELLED") return { ok: false, error: t("Usunąć można tylko projekt symulacji — zatwierdzony plan najpierw cofnij") };
      drop(state, "loadPlans", old.id); state.rev += 1;
      log(state, ctx, old.whId, old.id, (byId(col(state, "trains"), old.trainId) || {}).no, N_("Symulacja załadunku — usunięcie projektu"), { wariant: old.name }, null);
      return { ok: true };
    },
    /** Zmiana stanu planu: approve | unapprove | handover | start | pause | resume. */
    planAction(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user, old = byId(col(state, "loadPlans"), a.id), act = str(a.action);
      if (!old) return { ok: false, error: t("Nie znaleziono planu załadunku") };
      const train = byId(col(state, "trains"), old.trainId), w = whOk(state, user, old.whId); if (!w.ok) return w;
      const needPerm = act === "approve" || act === "unapprove" ? "trains.edit" : "load.run";
      if (!can(user, needPerm)) return deny(needPerm === "trains.edit" ? t("Zatwierdzenie i cofnięcie planu wymaga uprawnienia „Terminarz pociągów — planowanie i zatwierdzanie”") : t("Symulację i realizację załadunku prowadzi osoba z uprawnieniem „Załadunek pociągu — symulacja i realizacja”"));
      if (!train || !trainActive(train)) return { ok: false, error: t("Pociąg jest zakończony albo anulowany") };
      const ts = nowOf(ctx); let rec, tStatus = train.status, action;
      if (act === "approve") {
        if (old.status !== "DRAFT") return { ok: false, error: t("Zatwierdzić można tylko projekt symulacji") };
        if (plansOf(state, train.id).some(p => p.id !== old.id && RESERVING.includes(p.status))) return { ok: false, error: t("Pociąg {no} ma już zatwierdzony plan załadunku — najpierw cofnij jego zatwierdzenie", { no: train.no }) };
        // rezerwacja: kontrola w tej samej transakcji co zapis — ta sama ilość nie trafi do dwóch pociągów
        const res = reserved(state, old.id);
        for (const l of old.lines) {
          const p = piles(state, old.whId).find(x => x.id === l.pileId);
          if (!p || p.status !== "AVAILABLE") return { ok: false, code: "RESERVE", error: t("Pryzma z planu jest niedostępna — odśwież symulację") };
          const free = rq((Number(p.qty) || 0) - (res.get(p.id) || 0));
          if (l.qty > free + EPS) return { ok: false, code: "RESERVE", error: t("Pryzma {no}: do rezerwacji dostępne {a} MP (reszta zarezerwowana dla innego pociągu), plan wymaga {b} MP", { no: p.no, a: R.fmtQ(Math.max(0, free)), b: R.fmtQ(l.qty) }) };
        }
        rec = Object.assign({}, old, { status: "APPROVED", approvedAt: ts, approvedBy: user.name }); action = N_("Plan załadunku — zatwierdzenie (rezerwacja biomasy)");
        if (["PLANNED", "WAITING", "DELAYED"].includes(tStatus)) tStatus = "PREPARING";
      } else if (act === "unapprove") {
        if (old.status !== "APPROVED") return { ok: false, error: t("Cofnąć można tylko zatwierdzony plan przed rozpoczęciem załadunku") };
        rec = Object.assign({}, old, { status: "DRAFT", approvedAt: null, approvedBy: null, handedAt: null }); action = N_("Plan załadunku — cofnięcie zatwierdzenia (zwolnienie rezerwacji)");
        if (["PREPARING", "READY"].includes(tStatus)) tStatus = "PLANNED";
      } else if (act === "handover") {
        if (old.status !== "APPROVED") return { ok: false, error: t("Operatorowi przekazuje się zatwierdzony plan") };
        rec = Object.assign({}, old, { handedAt: ts, handedBy: user.name }); action = N_("Plan załadunku — przekazanie operatorowi ładowarki"); tStatus = "READY";
      } else if (act === "start") {
        if (old.status !== "APPROVED") return { ok: false, error: t("Załadunek rozpoczyna się z zatwierdzonego planu") };
        rec = Object.assign({}, old, { status: "RUNNING", actual: { startedAt: ts, startedBy: user.name, lines: old.lines.map(l => ({ pileId: l.pileId, qty: 0, done: false })), wagons: [], events: [{ ts, type: "start", by: user.name }] } });
        action = N_("Załadunek — rozpoczęcie"); tStatus = "LOADING";
      } else if (act === "pause" || act === "resume") {
        if (old.status !== (act === "pause" ? "RUNNING" : "PAUSED")) return { ok: false, error: act === "pause" ? t("Wstrzymać można załadunek w toku") : t("Wznowić można wstrzymany załadunek") };
        rec = Object.assign({}, old, { status: act === "pause" ? "PAUSED" : "RUNNING", actual: Object.assign({}, old.actual, { events: old.actual.events.concat({ ts, type: act, by: user.name, note: str(a.note).slice(0, 200) }) }) });
        action = act === "pause" ? N_("Załadunek — wstrzymanie") : N_("Załadunek — wznowienie");
      } else return { ok: false, error: t("Nieznana czynność planu") };
      put(state, "loadPlans", rec);
      if (tStatus !== train.status) put(state, "trains", Object.assign({}, train, { status: tStatus, updatedAt: ts }));
      state.rev += 1;
      log(state, ctx, old.whId, old.id, train.no, action, { status: old.status }, { status: rec.status, wariant: rec.name, MP: rec.lines.reduce((s, l) => s + l.qty, 0) });
      return { ok: true, plan: rec };
    },
    /** Realizacja: rzeczywiście pobrane ilości z pryzm i ilości załadowane do wagonów. args: id, lines [{ pileId, qty, done }], wagons [{ no, qty }] */
    record(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user, old = byId(col(state, "loadPlans"), a.id);
      if (!can(user, "load.run")) return deny(t("Symulację i realizację załadunku prowadzi osoba z uprawnieniem „Załadunek pociągu — symulacja i realizacja”"));
      if (!old) return { ok: false, error: t("Nie znaleziono planu załadunku") };
      const w = whOk(state, user, old.whId); if (!w.ok) return w;
      if (old.status !== "RUNNING" && old.status !== "PAUSED") return { ok: false, error: t("Ilości wpisuje się podczas załadunku") };
      const errors = {}, lines = old.actual.lines.map(x => Object.assign({}, x)); let wagons = old.actual.wagons;
      for (const l of Array.isArray(a.lines) ? a.lines : []) {
        const cur = lines.find(x => x.pileId === (l && l.pileId)), p = cur && byId(col(state, "yard"), cur.pileId);
        if (!cur) continue;
        if (l.qty !== undefined) { const q = num(l.qty, 0, 1e7); if (!q.ok) errors["line:" + cur.pileId] = t("Ilość pobrana: liczba ≥ 0"); else if (p && q.value > (Number(p.qty) || 0) + EPS) errors["line:" + cur.pileId] = t("Pryzma {no}: pobrano więcej ({a} MP), niż jest w pryzmie ({b} MP)", { no: p.no, a: R.fmtQ(q.value), b: R.fmtQ(p.qty) }); else cur.qty = q.value; }
        if (l.done !== undefined) cur.done = !!l.done;
      }
      if (Array.isArray(a.wagons)) {
        if (a.wagons.length > 200) errors.wagons = t("Za dużo wagonów");
        wagons = a.wagons.map((x, i) => { const q = num(x && x.qty, 0, 1e5); if (!q.ok) errors["wagon:" + i] = t("Wagon {n}: ilość ≥ 0", { n: i + 1 }); return { no: str(x && x.no).slice(0, 30) || String(i + 1), qty: q.ok ? q.value : 0 }; });
      }
      if (Object.keys(errors).length) return { ok: false, errors, error: Object.values(errors)[0] };
      const rec = Object.assign({}, old, { actual: Object.assign({}, old.actual, { lines, wagons, updatedAt: nowOf(ctx), updatedBy: user.name }) });
      if (JSON.stringify(rec.actual.lines) === JSON.stringify(old.actual.lines) && JSON.stringify(wagons) === JSON.stringify(old.actual.wagons)) return { ok: false, code: "NOCHANGE", error: t("Brak zmian do zapisania") };
      put(state, "loadPlans", rec); state.rev += 1;
      log(state, ctx, old.whId, old.id, (byId(col(state, "trains"), old.trainId) || {}).no, N_("Załadunek — zapis pobranych ilości"), { MP: old.actual.lines.reduce((s, l) => s + l.qty, 0) }, { MP: lines.reduce((s, l) => s + l.qty, 0), wagony: wagons.length });
      return { ok: true, plan: rec };
    },
    /** Postęp realizacji: plan, wykonanie, różnica, pozostało, procent. */
    progress(plan) {
      const planned = rq(plan.lines.reduce((s, l) => s + l.qty, 0)), A = plan.actual, done = A ? rq(A.lines.reduce((s, l) => s + (l.qty || 0), 0)) : 0;
      return { planned, done, diff: rq(done - planned), left: rq(Math.max(0, planned - done)), pct: planned > EPS ? Math.min(100, Math.round(done / planned * 100)) : 0, wagons: A ? rq(A.wagons.reduce((s, x) => s + x.qty, 0)) : 0 };
    },
    /**
     * Zakończenie załadunku: dokument WZ (zwykła operacja sprzedaży — ta sama logika, numeracja i księga co formularz),
     * zmniejszenie pryzm o rzeczywiście pobrane ilości, zamknięcie planu i pociągu.
     * args: id, price (zł/MP), weightT (tonaż z ważenia), date (opcjonalnie — domyślnie dziś)
     */
    finish(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user, old = byId(col(state, "loadPlans"), a.id);
      if (!can(user, "load.run")) return deny(t("Symulację i realizację załadunku prowadzi osoba z uprawnieniem „Załadunek pociągu — symulacja i realizacja”"));
      if (!old) return { ok: false, error: t("Nie znaleziono planu załadunku") };
      const w = whOk(state, user, old.whId); if (!w.ok) return w;
      if (old.status !== "RUNNING" && old.status !== "PAUSED") return { ok: false, error: t("Zakończyć można załadunek w toku") };
      const train = byId(col(state, "trains"), old.trainId), pr = byId(state.products, old.productId);
      const used = old.actual.lines.filter(l => l.qty > EPS), total = rq(used.reduce((s, l) => s + l.qty, 0));
      if (!(total > EPS)) return { ok: false, error: t("Wpisz rzeczywiście pobrane ilości z pryzm — bez nich nie powstanie dokument WZ") };
      for (const l of used) { const p = byId(col(state, "yard"), l.pileId); if (!p || l.qty > (Number(p.qty) || 0) + EPS) return { ok: false, error: t("Pryzma {no}: pobrano więcej, niż jest w pryzmie", { no: p ? p.no : "?" }) }; }
      const price = num(a.price, 0, 1e6), weight = num(a.weightT, 0.001, 1e6), errors = {};
      if (!price.ok) errors.price = t("Podaj cenę sprzedaży [zł/MP]");
      if (!weight.ok) errors.weightT = t("Podaj tonaż załadunku z ważenia [t]");
      const date = str(a.date) || todayOf(ctx); if (!Dates.isISO(date)) errors.date = t("Data dokumentu: RRRR-MM-DD");
      if (Object.keys(errors).length) return { ok: false, errors, error: Object.values(errors)[0] };
      const d = R.blankDraft({ today: date });
      d.date = date; d.type = "SPRZEDAZ"; d.idemKey = "load-" + old.id;
      Object.assign(d.sale, { productId: pr.id, qty: String(total).replace(".", ","), unit: pr.unit, buyerId: train.buyerId, price: String(price.value).replace(".", ","), weightMode: "manual", weightManual: String(weight.value).replace(".", ",") });
      d.transport.mode = "none"; d.transport.place = train.recipient || "";
      d.notes = t("Załadunek pociągu {no} — plan „{p}”, pryzmy: {l}", { no: train.no, p: old.name, l: used.map(l => `${(byId(col(state, "yard"), l.pileId) || {}).no} ${R.fmtQ(l.qty)} MP`).join(", ") }).slice(0, 480);
      // operacja księgowana w magazynie planu (niezależnie od magazynu roboczego użytkownika — dostęp sprawdzony wyżej)
      const res = R.commitOperation(state, d, Object.assign({}, ctx, { user: Object.assign({}, user, { whId: old.whId }), source: N_("Załadunek pociągu") }));
      if (!res.ok) return { ok: false, error: t("Dokument WZ nie powstał: {e}", { e: res.error }), plan: res.plan };
      const ts = nowOf(ctx);
      for (const l of used) { const p = byId(col(state, "yard"), l.pileId); put(state, "yard", Object.assign({}, p, { qty: rq((Number(p.qty) || 0) - l.qty), trainId: p.trainId === train.id ? "" : p.trainId, updatedAt: ts, updatedBy: user.name })); }
      const rec = put(state, "loadPlans", Object.assign({}, old, { status: "DONE", opId: res.op.id, opNo: res.op.no, actual: Object.assign({}, old.actual, { endedAt: ts, endedBy: user.name, weightT: weight.value, price: price.value, events: old.actual.events.concat({ ts, type: "finish", by: user.name }) }) }));
      put(state, "trains", Object.assign({}, train, { status: "DONE", updatedAt: ts, loadedQty: total, loadedT: weight.value, opNo: res.op.no }));
      for (const p of plansOf(state, train.id)) if (p.id !== old.id && p.status === "DRAFT") put(state, "loadPlans", Object.assign({}, p, { status: "CANCELLED", cancelledAt: ts }));
      const pg = YardPlan.progress(rec);
      log(state, ctx, old.whId, old.id, train.no, N_("Załadunek — zakończenie (dokument WZ, aktualizacja pryzm)"), { plan_MP: pg.planned }, { zaladowano_MP: pg.done, roznica_MP: pg.diff, tonaz: weight.value, dokument: res.op.no }, res.op.no);
      return { ok: true, plan: rec, op: res.op, no: res.op.no };
    }
  };

  R.YardPlan = YardPlan;
  if (typeof module !== "undefined" && module.exports) module.exports = YardPlan;
})(typeof globalThis !== "undefined" ? globalThis : this);
