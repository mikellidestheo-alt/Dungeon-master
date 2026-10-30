#!/usr/bin/env node
/* Headless checks for web/audio.js and its hooks in web/game.js.   node tools/test_audio.js   (needs playwright with chromium)
 *   1. every synthesised voice, rendered offline: finite samples, audible, not clipping, silent at the start and at the end
 *   2. the music rendered offline at calm / tense / boss: audible, ordered by intensity, no clipping
 *   3. the page: no sound before the first click, the HUD mute/volume work and persist, ?sound=0 disables
 *   4. game events reach the sound module (a scripted run covering fights, traps, spells, digging, prayer, hunger, waves...)
 *   5. audio never changes the simulation (same seeded run with ?sound=0 and with sound on ends in the same state)
 *   6. quieter with distance (3D) and un-attenuated in ?view=2d
 * It cannot hear anything: judge how the sounds *sound* by ear. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8765, BASE = `http://localhost:${PORT}/`;
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    await sleep(800);
    const errors = [];
    const open = async (query, opts) => {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } }), page = await ctx.newPage();
      page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
      page.on('response', r => { if (r.status() >= 400 && !/favicon\.ico$|missing\.ogg$/.test(r.url())) errors.push(r.status() + ' ' + r.url()); });
      await page.addInitScript(() => { window.__acCount = 0; const AC = window.AudioContext; window.AudioContext = function () { window.__acCount++; return new AC(); }; window.AudioContext.prototype = AC.prototype; });
      if (opts && opts.freeze) await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });     // we drive step() by hand
      await page.goto(BASE + (query || ''), { waitUntil: 'load' }); await sleep(500); return page;
    };

    /* ------------------------------------------------------------ 1. voices */
    console.log('1. voices (offline render)');
    let page = await open('?unlock=1&view=2d');
    const voices = await page.evaluate(async () => {
      const out = [], ids = Object.keys(Sound.voices);
      for (const id of ids) {
        const rate = 44100, s = await Sound.renderVoice(id, 6, rate); let peak = 0, bad = 0, last = 0, head = 0, tail = 0;
        for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (!isFinite(s[i])) bad++; if (a > peak) peak = a; if (a > 0.01) last = i; if (i < rate * 0.045 && a > head) head = a; if (i > s.length - rate * 0.2 && a > tail) tail = a; }
        out.push({ id, peak, bad, dur: last / rate - 0.05, head, tail, len: (Sound.DEF[id] || [0, 0, 0.6])[2], hasDef: !!Sound.DEF[id] });
      }
      return out;
    });
    console.log('   id           peak   audible(s)  DEF.len');
    for (const v of voices) {
      console.log(`   ${v.id.padEnd(12)} ${v.peak.toFixed(2).padStart(5)}  ${v.dur.toFixed(2).padStart(8)}  ${String(v.len).padStart(6)}`);
      check(`voice ${v.id}`, v.bad === 0 && v.peak >= 0.03 && v.peak <= 1.2 && v.head < 0.002 && v.tail < 0.005 && v.hasDef,
        v.bad ? 'NaN/Inf samples' : v.peak < 0.03 ? 'too quiet' : v.peak > 1.2 ? 'hot' : v.head >= 0.002 ? 'sound before its start time' : v.tail >= 0.005 ? 'not silent at end (click)' : !v.hasDef ? 'missing from DEF' : '');
    }
    const lenOff = voices.filter(v => v.dur > v.len * 1.6 + 0.3);
    check('DEF.len roughly matches the rendered length (voice-cap bookkeeping)', lenOff.length === 0, lenOff.map(v => `${v.id} ${v.dur.toFixed(1)}s vs ${v.len}s`).join(', '));
    const orphan = await page.evaluate(() => Object.keys(Sound.DEF).filter(id => !Sound.voices[id]));
    check('every DEF entry has a voice', orphan.length === 0, orphan.join(','));
    await page.context().close();

    /* ------------------------------------------------------------ 2. music */
    console.log('2. music (offline render, 24 s each)');
    page = await open('?view=2d');
    const music = await page.evaluate(async () => {
      const res = {};
      for (const [name, mood] of [['calm', { tension: 0, boss: 0 }], ['tense', { tension: 0.8, boss: 0 }], ['boss', { tension: 0.9, boss: 1 }]]) {
        const [l, r] = await Sound.renderMusic(mood, 24, 32000); let s = 0, n = 0, peak = 0, bad = 0, lo = 0;
        for (let i = 32000 * 8; i < l.length; i++) { s += l[i] * l[i] + r[i] * r[i]; n += 2; }
        for (let i = 0; i < l.length; i++) { if (!isFinite(l[i]) || !isFinite(r[i])) bad++; peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i])); }
        // stereo width: rms of (L-R) relative to rms of L+R, shows the reverb actually spreads
        let d = 0, m = 0; for (let i = 32000 * 8; i < l.length; i++) { d += (l[i] - r[i]) ** 2; m += (l[i] + r[i]) ** 2; }
        res[name] = { rms: Math.sqrt(s / n), peak, bad, width: Math.sqrt(d / m) };
      }
      return res;
    });
    for (const k in music) console.log(`   ${k.padEnd(6)} rms ${music[k].rms.toFixed(4)}  peak ${music[k].peak.toFixed(2)}  stereo width ${music[k].width.toFixed(2)}`);
    check('music is audible when calm', music.calm.rms > 0.003, 'rms ' + music.calm.rms.toFixed(4));
    check('intensity ordering calm < tense < boss', music.calm.rms < music.tense.rms && music.tense.rms < music.boss.rms);
    check('music finite and not clipping', Object.values(music).every(m => m.bad === 0 && m.peak < 1.0), 'worst peak ' + Math.max(...Object.values(music).map(m => m.peak)).toFixed(2));
    check('music is not mono (reverb spreads it)', music.calm.width > 0.05, 'width ' + music.calm.width.toFixed(2));
    await page.context().close();

    /* ------------------------------------------------------------ 3. page, gesture, HUD */
    console.log('3. page, first-click start, HUD');
    page = await open('?unlock=1');
    check('no AudioContext before the first click', await page.evaluate(() => window.__acCount === 0 && Sound.engine === null));
    check('HUD hint asks for a click', (await page.textContent('#audioHint')).includes('click'));
    await page.evaluate(() => { __game.G.speed = 0; });
    await page.mouse.click(300, 400);
    await sleep(600);
    check('first click creates exactly one running AudioContext', await page.evaluate(() => window.__acCount === 1 && Sound.ctx.state === 'running'), await page.evaluate(() => Sound.ctx && Sound.ctx.state));
    check('hint disappears once started', (await page.textContent('#audioHint')) === '');
    await page.mouse.click(310, 410); await sleep(100);
    check('a second click does not create another context', await page.evaluate(() => window.__acCount === 1));
    const gain = () => page.evaluate(() => Sound.engine.master.gain.value);
    await sleep(300); const g0 = await gain();
    check('default master gain matches the volume slider (0.7^2)', Math.abs(g0 - 0.49) < 0.02, g0.toFixed(3));
    await page.click('#bMute'); await sleep(400);
    check('mute button silences the master bus', (await gain()) < 0.001 && await page.evaluate(() => Sound.muted));
    check('mute icon changes', (await page.textContent('#bMute')) === '🔇');
    await page.click('#bMute'); await sleep(400);
    check('unmute restores it', Math.abs((await gain()) - 0.49) < 0.02);
    await page.fill('#vol', '20'); await sleep(400);
    check('volume slider sets the level (0.2^2)', Math.abs((await gain()) - 0.04) < 0.01, (await gain()).toFixed(3));
    await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('m'); await sleep(400);
    check('M key mutes', (await gain()) < 0.001);
    await page.keyboard.press('m'); await sleep(300);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dm.audio')));
    check('volume persists in localStorage', stored && Math.abs(stored.vol - 0.2) < 0.001 && stored.mute === false, JSON.stringify(stored));
    await page.reload({ waitUntil: 'load' }); await sleep(400);
    check('and is restored after a reload', await page.evaluate(() => Math.abs(Sound.volume - 0.2) < 0.001 && document.getElementById('vol').value === '20'));
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, clip: { x: 0, y: 0, width: 1100, height: 130 } });     // optional: SHOT=/some/file.png
    await page.context().close();
    page = await open('?sound=0');
    check('?sound=0 removes the module and the HUD controls', await page.evaluate(() => typeof Sound === 'undefined' && getComputedStyle(document.getElementById('audioCtl')).display === 'none'));
    check('game still runs with ?sound=0', await page.evaluate(() => { __game.step(0.05); return __game.G.time > 0; }));
    await page.context().close();

    /* ------------------------------------------------------------ 4. events reach the sound module */
    console.log('4. game events -> sounds (scripted run, sim stepped by hand)');
    page = await open('?unlock=1&view=2d', { freeze: true });
    await page.mouse.click(300, 400); await sleep(300);
    const scenario = await page.evaluate(async () => {
      const g = __game, G = g.G, T = g.T, hx = G.heart.x, hy = G.heart.y, run = (n) => { for (let i = 0; i < n; i++) g.step(0.05); };
      G.gold = 8000; G.mana = 1000; const W = g.W, cell = (x, y) => G.map[y * W + x];
      const tick = () => { for (const k in G.spellCd) G.spellCd[k] = 0; };
      // dig east, build rooms, populate
      g.build(T.TREASURY, 2, 11, 3, 12);
      const gold = cell(hx + 5, hy), gem = cell(hx + 5, hy + 1); gold.t = T.GOLD; gold.hp = 4000; gold.gold = 2000; gem.t = T.GEM; gem.hp = 3000; gem.gold = 1;   // a seam and a gem right next to the Heart
      g.tagRect(hx + 5, hy, hx + 8, hy, true); g.tagRect(hx + 5, hy + 1, hx + 5, hy + 1, true); g.tagRect(hx + 7, hy, hx + 8, hy, false); run(300); g.build(T.LAIR, 2, 16, 4, 17); g.build(T.HATCHERY, 8, 16, 10, 17); g.build(T.TEMPLE, 8, 11, 10, 12); g.build(T.LIBRARY, 2, 14, 3, 15);
      G.portalOwned = true; G.nextSpawn = 0; G.nextPay = 0.1; G.nextImp = 0; run(5);
      const mk = (i, x, y) => { const c = new g.Creature(x, y, g.KINDS[i]); G.creatures.push(c); return c; };
      const warlock = mk(2, 8, 13), troll = mk(1, 7, 17), goblin = mk(0, 6, 12), darkelf = mk(3, 5, 17), spider = mk(7, 6, 16); for (const c of G.creatures) c.xp = 2;       // one kill from level 2
      warlock.hunger = 100; troll.hunger = 100; for (let i = 0; i < 3; i++) G.chickens.push(new g.Chicken(9, 17));
      for (const c of G.chickens) c.cluckT = 0.1;
      run(900);                                             // prayer, study, eating, clucking, free imps, payday
      G.research.done.gas = false; G.research.current = 'gas'; g.addResearch(1e6);          // research fanfare
      // fights: heroes appear on our land
      const hero = (name, x, y) => { const kind = g.HEROES.find(h => h.name === name), party = []; const h = new g.Hero(x, y, kind, 1, party); party.push(h); G.heroes.push(h); return h; };
      G.gateOpen = true; G.wave = 0; G.nextWave = 1e9;
      const k = hero('Knight', 9, 14), a = hero('Archer', 9, 13), m = hero('Mage', 10, 14), gi = hero('Giant', 10, 15), dw = hero('Dwarf', 9, 15);
      run(400);
      // traps and doors under our feet
      g.placeThings('gas', 8, 14, 8, 14); g.placeThings('bolt', 8, 15, 8, 15); g.placeThings('door', 10, 14, 10, 14); run(2);
      const t1 = hero('Thief', 8, 14), t2 = hero('Thief', 8, 15); run(6);
      g.placeThings('gas', 9, 13, 9, 13); hero('Dwarf', 9, 13); run(4);                      // a Dwarf steps on a trap and disarms it
      const door = g.doorAt(10, 14); if (door) g.hurt(door, 99999, G.heroes[0] || t1);       // door_hit + door_break
      // spells, including a refused one
      tick(); G.mana = 1000; const hv = hero('Knight', 7, 14); const f = { fx: hv.x, fy: hv.y };
      for (const id of g.SPELL_ORDER) { tick(); g.castSpell(id, id === 'imp' ? { fx: hx + .5, fy: hy + 2.5 } : f); }
      G.mana = 0; g.castSpell('heal', f);
      // hand
      document.getElementById('b_hand').click(); const c0 = G.creatures[0]; const p = { x: c0.tx, y: c0.ty }, ff = { fx: c0.x, fy: c0.y };
      __ui.inputDown(p, ff, 0); __ui.inputUp(p, ff); const q = { x: hx + 1, y: hy - 3 }, qf = { fx: hx + 1.5, fy: hy - 2.5 }; __ui.inputDown(q, qf, 0); __ui.inputUp(q, qf);
      // waves, a boss wave, and the heart under attack
      G.heroes.length = 0; G.wave = 0; g.spawnWave(); G.wave = 3; g.spawnWave();
      g.hurt({ heart: true, x: hx + .5, y: hy + .5, get dead() { return false; } }, 10, G.heroes[0]);
      G.heroes.length = 0; g.tagRect(hx + 5, hy, hx + 8, hy, false);
      return { requested: { ...Sound.stats.requested }, creatures: G.creatures.length, errors: 0 };
    });
    const expected = ['click', 'tag', 'build', 'dig', 'mine', 'crumble', 'imp', 'imp_spawn', 'coins', 'payday', 'portal', 'claim', 'chime', 'squawk', 'munch', 'cluck', 'research',
      'untag', 'coin', 'sword', 'club', 'bow', 'arrow_hit', 'magic', 'magic_hit', 'death', 'ko', 'levelup', 'gas', 'lightning', 'clank', 'door_hit', 'door_break', 'heal', 'haste', 'rally', 'deny',
      'pickup', 'drop', 'horn', 'boss_horn', 'heart_hit', 'bite', 'imp_scream'];
    const req = scenario.requested;
    console.log('   requested: ' + Object.keys(req).sort().map(k => k + '×' + req[k]).join(' '));
    for (const id of expected) check(`event -> ${id}`, !!req[id]);
    const reg = await page.evaluate((ids) => ids.filter(id => !Sound.voices[id] && !Sound.engine.samples[id]), Object.keys(req));
    check('every requested id has a voice', reg.length === 0, reg.join(','));
    const more = await page.evaluate(() => {                                              // torture conversion, and the Hero Gate linking up
      const g = __game, G = g.G, kind = g.HEROES[0], b = new g.Hero(8, 14, kind, 1, []); b.status = 'prisoner'; G.prisoners.push(b); g.release(b, 'convert');
      G.gateOpen = false; G.gateT = 0; const W = g.W, cell = (x, y) => G.map[y * W + x];
      for (let x = G.heart.x; x <= G.gate.x; x++) { const t = cell(x, G.heart.y); if (g.TERRAIN[t.t].solid) { t.t = g.T.PATH; t.hp = 0; } }
      for (let y = G.heart.y; y <= G.gate.y; y++) { const t = cell(G.gate.x, y); if (g.TERRAIN[t.t].solid) { t.t = g.T.PATH; t.hp = 0; } }
      for (let i = 0; i < 80; i++) g.step(0.05);
      return { open: G.gateOpen, req: { ...Sound.stats.requested } };
    });
    check('event -> convert', !!more.req.convert); check('event -> gong (tunnel reaches the Hero Gate)', more.open && !!more.req.gong);
    const over = await page.evaluate(() => { const G = __game.G; G.over = 'defeat'; Sound.setMood(__game.audioMood()); G.over = 'victory'; Sound.setMood(__game.audioMood()); return { ...Sound.stats.requested }; });
    check('game over triggers the defeat stinger', !!over.defeat);
    const notYet = await page.evaluate((ids) => Object.keys(Sound.voices).filter(id => !ids.includes(id)), Object.keys({ ...req, ...more.req, ...over }));
    check('every voice was reached by some game event', notYet.length === 0, notYet.join(', '));
    await page.context().close();

    /* ------------------------------------------------------------ 5. realtime path */
    console.log('5. realtime path (loop running, speed 3x)');
    page = await open('?unlock=1');
    await page.mouse.click(300, 400); await page.evaluate(() => { __game.G.speed = 3; });
    const rt = await page.evaluate(async () => {
      const g = __game, G = g.G; G.gold = 30000; G.mana = 1000; const hx = G.heart.x, hy = G.heart.y;
      g.build(g.T.LAIR, 2, 16, 4, 17); const c = new g.Creature(8, 14, g.KINDS[1]); G.creatures.push(c);
      let peak = 0, early = 0; const t0 = performance.now();
      const sample = setInterval(() => { const l = Sound.level(); peak = Math.max(peak, l); if (performance.now() - t0 < 2500) early = Math.max(early, l); }, 40);
      g.tagRect(hx + 5, hy, hx + 8, hy, true);
      const kind = g.HEROES.find(h => h.name === 'Knight'), party = []; for (let i = 0; i < 2; i++) { const h = new g.Hero(9, 14 + i, kind, 1, party); party.push(h); G.heroes.push(h); }
      await new Promise(r => setTimeout(r, 6000)); clearInterval(sample);
      return { peak, early, played: { ...Sound.stats.played }, state: Sound.ctx.state, mood: g.audioMood(), t: G.time };
    });
    check('engine output has signal (music + effects)', rt.peak > 0.001, 'peak rms ' + rt.peak.toFixed(4));
    check('effects were actually played (not only requested)', Object.keys(rt.played).length > 3, Object.keys(rt.played).sort().join(' '));
    check('mood reports tension while heroes are alive', rt.mood.tension > 0.3, JSON.stringify(rt.mood));
    check('AudioContext still running', rt.state === 'running');
    await page.context().close();

    /* ------------------------------------------------------------ 6. determinism */
    console.log('6. audio does not change the simulation');
    const sim = async (query, click) => {
      const p = await open(query, { freeze: true }); if (click) { await p.mouse.click(300, 400); await sleep(200); }
      const out = await p.evaluate(() => {
        const g = __game, G = g.G, hx = G.heart.x, hy = G.heart.y; G.gold = 30000; g.tagRect(hx + 5, hy, hx + 8, hy, true); for (let i = 0; i < 300; i++) g.step(0.05);
        g.build(g.T.LAIR, 2, 16, 4, 17); g.build(g.T.HATCHERY, 8, 16, 10, 17); G.portalOwned = true; G.nextSpawn = 0;
        const kind = g.HEROES.find(h => h.name === 'Archer'), party = []; const h = new g.Hero(10, 14, kind, 1, party); party.push(h); G.heroes.push(h);
        for (let i = 0; i < 1500; i++) g.step(0.05);
        const r = (v) => Math.round(v * 1000) / 1000;
        return JSON.stringify({ t: r(G.time), gold: Math.round(G.gold), mana: r(G.mana), heart: r(G.heartHp), kills: G.kills, imps: G.imps.map(i => [r(i.x), r(i.y), Math.round(i.hp)]), cr: G.creatures.map(c => [c.name, r(c.x), r(c.y), Math.round(c.hp), c.state, c.level]), ch: G.chickens.length, log: G.log.slice(0, 6) });
      });
      await p.context().close(); return out;
    };
    const off = await sim('?sound=0&seed=11&view=2d'), on = await sim('?seed=11&view=2d', true);
    check('same seed, same state after 95 s of play with sound off vs on', off === on, off === on ? off.length + ' bytes of state compared' : '\n off ' + off.slice(0, 300) + '\n on  ' + on.slice(0, 300));

    /* ------------------------------------------------------------ 7. distance */
    console.log('7. distance');
    page = await open('?unlock=1');
    await page.mouse.click(300, 400); await sleep(1000);
    const d3 = await page.evaluate(() => { const c = __three.cam; return { near: Sound.gainAt(c.x, c.z), mid: Sound.gainAt(c.x + 10, c.z), far: Sound.gainAt(c.x + 30, c.z), edge: Sound.gainAt(c.x + 38, c.z), ref: c.dist * 0.28 }; });
    check('3D: full volume at the camera, falling off with distance', d3.near > 0.99 && d3.mid < d3.near && d3.far < d3.mid, JSON.stringify(Object.fromEntries(Object.entries(d3).map(([k, v]) => [k, +v.toFixed(2)]))));
    check('3D: very distant events are dropped', d3.edge === 0 || d3.edge < 0.05);
    const zoom = await page.evaluate(() => { const c = __three.cam; c.dist = 50; return new Promise(r => setTimeout(() => r(Sound.gainAt(c.x + 20, c.z)), 200)); });
    const zin = await page.evaluate(() => { const c = __three.cam; c.dist = 14; return new Promise(r => setTimeout(() => r(Sound.gainAt(c.x + 20, c.z)), 200)); });
    check('zooming out lets you hear further', zoom > zin, `zoomed out ${zoom.toFixed(2)} vs in ${zin.toFixed(2)}`);
    await page.context().close();
    page = await open('?unlock=1&view=2d'); await page.mouse.click(300, 400); await sleep(300);
    check('2D view: no attenuation', await page.evaluate(() => Sound.gainAt(1, 1) === 1 && Sound.gainAt(39, 27) === 1));
    await page.context().close();

    /* ------------------------------------------------------------ 8. swapping in recordings */
    console.log('8. swappable: a recording replaces a synthesised voice');
    const dir = path.join(__dirname, '..', 'web', 'assets', 'audio'), wav = path.join(dir, '_test.wav'), man = path.join(dir, '_test_pack.json');   // both git-ignored
    try {
      const n = 4410, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
      b.writeUInt32LE(44100, 24); b.writeUInt32LE(88200, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
      for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 44100 * 2 * Math.PI * 880) * 12000 * (1 - i / n)), 44 + i * 2);
      fs.writeFileSync(wav, b); fs.writeFileSync(man, JSON.stringify({ click: ['_test.wav'], gas: { files: ['_test.wav'], gain: 0.5 }, bogus: 'missing.ogg', _note: 'ignored' }));
      page = await open('?view=2d'); await page.mouse.click(300, 400); await sleep(300);
      const sw = await page.evaluate(async () => {
        let synthCalls = 0; const orig = Sound.voices.click; Sound.voices.click = (...a) => { synthCalls++; return orig(...a); };
        const loaded = await Sound.loadPack('assets/audio/_test_pack.json'), before = Sound.stats.played.click || 0;
        await new Promise(r => setTimeout(r, 100)); const ok = Sound.engine.play('click'); await new Promise(r => setTimeout(r, 100));
        const rms = Sound.level(), afterFirst = synthCalls;
        Sound.engine.samples = {}; await new Promise(r => setTimeout(r, 100)); const ok2 = Sound.engine.play('click');
        return { loaded, ok, afterFirst, synthCalls, ok2, rms };
      });
      check('manifest loads two voices and skips the missing file and _keys', sw.loaded === 2, 'loaded ' + sw.loaded);
      check('the recording plays instead of the synth voice', sw.ok && sw.afterFirst === 0 && sw.rms > 0.001, JSON.stringify(sw));
      check('without the recording the synth voice is back', sw.ok2 && sw.synthCalls === 1 && sw.afterFirst === 0);
      await page.context().close();
      page = await open('?view=2d'); await page.mouse.click(300, 400); await sleep(300);
      check('the shipped empty manifest loads cleanly (no 404, nothing replaced)', await page.evaluate(async () => (await Sound.loadPack()) === 0 && Object.keys(Sound.engine.samples).length === 0));
      await page.context().close();
    } finally { for (const f of [wav, man]) try { fs.unlinkSync(f); } catch (e) { /* not created */ } }

    check('no page errors or console errors during any of it', errors.length === 0, errors.slice(0, 4).join(' | '));
  } finally {
    await browser.close(); server.kill();
  }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
