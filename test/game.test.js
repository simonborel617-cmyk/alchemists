const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const { findNonce, workQ8 } = require("../scripts/lib/work");
const P = require("../deploy/params.local.json");

const ZERO = "0x" + "0".repeat(64);

async function nextMinute() {
  const ts = await time.latest();
  await time.increaseTo((Math.floor(ts / 60) + 1) * 60 + 1);
}

async function deployFixture() {
  const [owner, alice, bob, treasury] = await ethers.getSigners();
  const d = await deployAll(ethers, P, treasury.address);
  await d.materials.setMinter(owner.address, true); // test fixtures mint directly
  await d.keys.setMinter(owner.address, true);
  return { ...d, owner, alice, bob, treasury };
}

const ing = (t, tier) => 1 + t * 8 + tier;
const item = (kind, tier) => 2000 + kind * 8 + tier;

async function give(materials, to, list) {
  for (const [id, amt] of list) await materials.mintCrafted(to, id, amt);
}

describe("Mine", function () {
  it("submits a find in the next minute and reveals an ingredient two minutes later", async function () {
    const { mine, materials, alice, treasury } = await loadFixture(deployFixture);
    await nextMinute();
    await mine.tick();
    const m = await mine.currentMinute();
    const c = await mine.challenge(m);
    expect(c).to.not.equal(ZERO);
    const t = Number(await mine.tQ8());
    expect(t).to.equal(12 * 256);
    const { nonce, hash } = findNonce(alice.address, c, t);
    expect(workQ8(hash)).to.be.gte(t);

    await nextMinute();
    const price = await mine.currentPrice();
    expect(price).to.equal(200000000000000n);
    const before = await ethers.provider.getBalance(treasury.address);
    await expect(mine.connect(alice).submit(m, nonce, { value: price * 2n })).to.emit(mine, "Submitted");
    expect((await ethers.provider.getBalance(treasury.address)) - before).to.equal(price);
    expect(await mine.pendingCount(alice.address)).to.equal(1n);
    expect(await mine.oreRemaining()).to.equal(999999n);

    await expect(mine.connect(alice).submit(m, nonce, { value: price })).to.be.revertedWith("Mine: one per minute");

    await nextMinute();
    await mine.tick();
    const tx = await mine.reveal(alice.address);
    const rc = await tx.wait();
    const mined = rc.logs.map((l) => { try { return mine.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Mined");
    expect(mined, "Mined event").to.exist;
    const id = mined.args.id;
    expect(await materials.balanceOf(alice.address, id)).to.equal(1n);
    expect(await materials.minedTotal()).to.equal(1n);
    expect(await mine.pendingCount(alice.address)).to.equal(0n);
  });

  it("rejects work below threshold and wrong submit window", async function () {
    const { mine, alice } = await loadFixture(deployFixture);
    await nextMinute();
    await mine.tick();
    const m = await mine.currentMinute();
    const price = await mine.currentPrice();
    await expect(mine.connect(alice).submit(m, 1n, { value: price })).to.be.revertedWith("Mine: submit in the next minute");
    await nextMinute();
    // nonce 0 almost surely has < 8 leading zero bits; find one that does not qualify
    const c = await mine.challenge(m);
    let bad = 0n;
    for (;;) {
      const { sha256, preimage, setNonce } = require("../scripts/lib/work");
      const buf = preimage(alice.address, c);
      setNonce(buf, bad);
      if (workQ8(sha256(buf)) < 12 * 256) break;
      bad++;
    }
    await expect(mine.connect(alice).submit(m, bad, { value: price })).to.be.revertedWith("Mine: below threshold");
  });

  it("retargets after a window and stays inside the corridor", async function () {
    const { mine, alice } = await loadFixture(deployFixture);
    for (let round = 0; round < 3; round++) {
      await nextMinute();
      await mine.tick();
      const m = await mine.currentMinute();
      const c = await mine.challenge(m);
      const t = Number(await mine.tQ8());
      const { nonce } = findNonce(alice.address, c, t);
      await nextMinute();
      await mine.connect(alice).submit(m, nonce, { value: await mine.currentPrice() });
    }
    await nextMinute();
    await expect(mine.tick()).to.emit(mine, "Retarget");
    const t = Number(await mine.tQ8());
    expect(t).to.be.gte(12 * 256);
    expect(t).to.be.lte(43 * 256);
    // tiny unlock thresholds in params.local: every tier should be open now
    expect(await mine.unlockedTier()).to.equal(5);
  });

  it("fills challenge gaps and still settles old pendings", async function () {
    const { mine, alice } = await loadFixture(deployFixture);
    await nextMinute();
    await mine.tick();
    const m = await mine.currentMinute();
    const c = await mine.challenge(m);
    const { nonce } = findNonce(alice.address, c, Number(await mine.tQ8()));
    await nextMinute();
    await mine.connect(alice).submit(m, nonce, { value: await mine.currentPrice() });
    await time.increase(60 * 600); // ten hours of silence
    await mine.tick();
    expect(await mine.entropy(m + 2n)).to.not.equal(ZERO);
    await expect(mine.reveal(alice.address)).to.emit(mine, "Mined");
  });
});

describe("Workshop", function () {
  it("crafts a potion and a furnace, then refines with a commit/reveal", async function () {
    const { materials, workshop, furnaces, alice, mine } = await loadFixture(deployFixture);
    // herbs: types 16..23 ; metals 0..7 ; minerals 8..15 ; wood 24..31
    await give(materials, alice.address, [
      [ing(16, 1), 2],
      [ing(0, 1), 4], [ing(8, 1), 3], [ing(24, 1), 3],
      [ing(2, 1), 10],
    ]);
    await workshop.connect(alice).craftPotion(1, ing(16, 1), ing(16, 1));
    expect(await materials.balanceOf(alice.address, 1001)).to.equal(1n);
    await workshop.connect(alice).craftFurnace(1, [ing(0, 1), ing(8, 1), ing(24, 1)], [4, 3, 3]);
    expect(await furnaces.ownerOf(1)).to.equal(alice.address);
    expect(await furnaces.tier(1)).to.equal(1);
    expect(await workshop.refineInputs()).to.equal(10n);
    await workshop.connect(alice).refine(1, 2, 1);
    expect(await materials.balanceOf(alice.address, ing(2, 1))).to.equal(0n);
    expect(await materials.burnedIngredients()).to.equal(22n); // 2 herbs + 10 furnace + 10 inputs
    await expect(workshop.reveal(0)).to.be.revertedWith("Workshop: not yet");
    await nextMinute();
    await mine.tick();
    const tx = await workshop.reveal(0);
    const rc = await tx.wait();
    const ev = rc.logs.map((l) => { try { return workshop.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Refined");
    expect(ev).to.exist;
    const out = await materials.balanceOf(alice.address, ing(2, 2));
    expect(out).to.equal(ev.args.success ? 1n : 0n);
    await expect(workshop.reveal(0)).to.be.revertedWith("Workshop: settled");
    await expect(workshop.connect(alice).refine(1, 2, 1)).to.be.revertedWith("Furnaces: cooling");
  });

  it("rerolls 10 same-tier ingredients into outputs of a chosen category", async function () {
    const { materials, workshop, alice, mine } = await loadFixture(deployFixture);
    await give(materials, alice.address, [[ing(0, 2), 6], [ing(30, 2), 4]]);
    await expect(workshop.connect(alice).reroll(2, 4, [ing(0, 2)], [6])).to.be.revertedWith("Workshop: need 10");
    await workshop.connect(alice).reroll(2, 4, [ing(0, 2), ing(30, 2)], [6, 4]);
    await nextMinute();
    await mine.tick();
    const rc = await (await workshop.reveal(0)).wait();
    const ev = rc.logs.map((l) => { try { return workshop.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Rerolled");
    expect(ev.args.outIds.length).to.equal(5);
    for (const id of ev.args.outIds) {
      const cat = Number((id - 1n) / 64n);
      expect(cat).to.equal(4); // beasts
      expect(await materials.balanceOf(alice.address, id)).to.be.gte(1n);
    }
  });

  it("crafts a ritual item by recipe", async function () {
    const { materials, workshop, alice, mine } = await loadFixture(deployFixture);
    // chalice: 3 metals + 2 minerals, tier 3
    await give(materials, alice.address, [[ing(5, 3), 3], [ing(9, 3), 2]]);
    await expect(workshop.connect(alice).craftItem(2, 3, [ing(5, 3)], [3])).to.be.revertedWith("Workshop: recipe");
    await workshop.connect(alice).craftItem(2, 3, [ing(5, 3), ing(9, 3)], [3, 2]);
    await nextMinute();
    await mine.tick();
    const rc = await (await workshop.reveal(0)).wait();
    const ev = rc.logs.map((l) => { try { return workshop.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Crafted");
    expect([3, 4]).to.include(Number(ev.args.outTier));
    expect(await materials.balanceOf(alice.address, item(2, Number(ev.args.outTier)))).to.equal(1n);
  });
});

describe("Alchemists", function () {
  it("summons by rank, honours empty enhancers, reveals a seed and weights", async function () {
    const { materials, alchemists, alice, mine } = await loadFixture(deployFixture);
    const full = [];
    for (let k = 0; k < 8; k++) full.push(item(k, 5));
    await give(materials, alice.address, full.map((id) => [id, 1]));
    await expect(alchemists.connect(alice).summon(full, 255)).to.emit(alchemists, "Summoned").withArgs(1n, alice.address, 5, 500, 255);
    expect(await alchemists.ownerOf(1)).to.equal(alice.address);
    expect(await alchemists.mintedByRank(5)).to.equal(1);

    // five legendary required + three empty enhancers -> (25 + 3) / 8 = 3.5 -> rank 3
    const five = [item(0, 5), item(1, 5), item(2, 5), item(3, 5), item(4, 5), 0, 0, 0];
    await give(materials, alice.address, five.filter(Boolean).map((id) => [id, 1]));
    await expect(alchemists.connect(alice).summon(five, 255)).to.emit(alchemists, "Summoned").withArgs(2n, alice.address, 3, 350, 255);

    await expect(alchemists.connect(alice).summon([0, item(1, 1), item(2, 1), item(3, 1), item(4, 1), 0, 0, 0], 255)).to.be.revertedWith("Alchemists: required slot empty");

    await expect(alchemists.reveal(1)).to.be.revertedWith("Alchemists: not yet");
    await nextMinute();
    await mine.tick();
    await expect(alchemists.reveal(1)).to.emit(alchemists, "Revealed");
    const d = await alchemists.data(1);
    expect(d.seed).to.not.equal(ZERO);

    const w1 = await alchemists.weight(1); // archmage, cohort 1 -> 16
    const w2 = await alchemists.weight(2); // avg 3.5 -> 2^2.5 = 5.657
    expect(w1).to.equal(16000000n);
    expect(w2).to.be.closeTo(5656854n, 2000n);
  });

  it("summons a named 1/1 with a key of the right kind", async function () {
    const { materials, keys, alchemists, alice, owner } = await loadFixture(deployFixture);
    await keys.claimOfKind(alice.address, 4, 7); // some scepter key (kind 4, indices 11..13)
    let key = null;
    for (const i of [11, 12, 13]) if ((await keys.keyClaimed(i)) && (await keys.ownerOf(i)) === alice.address) key = i;
    expect(key, "key minted").to.not.equal(null);
    expect(await keys.unclaimedOfKind(4)).to.equal(2n);
    expect(await keys.unclaimedCount()).to.equal(20n);
    expect(await keys.balanceOf(alice.address)).to.equal(1n);

    await give(materials, alice.address, [[item(1, 1), 1], [item(2, 1), 1], [item(3, 1), 1], [item(4, 1), 1]]);
    // the key fills the scepter slot, so an item there is refused
    await expect(alchemists.connect(alice).summon([0, item(1, 1), item(2, 1), item(3, 1), item(4, 1), 0, 0, 0], key)).to.be.revertedWith("Alchemists: key slot taken");
    // a key nobody holds cannot be offered
    await expect(alchemists.connect(alice).summon([0, item(1, 1), item(2, 1), item(3, 1), 0, 0, 0, 0], 0)).to.be.revertedWithCustomError(keys, "ERC721NonexistentToken");
    // the key of another holder cannot be offered
    await keys.claimOfKind(owner.address, 4, 11);
    let other = null;
    for (const i of [11, 12, 13]) if (i !== key && (await keys.keyClaimed(i))) other = i;
    await expect(alchemists.connect(alice).summon([0, item(1, 1), item(2, 1), item(3, 1), 0, 0, 0, 0], other)).to.be.revertedWith("Keys: not owner");

    await give(materials, alice.address, [[item(0, 1), 1]]);
    await expect(alchemists.connect(alice).summon([item(0, 1), item(1, 1), item(2, 1), item(3, 1), 0, 0, 0, 0], key)).to.emit(alchemists, "Summoned");
    const d = await alchemists.data(1);
    expect(d.rank).to.equal(6);
    expect(d.nameId).to.equal(key);
    expect(await alchemists.weight(1)).to.equal(16000000n);
    expect(await keys.balanceOf(alice.address)).to.equal(0n); // the key was burned by the summoning
    expect(await materials.balanceOf(alice.address, item(4, 1))).to.equal(1n); // the scepter item stayed, the key filled its slot
    expect(await alchemists.mintedByRank(6)).to.equal(1);
  });
});
