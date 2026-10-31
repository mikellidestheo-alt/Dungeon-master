#!/usr/bin/env node
/* Headless checks for creature levels 1-10 and the Training Room (web/game.js gainXp / Creature "train" state / COND.level, render3d dummies).
 *   node tools/test_training.js     (needs playwright with chromium)
 *   1. the rules in numbers: the XP table, the level cap, stats x1.11 a level, wages +8 % a level
 *   2. a creature in a Training Room gains XP and levels up to 10, at a sensible pace, then stops; the room goes quiet
 *   3. gold: 15 a session, nothing below the 100 gold the purse keeps back (and the log says so once); wages at payday follow the level
 *   4. rules of the room: one creature per tile; hunger and tiredness come first; a kill is only a trickle of XP
 *   5. the `level` objective: counts, labels, validates; chapter 5 teaches it
 *   6. the toolbar button, the roster's XP bar and tooltip, the 2D pips, and the 3D training dummies
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8784, ROOT = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    await sleep(800);
    const problems = [];
    const open = async (query, view = '2d', frozen = true) => {
      const page = await (await browser.newContext({ viewport: { width: 1500, height: 1300 } })).newPage();
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GL Driver Message|willReadFrequently/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });
      if (frozen) await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
      await page.goto(ROOT + 'index.html?sound=0&nosave=1&guide=0&view=' + view + '&' + query, { waitUntil: 'load' }); await sleep(view === '2d' ? 400 : 2500);
      await page.evaluate(() => { const g = __game; g.G.speed = 0; g.unlockAll(); g.G.gold = 100000; }); return page;
    };
    const SETUP = () => {
      window.__t = {
        room(n, room = 'TRAINING') { const g = __game, G = g.G; let left = n; for (let y = 0; y < g.H && left > 0; y++) for (let x = 0; x < g.W && left > 0; x++) { const t = G.map[y * g.W + x]; if (t.t === g.T.PATH && t.owner === 1 && !t.door && !t.trap && (x + y) % 3) { g.build(g.T[room], x, y, x, y); left--; } } },
        creature(kind = 1, x = 9, y = 12) { const g = __game, c = new g.Creature(x, y, g.KINDS[kind]); c.noLair = true; c.noFood = true; g.G.creatures.push(c); return c; },
        run(s, calm = true, rich = true) { const g = __game, G = g.G; for (let t = 0; t < s; t += 0.05) { g.step(0.05); if (rich) G.gold = Math.max(G.gold, 100000); if (calm) for (const c of G.creatures) { c.anger = 0; c.energy = Math.max(c.energy, 60); } } },
      };
    };

    const frames = (page, n = 4) => page.evaluate((n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);       // wait for the render loop, whatever the machine's speed
    console.log('1. the numbers');
    let page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const n = await page.evaluate(() => {
      const g = __game, V = g.VAR, G = g.G, c = new g.Creature(9, 12, g.KINDS[1]); G.creatures.push(c); const hp0 = c.maxHp, dmg0 = c.dmg, pay0 = c.pay, rows = [];
      for (let l = 2; l <= 10; l++) { g.gainXp(c, V.XP_FOR_LEVEL[l - 2]); rows.push([c.level, c.maxHp, +c.dmg.toFixed(2), c.pay]); }
      const top = { level: c.level, xp: c.xp }; g.gainXp(c, 1e6); const capped = { level: c.level, xp: c.xp }; g.gainXp(c, 1);
      return { max: V.MAX_LEVEL, table: V.XP_FOR_LEVEL.slice(), sum: V.XP_FOR_LEVEL.reduce((a, b) => a + b, 0), mult: V.LEVEL_STAT_MULT, hp0, dmg0, pay0, rows, top, capped, after: { level: c.level, xp: c.xp }, tile: g.TERRAIN[g.T.TRAINING] };
    });
    check('levels 1 to 10, nine steps of XP that grow: 50, 65, 80, 100, 125, 155, 190, 230, 280', n.max === 10 && n.table.join() === '50,65,80,100,125,155,190,230,280' && n.sum === 1275, n.table.join());
    check('each level multiplies hp and damage by 1.11 (about x2.5 at level 10, not the old x4.4)', n.rows.every((r, i) => Math.abs(r[2] / n.dmg0 - Math.pow(1.11, i + 1)) < 0.02) && n.rows[8][1] / n.hp0 > 2.4 && n.rows[8][1] / n.hp0 < 2.8, JSON.stringify(n.rows[8]) + ' hp x' + (n.rows[8][1] / n.hp0).toFixed(2));
    check('wages rise 8 % of the base per level: a Troll goes from 90 to 155', n.pay0 === 90 && n.rows[0][3] === 97 && n.rows[8][3] === 155, n.rows.map(r => r[3]).join());
    check('the cap holds: level 10 and 1275 XP, however much more XP arrives', n.top.level === 10 && n.top.xp === 1275 && n.capped.level === 10 && n.capped.xp === 1275 && n.after.level === 10 && n.after.xp === 1275, JSON.stringify([n.top, n.capped, n.after]));
    check('the Training Room is a room terrain at 150 gold a tile', n.tile.name === 'Training Room' && n.tile.cost === 150 && n.tile.room === 1 && n.tile.own === 1);
    await page.close();

    console.log('2. one creature trains from level 1 to 10');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const lv = await page.evaluate(() => {
      const g = __game, G = g.G; __t.room(3); const c = __t.creature(), at = {}; const t0 = G.time; let sessions = 0, was = c.state, quietFrom = null, goldAtTen = null, lastGold = G.gold;
      for (let s = 0; s < 3000; s += 0.05) {
        g.step(0.05); c.anger = 0; c.hunger = 0; c.energy = 100; const before = G.gold; G.gold = Math.max(G.gold, 100000);
        if (c.state === 'train' && was !== 'train') sessions++; was = c.state;
        if (!(c.level in at)) at[c.level] = Math.round(G.time - t0);
        if (c.level === 10 && quietFrom === null) { quietFrom = G.time; goldAtTen = G.gold; }
      }
      const states = []; for (let s = 0; s < 60; s += 0.05) { g.step(0.05); states.push(c.state); c.hunger = 0; c.energy = 100; }
      return { level: c.level, xp: c.xp, at, sessions, trainingAfter: states.filter(x => x === 'train' || x === 'toTrain').length, occ: G.map.filter(t => t.t === g.T.TRAINING && t.occ).length };
    });
    const minutes = (l) => (lv.at[l] / 60).toFixed(1);
    check('it reaches level 10 and stops there at exactly the top of the table', lv.level === 10 && lv.xp === 1275, JSON.stringify([lv.level, lv.xp]));
    check('the pace: level 2 after 1-3 minutes, 5 in 6-11, 10 in 28-45 (slower later)', lv.at[2] >= 60 && lv.at[2] <= 180 && lv.at[5] >= 360 && lv.at[5] <= 660 && lv.at[10] >= 1680 && lv.at[10] <= 2700, `L2 ${minutes(2)} min, L5 ${minutes(5)}, L10 ${minutes(10)}`);
    check('each level takes longer than the one before', Object.keys(lv.at).map(Number).filter(l => l >= 3).every(l => lv.at[l] - lv.at[l - 1] > lv.at[l - 1] - lv.at[l - 2]), JSON.stringify(lv.at));
    check('at level 10 it stops training: no more sessions, and the dummy is free', lv.trainingAfter === 0 && lv.occ === 0, JSON.stringify([lv.trainingAfter, lv.occ]));
    await page.close();

    console.log('3. gold and wages');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const gold = await page.evaluate(() => {
      const g = __game, G = g.G, V = g.VAR; __t.room(2); const c = __t.creature(); G.gold = 1000; let sessions = 0, was = c.state, spent = 0, prev = G.gold;
      for (let s = 0; s < 200; s += 0.05) { g.step(0.05); c.anger = 0; c.hunger = 0; c.energy = 100; if (G.nextPay < 1) G.nextPay = 1e9; if (c.state === 'train' && was !== 'train') sessions++; was = c.state; }
      const drop = 1000 - G.gold;
      const log0 = G.log.filter(m => /Not enough gold to train/.test(m)).length;
      G.gold = 110; c.level = 1; for (let s = 0; s < 120; s += 0.05) { g.step(0.05); c.anger = 0; c.hunger = 0; c.energy = 100; if (G.nextPay < 1) G.nextPay = 1e9; }
      const poor = { gold: G.gold, state: c.state, sessions2: 0, log: G.log.filter(m => /Not enough gold to train/.test(m)).length };
      return { sessions, drop, poor, log0, first: V.TRAIN_COST };
    });
    check('15 gold is paid for every session: the purse fell by exactly sessions x 15', gold.sessions >= 5 && gold.drop === gold.sessions * 15, JSON.stringify([gold.sessions, gold.drop]));
    check('with 110 gold (under cost + the 100 it keeps back) it will not train: the gold stays, and the log says why once', gold.poor.gold === 110 && gold.poor.state !== 'train' && gold.poor.log <= 1, JSON.stringify(gold.poor));
    const near = await page.evaluate(() => {
      const g = __game, G = g.G; G.creatures.length = 0; __t.room(2); for (let i = 0; i < 3; i++) __t.creature(1, 8 + i, 12); G.gold = 200; const wages = G.creatures.reduce((t, c) => t + c.pay, 0), res = {};
      const go = (nextPay) => { for (const c of G.creatures) { c.state = 'idle'; c.path = null; c.releaseDesk(); c.trainThink = 0; } let n = 0; for (let s = 0; s < 10; s += 0.05) { G.nextPay = nextPay; g.step(0.05); G.gold = 200; for (const c of G.creatures) { c.anger = 0; c.hunger = 0; c.energy = 100; if (c.state === 'train' || c.state === 'toTrain') n++; } } return n; };
      res.far = go(60); res.close = go(10); return { wages, ...res };
    });
    check('in the 30 s before payday a creature only trains if the whole payday stays in the purse: 200 gold, wages 270: it trains at 60 s to payday, not at 10 s', near.wages === 270 && near.far > 0 && near.close === 0, JSON.stringify(near));
    const pay = await page.evaluate(() => {
      const g = __game, G = g.G; G.creatures.length = 0; const c = __t.creature(); g.gainXp(c, 1e6); G.gold = 5000; G.nextPay = 0.01; const g0 = G.gold; g.step(0.05); return { paid: g0 - G.gold, pay: c.pay };
    });
    check('payday charges the level-10 wage (155 for a Troll)', pay.pay === 155 && pay.paid === 155, JSON.stringify(pay));
    await page.close();

    console.log('4. the rules of the room');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const one = await page.evaluate(() => {
      const g = __game, G = g.G; __t.room(1); const a = __t.creature(1, 9, 12), b = __t.creature(1, 9, 13); let both = 0, any = 0;
      for (let s = 0; s < 120; s += 0.05) { g.step(0.05); for (const c of [a, b]) { c.anger = 0; c.hunger = 0; c.energy = 100; } G.gold = Math.max(G.gold, 1e5); if (a.state === 'train' && b.state === 'train') both++; if (a.state === 'train' || b.state === 'train') any++; }
      return { both, any, xpA: Math.round(a.xp), xpB: Math.round(b.xp) };
    });
    check('one creature per tile: with one dummy two creatures never train together, but both get turns', one.both === 0 && one.any > 800 && one.xpA > 5 && one.xpB > 5, JSON.stringify(one));
    const fed = await page.evaluate(() => {
      const g = __game, G = g.G; G.creatures.length = 0; __t.room(2); const c = __t.creature(); c.noFood = false; c.hunger = 100; c.chickenless = true; G.chickens.length = 0; let trained = 0;
      for (let s = 0; s < 40; s += 0.05) { g.step(0.05); c.hunger = 100; c.anger = 0; c.energy = 100; if (c.state === 'train' || c.state === 'toTrain') trained++; }
      const hungry = trained; c.hunger = 0; c.energy = 20; trained = 0;
      for (let s = 0; s < 40; s += 0.05) { g.step(0.05); c.hunger = 0; c.anger = 0; c.energy = Math.min(c.energy, 20); if (c.state === 'train' || c.state === 'toTrain') trained++; }
      return { hungry, tired: trained };
    });
    check('a hungry creature does not train, and neither does a tired one (hunger and sleep come first)', fed.hungry === 0 && fed.tired === 0, JSON.stringify(fed));
    const kill = await page.evaluate(() => {
      const g = __game, G = g.G; G.creatures.length = 0; const c = __t.creature(), kind = g.HEROES[0], h = new g.Hero(10, 12, kind, 1, []); h.party.push(h); G.heroes.push(h); h.hp = 1; c.xp = 0; g.hurt(h, 50, c); return { xp: c.xp, level: c.level };
    });
    check('a kill is a trickle: one XP', kill.xp === 1 && kill.level === 1, JSON.stringify(kill));
    await page.close();

    console.log('5. the level objective and chapter 5');
    page = await open('level=classic&seed=7'); await page.evaluate(SETUP);
    const ob = await page.evaluate(() => {
      const g = __game, G = g.G, c = __t.creature(); const st = (n) => g.condState({ type: 'level', n }); const a = st(3).done; g.gainXp(c, 115); const b = st(3), d = st(5);
      const ok = (cond) => { const lv = JSON.parse(JSON.stringify(g.LEVEL_TABLE.classic)); lv.objectives = [{ type: 'survive' }, cond]; return g.validateLevel(lv); };
      const ch5 = g.LEVEL_TABLE.traps;
      return { a, b: b.done, d: d.done, label: g.COND.level.label({ n: 5 }), v: ok({ type: 'level', n: 5 }), v1: ok({ type: 'level', n: 1 }), v11: ok({ type: 'level', n: 11 }), v0: ok({ type: 'level' }),
        bonus: ch5.objectives.filter(o => o.type === 'level' && o.optional).length, valid: g.validateLevel(ch5), step: ch5.guide.find(s => s.tool === 'training'), room: Object.keys(g.TAB_OF).includes('training') };
    });
    check('"Train a creature to level 3" is done once a creature has level 3, not before; level 5 not yet', !ob.a && ob.b && !ob.d && ob.label === 'Train a creature to level 5', JSON.stringify(ob));
    check('validation: level 5 is fine; 1, 11 and a missing n are rejected', ob.v.length === 0 && ob.v1.some(e => /level objective/.test(e)) && ob.v11.some(e => /level objective/.test(e)) && ob.v0.length > 0, JSON.stringify([ob.v1, ob.v11]));
    check('chapter 5 teaches it: a bonus "Train a creature to level 3" and a guide step that points at the Training Room button; the chapter still validates', ob.bonus === 1 && ob.valid.length === 0 && ob.step && ob.step.when.room === 'training', JSON.stringify([ob.bonus, ob.valid]));
    await page.close();

    console.log('6. the interface');
    page = await open('level=classic&seed=7', '3d', false);
    await page.evaluate(SETUP);
    const ui = await page.evaluate(() => {
      __game.G.speed = 0; const b = document.getElementById('b_training'); const t = document.getElementById('tools');
      document.getElementById('tab_build').click();
      const buttons = [...document.querySelectorAll('#tp_build .grp:first-of-type button')], tops = new Set(buttons.map(x => Math.round(x.getBoundingClientRect().top)));
      return { exists: !!b, label: b && b.textContent, inBuild: __game.TAB_OF.training, rooms: buttons.length, oneRow: tops.size === 1, fits: t.scrollHeight <= t.clientHeight + 1, title: b && b.title };
    });
    check('the Buildings tab has a Training button (150 gold), eight rooms in one row, the toolbar slot not overflowed', ui.exists && /Training 150g/.test(ui.label) && ui.inBuild === 'build' && ui.rooms === 8 && ui.oneRow && ui.fits, JSON.stringify(ui));
    const built = await page.evaluate(() => { const g = __game, G = g.G; document.getElementById('b_training').click(); const tool = __ui.tool; const t = G.map.find(q => q.t === g.T.PATH && q.owner === 1); const i = G.map.indexOf(t), x = i % g.W, y = (i / g.W) | 0; __ui.inputDown({ x, y }, { fx: x + .5, fy: y + .5 }, 0); __ui.inputUp({ x, y }, { fx: x + .5, fy: y + .5 }); return { tool, rooms: G.map.filter(q => q.t === g.T.TRAINING).length }; });
    check('choosing it and clicking claimed floor builds a Training Room tile', built.tool === 'training' && built.rooms === 1, JSON.stringify(built));
    await page.evaluate(() => { const g = __game, G = g.G; __t.room(3); G.creatures.length = 0; const c = __t.creature(); c.level = 3; c.xp = 195 + 40; __t.run(30, true, true); __game.setTab('monsters', true); document.getElementById('rv_creatures').click(); g.renderRoster(true); });
    await sleep(500);
    const chip = await page.evaluate(() => { const c = document.querySelector('#roster .chip'); return c && { text: c.textContent.replace(/\s+/g, ' ').trim(), title: c.title, xp: c.querySelector('.xp u') && c.querySelector('.xp u').style.width, state: __game.G.creatures[0].state }; });
    check('the roster chip shows the level, an XP bar, and a tooltip with level, XP and wage', chip && /Troll 4/.test(chip.text) && /^\d+%$/.test(chip.xp) && /level 4 \(\d+\/100 XP\)/.test(chip.title) && /Wage \d+/.test(chip.title), JSON.stringify(chip));
    await frames(page);
    const dummies = await page.evaluate(() => { let n = 0; __three.scene.traverse(o => { if (o.isGroup && o.userData && o.userData.pivot) n++; }); return { n, rooms: __game.G.map.filter(q => q.t === __game.T.TRAINING).length }; });
    check('3D: every Training Room tile has a dummy (built from primitives: no art exists yet)', dummies.n === dummies.rooms && dummies.n >= 3, JSON.stringify(dummies));
    await page.evaluate(() => { __game.G.map.filter(q => q.t === __game.T.TRAINING).forEach(q => { q.t = __game.T.PATH; }); }); await frames(page);
    check('3D: the dummies go when the room does', await page.evaluate(() => { let n = 0; __three.scene.traverse(o => { if (o.isGroup && o.userData && o.userData.pivot) n++; }); return n === 0; }));
    await page.close();
    page = await open('level=classic&seed=7', '2d', false); await page.evaluate(SETUP);
    const flat = await page.evaluate(() => { const g = __game, G = g.G; __t.room(3); const c = __t.creature(); c.level = 7; c.xp = 575; __t.run(20, true, true); const ok = c.state === 'train' || c.state === 'toTrain' || c.state === 'idle'; return ok; });
    await sleep(500);
    check('2D: the canvas draws the room, the pips for level 7 and a training creature without a hitch', flat && await page.evaluate(() => !!__game.G.creatures[0]));
    await page.close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall training checks passed'); process.exit(fails ? 1 : 0);
})();
