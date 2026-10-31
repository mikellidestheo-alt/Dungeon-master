# OpenKeeper — architecture teardown

Source analysed: <https://github.com/tonihele/OpenKeeper> at commit `ac75e6e` (889 Java files, ~149k lines,
JMonkeyEngine 3.9 + Java 25, GPL-3.0-or-later). OpenKeeper is a re-implementation of the **Dungeon Keeper II**
engine. It ships **no game data** — it reads the original DK2 install.

Everything below was read from the source unless marked *(not read)*.

## 1. The three layers

```
┌────────────────────────────────────────────────────────────────────────┐
│ tools/convert   binary readers: WAD, KWD(map+data), KMF models, textures,│
│                 audio banks, string tables. One-shot "AssetsConverter". │
├────────────────────────────────────────────────────────────────────────┤
│ game/           headless simulation ("server"): ECS + controllers +     │
│                 task manager + triggers. No rendering dependencies.     │
├────────────────────────────────────────────────────────────────────────┤
│ view/ gui/      JME scene graph, Nifty GUI, shaders, minimap, FX        │
└────────────────────────────────────────────────────────────────────────┘
```

Sizes (Java lines): convert 16k map parsers + ~8k others · game ≈ 45k · view ≈ 25k · gui/audio/video the rest.

The important design decision for a port: **the simulation (`game/`) is already split from rendering**, and talks to
the client through a service interface (`GameSessionServerService` / `GameSessionServiceListener`) so the same
code runs single-player (`LocalGameSession`) or networked (SpiderMonkey). In HTML you keep that split: the sim is
plain TypeScript/JS that you can run in a Web Worker; the renderer is a thin subscriber.

## 2. Simulation = Entity-Component-System (Zay-ES)

State lives in an `EntityData` store. Entities are ids; behaviour is data in **components**; **systems** iterate
`EntitySet`s that match a component signature.

Components (68, `game/component/`), grouped:

| Group | Components |
|---|---|
| Spatial | `Position`, `Mobile`, `Navigation`, `MapTile`, `FollowTarget`, `CreatureFall` |
| Ownership | `Owner`, `Placeable`, `InHand`, `Stored`, `Storage`, `HauledBy` |
| Creature | `CreatureComponent`, `CreatureAi`, `CreatureMood`, `CreatureSleep`, `CreatureHunger`, `CreatureExperience`, `CreatureEfficiency`, `CreatureImprisoned`, `CreatureTortured`, `CreatureRecuperating`, `CreatureSpells`, `Senses`, `Threat`, `Fearless`, `Party` |
| Combat | `Health`, `Damage`, `Attack`, `AttackTarget`, `CreatureMeleeAttack`, `Death`, `Unconscious`, `Decay`, `Regeneration` |
| Economy | `Gold`, `Mana`, `Food`, `DungeonHeart`, `Spellbook`, `PlayerObjective` |
| Rooms/props | `RoomComponent`, `RoomEffect`, `DoorComponent`, `TrapComponent`, `ObjectComponent`, `Portal`, `PortalGem`, generators (`CreatureGenerator`, `ImpGenerator`, `ChickenGenerator`) |
| Work | `TaskComponent` (a creature points at a task id), `Interaction`, `Trigger`, `Objective` |
| View mirrors | `*ViewState` (`CreatureViewState`, `DoorViewState`, `ObjectViewState`, `ShotViewState`, `TrapViewState`), `ViewType` |

The `*ViewState` components are the trick that decouples render from sim: systems write "what should this look
like" (e.g. animation/state enum) into the entity, the client reads it. Copy this idea.

### Systems and loops (`GameLoopManager`)

Three fixed-rate loops, each a `GameLogicManager` = ordered array of `IGameLogicUpdatable.processTick(tpf)`:

| Loop | Rate | Systems (in order) |
|---|---|---|
| **Logic** | `GameLevel.ticksPerSec` (data-driven per level) | Decay, WoodenBridgeDecay, CreatureExperience, CreatureSleep, CreatureMood, Slap, **Health**, CreatureTorturing, Death, PlayerCreature, PlayerSpellbook, **GameController** (win/lose/timers/triggers), CreatureSpawn, ChickenSpawn, ManaCalculator, Possessed, **CreatureAi**, ChickenAi, CreatureView, DoorView, LooseObject, Hauling, **TaskManager** |
| **Animation** | 60 Hz | DungeonHeartConstruction, CreatureFall |
| **Steering** | 60 Hz | **Movement** (gdx-ai steering along a path), PossessedMovement |

Take-away for the port: one fixed-step sim at `ticksPerSec` for decisions, and a separate 60 Hz integrator for
movement. In JS: `requestAnimationFrame` + accumulator.

## 3. Controllers (the "rules" layer, `game/controller/`)

Controllers wrap an entity id + shared services and expose gameplay verbs. This is where most mechanics live.

* `GameController` — level lifecycle, timers (`LEVEL_TIMER_MAX_COUNT`), flags, objectives, win/lose, loads triggers.
* `GameWorldController` — build/sell rooms, place doors/traps, drop things, cast spells; fires `PlayerActionListener`.
* `MapController` — the tile grid (`IMapData` of `IMapTileController`), selection/tagging, ownership, claim, **`damageTile`/`healTile`**, fog of war, room instances, terrain batches (flood fill).
* `CreaturesController` / `CreatureController` (1.6k lines) — creature factory and the per-creature action API used by the state machine (`findWork`, `goToSleep`, `goToEat`, `shouldFleeOrAttack`, `navigateToRandomPoint` …).
* `RoomControllerFactory` + `room/*` — one controller class per construction shape / behaviour (Treasury, Lair, Hatchery, Library, Prison, Torture, Temple, Training, Workshop, Casino, CombatPit, DoubleQuad, ThreeByThree, FiveByFiveRotated, HeroGate…). Storage rooms use `room/storage/*` (`RoomGoldControl`, `RoomLairControl`, `RoomFoodControl`, …).
* `PlayerController` + 11 siblings (`player/`) — per-player gold, mana, spellbook, research, rooms/doors/traps availability, creature counts.
* `Doors/Traps/Objects/Shots/Chicken Controller` — thing-specific logic.

## 4. Creature AI = two layers

1. **Per-creature FSM** (`CreatureState`: `IDLE`, `WANDER`, `DEAD`, and more further down the file via
   gdx-ai `DefaultStateMachine`). `IDLE.findStuffToDo` is a strict priority list — worth copying verbatim:

   1. flee or attack if enemies are sensed (`shouldFleeOrAttack`)
   2. party follower → follow leader
   3. has a scripted **objective** → do it
   4. needs a lair and has none → find one
   5. has a lair and is tired → go to sleep
   6. hungry → go eat
   7. ask the **TaskManager** for work (`findWork`); workers with too much gold drop it at a treasury
   8. nothing → wander to a random point; re-evaluate on a timer
2. **Global job board** (`game/task/TaskManager`). Tasks are **pulled** by creatures, not pushed.
   * `taskQueues: Map<playerId, Set<Task>>` — one queue per keeper (not for the good/neutral players).
   * Tasks are generated *reactively*: `scanInitialTasks()` over the whole map at load, then on every
     `onTilesChange` it re-scans the changed tile **and its neighbours** (`scanTerrainTasks(tile, checkNeighbours, deleteObsolete)`), deleting obsolete tile tasks. Also from entity sets: unconscious creature → `RescueCreatureTask` (own) / `CaptureEnemyCreatureTask` (enemy); loose placeable object on own land → `FetchObjectTask`; room built/sold → rescan bridge neighbours.
   * Task contract (`Task`, `AbstractTask`): `getPriority`, `getMaxAllowedNumberOfAsignees`, `getTarget(creature)`,
     `isReachable`, `isValid`, `isFaceTarget`, `executeTask(creature, executionDuration)`, `assign/unassign`.
   * Worker tasks (`task/worker`): `DigTileTask` (priority 10, max 3 assignees), `ClaimTileTask`, `ClaimWallTileTask`,
     `ClaimRoomTask`, `RepairWallTileTask`, `FetchObjectTask`, `CarryGoldToTreasuryTask`, `CarryObjectToStorageTask`,
     `CarryCreatureToLairTask`, `CarryEnemyCreatureToPrison`, `RescueCreatureTask`, `CaptureEnemyCreatureTask`.
   * Creature-need tasks (`task/creature`): `GoToSleep`, `GoToEat`, `ClaimLair`, `Train`, `Research`.
   * Objective tasks (`task/objective`) drive campaign scripts: `GoToTask`, `KillPlayer`, `SendToActionPoint`, `ObjectiveDigTileTask`.
   * `TaskWorkerPriorityComparator` ranks (task, worker) pairs; `unemployedCreatures` get a callback when a task appears.

## 5. Movement & pathfinding

* **A\*** from libGDX gdx-ai over a tile graph (`MapIndexedGraph`): 4-neighbour, plus diagonals only if the creature
  `canMoveDiagonally()` **and** both orthogonal neighbours are passable (no corner cutting). Edge cost comes from the creature
  (`INavigable.getCost(from, to, …)` → `null` = impassable) so flyers / lava-walkers / water-walkers share one graph.
  Heuristic: `MapDistance.estimate`.
* **Steering** (gdx-ai) follows the path (`EntitySteeringFactory.navigateToPoint(path, faceTarget, …)`), max speed from the
  creature's `Mobile.maxSpeed`; separation radius 0.25 tiles.
* World units: 1 tile = 1.0, floor height 1.0, ceiling 2.0, water level `floor - 0.07`.

## 6. Triggers (campaign scripting)

`game/trigger/*` interprets the `Triggers.kld` tree: `TRIGGER_GENERIC` (condition) + `TRIGGER_ACTION`, chained as
sibling/child. Conditions are a big enum (player gold/mana/rooms/creatures counts, creature killed/slapped/…,
action-point enter/claim/tag, flags, timers, pay-day…). Actions (~50): `CREATE_CREATURE`, `CREATE_HERO_PARTY`,
`SEND_TO_AP`, `DISPLAY_OBJECTIVE`, `MAKE` (grant/remove room/door/trap/spell), `FLAG`, `INITIALIZE_TIMER`, `WIN_GAME`,
`LOSE_GAME`, `ALTER_TERRAIN_TYPE`, `SET_ALLIANCE`, `PLAY_SPEECH`, `FOLLOW_CAMERA_PATH`, `COLLAPSE_HERO_GATE`,
`SET_TIME_LIMIT`, `SET_SLAPS_LIMIT` … Controls specialise per thing kind (actionpoint, creature, door, object, party, player).

## 7. Rendering approach (what to re-think for HTML)

* Map is a grid of **terrain slabs**; each terrain record references up to 4 art resources: complete / side / top /
  tagged-top. Walls are built per-tile from side pieces chosen by neighbour mask (`view/map/WallSection`, `PillarPlacement`,
  `Ceiling`, `TorchPlacement`). Water/lava are separate planes.
* Rooms are drawn by shape-specific constructors (`view/map/construction/*`): 1×1, quad (2×2), double-quad, 3×3, 5×5-rotated,
  hero gate, plus special ones (Prison, Temple, Workshop, CombatPit, StoneBridge).
* Lighting is a custom per-vertex "DkLighting" shader set (`assets/Shaders/DkLighting`) fed by terrain `terrainLight`/`ambientLight`.
* Fog of war has its own CPU texture (`view/fogofwar`), minimap is rasterised from tile data (`view/minimap`).
* UI = Nifty GUI XML (`assets/Interface/*.xml`) — for the web, rebuild with DOM/CSS.

## 8. What is *not* worth porting 1:1

JME scene-graph code, Nifty GUI, SpiderMonkey networking, the Java audio plugins (mp3/ogg/sfx decoders → use WebAudio),
TGQ video decoder (cutscenes → pre-transcode to WebM or skip), and the custom `Dk2TextureDecoder` (a DXT-like
block codec — convert offline, don't ship it to the browser).
