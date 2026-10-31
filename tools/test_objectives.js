#!/usr/bin/env node
/* Headless checks for objectives, the tutorial guide, briefings and gate-less levels (web/game.js "objectives & the guide", docs/06-levels.md).
 *   node tools/test_objectives.js     (needs playwright with chromium)
 *   1. validateLevel accepts levels without a Portal or Hero Gate, and reports bad objectives / guide steps by name
 *   2. "lesson" (no Portal, no Gate, no heroes) loads cleanly in 2D and in 3D; the HUD shows no waves
 *   3. played start to finish: the guide walks through its steps, the objectives tick off, and the level is won by objectives alone
 *   4. the guide: manual "Got it" steps, the pulsing tool button, the map marker, hide button, ?guide=0
 *   5. the briefing overlay (?brief=1) pauses the game until "Begin"
 *   6. levels without `objectives` still mean "beat every wave"
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8768, BASE = `http://localhost:${PORT}/index.html`;
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
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
      await page.goto(BASE + '?sound=0&view=' + view + '&' + query, { waitUntil: 'load' }); await sleep(view === '2d' ? 300 : 2500);
      await page.evaluate(() => { window.__game.G.speed = 0; });                   // we drive the simulation by hand; the page keeps rendering the DOM
      return page;
    };

    console.log('1. validation');
    let page = await open('');
    const v = await page.evaluate(() => {
      const g = window.__game, clone = (id) => JSON.parse(JSON.stringify(g.LEVEL_TABLE[id])), bad = (id, mut) => { const lv = clone(id); mut(lv); return g.validateLevel(lv); };
      return {
        lesson: g.validateLevel(g.LEVEL_TABLE.lesson),
        noPortal: bad('tiny', l => { l.terrain.grid = l.terrain.grid.map(r => r.replace('P', '_')); }),
        noGateNoWaves: bad('tiny', l => { l.terrain.grid = l.terrain.grid.map(r => r.replace('X', 'h')); l.waves.plan = []; l.objectives = [{ type: 'gold', n: 10 }]; }),
        gateButWaves: bad('tiny', l => { l.terrain.grid = l.terrain.grid.map(r => r.replace('X', 'h')); }),
        noWayToWin: bad('lesson', l => { l.objectives = []; }),
        onlyOptional: bad('lesson', l => { l.objectives = [{ type: 'gold', n: 10, optional: true }]; }),
        unknownType: bad('lesson', l => { l.objectives.push({ type: 'conquer' }); }),
        noParam: bad('lesson', l => { l.objectives.push({ type: 'room' }); }),
        badRoom: bad('lesson', l => { l.objectives.push({ type: 'room', room: 'dungeon' }); }),
        badItem: bad('lesson', l => { l.objectives.push({ type: 'research', item: 'wizardry' }); }),
        surviveNoWaves: bad('lesson', l => { l.objectives.push({ type: 'survive' }); }),
        gateObjNoGate: bad('lesson', l => { l.objectives.push({ type: 'gate' }); }),
        badGuideTool: bad('lesson', l => { l.guide[1].tool = 'hammer'; }),
        badGuideText: bad('lesson', l => { l.guide.push({}); }),
        badGuideCond: bad('lesson', l => { l.guide.push({ text: 'x', when: { type: 'dug' } }); }),
      };
    });
    check('"lesson" (no Portal, no Hero Gate) validates', v.lesson.length === 0, v.lesson.join('; '));
    check('a level with no Portal validates', v.noPortal.length === 0, v.noPortal.join('; '));
    check('no Gate + no waves + objectives validates', v.noGateNoWaves.length === 0, v.noGateNoWaves.join('; '));
    check('waves without any Hero Gate are reported', v.gateButWaves.some(e => /Hero Gate/.test(e)), v.gateButWaves.join('; '));
    check('no waves and no objectives is reported', v.noWayToWin.some(e => /way to win/.test(e)), v.noWayToWin.join('; '));
    check('only optional objectives is reported', v.onlyOptional.some(e => /way to win/.test(e)));
    check('unknown objective type is reported by name', v.unknownType.some(e => /conquer/.test(e)), v.unknownType.join('; '));
    check('missing objective parameter is reported', v.noParam.some(e => /needs room/.test(e)), v.noParam.join('; '));
    check('unknown room / research item are reported', v.badRoom.some(e => /dungeon/.test(e)) && v.badItem.some(e => /wizardry/.test(e)));
    check('"survive" needs waves, "gate" needs a Hero Gate', v.surviveNoWaves.some(e => /survive.*waves/.test(e)) && v.gateObjNoGate.some(e => /gate.*Hero Gate/.test(e)), v.surviveNoWaves.concat(v.gateObjNoGate).join('; '));
    check('guide: unknown tool, missing text, bad condition are reported', v.badGuideTool.some(e => /hammer/.test(e)) && v.badGuideText.some(e => /needs text/.test(e)) && v.badGuideCond.some(e => /needs n/.test(e)), [v.badGuideTool, v.badGuideText, v.badGuideCond].map(a => a.join('/')).join(' | '));
    await page.close();

    console.log('2. a level without Portal or Gate loads');
    for (const view of ['2d', '3d']) {
      page = await open('level=lesson', view);
      const l = await page.evaluate(() => { const g = window.__game, G = g.G; return { portal: G.portal, gate: G.gate, gates: G.gates.length, waves: g.VAR.WAVES, wave: document.getElementById('hWave').textContent, next: document.getElementById('hNext').textContent,
        portalTiles: G.map.filter(t => t.t === g.T.PORTAL || t.t === g.T.GATE).length, objs: g.OBJECTIVES.length, three: !!window.__three }; });
      check(view + ': no Portal, no Gate, no waves', l.portal === null && l.gate === null && l.gates === 0 && l.waves === 0 && l.portalTiles === 0, JSON.stringify([l.portal, l.gate, l.waves]));
      check(view + ': the HUD shows no wave counter', l.wave === '—' && l.next === '—', l.wave + ' / ' + l.next);
      if (view === '3d') check('3d: the WebGL scene is up', l.three);
      await page.close();
    }

    console.log('3. playing "lesson" with the guide');
    page = await open('level=lesson');
    const run = (secs, until) => page.evaluate(([secs, until]) => { const g = window.__game, G = g.G; const f = until && new Function('g', 'G', 'return ' + until);
      for (let s = 0; s < secs && !G.over; s += 0.05) { g.step(0.05); if (f && f(g, G)) return true; } return !!(f && f(g, G)); }, [secs, until || null]);
    const info = () => page.evaluate(() => { const g = window.__game, G = g.G; return { step: G.guideStep, text: (g.guideNow() || {}).text || null, done: Object.keys(G.objDone).length, over: G.over, stats: { ...G.stats }, gold: Math.floor(G.gold) }; });
    let s = await info();
    check('starts at guide step 0, nothing done', s.step === 0 && s.done === 0 && /Welcome/.test(s.text));
    await page.click('#guideNext'); s = await info();
    check('"Got it" moves to the Dig step', s.step === 1 && /Dig \/ grab/.test(s.text));
    check('the Dig button pulses and the marker points east of the Heart', await page.evaluate(() => document.getElementById('b_dig').classList.contains('hint') && JSON.stringify(window.__ui.guideTarget()) === '{"x0":9,"y0":5,"x1":12,"y1":5}'));
    await page.evaluate(() => window.__game.tagRect(9, 5, 12, 5, true)); await run(120, 'G.stats.dug >= 4'); s = await info();
    check('digging 4 tiles advances the guide by itself', s.step === 2 && /gold seam/.test(s.text), 'step ' + s.step);
    check('the pulse moved on (still Dig for the seam)', await page.evaluate(() => document.getElementById('b_dig').classList.contains('hint')));
    await page.evaluate(() => window.__game.tagRect(13, 5, 13, 5, true)); await run(120, 'G.stats.dug >= 5 && G.stats.claimed >= 3'); s = await info();
    check('mined the seam and claimed floor: guide is at the Treasury step', s.step === 4 && /Treasury/.test(s.text) && s.stats.mined > 0 && s.done === 2, `step ${s.step} done ${s.done} stats ${JSON.stringify(s.stats)}`);
    await sleep(250);                                                          // the pulse is applied on the next frame
    check('the Treasury button pulses', await page.evaluate(() => document.getElementById('b_treasury').classList.contains('hint') && !document.getElementById('b_dig').classList.contains('hint')));
    await page.evaluate(() => { const g = window.__game; g.build(g.T.TREASURY, 2, 3, 3, 3); }); await run(1); s = await info();
    check('building the Treasury advances to the Lair step', s.step === 5 && /Lair/.test(s.text) && s.done === 3, `step ${s.step} done ${s.done}`);
    await page.evaluate(() => { const g = window.__game; g.build(g.T.LAIR, 2, 7, 3, 7); }); await run(1); s = await info();
    check('building the Lair leaves only the gold goal', s.step === 6 && s.done === 4 && s.over === null, `step ${s.step} done ${s.done} over ${s.over}`);
    await sleep(200);                                                          // the DOM is redrawn on the next frame
    const ticked = await page.evaluate(() => [...document.querySelectorAll('#objList li')].map(li => li.classList.contains('done')).join());
    check('the objectives panel shows 4 of 5 ticked', ticked === 'true,true,true,true,false', ticked);
    const won = await run(400, 'G.over === "victory"'); s = await info();
    check('banking 1500 gold wins the level by objectives alone', won && s.over === 'victory' && s.done === 5 && s.gold >= 1500, `gold ${s.gold} at ${await page.evaluate(() => Math.round(window.__game.G.time))}s`);
    await sleep(300);
    check('after victory the guide hides and every objective is ticked', await page.evaluate(() => getComputedStyle(document.getElementById('guide')).display === 'none' && ![...document.querySelectorAll('#objList li')].some(li => !li.classList.contains('done'))));
    check('the log announced the objectives', await page.evaluate(() => window.__game.G.log.filter(m => m.startsWith('✔')).length === 5));
    await page.close();

    console.log('4. the guide controls');
    page = await open('level=lesson');
    await page.click('#guideX'); await sleep(100);
    check('the ✕ button hides the guide', await page.evaluate(() => getComputedStyle(document.getElementById('guide')).display === 'none'));
    await page.close();
    page = await open('level=lesson&guide=0');
    check('?guide=0 turns the guide off', await page.evaluate(() => window.__game.GUIDE.length === 0 && window.__ui.guideTarget() === null && getComputedStyle(document.getElementById('guide')).display === 'none'));
    await page.close();

    console.log('5. the briefing');
    page = await open('level=lesson&brief=1');
    await page.evaluate(() => { window.__game.G.speed = 0; });
    let b = await page.evaluate(() => ({ shown: getComputedStyle(document.getElementById('briefing')).display, title: document.getElementById('briefTitle').textContent, goals: document.querySelectorAll('#briefGoals li').length, text: document.getElementById('briefText').textContent }));
    check('?brief=1 shows the briefing with title, text and the 5 goals', b.shown === 'flex' && b.title === 'First Steps' && b.goals === 5 && /Dungeon Heart/.test(b.text), JSON.stringify(b));
    await page.evaluate(() => { window.__game.G.speed = 1; window.__game.showBriefing(); });          // reopening it pauses again
    check('showBriefing pauses the game', await page.evaluate(() => window.__game.G.speed === 0));
    await page.click('#briefGo'); await sleep(100);
    check('"Begin" hides it and resumes at normal speed', await page.evaluate(() => getComputedStyle(document.getElementById('briefing')).display === 'none' && window.__game.G.speed === 1));
    await page.close();
    page = await open('level=lesson');
    check('without ?brief=1 there is no overlay', await page.evaluate(() => getComputedStyle(document.getElementById('briefing')).display === 'none'));
    await page.close();

    console.log('6. levels without objectives keep "beat every wave"');
    page = await open('level=tiny');
    const d = await page.evaluate(() => { const g = window.__game, G = g.G; return { n: g.OBJECTIVES.length, type: g.OBJECTIVES[0].type, panel: document.getElementById('objList').textContent, guide: g.GUIDE.length, shown: getComputedStyle(document.getElementById('guide')).display }; });
    check('one default objective: survive', d.n === 1 && d.type === 'survive' && /Defeat every wave/.test(d.panel), JSON.stringify(d));
    check('no guide on levels that have none', d.guide === 0 && d.shown === 'none');
    const t = await page.evaluate(() => { const g = window.__game, G = g.G; G.gateOpen = true; G.wave = g.VAR.WAVES; g.step(0.05); const early = G.over; G.heroes.length = 0; g.step(0.05); return { early, over: G.over }; });
    await page.close();
    check('victory needs all waves spawned and no heroes left', t.over === 'victory');
    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall objective checks passed'); process.exit(fails ? 1 : 0);
})();
