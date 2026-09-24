#!/usr/bin/env bash
# Runs ON the box as root, from /opt/alchemists-keeper after push.sh copied the files. Installs a private Node.js (no
# system packages touched), the two npm dependencies, a system user and the two systemd units (not started).
set -euo pipefail
cd /opt/alchemists-keeper
if [ ! -x node/bin/node ]; then
  base=https://nodejs.org/dist/latest-v22.x
  file=$(curl -fsSL $base/SHASUMS256.txt | grep -o 'node-v[0-9.]*-linux-x64.tar.xz' | head -1)
  curl -fsSLO "$base/$file"
  curl -fsSL $base/SHASUMS256.txt | grep " $file\$" | sha256sum -c -
  mkdir -p node && tar -xJf "$file" -C node --strip-components=1 && rm -f "$file"
fi
PATH=/opt/alchemists-keeper/node/bin:$PATH npm install --omit=dev --no-audit --no-fund --silent
id alchemists >/dev/null 2>&1 || useradd --system --home-dir /opt/alchemists-keeper --shell /usr/sbin/nologin alchemists
mkdir -p /var/log/alchemists
touch .env && chmod 600 .env
chown -R alchemists:alchemists /opt/alchemists-keeper /var/log/alchemists
cp alchemists-keeper.service alchemists-watch.service /etc/systemd/system/
systemctl daemon-reload
echo "node $(node/bin/node --version), ethers $(node/bin/node -p 'require("ethers").version'); units installed, not started"
