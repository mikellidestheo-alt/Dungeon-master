#!/usr/bin/env node
/* Headless checks for "Lair and Hatchery size cap the army" (web/game.js armyLimit, the Portal's spawn rule, the Heart's larder, the HUD).
 *   node tools/test_capacity.js     (needs playwright with chromium)
 *   1. capacity = min(Portal 15, beds, food): the numbers, with and without the level's rules.food switch
 *   2. the Portal stops at the limit, says so once, and more Lair / Hatchery tiles raise it again
 *   3. nobody is thrown out when the limit later drops
 *   4. the top bar and the Monsters tab show x/limit and which limit bites, with a tooltip naming all three
 *   5. nobody starves at capacity over ten minutes (with a Hatchery, and on the Heart's larder alone)
 *   6. validation of rules.food
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8782, ROOT = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    await sleep(800);
    const problems = [];
    const open = async (query) => {
      const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GL Driver Message/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });
      await page.goto(ROOT + 'index.html?sound=0&view=2d&nosave=1&guide=0&' + query, { waitUntil: 'load' }); await sleep(300);
      await page.evaluate(() => { window.__game.G.speed = 0; }); return page;
    };
    const SETUP = () => {                                                                  // in the page: build n tiles of a room on claimed floor; run seconds keeping everybody content
      window.__t = {
        build(room, n) { const g = __game, G = g.G; G.gold = 1e6; g.unlockAll(); let left = n; for (let y = 0; y < g.H && left > 0; y++) for (let x = 0; x < g.W && left > 0; x++) { const t = G.map[y * g.W + x]; if (t.t === g.T.PATH && t.owner === 1 && !t.door && !t.trap && (x + y) % 3) { g.build(g.T[room.toUpperCase()], x, y, x, y); left--; } } return n - left; },
        run(secs, calm) { const g = __game, G = g.G; for (let s = 0; s < secs; s += 0.05) { g.step(0.05); if (calm) for (const c of G.creatures) { c.anger = 0; c.hunger = 0; } G.gold = Math.max(G.gold, 1e5); } },
      };
    };

    console.log('1. the numbers');
    let page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const hud = async () => { await sleep(200); return page.evaluate(() => { const q = (id) => document.getElementById(id); return { n: q('hCreatures').textContent, max: q('hMax').textContent, by: q('hLimit').textContent, title: q('hCreaturesBox').title, full: q('hCreaturesBox').classList.contains('full') }; }); };
    const lim = async () => page.evaluate(() => { const G = __game.G; return { n: G.creatures.length, log: G.log.filter(m => /dungeon is full|draws no more/.test(m)).length }; });
    await page.evaluate(() => { __t.build('lair', 4); const G = __game.G; G.portalOwned = true; G.nextSpawn = 0; __t.run(1, true); });
    let h = await hud();
    check('4 Lair tiles and no Hatchery: min(15, 4 beds, 3 food) = 3, limited by food', h.max === '3' && h.by === 'food', JSON.stringify(h));
    check('the tooltip names all three limits', /beds 4/.test(h.title) && /food 3/.test(h.title) && /Portal 15/.test(h.title), h.title);
    await page.close();

    console.log('2. the Portal stops at the limit');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    await page.evaluate(() => { __t.build('lair', 4); const G = __game.G; G.portalOwned = true; G.nextSpawn = 0; __t.run(400, true); });
    let l = await lim(); h = await hud();
    check('400 s with 4 beds and no Hatchery: exactly 3 creatures, never more', l.n === 3 && h.n === '3', JSON.stringify([l, h.n]));
    check('the log says the dungeon is full (food), once', l.log === 1 && h.full, JSON.stringify(l));
    const ev = await page.evaluate(() => __game.G.log.find(m => /dungeon is full/.test(m)));
    check('the log line names what to build', /there is food for no more.*Hatchery/.test(ev), ev);
    await page.evaluate(() => { __t.build('hatchery', 1); __t.run(60, true); });
    l = await lim(); h = await hud();
    check('a Hatchery tile adds food 4: now the 4 beds are the limit and the 4th creature comes in', l.n === 4 && h.max === '4' && h.by === 'beds', JSON.stringify([l, h]));
    const ev2 = await page.evaluate(() => { __t.run(60, true); return __game.G.log.find(m => /dungeon is full/.test(m)); });
    check('then the log says every bed is taken: build more Lair', /every bed is taken.*Lair/.test(ev2), ev2);
    await page.evaluate(() => { __t.build('lair', 3); __t.run(120, true); });
    l = await lim(); h = await hud();
    check('3 more Lair tiles: 7 beds, 7 food: the 7th creature arrives and the limit is 7', l.n === 7 && h.max === '7', JSON.stringify([l, h]));
    await page.evaluate(() => { __t.build('lair', 12); __t.build('hatchery', 5); __t.run(600, true); });
    l = await lim(); h = await hud();
    check('with plenty of both, the Portal itself stops the army at 15', l.n === 15 && h.max === '15' && h.by === 'Portal', JSON.stringify([l, h]));
    check('and says so', await page.evaluate(() => __game.G.log.some(m => /Portal draws no more than 15/.test(m))));
    await page.close();

    console.log('3. nobody is thrown out when the limit drops');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const drop = await page.evaluate(() => {
      const g = __game, G = g.G; __t.build('lair', 8); __t.build('hatchery', 2); G.portalOwned = true; G.nextSpawn = 0; __t.run(400, true); const full = G.creatures.length;
      let n = 0; for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) { const t = G.map[y * g.W + x]; if ((t.t === g.T.LAIR) && n < 5) { t.t = g.T.PATH; n++; } }       // five beds are lost
      __t.run(300, true); return { full, after: G.creatures.length };
    });
    check('8 creatures, then 5 beds vanish: all 8 are still there, and no new ones come', drop.full === 8 && drop.after === 8, JSON.stringify(drop));
    await page.close();

    console.log('4. the top bar and the Monsters tab');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    await page.evaluate(() => { __t.build('lair', 6); __t.build('hatchery', 1); const G = __game.G; G.portalOwned = true; G.nextSpawn = 0; __t.run(200, true); document.getElementById('tab_monsters').click(); __game.renderRoster(true); });
    const ui = await page.evaluate(() => { __game.renderRoster(true); const s = document.getElementById('rosterSum'); return { sum: s.textContent, title: s.querySelector('small').title }; });
    h = await hud();
    check('top bar: 6 beds, food 3 + 4: 6/6 beds', h.n === '6' && h.max === '6' && h.by === 'beds', JSON.stringify(h));
    check('the Monsters tab shows the same: "Creatures 6/6 beds" with the explanation as a tooltip', /Creatures 6\/6 beds/.test(ui.sum) && /beds 6, food 7, Portal 15/.test(ui.title), JSON.stringify(ui));
    await page.close();

    console.log('5. nobody starves at capacity (10 minutes)');
    const starve = async (rooms, name) => {
      const p = await open('level=classic&seed=7'); await p.evaluate(SETUP);
      const r = await p.evaluate(([lair, hatch]) => {
        const g = __game, G = g.G; __t.build('lair', lair); __t.build('hatchery', hatch); G.portalOwned = true; G.nextSpawn = 0;
        for (let x = 11; x <= 28; x++) { const t = G.map[14 * g.W + x]; t.t = g.T.PATH; t.owner = 1; t.hp = 1000; t.gold = 0; t.tag = 0; }       // a tunnel from the cavern to the Portal, so arrivals can reach beds and food
        let guard = 0; while (G.creatures.length < 15 && guard++ < 400) { G.nextSpawn = 0; __t.run(0.1, true); }       // fill the dungeon to its limit, quickly
        const n0 = G.creatures.length; G.creatures.forEach(c => { c.hunger = 20; c.anger = 0; });
        let furious = 0, maxAnger = 0, hungryEnd = 0; const unsub = G.log.unshift.bind(G.log); G.log.unshift = (m) => { if (/furious/.test(m)) furious++; return unsub(m); };
        __t.run(600, false);
        for (const c of G.creatures) { maxAnger = Math.max(maxAnger, c.anger); if (c.hunger >= g.VAR.HUNGRY_AT) hungryEnd++; }
        return { n0, n1: G.creatures.length, furious, maxAnger: Math.round(maxAnger), hungryEnd, chickens: G.chickens.length };
      }, rooms);
      await p.close(); check(name, r.n1 === r.n0 && r.furious === 0 && r.maxAnger < 1600 && r.hungryEnd <= Math.ceil(r.n0 / 4), JSON.stringify(r)); return r;
    };
    await starve([30, 2], '2 Hatchery tiles: 11 creatures, ten minutes, nobody leaves, nobody ends angry');
    await starve([30, 1], '1 Hatchery tile: 7 creatures, ten minutes, nobody leaves, nobody ends angry');
    await starve([30, 0], 'no Hatchery: the Heart\'s larder keeps its 3 creatures fed for ten minutes');
    await starve([30, 4], '4 Hatchery tiles: 15 creatures (the Portal limit), ten minutes, nobody leaves, nobody ends angry');

    console.log('6. rules.food and validation');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const food = await page.evaluate(() => {
      const g = __game, G = g.G; __t.build('lair', 9); const before = (() => { G.portalOwned = true; G.nextSpawn = 0; __t.run(400, true); return G.creatures.length; })();
      g.LV.rules.food = false; G.nextSpawn = 0; __t.run(400, true); const after = G.creatures.length; g.LV.rules.food = true;
      const ok = (v) => { const lv = JSON.parse(JSON.stringify(g.LEVEL_TABLE.classic)); lv.rules.food = v; return g.validateLevel(lv); };
      return { before, after, good: ok(false), bad: ok('no'), tutorial: g.LEVEL_TABLE.tutorial.rules.food, portal: g.LEVEL_TABLE.portal.rules.food, hatchery: g.LEVEL_TABLE.hatchery.rules.food };
    });
    check('rules.food false removes the food limit: 3 creatures on the larder, 9 once it is off (beds are then the limit)', food.before === 3 && food.after === 9, JSON.stringify(food));
    check('rules.food must be true or false', food.good.length === 0 && food.bad.some(e => /rules.food/.test(e)));
    check('the Tutorial and chapter 2 switch food off; chapter 3, the Hatchery chapter, does not', food.tutorial === false && food.portal === false && food.hatchery === undefined);
    await page.close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall capacity checks passed'); process.exit(fails ? 1 : 0);
})();
