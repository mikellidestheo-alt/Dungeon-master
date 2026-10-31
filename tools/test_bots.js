#!/usr/bin/env node
/* Balance check: scripted players (tools/bot.js) play every campaign chapter on several seeds, and the numbers say whether each chapter is
 * winnable but not trivial.   node tools/test_bots.js
 *   BOT_SEEDS=8          seeds per chapter and bot (default 8)
 *   BOT_CHAPTERS=1,5,10  only these chapters (numbers 1-10)
 *   BOT_JSON=file.json   also write every result there
 * 'steady' plays like a sensible newcomer; 'lazy' does the least that starts the invasion. The sim is fast (a whole chapter takes a few
 * seconds), so the full matrix (10 chapters x 2 bots x 8 seeds) takes about 80 seconds. See docs/06-levels.md, "Balance".
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 8773, ROOT = `http://localhost:${PORT}/`;
const IDS = ['tutorial', 'portal', 'hatchery', 'library', 'traps', 'prison', 'temple', 'gates', 'siege', 'crusade'];
const SEEDS = parseInt(process.env.BOT_SEEDS || '8', 10), WANT = (process.env.BOT_CHAPTERS || '1,2,3,4,5,6,7,8,9,10').split(',').map(Number);
const TIERS = (process.env.BOT_TIERS || 'steady,lazy').split(',');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '-d', path.join(__dirname, '..', 'web'), String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    await sleep(800);
    const problems = [], jobs = [];
    for (const n of WANT) for (const tier of TIERS) for (let s = 1; s <= SEEDS; s++) jobs.push({ n, id: IDS[n - 1], tier, seed: s });
    const play = async (j) => {
      const page = await (await browser.newContext()).newPage();
      page.on('pageerror', e => problems.push(j.id + ': ' + e)); page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(j.id + ': ' + m.text()); });
      await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });                   // no render loop: the bot alone moves time, so a run depends on chapter and seed only
      await page.goto(`${ROOT}index.html?sound=0&view=2d&nosave=1&guide=0&level=${j.id}&seed=${j.seed}`, { waitUntil: 'load' }); await sleep(300);
      await page.evaluate(() => { window.__game.G.speed = 0; }); await page.addScriptTag({ path: path.join(__dirname, 'bot.js') });
      j.r = await page.evaluate((tier) => window.makeBot(tier).run(3000), j.tier); await page.context().close();
    };
    const queue = jobs.slice(); const workers = Array.from({ length: 4 }, async () => { while (queue.length) await play(queue.shift()); }); await Promise.all(workers);
    if (process.env.BOT_JSON) fs.writeFileSync(process.env.BOT_JSON, JSON.stringify(jobs, null, 1));

    const by = (n, tier) => jobs.filter(j => j.n === n && j.tier === tier).map(j => j.r);
    const pct = (x) => Math.round(x * 100) + '%', mins = (s) => (Math.round(s / 6) / 10).toFixed(1);
    console.log('\n chapter                        steady bot: wins  time(min)  heart min/end  army lvl(max/avg) fell left  bonus  stars |  lazy bot: wins  survived  heart end');
    const sum = {};
    for (const n of WANT) {
      const st = by(n, 'steady'), lz = by(n, 'lazy');
      const row = sum[n] = { steadyWins: st.filter(r => r.outcome === 'victory').length, lazyWins: lz.filter(r => r.outcome === 'victory').length, lazySurv: lz.filter(r => r.outcome === 'victory' || r.outcome === 'survived').length,
        time: mean(st.map(r => r.time)), minHeart: mean(st.map(r => r.minHeart)), lazyHeart: mean(lz.map(r => r.heart)), st, lz };
      console.log(` ${String(n).padStart(2)} ${IDS[n - 1].padEnd(10)} ${' '.repeat(18)} ${row.steadyWins}/${st.length}      ${mins(row.time).padStart(5)}      ${pct(row.minHeart).padStart(4)} / ${pct(mean(st.map(r => r.heart))).padStart(4)}   ${mean(st.map(r => r.creatures)).toFixed(0).padStart(3)} ${(mean(st.map(r => r.maxLevel)).toFixed(0) + '/' + mean(st.map(r => r.avgLevel)).toFixed(1)).padStart(7)} ${mean(st.map(r => r.fell)).toFixed(1).padStart(4)} ${mean(st.map(r => r.left)).toFixed(1).padStart(4)}  ${mean(st.map(r => r.bonusDone)).toFixed(1)}/${st[0] ? st[0].bonus : 0}  ${mean(st.map(r => r.stars || 0)).toFixed(1)}  |   ${row.lazyWins}/${lz.length}    ${row.lazySurv}/${lz.length}    ${pct(row.lazyHeart).padStart(4)}   [${lz.map(r => r.outcome).join(',')}]`);
    }

    /* ---- what we expect. Margins are wide on purpose: the sim is deterministic, but a small change anywhere can move a chapter by a seed or two. ---- */
    const has = (n) => WANT.includes(n), rate = (n) => sum[n].steadyWins / sum[n].st.length, lazySurv = (n) => sum[n].lazySurv / sum[n].lz.length, fell = (n) => mean(sum[n].st.map(r => r.fell + r.left));
    console.log('\nwinnable: the steady bot wins');
    for (const n of WANT) { const lo = n <= 8 ? 0.85 : n === 9 ? 0.375 : 0.25; check(`chapter ${n} ${IDS[n - 1]}: at least ${pct(lo)} of runs won`, rate(n) >= lo, `${sum[n].steadyWins}/${sum[n].st.length}`); }
    console.log('not trivial: doing the least does not win, and the last chapters cost the steady bot dearly');
    for (const n of WANT) {
      if (n >= 2) check(`chapter ${n}: the lazy bot never wins`, sum[n].lazyWins === 0, `${sum[n].lazyWins}/${sum[n].lz.length}`);
      const cap = n <= 3 ? 1 : n <= 5 ? 0.6 : 0.25; if (n >= 4) check(`chapter ${n}: the lazy bot survives at most ${pct(cap)} of the time`, lazySurv(n) <= cap, `${sum[n].lazySurv}/${sum[n].lz.length}`);
    }
    if (has(9) && has(10)) {
      check('chapters 9 and 10 are not a stroll: under 90% / under 80% won', rate(9) <= 0.9 && rate(10) <= 0.8, `${pct(rate(9))} / ${pct(rate(10))}`);
      check('chapters 9 and 10 cost about 8 creatures or more per run', fell(9) >= 8 && fell(10) >= 8, `${fell(9).toFixed(1)} / ${fell(10).toFixed(1)}`);
    }
    if (has(8) && has(10)) check('the finale is harder than chapter 8: it loses more creatures and wins less', fell(10) > fell(8) + 5 && rate(10) < rate(8));
    console.log('length: a fast bot should land inside the chapter\'s target, a first-time human takes longer');
    const window_ = { 1: [1.8, 5],        // chapter 1: the Knight now waits at the Gate, so the 3-minute countdown is gone (it was 4.5-8.5)
       // later windows follow the new wave timers (prep 90 -> 35 s, gap 75 -> 50 s): the chapters are bigger but the first wave comes sooner, so most are a little shorter or equal
      2: [7, 12.5], 3: [9.5, 12.5], 4: [9.5, 14], 5: [11.5, 16], 6: [11.5, 16], 7: [11.5, 16], 8: [15, 22], 9: [15.5, 22.5], 10: [17.5, 28] };
    for (const n of WANT) { const m = mean(sum[n].st.filter(r => r.outcome === 'victory').map(r => r.time)) / 60, [lo, hi] = window_[n]; if (m) check(`chapter ${n}: ${m.toFixed(1)} min is inside ${lo}-${hi}`, m >= lo && m <= hi); }
    if (WANT.length === 10) { const tot = WANT.reduce((a, n) => a + mean(sum[n].st.filter(r => r.outcome === 'victory').map(r => r.time)) / 60, 0); check(`the whole campaign: ${tot.toFixed(0)} min for a fast bot (125-170), so 2.5-3 h for a person`, tot >= 125 && tot <= 170); }
    console.log('stars: the third star is reachable');
    for (const n of WANT) if (n >= 2) { const b = sum[n].st.filter(r => r.outcome === 'victory'); if (n <= 8) check(`chapter ${n}: the steady bot gets the bonus objective in 75% of its wins`, b.filter(r => r.bonusDone >= r.bonus).length >= b.length * 0.75, `${b.filter(r => r.bonusDone >= r.bonus).length}/${b.length}`); else check(`chapter ${n}: the bonus objective is achieved in at least one win`, b.some(r => r.bonusDone >= r.bonus), `${b.filter(r => r.bonusDone >= r.bonus).length}/${b.length}`); }
    // the bot is deterministic: the same chapter and seed twice give the same run
    const again = { n: WANT[WANT.length - 1], id: IDS[WANT[WANT.length - 1] - 1], tier: 'steady', seed: 1 }; await play(again);
    check('a run is reproducible: the same chapter and seed twice give identical results', JSON.stringify(again.r) === JSON.stringify(jobs.find(j => j.n === again.n && j.tier === 'steady' && j.seed === 1).r));
    check('no page errors or warnings in any run', problems.length === 0, problems.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall balance checks passed'); process.exit(fails ? 1 : 0);
})();
