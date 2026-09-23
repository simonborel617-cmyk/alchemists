# Mainnet launch runbook, first release

Order of operations and checks. None of this is automated on purpose: every step needs a person with keys.

## The week before

1. **Safe.** Create a Safe 2-of-3 on Robinhood Chain (chainId 4663): in app.safe.global (the network is supported
   officially, transaction service included) or `node scripts/create-safe.js --owners 0xA,0xB,0xC --threshold 2` from
   three owner addresses on different devices; never make the deployer an owner. It is the Cauldron treasury, the
   timelock proposer and the guardian at once. Write the address down. The whole cycle was rehearsed on the testnet on
   2026-09-19 (ninth deployment, Safe `0xc1e3…A140`): schedule and execute through the Safe, guardian pause, unpause through the timelock.
2. **Parameters.** In `deploy/params.mainnet.json` set `governance.safe`, keep `guardian: "safe"` and
   `timelockDelay: 172800`. `materialsURI` → `https://alchemist-mine.com/metadata/{id}.json` (already set in `params.mainnet.json`).
   Check: `node scripts/preflight.js deploy/params.mainnet.json`.
3. **Metadata and art.** `node scripts/metadata.js` (base `https://alchemist-mine.com/metadata/`), publish as static
   files. Open `{id}.json` for 2, 1001 and 2013, `furnace/3.json` and `keys/0.json` in a browser.
4. **Audit.** The owner decided on 2026-09-24 to launch without an external audit. Two internal reviews
   (`SECURITY-REVIEW.md`), every finding closed or accepted, tests green (`npx hardhat test`).
5. **Simulation** with the final constants: `npx hardhat run scripts/simulate.js` in two regimes, a normal season and the
   ceiling with pressure (`CEIL_BITS=16 FARM_MINERS=24 WILLING_X=3`).
6. **Keeper.** A separate `KEEPER_KEY`, a VPS running `node scripts/keeper.js` and `node scripts/watch.js` under
   systemd (`deploy/vps/README.md` has the whole setup), alerts to Telegram or ntfy on "no tick for 3 minutes", a low
   keeper balance, a pause or no RPC. A tick is ~87k gas: at 0.05 gwei a keeper that ticks every minute burns ~0.19 ETH
   a month (submits tick too, so less once people mine); start with 0.1 ETH, the watcher warns below 0.02. The keeper
   rotates to the next RPC after three failed rounds and logs its balance and days left every half hour. The keeper wakes right after
   every minute boundary on chain time and only fixes the challenge; it does not reveal (`KEEPER_REVEAL=none` by default),
   a player's find is revealed by their next submit or their Reveal button.
7. **Miner release.** After the deploy, `scripts/release-miner.ps1 -Version v1.0.0` rebuilds the exe, gathers
   `hb-miner-linux-x64`, `alchemists-miner.exe`, `deployments/robinhood.json` and `SHA256SUMS` and prints the command
   for a draft release of `alchemists-miner`, with the README covering the preimage, the `miners.txt` format, the submit price and the rule
   "one address, one submit per minute". The mainnet `deployments/robinhood.json` ships with the release.
8. **RPC.** A dedicated RPC endpoint for the dapp: the public one stalls on large batches and its rate-limit page breaks
   CORS in browsers.

## Launch day

1. `TREASURY=<Safe> PARAMS=deploy/params.mainnet.json npx hardhat run scripts/deploy.js --network robinhood` with a
   `DEPLOYER_KEY` holding ~0.01 ETH (the deploy is 37 transactions, ~21M gas: ~0.0011 ETH at 0.05 gwei plus the L1
   data fee). The script runs the preflight itself and refuses on any problem. It deploys eight contracts and the
   timelock, pauses the summoning (`pausedAtLaunch`), sets the guardian and hands ownership over. Commit
   `deployments/robinhood.json`.
2. `NET=robinhood node scripts/verify-launch.js`: every contract owned by the timelock, the Safe proposes and executes,
   the deployer holds nothing, guardian = treasury = stream pourer = Safe, minters = Mine, Workshop, Alchemists and Souls
   only, Mine/Workshop/Souls/Stream open and Alchemists paused, constants as in the profile. It must end with "all
   checks passed". The explorer is https://robinhoodchain.blockscout.com (explorer.mainnet.chain.robinhood.com redirects
   there but drops the path).
3. `node scripts/build-web.js robinhood`, publish `web/`, open it, make sure the mine is read and the session is running.
4. Start the keeper and the watcher on the VPS (`systemctl enable --now alchemists-keeper alchemists-watch`), then
   `node scripts/watch.js --test-alert` to see the alert arrive. The first tick opens the first minute; after that
   submits tick as well.
5. First hour: 60-second windows and steps up to 3 bits, the threshold leaves 30 bits for its equilibrium within 3–5
   minutes. Watch `status.js`: threshold, unlocks, EMA, pressure, price. Expected: Uncommon…Legendary unlock as the EMA
   grows to 1–4 TH/s, pressure near 1 while the rate stays near K.
6. If something is wrong: the guardian (Safe) calls `pause()` on `Mine` and `Workshop`. Reveals and ticks keep working,
   no money moves. Unpausing goes through the timelock, 48 hours.

## The Cauldron's stream

- The summoning stays paused: `Alchemists` is deployed but inert until the timelock unpauses it for the main act.
- Pours into the stream come only from the Safe: a plain ETH transfer from the Safe to the `Stream` address, or
  `pour()`. A pour needs at least one soul (no weight, no pour). Claims open at the hundredth soul; earlier pours wait.
- A claim costs ~30k gas per unclaimed pour for the first claimer, ~14k after; the dapp splits big racks and falls back
  to `claimUpTo` for one soul with a very long backlog. Never `drain` an epoch before a year has passed; a drained
  epoch is closed for claims.

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
