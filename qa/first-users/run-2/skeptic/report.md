# Usability test — run-2 — persona "skeptic" (Anna Górska, Kierownik)
> Saved by the QA lead from the subagent's returned report; content unchanged, condensed formatting.

## 1. Think-aloud log
| # | Expectation | Result | Screenshot |
|---|---|---|---|
| 1 | Landing with company info + legal links | Full-screen forest intro, music autoplay prompt; console 404 /api/health | 01-landing.png |
| 2 | "Pomiń intro →" → login with Regulamin / Polityka / Cennik | Login, "OFFLINE Tryb lokalny — dane zapisywane w tej przeglądarce"; no legal/pricing/contact links; publicly lists test admin "test@resinvest.group · hasło: Test1234" and 9 demo accounts (demo1234) | 02-login.png |
| 3 | Footer legal links | Only "ResInvest ERP 3.11.0 · Konto blokuje się na 15 min po 5 nieudanych próbach" and credit line; 2 justified fields | 03-login-footer.png |
| 4 | Log in | "Pulpit — RiC Zabrze", no errors | 04-after-login.png |
| 5 | Account menu: privacy / export / delete | Moje konto / Zmiana hasła / Magazyn / Użytkownicy / Wyloguj — nothing on privacy/deletion | 05-account-menu.png |
| 6 | "Moje konto" | role, warehouses, "Tryb pracy OFFLINE lokalny (ta przeglądarka)", 30-min idle logout, Zmień hasło, Wyloguj; no delete/export/privacy | 06-my-profile.png |
| 7 | "Administracja" | JSON backup ("Hasła nie trafiają do kopii"), Administrator only; data in this browser; server edition with SQLite + automatic backups mentioned; no warning that clearing browser data deletes everything | 07-administracja.png |
| 8 | (stale element slip) | Landed on Użytkownicy: "Konto z historią dezaktywuje się — historia zostaje"; Kierownik "tylko podgląd" | 08-new-operation.png |
| 9 | "Nowa operacja" | Zakup preselected; "Numeracja WZ: Automatycznie — WZ/001/11/2026"; hint: all documents incl. PZ share one WZ series | 09-new-operation.png, 10-form-numbering.png |
| 10 | Type "Lander" (placeholder example) → suggestions | No list; "nowy dostawca zostanie dopisany do kartoteki" although "Lander Agro" exists | 11-supplier-suggest.png |
| 11 | Type "La" | still none; "Nazwa dostawcy musi mieć co najmniej 3 znaki" | 12-supplier-typing.png |
| 12 | Exact "Gospodarstwo Leśne Jan Nowicki" | "z kartoteki ✓" | 13-supplier-existing.png |
| 13–15 | Drewno opałowe, 20, 230 | 4 600,00 zł; 986 → 1 006 m³; ≈19,04 t live; "Przebieg" PZ vs "Plan dokumentów" WZ; date placeholder mm/dd/yyyy | 14-form-filled.png |
| 16 | Nr dok. zewn. FV 12/11/2026, "Zatwierdź…" | Clear summary; "WZ = wspólna seria numerów…, nie oznacza wydania"; ext. doc number not shown in summary; "osoba z uprawnieniem może też usunąć dokument" | 15-confirm-summary.png |
| 17 | "Zatwierdź dokument" | "Dokument zatwierdzony: WZ/001/11/2026"; FV saved; buttons Anuluj / Usuń… / Koryguj / Powtórz | 16-after-save.png |
| 18 | "Zamknij" → "Historia" | 01.11.2026 19:11 · Anna Górska · Zakup · WZ/001/11/2026 · Drewno opałowe · 20 m³ · 986/+20/1 006 · Gospodarstwo Leśne Jan Nowicki · ZATWIERDZONY — FIRST SUCCESS | 17-history.png |

## 2. Friction table
| # | Sev | Quote | URL / screen | Screenshot | Console | Failed req | What happened |
|---|---|---|---|---|---|---|---|
| 1 | 3 | "Admin password printed on the login page?" | login | 02, 03 | none | none | test@resinvest.group / Test1234 + 9 employee e-mails with demo1234 publicly shown. |
| 2 | 3 | "Where are Regulamin, Polityka prywatności (RODO), contact? Who is the data controller?" | login, footer, app | 02, 03, 06 | none | none | No terms/privacy/cookie/contact pages; no pricing; nothing says internal tool. |
| 3 | 2 | "I can't delete my account, export my data, or see who can see it." | #/profil, #/uzytkownicy | 06, 08 | none | none | No self-service delete/export; admin deactivation only. |
| 4 | 2 | "If IT clears my browser, stock records are gone? And I may not back up." | #/administracja | 07 | none | none | Backup admin-only; no warning about clearing browser data / shared PC. |
| 5 | 1 | "Music autoplay on a business login? Not serious." | intro | 01 | 404 | GET /api/health 404 | Intro with music before login. |
| 6 | 3 | "Goods receipt numbered WZ/001/11/2026 — accountant will think we shipped goods out." | #/nowa, saved doc, Historia | 09, 10, 16, 17 | none | none | Explained in hint + summary, but label/number/Historia say WZ; Historia type filter lists "WZ" as its own type, contradicting "WZ is just a series". |
| 7 | 2 | "Right panel says PZ, panel below says WZ." | #/nowa side panel | 14 | none | none | Przebieg badge PZ vs Plan dokumentów badge WZ. |
| 8 | 2 | "Placeholder says 'Lander Agro', I type 'Lander' and it wants a NEW supplier." | Dostawca field | 11, 12 | none | none | No visible suggestions (maybe native datalist not rendered by test browser); partial name offered as new supplier → duplicate risk. |
| 9 | 2 | "Delete or not? Historia says no deletion, another screen offers 'Usuń…'." | summary vs #/historia | 15–17 | none | none | Consistent only if both texts are read. |
| 10 | 1 | "American date format in a Polish form?" | Data dokumentu | 14 | none | none | Native date placeholder mm/dd/yyyy (test browser UI locale). |
| 11 | 1 | "I typed the invoice number but the summary doesn't show it." | summary | 15 | none | none | Ext. doc no. missing from the summary (saved and shown afterwards). |

Positives: two justified login fields; lockout after 5 failures; 30-min idle logout; clear summary; live before/after stock; immutable audit; backup excludes passwords.

## 3. Result
Reached first success: yes
Actions taken: 18

Replay: index.html → "Pomiń intro →" → "E-mail służbowy" anna.gorska@resinvest.group, "Hasło" demo1234 → "Zaloguj się" → "Nowa operacja" → "Dostawca (firma)" Gospodarstwo Leśne Jan Nowicki → "Produkt / surowiec" Drewno opałowe (m³) → "Ilość" 20 → "Cena jednostkowa (zł/m³)" 230 → "Nr dokumentu zewnętrznego" FV 12/11/2026 → "Zatwierdź…" → "Zatwierdź dokument" → "Zamknij" → "Historia".
