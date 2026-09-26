# Mainnet launch: Friday 2026-09-25

Status on 2026-09-24, updated 2026-09-26 for v4. `RUNBOOK.md` has the order of operations; this file is what is done and
what is still open. Mainnet v1-v3 (2026-09-26) ran under a 48-hour timelock; v4 has none.

## Done

- **Code.** Eight contracts plus the timelock (v1-v3), 61 tests green (`npx hardhat test`). A second internal review of
  everything that changed after the first one (Keys, Souls, Stream) found two High and one Medium issue in `Stream`
  and a Low in `Keys`; all fixed with tests (`SECURITY-REVIEW.md`, second part).
- **Mainnet profile rehearsed.** `test/launch.test.js` deploys `deploy/params.mainnet.json` (v4) with a stand-in Safe
  and checks the exact state the runbook asks for: the Safe owns Mine, Workshop, Stream and Kettle and is the admin of
  the collections, pausing and unpausing at once; the collections' owner is their face and holds nothing else; minters
  are Mine, Workshop and Souls only; the migrated balances land; nothing is paused. It also resumes a deploy stopped
  part-way without deploying any contract twice.
- **Preflight.** v4 rules: `governance.mode` must be `"safe"`, `collectionsOwner` the face wallet
  `0x5Ce8fb583fD3583E4cd7BF89f881e011B6ECfcD2`, `withAlchemists` false and `pausedAtLaunch` empty.
- **After the deploy.** `scripts/verify-launch.js` checks all of the above on the live chain: the v4 layout, or the
  timelock layout of the older records (tried on testnet v11).
- **Keeper.** Rotates RPCs after three failed rounds, logs balance and days left. `scripts/watch.js` alerts (Telegram
  or ntfy) on unticked minutes, low keeper balance, a pause, no RPC. VPS kit in `deploy/vps/`, Windows stopgap
  `scripts/run-keeper.ps1 -Net robinhood` and `scripts/run-watch.ps1 -Net robinhood`.
- **Site.** Mainnet RPCs answer the browser with CORS (publicnode, the official one, ordofi; only the official one serves
  log scans); explorer links go to
  https://robinhoodchain.blockscout.com; the stream claim estimates gas and splits big racks.
- **Miner.** Default network is mainnet, README points at `robinhood.json`, `scripts/release-miner.ps1` builds the
  release folder after the deploy.
- **Emergency exit.** Submit fees land in the Safe directly; the Stream gained `rescue` (pause, then the owner returns
  its whole balance to the Safe and it closes; in v4 the owner is the Safe itself, no delay); Mine and Alchemists sweep
  their whole balance. `scripts/emergency.js` writes the Safe batches (pause, rescue, unpause, status): one batch that
  runs at once in v4, schedule and execute through the timelock on the older records; `RUNBOOK.md` has the procedure.
- **Simulations.** Both regimes ran on the mainnet constants, scaled: `SIMULATION.md`.
- **Mixed tiers at the ritual table** (owner's call for the first release): any tiers by recipe, the item's tier drawn from
  the inputs, 5 % break chance per extra tier (20 % at most); chance preview and slot picker on the site, a broken-rite
  scene; checked end to end on a local chain through the site. 70 tests.

- **Owner decisions of 2026-09-25, in the code:** the tier is rolled at reveal, tiers open by finds (25k/50k/100k/150k);
  reveals take `Mine.revealSeed` of the commit's parent block (the old next-minute challenge was predictable: proven on
  testnet); souls weigh 1/4/16/64/256 by rank, named 512, with founders per rank from Adept; seats 3014/1111/833/555/21 +
  21 named; the Kettle pays rent every hour (40 % brew to the Safe, 60 % steam, 1/24 of the pot an hour). Third and fourth
  internal reviews in `SECURITY-REVIEW.md`. 86 tests. Still to do: testnet v13 with the Kettle, keeper box re-push.
- **The Safe is 2-of-2** (owner's decision 2026-09-26: no third owner). Losing either key loses it: keep both seeds on paper in two places.
- **v4, owner's decisions of 2026-09-26, in the code:** no timelock. The Safe `0x08Eb68ca02f6fDBCb2b335c67E14EC053166CC41`
  owns Mine, Workshop, Stream and Kettle and is the admin of the collections (minters, URIs, the workshop, the
  summoner, royalties, the pause on Souls): every change is one Safe transaction, no delay. The collections' `owner()`
  is their OpenSea face, `0x5Ce8fb583fD3583E4cd7BF89f881e011B6ECfcD2`: it deploys the whole set itself from a fresh
  wallet (`scripts/deploy.js` refuses a wallet with any earlier transaction), afterwards may only move `contractURI`,
  and the Safe can reassign it. `Alchemists` stays out until the main act's contract is final. The v3 `Materials`
  balances carry over (`scripts/snapshot-materials.js` writes `deploy/migration.v3.json`, the deploy mints it). A
  stopped deploy finishes with `RESUME=1` from `deployments/<net>.progress.json` and never deploys a contract twice.
  The keeper no longer pays for other players' reveals: `KEEPER_REVEAL=none`.

## Needed from the owner before the deploy

1. **Safe.** A 2-of-3 Safe on Robinhood Chain (chainId 4663), three NEW owner wallets on different devices, never the
   deployer or the keeper. Seeds on paper, in different places. Prove it before the deploy: 0.001 ETH in, then out
   with two signatures. Either in app.safe.global from an owner's wallet, or `NET=robinhood node
   scripts/create-safe.js --owners 0xA,0xB,0xC --threshold 2 --name cauldron` paid by the funded deployer (~0.00002 ETH;
   the deployer holds no power over the Safe). The address goes into `governance.safe` in
   `deploy/params.mainnet.json` and `TREASURY`.
2. **Mainnet ETH.** The keeper's key is `MAINNET_KEY` in `.env` (the owner writes it there, never in chat). v4 is
   deployed by the collections owner wallet: its key goes into `.env` as `NFT_OWNER_KEY` the same way; fund it for the
   deploy and the migration mints and send nothing from it before. Keep 0.03-0.05 ETH of ticks on the keeper (at today's 0.05 gwei a keeper
   ticking every minute, recording reveal seeds and the hourly Kettle uses ~0.35-0.5 ETH a month).
3. ~~The audit decision~~ **Decided 2026-09-24: no external audit.** The launch rests on two internal reviews, 61
   tests and the guardian pause (the Safe can stop submits and crafting at once).
4. ~~Keeper host~~ **Decided: two rented boxes.** Box A runs the keeper, box B the watcher (`keeper-box/README.md`);
   both installed and rehearsed on testnet 2026-09-24 (the keeper ticked every minute ~2-3 s after the boundary). Left:
   the owner pipes `MAINNET_KEY` into box A's `.env` with the one command in that README.
5. **Alerts.** A Telegram bot token and chat id, or an ntfy topic name, in `.env` of the keeper host.
6. **Constants, last call** (immutable after the deploy): corridor 30..43 bits; unlocks at 25,000/50,000/100,000/150,000 finds (decided 2026-09-25, with the tier rolled at reveal);
   `refHashrate` 10 TH/s; `price0` 0.00002 ETH (lowered from 0.0002 on 2026-09-26: about 5 cents), `priceD` 50,000; prima materia 1,000,000; `keyChance` 1 in 65,536 per
   reveal, crafts 1e6..100 by tier; furnace cooldown 10 minutes; stream opens at the 100th soul; the summoning left out (v4; paused in v1-v3).

## v4, in order

1. `TREASURY=0x08Eb68ca02f6fDBCb2b335c67E14EC053166CC41 node scripts/preflight.js deploy/params.mainnet.json` clean.
2. Retire v3 (`RUNBOOK.md`, launch day 1): the Safe pauses it, the finds left are revealed, `scripts/snapshot-materials.js`
   writes `deploy/migration.v3.json`; v3's rescue goes through v3's timelock (48 hours).
3. Deploy from the fresh collections owner wallet (`RUNBOOK.md`, launch day 2):
   `DEPLOY_KEY_NAME=NFT_OWNER_KEY TREASURY=0x08Eb68ca02f6fDBCb2b335c67E14EC053166CC41 PARAMS=deploy/params.mainnet.json MIGRATION=deploy/migration.v3.json npx hardhat run scripts/deploy.js --network robinhood`;
   if it stops part-way, the same command with `RESUME=1`. Commit `deployments/robinhood.json`.
4. `NET=robinhood node scripts/verify-launch.js`: "all checks passed" (`RUNBOOK.md`, launch day 3).
5. Push `deployments/robinhood.json` to both boxes, start the keeper on box A with `KEEPER_REVEAL=none` and the watcher
   on box B (`keeper-box/README.md`), `--test-alert` arrives. The first tick opens the first minute.
6. `node scripts/build-web.js robinhood` (it also points the RPC preconnect in `web/index.html` at the mainnet read
   node), commit, push: the site switches to v4 in 1-2 minutes. One submit from
   the site with a small session wallet to see a find land.
7. A miner release with the v4 record (`scripts/release-miner.ps1`), review the folder, publish the release.
8. The launch post.
9. First hour: `NET=robinhood node scripts/status.js` every 10-15 minutes; the watcher covers the rest.

## Housekeeping, no blocker

- `www.alchemist-mine.com` does not resolve: add it as a second custom domain of the Worker in Cloudflare.
- Contract verification on the explorer after the deploy (owner's decision).
- A dedicated RPC endpoint later: in `scripts/build-web.js` first in `RPCS.robinhood` (writes, nonces, receipts, what
  wallets are offered) and, to take the reads and the log scans too, first in `READ_RPCS.robinhood` and
  `LOG_RPCS.robinhood` (log scans go to `LOG_RPCS` only); and in `RPC_URLS` of the keeper.
- Testnet: the keeper wallet has been empty since 2026-09-23 18:47 UTC; testnet v11 still runs the Stream from before
  the fixes. A v12 testnet deploy of the fixed code is possible any time (it would replace the test kit on wallet 414).
- The gas subsidy in Robinhood Wallet ends on 2026-09-29.
