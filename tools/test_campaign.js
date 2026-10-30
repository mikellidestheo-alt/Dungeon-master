#!/usr/bin/env node
/* Headless checks for the chapter menu, saved progress, stars and the victory / defeat screens
 * (web/menu.html, web/progress.js, the end screen in web/game.js, docs/06-levels.md).
 *   node tools/test_campaign.js     (needs playwright with chromium)
 *   1. star rules and the save record: pure functions, storage blocked, corrupt data
 *   2. the campaign list names real levels; `stars` data is validated
 *   3. the chapter menu: locked / unlocked chapters, stars, best times, Begin, erase progress
 *   4. winning a chapter (3D view): the Victory screen, three stars, "First victory!", Next chapter, the save
 *   5. losing: the Defeat screen, no stars, Retry, the defeat is counted
 *   6. the last chapter has no Next button; ?nosave=1 saves nothing; the HUD's Chapters button leads to the menu
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8769, ROOT = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    await sleep(800);
    const problems = [];
    const fresh = async () => { const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } }); return ctx; };
    const watch = (page) => { page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); }); return page; };
    const open = async (ctx, url, wait = 400) => { const page = watch(await ctx.newPage()); await page.goto(ROOT + url, { waitUntil: 'load' }); await sleep(wait); return page; };
    const game = async (ctx, query, view = '2d') => { const page = await open(ctx, 'index.html?sound=0&view=' + view + '&' + query, view === '2d' ? 400 : 2500); await page.evaluate(() => { window.__game.G.speed = 0; }); return page; };
    const run = (page, secs, until) => page.evaluate(([secs, until]) => { const g = window.__game, G = g.G; const f = until && new Function('g', 'G', 'return ' + until);
      for (let s = 0; s < secs && !G.over; s += 0.05) { g.step(0.05); if (f && f(g, G)) return true; } return !!(f && f(g, G)); }, [secs, until || null]);

    console.log('1. star rules and saves');
    let ctx = await fresh(), page = await open(ctx, 'menu.html');
    const u = await page.evaluate(() => {
      const P = window.Progress, S = P.stars, out = {};
      out.plain = [S(null, { heart: 1, time: 50, bonusDone: 0, bonusTotal: 0 }).earned, S(null, { heart: 0.7, time: 50, bonusDone: 0, bonusTotal: 0 }).earned, S(null, { heart: 0.3, time: 50, bonusDone: 0, bonusTotal: 0 }).earned];
      out.heartRule = S({ heart: 0.8 }, { heart: 0.7, time: 1, bonusDone: 0, bonusTotal: 0 }).earned;
      out.bonus = [S(null, { heart: 0.6, time: 1, bonusDone: 2, bonusTotal: 2 }).earned, S(null, { heart: 0.6, time: 1, bonusDone: 1, bonusTotal: 2 }).earned];
      out.par = [S({ par: 100 }, { heart: 0.6, time: 90, bonusDone: 0, bonusTotal: 0 }).earned, S({ par: 100 }, { heart: 0.6, time: 120, bonusDone: 0, bonusTotal: 0 }).earned, S({ par: 100 }, { heart: 0.6, time: 90, bonusDone: 0, bonusTotal: 1 }).earned];
      out.text = S({ par: 125 }, { heart: 1, time: 1, bonusDone: 1, bonusTotal: 1 }).list[2].text;
      P.reset(); const order = ['a', 'b', 'c'];
      out.unlock0 = [P.unlocked(order, 'a'), P.unlocked(order, 'b')];
      const r1 = P.record('a', { outcome: 'victory', time: 100, kills: 4, heart: 0.9, stars: 2 });
      out.first = [r1.first, r1.newBest, P.unlocked(order, 'b'), P.unlocked(order, 'c')];
      const r2 = P.record('a', { outcome: 'victory', time: 120, kills: 3, heart: 0.5, stars: 1 });          // slower and fewer stars: not a best
      out.worse = [r2.first, r2.newBest, P.level('a').stars, P.level('a').bestTime, P.level('a').bestKills, P.level('a').wins];
      const r3 = P.record('a', { outcome: 'victory', time: 80, kills: 6, heart: 1, stars: 3 });
      out.better = [r3.newBest, P.level('a').stars, P.level('a').bestTime, P.level('a').bestKills, P.level('a').bestHeart];
      P.record('b', { outcome: 'defeat', time: 30, kills: 0, heart: 0 }); out.defeat = [P.level('b').defeats, P.level('b').wins, P.won('b'), P.unlocked(order, 'c')];
      out.total = P.totalStars(order); out.next = [P.next(order, 'a'), P.next(order, 'c')];
      out.stored = JSON.parse(localStorage.getItem(P.KEY)).v;
      localStorage.setItem(P.KEY, '{not json'); out.corrupt = P.level('a') === null || typeof P.level('a') === 'object';
      P.reset(); out.cleared = localStorage.getItem(P.KEY) === null && P.level('a') === null;
      return out;
    });
    check('stars: win = 1, Heart >= 50% = 2, Heart >= 90% = 3', u.plain.join() === '3,2,1', u.plain.join());
    check('stars: a level can raise the Heart rule', u.heartRule === 1, u.heartRule);
    check('stars: bonus objectives decide the third star', u.bonus.join() === '3,2', u.bonus.join());
    check('stars: a par time decides the third star (and bonuses still count)', u.par.join() === '3,2,2', u.par.join());
    check('star text says what is asked', u.text === 'Complete every bonus objective and win within 2:05', u.text);
    check('chapters unlock in order', u.unlock0.join() === 'true,false' && u.first.slice(2).join() === 'true,false', JSON.stringify([u.unlock0, u.first]));
    check('first victory is a new best; a slower, lesser run is not', u.first[0] === true && u.first[1] === true && u.worse[0] === false && u.worse[1] === false, JSON.stringify(u.worse));
    check('best stars, time and kills are kept per field', u.worse[2] === 2 && u.worse[3] === 100 && u.worse[4] === 4 && u.worse[5] === 2, JSON.stringify(u.worse));
    check('a better run improves them', u.better[0] && u.better[1] === 3 && u.better[2] === 80 && u.better[3] === 6 && u.better[4] === 1, JSON.stringify(u.better));
    check('a defeat is counted and does not unlock the next chapter', u.defeat.join() === '1,0,false,false', u.defeat.join());
    check('total stars and next chapter', u.total === 3 && u.next[0] === 'b' && u.next[1] === null, JSON.stringify([u.total, u.next]));
    check('saved as versioned JSON; corrupt data does not throw; reset clears', u.stored === 1 && u.corrupt && u.cleared);
    const blocked = await page.evaluate(() => {                                              // storage that throws on every call
      const P = window.Progress; const orig = Storage.prototype.setItem, og = Storage.prototype.getItem;
      Storage.prototype.setItem = () => { throw new Error('blocked'); }; Storage.prototype.getItem = () => { throw new Error('blocked'); };
      try { P.reset(); P.record('z', { outcome: 'victory', time: 5, kills: 1, heart: 1, stars: 3 }); return [P.won('z'), P.level('z').stars]; } catch (e) { return 'threw ' + e; } finally { Storage.prototype.setItem = orig; Storage.prototype.getItem = og; P.reset(); }
    });
    check('blocked storage: progress lives in memory, nothing throws', Array.isArray(blocked) && blocked[0] === true && blocked[1] === 3, JSON.stringify(blocked));
    await ctx.close();

    console.log('2. the campaign list and star data');
    ctx = await fresh(); page = await open(ctx, 'index.html?view=2d&sound=0&level=lesson');
    const c = await page.evaluate(() => { const g = window.__game, bad = (mut) => { const lv = JSON.parse(JSON.stringify(g.LEVEL_TABLE.lesson)); mut(lv); return g.validateLevel(lv); };
      return { campaign: g.CAMPAIGN.slice(), missing: g.CAMPAIGN.filter(id => !g.LEVEL_TABLE[id]), noText: g.CAMPAIGN.filter(id => !g.LEVEL_TABLE[id].name || !g.LEVEL_TABLE[id].tagline || !g.LEVEL_TABLE[id].briefing),
        invalid: g.CAMPAIGN.filter(id => g.validateLevel(g.LEVEL_TABLE[id]).length), okStars: bad(l => { l.stars = { heart: 0.6, par: 90 }; }), badHeart: bad(l => { l.stars = { heart: 2 }; }), badPar: bad(l => { l.stars = { par: -5 }; }) }; });
    check('every campaign chapter exists, validates and has a name, tagline and briefing', c.campaign.length >= 2 && !c.missing.length && !c.noText.length && !c.invalid.length, JSON.stringify(c));
    check('stars data is validated', c.okStars.length === 0 && c.badHeart.some(e => /stars.heart/.test(e)) && c.badPar.some(e => /stars.par/.test(e)), [c.okStars, c.badHeart, c.badPar].map(a => a.join('/')).join(' | '));
    await ctx.close();

    console.log('3. the chapter menu');
    ctx = await fresh(); page = await open(ctx, 'menu.html');
    const m = async () => page.evaluate(() => ({ chaps: [...document.querySelectorAll('.chap')].map(b => ({ id: b.dataset.id, locked: b.classList.contains('locked'), sel: b.classList.contains('sel'), stars: b.querySelectorAll('.st .on').length, tag: b.querySelector('.tg').textContent })),
      total: document.getElementById('total').textContent.replace(/\s+/g, ' '), title: document.querySelector('#detail h2').textContent, play: document.getElementById('play').textContent, best: document.querySelector('#detail .best').textContent.replace(/\s+/g, ' ').trim() }));
    let mm = await m();
    check('first run: chapter I open and selected, the rest locked', mm.chaps[0].id === 'lesson' && !mm.chaps[0].locked && mm.chaps[0].sel && mm.chaps.slice(1).every(x => x.locked), JSON.stringify(mm.chaps.map(x => [x.id, x.locked])));
    check('locked chapters say why; total is 0 stars', /Locked/.test(mm.chaps[1].tag) && /Stars 0 \/ 6/.test(mm.total), mm.chaps[1].tag + ' | ' + mm.total);
    check('detail shows the chapter and "Begin chapter"', mm.title === 'First Steps' && mm.play === 'Begin chapter' && /Not yet attempted/.test(mm.best), mm.title + ' / ' + mm.play);
    await page.click('.chap[data-id="classic"]', { force: true }); mm = await m();
    check('clicking a locked chapter does nothing', mm.chaps[0].sel && !mm.chaps[1].sel);
    await page.evaluate(() => Progress.record('lesson', { outcome: 'victory', time: 83, kills: 0, heart: 1, stars: 3 })); await page.reload({ waitUntil: 'load' }); await sleep(300); mm = await m();
    check('after a win the next chapter opens and is selected; chapter I shows 3 stars', !mm.chaps[1].locked && mm.chaps[1].sel && mm.chaps[0].stars === 3 && /Stars 3 \/ 6/.test(mm.total), JSON.stringify(mm.chaps.map(x => [x.id, x.locked, x.sel, x.stars])));
    await page.click('.chap[data-id="lesson"]'); mm = await m();
    check('chapter I details: best time 1:23, 1 victory, "Play again"', /1:23/.test(mm.best) && /1 victory/.test(mm.best) && mm.play === 'Play again', mm.best + ' / ' + mm.play);
    await Promise.all([page.waitForURL(/index\.html\?level=lesson&brief=1/), page.click('#play')]);
    check('Play opens the chapter with its briefing', /level=lesson&brief=1/.test(page.url()), page.url());
    await sleep(500);
    check('...and the briefing card is up, game paused', await page.evaluate(() => getComputedStyle(document.getElementById('briefing')).display === 'flex' && window.__game.G.speed === 0));
    await page.goto(ROOT + 'menu.html', { waitUntil: 'load' }); await sleep(200);
    page.once('dialog', d => d.accept()); await page.click('#reset'); await sleep(200); mm = await m();
    check('"Erase saved progress" resets everything', mm.chaps[1].locked && /Stars 0/.test(mm.total) && await page.evaluate(() => localStorage.getItem('dm.save.v1') === null));
    await page.goto(ROOT + 'menu.html?unlock=all', { waitUntil: 'load' }); await sleep(200); mm = await m();
    check('?unlock=all opens every chapter (testing)', mm.chaps.every(x => !x.locked));
    await ctx.close();

    console.log('4. winning a chapter');
    ctx = await fresh(); page = await game(ctx, 'level=lesson&brief=0', '3d');
    check('no end screen while playing', await page.evaluate(() => getComputedStyle(document.getElementById('endscreen')).display === 'none'));
    await page.evaluate(() => { const g = window.__game; g.tagRect(9, 5, 13, 5, true); });
    await run(page, 60, 'G.stats.claimed >= 3 && G.stats.dug >= 5'); await page.evaluate(() => { const g = window.__game; g.build(g.T.TREASURY, 2, 3, 3, 3); g.build(g.T.LAIR, 2, 7, 3, 7); });
    const won = await run(page, 400, 'G.over === "victory"'); await sleep(900);
    const e = await page.evaluate(() => ({ title: document.getElementById('endTitle').textContent, cls: document.getElementById('endTitle').className, shown: getComputedStyle(document.getElementById('endscreen')).display, stats: document.getElementById('endStats').textContent.replace(/\s+/g, ' '),
      stars: [...document.querySelectorAll('#endStars li')].map(li => [li.classList.contains('got'), li.textContent]), best: document.getElementById('endBest').textContent, next: getComputedStyle(document.getElementById('endNext')).display, result: window.__game.G.result,
      saved: JSON.parse(localStorage.getItem('dm.save.v1')) }));
    check('the level is won', won);
    check('Victory screen with time, kills and Heart', e.shown === 'flex' && e.title === 'Victory' && e.cls === 'win' && /Time \d:\d\d/.test(e.stats) && /Heart 100%/.test(e.stats), e.stats);
    check('three stars: win, Heart >= 50%, Heart >= 90%', e.stars.length === 3 && e.stars.every(s => s[0]) && /Heart at 90%/.test(e.stars[2][1]), JSON.stringify(e.stars));
    check('"First victory!" is announced', e.best === 'First victory!', e.best);
    check('Next chapter button is offered', e.next !== 'none');
    check('the result is saved: 3 stars, 1 win, best time', e.saved.levels.lesson && e.saved.levels.lesson.stars === 3 && e.saved.levels.lesson.wins === 1 && e.saved.levels.lesson.bestTime === e.result.time, JSON.stringify(e.saved.levels.lesson));
    await page.screenshot({ path: process.env.SHOT || '/dev/null', fullPage: true }).catch(() => {});
    await Promise.all([page.waitForURL(/level=classic&brief=1/), page.click('#endNext')]);
    check('Next chapter opens the next chapter (with its briefing)', /index\.html\?level=classic&brief=1/.test(page.url()), page.url());
    await ctx.close();

    console.log('5. losing');
    ctx = await fresh(); page = await game(ctx, 'level=classic');
    await page.evaluate(() => { const g = window.__game; g.hurt({ heart: true, dead: false, x: g.G.heart.x, y: g.G.heart.y }, 99999, {}); }); await sleep(900);      // a hero hits the Heart
    const d = await page.evaluate(() => ({ title: document.getElementById('endTitle').textContent, cls: document.getElementById('endTitle').className, line: document.getElementById('endLine').textContent, stars: document.querySelectorAll('#endStars li').length,
      best: document.getElementById('endBest').textContent, next: getComputedStyle(document.getElementById('endNext')).display, retry: getComputedStyle(document.getElementById('endRetry')).display, over: window.__game.G.over, saved: JSON.parse(localStorage.getItem('dm.save.v1')), focus: document.activeElement.id }));
    check('Defeat screen: no stars, no "new best", no Next', d.title === 'Defeat' && d.cls === 'lose' && d.stars === 0 && d.best === '' && d.next === 'none' && d.over === 'defeat', JSON.stringify([d.title, d.stars, d.best, d.next]));
    check('Retry is focused so Enter restarts', d.retry !== 'none' && d.focus === 'endRetry', d.focus);
    check('the defeat is counted', d.saved.levels.classic.defeats === 1 && d.saved.levels.classic.wins === 0, JSON.stringify(d.saved.levels.classic));
    await Promise.all([page.waitForURL(/level=classic&brief=1/), page.click('#endRetry')]);
    check('Retry reloads the chapter with its briefing', /level=classic&brief=1/.test(page.url()), page.url());
    await ctx.close();

    console.log('6. last chapter, ?nosave=1, the Chapters button');
    ctx = await fresh(); page = await game(ctx, 'level=classic');
    await page.evaluate(() => { const g = window.__game, G = g.G; G.gateOpen = true; G.wave = g.VAR.WAVES; g.step(0.05); }); await sleep(900);
    const l = await page.evaluate(() => ({ title: document.getElementById('endTitle').textContent, next: getComputedStyle(document.getElementById('endNext')).display, stars: document.querySelectorAll('#endStars li.got').length }));
    check('winning the last chapter shows no Next button', l.title === 'Victory' && l.next === 'none' && l.stars === 3, JSON.stringify(l));
    await Promise.all([page.waitForURL(/menu\.html/), page.click('#endMenu')]);
    check('the Chapters button on the end screen leads to the menu', /menu\.html$/.test(page.url()));
    await ctx.close();
    ctx = await fresh(); page = await game(ctx, 'level=classic&nosave=1');
    await page.evaluate(() => { const g = window.__game, G = g.G; G.gateOpen = true; G.wave = g.VAR.WAVES; g.step(0.05); }); await sleep(600);
    const ns = await page.evaluate(() => [window.__game.G.over, localStorage.getItem('dm.save.v1'), document.getElementById('endBest').textContent]);
    check('?nosave=1: victory is shown but nothing is saved', ns[0] === 'victory' && ns[1] === null && ns[2] === '', JSON.stringify(ns));
    await ctx.close();
    ctx = await fresh(); page = await game(ctx, 'level=lesson');
    await Promise.all([page.waitForURL(/menu\.html/), page.click('#bMenu')]);
    check('the HUD\'s Chapters button leads to the menu', /menu\.html$/.test(page.url()));
    await ctx.close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall campaign checks passed'); process.exit(fails ? 1 : 0);
})();
