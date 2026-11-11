/* =========================================================================
   ResInvest ERP Serwer — widok stanu dla przeglądarki (warstwa aplikacji, bez HTTP).

   Stan wysyłany do przeglądarki — WYŁĄCZNIE widok użytkownika (izolacja magazynów, Service.project).
   Konta i hasła nie są częścią stanu.
   Widok jest zapamiętywany dla bieżącej rewizji: wielu pracowników odczytujących ten sam stan nie powoduje ponownego
   liczenia, zamiany na JSON ani kompresji (test obciążeniowy 3.9.1; od 3.10 — także synchronizacja samymi zmianami).
   Każda zmiana stanu (nowa rewizja) unieważnia pamięć.
   ========================================================================= */
import { VIEW } from "./respond.mjs";

export function createStateViews({ store, R, Service, ROWS }) {
  const viewCache = { rev: -1, today: "", map: new Map() };
  function viewEntry(userId) {
    const rev = store.state.rev, today = store.today();
    if (viewCache.rev !== rev || viewCache.today !== today) { R.applyRoles(store.state); viewCache.rev = rev; viewCache.today = today; viewCache.map.clear(); }
    let v = viewCache.map.get(userId);
    if (!v) { v = { proj: Service.project(store.state, { id: userId }), body: null, gz: null }; viewCache.map.set(userId, v); }
    return v;
  }
  function stateView(userId) {
    const v = viewEntry(userId);
    if (v.body === null) v.body = JSON.stringify({ state: v.proj, today: viewCache.today, rev: viewCache.rev }).slice(1, -1);   // wnętrze obiektu — doklejane bez ponownej serializacji
    return v;
  }
  /**
   * Synchronizacja samymi zmianami (3.10): przeglądarka podaje rewizję, którą ma (`since`); serwer odsyła rdzeń widoku
   * (kartoteki, konfiguracja — kilkanaście kB) i w kolekcjach tylko rekordy nowe / zmienione z ich pozycją w widoku
   * oraz identyfikatory usuniętych lub już niewidocznych. `n` — liczba rekordów kolekcji (kontrola po stronie klienta).
   * Brak historii zmian, zmiana kont / uprawnień / kolejności → null (pełny stan).
   */
  function deltaView(userId, since) {
    if (!Number.isInteger(since) || since < 0) return null;
    const ch = store.changesSince(since);
    if (!ch) return null;
    const v = viewEntry(userId), P = v.proj;
    if (!P) return null;
    const core = {}, colls = {};
    for (const k of Object.keys(P)) if (!ROWS.includes(k)) core[k] = P[k];
    for (const k of ROWS) {
      const up = ch.up[k], del = ch.del[k];
      if (!(up && up.size) && !(del && del.size)) continue;
      const arr = P[k] || [], ins = [], seen = new Set();
      if (up && up.size) for (let i = 0; i < arr.length; i++) { const id = String(arr[i].id); if (up.has(id)) { ins.push([i, arr[i]]); seen.add(id); } }
      const gone = del ? [...del] : [];
      if (up) for (const id of up) if (!seen.has(id)) gone.push(id);        // zmieniony, ale poza widokiem użytkownika
      colls[k] = { up: ins, del: gone, n: arr.length };
    }
    return { body: JSON.stringify({ delta: { since, core, colls }, today: viewCache.today, rev: viewCache.rev }).slice(1, -1), gz: null };
  }
  /** Odpowiedź z widokiem: pełny stan albo same zmiany od `since`. */
  const statePayload = (userId, since) => ({ [VIEW]: (since != null && deltaView(userId, since)) || stateView(userId) });
  return { stateView, deltaView, statePayload };
}
export const sinceOf = v => { const n = Number(v); return v !== undefined && v !== null && v !== "" && Number.isInteger(n) && n >= 0 ? n : null; };
