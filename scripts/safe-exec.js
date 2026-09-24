// Executes a transaction FROM a Safe using owner keys available locally (rehearsals and the project's own multisig only).
// Owners sign the Safe transaction hash off-chain; any funded account then submits execTransaction.
//   NET=robinhoodTestnet node scripts/safe-exec.js --safe 0x... --tx '{"to":"0x...","value":"0","data":"0x..."}' [--keys DEPLOYER_KEY,KEEPER_KEY]
//   NET=robinhoodTestnet node scripts/safe-exec.js --safe 0x... --to 0x... --data 0x...
// The JSON for --tx is what `govern.js print` / `print-execute` produces. Signatures are sorted by owner address as the
// Safe requires; v is 27/28 for raw hash signatures.
const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const NET = process.env.NET || "robinhoodTestnet";
const rpc = process.env.RPC_URL || (NET === "robinhood" ? process.env.ROBINHOOD_RPC || "https://robinhood-rpc.publicnode.com" : process.env.ROBINHOOD_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com/rpc");
const safeAbi = [
  "function nonce() view returns (uint256)", "function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])",
  "function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)", "event ExecutionFailure(bytes32 indexed txHash, uint256 payment)",
];

(async () => {
  const safeAddr = ethers.getAddress(arg("--safe"));
  const tx = arg("--tx") ? JSON.parse(arg("--tx")) : { to: arg("--to"), value: arg("--value", "0"), data: arg("--data", "0x") };
  // mainnet: the owners' keys SAFE_OWNER_1_KEY/SAFE_OWNER_2_KEY sign, MAINNET_KEY pays the gas; testnet: the rehearsal keys
  const keyNames = (arg("--keys", NET === "robinhood" ? "SAFE_OWNER_1_KEY,SAFE_OWNER_2_KEY" : "DEPLOYER_KEY,KEEPER_KEY")).split(",");
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true, batchMaxCount: 4 });
  const signers = keyNames.map((n) => { if (!process.env[n]) throw new Error(`missing ${n} in .env`); return new ethers.Wallet(process.env[n], provider); });
  const payer = NET === "robinhood" && process.env.MAINNET_KEY ? new ethers.Wallet(process.env.MAINNET_KEY, provider) : null;
  const sender = payer || signers[0];
  const safe = new ethers.Contract(safeAddr, safeAbi, sender);
  const [nonce, threshold, owners] = await Promise.all([safe.nonce(), safe.getThreshold(), safe.getOwners()]);
  const ownerSet = new Set(owners.map((o) => o.toLowerCase()));
  const use = signers.filter((s) => ownerSet.has(s.address.toLowerCase()));
  if (use.length < Number(threshold)) throw new Error(`need ${threshold} owner keys, have ${use.length} (${signers.map((s) => s.address).join(", ")})`);
  const to = ethers.getAddress(tx.to), value = BigInt(tx.value || 0), data = tx.data || "0x";
  const hash = await safe.getTransactionHash(to, value, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, nonce);
  const sigs = use.slice(0, Number(threshold)).sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))
    .map((w) => { const s = w.signingKey.sign(hash); return ethers.concat([s.r, s.s, ethers.toBeHex(s.v, 1)]); });
  console.log(`safe ${safeAddr} nonce ${nonce} threshold ${threshold}; ${tx.what || "tx"} -> ${to}; signing with ${use.slice(0, Number(threshold)).map((w) => w.address).join(", ")}`);
  const sent = await safe.execTransaction(to, value, data, 0, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, ethers.concat(sigs), { gasLimit: 1_500_000n });
  const rc = await sent.wait();
  const ev = rc.logs.map((l) => { try { return safe.interface.parseLog(l); } catch { return null; } }).find((e) => e && (e.name === "ExecutionSuccess" || e.name === "ExecutionFailure"));
  console.log(`tx ${sent.hash} status ${rc.status} ${ev ? ev.name : "(no Safe event)"} gas ${rc.gasUsed}`);
  if (!ev || ev.name !== "ExecutionSuccess") process.exit(2);
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
