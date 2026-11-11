/* =========================================================================
   ResInvest ERP 3.15 — ekran startowy wersji demonstracyjnej 2 (logowanie / zakładanie konta)

   Gdy program ma osadzoną grafikę ekranu startowego (RIW_IMG.login — tylko edycja „demo2”), ekran logowania
   to wyłącznie ta grafika. Przyciski narysowane na grafice są aktywne: „Zaloguj się” i „Zarejestruj się /
   Utwórz konto” otwierają okienko z formularzem programu (Auth.loginScreen — logika bez zmian), a „Poznaj
   możliwości”, „Przewiń w dół” i menu — okienko z krótkim opisem systemu.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { t, esc, $, $$, ic, Auth, App } = UI;
  const IMG = root.RIW_IMG || {};
  const ok = k => typeof IMG[k] === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(IMG[k]);
  if (!ok("login") || !Auth || typeof Auth.loginScreen !== "function") return;

  /** Aktywne obszary grafik [lewo, góra, szerokość, wysokość] w % obrazu. */
  const HS_LOGIN = [
    { a: "register", r: [78.5, 3.2, 8.6, 5.0], l: "Zarejestruj się" }, { a: "login", r: [87.9, 3.2, 8.9, 5.0], l: "Zaloguj się" },
    { a: "more", r: [54.6, 4.0, 21.8, 3.6], l: "Funkcje, korzyści, o systemie, kontakt" },
    { a: "login", r: [3.6, 62.5, 16.3, 8.2], l: "Zaloguj się" }, { a: "register", r: [21.5, 62.8, 15.2, 7.6], l: "Utwórz konto" },
    { a: "more", r: [3.5, 72.6, 27.0, 6.4], l: "Poznaj możliwości ResInvest ERP" }, { a: "more", r: [45.0, 93.2, 10.4, 5.4], l: "Przewiń w dół" }
  ];
  const FEATURES = ["Stany magazynowe, przyjęcia, wydania i produkcja zrębki w jednym miejscu", "Dokumenty PZ / WZ / MM z wydrukiem i PDF, skany dokumentów", "Plan placu: pryzmy zrębki na mapie i terminarz pociągów", "Symulacja i realizacja załadunku pociągu z panelem operatora", "Raporty dzienne, miesięczne i roczne, historia każdej zmiany", "Praca na komputerze, tablecie i telefonie"];
  const hs = list => list.map(h => `<button type="button" class="land-hs" data-land="${h.a}" style="left:${h.r[0]}%;top:${h.r[1]}%;width:${h.r[2]}%;height:${h.r[3]}%" aria-label="${esc(t(h.l))}" title="${esc(t(h.l))}"></button>`).join("");

  const Landing = { open: false };
  const orig = Auth.loginScreen;
  Auth.loginScreen = function (opts) {
    const o = opts || {};
    orig.call(this, o);
    const app = document.getElementById("app"), auth = app && app.querySelector("#auth-screen");
    if (!auth) return;
    if (o.tab || o.info) Landing.open = true;                       // przełączenie zakładki, komunikat — okno zostaje otwarte
    const wrap = document.createElement("div");
    wrap.className = "land"; wrap.id = "landing";
    wrap.innerHTML = `<section class="land-hero" aria-label="${esc(t("ResInvest ERP — ekran startowy"))}">
        <div class="land-img" style="aspect-ratio:1672/941"><img src="${IMG.login}" alt="${esc(t("ResInvest ERP — pełna kontrola nad magazynem. Jedno centrum zarządzania."))}" draggable="false">${hs(HS_LOGIN)}</div>
        <div class="land-cta"><button class="btn primary lg" type="button" data-land="login">${ic("lock", 16)} ${esc(t("Zaloguj się"))}</button><button class="btn lg" type="button" data-land="register">${ic("user", 16)} ${esc(t("Utwórz konto"))}</button><button class="btn ghost lg" type="button" data-land="more">${ic("chevDown", 16)} ${esc(t("Poznaj możliwości"))}</button></div></section>
      <div class="land-pop${Landing.open ? " on" : ""}" id="land-pop"><div class="land-pop-in" role="dialog" aria-modal="true" aria-label="${esc(t("Logowanie"))}"><button class="land-x" type="button" id="land-x" aria-label="${esc(t("Zamknij"))}">${ic("x", 18)}</button>
        <div class="land-info hidden" id="land-info"><h3>${esc(t("Możliwości ResInvest ERP"))}</h3><ul>${FEATURES.map(f => `<li>${ic("check", 15)}<span>${esc(t(f))}</span></li>`).join("")}</ul>
          <div class="btn-row"><button class="btn primary" type="button" data-land="login">${ic("lock", 15)} ${esc(t("Zaloguj się"))}</button><button class="btn" type="button" data-land="register">${ic("user", 15)} ${esc(t("Utwórz konto"))}</button></div></div></div></div>`;
    $(".land-pop-in", wrap).appendChild(auth);                         // ten sam formularz (zdarzenia zachowane)
    app.innerHTML = ""; app.appendChild(wrap);
    const pop = $("#land-pop", wrap), info = $("#land-info", wrap);
    const show = tab => {
      if (tab === "register" && !Auth.selfRegistration()) { Auth.loginScreen({ info: t("Rejestracja jest wyłączona — konto zakłada administrator. Zaloguj się kontem demonstracyjnym (hasło demo1234).") }); return; }
      Landing.open = true;
      const want = tab === "register" ? "register" : "login", isReg = !!$("#reg-form", wrap);
      if ((want === "register") !== isReg) { Auth.loginScreen({ tab: want }); return; }
      info.classList.add("hidden"); auth.classList.remove("hidden");
      pop.classList.add("on"); const f = $(want === "register" ? "#rg-name" : "#lg-login", wrap); if (f) f.focus();
    };
    const close = () => { Landing.open = false; pop.classList.remove("on"); info.classList.add("hidden"); auth.classList.remove("hidden"); };
    $$("[data-land]", wrap).forEach(b => b.onclick = () => {
      const a = b.dataset.land;
      if (a === "login" || a === "register") return show(a);
      if (a === "more") { auth.classList.add("hidden"); info.classList.remove("hidden"); pop.classList.add("on"); }
    });
    $("#land-x", wrap).onclick = close;
    pop.addEventListener("click", e => { if (e.target === pop) close(); });
    wrap.addEventListener("keydown", e => { if (e.key === "Escape" && pop.classList.contains("on")) close(); });
    if (Landing.open) { const f = $("#lg-login", wrap) || $("#rg-name", wrap); if (f) f.focus(); }
  };
  UI.Landing = Landing;
})(typeof globalThis !== "undefined" ? globalThis : this);
