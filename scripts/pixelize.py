"""Turn generated icon PNGs into true pixel-grid assets and add the tier aura.

  python scripts/pixelize.py art/probes/A1-grimoire.png [more.png] [--out art/pixel] [--colors 32] [--grid 0]

Detects the block size of an upscaled pixel-art render (or takes --grid N), collapses every block to its
median colour, quantises to a limited palette, then writes the native-grid PNG and five 512px previews,
one per tier: Common bare, Uncommon green, Rare blue, Epic purple, Legendary gold aura.
"""
import argparse, os
from PIL import Image
import numpy as np

BG = (0x15, 0x18, 0x1c)
AURA = {1: (0x3f, 0xae, 0x5a), 2: (0x3b, 0x7d, 0xdd), 3: (0x8e, 0x44, 0xd1), 4: (0xd9, 0xa2, 0x1b)}

def detect_block(a):
    dc = np.abs(np.diff(a, axis=1)).sum(axis=(0, 2)).astype(float)
    scores = {}
    for p in range(4, 41):
        scores[p] = max(dc[ph::p].mean() for ph in range(p)) / dc.mean()
    top = max(scores.values())
    p = min(q for q, s in scores.items() if s >= 0.95 * top)
    ph = max(range(p), key=lambda k: dc[k::p].mean())
    return p, (ph + 1) % p

def collapse(a, p, off):
    h, w, _ = a.shape
    a = a[off:, off:]
    gh, gw = a.shape[0] // p, a.shape[1] // p
    blocks = a[: gh * p, : gw * p].reshape(gh, p, gw, p, 3).transpose(0, 2, 1, 3, 4).reshape(gh, gw, p * p, 3)
    return np.median(blocks, axis=2).astype(np.uint8)

def object_mask(px):
    d = np.abs(px.astype(int) - np.array(BG)).sum(axis=2)
    return d > 40

def dilate(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx > r * r + r:
                continue
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out

def with_aura(px, tier):
    if tier == 0:
        return px
    col = np.array(AURA.get(tier, (0xf2, 0xf2, 0xf2)), dtype=np.uint8)
    m = object_mask(px)
    inner = dilate(m, 1) & ~m
    outer = dilate(m, 2) & ~dilate(m, 1)
    yy, xx = np.indices(m.shape)
    checker = (yy + xx) % 2 == 0
    out = px.copy()
    out[inner] = col
    dim = ((col.astype(int) + np.array(BG)) // 2).astype(np.uint8)
    out[outer & checker] = dim
    if tier == 5:
        # mythic: white aura plus a few sparkle pixels in a wider halo, deterministic per image
        halo = dilate(m, 5) & ~dilate(m, 2)
        ys, xs = np.nonzero(halo)
        rng = np.random.default_rng(int(m.sum()))
        pick = rng.choice(len(ys), size=min(len(ys), max(6, len(ys) // 40)), replace=False)
        out[ys[pick], xs[pick]] = col
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", default="art/pixel")
    ap.add_argument("--colors", type=int, default=32)
    ap.add_argument("--grid", type=int, default=0, help="force grid size (e.g. 64); 0 = detect block")
    ap.add_argument("--preview", type=int, default=512)
    ap.add_argument("--mythic", action="store_true", help="write <name>.png with the white mythic aura instead of five tiers")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for f in args.files:
        im = Image.open(f).convert("RGB")
        a = np.asarray(im)
        if args.grid:
            p, off = a.shape[1] // args.grid, 0
        else:
            p, off = detect_block(a)
        px = collapse(a, p, off)
        small = Image.fromarray(px)
        q = small.quantize(colors=args.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
        px = np.asarray(q).copy()
        # snap near-background pixels to the exact background colour
        px[~object_mask(px)] = BG
        name = os.path.splitext(os.path.basename(f))[0]
        g = px.shape[0]
        Image.fromarray(px).save(os.path.join(args.out, f"{name}-{g}.png"))
        scale = max(1, args.preview // g)
        if args.mythic:
            Image.fromarray(with_aura(px, 5)).resize((g * scale, g * scale), Image.NEAREST).save(os.path.join(args.out, f"{name}.png"))
            print(f"{f}: block {p}px -> grid {g}x{g}, mythic aura")
            continue
        for tier in range(5):
            Image.fromarray(with_aura(px, tier)).resize((g * scale, g * scale), Image.NEAREST).save(
                os.path.join(args.out, f"{name}-t{tier}.png"))
        print(f"{f}: block {p}px offset {off} -> grid {g}x{g}, colours {len(q.getcolors(1 << 20))}")

if __name__ == "__main__":
    main()
