// npx hardhat run scripts/deploy.js --network robinhoodTestnet
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployAll } = require("./lib/deploy-all");

async function main() {
  const net = hre.network.name;
  const local = net === "hardhat" || net === "localhost";
  const pfile = process.env.PARAMS || path.join(__dirname, "..", "deploy", local ? "params.local.json" : "params.testnet.json");
  const P = JSON.parse(fs.readFileSync(pfile, "utf8"));
  const [deployer] = await hre.ethers.getSigners();
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
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`network ${net} rpc ${hre.network.config.url || "in-process"} deployer ${deployer.address} balance ${hre.ethers.formatEther(bal)} ETH treasury ${treasury}`);
  console.log(`params ${pfile}`);

  // A load-balanced RPC answers from nodes that can be a block or two behind. One of them handed the first mainnet
  // deploy a used nonce; one would also estimate the Stream.setPourer call against a state without the Stream (a plain
  // transfer's gas, so the call runs out of gas) or revert the Kettle's "Stream has code" check. So the nonce is read
  // once and counted here (NonceManager), and every transaction carries a fixed gas limit instead of an estimate:
  // nothing a lagging node says reaches a transaction. Unused gas is refunded; the largest deploy (Workshop) uses 4.1M.
  class DeploySigner extends hre.ethers.NonceManager {
    sendTransaction(tx) {
      if (tx.gasLimit == null) tx = { ...tx, gasLimit: tx.to ? 500_000n : 8_000_000n };
      return super.sendTransaction(tx);
    }
  }
  const d = await deployAll(hre.ethers, P, treasury, (k, v) => console.log(`  ${k}: ${v}`), new DeploySigner(deployer));

  const out = {
    network: net,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    treasury,
    params: path.basename(pfile),
    deployedAt: new Date().toISOString(),
    block: await hre.ethers.provider.getBlockNumber(),
    contracts: {
      Materials: await d.materials.getAddress(),
      Keys: await d.keys.getAddress(),
      Souls: await d.souls.getAddress(),
      Stream: await d.stream.getAddress(),
      Kettle: d.kettle ? await d.kettle.getAddress() : null,
      Mine: await d.mine.getAddress(),
      Furnaces: await d.furnaces.getAddress(),
      Workshop: await d.workshop.getAddress(),
      Alchemists: await d.alchemists.getAddress(),
      Timelock: d.timelock ? await d.timelock.getAddress() : null,
    },
  };
  const file = path.join(__dirname, "..", "deployments", `${net}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`saved ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
