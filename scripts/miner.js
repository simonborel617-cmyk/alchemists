// CPU miner for the testnet. One address, one best hash per minute, pays the current price on submit.
//   NET=robinhoodTestnet MINER_KEY=0x... node scripts/miner.js
// Uses worker_threads across all cores. For mainnet, port the preimage to the CUDA miner.
const { ethers } = require("ethers");
const os = require("os");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const { workQ8, mineRange } = require("./lib/work");

if (!isMainThread) {
  const { miner, challenge, start, iterations } = workerData;
  const res = mineRange(miner, challenge, start, iterations);
  parentPort.postMessage({ hash: res.hash.toString("hex"), nonce: res.nonce.toString() });
  return;
}

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const NET = process.env.NET || "robinhoodTestnet";
const dep = require(path.join(__dirname, "..", "deployments", `${NET}.json`));
const abi = require(path.join(__dirname, "..", "artifacts", "contracts", "Mine.sol", "Mine.json")).abi;
const rpc =
  process.env.RPC_URL ||
  (NET === "robinhood" ? process.env.ROBINHOOD_RPC : NET === "localhost" ? "http://127.0.0.1:8545" : process.env.ROBINHOOD_TESTNET_RPC);
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new ethers.Wallet(process.env.MINER_KEY || process.env.DEPLOYER_KEY, provider);
const mine = new ethers.Contract(dep.contracts.Mine, abi, wallet);
const THREADS = Number(process.env.THREADS || Math.max(1, os.cpus().length - 1));
const CHUNK = Number(process.env.CHUNK || 200000);
const ZERO = "0x" + "0".repeat(64);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const SUBMIT_DELAY_MS = Number(process.env.SUBMIT_DELAY_MS || 4000);
let chainOffsetMs = 0; // chain time - wall time, refreshed every loop
let SESSION_MS = 60000; // read from Mine.sessionSec() at start
const chainNow = () => Date.now() + chainOffsetMs;
const minuteNow = () => Math.floor(chainNow() / SESSION_MS);

async function syncChainTime() {
  try {
    const b = await provider.getBlock("latest");
    const off = b.timestamp * 1000 - Date.now();
    // a quiet chain can have an old latest block; only trust the offset when the block is fresh
    if (off > -15000) chainOffsetMs = off;
  } catch (e) {
    log("time sync failed:", e.shortMessage || e.message);
  }
}

async function revertReason(tx, blockNumber) {
  try {
    await provider.call({ to: tx.to, from: tx.from, data: tx.data, value: tx.value, blockTag: blockNumber });
    return "no revert on replay";
  } catch (e) {
    return e.reason || e.shortMessage || e.message;
  }
}

function runWorker(challenge, start, iterations) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { miner: wallet.address, challenge, start, iterations } });
    w.once("message", (m) => resolve({ hash: Buffer.from(m.hash, "hex"), nonce: BigInt(m.nonce) }));
    w.once("error", reject);
  });
}

/** Mine one challenge with all threads until deadlineMs; returns best. */
async function mineMinute(challenge, deadlineMs) {
  let best = null;
  let nextStart = BigInt(Date.now()) << 20n; // distinct nonce space per minute
  let hashes = 0;
  const lanes = Array.from({ length: THREADS }, async () => {
    while (Date.now() < deadlineMs) {
      const start = nextStart;
      nextStart += BigInt(CHUNK);
      const r = await runWorker(challenge, start.toString(), CHUNK);
      hashes += CHUNK;
      if (best === null || Buffer.compare(r.hash, best.hash) < 0) best = r;
    }
  });
  await Promise.all(lanes);
  return { best, hashes };
}

// Explicit gas limits: eth_estimateGas runs against the latest block, and a submit that lands one second
// later may cross a minute or a retarget window and do more work (back-fill, retarget, reveal) than estimated.
const GAS = { tick: 3_000_000n, submit: 1_500_000n, reveal: 1_000_000n };

async function ensureChallenge(m) {
  let c = await mine.challenge(m);
  if (c === ZERO) {
    log(`no challenge for minute ${m}, ticking`);
    try {
      await (await mine.tick({ gasLimit: GAS.tick })).wait();
    } catch (e) {
      log("tick failed:", e.shortMessage || e.message);
    }
    c = await mine.challenge(m);
  }
  return c;
}

async function trySubmit(forMinute, best) {
  const tQ8 = Number(await mine.minuteThreshold(forMinute)); // the threshold fixed for the mined minute
  const w = workQ8(best.hash);
  if (w < tQ8) {
    log(`minute ${forMinute}: best ${(w / 256).toFixed(2)} bits < threshold ${(tQ8 / 256).toFixed(2)}, nothing to submit`);
    return;
  }
  const price = await mine.currentPrice();
  const value = (price * 105n) / 100n;
  log(`minute ${forMinute}: best ${(w / 256).toFixed(2)} bits >= ${(tQ8 / 256).toFixed(2)}, submitting nonce ${best.nonce} for ${ethers.formatEther(price)} ETH`);
  let tx;
  try {
    // dry run against the latest state so a doomed submit does not burn gas
    await mine.submit.staticCall(forMinute, best.nonce, { value, gasLimit: GAS.submit });
  } catch (e) {
    log(`  dry run reverted, skipping: ${e.reason || e.shortMessage || e.message}`);
    return;
  }
  try {
    tx = await mine.submit(forMinute, best.nonce, { value, gasLimit: GAS.submit });
    log(`  tx ${tx.hash}`);
    const rc = await tx.wait();
    log(`  mined in block ${rc.blockNumber}, gas ${rc.gasUsed}`);
    for (const lg of rc.logs) {
      try {
        const ev = mine.interface.parseLog(lg);
        if (ev && ["Mined", "KeyMined", "Submitted"].includes(ev.name)) log(`  ${ev.name}`, ev.args.toString());
      } catch {}
    }
  } catch (e) {
    log("submit failed:", e.shortMessage || e.message);
    if (e.receipt && tx) log(`  gasUsed ${e.receipt.gasUsed} reason: ${await revertReason(tx, e.receipt.blockNumber)}`);
  }
}

async function tryReveal() {
  try {
    const n = await mine.pendingCount(wallet.address);
    if (n > 0n) {
      const tx = await mine.reveal(wallet.address, { gasLimit: GAS.reveal });
      const rc = await tx.wait();
      for (const lg of rc.logs) {
        try {
          const ev = mine.interface.parseLog(lg);
          if (ev && ["Mined", "KeyMined"].includes(ev.name)) log(`  revealed ${ev.name}`, ev.args.toString());
        } catch {}
      }
    }
  } catch (e) {
    log("reveal skipped:", e.shortMessage || e.message);
  }
}

async function main() {
  log(`miner ${wallet.address} on ${NET}, Mine ${dep.contracts.Mine}, threads ${THREADS}`);
  let pendingSubmit = null; // { forMinute, best }
  await syncChainTime();
  try { SESSION_MS = Number(await mine.sessionSec()) * 1000; } catch { SESSION_MS = 60000; }
  log(`chain clock offset ${(chainOffsetMs / 1000).toFixed(1)} s vs wall clock, session ${SESSION_MS / 1000}s`);
  for (;;) {
    await syncChainTime();
    const m = minuteNow(); // chain minute
    const minuteStart = m * SESSION_MS - chainOffsetMs; // wall-clock ms when chain session m began
    // submit last minute's find first (we are at the start of minute m)
    if (pendingSubmit && pendingSubmit.forMinute === m - 1) {
      await trySubmit(pendingSubmit.forMinute, pendingSubmit.best);
      pendingSubmit = null;
    } else {
      await tryReveal();
    }
    const challenge = await ensureChallenge(m);
    if (challenge === ZERO) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const deadline = minuteStart + SESSION_MS - Math.min(3000, SESSION_MS / 5);
    if (Date.now() >= deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const { best, hashes } = await mineMinute(challenge, deadline);
    if (best) {
      log(`minute ${m}: ${hashes} hashes, best ${(workQ8(best.hash) / 256).toFixed(2)} bits`);
      pendingSubmit = { forMinute: m, best };
    }
    // wait for the next chain minute plus a margin so block.timestamp is safely inside it
    const wake = minuteStart + SESSION_MS + Math.min(SUBMIT_DELAY_MS, SESSION_MS / 5);
    await new Promise((r) => setTimeout(r, Math.max(0, wake - Date.now())));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
