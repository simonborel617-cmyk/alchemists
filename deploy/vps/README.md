# Keeper and watcher on a VPS

The keeper fixes each minute's challenge right after the minute boundary; without it the mine only moves when someone
submits. The watcher reads the chain on its own and alerts when minutes go unticked, the keeper runs low, a contract is
paused or no RPC answers. Both are small Node processes: the cheapest VPS is enough (1 vCPU, 1 GB, Ubuntu 24.04).

## Once

```bash
sudo apt update && sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo useradd --system --create-home --home-dir /opt/alchemists alchemists
sudo -u alchemists git clone https://github.com/simonborel617-cmyk/alchemists /opt/alchemists
cd /opt/alchemists && sudo -u alchemists npm ci && sudo -u alchemists npx hardhat compile
sudo mkdir -p /var/log/alchemists && sudo chown alchemists /var/log/alchemists
```

`/opt/alchemists/.env`, owned by `alchemists`, `chmod 600`:

```
KEEPER_KEY=0x...            # the keeper's own key: it only ticks, it owns nothing; fund it, never reuse the deployer
# RPC_URLS=https://your-dedicated-endpoint,https://rpc.mainnet.chain.robinhood.com
# alerts, one or both:
# TELEGRAM_BOT_TOKEN=...    # from @BotFather
# TELEGRAM_CHAT_ID=...      # your chat with the bot
# NTFY_TOPIC=...            # a long random name; subscribe to it in the ntfy app
```

`deployments/robinhood.json` must be in the checkout: it is committed right after the mainnet deploy, so `git pull`.

```bash
sudo cp deploy/vps/alchemists-keeper.service deploy/vps/alchemists-watch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alchemists-keeper alchemists-watch
sudo -u alchemists NET=robinhood node scripts/watch.js --test-alert   # the alert reaches your phone
```

## Every day

```bash
tail -n 20 /var/log/alchemists/keeper.log    # "tick minute N", every 30 min a balance line with days left
tail -n 5 /var/log/alchemists/watch.log      # "ok: minute N ..." every hour, ALERT lines otherwise
```

Budget: one tick is about 87,000 gas. At 0.05 gwei that is about 0.19 ETH a month if the keeper ticks every minute
(submits tick as well, so the real figure is lower once people mine). The watcher warns below 0.02 ETH.

## Updates

```bash
cd /opt/alchemists && sudo -u alchemists git pull && sudo -u alchemists npm ci && sudo -u alchemists npx hardhat compile
sudo systemctl restart alchemists-keeper alchemists-watch
```

## On a Windows PC instead (stopgap)

`powershell -ExecutionPolicy Bypass -File scripts\run-keeper.ps1 -Net robinhood` and
`powershell -ExecutionPolicy Bypass -File scripts\run-watch.ps1 -Net robinhood`. The PC must stay on and awake: sleep
stops the keeper, and the watcher on the same PC sleeps with it. A VPS is the real answer.
