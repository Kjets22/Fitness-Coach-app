#!/usr/bin/env python3
"""Generate the OptimalFit NATIVE splash screens — stdlib only.

Replaces the gray Capacitor template splashes with the Phase-2 brand look:
deep app background (#0a0e17, Designer-1's --bg) with the violet -> cyan
gradient dumbbell mark centered at ~25% of the splash width.

Reuses the dumbbell-glyph geometry + PNG chunk writer from
tools/make_icons.py (imported), like gen_native_icons.py does.

Outputs (resource names/sizes IDENTICAL to the Capacitor template — the
script reads each existing file's IHDR and re-renders at that exact size):

  native/android/app/src/main/res/
    drawable/splash.png                    480x320  (default/fallback)
    drawable-land-{mdpi..xxxhdpi}/splash.png
    drawable-port-{mdpi..xxxhdpi}/splash.png

  native/ios/App/App/Assets.xcassets/Splash.imageset/
    splash-2732x2732.png / -1.png / -2.png   (universal 2732x2732, same image
                                              at 3x/2x/1x per Contents.json)

Usage:  python native/scripts/gen_native_splash.py
        (then `npm run sync` is NOT needed — res/ and Assets.xcassets are
         native resources, but Android must be REBUILT to pick them up)
"""

import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # repo root (optimal-fit/)
sys.path.insert(0, os.path.join(ROOT, "tools"))

import make_icons as mi  # noqa: E402  (in_glyph, png_chunk reused)

RES = os.path.join(ROOT, "native", "android", "app", "src", "main", "res")
SPLASHSET = os.path.join(ROOT, "native", "ios", "App", "App",
                         "Assets.xcassets", "Splash.imageset")

# Brand (Designer-1 P2-2): deep bg --bg, --g1 violet -> --g2 cyan gradient mark.
BG = (0x0A, 0x0E, 0x17)   # #0a0e17
G1 = (0x8B, 0x5C, 0xF6)   # #8b5cf6
G2 = (0x22, 0xD3, 0xEE)   # #22d3ee

# Visible glyph spans x 0.135..0.865 (73%) and y 0.290..0.710 of its unit box.
GLYPH_W = 0.865 - 0.135
MARK_FRACTION = 0.25      # visible mark width as a fraction of splash width

SUB = (1 / 6, 3 / 6, 5 / 6)  # 3x3 subsample offsets (antialiasing)


def grad(x, y):
    """Diagonal gradient color at unit point (x, y): top-left G1 -> bottom-right G2."""
    t = (x + y) / 2.0
    return (G1[0] + (G2[0] - G1[0]) * t,
            G1[1] + (G2[1] - G1[1]) * t,
            G1[2] + (G2[2] - G1[2]) * t)


_mark_cache = {}


def render_mark(side):
    """Gradient dumbbell glyph on a TRANSPARENT square canvas. RGBA bytearray."""
    if side in _mark_cache:
        return _mark_cache[side]
    buf = bytearray(side * side * 4)
    # Only sweep the glyph's bounding box (plus a 2px guard) — the rest stays 0.
    px0 = max(0, int(0.135 * side) - 2)
    px1 = min(side, int(0.865 * side) + 3)
    py0 = max(0, int(0.290 * side) - 2)
    py1 = min(side, int(0.710 * side) + 3)
    for py in range(py0, py1):
        for px in range(px0, px1):
            hits = 0
            for oy in SUB:
                y = (py + oy) / side
                for ox in SUB:
                    x = (px + ox) / side
                    if mi.in_glyph(x, y, 1.0):
                        hits += 1
            if not hits:
                continue
            cx = (px + 0.5) / side
            cy = (py + 0.5) / side
            r, g, b = grad(cx, cy)
            i = (py * side + px) * 4
            buf[i] = int(r + 0.5)
            buf[i + 1] = int(g + 0.5)
            buf[i + 2] = int(b + 0.5)
            buf[i + 3] = int(hits / 9.0 * 255 + 0.5)
    _mark_cache[side] = buf
    return buf


def compose_splash(w, h):
    """Solid BG + centered gradient mark (~MARK_FRACTION of width). RGB bytes."""
    side = int(round(MARK_FRACTION * w / GLYPH_W))     # glyph box so the VISIBLE
    side = min(side, int(h * 0.9))                     # mark ~= 25% of the width
    mark = render_mark(side)
    buf = bytearray(bytes(BG) * (w * h))
    ox = (w - side) // 2
    oy = (h - side) // 2
    for my in range(side):
        row = (oy + my) * w
        for mx in range(side):
            i = (my * side + mx) * 4
            a = mark[i + 3]
            if not a:
                continue
            j = (row + ox + mx) * 3
            if a == 255:
                buf[j] = mark[i]
                buf[j + 1] = mark[i + 1]
                buf[j + 2] = mark[i + 2]
            else:
                t = a / 255.0
                buf[j] = int(buf[j] + (mark[i] - buf[j]) * t + 0.5)
                buf[j + 1] = int(buf[j + 1] + (mark[i + 1] - buf[j + 1]) * t + 0.5)
                buf[j + 2] = int(buf[j + 2] + (mark[i + 2] - buf[j + 2]) * t + 0.5)
    return buf


def write_png_rgb(path, w, h, rgb):
    """8-bit RGB PNG (color type 2), arbitrary rectangle."""
    raw = bytearray()
    stride = w * 3
    for y in range(h):
        raw.append(0)  # filter type 0
        raw += rgb[y * stride:(y + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + mi.png_chunk(b"IHDR", ihdr)
           + mi.png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + mi.png_chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def png_size(path):
    """Read (w, h) from an existing PNG's IHDR."""
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise SystemExit("BAD PNG signature: %s" % path)
    return struct.unpack(">II", head[16:24])


def check_png(path, want_w, want_h):
    """Parse the IHDR and assert dimensions + 8-bit depth."""
    with open(path, "rb") as f:
        head = f.read(33)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise SystemExit("BAD PNG signature: %s" % path)
    w, h = struct.unpack(">II", head[16:24])
    bit_depth, color_type = head[24], head[25]
    if (w, h) != (want_w, want_h) or bit_depth != 8:
        raise SystemExit("BAD PNG %s: %dx%d depth=%d (want %dx%d)"
                         % (path, w, h, bit_depth, want_w, want_h))
    print("  ok  %-88s %4dx%-4d ct=%d" % (os.path.relpath(path, ROOT), w, h, color_type))


def main():
    if not os.path.isdir(RES) or not os.path.isdir(SPLASHSET):
        raise SystemExit("Run after `npx cap add android` + `npx cap add ios` (res/Splash.imageset missing)")

    # ---- Android: every drawable*/splash.png, re-rendered at its own size ---
    targets = []
    for d in sorted(os.listdir(RES)):
        p = os.path.join(RES, d, "splash.png")
        if d.startswith("drawable") and os.path.isfile(p):
            w, h = png_size(p)
            targets.append((p, w, h))
    if not targets:
        raise SystemExit("No drawable*/splash.png found under %s" % RES)

    # ---- iOS: universal 2732x2732 x3 (identical image per Contents.json) ----
    ios_names = ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png")
    for name in ios_names:
        p = os.path.join(SPLASHSET, name)
        if not os.path.isfile(p):
            raise SystemExit("Missing template file: %s" % p)
        targets.append((p, 2732, 2732))

    made = []
    rendered = {}
    for path, w, h in targets:
        if (w, h) not in rendered:
            print("rendering %dx%d ..." % (w, h))
            rendered[(w, h)] = compose_splash(w, h)
        write_png_rgb(path, w, h, rendered[(w, h)])
        made.append((path, w, h))

    print("verifying %d PNGs:" % len(made))
    for path, w, h in made:
        check_png(path, w, h)
    print("all splash screens generated + verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
