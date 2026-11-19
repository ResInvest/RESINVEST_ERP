// Okno dodawania / edycji kontrahenta (używane w kartotece i bezpośrednio z formularza zlecenia).

import { api } from '../api.js';
import {
  h, modal, field, input, button, showErrors, enterMovesFocus, withBusy, toast,
  isValidNip, isValidPhone, isValidPostal, isValidEmail,
} from '../ui.js';

export function contractorModal({ contractor = null, prefillName = '' } = {}) {
  return new Promise((resolve) => {
    const c = contractor || {};
    const f = {
      name: input({ value: c.name || prefillName, maxlength: 200, autofocus: true }),
      nip: input({ value: c.nip || '', maxlength: 20, inputmode: 'numeric', placeholder: '0000000000' }),
      street: input({ value: c.street || '', maxlength: 200, placeholder: 'ul. Przykładowa 1' }),
      postal_code: input({ value: c.postal_code || '', maxlength: 16, inputmode: 'numeric', placeholder: '00-000' }),
      city: input({ value: c.city || '', maxlength: 120 }),
      country: input({ value: c.country || 'PL', maxlength: 2 }),
      phone: input({ value: c.phone || '', maxlength: 40, inputmode: 'tel', placeholder: '+48 600 000 000' }),
      email: input({ value: c.email || '', maxlength: 160, type: 'email', inputmode: 'email' }),
      contact_person: input({ value: c.contact_person || '', maxlength: 120 }),
      notes: h('textarea', { maxlength: 2000, rows: 2 }, c.notes || ''),
      is_active: h('input', { type: 'checkbox', checked: c.is_active !== false }),
    };
    f.postal_code.addEventListener('blur', () => {
      const v = f.postal_code.value.trim();
      if (/^\d{5}$/.test(v)) f.postal_code.value = `${v.slice(0, 2)}-${v.slice(2)}`;
    });
    const nipHelp = h('span', {});
    f.nip.addEventListener('input', () => {
      const v = f.nip.value.trim();
      nipHelp.textContent = !v ? '' : isValidNip(v) ? '✓ NIP poprawny' : '';
    });

    const body = h('div', { class: 'grid' },
      field({ label: 'Nazwa firmy', name: 'name', control: f.name, required: true, cls: 'col-8' }),
      field({ label: 'NIP', name: 'nip', control: f.nip, cls: 'col-4', help: nipHelp }),
      field({ label: 'Ulica i numer', name: 'street', control: f.street, required: true, cls: 'col-12' }),
      field({ label: 'Kod pocztowy', name: 'postal_code', control: f.postal_code, required: true, cls: 'col-3' }),
      field({ label: 'Miejscowość', name: 'city', control: f.city, required: true, cls: 'col-6' }),
      field({ label: 'Kraj', name: 'country', control: f.country, cls: 'col-3', help: 'Kod ISO, np. PL' }),
      field({ label: 'Telefon', name: 'phone', control: f.phone, cls: 'col-6' }),
      field({ label: 'E-mail', name: 'email', control: f.email, cls: 'col-6' }),
      field({ label: 'Osoba kontaktowa', name: 'contact_person', control: f.contact_person, cls: 'col-12' }),
      field({ label: 'Uwagi', name: 'notes', control: f.notes, cls: 'col-12' }),
      h('label', { class: 'check col-12' }, f.is_active, 'Kontrahent aktywny (widoczny przy wystawianiu zleceń)'));
    enterMovesFocus(body);

    modal({
      title: contractor ? `Kontrahent: ${contractor.name}` : 'Nowy kontrahent',
      onClose: (r) => resolve(r || null),
      build: (close) => {
        const save = h('button', { type: 'submit', class: 'btn primary' }, 'Zapisz kontrahenta');
        const submit = () => withBusy(save, async () => {
          const data = {
            name: f.name.value.trim(), nip: f.nip.value.trim() || null, street: f.street.value.trim(),
            postal_code: f.postal_code.value.trim(), city: f.city.value.trim(), country: (f.country.value.trim() || 'PL').toUpperCase(),
            phone: f.phone.value.trim() || null, email: f.email.value.trim() || null,
            contact_person: f.contact_person.value.trim() || null, notes: f.notes.value.trim() || null,
            is_active: f.is_active.checked,
          };
          const errs = [];
          if (data.name.length < 2) errs.push({ field: 'name', message: 'Podaj nazwę firmy' });
          if (data.nip && data.country === 'PL' && !isValidNip(data.nip)) errs.push({ field: 'nip', message: 'Nieprawidłowy NIP (błędna suma kontrolna)' });
          if (data.street.length < 2) errs.push({ field: 'street', message: 'Podaj ulicę i numer' });
          if (data.country === 'PL' && !isValidPostal(data.postal_code)) errs.push({ field: 'postal_code', message: 'Format 00-000' });
          if (data.city.length < 2) errs.push({ field: 'city', message: 'Podaj miejscowość' });
          if (data.phone && !isValidPhone(data.phone)) errs.push({ field: 'phone', message: 'Nieprawidłowy numer telefonu' });
          if (data.email && !isValidEmail(data.email)) errs.push({ field: 'email', message: 'Nieprawidłowy e-mail' });
          if (errs.length) { showErrors(body, errs); return; }
          try {
            const saved = contractor
              ? await api.put(`/contractors/${contractor.id}`, { ...data, row_version: contractor.row_version })
              : await api.post('/contractors', data);
            toast(contractor ? 'Zapisano zmiany kontrahenta' : `Dodano kontrahenta ${saved.name}`, 'success');
            close(saved);
          } catch (err) { showErrors(body, err.errors, err.errors?.length ? null : err.message); }
        });
        return { form: submit, body, footer: [button('Anuluj', { onClick: () => close(null) }), save] };
      },
    });
  });
}
