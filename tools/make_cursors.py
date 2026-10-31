#!/usr/bin/env python3
"""Builds the mouse cursors from your two evil-hand paintings.

    python3 tools/make_cursors.py

tools/source/cursor-hand.jpg   the hand pointing (the normal cursor)
tools/source/cursor-grab.jpg   the fist holding an imp (while you carry a creature)

The paintings have a checkerboard *drawn into* the pixels (it is not real transparency, and its squares are uneven), so the background is
removed by colour: every pixel that lies on the line between the checker's two greys (and is connected to the border, or is an enclosed hole
such as the thumb loop) is background. The hand's black outline is far darker than either grey, so it stops the fill. The cut is then
grown by two source pixels to remove the JPEG halo, specks are dropped, and each hand is cropped and scaled by the same factor, so the
fist is the size of the open hand. Output:

    web/assets/cursors/hand.png, hand@2x.png, grab.png, grab@2x.png     (1x is 64 px tall at most, 2x is 128 px: the browsers' limit)
    web/cursor.css                                                       the stylesheet that applies them (generated: do not edit by hand)

Hotspots (the exact pixel that clicks): the claw tip for the pointing hand, the middle of the imp for the fist, so the creature you carry
sits where the cursor's imp is.
"""
import os
import numpy as np
from collections import deque
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'tools', 'source')
OUT = os.path.join(ROOT, 'web', 'assets', 'cursors')
A = np.array([38, 41, 50], float)       # the checker's two greys; blends between them lie on the segment A-B
B = np.array([61, 64, 74], float)
MAX_H = 64                              # 1x height of the pointing hand; the fist is scaled by the same factor
GRAB_HOT = (215, 680)                   # where the imp's middle is, in the source painting (768 x 1376)


def background_score(rgb):
    p = rgb.astype(float); ab = B - A
    t = np.clip(((p - A) @ ab) / (ab @ ab), 0, 1)
    return np.sqrt(((p - (A + t[..., None] * ab)) ** 2).sum(-1))


def components(mask):
    h, w = mask.shape; lab = np.zeros((h, w), np.int32); sizes = [0]; n = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]: continue
        n += 1; lab[y0, x0] = n; q = deque([(y0, x0)]); c = 0
        while q:
            y, x = q.popleft(); c += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not lab[yy, xx]: lab[yy, xx] = n; q.append((yy, xx))
        sizes.append(c)
    return lab, np.array(sizes)


def dilate(m, r):
    for _ in range(r):
        o = m.copy(); o[1:] |= m[:-1]; o[:-1] |= m[1:]; o[:, 1:] |= m[:, :-1]; o[:, :-1] |= m[:, 1:]
        o[1:, 1:] |= m[:-1, :-1]; o[:-1, :-1] |= m[1:, 1:]; o[1:, :-1] |= m[:-1, 1:]; o[:-1, 1:] |= m[1:, :-1]; m = o
    return m


def cut_out(path, tol=12, hole=1800, grow=2, speck=400):
    """Returns the picture and a boolean foreground mask."""
    rgb = np.array(Image.open(path).convert('RGB')); lab, sizes = components(background_score(rgb) <= tol)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.zeros(lab.shape, bool)
    for i in range(1, len(sizes)):
        if i in border or sizes[i] >= hole: bg |= (lab == i)           # connected to the edge, or a big enclosed hole
    fg = ~dilate(bg, grow)
    lab, sizes = components(fg); keep = np.zeros_like(fg); big = sizes[1:].max()
    for i in range(1, len(sizes)):
        if sizes[i] >= max(speck, 0.02 * big): keep |= (lab == i)
    return rgb, keep


def render(rgb, fg, box, scale):
    x0, y0, x1, y1 = box
    rgba = np.zeros((*fg.shape, 4), np.uint8); rgba[..., :3] = rgb; rgba[..., 3] = fg * 255
    im = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA').convert('RGBa')           # premultiplied, so no dark fringe on the edge
    return im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS).convert('RGBA')


def main():
    os.makedirs(OUT, exist_ok=True)
    hand_rgb, hand_fg = cut_out(os.path.join(SRC, 'cursor-hand.jpg')); grab_rgb, grab_fg = cut_out(os.path.join(SRC, 'cursor-grab.jpg'))
    pad = 3
    def bbox(fg):
        ys, xs = np.nonzero(fg); return (max(0, xs.min() - pad), max(0, ys.min() - pad), min(fg.shape[1], xs.max() + 1 + pad), min(fg.shape[0], ys.max() + 1 + pad))
    hb, gb = bbox(hand_fg), bbox(grab_fg)
    s1 = MAX_H / (hb[3] - hb[1])                                   # one scale for both, so the fist matches the open hand
    # the claw tip: leftmost foreground pixel among the topmost few rows
    ys, xs = np.nonzero(hand_fg); top = ys.min(); tip = (int(xs[ys <= top + 3].min()) + 2, int(top) + 2)
    hot = {'hand': ((tip[0] - hb[0]) * s1, (tip[1] - hb[1]) * s1), 'grab': ((GRAB_HOT[0] - gb[0]) * s1, (GRAB_HOT[1] - gb[1]) * s1)}
    info = {}
    for name, rgb, fg, box in (('hand', hand_rgb, hand_fg, hb), ('grab', grab_rgb, grab_fg, gb)):
        for suffix, k in (('', 1), ('@2x', 2)):
            im = render(rgb, fg, box, s1 * k); assert im.width <= 128 and im.height <= 128, (name, im.size)
            im.save(os.path.join(OUT, name + suffix + '.png'), optimize=True)
            if k == 1: info[name] = (im.width, im.height, int(round(hot[name][0])), int(round(hot[name][1])))
    for n, (w, h, x, y) in info.items(): print('%-5s %d x %d px at 1x, hotspot (%d, %d)' % (n, w, h, x, y)); assert 0 <= x < w and 0 <= y < h

    def decl(n):
        w, h, x, y = info[n]
        return ('cursor: url(assets/cursors/%s.png) %d %d, auto !important;\n  cursor: -webkit-image-set(url(assets/cursors/%s.png) 1x, url(assets/cursors/%s@2x.png) 2x) %d %d, auto !important;' % (n, x, y, n, n, x, y))
    css = """/* The Keeper's hand: the mouse cursor on every page. GENERATED by tools/make_cursors.py from tools/source/cursor-hand.jpg and cursor-grab.jpg; edit the script, not this file.
 * The first declaration is for browsers that do not know image-set(); the second gives sharp 2x cursors on high-density screens.
 * !important because pages set their own `cursor: pointer` / `crosshair` on buttons and canvases. */
*, *::before, *::after {
  %s
}
/* while you carry a creature (game.js puts the class `holding` on <html>): the fist with the imp */
html.holding, html.holding *, html.holding *::before, html.holding *::after {
  %s
}
/* typing a number still wants the text cursor */
input[type=number], input[type=text] { cursor: text !important; }
""" % (decl('hand'), decl('grab'))
    open(os.path.join(ROOT, 'web', 'cursor.css'), 'w').write(css)


if __name__ == '__main__':
    main()
