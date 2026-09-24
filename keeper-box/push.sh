#!/usr/bin/env bash
# From the project root on the PC: copies the keeper bundle to a box (never .env, never a key).
#   bash keeper-box/push.sh root@BOX [robinhood|robinhoodTestnet ...]
set -euo pipefail
host=$1; shift
nets=${*:-robinhood}
stage=$(mktemp -d)
mkdir -p "$stage/scripts" "$stage/deployments"
cp scripts/keeper.js scripts/watch.js "$stage/scripts/"
cp keeper-box/package.json keeper-box/install.sh keeper-box/alchemists-keeper.service keeper-box/alchemists-watch.service "$stage/"
for n in Mine Workshop Alchemists; do mkdir -p "$stage/artifacts/contracts/$n.sol"; cp "artifacts/contracts/$n.sol/$n.json" "$stage/artifacts/contracts/$n.sol/"; done
for net in $nets; do cp "deployments/$net.json" "$stage/deployments/"; done
ssh -o BatchMode=yes "$host" "mkdir -p /opt/alchemists-keeper"
tar -C "$stage" -cf - . | ssh -o BatchMode=yes "$host" "tar -C /opt/alchemists-keeper -xf - && chown -R \$(id -u alchemists 2>/dev/null || echo 0) /opt/alchemists-keeper"
rm -rf "$stage"
echo "pushed to $host:/opt/alchemists-keeper ($nets)"
