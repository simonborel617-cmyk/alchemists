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
const rpc = net === "robinhood" ? "https://robinhood-rpc.publicnode.com" : net === "localhost" ? "http://127.0.0.1:8545" : "https://rpc.testnet.chain.robinhood.com/rpc";
const explorer = net === "robinhood" ? "https://explorer.chain.robinhood.com" : "https://explorer.testnet.chain.robinhood.com";
fs.writeFileSync(path.join(root, "web", "deployment.json"), JSON.stringify({ ...dep, rpc, explorer, chainName: net === "robinhood" ? "Robinhood Chain" : "Robinhood Chain Testnet" }, null, 2));
fs.copyFileSync(path.join(root, "deploy", "keys.json"), path.join(root, "web", "names.json"));
console.log(`web/abi/*.json, web/deployment.json (${net}, Mine ${dep.contracts.Mine}), web/names.json`);
