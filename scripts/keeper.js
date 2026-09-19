// Keeper: fixes each minute's challenge and settles reveals for miners, workshop commits and summons.
//   NET=robinhoodTestnet node scripts/keeper.js
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
provider.pollingInterval = 1000; // blocks come every ~140 ms here; the default 4 s poll only delays receipts
const wallet = new ethers.Wallet(process.env.KEEPER_KEY || process.env.DEPLOYER_KEY, provider);
const mine = new ethers.Contract(dep.contracts.Mine, art("Mine"), wallet);
const workshop = new ethers.Contract(dep.contracts.Workshop, art("Workshop"), wallet);
const alchemists = new ethers.Contract(dep.contracts.Alchemists, art("Alchemists"), wallet);
const ZERO = "0x" + "0".repeat(64);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const miners = new Set();
let scannedTo = dep.block || 0;
let workshopHead = 0;
let alchemistHead = 1;

// KEEPER_REVEAL: "none" (default) = the keeper only fixes challenges, players reveal themselves (their next submit reveals
// earlier finds anyway); "all" = reveal every pending find, commit and summon it sees; or a comma-separated list of
// addresses to reveal for (e.g. the project's own miners).
const REVEAL = (process.env.KEEPER_REVEAL || "none").trim().toLowerCase();
const REVEAL_SET = new Set(REVEAL.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.startsWith("0x")));
const revealAllowed = (addr) => REVEAL === "all" || REVEAL_SET.has(String(addr).toLowerCase());

let SESSION_MS = 60000;
let clockOffsetMs = 0; // chain time minus local time
const chainNow = () => Date.now() + clockOffsetMs;
async function syncClock() {
  try {
    const b = await provider.getBlock("latest");
    clockOffsetMs = Number(b.timestamp) * 1000 - Date.now();
    try { SESSION_MS = Number(await mine.sessionSec()) * 1000 || SESSION_MS; } catch {}
  } catch (e) { log("clock sync failed:", e.shortMessage || e.message); }
}
async function tickIfNeeded() {
  const m = Math.floor(chainNow() / SESSION_MS);
  const c = await mine.challenge(m);
  if (c === ZERO) {
    const tx = await mine.tick({ gasLimit: 3_000_000n });
    await tx.wait();
    log(`tick minute ${m}`);
  }
}

async function scanMiners() {
  const latest = await provider.getBlockNumber();
  if (latest <= scannedTo) return;
  const from = scannedTo + 1;
  const to = Math.min(latest, from + 5000);
  const evs = await mine.queryFilter(mine.filters.Submitted(), from, to);
  for (const e of evs) miners.add(e.args.miner);
  scannedTo = to;
}

async function revealMiners() {
  for (const a of miners) {
    if (!revealAllowed(a)) continue;
    const n = await mine.pendingCount(a);
    if (n === 0n) continue;
    const p = await mine.pendingAt(a, 0);
    if ((await mine.entropy(p.revealMinute)) === ZERO) continue;
    try {
      await (await mine.reveal(a, { gasLimit: 1_000_000n })).wait();
      log(`revealed ${n} finds for ${a}`);
    } catch (e) {
      log("reveal miner failed:", e.shortMessage || e.message);
    }
  }
}

async function revealWorkshop() {
  const count = Number(await workshop.commitCount());
  const ready = [];
  for (let i = workshopHead; i < count; i++) {
    const c = await workshop.commits(i);
    if (c.settled) {
      if (i === workshopHead) workshopHead++;
      continue;
    }
    if ((await mine.entropy(c.revealMinute)) !== ZERO) ready.push(i);
    if (ready.length >= 20) break;
  }
  if (ready.length) {
    try {
      await (await workshop.revealMany(ready, { gasLimit: 3_000_000n })).wait();
      log(`workshop revealed ${ready.join(",")}`);
    } catch (e) {
      log("reveal workshop failed:", e.shortMessage || e.message);
    }
  }
}

async function revealAlchemists() {
  const total = Number(await alchemists.total());
  for (let id = alchemistHead; id <= total; id++) {
    const d = await alchemists.data(id);
    if (d.seed !== ZERO) {
      if (id === alchemistHead) alchemistHead++;
      continue;
    }
    if ((await mine.entropy(d.revealMinute)) === ZERO) continue;
    try {
      await (await alchemists.reveal(id, { gasLimit: 400_000n })).wait();
      log(`alchemist ${id} revealed`);
    } catch (e) {
      log("reveal alchemist failed:", e.shortMessage || e.message);
    }
  }
}

async function loop() {
  await syncClock();
  log(`reveal policy: ${REVEAL === "all" ? "everyone" : REVEAL_SET.size ? [...REVEAL_SET].join(",") : "nobody (players reveal themselves)"}; session ${SESSION_MS / 1000}s; clock offset ${(clockOffsetMs / 1000).toFixed(1)}s`);
  let n = 0;
  for (;;) {
    try {
      await tickIfNeeded();
      if (REVEAL !== "none") {
        await scanMiners();
        await revealMiners();
        if (REVEAL === "all") { await revealWorkshop(); await revealAlchemists(); }
      }
    } catch (e) {
      log("keeper error:", e.shortMessage || e.message);
    }
    if (++n % 20 === 0) await syncClock();
    // wake up right after the next session boundary (plus a little for block inclusion), never later than the poll interval
    const untilNext = SESSION_MS - (chainNow() % SESSION_MS) + 700;
    await new Promise((r) => setTimeout(r, Math.min(untilNext, Number(process.env.KEEPER_INTERVAL_MS || 15000))));
  }
}

log(`keeper ${wallet.address} on ${NET}`);
mine.sessionSec().then((s) => { SESSION_MS = Number(s) * 1000; }).catch(() => {}).finally(() => { log(`session ${SESSION_MS / 1000}s`); loop(); });
