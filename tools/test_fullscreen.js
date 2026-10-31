#!/usr/bin/env node
/* Headless checks for full screen and edge scrolling (web/index.html "Full screen", web/render3d.js "Edge scrolling").
 *   node tools/test_fullscreen.js     (needs playwright with chromium; headless Chromium really does enter full screen)
 *   1. the Full screen button and the F key: the map fills the screen, the bars float over it, nothing overlaps, and leaving restores the page
 *   2. the Panels drawer (button and P key): Task board, Log and Research are still usable
 *   3. the choice is remembered, and Begin on a briefing goes back to full screen
 *   4. the game works in full screen: a real mouse drag tags tiles; the flat 2D view keeps its proportions
 *   5. edge scrolling in the window: each of the four edges pans, with a short delay, faster nearer the edge; not over panels; ?edge=0 and leaving switch it off
 *   6. edge scrolling in full screen: the screen's edge, even under the bars
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8775, ROOT = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    await sleep(800);
    const problems = [];
    const open = async (query, w = 1500, h = 1000) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } }), page = await ctx.newPage();
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GL Driver Message|willReadFrequently/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });
      await page.goto(ROOT + 'index.html?sound=0&' + query, { waitUntil: 'load' }); await sleep(/view=2d/.test(query) ? 500 : 2500); await page.evaluate(() => { window.__game.G.speed = 0; }); return page;
    };
    const rect = (page, sel) => page.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; }, sel);
    const state = (page) => page.evaluate(() => ({ full: !!document.fullscreenElement, fs: document.documentElement.classList.contains('fs'), panels: document.documentElement.classList.contains('panels'), btn: document.getElementById('bFull').textContent, pbtn: document.getElementById('bPanels').textContent, pref: localStorage.getItem('dm.fs') }));

    console.log('1. the Full screen button');
    let page = await open('level=tutorial', 1920, 1080);
    const win0 = { stage: await rect(page, '#stage'), hud: await rect(page, '#hud'), btnDisplay: await page.evaluate(() => getComputedStyle(document.getElementById('bFull')).display), pbtn: await page.evaluate(() => getComputedStyle(document.getElementById('bPanels')).display) };
    check('the HUD has a Full screen button (and Panels is hidden until you are in full screen)', win0.btnDisplay !== 'none' && win0.pbtn === 'none' && /Full screen/.test((await state(page)).btn));
    check('in the window the map is still in the picture frame', win0.stage.w < 1920 && win0.stage.t > 300 && win0.hud.t > 60, JSON.stringify(win0.stage));
    await page.click('#bFull'); await sleep(900);
    let s = await state(page);
    check('clicking it enters real full screen, and the button now offers to leave', s.full && s.fs && /Exit full screen/.test(s.btn), JSON.stringify(s));
    const L = { stage: await rect(page, '#stage'), hud: await rect(page, '#hud'), tools: await rect(page, '#tools'), obj: await rect(page, '#objPanel'), guide: await rect(page, '#guide'), side: await page.evaluate(() => getComputedStyle(document.getElementById('side')).display),
      three: await page.evaluate(() => { const c = [...document.querySelectorAll('#stage canvas')].find(c => c.id !== 'cv'); const b = c.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), pw: c.width, ph: c.height }; }), win: await page.evaluate(() => [innerWidth, innerHeight]), scroll: await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]) };
    check('the map fills the screen (1920 x 1080), and the 3D canvas with it', L.stage.l === 0 && L.stage.t === 0 && L.stage.w === L.win[0] && L.stage.h === L.win[1] && L.three.w === L.win[0] && L.three.h === L.win[1], JSON.stringify([L.stage, L.three]));
    check('the page does not scroll', L.scroll[0] <= L.win[0] && L.scroll[1] <= L.win[1], JSON.stringify(L.scroll));
    check('the numbers bar floats at the top and the toolbar at the bottom, full width', L.hud.t === 0 && L.hud.w === L.win[0] && L.tools.b === L.win[1] && L.tools.w === L.win[0] && L.hud.h < 120 && L.tools.h < 160, JSON.stringify([L.hud, L.tools]));
    check('the objectives sit below the top bar and the hint banner above the toolbar (nothing overlaps)', L.obj.t >= L.hud.b && L.guide.b <= L.tools.t, JSON.stringify([L.obj.t, L.hud.b, L.guide.b, L.tools.t]));
    check('the panels are tucked away until asked for', L.side === 'none');
    check('every toolbar button is on screen and inside the bar', await page.evaluate(() => [...document.querySelectorAll('#tools button')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0; })));
    await page.keyboard.press('f'); await sleep(900); s = await state(page);
    check('the F key leaves full screen and the page is put back (same stage as before)', !s.full && !s.fs && /Full screen/.test(s.btn) && JSON.stringify(await rect(page, '#stage')) === JSON.stringify(win0.stage), JSON.stringify(await rect(page, '#stage')));
    await page.keyboard.press('f'); await sleep(900); s = await state(page);
    check('the F key enters it again', s.full && s.fs);

    console.log('2. the Panels drawer');
    await page.click('#bPanels'); await sleep(400); s = await state(page);
    const D = { side: await rect(page, '#side'), boxes: await page.evaluate(() => ['boxTask', 'boxLog', 'boxResearch'].map(id => { const b = document.getElementById(id).getBoundingClientRect(); return { id, vis: b.width > 100 && b.height > 30, r: Math.round(b.right) }; })), hud: await rect(page, '#hud'), tools: await rect(page, '#tools') };
    check('the Panels button opens a drawer on the right with the Task board, Log and Research', s.panels && /Hide panels/.test(s.pbtn) && D.boxes.every(b => b.vis) && D.side.r === 1920, JSON.stringify(D.boxes));
    check('the drawer clears the top bar and the toolbar', D.side.t >= D.hud.b - 1 && D.side.b <= D.tools.t + 1, JSON.stringify([D.side, D.hud.b, D.tools.t]));
    check('the Research panel can still be used (click an item to choose what to study)', await (async () => { await page.click('#research .ritem[data-id="heal"]'); return page.evaluate(() => __game.G.research.current === 'heal'); })());
    check('the log and the task board show live text', await page.evaluate(() => document.getElementById('log').textContent.length > 10 && document.getElementById('tasks').textContent.length > 20));
    await page.keyboard.press('p'); await sleep(300); s = await state(page);
    check('the P key closes the drawer', !s.panels && (await page.evaluate(() => getComputedStyle(document.getElementById('side')).display)) === 'none');

    console.log('3. remembered');
    s = await state(page); check('full screen is remembered (dm.fs = 1)', s.pref === '1', s.pref);
    await page.keyboard.press('f'); await sleep(900); s = await state(page); check('leaving forgets it (dm.fs = 0)', s.pref === '0', s.pref);
    await page.keyboard.press('f'); await sleep(900);
    await page.goto(ROOT + 'index.html?sound=0&level=tutorial&brief=1', { waitUntil: 'load' }); await sleep(2500);
    s = await state(page);
    check('a new page does not start in full screen (browsers do not allow it without a click)', !s.full && s.pref === '1', JSON.stringify([s.full, s.pref]));
    await page.click('#briefGo'); await sleep(1200); s = await state(page);
    check('pressing Begin on the briefing goes back to full screen', s.full && s.fs);
    await page.context().close();

    console.log('4. playing in full screen');
    page = await open('level=tutorial', 1920, 1080); await page.keyboard.press('f'); await sleep(900);
    await page.click('#b_dig'); const before = await page.evaluate(() => __game.G.map.filter(t => t.tag).length);
    await page.mouse.move(960, 560); await page.mouse.down(); await page.mouse.move(1010, 560, { steps: 5 }); await page.mouse.up(); await sleep(300);
    const mt = await page.evaluate(() => ({ tagged: __game.G.map.filter(t => t.tag).length, mouse: [__ui.mouse.x, __ui.mouse.y] }));
    check('a real mouse drag across the screen tags earth (clicks land where they should)', mt.tagged > before, JSON.stringify([before, mt.tagged, mt.mouse]));
    await page.context().close();
    page = await open('level=tutorial&view=2d', 1920, 1080); await page.keyboard.press('f'); await sleep(900);
    const c2 = await page.evaluate(() => { const c = document.getElementById('cv'), b = c.getBoundingClientRect(); return { w: b.width, h: b.height, ratio: (b.width / b.height) / (c.width / c.height), l: b.left, r: innerWidth - b.right, t: b.top, bt: innerHeight - b.bottom }; });
    check('the flat 2D view keeps its proportions, is as large as it can be and is centred', Math.abs(c2.ratio - 1) < 0.01 && Math.abs(c2.l - c2.r) < 2 && Math.abs(c2.t - c2.bt) < 2 && (c2.h >= 1079 || c2.w >= 1919), JSON.stringify(c2));
    await page.keyboard.press('f'); await sleep(900);
    check('...and goes back to normal afterwards', await page.evaluate(() => { const c = document.getElementById('cv'); return c.style.width === '' && c.style.position === ''; }));
    await page.context().close();

    console.log('5. edge scrolling in the window');
    page = await open('level=tutorial', 1500, 1300);                 // tall enough that the whole framed map is on screen
    const cam = () => page.evaluate(() => ({ x: __three.cam.x, z: __three.cam.z, yaw: __three.cam.yaw }));
    const reset = () => page.evaluate(() => { __three.cam.x = 15; __three.cam.z = 8; });
    const axes = (c0, c1) => { const dx = c1.x - c0.x, dz = c1.z - c0.z, r = [Math.cos(c0.yaw), -Math.sin(c0.yaw)], u = [-Math.sin(c0.yaw), -Math.cos(c0.yaw)]; return { right: dx * r[0] + dz * r[1], up: dx * u[0] + dz * u[1] }; };
    const cv = await page.evaluate(() => { const c = [...document.querySelectorAll('#stage canvas')].find(c => c.id !== 'cv'), b = c.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; });
    const cx = cv.l + cv.w / 2, cy = cv.t + cv.h * 0.62;
    const hold = async (x, y, ms = 650) => { await reset(); await page.mouse.move(cx, cy); await sleep(150); const c0 = await cam(); await page.mouse.move(x, y); await sleep(ms); const c1 = await cam(); await page.mouse.move(cx, cy); await sleep(100); return axes(c0, c1); };
    const left = await hold(cv.l + 4, cy), right = await hold(cv.r - 4, cy), top = await hold(cx, cv.t + 4), bottom = await hold(cx, cv.b - 4);
    check('the left edge of the map pans left', left.right < -1 && Math.abs(left.up) < Math.abs(left.right) * 0.4, JSON.stringify(left));
    check('the right edge pans right', right.right > 1 && Math.abs(right.up) < Math.abs(right.right) * 0.4, JSON.stringify(right));
    check('the top edge pans up the map', top.up > 1 && Math.abs(top.right) < Math.abs(top.up) * 0.4, JSON.stringify(top));
    check('the bottom edge pans down the map', bottom.up < -1 && Math.abs(bottom.right) < Math.abs(bottom.up) * 0.4, JSON.stringify(bottom));
    const mid = await hold(cx + 30, cy - 20, 500); check('the middle of the map does not move it', Math.abs(mid.right) < 0.05 && Math.abs(mid.up) < 0.05, JSON.stringify(mid));
    const quick = await (async () => { await reset(); await page.mouse.move(cx, cy); await sleep(150); const c0 = await cam(); await page.mouse.move(cv.l + 4, cy); await sleep(90); await page.mouse.move(cx, cy); await sleep(300); return axes(c0, await cam()); })();
    check('brushing past the edge does nothing (a short delay first)', Math.abs(quick.right) < 0.3 && Math.abs(quick.up) < 0.3, JSON.stringify(quick));
    const near = await hold(cv.l + 2, cy, 560), far = await hold(cv.l + 20, cy, 560);
    check('the nearer the edge, the faster (2 px beats 20 px)', Math.abs(near.right) > Math.abs(far.right) * 1.2 && Math.abs(far.right) > 0.5, `${near.right.toFixed(2)} vs ${far.right.toFixed(2)}`);
    await page.context().close();
    page = await open('level=tutorial&brief=1', 1500, 1300);
    const under = await (async () => { const c = await page.evaluate(() => { const c = [...document.querySelectorAll('#stage canvas')].find(c => c.id !== 'cv'), b = c.getBoundingClientRect(); return { l: b.left, y: b.top + b.height * 0.62, x: b.left + b.width / 2 }; });
      await page.evaluate(() => { __three.cam.x = 15; __three.cam.z = 8; }); await page.mouse.move(c.x, c.y); await sleep(150); const c0 = await cam(); await page.mouse.move(c.l + 4, c.y); await sleep(700); return axes(c0, await cam()); })();
    check('under the briefing card (anything solid on top of the map) the edge does not scroll', Math.abs(under.right) < 0.05 && Math.abs(under.up) < 0.05, JSON.stringify(under));
    await page.context().close();
    page = await open('level=tutorial', 1500, 1300);
    const gone = await (async () => { await reset(); await page.mouse.move(cx, cy); await page.mouse.move(cv.l + 4, cy); await sleep(150); const c0 = await cam(); await page.evaluate(() => document.documentElement.dispatchEvent(new Event('mouseleave'))); await sleep(500); return axes(c0, await cam()); })();
    check('when the mouse leaves the page the camera stops', Math.abs(gone.right) < 0.5, JSON.stringify(gone));
    const keyP = await (async () => { await reset(); await page.mouse.move(cx, cy); await sleep(100); const c0 = await cam(); await page.keyboard.down('d'); await sleep(400); await page.keyboard.up('d'); return axes(c0, await cam()); })();
    check('the W A S D keys still work', keyP.right > 1, JSON.stringify(keyP));
    await page.context().close();
    page = await open('level=tutorial&edge=0', 1500, 1000);
    const off = await (async () => { await page.evaluate(() => { __three.cam.x = 15; __three.cam.z = 8; }); const c = await page.evaluate(() => { const c = [...document.querySelectorAll('#stage canvas')].find(c => c.id !== 'cv'), b = c.getBoundingClientRect(); return { l: b.left, y: b.top + b.height / 2 }; }); await page.mouse.move(c.l + 200, c.y); await sleep(100); const c0 = await cam(); await page.mouse.move(c.l + 3, c.y); await sleep(700); return axes(c0, await cam()); })();
    check('?edge=0 turns edge scrolling off', Math.abs(off.right) < 0.05, JSON.stringify(off));
    await page.context().close();

    console.log('6. edge scrolling in full screen');
    page = await open('level=tutorial', 1600, 900); await page.keyboard.press('f'); await sleep(1000);
    const W = 1600, Hh = 900, fx = W / 2, fy = Hh / 2;
    const holdF = async (x, y, ms = 650) => { await page.evaluate(() => { __three.cam.x = 15; __three.cam.z = 8; }); await page.mouse.move(fx, fy); await sleep(150); const c0 = await cam(); await page.mouse.move(x, y); await sleep(ms); const c1 = await cam(); await page.mouse.move(fx, fy); await sleep(100); return axes(c0, c1); };
    const fl = await holdF(2, fy), fr = await holdF(W - 3, fy), ft = await holdF(fx, 2), fb = await holdF(fx, Hh - 3);
    check('the left and right edges of the screen pan', fl.right < -1 && fr.right > 1, `${fl.right.toFixed(2)} / ${fr.right.toFixed(2)}`);
    check('the top edge pans up even though the numbers bar is there, and the bottom edge pans down under the toolbar', ft.up > 1 && fb.up < -1, `${ft.up.toFixed(2)} / ${fb.up.toFixed(2)}`);
    const bar = await holdF(fx, 34, 500); check('the buttons themselves are not an edge (the bar below the first few pixels)', Math.abs(bar.right) < 0.05 && Math.abs(bar.up) < 0.05, JSON.stringify(bar));
    await page.context().close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall full-screen checks passed'); process.exit(fails ? 1 : 0);
})();
