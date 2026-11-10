# ResInvest ERP 3.15 — wydajność: problemy, strategie, wprowadzone zmiany

Zasada: **zachowanie programu i dane bez zmian**. Każda zmiana została sprawdzona porównaniem wyników
starego i nowego kodu (bajt w bajt) oraz pełnym zestawem testów.

## 1. Jak mierzono

* Bazy testowe zbudowane z danych przykładowych + N operacji wykonanych przez `Service` (z audytem i powiadomieniami):
  40% zakup drewna, 10% zakup zrębki, 20% produkcja, 20% sprzedaż, 10% MM; 3 magazyny, ok. 20 operacji dziennie.
  * **3 tys.** operacji — 3 632 wpisy księgi, stan 17,8 MB JSON,
  * **15 tys.** operacji — 18 032 wpisy księgi, stan 80 MB JSON (kilka lat pracy firmy).
* Maszyna 4 vCPU, Node 22. Pomiary: czas komendy w `Store.execute`, profil wierszy (`--cpu-prof`), czas raportów,
  czas rysowania ekranów w Chromium (tryb serwera, administrator).

## 2. Znalezione wąskie gardła (od największego)

| # | Miejsce | 3 tys. | 15 tys. | Przyczyna |
|---|---|---|---|---|
| 1 | Zapis komendy — `Store.saveState` (`server/core.mjs`) | 5,3 ms | 22,2 ms | dla każdej zmienionej kolekcji (operacje, księga, audyt) pełny przebieg: zbiór `seen`, `Map.get` i `Map.set` dla **każdego** rekordu historii |
| 2 | Silnik przy zatwierdzaniu — `Stock.balance` (`engine.js`) | 2,3 ms | 11,8 ms | stan liczony przejściem całej księgi przy każdym sprawdzeniu dostępności |
| 3 | Raport biznesowy z filtrem produktu | ~8 ms | ~368 ms | `ledger.some` dla każdej operacji = O(operacje × księga) |
| 4 | Sekcja MM raportu biznesowego (tryb roczny) | — | 142–275 ms | `filter`/`some` po księdze okresu dla każdej operacji MM |
| 5 | Historia operacji (`Reports.history`) | ~4 ms | ~32 ms | wiersze budowane dla całej księgi, filtr dat dopiero na końcu; `indexOf` dla każdej operacji z transportem |
| 6 | Pełny odczyt stanu — `JSON.stringify` w `stateView` | 119 ms | 500 ms (admin) | serializacja całego stanu w wątku głównym przy pierwszym wczytaniu |
| 7 | Ekran „Operacje” w przeglądarce | 340 ms | 1,4–1,6 s | rysowane wszystkie operacje magazynu (6 006 wierszy przy 15 tys.) |
| 8 | Zmiana danych przez innego użytkownika | — | 40–110 ms na rewizję | każda rewizja SSE = osobne pełne przebudowanie bieżącego ekranu |
| 9 | Start serwera — `R.migrate` | — | ~0,9 s z 2,5 s | głęboka kopia świeżo wczytanego stanu |

Sprawdzone i **niebędące** problemem: kopia robocza komendy (0,1–0,3 ms), `deepFreeze` nowych rekordów,
transakcja SQLite (ok. 2 ms, stała), `Stock.byProduct`, karty produktów, paczki zmian (8–17 kB), kompresja gzip
(już poza wątkiem głównym od 3.14).

## 3. Wprowadzone zmiany (3.15)

### 3.1 Zapis komendy — szybka ścieżka w `Store.saveState`
Gdy nowa tablica kolekcji to poprzednia tablica bez zmian pozycji (te same rekordy albo podmienione rekordy o tym samym
identyfikatorze) plus rekordy dopisane na końcu — a tak wygląda każda zwykła operacja — porównywane są tylko wskaźniki,
a mapy kolejności aktualizowane wyłącznie dla zmienionych rekordów. Te same kontrole (brak identyfikatora, powtórzony
identyfikator, te same komunikaty), te same wartości `ord`, ten sam skrót do dziennika. Każdy inny kształt zmiany
(import, przycinanie powiadomień, usunięcia) idzie dotychczasową pełną ścieżką. Warunek (`ordStrict`) sprawdzany przy
wczytaniu bazy.

### 3.2 Stan magazynowy bez daty — indeks sum
`Stock.balance` bez daty granicznej czyta sumę z indeksu magazyn → produkt → suma, budowanego **w kolejności księgi**
(wynik bit w bit jak pętla). Księga jest wyłącznie dopisywana (korekta, anulowanie i usunięcie dokumentu dopisują
wpisy odwracające), więc indeks dolicza tylko nowe wpisy; kopia robocza komendy przejmuje sumy poprzedniej księgi, gdy
jej wpisy są początkiem nowej tablicy (porównanie wskaźników). Zapytania z datą — bez zmian.

### 3.3 Raporty
* filtr produktu: jeden zbiór operacji z zapisem księgi produktu zamiast przeszukiwania księgi dla każdej operacji,
* sekcja MM: wpisy okresu pogrupowane raz wg operacji (kolejność zachowana),
* historia: wiersze budowane tylko dla wpisów, które przejdą filtr dat / magazynu / produktu (saldo bieżące nadal
  liczone ze wszystkich wpisów); numer kolejny wiersza transportu z indeksu pętli zamiast `indexOf`.

### 3.4 Przeglądarka — jedno odświeżenie na klatkę
Kilka zmian innych użytkowników (SSE) w jednej klatce ekranu daje jedno przebudowanie widoku zamiast kilku.

## 4. Wyniki

| Pomiar | Przed | Po | Zysk |
|---|---|---|---|
| `Store.execute("op.commit")`, baza 15 tys. (średnio / p95) | 34,3 / 45 ms | 8,2 / 14,6 ms | **×4** |
| Zapis stanu (`saveState`), 15 tys. | 22,2 ms | 3,3 ms | ×6,7 |
| 99 komend scenariusza, baza 15 tys. | 2 415 ms | 723 ms | ×3,3 |
| 99 komend scenariusza, baza 3 tys. | 637 ms | 286 ms | ×2,2 |
| Raport biznesowy z filtrem produktu, 15 tys. | ~368 ms | ~7 ms | ×50 |
| 399 zapytań raportów i stanów, baza 15 tys. | 221 s | 3,2 s | ×69 |
| 455 zapytań raportów i stanów, baza 3 tys. | 4,8 s | 0,7 s | ×6,6 |

Przy 40 jednoczesnych użytkownikach serwer obsługuje więc ok. 4 razy więcej zapisów na sekundę na tej samej maszynie,
a raporty roczne i z filtrami nie blokują serwera.

## 5. Dowód identyczności wyników

* **Raporty i stany:** ten sam zestaw zapytań (stany z datą i bez, `byProduct`, raport biznesowy miesięczny i całościowy
  z filtrami magazynu / produktu / kontrahenta, historia z zakresami, filtrami, typem i wyszukiwaniem) wykonany na
  silniku przed i po zmianie — skrót SHA-256 wszystkich wyników identyczny: baza 3 tys. `5f3d7f90…`, baza 15 tys. `6e37c6a3…`.
* **Zapis:** scenariusz testów regresji (99 komend: wszystkie typy operacji, przyjęcie MM, korekta, anulowanie,
  odmowy) na kopiach baz 3 tys. i 15 tys. starym i nowym `Store` — identyczne: wyniki komend, odciski tabel `rows`,
  `state` i `journal` (łańcuch skrótów), wartości `ord` każdego rekordu, kontrola spójności dziennika.
* **Testy:** jednostkowe, serwerowe, e2e i PostgreSQL — wszystkie zaliczone (liczby w README).

## 6. Do decyzji właściciela / dalsze kroki

| Propozycja | Efekt | Dlaczego nie teraz |
|---|---|---|
| „Operacje”: 200 najnowszych + „Pokaż wcześniejsze” (jak rejestr dokumentów) | ekran 1,5 s → ok. 0,1 s przy 15 tys. | zmienia to, co widzi użytkownik — wymaga akceptacji |
| Indeks numerów dokumentów (magazyn, rok) dla `docNoTaken` | kolejne ok. 3,5 ms na komendę przy 15 tys. | wymaga osobnej weryfikacji (numeracja jest kluczowa) |
| Pamięć podręczna JSON rekordów w `stateView` | pełny odczyt 500 → 213 ms (admin, 15 tys.) | +80–160 MB pamięci serwera |
| `migrate` bez kopii świeżo wczytanego stanu | start serwera −0,9 s przy 15 tys. | zysk tylko przy starcie |
| Pulpit: pamięć wyników raportów wg rewizji | ok. 50 ms na odświeżenie pulpitu | niski priorytet |
