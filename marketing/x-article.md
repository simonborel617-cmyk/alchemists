# X Article: paste-ready layout

The X article editor has a title, a cover image, headings, bold, lists and inline images. This is the first post in
that form. Cover: `shots/01-brew-ready.png`. Inline images by section as marked. Every number is the deployed value;
re-check `deploy/params.*.json` before reposting after a parameter change.

---

**Title:** Alchemists: real proof of work on Robinhood Chain

**Cover image:** shots/01-brew-ready.png

A mine that issues a new challenge every minute. You hash it with your address, keep the best hash of the minute, and submit it in the next one. The hash becomes an ingredient: one of 40 types, in one of 5 tiers. Nobody picks what they get, and nobody knows what it is until the reveal. That is the whole game, and everything else grows out of it.

## How the mine works

Every minute has a **bar**: the number of leading zero bits a hash must clear. The bar moves with the network, every two minutes, at most two bits at a time, inside a corridor of 30 to 43 bits. More hashrate, higher bar.

Clear the bar and you submit. How far above it you land buys nothing: the tier is rolled when the find is revealed, the same odds for everyone.

- **Uncommon** 1 in 4
- **Rare** 1 in 16
- **Epic** 1 in 128
- **Legendary** 1 in 1,024

Then a 1-in-16 roll lifts a find one tier. One submit per address per minute, no exceptions.

The ingredient stays sealed until the chain has moved on a few blocks past your submit. Then it is revealed: type, tier and the upgrade roll all come from a seed that did not exist when you paid. There is no way to mine for a specific ingredient, and no way to know what you are getting before you pay.

Rarities open as the season goes on: Uncommon at the 25,000th find, Rare at the 50,000th, Epic at the 100,000th, Legendary at the 150,000th, permanently. Until then a find stops at the highest open tier.

You can mine three ways:

- in the browser on a **CPU**, any machine
- in the browser on a **GPU**, through WebGPU
- on a rig, with the standalone **CUDA miner**, up to 32 addresses per card

Sign submits with a session wallet that lives in your browser, or with your own wallet, one confirmation a minute. Nothing is deposited anywhere.

## The workshop

**[image: shots/02-workshop.png]**

Ingredients are raw material.

**Potion.** Two herbs of one tier brew into a potion of that tier. Every refining attempt burns one.

**Furnace.** Built from ingredients of its own tier; it refines up to that tier, and a furnace hotter than the ingredient adds five points. Ten ingredients of one type and tier plus a potion go in. With a 90, 80, 65 or 50 percent chance, by tier, one ingredient of the next tier comes out. Fail, and everything is lost.

**Crucible.** Ten ingredients of a tier melt into five of the same tier, random types. One of them rolls a 5 percent chance of a tier up; at higher tiers there is a growing risk of a tier down. Choosing the output category costs pieces.

**Ritual table.** Five ingredients by recipe are sealed into an item: a grimoire, a candle, a chalice, a seal, a scepter, a censer, a mirror, a relic. Eight kinds, five tiers, each with a chance to come out one tier higher. These items are what the summoning will ask for.

## The Cauldron

**[image: shots/03-cauldron.png]**

Every submit pays a small price in ETH. It starts low, grows with the square root of everything mined, and falls back as ingredients are burned in the workshop. All of it boils in the Kettle, on chain, readable by anyone at any time. Every hour 40 percent thickens in the Cauldron, a multisig Safe at a public address, and 60 percent rises as steam: a twenty-fourth of the Kettle drips to the holders of souls each hour, weighted by rank (Apprentice 1, Adept 4, Master 16, Magister 64, Archmage 256, a named soul 512), and the first hundred of every rank from Adept up weigh up to double. There will never be more than 21 Archmages and 21 named souls. The game's contracts are governed by that same multisig Safe.

## The keys

Twenty-one mythic keys exist, and only twenty-one. Each is the signature belonging of a named alchemist: the Emerald Tablet, Azoth, the Staff of Merlin, the Obsidian Mirror, and seventeen more. A key drops from a lucky reveal or a lucky craft while any remain. In the summoning, a key in its slot yields the named one-of-one alchemist.

## The opening act

Mining, the workshop, the summoning: this is the first act. Every line of it leads to the ritual of the Philosopher's Stone. What the ritual asks for, and what the Stone is, is not written anywhere. Not in the contracts, not on the site. Yet.

## Where

Testnet is live now, no signup, no deposit. Every rule, every odd and every recipe on one page, read straight from the contracts: https://alchemist-mine.com/rules

Contracts, dapp and miner are open source under MIT: https://github.com/simonborel617-cmyk/alchemists
