#!/usr/bin/env node
/* Headless checks for the ten campaign chapters (web/chapters.js, docs/06-levels.md "The campaign").
 *   node tools/test_chapters.js     (needs playwright with chromium)
 *   1. the list: ten unique chapters in order, each valid, with a name, tagline, briefing, bonus objective and a guide
 *   2. the maps: sizes grow, one Heart, one Portal, the right number of Gates, every marker reachable by digging, enough gold
 *   3. the curve: more waves, stronger heroes, less preparation, shorter gaps, more entrances
 *   4. teaching: each chapter introduces its own room / hero / mechanic, and unlocks what it needs
 *   5. the guides point at the right tiles (dig targets are earth, room targets are your floor)
 *   6. every chapter runs for a minute without a hitch
 *   7. the Tutorial, played for real by a script that follows its own guide, from the first dig to Victory
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8772, ROOT = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const IDS = ['tutorial', 'portal', 'hatchery', 'library', 'traps', 'prison', 'temple', 'gates', 'siege', 'crusade'];

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    await sleep(800);
    const problems = [];
    const open = async (query) => {
      const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
      await page.goto(ROOT + 'index.html?sound=0&view=2d&nosave=1&' + query, { waitUntil: 'load' }); await sleep(300);
      await page.evaluate(() => { window.__game.G.speed = 0; }); return page;
    };

    console.log('1. the list');
    let page = await open('level=tutorial');
    const info = await page.evaluate((IDS) => { const g = window.__game, T = g.LEVEL_TABLE;
      return { order: g.CAMPAIGN.slice(), errs: IDS.map(id => [id, T[id] ? g.validateLevel(T[id]) : ['missing']]).filter(x => x[1].length), names: IDS.map(id => T[id].name), tags: IDS.map(id => !!T[id].tagline), briefs: IDS.map(id => (T[id].briefing || '').length),
        bonus: IDS.map(id => (T[id].objectives || []).filter(o => o.optional).length), guides: IDS.map(id => (T[id].guide || []).length), nobj: IDS.map(id => T[id].objectives.length), sizes: IDS.map(id => g.levelSize(T[id])), seeds: IDS.map(id => T[id].seed) }; }, IDS);
    check('ten chapters in the intended order', info.order.join() === IDS.join(), info.order.join());
    check('every chapter validates', info.errs.length === 0, JSON.stringify(info.errs));
    check('names are unique; every chapter has a tagline and a briefing of real length', new Set(info.names).size === 10 && info.tags.every(Boolean) && info.briefs.every(n => n > 150), info.names.join(' | '));
    check('every chapter after the Tutorial has a bonus objective for the third star', info.bonus.slice(1).every(n => n >= 1) && info.bonus[0] === 0, info.bonus.join());
    check('every chapter has a guide and 5-9 objectives', info.guides.every(n => n >= 2) && info.nobj.every(n => n >= 5 && n <= 9), info.guides.join() + ' / ' + info.nobj.join());
    check('the Tutorial has a long guide (11 steps)', info.guides[0] === 11, info.guides[0]);

    console.log('2. the maps');
    const maps = await page.evaluate((IDS) => IDS.map(id => { const g = window.__game, lv = g.LEVEL_TABLE[id], grid = lv.terrain.grid, [w, h] = g.levelSize(lv), pos = g.levelPos(lv), count = (c) => grid.join('').split(c).length - 1;
      const seen = new Set(), key = (x, y) => y * w + x, q = [pos.heart]; seen.add(key(...pos.heart));
      while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h || '#G'.includes(grid[ny][nx]) || seen.has(key(nx, ny))) continue; seen.add(key(nx, ny)); q.push([nx, ny]); } }
      const pads = [pos.heart, pos.portal, ...pos.gates].every(([x, y]) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (grid[y + dy][x + dx] === '#') return false; return true; });
      const ridges = []; for (let x = 1; x < w - 1; x++) { const rock = grid.filter(r => r[x] === '#').length; if (rock > h * 0.55) ridges.push(x); }
      return { w, h, H: count('H'), P: count('P'), X: count('X'), gold: count('g'), gems: count('G'), reach: [pos.portal, ...pos.gates].every(([x, y]) => seen.has(key(x, y))), pads, ridges: ridges.length, keeperFloor: count('o') }; }), IDS);
    check('exactly one Heart and one Portal on every map, pads clear of rock', maps.every(m => m.H === 1 && m.P === 1 && m.pads), JSON.stringify(maps.map(m => [m.H, m.P, m.pads])));
    check('Gates per chapter: 1,1,1,1,1,1,1,2,2,3', maps.map(m => m.X).join() === '1,1,1,1,1,1,1,2,2,3', maps.map(m => m.X).join());
    check('the Portal and every Gate can be reached by digging from the Heart', maps.every(m => m.reach));
    check('maps grow from 30x17 to 52x32', maps[0].w === 30 && maps[0].h === 17 && maps[9].w === 52 && maps[9].h === 32 && maps.every((m, i) => i === 0 || (m.w > maps[i - 1].w && m.h >= maps[i - 1].h)), maps.map(m => m.w + 'x' + m.h).join(' '));
    check('rock ridges make choke points from chapter 2 on', maps[0].ridges === 0 && maps.slice(1).every(m => m.ridges >= 2), maps.map(m => m.ridges).join());
    check('enough gold seams: 2 in the Tutorial, rising to 12 (each seam is worth 2000)', maps[0].gold === 2 && maps.slice(1).every(m => m.gold >= 6) && maps[9].gold >= 12 && maps.every((m, i) => i < 2 || m.gold >= maps[i - 1].gold - 1), maps.map(m => m.gold).join());
    check('a roomy home cavern in every map', maps.every(m => m.keeperFloor >= 40), maps.map(m => m.keeperFloor).join());

    console.log('3. the difficulty curve');
    const cur = await page.evaluate((IDS) => IDS.map(id => { const lv = window.__game.LEVEL_TABLE[id], w = lv.waves; return { waves: w.plan.length, waiting: !!w.waiting, mult: w.heroMult, prep: w.prep, gap: w.interval, scale: w.scale, heart: lv.rules.heartHp, gold: lv.start.gold, size: w.plan.reduce((n, p) => n + p.length, 0), maxParty: Math.max(...w.plan.map(p => p.length)) }; }), IDS);
    const up = (k, from = 0) => cur.every((c, i) => i <= from || c[k] >= cur[i - 1][k]), down = (k, from = 0) => cur.every((c, i) => i <= from || c[k] <= cur[i - 1][k]);
    check('waves per chapter rise: 1, 3, 4, 4, 5, 6, 6, 7, 8, 10', cur.map(c => c.waves).join() === '1,3,4,4,5,6,6,7,8,10', cur.map(c => c.waves).join());
    check('hero strength never falls: x0.5 ... x1.3', up('mult') && cur[0].mult === 0.5 && cur[9].mult === 1.3, cur.map(c => c.mult).join());
    check('preparation never grows from chapter 2 on: 160 s down to 60 s; the Tutorial has none because its Knight is already waiting at the Gate', down('prep', 1) && cur[1].prep === 160 && cur[9].prep === 60 && cur[0].waiting && cur[0].prep === 0 && cur.slice(1).every(c => !c.waiting), cur.map(c => c.prep).join());
    check('the gap between waves never grows: 110 down to 90', down('gap') && cur[0].gap === 110 && cur[9].gap === 90, cur.map(c => c.gap).join());
    check('extra strength per wave stays between 0 and 0.15 (it is also used to balance chapters whose waves are heavy early or late)', cur.every(c => c.scale >= 0 && c.scale <= 0.15), cur.map(c => c.scale).join());
    check('the Heart is tougher in the early chapters, never above 3000', cur[0].heart === 3000 && cur.every(c => c.heart <= 3000) && down('heart'), cur.map(c => c.heart).join());
    check('more heroes overall every chapter (1 in the Tutorial, 65 or more in the finale)', up('size') && cur[0].size === 1 && cur[9].size >= 65, cur.map(c => c.size).join());
    check('a party never exceeds the Gate pad (9)', cur.every(c => c.maxParty <= 9), cur.map(c => c.maxParty).join());
    check('you start richer in later chapters', up('gold') && cur[0].gold === 800 && cur[9].gold === 2500, cur.map(c => c.gold).join());

    console.log('4. each chapter teaches one thing');
    const T = await page.evaluate((IDS) => IDS.map(id => { const lv = window.__game.LEVEL_TABLE[id], heroes = new Set(lv.waves.plan.flat()), objs = lv.objectives, has = (type, k, v) => objs.some(o => o.type === type && !o.optional && (k === undefined || o[k] === v));
      return { heroes: [...heroes], unlock: lv.start.unlock, room: ['treasury', 'lair', 'hatchery', 'library', 'prison', 'torture', 'temple'].filter(r => has('room', 'room', r)), research: objs.filter(o => o.type === 'research' && !o.optional).map(o => o.item), doors: has('doors'), traps: has('traps'), spells: has('spells'), gate2: objs.some(o => o.type === 'gate' && o.n === 2), portal: has('portal'), creatures: has('creatures'), survive: has('survive') }; }), IDS);
    const first = (hero) => T.findIndex(t => t.heroes.includes(hero));
    check('hero debuts: Dwarf ch5, Monk ch6, Fairy ch7, Giant ch8, Prince and Stone Knight ch9, King ch10', [first('Dwarf'), first('Monk'), first('Fairy'), first('Giant'), first('Prince'), first('Stone Knight'), first('King')].join() === '4,5,6,7,8,8,9', [first('Dwarf'), first('Monk'), first('Fairy'), first('Giant'), first('Prince'), first('Stone Knight'), first('King')].join());
    check('the Tutorial\'s one hero is a Knight; chapters 1-4 meet only Knights, Archers, Thieves, Mages and Guards', T[0].heroes.join() === 'Knight' && T.slice(0, 4).every(t => t.heroes.every(h => ['Knight', 'Archer', 'Thief', 'Mage', 'Guard'].includes(h))), T.slice(0, 4).map(t => t.heroes.join('+')).join(' | '));
    check('Tutorial: dig, Treasury, Lair, gold, Portal, Gate, survive', T[0].room.join() === 'treasury,lair' && T[0].portal && T[0].survive && !T[0].creatures);
    check('chapter 2 asks for Lair and creatures; 3 for the Hatchery; 4 for the Library and research', T[1].room.includes('lair') && T[1].creatures && T[2].room.includes('hatchery') && T[3].room.includes('library') && T[3].research.join() === 'gas,heal', JSON.stringify([T[1].room, T[2].room, T[3].room, T[3].research]));
    check('chapter 5 asks for doors and traps; 6 for Prison and Torture; 7 for the Temple and spells', T[4].doors && T[4].traps && T[5].room.includes('prison') && T[5].room.includes('torture') && T[6].room.includes('temple') && T[6].spells);
    check('chapter 8 asks for both Gates', T[7].gate2 && !T[8].gate2 && !T[9].gate2);
    const u = T.map(t => t.unlock);
    check('unlocks grow: nothing for 1-4, traps from 5, Prison/Torture from 6, the Temple and spells from 7, everything from 8', u.slice(0, 4).every(x => x === 'none') && u[4].join() === 'gas,bolt' && ['prison', 'torture'].every(k => u[5].includes(k)) && !u[4].includes('prison') && ['temple', 'heal', 'haste', 'lightning', 'rally'].every(k => u[6].includes(k)) && !u[5].includes('temple') && u.slice(7).every(x => x === 'all'), JSON.stringify(u));
    check('chapter 4 starts with no research set: you choose', await page.evaluate(() => window.__game.LEVEL_TABLE.library.start.research === null));
    check('every chapter must be survived to be won', T.every(t => t.survive));
    const beds = await page.evaluate((IDS) => IDS.map(id => { const lv = window.__game.LEVEL_TABLE[id], o = lv.objectives, n = (type, k, v, opt) => Math.max(0, ...o.filter(x => x.type === type && (k === undefined || x[k] === v) && (opt === undefined || !!x.optional === opt)).map(x => x.n || 0)); return { food: lv.rules.food, lair: n('room', 'room', 'lair'), hatch: n('room', 'room', 'hatchery'), want: n('creatures', undefined, undefined, false), bonus: n('creatures', undefined, undefined, true) }; }), IDS);
    check('the army a chapter asks for fits its beds and food: Lair n >= creatures n in chapters 2-3 (and the bonus army has room to grow), food limit off in chapters 1-2 and on from 3, where Hatchery 4 feeds 3 + 16', beds[1].lair >= beds[1].want && beds[2].lair >= beds[2].want && beds[0].food === false && beds[1].food === false && beds.slice(2).every(b => b.food === undefined) && 3 + 4 * beds[2].hatch >= Math.max(beds[2].want, beds[2].bonus), JSON.stringify(beds.slice(0, 3)));

    console.log('5. the guides point at the right tiles');
    const gd = await page.evaluate((IDS) => { const out = []; for (const id of IDS) { const lv = window.__game.LEVEL_TABLE[id], grid = lv.terrain.grid;
      (lv.guide || []).forEach((s, i) => { if (!s.at) return; const a = s.at, x0 = a[0], y0 = a[1], x1 = a.length > 3 ? a[2] : a[0], y1 = a.length > 3 ? a[3] : a[1]; const cells = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(grid[y][x]);
        const want = s.tool === 'dig' ? (c) => '.g'.includes(c) : ['treasury', 'lair', 'hatchery', 'library', 'temple', 'prison', 'torture'].includes(s.tool) ? (c) => c === 'o' : () => true;
        if (!cells.every(want)) out.push(id + ' step ' + (i + 1) + ' (' + s.tool + '): ' + cells.join('')); }); } return out; }, IDS);
    check('dig markers cover earth or gold; room markers cover your floor', gd.length === 0, gd.join('; '));
    await page.close();

    console.log('6. every chapter runs');
    for (const id of IDS) {
      page = await open('level=' + id);
      const r = await page.evaluate(() => { const g = window.__game, G = g.G; for (let s = 0; s < 60; s += 0.05) g.step(0.05); return { imps: G.imps.length, gates: G.gates.length, over: G.over, heart: G.heartHp, objs: g.OBJECTIVES.length, nan: [G.gold, G.mana, G.time].some(v => !Number.isFinite(v)) }; });
      check(id + ': 60 s untouched: imps alive, nothing over, no NaN', r.imps >= 3 && r.over === null && r.heart === g_(r).heart && !r.nan, JSON.stringify(r)); await page.close();
    }
    function g_(r) { return { heart: r.heart }; }

    console.log('7. the Tutorial, played by a script that follows its guide');
    page = await open('level=tutorial');
    const play = await page.evaluate(() => {
      const g = window.__game, G = g.G, out = { steps: [], marks: [] }, run = (secs, until) => { for (let s = 0; s < secs && !G.over; s += 0.05) { g.step(0.05); if (until && until()) return true; } return !!(until && until()); };
      const mark = (what) => out.marks.push([what, Math.round(G.time), G.guideStep]);
      const k0 = G.heroes[0], gt = G.gates[0];                                           // the Knight waiting on the pad from the first second
      out.wait = { n: G.heroes.length, name: k0 && k0.name, waiting: !!(k0 && k0.waiting), onPad: !!k0 && Math.abs(k0.x - gt.x) <= 1.6 && Math.abs(k0.y - gt.y) <= 1.6, hud: G.heroes.filter(h => !h.waiting).length, wave: G.wave, tension: g.audioMood().tension, log: G.log.some(m => /waits at the Hero Gate/.test(m)), x: k0.x, y: k0.y };
      mark('start'); G.guideStep++;                                                       // "Got it"
      g.tagRect(9, 8, 11, 8, true); run(60, () => G.stats.dug >= 3); mark('dug 3');
      g.tagRect(12, 8, 12, 8, true); run(60, () => G.stats.dug >= 4 && G.stats.claimed >= 3); mark('seam, claimed');
      g.build(g.T.TREASURY, 2, 5, 3, 5); run(2); mark('treasury');
      run(120, () => G.gold >= 1500); mark('gold 1500');
      g.build(g.T.LAIR, 2, 11, 3, 11); run(2); mark('lair');
      g.tagRect(13, 8, 20, 8, true); run(120, () => G.portalOwned); mark('portal');
      run(60, () => G.creatures.length >= 1); mark('first creature');
      out.still = { dx: Math.hypot(k0.x - out.wait.x, k0.y - out.wait.y), hp: k0.hp === k0.maxHp, tension: g.audioMood().tension, wave: G.wave, over: G.over };      // minutes later, still standing there, still calm
      g.tagRect(9, 11, 12, 11, true); out.gateAt = run(120, () => G.gateOpen); mark('gate linked'); out.guideAtGate = G.guideStep;
      out.creaturesAtGate = G.creatures.length; const linked = G.time; out.rel = { waiting: k0.waiting, wave: G.wave, nextWave: G.nextWave, tension: g.audioMood().tension, hud: G.heroes.filter(h => !h.waiting).length };
      run(1); out.moved = { path: !!k0.path || k0.state === 'fight', state: k0.state, d: Math.hypot(k0.x - out.wait.x, k0.y - out.wait.y) };      // one second after the link he is on his way
      out.won = run(400, () => G.over === 'victory'); mark('over'); out.over = G.over; out.since = Math.round(G.time - linked); out.heart = G.heartHp; out.kills = G.kills;
      out.guideEnd = G.guideStep; out.guideLen = g.GUIDE.length; out.done = Object.keys(G.objDone).length; out.nobj = g.OBJECTIVES.length; out.result = G.result; out.log = G.log.slice(0, 4);
      return out; });
    check('the script follows each guide step in order, never skipping ahead', play.marks.map(m => m[2]).every((v, i, a) => i === 0 || v >= a[i - 1]), JSON.stringify(play.marks));
    check('it reached the Portal, a creature and the Gate', play.gateAt && play.marks.some(m => m[0] === 'first creature'), JSON.stringify(play.marks.map(m => m[0] + '@' + m[1])));
    check('the Knight stood on the Gate pad from the first second: idle, counted by neither the HUD nor wave 0, and the score was calm', play.wait.n === 1 && play.wait.name === 'Knight' && play.wait.waiting && play.wait.onPad && play.wait.hud === 0 && play.wait.wave === 0 && play.wait.tension === 0 && play.wait.log, JSON.stringify(play.wait));
    check('minutes later he had not moved a step or taken damage, and the score was still calm', play.still.dx === 0 && play.still.hp && play.still.tension === 0 && play.still.wave === 0 && !play.still.over, JSON.stringify(play.still));
    check('the moment the tunnel linked the Gate he was released as wave 1 with no countdown, and the music turned tense', !play.rel.waiting && play.rel.wave === 1 && play.rel.nextWave === Infinity && play.rel.tension > 0.3 && play.rel.hud === 1, JSON.stringify(play.rel));
    check('one second after the link he is walking towards the Heart', play.moved.path && play.moved.d > 0.3, JSON.stringify(play.moved));
    check('the Knight was beaten within two minutes of the link and the level was won', play.won && play.over === 'victory' && play.since < 120, `${play.since}s after the link`);
    check('every one of the 7 objectives and all 11 guide steps were completed', play.done === 7 && play.nobj === 7 && play.guideEnd === play.guideLen, `${play.done}/${play.nobj}, guide ${play.guideEnd}/${play.guideLen}`);
    check('the Heart is untouched: three stars', play.result && play.result.stars === 3 && play.heart === 3000, `heart ${play.heart}, stars ${play.result && play.result.stars}`);
    check('even a script that never hesitates needs over a minute of game time (the countdown is gone, so a first-time player takes about 3 to 5)', play.result.time >= 60 && play.result.time <= 240, play.result.time + ' s (' + Math.round(play.result.time / 6) / 10 + ' min)');
    await page.close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall chapter checks passed'); process.exit(fails ? 1 : 0);
})();
