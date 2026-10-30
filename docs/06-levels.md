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
  name: 'The First Dungeon',     // shown on the briefing screen
  tagline: 'One line for the menu.',
  briefing: '...',               // text for the briefing card (the chapter menu always opens a level with it; ?brief=1 does the same by hand)
  stars: { heart: 0.5, par: 300 },   // optional, tunes the three stars: see "Chapters, stars and saves"
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
    endless: false,              // true = no plan: generated waves that never stop (see "The sandbox and endless mode")
    prep: 75,                    // seconds from linking the Hero Gate to the first wave
    interval: 110,               // seconds between waves
    scale: 0.12,                 // each wave's heroes are this much stronger than the last (1 + scale * waveNumber)
    heroMult: 1,                 // multiplies every hero's strength: the main difficulty dial
    plan: [['Knight', 'Archer'], ['Knight', 'Mage', 'Thief'], ...],   // one list of hero names per wave
  },

  rules: { heartHp: 2500 },

  objectives: [ { type: 'room', room: 'treasury', n: 2 }, { type: 'survive' } ],   // optional, see "Objectives"
  guide: [ { text: 'Choose <b>Dig</b>...', tool: 'dig', at: [9, 5, 12, 5], when: { type: 'dug', n: 4 } } ],   // optional, see "The guide"
}
```
`terrain`, `heart` (a grid's `H`) and `start` are required. **`portal`, `gates` and `waves` are optional**: a level with no Hero Gate
has no invasion, no wave counter in the HUD and is won by its objectives (see `lesson`).

## Objectives

`objectives` is a list of conditions. The level is won the moment every one that is not `optional: true` is done; the Dungeon Heart
falling is still the only way to lose. **A level with no `objectives` means "beat every wave"** (an implicit `{ type: 'survive' }`), so
`classic` and `tiny` are unchanged. A finished objective stays finished. `text` overrides the generated label; `quiet: true` keeps it
out of the log; `optional: true` marks a bonus that the chapter stars will use.

| `type` | extra fields | done when |
|---|---|---|
| `survive` | | every wave has arrived and no hero is left (needs `waves.plan`) |
| `wave` | `n` | `n` waves have spawned (needs `waves.plan`) |
| `portal` | | the Portal is claimed (needs a Portal) |
| `gate` | `n`=1 | tunnels link `n` Hero Gates to your Heart (needs that many Gates) |
| `dug` | `n` | `n` tiles of earth or gold were dug out (counted as they crumble) |
| `mined` | `n` | `n` gold has been released from seams |
| `claimed` | `n` | imps have claimed `n` floor tiles |
| `gold` | `n` | you hold `n` banked gold (needs Treasury space) |
| `room` | `room`, `n`=1 | you own `n` tiles of `treasury` / `lair` / `library` / `hatchery` / `temple` / `prison` / `torture` |
| `creatures` | `n`, `kind`? | `n` live creatures (of that kind, e.g. `'Warlock'`) |
| `kills` | `n` | `n` heroes slain |
| `research` | `item` | that item is researched (`prison`, `temple`, `torture`, `gas`, `bolt`, `heal`, `haste`, `lightning`, `rally`) |
| `doors`, `traps` | `n` | `n` doors / traps are placed |
| `prisoners` | `n` | `n` prisoners are held right now |
| `spells` | `n` | `n` spells cast |

The same table drives the HUD: the **Objectives** panel at the top left of the dungeon view lists them with `value/goal` counters and
ticks them off, and the victory text is `LV.victory` if the level sets one.

## The guide

`guide` is a list of tutorial steps, shown one at a time in a parchment banner at the bottom of the dungeon view:

```js
{ text: 'Choose <b>Dig</b> and drag over the earth east of your Heart.',   // HTML allowed
  tool: 'dig',               // optional: the toolbar button with this id (dig, treasury, lair, door, ...) pulses
  at: [9, 5, 12, 5],         // optional: a pulsing marker on that tile [x, y] or box [x0, y0, x1, y1]
  when: { type: 'dug', n: 4 } }   // optional: any objective condition. Without it the step shows a "Got it" button.
```
A step with `when` moves on by itself the moment its condition holds (even if it already held, so steps never get stuck behind things the
player did early). The ✕ hides the guide for the session; `?guide=0` turns it off. The guide never blocks play.

## Several Hero Gates

Every `X` on a grid (or entry in `gates`) is a Hero Gate, and each one is **linked on its own**: it opens the moment a path of open floor
joins it to your Heart. Rules:

- The **first** link starts the invasion clock (`waves.prep`); later links only add an entrance (the log says "Hero Gate 2 is linked too").
  A Gate you never tunnel to never sends anyone.
- A wave is **split, not doubled**: its heroes are dealt out between the Gates that are linked when it spawns, starting from a different
  Gate each wave (so the Prince arrives at one Gate and the King at the other). Each Gate's group has its own leader. The HUD shows
  "gates 1/2" next to the countdown once a level has more than one.
- Heroes that flee run back to **the Gate they came out of** and escape through it.
- The `gate` objective can ask for several: `{ type: 'gate', n: 2 }` ("Link tunnels to 2 Hero Gates").
- 3D: every Gate has its own sprite and light, dim until linked, glowing once linked.
- Sandbox: `&gates=2` adds a second hero cavern and Gate in the north of the classic map (the sandbox page has a "Two Gates" switch).

## The campaign

The ten chapters live in `web/chapters.js` (loaded after `levels.js`), which also sets `window.CAMPAIGN`, their order. Each teaches one
thing, and the difficulty rises through data alone:

| # | id | chapter | new | waves | hero x | prep | gap | Gates | unlocked at the start |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `tutorial` | The Awakening | dig, mine, claim, Treasury, Lair, Portal; one weak Knight | 1 | 0.50 | 180 | 110 | 1 | nothing |
| 2 | `portal` | Creatures of the Dark | the Portal, beds, wages | 3 | 0.70 | 160 | 110 | 1 | nothing |
| 3 | `hatchery` | Mouths to Feed | hunger, the Hatchery | 4 | 0.75 | 150 | 110 | 1 | nothing |
| 4 | `library` | The Library | research (you study Gas Trap and Heal) | 4 | 0.80 | 140 | 105 | 1 | nothing |
| 5 | `traps` | Doors and Snares | doors, traps; **Dwarf** | 5 | 0.90 | 125 | 100 | 1 | Gas, Lightning traps |
| 6 | `prison` | The Dungeon Below | Prison, Torture Chamber; **Monk** | 5 | 1.00 | 110 | 100 | 1 | + Prison, Torture |
| 7 | `temple` | Prayers and Power | Temple, spells; **Fairy** | 6 | 1.05 | 100 | 95 | 1 | + Temple, every spell |
| 8 | `gates` | Two Gates | two entrances; **Giant** | 6 | 1.10 | 90 | 90 | 2 | everything |
| 9 | `siege` | The Siege | **Prince**, **Stone Knight** | 8 | 1.25 | 75 | 85 | 2 | everything |
| 10 | `crusade` | The King's Crusade | the **King**; three entrances | 10 | 1.40 | 60 | 80 | 3 | everything |

"hero x" is `waves.heroMult`, "prep" the seconds from the first linked Gate to wave 1, "gap" the seconds between waves. Starting gold rises
from 800 to 2500 and the extra strength per wave (`waves.scale`) from 0 to 0.10. Chapters 5 onwards also shrink the Heart from 3000 to 2500
(the Tutorial and chapters 2-3 are more forgiving). Parties never exceed the Gate pad's nine heroes. **Design target** (to be confirmed by
the bots of step 7): the Tutorial 5-8 minutes, chapters 2-4 10-12, 5-7 12-16, 8-9 16-22, the finale 22-28, about 2.5-3 hours in all.

Things every chapter shares:

- **The maps** are text grids from 30x17 to 52x32. Rock ridges (`#`) with gaps cut each map into chambers, so any tunnel to a Gate must pass
  a gap: those are the choke points for doors and traps. Gold seams are scattered (each is worth 2000), a few gem seams give a trickle
  late on. The Heart is always at the west, the Portal at the east, the Gates south and north (chapter 10: south-west, north, south-east).
- **Objectives** are always "claim the Portal ... tunnel to a Gate ... defeat every wave" plus what the chapter teaches (a room, research,
  doors and traps, spells, creatures, `gate` with `n: 2`). Nothing required depends on luck: a prisoner, for example, is only a bonus.
- Every chapter after the Tutorial has a **bonus objective** (the third star): more creatures, more traps, more spells, a research
  extra, kills, banked gold.
- **Guides** introduce the chapter's new thing as it comes up; the Tutorial's has eleven steps with markers and pulsing buttons and
  carries you from the first dig to the Knight. `?guide=0` turns them off.
- In chapters 9 and 10 you need only **one** Gate linked to start the clock: link one and fight on a single front, or open more and
  every wave is split between them.
- `lesson`, `classic` and `tiny` stay in `levels.js` as fixtures and the sandbox's base map; they are not part of the campaign.

## Chapters, stars and saves

**`menu.html`** is the front door:
it lists those chapters with their `tagline`, shows stars and the best time, and opens a chapter at `index.html?level=<id>&brief=1`. A
chapter is unlocked when the one before it has been won (the first always is). `menu.html?unlock=all` opens every chapter for testing.
Levels that are not in `CAMPAIGN` (`tiny`, `classic`, `lesson`) still play from the URL; they are saved too, but not listed.

**Three stars**, judged when you win (rules in `web/progress.js`):

1. win the chapter;
2. the Dungeon Heart still has at least `stars.heart` of its health (default `0.5`);
3. every bonus objective (`optional: true`) is done, **and** the chapter was won within `stars.par` seconds if it sets one. A level with
   neither bonus objectives nor a par time asks for the Heart at 90% instead.

**The end screen** replaces the old banner in both the 2D and the 3D view: Victory or Defeat, time, heroes slain, Heart, the stars with
what each one asked, "First victory!" / "New best!", then **Next chapter** (when there is one), **Retry** and **Chapters**.

**Saves** are one localStorage key, `dm.save.v1`: `{ v: 1, levels: { <id>: { stars, bestTime, bestKills, bestHeart, wins, defeats } } }`.
Stars and the best time only ever improve; a defeat adds to `defeats`. If storage is blocked the game keeps progress in memory and never
throws. `?nosave=1` skips saving (bots and experiments). The menu's "Erase saved progress" removes the key.

## The sandbox and endless mode

`sandbox.html` (linked from the chapter menu) builds a level from a few options instead of a hand-written one. It opens
`index.html?level=sandbox&...` and `makeSandbox(params)` at the end of `levels.js` turns the URL into an ordinary level object, so it
goes through `validateLevel` like any other. It always plays on the `classic` map; the seed picks the dungeon.

| param | meaning | range / default |
|---|---|---|
| `diff` | difficulty preset: `easy` (Apprentice), `normal` (Keeper), `hard` (Overlord), `brutal` (Dungeon Master) | `normal` |
| `waves` | how many waves to beat (fixed mode) | 3-15, 8 |
| `endless=1` | endless mode instead of `waves` | off |
| `gold`, `mana` | starting resources | 200-5000 (1500), 0-1000 (300) |
| `unlocks=all` | everything researched from the start | `none` |
| `seed` | map and random seed | 7 |

Out-of-range numbers are clamped and unknown words fall back to the defaults. The presets live in `window.DIFFICULTY` as plain data
(`heroMult`, `scale`, `prep`, `interval`, `minInterval`, `heartHp`); each is strictly harder than the one before it.

**The waves** come from `window.sandboxParty(n)`, a pure function: the same `n` always gives the same party. Waves 1-2 are Knights and
Archers, a new hero type joins every wave or two, parties grow from 2 to 9 (the Hero Gate's pad), at most two healers, and **every 5th wave
is led by a boss: the Prince on waves 5, 15, 25 ..., the King on 10, 20, 30 ...**

**Endless mode** is `waves: { endless: true, minInterval }` with no `plan`: heroes are generated wave after wave, strength grows by
`scale` per wave (times `heroMult`), and the gap between waves shrinks by 1.5 s per wave down to `minInterval`. It has no objectives and is
never won; it ends when the Heart falls ("Overrun") or when you press **Retire** in the HUD ("Retired", banks your score). The score is
**waves survived**: waves whose heroes are all beaten (the wave you are fighting when you die does not count). The best score is kept per
difficulty preset in the save (`endless: { <diff>: { best, runs } }`) and listed on the sandbox page. A fixed sandbox saves nothing and
shows no stars; both end screens offer Retry (same options, same seed) and a Sandbox button.

## Briefing

`index.html?level=<id>&brief=1` opens the level behind a **briefing card**: name, `briefing` text and the list of goals, with the game
paused until **Begin**. The chapter menu, Next chapter and Retry always open levels this way; opening the page by hand does not.

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

Put each marker inside a cavern at least 3x3 wide so the room pad fits. Several `X` give several Hero Gates (see "Several Hero Gates"). `tiny` is both the format's proof and a fast level for tests.

## Adding a level

1. Add an entry to `window.LEVELS` in `web/levels.js`.
2. Open `index.html?level=<id>`. Problems are reported in the console ("Level ... has problems") by `validateLevel`, which checks: the
   terrain source, equal-length grid rows, the Heart (and any Portal/Gates) lying inside the map with room for a 3x3 pad, waves having a
   Hero Gate, hero names in the wave plan, positive timings and Heart health, that the level has a way to win, and every objective and guide
   step (known type, its parameters, real rooms/items/tools).
3. `node tools/test_levels.js` runs the format's checks. It validates every level in the file, pins `classic` to the original level
   and plays `tiny` from start to victory. `node tools/test_objectives.js` covers objectives, the guide, the briefing and gate-less levels
   (it plays `lesson`, a no-Portal, no-Gate level won by objectives, from start to victory). `node tools/test_campaign.js` covers the star
   rules, saves, the menu, and the Victory / Defeat screens. `node tools/test_sandbox.js` covers the wave generator, the sandbox options,
   endless mode and the sandbox page. `node tools/test_gates.js` covers several Hero Gates. `node tools/test_chapters.js` checks the ten chapters (maps, curve, teaching, guides) and plays the Tutorial for real.

## What a level cannot express yet (planned)

- **Pre-placed creatures, doors and traps, per-level terrain tweaks**: not in the format yet.
