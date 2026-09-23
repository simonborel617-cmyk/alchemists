# Internal security review, 2026-09-16

First pass before the external audit: an independent agent read every contract, the deploy scripts and the tests, looking
for reentrancy, denial of service, overflows, randomness manipulation, MEV, access-control holes, economic exploits and
stuck states. Findings and what was done about them:

| # | Severity | Where | Issue | Status |
|---|---|---|---|---|
| C1 | Critical | `Mine._revealFor` | Minting happened before the queue head moved; a contract miner could re-enter `reveal` from `onERC1155Received` and settle the same find many times, pulling several mythic keys when one dropped | **Fixed**: effects before the mint, `nonReentrant` on `submit` and `reveal`; regression test in `security.test.js` with an attacker contract |
| H1 | High | challenge derived from `blockhash` | The first transaction of a minute picks the `blockhash` and therefore the reveal entropy; grinding of upgrades, types and craft keys | **Mitigated and verified**: on Robinhood Chain `block.number` is the L1 block number and `blockhash` changes every ~12 s (checked against the testnet `l1BlockNumber`), so the first ticker has practically no choice when the keeper ticks at the start of the minute; `findAcc`, an accumulator of every submitted find, is mixed into the challenge. Residual trust in the sequencer equals trust in the network. The keeper is mandatory, see RUNBOOK |
| M1 | Medium | `Mine.submit`, `Alchemists.summon` | A treasury that refuses ETH would have halted the mine | **Fixed**: a failed transfer goes to `escrowed`, the owner collects with `sweepEscrow`; test |
| L1 | Low | `netPressure` | No ceiling, overflow risk after hundreds of overshoot windows | **Fixed**: ceiling x1000; test |
| L2 | Low | price within one block | A submit at exactly the quoted price can revert if another submit landed in the same block | Documented: clients overpay 25 %, the excess is refunded |
| L3 | Low | `Materials.burn` | Minters burn without approval | Intentional; the minter set is minimal and changes only through the timelock |
| L4 | Low | ore is consumed on submit | A funded sybil can shorten a season | Accepted: every submit is proof of work at a rising price |
| I1 | Info | `_tierFor` | A comment about when the extras are read did not match the code | Fixed |
| I2–I6 | Info | fills, zero challenge, FixedMath, `_mint` in ERC-721, pause | Checked, no issues |

The external audit of `Mine`, `Workshop`, `Materials` and `Guarded` remains before mainnet. Tests: 37, `npx hardhat test`.

# Second internal review, 2026-09-24

Scope: everything that changed after the first review: the mythic keys moved into their own ERC-721 (`Keys`, touching
`Mine`, `Workshop`, `Materials`, `Alchemists`), and the new `Souls` and `Stream`, plus the deploy wiring. An independent
agent read the diff and confirmed each finding with a failing test (`test/review2-*.test.js`); the fixes below make
those tests pass. 61 tests, `npx hardhat test`.

| # | Severity | Where | Issue | Status |
|---|---|---|---|---|
| H1 | High | `Stream.pour`, `receive` | Anyone could pour any amount. ~7,000 one-wei pours (about 0.04 ETH of gas) would push every later claim past Nitro's 32M per-transaction cap, for good | **Fixed**: only the pourer (the treasury Safe, set at deploy) or the owner may pour; `claimUpTo(idx, id, maxEpochs)` lets a token advance in bounded steps however long the list grows; tests |
| H2 | High | `Stream.drain` | A drained epoch stayed claimable: a late claimer was paid its drained share again out of later epochs, and another holder's claim then failed | **Fixed**: `drained[epoch]`, claims skip drained epochs, an epoch drains once; test |
| M1 | Medium | `Stream.totalWeight` | The pour summed `weight(id)` over every soul ever sealed, ~7k gas each; past ~4,600 souls the treasury could no longer pour | **Fixed**: `Souls.totalWeight` is kept on seal and release; the pour reads it in O(1); test with 2,500 souls |
| L1 | Low | `Keys._take` | `_safeMint` to a contract miner without an ERC-721 hook reverted its reveal and jammed its queue | **Fixed**: plain `_mint`, as `Souls` and `Alchemists` do; test |
| L2 | Low | `web/app.js` claim | A fixed gas limit ran out after about a week of unclaimed daily pours | **Fixed**: the dapp estimates the gas, splits a large rack into parts that fit, and falls back to `claimUpTo` for one soul |
| L3 | Low | `Stream` claims | A soul held by a contract that cannot take ETH cannot be claimed; the share waits | Accepted and documented: nothing is lost, the soul can move to an address that takes ETH |
| I1 | Info | `claimMany` | A released soul reverted the whole batch | **Fixed**: the weight is checked before `ownerOf` |
| I2 | Info | `Stream.receive` | Pausing did not stop plain-transfer pours | **Fixed**: `whenNotPaused` on `receive` |
| I3 | Info | `Keys` + receiver hooks | A contract could revert in its hook until a preferred key came up | Gone with L1 for keys |
| I4 | Info | `Souls.release` | Trusts the summoner's `from`; a released soul loses its unclaimed stream ETH | For the main-act summoner: pass `msg.sender`, claim before releasing |

Also from this pass: the summoning (`Alchemists`) is deployed paused on mainnet (`pausedAtLaunch` in the profile, enforced
by the preflight); only the timelock can unpause it. Checked and sound: keys never exceed 21 and a burned key is never
minted again; souls burn items all-or-nothing; claims never pay one epoch twice or pay tokens minted after a pour; the
first review's C1, M1 and L1 fixes are intact; minters are exactly Mine, Workshop, Alchemists and Souls, the timelock
owns all eight contracts and the deployer holds no role (`test/launch.test.js`, `scripts/verify-launch.js`).

Claim cost for planning: about 30k gas per epoch for the first claimer of an epoch, about 13-14k for later ones. One
claim covers roughly 1,000 daily pours before the 32M cap; the dapp splits racks at 12M.

No external audit: the owner decided on 2026-09-24 to launch on these two internal reviews and the guardian pause.
