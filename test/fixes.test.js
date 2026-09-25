// Fixes after the testnet and simulator runs: price before retarget, K floor, tunable estimator, multiplier cap.
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
  const signers = await ethers.getSigners();
  const [owner, , , treasury] = signers;
  const d = await deployAll(ethers, P, treasury.address);
  return { ...d, owner, treasury, miners: signers.slice(4, 12) };
}
async function mineRound(mine, who, extraQ8 = 0) {
  await nextMinute();
  await mine.tick();
  const m = await mine.currentMinute();
  const c = await mine.challenge(m);
  const t = Number(await mine.minuteThreshold(m));
  const nonces = who.map((w) => findNonce(w.address, c, t + extraQ8).nonce);
  await nextMinute();
  return { m, nonces };
}

describe("Fixes", function () {
  it("prices a submit before its own retarget, so the price a client just read still holds", async function () {
    const { mine, owner, miners } = await loadFixture(deployFixture);
    const cfg = mineConfig(P);
    cfg.kPerHour = 60; // K = 1 per 60s window: three mints overshoot it
    await mine.connect(owner).setConfig(cfg);
    const three = miners.slice(0, 3);
    const { m, nonces } = await mineRound(mine, three);
    for (let i = 0; i < 3; i++) await mine.connect(three[i]).submit(m, nonces[i], { value: await mine.currentPrice() });
    // a fourth miner mines this same minute (challenge fixed by the submits above) and submits in the next one
    // with no tick in between: his own submit runs the retarget that steps pressure to 1.125, yet pays the quoted price
    const w = miners[3];
    const m2 = await mine.currentMinute();
    const c2 = await mine.challenge(m2);
    const { nonce } = findNonce(w.address, c2, Number(await mine.minuteThreshold(m2)));
    await nextMinute();
    const quoted = await mine.currentPrice();
    expect(await mine.netPressure()).to.equal(1000000n);
    await expect(mine.connect(w).submit(m2, nonce, { value: quoted })).to.emit(mine, "Submitted");
    expect(await mine.netPressure()).to.equal(1125000n);
    expect(await mine.currentPrice()).to.be.gt(quoted);
  });

  it("never lets K fall below one mint per window, however deep the halvings", async function () {
    const { owner, miners } = await loadFixture(deployFixture);
    const cfg = mineConfig(P);
    cfg.oreR0 = 8;
    cfg.kPerHour = 60; // 1000 (x1000) per 60s window before halvings
    const materials = await ethers.deployContract("Materials", [P.materialsURI]);
    const keys = await ethers.deployContract("Keys", [P.keyKinds]);
    const tiny = await ethers.deployContract("Mine", [await materials.getAddress(), await keys.getAddress(), owner.address, cfg, 60]);
    await materials.setMinter(await tiny.getAddress(), true);
    expect(await tiny.kWindow3(60)).to.equal(1000n);
    const { m, nonces } = await mineRound(tiny, miners.slice(0, 4)); // ore 8 -> 4: one halving
    for (let i = 0; i < 4; i++) await tiny.connect(miners[i]).submit(m, nonces[i], { value: await tiny.currentPrice() });
    expect(await tiny.halvings()).to.equal(1n);
    expect(await tiny.kWindow3(60)).to.equal(1000n); // floored, not 500
    const r2 = await mineRound(tiny, miners.slice(0, 3)); // ore 4 -> 1: three halvings
    for (let i = 0; i < 3; i++) await tiny.connect(miners[i]).submit(r2.m, r2.nonces[i], { value: await tiny.currentPrice() });
    expect(await tiny.halvings()).to.equal(3n);
    expect(await tiny.kWindow3(60)).to.equal(1000n);
    expect(await tiny.kWindow3(120)).to.equal(1000n);
  });

  it("caps each submission's estimator contribution at the configured bits and rejects bad estimator config", async function () {
    const { mine, owner, miners } = await loadFixture(deployFixture);
    const cfg = mineConfig(P);
    cfg.estCapBits = 2;
    cfg.estDivX10 = 10;
    await mine.connect(owner).setConfig(cfg);
    const w = miners[0];
    const { m, nonces } = await mineRound(mine, [w], 6 * 256); // at least six bits over the threshold
    const tBits = Number(await mine.minuteThreshold(m)) >> 8;
    await mine.connect(w).submit(m, nonces[0], { value: await mine.currentPrice() });
    expect(await mine.windowSum()).to.equal(1n << BigInt(tBits + 2)); // capped at threshold + 2
    await expect(mine.connect(owner).setConfig({ ...cfg, estDivX10: 5 })).to.be.revertedWith("Mine: estimator");
    await expect(mine.connect(owner).setConfig({ ...cfg, estCapBits: 0 })).to.be.revertedWith("Mine: estimator");
  });

  it("caps the farm multiplier at the configured value (2x by default)", async function () {
    const { mine, owner, miners } = await loadFixture(deployFixture);
    const cfg = mineConfig(P);
    cfg.refHashrate = 1n;
    await mine.connect(owner).setConfig(cfg);
    expect(cfg.mCapQ8).to.equal(2 * 256);
    const { m, nonces } = await mineRound(mine, miners.slice(0, 2));
    for (let i = 0; i < 2; i++) await mine.connect(miners[i]).submit(m, nonces[i], { value: await mine.currentPrice() });
    await nextMinute();
    await mine.tick();
    expect(await mine.mQ8()).to.equal(2 * 256);
  });
});
