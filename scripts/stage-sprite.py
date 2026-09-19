"""Cut a boiling-cauldron loop out of a generated video into a pixel sprite sheet for web/stage.js (mode "sprite").

  python scripts/stage-sprite.py --url <mp4 url | local path> [--frames 12] [--still web/img/stage-1.png]
                                 [--out web/img/stage-sprite.png] [--start 0.2 --end 0.9]

Frames are sampled evenly between --start and --end of the clip (the ignition at the start and the fade at the end
are skipped), centre-cropped to the still's aspect, box-downsampled to the stage grid (255x171) and quantised to the
still's palette plus fire and steam swatches, so the loop sits on the same colours as the static background. The sheet
stacks the frames vertically; stage.js derives the frame count from the sheet height and plays it ping-pong.
"""
import argparse, os, sys, urllib.request
import numpy as np
from PIL import Image
import imageio.v2 as imageio

ap = argparse.ArgumentParser()
ap.add_argument("--url", required=True)
ap.add_argument("--frames", type=int, default=12)
ap.add_argument("--still", default="web/img/stage-1.png")
ap.add_argument("--out", default="web/img/stage-sprite.png")
ap.add_argument("--start", type=float, default=0.2)
ap.add_argument("--end", type=float, default=0.9)
ap.add_argument("--colors", type=int, default=96)
a = ap.parse_args()

root = os.path.join(os.path.dirname(__file__), "..")
src = a.url
if src.startswith("http"):
    os.makedirs(os.path.join(root, "art", "gen", "stage"), exist_ok=True)
    src = os.path.join(root, "art", "gen", "stage", "boil.mp4")
    urllib.request.urlretrieve(a.url, src)
    print("downloaded", src, os.path.getsize(src), "bytes")

still = Image.open(os.path.join(root, a.still)).convert("RGB")
W, H = still.size
# palette: the still's colours plus the fire and steam ramp stage.js draws with
swatch = Image.new("RGB", (8, 1))
for i, c in enumerate(["#ffe680", "#ff9a2e", "#c8422a", "#5a1e14", "#fff9e6", "#c9c4b6", "#6b7176", "#35c9e8"]):
    swatch.putpixel((i, 0), tuple(int(c[j:j + 2], 16) for j in (1, 3, 5)))
pal_src = Image.new("RGB", (W * H + 8 * 40, 1))
pal_src.paste(still.resize((W * H, 1)), (0, 0))
pal_src.paste(swatch.resize((8 * 40, 1)), (W * H, 0))
pal = pal_src.quantize(colors=a.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)

reader = imageio.get_reader(src, "ffmpeg")
meta = reader.get_meta_data()
fps = meta.get("fps", 24)
frames = [f for f in reader]
reader.close()
n = len(frames)
print(f"clip: {n} frames at {fps} fps, {frames[0].shape[1]}x{frames[0].shape[0]}")
lo, hi = int(n * a.start), int(n * a.end) - 1
idx = [round(lo + (hi - lo) * i / (a.frames - 1)) for i in range(a.frames)]

def to_cell(arr):
    im = Image.fromarray(arr).convert("RGB")
    w, h = im.size
    target = W / H
    if w / h > target:
        nw = round(h * target); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = round(w / target); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    im = im.resize((W, H), Image.BOX)
    return im.quantize(palette=pal, dither=Image.Dither.NONE).convert("RGB")

cells = [to_cell(frames[i]) for i in idx]
sheet = Image.new("RGB", (W, H * len(cells)))
for k, c in enumerate(cells):
    sheet.paste(c, (0, k * H))
out = os.path.join(root, a.out)
sheet.save(out, optimize=True)
print(f"wrote {out}: {len(cells)} frames of {W}x{H}, {os.path.getsize(out)} bytes, sampled indices {idx}")
# preview strip for review: first, middle and last frame side by side, scaled 3x
prev = Image.new("RGB", (W * 3 * 3 + 12, H * 3), (0, 0, 0))
for k, c in enumerate([cells[0], cells[len(cells) // 2], cells[-1]]):
    prev.paste(c.resize((W * 3, H * 3), Image.NEAREST), (k * (W * 3 + 6), 0))
pv = os.path.join(root, "art", "gen", "stage", "sprite-preview.png")
prev.save(pv)
print("preview", pv)
