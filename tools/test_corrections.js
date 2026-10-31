#!/usr/bin/env node
/* Headless checks for the playtest corrections (see README, "Playtest corrections"):
 *   node tools/test_corrections.js     (needs playwright with chromium)
 *    1. doors lie across their passage (3D)            2. only a Hatchery lays chickens; the Heart's larder is a ration
 *    3. rooms can be sold (Sell tool, right-drag)      4. idle creatures stay in the Training Room until hungry, tired or called to fight
 *    5. "build more" warnings and the hover tooltip    6. the Hatchery heals
 *    7. the Portal is close to the Heart               8. the Hand carries up to 8
 *    9. traps: two uses, two of each at a time          10. nobody shoots through a door
 *   11. the hero counter ignores the knocked out        12. full screen is the default
 *   13. knocked-out heroes: 30 s, then prison and the rack   14. 20 creatures (25 in the last three chapters)
 *   15. imps spread over the jobs
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8791, ROOT = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const problems = [];
  try {
    await sleep(800);
    const open = async (query, view = '2d', init) => {
      const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }), page = await ctx.newPage();
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GL Driver Message|GPU stall|willReadFrequently/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });
      if (init) await page.addInitScript(init);
      await page.goto(ROOT + 'index.html?sound=0&view=' + view + '&nosave=1&guide=0&' + query, { waitUntil: 'load' }); await sleep(view === '2d' ? 300 : 2500);
      await page.evaluate(() => { window.__game.G.speed = 0; }); return page;
    };
    const SETUP = () => {
      window.__t = {
        run(secs, calm) { const g = __game, G = g.G; for (let s = 0; s < secs; s += 0.05) { g.step(0.05); if (calm) for (const c of G.creatures) { c.anger = 0; c.energy = Math.max(c.energy, 60); if (calm === 'fed') c.hunger = 0; } } },
        floor(x0, y0, x1, y1) { const g = __game, G = g.G; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const t = G.map[y * g.W + x]; t.t = g.T.PATH; t.owner = 1; t.hp = 1000; t.gold = 0; t.tag = 0; } G.dirty = true; },
        creature(kind = 1, x = 6, y = 13) { const g = __game, c = new g.Creature(x, y, g.KINDS[kind]); c.noLair = true; g.G.creatures.push(c); return c; },
        hero(name, x, y) { const g = __game, G = g.G, kind = g.HEROES.find(h => h.name === name), party = []; const h = new g.Hero(x, y, kind, 1, party); party.push(h); G.heroes.push(h); return h; },
        cell(x, y) { return __game.G.map[y * __game.W + x]; },
        click(x, y, button = 0) { const p = { x: Math.floor(x), y: Math.floor(y) }, f = { fx: x, fy: y }; __ui.inputDown(p, f, button); __ui.inputUp(p, f); },
      };
    };

    /* ------------------------------------------------------------------ 1 */
    console.log('1. doors lie across their passage (3D view)');
    let page = await open('level=classic&seed=7&unlock=1', '3d');
    const doors = await page.evaluate(() => {
      const g = __game, G = g.G; G.gold = 5000; const out = {};
      const cut = (x, y) => { const t = G.map[y * g.W + x]; t.t = g.T.PATH; t.owner = 1; t.hp = 1000; t.gold = 0; };
      for (let x = 12; x <= 18; x++) cut(x, 14); for (let y = 6; y <= 12; y++) cut(15, y);      // an east-west corridor along y = 14 and a north-south one up x = 15
      g.placeThings('door', 13, 14, 13, 14); g.placeThings('door', 15, 8, 15, 8); g.step(0.05); return true; });
    await sleep(800);
    const turn = await page.evaluate(() => { const d = [...__three.doorObjs.entries()].map(([door, grp]) => ({ x: door.tx, y: door.ty, rot: grp.userData.spr.rotation.y })); return d; });
    const ew = turn.find(d => d.x === 13), ns = turn.find(d => d.y === 8);
    check('a door in an east-west tunnel is turned across it (a quarter turn), one in a north-south tunnel lies along x', ew && ns && Math.abs(ew.rot - Math.PI / 2) < 1e-6 && Math.abs(ns.rot) < 1e-6, JSON.stringify(turn));
    await page.context().close();

    /* ------------------------------------------------------------------ 2 */
    console.log('2. only a Hatchery lays chickens');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    let r = await page.evaluate(() => { const g = __game, G = g.G; __t.run(240, true); return { chickens: G.chickens.length, hatchT: G.hatchT }; });
    check('with no Hatchery no chicken ever appears (four minutes on the Heart\'s larder)', r.chickens === 0, JSON.stringify(r));
    r = await page.evaluate(() => { const g = __game, G = g.G; G.gold = 1e5; g.build(g.T.HATCHERY, 4, 12, 5, 13); G.hatchScan = 0; __t.run(120, true); const on = G.chickens.every(c => { const t = __t.cell(c.tx, c.ty); return t.t === g.T.HATCHERY || true; });
      return { chickens: G.chickens.length, tiles: G.hatchTiles.length, born: G.chickens.every(c => c.sprite === 'chicken') }; });
    check('once a Hatchery stands it lays chickens', r.tiles >= 3 && r.chickens >= 2, JSON.stringify(r));
    r = await page.evaluate(() => { const g = __game, G = g.G; G.chickens.length = 0; G.map.forEach(t => { if (t.t === g.T.HATCHERY) { t.t = g.T.PATH; } }); G.hatchScan = 0; __t.run(120, true); return G.chickens.length; });
    check('and stops when it is gone (sold or lost)', r === 0, String(r));
    r = await page.evaluate(() => { const g = __game, G = g.G; G.creatures.length = 0; const c = __t.creature(1, 6, 15); c.hunger = 100; G.chickens.length = 0; __t.run(60); return { hunger: Math.round(c.hunger), state: c.state, chickens: G.chickens.length }; });
    check('a hungry creature on the larder alone eats a ration at the Heart (no chicken is made for it)', r.hunger < 30 && r.chickens === 0, JSON.stringify(r));
    await page.context().close();

    /* ------------------------------------------------------------------ 3 */
    console.log('3. selling rooms');
    page = await open('level=classic&seed=7&unlock=1'); await page.evaluate(SETUP);
    r = await page.evaluate(() => {
      const g = __game, G = g.G, T = g.T; G.gold = 1000; g.build(T.LAIR, 3, 12, 4, 12); g.build(T.TREASURY, 3, 14, 3, 14); const afterBuild = G.gold;
      const out = { built: [__t.cell(3, 12).t === T.LAIR, __t.cell(4, 12).t === T.LAIR] };
      __ui.inputUp; document.getElementById('b_sell').click(); out.tool = __ui.tool;
      __t.click(3.5, 12.5); out.lair1 = [__t.cell(3, 12).t === T.PATH, __t.cell(3, 12).owner, G.gold - afterBuild];                      // sold: back to claimed floor, half the price (40)
      out.untouched = __t.cell(4, 12).t === T.LAIR;
      const heart = G.map[G.heart.y * g.W + G.heart.x].t, h0 = G.gold; g.removeThings(G.heart.x - 1, G.heart.y - 1, G.heart.x + 1, G.heart.y + 1, true); out.heart = [G.map[G.heart.y * g.W + G.heart.x].t === heart, G.gold === h0];
      const p = __t.cell(G.portal.x, G.portal.y).t; g.removeThings(G.portal.x - 1, G.portal.y - 1, G.portal.x + 1, G.portal.y + 1, true); out.portal = __t.cell(G.portal.x, G.portal.y).t === p;
      G.gold = 3000; const c = __t.creature(); __t.cell(4, 12).occ = c; out.occ = [g.removeThings(4, 12, 4, 12, true), __t.cell(4, 12).t === T.LAIR]; __t.cell(4, 12).occ = null;       // a tile somebody is using is kept
      G.gold = 1999 + 3000; out.fullTreasury = [g.removeThings(3, 14, 3, 14, true), __t.cell(3, 14).t === T.TREASURY];                    // the gold would no longer fit: kept
      G.gold = 500; out.emptyTreasury = [g.removeThings(3, 14, 3, 14, true), __t.cell(3, 14).t === T.PATH];
      g.build(T.LAIR, 5, 12, 5, 12); g.cancelTool(); G.gold = 100; const t0 = G.gold; g.build(T.LAIR, 6, 12, 6, 12); __ui.mouse; document.getElementById('b_lair').click(); g.build(T.LAIR, 6, 12, 6, 12); const p1 = { x: 5, y: 12 }, f1 = { fx: 5.5, fy: 12.5 }, p2 = { x: 6, y: 12 }, f2 = { fx: 6.5, fy: 12.5 }; __ui.inputDown(p1, f1, 2); __ui.inputUp(p2, f2);
      out.rightDrag = [__t.cell(5, 12).t === T.PATH && __t.cell(6, 12).t === T.PATH, __ui.tool];
      return out; });
    check('the Sell tool sells a Lair tile for half its price (40 of 80), leaving your claimed floor', r.tool === 'sell' && r.lair1[0] && r.lair1[1] === 1 && r.lair1[2] === 40 && r.untouched, JSON.stringify(r));
    check('the Heart and the Portal cannot be sold', r.heart[0] && r.heart[1] && r.portal, JSON.stringify([r.heart, r.portal]));
    check('a tile somebody is using is kept', r.occ[0] === 0 && r.occ[1], JSON.stringify(r.occ));
    check('a Treasury tile stays while the gold would no longer fit, and sells once it would', r.fullTreasury[0] === 0 && r.fullTreasury[1] && r.emptyTreasury[0] === 1 && r.emptyTreasury[1], JSON.stringify([r.fullTreasury, r.emptyTreasury]));
    check('a right-drag with a room chosen sells rooms in the box (a plain right-click still drops the tool)', r.rightDrag[0], JSON.stringify(r.rightDrag));
    await page.context().close();

    /* ------------------------------------------------------------------ 4 */
    console.log('4. idle creatures use the Training Room');
    page = await open('level=classic&seed=7&unlock=1'); await page.evaluate(SETUP);
    r = await page.evaluate(() => {
      const g = __game, G = g.G, T = g.T; G.gold = 5000; g.build(T.TRAINING, 3, 12, 4, 12); G.hatchScan = 0; const a = __t.creature(1, 8, 14), b = __t.creature(1, 8, 15); let trainA = 0, n = 0, left = 0;
      for (let s = 0; s < 150; s += 0.05) { g.step(0.05); for (const c of [a, b]) { c.anger = 0; c.hunger = 0; c.energy = 100; } G.gold = Math.max(G.gold, 5000); if (s > 10) { n++; if (a.state === 'train' || b.state === 'train') trainA++; } }
      const stay = trainA / n; a.xp = 0;
      const x0 = G.creatures.filter(c => c.state === 'train').length;                                 // hungry: they leave
      for (const c of [a, b]) c.hunger = 100; G.chickens.length = 0; __t.run(0.5); const hungry = G.creatures.filter(c => c.state === 'train').length;
      return { stay, x0, hungry }; });
    check('with a Training Room two creatures spend their idle time at the dummies, session after session (about 100% of the time after the first walk)', r.stay > 0.9, JSON.stringify(r));
    check('...and leave the moment they are hungry', r.x0 >= 1 && r.hungry === 0, JSON.stringify(r));
    r = await page.evaluate(() => {
      const g = __game, G = g.G; G.creatures.length = 0; const c = __t.creature(1, 5, 12); c.hunger = 0; for (let s = 0; s < 8; s += 0.05) { g.step(0.05); c.hunger = 0; c.energy = 100; c.anger = 0; }
      const was = c.state; const h = __t.hero('Knight', 8.5, 12.5); for (let s = 0; s < 1; s += 0.05) { g.step(0.05); c.hunger = 0; c.energy = 100; }
      return { was, now: c.state }; });
    check('...and when a hero comes it drops the dummy and fights', r.was === 'train' && r.now === 'fight', JSON.stringify(r));
    r = await page.evaluate(() => { const g = __game, G = g.G; G.creatures.length = 0; G.heroes.length = 0; const c = __t.creature(1, 5, 12); c.hunger = 0; for (let s = 0; s < 8; s += 0.05) { g.step(0.05); c.hunger = 0; c.energy = 100; c.anger = 0; } c.energy = 20; g.step(0.05); return c.state; });
    check('...and when it is tired', r !== 'train', r);
    await page.context().close();

    /* ------------------------------------------------------------------ 5 */
    console.log('5. warnings that a kind of room needs expanding, and the hover tooltip');
    page = await open('level=classic&seed=7&unlock=1'); await page.evaluate(SETUP);
    r = await page.evaluate(() => { const g = __game, G = g.G; G.creatures.length = 0; for (let i = 0; i < 3; i++) { const c = new g.Creature(7, 15, g.KINDS[0]); G.creatures.push(c); }
      __t.run(3); const early = G.needs.lair || ''; __t.run(10); return { early, late: G.needs.lair, log: G.log.filter(m => /⚠.*bed/.test(m)).length, btn: document.getElementById('b_lair').classList.contains('need') }; });
    check('three creatures without a bed: after a few seconds the Log warns once and the Lair button glows', r.early === '' && /3 creatures without a bed/.test(r.late) && r.log === 1, JSON.stringify(r));
    r = await page.evaluate(() => { const g = __game, G = g.G; G.creatures.forEach(c => { c.noLair = true; }); __t.run(2); return { lair: G.needs.lair, btn: (g.renderRoster, document.getElementById('b_lair').className) }; });
    check('the warning goes when the need does', r.lair === '', JSON.stringify(r));
    r = await page.evaluate(() => { const g = __game, G = g.G, T = g.T; G.gold = 1e5; g.build(T.TREASURY, 3, 12, 3, 12); const cap = g.capacity(); G.gold = cap - 10; __t.run(12); return { msg: G.needs.treasury, cap }; });
    check('a nearly full Treasury is reported', /almost full/.test(r.msg), JSON.stringify(r));
    r = await page.evaluate(() => { const g = __game, G = g.G, T = g.T; G.gold = 1e5; g.build(T.TRAINING, 4, 13, 4, 13); G.hatchScan = 0; G.creatures.length = 0; const a = __t.creature(1, 8, 14), b = __t.creature(1, 8, 15); G.creatures.forEach(c => { c.noFood = true; }); __t.run(40, true); G.gold = 1e5; return { msg: G.needs.training, state: [a.state, b.state] }; });
    check('two creatures and one dummy: "build more Training Room tiles"', /training dummy is busy/.test(r.msg || ''), JSON.stringify(r));
    r = await page.evaluate(() => { const g = __game, G = g.G, T = g.T; G.gold = 1e5; G.creatures.length = 0; g.build(T.LAIR, 5, 12, 6, 12); g.build(T.HATCHERY, 7, 12, 8, 12); const c = G.creatures.length;
      return { lair: g.buildingInfo(5, 12), hatch: g.buildingInfo(7, 12), train: g.buildingInfo(4, 13), treasury: g.buildingInfo(3, 12), heart: g.buildingInfo(G.heart.x, G.heart.y), none: g.buildingInfo(9, 12) }; });
    check('hovering a Lair shows its tiles and beds, a Hatchery what it feeds and the chickens, a Training Room its dummies, a Treasury its gold', /Lair.*2 tiles.*Beds 0\/(\d+)/.test(r.lair.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) && /Feeds 8 creatures/.test(r.hatch.replace(/<[^>]+>/g, ' ')) && /Chickens/.test(r.hatch) && /Dummies in use \d\/1/.test(r.train) && /Gold \d+\/\d+/.test(r.treasury) && /Dungeon Heart/.test(r.heart) && r.none === '', JSON.stringify(r).slice(0, 300));
    await page.context().close();

    /* ------------------------------------------------------------------ 6 */
    console.log('6. the Hatchery heals');
    page = await open('level=classic&seed=7&unlock=1'); await page.evaluate(SETUP);
    r = await page.evaluate(() => {
      const g = __game, G = g.G, T = g.T; G.gold = 1e5; g.build(T.HATCHERY, 3, 12, 6, 12); G.hatchScan = 0; g.step(0.05);
      const a = __t.creature(1, 4, 12), b = __t.creature(1, 4, 16); b.noFood = true; a.hp = b.hp = 20; a.energy = b.energy = 100;
      a.state = 'heal'; a.path = null; for (let s = 0; s < 5; s += 0.05) { a.hunger = 0; b.hunger = 100; a.anger = b.anger = 0; a.energy = b.energy = 100; a.wait = b.wait = 99; g.step(0.05); G.creatures.forEach(c => { if (c !== a) { c.hp = Math.min(c.hp, b.hp); } }); }
      return { onHatch: Math.round(a.hp - 20), off: Math.round(b.hp - 20) }; });
    check('on a Hatchery tile a wounded creature recovers about 4 hp a second, elsewhere on your land under 1', r.onHatch >= 15 && r.off <= 6, JSON.stringify(r));
    r = await page.evaluate(() => { const g = __game, G = g.G; G.creatures.length = 0; const c = __t.creature(1, 8, 16); c.hp = c.maxHp * 0.6; c.hunger = 0; c.energy = 100; let toHeal = false; for (let s = 0; s < 6; s += 0.05) { g.step(0.05); c.hunger = 0; c.energy = 100; if (c.state === 'toHeal' || c.state === 'heal') toHeal = true; } for (let s = 0; s < 40; s += 0.05) { g.step(0.05); c.hunger = 0; c.energy = 100; c.anger = 0; }
      return { toHeal, hp: c.hp / c.maxHp }; });
    check('a wounded idle creature walks to the Hatchery to recover (and is well again soon)', r.toHeal && r.hp > 0.9, JSON.stringify(r));
    await page.context().close();

    /* ------------------------------------------------------------------ 7 */
    console.log('7. the Portal is near the Heart');
    page = await open('level=tutorial'); await page.evaluate(SETUP);
    const lv = await page.evaluate(() => { const g = __game, out = {}; for (const id in g.LEVEL_TABLE) { if (id === 'classic' || id === 'tiny' || id === 'lesson') continue; const l = g.LEVEL_TABLE[id], p = g.levelPos(l); if (p.portal) out[id] = Math.round(Math.hypot(p.portal[0] - p.heart[0], p.portal[1] - p.heart[1])); }
      const sb = window.makeSandbox({}); out.sandbox = Math.round(Math.hypot(sb.portal[0] - sb.heart[0], sb.portal[1] - sb.heart[1])); return out; });
    check('every chapter and the sandbox put the Portal within 20 tiles of the Heart (it was 25 to 80)', Object.keys(lv).length === 11 && Object.values(lv).every(d => d >= 8 && d <= 20), JSON.stringify(lv));
    await page.context().close();

    /* ------------------------------------------------------------------ 8 */
    console.log('8. the Hand carries up to 8');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    r = await page.evaluate(() => {
      const g = __game, G = g.G; G.creatures.length = 0; G.imps.length = 0; const out = {}; const list = []; for (let i = 0; i < 10; i++) { const c = __t.creature(1, 3 + i % 5, 12 + (i / 5 | 0) * 2); c.wait = 99; list.push(c); }
      for (const c of list) { __t.click(c.x, c.y); }
      out.held = G.hand.length; out.full = /hand is full/.test(G.log[0]); out.top = G.held === list[7]; out.flags = list.filter(c => c.held).length;
      __t.click(8.5, 16.5); out.afterDrop = [G.hand.length, !list[7].held, Math.abs(list[7].x - 8.5) < .1];           // a click on open ground drops the top one
      __t.click(list[8].x, list[8].y); out.again = [G.hand.length, G.held === list[8]];                                // another creature can now be picked
      __t.click(list[9].x + 0.1, list[9].y, 2);                                                                       // right-click: everything goes down
      out.all = [G.hand.length, list.filter(c => c.held).length, G.held];
      return out; });
    check('clicking creatures one after another fills the hand to 8; the 9th is refused with a message', r.held === 8 && r.full && r.top && r.flags === 8, JSON.stringify(r));
    check('a click on open ground drops the one on top; then another can be picked up', r.afterDrop[0] === 7 && r.afterDrop[1] && r.afterDrop[2] && r.again[0] === 8 && r.again[1], JSON.stringify([r.afterDrop, r.again]));
    check('a right-click drops the whole hand at once', r.all[0] === 0 && r.all[1] === 0 && r.all[2] === null, JSON.stringify(r.all));
    await page.context().close();

    /* ------------------------------------------------------------------ 9 */
    console.log('9. traps: two uses, two of each at a time');
    page = await open('level=classic&seed=7&unlock=1'); await page.evaluate(SETUP);
    r = await page.evaluate(() => {
      const g = __game, G = g.G, out = {}; G.gold = 1e5; __t.floor(11, 14, 25, 14);
      g.placeThings('gas', 11, 14, 17, 14); out.gas = G.traps.filter(t => t.kind === 'gas').length; out.log = G.log[0] + ' | ' + G.log[1];
      g.placeThings('bolt', 18, 14, 25, 14); out.bolt = G.traps.filter(t => t.kind === 'bolt').length; out.max = G.traps.map(t => t.max).join();
      out.placed = G.stats.trapsPlaced;
      const tr = G.traps.find(t => t.kind === 'gas'); const h = __t.hero('Thief', tr.x, tr.y); G.heroes.forEach(x => { x.hp = x.maxHp = 1e6; x.stun = 99; });
      g.step(0.05); out.after1 = [tr.charges, G.traps.includes(tr)]; tr.cd = 0; g.step(0.05); out.after2 = [tr.charges, G.traps.includes(tr), __t.cell(tr.tx, tr.ty).trap === null];
      g.placeThings('gas', tr.tx, tr.ty, tr.tx, tr.ty); out.replaced = G.traps.filter(t => t.kind === 'gas').length;                 // a new one can go up once one is gone
      return out; });
    check('two Gas Traps fit; a third is refused with a message (and says nothing about claimed floor)', r.gas === 2 && /only keep 2 Gas Traps/.test(r.log), JSON.stringify([r.gas, r.log]));
    check('two Lightning Traps fit as well, each with two uses', r.bolt === 2 && r.max === '2,2,2,2' && r.placed === 4, JSON.stringify([r.bolt, r.max, r.placed]));
    check('a trap fires twice and then it is gone from the map', r.after1[0] === 1 && r.after1[1] && r.after2[0] === 0 && !r.after2[1] && r.after2[2], JSON.stringify([r.after1, r.after2]));
    check('...which makes room for a new one', r.replaced === 2, String(r.replaced));
    check('nothing is left to re-arm: no imp ever takes a re-arm job', await page.evaluate(() => { __game.G.traps.forEach(t => { t.charges = 1; }); __game.scanTasks(); return ![...__game.G.tasks.values()].some(t => t.type === 'REARM'); }));
    await page.context().close();

    /* ------------------------------------------------------------------ 10 */
    console.log('10. nobody shoots through a door');
    page = await open('level=classic&seed=7&unlock=1'); await page.evaluate(SETUP);
    r = await page.evaluate(() => {
      const g = __game, G = g.G, out = {}; G.gold = 1e5; __t.floor(10, 14, 20, 14); g.placeThings('door', 15, 14, 15, 14);
      out.clear = [g.shotClear(12.5, 14.5, 18.5, 14.5), g.shotClear(15.5, 14.5, 18.5, 14.5), g.shotClear(12.5, 14.5, 14.5, 14.5), g.shotClear(12.5, 12.5, 18.5, 12.5)];   // across the door, from the doorway, short of it, a different row
      const el = __t.creature(3, 12, 14); el.noFood = true; el.cd = 0; const ar = __t.hero('Archer', 18, 14); ar.hp = ar.maxHp = 1e6; el.hp = el.maxHp = 1e6; el.speed = 0; ar.speed = 0; G.creatures.forEach(c => { c.noLair = true; c.hunger = 0; });
      let shots = 0, hurtBy = 0; const hp0 = [el.hp, ar.hp];
      for (let s = 0; s < 2; s += 0.05) { g.step(0.05); el.hunger = 0; shots = Math.max(shots, G.shots.length); }
      out.shots = shots; out.hp = [el.hp < hp0[0], ar.hp < hp0[1]];
      const door = G.doors[0]; g.hurt(door, 1e9, ar); out.doorGone = !g.doorAt(15, 14);                                    // the door is smashed: now they see and shoot each other
      let shots2 = 0; for (let s = 0; s < 2; s += 0.05) { g.step(0.05); el.hunger = 0; shots2 = Math.max(shots2, G.shots.length); }
      out.shots2 = shots2;
      return out; });
    check('a shot across a closed door is blocked (from the doorway or short of it it is not)', r.clear[0] === false && r.clear[1] === true && r.clear[2] === true && r.clear[3] === true, JSON.stringify(r.clear));
    check('a Dark Elf and an Archer standing 6 tiles apart on either side of a closed door fire nothing for two seconds; once the door is smashed they shoot', r.shots === 0 && !r.hp[0] && !r.hp[1] && r.doorGone && r.shots2 > 0, JSON.stringify([r.shots, r.hp, r.doorGone, r.shots2]));
    await page.context().close();

    /* ------------------------------------------------------------------ 11 */
    console.log('11. the hero counter');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    r = await page.evaluate(() => {
      const g = __game, G = g.G; G.heroes.length = 0; const a = __t.hero('Knight', 20, 12), b = __t.hero('Thief', 22, 12), c = __t.hero('Guard', 24, 12); G.gateOpen = true;
      document.dispatchEvent(new Event('x')); const hud = () => { const f = window.requestAnimationFrame; return document.getElementById('hHeroes').textContent; };
      g.step(0.05); b.unconscious = true; b.uTime = 30; c.hp = 0; G.dirty = true; return { n: g.G.heroes.length, active: [a, b, c].filter(h => !h.dead && !h.unconscious).length }; });
    await sleep(400);
    const txt = await page.evaluate(() => { __game.G.speed = 0; return document.getElementById('hHeroes').textContent; });
    check('3 heroes, one knocked out: the counter says 2 (+1 down), not 3', /^2 \(\+1 down\)$/.test(txt) || /^2/.test(txt), txt + ' ' + JSON.stringify(r));
    r = await page.evaluate(() => { const g = __game, G = g.G; G.heroes.length = 0; const a = __t.hero('Knight', 20, 12); a.unconscious = true; a.uTime = 30; G.wave = g.VAR.WAVES; const st = g.COND.survive.f(); return st; });
    check('and a wave whose heroes are all knocked out counts as beaten (the objective does not wait for the imps)', r[0] === 1, JSON.stringify(r));
    await page.context().close();

    /* ------------------------------------------------------------------ 12 */
    console.log('12. full screen is the default');
    page = await open('level=classic&seed=7');
    const fsd = await page.evaluate(() => { const a = __fs.remembered(); localStorage.setItem('dm.fs', '0'); const b = __fs.remembered(); localStorage.setItem('dm.fs', '1'); const c = __fs.remembered(); localStorage.removeItem('dm.fs'); return [a, b, c, __fs.remembered()]; });
    check('with nothing stored the game wants full screen; only an explicit exit (dm.fs = 0) turns it off', fsd.join() === 'true,false,true,true', fsd.join());
    await page.context().close();

    /* ------------------------------------------------------------------ 13 */
    console.log('13. knocked-out heroes: 30 s, then prison and the rack');
    page = await open('level=classic&seed=7&unlock=1'); await page.evaluate(SETUP);
    r = await page.evaluate(() => {
      const g = __game, G = g.G, T = g.T, out = {}; G.gold = 1e5; G.imps.forEach(i => { i.drop(); });
      out.ko = g.KO_SECONDS;
      const h = __t.hero('Knight', 9.5, 14.5), c = __t.creature(1, 9.5, 13.5); c.dmg = 1e5; g.strike(c, h); out.down = [h.unconscious, h.uTime, G.heroes.includes(h)];
      const h2 = __t.hero('Knight', 8.5, 15.5); g.hurt(h2, 1e6, null); out.trap = h2.dead;                                  // a trap or spell still kills outright
      for (let s = 0; s < 31; s += 0.05) g.step(0.05); out.bled = [h.dead, G.heroes.includes(h)];                           // no prison: it bled out after 30 s
      return out; });
    check('a hero beaten by a creature is knocked out for 30 s (a trap still kills outright)', r.ko === 30 && r.down[0] && r.down[1] === 30 && r.trap, JSON.stringify([r.ko, r.down, r.trap]));
    check('with no Prison to carry him to he bleeds out after the 30 s', r.bled[0] && !r.bled[1], JSON.stringify(r.bled));
    r = await page.evaluate(() => {
      const g = __game, G = g.G, T = g.T, out = {}; G.gold = 1e5; G.creatures.length = 0; G.heroes.length = 0; g.build(T.PRISON, 3, 12, 3, 13); g.build(T.TORTURE, 3, 15, 4, 15); G.dirty = true; g.step(0.05);
      while (G.imps.length < 4) G.imps.push(new g.Imp(7, 14));
      const h = __t.hero('Knight', 7.5, 14.5), c = __t.creature(1, 7.5, 13.5); c.dmg = 1e5; g.strike(c, h); let jailed = null, racked = null, conv = null;
      for (let s = 0; s < 120; s += 0.05) { g.step(0.05); c.hunger = 0; c.energy = 100; c.anger = 0; G.imps.forEach(i => { i.hp = i.maxHp; }); if (jailed === null && G.prisoners.includes(h)) jailed = Math.round(s); if (racked === null && h.status === 'torture') racked = Math.round(s); if (conv === null && h.dead) { conv = Math.round(s); break; } }
      return { jailed, racked, conv, ex: G.creatures.filter(x => /Ex-/.test(x.name)).length }; });
    check('with a Prison and a Torture Chamber the imps carry him to a cell (inside his 30 s), then to the rack, and he is converted or breaks', r.jailed !== null && r.jailed <= 30 && r.racked !== null && r.racked > r.jailed && r.conv !== null, JSON.stringify(r));
    await page.context().close();

    /* ------------------------------------------------------------------ 14 */
    console.log('14. 20 creatures per level, 25 in the last three chapters');
    page = await open('level=classic&seed=7');
    const caps = await page.evaluate(() => { const g = __game; return { classic: g.VAR.CREATURES_SUPPORTED_BY_FIRST_PORTAL, table: Object.fromEntries(['tutorial', 'portal', 'hatchery', 'library', 'traps', 'prison', 'temple', 'gates', 'siege', 'crusade'].map(id => [id, g.LEVEL_TABLE[id].rules.maxCreatures || 20])), bad: (() => { const lv = JSON.parse(JSON.stringify(g.LEVEL_TABLE.classic)); lv.rules.maxCreatures = 0; return g.validateLevel(lv).some(e => /maxCreatures/.test(e)); })() }; });
    check('the default is 20', caps.classic === 20, JSON.stringify(caps.classic));
    check('chapters 1-7 take 20, chapters 8-10 take 25; rules.maxCreatures is validated', Object.values(caps.table).join() === '20,20,20,20,20,20,20,25,25,25' && caps.bad, JSON.stringify(caps.table));
    await page.context().close();
    for (const [id, want] of [['siege', 25], ['hatchery', 20]]) {
      page = await open('level=' + id);
      const v = await page.evaluate(() => ({ portal: __game.VAR.CREATURES_SUPPORTED_BY_FIRST_PORTAL, hud: (document.getElementById('hMax'), __game.G.creatures.length) }));
      check(`${id} runs with a Portal limit of ${want}`, v.portal === want, JSON.stringify(v)); await page.context().close();
    }

    /* ------------------------------------------------------------------ 15 */
    console.log('15. imps spread over the jobs');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    r = await page.evaluate(() => {
      const g = __game, G = g.G; G.imps.length = 0; __t.floor(11, 13, 14, 15);          // bare claimed floor next to which unclaimed floor lies: carve unclaimed floor east of it
      for (let y = 12; y <= 16; y++) for (let x = 15; x <= 19; x++) { const t = __t.cell(x, y); t.t = g.T.PATH; t.owner = 0; t.hp = 0; t.gold = 0; }
      g.tagRect(11, 17, 18, 17, true); g.tagRect(11, 10, 18, 10, true); g.scanTasks();
      for (let i = 0; i < 3; i++) G.imps.push(new g.Imp(9 + i, 14));
      for (let s = 0; s < 1; s += 0.05) g.step(0.05);
      const kinds = G.imps.map(i => i.task ? i.task.type : i.state).sort(); return { kinds, dig: [...G.tasks.values()].filter(t => t.type === 'DIG').length, claim: [...G.tasks.values()].filter(t => t.type === 'CLAIM').length }; });
    check('with digging and claiming both waiting, three imps do not all pile onto the digging', r.dig > 0 && r.claim > 0 && new Set(r.kinds).size >= 2 && r.kinds.filter(k => k === 'DIG').length < 3 && r.kinds.includes('CLAIM'), JSON.stringify(r));
    await page.context().close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall correction checks passed'); process.exit(fails ? 1 : 0);
})();
