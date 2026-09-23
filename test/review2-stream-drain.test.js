// Review 2 PoC: Stream.drain returns an epoch's unclaimed ETH to the treasury but does not stop that epoch from being
// claimed afterwards. A late claimer is paid the drained share a second time, out of later epochs' ETH, and another
// holder's claim then fails for lack of funds. Expected-behaviour assertions: this test FAILS while the bug exists.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const P = require("../deploy/params.local.json");

const item = (kind, tier) => 2000 + kind * 8 + tier;
const five = (tier) => [item(0, tier), item(1, tier), item(2, tier), item(3, tier), item(4, tier), 0, 0, 0];
async function give(materials, to, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  await materials.mintCraftedBatch(to, uniq, uniq.map((id) => BigInt(ids.filter((x) => x === id).length)));
}

async function fixture() {
  const [owner, alice, bob, treasury] = await ethers.getSigners();
  const d = await deployAll(ethers, P, treasury.address);
  await d.materials.setMinter(owner.address, true);
  const stream = await ethers.deployContract("Stream", [await d.souls.getAddress(), 2, treasury.address]); // gate at 2 souls
  await give(d.materials, alice.address, five(1));
  await d.souls.connect(alice).seal(five(1), 255); // #1
  await give(d.materials, bob.address, five(1));
  await d.souls.connect(bob).seal(five(1), 255); // #2
  return { ...d, stream, owner, alice, bob, treasury };
}

describe("Review 2: Stream drain", function () {
  it("a drained epoch can no longer be claimed, so later epochs stay solvent", async function () {
    const { souls, stream, owner, alice, bob, treasury } = await loadFixture(fixture);
    const s = await stream.getAddress();
    const ONE = ethers.parseEther("1");
    const w1 = await souls.weight(1), w2 = await souls.weight(2), tw = w1 + w2;

    await treasury.sendTransaction({ to: s, value: ONE }); // epoch 0
    await stream.claim(0, 1); // alice takes her part of epoch 0; bob does not claim for a year
    await time.increase(366 * 24 * 3600);
    await stream.connect(owner).drain(0, treasury.address); // bob's part of epoch 0 goes back to the treasury
    const bobShare0 = (ONE * w2) / tw;

    await treasury.sendTransaction({ to: s, value: ONE }); // epoch 1
    const aliceShare1 = (ONE * w1) / tw, bobShare1 = (ONE * w2) / tw;

    const b0 = await ethers.provider.getBalance(bob.address);
    await stream.connect(owner).claim(0, 2); // triggered by a third party so bob's balance delta is exact
    const got = (await ethers.provider.getBalance(bob.address)) - b0;
    console.log(`      bob received ${ethers.formatEther(got)} ETH; drained share of epoch 0 = ${ethers.formatEther(bobShare0)}, his share of epoch 1 = ${ethers.formatEther(bobShare1)}`);
    console.log(`      stream balance now ${ethers.formatEther(await ethers.provider.getBalance(s))} ETH, alice is owed ${ethers.formatEther(aliceShare1)} ETH`);

    // expected: bob gets only epoch 1 (epoch 0's remainder was already returned to the treasury) ...
    expect(got).to.equal(bobShare1);
    // ... and alice can still claim her part of epoch 1
    await expect(stream.claim(0, 1)).to.not.be.reverted;
  });
});
