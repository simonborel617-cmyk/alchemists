# Alchemists

Proof-of-work mining of alchemical ingredients and on-chain crafting on Robinhood Chain (Arbitrum Orbit). Miners hash
`sha256(address ‖ nonce ‖ challenge)` for a minute, submit their best hash, and get a random ingredient of a random tier.
Ingredients are refined in furnaces, melted in the crucible and sealed into ritual items; every payment in ETH flows into
the Cauldron, a Safe treasury. The standalone GPU miner lives in
[alchemists-miner](https://github.com/simonborel617-cmyk/alchemists-miner); the dapp in `web/` mines in the browser.

Hardhat 2, Solidity 0.8.26, OpenZeppelin 5, EVM target Cancun.

## Contracts

| Contract | Role |
|---|---|
| `Materials` | ERC-1155: ingredients `1 + type*8 + tier`, potions `1000 + tier`, ritual items `2000 + kind*8 + tier`, mythic keys `3000 + idx`. Tracks `circulating`, `minedTotal`, `burnedIngredients`; holds the list of unclaimed keys. |
| `Mine` | One-minute sessions, a challenge per minute, the best hash is submitted in the next minute and revealed by the challenge after that; threshold corridor 30…43 bits, retarget from a hashrate estimate, rarity unlocks, supply extras per type×tier, ore reserve with halvings, price without a ceiling. |
| `Furnaces` | ERC-721 furnaces with a tier and a cooldown. |
| `Workshop` | Refining (inputs follow the heat of the network), reroll (5/5/5/4/3 out with a category), item crafting (5 % tier up, key roll), potions and furnaces. Commit on send, reveal with the next minute's challenge. |
| `Alchemists` | Summoning from eight items, rank = floor of the average tier, empty enhancer = Common, quotas by rank, cap 5555, named 1/1s through keys, appearance seed, Cauldron weights. Stage two, not part of the first mainnet release. |
| `Guarded` | Guardian pause for submits and crafting; only the owner (the timelock) can unpause. |

Ownership of all five contracts belongs to an OpenZeppelin `TimelockController` whose proposer and executor is the Safe.

## Scope of the first release

Mainnet v1: mining, refining, reroll, ritual item crafting and ETH gathering into the Cauldron (treasury = Safe).
Summoning, appearance and payouts from the Cauldron come in stage two once the core loop shows demand.

## Preimage and work

`sha256(miner(20) ‖ nonce(32, big-endian) ‖ challenge[minute](32))`, 84 bytes. Work is leading zero bits with eight
fractional bits: `65536 − log2Q8(hash)`. The reference implementation is `scripts/lib/work.js`, also used by the tests.

## Commands

```bash
npm install
npx hardhat compile
npx hardhat test          # 37 tests
```

Deploy (the deployer key lives in `.env`, see `.env.example`):

```bash
PARAMS=deploy/params.multi.json TREASURY=0x... npx hardhat run scripts/deploy.js --network robinhoodTestnet
```

Addresses are written to `deployments/<network>.json`. Parameter profiles in `deploy/`: `params.local.json` (tests),
`params.testnet.json` (CPU-friendly floor), `params.solo*.json`, `params.multi.json` (mainnet bit depth scaled to one
card split across eight addresses), `params.rehearsal.json` (multi + Safe governance), `params.mainnet.json`.
A mainnet deploy runs `scripts/preflight.js` first and refuses on any problem.

Keeper (fixes each minute's challenge; players reveal their own finds, or their next submit does):

```bash
NET=robinhoodTestnet node scripts/keeper.js          # KEEPER_REVEAL=none (default) | all | 0xaddr,0xaddr
```

CPU miner for tests (`MINER_KEY`, `THREADS`): `NET=robinhoodTestnet node scripts/miner.js`.
On-chain craft exercise: `NET=robinhoodTestnet node scripts/exercise.js`. State: `NET=robinhoodTestnet node scripts/status.js`.

Windows helpers that run things detached: `scripts/run-testnet.ps1` / `stop-testnet.ps1` (keeper + CPU miner),
`scripts/run-keeper.ps1 -Reveal none`, `scripts/run-fleet.ps1 -Boxes host:port,... -MinersFile .env.miners`
(GPU orchestrator across several cards), `scripts/stop-gpu.ps1`, `scripts/fleet-cap.ps1 -DeadlineUtc <ISO>`
(stops the orchestrator and destroys rented boxes at a deadline), `scripts/run-web.ps1` / `stop-web.ps1` (static server for `web/`).

## Testnet

Robinhood Chain testnet, chainId 46630, explorer `https://explorer.testnet.chain.robinhood.com`.

Current deployment (ninth, 2026-09-19, `deploy/params.rehearsal.json`): the multi-address profile with a test Safe 2-of-3
`0xc1e32A54744Bb075b49512c09Cd075DbeBBFA140` as treasury, timelock proposer/executor and guardian, timelock delay 300 s.

| Contract | Address |
|---|---|
| Materials | `0xF8886f30f89726Fe4012d9d563629A22Dd8105a7` |
| Mine | `0xB289A78c0Eade08D8858Fa68F62949390F075053` |
| Furnaces | `0xA25f5d683E651eAC707c29A43B20BB520a7AAD0f` |
| Workshop | `0xf8E425C4d7619F070dac19efbFeeaBcb940b9fb2` |
| Alchemists | `0x6ED726d42999D767c5d0318B49631A259eF67617` |
| Timelock | `0xC2b68F4c0f03b651637a1C760037BDF664C4d984` |

Earlier deployments are kept as `deployments/robinhoodTestnet.v*.json`. What they taught, in order: retarget windows
aligned to minute boundaries and an empty window easing the threshold by one bit; the minute's threshold snapshotted with
its challenge (`minuteThreshold`) so a submit is checked against the threshold of the minute it was mined in; the hashrate
estimator capping one submission at threshold + 6 bits and dividing by 3.4; the price computed before the retarget inside
`submit`; a K floor of one mint per window; the reveal reentrancy fix from the security review (`SECURITY-REVIEW.md`).

Measured on the testnet with a three-card fleet (~6.5 GH/s, 8 addresses, 2 h 12 min): 688 submits, 0 reverts, threshold
30 → 37 → equilibrium 35–36 bits, tiers C/U/R/E/L 299/247/89/6/3 plus one mythic key, price exactly the ore-pressure
curve, network pressure stayed at 1.0. With an exactly known 1.66 GH/s the on-chain estimate reads 0.84× at equilibrium
and about 1.1× at the corridor floor; `unlockHashrate` and `refHashrate` are therefore approximate within ±30 % and are
kept as designed.

## Season simulator

`npx hardhat run scripts/simulate.js` plays a whole season on the in-process network with time travel: miners are
modelled analytically (exact best-of-N work, realised by a narrow-window nonce search), finds are real. Knobs through
env: `MINERS`, `SESSIONS`, `ORE`, `K_PER_HOUR`, `FARM_AT`, `FARM_MINERS`, `FARM_LOG2`, `BASE_LOG2`, `HOMOG=1`,
`CEIL_BITS`, `REF_HS`, `WILLING_X`. A 300-ore season with eight miners takes about 2.5 minutes.

## GPU mining

`miner/hb-miner.cu` is the CUDA hasher (preimage byte-identical to the contract), `scripts/gpu-miner.py` the
orchestrator: one `hb-miner --persist` process per card (local, `wsl` or `ssh`), `PARAMS <challenge> <floor> <addr1,...>`
per chain minute for up to 32 addresses, `FOUND` lines verified locally, the best hash of every address submitted in the
next minute. `scripts/fake-hb-miner.py` speaks the same protocol on the CPU (`E2E_MINER=gpu node scripts/e2e-local.js`).
Builds: `miner/setup_vast.sh` (one card) and `miner/build-dist.sh` (fat binary sm_75…sm_90 + PTX). An RTX 3060 does
1.68 GH/s; eight addresses in one process cost nothing, eight processes on one card lose about 10 %.

## Safe and governance

Safe 1.3.0 and 1.4.1 contracts are deployed on Robinhood mainnet and testnet, and app.safe.global supports both networks
(`robinhood`, `robinhood-testnet`) including the transaction service. Create a Safe from owner addresses only (no keys,
the deployer pays the gas): `NET=robinhoodTestnet node scripts/create-safe.js --owners 0xA,0xB,0xC --threshold 2 --name cauldron`;
the result lands in `deployments/safe.<net>.<name>.json`. The address then goes into `governance.safe` of the parameter
profile and into `TREASURY` at deploy time.

Any parameter change goes through the timelock: `node scripts/govern.js print <Contract> <fn> <args>` prints `{to, data}`
to paste into Safe → Transaction Builder (timelock address, value 0, custom data); after the delay `print-execute` gives
the second transaction. `schedule` / `execute` / `status` do the same with a local proposer key. A guardian pause is a direct
`pause()` call on the contract from the Safe (no timelock); unpausing goes through the timelock. For rehearsals and
multisigs whose keys live in `.env`: `node scripts/safe-exec.js --safe 0x… --tx '<json from print>'` signs the Safe
transaction hash with the required number of owners and executes it. The full cycle (schedule, guardian pause, unpause,
execute) was rehearsed on the testnet with the ninth deployment.

The `governance` block of a parameter profile: `safe` (address, or `"deployer"` on test networks), `guardian` (address or
`"safe"`), `timelockDelay` (mainnet 172800). `deploy/params.mainnet.json` must get the real Safe address before deploying.

## Dapp

`web/` is a static dapp without a backend: `index.html` + `style.css` in the pixel style of the icons, `app.js`,
`miner.html` (miner guide), `gputest.html` (WebGPU self-test and benchmark). It reads the mine and inventories straight
from the RPC and writes through the wallet. **Mining in the browser** (`sha256.js`, `worker.js`, `gpu.js`): a session
wallet stored in the browser (fund, export, import, move loot to the main wallet) or the user's own wallet confirming
every submit; CPU engine (Web Workers, thread slider) or GPU engine (WebGPU, WGSL SHA-256, intensity slider); limits for
price, budget, rounds, submits, reserve and margin; automatic submits every minute with event parsing. Measured: about
1.3 MH/s per CPU thread in the browser, 2 GH/s on an RTX 40-series card through WebGPU.

Build the ABI bundle and deployment config: `node scripts/build-web.js robinhoodTestnet` (writes `web/abi/`,
`web/deployment.json`, `web/names.json` from `deploy/keys.json`), then serve `web/` with any static server. The public
RPC stalls on big JSON-RPC batches, so the dapp caps batches at 8 calls and caches the workshop tunables.

## Metadata and art

`node scripts/metadata.js --out web/metadata --base https://host/metadata/` writes `{id}.json` for all 266 `Materials`
ids and copies the real icons from `art/final` (`<slug>-t<tier-1>.png`, `key-<i>.png`), falling back to a placeholder
SVG where an icon is missing. `Materials.setURI("https://host/metadata/{id}.json")` goes through the timelock.
Icons are pixel art generated per `ART-BRIEF.md` and normalised by `scripts/pixelize.py` (grid detection or `--grid 64`,
32-colour quantisation, tier auras, `--mythic` for the white key aura).

## Security

`SECURITY-REVIEW.md` lists the internal review findings and their status. The external audit of `Mine`, `Workshop`,
`Materials` and `Guarded` is still ahead of mainnet. `RUNBOOK.md` is the mainnet launch procedure.
