# Faith Dash 3D: design plan

Status: design only. No 3D code exists yet. The 2D game lives in the project owner's local folder
(`faith-dash`, with its own `CLAUDE.md` and `tools/beatmap/`). Push that into this repo first, then
follow this plan.

## Decisions made

1. **Rail 3D.** The player moves forward along a fixed path automatically. Sideways movement and jumping stay.
2. **Camera is cosmetic only.** Controls never depend on where the camera is. See "Control rule" below.
3. **Camera modes:** chase (behind the player), drone (offset, not centered), and orbit (circles the world, used for spiral staircases). The camera pans to add difficulty.
4. **Rhythm stays the master.** The existing beatmap decides where obstacles sit. Every obstacle stays on a drum hit.
5. **Art:** the owner has never used Blender. Build the first version from simple shapes in code, then replace them with Blender models later.
6. **Stack:** Three.js in the browser. Blender exports `.glb` files that Three.js loads.

## Control rule (most important)

All player input is defined relative to the track, never to the screen or the camera:

- "Left" and "right" mean left and right of the direction of travel along the track.
- "Jump" means up along the track's up direction. In upside-down sections, up is flipped by the game rules, not by the camera.
- Fly and wave modes use the same track-relative axes.

The game logic runs in track coordinates: `distance` along the path (driven by song time),
`lane` offset sideways, and `height` above the track. The renderer turns those three numbers into a 3D
position. The camera reads the player's position but never feeds anything back into the game logic.
Because of this, a camera spinning around a spiral staircase cannot change what the buttons do.

## Track as a path

- The level is a centerline curve (a list of points the player travels along) plus a width.
- Song time maps to distance along the curve, so obstacle positions come straight from the beatmap.
- A spiral staircase is the same curve bending into a helix. No special game logic is needed.
- Forks (the harder high route with the secret coin) become two curves that split and rejoin.

## Camera system

The camera is driven by a **camera script** for each level: a list of cues placed on song time or beat number.
Each cue names a mode and its settings (offset, height, field of view, blend time).

| Mode | Behavior | Used for |
|---|---|---|
| Chase | Behind and above the player, looking forward | Default, easiest to read |
| Drone | Offset to a side and higher, looking at the player | Variety and mild difficulty |
| Orbit | Circles a point in the world while the player climbs | Spiral staircases |
| Pan | Slow sweep between two views | Difficulty ramps |

Rules to keep it fair:
- Blend between modes over a set number of beats, so cuts land on the music.
- Obstacle warnings (lane markers and glow) must stay visible in every mode, so a hard camera angle is a visual challenge and not an unfair one.
- Each level gets an "easy camera" option for Casual mode.

## Build order

1. **Milestone 1: prove the pipeline.** Level 1 only. A flat track, a cube, and obstacles on beats, built from primitive shapes in Three.js with chase camera. Check that it stays in sync with the song.
2. **Milestone 2: camera system.** Camera script, drone and pan modes, track-relative controls verified.
3. **Milestone 3: spiral staircase.** Helix path and orbit camera.
4. **Milestone 4: other modes.** Fly, wave, upside-down, forks, coins, trivia gates in 3D.
5. **Milestone 5: Blender art.** Replace primitives with Blender models. Levels 2 and 3.
6. **Milestone 6: phone testing.** Performance and touch controls on real phones.

## Blender plan for a first-time user

Do not start by modeling a whole level. Start with a small kit of reusable pieces:

- track tile, ramp, wall, pillar, spike, coin, tree, lamp, stair step.
- Keep each piece low-poly (few faces) so phones can handle it.
- Export each as `.glb` (File > Export > glTF 2.0, choose `.glb`).
- Use plain, flat colors first. Textures and fancy materials come later.

The code can place these pieces along the track, so the owner models pieces and never whole levels.

## Open questions

- Which level to build first (assumed Level 1).
- Phone performance target: how low-end a phone must run it.
- Whether Casual mode uses chase camera only.
