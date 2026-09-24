# Mainnet launch: Friday 2026-09-25

Status on 2026-09-24. `RUNBOOK.md` has the order of operations; this file is what is done and what is still open.

## Done

- **Code.** Eight contracts plus the timelock, 61 tests green (`npx hardhat test`). A second internal review of
  everything that changed after the first one (Keys, Souls, Stream) found two High and one Medium issue in `Stream`
  and a Low in `Keys`; all fixed with tests (`SECURITY-REVIEW.md`, second part).
- **Mainnet profile rehearsed.** `test/launch.test.js` deploys `deploy/params.mainnet.json` with a stand-in Safe and
  checks the exact state the runbook asks for: the timelock owns all eight contracts, the Safe guards, collects and
  pours, minters are the four game contracts only, the deployer holds nothing, the summoning is paused. The deploy is
  37 transactions, ~21M gas.
- **Preflight.** Refuses only for the missing Safe address. New rule: the summoning must be in `pausedAtLaunch`.
- **After the deploy.** `scripts/verify-launch.js` checks all of the above on the live chain (tried on testnet v11).
- **Keeper.** Rotates RPCs after three failed rounds, logs balance and days left. `scripts/watch.js` alerts (Telegram
  or ntfy) on unticked minutes, low keeper balance, a pause, no RPC. VPS kit in `deploy/vps/`, Windows stopgap
  `scripts/run-keeper.ps1 -Net robinhood` and `scripts/run-watch.ps1 -Net robinhood`.
- **Site.** Mainnet RPCs answer the browser with CORS (publicnode, the official one, ordofi); explorer links go to
  https://robinhoodchain.blockscout.com; the stream claim estimates gas and splits big racks.
- **Miner.** Default network is mainnet, README points at `robinhood.json`, `scripts/release-miner.ps1` builds the
  release folder after the deploy.
- **Emergency exit.** Submit fees land in the Safe directly; the Stream gained `rescue` (pause, then after the timelock
  delay its whole balance returns to the Safe and it closes); Mine and Alchemists sweep their whole balance.
  `scripts/emergency.js` writes the Safe batches (pause, rescue, unpause, status); `RUNBOOK.md` has the procedure.
- **Simulations.** Both regimes ran on the mainnet constants, scaled: `SIMULATION.md`.

## Needed from the owner before the deploy

1. **Safe.** A 2-of-3 Safe on Robinhood Chain (chainId 4663), three NEW owner wallets on different devices, never the
   deployer or the keeper. Seeds on paper, in different places. Prove it before the deploy: 0.001 ETH in, then out
   with two signatures. Either in app.safe.global from an owner's wallet, or `NET=robinhood node
   scripts/create-safe.js --owners 0xA,0xB,0xC --threshold 2 --name cauldron` paid by the funded deployer (~0.00002 ETH;
   the deployer holds no power over the Safe). The address goes into `governance.safe` in
   `deploy/params.mainnet.json` and `TREASURY`.
2. **Mainnet ETH.** One new wallet deploys and keeps; its key goes into `.env` as `MAINNET_KEY` (the owner writes it
   there, never in chat). Fund it with 0.01 ETH for the deploy plus 0.03-0.05 ETH of ticks (at today's 0.05 gwei a keeper
   ticking every minute uses ~0.19 ETH a month).
3. ~~The audit decision~~ **Decided 2026-09-24: no external audit.** The launch rests on two internal reviews, 61
   tests and the guardian pause (the Safe can stop submits and crafting at once).
4. ~~Keeper host~~ **Decided: two rented boxes.** Box A runs the keeper, box B the watcher (`keeper-box/README.md`);
   both installed and rehearsed on testnet 2026-09-24 (the keeper ticked every minute ~2-3 s after the boundary). Left:
   the owner pipes `MAINNET_KEY` into box A's `.env` with the one command in that README.
5. **Alerts.** A Telegram bot token and chat id, or an ntfy topic name, in `.env` of the keeper host.
6. **Constants, last call** (immutable after the deploy): corridor 30..43 bits; unlocks at 1/2/3/4 TH/s;
   `refHashrate` 10 TH/s; `price0` 0.0002 ETH, `priceD` 50,000; prima materia 1,000,000; `keyChance` 1 in 65,536 per
   reveal, crafts 1e6..100 by tier; furnace cooldown 10 minutes; stream opens at the 100th soul; summoning paused.

## Friday, in order

1. Safe address into the profile, `node scripts/preflight.js deploy/params.mainnet.json` clean.
2. Deploy (`RUNBOOK.md`, launch day 1), commit `deployments/robinhood.json`.
3. `NET=robinhood node scripts/verify-launch.js`: "all checks passed".
4. Push `deployments/robinhood.json` to both boxes, start the keeper on box A and the watcher on box B
   (`keeper-box/README.md`), `--test-alert` arrives. The first tick opens the first minute.
5. `node scripts/build-web.js robinhood`, commit, push: the site switches to mainnet in 1-2 minutes. One submit from
   the site with a small session wallet to see a find land.
6. `scripts/release-miner.ps1 -Version v1.0.0`, review the folder, publish the release.
7. The launch post.
8. First hour: `NET=robinhood node scripts/status.js` every 10-15 minutes; the watcher covers the rest.

## Housekeeping, no blocker

- `www.alchemist-mine.com` does not resolve: add it as a second custom domain of the Worker in Cloudflare.
- Contract verification on the explorer after the deploy (owner's decision).
- A dedicated RPC endpoint later, as the first entry of `RPCS.robinhood` in `scripts/build-web.js` and `RPC_URLS` of
  the keeper.
- Testnet: the keeper wallet has been empty since 2026-09-23 18:47 UTC; testnet v11 still runs the Stream from before
  the fixes. A v12 testnet deploy of the fixed code is possible any time (it would replace the test kit on wallet 414).
- The gas subsidy in Robinhood Wallet ends on 2026-09-29.
