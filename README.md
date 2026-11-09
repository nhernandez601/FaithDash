# Faith Dash

## Play it on your PC
1. Install Node.js (LTS) from https://nodejs.org (one time).
2. Double-click `start.bat`. First run installs parts, then the browser opens.
3. To test on a phone: same Wi-Fi, open the "Network" address the window prints.

## Routes, portals and power-ups (v3)
- **Two routes at most forks.** Jump up the floating-tile staircase for the *sky route* (its own gaps, moving platforms, saws and spinners), or keep running on the *ground route*. Both rejoin and both reach the finish line.
- **Portals.** Magenta = the world turns upside-down. Cyan = the world is mirrored left-to-right. This changes only the picture, never the controls or the physics; a dim ring marks where it returns to normal.
- **Double-jump orbs** (green). Collect one for 15 seconds of a second mid-air jump (a timer shows at the top). Nothing in the game ever requires it.
- **Portals roll over a full second.** The world turns as a 3D barrel roll rather than snapping over, and every portal is guaranteed more than a second of flat, hazard-free ground so the roll always finishes before anything can hit you.
- **Background world structures.** Towers, buildings, arches, hanging slabs and floating bars scroll behind the level on three parallax layers. They are always solid, flat, untextured silhouettes; anything you can actually stand on is textured and carries a bright white lit edge. That contrast is the rule that keeps scenery from being mistaken for gameplay.
- **Jumps are snappier.** Same jump height as before (2.4 tiles) but 18% less hang time (0.51 s instead of 0.62 s). Level geometry is derived from the jump arc, so every level was regenerated and re-proven for the new physics.
- **The game is rhythm-based.** Three real songs (Arcade Drop, Arcade Boss Battle at about 130 BPM; Intense Section at about 147 BPM, each with a little drift) were analysed, time-corrected to a steady tempo (130 / 130 / 147 BPM), and turned into beat maps (`src/audio/beatmaps.js`, rebuilt by the analysis script). The level generator puts every obstacle take-off on a real drum hit, set-pieces on drops and coin questions in calm bars. The audio clock drives the game, so the two stay in sync. L1 = Arcade Drop (easy), L2 = Arcade Boss Battle (medium), L3 = Intense Section (hard); change it in `LEVEL_DEFS`. After any level-generator change run `npm run bake`. `node tests/beatsync.test.mjs` checks the sync; `node tests/verify_music.mjs` checks it in a real browser. The old synth tracks remain as the fallback and for the practice run.
- **v6 gameplay: new ways to move, risky routes, Casual/Hardcore.** Mode portals start on the songs' drops:
  - *Fly* (pink): hold to rise, let go to fall, through spiked pillars on the beat.
  - *Wave* (cyan): hold = up at 45°, let go = down, zig-zag corridor with turns on the beat.
  - *Gravity* (gold): run on the ceiling, jumps go down, gravity flips back and forth on the beat. Green = back to normal.
  Fly/wave corridors are built by flying a "ghost" with the real physics, pressing only on the song's hits, then again with every input early and late; the gaps leave room around all of those paths. Forks: some high routes are harder and hide a secret coin (3 per level, kept when you finish; they unlock skins). Level Select has Casual (3 lives, checkpoints) or Hardcore (any hit or wrong answer restarts the level; attempts counted). The prover handles holds; `node tests/modes.test.mjs` checks the new physics.
- **v6.2 harder running.** The plain cube parts are much denser: jump *chains* (2-5 obstacles back to back, each take-off on the next drum hit), blocks with spikes on top, timed hazards from the start, almost no flat breathers outside the song's quiet parts, and tighter (still proven) timing: the prover now allows 67 / 50 / 33 ms input grids on levels 1 / 2 / 3. Short gaps before a reserved spot are filled with chains that fit.
- **Smooth motion.** Physics runs in fixed 1/120 s steps (the same on every device); the picture is drawn between two steps at the exact moment of the frame, and the audio clock is read through a smoothing clock (`src/game/clock.js`) so scrolling glides on 30/60/144 Hz screens and on browsers whose audio clock moves in coarse jumps. `node tests/smooth.test.mjs` measures it against the old loop.
- **Colour triggers.** The accent colour and sky heat up through each build-up and flare on each drop (`BeatMap.heatAt`), the way a level editor's colour triggers would, but taken from the song's own sections.
- **Levels are pre-built.** `npm run bake` regenerates and re-proves all three levels into `src/game/levels.baked.js` (about 20-30 s). Only needed if you change level settings in `levelgen.js`; `npm test` fails if the baked file is stale.

## Add Bible questions (creator)
Main menu -> Settings -> Question Manager. Every question needs a correct answer and exactly 3 wrong ones.
Use Export JSON to back up and Import JSON to restore. Until you add questions, coins show a "Creator setup" notice.

## Global leaderboard (currently NOT connected)
Skipped for now. The backend is written (`supabase/schema.sql`) but never run against a live Supabase.
Until connected, submitted scores are kept on the device as PENDING and are never shown as global.
To connect later: create a Supabase project, run `supabase/schema.sql` in its SQL editor, copy `.env.example` to `.env`, fill in URL and anon key, restart.

## Tests

`npm test` runs the physics and level suites. The browser suites are run separately:
`node tests/play.mjs` (a full level played through the real app), `node tests/mech.mjs` (trivia and lives rules),
`node tests/mobile.mjs` (phone and tablet sizes), `node tests/v3app.mjs` (both routes, portals, double jump)
and `node tests/beatsync.test.mjs` (music sync).

`npm test` (simulation + level proofs). Browser tests are in `tests/*.mjs`.
