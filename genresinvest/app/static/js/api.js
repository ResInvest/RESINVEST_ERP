// Klient REST API: jednolita obsługa błędów, nagłówek bezpieczeństwa, pobieranie plików.

export class ApiError extends Error {
  constructor(status, detail, errors = []) {
    super(detail || `Błąd ${status}`);
    this.status = status;
    this.errors = errors || [];
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

function buildUrl(path, params) {
  const url = new URL(`/api/v1${path}`, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }
  return url;
}

async function parseError(res) {
  let detail = `Błąd serwera (${res.status})`;
  let errors = [];
  try {
    const data = await res.json();
    if (typeof data.detail === 'string') detail = data.detail;
    errors = data.errors || [];
  } catch { /* odpowiedź bez JSON */ }
  return new ApiError(res.status, detail, errors);
}

export async function request(method, path, { body, params, form, raw = false, silent401 = false } = {}) {
  const headers = { 'X-GRI-Request': '1' };
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(buildUrl(path, params), { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Brak połączenia z serwerem GenResInvest. Sprawdź, czy program jest uruchomiony.');
  }
  if (res.status === 401 && !silent401) {
    const err = await parseError(res);
    onUnauthorized(err.message);
    throw err;
  }
  if (!res.ok) throw await parseError(res);
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (p, params, opts) => request('GET', p, { params, ...opts }),
  post: (p, body, params) => request('POST', p, { body, params }),
  put: (p, body) => request('PUT', p, { body }),
  del: (p) => request('DELETE', p),
  upload: (p, file, params) => { const fd = new FormData(); fd.append('file', file); return request('POST', p, { form: fd, params }); },
};

function fileNameFrom(res, fallback) {
  const cd = res.headers.get('Content-Disposition') || '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  const plain = cd.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : fallback;
}

/** Pobiera plik z API (GET lub POST z treścią) i zapisuje go na dysku użytkownika. */
export async function download(path, { params, body, fallbackName = 'plik' } = {}) {
  const res = await request(body ? 'POST' : 'GET', path, { params, body, raw: true });
  const blob = await res.blob();
  const name = fileNameFrom(res, fallbackName);
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}

/** Zwraca adres blob: dokumentu (np. PDF do podglądu). */
export async function blobUrl(path, { params, body } = {}) {
  const res = await request(body ? 'POST' : 'GET', path, { params, body, raw: true });
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), name: fileNameFrom(res, 'dokument.pdf') };
}
