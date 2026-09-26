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
6. **Keeper.** One new mainnet wallet deploys and then keeps: its key is `MAINNET_KEY` in `.env` (mainnet signs with
   nothing else; the testnet keys stay as they are). After the deploy it owns nothing, it only ticks. A VPS running `node scripts/keeper.js` and `node scripts/watch.js` under
   systemd (`deploy/vps/README.md` has the whole setup), alerts to Telegram or ntfy on "no tick for 3 minutes", a low
   keeper balance, a pause or no RPC. A tick is ~200-230k gas (the minute's challenge plus the reveal seeds of
   the parent blocks it records; the hourly Kettle tick adds ~150k an hour): at 0.036-0.05 gwei a keeper that ticks every
   minute burns ~0.35-0.5 ETH a month (it wakes right after each minute boundary, so it is nearly always the first to tick,
   busy network or not); start with 0.3 ETH, the watcher warns below 0.05 (the box profile below 0.01). The keeper's
   minute ticks are also what records the reveal seeds: a commit nobody records within ~51 minutes lapses to its worst
   outcome, so a silent keeper in a quiet hour costs players. The keeper
   rotates to the next RPC after three failed rounds and logs its balance and days left every half hour. The keeper wakes right after
   every minute boundary on chain time and fixes the challenge. A player's find is revealed by their next submit or their
   Reveal button; the boxes run `KEEPER_REVEAL=stale`, so the keeper also reveals the finds a miner left behind after 3
   minutes without a submit (a find's tier reads the supply of its pair when it settles; nobody should pick that moment).
7. **Miner release.** After the deploy, `scripts/release-miner.ps1 -Version v1.0.0` rebuilds the exe, gathers
   `hb-miner-linux-x64`, `alchemists-miner.exe`, `deployments/robinhood.json` and `SHA256SUMS` and prints the command
   for a draft release of `alchemists-miner`, with the README covering the preimage, the `miners.txt` format, the submit price and the rule
   "one address, one submit per minute". The mainnet `deployments/robinhood.json` ships with the release.
8. **RPC.** A dedicated RPC endpoint for the dapp: the public one stalls on large batches and its rate-limit page breaks
   CORS in browsers. In `scripts/build-web.js` it goes first in `RPCS.robinhood` (writes, nonces, receipts, and what
   wallets are offered) and, to take the reads and the log scans too, first in `READ_RPCS.robinhood` and
   `LOG_RPCS.robinhood` (log scans go to `LOG_RPCS` only).

## Launch day

1. `TREASURY=<Safe> PARAMS=deploy/params.mainnet.json npx hardhat run scripts/deploy.js --network robinhood` with a
   `MAINNET_KEY` holding ~0.01 ETH for the deploy plus the keeper's budget (the deploy is ~42 transactions, ~23M gas: ~0.0012 ETH at 0.05 gwei plus the L1
   data fee). The script runs the preflight itself and refuses on any problem. It deploys nine contracts (the Kettle
   included) and the timelock, points the Mine's fees at the Kettle and makes the Kettle the Stream's only pourer, pauses
   the summoning (`pausedAtLaunch`), sets the guardian and hands ownership over. Commit `deployments/robinhood.json`.
2. `NET=robinhood node scripts/verify-launch.js`: every contract owned by the timelock, the Safe proposes and executes,
   the deployer holds nothing, guardian = Safe, Mine.treasury = Stream.pourer = the Kettle, Kettle.safe = Safe and
   Kettle.stream = Stream, minters = Mine, Workshop, Alchemists and Souls only, Mine/Workshop/Souls/Stream/Kettle open
   and Alchemists paused, constants as in the profile. It must end with "all
   checks passed". The explorer is https://robinhoodchain.blockscout.com (explorer.mainnet.chain.robinhood.com redirects
   there but drops the path).
3. `node scripts/build-web.js robinhood` (it also points the RPC preconnect in `web/index.html` at the mainnet read
   node), publish `web/`, open it, make sure the mine is read and the session is running.
4. Push the bundle (`bash keeper-box/push.sh root@BOX robinhood`: keeper, watcher, four ABIs, the deployment record),
   start the keeper and the watcher on the boxes (`systemctl enable --now alchemists-keeper alchemists-watch`), then
   `node scripts/watch.js --test-alert` to see the alert arrive. The first tick opens the first minute; after that
   submits tick as well. The keeper also ticks the Kettle at the top of every hour; its log shows the brew and the pour.
5. First hour: 60-second windows and steps up to 3 bits, the threshold leaves 30 bits for its equilibrium within 3–5
   minutes. Watch `status.js`: threshold, unlocks, EMA, pressure, price. Expected: Uncommon…Legendary unlock at the season's
   25,000th / 50,000th / 100,000th / 150,000th find (`submittedTotal`, `Unlocked` events), pressure near 1 while the rate
   stays near K.
6. If something is wrong: `NET=robinhood node scripts/emergency.js pause` (see Emergency below) pauses Mine, Workshop,
   Souls, Stream, Kettle and the summoning at once. Reveals and minute ticks keep working; a paused Kettle neither sends
   the brew nor pours, fees wait in it. Unpausing goes through the timelock, 48 hours.

## The Cauldron's stream

- The summoning stays paused: `Alchemists` is deployed but inert until the timelock unpauses it for the main act.
- Pours into the stream come only from the Kettle, once an hour (`Kettle.tick()`, the keeper at the top of the hour,
  anyone may call it): 40 % of the fees that came in go to the Safe, 60 % join the Kettle's pot, and a twenty-fourth of
  the pot (at least 0.01 ETH) is poured. A transfer from the Safe to the Stream reverts ("Stream: not pourer"); to add
  steam the Safe calls `Kettle.fund()`. Nothing is poured before the hundredth soul; the steam waits in the Kettle and
  drips from that hour on. `Kettle.pot()` and `Kettle.preview()` show what waits and what the next hour does.
- A claim costs ~30k gas per unclaimed hourly pour for the first claimer, ~13k after; the dapp splits big racks and falls
  back to `claimUpTo` in steps of 300 for a soul with a long backlog. Never `drain` an epoch before a year has passed; a
  drained epoch is closed for claims.

## Emergency: where the ETH is and how it comes out

- **The Kettle** takes every submit fee. Each hour it sends 40 % (the brew) to the Safe and keeps 60 % (the steam) in its
  pot, which drips into the Stream at a twenty-fourth an hour; modeled at 84-341 ETH at its peak. Its whole balance is
  the exposure: `node scripts/emergency.js status` shows it.
- **The Safe.** It receives the brew every hour. It is a plain Safe: its owners move its ETH anywhere at any time, a
  normal Safe transfer, no timelock. No game contract holds an allowance on it or can freeze it; a bug in the game
  cannot touch what is already there.
- **The Stream** holds what the Kettle poured and the souls have not claimed yet.
- **Mine and Alchemists** hold nothing between transactions (fees are forwarded at once, change is refunded at once).

When something is wrong (`node scripts/emergency.js` writes each step as a Transaction Builder batch; app.safe.global >
Apps > Transaction Builder > drop the file > Create batch > Send batch > the second owner signs > Execute):

1. **Freeze, minutes.** `NET=robinhood node scripts/emergency.js pause`: the Safe pauses Mine, Workshop, Souls, Stream,
   Kettle and the summoning at once. Submits, crafts, seals, hourly pours and claims stop; minute ticks and reveals keep
   working.
2. **Pull out, 48 hours.** `NET=robinhood node scripts/emergency.js rescue` writes two batches: step 1 queues it in the
   timelock now, step 2 runs it after the delay. It returns the Stream's and the Kettle's whole balances and anything in
   Mine and Alchemists to the Safe, closes the Stream and the Kettle for good (new ones can be deployed after a fix) and
   points the Mine's fees straight at the Safe. It only executes if step 1 paused the Stream and the Kettle; a contract
   that is already closed is left out of the batch.
3. **Move.** From the Safe, anywhere, two signatures.
4. **After a fix.** `NET=robinhood node scripts/emergency.js unpause` (two batches, 48 hours); the summoning stays
   paused, a rescued stream or kettle stays closed.

`NET=robinhood node scripts/emergency.js status` shows pauses and balances at any time. `test/emergency.test.js` runs
the whole sequence on the governed deployment.

The Safe's own keys are the one thing no code can fix. With 2 of 3 owners, lose one and the other two replace it (Safe > Settings >
Owners); lose two and the Safe is gone. With 2 of 2 (the Safe created on 2026-09-24) losing either key loses the Safe:
add a third owner (Settings > Owners, threshold stays 2) as soon as possible. Keep each seed phrase on paper in a different place. Before the mainnet deploy,
prove the keys: send 0.001 ETH into the new Safe and send it back out with two signatures.

## The first week

- Twice a day: `status.js`, keeper balance, number of submits, share of reverts in miner logs.
- Do not touch constants without a simulation. Every change: `govern.js print` → Safe → 48 hours → `print-execute` → Safe,
  with a public explanation.
- A second season is a new vein: a new `Mine` deployment with a new reserve, `Materials.setMinter(newMine, true)` through
  the timelock; the old mine stays with its exhausted ore.

## Never

- Deploy mainnet with the deployer as the Safe or without `materialsURI`: the preflight refuses, do not work around it.
- Keep more on the `MAINNET_KEY` wallet than a few weeks of ticks: after the deploy it owns nothing, and its key lives
  on the keeper host.
- Change `sessionSec`, `oreR0`, `price0`: they are immutable, a second season is a new contract.
