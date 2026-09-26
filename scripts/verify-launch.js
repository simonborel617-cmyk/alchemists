// After a deploy: reads the live contracts and checks the state the runbook asks for, instead of clicking through the
// explorer. Read-only, no key needed.
//   NET=robinhood node scripts/verify-launch.js
// Checks: governance as the record says. v4 (governance.mode "safe", no timelock): the Safe owns Mine, Workshop, Stream
// and Kettle; every deployed collection is owned by the collections owner (its marketplace face) and administered by the
// Safe; Furnaces.workshop = the Workshop, and no Souls summoner without the Alchemists. Older records: every contract owned by the timelock; the timelock's delay, the Safe as proposer and executor,
// no admin left with the deployer. Then: guardians = the Safe; with a Kettle: Mine.treasury = Stream.pourer = the
// Kettle, whose Safe, Stream and rates match; without one: treasury and pourer = the Safe; minters = the game contracts
// (Mine, Workshop, Souls and Alchemists when deployed; in v4 exactly those, from the MinterSet logs) and not the
// deployer, the Safe, the collections owner, the timelock, the stream or the kettle; pauses as the profile says
// (pausedAtLaunch); the mine's constants equal the profile.
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
  // v4 records carry governance {mode: "safe", safe, collectionsOwner}; older ones have no such field and a timelock
  const g = dep.governance || {}, pg = P.governance || {};
  const v4 = g.mode === "safe";
  const safe = (v4 && g.safe) || pg.safe || dep.treasury;
  const guardian = pg.guardian && pg.guardian !== "safe" ? pg.guardian : safe;
  let fails = 0;
  const check = (ok, what, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail ? "  " + detail : ""}`); if (!ok) fails++; };
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  console.log(`${NET} (chain ${dep.chainId}), profile ${dep.params}, deployed ${dep.deployedAt} at block ${dep.block}, governance ${v4 ? "v4: the Safe, no timelock" : "timelock"}`);
  check(!!P.kettle === !!A.Kettle, "the deployment record has the Kettle exactly when the profile asks for one", A.Kettle || "none");
  check(!!A.Alchemists === (P.withAlchemists !== false), "the deployment record has the Alchemists exactly when the profile asks for them", A.Alchemists || "none");
  check(eq(dep.treasury, safe), "the treasury in the record is the Safe", dep.treasury);
  if (v4) {
    const face = pg.collectionsOwner && pg.collectionsOwner !== "deployer" ? pg.collectionsOwner : dep.deployer;
    check(!tlAddr, "no timelock: the Safe governs directly", tlAddr || "none");
    check(eq(g.safe, pg.safe), "the Safe in the record is the profile's", g.safe);
    check(!!g.collectionsOwner && eq(g.collectionsOwner, face), "the collections owner in the record is the profile's", g.collectionsOwner || "missing");
    check(!eq(g.collectionsOwner, safe), "the collections owner is a plain wallet, not the Safe");
    for (const n of ["Mine", "Workshop", "Stream", "Kettle"]) if (c[n]) check(eq(await c[n].owner(), safe), `${n}.owner() = the Safe`);
    for (const n of ["Materials", "Keys", "Furnaces", "Souls", "Alchemists"]) {
      if (!c[n]) continue;
      check(eq(await c[n].owner(), g.collectionsOwner), `${n}.owner() = the collections owner`, await c[n].owner());
      check(eq(await c[n].admin(), safe), `${n}.admin() = the Safe`, await c[n].admin());
    }
    // the other token powers the admin hands out: only the Workshop mints furnaces, and while the Alchemists are out
    // nothing may burn a soul (Souls.release belongs to the summoner)
    check(eq(await c.Furnaces.workshop(), A.Workshop), "Furnaces.workshop() = the Workshop", await c.Furnaces.workshop());
    if (!A.Alchemists) check(eq(await c.Souls.summoner(), ethers.ZeroAddress), "Souls.summoner() = none", await c.Souls.summoner());
  } else {
    check(!!tlAddr, "the deployment record names the timelock", tlAddr || "missing");
    for (const [n, x] of Object.entries(c)) check(eq(await x.owner(), tlAddr), `${n}.owner() = timelock`);
  }

  if (tlAddr && !v4) {
    const tl = new ethers.Contract(tlAddr, TL_ABI, p);
    const delay = await tl.getMinDelay();
    check(pg.timelockDelay != null && delay === BigInt(pg.timelockDelay), "timelock delay", `${delay}s${pg.timelockDelay == null ? ", the profile names none (a v4 profile)" : ""}`);
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
      if (!c[n]) continue; // v4 leaves the Alchemists out
      const uri = await c[n].contractURI().catch(() => "");
      check(uri === `${P.collectionsURI}${file}.json`, `${n}.contractURI`, uri || "none");
      const [to, amt] = await c[n].royaltyInfo(1, 10000n).catch(() => [ethers.ZeroAddress, 0n]);
      check(eq(to, safe) && amt === BigInt(P.royaltyBps || 0), `${n} royalty ${(P.royaltyBps || 0) / 100} % to the Safe`, `${amt} bps to ${to}`);
    }
  }

  const game = [A.Mine, A.Workshop, A.Alchemists, A.Souls].filter(Boolean);
  for (const a of game) {
    check(await c.Materials.minters(a), `Materials minter ${a}`);
    check(await c.Keys.minters(a), `Keys minter ${a}`);
  }
  for (const [who, a] of [["deployer", dep.deployer], ["Safe", safe], ["collections owner", g.collectionsOwner], ["timelock", tlAddr], ["Stream", A.Stream], ["Kettle", A.Kettle]]) {
    if (!a || (who === "collections owner" && eq(a, dep.deployer))) continue;
    check(!(await c.Materials.minters(a)), `the ${who} is not a Materials minter`);
    check(!(await c.Keys.minters(a)), `the ${who} is not a Keys minter`);
  }
  if (v4) {
    // the minter sets as their MinterSet logs leave them (the migration's temporary minter included): exactly the game
    // contracts. Needs a node that serves getLogs from block 0 (the official one does)
    const wantSet = game.map((a) => a.toLowerCase());
    for (const n of ["Materials", "Keys"]) {
      const set = new Set();
      try {
        const history = await c[n].queryFilter(c[n].filters.MinterSet(), 0, "latest");
        for (const l of history) l.args.on ? set.add(l.args.who.toLowerCase()) : set.delete(l.args.who.toLowerCase());
        // and nobody else was ever a minter, not even for a moment (mint, then revoke): only the game contracts and,
        // on Materials, the deployer for the migration
        const ever = [...new Set(history.filter((l) => l.args.on).map((l) => l.args.who.toLowerCase()))];
        const allowed = [...wantSet, ...(n === "Materials" && dep.migration ? [dep.deployer.toLowerCase()] : [])];
        const stray = ever.filter((a) => !allowed.includes(a));
        check(!stray.length, `${n}: no other minter ever`, stray.length ? stray.join(" ") : `${history.length} MinterSet events`);
        const extra = [...set].filter((a) => !wantSet.includes(a)), missing = wantSet.filter((a) => !set.has(a));
        check(!extra.length && !missing.length, `${n} minters are exactly Mine, Workshop, Souls${A.Alchemists ? ", Alchemists" : ""}`, extra.length || missing.length ? `extra ${extra.join(" ") || "-"}, missing ${missing.join(" ") || "-"}` : `${set.size} from the MinterSet logs`);
      } catch (e) {
        check(false, `${n} minters from the MinterSet logs`, `logs unavailable (${e.shortMessage || e.message}); RPC_URL=<a node serving getLogs>`);
      }
    }
  }

  const paused = new Set((P.pausedAtLaunch || []).map((s) => s.toLowerCase()));
  for (const n of ["Mine", "Workshop", "Alchemists", "Souls", "Stream"]) {
    if (!c[n]) continue;
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
  // metadata where the profile puts it (these setters emit no event, so only a read shows a change)
  check((await c.Materials.uri(1)) === P.materialsURI, "Materials.uri", await c.Materials.uri(1));
  if (P.keysURI) check((await c.Keys.baseURI()) === P.keysURI, "Keys.baseURI", await c.Keys.baseURI());
  if (P.furnacesURI) check((await c.Furnaces.baseURI()) === P.furnacesURI, "Furnaces.baseURI", await c.Furnaces.baseURI());
  if (P.soulsURI) check((await c.Souls.baseURI()) === P.soulsURI, "Souls.baseURI", await c.Souls.baseURI());
  // FRESH=1, right after a deploy: nothing exists yet but the carried-over Materials, exactly as the migration file has them
  if (process.env.FRESH === "1") {
    check((await c.Keys.unclaimedCount()) === 21n, "fresh: all 21 keys unclaimed", String(await c.Keys.unclaimedCount()));
    check((await c.Furnaces.nextId()) === 1n, "fresh: no furnace", String((await c.Furnaces.nextId()) - 1n));
    check((await c.Souls.total()) === 0n, "fresh: no soul", String(await c.Souls.total()));
    check((await c.Mine.submittedTotal()) === 0n, "fresh: no submit", String(await c.Mine.submittedTotal()));
    const mf = dep.migration && path.join(root, "deploy", dep.migration.file);
    const rows = mf && fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, "utf8")).materials : [];
    if (dep.migration) check(rows.length === dep.migration.balances, "fresh: the migration file is here", mf);
    const byId = new Map();
    let units = 0n;
    for (const r of rows) { byId.set(r.id, (byId.get(r.id) || 0n) + BigInt(r.amount)); units += BigInt(r.amount); }
    check((await c.Materials.minedTotal()) === units, "fresh: minedTotal = the carried-over units", String(await c.Materials.minedTotal()));
    let off = 0;
    for (const [id, n] of byId) if ((await c.Materials.circulating(id)) !== n) off++;
    check(off === 0, "fresh: circulating per id = the migration file", off ? `${off} ids differ` : `${byId.size} ids`);
    for (const r of rows) if ((await c.Materials.balanceOf(r.to, r.id)) !== BigInt(r.amount)) { check(false, `fresh: ${r.to} holds ${r.amount} of id ${r.id}`, String(await c.Materials.balanceOf(r.to, r.id))); break; }
  }
  console.log(fails ? `\n${fails} check(s) FAILED` : "\nall checks passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("verify failed:", e.shortMessage || e.message); process.exit(2); });
