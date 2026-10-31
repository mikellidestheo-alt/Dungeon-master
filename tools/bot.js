/* A scripted player for the campaign chapters. It runs inside the game page (tools/test_bots.js injects it) and plays through the public
 * API of window.__game, thinking once per game second and then stepping the simulation 20 times. It never uses randomness, so a run is
 * decided by the chapter and the seed alone.
 *
 *   const bot = window.makeBot('steady');      // or 'lazy'
 *   const result = bot.run(3000);              // plays until the level is over, or the waves are all beaten, or 3000 game seconds
 *
 * 'steady' plays the way a sensible newcomer would: it digs to the gold and the Portal, builds the rooms the chapter asks for (and a
 * Hatchery, because creatures starve without one), raises an army, researches what the objectives want, prepares a tunnel to the
 * Hero Gate but leaves the last tile undug, lines it with doors and traps, and only then opens it. It keeps a bed and food ahead of its army
 * (the Portal waits when either runs out), adds the rooms that draw stronger creatures (a Library from chapter 4, a Temple from chapter 7) and, from
 * chapter 5, a Training Room so its creatures level up. In battle it casts Lightning, Heal
 * and Call to Arms. 'lazy' does the least that starts the invasion: a Treasury, a small Lair, the Portal, and a tunnel to the Gate at
 * once. It exists to prove that a chapter is not won by doing nothing.
 */
(function () {
  window.makeBot = function (skill) {
    const g = window.__game, G = g.G, T = g.T, W = g.W, H = g.H, TR = g.TERRAIN, LV = g.LV, steady = skill !== 'lazy';
    const idx = (x, y) => y * W + x, at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? G.map[idx(x, y)] : null);
    const ROOM = { treasury: T.TREASURY, lair: T.LAIR, library: T.LIBRARY, hatchery: T.HATCHERY, temple: T.TEMPLE, prison: T.PRISON, torture: T.TORTURE, training: T.TRAINING };
    const isOpen = (t) => t && !TR[t.t].solid, diggable = (t) => t && (t.t === T.EARTH || t.t === T.GOLD);
    const objs = LV.objectives || [{ type: 'survive' }], obj = (type, key, val) => objs.filter(o => o.type === type && (key === undefined || o[key] === val));
    const need = (type, key, val, req) => Math.max(0, ...obj(type, key, val).filter(o => !req || !o.optional).map(o => o.n || 1));        // the biggest n any objective asks for (req: required ones only)
    const chapter = Math.max(0, (g.CAMPAIGN || []).indexOf(LV.id));       // 0-based place in the campaign (other levels count as the first)
    const heart = () => ({ x: G.heart.x + 0.5, y: G.heart.y + 0.5 });
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    /* cheapest way through the rock from anything of ours to a goal: open floor is nearly free, earth and gold cost one dig, rock and gems block */
    function route(isGoal) {
      const cost = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), done = new Uint8Array(W * H), open = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = at(x, y); if (t.owner === 1 && isOpen(t)) { cost[idx(x, y)] = 0; open.push(idx(x, y)); } }
      let goal = -1;
      for (;;) {
        let best = -1, bc = Infinity; for (let i = 0; i < W * H; i++) if (!done[i] && cost[i] < bc) { bc = cost[i]; best = i; }
        if (best < 0) return null; done[best] = 1; const x = best % W, y = (best / W) | 0; if (isGoal(at(x, y), x, y)) { goal = best; break; }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, t = at(nx, ny); if (!t) continue; const w = isOpen(t) ? (t.owner === 2 && !isGoal(t, nx, ny) ? Infinity : 0.05) : diggable(t) ? 1 : Infinity; if (w === Infinity) continue;      // hero land is a wall unless it is where we are going
          const ni = idx(nx, ny); if (bc + w < cost[ni]) { cost[ni] = bc + w; from[ni] = best; }
        }
      }
      const cells = []; for (let i = goal; i >= 0; i = from[i]) cells.push([i % W, (i / W) | 0]); cells.reverse();
      return { cells, digs: cells.filter(([x, y]) => diggable(at(x, y))), cost: cost[goal] };
    }
    const tag = (cells) => { for (const [x, y] of cells) g.tagRect(x, y, x, y, true); };

    /* ---- state ---- */
    const unshift = G.log.unshift.bind(G.log);                                  // listen to the chronicle: it is where the game says who fell, who left, what broke
    G.log.unshift = (m) => { if (/has fallen!/.test(m)) S.fell++; else if (/furious and leaves/.test(m)) S.left++; else if (/An imp was slain/.test(m)) S.imps++; else if (/door was/i.test(m)) S.doorsLost++; return unshift(m); };
    const S = { fell: 0, left: 0, imps: 0, doorsLost: 0, seen: new Set(), minHeart: G.heartHp, portalTagged: false, routes: null, plugged: false, linked: false, nextThink: 0, expanded: 0, tried: {}, lastSeam: -99 };
    const ready = () => objs.every((o, i) => o.optional || o.type === 'gate' || o.type === 'survive' || G.objDone[i]);

    function claimedFree(excl) {                    // our bare floor that no room, door or trap is using, nearest the Heart first
      const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = at(x, y); if (t.t === T.PATH && t.owner === 1 && !t.door && !t.trap && !(excl && excl.has(idx(x, y)))) out.push([x, y]); }
      const h = heart(); return out.sort((a, b) => dist({ x: a[0] + .5, y: a[1] + .5 }, h) - dist({ x: b[0] + .5, y: b[1] + .5 }, h));
    }
    const count = (id) => { let n = 0; for (const t of G.map) if (t.t === id && t.owner === 1) n++; return n; };
    const reserved = () => { const s = new Set(); if (S.routes) for (const r of S.routes) { for (const [x, y] of r.cells) s.add(idx(x, y)); if (steady) for (const [x, y] of heroPath(G.gates[r.gate], r)) s.add(idx(x, y)); } return s; };      // tunnel and approach stay free for doors and traps

    function wantRooms() {
      const c = G.creatures.length, w = {}, V = g.VAR;
      w.treasury = Math.max(2, steady ? 2 + Math.ceil(c / 4) : 2);
      w.lair = steady ? Math.min(16, Math.max(need('room', 'room', 'lair'), c + 2)) : 3;          // a bed for everyone, and one ahead: the Portal waits when every bed is taken
      if (!steady) return w;
      w.hatchery = c >= 3 || need('room', 'room', 'hatchery') ? Math.min(7, Math.max(need('room', 'room', 'hatchery'), 1 + Math.ceil(Math.max(0, c + 2 - V.FREE_FEED) / V.FEED_PER_HATCHERY_TILE))) : 0;      // food for everyone too: 3 from the larder, 4 a tile
      for (const r of ['library', 'prison', 'torture', 'temple']) w[r] = need('room', 'room', r);
      /* what a sensible player adds once the basics stand: the rooms that draw stronger creatures through the Portal (the Monsters tab lists what each kind needs), and a Training Room */
      if (c >= 3 && chapter >= 3) w.library = Math.max(w.library, 3);                              // Warlocks and Dark Elves
      if (c >= 3 && chapter >= 6 && g.isAvail('temple')) w.temple = Math.max(w.temple, 3);         // Vampires and Dark Angels
      w.training = c >= 2 && (chapter >= 4 || need("level") > 0) ? Math.min(6, 2 + Math.floor(c / 2)) : 0;
      return w;
    }
    function buildRooms() {
      const w = wantRooms(), order = ['treasury', 'lair', 'hatchery', 'library', 'prison', 'torture', 'temple', 'training'], ex = reserved();
      for (const r of order) {
        const have = count(ROOM[r]), want = w[r] || 0; if (have >= want) continue;
        const free = claimedFree(ex), cost = TR[ROOM[r]].cost; let n = Math.min(want - have, free.length, Math.floor((G.gold - 60) / cost)); if (r === 'treasury' && have === 0) n = Math.min(want, free.length);
        for (let i = 0; i < n; i++) g.build(ROOM[r], free[i][0], free[i][1], free[i][0], free[i][1]);
        if (want - have > free.length && S.expanded < 6 && G.time - (S.lastExpand || -99) > 30) expand();
      }
    }
    function expand() {                              // out of floor: dig out the nearest tiles round the Heart
      S.expanded++; S.lastExpand = G.time; const h = heart(), ex = reserved(), cand = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const t = at(x, y); if (diggable(t) && !t.tag && !ex.has(idx(x, y)) && dist({ x: x + .5, y: y + .5 }, h) < 10) cand.push([x, y]); }
      cand.sort((a, b) => dist({ x: a[0] + .5, y: a[1] + .5 }, h) - dist({ x: b[0] + .5, y: b[1] + .5 }, h)); tag(cand.slice(0, 14));
    }

    function economy() {
      if (!S.portalTagged && G.time > 2) { const r = route((t) => t.t === T.PORTAL); if (r) { tag(r.digs); S.portalTagged = true; } }
      // gold: keep seams being dug while the purse is thin; the more creatures, the more wages. When the seams run out, mine a gem seam (it pays 25 gold a collapse for ever).
      const pending = G.map.filter(t => t.t === T.GOLD && t.tag).length, c = G.creatures.length;
      const low = steady ? (c >= 8 ? 4500 : 2500) : 900, parallel = steady && c >= 8 ? 2 : 1;
      if (pending < parallel && G.gold < low && G.time - S.lastSeam > 10 && G.gold < capacityLeft()) {
        const r = route((t) => t.t === T.GOLD && !t.tag);
        if (r && r.cost < 45) { tag(r.digs); S.lastSeam = G.time; }
        else if (steady && !G.map.some(t => t.t === T.GEM && t.tag)) { const q = route((t) => t.t === T.GEM && !t.tag); if (q && q.cost < 45) { tag(q.cells.filter(([x, y]) => at(x, y).t === T.GEM || diggable(at(x, y)))); S.lastSeam = G.time; } }
      }
    }
    const capacityLeft = () => g.capacity() + 1;       // gold can only be banked up to the Treasury's capacity

    /* ---- the Gate: a tunnel that stops one tile short, doors and traps along it, then the last tile ---- */
    function planGates() {                          // the goal is any floor of that Gate's cavern (the enlarged chapters have a 14 x 14 one)
      if (S.routes || !G.gates.length) return;
      const per = G.gates.map((gt, gi) => { const r = route((t, x, y) => t.owner === 2 && isOpen(t) && Math.abs(x - gt.x) <= 8 && Math.abs(y - gt.y) <= 8); if (r) r.gate = gi; return r; }).filter(Boolean);
      if (!per.length) return;
      const wantBoth = obj('gate').some(o => (o.n || 1) > 1), sorted = per.sort((a, b) => a.cost - b.cost);
      S.routes = wantBoth ? sorted.slice(0, 2) : sorted.slice(0, 1);                       // one front, unless the chapter asks for both Gates
      for (const r of S.routes) { r.plug = r.digs[r.digs.length - 1]; if (steady) tag(r.digs.slice(0, -1)); }
    }
    /* where the heroes will walk once the tunnel is open: open floor plus the planned tunnel, from the Gate to the Heart */
    function heroPath(gt, r) {
      const virt = new Set(r.cells.map(([x, y]) => idx(x, y))), seen = new Int32Array(W * H).fill(-2), q = [idx(gt.x, gt.y)]; seen[q[0]] = -1;
      const hx = G.heart.x, hy = G.heart.y;
      for (let qi = 0; qi < q.length; qi++) {
        const cur = q[qi], x = cur % W, y = (cur / W) | 0; if (x === hx && y === hy) break;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, t = at(nx, ny), ni = idx(nx, ny); if (!t || seen[ni] !== -2 || !(isOpen(t) || virt.has(ni))) continue; seen[ni] = cur; q.push(ni); }
      }
      const out = []; for (let i = idx(hx, hy); i >= 0 && seen[i] !== -2; i = seen[i]) out.push([i % W, (i / W) | 0]);       // Heart first, Gate last
      return out;
    }
    function defences() {
      if (!S.routes) return; const wantDoors = need('doors'), anyTrap = g.isAvail('gas') || g.isAvail('bolt');
      const wantTraps = Math.max(need('traps'), anyTrap ? 4 : 0), wantD = Math.max(wantDoors, anyTrap ? 2 : 0), h = heart();
      S.routes.forEach((r, k) => {
        const path = heroPath(G.gates[r.gate], r).filter(([x, y]) => { const d = dist({ x: x + .5, y: y + .5 }, h); return d > 4.5 && d < 26; });       // the stretch leading into the home cavern
        const per = S.routes.length; let d = 0, tr = 0;
        for (let i = 1; i < path.length; i++) {
          const [x, y] = path[i], t = at(x, y); if (!(t.t === T.PATH && t.owner === 1 && !t.door && !t.trap)) continue;
          if (i === 3 || i === 9) { if (G.doors.length < wantD && d < Math.ceil(wantD / per)) { g.placeThings('door', x, y, x, y); d++; } }
          else if (G.traps.length < wantTraps && tr < Math.ceil(wantTraps / per) && (i % 2 === 0 || i === 1)) { const kind = (G.traps.length % 2 === 0 && g.isAvail('bolt')) || !g.isAvail('gas') ? 'bolt' : 'gas'; if (g.isAvail(kind)) { g.placeThings(kind, x, y, x, y); tr++; } }
        }
      });
    }
    function link() {
      if (S.linked || !S.routes) return; S.linked = true; S.linkedAt = G.time;
      for (const r of S.routes) { if (!steady) tag(r.digs); else if (r.plug) tag([r.plug]); }
    }
    function maybeLink() {
      if (S.linked || !S.routes) return;
      if (!steady) { if (G.stats.claimed >= 4 || G.time > 60) link(); return; }
      const army = Math.max(need('creatures', undefined, undefined, true), Math.min(12, 3 + chapter)),       // a sensible newcomer opens the Gate with an army that grows with the chapter now that the waves come quickly
         defended = G.doors.length + G.traps.length >= Math.min(8, need('doors', undefined, undefined, true) + need('traps', undefined, undefined, true));
      if (ready() && G.creatures.length >= army && defended && G.time > 90) link();
      else if (G.time > 1100) link();                                                    // never wait for ever
    }

    /* ---- research, imps, spells ---- */
    function research() {
      if (!steady || !count(T.LIBRARY)) return;
      const want = obj('research').map(o => o.item).filter(id => !G.research.done[id]); if (want.length && G.research.current !== want[0]) G.research.current = want[0];
    }
    function imps() {                                // imps dig, claim and mend doors, so keep four alive before anything else and six when mana allows
      if (!steady || G.time < 20 || !g.isAvail('imp')) return; const n = G.imps.length;
      if ((n < 4 && G.mana >= 100) || (n < 6 && G.mana >= 260)) g.castSpell('imp', { fx: heart().x, fy: heart().y + 2.5 });
    }
    function battle() {
      if (!steady) return; const h = heart(), foes = G.heroes.filter(x => !x.dead && !x.unconscious), near = foes.filter(x => dist(x, h) < 16);
      if (G.rally && G.time < G.rally.until) { /* already rallied */ }
      else if (near.length >= 3 && g.isAvail('rally') && G.mana >= 400 && !(G.spellCd.rally > 0)) g.castSpell('rally', { fx: h.x, fy: h.y + 3 });
      const strong = near.filter(x => G.creatures.some(c => dist(c, x) < 7)).sort((a, b) => b.hp - a.hp)[0];
      if (strong && g.isAvail('lightning') && G.mana >= 160 && !(G.spellCd.lightning > 0)) g.castSpell('lightning', { fx: strong.x, fy: strong.y });
      const hurt = G.creatures.filter(c => !c.dead && c.hp < c.maxHp * 0.45 && foes.some(x => dist(c, x) < 8));
      if (hurt.length && g.isAvail('heal') && G.mana >= 160 && !(G.spellCd.heal > 0)) g.castSpell('heal', { fx: hurt[0].x, fy: hurt[0].y });
      if (!foes.length && g.isAvail('haste') && need('spells') > G.stats.spells && G.mana >= 700 && !(G.spellCd.haste > 0)) g.castSpell('haste', { fx: h.x, fy: h.y + 2 });      // a bonus objective: cast spells
    }

    function think() {
      for (const c of G.creatures) S.seen.add(c.id); S.minHeart = Math.min(S.minHeart, G.heartHp);
      economy(); buildRooms(); research(); imps();
      if (G.portalOwned || !LV.terrain.grid.join('').includes('P')) planGates();
      if (S.routes) { if (steady) defences(); maybeLink(); }
      battle();
    }

    function run(maxSecs) {
      const t0 = G.time;
      while (G.time - t0 < maxSecs && !G.over) {
        think(); for (let i = 0; i < 20 && !G.over; i++) g.step(0.05);
        if (G.wave >= g.VAR.WAVES && !G.heroes.length && G.heartHp > 0) break;              // every wave beaten (the lazy bot may not have met the objectives)
      }
      const survived = G.wave >= g.VAR.WAVES && !G.heroes.length && G.heartHp > 0;
      const done = Object.keys(G.objDone).length, bonus = objs.filter(o => o.optional).length, bonusDone = objs.filter((o, i) => o.optional && G.objDone[i]).length;
      return { outcome: G.over || (survived ? 'survived' : 'timeout'), time: Math.round(G.time), heart: Math.max(0, G.heartHp) / g.VAR.HEART_HEALTH, minHeart: Math.max(0, S.minHeart) / g.VAR.HEART_HEALTH,
        creatures: G.creatures.length, maxLevel: Math.max(1, ...G.creatures.map(c => c.level)), avgLevel: G.creatures.length ? G.creatures.reduce((t, c) => t + c.level, 0) / G.creatures.length : 1, spawned: S.seen.size, fell: S.fell, left: S.left, impsLost: S.imps, doorsLost: S.doorsLost, kills: G.kills, wave: G.wave, waves: g.VAR.WAVES, objectives: done, of: objs.length, bonusDone, bonus, stars: G.result && G.result.stars,
        linkedAt: S.linked ? Math.round(S.linkedAt) : null, gold: Math.floor(G.gold), traps: G.traps.length, doors: G.doors.length, spells: G.stats.spells, prisoners: G.prisoners.length };
    }
    return { think, run, state: S };
  };
})();
