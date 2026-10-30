/* 3D view of the simulation in game.js, drawn with three.js.
 * It only READS the game state (window.__game.G) and forwards pointer input through window.__ui, the same split
 * OpenKeeper has between game/ (headless sim) and view/ (JME scene graph).
 *
 * Art: props are the hand-made isometric sprites in assets/sprites (see tools/process_art.py), drawn as camera-facing
 * billboards. Floors and walls are 64px pixel-art textures generated in code (no files). Units are still stand-in
 * shapes until the character sprites arrive: swap makeUnit() for sprite billboards.
 * Camera: isometric by default (yaw 45 deg, narrow field of view) to match the sprites; ?cam=top gives the old
 * steep top-down perspective view. ?view=2d keeps the flat canvas renderer. */
import * as THREE from './vendor/three.module.js';

const params = new URLSearchParams(location.search);
if (params.get('view') !== '2d') {
  try { start(); } catch (err) { console.warn('3D view unavailable, staying on the 2D canvas:', err); window.__render3d = null; }
}

function start() {
  const { G, T, TERRAIN, HERO_LAND, W, H, capacity, TRAPS, SPELLS } = window.__game, UI = window.__ui;
  const ISO = params.get('cam') !== 'top';
  const WALL_H = ISO ? 0.95 : 1.25, ROCK_H = ISO ? 1.2 : 1.6;

  /* ------------------------------------------------------------------ renderer, scene, camera */
  const stage = document.getElementById('stage'), cv2d = document.getElementById('cv');
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });   // throws without WebGL -> caught above
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  canvas.style.cssText = 'width:100%;display:block;border-radius:6px;touch-action:none;cursor:crosshair';
  cv2d.style.display = 'none'; stage.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0907); scene.fog = ISO ? new THREE.Fog(0x0b0907, 48, 100) : new THREE.Fog(0x0b0907, 20, 46);
  const camera = new THREE.PerspectiveCamera(ISO ? 26 : 45, 800 / 560, 0.1, 200);
  const cam = ISO ? { x: G.heart.x + 5, z: G.heart.y + 1, dist: 28, pitch: 40 * Math.PI / 180, yaw: Math.PI / 4, min: 12, max: 60 }
                  : { x: G.heart.x + 6, z: G.heart.y + 1, dist: 22, pitch: 58 * Math.PI / 180, yaw: 0, min: 6, max: 30 };
  function placeCamera() {
    const h = Math.cos(cam.pitch) * cam.dist;
    camera.position.set(cam.x + Math.sin(cam.yaw) * h, Math.sin(cam.pitch) * cam.dist, cam.z + Math.cos(cam.yaw) * h);
    camera.lookAt(cam.x, 0, cam.z);
  }
  const screenRight = () => ({ x: Math.cos(cam.yaw), z: -Math.sin(cam.yaw) }), screenUp = () => ({ x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) });
  function resize() {
    const w = stage.clientWidth || 800, h = stage.clientHeight || Math.round(w * 0.7);                       // the panel decides the size
    renderer.setPixelRatio(Math.min(2.5, (window.devicePixelRatio || 1) * (window.__uiScale || 1)));         // the page is scaled, so render at the scaled density
    renderer.setSize(w, h, false); canvas.style.height = h + 'px'; camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); window.__onUiScale = resize; resize(); placeCamera();

  scene.add(new THREE.HemisphereLight(0xb0a8c0, 0x2a2430, 0.95));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.25); sun.position.set(4, 12, 9); scene.add(sun);
  const heartLight = new THREE.PointLight(0xff3020, 2.2, 9, 1.6); heartLight.position.set(G.heart.x + .5, 1.3, G.heart.y + .5); scene.add(heartLight);
  const portalLight = new THREE.PointLight(0xff5030, 0, 9, 1.6); if (G.portal) portalLight.position.set(G.portal.x + .5, 1.2, G.portal.y + .5); scene.add(portalLight);      // levels may have no Portal or no Gate
  const gateLights = G.gates.map(gt => { const l = new THREE.PointLight(0xffd070, 1.0, 8, 1.6); l.position.set(gt.x + .5, 1.2, gt.y + .5); scene.add(l); return l; });      // one per Hero Gate (a level may have none)

  /* ------------------------------------------------------------------ procedural pixel-art textures (grey; tinted per tile) */
  const hash = (x, y, k = 0) => { let h = x * 374761393 + y * 668265263 + k * 2246822519; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; };
  function pixTex(size, paint) {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), id = g.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const v = Math.max(0, Math.min(255, paint(x, y))); const o = (y * size + x) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255; }
    g.putImageData(id, 0, 0);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  const floorTex = pixTex(64, (x, y) => {                       // dark flagstones, two rows of two, second row offset
    const row = y >> 5, ox = row ? 16 : 0, sx = ((x + ox) & 63) >> 5, lx = (x + ox) & 31, ly = y & 31, seed = row * 2 + sx;
    if (lx < 2 || ly < 2) return 70;                             // mortar
    let v = 150 + (hash(seed, 3) - .5) * 55 + (hash(x >> 1, y >> 1, 7) - .5) * 26;
    if (lx < 4 || ly < 4) v += 16; if (lx > 28 || ly > 28) v -= 18;      // lit top-left edge, shaded bottom-right
    if (hash(x, y, 11) > .985) v -= 40;                          // chips
    return v;
  });
  const dirtTex = pixTex(64, (x, y) => {                        // packed earth: blotchy value noise, pebbles, cracks
    let v = 105 + (hash(x >> 3, y >> 3, 1) - .5) * 60 + (hash(x >> 2, y >> 2, 2) - .5) * 40 + (hash(x >> 1, y >> 1, 3) - .5) * 24;
    if (hash(x >> 2, y >> 1, 5) > .93) v += 50;                  // pebbles
    if (Math.abs(((x * 3 + y * 5 + (hash(y >> 3, 9) * 20 | 0)) % 37)) < 1.2 && hash(x >> 3, y >> 3, 6) > .55) v -= 45;   // cracks
    return v;
  });
  const brickTex = pixTex(64, (x, y) => {                       // stone bricks, 32x16, staggered
    const row = y >> 4, ox = (row & 1) ? 16 : 0, bx = (x + ox) & 31, by = y & 15, id = ((x + ox) >> 5) + row * 4;
    if (bx < 2 || by < 2) return 55;
    let v = 140 + (hash(id, 5) - .5) * 60 + (hash(x >> 1, y >> 1, 8) - .5) * 24;
    if (by < 4) v += 14; if (by > 12) v -= 16;
    return v;
  });

  /* ------------------------------------------------------------------ sprites */
  /* w = width in tiles, ay = how far up the image (0..1) the ground contact point is. Tune after changing art. */
  const SPR = {
    heart:     { w: 4.2, ay: 0.05 }, portal:   { w: 4.0, ay: -0.04 }, hero_gate: { w: 4.3, ay: -0.02 },
    treasure:  { w: 1.5, ay: 0.30 }, cage:     { w: 1.05, ay: 0.12 }, bookshelf: { w: 1.35, ay: 0.14 },
    bed:       { w: 1.2, ay: 0.45 }, rack:     { w: 1.45, ay: 0.20 }, door:      { w: 1.4, ay: 0.04 },
    trap_gas:  { w: 1.5, ay: 0.36 }, trap_bolt: { w: 1.5, ay: 0.36 }, temple: { w: 1, ay: 0.38 },        // one big building per Temple room: width is set from the room's size (see syncRooms)
  };
  /* Sprites are flat quads facing the camera, so the lower part of a tall sprite lies "in front of" the floor tile it stands on and gets
   * clipped by it. This offsets a sprite's depth towards the camera (by `uBias` world units) without moving it on screen. */
  function biased(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBias = mat.userData.uBias = { value: mat.userData.bias || 0 };
      shader.vertexShader = shader.vertexShader.replace('void main() {', 'uniform float uBias;\nvoid main() {')
        .replace('gl_Position = projectionMatrix * mvPosition;', 'gl_Position = projectionMatrix * mvPosition;\n\tvec4 cb = projectionMatrix * vec4( mvPosition.xy, mvPosition.z + uBias, 1.0 );\n\tgl_Position.z = cb.z / cb.w * gl_Position.w;');
    };
    mat.customProgramCacheKey = () => 'spritebias'; return mat;
  }
  const setBias = (mat, v) => { mat.userData.bias = v; if (mat.userData.uBias) mat.userData.uBias.value = v; };
  const loader = new THREE.TextureLoader(), TEXS = {};
  for (const k in SPR) TEXS[k] = loader.load('assets/sprites/' + k + '.png', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; });
  function makeSprite(name, parent = scene) {
    const s = new THREE.Sprite(biased(new THREE.SpriteMaterial({ map: TEXS[name], transparent: true, alphaTest: 0.3, depthWrite: true })));
    s.center.set(0.5, SPR[name].ay); s.visible = false; s.userData.name = name; parent.add(s); return s;
  }
  function placeSprite(s, x, y, z, k = 1) {                      // x,z ground position, y lift; k scales the width
    const im = TEXS[s.userData.name].image; if (!im) { s.visible = false; return; }
    const w = SPR[s.userData.name].w * k, h = w * im.height / im.width; s.scale.set(w, h, 1); s.position.set(x, y, z); s.visible = true;
    setBias(s.material, Math.max(0, SPR[s.userData.name].ay) * h * 1.3 + 0.2);
  }
  const disposeSprite = (s) => { s.parent && s.parent.remove(s); s.material.dispose(); };

  /* ------------------------------------------------------------------ tiles (instanced) */
  const N = W * H, dummy = new THREE.Object3D(), col = new THREE.Color();
  const floorGeo = new THREE.PlaneGeometry(1, 1); floorGeo.rotateX(-Math.PI / 2);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
  const tiledMat = (map) => new THREE.MeshLambertMaterial({ color: 0xffffff, map });
  const floorMesh = new THREE.InstancedMesh(floorGeo, tiledMat(floorTex), N);
  const wallDirt = new THREE.InstancedMesh(boxGeo, tiledMat(dirtTex), N), wallBrick = new THREE.InstancedMesh(boxGeo, tiledMat(brickTex), N);
  for (const m of [floorMesh, wallDirt, wallBrick]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; scene.add(m); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); }

  const goldBits = new THREE.InstancedMesh(new THREE.BoxGeometry(.13, .13, .13), new THREE.MeshLambertMaterial({ color: 0xffd040, emissive: 0x4a3200 }), N * 4);
  const gemBits = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.2), new THREE.MeshLambertMaterial({ color: 0x5ee0ff, emissive: 0x104050 }), N);
  const tagGeo = new THREE.PlaneGeometry(.7, .7); tagGeo.rotateX(-Math.PI / 2);
  const tags = new THREE.InstancedMesh(tagGeo, new THREE.MeshBasicMaterial({ color: 0xffe070, transparent: true, opacity: .75 }), N);
  for (const m of [goldBits, gemBits, tags]) { m.frustumCulled = false; scene.add(m); }

  // floor tints (multiplied with the grey flagstone texture, so these are deliberately bright)
  const COL = { floor: 0x7a6e60, owned: 0x6a80b8, hero: 0xa04c44, earth: 0x8a6a46, near: 0x8d93a6, rock: 0x4a4a58, gold: 0x9a7a44, gem: 0x5a4a6a,
    [T.TREASURY]: 0xb09848, [T.LAIR]: 0x7a68a0, [T.HEART]: 0xa04040, [T.PORTAL]: 0x80509a, [T.GATE]: 0xb0a070, [T.PRISON]: 0x7a8490, [T.TORTURE]: 0x8a3c3c, [T.LIBRARY]: 0x5a6aa0, [T.HATCHERY]: 0x9a8450, [T.TEMPLE]: 0x8a7ab0 };
  const tmpOwned = new THREE.Color(COL.owned);
  const ownedFloor = (x, y) => { const t = G.map[y * W + x]; return !!t && t.owner === 1 && !TERRAIN[t.t].solid; };
  const tileSprites = { treasure: new Map(), bed: new Map(), bookshelf: new Map(), cage: new Map(), rack: new Map(), nest: new Map() };
  const SPRITE_OF_KIND = { nest: 'bed' };                         // tile-sprite kinds that reuse another picture

  /* A Temple is drawn as ONE building per connected group of Temple tiles: scaled to the group's footprint, centred on its bounding box. */
  const roomSprites = new Map();
  function groupRooms(list) {
    const set = new Set(list.map(p => p.y * W + p.x)), seen = new Set(), out = [];
    for (const p of list) {
      const k0 = p.y * W + p.x; if (seen.has(k0)) continue;
      const st = [k0], comp = []; seen.add(k0);
      while (st.length) { const c = st.pop(), cx = c % W, cy = (c / W) | 0; comp.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy, nk = ny * W + nx; if (nx >= 0 && nx < W && set.has(nk) && !seen.has(nk)) { seen.add(nk); st.push(nk); } } }
      const xs = comp.map(c => c[0]), ys = comp.map(c => c[1]);
      out.push({ key: Math.min(...comp.map(c => c[1] * W + c[0])), x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }
    return out;
  }
  function syncRooms(templeTiles) {
    const live = new Set();
    for (const r of groupRooms(templeTiles)) {
      live.add(r.key); let s = roomSprites.get(r.key); if (!s) { s = makeSprite('temple'); roomSprites.set(r.key, s); }
      const rw = r.x1 - r.x0 + 1, rh = r.y1 - r.y0 + 1;
      placeSprite(s, (r.x0 + r.x1 + 1) / 2, 0, (r.y0 + r.y1 + 1) / 2, Math.max(3.4, (rw + rh) * 0.65 * 1.02));            // a tile's diamond is ~1.3 wide on screen
    }
    for (const [k, s] of roomSprites) if (!live.has(k)) { disposeSprite(s); roomSprites.delete(k); }
  }

  function updateTiles() {
    let nGold = 0, nGem = 0, nTag = 0; const templeTiles = [], used = {}; for (const k in tileSprites) used[k] = new Set();
    const fill = Math.min(1, G.gold / Math.max(1, capacity()));
    const sprite = (kind, i, x, y, k = 1, lift = 0, opacity = 1) => {
      used[kind].add(i); let s = tileSprites[kind].get(i); if (!s) { s = makeSprite(SPRITE_OF_KIND[kind] || kind); tileSprites[kind].set(i, s); }
      placeSprite(s, x + .5, lift, y + .5, k); s.material.opacity = opacity;
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = G.map[i], tr = TERRAIN[t.t], n = hash(x, y), shade = (0.88 + n * 0.24) * 1.45;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(x + .5, 0, y + .5); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); floorMesh.setMatrixAt(i, dummy.matrix);
      let c = COL.floor;
      if (!tr.solid) {
        c = COL[t.t] ?? COL.floor;
        if (t.t === T.PATH) c = t.owner === 1 ? COL.owned : t.owner === HERO_LAND ? COL.hero : COL.floor;
        if (t.t === T.PATH && t.owner !== 1 && t.hp > 0) c = col.set(COL.floor).lerp(tmpOwned, Math.min(1, t.hp / tr.maxHealth)).getHex();   // claim progress
      }
      floorMesh.setColorAt(i, col.set(c).multiplyScalar(shade));
      // wall block: rock and reinforced walls (next to your floor) are brick, the rest is packed earth
      let h = 0, brick = false;
      if (tr.solid) {
        const ratio = t.t === T.ROCK ? 1 : t.t === T.GEM ? 1 : Math.max(0.3, t.hp / tr.maxHealth);   // digging visibly shaves the block down
        h = (t.t === T.ROCK ? ROCK_H : WALL_H) * (t.t === T.ROCK || t.t === T.GEM ? 1 : 0.35 + 0.65 * ratio);
        const near = t.t === T.EARTH && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H && ownedFloor(x + dx, y + dy));
        brick = t.t === T.ROCK || near;
        const wc = t.t === T.ROCK ? COL.rock : t.t === T.GEM ? COL.gem : t.t === T.GOLD ? COL.gold : near ? COL.near : COL.earth;
        (brick ? wallBrick : wallDirt).setColorAt(i, col.set(wc).multiplyScalar(shade));
        if (t.t === T.GOLD && t.gold > 0) for (let k = 0; k < 4; k++) { dummy.position.set(x + .2 + hash(x, y, k + 1) * .6, h + .02, y + .2 + hash(x, y, k + 9) * .6); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, hash(x, y, k) * 3, 0); dummy.updateMatrix(); goldBits.setMatrixAt(nGold++, dummy.matrix); }
        if (t.t === T.GEM) { dummy.position.set(x + .5, h + .2, y + .5); dummy.scale.set(1, 1.5, 1); dummy.rotation.set(0, G.time * .8 + n * 6, 0); dummy.updateMatrix(); gemBits.setMatrixAt(nGem++, dummy.matrix); }
        if (t.tag) { dummy.position.set(x + .5, h + .03, y + .5); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); tags.setMatrixAt(nTag++, dummy.matrix); }
      }
      dummy.rotation.set(0, 0, 0); dummy.position.set(x + .5, 0, y + .5);
      dummy.scale.set(brick ? 1 : 0, brick ? h : 0, brick ? 1 : 0); dummy.updateMatrix(); wallBrick.setMatrixAt(i, dummy.matrix);
      dummy.scale.set(!brick && h > 0 ? 1 : 0, !brick && h > 0 ? h : 0, !brick && h > 0 ? 1 : 0); dummy.updateMatrix(); wallDirt.setMatrixAt(i, dummy.matrix);
      if (t.owner === 1) {
        if (t.t === T.TREASURY && fill > 0.02) sprite('treasure', i, x, y, 0.45 + 0.8 * fill);
        else if (t.t === T.LAIR) sprite('bed', i, x, y);
        else if (t.t === T.LIBRARY) sprite('bookshelf', i, x, y);
        else if (t.t === T.HATCHERY) sprite('nest', i, x, y, 0.8);
        else if (t.t === T.TEMPLE) templeTiles.push({ x, y });
        else if (t.t === T.PRISON) sprite('cage', i, x, y, 1, 0, t.occ ? 0.5 : 1);
        else if (t.t === T.TORTURE) sprite('rack', i, x, y, 1, 0, t.occ ? 0.7 : 1);
      }
    }
    syncRooms(templeTiles);
    for (const kind in tileSprites) for (const [i, s] of tileSprites[kind]) if (!used[kind].has(i)) { disposeSprite(s); tileSprites[kind].delete(i); }
    for (const [m, c] of [[goldBits, nGold], [gemBits, nGem], [tags, nTag]]) { m.count = c; m.instanceMatrix.needsUpdate = true; }
    for (const m of [floorMesh, wallDirt, wallBrick]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }

  /* landmarks: Heart, Portal (yours), Hero Gate (theirs) */
  const heartSpr = makeSprite('heart'), portalSpr = makeSprite('portal'), gateSprs = G.gates.map(() => makeSprite('hero_gate'));

  /* ------------------------------------------------------------------ units: character sprites as billboards */
  /* screen height of each character in tiles-diamond units (a floor tile's diamond is about 1.3 wide). Default 1.2. */
  const USIZE = { imp: .9, goblin: 1.0, goblin_elite: 1.15, troll: 1.45, troll_elite: 1.55, warlock: 1.25, darkelf: 1.3, darkelf_elite: 1.35, bile: 1.5, bile_elite: 1.6,
    vampire: 1.35, vampire_elite: 1.4, salamander: 1.0, salamander_elite: 1.15, spider: .95, skeleton: 1.2, skeleton_knight: 1.3,
    knight: 1.3, archer: 1.2, mage: 1.3, thief: 1.15, guard: 1.4, monk: 1.05, prince: 1.6, chicken: .55,
    mistress: 1.45, reaper: 1.6, dark_angel: 1.7, dark_angel_elite: 1.75, assassin: 1.15, rogue: 1.2, black_knight: 1.4, fire_knight: 1.45, wasp: .8, firefly: .85,
    dwarf: 1.0, giant: 1.75, stone_knight: 1.5, fairy: .95, king: 1.55 };
  const { KINDS, HEROES, SKELETON, spriteOf } = window.__game;
  for (const k of [...KINDS, ...HEROES, SKELETON, { sprite: 'imp' }, { sprite: 'chicken' }]) for (const n of [k.sprite, k.elite]) if (n && !TEXS[n]) TEXS[n] = loader.load('assets/sprites/' + n + '.png', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; });
  /* Animation strips (tools/make_frames.py): assets/anim/<name>.png holds idle(4) walk(6) attack(5) frames side by side; anim.json lists their sizes.
   * Hand-drawn strips with the same layout drop straight in. Units without a strip fall back to their single pose. */
  let ANIMS = {}; const ATEX = {};
  fetch('assets/anim/anim.json').then(r => r.ok ? r.json() : {}).then(j => { ANIMS = j; for (const n in j) ATEX[n] = loader.load('assets/anim/' + n + '.png', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }); }).catch(() => {});
  const frameTex = (src) => { const t = src.clone(); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };   // own repeat/offset, shared GPU image
  const unitMeshes = new Map();
  const shadowGeo = new THREE.CircleGeometry(.5, 20); shadowGeo.rotateX(-Math.PI / 2);
  const barBg = new THREE.SpriteMaterial({ color: 0x000000, transparent: true, opacity: .75, depthTest: false });
  const barKeeper = new THREE.SpriteMaterial({ color: 0x5fd070, depthTest: false }), barHero = new THREE.SpriteMaterial({ color: 0x5aa0ff, depthTest: false });
  function makeBar(u) {
    const g = new THREE.Group(), bg = new THREE.Sprite(barBg), fg = new THREE.Sprite(u.team === 'h' ? barHero : barKeeper);
    for (const s of [bg, fg]) { s.center.set(0, .5); s.position.x = -.25; s.renderOrder = 10; }
    bg.scale.set(.5, .07, 1); fg.scale.set(.5, .07, 1); g.add(bg, fg); g.userData.fg = fg; g.visible = false; return g;
  }
  function makeUnit(u) {
    const g = new THREE.Group(), name = spriteOf(u) || 'imp';
    const mat = biased(new THREE.SpriteMaterial({ map: TEXS[name], transparent: true, alphaTest: 0.35, depthWrite: true }));
    const spr = new THREE.Sprite(mat); spr.center.set(0.5, 0); spr.visible = false; g.add(spr);
    // x-ray: a tinted copy that only draws where something (a wall) is in front of the unit
    const gmat = biased(new THREE.SpriteMaterial({ map: TEXS[name], transparent: true, alphaTest: 0.35, opacity: .42, depthWrite: false, depthFunc: THREE.GreaterDepth, color: u.team === 'h' ? 0x6aa0ff : 0x7affa0 }));
    const ghost = new THREE.Sprite(gmat); ghost.center.set(0.5, 0); ghost.renderOrder = 6; ghost.visible = false; g.add(ghost);
    const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .38, depthWrite: false })); shadow.position.y = .015; shadow.renderOrder = 1; g.add(shadow);
    if (u.team === 'h') { const ring = new THREE.Mesh(new THREE.TorusGeometry(.3, .035, 6, 20), new THREE.MeshBasicMaterial({ color: 0x4a90ff })); ring.rotation.x = Math.PI / 2; ring.position.y = .03; g.add(ring); g.userData.ring = ring; }   // heroes carry a blue ring
    const bar = makeBar(u); g.add(bar); g.userData = Object.assign(g.userData, { spr, ghost, shadow, bar, name, flip: false, fx: 1, phase: Math.random() });
    scene.add(g); return g;
  }
  function syncUnits() {
    const all = [...G.imps, ...G.creatures, ...G.heroes, ...G.prisoners, ...G.chickens], seen = new Set(), mouse = UI.mouse, r = screenRight();
    for (const u of all) {
      seen.add(u); let g = unitMeshes.get(u); if (!g) { g = makeUnit(u); unitMeshes.set(u, g); }
      const d = g.userData, held = u.held && mouse.fx !== undefined, name = spriteOf(u) || 'imp';
      const lying = u.unconscious || u.imprisoned, moving = !!u.path && !lying;
      // which way to face on screen: mirror when walking or fighting towards the left
      const sx = Math.cos(u.face || 0) * r.x + Math.sin(u.face || 0) * r.z; if (sx < -0.25) d.flip = true; else if (sx > 0.25) d.flip = false;
      // pick a picture source: the animation strip when there is one (and the unit is upright), else the single pose
      const meta = ANIMS[name], strip = meta && !lying && ATEX[name] && ATEX[name].image ? ATEX[name] : null, srcTex = strip || TEXS[name];
      if (!srcTex || !srcTex.image) { d.spr.visible = d.ghost.visible = false; continue; }
      if (d.srcName !== name || d.src !== srcTex) { d.cache = d.cache || new Map(); d.tex = d.cache.get(srcTex) || frameTex(srcTex); d.cache.set(srcTex, d.tex); d.src = srcTex; d.srcName = name; d.spr.material.map = d.tex; d.ghost.material.map = d.tex; d.spr.material.needsUpdate = true; d.ghost.material.needsUpdate = true; }
      let f = 0, N = 1;
      if (strip) {
        N = meta.attack[1]; const ph = d.phase, spd = (u.speed || 1.6) * (u.haste > 0 ? 1.6 : 1);
        if (u.cdMax && u.cd > u.cdMax - 0.5) f = meta.attack[0] + Math.min(4, Math.floor((u.cdMax - u.cd) / 0.5 * 5));            // the swing starts the moment the blow lands
        else if ((u.isImp && u.state === 'work') || u.state === 'torture') f = meta.attack[0] + Math.floor(G.time * 5 + ph) % 5;                              // imps dig with the swing loop
        else if (moving) f = meta.walk[0] + Math.floor(G.time * spd * 0.9 * 6 + ph * 6) % 6;
        else f = meta.idle[0] + Math.floor(G.time * (u.state === 'sleep' ? 1.5 : 3.5) + ph * 4) % 4;
      }
      d.tex.repeat.x = (d.flip ? -1 : 1) / N; d.tex.offset.x = d.flip ? (f + 1) / N : f / N;
      const hgt = (USIZE[name] || 1.2) * (u.state === 'sleep' ? .88 : 1);
      const bw = strip ? meta.bw : srcTex.image.width, bh = strip ? meta.bh : srcTex.image.height, upp = hgt / bh, wid = bw * upp;       // wid = the character's own width on screen
      const qw = strip ? meta.fw * upp : wid, qh = strip ? meta.fh * upp : hgt;                                                    // the quad is the whole padded frame
      const fly = u.flying && !lying ? 0.42 + Math.sin(G.time * 6 + d.phase * 6) * .07 : 0;                                         // flyers hover above their shadow
      const hop = (!strip && moving ? Math.abs(Math.sin(G.time * 9 + d.phase * 5)) * .09 : 0) + fly;                                       // single poses hop instead of striding
      const lunge = !strip && u.cdMax && u.cd > u.cdMax - 0.16 ? 1.1 : 1;
      const wob = !strip && u.isImp && u.state === 'work' ? 1 + Math.sin(G.time * 18) * .07 : 1;
      g.position.set(held ? mouse.fx : u.x, held ? 1.4 : 0, held ? mouse.fy : u.y);
      const sc = lunge * wob; d.spr.scale.set(qw * sc, qh / sc, 1); d.ghost.scale.copy(d.spr.scale);
      if (lying) { d.spr.center.set(0.5, 0.5); d.spr.material.rotation = d.ghost.material.rotation = (d.flip ? -1 : 1) * Math.PI / 2; d.spr.position.y = d.ghost.position.y = (u.carriedBy ? .75 : .22) + wid * .12; }
      else { d.spr.center.set(0.5, 0); d.spr.material.rotation = d.ghost.material.rotation = 0; d.spr.position.y = d.ghost.position.y = hop; }
      d.ghost.center.copy(d.spr.center);
      setBias(d.spr.material, .25 + (lying ? wid * .5 : 0)); setBias(d.ghost.material, .75 + (lying ? wid * .5 : 0));
      d.spr.visible = true; d.ghost.visible = !u.isChicken;
      // tint: flash white on hit, orange when an imp flees, blue under Speed, gold while studying, purple for converts, dim while asleep
      const c = d.spr.material.color;
      if (u.flash > 0) c.setScalar(2.4); else if (u.isImp && u.state === 'flee') c.setRGB(1.4, .85, .7);
      else if (u.haste > 0) c.setRGB(.7, .9, 1.9); else if (u.state === 'research' || u.state === 'pray') c.setRGB(1.3, 1.15, .75);
      else if (u.tint) c.setRGB(1.1, .75, 1.35); else if (u.state === 'sleep') c.setRGB(.6, .6, .85); else c.setScalar(1);
      d.shadow.scale.set(Math.max(.5, wid * .75), Math.max(.5, wid * .75) * .85, Math.max(.5, wid * .75)); d.shadow.visible = !lying && !held;
      if (d.ring) { d.ring.position.y = d.spr.position.y * 0 + .03; d.ring.scale.setScalar(Math.max(.7, wid * .75)); d.ring.visible = !lying; }
      d.bar.position.y = lying ? .6 : hgt + .1 + hop; const showBar = u.hp < u.maxHp; d.bar.visible = showBar; if (showBar) d.bar.userData.fg.scale.x = .5 * Math.max(0.001, u.hp / u.maxHp);
    }
    for (const [u, g] of unitMeshes) if (!seen.has(u)) { scene.remove(g); if (g.userData.cache) for (const t of g.userData.cache.values()) t.dispose(); g.traverse(o => { if (o.isMesh) { if (o.geometry !== shadowGeo) o.geometry.dispose(); o.material.dispose(); } else if (o.isSprite && o.material.dispose && o.material !== barBg && o.material !== barKeeper && o.material !== barHero) o.material.dispose(); }); unitMeshes.delete(u); }
  }

  /* doors & traps: sprites keyed by sim object */
  const doorObjs = new Map(), trapObjs = new Map();
  function makeDoor(d) {
    const g = new THREE.Group(); g.position.set(d.x, 0, d.y);
    const spr = makeSprite('door', g), bar = makeBar({ team: 'k' }); bar.position.y = 1.35; g.add(bar);
    g.userData = { spr, bar, open: 0 }; scene.add(g); return g;
  }
  function makeTrap(tr) {
    const g = new THREE.Group(); g.position.set(tr.x, 0, tr.y);
    const spr = makeSprite(tr.kind === 'gas' ? 'trap_gas' : 'trap_bolt', g), c = new THREE.Color(TRAPS[tr.kind].color), r = screenRight(), f = { x: Math.sin(cam.yaw), z: Math.cos(cam.yaw) };
    const pips = []; for (let i = 0; i < tr.max; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(.06, 6, 6), new THREE.MeshBasicMaterial({ color: c })); p.position.set(r.x * (-.2 + i * .2) + f.x * .45, .12, r.z * (-.2 + i * .2) + f.z * .45); g.add(p); pips.push(p); }
    g.userData = { spr, pips }; scene.add(g); return g;
  }
  function syncProps() {
    const keep = new Set();
    for (const d of G.doors) {
      keep.add(d); let g = doorObjs.get(d); if (!g) { g = makeDoor(d); doorObjs.set(d, g); }
      const near = G.creatures.concat(G.imps).some(u => !u.dead && Math.hypot(u.x - d.x, u.y - d.y) < 1.4), u = g.userData;
      u.open += ((near ? 1 : 0) - u.open) * .25;
      placeSprite(u.spr, 0, u.open * 0.5, 0); u.spr.material.opacity = 1 - u.open * 0.65;                  // slides up and fades while a friend passes
      u.spr.material.color.setScalar(d.flash > 0 ? 2.2 : 1);
      u.bar.visible = d.hp < d.maxHp; u.bar.userData.fg.scale.x = .5 * Math.max(.001, d.hp / d.maxHp);
    }
    for (const tr of G.traps) {
      keep.add(tr); let g = trapObjs.get(tr); if (!g) { g = makeTrap(tr); trapObjs.set(tr, g); }
      const u = g.userData; placeSprite(u.spr, 0, 0, 0); u.spr.material.color.setScalar(tr.charges ? 1 : 0.45);   // spent traps go grey
      u.pips.forEach((p, i) => p.visible = i < tr.charges);
    }
    for (const m of [doorObjs, trapObjs]) for (const [k, g] of m) if (!keep.has(k)) {
      scene.remove(g); g.traverse(o => { if (o.isSprite || o.isMesh) { if (o.geometry && o.isMesh) o.geometry.dispose(); o.material.dispose(); } }); m.delete(k); }
  }

  /* shots, damage numbers, blood splats (small pools) */
  const shotPool = [], splatPool = [], numPool = [], boltPool = [], cloudPool = [], ringPool = [], numTex = new Map();
  const ringGeo = new THREE.RingGeometry(.92, 1, 40); ringGeo.rotateX(-Math.PI / 2);
  const boltGeo = new THREE.CylinderGeometry(.05, .05, 3, 6), cloudGeo = new THREE.SphereGeometry(1, 16, 10);
  const shotGeo = new THREE.SphereGeometry(.09, 8, 6), splatGeo = new THREE.CircleGeometry(.3, 14); splatGeo.rotateX(-Math.PI / 2);
  function numberMat(n, color) {
    const key = n + color; let m = numTex.get(key); if (m) return m;
    const c = document.createElement('canvas'); c.width = 64; c.height = 32; const x = c.getContext('2d'); x.font = '700 24px Cinzel, Georgia, serif'; x.textAlign = 'center'; x.lineWidth = 4; x.strokeStyle = '#000'; x.strokeText(n, 32, 25); x.fillStyle = color; x.fillText(n, 32, 25);
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
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: .3, depthWrite: false }));
  mark.rotation.x = -Math.PI / 2; mark.visible = false; scene.add(mark);
  function syncGuide() {                                              // the tutorial guide's target (game.js guideTarget)
    const t = UI.guideTarget(); mark.visible = !!t && !G.guideHidden && !G.over; if (!mark.visible) return;
    const tl = G.map[t.y0 * W + t.x0], top = tl && TERRAIN[tl.t].solid ? (tl.t === T.ROCK ? ROCK_H : WALL_H) : 0;
    mark.scale.set(t.x1 - t.x0 + 1, t.y1 - t.y0 + 1, 1); mark.position.set((t.x0 + t.x1 + 1) / 2, top + .08, (t.y0 + t.y1 + 1) / 2);
    mark.material.opacity = .22 + .22 * Math.sin(G.time * 5);
  }
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
    for (let s = 0; s < 900; s++) {                                // walk along the ray until we are inside a wall column or reach the floor
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
    if (pan) {                                                      // drag the ground with the middle button
      const k = 2 * cam.dist * Math.tan(camera.fov * Math.PI / 360) / (canvas.clientHeight || 560), r = screenRight(), u = screenUp(), dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      cam.x += (-r.x * dx + u.x * dy / Math.sin(cam.pitch)) * k; cam.z += (-r.z * dx + u.z * dy / Math.sin(cam.pitch)) * k; pan = { x: e.clientX, y: e.clientY }; return; }
    const h = pick(e); UI.inputMove(h.p, h.f);
  });
  canvas.addEventListener('pointerup', e => { if (e.button === 1) { pan = null; return; } const h = pick(e); UI.inputUp(h.p, h.f); });
  canvas.addEventListener('pointerleave', () => { if (!UI.mouse.down) UI.mouse.x = -1; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(cam.min, Math.min(cam.max, cam.dist * (1 + Math.sign(e.deltaY) * .1))); }, { passive: false });
  const keys = new Set();
  addEventListener('keydown', e => { if (e.target.tagName !== 'INPUT') keys.add(e.key.toLowerCase()); });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  /* ------------------------------------------------------------------ frame */
  if (document.fonts) document.fonts.load('700 24px Cinzel').then(() => numTex.clear());                       // number sprites cached before the font arrived are redrawn
  window.__render3d = function (dt) {
    const sp = dt * cam.dist * 0.5, r = screenRight(), u = screenUp();
    const mv = (v, s) => { cam.x += v.x * s; cam.z += v.z * s; };
    if (keys.has('w') || keys.has('arrowup')) mv(u, sp); if (keys.has('s') || keys.has('arrowdown')) mv(u, -sp);
    if (keys.has('a') || keys.has('arrowleft')) mv(r, -sp); if (keys.has('d') || keys.has('arrowright')) mv(r, sp);
    cam.x = Math.max(0, Math.min(W, cam.x)); cam.z = Math.max(0, Math.min(H, cam.z)); placeCamera();
    if (window.Sound) Sound.setListener(cam.x, cam.z, cam.dist * 0.28, r.x, r.z);     // effects get quieter and pan with distance from the camera
    updateTiles(); syncProps(); syncUnits(); syncEffects(); syncSelection(); syncGuide();
    // landmarks
    const pulse = 1 + Math.sin(G.time * 4) * .035 + (G.heartFlash > 0 ? .1 : 0);
    placeSprite(heartSpr, G.heart.x + .5, 0, G.heart.y + .5, pulse); heartSpr.material.color.setScalar(G.heartFlash > 0 ? 2.4 : 1);
    portalSpr.visible = !!G.portal;
    if (G.portal) { placeSprite(portalSpr, G.portal.x + .5, 0, G.portal.y + .5); portalSpr.material.color.setScalar(G.portalOwned ? 1 + Math.sin(G.time * 3) * .12 : 0.55); }
    G.gates.forEach((gt, i) => { placeSprite(gateSprs[i], gt.x + .5, 0, gt.y + .5); gateSprs[i].material.color.setScalar(gt.open ? 1.05 + Math.sin(G.time * 2 + i) * .1 : 0.5); gateLights[i].intensity = gt.open ? 1.8 : .6; });      // a linked Gate glows
    heartLight.intensity = 2.0 + Math.sin(G.time * 4) * .5; portalLight.intensity = G.portalOwned ? 1.6 : 0;
    renderer.render(scene, camera);
  };
  window.__three = { scene, camera, renderer, cam, SPR, TEXS };
}
