// Creates N test miner keys (once) in .env.miners and tops each up with test ETH from the deployer.
// Testnet only: these are throwaway wallets and faucet ETH.
//   NET=robinhoodTestnet node scripts/fund-miners.js --count 8 --eth 0.0015 [--keeper 0.003]
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const NET = process.env.NET || "robinhoodTestnet";
if (NET === "robinhood") throw new Error("fund-miners is for test networks only");
const rpc = process.env.RPC_URL || (NET === "localhost" ? "http://127.0.0.1:8545" : process.env.ROBINHOOD_TESTNET_RPC);
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const deployer = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
const file = path.join(__dirname, "..", ".env.miners");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

async function main() {
  const count = Number(arg("--count", 8));
  const eth = arg("--eth", "0.0015");
  const keeperEth = arg("--keeper", null);
  let keys = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.startsWith("0x")) : [];
  while (keys.length < count) keys.push(ethers.Wallet.createRandom().privateKey);
  fs.writeFileSync(file, keys.join("\n") + "\n");
  const targets = keys.slice(0, count).map((k) => new ethers.Wallet(k).address);
  if (keeperEth && process.env.KEEPER_KEY) targets.push(new ethers.Wallet(process.env.KEEPER_KEY).address);
  console.log(`deployer ${deployer.address} balance ${ethers.formatEther(await provider.getBalance(deployer.address))} ETH`);
  for (let i = 0; i < targets.length; i++) {
    const to = targets[i];
    const want = ethers.parseEther(i < count ? eth : keeperEth);
    const have = await provider.getBalance(to);
    if (have >= want) { console.log(`${to} already has ${ethers.formatEther(have)}`); continue; }
    const tx = await deployer.sendTransaction({ to, value: want - have, gasLimit: 30_000n });
    await tx.wait();
    console.log(`${to} +${ethers.formatEther(want - have)} ETH (${i < count ? "miner" : "keeper"})`);
  }
  console.log(`keys in ${file}: ${keys.length}; deployer balance now ${ethers.formatEther(await provider.getBalance(deployer.address))} ETH`);
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
