"""Turn the generated stage UI renders (three vial states and the gauge tube) into transparent sprites on the stage grid.

  python scripts/stage-ui.py --empty <png> --sealed <png> --ready <png> --gauge <png> [--vial-grid 64] [--gauge-grid 128]

Each render is collapsed to its pixel grid (median per block, like scripts/pixelize.py), quantised, cropped to the object
and given a transparent background. Vials go to web/img/stage-vial-{empty,sealed,ready}.png, the gauge to
web/img/stage-gauge.png, and web/img/stage-ui.json records the sizes plus the gauge's inner tube rectangle (the dark
column between the glass walls) so stage.js knows where to draw the level.
"""
import argparse, json, os, sys, urllib.request
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from pixelize import collapse, detect_block  # noqa: E402

ap = argparse.ArgumentParser()
for k in ("empty", "sealed", "ready", "gauge"):
    ap.add_argument(f"--{k}", required=True)
ap.add_argument("--vial-grid", type=int, default=64)
ap.add_argument("--gauge-grid", type=int, default=128)
ap.add_argument("--colors", type=int, default=32)
a = ap.parse_args()
root = os.path.join(os.path.dirname(__file__), "..")
BG = np.array([0x15, 0x18, 0x1c])

def fetch(src, name):
    if src.startswith("http"):
        dst = os.path.join(root, "art", "gen", "stage", f"ui-{name}.png")
        urllib.request.urlretrieve(src, dst)
        return dst
    return src

def to_grid(path, grid):
    arr = np.asarray(Image.open(path).convert("RGB"))
    if grid:
        p = arr.shape[1] // grid
        px = collapse(arr, p, 0)
    else:
        p, off = detect_block(arr)
        px = collapse(arr, p, off)
    im = Image.fromarray(px).quantize(colors=a.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    px = np.asarray(im)
    mask = np.abs(px.astype(int) - BG).sum(axis=2) > 40
    ys, xs = np.where(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    px, mask = px[y0:y1, x0:x1], mask[y0:y1, x0:x1]
    rgba = np.dstack([px, (mask * 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA"), mask

out = {}
for k in ("empty", "sealed", "ready"):
    im, _ = to_grid(fetch(getattr(a, k), f"vial-{k}"), a.vial_grid)
    im.save(os.path.join(root, "web", "img", f"stage-vial-{k}.png"))
    out[f"vial_{k}"] = {"w": im.width, "h": im.height}
    print(f"vial {k}: {im.width}x{im.height}")

gauge, mask = to_grid(fetch(a.gauge, "gauge"), a.gauge_grid)
px = np.asarray(gauge)[..., :3].astype(int)
lum = px @ np.array([0.299, 0.587, 0.114])
h, w = mask.shape
# the inner tube: in each row, the longest run of dark pixels (luma < 70) strictly inside the object; the tube is the
# vertical band of rows whose run lies in the middle third of the width
runs = []
for y in range(h):
    row = mask[y] & (lum[y] < 70)
    best = None; x = 0
    while x < w:
        if row[x]:
            s = x
            while x < w and row[x]: x += 1
            if mask[y, :s].any() and mask[y, x:].any() and (best is None or x - s > best[1] - best[0]): best = (s, x)
        else: x += 1
    if best and w / 3 <= (best[0] + best[1]) / 2 <= 2 * w / 3 and best[1] - best[0] >= 2: runs.append((y, best[0], best[1]))
if runs:
    ys = [r[0] for r in runs]
    x0 = int(np.median([r[1] for r in runs])); x1 = int(np.median([r[2] for r in runs]))
    fill = {"x0": x0, "x1": x1, "y0": min(ys), "y1": max(ys) + 1}
else:
    fill = {"x0": w // 2 - 2, "x1": w // 2 + 2, "y0": 4, "y1": h - 4}
gauge.save(os.path.join(root, "web", "img", "stage-gauge.png"))
out["gauge"] = {"w": w, "h": h, "fill": fill}
print(f"gauge: {w}x{h}, inner tube {fill}")
json.dump(out, open(os.path.join(root, "web", "img", "stage-ui.json"), "w"), indent=1)

# review sheet: the four sprites at 4x on the stage background colour
sheet = Image.new("RGBA", (4 * 4 * 40 + 40, max(h, 40) * 4 + 16), (0x15, 0x18, 0x1c, 255))
x = 8
for k in ("empty", "sealed", "ready"):
    im = Image.open(os.path.join(root, "web", "img", f"stage-vial-{k}.png"))
    sheet.alpha_composite(im.resize((im.width * 4, im.height * 4), Image.NEAREST), (x, 8)); x += im.width * 4 + 24
sheet.alpha_composite(gauge.resize((w * 4, h * 4), Image.NEAREST), (x, 8))
pv = os.path.join(root, "art", "gen", "stage", "ui-preview.png")
sheet.save(pv)
print("preview", pv)
