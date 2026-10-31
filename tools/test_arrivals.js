#!/usr/bin/env node
/* Headless checks for "creatures arrive only when the right buildings exist" (web/game.js NEEDS / pickKind, the Monsters tab's "Who will come",
 * docs/06-levels.md "Who comes through the Portal").
 *   node tools/test_arrivals.js     (needs playwright with chromium)
 *   1. a bare Lair draws only the kinds that need nothing (Goblin, Spider, Fly), over many picks
 *   2. each room opens its own kinds, at its own size: Library, Temple, Hatchery, Treasury, Prison, Torture Chamber, and the Reaper needs two rooms
 *   3. the draw is deterministic for a seed, and rules.arrivals "any" restores the old behaviour (every kind)
 *   4. a real run through the Portal: only base kinds without rooms; after a Library a Warlock arrives and the log says why
 *   5. the Monsters tab lists who will come, with what each kind needs, and updates as you build
 *   6. validation of rules.arrivals
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8781, ROOT = `http://localhost:${PORT}/`;
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
      await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
      await page.goto(ROOT + 'index.html?sound=0&view=2d&nosave=1&guide=0&' + query, { waitUntil: 'load' }); await sleep(300);
      await page.evaluate(() => { window.__game.G.speed = 0; }); return page;
    };
    // helper run inside the page: build `n` tiles of a room on your claimed floor, then draw `picks` kinds and report the names seen
    const SETUP = () => {
      window.__t = {
        build(room, n) { const g = __game, G = g.G; G.gold = 1e6; let left = n; for (let y = 0; y < g.H && left > 0; y++) for (let x = 0; x < g.W && left > 0; x++) { const t = G.map[y * g.W + x]; if (t.t === g.T.PATH && t.owner === 1 && !t.door && !t.trap && (x + y) % 3) { g.build(g.T[room.toUpperCase()], x, y, x, y); left--; } } return n - left; },
        draw(picks = 600) { const seen = {}; for (let i = 0; i < picks; i++) { const k = __game.pickKind().name; seen[k] = (seen[k] || 0) + 1; } return Object.keys(seen).sort(); },
      };
    };

    console.log('1. a bare Lair');
    let page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const base = await page.evaluate(() => { __game.unlockAll(); const t = __t; t.build('lair', 4); return { names: t.draw(), lair: __game.G.map.filter(x => x.t === __game.T.LAIR).length }; });
    check('with nothing but a Lair, 600 draws give exactly Goblin, Spider and Fly', base.names.join() === 'Fly,Goblin,Spider' && base.lair === 4, base.names.join());

    console.log('2. each room opens its kinds, at its size');
    // sizes just below the need change nothing
    let r = await page.evaluate(() => { __t.build('library', 2); return __t.draw(); });
    check('a Library of 2 tiles is not enough for the Warlock or the Dark Elf', !r.includes('Warlock') && !r.includes('Dark Elf'), r.join());
    r = await page.evaluate(() => { __t.build('library', 1); return __t.draw(); });
    check('a Library of 3 tiles brings the Warlock and the Dark Elf, and nothing else new', r.includes('Warlock') && r.includes('Dark Elf') && r.length === 5 && !r.includes('Vampire'), r.join());
    r = await page.evaluate(() => { __t.build('temple', 3); return __t.draw(); });
    check('a Temple of 3 tiles brings the Vampire and the Dark Angel', r.includes('Vampire') && r.includes('Dark Angel') && r.length === 7 && !r.includes('Troll'), r.join());
    r = await page.evaluate(() => { __t.build('hatchery', 2); return __t.draw(); });
    check('a Hatchery of 2 brings the Salamander but not yet the Bile Demon', r.includes('Salamander') && !r.includes('Bile Demon'), r.join());
    r = await page.evaluate(() => { __t.build('hatchery', 2); return __t.draw(); });
    check('a Hatchery of 4 brings the Bile Demon', r.includes('Bile Demon') && r.length === 9, r.join());
    r = await page.evaluate(() => { __t.build('treasury', 3); return __t.draw(); });
    check('a Treasury of 3 brings the Troll but not yet the Black Knight', r.includes('Troll') && !r.includes('Black Knight'), r.join());
    r = await page.evaluate(() => { __t.build('treasury', 2); return __t.draw(); });
    check('a Treasury of 5 brings the Black Knight', r.includes('Black Knight') && r.length === 11, r.join());
    r = await page.evaluate(() => { __t.build('torture', 2); return __t.draw(); });
    check('a Torture Chamber of 2 brings the Mistress, but not the Reaper (it needs a Prison too)', r.includes('Mistress') && !r.includes('Reaper') && !r.includes('Assassin'), r.join());
    r = await page.evaluate(() => { __t.build('prison', 2); return __t.draw(); });
    check('a Prison of 2 brings the Assassin and, with the Torture Chamber, the Reaper: all 14 kinds', r.includes('Assassin') && r.includes('Reaper') && r.length === 14, r.length + ' kinds');
    await page.close();

    console.log('3. deterministic, and the "any" switch');
    const seq = async () => { const p = await open('level=classic&seed=11'); await p.evaluate(SETUP); const out = await p.evaluate(() => { __game.unlockAll(); __t.build('lair', 3); __t.build('library', 3); return Array.from({ length: 40 }, () => __game.pickKind().name).join(); }); await p.close(); return out; };
    const a = await seq(), b = await seq();
    check('the same seed and the same buildings give the same 40 arrivals, run twice', a === b && a.split(',').length === 40, a.slice(0, 80));
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const any = await page.evaluate(() => { const before = __t.draw(); __game.LV.rules.arrivals = 'any'; const after = __t.draw(); __game.LV.rules.arrivals = 'rooms'; return { before, after }; });
    check('rules.arrivals "any" lets every kind come with no rooms at all; "rooms" is the rule again afterwards', any.before.length === 3 && any.after.length === 14, any.before.length + ' / ' + any.after.length);
    await page.close();

    console.log('4. a real run through the Portal');
    page = await open('level=classic&seed=7');
    const run = await page.evaluate(() => {
      const g = __game, G = g.G; G.gold = 1e6; g.unlockAll(); G.portalOwned = true; G.nextSpawn = 0;
      for (let y = 11; y <= 17; y++) for (let x = 2; x <= 10; x++) { const t = G.map[y * g.W + x]; if (t.t === g.T.PATH && t.owner === 1 && (x + y) % 2 === 0) g.build(g.T.LAIR, x, y, x, y); }
      G.heroes.length = 0; G.gates.forEach(x => x.open = false);
      const names = new Set(), watch = () => { for (const c of G.creatures) names.add(c.name); };
      for (let s = 0; s < 400; s += 0.05) { g.step(0.05); G.creatures.forEach(c => { c.anger = 0; c.hunger = 0; }); watch(); }       // keep them happy: only who ARRIVES is being tested
      const first = [...names].sort(), count1 = G.creatures.length;
      for (let y = 11; y <= 17; y++) for (let x = 2; x <= 10; x++) { const t = G.map[y * g.W + x]; if (t.t === g.T.PATH && t.owner === 1 && (x + y) % 2 === 1 && G.map.filter(q => q.t === g.T.LIBRARY).length < 3) g.build(g.T.LIBRARY, x, y, x, y); }
      const libs = G.map.filter(q => q.t === g.T.LIBRARY).length; names.clear(); G.creatures.length = 0; G.log.length = 0; G.heardOf = {}; G.nextSpawn = 0;
      for (let s = 0; s < 1200 && !names.has('Warlock') && !names.has('Dark Elf'); s += 0.05) { g.step(0.05); G.creatures.forEach(c => { c.anger = 0; c.hunger = 0; }); if (G.creatures.length > 12) G.creatures.length = 6; watch(); }
      return { first, count1, libs, second: [...names].sort(), heard: G.log.filter(m => /has heard of your/.test(m)), log: G.log.slice(0, 6) };
    });
    check('400 s with a Lair and nothing else: only Goblins, Spiders and Flies arrive', run.first.length > 0 && run.first.every(n => ['Goblin', 'Spider', 'Fly'].includes(n)), run.first.join() + ' (' + run.count1 + ' creatures)');
    check('with a Library of 3, a Warlock or a Dark Elf arrives, and the log says why', run.libs === 3 && run.second.some(n => n === 'Warlock' || n === 'Dark Elf') && run.heard.some(m => /Library/.test(m)), JSON.stringify([run.libs, run.second, run.heard]));
    await page.close();

    console.log('5. the Monsters tab says who will come');
    page = await open('level=classic&seed=7');
    const ui = await page.evaluate(() => {
      document.getElementById('tab_monsters').click(); document.getElementById('rv_arrivals').click();
      const read = () => [...document.querySelectorAll('#roster .kchip')].map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), no: e.classList.contains('no'), title: e.title }));
      return { before: read() };
    });
    const w = ui.before.find(c => /Warlock/.test(c.t)), gob = ui.before.find(c => /Goblin/.test(c.t)), rp = ui.before.find(c => /Reaper/.test(c.t));
    check('14 kinds are listed; the Goblin is available, the Warlock says it needs a Library of 3, the Reaper two rooms', ui.before.length === 14 && !gob.no && /✓/.test(gob.t) && w.no && /needs Library 3/.test(w.t) && /Prison 2 \+ Torture Chamber 2/.test(rp.t), JSON.stringify([ui.before.length, gob, w, rp]));
    check('the tooltip explains it in words', /comes once you own a Library of 3 tiles/.test(w.title), w.title);
    const after = await page.evaluate(() => { const g = __game, G = g.G; G.gold = 1e6; let n = 0; for (let y = 0; y < g.H && n < 3; y++) for (let x = 0; x < g.W && n < 3; x++) { const t = G.map[y * g.W + x]; if (t.t === g.T.PATH && t.owner === 1 && (x + y) % 3) { g.build(g.T.LIBRARY, x, y, x, y); n++; } }
      g.renderRoster(true); return [...document.querySelectorAll('#roster .kchip')].map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), no: e.classList.contains('no') })); });
    check('after a Library of 3 the Warlock and the Dark Elf are available', !after.find(c => /Warlock/.test(c.t)).no && !after.find(c => /Dark Elf/.test(c.t)).no && after.find(c => /Vampire/.test(c.t)).no, JSON.stringify(after.filter(c => !c.no).map(c => c.t.split(' ')[0])));
    await page.evaluate(() => document.getElementById('rv_creatures').click());
    check('"Creatures" brings the roster back', await page.evaluate(() => document.querySelectorAll('#roster .kchip').length === 0 && document.getElementById('rv_creatures').classList.contains('on')));
    await page.close();

    console.log('6. validation');
    page = await open('level=classic&seed=7');
    const v = await page.evaluate(() => { const g = __game, ok = (a) => { const lv = JSON.parse(JSON.stringify(g.LEVEL_TABLE.classic)); lv.rules.arrivals = a; return g.validateLevel(lv); }; return { any: ok('any'), rooms: ok('rooms'), bad: ok('sometimes') }; });
    check('rules.arrivals accepts "any" and "rooms" and rejects anything else', v.any.length === 0 && v.rooms.length === 0 && v.bad.some(e => /rules.arrivals/.test(e)), JSON.stringify(v));
    await page.close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall arrival checks passed'); process.exit(fails ? 1 : 0);
})();
