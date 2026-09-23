// Review 2, H1 (fixed): pour() and receive() used to be open to anyone for any amount, and every claim walked the whole
// epoch list from the token's last claim. A few thousand 1-wei pours pushed every later claim past the gas cap, for
// good. Now only the pourer (the treasury Safe) or the owner may pour, and a claim can advance in bounded steps
// (claimUpTo), so a token is never stuck however long the list grows.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const P = require("../deploy/params.local.json");

const item = (kind, tier) => 2000 + kind * 8 + tier;
const five = (tier) => [item(0, tier), item(1, tier), item(2, tier), item(3, tier), item(4, tier), 0, 0, 0];

async function fixture() {
  const [owner, alice, bob, carol, attacker, treasury] = await ethers.getSigners();
  const d = await deployAll(ethers, P, treasury.address);
  await d.materials.setMinter(owner.address, true);
  const stream = await ethers.deployContract("Stream", [await d.souls.getAddress(), 1, treasury.address]); // gate at 1 soul
  const ids = five(1).filter(Boolean);
  await d.materials.mintCraftedBatch(alice.address, ids, ids.map(() => 10n));
  await d.materials.mintCraftedBatch(bob.address, ids, ids.map(() => 10n));
  await d.materials.mintCraftedBatch(carol.address, ids, ids.map(() => 10n));
  await d.souls.connect(alice).seal(five(1), 255); // soul #1
  return { ...d, stream, owner, alice, bob, carol, attacker, treasury };
}

describe("Review 2: Stream epoch spam", function () {
  this.timeout(600000);

  it("refuses pours from anyone but the pourer and the owner, by call and by plain transfer", async function () {
    const { stream, attacker, treasury, owner } = await loadFixture(fixture);
    await expect(stream.connect(attacker).pour({ value: 1n })).to.be.revertedWith("Stream: not pourer");
    await expect(attacker.sendTransaction({ to: await stream.getAddress(), value: 1n })).to.be.revertedWith("Stream: not pourer");
    await stream.connect(treasury).pour({ value: 1n });
    await treasury.sendTransaction({ to: await stream.getAddress(), value: 1n });
    await stream.connect(owner).pour({ value: 1n });
    expect(await stream.epochCount()).to.equal(3n);
    await expect(stream.connect(attacker).setPourer(attacker.address)).to.be.revertedWithCustomError(stream, "OwnableUnauthorizedAccount");
  });

  it("a token behind a long list of epochs claims in bounded steps and gets the same total as one claim", async function () {
    const { souls, stream, alice, bob, treasury } = await loadFixture(fixture);
    await souls.connect(bob).seal(five(1), 255); // soul #2
    const K = 600; // over a year and a half of daily pours
    await network.provider.send("evm_setAutomine", [false]);
    const n0 = await treasury.getNonce();
    for (let i = 0; i < K; i++) await stream.connect(treasury).pour({ value: 1000n + BigInt(i), nonce: n0 + i, gasLimit: 200000 });
    while ((await treasury.getNonce()) < n0 + K) await network.provider.send("evm_mine", []);
    await network.provider.send("evm_setAutomine", [true]);
    expect(await stream.epochCount()).to.equal(BigInt(K));

    const owed1 = await stream.claimable(0, 1), owed2 = await stream.claimable(0, 2);
    // soul #1 in steps of 250 epochs
    const b0 = await ethers.provider.getBalance(alice.address);
    let steps = 0;
    while ((await stream.claimedUpTo(0, 1)) < BigInt(K)) { await stream.connect(bob).claimUpTo(0, 1, 250); steps++; }
    expect(steps).to.equal(3);
    expect((await ethers.provider.getBalance(alice.address)) - b0).to.equal(owed1);
    expect(await stream.claimable(0, 1)).to.equal(0n);
    // soul #2 in steps of 300, each well inside a block
    const c0 = await ethers.provider.getBalance(bob.address);
    const g = await stream.claimUpTo.estimateGas(0, 2, 300);
    console.log(`      a step of 300 epochs: ${g} gas (~${g / 300n} per epoch)`);
    expect(g).to.be.lt(12_000_000n);
    await stream.connect(alice).claimUpTo(0, 2, 300);
    await stream.connect(alice).claimUpTo(0, 2, 300);
    expect(await stream.claimedUpTo(0, 2)).to.equal(BigInt(K));
    expect((await ethers.provider.getBalance(bob.address)) - c0).to.equal(owed2);
    expect(await ethers.provider.getBalance(await stream.getAddress())).to.be.lt(BigInt(K) * 2n); // rounding dust only
  });
});
