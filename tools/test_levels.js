#!/usr/bin/env node
/* Headless checks for the level format (web/levels.js, the loader in web/game.js, docs/06-levels.md).
 *   node tools/test_levels.js     (needs playwright with chromium)
 *   1. every level in levels.js passes validateLevel; bad data is rejected with a useful message
 *   2. the "classic" level still equals the original hard-coded one (positions, resources, invasion pace, and the map for seed 7)
 *   3. the text-grid level ("tiny") loads exactly as drawn: size, room centres, terrain, start resources, unlocks
 *   4. a full scripted run of "tiny": dig to the Portal and the Hero Gate, the waves arrive on the level's own schedule, the level can be won
 *   5. an unknown ?level=... falls back to the default and nothing logs errors or warnings
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8766, BASE = `http://localhost:${PORT}/index.html`;
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
      const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
      await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });          // we drive the simulation by hand
      await page.goto(BASE + '?view=2d&sound=0&' + query, { waitUntil: 'load' }); await sleep(300); return page;
    };

    console.log('1. validation');
    let page = await open('');
    const v = await page.evaluate(() => {
      const g = window.__game, out = { levels: Object.keys(g.LEVEL_TABLE), errors: {} };
      for (const id of out.levels) out.errors[id] = g.validateLevel(g.LEVEL_TABLE[id]);
      const base = JSON.parse(JSON.stringify(g.LEVEL_TABLE.classic));
      const bad = (mut) => { const lv = JSON.parse(JSON.stringify(base)); mut(lv); return g.validateLevel(lv); };
      out.noHeart = bad(l => { l.heart = null; }); out.badHero = bad(l => { l.waves.plan[0] = ['Goblin Lord']; }); out.noGate = bad(l => { l.gates = []; });
      out.ragged = (() => { const lv = JSON.parse(JSON.stringify(g.LEVEL_TABLE.tiny)); lv.terrain.grid[3] = lv.terrain.grid[3].slice(1); return g.validateLevel(lv); })();
      out.noWaves = bad(l => { l.waves.plan = []; });
      return out;
    });
    check('levels present: ' + v.levels.join(', '), v.levels.includes('classic') && v.levels.includes('tiny'));
    for (const id of v.levels) check('"' + id + '" validates', v.errors[id].length === 0, v.errors[id].join('; '));
    check('missing Heart is reported', v.noHeart.some(e => /Heart/.test(e)), v.noHeart.join('; '));
    check('unknown hero is reported by name', v.badHero.some(e => /Goblin Lord/.test(e)), v.badHero.join('; '));
    check('no Hero Gate is reported', v.noGate.some(e => /Hero Gate/.test(e)));
    check('ragged grid is reported', v.ragged.some(e => /grid row/.test(e)));
    check('empty wave plan is reported', v.noWaves.some(e => /waves.plan/.test(e)));
    await page.close();

    console.log('2. classic equals the original level');
    page = await open('seed=7');
    const c = await page.evaluate(() => {
      const g = window.__game, G = g.G; let h = 2166136261; const mix = (n) => { h ^= (n | 0); h = Math.imul(h, 16777619) >>> 0; };
      for (const t of G.map) { mix(t.t); mix(t.owner); mix(t.hp); mix(t.gold); mix(t.tag); mix(t.room); }
      return { id: g.LV.id, size: [g.W, g.H], heart: G.heart, portal: G.portal, gate: G.gate, gates: G.gates.length, gold: G.gold, mana: Math.round(G.mana), imps: G.imps.length,
        tagged: G.map.filter(t => t.tag).length, research: G.research.current, done: Object.keys(G.research.done).length, heartHp: G.heartHp,
        waves: g.VAR.WAVES, prep: g.VAR.FIRST_WAVE_DELAY, interval: g.VAR.WAVE_INTERVAL, hash: h, log: G.log[0] };
    });
    check('size 40x28', c.size[0] === 40 && c.size[1] === 28); check('Heart (6,14), Portal (32,14), Gate (22,23)', c.heart.x === 6 && c.heart.y === 14 && c.portal.x === 32 && c.portal.y === 14 && c.gate.x === 22 && c.gate.y === 23);
    check('1000 gold, 3 imps, mana about 300', c.gold === 1000 && c.imps === 3 && c.mana >= 300 && c.mana < 320);
    check('4 tiles pre-tagged, researching Prison, nothing unlocked', c.tagged === 4 && c.research === 'prison' && c.done === 0);
    check('5 waves, first after 75 s, then every 110 s, Heart 2500', c.waves === 5 && c.prep === 75 && c.interval === 110 && c.heartHp === 2500);
    check('map for seed 7 is byte-for-byte the original (hash ' + c.hash + ')', c.hash === 1566652499);
    await page.close();

    console.log('3. the text-grid level loads as drawn');
    page = await open('level=tiny');
    const t = await page.evaluate(() => {
      const g = window.__game, G = g.G, LV = g.LV, rows = LV.terrain.grid, T = g.T, ch = {};
      ch[T.ROCK] = '#'; ch[T.EARTH] = '.'; ch[T.GOLD] = 'g'; ch[T.GEM] = 'G';
      let mismatches = 0; const owners = {};
      for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
        const tl = G.map[y * g.W + x], c = rows[y][x];
        const expect = c === '#' || c === '.' || c === 'g' || c === 'G' ? ch[tl.t] === c : tl.t === T.PATH || (tl.t === T.HEART || tl.t === T.PORTAL || tl.t === T.GATE);   // markers sit inside a 3x3 pad
        if (!expect) mismatches++;
        if (c === 'o') owners.o = (owners.o || 0) + (tl.owner === 1 ? 1 : 0); if (c === 'h') owners.h = (owners.h || 0) + (tl.owner === 2 ? 1 : 0); if (c === '_') owners._ = (owners._ || 0) + (tl.owner === 0 ? 1 : 0);
      }
      const at = (p) => G.map[p[1] * g.W + p[0]].t;
      return { id: LV.id, size: [g.W, g.H], heart: G.heart, portal: G.portal, gates: G.gates, mismatches, owners, heartT: at([4, 7]) === T.HEART && at([3, 6]) === T.HEART && at([5, 8]) === T.HEART,
        portalT: at([15, 7]) === T.PORTAL, gateT: at([25, 7]) === T.GATE, gold: G.gold, mana: Math.round(G.mana), imps: G.imps.length, tagged: G.map.filter(x => x.tag).length,
        done: Object.keys(G.research.done).length, total: Object.keys(g.RESEARCH).length, waves: g.VAR.WAVES, prep: g.VAR.FIRST_WAVE_DELAY, heartHp: G.heartHp, log: G.log[0] };
    });
    check('30x16', t.size[0] === 30 && t.size[1] === 16); check('Heart, Portal, Gate found from the H P X markers', t.heart.x === 4 && t.heart.y === 7 && t.portal.x === 15 && t.portal.y === 7 && t.gates.length === 1 && t.gates[0].x === 25);
    check('every grid cell became the right terrain (' + t.mismatches + ' mismatches)', t.mismatches === 0);
    check('3x3 rooms around the markers', t.heartT && t.portalT && t.gateT); check('owners: 24 floor tiles each of yours (o), hero land (h) and bare floor (_) around the 3x3 room pads', t.owners.o === 24 && t.owners.h === 24 && t.owners._ === 24, JSON.stringify(t.owners));
    check('start: 1500 gold, 4 imps, 2 tiles tagged, everything researched', t.gold === 1500 && t.imps === 4 && t.tagged === 2 && t.done === t.total, `gold ${t.gold} imps ${t.imps} tagged ${t.tagged} done ${t.done}/${t.total}`);
    check('rules: 2 waves, first after 30 s, Heart 2000, own welcome text', t.waves === 2 && t.prep === 30 && t.heartHp === 2000 && /small test hall/i.test(t.log), t.log);
    await page.close();

    console.log('4. playing the grid level');
    page = await open('level=tiny');
    const r = await page.evaluate(() => {
      const g = window.__game, G = g.G, out = { events: [] }; G.speed = 0;
      const run = (secs, until) => { for (let s = 0; s < secs && !G.over; s += 0.05) { g.step(0.05); if (until && until()) return true; } return !!(until && until()); };
      g.tagRect(7, 7, 12, 7, true); g.tagRect(18, 7, 22, 7, true);     // the two corridors between the caverns
      out.portal = run(250, () => G.portalOwned); out.portalAt = Math.round(G.time);
      out.gate = run(250, () => G.gateOpen); out.gateAt = Math.round(G.time); const linked = G.time;
      out.countdown = Math.round(G.nextWave - G.time);                                          // should be the level's own 30 s prep
      out.w1 = run(60, () => G.wave === 1); out.w1After = Math.round((G.time - linked) * 10) / 10; out.w1Heroes = G.heroes.map(h => h.name);
      G.heroes.forEach(h => { h.dead = true; }); g.step(0.05);
      const t1 = G.time; out.w2 = run(80, () => G.wave === 2); out.w2After = Math.round((G.time - t1) * 10) / 10; out.w2Heroes = G.heroes.map(h => h.name).sort();
      G.heroes.forEach(h => { h.dead = true; }); run(2); out.over = G.over; out.wave = G.wave;
      return out;
    });
    check('Portal reached and claimed', r.portal, `at ${r.portalAt}s`); check('Hero Gate linked', r.gate, `at ${r.gateAt}s`);
    check('countdown starts at the level\'s 30 s', Math.abs(r.countdown - 30) <= 1, r.countdown + ' s');
    check('wave 1 arrives 30 s after linking, one Knight', r.w1 && Math.abs(r.w1After - 30) <= 1 && r.w1Heroes.join() === 'Knight', `${r.w1After}s ${r.w1Heroes}`);
    check('wave 2 arrives 50 s later: Knight + Archer', r.w2 && Math.abs(r.w2After - 50) <= 1 && r.w2Heroes.join() === 'Archer,Knight', `${r.w2After}s ${r.w2Heroes}`);
    check('beating the last wave wins the level', r.over === 'victory' && r.wave === 2, r.over);
    await page.close();

    console.log('5. fallback and a clean console');
    page = await open('level=does-not-exist');
    const f = await page.evaluate(() => ({ id: window.__game.LV.id }));
    check('unknown level falls back to the default', f.id === 'classic', f.id); await page.close();
    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall level checks passed'); process.exit(fails ? 1 : 0);
})();
