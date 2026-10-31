#!/usr/bin/env python3
"""Build animation strips for the main units from their single-pose sprites (web/assets/sprites/<name>.png).

    python3 tools/make_frames.py [--sprites web/assets/sprites] [--out web/assets/anim] [--size 200] [units ...]

These are *procedural* frames: the one pose is squashed, stretched, leaned and (for the legs) scissored, which gives the units
life without redrawing them. They are not hand-drawn animation. To replace any unit with real art, drop a strip with the same
name and layout into web/assets/anim/ and update anim.json (fw/fh/frames); the game needs no code change.

Strip layout, left to right, every frame the same size (fw x fh), feet on the bottom edge and centred horizontally:
    frames 0-3   idle    (4 frames, a slow breathing loop)
    frames 4-9   walk    (6 frames, one full stride cycle)
    frames 10-14 attack  (5 frames: strike, follow-through, two recovery frames, wind-up for the next blow)
The character faces RIGHT; the game mirrors it when it walks left.
"""
import argparse, json, math, os
import numpy as np
from PIL import Image

UNITS = ['imp', 'goblin', 'goblin_elite', 'troll', 'troll_elite', 'warlock', 'darkelf', 'darkelf_elite', 'bile', 'bile_elite', 'vampire', 'vampire_elite',
         'salamander', 'salamander_elite', 'spider', 'skeleton', 'skeleton_knight', 'knight', 'archer', 'mage', 'thief', 'guard', 'monk', 'prince',
         'mistress', 'reaper', 'dark_angel', 'dark_angel_elite', 'assassin', 'rogue', 'black_knight', 'fire_knight', 'wasp', 'firefly',
         'dwarf', 'giant', 'stone_knight', 'fairy', 'king']
IDLE, WALK, ATTACK = 4, 6, 5


def render(base, fw, fh, pad_x, lean=0.0, shift=0.0, bob=0.0, sy=1.0, sx=1.0, legs=None):
    """One frame. lean/shift/bob are fractions of the sprite's width/height; legs = (dxL, liftL, dxR, liftR) as fractions."""
    w, h = base.size
    im = base.resize((max(1, round(w * sx)), max(1, round(h * sy))), Image.BILINEAR) if (sx != 1 or sy != 1) else base
    a = np.asarray(im).copy(); ih, iw = a.shape[:2]
    out = np.zeros((fh, fw, 4), np.uint8)
    # per-row horizontal lean: the head moves most, the feet not at all
    rows = np.arange(ih); u = (ih - 1 - rows) / max(1, ih - 1)
    dx = np.round(lean * w * u ** 1.4 + shift * w).astype(int)
    if legs:                                                           # scissor the legs: each half of the bottom band swings and lifts on its own
        dxl, ll, dxr, lr = legs; band = int(ih * 0.24); mid = iw // 2
        for r in range(ih - band, ih):
            k = (r - (ih - band)) / band                              # 0 at the hip, 1 at the sole
            for half, d, lift in ((slice(0, mid), dxl, ll), (slice(mid, iw), dxr, lr)):
                seg = a[r, half].copy(); a[r, half] = 0
                y = r - int(round(lift * h * k)); x0 = (0 if half.start == 0 else mid) + int(round(d * w * k))
                if 0 <= y < ih:
                    xs = np.clip(np.arange(seg.shape[0]) + x0, 0, iw - 1); keep = seg[:, 3] > 0
                    a[y, xs[keep]] = seg[keep]
    top = fh - ih - int(round(bob * h))                                 # feet rest on the bottom edge; bob lifts the whole body
    for r in range(ih):
        y = top + r
        if not 0 <= y < fh: continue
        seg = a[r]; x0 = pad_x + (w - iw) // 2 + dx[r]
        xs = np.arange(iw) + x0; ok = (xs >= 0) & (xs < fw) & (seg[:, 3] > 0)
        out[y, xs[ok]] = seg[ok]
    return Image.fromarray(out, 'RGBA')


def frames_for(base, fw, fh, pad_x):
    f = []
    for k in range(IDLE):                                              # breathing
        t = 2 * math.pi * k / IDLE
        f.append(render(base, fw, fh, pad_x, lean=0.012 * math.sin(t + 1.2), sy=1 + 0.02 * math.sin(t), sx=1 - 0.008 * math.sin(t)))
    for k in range(WALK):                                              # stride: bob twice per cycle, sway, legs swing and lift alternately
        t = 2 * math.pi * k / WALK; s = math.sin(t)
        f.append(render(base, fw, fh, pad_x, lean=0.035 * s, bob=0.045 * abs(s), sy=1 - 0.015 * (1 - abs(s)),
                        legs=(0.085 * s, 0.05 * max(0, s), -0.085 * s, 0.05 * max(0, -s))))
    for p in [dict(lean=0.15, shift=0.07, sy=1.04), dict(lean=0.2, shift=0.1, sy=1.02), dict(lean=0.08, shift=0.035, sy=0.985),
              dict(lean=0.0, shift=0.0, sy=0.97), dict(lean=-0.11, shift=-0.045, sy=0.99, bob=0.02)]:
        f.append(render(base, fw, fh, pad_x, **p))
    return f


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('units', nargs='*'); ap.add_argument('--sprites', default='web/assets/sprites')
    ap.add_argument('--out', default='web/assets/anim'); ap.add_argument('--size', type=int, default=170)
    args = ap.parse_args(); os.makedirs(args.out, exist_ok=True); meta = {}
    for name in args.units or UNITS:
        src = os.path.join(args.sprites, name + '.png')
        if not os.path.exists(src): print('missing', src); continue
        base = Image.open(src).convert('RGBA'); s = args.size / max(base.size)
        if s < 1: base = base.resize((round(base.width * s), round(base.height * s)), Image.LANCZOS)
        w, h = base.size; pad_x = int(w * 0.24); fw, fh = w + 2 * pad_x, h + int(h * 0.1)
        fr = frames_for(base, fw, fh, pad_x)
        strip = Image.new('RGBA', (fw * len(fr), fh), (0, 0, 0, 0))
        for i, im in enumerate(fr): strip.paste(im, (i * fw, 0))
        strip.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(os.path.join(args.out, name + '.png'), optimize=True)   # 256-colour PNG keeps the strips small
        meta[name] = {'fw': fw, 'fh': fh, 'bw': w, 'bh': h, 'idle': [0, IDLE], 'walk': [IDLE, IDLE + WALK], 'attack': [IDLE + WALK, IDLE + WALK + ATTACK]}
        print(f'{name:18s} {fw}x{fh} x {len(fr)} frames')
    mpath = os.path.join(args.out, 'anim.json'); old = json.load(open(mpath)) if os.path.exists(mpath) else {}
    old.update(meta); json.dump(old, open(mpath, 'w'), indent=1)


if __name__ == '__main__':
    main()
