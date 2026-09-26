# Post image "when each rarity opens": the generated scene (art/gen/posts/p8-rarities-a.png, five flasks in their
# niches, Common open, the rest sealed ever more heavily) with the rarity names and the find counts set on the ledge in
# a 5x7 pixel font, outlined in black like SNES menu text. Writes marketing/scenes/rarities.png and a clean copy.
#   python scripts/post-rarities.py
from PIL import Image

ROOT = 'E:/SOFT/alchemists/'
SRC = ROOT + 'art/gen/posts/p8-rarities-a.png'

GLYPHS = {
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'C': ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    ',': ['..', '..', '..', '..', '##', '.#', '#.'],
    ' ': ['...', '...', '...', '...', '...', '...', '...'],
}


def mask(text):
    """The string as rows of 0/1 at font-pixel resolution, one blank column between glyphs."""
    rows = [''] * 7
    for i, ch in enumerate(text):
        g = GLYPHS[ch]
        for r in range(7):
            rows[r] += g[r] + ('.' if i < len(text) - 1 else '')
    return [[c == '#' for c in row] for row in rows]


def draw(img, text, cx, y, scale, color, outline=(18, 14, 12)):
    m = mask(text)
    h, w = len(m), len(m[0])
    x0 = cx - (w * scale) // 2
    px = img.load()

    def block(fx, fy, col):
        for yy in range(y + fy * scale, y + (fy + 1) * scale):
            for xx in range(x0 + fx * scale, x0 + (fx + 1) * scale):
                if 0 <= xx < img.width and 0 <= yy < img.height:
                    px[xx, yy] = col

    # a one-font-pixel black outline first, then the letters
    for fy in range(-1, h + 1):
        for fx in range(-1, w + 1):
            near = any(0 <= fy + dy < h and 0 <= fx + dx < w and m[fy + dy][fx + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
            if near:
                block(fx, fy, outline)
    for fy in range(h):
        for fx in range(w):
            if m[fy][fx]:
                block(fx, fy, color)


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
