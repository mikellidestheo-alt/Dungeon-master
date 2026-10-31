#!/usr/bin/env node
/* Headless checks for the default mouse mode and right-click (web/game.js inputDown / inputUp, "Dig / grab").
 *   node tools/test_input.js     (needs playwright with chromium)
 *   1. right-click cancels the tool in hand (Treasury, a spell, a door, a trap, the Hand) and returns to Dig / grab; Esc does the same; nothing is built, cast, sold or untagged by it
 *   2. in the default mode left-drag over walls tags them and right-drag untags a box (real mouse events)
 *   3. a left-click on a creature or imp picks it up and the next left-click puts it down; into rock is refused; a press on a creature that turns into a drag tags instead
 *   4. right-click while carrying puts it down on the nearest open floor under the cursor (or back where it was lifted) and returns to the default
 *   5. doors and traps sell in the default mode, by right-click and by right-drag, for half the price
 *   6. the hover cue: a ring under the creature the cursor could pick up (3D) and the same in the shared state (2D); none while carrying or with another tool
 *   7. the Hand and the roster's grab still work; the label and the cursor class
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8783, ROOT = `http://localhost:${PORT}/`;
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
      const page = await (await browser.newContext({ viewport: { width: 1500, height: 1300 } })).newPage();
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GL Driver Message|willReadFrequently/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });
      await page.goto(ROOT + 'index.html?sound=0&nosave=1&guide=0&view=' + view + '&' + query, { waitUntil: 'load' }); await sleep(view === '2d' ? 400 : 2500);
      await page.evaluate(() => { const g = __game; g.G.speed = 0; g.unlockAll(); g.G.gold = 5000; g.G.mana = 1000; }); return page;
    };
    // screen position of a tile / point on the 2D canvas, for real mouse events
    const at = (page, fx, fy) => page.evaluate(([fx, fy]) => { const r = document.getElementById('cv').getBoundingClientRect(); return { x: r.left + fx / __game.W * r.width, y: r.top + fy / __game.H * r.height }; }, [fx, fy]);
    const click = async (page, fx, fy, button = 'left') => { const p = await at(page, fx, fy); await page.mouse.move(p.x, p.y); await page.mouse.down({ button }); await page.mouse.up({ button }); };
    const drag = async (page, a, b, button = 'left') => { const p = await at(page, a[0], a[1]), q = await at(page, b[0], b[1]); await page.mouse.move(p.x, p.y); await page.mouse.down({ button }); await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2); await page.mouse.move(q.x, q.y); await page.mouse.up({ button }); };
    const tool = (page) => page.evaluate(() => __ui.tool);
    const pick = async (page, id) => { await page.evaluate((id) => { const t = __game.TAB_OF[id]; if (t) __game.setTab(t, true); document.getElementById('b_' + id).click(); }, id); };

    console.log('1. right-click cancels the tool');
    let page = await open('level=classic&seed=7');
    check('the default mode is the Dig tool, labelled "Dig / grab" and lit', await page.evaluate(() => __ui.tool === 'dig' && /Dig \/ grab/.test(document.getElementById('b_dig').textContent) && document.getElementById('b_dig').classList.contains('on')));
    const before = await page.evaluate(() => { const G = __game.G; G.creatures.length = 0; return { gold: G.gold, mana: G.mana, doors: G.doors.length, traps: G.traps.length, tags: G.map.filter(t => t.tag).length }; });
    for (const id of ['treasury', 'lair', 'library', 'door', 'gas', 'lightning', 'imp', 'hand']) {
      await pick(page, id); const was = await tool(page); await click(page, 8.5, 14.5, 'right'); const now = await page.evaluate(() => ({ tool: __ui.tool, on: document.getElementById('b_dig').classList.contains('on'), g: __game.G.gold, m: __game.G.mana, d: __game.G.doors.length, t: __game.G.traps.length, tags: __game.G.map.filter(t => t.tag).length }));
      check('right-click with ' + id + ' chosen returns to Dig / grab and changes nothing', was === id && now.tool === 'dig' && now.on && now.g === before.gold && now.m <= 1000 && now.d === before.doors && now.t === before.traps && now.tags === before.tags, JSON.stringify([was, now]));
    }
    await pick(page, 'treasury'); await page.keyboard.press('Escape');
    check('Esc with a tab open closes the tab first and keeps the tool', await page.evaluate(() => !document.getElementById('tab_build').classList.contains('open') && __ui.tool === 'treasury'));
    await page.keyboard.press('Escape'); check('...and a second Esc (no tab left to close) returns to Dig / grab', (await tool(page)) === 'dig');
    check('left-click with the Treasury chosen still builds (the tool is not broken)', await (async () => { await pick(page, 'treasury'); const n0 = await page.evaluate(() => __game.G.map.filter(t => t.t === __game.T.TREASURY).length); await click(page, 9.5, 12.5); const n1 = await page.evaluate(() => __game.G.map.filter(t => t.t === __game.T.TREASURY).length); await click(page, 9.5, 12.5, 'right'); return n1 === n0 + 1 && (await tool(page)) === 'dig'; })());
    await page.close();

    console.log('2. tagging and untagging in the default mode');
    page = await open('level=classic&seed=7');
    const earth = await page.evaluate(() => { const g = __game, G = g.G; for (let y = 2; y < g.H - 5; y++) for (let x = 12; x < g.W - 5; x++) { let ok = true; for (let j = 0; j < 4 && ok; j++) for (let i = 0; i < 4 && ok; i++) ok = G.map[(y + j) * g.W + x + i].t === g.T.EARTH && !G.map[(y + j) * g.W + x + i].tag; if (ok) return { x, y }; } return null; });
    const E = (i, j) => [earth.x + i + .5, earth.y + j + .5];
    const nTag = () => page.evaluate(() => __game.G.map.filter(t => t.tag).length);
    const t0 = await nTag();
    await drag(page, E(0, 0), E(2, 2));
    check('left-drag over walls tags the box (3 x 3)', (await nTag()) === t0 + 9 && (await tool(page)) === 'dig', 'tagged ' + ((await nTag()) - t0));
    await drag(page, E(0, 0), E(2, 2), 'right');
    check('right-drag over the box untags it', (await nTag()) === t0);
    await click(page, ...E(3, 3)); check('a single left-click on a wall tags that tile', (await nTag()) === t0 + 1);
    await click(page, ...E(3, 3), 'right'); check('a single right-click on a tagged wall untags it (the default mode)', (await nTag()) === t0);
    await page.close();

    console.log('3. pick up and put down');
    page = await open('level=classic&seed=7');
    await page.evaluate(() => { const g = __game, G = g.G; G.creatures.length = 0; const c = new g.Creature(9, 12, g.KINDS[1]); c.noLair = true; c.noFood = true; G.creatures.push(c); window.__c = c; });
    const cx = await page.evaluate(() => ({ x: __c.x, y: __c.y }));
    await click(page, cx.x, cx.y);
    let st = await page.evaluate(() => ({ held: !!__game.G.held && __game.G.held.name, tool: __ui.tool, fist: document.documentElement.classList.contains('holding'), tags: __game.G.map.filter(t => t.tag).length }));
    check('a left-click on a creature picks it up with no tool chosen: the tool stays Dig / grab, the cursor is the fist, no tile was tagged', st.held === 'Troll' && st.tool === 'dig' && st.fist && st.tags === 4, JSON.stringify(st));
    await click(page, 4.5, 12.5);
    st = await page.evaluate(() => ({ held: __game.G.held, x: __c.x, y: __c.y, fist: document.documentElement.classList.contains('holding'), st: __c.state }));
    check('the next left-click puts it down where you click, and the fist opens', st.held === null && Math.abs(st.x - 4.5) < 0.6 && Math.abs(st.y - 12.5) < 0.6 && !st.fist, JSON.stringify(st));
    await click(page, 4.5, 12.5);
    await click(page, 20.5, 8.5);                                                              // into the rock
    st = await page.evaluate(() => ({ held: !!__game.G.held, log: __game.G.log[0] }));
    check('putting it down into solid rock is refused and it stays in the hand', st.held && /solid rock/.test(st.log), JSON.stringify(st));
    await click(page, 6.5, 17.5);
    check('...and a click on floor then drops it', await page.evaluate(() => !__game.G.held && __c.y > 16));
    // an imp is picked up the same way
    await page.evaluate(() => { const i = __game.G.imps[0]; i.x = 3.5; i.y = 12.5; i.path = null; i.state = 'idle'; i.think = 99; window.__i = i; });
    await click(page, 3.5, 12.5); check('a click on an imp picks the imp up', await page.evaluate(() => !!__game.G.held && __game.G.held.isImp));
    await click(page, 3.5, 16.5);
    // a press that becomes a drag tags instead of picking up
    await page.evaluate(() => { __c.x = 10.5; __c.y = 14.5; __c.path = null; __c.wait = 99; });
    const e3 = await page.evaluate(() => { const g = __game, G = g.G; for (let x = 12; x < g.W - 4; x++) for (let y = 12; y < 17; y++) if ([0, 1, 2].every(i => G.map[y * g.W + x + i].t === g.T.EARTH)) return { x, y }; return null; });
    await drag(page, [10.5, 14.5], [e3.x + 2.5, e3.y + .5]);
    st = await page.evaluate(() => ({ held: !!__game.G.held, tags: __game.G.map.filter(t => t.tag).length }));
    check('pressing on a creature and dragging to walls tags the box and carries nothing', !st.held && st.tags > 4, JSON.stringify(st));
    // a creature near a wall wins over the wall when you just click
    await page.evaluate(() => { __game.tagRect(0, 0, 40, 28, false); __c.x = 10.5; __c.y = 14.2; __c.path = null; __c.wait = 99; });
    await click(page, 11.5, 14.5);
    check('a plain click that is both near a creature and on a wall picks the creature (it is preferred)', await page.evaluate(() => !!__game.G.held && __game.G.held === __c && __game.G.map.filter(t => t.tag).length === 0));
    await page.close();

    console.log('4. right-click while carrying');
    page = await open('level=classic&seed=7');
    await page.evaluate(() => { const g = __game, G = g.G; G.creatures.length = 0; const c = new g.Creature(9, 12, g.KINDS[1]); c.noLair = true; c.noFood = true; G.creatures.push(c); window.__c = c; });
    await click(page, 9.5, 12.5);
    await click(page, 12.5, 12.5, 'right');                                                    // over rock, right next to the cavern: nearest open floor
    st = await page.evaluate(() => ({ held: !!__game.G.held, x: __c.x, y: __c.y, tool: __ui.tool, open: !__game.TERRAIN[__game.G.map[Math.floor(__c.y) * __game.W + Math.floor(__c.x)].t].solid }));
    check('over rock beside the cavern: the creature lands on the nearest open floor and the tool is the default', !st.held && st.open && st.x < 11.2 && st.x > 8, JSON.stringify(st));
    await click(page, st.x, st.y);                                                              // pick it up again
    check('(it can be picked up again right away)', await page.evaluate(() => __game.G.held === __c));
    await page.evaluate(() => { __c.lift = { x: 9.5, y: 12.5 }; });
    await click(page, 24.5, 4.5, 'right');                                                      // deep in the earth, no floor within 4 tiles
    st = await page.evaluate(() => ({ held: !!__game.G.held, x: __c.x, y: __c.y, tool: __ui.tool }));
    check('no floor near the cursor: back where it was lifted', !st.held && Math.abs(st.x - 9.5) < 0.01 && Math.abs(st.y - 12.5) < 0.01 && st.tool === 'dig', JSON.stringify(st));
    await click(page, 9.5, 12.5); await pick(page, 'hand');
    await click(page, 6.5, 12.5, 'right');
    st = await page.evaluate(() => ({ held: !!__game.G.held, x: __c.x, tool: __ui.tool }));
    check('with the Hand chosen and a creature in it, right-click drops it and returns to the default', !st.held && st.tool === 'dig' && Math.abs(st.x - 6.5) < 0.5, JSON.stringify(st));
    await page.close();

    console.log('5. doors and traps sell in the default mode');
    page = await open('level=classic&seed=7');
    const sell = await page.evaluate(() => { const g = __game, G = g.G, g0 = G.gold; g.placeThings('door', 9, 12, 9, 12); g.placeThings('gas', 9, 13, 9, 13); g.placeThings('bolt', 10, 12, 10, 12); g.placeThings('door', 10, 13, 10, 13); return { placed: G.doors.length + G.traps.length, spent: g0 - G.gold, tool: __ui.tool }; });
    check('four items placed (2 doors, 2 traps)', sell.placed === 4 && sell.spent === 100 + 150 + 200 + 100 && sell.tool === 'dig', JSON.stringify(sell));
    await click(page, 9.5, 12.5, 'right');
    let r = await page.evaluate(() => ({ doors: __game.G.doors.length, traps: __game.G.traps.length, gold: __game.G.gold }));
    check('right-click on a door sells it for half (50 gold)', r.doors === 1 && r.traps === 2 && r.gold === 5000 - 550 + 50, JSON.stringify(r));
    await click(page, 9.5, 13.5, 'right');
    r = await page.evaluate(() => ({ doors: __game.G.doors.length, traps: __game.G.traps.length, gold: __game.G.gold }));
    check('right-click on a trap sells it for half (75 gold)', r.doors === 1 && r.traps === 1 && r.gold === 5000 - 550 + 50 + 75, JSON.stringify(r));
    await drag(page, [9.5, 12.5], [10.5, 14.5], 'right');
    r = await page.evaluate(() => ({ doors: __game.G.doors.length, traps: __game.G.traps.length, gold: __game.G.gold }));
    check('right-drag over a box sells whatever is in it', r.doors === 0 && r.traps === 0 && r.gold === 5000 - 550 + 50 + 75 + 50 + 100, JSON.stringify(r));
    await page.close();

    console.log('6. the hover cue');
    page = await open('level=classic&seed=7', '3d');
    await page.evaluate(() => { const g = __game, G = g.G; G.creatures.length = 0; const c = new g.Creature(9, 12, g.KINDS[1]); c.noLair = true; c.noFood = true; G.creatures.push(c); window.__c = c; });
    const ring = () => page.evaluate(() => { const r = __three.scene.children.find(o => o.geometry && o.geometry.type === 'RingGeometry' && o.renderOrder === 9); return r && { vis: r.visible, x: r.position.x, z: r.position.z }; });
    await page.evaluate(() => { const c = __c; __ui.inputMove({ x: Math.floor(c.x), y: Math.floor(c.y) }, { fx: c.x + 0.3, fy: c.y }); }); await sleep(400);
    let rg = await ring();
    check('3D: a ring appears under the creature the cursor is over (default mode)', rg && rg.vis && Math.abs(rg.x - 9.5) < 0.1 && Math.abs(rg.z - 12.5) < 0.1, JSON.stringify(rg));
    check('the shared state agrees (and the 2D canvas uses the same)', await page.evaluate(() => __ui.hoverUnit() === __c));
    await page.evaluate(() => { __ui.inputMove({ x: 20, y: 5 }, { fx: 20.5, fy: 5.5 }); }); await sleep(300); rg = await ring();
    check('away from every creature the ring is gone', rg && !rg.vis);
    await page.evaluate(() => { __game.G.speed = 0; document.getElementById('b_treasury').click(); const c = __c; __ui.inputMove({ x: Math.floor(c.x), y: Math.floor(c.y) }, { fx: c.x, fy: c.y }); }); await sleep(300); rg = await ring();
    check('with a room chosen there is no ring (the click would build, not carry)', rg && !rg.vis);
    await page.evaluate(() => { document.getElementById('b_dig').click(); __game.pickUp(__c); const c = __c; __ui.inputMove({ x: 9, y: 12 }, { fx: 9.5, fy: 12.5 }); }); await sleep(300); rg = await ring();
    check('while carrying there is no ring', rg && !rg.vis);
    // real pointer events in 3D: project the creature to the screen and click it
    await page.evaluate(() => { const G = __game.G; G.held = null; __c.held = false; __c.x = 9.5; __c.y = 12.5; document.documentElement.classList.remove('holding'); });
    await sleep(300);
    const sp = await page.evaluate(() => { const cam = __three.camera, v = new cam.position.constructor(9.5, 0.6, 12.5).project(cam), r = __three.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; });
    await page.mouse.move(sp.x, sp.y); await page.mouse.down(); await page.mouse.up(); await sleep(200);
    check('3D: a real left-click on the creature on the screen picks it up', await page.evaluate(() => __game.G.held === __c));
    await page.mouse.move(sp.x + 60, sp.y + 40); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await sleep(200);
    check('3D: a real right-click puts it down again', await page.evaluate(() => !__game.G.held && __ui.tool === 'dig'));
    await page.close();

    console.log('7. the Hand and the roster still work');
    page = await open('level=classic&seed=7');
    await page.evaluate(() => { const g = __game, G = g.G; G.creatures.length = 0; const c = new g.Creature(9, 12, g.KINDS[1]); c.noLair = true; c.noFood = true; G.creatures.push(c); window.__c = c; document.getElementById('b_hand').click(); });
    await click(page, 9.5, 12.5); check('with the Hand chosen a click picks it up as before', await page.evaluate(() => __game.G.held === __c && __ui.tool === 'hand'));
    await click(page, 5.5, 12.5); check('...and the next click drops it, the Hand staying chosen', await page.evaluate(() => !__game.G.held && __ui.tool === 'hand'));
    await page.evaluate(() => { __game.setTab('monsters', true); __game.renderRoster(true); document.querySelector('#roster .chip .grab').click(); });
    check('the roster\'s ✋ picks a creature up and takes the Hand', await page.evaluate(() => __game.G.held === __c && __ui.tool === 'hand'));
    await click(page, 7.5, 12.5, 'right'); check('and a right-click then drops it and returns to the default', await page.evaluate(() => !__game.G.held && __ui.tool === 'dig'));
    await page.close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall input checks passed'); process.exit(fails ? 1 : 0);
})();
