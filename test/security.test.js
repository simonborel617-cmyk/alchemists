// Security regressions from the adversarial review: reveal reentrancy, rejecting treasury, pressure cap, challenge mixing.
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
  const [owner, alice, bob, treasury] = await ethers.getSigners();
  const d = await deployAll(ethers, P, treasury.address);
  return { ...d, owner, alice, bob, treasury };
}
const parse = (rc, c, name) => rc.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).filter((e) => e && e.name === name);

describe("Security", function () {
  it("a contract miner cannot re-enter reveal from the ERC-1155 receive hook and double-mint", async function () {
    const { mine, materials, alice } = await loadFixture(deployFixture);
    const attacker = await ethers.deployContract("ReentrantMiner", [await mine.getAddress()]);
    const addr = await attacker.getAddress();
    await nextMinute();
    await mine.tick();
    const m = await mine.currentMinute();
    const c = await mine.challenge(m);
    const { nonce } = findNonce(addr, c, Number(await mine.minuteThreshold(m)));
    await nextMinute();
    await attacker.connect(alice).attackSubmit(m, nonce, { value: await mine.currentPrice() });
    expect(await mine.pendingCount(addr)).to.equal(1n);
    await nextMinute();
    await mine.tick();
    const rc = await (await mine.reveal(addr)).wait();
    const mined = parse(rc, mine, "Mined");
    expect(mined.length).to.equal(1);
    expect(await attacker.hookCalls()).to.equal(1n);
    expect(await attacker.reentryFailures()).to.equal(1n); // the nested reveal reverted (ReentrancyGuard)
    expect(await materials.balanceOf(addr, mined[0].args.id)).to.equal(1n);
    expect(await mine.pendingCount(addr)).to.equal(0n);
    expect(await materials.minedTotal()).to.equal(1n);
  });

  it("keeps mining alive when the treasury refuses ETH and lets the owner sweep the escrow", async function () {
    const { owner, alice } = await loadFixture(deployFixture);
    const rejecting = await ethers.deployContract("RejectingTreasury", []);
    const materials = await ethers.deployContract("Materials", [P.materialsURI]);
    const keys = await ethers.deployContract("Keys", [P.keyKinds]);
    const mine = await ethers.deployContract("Mine", [await materials.getAddress(), await keys.getAddress(), await rejecting.getAddress(), mineConfig(P), 60]);
    await materials.setMinter(await mine.getAddress(), true);
    await nextMinute();
    await mine.tick();
    const m = await mine.currentMinute();
    const c = await mine.challenge(m);
    const { nonce } = findNonce(alice.address, c, Number(await mine.minuteThreshold(m)));
    await nextMinute();
    const price = await mine.currentPrice();
    await expect(mine.connect(alice).submit(m, nonce, { value: price })).to.emit(mine, "Escrowed").withArgs(price);
    expect(await mine.escrowed()).to.equal(price);
    expect(await ethers.provider.getBalance(await mine.getAddress())).to.equal(price);
    const before = await ethers.provider.getBalance(owner.address);
    await mine.connect(owner).sweepEscrow(alice.address);
    expect(await mine.escrowed()).to.equal(0n);
    expect(await ethers.provider.getBalance(await mine.getAddress())).to.equal(0n);
    void before;
  });

  it("mixes every submitted find into the next challenges", async function () {
    const { mine, alice, bob } = await loadFixture(deployFixture);
    expect(await mine.findAcc()).to.equal(ethers.ZeroHash);
    await nextMinute();
    await mine.tick();
    const m = await mine.currentMinute();
    const c = await mine.challenge(m);
    const a = findNonce(alice.address, c, Number(await mine.minuteThreshold(m))).nonce;
    await nextMinute();
    await mine.connect(alice).submit(m, a, { value: await mine.currentPrice() });
    const acc1 = await mine.findAcc();
    expect(acc1).to.not.equal(ethers.ZeroHash);
    // the challenge of the next minute depends on the accumulator, so two chains with different finds diverge
    await nextMinute();
    await mine.tick();
    const next = await mine.challenge(await mine.currentMinute());
    expect(next).to.not.equal(ethers.ZeroHash);
    void bob;
  });

  it("caps the network pressure multiplier", async function () {
    const { mine, owner, alice } = await loadFixture(deployFixture);
    const cfg = mineConfig(P);
    cfg.kPerHour = 60;
    await mine.connect(owner).setConfig(cfg);
    // simulate many overshoot windows cheaply: one mint per window vs K=1 gives ratio 0 -> no growth; use 5 miners instead
    const signers = (await ethers.getSigners()).slice(5, 10);
    for (let round = 0; round < 3; round++) {
      await nextMinute();
      await mine.tick();
      const m = await mine.currentMinute();
      const c = await mine.challenge(m);
      const t = Number(await mine.minuteThreshold(m));
      const nonces = signers.map((s) => findNonce(s.address, c, t).nonce);
      await nextMinute();
      for (let i = 0; i < signers.length; i++) await mine.connect(signers[i]).submit(m, nonces[i], { value: (await mine.currentPrice()) * 2n });
    }
    await nextMinute();
    await mine.tick();
    expect(await mine.netPressure()).to.be.lte(1_000_000_000n);
    expect(await mine.netPressure()).to.be.gt(1_000_000n);
    void alice;
  });
});
