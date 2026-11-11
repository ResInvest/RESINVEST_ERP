/* Scenariusz regresyjny: pełny przekrój pracy magazynu przez te same komendy, których używa interfejs (/api/cmd).
   Każdy krok zwraca znormalizowany wynik; lista wyników + stan końcowy są porównywane między SQLite i PostgreSQL. */
export const TODAY = "2026-11-09";
export const ADMIN = { name: "Administrator Testowy", email: "magazyn@resinvest.group", password: "Test-Admin#2026" };

export function runScenario(store, R) {
  const out = [];
  const D = (date, over) => R.Seed.draftOf(date, over);
  const step = (name, userId, cmd, args) => {
    const r = store.execute(userId, cmd, args, "pl", { ip: "10.0.0.5", ua: "scenario" });
    const rec = { name, cmd, ok: !!r.ok, code: r.code || "", error: r.ok ? "" : String(r.error || JSON.stringify(r.errors || "")).slice(0, 160), no: (r.op && r.op.no) || r.no || "", id: (r.op && r.op.id) || (r.rec && r.rec.id) || "" };
    out.push(rec);
    return r;
  };
  // 1. zakup z produkcją w lesie i transportem własnym (PZ + kwit + kursy)
  const zak = step("zakup+produkcja", "u_mag", "op.commit", { draft: D(TODAY, {
    purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "24", unit: "m3", price: "235" },
    production: { enabled: true, type: "lesna", ndl: "Rudy Raciborskie", lesnictwo: "Stanica", kwit: "KW 0900/11/2026", chipperId: "ch_jenz" },
    transport: { mode: "own", place: "RiC Zabrze", own: { runCount: "2", runs: [
      { vehicleId: "ve_scania", driverId: "", km: "45", rate: "5", kwit: "KW 0900/1/11/2026", kwitM3: "12", qty: "48", weightT: "15,9" },
      { vehicleId: "ve_volvo", driverId: "", km: "45", rate: "5", kwit: "KW 0900/2/11/2026", kwitM3: "12", qty: "48", weightT: "16,1" }] } } }) });
  // 2. zakup towaru z transportem zewnętrznym
  step("zakup towar", "u_mag", "op.commit", { draft: D(TODAY, { purchase: { supplierId: "pa_drwal", basis: "DEKL", productId: "pr_zr_tow", qty: "60", unit: "MP", price: "56" },
    transport: { mode: "external", place: "RiC Zabrze", external: { company: "ESI Logistics", reg: "ESI 18734", km: "80", freight: "440" } } }) });
  // 3. sprzedaż z magazynu (WZ)
  const wz = step("sprzedaż WZ", "u_mag", "op.commit", { draft: D(TODAY, { type: "SPRZEDAZ",
    sale: { productId: "pr_zr_lesna", qty: "120", unit: "MP", buyerId: "pa_ec_zab", price: "91", weightMode: "manual", weightManual: "41,2" },
    transport: { mode: "external", place: "Elektrociepłownia Zabrze S.A.", external: { company: "DAP Trans", reg: "SZA 7K901", km: "12", freight: "300" } } }) });
  // 4. reguła magazynowa: sprzedaż ponad stan musi zostać odrzucona
  step("sprzedaż ponad stan (odmowa)", "u_mag", "op.commit", { draft: D(TODAY, { type: "SPRZEDAZ",
    sale: { productId: "pr_zr_inw", qty: "999999", unit: "MP", buyerId: "pa_ec_zab", price: "91" }, transport: { mode: "none", place: "x" } }) });
  // 5. produkcja na magazynie
  step("produkcja", "u_mag", "op.commit", { draft: D(TODAY, { type: "PRODUKCJA",
    production: { rawProductId: "pr_drewno", outProductId: "pr_zr_lesna", outQty: "80", chipperId: "ch_jenz", chipRate: "10" }, notes: "Pryzma P1" }) });
  // 6. przesunięcie MM dwuetapowe: wysłanie i przyjęcie z różnicą
  const mm = step("MM wysłanie", "u_kier", "op.commit", { draft: D(TODAY, { type: "MM",
    mm: { fromWhId: "wh_zab", productId: "pr_zr_tow", qty: "40", unit: "MP", toWhId: "wh_bra", weightMode: "manual", weightManual: "13,1" },
    transport: { mode: "own", place: "RiC Brąszewice", own: { vehicleId: "ve_scania", km: "28", rate: "5" } } }) });
  if (mm.ok) {
    step("MM przyjęcie obcego magazynu (odmowa)", "u_rok", "mm.receive", { opId: mm.op.id, receipt: { qty: "40", unit: "MP", date: TODAY } });
    step("MM przyjęcie", "u_bra", "mm.receive", { opId: mm.op.id, receipt: { qty: "39", unit: "MP", date: TODAY, weightMode: "manual", weightManual: "12,8", reason: "ubytek", note: "Kwit BR 1109/1" } });
    step("MM drugie przyjęcie (odmowa)", "u_bra", "mm.receive", { opId: mm.op.id, receipt: { qty: "39", unit: "MP", date: TODAY, reason: "ubytek" } });
  }
  // 7. korekta dokumentu i jej wycofanie
  if (wz.ok) {
    const cd = R.clone(wz.op.input); cd.sale.qty = "110"; cd.sale.weightManual = "37,9";
    const k = step("korekta WZ", "u_kier", "op.correct", { opId: wz.op.id, draft: cd, reason: "kwit wagowy 110 MP", corrKey: "test-korekta-1" });
    step("korekta WZ — powtórzenie tego samego klucza", "u_kier", "op.correct", { opId: wz.op.id, draft: cd, reason: "kwit wagowy 110 MP", corrKey: "test-korekta-1" });
    if (k.ok) step("wycofanie korekty", "u_kier", "op.reverseCorrection", { opId: wz.op.id, corrNo: (k.correction && k.correction.no) || k.no, reason: "korekta wprowadzona omyłkowo" });
  }
  // 8. anulowanie dokumentu
  const pom = step("zakup omyłkowy", "u_mag", "op.commit", { draft: D(TODAY, { purchase: { supplierId: "pa_agro", basis: "DEKL", productId: "pr_lupina", qty: "4", unit: "t", price: "600" }, transport: { mode: "none", place: "RiC Zabrze" } }) });
  if (pom.ok) step("anulowanie", "u_kier", "op.cancel", { opId: pom.op.id, reason: "dostawa nie dotarła", ack: true });
  // 9. uprawnienia: obserwator nie może zapisywać, magazynier nie zarządza użytkownikami
  step("obserwator — zakup (odmowa)", "u_view", "op.commit", { draft: D(TODAY, { purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "1", unit: "m3", price: "1" } }) });
  step("magazynier — konto (odmowa)", "u_mag", "user.save", { rec: { name: "Intruz", email: "intruz@resinvest.group", role: "admin" } });
  // 10. wersje robocze
  const dr = D(TODAY, { purchase: { supplierId: "pa_lander", basis: "KZR", productId: "pr_drewno", qty: "7", unit: "m3", price: "230" } });
  const ds = step("wersja robocza — zapis", "u_mag", "draft.save", { draft: dr });
  step("wersja robocza — usunięcie", "u_mag", "draft.delete", { id: (ds.draft && ds.draft.draftId) || (ds.rec && ds.rec.id) || ds.id || dr.draftId || "brak" });
  // 11. kartoteki, użytkownicy, ustawienia
  step("kontrahent", "u_admin", "master.save", { kind: "partners", rec: { name: "Tartak Testowy Sp. z o.o.", nip: "5261040828", kind: "firma", role: "supplier", city: "Gliwice" } });
  step("użytkownik", "u_admin", "user.save", { rec: { name: "Nowy Magazynier", email: "nowy.magazynier@resinvest.group", login: "nowy.magazynier@resinvest.group", role: "magazynier", whId: "wh_zab", warehouseIds: ["wh_zab"] } });
  step("preferencje", "u_mag", "me.prefs", { lang: "pl", theme: "graphite" });
  step("ustawienia", "u_admin", "settings.save", { settings: { requireApproval: false } });
  // 12. planer, powiadomienia, rejestr wydruków
  step("plan zakupów", "u_kier", "plan.set", { whId: "wh_zab", date: "2026-11-10", planMP: 150, note: "Plan testowy" });
  step("powiadomienia — przeczytane", "u_kier", "notice.read", { ids: "all" });
  step("rejestr wydruku", "u_kier", "print.register", { kind: "stock", title: "Stan magazynu", range: TODAY, wh: "wh_zab", format: "pdf" });
  // 13. inwentaryzacja miesiąca
  step("inwentaryzacja — otwarcie", "u_kier", "inv.open", { ym: "2026-10" });
  step("inwentaryzacja — arkusz", "u_kier", "inv.generate", { ym: "2026-10" });
  const period = (store.state.inventory || []).find(p => p.ym === "2026-10" && p.status === "OTWARTA");
  for (const [i, l] of ((period && period.lines) || []).entries()) step("inwentaryzacja — spis " + l.productId, "u_kier", "inv.setCount", { ym: "2026-10", productId: l.productId, text: String(100 + i * 7) });
  step("inwentaryzacja — zamknięcie", "u_kier", "inv.close", { ym: "2026-10" });
  step("kontrola przełomu miesiąca", "u_mag", "inv.autoClose", {});
  // 14. błędy wejścia
  step("nieznana komenda", "u_admin", "nie.ma", {});
  step("zakup bez danych (walidacja)", "u_mag", "op.commit", { draft: D(TODAY, { purchase: { supplierId: "", productId: "", qty: "", price: "" } }) });
  // 15. zdarzenie serwera w dzienniku audytu
  store.auditEvent({ code: "MAIL_TEST", entityId: "u_admin", action: "Wiadomość testowa" }, { ip: "10.0.0.5" }, { id: "u_admin", login: ADMIN.email });
  return out;
}

/** Stany magazynowe wszystkich produktów we wszystkich magazynach (jednostka magazynowa produktu). */
export function stockTable(state, R) {
  const out = {};
  for (const w of state.warehouses) for (const p of state.products) { const q = R.Stock.balance(state, w.id, p.id); if (q) out[`${w.id}|${p.id}`] = Math.round(q * 1000) / 1000; }
  return out;
}
