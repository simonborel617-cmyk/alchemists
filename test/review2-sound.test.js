// Review 2: properties checked and found sound (these tests pass).
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
  await d.keys.setMinter(owner.address, true);
  const stream = await ethers.deployContract("Stream", [await d.souls.getAddress(), 2, treasury.address]);
  const ids = five(1).filter(Boolean);
  for (const who of [alice, bob, carol]) await d.materials.mintCraftedBatch(who.address, ids, ids.map(() => 3n));
  await d.souls.connect(alice).seal(five(1), 255);
  await d.souls.connect(bob).seal(five(1), 255);
  return { ...d, stream, owner, alice, bob, carol, treasury };
}

describe("Review 2: sound properties", function () {
  it("claimMany with a repeated id pays once, and a soul sealed after a pour gets nothing from it", async function () {
    const { souls, stream, alice, carol, treasury } = await loadFixture(fixture);
    await treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("1") });
    await souls.connect(carol).seal(five(1), 255); // #3 after the pour
    const owed = await stream.claimable(0, 1);
    const b0 = await ethers.provider.getBalance(alice.address);
    await stream.connect(treasury).claimMany(0, [1, 1, 1, 3]);
    expect((await ethers.provider.getBalance(alice.address)) - b0).to.equal(owed);
    expect(await stream.claimable(0, 3)).to.equal(0n);
    expect(await ethers.provider.getBalance(await stream.getAddress())).to.be.gte(await stream.claimable(0, 2));
  });

  it("sum of claims never exceeds a pour without drain (odd amounts, three weights)", async function () {
    const { souls, stream, carol, treasury } = await loadFixture(fixture);
    await souls.connect(carol).seal(five(1), 255);
    for (const v of [7n, 1000000007n, ethers.parseEther("1.234567891234567891")]) await treasury.sendTransaction({ to: await stream.getAddress(), value: v });
    await stream.claimMany(0, [1, 2, 3]);
    const left = await ethers.provider.getBalance(await stream.getAddress());
    expect(left).to.be.gte(0n);
    expect(left).to.be.lt(10n); // dust only
  });

  it("keys: 21 at most, a burned key is never minted again, a soul needs the key's owner", async function () {
    const { keys, souls, owner, alice, bob } = await loadFixture(fixture);
    for (let i = 0; i < 21; i++) await keys.claimAny(owner.address, i * 7919);
    expect(await keys.unclaimedCount()).to.equal(0n);
    await expect(keys.claimAny(owner.address, 1)).to.be.revertedWith("Keys: none left");
    const [ok] = await keys.claimOfKind.staticCall(owner.address, 0, 1);
    expect(ok).to.equal(false);
    const seen = new Set();
    for (let i = 0; i < 21; i++) seen.add(await keys.ownerOf(i));
    expect(seen.size).to.equal(1);
    await keys.transferFrom(owner.address, alice.address, 0);
    const kind = Number(await keys.keyKind(0));
    const ids = five(1).map((x, i) => (i === kind ? 0 : x));
    await expect(souls.connect(bob).seal(ids, 0)).to.be.revertedWith("Keys: not owner");
    await souls.connect(alice).seal(ids, 0);
    await expect(keys.ownerOf(0)).to.be.revertedWithCustomError(keys, "ERC721NonexistentToken");
    expect(await keys.unclaimedCount()).to.equal(0n);
  });
});
