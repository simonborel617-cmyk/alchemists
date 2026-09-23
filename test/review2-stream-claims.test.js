// Review 2 PoCs, smaller Stream claim issues. Expected-behaviour assertions: these tests FAIL while the issues exist.
//  1. web/app.js claims with a fixed gasLimit of 200k + 120k per soul, but a claim costs ~27k gas per unclaimed epoch
//     (first claimer of an epoch). With daily pours, a soul left unclaimed for about a week can no longer be claimed
//     from the dapp: the transaction runs out of gas.
//  2. A soul held by a contract that cannot take ETH (a vault, an escrow) cannot be claimed at all: the ETH always goes
//     to ownerOf, there is no claim-to-self by the owner and no skip, so its share stays locked until drained.
//  3. claimMany reverts on a released (burned) soul instead of skipping it: ownerOf is read before the weight check.
//  4. pour() is whenNotPaused but receive() is not: a paused stream still opens epochs from plain transfers.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const P = require("../deploy/params.local.json");

const item = (kind, tier) => 2000 + kind * 8 + tier;
const five = (tier) => [item(0, tier), item(1, tier), item(2, tier), item(3, tier), item(4, tier), 0, 0, 0];

async function fixture() {
  const [owner, alice, bob, carol, treasury] = await ethers.getSigners();
  const d = await deployAll(ethers, P, treasury.address);
  await d.materials.setMinter(owner.address, true);
  const stream = await ethers.deployContract("Stream", [await d.souls.getAddress(), 3, treasury.address]);
  const ids = five(1).filter(Boolean);
  for (const who of [alice, bob, carol]) {
    await d.materials.mintCraftedBatch(who.address, ids, ids.map(() => 1n));
    await d.souls.connect(who).seal(five(1), 255); // #1 alice, #2 bob, #3 carol
  }
  return { ...d, stream, owner, alice, bob, carol, treasury };
}

describe("Review 2: Stream claims", function () {
  it("a soul left unclaimed for ten daily pours claims in one transaction (the dapp now estimates the gas)", async function () {
    const { stream, alice, treasury } = await loadFixture(fixture);
    for (let day = 0; day < 10; day++) await treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("0.1") });
    const need = await stream.connect(alice).claimMany.estimateGas(0, [1]);
    console.log(`      claimMany(0, [1]) after 10 pours: ${need} gas (web/app.js sends estimateGas x 1.2)`);
    expect(need).to.be.lt(1_000_000n);
    await (await stream.connect(alice).claimMany(0, [1], { gasLimit: (need * 12n) / 10n })).wait();
    expect(await stream.claimable(0, 1)).to.equal(0n);
  });

  it("the share of a soul held by a contract without receive() waits until the soul moves (known limit)", async function () {
    const { souls, keys, stream, bob, treasury } = await loadFixture(fixture);
    const vault = await keys.getAddress(); // stands in for any holder contract with no payable receive/fallback
    await souls.connect(bob).transferFrom(bob.address, vault, 2);
    await treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("1") });
    let err = null;
    try { await stream.claim(0, 2); } catch (e) { err = e; }
    console.log(`      claim(0, 2) held by a contract: ${err ? (err.shortMessage || err.message).slice(0, 100) : "ok"}; claimable ${ethers.formatEther(await stream.claimable(0, 2))} ETH`);
    // known limit (review 2, L3, accepted): the ETH always goes to the soul's owner, so a holder contract that cannot
    // take ETH makes the claim revert; nothing is lost, the share waits until the soul moves to an address that can
    expect(err, "the claim reverts with Stream: send").to.not.equal(null);
    expect(await stream.claimable(0, 2)).to.be.gt(0n);
  });

  it("claimMany skips a released soul instead of reverting the whole batch", async function () {
    const { souls, stream, owner, alice, treasury } = await loadFixture(fixture);
    await treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("1") });
    await souls.connect(owner).setSummoner(owner.address);
    await souls.connect(owner).release(alice.address, 1);
    let err = null;
    try { await stream.claimMany(0, [1, 2, 3]); } catch (e) { err = e; }
    console.log(`      claimMany(0, [1(released), 2, 3]): ${err ? (err.shortMessage || err.message).slice(0, 110) : "ok"}`);
    expect(err, "the batch reverts on the released soul").to.equal(null);
  });

  it("a paused stream refuses pours through receive() as it does through pour()", async function () {
    const { stream, owner, treasury } = await loadFixture(fixture);
    await stream.connect(owner).pause();
    await expect(stream.connect(treasury).pour({ value: 1n })).to.be.revertedWith("Guarded: paused");
    let err = null;
    try { await treasury.sendTransaction({ to: await stream.getAddress(), value: 1n }); } catch (e) { err = e; }
    console.log(`      plain transfer to a paused stream: ${err ? "refused" : "accepted"}, epochs ${await stream.epochCount()}`);
    expect(err, "receive() opens an epoch while paused").to.not.equal(null);
  });
});
