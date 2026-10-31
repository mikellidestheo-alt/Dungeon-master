#!/usr/bin/env node
/* Headless checks for the tabbed toolbar (web/game.js "The toolbar", web/index.html "The toolbar in tabs").
 *   node tools/test_tabs.js     (needs playwright with chromium)
 *   1. what is always in view, and what is hidden until a tab is opened
 *   2. each tab holds the right commands, grouped; clicking a tab opens it, clicking again closes it; the toolbar slot is never overflowed
 *   3. choosing a tool, the tab's dot, locked items, shortened labels
 *   4. hotkeys: B, C, H, the number keys, Esc
 *   5. the tutorial's hints open the right tab and pulse it
 *   6. the Monsters tab: the roster, look at a creature, pick it up from the list, put it down
 *   7. full screen: the panel opens upward from the strip, and the other overlays stay clear
 */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8777, ROOT = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ROOMS = ['treasury', 'lair', 'library', 'hatchery', 'temple', 'prison', 'torture', 'training'], DEF = ['door', 'gas', 'bolt'], SPELLS = ['lightning', 'heal', 'haste', 'rally', 'imp'];

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    await sleep(800);
    const problems = [];
    const open = async (query, w = 1500, h = 1000) => {
      const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
      page.on('pageerror', e => problems.push('pageerror: ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/GL Driver Message|willReadFrequently/.test(m.text())) problems.push(m.type() + ': ' + m.text()); });
      await page.goto(ROOT + 'index.html?sound=0&' + query, { waitUntil: 'load' }); await sleep(/view=2d/.test(query) ? 500 : 2500); await page.evaluate(() => { window.__game.G.speed = 0; }); return page;
    };
    const visible = (page) => page.evaluate(() => [...document.querySelectorAll('#tools button')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'; }).map(b => b.id));
    const fits = (page) => page.evaluate(() => { const t = document.getElementById('tools'); return t.scrollHeight <= t.clientHeight + 1; });

    console.log('1. what is in view');
    let page = await open('level=classic', 1500, 1300);
    let v = await visible(page);
    check('closed: only Dig, the three tabs and the speed buttons are in view', v.join() === 'b_dig,tab_build,tab_spells,tab_monsters,b_sp1,b_sp2,b_sp3,b_sp4', v.join());
    check('the help scroll\'s text fits its 152 px panel without scrolling', await page.evaluate(() => { const h = document.getElementById('help'); return h.scrollHeight <= h.clientHeight; }), await page.evaluate(() => { const h = document.getElementById('help'); return h.scrollHeight + '/' + h.clientHeight; }));
    check('the commands are all still there, just hidden (ids unchanged)', await page.evaluate((ids) => ids.every(id => document.getElementById('b_' + id)), [...ROOMS, ...DEF, ...SPELLS, 'hand', 'dig', 'sp1']));
    check('the panel is closed and the tabs say so', await page.evaluate(() => getComputedStyle(document.getElementById('tabpanel')).display === 'none' && ['build', 'spells', 'monsters'].every(t => document.getElementById('tab_' + t).getAttribute('aria-expanded') === 'false')));

    console.log('2. the tabs');
    await page.click('#tab_build'); v = await visible(page);
    check('Buildings: the eight rooms (the Training Room is new) and the three defences (door, gas trap, lightning trap)', ROOMS.concat(DEF).every(id => v.includes('b_' + id)) && !v.includes('b_hand') && !v.includes('b_lightning'), v.join());
    check('...in two labelled groups: Rooms and Defences', await page.evaluate(() => [...document.querySelectorAll('#tp_build .grp > .lbl')].map(l => l.textContent).join() === 'Rooms,Defences'));
    check('...and the open tab is marked', await page.evaluate(() => document.getElementById('tab_build').classList.contains('open') && document.getElementById('tab_build').getAttribute('aria-expanded') === 'true'));
    check('Buildings fits the toolbar slot', await fits(page));
    await page.click('#tab_build'); v = await visible(page);
    check('clicking the open tab again closes it', v.length === 8 && !v.includes('b_treasury'), v.join());
    await page.click('#tab_spells'); v = await visible(page);
    check('Spells: the five spells, with costs and hotkeys on the buttons', SPELLS.every(id => v.includes('b_' + id)) && !v.includes('b_treasury') && await page.evaluate(() => /120 \[1\]/.test(document.getElementById('b_lightning').textContent) && /100 \[5\]/.test(document.getElementById('b_imp').textContent)), v.join());
    check('Spells fits the slot', await fits(page));
    await page.click('#tab_monsters'); v = await visible(page);
    check('Monsters replaces Spells: the Hand is there, the spells are not', v.includes('b_hand') && !v.includes('b_lightning') && await page.evaluate(() => document.getElementById('tab_monsters').classList.contains('open') && !document.getElementById('tab_spells').classList.contains('open')), v.join());
    await page.evaluate(() => { const g = __game; for (let i = 0; i < 15; i++) g.G.creatures.push(new g.Creature(g.G.heart.x + 2 + (i % 3), g.G.heart.y + 3, g.KINDS[i % 8])); g.renderRoster(true); }); await sleep(300);
    check('Monsters with a full house of 15 creatures still fits the slot (the roster scrolls)', await fits(page));
    await page.evaluate(() => { __game.G.creatures.length = 0; }); await page.click('#tab_monsters');

    console.log('3. tools, dots, locks and labels');
    await page.click('#tab_build'); await page.click('#b_treasury'); await page.click('#tab_build');
    check('choosing a room and closing the tab keeps the tool (and the tab shows a dot)', await page.evaluate(() => __ui.tool === 'treasury' && document.getElementById('tab_build').classList.contains('has') && !document.getElementById('tab_spells').classList.contains('has')));
    await page.click('#b_dig'); check('Dig is always one click away and clears the dot', await page.evaluate(() => __ui.tool === 'dig' && !document.getElementById('tab_build').classList.contains('has')));
    check('room labels are short (no "/tile") and the tooltip says what a tile costs', await page.evaluate(() => /^Treasury 50g$/.test(document.getElementById('b_treasury').textContent) && /50 gold for every tile/.test(document.getElementById('b_treasury').title)));
    await sleep(300);
    const lock = await page.evaluate(() => { const b = document.getElementById('b_prison'); return { op: b.style.opacity, tool: __ui.tool }; });
    await page.click('#tab_build'); await page.click('#b_prison'); await sleep(100);
    check('a locked item is greyed inside its tab, and choosing it only explains why', lock.op === '0.3' && await page.evaluate(() => __ui.tool === 'dig' && /research/i.test(__game.G.log[0] || '')), JSON.stringify(lock));
    await page.click('#tab_build');
    await page.click('#b_sp3'); check('the speed buttons work from the strip (3x)', await page.evaluate(() => __game.G.speed === 3)); await page.click('#b_sp1'); check('...and Pause', await page.evaluate(() => __game.G.speed === 0));

    console.log('4. hotkeys');
    await page.keyboard.press('b'); check('B opens Buildings', await page.evaluate(() => document.getElementById('tab_build').classList.contains('open')));
    await page.keyboard.press('b'); check('B again closes it', await page.evaluate(() => !document.getElementById('tabpanel').classList.contains('open')));
    await page.keyboard.press('c'); check('C opens Spells', await page.evaluate(() => document.getElementById('tab_spells').classList.contains('open')));
    await page.keyboard.press('Escape'); check('Esc closes the open tab', await page.evaluate(() => !document.getElementById('tabpanel').classList.contains('open')));
    await page.keyboard.press('h'); check('H opens Monsters and takes the Hand', await page.evaluate(() => document.getElementById('tab_monsters').classList.contains('open') && __ui.tool === 'hand'));
    await page.keyboard.press('Escape');
    await page.goto(ROOT + 'index.html?sound=0&level=classic&unlock=1', { waitUntil: 'load' }); await sleep(2500); await page.evaluate(() => { __game.G.speed = 0; });
    await page.keyboard.press('2'); check('a number key opens Spells and picks that spell (2 = Heal)', await page.evaluate(() => document.getElementById('tab_spells').classList.contains('open') && __ui.tool === 'heal' && document.getElementById('b_heal').classList.contains('on')));
    await page.keyboard.press('m'); await page.keyboard.press('b'); check('other keys still work next to them (M mutes, B switches tab)', await page.evaluate(() => document.getElementById('tab_build').classList.contains('open')));
    await page.context().close();

    console.log('5. the tutorial hints');
    page = await open('level=tutorial', 1500, 1300);
    check('before the Treasury step nothing is open', await page.evaluate(() => !document.getElementById('tabpanel').classList.contains('open')));
    await page.evaluate(() => { __game.G.guideStep = 4; }); await sleep(500);
    const gd = await page.evaluate(() => ({ open: document.getElementById('tab_build').classList.contains('open'), tab: document.getElementById('tab_build').classList.contains('hint'), btn: document.getElementById('b_treasury').classList.contains('hint'), text: document.getElementById('guideText').textContent }));
    check('the Treasury hint opens Buildings and pulses the Treasury button', gd.open && gd.btn && gd.tab && /Buildings/.test(gd.text), JSON.stringify(gd));
    await page.click('#tab_build'); await sleep(200);
    check('if you close the tab the tab itself pulses, so you can find the button again', await page.evaluate(() => getComputedStyle(document.getElementById('tab_build')).animationName === 'hintPulse'));
    await page.evaluate(() => { __game.G.guideStep = 6; }); await sleep(500);
    check('the next hint (Lair) pulses the Lair button, and the Buildings tab opens again', await page.evaluate(() => document.getElementById('tab_build').classList.contains('open') && document.getElementById('b_lair').classList.contains('hint') && !document.getElementById('b_treasury').classList.contains('hint')));
    await page.evaluate(() => { __game.G.guideStep = 7; }); await sleep(500);
    check('a Dig hint pulses Dig and leaves the tab as it is, without a stray pulse on the others', await page.evaluate(() => document.getElementById('b_dig').classList.contains('hint') && !document.getElementById('tab_build').classList.contains('hint')));
    await page.evaluate(() => { __game.G.guideStep = 10; }); await sleep(500);
    check('the last hint (pick a creature up with a click, in the default mode) pulses Dig / grab and no longer needs the Monsters tab', await page.evaluate(() => document.getElementById('b_dig').classList.contains('hint') && /pick it up/.test(document.getElementById('guideText').textContent)));
    await page.context().close();

    console.log('6. the Monsters tab');
    page = await open('level=classic', 1500, 1300);
    await page.evaluate(() => { const g = __game, G = g.G; for (const [i, k] of [0, 1, 2].entries()) { const c = new g.Creature(G.heart.x + 2 + i, G.heart.y + 3, g.KINDS[k]); c.noLair = true; G.creatures.push(c); } G.creatures[1].hp = G.creatures[1].maxHp / 2; G.creatures[2].anger = 1000; G.creatures[2].level = 3; });
    await page.keyboard.press('h'); await sleep(400);
    const ro = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#roster .chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim()), hp: [...document.querySelectorAll('#roster .chip .hp u')].map(u => u.style.width), sum: document.getElementById('rosterSum').textContent.replace(/\s+/g, ' ') }));
    check('the roster has a chip for each creature with its kind and level', ro.chips.length === 3 && /Goblin 1/.test(ro.chips[0]) && /Troll 1/.test(ro.chips[1]) && /Warlock 3/.test(ro.chips[2]), JSON.stringify(ro.chips));
    check('...a health bar that follows its health, and a mood face for an upset one', ro.hp[0] === '100%' && ro.hp[1] === '50%' && /😐/.test(ro.chips[2]) && !/😐|😠/.test(ro.chips[0]), ro.hp.join());
    check('the summary counts imps and creatures against the army limit (this map has no Lair yet, so 0 beds; it used to say /15)', /Imps 4 · Creatures 3\/0 beds/.test(ro.sum), ro.sum);
    const c1 = await page.evaluate(() => { const c = __game.G.creatures[1]; __three.cam.x = 3; __three.cam.z = 3; document.querySelectorAll('#roster .chip')[1].click(); return { cam: [__three.cam.x, __three.cam.z], at: [c.x, c.y], sel: document.querySelectorAll('#roster .chip.selected').length, tool: __ui.tool }; });
    check('clicking a chip moves the camera to that creature and marks it', Math.abs(c1.cam[0] - c1.at[0]) < 0.01 && Math.abs(c1.cam[1] - c1.at[1]) < 0.01 && c1.sel === 1, JSON.stringify(c1));
    const g1 = await page.evaluate(() => { document.querySelectorAll('#roster .chip .grab')[0].click(); const G = __game.G; return { held: G.held && G.held.name, tool: __ui.tool, holding: document.documentElement.classList.contains('holding') }; });
    check('clicking a chip\'s hand picks that creature up: the Hand tool, the fist cursor', g1.held === 'Goblin' && g1.tool === 'hand' && g1.holding, JSON.stringify(g1));
    await page.evaluate(() => { document.querySelectorAll('#roster .chip .grab')[1].click(); });
    check('you cannot pick up a second one while carrying (and it says why)', await page.evaluate(() => __game.G.held.name === 'Goblin' && /already carrying/.test(__game.G.log[0])));
    const dropped = await page.evaluate(() => { const G = __game.G, x = G.heart.x + 3.5, y = G.heart.y + 0.5, p = { x: Math.floor(x), y: Math.floor(y) }, f = { fx: x, fy: y }; __ui.inputDown(p, f, 0); __ui.inputUp(p, f); const c = G.creatures[0]; return { held: G.held, at: [c.x, c.y], flag: c.held }; });
    check('a click on the map puts it down where you clicked', dropped.held === null && !dropped.flag && Math.abs(dropped.at[0] - 9.5) < 0.01, JSON.stringify(dropped));
    await page.evaluate(() => { __game.G.creatures.length = 0; }); await sleep(300);
    check('with no creatures the list says so', await page.evaluate(() => /No creatures yet/.test(document.getElementById('roster').textContent)));
    await page.context().close();

    console.log('7. in full screen');
    page = await open('level=tutorial', 1600, 900); await page.keyboard.press('f'); await sleep(1000);
    const strip0 = await page.evaluate(() => document.getElementById('tabrow').getBoundingClientRect().bottom);
    await page.keyboard.press('b'); await sleep(500);
    const fs = await page.evaluate(() => { const q = (s) => document.querySelector(s).getBoundingClientRect(); return { strip: q('#tabrow'), panel: q('#tabpanel'), tools: q('#tools'), guide: q('#guide'), obj: q('#objPanel'), hud: q('#hud'), win: innerHeight, vars: getComputedStyle(document.documentElement).getPropertyValue('--toolsH') }; });
    check('the strip stays at the bottom edge and the panel opens upward above it', fs.panel.bottom <= fs.strip.top + 1 && Math.abs(fs.strip.bottom - strip0) < 2 && fs.tools.bottom === fs.win, JSON.stringify([fs.panel.bottom, fs.strip.top, fs.strip.bottom, strip0]));
    check('the bar grew with the panel, and the hint banner moved up to stay clear of it', fs.guide.bottom <= fs.tools.top && parseInt(fs.vars) >= 100, JSON.stringify([fs.guide.bottom, fs.tools.top, fs.vars]));
    check('the objectives still sit below the top bar', fs.obj.top >= fs.hud.bottom);
    await page.click('#b_lair'); check('a room can be chosen from the panel in full screen', await page.evaluate(() => __ui.tool === 'lair'));
    await page.keyboard.press('b'); await sleep(400);
    check('closing the tab brings the bar back down', await page.evaluate(() => document.getElementById('tools').getBoundingClientRect().height < 80));
    await page.context().close();

    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall tab checks passed'); process.exit(fails ? 1 : 0);
})();
