// Administracja: dane firmy, dokumenty i numeracja, użytkownicy, kopie zapasowe, import/eksport, system.

import { api, download } from '../api.js';
import {
  h, button, field, input, modal, toast, showError, showErrors, confirmDialog, withBusy, fmtDateTime, fmtSize,
  emptyRow, isValidNip, enterMovesFocus, isValidEmail, isValidPhone, mount,
} from '../ui.js';
import { loadSettings, state, changePasswordForm } from '../app.js';

const TABS = [['company', 'Dane firmy'], ['documents', 'Dokumenty i numeracja'], ['users', 'Użytkownicy'], ['backups', 'Kopie zapasowe'], ['data', 'Import / eksport'], ['account', 'Moje konto']];

export async function render(main) {
  let current = sessionStorage.getItem('gri-admin-tab') || 'company';
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { role: 'tabpanel' });
  mount(main, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Administracja'), h('div', { class: 'sub' }, 'Ustawienia programu, konta użytkowników i bezpieczeństwo danych.'))), tabs, panel);
  const draw = async () => {
    tabs.replaceChildren(...TABS.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === current),
      onclick: () => { current = k; sessionStorage.setItem('gri-admin-tab', k); draw(); } }, l)));
    panel.replaceChildren();
    try { await VIEWS[current](panel); } catch (err) { showError(err); }
  };
  await draw();
  return null;
}

function settingsForm(panel, section, defs, extraCheck) {
  return loadSettings(true).then((all) => {
    const values = all[section];
    const controls = {};
    const body = h('div', { class: 'grid' }, defs.map((d) => {
      const ctl = d.type === 'textarea' ? h('textarea', { rows: 3, maxlength: d.max || 1500 }, values[d.name] ?? '')
        : d.type === 'select' ? h('select', {}, d.options.map(([v, l]) => h('option', { value: v, selected: String(values[d.name]) === v }, l)))
          : input({ value: Array.isArray(values[d.name]) ? values[d.name].join(', ') : values[d.name] ?? '', maxlength: d.max || 200, type: d.type || 'text' });
      controls[d.name] = ctl;
      return field({ label: d.label, name: `${section}.${d.name}`, control: ctl, required: d.required, help: d.help, cls: d.cls || 'col-6' });
    }));
    enterMovesFocus(body);
    const save = button('Zapisz ustawienia', { kind: 'primary', iconName: 'check' });
    save.addEventListener('click', () => withBusy(save, async () => {
      const data = {};
      for (const d of defs) {
        let v = controls[d.name].value.trim();
        if (d.type === 'number') v = Number(v);
        if (d.list) v = v.split(',').map((x) => x.trim()).filter(Boolean);
        data[d.name] = v;
      }
      const errs = defs.filter((d) => d.required && (data[d.name] === '' || (Array.isArray(data[d.name]) && !data[d.name].length))).map((d) => ({ field: `${section}.${d.name}`, message: 'Pole jest wymagane' }));
      errs.push(...(extraCheck?.(data) || []));
      if (errs.length) { showErrors(body, errs); return; }
      try {
        state.settings = await api.put('/settings', { [section]: data });
        toast('Zapisano ustawienia', 'success');
      } catch (err) { showErrors(body, err.errors, err.errors?.length ? null : err.message); }
    }));
    panel.append(h('div', { class: 'card' }, body, h('div', { class: 'row', style: null }, h('span', { class: 'spacer' }), save)));
  });
}

const VIEWS = {
  company: (panel) => {
    panel.append(h('div', { class: 'alert info' }, 'Dane Zleceniodawcy drukowane na zleceniu i w stopce PDF. Zmiana nie dotyczy już wystawionych zleceń (mają zapisaną kopię danych). Stopka DOCX pochodzi z papieru firmowego.'));
    return settingsForm(panel, 'company', [
      { name: 'name', label: 'Nazwa na zleceniu', required: true }, { name: 'legal_name', label: 'Pełna nazwa (stopka)', required: true },
      { name: 'street', label: 'Ulica', required: true }, { name: 'postal_code', label: 'Kod pocztowy', required: true, cls: 'col-3' },
      { name: 'city', label: 'Miejscowość', required: true, cls: 'col-3' }, { name: 'nip', label: 'NIP', required: true, cls: 'col-4' },
      { name: 'regon', label: 'REGON', cls: 'col-4' }, { name: 'krs', label: 'KRS', cls: 'col-4' },
      { name: 'court', label: 'Sąd rejestrowy', cls: 'col-12', max: 300 }, { name: 'share_capital', label: 'Kapitał zakładowy' },
      { name: 'correspondence_address', label: 'Adres do korespondencji' }, { name: 'website', label: 'Strona www' },
    ], (d) => (isValidNip(d.nip) ? [] : [{ field: 'company.nip', message: 'Nieprawidłowy NIP' }]));
  },
  documents: async (panel) => {
    panel.append(h('h2', {}, 'Numeracja zleceń'),
      h('p', { class: 'muted small' }, 'Znaczniki: {SEQ} kolejny numer, {MM} miesiąc, {YYYY} rok, {YY} rok 2-cyfrowy. Numer nadawany jest przy wystawieniu, bez luk.'));
    await settingsForm(panel, 'numbering', [
      { name: 'pattern', label: 'Wzór numeru', required: true, help: 'np. ZL/{SEQ}/{MM}/{YYYY} → ZL/001/11/2026', max: 50 },
      { name: 'seq_digits', label: 'Cyfr w numerze', type: 'number', required: true, cls: 'col-3' },
      { name: 'reset', label: 'Numeracja od 1', type: 'select', options: [['monthly', 'co miesiąc'], ['yearly', 'co rok']], cls: 'col-3' },
    ], (d) => (d.pattern.includes('{SEQ}') ? [] : [{ field: 'numbering.pattern', message: 'Wzór musi zawierać {SEQ}' }]));
    panel.append(h('h2', {}, 'Wartości domyślne'));
    await settingsForm(panel, 'defaults', [
      { name: 'issue_place', label: 'Miejsce wystawienia', required: true },
      { name: 'payment_days', label: 'Termin płatności [dni]', type: 'number', required: true, cls: 'col-3' },
      { name: 'units', label: 'Jednostki cen (oddzielone przecinkami)', list: true, required: true, cls: 'col-12' },
    ]);
    panel.append(h('h2', {}, 'Treść dokumentu'));
    await settingsForm(panel, 'documents', [
      { name: 'title', label: 'Tytuł dokumentu', required: true, max: 60 },
      { name: 'payment_text', label: 'Tekst płatności', required: true, help: '{days} = liczba dni' },
      { name: 'closing_clause', label: 'Klauzula końcowa (drukowana w „Uwagach” każdego zlecenia)', type: 'textarea', cls: 'col-12' },
    ], (d) => (d.payment_text.includes('{days}') ? [] : [{ field: 'documents.payment_text', message: 'Tekst musi zawierać {days}' }]));
  },
  users: async (panel) => {
    const users = await api.get('/users');
    const ROLE = { admin: 'Administrator', user: 'Użytkownik', viewer: 'Podgląd' };
    const showPassword = (login, pwd) => modal({ title: 'Hasło startowe', build: (close) => ({
      body: h('div', { class: 'stack' }, h('p', {}, `Przekaż użytkownikowi „${login}” hasło startowe (przy pierwszym logowaniu ustawi własne):`),
        h('div', { class: 'pre', tabindex: '0' }, pwd), h('p', { class: 'small muted' }, 'Hasło jest wyświetlane tylko teraz.')),
      footer: [button('Zamknij', { kind: 'primary', onClick: () => close() })] }) });
    const edit = (u) => {
      const f = {
        username: input({ value: u?.username || '', maxlength: 64, readonly: !!u, autocapitalize: 'none' }),
        full_name: input({ value: u?.full_name || '', maxlength: 120 }),
        email: input({ value: u?.email || '', type: 'email', maxlength: 160 }),
        phone: input({ value: u?.phone || '', maxlength: 40, inputmode: 'tel' }),
        role: h('select', {}, Object.entries(ROLE).map(([k, l]) => h('option', { value: k, selected: (u?.role || 'user') === k }, l))),
        is_active: h('input', { type: 'checkbox', checked: u ? u.is_active : true }),
      };
      const body = h('div', { class: 'grid' },
        field({ label: 'Login', name: 'username', control: f.username, required: true, cls: 'col-6', help: 'Litery, cyfry, . _ -' }),
        field({ label: 'Imię i nazwisko', name: 'full_name', control: f.full_name, required: true, cls: 'col-6' }),
        field({ label: 'E-mail', name: 'email', control: f.email, cls: 'col-6' }),
        field({ label: 'Telefon', name: 'phone', control: f.phone, cls: 'col-6' }),
        field({ label: 'Rola', name: 'role', control: f.role, cls: 'col-6', help: 'Podgląd: tylko odczyt i pobieranie dokumentów.' }),
        h('label', { class: 'check col-6' }, f.is_active, 'Konto aktywne'));
      modal({ title: u ? `Użytkownik ${u.username}` : 'Nowy użytkownik', build: (close) => {
        const save = h('button', { type: 'submit', class: 'btn primary' }, 'Zapisz');
        return { body, form: () => withBusy(save, async () => {
          const data = { username: f.username.value.trim().toLowerCase(), full_name: f.full_name.value.trim(), email: f.email.value.trim() || null,
            phone: f.phone.value.trim() || null, role: f.role.value, is_active: f.is_active.checked };
          const errs = [];
          if (!/^[a-z0-9._-]{3,64}$/.test(data.username)) errs.push({ field: 'username', message: 'Min. 3 znaki: litery, cyfry, . _ -' });
          if (data.full_name.length < 2) errs.push({ field: 'full_name', message: 'Podaj imię i nazwisko' });
          if (data.email && !isValidEmail(data.email)) errs.push({ field: 'email', message: 'Nieprawidłowy e-mail' });
          if (data.phone && !isValidPhone(data.phone)) errs.push({ field: 'phone', message: 'Nieprawidłowy telefon' });
          if (errs.length) { showErrors(body, errs); return; }
          try {
            if (u) { await api.put(`/users/${u.id}`, data); toast('Zapisano', 'success'); close(); }
            else { const r = await api.post('/users', data); close(); showPassword(data.username, r.initial_password); }
            VIEWS.users(panel.replaceChildren() || panel);
          } catch (err) { showErrors(body, err.errors, err.errors?.length ? null : err.message); }
        }), footer: [button('Anuluj', { onClick: () => close() }), save] };
      } });
    };
    panel.append(
      h('div', { class: 'card-head' }, h('p', { class: 'muted' }, 'Każdy użytkownik loguje się własnym kontem — historia operacji pokazuje, kto co zrobił.'),
        button('Nowy użytkownik', { kind: 'primary', iconName: 'plus', onClick: () => edit(null) })),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
        h('thead', {}, h('tr', {}, ['Login', 'Imię i nazwisko', 'Rola', 'Ostatnie logowanie', 'Status', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, users.map((u) => h('tr', {},
          h('td', { class: 'primary-cell', 'data-label': 'Login' }, u.username),
          h('td', { 'data-label': 'Imię i nazwisko' }, u.full_name),
          h('td', { 'data-label': 'Rola' }, ROLE[u.role]),
          h('td', { 'data-label': 'Logowanie' }, fmtDateTime(u.last_login_at)),
          h('td', { 'data-label': 'Status' }, h('span', { class: `badge ${u.is_active ? 'issued' : 'neutral'}` }, u.is_active ? 'aktywne' : 'zablokowane'),
            u.must_change_password ? h('span', { class: 'badge draft' }, 'hasło startowe') : null),
          h('td', { class: 'actions' },
            button('', { small: true, kind: 'ghost', iconName: 'edit', title: 'Edytuj', onClick: () => edit(u) }),
            button('Reset hasła', { small: true, onClick: async () => {
              if (!(await confirmDialog({ title: 'Zresetować hasło?', message: `Użytkownik ${u.username} zostanie wylogowany i otrzyma nowe hasło startowe.`, confirmLabel: 'Resetuj' }))) return;
              try { const r = await api.post(`/users/${u.id}/reset-password`); showPassword(u.username, r.initial_password); } catch (err) { showError(err); }
            } }))))))));
  },
  backups: async (panel) => {
    const data = await api.get('/backups');
    const info = await api.get('/system/info');
    const createBtn = button('Utwórz kopię teraz', { kind: 'primary', iconName: 'download', onClick: () => withBusy(createBtn, async () => {
      try { const r = await api.post('/backups'); toast(`Utworzono kopię ${r.name}`, 'success'); panel.replaceChildren(); VIEWS.backups(panel); } catch (err) { showError(err); }
    }) });
    const restore = async (name) => {
      if (!(await confirmDialog({ title: 'Przywrócić kopię?', danger: true, confirmLabel: 'Przywróć',
        message: `Dane programu zostaną zastąpione stanem z kopii ${name}. Przed przywróceniem program automatycznie wykona kopię bieżącego stanu.` }))) return;
      try { const r = await api.post(`/backups/${encodeURIComponent(name)}/restore`); toast(r.message, 'success', 9000); panel.replaceChildren(); VIEWS.backups(panel); } catch (err) { showError(err); }
    };
    const upload = h('input', { type: 'file', accept: '.zip' });
    const uploadBtn = button('Przywróć z pliku', { onClick: () => withBusy(uploadBtn, async () => {
      if (!upload.files[0]) { toast('Wybierz plik kopii (.zip)', 'error'); upload.focus(); return; }
      if (!(await confirmDialog({ title: 'Przywrócić dane z pliku?', danger: true, confirmLabel: 'Przywróć', message: 'Bieżące dane zostaną zastąpione. Kopia bezpieczeństwa zostanie wykonana automatycznie.' }))) return;
      try { const r = await api.upload('/backups/upload-restore', upload.files[0]); toast(r.message, 'success', 9000); panel.replaceChildren(); VIEWS.backups(panel); } catch (err) { showError(err); }
    }) });
    const KIND = { auto: 'automatyczna', manual: 'ręczna', 'pre-restore': 'przed przywróceniem' };
    panel.append(
      h('div', { class: 'alert info' }, h('strong', {}, 'Kopie automatyczne'),
        `Co ${data.interval_hours} h (przechowywanych: ${data.keep} najnowszych). Kopia zawiera bazę danych i archiwum dokumentów, z testem integralności i sumą kontrolną. Katalog: `, h('code', {}, data.directory),
        '. Zalecane: kopiuj regularnie ten katalog na inny dysk lub serwer.'),
      h('div', { class: 'card-head' }, h('span', { class: 'muted' }, `Ostatnia kopia: ${info.last_backup ? new Date(info.last_backup).toLocaleString('pl-PL') : 'brak'}`), createBtn),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data responsive' },
        h('thead', {}, h('tr', {}, ['Plik', 'Rodzaj', 'Utworzono', 'Rozmiar', ''].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, data.items.length ? data.items.map((b) => h('tr', {},
          h('td', { class: 'primary-cell mono small', 'data-label': 'Plik' }, b.name),
          h('td', { 'data-label': 'Rodzaj' }, KIND[b.kind] || b.kind),
          h('td', { 'data-label': 'Utworzono' }, fmtDateTime(b.created_at)),
          h('td', { 'data-label': 'Rozmiar' }, fmtSize(b.size_bytes)),
          h('td', { class: 'actions' },
            button('', { small: true, kind: 'ghost', iconName: 'download', title: 'Pobierz', onClick: () => download(`/backups/${encodeURIComponent(b.name)}/download`).catch(showError) }),
            button('Przywróć', { small: true, kind: 'danger', onClick: () => restore(b.name) })))) : emptyRow(5, 'Brak kopii.')))),
      h('div', { class: 'card', style: null }, h('h2', {}, 'Przywracanie z pliku'), h('p', { class: 'small muted' }, 'Np. z kopii przeniesionej z innego komputera.'),
        h('div', { class: 'row' }, upload, uploadBtn)));
  },
  data: async (panel) => {
    const exportBtn = button('Eksportuj kartoteki (JSON)', { iconName: 'download', onClick: () => withBusy(exportBtn, () => download('/data/export.json').catch(showError)) });
    const file = h('input', { type: 'file', accept: '.json,application/json' });
    const importBtn = button('Importuj', { kind: 'primary', iconName: 'upload', onClick: () => withBusy(importBtn, async () => {
      if (!file.files[0]) { toast('Wybierz plik JSON', 'error'); return; }
      try {
        const r = await api.upload('/data/import.json', file.files[0]);
        toast(`Dodano: kontrahenci ${r.contractors}, usługi ${r.services}, ceny ${r.prices}, osoby ${r.handlers}${r.errors.length ? ` · błędy: ${r.errors.length}` : ''}`, 'success', 9000);
      } catch (err) { showError(err); }
    }) });
    panel.append(
      h('div', { class: 'card' }, h('h2', {}, 'Eksport kartotek'), h('p', { class: 'muted' }, 'Kontrahenci, opisy usług, ceny i osoby prowadzące w jednym pliku JSON — np. do przeniesienia na inny komputer lub do innego modułu ResInvest ERP.'), exportBtn),
      h('div', { class: 'card' }, h('h2', {}, 'Import kartotek'), h('p', { class: 'muted' }, 'Dodaje brakujące pozycje (istniejące nie są nadpisywane).'), h('div', { class: 'row' }, file, importBtn)),
      h('div', { class: 'card' }, h('h2', {}, 'Inne formaty'), h('p', {}, 'Kontrahenci CSV — w zakładce Kontrahenci. Rejestr zleceń XLSX/CSV — w Rejestrze zleceń i Raportach. Pełna kopia danych — zakładka Kopie zapasowe.')));
  },
  account: async (panel) => {
    const info = await api.get('/system/info');
    panel.append(
      h('div', { class: 'grid' },
        h('div', { class: 'card col-6' }, h('h2', {}, 'Zmiana hasła'), changePasswordForm({ onDone: () => panel.querySelectorAll('input').forEach((i) => { i.value = ''; }) })),
        h('div', { class: 'card col-6' }, h('h2', {}, 'O programie'),
          h('dl', { class: 'dl' },
            h('dt', {}, 'Program'), h('dd', {}, `${info.app} ${info.version}`),
            h('dt', {}, 'Wersja schematu bazy'), h('dd', {}, String(info.schema_version)),
            h('dt', {}, 'Katalog danych'), h('dd', { class: 'mono small' }, info.data_dir),
            h('dt', {}, 'Dokumentacja API'), h('dd', {}, h('a', { href: '/api/docs', target: '_blank', rel: 'noopener' }, '/api/docs'))))));
  },
};
