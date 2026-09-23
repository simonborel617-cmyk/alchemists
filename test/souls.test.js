// Souls: free sealing from eight items, the early multiplier, rarity, quotas, release by the summoner.
// Stream: pours open epochs, claims by weight, the gate at the hundredth soul, burned souls stop claiming, drain.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const P = require("../deploy/params.local.json");

const item = (kind, tier) => 2000 + kind * 8 + tier;
const E6 = 1_000_000n;

async function fixture() {
  const [owner, alice, bob, carol, treasury] = await ethers.getSigners();
  const d = await deployAll(ethers, P, treasury.address);
  await d.materials.setMinter(owner.address, true);
  await d.keys.setMinter(owner.address, true);
  const souls = d.souls; // deployed and wired by deployAll (minter on Materials and Keys)
  await souls.setBaseURI("https://host/souls/");
  const stream = await ethers.deployContract("Stream", [await souls.getAddress(), 3, treasury.address]); // the gate at 3 souls for the tests; the treasury pours
  return { ...d, souls, stream, owner, alice, bob, carol, treasury };
}

// five required items of one tier, enhancers empty
const five = (tier) => [item(0, tier), item(1, tier), item(2, tier), item(3, tier), item(4, tier), 0, 0, 0];
const full = (tier) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => item(k, tier));
async function give(materials, to, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  await materials.mintCraftedBatch(to, uniq, uniq.map((id) => BigInt(ids.filter((x) => x === id).length)));
}

describe("Souls", function () {
  it("seals a soul for free from five items, burns them and follows the summoning rank rules", async function () {
    const { materials, souls, alice } = await loadFixture(fixture);
    await give(materials, alice.address, five(1));
    await expect(souls.connect(alice).seal(five(1), 255)).to.emit(souls, "Sealed").withArgs(1n, alice.address, 1, 100, 255);
    expect(await souls.ownerOf(1)).to.equal(alice.address);
    expect(await materials.balanceOf(alice.address, item(0, 1))).to.equal(0n);
    await expect(souls.connect(alice).seal([0, item(1, 1), item(2, 1), item(3, 1), item(4, 1), 0, 0, 0], 255)).to.be.revertedWith("Souls: required slot empty");
    await give(materials, alice.address, full(5));
    await expect(souls.connect(alice).seal(full(5), 255)).to.emit(souls, "Sealed").withArgs(2n, alice.address, 5, 500, 255);
    expect(await souls.tokenURI(2)).to.equal("https://host/souls/5.json");
  });

  it("weighs rarity by the unrounded average tier and the early multiplier from 2.0 down to 1.0 at the hundredth", async function () {
    const { materials, souls, alice } = await loadFixture(fixture);
    await give(materials, alice.address, five(1));
    await souls.connect(alice).seal(five(1), 255);
    expect(await souls.rarity(1)).to.equal(E6); // avg 1.0 -> 2^0
    expect(await souls.early(1)).to.equal(2n * E6);
    expect(await souls.weight(1)).to.equal(2n * E6);
    expect(await souls.early(50)).to.equal(2n * E6 - (49n * E6) / 99n);
    expect(await souls.early(100)).to.equal(E6);
    expect(await souls.early(101)).to.equal(E6);
    expect(await souls.early(5555)).to.equal(E6);
    await give(materials, alice.address, full(5));
    await souls.connect(alice).seal(full(5), 255);
    expect(await souls.rarity(2)).to.equal(16n * E6); // avg 5.0 -> 2^4
    expect(await souls.weight(2)).to.equal((16n * E6) * (2n * E6 - E6 / 99n) / E6);
  });

  it("names a soul with a key of the right kind and weighs it 16", async function () {
    const { materials, keys, souls, alice } = await loadFixture(fixture);
    await keys.claimOfKind(alice.address, 4, 7); // a scepter key
    let key = null;
    for (const i of [11, 12, 13]) if ((await keys.keyClaimed(i)) && (await keys.ownerOf(i)) === alice.address) key = i;
    await give(materials, alice.address, [item(0, 1), item(1, 1), item(2, 1), item(3, 1)]);
    await expect(souls.connect(alice).seal([item(0, 1), item(1, 1), item(2, 1), item(3, 1), 0, 0, 0, 0], key)).to.emit(souls, "Sealed").withArgs(1n, alice.address, 6, 150, key); // 4 x tier 1 + the key as 5 + 3 empty as 1 = 12 / 8
    expect(await souls.rarity(1)).to.equal(16n * E6);
    expect(await keys.balanceOf(alice.address)).to.equal(0n);
  });

  it("only the summoner may release a soul, only for its owner, and a released soul weighs zero", async function () {
    const { materials, souls, alice, bob, owner } = await loadFixture(fixture);
    await give(materials, alice.address, five(1));
    await souls.connect(alice).seal(five(1), 255);
    await expect(souls.connect(bob).release(alice.address, 1)).to.be.revertedWith("Souls: not summoner");
    await souls.connect(owner).setSummoner(bob.address); // a stand-in for the main-act contract
    await expect(souls.connect(bob).release(bob.address, 1)).to.be.revertedWith("Souls: not owner");
    await expect(souls.connect(bob).release(alice.address, 1)).to.emit(souls, "Released").withArgs(1n, bob.address);
    expect(await souls.weight(1)).to.equal(0n);
    expect(await souls.burned()).to.equal(1n);
    await expect(souls.ownerOf(1)).to.be.revertedWithCustomError(souls, "ERC721NonexistentToken");
  });
});

describe("Stream", function () {
  async function threeSouls() {
    const f = await loadFixture(fixture);
    const { materials, souls, alice, bob, carol } = f;
    await give(materials, alice.address, full(5)); await souls.connect(alice).seal(full(5), 255); // #1: rarity 16, early 2.0 -> 32
    await give(materials, bob.address, five(1)); await souls.connect(bob).seal(five(1), 255); // #2: rarity 1, early ~1.99
    return f;
  }

  it("refuses a pour with nobody to claim and holds claims closed until the gate", async function () {
    const { stream, treasury } = await loadFixture(fixture);
    await expect(treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("1") })).to.be.revertedWith("Stream: no weight");
    expect(await stream.isOpen()).to.equal(false);
  });

  it("pours accumulate before the gate and are all claimable at once when it opens, split by weight", async function () {
    const { souls, stream, materials, alice, bob, carol, treasury } = await threeSouls();
    await treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("1") });
    await stream.connect(treasury).pour({ value: ethers.parseEther("1") });
    expect(await stream.epochCount()).to.equal(2n);
    expect(await stream.isOpen()).to.equal(false);
    await expect(stream.claim(0, 1)).to.be.revertedWith("Stream: not open yet");
    // the third soul opens the gate; it joins the third epoch only
    await give(materials, carol.address, five(1)); await souls.connect(carol).seal(five(1), 255);
    expect(await stream.isOpen()).to.equal(true);
    const w1 = await souls.weight(1), w2 = await souls.weight(2);
    const tw = w1 + w2;
    const expect1 = (ethers.parseEther("1") * w1) / tw + (ethers.parseEther("1") * w1) / tw; // per epoch, as the contract rounds
    expect(await stream.claimable(0, 1)).to.equal(expect1);
    const before = await ethers.provider.getBalance(alice.address);
    await stream.connect(bob).claim(0, 1); // anyone may trigger, the ETH goes to the owner
    expect((await ethers.provider.getBalance(alice.address)) - before).to.equal(expect1);
    expect(await stream.claimable(0, 1)).to.equal(0n);
    await stream.claim(0, 2);
    expect(await stream.claimable(0, 3)).to.equal(0n); // carol was not there for the first two pours: a soul sealed after a pour has no share of it
    await treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("3") });
    const w3 = await souls.weight(3);
    expect(await stream.claimable(0, 3)).to.equal((ethers.parseEther("3") * w3) / (w1 + w2 + w3));
    await expect(stream.claimMany(0, [1, 2, 3])).to.emit(stream, "Claimed");
    expect(await ethers.provider.getBalance(await stream.getAddress())).to.be.lt(10n); // rounding dust only
  });

  it("a soul burned into an alchemist stops claiming, the timelock can drain unclaimed ETH after the grace", async function () {
    const { souls, stream, materials, alice, carol, owner, treasury } = await threeSouls();
    await give(materials, carol.address, five(1)); await souls.connect(carol).seal(five(1), 255);
    await treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("1") });
    await souls.connect(owner).setSummoner(owner.address);
    await souls.connect(owner).release(alice.address, 1);
    await expect(stream.claim(0, 1)).to.be.revertedWith("Stream: no weight");
    expect(await stream.claimable(0, 1)).to.equal(0n);
    await stream.claim(0, 2); await stream.claim(0, 3);
    await expect(stream.connect(owner).drain(0, treasury.address)).to.be.revertedWith("Stream: grace");
    await time.increase(366 * 24 * 3600);
    const before = await ethers.provider.getBalance(treasury.address);
    await stream.connect(owner).drain(0, treasury.address);
    expect((await ethers.provider.getBalance(treasury.address)) - before).to.be.gt(0n); // soul #1's unclaimed share
  });

  it("switches new epochs to a later collection while old epochs stay with their tokens", async function () {
    const { souls, stream, materials, alice, carol, owner, treasury } = await threeSouls();
    await give(materials, carol.address, five(1)); await souls.connect(carol).seal(five(1), 255);
    await treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("1") });
    const second = await ethers.deployContract("Souls", [await souls.mine(), await souls.materials(), await souls.keys(), ""]); // stands in for the alchemists
    await materials.setMinter(await second.getAddress(), true);
    await stream.connect(owner).addCollection(await second.getAddress());
    await stream.connect(owner).setCurrent(1, 1);
    await expect(treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("1") })).to.be.revertedWith("Stream: no weight");
    await give(materials, alice.address, five(1)); await second.connect(alice).seal(five(1), 255);
    await treasury.sendTransaction({ to: await stream.getAddress(), value: ethers.parseEther("1") });
    expect(await stream.claimable(1, 1)).to.equal(ethers.parseEther("1"));
    expect(await stream.claimable(0, 1)).to.be.gt(0n); // the first pour still belongs to soul #1
    await stream.claim(0, 1);
    await stream.claim(1, 1);
  });
});
