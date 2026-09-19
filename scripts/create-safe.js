// Deploys a Safe (v1.4.1, L2 singleton) through the canonical SafeProxyFactory that Safe{Wallet} indexes, so the new
// Safe shows up at app.safe.global (Robinhood Chain and Robinhood Testnet are both supported there).
//   NET=robinhoodTestnet node scripts/create-safe.js --owners 0xA,0xB,0xC --threshold 2 [--name cauldron]
// Only owner ADDRESSES are needed; the deployer key from .env pays the deployment gas and holds no power over the Safe.
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const NET = process.env.NET || "robinhoodTestnet";
const rpc = process.env.RPC_URL || (NET === "robinhood" ? process.env.ROBINHOOD_RPC || "https://robinhood-rpc.publicnode.com" : process.env.ROBINHOOD_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com/rpc");
const owners = (arg("--owners", "") || "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => ethers.getAddress(a));
const threshold = Number(arg("--threshold", "2"));
const name = arg("--name", "safe");
if (owners.length < 2 || threshold < 1 || threshold > owners.length) { console.error("need --owners 0xA,0xB[,0xC] and 1 <= --threshold <= owners"); process.exit(1); }

// canonical v1.4.1 deployment addresses (same on every chain)
const FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SINGLETON_L2 = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
const FALLBACK = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";
const factoryAbi = ["function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)", "event ProxyCreation(address indexed proxy, address singleton)"];
const safeAbi = ["function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)", "function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)", "function VERSION() view returns (string)"];

(async () => {
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true, batchMaxCount: 4 });
  const wallet = new ethers.Wallet(process.env.DEPLOYER_KEY, provider);
  for (const a of [FACTORY, SINGLETON_L2, FALLBACK]) if ((await provider.getCode(a)) === "0x") throw new Error(`Safe contract ${a} is not deployed on this chain`);
  const factory = new ethers.Contract(FACTORY, factoryAbi, wallet);
  const iface = new ethers.Interface(safeAbi);
  const initializer = iface.encodeFunctionData("setup", [owners, threshold, ethers.ZeroAddress, "0x", FALLBACK, ethers.ZeroAddress, 0, ethers.ZeroAddress]);
  const salt = BigInt(Date.now());
  console.log(`deploying Safe ${threshold}-of-${owners.length} on ${NET} from ${wallet.address}`);
  const tx = await factory.createProxyWithNonce(SINGLETON_L2, initializer, salt, { gasLimit: 1_000_000n });
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "ProxyCreation");
  const safeAddr = ev.args.proxy;
  const safe = new ethers.Contract(safeAddr, safeAbi, provider);
  const out = { network: NET, safe: safeAddr, owners: await safe.getOwners(), threshold: Number(await safe.getThreshold()), version: await safe.VERSION(), tx: tx.hash, createdAt: new Date().toISOString(), name };
  const file = path.join(__dirname, "..", "deployments", `safe.${NET}.${name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(`saved ${file}`);
  console.log(`open it: https://app.safe.global/home?safe=${NET === "robinhood" ? "robinhood" : "robinhood-testnet"}:${safeAddr}`);
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
