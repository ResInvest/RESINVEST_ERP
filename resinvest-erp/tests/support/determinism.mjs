/* Testy: deterministyczny zegar i generator liczb — MUSI być zaimportowany przed server/core.mjs.
   Identyfikatory rekordów silnika powstają z Date.now() i Math.random(); przy ustalonym zegarze i ziarnie
   ten sam scenariusz daje bajt w bajt ten sam stan, dziennik i sumy kontrolne — niezależnie od silnika bazy. */
const RealDate = Date;
let now = RealDate.UTC(2026, 10, 9, 7, 0, 0);
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(now += 1000); else super(...a); }
  static now() { return now += 1000; }
}
globalThis.Date = FakeDate;
let seed = 0x2f6e2b1;
Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
export const realNow = () => RealDate.now();
