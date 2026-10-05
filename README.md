# はじめの一歩 — Hajime no Ippo: The First Step

A cel-shaded, arcade boxing game for the browser, built with **Babylon.js 9** and **Vite**.
Started in 2024 for a web games challenge, rebooted in 2026.

- **VS CPU** with three AI levels (Rookie / Pro / Champion) and five boxers with their own styles
- **VS PLAYER** on one keyboard (split controls) or with gamepads
- Arcade controls with real boxing rules: stamina, guard, counters, knockdowns, 10-count, 3-knockdown TKO, judges' scorecards
- Anime presentation: toon shading and ink outlines, impact frames, speed lines, manga sound effects (ドゴッ!), hitstop, slow-motion knockdowns
- Fully procedural audio: punches, bell, crowd and referee count are synthesized at runtime (no audio files)

## Run it

```bash
npm install
npm run dev        # http://localhost:8080
npm run build      # production build in dist/
npm run preview    # serve the build
```

Useful URL flags: `?demo` (CPU vs CPU exhibition, also `&p1=takamura&p2=sendo&level=hard`), `?skipintro`, `?debug` (Babylon Inspector).

## Controls

Movement is relative to your opponent: forward steps in, back steps out, left/right circles around them.
Keys are read by physical position, so **ZQSD on AZERTY** and **WASD on QWERTY** both work.

| Action | VS CPU | 2P — Player 1 | 2P — Player 2 | Gamepad |
|---|---|---|---|---|
| Move | W A S D / arrows | W A S D | arrows | left stick / d-pad |
| Body jab | J | F | Num 4 / J | X / □ |
| Straight | K | G | Num 5 / K | Y / △ |
| Hook | U | R | Num 7 / U | B / ○ |
| Uppercut | I | T | Num 8 / I | A / ✕ |
| Body blow | L | H | Num 6 / L | RB / R1 |
| Guard (hold) | Space | Space | Num 0 / N | LB, LT |
| Duck / slip | Left Shift / O | Left Shift | Num . / Num 1 / O | RT / R2 |
| Special | E / P | E / Y | Num 9 / P | R3 / L3 |
| Pause | Esc | Esc | Esc | Start |
| Camera (VS CPU) | Tab / C | — | — | Back |

With one gamepad in 2P mode, the gamepad drives Player 2; with two, each player gets one.

### Fighting tips

- Land a punch while your opponent is winding up → **COUNTER** (big damage, slow-mo).
- Ducking a head punch opens a short counter window.
- Body blows drain stamina and chew through the guard; a guard with no stamina breaks.
- Punches chain into combos when they connect (or are blocked) — whiffs leave you open.
- Landing and taking hits fills the **spirit** bar. Full spirit unlocks your special:
  infighters (Ippo, Takamura, Sendo) unleash a super-armored rush, counter-punchers (Miyata, Mashiba) enter a jolt-counter stance.
- Knocked down? **Mash punch buttons** to beat the count. Each knockdown makes it harder.

## Project structure

```
src/
  core/      Game loop & screen flow, input (keyboard + gamepad), settings, constants
  fight/     Fighter state machine, moves data, combat resolution, match rules, AI, camera, presentation
  render/    Toon shader (skinned + static), procedural canvas textures
  world/     Arena: stadium backdrop, procedural ring, crowd sprites, light cones
  fx/        Post-processing (impact frames, speed lines), sparks, particles
  audio/     Procedural Web Audio engine (SFX, crowd, referee count)
  ui/        DOM menus/screens and the fight HUD
  data/      Roster
public/assets/models/   Optimized glTF models (boxer + stadium)
tools/      Asset pipeline (gltf-transform)
dev/        Developer pages: model viewer, animation probe, sound board
```

How a fight runs: `FightSession` steps the simulation at a fixed 60 Hz (fighters, controllers, combat, rules).
Everything visual and audible listens to its events in `FightPresenter`, which is where the game feel
(hitstop, shake, slow-mo, popups, crowd) is tuned. Punch timing lives in `src/fight/moves.js`; the frame numbers
were measured from the animation clips with `dev/animprobe.html`.

## Assets

The 3D source files from 2024 are heavy (~130 MB) and are not committed. The pipeline turns them into web-ready files:

```bash
# copy the sources into raw/ first:
#   raw/BoxerAnimations.glb   (character + 17 animations)
#   raw/stadium.glb           (arena)
npm run assets               # boxer only
node tools/optimize-assets.mjs --stadium
```

It renames the clips, strips root motion from the walk/pivot/dodge clips (movement is driven by code),
keeps only the color texture (the game is cel-shaded), resizes to 2K WebP and compresses meshes/animations
with meshopt: the boxer goes from 59.5 MB to 2.5 MB, the stadium from 69 MB to 1.4 MB.

Dev pages (with `npm run dev`): `/dev/viewer.html?anim=hook&n=2`, `/dev/animprobe.html`, `/dev/sfx.html`.

## Roadmap

- [x] v0.3 — Playable foundation: two boxers, full combat system, CPU AI, local 2P, rounds & rules, anime FX, procedural audio
- [ ] Dedicated boxer model (shirtless, trunks, real gloves) on the same rig + missing clips: block, KO fall, get-up, victory, side-steps
- [ ] Signature moves with their own animations (Dempsey Roll weave, Gazelle Punch, Liver Blow, Smash)
- [ ] Referee, corner men, ring entrance & between-round corner scene
- [ ] Career mode (Ippo's road from rookie to champion), unlockable fighters
- [ ] Touch controls, online versus
