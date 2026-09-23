// Mainnet profile, end to end on the local network: deploy/params.mainnet.json with a stand-in Safe passes the
// preflight, deploys, and lands in exactly the state the runbook checks on the explorer after the real deploy.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAll, mineConfig } = require("../scripts/lib/deploy-all");
const { preflight } = require("../scripts/preflight");
const PM = require("../deploy/params.mainnet.json");

describe("Launch: the mainnet profile", function () {
  it("passes the preflight with a Safe and refuses without one, or with the summoning open", async function () {
    const [, safe] = await ethers.getSigners();
    const P = JSON.parse(JSON.stringify(PM));
    expect(preflight(P, { TREASURY: safe.address })).to.include("governance.safe must be the Safe multisig address");
    P.governance.safe = safe.address;
    expect(preflight(P, { TREASURY: safe.address })).to.deep.equal([]);
    const open = { ...P, pausedAtLaunch: [] };
    expect(preflight(open, { TREASURY: safe.address }).join(" ")).to.match(/pausedAtLaunch/);
  });

  it("deploys into the state the runbook verifies: timelock owns all, Safe guards and collects, summoning paused", async function () {
    const [deployer, safe, alice] = await ethers.getSigners();
    const P = JSON.parse(JSON.stringify(PM));
    P.governance.safe = safe.address;
    const b0 = await ethers.provider.getBlockNumber();
    const d = await deployAll(ethers, P, safe.address);
    const b1 = await ethers.provider.getBlockNumber();
    const { materials, keys, mine, furnaces, workshop, alchemists, souls, stream, timelock } = d;
    const tl = await timelock.getAddress();

    // ownership and guardians
    for (const c of [materials, keys, mine, furnaces, workshop, alchemists, souls, stream]) expect(await c.owner()).to.equal(tl);
    for (const c of [mine, workshop, alchemists, souls, stream]) expect(await c.guardian()).to.equal(safe.address);
    expect(await mine.treasury()).to.equal(safe.address);
    expect(await stream.pourer()).to.equal(safe.address); // only the Safe (or the timelock) pours into the stream
    expect(await stream.closed()).to.equal(false); // the emergency exit has not been used

    // the timelock: the Safe proposes and executes, 48 hours, no admin left with the deployer
    expect(await timelock.getMinDelay()).to.equal(172800n);
    expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), safe.address)).to.equal(true);
    expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), safe.address)).to.equal(true);
    expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address)).to.equal(false);
    expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), deployer.address)).to.equal(false);

    // minters: the four game contracts and nobody else we know of
    for (const c of [mine, workshop, alchemists, souls]) {
      expect(await materials.minters(await c.getAddress())).to.equal(true);
      expect(await keys.minters(await c.getAddress())).to.equal(true);
    }
    for (const who of [deployer.address, safe.address, tl, await stream.getAddress()]) {
      expect(await materials.minters(who)).to.equal(false);
      expect(await keys.minters(who)).to.equal(false);
    }

    // pauses: mining, the workshop, souls and the stream are open; the summoning is not
    expect(await mine.paused()).to.equal(false);
    expect(await workshop.paused()).to.equal(false);
    expect(await souls.paused()).to.equal(false);
    expect(await stream.paused()).to.equal(false);
    expect(await alchemists.paused()).to.equal(true);
    await expect(alchemists.connect(alice).summon([0, 0, 0, 0, 0, 0, 0, 0], 255)).to.be.revertedWith("Guarded: paused");
    await expect(alchemists.connect(deployer).unpause()).to.be.revertedWithCustomError(alchemists, "OwnableUnauthorizedAccount");
    expect(await souls.summoner()).to.equal(ethers.ZeroAddress);

    // constants as deployed
    const want = mineConfig(P), got = await mine.config();
    expect(got.floorBitsQ8).to.equal(BigInt(want.floorBitsQ8));
    expect(got.ceilBitsQ8).to.equal(BigInt(want.ceilBitsQ8));
    expect(got.oreR0).to.equal(BigInt(want.oreR0));
    expect(got.price0).to.equal(ethers.parseEther("0.0002"));
    expect(got.keyChance).to.equal(65536n);
    expect(await mine.currentPrice()).to.equal(ethers.parseEther("0.0002"));
    expect(await mine.sessionSec()).to.equal(60n);
    expect(await workshop.furnaceCooldown()).to.equal(600n);
    expect(await keys.unclaimedCount()).to.equal(21n);

    // gas of the whole deploy, for the deployer's budget
    let gas = 0n;
    for (let b = b0 + 1; b <= b1; b++) gas += (await ethers.provider.getBlock(b)).gasUsed;
    console.log(`      deploy: ${b1 - b0} transactions, ${gas.toLocaleString("en")} gas`);
    expect(gas).to.be.lessThan(40_000_000n);
  });
});
