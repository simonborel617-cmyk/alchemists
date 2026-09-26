// Prints the live state of the Mine and Materials on the chosen network.
//   NET=robinhoodTestnet node scripts/status.js
const { ethers } = require("ethers");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const NET = process.env.NET || "robinhoodTestnet";
const dep = require(path.join(__dirname, "..", "deployments", `${NET}.json`));
const art = (n) => require(path.join(__dirname, "..", "artifacts", "contracts", `${n}.sol`, `${n}.json`)).abi;
const rpc =
  process.env.RPC_URL ||
  (NET === "robinhood" ? process.env.ROBINHOOD_RPC : NET === "localhost" ? "http://127.0.0.1:8545" : process.env.ROBINHOOD_TESTNET_RPC);
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const mine = new ethers.Contract(dep.contracts.Mine, art("Mine"), provider);
const materials = new ethers.Contract(dep.contracts.Materials, art("Materials"), provider);
// the keys came with testnet v10; the Alchemists are left out of mainnet v4 until the main act
const keysC = dep.contracts.Keys ? new ethers.Contract(dep.contracts.Keys, art("Keys"), provider) : null;
const alchemists = dep.contracts.Alchemists ? new ethers.Contract(dep.contracts.Alchemists, art("Alchemists"), provider) : null;
const workshop = new ethers.Contract(dep.contracts.Workshop, art("Workshop"), provider);

async function main() {
  const blk = await provider.getBlock("latest");
  const [tQ8, unlocked, ore, sub, ema, net, mQ8, price, lastM, heat, mined, burned, keys, total, commits] = await Promise.all([
    mine.tQ8(), mine.unlockedTier(), mine.oreRemaining(), mine.submittedTotal(), mine.emaHashrate(), mine.netPressure(), mine.mQ8(),
    mine.currentPrice(), mine.lastChallengeMinute(), mine.heatQ8(), materials.minedTotal(), materials.burnedIngredients(),
    keysC ? keysC.unclaimedCount() : "n/a", alchemists ? alchemists.total() : "not deployed", workshop.commitCount(),
  ]);
  let sessionSec = 60;
  try { sessionSec = Number(await mine.sessionSec()); } catch {} // older deployments have no sessionSec()
  const chainMinute = Math.floor(blk.timestamp / sessionSec);
  let minuteT = "n/a";
  try { minuteT = (Number(await mine.minuteThreshold(chainMinute)) / 256).toFixed(2); } catch {}
  console.log(`${NET} block ${blk.number} chain time ${new Date(blk.timestamp * 1000).toISOString()} session ${chainMinute} (${sessionSec}s sessions)`);
  console.log(`threshold live ${(Number(tQ8) / 256).toFixed(2)} bits, this minute ${minuteT}  heat ${(Number(heat) / 256).toFixed(2)}  unlocked tier ${unlocked}  last challenge minute ${lastM} (${Number(lastM) - chainMinute} vs now)`);
  console.log(`ore remaining ${ore}  submitted ${sub}  mined (revealed) ${mined}  burned ${burned}  keys unclaimed ${keys}`);
  console.log(`hashrate ema ${(Number(ema) / 1e6).toFixed(2)} MH/s  farm m ${(Number(mQ8) / 256).toFixed(2)}  net pressure ${(Number(net) / 1e6).toFixed(3)}  price ${ethers.formatEther(price)} ETH`);
  console.log(`alchemists ${total}  workshop commits ${commits}`);
  const who = process.env.MINER_ADDRESS || (process.env.MINER_KEY ? new ethers.Wallet(process.env.MINER_KEY).address : process.env.DEPLOYER_KEY ? new ethers.Wallet(process.env.DEPLOYER_KEY).address : null);
  if (who) {
    const pending = await mine.pendingCount(who);
    const bal = await provider.getBalance(who);
    console.log(`miner ${who}: pending ${pending}, balance ${ethers.formatEther(bal)} ETH`);
    const owned = [];
    for (let t = 0; t < 40; t++) for (let tier = 1; tier <= 5; tier++) {
      const id = 1 + t * 8 + tier;
      const b = await materials.balanceOf(who, id);
      if (b > 0n) owned.push(`type${t}/T${tier}x${b}`);
    }
    console.log(`ingredients: ${owned.join(" ") || "none"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
