// The emergency exit, end to end with the governed deployment: the Safe pauses at once, queues the rescue in the
// timelock, and after the delay every wei the game contracts hold is back in the Safe. Built with the same
// scripts/emergency.js batches the owners import into the Safe's Transaction Builder.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll } = require("../scripts/lib/deploy-all");
const { build, txBuilderBatch } = require("../scripts/emergency");
const P0 = require("../deploy/params.local.json");

const item = (kind, tier) => 2000 + kind * 8 + tier;
const five = (tier) => [item(0, tier), item(1, tier), item(2, tier), item(3, tier), item(4, tier), 0, 0, 0];
const DELAY = 48 * 3600;

async function fixture() {
  const [owner, safe, alice, bob] = await ethers.getSigners();
  const P = JSON.parse(JSON.stringify(P0));
  P.governance = { safe: safe.address, guardian: "safe", timelockDelay: DELAY };
  P.pausedAtLaunch = ["alchemists"];
  const d = await deployAll(ethers, P, safe.address);
  // a minter for the test's items: the timelock grants it (impersonated here instead of waiting 48 hours)
  const tl = await d.timelock.getAddress();
  await network.provider.send("hardhat_impersonateAccount", [tl]);
  await network.provider.send("hardhat_setBalance", [tl, "0xDE0B6B3A7640000"]);
  const asTl = await ethers.getSigner(tl);
  await d.materials.connect(asTl).setMinter(owner.address, true);
  const ids = five(1).filter(Boolean);
  for (const w of [alice, bob]) { await d.materials.mintCraftedBatch(w.address, ids, ids.map(() => 1n)); await d.souls.connect(w).seal(five(1), 255); }
  const A = {};
  for (const n of ["Mine", "Workshop", "Souls", "Stream", "Alchemists"]) A[n] = await d[n.toLowerCase()].getAddress();
  A.Timelock = tl;
  return { ...d, A, owner, safe, alice, bob, asTl };
}
async function send(signer, txs) {
  for (const t of txs) await (await signer.sendTransaction({ to: t.to, value: t.value || 0, data: t.data })).wait();
}
const bal = (a) => ethers.provider.getBalance(a);

describe("Emergency exit", function () {
  it("pause at once, rescue after the delay: every wei the game contracts hold goes back to the Safe", async function () {
    const { A, safe, alice, mine, workshop, souls, stream, alchemists, timelock } = await loadFixture(fixture);
    await safe.sendTransaction({ to: A.Stream, value: ethers.parseEther("1") }); // the Safe poured into the stream
    await network.provider.send("hardhat_setBalance", [A.Mine, "0x" + ethers.parseEther("0.3").toString(16)]); // stray ETH in the mine
    expect(await bal(A.Stream)).to.equal(ethers.parseEther("1"));

    // 1. the brake: the Safe calls pause() everywhere, no delay
    await send(safe, build.pause(A));
    for (const c of [mine, workshop, souls, stream, alchemists]) expect(await c.paused()).to.equal(true);
    await expect(stream.connect(alice).claim(0, 1)).to.be.revertedWith("Guarded: paused");

    // 2. the rescue is queued in the timelock and cannot run early
    const salt = ethers.id("rescue-test");
    const r = build.rescue(A, safe.address, DELAY, salt);
    await send(safe, r.schedule);
    expect(await timelock.isOperationPending(r.op)).to.equal(true);
    await expect(send(safe, r.execute)).to.be.revertedWithCustomError(timelock, "TimelockUnexpectedOperationState");

    // 3. after the delay it runs: the stream and the mine are empty, the Safe has it all
    await time.increase(DELAY + 1);
    const before = await bal(safe.address);
    const tx = await safe.sendTransaction({ to: r.execute[0].to, data: r.execute[0].data });
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    expect(await bal(A.Stream)).to.equal(0n);
    expect(await bal(A.Mine)).to.equal(0n);
    expect((await bal(safe.address)) - before + gas).to.equal(ethers.parseEther("1.3"));
    expect(await stream.closed()).to.equal(true);
    expect(await stream.claimable(0, 1)).to.equal(0n);
  });

  it("a rescued stream stays closed even if someone unpauses it; the rest of the game unpauses through the timelock", async function () {
    const { A, safe, alice, mine, workshop, souls, stream, alchemists, asTl } = await loadFixture(fixture);
    await safe.sendTransaction({ to: A.Stream, value: ethers.parseEther("1") });
    await send(safe, build.pause(A));
    const r = build.rescue(A, safe.address, DELAY, ethers.id("rescue-2"));
    await send(safe, r.schedule);
    await time.increase(DELAY + 1);
    await send(safe, r.execute);

    const u = build.unpause(A, DELAY, ethers.id("unpause-1"), { streamClosed: true });
    await send(safe, u.schedule);
    await time.increase(DELAY + 1);
    await send(safe, u.execute);
    for (const c of [mine, workshop, souls]) expect(await c.paused()).to.equal(false);
    expect(await stream.paused()).to.equal(true);
    expect(await alchemists.paused()).to.equal(true); // the summoning stays paused

    await stream.connect(asTl).unpause(); // even an unpaused closed stream refuses everything
    await expect(stream.connect(alice).claim(0, 1)).to.be.revertedWith("Stream: closed");
    await expect(safe.sendTransaction({ to: A.Stream, value: 1n })).to.be.revertedWith("Stream: closed");
    await expect(stream.connect(asTl).rescue(safe.address)).to.be.revertedWith("Stream: closed");
  });

  it("the rescue needs the pause first, only the timelock can run it, and the Safe cannot skip the delay", async function () {
    const { A, safe, alice, stream, asTl } = await loadFixture(fixture);
    await safe.sendTransaction({ to: A.Stream, value: ethers.parseEther("1") });
    await expect(stream.connect(asTl).rescue(safe.address)).to.be.revertedWith("Stream: pause first");
    await stream.connect(safe).pause();
    await expect(stream.connect(safe).rescue(safe.address)).to.be.revertedWithCustomError(stream, "OwnableUnauthorizedAccount");
    await expect(stream.connect(alice).rescue(alice.address)).to.be.revertedWithCustomError(stream, "OwnableUnauthorizedAccount");
    expect(await bal(A.Stream)).to.equal(ethers.parseEther("1"));
  });

  it("writes batches the Safe Transaction Builder can import", async function () {
    const { A, safe } = await loadFixture(fixture);
    const b = txBuilderBatch(4663, safe.address, "Alchemists: pause everything", "test", build.pause(A));
    expect(b.version).to.equal("1.0");
    expect(b.chainId).to.equal("4663");
    expect(b.meta.createdFromSafeAddress).to.equal(safe.address);
    expect(b.meta.checksum).to.match(/^0x[0-9a-f]{64}$/);
    expect(b.transactions).to.have.length(5);
    for (const t of b.transactions) expect(t).to.include.keys("to", "value", "data", "contractMethod", "contractInputsValues");
  });
});
