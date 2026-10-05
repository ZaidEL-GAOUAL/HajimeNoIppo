# Art brief — boxer model & animations

This is the spec for the 3D work (Blender / Mixamo). Hand it as-is to whoever (or whichever agent) does the modeling.
The game picks the new files up automatically; nothing in the code needs to change if the names below are followed.

## Where we are

All five boxers currently share one stock character: a man in a hoodie, sweatpants and sneakers. The game recolors
his clothes per fighter and builds boxing gloves in code on the hand bones. It works, but it doesn't read as a boxer.

## Deliverable 1 — the base boxer (highest priority)

One character, **shirtless boxer**: bare torso, boxing trunks with a waistband, boxing shoes, hand wraps, gloves.

| Item | Requirement |
|---|---|
| Style | Anime-friendly: clean shapes and readable silhouette. Skin, trunks, shoes and gloves are cel-shaded in game, so **flat colors beat detailed textures** |
| Size | ~1.75 m tall, standing at the origin, feet on the ground, **facing the Front view (-Y in Blender)**: the exported glTF must face +Z, like the 2024 `BoxerAnimations.glb` |
| Polycount | 20k–40k triangles total |
| Rig | **Mixamo skeleton** (upload the T-pose to mixamo.com auto-rigger). Bone names `mixamorig:Hips`, `mixamorig:LeftHand`… any `mixamorig<N>:` prefix works. Max 4 bone influences per vertex |
| Textures | One 2048×2048 color atlas (PNG). No normal/roughness maps needed |
| Recolor-friendly | Trunks, shoes, gloves and hair should be painted **light grey / white** in the texture so the game can tint them per fighter |

### Mesh names (important — this is how the game knows what to recolor)

Split the model into separate meshes whose names contain these words:

| Mesh name contains | Used for | Tinted with |
|---|---|---|
| `Body` | skin: head, torso, arms, legs | fighter skin tone |
| `Trunks` | shorts | fighter's bottom color |
| `Shoes` | boxing boots | fighter's shoe color |
| `Wraps` | hand wraps / tape (optional) | white |
| `Glove_L`, `Glove_R` | gloves, skinned to the hands | fighter's glove color |
| `Hair_<fighter>` | one hairstyle per fighter: `Hair_ippo`, `Hair_miyata`, `Hair_takamura`, `Hair_sendo`, `Hair_mashiba` | hair color |
| `Brows` / `Lashes` | (optional) alpha-cut cards | — |
| `Top` / `Robe` | (optional) entrance robe | fighter's top color |

If gloves are included, the game stops generating its own. If several `Hair_*` meshes exist, each fighter shows only theirs.
Hairstyle references: Ippo — short spiky black; Miyata — neat dark, side part; Takamura — short black, wild;
Sendo — brown, spiky and messy; Mashiba — long dark, falling over the eyes.

## Deliverable 2 — animations

Download from Mixamo **on the new character** (so the retarget is clean), **"In Place" checked when offered**, 60 fps.
Put all clips as actions in the same file. Name each action exactly with the id in the first column.

### Already used by the game (re-download the same clips for the new body)

| Action name | Mixamo clip (2024 file) | Notes |
|---|---|---|
| `stance2` | Boxing stance 2 | idle guard, looping |
| `stance` | Boxing stance | |
| `stepForward` | Step forward | looped while walking in |
| `stepBack` | step backward | |
| `pivotLeft` / `pivotRight` | Left pivot / Right pivot | used for circling |
| `jab` | Jab body | lead hand to the body |
| `cross` | Cross | |
| `hook` | Left hook | |
| `uppercut` | Left uppercut | |
| `body` | right upper(BODY) | |
| `hitHead` | Head hit | |
| `hitBody` | Body hit | |
| `dodge` | Dodging backwards | the first 40 frames (duck) are used |
| `warmup` | warm up | menus / celebrations |

### New clips that unlock better visuals (each one replaces a procedural fallback)

| Action name | What it is | Search terms on Mixamo |
|---|---|---|
| `block` | high guard, gloves at the face (a held pose is fine) | "Center Block", "Boxing Block", "Body Block" |
| `knockedOut` | falls to the canvas and stays down (ends lying on the back) | "Knocked Out", "Knocked Down" |
| `getUp` | gets up from lying on the back to a stance | "Getting Up", "Stand Up" |
| `victory` | celebration, arms raised | "Victory", "Cheering", "Fist Pump" |
| `taunt` | (optional) taunt for the intro | "Taunt" |
| `strafeLeft` / `strafeRight` | (optional) boxing side-steps | "Left Strafe", "Right Strafe" |

## Export

- File → Export → **glTF 2.0 (.glb)**, include: selected or visible objects, **Animations** (all actions), Skinning, +Y up.
- Apply all transforms before export; scale 1.0.
- Save as `raw/BoxerAnimations.glb` in this repo (that folder isn't committed), then run:

```bash
npm run assets       # writes public/assets/models/boxer.glb (compressed, ~2–4 MB)
npm run dev          # check it in game, and in /dev/viewer.html?anim=block
```

Any punch clip whose timing differs from the 2024 one needs its frames re-measured: open `/dev/animprobe.html`
and update `start` / `impact` / `end` in `src/fight/moves.js`.

## Later (nice to have)

- Per-fighter heads (faces), not only hair.
- A referee (same rig) with: `count` (arm counting down), `separate`, `raiseHand`.
- Signature moves: Dempsey Roll (figure-8 weave + hooks), Gazelle Punch (crouch → leaping uppercut), Liver Blow,
  Smash (Sendo's rising half-uppercut), Flicker Jab (Mashiba).
