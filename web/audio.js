'use strict';
/* =====================================================================================
 * Sound and music, all synthesised with WebAudio: no audio files are needed (or shipped).
 *
 *   game.js  --  sfx(id, x, y)  -->  Sound.play(id, tileX, tileY)      one-shot effects, quieter and panned by distance
 *            --  Sound.setMood({tension, boss, over})                   drives the music every frame; over = 'victory' | 'defeat' | 'retired'
 *   render3d --  Sound.setListener(...)                                  camera position (3D view only; the 2D view is un-attenuated)
 *
 * Swappable: every effect is a "voice" in `Sound.voices` (a function that schedules oscillators and noise), so you can
 * replace one with other code, or drop real recordings next to `assets/audio/sounds.json` and they take over from the
 * synthesised voice of the same id (see README / docs/05-audio.md). Nothing starts before the first user gesture.
 * Audio never touches the game's seeded RNG (`rand`), only Math.random, so sound on/off cannot change a run.
 * ===================================================================================== */
(function () {
  const qs = new URLSearchParams(location.search);
  if (qs.get('sound') === '0') { const c = document.getElementById('audioCtl'); if (c) c.style.display = 'none'; return; }   // ?sound=0: no audio at all

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];

  /* ---------------------------------------------------------------- toolkit: tiny synth helpers bound to one context */
  function toolkit(ctx) {
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const env = (g, t, a, dur, vol) => {                      // fast attack, exponential decay to silence
      a = Math.min(a, dur * 0.5);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    };
    const K = {
      ctx,
      /* oscillator sweeping f0 -> f1; o: {a: attack, lp: lowpass Hz, bp: {f,q}, detune, vib: {rate, depth}} */
      tone(dest, type, f0, f1, t, dur, vol, a, o) {
        o = o || {}; const osc = ctx.createOscillator(), g = ctx.createGain(); osc.type = type;
        osc.frequency.setValueAtTime(f0, t); if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
        if (o.detune) osc.detune.value = o.detune;
        env(g, t, a === undefined ? 0.004 : a, dur, vol);
        let node = osc;
        if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
        if (o.bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.bp.f; f.Q.value = o.bp.q; node.connect(f); node = f; }
        node.connect(g); g.connect(dest);
        if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = o.vib.rate; lg.gain.value = o.vib.depth; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05); }
        osc.start(t); osc.stop(t + dur + 0.05); return osc;
      },
      /* filtered noise; o: {type, f0, f1, q, a} */
      noise(dest, t, dur, vol, o) {
        o = o || {}; const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = nb; src.loop = true; f.type = o.type || 'bandpass'; f.Q.value = o.q === undefined ? 1 : o.q;
        f.frequency.setValueAtTime(o.f0 || 1000, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
        env(g, t, o.a === undefined ? 0.002 : o.a, dur, vol);
        src.connect(f); f.connect(g); g.connect(dest); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
      },
    };
    return K;
  }

  /* ---------------------------------------------------------------- the synthesised voices: (kit, dest, t, {pitch}) */
  const V = {};
  const bell = (k, d, t, f, vol, len) => {                   // struck-metal partials
    k.tone(d, 'sine', f, f, t, len, vol, 0.004); k.tone(d, 'sine', f * 2.76, f * 2.76, t, len * 0.4, vol * 0.3, 0.003);
    k.tone(d, 'sine', f * 5.4, f * 5.4, t, len * 0.18, vol * 0.12, 0.002); k.tone(d, 'sine', f * 1.004, f * 1.004, t, len * 0.8, vol * 0.5, 0.004);
  };
  const ping = (k, d, t, f, vol) => { k.tone(d, 'sine', f, f, t, 0.2, vol, 0.001); k.tone(d, 'sine', f * 2.7, f * 2.7, t, 0.09, vol * 0.4, 0.001); };
  const coins = (k, d, t, p, n, spread) => { for (let i = 0; i < n; i++) ping(k, d, t + i * spread * rnd(0.6, 1.4), rnd(2200, 3400) * p.pitch, rnd(0.12, 0.22)); };
  const cluck = (k, d, t, p, n, base, long) => {
    for (let i = 0; i < n; i++) {
      const last = i === n - 1, tt = t + i * 0.085 + rnd(0, 0.015), f = base * p.pitch * rnd(0.92, 1.1);
      k.tone(d, 'sawtooth', f, f * 0.55, tt, last ? long : 0.07, 0.3, 0.004, { bp: { f: 1400, q: 3 }, vib: last ? { rate: 30, depth: 40 } : undefined });
    }
  };
  const timp = (k, d, t, v) => { k.tone(d, 'sine', 120, 58, t, 0.5, v * 0.85, 0.004); k.noise(d, t, 0.07, v * 0.4, { type: 'lowpass', f0: 500, q: 0.7 }); k.tone(d, 'triangle', 240, 120, t, 0.25, v * 0.2, 0.004); };

  // UI
  V.click = (k, d, t, p) => k.tone(d, 'triangle', 1500 * p.pitch, 900 * p.pitch, t, 0.04, 0.35);
  V.tag = (k, d, t, p) => { k.tone(d, 'square', 420 * p.pitch, 300 * p.pitch, t, 0.05, 0.14); k.noise(d, t, 0.03, 0.12, { type: 'highpass', f0: 3000 }); };
  V.untag = (k, d, t, p) => k.tone(d, 'square', 300 * p.pitch, 200 * p.pitch, t, 0.05, 0.12);
  V.deny = (k, d, t, p) => { for (let i = 0; i < 2; i++) k.tone(d, 'square', 150 * p.pitch, 130 * p.pitch, t + i * 0.11, 0.09, 0.2, 0.005, { lp: 700 }); };
  V.build = (k, d, t, p) => { for (let i = 0; i < 2; i++) { const tt = t + i * 0.14; k.tone(d, 'sine', 140 * p.pitch, 70, tt, 0.1, 0.5, 0.002); k.noise(d, tt, 0.06, 0.3, { type: 'lowpass', f0: 900, q: 0.7 }); k.tone(d, 'triangle', 1800, 1700, tt, 0.04, 0.08, 0.001); } };
  V.pickup = (k, d, t, p) => { k.tone(d, 'sine', 280 * p.pitch, 520 * p.pitch, t, 0.12, 0.25, 0.02); k.noise(d, t, 0.08, 0.1, { f0: 1200, q: 1 }); };
  V.train = (k, d, t, p) => { k.tone(d, 'triangle', 190 * p.pitch, 90 * p.pitch, t, 0.14, 0.4, 0.003, { lp: 900 }); k.tone(d, 'sine', 95 * p.pitch, 60 * p.pitch, t + 0.02, 0.18, 0.25, 0.004); k.noise(d, t, 0.05, 0.28, { f0: 1800, q: 1.2 }); };      // a wooden strike on the training dummy
  V.drop = (k, d, t, p) => { k.tone(d, 'sine', 400 * p.pitch, 160 * p.pitch, t, 0.12, 0.3, 0.004); k.noise(d, t, 0.06, 0.2, { type: 'lowpass', f0: 700, q: 0.7 }); };
  // combat
  V.sword = (k, d, t, p) => {
    const f = p.pitch; k.noise(d, t, 0.07, 0.55, { f0: 3800 * f, f1: 1800 * f, q: 1.2 });
    k.tone(d, 'triangle', 2300 * f, 2250 * f, t, 0.22, 0.16, 0.002); k.tone(d, 'triangle', 3470 * f, 3400 * f, t, 0.16, 0.1, 0.002); k.tone(d, 'sine', 170 * f, 80 * f, t, 0.09, 0.35);
  };
  V.clank = (k, d, t, p) => { k.tone(d, 'square', 900 * p.pitch, 880 * p.pitch, t, 0.12, 0.12, 0.001, { bp: { f: 1800, q: 6 } }); k.tone(d, 'triangle', 1500 * p.pitch, 1450 * p.pitch, t, 0.2, 0.12, 0.001); k.noise(d, t, 0.03, 0.2, { type: 'highpass', f0: 3000 }); };
  V.bite = (k, d, t, p) => { for (let i = 0; i < 3; i++) k.noise(d, t + i * 0.03, 0.05, 0.4, { f0: 1400 * p.pitch, q: 2 }); k.tone(d, 'sine', 130 * p.pitch, 70, t, 0.1, 0.3); };
  V.club = (k, d, t, p) => { k.tone(d, 'sine', 100 * p.pitch, 45, t, 0.18, 0.7, 0.002); k.noise(d, t, 0.12, 0.4, { type: 'lowpass', f0: 700, q: 0.7 }); };
  V.bow = (k, d, t, p) => { k.tone(d, 'triangle', 520 * p.pitch, 170 * p.pitch, t, 0.12, 0.3); k.noise(d, t, 0.06, 0.25, { type: 'highpass', f0: 5000 }); k.tone(d, 'sine', 190 * p.pitch, 185 * p.pitch, t, 0.15, 0.15); };
  V.arrow_hit = (k, d, t, p) => { k.noise(d, t, 0.08, 0.5, { type: 'lowpass', f0: 1100, f1: 400, q: 0.7 }); k.tone(d, 'sine', 200 * p.pitch, 90, t, 0.08, 0.4); };
  V.magic = (k, d, t, p) => { k.tone(d, 'sine', 500 * p.pitch, 1500 * p.pitch, t, 0.18, 0.22, 0.01); k.tone(d, 'triangle', 1000 * p.pitch, 2200 * p.pitch, t, 0.1, 0.08, 0.01); k.noise(d, t, 0.05, 0.1, { type: 'highpass', f0: 6000 }); };
  V.magic_hit = (k, d, t, p) => { k.noise(d, t, 0.14, 0.35, { f0: 2500 * p.pitch, f1: 600, q: 1 }); k.tone(d, 'sine', 900 * p.pitch, 250, t, 0.14, 0.3); };
  V.heart_hit = (k, d, t, p) => { k.tone(d, 'sine', 70 * p.pitch, 34, t, 0.35, 0.8, 0.003); k.noise(d, t, 0.2, 0.6, { type: 'lowpass', f0: 250, q: 0.7 }); k.tone(d, 'triangle', 140, 70, t, 0.2, 0.25); };
  V.ko = (k, d, t, p) => {
    k.tone(d, 'sine', 230 * p.pitch, 60, t, 0.45, 0.55); k.noise(d, t, 0.15, 0.5, { type: 'lowpass', f0: 400, q: 0.7 });
    for (let i = 0; i < 3; i++) k.tone(d, 'triangle', 1300 + i * 180, 1300 + i * 180, t + 0.15 + i * 0.12, 0.12, 0.1, 0.002);
  };
  V.death = (k, d, t, p) => { k.tone(d, 'sawtooth', 260 * p.pitch, 55, t, 0.55, 0.4, 0.01, { lp: 800 }); k.noise(d, t, 0.25, 0.5, { type: 'lowpass', f0: 500, q: 0.7 }); k.tone(d, 'sine', 80, 35, t, 0.5, 0.5); };
  V.levelup = (k, d, t, p) => { [523.3, 659.3, 784, 1046.5].forEach((f, i) => k.tone(d, 'triangle', f * p.pitch, f * p.pitch, t + i * 0.09, 0.3, 0.22, 0.005)); bell(k, d, t + 0.3, 1046.5, 0.1, 0.9); };
  // traps and spells
  V.lightning = (k, d, t, p) => {
    k.noise(d, t, 0.35, 0.5, { type: 'highpass', f0: 1800, q: 0.7, a: 0.001 });
    for (let i = 0; i < 5; i++) k.noise(d, t + 0.02 + i * 0.045 + rnd(0, 0.03), 0.05, 0.35, { f0: rnd(2000, 6000), q: 2 });
    k.tone(d, 'sawtooth', 900 * p.pitch, 60, t, 0.25, 0.3, 0.001, { lp: 2500 }); k.tone(d, 'sine', 60, 38, t + 0.02, 0.7, 0.5, 0.01);
  };
  V.gas = (k, d, t, p) => {
    k.noise(d, t, 1.4, 0.5, { f0: 2500, f1: 5200, q: 0.8, a: 0.25 }); k.noise(d, t, 1.0, 0.25, { type: 'lowpass', f0: 600, f1: 300, q: 0.7, a: 0.1 });
    for (let i = 0; i < 5; i++) { const f = rnd(300, 600); k.tone(d, 'sine', f, f + 200, t + 0.15 + rnd(0, 0.9), 0.05, 0.12, 0.003); }
  };
  V.heal = (k, d, t, p) => { [523.3, 659.3, 784, 1046.5].forEach((f, i) => { k.tone(d, 'sine', f * p.pitch, f * p.pitch, t + i * 0.07, 0.5, 0.2, 0.005); k.tone(d, 'sine', f * 2 * p.pitch, f * 2 * p.pitch, t + i * 0.07, 0.25, 0.05, 0.005); }); };
  V.haste = (k, d, t, p) => { k.noise(d, t, 0.55, 0.45, { f0: 400, f1: 3500, q: 1.5, a: 0.1 }); k.tone(d, 'sine', 300 * p.pitch, 900 * p.pitch, t, 0.5, 0.1, 0.05); };
  V.rally = (k, d, t, p) => {
    for (const [f, tt, dur] of [[146.8, 0, 0.55], [220, 0.45, 0.9]]) { k.tone(d, 'sawtooth', f * p.pitch, f * p.pitch, t + tt, dur, 0.28, 0.12, { lp: 900 }); k.tone(d, 'sawtooth', f * p.pitch, f * p.pitch, t + tt, dur, 0.2, 0.12, { lp: 900, detune: 9 }); }
  };
  V.imp_spawn = (k, d, t, p) => { k.tone(d, 'sine', 250 * p.pitch, 900 * p.pitch, t, 0.1, 0.35, 0.005); k.noise(d, t, 0.06, 0.2, { f0: 2000, q: 1 }); };
  // digging, gold, building
  V.dig = (k, d, t, p) => { k.noise(d, t, 0.08, 0.55, { f0: 500, f1: 300, q: 1.5 }); k.tone(d, 'sine', 150 * p.pitch, 70, t, 0.08, 0.35); };
  V.mine = (k, d, t, p) => { V.dig(k, d, t, p); ping(k, d, t + 0.04, rnd(2400, 3300), 0.13); };
  V.crumble = (k, d, t, p) => { k.noise(d, t, 0.6, 0.55, { type: 'lowpass', f0: 900, f1: 300, q: 0.7, a: 0.02 }); for (let i = 0; i < 6; i++) k.noise(d, t + 0.05 + rnd(0, 0.5), 0.03, 0.25, { f0: rnd(800, 2500), q: 2 }); k.tone(d, 'sine', 80, 40, t, 0.4, 0.3, 0.01); };
  V.claim = (k, d, t, p) => { k.tone(d, 'sine', 660 * p.pitch, 700 * p.pitch, t, 0.12, 0.12, 0.003); k.tone(d, 'sine', 990 * p.pitch, 990 * p.pitch, t + 0.05, 0.15, 0.07, 0.003); };
  V.coin = (k, d, t, p) => coins(k, d, t, p, 1, 0);
  V.coins = (k, d, t, p) => coins(k, d, t, p, 4, 0.06);
  V.payday = (k, d, t, p) => coins(k, d, t, p, 12, 0.07);
  V.door_hit = (k, d, t, p) => { k.tone(d, 'sine', 120 * p.pitch, 55, t, 0.14, 0.6, 0.002); k.noise(d, t, 0.1, 0.4, { type: 'lowpass', f0: 600, q: 0.7 }); k.tone(d, 'triangle', 300 * p.pitch, 200, t, 0.06, 0.1); };
  V.door_break = (k, d, t, p) => {
    k.noise(d, t, 0.5, 0.6, { type: 'lowpass', f0: 1500, f1: 300, q: 0.7 }); k.tone(d, 'sine', 90, 35, t, 0.45, 0.7, 0.003);
    for (let i = 0; i < 6; i++) k.noise(d, t + rnd(0.02, 0.4), 0.03, 0.25, { type: 'highpass', f0: 2500 });
  };
  // life in the dungeon
  V.chime = (k, d, t, p) => bell(k, d, t, pick([587.3, 698.5, 784, 880, 1046.5]) * p.pitch, 0.2, 2.4);
  V.cluck = (k, d, t, p) => cluck(k, d, t, p, 2 + ((Math.random() * 2) | 0), 520, 0.14);
  V.squawk = (k, d, t, p) => cluck(k, d, t, p, 4, 800, 0.26);
  V.imp = (k, d, t, p) => { const n = 4 + ((Math.random() * 4) | 0); for (let i = 0; i < n; i++) { const f = rnd(500, 1200) * p.pitch; k.tone(d, 'sawtooth', f, f * rnd(0.8, 1.3), t + i * 0.075, 0.06, 0.22, 0.004, { bp: { f: 1300, q: 4 }, vib: { rate: 40, depth: 30 } }); } };
  V.imp_scream = (k, d, t, p) => k.tone(d, 'sawtooth', 1200 * p.pitch, 500 * p.pitch, t, 0.4, 0.3, 0.01, { bp: { f: 1400, q: 3 }, vib: { rate: 40, depth: 60 } });
  V.munch = (k, d, t, p) => { for (let i = 0; i < 3; i++) k.noise(d, t + i * 0.09, 0.06, 0.4, { type: 'lowpass', f0: 1800, f1: 600, q: 1 }); k.tone(d, 'sine', 200, 120, t + 0.3, 0.12, 0.2); };
  V.portal = (k, d, t, p) => {
    k.tone(d, 'sine', 110 * p.pitch, 440 * p.pitch, t, 1.0, 0.3, 0.3); k.tone(d, 'sine', 112 * p.pitch, 448 * p.pitch, t, 1.0, 0.25, 0.3); k.noise(d, t, 0.9, 0.15, { f0: 1000, f1: 4000, q: 4, a: 0.3 });
  };
  V.convert = (k, d, t, p) => { k.tone(d, 'sine', 330 * p.pitch, 660 * p.pitch, t, 1.0, 0.2, 0.2); k.tone(d, 'sine', 334 * p.pitch, 668 * p.pitch, t, 1.0, 0.2, 0.2); bell(k, d, t + 0.7, 660, 0.12, 0.8); };
  V.research = (k, d, t, p) => { [392, 440, 523.3, 587.3, 659.3, 784].forEach((f, i) => k.tone(d, 'triangle', f, f, t + i * 0.08, 0.3, 0.18, 0.005)); for (const f of [523.3, 659.3, 784, 1046.5]) bell(k, d, t + 0.55, f, 0.1, 1.6); };
  // big moments
  V.gong = (k, d, t, p) => { [1, 1.59, 2.14, 2.3, 2.65, 3.2].forEach((r, i) => k.tone(d, 'sine', 110 * r, 110 * r, t, 3.5 / (1 + i * 0.5), 0.2 / (1 + i * 0.3), 0.01)); k.tone(d, 'sine', 55, 55, t, 2.2, 0.4, 0.02); k.noise(d, t, 0.15, 0.2, { f0: 1500, q: 0.8 }); };
  V.horn = (k, d, t, p) => {
    for (const f of [73.4, 110, 146.8]) { k.tone(d, 'sawtooth', f, f, t, 2.2, 0.2, 0.4, { lp: 900 }); k.tone(d, 'sawtooth', f, f, t, 2.2, 0.15, 0.4, { lp: 900, detune: 8 }); }
    k.tone(d, 'sine', 36.7, 36.7, t, 2.2, 0.4, 0.3);
  };
  V.boss_horn = (k, d0, t, p) => {
    const d = k.ctx.createGain(); d.gain.value = 0.7; d.connect(d0);                                  // everything at once is loud; leave headroom
    V.horn(k, d, t, p); V.gong(k, d, t + 0.1, p);
    for (let i = 0; i < 10; i++) timp(k, d, t + 0.6 + i * (0.22 - i * 0.012), 0.2 + i * 0.05);
    for (const f of [58.3, 87.3]) k.tone(d, 'sawtooth', f, f, t + 0.5, 3.2, 0.2, 0.9, { lp: 700 });
  };
  V.victory = (k, d, t, p) => {
    [[293.7, 0], [370, 0.18], [440, 0.36], [587.3, 0.54]].forEach(([f, o]) => { k.tone(d, 'sawtooth', f, f, t + o, 1.4, 0.12, 0.05, { lp: 2200 }); k.tone(d, 'triangle', f * 2, f * 2, t + o, 1.6, 0.1, 0.05); });
    for (const f of [587.3, 740, 880]) bell(k, d, t + 0.7, f, 0.12, 2.5);
  };
  V.defeat = (k, d, t, p) => {
    V.gong(k, d, t, p); k.tone(d, 'sawtooth', 58.3, 29, t, 4.5, 0.3, 0.6, { lp: 400 }); k.tone(d, 'sawtooth', 87.3, 43, t + 0.6, 3.8, 0.2, 0.6, { lp: 400 });
    for (let i = 0; i < 3; i++) timp(k, d, t + 0.5 + i * 0.9, 0.5 - i * 0.12);
  };

  // screens: objectives, the tutorial guide, the briefing card, the end screen, the menus
  V.objective = (k, d, t, p) => { [587.3, 740, 880].forEach((f, i) => k.tone(d, 'triangle', f * p.pitch, f * p.pitch, t + i * 0.1, 0.4, 0.2, 0.005)); bell(k, d, t + 0.28, 1174.7 * p.pitch, 0.1, 1.0); };      // an objective is done
  V.guide = (k, d, t, p) => { k.noise(d, t, 0.2, 0.1, { type: 'highpass', f0: 3500, a: 0.05 }); bell(k, d, t + 0.04, 880 * p.pitch, 0.1, 0.7); };                                                      // the next hint appears
  V.scroll = (k, d, t, p) => { k.noise(d, t, 0.55, 0.22, { f0: 600, f1: 2600, q: 1.2, a: 0.12 }); k.noise(d, t + 0.35, 0.25, 0.12, { type: 'highpass', f0: 4000 }); k.tone(d, 'sine', 110 * p.pitch, 165 * p.pitch, t, 0.7, 0.2, 0.2); };   // a briefing unrolls
  V.begin = (k, d, t, p) => { timp(k, d, t, 0.5); for (const [f, o] of [[73.4, 0.1], [110, 0.35], [146.8, 0.6]]) k.tone(d, 'sawtooth', f * p.pitch, f * p.pitch, t + o, 0.9, 0.14, 0.12, { lp: 900 }); bell(k, d, t + 0.6, 587.3, 0.1, 1.0); };   // "Begin"
  V.star = (k, d, t, p) => { ping(k, d, t, 1318.5 * p.pitch, 0.3); k.tone(d, 'sine', 2637 * p.pitch, 2637 * p.pitch, t + 0.02, 0.5, 0.1, 0.003); bell(k, d, t, 659.3 * p.pitch, 0.12, 0.9); };            // one earned star (pitch rises star by star)
  V.newbest = (k, d, t, p) => { [587.3, 740, 880, 1174.7].forEach((f, i) => { k.tone(d, 'triangle', f, f, t + i * 0.09, 0.4, 0.2, 0.004); k.tone(d, 'sine', f * 2, f * 2, t + i * 0.09, 0.25, 0.06, 0.004); }); for (const f of [880, 1174.7, 1480]) bell(k, d, t + 0.45, f, 0.1, 1.8); };
  V.retire = (k, d, t, p) => { bell(k, d, t, 146.8, 0.35, 2.8); k.tone(d, 'sawtooth', 73.4, 55, t + 0.2, 2.2, 0.12, 0.5, { lp: 350 }); };                                                                // endless run banked: a quiet low bell, not a defeat
  V.dice = (k, d, t, p) => { for (let i = 0; i < 6; i++) k.noise(d, t + i * 0.05 + rnd(0, 0.02), 0.03, 0.25, { f0: rnd(900, 2400) * p.pitch, q: 3 }); k.tone(d, 'sine', 300, 200, t + 0.3, 0.08, 0.15); };   // the sandbox's random seed

  /* per-voice behaviour: [min seconds between plays, volume, rough length in s, random pitch spread, floor gain when positional] */
  const DEFAULT = [0.05, 0.8, 0.6, 0.08, 0];
  const DEF = {
    click: [0.03, 0.8, 0.1], tag: [0.05, 0.8, 0.1], untag: [0.05, 0.8, 0.1], deny: [0.15, 0.8, 0.35], build: [0.12, 0.9, 0.5], pickup: [0.1, 0.7, 0.25], drop: [0.1, 0.7, 0.25], train: [0.4, 0.7, 0.3, 0.1],
    sword: [0.045, 1, 0.3, 0.12], clank: [0.1, 0.8, 0.3], bite: [0.05, 1, 0.2], club: [0.06, 1, 0.3], bow: [0.06, 0.8, 0.25], arrow_hit: [0.05, 0.9, 0.2], magic: [0.06, 0.8, 0.4], magic_hit: [0.06, 0.9, 0.3],
    heart_hit: [0.15, 1, 0.6, 0.05, 0.4], ko: [0.15, 0.9, 0.8], death: [0.1, 0.9, 0.8, 0.1], levelup: [0.3, 0.8, 1.2],
    lightning: [0.15, 1, 1, 0.06, 0.15], gas: [0.3, 0.8, 1.8], heal: [0.2, 0.8, 0.8], haste: [0.3, 0.8, 0.8], rally: [0.5, 0.9, 1.6], imp_spawn: [0.2, 0.7, 0.3],
    dig: [0.1, 0.7, 0.2, 0.15], mine: [0.1, 0.8, 0.4, 0.15], crumble: [0.2, 0.8, 0.9], claim: [0.15, 0.6, 0.5], coin: [0.08, 0.7, 0.4], coins: [0.15, 0.8, 0.7], payday: [0.5, 0.9, 1.4],
    door_hit: [0.08, 1, 0.3], door_break: [0.2, 1, 1, 0.05, 0.25],
    chime: [0.3, 0.7, 2.8, 0.05], cluck: [0.25, 0.6, 0.5, 0.12], squawk: [0.3, 0.7, 0.8, 0.1], imp: [0.15, 0.6, 0.6, 0.2], imp_scream: [0.2, 0.7, 0.5, 0.1], munch: [0.3, 0.7, 0.5],
    portal: [0.5, 0.8, 1.4], convert: [0.5, 0.8, 1.4], research: [1, 0.9, 2.2],
    gong: [0.5, 0.9, 4], horn: [1, 0.9, 2.4], boss_horn: [1, 1, 4], victory: [1, 1, 4], defeat: [1, 1, 5],
    objective: [0.3, 0.8, 1.4], guide: [0.2, 0.6, 0.8], scroll: [0.5, 0.8, 0.9], begin: [1, 0.9, 1.8], star: [0.1, 0.8, 1, 0], newbest: [1, 0.9, 2.4], retire: [1, 0.9, 3], dice: [0.2, 0.7, 0.4, 0.1],
  };

  /* ---------------------------------------------------------------- the score */
  const CALM = [[38, 45, 50, 53], [34, 46, 50, 53], [43, 50, 53, 58], [39, 46, 51, 55], [38, 45, 52, 57]];     // Dm, Bb, Gm7, Eb (phrygian), Dsus
  const TENSE = [[38, 44, 50, 53], [38, 39, 45, 50], [39, 45, 51, 57], [38, 45, 51, 56]];                     // tritones and minor seconds
  const BOSS = [[38, 45, 50, 57, 62], [34, 41, 46, 53, 58], [43, 50, 55, 58, 62], [39, 46, 51, 58, 63]];
  const BELLS = [62, 63, 65, 67, 69, 70, 72, 74, 75, 77];                                                       // D phrygian over two octaves
  const OSTI = [1, 0, 0.6, 0.6, 1, 0, 0.6, 0.8], DRUMS = [1, 0, 0.55, 0, 1, 0, 0.5, 0.7];

  /* Layers: a drone and slow pads that never stop; sparse bells while calm; a heartbeat and a driving bass pulse as heroes
   * close in (tension 0..1, also quickens the tempo from ~52 to ~100 bpm); brass, choir and timpani on top for boss waves.
   * Tension is eased: it climbs in a few seconds and takes ~25 s to drain, so a fight ends with a long exhale. */
  class Music {
    constructor(E) {
      this.E = E; this.ctx = E.ctx; this.k = E.k; this.out = E.musicBus;
      this.target = { tension: 0, boss: 0 }; this.cur = { tension: 0, boss: 0 };
      this.b = 0; this.chord = 0; this.nextT = this.ctx.currentTime + 0.15; this.timer = null; this.lastTick = 0;
      this.buildDrone();
    }
    buildDrone() {
      const c = this.ctx, now = c.currentTime, lp = c.createBiquadFilter(), g = c.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 2.5; g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.5, now + 6);
      lp.connect(g); g.connect(this.out);
      const mk = (type, f, det, vol) => { const o = c.createOscillator(), og = c.createGain(); o.type = type; o.frequency.value = f; o.detune.value = det; og.gain.value = vol; o.connect(og); og.connect(lp); o.start(now); return og; };
      mk('sawtooth', 36.71, -6, 0.08); mk('sawtooth', 36.71, 7, 0.08); mk('sine', 36.71, 0, 0.14);
      this.fifth = mk('sawtooth', 55, 0, 0);                              // A1: fades in with tension
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.045; lg.gain.value = 60; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(now);
      this.lp = lp; this.droneG = g;
    }
    applyMood(snap) {
      const { tension: t, boss: b } = this.cur, now = this.ctx.currentTime, f = 110 + 520 * t + 300 * b, fg = 0.1 * t;
      if (snap) { this.lp.frequency.value = f; this.fifth.gain.value = fg; }
      else { this.lp.frequency.setTargetAtTime(f, now, 1.2); this.fifth.gain.setTargetAtTime(fg, now, 1.5); }
    }
    setMood(m) { this.target.tension = m.tension || 0; this.target.boss = m.boss || 0; }
    snap() { this.cur.tension = this.target.tension; this.cur.boss = this.target.boss; this.applyMood(true); }
    ease(dt) {
      const go = (v, to, up, down) => to > v ? Math.min(to, v + up * dt) : Math.max(to, v - down * dt);
      this.cur.tension = go(this.cur.tension, this.target.tension, 0.35, 0.04); this.cur.boss = go(this.cur.boss, this.target.boss, 0.5, 0.1);
      this.applyMood(false);
    }
    start() { this.lastTick = performance.now(); this.timer = setInterval(() => this.tick(), 200); }
    stop() { clearInterval(this.timer); this.timer = null; }
    tick() {
      const now = performance.now(); this.ease(Math.min(1, (now - this.lastTick) / 1000)); this.lastTick = now;
      const c = this.ctx.currentTime; if (this.nextT < c - 0.5) this.nextT = c + 0.1;       // after a stall, don't replay the backlog
      this.run(c + 1.6);
    }
    beatLen() { return 1.15 - 0.6 * this.cur.tension - 0.1 * this.cur.boss; }
    run(until) { while (this.nextT < until) { const bl = this.beatLen(); this.beat(this.nextT, bl); this.nextT += bl; this.b++; } }
    beat(t, bl) {
      const m = this.cur, b = this.b;
      if (b % 8 === 0) this.pad(t, bl);
      if (m.boss > 0.5 && b % 8 === 0) this.brass(t, bl);
      if (m.boss > 0.5 && b % 16 === 4) this.choir(t, bl);
      if (m.tension > 0.12) { const v = 0.2 + 0.9 * m.tension; this.thump(t, v); this.thump(t + bl * 0.3, v * 0.6); }
      if (m.tension > 0.45) this.ostinato(t, bl, m.tension);
      if (m.boss > 0.3) for (let h = 0; h < 2; h++) { const v = DRUMS[(b * 2 + h) % 8]; if (v) timp(this.k, this.out, t + h * bl * 0.5, v * 0.9 * m.boss); }
      if (b % 2 === 0 && Math.random() < 0.22 * (1 - 0.75 * m.tension)) this.bell(t + Math.random() * bl * 0.5);
      if (m.tension > 0.6 && Math.random() < 0.12) this.sting(t);
    }
    pad(t, bl) {
      const c = this.ctx, ten = this.cur.tension, pool = ten > 0.55 ? TENSE : CALM;
      this.chord = (this.chord + 1 + ((Math.random() * (pool.length - 1)) | 0)) % pool.length;
      const dur = 8 * bl, att = Math.min(3, dur * 0.35), rel = Math.min(4, dur * 0.5), vol = 0.045 * (1 - 0.25 * ten);
      const g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 450 + 900 * ten; lp.Q.value = 0.7;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + att); g.gain.setValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + rel);
      lp.connect(g); g.connect(this.out);
      for (const n of pool[this.chord]) for (const det of [-9, 8]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + rel + 0.1); }
    }
    brass(t, bl) {
      const c = this.ctx, boss = this.cur.boss, dur = 8 * bl, notes = BOSS[(this.b / 8 | 0) % BOSS.length];
      const g = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1;
      lp.frequency.setValueAtTime(250, t); lp.frequency.exponentialRampToValueAtTime(1700, t + dur * 0.4); lp.frequency.exponentialRampToValueAtTime(400, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09 * boss, t + dur * 0.35); g.gain.linearRampToValueAtTime(0, t + dur);
      lp.connect(g); g.connect(this.out);
      for (const n of notes) for (const det of [-10, 10]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det; o.connect(lp); o.start(t); o.stop(t + dur + 0.1); }
    }
    choir(t, bl) {                                                       // sawtooth through two vowel formants
      const c = this.ctx, dur = 6 * bl, g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07 * this.cur.boss, t + 1.8); g.gain.linearRampToValueAtTime(0, t + dur); g.connect(this.out);
      for (const [f, q] of [[700, 6], [1150, 8]]) {
        const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; bp.connect(g);
        for (const n of [62, 65, 69]) for (const det of [-7, 7]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det; o.connect(bp); o.start(t); o.stop(t + dur + 0.1); }
      }
    }
    thump(t, v) { this.k.tone(this.out, 'sine', 84, 36, t, 0.24, v, 0.004); this.k.noise(this.out, t, 0.08, v * 0.35, { type: 'lowpass', f0: 180, q: 0.7 }); }
    ostinato(t, bl, ten) {
      for (let h = 0; h < 2; h++) {
        const i = (this.b * 2 + h) % 8, v = OSTI[i]; if (!v) continue;
        const n = ten > 0.75 && i === 6 ? 44 : ten > 0.6 && i === 3 ? 39 : 38;                         // tritone and flat second add pressure
        this.k.tone(this.out, 'sawtooth', hz(n), hz(n), t + h * bl * 0.5, 0.2, 0.3 * ten * v, 0.005, { lp: 200 + 800 * ten });
      }
    }
    bell(t) { const f = hz(pick(BELLS)); this.k.tone(this.out, 'sine', f, f, t, 3.2, 0.05, 0.01); this.k.tone(this.out, 'sine', f * 2.76, f * 2.76, t, 1.2, 0.012, 0.005); this.k.tone(this.out, 'sine', f * 1.003, f * 1.003, t, 2.6, 0.03, 0.01); }
    sting(t) { for (const m of [80, 81]) this.k.tone(this.out, 'sawtooth', hz(m), hz(m), t, 1.6, 0.02, 0.6, { lp: 3000 }); }
  }

  /* ---------------------------------------------------------------- the engine: bus graph for one AudioContext */
  function createEngine(ctx) {
    const E = { ctx, k: toolkit(ctx), samples: {}, last: {}, live: [] };
    const master = E.master = ctx.createGain(), comp = ctx.createDynamicsCompressor(), an = E.analyser = ctx.createAnalyser();
    comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2; an.fftSize = 1024;
    master.connect(comp); comp.connect(ctx.destination); comp.connect(an);
    E.sfxBus = ctx.createGain(); E.sfxBus.gain.value = 0.9; E.sfxBus.connect(master);
    E.musicBus = ctx.createGain(); E.musicBus.gain.value = 0.5; E.musicBus.connect(master);
    // dark hall reverb: generated noise tail, no impulse files
    const len = Math.floor(ctx.sampleRate * 2.8), ir = ctx.createBuffer(2, len, ctx.sampleRate), conv = ctx.createConvolver(), wet = ctx.createGain();
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.35; d[i] = lp * Math.pow(1 - i / len, 3.2); } }
    conv.buffer = ir; wet.gain.value = 0.8; conv.connect(wet); wet.connect(master);
    const sendS = ctx.createGain(), sendM = ctx.createGain(); sendS.gain.value = 0.18; sendM.gain.value = 0.45;
    E.sfxBus.connect(sendS); sendS.connect(conv); E.musicBus.connect(sendM); sendM.connect(conv);

    E.setLevel = (v, muted) => { master.gain.setTargetAtTime(muted ? 0 : v * v, ctx.currentTime, 0.03); };
    E.setMix = (sfx, music) => { E.sfxBus.gain.setTargetAtTime(0.9 * sfx * sfx, ctx.currentTime, 0.03); E.musicBus.gain.setTargetAtTime(0.5 * music * music, ctx.currentTime, 0.03); };     // per-category level, squared like the master
    E.play = (id, x, y, o) => {
      o = o || {}; const def = DEF[id] || DEFAULT, now = ctx.currentTime;
      let g = def[1] * (o.vol || 1), pan = 0;
      if (x !== undefined && L.on) { const gd = Sound.gainAt(x, y); if (gd <= 0) return false; g *= Math.max(gd, def[4] || 0); pan = Math.max(-0.8, Math.min(0.8, ((x - L.x) * L.rx + (y - L.y) * L.ry) / (L.ref * 1.5))); }
      if (g < 0.015 || now - (E.last[id] === undefined ? -9 : E.last[id]) < def[0]) return false;
      E.live = E.live.filter(e => e > now); if (E.live.length >= 48 && def[2] < 1) return false;       // voice cap; long big-moment sounds always go through
      E.last[id] = now; E.live.push(now + def[2]);
      const vg = ctx.createGain(), pn = ctx.createStereoPanner(), t = now + 0.005; vg.gain.value = g; pn.pan.value = pan; vg.connect(pn); pn.connect(E.sfxBus);
      const pitch = (o.pitch || 1) * (1 + (Math.random() - 0.5) * (def[3] === undefined ? DEFAULT[3] : def[3])), sm = E.samples[id];
      if (sm) {
        const src = ctx.createBufferSource(), pg = ctx.createGain(); src.buffer = pick(sm.bufs); src.playbackRate.value = pitch * rnd(sm.rate[0], sm.rate[1]); pg.gain.value = sm.gain; src.connect(pg); pg.connect(vg); src.start(t);
      } else if (Sound.voices[id]) Sound.voices[id](E.k, vg, t, { pitch });
      else return false;
      return true;
    };
    E.music = new Music(E);
    return E;
  }

  /* ---------------------------------------------------------------- public facade */
  const L = { on: false, x: 0, y: 0, ref: 8, rx: 1, ry: 0 };                                     // listener
  const store = { get() { try { return JSON.parse(localStorage.getItem('dm.audio')) || {}; } catch (e) { return {}; } }, set(v) { try { localStorage.setItem('dm.audio', JSON.stringify(v)); } catch (e) { /* private window */ } } };
  const saved = store.get();
  const Sound = window.Sound = {
    engine: null, voices: V, DEF, stats: { requested: {}, played: {} }, failed: false, over: null,
    volume: typeof saved.vol === 'number' ? saved.vol : 0.7, muted: !!saved.mute, createEngine,
    musicVolume: typeof saved.music === 'number' ? saved.music : 1, sfxVolume: typeof saved.sfx === 'number' ? saved.sfx : 1,
    get ctx() { return this.engine && this.engine.ctx; },
    /* Start audio. Called by the first pointerdown / keydown, because browsers refuse to make sound before a gesture. */
    unlock() {
      if (this.engine || this.failed) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) throw new Error('WebAudio unsupported');
        const E = this.engine = createEngine(new AC()); E.ctx.resume(); E.setLevel(this.volume, this.muted); E.setMix(this.sfxVolume, this.musicVolume); E.music.start();
        document.addEventListener('visibilitychange', () => { if (document.hidden) E.ctx.suspend(); else E.ctx.resume(); });
        this.loadPack(); hud.refresh();
      } catch (err) { this.failed = true; console.warn('Sound unavailable:', err); hud.refresh(); }
    },
    play(id, x, y, o) {
      this.stats.requested[id] = (this.stats.requested[id] || 0) + 1;
      try { if (this.engine && this.engine.play(id, x, y, o)) this.stats.played[id] = (this.stats.played[id] || 0) + 1; }
      catch (err) { if (!this.warned) { this.warned = true; console.warn('Sound.play failed (the game carries on):', err); } }       // audio must never be able to stop the game loop
    },
    /* Listener = the 3D camera's ground point; (rx, ry) is the screen-right direction on the map, for stereo pan. 0.28 x camera
     * distance is the half-loudness radius, so zooming out lets you hear more of the dungeon. */
    setListener(x, y, ref, rx, ry) { L.on = true; L.x = x; L.y = y; L.ref = ref; L.rx = rx; L.ry = ry; },
    gainAt(x, y) { if (!L.on) return 1; const d = Math.hypot(x - L.x, y - L.y), g = 1 / (1 + (d / L.ref) * (d / L.ref)); return g < 0.04 ? 0 : g; },
    setMood(m) {
      if (!this.engine) return; this.engine.music.setMood(m);
      if (m.over && m.over !== this.over) { this.over = m.over; this.play(m.over === 'victory' ? 'victory' : m.over === 'retired' ? 'retire' : 'defeat'); }
    },
    stinger(kind) { this.play(kind === 'boss' ? 'boss_horn' : 'horn'); },
    setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); if (this.engine) this.engine.setLevel(this.volume, this.muted); this.save(); },
    setMusicVolume(v) { this.musicVolume = Math.max(0, Math.min(1, v)); if (this.engine) this.engine.setMix(this.sfxVolume, this.musicVolume); this.save(); },
    setSfxVolume(v) { this.sfxVolume = Math.max(0, Math.min(1, v)); if (this.engine) this.engine.setMix(this.sfxVolume, this.musicVolume); this.save(); },
    setMuted(m) { this.muted = !!m; if (this.engine) this.engine.setLevel(this.volume, this.muted); this.save(); hud.refresh(); },
    toggleMute() { this.setMuted(!this.muted); },
    save() { store.set({ vol: this.volume, mute: this.muted, music: this.musicVolume, sfx: this.sfxVolume }); },
    /* RMS of what is leaving the master bus right now (for tests). */
    level() { const E = this.engine; if (!E) return 0; const a = new Float32Array(E.analyser.fftSize); E.analyser.getFloatTimeDomainData(a); let s = 0; for (const v of a) s += v * v; return Math.sqrt(s / a.length); },
    /* Real recordings: assets/audio/sounds.json maps a voice id to a file, a list of files or {files, gain, rate:[lo,hi]}; paths are
     * relative to the manifest. Loaded voices replace the synthesised ones of the same id. An empty manifest ({}) keeps all synth. */
    async loadPack(url) {
      const E = this.engine; if (!E) return 0; url = url || 'assets/audio/sounds.json'; let man, n = 0;
      try { const r = await fetch(url); if (!r.ok) return 0; man = await r.json(); } catch (e) { return 0; }
      const base = new URL(url, location.href);
      for (const [id, v] of Object.entries(man)) {
        if (id[0] === '_') continue; const spec = (typeof v === 'string' || Array.isArray(v)) ? { files: [].concat(v) } : v, bufs = [];
        for (const f of spec.files || []) { try { bufs.push(await E.ctx.decodeAudioData(await (await fetch(new URL(f, base))).arrayBuffer())); } catch (e) { console.warn('sound pack: could not load', f); } }
        if (bufs.length) { E.samples[id] = { bufs, gain: spec.gain || 1, rate: spec.rate || [0.95, 1.05] }; n++; }
      }
      return n;
    },
    /* Offline rendering, used by the tests: one voice as mono samples, or the music at a fixed mood as [left, right]. */
    async renderVoice(id, secs, rate) {
      rate = rate || 44100; const oc = new OfflineAudioContext(1, Math.floor(rate * (secs || 3)), rate), g = oc.createGain(); g.connect(oc.destination);
      V[id](toolkit(oc), g, 0.05, { pitch: 1 }); return (await oc.startRendering()).getChannelData(0);
    },
    async renderMusic(mood, secs, rate) {
      rate = rate || 32000; const oc = new OfflineAudioContext(2, Math.floor(rate * secs), rate), E = createEngine(oc);
      E.setLevel(1, false); E.master.gain.value = 1; E.music.setMood(mood); E.music.snap(); E.music.run(secs); const b = await oc.startRendering();
      return [b.getChannelData(0), b.getChannelData(1)];
    },
  };

  /* ---------------------------------------------------------------- HUD: mute button, volume slider, unlock on first gesture */
  const $ = (id) => document.getElementById(id), btn = $('bMute'), vol = $('vol'), mus = $('musVol'), fx = $('sfxVol'), hint = $('audioHint');
  const hud = {
    refresh() {
      if (!btn) return;
      btn.textContent = Sound.muted || Sound.volume === 0 ? '🔇' : Sound.volume < 0.4 ? '🔈' : '🔊'; btn.classList.toggle('on', Sound.muted);
      vol.value = Math.round(Sound.volume * 100); mus.value = Math.round(Sound.musicVolume * 100); fx.value = Math.round(Sound.sfxVolume * 100);
      hint.textContent = Sound.failed ? 'sound unavailable' : Sound.engine ? '' : 'click anywhere to start sound';
    },
  };
  if (btn) {
    btn.onclick = () => Sound.toggleMute();
    vol.oninput = () => { Sound.setVolume(vol.value / 100); if (Sound.muted && vol.value > 0) Sound.setMuted(false); hud.refresh(); };
    mus.oninput = () => Sound.setMusicVolume(mus.value / 100); fx.oninput = () => Sound.setSfxVolume(fx.value / 100);
    for (const s of [vol, mus, fx]) s.onchange = () => s.blur();                                   // keep WASD / hotkeys working after a drag
  }
  hud.refresh();
  const first = () => { Sound.unlock(); removeEventListener('pointerdown', first); removeEventListener('keydown', first); };
  addEventListener('pointerdown', first); addEventListener('keydown', first);
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button') && e.target.id !== 'bMute' && !e.target.closest('[aria-disabled="true"]')) Sound.play('click'); });
  addEventListener('keydown', e => { if (e.key.toLowerCase() === 'm' && e.target.tagName !== 'INPUT' && !e.ctrlKey && !e.metaKey && !e.altKey) Sound.toggleMute(); });
})();
