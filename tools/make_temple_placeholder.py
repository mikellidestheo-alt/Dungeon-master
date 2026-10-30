#!/usr/bin/env python3
"""Draws a PLACEHOLDER temple altar sprite (web/assets/sprites/temple.png) until real art exists.
Replace the PNG with your own (any size, transparent background, ground contact near the bottom) and tune `temple` in render3d.js."""
import sys
from PIL import Image, ImageDraw

W, H, S = 80, 62, 4                                            # drawn at 80x62 and scaled x4 so it reads as chunky pixel art
im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
def diamond(cx, cy, hw, hh): return [(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)]
def slab(cx, cy, hw, hh, th, top, left, right, line):
    d.polygon([(cx - hw, cy), (cx, cy + hh), (cx, cy + hh + th), (cx - hw, cy + th)], fill=left, outline=line)
    d.polygon([(cx + hw, cy), (cx, cy + hh), (cx, cy + hh + th), (cx + hw, cy + th)], fill=right, outline=line)
    d.polygon(diamond(cx, cy, hw, hh), fill=top, outline=line)
slab(40, 40, 34, 16, 6, (70, 66, 86), (42, 40, 56), (32, 30, 44), (18, 16, 26))                # stone platform
slab(40, 33, 22, 10, 5, (92, 86, 112), (54, 50, 70), (40, 38, 56), (18, 16, 26))               # step
d.polygon(diamond(40, 31, 16, 7), outline=(255, 210, 90), fill=(66, 54, 40))                    # glowing rune ring
d.polygon(diamond(40, 31, 10, 4), outline=(255, 235, 150), fill=(110, 84, 40))
slab(40, 25, 9, 4, 8, (120, 112, 140), (70, 64, 90), (52, 48, 70), (18, 16, 26))                # the altar block
d.polygon(diamond(40, 25, 5, 2), fill=(255, 220, 110))
for cx in (16, 64):                                                                             # two candles
    d.rectangle((cx - 1, 30, cx + 1, 40), fill=(226, 214, 190), outline=(60, 50, 40))
    d.polygon([(cx, 24), (cx + 2, 29), (cx, 31), (cx - 2, 29)], fill=(255, 190, 60)); d.point((cx, 28), fill=(255, 245, 190))
im = im.resize((W * S, H * S), Image.NEAREST)
out = sys.argv[1] if len(sys.argv) > 1 else 'web/assets/sprites/temple.png'
im.save(out, optimize=True); print('wrote', out, im.size)
