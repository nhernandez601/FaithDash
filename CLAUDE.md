# Faith Dash — project handoff (read this first)

Last updated: 2026-11-09. Version: **v6.2** (`GEN_VERSION = 13`).

## Who you are working with
- **Owner: Noe Hernandez**, an IT help desk specialist. He knows networking and a few command / PowerShell lines, but **not coding**. Explain things in plain language, avoid jargon, and give him things he can double-click or copy.
- After every change, give a short, honest test report: **Passed / Failed / Not tested / Blocked**. Never claim something was play-tested by a human or listened to unless it was.
- He judges the game by **playing it**. He has said it felt "not fun", then "not much difference", and asked for harder play. Keep him in the loop on how it feels.
- Project folder on his PC: `C:\XboxGames\test\faith-dash\`. **The file he double-clicks is `FaithDash.html` at the folder root.** It is a single-file build and must be rebuilt (`SINGLE=1 npx vite build`, then copy `dist-single/index.html` to `FaithDash.html`) after any change, or he keeps seeing the old version. (This happened once and confused him.)

## What the game is
A browser **rhythm platformer** in the style of Geometry Dash, with **Bible-trivia coin gates**. It runs on desktop, Android Chrome and iOS Safari (PWA, local saves). There are 3 levels, each built on one real song so that every obstacle sits on a drum hit.
- The cube runs right by itself; tap/click/Space jumps (and **hold** for fly/wave).
- **Coin gates** pause the game for a multiple-choice Bible question (correct = +1 heart up to 3, wrong = −1). Afterwards a 2 s shield.
- **Portals switch how you move** (v6). They start on the song's drops:
  - **Fly / ship** (pink): hold to rise, release to fall, through spiked pillars on the beat.
  - **Wave** (cyan): hold = up at 45°, release = down, zig-zag corridor with turns on the beat.
  - **Gravity** (gold): run on the ceiling, jumps go down, gravity flips back and forth on the beat. A **green** portal returns to the normal cube.
  - Combo sections `shipwave` / `waveship` switch mode half-way on a bar line.
- **Forks**: a ground route versus a floating-tile high route. On up to 3 forks the high route is **harder and hides a secret coin** (kept only if you finish the level; half of them unlock the Celestial Flame skin, all of them unlock Divine Prism).
- **Casual / Hardcore** is picked on Level Select. Casual: 3 lives and checkpoints. Hardcore: any hit or wrong answer restarts the level; attempts are counted; the level gets a "Hardcore clear" badge.
- Also: double-jump orbs (15 s), 6 skins, 3 backgrounds, music-reactive visuals, PERFECT/GREAT/GOOD jump ratings (cosmetic), an Audio delay slider (−100 to 400 ms), and a practice run.

| Level | Song | Tempo | Tier | Speed (tiles/s) | Trivia gates | Sections | Forks (secret) |
|---|---|---|---|---|---|---|---|
| 1 The Beginning | Arcade Drop | 130 | easy | 9 | 5 | 6 (ship, grav, wave, shipwave, grav, ship) | 4 (3) |
| 2 The Journey | Arcade Boss Battle | 130 | medium | 10.5 | 6 | 5 (ship, wave, grav, shipwave, waveship) | 3-4 (3) |
| 3 The Trial | Intense Section | 147 | hard | 12 | 7 | 6 (wave, ship, grav, waveship, grav, shipwave) | 3-4 (3) |

Each level is the full song (about 213-219 s). The first mode section comes at 9-12 s, and about 33-38% of each level is in fly/wave/gravity. Plain running is about 25 / 33 / 30 jumps per minute, plus 12 / 21 / 27 timed hazards.

## How to run / build / test
- **Play (Noe):** double-click `FaithDash.html`, or `start.bat`, which runs `npm install` the first time and then the dev server with `--host` so a phone on the same Wi-Fi can open the Network address.
- `npm run dev` runs the dev server; `npm run build` writes the site to `dist/`; `SINGLE=1 npx vite build` writes one HTML file to `dist-single/index.html` (about 19 MB, songs inlined).
- **`npm run bake` is required after ANY change to `src/game/levelgen.js`, `src/audio/music.js` or `beatmaps.js`.** It regenerates and **proves** all 3 levels, writing `src/game/levels.baked.js`. It takes about 2-8 minutes per level. Levels are matched by a signature; a stale bake silently regenerates in the browser, which is slow, so always bake.
- Tests (all must pass):
  - `npm test` runs `tests/levels.test.mjs` (62 checks: completable with slack, every route, coins not bypassable, gates, sections, secrets, replays) and `tests/sim.test.mjs` (37 checks: physics and run rules).
  - `node tests/beatsync.test.mjs` (33): take-offs on the 16th grid and on real hits, drops, x = speed × t, coins out of drops.
  - `node tests/modes.test.mjs` (11): ship / wave / gravity physics, mode portals, secret coins, Hardcore, pillars on the beat grid.
  - `node tests/smooth.test.mjs` (6): smooth clock and interpolation versus the old loop.
  - Browser checks (Playwright + Chromium, run after `npm run build`): `node tests/verify_music.mjs` (MP3 kick alignment in the browser, audio/sim lock, no console errors), `node tests/v6shots.mjs` (screenshots of each section in `tests/shots/`), `node tests/perf.mjs`.
  - `tests/music.mjs` is **obsolete** (it tests the old synth tracks).
- Gotchas:
  - Don't `pkill -f` with a string that appears in your own command.
  - Event codes `MODE` (9) and `SECRET` (10) are followed by an index in the event list, like coin/checkpoint/portal/orb; parsers must skip it (`WITH_IDX` in the tests).

## Tech stack and file map
Phaser 3.90 (WebGL drawing only; all art is drawn in code through a pooled "pen"), Vite 5, plain ES modules. There is no backend; saves are in `localStorage` (`faithdash.save.v1`, bank `faithdash.bank.v1`).
- `src/game/sim.js`: **all physics** (pure, deterministic, fixed 1/120 s step). Constants: G 75, JUMP_V 19, PW/PH 0.8, HB_INSET 0.12, INV_TIME 2, BUFFER 0.1, COYOTE 0.08. v6 adds `MODE {CUBE, SHIP, WAVE}`, `p.grav ±1`, `p.hold`, SHIP_ACC 52, SHIP_VMAX 10.5, WAVE_K 1, WAVE_INSET 0.24, CEIL_Y 14, mode portals `lv.mports`, secret coins `lv.secrets` (a tall pick-up column), and hanging spikes (`down: true`).
- `src/game/bot.js`: the **completability prover**. It is a breadth-first search over every input timing at 1/60 s: cube taps branch per landing, ship/wave hold/release branch every frame, with up to 300 states per frame. `margin` inflates hazards and `pressEvery` sets the human timing grid. It returns `inputs` (`p` tap / `d` hold / `u` release). `replayInputs()` replays them.
- `src/game/levelgen.js`: the **level generator**. Key parts:
  - `LEVEL_DEFS`.
  - The `Builder` (snap-to-hit, cues, tail).
  - `PATTERNS`: single/double/triple/gap/block/stairs/floatbar/saw/movesaw/spinner/pulse/platform, **chain**, **blockspike**, **fork**, **zone** (dispatches to **flyer** and **gravity**).
  - `weightsFor`, `generateLevel`, `buildLevel` (seeds until the full level and BOTH fork routes are proven), `routeLevel`, `serializeLevel`.
- `src/game/run.js`: one play-through: lives, trivia, Hardcore (`registerHit` returns `'restart'`, `restartFromStart`), secrets, interpolation (`keepPrev`/`viewAt`).
- `src/game/clock.js`: `SmoothClock` (glides on the frame timer, steered toward the audio clock; snaps if more than 0.15 s off).
- `src/audio/music.js`: the `BeatMap` class (16th-note low/mid/hi strengths, sections, drops, intensity, `heatAt`), and `cueCandidates(map, tier)`, the hits allowed as take-offs per tier.
- `src/audio/beatmaps.js` (GENERATED), `src/audio/songs.js` (MP3 URLs), `src/assets/music/*.mp3`. The songs are time-corrected and **trimmed so beat 0 = file time 0**.
- `src/audio/audio.js`: real-song playback (one decoded song kept), synth fallback and practice tracks, sfx, sync delay.
- `src/app.js`: the game loop and states. The song is the master clock: the sim runs to `smoothClock + DT` and the frame is drawn exactly at clock time (interpolated). It also handles input (pointer and Space hold), events, Hardcore restart, saving secrets, and unlocks.
- `src/render/world.js`: drawing (terrain, hazards incl. hanging spikes, mode portals, secret coins, ship/wave/gravity player, wave trail, section tints, beat lane, colour heat on drops). `src/render/pen.js`: pooled Phaser objects; **`pen.finish()` must run at frame end** (it hides unused objects; this fixed one-frame ghosts).
- `src/ui/ui.js`, `src/styles.css`, `src/ui/howto.js`: menus, HUD (hearts or ATTEMPT n, secret-coin dots), Level Select (Casual/Hardcore picker, mode tags, secret coins, Hardcore badge), results, Music screen, Settings.
- `src/data/questions.js`: the **official trivia bank, currently EMPTY** (`version: 0`).
- `src/core/`: bank, fsm, storage, leaderboard (Supabase, unused), util. `supabase/schema.sql`, `scripts/gen-sql.mjs`: the leaderboard backend (skipped).
- `tools/beatmap/`: song-analysis pipeline (see its README) for adding or re-syncing songs.
- `src/main.js` exposes `window.__fd` test hooks (app, prover, routeLevel, replayInputs, step, DT, audio).

## Core design rules (don't break these)
1. **x = speed × t, exactly.** The runner never changes horizontal speed, so song time maps to world x: beat i is at `x = i × tpb`, with `tpb = speed × 60 / bpm`. That is why lifts only move vertically (sideways ones broke the sync), and why speed portals were not added.
2. **The music is the clock.** Never move the sim with wall-time while a song plays. Resync if the sim lags by more than 0.3 s.
3. **Every level must be proven completable** by the bot with human slack (`margin`, `pressEvery`): the full level and the ground-only and high-only routes. Fly/wave corridors are built by flying a "ghost" with the real physics, toggling only on the song's hits, plus early/late variants (human slack), and then leaving a gap around all those paths.
4. Obstacle take-offs sit on the 16th-note grid on real hits of the level's tier (at least 90%). Mode sections start on drop bar lines where possible. Coin gates never sit in drops or inside sections; there is a 2 s hazard-free run-out after each.
5. Planning order in `generateLevel`: **sections claim drops first** (each reserves its *measured* length + 3 beats), then **coin gates** fill calm bars, then **forks** (secret forks first, a spare fork inherits a dropped secret). Short gaps before a reserved spot are filled with jump chains that fit.
6. Coins, checkpoints and section ends are always reached as a normal cube with normal gravity (this is tested).

## Song facts
| id | Title | Original tempo | Locked to | Trim delta | Downbeat phase | Drops |
|---|---|---|---|---|---|---|
| drop | Arcade Drop | 128→132.7 (drifts) | 130 | 40 ms | 1 | 11 |
| boss | Arcade Boss Battle | 127→131 | 130 | 46 ms | 2 | 10 |
| intense | Intense Section | 144.8→149.3 | 147 | 53 ms | 2 | 17 |

Locking uses a rubberband time-stretch with pitch kept (at most about ±3%). In the browser the kicks land 5-10 ms from the grid. **No one has listened to the result**; a speed change might be audible.

## History (what was done, in order)
- **Before this chat (v1-v4):** the game, 3 levels, trivia gates, 6 skins, local saves, PWA, practice run, forks, double-jump orbs, visual flip/mirror portals, synth music, a Supabase leaderboard design (skipped), a QR code for a GitHub Pages URL.
- **v5 (music sync):** analysed both songs, locked them to 130 BPM, built beat maps, rewrote the generator so every take-off is on a hit, made the audio the master clock, added music-reactive visuals, jump ratings and the sync slider. Fixed a 40 ms map/audio offset.
- **v5.1 ("optimize", from Noe's Geometry Dash write-up):** smooth clock plus render interpolation (screen speed wobble dropped from 17-142% to 1-5%), colour "triggers" on build-ups and drops, particle pooling, binary-searched cue culling, and a cue-sort bug fix.
- **v5.2:** added Intense Section (147 BPM) as Level 3's song. Coins now stay out of drops, and a fork's routes must each be beatable.
- **v6:** Noe said the game "doesn't feel fun… only jumping simple obstacles… too linear". He chose: new ways to move, risky routes with secret coins, and player-picked difficulty. Added ship/wave/gravity, secrets, Casual/Hardcore, a hold input, the prover upgrade and new tests. Fixed one-frame ghost drawing.
- **v6.1:** "not much difference": sections had been only 6-13% of each level and came 67-90 s in. Rebalanced: first at 9-12 s, about 35% coverage, combo sections, planning order. Trivia gates went to 5/6/7 (were 5/7/9) to make room.
- **v6.2:** "plain cube part should be much more difficult": jump chains, spiked blocks, hazards from the start, almost no flat rests, denser cue tiers, a tighter prover grid (`pressEvery` 4/3/2 = 67/50/33 ms), smaller margins.

## Open items / backlog
- **Trivia bank is empty.** The agreed process: ask Noe for one question and its correct answer, write exactly 3 believable wrong answers, add it (bump `version` in `questions.js`), and repeat until he says the bank is done. Until then the game shows a creator notice at coin gates.
- **Hosting is blocked:** the GitHub Pages repo (`nhernandezx1`) is not created, and `gh` is not logged in. The QR code points to a URL that doesn't exist yet. Still to do: write Noe a plain-language hosting guide (GitHub Pages setup, how to update the site, putting the QR in Canva without recolouring it or shrinking it below about 2 cm, and a note that the repo will be public).
- **Not tested:** human play-testing (difficulty and fun are unverified), real phones/iOS (especially hold on touch), whether the time-corrected songs sound right, and real frame rates (the headless test browser runs at about 11 fps).
- Known gaps: the practice-run questions are placeholders; the shield doesn't cover pit falls; the Supabase leaderboard was skipped; Level 3 may fit only 3 of its 4 forks; speed portals were not done (they would break rule 1).
- Waiting on Noe's feedback: whether Level 1 is now too hard, and which sections feel unfair. Each section's gap size (`clearOf`), length (`flyer.gen` beats, gravity `nLegs`) and the cube difficulty (`diff`, `pressEvery`, `margin`, `chainMax`, `weightsFor`) can be tuned separately in `levelgen.js`. Bake after any change.

## 3D version (in progress, see `3D-PLAN.md`)
- **Milestone 1 is done:** `3d.html` + `src/three/main3d.js` draw the existing game in 3D with Three.js (rail track, chase camera, and a side "drone" camera on key `C`). It reuses `sim.js`, the levels, the song clock and the input unchanged; the 2D game is untouched.
- Open it with `npm run dev` and go to `/3d.html` (or `npm run build`, which now also builds the 3D page). The single-file `FaithDash.html` build is still the 2D game only.
- Test: `node tests/three.mjs` (builds each level in 3D, screenshots to `tests/shots/3d_*.png`). Not human-tested: feel, music sync by ear, phones.
- Known gaps: no sideways lane yet (the runner stays in the middle), tunnel and ceiling sections hide the view from the chase camera, art is plain shapes, no trivia gates or HUD in the 3D page, no camera script yet (Milestone 2).
- **Look pass (2026-11-09, matched to the intro film `public/intro.mp4`):** `src/three/art3d.js` holds all 3D art: painted sky (`bg0-2.jpg` as a screen-filling backdrop + animated aurora shader), floating islands/spires (instanced), dark neon road with cyan dashed lanes, crystal spikes, gear saws, laser spinners, gold cross coins (`coin.webp`), swirl portals, stone gear arches, chevrons, a bevelled golden fire cube with a carved face, flame/spark particles, and `bakeStatic()` which merges still meshes (draw calls ~1950 -> ~240). Bloom glow via EffectComposer.
- `3d.html` now has: intro video (Skip / Enable sound / Watch intro), a live animated menu with song picker, HUD (lives 3, beat streak, multiplier up to x4 every 4 on-beat jumps, total score, progress, next move, pause), pause and results cards. Score = distance x5 + beat ratings x multiplier + coins. Out of lives = results screen. `?nointro` skips the video.
- Camera: chase sits 45 degrees to the right, 6.2 back (`CHASE_ANGLE`, `CHASE_DIST` in `main3d.js`).
- Not done yet (from Noe's ChatGPT list): swipe lanes, roll/slide, twisting/spiral/hilly track (need sim + generator changes), one-level mode, customization submenu, music/audio settings, Blender-made models. Blender 5.2 is installed at `C:\Program Files\Blender Foundation\Blender 5.2`.
- **Blender hero (2026-11-09):** `tools/blender/hero_cube.py` builds the hero cube in Blender from code (bevelled gold shell, face + side runes cut in with booleans so the cuts glow, grooves, studs, flame crown) and writes `src/assets/models/hero.glb` + a Cycles preview `tools/blender/hero_preview.png`. Rebuild: `"C:\Program Files\Blender Foundation\Blender 5.2lender.exe" -b --python tools/blender/hero_cube.py`. The game loads it with GLTFLoader (`loadHero()` in `art3d.js`) and keeps the code-built cube as a fallback. Colours in the script are LINEAR (deeper than they look); the game scales Blender emission by 0.2. A RoomEnvironment gives metals reflections; bloom threshold 0.92 / radius 0.22 keeps gold from washing out. Debug: `__fd3.G.cam = 'close'` is a hero close-up camera.
- **Lanes + roll (2026-11-09):** `src/three/lanes.js` is a 3D-only layer on top of sim.js (the 2D rules are unchanged): 3 lanes (`G.L.lane`, smooth `lx`, 0.09 s per lane) and a 0.55 s roll (height 0.38; pressed in the air it slams down and rolls on landing; a jump cancels it). `planLaneHazards(lv)` places dodge **barriers** (1-2 lanes, 2.7 tall, cannot be jumped) and roll-under **gates** (beam bottom 0.55, energy wall above) only on calm flat stretches with no cue or hazard nearby, on a beat, with at least 3 tiles of reaction room. L1/L2/L3 = 14/23/20 lane obstacles. Test: `node tests/lanes.test.mjs` (287 checks: early/late roll, no roll crashes, late dodge from every lane, a blocked lane crashes). Controls: arrows or A/D change lane, Down/S rolls; touch = tap jumps, swipe left/right/down, plus on-screen buttons in a bottom strip (`#pad`) that never jumps.
- Chase camera: `CHASE_ANGLE` 68, `CHASE_DIST` 5.6, follows the lane a little.
- **Blender world assets:** `tools/blender/world_assets.py` builds crystals, saw, portal, coin, platform, barrier, gate and 3 islands (+ a road segment for the sheet only), exports `src/assets/models/*.glb`, and renders the 4K sheet `tools/blender/assets_4k.png` (about 5 min; add `-- --no-render` to only export). `loadAssets()` in art3d.js loads them before the first level is built; spikes and islands are instanced (about 60 draw calls). Every builder falls back to code shapes if a model fails. The road is a 1024 px canvas texture with a bump map (no model).
- **One course + polish (2026-11-09):** the 3D game is ONE course, "The Pilgrim's Path", with one background (`THEMES[0]`, bg0). The menu only picks the song; each song keeps its own proven, beat-synced layout (the old Level 1/2/3 data). Chase camera: `CHASE_ANGLE` 74, `CHASE_DIST` 8.6, height +3.6, height follows slowly (`G.camY`). Cube customisation: `SKINS` in art3d.js repaint the Blender hero materials by name (Gold, GoldDark, CoreGlow, EyeHot, Flame, Gem) + flame colours; choice saved in localStorage `faithdash3d.skin`; Customize screen orbits the hero (`G.showcase`). Smoothness: 4x MSAA composer target, half-size bloom, soft sun shadow under the hero only (follows the player), auto resolution (`autoQuality`). Colour grade pass (teal shadows, warm highlights, +saturation/contrast, vignette) runs after OutputPass. Islands use rounder shading (80 degrees auto-smooth).
- **Two answers per lane obstacle (2026-11-09):** tall dodge-only barriers are gone. Every lane obstacle blocks 1 or 2 lanes (never 3): a **gate** (beam bottom 0.55, energy wall to 2.9) = roll under OR dodge, jumping fails; a **hurdle** (low block, `HURDLE_H` 0.78) = jump over OR dodge, rolling fails. Hurdles only go where a jump has room to land. At least 4.5 tiles of calm road before each. L1/L2/L3 = 13/17/18. `node tests/lanes.test.mjs` = 621 checks (every answer works early and late, from every lane; doing nothing or the wrong move crashes). Blender: `gate` is now one lane wide, new `hurdle` model; `barrier.glb` is still exported but no longer used. The original rhythm obstacles (spikes, saws, blocks) still span the whole road and are jumped on the beat.
- **Dodgeable rhythm obstacles (2026-11-09):** outside fly/wave/gravity sections, spike groups, saws, laser bars and pulsing spikes each block 1-2 lanes (`assignHazardLanes`); obstacles within 4 tiles of each other share lanes so one dodge clears a cluster. Ceiling spikes, section corridors and terrain (blocks, steps, pits) stay full width. sim.js is untouched: `laneLevels()` makes level copies whose `bHaz` index holds only the obstacles in lane(s) -1, 0, 1, -1/0, 0/1, and the game steps the sim against the copy for `laneKey(lx)`. Every copy has fewer obstacles than the original, so the proven beat route still finishes in any lane (tested). Saws/lasers are drawn once per blocked lane. `tests/lanes.test.mjs` now 642 checks.
- **Quality setting (2026-11-09):** menu top bar / pause card button cycles Auto / High / Ultra 4K (saved in localStorage `faithdash3d.quality`). Auto = up to 1.75x pixel ratio with automatic lowering, half-size bloom, 4x MSAA. High = up to 2x, full bloom, 2048 shadow, sharpening 0.22 + film grain. Ultra = at least a 2160-pixel-tall render (supersampled; capped at 3x), 8x MSAA, 4096 shadow, sharpening 0.3, and the 8K sky if `src/assets/bg0_8k.(jpg|webp)` exists (picked up automatically via import.meta.glob; none yet). Sharpen + grain live in the colour-grade pass.
- **Mobile optimisation (2026-11-09, still a web page):** chunked culling: `instanceModel()` and `bakeStatic()` split by 80-tile road chunks (`CHUNK`) with real bounding spheres, so only nearby chunks draw; camera far plane 320 (fog ends 230). Islands decimated to 40% in Blender. Result: ~548k -> ~40k triangles drawn per frame. Touch devices (`MOBILE`): Auto = up to 1.25x pixel ratio (auto-lowers to 0.6), 2x MSAA, 0.35 bloom, 512 shadow, no grain; no Ultra; 60 fps cap; half the flame particles; Play goes fullscreen + landscape where the browser allows (Android, not iPhone Safari). CSS: notch/home-bar safe areas, compact layout for short (sideways) screens, keyboard hints hidden on touch.
- **8K sky (2026-11-09):** `src/assets/bg0_8k.jpg` (8192x2303, 2.2 MB) = `bg0.jpg` upscaled 4x with Real-ESRGAN (realesrgan-x4plus, free/BSD; the tool was downloaded to the session scratchpad, not the project) then resized in Blender with the Standard view transform (the default AgX washes colours out). Only Ultra loads it; Auto/High and phones keep the 2365 px original.
- **Sky lighting + effects (2026-11-09):** `src/three/fx3d.js`. Reflections/ambient now come from the sky painting (`skyEnvCanvas` -> PMREM equirect env, environmentIntensity 0.9; metals envMapIntensity ~1). `FlameFX`: animated flame sprites (shader points, normal blending so they stay orange over the purple sky, skin-coloured via `setColors`). Coin/secret glints (`makeGlint`, twinkle in main3d). Portal centres use `vortexMaterial` (swirl shader, shared `fxTime`). `BurstRing` on PERFECT/GREAT. `SpeedLines` streaks while playing (16 on phones). `CloudLayer`: two faded cloud sheets at -26/-40 (below the islands). Sun-ray planes were tried and removed: they washed out the contrast. The menu looks darker in narrow windows (<720 px) only because of the phone-layout backdrop.
- **Mobile-game menu (2026-11-09):** `3d.html` menu rebuilt: BEST pill + settings icon on top, big logo, the hero centre stage (menu camera aims at it; it hops idly), round SKINS / INTRO side buttons, a song card carousel (arrows, swipe, dots, best score per song in localStorage `faithdash3d.best.<song>`) and a big pulsing gold PLAY. Settings sheet (`#settings`): quality segmented control (no Ultra on phones), how to play, watch intro. Skins screen: back button + title, hero orbiting centre, round swatches + EQUIP. Sideways phones put the card and PLAY side by side. Keyboard: arrows change song, Enter plays.
