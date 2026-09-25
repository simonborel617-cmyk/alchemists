// Review 2 PoC: since b197b51 a mythic key is minted with ERC-721 _safeMint. A contract miner that accepts ERC-1155
// ingredients (all it needed before) but has no onERC721Received makes the key mint revert; the find stays at the
// head of its queue for ever, every later reveal(miner) reverts, and so does every later submit from that contract
// (submit settles the queue at its end). Uses the existing test helper ReentrantMiner (ERC-1155 receiver only).
// Expected-behaviour assertions: this test FAILS while the bug exists.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll, mineConfig } = require("../scripts/lib/deploy-all");
const { findNonce } = require("../scripts/lib/work");
const P = require("../deploy/params.local.json");

async function nextMinute() {
  const ts = await time.latest();
  await time.increaseTo((Math.floor(ts / 60) + 1) * 60 + 1);
  await ethers.provider.send("hardhat_mine", ["0x4"]); // a minute spans ~5 parent-chain blocks on mainnet; reveal seeds need 4
}

async function fixture() {
  const [owner, alice, treasury] = await ethers.getSigners();
  const d = await deployAll(ethers, P, treasury.address);
  await d.mine.connect(owner).setConfig({ ...mineConfig(P), keyChance: 1 }); // every find rolls a key, to make the case deterministic
  const miner = await ethers.deployContract("ReentrantMiner", [await d.mine.getAddress()]);
  return { ...d, owner, alice, treasury, miner };
}

async function submitOnce(mine, miner, alice) {
  const addr = await miner.getAddress();
  await nextMinute();
  await mine.tick();
  const m = await mine.currentMinute();
  const { nonce } = findNonce(addr, await mine.challenge(m), Number(await mine.minuteThreshold(m)));
  await nextMinute();
  return miner.connect(alice).attackSubmit(m, nonce, { value: (await mine.currentPrice()) * 2n });
}

describe("Review 2: Keys _safeMint and contract miners", function () {
  it("a contract miner without an ERC-721 hook still gets its lucky find settled and can keep mining", async function () {
    const { mine, keys, miner, alice } = await loadFixture(fixture);
    const addr = await miner.getAddress();
    await submitOnce(mine, miner, alice); // the find is pending; its reveal minute is the next one
    expect(await mine.pendingCount(addr)).to.equal(1n);
    await nextMinute();
    await mine.tick();
    let revealErr = null;
    try { await mine.reveal(addr); } catch (e) { revealErr = e; }
    console.log(`      reveal(miner): ${revealErr ? (revealErr.shortMessage || revealErr.message).slice(0, 120) : "ok"}`);
    console.log(`      pending finds: ${await mine.pendingCount(addr)}, keys left unclaimed: ${await keys.unclaimedCount()}`);
    let submitErr = null;
    try { await submitOnce(mine, miner, alice); } catch (e) { submitErr = e; }
    console.log(`      next submit from the same contract: ${submitErr ? (submitErr.shortMessage || submitErr.message).slice(0, 120) : "ok"}`);
    // expected: the find settles (key or ingredient) and the miner can submit again
    expect(revealErr, "reveal(miner) reverts on the key mint").to.equal(null);
    expect(submitErr, "the contract miner can no longer submit").to.equal(null);
  });
});
