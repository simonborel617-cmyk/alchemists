// Mainnet preflight: refuses a mainnet deploy unless the parameters and environment are launch-safe.
// Called by scripts/deploy.js when the network is "robinhood"; runnable standalone:
//   node scripts/preflight.js deploy/params.mainnet.json
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function preflight(P, env) {
  const problems = [];
  const m = P.mine;
  const g = P.governance || {};
  const isAddr = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a) && a !== "0x0000000000000000000000000000000000000000";
  if (!isAddr(g.safe)) problems.push("governance.safe must be the Safe multisig address");
  // v4 (owner's decision 2026-09-26): no timelock. The Safe governs directly; the collections' marketplace face is a
  // fresh wallet that deploys them itself (scripts/deploy.js refuses a wallet with any earlier transaction)
  if (g.mode !== "safe") problems.push("governance.mode must be \"safe\": the Safe governs directly, no timelock (owner's decision 2026-09-26)");
  if (!isAddr(g.collectionsOwner) || g.collectionsOwner.toLowerCase() !== "0x5ce8fb583fd3583e4cd7bf89f881e011b6ecfcd2") problems.push("governance.collectionsOwner must be 0x5Ce8fb583fD3583E4cd7BF89f881e011B6ECfcD2, the wallet that deploys and fronts the collections on OpenSea");
  if (isAddr(g.collectionsOwner) && isAddr(g.safe) && g.collectionsOwner.toLowerCase() === g.safe.toLowerCase()) problems.push("governance.collectionsOwner must be a plain wallet, not the Safe");
  if (g.guardian && g.guardian !== "safe" && !isAddr(g.guardian)) problems.push("governance.guardian must be an address or \"safe\"");
  if (!isAddr(env.TREASURY)) problems.push("TREASURY env must be the Safe (Cauldron) address");
  if (isAddr(env.TREASURY) && isAddr(g.safe) && env.TREASURY.toLowerCase() !== g.safe.toLowerCase()) problems.push("TREASURY should be the same Safe as governance.safe for v1 (Cauldron = Safe)");
  if ((m.sessionSec || 60) !== 60) problems.push("mine.sessionSec must be 60 on mainnet");
  if (m.floorBits !== 30 || m.ceilBits !== 43) problems.push("mine corridor must be 30..43 bits");
  if (m.oreR0 !== 1000000) problems.push("mine.oreR0 must be 1000000 for season 1");
  if (BigInt(m.price0Wei) !== 20000000000000n) problems.push("mine.price0Wei must be 0.00002 ETH (about 5 cents; owner's decision 2026-09-26)");
  if (m.mCap !== 2) problems.push("mine.mCap must be 2");
  if (BigInt(m.refHashrate) < 5n * 10n ** 12n) problems.push("mine.refHashrate must be at least 5 TH/s");
  if (JSON.stringify(m.unlockFinds) !== JSON.stringify([25000, 50000, 100000, 150000])) problems.push("mine.unlockFinds must be 25000/50000/100000/150000 finds (owner decision 2026-09-25)");
  if (m.keyChance < 10000) problems.push("mine.keyChance must be mainnet-scale (65536)");
  if (m.windowSecEarly !== 60 || m.windowSec !== 120 || m.firstHourSec !== 3600) problems.push("mine windows must be 60/120 with a 3600s first hour");
  if (!P.materialsURI || P.materialsURI.includes("example")) problems.push("materialsURI still points at the placeholder host");
  if (!P.furnacesURI || P.furnacesURI.includes("example")) problems.push("furnacesURI still points at the placeholder host");
  if (!P.keysURI || P.keysURI.includes("example")) problems.push("keysURI still points at the placeholder host");
  if (!P.soulsURI || P.soulsURI.includes("example")) problems.push("soulsURI still points at the placeholder host");
  if (P.streamOpenAt !== 100) problems.push("streamOpenAt must be 100 on mainnet");
  if (P.withAlchemists !== false) problems.push("withAlchemists must be false: the main act's contract is deployed once it is final (owner's decision 2026-09-26)");
  if ((P.pausedAtLaunch || []).length) problems.push("pausedAtLaunch must be empty: every deployed contract starts open");
  const w = P.workshop || {};
  if (!w.keyChance || w.keyChance[4] < 100 || w.keyChance[0] < 1000000) problems.push("workshop.keyChance must be mainnet-scale (1e6 .. 100)");
  if (w.furnaceCooldown < 600) problems.push("workshop.furnaceCooldown must be at least 600s");
  if (w.craftUpgradePct !== 5) problems.push("workshop.craftUpgradePct must be 5");
  if (P.collectionsURI !== "https://alchemist-mine.com/metadata/collections/") problems.push("collectionsURI must be https://alchemist-mine.com/metadata/collections/ (the contractURI of each collection)");
  if (P.royaltyBps !== 500) problems.push("royaltyBps must be 500 (5 % creator earnings to the Safe, owner's decision 2026-09-26)");
  const k = P.kettle || {};
  if (k.steamBps !== 6000 || k.dripBps !== 417) problems.push("kettle must be { steamBps: 6000, dripBps: 417 }: the Mine's fees go to the Kettle, 60 % steam dripping 1/24 an hour, 40 % brew to the Safe (decided 2026-09-25)");
  if ((P.pausedAtLaunch || []).includes("kettle") || (P.pausedAtLaunch || []).includes("stream")) problems.push("the Kettle and the Stream must not start paused");
  return problems;
}

module.exports = { preflight };

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, "..", "deploy", "params.mainnet.json");
  require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
  const P = JSON.parse(fs.readFileSync(file, "utf8"));
  const problems = preflight(P, process.env);
  if (problems.length) {
    console.log(`preflight: ${problems.length} problem(s)`);
    for (const p of problems) console.log("  - " + p);
    process.exit(1);
  }
  console.log("preflight: ok");
}
