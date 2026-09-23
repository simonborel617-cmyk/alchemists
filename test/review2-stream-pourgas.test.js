// Review 2 PoC: Stream._pour snapshots the total weight by calling weight(id) for every soul ever sealed (burned ones
// included), ~7k gas per soul. The pour stops fitting in a transaction long before the 5555 cap: at 2^24 gas (Hardhat,
// EIP-7825) near 2,400 souls, at Nitro's 32M near 4,600 souls. After that the treasury can no longer pour for souls.
// Expected-behaviour assertion: this test FAILS while the bug exists.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { deployAll } = require("../scripts/lib/deploy-all");
const P = require("../deploy/params.local.json");

const item = (kind, tier) => 2000 + kind * 8 + tier;
const five = (tier) => [item(0, tier), item(1, tier), item(2, tier), item(3, tier), item(4, tier), 0, 0, 0];

describe("Review 2: Stream pour gas", function () {
  this.timeout(600000);

  it("the treasury can still pour once 2,500 of the 5,555 souls exist", async function () {
    const [owner, alice, treasury] = await ethers.getSigners();
    const d = await deployAll(ethers, P, treasury.address);
    await d.materials.setMinter(owner.address, true);
    const stream = await ethers.deployContract("Stream", [await d.souls.getAddress(), 100, treasury.address]);
    const ids = five(1).filter(Boolean);
    await d.materials.mintCraftedBatch(alice.address, ids, ids.map(() => 2500n));
    async function sealUpTo(n) {
      await network.provider.send("evm_setAutomine", [false]);
      const have = Number(await d.souls.total()), n0 = await alice.getNonce();
      for (let i = 0; i < n - have; i++) await d.souls.connect(alice).seal(five(1), 255, { nonce: n0 + i, gasLimit: 400000 });
      while ((await alice.getNonce()) < n0 + (n - have)) await network.provider.send("evm_mine", []);
      await network.provider.send("evm_setAutomine", [true]);
      expect(await d.souls.total()).to.equal(BigInt(n));
    }
    async function tryPour(n) {
      try {
        const rc = await (await stream.connect(treasury).pour({ value: ethers.parseEther("1"), gasLimit: 16_777_216 })).wait();
        console.log(`      pour with ${n} souls: ok, ${rc.gasUsed} gas`);
        return true;
      } catch (e) {
        const used = e.receipt ? `, gasUsed ${e.receipt.gasUsed} of 16777216` : "";
        console.log(`      pour with ${n} souls: ${(e.shortMessage || e.message).slice(0, 80)}${used}`);
        return false;
      }
    }
    await sealUpTo(2300);
    expect(await tryPour(2300)).to.equal(true); // still fits
    await sealUpTo(2500);
    expect(await tryPour(2500), "a pour over 2500 souls does not fit in 2^24 gas").to.equal(true);
  });
});
