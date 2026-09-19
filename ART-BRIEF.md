# Art brief: the Alchemists items

What is drawn for the first version: **token icons**, not characters. The alchemists' appearance is stage two.

| Set | Count | What it is |
|---|---|---|
| Ingredients | 40 types | 8 metals, 8 minerals, 8 herbs, 8 woods, 8 beast parts; the tier is an aura laid over the same icon |
| Ritual items | 8 | grimoire, candle, chalice, seal, scepter, censer, mirror, relic; tier as aura too |
| Mythic keys | 21 | unique belongings of the named alchemists, one per 1/1 |
| Potion of purification | 1 | plus the tier aura |
| Furnaces | 4 | clay, iron, brass, athanor |

74 unique drawings in total; the 266 contract ids are composited from them with the five tier auras, which keeps one
style and makes the tier readable from a marketplace thumbnail.

## Style (owner's decision 2026-09-17: variant B)

Bright 16-bit inventory in the manner of SNES JRPGs: warm saturated palette, black outline, two-step light and shadow,
light from the top left. One style for everything.

- Render: Higgsfield `gpt_image_2_5`, 1:1, paid credits. The model draws a chunky grid of irregular pitch (24–31 px), so
  every image is forced to **64×64** with `python scripts/pixelize.py --grid 64 --out art/pixel-b64 <png>`: median per
  block, 32 colours, background `#15181c`, 512 px NEAREST previews. A 32 grid is too coarse, 128 does not match the render.
- The tier aura is added by the same script: t0 Common without aura, t1 green `#3fae5a`, t2 blue `#3b7ddd`,
  t3 purple `#8e44d1`, t4 gold `#d9a21b`; mythic is white and handled separately (`--mythic`).
- Final files: `art/final/<slug>-t<0..4>.png` (slug = lowercase English name, spaces to dashes; keys are `key-<i>.png`).
  `node scripts/metadata.js` picks them up automatically and writes a placeholder only where a file is missing.
- Raw renders live in `art/gen/<set>/<slug>.png` (not committed).

## Prompt skeleton B

`pixel art item icon, 64x64 pixel grid upscaled with nearest-neighbor to 1024, every pixel a crisp square block, single object centered on flat dark graphite background #15181c, object fills 75% of frame. OBJECT: {description}. STYLE: classic 16-bit fantasy RPG inventory icon in the manner of SNES-era JRPG item sprites, warm saturated palette, strong black outline, bold two-step highlight and shadow, light from top-left, readable at small size; no gradients, no anti-aliasing, no glow, no sparkles, no text, no frame, no border, no shadow on the background`

## Order and state

Everything was drawn on 2026-09-17 in one pass, 74 renders (style B): 9 items and the potion, 40 ingredients, 4 furnaces,
21 keys. `art/final` holds 245 tiered files plus 21 keys with the white aura; `node scripts/metadata.js` yields 266 of 266
ids with real icons. Contact sheets: `art/gen/*-sheet*.png`, `art/gen/overview-t0.png`.

Banners: the busy laboratory scene was replaced by a sparse "sigil carved in basalt" hero (`web/img/hero-sigil.png`);
lesson for banners: sparse composition, limited palette, flat shading, an empty third for text.

Still open on the art side: metadata for the furnaces as NFTs (the ERC-721 has no generator yet; files
`art/final/furnace-{clay,iron,brass,athanor}-t0.png` are ready), optional redraws of single icons, and the alchemists'
appearance in stage two.
