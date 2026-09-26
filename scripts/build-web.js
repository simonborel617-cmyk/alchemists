// Copies contract ABIs and the current deployment into web/ so the static dapp can load them.
//   node scripts/build-web.js [network]
const fs = require("fs");
const path = require("path");
const net = process.argv[2] || process.env.NET || "robinhoodTestnet";
const root = path.join(__dirname, "..");
const out = path.join(root, "web", "abi");
fs.mkdirSync(out, { recursive: true });
for (const n of ["Materials", "Keys", "Mine", "Furnaces", "Workshop", "Alchemists", "Souls", "Stream", "Kettle"]) {
  const art = JSON.parse(fs.readFileSync(path.join(root, "artifacts", "contracts", `${n}.sol`, `${n}.json`), "utf8"));
  fs.writeFileSync(path.join(out, `${n}.json`), JSON.stringify(art.abi));
}
const dep = JSON.parse(fs.readFileSync(path.join(root, "deployments", `${net}.json`), "utf8"));
// public endpoints that answer browser requests with CORS headers (checked from the live site, 2026-09-20); the dapp
// rotates through them on errors and rate limits, `rpc` (the first) is what a wallet gets in wallet_addEthereumChain
const RPCS = {
  robinhood: ["https://robinhood-rpc.publicnode.com", "https://rpc.mainnet.chain.robinhood.com", "https://rpc.ordofi.network"],
  robinhoodTestnet: ["https://rpc.testnet.chain.robinhood.com/rpc", "https://robinhood-sepolia-rpc.publicnode.com"],
  localhost: ["http://127.0.0.1:8545"],
};
// rpc.js splits the work per method: plain reads (eth_call, balances, blocks) try READ_RPCS first; log scans go to
// LOG_RPCS only, in order, and their eth_blockNumber tries LOG_RPCS first; nonces, gas estimates, writes and receipts
// keep the order of `rpcs`. The official nodes take getLogs over any range. publicnode caps it at 50,000 blocks on
// testnet (the scan splits its range) and on mainnet serves recent blocks only (older ones need a paid token); ordofi
// takes ranges of about 100 blocks. So on mainnet the official node is the only log node (checked 2026-09-26).
const READ_RPCS = { robinhood: ["https://robinhood-rpc.publicnode.com"], robinhoodTestnet: ["https://robinhood-sepolia-rpc.publicnode.com"] };
const LOG_RPCS = { robinhood: ["https://rpc.mainnet.chain.robinhood.com"], robinhoodTestnet: ["https://rpc.testnet.chain.robinhood.com/rpc", "https://robinhood-sepolia-rpc.publicnode.com"] };
const rpcs = RPCS[net] || RPCS.robinhoodTestnet, readRpcs = READ_RPCS[net] || [];
const explorer = net === "robinhood" ? "https://robinhoodchain.blockscout.com" : "https://explorer.testnet.chain.robinhood.com";
fs.writeFileSync(path.join(root, "web", "deployment.json"), JSON.stringify({ ...dep, rpc: rpcs[0], rpcs, readRpcs, logRpcs: LOG_RPCS[net] || [], explorer, chainName: net === "robinhood" ? "Robinhood Chain" : "Robinhood Chain Testnet" }, null, 2));
fs.copyFileSync(path.join(root, "deploy", "keys.json"), path.join(root, "web", "names.json"));
// the page opens a connection to the read node before app.js asks it anything: the hint follows the network built here
const page = path.join(root, "web", "index.html"), html = fs.readFileSync(page, "utf8");
const hint = /(<link rel="preconnect" href=")[^"]*(" crossorigin data-rpc>)/, pre = new URL(readRpcs[0] || rpcs[0]).origin;
if (!hint.test(html)) console.warn("web/index.html: the RPC preconnect (data-rpc) is missing");
else if (html.replace(hint, `$1${pre}$2`) !== html) fs.writeFileSync(page, html.replace(hint, `$1${pre}$2`));
console.log(`web/abi/*.json, web/deployment.json (${net}, Mine ${dep.contracts.Mine}), web/names.json, web/index.html preconnect ${pre}`);
