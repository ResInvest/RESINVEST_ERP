// Magazyn danych: IndexedDB (trwały, transakcyjny), wersjonowanie stanu, dziennik zdarzeń,
// automatyczne migawki dzienne, eksport/import kopii, synchronizacja między kartami przeglądarki.

const DB_NAME = 'genresinvest';
const DB_VERSION = 1;
const STATE_KEY = 'state';
const SCHEMA = 1;

const DEFAULT_CLAUSES = [
  'Uzgodniona cena jest ceną netto i będzie powiększona o obowiązujący podatek VAT.',
  'Sprzedający wystawi Zamawiającemu fakturę VAT.',
  'Zamawiający oświadcza, że jest płatnikiem VAT zarejestrowanym w Urzędzie Skarbowym w Katowicach i posiada NIP: 2060002073.',
  'Sprzedający zobowiązuje się do zachowania należytej staranności w zakresie uniknięcia zanieczyszczeń mineralnych w dostarczonej zrębce.',
  'Kupujący zastrzega sobie prawo do odmowy przyjęcia towaru niespełniającego ustalonych wymagań.',
  'Płatność za dostawę nastąpi po podpisaniu przez odbiorcę dokumentu potwierdzającego zgodność dostawy z wymaganiami ofertowymi.',
  'Sprzedający dostarczy zrębkę własnym transportem.',
  'Sprzedający dostarczy dokumentację pochodzenia biomasy (POS bądź deklarację o prowadzeniu tartaku).',
];

function defaultState() {
  const t = nowISO();
  const c = (o) => ({ id: uid(), country: 'PL', email: '', contact_person: '', notes: '', active: true, rv: 1, created: t, updated: t, ...o });
  return {
    schema: SCHEMA,
    meta: { created: t, updated: t, rev: 0, lastExport: null },
    settings: {
      company: {
        name: 'ResInvest Commodities PL', legal_name: 'ResInvest Commodities PL S.A.', street: 'ul. Gawronów 22',
        postal_code: '40-527', city: 'Katowice', nip: '2060002073', regon: '242858882', krs: '0000411384',
        court: 'Sąd Rejonowy Katowice - Wschód w Katowicach, VIII Wydział Gospodarczy Krajowego Rejestru Sądowego',
        share_capital: '500 000,00 zł (wpłacony w całości)',
        correspondence_address: 'ul. Legionów 83, pok.1, 43-502 Czechowice-Dziedzice', website: 'www.resinvestcommodities.com',
      },
      numbering: {
        zlecenie: { pattern: 'ZL/{SEQ}/{MM}/{YYYY}', digits: 3, reset: 'monthly' },
        zamowienie: { pattern: 'ZAM/{SEQ}/{MM}/{YYYY}', digits: 3, reset: 'monthly' },
      },
      defaults: {
        issue_place: 'Katowice', payment_days: 14, payment_method: 'Przelew bankowy na wskazany nr konta',
        units: ['zł/fracht', 'zł/t', 'zł/km', 'zł/kurs', 'zł/h', 'zł/m³', 'zł'],
        order_units: ['mp', 't', 'm³', 'szt.', 'kg'],
        payment_text: 'Płatność: {days} dni od daty wystawienia faktury',
      },
    },
    users: [{ id: 'u-admin', name: 'Administrator', role: 'admin', pin: null, active: true }],
    contractors: [
      c({ name: 'FHU AGRO-TRANS', street: 'ul. Bytomska 17', postal_code: '42-674', city: 'Karchowice', nip: '6452037772', phone: '+48 606 403 090', kinds: ['przewoznik'] }),
      c({ name: 'FHU RAGO Ewa Golasz', street: 'ul. Miarki 14', postal_code: '44-178', city: 'Przyszowice', nip: '9691165664', phone: '+48 535 994 500', kinds: ['przewoznik'] }),
      c({ name: 'VASCO Andrzej Słociński', street: 'Al. Roździeńskiego 188', postal_code: '40-203', city: 'Katowice', nip: '6460007202', phone: '+48 530 679 282', kinds: ['przewoznik'] }),
      c({ name: 'SmartTrans Kazimierz Broda', street: 'ul. 1-go Maja 134/16', postal_code: '40-237', city: 'Katowice', nip: '', phone: '+48 503 352 341', kinds: ['przewoznik'],
        notes: 'Uzupełnij NIP. We wzorze zlecenia wpisano NIP 6460007202, który należy do VASCO Andrzej Słociński.' }),
      c({ name: 'DRENO Produkcja wyrobów z drewna Sp.j.', street: 'Śnietnica 90', postal_code: '38-315', city: 'Śnietnica', nip: '7380003361', phone: '', kinds: ['dostawca'] }),
    ],
    dict: {
      services: [{ id: uid(), short: 'Przewóz PKS (Łupina ziarna palmowego) za pomocą auta typu wywrotka.', detailed: 'Transport PKS (Łupina ziarna palmowego) za pomocą auta typu wywrotka', cargo: 'PKS (Łupina ziarna palmowego)', uses: 5 }],
      prices: [{ id: uid(), route: 'Zabrze - Chorzów', amount: 90000, unit: 'zł/fracht', uses: 5 }],
      handlers: [{ id: uid(), name: 'Marcin Kwiatkowski', phone: '539 508 380', uses: 5 }],
      products: [{ id: uid(), name: 'Zrębka drzewna', material: 'Zrębka drzewna, pozostałość z przemysłu drzewnego/tartacznego.\nPomiar na podstawie dokumentacji z dostaw.', unit: 'mp', price: 8500, uses: 1 }],
      places: [{ id: uid(), text: 'ul. J. Wiśniowieckiego 56, Nowy Sącz', uses: 1 }],
      clauses: DEFAULT_CLAUSES.map((text) => ({ id: uid(), text, auto: true, uses: 1 })),
      methods: [{ id: uid(), text: 'Przelew bankowy na wskazany nr konta', uses: 1 }],
    },
    documents: [],
    counters: {},
    audit: [{ id: uid(), ts: t, user: 'system', action: 'create', entity: 'system', entityId: null, summary: 'Utworzono bazę danych i wczytano dane startowe' }],
  };
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Przeglądarka nie obsługuje IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Nie można otworzyć bazy danych przeglądarki'));
    req.onblocked = () => reject(new Error('Baza jest zablokowana przez inną kartę — zamknij pozostałe karty GenResInvest'));
  });
}
function idbReq(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transakcja przerwana'));
  });
}

const Store = {
  db: null,
  state: null,
  channel: null,
  listeners: new Set(),
  saving: false,
  memoryOnly: false,

  async init() {
    try {
      this.db = await idbOpen();
      const saved = await idbReq(this.db, 'kv', 'readonly', (s) => s.get(STATE_KEY));
      this.state = saved ? migrate(saved) : defaultState();
      if (!saved) await this.persist();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (err) {
      console.error(err);
      this.memoryOnly = true;
      this.state = defaultState();
      setTimeout(() => toast(`Dane NIE będą zapisywane: ${err.message}. Otwórz plik w Chrome/Edge/Firefox.`, 'error', 0), 500);
    }
    if ('BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('genresinvest');
      this.channel.onmessage = async (e) => {
        if (e.data?.type === 'rev' && e.data.rev > this.state.meta.rev) {
          await this.reload();
          toast('Dane zostały zmienione w innej karcie — widok odświeżony');
        }
      };
    }
    await this.autoSnapshot();
  },

  async reload() {
    if (this.memoryOnly) return;
    const saved = await idbReq(this.db, 'kv', 'readonly', (s) => s.get(STATE_KEY));
    if (saved) { this.state = migrate(saved); this.emit(); }
  },

  async persist() {
    if (this.memoryOnly) return;
    await idbReq(this.db, 'kv', 'readwrite', (s) => s.put(this.state, STATE_KEY));
  },

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const fn of this.listeners) { try { fn(this.state); } catch (e) { console.error(e); } } },

  /**
   * Jedyna droga zmiany danych. Mutacja działa na kopii stanu; dopiero gdy się powiedzie i zapis
   * w IndexedDB zakończy się sukcesem, kopia staje się stanem bieżącym (brak „połowicznych” zapisów).
   * Przed zmianą sprawdzamy, czy inna karta nie zapisała nowszej wersji (współbieżność kart).
   */
  async commit(mutator, auditEntry) {
    if (!this.memoryOnly) {
      const stored = await idbReq(this.db, 'kv', 'readonly', (s) => s.get(STATE_KEY));
      if (stored && stored.meta.rev > this.state.meta.rev) this.state = migrate(stored);
    }
    const draft = structuredClone(this.state);
    const result = mutator(draft);
    draft.meta.rev += 1;
    draft.meta.updated = nowISO();
    if (auditEntry) {
      const entries = Array.isArray(auditEntry) ? auditEntry : [auditEntry];
      for (const a of entries) {
        const entry = typeof a === 'function' ? a(result) : a;
        if (entry) draft.audit.unshift({ id: uid(), ts: nowISO(), user: currentUserName(), entityId: null, ...entry });
      }
      if (draft.audit.length > 20000) draft.audit.length = 20000;
    }
    const previous = this.state;
    this.state = draft;
    setSaveIndicator('saving');
    try {
      await this.persist();
      setSaveIndicator('saved');
    } catch (err) {
      this.state = previous;
      setSaveIndicator('error');
      throw new Error(`Zapis nie powiódł się: ${err.message || err}. Zmiana została wycofana.`);
    }
    this.channel?.postMessage({ type: 'rev', rev: draft.meta.rev });
    this.emit();
    return result;
  },

  // --- Migawki (kopie wewnątrz przeglądarki) i pliki kopii ---------------------------------------
  async snapshot(kind = 'manual') {
    if (this.memoryOnly) return null;
    const key = `${nowISO()}|${kind}`;
    await idbReq(this.db, 'snapshots', 'readwrite', (s) => s.put(structuredClone(this.state), key));
    const keys = await this.snapshotKeys();
    const autos = keys.filter((k) => k.endsWith('|auto'));
    for (const k of autos.slice(30)) await idbReq(this.db, 'snapshots', 'readwrite', (s) => s.delete(k));
    return key;
  },
  async snapshotKeys() {
    if (this.memoryOnly) return [];
    const keys = await idbReq(this.db, 'snapshots', 'readonly', (s) => s.getAllKeys());
    return (keys || []).sort().reverse();
  },
  async autoSnapshot() {
    const keys = await this.snapshotKeys();
    const last = keys.find((k) => k.endsWith('|auto'));
    if (!last || Date.now() - new Date(last.split('|')[0]).getTime() > 20 * 3600 * 1000) await this.snapshot('auto');
  },
  async restoreSnapshot(key) {
    const snap = await idbReq(this.db, 'snapshots', 'readonly', (s) => s.get(key));
    if (!snap) throw new Error('Nie znaleziono migawki');
    await this.snapshot('pre-restore');
    const rev = this.state.meta.rev;
    this.state = migrate(snap);
    this.state.meta.rev = rev + 1;
    this.state.audit.unshift({ id: uid(), ts: nowISO(), user: currentUserName(), action: 'restore', entity: 'system', entityId: null, summary: `Przywrócono migawkę z ${fmtDateTime(key.split('|')[0])}` });
    await this.persist();
    this.channel?.postMessage({ type: 'rev', rev: this.state.meta.rev });
    this.emit();
  },

  async exportBackup() {
    await this.commit((d) => { d.meta.lastExport = nowISO(); }, { action: 'backup', entity: 'system', summary: 'Wyeksportowano kopię danych do pliku' });
    const payload = {
      format: 'genresinvest-html-backup', schema: SCHEMA, app: BUILD.version, exported: nowISO(),
      sha256: await sha256Hex(JSON.stringify(this.state)), state: this.state,
    };
    const name = `GenResInvest_kopia_${todayISO()}_${new Date().toTimeString().slice(0, 5).replace(':', '')}.json`;
    downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), name);
    return name;
  },

  async importBackup(file) {
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Plik nie jest prawidłowym plikiem JSON'); }
    if (data.format !== 'genresinvest-html-backup' || !data.state || typeof data.state !== 'object') throw new Error('To nie jest plik kopii GenResInvest');
    if ((data.schema || 0) > SCHEMA) throw new Error('Kopia pochodzi z nowszej wersji programu');
    const st = data.state;
    if (data.sha256 && crypto.subtle && (await sha256Hex(JSON.stringify(st))) !== data.sha256) throw new Error('Plik kopii jest uszkodzony (niezgodna suma kontrolna)');
    for (const k of ['settings', 'contractors', 'dict', 'documents', 'audit']) if (!st[k]) throw new Error(`Kopia jest niekompletna (brak: ${k})`);
    await this.snapshot('pre-restore');
    const rev = this.state.meta.rev;
    this.state = migrate(st);
    this.state.meta.rev = Math.max(rev, st.meta?.rev || 0) + 1;
    this.state.audit.unshift({ id: uid(), ts: nowISO(), user: currentUserName(), action: 'restore', entity: 'system', entityId: null, summary: `Przywrócono kopię z pliku ${file.name}` });
    await this.persist();
    this.channel?.postMessage({ type: 'rev', rev: this.state.meta.rev });
    this.emit();
  },
};

function migrate(st) {
  // Miejsce na przyszłe migracje schematu (st.schema < SCHEMA). Uzupełnia brakujące gałęzie.
  const base = defaultState();
  st.settings = { ...base.settings, ...st.settings, company: { ...base.settings.company, ...st.settings?.company },
    numbering: { ...base.settings.numbering, ...st.settings?.numbering }, defaults: { ...base.settings.defaults, ...st.settings?.defaults } };
  st.dict = { ...Object.fromEntries(Object.keys(base.dict).map((k) => [k, []])), ...st.dict };
  st.users = st.users?.length ? st.users : base.users;
  st.counters = st.counters || {};
  st.meta = { ...base.meta, ...st.meta };
  st.schema = SCHEMA;
  return st;
}

// --- Sesja (profil użytkownika na tym komputerze) ------------------------------------------------
const Session = {
  userId: null,
  get user() { return Store.state.users.find((u) => u.id === this.userId) || null; },
};
const currentUserName = () => Session.user?.name || 'system';
const isAdmin = () => Session.user?.role === 'admin';
const canEdit = () => ['admin', 'user'].includes(Session.user?.role);

let saveIndicatorTimer;
function setSaveIndicator(stateName) {
  const el = $('#save-state');
  if (!el) return;
  clearTimeout(saveIndicatorTimer);
  el.dataset.state = stateName;
  el.textContent = { saving: 'Zapisywanie…', saved: 'Zapisano', error: 'Błąd zapisu' }[stateName] || '';
  if (stateName === 'saved') saveIndicatorTimer = setTimeout(() => { el.dataset.state = 'idle'; el.textContent = 'Dane zapisane'; }, 1800);
}
