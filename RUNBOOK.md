# Mainnet launch runbook, first release

Order of operations and checks. None of this is automated on purpose: every step needs a person with keys.

v4 (owner's decisions of 2026-09-26): no timelock. The Safe owns the game contracts and administers the collections
directly; every change, pause and unpause is one Safe transaction with no delay. The collections' `owner()` is only
their marketplace face. Mainnet v1-v3 (all 2026-09-26) ran under a 48-hour timelock; where this file still names the
timelock, it is about those records.

## The week before

1. **Safe.** Create a Safe 2-of-3 on Robinhood Chain (chainId 4663): in app.safe.global (the network is supported
   officially, transaction service included) or `node scripts/create-safe.js --owners 0xA,0xB,0xC --threshold 2` from
   three owner addresses on different devices; never make the deployer (the collections owner wallet in v4) or the
   keeper an owner. The mainnet Safe is `0x08Eb68ca02f6fDBCb2b335c67E14EC053166CC41` (2-of-2, see the keys below). It is the
   Cauldron treasury, the guardian, the owner of the game contracts and the admin of the collections at once. Write the
   address down. The Safe cycle was rehearsed on the testnet on 2026-09-19 (ninth deployment, Safe `0xc1e3…A140`, then
   behind a timelock): Safe transactions, guardian pause, unpause.
2. **Parameters.** `deploy/params.mainnet.json` (v4): `governance` = `{mode: "safe", safe: <the Safe>, guardian: "safe",
   collectionsOwner: "0x5Ce8fb583fD3583E4cd7BF89f881e011B6ECfcD2"}`, `withAlchemists: false`, `pausedAtLaunch: []`; the
   preflight refuses anything else. `materialsURI` → `https://alchemist-mine.com/metadata/{id}.json` (already set in `params.mainnet.json`).
   Check: `TREASURY=<Safe> node scripts/preflight.js deploy/params.mainnet.json`.
3. **Metadata and art.** `node scripts/metadata.js` (base `https://alchemist-mine.com/metadata/`), publish as static
   files. Open `{id}.json` for 2, 1001 and 2013, `furnace/3.json` and `keys/0.json` in a browser.
4. **Audit.** The owner decided on 2026-09-24 to launch without an external audit. Two internal reviews
   (`SECURITY-REVIEW.md`), every finding closed or accepted, tests green (`npx hardhat test`).
5. **Simulation** with the final constants: `npx hardhat run scripts/simulate.js` in two regimes, a normal season and the
   ceiling with pressure (`CEIL_BITS=16 FARM_MINERS=24 WILLING_X=3`).
6. **Keeper.** The keeper's key is `MAINNET_KEY` in `.env` (the testnet keys stay as they are). v4 is deployed by the
   collections owner wallet (item 9), not by the keeper: the keeper owns nothing, it only ticks. A VPS running `node scripts/keeper.js` and `node scripts/watch.js` under
   systemd (`deploy/vps/README.md` has the whole setup), alerts to Telegram or ntfy on "no tick for 3 minutes", a low
   keeper balance, a pause or no RPC. A tick is ~200-230k gas (the minute's challenge plus the reveal seeds of
   the parent blocks it records; the hourly Kettle tick adds ~150k an hour): at 0.036-0.05 gwei a keeper that ticks every
   minute burns ~0.35-0.5 ETH a month (it wakes right after each minute boundary, so it is nearly always the first to tick,
   busy network or not); start with 0.3 ETH, the watcher warns below 0.05 (the box profile below 0.01). The keeper's
   minute ticks are also what records the reveal seeds: a commit nobody records within ~51 minutes lapses to its worst
   outcome, so a silent keeper in a quiet hour costs players. The keeper
   rotates to the next RPC after three failed rounds and logs its balance and days left every half hour. The keeper wakes right after
   every minute boundary on chain time and fixes the challenge. A player's find is revealed by their next submit or their
   Reveal button. The keeper does not pay for other players' reveals (owner's decision 2026-09-26): the boxes run
   `KEEPER_REVEAL=none`, and a find a miner leaves behind waits for that miner.
7. **Miner release.** After the deploy, `scripts/release-miner.ps1 -Version v1.0.0` rebuilds the exe, gathers
   `hb-miner-linux-x64`, `alchemists-miner.exe`, `deployments/robinhood.json` and `SHA256SUMS` and prints the command
   for a draft release of `alchemists-miner`, with the README covering the preimage, the `miners.txt` format, the submit price and the rule
   "one address, one submit per minute". The mainnet `deployments/robinhood.json` ships with the release.
8. **RPC.** A dedicated RPC endpoint for the dapp: the public one stalls on large batches and its rate-limit page breaks
   CORS in browsers. In `scripts/build-web.js` it goes first in `RPCS.robinhood` (writes, nonces, receipts, and what
   wallets are offered) and, to take the reads and the log scans too, first in `READ_RPCS.robinhood` and
   `LOG_RPCS.robinhood` (log scans go to `LOG_RPCS` only).
9. **Collections owner wallet (v4).** `0x5Ce8fb583fD3583E4cd7BF89f881e011B6ECfcD2` is the collections' face: the wallet
   that signs in to OpenSea and that marketplaces show as `owner()`. It deploys the whole v4 set itself, so it must be
   fresh: `scripts/deploy.js` refuses it if it has ever sent a transaction (a wallet must never show the same collection
   deployed twice; receiving ETH does not count). Its key is `NFT_OWNER_KEY` in `.env`, written there by the owner.
   Fund it for the deploy plus one mint per migrated balance (v3's deploy took ~0.0012 ETH of L2 gas plus the L1 data
   fee). After the deploy it holds only the collections' `owner()`: `setContractURI`, nothing that touches tokens, money
   or rules. The Safe can move that role to another wallet with `reassignOwner`.

## Launch day (v4)

1. **Retire v3.** While `deployments/robinhood.json` is still the v3 record: `NET=robinhood node scripts/emergency.js
   pause` and the Safe signs the batch (guardian pause, instant); reveal what is left (`Mine.reveal` works while
   paused); then `SOURCE=deployments/robinhood.json OUT=deploy/migration.v3.json node scripts/snapshot-materials.js`,
   which refuses an unpaused Mine or unrevealed finds and writes every `Materials` balance. What v3's Kettle and Stream
   hold returns to the Safe only through v3's own timelock: `NET=robinhood node scripts/emergency.js rescue` writes both
   steps now (step 1 queues it, step 2 runs after 48 hours).
2. Deploy:
   `DEPLOY_KEY_NAME=NFT_OWNER_KEY TREASURY=0x08Eb68ca02f6fDBCb2b335c67E14EC053166CC41 PARAMS=deploy/params.mainnet.json MIGRATION=deploy/migration.v3.json npx hardhat run scripts/deploy.js --network robinhood`.
   The script runs the preflight itself and refuses on any problem; it also refuses unless the deployer is the
   collections owner wallet and that wallet has never sent a transaction. It deploys eight contracts (`Materials`,
   `Keys`, `Mine`, `Furnaces`, `Workshop`, `Souls`, `Stream`, `Kettle`; no `Alchemists`, no timelock), points the Mine's
   fees at the Kettle and makes the Kettle the Stream's only pourer, sets the minters (Mine, Workshop, Souls), the
   collection pages and royalties, mints the v3 balances (the deployer is a minter for that and gives it up), sets the
   guardian, hands the game contracts and the collections' admin role to the Safe and keeps only the collections'
   `owner()`. Nothing starts paused. Commit `deployments/robinhood.json` (the v3 record is archived next to it).
   If the run stops part-way, `deployments/robinhood.progress.json` holds every contract, recorded before its deploy is
   sent. Run the same command with `RESUME=1`: it attaches what exists, never deploys a contract twice and repeats only
   the steps that are safe to repeat. A recorded contract with no code stops it: look that transaction up on the
   explorer first. Never delete the progress file: the wallet is no longer fresh, so only `RESUME=1` can finish.
3. `NET=robinhood node scripts/verify-launch.js`: no timelock; the Safe owns Mine, Workshop, Stream and Kettle; the
   collections' `owner()` is `0x5Ce8fb583fD3583E4cd7BF89f881e011B6ECfcD2` and their `admin()` the Safe; guardian = Safe,
   Mine.treasury = Stream.pourer = the Kettle, Kettle.safe = Safe and Kettle.stream = Stream, minters exactly Mine,
   Workshop and Souls (read from the `MinterSet` logs, so it needs a node that serves `eth_getLogs` from block 0; the
   official one does), everything open, constants as in the profile. It must end with "all checks passed". It does not
   read the migration: check a few rows of `deploy/migration.v3.json` with `Materials.balanceOf`. The explorer is https://robinhoodchain.blockscout.com (explorer.mainnet.chain.robinhood.com redirects
   there but drops the path).
4. `node scripts/build-web.js robinhood` (it also points the RPC preconnect in `web/index.html` at the mainnet read
   node), publish `web/`, open it, make sure the mine is read and the session is running.
5. Push the bundle (`bash keeper-box/push.sh root@BOX robinhood`: keeper, watcher, four ABIs, the deployment record),
   the keeper service runs `KEEPER_REVEAL=none`; start the keeper and the watcher on the boxes
   (`systemctl enable --now alchemists-keeper alchemists-watch`), then
   `node scripts/watch.js --test-alert` to see the alert arrive. The first tick opens the first minute; after that
   submits tick as well. The keeper also ticks the Kettle at the top of every hour; its log shows the brew and the pour.
6. First hour: 60-second windows and steps up to 3 bits, the threshold leaves 30 bits for its equilibrium within 3–5
   minutes. Watch `status.js`: threshold, unlocks, EMA, pressure, price. Expected: Uncommon…Legendary unlock at the season's
   2,500th / 5,000th / 10,000th / 15,000th find (`submittedTotal`, `Unlocked` events), pressure near 1 while the rate
   stays near K.
7. If something is wrong: `NET=robinhood node scripts/emergency.js pause` (see Emergency below) pauses Mine, Workshop,
   Souls, Stream and Kettle at once. Reveals and minute ticks keep working; a paused Kettle neither sends the brew nor
   pours, fees wait in it. Unpausing is a Safe transaction too, with no delay.

## The Cauldron's stream

- The summoning is not deployed: `Alchemists`, the main act, comes once its contract is final.
- Pours into the stream come only from the Kettle, once an hour (`Kettle.tick()`, the keeper at the top of the hour,
  anyone may call it): 40 % of the fees that came in go to the Safe, 60 % join the Kettle's pot, and a quarter (a twenty-fourth until 2026-09-26) of
  the pot (at least 0.01 ETH) is poured. A transfer from the Safe to the Stream reverts ("Stream: not pourer"); to add
  steam the Safe calls `Kettle.fund()`. Nothing is poured before the hundredth soul; the steam waits in the Kettle and
  drips from that hour on. `Kettle.pot()` and `Kettle.preview()` show what waits and what the next hour does.
- A claim costs ~30k gas per unclaimed hourly pour for the first claimer, ~13k after; the dapp splits big racks and falls
  back to `claimUpTo` in steps of 300 for a soul with a long backlog. Never `drain` an epoch before a year has passed; a
  drained epoch is closed for claims.

## Emergency: where the ETH is and how it comes out

- **The Kettle** takes every submit fee. Each hour it sends 40 % (the brew) to the Safe and keeps 60 % (the steam) in its
  pot, which drips into the Stream at a quarter an hour (a twenty-fourth until 2026-09-26); modeled at 84-341 ETH at its peak. Its whole balance is
  the exposure: `node scripts/emergency.js status` shows it.
- **The Safe.** It receives the brew every hour. It is a plain Safe: its owners move its ETH anywhere at any time, a
  normal Safe transfer. No game contract holds an allowance on it or can freeze it; a bug in the game
  cannot touch what is already there.
- **The Stream** holds what the Kettle poured and the souls have not claimed yet.
- **The Mine** (and `Alchemists`, once deployed) holds nothing between transactions (fees are forwarded at once, change
  is refunded at once).

When something is wrong (`node scripts/emergency.js` writes each step as a Transaction Builder batch; app.safe.global >
Apps > Transaction Builder > drop the file > Create batch > Send batch > the second owner signs > Execute). In v4 every
step is one direct Safe batch that runs at once; on the timelock records (v1-v3) rescue and unpause are two batches,
schedule now and execute after 48 hours.

1. **Freeze, minutes.** `NET=robinhood node scripts/emergency.js pause`: the Safe pauses Mine, Workshop, Souls, Stream
   and Kettle at once. Submits, crafts, seals, hourly pours and claims stop; minute ticks and reveals keep working.
2. **Pull out, minutes.** `NET=robinhood node scripts/emergency.js rescue` writes one batch: it pauses the Stream and
   the Kettle itself, then `Stream.rescue(<Safe>)`, `Kettle.rescue()`, `Mine.setTreasury(<Safe>)` and
   `Mine.sweepEscrow(<Safe>)`. It returns the Stream's and the Kettle's whole balances and anything in the Mine to the
   Safe, closes the Stream and the Kettle for good (new ones can be deployed after a fix) and points the Mine's fees
   straight at the Safe. A contract that is already closed is left out of the batch.
3. **Move.** From the Safe, anywhere, two signatures.
4. **After a fix.** `NET=robinhood node scripts/emergency.js unpause` (one batch, at once); a rescued stream or kettle
   stays closed.

`NET=robinhood node scripts/emergency.js status` shows pauses and balances at any time. `test/emergency.test.js` runs
the whole sequence on the governed deployment.

The Safe's own keys are the one thing no code can fix. With 2 of 3 owners, lose one and the other two replace it (Safe > Settings >
Owners); lose two and the Safe is gone. With 2 of 2 (the Safe created on 2026-09-24; no third owner, owner's decision
2026-09-26) losing either key loses the Safe, and with it the governance of every contract. Keep each seed phrase on paper in a different place. Before the mainnet deploy,
prove the keys: send 0.001 ETH into the new Safe and send it back out with two signatures.

## The first week

- Twice a day: `status.js`, keeper balance, number of submits, share of reverts in miner logs.
- Do not touch constants without a simulation. Every change: `NET=robinhood node scripts/govern.js print <Contract>
  <fn> '<args>'` prints the Safe's direct call `{to, value, data}` → Safe → in force as soon as the second owner
  executes it, no delay; with a public explanation.
- A second season is a new vein: a new `Mine` deployment with a new reserve, `Materials.setMinter(newMine, true)` and
  `Keys.setMinter(newMine, true)` from the Safe (the collections' admin); the old mine stays with its exhausted ore.

## Never

- Deploy mainnet with the deployer as the Safe or without `materialsURI`: the preflight refuses, do not work around it.
- Deploy the collections from any wallet but the fresh collections owner wallet, or delete
  `deployments/robinhood.progress.json` to start over: a stopped deploy finishes with `RESUME=1`.
- Keep more on the `MAINNET_KEY` wallet than a few weeks of ticks: it owns nothing, and its key lives
  on the keeper host.
- Change `sessionSec`, `oreR0`, `price0`: they are immutable, a second season is a new contract.
