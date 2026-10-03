# AI Document Scanner Test — analiza ResInvest ERP i plan integracji

Dokument opisuje wynik analizy ResInvest ERP 3.5.0 (tryb read-only) i warunki ewentualnej integracji.
Na etapie testu **nic z poniższego planu nie jest zaimplementowane w ERP**.

## 1. Analiza istniejącego projektu (tylko odczyt)

| Obszar | Stan w ResInvest ERP 3.5.0 |
|---|---|
| Technologia | Node.js 22.13+ (moduły `.mjs`), interfejs w jednym pliku `ResInvest_ERP.html` (vanilla JS), **bez bibliotek zewnętrznych** |
| Baza | `node:sqlite` na serwerze (`resinvest.sqlite`, dziennik zmian z łańcuchem SHA-256, kopie codzienne) albo `localStorage` w trybie offline |
| Prisma | **brak** — nie ma modeli Prisma ani migracji; model danych to JSON stanu (schemat 9) |
| Dokumenty | operacje `ZAKUP` / `SPRZEDAZ` / `PRODUKCJA` / `MM` tworzą dokumenty PZ, WZ, PW, RW, MM, TR, KOR, AN, IN, BO (numer `PZ/001/08/2026`, ręczne numery, `docDate`) |
| Kartoteki | `products` (jednostki m3 / MP / t), `partners` (dostawcy, odbiorcy, nadleśnictwa z listą leśnictw), `carriers`, `fleet` (pojazdy z nr rej., kierowcy, operatorzy, rębaki), `warehouses` |
| Transport | `transport.runs[]`: `reg`, `driver`, `km`, `kwit`, `kwitM3`, `weightT`; przewoźnik `external.company` |
| Tonaż | `weightMode: auto/manual`, `weightManual` (kwit wagowy), przelicznik `mp_t` |
| AI / OCR | **brak dostawcy** w projekcie i konfiguracji (`.env.example`: tylko Resend i nieużywany Supabase) |

Dlatego moduł testowy:
* nie dodaje niczego do ERP, działa obok jako osobny proces (port 8095),
* używa tych samych konwencji (Node 22, `.mjs`, `server.env`, zero CDN, PL),
* do jedynej zależności runtime dobrano oficjalne SDK dostawcy (`@anthropic-ai/sdk`), ładowane leniwie —
  provider mock działa bez niego.

## 2. Wybór providera

| Kryterium | Claude (Anthropic API) — wybrany do testu | Alternatywy (do porównania później) |
|---|---|---|
| Rozpoznanie typu dokumentu i pól | tak, w jednym wywołaniu (rozumienie układu, polskie dokumenty, pismo odręczne) | Azure Document Intelligence / Google Document AI: OCR + modele niestandardowe (wymagają trenowania) |
| Struktura wyniku | wymuszony schemat JSON (structured outputs) | zależnie od usługi |
| Współrzędne fragmentów | przybliżone (podawane przez model) | dokładne (słowo / linia) |
| Klucz | serwer (`server.env`), nigdy przeglądarka | serwer |
| Lokalnie bez internetu | nie | Tesseract (słaby na zdjęciach i piśmie odręcznym, bez rozumienia pól) |

Kontrakt `src/providers/provider.mjs` pozwala dodać kolejny provider bez zmian w normalizacji, interfejsie i testach
(np. hybryda: OCR ze współrzędnymi słów + Claude do przypisania pól).

## 3. Mapowanie pól skanera na dane ERP (do przyszłej integracji)

| Pole skanera | ERP | Uwagi |
|---|---|---|
| `docType` PZ / WZ | `operation.type` ZAKUP / SPRZEDAZ | kwit wywozowy → ZAKUP z produkcją leśną; kwit wagowy → tonaż istniejącej operacji |
| `docNumber` | `input.docNos.PZ/WZ` (tryb ręczny) albo `input.extDoc`; kwit → `transport.runs[].kwit` | unikalność numeru sprawdza ERP |
| `docDate` | `input.docDate` | ISO w `normalized` |
| `supplier` / `recipient` | `purchase.supplierId` / `sale.buyerId` | przez podpowiedź z kartoteki (`erpMatches`), zawsze z potwierdzeniem |
| `forestDistrict` / `forestRange` | `production.ndl` / `production.lesnictwo` | |
| `product` | `productId` | |
| `quantity` | `qty` + `unit` | jednostka wyłącznie z dokumentu |
| `netWeight` (t) | `weightMode: "manual"` + `weightManual` | `normalized.kg / 1000` |
| `vehicleReg`, `driver`, `carrier` | `transport.runs[].reg/driver`, `external.company`, `fleet` | |

## 4. Warunki bezpiecznej integracji (rekomendacja)

1. **Najpierw test na prawdziwych zdjęciach** (min. 50–100 dokumentów każdego typu): odsetek pól poprawionych ręcznie,
   pola z najczęstszymi błędami, rzeczywisty koszt i czas.
2. Integracja jako **„szkic operacji”** (`drafts` w ERP), nigdy bezpośrednie księgowanie: użytkownik otwiera
   formularz ERP wypełniony danymi ze skanu, poprawia i zatwierdza standardową ścieżką (walidacja, symulacja sald,
   zapis atomowy, audyt). Silnik ERP pozostaje jedynym miejscem zmiany stanów.
3. Endpoint w ERP Serwerze z uprawnieniem (np. `documents.scan`), sesją i izolacją magazynów; klucz w `server.env`.
4. Zdjęcie dokumentu jako załącznik operacji + wpis w dzienniku audytu (kto, kiedy, provider, model, korekty).
5. Dopasowanie kartotek wyłącznie jako podpowiedź; nowe kontrahenty / pojazdy tylko ręcznie.
6. Instalator: dołączenie modułu do `ResInvestERP.iss`, `npm install --omit=dev` przy budowie.

**Ocena:** architektura testu (kontrakt providera, osobny magazyn, brak zapisu do ERP, schemat pól zgodny
z kartotekami) pozwala na bezpieczną integrację przez szkice operacji — po pozytywnym teście jakości.
