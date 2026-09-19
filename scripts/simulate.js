// Season simulator on the in-process Hardhat network with time travel.
// Miners are modelled analytically: a miner with N hashes per session gets best-of-N leading bits
// b = log2(N) + Exp(ln 2); we then find a real nonce with at least that much work (cheap at the 12-bit floor).
//   npx hardhat run scripts/simulate.js
//   MINERS=8 SESSIONS=400 ORE=300 FARM_AT=150 FARM_LOG2=18 npx hardhat run scripts/simulate.js
const hre = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll } = require("./lib/deploy-all");
const { findNonce, workQ8 } = require("./lib/work");
const P0 = require("../deploy/params.local.json");

const MINERS = Number(process.env.MINERS || 8);
const SESSIONS = Number(process.env.SESSIONS || 400);
const ORE = Number(process.env.ORE || 300);
const K_PER_HOUR = Number(process.env.K_PER_HOUR || 240); // 4 per minute for 8 miners
const FARM_AT = Number(process.env.FARM_AT || 150); // session when a big farm joins (0 = never)
const FARM_LOG2 = Number(process.env.FARM_LOG2 || 18); // farm hashes per session, log2
const BASE_LOG2 = Number(process.env.BASE_LOG2 || 13); // smallest miner, log2 hashes per session
const MAX_BITS = 21; // cap on emulated best bits (search cost)
const REPORT_EVERY = Number(process.env.REPORT_EVERY || 25);
const CEIL_BITS = Number(process.env.CEIL_BITS || 43); // pin the corridor ceiling low to exercise network pressure
const FARM_MINERS = Number(process.env.FARM_MINERS || 1); // addresses the farm splits into
const REF_HS = process.env.REF_HS || "3000"; // farm-multiplier reference (corrected-estimate H/s)
const WILLING_X = Number(process.env.WILLING_X || 0); // miners skip when price > price0 * WILLING_X (0 = always submit)
const HOMOG = process.env.HOMOG === "1"; // all miners at exactly 2^BASE_LOG2 hashes per session (calibration runs)
const ln2 = Math.log(2);

// Exact best-of-N work: P(W >= w) = 1 - exp(-N / 2^w), so W = log2(N) - log2(-ln u) for u ~ U(0,1).
// Returns work in Q8 (fractional bits, like the contract), capped at MAX_BITS (search cost of the real nonce).
function sampleWorkQ8(log2N) {
  const w = log2N - Math.log2(-Math.log(Math.random()));
  return Math.floor(Math.min(MAX_BITS, Math.max(0, w)) * 256);
}

async function main() {
  const P = JSON.parse(JSON.stringify(P0));
  P.mine.oreR0 = ORE;
  P.mine.kPerHour = K_PER_HOUR;
  P.mine.unlockHashrate = ["2", "6", "20", "60"]; // scaled to the emulated hashrates (H/s of the corrected estimate)
  P.mine.extraK = [20, 8, 3, 1];
  P.mine.refHashrate = REF_HS;
  P.mine.ceilBits = CEIL_BITS;
  P.mine.keyChance = 64;
  P.mine.upgradeChance = 16;
  const signers = await hre.ethers.getSigners();
  const treasury = signers[19];
  const d = await deployAll(hre.ethers, P, treasury.address);
  const { mine, materials } = d;
  const miners = signers.slice(1, 1 + MINERS).map((s, i) => ({ s, log2N: BASE_LOG2 + (HOMOG ? 0 : i % 4) })); // 2^13..2^16, or all equal with HOMOG=1
  const farms = signers.slice(1 + MINERS, 1 + MINERS + FARM_MINERS).map((s) => ({ s, log2N: FARM_LOG2 }));
  const willing = WILLING_X ? BigInt(P.mine.price0Wei) * BigInt(Math.round(WILLING_X * 100)) / 100n : 0n;
  let priceSkips = 0;
  const stats = { submitted: 0, skipped: 0, reverted: 0, tiers: [0, 0, 0, 0, 0, 0], keys: 0, upgraded: 0 };
  const rows = [];
  const iface = mine.interface;

  async function nextSession() {
    const ts = await time.latest();
    await time.increaseTo((Math.floor(ts / 60) + 1) * 60 + 1);
  }

  console.log(`simulate: miners ${MINERS} (2^${BASE_LOG2}..2^${BASE_LOG2 + 3} hashes/session), farm ${FARM_MINERS}x2^${FARM_LOG2} at session ${FARM_AT}, ore ${ORE}, K ${K_PER_HOUR}/h, ceil ${CEIL_BITS} bits, ref ${REF_HS} H/s, willing x${WILLING_X}`);
  const t0 = Date.now();
  let prevOre = ORE;
  let finds = []; // finds of the previous session, submitted at the start of the next one (real cadence: one time jump per session)
  for (let s = 0; s < SESSIONS; s++) {
    await nextSession();
    await mine.tick();
    for (const f of finds) {
      const price = await mine.currentPrice();
      if (willing && price > willing) { priceSkips++; continue; }
      try {
        // overpay 25%: the contract refunds the excess, and a retarget inside this very tx may step the price up
        const rc = await (await mine.connect(f.w.s).submit(f.m, f.nonce, { value: (price * 125n) / 100n })).wait();
        stats.submitted++;
        for (const lg of rc.logs) {
          let ev = null;
          try { ev = iface.parseLog(lg); } catch {}
          if (!ev) continue;
          if (ev.name === "Mined") { stats.tiers[Number(ev.args.tier)]++; if (ev.args.upgraded) stats.upgraded++; }
          if (ev.name === "KeyMined") stats.keys++;
        }
      } catch (e) {
        stats.reverted++;
        if (stats.reverted <= 6) console.log(`  revert at session ${s}: ${(e.reason || e.shortMessage || e.message).slice(0, 160)}`);
      }
    }
    finds = [];
    const m = await mine.currentMinute();
    const c = await mine.challenge(m);
    const thr = Number(await mine.minuteThreshold(m));
    const active = FARM_AT && s >= FARM_AT ? [...miners, ...farms] : miners;
    for (const w of active) {
      const wq8 = sampleWorkQ8(w.log2N);
      if (wq8 < thr) { stats.skipped++; continue; }
      // realise the sampled work within half a bit, otherwise the search's own overshoot would add a second heavy tail
      const { nonce } = findNonce(w.s.address, c, wq8, 0n, wq8 + 128);
      finds.push({ w, nonce, m });
    }
    const ore = Number(await mine.oreRemaining());
    if (s % REPORT_EVERY === 0 || ore === 0 || (prevOre > ORE / 2 && ore <= ORE / 2) || (prevOre > ORE / 4 && ore <= ORE / 4)) {
      rows.push({
        session: s,
        thresholdBits: (Number(await mine.tQ8()) / 256).toFixed(2),
        ore,
        halvings: Number(await mine.halvings()),
        kWindow: (Number(await mine.kWindow3(120)) / 1000).toFixed(2),
        unlocked: Number(await mine.unlockedTier()),
        emaHs: Number(await mine.emaHashrate()),
        m: (Number(await mine.mQ8()) / 256).toFixed(2),
        netPressure: (Number(await mine.netPressure()) / 1e6).toFixed(3),
        priceX: (Number(await mine.currentPrice()) / Number(P.mine.price0Wei)).toFixed(2),
        mints: stats.submitted,
        priceSkips,
      });
    }
    prevOre = ore;
    if (ore === 0) { console.log(`vein exhausted at session ${s}`); break; }
  }
  // settle everything left
  await nextSession();
  await mine.tick();
  for (const w of [...miners, ...farms]) {
    if ((await mine.pendingCount(w.s.address)) > 0n) {
      const rc = await (await mine.reveal(w.s.address)).wait();
      for (const lg of rc.logs) { let ev = null; try { ev = iface.parseLog(lg); } catch {} if (ev && ev.name === "Mined") stats.tiers[Number(ev.args.tier)]++; if (ev && ev.name === "KeyMined") stats.keys++; }
    }
  }
  console.table(rows);
  const mined = stats.tiers.slice(1).reduce((a, b) => a + b, 0);
  console.log(`submitted ${stats.submitted}, skipped (below threshold) ${stats.skipped}, skipped (price) ${priceSkips}, reverted ${stats.reverted}, revealed ${mined}, keys ${stats.keys}, upgraded ${stats.upgraded}`);
  console.log(`tiers C/U/R/E/L: ${stats.tiers.slice(1).join(" / ")}  (${stats.tiers.slice(1).map((x) => ((100 * x) / Math.max(1, mined)).toFixed(1) + "%").join(" / ")})`);
  console.log(`minedTotal ${await materials.minedTotal()}, burned ${await materials.burnedIngredients()}, keys unclaimed ${await materials.unclaimedCount()}`);
  console.log(`wall time ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
