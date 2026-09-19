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
