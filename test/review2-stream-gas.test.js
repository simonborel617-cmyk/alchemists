// Review 2 follow-up: what a claim costs per epoch, for the first claimer of an epoch and for a later one, so the dapp
// can size its batches and the runbook can say how often holders should claim.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAll } = require("../scripts/lib/deploy-all");
const P = require("../deploy/params.local.json");

const item = (kind, tier) => 2000 + kind * 8 + tier;
const five = (tier) => [item(0, tier), item(1, tier), item(2, tier), item(3, tier), item(4, tier), 0, 0, 0];

describe("Review 2: Stream claim gas per epoch", function () {
  it("measures the first and a later claimer over 20 and 60 epochs", async function () {
    const [owner, alice, bob, treasury] = await ethers.getSigners();
    const d = await deployAll(ethers, P, treasury.address);
    await d.materials.setMinter(owner.address, true);
    const stream = await ethers.deployContract("Stream", [await d.souls.getAddress(), 1, treasury.address]);
    const ids = five(1).filter(Boolean);
    for (const w of [alice, bob]) { await d.materials.mintCraftedBatch(w.address, ids, ids.map(() => 1n)); await d.souls.connect(w).seal(five(1), 255); }
    const pour = async (n) => { for (let i = 0; i < n; i++) await stream.connect(treasury).pour({ value: ethers.parseEther("0.01") }); };
    await pour(20);
    const first20 = await stream.claim.estimateGas(0, 1);
    await pour(40);
    const first60 = await stream.claim.estimateGas(0, 1);
    await stream.claim(0, 1); // soul #1 books all 60 epochs first
    const later60 = await stream.claim.estimateGas(0, 2);
    const perFirst = (first60 - first20) / 40n;
    console.log(`      first claimer: ${first20} gas over 20 epochs, ${first60} over 60 -> ${perFirst} per epoch`);
    console.log(`      later claimer: ${later60} gas over 60 epochs -> ~${later60 / 60n} per epoch`);
    expect(perFirst).to.be.lt(40_000n);
  });
});
