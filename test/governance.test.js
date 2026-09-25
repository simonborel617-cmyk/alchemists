// Governance: timelock ownership, guardian pause semantics, minter changes only through the timelock.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployAll, mineConfig } = require("../scripts/lib/deploy-all");
const { findNonce } = require("../scripts/lib/work");
const P0 = require("../deploy/params.local.json");

async function nextMinute() {
  const ts = await time.latest();
  await time.increaseTo((Math.floor(ts / 60) + 1) * 60 + 1);
  await ethers.provider.send("hardhat_mine", ["0x4"]); // a minute spans ~5 parent-chain blocks on mainnet; reveal seeds need 4
}
async function governedFixture() {
  const [deployer, safe, guardian, treasury, alice] = await ethers.getSigners();
  const P = JSON.parse(JSON.stringify(P0));
  P.governance = { safe: safe.address, guardian: guardian.address, timelockDelay: 3600 };
  const d = await deployAll(ethers, P, treasury.address);
  return { ...d, deployer, safe, guardian, treasury, alice, P };
}
const ing = (t, tier) => 1 + t * 8 + tier;

describe("Governance", function () {
  it("moves ownership of every contract to the timelock and keeps the deployer powerless", async function () {
    const { materials, mine, furnaces, workshop, alchemists, timelock, deployer, guardian } = await loadFixture(governedFixture);
    const tl = await timelock.getAddress();
    for (const c of [materials, mine, furnaces, workshop, alchemists]) expect(await c.owner()).to.equal(tl);
    expect(await mine.guardian()).to.equal(guardian.address);
    await expect(materials.connect(deployer).setMinter(deployer.address, true)).to.be.revertedWithCustomError(materials, "OwnableUnauthorizedAccount");
    await expect(mine.connect(deployer).setConfig(mineConfig(P0))).to.be.revertedWithCustomError(mine, "OwnableUnauthorizedAccount");
    await expect(mine.connect(deployer).unpause()).to.be.revertedWithCustomError(mine, "OwnableUnauthorizedAccount");
  });

  it("lets the guardian pause submits and crafting, and only the timelock unpause", async function () {
    const { mine, workshop, timelock, safe, guardian, alice } = await loadFixture(governedFixture);
    await expect(mine.connect(alice).pause()).to.be.revertedWith("Guarded: not guardian");
    await mine.connect(guardian).pause();
    await workshop.connect(guardian).pause();
    await nextMinute();
    await mine.tick(); // ticking and revealing keep working while paused
    const m = await mine.currentMinute();
    const c = await mine.challenge(m);
    const { nonce } = findNonce(alice.address, c, Number(await mine.minuteThreshold(m)));
    await nextMinute();
    await expect(mine.connect(alice).submit(m, nonce, { value: await mine.currentPrice() })).to.be.revertedWith("Guarded: paused");
    await expect(workshop.connect(alice).craftPotion(1, ing(16, 1), ing(16, 1))).to.be.revertedWith("Guarded: paused");
    await expect(mine.connect(guardian).unpause()).to.be.revertedWithCustomError(mine, "OwnableUnauthorizedAccount");
    // unpause through the timelock: schedule, wait the delay, execute
    const data = mine.interface.encodeFunctionData("unpause", []);
    const target = await mine.getAddress();
    await timelock.connect(safe).schedule(target, 0, data, ethers.ZeroHash, ethers.ZeroHash, 3600);
    await expect(timelock.connect(safe).execute(target, 0, data, ethers.ZeroHash, ethers.ZeroHash)).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");
    await time.increase(3600);
    await timelock.connect(safe).execute(target, 0, data, ethers.ZeroHash, ethers.ZeroHash);
    expect(await mine.paused()).to.equal(false);
    await expect(mine.connect(alice).submit(m, nonce, { value: await mine.currentPrice() })).to.be.revertedWith("Mine: submit in the next minute");
  });

  it("applies a config change only after the timelock delay, and only from a proposer", async function () {
    const { mine, timelock, safe, alice, P } = await loadFixture(governedFixture);
    const cfg = mineConfig(P);
    cfg.kPerHour = 777;
    const data = mine.interface.encodeFunctionData("setConfig", [cfg]);
    const target = await mine.getAddress();
    await expect(timelock.connect(alice).schedule(target, 0, data, ethers.ZeroHash, ethers.ZeroHash, 3600)).to.be.revertedWithCustomError(timelock, "AccessControlUnauthorizedAccount");
    await timelock.connect(safe).schedule(target, 0, data, ethers.ZeroHash, ethers.ZeroHash, 3600);
    expect((await mine.config()).kPerHour).to.equal(P.mine.kPerHour);
    await time.increase(3600);
    await timelock.connect(safe).execute(target, 0, data, ethers.ZeroHash, ethers.ZeroHash);
    expect((await mine.config()).kPerHour).to.equal(777);
  });
});
