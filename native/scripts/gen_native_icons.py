#!/usr/bin/env python3
"""Generate the OptimalFit NATIVE launcher/app icons — stdlib only.

Reuses the dumbbell-glyph geometry + PNG chunk writer from
tools/make_icons.py (imported), but renders the Phase-2 brand look:
a violet -> cyan diagonal gradient (#8b5cf6 -> #22d3ee, Designer-1's
--grad) with the white dumbbell mark.

Outputs (all paths relative to the repo root):

  native/android/app/src/main/res/
    mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png        48/72/96/144/192, gradient, rounded corners
    mipmap-{...}/ic_launcher_round.png                             same sizes, circle mask
    mipmap-{...}/ic_launcher_foreground.png                        108/162/216/324/432, TRANSPARENT bg,
                                                                   white mark inside the 66/108 safe zone
    values/ic_launcher_background.xml                              solid brand background color (violet)
    (mipmap-anydpi-v26/ic_launcher{,_round}.xml already reference
     @color/ic_launcher_background + @mipmap/ic_launcher_foreground
     from the Capacitor template — names kept, nothing to change)

  native/ios/App/App/Assets.xcassets/AppIcon.appiconset/
    AppIcon-512@2x.png   1024x1024 RGB **without alpha** (App Store rejects
                         alpha in the marketing icon) — filename + single-size
                         Contents.json kept from the Capacitor template.

Usage:  python native/scripts/gen_native_icons.py
        (re-run any time the brand changes; then rebuild Android / re-archive iOS)
"""

import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # repo root (optimal-fit/)
sys.path.insert(0, os.path.join(ROOT, "tools"))

import make_icons as mi  # noqa: E402  (in_rrect, in_glyph, png_chunk reused)

RES = os.path.join(ROOT, "native", "android", "app", "src", "main", "res")
APPICONSET = os.path.join(ROOT, "native", "ios", "App", "App",
                          "Assets.xcassets", "AppIcon.appiconset")

# Brand (Designer-1 P2-2): --g1 violet -> --g2 cyan, white mark.
G1 = (0x8B, 0x5C, 0xF6)   # #8b5cf6
G2 = (0x22, 0xD3, 0xEE)   # #22d3ee
WHITE = (255, 255, 255)
BG_COLOR_XML = "#8B5CF6"  # adaptive-icon background layer (solid violet)

DENSITIES = (("mdpi", 48, 108), ("hdpi", 72, 162), ("xhdpi", 96, 216),
             ("xxhdpi", 144, 324), ("xxxhdpi", 192, 432))

SUB = (1 / 6, 3 / 6, 5 / 6)  # 3x3 subsample offsets (antialiasing)


def grad(x, y):
    """Diagonal gradient color at unit point (x, y): top-left G1 -> bottom-right G2."""
    t = (x + y) / 2.0
    return (G1[0] + (G2[0] - G1[0]) * t,
            G1[1] + (G2[1] - G1[1]) * t,
            G1[2] + (G2[2] - G1[2]) * t)


def render_badge(size, corner_r, glyph_scale):
    """Gradient rounded-square (corner_r=0.5 -> circle) + white glyph. RGBA."""
    buf = bytearray(size * size * 4)
    for py in range(size):
        for px in range(size):
            bg_hits = 0
            glyph_hits = 0
            for oy in SUB:
                y = (py + oy) / size
                for ox in SUB:
                    x = (px + ox) / size
                    if mi.in_rrect(x, y, 0.0, 0.0, 1.0, 1.0, corner_r):
                        bg_hits += 1
                        if mi.in_glyph(x, y, glyph_scale):
                            glyph_hits += 1
            if not bg_hits:
                continue
            cx = (px + 0.5) / size
            cy = (py + 0.5) / size
            r, g, b = grad(cx, cy)
            t = glyph_hits / bg_hits
            r += (WHITE[0] - r) * t
            g += (WHITE[1] - g) * t
            b += (WHITE[2] - b) * t
            i = (py * size + px) * 4
            buf[i] = int(r + 0.5)
            buf[i + 1] = int(g + 0.5)
            buf[i + 2] = int(b + 0.5)
            buf[i + 3] = int(bg_hits / 9.0 * 255 + 0.5)
    return buf


def render_foreground(size, glyph_scale):
    """White glyph on a fully TRANSPARENT canvas (adaptive foreground). RGBA."""
    buf = bytearray(size * size * 4)
    for py in range(size):
        for px in range(size):
            hits = 0
            for oy in SUB:
                y = (py + oy) / size
                for ox in SUB:
                    x = (px + ox) / size
                    if mi.in_glyph(x, y, glyph_scale):
                        hits += 1
            if not hits:
                continue
            i = (py * size + px) * 4
            buf[i] = buf[i + 1] = buf[i + 2] = 255
            buf[i + 3] = int(hits / 9.0 * 255 + 0.5)
    return buf


def write_png_rgba(path, size, rgba):
    """8-bit RGBA PNG (color type 6) — same layout tools/make_icons.py writes."""
    mi.write_png(path, size, rgba)


def write_png_rgb(path, size, rgba):
    """8-bit RGB PNG (color type 2, NO alpha channel) from an RGBA buffer.

    Alpha is flattened by assumption: callers pass fully opaque buffers
    (full-bleed render). App Store requires the 1024 marketing icon
    to carry no alpha channel at all.
    """
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type 0
        row = rgba[y * size * 4:(y + 1) * size * 4]
        for x in range(size):
            raw += row[x * 4:x * 4 + 3]
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # color type 2 = RGB
    png = (b"\x89PNG\r\n\x1a\n"
           + mi.png_chunk(b"IHDR", ihdr)
           + mi.png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + mi.png_chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


def check_png(path, want_size, want_color_type):
    """Parse the IHDR and assert dimensions + color type."""
    with open(path, "rb") as f:
        head = f.read(33)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        raise SystemExit("BAD PNG signature: %s" % path)
    w, h = struct.unpack(">II", head[16:24])
    bit_depth, color_type = head[24], head[25]
    if (w, h) != (want_size, want_size) or bit_depth != 8 or color_type != want_color_type:
        raise SystemExit("BAD PNG %s: %dx%d depth=%d colortype=%d (want %d, ct %d)"
                         % (path, w, h, bit_depth, color_type, want_size, want_color_type))
    print("  ok  %-90s %4dx%-4d ct=%d" % (os.path.relpath(path, ROOT), w, h, color_type))


def main():
    if not os.path.isdir(RES) or not os.path.isdir(APPICONSET):
        raise SystemExit("Run after `npx cap add android` + `npx cap add ios` (res/appiconset missing)")

    made = []  # (path, size, color_type)

    # ---- Android legacy + round + adaptive-foreground mipmaps -------------
    for density, legacy, fg in DENSITIES:
        d = os.path.join(RES, "mipmap-" + density)
        os.makedirs(d, exist_ok=True)

        p = os.path.join(d, "ic_launcher.png")
        write_png_rgba(p, legacy, render_badge(legacy, corner_r=0.14, glyph_scale=1.00))
        made.append((p, legacy, 6))

        p = os.path.join(d, "ic_launcher_round.png")
        write_png_rgba(p, legacy, render_badge(legacy, corner_r=0.5, glyph_scale=0.92))
        made.append((p, legacy, 6))

        # Adaptive foreground: mark must sit inside the central 66dp of the
        # 108dp canvas (safe zone = 66/108 ~ 61% of the width). The glyph
        # spans 73% of the unit square at scale 1, so scale 0.60 keeps it
        # comfortably inside the safe zone under every launcher mask.
        p = os.path.join(d, "ic_launcher_foreground.png")
        write_png_rgba(p, fg, render_foreground(fg, glyph_scale=0.60))
        made.append((p, fg, 6))

    # ---- Adaptive background color (referenced by mipmap-anydpi-v26 XMLs) --
    bg_xml = os.path.join(RES, "values", "ic_launcher_background.xml")
    with open(bg_xml, "w", encoding="utf-8", newline="\n") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">%s</color>\n</resources>\n'
                % BG_COLOR_XML)
    print("wrote %s (%s)" % (os.path.relpath(bg_xml, ROOT), BG_COLOR_XML))

    # ---- iOS single-size marketing/app icon: 1024 RGB, no alpha -----------
    p = os.path.join(APPICONSET, "AppIcon-512@2x.png")
    write_png_rgb(p, 1024, render_badge(1024, corner_r=0.0, glyph_scale=1.00))
    made.append((p, 1024, 2))

    print("verifying %d PNGs:" % len(made))
    for path, size, ct in made:
        check_png(path, size, ct)
    print("all icons generated + verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
