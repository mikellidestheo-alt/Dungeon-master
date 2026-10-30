# Sound and music (`web/audio.js`)

Everything you hear is synthesised in the browser with WebAudio. No audio file is needed and none is shipped, so the prototype
stays free of EA's Dungeon Keeper II audio. `docs/02-file-formats.md` lists the SDT/BankMap/SF formats for the later
bring-your-own-assets mode; this module does not read any of them.

> I did not read OpenKeeper's own sound code while writing this (the docs only cover its file formats), so the distance model
> and event mapping below are this project's own design, not a port of `game/sound`. Check that package before claiming parity.

## Shape

```
game.js    sfx('sword', x, y)          ->  Sound.play(id, tileX, tileY, {pitch, vol})
           Sound.setMood(audioMood())  ->  once per frame: {tension 0..1, boss 0|1, over}
           Sound.stinger('wave'|'boss')
render3d   Sound.setListener(camX, camY, 0.28 * camDist, rightX, rightY)
audio.js   voices (V)  ->  per-play gain + stereo pan  ->  sfx bus ----+
           Music (drone, pads, bells, heartbeat, bass, brass, timpani)  -> music bus --+--> master -> compressor -> out
                                               shared generated-noise reverb (send from both buses) -+
```

* **Start:** nothing is created until the first `pointerdown` or `keydown` (browsers refuse audio before a gesture). Until then
  `Sound.play` only counts the request. `?sound=0` removes the module and the HUD controls entirely.
* **HUD:** a speaker button (also the `M` key) and a volume slider (squared, so it feels linear). Both persist in `localStorage`
  (`dm.audio`). The context is suspended while the tab is hidden.
* **The sim never depends on it.** `game.js` calls a tiny `sfx()` wrapper that is a no-op without the module, uses fixed timers or
  `Math.random` (never the seeded `rand()`), and `Sound.play` catches its own errors, so audio can neither change a run nor stop the loop.
  `tools/test_audio.js` checks this by playing the same seeded run with sound off and on and comparing the final state.
* **Distance (3D view only):** gain = `1 / (1 + (d / ref)^2)` with `d` the distance in tiles from the camera's ground point and
  `ref = 0.28 x camera distance` (zooming out lets you hear further). Below 4 % an effect is dropped before any node is created.
  A voice may set a floor (`Heart` hits 0.4, door smashes 0.25, lightning 0.15) so important off-screen events stay audible.
  Pan follows the screen-right direction of the isometric camera. Sounds with no position (UI, payday, wave horns) play at full level.
  The 2D fallback view has no listener, so nothing is attenuated.
* **Rate limits:** each voice has a minimum gap (`DEF[id][0]`, in audio-clock seconds) and at most 48 short voices overlap, so a
  big fight at 8x speed stays cheap (measured: 60 fps in 2D with a 14-unit brawl at 8x, sound on or off).

## Effects

| Voice id | Played when |
|---|---|
| `click` | any HUD button |
| `tag` / `untag` | digging tiles tagged / untagged |
| `deny` | a refused cast or build (locked, no mana, on cooldown, no target) |
| `build` | rooms, doors or traps placed |
| `coins` / `coin` / `payday` | imp drops gold in a Treasury / a gem seam pays out / payday |
| `dig` / `mine` / `crumble` / `claim` | imp digging earth (every 0.55 s) / mining gold or gems / a tile collapses / a tile is claimed |
| `sword` / `bite` / `club` | melee blow (Spider and Salamander bite; Troll, Bile Demon and Giant club; everyone else a sword) |
| `bow` + `arrow_hit` | Archer and Dark Elf shots |
| `magic` + `magic_hit` | every other ranged attacker (Mage, Warlock, Vampire, Monk, Fairy, Fly ...) |
| `ko` / `death` / `imp_scream` | knocked out / killed / an imp flees or dies |
| `door_hit` / `door_break` | a door is struck / smashed |
| `heart_hit` | the Dungeon Heart is attacked |
| `gas` / `lightning` / `clank` | Gas Trap fires / Lightning Trap or spell / a Dwarf disarms a trap |
| `heal` / `haste` / `rally` / `imp_spawn` | the matching spell; a free imp appears |
| `chime` | a creature starts praying, then every 5-8 s while it prays |
| `cluck` / `squawk` / `munch` | a chicken (every 7-19 s) / is caught / is eaten |
| `imp` | imp chatter (every 8-18 s per imp) |
| `portal` | the portal is claimed, or a creature arrives |
| `levelup` / `research` / `convert` | creature level-up / research done / torture conversion |
| `pickup` / `drop` | the Hand |
| `gong` | the tunnel reaches the Hero Gate |
| `horn` / `boss_horn` | a hero wave / the boss wave (stingers, also `Sound.stinger`) |
| `victory` / `defeat` | game over (fired from `setMood`) |

## Music

A dark-ambient score in D minor with Phrygian colours, generated note by note by a scheduler that looks 1.6 s ahead.

| Layer | When | What |
|---|---|---|
| Drone | always | detuned saws and a sine on D1 through a slowly breathing low-pass; an A1 fifth fades in with tension |
| Pads | always, a new chord every 8 beats | 4-note chords, 3 s attack; calm chords (Dm, Bb, Gm7, Eb, Dsus) switch to tritone/minor-second chords above tension 0.55 |
| Bells | sparse while calm | struck-metal partials on a D-phrygian scale, drowned in reverb |
| Heartbeat | tension > 0.12 | a double thump per beat, louder as tension rises |
| Bass pulse | tension > 0.45 | 8th-note plucks on D, with Eb and Ab (tritone) added at higher tension |
| Strings sting | tension > 0.6, now and then | a minor-second cluster high up |
| Brass, choir, timpani | a boss is alive | stacked saw chords opening a filter, formant-filtered "ah" and a driving timpani pattern |

`audioMood()` in `game.js` turns the game into two numbers: no live invaders = 0 (0.25 for the 12 s before a wave, once the gate is
linked); with invaders, `0.4 + 0.2 x min(1, count/6) + 0.4 x closeness to the Heart`; a boss alive forces at least 0.8 and sets
`boss = 1`. The music eases towards that target (about 3 s to climb, about 25 s to drain) and the tempo moves from 52 bpm
to about 109 (about 133 with a boss) with it. Wave horns, the boss horn and the victory/defeat stingers sit on top.

Measured offline at full master level (RMS / peak): calm 0.06 / 0.25, tense (0.8) 0.09 / 0.61, boss 0.13 / 0.83.
At the default volume the master gain is 0.49, and a compressor sits at the end of the chain.

## Swapping in real recordings

Every effect is a function in `Sound.voices[id](kit, dest, t, {pitch})` that schedules oscillators and noise. Two ways to replace one:

1. **Code:** assign your own function, `Sound.voices.sword = (kit, dest, t, p) => { ... }`.
2. **Files:** list recordings in `web/assets/audio/sounds.json` (format in that folder's README). A loaded recording replaces the
   synthesised voice of the same id, still going through distance gain, pan, rate limit and voice cap. Loaded after the first click;
   missing files are skipped with a console warning. Files in that folder are git-ignored on purpose.

## Testing

`node tools/test_audio.js` (needs Playwright with Chromium; it starts and stops its own server) renders every voice and the music
offline and checks the samples (finite, audible, not clipping, silent before and after), then drives the page: no context before the
first click, HUD mute/volume/persistence, a scripted run that fires every voice from real game events, realtime output, the
determinism comparison, distance, and swapping a recording in. It cannot judge how anything *sounds*; that needs ears.
`SHOT=/path/hud.png node tools/test_audio.js` also saves a screenshot of the HUD.

## Not done / later

* **Your own tracks:** the music bus and the manifest format are the natural place; only effects can be replaced from a file today.
* **"Use my DK2 install":** reading the user's own SDT archives with OpenKeeper's `sound/SdtFile` (MP2 and WAV blobs), `BankMapFile` and
  `SFFile` formats from `docs/02-file-formats.md`, decoding in the browser, and registering the result through the same
  `samples` table. Nothing of that is written.
* Weights I would revisit by ear: effect volumes (`DEF`), the drone level, the tension curve in `audioMood()`, and whether imp chatter is charming or tiring.
* No per-category sliders (music vs effects), no sound for imps repairing/re-arming, torture screams, slapping or possession (those systems are not in the prototype yet).
