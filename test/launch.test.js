// Mainnet profile v4, end to end on the local network (owner's decisions 2026-09-26): deploy/params.mainnet.json with
// a stand-in Safe passes the preflight, deploys, and lands in exactly the state the runbook checks after the real
// deploy: no timelock, the Safe owns the game and administers the collections, the collections' face owns them on
// marketplaces and can do nothing else, no Alchemists contract yet, v3 finds carried over. Also: a deploy that stops
// part-way resumes without deploying anything twice.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployAll, mineConfig } = require("../scripts/lib/deploy-all");
const { preflight } = require("../scripts/preflight");
const PM = require("../deploy/params.mainnet.json");

const FACE = "0x5Ce8fb583fD3583E4cd7BF89f881e011B6ECfcD2";
const ing = (t, tier) => 1 + t * 8 + tier;

describe("Launch: the mainnet profile", function () {
  it("passes the preflight only as v4: a Safe, no timelock, the fixed collections owner, no Alchemists", async function () {
    const [, safe] = await ethers.getSigners();
    const P = JSON.parse(JSON.stringify(PM));
    expect(preflight(P, { TREASURY: P.governance.safe })).to.deep.equal([]);
    P.governance.safe = ethers.ZeroAddress;
    expect(preflight(P, { TREASURY: safe.address })).to.include("governance.safe must be the Safe multisig address");
    P.governance.safe = safe.address;
    expect(preflight(P, { TREASURY: safe.address })).to.deep.equal([]);
    const bad = (patch) => preflight({ ...P, ...patch }, { TREASURY: safe.address }).join(" ");
    expect(bad({ governance: { ...P.governance, mode: "timelock", timelockDelay: 172800 } })).to.match(/governance.mode/);
    expect(bad({ governance: { ...P.governance, collectionsOwner: safe.address } })).to.match(/collectionsOwner/);
    expect(bad({ governance: { ...P.governance, collectionsOwner: "deployer" } })).to.match(/collectionsOwner/);
    expect(bad({ withAlchemists: true })).to.match(/withAlchemists/);
    expect(bad({ pausedAtLaunch: ["souls"] })).to.match(/pausedAtLaunch/);
  });

  it("deploys into the state the runbook verifies: the Safe governs at once, the face owns the collections and only that", async function () {
    const [deployer, safe, alice, bob] = await ethers.getSigners();
    const P = JSON.parse(JSON.stringify(PM));
    P.governance.safe = safe.address;
    const migration = [
      { to: alice.address, id: ing(3, 1), amount: 2 },
      { to: bob.address, id: ing(39, 1), amount: 1 },
      { to: alice.address, id: ing(12, 2), amount: 1 },
    ];
    const b0 = await ethers.provider.getBlockNumber();
    const d = await deployAll(ethers, P, safe.address, () => {}, undefined, { migration });
    const b1 = await ethers.provider.getBlockNumber();
    const { materials, keys, mine, furnaces, workshop, alchemists, souls, stream, kettle, timelock } = d;
    const k = await kettle.getAddress();
    expect(alchemists).to.equal(null);
    expect(timelock).to.equal(null);

    // governance: the Safe owns the game contracts, administers the collections and holds the brake everywhere
    for (const c of [mine, workshop, stream, kettle]) expect(await c.owner()).to.equal(safe.address);
    for (const c of [materials, keys, furnaces, souls]) {
      expect(await c.owner()).to.equal(FACE); // the face (in the real deploy it deploys them itself)
      expect(await c.admin()).to.equal(safe.address);
    }
    for (const c of [mine, workshop, souls, stream, kettle]) expect(await c.guardian()).to.equal(safe.address);
    // the deployer keeps nothing
    await expect(mine.connect(deployer).setConfig(mineConfig(P))).to.be.revertedWithCustomError(mine, "OwnableUnauthorizedAccount");
    await expect(materials.connect(deployer).setMinter(deployer.address, true)).to.be.revertedWithCustomError(materials, "NotAdmin");
    await expect(souls.connect(deployer).pause()).to.be.revertedWith("Guarded: not guardian");
    // the Safe acts with no delay: pause and unpause at once
    await mine.connect(safe).pause();
    await mine.connect(safe).unpause();
    await souls.connect(safe).pause();
    await souls.connect(safe).unpause();

    // the fees: the Mine pays the Kettle, the Kettle alone pours into the stream and sends the brew to the Safe
    expect(await mine.treasury()).to.equal(k);
    expect(await stream.pourer()).to.equal(k);
    expect(await kettle.safe()).to.equal(safe.address);
    expect(await kettle.stream()).to.equal(await stream.getAddress());
    expect(await kettle.steamBps()).to.equal(6000n);
    expect(await kettle.dripBps()).to.equal(417n);
    expect(await stream.closed()).to.equal(false);
    expect(await kettle.closed()).to.equal(false);
    // the four collections: contractURI on the site and 5 % creator earnings to the Safe
    for (const [file, c] of [["materials", materials], ["keys", keys], ["furnaces", furnaces], ["souls", souls]]) {
      expect(await c.contractURI()).to.equal(`https://alchemist-mine.com/metadata/collections/${file}.json`);
      const [to, amt] = await c.royaltyInfo(1, 10000n);
      expect(to).to.equal(safe.address);
      expect(amt).to.equal(500n);
    }

    // minters: the three game contracts and nobody else we know of (the deployer gave its migration right up)
    for (const c of [mine, workshop, souls]) {
      expect(await materials.minters(await c.getAddress())).to.equal(true);
      expect(await keys.minters(await c.getAddress())).to.equal(true);
    }
    for (const who of [deployer.address, safe.address, FACE, await stream.getAddress(), k]) {
      expect(await materials.minters(who)).to.equal(false);
      expect(await keys.minters(who)).to.equal(false);
    }
    // the carried-over finds
    expect(await materials.balanceOf(alice.address, ing(3, 1))).to.equal(2n);
    expect(await materials.balanceOf(bob.address, ing(39, 1))).to.equal(1n);
    expect(await materials.balanceOf(alice.address, ing(12, 2))).to.equal(1n);
    expect(await materials.minedTotal()).to.equal(4n);
    expect(await materials.circulating(ing(3, 1))).to.equal(2n);

    // nothing starts paused, and souls have no summoner
    for (const c of [mine, workshop, souls, stream, kettle]) expect(await c.paused()).to.equal(false);
    expect(await souls.summoner()).to.equal(ethers.ZeroAddress);

    // constants as deployed
    const want = mineConfig(P), got = await mine.config();
    expect(got.floorBitsQ8).to.equal(BigInt(want.floorBitsQ8));
    expect(got.ceilBitsQ8).to.equal(BigInt(want.ceilBitsQ8));
    expect(got.oreR0).to.equal(BigInt(want.oreR0));
    expect(got.price0).to.equal(ethers.parseEther("0.00002"));
    expect(got.keyChance).to.equal(65536n);
    expect(await mine.currentPrice()).to.equal(ethers.parseEther("0.00002"));
    expect(await mine.sessionSec()).to.equal(60n);
    expect(await workshop.furnaceCooldown()).to.equal(600n);
    expect(await keys.unclaimedCount()).to.equal(21n);

    // gas of the whole deploy, for the deployer's budget
    let gas = 0n;
    for (let b = b0 + 1; b <= b1; b++) gas += (await ethers.provider.getBlock(b)).gasUsed;
    console.log(`      deploy: ${b1 - b0} transactions, ${gas.toLocaleString("en")} gas`);
    expect(gas).to.be.lessThan(40_000_000n);
  });

  it("resumes a deploy that stopped part-way without deploying any contract twice", async function () {
    const [deployer, safe, alice] = await ethers.getSigners();
    const P = JSON.parse(JSON.stringify(PM));
    P.governance.safe = safe.address;
    const migration = [{ to: alice.address, id: ing(5, 1), amount: 3 }];
    const start = (await ethers.provider.getBlockNumber()) + 1;
    const creates = async () => {
      let n = 0;
      for (let b = start; b <= (await ethers.provider.getBlockNumber()); b++) {
        const blk = await ethers.provider.getBlock(b, true);
        for (const h of blk.transactions) {
          const tx = await ethers.provider.getTransaction(h);
          if (tx.from === deployer.address && tx.to === null) n++;
        }
      }
      return n;
    };

    // run 1 dies right after the fourth contract is deployed
    const rec = {};
    let n = 0;
    await expect(
      deployAll(ethers, P, safe.address, () => {}, undefined, {
        migration,
        confirmMs: 0,
        onDeployed: (name, address, pending) => {
          rec[name] = address;
          if (!pending && ++n === 4) throw new Error("killed");
        },
      })
    ).to.be.rejectedWith("killed");
    expect(Object.keys(rec)).to.have.length(4);

    // run 2 attaches the four and finishes; run 3 (a repeat of a finished deploy) changes nothing
    const d = await deployAll(ethers, P, safe.address, () => {}, undefined, { migration, existing: { ...rec } });
    for (const [name, address] of Object.entries(rec)) expect(await d[name.charAt(0).toLowerCase() + name.slice(1)].getAddress()).to.equal(address);
    const all = {
      Materials: await d.materials.getAddress(), Keys: await d.keys.getAddress(), Mine: await d.mine.getAddress(),
      Furnaces: await d.furnaces.getAddress(), Workshop: await d.workshop.getAddress(), Souls: await d.souls.getAddress(),
      Stream: await d.stream.getAddress(), Kettle: await d.kettle.getAddress(),
    };
    const txs = await ethers.provider.getTransactionCount(deployer.address);
    await deployAll(ethers, P, safe.address, () => {}, undefined, { migration, existing: all });
    expect(await ethers.provider.getTransactionCount(deployer.address)).to.equal(txs);
    expect(await creates()).to.equal(8); // eight contracts, each deployed once
    expect(await d.materials.balanceOf(alice.address, ing(5, 1))).to.equal(3n);
    expect(await d.materials.minters(deployer.address)).to.equal(false);
    expect(await d.mine.owner()).to.equal(safe.address);
    expect(await d.souls.admin()).to.equal(safe.address);
  });

  it("resumes a migration from the deployer's own mints in the log, not from balances holders may have moved", async function () {
    const [deployer, safe, alice, bob] = await ethers.getSigners();
    const P = JSON.parse(JSON.stringify(PM));
    P.governance.safe = safe.address;
    const bare = { ...P, governance: undefined };
    const d = await deployAll(ethers, bare, safe.address);
    // run 1 died in the middle of the migration: 2 of alice's 3 minted, and she has already passed one on to bob
    await d.materials.setMinter(deployer.address, true);
    await d.materials.mintMined(alice.address, ing(7, 1), 2);
    await d.materials.connect(alice).safeTransferFrom(alice.address, bob.address, ing(7, 1), 1, "0x");
    const all = {
      Materials: await d.materials.getAddress(), Keys: await d.keys.getAddress(), Mine: await d.mine.getAddress(),
      Furnaces: await d.furnaces.getAddress(), Workshop: await d.workshop.getAddress(), Souls: await d.souls.getAddress(),
      Stream: await d.stream.getAddress(), Kettle: await d.kettle.getAddress(),
    };
    const migration = [{ to: alice.address, id: ing(7, 1), amount: 3 }, { to: bob.address, id: ing(9, 2), amount: 1 }];
    const e = await deployAll(ethers, P, safe.address, () => {}, undefined, { existing: all, migration });
    expect(await e.materials.balanceOf(alice.address, ing(7, 1))).to.equal(2n); // 1 kept + the 1 still owed
    expect(await e.materials.balanceOf(bob.address, ing(7, 1))).to.equal(1n);
    expect(await e.materials.balanceOf(bob.address, ing(9, 2))).to.equal(1n);
    expect(await e.materials.circulating(ing(7, 1))).to.equal(3n); // three units, never four
    expect(await e.materials.minters(deployer.address)).to.equal(false);
  });

  it("fails loudly when the deploy key changed something the hand-over would skip", async function () {
    const [deployer, safe, mallory] = await ethers.getSigners();
    const P = JSON.parse(JSON.stringify(PM));
    P.governance.safe = safe.address;
    const d = await deployAll(ethers, { ...P, governance: undefined }, safe.address);
    // the hand-over had begun (guardians, the Mine) when someone else with the key took the Souls admin role: a resume
    // skips the wiring and every role that has left the deployer, so only the final check can see it
    for (const c of [d.mine, d.workshop, d.souls, d.stream, d.kettle]) await c.setGuardian(safe.address);
    await d.mine.transferOwnership(safe.address);
    await d.souls.connect(deployer).setAdmin(mallory.address);
    const all = {
      Materials: await d.materials.getAddress(), Keys: await d.keys.getAddress(), Mine: await d.mine.getAddress(),
      Furnaces: await d.furnaces.getAddress(), Workshop: await d.workshop.getAddress(), Souls: await d.souls.getAddress(),
      Stream: await d.stream.getAddress(), Kettle: await d.kettle.getAddress(),
    };
    await expect(deployAll(ethers, P, safe.address, () => {}, undefined, { existing: all })).to.be.rejectedWith(/not what the hand-over leaves/);
  });

  it("finishes a hand-over that stopped half-way", async function () {
    const [, safe] = await ethers.getSigners();
    const P = JSON.parse(JSON.stringify(PM));
    P.governance.safe = safe.address;
    const bare = { ...P, governance: undefined };
    const d = await deployAll(ethers, bare, safe.address);
    // the hand-over began (guardians first, then the Mine), then the run died
    for (const c of [d.mine, d.workshop, d.souls, d.stream, d.kettle]) await c.setGuardian(safe.address);
    await d.mine.transferOwnership(safe.address);
    const all = {
      Materials: await d.materials.getAddress(), Keys: await d.keys.getAddress(), Mine: await d.mine.getAddress(),
      Furnaces: await d.furnaces.getAddress(), Workshop: await d.workshop.getAddress(), Souls: await d.souls.getAddress(),
      Stream: await d.stream.getAddress(), Kettle: await d.kettle.getAddress(),
    };
    const e = await deployAll(ethers, P, safe.address, () => {}, undefined, { existing: all });
    for (const c of [e.mine, e.workshop, e.stream, e.kettle]) expect(await c.owner()).to.equal(safe.address);
    for (const c of [e.materials, e.keys, e.furnaces, e.souls]) {
      expect(await c.admin()).to.equal(safe.address);
      expect(await c.owner()).to.equal(FACE);
    }
    for (const c of [e.mine, e.workshop, e.souls, e.stream, e.kettle]) expect(await c.guardian()).to.equal(safe.address);
  });
});
