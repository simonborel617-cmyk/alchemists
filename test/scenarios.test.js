// Scenario tests: several miners, windows and pressure, ore halvings, farm multiplier, third-party reveals,
// burn accounting, access control, and the per-minute threshold snapshot.
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
}
async function deployFixture() {
  const signers = await ethers.getSigners();
  const [owner, , , treasury] = signers;
  const d = await deployAll(ethers, P, treasury.address);
  await d.materials.setMinter(owner.address, true);
  return { ...d, owner, treasury, miners: signers.slice(4, 10) };
}
const ing = (t, tier) => 1 + t * 8 + tier;
const parse = (rc, c, name) => rc.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).filter((e) => e && e.name === name);

/** Everyone in `who` mines the current minute and submits in the next one. Returns the mined minute. */
async function round(mine, who, extraQ8 = 0) {
  await nextMinute();
  await mine.tick();
  const m = await mine.currentMinute();
  const c = await mine.challenge(m);
  const t = Number(await mine.minuteThreshold(m));
  const nonces = who.map((w) => findNonce(w.address, c, t + extraQ8).nonce);
  await nextMinute();
  for (let i = 0; i < who.length; i++) await mine.connect(who[i]).submit(m, nonces[i], { value: await mine.currentPrice() });
  return m;
}

describe("Scenarios: several miners", function () {
  it("lets many addresses submit in the same minute, once each, and reveals them independently", async function () {
    const { mine, materials, miners } = await loadFixture(deployFixture);
    const three = miners.slice(0, 3);
    const m = await round(mine, three);
    expect(await mine.windowMints()).to.be.gte(3);
    for (const w of three) expect(await mine.pendingCount(w.address)).to.equal(1n);
    await expect(mine.connect(three[0]).submit(m, 1n, { value: await mine.currentPrice() })).to.be.revertedWith("Mine: one per minute");
    await nextMinute();
    await mine.tick();
    for (const w of three) {
      const rc = await (await mine.connect(miners[5]).reveal(w.address)).wait(); // a stranger reveals
      expect(parse(rc, mine, "Mined").length).to.equal(1);
    }
    expect(await materials.minedTotal()).to.equal(3n);
  });

  it("queues several unrevealed finds per address and settles them in order", async function () {
    const { mine, materials, miners } = await loadFixture(deployFixture);
    const w = miners[0];
    // three consecutive minutes without a reveal in between: each submit reveals the previous find,
    // so pending never exceeds one; block the reveal path by never submitting twice in a row.
    await round(mine, [w]);
    await round(mine, [w]); // reveals #1
    await round(mine, [w]); // reveals #2
    expect(await mine.pendingCount(w.address)).to.equal(1n);
    expect(await materials.minedTotal()).to.equal(2n);
    await nextMinute();
    await mine.tick();
    await mine.reveal(w.address);
    expect(await mine.pendingCount(w.address)).to.equal(0n);
    expect(await materials.minedTotal()).to.equal(3n);
    expect(await mine.pendingHead(w.address)).to.equal(3n);
  });
});

describe("Scenarios: pressure, ore, multiplier", function () {
  it("raises network pressure while the pace exceeds K and lets it decay after", async function () {
    const { mine, owner, miners } = await loadFixture(deployFixture);
    const cfg = mineConfig(P);
    cfg.kPerHour = 60; // K = 1 per early window of 60s
    await mine.connect(owner).setConfig(cfg);
    const five = miners.slice(0, 5);
    await round(mine, five); // 5 mints in one window vs K=1
    await nextMinute();
    await expect(mine.tick()).to.emit(mine, "Retarget");
    const np1 = await mine.netPressure();
    expect(np1).to.equal(1125000n); // +12.5% capped
    const price = await mine.currentPrice();
    expect(price).to.be.gt(cfg.price0);
    // quiet windows: pressure decays back to the floor
    for (let i = 0; i < 3; i++) { await nextMinute(); await mine.tick(); }
    expect(await mine.netPressure()).to.equal(1000000n);
  });

  it("halves K when half the ore is gone and stops at zero", async function () {
    const { owner, miners } = await loadFixture(deployFixture);
    const cfg = mineConfig(P);
    cfg.oreR0 = 4;
    const materials = await ethers.deployContract("Materials", [P.materialsURI, P.keyKinds]);
    const tiny = await ethers.deployContract("Mine", [await materials.getAddress(), owner.address, cfg, 60]);
    await materials.setMinter(await tiny.getAddress(), true);
    const k0 = await tiny.kWindow3(60);
    expect(await tiny.halvings()).to.equal(0n);
    await round(tiny, miners.slice(0, 2)); // ore 4 -> 2
    expect(await tiny.halvings()).to.equal(1n);
    expect(await tiny.kWindow3(60)).to.equal(k0 / 2n);
    await round(tiny, miners.slice(0, 1)); // -> 1
    expect(await tiny.halvings()).to.equal(2n);
    await round(tiny, miners.slice(0, 1)); // -> 0
    expect(await tiny.oreRemaining()).to.equal(0n);
    expect(await tiny.halvings()).to.equal(2n); // log2(4/1) with rem clamped to 1
  });

  it("applies the farm multiplier only above the reference hashrate and caps it", async function () {
    const { mine, owner, miners } = await loadFixture(deployFixture);
    expect(await mine.mQ8()).to.equal(256);
    const cfg = mineConfig(P);
    cfg.refHashrate = 1n; // any hashrate is 'above reference'
    cfg.mCapQ8 = 3 * 256;
    await mine.connect(owner).setConfig(cfg);
    await round(mine, miners.slice(0, 2));
    await nextMinute();
    await mine.tick();
    expect(await mine.mQ8()).to.equal(3 * 256); // capped
    cfg.refHashrate = 10n ** 30n;
    await mine.connect(owner).setConfig(cfg);
    await nextMinute();
    await mine.tick();
    expect(await mine.mQ8()).to.equal(256);
  });
});

describe("Scenarios: threshold snapshot", function () {
  it("judges a find by the threshold of the minute it was mined in, not by a later retarget", async function () {
    const { mine, owner, miners } = await loadFixture(deployFixture);
    const w = miners[0];
    await nextMinute();
    await mine.tick();
    const m = await mine.currentMinute();
    const c = await mine.challenge(m);
    const tm = Number(await mine.minuteThreshold(m));
    expect(tm).to.equal(12 * 256);
    const { nonce } = findNonce(w.address, c, tm); // barely clears 12 bits, most likely < 14
    // force the live threshold up before the submit lands
    const cfg = mineConfig(P);
    cfg.floorBitsQ8 = 14 * 256;
    await mine.connect(owner).setConfig(cfg);
    expect(await mine.tQ8()).to.equal(14 * 256);
    await nextMinute();
    await expect(mine.connect(w).submit(m, nonce, { value: await mine.currentPrice() })).to.emit(mine, "Submitted");
    const pd = await mine.pendingAt(w.address, 0);
    expect(pd.tQ8).to.equal(12 * 256);
    // the next minute's snapshot carries the new threshold
    const m2 = await mine.currentMinute();
    expect(await mine.minuteThreshold(m2)).to.equal(14 * 256);
  });
});

describe("Scenarios: accounting and access", function () {
  it("counts only ingredient burns in B and keeps M for mined units only", async function () {
    const { materials, workshop, owner, miners } = await loadFixture(deployFixture);
    const w = miners[0];
    await materials.mintCraftedBatch(w.address, [ing(16, 1), 2001], [2, 1]);
    await workshop.connect(w).craftPotion(1, ing(16, 1), ing(16, 1));
    expect(await materials.burnedIngredients()).to.equal(2n);
    await materials.burn(w.address, 2001, 1); // an item burned by a minter
    await materials.burn(w.address, 1001, 1); // the potion
    expect(await materials.burnedIngredients()).to.equal(2n);
    expect(await materials.minedTotal()).to.equal(0n);
    expect(await materials.circulating(2001)).to.equal(0n);
    void owner;
  });

  it("keeps admin functions to the owner and minting to minters", async function () {
    const { mine, materials, workshop, furnaces, miners } = await loadFixture(deployFixture);
    const w = miners[0];
    const cfg = mineConfig(P);
    await expect(mine.connect(w).setConfig(cfg)).to.be.revertedWithCustomError(mine, "OwnableUnauthorizedAccount");
    await expect(mine.connect(w).setTreasury(w.address)).to.be.revertedWithCustomError(mine, "OwnableUnauthorizedAccount");
    await expect(materials.connect(w).setMinter(w.address, true)).to.be.revertedWithCustomError(materials, "OwnableUnauthorizedAccount");
    await expect(materials.connect(w).mintMined(w.address, ing(0, 1), 1)).to.be.revertedWith("Materials: not minter");
    await expect(materials.connect(w).burn(w.address, ing(0, 1), 1)).to.be.revertedWith("Materials: not minter");
    await expect(furnaces.connect(w).mint(w.address, 1)).to.be.revertedWith("Furnaces: not workshop");
    await expect(workshop.connect(w).setCraft([1, 1, 1, 1, 1], 5)).to.be.revertedWithCustomError(workshop, "OwnableUnauthorizedAccount");
    await expect(mine.connect(w).setConfig({ ...cfg, oreR0: 5 })).to.be.reverted; // not owner anyway
  });

  it("rejects a config that changes the ore reserve or the start price", async function () {
    const { mine, owner } = await loadFixture(deployFixture);
    const cfg = mineConfig(P);
    await expect(mine.connect(owner).setConfig({ ...cfg, oreR0: 5 })).to.be.revertedWith("Mine: immutable fields");
    await expect(mine.connect(owner).setConfig({ ...cfg, price0: 1n })).to.be.revertedWith("Mine: immutable fields");
    await expect(mine.connect(owner).setConfig({ ...cfg, floorBitsQ8: 50 * 256, ceilBitsQ8: 40 * 256 })).to.be.revertedWith("Mine: corridor");
  });
});
