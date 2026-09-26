# Post image "the rent": the generated scene (art/gen/posts/p9-rent-b.png: the Kettle over its hearth, golden steam
# arcing across the room and falling as drops) with the six soul ranks standing on the floor where the drops land, each
# with its weight in the split, in the pixel font. Writes marketing/scenes/rent.png and a clean copy.
#   python scripts/post-rent.py
import os
import sys
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from pixelfont import draw  # noqa: E402

ROOT = 'E:/SOFT/alchemists/'
SRC = ROOT + 'art/gen/posts/p9-rent-b.png'
BG = (21, 24, 28)


def soul(rank):
    """The rank's 64 px soul sprite with the site background keyed out, cropped to the art."""
    im = Image.open(ROOT + f'web/metadata/souls/{rank}.png').convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if max(abs(r - BG[0]), abs(g - BG[1]), abs(b - BG[2])) <= 6:
                px[x, y] = (0, 0, 0, 0)
    return im.crop(im.getbbox())


base = Image.open(SRC).convert('RGB')
base.save(ROOT + 'marketing/scenes/rent-clean.png', optimize=True)
img = base.convert('RGBA')

# a soft shade over the floor so the souls and the letters carry
shade = Image.new('RGBA', img.size, (0, 0, 0, 0))
sp = shade.load()
for y in range(560, img.height):
    a = int(min(1.0, (y - 560) / 70) * 110)
    for x in range(img.width):
        sp[x, y] = (0, 0, 0, a)
img = Image.alpha_composite(img, shade)

RANKS = [  # the site's rank colours: grey, green, blue, violet, gold, white
    ('APPRENTICE', (176, 182, 186), '1'),
    ('ADEPT', (80, 196, 110), '4'),
    ('MASTER', (84, 146, 240), '16'),
    ('MAGISTER', (176, 104, 236), '64'),
    ('ARCHMAGE', (236, 180, 40), '256'),
    ('NAMED', (242, 242, 242), '512'),
]
FOOT = 668  # the souls stand here
for i, (name, col, w) in enumerate(RANKS):
    cx = int(img.width * (i + 0.5) / len(RANKS))
    s = soul(i + 1)
    s = s.resize((s.width * 2, s.height * 2), Image.NEAREST)
    img.alpha_composite(s, (cx - s.width // 2, FOOT - s.height))
img = img.convert('RGB')
for i, (name, col, w) in enumerate(RANKS):
    cx = int(img.width * (i + 0.5) / len(RANKS))
    draw(img, name, cx, FOOT + 10, 3, col)
    draw(img, w, cx, FOOT + 40, 4, (242, 234, 216))
img.save(ROOT + 'marketing/scenes/rent.png', optimize=True)
print('ok')
