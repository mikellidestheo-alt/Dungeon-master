# DK2 data formats as implemented by OpenKeeper

These are the formats the original game ships. If you want to **load a user's own legal copy of DK2** in the browser
you need these parsers; if you want a **standalone game with your own assets** you only need the *shapes* of the data
(terrain / room / creature tables) to design your own JSON. Don't redistribute EA's data files.

Source: `src/main/java/toniarts/openkeeper/tools/convert/**`.

## 1. WAD archive (`*.WAD`) — `wad/WadFile.java`

```
0x00  char[4]  "DWFB"
0x04  u32      version == 2
0x48  u32      fileCount
      u32      nameTableOffset
      u32      nameTableSize
      u32      (unknown)
then  fileCount × 40-byte entries:
      u32 unk1, nameOffset, nameSize, dataOffset, compressedSize
      u32 type (enum), u32 size(uncompressed), u32 unk2[3]
at nameTableOffset: concatenated names
```
Name quirk: a name containing a path separator sets the "current directory"; following names without one inherit that
directory. Names are not unique on their own. Entry `type`: `0 = NOT_COMPRESSED`, `4 = COMPRESSED`. Compressed payloads use an **EA RefPack/QFS-style LZ77**
(`WadFile.decompressFileData`): optional 3 extra header bytes if `byte0 & 1`, 1 skipped byte, then a 3-byte big-endian
uncompressed size, then a stream of commands selected by the flag byte — `0x00–0x7F` = 2-byte copy command
(0–3 literals, then back-reference with 10-bit distance, length 3–10), `0x80–0xBF` = 3-byte command (0–3 literals, 14-bit distance, length 4–67),
`0xC0–0xDF` = 4-byte command (17-bit distance, long length), `0xE0–0xFB` = literal run, `0xFC–0xFF` = final literals + end.
Little-endian throughout. In a browser this is ~40 lines of JS (see `tools/` plan in 04).

## 2. KWD/KLD data files — `map/KwdFile.java` (3,422 lines)

A level is a **list of files** that are all read in order; every file is a sequence of **blocks**:

```
u32   blockId        (MapDataTypeEnum, below)
u32   sizeFieldWidth (2 or 4)
u16|u32 dataSize
u32   checkOne
u32   headerEndOffset
...   header payload (per-type: MAP → u32 width,height; TRIGGERS → u32 a+b = itemCount; LEVEL → u16 count,u16 h; default → u32 itemCount, u32 unknown, timestamp created, timestamp modified)
u32   checkTwo, u32 dataSize
...   `dataSize` bytes of records
```

`MapDataTypeEnum`: `0 GLOBALS · 100 MAP · 110 TERRAIN · 120 ROOMS · 130 TRAPS · 140 DOORS · 150 KEEPER_SPELLS · 160 CREATURE_SPELLS · 170 CREATURES · 180 PLAYERS · 190 THINGS · 210 TRIGGERS · 220 LEVEL · 230 VARIABLES · 240 OBJECTS · 250 EFFECT_ELEMENTS · 260 SHOTS · 270 EFFECTS`

Load order (`KwdFile.load`): read the `LEVEL` file (`GameLevel`) → it contains a list of `FilePath {u32 id, u32 unk, char[64] path}`;
**`MAP` first**, then every other path; `GLOBALS` entries are overrides of the base catalogues
(`Terrain.kwd`, `Rooms.kwd`, `Creatures.kwd` … in `Data/editor/`). Later files may override earlier tables (terrain logs "Overrides terrain!").

### MAP block (the tile grid)
`width × height` records, **4 bytes each, row-major**:

| byte | meaning |
|---|---|
| 0 | `terrainId` → key into the TERRAIN table |
| 1 | `playerId` (owner). Constants in `Player.java`: `1 = GOOD (heroes)`, `2 = NEUTRAL`, `3..6 = KEEPER1..4`, `7 = KEEPER5`; `0` = nobody |
| 2 | `flag`: 1 = bridge over water, 2 = bridge over lava |
| 3 | unknown |

### TERRAIN record (one per slab type)
```
char[32] name
ArtResource ×4 (84 bytes each): complete, side, top, taggedTop
Light slabLight
f32 depth, f32 lightHeight           (fixed-point ints read as float)
u32 flags  (see below)
u16 damage, editorTextureId, unk, goldValue, manaGain, maxManaGain,
    tooltipStrId, nameStrId, maxHealthEffectId, destroyedEffectId, generalDescStrId, strengthStrId, weaknessStrId
u16[16] unk
u8 wibbleH, u8[3] leanH, u8 wibbleV, u8[3] leanV
u8 terrainId
u16 startingHealth
u8 maxHealthTypeTerrainId     -- what it becomes at full health (rock→wall, path→claimed…)
u8 destroyedTypeTerrainId     -- what it becomes when health hits 0 (wall→path…)
Color terrainLight; u8 textureFrames
char[32] soundCategory; u16 maxHealth; Color ambientLight; char[32] soundCategoryFirstPerson; u32 unk
```
`TerrainFlag` bitmask: `SOLID 1 · IMPENETRABLE 2 · OWNABLE 4 · TAGGABLE 8 · ROOM 0x10 · ATTACKABLE 0x20 · TORCH 0x40 · WATER 0x80 · LAVA 0x100 · ALWAYS_EXPLORED 0x200 · PLAYER_COLOURED_PATH 0x400 · PLAYER_COLOURED_WALL 0x800 · CONSTRUCTION_TYPE_WATER 0x1000 · CONSTRUCTION_TYPE_QUAD 0x2000 · UNEXPLORE_IF_DUG_BY_ANOTHER_PLAYER 0x4000 · FILL_INABLE 0x8000 · ALLOW_ROOM_WALLS 0x10000 · DECAY 0x20000 · RANDOM_TEXTURE 0x40000 · …colour bits… · DWARF_CAN_DIG_THROUGH 0x800000 · REVEAL_THROUGH_FOG_OF_WAR 0x1000000 · TERRAIN_LIGHT 0x10000000 · AMBIENT_LIGHT 0x20000000`

**This is the key insight**: the whole "dig / claim / reinforce / destroy" loop is just a **health-driven state machine on
terrain ids** — `health ≤ 0 → destroyedTypeTerrainId`, `health ≥ max → maxHealthTypeTerrainId` (only for non-OWNABLE terrain;
see `TileWork.convertsAtFullHealth`). You can reproduce the entire terrain behaviour with a 6-column table.

### ArtResource (84 bytes)
`char[64] name · u32 flags · 12 bytes data · u8 type · (type-dependent: for ANIMATING_MESH two u8 start/end frame, else u16) · u8 …`
Types: `NONE, SPRITE, ALPHA, ADDITIVE_ALPHA, TERRAIN_MESH, MESH, ANIMATING_MESH, PROCEDURAL_MESH, MESH_COLLECTION(GROP), UNKNOWN`.
Names resolve to files inside the WAD archives (`Meshes.WAD`, `Textures*.WAD` …).

### ROOM record (flags)
`RoomFlag`: `PLACEABLE_ON_WATER 1 · PLACEABLE_ON_LAVA 2 · PLACEABLE_ON_LAND 4 · HAS_WALLS 8 · CENTRE 0x10 · SPECIAL_TILES 0x20 · NORMAL_TILES 0x40 · BUILDABLE 0x80 · SPECIAL_WALLS 0x100 · torch colour bits · HAS_FLAME 0x1000 · IS_GOOD 0x2000`.
`TileConstruction` shape ids: `COMPLETE 1, QUAD 2, NORMAL 5, CENTER_POOL 6, DOUBLE_QUAD 7, HERO_GATE 9, HERO_GATE_TILE 10, HERO_GATE_FRONT_END 12`.
Known ids in code: **Lair = 2**, **Wooden bridge = 8**.

### CREATURE attributes (what the sim consumes) — `Creature.Attributes`
`expForNextLevel, expPerSecond, expPerSecondTraining, researchPerSecond, manufacturePerSecond, height, eyeHeight, hp, hpFromChicken,
fear, threat, manaGenPrayer, pay, maxGoldHeld, speed, runSpeed, shuffleSpeed, distanceCanSee, distanceCanHear, slapDamage, hungerRate,
hungerFill, timeAwake, timeSleep, unhappyThreshold, decomposeValue, angerNoLair, angerNoFood, angerNoPay, angerNoWork, angerSlap,
angerInHand, initialGoldHeld, tortureTimeToConvert, stunDuration, guardDuration, idleDuration, slapFearlessDuration, possessionManaCost,
ownLandHealthIncrease, tortureHpChange, tortureMoodChange, perceptionRange` — plus 3 flag words (`CreatureFlag`: `IS_WORKER, CAN_BE_PICKED_UP,
CAN_BE_SLAPPED, ALWAYS_FLEE, CAN_WALK_ON_WATER/LAVA, CAN_FLY, IS_EVIL, IS_GOOD, IS_FEARLESS, GENERATE_DEAD_BODY, CAN_BE_RESURECTED, FREES_FRIENDS_ON_JAILBREAK …`),
`JobType` (what jobs it takes: `SLEEP, EAT, RESEARCH, TRAIN, MANUFACTURE, GUARD, TORTURE, PRAY, DRINK, LEAVE, DESTROY_ENEMY_ROOMS, STEAL_GOLD, KILL_PLAYER, TUNNELLING, EXPLORE, JAIL_BREAK …`),
`FightStyle` (`NON_FIGHTER, BLITZER, BLOCKER, FLANKER, SUPPORT`), `JobClass` (`ARTISAN, THINKER, FIGHTER, SCOUT`), attack types, swipes, special abilities.

### VARIABLES — the global balance sheet
`Variable.MiscVariable.MiscType` is a table of ~100 tunables stored in the level data, i.e. **the game's economy is data, not code**.
Values observed in OpenKeeper comments (campaign defaults):

| Variable | Value | Meaning |
|---|---|---|
| `DIG_ROCK_HEALTH` | -5000 | health change per work swing on plain rock |
| `DIG_OWN_WALL_HEALTH` | -130 | digging your own reinforced wall |
| `DIG_ENEMY_WALL_HEALTH` | -8 | digging someone else's wall |
| `MINE_GOLD_HEALTH` | -300 | mining a gold seam |
| `CLAIM_TILE_HEALTH` | 825 | claiming floor |
| `ATTACK_TILE_HEALTH` | -140 | un-claiming enemy floor |
| `REINFORCE_WALL_HEALTH` | 50 | reinforcing |
| `REPAIR_WALL_HEALTH` / `REPAIR_ROOM_HEALTH` | 22 / 20000 | |
| `CONVERT_ROOM_HEALTH` / `ATTACK_ROOM_HEALTH` | -4000 / -1500 | |
| `MAX_GOLD_PER_TREASURY_TILE` | 3000 | |
| `MAX_GOLD_PILE_OUTSIDE_TREASURY` | 2000 | |
| `GOLD_MINED_FROM_GEMS` | 25 | (the prototype pays 50 and takes `MINE_GEM_HEALTH` 450 instead of 300 per second of work: about 8 s a payout) |
| `PAY_DAY_FREQUENCY_SECONDS` / `TIME_BEFORE_FIRST_PAY_DAY_SECONDS` | 600 / 600 | |
| `MODIFY_HEALTH_OF_CREATURE_IN_LAIR_PER_SECOND` | +100 | |
| `MODIFY_ANGER_OF_CREATURE_IN_LAIR_PER_SECOND` | -550 | |
| `CREATURE_SLEEPS_WHEN_BELOW_PERCENT_HEALTH` | 50 | |
| `DEAD_BODY_DIES_AFTER_SECONDS` | 60 | |
| `MINIMUM_IMP_THRESHOLD` / `TIME_BEFORE_FREE_IMP_GENERATED_SECONDS` | 4 / 5 | free imp spawn |
| `WOOD_BRIDGE_LIFE_ON_LAVA_SECONDS` | 30 | |
| `MAX_FREE_RANGE_CHICKENS_PER_PLAYER` | 12 | |
| `PRISON_MODIFY_CREATURE_HEALTH_PER_SECOND` | -3 | |
| `CASINO_MODIFY_CREATURE_GOLD_PER_SECOND` | -50 | |

**Work-rate formula** (`TileWork.perApplication`): `delta = round(|rate| × efficiency% / 100)`; a fresh imp is 80 % efficient;
OpenKeeper applies one full "rate" per second per worker.
**Mining** (`TileWork.mine`): `goldReleased = total × (maxHealth − health) / maxHealth`; gold dropped per swing is the delta of
that, so a seam of N gold releases exactly N. Impenetrable (gem) seams never run out: they collapse, reset to full, pay `GOLD_MINED_FROM_GEMS`.

### THINGS block — what is on the map at start
Record kinds: `OBJECT, TRAP, DOOR, ACTION_POINT, NEUTRAL_CREATURE, GOOD_CREATURE, KEEPER_CREATURE, HERO_PARTY, DEAD_BODY,
EFFECT_GENERATOR, ROOM, CAMERA`.

## 3. Other formats (pointers only — *code read, not re-derived here*)

| Format | Reader | Notes |
|---|---|---|
| KMF models (`"KMSH"`) | `kmf/KmfFile.java` | chunked (`SPHD/SPRS` sprites, `POLY/VERT/ITAB/VGEO` animated geometry), materials, `Grop` mesh collections |
| Textures | `textures/Dk2TextureDecoder.java` | custom block codec (4×4 blocks, per-block alpha flag, coefficient tables `magic_output_table`, `decompress_func1/2` — the author's own comments say "decompression stuff I don't understand"); port the Java verbatim to a converter, don't re-derive it |
| `*.bf4` | `bf4/` | bitmap fonts (format by George Gensure) |
| `*.spr` | `spr/` | sprite container (by ArchDemon) |
| `*.str`, `mbtouni` | `str/` | localised string tables (ids referenced by `*StringId` fields); format from Tomasz Lis's C code |
| `*.sdt` | `sound/SdtFile` | sound archive of **MP2 and WAV** blobs, little-endian |
| `*Bank.map` | `sound/BankMapFile` | sound-playback event tables (spec by Tomasz Lis) |
| `*.sf` | `sound/SFFile` | EA sound chunks; see <http://wiki.multimedia.cx/index.php?title=Electronic_Arts_Formats> |
| `.kcs` | `kcs/` | camera/spatial path files (`Paths.wad`), little-endian, 30 fps — 150 entries = 5 s |
| `.tgq` | `video/tgq` | cutscene video |
| `hiscores` | `hiscores/` | |
