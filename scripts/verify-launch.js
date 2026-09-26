// After a deploy: reads the live contracts and checks the state the runbook asks for, instead of clicking through the
// explorer. Read-only, no key needed.
//   NET=robinhood node scripts/verify-launch.js
// Checks: every contract owned by the timelock; the timelock's delay, the Safe as proposer and executor, no admin left
// with the deployer; guardians = the Safe; with a Kettle: Mine.treasury = Stream.pourer = the Kettle, whose Safe, Stream
// and rates match; without one: treasury and pourer = the Safe; minters = the four game contracts and not the deployer,
// the Safe, the timelock, the stream or the kettle; pauses as the profile says (pausedAtLaunch); the mine's constants
// equal the profile.
const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");
const { mineConfig } = require("./lib/deploy-all");

const NET = process.env.NET || "robinhoodTestnet";
const root = path.join(__dirname, "..");
const dep = require(path.join(root, "deployments", `${NET}.json`));
const P = JSON.parse(fs.readFileSync(path.join(root, "deploy", dep.params), "utf8"));
const RPC = process.env.RPC_URL || { robinhood: "https://rpc.mainnet.chain.robinhood.com", robinhoodTestnet: "https://rpc.testnet.chain.robinhood.com/rpc", localhost: "http://127.0.0.1:8545" }[NET];
const art = (n) => JSON.parse(fs.readFileSync(path.join(root, "artifacts", "contracts", `${n}.sol`, `${n}.json`), "utf8")).abi;
const TL_ABI = [
  "function getMinDelay() view returns (uint256)",
  "function hasRole(bytes32, address) view returns (bool)",
  "function PROPOSER_ROLE() view returns (bytes32)",
  "function EXECUTOR_ROLE() view returns (bytes32)",
  "function CANCELLER_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

(async () => {
  const p = new ethers.JsonRpcProvider(RPC, dep.chainId, { staticNetwork: true });
  const A = dep.contracts, c = {};
  for (const n of ["Materials", "Keys", "Mine", "Furnaces", "Workshop", "Alchemists", "Souls", "Stream", "Kettle"]) if (A[n]) c[n] = new ethers.Contract(A[n], art(n), p);
  const tlAddr = A.Timelock || A.TimelockController;
  const safe = (P.governance && P.governance.safe) || dep.treasury;
  const guardian = P.governance && P.governance.guardian && P.governance.guardian !== "safe" ? P.governance.guardian : safe;
  let fails = 0;
  const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? "  " + detail : ""}`); if (!ok) fails++; };
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  console.log(`${NET} (chain ${dep.chainId}), profile ${dep.params}, deployed ${dep.deployedAt} at block ${dep.block}`);
  check(!!P.kettle === !!A.Kettle, "the deployment record has the Kettle exactly when the profile asks for one", A.Kettle || "none");
  check(!!tlAddr, "the deployment record names the timelock", tlAddr || "missing");
  check(eq(dep.treasury, safe), "the treasury in the record is the Safe", dep.treasury);
  for (const [n, x] of Object.entries(c)) check(eq(await x.owner(), tlAddr), `${n}.owner() = timelock`);

  if (tlAddr) {
    const tl = new ethers.Contract(tlAddr, TL_ABI, p);
    const delay = await tl.getMinDelay();
    check(delay === BigInt(P.governance.timelockDelay), "timelock delay", `${delay}s`);
    check(await tl.hasRole(await tl.PROPOSER_ROLE(), safe), "the Safe proposes");
    check(await tl.hasRole(await tl.EXECUTOR_ROLE(), safe), "the Safe executes");
    check(!(await tl.hasRole(await tl.DEFAULT_ADMIN_ROLE(), dep.deployer)), "the deployer is not the timelock admin");
    check(!(await tl.hasRole(await tl.PROPOSER_ROLE(), dep.deployer)), "the deployer cannot propose");
  }
  for (const n of ["Mine", "Workshop", "Alchemists", "Souls", "Stream", "Kettle"]) if (c[n]) check(eq(await c[n].guardian(), guardian), `${n}.guardian() = ${guardian === safe ? "the Safe" : guardian}`);
  let pourer = null; try { pourer = await c.Stream.pourer(); } catch {}
  if (c.Kettle) {
    check(eq(await c.Mine.treasury(), A.Kettle), "Mine.treasury() = the Kettle");
    check(eq(pourer, A.Kettle), "Stream.pourer() = the Kettle", pourer);
    check(eq(await c.Kettle.safe(), safe), "Kettle.safe() = the Safe");
    check(eq(await c.Kettle.stream(), A.Stream), "Kettle.stream() = the Stream");
    check((await c.Kettle.steamBps()) === BigInt(P.kettle.steamBps) && (await c.Kettle.dripBps()) === BigInt(P.kettle.dripBps), "Kettle rates", `steam ${await c.Kettle.steamBps()} bps, drip ${await c.Kettle.dripBps()} bps`);
    check(!(await c.Kettle.closed()) && !(await c.Kettle.paused()), "the Kettle is open");
  } else {
    check(eq(await c.Mine.treasury(), safe), "Mine.treasury() = the Safe");
    check(pourer !== null && eq(pourer, safe), "Stream.pourer() = the Safe", pourer === null ? "no pourer: a Stream from before the review 2 fixes" : pourer);
  }

  if (P.collectionsURI) {
    const cols = { materials: "Materials", keys: "Keys", furnaces: "Furnaces", souls: "Souls", alchemists: "Alchemists" };
    for (const [file, n] of Object.entries(cols)) {
      const uri = await c[n].contractURI().catch(() => "");
      check(uri === `${P.collectionsURI}${file}.json`, `${n}.contractURI`, uri || "none");
      const [to, amt] = await c[n].royaltyInfo(1, 10000n).catch(() => [ethers.ZeroAddress, 0n]);
      check(eq(to, safe) && amt === BigInt(P.royaltyBps || 0), `${n} royalty ${(P.royaltyBps || 0) / 100} % to the Safe`, `${amt} bps to ${to}`);
    }
  }

  const game = [A.Mine, A.Workshop, A.Alchemists, A.Souls];
  for (const a of game) {
    check(await c.Materials.minters(a), `Materials minter ${a}`);
    check(await c.Keys.minters(a), `Keys minter ${a}`);
  }
  for (const [who, a] of [["deployer", dep.deployer], ["Safe", safe], ["timelock", tlAddr], ["Stream", A.Stream], ["Kettle", A.Kettle]]) {
    if (!a) continue;
    check(!(await c.Materials.minters(a)), `the ${who} is not a Materials minter`);
    check(!(await c.Keys.minters(a)), `the ${who} is not a Keys minter`);
  }

  const paused = new Set((P.pausedAtLaunch || []).map((s) => s.toLowerCase()));
  for (const n of ["Mine", "Workshop", "Alchemists", "Souls", "Stream"]) {
    const want = paused.has(n.toLowerCase()), got = await c[n].paused();
    check(got === want, `${n} ${want ? "paused" : "open"}`, got ? "paused" : "open");
  }

  const want = mineConfig(P), got = await c.Mine.config();
  for (const k of ["floorBitsQ8", "ceilBitsQ8", "kPerHour", "oreR0", "refHashrate", "mCapQ8", "price0", "priceD", "keyChance", "upgradeChance", "firstHourSec", "windowSec", "windowSecEarly", "maxStepQ8", "maxStepEarlyQ8", "estCapBits", "estDivX10"])
    check(BigInt(got[k]) === BigInt(want[k]), `Mine.config.${k}`, String(got[k]));
  for (let i = 0; i < 4; i++) {
    check(BigInt(got.unlockFinds[i]) === BigInt(want.unlockFinds[i]), `Mine.config.unlockFinds[${i}]`, String(got.unlockFinds[i]));
    check(BigInt(got.extraK[i]) === BigInt(want.extraK[i]), `Mine.config.extraK[${i}]`, String(got.extraK[i]));
  }
  check((await c.Mine.sessionSec()) === BigInt(P.mine.sessionSec || 60), "Mine.sessionSec", String(await c.Mine.sessionSec()));
  if (P.workshop) check((await c.Workshop.furnaceCooldown()) === BigInt(P.workshop.furnaceCooldown), "Workshop.furnaceCooldown", String(await c.Workshop.furnaceCooldown()));
  check((await c.Keys.unclaimedCount()) <= 21n, "Keys: at most 21", `${await c.Keys.unclaimedCount()} unclaimed`);
  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("verify failed:", e.shortMessage || e.message); process.exit(2); });
