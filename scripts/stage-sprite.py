"""Cut a boiling-cauldron loop out of a generated video into a pixel sprite sheet for web/stage.js (mode "sprite").

  python scripts/stage-sprite.py --url <mp4 url | local path> [--frames 12] [--still web/img/stage-1.png]
                                 [--out web/img/stage-sprite.png] [--start 0.2 --end 0.9] [--colors 128]

The clip's first frame is its start image, the still, but reframed (the model letterboxes 3:2 into 4:3), so frame 0 is
aligned to the still by a small search over scale and offset and the same window is cut from every frame. Frames are
box-downsampled to the stage grid and snapped to one palette built from the clip's own pixels (never from a resized
image: resizing to a strip averages pixels into mud). Cell 0 is the clip's first frame (idle), cells 1..N the loop;
stage.js derives the count from the sheet height and plays the loop ping-pong.
"""
import argparse, os, urllib.request
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
ap.add_argument("--colors", type=int, default=128)
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
st_l = np.asarray(still.convert("L"), dtype=np.float64)

reader = imageio.get_reader(src, "ffmpeg")
frames = [f for f in reader]
reader.close()
n = len(frames)
fw, fh = frames[0].shape[1], frames[0].shape[0]
print(f"clip: {n} frames, {fw}x{fh}")

# --- align frame 0 to the still: scale the clip so its width is W*s, crop a WxH window at an offset, keep the best
def window_geo(s, dx, dy):
    wf = max(W, round(W * s)); hf = max(H, round(fh / fw * wf))
    ox = min(max((wf - W) // 2 + dx, 0), wf - W); oy = min(max((hf - H) // 2 + dy, 0), hf - H)
    return wf, hf, ox, oy

def cut(frame, geo, mode="RGB"):
    wf, hf, ox, oy = geo
    im = Image.fromarray(frame).convert(mode).resize((wf, hf), Image.BOX)
    return im.crop((ox, oy, ox + W, oy + H))

norm = lambda x: (x - x.mean()) / (x.std() + 1e-6)
best = None
for s in np.arange(1.0, 1.21, 0.025):
    for dx in range(-12, 13, 2):
        for dy in range(-12, 13, 2):
            geo = window_geo(s, dx, dy)
            f0 = np.asarray(cut(frames[0], geo, "L"), dtype=np.float64)
            err = np.abs(norm(f0) - norm(st_l)).mean()
            if best is None or err < best[0]:
                best = (err, s, dx, dy, geo)
err, s, dx, dy, geo = best
print(f"alignment: scale {s:.3f} offset ({dx},{dy}) -> window {geo}, normalised luminance error {err:.3f}")

lo, hi = int(n * a.start), int(n * a.end) - 1
idx = [round(lo + (hi - lo) * i / (a.frames - 1)) for i in range(a.frames)]
raw = [cut(frames[0], geo)] + [cut(frames[i], geo) for i in idx]

# one palette for the whole sheet, from the real pixels of a few frames stacked (no resampling anywhere)
stack = Image.new("RGB", (W, H * 4))
for k, f in enumerate([raw[0], raw[len(raw) // 3], raw[2 * len(raw) // 3], raw[-1]]):
    stack.paste(f, (0, k * H))
pal = stack.quantize(colors=a.colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
cells = [f.quantize(palette=pal, dither=Image.Dither.NONE).convert("RGB") for f in raw]

sheet = Image.new("RGB", (W, H * len(cells)))
for k, c in enumerate(cells):
    sheet.paste(c, (0, k * H))
out = os.path.join(root, a.out)
sheet.save(out, optimize=True)
print(f"wrote {out}: {len(cells)} cells of {W}x{H} (cell 0 = the clip's first frame), {os.path.getsize(out)} bytes, sampled {idx}")
prev = Image.new("RGB", (W * 3 * 3 + 12, H * 3), (0, 0, 0))
for k, c in enumerate([cells[0], cells[len(cells) // 2], cells[-1]]):
    prev.paste(c.resize((W * 3, H * 3), Image.NEAREST), (k * (W * 3 + 6), 0))
pv = os.path.join(root, "art", "gen", "stage", "sprite-preview.png")
prev.save(pv)
print("preview", pv)
