# The keeper and the watcher on two rented boxes

Only what the two processes need goes to a box: `scripts/keeper.js`, `scripts/watch.js`, three ABIs, the deployment
record, a private Node.js in `/opt/alchemists-keeper/node` and two npm packages. No system packages are touched. Box A
runs the keeper, box B the watcher, so one machine keeps an eye on the other.

## Once per box (from the project root on the PC)

```bash
bash keeper-box/push.sh root@BOX robinhood          # copies the bundle, never .env or a key
ssh root@BOX 'cd /opt/alchemists-keeper && bash install.sh'
```

## The keeper's key (box A), put there by the owner

The key never passes through anyone else: this pipes the `MAINNET_KEY` line of the PC's `.env` straight into the box's
`.env` (owned by the `alchemists` user, mode 600).

```bash
grep '^MAINNET_KEY=' /e/SOFT/alchemists/.env | tr -d '\r' | ssh root@BOX_A 'cat >> /opt/alchemists-keeper/.env && chown alchemists /opt/alchemists-keeper/.env && chmod 600 /opt/alchemists-keeper/.env && grep -c "^MAINNET_KEY=" /opt/alchemists-keeper/.env'
```

## After the mainnet deploy

```bash
bash keeper-box/push.sh root@BOX_A robinhood && bash keeper-box/push.sh root@BOX_B robinhood
ssh root@BOX_A 'systemctl enable --now alchemists-keeper'
ssh root@BOX_B 'echo KEEPER_ADDRESS=0x... >> /opt/alchemists-keeper/.env && systemctl enable --now alchemists-watch'
ssh root@BOX_A 'tail -n 5 /var/log/alchemists/keeper.log'   # "tick minute N" every minute
```

Alerts: add `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` or `NTFY_TOPIC` to box B's `.env`, `systemctl restart
alchemists-watch`, then `runuser -u alchemists -- node/bin/node scripts/watch.js --test-alert` from
`/opt/alchemists-keeper` with `NET=robinhood`.

Never send transactions from the keeper wallet elsewhere while the keeper runs: two senders of one wallet clash on
nonces. The Safe's own transactions are paid by its first owner (`scripts/safe-exec.js`).
