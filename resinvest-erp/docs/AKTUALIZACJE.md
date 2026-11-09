# Aktualizacje i rozbudowa ResInvest ERP (od 3.9.1)

Program jest przygotowany do wieloletniej rozbudowy. Każda nowa wersja to nowy instalator, który instaluje się
**na istniejącej instalacji** („w miejscu”). Dane, konta, hasła i ustawienia zostają bez zmian.

## Jak wygląda aktualizacja

1. Pobierz nowy instalator `ResInvestERP_Setup_<wersja>.exe` i uruchom go na komputerze z serwerem (jako administrator).
   Odinstalowanie starej wersji nie jest potrzebne.
2. Instalator rozpoznaje poprzednią wersję i przed podmianą plików:
   - zatrzymuje uruchomiony serwer (okno „ResInvest ERP Serwer”),
   - robi kopię bazy danych do `C:\ProgramData\ResInvestERP\backups` (poleceniem starej wersji),
   - **blokuje instalację starszej wersji** na nowszej (zabezpieczenie danych).
3. Podmieniane są tylko pliki programu w `C:\Program Files\ResInvest ERP`. Nigdy nie są nadpisywane:
   - `C:\ProgramData\ResInvestERP` — baza `resinvest.sqlite`, kopie, dzienniki, wiadomości,
   - `C:\ProgramData\ResInvestERP\server.env` — poczta (SMTP / Resend), `APP_URL`,
   - `config\server.config.json` — port, sesje, kopie, HTTPS.
4. Przy pierwszym uruchomieniu nowej wersji serwer:
   - robi drugą, niezależną kopię `resinvest-<data>-przed-aktualizacja-<stara wersja>.sqlite` (zanim zmieni cokolwiek w bazie),
   - dodaje nowe kolumny / tabele i migruje dane do nowego schematu (migracja zapisana w dzienniku zmian),
   - sprawdza sumy kontrolne stanu i łańcuch skrótów dziennika (*Kontrola spójności bazy*).
5. Stanowiska (przeglądarki) dostają nową wersję automatycznie po odświeżeniu strony — nic nie instaluje się na komputerach pracowników.

**Aktualizacja do 3.10:** przy pierwszym starcie baza jest przenoszona do zapisu przyrostowego (każdy rekord w osobnym
wierszu z sumą kontrolną). Trwa to chwilę (2 lata pracy, 3000 operacji ≈ 1,5 s; dane po przeniesieniu sprawdzone — identyczne), wpis „system.storage” trafia do dziennika zmian,
a kopia „przed-aktualizacja-3_9_x” powstaje wcześniej. Powrót do 3.9.x — tylko z tej kopii (punkt niżej).

Kopie „przed-aktualizacja” nie są usuwane automatycznie (czyszczone są tylko kopie dzienne starsze niż `backup.keepDays`).

## Poprawki („łatki”) i nowe funkcje

| Rodzaj zmiany | Wersja | Jak dostarczana |
|---|---|---|
| Poprawka błędu, drobna zmiana | `3.9.1 → 3.9.2` | instalator aktualizacji, dane bez migracji |
| Nowa funkcja, nowe pola w danych | `3.10 → 3.11` | instalator aktualizacji + automatyczna migracja schematu (np. 9 → 10) |
| Duża przebudowa | `3.x → 4.0` | instalator + migracja; wcześniej test na kopii bazy |

Dlaczego rozbudowa jest bezpieczna:

- **Schemat danych ma numer** (`R.SCHEMA`). Każda wersja zawiera kolejne kroki migracji (`R.migrate`: 3 → 4 → … → 9).
  Starsze bazy są podnoszone krok po kroku.
- **Baza nowsza niż program** (np. po próbie powrotu do starszej wersji) nie jest otwierana do zapisu: serwer zgłasza
  nieobsługiwaną wersję schematu, a w dzienniku jest ostrzeżenie. Dane nie zostaną uszkodzone.
- **Tabele pomocnicze** (kolejka poczty, sesje, tokeny) dostają nowe kolumny poleceniem `ALTER TABLE ADD COLUMN`. Istniejące wiersze zostają.
- **Silnik programu jest jeden** (`app/src/engine.js`) — ten sam kod liczy stany w przeglądarce i na serwerze, więc nowa
  funkcja działa od razu w trybie lokalnym i firmowym.
- **Testy automatyczne** (jednostkowe, serwera, E2E, obciążeniowe, aktualizacji) są uruchamiane przed zbudowaniem
  każdego instalatora (`installer\build-installer.ps1`).

## Powrót do poprzedniej wersji (gdyby nowa sprawiała problem)

1. Zatrzymaj serwer.
2. Przywróć kopię sprzed aktualizacji. W menu Start / konsoli w katalogu programu:
   ```bat
   runtime\node.exe server\riw-server.mjs --data "%ProgramData%\ResInvestERP" --restore "%ProgramData%\ResInvestERP\backups\resinvest-<data>-przed-aktualizacja-<wersja>.sqlite"
   ```
   Bieżąca baza jest wcześniej zachowana jako `…-pre-restore.sqlite`.
3. Uruchom instalator starszej wersji z parametrem `/ALLOWDOWNGRADE=1`.

Uwaga: operacje wprowadzone po aktualizacji nie znajdują się w kopii sprzed aktualizacji. Zanotuj je albo wyeksportuj
(CSV ewidencji) przed powrotem.

## Dobre praktyki

- Aktualizuj po zakończeniu pracy (np. wieczorem); pracownicy powinni zapisać otwarte formularze.
- Przed dużą aktualizacją (zmiana pierwszej lub drugiej cyfry wersji) skopiuj folder `backups` poza serwer.
- Po aktualizacji uruchom *Kontrola spójności bazy* (menu Start) i sprawdź wersję w stopce programu.
