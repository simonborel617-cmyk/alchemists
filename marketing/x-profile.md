# @alchemistmine on X

Everything the profile needs, ready to paste. Assets: https://alchemist-mine.com/img/social/avatar.png (400 px, the
sigil), https://alchemist-mine.com/img/social/header.png (1500x500, the hero crop). Alternates in the same folder:
`avatar-cauldron-1024.png`, `header-hall.png`.

## Profile fields

- **Name:** Alchemists
- **Handle:** @alchemistmine
- **Bio (160 chars max):**
  `Mine ingredients with real proof of work. Refine, reroll, seal the ritual. Every ether flows into the Cauldron. Opening act on Robinhood Chain.`
  (154 characters)
- **Location:** The Cauldron
- **Website:** https://alchemist-mine.com
- **Birth date:** skip (a birth date on a brand account only invites age gating)

## Voice

The project speaks for itself, in the third person about the mine and the Cauldron, never "we are excited". Short,
declarative, one idea per post. Pixel-art screenshots over words. Numbers are real (on-chain, quotable). Lore is
allowed as texture, never as explanation: every thread ends at the ritual and stops there. Never describe what the
Philosopher's Stone is, what the ritual asks for, or when the main act begins.

Never: "WAGMI", "alpha", "don't miss", countdowns to nothing, follower bait, replying to price talk. If asked about
the Stone, answer with a question or a line of lore, not a fact.

Never frame the player's money as something at risk: no "lose", "cost", "spend", "risk", "burn your ETH". The submit
price is stated once, as a fact of the mechanics ("every submit pays a small price in ETH, it flows into the Cauldron"),
and never as a warning or a hook. A miss is a beat of the rhythm, not an economic event.

## Pinned post (one long post: the account has the long-post limit; the text is in `x-first-post.txt`, the image is `shots/01-brew-ready.png`)

A compact article, ~3,800 characters, about three minutes to read: the mine, the workshop, the Cauldron, the keys,
the opening act, where to play. Every number in it is the deployed value; re-check against `deploy/params.*.json`
before reposting after a parameter change. The numbered thread below is the short fallback.

## Thread form (fallback)

1/ The mine issues a new challenge every minute. The best hash from your address becomes an ingredient: 40 types, 5
tiers. Nobody chooses what they get. That is the point.

2/ Real proof of work: sha256 in your browser, on your CPU, on your GPU, or on a rig. No deposit, no signup. A session
wallet or your own, your call.

3/ Ingredients go to the workshop. The furnace refines one tier up. The crucible melts ten into five and gambles on
a higher tier. The ritual table seals five ingredients into an item.

4/ Every submit pays a small price in ETH. All of it flows into the Cauldron: a Safe behind a 48-hour timelock, on
chain, readable by anyone.

5/ Twenty-one mythic keys exist. Each belongs to a named alchemist. A key drops from a lucky reveal or a lucky craft,
while any remain.

6/ Mining, the workshop, the summoning: this is the opening act. Every line of it leads to the ritual of the
Philosopher's Stone. What the ritual asks for is not written anywhere. Yet.

7/ Testnet is live now. Rules, odds and recipes read straight from the contracts: https://alchemist-mine.com/rules
Code is public: https://github.com/simonborel617-cmyk/alchemists

## Images: story scenes, not interface shots

Every post gets its own scene in the game's style B, composed from the game's elements (ingredients, items, keys,
stations, the Cauldron) into a small story beat. Interface frames from the site only where the post is literally about
the interface (the rules page, the limits panel). Scenes live in `marketing/scenes/`, prompts follow the ART-BRIEF
skeleton: 256x144 grid, 16:9, SNES palette, strong outline, no text, no characters. Renders: Higgsfield gpt_image_2_5.

## First posts (one per day, in order; attach the named image)

1. (published as the article) cover: shots/01-brew-ready.png
2. "Bar 30.00 bits. Best this minute 29.40. The brew went cold. Next minute, new challenge." [scene: cold-hearth.png, the fire out at dawn, one ember]
3. "Sealed. What is inside is only known at the reveal." [scene: sealed-vial.png, wax-sealed vial in a chalk ring]
4. "Revealed: Rare Rowan." [screenshot: the reveal card] "Type, tier and the upgrade roll are decided by a challenge
   that did not exist when you mined it."
5. "Forty types. Metals, minerals, herbs, woods, beast parts. Uniformly random, nobody chooses." [scene: ingredient-shelf.png]
5b. "Threshold corridor 30 to 43 bits. The bar moves with the network's hashrate, every two minutes, at most two bits
   at a time." [screenshot: the mine panel]
6. "Ten Uncommon Hemlock into the crucible. Out: five Uncommon, one of them rolled Rare." [screenshot: workshop]
7. "Twenty-one keys. Zero claimed." [scene: keys.png, the ring of 21 keys, one glowing]
8. "No GPU? The CPU tab works. Slower, same rules." [screenshot: CPU mining at a few MH/s]
9. "Open source, MIT. Contracts, dapp, miner." [link to the repos]
10. "The Cauldron: 60 % streams to the alchemists' holders once they are summoned. 40 % thickens." [screenshot: the
    Cauldron block] No more than that.
11. "Every rule on one page, read live from the chain." [link: /rules]
12. "Set a price ceiling, a budget, a number of rounds. The miner stops itself at any of them." [screenshot: the limits panel]

## Reply templates

- "When mainnet?" → "When the audit closes. The testnet is open now: alchemist-mine.com"
- "What is the Stone?" → "Nobody has asked the Cauldron yet."
- "Is this a token?" → "No token. Ingredients, items and keys are NFTs; the price of a submit is ETH and it flows
  into the Cauldron."
- "Can I mine with X card?" → "Anything with WebGPU in the browser; any NVIDIA card with the standalone miner."
- Bug reports → thank, ask for the log line from the mining panel, point at GitHub issues.

## Do not post

- Anything in Russian. Anything mentioning the team or a personal account.
- Screenshots with a wallet balance, a private key prompt or the session wallet's export dialog.
- Predictions of price, floor or "rarity value".
- Any description of the ritual, the Stone, the main act, or its date.
