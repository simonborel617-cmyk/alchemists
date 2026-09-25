// The reveal seed (owner decisions 2026-09-25): a find's tier is rolled at the reveal, never read off the hash, and the
// seed that rolls it can neither be known when the find is paid for nor be chosen afterwards. On Robinhood Chain
// block.number is the parent-chain block number and blockhash(n) is the hash of the last L2 block before the chain moved
// past parent block n, so a commit made at parent block l1 settles with keccak(blockhash(l1 .. l1+3)): fixed by chain
// history, the same for every caller at any time. In Hardhat every block stands for one parent block.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const { findNonce, workQ8 } = require("../scripts/lib/work");
const P = require("../deploy/params.local.json");

const ZERO = ethers.ZeroHash;
const STEP_Q8 = [0, 512, 1024, 1792, 2560];

async function nextMinute() {
  const ts = await time.latest();
  await time.increaseTo((Math.floor(ts / 60) + 1) * 60 + 1);
  await ethers.provider.send("hardhat_mine", ["0x4"]); // a minute spans ~5 parent-chain blocks on mainnet; reveal seeds need 4
}
const mineBlocks = (n) => ethers.provider.send("hardhat_mine", ["0x" + n.toString(16)]);
async function deployFixture() {
  const signers = await ethers.getSigners();
  const [owner, , , treasury] = signers;
  const d = await deployAll(ethers, P, treasury.address);
  await d.materials.setMinter(owner.address, true);
  return { ...d, owner, miners: signers.slice(4, 16), treasury };
}
const parse = (rc, c, name) => rc.logs.map((l) => { try { return c.interface.parseLog(l); } catch { return null; } }).filter((e) => e && e.name === name);
const roll = (r) => workQ8(Buffer.from(ethers.solidityPackedKeccak256(["uint256"], [r]).slice(2), "hex"));
async function seedFormula(mine, p) {
  const h = async (n) => (await ethers.provider.getBlock(Number(n))).hash;
  return ethers.solidityPackedKeccak256(["address", "uint64", "bytes32", "bytes32", "bytes32", "bytes32"], [await mine.getAddress(), p, await h(p), await h(p + 1n), await h(p + 2n), await h(p + 3n)]);
}
async function submitOnce(mine, w, extraQ8 = 0) {
  await nextMinute();
  await mine.tick();
  const m = await mine.currentMinute();
  const { nonce } = findNonce(w.address, await mine.challenge(m), Number(await mine.tQ8()) + extraQ8);
  await nextMinute();
  const rc = await (await mine.connect(w).submit(m, nonce, { value: await mine.currentPrice() })).wait();
  return BigInt(rc.blockNumber);
}

describe("Reveal seed and the tier roll", function () {
  it("rolls type, tier, upgrade and key exactly from the pending hash and the reveal seed, whatever the hash's height", async function () {
    const { mine, materials, miners } = await loadFixture(deployFixture);
    const cfg = await mine.config();
    const checked = [];
    for (let round = 0; round < 3; round++) {
      await nextMinute();
      await mine.tick();
      const m = await mine.currentMinute();
      const c = await mine.challenge(m), t = Number(await mine.tQ8());
      // half the miners bring a hash 8 bits over the bar: it must not change their odds
      const nonces = miners.map((w, i) => findNonce(w.address, c, t + (i % 2 ? 8 * 256 : 0)).nonce);
      await nextMinute();
      for (let i = 0; i < miners.length; i++) await mine.connect(miners[i]).submit(m, nonces[i], { value: await mine.currentPrice() });
      await nextMinute();
      for (const w of miners) {
        const pd = await mine.pendingAt(w.address, 0);
        const e = await mine.revealSeed(pd.l1);
        expect(e).to.equal(await seedFormula(mine, pd.l1));
        const r = BigInt(ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [pd.hash, e]));
        const type = Number(r % 40n);
        let tier = 1;
        const x = roll(r);
        for (let k = 2; k <= 5; k++) {
          if (k > Number(pd.unlockedTier)) break;
          const thr = STEP_Q8[k - 1] + Number((await materials.circulating(await materials.ingId(type, k))) * 256n / BigInt(cfg.extraK[k - 2]));
          if (x >= thr) tier = k;
        }
        const up = tier < 5 && ((r >> 8n) % BigInt(cfg.upgradeChance)) === 0n;
        if (up) tier += 1;
        const key = ((r >> 16n) % BigInt(cfg.keyChance)) === 0n;
        const rc = await (await mine.reveal(w.address)).wait();
        if (key) { expect(parse(rc, mine, "KeyMined")).to.have.length(1); continue; }
        const ev = parse(rc, mine, "Mined")[0];
        expect(Number(ev.args.typeId), "type").to.equal(type);
        expect(Number(ev.args.tier), "tier").to.equal(tier);
        expect(ev.args.upgraded).to.equal(up);
        checked.push(tier);
      }
    }
    expect(checked.length).to.be.gte(30);
  });

  it("the roll follows the small-miner law: P(tier >= k) = 2^-(2, 4, 7, 10 bits)", async function () {
    const N = 100000;
    const at = [0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const x = roll(BigInt(ethers.solidityPackedKeccak256(["string", "uint256"], ["find", i])));
      for (let k = 1; k < 5; k++) if (x >= STEP_Q8[k]) at[k]++;
    }
    const share = at.map((n) => n / N);
    expect(share[1]).to.be.closeTo(0.25, 0.006);
    expect(share[2]).to.be.closeTo(1 / 16, 0.003);
    expect(share[3]).to.be.closeTo(1 / 128, 0.0012);
    expect(share[4]).to.be.closeTo(1 / 1024, 0.0004);
  });

  it("is zero until four parent blocks have passed, then fixed by chain history: whoever reads it and whenever", async function () {
    const { mine, miners } = await loadFixture(deployFixture);
    const l1 = await submitOnce(mine, miners[0]);
    expect(await mine.revealSeed(l1)).to.equal(ZERO);
    await mineBlocks(3);
    expect(await mine.revealSeed(l1)).to.equal(ZERO); // block.number = l1 + 3
    await mineBlocks(1);
    const s = await mine.revealSeed(l1); // block.number = l1 + 4
    expect(s).to.equal(await seedFormula(mine, l1));
    await mine.tick(); // records it
    await mineBlocks(40);
    await mine.connect(miners[1]).reveal(miners[0].address); // someone else settles it: same seed, no choice
    expect(await mine.revealSeed(l1)).to.equal(s);
    await mineBlocks(400); // long past the 256-block window: the recorded value stays
    expect(await mine.revealSeed(l1)).to.equal(s);
  });

  it("does not depend on the finds of the minute or on when the minute is ticked", async function () {
    const { mine, miners } = await loadFixture(deployFixture);
    await nextMinute();
    await mine.tick();
    const m = await mine.currentMinute();
    const c = await mine.challenge(m), t = Number(await mine.tQ8());
    const n0 = findNonce(miners[0].address, c, t).nonce, n1 = findNonce(miners[1].address, c, t).nonce;
    await nextMinute();
    const b0 = BigInt((await (await mine.connect(miners[0]).submit(m, n0, { value: await mine.currentPrice() })).wait()).blockNumber);
    await mine.connect(miners[1]).submit(m, n1, { value: await mine.currentPrice() }); // changes findAcc after the first
    await time.increase(600); // the next minutes are ticked late, by whoever
    await mineBlocks(6);
    await mine.tick();
    expect(await mine.revealSeed(b0)).to.equal(await seedFormula(mine, b0));
  });

  it("records the seed of every ticked parent block once final, and a commit nobody recorded in the window lapses to the worst outcome", async function () {
    const { mine, miners } = await loadFixture(deployFixture);
    // recorded: a tick after the commit's block is final keeps its seed past the 256-block window
    const l1 = await submitOnce(mine, miners[0]);
    await mineBlocks(4);
    await mine.tick();
    const want = await seedFormula(mine, l1);
    await mineBlocks(400);
    expect(await mine.revealSeed(l1)).to.equal(want);
    expect(await mine.notedHead()).to.be.gt(0n);
    // lapsed: nobody touches the mine while the find's block leaves the window
    const l2 = await submitOnce(mine, miners[1]);
    const pd = await mine.pendingAt(miners[1].address, 0);
    await mineBlocks(300);
    expect(await mine.revealSeed(l2)).to.equal(await mine.LOST_SEED());
    const rc = await (await mine.reveal(miners[1].address)).wait();
    const ev = parse(rc, mine, "Mined")[0];
    expect(Number(ev.args.tier)).to.equal(1); // a Common of the type its own hash names, no upgrade, no key
    expect(Number(ev.args.typeId)).to.equal(Number(BigInt(pd.hash) % 40n));
    expect(ev.args.upgraded).to.equal(false);
  });

  it("a lapsed workshop commit settles as its worst outcome", async function () {
    const { mine, materials, workshop, owner, miners } = await loadFixture(deployFixture);
    const w = miners[0];
    const ids = [...Array(10)].map((_, i) => 1 + i * 8 + 1);
    await materials.connect(owner).mintCraftedBatch(w.address, ids, ids.map(() => 1));
    const rc = await (await workshop.connect(w).reroll(1, 255, ids, ids.map(() => 1))).wait();
    const id = Number(parse(rc, workshop, "Committed")[0].args.id);
    await mineBlocks(300);
    const r2 = await (await workshop.reveal(id)).wait();
    const ev = parse(r2, workshop, "Rerolled")[0];
    expect(ev.args.outIds.length).to.equal(0);
  });

  it("a workshop commit settles by the seed of its own parent block, four blocks later", async function () {
    const { mine, materials, workshop, owner, miners } = await loadFixture(deployFixture);
    const w = miners[0];
    const ing = (t, tier) => 1 + t * 8 + tier;
    const ids = [...Array(10)].map((_, i) => ing(i, 1));
    await materials.connect(owner).mintCraftedBatch(w.address, ids, ids.map(() => 1));
    await nextMinute();
    await mine.tick();
    const rc = await (await workshop.connect(w).reroll(1, 255, ids, ids.map(() => 1))).wait();
    const id = Number(parse(rc, workshop, "Committed")[0].args.id);
    const cm = await workshop.commits(id);
    expect(cm.l1).to.equal(BigInt(rc.blockNumber));
    await expect(workshop.reveal(id)).to.be.revertedWith("Workshop: not yet");
    await mineBlocks(3);
    const e = await mine.revealSeed(cm.l1);
    expect(e).to.equal(await seedFormula(mine, cm.l1));
    await expect(workshop.reveal(id)).to.emit(workshop, "Rerolled");
  });
});
