# Beat-map tools (song analysis)

These Python scripts turn a song into a steady-tempo MP3 plus a beat map the game builds levels from.
They write into `src/audio/beatmaps.js` and `src/assets/music/`.

**Needs:** Python 3 with `numpy` and `scipy`, and `ffmpeg` built with **librubberband** (the "full" Windows build from gyan.dev has it).
**Working files** go in `tools/beatmap/audio/` (create it). Put the ORIGINAL song there as `<name>.mp3` (e.g. `intense.mp3`).

## Adding a song `<name>` (run from `tools/beatmap/`)
1. `ffmpeg -i audio/<name>.mp3 -ac 1 -ar 22050 audio/<name>.wav`
2. `python analyze.py <name> audio/<name>.wav audio/<name>.json`: tempo estimate per window (find the song's rough BPM).
3. `BPM=<rough> python beats.py <name> audio/<name>.wav audio/<name>.beats.json`: beat tracking.
4. `python refine.py <name>` then `python refine3.py <name>`: smoothed beat times and drift report (writes `<name>.smooth.json`).
5. `BPM=<target> python stretch.py <name>`: time-corrects the song to a steady `<target>` BPM with rubberband, pitch kept (writes `<name>.locked.wav`). Use the song's own mean tempo, rounded (130 for Arcade Drop / Boss Battle, 147 for Intense Section).
6. `ffmpeg -i audio/<name>.locked.wav -ac 1 -ar 22050 audio/<name>L.wav`, then optionally `BPM=<target> python beats.py <name>L audio/<name>L.wav audio/<name>L.beats.json` to confirm the tempo is now flat.
7. `BPM=<target> python features.py <name>`: per-16th-note drum strengths, downbeat phase, energy (writes `<name>.feat.npz`; prints the bar phase = `down`).
8. Add the song to `SONGS` in `build_beatmap.py` (`title`, `down`, `file`, `delta`, `bpm`) and run `python build_beatmap.py` (re-encodes ALL songs' MP3s and rewrites `src/audio/beatmaps.js`).
9. `python onset_check.py`: the kick should land 6-10 ms after the map's slots. If it is later, set `delta` (seconds to trim) = measured - 0.008 and rerun step 8. (Measured trims: drop 0.040, boss 0.046, intense 0.053.)
10. In the game: add the MP3 to `src/audio/songs.js`, use the song id in `LEVEL_DEFS` (`src/game/levelgen.js`), then `npm run bake` and run the tests.
