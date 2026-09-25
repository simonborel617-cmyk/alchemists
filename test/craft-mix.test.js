// The ritual table with mixed tiers: five ingredients by recipe, any tiers. The item's tier is the tier of one input drawn
// evenly; a ritual of d different tiers fails with mixFailStep x (d - 1) percent (5 % per extra tier, 20 % at most) and
// yields nothing. Frequencies are checked over hundreds of real commit/reveal crafts, within four standard deviations.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const P = require("../deploy/params.local.json");

const ing = (t, tier) => 1 + t * 8 + tier;
const item = (kind, tier) => 2000 + kind * 8 + tier;
const NO_KEY = [4294967295, 4294967295, 4294967295, 4294967295, 4294967295];

async function nextMinute() {
  const ts = await time.latest();
  await time.increaseTo((Math.floor(ts / 60) + 1) * 60 + 1);
}
async function fixture() {
  const [owner, alice] = await ethers.getSigners();
  const d = await deployAll(ethers, P, owner.address);
  await d.materials.setMinter(owner.address, true);
  await d.workshop.setCraft(NO_KEY, 0); // isolate the tier draw: no keys, no tier-up
  return { ...d, owner, alice };
}

// n chalices (kind 2: 3 metals + 2 minerals) from the given inputs, committed in one minute, revealed the next
async function craftMany(d, n, ids, amts) {
  const { materials, workshop, mine, owner, alice } = d;
  await materials.connect(owner).mintCraftedBatch(alice.address, ids, amts.map((a) => BigInt(a * n)));
  const first = Number(await workshop.commitCount());
  for (let i = 0; i < n; i++) await workshop.connect(alice).craftItem(2, ids, amts);
  await nextMinute();
  await mine.tick();
  const out = [];
  for (let i = first; i < first + n; i += 60) {
    const batch = Array.from({ length: Math.min(60, first + n - i) }, (_, k) => i + k);
    const rc = await (await workshop.revealMany(batch)).wait();
    for (const l of rc.logs) { try { const e = workshop.interface.parseLog(l); if (e && e.name === "Crafted") out.push(Number(e.args.outTier)); } catch {} }
  }
  expect(out.length).to.equal(n);
  const count = (t) => out.filter((x) => x === t).length;
  return { out, count };
}
const within = (got, n, p) => { const sd = Math.sqrt(n * p * (1 - p)); expect(got, `got ${got}, expected ~${(n * p).toFixed(0)}`).to.be.within(n * p - 4 * sd - 1, n * p + 4 * sd + 1); };

describe("Ritual table: mixed tiers", function () {
  this.timeout(600000);

  it("a ritual of one tier never fails and keeps its tier, as before", async function () {
    const d = await loadFixture(fixture);
    const { count } = await craftMany(d, 60, [ing(0, 3), ing(8, 3)], [3, 2]);
    expect(count(3)).to.equal(60);
  });

  it("1 Uncommon + 4 Rare: fails ~5 %, Uncommon ~19 %, Rare ~76 %, nothing else", async function () {
    const d = await loadFixture(fixture);
    const n = 400;
    const { count } = await craftMany(d, n, [ing(0, 3), ing(8, 3), ing(8, 2)], [3, 1, 1]);
    console.log(`      ${n} rituals: failed ${count(0)}, Uncommon ${count(2)}, Rare ${count(3)}`);
    within(count(0), n, 0.05);
    within(count(2), n, 0.19);
    within(count(3), n, 0.76);
    expect(count(0) + count(2) + count(3)).to.equal(n);
  });

  it("all five tiers: fails ~20 % (the cap), and only the tiers put in come out", async function () {
    const d = await loadFixture(fixture);
    const n = 300;
    // metals: Common, Uncommon, Rare; minerals: Epic, Legendary
    const { count, out } = await craftMany(d, n, [ing(0, 1), ing(1, 2), ing(2, 3), ing(8, 4), ing(9, 5)], [1, 1, 1, 1, 1]);
    console.log(`      ${n} rituals: failed ${count(0)}, C/U/R/E/L ${[1, 2, 3, 4, 5].map(count).join("/")}`);
    within(count(0), n, 0.2);
    for (const t of [1, 2, 3, 4, 5]) within(count(t), n, 0.16);
    expect(out.every((t) => t >= 0 && t <= 5)).to.equal(true);
  });

  it("a failed ritual mints nothing; a successful one mints exactly one item of the drawn tier", async function () {
    const d = await loadFixture(fixture);
    const { materials, alice } = d;
    const n = 120;
    const { count } = await craftMany(d, n, [ing(0, 1), ing(1, 2), ing(2, 3), ing(8, 4), ing(9, 5)], [1, 1, 1, 1, 1]);
    for (const t of [1, 2, 3, 4, 5]) expect(await materials.balanceOf(alice.address, item(2, t))).to.equal(BigInt(count(t)));
    for (const id of [ing(0, 1), ing(1, 2), ing(2, 3), ing(8, 4), ing(9, 5)]) expect(await materials.balanceOf(alice.address, id)).to.equal(0n); // all inputs burned
  });

  it("the tier-up and the key follow the drawn tier; mixFailStep is owner-only, at most 5, and 0 makes mixing safe", async function () {
    const d = await loadFixture(fixture);
    const { workshop, alice, owner } = d;
    await expect(workshop.connect(alice).setMixFail(0)).to.be.revertedWithCustomError(workshop, "OwnableUnauthorizedAccount");
    await expect(workshop.connect(owner).setMixFail(6)).to.be.revertedWith("Workshop: mix fail");
    await workshop.connect(owner).setMixFail(0);
    const a = await craftMany(d, 60, [ing(0, 1), ing(1, 2), ing(2, 3), ing(8, 4), ing(9, 5)], [1, 1, 1, 1, 1]);
    expect(a.count(0)).to.equal(0);
    await workshop.connect(owner).setMixFail(5);
    await workshop.connect(owner).setCraft(NO_KEY, 100); // every ritual tiers up one step (Legendary stays)
    const b = await craftMany(d, 60, [ing(0, 1), ing(8, 2)], [3, 2]); // 3 Common + 2 Uncommon
    expect(b.count(1)).to.equal(0); // a Common drawn became Uncommon, an Uncommon became Rare
    expect(b.count(2) + b.count(3) + b.count(0)).to.equal(60);
  });
});
