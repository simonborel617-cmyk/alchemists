// Stage-1 edge cases: mining caps and price, refining heat, furnace gating, reroll any, recipe checks.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployAll, mineConfig } = require("../scripts/lib/deploy-all");
const { findNonce } = require("../scripts/lib/work");
const P = require("../deploy/params.local.json");

async function nextMinute() {
  const ts = await time.latest();
  await time.increaseTo((Math.floor(ts / 60) + 1) * 60 + 1);
  await ethers.provider.send("hardhat_mine", ["0x4"]); // a minute spans ~5 parent-chain blocks on mainnet; reveal seeds need 4
}
async function deployFixture() {
  const [owner, alice, bob, treasury] = await ethers.getSigners();
  const d = await deployAll(ethers, P, treasury.address);
  await d.materials.setMinter(owner.address, true);
  return { ...d, owner, alice, bob, treasury };
}
const ing = (t, tier) => 1 + t * 8 + tier;
const parse = (rc, c, name) => rc.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).filter((e) => e && e.name === name);

async function mineOnce(mine, who, extraBitsQ8 = 0) {
  await nextMinute();
  await mine.tick();
  const m = await mine.currentMinute();
  const c = await mine.challenge(m);
  const t = Number(await mine.tQ8());
  const { nonce } = findNonce(who.address, c, t + extraBitsQ8);
  await nextMinute();
  await mine.connect(who).submit(m, nonce, { value: await mine.currentPrice() });
  return m;
}

describe("Stage 1: mining", function () {
  it("keeps tiers closed until the season reaches their number of finds, and never closes them again", async function () {
    const [owner, alice, , treasury] = await ethers.getSigners();
    const P2 = JSON.parse(JSON.stringify(P));
    P2.mine.unlockFinds = [2, 3, 3, 5]; // Uncommon at the 2nd find, Rare and Epic at the 3rd, Legendary at the 5th
    const { mine } = await deployAll(ethers, P2, treasury.address);
    expect(await mine.unlockedTier()).to.equal(1);
    await mineOnce(mine, alice, 10 * 256); // a monstrous hash buys nothing: the first find can only be Common (or upgraded)
    expect((await mine.pendingAt(alice.address, 0)).unlockedTier).to.equal(1);
    await nextMinute();
    await mine.tick();
    const rc = await (await mine.reveal(alice.address)).wait();
    const ev = parse(rc, mine, "Mined")[0];
    expect(ev, "Mined").to.exist;
    expect(Number(ev.args.tier)).to.be.lte(2);
    await nextMinute();
    await mine.tick();
    const m = await mine.currentMinute();
    const { nonce } = findNonce(alice.address, await mine.challenge(m), Number(await mine.tQ8()));
    await nextMinute();
    await expect(mine.connect(alice).submit(m, nonce, { value: await mine.currentPrice() })).to.emit(mine, "Unlocked").withArgs(2, 2);
    expect(await mine.unlockedTier()).to.equal(2);
    const m3 = await mine.currentMinute();
    const n3 = findNonce(alice.address, await mine.challenge(m3), Number(await mine.tQ8())).nonce;
    await nextMinute();
    const rc3 = await (await mine.connect(alice).submit(m3, n3, { value: await mine.currentPrice() })).wait();
    expect(parse(rc3, mine, "Unlocked").map((e) => Number(e.args.tier))).to.deep.equal([3, 4]); // two tiers at one find
    const cfg = mineConfig(P2);
    cfg.unlockFinds = [1000, 1000, 1000, 1000];
    await mine.connect(owner).setConfig(cfg);
    expect(await mine.unlockedTier()).to.equal(4); // raising the counts later closes nothing
    cfg.unlockFinds = [1, 1, 1, 3];
    await expect(mine.connect(owner).setConfig(cfg)).to.emit(mine, "Unlocked").withArgs(5, 3);
    cfg.unlockFinds = [5, 4, 4, 4];
    await expect(mine.connect(owner).setConfig(cfg)).to.be.revertedWith("Mine: unlocks");
  });

  it("grows the price with submits and lets burning pull it back", async function () {
    const { mine, materials, alice, owner } = await loadFixture(deployFixture);
    const cfg = mineConfig(P);
    cfg.priceD = 1; // sqrt(E) visible after a couple of mints
    await mine.connect(owner).setConfig(cfg);
    const p0 = await mine.currentPrice();
    expect(p0).to.equal(cfg.price0);
    await mineOnce(mine, alice);
    await mineOnce(mine, alice);
    const p2 = await mine.currentPrice(); // E = 2 -> 1 + sqrt(2)
    expect(p2).to.be.closeTo((cfg.price0 * 2414214n) / 1000000n, 10n ** 9n);
    await materials.mintCrafted(alice.address, ing(0, 1), 4);
    await materials.burn(alice.address, ing(0, 1), 4); // B = 4 -> E = 2 - 2 = 0
    expect(await mine.currentPrice()).to.equal(cfg.price0);
    expect(await mine.oreRemaining()).to.equal(999998n);
  });

  it("refuses submits once the vein is exhausted", async function () {
    const { mine, alice, owner } = await loadFixture(deployFixture);
    // fresh Mine with ore 1
    const cfg = mineConfig(P);
    cfg.oreR0 = 1;
    const materials = await ethers.deployContract("Materials", [P.materialsURI]);
    const keys = await ethers.deployContract("Keys", [P.keyKinds]);
    const tiny = await ethers.deployContract("Mine", [await materials.getAddress(), await keys.getAddress(), owner.address, cfg, 60]);
    await materials.setMinter(await tiny.getAddress(), true);
    await mineOnce(tiny, alice);
    expect(await tiny.oreRemaining()).to.equal(0n);
    await nextMinute();
    await tiny.tick();
    const m = await tiny.currentMinute();
    const c = await tiny.challenge(m);
    const { nonce } = findNonce(alice.address, c, Number(await tiny.tQ8()));
    await nextMinute();
    await expect(tiny.connect(alice).submit(m, nonce, { value: await tiny.currentPrice() })).to.be.revertedWith("Mine: vein exhausted");
    void mine;
  });
});

describe("Stage 1: workshop", function () {
  it("needs fewer refining inputs as the network heats up", async function () {
    const { mine, workshop, owner } = await loadFixture(deployFixture);
    expect(await workshop.refineInputs()).to.equal(10n);
    const cfg = mineConfig(P);
    cfg.floorBitsQ8 = 8 * 256; // tQ8 stays at 12 bits -> heat = (12-8)/(ceil-8)
    cfg.ceilBitsQ8 = 12 * 256; // ceil = current threshold -> heat 1.0
    await mine.connect(owner).setConfig(cfg);
    expect(await mine.heatQ8()).to.equal(256n);
    expect(await workshop.refineInputs()).to.equal(6n);
    cfg.ceilBitsQ8 = 16 * 256; // heat 0.5 -> 8
    await mine.connect(owner).setConfig(cfg);
    expect(await workshop.refineInputs()).to.equal(8n);
  });

  it("gates refining by furnace tier and rewards a stronger furnace", async function () {
    const { materials, workshop, furnaces, alice } = await loadFixture(deployFixture);
    await materials.mintCraftedBatch(alice.address, [ing(0, 2), ing(8, 2), ing(24, 2), ing(2, 2), ing(2, 1), 1002, 1001], [4, 3, 3, 10, 10, 1, 1]);
    await workshop.connect(alice).craftFurnace(2, [ing(0, 2), ing(8, 2), ing(24, 2)], [4, 3, 3]); // iron furnace, refines up to Rare
    expect(await furnaces.tier(1)).to.equal(2);
    await expect(workshop.connect(alice).refine(1, 2, 3)).to.be.revertedWith("Workshop: furnace too weak");
    const rc = await (await workshop.connect(alice).refine(1, 2, 1)).wait(); // tier 1 in a tier-2 furnace: bonus flag
    const id = parse(rc, workshop, "Committed")[0].args.id;
    const c = await workshop.commits(id);
    expect(c.c).to.equal(1);
    await expect(workshop.connect(alice).refine(1, 2, 2)).to.be.revertedWith("Furnaces: cooling");
  });

  it("rerolls into any category and never returns more than it should", async function () {
    const { materials, workshop, alice, mine } = await loadFixture(deployFixture);
    await materials.mintCraftedBatch(alice.address, [ing(7, 5), ing(20, 5)], [5, 5]);
    await workshop.connect(alice).reroll(5, 255, [ing(7, 5), ing(20, 5)], [5, 5]);
    await nextMinute();
    await mine.tick();
    const rc = await (await workshop.reveal(0)).wait();
    const ev = parse(rc, workshop, "Rerolled")[0];
    expect(ev.args.outIds.length).to.equal(5);
    for (const id of ev.args.outIds) expect(Number((id - 1n) % 8n)).to.be.within(4, 5); // legendary or downgraded to epic
    await materials.mintCraftedBatch(alice.address, [ing(7, 5), ing(20, 5)], [5, 5]);
    await workshop.connect(alice).reroll(5, 0, [ing(7, 5), ing(20, 5)], [5, 5]);
    await nextMinute();
    await mine.tick();
    const rc2 = await (await workshop.reveal(1)).wait();
    expect(parse(rc2, workshop, "Rerolled")[0].args.outIds.length).to.equal(3); // legendary with a category: 3 outputs
  });

  it("rejects wrong recipes and anything that is not an ingredient (mixed tiers are allowed, see craft-mix)", async function () {
    const { materials, workshop, alice } = await loadFixture(deployFixture);
    await materials.mintCraftedBatch(alice.address, [ing(5, 3), ing(9, 3), 1003], [3, 1, 1]);
    await expect(workshop.connect(alice).craftItem(2, [ing(5, 3), ing(9, 3), 1003], [3, 1, 1])).to.be.revertedWith("Workshop: input");
    await expect(workshop.connect(alice).craftItem(2, [ing(5, 3), ing(9, 3)], [3, 1])).to.be.revertedWith("Workshop: recipe");
    await expect(workshop.connect(alice).craftPotion(3, ing(5, 3), ing(9, 3))).to.be.revertedWith("Workshop: two herbs of the tier");
  });

  it("hands out a key of the crafted kind and falls back to an item when that kind is exhausted", async function () {
    const { materials, keys, workshop, alice, mine, owner } = await loadFixture(deployFixture);
    await workshop.connect(owner).setCraft([1, 1, 1, 1, 1], 0); // every craft rolls a key
    // censer (kind 5) has two keys: 14 and 15
    await materials.mintCraftedBatch(alice.address, [ing(0, 1), ing(16, 1)], [6, 9]);
    for (let i = 0; i < 3; i++) await workshop.connect(alice).craftItem(5, [ing(0, 1), ing(16, 1)], [2, 3]);
    await nextMinute();
    await mine.tick();
    const rc = await (await workshop.revealMany([0, 1, 2])).wait();
    const evs = parse(rc, workshop, "Crafted");
    const won = evs.filter((e) => Number(e.args.outTier) === 6).map((e) => Number(e.args.keyIndex)).sort();
    expect(won).to.deep.equal([14, 15]);
    const items = evs.filter((e) => Number(e.args.outTier) !== 6);
    expect(items.length).to.equal(1);
    expect(await keys.unclaimedOfKind(5)).to.equal(0n);
    expect(await keys.ownerOf(14)).to.equal(alice.address);
    expect(await keys.ownerOf(15)).to.equal(alice.address);
    expect(await keys.tokenURI(14)).to.equal(P.keysURI + "14.json");
  });
});
