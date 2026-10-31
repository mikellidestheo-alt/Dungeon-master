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
    dig: 0,                      // 0-4: how many heroes tunnel through the earth towards your creatures (see "Heroes that dig")
    waiting: false,              // true = wave 1 is already standing on the Gate pad from the first second (see "A party that waits at the Gate")
    interval: 110,               // seconds between waves
    scale: 0.12,                 // each wave's heroes are this much stronger than the last (1 + scale * waveNumber)
    heroMult: 1,                 // multiplies every hero's strength: the main difficulty dial
    plan: [['Knight', 'Archer'], ['Knight', 'Mage', 'Thief'], ...],   // one list of hero names per wave
  },

  rules: { heartHp: 2500, arrivals: 'rooms', food: true },   // arrivals: 'rooms' (default) = the Portal draws only kinds whose rooms you have built; 'any' = every kind, as before
                                                                                // food: true (default) = the Hatchery limits your army (see "How many creatures you can keep"); false = beds only

  objectives: [ { type: 'room', room: 'treasury', n: 2 }, { type: 'survive' } ],   // optional, see "Objectives"
  guide: [ { text: '<b>Dig / grab</b> is chosen...', tool: 'dig', at: [9, 5, 12, 5], when: { type: 'dug', n: 4 } } ],   // optional, see "The guide"
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
| `room` | `room`, `n`=1 | you own `n` tiles of `treasury` / `lair` / `library` / `hatchery` / `temple` / `prison` / `torture` / `training` |
| `creatures` | `n`, `kind`? | `n` live creatures (of that kind, e.g. `'Warlock'`) |
| `level` | `n` (2 to 10) | one of your creatures has reached level `n` ("Train a creature to level 5"); training in the Training Room is the quick way |
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
{ text: 'Drag over the earth east of your Heart.',   // HTML allowed
  tool: 'dig',               // optional: the toolbar button with this id (dig, treasury, lair, door, ...) pulses; if it lives in a tab (Buildings, Spells, Monsters) that tab opens and pulses too
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
- Sandbox: `&gates=N` (1 to 6) puts N Hero Gates round the edge of the sandbox map, each in its own hero cavern, so the heroes can come from different directions (see "The sandbox and endless mode"); the sandbox page has a 1-6 selector.

## Who comes through the Portal

The Portal no longer draws every creature kind from the start. Each kind lists the rooms it wants and how many of your tiles of that room it
needs (the `NEEDS` table in `game.js`, right under `KINDS`); the Portal draws only among the kinds whose needs are met, still weighted
by `weight` and still with one `rand()` call per arrival, so a seed is reproducible. A kind with no entry comes to a bare Lair, so the
Portal never goes quiet. Converted prisoners and Skeletons do not come through the Portal and are unaffected.

| kind | needs | why |
|---|---|---|
| Goblin, Spider, Fly | nothing | they come for a bed |
| Troll | Treasury 3 | a hoard to guard |
| Black Knight | Treasury 5 | a hoard worth a knight |
| Salamander | Hatchery 2 | big eaters |
| Bile Demon | Hatchery 4 | the biggest mouth |
| Warlock, Dark Elf | Library 3 | thinkers come for books |
| Vampire, Dark Angel | Temple 3 | believers come for an altar |
| Mistress | Torture Chamber 2 | she comes for the rack |
| Assassin | Prison 2 | he comes for the captives |
| Reaper | Prison 2 **and** Torture Chamber 2 | the rarest, drawn by a whole dungeon of pain |

The numbers are tile counts of rooms you own. The **Monsters** tab has a *Who will come* view that lists every kind, ticked when it can
come and otherwise saying what it needs ("Warlock: needs Library 3", hover for a sentence). The first time a kind that needed a room
arrives, the log says why ("A Warlock has heard of your Library."). `rules.arrivals: 'any'` switches the rule off for a level (the
old behaviour); `?unlock=1` is unrelated and still means "research everything". Chapters 1-3 have no Library, so their
armies are Goblins, Spiders and Flies until you build Treasury and Hatchery tiles for Trolls, Salamanders and Bile Demons; chapter 4
teaches the Library, chapter 6 the Prison and Torture Chamber, chapter 7 the Temple.

## Levels and the Training Room

Creatures have levels 1 to 10 (`VAR.MAX_LEVEL`). A **Training Room** (150 gold a tile, available from the start, `training` in objectives) holds one
dummy per tile. An idle creature that is fed, rested and below level 10 walks to a free dummy and trains for `TRAIN_SECONDS` 20 s: it gains
`TRAIN_XP_PER_SECOND` 0.75 XP a second (15 a session) and the session costs `TRAIN_COST` 15 gold, paid at the dummy. A creature will not train if
that leaves the purse under `TRAIN_KEEP_GOLD` 100, or under the whole payday's wages in the 30 s before payday (`TRAIN_PAYDAY_WINDOW`): wages come first, and the log says so once. The priority order stays hunger, sleep, torture duty,
then study and prayer; after a session at a desk or an altar the creature's next choice is the dummy, and with nothing else to do it trains.
A kill gives `XP_PER_KILL` 1 XP (a trickle: kills alone barely move a creature now). The XP table is `VAR.XP_FOR_LEVEL`: 50, 65, 80, 100, 125,
155, 190, 230, 280 to go from level 1 to 10 (1275 in all). Measured with one creature training without a break: level 2 after 1.5 minutes, 5 after
8, 8 after 21 and 10 after 35 minutes, so level 10 is for the long chapters.

Each level multiplies hp and damage by `LEVEL_STAT_MULT` 1.11 (x2.5 at level 10; it was 1.18 per level up to 5) and adds 8% of the base wage
(`PAY_PER_LEVEL`): a level-10 Troll costs 155 instead of 90 at payday. Research and prayer rates still scale +10% a level. The elite sprite shows from level 3.
Show: the roster chip has the level and an XP bar (tooltip "Troll #3, level 4 (12/100 XP)"), the 2D view draws one pip per level (orange from 6),
and the existing `levelup` sound and log line play on every level. Training makes its own wooden `train` sound. In 3D each tile shows the owner's training-stand sprite (`training.png`), which rocks while a creature hits it.

## How many creatures you can keep

The army is capped at `min(15, beds, food)`: **beds** are your owned Lair tiles (one creature each); **food** is a larder allowance of 3 plus
4 per owned Hatchery tile (`VAR.FREE_FEED`, `VAR.FEED_PER_HATCHERY_TILE`); 15 is the Portal's own limit. The Portal stops drawing creatures
at the limit and logs "Your dungeon is full" once (the line says whether beds or food are the limit); it resumes when the limit rises.
Nobody is thrown out if it later falls, the surplus is just not replaced. The top bar reads `Creatures 5/9 beds` and the Monsters tab shows the
same, both with a tooltip naming the three limits.

The food number is derived from the sim, not guessed: a creature is hungry about every 120 s (`HUNGER_PER_SECOND` 0.5, `HUNGRY_AT` 60) and a
Hatchery tile lays a chicken every `CHICKEN_SECONDS` 24 s, so a tile feeds 5 creatures in theory; 4 leaves room for walking, eating and the
12-chicken world cap. The 3-creature allowance is real food: the Dungeon Heart's larder lays chickens like a fifth of a Hatchery tile (at most
3 about when there is no Hatchery). `node tools/test_capacity.js` plays ten minutes at the limit with 0, 1, 2 and 4 Hatchery tiles and nobody
starves or leaves. `rules.food: false` removes the food limit (beds still apply): the Tutorial and chapter 2 use it, because the Hatchery is
chapter 3's lesson. Chapter objectives were adjusted so the army they ask for fits: chapter 2 asks for a Lair of 5 (five creatures) and chapter 3
a Lair of 6 and a Hatchery of 4 (food for 19).

## Heroes that dig

`waves.dig` (0-4, default 0) lets heroes tunnel. A **digger** aims at the nearest creature within `VAR.HERO_DIG_SENSE` 20 tiles, else at your Heart,
and routes through earth and gold (not rock or gem seams) when that is the only way or under `HERO_DIG_SHORTCUT` 0.6 x the length of the walk (a wall tile
costs `HERO_DIG_COST` 6 steps). It walks to the wall and digs it like an imp, the tile becomes floor, and the rest of its party (who follow the leader) walk
through the tunnel it leaves. A digger leads its party, and more than one digger digs in parallel, so a tunnel goes faster. This bypasses the doors and traps
of the tunnel you built, so it is the counter to a fortress: put creatures, traps and doors near your Heart as well. What is dug by heroes is
no business of your objectives (their tiles and gold are not counted), the log says "Heroes are tunnelling through the earth towards you!" once, and
heroes can open an unlinked Gate this way, since a Gate links as soon as floor joins it to your Heart.

| `dig` | who digs | digging speed (imps are 80 %) |
|---|---|---|
| 0 | nobody | - |
| 1 | the first hero of each Gate's group, every 4th after it, and Dwarves | 45 % |
| 2 | every 3rd, and Dwarves | 55 % |
| 3 | every 2nd, and Dwarves | 70 % |
| 4 | every hero | 85 % |

Bosses (Prince, King) and flyers (Fairy) never dig. The campaign sets it by chapter: 0 in chapters 1-3, 1 in 4-5, 2 in 6-7, 3 in 8-9 and 4 in the
finale; the sandbox sets it by difficulty (Apprentice 0, Keeper 1, Overlord 2, Dungeon Master 3). `tools/test_digging.js` checks the rules.

## A party that waits at the Gate

`waves.waiting: true` turns the first wave into a party that is **already there**. When the level opens, wave 1's heroes stand on the
Hero Gate's pad, idle and visible in both views, shut out by the rock: they have no path to you, so they cannot walk. The moment a
tunnel links their Gate (the check runs twice a second while anyone waits) they are released and attack: there is no countdown, the
wave horn sounds and the log says so. Details:

- The waiting party **is wave 1**. `G.wave` stays 0 until the link, then becomes 1, and `waves.interval` is the gap before wave 2.
  `waves.prep` is not used (the Tutorial sets 0); `survive` and the `wave` objective count it like any wave.
- With several Gates the party is dealt out between *all* of them; each Gate's heroes are released when that Gate is linked.
- A waiting hero still fights what comes to him (a creature you drop into the cavern with the Hand), but never walks to your Heart.
- Waiting heroes are not counted in the HUD's "heroes" figure and do not tense the music; the score turns tense when they are released.
- `validateLevel` requires a non-empty `waves.plan` and rejects `endless` (the sandbox's generated waves have no wave 1 to place).
- Only the Tutorial uses it. It works for any chapter with a plain edit of the data: `waiting: true`.

## The campaign

The ten chapters live in `web/chapters.js` (loaded after `levels.js`), which also sets `window.CAMPAIGN`, their order. Each teaches one
thing, and the difficulty rises through data alone:

| # | id | chapter | new | waves | hero x | prep | gap | Gates | unlocked at the start |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `tutorial` | The Awakening | dig, mine, claim, Treasury, Lair, Portal; one weak Knight, waiting at the Gate | 1 | 0.50 | - (waits) | 110 | 1 | nothing |
| 2 | `portal` | Creatures of the Dark | the Portal, beds, wages | 3 | 0.70 | 90 | 75 | 1 | nothing |
| 3 | `hatchery` | Mouths to Feed | hunger, the Hatchery | 4 | 0.90 | 75 | 70 | 1 | nothing |
| 4 | `library` | The Library | research (you study Gas Trap and Heal) | 4 | 1.05 | 60 | 65 | 1 | nothing |
| 5 | `traps` | Doors and Snares | doors, traps, Training Room; **Dwarf** | 5 | 0.85 | 55 | 60 | 1 | Gas, Lightning traps |
| 6 | `prison` | The Dungeon Below | Prison, Torture Chamber; **Monk** | 6 | 0.85 | 55 | 60 | 1 | + Prison, Torture |
| 7 | `temple` | Prayers and Power | Temple, spells; **Fairy** | 6 | 1.20 | 50 | 60 | 1 | + Temple, every spell |
| 8 | `gates` | Two Gates | two entrances; **Giant** | 7 | 1.00 | 45 | 55 | 2 | everything |
| 9 | `siege` | The Siege | **Prince**, **Stone Knight** | 8 | 1.00 | 40 | 55 | 2 | everything |
| 10 | `crusade` | The King's Crusade | the **King**; three entrances | 10 | 1.08 | 35 | 50 | 3 | everything |

"hero x" is `waves.heroMult`, "prep" the seconds from the first linked Gate to wave 1 (the Tutorial has none: its Knight waits at the Gate and attacks the moment you link it), "gap" the seconds between waves. Starting gold rises
from 800 to 2500. `waves.scale` (extra strength per wave) is a balancing dial, 0 to 0.14: it is higher where a chapter's early waves are light.
The Heart shrinks from 3000 to 2500 by chapter 5. Parties never exceed the Gate pad's nine heroes. **Length targets**: the Tutorial 3-5
minutes, chapters 2-4 10-12, 5-7 12-16, 8-9 16-22, the finale 22-28, about 2.5-3 hours in all (see "Balance" for how that was checked).

**Map sizes.** Chapters 1 and 2 are the small maps (30 x 17, 36 x 20). Chapters 3 to 10 are **enlarged**: they are drawn at the old size and `enlargeGrid(grid, salt)`
in `levels.js` doubles them in both directions (four times the area: 76 x 44 for chapter 3 up to 104 x 64 for the finale) while keeping the drawn
ridges and gaps, so every chapter keeps its choke points. Each drawn cell becomes a 2 x 2 block (a gold seam keeps its two tiles, a gem one, the Heart / Portal /
Gate markers become one marker with floor around it) and a seeded hash, salted with the chapter's name, adds extra gold seams, 2 x 2 rock pillars and a few hidden
caves (a small open floor with seams in its corners) to the middle of big earth fields. Distances double, so tunnels and armies take longer to place; the
wave timers were shortened to keep the pressure up (prep 90 s down to 35 s, gap 75 s down to 50 s: they were 160 down to 60 and 110 down to 90).

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
- `lesson`, `classic` and `tiny` stay in `levels.js` as fixtures; they are not part of the campaign (the sandbox has its own, larger map).

## Balance

`node tools/test_bots.js` plays every chapter with scripted players (`tools/bot.js`, which runs inside the game page through the public API
and never uses randomness) and fails if a chapter is not winnable, is trivial, or runs outside its length target. A whole chapter takes
a few seconds, so the full matrix (10 chapters x 2 bots x 8 seeds, 160 runs) takes about 80 seconds. `BOT_SEEDS`, `BOT_CHAPTERS=1,5,10`
and `BOT_JSON=file` narrow or record it. A run is reproducible: the same chapter and seed always give the same result.

- The **steady** bot plays like a sensible newcomer: it tags the nearest gold seams (and mines a gem seam when the seams run dry), digs to
  the Portal, builds the Treasury, a Lair that grows with the army, a Hatchery (creatures starve without one) and whatever the chapter
  asks for, studies what the objectives want, keeps four imps alive, digs a tunnel to the Gate but leaves the last tile, lines the
  approach to the Heart with two doors and up to six traps, and only then opens the Gate. In battle it casts Lightning, Heal and Call to Arms.
- The **lazy** bot does the least that starts the invasion: a Treasury, a Lair of three, the Portal, and a tunnel to the Gate at once.

Results with 8 seeds each (what the test pins, with margins, is in the file):

| # | chapter | steady bot wins | game time | creatures lost per run | bonus star | lazy bot survives |
|---|---|---|---|---|---|---|
| 1 | The Awakening | 8/8 | 2.3 min | 0 | - | 8/8 (it is the Tutorial) |
| 2 | Creatures of the Dark | 8/8 | 8.1 | 0 | 8/8 | 8/8 |
| 3 | Mouths to Feed | 8/8 | 10.9 | 0 | 8/8 | 0/8 |
| 4 | The Library | 8/8 | 12.6 | 0 | 8/8 | 0/8 |
| 5 | Doors and Snares | 8/8 | 12.7 | 0 | 8/8 | 0/8 |
| 6 | The Dungeon Below | 8/8 | 14.1 | 5 | 8/8 | 0/8 |
| 7 | Prayers and Power | 8/8 | 14.6 | 0 | 8/8 | 0/8 |
| 8 | Two Gates | 8/8 | 16.4 | 2 | 8/8 | 0/8 |
| 9 | The Siege | 6/8 | 18.9 | 11 | 6/6 wins | 0/8 |
| 10 | The King's Crusade | 3/8 | 19.3 | 12 | 3/3 wins | 0/8 |

The bot is a *fast* player, so a first-time human takes longer: its times add up to about 131 minutes, against the 2.5-3 hours aimed for.
"Not trivial" means the lazy bot never wins a chapter after the first and never survives chapters 6-10, while the finale costs even the
careful bot about 11 creatures and more than half its runs. Chapters 1-8 are meant to be cleared cleanly by a prepared player: they teach, and
the pressure arrives in 9 and 10.

What the bots showed, and what changed because of it:

- The first curve was a cliff: chapters 1-8 untouched, chapter 9 half-lost, chapter 10 hopeless. Total hero health per chapter went
  75, 699, 1329, 1786, 2743, 3618, 4954, 6698, **13477**, **28984**. The ramp is now smooth: wave counts 1, 3, 4, 4, 5, 6, 6, 7, 8, 10, party
  sizes 2 to 9, hero strength x0.5 to x1.3, and chapters 4-8 moved up while the finale came down.
- Gold and imps decide the late chapters, not just heroes. Fifteen creatures cost about 1650 gold a payday, so a bot that only digs one
  seam at a time went bankrupt by wave 7 and could not re-arm traps. The late maps now have 16-20 gold seams, and a player who lets the
  imps die loses the traps too (the bot keeps four imps alive for exactly this).
- **Only about 40% of heroes are ever slain**: weak heroes flee and escape through their Gate. A "slay 24 / 40 heroes" bonus was out of
  reach; the bonuses are now 20 (chapter 9) and 22 (chapter 10), reached in about half of the wins.
- The bot's own bugs mattered: its first route search ran through the hero cavern and opened the Gate by accident, and its first
  defence zone sat on the wrong tunnel. Both were fixed in `bot.js`, not in the chapters.
- **After the rooms rule, capacity and levels** (arrivals by rooms, the army limit, the Training Room, the waiting Knight) the bots were taught
  the new rules in `bot.js`: beds and food kept ahead of the army, a Library from chapter 4 and a Temple from chapter 7 (the rooms that draw Warlocks,
  Dark Elves, Vampires and Dark Angels), and from chapter 5 a Training Room of up to six tiles. Measured with nothing retuned, the army was weaker (no
  stronger kinds) and the finale unwinnable (0/8); with the bot building those rooms and training, chapter 9 became a walkover (8/8) and chapter 10
  6/8, because trained creatures are stronger. Retuned with data only, as the brief prefers: **chapter 9** `heroMult` 1.2 to 1.3 and `scale` 0.08 to
  0.13 (now 5/8), **chapter 10** `scale` 0.04 to 0.07 (now 3/8). The Tutorial is shorter (the bot needs 2.3 minutes, a person about 3-5) because its Knight
  waits at the Gate, so its length window in `test_bots.js` moved from 4.5-8.5 to 1.8-5. The lazy bot (a Lair of three) now survives
  chapter 3 never and chapter 2 in 7 of 8: its army is capped by its three beds. With 15 creatures and six dummies a creature reaches level 2-3 in
  a chapter (average about 2); a player who builds more dummies levels faster.
- **Bigger maps, shorter timers, digging heroes.** With the enlarged maps (chapters 3-10), wave timers cut to 90..35 s before the first wave and 75..50 s between,
  and heroes that tunnel, the first full run had the steady bot winning 3/8 of chapter 5, 0/8 of 6 and 0/8 of 9. Two changes were the bot's: its Gate-planning goal
  (any floor within 3 tiles of the Gate centre) missed the now 14 x 14 hero cavern, so it never opened the Gate at all, and it opened the Gate with three creatures
  although the first wave now comes within a minute (it now waits for an army of 3 + the chapter number, at most 12). The rest was data: `heroMult` of chapters 5 and 6
  0.85, chapter 7 1.2, chapter 8 1.0, chapter 9 1.0 with `scale` 0.11, chapter 10 1.08. Digging heroes are also why the length targets in `test_bots.js` moved
  (chapter 2 7-12.5, chapter 4 9.5-14, chapter 10 17.5-28): the chapters are bigger but the first wave comes sooner, so most are about as long as before.
- The bot is a yardstick, not a person. It never uses the Hand, only levels creatures by building a Training Room and does not play the spells cleverly, so a good
  player should beat it; and results move by a seed or two when anything changes, which is why the thresholds have margins.

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
goes through `validateLevel` like any other. It plays on its own large map (`window.SANDBOX_MAP`: **88 x 60 tiles**, 4.7 times the 40 x 28 classic map): your Heart in the west, the Portal in the east and up to six Hero Gates round the edge (south, north, south-east, north-east, south-west, north-west), each in its own hero cavern. The seed picks the dungeon (random blobs of rock and gold between the fixed caverns; no rock is dropped on the lanes between the Heart, the Portal and the Gates, so every seed can be dug through, checked over 25 seeds with six Gates in `test_sandbox.js`).

| param | meaning | range / default |
|---|---|---|
| `diff` | difficulty preset: `easy` (Apprentice), `normal` (Keeper), `hard` (Overlord), `brutal` (Dungeon Master) | `normal` |
| `waves` | how many waves to beat (fixed mode) | 3-15, 8 |
| `endless=1` | endless mode instead of `waves` | off |
| `gold`, `mana` | starting resources | 200-5000 (1500), 0-1000 (300) |
| `gates` | how many Hero Gates (south, north, south-east, north-east, south-west, north-west, in that order); each wave is split between the ones you have linked | 1-6, 1 |
| `unlocks=all` | everything researched from the start | `none` |
| `seed` | map and random seed | 7 |

Out-of-range numbers are clamped and unknown words fall back to the defaults. The presets live in `window.DIFFICULTY` as plain data
(`heroMult`, `scale`, `prep`, `interval`, `minInterval`, `heartHp`, `dig`); each is strictly harder than the one before it. `dig` is how many heroes tunnel: 0, 1, 2, 3 (see "Heroes that dig").

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
