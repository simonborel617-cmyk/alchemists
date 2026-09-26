# Internal security review, 2026-09-16

v4 (2026-09-26): no timelock; see README.

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

v4 (2026-09-26): no timelock; see README.

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

Emergency exit (added the same day, `test/emergency.test.js`): `Stream.rescue(to)` runs only through the timelock and
only while the guardian holds the stream paused; it returns the whole balance and closes the stream for good, so a
closed stream cannot be reopened for claims. `Mine.sweepEscrow` and `Alchemists.sweepEscrow` now take the whole
balance, which covers ETH forced into them. Submit fees never rest in the game contracts: they go to the Safe at once.

No external audit: the owner decided on 2026-09-24 to launch on these two internal reviews and the guardian pause.

Mixed tiers at the ritual table (added 2026-09-25, `test/craft-mix.test.js`): `craftItem(kind, ids, amts)` takes the recipe's
categories at any tiers; the counts per tier are packed one byte each into the commit (bounded by the recipe total of five,
so no lane can overflow); at the reveal the rite fails with `mixFailStep x (tiers - 1)` percent (the setter caps the step at 5,
so at most 20 %) and yields nothing, otherwise the tier of one of the five inputs is drawn evenly, then the key roll and the
tier-up at the drawn tier's odds. A one-tier rite never fails and keeps its tier, exactly as before. In expectation a mixed
rite returns the average of the pure rites of its inputs, so mixing cannot cheapen a high tier; it adds variance and burns.
The furnace recipe still demands one tier.

# Third internal review: reveal randomness, 2026-09-25

v4 (2026-09-26): the boxes run `KEEPER_REVEAL=none`, not `stale` (owner's decision: the keeper pays for no one's
reveals), so a find left behind settles when its miner, or anyone calling `Mine.reveal`, reveals it.

**Finding (critical, fixed).** Every reveal (mined finds, refining, rerolls, rites, summons) used the challenge of the
next minute, `keccak(blockhash(block.number - 1), minute, previous challenge, findAcc)`, fixed by the first tick of that
minute. On Robinhood Chain `block.number` is the parent-chain block number and `blockhash(block.number - 1)` is the hash
of the last L2 block before the chain moved to it: it stays the same for ~15 s and anyone can read it. A player acting in
the last seconds of a minute could therefore compute the next challenge, and with it the outcome of a submit or a
Workshop commit before sending it; a farm could also reorder its last submits to choose among several challenges. Proven
on testnet v12 without any special access: 12 of 12 minutes predicted exactly from values read at :58.5. The worst case
was the ritual key at Legendary (1 in 100): a player could wait, commit only in a minute whose outcome was a key, and
take the named keys at will.

**Fix.** `Mine.revealSeed(l1)`: a find, a craft or a summon records its parent-chain block number `l1` and settles with
`keccak(mine, l1, blockhash(l1), blockhash(l1+1), blockhash(l1+2), blockhash(l1+3))`, available once parent block
`l1 + 4` has begun (under a minute). ArbOS writes `blockhash(n)` when the chain moves past parent block n; on a jump of
several numbers it writes the last one with the new hash and fills the skipped ones from it, while the number it jumped
from keeps a stale value, so one of the four values always derives from the last L2 block of parent block `l1`, which is
at or after the commit's own block. The seed is unknown at the commit and, once final, the same for every caller at any
time: no ticker, keeper or player can choose among candidates. A first version of the fix (a seed per minute taken at the
tick) was rejected by the review because a late ticker could still choose among public candidates, one per parent block.
Every `tick()` notes its parent block (every commit ticks first) and records the seeds of noted blocks once final, so a
craft revealed hours later still settles the same way. A commit whose block nobody recorded within the 256-block window
(~51 minutes of 12 s parent blocks with no transaction to the mine or the workshop after it) gets `LOST_SEED` and settles
as its worst outcome: a lapsed find is a plain Common of the type its own hash names, a lapsed craft fails. A re-check
found the first version's fallback (a fixed value known before the commit) gave a second candidate to anyone who could
let a commit lapse, and could even be ground by the choice of nonce or block. The PoW challenge is unchanged.

**Tier at reveal and unlocks by finds** (owner decisions the same day): a hash only has to clear the threshold; the tier
is `FixedMath.workQ8(keccak(r))` against 2/4/7/10 bits plus the pair's supply extra, so P(tier >= k) = 2^-step for every
find whatever the load; tiers open at 25,000/50,000/100,000/150,000 finds, permanently (2,500/5,000/10,000/15,000 since 2026-09-26, set by the Safe on v4). `test/reveal-seed.test.js`
replays type, tier, upgrade and key off-chain for 36 finds (half of them with a hash 8 bits over the bar) and checks the
seed formula, the four-block wait, the recording and the fallback.

**Smaller items from the review, fixed.** A find's tier reads the supply of its pair when it settles, so holding a find
back could pick that moment: `Materials.mintMined` no longer calls the ERC-1155 receiver hook (a contract miner can no
longer refuse a third party's reveal), and the keeper on the boxes runs `KEEPER_REVEAL=stale` (it reveals finds left
behind for 3 minutes). The keeper reveals Workshop commits in batches of 8 (a reroll reveal costs up to ~290k gas). The
site re-checks sealed crafts every 5 s instead of trusting the clock.

**Residual.** The sequencer orders transactions and builds the L2 blocks whose hashes make the seed (as before, H1 of the
first review). A lapse (nobody touching the mine for ~51 minutes after a commit, the keeper included) costs the
committer; the keeper's minute ticks are what prevents it, and the watcher alerts after three silent minutes. Mainnet
data behind the design: 901 consecutive parent transitions (237 jumps of two, and jumps of up to five in a month of
headers) matched the ArbOS blockhash model with no mismatch.

# Fourth internal review: the Kettle and the soul ladder, 2026-09-25

v4 (2026-09-26): no timelock; see README.

Owner decisions the same day: soul weights by rank (Apprentice 1, Adept 4, Master 16, Magister 64, Archmage 256, a named
soul 512) times a founder mark (No.1 of each rank from Adept up weighs 2.0, fading to 1.0 at No.100); seats 3014 / 1111 /
833 / 555 / 21 plus at most 21 named souls (5555); rent every hour through `Kettle`, the Mine's treasury: once per clock
hour anyone ticks it, 40 % of new fees go to the Safe, 60 % join the pot, and a twenty-fourth (a quarter since 2026-09-26) of the pot drips into the
unchanged `Stream`, whose only pourer is the Kettle. Three reviewers (Kettle funds, Souls and Stream, deployment and
operations) and a skeptic per finding: 13 findings confirmed, none that loses or freezes ETH.

**Checked sound.** A 400-step invariant fuzz with force-sent ETH, a Safe that reverts, re-enters or sends back, a Stream
that reverts, refunds or reports closed, rate and stream changes and pauses: `balance >= pot + brewOwed` held at every
step and every wei was accounted for. The guard covers `tick` and `rescue`; a starved tick reverts instead of skipping the
hour. Quotas hold for every rank (named souls are bounded by the 21 keys), ordinals cannot overflow, the weight order
(every named soul above every Archmage, every rank above the best founder of the rank below) holds strictly, and
`totalWeight` only moves on seal and release. The mainnet profile deploys, passes `verify-launch` and runs the emergency
pause, rescue and unpause end to end with every wei landing in the Safe.

**Fixed.**
- Medium: a pot below 0.01 ETH was poured whole, so anyone could make the Kettle open a 1-wei epoch every hour after the
  season (the epoch spam that the pourer lock of review 2 had closed). Every pour is now at least 0.01 ETH and never
  leaves a smaller remainder; a smaller pot waits.
- Medium: the keeper-box bundle lacked the Kettle ABI, so the mainnet keeper would have crashed at start. The bundle
  carries it and the keeper now has the few Kettle functions it needs inline.
- Medium: the runbook still described fees landing in the Safe; it now describes the Kettle, its exposure and its place
  in the emergency steps.
- Low: `Kettle.set` accepts only a contract; `isOpen` is read with a low-level call so a broken stream counts as closed
  instead of blocking the brew; the keeper simulates the tick first, gives it 1M gas (only gas used is paid) and keeps a
  failing hour from stopping the minute ticks and reveals; the watcher alerts when ticks pour nothing, when the Safe
  refuses the brew, and stops repeating "paused" after a rescue; the rescue batch leaves out a contract that is already
  closed; `verify-launch` counts a missing Kettle as a failure; the site treats an unreadable `claimable()` as "rent to
  claim" and keeps Claim open; the public copy no longer says the Safe itself sits behind the timelock (only the game's
  contracts do).

**Residual.** With hourly pours a soul that never claims walks ~13-30k gas per hour of backlog; `claimUpTo` claims in
bounded steps and the site does that on its own. The Kettle is a new contract holding the steam between the fees and the
Stream; it has the same pause-and-rescue exit as the Stream.
