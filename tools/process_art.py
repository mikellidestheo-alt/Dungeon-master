#!/usr/bin/env python3
"""Turn the hand-made prop art (JPG on a flat dark background) into game-ready PNG sprites with transparency.

    python3 tools/process_art.py <folder-with-jpgs> [--set props|units] [--out web/assets/sprites] [--max 512] [--tol 26] [--debug dir]

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
    'Wooden_iron_dungeon_door': 'door', 'Temple': 'temple',
}


# characters (--set units): they stand on a drop shadow that is removed here; the game draws its own consistent ground shadow
UNIT_NAMES = {
    'Armored_knight': 'black_knight', 'Bile_Demon': 'bile', 'Chicken': 'chicken', 'Dark_Angel': 'dark_angel',
    'Dark_Elf_archer_standing': 'darkelf_elite', 'Dark_Elf_archer_unit': 'darkelf', 'Dwarf': 'dwarf', 'Elven_Archer': 'archer',
    'Fairy': 'fairy', 'Giant': 'giant', 'Goblin_infantry': 'goblin', 'Imp_sprite': 'imp', 'Knight_warrior': 'knight', 'Monk': 'monk',
    'Pixelated_Reaper': 'reaper', 'Pixelated_assassin': 'assassin', 'Pixelated_creature_flying': 'wasp', 'Pixelated_dark_angel': 'dark_angel_elite',
    'Pixelated_firefly': 'firefly', 'Pixelated_game_sprite_of_Bloz': 'bile_elite', 'Pixelated_game_sprite_standing': 'king',
    'Pixelated_goblin': 'goblin_elite', 'Pixelated_knight_with_fiery': 'fire_knight', 'Pixelated_rogue': 'rogue',
    'Pixelated_salamander_game': 'salamander_elite', 'Pixelated_salamander_lizard': 'salamander', 'Pixelated_skeleton': 'skeleton_knight',
    'Pixelated_spider': 'spider', 'Pixelated_warrior_on_plain': 'mistress', 'Prince_boss': 'prince', 'Royal_guard': 'guard',
    'Skeleton_warrior': 'skeleton', 'Stone_Knight': 'stone_knight', 'Thief': 'thief', 'Troll_craftsman_sprite': 'troll',
    'Troll_craftsman_with': 'troll_elite', 'Vampire_casting': 'vampire_elite', 'Vampire_spellcaster': 'vampire', 'Warlock': 'warlock', 'Wizard': 'mage',
}


def sprite_name(fn, table):
    for prefix, name in table.items():
        if fn.startswith(prefix):
            return name
    return None


def big_components(mask, min_area):
    """Keep only the 4-connected components of `mask` with at least min_area pixels (simple BFS, no scipy)."""
    h, w = mask.shape; seen = np.zeros_like(mask); out = np.zeros_like(mask)
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys.tolist(), xs.tolist()):
        if seen[y0, x0]: continue
        comp = [(y0, x0)]; seen[y0, x0] = True; i = 0
        while i < len(comp):
            y, x = comp[i]; i += 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]: seen[ny, nx] = True; comp.append((ny, nx))
        if len(comp) >= min_area:
            for y, x in comp: out[y, x] = True
    return out


NO_ENCLOSED = {'troll'}      # sprites whose own flat grey patches match their backdrop; skip the enclosed-gap pass for them


def remove_shadow(a, bgmask, bg, enclosed=True):
    """Drop shadows are flat, neutral grey, darker than the floor they were painted on but lighter than a character's own
    near-black outlines. Grow the background through such pixels so it stops at the outline (up to 120 pixels away)."""
    lum = a.mean(axis=2); bgl = float(bg.mean())
    lo = 0.45 * bgl if bgl > 110 else 0.33 * bgl                  # light backdrops give a mid-grey shadow, dark ones a dark-grey one
    cand = ((a.max(axis=2) - a.min(axis=2)) < 16) & (lum >= lo) & (lum <= bgl - 8)
    region = bgmask.copy()
    for _ in range(120):
        grown = region.copy()
        grown[1:, :] |= region[:-1, :]; grown[:-1, :] |= region[1:, :]; grown[:, 1:] |= region[:, :-1]; grown[:, :-1] |= region[:, 1:]
        grown &= (cand | bgmask)
        if (grown == region).all(): break
        region = grown
    # background showing through gaps in the artwork (inside a bow, between the legs) is enclosed, so the border fill misses it:
    # take any perfectly flat pixel that has the background colour, and on light backdrops the flat grey shadow pieces too
    g = np.zeros_like(lum)
    g[1:-1, 1:-1] = np.maximum.reduce([abs(lum[1:-1, 1:-1] - lum[:-2, 1:-1]), abs(lum[1:-1, 1:-1] - lum[2:, 1:-1]), abs(lum[1:-1, 1:-1] - lum[1:-1, :-2]), abs(lum[1:-1, 1:-1] - lum[1:-1, 2:])])
    flat = g < 4
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    extra = flat & (dist < 10)
    if bgl > 110: extra |= flat & cand
    extra &= ~region
    if enclosed: region |= big_components(extra, 700)                       # only large pockets: armour and cloth have small flat patches of the same grey
    # the removed area's soft rim: one more pixel ring so no dark halo is left around it
    rim = region.copy(); rim[1:, :] |= region[:-1, :]; rim[:-1, :] |= region[1:, :]; rim[:, 1:] |= region[:, :-1]; rim[:, :-1] |= region[:, 1:]
    return rim & (cand | bgmask | (dist < 14))


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


def cut_background(im, tol, shadows=False, enclosed=True):
    a = np.asarray(im.convert('RGB'), dtype=np.float32)
    h, w, _ = a.shape
    k = 24                                                   # sample the four corners for the background colour
    corners = np.concatenate([a[:k, :k].reshape(-1, 3), a[:k, -k:].reshape(-1, 3), a[-k:, :k].reshape(-1, 3), a[-k:, -k:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((a - bg) ** 2).sum(axis=2))
    like_bg = (dist < tol).astype(np.uint8) * 255
    bgmask = connected_to_border(like_bg > 0)                # background = like-background pixels reachable from the border
    if shadows: bgmask = remove_shadow(a, bgmask, bg, enclosed)
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
    ap.add_argument('--set', choices=['props', 'units'], default='props')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    if args.debug: os.makedirs(args.debug, exist_ok=True)
    manifest = {}
    for fn in sorted(os.listdir(args.src)):
        if not fn.lower().endswith(('.jpg', '.jpeg', '.png')): continue
        name = sprite_name(fn, UNIT_NAMES if args.set == 'units' else NAMES)
        if not name: print('skip (no mapping):', fn, file=sys.stderr); continue
        rgba, bg = cut_background(Image.open(os.path.join(args.src, fn)), args.tol, shadows=(args.set == 'units'), enclosed=name not in NO_ENCLOSED)
        box = rgba.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
        rgba = rgba.crop((max(0, box[0] - 2), max(0, box[1] - 2), min(rgba.width, box[2] + 2), min(rgba.height, box[3] + 2)))
        if max(rgba.size) > args.max:
            s = args.max / max(rgba.size); rgba = rgba.resize((round(rgba.width * s), round(rgba.height * s)), Image.LANCZOS)
        rgba.save(os.path.join(args.out, name + '.png'), optimize=True)
        manifest[name] = {'w': rgba.width, 'h': rgba.height, 'source': fn}
        if args.debug:                                          # preview on a checkerboard so leftover background shows up
            chk = Image.new('RGBA', rgba.size, (255, 0, 255, 255)); chk.alpha_composite(rgba); chk.convert('RGB').save(os.path.join(args.debug, name + '.png'))
        print(f'{name:10s} {rgba.width}x{rgba.height}  bg={tuple(int(c) for c in bg)}  <- {fn}')
    mpath = os.path.join(args.out, 'manifest.json')               # props and units share one manifest
    old = json.load(open(mpath)) if os.path.exists(mpath) else {}
    old.update(manifest); json.dump(old, open(mpath, 'w'), indent=1)


if __name__ == '__main__':
    main()
