# Levels: the data format

A level is a plain JavaScript object in `web/levels.js`. `game.js` reads it when the page loads and builds the map, hands you your
starting resources, and runs the invasion on the level's own schedule. Nothing about a level is hard-coded in the simulation any more.
Open a level with `index.html?level=<id>` (no `level=` or an unknown id gives the default, `classic`). `?seed=N` still overrides the
level's own `seed`.

The game is **wave-based**: you build a dungeon, link a tunnel to a Hero Gate, and heroes invade in scripted waves. There is no rival
keeper. Winning means beating every wave; losing means the Dungeon Heart falls.

## Fields

```js
{
  id: 'classic',                 // the id used in ?level=
  name: 'The First Dungeon',     // shown in menus (not yet used)
  briefing: '...',               // text for the chapter screen (not yet used)
  seed: 7,                       // default random seed; the URL's ?seed= wins

  terrain: { ... },              // EITHER random blobs OR a hand-drawn grid, see below
  heart:  [x, y],                // centres of the 3x3 rooms (grid levels read these from their H / P / X markers)
  portal: [x, y],
  gates:  [[x, y]],              // one entry per Hero Gate

  start: {
    gold: 1000, mana: 300, imps: 3,
    unlock: 'none',              // 'none' = normal research gating | 'all' | ['prison', 'gas', ...] pre-researched
    research: 'prison',          // what the Library studies first (null = nothing selected)
    pretag: [[11, 14], ...],     // earth tiles already tagged for digging when the level opens
    welcome: 'text for the log',
  },

  waves: {
    prep: 75,                    // seconds from linking the Hero Gate to the first wave
    interval: 110,               // seconds between waves
    scale: 0.12,                 // each wave's heroes are this much stronger than the last (1 + scale * waveNumber)
    heroMult: 1,                 // multiplies every hero's strength: the main difficulty dial
    plan: [['Knight', 'Archer'], ['Knight', 'Mage', 'Thief'], ...],   // one list of hero names per wave
  },

  rules: { heartHp: 2500 },
}
```

Hero names must match `HEROES` in `game.js`: Knight, Archer, Mage, Thief, Guard, Monk, Prince, Dwarf, Giant, Stone Knight, Fairy, King.
The first hero in a wave is its leader. Heroes spawn on the Hero Gate pad, up to 9 per wave.

## Terrain, option 1: random blobs (`classic`)

```js
terrain: {
  size: [40, 28],
  generate: {
    rock: { count: 6, x: 4, xSpan: 32, y: 2, ySpan: 24, rMin: 1, rSpan: 2 },   // blobs centred at x + rand()*xSpan, radius rMin + rand()*rSpan
    gold: { count: 7, x: 12, xSpan: 16, y: 2, ySpan: 24, rMin: 1, rSpan: 0 },
    gems: [{ x: 26, y: 4, r: 1 }],
  },
  caverns: [ { rect: [2, 11, 10, 17], owner: 'keeper' }, { rect: [29, 11, 35, 17], owner: 'none' }, { rect: [19, 20, 25, 25], owner: 'hero' } ],
}
```
The map starts as solid earth with a rock border. Blobs are scattered with the level's seeded random numbers, **in this fixed order
(rock, gold, gems)**, so a given seed always draws the same map; the test pins the hash of seed 7. `caverns` carve open floor:
`keeper` floor is yours, `none` is unclaimed, `hero` is hero land (heroes arrive from it and you cannot claim it).

## Terrain, option 2: a text grid (`tiny`)

```js
terrain: { grid: [
  '##############################',
  '#.ooooo......_____.....hhhhh.#',
  ...
] }
```
Every row must be the same length; the map size is the grid's size.

| char | meaning | | char | meaning |
|---|---|---|---|---|
| `#` | rock (cannot be dug) | | `_` | bare floor, unclaimed |
| `.` | earth | | `o` | floor that is already yours |
| `g` | gold seam | | `h` | hero land |
| `G` | gem seam (never runs out) | | `H` `P` `X` | centre of the Dungeon Heart / Portal / Hero Gate: becomes a 3x3 room |

Put each marker inside a cavern at least 3x3 wide so the room pad fits. Several `X` give several gates; only the first one is used by
the invasion today. `tiny` is both the format's proof and a fast level for tests.

## Adding a level

1. Add an entry to `window.LEVELS` in `web/levels.js`.
2. Open `index.html?level=<id>`. Problems are reported in the console ("Level ... has problems") by `validateLevel`, which checks: the
   terrain source, equal-length grid rows, the Heart/Portal/Gate(s) lying inside the map with room for a 3x3 pad, hero names in the wave
   plan, positive timings and Heart health.
3. `node tools/test_levels.js` runs the format's checks. It validates every level in the file, pins `classic` to the original level
   and plays `tiny` from start to victory.

## What a level cannot express yet (planned)

- **Objectives, briefings on screen, win/lose beyond "survive every wave"**: the fields exist (`briefing`) but no menu reads them.
- **More than one working Hero Gate**: the rooms are built for each `X`, but heroes still spawn only at the first.
- **No Portal / no gate** (e.g. a tutorial without invaders): validation currently requires both.
- **Pre-placed creatures, doors and traps, per-level terrain tweaks, endless waves**: not in the format yet.
- **A chapter menu and saved progress**: levels are chosen only by the URL for now.
