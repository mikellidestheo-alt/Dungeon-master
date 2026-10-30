/* Level definitions. Each level is plain data that game.js turns into a map, starting resources, an invasion script and rules.
 * Add a level here and open it with  index.html?level=<id>.  See docs/06-levels.md for the full format.
 *
 *   id, name, briefing        text shown to the player
 *   seed                      default random seed (the URL's ?seed=N wins)
 *   terrain                   EITHER { generate: {...}, caverns: [...], size: [w, h] }  (random blobs of rock, gold and gems)
 *                             OR     { grid: [rows...] }                               (a hand-drawn text map, see below)
 *   heart, portal, gates      [x, y] centres of the 3x3 rooms (for grids these come from the H, P and X markers)
 *   start                     gold, mana, imps, unlock ('none' | 'all' | [item ids]), research (what is studied first), pretag, welcome
 *   waves                     prep (seconds from linking the Hero Gate to the first wave), interval, scale (extra strength per wave),
 *                             heroMult (all heroes), plan: one list of hero names per wave
 *   rules                     heartHp
 *
 * Grid legend:  # rock   . earth   g gold seam   G gem seam   _ bare floor   o your floor   h hero land
 *               H Dungeon Heart centre   P Portal centre   X Hero Gate centre   (each marker becomes a 3x3 room)
 */
window.DEFAULT_LEVEL = 'classic';
window.LEVELS = {

  // The original single level, reproduced from data. Same seed, same map, same invasion as before levels existed.
  classic: {
    id: 'classic', name: 'The First Dungeon', seed: 7,
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
};
