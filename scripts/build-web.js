// Copies contract ABIs and the current deployment into web/ so the static dapp can load them.
//   node scripts/build-web.js [network]
const fs = require("fs");
const path = require("path");
const net = process.argv[2] || process.env.NET || "robinhoodTestnet";
const root = path.join(__dirname, "..");
const out = path.join(root, "web", "abi");
fs.mkdirSync(out, { recursive: true });
for (const n of ["Materials", "Mine", "Furnaces", "Workshop", "Alchemists"]) {
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
const rpcs = RPCS[net] || RPCS.robinhoodTestnet;
const explorer = net === "robinhood" ? "https://explorer.chain.robinhood.com" : "https://explorer.testnet.chain.robinhood.com";
fs.writeFileSync(path.join(root, "web", "deployment.json"), JSON.stringify({ ...dep, rpc: rpcs[0], rpcs, explorer, chainName: net === "robinhood" ? "Robinhood Chain" : "Robinhood Chain Testnet" }, null, 2));
fs.copyFileSync(path.join(root, "deploy", "keys.json"), path.join(root, "web", "names.json"));
console.log(`web/abi/*.json, web/deployment.json (${net}, Mine ${dep.contracts.Mine}), web/names.json`);
