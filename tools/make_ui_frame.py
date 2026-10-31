#!/usr/bin/env python3
"""Turns the UI mockup (tools/source/ui-mockup.jpg, 1461x2000) into the page's frame artwork (web/assets/ui/frame.jpg).

The mockup is a picture of a finished interface, so its panels contain baked, garbled text. This repaints the *interiors* of the
panels (status bar, toolbar, map window, task board, log, research, help scroll and the title's subtitle strip) with clean stone,
parchment and wood textures matched to the surrounding artwork, and keeps everything else: the carved frame, gargoyles, vines, candles,
rune borders and scroll ends. The live game text and buttons are laid over those clean interiors by web/index.html.

    python3 tools/make_ui_frame.py [mockup.jpg] [out.jpg]

PANELS below are in the mockup's own pixel coordinates (x0, y0, x1, y1); index.html places its elements at the same numbers.
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

PANELS = {            # name: (rect, material)
    'hud':      ((150, 108, 1296, 193), 'stone'),
    'tools':    ((142, 205, 1302, 344), 'stone'),
    'map':      ((178, 392, 1284, 1142), 'black'),
    'task':     ((141, 1197, 718, 1492), 'parchment'),
    'log':      ((748, 1197, 1316, 1492), 'parchment'),
    'research': ((150, 1514, 1306, 1736), 'wood'),
    'help':     ((152, 1778, 1316, 1952), 'parchment'),
    'subtitle': ((515, 71, 958, 96), 'plaque'),
}
rng = np.random.default_rng(7)


def field(h, w, sigma, stretch=1.0):
    """smooth random field in about [-1, 1]: random values on a coarse grid (cell ~ 2*sigma), upscaled bicubically.
    stretch > 1 makes the cells wider than tall (wood grain)."""
    cell = max(1.0, sigma * 2)
    f = rng.standard_normal((int(h / cell) + 3, int(w / (cell * stretch)) + 3)).astype(np.float32)
    a = np.asarray(Image.fromarray(f, 'F').resize((w, h), Image.BICUBIC)); return a / (np.abs(a).max() + 1e-6)


def base_color(arr, rect, material):
    x0, y0, x1, y1 = rect
    if material == 'parchment':                                           # the paper is the bright part; the text is dark
        patch = arr[y0:y1, x0:x1].reshape(-1, 3); lum = patch.mean(axis=1)
        return np.median(patch[lum >= np.percentile(lum, 65)], axis=0)
    if material == 'plaque':                                              # left and right of the subtitle, clear of the title letters
        strips = np.concatenate([arr[y0:y1, x0 - 14:x0].reshape(-1, 3), arr[y0:y1, x1:x1 + 14].reshape(-1, 3)]); return np.median(strips, axis=0)
    ring = np.concatenate([arr[y0 - 8:y0, x0:x1].reshape(-1, 3), arr[y1:y1 + 8, x0:x1].reshape(-1, 3), arr[y0:y1, x0 - 8:x0].reshape(-1, 3), arr[y0:y1, x1:x1 + 8].reshape(-1, 3)])
    return np.median(ring, axis=0)


def paint(arr, rect, material):
    x0, y0, x1, y1 = rect; h, w = y1 - y0, x1 - x0
    if material == 'black': fill = np.zeros((h, w, 3), np.float32)
    else:
        col = base_color(arr, rect, material).astype(np.float32); amp = {'stone': 11, 'parchment': 13, 'wood': 9, 'plaque': 7}[material]
        n = 0.55 * field(h, w, 28) + 0.3 * field(h, w, 9) + 0.15 * field(h, w, 1.2)
        if material == 'wood': n = 0.5 * field(h, w, 6, stretch=14) + 0.35 * field(h, w, 22) + 0.15 * field(h, w, 1)
        fill = col[None, None, :] + n[:, :, None] * amp * np.array([1.0, 0.95, 0.85], np.float32)
        if material == 'parchment':                                       # darker, warmer edges like old paper
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); d = np.minimum.reduce([xx, w - 1 - xx, yy, h - 1 - yy]); edge = np.clip(1 - d / 38.0, 0, 1) ** 1.6
            fill = fill * (1 - 0.22 * edge)[:, :, None] * np.array([1, 0.97, 0.92], np.float32)[None, None, :]
        if material in ('stone', 'wood'):                                 # a recessed look: shade the inside of the top and left edges
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32); sh = np.clip(1 - np.minimum(yy, xx) / 16.0, 0, 1) * 0.25
            fill = fill * (1 - sh)[:, :, None]
    # feather the paste so the repainted panel melts into the artwork around it
    m = np.ones((h, w), np.float32); f = 5
    for i in range(f): k = (i + 1) / (f + 1); m[i, :] = np.minimum(m[i, :], k); m[h - 1 - i, :] = np.minimum(m[h - 1 - i, :], k); m[:, i] = np.minimum(m[:, i], k); m[:, w - 1 - i] = np.minimum(m[:, w - 1 - i], k)
    if material == 'black': m[:] = 1
    arr[y0:y1, x0:x1] = arr[y0:y1, x0:x1] * (1 - m[:, :, None]) + np.clip(fill, 0, 255) * m[:, :, None]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'tools/source/ui-mockup.jpg'; out = sys.argv[2] if len(sys.argv) > 2 else 'web/assets/ui/frame.jpg'
    arr = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
    assert arr.shape[:2] == (2000, 1461), 'the mockup is expected to be 1461x2000, got %s' % (arr.shape,)
    for name, (rect, mat) in PANELS.items(): paint(arr, rect, mat)
    Image.fromarray(arr.astype(np.uint8)).save(out, quality=88, optimize=True); print('wrote', out)


if __name__ == '__main__':
    main()
