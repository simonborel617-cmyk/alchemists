// Prints the addresses (never the keys) behind the mainnet keys in .env, with their mainnet balances.
//   node scripts/addresses.js
const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const NAMES = [["MAINNET_KEY", "deployer + keeper"], ["SAFE_OWNER_1_KEY", "Safe owner 1"], ["SAFE_OWNER_2_KEY", "Safe owner 2"]];
const p = new ethers.JsonRpcProvider(process.env.ROBINHOOD_RPC || "https://rpc.mainnet.chain.robinhood.com", 4663, { staticNetwork: true });

(async () => {
  const seen = new Set();
  for (const [name, role] of NAMES) {
    const k = (process.env[name] || "").trim();
    if (!k) { console.log(`${name.padEnd(17)} ${role.padEnd(18)} (empty)`); continue; }
    let a;
    try { a = new ethers.Wallet(k.startsWith("0x") ? k : "0x" + k).address; } catch { console.log(`${name.padEnd(17)} ${role.padEnd(18)} not a valid private key`); continue; }
    const dup = seen.has(a) ? "  SAME AS ANOTHER LINE" : ""; seen.add(a);
    const [bal, n] = await Promise.all([p.getBalance(a), p.getTransactionCount(a)]);
    console.log(`${name.padEnd(17)} ${role.padEnd(18)} ${a}  ${ethers.formatEther(bal)} ETH, ${n} tx${dup}`);
  }
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
