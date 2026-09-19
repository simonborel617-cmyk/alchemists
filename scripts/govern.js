// Route an owner call through the TimelockController that owns the game contracts.
//   NET=robinhoodTestnet node scripts/govern.js schedule Mine setTreasury '["0x..."]'
//   NET=robinhoodTestnet node scripts/govern.js execute  Mine setTreasury '["0x..."]'
//   NET=robinhoodTestnet node scripts/govern.js schedule Mine setConfig  @deploy/params.mainnet.json   (builds the Config struct)
//   NET=robinhoodTestnet node scripts/govern.js status   Mine setTreasury '["0x..."]'
// The signer must be a proposer/executor of the timelock (the Safe on mainnet; on testnet the deployer).
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { mineConfig } = require("./lib/deploy-all");

const NET = process.env.NET || "robinhoodTestnet";
const dep = require(path.join(__dirname, "..", "deployments", `${NET}.json`));
const art = (n) => require(path.join(__dirname, "..", "artifacts", "contracts", `${n}.sol`, `${n}.json`)).abi;
const tlAbi = require(path.join(__dirname, "..", "artifacts", "@openzeppelin", "contracts", "governance", "TimelockController.sol", "TimelockController.json")).abi;
const rpc =
  process.env.RPC_URL ||
  (NET === "robinhood" ? process.env.ROBINHOOD_RPC : NET === "localhost" ? "http://127.0.0.1:8545" : process.env.ROBINHOOD_TESTNET_RPC);
const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new ethers.Wallet(process.env.GOVERNOR_KEY || process.env.DEPLOYER_KEY, provider);

async function main() {
  const [action, contractName, fn, rawArgs] = process.argv.slice(2);
  if (!action || !contractName || !fn) throw new Error("usage: govern.js <schedule|execute|status> <Contract> <function> [argsJson|@paramsFile]");
  if (!dep.contracts.Timelock) throw new Error("this deployment has no timelock");
  const target = new ethers.Contract(dep.contracts[contractName], art(contractName), wallet);
  let args = [];
  if (rawArgs && rawArgs.startsWith("@")) {
    const P = JSON.parse(fs.readFileSync(rawArgs.slice(1), "utf8"));
    if (fn !== "setConfig") throw new Error("@params only supports setConfig");
    args = [mineConfig(P)];
  } else if (rawArgs) {
    args = JSON.parse(rawArgs);
  }
  const data = target.interface.encodeFunctionData(fn, args);
  const timelock = new ethers.Contract(dep.contracts.Timelock, tlAbi, wallet);
  const salt = ethers.ZeroHash;
  const pred = ethers.ZeroHash;
  const id = await timelock.hashOperation(await target.getAddress(), 0, data, pred, salt);
  const delay = await timelock.getMinDelay();
  console.log(`timelock ${dep.contracts.Timelock} delay ${delay}s | ${contractName}.${fn} -> op ${id}`);
  if (action === "print" || action === "print-execute") {
    // calldata for the Safe: paste into Safe{Wallet} > Transaction Builder (to = timelock, value 0, custom data), or feed
    // scripts/safe-exec.js. "print" prepares the schedule call, "print-execute" the execute call for the same operation.
    const tlData = action === "print"
      ? timelock.interface.encodeFunctionData("schedule", [await target.getAddress(), 0, data, pred, salt, delay])
      : timelock.interface.encodeFunctionData("execute", [await target.getAddress(), 0, data, pred, salt]);
    console.log(JSON.stringify({ to: dep.contracts.Timelock, value: "0", data: tlData, op: id, what: `${action === "print" ? "schedule" : "execute"} ${contractName}.${fn}(${JSON.stringify(args, (k, v) => (typeof v === "bigint" ? v.toString() : v))})` }, null, 2));
    return;
  }
  if (action === "status") {
    const [pending, ready, done] = await Promise.all([timelock.isOperationPending(id), timelock.isOperationReady(id), timelock.isOperationDone(id)]);
    const ts = await timelock.getTimestamp(id);
    console.log(`pending ${pending} ready ${ready} done ${done} readyAt ${ts > 0n ? new Date(Number(ts) * 1000).toISOString() : "-"}`);
    return;
  }
  if (action === "schedule") {
    const tx = await timelock.schedule(await target.getAddress(), 0, data, pred, salt, delay, { gasLimit: 400_000n });
    const rc = await tx.wait();
    console.log(`scheduled in block ${rc.blockNumber}; executable after ${new Date((Number((await provider.getBlock(rc.blockNumber)).timestamp) + Number(delay)) * 1000).toISOString()}`);
    return;
  }
  if (action === "execute") {
    if (!(await timelock.isOperationReady(id))) throw new Error("operation not ready (or not scheduled)");
    const tx = await timelock.execute(await target.getAddress(), 0, data, pred, salt, { gasLimit: 1_500_000n });
    const rc = await tx.wait();
    console.log(`executed in block ${rc.blockNumber}, status ${rc.status}`);
    return;
  }
  throw new Error(`unknown action ${action}`);
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
