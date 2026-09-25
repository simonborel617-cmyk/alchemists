// The emergency kit. Where the ETH is and how it comes out when something goes wrong:
//   - Submit fees go to the Kettle (with the Kettle deployed; otherwise straight into the Safe). Every hour the Kettle
//     sends 40 % to the Safe and drips steam into the Stream. Exit: the Safe pauses it at once, the timelock runs
//     Kettle.rescue() after its delay: its whole balance returns to the Safe and it closes for good; the same batch points
//     the Mine's treasury back at the Safe. The Safe itself is a plain Safe: its owners move its ETH at any time.
//   - The Stream holds only what was poured into it. Exit: the Safe pauses it at once (it is the guardian), the
//     timelock runs Stream.rescue(Safe) after its delay: the whole balance returns and the stream closes for good.
//   - Mine and Alchemists hold nothing of their own; sweepEscrow(Safe) through the timelock takes any balance they have.
// This script writes those steps as Safe{Wallet} Transaction Builder batches: app.safe.global > Apps > Transaction
// Builder > drop the file > Create batch > Send batch > the second owner signs > Execute.
//
//   NET=robinhood node scripts/emergency.js status     read-only: pauses, balances, owners
//   NET=robinhood node scripts/emergency.js pause      1 file: pause Mine, Workshop, Souls, Stream, Kettle, Alchemists (instant)
//   NET=robinhood node scripts/emergency.js rescue     2 files: schedule now, execute after the delay (48 h on mainnet)
//   NET=robinhood node scripts/emergency.js unpause    2 files: schedule now, execute after the delay (the summoning
//                                                      stays paused; a rescued stream stays closed)
// Files land in emergency-out/ (not committed). Every transaction is also printed, to check against the builder.
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const I = new ethers.Interface([
  "function pause()",
  "function unpause()",
  "function rescue(address to)",
  "function sweepEscrow(address to)",
  "function rescue()",
  "function setTreasury(address t)",
  "function scheduleBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt, uint256 delay)",
  "function executeBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt)",
  "function hashOperationBatch(address[] targets, uint256[] values, bytes[] payloads, bytes32 predecessor, bytes32 salt) view returns (bytes32)",
]);
const ZERO = ethers.ZeroHash;

// one timelock batch as two Safe transactions: schedule it, and execute it once the delay has passed
function timelocked(A, calls, delay, salt) {
  const targets = calls.map((c) => c.to), values = calls.map(() => 0n), payloads = calls.map((c) => c.data);
  return {
    schedule: [{ to: A.Timelock, value: "0", data: I.encodeFunctionData("scheduleBatch", [targets, values, payloads, ZERO, salt, delay]), what: `timelock.scheduleBatch: ${calls.map((c) => c.what).join("; ")} (delay ${delay}s)` }],
    execute: [{ to: A.Timelock, value: "0", data: I.encodeFunctionData("executeBatch", [targets, values, payloads, ZERO, salt]), what: `timelock.executeBatch: ${calls.map((c) => c.what).join("; ")}` }],
    op: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address[]", "uint256[]", "bytes[]", "bytes32", "bytes32"], [targets, values, payloads, ZERO, salt])),
  };
}

const build = {
  // the guardian's brake: direct calls from the Safe, no delay. Ticks and reveals keep working; the Safe's own ETH is
  // untouched and stays movable
  pause(A) {
    return ["Mine", "Workshop", "Souls", "Stream", "Kettle", "Alchemists"].filter((n) => A[n]).map((n) => ({ to: A[n], value: "0", data: I.encodeFunctionData("pause"), what: `${n}.pause()` }));
  },
  // everything the game contracts hold goes back to the Safe; the stream must be paused first and closes for good
  rescue(A, safe, delay, salt, { streamClosed = false, kettleClosed = false } = {}) {
    const calls = [];
    if (A.Stream && !streamClosed) calls.push({ to: A.Stream, data: I.encodeFunctionData("rescue(address)", [safe]), what: `Stream.rescue(${safe})` });
    if (A.Kettle) {
      if (!kettleClosed) calls.push({ to: A.Kettle, data: I.encodeFunctionData("rescue()"), what: "Kettle.rescue() (everything to its Safe)" });
      calls.push({ to: A.Mine, data: I.encodeFunctionData("setTreasury", [safe]), what: `Mine.setTreasury(${safe})` });
    }
    for (const n of ["Mine", "Alchemists"]) if (A[n]) calls.push({ to: A[n], data: I.encodeFunctionData("sweepEscrow", [safe]), what: `${n}.sweepEscrow(${safe})` });
    return timelocked(A, calls, delay, salt);
  },
  // back to normal after a fix; the summoning stays paused, a rescued (closed) stream is left alone
  unpause(A, delay, salt, { streamClosed = false, kettleClosed = false } = {}) {
    const names = ["Mine", "Workshop", "Souls"].concat(streamClosed ? [] : ["Stream"], kettleClosed ? [] : ["Kettle"]).filter((n) => A[n]);
    return timelocked(A, names.map((n) => ({ to: A[n], data: I.encodeFunctionData("unpause"), what: `${n}.unpause()` })), delay, salt);
  },
};

// Safe{Wallet} Transaction Builder batch file. The builder recomputes the checksum on import; if it warns, compare the
// transactions with the printed listing before signing.
function serialize(json) {
  if (Array.isArray(json)) return `[${json.map(serialize).join(",")}]`;
  if (typeof json === "object" && json !== null) {
    const keys = Object.keys(json).sort();
    let acc = `{${JSON.stringify(keys)}`;
    for (const k of keys) acc += `${serialize(json[k])},`;
    return `${acc}}`;
  }
  return JSON.stringify(json);
}
function txBuilderBatch(chainId, safe, name, description, txs) {
  const batch = {
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: { name, description, txBuilderVersion: "1.16.5", createdFromSafeAddress: safe, createdFromOwnerAddress: "" },
    transactions: txs.map((t) => ({ to: t.to, value: t.value || "0", data: t.data, contractMethod: null, contractInputsValues: null })),
  };
  batch.meta.checksum = ethers.solidityPackedKeccak256(["string"], [serialize({ ...batch, meta: { ...batch.meta, name: null } })]);
  return batch;
}

module.exports = { build, txBuilderBatch };

if (require.main === module) {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
  const NET = process.env.NET || "robinhoodTestnet";
  const root = path.join(__dirname, "..");
  const dep = require(path.join(root, "deployments", `${NET}.json`));
  const P = JSON.parse(fs.readFileSync(path.join(root, "deploy", dep.params), "utf8"));
  const A = dep.contracts;
  const safe = (P.governance && P.governance.safe) || dep.treasury;
  const RPC = process.env.RPC_URL || { robinhood: "https://rpc.mainnet.chain.robinhood.com", robinhoodTestnet: "https://rpc.testnet.chain.robinhood.com/rpc", localhost: "http://127.0.0.1:8545" }[NET];
  const p = new ethers.JsonRpcProvider(RPC, dep.chainId, { staticNetwork: true });
  const view = (a, abi) => new ethers.Contract(a, abi, p);
  const kind = process.argv[2];
  const out = path.join(root, "emergency-out");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

  (async () => {
    if (!A.Timelock) throw new Error("this deployment has no timelock");
    const delay = await view(A.Timelock, ["function getMinDelay() view returns (uint256)"]).getMinDelay();
    const closed = A.Stream ? await view(A.Stream, ["function closed() view returns (bool)"]).closed().catch(() => false) : false;
    const kClosed = A.Kettle ? await view(A.Kettle, ["function closed() view returns (bool)"]).closed().catch(() => false) : false;
    if (kind === "status") {
      const eth = async (a) => ethers.formatEther(await p.getBalance(a));
      const sv = view(safe, ["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
      const [owners, threshold] = await Promise.all([sv.getOwners().catch(() => []), sv.getThreshold().catch(() => 0n)]);
      console.log(`${NET} Safe ${safe}: ${await eth(safe)} ETH, ${threshold} of ${owners.length} owners ${owners.join(", ")}`);
      console.log(`timelock ${A.Timelock}: delay ${delay}s, ${await eth(A.Timelock)} ETH`);
      for (const n of ["Mine", "Workshop", "Souls", "Stream", "Kettle", "Alchemists"]) {
        if (!A[n]) continue;
        const paused = await view(A[n], ["function paused() view returns (bool)"]).paused();
        const shut = (n === "Stream" && closed) || (n === "Kettle" && kClosed);
        console.log(`${n.padEnd(11)} ${A[n]}  ${paused ? "PAUSED" : "open  "}  ${await eth(A[n])} ETH${shut ? "  CLOSED (rescued)" : ""}`);
      }
      return;
    }
    fs.mkdirSync(out, { recursive: true });
    const write = (file, name, description, txs) => {
      fs.writeFileSync(path.join(out, file), JSON.stringify(txBuilderBatch(dep.chainId, safe, name, description, txs), null, 2));
      console.log(`\n${path.join("emergency-out", file)}  (${name})`);
      for (const t of txs) console.log(`  to ${t.to}\n  what ${t.what}\n  data ${t.data.slice(0, 74)}${t.data.length > 74 ? "…" : ""}`);
    };
    if (kind === "pause") {
      write(`${stamp}-pause.json`, "Alchemists: pause everything", "Guardian pause, no delay. Ticks and reveals keep working; the Safe's own ETH is untouched.", build.pause(A));
    } else if (kind === "rescue" || kind === "unpause") {
      const salt = ethers.id(`${kind}-${stamp}`);
      const b = kind === "rescue" ? build.rescue(A, safe, delay, salt, { streamClosed: closed, kettleClosed: kClosed }) : build.unpause(A, delay, salt, { streamClosed: closed, kettleClosed: kClosed });
      const readyAt = new Date(Date.now() + Number(delay) * 1000 + 60000).toISOString().slice(0, 16).replace("T", " ");
      write(`${stamp}-${kind}-1-schedule.json`, `Alchemists: ${kind}, step 1 of 2 (schedule)`, `Queues the ${kind} in the timelock (delay ${delay}s). Step 2 becomes executable after ${readyAt} UTC. Operation ${b.op}.`, b.schedule);
      write(`${stamp}-${kind}-2-execute.json`, `Alchemists: ${kind}, step 2 of 2 (execute)`, `Runs the queued ${kind}; executable after ${readyAt} UTC. Operation ${b.op}.`, b.execute);
      if (kind === "rescue") console.log(`\nThe stream${A.Kettle ? " and the kettle" : ""} must be paused before step 2 runs (the pause batch). Step 2 returns everything the stream, ${A.Kettle ? "the kettle, " : ""}the mine and the summoning hold to the Safe ${safe}; the stream${A.Kettle ? " and the kettle" : ""} then stay closed${A.Kettle ? ", and the mine's fees go straight to the Safe" : ""}.`);
    } else {
      throw new Error("usage: emergency.js status|pause|rescue|unpause");
    }
  })().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
}
