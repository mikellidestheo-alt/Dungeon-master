# Dungeon Master

A from-scratch Dungeon-Keeper-style game, planned as **HTML5 first, Linux second**, based on a reverse-engineering
study of [OpenKeeper](https://github.com/tonihele/OpenKeeper) (a Java re-implementation of Dungeon Keeper II).

## Quick start

```sh
python3 -m http.server -d web 8000     # then open http://localhost:8000/menu.html
```

Open **`menu.html`** (opening a bare `index.html` also lands there), pick *The Awakening* (chapter I) and press **Begin chapter**. You need a current browser with WebGL for the 3D view
(without it the game falls back to a flat 2D view; `?view=2d` forces it) and you must serve the folder, not open `index.html` from disk.
I have only ever run it in headless Chromium; every other browser is part of the playtest below.

### Playing it online (GitHub Pages)

`.github/workflows/pages.yml` publishes the `web/` folder to GitHub Pages every time `main` changes (and on demand from the Actions tab, *Run workflow*).
**One-time setup:** in the repository go to *Settings -> Pages -> Build and deployment -> Source* and choose **GitHub Actions**. After the next push to
`main` the game is at `https://<owner>.github.io/<repo>/` and opens on the chapter menu. The workflow first checks that the key files are there and that
no `.sdt` (Dungeon Keeper II audio) file has crept into `web/`. Progress is saved in each visitor's own browser, so it is not shared. Note that GitHub
Pages for a private repository depends on your GitHub plan.

## How to play

**The idea.** You are a Dungeon Keeper. Your **Dungeon Heart** is the life of your dungeon. **Imps** dig, mine gold, claim floor and haul
gold home; **creatures** come through your **Portal** to fight for you. Heroes invade from the **Hero Gate(s)**, in waves, and hunt your Heart.
Nothing happens to you until you tunnel to a Gate, so you build at your own pace and **choose when the invasion starts**. A chapter is won by
completing its objectives (every chapter includes surviving all its waves) and lost if the Heart falls.

**The screen.**

| Where | What |
|---|---|
| Top bar | Gold (held / what your Treasuries can bank), Imps, Creatures (of 15), Payday countdown, Time, Mana, Heart, then Wave, heroes alive and a countdown to the next wave (it says *tunnel to Gate* until a Gate is linked, and *gates 1/2* when a level has more). A **☰ Chapters** (or **☰ Sandbox**) button, **Retire** in endless mode, **⛶ Full screen**, and the sound controls |
| Toolbar | Always in view: **Dig / grab** (the default mode), three tabs and **Pause / 1× / 3× / 8×**. The tabs open their own commands under the strip (above it in full screen): **🏰 Buildings** (the eight rooms, then the Defences: Door, Gas Trap, Lightning Trap), **✨ Spells** (the five spells with mana cost and hotkey) and **👹 Monsters** (the ✋ Hand and a roster of your creatures). Click a tab again, or press `Esc`, to close it. Anything not yet researched is greyed out |
| Dungeon view | Top left: the **objectives** (ticked as you go, with counters). Bottom: the **hint banner** (✕ hides it; the highlighted toolbar button and the gold marker on the map show what it means) |
| Below the view | **Task board** (digging queue, chickens, hungry, praying, prisoners, and the mood of every creature), **Log**, **Research** panel, and a short help scroll (the basics: digging, rooms, creatures, the invasion, objectives, camera) |

**Controls.**

| To do this | Do this |
|---|---|
| Dig or mine | **Dig / grab** is the default mode (it is lit when nothing else is chosen): drag a box over earth or gold and imps do the rest. Right-drag **untags** (and sells any door or trap in the box). Rock and gem seams cannot be dug through |
| Cancel a tool | **Right-click** (a click, not a drag) with any room, door, trap, spell or the Hand chosen: the tool is dropped and you are back in **Dig / grab**. `Esc` does the same once no tab is left to close |
| Open a tab | Click **Buildings**, **Spells** or **Monsters**, or press `B`, `C` or `H` (`H` also takes the Hand). Click the tab again or press `Esc` to close it. The number keys `1`-`5` open Spells for you. A dot on a tab means the tool you chose lives there. The tutorial's hints open the right tab themselves |
| Build a room | In the **Buildings** tab choose the room, drag a box over **your claimed floor** (bare floor you have not claimed yet does not count). It costs gold per tile. Rooms cannot be sold |
| Doors and traps | In the **Buildings** tab (Defences) choose it and click or drag over claimed floor, usually in a tunnel. **Right-click a door or trap (in the default mode) sells it for half**, and right-dragging over several sells them all. Imps repair doors and re-arm traps for gold |
| Cast a spell | In the **Spells** tab click its button, or press `1` Lightning, `2` Heal, `3` Speed, `4` Call to Arms, `5` Create Imp, then click the dungeon. Lightning needs a hero under the cursor. A refused cast costs nothing |
| Move a creature or imp | In the default mode **left-click** one on the map to pick it up (a gold ring under it shows what a click would grab; your cursor, the Keeper's evil hand, closes into a fist holding an imp, and the creature disappears from the map while you carry it), click again to drop it, for example into a fight. A **right-click while carrying** puts it down on the nearest open floor under the cursor (or back where it was lifted) and returns to the default. Pressing on a creature and dragging still tags. The **✋ Hand** in the **Monsters** tab (or `H`) keeps working as a tool of its own |
| Choose research | Click an item in the **Research** panel (only once you have a Library) |
| Camera (3D) | `W A S D` or the arrow keys pan, **or push the mouse to the edge of the map** (hold it there a moment; nearer the edge is faster; in full screen it is the edge of the screen, under the bars too); the wheel zooms, middle-drag pans |
| Full screen | The **⛶ Full screen** button in the top bar, or `F`. The map fills the screen, the numbers bar and the toolbar float over its top and bottom, and the Task board, Log and Research slide in from the right with **☰ Panels** or `P`. `Esc` leaves it. It is remembered, so *Begin* on the next briefing takes you back into it |
| Speed, sound | **Pause / 1× / 3× / 8×** buttons; `M` mutes, the sliders set master, music and effects volume |

**A typical chapter.**

1. **Dig and mine.** Tag the tunnel east and the nearest **gold seam**. Each gold tile is worth 2000 gold; gem seams (blue) never run out and pay 25 gold at a time.
2. **Bank it.** Build a **Treasury** (50 gold a tile). Your Heart holds 2000 gold on its own and each Treasury tile adds 3000; gold beyond that cannot be carried home.
3. **Claim the Portal** by digging to it and letting your imps claim the floor. A creature arrives about every 25 seconds, up to 15, and **which kind** depends on what you have built: Goblins, Spiders and Flies come to a bare Lair, Trolls and Black Knights want a Treasury, Salamanders and Bile Demons a Hatchery, Warlocks and Dark Elves a Library, Vampires and Dark Angels a Temple, the Mistress a Torture Chamber, the Assassin a Prison and the Reaper both. The Monsters tab's *Who will come* view lists them.
4. **Look after them.** Each creature needs a **Lair** tile to sleep in, **food** (a **Hatchery** raises chickens, they get hungry about every two minutes; the Heart's own larder feeds 3 creatures and every Hatchery tile feeds 4 more) and **wages** at every **payday** (every 90 seconds, 60 to 220 gold each; fifteen creatures cost about 1650 a payday). **The size of your Lair and Hatchery caps your army**: you can keep at most `min(15, Lair tiles, 3 + 4 per Hatchery tile)` creatures, the top bar shows `Creatures 5/9 beds` (or *food*, or *Portal*) with a tooltip naming all three limits, and the Portal waits (with a log line) while you are full. Unhappy creatures turn angry and eventually leave. The Task board shows every creature's mood.
5. **Prepare.** Build what the chapter teaches: Library and research, Prison and Torture, Temple, doors and traps, and a **Training Room** so your creatures level up (stronger, but their wages rise too). The gaps in the rock ridges are natural choke points.
6. **Open a Gate.** Tunnel to the red-tinted **Hero Gate** (a path of open floor from Gate to Heart). The first wave arrives after the chapter's preparation countdown (in the Tutorial the Knight is already standing in the Gate cavern and attacks the moment you break through). *Tip:* dig the whole tunnel except its last tile, set your doors and traps, and only then dig the last tile.
7. **Fight.** Creatures fight on their own and level up from kills. You cast spells, move creatures with the Hand and keep a few imps alive (they re-arm traps and mend doors, and they run from heroes, so replace them with `5`). Heroes that get weak run back to their Gate and escape, so you will slay only a part of each wave.
8. **Win or lose.** The end screen shows time, heroes slain, Heart left, and up to three stars. Next chapter, Retry and Chapters are one click away.

**Chapters, stars and saves.** The chapter menu lists ten chapters; each unlocks when the one before it is won. Stars: **1** win; **2** finish with at least half the Heart left; **3** also complete the chapter's **bonus objective**. Progress, best times and stars are saved in this browser (`localStorage`, key `dm.save.v1`); *Erase saved progress* on the menu clears them.

| # | Chapter | What it teaches | Feels like |
|---|---|---|---|
| I | The Awakening | digging, mining, claiming, Treasury, Lair, the Portal; guided step by step | one weak Knight; relax |
| II | Creatures of the Dark | the Portal, beds, wages | gentle |
| III | Mouths to Feed | hunger and the Hatchery | gentle |
| IV | The Library | research (Gas Trap, Heal) | first real pressure |
| V | Doors and Snares | doors and traps; the **Dwarf** disarms and smashes them | |
| VI | The Dungeon Below | Prison, Torture Chamber; the **Monk** heals | |
| VII | Prayers and Power | Temple, mana, spells; the **Fairy** flies over traps | |
| VIII | Two Gates | two entrances (each wave is split between linked Gates); the **Giant** | |
| IX | The Siege | the **Prince** and the armoured **Stone Knight** | hard |
| X | The King's Crusade | three Gates; the **King** | the hardest |

**Sandbox and endless mode** (button on the chapter menu): pick the number of waves, one of four difficulties, starting gold and mana,
whether everything is researched, one or two Hero Gates, and a map seed; or choose the **Endless Siege**, where waves never stop, get faster and
stronger, and a boss (Prince, then King) leads every fifth one. Your score is the waves you survived; **Retire** banks it. The best score per difficulty is saved.

**Handy URL options** (add to `index.html?...`; the menu and sandbox pass `view` and `sound` along):

| Option | Effect |
|---|---|
| `level=<id>` | a chapter (`tutorial`, `portal`, `hatchery`, `library`, `traps`, `prison`, `temple`, `gates`, `siege`, `crusade`), `classic`, `tiny`, `lesson` or `sandbox` |
| `seed=<n>` | another random seed (a different creature mix; for `classic` and the sandbox, a different map) |
| `brief=1` | open behind the chapter's briefing card; `guide=0` turns the hints off |
| `unlock=1` | everything researched from the start |
| `view=2d`, `cam=top` | the flat canvas view, or the steeper top-down 3D camera |
| `sound=0` | no audio at all |
| `nosave=1` | do not record the result (for testing) |
| `edge=0` | turn off scrolling the map by pushing the mouse to its edge |

## Playtest checklist

The scripted bots (`node tools/test_bots.js`) say every chapter is *winnable* and *not trivial*, and that a fast player's times add up to about
140 minutes. They cannot say whether it is **fun, clear or fair**, whether the art sits right, or how the sound feels. That is what this list is for.
Tick as you go; write down anything surprising in the template at the end.

**Before you start**

- [ ] Use a fresh browser profile or press *Erase saved progress* on the menu. Note the browser, version, operating system and GPU.
- [ ] Have a stopwatch or note the clock. Play with sound on and headphones for at least one chapter.
- [ ] If you want a true first-time experience, play chapter I without reading the *How to play* section above or `docs/`: the game is supposed to teach itself.

**1. Menu and first launch**

- [ ] `menu.html` loads with no console errors. Chapter I is open and selected; II to X are locked and say why. Clicking a locked chapter does nothing (and sounds a soft *deny*).
- [ ] *Begin chapter* shows the briefing card with the right title, text and goals, and the game is paused behind it. *Begin* starts the game.
- [ ] The sound controls on the menu work (the score plays after your first click; `M` mutes).

**2. Chapter I, played as a stranger would** (target 3 to 5 minutes)

- [ ] Can you tell what to do from the hint banner alone, at every step? Where did you hesitate? Is any hint wrong, late or missing?
- [ ] Does the pulsing toolbar button and the gold marker on the map point at the right thing every time (including in the 3D view)?
- [ ] Is the objective list (top left) readable and does it tick and count as you work?
- [ ] Do you understand why you must claim the Portal, build a Lair, and what the countdown after tunnelling to the Gate means?
- [ ] A Knight stands idle on the Hero Gate pad from the first second (3D and `?view=2d`), the score stays calm, and he does not move until the tunnel is open. Digging the last tile makes him attack at once, with the horn. Is it clear from the hints that you should raise a creature first?
- [ ] Did the Knight feel like a lesson rather than a threat? Did you pick a creature up with a click? Did the Heart take any damage?
- [ ] The victory screen shows three stars, *First victory!*, and Next chapter opens chapter II behind its briefing.

**3. For every chapter** (copy this block per chapter)

- [ ] Briefing and objectives make sense; the new thing the chapter teaches is clear without outside help.
- [ ] You could always see *why* you were stuck (no beds, hungry, out of gold, a locked item, nothing claimed).
- [ ] The map reads well: you can find the Portal, the Gate(s), the gold, and the gaps where tunnels must go. No seam or Gate is awkwardly placed.
- [ ] Time to finish was within the target below (a longer first play is normal). Note the actual time.
- [ ] Difficulty felt: too easy / fair / too hard / unfair. Was any single moment a cheap loss?
- [ ] The bonus objective (third star) was understandable and worth chasing.
- [ ] Defeat felt like *your* mistake, and Retry put you straight back in with the same map and seed.

| # | Chapter | Target (first play) | A good player should find | Check in particular |
|---|---|---|---|---|
| I | The Awakening | 5-8 min | trivial | the whole guide |
| II | Creatures of the Dark | 10-12 | easy | creature moods; beds; the first payday |
| III | Mouths to Feed | 10-12 | easy | does hunger show clearly? is the Hatchery obvious? |
| IV | The Library | 10-12 | easy, first real tension | choosing research in the panel; do desks fill? |
| V | Doors and Snares | 12-16 | fair | placing doors and traps; the Dwarf; the bonus (6 traps) |
| VI | The Dungeon Below | 12-16 | fair | capturing, imprisoning, torturing, converting |
| VII | Prayers and Power | 12-16 | fair | the Temple; mana; all five spells; the Fairy |
| VIII | Two Gates | 16-22 | fair, long | linking one Gate versus both; defending two tunnels |
| IX | The Siege | 16-22 | hard | gold running low; armour and the Prince; the last wave |
| X | The King's Crusade | 22-28 | the hardest; about half of careful runs win | the three Gates; the King's wave; the finish |

**4. Systems**

- [ ] **Economy:** gold seams, banking, Treasury capacity, wages, running dry. Is it clear how much gold you have and need?
- [ ] **Who will come:** with only a Lair, only Goblins, Spiders and Flies arrive. Build a Library (3 tiles) and a Warlock or Dark Elf turns up with a log line saying why. The Monsters tab > *Who will come* lists all 14 kinds, ticked or saying what they need. Is the rule easy to discover? Does a chapter ever feel stuck with weak creatures?
- [ ] **Capacity:** with 4 Lair tiles and no Hatchery the bar says `Creatures 3/3 food` and the log says the dungeon is full; a Hatchery tile makes it `4/4 beds`; more Lair tiles raise it. Does the tooltip make clear what to build? Does anyone starve at the limit?
- [ ] **Creatures:** arrival, beds, anger, leaving, leveling to elite sprites at level 3, healing in the Lair. Are the Task board lines understandable?
- [ ] **Training:** build a Training Room (Buildings tab; chapter 5 hints at it). Idle creatures walk to a dummy, hit it with a wooden knock, and level up (the roster chip shows an XP bar, the level-up chime and log line play, elite art from level 3). Gold drops 15 a session; with little gold they stop. Do wages feel fair as levels rise? Is the pace of levelling (about 1.5 minutes to level 2) pleasant? Does the dummy look acceptable as a stand-in for real art?
- [ ] **Hatchery:** chickens appear, hungry creatures eat, anger drops. What happens if you never build one?
- [ ] **Library:** research bars fill, an item completes, the toolbar unlocks it.
- [ ] **Doors and traps:** heroes stop at doors; traps fire and run out; imps repair and re-arm; right-click sells for half.
- [ ] **Prison and Torture:** knocked-out heroes are carried to the Prison, tortured and converted, or starve into skeletons.
- [ ] **Temple:** creatures pray, mana rises, the Temple art looks right at 3x3 and larger.
- [ ] **Spells:** every spell works and refuses politely (no mana, cooling down, no target). Hotkeys `1` to `5`.
- [ ] **Mouse modes:** with nothing chosen, left-drag tags walls and a left-click on a creature or imp picks it up (a gold ring shows which one), the next click drops it, dropping into rock is refused. Right-click cancels any chosen tool, in both views; right-click while carrying drops it nearby. Right-click sells a door or trap. Does it ever pick up an imp when you only meant to tag a wall? Is the ring easy to see?
- [ ] **Hand:** the ✋ Hand tool still picks up and drops creatures and imps.
- [ ] **Gates:** the countdown starts at the first link; with two or more Gates each wave is split; fleeing heroes escape through their own Gate; *gates 1/2* in the bar.
- [ ] **Speed:** 3x and 8x stay smooth in a big fight; Pause really pauses (including the end of a wave).

**5. Sandbox, endless and saves**

- [ ] Every control on the sandbox page changes the summary; *Begin* opens exactly that game; Retry reopens the same one (same seed).
- [ ] Two Gates in the sandbox: the second cavern is in the north and works.
- [ ] Endless: waves never stop, the gap shrinks, a boss leads waves 5, 10, 15, 20. *Retire* banks the score; *Overrun* when the Heart falls; the best per difficulty is saved and shown on the sandbox page.
- [ ] Stars and best times are saved across a reload; chapters unlock in order; *Erase saved progress* resets all of it.
- [ ] In a private window (storage blocked) the game still runs and nothing throws.

**6. Interface, art and performance**

- [ ] Resize the window from about 900 px to a very wide one: does the fixed layout scale cleanly? Is any text clipped or unreadable?
- [ ] Is anything in the 3D view hard to read: units hidden behind walls, sprites sitting wrong on their tile, the marker or objectives panel in the way?
- [ ] Frame rate in the 3D view at 1x, and at 8x in the biggest fight of chapter IX or X. Note your hardware if it stutters.
- [ ] Both views: `?view=2d` is playable too.
- [ ] Does the page ever feel slow after twenty minutes (memory, a growing log)?

**7. Sound** (headphones)

- [ ] Nothing plays before your first click, then the score fades in; mute, master, music and effects sliders work and are remembered after a reload.
- [ ] Effects are not tiring: imp chatter, chickens, digging and the coin sounds over a long session. Which one annoys you first?
- [ ] The wave horn and the boss horn make you sit up; the music tension follows the fight and relaxes afterwards.
- [ ] New sounds feel right: objective chime, hint bell, the briefing scroll, the stars on the end screen, the new-best flourish, the quiet *retire* bell.
- [ ] Volume balance between music and effects; anything too loud or too quiet.

**7a. The toolbar tabs**

- [ ] On first sight the toolbar is clean: Dig, three tabs, the speed buttons. Is it clear where to find a room, a trap, a spell?
- [ ] **Buildings** shows the rooms and, as a second row, the defences. **Spells** shows the five spells. **Monsters** shows the Hand and your creatures. Does each tab hold what you expected to find in it? Is anything in the wrong tab?
- [ ] Clicking a tab opens it and clicking it again closes it; `B`, `C`, `H` and `Esc` do the same. Is closing a tab by accident (or leaving one open) annoying?
- [ ] The number keys `1`-`5` open Spells and pick the spell. A dot on a closed tab tells you which tab holds your chosen tool. Is that enough?
- [ ] In the Tutorial each hint opens the tab it talks about and pulses the button. Later chapters: do the hints that say "choose Library / Temple / Gas Trap..." find their buttons easily?
- [ ] **Monsters:** click a creature in the list and the camera goes to it; click its ✋ to pick it up, then click the map to put it down. Is the list readable with 10-15 creatures (it scrolls)? Do level, health and mood faces help you find the creature in trouble?
- [ ] In a busy fight: how many clicks does it take to cast a spell, set a trap or move a creature, compared with before? Does anything you need constantly feel buried?

**7b. Full screen and edge scrolling**

- [ ] The **⛶ Full screen** button and the `F` key enter and leave full screen; `Esc` leaves it too. The map fills the whole screen, nothing is cut off, and the page does not scroll.
- [ ] The numbers bar (top) and the toolbar (bottom) float over the map without hiding the objectives or the hint banner. Every toolbar button is reachable.
- [ ] **☰ Panels** (or `P`) opens the Task board, Log and Research on the right; you can still pick research in chapter IV. Does anything need to be visible all the time that is not?
- [ ] Press *Begin* on a briefing after using full screen once: it goes back to full screen by itself.
- [ ] Push the mouse to each side of the map: it pans left, right, up and down, with a short delay and faster the nearer the edge. In the window the zone is about 24 px inside the map; in full screen it is the very edge of the screen, even under the bars.
- [ ] It does **not** scroll when you are just moving across to a button, or while a briefing or end screen covers the map. Is the delay and speed comfortable? (`?edge=0` turns it off.)
- [ ] Try several monitors and window sizes, and a laptop trackpad: is there a way you trigger edge scrolling by accident?

**8. Browsers and devices** (tick the ones you tried)

- [ ] Chrome or Chromium
- [ ] Firefox
- [ ] Safari
- [ ] Edge
- [ ] a laptop with no dedicated GPU
- [ ] Touch: the game uses pointer events, but I have never tried it on a tablet or phone. Is it playable? (Right-drag and middle-drag have no touch equivalent.)

**Known rough edges** (already known; tell me only if they are worse than described)

- In the window the page is a fixed 1461 x 2000 px layout scaled to the window width, so it is tall and you scroll to reach the Research panel and help. **Full screen** (`F`) is the way around that: the map fills the screen and the panels become a drawer.
- The 3D view has a dark corner at the top left of the map.
- Chapters opened from the menu are silent until your first click, because browsers refuse sound before a gesture.
- Heroes that flee escape through their Gate, so only about 40 % of a wave is ever "slain"; this is how the kill bonuses were sized.
- There is no keyboard shortcut for pause or speed, and no way to sell a room.
- The scripted bots never use the Hand and level creatures only by building a Training Room (their average creature is level 2 at the end of a chapter); a human should be able to beat them.

**Write-up template** (one row per chapter or problem)

| Chapter / area | Browser | Time | Felt (1 trivial ... 5 unfair) | Stars | What confused or annoyed me | Idea |
|---|---|---|---|---|---|---|
| | | | | | | |

## What is here

| Path | What |
|---|---|
| `docs/01-architecture.md` | How OpenKeeper is built: ECS, game loops, controllers, task board, creature AI, pathfinding, triggers |
| `docs/02-file-formats.md` | DK2 binary formats as OpenKeeper parses them: WAD (+ RefPack LZ), KWD blocks, tile/terrain/room/creature layouts, balance variables |
| `docs/03-game-systems.md` | Gameplay rules distilled into a spec (terrain health state machine, tasks, economy, mood, rooms, combat) |
| `docs/06-levels.md` | The level file format: terrain (random blobs or a text grid), starting resources, the invasion script, how to add a level |
| `docs/05-audio.md` | The sound system: event-to-voice table, music layers and the mood function, distance model, how to swap in recordings, testing |
| `docs/04-port-plan.md` | Stack choices (browser vs Linux-native), legal notes, milestone list, which Java files to read for each milestone |
| `web/levels.js` | **The levels**, as plain data: `classic` (the original level, reproduced exactly) and `tiny` (a hand-drawn text-grid map used by the tests) |
| `web/chapters.js` | The ten campaign chapters as text-grid levels with objectives, guides and scripted waves. See `docs/06-levels.md` |
| `web/cursor.css`, `web/assets/cursors/` | **The mouse cursor**: your evil-hand paintings as the pointer on every page (a pointing hand with its claw tip as the hotspot, and a fist holding an imp while you carry a creature, which is then not drawn in the world), 1x and 2x PNGs. Generated by `tools/make_cursors.py` from `tools/source/cursor-hand.jpg` and `cursor-grab.jpg` |
| `web/sandbox.html` | The sandbox page: waves, difficulty, resources, unlocks and seed, or the Endless Siege. See `docs/06-levels.md` |
| `.github/workflows/pages.yml` | Publishes `web/` to GitHub Pages on every push to `main` (see *Playing it online*) |
| `web/menu.html`, `web/progress.js` | The chapter menu (the front door), saved progress in localStorage and the three-star rules. See `docs/06-levels.md` |
| `web/index.html`, `web/game.js` | **Playable prototype**: the headless-style simulation plus a 2D canvas view, no copyrighted assets |
| `web/assets/music/` | The background track `beneath_the_sunken_hall.mp3` (yours), looped by `web/audio.js`; the synthesised score is the fallback |
| `web/audio.js` | **Sound and music**: effects synthesised with WebAudio (no audio files), the music is your track with the synthesised score as fallback: 57 effect voices driven by game events (including the briefing, objectives, tutorial hints, end-screen stars and the menus), quieter and panned by distance from the camera, plus a procedural dark-ambient score that builds with the invasion. HUD mute/volume. See `docs/05-audio.md` |
| `web/render3d.js` | **3D view** (three.js). Isometric camera, your prop sprites as billboards, pixel-art floor/wall textures generated in code, stand-in shapes for units. Only reads the sim state |
| `web/assets/sprites/` | Your hand-made art as transparent PNGs: 12 props (Heart, Portal, Hero Gate, Temple, door, traps, cage, rack, bed, bookshelf, treasure pile, wall, chicken coop, training stand) and 40 characters, plus `manifest.json` |
| `web/assets/anim/` | Animation strips (`<unit>.png`, 15 frames side by side) and `anim.json` with their sizes; generated by `tools/make_frames.py`, replaceable with hand-drawn strips |
| `web/assets/audio/` | Optional: `sounds.json` maps effect ids to your own recordings, which then replace the synthesised ones. Ships empty; its media files are git-ignored |
| `tools/test_levels.js` | Headless Chromium checks for the level format and loader: `node tools/test_levels.js` |
| `tools/test_audio.js` | Headless Chromium checks for the sound system: `node tools/test_audio.js` |
| `tools/bot.js`, `tools/test_bots.js` | Scripted players (a careful one and a lazy one) that play every chapter on several seeds; the test checks each chapter is winnable but not trivial and the right length: `node tools/test_bots.js` (about 80 s) |
| `tools/test_tabs.js` | Headless Chromium checks for the tabbed toolbar (what is in view, each tab, hotkeys, the tutorial opening tabs, the roster, full screen): `node tools/test_tabs.js` |
| `tools/test_fullscreen.js` | Headless Chromium checks for full screen (real full screen in headless Chromium) and edge scrolling: `node tools/test_fullscreen.js` |
| `tools/make_cursors.py`, `tools/test_cursor.js` | Cuts the checkerboard out of the two cursor paintings, crops, scales and writes the PNGs and `web/cursor.css`: `python3 tools/make_cursors.py`; and the headless checks for the cursor: `node tools/test_cursor.js` |
| `tools/test_chapters.js` | Headless Chromium checks for the ten campaign chapters, plus a scripted playthrough of the Tutorial: `node tools/test_chapters.js` |
| `tools/test_arrivals.js` | Headless Chromium checks for which creature kinds the Portal draws, by the rooms you have built, and the Monsters tab's *Who will come*: `node tools/test_arrivals.js` |
| `tools/test_capacity.js` | Headless Chromium checks for the army limit (beds, food, Portal), the Heart's larder and ten minutes without starvation: `node tools/test_capacity.js` |
| `tools/test_input.js` | Headless Chromium checks for the default mouse mode (Dig / grab), right-click cancelling a tool, carrying and dropping, selling doors and traps, and the hover ring: `node tools/test_input.js` |
| `tools/test_training.js` | Headless Chromium checks for levels 1-10: the Training Room, XP and the cap, stats and wages, gold per session, the `level` objective, the toolbar button and the roster XP bar: `node tools/test_training.js` |
| `tools/test_gates.js` | Headless Chromium checks for several Hero Gates (linking, split waves, fleeing, 3D): `node tools/test_gates.js` |
| `tools/test_sandbox.js` | Headless Chromium checks for the sandbox, the wave generator and endless mode: `node tools/test_sandbox.js` |
| `tools/test_campaign.js` | Headless Chromium checks for the chapter menu, saved progress, stars and the Victory / Defeat screens: `node tools/test_campaign.js` |
| `tools/test_objectives.js` | Headless Chromium checks for objectives, the tutorial guide, briefings and gate-less levels: `node tools/test_objectives.js` |
| `tools/process_art.py` | Cuts the flat background (and the painted ground shadow of characters) out of the original JPGs: `python3 tools/process_art.py <folder> [--set units --max 320]` re-generates `web/assets/sprites/` |
| `web/assets/ui/frame.jpg` | The carved-stone/parchment interface frame. The page is a fixed-size layout (about 1461 px wide) laid over this image and scaled to the window; HUD, toolbar, map, task/log scrolls, research panel and help sit at fixed mockup coordinates |
| `tools/make_ui_frame.py` | Rebuilds `frame.jpg` from `tools/source/ui-mockup.jpg` by repainting the panel interiors blank: `python3 tools/make_ui_frame.py` |
| `web/vendor/` | three.js 0.160.0 (MIT) and the UI fonts in `fonts/` (Cinzel, Cinzel Decorative, IM Fell English, EB Garamond; SIL Open Font License, licences alongside), kept in the repo so nothing loads from a CDN |

## Run the prototype (options)

```sh
python3 -m http.server -d web 8000     # then open http://localhost:8000/menu.html (the chapter menu); index.html?level=classic&seed=123 plays a level directly
# ?level=<id> opens a level from web/levels.js (default `classic`; `tiny` is a small test map).
# ?sound=0 turns all audio off (and hides the HUD controls). Sound starts at your first click or key press.
# ?view=2d forces the old flat canvas view. Opening index.html straight from disk (file://) also falls back to 2D,
# because browsers block ES modules there.
```

**3D controls:** `W A S D`/arrows pan along the screen axes, mouse wheel zooms, middle-drag pans. Clicking picks the wall top or floor under the cursor.
The camera is isometric (45°, narrow field of view) to match the sprite art; `?cam=top` gives the earlier steep top-down perspective.

**UI style:** the page is dressed as a dungeon keeper's war room instead of a generic web app: Cinzel Decorative for the title, Cinzel for the HUD, buttons and headings, IM Fell English for the log and help scroll, EB Garamond for the data panels. Stone-and-bronze plates with rivets, a gilded frame and torchlit vignette around the dungeon view, rune-diamond slider handles, parchment for the help, and the toolbar split into groups with their own accent (gold rooms, red traps, violet spells, speed). The look is all CSS in `web/index.html` (colours and fonts are variables at the top of its `<style>`), the canvas text and banners use the same fonts, and no image assets were added.

**Art status:** props and characters use your sprites (billboards with a soft ground shadow, mirrored to face the way they
walk, and a faint x-ray silhouette when a wall hides them); floors, walls and effects are drawn in code. The 2D fallback view
(`?view=2d`) does not use the sprites. The Hatchery is drawn as your chicken coop (one per 2x2 patch of tiles) and the Training Room as your punching-bag stand (one per tile, rocking while a creature hits it); both are in `web/assets/sprites/` (`hatchery.png`, `training.png`) and were cut from your JPGs with `tools/process_art.py`.

**Roster (from the character art):** your creatures come through the portal weighted by kind (and only the kinds whose rooms you have built, see *Who comes through the Portal* in `docs/06-levels.md`): Goblin, Troll, Warlock (the
best researcher), Dark Elf (fast archer), Bile Demon (slow tank), Vampire (strong caster), Salamander (fire fighter) and
Spider (fast biter), and six more with a trick each: **Mistress** (works the rack: torture runs 60 % faster and converts 88 % of
the time), **Assassin** (first blow on an unhurt target does double), **Black Knight** (takes 25 % less damage), **Fly** (hovers; fast
and fragile), **Reaper** (rare; its scythe also hits whoever stands next to the target) and **Dark Angel** (rare; flies and heals
wounded creatures). Skeletons rise from starved prisoners and imps dig. At **level 3** a creature's sprite changes to its elite
form (e.g. the runic Troll, the green-flame Goblin, the Rogue, the Fire Knight, the Firefly). Heroes: Knight, Archer, Mage, Thief (fast), Royal Guard (tank), Monk (heals
wounded allies), and five that each counter something: the **Dwarf** (disarms traps instead of setting them off, chews through
doors 2.5× faster), the **Giant** (slow, huge, immune to lightning stuns, smashes doors 3×), the **Stone Knight** (25 % armour and
immune to gas), the **Fairy** (flies over closed doors and floor traps and heals allies) and two bosses: the **Prince** and the **King** (in `classic` they lead wave 4 and the last wave; the campaign and the sandbox use them as boss waves); neither flees. All the character art is now in use. The `wall` sprite is processed but not used yet: walls are textured
blocks so they can be dug away tile by tile. To tune where a sprite sits on its tile, edit the `SPR` table at the top of
`web/render3d.js` (`w` = width in tiles, `ay` = how far up the image the ground contact point is); character heights are in the `USIZE` table.

Tag earth with **Dig** (left-drag; right-drag untags). Imps dig, mine gold, claim floor and haul gold to a
**Treasury**. Dig east to the purple portal and claim it; creatures arrive and need a **Lair**, get angry without
one, and get paid every payday. `window.__game` exposes the sim for testing.

The prototype implements: terrain-health state machine (`damageTile`/`healTile`), per-player task board with
per-tile tasks and assignee caps, A* with no corner-cutting, imp work/deliver loop, gold-proportional mining, gem
seams, room building, lair assignment, mood/anger, sleep and payday, free-imp spawning, plus **combat and heroes**:

* **Hero Gate** (a red-tinted cavern): dig a tunnel to it and invasion waves start (every level scripts its own; the `classic` level has 5 waves; parties
  follow a leader and hunt your Dungeon Heart, ranged heroes shoot): **1** Knight, Archer · **2** Knight, Mage, Thief · **3** Knight, Dwarf,
  Guard, Monk · **4** Prince, Giant, Fairy, Archer, Thief · **5** King, Stone Knight, Guard, Fairy, Mage, Archer; each wave is 12 % stronger).
* **Fight AI** modelled on `CreatureState.IDLE`'s "flee or attack first": sense (sight + line of sight; keepers also
  "hear" intruders on their own land) → flee when below 25 % hp → chase until in range → strike on recharge.
  Imps never fight, they run to the Heart. Heroes that get weak run back to the Gate and escape.
* Creatures heal on your land, sleep in lairs below 50 % hp, and **level up** from kills.
* **Pick up** (left-click a creature or imp in the default mode, or the **✋ Hand** tool): carry it and drop it into the fight; right-click cancels the tool or drops what you carry.
* **Doors and traps** (build on your claimed floor, right-click to sell for half): heroes can't walk through a closed
  **Door** (100g, 400 hp), they stop and smash it while your units pass freely and imps repair it. **Gas Traps** (150g,
  poison cloud) and **Lightning Traps** (200g, burst + stun) are hidden from heroes, fire when stepped on, hold a few
  charges, and imps re-arm them for gold. With the same 8 creatures and 3 lair tiles, one door plus three traps in the
  tunnel to the Hero Gate turned a lost game into a win in my bot test (9 heroes killed, Heart untouched), even though the Dwarf disarms traps and the Fairy flies over the door.
* **Mana and spells** (hotkeys `1`–`5`, click to cast; mana comes from your claimed floor, about 5.7/s at the start,
  1000 max, and every spell has a cooldown): **⚡ Lightning** (120 – 70 damage to the hero under the cursor, 35 chained to
  two nearby ones, with a stun), **✚ Heal** (80 – +60 hp to creatures and imps in range), **» Speed** (90 – creatures move
  and recharge 1.6× faster for 12 s), **⚑ Call to Arms** (150 – creatures drop everything and gather at a flag for 25 s),
  **✦ Create Imp** (100 – on claimed floor). A failed cast costs nothing. In my bot tests spells turned a lost game into a
  win with a solid defence of 9 lair tiles (15 heroes killed, Heart untouched), but could not save the weakest one (3 lair tiles).
* **Knock-out, Prison and Torture Chamber:** a unit that loses its last hit points to an enemy attacker is knocked out
  instead of killed (traps and spells, which have no attacker, still kill). Imps rush to carry your own fallen creatures
  to a lair (or the Heart) to recover, and knocked-out heroes to a **Prison** (100g/tile, one prisoner per tile). Anyone
  not picked up within 60 s bleeds out. Prisoners lose health; if one starves a **Skeleton** rises for you. Imps move
  prisoners to a **Torture Chamber** (150g/tile) where, after 30 s, 70 % convert into your creatures (`Ex-Knight` ...) and
  30 % die. Imps still run from live heroes, so capturing only works once you are winning the fight.
* **Levels and the Training Room:** creatures have levels 1 to 10. Build a **Training Room** (150g/tile, available from the start, one dummy per tile): idle, fed, rested creatures below level 10 walk to a free dummy, train for 20 s (15 XP) and pay 15 gold a session, but never leave you with under 100 gold, or under the whole payday's wages in the 30 s before payday. XP needed per level: 50, 65, 80, 100, 125, 155, 190, 230, 280 (a kill gives only 1 XP). Every level multiplies hp and damage by 1.11 (x2.5 at level 10) and adds 8 % to the creature's wage. One creature training without a break reaches level 5 in about 8 minutes and level 10 in about 35. The roster chip shows the level and an XP bar; elite sprites appear from level 3. Chapter 5 introduces it with a hint and a bonus objective (*Train a creature to level 3*). `tools/test_training.js` checks the rules.
* **Library and research:** Prison, Temple, Torture Chamber, Gas Trap, Lightning Trap and the spells Heal, Speed, Lightning and
  Call to Arms start **locked** (greyed out; build attempts and casts are refused for free). Treasury, Lair, Library, Hatchery,
  Doors and Create Imp are available from the start. Build a **Library** (120g/tile, one desk per tile): idle creatures
  with a talent for study sit at desks and add research points (Warlocks 1.6/s, Goblins 0.7, Trolls 0.4, converted Mages
  1.2). Pick what to study next by clicking an item in the **Research** panel, otherwise the next one is chosen
  automatically. With 3 desks and a mixed crew the first item arrived at about 240 s and 6 of 9 by about 750 s, so link
  the tunnel to the Hero Gate only when you are ready. `?unlock=1` unlocks everything for sandbox play.
* **Hatchery and hunger:** creatures get hungry about every two minutes (hunger 60 of 100) and grow angrier while they are
  (+8 anger/s; sleeping in a lair wipes it fast). A **Hatchery** (80g/tile, available from the start) lays a free-range **chicken**
  every 24 s per tile (up to 12); a hungry creature chases the nearest one, eats it in 2.5 s, heals 15 % and loses 300 anger.
  Skeletons never eat. Without a Hatchery your creatures stew and eventually leave, so build one before you rely on a crew. **Food caps the army** (`armyLimit()` in `game.js`): the Dungeon Heart's larder lays like a fifth of a tile (`FREE_FEED` 3 creatures, with at most 3 chickens about), and each Hatchery tile feeds `FEED_PER_HATCHERY_TILE` 4 more: a tile lays a chicken every 24 s and a creature eats about every 120 s, which is 5 per tile in theory, 4 with room for the walk. `tools/test_capacity.js` checks that nobody starves at the limit over ten minutes. The Tutorial and chapter 2 set `rules.food: false` (no food limit: the Hatchery is chapter 3's lesson).
* **Temple** (120g, research it first): idle creatures kneel at its altars (one per tile) for 15 s at a time, turning prayer into
  **mana** (Warlock 1.4/s, Vampire 1.2, Dark Elf 0.8, Goblin 0.5 ... each +10 % per level) and calming down. The Task board shows who
  is praying and the mana per second they add. A Temple room is drawn as **one building** (your gothic temple art) scaled to the
  room, so it looks best at 3×3 or bigger; creatures praying inside show only as faint outlines through its walls. The Hatchery
  reuses your straw-nest sprite and the chicken sprite.
* **Animation:** the 34 main units (imp, all creatures and their elite forms, skeleton, the heroes) have frame strips in
  `web/assets/anim/`: **idle** (4 frames), **walk** (6) and **attack** (5, played the instant a blow lands; imps dig with it).
  These are **procedural**, made by `tools/make_frames.py` from your single poses (breathing, a bobbing stride with swinging legs,
  a lunge), not hand-drawn. To use real frames, replace a strip with the same layout (see the script's header) and update
  `anim.json`; no code change is needed. Units without a strip (chickens) still hop and squash.
* **Sound and music** (`web/audio.js`, `docs/05-audio.md`): nothing plays until your first click; then a speaker button (or `M`) and a
  master, music and effects volume sliders in the HUD control it, and your choice is remembered. Effects are synthesised in code: sword, bow and spell hits, claws
  and clubs, lightning, gas, coins, digging and crumbling rock, doors, traps, prayer chimes, chicken clucks, imp chatter, knock-outs,
  level-ups, research and the UI. In the 3D view they get quieter and pan with distance from the camera (zoom out to hear more of the
  dungeon). The score is a dark-ambient drone with pads and sparse bells that gains a heartbeat and a driving bass as heroes close
  in and swells with brass, choir and timpani while a boss is alive, with horns for each wave and stingers for victory and defeat.
  Audio never touches the seeded RNG, so a run is identical with sound on or off. I could only test it by machine (every voice
  rendered offline and checked, plus a scripted run in headless Chromium); the *taste* (levels, how annoying the imps are) is for
  your ears, and the numbers to tune are `DEF` and the music constants at the top of `web/audio.js`. Drop recordings in
  `web/assets/audio/` and list them in `sounds.json` to replace any effect.
* You win a level by completing its objectives (every level includes surviving all its waves) and lose if the Dungeon Heart falls (2500 to 3000 hp, depending on the level).

Numbers marked `VAR` come from OpenKeeper's level variables; combat stats are tuning values.

## Licensing — read before you ship

* OpenKeeper is **GPL-3.0-or-later**. The docs here describe its behaviour and data layouts; the prototype is
  newly written, but if you start copying or translating OpenKeeper code, your project must be GPL-3 too.
* **Dungeon Keeper II's art, audio, models, text and level files belong to EA.** Never commit them. Either load a
  user's own copy at runtime or make your own assets. The sound system is fully synthesised for this reason, and `.gitignore`
  keeps `*.sdt` and everything in `web/assets/audio/` (except the manifest) out of commits.
