"""Draws CleanStream's icon (a green rounded square with a white play sign) as PNGs, with the
slight 3D look the owner picked for every app (2026-11-15, "4 is goood": icon_3d.MORE, a copy
of CleanView's tools/icon_3d.py). Drawn flat at 256, given the look, then shrunk smoothly.
Needs numpy: run with CleanView's venv Python."""
import struct, zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
GREEN, WHITE = (47, 111, 98), (255, 255, 255)


def png(path, size):
    S = 4  # supersampling for smooth edges
    n = size * S
    r = n * 0.22
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(S):
                for sx in range(S):
                    px, py = x * S + sx + .5, y * S + sy + .5
                    # rounded square
                    cx = min(max(px, r), n - r); cy = min(max(py, r), n - r)
                    if (px - cx) ** 2 + (py - cy) ** 2 > r * r:
                        continue
                    # play triangle
                    u, v = px / n, py / n
                    tri = u >= 0.36 and abs(v - 0.5) <= (0.74 - u) * 0.62 and u <= 0.74
                    c = WHITE if tri else GREEN
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            k = S * S
            a = acc[3] // k
            row += bytes([acc[0] // max(1, acc[3] // 255), acc[1] // max(1, acc[3] // 255),
                          acc[2] // max(1, acc[3] // 255), a]) if a else bytes(4)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
                     + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import icon_3d
    flat = OUT / "_flat256.png"
    png(flat, 256)
    big = icon_3d.three_d(icon_3d.png_rgba(flat.read_bytes()))
    flat.unlink()
    for s in (16, 32, 48, 128):
        (OUT / f"{s}.png").write_bytes(icon_3d.png(icon_3d.shrink(big, s)))
    print("icons written")
