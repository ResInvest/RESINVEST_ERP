/* =========================================================================
   ResInvest ERP Serwer — ogranicznik zdarzeń w oknie czasu (logowania z adresu, wysyłka e-mail).
   Okno przesuwne: liczy zdarzenia z ostatnich `minutes` minut dla klucza; przekroczenie `max` → true.
   ========================================================================= */
export function createWindowLimiter() {
  const hits = new Map();
  return {
    /** Rejestruje zdarzenie i zwraca true, gdy w oknie jest ich więcej niż `max`. */
    hit(key, max, minutes) {
      const now = Date.now(), win = minutes * 60000, arr = (hits.get(key) || []).filter(x => now - x < win);
      arr.push(now); hits.set(key, arr);
      return arr.length > max;
    },
    /** Usuwa klucze bez zdarzeń w oknie (wywoływane okresowo — pamięć nie rośnie z liczbą adresów). */
    prune(minutes) {
      const now = Date.now(), win = minutes * 60000;
      for (const [k, arr] of hits) { const live = arr.filter(x => now - x < win); if (live.length) hits.set(k, live); else hits.delete(k); }
    },
    size() { return hits.size; }
  };
}
