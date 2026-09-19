"""Cut a boiling-cauldron loop out of a generated video into a pixel sprite sheet for web/stage.js (mode "sprite").

  python scripts/stage-sprite.py --url <mp4 url | local path> [--frames 12] [--still web/img/stage-1.png]
                                 [--out web/img/stage-sprite.png] [--start 0.2 --end 0.9]

The clip only supplies motion; every colour comes from the still. Video models wash the hues of pixel art into one
sepia, so the frames are not used as images: the clip's first frame (its start image is the still) is aligned to the
still by a small search over scale and offset, then each frame becomes a map of how its luminance changed against
frame 0, and that change is painted onto the still's own pixels. Brightening below the cauldron becomes fire on the
ember ramp, brightening above it becomes steam and bubbles on the steam ramp, darkening dims the still. Cell 0 is the
untouched still (idle), cells 1..N are the loop; the sheet stacks them vertically and stage.js plays them ping-pong.
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
ap.add_argument("--split", type=int, default=100, help="grid row: brightening above it is steam, below it is fire")
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
st = np.asarray(still, dtype=np.float64)
lum = lambda rgb: rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
st_l = lum(st)

reader = imageio.get_reader(src, "ffmpeg")
frames = [f for f in reader]
reader.close()
n = len(frames)
fw, fh = frames[0].shape[1], frames[0].shape[0]
print(f"clip: {n} frames, {fw}x{fh}")

# --- align frame 0 to the still: scale the clip so its width is W*s, crop a WxH window at an offset, pick the best
def window(frame, s, dx, dy):
    im = Image.fromarray(frame).convert("L") if frame.ndim == 3 else Image.fromarray(frame)
    wf = max(W, round(W * s)); hf = max(H, round(fh / fw * wf))
    im = im.resize((wf, hf), Image.BOX)
    ox = (wf - W) // 2 + dx; oy = (hf - H) // 2 + dy
    ox = min(max(ox, 0), wf - W); oy = min(max(oy, 0), hf - H)
    return np.asarray(im.crop((ox, oy, ox + W, oy + H)), dtype=np.float64), (wf, hf, ox, oy)

def norm(x):
    return (x - x.mean()) / (x.std() + 1e-6)

best = None
for s in np.arange(0.90, 1.16, 0.025):
    for dx in range(-12, 13, 2):
        for dy in range(-12, 13, 2):
            f0, geo = window(frames[0], s, dx, dy)
            err = np.abs(norm(f0) - norm(st_l)).mean()
            if best is None or err < best[0]:
                best = (err, s, dx, dy, geo)
err, s, dx, dy, geo = best
print(f"alignment: scale {s:.3f} offset ({dx},{dy}) -> window {geo}, normalised luminance error {err:.3f}")

def grid(frame):
    wf, hf, ox, oy = geo
    im = Image.fromarray(frame).convert("RGB").resize((wf, hf), Image.BOX)
    return np.asarray(im.crop((ox, oy, ox + W, oy + H)), dtype=np.float64)

l0 = lum(grid(frames[0]))
# match the clip's exposure to the still on the static scene so a plain frame gives ratio 1 everywhere
gain = (st_l.mean() + 1) / (l0.mean() + 1)
l0 = l0 * gain

RAMP_FIRE = [(0, (0x5a, 0x1e, 0x14)), (18, (0xc8, 0x42, 0x2a)), (40, (0xff, 0x9a, 0x2e)), (70, (0xff, 0xe6, 0x80))]
RAMP_STEAM = [(0, (0x6b, 0x71, 0x76)), (25, (0xc9, 0xc4, 0xb6)), (60, (0xff, 0xf9, 0xe6))]
def ramp(table, v):
    out = np.zeros(v.shape + (3,))
    for i in range(3):
        xs = [t[0] for t in table]; ys = [t[1][i] for t in table]
        out[..., i] = np.interp(v, xs, ys)
    return out

yy = np.arange(H)[:, None]
def to_cell(frame):
    lk = lum(grid(frame)) * gain
    delta = lk - l0                                        # brighter than the cold scene: fire, steam, bubbles
    ratio = np.clip((lk + 6) / (l0 + 6), 0.35, 1.6)[..., None]
    base = np.clip(st * ratio, 0, 255)                     # the still, dimmed or lit by the clip
    up = np.clip(delta - 10, 0, None)                      # brightening beyond noise
    t = np.clip(up / 40, 0, 1)[..., None]
    fire = ramp(RAMP_FIRE, up); steam = ramp(RAMP_STEAM, up)
    glow = np.where((yy >= a.split)[..., None], fire, steam)
    out = base * (1 - t) + glow * t
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

# palette: the still plus the two ramps, so the loop never leaves the scene's colours
sw = Image.new("RGB", (16, 1))
cols = [tuple(int(v) for v in ramp(RAMP_FIRE, np.array([x]))[0]) for x in (0, 10, 20, 30, 40, 55, 70, 90)] + [tuple(int(v) for v in ramp(RAMP_STEAM, np.array([x]))[0]) for x in (0, 8, 16, 25, 35, 45, 60, 80)]
for i, c in enumerate(cols): sw.putpixel((i, 0), c)
pal_src = Image.new("RGB", (W * H + 16 * 60, 1))
pal_src.paste(still.resize((W * H, 1)), (0, 0)); pal_src.paste(sw.resize((16 * 60, 1)), (W * H, 0))
pal = pal_src.quantize(colors=112, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
snap = lambda im: im.quantize(palette=pal, dither=Image.Dither.NONE).convert("RGB")

lo, hi = int(n * a.start), int(n * a.end) - 1
idx = [round(lo + (hi - lo) * i / (a.frames - 1)) for i in range(a.frames)]
cells = [still] + [snap(to_cell(frames[i])) for i in idx]
sheet = Image.new("RGB", (W, H * len(cells)))
for k, c in enumerate(cells):
    sheet.paste(c, (0, k * H))
out = os.path.join(root, a.out)
sheet.save(out, optimize=True)
print(f"wrote {out}: {len(cells)} cells of {W}x{H} (cell 0 = the still), {os.path.getsize(out)} bytes, sampled {idx}")
prev = Image.new("RGB", (W * 3 * 3 + 12, H * 3), (0, 0, 0))
for k, c in enumerate([cells[0], cells[len(cells) // 2], cells[-1]]):
    prev.paste(c.resize((W * 3, H * 3), Image.NEAREST), (k * (W * 3 + 6), 0))
pv = os.path.join(root, "art", "gen", "stage", "sprite-preview.png")
prev.save(pv)
print("preview", pv)
