/* Level definitions. Each level is plain data that game.js turns into a map, starting resources, an invasion script and rules.
 * Add a level here and open it with  index.html?level=<id>.  See docs/06-levels.md for the full format.
 *
 *   id, name, tagline, briefing   text shown to the player (tagline: one line on the chapter menu; briefing: the chapter screen)
 *   stars                     optional { heart: 0.5, par: seconds }: tweaks the three-star rules (see docs/06-levels.md)
 *   seed                      default random seed (the URL's ?seed=N wins)
 *   terrain                   EITHER { generate: {...}, caverns: [...], size: [w, h] }  (random blobs of rock, gold and gems)
 *                             OR     { grid: [rows...] }                               (a hand-drawn text map, see below)
 *   heart, portal, gates      [x, y] centres of the 3x3 rooms (for grids these come from the H, P and X markers)
 *   start                     gold, mana, imps, unlock ('none' | 'all' | [item ids]), research (what is studied first), pretag, welcome
 *   waves                     prep (seconds from linking the Hero Gate to the first wave), interval, scale (extra strength per wave),
 *                             heroMult (all heroes), plan: one list of hero names per wave
 *   rules                     heartHp
 *   objectives                list of { type, ...params, text?, optional? }: the level is won when every non-optional one is done (default: beat every wave)
 *   guide                     list of { text, when?, at?, tool? }: tutorial hints shown one at a time
 *
 * Grid legend:  # rock   . earth   g gold seam   G gem seam   _ bare floor   o your floor   h hero land
 *               H Dungeon Heart centre   P Portal centre   X Hero Gate centre   (each marker becomes a 3x3 room)
 */
window.DEFAULT_LEVEL = 'classic';
// the campaign itself (the ten chapters and window.CAMPAIGN, their order) is in chapters.js
window.LEVELS = {

  // The original single level, reproduced from data. Same seed, same map, same invasion as before levels existed.
  classic: {
    id: 'classic', name: 'The First Dungeon', seed: 7, tagline: 'Five waves of heroes. Build well.',
    briefing: 'Tag earth near your Dungeon Heart and dig east to the purple Portal; claim it and creatures will come. Link a tunnel to the Hero Gate in the south only when you are ready for the invasion.',
    terrain: {
      size: [40, 28],
      generate: {
        rock: { count: 6, x: 4, xSpan: 32, y: 2, ySpan: 24, rMin: 1, rSpan: 2 },
        gold: { count: 7, x: 12, xSpan: 16, y: 2, ySpan: 24, rMin: 1, rSpan: 0 },
        gems: [{ x: 26, y: 4, r: 1 }],
      },
      caverns: [                                   // [x0, y0, x1, y1] rectangles of open floor and who owns them
        { rect: [2, 11, 10, 17], owner: 'keeper' },
        { rect: [29, 11, 35, 17], owner: 'none' },
        { rect: [19, 20, 25, 25], owner: 'hero' },
      ],
    },
    heart: [6, 14], portal: [32, 14], gates: [[22, 23]],
    start: { gold: 1000, mana: 300, imps: 3, unlock: 'none', research: 'prison', pretag: [[11, 14], [12, 14], [13, 14], [14, 14]],
      welcome: 'Welcome, Keeper. Tag earth near the Heart; dig east to the portal.' },
    waves: {
      prep: 75, interval: 110, scale: 0.12, heroMult: 1,
      plan: [['Knight', 'Archer'], ['Knight', 'Mage', 'Thief'], ['Knight', 'Dwarf', 'Guard', 'Monk'],
        ['Prince', 'Giant', 'Fairy', 'Archer', 'Thief'], ['King', 'Stone Knight', 'Guard', 'Fairy', 'Mage', 'Archer']],
    },
    rules: { heartHp: 2500 },
  },

  // A small hand-drawn map. It exists to prove the grid format and to give the tests a quick level; chapters will use the same shape.
  tiny: {
    id: 'tiny', name: 'Tiny Test Hall', seed: 1,
    briefing: 'A small test map written as a text grid. Dig east to the Portal, then to the Hero Gate, and survive two light waves.',
    terrain: { grid: [
      '##############################',
      '#............................#',
      '#.......#............#.......#',
      '#.......#...G........#.......#',
      '#............................#',
      '#.ooooo......_____.....hhhhh.#',
      '#.ooooo..g..._____.g...hhhhh.#',
      '#.ooHoo....g.__P__...g.hhXhh.#',
      '#.ooooo...g.._____..g..hhhhh.#',
      '#.ooooo......_____.....hhhhh.#',
      '#............................#',
      '#..................gg........#',
      '#........gg.....#............#',
      '#...............#.....G......#',
      '#............................#',
      '##############################'
    ] },
    start: { gold: 1500, mana: 400, imps: 4, unlock: 'all', research: null, pretag: [[8, 7], [9, 7]], welcome: 'A small test hall. Dig east.' },
    waves: { prep: 30, interval: 50, scale: 0.1, heroMult: 1, plan: [['Knight'], ['Knight', 'Archer']] },
    rules: { heartHp: 2000 },
  },

  // A lesson with no Portal, no Hero Gate and no heroes: it is won by its objectives alone, and a guide walks the player through it.
  // It proves objectives, the guide and gate-less levels; the Tutorial chapter will use the same pieces.
  lesson: {
    id: 'lesson', name: 'First Steps', seed: 3, tagline: 'Dig, mine and build. No heroes yet.',
    briefing: 'Your Dungeon Heart beats in the cavern at the left. Dig east through the earth, mine the gold seam, bank the gold in a Treasury and give your future creatures a Lair.',
    terrain: { grid: [
      '########################',
      '#......................#',
      '#......................#',
      '#.ooooooo..............#',
      '#.ooooooo..............#',
      '#.oooHooo....g.........#',
      '#.ooooooo..............#',
      '#.ooooooo..............#',
      '#......................#',
      '#......................#',
      '#......................#',
      '#......................#',
      '########################'
    ] },
    start: { gold: 600, mana: 200, imps: 3, unlock: 'none', research: null, pretag: [], welcome: 'Welcome, Keeper. Follow the hints at the bottom of the view.' },
    objectives: [
      { type: 'dug', n: 5, text: 'Dig out 5 tiles of earth and gold' },
      { type: 'claimed', n: 3, text: 'Let your imps claim 3 new floor tiles' },
      { type: 'room', room: 'treasury', n: 2, text: 'Build a Treasury of 2 tiles' },
      { type: 'room', room: 'lair', n: 2, text: 'Build a Lair of 2 tiles' },
      { type: 'gold', n: 1500, text: 'Bank 1500 gold in your Treasury' },
    ],
    guide: [
      { text: 'Welcome, Keeper! These hints will show you the basics. You command <b>imps</b>; they dig, mine, claim and carry. Press <b>Got it</b> to begin.' },
      { text: '<b>Dig / grab</b> is already chosen: drag a box over the earth just east of your Heart. Imps dig whatever is tagged. Right-drag untags.', tool: 'dig', at: [9, 5, 12, 5], when: { type: 'dug', n: 4 } },
      { text: 'Gold! Tag the glittering <b>gold seam</b> too. Imps mine it and carry the gold home.', tool: 'dig', at: [13, 5], when: { type: 'dug', n: 5 } },
      { text: 'Imps turn bare floor into your territory by <b>claiming</b> it. Watch them work, or keep digging.', at: [9, 5, 13, 5], when: { type: 'claimed', n: 3 } },
      { text: 'Gold needs somewhere to live. Choose <b>Treasury</b> and drag over two floor tiles inside your cavern.', tool: 'treasury', at: [2, 3, 3, 3], when: { type: 'room', room: 'treasury', n: 2 } },
      { text: 'Creatures need beds. Choose <b>Lair</b> and drag over two more tiles of your floor.', tool: 'lair', at: [2, 7, 3, 7], when: { type: 'room', room: 'lair', n: 2 } },
      { text: 'Almost there: wait for your imps to bank 1500 gold in the Treasury.', when: { type: 'gold', n: 1500 } },
    ],
    rules: { heartHp: 2000 },
  },
};

/* Scales a hand-drawn grid to twice its size in each direction (four times the area) and adds a little life: each cell becomes a 2x2 block, a gold or gem
 * seam keeps its tile count per block (two gold tiles, one gem), the marker of a Heart / Portal / Gate becomes a single marker with floor round it, and
 * (deterministically, from the chapter's name) extra gold seams, 2x2 rock pillars and a few hidden caves are sprinkled into the middle of big earth fields. The shape of the
 * map, its ridges and their gaps, stays exactly as drawn, so every chapter keeps its choke points and still teaches the same thing. */
window.enlargeGrid = function (grid, salt) {
  const h = grid.length, w = grid[0].length, FLOOR = { H: 'o', P: '_', X: 'h' }, out = [];
  let hs = 0; for (const ch of String(salt)) hs = (Math.imul(hs, 31) + ch.charCodeAt(0)) | 0;
  const rnd = (x, y, k) => { let v = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(k + 1 + hs, 2246822519); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  const cells = Array.from({ length: 2 * h }, () => new Array(2 * w));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = grid[y][x], q = (c === 'g' || c === 'G') ? [c, '.', '.', c === 'g' ? 'g' : '.'] : FLOOR[c] ? [c, FLOOR[c], FLOOR[c], FLOOR[c]] : [c, c, c, c];
    cells[2 * y][2 * x] = q[0]; cells[2 * y][2 * x + 1] = q[1]; cells[2 * y + 1][2 * x] = q[2]; cells[2 * y + 1][2 * x + 1] = q[3];
  }
  const H = 2 * h, W = 2 * w, field = (x, y, r) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const row = cells[y + j]; if (!row || row[x + i] !== '.') return false; } return true; };
  const mark = [];
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
    if (!field(x, y, 3)) continue; const r = rnd(x, y, 1);
    if (r < 0.006) mark.push([x, y, 'g']); else if (r < 0.011 && x % 2 === 0 && y % 2 === 0) mark.push([x, y, '#']);
  }
  const caves = [];                                                                               // a few hidden caves, to be found by digging: a small open floor with gold seams in its corners
  for (let y = 6; y < H - 6; y += 2) for (let x = 6; x < W - 6; x += 2) if (rnd(x, y, 2) < 0.0035 && field(x, y, 5) && !caves.some(([cx, cy]) => Math.abs(cx - x) < 14 && Math.abs(cy - y) < 10)) caves.push([x, y]);
  for (const [cx, cy] of caves) { for (let j = -1; j <= 1; j++) for (let i = -2; i <= 2; i++) cells[cy + j][cx + i] = '_'; cells[cy - 2][cx - 2] = cells[cy + 2][cx + 2] = cells[cy - 2][cx + 2] = 'g'; cells[cy + 2][cx - 2] = 'G'; }
  const used = new Set(); for (const [x, y, c] of mark) { const k = c === '#' ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]]; if (k.some(([i, j]) => used.has((y + j) * W + x + i))) continue;
    for (const [i, j] of k) { cells[y + j][x + i] = c; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) used.add((y + j + a) * W + x + i + b); } }
  for (let y = 0; y < H; y++) out.push(cells[y].join(''));
  return out;
};

/* ---------------------------------------------------------------------------------------------------------------------------------
 * The sandbox: a level made from a few options instead of written by hand (sandbox.html builds the URL, docs/06-levels.md explains it).
 *   index.html?level=sandbox&diff=normal&waves=8&gold=1500&mana=300&unlocks=none&seed=7        a fixed number of waves
 *   index.html?level=sandbox&diff=hard&endless=1                                               endless: waves never stop
 *   add &gates=N (1 to 6) for more Hero Gates round the edge of the map: each wave is then split between the Gates you have linked
 * It plays on its own 88 x 60 map (random blobs of rock and gold between fixed caverns, so every seed is a different dungeon; see SANDBOX_MAP).
 * ------------------------------------------------------------------------------------------------------------------------------- */
// Difficulty presets: all data. heroMult scales every hero, scale adds strength per wave, prep is the time from linking the Hero Gate to
// wave 1, interval the gap between waves (endless shortens it by 1.5 s a wave, down to minInterval), dig how many heroes tunnel through the earth
// towards your creatures and Heart (waves.dig, 0 none to 4 all: see docs/06-levels.md "Heroes that dig").
window.DIFFICULTY = {
  easy:   { name: 'Apprentice', blurb: 'Weaker heroes, a long head start.',            heroMult: 0.7,  scale: 0.10, prep: 150, interval: 120, minInterval: 80, heartHp: 3000, dig: 0 },
  normal: { name: 'Keeper',     blurb: 'The way the game was meant to be played.',     heroMult: 1.0,  scale: 0.12, prep: 100, interval: 100, minInterval: 65, heartHp: 2500, dig: 1 },
  hard:   { name: 'Overlord',   blurb: 'Tougher heroes, less time to prepare.',        heroMult: 1.25, scale: 0.14, prep: 75,  interval: 90,  minInterval: 55, heartHp: 2200, dig: 2 },
  brutal: { name: 'Dungeon Master', blurb: 'Heroes hit hard and hardly wait.',         heroMult: 1.5,  scale: 0.16, prep: 60,  interval: 80,  minInterval: 50, heartHp: 2000, dig: 3 },
};
window.SANDBOX_LIMITS = { waves: [3, 15, 8], gold: [200, 5000, 1500], mana: [0, 1000, 300], gates: [1, 6, 1] };      // [min, max, default]
/* The sandbox map: 88 x 60 tiles (the classic dungeon was 40 x 28), your Heart in the west, the Portal a short dig east of it and up to six Hero Gates spread round
 * the edge so the heroes can come from different directions: south, north, south-east, north-east, south-west, north-west. Each Gate gets its own hero cavern. */
window.SANDBOX_MAP = { size: [88, 60], heart: [6, 29], portal: [18, 29], gates: [[44, 54], [44, 5], [68, 54], [68, 5], [20, 54], [20, 5]], names: ['south', 'north', 'south-east', 'north-east', 'south-west', 'north-west'] };

/* The party for wave n (1, 2, 3, ...). Pure: the same n always gives the same party, so a seeded run stays reproducible and endless mode
 * needs no stored plan. Early waves are Knights and Archers; a new hero type joins every wave or two; the party grows to 9 (the
 * Hero Gate's pad); every 5th wave is led by a boss, the Prince on waves 5, 15, 25 ... and the King on 10, 20, 30 ... */
window.sandboxParty = function (n) {
  const POOL = ['Knight', 'Archer', 'Thief', 'Mage', 'Guard', 'Monk', 'Dwarf', 'Fairy', 'Giant', 'Stone Knight'], LEADERS = ['Knight', 'Guard', 'Dwarf', 'Giant', 'Stone Knight'];
  const avail = Math.min(POOL.length, 2 + Math.floor((n - 1) * 0.7)), size = Math.min(9, 2 + Math.floor((n - 1) * 0.8));
  const leaders = LEADERS.filter(k => POOL.indexOf(k) < avail), boss = n % 5 === 0 ? (n % 10 === 5 ? 'Prince' : 'King') : null;
  const party = [boss || leaders[(n - 1) % leaders.length]];
  for (let j = 1; j < size; j++) party.push(POOL[(2 * n + j) % avail]);      // consecutive slots of the pool, so each type turns up once per cycle
  return party;
};

/* Builds the sandbox level from URLSearchParams (or a plain object). Out-of-range numbers are clamped, unknown words fall back to the defaults. */
window.makeSandbox = function (params) {
  const get = (k) => params && (typeof params.get === 'function' ? params.get(k) : params[k]), L = window.SANDBOX_LIMITS;
  const num = (k) => { const lim = L[k], v = parseInt(get(k), 10); return Number.isFinite(v) ? Math.max(lim[0], Math.min(lim[1], v)) : lim[2]; };
  const diff = window.DIFFICULTY[get('diff')] ? get('diff') : 'normal', D = window.DIFFICULTY[diff], endless = get('endless') === '1', n = num('waves');
  const M = window.SANDBOX_MAP, seed = parseInt(get('seed'), 10), ng = num('gates'), gates = M.gates.slice(0, ng), [gw, gh] = M.size;
  const lanes = [[11, M.heart[1] - 2, M.portal[0] - 4, M.heart[1] + 2]];                      // no rock is dropped on the way between the Heart and the Portal, nor on the way down from each Gate: every seed can be dug through
  for (const [x, y] of gates) lanes.push([x - 2, Math.min(y, M.heart[1]), x + 2, Math.max(y, M.heart[1])]);
  const caverns = [{ rect: [M.heart[0] - 3, M.heart[1] - 2, M.heart[0] + 3, M.heart[1] + 2], owner: 'keeper' }, { rect: [M.portal[0] - 3, M.portal[1] - 3, M.portal[0] + 3, M.portal[1] + 3], owner: 'none' }];
  for (const [x, y] of gates) caverns.push({ rect: [x - 3, y - 3, x + 3, y + 3], owner: 'hero' });
  const base = { terrain: { size: M.size, caverns, generate: {
      rock: { count: 44, x: 4, xSpan: gw - 8, y: 2, ySpan: gh - 4, rMin: 1, rSpan: 2 }, gold: { count: 46, x: 12, xSpan: gw - 24, y: 2, ySpan: gh - 4, rMin: 1, rSpan: 0 },
      gems: [{ x: 30, y: 12, r: 1 }, { x: 58, y: 46, r: 1 }, { x: 44, y: 30, r: 1 }, { x: 20, y: 44, r: 1 }, { x: 66, y: 12, r: 1 }], lanes } },
    heart: M.heart, portal: M.portal, gates, start: { pretag: [[M.heart[0] + 4, M.heart[1]], [M.heart[0] + 5, M.heart[1]], [M.heart[0] + 6, M.heart[1]], [M.heart[0] + 7, M.heart[1]]] } };
  const lv = {
    id: 'sandbox', name: endless ? 'Endless Siege' : 'Sandbox', seed: Number.isFinite(seed) ? seed : 7, sandbox: { diff, endless, gates: ng },
    tagline: 'Your own rules.', terrain: base.terrain, heart: base.heart, portal: base.portal, gates: base.gates,
    briefing: (endless ? 'Heroes will keep coming, stronger and in greater numbers, with a boss every fifth wave (the Prince, then the King). How many waves can your dungeon survive?'
      : 'Survive ' + n + ' waves of heroes.') + ' Difficulty: ' + D.name + '. Dig east to the Portal, build your dungeon, and link a tunnel to a Hero Gate when you are ready.'
      + (ng > 1 ? ' There are ' + ng + ' Hero Gates (' + M.names.slice(0, ng).join(', ') + '): every wave is split between the ones you have linked.' : ' The Hero Gate lies to the ' + M.names[0] + '.'),
    start: { gold: num('gold'), mana: num('mana'), imps: 3, unlock: get('unlocks') === 'all' ? 'all' : 'none', research: 'prison', pretag: base.start.pretag,
      welcome: endless ? 'Endless Siege (' + D.name + '). Build, then open the Hero Gate.' : 'Sandbox (' + D.name + ', ' + n + ' waves).' },
    waves: { prep: D.prep, interval: D.interval, scale: D.scale, heroMult: D.heroMult, dig: D.dig, plan: [] },
    rules: { heartHp: D.heartHp },
  };
  if (endless) { lv.waves.endless = true; lv.waves.minInterval = D.minInterval; lv.objectives = []; }
  else for (let i = 1; i <= n; i++) lv.waves.plan.push(window.sandboxParty(i));
  return lv;
};
if (new URLSearchParams(location.search).get('level') === 'sandbox') window.LEVELS.sandbox = window.makeSandbox(new URLSearchParams(location.search));
