"""Lossless PNG optimizer for the site's art.

  python scripts/optimize-pngs.py web <out_dir>

Rewrites every RGB/RGBA PNG under web/img and web/metadata that has at most 256 colors as a palette PNG (with a tRNS
chunk when a color is transparent), checks that each rewritten file decodes to byte-identical RGBA, and writes only the
files that got smaller to <out_dir>/<same path>. img/social is skipped. It also writes img/stage-sprite.webp (lossless,
checked pixel for pixel) from img/stage-sprite.png. Copy <out_dir> over web/ afterwards: the pixels are identical, so
cached copies stay correct and no ?v= bump is needed.
"""
import sys, os, io, glob, warnings
warnings.filterwarnings("ignore")
from PIL import Image

src_root, out_root = sys.argv[1], os.path.abspath(sys.argv[2])
os.chdir(src_root)


def p8(path):
    im = Image.open(path); rgba = im.convert("RGBA"); cols = rgba.getcolors(256)
    if not cols: return None  # more than 256 colors: left as it is
    pal = [c for _, c in cols]; idx = {c: i for i, c in enumerate(pal)}
    P = Image.new("P", im.size); flat = []
    for c in pal: flat += list(c[:3])
    P.putpalette(flat + [0] * (768 - len(flat)))
    P.putdata([idx[p] for p in rgba.getdata()])
    alpha = bytes(c[3] for c in pal); b = io.BytesIO()
    P.save(b, "PNG", optimize=True, **({"transparency": alpha} if any(a != 255 for a in alpha) else {}))
    data = b.getvalue()
    assert Image.open(io.BytesIO(data)).convert("RGBA").tobytes() == rgba.tobytes(), path
    return data


t0 = t1 = n = 0
for rel in sorted(glob.glob("img/**/*.png", recursive=True) + glob.glob("metadata/**/*.png", recursive=True)):
    if rel.replace("\\", "/").startswith("img/social/"): continue
    s0 = os.path.getsize(rel); data = p8(rel)
    t0 += s0
    if data and len(data) < s0:
        dst = os.path.join(out_root, rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, "wb").write(data); t1 += len(data); n += 1
    else: t1 += s0
print(f"rewritten {n} files; total {t0} -> {t1} bytes (saved {t0 - t1})")
# the stage sprite sheet as lossless WebP too
im = Image.open("img/stage-sprite.png").convert("RGB"); b = io.BytesIO(); im.save(b, "WEBP", lossless=True, quality=100, method=6)
assert Image.open(io.BytesIO(b.getvalue())).convert("RGB").tobytes() == im.tobytes()
os.makedirs(os.path.join(out_root, "img"), exist_ok=True)
open(os.path.join(out_root, "img", "stage-sprite.webp"), "wb").write(b.getvalue()); print("stage-sprite.webp", len(b.getvalue()))
