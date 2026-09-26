// Deploys and wires the whole game. Used by scripts/deploy.js and by the tests.
const Q8 = (bits) => Math.round(bits * 256);

function mineConfig(P) {
  const m = P.mine;
  return {
    floorBitsQ8: Q8(m.floorBits),
    ceilBitsQ8: Q8(m.ceilBits),
    kPerHour: m.kPerHour,
    oreR0: m.oreR0,
    refHashrate: BigInt(m.refHashrate),
    mCapQ8: Q8(m.mCap),
    price0: BigInt(m.price0Wei),
    priceD: m.priceD,
    unlockFinds: m.unlockFinds.map((x) => BigInt(x)),
    extraK: m.extraK,
    keyChance: m.keyChance,
    upgradeChance: m.upgradeChance,
    firstHourSec: m.firstHourSec,
    windowSec: m.windowSec,
    windowSecEarly: m.windowSecEarly,
    maxStepQ8: Q8(m.maxStepBits),
    maxStepEarlyQ8: Q8(m.maxStepEarlyBits),
    estCapBits: m.estCapBits ?? 6,
    estDivX10: m.estDivX10 ?? 34,
  };
}

async function deployAll(ethers, P, treasury, log = () => {}, signer, opts = {}) {
  // signer: optional (scripts/deploy.js passes one); the contracts come back connected to it, so every transaction
  // below goes through it.
  // opts.existing: {Name: address} of contracts an interrupted run already deployed; they are attached instead of
  // deployed again (a collection must never be deployed twice from the same wallet), and every step after the deploys
  // is safe to repeat. opts.onDeployed(name, address) is called right after each deploy, so the caller can record it.
  // opts.expectNonce: {Name: nonce} for deploys an interrupted run recorded but never sent; they must go out with that
  // same nonce, so they can only land at the recorded address.
  // opts.migration: [{to, id, amount}] Materials balances carried over from an earlier deployment (minted before the
  // admin role leaves the deployer; a repeat mints only what the deployer's own earlier mints, read from the log since
  // opts.fromBlock, have not covered yet).
  const me = signer ? await signer.getAddress() : (await ethers.getSigners())[0].address;
  const provider = (signer && signer.provider) || ethers.provider;
  const existing = opts.existing || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deploy = async (name, args) => {
    if (existing[name]) {
      log(name, `${existing[name]} (already deployed, attached)`);
      return ethers.getContractAt(name, existing[name], signer);
    }
    // the address is recorded before the deploy is sent (it follows from the deployer and its nonce), so a run killed
    // while the deploy is in flight still leaves a record, and the resume finds the contract instead of making another
    let planned = null;
    if (opts.onDeployed) {
      const nonce = await (signer || (await ethers.getSigners())[0]).getNonce("pending");
      if (opts.expectNonce && opts.expectNonce[name] != null && opts.expectNonce[name] !== nonce)
        throw new Error(`${name} was recorded at nonce ${opts.expectNonce[name]} but would go out with nonce ${nonce}; stopped before deploying`);
      // The address is only as good as the nonce. Every earlier transaction of this run was awaited, so the chain's own
      // count must equal it, twice in a row: a lagging node reports less (wait), more means the nonce is spent (stop
      // before deploying; RESUME=1 re-reads the chain).
      for (let i = 0, same = 0; same < 2; i++) {
        const onChain = await provider.getTransactionCount(me, "latest");
        if (onChain > nonce) throw new Error(`${name}: the chain counts ${onChain} transactions from ${me}, this run would use nonce ${nonce}; stopped before deploying`);
        same = onChain === nonce ? same + 1 : 0;
        if (i >= 40) throw new Error(`${name}: the node keeps reporting ${onChain} transactions from ${me}, expected ${nonce}; stopped before deploying`);
        if (same < 2) await sleep(opts.confirmMs ?? 1500);
      }
      planned = ethers.getCreateAddress({ from: me, nonce });
      await opts.onDeployed(name, planned, true, nonce);
    }
    const c = await ethers.deployContract(name, args, signer);
    await c.waitForDeployment();
    const at = await c.getAddress();
    if (planned && at.toLowerCase() !== planned.toLowerCase()) throw new Error(`${name} landed at ${at}, not at the recorded ${planned}`);
    if (opts.onDeployed) await opts.onDeployed(name, at, false);
    // (a contract's address follows from the deployer's nonce, so a deploy sent again with the same nonce can only land
    // at the recorded address, never make a second copy)
    return c;
  };
  const withAlchemists = P.withAlchemists !== false; // the main act's contract; mainnet leaves it out until it is final
  const materials = await deploy("Materials", [P.materialsURI]);
  await materials.waitForDeployment();
  log("Materials", await materials.getAddress());

  const keys = await deploy("Keys", [P.keyKinds]);
  await keys.waitForDeployment();
  log("Keys", await keys.getAddress());

  const mine = await deploy("Mine", [await materials.getAddress(), await keys.getAddress(), treasury, mineConfig(P), P.mine.sessionSec || 60]);
  await mine.waitForDeployment();
  log("Mine", await mine.getAddress());

  const furnaces = await deploy("Furnaces", []);
  await furnaces.waitForDeployment();
  log("Furnaces", await furnaces.getAddress());

  const workshop = await deploy("Workshop", [
    await mine.getAddress(),
    await materials.getAddress(),
    await keys.getAddress(),
    await furnaces.getAddress(),
    P.itemRecipe,
    P.furnaceRecipe,
  ]);
  await workshop.waitForDeployment();
  log("Workshop", await workshop.getAddress());

  let alchemists = null;
  if (withAlchemists) {
    alchemists = await deploy("Alchemists", [
      await mine.getAddress(),
      await materials.getAddress(),
      await keys.getAddress(),
      P.alchemistsBaseURI,
      BigInt(P.summonFeeWei),
      treasury,
    ]);
    await alchemists.waitForDeployment();
    log("Alchemists", await alchemists.getAddress());
  }

  const souls = await deploy("Souls", [await mine.getAddress(), await materials.getAddress(), await keys.getAddress(), P.soulsURI || ""]);
  await souls.waitForDeployment();
  log("Souls", await souls.getAddress());

  const stream = await deploy("Stream", [await souls.getAddress(), P.streamOpenAt ?? 100, treasury]); // the treasury Safe pours
  await stream.waitForDeployment();
  log("Stream", `${await stream.getAddress()} (claims open at ${P.streamOpenAt ?? 100} souls)`);

  // the Kettle (decided 2026-09-25): the Mine's fees go to it; every hour it sends the brew to the Safe and drips the
  // steam into the Stream, which it alone pours into. Without P.kettle the fees go to the treasury and the Safe pours.
  let kettle = null;
  if (P.kettle) {
    kettle = await deploy("Kettle", [treasury, await stream.getAddress(), P.kettle.steamBps, P.kettle.dripBps]);
    await kettle.waitForDeployment();
  }

  // Everything from here to the governance hand-over is wiring the deployer does as owner and admin. Each step is safe
  // to repeat, so a resumed run simply repeats it; once the hand-over has begun (the Mine, the first contract handed
  // over, has left the deployer) the wiring was complete and is skipped.
  const setupDone = !!P.governance && (await mine.owner()).toLowerCase() !== me.toLowerCase();
  if (setupDone) log("wiring", "already complete (the governance hand-over had begun), skipped");
  else await wire();

  async function wire() {
  if (kettle) {
    await (await stream.setPourer(await kettle.getAddress())).wait();
    await (await mine.setTreasury(await kettle.getAddress())).wait();
    log("Kettle", `${await kettle.getAddress()} (Mine treasury, Stream pourer; steam ${P.kettle.steamBps / 100} %, drip ${P.kettle.dripBps / 100} % an hour, brew to ${treasury})`);
  }

  for (const c of [mine, workshop, alchemists, souls].filter(Boolean)) {
    await (await materials.setMinter(await c.getAddress(), true)).wait();
    await (await keys.setMinter(await c.getAddress(), true)).wait();
  }
  if (P.keysURI) await (await keys.setBaseURI(P.keysURI)).wait(); // per-key metadata: <base><id>.json
  await (await furnaces.setWorkshop(await workshop.getAddress())).wait();
  if (P.furnacesURI) await (await furnaces.setBaseURI(P.furnacesURI)).wait(); // per-tier metadata: <base><tier>.json
  log("wired", "minters + workshop set");

  // the collections as marketplaces show them: contractURI (ERC-7572) and 5 % creator earnings to the treasury (ERC-2981)
  if (P.collectionsURI) {
    const cols = { materials, keys, furnaces, souls, alchemists };
    for (const [name, c] of Object.entries(cols).filter(([, c]) => c)) {
      await (await c.setContractURI(`${P.collectionsURI}${name}.json`)).wait();
      if (P.royaltyBps) await (await c.setDefaultRoyalty(treasury, P.royaltyBps)).wait();
    }
    log("collections", `contractURI ${P.collectionsURI}<name>.json; royalty ${(P.royaltyBps || 0) / 100} % to ${treasury}`);
  }

  if (P.workshop) {
    const w = P.workshop;
    await (await workshop.setRefine(w.furnaceCooldown, w.refineSuccess, w.furnaceBonus, w.refineBaseInputs, w.refineInputDrop)).wait();
    await (await workshop.setReroll(w.rerollOutCategory, w.rerollOutAny, w.rerollUpPct, w.rerollUp2PerMille, w.rerollDown)).wait();
    await (await workshop.setCraft(w.keyChance, w.craftUpgradePct)).wait();
    log("workshop", "tunables applied");
  }

  // balances carried over from an earlier deployment: the deployer mints them as a temporary minter while it is still
  // the admin, then gives the minter right up. Ingredients go through mintMined (they were mined), anything else
  // through mintCrafted; both skip the receiver hook. A repeat mints only the part a holder does not have yet.
  if (opts.migration && opts.migration.length) {
    // what this deployer has already minted (it mints nothing else: operator = the deployer, from = 0), from the log,
    // so a resumed run neither repeats a mint nor trusts balances that holders or the live Mine may have moved
    const minted = async () => {
      const m = new Map();
      for (const e of await materials.queryFilter(materials.filters.TransferSingle(me, ethers.ZeroAddress), opts.fromBlock || 0)) {
        const k = `${e.args.to.toLowerCase()}|${e.args.id}`;
        m.set(k, (m.get(k) || 0n) + e.args.value);
      }
      return m;
    };
    const key = (x) => `${x.to.toLowerCase()}|${BigInt(x.id)}`;
    if (!(await materials.minters(me))) await (await materials.setMinter(me, true)).wait();
    const done = await minted();
    let units = 0, sent = 0;
    for (const x of opts.migration) {
      const need = BigInt(x.amount) - (done.get(key(x)) || 0n);
      units += Number(x.amount);
      if (need < 0n) throw new Error(`migration: ${x.to} already got ${done.get(key(x))} of id ${x.id}, more than the ${x.amount} carried over`);
      if (need === 0n) continue;
      const fn = (await materials.isIngredient(x.id)) ? "mintMined" : "mintCrafted";
      await (await materials[fn](x.to, x.id, need)).wait();
      sent++;
    }
    // every balance exactly once: read the log back (a lagging node gets a few tries) before the minter right goes
    let bad = [];
    for (let i = 0; i < 10; i++) {
      const now = await minted();
      bad = opts.migration.filter((x) => (now.get(key(x)) || 0n) !== BigInt(x.amount));
      const extra = [...now.keys()].filter((k) => !opts.migration.some((x) => key(x) === k));
      if (!bad.length && !extra.length) break;
      if (extra.length) throw new Error(`migration: mints outside the file: ${extra.join(", ")}`);
      await sleep(2000);
    }
    if (bad.length) throw new Error(`migration: the log does not show ${bad.length} balances as minted exactly once (e.g. ${bad[0].to} id ${bad[0].id}); the deployer stays a minter until this is resolved`);
    await (await materials.setMinter(me, false)).wait();
    log("migrated", `${units} units in ${opts.migration.length} balances (${sent} mints this run, each checked in the log); the deployer is no longer a minter`);
  }

  // contracts that start paused: the summoning belongs to the main act, so when it is deployed it stays inert until the
  // governor unpauses it (the deployer still governs here and may pause)
  const byName = { mine, workshop, alchemists, souls, stream, kettle };
  for (const name of P.pausedAtLaunch || []) {
    if (!byName[name]) throw new Error(`pausedAtLaunch: unknown or not deployed contract ${name}`);
    if (!(await byName[name].paused())) await (await byName[name].pause()).wait();
    log("paused", name);
  }
  }

  let timelock = null;
  if (P.governance) {
    const g = P.governance;
    const mode = g.mode || "timelock";
    const safe = g.safe && g.safe !== "deployer" ? g.safe : me;
    const guardian = g.guardian && g.guardian !== "safe" ? g.guardian : safe;
    const same = (a, b) => a.toLowerCase() === b.toLowerCase();
    const guarded = [mine, workshop, alchemists, souls, stream, kettle].filter(Boolean);
    const game = [mine, workshop, stream, kettle].filter(Boolean); // plain Ownable: the owner governs
    const collections = [materials, keys, furnaces, souls, alchemists].filter(Boolean); // owner = face, admin governs
    for (const c of guarded) if (!same(await c.guardian(), guardian)) await (await c.setGuardian(guardian)).wait();
    let governor;
    if (mode === "timelock") {
      // proposer + executor = Safe; admin = none (the timelock administers itself after deployment)
      timelock = await deploy("TimelockController", [g.timelockDelay, [safe], [safe], ethers.ZeroAddress]);
      await timelock.waitForDeployment();
      governor = await timelock.getAddress();
      log("Timelock", `${governor} (delay ${g.timelockDelay}s, safe ${safe})`);
    } else if (mode === "safe") {
      governor = safe; // no timelock (owner's decision 2026-09-26): the Safe governs directly, with no delay
    } else throw new Error(`governance.mode must be "timelock" or "safe", not ${mode}`);
    // the collections' face: the wallet marketplaces give the collection page (the deployer unless another is named);
    // under a timelock the face is the timelock, as before
    const face = mode === "timelock" ? governor : g.collectionsOwner && g.collectionsOwner !== "deployer" ? g.collectionsOwner : me;
    // the deployer never keeps a minter right, whatever an earlier run did
    for (const c of [materials, keys]) if (same(await c.admin(), me) && (await c.minters(me))) await (await c.setMinter(me, false)).wait();
    for (const c of game) if (same(await c.owner(), me)) await (await c.transferOwnership(governor)).wait();
    for (const c of collections) {
      if (same(await c.admin(), me)) await (await c.setAdmin(governor)).wait();
      if (same(await c.owner(), me) && !same(me, face)) await (await c.transferOwnership(face)).wait();
    }
    log("governance", `${mode}: guardian ${guardian}; ${game.length} game contracts owned by ${governor}; ${collections.length} collections: admin ${governor}, owner (marketplace face) ${face}`);

    // The end state, checked rather than assumed: the steps above skip whatever already looks done, so anything changed
    // by someone else in between (the deploy key has powers until the hand-over) must fail loudly here.
    const wrong = [];
    const want = async (what, got, exp) => { if (!same(got, exp)) wrong.push(`${what} is ${got}, expected ${exp}`); };
    for (const c of game) await want(`${await c.getAddress()} owner`, await c.owner(), governor);
    for (const c of collections) {
      await want(`${await c.getAddress()} admin`, await c.admin(), governor);
      await want(`${await c.getAddress()} owner`, await c.owner(), face);
    }
    for (const c of guarded) await want(`${await c.getAddress()} guardian`, await c.guardian(), guardian);
    for (const who of [me, safe, face].filter((a, i, all) => all.findIndex((b) => same(a, b)) === i)) {
      if (same(who, governor) && mode === "timelock") continue;
      if (await materials.minters(who)) wrong.push(`${who} is a Materials minter`);
      if (await keys.minters(who)) wrong.push(`${who} is a Keys minter`);
    }
    for (const c of [mine, workshop, souls, alchemists].filter(Boolean)) {
      if (!(await materials.minters(await c.getAddress()))) wrong.push(`${await c.getAddress()} is not a Materials minter`);
      if (!(await keys.minters(await c.getAddress()))) wrong.push(`${await c.getAddress()} is not a Keys minter`);
    }
    if (!same(await furnaces.workshop(), await workshop.getAddress())) wrong.push("Furnaces.workshop is not the Workshop");
    if (kettle && !same(await mine.treasury(), await kettle.getAddress())) wrong.push("Mine.treasury is not the Kettle");
    if (kettle && !same(await stream.pourer(), await kettle.getAddress())) wrong.push("Stream.pourer is not the Kettle");
    if (wrong.length) throw new Error(`the deployed state is not what the hand-over leaves:\n  ${wrong.join("\n  ")}`);
    log("checked", "owners, admins, guardians, minters and the Kettle wiring are as intended");
  }

  return { materials, keys, mine, furnaces, workshop, alchemists, souls, stream, kettle, timelock };
}

module.exports = { deployAll, mineConfig, Q8 };
