# What is left before mainnet

Status on 2026-09-20. Done and verified on testnet v10: contracts (six, incl. the Keys ERC-721), 38 tests, the dapp
with in-browser CPU/WebGPU mining and the brew scene, the standalone GPU miner release, metadata and art, the rules
page, hosting at alchemist-mine.com, the Safe + timelock governance rehearsal, the rotating public RPC list.

## Blockers: `scripts/preflight.js` refuses a mainnet deploy until these are done

1. **Mainnet Safe.** `deploy/params.mainnet.json` still has `governance.safe = 0x0`. Needs three owner addresses
   from the owner; then `node scripts/create-safe.js --owners a,b,c --threshold 2 --name cauldron` on chain 4663,
   the address goes into `governance.safe` and `TREASURY`. The owner said mainnet instructions come separately.
2. **External audit** of `Mine`, `Workshop`, `Materials`, `Keys`, `Guarded`; every High and Critical closed, tests
   green after the fixes. Internal review exists (`SECURITY-REVIEW.md`), external does not. Prepare the audit
   package: scope, invariants, the internal report, how to run the tests and the simulator, a shortlist of firms that
   work with Arbitrum Orbit chains.
3. **Keeper on a VPS** under a supervisor, a month of gas on `KEEPER_KEY` (~0.05 ETH at 0.01 gwei), alerts on the
   balance and on "no tick for more than 3 minutes". Today the keeper runs on the owner's PC and once ran its wallet
   dry unnoticed; on mainnet that stops the mine for everyone.
4. **Simulation with the final constants**: `npx hardhat run scripts/simulate.js` in two regimes (a normal season and
   a farm at the ceiling) on `params.mainnet.json`, results filed next to the runbook.

## Decisions the owner has to make

5. **Timing.** The gas subsidy in Robinhood Wallet ends on 2026-09-29 (spec §12.7). If launch should ride it, the
   calendar is tight: Safe, audit and keeper hosting all have to land first.
6. **Scope of v1.** `Alchemists` (the summoning, stage two) is deployed together with everything else. Either keep it
   deployed without a UI, or drop it from the mainnet deploy. The summon fee is not chosen yet.
7. **Mainnet constants, last call.** Tier unlocks at 1/2/3/4 TH/s, `refHashrate` 10 TH/s, `price0` 0.0002 ETH,
   ore 1,000,000, `keyChance` 65536. Calibration is verified (the on-chain estimate reads 0.84x real at equilibrium,
   ~1.1x at the floor); these numbers are still editable before the deploy and immutable after.

## Housekeeping, no blocker

8. `www.alchemist-mine.com` does not resolve: add it as a second custom domain of the Worker in Cloudflare
   (Settings → Domains & Routes → Add → Custom domain).
9. Contract verification on the explorer, only after the mainnet deploy (owner's decision).
10. The standalone miner release `v0.1.0-testnet` still carries the v9 deployment file; rebuild against v10 (or, for
    mainnet, against the mainnet deployment) and cut a new release with `SHA256SUMS`.
11. The testnet deployer `0xEd80…2a56` is down to ~0.0057 test ETH; top it up from the faucet before another testnet
    deploy. The keeper wallet `0xA18d…9655` needs periodic top-ups as well.
12. A dedicated RPC endpoint (50–200 $/month) or an own Nitro node (~100 $/month VPS) before mainnet, as a third entry
    in `RPCS.robinhood` in `scripts/build-web.js`; the public list works for now and rotates on failures.

## Launch day and the first week

See `RUNBOOK.md`: deploy with `PARAMS=deploy/params.mainnet.json TREASURY=<safe>`, `build-web`, commit, start the
keeper first, the first tick opens the first minute, then verify on the explorer, twice-daily checks of the keeper
balance, submits and revert share.
