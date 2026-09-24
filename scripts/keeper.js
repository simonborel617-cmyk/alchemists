// Keeper: fixes each minute's challenge and settles reveals for miners, workshop commits and summons.
//   NET=robinhoodTestnet node scripts/keeper.js
const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const NET = process.env.NET || "robinhoodTestnet";
const dep = require(path.join(__dirname, "..", "deployments", `${NET}.json`));
const art = (n) => require(path.join(__dirname, "..", "artifacts", "contracts", `${n}.sol`, `${n}.json`)).abi;
// RPC endpoints, tried in order: RPC_URLS (comma-separated) or RPC_URL first, then the network's public ones. After a few
// failed rounds in a row the keeper moves to the next endpoint, so one node going dark does not stop the mine.
const PUBLIC_RPCS = {
  robinhood: ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood-rpc.publicnode.com"],
  robinhoodTestnet: ["https://rpc.testnet.chain.robinhood.com/rpc", "https://robinhood-sepolia-rpc.publicnode.com"],
  localhost: ["http://127.0.0.1:8545"],
};
const RPCS = [...new Set([
  ...(process.env.RPC_URLS || "").split(","),
  process.env.RPC_URL,
  NET === "robinhood" ? process.env.ROBINHOOD_RPC : NET === "robinhoodTestnet" ? process.env.ROBINHOOD_TESTNET_RPC : null,
  ...(PUBLIC_RPCS[NET] || []),
].map((u) => (u || "").trim()).filter(Boolean))];
let rpcIndex = 0, provider, wallet, mine, workshop, alchemists;
function connect(i) {
  rpcIndex = i % RPCS.length;
  provider = new ethers.JsonRpcProvider(RPCS[rpcIndex], dep.chainId || undefined, { staticNetwork: true });
  provider.pollingInterval = 1000; // blocks come every ~140 ms here; the default 4 s poll only delays receipts
  // mainnet: MAINNET_KEY (on a keeper-only host KEEPER_KEY works too); test networks: KEEPER_KEY, else DEPLOYER_KEY
  const key = NET === "robinhood" ? process.env.MAINNET_KEY || process.env.KEEPER_KEY : process.env.KEEPER_KEY || process.env.DEPLOYER_KEY;
  if (!key) throw new Error(NET === "robinhood" ? "MAINNET_KEY missing in .env" : "KEEPER_KEY missing in .env");
  wallet = new ethers.Wallet(key, provider);
  mine = new ethers.Contract(dep.contracts.Mine, art("Mine"), wallet);
  workshop = new ethers.Contract(dep.contracts.Workshop, art("Workshop"), wallet);
  alchemists = new ethers.Contract(dep.contracts.Alchemists, art("Alchemists"), wallet);
}
connect(0);
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
    const tx = await mine.tick({ gasLimit: 9_000_000n }); // a normal tick fills one minute; after an outage it backfills up to 120 minutes (~5.5M gas)
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
  let n = 0, failures = 0;
  for (;;) {
    try {
      await tickIfNeeded();
      if (REVEAL !== "none") {
        await scanMiners();
        await revealMiners();
        if (REVEAL === "all") { await revealWorkshop(); await revealAlchemists(); }
      }
      failures = 0;
    } catch (e) {
      const msg = e.shortMessage || e.message || String(e);
      log("keeper error:", msg);
      // an empty wallet is not the node's fault: switching would not help, the watcher raises the alarm
      if (!/insufficient funds/i.test(msg) && ++failures >= 3 && RPCS.length > 1) {
        connect(rpcIndex + 1); failures = 0;
        log(`rpc: switched to ${RPCS[rpcIndex]}`);
        await syncClock();
      }
    }
    if (++n % 20 === 0) await syncClock();
    // every half hour: the balance and how long it lasts at one tick a minute
    if (n % 120 === 1) {
      try {
        const [bal, fee] = await Promise.all([provider.getBalance(wallet.address), provider.getFeeData()]);
        const perTick = 90000n * (fee.gasPrice || 1n), days = perTick ? Number(bal / perTick) / 1440 : 0;
        log(`balance ${ethers.formatEther(bal)} ETH, about ${days.toFixed(1)} days of ticks at ${ethers.formatUnits(fee.gasPrice || 0n, "gwei")} gwei`);
      } catch {}
    }
    // wake up right after the next session boundary (plus a little for block inclusion), never later than the poll interval
    const untilNext = SESSION_MS - (chainNow() % SESSION_MS) + 700;
    await new Promise((r) => setTimeout(r, Math.min(untilNext, Number(process.env.KEEPER_INTERVAL_MS || 15000))));
  }
}

log(`keeper ${wallet.address} on ${NET}, rpc ${RPCS[0]}${RPCS.length > 1 ? ` (+${RPCS.length - 1} fallback)` : ""}`);
mine.sessionSec().then((s) => { SESSION_MS = Number(s) * 1000; }).catch(() => {}).finally(() => { log(`session ${SESSION_MS / 1000}s`); loop(); });
