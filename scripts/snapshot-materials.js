// Snapshot of every Materials balance of a deployment, for carrying the finds over to the next one (v3 -> v4, owner's
// decision 2026-09-26). Balances come from the TransferSingle/TransferBatch log and are then checked one by one against
// balanceOf, so the file matches the chain exactly; every read is at one block. The Mine must be paused and every find
// revealed first, or the snapshot would miss finds that settle later. Only Materials are carried over, so it refuses a
// deployment with an unrevealed Workshop commit, a claimed key, a furnace or a soul.
//   SOURCE=deployments/robinhood.json OUT=deploy/migration.v3.json node scripts/snapshot-materials.js
// FORCE=1 (a dry run on a live deployment) needs an explicit OUT and marks the file dryRun, which deploy.js refuses.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const SOURCE = process.env.SOURCE || path.join(__dirname, "..", "deployments", "robinhood.json");
const FORCE = process.env.FORCE === "1";
if (FORCE && !process.env.OUT) throw new Error("FORCE=1 writes a dry run: name the file with OUT, never the real migration file");
const OUT = process.env.OUT || path.join(__dirname, "..", "deploy", "migration.v3.json");
const RPC = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com"; // the official node: publicnode lags on logs
const dep = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const art = (n) => require(path.join(__dirname, "..", "artifacts", "contracts", `${n}.sol`, `${n}.json`)).abi;

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const materials = new ethers.Contract(dep.contracts.Materials, art("Materials"), provider);
  const mine = new ethers.Contract(dep.contracts.Mine, art("Mine"), provider);
  const head = await provider.getBlockNumber();
  const at = { blockTag: head };
  const paused = await mine.paused(at);
  if (!paused && !FORCE) throw new Error(`the Mine ${dep.contracts.Mine} is not paused: pause it first (FORCE=1 for a dry run)`);

  // what is not carried over must not exist
  const keys = new ethers.Contract(dep.contracts.Keys, art("Keys"), provider);
  const furnaces = new ethers.Contract(dep.contracts.Furnaces, art("Furnaces"), provider);
  const souls = new ethers.Contract(dep.contracts.Souls, art("Souls"), provider);
  const workshop = new ethers.Contract(dep.contracts.Workshop, art("Workshop"), provider);
  const others = [];
  if ((await keys.unclaimedCount(at)) !== 21n) others.push(`${21n - (await keys.unclaimedCount(at))} mythic key(s) claimed`);
  if ((await furnaces.nextId(at)) !== 1n) others.push(`${(await furnaces.nextId(at)) - 1n} furnace(s)`);
  if ((await souls.total(at)) !== 0n) others.push(`${await souls.total(at)} soul(s)`);
  const commits = Number(await workshop.commitCount(at));
  for (let i = 0; i < commits; i++) if (!(await workshop.commits(i, at)).settled) others.push(`Workshop commit ${i} unrevealed`);
  if (others.length && !FORCE) throw new Error(`only Materials are carried over, but this deployment has ${others.join(", ")}`);

  // the deploy record's startBlock is the deploy's first block; older records only have the end block
  const from = dep.startBlock != null ? dep.startBlock : Math.max(0, dep.block - 20000);
  const I = materials.interface;
  const bal = new Map(); // "holder|id" -> bigint
  const add = (who, id, v) => {
    if (who === ethers.ZeroAddress) return;
    const k = `${who}|${id}`;
    bal.set(k, (bal.get(k) || 0n) + v);
  };
  let events = 0;
  for (let b = from; b <= head; b += 50000) {
    const logs = await provider.getLogs({ address: dep.contracts.Materials, fromBlock: b, toBlock: Math.min(b + 49999, head) });
    for (const l of logs) {
      const e = I.parseLog(l);
      if (!e) continue;
      if (e.name === "TransferSingle") {
        add(e.args.from, e.args.id, -e.args.value);
        add(e.args.to, e.args.id, e.args.value);
        events++;
      } else if (e.name === "TransferBatch") {
        e.args.ids.forEach((id, i) => {
          add(e.args.from, id, -e.args[4][i]);
          add(e.args.to, id, e.args[4][i]);
        });
        events++;
      }
    }
  }

  // every miner's queue must be empty: a find that settles after the snapshot would be lost in the move
  const miners = new Set();
  const subs = await provider.getLogs({ address: dep.contracts.Mine, topics: [mine.interface.getEvent("Submitted").topicHash], fromBlock: from, toBlock: head });
  for (const l of subs) miners.add(mine.interface.parseLog(l).args.miner);
  const waiting = [];
  for (const a of miners) {
    const n = await mine.pendingCount(a, at);
    if (n > 0n) waiting.push(`${a} (${n})`);
  }
  if (waiting.length && process.env.FORCE !== "1") throw new Error(`unrevealed finds left: ${waiting.join(", ")}; reveal them (Mine.reveal works while paused) and run again`);

  const rows = [];
  for (const [k, v] of bal) {
    if (v === 0n) continue;
    if (v < 0n) throw new Error(`negative balance from the log: ${k} ${v}`);
    const [to, id] = k.split("|");
    const onChain = await materials.balanceOf(to, id, at);
    if (onChain !== v) throw new Error(`log says ${k} = ${v}, the chain says ${onChain}`);
    rows.push({ to, id: Number(id), amount: Number(v) });
  }
  rows.sort((a, b) => (a.to === b.to ? a.id - b.id : a.to.localeCompare(b.to)));
  const holders = new Set(rows.map((r) => r.to)).size;
  const units = rows.reduce((s, r) => s + r.amount, 0);
  const minted = await materials.minedTotal(at);
  const out = {
    _comment: "Materials balances carried over to the next deployment by scripts/deploy.js (MIGRATION=...). Generated by scripts/snapshot-materials.js; do not edit by hand.",
    ...(FORCE ? { dryRun: true } : {}),
    source: { network: dep.network, chainId: dep.chainId, Materials: dep.contracts.Materials, Mine: dep.contracts.Mine, block: head, takenAt: new Date().toISOString(), minePaused: paused },
    totals: { holders, balances: rows.length, units, minedTotal: Number(minted), events, waiting: waiting.length, notCarried: others },
    materials: rows,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`snapshot of ${dep.contracts.Materials} at block ${head}: ${holders} holders, ${rows.length} balances, ${units} units (minedTotal ${minted}); ${waiting.length} miners with unrevealed finds -> ${OUT}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
