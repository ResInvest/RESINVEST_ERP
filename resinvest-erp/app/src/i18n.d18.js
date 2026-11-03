/* Słownik CS/EN — część 18 (3.7: motyw Szkło, rejestracja z potwierdzeniem e-mail, czysta baza i konto startowe administratora) */
(function (root) { "use strict"; (root.RIW_I18N || require("./i18n.js")).addPairs({
  "Szkło (pastelowy)": ["Sklo (pastelový)", "Glass (pastel)"],
  /* --- 3.7.2: konto testowe administratora --- */
  "konto z konfiguracji instalacji": ["účet z konfigurace instalace", "account from the installation configuration"],
  "Odtworzenie konta z konfiguracji instalacji: {l}": ["Obnovení účtu z konfigurace instalace: {l}", "Account restored from the installation configuration: {l}"],
  "Konto testowe administratora": ["Testovací účet správce", "Test administrator account"],
  "Administrator testowy": ["Testovací správce", "Test administrator"],
  "hasło": ["heslo", "password"],
  "AgentMail (API HTTPS)": ["AgentMail (API HTTPS)", "AgentMail (HTTPS API)"],
  "Kliknij, aby wpisać dane konta testowego, i zaloguj się. Konto działa niezależnie od danych zapisanych w tej przeglądarce (okres testów).": ["Kliknutím vyplníte údaje testovacího účtu a přihlásíte se. Účet funguje nezávisle na datech uložených v tomto prohlížeči (zkušební období).", "Click to fill in the test account details, then sign in. The account works regardless of data saved in this browser (testing period)."],
  /* --- czysta baza, konto startowe --- */
  "konto startowe administratora": ["počáteční účet správce", "initial administrator account"],
  "Zachowano kopię uszkodzonych danych i uruchomiono czystą bazę. {p}": ["Kopie poškozených dat byla uložena a spuštěna čistá databáze. {p}", "A copy of the damaged data was kept and a clean database was started. {p}"],
  "Czysta baza danych": ["Čistá databáze", "Clean database"],
  "Dane demonstracyjne poprzednich wersji zostały usunięte z tej przeglądarki (kopia zachowana). Program startuje od zera.": ["Ukázková data předchozích verzí byla z tohoto prohlížeče odstraněna (kopie uložena). Program začíná od nuly.", "Demo data from previous versions was removed from this browser (a copy was kept). The program starts from scratch."],
  "Pierwsze uruchomienie: zaloguj się kontem administratora {e} hasłem startowym z instrukcji instalacji — program poprosi o ustawienie własnego hasła.": ["První spuštění: přihlaste se účtem správce {e} počátečním heslem z instalačního návodu — program vás vyzve k nastavení vlastního hesla.", "First start: sign in with the administrator account {e} using the initial password from the installation guide — the program will ask you to set your own password."],
  /* --- rejestracja --- */
  "e-mail potwierdzony": ["e-mail potvrzen", "e-mail confirmed"],
  "Czeka na potwierdzenie adresu e-mail": ["Čeká na potvrzení e-mailové adresy", "Waiting for e-mail address confirmation"],
  "Wyślij link ponownie": ["Odeslat odkaz znovu", "Resend link"],
  "Adres e-mail {e} potwierdzony. Zgłoszenie trafiło do administratora — po zatwierdzeniu dostaniesz e-mail i zalogujesz się tym adresem.": ["E-mailová adresa {e} potvrzena. Žádost byla předána správci — po schválení obdržíte e-mail a přihlásíte se touto adresou.", "E-mail address {e} confirmed. The request has been passed to the administrator — after approval you will receive an e-mail and can sign in with this address."],
  "Konto {e} zarejestrowane. Wysłaliśmy link potwierdzający na ten adres — kliknij go, a następnie administrator nada rolę i magazyn.": ["Účet {e} zaregistrován. Na tuto adresu jsme poslali potvrzovací odkaz — klikněte na něj, poté správce přidělí roli a sklad.", "Account {e} registered. We sent a confirmation link to this address — click it, then the administrator will assign a role and warehouse."],
  "Konto {e} zarejestrowane, ale nie udało się wysłać e-maila z linkiem potwierdzającym. Poproś administratora o ponowne wysłanie.": ["Účet {e} zaregistrován, ale e-mail s potvrzovacím odkazem se nepodařilo odeslat. Požádejte správce o opětovné odeslání.", "Account {e} registered, but the e-mail with the confirmation link could not be sent. Ask the administrator to resend it."],
  "Zgłoszenie czeka na potwierdzenie adresu e-mail przez użytkownika — zatwierdzenie będzie możliwe po kliknięciu linku z wiadomości (możesz wysłać go ponownie).": ["Žádost čeká na potvrzení e-mailové adresy uživatelem — schválení bude možné po kliknutí na odkaz ve zprávě (můžete ho odeslat znovu).", "The request is waiting for the user to confirm the e-mail address — approval will be possible after the link in the message is clicked (you can resend it)."],
  "Adres e-mail niepotwierdzony": ["E-mailová adresa nepotvrzena", "E-mail address not confirmed"],
  "E-mail: {e}": ["E-mail: {e}", "E-mail: {e}"],
  "Telefon: {p}": ["Telefon: {p}", "Phone: {p}"],
  "Zatwierdź w: Administracja → Użytkownicy (nadaj rolę i magazyn) albo odrzuć zgłoszenie.": ["Schvalte v: Správa → Uživatelé (přidělte roli a sklad), nebo žádost zamítněte.", "Approve in: Administration → Users (assign a role and warehouse) or reject the request."],
  "Nowe zgłoszenie rejestracji: {n}": ["Nová žádost o registraci: {n}", "New registration request: {n}"],
  "rejestracja — adres e-mail niepotwierdzony": ["registrace — e-mailová adresa nepotvrzena", "registration — e-mail address not confirmed"],
  "Potwierdź adres e-mail — kliknij link z wiadomości wysłanej po rejestracji. Potem administrator nada rolę i magazyn.": ["Potvrďte e-mailovou adresu — klikněte na odkaz ze zprávy zaslané po registraci. Poté správce přidělí roli a sklad.", "Confirm your e-mail address — click the link in the message sent after registration. Then the administrator will assign a role and warehouse."],
  "Powiadomienie o zatwierdzeniu konta: {l}": ["Oznámení o schválení účtu: {l}", "Account approval notification: {l}"],
  "Zbyt wiele prób rejestracji dla tego adresu. Spróbuj za godzinę.": ["Příliš mnoho pokusů o registraci pro tuto adresu. Zkuste to za hodinu.", "Too many registration attempts for this address. Try again in an hour."]
}); })(typeof globalThis !== "undefined" ? globalThis : this);
