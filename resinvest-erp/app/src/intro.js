/* =========================================================================
   Warstwa I: ekran powitalny (intro) — film ResInvest Commodities z dźwiękiem

   Start bez „przycięcia” interfejsu:
   * Pierwsza klatka filmu (poster) jest częścią statycznego HTML (#splash, szablon
     index.template.html) — widać ją od pierwszego malowania, zanim przeglądarka
     przeczyta skrypty programu.
   * Dane filmu (MP4 z indeksem „faststart”) są zamieniane na Blob ZARAZ po
     wczytaniu tego pliku — natywnie (fetch data: → Blob), bez pętli JS — i
     równolegle z uruchamianiem aplikacji (Intro.preload()).
   * Obraz i dźwięk startują jednym wywołaniem play() (ścieżka AAC w tym samym
     pliku). Gdy przeglądarka blokuje autoodtwarzanie z dźwiękiem, film gra dalej
     wyciszony, a pierwsze kliknięcie / klawisz włącza dźwięk. W instalacji Windows
     program otwiera okno Edge/Chrome z polityką autoodtwarzania, więc dźwięk
     startuje od pierwszej klatki (installer/scripts/ResInvestERP-Otworz.cmd).
   Panel (górny róg): „Wycisz / Wyłącz wyciszenie” z ikoną stanu i „Pomiń intro”
   (także Esc / Enter). Twardy limit czasu 14 s.
   Zwalnianie zasobów (dispose): po „Pomiń” albo po końcu filmu — zatrzymanie
   dekodera (pause + usunięcie źródła + load()), cofnięcie adresu Blob, zwolnienie
   Blob, zamknięcie AudioContext (plansza zastępcza), usunięcie wszystkich
   nasłuchiwaczy (AbortController), liczników czasu i elementu z DOM.
   Brak kodeka H.264/AAC → plansza firmowa + krótka muzyka syntezowana Web Audio.
   ========================================================================= */
(function (root) {
  "use strict";
  const PREF_MUSIC = "riw.music";
  const PREF_INTRO = "riw.intro";
  const DBG = root.RIW_DEBUG = root.RIW_DEBUG || {};
  const t = s => (root.RIW_I18N ? root.RIW_I18N.t(s) : s);

  const ICON_SOUND = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
  const ICON_MUTED = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>';

  /** Krótki motyw muzyczny syntezowany w przeglądarce (plansza zastępcza, bez plików i CDN). */
  function createSynth() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return { start: () => Promise.resolve(false), stop() {}, setMuted() {}, closed: true };
    let ctx = null, master = null, muted = false;
    const VOL = 0.14;
    const api = {
      closed: false,
      start() {
        try {
          if (!ctx) {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : VOL;
            master.connect(ctx.destination);
            const filter = ctx.createBiquadFilter();
            filter.type = "lowpass"; filter.frequency.value = 1800; filter.connect(master);
            const chords = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
            const t0 = ctx.currentTime + 0.05;
            chords.forEach((ch, i) => ch.forEach((f, j) => {
              const s = t0 + i * 1.55, o = ctx.createOscillator(), g = ctx.createGain();
              o.type = j === 0 ? "sine" : "triangle"; o.frequency.value = f;
              g.gain.setValueAtTime(0.0001, s); g.gain.linearRampToValueAtTime(0.28, s + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, s + 2.1);
              o.connect(g); g.connect(filter); o.start(s); o.stop(s + 2.2);
            }));
          }
        } catch (e) { return Promise.resolve(false); }
        const resumed = ctx.state === "suspended" ? ctx.resume().catch(() => {}) : Promise.resolve();
        // resume() bez gestu potrafi „wisieć” — nie czekamy dłużej niż 300 ms
        const running = () => !!ctx && ctx.state === "running";   // kontekst mógł zostać już zamknięty (dispose)
        return Promise.race([resumed.then(running), new Promise(r => setTimeout(() => r(running()), 300))]);
      },
      setMuted(m) { muted = m; if (master && ctx) master.gain.setTargetAtTime(m ? 0 : VOL, ctx.currentTime, 0.05); },
      /** Zamknięcie kontekstu audio — zwalnia wątek dźwięku przeglądarki. */
      stop() {
        if (api.closed) return; api.closed = true;
        try { if (ctx) ctx.close(); } catch (e) {}
        ctx = null; master = null;
      }
    };
    return api;
  }

  const Intro = {
    MAX_MS: 14000,
    FALLBACK_MS: 6500,
    active: false,
    _blob: null, _blobPromise: null,

    /** Muzyka intro jest włączona przy każdym starcie programu; „Wycisz” dotyczy tylko bieżącego odtworzenia. */
    _music: true,
    musicOn() { return this._music !== false; },
    setMusic(on) { this._music = !!on; try { localStorage.removeItem(PREF_MUSIC); } catch (e) {} },
    enabled() { try { return localStorage.getItem(PREF_INTRO) !== "0"; } catch (e) { return true; } },
    setEnabled(on) { try { localStorage.setItem(PREF_INTRO, on ? "1" : "0"); } catch (e) {} },
    reducedMotion() { return typeof root.matchMedia === "function" && root.matchMedia("(prefers-reduced-motion: reduce)").matches; },

    /**
     * Buforowanie: dane filmu → Blob. Wywoływane od razu po wczytaniu modułu (równolegle z resztą programu).
     * fetch(data:) dekoduje natywnie; gdy niedostępny (stare przeglądarki / ograniczenia) — atob w kawałkach.
     */
    preload() {
      if (this._blob) return Promise.resolve(this._blob);
      if (this._blobPromise) return this._blobPromise;
      const src = typeof root.INTRO_SRC === "string" ? root.INTRO_SRC : "";
      const mime = (/^data:(video\/[\w.+-]+)[;,]/.exec(src) || [])[1];
      if (!mime) return Promise.resolve(null);
      const viaAtob = () => {
        const b64 = src.slice(src.indexOf(",") + 1), parts = [], CH = 1 << 20;   // 1 MB base64 na kawałek
        for (let i = 0; i < b64.length; i += CH) {
          const bin = atob(b64.slice(i, i + CH)), buf = new Uint8Array(bin.length);
          for (let j = 0; j < bin.length; j++) buf[j] = bin.charCodeAt(j);
          parts.push(buf);
        }
        return new Blob(parts, { type: mime });
      };
      const p = (typeof root.fetch === "function" ? root.fetch(src).then(r => r.blob()).then(b => b.size ? b : viaAtob()) : Promise.reject(new Error("fetch")))
        .catch(() => { try { return viaAtob(); } catch (e) { return null; } })
        .then(b => { this._blob = b && b.size ? new Blob([b], { type: mime }) : null; this._blobPromise = null; return this._blob; });
      this._blobPromise = p;
      return p;
    },

    /** Ekran z pierwszą klatką z szablonu — usuwany, gdy intro nie będzie odtwarzane. */
    dropBootSplash() { const b = document.getElementById("splash"); if (b && b.classList.contains("boot")) b.remove(); },

    play(opts = {}) {
      if (this.active) return Promise.resolve("busy");
      if (!opts.force && !this.enabled()) { this.dropBootSplash(); return Promise.resolve("off"); }
      if (!opts.force && this.reducedMotion()) { this.dropBootSplash(); return Promise.resolve("reduced"); }
      this.active = true;
      const st = DBG.intro = { phase: "playing", source: "video", music: this.musicOn(), audible: false, blocked: false, result: null, startedAt: Date.now(), disposed: null };

      return new Promise(resolve => {
        // przejęcie ekranu z szablonu (pierwsza klatka już widoczna) albo nowy — przy ponownym odtworzeniu
        let el = document.getElementById("splash");
        if (!el) {
          el = document.createElement("div"); el.id = "splash"; el.className = "splash";
          el.innerHTML = `<img class="splash-poster" alt="" aria-hidden="true" src="${typeof root.INTRO_POSTER === "string" ? root.INTRO_POSTER : ""}">`;
          document.body.appendChild(el);
        }
        el.classList.remove("boot");
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-label", t("Ekran powitalny ResInvest ERP"));
        el.insertAdjacentHTML("beforeend", `
          <video playsinline preload="auto" aria-hidden="true" tabindex="-1"></video>
          <div class="splash-brand" aria-hidden="true">
            <div class="mark" aria-label="RiC — ResInvest Commodities">RiC</div>
            <h2>ResInvest Commodities</h2>
            <p>${t("ERP · obrót i magazynowanie biomasy drzewnej")}</p>
          </div>
          <div class="splash-ctl">
            <button type="button" class="splash-btn" data-music></button>
            <button type="button" class="splash-btn" data-skip>${t("Pomiń intro")} <span aria-hidden="true">→</span></button>
          </div>
          <p class="splash-note hidden" data-note role="status"></p>
          <div class="splash-bar" aria-hidden="true"><i data-bar></i></div>`);

        const video = el.querySelector("video");
        const bar = el.querySelector("[data-bar]");
        const note = el.querySelector("[data-note]");
        const musicBtn = el.querySelector("[data-music]");
        const skipBtn = el.querySelector("[data-skip]");
        const life = typeof AbortController === "function" ? new AbortController() : null;   // wszystkie nasłuchiwacze intro
        const on = (target, type, fn, capture) => target.addEventListener(type, fn, life ? { capture: !!capture, signal: life.signal } : !!capture);
        let done = false, objectUrl = null, synth = null, armed = false, fallbackTimer = null, barTimer = null, gestureCtl = null;

        const showNote = txt => { note.textContent = txt || ""; note.classList.toggle("hidden", !txt); };
        /** Przycisk pokazuje stan dźwięku (ikona) i akcję (etykieta). */
        const renderBtn = () => {
          const soundOn = this.musicOn();
          musicBtn.innerHTML = (soundOn ? ICON_SOUND : ICON_MUTED) + `<span>${soundOn ? t("Wycisz") : t("Wyłącz wyciszenie")}</span>`;
          musicBtn.setAttribute("aria-pressed", String(!soundOn));
          musicBtn.setAttribute("aria-label", soundOn ? t("Wycisz dźwięk intro") : t("Włącz dźwięk intro"));
          musicBtn.dataset.state = soundOn ? "on" : "muted";
        };
        const BLOCKED_TXT = t("Przeglądarka zablokowała automatyczny dźwięk. Kliknij w dowolnym miejscu lub naciśnij klawisz, aby włączyć muzykę.");

        const onGesture = e => {
          if (e.type === "keydown" && (e.key === "Escape" || e.key === "Enter")) return;
          disarm();
          if (this.musicOn()) tryAudible();
        };
        const arm = () => {
          if (armed) return; armed = true;
          gestureCtl = typeof AbortController === "function" ? new AbortController() : null;
          const o = gestureCtl ? { capture: true, signal: gestureCtl.signal } : true;
          document.addEventListener("pointerdown", onGesture, o);
          document.addEventListener("keydown", onGesture, o);
        };
        const disarm = () => {
          if (!armed) return; armed = false;
          if (gestureCtl) gestureCtl.abort(); else { document.removeEventListener("pointerdown", onGesture, true); document.removeEventListener("keydown", onGesture, true); }
          gestureCtl = null;
        };

        /** Obraz i dźwięk jednym play(); przy blokadzie dźwięku — wyciszone + czekamy na gest. */
        const tryAudible = () => {
          if (done) return Promise.resolve(false);
          if (!this.musicOn()) { applyMute(); return Promise.resolve(false); }
          if (st.source === "video") {
            video.muted = false;
            let p;
            try { p = video.play(); } catch (e) { p = Promise.reject(e); }
            return Promise.resolve(p).then(() => { st.audible = !video.muted; st.blocked = false; showNote(""); return true; }).catch(e => {
              if (done) return false;
              if (e && e.name === "NotAllowedError") {
                st.blocked = true; st.audible = false; video.muted = true;
                const p2 = video.play(); if (p2 && p2.catch) p2.catch(() => {});
                arm(); showNote(BLOCKED_TXT);
              } else if (e && e.name !== "AbortError") toBrand();
              return false;
            });
          }
          synth = synth || createSynth();
          synth.setMuted(false);
          return synth.start().then(ok => {
            if (done) return false;
            st.audible = ok; st.blocked = !ok;
            if (ok) showNote(""); else { arm(); showNote(BLOCKED_TXT); }
            return ok;
          });
        };
        const applyMute = () => { st.audible = false; if (st.source === "video") video.muted = true; if (synth) synth.setMuted(true); };

        /** Plansza firmowa, gdy film nie może zostać odtworzony. */
        const toBrand = () => {
          if (done || st.source === "synth") return;
          st.source = "synth";
          el.classList.add("no-video");
          try { video.pause(); } catch (e) {}
          const t0 = Date.now();
          barTimer = setInterval(() => { bar.style.width = Math.min(100, (Date.now() - t0) / this.FALLBACK_MS * 100).toFixed(1) + "%"; }, 200);
          fallbackTimer = setTimeout(() => finish("end"), this.FALLBACK_MS);
          if (this.musicOn()) tryAudible();
        };

        /** Zwolnienie wszystkich zasobów intro (bez wycieków pamięci). */
        const dispose = () => {
          clearTimeout(maxTimer); clearTimeout(fallbackTimer); clearInterval(barTimer);
          disarm();
          if (life) life.abort();                                           // nasłuchiwacze intro
          try { video.pause(); } catch (e) {}
          try { video.removeAttribute("src"); video.srcObject = null; video.load(); } catch (e) {}   // dekoder audio/wideo
          if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) {} objectUrl = null; }
          this._blob = null;                                                // bufor filmu (ponowne odtworzenie zbuduje go z danych programu)
          if (synth) synth.stop();
          st.disposed = { video: !video.getAttribute("src") && video.readyState === 0, url: objectUrl === null, blob: this._blob === null, audio: !synth || synth.closed, listeners: !life || life.signal.aborted };
        };
        const finish = how => {
          if (done) return; done = true;
          if (!life) document.removeEventListener("keydown", onKey, true);
          dispose();
          el.classList.add("out");
          st.phase = "done"; st.result = how;
          setTimeout(() => { el.remove(); this.active = false; st.phase = "removed"; resolve(how); }, 260);
        };
        const onKey = e => { if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); finish("skip"); } };

        on(document, "keydown", onKey, true);
        on(skipBtn, "click", e => { e.stopPropagation(); finish("skip"); });
        on(musicBtn, "click", e => {
          e.stopPropagation();
          const next = !this.musicOn();
          this.setMusic(next); st.music = next; renderBtn();
          if (next) tryAudible(); else { applyMute(); showNote(""); disarm(); }
        });
        const maxTimer = setTimeout(() => finish("timeout"), this.MAX_MS);
        renderBtn();
        skipBtn.focus({ preventScroll: true });

        on(video, "timeupdate", () => { if (video.duration) bar.style.width = (video.currentTime / video.duration * 100).toFixed(1) + "%"; });
        on(video, "playing", () => el.classList.add("is-playing"));
        on(video, "ended", () => { bar.style.width = "100%"; finish("end"); });
        on(video, "error", () => { if (!done) toBrand(); });

        // format z danych programu: MP4 H.264 High + AAC (standard Windows: Edge / Chrome)
        const src = typeof root.INTRO_SRC === "string" ? root.INTRO_SRC : "";
        const type = src.indexOf("data:video/webm") === 0 ? 'video/webm; codecs="vp9, opus"' : 'video/mp4; codecs="avc1.640028, mp4a.40.2"';
        if (typeof video.canPlayType !== "function" || video.canPlayType(type) === "") { toBrand(); return; }
        this.preload().then(blob => {
          if (done) return;
          if (!blob) { toBrand(); return; }
          objectUrl = URL.createObjectURL(blob);
          video.src = objectUrl;
          // obraz i dźwięk razem; play() sam poczeka na pierwsze klatki
          if (this.musicOn()) tryAudible();
          else { video.muted = true; const p = video.play(); if (p && p.catch) p.catch(err => { if (err && err.name !== "NotAllowedError" && err.name !== "AbortError") toBrand(); }); }
        });
      });
    }
  };

  root.Intro = Intro;
  DBG.introModule = Intro;
  // buforowanie filmu od razu — równolegle z wczytywaniem reszty programu (tylko gdy intro zostanie pokazane)
  try { if (Intro.enabled() && !Intro.reducedMotion()) Intro.preload(); } catch (e) {}
})(typeof globalThis !== "undefined" ? globalThis : this);
