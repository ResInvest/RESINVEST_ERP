/* =========================================================================
   ResInvest ERP 3.15 — warstwa S: stany początkowe magazynów (silnik)

   Edytor stanów początkowych: administrator wpisuje stan każdego produktu w magazynie
   (RiC Zabrze, RiC Brąszewice, RiC Rokitki i każdy inny aktywny magazyn) przy przenoszeniu
   danych do programu. Zapis korzysta z istniejącego dokumentu „Bilans otwarcia” (BO):
   ta sama numeracja, te same wpisy księgi i ten sam audyt co dotychczas (R.openingBalance).

   Zasady:
     * wartość w edytorze = SUMA wpisów BO danego produktu w magazynie („stan początkowy”),
     * zapis jest przyrostowy: nowy dokument BO zawiera tylko różnice (nowa wartość − dotychczasowa suma BO);
       wcześniejsze dokumenty nie są zmieniane ani usuwane — historia zostaje kompletna,
     * stan magazynu po zmianie nie może być ujemny, data nie może być w zamkniętym okresie ani w przyszłości,
     * ilości w jednostce magazynowej produktu (MP, m³, t), zaokrąglenie jak w całym programie (R.rq).
   Moduł działa w przeglądarce i w Node (serwer, testy).
   ========================================================================= */
(function (root) {
  "use strict";
  const R = root.RIW || (typeof require === "function" ? require("./engine.js") : null);
  const { rq, EPS, Dates, NumParse, byId, can, canAccessWh, Stock, isLocked, lockedMonth } = R;
  const t = (s, p) => R.I18N.t(s, p);
  const N_ = s => s;
  const str = v => String(v == null ? "" : v).trim();
  /** Największa ilość jednej pozycji (ochrona przed pomyłką o kilka rzędów wielkości). */
  const MAX_QTY = 1e8;
  const SOURCE = N_("Edytor stanów początkowych");

  const Opening = {
    MAX_QTY,
    /** Suma wpisów BO w magazynie: Map productId → ilość (jedno przejście księgi). */
    totals(state, whId) {
      const m = new Map();
      for (const l of state.ledger || []) if (l.whId === whId && l.kind === "BO") m.set(l.productId, rq((m.get(l.productId) || 0) + l.qty));
      return m;
    },
    /** Dokumenty BO magazynu (numer, data, liczba pozycji) — od najnowszego. */
    documents(state, whId) {
      const by = new Map();
      for (const l of state.ledger || []) {
        if (l.whId !== whId || l.kind !== "BO") continue;
        const d = by.get(l.docNo) || { no: l.docNo, date: l.date, lines: 0 };
        d.lines++; by.set(l.docNo, d);
      }
      return [...by.values()].sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (a.no < b.no ? 1 : -1));
    },
    /** Arkusz edytora dla magazynu: aktywne produkty (oraz nieaktywne z niezerowym BO) z BO i stanem bieżącym. */
    sheet(state, whId) {
      const bo = this.totals(state, whId), now = Stock.byProduct(state, whId);
      return (state.products || []).filter(p => p.active !== false || Math.abs(bo.get(p.id) || 0) > EPS).map(p => ({
        productId: p.id, name: p.name, code: p.code, unit: p.unit, active: p.active !== false,
        opening: bo.get(p.id) || 0, current: now.get(p.id) || 0
      }));
    },
    /**
     * Zapis stanów początkowych magazynu. args: { whId, date, lines: [{ productId, qty }] } — qty: liczba albo tekst
     * („1 234,5”). Puste pole = bez zmiany. Wynik: { ok, no, changes: [{ productId, before, after, delta }] }
     * albo { ok:false, error, errors, code }.
     */
    save(state, args, ctx) {
      const a = args || {}, user = ctx && ctx.user;
      if (!can(user, "warehouses.edit")) return { ok: false, code: "FORBIDDEN", error: t("Stany początkowe wpisuje administrator (uprawnienie „Magazyny — dodawanie i edycja”)") };
      const whId = str(a.whId), wh = byId(state.warehouses, whId);
      if (!wh) return { ok: false, error: t("Wybierz magazyn"), errors: { whId: t("Wybierz magazyn") } };
      if (wh.active === false) return { ok: false, error: t("Magazyn jest nieaktywny"), errors: { whId: t("Magazyn jest nieaktywny") } };
      if (!canAccessWh(user, whId)) return { ok: false, code: "FORBIDDEN", error: t("Brak dostępu do magazynu {w}", { w: wh.name }) };
      const date = str(a.date), today = (ctx && ctx.today) || Dates.localToday();
      if (!Dates.isISO(date)) return { ok: false, error: t("Podaj datę stanu początkowego"), errors: { date: t("Podaj datę stanu początkowego") } };
      if (date > today) return { ok: false, error: t("Data stanu początkowego nie może być w przyszłości"), errors: { date: t("Data stanu początkowego nie może być w przyszłości") } };
      if (isLocked(state, whId, date)) {
        const e = t("Okres {ym} jest zamknięty — stan początkowy wpisz z datą po zamknięciu albo popraw inwentaryzacją", { ym: lockedMonth(state, whId) });
        return { ok: false, code: "LOCKED", error: e, errors: { date: e } };
      }
      const lines = Array.isArray(a.lines) ? a.lines : [];
      if (lines.length > 2000) return { ok: false, error: t("Za dużo pozycji") };
      const bo = this.totals(state, whId), errors = {}, changes = [], seen = new Set();
      for (const ln of lines) {
        const pid = str(ln && ln.productId), p = byId(state.products, pid);
        if (!p) { errors["p:" + pid] = t("Nieznany produkt"); continue; }
        if (seen.has(pid)) { errors["p:" + pid] = t("Produkt powtórzony na liście"); continue; }
        seen.add(pid);
        const raw = ln.qty;
        if (raw === "" || raw == null) continue;                       // puste pole = bez zmiany
        const n = NumParse.parse(raw);
        if (!n.ok) { errors["p:" + pid] = n.error; continue; }
        const after = rq(n.value);
        if (after < 0) { errors["p:" + pid] = t("Stan początkowy nie może być ujemny"); continue; }
        if (after > MAX_QTY) { errors["p:" + pid] = t("Za duża ilość"); continue; }
        const before = bo.get(pid) || 0, delta = rq(after - before);
        if (Math.abs(delta) <= EPS) continue;
        if (delta < 0 && rq(Stock.balance(state, whId, pid) + delta) < -EPS)
          { errors["p:" + pid] = t("Stan bieżący byłby ujemny — część stanu początkowego została już wydana. Popraw inwentaryzacją."); continue; }
        if (p.active === false && after > EPS) { errors["p:" + pid] = t("Produkt jest nieaktywny"); continue; }
        changes.push({ productId: pid, before, after, delta });
      }
      if (Object.keys(errors).length) return { ok: false, errors, error: t("Popraw zaznaczone pozycje") };
      if (!changes.length) return { ok: false, code: "NOCHANGE", error: t("Brak zmian do zapisania") };
      // numer BO: w jednej serii WZ licznik przesuwany za numery już zajęte w magazynie i roku (np. numer WZ wpisany
      // ręcznie) — ta sama zasada co przy numerze z formularza operacji (autoNo); openingBalance nadaje kolejny numer
      if (R.unifiedNumbering(state)) {
        const series = R.DOC_SERIES, ym = Dates.ym(date), key = `${series}-${ym}`;
        const fmtNo = n => `${series}/${String(n).padStart(3, "0")}/${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
        for (let guard = 0; guard < 1000 && R.docNoTaken(state, "BO", whId, date.slice(0, 4), fmtNo((state.seq[key] || 0) + 1)); guard++) state.seq[key] = (state.seq[key] || 0) + 1;
      }
      const c = Object.assign({}, ctx, { source: SOURCE });
      const no = R.openingBalance(state, whId, date, changes.map(x => ({ productId: x.productId, qty: x.delta })), c);
      // szczegóły zmian w tym samym wpisie audytu, który utworzył dokument BO (przed → po dla każdego produktu)
      const rec = state.audit[state.audit.length - 1];
      if (rec && rec.opNo === no) rec.after = Object.assign({}, rec.after, { data: date, zmiany: changes.map(x => ({ produkt: (byId(state.products, x.productId) || {}).name || x.productId, przed: x.before, po: x.after })) });
      return { ok: true, no, whId, date, changes };
    }
  };

  R.Opening = Opening;
  if (typeof module !== "undefined" && module.exports) module.exports = Opening;
})(typeof globalThis !== "undefined" ? globalThis : this);
