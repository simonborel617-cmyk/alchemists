// Watcher: an independent eye on the mine, meant to run next to the keeper (or anywhere else). Every minute it reads the
// chain itself and raises an alert when
//   - the last minutes have no challenge (the keeper is down and nobody submits: the mine stands still),
//   - the keeper's balance runs low (days of ticks left at the current gas price),
//   - the mine or the workshop is paused,
//   - no RPC endpoint answers.
// Each alert repeats at most every 30 minutes while it lasts and sends a "recovered" line when it clears.
//
//   NET=robinhood KEEPER_ADDRESS=0x... node scripts/watch.js
//
// Alerts go to Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) and/or ntfy (NTFY_TOPIC, NTFY_SERVER defaults to
// https://ntfy.sh); with neither set they are only logged. The watcher needs no key: KEEPER_ADDRESS, or the address of
// KEEPER_KEY when the watcher runs on the keeper's machine. Tunables: WATCH_MIN_BALANCE (ETH, default 0.02),
// WATCH_STALE_MINUTES (default 3), WATCH_INTERVAL_MS (default 60000), RPC_URLS.
const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const NET = process.env.NET || "robinhoodTestnet";
const dep = require(path.join(__dirname, "..", "deployments", `${NET}.json`));
const PUBLIC_RPCS = {
  robinhood: ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood-rpc.publicnode.com"],
  robinhoodTestnet: ["https://rpc.testnet.chain.robinhood.com/rpc", "https://robinhood-sepolia-rpc.publicnode.com"],
  localhost: ["http://127.0.0.1:8545"],
};
const RPCS = [...new Set([...(process.env.RPC_URLS || "").split(","), process.env.RPC_URL, ...(PUBLIC_RPCS[NET] || [])].map((u) => (u || "").trim()).filter(Boolean))];
const KEEPER_KEY = NET === "robinhood" ? process.env.MAINNET_KEY || process.env.KEEPER_KEY : process.env.KEEPER_KEY;
const KEEPER = process.env.KEEPER_ADDRESS || (KEEPER_KEY ? new ethers.Wallet(KEEPER_KEY).address : null);
const MIN_BALANCE = ethers.parseEther(process.env.WATCH_MIN_BALANCE || "0.05");
const STALE = Number(process.env.WATCH_STALE_MINUTES || 3);
const INTERVAL = Number(process.env.WATCH_INTERVAL_MS || 60000);
const REPEAT_MS = 30 * 60000;
// who unpauses and rescues: the Safe itself in v4 records (no timelock), the timelock in older ones
const GOVERNOR = dep.governance && dep.governance.mode === "safe" ? "the Safe" : "the timelock";
const ABI = [
  "function challenge(uint64) view returns (bytes32)",
  "function sessionSec() view returns (uint32)",
  "function paused() view returns (bool)",
  "function lastHour() view returns (uint256)",
  "function closed() view returns (bool)",
  "function pot() view returns (uint256)",
  "function brewOwed() view returns (uint256)",
  "function stream() view returns (address)",
  "function pourer() view returns (address)",
  "function isOpen() view returns (bool)",
  "function epochCount() view returns (uint256)",
  "function epochs(uint256) view returns (uint128 amount, uint128 totalWeight, uint64 at, uint32 collection, uint32 minted)",
];
const ZERO = "0x" + "0".repeat(64);
const log = (...a) => console.log(new Date().toISOString().replace("T", " ").slice(0, 19), ...a);

async function send(text) {
  const line = `[alchemists ${NET}] ${text}`;
  log("ALERT", text);
  const jobs = [];
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
    jobs.push(fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: line }) }));
  if (process.env.NTFY_TOPIC)
    jobs.push(fetch(`${process.env.NTFY_SERVER || "https://ntfy.sh"}/${process.env.NTFY_TOPIC}`, { method: "POST", headers: { Title: `Alchemists ${NET}`, Priority: "high" }, body: text }));
  for (const r of await Promise.allSettled(jobs)) if (r.status === "rejected" || (r.value && !r.value.ok)) log("alert delivery failed:", r.reason ? r.reason.message : r.value.status);
}

// one state per condition: raise, repeat every 30 minutes while it lasts, recover once
const state = new Map();
async function condition(key, bad, text, okText) {
  const s = state.get(key);
  if (bad) {
    if (!s || Date.now() - s.at >= REPEAT_MS) { await send(text); state.set(key, { at: Date.now() }); }
  } else if (s) {
    state.delete(key);
    await send(okText);
  }
}

async function read(url) {
  const p = new ethers.JsonRpcProvider(url, dep.chainId || undefined, { staticNetwork: true });
  const mine = new ethers.Contract(dep.contracts.Mine, ABI, p), workshop = new ethers.Contract(dep.contracts.Workshop, ABI, p);
  const [blk, sec, minePaused, wsPaused, fee, bal] = await Promise.all([
    p.getBlock("latest"), mine.sessionSec(), mine.paused(), workshop.paused(), p.getFeeData(), KEEPER ? p.getBalance(KEEPER) : Promise.resolve(null),
  ]);
  const m = Math.floor(Number(blk.timestamp) / Number(sec));
  // the current minute may not be ticked yet in its first seconds; look at the finished ones before it
  const back = await Promise.all(Array.from({ length: STALE }, (_, i) => mine.challenge(m - 1 - i)));
  const missing = back.filter((c) => c === ZERO).length;
  // the Kettle: ticked every clock hour; two hours without a tick means the hourly rent has stopped
  let kettleLate = false, kettlePaused = false, kettleDry = false, brewOwed = 0n;
  if (dep.contracts.Kettle) {
    const k = new ethers.Contract(dep.contracts.Kettle, ABI, p);
    const [last, kp, kc] = await Promise.all([k.lastHour(), k.paused(), k.closed()]);
    const now = Number(blk.timestamp);
    kettleLate = !kp && !kc && Math.floor(now / 3600) - Number(last) >= 2;
    kettlePaused = kp && !kc; // a rescued kettle stays paused and closed for good: nothing to wait for
    if (!kp && !kc) {
      const [pot, owed, sAddr] = await Promise.all([k.pot(), k.brewOwed(), k.stream()]);
      brewOwed = owed;
      // ticks run but nothing reaches the souls: the stream refuses (paused, closed, not our pourer) or went quiet
      if (pot >= ethers.parseEther("0.01")) {
        const s = new ethers.Contract(sAddr, ABI, p);
        const [open, pourer, sp, sc, n] = await Promise.all([s.isOpen().catch(() => null), s.pourer().catch(() => null), s.paused().catch(() => true), s.closed().catch(() => true), s.epochCount().catch(() => 0n)]);
        const lastAt = n > 0n ? Number((await s.epochs(n - 1n)).at) : 0;
        kettleDry = open === null || !pourer || pourer.toLowerCase() !== dep.contracts.Kettle.toLowerCase() || sp || sc || (open && now - lastAt >= 2 * 3600);
      }
    }
  }
  return { m, minePaused, wsPaused, gasPrice: fee.gasPrice || 0n, bal, missing, kettleLate, kettlePaused, kettleDry, brewOwed };
}

async function round() {
  let d = null, lastErr = null;
  for (const url of RPCS) {
    try { d = await read(url); break; } catch (e) { lastErr = e; }
  }
  await condition("rpc", !d, `no RPC endpoint answers (${RPCS.length} tried): ${lastErr ? lastErr.shortMessage || lastErr.message : ""}`, "the chain answers again");
  if (!d) return;
  await condition("stale", d.missing === STALE, `the last ${STALE} minutes have no challenge: the keeper is down and nobody submits, the mine stands still (minute ${d.m})`, `minutes are ticking again (minute ${d.m})`);
  await condition("mine-paused", d.minePaused, "the Mine is paused", "the Mine is unpaused");
  await condition("ws-paused", d.wsPaused, "the Workshop is paused", "the Workshop is unpaused");
  await condition("kettle-late", d.kettleLate, "the Kettle has not been ticked for two hours: no hourly rent and no brew to the Safe (the keeper is down?)", "the Kettle ticks again");
  await condition("kettle-paused", d.kettlePaused, `the Kettle is paused: fees wait in it until ${GOVERNOR} unpauses or rescues it`, "the Kettle is unpaused");
  await condition("kettle-dry", d.kettleDry, "the Kettle ticks but pours nothing into the Stream (stream paused, closed, not pouring from the Kettle, or silent for two hours): the hourly rent has stopped", "the Kettle pours again");
  await condition("kettle-brew-owed", d.brewOwed > 0n, `the Safe refused the Kettle's brew: ${ethers.formatEther(d.brewOwed)} ETH waits in the Kettle`, "the Safe takes the brew again");
  if (d.bal !== null) {
    const perTick = 220000n * (d.gasPrice || 1n), days = Number(d.bal / perTick) / 1440;
    await condition("balance", d.bal < MIN_BALANCE, `keeper ${KEEPER} is low: ${ethers.formatEther(d.bal)} ETH, about ${days.toFixed(1)} days of ticks at ${ethers.formatUnits(d.gasPrice, "gwei")} gwei. Top it up.`, `keeper balance is fine again: ${ethers.formatEther(d.bal)} ETH`);
  }
  return d;
}

(async () => {
  log(`watching ${NET} mine ${dep.contracts.Mine}, keeper ${KEEPER || "(none given)"}, rpc ${RPCS.join(" | ")}`);
  if (!process.env.TELEGRAM_BOT_TOKEN && !process.env.NTFY_TOPIC) log("no TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID or NTFY_TOPIC: alerts are only logged here");
  if (process.argv.includes("--test-alert")) { await send("test alert: the watcher can reach you"); return; }
  let n = 0;
  for (;;) {
    try {
      const d = await round();
      if (d && n++ % 60 === 0) log(`ok: minute ${d.m}, keeper ${d.bal === null ? "-" : ethers.formatEther(d.bal) + " ETH"}, gas ${ethers.formatUnits(d.gasPrice, "gwei")} gwei`);
    } catch (e) { log("watch error:", e.shortMessage || e.message); }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
})();
