# Season simulations, 2026-09-24

`scripts/simulate.js` on the in-process Hardhat network with time travel, with the mainnet profile's dimensionless
constants (price0, priceD, mCap, windows and steps, the estimator) and hashrates, unlocks and the reserve scaled down so
real nonces can be found in JavaScript (floor 12 bits, 300 units of prima materia, K 240/h, unlocks at 2/6/20/60 H/s of
the corrected estimate, keyChance 1 in 64). Rows are every 25 sessions (one session = one minute).

## Normal season

`npx hardhat run scripts/simulate.js`: eight miners from 2^13 to 2^16 hashes a minute, a farm of 2^18 joins at minute 150.

```
simulate: miners 8 (2^13..2^16 hashes/session), farm 1x2^18 at session 150, ore 300, K 240/h, ceil 43 bits, ref 3000 H/s, willing x0
vein exhausted at session 120
┌─────────┬─────────┬───────────────┬─────┬──────────┬─────────┬──────────┬───────┬────────┬─────────────┬────────┬───────┬────────────┐
│ (index) │ session │ thresholdBits │ ore │ halvings │ kWindow │ unlocked │ emaHs │ m      │ netPressure │ priceX │ mints │ priceSkips │
├─────────┼─────────┼───────────────┼─────┼──────────┼─────────┼──────────┼───────┼────────┼─────────────┼────────┼───────┼────────────┤
│ 0       │ 0       │ '12.00'       │ 300 │ 0        │ '8.00'  │ 1        │ 0     │ '1.00' │ '1.000'     │ '1.00' │ 0     │ 0          │
│ 1       │ 25      │ '15.89'       │ 187 │ 0        │ '11.78' │ 5        │ 4159  │ '1.47' │ '1.024'     │ '1.07' │ 113   │ 0          │
│ 2       │ 34      │ '14.36'       │ 150 │ 1        │ '4.55'  │ 5        │ 3296  │ '1.14' │ '1.067'     │ '1.13' │ 150   │ 0          │
│ 3       │ 50      │ '15.07'       │ 107 │ 1        │ '4.34'  │ 5        │ 3180  │ '1.09' │ '1.112'     │ '1.18' │ 193   │ 0          │
│ 4       │ 61      │ '16.51'       │ 73  │ 2        │ '2.63'  │ 5        │ 3724  │ '1.31' │ '1.501'     │ '1.60' │ 227   │ 0          │
│ 5       │ 75      │ '18.26'       │ 43  │ 2        │ '2.65'  │ 5        │ 3754  │ '1.32' │ '2.760'     │ '2.96' │ 257   │ 0          │
│ 6       │ 100     │ '18.12'       │ 15  │ 4        │ '1.00'  │ 5        │ 2243  │ '1.00' │ '4.165'     │ '4.48' │ 285   │ 0          │
│ 7       │ 120     │ '17.21'       │ 0   │ 8        │ '1.00'  │ 5        │ 2799  │ '1.00' │ '8.444'     │ '9.10' │ 300   │ 0          │
└─────────┴─────────┴───────────────┴─────┴──────────┴─────────┴──────────┴───────┴────────┴─────────────┴────────┴───────┴────────────┘
submitted 300, skipped (below threshold) 667, skipped (price) 0, reverted 0, revealed 292, keys 8, upgraded 21
tiers C/U/R/E/L: 161 / 91 / 35 / 4 / 1  (55.1% / 31.2% / 12.0% / 1.4% / 0.3%)
minedTotal 292, burned 0, keys unclaimed 13
wall time 1292s
```

## The ceiling with pressure

`CEIL_BITS=16 FARM_MINERS=24 WILLING_X=3 npx hardhat run scripts/simulate.js`: the corridor ceiling pinned at 16 bits so
the threshold cannot follow the hashrate, a farm split over 24 addresses, miners who stop above three times the start
price.

```
simulate: miners 8 (2^13..2^16 hashes/session), farm 24x2^18 at session 150, ore 300, K 240/h, ceil 16 bits, ref 3000 H/s, willing x3
  revert at session 101: VM Exception while processing transaction: reverted with reason string 'Mine: vein exhausted'
vein exhausted at session 101
┌─────────┬─────────┬───────────────┬─────┬──────────┬─────────┬──────────┬───────┬────────┬─────────────┬────────┬───────┬────────────┐
│ (index) │ session │ thresholdBits │ ore │ halvings │ kWindow │ unlocked │ emaHs │ m      │ netPressure │ priceX │ mints │ priceSkips │
├─────────┼─────────┼───────────────┼─────┼──────────┼─────────┼──────────┼───────┼────────┼─────────────┼────────┼───────┼────────────┤
│ 0       │ 0       │ '12.00'       │ 300 │ 0        │ '8.00'  │ 1        │ 0     │ '1.00' │ '1.000'     │ '1.00' │ 0     │ 0          │
│ 1       │ 25      │ '14.99'       │ 186 │ 0        │ '8.00'  │ 5        │ 2510  │ '1.00' │ '1.401'     │ '1.47' │ 114   │ 0          │
│ 2       │ 33      │ '14.36'       │ 150 │ 1        │ '4.00'  │ 5        │ 2243  │ '1.00' │ '1.621'     │ '1.71' │ 150   │ 0          │
│ 3       │ 50      │ '15.17'       │ 96  │ 1        │ '4.55'  │ 5        │ 3297  │ '1.14' │ '2.741'     │ '2.92' │ 204   │ 4          │
│ 4       │ 60      │ '15.00'       │ 74  │ 2        │ '2.00'  │ 5        │ 2580  │ '1.00' │ '2.630'     │ '2.81' │ 226   │ 25         │
│ 5       │ 75      │ '14.91'       │ 48  │ 2        │ '2.00'  │ 5        │ 1614  │ '1.00' │ '2.469'     │ '2.64' │ 252   │ 50         │
│ 6       │ 100     │ '15.00'       │ 2   │ 7        │ '1.00'  │ 5        │ 1666  │ '1.00' │ '2.527'     │ '2.72' │ 298   │ 88         │
│ 7       │ 101     │ '15.00'       │ 0   │ 8        │ '1.00'  │ 5        │ 1666  │ '1.00' │ '2.527'     │ '2.72' │ 300   │ 88         │
└─────────┴─────────┴───────────────┴─────┴──────────┴─────────┴──────────┴───────┴────────┴─────────────┴────────┴───────┴────────────┘
submitted 300, skipped (below threshold) 422, skipped (price) 88, reverted 1, revealed 296, keys 4, upgraded 14
tiers C/U/R/E/L: 168 / 86 / 38 / 4 / 0  (56.8% / 29.1% / 12.8% / 1.4% / 0.0%)
minedTotal 296, burned 0, keys unclaimed 17
wall time 1379s
```

## Reading

- Both seasons end cleanly when the prima materia runs out (minute 120 and 101 here); K steps down as the reserve
  drains (the `halvings` and `kWindow` columns) and the price multiplier climbs toward the end. No stuck state, no
  revert storm.
- Tier mix at the end: about 55 % Common, 30 % Uncommon, 12 % Rare, 1.4 % Epic, under 0.5 % Legendary.
- At the ceiling the threshold stops at the cap and the price does the work: pressure and the price multiplier rise,
  and miners with a price limit skip (88 skips at 3x). One submit reverted: the known same-block price race (clients
  overpay by 25 % and get the excess back; the simulator does not).
- Keys: 8 and 4 of 21 claimed at the scaled 1-in-64 chance; on mainnet it is 1 in 65,536 per reveal.
