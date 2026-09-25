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

async function deployAll(ethers, P, treasury, log = () => {}) {
  const materials = await ethers.deployContract("Materials", [P.materialsURI]);
  await materials.waitForDeployment();
  log("Materials", await materials.getAddress());

  const keys = await ethers.deployContract("Keys", [P.keyKinds]);
  await keys.waitForDeployment();
  log("Keys", await keys.getAddress());

  const mine = await ethers.deployContract("Mine", [await materials.getAddress(), await keys.getAddress(), treasury, mineConfig(P), P.mine.sessionSec || 60]);
  await mine.waitForDeployment();
  log("Mine", await mine.getAddress());

  const furnaces = await ethers.deployContract("Furnaces", []);
  await furnaces.waitForDeployment();
  log("Furnaces", await furnaces.getAddress());

  const workshop = await ethers.deployContract("Workshop", [
    await mine.getAddress(),
    await materials.getAddress(),
    await keys.getAddress(),
    await furnaces.getAddress(),
    P.itemRecipe,
    P.furnaceRecipe,
  ]);
  await workshop.waitForDeployment();
  log("Workshop", await workshop.getAddress());

  const alchemists = await ethers.deployContract("Alchemists", [
    await mine.getAddress(),
    await materials.getAddress(),
    await keys.getAddress(),
    P.alchemistsBaseURI,
    BigInt(P.summonFeeWei),
    treasury,
  ]);
  await alchemists.waitForDeployment();
  log("Alchemists", await alchemists.getAddress());

  const souls = await ethers.deployContract("Souls", [await mine.getAddress(), await materials.getAddress(), await keys.getAddress(), P.soulsURI || ""]);
  await souls.waitForDeployment();
  log("Souls", await souls.getAddress());

  const stream = await ethers.deployContract("Stream", [await souls.getAddress(), P.streamOpenAt ?? 100, treasury]); // the treasury Safe pours
  await stream.waitForDeployment();
  log("Stream", `${await stream.getAddress()} (claims open at ${P.streamOpenAt ?? 100} souls)`);

  // the Kettle (decided 2026-09-25): the Mine's fees go to it; every hour it sends the brew to the Safe and drips the
  // steam into the Stream, which it alone pours into. Without P.kettle the fees go to the treasury and the Safe pours.
  let kettle = null;
  if (P.kettle) {
    kettle = await ethers.deployContract("Kettle", [treasury, await stream.getAddress(), P.kettle.steamBps, P.kettle.dripBps]);
    await kettle.waitForDeployment();
    await (await stream.setPourer(await kettle.getAddress())).wait();
    await (await mine.setTreasury(await kettle.getAddress())).wait();
    log("Kettle", `${await kettle.getAddress()} (Mine treasury, Stream pourer; steam ${P.kettle.steamBps / 100} %, drip ${P.kettle.dripBps / 100} % an hour, brew to ${treasury})`);
  }

  for (const c of [mine, workshop, alchemists, souls]) {
    await (await materials.setMinter(await c.getAddress(), true)).wait();
    await (await keys.setMinter(await c.getAddress(), true)).wait();
  }
  if (P.keysURI) await (await keys.setBaseURI(P.keysURI)).wait(); // per-key metadata: <base><id>.json
  await (await furnaces.setWorkshop(await workshop.getAddress())).wait();
  if (P.furnacesURI) await (await furnaces.setBaseURI(P.furnacesURI)).wait(); // per-tier metadata: <base><tier>.json
  log("wired", "minters + workshop set");

  if (P.workshop) {
    const w = P.workshop;
    await (await workshop.setRefine(w.furnaceCooldown, w.refineSuccess, w.furnaceBonus, w.refineBaseInputs, w.refineInputDrop)).wait();
    await (await workshop.setReroll(w.rerollOutCategory, w.rerollOutAny, w.rerollUpPct, w.rerollUp2PerMille, w.rerollDown)).wait();
    await (await workshop.setCraft(w.keyChance, w.craftUpgradePct)).wait();
    log("workshop", "tunables applied");
  }

  // contracts that start paused: the summoning belongs to the main act, so on mainnet it is deployed but inert until the
  // timelock unpauses it (the deployer is still the owner here and may pause; unpausing is the timelock's alone)
  const byName = { mine, workshop, alchemists, souls, stream, kettle };
  for (const name of P.pausedAtLaunch || []) {
    if (!byName[name]) throw new Error(`pausedAtLaunch: unknown or not deployed contract ${name}`);
    await (await byName[name].pause()).wait();
    log("paused", name);
  }

  let timelock = null;
  if (P.governance) {
    const g = P.governance;
    const safe = g.safe && g.safe !== "deployer" ? g.safe : (await ethers.getSigners())[0].address;
    // proposer + executor = Safe; admin = none (the timelock administers itself after deployment)
    timelock = await ethers.deployContract("TimelockController", [g.timelockDelay, [safe], [safe], ethers.ZeroAddress]);
    await timelock.waitForDeployment();
    log("Timelock", `${await timelock.getAddress()} (delay ${g.timelockDelay}s, safe ${safe})`);
    const guardian = g.guardian && g.guardian !== "safe" ? g.guardian : safe;
    const guarded = [mine, workshop, alchemists, souls, stream, kettle].filter(Boolean);
    const owned = [materials, keys, mine, furnaces, workshop, alchemists, souls, stream, kettle].filter(Boolean);
    for (const c of guarded) await (await c.setGuardian(guardian)).wait();
    for (const c of owned) await (await c.transferOwnership(await timelock.getAddress())).wait();
    log("governance", `guardian ${guardian}; ownership of all ${owned.length} contracts moved to the timelock`);
  }

  return { materials, keys, mine, furnaces, workshop, alchemists, souls, stream, kettle, timelock };
}

module.exports = { deployAll, mineConfig, Q8 };
