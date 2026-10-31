#!/usr/bin/env node
/* Headless checks for the sandbox and endless mode (web/levels.js "The sandbox", web/sandbox.html, web/game.js, web/progress.js, docs/06-levels.md).
 *   node tools/test_sandbox.js     (needs playwright with chromium)
 *   1. the wave generator: deterministic, sensible, bosses every 5th wave (Prince, King, Prince ...)
 *   2. makeSandbox: presets, clamping, validation
 *   3. a sandbox level loads with its options (gold, mana, unlocks, waves, seed)
 *   4. a fixed sandbox plays to victory: no stars, nothing saved as a chapter, Retry keeps every option
 *   5. endless: unlimited waves, growing strength, faster waves, bosses, never "won", Retire, best per preset
 *   6. the sandbox page: controls, summary, the URL it builds, remembered settings
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8770, ROOT = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const HEROES = ['Knight', 'Archer', 'Mage', 'Thief', 'Guard', 'Monk', 'Prince', 'Dwarf', 'Giant', 'Stone Knight', 'Fairy', 'King'];

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    await sleep(800);
    const problems = [];
    const fresh = () => browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const open = async (ctx, url, wait = 400) => { const page = await ctx.newPage(); page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
      page.on('dialog', d => d.accept()); await page.goto(ROOT + url, { waitUntil: 'load' }); await sleep(wait); return page; };
    const game = async (ctx, query) => { const page = await open(ctx, 'index.html?sound=0&view=2d&' + query); await page.evaluate(() => { window.__game.G.speed = 0; }); return page; };

    console.log('1. the wave generator');
    let ctx = await fresh(), page = await open(ctx, 'sandbox.html');
    const gen = await page.evaluate((HEROES) => {
      const P = window.sandboxParty, out = { bad: [], sizes: [], boss: {}, kinds: new Set(), healers: 0, same: true, firsts: [P(1), P(2)] };
      for (let n = 1; n <= 40; n++) { const a = P(n), b = P(n); if (a.join() !== b.join()) out.same = false; out.sizes.push(a.length); for (const k of a) { if (!HEROES.includes(k)) out.bad.push(n + ':' + k); if (n <= 15) out.kinds.add(k); }
        out.healers = Math.max(out.healers, a.filter(k => k === 'Monk' || k === 'Fairy').length); out.boss[n] = a[0]; if (n % 5 && (a.includes('Prince') || a.includes('King'))) out.bad.push('boss at ' + n); }
      out.kinds = [...out.kinds]; return out; }, HEROES);
    check('every name is a real hero; no boss outside every 5th wave', gen.bad.length === 0, gen.bad.join());
    check('deterministic: the same wave gives the same party', gen.same);
    check('parties start at 2 and grow to the Gate pad\'s 9', Math.min(...gen.sizes) === 2 && Math.max(...gen.sizes) === 9 && gen.sizes.every((s, i) => i === 0 || s >= gen.sizes[i - 1]), gen.sizes.slice(0, 12).join());
    check('waves 1 and 2 are only Knights and Archers', gen.firsts.every(p => p.every(k => k === 'Knight' || k === 'Archer')), gen.firsts.map(p => p.join('+')).join(' | '));
    check('by wave 15 every ordinary hero type has appeared', ['Knight', 'Archer', 'Thief', 'Mage', 'Guard', 'Monk', 'Dwarf', 'Fairy', 'Giant', 'Stone Knight'].every(k => gen.kinds.includes(k)), gen.kinds.join());
    check('at most two healers in any party', gen.healers <= 2, gen.healers);
    check('bosses lead waves 5, 10, 15, 20 ...: Prince, King, Prince, King', gen.boss[5] === 'Prince' && gen.boss[10] === 'King' && gen.boss[15] === 'Prince' && gen.boss[20] === 'King' && gen.boss[35] === 'Prince' && gen.boss[40] === 'King', [5, 10, 15, 20].map(n => gen.boss[n]).join());
    await ctx.close();

    console.log('2. makeSandbox');
    ctx = await fresh(); page = await game(ctx, 'level=lesson');
    const mk = await page.evaluate(() => {
      const g = window.__game, M = window.makeSandbox, D = window.DIFFICULTY, errs = {}, out = {};
      for (const id in D) { errs[id] = [g.validateLevel(M({ diff: id, waves: '6' })), g.validateLevel(M({ diff: id, endless: '1' }))].flat(); }
      out.errs = errs; const d = M({}), c = M({ waves: '999', gold: '-5', mana: '99999', diff: 'bogus', seed: 'x', unlocks: 'maybe' }), lo = M({ waves: '0' });
      out.def = [d.waves.plan.length, d.start.gold, d.start.mana, d.sandbox.diff, d.seed, d.start.unlock, d.name]; out.clamp = [c.waves.plan.length, c.start.gold, c.start.mana, c.sandbox.diff, c.seed, c.start.unlock, lo.waves.plan.length];
      const ids = Object.keys(D); out.mono = ids.every((id, i) => i === 0 || (D[id].heroMult > D[ids[i - 1]].heroMult && D[id].prep < D[ids[i - 1]].prep && D[id].interval < D[ids[i - 1]].interval && D[id].heartHp < D[ids[i - 1]].heartHp));
      const e = M({ endless: '1', diff: 'hard' }); out.endless = [e.waves.endless, e.waves.plan.length, e.objectives.length, e.name, e.waves.heroMult, e.waves.prep, e.waves.interval, e.rules.heartHp, e.waves.minInterval];
      out.plan = M({ waves: '10' }).waves.plan.map(p => p[0]).join(); out.isolated = (() => { M({}).terrain.grid = 1; return !!window.LEVELS.classic.terrain.generate; })();
      return out; });
    check('all four presets validate, fixed and endless', Object.values(mk.errs).every(e => e.length === 0), JSON.stringify(mk.errs));
    check('defaults: 8 waves, 1500 gold, 300 mana, Keeper, seed 7, normal research', mk.def.join() === '8,1500,300,normal,7,none,Sandbox', mk.def.join());
    check('out-of-range and unknown values are clamped / ignored', mk.clamp.join() === '15,200,1000,normal,7,none,3', mk.clamp.join());
    check('harder presets: stronger heroes, less prep, shorter gaps, a weaker Heart', mk.mono);
    check('endless: no plan, no objectives, hard preset numbers', mk.endless.join() === 'true,0,0,Endless Siege,1.25,75,90,2200,55', mk.endless.join());
    check('the fixed plan is the generator\'s (bosses on waves 5 and 10)', /,Prince,.*,King$/.test(mk.plan) && mk.plan.split(',').length === 10, mk.plan);
    check('building a sandbox does not change the classic level', mk.isolated);
    await ctx.close();

    console.log('3. a sandbox level loads with its options');
    ctx = await fresh(); page = await game(ctx, 'level=sandbox&diff=hard&waves=5&gold=2500&mana=600&unlocks=all&seed=11&nosave=1');
    const lv = await page.evaluate(() => { const g = window.__game, G = g.G; let h = 2166136261; for (const t of G.map) { h ^= t.t; h = Math.imul(h, 16777619) >>> 0; h ^= t.hp | 0; h = Math.imul(h, 16777619) >>> 0; }
      return { id: g.LV.id, waves: g.VAR.WAVES, gold: G.gold, mana: Math.round(G.mana), done: Object.keys(G.research.done).length, total: Object.keys(g.RESEARCH).length, heartHp: G.heartHp, prep: g.VAR.FIRST_WAVE_DELAY, hash: h,
        last: g.LV.waves.plan[4][0], errs: g.validateLevel(g.LV), brief: document.getElementById('boxLog') && G.log[0], objs: document.getElementById('objList').textContent }; });
    check('options arrive: 5 waves, 2500 gold, ~600 mana, everything researched, Overlord numbers', lv.id === 'sandbox' && lv.waves === 5 && lv.gold === 2500 && lv.mana >= 600 && lv.mana < 620 && lv.done === lv.total && lv.heartHp === 2200 && lv.prep === 75, JSON.stringify(lv));
    check('the level validates and wave 5 is led by the Prince', lv.errs.length === 0 && lv.last === 'Prince', lv.errs.join());
    check('the default objective is shown', /Defeat every wave/.test(lv.objs));
    const hashOf = async (q) => { const p = await game(ctx, 'level=sandbox&' + q); const h = await p.evaluate(() => { let h = 2166136261; for (const t of window.__game.G.map) { h ^= t.t; h = Math.imul(h, 16777619) >>> 0; h ^= t.hp | 0; h = Math.imul(h, 16777619) >>> 0; } return h; }); await p.close(); return h; };
    const h11 = await hashOf('seed=11'), h12 = await hashOf('seed=12');
    check('the seed picks the map: same seed same dungeon, another seed another', h11 === lv.hash && h12 !== h11, [h11, h12, lv.hash].join(' '));
    await ctx.close();

    console.log('4. a fixed sandbox, played to victory');
    ctx = await fresh(); page = await game(ctx, 'level=sandbox&diff=easy&waves=3&seed=5');
    const f = await page.evaluate(() => { const g = window.__game, G = g.G, out = { sizes: [], scales: [] }; G.gateOpen = true;
      for (let i = 0; i < 3; i++) { G.nextWave = G.time; g.step(0.05); out.sizes.push(G.heroes.length); out.scales.push(Math.round(G.heroes[0].maxHp / g.HEROES.find(h => h.name === G.heroes[0].name).hp * 100) / 100); out.overMid = G.over; G.heroes.forEach(h => { h.dead = true; }); g.step(0.05); }
      return Object.assign(out, { over: G.over, wave: G.wave }); });
    check('three waves arrive with the planned parties, stronger each time (easy: x0.7)', f.sizes.join() === '2,2,3' && f.scales.join() === '0.7,0.77,0.84' && f.over === 'victory', JSON.stringify(f));
    await sleep(900);
    const e = await page.evaluate(() => ({ title: document.getElementById('endTitle').textContent, stars: document.querySelectorAll('#endStars li').length, best: document.getElementById('endBest').textContent, next: getComputedStyle(document.getElementById('endNext')).display,
      menu: document.getElementById('endMenu').textContent, saved: localStorage.getItem('dm.save.v1'), stats: document.getElementById('endStats').textContent, hudMenu: document.getElementById('bMenu').textContent, retire: getComputedStyle(document.getElementById('bRetire')).display }));
    check('Victory screen without stars or "best", no Next, button says Sandbox', e.title === 'Victory' && e.stars === 0 && e.best === '' && e.next === 'none' && e.menu === 'Sandbox' && /Heart 100%/.test(e.stats), JSON.stringify([e.title, e.stars, e.best, e.next, e.menu]));
    check('a fixed sandbox saves nothing', e.saved === null, e.saved);
    check('the HUD button says Sandbox and there is no Retire in a fixed game', e.hudMenu === '☰ Sandbox' && e.retire === 'none', e.hudMenu + ' ' + e.retire);
    await Promise.all([page.waitForURL(/index\.html\?/), page.evaluate(() => document.getElementById('endRetry').click())]); await sleep(300);
    const u = new URL(page.url()).searchParams;
    check('Retry reopens the same sandbox: every option and the seed kept, behind the briefing', ['level', 'diff', 'waves', 'seed'].every(k => u.get(k) === { level: 'sandbox', diff: 'easy', waves: '3', seed: '5' }[k]) && u.get('brief') === '1', page.url());
    await ctx.close();

    console.log('5. endless mode');
    ctx = await fresh(); page = await game(ctx, 'level=sandbox&endless=1&diff=normal&seed=3');
    const pre = await page.evaluate(() => { const g = window.__game; return { waves: g.VAR.WAVES, errs: g.validateLevel(g.LV), objs: g.OBJECTIVES.length, retire: getComputedStyle(document.getElementById('bRetire')).display, name: g.LV.name }; });
    check('unlimited waves, valid, no objectives, a Retire button', pre.waves === Infinity && pre.errs.length === 0 && pre.objs === 0 && pre.retire !== 'none' && pre.name === 'Endless Siege', JSON.stringify(pre));
    const en = await page.evaluate(() => { const g = window.__game, G = g.G, out = { parties: [], ratio: [], gaps: [], over: [] }; G.gateOpen = true;
      for (let i = 1; i <= 12; i++) { G.nextWave = G.time; g.step(0.05); out.parties.push(G.heroes.map(h => h.name).join('+')); const h0 = G.heroes[0]; out.ratio.push(h0.maxHp / g.HEROES.find(k => k.name === h0.name).hp); out.gaps.push(Math.round(G.nextWave - G.time));
        out.over.push(G.over); G.heroes.forEach(h => { h.dead = true; }); g.step(0.05); }
      out.hud = document.getElementById('hWave').textContent; out.wave = G.wave; out.leaders = out.parties.map(p => p.split('+')[0]); return out; });
    check('twelve waves come and go: parties are the generator\'s', en.wave === 12 && en.parties[0] === 'Knight+Archer' && en.parties[11].split('+').length === 9, en.parties[11]);
    check('bosses lead waves 5 and 10 (Prince, then King)', en.leaders[4] === 'Prince' && en.leaders[9] === 'King', en.leaders.join());
    check('hero strength keeps rising (x1.0 -> about x2.3)', en.ratio[0] === 1 && en.ratio.every((r, i) => i === 0 || r > en.ratio[i - 1]) && Math.abs(en.ratio[11] - 2.32) < 0.05, en.ratio.map(r => r.toFixed(2)).join());
    check('the gap between waves shrinks: 100 s after wave 1, 84 s after wave 12', en.gaps[0] === 100 && en.gaps[11] === 84 && en.gaps.every((g, i) => i === 0 || g <= en.gaps[i - 1]), en.gaps.join());
    check('endless is never won, however many waves are beaten', en.over.every(o => o === null) && await page.evaluate(() => window.__game.G.over === null));
    await sleep(300);
    const hud = await page.evaluate(() => ({ wave: document.getElementById('hWave').textContent, panel: document.getElementById('objList').textContent }));
    check('the HUD shows "12 / ∞" and the panel shows waves survived and best', hud.wave === '12 / ∞' && /Waves survived 12 · best 0/.test(hud.panel), JSON.stringify(hud));
    await page.click('#bRetire'); await sleep(900);
    const rt = await page.evaluate(() => ({ title: document.getElementById('endTitle').textContent, stats: document.getElementById('endStats').textContent, best: document.getElementById('endBest').textContent, stars: document.querySelectorAll('#endStars li').length, saved: JSON.parse(localStorage.getItem('dm.save.v1')), over: window.__game.G.over, outcome: window.__game.G.result.outcome }));
    check('Retire ends the run: "Retired", 12 waves, a new best for Keeper', rt.title === 'Retired' && /Waves survived 12/.test(rt.stats) && rt.best === 'New best for Keeper!' && rt.over === 'defeat' && rt.outcome === 'retired', JSON.stringify([rt.title, rt.stats, rt.best]));
    check('saved: best 12 for normal, no chapter entry', rt.saved.endless.normal.best === 12 && rt.saved.endless.normal.runs === 1 && Object.keys(rt.saved.levels).length === 0, JSON.stringify(rt.saved));
    await page.close();
    // a worse run: overrun while wave 3's heroes are alive. 2 waves survived, best stays 12
    page = await game(ctx, 'level=sandbox&endless=1&diff=normal&seed=3');
    await page.evaluate(() => { const g = window.__game, G = g.G; G.gateOpen = true; for (let i = 0; i < 3; i++) { G.nextWave = G.time; g.step(0.05); if (i < 2) { G.heroes.forEach(h => { h.dead = true; }); g.step(0.05); } } g.hurt({ heart: true, dead: false, x: G.heart.x, y: G.heart.y }, 99999, {}); }); await sleep(900);
    const ov = await page.evaluate(() => ({ title: document.getElementById('endTitle').textContent, stats: document.getElementById('endStats').textContent, best: document.getElementById('endBest').textContent, line: document.getElementById('endLine').textContent, saved: JSON.parse(localStorage.getItem('dm.save.v1')).endless.normal }));
    check('being overrun with wave 3 alive scores 2 waves; the best stays 12', ov.title === 'Overrun' && /Waves survived 2/.test(ov.stats) && ov.best === 'Best for Keeper: 12 waves' && ov.saved.best === 12 && ov.saved.runs === 2, JSON.stringify([ov.title, ov.stats, ov.best, ov.saved]));
    check('the Heart-destroyed line is shown', /Heart has been destroyed/.test(ov.line));
    await page.close();
    page = await game(ctx, 'level=sandbox&endless=1&diff=easy&seed=3');
    await page.evaluate(() => { const g = window.__game, G = g.G; G.gateOpen = true; G.nextWave = G.time; g.step(0.05); G.heroes.forEach(h => { h.dead = true; }); g.step(0.05); }); await page.click('#bRetire'); await sleep(700);
    const ez = await page.evaluate(() => JSON.parse(localStorage.getItem('dm.save.v1')).endless);
    check('each preset keeps its own best', ez.easy.best === 1 && ez.normal.best === 12, JSON.stringify(ez));
    await page.close();
    page = await game(ctx, 'level=sandbox&endless=1&diff=hard&nosave=1');
    await page.evaluate(() => { const g = window.__game, G = g.G; G.gateOpen = true; G.nextWave = G.time; g.step(0.05); G.heroes.forEach(h => { h.dead = true; }); g.step(0.05); }); await page.click('#bRetire'); await sleep(700);
    check('?nosave=1 keeps endless scores out of the save', await page.evaluate(() => !JSON.parse(localStorage.getItem('dm.save.v1')).endless.hard && document.getElementById('endBest').textContent === ''));
    await page.close();
    page = await open(ctx, 'sandbox.html');
    const tb = await page.evaluate(() => [...document.querySelectorAll('#best tr')].map(tr => tr.textContent));
    check('the sandbox page lists the bests', tb.join('|') === 'Apprentice1|Keeper12|Overlord—|Dungeon Master—', tb.join('|'));
    await ctx.close();

    console.log('6. the sandbox page');
    ctx = await fresh(); page = await open(ctx, 'menu.html');
    check('the chapter menu links to the sandbox', await page.evaluate(() => document.getElementById('sandbox').getAttribute('href') === 'sandbox.html'));
    await page.goto(ROOT + 'sandbox.html?view=2d&sound=0', { waitUntil: 'load' }); await sleep(300);
    const sb = () => page.evaluate(() => ({ st: { ...window.__sandbox.state }, wavesOut: document.getElementById('wavesOut').textContent, wavesDis: document.getElementById('waves').disabled, summary: document.getElementById('summary').textContent, begin: document.getElementById('begin').textContent,
      on: [...document.querySelectorAll('.opt.on')].map(b => b.dataset.v) }));
    let s = await sb();
    check('defaults: fixed siege, 8 waves, Keeper', s.st.mode === 'fixed' && s.st.waves === 8 && s.st.diff === 'normal' && s.on.join() === 'fixed,normal,1' && s.wavesOut === '8' && !s.wavesDis, JSON.stringify(s.on));
    await page.fill('#waves', '12'); await page.click('.opt[data-v="hard"]'); await page.fill('#gold', '3000'); await page.fill('#mana', '500'); await page.check('#unlocks'); await page.fill('#seed', '42'); s = await sb();
    check('sliders, preset, research and seed update the summary', s.st.waves === 12 && s.st.diff === 'hard' && s.st.gold === 3000 && s.st.mana === 500 && s.st.unlocks && s.st.seed === 42 && /Overlord/.test(s.summary) && /12<?.*waves/.test(s.summary) && /3000 gold/.test(s.summary) && /everything researched/.test(s.summary), s.summary);
    await page.click('.opt[data-v="endless"]'); s = await sb();
    check('endless disables the waves slider, shows ∞, renames Begin', s.wavesDis && s.wavesOut === '∞' && /Endless/.test(s.begin) && /ever faster/.test(s.summary), s.wavesOut + ' / ' + s.begin);
    const q = await page.evaluate(() => Object.fromEntries(window.__sandbox.params()));
    check('the URL carries every option (endless: no waves)', JSON.stringify(q) === JSON.stringify({ level: 'sandbox', diff: 'hard', gold: '3000', mana: '500', unlocks: 'all', seed: '42', endless: '1', brief: '1', view: '2d', sound: '0' }), JSON.stringify(q));      // view and sound are passed through
    const help = await page.evaluate(() => ({ items: document.querySelectorAll('.help li').length, text: document.querySelector('.help').textContent, hints: document.querySelectorAll('.hint').length, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
    check('the page explains itself: a "How the sandbox works" panel of 6 points, no horizontal overflow', help.items === 6 && /How the sandbox works/.test(help.text) && !help.overflow, JSON.stringify([help.items, help.overflow]));
    check('the help covers the map, starting the invasion, fixed versus endless (Retire), difficulty and stars', ['classic dungeon', 'tunnel links a Gate', 'no stars', 'Retire', 'Heart\'s health'].every(k => help.text.includes(k)), help.text.length + ' chars');
    await page.reload({ waitUntil: 'load' }); await sleep(200); s = await sb();
    check('settings are remembered', s.st.mode === 'endless' && s.st.diff === 'hard' && s.st.gold === 3000 && s.st.seed === 42 && s.st.unlocks);
    await page.click('.opt[data-v="fixed"]'); const d0 = (await sb()).st.seed; await page.click('#dice'); const d1 = (await sb()).st.seed;
    check('the dice picks a new seed in range', d1 !== d0 && d1 >= 0 && d1 <= 999999, d0 + ' -> ' + d1);
    await page.fill('#gold', '5000'); await page.fill('#seed', '31'); await Promise.all([page.waitForURL(/index\.html\?/), page.click('#begin')]); await sleep(900);
    const gm = await page.evaluate(() => ({ id: window.__game.LV.id, gold: window.__game.G.gold, shown: getComputedStyle(document.getElementById('briefing')).display, title: document.getElementById('briefTitle').textContent, waves: window.__game.VAR.WAVES, seedUsed: window.__game.LV.seed }));
    check('Begin opens that sandbox behind its briefing', gm.id === 'sandbox' && gm.gold === 5000 && gm.shown === 'flex' && gm.title === 'Sandbox' && gm.waves > 2 && gm.waves < 16 && gm.seedUsed === 31, JSON.stringify(gm));
    await ctx.close();
    ctx = await fresh(); page = await open(ctx, 'index.html?sound=0&view=2d&level=sandbox&endless=1&brief=1', 600);
    check('an endless briefing lists the endless goals', await page.evaluate(() => document.getElementById('briefTitle').textContent === 'Endless Siege' && /boss/.test(document.getElementById('briefGoals').textContent)));
    await ctx.close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall sandbox checks passed'); process.exit(fails ? 1 : 0);
})();
