#!/usr/bin/env python3
"""Turn the hand-made prop art (JPG on a flat dark background) into game-ready PNG sprites with transparency.

    python3 tools/process_art.py <folder-with-jpgs> [--out web/assets/sprites] [--max 512] [--tol 26] [--debug dir]

For every JPG: estimate the background colour from the image corners, flood-fill the background from the borders
(so colours inside the artwork that happen to look like the background are kept), soften the cut edge, crop to the
artwork, shrink to at most --max pixels on the long side and save <name>.png. File names are mapped to short
sprite names below; unknown files are skipped with a warning. Writes manifest.json (size of each sprite) next to them.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# source file prefix -> sprite name used by web/render3d.js
NAMES = {
    'Dungeon_wall': 'wall', 'Gas_trap': 'trap_gas', 'Glowing_dungeon_heart': 'heart', 'Glowing_portal': 'hero_gate',
    'Gold_treasure_pile': 'treasure', 'Iron_prison_cage': 'cage', 'Library_bookshelf': 'bookshelf',
    'Lightning_trap': 'trap_bolt', 'Red_dungeon_portal': 'portal', 'Straw_bed': 'bed', 'Torture_rack': 'rack',
    'Wooden_iron_dungeon_door': 'door',
}


def sprite_name(fn):
    for prefix, name in NAMES.items():
        if fn.startswith(prefix):
            return name
    return None


def connected_to_border(mask):
    """4-connected flood fill from the image border over True pixels (numpy only; Pillow's floodfill is unreliable)."""
    reach = np.zeros_like(mask)
    reach[0, :] = mask[0, :]; reach[-1, :] = mask[-1, :]; reach[:, 0] = mask[:, 0]; reach[:, -1] = mask[:, -1]
    while True:
        grown = reach.copy()
        grown[1:, :] |= reach[:-1, :]; grown[:-1, :] |= reach[1:, :]; grown[:, 1:] |= reach[:, :-1]; grown[:, :-1] |= reach[:, 1:]
        grown &= mask
        # sweep along rows and columns inside each run so large open areas converge in a few passes
        for _ in range(2):
            for axis in (0, 1):
                f = grown if axis == 1 else grown.T
                for i in range(1, f.shape[1]): f[:, i] |= f[:, i - 1] & (mask if axis == 1 else mask.T)[:, i]
                for i in range(f.shape[1] - 2, -1, -1): f[:, i] |= f[:, i + 1] & (mask if axis == 1 else mask.T)[:, i]
        if (grown == reach).all(): return reach
        reach = grown


def cut_background(im, tol):
    a = np.asarray(im.convert('RGB'), dtype=np.float32)
    h, w, _ = a.shape
    k = 24                                                   # sample the four corners for the background colour
    corners = np.concatenate([a[:k, :k].reshape(-1, 3), a[:k, -k:].reshape(-1, 3), a[-k:, :k].reshape(-1, 3), a[-k:, -k:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    like_bg = (dist < tol).astype(np.uint8) * 255
    bgmask = connected_to_border(like_bg > 0)                # background = like-background pixels reachable from the border
    alpha = np.where(bgmask, 0.0, 1.0)
    # soften: pixels right next to the cut get a partial alpha by how far they are from the background colour
    near = np.asarray(Image.fromarray((~bgmask).astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5))) == 0   # within 2px of the edge, inside the art
    edge = near & ~bgmask
    alpha[edge] = np.clip((dist[edge] - tol * 0.5) / (tol * 1.2), 0.15, 1.0)
    out = np.dstack([a, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA'), bg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('--out', default='web/assets/sprites'); ap.add_argument('--max', type=int, default=512)
    ap.add_argument('--tol', type=float, default=26); ap.add_argument('--debug', default=None)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    if args.debug: os.makedirs(args.debug, exist_ok=True)
    manifest = {}
    for fn in sorted(os.listdir(args.src)):
        if not fn.lower().endswith(('.jpg', '.jpeg', '.png')): continue
        name = sprite_name(fn)
        if not name: print('skip (no mapping):', fn, file=sys.stderr); continue
        rgba, bg = cut_background(Image.open(os.path.join(args.src, fn)), args.tol)
        box = rgba.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
        rgba = rgba.crop((max(0, box[0] - 2), max(0, box[1] - 2), min(rgba.width, box[2] + 2), min(rgba.height, box[3] + 2)))
        if max(rgba.size) > args.max:
            s = args.max / max(rgba.size); rgba = rgba.resize((round(rgba.width * s), round(rgba.height * s)), Image.LANCZOS)
        rgba.save(os.path.join(args.out, name + '.png'), optimize=True)
        manifest[name] = {'w': rgba.width, 'h': rgba.height, 'source': fn}
        if args.debug:                                          # preview on a checkerboard so leftover background shows up
            chk = Image.new('RGBA', rgba.size, (255, 0, 255, 255)); chk.alpha_composite(rgba); chk.convert('RGB').save(os.path.join(args.debug, name + '.png'))
        print(f'{name:10s} {rgba.width}x{rgba.height}  bg={tuple(int(c) for c in bg)}  <- {fn}')
    json.dump(manifest, open(os.path.join(args.out, 'manifest.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
