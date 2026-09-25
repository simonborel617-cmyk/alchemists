// The souls package (owner decision 2026-09-25).
// Souls: rank weights 1/4/16/64/256, named 512; founder mark by No. within the rank from Adept up (Apprentice none);
// quotas 3014/1111/833/555/21 (+21 named = 5555). Kettle: Mine treasury, hourly tick, brew first, 1/24 drip into the
// unchanged Stream, try/catch so a refusing Stream never holds the Safe's 40 %, gas floor, pause + timelock rescue.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const P = require("../deploy/params.local.json");

const item = (kind, tier) => 2000 + kind * 8 + tier;
const E6 = 1_000_000n;
const E = (x) => ethers.parseEther(String(x));
const five = (tier) => [item(0, tier), item(1, tier), item(2, tier), item(3, tier), item(4, tier), 0, 0, 0];
const full = (tier) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => item(k, tier));
const founder = (n) => (n >= 100n ? E6 : 2n * E6 - ((n - 1n) * E6) / 99n);
const gasOf = async (tx) => Number((await (await tx).wait()).gasUsed);
const out = {};

async function give(materials, to, ids, times = 1) {
  const uniq = [...new Set(ids.filter(Boolean))];
  await materials.mintCraftedBatch(to, uniq, uniq.map((id) => BigInt(ids.filter((x) => x === id).length * times)));
}
async function nextHour() {
  const now = BigInt(await time.latest());
  await time.increaseTo(((now / 3600n) + 1n) * 3600n + 5n);
}

async function fixture() {
  const [owner, alice, bob, carol, safe, keeper, fees] = await ethers.getSigners();
  const d = await deployAll(ethers, P, safe.address);
  await d.materials.setMinter(owner.address, true);
  await d.keys.setMinter(owner.address, true);
  const GATE = 3n; // 100 on mainnet
  const stream = await ethers.deployContract("Stream", [await d.souls.getAddress(), GATE, owner.address]);
  const kettle = await ethers.deployContract("Kettle", [safe.address, await stream.getAddress(), 6000, 417]);
  await stream.setPourer(await kettle.getAddress());
  await d.mine.setTreasury(await kettle.getAddress());
  await kettle.setGuardian(safe.address);
  await stream.setGuardian(safe.address);
  return { ...d, stream, kettle, owner, alice, bob, carol, safe, keeper, fees, GATE };
}

async function mockFixture() {
  const [owner, alice, bob, carol, safe, keeper, fees] = await ethers.getSigners();
  const col = await ethers.deployContract("MockWeighted");
  const stream = await ethers.deployContract("Stream", [await col.getAddress(), 100, owner.address]);
  const kettle = await ethers.deployContract("Kettle", [safe.address, await stream.getAddress(), 6000, 417]);
  await stream.setPourer(await kettle.getAddress());
  await kettle.setGuardian(safe.address);
  await stream.setGuardian(safe.address);
  return { col, stream, kettle, owner, alice, bob, carol, safe, keeper, fees };
}

describe("Souls: x4 ladder, founders from Adept, quotas 3014/1111/833/555/21", function () {
  it("weighs 1/4/16/64/256 by rank and 512 named, times the founder mark of its rank; Apprentices carry none", async function () {
    const { materials, keys, souls, alice } = await loadFixture(fixture);
    await give(materials, alice.address, five(1), 2);
    await souls.connect(alice).seal(five(1), 255); // Apprentice No.1
    await souls.connect(alice).seal(five(1), 255); // Apprentice No.2
    for (const t of [2, 3, 4, 5]) {
      await give(materials, alice.address, full(t));
      await souls.connect(alice).seal(full(t), 255); // No.1 of Adept..Archmage
    }
    await keys.claimOfKind(alice.address, 4, 7);
    let key = null;
    for (const i of [11, 12, 13]) if ((await keys.keyClaimed(i)) && (await keys.ownerOf(i)) === alice.address) key = i;
    await give(materials, alice.address, [item(0, 1), item(1, 1), item(2, 1), item(3, 1)]);
    await souls.connect(alice).seal([item(0, 1), item(1, 1), item(2, 1), item(3, 1), 0, 0, 0, 0], key); // named No.1
    const want = [[1n, 1n, 1n, E6], [2n, 1n, 2n, E6], [3n, 4n, 1n, 2n * E6], [4n, 16n, 1n, 2n * E6], [5n, 64n, 1n, 2n * E6], [6n, 256n, 1n, 2n * E6], [7n, 512n, 1n, 2n * E6]];
    let tw = 0n;
    for (const [id, rw, ord, mk] of want) {
      expect(await souls.rarity(id)).to.equal(rw * E6);
      expect((await souls.data(id)).ordinal).to.equal(ord);
      expect(await souls.early(id)).to.equal(mk);
      expect(await souls.weight(id)).to.equal((rw * E6 * mk) / E6);
      tw += (rw * E6 * mk) / E6;
    }
    expect(await souls.totalWeight()).to.equal(tw);
  });

  it("quota arithmetic: 3014+1111+833+555+21 ranked + 21 named keys = 5555", async function () {
    const { souls, keys } = await loadFixture(fixture);
    let s = 0n;
    for (let r = 1; r <= 5; r++) s += await souls.quota(r);
    expect(s + BigInt(await keys.KEYS())).to.equal(await souls.CAP());
    expect(await souls.quota(1)).to.equal(3014n);
    expect(await souls.quota(5)).to.equal(21n);
  });

  it("caps Archmages at 21 (No.1 x2.0 .. No.21 x1.798) and 21 named (every named soul outweighs every Archmage)", async function () {
    const { materials, keys, souls, alice } = await loadFixture(fixture);
    await give(materials, alice.address, full(5), 22);
    for (let i = 0; i < 21; i++) await souls.connect(alice).seal(full(5), 255);
    await expect(souls.connect(alice).seal(full(5), 255)).to.be.revertedWith("Souls: quota");
    expect(await souls.weight(1)).to.equal(512n * E6);
    expect(await souls.weight(21)).to.equal(256n * founder(21n));
    // all 21 keys, each sealed into a named soul
    const idx = [];
    for (let i = 0; i < 21; i++) await keys.claimAny(alice.address, 12345 + i * 7);
    for (let k = 0; k < 21; k++) if ((await keys.ownerOf(k)) === alice.address) idx.push(k);
    expect(idx.length).to.equal(21);
    for (const k of idx) {
      const kind = Number(await keys.keyKind(k));
      const ids = [0, 1, 2, 3, 4].map((s) => (s === kind ? 0 : item(s, 1))).concat([0, 0, 0]);
      await give(materials, alice.address, ids);
      await souls.connect(alice).seal(ids, k);
    }
    expect(await souls.mintedByRank(6)).to.equal(21n);
    const lastNamed = await souls.weight(42n);
    expect(lastNamed).to.equal(512n * founder(21n));
    expect(lastNamed).to.be.gt(await souls.weight(1)); // the lightest named soul > the heaviest Archmage (No.1)
    out.named21_over_archmage1 = Number(lastNamed) / Number(await souls.weight(1));
  });

  it("closes rank 1 at 3014 Apprentices (storage-set counter, same code path)", async function () {
    const { materials, souls, alice } = await loadFixture(fixture);
    await give(materials, alice.address, five(1), 2);
    await souls.connect(alice).seal(five(1), 255);
    const addr = await souls.getAddress();
    let slot = null;
    for (let s = 0; s < 40; s++) {
      const v = BigInt(await ethers.provider.getStorage(addr, s));
      if (v === 1n << 32n) { slot = s; break; } // mintedByRank: uint32[7] packed, index 1 = 1
    }
    expect(slot).to.not.equal(null);
    await network.provider.send("hardhat_setStorageAt", [addr, ethers.toQuantity(slot), ethers.zeroPadValue(ethers.toBeHex(3014n << 32n), 32)]);
    expect(await souls.mintedByRank(1)).to.equal(3014n);
    await expect(souls.connect(alice).seal(five(1), 255)).to.be.revertedWith("Souls: quota");
  });
});

describe("Kettle: hourly steam, brew first, 1/24 drip into the unchanged Stream", function () {
  it("splits 60/40 at the tick, holds steam before the gate, then pours 1/24 each hour; claims by weight", async function () {
    const { materials, souls, stream, kettle, mine, alice, bob, safe, keeper, fees } = await loadFixture(fixture);
    expect(await mine.treasury()).to.equal(await kettle.getAddress());
    await fees.sendTransaction({ to: await kettle.getAddress(), value: E(10) });
    await nextHour();
    const s0 = await ethers.provider.getBalance(safe.address);
    out.tick_first_gas = await gasOf(kettle.connect(keeper).tick());
    expect((await ethers.provider.getBalance(safe.address)) - s0).to.equal(E(4));
    expect(await kettle.pot()).to.equal(E(6));
    expect(await stream.epochCount()).to.equal(0n); // gate closed: nothing poured
    await expect(kettle.connect(keeper).tick()).to.be.revertedWith("Kettle: once an hour");
    await give(materials, alice.address, five(1), 2);
    await souls.connect(alice).seal(five(1), 255);
    await souls.connect(alice).seal(five(1), 255);
    await give(materials, bob.address, full(5));
    await souls.connect(bob).seal(full(5), 255);
    await nextHour();
    await fees.sendTransaction({ to: await kettle.getAddress(), value: E(1) });
    out.tick_pour_gas = await gasOf(kettle.connect(keeper).tick());
    const pot1 = E(6) + E("0.6");
    const e0 = (pot1 * 417n) / 10000n;
    expect(await stream.epochCount()).to.equal(1n);
    expect(await kettle.pot()).to.equal(pot1 - e0);
    const w = [await souls.weight(1), await souls.weight(2), await souls.weight(3)];
    const tw = w[0] + w[1] + w[2];
    expect(await stream.claimable(0, 3)).to.equal((e0 * w[2]) / tw);
    const b0 = await ethers.provider.getBalance(bob.address);
    out.claim_one_epoch_gas = await gasOf(stream.connect(keeper).claim(0, 3)); // anyone triggers, owner gets paid
    expect((await ethers.provider.getBalance(bob.address)) - b0).to.equal((e0 * w[2]) / tw);
    await nextHour();
    out.tick_pour_gas2 = await gasOf(kettle.connect(keeper).tick());
    expect(await stream.epochCount()).to.equal(2n);
  });

  it("a paused or closed Stream never holds back the Safe's brew; the steam waits in the pot", async function () {
    const { col, stream, kettle, owner, alice, safe, keeper, fees } = await loadFixture(mockFixture);
    await col.mint(alice.address, 120, E6);
    await fees.sendTransaction({ to: await kettle.getAddress(), value: E(10) });
    await stream.connect(safe).pause();
    await nextHour();
    const s0 = await ethers.provider.getBalance(safe.address);
    await expect(kettle.connect(keeper).tick()).to.emit(kettle, "PourRefused");
    expect((await ethers.provider.getBalance(safe.address)) - s0).to.equal(E(4));
    expect(await kettle.pot()).to.equal(E(6));
    await stream.connect(owner).unpause();
    await nextHour();
    await kettle.connect(keeper).tick();
    expect(await stream.epochCount()).to.equal(1n);
    // a rescued (closed) Stream: brew still flows, the steam waits, the timelock points the Kettle at a new Stream
    await stream.connect(safe).pause();
    await stream.connect(owner).rescue(safe.address);
    await fees.sendTransaction({ to: await kettle.getAddress(), value: E(5) });
    await nextHour();
    const s1 = await ethers.provider.getBalance(safe.address);
    await kettle.connect(keeper).tick();
    expect((await ethers.provider.getBalance(safe.address)) - s1).to.equal(E(2));
    const stream2 = await ethers.deployContract("Stream", [await col.getAddress(), 100, await kettle.getAddress()]);
    await expect(kettle.connect(keeper).set(await stream2.getAddress(), 6000, 417)).to.be.revertedWithCustomError(kettle, "OwnableUnauthorizedAccount");
    await kettle.connect(owner).set(await stream2.getAddress(), 6000, 417);
    await nextHour();
    await kettle.connect(keeper).tick();
    expect(await stream2.epochCount()).to.equal(1n);
  });

  it("a gas-starved tick reverts instead of skipping the hour", async function () {
    const { col, stream, kettle, alice, keeper, fees } = await loadFixture(mockFixture);
    await col.mint(alice.address, 120, E6);
    await fees.sendTransaction({ to: await kettle.getAddress(), value: E(10) });
    await nextHour();
    let skipped = 0;
    for (let g = 60_000; g <= 400_000; g += 5_000) {
      const before = await stream.epochCount();
      const lh = await kettle.lastHour();
      try {
        await kettle.connect(keeper).tick({ gasLimit: g });
      } catch (e) {
        continue;
      }
      const after = await stream.epochCount();
      if (after === before && (await kettle.lastHour()) > lh) skipped++;
      break;
    }
    expect(skipped).to.equal(0);
  });

  it("no pour for a new collection until its gate opens (the main-act switch cannot hand the pot to the first token)", async function () {
    const { col, stream, kettle, owner, alice, keeper, fees } = await loadFixture(mockFixture);
    await col.mint(alice.address, 120, E6);
    const col2 = await ethers.deployContract("MockWeighted");
    await col2.mint(alice.address, 1, E6);
    await stream.connect(owner).addCollection(await col2.getAddress());
    await stream.connect(owner).setCurrent(1, 100);
    await fees.sendTransaction({ to: await kettle.getAddress(), value: E(10) });
    await nextHour();
    await kettle.connect(keeper).tick();
    expect(await stream.epochCount()).to.equal(0n);
    expect(await kettle.pot()).to.equal(E(6));
  });

  it("keeper has no power; pause + owner rescue returns everything to the Safe; fund() is steam only; bounds", async function () {
    const { col, kettle, owner, alice, safe, keeper, fees } = await loadFixture(mockFixture);
    await expect(kettle.connect(owner).set(await kettle.stream(), 10001, 417)).to.be.revertedWith("Kettle: steam");
    await expect(kettle.connect(owner).set(await kettle.stream(), 6000, 99)).to.be.revertedWith("Kettle: drip");
    await kettle.connect(keeper).fund({ value: E(1) });
    expect(await kettle.pot()).to.equal(E(1));
    await fees.sendTransaction({ to: await kettle.getAddress(), value: E(3) });
    await expect(kettle.connect(keeper).rescue()).to.be.revertedWithCustomError(kettle, "OwnableUnauthorizedAccount");
    await expect(kettle.connect(owner).rescue()).to.be.revertedWith("Kettle: pause first");
    await kettle.connect(safe).pause();
    await expect(kettle.connect(keeper).tick()).to.be.revertedWith("Guarded: paused");
    const s0 = await ethers.provider.getBalance(safe.address);
    await kettle.connect(owner).rescue();
    expect((await ethers.provider.getBalance(safe.address)) - s0).to.equal(E(4));
    await expect(fees.sendTransaction({ to: await kettle.getAddress(), value: 1n })).to.be.revertedWith("Kettle: closed");
  });

  it("empties the pot in 0.01 ETH steps and conserves ETH over 300 random hours (fees, funds, ticks, claims)", async function () {
    this.timeout(0);
    const { col, stream, kettle, alice, bob, safe, keeper, fees } = await loadFixture(mockFixture);
    await col.mint(alice.address, 60, E6);
    await col.mint(bob.address, 60, 4n * E6);
    let feeSum = 0n, fundSum = 0n, brewSum = 0n;
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const s0 = await ethers.provider.getBalance(safe.address);
    for (let h = 0; h < 300; h++) {
      if (h < 200 && rnd() < 0.8) { const v = BigInt(Math.floor(rnd() * 3e18)); await fees.sendTransaction({ to: await kettle.getAddress(), value: v }); feeSum += v; }
      if (rnd() < 0.05) { const v = BigInt(Math.floor(rnd() * 1e18)); await kettle.connect(keeper).fund({ value: v }); fundSum += v; }
      if (h === 120) await col.mint(alice.address, 5, 16n * E6);
      await nextHour();
      await kettle.connect(keeper).tick();
      if (rnd() < 0.1) await stream.connect(keeper).claim(0, 1 + Math.floor(rnd() * 125));
      expect(await ethers.provider.getBalance(await kettle.getAddress())).to.equal((await kettle.pot()) + (await kettle.brewOwed()));
    }
    brewSum = (await ethers.provider.getBalance(safe.address)) - s0;
    const n = await stream.epochCount();
    let poured = 0n;
    for (let i = 0n; i < n; i++) poured += (await stream.epochs(i)).amount;
    const steamIn = feeSum - brewSum + fundSum;
    expect(poured + (await kettle.pot())).to.equal(steamIn);
    const diff = brewSum * 10000n - feeSum * 4000n; // 40 % to the Safe, up to rounding (< 1 wei per tick)
    expect(diff < 0n ? -diff : diff).to.be.lte(10000n * 300n);
    const exact = (brewSum * 10000n) / feeSum;
    out.brew_bps_realized = Number(exact);
    // pay everyone and check the Stream never owes more than it holds
    let claimable = 0n;
    for (let id = 1; id <= 125; id++) claimable += await stream.claimable(0, id);
    expect(claimable).to.be.lte(await ethers.provider.getBalance(await stream.getAddress()));
    out.fuzz = { hours: 300, epochs: Number(n), pot_left_eth: Number(ethers.formatEther(await kettle.pot())), dust_wei: (await ethers.provider.getBalance(await stream.getAddress())) - claimable };
  });
});
