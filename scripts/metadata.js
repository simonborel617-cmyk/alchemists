// Generates ERC-1155 metadata JSON and placeholder SVG icons for every Materials id:
// ingredients (40 types x 5 tiers), potions, ritual items (8 kinds x 5 tiers) and the 21 mythic keys.
//   node scripts/metadata.js [--out web/metadata] [--base https://host/metadata]
// The base URL is what Materials.setURI should point at: "<base>/{id}.json". Real icons are picked up from
// --art <dir> (default art/final) as <slug>-t<tier-1>.png for ingredients/potions/items (slug = lowercase English
// name, spaces to dashes; t0 = Common .. t4 = Legendary, as scripts/pixelize.py writes them) and key-<i>.png for
// the 21 keys; ids without a file get the placeholder SVG (category glyph on a tier-coloured aura).
const fs = require("fs");
const path = require("path");
const keys = require("../deploy/keys.json");

const OUT = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : path.join(__dirname, "..", "web", "metadata"); })();
const BASE = (() => { const i = process.argv.indexOf("--base"); return i >= 0 ? process.argv[i + 1] : "./"; })();
const ART = (() => { const i = process.argv.indexOf("--art"); return i >= 0 ? process.argv[i + 1] : path.join(__dirname, "..", "art", "final"); })();
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
let realArt = 0;

const TIER = ["", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
const TIER_NAMES = keys.tiers;
const AURA = ["", "#8a8f93", "#3fae5a", "#3b7ddd", "#8e44d1", "#d9a21b", "#f2f2f2"];
const CAT_EN = ["Metals", "Minerals", "Herbs", "Woods", "Beasts"];
const TYPE_EN = [
  "Lead", "Tin", "Iron", "Copper", "Mercury", "Silver", "Gold", "Antimony",
  "Sulphur", "Salt", "Saltpetre", "Cinnabar", "Vitriol", "Alum", "Lodestone", "Quartz",
  "Mandrake", "Wormwood", "Belladonna", "Henbane", "Vervain", "Mugwort", "Hemlock", "Rue",
  "Oak", "Yew", "Ash", "Elder", "Rowan", "Hawthorn", "Willow", "Blackthorn",
  "Bone", "Bezoar", "Toadstone", "Raven Feather", "Snakeskin", "Beeswax", "Bat Wing", "Scarab",
];
const KIND_EN = ["Grimoire", "Candle", "Chalice", "Seal", "Scepter", "Censer", "Mirror", "Relic"];
const KEY_EN = [
  ["Nicolas Flamel", "Book of Abraham the Jew"], ["Hermes Trismegistus", "Emerald Tablet"], ["Ge Hong", "Baopuzi"],
  ["Saint Germain", "Unquenchable Candle"], ["Zosimos of Panopolis", "Flame of Panopolis"],
  ["Cleopatra the Alchemist", "Chalice of the Ouroboros"], ["Maria the Prophetess", "Bain-marie"], ["Rasputin", "Cup of Madeira"],
  ["Paracelsus", "Azoth"], ["Wei Boyang", "Trigrams of the Cantong qi"], ["Agrippa", "Pentacle"],
  ["Merlin", "Staff of Merlin"], ["Baba Yaga", "Pestle"], ["Nagarjuna", "Mercury Rod"],
  ["Cagliostro", "Censer of the Egyptian Lodge"], ["Al-Razi", "Censer of Sal Ammoniac"],
  ["John Dee", "Obsidian Mirror"], ["Isaac Newton", "Prism"], ["Edward Kelley", "Shew-stone"],
  ["Albertus Magnus", "Talking Head"], ["Jabir ibn Hayyan", "First Alembic"],
];
// simple glyphs per category / kind (Unicode alchemical and planetary signs render on most systems)
const CAT_GLYPH = ["☉", "🜍", "🜁", "🜃", "🜄"];
const METAL_GLYPH = ["♄", "♃", "♂", "♀", "☿", "☽", "☉", "♁"];
const KIND_GLYPH = ["📖", "🕯", "🏆", "⚜", "🪄", "🏺", "🪞", "☠"];

function svg(glyph, tier, label, sub) {
  const aura = AURA[tier] || "#8a8f93";
  const glow = tier >= 2 ? `<circle cx="128" cy="118" r="88" fill="${aura}" opacity="0.28"/><circle cx="128" cy="118" r="70" fill="${aura}" opacity="0.22"/>` : "";
  const ring = tier >= 5 ? `<circle cx="128" cy="118" r="98" fill="none" stroke="${aura}" stroke-width="3" opacity="0.9"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
<rect width="256" height="256" rx="24" fill="#15181c"/>
${glow}${ring}
<text x="128" y="140" font-size="86" text-anchor="middle" font-family="Segoe UI Symbol, Noto Sans Symbols, serif" fill="#e6e8e6">${glyph}</text>
<text x="128" y="206" font-size="19" text-anchor="middle" font-family="Georgia, serif" fill="#e6e8e6">${label}</text>
<text x="128" y="232" font-size="14" text-anchor="middle" font-family="Georgia, serif" fill="${aura}">${sub}</text>
</svg>
`;
}

function write(id, meta, image, artFile) {
  const src = artFile && path.join(ART, artFile);
  if (src && fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(OUT, `${id}.png`));
    meta.image = `${BASE}${id}.png`;
    realArt++;
  } else {
    fs.writeFileSync(path.join(OUT, `${id}.svg`), image);
  }
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(meta, null, 2));
}

fs.mkdirSync(OUT, { recursive: true });
let count = 0;
// ingredients
for (let t = 0; t < 40; t++) {
  for (let tier = 1; tier <= 5; tier++) {
    const id = 1 + t * 8 + tier;
    const cat = Math.floor(t / 8);
    const glyph = cat === 0 ? METAL_GLYPH[t] : CAT_GLYPH[cat];
    write(id, {
      name: `${TIER[tier]} ${TYPE_EN[t]}`,
      description: `Ingredient of the Alchemists mine: ${keys.types[t]} (${keys.categories[cat]}), tier ${TIER_NAMES[tier]}. Mined by proof of work on Robinhood Chain.`,
      image: `${BASE}${id}.svg`,
      attributes: [
        { trait_type: "Kind", value: "Ingredient" },
        { trait_type: "Category", value: CAT_EN[cat] },
        { trait_type: "Type", value: TYPE_EN[t] },
        { trait_type: "Tier", value: TIER[tier] },
        { trait_type: "Tier Index", value: tier, display_type: "number" },
      ],
    }, svg(glyph, tier, TYPE_EN[t], TIER[tier]), `${slug(TYPE_EN[t])}-t${tier - 1}.png`);
    count++;
  }
}
// potions
for (let tier = 1; tier <= 5; tier++) {
  const id = 1000 + tier;
  write(id, {
    name: `${TIER[tier]} Potion of Purification`,
    description: `Single-use potion consumed by one refining attempt of tier ${TIER[tier]} ingredients.`,
    image: `${BASE}${id}.svg`,
    attributes: [{ trait_type: "Kind", value: "Potion" }, { trait_type: "Tier", value: TIER[tier] }, { trait_type: "Tier Index", value: tier, display_type: "number" }],
  }, svg("⚗", tier, "Purification", TIER[tier]), `potion-t${tier - 1}.png`);
  count++;
}
// ritual items
for (let k = 0; k < 8; k++) {
  for (let tier = 1; tier <= 5; tier++) {
    const id = 2000 + k * 8 + tier;
    write(id, {
      name: `${TIER[tier]} ${KIND_EN[k]}`,
      description: `Sealed ritual item for summoning: ${keys.kinds[k]}, tier ${TIER_NAMES[tier]}. Crafted from five ingredients by recipe.`,
      image: `${BASE}${id}.svg`,
      attributes: [
        { trait_type: "Kind", value: "Ritual Item" },
        { trait_type: "Item", value: KIND_EN[k] },
        { trait_type: "Required", value: k < 5 ? "Yes" : "Enhancer" },
        { trait_type: "Tier", value: TIER[tier] },
        { trait_type: "Tier Index", value: tier, display_type: "number" },
      ],
    }, svg(KIND_GLYPH[k], tier, KIND_EN[k], TIER[tier]), `${slug(KIND_EN[k])}-t${tier - 1}.png`);
    count++;
  }
}
// mythic keys
for (let i = 0; i < 21; i++) {
  const id = 3000 + i;
  const k = keys.keys[i];
  write(id, {
    name: `${KEY_EN[i][1]} (key of ${KEY_EN[i][0]})`,
    description: `Mythic key: ${k.key}, the signature ${keys.kinds[k.kind]} of ${k.alchemist}. Unique. Summons the named 1/1 alchemist when offered in the ${KIND_EN[k.kind]} slot.`,
    image: `${BASE}${id}.svg`,
    attributes: [
      { trait_type: "Kind", value: "Mythic Key" },
      { trait_type: "Item", value: KIND_EN[k.kind] },
      { trait_type: "Alchemist", value: KEY_EN[i][0] },
      { trait_type: "Tier", value: "Mythic" },
      { trait_type: "Tier Index", value: 6, display_type: "number" },
    ],
  }, svg(KIND_GLYPH[k.kind], 6, KEY_EN[i][1], KEY_EN[i][0]), `key-${i}.png`);
  count++;
}
console.log(`wrote ${count} json files to ${OUT} (base ${BASE}); real icons ${realArt}, placeholders ${count - realArt}`);
