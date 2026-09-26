# Post image for one hour's pour: the generated scene (art/gen/posts/p10-pour-a.png: the Kettle tipped over a basin, the
# golden light running out along channels across the floor) with the pour's numbers on the bare wall, in the pixel font.
#   python scripts/post-pour.py 0.1588 248 83 14:00
import os
import sys
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from pixelfont import draw  # noqa: E402

ROOT = 'E:/SOFT/alchemists/'
eth, souls, wallets, hour = sys.argv[1:5]
img = Image.open(ROOT + 'art/gen/posts/p10-pour-a.png').convert('RGB')
img.save(ROOT + 'marketing/scenes/pour-clean.png', optimize=True)
cx = 972  # the middle of the bare wall
draw(img, 'THE HOURLY POUR', cx, 62, 4, (176, 160, 130))
draw(img, f'{eth} ETH', cx, 112, 11, (242, 196, 85))
draw(img, f'{souls} SOULS', cx, 222, 5, (242, 234, 216))
draw(img, f'{wallets} WALLETS', cx, 272, 5, (242, 234, 216))
draw(img, f'{hour} UTC', cx, 330, 3, (150, 140, 124))
img.save(ROOT + 'marketing/scenes/pour.png', optimize=True)
print('ok')
