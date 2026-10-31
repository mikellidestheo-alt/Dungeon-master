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

/* ---------------------------------------------------------------------------------------------------------------------------------
 * The sandbox: a level made from a few options instead of written by hand (sandbox.html builds the URL, docs/06-levels.md explains it).
 *   index.html?level=sandbox&diff=normal&waves=8&gold=1500&mana=300&unlocks=none&seed=7        a fixed number of waves
 *   index.html?level=sandbox&diff=hard&endless=1                                               endless: waves never stop
 *   add &gates=2 for a second Hero Gate in the north: each wave is then split between the Gates you have linked
 * It plays on the classic map (random blobs, so every seed is a different dungeon).
 * ------------------------------------------------------------------------------------------------------------------------------- */
// Difficulty presets: all data. heroMult scales every hero, scale adds strength per wave, prep is the time from linking the Hero Gate to
// wave 1, interval the gap between waves (endless shortens it by 1.5 s a wave, down to minInterval).
window.DIFFICULTY = {
  easy:   { name: 'Apprentice', blurb: 'Weaker heroes, a long head start.',            heroMult: 0.7,  scale: 0.10, prep: 150, interval: 120, minInterval: 80, heartHp: 3000 },
  normal: { name: 'Keeper',     blurb: 'The way the game was meant to be played.',     heroMult: 1.0,  scale: 0.12, prep: 100, interval: 100, minInterval: 65, heartHp: 2500 },
  hard:   { name: 'Overlord',   blurb: 'Tougher heroes, less time to prepare.',        heroMult: 1.25, scale: 0.14, prep: 75,  interval: 90,  minInterval: 55, heartHp: 2200 },
  brutal: { name: 'Dungeon Master', blurb: 'Heroes hit hard and hardly wait.',         heroMult: 1.5,  scale: 0.16, prep: 60,  interval: 80,  minInterval: 50, heartHp: 2000 },
};
window.SANDBOX_LIMITS = { waves: [3, 15, 8], gold: [200, 5000, 1500], mana: [0, 1000, 300] };      // [min, max, default]

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
  const base = JSON.parse(JSON.stringify(window.LEVELS.classic)), seed = parseInt(get('seed'), 10), twin = get('gates') === '2';
  if (twin) { base.terrain.caverns.push({ rect: [19, 2, 25, 6], owner: 'hero' }); base.gates.push([22, 4]); }      // a second hero cavern and Gate in the north
  const lv = {
    id: 'sandbox', name: endless ? 'Endless Siege' : 'Sandbox', seed: Number.isFinite(seed) ? seed : 7, sandbox: { diff, endless, gates: twin ? 2 : 1 },
    tagline: 'Your own rules.', terrain: base.terrain, heart: base.heart, portal: base.portal, gates: base.gates,
    briefing: (endless ? 'Heroes will keep coming, stronger and in greater numbers, with a boss every fifth wave (the Prince, then the King). How many waves can your dungeon survive?'
      : 'Survive ' + n + ' waves of heroes.') + ' Difficulty: ' + D.name + '. Dig east to the Portal, build your dungeon, and link a tunnel to the Hero Gate in the south when you are ready.'
      + (twin ? ' A second Gate in the north opens too once you tunnel to it, and every wave is then split between the two.' : ''),
    start: { gold: num('gold'), mana: num('mana'), imps: 3, unlock: get('unlocks') === 'all' ? 'all' : 'none', research: 'prison', pretag: base.start.pretag,
      welcome: endless ? 'Endless Siege (' + D.name + '). Build, then open the Hero Gate.' : 'Sandbox (' + D.name + ', ' + n + ' waves).' },
    waves: { prep: D.prep, interval: D.interval, scale: D.scale, heroMult: D.heroMult, plan: [] },
    rules: { heartHp: D.heartHp },
  };
  if (endless) { lv.waves.endless = true; lv.waves.minInterval = D.minInterval; lv.objectives = []; }
  else for (let i = 1; i <= n; i++) lv.waves.plan.push(window.sandboxParty(i));
  return lv;
};
if (new URLSearchParams(location.search).get('level') === 'sandbox') window.LEVELS.sandbox = window.makeSandbox(new URLSearchParams(location.search));
