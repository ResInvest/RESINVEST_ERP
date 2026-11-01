# Judge — run-1 list vs run-1 + run-2 screenshots (independent agent, no fixing, no source)
> Saved by the QA lead from the judge's returned verdict; content unchanged.

**Totals:** 10 fixed (R2, R3, R4, R5, R6, R8, R10, R11, R12, R14) · 13 not fixed (R1, R7, R9, R15, R17–R25; 8 of them tagged human/env/no change) · 2 not reached (R13, R16).

## Verdicts
| ID | Status | Tag | Evidence (run-2) |
|---|---|---|---|
| R1 PZ saved as WZ | not fixed | human | impatient/07 still "Numeracja WZ *" (new help text under it); 08 "WZ = wspólna seria… nie oznacza wydania"; still WZ/001/11/2026 (10). 5/5 users sev 3. |
| R2 intro / slow start | fixed (replay; load time report only) | | breaker/22 reload → no intro; breaker/15 new tab → no intro; mobile/01 login directly. First desktop load still plays intro (impatient/01). Mobile: blank ≈45–47 s (run-1 149 s), still sev 3. |
| R3 toolbar over heading | fixed | | impatient/02, mobile/02: bar above "Zaloguj się". Only "Pokaż hasło" < 44 px. |
| R4 EN half Polish | fixed | | non-native/03 fully English; 02 "Test administrator". |
| R5 Approve hidden / toast over Zamknij | fixed | | impatient/04, non-native/07 sticky bar; mobile/09 toast at top, "Zamknij" free. New overlaps → N6. |
| R6 no upper bound | fixed | | breaker/07 "Wartość jest za duża — maksymalnie 100 000 000". |
| R7 no maxlength | not fixed | | breaker/20: 5,000×A in "Miejsce transportu / dostawy" accepted, pushes summary values off screen. |
| R8 Historia filters on phone | fixed | | mobile/13 filters folded into "Filtry i eksport". |
| R9 title "P" / 36 px icons | not fixed (partial) | | title gone (mobile/03); avatar 42×40, "+" 41, menu 36, "Filtry i eksport" 36; header wraps (N7). |
| R10 "only correction" vs Usuń | fixed | | impatient/08, skeptic/16 wording; Historia header still contradicts (N8). |
| R11 reset visible to Kierownik | fixed | | skeptic/07 button gone; text left behind (N9). |
| R12 "na każdym komputerze" | fixed | | skeptic/06 mode-aware text. |
| R13 activity order | not reached | | below the fold in skeptic/06. |
| R14 "1 movements" | fixed | | non-native/10 "1 movement…", impatient/10 "1 ruch". |
| R15 "choose from the list" | not fixed | | reworded (impatient/05) but "Lander" still shows no list + new-supplier badge (non-native/05, skeptic/12); maybe headless datalist. |
| R16 apostrophe e-mail | not reached | | only o'brien🔥<img…>@ tried, correctly rejected (breaker/04). |
| R17 admin password on login | not fixed | human | skeptic/03, mobile/02. |
| R18 no terms/privacy/pricing | not fixed | human | skeptic/03. |
| R19 browser-only data / "kopie zapasowe" | not fixed | human | impatient/02 hero; skeptic/07. |
| R20 second tab login | not fixed | human | breaker/15. |
| R21 Polish product names | not fixed | no change | non-native/07. |
| R22 mm/dd/yyyy, "November" | not fixed | env | impatient/07, mobile/13. |
| R23 /api/health 404 | not fixed (report only) | no change | all 5 reports. |
| R24 long help, abbreviations | not fixed | human / no change | impatient/07, non-native/03. |
| R25 dblclick selects toast text | not fixed | no change | breaker/07. |

## New problems in run-2
| ID | Users | Sev | Screenshot | One line |
|---|---|---|---|---|
| N1 | N S B (I M) | 3 | non-native/08 vs 03; breaker/24 | Introduced by R1 fix: "WZ … not a goods issue" contradicts menu "Wydania / WZ", tile "Sprzedaż (WZ)", Historia filter, Przyjęcia Typ = WZ, print "Dokument WZ". |
| N2 | S N | 2 | skeptic/12, non-native/05 | Introduced by R15 rewording: promises suggestions while typing, none appear; "Lander" offered as new supplier → duplicates. |
| N3 | B | 2 | breaker/08 | Double-click "Zatwierdź…" opens and immediately closes the summary. |
| N4 | M | 2 | mobile/07 | Sticky save bar covers the focused price field; no scroll into view. |
| N5 | M | 2 | mobile/10 | Result modal on phone: documents table cut off, modal body doesn't scroll (run-1 mobile F6, dropped by merge). |
| N6 | I S B M | 1 | impatient/05, breaker/07, skeptic/16, mobile/09 | Toasts cover controls: desktop bottom-right covers sticky "Zatwierdź…" and "Zamknij"; phone top toast covers modal title. |
| N7 | M | 1 | mobile/03 vs 07 | Mobile header wraps (avatar on own row, "+" toggles) — likely side effect of R9. |
| N8 | S | 2 | impatient/10 vs 08 | R10 incomplete: Historia header "Historii nie edytuje się i nie usuwa" vs summary "można usunąć". |
| N9 | S | 1 | skeptic/07 | R11 leftover: "Przywraca dane przykładowe…" paragraph without button. |
| N10 | B | 1 | breaker/07 | Rejected price echoed "odczytano: 100 000 000 000 000 032 768". |
| N11 | B | 1 | breaker/16 (19) | Tab 1 shows stale next number after tab 2 commit; numbering correct. |
| N12 | S | 1 | skeptic/15 | External document number missing from the summary. |
| N13 | S | 2 | skeptic/06 | No self-service account delete / data export (run-1 skeptic F7, dropped by merge). |
| N14 | N | 1 | non-native/02 | Icon-only theme/header buttons; idioms ("Quick trip", "pile pushing"). |
| N15 | all | 1 | impatient/04 | UI shows "Wersja 3.11.0" while the build is 3.12.0-EUDR-DEMO (also run-1). |

## Scoreboard (friction counts from each report's table)
| User | Run | First success | Actions | Sev 3 | Sev 2 | Sev 1 | Total |
|---|---|---|---|---|---|---|---|
| impatient | 1 | y | 13 | 1 | 2 | 1 | 4 |
| impatient | 2 | y | 13 | 1 | 1 | 1 | 3 |
| skeptic | 1 | y | 19 | 4 | 4 | 3 | 11 |
| skeptic | 2 | y | 18 | 3 | 5 | 3 | 11 |
| mobile | 1 | y | 19 | 2 | 5 | 1 | 8 |
| mobile | 2 | y | 20 | 2 | 4 | 3 | 9 |
| non-native | 1 | y | 27 | 1 | 7 | 5 | 13 |
| non-native | 2 | y | 18 | 2 | 4 | 3 | 9 |
| breaker | 1 | y | 55 | 2 | 4 | 4 | 10 |
| breaker | 2 | y | ~59 | 2 | 3 | 3 | 8 |
| All | 1 | 5/5 | 133 | 10 | 22 | 14 | 46 |
| All | 2 | 5/5 | ~128 | 10 | 17 | 13 | 40 |
