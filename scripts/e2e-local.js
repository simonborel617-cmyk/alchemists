// Local end-to-end: hardhat node + deploy + keeper + miner on real wall-clock minutes.
//   node scripts/e2e-local.js [seconds]
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const net = require("net");

const ROOT = path.join(__dirname, "..");
const SECONDS = Number(process.argv[2] || 210);
const KEEPER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // hardhat #0
const MINER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // hardhat #1
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const kids = [];

function start(name, cmd, args, env) {
  const out = fs.openSync(path.join(ROOT, `${name}.log`), "w");
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", out, out], shell: process.platform === "win32" });
  kids.push({ name, p });
  console.log(`started ${name} pid ${p.pid}`);
  return p;
}

function waitPort(port, ms) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function probe() {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => { s.destroy(); resolve(); });
      s.once("error", () => { s.destroy(); if (Date.now() > until) reject(new Error("port timeout")); else setTimeout(probe, 500); });
    })();
  });
}

function killAll() {
  for (const { name, p } of kids) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" });
      else p.kill("SIGTERM");
      console.log(`stopped ${name}`);
    } catch (e) {
      console.log(`stop ${name} failed: ${e.message}`);
    }
  }
}

(async () => {
  start("node", npx, ["hardhat", "node"], {});
  await waitPort(8545, 60000);
  const dep = spawnSync(npx, ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], { cwd: ROOT, shell: process.platform === "win32", encoding: "utf8" });
  console.log(dep.stdout.split("\n").filter((l) => !l.includes("injected env")).join("\n"));
  if (dep.status !== 0) { console.error(dep.stderr); killAll(); process.exit(1); }
  start("keeper", "node", ["scripts/keeper.js"], { NET: "localhost", KEEPER_KEY, KEEPER_INTERVAL_MS: "5000" });
  if (process.env.E2E_MINER === "gpu") {
    // python orchestrator driving the CPU stand-in of hb-miner (same persist protocol)
    // the spawn goes through a shell on Windows, so the box command must stay one quoted argument
    start("miner", "python", ["scripts/gpu-miner.py", "--net", "localhost", "--box", '"python scripts/fake-hb-miner.py"', "--submit-delay", "2"], { MINER_KEY });
  } else {
    start("miner", "node", ["scripts/miner.js"], { NET: "localhost", MINER_KEY, THREADS: "2", CHUNK: "50000" });
  }
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  killAll();
  for (const name of ["miner", "keeper"]) {
    console.log(`\n===== ${name}.log =====`);
    console.log(fs.readFileSync(path.join(ROOT, `${name}.log`), "utf8").split("\n").slice(-40).join("\n"));
  }
  process.exit(0);
})().catch((e) => { console.error(e); killAll(); process.exit(1); });
