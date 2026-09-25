// Walks the crafting and summoning loop on a live network with the owner key.
// Mints fixture ingredients directly (owner is whitelisted as a minter), then:
// potion -> furnace -> refine, reroll, craft item, two summons, wait a minute, reveal everything.
//   NET=robinhoodTestnet node scripts/exercise.js
const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const NET = process.env.NET || "robinhoodTestnet";
const dep = require(path.join(__dirname, "..", "deployments", `${NET}.json`));
const art = (n) => require(path.join(__dirname, "..", "artifacts", "contracts", `${n}.sol`, `${n}.json`)).abi;
const rpc =
  process.env.RPC_URL ||
  (NET === "robinhood" ? process.env.ROBINHOOD_RPC : NET === "localhost" ? "http://127.0.0.1:8545" : process.env.ROBINHOOD_TESTNET_RPC);
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
const C = (n) => new ethers.Contract(dep.contracts[n], art(n), wallet);
const materials = C("Materials"), mine = C("Mine"), furnaces = C("Furnaces"), workshop = C("Workshop"), alchemists = C("Alchemists");
const me = wallet.address;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const ing = (t, tier) => 1 + t * 8 + tier;
const item = (kind, tier) => 2000 + kind * 8 + tier;
const G = { gasLimit: 3_000_000n };

function events(rc, contract, names) {
  const out = [];
  for (const lg of rc.logs) {
    try { const ev = contract.interface.parseLog(lg); if (ev && names.includes(ev.name)) out.push(ev); } catch {}
  }
  return out;
}
async function send(label, p) {
  const tx = await p;
  const rc = await tx.wait();
  if (rc.status !== 1n && rc.status !== 1) throw new Error(`${label} reverted ${tx.hash}`);
  log(`${label}: ok, gas ${rc.gasUsed}`);
  return rc;
}
async function waitNextChainMinute(marginMs = 4000) {
  const b = await provider.getBlock("latest");
  const nowMs = b.timestamp * 1000;
  const S = Number(await mine.sessionSec()) * 1000;
  const wake = (Math.floor(nowMs / S) + 1) * S + Math.min(marginMs, S / 4);
  const delay = wake - nowMs;
  log(`waiting ${(delay / 1000).toFixed(0)}s for the next chain minute`);
  await new Promise((r) => setTimeout(r, delay));
}

async function main() {
  log(`exercise on ${NET} as ${me}`);
  if (!(await materials.minters(me))) await send("setMinter(owner)", materials.setMinter(me, true, G));

  // ---- fixtures
  const fixtures = [
    [ing(16, 1), 4], // herbs C (mandrake) -> potions
    [ing(0, 1), 4], [ing(8, 1), 3], [ing(24, 1), 3], // furnace tier 1: 4 metals + 3 minerals + 3 wood
    [ing(2, 1), 10], // iron C x10 -> refine
    [ing(1, 2), 6], [ing(33, 2), 4], // tier-2 mix -> reroll into beasts
    [ing(5, 3), 3], [ing(9, 3), 2], // chalice tier 3: 3 metals + 2 minerals
  ];
  await send("mint fixtures (ingredients)", materials.mintCraftedBatch(me, fixtures.map((f) => f[0]), fixtures.map((f) => f[1]), G));
  const legendarySet = Array.from({ length: 8 }, (_, k) => item(k, 5));
  const commonFive = Array.from({ length: 5 }, (_, k) => item(k, 1));
  await send("mint fixtures (items)", materials.mintCraftedBatch(me, [...legendarySet, ...commonFive], Array(13).fill(1), G));

  // ---- deterministic crafts
  await send("craftPotion tier1", workshop.craftPotion(1, ing(16, 1), ing(16, 1), G));
  const rcF = await send("craftFurnace tier1", workshop.craftFurnace(1, [ing(0, 1), ing(8, 1), ing(24, 1)], [4, 3, 3], G));
  const furnaceId = events(rcF, workshop, ["FurnaceCrafted"])[0].args.furnaceId;
  log(`  furnace #${furnaceId}, tier ${await furnaces.tier(furnaceId)}, refine inputs now ${await workshop.refineInputs()}`);

  // ---- commits
  const commitIds = [];
  const rcR = await send("refine iron C -> U", workshop.refine(furnaceId, 2, 1, G));
  commitIds.push(events(rcR, workshop, ["Committed"])[0].args.id);
  const rcRe = await send("reroll tier2 -> beasts", workshop.reroll(2, 4, [ing(1, 2), ing(33, 2)], [6, 4], G));
  commitIds.push(events(rcRe, workshop, ["Committed"])[0].args.id);
  const rcC = await send("craftItem chalice tier3", workshop.craftItem(2, [ing(5, 3), ing(9, 3)], [3, 2], G));
  commitIds.push(events(rcC, workshop, ["Committed"])[0].args.id);
  await send("refine again (cooldown) should fail", workshop.refine(furnaceId, 2, 1, G).then((tx) => tx.wait()).then(() => { throw new Error("cooldown not enforced"); }).catch((e) => {
    if (String(e.message).includes("cooldown not enforced")) throw e;
    log(`  refine blocked by cooldown as expected (${e.shortMessage || e.reason || "reverted"})`);
    return { wait: async () => ({ status: 1n, gasUsed: 0n }) };
  }));

  // ---- summons (stage 2: off unless EXERCISE_SUMMON=1)
  const summonIds = [];
  if (process.env.EXERCISE_SUMMON === "1") {
    const rcS1 = await send("summon 8x Legendary", alchemists.summon(legendarySet, G));
    const s1 = events(rcS1, alchemists, ["Summoned"])[0].args;
    log(`  alchemist #${s1.id} rank ${s1.rank} avg ${Number(s1.avgTier100) / 100}`);
    const rcS2 = await send("summon 5x Common + 3 empty", alchemists.summon([...commonFive, 0, 0, 0], G));
    const s2 = events(rcS2, alchemists, ["Summoned"])[0].args;
    log(`  alchemist #${s2.id} rank ${s2.rank} avg ${Number(s2.avgTier100) / 100}`);
    summonIds.push(s1.id, s2.id);
  } else {
    log("summons skipped (stage 2); set EXERCISE_SUMMON=1 to include them");
  }

  // ---- reveal after the next chain minute
  await waitNextChainMinute();
  await send("tick", mine.tick(G));
  const rcRev = await send(`revealMany [${commitIds.join(",")}]`, workshop.revealMany(commitIds, G));
  for (const ev of events(rcRev, workshop, ["Refined", "Rerolled", "Crafted"])) {
    if (ev.name === "Refined") log(`  Refined: type ${ev.args.typeId} tier ${ev.args.tier} success ${ev.args.success}`);
    if (ev.name === "Rerolled") log(`  Rerolled: tier ${ev.args.tier} category ${ev.args.category} -> ids ${ev.args.outIds.map(String).join(",")}`);
    if (ev.name === "Crafted") log(`  Crafted: kind ${ev.args.kind} tier ${ev.args.tier} -> out tier ${ev.args.outTier} key ${ev.args.keyIndex}`);
  }
  for (const id of summonIds) {
    const rc = await send(`reveal alchemist #${id}`, alchemists.reveal(id, G));
    const seed = events(rc, alchemists, ["Revealed"])[0].args.seed;
    log(`  #${id} seed ${seed} weight ${(Number(await alchemists.weight(id)) / 1e6).toFixed(3)}`);
  }

  // ---- balances
  log(`iron U balance ${await materials.balanceOf(me, ing(2, 2))}, chalice T3 ${await materials.balanceOf(me, item(2, 3))}, chalice T4 ${await materials.balanceOf(me, item(2, 4))}`);
  log(`burned ingredients ${await materials.burnedIngredients()}, alchemists total ${await alchemists.total()}, price now ${ethers.formatEther(await mine.currentPrice())} ETH`);
  log("exercise complete");
}

main().catch((e) => { console.error(e); process.exit(1); });
