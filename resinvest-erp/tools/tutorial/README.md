# Samouczek wideo ResInvest ERP

Pełny samouczek programu (16 rozdziałów, ok. 17 min) w MP4 1920×1080, 30 kl./s. Zawiera:

- jasny motyw „Perła”;
- płynny kursor, podświetlenie kliknięć i jaskrawe strzałki z podpisami;
- plansze rozdziałów i polskie napisy;
- lektora (głos Joniu z ElevenLabs);
- podkład z trzech utworów dopasowany do rozdziałów;
- wirtualną kamerę ze zbliżeniami i przygaszaniem tła (spotlight), animowane plansze.

## Pliki

| Plik | Rola |
|---|---|
| `script.json` | Tekst lektora: 16 rozdziałów, zdania, opis ekranu. Zapis fonetyczny, np. „Res-Inwest e-er-pe”, „wu-zet”. |
| `timing.py` | Etap 1: oś lektora (`timing.json`) — czas rozdziału = długość MP3, granice zdań z obwiedni głośności (pauza / oddech najbliższy szacunkowi). Etap 2 (`--final`): oś ostateczna (`timing_final.json`) i napisy (`subs.ass`) z przesunięć zdań zapisanych przez nagrywarkę. |
| `rec.cjs` | Nagrywarka Playwright. Okno 1600×900 px, zrzuty w skali 1,8 (2880×1620 — zapas ostrości dla kamery), współrzędne w kadrze 1920×1080. Każda akcja przypięta do zdania lektora (`beat(i)`): strzałki na polach, zakładkach i przyciskach, ramki na kolumnach tabel (`col`), wycieczki po paskach narzędzi (`tour`). |
| `compose2.py` | Montaż premium (opis niżej). |
| `compose.py` | Biblioteka sprite'ów (kursor, dymki, strzałki, ramki, tła plansz) i poprzednia wersja montażu. |
| `music.py` | Zapasowa synteza podkładu (gdy brak własnych utworów). |

## Tempo — bez przyspieszania obrazu

Gdy akcje na ekranie trwają dłużej niż zdanie lektora, **lektor czeka**: przed kolejnym zdaniem wstawiana jest pauza
(tylko na granicy zdań, w miejscu pauzy w nagraniu). Obraz nigdy nie jest przyspieszany ani ucinany; rozdział trwa
tyle, ile dłuższy z dwóch: lektor albo akcje. W wersji 2 pauzy wynoszą 0–1,7 s na rozdział.

## Montaż (`compose2.py`)

- **Wirtualna kamera**: płynne zbliżenie (do 1,38×) na omawiany element — pole, kolumnę, przycisk — i powrót do
  pełnego kadru; ognisko zawsze nad pasem napisów.
- **Spotlight**: w czasie zbliżenia reszta ekranu jest przygaszona, omawiany element zostaje jasny.
- Strzałki z podpisami, ramki kolumn, kursor z łukiem ruchu, aureola i pierścień kliknięcia, przenikanie ekranów.
- **Animowane plansze**: otwarcie, numer i tytuł rozdziału, pasek postępu, plansza końcowa.
- **Podkład z 3 utworów** (`music_src/epic1.mp3`, `epic2.mp3`, `epic3.mp3`): utwór zmienia się tylko na planszy
  rozdziału; każdy fragment kończy się naturalnym zakończeniem utworu dokładnie na granicy rozdziałów (otwarcie —
  od początku utworu z wyciszeniem na planszy). Plan zapisany w `music_plan.txt`. Ducking −12 dB pod lektorem.
- Lektor: zdania rozdzielone w pauzach nagrania i ułożone według osi ostatecznej; loudnorm −16 LUFS.
- Render w częściach (równolegle), potem sklejenie z dźwiękiem: H.264 CRF 19 + AAC 192 kb/s.

## Uruchomienie

Wymagania: Node 22 z Playwright i Chromium, Python 3 z `numpy` i `Pillow`, ffmpeg z libass i libx264 (zmienna `FFMPEG`).

```bash
npm run build                                   # ResInvest_ERP.html w katalogu projektu
cd tools/tutorial
mkdir -p mp3 music_src                          # mp3/01_wstep.mp3 … 16_zakonczenie.mp3; music_src/epic1-3.mp3
python timing.py                                # 1) oś lektora i granice zdań
node rec.cjs                                    # 2) nagranie (albo wybrane rozdziały: node rec.cjs 5 6)
python timing.py --final                        # 3) oś ostateczna + napisy
python compose2.py --audio                      # 4) lektor + podkład → _mix.wav, music_plan.txt
#    python compose2.py --audio --no-music         #    (wersja bez podkładu — tylko lektor)
python compose2.py --video --chapters 1-5 &     # 5) obraz w częściach (równolegle)
python compose2.py --video --chapters 6-11 &
python compose2.py --video --chapters 12-16 & wait
python compose2.py --final --out ResInvest_ERP_samouczek_1080p.mp4
```

Po podmianie nagrań lektora powtórz kroki 1–5 (akcje dopasowują się do nowych czasów zdań).

## Ustawienia lektora (ElevenLabs)

- Głos: Joniu.
- Model: Multilingual v2.
- Stability 0,55, Similarity 0,80, Style 0,15, Speed 0,95.
- Jeden plik MP3 na rozdział, bez muzyki, z ciszą ≤ 0,5 s na początku i końcu.
