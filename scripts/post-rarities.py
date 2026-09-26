# Post image "when each rarity opens": the generated scene (art/gen/posts/p8-rarities-a.png, five flasks in their
# niches, Common open, the rest sealed ever more heavily) with the rarity names and the find counts set on the ledge in
# a 5x7 pixel font, outlined in black like SNES menu text. Writes marketing/scenes/rarities.png and a clean copy.
#   python scripts/post-rarities.py
from PIL import Image

ROOT = 'E:/SOFT/alchemists/'
SRC = ROOT + 'art/gen/posts/p8-rarities-a.png'

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pixelfont import draw  # noqa: E402


base = Image.open(SRC).convert('RGB')
base.save(ROOT + 'marketing/scenes/rarities-clean.png', optimize=True)

img = base.copy()
# a soft shade over the ledge so the letters carry
shade = Image.new('RGB', img.size, (0, 0, 0))
m = Image.new('L', img.size, 0)
mp = m.load()
for y in range(548, img.height):
    a = int(min(1.0, (y - 548) / 60) * 95)
    for x in range(img.width):
        mp[x, y] = a
img.paste(shade, (0, 0), m)

TIERS = [  # flask centres on the scene, the site's tier colours (violet lifted a little to read on dark wood)
    (150, 'COMMON', (176, 182, 186), 'OPEN'),
    (410, 'UNCOMMON', (80, 196, 110), '2,500'),
    (668, 'RARE', (84, 146, 240), '5,000'),
    (928, 'EPIC', (176, 104, 236), '10,000'),
    (1188, 'LEGENDARY', (236, 180, 40), '15,000'),
]
WHITE = (242, 234, 216)
for cx, name, col, n in TIERS:
    draw(img, name, cx, 576, 4, col)
    draw(img, n, cx, 624, 6, WHITE if n != 'OPEN' else col)
draw(img, 'FINDS MINED, ALL MINERS TOGETHER', img.width // 2, 704, 3, (150, 140, 124))
img.save(ROOT + 'marketing/scenes/rarities.png', optimize=True)
print('ok')
