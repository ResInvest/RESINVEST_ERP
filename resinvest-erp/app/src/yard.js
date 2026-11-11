/* =========================================================================
   ResInvest ERP 3.15 — warstwa S: plac składowy zrębki (silnik)

   Wizualizacja placu na pulpicie: zdjęcie placu z oznaczeniami
     * pryzma przeznaczona na pociąg (obszar zielony — np. „Pryzma Fortum”),
     * czoło pryzmy — linia, od której ładuje się pociąg (wzdłuż toru),
     * punkty poboru próbek P1…Pn przy czole,
     * pozostała pryzma zrębki RiC.
   Układ (współrzędne w pikselach zdjęcia), wymiary pryzmy i ilość przygotowaną pod załadunek zapisuje
   administrator (komenda „yard.save”, uprawnienie „Magazyny — dodawanie i edycja”) — w konfiguracji firmy
   (state.config.yard), z wpisem audytu. Ilości zrębki — wyłącznie z księgi magazynowej (bez osobnych stanów).
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  const { rq, EPS, byId, can, canAccessWh, Stock, NumParse } = R;
  const t = (s, p) => R.I18N.t(s, p);
  const N_ = s => s;

  /** Układ domyślny dopasowany do zdjęcia placu RiC Zabrze, ul. Gwarecka 16 (1600 × 1072 px). */
  const DEFAULT = Object.freeze({
    whId: "wh_zab", w: 1600, h: 1072,
    trainName: "Pryzma Fortum",
    train: [[255, 405], [1055, 305], [1115, 485], [290, 595]],           // czoło-lewy, czoło-prawy, tył-prawy, tył-lewy
    front: [[215, 410], [1095, 300]],                                      // czoło pryzmy = miejsce ładowania pociągu (wzdłuż toru, poza narożnikami)
    points: [[305, 405], [485, 382], [665, 357], [815, 340], [980, 320]],  // P1…P5 (od czoła)
    ric: [[330, 600], [1030, 512], [1060, 1072], [120, 1072]],            // pryzma zrębki RiC
    dims: { len: 60, wid: 15, hei: 5 },
    reservedMP: null                                                       // null = cała pojemność pryzmy (nie więcej niż stan)
  });
  const MAX_POINTS = 12, MAX_DIM = 1000, MAX_MP = 1e7;

  const clonePt = a => a.map(p => [p[0], p[1]]);
  function current(state) {
    const y = state && state.config && state.config.yard;
    const d = DEFAULT;
    if (!y || typeof y !== "object") return { whId: d.whId, w: d.w, h: d.h, trainName: d.trainName, train: clonePt(d.train), front: clonePt(d.front), points: clonePt(d.points), ric: clonePt(d.ric), dims: Object.assign({}, d.dims), reservedMP: d.reservedMP, custom: false };
    return Object.assign({ custom: true }, { whId: y.whId || d.whId, w: d.w, h: d.h, trainName: y.trainName || d.trainName, train: clonePt(y.train || d.train), front: clonePt(y.front || d.front),
      points: clonePt(y.points || d.points), ric: clonePt(y.ric || d.ric), dims: Object.assign({}, d.dims, y.dims || {}), reservedMP: y.reservedMP === undefined ? d.reservedMP : y.reservedMP });
  }

  /** Zrębka (produkty kategorii „zrebka”, jednostka MP) w magazynie placu — z księgi. */
  function chipStock(state, whId) {
    const by = Stock.byProduct(state, whId), list = [];
    let total = 0;
    for (const p of state.products || []) if (p.cat === "zrebka" && p.unit === "MP") { const q = by.get(p.id) || 0; if (Math.abs(q) > EPS) { list.push({ productId: p.id, name: p.name, qty: q }); total = rq(total + q); } }
    return { total, list };
  }

  /** Statystyka placu: pojemność pryzmy (przekrój trójkątny jak na szkicu), przygotowane pod pociąg, wagony, reszta. */
  function stats(state, yard) {
    const y = yard || current(state), cfg = state.config || {};
    const cap = rq(0.5 * y.dims.wid * y.dims.hei * y.dims.len);                // m³ nasypowe ≈ MP zrębki
    const st = chipStock(state, y.whId);
    const want = y.reservedMP === null || y.reservedMP === undefined ? cap : y.reservedMP;
    const reserved = rq(Math.max(0, Math.min(want, cap, Math.max(0, st.total))));
    const wagon = cfg.wagonMPDefault > 0 ? cfg.wagonMPDefault : 120;
    return {
      capacity: cap, stock: st.total, products: st.list, reserved, wanted: want,
      fill: cap > EPS ? Math.min(1, reserved / cap) : 0,
      short: rq(Math.max(0, Math.min(want, cap) - reserved)),                  // brakuje zrębki do zaplanowanej ilości
      wagons: Math.ceil(reserved / wagon - 1e-9), wagonMP: wagon,
      remaining: rq(Math.max(0, st.total - reserved))
    };
  }

  const ptOk = (p, y) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && p[0] >= 0 && p[1] >= 0 && p[0] <= y.w && p[1] <= y.h;
  const roundPt = p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
  function numIn(v, lo, hi) {
    if (v === "" || v === null || v === undefined) return { ok: true, value: null };
    const n = typeof v === "number" ? { ok: Number.isFinite(v), value: v } : NumParse.parse(v);
    if (!n.ok || !(n.value >= lo && n.value <= hi)) return { ok: false };
    return { ok: true, value: rq(n.value) };
  }

  const Yard = {
    DEFAULT, current, stats, chipStock,
    /**
     * Zapis układu placu. args: { train, front, points, ric (współrzędne), dims {len,wid,hei}, reservedMP, trainName, whId }
     * — pola pominięte zostają bez zmian; { reset: true } przywraca układ domyślny.
     */
    save(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user;
      if (!can(user, "warehouses.edit")) return { ok: false, code: "FORBIDDEN", error: t("Układ placu zmienia administrator (uprawnienie „Magazyny — dodawanie i edycja”)") };
      const before = current(state);
      if (a.reset) {
        if (!before.custom) return { ok: false, code: "NOCHANGE", error: t("Brak zmian do zapisania") };
        delete state.config.yard; state.rev += 1;
        R.audit(state, ctx, { entity: "system", entityId: "yard", opNo: "—", event: "settings", action: N_("Plac składowy — przywrócono układ domyślny"), before: { pryzma: before.trainName }, after: null, source: (ctx && ctx.source) || N_("Pulpit") });
        return { ok: true, yard: current(state) };
      }
      const y = current(state), errors = {};
      const whId = a.whId === undefined ? y.whId : String(a.whId);
      const wh = byId(state.warehouses, whId);
      if (!wh) errors.whId = t("Wybierz magazyn");
      else if (!canAccessWh(user, whId)) return { ok: false, code: "FORBIDDEN", error: t("Brak dostępu do magazynu {w}", { w: wh.name }) };
      for (const k of ["train", "ric"]) if (a[k] !== undefined) {
        if (!Array.isArray(a[k]) || a[k].length !== 4 || !a[k].every(p => ptOk(p, y))) errors[k] = t("Obszar to cztery narożniki w granicach zdjęcia");
        else y[k] = a[k].map(roundPt);
      }
      if (a.front !== undefined) { if (!Array.isArray(a.front) || a.front.length !== 2 || !a.front.every(p => ptOk(p, y))) errors.front = t("Czoło pryzmy to dwa punkty w granicach zdjęcia"); else y.front = a.front.map(roundPt); }
      if (a.points !== undefined) { if (!Array.isArray(a.points) || a.points.length > MAX_POINTS || !a.points.every(p => ptOk(p, y))) errors.points = t("Punkty poboru próbek: najwyżej {n}, w granicach zdjęcia", { n: MAX_POINTS }); else y.points = a.points.map(roundPt); }
      if (a.dims !== undefined) {
        for (const k of ["len", "wid", "hei"]) {
          const n = numIn(a.dims && a.dims[k], 0.1, MAX_DIM);
          if (!n.ok || n.value === null) errors["dims." + k] = t("Wymiar pryzmy: liczba od 0,1 do {m} m", { m: MAX_DIM }); else y.dims[k] = n.value;
        }
      }
      if (a.reservedMP !== undefined) { const n = numIn(a.reservedMP, 0, MAX_MP); if (!n.ok) errors.reservedMP = t("Ilość pod załadunek: liczba MP ≥ 0 (puste = cała pryzma)"); else y.reservedMP = n.value; }
      if (a.trainName !== undefined) { const s = String(a.trainName || "").trim().replace(/\s+/g, " "); if (!s || s.length > 60) errors.trainName = t("Nazwa pryzmy: od 1 do 60 znaków"); else y.trainName = s; }
      if (Object.keys(errors).length) return { ok: false, errors, error: t("Popraw zaznaczone pola") };
      const next = { whId, trainName: y.trainName, train: y.train, front: y.front, points: y.points, ric: y.ric, dims: y.dims, reservedMP: y.reservedMP };
      const prev = state.config.yard ? JSON.stringify(state.config.yard) : JSON.stringify({ whId: before.whId, trainName: before.trainName, train: before.train, front: before.front, points: before.points, ric: before.ric, dims: before.dims, reservedMP: before.reservedMP });
      if (JSON.stringify(next) === prev) return { ok: false, code: "NOCHANGE", error: t("Brak zmian do zapisania") };
      state.config.yard = next; state.rev += 1;
      const st = stats(state);
      R.audit(state, ctx, { entity: "system", entityId: "yard", opNo: "—", event: "settings", action: N_("Plac składowy — układ i pryzma pod załadunek"),
        before: { pryzma: before.trainName, wymiary: before.dims, pod_zaladunek_MP: before.reservedMP }, after: { magazyn: wh.name, pryzma: next.trainName, wymiary: next.dims, pod_zaladunek_MP: st.reserved, pojemnosc_MP: st.capacity },
        source: (ctx && ctx.source) || N_("Pulpit") });
      return { ok: true, yard: current(state), stats: st };
    }
  };

  R.Yard = Yard;
  if (typeof module !== "undefined" && module.exports) module.exports = Yard;
})(typeof globalThis !== "undefined" ? globalThis : this);
