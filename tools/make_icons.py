#!/usr/bin/env python3
"""Generate the OptimalFit PWA icons as real PNGs — stdlib only (struct+zlib).

Design: rounded square in the app accent color (#4f8ef7) with a white
dumbbell glyph. Antialiased via 3x3 subsampling. Outputs into app/icons/:

    icon-192.png            192x192, rounded corners (transparent outside)
    icon-512.png            512x512, rounded corners (transparent outside)
    icon-maskable-512.png   512x512, full-bleed bg, glyph in the 80% safe zone
    apple-touch-icon.png    180x180, full-bleed (iOS applies its own mask)

Usage: python tools/make_icons.py
"""

import os
import struct
import sys
import zlib

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "app", "icons")

ACCENT = (79, 142, 247)      # --accent  #4f8ef7
ACCENT_DARK = (47, 96, 186)  # subtle bottom shade for depth
WHITE = (255, 255, 255)


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path: str, size: int, rgba: bytearray) -> None:
    """rgba = size*size*4 bytes, row-major."""
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter type 0 (None)
        raw += rgba[y * stride:(y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (b"\x89PNG\r\n\x1a\n"
           + png_chunk(b"IHDR", ihdr)
           + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + png_chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def in_rrect(x, y, x0, y0, x1, y1, r):
    """Point-in-rounded-rect test in unit coordinates."""
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    if r <= 0:
        return True
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


# Dumbbell glyph as rounded rects in unit coords (centered, |scale| applied).
def in_glyph(x, y, scale):
    # map into glyph space centered at 0.5
    gx = 0.5 + (x - 0.5) / scale
    gy = 0.5 + (y - 0.5) / scale
    parts = (
        (0.315, 0.464, 0.685, 0.536, 0.015),  # bar
        (0.225, 0.290, 0.315, 0.710, 0.030),  # inner plate L
        (0.685, 0.290, 0.775, 0.710, 0.030),  # inner plate R
        (0.135, 0.365, 0.210, 0.635, 0.028),  # outer plate L
        (0.790, 0.365, 0.865, 0.635, 0.028),  # outer plate R
    )
    for (x0, y0, x1, y1, r) in parts:
        if in_rrect(gx, gy, x0, y0, x1, y1, r):
            return True
    return False


def render(size: int, corner_r: float, glyph_scale: float) -> bytearray:
    """corner_r: bg corner radius in unit coords (0 = full-bleed square)."""
    buf = bytearray(size * size * 4)
    sub = ((1 / 6), (3 / 6), (5 / 6))  # 3x3 subsample offsets
    for py in range(size):
        for px in range(size):
            bg_hits = 0
            glyph_hits = 0
            shade_hits = 0
            for oy in sub:
                y = (py + oy) / size
                for ox in sub:
                    x = (px + ox) / size
                    if in_rrect(x, y, 0.0, 0.0, 1.0, 1.0, corner_r):
                        bg_hits += 1
                        if y > 0.78:            # subtle darker band at bottom
                            shade_hits += 1
                        if in_glyph(x, y, glyph_scale):
                            glyph_hits += 1
            if not bg_hits:
                continue  # fully transparent
            a = bg_hits / 9.0
            # base color: accent, blended toward the darker shade band
            t_sh = shade_hits / bg_hits * 0.35
            r = ACCENT[0] + (ACCENT_DARK[0] - ACCENT[0]) * t_sh
            g = ACCENT[1] + (ACCENT_DARK[1] - ACCENT[1]) * t_sh
            b = ACCENT[2] + (ACCENT_DARK[2] - ACCENT[2]) * t_sh
            # glyph on top
            t_gl = glyph_hits / bg_hits
            r += (WHITE[0] - r) * t_gl
            g += (WHITE[1] - g) * t_gl
            b += (WHITE[2] - b) * t_gl
            i = (py * size + px) * 4
            buf[i] = int(r + 0.5)
            buf[i + 1] = int(g + 0.5)
            buf[i + 2] = int(b + 0.5)
            buf[i + 3] = int(a * 255 + 0.5)
    return buf


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    jobs = (
        ("icon-192.png", 192, 0.20, 1.00),
        ("icon-512.png", 512, 0.20, 1.00),
        ("icon-maskable-512.png", 512, 0.0, 0.78),  # glyph inside 80% safe zone
        ("apple-touch-icon.png", 180, 0.0, 1.00),   # iOS masks it itself
    )
    for name, size, corner, scale in jobs:
        path = os.path.join(OUT, name)
        write_png(path, size, render(size, corner, scale))
        print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
