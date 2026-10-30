# Dungeon Master

A from-scratch Dungeon-Keeper-style game, planned as **HTML5 first, Linux second**, based on a reverse-engineering
study of [OpenKeeper](https://github.com/tonihele/OpenKeeper) (a Java re-implementation of Dungeon Keeper II).

## What is here

| Path | What |
|---|---|
| `docs/01-architecture.md` | How OpenKeeper is built: ECS, game loops, controllers, task board, creature AI, pathfinding, triggers |
| `docs/02-file-formats.md` | DK2 binary formats as OpenKeeper parses them: WAD (+ RefPack LZ), KWD blocks, tile/terrain/room/creature layouts, balance variables |
| `docs/03-game-systems.md` | Gameplay rules distilled into a spec (terrain health state machine, tasks, economy, mood, rooms, combat) |
| `docs/04-port-plan.md` | Stack choices (browser vs Linux-native), legal notes, milestone list, which Java files to read for each milestone |
| `web/index.html`, `web/game.js` | **Playable prototype**: the headless-style simulation plus a 2D canvas view, no copyrighted assets |
| `web/render3d.js` | **3D view** (three.js, stand-in boxes/cones/cylinders). Only reads the sim state, so art can be swapped later |
| `web/vendor/` | three.js 0.160.0 (MIT) kept in the repo so nothing loads from a CDN |

## Run the prototype

```sh
python3 -m http.server -d web 8000     # then open http://localhost:8000   (?seed=123 gives another map)
# ?view=2d forces the old flat canvas view. Opening index.html straight from disk (file://) also falls back to 2D,
# because browsers block ES modules there.
```

**3D controls:** `W A S D`/arrows pan, mouse wheel zooms, middle-drag pans. Clicking picks the wall top or floor under the cursor.

Tag earth with **Dig** (left-drag; right-drag untags). Imps dig, mine gold, claim floor and haul gold to a
**Treasury**. Dig east to the purple portal and claim it; creatures arrive and need a **Lair**, get angry without
one, and get paid every payday. `window.__game` exposes the sim for testing.

The prototype implements: terrain-health state machine (`damageTile`/`healTile`), per-player task board with
per-tile tasks and assignee caps, A* with no corner-cutting, imp work/deliver loop, gold-proportional mining, gem
seams, room building, lair assignment, mood/anger, sleep and payday, free-imp spawning, plus **combat and heroes**:

* **Hero Gate** (red-tinted cavern, south): dig a tunnel to it and invasion waves start (5 waves, growing parties of
  Knights, Archers and Mages that follow a party leader and hunt your Dungeon Heart; ranged heroes shoot).
* **Fight AI** modelled on `CreatureState.IDLE`'s "flee or attack first": sense (sight + line of sight; keepers also
  "hear" intruders on their own land) → flee when below 25 % hp → chase until in range → strike on recharge.
  Imps never fight, they run to the Heart. Heroes that get weak run back to the Gate and escape.
* Creatures heal on your land, sleep in lairs below 50 % hp, and **level up** from kills.
* **✋ Hand**: pick up an imp or creature and drop it into the fight.
* You win by surviving all waves, lose if the Heart (2500 hp) falls.

Numbers marked `VAR` come from OpenKeeper's level variables; combat stats are tuning values.

## Licensing — read before you ship

* OpenKeeper is **GPL-3.0-or-later**. The docs here describe its behaviour and data layouts; the prototype is
  newly written, but if you start copying or translating OpenKeeper code, your project must be GPL-3 too.
* **Dungeon Keeper II's art, audio, models, text and level files belong to EA.** Never commit them. Either load a
  user's own copy at runtime or make your own assets.
