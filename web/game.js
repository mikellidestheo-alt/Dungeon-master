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

/* ---- the level: plain data from levels.js (docs/06-levels.md). Pick one with ?level=<id>. ---- */
const LEVEL_TABLE = window.LEVELS || {};
const LV = LEVEL_TABLE[new URLSearchParams(location.search).get('level')] || LEVEL_TABLE[window.DEFAULT_LEVEL] || Object.values(LEVEL_TABLE)[0];
function levelSize(lv) { const g = lv.terrain.grid; return g ? [g[0].length, g.length] : lv.terrain.size; }
function levelPos(lv) {                                // centres of the Heart, Portal and Gate(s): explicit, or read off a grid's H / P / X markers
  const g = lv.terrain.grid; if (!g) return { heart: lv.heart, portal: lv.portal || null, gates: lv.gates || [] };
  const find = (c) => { const out = []; g.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === c) out.push([x, y]); }); return out; };
  return { heart: find('H')[0], portal: find('P')[0] || null, gates: find('X') };
}
const POS = levelPos(LV);
const W = levelSize(LV)[0], H = levelSize(LV)[1], TS = 20;     // map size in tiles, pixels per tile
const VAR = {                                         // Variable.MiscVariable.MiscType
  DIG_ROCK_HEALTH: 5000, MINE_GOLD_HEALTH: 300, CLAIM_TILE_HEALTH: 825,
  GOLD_MINED_FROM_GEMS: 25, MAX_GOLD_PER_TREASURY_TILE: 3000,
  MODIFY_ANGER_OF_CREATURE_IN_LAIR_PER_SECOND: -550,
  MINIMUM_IMP_THRESHOLD: 4, TIME_BEFORE_FREE_IMP_GENERATED_SECONDS: 5,
  CREATURES_SUPPORTED_BY_FIRST_PORTAL: 15,
  PAY_DAY_FREQUENCY_SECONDS: 90,                      // stock is 600; shortened so you see it
  IMP_EFFICIENCY: 80,                                 // TileWork.FULL_EFFICIENCY comment: "80% for a fresh imp"
  IMP_MAX_GOLD: 400,
  HUNGRY_AT: 60, HUNGER_PER_SECOND: 0.5, HUNGER_ANGER_PER_SECOND: 8,    // a fed creature is hungry again after about two minutes
  CHICKEN_SECONDS: 24, MAX_CHICKENS: 12,                                // CHICKEN_GENERATION_TIME_PER_HATCHERY 16 / MAX_FREE_RANGE_CHICKENS_PER_PLAYER 12 in the stock levels
  EAT_SECONDS: 2.5, PRAY_SECONDS: 15,                                   // MOTIONLESS_WHILE_PRAYING_SECONDS is 30 in the stock levels
  STUDY_SECONDS: 20,                                  // MOTIONLESS_WHILE_RESEARCHING_SECONDS is 70 in the stock levels
  CREATURE_SLEEPS_WHEN_BELOW_PERCENT_HEALTH: 50,      // stock value, drives "go heal in your lair"
  OWN_LAND_HEALTH_INCREASE_PER_SECOND: 0.8,           // Creature.Attributes.ownLandHealthIncrease, scaled to our hp
  HEART_HEALTH: 2500,
  WAVES: 5, FIRST_WAVE_DELAY: 75, WAVE_INTERVAL: 110, // hero gate invasions (tuning)
  HEAR_DISTANCE: 14,                                  // Attributes.distanceCanHear: keepers sense heroes on own land
  XP_PER_KILL: 1, XP_PER_LEVEL: 3, MAX_LEVEL: 5,      // CreatureExperienceSystem, reduced
};

/* ---- terrain table (Terrain.kwd analogue). flags: S solid, I impenetrable, O ownable, T taggable ---- */
const T = { ROCK: 0, EARTH: 1, GOLD: 2, GEM: 3, PATH: 4, TREASURY: 5, LAIR: 6, HEART: 7, PORTAL: 8, GATE: 9, PRISON: 10, TORTURE: 11, LIBRARY: 12, HATCHERY: 13, TEMPLE: 14 };
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
  { name: 'Prison',   solid: 0, own: 1, room: 1, maxHealth: 1000, cost: 100 },
  { name: 'Torture Chamber', solid: 0, own: 1, room: 1, maxHealth: 1000, cost: 150 },
  { name: 'Library',  solid: 0, own: 1, room: 1, maxHealth: 1000, cost: 120 },
  { name: 'Hatchery', solid: 0, own: 1, room: 1, maxHealth: 1000, cost: 80 },
  { name: 'Temple',   solid: 0, own: 1, room: 1, maxHealth: 1000, cost: 120 },
];

/* ---- tiny seeded RNG so levels are reproducible (?seed=123) ---- */
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const WV = LV.waves || {};
Object.assign(VAR, { HEART_HEALTH: LV.rules.heartHp, WAVES: WV.endless ? Infinity : (WV.plan || []).length, FIRST_WAVE_DELAY: WV.prep === undefined ? 75 : WV.prep, WAVE_INTERVAL: WV.interval || 110 });   // the level sets the invasion's pace
const qs = new URLSearchParams(location.search);
const rand = rng(parseInt(qs.get('seed') || LV.seed || '7', 10));

/* ===================================================================================== world */
const G = {
  map: [], time: 0, speed: 1, gold: LV.start.gold, imps: [], creatures: [], tasks: new Map(),
  nextImp: 0, nextSpawn: 20, nextPay: VAR.PAY_DAY_FREQUENCY_SECONDS, scanT: 0, log: [],
  portalOwned: false, heart: { x: POS.heart[0], y: POS.heart[1] }, portal: POS.portal && { x: POS.portal[0], y: POS.portal[1] },
  gates: POS.gates.map(g => ({ x: g[0], y: g[1], open: false })), gate: null,
  heroes: [], prisoners: [], shots: [], fx: [], doors: [], traps: [], clouds: [], mana: LV.start.mana, maxMana: 1000, manaRate: 3, spellCd: {}, rally: null, ownedTiles: 0, manaT: 0, research: { current: LV.start.research || null, points: {}, done: {} }, chickens: [], hatchT: 0, hatchTiles: [], hatchScan: 0, heartHp: VAR.HEART_HEALTH, heartFlash: 0, gateOpen: false, gateT: 0,
  wave: 0, nextWave: Infinity, over: null, kills: 0, held: null, nextId: 0,
  stats: { dug: 0, mined: 0, claimed: 0, spells: 0 }, objDone: {}, objProg: {}, guideStep: 0, guideHidden: false,   // counters the objectives read; which objectives are done; where the tutorial guide is
};
G.gate = G.gates[0] || null;                          // the first Hero Gate (the one a single-Gate level has); G.gates holds them all, each with its own `open` flag
const idx = (x, y) => y * W + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const tile = (x, y) => inb(x, y) ? G.map[idx(x, y)] : null;
const solid = (x, y) => { const t = tile(x, y); return !t || TERRAIN[t.t].solid; };
function setTerrain(t, id) { t.t = id; t.hp = TERRAIN[id].maxHealth; t.tag = 0; if (TERRAIN[id].solid !== 1) { t.owner = t.owner; } }
function say(msg) { G.log.unshift(msg); if (G.log.length > 40) G.log.pop(); renderLog(true); }
const sfx = (id, x, y, o) => { if (window.Sound) Sound.play(id, x, y, o); };      // audio.js. Never touches rand(), so sound on/off cannot change a seeded run

/* ---- building the world from the level data (docs/06-levels.md). Two terrain sources: random blobs, or a hand-drawn text grid. ---- */
const OWNER = { keeper: 1, none: 0, hero: HERO_LAND };
function buildMap() {
  const tl = LV.terrain, fresh = (t, owner = 0, hp = null) => ({ t, owner, hp: hp === null ? TERRAIN[t].maxHealth : hp, gold: TERRAIN[t].goldValue || 0, tag: 0, stored: 0, room: 0 });
  const carve = (x0, y0, x1, y1, owner) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = G.map[idx(x, y)]; t.t = T.PATH; t.hp = owner ? 1000 : 0; t.owner = owner; t.gold = 0; } };
  const room = (cx, cy, id, owner) => { for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) {
    const t = G.map[idx(x, y)]; t.t = id; t.hp = 1000; t.owner = owner; t.room = cx * 100 + cy; } };
  if (tl.grid) {                                          // legend: # rock . earth g gold G gem _ floor o your floor h hero land, H P X room centres
    const CH = { '#': () => fresh(T.ROCK), '.': () => fresh(T.EARTH), g: () => fresh(T.GOLD), G: () => fresh(T.GEM), _: () => fresh(T.PATH, 0, 0), o: () => fresh(T.PATH, 1, 1000), h: () => fresh(T.PATH, HERO_LAND, 1000) };
    CH.H = CH.P = CH.X = CH._;
    tl.grid.forEach((row, y) => { for (let x = 0; x < W; x++) { const mk = CH[row[x]]; if (!mk) console.warn('level grid: unknown character "' + row[x] + '" at ' + x + ',' + y); G.map[idx(x, y)] = (mk || CH['.'])(); } });
  } else {                                                // random terrain: solid earth with a rock border, then blobs of rock, gold and gems (same call order as always, so seeds stay reproducible)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      G.map[idx(x, y)] = { t: border ? T.ROCK : T.EARTH, owner: 0, hp: border ? 1 : 12000, gold: 0, tag: 0, stored: 0, room: 0 };
    }
    const blob = (cx, cy, r, id) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (inb(x, y) && x > 0 && y > 0 && x < W - 1 && y < H - 1 && Math.hypot(x - cx, y - cy) <= r + rand() * 0.9 && G.map[idx(x, y)].t === T.EARTH) {
          const t = G.map[idx(x, y)]; t.t = id; t.hp = TERRAIN[id].maxHealth; t.gold = TERRAIN[id].goldValue || 0; } } };
    const gen = tl.generate, scatter = (o, id) => { for (let i = 0; i < o.count; i++) blob(o.x + (rand() * o.xSpan | 0), o.y + (rand() * o.ySpan | 0), o.rMin + (o.rSpan ? (rand() * o.rSpan | 0) : 0), id); };
    scatter(gen.rock, T.ROCK); scatter(gen.gold, T.GOLD);
    for (const gm of gen.gems || []) blob(gm.x, gm.y, gm.r, T.GEM);
    for (const c of tl.caverns || []) carve(...c.rect, OWNER[c.owner]);
  }
  room(G.heart.x, G.heart.y, T.HEART, 1);
  if (G.portal) room(G.portal.x, G.portal.y, T.PORTAL, 0);
  for (const gt of G.gates) room(gt.x, gt.y, T.GATE, HERO_LAND);       // hero land: not claimable, heroes arrive once a tunnel links it to you
  for (const [x, y] of LV.start.pretag || []) { const t = tile(x, y); if (t && TERRAIN[t.t].tag) t.tag = 1; }    // a few first tiles are already tagged for the lazy
}

/* Checks a level's data and returns a list of problems (empty = fine). Used at start-up and by the tests.
 * The Portal and the Hero Gate(s) are optional: a level without a Gate has no invasion and is won by its objectives. */
function validateLevel(lv) {
  const errs = [], need = (c, m) => { if (!c) errs.push(m); };
  need(lv && lv.id, 'missing id'); if (!lv || !lv.terrain) return errs.concat('missing terrain');
  need(lv.terrain.grid || (lv.terrain.size && lv.terrain.generate), 'terrain needs a grid, or size + generate');
  const [w, h] = levelSize(lv), pos = levelPos(lv), inside = (p, m) => need(p && p[0] >= 2 && p[1] >= 2 && p[0] <= w - 3 && p[1] <= h - 3, m + ' must lie inside the map with room for its 3x3 pad');
  if (lv.terrain.grid) need(lv.terrain.grid.every(r => r.length === w), 'every grid row must be as long as the first');
  const plan = (lv.waves && lv.waves.plan) || [], endless = !!(lv.waves && lv.waves.endless), objs = lv.objectives || [], gates = pos.gates || [];
  inside(pos.heart, 'the Heart'); if (pos.portal) inside(pos.portal, 'the Portal'); gates.forEach((g, i) => inside(g, 'Hero Gate ' + (i + 1)));
  need(plan.length || endless || objs.some(o => !o.optional), 'the level needs a way to win: a non-empty waves.plan or some objectives');
  need(!(plan.length || endless) || gates.length, 'waves need at least one Hero Gate for the heroes to arrive from');
  plan.forEach((wv, i) => wv.forEach(nm => need(HEROES.some(k => k.name === nm), 'wave ' + (i + 1) + ': no hero called ' + nm)));
  need(!lv.waves || (lv.waves.prep >= 0 && lv.waves.interval > 0), 'waves.prep and waves.interval'); need(lv.start && typeof lv.start.gold === 'number', 'start.gold'); need(lv.rules && lv.rules.heartHp > 0, 'rules.heartHp');
  if (lv.stars) { need(lv.stars.heart === undefined || (lv.stars.heart > 0 && lv.stars.heart <= 1), 'stars.heart must be between 0 and 1'); need(lv.stars.par === undefined || lv.stars.par > 0, 'stars.par must be positive seconds'); }
  const cond = (c, where) => {                                   // an objective or a guide condition
    const d = c && COND[c.type]; if (!d) { errs.push(where + ': unknown condition type "' + (c && c.type) + '"'); return; }
    for (const k of d.params || []) need(c[k] !== undefined, where + ': "' + c.type + '" needs ' + k);
    if (d.params && d.params.includes('n')) need(c.n > 0, where + ': n must be positive');
    if (c.room) need(ROOM_TOOLS[c.room], where + ': no room called ' + c.room); if (c.item) need(RESEARCH[c.item], where + ': nothing to research called ' + c.item);
    if (c.kind) need(KINDS.some(k => k.name === c.kind), where + ': no creature called ' + c.kind);
    if (d.needs === 'waves') need(plan.length, where + ': "' + c.type + '" needs waves.plan'); if (d.needs === 'gate') need(gates.length >= (c.n || 1), where + ': "' + c.type + '" needs ' + (c.n > 1 ? c.n + ' Hero Gates' : 'a Hero Gate')); if (d.needs === 'portal') need(pos.portal, where + ': "' + c.type + '" needs a Portal');
  };
  objs.forEach((o, i) => cond(o, 'objective ' + (i + 1)));
  (lv.guide || []).forEach((g, i) => { need(g && g.text, 'guide step ' + (i + 1) + ' needs text'); if (g && g.when) cond(g.when, 'guide step ' + (i + 1)); if (g && g.tool) need(TOOLS.some(t => t[0] === g.tool), 'guide step ' + (i + 1) + ': no tool called ' + g.tool);
    if (g && g.at) need((g.at.length === 2 || g.at.length === 4) && g.at.every((v, k) => v >= 0 && v < (k % 2 ? h : w)), 'guide step ' + (i + 1) + ': `at` must be [x, y] or [x0, y0, x1, y1] inside the map'); });
  return errs;
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
    released = t.gold - ng; t.gold = ng; t.hp = nh; destroyed = nh === 0; G.stats.mined += released;
  } else if (tr.imp) {                           // gems never run out: collapse, refill, pay a little
    t.hp -= dmg; if (t.hp <= 0) { t.hp = tr.maxHealth; released = VAR.GOLD_MINED_FROM_GEMS; sfx('coin', x + .5, y + .5); }
  } else { t.hp -= dmg; destroyed = t.hp <= 0; }
  if (destroyed) { setTerrain(t, tr.destroyedTo); t.gold = 0; G.dirty = true; G.stats.dug++; sfx('crumble', x + .5, y + .5); }
  return released;
}
function claimable(x, y) {                       // ClaimTileTask: unowned floor next to our territory
  const t = tile(x, y); if (!t || TERRAIN[t.t].solid || t.owner === 1 || t.owner === HERO_LAND) return false;
  if (t.t === T.PORTAL && !(G.portal && x === G.portal.x && y === G.portal.y)) return false;
  return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => { const n = tile(x + dx, y + dy); return n && n.owner === 1 && !TERRAIN[n.t].solid; })
    || (t.t === T.PORTAL && [[2,0],[-2,0],[0,2],[0,-2],[1,1],[-1,1],[1,-1],[-1,-1],[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[-1,2],[1,-2],[-1,-2]].some(([dx,dy]) => { const n = tile(x+dx, y+dy); return n && n.owner === 1 && !TERRAIN[n.t].solid; }));
}
function healClaim(x, y, dt, eff) {
  const t = tile(x, y); t.hp = Math.min(TERRAIN[t.t].maxHealth, t.hp + perApplication(VAR.CLAIM_TILE_HEALTH, eff) * dt);
  if (t.hp >= TERRAIN[t.t].maxHealth) {
    if (t.t === T.PORTAL) { for (const q of G.map) if (q.t === T.PORTAL) q.owner = 1; G.portalOwned = true; say('Portal claimed — creatures will arrive.'); sfx('portal', x + .5, y + .5); }
    else { t.owner = 1; G.stats.claimed++; sfx('claim', x + .5, y + .5); }
    G.dirty = true;
  }
}

/* ===================================================================================== task board
 * TaskManager.scanTerrainTasks: one tile-task per tile per player, created/removed as the map changes. */
const TASK = { DIG: { prio: 10, max: 3 }, CLAIM: { prio: 6, max: 1 }, REPAIR: { prio: 7, max: 2 }, REARM: { prio: 5, max: 1 },
  RESCUE: { prio: 11, max: 1 }, CAPTURE: { prio: 11, max: 1 }, HAUL: { prio: 5, max: 1 } };   // RescueCreatureTask / CaptureEnemyCreatureTask / CarryEnemyCreatureToPrison   // RepairWallTileTask / workshop crates analogues
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
  const add = (type, x, y, body) => { const key = type + ':' + x + ',' + y + (body ? ':' + body.id : ''); live.add(key); if (!G.tasks.has(key)) G.tasks.set(key, { key, type, x, y, who: new Set(), body }); };
  for (const c of G.creatures) if (c.unconscious && !c.carriedBy && !c.dead) add('RESCUE', c.tx, c.ty, c);                 // TaskManager.processAddedUnconsciousEntities
  for (const h of G.heroes) if (h.unconscious && !h.carriedBy && !h.dead && freeSlot(T.PRISON, h)) add('CAPTURE', h.tx, h.ty, h);
  for (const b of G.prisoners) if (b.status === 'prisoner' && !b.carriedBy && freeSlot(T.TORTURE, b)) add('HAUL', b.tx, b.ty, b);
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
    let left = this.speed * dt * mult * (this.haste > 0 ? 1.6 : 1); this.blocker = null;
    while (this.path && this.path.length && left > 0) {
      const n = this.path[0];
      if (this.team === 'h' && this.state !== 'flee' && !this.flying) {       // a closed door stops invaders until it is smashed; keepers walk through
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
    Object.assign(this, { hp: 40, maxHp: 40, team: 'k', dead: false, flash: 0, held: false, scare: 0, isImp: true, carry: null, carryType: null, sprite: 'imp' }); }
  drop() {
    if (this.task) this.task.who.delete(this); this.task = null; this.state = 'idle'; this.path = null;
    if (this.carry) {                                                     // put the body down where we stand
      const b = this.carry; b.carriedBy = null; this.carry = null; if (this.dest && this.dest.t) this.dest.t.reserved = null; this.dest = null;
      if (b.homeCell) { b.cell = b.homeCell; b.cell.occ = b; b.homeCell = null; b.x = b.cell.cx + .5; b.y = b.cell.cy + .5; }     // a dropped prisoner goes back to its cell
    }
  }
  assign(task, path) { this.task = task; task.who.add(this); this.state = 'toTask'; this.go(path); }
  update(dt) {
    if (this.dead || this.held) return;
    this.flash = Math.max(0, this.flash - dt);
    if (this.state === 'flee') {                                          // Attributes.ALWAYS_FLEE: imps never fight
      if (this.stepMove(dt, 1.4)) { this.state = 'idle'; this.think = 0.5; }
      return;
    }
    this.chat = (this.chat === undefined ? 3 + Math.random() * 6 : this.chat) - dt;
    if (this.chat <= 0) { this.chat = 8 + Math.random() * 10; sfx('imp', this.x, this.y); }
    this.scare -= dt;
    if (this.scare <= 0) {
      this.scare = 0.3; const h = nearestFoe(this, 6, true);
      if (h) { this.drop(); const p = findPath(this.tx, this.ty, G.heart.x, G.heart.y + 2); if (p && p.length) { this.state = 'flee'; this.go(p); sfx('imp_scream', this.x, this.y); return; } }
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
      if (this.task.body && (this.task.body.carriedBy || this.task.body.dead)) return this.drop();
      if (this.stepMove(dt)) this.state = 'work';
    } else if (this.state === 'work') {
      const k = this.task; if (!k || !G.tasks.has(k.key)) return this.drop();
      if (k.body && (k.body.carriedBy || k.body.dead)) return this.drop();
      if (k.type === 'DIG') {
        if (this.gold >= VAR.IMP_MAX_GOLD && !this.hasRoomFor()) return this.drop();
        this.digT = (this.digT || 0) - dt;
        if (this.digT <= 0) { this.digT = 0.55; sfx(tile(k.x, k.y).gold > 0 ? 'mine' : 'dig', k.x + .5, k.y + .5); }
        const got = damageTile(k.x, k.y, dt, VAR.IMP_EFFICIENCY);
        this.gold += got; this.face = Math.atan2(k.y + 0.5 - this.y, k.x + 0.5 - this.x);
        if (this.gold >= VAR.IMP_MAX_GOLD) { this.drop(); this.think = 0; }
      } else if (k.type === 'REPAIR') {
        const d = doorAt(k.x, k.y); if (!d || d.dead || d.hp >= d.maxHp) return this.drop();
        d.hp = Math.min(d.maxHp, d.hp + 40 * VAR.IMP_EFFICIENCY / 100 * dt);
      } else if (k.type === 'REARM') {
        const tr = trapAt(k.x, k.y), def = tr && TRAPS[tr.kind]; if (!tr || tr.charges >= tr.max || G.gold < def.rearmCost) return this.drop();
        tr.prog = (tr.prog || 0) + dt; if (tr.prog >= def.rearm) { tr.prog = 0; tr.charges++; G.gold -= def.rearmCost; }
      } else if (k.body) {                                                // pick the body up and haul it to its destination
        const b = k.body; if (k.type !== 'HAUL' && !b.unconscious) return this.drop();
        const d = k.type === 'RESCUE' ? lairSpot(b) : freeSlot(k.type === 'CAPTURE' ? T.PRISON : T.TORTURE, b);
        const p = d && findPath(this.tx, this.ty, d.x, d.y); if (!p) return this.drop();
        if (k.type === 'HAUL' && b.cell) { b.homeCell = b.cell; b.cell.occ = null; b.cell = null; }
        d.t.reserved = b; b.carriedBy = this; this.carry = b; this.dest = d; this.carryType = k.type;
        k.who.delete(this); this.task = null; this.state = 'carry'; this.go(p);
      } else healClaim(k.x, k.y, dt, VAR.IMP_EFFICIENCY);
    } else if (this.state === 'carry') {
      const b = this.carry; if (!b || b.dead) { this.carry = null; this.state = 'idle'; return; }
      const arrived = this.stepMove(dt); b.x = this.x; b.y = this.y;
      if (arrived) { const d = this.dest, type = this.carryType; this.carry = null; this.dest = null; this.state = 'idle'; this.think = 0.2; dropOff(b, d, type); }
    } else if (this.state === 'deliver') {
      if (this.stepMove(dt)) {
        const space = capacity() - G.gold, put = Math.max(0, Math.min(this.gold, space));
        G.gold += put; this.gold -= put; this.state = 'idle'; this.think = 0.2;
        if (put) { sfx('coins', this.x, this.y); const t = tile(this.tx, this.ty); if (t) t.stored = Math.min(VAR.MAX_GOLD_PER_TREASURY_TILE, t.stored + put); }
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
      if (task.body && (task.body.carriedBy || (task.type === 'CAPTURE' && !freeSlot(T.PRISON, task.body)) || (task.type === 'HAUL' && !freeSlot(T.TORTURE, task.body)))) continue;
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
  { name: 'Goblin',  color: '#6fbf4f', pay: 60,  hp: 80,  dmg: 8,  range: 1.2, cdMax: 1.0, ranged: 0, research: 0.7, weight: 3,   sprite: 'goblin', elite: 'goblin_elite' },
  { name: 'Troll',   color: '#b08850', pay: 90,  hp: 170, dmg: 12, range: 1.2, cdMax: 1.2, ranged: 0, research: 0.4, weight: 2,   sprite: 'troll', elite: 'troll_elite' },
  { name: 'Warlock', color: '#a070e0', pay: 120, hp: 65,  dmg: 14, range: 5,   cdMax: 1.6, ranged: 1, research: 1.6, weight: 2,   sprite: 'warlock' },
  // added with the character art; elite = the sprite shown from level 3. Appended so the first three keep their positions.
  { name: 'Dark Elf',   color: '#7a5aa0', pay: 110, hp: 60,  dmg: 10, range: 6,   cdMax: 1.1, ranged: 1, research: 0.5, weight: 1.5, speed: 1.9, sprite: 'darkelf', elite: 'darkelf_elite' },
  { name: 'Bile Demon', color: '#6a8a3a', pay: 150, hp: 260, dmg: 15, range: 1.3, cdMax: 1.5, ranged: 0, research: 0.2, weight: 1,   speed: 1.1, sprite: 'bile', elite: 'bile_elite' },
  { name: 'Vampire',    color: '#a02040', pay: 160, hp: 90,  dmg: 18, range: 4.5, cdMax: 1.7, ranged: 1, research: 1.0, weight: 1,   speed: 1.5, sprite: 'vampire', elite: 'vampire_elite' },
  { name: 'Salamander', color: '#e07a30', pay: 130, hp: 130, dmg: 14, range: 1.2, cdMax: 1.1, ranged: 0, research: 0.3, weight: 1,   speed: 1.6, sprite: 'salamander', elite: 'salamander_elite' },
  { name: 'Spider',     color: '#4a3a5a', pay: 100, hp: 75,  dmg: 9,  range: 1.2, cdMax: 0.8, ranged: 0, research: 0.3, weight: 1,   speed: 2.2, sprite: 'spider' },
  // second batch, each with a trick of its own
  { name: 'Mistress',     color: '#c03070', pay: 140, hp: 85,  dmg: 10, range: 1.6, cdMax: 0.9, ranged: 0, research: 0.3, weight: 1,   speed: 1.8, sprite: 'mistress', torturer: true },      // speeds up the rack
  { name: 'Assassin',     color: '#40455a', pay: 120, hp: 55,  dmg: 12, range: 1.2, cdMax: 0.7, ranged: 0, research: 0.2, weight: 1,   speed: 2.5, sprite: 'assassin', elite: 'rogue', ambush: true },   // double damage on a healthy target
  { name: 'Black Knight', color: '#555a70', pay: 170, hp: 200, dmg: 12, range: 1.2, cdMax: 1.2, ranged: 0, research: 0.3, weight: 1,   speed: 1.3, sprite: 'black_knight', elite: 'fire_knight', armor: 0.25 },   // takes a quarter less damage
  { name: 'Fly',          color: '#d0a030', pay: 70,  hp: 40,  dmg: 6,  range: 4,   cdMax: 0.7, ranged: 1, research: 0.1, weight: 1.5, speed: 2.8, sprite: 'wasp', elite: 'firefly', flying: true },     // hovers; fast and fragile
  { name: 'Reaper',       color: '#b02828', pay: 200, hp: 220, dmg: 20, range: 1.3, cdMax: 1.4, ranged: 0, research: 0.1, weight: 0.5, speed: 1.5, sprite: 'reaper', cleave: true },       // scythe hits the neighbours too
  { name: 'Dark Angel',   color: '#4a3a8a', pay: 220, hp: 150, dmg: 15, range: 5,   cdMax: 1.4, ranged: 1, research: 0.8, weight: 0.4, speed: 1.7, sprite: 'dark_angel', elite: 'dark_angel_elite', heals: true, flying: true },   // patches up wounded allies
];
const PRAY = { Goblin: 0.5, Troll: 0.3, Warlock: 1.4, 'Dark Elf': 0.8, 'Bile Demon': 0.3, Vampire: 1.2, Salamander: 0.4, Spider: 0.3, Mistress: 0.6, Assassin: 0.2, 'Black Knight': 0.3, Fly: 0.2, Reaper: 0.2, 'Dark Angel': 1.0 };   // Attributes.manaGenPrayer
for (const k of KINDS) k.pray = PRAY[k.name];
function pickKind() {                              // portal arrivals, weighted so the common kinds show up more
  let r = rand() * KINDS.reduce((s, k) => s + k.weight, 0);
  for (const k of KINDS) { r -= k.weight; if (r <= 0) return k; }
  return KINDS[0];
}
const spriteOf = (u) => (u.level >= 3 && u.elite) ? u.elite : u.sprite;      // level-ups swap in the elite art
class Creature extends Mover {                    // CreatureMoodSystem / CreatureSleepSystem: reduced to one lair + payday
  constructor(x, y, kind) { super(x, y, 1.6); Object.assign(this, kind); this.energy = 100 + (rand() * 0 | 0); this.anger = 0; this.lair = null; this.state = 'idle'; this.wait = 1;
    this.id = ++Creature.n; this.energy = 70 + rand() * 30;
    Object.assign(this, { hunger: rand() * 30, victim: null, tortureThink: 0, chicken: null, eatT: 0, foodThink: 0, prayThink: 0, desk: null, studyT: 0, studyThink: 0, maxHp: kind.hp, team: 'k', cd: 0, haste: 0, sight: 7, level: 1, xp: 0, rep: 0, dead: false, flash: 0, held: false }); }
  get mood() { return this.anger >= 1600 ? 'angry' : this.anger >= 800 ? 'unhappy' : 'content'; }
  releaseDesk() { if (this.desk) { this.desk.occ = null; this.desk = null; } }
  releaseVictim() { if (this.victim) { if (this.victim.tormentor === this) this.victim.tormentor = null; this.victim = null; } }
  releaseChicken() { if (this.chicken) { this.chicken.claimedBy = null; this.chicken.frozen = false; this.chicken = null; } }
  update(dt) {
    if (this.dead || this.held) return;
    this.flash = Math.max(0, this.flash - dt);
    if (this.desk && !['research', 'toDesk', 'pray', 'toAltar'].includes(this.state)) this.releaseDesk();   // anything that interrupts studying or praying frees the seat
    if (this.chicken && this.state !== 'toFood' && this.state !== 'eat') this.releaseChicken();
    if (this.victim && this.state !== 'toRack' && this.state !== 'torture') this.releaseVictim();
    if (this.unconscious) { if (!this.carriedBy) { this.uTime -= dt; if (this.uTime <= 0) { say(this.name + ' #' + this.id + ' bled out.'); kill(this, null); } } return; }
    if (this.heals) {                                                     // Dark Angel: patch up wounded creatures nearby
      this.healCd = Math.max(0, (this.healCd || 0) - dt);
      const ally = this.healCd <= 0 && G.creatures.find(c => c !== this && !c.dead && !c.unconscious && c.hp < c.maxHp * 0.7 && dist(this, c) <= 5 && los(this.x, this.y, c.x, c.y));
      if (ally) { ally.hp = Math.min(ally.maxHp, ally.hp + 20); this.healCd = 3; G.fx.push({ x: ally.x, y: ally.y - 0.4, txt: '+20', life: 0.7, color: '#8fffa0' }); G.fx.push({ x: ally.x, y: ally.y, ring: true, r: 0.9, color: '#8fffa0', life: 0.5, max: 0.5 }); }
    }
    if (this.state !== 'sleep') this.energy -= 1.4 * dt;
    if (!this.noFood) { this.hunger += VAR.HUNGER_PER_SECOND * dt; if (this.hunger >= VAR.HUNGRY_AT) this.anger += VAR.HUNGER_ANGER_PER_SECOND * dt; }   // REASON_NO_FOOD
    if (!this.lair && !this.noLair) {             // REASON_NO_LAIR: anger accrues until a bed is assigned
      this.anger += 25 * dt; const bed = freeBed(); if (bed) { bed.occupant = this; this.lair = bed; say(this.name + ' #' + this.id + ' claimed a bed.'); }
    }
    if (this.anger >= 3000) { say(this.name + ' #' + this.id + ' is furious and leaves your dungeon!'); if (this.lair) this.lair.occupant = null; this.releaseDesk(); this.releaseChicken(); this.releaseVictim(); return 'leave'; }
    if (fightBrain(this, dt)) return;                                     // CreatureState: shouldFleeOrAttack comes first
    if (this.hp < this.maxHp)                                             // own-land regen, much faster asleep in the lair
      this.hp = Math.min(this.maxHp, this.hp + (this.state === 'sleep' ? 8 : VAR.OWN_LAND_HEALTH_INCREASE_PER_SECOND) * dt);
    if (G.rally && G.time < G.rally.until) {                             // Call to Arms: drop everything and gather at the flag
      this.rep -= dt;
      if (dist(this, G.rally) > 1.6) {
        if (this.state !== 'rally' || !this.path || this.rep <= 0) { this.rep = 1; this.state = 'rally'; this.go(findPath(this.tx, this.ty, Math.floor(G.rally.x), Math.floor(G.rally.y))); }
        this.stepMove(dt);
      } else { this.state = 'rally'; this.path = null; }
      return;
    }
    if (this.state === 'rally') { this.state = 'idle'; this.path = null; }
    if (this.state === 'sleep') {
      this.energy = Math.min(100, this.energy + 12 * dt); this.anger = Math.max(0, this.anger + VAR.MODIFY_ANGER_OF_CREATURE_IN_LAIR_PER_SECOND * dt);
      if (this.energy >= 100 && this.hp >= this.maxHp * 0.8) { this.state = 'idle'; this.wait = 1; }
    } else if (this.state === 'toBed') {
      if (this.stepMove(dt)) this.state = 'sleep';
    } else if (this.state === 'toFood') {                                // task/creature/GoToEat: walk to a free-range chicken and eat it
      const ch = this.chicken; if (!ch || ch.dead) { this.releaseChicken(); this.state = 'idle'; this.path = null; return; }
      this.rep -= dt; if (this.rep <= 0 || !this.path) { this.rep = 0.5; this.go(findPath(this.tx, this.ty, ch.tx, ch.ty)); }
      this.stepMove(dt); this.face = Math.atan2(ch.y - this.y, ch.x - this.x);
      if (dist(this, ch) < 0.9) { this.state = 'eat'; this.eatT = VAR.EAT_SECONDS; this.path = null; ch.frozen = true; sfx('squawk', ch.x, ch.y); }
    } else if (this.state === 'eat') {
      this.eatT -= dt; const ch = this.chicken;
      if (this.eatT <= 0 || !ch || ch.dead) {
        if (ch) ch.dead = true; this.chicken = null; this.hunger = 0; this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.15); this.anger = Math.max(0, this.anger - 300);
        G.fx.push({ x: this.x, y: this.y - 0.5, txt: 'Yum', life: 0.8, color: '#ffd080' }); sfx('munch', this.x, this.y); this.state = 'idle'; this.wait = 1;
      }
    } else if (this.state === 'toRack') {                                 // a Mistress goes to whoever is strapped to a rack
      const b = this.victim; if (!b || b.dead || b.status !== 'torture' || b.carriedBy) { this.releaseVictim(); this.state = 'idle'; this.path = null; }
      else if (this.stepMove(dt)) this.state = 'torture';
    } else if (this.state === 'torture') {
      const b = this.victim; if (!b || b.dead || b.status !== 'torture' || b.tormentor !== this || this.energy < 35 || this.hunger >= VAR.HUNGRY_AT) { this.releaseVictim(); this.state = 'idle'; this.wait = 1; }
      else { this.face = Math.atan2(b.y - this.y, b.x - this.x); this.anger = Math.max(0, this.anger - 30 * dt); }
    } else if (this.state === 'toAltar') {
      if (this.stepMove(dt)) { this.state = 'pray'; this.studyT = VAR.PRAY_SECONDS; this.sndT = 5; sfx('chime', this.x, this.y); }
    } else if (this.state === 'pray') {                                   // Temple: prayer turns into mana and soothes the creature
      this.sndT -= dt; if (this.sndT <= 0) { this.sndT = 5 + this.id % 4; sfx('chime', this.x, this.y); }
      this.studyT -= dt; this.anger = Math.max(0, this.anger - 40 * dt); G.mana = Math.min(G.maxMana, G.mana + this.pray * (1 + 0.1 * (this.level - 1)) * dt);
      if (this.studyT <= 0 || this.energy < 35 || this.hunger >= VAR.HUNGRY_AT) { this.releaseDesk(); this.state = 'idle'; this.wait = 1; }
    } else if (this.state === 'toDesk') {
      if (!G.research.current) { this.releaseDesk(); this.state = 'idle'; this.path = null; }
      else if (this.stepMove(dt)) { this.state = 'research'; this.studyT = VAR.STUDY_SECONDS; }
    } else if (this.state === 'research') {                              // task/creature/Research: sit still at a desk and add research points
      this.studyT -= dt; if (G.research.current) addResearch(this.research * (1 + 0.1 * (this.level - 1)) * dt);
      if (this.studyT <= 0 || !G.research.current || this.energy < 35) { this.releaseDesk(); this.state = 'idle'; this.wait = 1; }
    } else {
      if ((this.energy < 35 || this.hp < this.maxHp * VAR.CREATURE_SLEEPS_WHEN_BELOW_PERCENT_HEALTH / 100) && this.lair) { const p = findPath(this.tx, this.ty, this.lair.x, this.lair.y); if (p) { this.go(p); this.state = 'toBed'; return; } }
      this.foodThink -= dt;
      if (!this.noFood && this.hunger >= VAR.HUNGRY_AT && !this.path && this.foodThink <= 0) {              // hunger comes before study and prayer
        this.foodThink = VAR.TIME_BETWEEN_REATTEMPTING_HUNGER_SECONDS || 4;
        let best = null, bd = Infinity; for (const ch of G.chickens) if (!ch.dead && !ch.claimedBy) { const d = dist(this, ch); if (d < bd) { bd = d; best = ch; } }
        const p = best && findPath(this.tx, this.ty, best.tx, best.ty);
        if (p) { best.claimedBy = this; this.chicken = best; this.state = 'toFood'; this.go(p); this.rep = 0.5; return; }
      }
      this.tortureThink -= dt;
      if (this.torturer && !this.path && this.tortureThink <= 0 && this.hunger < VAR.HUNGRY_AT) {
        this.tortureThink = 2; const b = G.prisoners.find(p => p.status === 'torture' && !p.carriedBy && (!p.tormentor || p.tormentor.dead)), pth = b && findPath(this.tx, this.ty, b.tx, b.ty);
        if (pth) { b.tormentor = this; this.victim = b; this.state = 'toRack'; this.go(pth); return; }
      }
      this.studyThink -= dt; this.prayThink -= dt;
      if (this.research > 0 && G.research.current && !this.path && this.studyThink <= 0) {                // idle thinkers look for a free desk
        this.studyThink = 2; const desk = freeSlot(T.LIBRARY, this), p = desk && findPath(this.tx, this.ty, desk.x, desk.y);
        if (p) { desk.t.occ = this; this.desk = desk.t; this.state = 'toDesk'; this.go(p); return; }
      }
      if (this.pray > 0 && !this.path && this.prayThink <= 0 && this.hunger < VAR.HUNGRY_AT) {                  // idle believers go to the Temple
        this.prayThink = 2.5; const alt = freeSlot(T.TEMPLE, this), p = alt && findPath(this.tx, this.ty, alt.x, alt.y);
        if (p) { alt.t.occ = this; this.desk = alt.t; this.state = 'toAltar'; this.go(p); return; }
      }
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
const alive = (u) => !u.dead && !u.held && !u.unconscious && !u.imprisoned;
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
const BOWS = new Set(['Archer', 'Dark Elf']), HIT = { Spider: 'bite', Salamander: 'bite', Troll: 'club', 'Bile Demon': 'club', Giant: 'club' };   // which voice a blow uses; the default is a sword
const baseName = (u) => u.name.replace('Ex-', '');
function strike(u, t) {
  u.cd = u.cdMax; u.face = Math.atan2(t.y - u.y, t.x - u.x); let dmg = roll(u.dmg);
  if (u.ambush && !t.heart && !t.door && t.hp >= t.maxHp) { dmg *= 2; G.fx.push({ x: t.x, y: t.y - 0.8, txt: 'Backstab!', life: 0.9, color: '#ffb0b0' }); }        // Assassin: the opening blow
  if (u.ranged) {
    const bow = BOWS.has(baseName(u)); sfx(bow ? 'bow' : 'magic', u.x, u.y);
    G.shots.push({ x: u.x, y: u.y, tgt: t, dmg, src: u, speed: 11, hit: bow ? 'arrow_hit' : 'magic_hit', color: u.team === 'k' ? '#d9a0ff' : '#ffe9a0' });
  }
  else {
    hurt(t, dmg, u, HIT[baseName(u)]);
    if (u.cleave) for (const o of foesOf(u)) if (o !== t && alive(o) && dist(o, t) < 1.4) hurt(o, dmg * 0.5, u, 'sword');  // Reaper: the scythe sweeps
  }
}
function hurt(t, dmg, src, snd) {
  if (t.dead) return;
  if (t.unconscious && !src) { kill(t, null); return; }                   // traps and spells finish the helpless
  if (t.unconscious || t.imprisoned) return;
  if (t.armor && src) dmg *= 1 - t.armor;
  if (t.door && src && src.doorBreaker) dmg *= src.doorBreaker;           // Dwarf and Giant                                   // Black Knight
  if (t.door) sfx('door_hit', t.x, t.y); else if (t.heart) sfx('heart_hit', t.x, t.y); else if (src) sfx(snd || 'sword', t.x, t.y);   // traps and spells (no src) make their own noise
  G.fx.push({ x: t.x, y: t.y - 0.4, txt: Math.round(dmg), life: 0.7, color: t.team === 'k' || t.heart ? '#ff8080' : '#fff' });
  if (t.heart) {
    G.heartHp = Math.max(0, G.heartHp - dmg); G.heartFlash = 0.2;
    if (G.heartHp <= 0 && !G.over) { say('Your Dungeon Heart has been destroyed!'); finishGame('defeat'); }
    return;
  }
  t.hp -= dmg; t.flash = 0.15; if (t.hp <= 0) { if (canKnockOut(t, src)) knockOut(t, src); else kill(t, src); }
}
function kill(t, src) {
  if (t.door) { t.dead = true; G.doors = G.doors.filter(d => d !== t); const dt_ = tile(t.tx, t.ty); if (dt_) dt_.door = null; G.fx.push({ x: t.x, y: t.y, splat: true, life: 3 }); G.dirty = true; sfx('door_break', t.x, t.y); say('A door was smashed!'); return; }
  t.dead = true; G.fx.push({ x: t.x, y: t.y, splat: true, life: 6 }); sfx(t.isImp ? 'imp_scream' : 'death', t.x, t.y);
  if (t.isImp) { t.drop(); say('An imp was slain.'); }
  else if (t.team === 'k') { if (t.lair) t.lair.occupant = null; if (t.releaseDesk) { t.releaseDesk(); t.releaseChicken(); t.releaseVictim(); } say(t.name + ' #' + t.id + ' has fallen!'); }
  else { G.kills++; say('A hero ' + t.name + ' is slain.'); }
  if (src && src.team === 'k' && src.level && !src.dead) gainXp(src);
}
function gainXp(c) {                              // CreatureExperienceSystem, reduced
  c.xp += VAR.XP_PER_KILL;
  if (c.level < VAR.MAX_LEVEL && c.xp >= VAR.XP_PER_LEVEL * c.level) {
    sfx('levelup', c.x, c.y); c.level++; c.maxHp = Math.round(c.maxHp * 1.18); c.dmg *= 1.18; c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.3);
    say(c.name + ' #' + c.id + ' reached level ' + c.level + '!');
  }
}
function startFlee(u) {                           // weak and in danger: run to the Heart (keepers) or back to the Gate (heroes)
  const goal = u.team === 'k' || !G.gate ? { x: G.heart.x, y: G.heart.y + 2 } : u.homeGate || G.gate;      // heroes run back to the Gate they arrived by
  const p = findPath(u.tx, u.ty, goal.x, goal.y); if (!p || !p.length) return false;
  u.state = 'flee'; u.go(p); return true;
}
function fightBrain(u, dt) {                      // true = this unit's turn was consumed by combat
  u.cd = Math.max(0, u.cd - dt * (u.haste > 0 ? 1.6 : 1));          // Speed spell: faster recharge too
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
    if (d <= m + 0.2) { hurt(t, s.dmg, s.src, s.hit); s.done = true; } else { s.x += dx / d * m; s.y += dy / d * m; }
  }
  G.shots = G.shots.filter(s => !s.done);
  for (const f of G.fx) f.life -= dt; G.fx = G.fx.filter(f => f.life > 0);
  G.heartFlash = Math.max(0, G.heartFlash - dt);
}

/* ---- heroes: they arrive from the Hero Gate once a tunnel links it to your dungeon (TriggerAction CREATE_HERO_PARTY analogue) ---- */
const HEROES = [
  { name: 'Knight', letter: 'K', color: '#e8e8f0', hp: 150, dmg: 11, range: 1.2, cdMax: 1.1, ranged: 0, speed: 1.7, sprite: 'knight' },
  { name: 'Archer', letter: 'A', color: '#9fe08f', hp: 70,  dmg: 9,  range: 6,   cdMax: 1.2, ranged: 1, speed: 1.9, sprite: 'archer' },
  { name: 'Mage',   letter: 'M', color: '#8fb8ff', hp: 60,  dmg: 16, range: 5,   cdMax: 1.8, ranged: 1, speed: 1.6, sprite: 'mage' },
  { name: 'Thief',  letter: 'T', color: '#5a6578', hp: 55,  dmg: 9,  range: 1.2, cdMax: 0.8, ranged: 0, speed: 2.4, sprite: 'thief' },
  { name: 'Guard',  letter: 'G', color: '#4a6ac0', hp: 230, dmg: 9,  range: 1.2, cdMax: 1.3, ranged: 0, speed: 1.4, sprite: 'guard' },
  { name: 'Monk',   letter: 'H', color: '#c8a060', hp: 70,  dmg: 5,  range: 4.5, cdMax: 1.4, ranged: 1, speed: 1.7, sprite: 'monk', heals: true },   // heals wounded allies
  { name: 'Prince', letter: 'P', color: '#e8c050', hp: 300, dmg: 15, range: 1.2, cdMax: 1.0, ranged: 0, speed: 1.6, sprite: 'prince', fearless: true, boss: true },   // leads the last wave
  // added with the last unused character art, each countering something different
  { name: 'Dwarf',        letter: 'D', color: '#c07838', hp: 120, dmg: 10, range: 1.2, cdMax: 1.0, ranged: 0, speed: 1.5, sprite: 'dwarf', disarms: true, doorBreaker: 2.5 },                  // sets off nothing: it disarms traps; chews through doors
  { name: 'Giant',        letter: 'N', color: '#7a5a40', hp: 250, dmg: 20, range: 1.3, cdMax: 2.0, ranged: 0, speed: 1.1, sprite: 'giant', stunImmune: true, doorBreaker: 3, fearless: true },       // slow, huge, shrugs off lightning stuns
  { name: 'Stone Knight', letter: 'S', color: '#8a9080', hp: 190, dmg: 12, range: 1.2, cdMax: 1.3, ranged: 0, speed: 1.2, sprite: 'stone_knight', armor: 0.25, gasImmune: true },            // a statue: no breathing, thick skin
  { name: 'Fairy',        letter: 'F', color: '#70e0c0', hp: 45,  dmg: 4,  range: 4,   cdMax: 1.1, ranged: 1, speed: 2.2, sprite: 'fairy', flying: true, heals: true, healAmt: 16, healEvery: 2 },  // flies over doors and floor traps
  { name: 'King',         letter: 'Y', color: '#f0d060', hp: 330, dmg: 16, range: 1.2, cdMax: 1.0, ranged: 0, speed: 1.5, sprite: 'king', fearless: true, boss: true, armor: 0.1 },                // leads the final wave
];
// the invasion is scripted so the new types debut in a sensible order (wave 1 .. 5)
const WAVE_PLAN = WV.plan || [];                                                  // one list of hero names per wave, from the level
const waveNames = (n) => WV.endless ? window.sandboxParty(n + 1) : WAVE_PLAN[Math.min(n, WAVE_PLAN.length - 1)];            // n = waves already spawned; endless mode generates the next party (levels.js)
const waveInterval = (n) => WV.endless ? Math.max(WV.minInterval || 55, VAR.WAVE_INTERVAL - 1.5 * n) : VAR.WAVE_INTERVAL;     // the gap after wave n+1 spawns: endless waves arrive faster and faster, 1.5 s per wave, down to a floor
const waveText = () => VAR.WAVES === Infinity ? 'Wave ' + G.wave : 'Wave ' + G.wave + '/' + VAR.WAVES;
class Hero extends Mover {
  constructor(x, y, kind, scale, party) { super(x, y, kind.speed); Object.assign(this, kind);
    this.hp = this.maxHp = Math.round(kind.hp * scale); this.dmg = kind.dmg * scale; this.team = 'h'; this.cd = 0; this.sight = 7;
    this.state = 'idle'; this.rep = 0; this.think = 0; this.party = party; this.dead = false; this.flash = 0; this.held = false; this.id = ++G.nextId; }
  get leader() { return this.party.find(h => !h.dead && !h.unconscious && h.state !== 'flee') || null; }
  update(dt) {
    if (this.dead) return; this.flash = Math.max(0, this.flash - dt);
    if (this.unconscious) { if (!this.carriedBy) { this.uTime -= dt; if (this.uTime <= 0) { say('A hero ' + this.name + ' bled out.'); kill(this, null); } } return; }
    if (this.stun > 0) { this.stun -= dt; this.cd = Math.max(0, this.cd - dt); return; }                 // lightning-trap stun
    if (this.heals) {                                                                               // the Monk patches up wounded allies
      this.healCd = Math.max(0, (this.healCd || 0) - dt);
      const ally = this.healCd <= 0 && G.heroes.find(h => h !== this && !h.dead && !h.unconscious && h.hp < h.maxHp * 0.7 && dist(this, h) <= 5 && los(this.x, this.y, h.x, h.y));
      if (ally) { const amt = this.healAmt || 22; ally.hp = Math.min(ally.maxHp, ally.hp + amt); this.healCd = this.healEvery || 2.5; G.fx.push({ x: ally.x, y: ally.y - 0.4, txt: '+' + amt, life: 0.7, color: '#8fffa0' }); G.fx.push({ x: ally.x, y: ally.y, ring: true, r: 0.9, color: '#8fffa0', life: 0.5, max: 0.5 }); }
    }
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
  const n = G.wave, scale = (1 + LV.waves.scale * n) * (LV.waves.heroMult || 1);
  const kinds = waveNames(n).map(nm => HEROES.find(h => h.name === nm));
  /* The wave comes out of every linked Hero Gate: its heroes are dealt out between them (the wave is no bigger, it is split), starting
   * from a different gate each wave so the boss does not always arrive at the same one. Each gate's group has its own leader. If the
   * level flags the invasion as open without any gate linked (tests), the first gate is used. */
  let gates = G.gates.filter(g => g.open); if (!gates.length) gates = [G.gate];
  const parties = gates.map(() => []);
  kinds.forEach((kind, j) => {
    const gi = (j + n) % gates.length, gt = gates[gi], party = parties[gi], slot = party.length;
    const h = new Hero(gt.x - 1 + (slot % 3), gt.y - 1 + ((slot / 3) | 0), kind, scale, party); h.homeGate = gt; party.push(h); G.heroes.push(h);
  });
  if (window.Sound) Sound.stinger(kinds[0].boss ? 'boss' : 'wave');
  G.wave++; G.nextWave = G.wave < VAR.WAVES ? G.time + waveInterval(n) : Infinity;
  say('⚔ ' + waveText() + ': ' + kinds.length + ' heroes pour out of ' + (gates.length > 1 ? 'the ' + gates.length + ' Hero Gates' : 'the Hero Gate') + (kinds[0].boss ? ', led by the ' + kinds[0].name + '!' : '!'));
}
function heroLogic(dt) {
  if (!G.gates.length) return;
  if (G.gates.some(g => !g.open)) {                    // every 2 s: has a tunnel reached a Gate that was still shut?
    G.gateT -= dt;
    if (G.gateT <= 0) {
      G.gateT = 2;
      G.gates.forEach((gt, i) => {
        if (gt.open || !findPath(gt.x, gt.y, G.heart.x, G.heart.y)) return;
        gt.open = true; sfx('gong');
        if (!G.gateOpen) { G.gateOpen = true; G.nextWave = G.time + VAR.FIRST_WAVE_DELAY;       // the first link starts the invasion clock
          say('The Hero Gate is linked to your dungeon! Heroes will invade in ' + VAR.FIRST_WAVE_DELAY + 's.'); }
        else say('Hero Gate ' + (i + 1) + ' is linked too: heroes will now arrive there as well.');
      });
    }
  }
  if (!G.gateOpen) return;
  if (G.time >= G.nextWave && G.wave < VAR.WAVES) spawnWave();
}

/* ===================================================================================== objectives & the guide
 * A level lists objectives (docs/06-levels.md); it is won when every one that is not `optional` is done. Without a list the level is
 * the original "beat every wave". Objectives and guide steps share one table of named conditions: each returns [value, goal] and is met
 * once value >= goal. A finished objective stays finished (a room you later lose does not un-win the level). The tutorial guide is a
 * list of steps shown one at a time; a step moves on when its `when` condition is met (or when the player presses "Got it"). */
const roomCount = (room) => { const id = ROOM_TOOLS[room]; let n = 0; for (const t of G.map) if (t.t === id && t.owner === 1) n++; return n; };
const COND = {
  survive:   { needs: 'waves',  f: () => [G.wave >= VAR.WAVES && !G.heroes.length ? 1 : 0, 1], label: () => 'Defeat every wave of invaders' },
  portal:    { needs: 'portal', f: () => [G.portalOwned ? 1 : 0, 1], label: () => 'Claim the Portal' },
  gate:      { needs: 'gate',   f: (c) => [G.gates.filter(g => g.open).length, c.n || 1], label: (c) => (c.n || 1) > 1 ? 'Link tunnels to ' + c.n + ' Hero Gates' : 'Link a tunnel to the Hero Gate' },
  wave:      { needs: 'waves',  params: ['n'], f: (c) => [G.wave, c.n], label: (c) => 'Withstand ' + c.n + ' wave' + (c.n > 1 ? 's' : '') },
  dug:       { params: ['n'], f: (c) => [G.stats.dug, c.n], label: (c) => 'Dig out ' + c.n + ' tiles' },
  mined:     { params: ['n'], f: (c) => [G.stats.mined, c.n], label: (c) => 'Mine ' + c.n + ' gold' },
  claimed:   { params: ['n'], f: (c) => [G.stats.claimed, c.n], label: (c) => 'Claim ' + c.n + ' floor tiles' },
  gold:      { params: ['n'], f: (c) => [Math.floor(G.gold), c.n], label: (c) => 'Hold ' + c.n + ' gold' },
  room:      { params: ['room'], f: (c) => [roomCount(c.room), c.n || 1], label: (c) => 'Build a ' + c.room[0].toUpperCase() + c.room.slice(1) + ((c.n || 1) > 1 ? ' of ' + c.n + ' tiles' : '') },
  creatures: { params: ['n'], f: (c) => [G.creatures.filter(u => !u.dead && (!c.kind || u.name === c.kind)).length, c.n], label: (c) => 'Keep ' + c.n + ' ' + (c.kind || 'creature') + (c.n > 1 ? 's' : '') },
  kills:     { params: ['n'], f: (c) => [G.kills, c.n], label: (c) => 'Slay ' + c.n + ' heroes' },
  research:  { params: ['item'], f: (c) => [G.research.done[c.item] ? 1 : 0, 1], label: (c) => 'Research ' + RESEARCH[c.item].name },
  doors:     { params: ['n'], f: (c) => [G.doors.length, c.n], label: (c) => 'Place ' + c.n + ' door' + (c.n > 1 ? 's' : '') },
  traps:     { params: ['n'], f: (c) => [G.traps.length, c.n], label: (c) => 'Place ' + c.n + ' trap' + (c.n > 1 ? 's' : '') },
  prisoners: { params: ['n'], f: (c) => [G.prisoners.length, c.n], label: (c) => 'Hold ' + c.n + ' prisoner' + (c.n > 1 ? 's' : '') },
  spells:    { params: ['n'], f: (c) => [G.stats.spells, c.n], label: (c) => 'Cast ' + c.n + ' spell' + (c.n > 1 ? 's' : '') },
};
const OBJECTIVES = LV.objectives || [{ type: 'survive' }];      // endless levels set [] and are never won: they end in defeat or when you retire
const GUIDE = qs.get('guide') === '0' ? [] : (LV.guide || []);
const condState = (c) => { const [v, goal] = COND[c.type].f(c); return { v: Math.min(v, goal), goal, done: v >= goal }; };
const objText = (o) => o.text || COND[o.type].label(o);
function updateObjectives() {
  OBJECTIVES.forEach((o, i) => {
    if (G.objDone[i]) return; const st = G.objProg[i] = condState(o);
    if (st.done) { G.objDone[i] = true; if (!o.quiet) { say('✔ ' + objText(o)); sfx('levelup'); } }
  });
  if (!G.over && !WV.endless && OBJECTIVES.every((o, i) => o.optional || G.objDone[i])) {
    say(LV.victory || (VAR.WAVES ? 'All invaders are defeated — the dungeon is yours!' : 'Well done, Keeper — the dungeon is yours!')); finishGame('victory');
  }
  while (G.guideStep < GUIDE.length && GUIDE[G.guideStep].when && condState(GUIDE[G.guideStep].when).done) G.guideStep++;     // steps with a condition move on by themselves
}
/* The end of a run: freezes the result, judges the stars, and saves it (progress.js). `?nosave=1` skips saving (bots, experiments). */
const SB = LV.sandbox || null;                       // the sandbox's options ({ diff, endless }) when this is the generated sandbox level
const wavesSurvived = () => Math.max(0, G.wave - (G.heroes.length ? 1 : 0));       // waves whose heroes are all beaten: the wave you are fighting does not count yet
function finishGame(outcome) {                         // 'victory', 'defeat', or 'retired' (endless: you stopped and banked the score; G.over is then 'defeat')
  G.over = outcome === 'victory' ? 'victory' : 'defeat'; G.overAt = G.time;
  const bonus = OBJECTIVES.map((o, i) => o.optional ? i : -1).filter(i => i >= 0), r = { outcome, time: Math.round(G.time), kills: G.kills, heart: Math.max(0, G.heartHp) / VAR.HEART_HEALTH,
    bonusTotal: bonus.length, bonusDone: bonus.filter(i => G.objDone[i]).length };
  const save = qs.get('nosave') !== '1';
  if (WV.endless) { r.waves = wavesSurvived(); G.record = save ? Progress.recordEndless(SB.diff, r.waves) : null; }                       // endless: the score is waves survived, best per difficulty
  else if (SB) G.record = null;                          // a custom sandbox has no chapter to unlock and no stars to earn
  else { if (outcome === 'victory') { const st = Progress.stars(LV.stars, r); r.stars = st.earned; r.starList = st.list; } G.record = save ? Progress.record(LV.id, r) : null; }
  G.result = r;
}
const guideNow = () => G.guideStep < GUIDE.length ? GUIDE[G.guideStep] : null;
function guideTarget() {                                  // the map area the current step points at: { x0, y0, x1, y1 } in tiles, or null
  const g = guideNow(), a = g && g.at; return a ? { x0: a[0], y0: a[1], x1: a.length > 3 ? a[2] : a[0], y1: a.length > 3 ? a[3] : a[1] } : null;
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
  if (RESEARCH[kind] && !needs(kind)) return;
  const def = kind === 'door' ? DOOR : TRAPS[kind], name = kind === 'door' ? 'Door' : def.name; let n = 0, spent = 0;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const t = tile(x, y); if (!t || t.t !== T.PATH || t.owner !== 1 || t.door || t.trap) continue;
    if (G.gold - spent < def.cost) { say('Not enough gold for more ' + name + 's.'); x = 1e9; y = 1e9; break; }
    if (kind === 'door') { const d = { door: true, tx: x, ty: y, x: x + .5, y: y + .5, hp: DOOR.hp, maxHp: DOOR.hp, dead: false, flash: 0 }; t.door = d; G.doors.push(d); }
    else { const tr = { kind, tx: x, ty: y, x: x + .5, y: y + .5, charges: def.max, max: def.max, cd: 0, prog: 0 }; t.trap = tr; G.traps.push(tr); }
    spent += def.cost; n++;
  }
  G.gold -= spent; if (n) sfx('build', (x0 + x1) / 2 + .5, (y0 + y1) / 2 + .5); if (n) say('Placed ' + n + ' ' + name + (n > 1 ? 's' : '') + ' for ' + spent + ' gold.'); else say('Doors and traps go on your claimed floor, not on rooms.');
  G.dirty = true;
}
function removeThings(x0, y0, x1, y1) {                  // right-click: sell for half the price
  let n = 0, refund = 0;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const t = tile(x, y); if (!t) continue;
    if (t.door) { refund += DOOR.cost / 2; G.doors = G.doors.filter(d => d !== t.door); t.door = null; n++; }
    else if (t.trap) { refund += TRAPS[t.trap.kind].cost / 2; G.traps = G.traps.filter(d => d !== t.trap); t.trap = null; n++; }
  }
  if (n) { G.gold += refund; sfx('coins', (x0 + x1) / 2 + .5, (y0 + y1) / 2 + .5); say('Sold ' + n + ' item(s) for ' + refund + ' gold.'); G.dirty = true; }
}
function fireTrap(tr) {
  tr.charges--; tr.cd = TRAPS[tr.kind].cd;
  if (tr.kind === 'gas') { sfx('gas', tr.x, tr.y); G.clouds.push({ x: tr.x, y: tr.y, r: 2.2, life: 5, dps: 10, tick: 0 }); say('A Gas Trap hisses!'); }
  else {
    G.fx.push({ x: tr.x, y: tr.y, bolt: true, life: 0.35 }); sfx('lightning', tr.x, tr.y); say('A Lightning Trap discharges!');
    for (const h of G.heroes) if (!h.dead && dist(h, tr) <= 2.2) { hurt(h, 45, null); if (!h.stunImmune) h.stun = 1.5; G.fx.push({ x: h.x, y: h.y, bolt: true, life: 0.3 }); }
  }
}
function updateTraps(dt) {
  for (const d of G.doors) d.flash = Math.max(0, d.flash - dt);
  for (const tr of G.traps) {
    tr.cd = Math.max(0, tr.cd - dt);
    const stepper = tr.charges > 0 && tr.cd <= 0 && G.heroes.find(h => !h.dead && !h.unconscious && !h.flying && Math.hypot(h.x - tr.x, h.y - tr.y) <= 0.9);   // flyers glide over
    if (stepper) {
      if (stepper.disarms) { tr.charges = 0; sfx('clank', tr.x, tr.y); say('A Dwarf disarms the ' + TRAPS[tr.kind].name + '!'); G.fx.push({ x: tr.x, y: tr.y - 0.5, txt: 'Disarmed', life: 0.9, color: '#ffd080' }); }
      else fireTrap(tr);
    }
  }
  for (const c of G.clouds) {
    c.life -= dt; c.tick -= dt;
    if (c.tick <= 0) { c.tick = 0.5; for (const h of G.heroes) if (!h.dead && !h.gasImmune && dist(h, c) <= c.r) hurt(h, c.dps * 0.5, null); }
  }
  G.clouds = G.clouds.filter(c => c.life > 0);
}

/* ===================================================================================== library & research
 * OpenKeeper marks every room, door, trap and spell UNAVAILABLE / RESEARCHABLE / AVAILABLE (ResearchableEntity). The Library
 * holds desks; creatures with a research talent (Attributes.researchPerSecond) sit at them (task/creature/Research) and
 * pour points into the current item until PlayerSpellbookSystem makes it available. Everything not listed here
 * (Treasury, Lair, Library, Doors, Create Imp) is available from the start. */
const RESEARCH = {
  prison:    { kind: 'room',  name: 'Prison',          pts: 90 },
  temple:    { kind: 'room',  name: 'Temple',          pts: 100 },
  torture:   { kind: 'room',  name: 'Torture Chamber', pts: 150 },
  gas:       { kind: 'trap',  name: 'Gas Trap',        pts: 80 },
  bolt:      { kind: 'trap',  name: 'Lightning Trap',  pts: 140 },
  heal:      { kind: 'spell', name: 'Heal',            pts: 60 },
  haste:     { kind: 'spell', name: 'Speed',           pts: 90 },
  lightning: { kind: 'spell', name: 'Lightning',       pts: 120 },
  rally:     { kind: 'spell', name: 'Call to Arms',    pts: 150 },
};
const RESEARCH_ROOM = { [T.PRISON]: 'prison', [T.TORTURE]: 'torture', [T.TEMPLE]: 'temple' };
const isAvail = (id) => !RESEARCH[id] || !!G.research.done[id];
function needs(id) { if (isAvail(id)) return true; sfx('deny'); say(RESEARCH[id].name + ' is not researched yet — build a Library and let your thinkers study.'); return false; }
function nextResearch() { return Object.keys(RESEARCH).find(id => !G.research.done[id]) || null; }
function addResearch(p) {
  const r = G.research, id = r.current; if (!id) return;
  r.points[id] = (r.points[id] || 0) + p;
  if (r.points[id] >= RESEARCH[id].pts) { sfx('research'); r.done[id] = true; r.current = nextResearch(); say('✦ Research complete: ' + RESEARCH[id].name + '!' + (r.current ? ' Now studying ' + RESEARCH[r.current].name + '.' : ' Nothing left to research.')); }
}
function unlockAll() { for (const id in RESEARCH) G.research.done[id] = true; G.research.current = null; }

/* ===================================================================================== hatchery, chickens & hunger; temple
 * OpenKeeper: Hatchery generates free-range chickens (CHICKEN_GENERATION_TIME_PER_HATCHERY, MAX_FREE_RANGE_CHICKENS_PER_PLAYER),
 * hungry creatures run GoToEat and the missing food feeds REASON_NO_FOOD. The Temple lets creatures pray for mana
 * (Attributes.manaGenPrayer, MOTIONLESS_WHILE_PRAYING_SECONDS). */
class Chicken extends Mover {
  constructor(x, y) { super(x, y, 0.6); Object.assign(this, { team: 'k', isChicken: true, hp: 10, maxHp: 10, dead: false, flash: 0, claimedBy: null, frozen: false, t: 1, cluckT: 2 + Math.random() * 8, id: ++G.nextId, sprite: 'chicken' }); }
  update(dt) {
    if (this.dead) return;
    if (this.frozen) { this.path = null; return; }                       // being eaten
    this.cluckT -= dt; if (this.cluckT <= 0) { this.cluckT = 7 + Math.random() * 12; sfx('cluck', this.x, this.y); }
    this.t -= dt;
    if (!this.path && this.t <= 0 && G.hatchTiles.length) { this.t = 1.5 + rand() * 3; const t = G.hatchTiles[(rand() * G.hatchTiles.length) | 0]; this.go(findPath(this.tx, this.ty, t.x, t.y)); }
    this.stepMove(dt);
  }
}
function updateHatchery(dt) {
  G.hatchScan -= dt;
  if (G.hatchScan <= 0) { G.hatchScan = 1; G.hatchTiles = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = G.map[idx(x, y)]; if (t.t === T.HATCHERY && t.owner === 1) G.hatchTiles.push({ x, y }); } }
  if (G.hatchTiles.length) {
    G.hatchT += dt * G.hatchTiles.length;                                // more tiles hatch faster
    if (G.hatchT >= VAR.CHICKEN_SECONDS && G.chickens.length < VAR.MAX_CHICKENS) { G.hatchT = 0; const t = G.hatchTiles[(rand() * G.hatchTiles.length) | 0]; G.chickens.push(new Chicken(t.x, t.y)); }
  }
  for (const c of G.chickens) c.update(dt);
  G.chickens = G.chickens.filter(c => !c.dead);
}
const prayRate = () => G.creatures.reduce((s, c) => s + (c.state === 'pray' ? c.pray * (1 + 0.1 * (c.level - 1)) : 0), 0);

/* ===================================================================================== knock-out, prison & torture
 * In OpenKeeper a creature that loses its last hit points in a fight falls unconscious (CREATURE_DYING_STATE_DURATION_SECONDS,
 * 60): TaskManager spawns a RescueCreatureTask for your own and a CaptureEnemyCreatureTask for enemies, imps carry them
 * to a Lair / Prison, prisoners lose health (PRISON_MODIFY_CREATURE_HEALTH_PER_SECOND) and the Torture Chamber converts
 * them after Attributes.tortureTimeToConvert. Traps and spells (no attacker) still kill outright. */
const KO_SECONDS = 60, PRISON_DRAIN = 0.5, TORTURE_DRAIN = 0.25, TORTURE_SECONDS = 30, CONVERT_CHANCE = 0.7;
const SKELETON = { name: 'Skeleton', sprite: 'skeleton', elite: 'skeleton_knight', color: '#d8d8c8', pay: 0, hp: 70, dmg: 8, range: 1.2, cdMax: 1.1, ranged: 0, noLair: true, noFood: true };   // rises from starved prisoners
function canKnockOut(t, src) { return !t.isImp && !t.door && !t.heart && !!src && !!src.team && !!t.team && src.team !== t.team; }
function knockOut(t, src) {
  sfx('ko', t.x, t.y); t.unconscious = true; t.uTime = KO_SECONDS; t.hp = 0; t.state = 'ko'; t.path = null; t.flash = 0.15;
  G.fx.push({ x: t.x, y: t.y - 0.4, txt: 'KO', life: 0.9, color: '#ffd060' });
  say(t.team === 'k' ? t.name + ' #' + t.id + ' is knocked out — imps will carry it to a lair.' : 'A hero ' + t.name + ' is knocked out.');
  if (src.level && !src.dead) gainXp(src);
}
function freeSlot(roomT, near) {                  // nearest unoccupied, unreserved room tile of your own
  let best = null, bd = Infinity;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = G.map[idx(x, y)];
    if (t.t === roomT && t.owner === 1 && !t.occ && !t.reserved) { const d = Math.abs(x - near.x) + Math.abs(y - near.y); if (d < bd) { bd = d; best = { x, y, t }; t.cx = x; t.cy = y; } } }
  return best;
}
function lairSpot(b) {
  const l = freeSlotAny(T.LAIR, b); if (l) return l;
  const t = tile(G.heart.x, G.heart.y + 2); t.cx = G.heart.x; t.cy = G.heart.y + 2; return { x: G.heart.x, y: G.heart.y + 2, t };
}
function freeSlotAny(roomT, near) {               // lair tiles can take any number of rescued creatures
  let best = null, bd = Infinity;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = G.map[idx(x, y)];
    if (t.t === roomT && t.owner === 1) { const d = Math.abs(x - near.x) + Math.abs(y - near.y); if (d < bd) { bd = d; best = { x, y, t }; t.cx = x; t.cy = y; } } }
  return best;
}
function dropOff(b, d, type) {
  b.carriedBy = null; d.t.reserved = null; b.x = d.x + 0.5; b.y = d.y + 0.5; b.homeCell = null;
  if (type === 'RESCUE') { b.unconscious = false; b.hp = Math.max(b.hp, b.maxHp * 0.3); b.state = b.lair ? 'sleep' : 'idle'; say(b.name + ' #' + b.id + ' was rescued and is recovering.'); }
  else if (type === 'CAPTURE') {
    G.heroes = G.heroes.filter(h => h !== b); G.prisoners.push(b); b.unconscious = false; b.imprisoned = true; b.status = 'prisoner';
    b.cell = d.t; d.t.occ = b; b.hp = Math.max(b.hp, b.maxHp * 0.35); b.path = null; b.state = 'jailed'; say('A hero ' + b.name + ' is thrown into prison.');
  } else if (type === 'HAUL') { b.status = 'torture'; b.cell = d.t; d.t.occ = b; b.torment = 0; b.state = 'jailed'; say('A prisoner is strapped to the rack.'); }
}
function updateJail(dt) {
  for (const b of G.prisoners.slice()) {
    if (b.carriedBy) continue;
    const tort = b.status === 'torture';
    b.hp -= (tort ? TORTURE_DRAIN : PRISON_DRAIN) * dt;
    const helper = tort && b.tormentor && !b.tormentor.dead && b.tormentor.state === 'torture';
    if (tort) b.torment += dt * (helper ? 1.6 : 1);                       // a Mistress at the rack works 60% faster
    if (b.hp <= 0) release(b, tort ? 'break' : 'starve');
    else if (tort && b.torment >= TORTURE_SECONDS) release(b, rand() < (helper ? 0.88 : CONVERT_CHANCE) ? 'convert' : 'break');
  }
}
function release(b, how) {
  G.prisoners = G.prisoners.filter(p => p !== b); if (b.cell) b.cell.occ = null; b.dead = true; b.imprisoned = false;
  const tx = Math.floor(b.x), ty = Math.floor(b.y);
  if (how === 'convert') {
    const c = new Creature(tx, ty, { name: 'Ex-' + b.name, sprite: b.sprite, tint: true, color: b.color, pay: 70, hp: b.maxHp, dmg: b.dmg, range: b.range, cdMax: b.cdMax, ranged: b.ranged, research: b.name === 'Mage' ? 1.2 : 0.4, pray: 0.5 });
    G.creatures.push(c); G.fx.push({ x: c.x, y: c.y, ring: true, r: 1.2, color: '#c080ff', life: 0.8, max: 0.8 });
    sfx('convert', c.x, c.y); say('The ' + b.name + ' breaks and joins your dungeon as ' + c.name + '!');
  } else if (how === 'starve') {
    const c = new Creature(tx, ty, SKELETON); G.creatures.push(c); say('A starved prisoner rises as a Skeleton!');
  } else say('A tortured ' + b.name + ' dies without breaking.');
}

/* ===================================================================================== mana & spells
 * ManaCalculatorLogic: mana flows in from your territory (OpenKeeper adds prayer in the Temple); KeeperSpellCastValidator
 * checks cost, cooldown and a valid target before PlayerSpellbookSystem lets a spell fire. All five spells start researched. */
const SPELLS = {
  lightning: { name: 'Lightning',    icon: '⚡', cost: 120, cd: 4,  r: 1.5, color: '#fff6a0' },
  heal:      { name: 'Heal',         icon: '✚',  cost: 80,  cd: 3,  r: 3.2, color: '#6fe08a' },
  haste:     { name: 'Speed',        icon: '»',  cost: 90,  cd: 6,  r: 3.2, color: '#6aa0ff' },
  rally:     { name: 'Call to Arms', icon: '⚑',  cost: 150, cd: 10, r: 0.8, color: '#ffa040' },
  imp:       { name: 'Create Imp',   icon: '✦',  cost: 100, cd: 2,  r: 0.5, color: '#ff6a6a' },
};
const SPELL_ORDER = ['lightning', 'heal', 'haste', 'rally', 'imp'];
const SPELL_SND = { lightning: 'lightning', heal: 'heal', haste: 'haste', rally: 'rally', imp: 'imp_spawn' };
function updateMana(dt) {
  G.manaT -= dt; if (G.manaT <= 0) { G.manaT = 1; G.ownedTiles = 0; for (const t of G.map) if (t.owner === 1 && !TERRAIN[t.t].solid) G.ownedTiles++; G.manaRate = 3 + 0.04 * G.ownedTiles; }
  G.mana = Math.min(G.maxMana, G.mana + G.manaRate * dt);
  for (const k in G.spellCd) G.spellCd[k] = Math.max(0, G.spellCd[k] - dt);
}
const unitsNear = (list, f, r) => list.filter(u => !u.dead && Math.hypot(u.x - f.fx, u.y - f.fy) <= r);
function ring(f, color, r) { G.fx.push({ x: f.fx, y: f.fy, ring: true, r, color, life: 0.6, max: 0.6 }); }
function castSpell(id, f) {                      // f = {fx, fy} world position of the click
  const sp = SPELLS[id], tx = Math.floor(f.fx), ty = Math.floor(f.fy), t = tile(tx, ty);
  if (G.over || !t) return false;
  if (RESEARCH[id] && !isAvail(id)) { needs(id); return false; }
  const fail = (m) => { sfx('deny'); say(m); return false; };
  if (G.mana < sp.cost) return fail('Not enough mana for ' + sp.name + ' (' + sp.cost + ').');
  if ((G.spellCd[id] || 0) > 0) return fail(sp.name + ' is recharging.');
  if (id === 'lightning') {
    const foes = unitsNear(G.heroes.filter(h => !h.unconscious), f, sp.r).sort((a, b) => Math.hypot(a.x - f.fx, a.y - f.fy) - Math.hypot(b.x - f.fx, b.y - f.fy));
    if (!foes.length) return fail('Lightning needs a hero under the cursor.');
    const first = foes[0], chain = G.heroes.filter(h => !h.dead && !h.unconscious && h !== first && dist(h, first) <= 3.5).slice(0, 2);
    G.fx.push({ x: first.x, y: first.y, bolt: true, life: 0.35 }); if (!first.stunImmune) first.stun = Math.max(first.stun || 0, 1.2); hurt(first, 70, null);
    for (const h of chain) { G.fx.push({ x: h.x, y: h.y, bolt: true, life: 0.3 }); if (!h.stunImmune) h.stun = Math.max(h.stun || 0, 0.6); hurt(h, 35, null); }
  } else if (id === 'heal') {
    const us = unitsNear(G.creatures.concat(G.imps), f, sp.r).filter(u => u.hp < u.maxHp);
    if (!us.length) return fail('Nobody nearby needs healing.');
    for (const u of us) { u.hp = Math.min(u.maxHp, u.hp + 60); G.fx.push({ x: u.x, y: u.y - 0.4, txt: '+60', life: 0.7, color: '#8fffa0' }); }
    ring(f, sp.color, sp.r);
  } else if (id === 'haste') {
    const us = unitsNear(G.creatures, f, sp.r); if (!us.length) return fail('No creatures in range of Speed.');
    for (const u of us) u.haste = 12; ring(f, sp.color, sp.r);
  } else if (id === 'rally') {
    if (TERRAIN[t.t].solid) return fail('Plant the flag on open floor.');
    G.rally = { x: f.fx, y: f.fy, until: G.time + 25 }; ring(f, sp.color, 1.6); say('Call to Arms! Your creatures gather at the flag.');
  } else if (id === 'imp') {
    if (TERRAIN[t.t].solid || t.owner !== 1) return fail('Imps can only be created on your claimed floor.');
    if (G.imps.length >= 14) return fail('Too many imps already.');
    G.imps.push(new Imp(tx, ty)); ring(f, sp.color, 0.8);
  }
  G.mana -= sp.cost; G.spellCd[id] = sp.cd; G.stats.spells++; sfx(SPELL_SND[id], f.fx, f.fy); return true;
}

/* ===================================================================================== player actions */
function build(roomId, x0, y0, x1, y1) {          // RoomPlacementValidator (reduced): owned, empty, affordable
  if (RESEARCH_ROOM[roomId] && !needs(RESEARCH_ROOM[roomId])) return;
  const tr = TERRAIN[roomId]; let n = 0, spent = 0;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const t = tile(x, y); if (!t || t.t !== T.PATH || t.owner !== 1) continue;
    if (G.gold - spent < tr.cost) { say('Not enough gold for more ' + tr.name + ' tiles.'); x = 1e9; y = 1e9; break; }
    t.t = roomId; t.hp = tr.maxHealth; t.room = 1; t.bed = null; spent += tr.cost; n++;
  }
  G.gold -= spent; if (n) sfx('build', (x0 + x1) / 2 + .5, (y0 + y1) / 2 + .5); if (n) say('Built ' + n + ' ' + tr.name + ' tile(s) for ' + spent + ' gold.'); else say('Nothing to build there — rooms need your claimed floor.');
  G.dirty = true;
}
function tagRect(x0, y0, x1, y1, on) {
  let n = 0;
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    const t = tile(x, y); if (t && TERRAIN[t.t].solid && TERRAIN[t.t].tag) { if (t.tag !== (on ? 1 : 0)) n++; t.tag = on ? 1 : 0; } }
  if (n) sfx(on ? 'tag' : 'untag');
  scanTasks();
}

/* ===================================================================================== main step */
function step(dt) {
  if (G.over) return;
  G.time += dt;
  G.scanT -= dt; if (G.scanT <= 0 || G.dirty) { scanTasks(); G.scanT = 0.4; G.dirty = false; }
  // free imp generation: MINIMUM_IMP_THRESHOLD / TIME_BEFORE_FREE_IMP_GENERATED_SECONDS
  G.nextImp -= dt;
  if (G.imps.length < VAR.MINIMUM_IMP_THRESHOLD && G.nextImp <= 0) { G.nextImp = VAR.TIME_BEFORE_FREE_IMP_GENERATED_SECONDS; G.imps.push(new Imp(G.heart.x, G.heart.y + 2)); sfx('imp_spawn', G.heart.x + .5, G.heart.y + 2.5); say('A free imp crawls out of the Heart.'); }
  for (const i of G.imps) i.update(dt);
  // portal spawning (CreatureSpawnSystem), only once claimed
  G.nextSpawn -= dt;
  if (G.portalOwned && G.nextSpawn <= 0 && G.creatures.length < VAR.CREATURES_SUPPORTED_BY_FIRST_PORTAL) {
    G.nextSpawn = 25; const k = pickKind(); sfx('portal', G.portal.x + .5, G.portal.y + .5); G.creatures.push(new Creature(G.portal.x, G.portal.y, k)); say('A ' + k.name + ' enters through the portal.');
  }
  G.creatures = G.creatures.filter(c => c.dead ? false : c.update(dt) !== 'leave');
  for (const h of G.heroes) h.update(dt);
  updateMana(dt); updateHatchery(dt); for (const c of G.creatures) if (c.haste > 0) c.haste -= dt;
  updateTraps(dt); updateJail(dt); updateShots(dt); heroLogic(dt);
  G.heroes = G.heroes.filter(h => !h.dead); G.creatures = G.creatures.filter(c => !c.dead); G.imps = G.imps.filter(i => !i.dead);
  updateObjectives();
  // payday
  G.nextPay -= dt;
  if (G.nextPay <= 0) {
    G.nextPay = VAR.PAY_DAY_FREQUENCY_SECONDS; let total = 0, short = 0;
    for (const c of G.creatures) { if (G.gold >= c.pay) { G.gold -= c.pay; total += c.pay; } else { c.anger += 400; short++; } }
    if (total) sfx('payday');
    if (G.creatures.length) say('Payday: paid ' + total + ' gold' + (short ? ', ' + short + ' unpaid (angry!)' : '') + '.');
  }
}

/* ===================================================================================== rendering */
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const MODE_2D = qs.get('view') === '2d';
cv.width = W * TS; cv.height = H * TS;
const FONT_UNIT = '700 8px Cinzel, Georgia, serif', FONT_NUM = '700 9px Cinzel, Georgia, serif', FONT_BANNER = '900 40px "Cinzel Decorative", Cinzel, Georgia, serif', FONT_SUB = 'italic 18px "EB Garamond", Georgia, serif';     // the 2D view draws text on a canvas, so the page's fonts are named here too
if (document.fonts) for (const f of ['700 9px Cinzel', '900 40px "Cinzel Decorative"', 'italic 18px "EB Garamond"']) document.fonts.load(f);
const hash = (x, y) => { let h = x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; };
const COL = { [T.ROCK]: '#1c1a1a', [T.EARTH]: '#6a4a2c', [T.GOLD]: '#6a4a2c', [T.GEM]: '#4a3a4a', [T.PATH]: '#3b3128' };
const ROOMCOL = { [T.TREASURY]: '#7a6420', [T.LAIR]: '#4a3a6a', [T.HEART]: '#8a2a2a', [T.PORTAL]: '#5a2a7a', [T.GATE]: '#6a3a2a', [T.PRISON]: '#4a5560', [T.TORTURE]: '#5a2020', [T.LIBRARY]: '#3a4a6a', [T.HATCHERY]: '#6a5a30', [T.TEMPLE]: '#5a4a7a' };
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
    if (t.t === T.HATCHERY) { ctx.fillStyle = '#c8a850'; for (let k = 0; k < 6; k++) ctx.fillRect(px + 3 + hash(x + k, y * 3) * 12, py + 3 + hash(x * 5, y + k) * 12, 3, 1.5); }
    if (t.t === T.TEMPLE) { ctx.strokeStyle = '#ffd860'; ctx.beginPath(); ctx.arc(px + TS / 2, py + TS / 2, 6, 0, 7); ctx.stroke(); ctx.fillStyle = '#ffd860'; ctx.fillRect(px + TS / 2 - 1.5, py + TS / 2 - 1.5, 3, 3); }
    if (t.t === T.LIBRARY) { ctx.fillStyle = '#c0a060'; ctx.fillRect(px + 3, py + 3, TS - 6, 4); ctx.fillStyle = '#d06060'; ctx.fillRect(px + 4, py + 4, 3, 2); ctx.fillStyle = '#6090d0'; ctx.fillRect(px + 9, py + 4, 3, 2); ctx.fillStyle = '#8a6a40'; ctx.fillRect(px + 6, py + 11, TS - 12, 5); }
    if (t.t === T.PRISON) { ctx.strokeStyle = '#b8c0d0'; ctx.lineWidth = 1; for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(px + k * TS / 4, py + 3); ctx.lineTo(px + k * TS / 4, py + TS - 3); ctx.stroke(); } }
    if (t.t === T.TORTURE) { ctx.strokeStyle = '#d06a50'; ctx.beginPath(); ctx.moveTo(px + 4, py + 4); ctx.lineTo(px + TS - 4, py + TS - 4); ctx.moveTo(px + TS - 4, py + 4); ctx.lineTo(px + 4, py + TS - 4); ctx.stroke(); }
    if (t.t === T.LAIR) { ctx.fillStyle = '#8a70c0'; ctx.fillRect(px + 4, py + 6, TS - 8, TS - 12); if (t.bed && t.bed.occupant) { ctx.fillStyle = t.bed.occupant.color; ctx.fillRect(px + 6, py + 7, 5, 5); } }
    if (t.t === T.HEART && (x === G.heart.x && y === G.heart.y)) { ctx.fillStyle = '#ff4a4a'; ctx.beginPath(); ctx.arc(px + TS / 2, py + TS / 2, 7 + Math.sin(G.time * 4) * 1.2, 0, 7); ctx.fill(); }
    if (!tr.solid && t.owner === HERO_LAND) { ctx.fillStyle = 'rgba(190,70,50,.22)'; ctx.fillRect(px, py, TS, TS); }
    const gt = t.t === T.GATE && G.gates.find(g => g.x === x && g.y === y); if (gt) { ctx.strokeStyle = gt.open ? '#ff8a50' : '#8a5a4a'; ctx.lineWidth = 2; ctx.strokeRect(px + 3, py + 3, TS - 6, TS - 6); ctx.lineWidth = 1; }
    if (t.t === T.HEART && (x === G.heart.x && y === G.heart.y) && G.heartFlash > 0) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(px - TS, py - TS, TS * 3, TS * 3); }
    if (t.t === T.PORTAL && G.portal && (x === G.portal.x && y === G.portal.y)) { ctx.strokeStyle = G.portalOwned ? '#c090ff' : '#7a5aa0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px + TS / 2, py + TS / 2, 7, 0, 7); ctx.stroke(); ctx.lineWidth = 1; }
    if (t.tag && tr.solid) { ctx.strokeStyle = '#ffe070'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px + 3, py + 3); ctx.lineTo(px + TS - 3, py + TS - 3); ctx.moveTo(px + TS - 3, py + 3); ctx.lineTo(px + 3, py + TS - 3); ctx.stroke(); ctx.lineWidth = 1; }
    if (tr.solid && !tr.imp && t.hp < tr.maxHealth && t.hp > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(px + 2, py + TS - 5, TS - 4, 3); ctx.fillStyle = '#e0624f'; ctx.fillRect(px + 2, py + TS - 5, (TS - 4) * t.hp / tr.maxHealth, 3); }
    if (!tr.solid && t.owner !== 1 && t.hp > 0 && t.hp < tr.maxHealth) { ctx.fillStyle = 'rgba(70,110,220,.8)'; ctx.fillRect(px + 2, py + TS - 5, (TS - 4) * t.hp / tr.maxHealth, 3); }
  }
  for (const d of G.doors) { const px = d.tx * TS, py = d.ty * TS; ctx.fillStyle = d.flash > 0 ? '#fff' : '#8a5a2a'; ctx.fillRect(px + 2, py + 2, TS - 4, TS - 4); ctx.strokeStyle = '#3a2410'; ctx.strokeRect(px + 2.5, py + 2.5, TS - 5, TS - 5);
    ctx.beginPath(); ctx.moveTo(px + 2, py + TS / 2); ctx.lineTo(px + TS - 2, py + TS / 2); ctx.stroke(); if (d.hp < d.maxHp) { ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(px + 2, py + TS - 5, TS - 4, 3); ctx.fillStyle = '#e0a050'; ctx.fillRect(px + 2, py + TS - 5, (TS - 4) * d.hp / d.maxHp, 3); } }
  for (const tr of G.traps) { const px = tr.x * TS, py = tr.y * TS; ctx.globalAlpha = tr.charges ? 0.95 : 0.35; ctx.strokeStyle = TRAPS[tr.kind].color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = TRAPS[tr.kind].color; for (let i = 0; i < tr.charges; i++) ctx.fillRect(px - 5 + i * 4, py - 1, 3, 3); ctx.globalAlpha = 1; }
  for (const c of G.clouds) { ctx.fillStyle = `rgba(120,220,70,${0.28 * Math.min(1, c.life)})`; ctx.beginPath(); ctx.arc(c.x * TS, c.y * TS, c.r * TS, 0, 7); ctx.fill(); }
  if (G.rally && G.time < G.rally.until) { const px = G.rally.x * TS, py = G.rally.y * TS; ctx.strokeStyle = '#ffa040'; ctx.beginPath(); ctx.moveTo(px, py + 6); ctx.lineTo(px, py - 12); ctx.stroke(); ctx.fillStyle = '#ff6a20'; ctx.fillRect(px, py - 12, 9, 6); }
  for (const f of G.fx) if (f.ring) { const k = 1 - f.life / f.max; ctx.strokeStyle = f.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x * TS, f.y * TS, f.r * TS * (0.3 + 0.7 * k), 0, 7); ctx.stroke(); ctx.lineWidth = 1; ctx.globalAlpha = 1; }
  for (const f of G.fx) if (f.bolt) { ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(f.x * TS - 3, f.y * TS - 14); ctx.lineTo(f.x * TS + 3, f.y * TS - 6); ctx.lineTo(f.x * TS - 2, f.y * TS - 2); ctx.lineTo(f.x * TS + 2, f.y * TS + 4); ctx.stroke(); ctx.lineWidth = 1; }
  for (const f of G.fx) if (f.splat) { ctx.fillStyle = `rgba(140,20,20,${Math.min(.5, f.life / 6)})`; ctx.beginPath(); ctx.arc(f.x * TS, f.y * TS, 6, 0, 7); ctx.fill(); }
  for (const i of G.imps) { const [px, py] = scr(i); ctx.fillStyle = i.flash > 0 ? '#fff' : i.state === 'flee' ? '#ff9060' : '#d04040'; ctx.beginPath(); ctx.arc(px, py, 4.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillRect(px + Math.cos(i.face) * 2.5 - .5, py + Math.sin(i.face) * 2.5 - .5, 2, 2);
    if (i.gold) { ctx.fillStyle = '#f4c430'; ctx.fillRect(px - 2, py - 8, 4, 3); }
    if (i.state === 'work') { ctx.strokeStyle = '#fff6'; ctx.beginPath(); ctx.arc(px, py, 6 + Math.sin(G.time * 18) * 1.5, 0, 7); ctx.stroke(); }
    bar(px, py, i); }
  for (const c of G.creatures) { const [px, py] = scr(c); ctx.fillStyle = c.flash > 0 ? '#fff' : c.color; ctx.fillRect(px - 5, py - 5, 10, 10);
    if (c.state === 'fight' || c.state === 'flee') { ctx.strokeStyle = c.state === 'flee' ? '#ffb030' : '#ff4040'; ctx.strokeRect(px - 6.5, py - 6.5, 13, 13); }
    if (c.haste > 0) { ctx.strokeStyle = '#6aa0ff'; ctx.strokeRect(px - 7.5, py - 7.5, 15, 15); }
    for (let l = 1; l < c.level; l++) { ctx.fillStyle = '#ffe070'; ctx.fillRect(px - 5 + (l - 1) * 3, py + 6, 2, 2); }
    bar(px, py, c); ctx.fillStyle = '#000'; ctx.font = FONT_UNIT; ctx.textAlign = 'center'; ctx.fillText(c.name[0], px, py + 3);
    if (c.unconscious) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(px - 5, py - 5, 10, 10); ctx.fillStyle = '#fff'; ctx.fillText('x', px, py + 3); }
    if (c.state === 'research') { ctx.fillStyle = '#ffd860'; ctx.fillRect(px - 3, py - 11, 6, 4); ctx.fillStyle = '#7a5a10'; ctx.fillRect(px, py - 11, 1, 4); }
    if (c.state === 'sleep') { ctx.fillStyle = '#9cf'; ctx.fillText('z', px + 7, py - 5); }
    if (c.mood !== 'content') { ctx.fillStyle = c.mood === 'angry' ? '#ff3030' : '#ffb030'; ctx.fillText('!', px, py - 8); } }
  for (const c of G.chickens) { const px = c.x * TS, py = c.y * TS; ctx.fillStyle = '#f4eadc'; ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 7); ctx.fill(); ctx.fillStyle = '#e04040'; ctx.fillRect(px + 1, py - 4.5, 2, 2); }
  for (const h of G.heroes.concat(G.prisoners)) { const px = h.x * TS, py = h.y * TS;
    ctx.fillStyle = h.flash > 0 ? '#fff' : h.color; ctx.beginPath(); ctx.arc(px, py, 5.5, 0, 7); ctx.fill(); ctx.strokeStyle = h.state === 'flee' ? '#ffb030' : '#4a90ff'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#000'; ctx.font = FONT_UNIT; ctx.textAlign = 'center'; ctx.fillText(h.letter, px, py + 3); bar(px, py, h);
    if (h.unconscious || h.imprisoned) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(px, py, 5.5, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText('x', px, py + 3); if (h.status === 'torture') { ctx.strokeStyle = '#ff7050'; ctx.strokeRect(px - 8, py - 8, 16, 16); } } }
  for (const s of G.shots) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x * TS, s.y * TS, 2.2, 0, 7); ctx.fill(); }
  ctx.font = FONT_NUM; ctx.textAlign = 'center';
  for (const f of G.fx) if (!f.splat && !f.bolt && !f.ring) { ctx.globalAlpha = Math.min(1, f.life * 2); ctx.fillStyle = f.color; ctx.fillText(f.txt, f.x * TS, (f.y - (0.7 - f.life) * 0.8) * TS); ctx.globalAlpha = 1; }
  { const hp = G.heartHp / VAR.HEART_HEALTH, bx = (G.heart.x - 1) * TS, by = (G.heart.y + 2) * TS + 2;     // Heart health
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(bx, by, TS * 3, 4); ctx.fillStyle = hp > .5 ? '#e05050' : '#ff9030'; ctx.fillRect(bx, by, TS * 3 * hp, 4); }
  if (G.over) { ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, cv.width, cv.height); }               // the words are the end screen (DOM, see renderEnd)
  const gt = guideTarget(); if (gt && !G.guideHidden && !G.over) {         // the tutorial guide's pulsing marker
    const k = 0.5 + 0.5 * Math.sin(G.time * 5); ctx.strokeStyle = 'rgba(255,211,107,' + (0.5 + 0.5 * k) + ')'; ctx.lineWidth = 3;
    ctx.strokeRect(gt.x0 * TS + 1, gt.y0 * TS + 1, (gt.x1 - gt.x0 + 1) * TS - 2, (gt.y1 - gt.y0 + 1) * TS - 2); ctx.lineWidth = 1; }
  if (mouse.down && tool !== 'hand') {                        // drag preview
    const x0 = Math.min(mouse.sx, mouse.x), x1 = Math.max(mouse.sx, mouse.x), y0 = Math.min(mouse.sy, mouse.y), y1 = Math.max(mouse.sy, mouse.y);
    ctx.fillStyle = mouse.down === 3 ? 'rgba(255,80,80,.25)' : 'rgba(255,230,120,.25)'; ctx.fillRect(x0 * TS, y0 * TS, (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS);
  } else if (mouse.x >= 0 && SPELLS[tool] && mouse.fx !== undefined) { ctx.strokeStyle = SPELLS[tool].color; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(mouse.fx * TS, mouse.fy * TS, SPELLS[tool].r * TS, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  else if (mouse.x >= 0) { ctx.strokeStyle = '#fff'; ctx.strokeRect(mouse.x * TS + .5, mouse.y * TS + .5, TS - 1, TS - 1); }
}

/* ===================================================================================== UI wiring */
const $ = (id) => document.getElementById(id);
const TOOLS = [ ['dig', 'Dig (tag)'], ['hand', '✋ Hand'], ['treasury', 'Treasury ' + TERRAIN[T.TREASURY].cost + 'g/tile'], ['lair', 'Lair ' + TERRAIN[T.LAIR].cost + 'g/tile'],
  ['library', 'Library ' + TERRAIN[T.LIBRARY].cost + 'g/tile'], ['hatchery', 'Hatchery ' + TERRAIN[T.HATCHERY].cost + 'g/tile'], ['temple', 'Temple ' + TERRAIN[T.TEMPLE].cost + 'g/tile'], ['prison', 'Prison ' + TERRAIN[T.PRISON].cost + 'g/tile'], ['torture', 'Torture ' + TERRAIN[T.TORTURE].cost + 'g/tile'],
  ['door', 'Door ' + DOOR.cost + 'g'], ['gas', 'Gas Trap ' + TRAPS.gas.cost + 'g'], ['bolt', 'Lightning Trap ' + TRAPS.bolt.cost + 'g'],
  ...SPELL_ORDER.map((id, i) => [id, SPELLS[id].icon + ' ' + SPELLS[id].name + ' ' + SPELLS[id].cost + ' [' + (i + 1) + ']']),
  ['sp1', '⏸ Pause'], ['sp2', '1×'], ['sp3', '3×'], ['sp4', '8×'] ];
const TOOL_GROUP = (id) => id.startsWith('sp') ? 'speed' : SPELLS[id] ? 'spell' : ['door', 'gas', 'bolt'].includes(id) ? 'trap' : ['dig', 'hand'].includes(id) ? 'act' : 'room';     // only styling: which accent a button gets
let prevGroup = null;
for (const [id, label] of TOOLS) { const grp = TOOL_GROUP(id); if (prevGroup && grp !== prevGroup) { const sep = document.createElement('span'); sep.className = 'sep'; $('tools').appendChild(sep); } prevGroup = grp;
  const b = document.createElement('button'); b.className = 'g-' + grp; b.textContent = label; b.id = 'b_' + id; b.onclick = () => {
  if (id.startsWith('sp')) { G.speed = [0, 1, 3, 8][+id[2] - 1]; } else if (RESEARCH[id] && !isAvail(id)) needs(id); else tool = id; refreshButtons(); }; $('tools').appendChild(b); }
function refreshButtons() { for (const [id] of TOOLS) { const b = $('b_' + id); b.classList.toggle('on', id === tool || (id.startsWith('sp') && [0, 1, 3, 8][+id[2] - 1] === G.speed)); } }
function posF(e) { const r = cv.getBoundingClientRect(); return { fx: (e.clientX - r.left) / r.width * W, fy: (e.clientY - r.top) / r.height * H }; }
function pos(e) { const r = cv.getBoundingClientRect(); return { x: Math.max(0, Math.min(W - 1, Math.floor((e.clientX - r.left) / r.width * W))), y: Math.max(0, Math.min(H - 1, Math.floor((e.clientY - r.top) / r.height * H))) }; }
/* Input is expressed in world terms ({x,y} tile, {fx,fy} float tile coords) so the 2D and the 3D view share it. */
const ROOM_TOOLS = { treasury: T.TREASURY, lair: T.LAIR, library: T.LIBRARY, hatchery: T.HATCHERY, temple: T.TEMPLE, prison: T.PRISON, torture: T.TORTURE };
function inputDown(p, f, button) { mouse = { x: p.x, y: p.y, sx: p.x, sy: p.y, down: button === 2 ? 3 : 1, fx: f.fx, fy: f.fy }; }
function inputMove(p, f) { mouse.x = p.x; mouse.y = p.y; mouse.fx = f.fx; mouse.fy = f.fy; }
function inputUp(p, f) {
  if (!mouse.down) return; const right = mouse.down === 3;
  if (tool === 'hand') { if (!right) handClick(f); }
  else if (tool === 'dig') tagRect(mouse.sx, mouse.sy, p.x, p.y, !right);
  else if (SPELLS[tool]) { if (!right) castSpell(tool, f); }
  else if (tool === 'door' || tool === 'gas' || tool === 'bolt') { if (right) removeThings(mouse.sx, mouse.sy, p.x, p.y); else placeThings(tool, mouse.sx, mouse.sy, p.x, p.y); }
  else if (!right && ROOM_TOOLS[tool]) build(ROOM_TOOLS[tool], mouse.sx, mouse.sy, p.x, p.y);
  mouse.down = 0;
}
addEventListener('keydown', e => { const i = '12345'.indexOf(e.key); if (i >= 0 && e.target.tagName !== 'INPUT') { if (isAvail(SPELL_ORDER[i])) tool = SPELL_ORDER[i]; else needs(SPELL_ORDER[i]); refreshButtons(); } });
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
    sfx('drop', m.fx, m.fy); held.x = m.fx; held.y = m.fy; held.held = false; held.state = 'idle'; held.path = null; held.think = 0; G.held = null; return;
  }
  let best = null, bd = 1.3;
  for (const u of G.creatures.concat(G.imps)) { const d = Math.hypot(u.x - m.fx, u.y - m.fy); if (!u.dead && d < bd) { best = u; bd = d; } }
  if (!best) return;
  sfx('pickup', best.x, best.y); if (best.isImp) best.drop(); best.held = true; best.path = null; G.held = best;
}
function renderLog(isNew) { const el = $('log'); el.innerHTML = G.log.slice(0, 12).map((m, i) => '<div' + (i === 0 && isNew ? ' class="new"' : '') + '>' + m + '</div>').join(''); }
function renderHud() {
  $('hGold').textContent = Math.floor(G.gold); $('hCap').textContent = capacity(); $('hImps').textContent = G.imps.length;
  $('hCreatures').textContent = G.creatures.length; $('hMax').textContent = VAR.CREATURES_SUPPORTED_BY_FIRST_PORTAL;
  $('hPay').textContent = Math.max(0, Math.ceil(G.nextPay)); $('hTime').textContent = Math.floor(G.time);
  $('hMana').textContent = Math.floor(G.mana) + '/' + G.maxMana;
  for (const id of SPELL_ORDER) $('b_' + id).style.opacity = G.mana >= SPELLS[id].cost && !(G.spellCd[id] > 0) ? 1 : 0.45;
  for (const id in RESEARCH) { const b = $('b_' + id); if (!isAvail(id)) { b.style.opacity = 0.3; b.title = 'Locked — research it in a Library'; } else { b.title = ''; if (!SPELLS[id]) b.style.opacity = ''; } }
  renderResearch(); renderObjectives(); renderGuide(); renderEnd();
  $('hHeart').textContent = Math.ceil(G.heartHp); $('hHeroes').textContent = G.heroes.length; $('hWave').textContent = !VAR.WAVES ? '—' : VAR.WAVES === Infinity ? G.wave + ' / ∞' : G.wave + '/' + VAR.WAVES;
  $('hNext').textContent = !VAR.WAVES ? '—' : !G.gateOpen ? 'tunnel to Gate' : G.nextWave === Infinity ? '—' : Math.max(0, Math.ceil(G.nextWave - G.time)) + 's' + (G.gates.length > 1 ? ' · gates ' + G.gates.filter(g => g.open).length + '/' + G.gates.length : '');
  let dig = 0, claim = 0, busy = 0, upkeep = 0; for (const t of G.tasks.values()) { if (t.type === 'DIG') dig++; else if (t.type === 'CLAIM') claim++; else upkeep++; if (t.who.size) busy++; }
  const mood = G.creatures.map(c => c.name + ' #' + c.id + ' Lv' + c.level + ' ' + Math.ceil(c.hp) + '/' + c.maxHp + 'hp: ' + c.mood + (c.lair || c.noLair ? '' : ' (no bed)')).join('<br>');
  $('tasks').innerHTML = 'Dig tiles <b>' + dig + '</b> · Claim tiles <b>' + claim + '</b> · Repair/rearm <b>' + upkeep + '</b> · in progress <b>' + busy + '</b><br>' +
    'Chickens <b>' + G.chickens.length + '</b> · hungry <b>' + G.creatures.filter(c => !c.noFood && c.hunger >= VAR.HUNGRY_AT).length + '</b> · praying <b>' + G.creatures.filter(c => c.state === 'pray').length + '</b> (+' + prayRate().toFixed(1) + ' mana/s)<br>Prisoners <b>' + G.prisoners.length + '</b> · knocked out <b>' + G.creatures.concat(G.heroes).filter(u => u.unconscious).length + '</b><br>Idle imps <b>' + G.imps.filter(i => i.state === 'idle').length + '</b>/' + G.imps.length + '<br><span style="color:var(--dim)">' + (mood || 'No creatures yet — dig east and claim the purple portal.') + '</span>';
}

/* Research panel: one button per item, click to choose what the Library studies next. */
const rItems = {};
for (const id in RESEARCH) {
  const b = document.createElement('button'); b.className = 'ritem'; b.dataset.id = id; b.innerHTML = '<span class="n"></span><span class="s"></span><span class="bar"></span>';
  b.onclick = () => { if (!G.research.done[id]) { G.research.current = id; say('Now researching ' + RESEARCH[id].name + '.'); } };
  $('research').appendChild(b); rItems[id] = b;
}
function renderResearch() {
  const r = G.research; let studying = 0, rate = 0;
  for (const c of G.creatures) if (c.state === 'research') { studying++; rate += c.research * (1 + 0.1 * (c.level - 1)); }
  for (const id in RESEARCH) {
    const b = rItems[id], it = RESEARCH[id], done = !!r.done[id], pct = Math.min(100, Math.floor((r.points[id] || 0) / it.pts * 100));
    b.classList.toggle('done', done); b.classList.toggle('cur', r.current === id);
    b.querySelector('.n').textContent = it.name; b.querySelector('.s').textContent = done ? '✓ ' + it.kind : (r.current === id ? '▶ ' : '') + it.kind + ' ' + pct + '%';
    b.querySelector('.bar').style.width = (done ? 100 : pct) + '%';
  }
  const libTiles = G.map.filter(t => t.t === T.LIBRARY && t.owner === 1).length;
  $('researchInfo').textContent = !libTiles ? 'No Library yet — build one on your claimed floor, then thinkers (Warlocks study best) will sit at its desks.'
    : studying + ' studying at ' + libTiles + ' desk(s), +' + rate.toFixed(1) + ' pts/s' + (r.current ? '' : ' — nothing selected');
}

/* Objectives panel, tutorial guide and briefing: three overlays inside #stage (see index.html). They only rewrite the DOM when the text changes. */
let objHtml = '', guideHtml = '', guideTool = null;
function renderObjectives() {
  const html = WV.endless ? '<li><span class="tick">◇</span>Survive as many waves as you can</li><li><span class="tick">⚔</span>Waves survived <em>' + wavesSurvived() + '</em> · best <em>' + Progress.endlessBest(SB.diff) + '</em></li><li class="opt"><span class="tick">♛</span>A boss leads every 5th wave</li>' : OBJECTIVES.map((o, i) => { const st = G.objDone[i] ? { done: true, goal: 1, v: 1 } : (G.objProg[i] || { v: 0, goal: 1 });
    return '<li class="' + (st.done ? 'done' : '') + (o.optional ? ' opt' : '') + '"><span class="tick">' + (st.done ? '✔' : '◇') + '</span>' + objText(o) + (o.optional ? ' <i>(bonus)</i>' : '') + (!st.done && st.goal > 1 ? ' <em>' + Math.floor(st.v) + '/' + st.goal + '</em>' : '') + '</li>'; }).join('');
  if (html !== objHtml) { objHtml = html; $('objList').innerHTML = html; }
}
function renderGuide() {
  const g = guideNow(), show = !!g && !G.guideHidden && !G.over, el = $('guide');
  const html = show ? g.text + (g.when ? '' : ' <button id="guideNext">Got it</button>') : '';
  if (html !== guideHtml) { guideHtml = html; $('guideText').innerHTML = html; const nb = $('guideNext'); if (nb) nb.onclick = () => { G.guideStep++; }; }
  el.style.display = show ? 'flex' : 'none';
  const tl = show && g.tool ? g.tool : null;                                  // pulse the tool button the step talks about
  if (tl !== guideTool) { if (guideTool && $('b_' + guideTool)) $('b_' + guideTool).classList.remove('hint'); if (tl && $('b_' + tl)) $('b_' + tl).classList.add('hint'); guideTool = tl; }
}
$('guideX').onclick = () => { G.guideHidden = true; };
/* The end screen: VICTORY or DEFEAT, the numbers, the three stars and what to do next. Built once, when the run ends. */
const CAMPAIGN = window.CAMPAIGN || [], keepParams = () => ['view', 'sound'].filter(k => qs.get(k) !== null).map(k => '&' + k + '=' + encodeURIComponent(qs.get(k))).join('');
const goLevel = (id) => { location.href = 'index.html?level=' + encodeURIComponent(id) + '&brief=1' + keepParams(); };
let endShown = false;
function renderEnd() {
  if (!G.over || endShown) return; endShown = true;
  const r = G.result, win = r.outcome === 'victory', retired = r.outcome === 'retired', nextId = Progress.next(CAMPAIGN, LV.id), rec = G.record, endless = !!WV.endless;
  $('endTitle').textContent = win ? 'Victory' : retired ? 'Retired' : endless ? 'Overrun' : 'Defeat'; $('endTitle').className = win ? 'win' : 'lose';
  $('endLine').textContent = win ? (LV.name || LV.id) + ' is yours.' : retired ? 'You left the Heart to its fate and banked your score.' : 'Your Dungeon Heart has been destroyed.';
  $('endStats').innerHTML = (endless ? '<span>Waves survived <b>' + r.waves + '</b></span>' : '') + '<span>Time <b>' + Progress.fmtTime(r.time) + '</b></span><span>Heroes slain <b>' + r.kills + '</b></span>' + (endless ? '' : '<span>Heart <b>' + Math.round(r.heart * 100) + '%</b></span>');
  $('endStars').innerHTML = win && r.starList ? r.starList.map(s => '<li class="' + (s.ok ? 'got' : '') + '"><span class="star">' + (s.ok ? '★' : '☆') + '</span>' + s.text + '</li>').join('') : '';
  $('endBest').textContent = endless ? (rec ? (rec.newBest ? 'New best for ' + window.DIFFICULTY[SB.diff].name + '!' : 'Best for ' + window.DIFFICULTY[SB.diff].name + ': ' + Progress.endlessBest(SB.diff) + ' waves') : '')
    : !win || !rec ? '' : rec.newBest ? (rec.first ? 'First victory!' : 'New best!') : 'Best: ' + Progress.level(LV.id).stars + ' of 3 stars, ' + Progress.fmtTime(Progress.level(LV.id).bestTime);
  $('endNext').style.display = win && nextId && LEVEL_TABLE[nextId] ? '' : 'none'; $('endNext').onclick = () => goLevel(nextId);
  $('endRetry').onclick = () => { const p = new URLSearchParams(location.search); p.set('brief', '1'); location.href = 'index.html?' + p; };            // same level, same options, same seed
  $('endMenu').textContent = SB ? 'Sandbox' : 'Chapters'; $('endMenu').onclick = () => { location.href = SB ? 'sandbox.html' : 'menu.html'; };
  $('endscreen').style.display = 'flex'; (win && nextId ? $('endNext') : $('endRetry')).focus();
}
$('bRetire').style.display = WV.endless ? '' : 'none';
$('bRetire').onclick = () => { if (!G.over && confirm('Retire now and bank ' + wavesSurvived() + ' waves?')) finishGame('retired'); };
$('bMenu').onclick = () => { location.href = SB ? 'sandbox.html' : 'menu.html'; };
$('bMenu').textContent = SB ? '☰ Sandbox' : '☰ Chapters';
function showBriefing(onBegin) {                          // the chapter screen: name, briefing, what you must do. Pauses the game until "Begin".
  const el = $('briefing'), was = G.speed || 1; G.speed = 0; refreshButtons();
  $('briefTitle').textContent = LV.name || LV.id; $('briefText').textContent = LV.briefing || LV.start.welcome || '';
  $('briefGoals').innerHTML = WV.endless ? '<li>Survive as many waves as you can</li><li>A boss leads every 5th wave</li>' : OBJECTIVES.map(o => '<li>' + objText(o) + (o.optional ? ' <i>(bonus)</i>' : '') + '</li>').join('');
  el.style.display = 'flex';
  $('briefGo').onclick = () => { el.style.display = 'none'; G.speed = was; refreshButtons(); if (onBegin) onBegin(); };
}

function applyStart() {                                                              // what the level hands you at the start
  const st = LV.start;
  if (st.unlock === 'all' || qs.get('unlock') === '1') unlockAll();
  else if (Array.isArray(st.unlock)) for (const id of st.unlock) if (RESEARCH[id]) G.research.done[id] = true;
  for (let i = 0; i < (st.imps === undefined ? 3 : st.imps); i++) G.imps.push(new Imp(G.heart.x - 1 + i, G.heart.y + 2));
  say(st.welcome || 'Welcome, Keeper.');
}
buildMap(); scanTasks(); applyStart();
const LEVEL_ERRORS = validateLevel(LV); if (LEVEL_ERRORS.length) console.warn('Level "' + LV.id + '" has problems:\n - ' + LEVEL_ERRORS.join('\n - '));
refreshButtons();
if (qs.get('brief') === '1') showBriefing();

/* What the score should feel: calm until invaders are alive and awake, then tension grows with their number and their distance to the
 * Heart; a boss alive pins it high and brings the brass and timpani in (see Music in audio.js). A quiet dread precedes each wave. */
function audioMood() {
  const live = G.heroes.filter(h => !h.dead && !h.unconscious && h.state !== 'flee');
  let tension = 0, boss = 0;
  if (live.length) {
    let near = Infinity; for (const h of live) near = Math.min(near, Math.hypot(h.x - G.heart.x, h.y - G.heart.y));
    tension = 0.4 + 0.2 * Math.min(1, live.length / 6) + 0.4 * (1 - Math.min(1, Math.max(0, (near - 4) / 28)));
    if (live.some(h => h.boss)) { boss = 1; tension = Math.max(tension, 0.8); }
  } else if (G.gateOpen && G.wave < VAR.WAVES && G.nextWave - G.time < 12) tension = 0.25;
  return { tension, boss, over: G.over };
}
let last = performance.now(), acc = 0; const DT = 1 / 20;           // ticksPerSec analogue
let lastFrame = performance.now(); const DT_FRAME = (now) => { const d = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; return d; };
function frame(now) {
  acc += Math.min(0.25, (now - last) / 1000) * G.speed; last = now;
  while (acc >= DT) { step(DT); acc -= DT; }
  if (window.__render3d) window.__render3d(DT_FRAME(now)); else draw();
  if (window.Sound) Sound.setMood(audioMood());
  renderHud(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__ui = { get mouse() { return mouse; }, get tool() { return tool; }, inputDown, inputMove, inputUp, guideTarget };
window.__game = { LV, LEVEL_TABLE, CAMPAIGN, startFlee, finishGame, renderEnd, COND, OBJECTIVES, GUIDE, condState, updateObjectives, guideNow, guideTarget, showBriefing, validateLevel, buildMap, levelSize, levelPos, strike, Chicken, updateHatchery, prayRate, spriteOf, pickKind, RESEARCH, isAvail, unlockAll, addResearch, SKELETON, freeSlot, updateJail, knockOut, KO_SECONDS, TORTURE_SECONDS, SPELLS, SPELL_ORDER, castSpell, TRAPS, DOOR, placeThings, removeThings, doorAt, trapAt, HERO_LAND, W, H, G, HEROES, KINDS, spawnWave, Creature, Imp, Hero, hurt, los, T, TERRAIN, step, tagRect, build, scanTasks, findPath, capacity, goldReleased, damageTile, perApplication, VAR, audioMood, SPELL_SND, release };
