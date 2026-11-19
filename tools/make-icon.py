#!/usr/bin/env python3
"""Generate the SI AIDLC app icon (512x512 PNG) with the Python stdlib only.

Design: a dark navy field with a 300-degree zen ring (emerald -> cyan gradient
stroke, node dots at both open ends) and a subtle three-node circuit motif
inside - the AI-DLC lifecycle as an open, continuous loop.

Run:  python tools/make-icon.py     (writes assets/icon.png)
"""

import math
import struct
import sys
import zlib
from pathlib import Path

W = H = 512
CX = CY = 256.0
R_IN, R_OUT = 137.0, 163.0  # ring band
A_START, A_END = 120.0, 420.0  # arc sweep (deg, image coords, y down); 60-deg gap at bottom
DOT_R = 21.0  # endpoint node dots
MOTIF_R = 55.0  # motif distance from center
MOTIF_RR = 9.0  # motif dot radius
LINE_W = 3.0  # motif connector width

BG = (15, 23, 42)  # #0f172a
C0 = (52, 211, 153)  # #34d399 emerald
C1 = (34, 211, 238)  # #22d3ee cyan
SLATE = (148, 163, 184)  # #94a3b8


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c0, c1, t):
    return (lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t))


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def arc_color(theta_deg):
    t = (theta_deg - A_START) / (A_END - A_START)
    return mix(C0, C1, t)


def pt(theta_deg, r):
    a = math.radians(theta_deg)
    return (CX + r * math.cos(a), CY + r * math.sin(a))


E0, E1 = pt(A_START, (R_IN + R_OUT) / 2), pt(A_END, (R_IN + R_OUT) / 2)
MOTIF = [pt(270, MOTIF_R), pt(150, MOTIF_R), pt(30, MOTIF_R)]


def seg_cov(px, py, ax, ay, bx, by, r):
    """Feathered coverage of point (px,py) over segment AB with radius r."""
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
    cx, cy = ax + t * vx, ay + t * vy
    dd = math.hypot(px - cx, py - cy)
    return 1.0 - smoothstep(r - 0.8, r + 0.8, dd)


def pixel(x, y):
    px, py = x + 0.5, y + 0.5
    dx, dy = px - CX, py - CY
    d = math.hypot(dx, dy)
    col = BG

    # ring (gradient arc with a gap at the bottom)
    if R_IN - 1.5 < d < R_OUT + 1.5:
        th = math.degrees(math.atan2(dy, dx)) % 360.0
        a = th + 360.0 if th < A_END - 360.0 else th  # map into [120, 420]
        c_ang = min(
            smoothstep(A_START - 0.6, A_START + 0.6, a),
            1.0 - smoothstep(A_END - 0.6, A_END + 0.6, a),
        )
        c_rad = smoothstep(R_IN - 0.8, R_IN + 0.8, d) * (
            1.0 - smoothstep(R_OUT - 0.8, R_OUT + 0.8, d)
        )
        c = c_ang * c_rad
        if c > 0:
            gc = arc_color(a)
            col = (lerp(col[0], gc[0], c), lerp(col[1], gc[1], c), lerp(col[2], gc[2], c))

    # endpoint node dots
    for ex, ey, cc in ((E0[0], E0[1], C0), (E1[0], E1[1], C1)):
        c = 1.0 - smoothstep(DOT_R - 0.8, DOT_R + 0.8, math.hypot(px - ex, py - ey))
        if c > 0:
            col = (lerp(col[0], cc[0], c), lerp(col[1], cc[1], c), lerp(col[2], cc[2], c))

    # subtle circuit motif: three connected nodes
    for i in range(3):
        ax, ay = MOTIF[i]
        bx, by = MOTIF[(i + 1) % 3]
        c = seg_cov(px, py, ax, ay, bx, by, LINE_W / 2 + 0.6)
        if c > 0:
            a = c * 0.5
            col = (lerp(col[0], SLATE[0], a), lerp(col[1], SLATE[1], a), lerp(col[2], SLATE[2], a))
    for mx, my in MOTIF:
        c = 1.0 - smoothstep(MOTIF_RR - 0.8, MOTIF_RR + 0.8, math.hypot(px - mx, py - my))
        if c > 0:
            col = (lerp(col[0], C1[0], c), lerp(col[1], C1[1], c), lerp(col[2], C1[2], c))

    return (int(col[0]), int(col[1]), int(col[2]), 255)


def write_png(path, rows):
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    idat = chunk(b"IDAT", zlib.compress(raw, 9))
    iend = chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(sig + ihdr + idat + iend)


def main():
    rows = []
    for y in range(H):
        row = bytearray()
        for x in range(W):
            row.extend(pixel(x, y))
        rows.append(bytes(row))
    out = Path(__file__).resolve().parent.parent / "assets" / "icon.png"
    write_png(out, rows)
    print("wrote %s (%d bytes)" % (out, out.stat().st_size))


if __name__ == "__main__":
    sys.exit(main())
