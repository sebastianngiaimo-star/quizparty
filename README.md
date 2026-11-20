# QuizParty 🎮

A Jackbox-style party quiz. The **TV** shows the game and **phones** are the controllers: players scan a QR code and join from the browser, with nothing to install.

**Modes**
- **Trivia** — multiple choice, about 2,630 research-verified questions, mostly medium / hard (Warcraft III and WoW: Forever are easy / medium; anime and game questions are about the stories and games themselves, never the people who made them), each with its source link in `tools/lists/trivia.json`. The TV and the phones show the sub-topic next to every question. Sub-topics: Peru (Football, Politics, Food & cuisine, Geography, Music, Celebrities, History), Anime (Death Note, Fullmetal Alchemist, Dragon Ball, Dragon Ball Z, Dragon Ball GT, Dragon Ball Super, JoJo parts 1–6, Attack on Titan, Re:Zero, The Apothecary Diaries, Mixed anime), Video games (Zelda: Ocarina of Time, Warcraft III incl. The Frozen Throne, WoW: Forever, Nintendo, StarCraft, Dota 2, General gaming), General knowledge (Science, World geography, World history). Tick any combination of categories in the menu, then the sub-topics you want in each (none ticked = all of that category). Scores start from zero every game.
- **HILO** — the Survey Scramble formula, on **one hidden list** for the whole game:
  - Everyone votes for one of 3 topics. The list stays hidden: only answers somebody guesses get uncovered.
  - **HI** rounds: name something as close to #1 as possible. **LO** rounds: as close to the bottom as possible, but it has to be on the list. With 4 rounds it goes HI, HI, LO, LO.
  - Answers are revealed one player at a time. Players who give the same answer split the points. An answer uncovered in an earlier round scores 0; the TV lists those while players type.
  - **Bonus round:** 4 head-to-heads from the same list, alternating "Which one is HIGHER?" and "Which one is LOWER?" (50 pts each, the last one 100).
  - Then the complete list scrolls by, and the scores are shown.
- **SQUARES** — two teams (yellow vs purple), tic-tac-toe on a ranking:
  - Squares cover growing ranges of the list: the first holds the top 2–3 answers, the last a big chunk of the tail.
  - Each turn one player answers for the team (it rotates). Teammates send suggestions that show up on that player's phone.
  - Claim an empty square; a better-ranked answer **steals** it; the top answer of a square **locks** it. Three in a row wins.
  - Options: **Scrambled board** and **Three strikes**.

**Presentation:** glowing-squares backdrop, a unique shape avatar per player, staged reveals, claim/steal/lock animations, confetti, and original music (12 tunes that rotate between rounds) and sound effects synthesized in the browser. Toggle the music with the 🎵 button.

**Answer matching** is forgiving: capitals, accents, punctuation, leading articles, plurals, roman numerals ("Final Fantasy VII" = "final fantasy 7"), small typos, and Japanese kana/kanji all work. Anime and game topics accept English, Spanish and Japanese names ("Krillin", "Krilin", "クリリン"; "Attack on Titan", "Ataque a los Titanes", "Shingeki no Kyojin", "進撃の巨人"). A nickname shared by two answers ("Zelda", "Demon Slayer") deliberately matches nothing, so nobody gets credit for a vague answer.

---

## 1. Run it on your computer

Requires Node.js 18+.

```bash
npm install
npm start
```

| Page | URL |
|---|---|
| TV screen | http://localhost:3000/host |
| Phones | http://localhost:3000 (or scan the QR on the TV) |
| Editor | http://localhost:3000/editor |

For phones on the same Wi-Fi, open the TV screen with your computer's network address (e.g. `http://192.168.1.35:3000/host`, from `hostname -I`), not `localhost`, so the QR code points somewhere the phones can reach. If phones can't connect, open the port: `sudo firewall-cmd --add-port=3000/tcp`.

**Controls:** the first player to join is the **VIP ⭐**. They pick the game, start it and skip ahead from their phone ("VIP controls"). The TV remote works too (arrows + OK on the on-screen buttons). If the VIP leaves, the next player becomes VIP.

## 2. Topics (HILO / SQUARES)

Already in the quiz, built from real data (`tools/lists/`):

| Topic | Answers | Source |
|---|---|---|
| Countries of the World (population) | 197 | UN World Population Prospects 2024 |
| Districts of Lima (population) | 43 | INEI, Peru census 2025 |
| Obesity Around the World | 197 | WHO, 2024 |
| Suicide Rates by Country | 185 | WHO Global Health Estimates, 2023 |
| Homicide Rates by Country | 165 | UNODC, 2015–2024 |
| The 300 Best-Paid Jobs | 300 | US Bureau of Labor Statistics, May 2025 |
| How Dangerous Is It to Travel By… | 9 (HILO only) | UK deaths per km travelled |
| The Fastest Animals | 78 | Wikipedia "Fastest animals" |
| The Heaviest Animals | 163 | Animal Diversity Web, Wikipedia, Britannica |
| The Smartest Animals | 66 | 16 published "smartest animals" rankings, combined |
| Dragon Ball: Who's the Strongest? | 114 | 29 fan and editorial power rankings, through Dragon Ball Super |
| Highest-Grossing Movies | 392 | Box Office Mojo, Nov 2026 |
| Best ___ Games — PS1, PS2, PS3, Switch, Wii, N64, GameCube, DS, 3DS, GBA, PC | 45–50 each | Metacritic critic score, Nov 2026 |
| The World's Richest People | 363 | Forbes World's Billionaires 2026 (ranks 1–200 complete, then famous names) |
| Where the Billionaires Live (per country) | 80 | Forbes 2026 country table |
| Musical Instruments (how often people name them) | 87 | Brown (1972) category norms + JetPunk quiz stats |
| **Opinion polls, 2026 (USA):** snack brands (284), beers (72), all-time TV shows (292), current TV shows (299), comedy movies (299), actors (300), most-liked famous people (300), rap artists (228), classic rock (227), sports legends (299), soccer (182), basketball (108), WWE (14), influencers (148), apps & websites (95) | see left | YouGov Ratings Q3 2026, % of Americans who like each one (full category rankings) |
| The Hottest Anime Right Now | 150 | Ranker fan votes (1M+), Nov 2026 |

Anime topics come from the importer below: **Most Popular Anime**, **Most Popular Manga**, **Most-Loved Anime Characters**, **Anime's Best Girls** (female characters by fan favorites), plus Dragon Ball / Demon Slayer / Jujutsu Kaisen characters and Dota 2 heroes.

```bash
npm run import     # or: node tools/import-data.js   (needs internet; ~3 min)
npm start
```

The importer uses MyAnimeList (Jikan API) and falls back to AniList automatically when MAL can't be reached. Jobs are configured in `tools/sources.json`; Spanish and Japanese names are added as aliases.

**Titles and wording** of every topic live in `tools/lists/titles.json` (title, subtitle, HI text, LO text). Edit them and run `npm run lists` (= `node tools/add-lists.js`), which also removes retired lists and re-checks that no alias is ambiguous.

**Adding your own list:** drop a JSON file in `tools/lists/` — `{"source": "...", "unit": "km/h", "rows": [{"text": "Cheetah", "count": 120, "aliases": ["chita"]}]}` — add an entry in `tools/lists/index.json` and a title in `titles.json`, then `npm run lists`. Flags: `titleParts` (the part after ":" becomes an alias), `partAliases` (single name parts / reversed names), `aliasRules` (franchise-level variants, see `aliases-games.json`), `names` (extra aliases per answer, see `aliases-dragonball.json`).

## 3. Edit questions by hand

Open `/editor`:
- **Trivia**: question, category, time limit, 2–6 options and the correct one. Upload an image, audio or video, or paste a URL. Audio/video can have a **start** and **stop** time, so you can upload a whole song and play a clip.
- **Surveys**: topic title, subtitle, HI/LO wording, unit, source note, and the answers with their value and aliases.
  - **Bulk paste** accepts one answer per line as `answer ; value ; alias1, alias2`, or columns copied from a spreadsheet.
  - **Test the matching** shows what a typed answer would match.
  - The **SQUARES preview** shows how the answers split across the 9 squares. SQUARES needs at least **9 answers**.
- **Settings**: title, language (English / Español) and the timers.
- **Import / Export**: JSON backup of everything.

Press **Save** (or Ctrl+S). Data lives in `data/quiz.json`; uploads in `data/media/`.

## 4. Play over the internet (Discord, friends elsewhere)

```bash
npm run online
```
The first time it downloads `cloudflared` (Cloudflare's free tunnel, no account needed). It prints a public `https://….trycloudflare.com` address: open `<address>/host` (or `http://localhost:3000/host`) on the screen you share in Discord; friends open the address on their phones or scan the QR. The address changes every run. Ctrl+C stops everything.

## 5. Put it online permanently

Phones reach the game over mobile data or any Wi-Fi, so the server must be on the internet. Any Node host with WebSockets works (Render, Railway, Fly.io, a small VPS…).

1. Push this folder to a GitHub repo, **including `data/`**.
2. Create a Node web service with start command `npm start`. The host sets `PORT`.
3. Optional environment variables:
   - `ADMIN_PASSWORD` — protects `/editor` and uploads (recommended once public).
   - `PUBLIC_URL` — forces the address in the QR code, e.g. `https://my-quiz.onrender.com`.
   - `DATA_DIR` — where data is stored; point it at a persistent disk if the host has one.

⚠️ Many free hosts wipe files on restart: build the content on your computer, commit `data/`, redeploy, and keep an exported backup. Free tiers also "sleep" — open the site a few minutes before the event.

## 6. Android TV app

`android-tv/` is a small full-screen app that opens `<your server>/host`. Unlike the TV browser it **plays sound without a click** and gets an icon on the home screen.

**Build the APK (no Android Studio needed):** push the repo to GitHub → **Actions → Build Android TV app → Run workflow** → download the `QuizPartyTV-apk` artifact. Or open `android-tv/` in Android Studio → *Build → Build APK*.

**Sideload:** on the TV, Settings → Device preferences → About → press **Build** 7 times (developer options) → allow unknown sources → install with the **Downloader** app, **Send Files to TV**, or `adb connect <tv-ip>` + `adb install app-debug.apk`. On first launch it asks for the server address. **Back/Menu** on the remote opens Reload / Change address / Exit.

If you can't sideload, open `/host` in any TV browser and press OK once on the "enable sound" screen.

## 7. Event-day checklist
- [ ] Wake up the server and open `/host` on the TV.
- [ ] Check the TV volume with the sample melody question.
- [ ] Join from your own phone first, so you're the VIP.
- [ ] Have each table scan the QR. If a phone locks, reopening the page rejoins with the same score.
- [ ] Keep a backup export of the questions.

## Test
With the server running: `npm test` plays every mode with 4 simulated phones (`test/simulate.js`).
