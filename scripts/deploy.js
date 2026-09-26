// npx hardhat run scripts/deploy.js --network robinhoodTestnet
// Mainnet v4 (owner's decision 2026-09-26): deployed from the collections' own wallet, which must be fresh:
//   DEPLOY_KEY_NAME=NFT_OWNER_KEY PARAMS=deploy/params.mainnet.json MIGRATION=deploy/migration.v3.json \
//     npx hardhat run scripts/deploy.js --network robinhood
// A run that stops part-way leaves deployments/<net>.progress.json; the same command with RESUME=1 finishes it and
// never deploys a contract twice.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployAll } = require("./lib/deploy-all");

async function main() {
  const net = hre.network.name;
  const local = net === "hardhat" || net === "localhost";
  const pfile = process.env.PARAMS || path.join(__dirname, "..", "deploy", local ? "params.local.json" : "params.testnet.json");
  const P = JSON.parse(fs.readFileSync(pfile, "utf8"));
  // DEPLOY_KEY_NAME names the .env variable holding the deployer's key (mainnet v4: NFT_OWNER_KEY); without it the
  // network's configured account deploys
  const keyName = process.env.DEPLOY_KEY_NAME;
  if (keyName && !process.env[keyName]) throw new Error(`${keyName} is not set in .env`);
  const deployer = keyName ? new hre.ethers.Wallet(process.env[keyName], hre.ethers.provider) : (await hre.ethers.getSigners())[0];
  const treasury = process.env.TREASURY || deployer.address;
  if (net === "robinhood") {
    const { preflight } = require("./preflight");
    const problems = preflight(P, { ...process.env, TREASURY: treasury });
    if (problems.length) {
      console.error(`mainnet preflight failed (${problems.length}):`);
      for (const p of problems) console.error("  - " + p);
      process.exit(1);
    }
    console.log("mainnet preflight: ok");
  }

  // A named collections owner deploys the collections itself, from a wallet that has never sent a transaction: a
  // wallet must never show the same collection deployed twice. Only a recorded, interrupted run may continue.
  const provider = hre.ethers.provider;
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
  const progressFile = path.join(__dirname, "..", "deployments", `${net}.progress.json`);
  const resume = process.env.RESUME === "1";
  let progress = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, "utf8")) : null;
  if (local) progress = null; // in-process and localhost runs keep no record
  if (progress && !resume) throw new Error(`${progressFile} exists: an earlier run stopped part-way. Finish it with RESUME=1 (the same deployer), or archive the file if that run is abandoned.`);
  if (resume && !progress) throw new Error("RESUME=1 but there is no progress file");
  if (progress && !same(progress.deployer, deployer.address)) throw new Error(`the interrupted run was deployer ${progress.deployer}, not ${deployer.address}`);
  const g0 = P.governance || {};
  const face = g0.collectionsOwner;
  if (face && face !== "deployer" && !local) {
    if (!same(deployer.address, face)) throw new Error(`the collections owner ${face} must deploy them itself; this run's deployer is ${deployer.address}`);
    const sent = await provider.getTransactionCount(deployer.address, "pending");
    if (!progress && sent !== 0) throw new Error(`${deployer.address} has already sent ${sent} transaction(s); the collections are deployed only from a fresh wallet`);
    console.log(`collections owner ${face} deploys, ${progress ? `resuming (${sent} transactions so far)` : "fresh wallet (0 transactions)"}`);
  }
  if (net === "robinhood" && g0.mode === "safe" && (await provider.getCode(g0.safe)) === "0x") throw new Error(`governance.safe ${g0.safe} has no code on this chain: the admin role would go to a plain address`);

  // The journal: every transaction this script sends is signed first, written down with its nonce, then broadcast.
  // Every nonce the deployer has used must be one of them, or someone else holds the key (it has powers until the
  // hand-over): then nothing here may be published.
  const checkJournal = async (when) => {
    if (local) return;
    const mined = await provider.getTransactionCount(deployer.address, "latest");
    const foreign = [];
    for (let n = 0; n < mined; n++) {
      const h = progress.txs && progress.txs[n];
      const t = h && (await provider.getTransaction(h));
      if (!t || t.nonce !== n || !same(t.from, deployer.address)) foreign.push(n);
    }
    if (foreign.length) throw new Error(`${when}: nonce(s) ${foreign.join(", ")} of ${deployer.address} were not sent by this script. Someone else holds the key: stop, do not publish these addresses.`);
    console.log(`journal (${when}): all ${mined} transactions of ${deployer.address} are this script's`);
  };

  const existing = {};
  const expectNonce = {};
  if (progress) {
    await checkJournal("resume");
    const mined = await provider.getTransactionCount(deployer.address, "latest");
    const sent = await provider.getTransactionCount(deployer.address, "pending");
    const seen = new Map();
    for (const [name, r] of Object.entries(progress.contracts)) {
      if (seen.has(r.address.toLowerCase())) throw new Error(`${name} and ${seen.get(r.address.toLowerCase())} are recorded at the same address ${r.address}: the record is wrong (a stale nonce); fix it by hand from the explorer before resuming`);
      seen.set(r.address.toLowerCase(), name);
      if (r.nonce != null && !same(hre.ethers.getCreateAddress({ from: deployer.address, nonce: r.nonce }), r.address)) throw new Error(`${name}: recorded address ${r.address} does not follow from nonce ${r.nonce}`);
      const code = await provider.getCode(r.address);
      if (code !== "0x") existing[name] = r.address;
      else if (r.pending && r.nonce != null && sent === mined && mined <= r.nonce) {
        // the run died before this deploy went out: its nonce is still unused, so it goes out now with that same nonce
        // (deploy-all refuses any other) and can only land at the recorded address
        console.log(`${name}: its deploy never went out (nonce ${r.nonce} unused), it is deployed now with that nonce`);
        expectNonce[name] = r.nonce;
        delete progress.contracts[name];
      } else throw new Error(`${name} was ${r.pending ? "being deployed" : "recorded"} at ${r.address} but has no code there (nonce ${r.nonce}, account nonce ${mined} mined / ${sent} pending): wait for a pending transaction, or, if that transaction failed, check it on the explorer and remove the entry by hand before resuming`);
    }
  } else {
    progress = { network: net, deployer: deployer.address, params: path.basename(pfile), startedAt: new Date().toISOString(), startBlock: await provider.getBlockNumber(), contracts: {}, txs: {} };
  }
  progress.txs = progress.txs || {};
  const save = () => {
    if (local) return;
    fs.mkdirSync(path.dirname(progressFile), { recursive: true });
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
  };
  const record = (name, address, pending, nonce) => {
    progress.contracts[name] = { address, pending, nonce: nonce ?? (progress.contracts[name] || {}).nonce };
    save();
  };

  // The migration file belongs to the run: a resume uses the one the run started with, and on mainnet it must be a
  // final snapshot (Mine paused, nothing unrevealed) of the deployment this one replaces.
  let migFile = process.env.MIGRATION || (progress.migration && progress.migration.file) || null;
  let migration = null;
  if (migFile) {
    const raw = fs.readFileSync(migFile);
    const sha = require("crypto").createHash("sha256").update(raw).digest("hex");
    if (progress.migration && progress.migration.sha256 !== sha) throw new Error(`the run started with migration ${progress.migration.file} (sha256 ${progress.migration.sha256}); ${migFile} differs`);
    if (resume && !progress.migration && Object.keys(progress.contracts).length) throw new Error("the interrupted run had no migration; a resume cannot add one");
    const M = JSON.parse(raw);
    if (!local && net === "robinhood") {
      const prevFile = path.join(__dirname, "..", "deployments", `${net}.json`);
      const prev = fs.existsSync(prevFile) ? JSON.parse(fs.readFileSync(prevFile, "utf8")) : null;
      if (M.dryRun) throw new Error(`${migFile} is a dry run (FORCE=1), not a final snapshot`);
      if (!M.source || M.source.minePaused !== true || !M.totals || M.totals.waiting !== 0) throw new Error(`${migFile} was not taken with the old Mine paused and every find revealed`);
      if (!prev || !same(prev.contracts.Materials, M.source.Materials)) throw new Error(`${migFile} is a snapshot of ${M.source.Materials}, not of the deployment this one replaces (${prev && prev.contracts.Materials})`);
    }
    migration = M.materials;
    progress.migration = { file: path.resolve(migFile), sha256: sha };
    save();
    console.log(`migration ${migFile}: ${migration.length} balances, ${migration.reduce((s, x) => s + Number(x.amount), 0)} units`);
  }

  const bal = await provider.getBalance(deployer.address);
  console.log(`network ${net} rpc ${hre.network.config.url || "in-process"} deployer ${deployer.address} balance ${hre.ethers.formatEther(bal)} ETH treasury ${treasury}`);
  console.log(`params ${pfile}`);

  // A load-balanced RPC answers from nodes that can be a block or two behind. One of them handed the first mainnet
  // deploy a used nonce; one would also estimate the Stream.setPourer call against a state without the Stream (a plain
  // transfer's gas, so the call runs out of gas) or revert the Kettle's "Stream has code" check. So the nonce is read
  // once and counted here (NonceManager), and every transaction carries a fixed gas limit instead of an estimate:
  // nothing a lagging node says reaches a transaction. Unused gas is refunded; the largest deploy (Workshop) uses 4.1M.
  // Each transaction is signed, journaled, then broadcast (see checkJournal).
  class DeploySigner extends hre.ethers.NonceManager {
    async sendTransaction(tx) {
      if (tx.gasLimit == null) tx = { ...tx, gasLimit: tx.to ? 500_000n : 8_000_000n };
      if (local) return super.sendTransaction(tx);
      const nonce = await this.getNonce("pending");
      this.increment();
      const signed = await this.signer.signTransaction(await this.signer.populateTransaction({ ...tx, nonce }));
      progress.txs[nonce] = hre.ethers.keccak256(signed);
      save();
      return provider.broadcastTransaction(signed);
    }
  }
  const d = await deployAll(hre.ethers, P, treasury, (k, v) => console.log(`  ${k}: ${v}`), new DeploySigner(deployer), {
    existing,
    expectNonce,
    onDeployed: local ? undefined : record,
    migration,
    fromBlock: progress.startBlock || 0,
  });
  await checkJournal("end");

  const g = P.governance || {};
  const out = {
    network: net,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    treasury,
    params: path.basename(pfile),
    deployedAt: new Date().toISOString(),
    startBlock: progress.startBlock ?? null, // the first block of the deploy (log scans start here)
    block: await hre.ethers.provider.getBlockNumber(),
    governance: g.mode === "safe" ? { mode: "safe", safe: g.safe && g.safe !== "deployer" ? g.safe : deployer.address, collectionsOwner: face && face !== "deployer" ? face : deployer.address } : { mode: d.timelock ? "timelock" : "none" },
    contracts: {
      Materials: await d.materials.getAddress(),
      Keys: await d.keys.getAddress(),
      Souls: await d.souls.getAddress(),
      Stream: await d.stream.getAddress(),
      Kettle: d.kettle ? await d.kettle.getAddress() : null,
      Mine: await d.mine.getAddress(),
      Furnaces: await d.furnaces.getAddress(),
      Workshop: await d.workshop.getAddress(),
      Alchemists: d.alchemists ? await d.alchemists.getAddress() : null,
      Timelock: d.timelock ? await d.timelock.getAddress() : null,
    },
  };
  if (migration) out.migration = { file: path.basename(migFile), sha256: progress.migration.sha256, balances: migration.length };
  const file = path.join(__dirname, "..", "deployments", `${net}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !local) {
    const prev = JSON.parse(fs.readFileSync(file, "utf8"));
    if (prev.contracts && prev.contracts.Mine !== out.contracts.Mine) {
      const archive = file.replace(/\.json$/, `.${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      fs.copyFileSync(file, archive);
      console.log(`previous record kept as ${archive}`);
    }
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  if (fs.existsSync(progressFile)) fs.renameSync(progressFile, progressFile.replace(/\.progress\.json$/, `.progress.done-${Date.now()}.json`));
  console.log(`saved ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
