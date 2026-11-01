#!/usr/bin/env node
/* Headless checks for heroes that dig (web/game.js Hero.route / digStep / makeParty, waves.dig, docs/06-levels.md "Heroes that dig").
 *   node tools/test_digging.js     (needs playwright with chromium)
 *   1. the data: waves.dig validates (0-4), the sandbox difficulties and the chapters set it, rising with difficulty
 *   2. who digs: nobody at 0; at 1 the leader of each party, every 4th hero and Dwarves; at 4 everyone but bosses and flyers
 *   3. a digger walled in by earth tunnels to a creature, and the followers use its tunnel; the same hero without the skill stays put
 *   4. rock and gem seams stop it; it only tunnels when that is much shorter than the walk (and when there is no walk at all)
 *   5. it is no business of your objectives: the tiles dug and the gold mined by heroes are not counted for you; the log says so once
 *   6. the effect on difficulty: a digger bypasses a door and trap tunnel
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8785, ROOT = `http://localhost:${PORT}/`;
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
      await page.goto(ROOT + 'index.html?sound=0&view=2d&nosave=1&guide=0&' + query, { waitUntil: 'load' }); await sleep(400);
      await page.evaluate(() => { const g = __game; g.G.speed = 0; g.unlockAll(); g.G.imps.length = 0; g.G.nextImp = 1e9; }); return page;
    };
    // a test arena in the page: a block of earth at x 20-46, y 10-30, with a small open pocket for the hero (west) and a creature's floor (east)
    const ARENA = () => {
      window.__a = {
        frame() { this.earth(16, 6, 50, 46, __game.T.ROCK); },                                                                  // a ring of rock round the arena, so nothing can go round it
        earth(x0, y0, x1, y1, id) { const g = __game, G = g.G; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const t = G.map[y * g.W + x]; t.t = id === undefined ? g.T.EARTH : id; t.hp = g.TERRAIN[t.t].maxHealth; t.owner = 0; t.gold = 0; t.tag = 0; t.door = null; t.trap = null; } },
        floor(x0, y0, x1, y1, owner = 0) { const g = __game, G = g.G; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const t = G.map[y * g.W + x]; t.t = g.T.PATH; t.hp = 1000; t.owner = owner; t.gold = 0; t.tag = 0; t.door = null; t.trap = null; } G.dirty = true; },
        hero(x, y, name = 'Knight', digger = true, party = []) { const g = __game, h = new g.Hero(x, y, g.HEROES.find(k => k.name === name), 1, party); h.digger = digger; party.push(h); g.G.heroes.push(h); return h; },
        creature(x, y) { const g = __game, c = new g.Creature(x, y, g.KINDS[1]); c.noLair = true; c.noFood = true; c.maxHp = c.hp = 99999; c.wait = 1e9; g.G.creatures.push(c); return c; },
        run(s, f) { const g = __game, G = g.G; for (let t = 0; t < s; t += 0.05) { g.step(0.05); for (const c of G.creatures) { c.wait = 1e9; c.anger = 0; c.hunger = 0; c.path = c.state === 'idle' ? null : c.path; } if (f && f()) return true; } return false; },
        count(x0, y0, x1, y1, id) { const g = __game, G = g.G; let n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (G.map[y * g.W + x].t === id) n++; return n; },
      };
    };

    console.log('1. the data');
    let page = await open('level=sandbox&diff=hard&seed=3');
    const data = await page.evaluate(() => {
      const g = __game, ok = (v) => { const lv = JSON.parse(JSON.stringify(g.LEVEL_TABLE.classic)); lv.waves.dig = v; return g.validateLevel(lv); };
      return { good: [0, 1, 2, 3, 4].map(v => ok(v).length), bad: [5, -1, 1.5, 'x'].map(v => ok(v).length), chapters: g.CAMPAIGN.map(id => g.LEVEL_TABLE[id].waves.dig || 0), period: g.VAR.HERO_DIG_PERIOD, eff: g.VAR.HERO_DIG_EFF };
    });
    check('waves.dig accepts 0 to 4 and rejects 5, -1, 1.5 and text', data.good.every(n => n === 0) && data.bad.every(n => n > 0), JSON.stringify(data));
    check('the chapters raise it with difficulty: none in 1-3, one from 4, two from 6, three from 8, every hero in the finale', data.chapters.join() === '0,0,0,1,1,2,2,3,3,4' && data.chapters.every((v, i) => i === 0 || v >= data.chapters[i - 1]), data.chapters.join());
    check('digging gets quicker with the level (45 to 85 % efficiency; imps are 80) and more heroes dig (every 4th, 3rd, 2nd, every one)', data.eff.join() === '0,45,55,70,85' && data.period.slice(1).join() === '4,3,2,1');
    await page.close();

    console.log('2. who digs');
    const who = async (query) => { const p = await open(query); const r = await p.evaluate(() => { const g = __game, G = g.G; G.gates.forEach(x => x.open = true); G.gateOpen = true; G.wave = 0; G.nextWave = 1e9; g.LV.waves.plan[0] = ['Knight', 'Archer', 'Dwarf', 'Mage', 'Thief', 'Guard', 'Monk', 'Fairy', 'Prince']; g.spawnWave();
      return G.heroes.map(h => h.name[0] + (h.digger ? '+' : '-')).join(' '); }); await p.close(); return r; };
    // the party is dealt out to one gate in this test; slots follow its order
    const w0 = await who('level=sandbox&diff=easy&seed=3'), w1 = await who('level=sandbox&diff=normal&seed=3'), w2 = await who('level=sandbox&diff=hard&seed=3'), w3 = await who('level=sandbox&diff=brutal&seed=3');
    check('easy (0): nobody digs, not even the Dwarf', !/\+/.test(w0), w0);
    check('normal (1): the leader (slot 0), every 4th hero (slot 4, 8) and the Dwarf dig; the Fairy (flying) and the Prince (boss) never', w1 === 'K+ A- D+ M- T+ G- M- F- P-', w1);
    check('hard (2): every 3rd hero digs (slots 0, 3, 6), plus the Dwarf', w2 === 'K+ A- D+ M+ T- G- M+ F- P-', w2);
    check('Dungeon Master (3): every 2nd hero digs (slots 0, 2, 4, 6), bosses and flyers never', w3 === 'K+ A- D+ M- T+ G- M+ F- P-', w3);
    page = await open('level=crusade&seed=3');
    const w4 = await page.evaluate(() => { const g = __game, G = g.G; G.gates.forEach(x => x.open = true); G.gateOpen = true; G.wave = 0; G.nextWave = 1e9; g.LV.waves.plan[0] = ['Knight', 'Archer', 'Dwarf', 'Mage', 'Thief', 'Guard', 'Monk', 'Fairy', 'Prince']; g.spawnWave(); return G.heroes.concat(G.pending.flatMap(p => p.heroes)).map(h => h.name[0] + (h.digger ? '+' : '-')).join(' '); });       // the groups of the other Gates step out 20 s later (G.pending)
    check('the finale (4): every hero digs except the Fairy (flies) and the Prince (boss), whichever of the three Gates he comes out of', w4.split(' ').length === 9 && w4.split(' ').every(x => (x[0] === 'F' || x[0] === 'P') ? x[1] === '-' : x[1] === '+'), w4);
    await page.close();

    console.log('3. walled in by earth');
    page = await open('level=sandbox&diff=hard&seed=3'); await page.evaluate(ARENA);
    const tun = await page.evaluate(() => {
      const g = __game, G = g.G, A = __a; A.frame(); A.earth(18, 8, 48, 32); A.floor(20, 20, 21, 21); A.floor(38, 20, 39, 21, 1); const c = A.creature(38.5, 20.5);
      const party = [], lead = A.hero(20.5, 20.5, 'Knight', true, party), fol = A.hero(21.5, 21.5, 'Guard', false, party), alone = (() => { return null; })();
      const dug0 = G.stats.dug, mined0 = G.stats.mined; let reachedAt = null, folAt = null;
      A.run(240, () => { if (reachedAt === null && Math.hypot(lead.x - c.x, lead.y - c.y) < 3) reachedAt = G.time; if (folAt === null && Math.hypot(fol.x - c.x, fol.y - c.y) < 3) folAt = G.time; return false; });
      const path = A.count(22, 20, 37, 21, g.T.PATH);
      return { reachedAt: reachedAt && Math.round(reachedAt), folAt: folAt && Math.round(folAt), tunnel: path, dug: G.stats.dug - dug0, mined: G.stats.mined - mined0, log: G.log.filter(m => /tunnelling/.test(m)).length };
    });
    check('a digger with a creature behind 16 tiles of earth tunnels to it', tun.reachedAt !== null && tun.reachedAt < 230 && tun.tunnel >= 16, JSON.stringify(tun));
    check('its follower (who cannot dig) walks the tunnel behind it and arrives too', tun.folAt !== null && tun.folAt >= tun.reachedAt - 5, JSON.stringify(tun));
    check('the tiles heroes dig and the gold they mine are not counted for your objectives, and the log says "Heroes are tunnelling" once', tun.dug === 0 && tun.mined === 0 && tun.log === 1, JSON.stringify(tun));
    const still = await page.evaluate(() => {
      const g = __game, G = g.G, A = __a; G.heroes.length = 0; G.creatures.length = 0; A.frame(); A.earth(18, 8, 48, 32); A.floor(20, 20, 21, 21); A.floor(38, 20, 39, 21, 1); A.creature(38.5, 20.5); const h = A.hero(20.5, 20.5, 'Knight', false); A.run(120);
      return { moved: Math.hypot(h.x - 20.5, h.y - 20.5), tunnel: A.count(22, 20, 37, 21, g.T.PATH) };
    });
    check('the same hero without the skill stays where he is: no tunnel at all', still.moved < 1.6 && still.tunnel === 0, JSON.stringify(still));
    await page.close();

    console.log('4. rock stops it; a shortcut must be worth it');
    page = await open('level=sandbox&diff=hard&seed=3'); await page.evaluate(ARENA);
    const rock = await page.evaluate(() => {
      const g = __game, G = g.G, A = __a; A.frame(); A.earth(18, 8, 48, 32); A.floor(20, 20, 21, 21); A.floor(38, 20, 39, 21, 1); A.earth(30, 8, 30, 32, g.T.ROCK); A.creature(38.5, 20.5); const h = A.hero(20.5, 20.5, 'Knight', true); A.run(120);
      const out = { x: h.x, east: A.count(31, 20, 37, 21, g.T.PATH), west: A.count(22, 20, 29, 21, g.T.PATH) };
      G.heroes.length = 0; A.earth(18, 8, 48, 32); A.floor(20, 20, 21, 21); A.floor(38, 20, 39, 21, 1); A.earth(30, 8, 30, 32, g.T.GEM); const h2 = A.hero(20.5, 20.5, 'Knight', true); A.run(120);
      out.gemX = h2.x; out.gemEast = A.count(31, 20, 37, 21, g.T.PATH); return out;
    });
    check('a wall of rock right across the arena (rock cannot be dug): there is no route at all, so the digger stays put and digs nothing', rock.x < 22 && rock.east === 0 && rock.west === 0, JSON.stringify(rock));
    check('a solid wall of gem seams stops it as well (it digs earth and gold only)', rock.gemX < 22 && rock.gemEast === 0, JSON.stringify([rock.gemX, rock.gemEast]));
    const sc = await page.evaluate(() => {
      const g = __game, G = g.G, A = __a; G.heroes.length = 0; G.creatures.length = 0;
      // a U of open floor: the long way round is 20 + 4 + 20 tiles, the wall in between 3 tiles of earth
      A.frame(); A.earth(18, 8, 48, 44); A.floor(22, 20, 22, 40); A.floor(22, 40, 26, 40); A.floor(26, 20, 26, 40); A.floor(20, 20, 22, 21); A.floor(26, 20, 28, 21, 1); A.creature(27.5, 20.5);
      const dig = A.hero(20.5, 20.5, 'Knight', true), t0 = G.time; let dAt = null;
      A.run(120, () => { if (dAt === null && Math.hypot(dig.x - 27.5, dig.y - 20.5) < 3) dAt = G.time - t0; return dAt !== null; });
      return { arrivedAfter: dAt && Math.round(dAt), cut: A.count(23, 20, 25, 21, g.T.PATH) };
    });
    check('a 3-tile earth wall against a 44-tile walk is worth digging: it cuts through (3 tiles) and is at the creature in under 24 s (the walk alone would take 26)', sc.arrivedAfter !== null && sc.arrivedAfter < 24 && sc.cut >= 3, JSON.stringify(sc));
    const nosc = await page.evaluate(() => {
      const g = __game, G = g.G, A = __a; G.heroes.length = 0; G.creatures.length = 0; A.frame(); A.earth(18, 8, 48, 44); A.floor(22, 20, 22, 26); A.floor(22, 26, 26, 26); A.floor(26, 20, 26, 26); A.floor(20, 20, 22, 21); A.floor(26, 20, 28, 21, 1); A.creature(27.5, 20.5);
      const dig = A.hero(20.5, 20.5, 'Knight', true); let dAt = null; A.run(100, () => { if (dAt === null && Math.hypot(dig.x - 27.5, dig.y - 20.5) < 3) dAt = G.time; return dAt !== null; });
      return { cut: A.count(23, 20, 25, 21, g.T.PATH), arrived: dAt !== null };
    });
    check('a short way round (6 + 4 + 6 tiles) is not worth a 3-tile wall (6 steps a tile): it walks, arrives and digs nothing', nosc.cut === 0 && nosc.arrived, JSON.stringify(nosc));
    await page.close();

    console.log('5. a digger bypasses doors and traps');
    page = await open('level=sandbox&diff=hard&seed=3'); await page.evaluate(ARENA);
    const byp = await page.evaluate(() => {
      const g = __game, G = g.G, A = __a; A.frame(); A.earth(18, 8, 48, 44); A.floor(22, 20, 22, 40); A.floor(22, 40, 26, 40); A.floor(26, 20, 26, 40); A.floor(20, 20, 22, 21); A.floor(26, 20, 28, 21, 1); A.creature(27.5, 20.5);
      for (let y = 30; y <= 33; y++) G.map[y * g.W + 22].owner = 1; G.gold = 5000; g.placeThings('bolt', 22, 30, 22, 30); g.placeThings('gas', 22, 31, 22, 31); g.placeThings('door', 22, 33, 22, 33);
      const set = G.traps.length + G.doors.length, dig = A.hero(20.5, 20.5, 'Knight', true), t0 = G.traps.map(t => t.charges).join(); let at = null; A.run(60, () => { if (Math.hypot(dig.x - 27.5, dig.y - 20.5) < 3) { at = G.time; return true; } return false; });
      return { set, arrived: at !== null, charges: G.traps.map(t => t.charges).join() === t0, doorHp: G.doors.every(d => d.hp === d.maxHp) };
    });
    check('two traps and a door guard the long way round: the digger tunnels past them, arrives, and none of them is touched', byp.set === 3 && byp.arrived && byp.charges && byp.doorHp, JSON.stringify(byp));
    await page.close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall digging checks passed'); process.exit(fails ? 1 : 0);
})();
