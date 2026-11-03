# Supabase — nie dotyczy (wybrany wariant A)

Dokument wymagań zakładał Supabase Auth, PostgreSQL z RLS i NestJS. Audyt istniejącego systemu
([AUTH_AUDIT_PLAN.md](AUTH_AUDIT_PLAN.md)) wykazał, że ResInvest ERP działa na własnym serwerze Node.js + SQLite
z jednym silnikiem wspólnym dla przeglądarki i serwera. Decyzja właściciela: **wariant A — rozbudowa
obecnego systemu**, bez Supabase (brak drugiej bazy, brak przepisywania aplikacji, praca w sieci lokalnej bez internetu).

Zmienne `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY` w `.env.example` są **puste i nieużywane** —
pozostawione wyłącznie dla zgodności z listą z dokumentu wymagań.

## Odpowiedniki wymagań

| Wymaganie (Supabase) | Realizacja w ResInvest ERP 3.2 |
|---|---|
| Supabase Auth (hasła, sesje) | tabela `accounts` (scrypt), sesje HttpOnly w tabeli `sessions` |
| `inviteUserByEmail` (Auth Admin API) | `POST /api/users/invite` + token jednorazowy + Resend — wyłącznie po stronie serwera |
| potwierdzenie e-mail, reset hasła | tokeny w tabeli `tokens` (skrót SHA-256, termin ważności, jednorazowe) |
| tabele `profiles`, `user_roles`, `warehouse_access` | `state.users` (rola, `whId`, `warehouseIds`, status), `state.rolePerms` |
| RLS (izolacja wierszy) | `Service.project` (odczyt) + `canAccessWh` w silniku (zapis) — testy §34.13–14, §35.3–4 |
| `audit_logs` | `state.audit` (kod, przed/po, IP, User-Agent) + dziennik zmian z łańcuchem SHA-256 |
| JWT claims | rola i uprawnienia odczytywane z profilu na serwerze przy każdym żądaniu (nie z tokenu przeglądarki) |

## Jeśli w przyszłości wybrany zostanie Supabase

Interfejs komend `RIW.Service` (jedna ścieżka zmian danych) pozwala podmienić warstwę przechowywania bez zmiany
ekranów. Migracja wymagałaby: bazy PostgreSQL z tabelami relacyjnymi, polityk RLS odpowiadających `Service.project`,
przeniesienia kont (użytkownicy ustawiają nowe hasła linkiem — skrótów scrypt nie importuje się do Supabase Auth),
konfiguracji SMTP Resend w Supabase oraz hostingu z dostępem do internetu.
