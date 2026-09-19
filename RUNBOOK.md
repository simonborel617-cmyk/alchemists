# Mainnet launch runbook, first release

Order of operations and checks. None of this is automated on purpose: every step needs a person with keys.

## The week before

1. **Safe.** Create a Safe 2-of-3 on Robinhood Chain (chainId 4663): in app.safe.global (the network is supported
   officially, transaction service included) or `node scripts/create-safe.js --owners 0xA,0xB,0xC --threshold 2` from
   three owner addresses on different devices; never make the deployer an owner. It is the Cauldron treasury, the
   timelock proposer and the guardian at once. Write the address down. The whole cycle was rehearsed on the testnet on
   2026-09-19 (ninth deployment, Safe `0xc1e3…A140`): schedule and execute through the Safe, guardian pause, unpause through the timelock.
2. **Parameters.** In `deploy/params.mainnet.json` set `governance.safe`, keep `guardian: "safe"` and
   `timelockDelay: 172800`. `materialsURI` → the real metadata host `https://…/metadata/{id}.json`.
   Check: `node scripts/preflight.js deploy/params.mainnet.json`.
3. **Metadata and art.** `node scripts/metadata.js --out web/metadata --base https://…/metadata/`, publish as static
   files. Open `{id}.json` for 2, 1001, 2013 and 3000 in a browser.
4. **Audit.** External report on `Mine`, `Workshop`, `Materials`, `Guarded`; every High and Critical closed, tests green
   (`npx hardhat test`).
5. **Simulation** with the final constants: `npx hardhat run scripts/simulate.js` in two regimes, a normal season and the
   ceiling with pressure (`CEIL_BITS=16 FARM_MINERS=24 WILLING_X=3`).
6. **Keeper.** A separate `KEEPER_KEY`, a VPS running `node scripts/keeper.js` under a supervisor, a month of balance
   (~0.05 ETH at 0.01 gwei), alerts on balance and on "no tick for more than 3 minutes". The keeper wakes right after
   every minute boundary on chain time and only fixes the challenge; it does not reveal (`KEEPER_REVEAL=none` by default),
   a player's find is revealed by their next submit or their Reveal button.
7. **Miner release.** `hb-miner-linux-x64`, `alchemists-miner.exe` and `SHA256SUMS` in a GitHub release of
   `alchemists-miner`, with the README covering the preimage, the `miners.txt` format, the submit price and the rule
   "one address, one submit per minute". The mainnet `deployments/robinhood.json` ships with the release.
8. **RPC.** A dedicated RPC endpoint for the dapp: the public one stalls on large batches and its rate-limit page breaks
   CORS in browsers.

## Launch day

1. `TREASURY=<Safe> PARAMS=deploy/params.mainnet.json npx hardhat run scripts/deploy.js --network robinhood` with a
   `DEPLOYER_KEY` holding ~0.01 ETH. The script runs the preflight itself and refuses on any problem. It deploys five
   contracts, the timelock, sets the guardian and hands ownership over. Commit `deployments/robinhood.json`.
2. Check on the explorer: `owner()` of every contract = timelock, `guardian()` = Safe, `treasury()` of the mine = Safe,
   minters = Mine, Workshop, Alchemists and nobody else, `paused() == false`.
3. `node scripts/build-web.js robinhood`, publish `web/`, open it, make sure the mine is read and the session is running.
4. Start the keeper on the VPS. The first tick opens the first minute; after that submits tick as well.
5. First hour: 60-second windows and steps up to 3 bits, the threshold leaves 30 bits for its equilibrium within 3–5
   minutes. Watch `status.js`: threshold, unlocks, EMA, pressure, price. Expected: Uncommon…Legendary unlock as the EMA
   grows to 1–4 TH/s, pressure near 1 while the rate stays near K.
6. If something is wrong: the guardian (Safe) calls `pause()` on `Mine` and `Workshop`. Reveals and ticks keep working,
   no money moves. Unpausing goes through the timelock, 48 hours.

## The first week

- Twice a day: `status.js`, keeper balance, number of submits, share of reverts in miner logs.
- Do not touch constants without a simulation. Every change: `govern.js print` → Safe → 48 hours → `print-execute` → Safe,
  with a public explanation.
- A second season is a new vein: a new `Mine` deployment with a new reserve, `Materials.setMinter(newMine, true)` through
  the timelock; the old mine stays with its exhausted ore.

## Never

- Deploy mainnet with the deployer as the Safe or without `materialsURI`: the preflight refuses, do not work around it.
- Keep a balance on `DEPLOYER_KEY` after the deploy: it owns nothing any more and needs no money.
- Change `sessionSec`, `oreR0`, `price0`: they are immutable, a second season is a new contract.
