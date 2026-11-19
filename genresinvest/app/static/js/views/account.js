// Moje konto: zmiana hasła (dostępne dla każdej roli).

import { h, mount } from '../ui.js';
import { state, changePasswordForm } from '../app.js';

export async function render(main) {
  mount(main, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Moje konto'), h('div', { class: 'sub' }, `${state.user.full_name} · ${state.user.username}`))),
    h('div', { class: 'card', style: null }, h('h2', {}, 'Zmiana hasła'),
      changePasswordForm({ onDone: () => main.querySelectorAll('input').forEach((i) => { i.value = ''; }) })));
  return null;
}
