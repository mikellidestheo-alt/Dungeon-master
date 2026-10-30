'use strict';
/* Saved progress and the star rules, shared by the chapter menu (menu.html) and the game (index.html -> game.js).
 * Everything lives in one localStorage key, `dm.save.v1`:
 *   { v: 1, levels: { <levelId>: { stars, bestTime, bestKills, bestHeart, wins, defeats } } }
 * If storage is blocked (private window, quota) progress is kept in memory for the page's life and nothing throws.
 * The star rules are plain data on a level (`stars: { heart, par }`), see docs/06-levels.md. This file never touches the simulation. */
window.Progress = (function () {
  const KEY = 'dm.save.v1';
  let mem = null;
  const blank = () => ({ v: 1, levels: {} });
  function load() {
    try { const j = JSON.parse(localStorage.getItem(KEY)); if (j && j.v === 1 && j.levels && typeof j.levels === 'object') return j; } catch (e) { /* storage blocked or corrupt: fall through */ }
    return mem || blank();
  }
  function save(d) { mem = d; try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* in-memory only */ } }

  const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const pct = (f) => Math.round(f * 100) + '%';

  /* Three stars per chapter, judged when you win:
   *   1  victory
   *   2  the Dungeon Heart still has at least `stars.heart` of its health (default 50%)
   *   3  every bonus (`optional`) objective is done, and the level was won within `stars.par` seconds if it sets one;
   *      a level with neither bonus objectives nor a par time asks for the Heart at 90% instead.
   * `r` = { heart: 0..1, time: seconds, bonusDone, bonusTotal }. Returns { earned, list: [{ ok, text }] }. */
  function stars(rules, r) {
    rules = rules || {}; const hf = rules.heart === undefined ? 0.5 : rules.heart, par = rules.par, hasBonus = r.bonusTotal > 0;
    const list = [{ ok: true, text: 'Win the chapter' }, { ok: r.heart >= hf, text: 'Keep the Heart at ' + pct(hf) + ' or more' }];
    if (hasBonus || par) {
      const parts = []; if (hasBonus) parts.push('complete every bonus objective'); if (par) parts.push('win within ' + fmtTime(par));
      const text = parts.join(' and '); list.push({ ok: (!hasBonus || r.bonusDone >= r.bonusTotal) && (!par || r.time <= par), text: text[0].toUpperCase() + text.slice(1) });
    } else list.push({ ok: r.heart >= 0.9, text: 'Keep the Heart at 90% or more' });
    return { earned: list.filter(x => x.ok).length, list };
  }

  /* Records a finished run. Returns { first, newBest, prev } so the end screen can say "New best!". */
  function record(id, res) {
    const d = load(), prev = d.levels[id] ? { ...d.levels[id] } : null, e = d.levels[id] || (d.levels[id] = { stars: 0, bestTime: null, bestKills: 0, bestHeart: 0, wins: 0, defeats: 0 });
    if (res.outcome !== 'victory') { e.defeats++; save(d); return { first: false, newBest: false, prev }; }
    e.wins++;
    const betterStars = res.stars > e.stars, faster = e.bestTime === null || res.time < e.bestTime;
    e.stars = Math.max(e.stars, res.stars); e.bestTime = faster ? res.time : e.bestTime; e.bestKills = Math.max(e.bestKills, res.kills); e.bestHeart = Math.max(e.bestHeart, res.heart);
    save(d); return { first: !prev || !prev.wins, newBest: !prev || !prev.wins || betterStars || faster, prev };
  }

  const level = (id) => load().levels[id] || null;
  const won = (id) => { const e = level(id); return !!(e && e.wins > 0); };
  /* Chapters unlock in order: the first always, then each one once the one before it has been won. */
  const unlocked = (order, id) => { const i = order.indexOf(id); return i === 0 || (i > 0 && won(order[i - 1])); };
  const next = (order, id) => { const i = order.indexOf(id); return i >= 0 && i + 1 < order.length ? order[i + 1] : null; };
  const totalStars = (order) => order.reduce((n, id) => n + ((level(id) || {}).stars || 0), 0);
  function reset() { mem = null; try { localStorage.removeItem(KEY); } catch (e) { /* nothing to remove */ } }

  return { KEY, stars, record, level, won, unlocked, next, totalStars, reset, fmtTime, pct };
})();
