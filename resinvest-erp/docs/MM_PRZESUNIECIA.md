# Przesunięcia międzymagazynowe (MM) — ResInvest ERP 3.3

Dokument opisuje logikę biznesową, model danych, interfejs i zabezpieczenia modułu MM od wersji 3.3.0.

## 1. Zakres zmian

| Wymaganie | Realizacja |
|---|---|
| Swobodny wybór magazynu źródłowego | pole **Magazyn źródłowy** (`mm.fromWhId`) jest aktywne; lista = magazyny, do których użytkownik ma dostęp (`R.whAccess`) i które są aktywne |
| Swobodny wybór magazynu docelowego | pole **Magazyn docelowy** (`mm.toWhId`) — wszystkie aktywne magazyny firmy (magazyn źródłowy oznaczony na liście) |
| Walidacja: źródło ≠ cel | silnik zwraca błąd pola `mm.toWhId` „Magazyn źródłowy i docelowy nie mogą być takie same” (kod `SAME_WH`); formularz go wyświetla i blokuje zatwierdzenie |
| Rozchód w źródle / przychód w celu | zapis w księdze w jednej, atomowej zmianie stanu (`commitOperation` → host zapisuje stan jedną transakcją SQLite) |
| Tryb dwuetapowy „W drodze” → „Przyjmij MM” | `config.mmMode = "two"` (domyślnie); przełącznik w *Administracji → Konfiguracja dostępu* |
| Tonaż ręczny / automatyczny | `mm.weightMode` = `auto` (przelicznik produktu) albo `manual` (`mm.weightManual`, kwit wagowy) — przy wysłaniu i przy przyjęciu |

## 2. Pliki

| Warstwa | Plik | Co zawiera |
|---|---|---|
| Silnik (wspólny: przeglądarka i serwer) | `app/src/engine.js` | `planOperation` (sekcja „E. MM”), `commitOperation`, `planReceive`, `receiveTransfer`, `mmInTransit`, `mmState`, `MM_MODES`, `MM_STATES`, `MM_DIFF_REASONS`, korekta MM (`planCorrection`), raport MM (`Reports.business().mm`), `Settings.KEYS.mmMode`, migracja 6 → 7 |
| Usługa (komendy) | `app/src/service.js` | komenda `mm.receive` (uprawnienie `mm.receive`); `op.commit` bez zmian |
| API serwera | `server/core.mjs`, `server/riw-server.mjs` | bez zmian — `POST /api/cmd` z `cmd: "mm.receive"` przechodzi przez `Service.run` (kopia stanu, zapis „wszystko albo nic”, dziennik zmian) |
| Formularz | `app/src/form.js` | sekcja MM: wybór źródła i celu, ilość, jednostka, tonaż, stany przed → po (cel: „po przyjęciu”), informacja o trybie |
| Widoki | `app/src/views.js` | okno **Przyjmij MM** (`ReceiveDialog`), panel „Przesunięcia w drodze”, znaczniki W DRODZE / PRZYJĘTE, szczegóły operacji, dokument MM (druk / PDF), raport MM |
| Pulpit | `app/src/dashboard.js` | alerty „MM do przyjęcia” i „MM wysłane — w drodze” |
| Administracja | `app/src/admin.js` | przełącznik trybu MM, uprawnienie `mm.receive` w edytorze ról |
| Tłumaczenia | `app/src/i18n.d14.js` | teksty CS / EN |
| Dane przykładowe | `app/src/seed.js`, `data/sample_data.json` | MM Zabrze → Brąszewice: wysłanie + przyjęcie z tonażem z wagi |

## 3. Przebieg (tryb dwuetapowy)

```
Nowa operacja → MM ──(Zatwierdź)──► WYSŁANIE
   magazyn źródłowy: −ilość (księga, kat. MM)          status dokumentu: ZATWIERDZONY
   magazyn docelowy: bez zmian                          stan MM: W DRODZE
                                   │
                  magazyn docelowy: „Przyjmij MM”
                  (ilość faktyczna, jednostka, data, tonaż, przyczyna różnicy)
                                   ▼
                              PRZYJĘCIE
   magazyn docelowy: +ilość przyjęta (księga, kat. MM, ten sam numer MM)
   różnica = wysłano − przyjęto (ubytek > 0 / nadwyżka < 0) z przyczyną   stan MM: PRZYJĘTE
```

Tryb jednoetapowy: zatwierdzenie zapisuje oba ruchy naraz (jak w wersjach ≤ 3.2); stan MM = PRZYJĘTE od razu.
Tryb zapisuje się w dokumencie (`op.mm.twoStage`) — zmiana przełącznika nie zmienia dokumentów już wysłanych.

## 4. Model danych

`op.mm` (operacja typu MM):

| Pole | Znaczenie |
|---|---|
| `fromWhId`, `fromWhName`, `toWhId`, `toWhName` | magazyn źródłowy i docelowy (`op.whId` = źródło, `op.toWhId` = cel) |
| `productId`, `qty`, `unit`, `stockQty`, `stockUnit` | ilość w jednostce dokumentu i w jednostce magazynowej |
| `weightMode`, `weightT`, `autoWeight` | tonaż wysłany: sposób, wartość, wartość z przelicznika |
| `twoStage` | `true` — dokument dwuetapowy |
| `receipt` | `null` (w drodze) albo `{ date, ts, userId, userName, qty, unit, stockQty, diff, reason, reasonLabel, note, weightMode, weightT, key }` |

Stan przesunięcia wylicza `R.mmState(op)`: `W_DRODZE` · `PRZYJETE` · `ANULOWANE` (`null` dla innych operacji).
Towar w drodze nie należy do żadnego magazynu — suma stanów firmy jest w tym czasie mniejsza o ilość w drodze
(widoczną w panelu „Przesunięcia w drodze” i w raporcie MM).

## 5. Walidacja i bezpieczeństwo (po stronie serwera)

* Magazyn źródłowy z przeglądarki (`mm.fromWhId`) jest **tylko wyborem** — silnik sprawdza `canAccessWh(user, fromWhId)`;
  brak dostępu → błąd pola `mm.fromWhId`, kod `FORBIDDEN`. Nieznany / nieaktywny magazyn — błąd.
* Ilość nie większa niż stan magazynu źródłowego; symulacja kroków nie dopuszcza stanu ujemnego.
* Zamknięty okres: wysyłka sprawdza okres źródła (jednoetapowe — także celu); przyjęcie sprawdza okres celu w dacie przyjęcia.
* Przyjęcie: tylko dokument MM dwuetapowy, nieanulowany, nieprzyjęty; uprawnienie `mm.receive` **i** dostęp do
  magazynu docelowego; data nie z przyszłości i nie wcześniejsza niż wysłanie; różnica wymaga przyczyny
  (`inna` — także opisu); przyjęcie zerowe wymaga opisu.
* Idempotencja: formularz wysyła klucz `idemKey` (wysłanie) i `key` (przyjęcie) — ponowienie żądania nie tworzy
  drugiego zapisu.
* Audyt: `Wysłanie MM do magazynu … — w drodze`, `Przyjęcie MM …` / `Przyjęcie MM z różnicą …` (kod `MM_RECEIVED`),
  ze stanem przed / po, tonażem, przyczyną różnicy, IP i przeglądarką.

## 6. Anulowanie i korekta

* **Anulowanie** w drodze → zwrot na stan źródła; przyjęcie niemożliwe. Anulowanie po przyjęciu → odwrócenie obu
  ruchów (z kontrolą, czy towar w celu nie został już wydany).
* **Korekta** zmienia ilość / tonaż wysłany. Dla MM przyjętego przyjęcie pozostaje bez zmian, a różnica
  (`receipt.diff`) jest przeliczana. Magazynów i towaru nie zmienia się korektą (anulowanie + nowy dokument).
* Błędnie wpisanego przyjęcia nie poprawia się korektą — anuluj MM i wprowadź nowe (dokumenty zostają w historii).

## 7. Konfiguracja

| Miejsce | Klucz | Wartości |
|---|---|---|
| `config/app.config.json` (nowe instalacje) | `mmMode` | `"two"` (domyślnie) · `"one"` |
| Administracja → Konfiguracja dostępu | *Przesunięcia międzymagazynowe (MM)* | jak wyżej; zmiana w dzienniku audytu (`SETTINGS_CHANGED`) |

Migracja 6 → 7 (automatyczna): `config.mmMode = "two"`, role z nadpisanymi uprawnieniami zawierającymi
`mm.create` dostają `mm.receive`.

## 8. Testy

| Zestaw | Co sprawdza |
|---|---|
| `tests/engine.test.mjs` (8 testów MM) | tryb jedno- i dwuetapowy, przyjęcie pełne / z różnicą / w innej jednostce, uprawnienia i dostęp, wybór źródła i manipulacja `fromWhId`, ten sam magazyn, tonaż, anulowanie w drodze i po przyjęciu, korekta, przełącznik i migracja |
| `tests/auth.test.mjs` | MM przez HTTP: odrzucenie `fromWhId` bez dostępu, widoczność „w drodze” u odbiorcy, 403 dla obserwatora, przyjęcie z ubytkiem, drugie przyjęcie odrzucone |
| `tests/e2e.cjs` | formularz: aktywne pole źródła, listy magazynów, błąd tego samego magazynu, stany przed → po, tonaż auto i ręczny, W DRODZE, panel „do przyjęcia”, okno przyjęcia z wymaganą przyczyną różnicy |
