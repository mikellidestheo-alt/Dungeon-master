/* 3D view of the simulation in game.js, drawn with three.js.
 * It only READS the game state (window.__game.G) and forwards pointer input through window.__ui, the same split
 * OpenKeeper has between game/ (headless sim) and view/ (JME scene graph). Everything here is stand-in geometry:
 * swap the mesh factories (makeImp/makeCreature/makeHero, the instanced tile meshes) when the art style is decided.
 * ?view=2d keeps the old canvas renderer. */
import * as THREE from './vendor/three.module.js';

const params = new URLSearchParams(location.search);
if (params.get('view') !== '2d') {
  try { start(); } catch (err) { console.warn('3D view unavailable, staying on the 2D canvas:', err); window.__render3d = null; }
}

function start() {
  const { G, T, TERRAIN, HERO_LAND, W, H, capacity, VAR, TRAPS, SPELLS } = window.__game, UI = window.__ui;
  const WALL_H = 1.25, ROCK_H = 1.6;

  /* ------------------------------------------------------------------ renderer, scene, camera */
  const stage = document.getElementById('stage'), cv2d = document.getElementById('cv');
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });   // throws without WebGL -> caught above
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  canvas.style.cssText = 'width:100%;display:block;border-radius:6px;touch-action:none;cursor:crosshair';
  cv2d.style.display = 'none'; stage.appendChild(canvas);
  const banner = document.createElement('div');
  banner.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:rgba(0,0,0,.6);border-radius:6px;text-align:center;pointer-events:none';
  stage.appendChild(banner);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0907); scene.fog = new THREE.Fog(0x0b0907, 20, 46);
  const camera = new THREE.PerspectiveCamera(45, 800 / 560, 0.1, 100);
  const cam = { x: G.heart.x + 6, z: G.heart.y + 1, dist: 22, pitch: 58 * Math.PI / 180 };
  function placeCamera() {
    camera.position.set(cam.x, Math.sin(cam.pitch) * cam.dist, cam.z + Math.cos(cam.pitch) * cam.dist);
    camera.lookAt(cam.x, 0, cam.z);
  }
  function resize() {
    const w = stage.clientWidth || 800, h = Math.round(w * 0.7);
    renderer.setSize(w, h, false); canvas.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize(); placeCamera();

  scene.add(new THREE.HemisphereLight(0xb8a890, 0x2a2018, 0.8));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.35); sun.position.set(-6, 14, 5); scene.add(sun);
  const heartLight = new THREE.PointLight(0xff3020, 2.2, 9, 1.6); heartLight.position.set(G.heart.x + .5, 1.3, G.heart.y + .5); scene.add(heartLight);
  const portalLight = new THREE.PointLight(0x9050ff, 0, 9, 1.6); portalLight.position.set(G.portal.x + .5, 1.2, G.portal.y + .5); scene.add(portalLight);
  const gateLight = new THREE.PointLight(0xff6a30, 1.0, 8, 1.6); gateLight.position.set(G.gate.x + .5, 1.2, G.gate.y + .5); scene.add(gateLight);

  /* ------------------------------------------------------------------ tiles (instanced) */
  const N = W * H, dummy = new THREE.Object3D(), col = new THREE.Color();
  const floorGeo = new THREE.PlaneGeometry(1, 1); floorGeo.rotateX(-Math.PI / 2);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
  const lambert = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const floorMesh = new THREE.InstancedMesh(floorGeo, lambert, N), wallMesh = new THREE.InstancedMesh(boxGeo, lambert, N);
  for (const m of [floorMesh, wallMesh]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; scene.add(m); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); }
  const hash = (x, y, k = 0) => { let h = x * 374761393 + y * 668265263 + k * 2246822519; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; };

  const bitGeo = new THREE.BoxGeometry(.13, .13, .13);                      // gold flecks & treasure piles & beds share small instanced meshes
  const goldBits = new THREE.InstancedMesh(bitGeo, new THREE.MeshLambertMaterial({ color: 0xffd040, emissive: 0x4a3200 }), N * 4);
  const gemBits = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.2), new THREE.MeshLambertMaterial({ color: 0x5ee0ff, emissive: 0x104050 }), N);
  const pileGeo = new THREE.BoxGeometry(.7, 1, .7); pileGeo.translate(0, .5, 0);
  const piles = new THREE.InstancedMesh(pileGeo, new THREE.MeshLambertMaterial({ color: 0xf4c430, emissive: 0x3a2800 }), N);
  const bedGeo = new THREE.BoxGeometry(.7, .18, .5); bedGeo.translate(0, .09, 0);
  const beds = new THREE.InstancedMesh(bedGeo, new THREE.MeshLambertMaterial({ color: 0x8a70c0 }), N);
  const tagGeo = new THREE.PlaneGeometry(.7, .7); tagGeo.rotateX(-Math.PI / 2);
  const tags = new THREE.InstancedMesh(tagGeo, new THREE.MeshBasicMaterial({ color: 0xffe070, transparent: true, opacity: .75 }), N);
  const cageGeo = new THREE.BoxGeometry(.84, .75, .84); cageGeo.translate(0, .375, 0);
  const cages = new THREE.InstancedMesh(cageGeo, new THREE.MeshBasicMaterial({ color: 0xb8c0d0, wireframe: true }), N);
  const rackGeo = new THREE.BoxGeometry(.8, .14, .5); rackGeo.translate(0, .2, 0);
  const racks = new THREE.InstancedMesh(rackGeo, new THREE.MeshLambertMaterial({ color: 0x3a2018, emissive: 0x401008 }), N);
  const shelfGeo = new THREE.BoxGeometry(.9, .85, .16); shelfGeo.translate(0, .425, -.38);
  const shelves = new THREE.InstancedMesh(shelfGeo, new THREE.MeshLambertMaterial({ color: 0x6a4424 }), N);
  const bookGeo = new THREE.BoxGeometry(.8, .12, .08); bookGeo.translate(0, .62, -.3);
  const books = new THREE.InstancedMesh(bookGeo, new THREE.MeshLambertMaterial({ color: 0xc04a4a, emissive: 0x301010 }), N);
  const deskGeo = new THREE.BoxGeometry(.5, .3, .36); deskGeo.translate(0, .15, .08);
  const desks = new THREE.InstancedMesh(deskGeo, new THREE.MeshLambertMaterial({ color: 0x8a6a40 }), N);
  for (const m of [goldBits, gemBits, piles, beds, tags, cages, racks, shelves, books, desks]) { m.frustumCulled = false; scene.add(m); }

  const COL = { floor: 0x4a3f33, owned: 0x4b6cc8, hero: 0x8a3a30, earth: 0x7a5636, near: 0xa47c52, rock: 0x2d2b2e, gold: 0x7a5a30, gem: 0x40364a,
    [T.TREASURY]: 0x9a7e28, [T.LAIR]: 0x5a4a8a, [T.HEART]: 0x9a3030, [T.PORTAL]: 0x6a3a9a, [T.GATE]: 0x8a4a32, [T.PRISON]: 0x56606c, [T.TORTURE]: 0x6a2828, [T.LIBRARY]: 0x3e4c78 };
  const tmpOwned = new THREE.Color(COL.owned);
  const ownedFloor = (x, y) => { const t = G.map[y * W + x]; return !!t && t.owner === 1 && !TERRAIN[t.t].solid; };

  function updateTiles() {
    let nGold = 0, nGem = 0, nPile = 0, nBed = 0, nTag = 0, nCage = 0, nRack = 0, nLib = 0;
    const fill = Math.min(1, G.gold / Math.max(1, capacity()));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = G.map[i], tr = TERRAIN[t.t], n = hash(x, y), shade = 0.88 + n * 0.24;
      dummy.rotation.set(0, 0, 0);
      // floor under everything
      dummy.position.set(x + .5, 0, y + .5); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); floorMesh.setMatrixAt(i, dummy.matrix);
      let c = COL.floor;
      if (!tr.solid) {
        c = COL[t.t] ?? COL.floor;
        if (t.t === T.PATH) c = t.owner === 1 ? COL.owned : t.owner === HERO_LAND ? COL.hero : COL.floor;
        if (t.t === T.PATH && t.owner !== 1 && t.hp > 0) c = col.set(COL.floor).lerp(tmpOwned, Math.min(1, t.hp / tr.maxHealth)).getHex();   // claim progress
      }
      floorMesh.setColorAt(i, col.set(c).multiplyScalar(shade));
      // wall block
      let h = 0;
      if (tr.solid) {
        const ratio = t.t === T.ROCK ? 1 : t.t === T.GEM ? 1 : Math.max(0.3, t.hp / tr.maxHealth);   // digging visibly shaves the block down
        h = (t.t === T.ROCK ? ROCK_H : WALL_H) * (t.t === T.ROCK || t.t === T.GEM ? 1 : 0.35 + 0.65 * ratio);
        const near = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && ownedFloor(x + dx, y + dy));
        let wc = t.t === T.ROCK ? COL.rock : t.t === T.GEM ? COL.gem : t.t === T.GOLD ? COL.gold : near ? COL.near : COL.earth;
        wallMesh.setColorAt(i, col.set(wc).multiplyScalar(shade));
        if (t.t === T.GOLD && t.gold > 0) for (let k = 0; k < 4; k++) { dummy.position.set(x + .2 + hash(x, y, k + 1) * .6, h + .02, y + .2 + hash(x, y, k + 9) * .6); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, hash(x, y, k) * 3, 0); dummy.updateMatrix(); goldBits.setMatrixAt(nGold++, dummy.matrix); }
        if (t.t === T.GEM) { dummy.position.set(x + .5, h + .2, y + .5); dummy.scale.set(1, 1.5, 1); dummy.rotation.set(0, G.time * .8 + n * 6, 0); dummy.updateMatrix(); gemBits.setMatrixAt(nGem++, dummy.matrix); }
        if (t.tag) { dummy.position.set(x + .5, h + .03, y + .5); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); tags.setMatrixAt(nTag++, dummy.matrix); }
      } else wallMesh.setColorAt(i, col.set(0));
      dummy.rotation.set(0, 0, 0); dummy.position.set(x + .5, 0, y + .5); if (h > 0) dummy.scale.set(1, h, 1); else dummy.scale.set(0, 0, 0); dummy.updateMatrix(); wallMesh.setMatrixAt(i, dummy.matrix);   // no block on open floor
      if (t.t === T.TREASURY && t.owner === 1) { dummy.position.set(x + .5, 0, y + .5); dummy.scale.set(1, 0.12 + fill * 0.55, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); piles.setMatrixAt(nPile++, dummy.matrix); }
      if (t.t === T.LIBRARY && t.owner === 1) { dummy.position.set(x + .5, 0, y + .5); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); shelves.setMatrixAt(nLib, dummy.matrix); books.setMatrixAt(nLib, dummy.matrix); desks.setMatrixAt(nLib++, dummy.matrix); }
      if (t.t === T.PRISON && t.owner === 1) { dummy.position.set(x + .5, 0, y + .5); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); cages.setMatrixAt(nCage++, dummy.matrix); }
      if (t.t === T.TORTURE && t.owner === 1) { dummy.position.set(x + .5, 0, y + .5); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, (x + y) % 2 ? 0 : Math.PI / 2, 0); dummy.updateMatrix(); racks.setMatrixAt(nRack++, dummy.matrix); }
      if (t.t === T.LAIR && t.owner === 1) { dummy.position.set(x + .5, 0, y + .5); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); beds.setMatrixAt(nBed++, dummy.matrix); }
    }
    for (const [m, c] of [[goldBits, nGold], [gemBits, nGem], [piles, nPile], [beds, nBed], [tags, nTag], [cages, nCage], [racks, nRack], [shelves, nLib], [books, nLib], [desks, nLib]]) { m.count = c; m.instanceMatrix.needsUpdate = true; }
    for (const m of [floorMesh, wallMesh]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }

  /* landmarks: Heart, Portal, Hero Gate */
  const heartMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(.55, 1), new THREE.MeshLambertMaterial({ color: 0xff4a4a, emissive: 0x801010 }));
  heartMesh.position.set(G.heart.x + .5, .9, G.heart.y + .5); scene.add(heartMesh);
  const ringMat = (hex) => new THREE.MeshLambertMaterial({ color: hex, emissive: hex, emissiveIntensity: .35 });
  const portalMesh = new THREE.Mesh(new THREE.TorusGeometry(.8, .12, 10, 28), ringMat(0x8a5ac0)); portalMesh.position.set(G.portal.x + .5, 1.0, G.portal.y + .5); scene.add(portalMesh);
  const gateMesh = new THREE.Mesh(new THREE.TorusGeometry(.8, .12, 10, 28), ringMat(0xff7a40)); gateMesh.position.set(G.gate.x + .5, 1.0, G.gate.y + .5); scene.add(gateMesh);

  /* ------------------------------------------------------------------ units */
  const unitMeshes = new Map();
  const barBg = new THREE.SpriteMaterial({ color: 0x000000, transparent: true, opacity: .75, depthTest: false });
  const barKeeper = new THREE.SpriteMaterial({ color: 0x5fd070, depthTest: false }), barHero = new THREE.SpriteMaterial({ color: 0x5aa0ff, depthTest: false });
  function makeBar(u) {
    const g = new THREE.Group(), bg = new THREE.Sprite(barBg), fg = new THREE.Sprite(u.team === 'h' ? barHero : barKeeper);
    for (const s of [bg, fg]) { s.center.set(0, .5); s.position.x = -.25; s.renderOrder = 10; }
    bg.scale.set(.5, .07, 1); fg.scale.set(.5, .07, 1); g.add(bg, fg); g.userData.fg = fg; g.visible = false; return g;
  }
  function makeUnit(u) {
    const g = new THREE.Group(); let body, mat;
    if (u.isImp) { mat = new THREE.MeshLambertMaterial({ color: 0xd04040 }); body = new THREE.Mesh(new THREE.ConeGeometry(.15, .5, 8), mat); body.position.y = .25; }
    else if (u.team === 'h') {
      mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(u.color) }); body = new THREE.Mesh(new THREE.CylinderGeometry(.15, .19, .6, 10), mat); body.position.y = .3;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.26, .035, 6, 16), new THREE.MeshBasicMaterial({ color: 0x4a90ff })); ring.rotation.x = Math.PI / 2; ring.position.y = .04; g.add(ring);
      if (u.ranged) { const bow = new THREE.Mesh(new THREE.BoxGeometry(.04, .4, .04), new THREE.MeshLambertMaterial({ color: 0x8a6a3a })); bow.position.set(.2, .35, 0); g.add(bow); }
    } else {
      mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(u.color) });
      const sz = u.name === 'Troll' ? .46 : .34; body = new THREE.Mesh(new THREE.BoxGeometry(sz, sz * 1.5, sz), mat); body.position.y = sz * .75;
    }
    const nose = new THREE.Mesh(new THREE.BoxGeometry(.08, .08, .2), new THREE.MeshLambertMaterial({ color: 0xffffff })); nose.position.set(.2, .38, 0); g.add(nose);   // faces +x
    g.add(body); const bar = makeBar(u); bar.position.y = .95; g.add(bar); g.userData = { body, mat, bar, base: mat.color.clone(), sleepZ: null };
    scene.add(g); return g;
  }
  function syncUnits() {
    const all = [...G.imps, ...G.creatures, ...G.heroes, ...G.prisoners], seen = new Set(), mouse = UI.mouse;
    for (const u of all) {
      seen.add(u); let g = unitMeshes.get(u); if (!g) { g = makeUnit(u); unitMeshes.set(u, g); }
      const d = g.userData, held = u.held && mouse.fx !== undefined;
      const bob = u.path || u.state === 'work' ? Math.abs(Math.sin(G.time * 9 + u.x * 3)) * .06 : 0;
      const lying = u.unconscious || u.imprisoned;                                  // knocked-out and jailed units lie flat; carried ones are held up
      g.position.set(held ? mouse.fx : u.x, (held ? 1.4 : 0) + bob + (lying ? (u.carriedBy ? .62 : .14) : 0), held ? mouse.fy : u.y); g.rotation.set(0, -(u.face || 0), lying ? Math.PI / 2 : 0);
      g.scale.setScalar(u.state === 'sleep' ? .8 : 1);
      // colour: flash on hit, imps tint when fleeing, ring pulse while working
      if (d.mat.emissive) d.mat.emissive.set(u.haste > 0 ? 0x2850ff : u.state === 'research' ? 0x7a5a10 : 0x000000);
      if (u.flash > 0) d.mat.color.set(0xffffff); else if (u.isImp && u.state === 'flee') d.mat.color.set(0xff9060); else d.mat.color.copy(d.base);
      if (u.isImp && u.state === 'work') g.scale.setScalar(1 + Math.sin(G.time * 18) * .08);
      const showBar = u.hp < u.maxHp; d.bar.visible = showBar; if (showBar) { const r = Math.max(0.001, u.hp / u.maxHp); d.bar.userData.fg.scale.x = .5 * r; }
    }
    for (const [u, g] of unitMeshes) if (!seen.has(u)) { scene.remove(g); g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (o.material.dispose) o.material.dispose(); } }); unitMeshes.delete(u); }
  }

  /* doors & traps: a few individual meshes keyed by sim object */
  const doorMeshes = new Map(), trapMeshes = new Map();
  const woodMat = () => new THREE.MeshLambertMaterial({ color: 0x8a5a2a });
  function makeDoor(d) {
    const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || TERRAIN[G.map[y * W + x].t].solid;
    const g = new THREE.Group(), ns = wall(d.tx - 1, d.ty) && wall(d.tx + 1, d.ty);       // corridor runs north-south: the slab spans x
    const slab = new THREE.Mesh(new THREE.BoxGeometry(ns ? .96 : .2, 1.05, ns ? .2 : .96), woodMat()); slab.position.y = .525; g.add(slab);
    const band = new THREE.Mesh(new THREE.BoxGeometry(ns ? 1 : .24, .12, ns ? .24 : 1), new THREE.MeshLambertMaterial({ color: 0x3a3a40 })); band.position.y = .6; g.add(band);
    const bar = makeBar({ team: 'k' }); bar.position.y = 1.35; g.add(bar);
    g.position.set(d.x, 0, d.y); g.userData = { slab, bar, open: 0, mat: slab.material }; scene.add(g); return g;
  }
  function makeTrap(tr) {
    const g = new THREE.Group(), c = new THREE.Color(TRAPS[tr.kind].color);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .05, 14), new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: .25 })); disc.position.y = .03; g.add(disc);
    const spike = new THREE.Mesh(tr.kind === 'gas' ? new THREE.CylinderGeometry(.06, .1, .22, 8) : new THREE.ConeGeometry(.12, .3, 4), new THREE.MeshLambertMaterial({ color: 0x303034 })); spike.position.y = .16; g.add(spike);
    const pips = []; for (let i = 0; i < tr.max; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(.05, 6, 6), new THREE.MeshBasicMaterial({ color: c })); p.position.set(-.18 + i * .18, .12, .3); g.add(p); pips.push(p); }
    g.position.set(tr.x, 0, tr.y); g.userData = { disc, pips }; scene.add(g); return g;
  }
  function syncProps() {
    const keep = new Set();
    for (const d of G.doors) {
      keep.add(d); let g = doorMeshes.get(d); if (!g) { g = makeDoor(d); doorMeshes.set(d, g); }
      const near = G.creatures.concat(G.imps).some(u => !u.dead && Math.hypot(u.x - d.x, u.y - d.y) < 1.4), u = g.userData;
      u.open += ((near ? 1 : 0) - u.open) * .25; u.slab.position.y = .525 + u.open * 1.0;                 // raised like a portcullis while a friend passes
      u.mat.color.set(d.flash > 0 ? 0xffffff : 0x8a5a2a);
      u.bar.visible = d.hp < d.maxHp; u.bar.userData.fg.scale.x = .5 * Math.max(.001, d.hp / d.maxHp);
    }
    for (const tr of G.traps) {
      keep.add(tr); let g = trapMeshes.get(tr); if (!g) { g = makeTrap(tr); trapMeshes.set(tr, g); }
      g.userData.pips.forEach((p, i) => p.visible = i < tr.charges); g.userData.disc.material.emissiveIntensity = tr.charges ? .3 : 0;
      g.userData.disc.material.color.set(tr.charges ? TRAPS[tr.kind].color : 0x444444);
    }
    for (const m of [doorMeshes, trapMeshes]) for (const [k, g] of m) if (!keep.has(k)) { scene.remove(g); g.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); m.delete(k); }
  }

  /* shots, damage numbers, blood splats (small pools) */
  const shotPool = [], splatPool = [], numPool = [], boltPool = [], cloudPool = [], ringPool = [], numTex = new Map();
  const ringGeo = new THREE.RingGeometry(.92, 1, 40); ringGeo.rotateX(-Math.PI / 2);
  const boltGeo = new THREE.CylinderGeometry(.05, .05, 3, 6), cloudGeo = new THREE.SphereGeometry(1, 16, 10);
  const shotGeo = new THREE.SphereGeometry(.09, 8, 6), splatGeo = new THREE.CircleGeometry(.3, 14); splatGeo.rotateX(-Math.PI / 2);
  function numberMat(n, color) {
    const key = n + color; let m = numTex.get(key); if (m) return m;
    const c = document.createElement('canvas'); c.width = 64; c.height = 32; const x = c.getContext('2d'); x.font = 'bold 26px sans-serif'; x.textAlign = 'center'; x.lineWidth = 4; x.strokeStyle = '#000'; x.strokeText(n, 32, 25); x.fillStyle = color; x.fillText(n, 32, 25);
    m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }); numTex.set(key, m); return m;
  }
  function syncEffects() {
    shotPool.forEach(m => m.visible = false); splatPool.forEach(m => m.visible = false); numPool.forEach(m => m.visible = false); boltPool.forEach(m => m.visible = false); cloudPool.forEach(m => m.visible = false); ringPool.forEach(m => m.visible = false);
    G.clouds.forEach((c, i) => { let m = cloudPool[i]; if (!m) { m = new THREE.Mesh(cloudGeo, new THREE.MeshBasicMaterial({ color: 0x78dc46, transparent: true, depthWrite: false })); scene.add(m); cloudPool[i] = m; }
      m.visible = true; m.material.opacity = .28 * Math.min(1, c.life); m.scale.set(c.r, .8 + Math.sin(G.time * 5 + i) * .08, c.r); m.position.set(c.x, .5, c.y); });
    G.shots.forEach((s, i) => { let m = shotPool[i]; if (!m) { m = new THREE.Mesh(shotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })); scene.add(m); shotPool[i] = m; }
      m.visible = true; m.material.color.set(s.color); m.position.set(s.x, .6, s.y); });
    let si = 0, ni = 0, bi = 0, ri = 0;
    for (const f of G.fx) {
      if (f.ring) { let m = ringPool[ri]; if (!m) { m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false })); scene.add(m); ringPool[ri] = m; }
        ri++; const k = 1 - f.life / f.max; m.visible = true; m.material.color.set(f.color); m.material.opacity = 1 - k; m.scale.setScalar(f.r * (0.3 + 0.7 * k)); m.position.set(f.x, .08, f.y); continue; }
      if (f.bolt) { let m = boltPool[bi]; if (!m) { m = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: 0xfff6a0 })); scene.add(m); boltPool[bi] = m; }
        bi++; m.visible = true; m.position.set(f.x, 1.5, f.y); m.scale.set(1 + (Math.random() - .5) * .8, 1, 1 + (Math.random() - .5) * .8); }
      else if (f.splat) { let m = splatPool[si]; if (!m) { m = new THREE.Mesh(splatGeo, new THREE.MeshBasicMaterial({ color: 0x8c1414, transparent: true })); scene.add(m); splatPool[si] = m; }
        si++; m.visible = true; m.material.opacity = Math.min(.55, f.life / 6); m.position.set(f.x, .02, f.y); }
      else { let m = numPool[ni]; if (!m) { m = new THREE.Sprite(); m.scale.set(.6, .3, 1); m.renderOrder = 11; scene.add(m); numPool[ni] = m; }
        ni++; m.visible = true; m.material = numberMat(f.txt, f.color); m.position.set(f.x, 1.0 + (0.7 - f.life) * 0.8, f.y); }
    }
  }

  /* Call to Arms flag */
  const flag = new THREE.Group(); const pole = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 1.4, 6), new THREE.MeshLambertMaterial({ color: 0xcccccc })); pole.position.y = .7; flag.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.55, .32), new THREE.MeshBasicMaterial({ color: 0xff6a20, side: THREE.DoubleSide })); cloth.position.set(.28, 1.2, 0); flag.add(cloth); flag.visible = false; scene.add(flag);

  /* hover / drag-selection highlight */
  const sel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .25, depthWrite: false }));
  sel.rotation.x = -Math.PI / 2; sel.renderOrder = 5; scene.add(sel);
  function syncSelection() {
    const m = UI.mouse, tool = UI.tool; sel.visible = m.x >= 0;
    flag.visible = !!(G.rally && G.time < G.rally.until); if (flag.visible) { flag.position.set(G.rally.x, 0, G.rally.y); cloth.rotation.y = Math.sin(G.time * 4) * .25; }
    if (!sel.visible) return;
    if (SPELLS[tool] && m.fx !== undefined) { const r = SPELLS[tool].r; sel.scale.set(r * 2, r * 2, 1); sel.position.set(m.fx, .06, m.fy); sel.material.color.set(SPELLS[tool].color); sel.material.opacity = .28; return; }
    let x0 = m.x, x1 = m.x, y0 = m.y, y1 = m.y;
    if (m.down && tool !== 'hand') { x0 = Math.min(m.sx, m.x); x1 = Math.max(m.sx, m.x); y0 = Math.min(m.sy, m.y); y1 = Math.max(m.sy, m.y); }
    sel.scale.set(x1 - x0 + 1, y1 - y0 + 1, 1); sel.position.set((x0 + x1 + 1) / 2, tool === 'dig' ? WALL_H + .05 : .05, (y0 + y1 + 1) / 2);
    sel.material.color.set(m.down === 3 ? 0xff5050 : m.down ? 0xffe678 : 0xffffff); sel.material.opacity = m.down ? .35 : .22;
  }

  /* ------------------------------------------------------------------ input: ray-march the camera ray into the tile columns */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(e) {
    const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera); const o = ray.ray.origin, d = ray.ray.direction;
    let px = o.x, py = o.y, pz = o.z;
    for (let s = 0; s < 600; s++) {                                // walk along the ray until we are inside a wall column or reach the floor
      const tx = Math.floor(px), tz = Math.floor(pz), t = tx >= 0 && tz >= 0 && tx < W && tz < H ? G.map[tz * W + tx] : null;
      const top = t && TERRAIN[t.t].solid ? (t.t === T.ROCK ? ROCK_H : WALL_H) : 0;
      if (py <= top + 1e-3) break;
      px += d.x * .08; py += d.y * .08; pz += d.z * .08;
    }
    const clamp = (v, m) => Math.max(0, Math.min(m - 1, Math.floor(v)));
    return { p: { x: clamp(px, W), y: clamp(pz, H) }, f: { fx: px, fy: pz } };
  }
  let pan = null;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1) { pan = { x: e.clientX, y: e.clientY }; return; }
    const h = pick(e); UI.inputDown(h.p, h.f, e.button);
  });
  canvas.addEventListener('pointermove', e => {
    if (pan) { const k = cam.dist * 0.0021; cam.x -= (e.clientX - pan.x) * k; cam.z -= (e.clientY - pan.y) * k * 1.5; pan = { x: e.clientX, y: e.clientY }; return; }
    const h = pick(e); UI.inputMove(h.p, h.f);
  });
  canvas.addEventListener('pointerup', e => { if (e.button === 1) { pan = null; return; } const h = pick(e); UI.inputUp(h.p, h.f); });
  canvas.addEventListener('pointerleave', () => { if (!UI.mouse.down) UI.mouse.x = -1; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(6, Math.min(30, cam.dist * (1 + Math.sign(e.deltaY) * .1))); }, { passive: false });
  const keys = new Set();
  addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT') keys.add(e.key.toLowerCase()); });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  /* ------------------------------------------------------------------ frame */
  const bannerHtml = (over) => over === 'victory'
    ? '<div style="font:bold 44px sans-serif;color:#f0c040">VICTORY</div>' : '<div style="font:bold 44px sans-serif;color:#e0624f">DEFEAT</div>';
  window.__render3d = function (dt) {
    const sp = dt * cam.dist * 0.9;
    if (keys.has('w') || keys.has('arrowup')) cam.z -= sp; if (keys.has('s') || keys.has('arrowdown')) cam.z += sp;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= sp; if (keys.has('d') || keys.has('arrowright')) cam.x += sp;
    cam.x = Math.max(0, Math.min(W, cam.x)); cam.z = Math.max(0, Math.min(H, cam.z)); placeCamera();
    updateTiles(); syncProps(); syncUnits(); syncEffects(); syncSelection();
    const pulse = 1 + Math.sin(G.time * 4) * .07;
    heartMesh.scale.setScalar(pulse * (G.heartFlash > 0 ? 1.25 : 1)); heartMesh.rotation.y += dt * .6; heartMesh.material.emissive.setHex(G.heartFlash > 0 ? 0xffffff : 0x801010);
    heartLight.intensity = 2.0 + Math.sin(G.time * 4) * .5;
    portalMesh.rotation.y += dt * 1.2; portalMesh.rotation.x = Math.sin(G.time) * .3; portalLight.intensity = G.portalOwned ? 1.6 : 0; portalMesh.material.emissiveIntensity = G.portalOwned ? .8 : .1;
    gateMesh.rotation.y -= dt * .8; gateLight.intensity = G.gateOpen ? 1.8 : .6;
    renderer.render(scene, camera);
    const show = !!G.over; if (show) { const msg = bannerHtml(G.over) + '<div style="font:16px sans-serif;color:#e8dcc8;margin-top:6px">' + G.kills + ' heroes slain · ' + Math.floor(G.time) + 's · reload to play again</div>'; if (banner.innerHTML !== msg) banner.innerHTML = msg; }
    banner.style.display = show ? 'flex' : 'none';
  };
  window.__three = { scene, camera, renderer, cam };
}
