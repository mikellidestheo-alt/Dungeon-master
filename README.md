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
| `web/index.html` | **Playable prototype**, single file, no dependencies, no copyrighted assets |

## Run the prototype

```sh
python3 -m http.server -d web 8000     # then open http://localhost:8000
# or just open web/index.html in a browser;  ?seed=123 gives another map
```

Tag earth with **Dig** (left-drag; right-drag untags). Imps dig, mine gold, claim floor and haul gold to a
**Treasury**. Dig east to the purple portal and claim it; creatures arrive and need a **Lair**, get angry without
one, and get paid every payday. `window.__game` exposes the sim for testing.

The prototype implements: terrain-health state machine (`damageTile`/`healTile`), per-player task board with
per-tile tasks and assignee caps, A* with no corner-cutting, imp work/deliver loop, gold-proportional mining, gem
seams, room building, lair assignment, mood/anger, sleep and payday, free-imp spawning. Numbers marked `VAR` come
from OpenKeeper's level variables.

## Licensing — read before you ship

* OpenKeeper is **GPL-3.0-or-later**. The docs here describe its behaviour and data layouts; the prototype is
  newly written, but if you start copying or translating OpenKeeper code, your project must be GPL-3 too.
* **Dungeon Keeper II's art, audio, models, text and level files belong to EA.** Never commit them. Either load a
  user's own copy at runtime or make your own assets.
