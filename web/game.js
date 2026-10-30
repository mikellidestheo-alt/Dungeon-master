'use strict';
/* =====================================================================================
 * Prototype of OpenKeeper's simulation core.  Mapping to the Java source:
 *   TERRAIN table        <-> tools/convert/map/Terrain.java (flags, maxHealth, destroyedTypeTerrainId)
 *   damageTile/healTile  <-> game/controller/MapController.java + TileWork.java
 *   TaskBoard            <-> game/task/TaskManager.java (+ DigTileTask, ClaimTileTask, ...)
 *   Imp.update           <-> CreatureState.IDLE.findStuffToDo priority list
 *   Creature.update     <-> logic/CreatureMoodSystem, CreatureSleepSystem, payday
 * Numbers marked VAR are the stock DK2 values logged in Variable.MiscType; the rest is tuning.
 * ===================================================================================== */

const W = 40, H = 28, TS = 20;                       // map size in tiles, pixels per tile
const VAR = {                                         // Variable.MiscVariable.MiscType
  DIG_ROCK_HEALTH: 5000, MINE_GOLD_HEALTH: 300, CLAIM_TILE_HEALTH: 825,
  GOLD_MINED_FROM_GEMS: 25, MAX_GOLD_PER_TREASURY_TILE: 3000,
  MODIFY_ANGER_OF_CREATURE_IN_LAIR_PER_SECOND: -550,
  MINIMUM_IMP_THRESHOLD: 4, TIME_BEFORE_FREE_IMP_GENERATED_SECONDS: 5,
  CREATURES_SUPPORTED_BY_FIRST_PORTAL: 15,
  PAY_DAY_FREQUENCY_SECONDS: 90,                      // stock is 600; shortened so you see it
  IMP_EFFICIENCY: 80,                                 // TileWork.FULL_EFFICIENCY comment: "80% for a fresh imp"
  IMP_MAX_GOLD: 400,
  CREATURE_SLEEPS_WHEN_BELOW_PERCENT_HEALTH: 50,      // stock value, drives "go heal in your lair"
  OWN_LAND_HEALTH_INCREASE_PER_SECOND: 0.8,           // Creature.Attributes.ownLandHealthIncrease, scaled to our hp
  HEART_HEALTH: 2500,
  WAVES: 5, FIRST_WAVE_DELAY: 75, WAVE_INTERVAL: 110, // hero gate invasions (tuning)
  HEAR_DISTANCE: 14,                                  // Attributes.distanceCanHear: keepers sense heroes on own land
  XP_PER_KILL: 1, XP_PER_LEVEL: 3, MAX_LEVEL: 5,      // CreatureExperienceSystem, reduced
};

/* ---- terrain table (Terrain.kwd analogue). flags: S solid, I impenetrable, O ownable, T taggable ---- */
const T = { ROCK: 0, EARTH: 1, GOLD: 2, GEM: 3, PATH: 4, TREASURY: 5, LAIR: 6, HEART: 7, PORTAL: 8, GATE: 9 };
const HERO_LAND = 2;                                  // tile.owner for the good player (Player.GOOD_PLAYER_ID analogue)
const TERRAIN = [
  { name: 'Rock',     solid: 1, imp: 1, own: 0, tag: 0, maxHealth: 1 },
  { name: 'Earth',    solid: 1, imp: 0, own: 0, tag: 1, maxHealth: 12000, destroyedTo: T.PATH },
  { name: 'Gold seam',solid: 1, imp: 0, own: 0, tag: 1, maxHealth: 4000,  destroyedTo: T.PATH, goldValue: 2000 },
  { name: 'Gem seam', solid: 1, imp: 1, own: 0, tag: 1, maxHealth: 3000,  destroyedTo: T.GEM,  goldValue: 1 },
  { name: 'Path',     solid: 0, own: 1, maxHealth: 1000 },
  { name: 'Treasury', solid: 0, own: 1, room: 1, maxHealth: 1000, cost: 50 },
  { name: 'Lair',     solid: 0, own: 1, room: 1, maxHealth: 1000, cost: 80 },
  { name: 'Dungeon Heart', solid: 0, own: 1, room: 1, maxHealth: 1000 },
  { name: 'Portal',   solid: 0, own: 1, room: 1, maxHealth: 1000 },
  { name: 'Hero Gate',solid: 0, own: 0, room: 1, maxHealth: 1000 },
];

/* ---- tiny seeded RNG so levels are reproducible (?seed=123) ---- */
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const qs = new URLSearchParams(location.search);
const rand = rng(parseInt(qs.get('seed') || '7', 10));

/* ===================================================================================== world */
const G = {
  map: [], time: 0, speed: 1, gold: 1000, imps: [], creatures: [], tasks: new Map(),
  nextImp: 0, nextSpawn: 20, nextPay: VAR.PAY_DAY_FREQUENCY_SECONDS, scanT: 0, log: [],
  portalOwned: false, heart: { x: 6, y: H >> 1 }, portal: { x: W - 8, y: H >> 1 }, gate: { x: 22, y: H - 5 },
  heroes: [], shots: [], fx: [], doors: [], traps: [], clouds: [], heartHp: VAR.HEART_HEALTH, heartFlash: 0, gateOpen: false, gateT: 0,
  wave: 0, nextWave: Infinity, over: null, kills: 0, held: null, nextId: 0,
};
const idx = (x, y) => y * W + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const tile = (x, y) => inb(x, y) ? G.map[idx(x, y)] : null;
const solid = (x, y) => { const t = tile(x, y); return !t || TERRAIN[t.t].solid; };
function setTerrain(t, id) { t.t = id; t.hp = TERRAIN[id].maxHealth; t.tag = 0; if (TERRAIN[id].solid !== 1) { t.owner = t.owner; } }
function say(msg) { G.log.unshift(msg); if (G.log.length > 40) G.log.pop(); renderLog(true); }

function genMap() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    G.map[idx(x, y)] = { t: border ? T.ROCK : T.EARTH, owner: 0, hp: border ? 1 : 12000, gold: 0, tag: 0, stored: 0, room: 0 };
  }
  const blob = (cx, cy, r, id) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (inb(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1 && Math.hypot(x - cx, y - cy) <= r + rand() * 0.9 && G.map[idx(x, y)].t === T.EARTH) {
        const t = G.map[idx(x, y)]; t.t = id; t.hp = TERRAIN[id].maxHealth; t.gold = TERRAIN[id].goldValue || 0; } } };
  for (let i = 0; i < 6; i++) blob(4 + (rand() * (W - 8) | 0), 2 + (rand() * (H - 4) | 0), 1 + (rand() * 2 | 0), T.ROCK);
  for (let i = 0; i < 7; i++) blob(12 + (rand() * (W - 24) | 0), 2 + (rand() * (H - 4) | 0), 1, T.GOLD);
  blob(W - 14, 4, 1, T.GEM);
  const carve = (x0, y0, x1, y1, owner) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = G.map[idx(x, y)]; t.t = T.PATH; t.hp = owner ? 1000 : 0; t.owner = owner; t.gold = 0; } };
  const room = (cx, cy, id, owner) => { for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    const t = G.map[idx(x, y)]; t.t = id; t.hp = 1000; t.owner = owner; t.room = cx * 100 + cy; } };
  const h = G.heart, p = G.portal;
  carve(h.x - 4, h.y - 3, h.x + 4, h.y + 3, 1); room(h.x, h.y, T.HEART, 1);
  carve(p.x - 3, p.y - 3, p.x + 3, p.y + 3, 0);          // portal cavern starts unclaimed
  room(p.x, p.y, T.PORTAL, 0);
  const gt = G.gate;                                      // hero land: not claimable, heroes arrive once a tunnel links it to you
  carve(gt.x - 3, gt.y - 3, gt.x + 3, gt.y + 2, HERO_LAND); room(gt.x, gt.y, T.GATE, HERO_LAND);
  // a few first tiles are already pre-tagged for the lazy
  for (let x = h.x + 5; x < h.x + 9; x++) { const t = G.map[idx(x, h.y)]; if (TERRAIN[t.t].tag) t.tag = 1; }
}

/* ===================================================================================== path-finding
 * A* over the tile grid like game/navigation/pathfinding/MapIndexedGraph: 4-neighbours always,
 * diagonals only when both orthogonal neighbours are open (no corner cutting). */
function findPath(sx, sy, gx, gy) {
  if (sx === gx && sy === gy) return [];
  if (solid(gx, gy)) return null;
  const open = [], g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H);
  const h = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy); };
  const push = (n) => { open.push(n); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p].f <= open[i].f) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
  const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i;
      if (l < open.length && open[l].f < open[m].f) m = l; if (r < open.length && open[r].f < open[m].f) m = r; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
  g[idx(sx, sy)] = 0; push({ x: sx, y: sy, f: h(sx, sy) });
  while (open.length) {
    const c = pop(), ci = idx(c.x, c.y); if (done[ci]) continue; done[ci] = 1;
    if (c.x === gx && c.y === gy) { const path = []; for (let i = ci; i !== idx(sx, sy); i = from[i]) path.push({ x: i % W, y: (i / W) | 0 }); return path.reverse(); }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nx = c.x + dx, ny = c.y + dy;
      if (solid(nx, ny)) continue; if (dx && dy && (solid(c.x + dx, c.y) || solid(c.x, c.y + dy))) continue;
      const ni = idx(nx, ny), ng = g[ci] + (dx && dy ? 1.4142 : 1); if (ng < g[ni]) { g[ni] = ng; from[ni] = ci; push({ x: nx, y: ny, f: ng + h(nx, ny) }); }
    }
  }
  return null;
}
const pathLen = (p) => p ? p.length : Infinity;

/* ===================================================================================== tile work
 * MapController.damageTile / healTile and TileWork. Rates are per game second here. */
const perApplication = (rate, eff) => Math.round(Math.abs(rate) * eff / 100);
function goldReleased(total, maxHealth, health) { return maxHealth <= 0 ? total : Math.floor(total * (maxHealth - health) / maxHealth); }
function damageTile(x, y, dt, eff) {            // returns gold released
  const t = tile(x, y), tr = TERRAIN[t.t];
  const rate = t.gold > 0 ? VAR.MINE_GOLD_HEALTH : VAR.DIG_ROCK_HEALTH;
  const dmg = perApplication(rate, eff) * dt;
  let released = 0, destroyed = false;
  if (t.gold > 0 && !tr.imp) {                   // TileWork.mine: gold comes out in proportion to health lost
    const nh = Math.max(0, t.hp - dmg);
    const ng = Math.min(t.gold, tr.goldValue - goldReleased(tr.goldValue, tr.maxHealth, nh));
    released = t.gold - ng; t.gold = ng; t.hp = nh; destroyed = nh === 0;
  } else if (tr.imp) {                           // gems never run out: collapse, refill, pay a little
    t.hp -= dmg; if (t.hp <= 0) { t.hp = tr.maxHealth; released = VAR.GOLD_MINED_FROM_GEMS; }
  } else { t.hp -= dmg; destroyed = t.hp <= 0; }
  if (destroyed) { setTerrain(t, tr.destroyedTo); t.gold = 0; G.dirty = true; }
  return released;
}
function claimable(x, y) {                       // ClaimTileTask: unowned floor next to our territory
  const t = tile(x, y); if (!t || TERRAIN[t.t].solid || t.owner === 1 || t.owner === HERO_LAND) return false;
  if (t.t === T.PORTAL && !(x === G.portal.x && y === G.portal.y)) return false;
  return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => { const n = tile(x + dx, y + dy); return n && n.owner === 1 && !TERRAIN[n.t].solid; })
    || (t.t === T.PORTAL && [[2,0],[-2,0],[0,2],[0,-2],[1,1],[-1,1],[1,-1],[-1,-1],[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[-1,2],[1,-2],[-1,-2]].some(([dx,dy]) => { const n = tile(x+dx, y+dy); return n && n.owner === 1 && !TERRAIN[n.t].solid; }));
}
function healClaim(x, y, dt, eff) {
  const t = tile(x, y); t.hp = Math.min(TERRAIN[t.t].maxHealth, t.hp + perApplication(VAR.CLAIM_TILE_HEALTH, eff) * dt);
  if (t.hp >= TERRAIN[t.t].maxHealth) {
    if (t.t === T.PORTAL) { for (const q of G.map) if (q.t === T.PORTAL) q.owner = 1; G.portalOwned = true; say('Portal claimed — creatures will arrive.'); }
    else t.owner = 1;
    G.dirty = true;
  }
}

/* ===================================================================================== task board
 * TaskManager.scanTerrainTasks: one tile-task per tile per player, created/removed as the map changes. */
const TASK = { DIG: { prio: 10, max: 3 }, CLAIM: { prio: 6, max: 1 }, REPAIR: { prio: 7, max: 2 }, REARM: { prio: 5, max: 1 } };   // RepairWallTileTask / workshop crates analogues
function scanTasks() {
  const live = new Set();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = G.map[idx(x, y)], tr = TERRAIN[t.t]; let type = null;
    if (tr.solid && tr.tag && t.tag) type = 'DIG';
    else if (claimable(x, y)) type = 'CLAIM';
    if (!type) continue;
    const key = type + ':' + x + ',' + y; live.add(key);
    if (!G.tasks.has(key)) G.tasks.set(key, { key, type, x, y, who: new Set() });
  }
  const add = (type, x, y) => { const key = type + ':' + x + ',' + y; live.add(key); if (!G.tasks.has(key)) G.tasks.set(key, { key, type, x, y, who: new Set() }); };
  for (const d of G.doors) if (!d.dead && d.hp < d.maxHp && !G.heroes.some(h => Math.hypot(h.x - d.x, h.y - d.y) < 4)) add('REPAIR', d.tx, d.ty);   // imps wait until the fight is over
  for (const tr of G.traps) if (tr.charges < tr.max && G.gold >= TRAPS[tr.kind].rearmCost) add('REARM', tr.tx, tr.ty);
  for (const [k, task] of G.tasks) if (!live.has(k)) { for (const w of task.who) if (w.task === task) w.drop(); G.tasks.delete(k); }
}
function taskTargets(task) {                     // DigTileTask.getTarget = an accessible neighbour; Claim = the tile
  if (task.type !== 'DIG') return [[task.x, task.y]];
  return [[1,0],[-1,0],[0,1],[0,-1]].map(([dx, dy]) => [task.x + dx, task.y + dy]).filter(([x, y]) => !solid(x, y));
}

/* ===================================================================================== actors */
class Mover {
  constructor(x, y, speed) { this.x = x + 0.5; this.y = y + 0.5; this.speed = speed; this.path = null; this.face = 0; }
  get tx() { return Math.floor(this.x); } get ty() { return Math.floor(this.y); }
  go(path) { this.path = path && path.length ? path.slice() : null; return path !== null; }
  stepMove(dt, mult = 1) {                        // mult: running (fleeing) is faster, Attributes.runSpeed
    let left = this.speed * dt * mult; this.blocker = null;
    while (this.path && this.path.length && left > 0) {
      const n = this.path[0];
      if (this.team === 'h' && this.state !== 'flee') {       // a closed door stops invaders until it is smashed; keepers walk through
        const door = doorAt(n.x, n.y); if (door && !door.dead && !(this.tx === n.x && this.ty === n.y)) { this.blocker = door; break; } }
      const dx = n.x + 0.5 - this.x, dy = n.y + 0.5 - this.y, d = Math.hypot(dx, dy);
      if (d <= left) { this.x = n.x + 0.5; this.y = n.y + 0.5; left -= d; this.path.shift(); }
      else { this.x += dx / d * left; this.y += dy / d * left; left = 0; this.face = Math.atan2(dy, dx); }
    }
    if (this.path && !this.path.length) this.path = null;
    return !this.path;
  }
}

class Imp extends Mover {                        // CreatureState.IDLE -> findStuffToDo -> WORK
  constructor(x, y) { super(x, y, 3.2); this.state = 'idle'; this.task = null; this.gold = 0; this.think = 0; this.dest = null;
    Object.assign(this, { hp: 40, maxHp: 40, team: 'k', dead: false, flash: 0, held: false, scare: 0, isImp: true }); }
  drop() { if (this.task) this.task.who.delete(this); this.task = null; this.state = 'idle'; this.path = null; }
  assign(task, path) { this.task = task; task.who.add(this); this.state = 'toTask'; this.go(path); }
  update(dt) {
    if (this.dead || this.held) return;
    this.flash = Math.max(0, this.flash - dt);
    if (this.state === 'flee') {                                          // Attributes.ALWAYS_FLEE: imps never fight
      if (this.stepMove(dt, 1.4)) { this.state = 'idle'; this.think = 0.5; }
      return;
    }
    this.scare -= dt;
    if (this.scare <= 0) {
      this.scare = 0.3; const h = nearestFoe(this, 6, true);
      if (h) { this.drop(); const p = findPath(this.tx, this.ty, G.heart.x, G.heart.y + 2); if (p && p.length) { this.state = 'flee'; this.go(p); return; } }
    }
    this.think -= dt;
    if (this.state === 'idle') {
      if (this.think > 0) return; this.think = 0.4;
      if (this.gold > 0 && this.deliver()) return;                       // isTooMuchGold -> dropGoldToTreasury
      if (this.gold >= VAR.IMP_MAX_GOLD && !this.hasRoomFor()) {         // treasury full: surplus is dumped so imps keep working
        this.gold = 0; if (!G.warnFull) { G.warnFull = 1; say('Treasury full — imps are dumping surplus gold. Build more Treasury!'); } }
      if (this.findWork()) return;
      if (!this.path && rand() < 0.3) { const c = ownedFloor(); if (c) this.go(findPath(this.tx, this.ty, c.x, c.y)); }   // navigateToRandomPoint
      this.stepMove(dt);
    } else if (this.state === 'toTask') {
      if (!this.task || !G.tasks.has(this.task.key)) return this.drop();
      if (this.stepMove(dt)) this.state = 'work';
    } else if (this.state === 'work') {
      const k = this.task; if (!k || !G.tasks.has(k.key)) return this.drop();
      if (k.type === 'DIG') {
        if (this.gold >= VAR.IMP_MAX_GOLD && !this.hasRoomFor()) return this.drop();
        const got = damageTile(k.x, k.y, dt, VAR.IMP_EFFICIENCY);
        this.gold += got; this.face = Math.atan2(k.y + 0.5 - this.y, k.x + 0.5 - this.x);
        if (this.gold >= VAR.IMP_MAX_GOLD) { this.drop(); this.think = 0; }
      } else if (k.type === 'REPAIR') {
        const d = doorAt(k.x, k.y); if (!d || d.dead || d.hp >= d.maxHp) return this.drop();
        d.hp = Math.min(d.maxHp, d.hp + 40 * VAR.IMP_EFFICIENCY / 100 * dt);
      } else if (k.type === 'REARM') {
        const tr = trapAt(k.x, k.y), def = tr && TRAPS[tr.kind]; if (!tr || tr.charges >= tr.max || G.gold < def.rearmCost) return this.drop();
        tr.prog = (tr.prog || 0) + dt; if (tr.prog >= def.rearm) { tr.prog = 0; tr.charges++; G.gold -= def.rearmCost; }
      } else healClaim(k.x, k.y, dt, VAR.IMP_EFFICIENCY);
    } else if (this.state === 'deliver') {
      if (this.stepMove(dt)) {
        const space = capacity() - G.gold, put = Math.max(0, Math.min(this.gold, space));
        G.gold += put; this.gold -= put; this.state = 'idle'; this.think = 0.2;
        if (put) { const t = tile(this.tx, this.ty); if (t) t.stored = Math.min(VAR.MAX_GOLD_PER_TREASURY_TILE, t.stored + put); }
      }
    }
  }
  hasRoomFor() { return capacity() > G.gold; }
  deliver() {
    if (!this.hasRoomFor()) return false;
    let best = null, bl = Infinity;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = G.map[idx(x, y)];
      if (t.t === T.TREASURY && t.owner === 1 && Math.abs(x - this.tx) + Math.abs(y - this.ty) < bl) { best = { x, y }; bl = Math.abs(x - this.tx) + Math.abs(y - this.ty); } }
    if (!best) return false; const p = findPath(this.tx, this.ty, best.x, best.y); if (!p) return false;
    this.state = 'deliver'; this.go(p); if (!p.length) this.state = 'deliver'; return true;
  }
  findWork() {                                                            // TaskManager: workers pull tasks
    const cands = [];
    for (const task of G.tasks.values()) {
      const def = TASK[task.type]; if (task.who.size >= def.max) continue;
      if (task.type === 'DIG' && this.gold >= VAR.IMP_MAX_GOLD && !this.hasRoomFor()) continue;
      cands.push({ task, score: def.prio * 100 - (Math.abs(task.x - this.tx) + Math.abs(task.y - this.ty)) });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const { task } of cands.slice(0, 8)) {
      let best = null, bl = Infinity;
      for (const [x, y] of taskTargets(task)) { const p = findPath(this.tx, this.ty, x, y); if (p && p.length < bl) { best = p; bl = p.length; } }
      if (best) { this.assign(task, best); return true; }
    }
    return false;
  }
}

function ownedFloor() {
  for (let n = 0; n < 12; n++) { const x = 1 + (rand() * (W - 2) | 0), y = 1 + (rand() * (H - 2) | 0), t = tile(x, y); if (t && !TERRAIN[t.t].solid && t.owner === 1) return { x, y }; }
  return null;
}
function capacity() { let c = 2000;                 // the Heart itself holds a starter hoard
  for (const t of G.map) if (t.t === T.TREASURY && t.owner === 1) c += VAR.MAX_GOLD_PER_TREASURY_TILE; return c; }

/* combat stats mirror Creature.Attributes: hp, melee damage / recharge ("MELEE_RECHARGE_TIME_SECONDS"), range, speed */
const KINDS = [
  { name: 'Goblin',  color: '#6fbf4f', pay: 60,  hp: 80,  dmg: 8,  range: 1.2, cdMax: 1.0, ranged: 0 },
  { name: 'Troll',   color: '#b08850', pay: 90,  hp: 170, dmg: 12, range: 1.2, cdMax: 1.2, ranged: 0 },
  { name: 'Warlock', color: '#a070e0', pay: 120, hp: 65,  dmg: 14, range: 5,   cdMax: 1.6, ranged: 1 },
];
class Creature extends Mover {                    // CreatureMoodSystem / CreatureSleepSystem: reduced to one lair + payday
  constructor(x, y, kind) { super(x, y, 1.6); Object.assign(this, kind); this.energy = 100 + (rand() * 0 | 0); this.anger = 0; this.lair = null; this.state = 'idle'; this.wait = 1;
    this.id = ++Creature.n; this.energy = 70 + rand() * 30;
    Object.assign(this, { maxHp: kind.hp, team: 'k', cd: 0, sight: 7, level: 1, xp: 0, rep: 0, dead: false, flash: 0, held: false }); }
  get mood() { return this.anger >= 1600 ? 'angry' : this.anger >= 800 ? 'unhappy' : 'content'; }
  update(dt) {
    if (this.dead || this.held) return;
    this.flash = Math.max(0, this.flash - dt);
    if (this.state !== 'sleep') this.energy -= 1.4 * dt;
    if (!this.lair) {                             // REASON_NO_LAIR: anger accrues until a bed is assigned
      this.anger += 25 * dt; const bed = freeBed(); if (bed) { bed.occupant = this; this.lair = bed; say(this.name + ' #' + this.id + ' claimed a bed.'); }
    }
    if (this.anger >= 3000) { say(this.name + ' #' + this.id + ' is furious and leaves your dungeon!'); if (this.lair) this.lair.occupant = null; return 'leave'; }
    if (fightBrain(this, dt)) return;                                     // CreatureState: shouldFleeOrAttack comes first
    if (this.hp < this.maxHp)                                             // own-land regen, much faster asleep in the lair
      this.hp = Math.min(this.maxHp, this.hp + (this.state === 'sleep' ? 8 : VAR.OWN_LAND_HEALTH_INCREASE_PER_SECOND) * dt);
    if (this.state === 'sleep') {
      this.energy = Math.min(100, this.energy + 12 * dt); this.anger = Math.max(0, this.anger + VAR.MODIFY_ANGER_OF_CREATURE_IN_LAIR_PER_SECOND * dt);
      if (this.energy >= 100 && this.hp >= this.maxHp * 0.8) { this.state = 'idle'; this.wait = 1; }
    } else if (this.state === 'toBed') {
      if (this.stepMove(dt)) this.state = 'sleep';
    } else {
      if ((this.energy < 35 || this.hp < this.maxHp * VAR.CREATURE_SLEEPS_WHEN_BELOW_PERCENT_HEALTH / 100) && this.lair) { const p = findPath(this.tx, this.ty, this.lair.x, this.lair.y); if (p) { this.go(p); this.state = 'toBed'; return; } }
      if (this.path) this.stepMove(dt); else { this.wait -= dt; if (this.wait <= 0) { this.wait = 1 + rand() * 3; const c = ownedFloor(); if (c) this.go(findPath(this.tx, this.ty, c.x, c.y)); } }
    }
  }
}
Creature.n = 0;
function freeBed() {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = G.map[idx(x, y)];
    if (t.t === T.LAIR && t.owner === 1) { t.bed = t.bed || { x, y, occupant: null }; if (!t.bed.occupant) return t.bed; } }
  return null;
}

/* ===================================================================================== combat
 * CreatureState.IDLE starts with `shouldFleeOrAttack` (CreatureController): sense -> pick target -> flee when weak
 * -> else close in until in range with line of sight -> strike on recharge (MELEE_RECHARGE_TIME). Keepers also
 * "hear" intruders on their own land (Attributes.distanceCanHear); heroes only see what they have los to. */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function los(ax, ay, bx, by) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 3);
  for (let i = 1; i < n; i++) if (solid(Math.floor(ax + (bx - ax) * i / n), Math.floor(ay + (by - ay) * i / n))) return false;
  return true;
}
const foesOf = (u) => u.team === 'k' ? G.heroes : G.creatures.concat(G.imps);
const alive = (u) => !u.dead && !u.held;
function sees(u, f) {
  const d = dist(u, f); if (d > VAR.HEAR_DISTANCE) return false;
  if (d <= u.sight && los(u.x, u.y, f.x, f.y)) return true;
  if (u.team === 'k') { const t = tile(f.tx, f.ty); return !!t && t.owner === 1 && !u.isImp; }   // alarm: intruder on our land
  return false;
}
function nearestFoe(u, maxD, needLos) {
  let best = null, bd = Infinity;
  for (const f of foesOf(u)) { if (!alive(f)) continue; const d = dist(u, f);
    if (d < bd && d <= (maxD || 99) && (needLos ? los(u.x, u.y, f.x, f.y) : sees(u, f))) { best = f; bd = d; } }
  return best;
}
const heartTarget = { get x() { return G.heart.x + 0.5; }, get y() { return G.heart.y + 0.5; }, heart: true, dead: false };
const roll = (d) => d * (0.85 + rand() * 0.3);
function strike(u, t) {
  u.cd = u.cdMax; u.face = Math.atan2(t.y - u.y, t.x - u.x); const dmg = roll(u.dmg);
  if (u.ranged) G.shots.push({ x: u.x, y: u.y, tgt: t, dmg, src: u, speed: 11, color: u.team === 'k' ? '#d9a0ff' : '#ffe9a0' });
  else hurt(t, dmg, u);
}
function hurt(t, dmg, src) {
  if (t.dead) return;
  G.fx.push({ x: t.x, y: t.y - 0.4, txt: Math.round(dmg), life: 0.7, color: t.team === 'k' || t.heart ? '#ff8080' : '#fff' });
  if (t.heart) {
    G.heartHp = Math.max(0, G.heartHp - dmg); G.heartFlash = 0.2;
    if (G.heartHp <= 0 && !G.over) { G.over = 'defeat'; say('Your Dungeon Heart has been destroyed!'); }
    return;
  }
  t.hp -= dmg; t.flash = 0.15; if (t.hp <= 0) kill(t, src);
}
function kill(t, src) {
  if (t.door) { t.dead = true; G.doors = G.doors.filter(d => d !== t); const dt_ = tile(t.tx, t.ty); if (dt_) dt_.door = null; G.fx.push({ x: t.x, y: t.y, splat: true, life: 3 }); G.dirty = true; say('A door was smashed!'); return; }
  t.dead = true; G.fx.push({ x: t.x, y: t.y, splat: true, life: 6 });
  if (t.isImp) { t.drop(); say('An imp was slain.'); }
  else if (t.team === 'k') { if (t.lair) t.lair.occupant = null; say(t.name + ' #' + t.id + ' has fallen!'); }
  else { G.kills++; say('A hero ' + t.name + ' is slain.'); }
  if (src && src.team === 'k' && src.level && !src.dead) gainXp(src);
}
function gainXp(c) {                              // CreatureExperienceSystem, reduced
  c.xp += VAR.XP_PER_KILL;
  if (c.level < VAR.MAX_LEVEL && c.xp >= VAR.XP_PER_LEVEL * c.level) {
    c.level++; c.maxHp = Math.round(c.maxHp * 1.18); c.dmg *= 1.18; c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.3);
    say(c.name + ' #' + c.id + ' reached level ' + c.level + '!');
  }
}
function startFlee(u) {                           // weak and in danger: run to the Heart (keepers) or back to the Gate (heroes)
  const goal = u.team === 'k' ? { x: G.heart.x, y: G.heart.y + 2 } : { x: G.gate.x, y: G.gate.y };
  const p = findPath(u.tx, u.ty, goal.x, goal.y); if (!p || !p.length) return false;
  u.state = 'flee'; u.go(p); return true;
}
function fightBrain(u, dt) {                      // true = this unit's turn was consumed by combat
  u.cd = Math.max(0, u.cd - dt);
  if (u.state === 'flee') {
    if (u.stepMove(dt, 1.5)) { u.state = 'idle'; u.wait = 1;
      if (u.team === 'h') { u.dead = true; u.escaped = true; say('A hero ' + u.name + ' escaped through the Gate.'); } }
    return true;
  }
  const t = nearestFoe(u);
  if (!t) { if (u.state === 'fight') { u.state = 'idle'; u.path = null; } return false; }
  if (u.hp < u.maxHp * 0.25 && !u.fearless && startFlee(u)) return true;
  u.state = 'fight';
  if (dist(u, t) <= u.range && los(u.x, u.y, t.x, t.y)) { u.path = null; u.face = Math.atan2(t.y - u.y, t.x - u.x); if (u.cd <= 0) strike(u, t); return true; }
  u.rep -= dt; if (u.rep <= 0 || !u.path) { u.rep = 0.4; u.go(findPath(u.tx, u.ty, t.tx, t.ty)); }
  u.stepMove(dt);
  if (u.blocker && !u.blocker.dead && u.cd <= 0) { u.face = Math.atan2(u.blocker.y - u.y, u.blocker.x - u.x); strike(u, u.blocker); }
  return true;
}
function updateShots(dt) {
  for (const s of G.shots) {
    const t = s.tgt; if (t.dead) { s.done = true; continue; }
    const dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy), m = s.speed * dt;
    if (d <= m + 0.2) { hurt(t, s.dmg, s.src); s.done = true; } else { s.x += dx / d * m; s.y += dy / d * m; }
  }
  G.shots = G.shots.filter(s => !s.done);
  for (const f of G.fx) f.life -= dt; G.fx = G.fx.filter(f => f.life > 0);
  G.heartFlash = Math.max(0, G.heartFlash - dt);
}

/* ---- heroes: they arrive from the Hero Gate once a tunnel links it to your dungeon (TriggerAction CREATE_HERO_PARTY analogue) ---- */
const HEROES = [
  { name: 'Knight', letter: 'K', color: '#e8e8f0', hp: 150, dmg: 11, range: 1.2, cdMax: 1.1, ranged: 0, speed: 1.7 },
  { name: 'Archer', letter: 'A', color: '#9fe08f', hp: 70,  dmg: 9,  range: 6,   cdMax: 1.2, ranged: 1, speed: 1.9 },
  { name: 'Mage',   letter: 'M', color: '#8fb8ff', hp: 60,  dmg: 16, range: 5,   cdMax: 1.8, ranged: 1, speed: 1.6 },
];
class Hero extends Mover {
  constructor(x, y, kind, scale, party) { super(x, y, kind.speed); Object.assign(this, kind);
    this.hp = this.maxHp = Math.round(kind.hp * scale); this.dmg = kind.dmg * scale; this.team = 'h'; this.cd = 0; this.sight = 7;
    this.state = 'idle'; this.rep = 0; this.think = 0; this.party = party; this.dead = false; this.flash = 0; this.held = false; this.id = ++G.nextId; }
  get leader() { return this.party.find(h => !h.dead && h.state !== 'flee') || null; }
  update(dt) {
    if (this.dead) return; this.flash = Math.max(0, this.flash - dt);
    if (this.stun > 0) { this.stun -= dt; this.cd = Math.max(0, this.cd - dt); return; }                 // lightning-trap stun
    if (fightBrain(this, dt)) return;
    if (dist(this, heartTarget) <= this.range + 1.5 && los(this.x, this.y, heartTarget.x, heartTarget.y)) {   // the objective: KILL_PLAYER
      this.path = null; this.face = Math.atan2(heartTarget.y - this.y, heartTarget.x - this.x); if (this.cd <= 0) strike(this, heartTarget); return;
    }
    const lead = this.leader; this.think -= dt;
    if (lead === this) { if (this.think <= 0 || !this.path) { this.think = 1; this.go(findPath(this.tx, this.ty, G.heart.x, G.heart.y)); } }
    else if (lead && dist(this, lead) > 2.2 && (this.think <= 0 || !this.path)) { this.think = 0.6; this.go(findPath(this.tx, this.ty, lead.tx, lead.ty)); }   // FollowTarget
    this.stepMove(dt);
    if (this.blocker && !this.blocker.dead) { this.face = Math.atan2(this.blocker.y - this.y, this.blocker.x - this.x); if (this.cd <= 0) strike(this, this.blocker); }   // smash the door
  }
}
function spawnWave() {
  const n = G.wave, size = 2 + n, scale = 1 + 0.12 * n, party = [];
  for (let i = 0; i < size; i++) {
    const kind = HEROES[i === 0 ? 0 : (i + n) % 3];
    const h = new Hero(G.gate.x - 1 + (i % 3), G.gate.y - 1 + ((i / 3) | 0), kind, scale, party); party.push(h); G.heroes.push(h);
  }
  G.wave++; G.nextWave = G.wave < VAR.WAVES ? G.time + VAR.WAVE_INTERVAL : Infinity;
  say('⚔ Wave ' + G.wave + '/' + VAR.WAVES + ': ' + size + ' heroes pour out of the Hero Gate!');
}
function heroLogic(dt) {
  if (!G.gateOpen) {
    G.gateT -= dt; if (G.gateT > 0) return; G.gateT = 2;
    if (findPath(G.gate.x, G.gate.y, G.heart.x, G.heart.y)) { G.gateOpen = true; G.nextWave = G.time + VAR.FIRST_WAVE_DELAY;
      say('The Hero Gate is linked to your dungeon! Heroes will invade in ' + VAR.FIRST_WAVE_DELAY + 's.'); }
    return;
  }
  if (G.time >= G.nextWave && G.wave < VAR.WAVES) spawnWave();
  if (G.wave >= VAR.WAVES && !G.heroes.length && !G.over) { G.over = 'victory'; say('All invaders are defeated — the dungeon is yours!'); }
}

/* ===================================================================================== doors & traps
 * DoorsController / TrapsController, reduced. Doors are walls to heroes (they must smash them) and open for your units;
 * imps repair them. Traps are hidden from heroes, fire when one steps on the tile, hold a few charges and are re-armed
 * by imps for gold (stand-in for the Workshop's manufactured crates). */
const TRAPS = {
  gas:  { name: 'Gas Trap',       cost: 150, max: 3, cd: 7, rearm: 3, rearmCost: 30, color: '#7fe04a' },
  bolt: { name: 'Lightning Trap', cost: 200, max: 2, cd: 5, rearm: 4, rearmCost: 40, color: '#ffe040' },
};
const DOOR = { cost: 100, hp: 400 };
const doorAt = (x, y) => { const t = tile(x, y); return t && t.door || null; };
const trapAt = (x, y) => { const t = tile(x, y); return t && t.trap || null; };
function placeThings(kind, x0, y0, x1, y1) {
  const def = kind === 'door' ? DOOR : TRAPS[kind], name = kind === 'door' ? 'Door' : def.name; let n = 0, spent = 0;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const t = tile(x, y); if (!t || t.t !== T.PATH || t.owner !== 1 || t.door || t.trap) continue;
    if (G.gold - spent < def.cost) { say('Not enough gold for more ' + name + 's.'); x = 1e9; y = 1e9; break; }
    if (kind === 'door') { const d = { door: true, tx: x, ty: y, x: x + .5, y: y + .5, hp: DOOR.hp, maxHp: DOOR.hp, dead: false, flash: 0 }; t.door = d; G.doors.push(d); }
    else { const tr = { kind, tx: x, ty: y, x: x + .5, y: y + .5, charges: def.max, max: def.max, cd: 0, prog: 0 }; t.trap = tr; G.traps.push(tr); }
    spent += def.cost; n++;
  }
  G.gold -= spent; if (n) say('Placed ' + n + ' ' + name + (n > 1 ? 's' : '') + ' for ' + spent + ' gold.'); else say('Doors and traps go on your claimed floor, not on rooms.');
  G.dirty = true;
}
function removeThings(x0, y0, x1, y1) {                  // right-click: sell for half the price
  let n = 0, refund = 0;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const t = tile(x, y); if (!t) continue;
    if (t.door) { refund += DOOR.cost / 2; G.doors = G.doors.filter(d => d !== t.door); t.door = null; n++; }
    else if (t.trap) { refund += TRAPS[t.trap.kind].cost / 2; G.traps = G.traps.filter(d => d !== t.trap); t.trap = null; n++; }
  }
  if (n) { G.gold += refund; say('Sold ' + n + ' item(s) for ' + refund + ' gold.'); G.dirty = true; }
}
function fireTrap(tr) {
  tr.charges--; tr.cd = TRAPS[tr.kind].cd;
  if (tr.kind === 'gas') { G.clouds.push({ x: tr.x, y: tr.y, r: 2.2, life: 5, dps: 10, tick: 0 }); say('A Gas Trap hisses!'); }
  else {
    G.fx.push({ x: tr.x, y: tr.y, bolt: true, life: 0.35 }); say('A Lightning Trap discharges!');
    for (const h of G.heroes) if (!h.dead && dist(h, tr) <= 2.2) { hurt(h, 45, null); h.stun = 1.5; G.fx.push({ x: h.x, y: h.y, bolt: true, life: 0.3 }); }
  }
}
function updateTraps(dt) {
  for (const d of G.doors) d.flash = Math.max(0, d.flash - dt);
  for (const tr of G.traps) {
    tr.cd = Math.max(0, tr.cd - dt);
    if (tr.charges > 0 && tr.cd <= 0 && G.heroes.some(h => !h.dead && Math.hypot(h.x - tr.x, h.y - tr.y) <= 0.9)) fireTrap(tr);
  }
  for (const c of G.clouds) {
    c.life -= dt; c.tick -= dt;
    if (c.tick <= 0) { c.tick = 0.5; for (const h of G.heroes) if (!h.dead && dist(h, c) <= c.r) hurt(h, c.dps * 0.5, null); }
  }
  G.clouds = G.clouds.filter(c => c.life > 0);
}

/* ===================================================================================== player actions */
function build(roomId, x0, y0, x1, y1) {          // RoomPlacementValidator (reduced): owned, empty, affordable
  const tr = TERRAIN[roomId]; let n = 0, spent = 0;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const t = tile(x, y); if (!t || t.t !== T.PATH || t.owner !== 1) continue;
    if (G.gold - spent < tr.cost) { say('Not enough gold for more ' + tr.name + ' tiles.'); x = 1e9; y = 1e9; break; }
    t.t = roomId; t.hp = tr.maxHealth; t.room = 1; t.bed = null; spent += tr.cost; n++;
  }
  G.gold -= spent; if (n) say('Built ' + n + ' ' + tr.name + ' tile(s) for ' + spent + ' gold.'); else say('Nothing to build there — rooms need your claimed floor.');
  G.dirty = true;
}
function tagRect(x0, y0, x1, y1, on) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const t = tile(x, y); if (t && TERRAIN[t.t].solid && TERRAIN[t.t].tag) t.tag = on ? 1 : 0; }
  scanTasks();
}

/* ===================================================================================== main step */
function step(dt) {
  if (G.over) return;
  G.time += dt;
  G.scanT -= dt; if (G.scanT <= 0 || G.dirty) { scanTasks(); G.scanT = 0.4; G.dirty = false; }
  // free imp generation: MINIMUM_IMP_THRESHOLD / TIME_BEFORE_FREE_IMP_GENERATED_SECONDS
  G.nextImp -= dt;
  if (G.imps.length < VAR.MINIMUM_IMP_THRESHOLD && G.nextImp <= 0) { G.nextImp = VAR.TIME_BEFORE_FREE_IMP_GENERATED_SECONDS; G.imps.push(new Imp(G.heart.x, G.heart.y + 2)); say('A free imp crawls out of the Heart.'); }
  for (const i of G.imps) i.update(dt);
  // portal spawning (CreatureSpawnSystem), only once claimed
  G.nextSpawn -= dt;
  if (G.portalOwned && G.nextSpawn <= 0 && G.creatures.length < VAR.CREATURES_SUPPORTED_BY_FIRST_PORTAL) {
    G.nextSpawn = 25; const k = KINDS[(rand() * KINDS.length) | 0]; G.creatures.push(new Creature(G.portal.x, G.portal.y, k)); say('A ' + k.name + ' enters through the portal.');
  }
  G.creatures = G.creatures.filter(c => c.dead ? false : c.update(dt) !== 'leave');
  for (const h of G.heroes) h.update(dt);
  updateTraps(dt); updateShots(dt); heroLogic(dt);
  G.heroes = G.heroes.filter(h => !h.dead); G.creatures = G.creatures.filter(c => !c.dead); G.imps = G.imps.filter(i => !i.dead);
  // payday
  G.nextPay -= dt;
  if (G.nextPay <= 0) {
    G.nextPay = VAR.PAY_DAY_FREQUENCY_SECONDS; let total = 0, short = 0;
    for (const c of G.creatures) { if (G.gold >= c.pay) { G.gold -= c.pay; total += c.pay; } else { c.anger += 400; short++; } }
    if (G.creatures.length) say('Payday: paid ' + total + ' gold' + (short ? ', ' + short + ' unpaid (angry!)' : '') + '.');
  }
}

/* ===================================================================================== rendering */
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const MODE_2D = qs.get('view') === '2d';
cv.width = W * TS; cv.height = H * TS;
const hash = (x, y) => { let h = x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; };
const COL = { [T.ROCK]: '#1c1a1a', [T.EARTH]: '#6a4a2c', [T.GOLD]: '#6a4a2c', [T.GEM]: '#4a3a4a', [T.PATH]: '#3b3128' };
const ROOMCOL = { [T.TREASURY]: '#7a6420', [T.LAIR]: '#4a3a6a', [T.HEART]: '#8a2a2a', [T.PORTAL]: '#5a2a7a', [T.GATE]: '#6a3a2a' };
const scr = (u) => u.held && mouse.fx !== undefined ? [mouse.fx * TS, mouse.fy * TS - 6] : [u.x * TS, u.y * TS];
function bar(px, py, u) {                                     // health bar above any damaged unit
  if (u.hp >= u.maxHp) return; ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(px - 7, py - 12, 14, 3);
  ctx.fillStyle = u.team === 'h' ? '#5aa0ff' : '#5fd070'; ctx.fillRect(px - 7, py - 12, 14 * Math.max(0, u.hp) / u.maxHp, 3);
}
let mouse = { x: -1, y: -1, down: 0, sx: 0, sy: 0 }, tool = 'dig';

function draw() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = G.map[idx(x, y)], tr = TERRAIN[t.t], px = x * TS, py = y * TS, n = hash(x, y);
    let c = COL[t.t] || ROOMCOL[t.t];
    ctx.fillStyle = c; ctx.fillRect(px, py, TS, TS);
    ctx.fillStyle = `rgba(${n > .5 ? '255,255,255' : '0,0,0'},${Math.abs(n - .5) * .16})`; ctx.fillRect(px, py, TS, TS);
    if (!tr.solid && t.owner === 1) { ctx.fillStyle = 'rgba(70,110,220,.38)'; ctx.fillRect(px, py, TS, TS); ctx.strokeStyle = 'rgba(130,170,255,.18)'; ctx.strokeRect(px + .5, py + .5, TS - 1, TS - 1); }
    if (tr.solid && t.t === T.EARTH) {                       // reinforced look next to our floor
      const ours = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => { const q = tile(x + dx, y + dy); return q && q.owner === 1 && !TERRAIN[q.t].solid; });
      ctx.fillStyle = ours ? 'rgba(180,150,110,.35)' : 'rgba(0,0,0,.12)'; ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4);
    }
    if (t.t === T.GOLD) { ctx.fillStyle = t.gold > 0 ? '#f4c430' : '#8a7a40'; for (let i = 0; i < 5; i++) ctx.fillRect(px + 3 + hash(x + i, y * 7) * 13, py + 3 + hash(x * 5, y + i) * 13, 3, 3); }
    if (t.t === T.GEM) { ctx.fillStyle = '#5ee0ff'; for (let i = 0; i < 4; i++) ctx.fillRect(px + 3 + hash(x + i, y * 3) * 12, py + 3 + hash(x * 9, y + i) * 12, 4, 4); }
    if (t.t === T.TREASURY) { const f = Math.min(1, G.gold / Math.max(1, capacity())); ctx.fillStyle = '#f4c430'; ctx.fillRect(px + 4, py + TS - 4 - f * (TS - 8), TS - 8, f * (TS - 8) + 0); ctx.strokeStyle = '#c8a030'; ctx.strokeRect(px + 3.5, py + 3.5, TS - 7, TS - 7); }
    if (t.t === T.LAIR) { ctx.fillStyle = '#8a70c0'; ctx.fillRect(px + 4, py + 6, TS - 8, TS - 12); if (t.bed && t.bed.occupant) { ctx.fillStyle = t.bed.occupant.color; ctx.fillRect(px + 6, py + 7, 5, 5); } }
    if (t.t === T.HEART && (x === G.heart.x && y === G.heart.y)) { ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.arc(px + TS / 2, py + TS / 2, 7 + Math.sin(G.time * 4) * 1.2, 0, 7); ctx.fill(); }
    if (!tr.solid && t.owner === HERO_LAND) { ctx.fillStyle = 'rgba(190,70,50,.22)'; ctx.fillRect(px, py, TS, TS); }
    if (t.t === T.GATE && (x === G.gate.x && y === G.gate.y)) { ctx.strokeStyle = G.gateOpen ? '#ff8a50' : '#8a5a4a'; ctx.lineWidth = 2; ctx.strokeRect(px + 3, py + 3, TS - 6, TS - 6); ctx.lineWidth = 1; }
    if (t.t === T.HEART && (x === G.heart.x && y === G.heart.y) && G.heartFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(px - TS, py - TS, TS * 3, TS * 3); }
    if (t.t === T.PORTAL && (x === G.portal.x && y === G.portal.y)) { ctx.strokeStyle = G.portalOwned ? '#c090ff' : '#7a5aa0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px + TS / 2, py + TS / 2, 7, 0, 7); ctx.stroke(); ctx.lineWidth = 1; }
    if (t.tag && tr.solid) { ctx.strokeStyle = '#ffe070'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px + 3, py + 3); ctx.lineTo(px + TS - 3, py + TS - 3); ctx.moveTo(px + TS - 3, py + 3); ctx.lineTo(px + 3, py + TS - 3); ctx.stroke(); ctx.lineWidth = 1; }
    if (tr.solid && !tr.imp && t.hp < tr.maxHealth && t.hp > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(px + 2, py + TS - 5, TS - 4, 3); ctx.fillStyle = '#e0624f'; ctx.fillRect(px + 2, py + TS - 5, (TS - 4) * t.hp / tr.maxHealth, 3); }
    if (!tr.solid && t.owner !== 1 && t.hp > 0 && t.hp < tr.maxHealth) { ctx.fillStyle = 'rgba(70,110,220,.8)'; ctx.fillRect(px + 2, py + TS - 5, (TS - 4) * t.hp / tr.maxHealth, 3); }
  }
  for (const d of G.doors) { const px = d.tx * TS, py = d.ty * TS; ctx.fillStyle = d.flash > 0 ? '#fff' : '#8a5a2a'; ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4); ctx.strokeStyle = '#3a2410'; ctx.strokeRect(px + 2.5, py + 2.5, TS - 5, TS - 5);
    ctx.beginPath(); ctx.moveTo(px + 2, py + TS / 2); ctx.lineTo(px + TS - 2, py + TS / 2); ctx.stroke(); if (d.hp < d.maxHp) { ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(px + 2, py + TS - 5, TS - 4, 3); ctx.fillStyle = '#e0a050'; ctx.fillRect(px + 2, py + TS - 5, (TS - 4) * d.hp / d.maxHp, 3); } }
  for (const tr of G.traps) { const px = tr.x * TS, py = tr.y * TS; ctx.globalAlpha = tr.charges ? 0.95 : 0.35; ctx.strokeStyle = TRAPS[tr.kind].color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = TRAPS[tr.kind].color; for (let i = 0; i < tr.charges; i++) ctx.fillRect(px - 5 + i * 4, py - 1, 3, 3); ctx.globalAlpha = 1; }
  for (const c of G.clouds) { ctx.fillStyle = `rgba(120,220,70,${0.28 * Math.min(1, c.life)})`; ctx.beginPath(); ctx.arc(c.x * TS, c.y * TS, c.r * TS, 0, 7); ctx.fill(); }
  for (const f of G.fx) if (f.bolt) { ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(f.x * TS - 3, f.y * TS - 14); ctx.lineTo(f.x * TS + 3, f.y * TS - 6); ctx.lineTo(f.x * TS - 2, f.y * TS - 2); ctx.lineTo(f.x * TS + 2, f.y * TS + 4); ctx.stroke(); ctx.lineWidth = 1; }
  for (const f of G.fx) if (f.splat) { ctx.fillStyle = `rgba(140,20,20,${Math.min(.5, f.life / 6)})`; ctx.beginPath(); ctx.arc(f.x * TS, f.y * TS, 6, 0, 7); ctx.fill(); }
  for (const i of G.imps) { const [px, py] = scr(i); ctx.fillStyle = i.flash > 0 ? '#fff' : i.state === 'flee' ? '#ff9060' : '#d04040'; ctx.beginPath(); ctx.arc(px, py, 4.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(px + Math.cos(i.face) * 2.5 - .5, py + Math.sin(i.face) * 2.5 - .5, 2, 2);
    if (i.gold) { ctx.fillStyle = '#f4c430'; ctx.fillRect(px - 2, py - 8, 4, 3); }
    if (i.state === 'work') { ctx.strokeStyle = '#fff6'; ctx.beginPath(); ctx.arc(px, py, 6 + Math.sin(G.time * 18) * 1.5, 0, 7); ctx.stroke(); }
    bar(px, py, i); }
  for (const c of G.creatures) { const [px, py] = scr(c); ctx.fillStyle = c.flash > 0 ? '#fff' : c.color; ctx.fillRect(px - 5, py - 5, 10, 10);
    if (c.state === 'fight' || c.state === 'flee') { ctx.strokeStyle = c.state === 'flee' ? '#ffb030' : '#ff4040'; ctx.strokeRect(px - 6.5, py - 6.5, 13, 13); }
    for (let l = 1; l < c.level; l++) { ctx.fillStyle = '#ffe070'; ctx.fillRect(px - 5 + (l - 1) * 3, py + 6, 2, 2); }
    bar(px, py, c); ctx.fillStyle = '#000'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(c.name[0], px, py + 3);
    if (c.state === 'sleep') { ctx.fillStyle = '#9cf'; ctx.fillText('z', px + 7, py - 5); }
    if (c.mood !== 'content') { ctx.fillStyle = c.mood === 'angry' ? '#ff3030' : '#ffb030'; ctx.fillText('!', px, py - 8); } }
  for (const h of G.heroes) { const px = h.x * TS, py = h.y * TS;
    ctx.fillStyle = h.flash > 0 ? '#fff' : h.color; ctx.beginPath(); ctx.arc(px, py, 5.5, 0, 7); ctx.fill(); ctx.strokeStyle = h.state === 'flee' ? '#ffb030' : '#4a90ff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#000'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(h.letter, px, py + 3); bar(px, py, h); }
  for (const s of G.shots) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x * TS, s.y * TS, 2.2, 0, 7); ctx.fill(); }
  ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
  for (const f of G.fx) if (!f.splat && !f.bolt) { ctx.globalAlpha = Math.min(1, f.life * 2); ctx.fillStyle = f.color; ctx.fillText(f.txt, f.x * TS, (f.y - (0.7 - f.life) * 0.8) * TS); ctx.globalAlpha = 1; }
  { const hp = G.heartHp / VAR.HEART_HEALTH, bx = (G.heart.x - 1) * TS, by = (G.heart.y + 2) * TS + 2;     // Heart health
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx, by, TS * 3, 4); ctx.fillStyle = hp > .5 ? '#e05050' : '#ff9030'; ctx.fillRect(bx, by, TS * 3 * hp, 4); }
  if (G.over) { ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.textAlign = 'center';
    ctx.fillStyle = G.over === 'victory' ? '#f0c040' : '#e0624f'; ctx.font = 'bold 44px sans-serif'; ctx.fillText(G.over === 'victory' ? 'VICTORY' : 'DEFEAT', cv.width / 2, cv.height / 2 - 6);
    ctx.fillStyle = '#e8dcc8'; ctx.font = '16px sans-serif'; ctx.fillText(G.kills + ' heroes slain · ' + Math.floor(G.time) + 's · reload to play again', cv.width / 2, cv.height / 2 + 24); }
  if (mouse.down && tool !== 'hand') {                        // drag preview
    const x0 = Math.min(mouse.sx, mouse.x), x1 = Math.max(mouse.sx, mouse.x), y0 = Math.min(mouse.sy, mouse.y), y1 = Math.max(mouse.sy, mouse.y);
    ctx.fillStyle = mouse.down === 3 ? 'rgba(255,80,80,.25)' : 'rgba(255,230,120,.25)'; ctx.fillRect(x0 * TS, y0 * TS, (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS);
  } else if (mouse.x >= 0) { ctx.strokeStyle = '#fff'; ctx.strokeRect(mouse.x * TS + .5, mouse.y * TS + .5, TS - 1, TS - 1); }
}

/* ===================================================================================== UI wiring */
const $ = (id) => document.getElementById(id);
const TOOLS = [ ['dig', 'Dig (tag)'], ['hand', '✋ Hand'], ['treasury', 'Treasury ' + TERRAIN[T.TREASURY].cost + 'g/tile'], ['lair', 'Lair ' + TERRAIN[T.LAIR].cost + 'g/tile'],
  ['door', 'Door ' + DOOR.cost + 'g'], ['gas', 'Gas Trap ' + TRAPS.gas.cost + 'g'], ['bolt', 'Lightning ' + TRAPS.bolt.cost + 'g'],
  ['sp1', '⏸ Pause'], ['sp2', '1×'], ['sp3', '3×'], ['sp4', '8×'] ];
for (const [id, label] of TOOLS) { const b = document.createElement('button'); b.textContent = label; b.id = 'b_' + id; b.onclick = () => {
  if (id.startsWith('sp')) { G.speed = [0, 1, 3, 8][+id[2] - 1]; } else tool = id; refreshButtons(); }; $('tools').appendChild(b); }
function refreshButtons() { for (const [id] of TOOLS) { const b = $('b_' + id); b.classList.toggle('on', id === tool || (id.startsWith('sp') && [0, 1, 3, 8][+id[2] - 1] === G.speed)); } }
function posF(e) { const r = cv.getBoundingClientRect(); return { fx: (e.clientX - r.left) / r.width * W, fy: (e.clientY - r.top) / r.height * H }; }
function pos(e) { const r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(W - 1, Math.floor((e.clientX - r.left) / r.width * W))), y: Math.max(0, Math.min(H - 1, Math.floor((e.clientY - r.top) / r.height * H))) }; }
/* Input is expressed in world terms ({x,y} tile, {fx,fy} float tile coords) so the 2D and the 3D view share it. */
function inputDown(p, f, button) { mouse = { x: p.x, y: p.y, sx: p.x, sy: p.y, down: button === 2 ? 3 : 1, fx: f.fx, fy: f.fy }; }
function inputMove(p, f) { mouse.x = p.x; mouse.y = p.y; mouse.fx = f.fx; mouse.fy = f.fy; }
function inputUp(p, f) {
  if (!mouse.down) return; const right = mouse.down === 3;
  if (tool === 'hand') { if (!right) handClick(f); }
  else if (tool === 'dig') tagRect(mouse.sx, mouse.sy, p.x, p.y, !right);
  else if (tool === 'door' || tool === 'gas' || tool === 'bolt') { if (right) removeThings(mouse.sx, mouse.sy, p.x, p.y); else placeThings(tool, mouse.sx, mouse.sy, p.x, p.y); }
  else if (!right) build(tool === 'treasury' ? T.TREASURY : T.LAIR, mouse.sx, mouse.sy, p.x, p.y);
  mouse.down = 0;
}
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => { inputDown(pos(e), posF(e), e.button); cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => inputMove(pos(e), posF(e)));
cv.addEventListener('pointerleave', () => { if (!mouse.down) mouse.x = -1; });
cv.addEventListener('pointerup', e => inputUp(pos(e), posF(e)));

/* The Hand: pick up one of your imps/creatures and drop it elsewhere (GameWorldController pick-up / drop, `InHand`). */
function handClick(m) {
  const held = G.held;
  if (held) {
    if (solid(Math.floor(m.fx), Math.floor(m.fy))) { say('Can\'t drop it into solid rock.'); return; }
    held.x = m.fx; held.y = m.fy; held.held = false; held.state = 'idle'; held.path = null; held.think = 0; G.held = null; return;
  }
  let best = null, bd = 1.3;
  for (const u of G.creatures.concat(G.imps)) { const d = Math.hypot(u.x - m.fx, u.y - m.fy); if (!u.dead && d < bd) { best = u; bd = d; } }
  if (!best) return;
  if (best.isImp) best.drop(); best.held = true; best.path = null; G.held = best;
}
function renderLog(isNew) { const el = $('log'); el.innerHTML = G.log.slice(0, 12).map((m, i) => '<div' + (i === 0 && isNew ? ' class="new"' : '') + '>' + m + '</div>').join(''); }
function renderHud() {
  $('hGold').textContent = Math.floor(G.gold); $('hCap').textContent = capacity(); $('hImps').textContent = G.imps.length;
  $('hCreatures').textContent = G.creatures.length; $('hMax').textContent = VAR.CREATURES_SUPPORTED_BY_FIRST_PORTAL;
  $('hPay').textContent = Math.max(0, Math.ceil(G.nextPay)); $('hTime').textContent = Math.floor(G.time);
  $('hHeart').textContent = Math.ceil(G.heartHp); $('hHeroes').textContent = G.heroes.length; $('hWave').textContent = G.wave + '/' + VAR.WAVES;
  $('hNext').textContent = !G.gateOpen ? 'tunnel to Gate' : G.nextWave === Infinity ? '—' : Math.max(0, Math.ceil(G.nextWave - G.time)) + 's';
  let dig = 0, claim = 0, busy = 0, upkeep = 0; for (const t of G.tasks.values()) { if (t.type === 'DIG') dig++; else if (t.type === 'CLAIM') claim++; else upkeep++; if (t.who.size) busy++; }
  const mood = G.creatures.map(c => c.name + ' #' + c.id + ' Lv' + c.level + ' ' + Math.ceil(c.hp) + '/' + c.maxHp + 'hp: ' + c.mood + (c.lair ? '' : ' (no bed)')).join('<br>');
  $('tasks').innerHTML = 'Dig tiles <b>' + dig + '</b> · Claim tiles <b>' + claim + '</b> · Repair/rearm <b>' + upkeep + '</b> · in progress <b>' + busy + '</b><br>' +
    'Idle imps <b>' + G.imps.filter(i => i.state === 'idle').length + '</b>/' + G.imps.length + '<br><span style="color:var(--dim)">' + (mood || 'No creatures yet — dig east and claim the purple portal.') + '</span>';
}

genMap(); scanTasks();
for (let i = 0; i < 3; i++) G.imps.push(new Imp(G.heart.x - 1 + i, G.heart.y + 2));
say('Welcome, Keeper. Tag earth near the Heart; dig east to the portal.');
refreshButtons();

let last = performance.now(), acc = 0; const DT = 1 / 20;           // ticksPerSec analogue
let lastFrame = performance.now(); const DT_FRAME = (now) => { const d = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; return d; };
function frame(now) {
  acc += Math.min(0.25, (now - last) / 1000) * G.speed; last = now;
  while (acc >= DT) { step(DT); acc -= DT; }
  if (window.__render3d) window.__render3d(DT_FRAME(now)); else draw();
  renderHud(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__ui = { get mouse() { return mouse; }, get tool() { return tool; }, inputDown, inputMove, inputUp };
window.__game = { TRAPS, DOOR, placeThings, removeThings, doorAt, trapAt, HERO_LAND, W, H, G, HEROES, KINDS, spawnWave, Creature, Imp, Hero, hurt, los, T, TERRAIN, step, tagRect, build, scanTasks, findPath, capacity, goldReleased, damageTile, perApplication, VAR };
