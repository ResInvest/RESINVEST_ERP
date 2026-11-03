# Użytkownicy, role i magazyny — ResInvest ERP 3.7

## 1. Główny administrator

Konto **`magazyn@resinvest.group`** (rola ADMINISTRATOR) powstaje przy pierwszym uruchomieniu z pustą bazą.
Hasło startowe **`Admin1234`** pochodzi z konfiguracji instalacji (`config/server.config.json` → `initialAdmin`,
tryb OFFLINE: `config/app.config.json` → `startup`), nie z kodu programu; przy pierwszym logowaniu program wymusza
ustawienie własnego hasła. Konto startowe powstaje tylko raz — gdy w bazie nie ma żadnego konta. Pusty `initialAdmin.email`
= ekran *Pierwsze uruchomienie* (hasło ustala osoba konfigurująca).
Administrator może tworzyć innych administratorów, nadawać i odbierać role.

## 2. Role

| Rola (kod) | W programie | Magazyny | Domyślne uprawnienia |
|---|---|---|---|
| **ADMINISTRATOR** | Administrator | wszystkie | wszystkie (`*`) — nie można ich ograniczyć |
| **MANAGER** | Kierownik | przydzielone | wprowadzanie operacji, zatwierdzanie, korekty i anulowania, inwentaryzacja (otwarcie, spis, zamknięcie), flota, kartoteki (produkty, kontrahenci), raporty z eksportem, historia, podgląd użytkowników |
| **MAGAZYNIER** | Magazynier | przydzielone | przyjęcia, wydania, produkcja, MM (wysłanie i przyjęcie), spis z natury, raporty, historia |
| **OBSERWATOR** | Obserwator | przydzielone | tylko odczyt: stany, dokumenty, raporty, historia |
| **AUDYTOR** | Audytor | wszystkie (odczyt) | raporty z eksportem, historia, dziennik audytu, podgląd użytkowników — bez zmian w danych |

Kod roli w danych: `admin`, `kierownik`, `magazynier`, `obserwator`, `audytor` (zgodność z wcześniejszymi wersjami).

## 3. Uprawnienia

| Uprawnienie | Znaczenie |
|---|---|
| `receipts.create`, `issues.create`, `production.create`, `mm.create` | wprowadzanie zakupów/przyjęć, sprzedaży/wydań, produkcji, przesunięć MM |
| `mm.receive` | przyjęcie MM w magazynie docelowym (tryb dwuetapowy); dodatkowo wymagany dostęp do magazynu docelowego |
| `op.approve` | zatwierdzanie operacji innych osób (gdy obieg zatwierdzania jest włączony) |
| `documents.cancel`, `documents.correct` | anulowanie i korekty dokumentów |
| `purchases.correct`, `sales.correct`, `production.correct`, `inventory.correct` | korekty wg rodzaju operacji |
| `inv.open`, `inv.count`, `inv.close` | okres inwentaryzacji: otwarcie, spis, zamknięcie |
| `fleet.edit`, `master.edit`, `warehouses.edit` | flota; produkty i kontrahenci; magazyny |
| `report.view`, `reports.export`, `history.read`, `audit.read` | odczyt stanów/dokumentów/raportów, eksport, historia, dziennik audytu |
| `users.read`, `users.manage`, `roles.assign`, `settings.edit` | podgląd kont; zapraszanie/edycja/statusy/hasła; zmiana uprawnień ról; konfiguracja |
| `data.backup`, `data.import` | kopia zapasowa; import kopii i dane przykładowe |

**Role i uprawnienia** (`#/admin/roles`): administrator zaznacza uprawnienia roli i zapisuje — zmiana obowiązuje
od razu dla wszystkich osób z tą rolą (audyt `ROLE_PERMISSIONS_CHANGED`); *Przywróć domyślne* cofa zmiany.
Uprawnienia są sprawdzane **w silniku na serwerze** przy każdej komendzie (warstwa `RIW.Service` + silnik);
przeglądarka tylko ukrywa niedostępne przyciski.

## 4. Statusy kont

| Status | Znaczenie | Logowanie |
|---|---|---|
| **INVITED** | zaproszenie wysłane (lub zgłoszenie rejestracji) — hasło jeszcze nieustawione | nie |
| **ACTIVE** | konto aktywne | tak |
| **SUSPENDED** | zawieszone czasowo (np. urlop, wyjaśnienia) | nie |
| **DISABLED** | dezaktywowane (osoba nie pracuje) | nie |

Konta z historią **nie są usuwane** — dezaktywacja zachowuje autorów dokumentów i wpisy audytu.
Usunąć można tylko konto bez historii (np. zaproszenie wysłane omyłkowo).
Zmiana statusu na inny niż ACTIVE kończy sesje użytkownika; dezaktywacja wysyła e-mail „Konto dezaktywowane”.

## 5. Magazyny i izolacja danych

Każdy użytkownik ma **magazyn domyślny** (`whId`) i listę **dostępnych magazynów** (`warehouseIds`, zawsze
zawiera magazyn domyślny). Role globalne (ADMINISTRATOR, AUDYTOR) mają dostęp do wszystkich magazynów.

* Magazyn operacji wynika z profilu użytkownika na serwerze — `warehouse_id`, `role`, `user_id` przesłane przez
  przeglądarkę są ignorowane. Zmiana magazynu roboczego (`me.warehouse`) jest możliwa tylko na magazyn dostępny.
* **Izolacja odczytu** (`Service.project`): serwer wysyła do przeglądarki wyłącznie dane dostępnych magazynów —
  operacje (magazyn źródłowy lub docelowy MM), księgę, inwentaryzację, wersje robocze (własne i do zatwierdzenia),
  flotę (magazynu lub wspólną), dziennik zmian (wpisy magazynu i własne; bez wpisów o kontach innych osób),
  listę osób dzielących magazyn. Kartoteki produktów i kontrahentów oraz lista magazynów są wspólne.
* **Izolacja zapisu**: korekta, anulowanie, zatwierdzenie i odrzucenie wymagają dostępu do magazynu operacji
  (`canAccessWh`), niezależnie od roli.
* Osoba z kilkoma magazynami przełącza magazyn roboczy znacznikiem magazynu na górnym pasku (lub w menu konta → *Magazyn*).

Magazyny dodaje i zmienia uprawnienie `warehouses.edit` (Administrator). Magazynu z dokumentami, ruchami,
przypisanymi osobami lub flotą nie można usunąć — tylko dezaktywować.

## 6. Zabezpieczenia administracyjne

* Nikt nie może zmienić **własnej** roli, zawiesić ani dezaktywować **własnego** konta.
* Rolę ADMINISTRATOR nadaje i odbiera wyłącznie administrator; konta administratorów zmienia tylko administrator.
* W systemie musi pozostać **co najmniej jeden aktywny administrator** — degradacja, zawieszenie, dezaktywacja
  i usunięcie ostatniego są blokowane (także przez innego administratora).
* Rola ADMINISTRATOR ma zawsze pełne uprawnienia (nie da się jej „wyłączyć” w edytorze ról).

## 7. Panel Użytkownicy (`#/admin/users`)

Tabela: **Użytkownik · E-mail · Rola · Magazyn · Status · Ostatnie logowanie · Akcje**.
Akcje: *Edytuj* (dane, rola, magazyn domyślny i dostępne, status), *Aktywuj*, *Zawieś*, *Dezaktywuj*,
*Wyślij ponownie zaproszenie*, *Reset hasła* (link e-mail), *Ustaw hasło tymczasowe*, *Odblokuj*,
*Zobacz historię* (dziennik audytu przefiltrowany do osoby), *Usuń* (tylko konto bez historii).
Formularz dodawania: Imię, Nazwisko, E-mail, Rola, Magazyn domyślny, Dostępne magazyny → **Wyślij zaproszenie**.
Kierownik i Audytor widzą listę bez możliwości zmian (`users.read`).

## 8. Obieg zatwierdzania i rejestracja (konfiguracja)

*Administracja → Konfiguracja dostępu* (uprawnienie `settings.edit`):

* **Obieg zatwierdzania operacji** — domyślnie **wyłączony**: osoba z uprawnieniem do wprowadzania zatwierdza operację
  sama. Włączony: operacje osób bez `op.approve` mają status DO ZATWIERDZENIA (bez numeru i wpływu na stany),
  zatwierdza kierownik magazynu.
* **Samodzielna rejestracja** — w nowej bazie 3.7 **włączona** (wyłączenie: odznacz pole; zostają zaproszenia e-mailem).
  Przebieg: zakładka *Rejestracja* → adres w domenie firmy (sprawdzany na serwerze) i hasło → (FIRMOWY) link potwierdzający
  na podany adres → powiadomienie administratorów → *Użytkownicy → Zgłoszenia rejestracji → Nadaj rolę i aktywuj*
  (rola, magazyn, dostęp) albo *Odrzuć* → e-mail „Konto zatwierdzone”. Rola i magazyn z przeglądarki są ignorowane —
  nadaje je wyłącznie administrator. Zatwierdzenie przed potwierdzeniem adresu jest zablokowane.

Każda zmiana: audyt `SETTINGS_CHANGED`.

## 9. Dziennik audytu (`#/admin/audit`)

Jeden dziennik dla operacji magazynowych i administracji (moduł *Historia* korzysta z tych samych wpisów).
Wpis: kto, kiedy, kod zdarzenia, akcja, obiekt, magazyn, **adres IP**, **przeglądarka (User-Agent)**, stan przed / po.
Wpisów nie można edytować ani usuwać (serwer dodatkowo prowadzi dziennik zmian z łańcuchem skrótów SHA-256).

Kody zdarzeń kont: `USER_CREATED`, `USER_INVITED`, `INVITE_SENT`, `INVITE_EMAIL_FAILED`, `USER_ACTIVATED`,
`USER_SUSPENDED`, `USER_DISABLED`, `USER_UPDATED`, `USER_DELETED`, `USER_REGISTERED`, `USER_UNLOCKED`,
`ROLE_CHANGED`, `WAREHOUSE_ACCESS_CHANGED`, `EMAIL_CHANGED`, `EMAIL_CONFIRMATION_SENT`, `EMAIL_CONFIRMATION_FAILED`,
`EMAIL_CONFIRMED`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `PASSWORD_CHANGED`,
`PASSWORD_SET_BY_ADMIN`, `ROLE_PERMISSIONS_CHANGED`, `SETTINGS_CHANGED`.
Zakładki: *Zdarzenia* (filtry: okres, kod, użytkownik, magazyn, tekst; CSV), *Logowania*, *Wiadomości e-mail* (FIRMOWY).

## 10. Dane przykładowe (szkolenie)

| E-mail | Osoba | Rola | Magazyny | Status |
|---|---|---|---|---|
| `magazyn@resinvest.group` | Mateusz Roesner | ADMINISTRATOR | wszystkie | ACTIVE |
| `anna.gorska@resinvest.group` | Anna Górska | MANAGER | Zabrze (domyślny), Brąszewice | ACTIVE |
| `adrian.wojciechowski@resinvest.group` | Adrian Wojciechowski | MAGAZYNIER | Zabrze | ACTIVE |
| `tomasz.zajac@resinvest.group` | Tomasz Zając | MANAGER | Brąszewice | ACTIVE |
| `pawel.kaczmarek@resinvest.group` | Paweł Kaczmarek | MAGAZYNIER | Brąszewice | ACTIVE |
| `michal.lewandowski@resinvest.group` | Michał Lewandowski | MANAGER | Rokitki | ACTIVE |
| `karolina.wisniewska@resinvest.group` | Karolina Wiśniewska | MAGAZYNIER | Rokitki | ACTIVE |
| `beata.nowak@resinvest.group` | Beata Nowak | OBSERWATOR | Zabrze | ACTIVE |
| `ewa.krawczyk@resinvest.group` | Ewa Krawczyk | AUDYTOR | wszystkie (odczyt) | ACTIVE |
| `jan.mazur@resinvest.group` | Jan Mazur | MAGAZYNIER | Rokitki | INVITED |

Hasło kont demonstracyjnych: `demo1234` (tylko dane przykładowe; na serwerze wymagana zmiana przy pierwszym logowaniu).
