#!/usr/bin/env node
/* Headless checks for several Hero Gates (web/game.js heroLogic / spawnWave, the 3D view, the sandbox's "Two Gates", docs/06-levels.md).
 *   node tools/test_gates.js     (needs playwright with chromium)
 *   1. validation: two or more X markers are fine; the `gate` objective can ask for several
 *   2. each Gate links on its own; the first link starts the clock, the second one is announced
 *   3. a wave comes out of every linked Gate only, split between them, the boss alternating between Gates
 *   4. heroes from both Gates walk to the Heart, and flee back to the Gate they came from
 *   5. one-Gate levels behave exactly as before
 *   6. the 3D view shows and lights both Gates; the sandbox page offers "Two Gates"
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8771, ROOT = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    await sleep(800);
    const problems = [];
    const open = async (query, view = '2d') => {
      const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GL Driver Message/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });
      await page.goto(ROOT + 'index.html?sound=0&view=' + view + '&' + query, { waitUntil: 'load' }); await sleep(view === '2d' ? 300 : 2500);
      await page.evaluate(() => { window.__game.G.speed = 0; }); return page;
    };
    // a corridor of claimed floor from the Heart's cavern to a Gate's cavern (the 88 x 60 sandbox map): trunk along y=29, then up or down x=44
    const carve = (page, which) => page.evaluate((which) => { const g = window.__game, G = g.G, W = g.W; const cut = (x, y) => { const t = G.map[y * W + x]; t.t = g.T.PATH; t.hp = 1000; t.owner = 1; t.gold = 0; t.tag = 0; };
      if (which === 'trunk') for (let x = 10; x <= 44; x++) cut(x, 29); if (which === 'south') for (let y = 30; y <= 50; y++) cut(44, y); if (which === 'north') for (let y = 9; y <= 28; y++) cut(44, y); G.dirty = true; }, which);
    const run = (page, secs) => page.evaluate((secs) => { const g = window.__game; for (let s = 0; s < secs && !g.G.over; s += 0.05) g.step(0.05); }, secs);
    // a wave: the heroes standing out now plus the groups still due to step out of their Gates (delay = seconds until they do; tunnel = they dig their own way)
    const wave = (page) => page.evaluate(() => { const g = window.__game, G = g.G; G.nextWave = G.time; g.step(0.05); const gt = G.gates, all = G.heroes.map(h => [h, 0]).concat(G.pending.flatMap(p => p.heroes.map(h => [h, Math.round(p.at - G.time)])));
      return { n: G.wave, next: Math.round(G.nextWave - G.time), heroes: all.map(([h, delay]) => ({ name: h.name, gate: gt.indexOf(h.homeGate), near: gt.findIndex(q => Math.abs(h.x - q.x - .5) <= 1.6 && Math.abs(h.y - q.y - .5) <= 1.6), group: all.filter(([o]) => o.party === h.party).length, leader: h.leader && h.leader.id === h.id, delay, digger: !!h.digger, level: h.digLevel })) }; });
    const clear = (page) => page.evaluate(() => { const g = window.__game; g.G.pending = []; g.G.heroes.forEach(h => { h.dead = true; }); g.step(0.05); });

    console.log('1. validation');
    let page = await open('level=sandbox&gates=2&seed=4');
    const v = await page.evaluate(() => { const g = window.__game, M = window.makeSandbox, bad = (id, mut) => { const lv = JSON.parse(JSON.stringify(g.LEVEL_TABLE[id])); mut(lv); return g.validateLevel(lv); };
      return { sb: g.validateLevel(g.LV), sbEndless: g.validateLevel(M({ gates: '2', endless: '1' })), two: bad('tiny', l => { l.terrain.grid[2] = l.terrain.grid[2].slice(0, 3) + 'X' + l.terrain.grid[2].slice(4); l.terrain.grid[3] = l.terrain.grid[3].slice(0, 2) + 'hhhhh' + l.terrain.grid[3].slice(7); }),
        gate2one: bad('tiny', l => { l.objectives = [{ type: 'gate', n: 2 }]; }), gate1: bad('tiny', l => { l.objectives = [{ type: 'gate' }]; }), n: g.G.gates.length, pos: g.G.gates.map(q => [q.x, q.y]), t: g.G.gates.map(q => g.G.map[q.y * g.W + q.x].t === g.T.GATE) }; });
    check('the sandbox with two Gates validates (fixed and endless)', v.sb.length === 0 && v.sbEndless.length === 0, v.sb.join('; '));
    check('it has two Gates, south (44,54) and north (44,5), both built as rooms', v.n === 2 && JSON.stringify(v.pos) === '[[44,54],[44,5]]' && v.t.every(Boolean), JSON.stringify(v.pos));
    check('the `gate` objective can ask for 2 Gates, and says so when the level has one', v.gate2one.some(e => /2 Hero Gates/.test(e)) && v.gate1.length === 0, v.gate2one.join('; '));
    const cond = await page.evaluate(() => { const g = window.__game, G = g.G, c = { type: 'gate', n: 2 }, out = [g.condState(c).v]; G.gates[0].open = true; out.push(g.condState(c).v, g.condState(c).done); G.gates[1].open = true; out.push(g.condState(c).v, g.condState(c).done, g.COND.gate.label(c)); G.gates.forEach(q => { q.open = false; }); return out; });
    check('the objective counts linked Gates: 0, 1 (not done), 2 (done)', JSON.stringify(cond) === '[0,1,false,2,true,"Link tunnels to 2 Hero Gates"]', JSON.stringify(cond));

    console.log('2. each Gate links on its own');
    let s0 = await page.evaluate(() => ({ open: window.__game.G.gates.map(q => q.open), flag: window.__game.G.gateOpen, next: window.__game.G.nextWave, hud: document.getElementById('hNext').textContent }));
    check('at the start both Gates are shut and no wave is scheduled', s0.open.join() === 'false,false' && !s0.flag && s0.next === Infinity && s0.hud === 'tunnel to Gate', JSON.stringify(s0));
    await carve(page, 'trunk'); await run(page, 3);
    check('a tunnel to nowhere links neither Gate', await page.evaluate(() => window.__game.G.gates.every(q => !q.open) && !window.__game.G.gateOpen));
    await carve(page, 'south'); await run(page, 3);
    const l1 = await page.evaluate(() => { const G = window.__game.G; return { open: G.gates.map(q => q.open), flag: G.gateOpen, clock: Math.round(G.nextWave - G.time), log: G.log.filter(m => /Hero Gate/.test(m)) }; });
    check('tunnelling to the south Gate links only it and starts the invasion clock (prep 100 s)', l1.open.join() === 'true,false' && l1.flag && Math.abs(l1.clock - 98) <= 3 && /invade in 100s/.test(l1.log[0]), JSON.stringify(l1));
    check('the HUD shows the countdown and "gates 1/2"', /s · gates 1\/2$/.test(await page.evaluate(() => { window.__game.G.speed = 0; return new Promise(r => setTimeout(() => r(document.getElementById('hNext').textContent), 200)); })));

    await page.close(); page = await open('level=sandbox&gates=2&seed=4&endless=1'); await carve(page, 'trunk'); await carve(page, 'south'); await run(page, 3);
    console.log('3. waves split between the linked Gates');
    const w1 = await wave(page);
    check('wave 1 (Knight, Archer): once the south Gate is linked BOTH Gates send heroes: the Knight out of the south one now, the Archer out of the north one (not linked) 20 s later', w1.heroes.length === 2 && w1.heroes.find(h => h.name === 'Knight').near === 0 && w1.heroes.find(h => h.name === 'Knight').delay === 0 && w1.heroes.find(h => h.name === 'Archer').near === 1 && w1.heroes.find(h => h.name === 'Archer').delay === 20 && w1.heroes.every(h => h.leader), JSON.stringify(w1.heroes));
    check('the heroes of the Gate you have not tunnelled to are diggers of level 2 or better; the ones at the linked Gate dig only as the difficulty says (no extra digging level)', w1.heroes.find(h => h.name === 'Archer').digger && w1.heroes.find(h => h.name === 'Archer').level >= 2 && w1.heroes.find(h => h.name === 'Knight').level === undefined, JSON.stringify(w1.heroes));
    check('the next wave is 20 s (the stagger) plus at least 40 s after the first group', w1.next >= 60, String(w1.next));
    await clear(page); await carve(page, 'north'); await run(page, 3);
    const l2 = await page.evaluate(() => ({ open: window.__game.G.gates.map(q => q.open), log: window.__game.G.log[0] || '' , all: window.__game.G.log.filter(m => /linked too/.test(m)) }));
    check('linking the north Gate too is announced and does not restart the clock', l2.open.join() === 'true,true' && /Hero Gate 2 is linked too/.test(l2.all[0]), JSON.stringify(l2.all));
    const w2 = await wave(page);
    check('wave 2 (2 heroes) with both linked: one at each Gate, 20 s apart (the north one first this time), each the leader of its own group, nobody on a tunnelling dig level', w2.heroes.length === 2 && w2.heroes.map(h => h.near).sort().join() === '0,1' && w2.heroes.every(h => h.group === 1 && h.leader && h.level === undefined) && w2.heroes.find(h => h.near === 1).delay === 0 && w2.heroes.find(h => h.near === 0).delay === 20, JSON.stringify(w2.heroes));
    await clear(page);
    const w3 = await wave(page);
    check('wave 3 (3 heroes) is dealt 2 and 1, starting at the other Gate', w3.heroes.length === 3 && w3.heroes.filter(h => h.near === 0).length === 2 && w3.heroes.filter(h => h.near === 1).length === 1, JSON.stringify(w3.heroes.map(h => h.near)));
    check('every hero stands on the pad of the Gate it will flee to', w3.heroes.every(h => h.near === h.gate));
    await clear(page); await wave(page); await clear(page);
    const w5 = await wave(page); await clear(page);
    for (let i = 0; i < 4; i++) { await wave(page); await clear(page); }
    const w10 = await wave(page);
    const lead = (w) => w.heroes.find(h => h.name === 'Prince' || h.name === 'King');
    check('wave 5\'s Prince arrives at the south Gate and wave 10\'s King at the north one, both at once (the boss group never waits)', lead(w5) && lead(w5).near === 0 && lead(w5).delay === 0 && lead(w10) && lead(w10).name === 'King' && lead(w10).near === 1 && lead(w10).delay === 0, [lead(w5), lead(w10)].map(h => h && h.name + '@' + h.near).join());
    check('a big wave is split into two groups of at most 9', w10.heroes.length === 9 && [0, 1].every(k => w10.heroes.filter(h => h.near === k).length >= 4), w10.heroes.map(h => h.near).join(''));
    const logl = await page.evaluate(() => window.__game.G.log.find(m => /Wave 10/.test(m)));
    check('the log says "the 2 Hero Gates, 20 s apart"', /pour out of the 2 Hero Gates, 20 s apart/.test(logl), logl);
    const later = await page.evaluate(() => { const g = window.__game, G = g.G; G.pending = []; const before = G.heroes.length; G.heroes.length = 0; G.wave = 0; G.nextWave = G.time; g.step(0.05); const n0 = G.heroes.length, pend = G.pending.length; for (let s = 0; s < 21; s += 0.05) g.step(0.05); return { n0, pend, n1: G.heroes.length, log: G.log.find(m => /step out of Hero Gate/.test(m)) }; });
    check('the second group steps out of its Gate after 20 s and says so in the Log', later.pend === 1 && later.n1 > later.n0 && /step out of Hero Gate/.test(later.log || ''), JSON.stringify(later));
    await page.close();

    console.log('4. heroes walk to the Heart and flee to their own Gate');
    page = await open('level=sandbox&gates=2&seed=4&diff=easy');
    await carve(page, 'trunk'); await carve(page, 'south'); await carve(page, 'north'); await run(page, 3);
    const m = await page.evaluate(() => { const g = window.__game, G = g.G; G.nextWave = G.time; g.step(0.05); for (let s = 0; s < 21; s += 0.05) g.step(0.05); const d = (h) => Math.hypot(h.x - G.heart.x, h.y - G.heart.y), d0 = G.heroes.map(d); for (let s = 0; s < 20; s += 0.05) g.step(0.05); return { d0, d1: G.heroes.map(d), n: G.heroes.length, from: G.heroes.map(h => G.gates.indexOf(h.homeGate)) }; });
    check('after 20 s heroes from both Gates are closer to the Heart', m.n === 2 && m.d1.every((d, i) => d < m.d0[i] - 3) && m.from.slice().sort().join() === '0,1', JSON.stringify(m));
    const fl = await page.evaluate(() => { const g = window.__game, G = g.G; const out = G.heroes.map(h => { const ok = g.startFlee(h); const p = h.path; const end = p && p.length ? p[p.length - 1] : null; return { ok, state: h.state, gate: G.gates.indexOf(h.homeGate), end: end && [end.x, end.y], want: [h.homeGate.x, h.homeGate.y] }; }); return out; });
    check('a fleeing hero heads for the Gate it came out of (not just the first one)', fl.every(f => f.ok && f.state === 'flee' && f.end && f.end[0] === f.want[0] && f.end[1] === f.want[1]) && new Set(fl.map(f => f.gate)).size === 2, JSON.stringify(fl));
    const esc = await page.evaluate(() => { const g = window.__game, G = g.G; for (let s = 0; s < 120 && G.heroes.length; s += 0.05) g.step(0.05); return { left: G.heroes.length, log: G.log.filter(m => /escaped/.test(m)).length }; });
    check('fleeing heroes escape through their Gate', esc.left === 0 && esc.log === 2, JSON.stringify(esc));
    await page.close();

    console.log('5. one Gate behaves as before');
    page = await open('level=classic&seed=7');
    const one = await page.evaluate(() => { const g = window.__game, G = g.G; G.gateOpen = true; G.nextWave = G.time; g.step(0.05); return { same: G.gate === G.gates[0], n: G.gates.length, near: G.heroes.every(h => Math.abs(h.x - G.gate.x - .5) <= 1.6 && Math.abs(h.y - G.gate.y - .5) <= 1.6), count: G.heroes.length, log: G.log[0], hud: document.getElementById('hNext').textContent }; });
    check('classic: one Gate, the whole wave comes out of it, wording unchanged', one.same && one.n === 1 && one.near && one.count === 2 && /pour out of the Hero Gate!/.test(one.log), JSON.stringify(one));
    check('classic: no "gates n/m" in the HUD', !/gates/.test(one.hud), one.hud);
    await page.close();

    console.log('6. 3D view and the sandbox page');
    page = await open('level=sandbox&gates=2&seed=4', '3d');
    await carve(page, 'trunk'); await carve(page, 'south'); await run(page, 3); await sleep(500);
    const th = await page.evaluate(() => { const T = window.__three, sprites = []; T.scene.traverse(o => { if (o.userData && o.userData.name === 'hero_gate') sprites.push({ x: o.position.x, z: o.position.z, vis: o.visible, c: o.material.color.r }); });
      const lights = []; T.scene.traverse(o => { if (o.isPointLight && o.distance === 8) lights.push({ x: o.position.x, z: o.position.z, i: o.intensity }); }); return { sprites, lights }; });
    check('two Gate sprites stand at the two Gates, both visible', th.sprites.length === 2 && th.sprites.every(s => s.vis) && th.sprites.map(s => s.x + ',' + s.z).sort().join('|') === '44.5,5.5|44.5,54.5', JSON.stringify(th.sprites));
    check('a linked Gate glows brighter than a shut one (sprite and light)', th.sprites.find(s => s.z > 20).c > 0.9 && th.sprites.find(s => s.z < 10).c === 0.5 && th.lights.length === 2 && th.lights.find(l => l.z > 20).i === 1.8 && th.lights.find(l => l.z < 10).i === 0.6, JSON.stringify(th));
    await page.close();
    page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage(); page.on('pageerror', e => problems.push('pageerror: ' + e));
    await page.goto(ROOT + 'sandbox.html?view=2d&sound=0', { waitUntil: 'load' }); await sleep(300);
    const q0 = await page.evaluate(() => Object.fromEntries(window.__sandbox.params()));
    await page.click('#gates .opt[data-v="2"]'); const q1 = await page.evaluate(() => ({ p: Object.fromEntries(window.__sandbox.params()), sum: document.getElementById('summary').textContent, on: [...document.querySelectorAll('#gates .on')].map(b => b.dataset.v) }));
    check('the sandbox page: one Gate sends no gates param; Two Gates sends gates=2 and says so', q0.gates === undefined && q1.p.gates === '2' && /2 Hero Gates/.test(q1.sum) && q1.on.join() === '2', JSON.stringify(q1.p));
    await page.reload({ waitUntil: 'load' }); await sleep(200);
    check('the choice is remembered', await page.evaluate(() => window.__sandbox.state.gates === 2));
    await Promise.all([page.waitForURL(/index\.html\?/), page.click('#begin')]); await sleep(900);
    check('Begin starts a game with two Gates behind a briefing that mentions the second one', await page.evaluate(() => window.__game.G.gates.length === 2 && /2 Hero Gates \(south, north\)/.test(document.getElementById('briefText').textContent)));
    await page.context().close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall gate checks passed'); process.exit(fails ? 1 : 0);
})();
