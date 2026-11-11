/* =========================================================================
   ResInvest ERP 3.15 — Plac składowy na pulpicie (wizualizacja)

   Zdjęcie placu (osadzone w programie: RIW_IMG.yard) z warstwą oznaczeń SVG:
     zielony obszar — pryzma przeznaczona na pociąg (wypełnienie = ilość przygotowana pod załadunek),
     niebieska linia — czoło pryzmy, od którego ładuje się pociąg, czerwone punkty P1…Pn — pobór próbek,
     złoty obszar — pozostała pryzma zrębki RiC.
   Liczby z księgi magazynowej (R.Yard.stats). Administrator przeciąga narożniki i punkty („Edytuj układ”),
   wpisuje wymiary i ilość pod załadunek → komenda „yard.save” (audyt). Bez zdjęcia karta nie jest wyświetlana.
   ========================================================================= */
(function (root) {
  "use strict";
  const UI = root.RIWUI;
  const { R, t, N_, esc, $, $$, ic, Toast, Modal, Store, App } = UI;
  const { fmtQ } = R;
  const th = s => esc(t(s));
  const SRC = N_("Pulpit — plac składowy");
  const img = () => (root.RIW_IMG && typeof root.RIW_IMG.yard === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(root.RIW_IMG.yard)) ? root.RIW_IMG.yard : "";
  const tab = () => App.tabs.yard || (App.tabs.yard = { marks: true, edit: false, draft: null });

  const pts = a => a.map(p => `${p[0]},${p[1]}`).join(" ");
  const mid = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const centroid = a => [a.reduce((s, p) => s + p[0], 0) / a.length, a.reduce((s, p) => s + p[1], 0) / a.length];
  /** Etykieta na zdjęciu: tło + tekst (czytelna na każdym tle). */
  function label(x, y, lines, cls) {
    const w = Math.max(...lines.map(l => l.length)) * 13 + 28, h = lines.length * 30 + 14;
    return `<g class="yl ${cls || ""}" transform="translate(${x - w / 2},${y - h / 2})"><rect width="${w}" height="${h}" rx="8"/>${lines.map((l, i) => `<text x="${w / 2}" y="${32 + i * 30}" text-anchor="middle"${i ? ' class="sub"' : ""}>${esc(l)}</text>`).join("")}</g>`;
  }

  /** Warstwa SVG oznaczeń placu. */
  function svgInner(y, st, editing) {
    const [A, B, C, D] = y.train, f = st.fill;
    const filled = [A, mid(A, B, f), mid(D, C, f), D];
    // etykiety między środkiem a tylną krawędzią obszaru — nie zasłaniają opisów na zdjęciu
    const cT = mid(mid(A, D, 0.68), mid(B, C, 0.68), 0.5), cR = mid(centroid(y.ric), mid(y.ric[2], y.ric[3], 0.5), 0.45), fm = mid(y.front[0], y.front[1], 0.5);
    const ang = Math.atan2(y.front[1][1] - y.front[0][1], y.front[1][0] - y.front[0][0]) * 180 / Math.PI;
    let s = `<polygon class="y-ric" points="${pts(y.ric)}"/>
      <polygon class="y-train" points="${pts(y.train)}"/>
      ${f > 0 ? `<polygon class="y-train-fill" points="${pts(filled)}"/>` : ""}
      <line class="y-front" x1="${y.front[0][0]}" y1="${y.front[0][1]}" x2="${y.front[1][0]}" y2="${y.front[1][1]}"/>
      <g transform="translate(${fm[0]},${fm[1] - 52}) rotate(${ang})"><text class="y-front-t" text-anchor="middle">${th("CZOŁO PRYZMY — ładowanie pociągu")}</text></g>
      ${y.points.map((p, i) => `<g class="y-pin" transform="translate(${p[0]},${p[1]})"><path d="M0 0 C -14 -18 -20 -26 -20 -36 a20 20 0 1 1 40 0 c0 10 -6 18 -20 36z"/><text x="0" y="-29" text-anchor="middle">P${i + 1}</text></g>`).join("")}
      ${label(cT[0], cT[1], [y.trainName.toUpperCase(), t("{q} MP pod załadunek · {p}%", { q: fmtQ(st.reserved), p: Math.round(st.fill * 100) })], "train")}
      ${label(cR[0], Math.min(cR[1], y.h - 80), [t("PRYZMA ZRĘBKI (RiC)"), t("{q} MP", { q: fmtQ(st.remaining) })], "ric")}`;
    if (editing) {
      const h = (k, i, p) => `<circle class="y-h" data-k="${k}" data-i="${i}" cx="${p[0]}" cy="${p[1]}" r="16"/>`;
      // kolejność rysowania = kolejność „chwytania”: narożniki pryzmy pod pociąg na wierzchu, czoło pryzmy — kwadratowe uchwyty
      const sq = (k, i, p) => `<rect class="y-h front" data-k="${k}" data-i="${i}" x="${p[0] - 15}" y="${p[1] - 15}" width="30" height="30" rx="5"/>`;
      s += y.ric.map((p, i) => h("ric", i, p)).join("") + y.points.map((p, i) => h("points", i, p)).join("") + y.front.map((p, i) => sq("front", i, p)).join("") + y.train.map((p, i) => h("train", i, p)).join("");
    }
    return s;
  }

  const YardCard = {
    available() { return !!img() && !!R.Yard; },
    html() {
      if (!this.available()) return "";
      const S = Store.state, T = tab(), saved = R.Yard.current(S), y = T.edit && T.draft ? T.draft : saved;
      const st = R.Yard.stats(S, y), wh = R.byId(S.warehouses, y.whId), canEdit = App.can("warehouses.edit");
      const pct = Math.round(st.fill * 100);
      const prodList = st.products.length ? st.products.map(p => `<li><span>${esc(p.name)}</span><b>${esc(fmtQ(p.qty))} MP</b></li>`).join("") : `<li class="dim">${th("Brak zrębki na stanie")}</li>`;
      const edit = T.edit ? `<div class="yard-form" id="yard-form">
          <div class="field"><label for="yd-name">${th("Nazwa pryzmy pod pociąg")}</label><input class="ctrl" id="yd-name" maxlength="60" value="${esc(y.trainName)}"></div>
          <div class="yard-dims">
            <div class="field"><label for="yd-len">${th("Długość [m]")}</label><input class="ctrl" id="yd-len" inputmode="decimal" value="${esc(fmtQ(y.dims.len))}"></div>
            <div class="field"><label for="yd-wid">${th("Szerokość [m]")}</label><input class="ctrl" id="yd-wid" inputmode="decimal" value="${esc(fmtQ(y.dims.wid))}"></div>
            <div class="field"><label for="yd-hei">${th("Wysokość [m]")}</label><input class="ctrl" id="yd-hei" inputmode="decimal" value="${esc(fmtQ(y.dims.hei))}"></div></div>
          <div class="field"><label for="yd-res">${th("Zrębka pod załadunek [MP]")}</label><input class="ctrl" id="yd-res" inputmode="decimal" placeholder="${esc(t("puste = cała pryzma"))}" value="${y.reservedMP === null ? "" : esc(fmtQ(y.reservedMP))}"></div>
          <p class="help">${th("Przeciągnij narożniki obszarów, końce czoła pryzmy i punkty P1–P5 na zdjęciu.")}</p>
          <div class="btn-row"><button class="btn primary" type="button" id="yd-save">${ic("check", 15)} ${th("Zapisz układ")}</button><button class="btn" type="button" id="yd-cancel">${th("Anuluj")}</button>
            ${saved.custom ? `<button class="btn ghost" type="button" id="yd-reset">${th("Układ domyślny")}</button>` : ""}</div></div>` : "";
      return `<div class="card yard-card mt4" id="yard-card"><div class="card-h"><h3>${ic("layers", 16)} ${esc(t("Plac składowy — {w}", { w: wh ? wh.name : y.whId }))}</h3>
          <span class="sub">${th("zrębka na placu, pryzma pod załadunek pociągu i czoło pryzmy")}</span><span class="spacer"></span>
          <label class="inline-opt"><input type="checkbox" id="yard-marks" ${T.marks || T.edit ? "checked" : ""} ${T.edit ? "disabled" : ""}> ${th("Oznaczenia")}</label>
          ${canEdit && !T.edit ? `<button class="btn sm" type="button" id="yard-edit">${ic("edit", 14)} ${th("Edytuj układ")}</button>` : ""}</div>
        <div class="yard-body">
          <div class="yard-stage${T.edit ? " editing" : ""}" id="yard-stage"><div class="yard-pic"><img src="${img()}" alt="${esc(t("Zdjęcie placu {w}", { w: wh ? wh.name : "" }))}" draggable="false">
            <svg viewBox="0 0 ${y.w} ${y.h}" id="yard-svg" class="${T.marks || T.edit ? "" : "hidden"}" role="img" aria-label="${esc(t("Oznaczenia placu"))}">${svgInner(y, st, T.edit)}</svg></div></div>
          <aside class="yard-side">
            <div class="yk"><span>${th("Zrębka na placu")}</span><b id="yard-stock">${esc(fmtQ(st.stock))} MP</b><ul class="yard-prod">${prodList}</ul></div>
            <div class="yk train"><span>${esc(t("{n} — pod załadunek pociągu", { n: y.trainName }))}</span><b id="yard-reserved">${esc(fmtQ(st.reserved))} MP</b>
              <div class="yard-bar" title="${esc(t("{p}% pojemności pryzmy", { p: pct }))}"><i style="width:${pct}%"></i></div>
              <small>${esc(t("{p}% pojemności {c} MP · ok. {w} wag. × {m} MP", { p: pct, c: fmtQ(st.capacity), w: st.wagons, m: fmtQ(st.wagonMP) }))}</small>
              ${st.short > 0 ? `<small class="neg">${esc(t("Brakuje {q} MP zrębki do zaplanowanej ilości", { q: fmtQ(st.short) }))}</small>` : ""}</div>
            <div class="yk ric"><span>${th("Pozostała pryzma zrębki RiC")}</span><b id="yard-remaining">${esc(fmtQ(st.remaining))} MP</b></div>
            <div class="yk dims"><span>${th("Wymiary pryzmy (przekrój trójkątny)")}</span><b>${esc(fmtQ(y.dims.len))} × ${esc(fmtQ(y.dims.wid))} × ${esc(fmtQ(y.dims.hei))} m</b><small>${esc(t("długość × szerokość × wysokość · pojemność {c} m³", { c: fmtQ(st.capacity) }))}</small></div>
            <ul class="yard-legend"><li><i class="lg-train"></i>${esc(t("{n} (pod załadunek)", { n: y.trainName }))}</li><li><i class="lg-front"></i>${th("Czoło pryzmy — miejsce ładowania pociągu")}</li><li><i class="lg-pin"></i>${th("Punkty poboru próbek P1–P5")}</li><li><i class="lg-ric"></i>${th("Pryzma zrębki RiC")}</li></ul>
            ${edit}
          </aside></div></div>`;
    },
    bind(page) {
      const card = $("#yard-card", page); if (!card) return;
      const T = tab();
      const mk = $("#yard-marks", card); if (mk) mk.onchange = () => { T.marks = mk.checked; $("#yard-svg", card).classList.toggle("hidden", !mk.checked); };
      const eb = $("#yard-edit", card); if (eb) eb.onclick = () => { T.edit = true; T.draft = R.Yard.current(Store.state); App.render(); };
      if (!T.edit) return;
      const svg = $("#yard-svg", card), y = T.draft;
      const redraw = () => { svg.innerHTML = svgInner(y, R.Yard.stats(Store.state, y), true); };
      let drag = null;
      const toSvg = e => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(svg.getScreenCTM().inverse()); return [Math.max(0, Math.min(y.w, Math.round(q.x))), Math.max(0, Math.min(y.h, Math.round(q.y)))]; };
      svg.addEventListener("pointerdown", e => { const h = e.target.closest && e.target.closest(".y-h"); if (!h) return; drag = { k: h.dataset.k, i: +h.dataset.i }; svg.setPointerCapture(e.pointerId); e.preventDefault(); });
      svg.addEventListener("pointermove", e => { if (!drag) return; y[drag.k][drag.i] = toSvg(e); redraw(); });
      const end = () => { drag = null; };
      svg.addEventListener("pointerup", end); svg.addEventListener("pointercancel", end);
      const val = id => $(id, card).value;
      // wpisane wymiary / ilość — podgląd na zdjęciu od razu (zapis dopiero przyciskiem)
      const live = () => { const n = v => { const r = R.NumParse.parse(v); return r.ok ? r.value : null; };
        const L = n(val("#yd-len")), W = n(val("#yd-wid")), H = n(val("#yd-hei")); if (L > 0 && W > 0 && H > 0) y.dims = { len: L, wid: W, hei: H };
        const rv = val("#yd-res").trim(); y.reservedMP = rv === "" ? null : (n(rv) !== null && n(rv) >= 0 ? n(rv) : y.reservedMP);
        y.trainName = val("#yd-name").trim() || y.trainName; redraw(); };
      $$("#yard-form input", card).forEach(el => el.addEventListener("input", live));
      $("#yd-cancel", card).onclick = () => { T.edit = false; T.draft = null; App.render(); };
      const rs = $("#yd-reset", card); if (rs) rs.onclick = async () => {
        const c = await Modal.confirm({ title: t("Przywrócić układ domyślny placu?"), text: t("Oznaczenia, wymiary i ilość pod załadunek wrócą do ustawień początkowych."), ok: t("Przywróć") });
        if (!c.ok) return;
        const res = await Store.exec("yard.save", { reset: true }, SRC);
        if (!res.ok) return Toast.err(t("Nie zapisano"), res.error);
        T.edit = false; T.draft = null; Toast.ok(t("Przywrócono układ domyślny placu")); App.render();
      };
      $("#yd-save", card).onclick = async () => {
        const res = await Store.exec("yard.save", { whId: y.whId, trainName: val("#yd-name"), train: y.train, front: y.front, points: y.points, ric: y.ric,
          dims: { len: val("#yd-len"), wid: val("#yd-wid"), hei: val("#yd-hei") }, reservedMP: val("#yd-res") }, SRC);
        if (!res.ok && res.code !== "NOCHANGE") { Toast.err(t("Nie zapisano"), res.error + (res.errors ? " — " + Object.values(res.errors).join("; ") : "")); return; }
        T.edit = false; T.draft = null;
        if (res.ok) Toast.ok(t("Zapisano układ placu"), t("{n}: {q} MP pod załadunek", { n: res.yard.trainName, q: fmtQ(res.stats.reserved) }));
        App.render();
      };
    }
  };
  UI.YardCard = YardCard;
})(typeof globalThis !== "undefined" ? globalThis : this);
