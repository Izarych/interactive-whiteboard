#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]]
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
test -d /opt
test -d /etc
test -d /var/lib
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y postgresql postgresql-client certbot curl git jq ca-certificates xz-utils sudo
NODE_VERSION=24.15.0
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --silent --show-error "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" -o "$work/node.tar.xz"
curl --fail --silent --show-error "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$work/checksums"
expected=$(awk -v file="node-v$NODE_VERSION-linux-x64.tar.xz" '$2==file {print $1}' "$work/checksums")
[[ "$expected" =~ ^[0-9a-f]{64}$ ]]
echo "$expected  $work/node.tar.xz" | sha256sum -c -
mkdir -p /usr/local/lib/nodejs
tar -xJf "$work/node.tar.xz" -C /usr/local/lib/nodejs
ln -sf "/usr/local/lib/nodejs/node-v$NODE_VERSION-linux-x64/bin/node" /usr/local/bin/node
ln -sf "/usr/local/lib/nodejs/node-v$NODE_VERSION-linux-x64/bin/npm" /usr/local/bin/npm
id bluviboard >/dev/null 2>&1 || useradd --system --home /var/lib/bluviboard --shell /usr/sbin/nologin bluviboard
id bluviboard-deploy >/dev/null 2>&1 || useradd --system --home /opt/bluviboard --shell /usr/sbin/nologin bluviboard-deploy
install -d -m 755 -o bluviboard-deploy -g bluviboard-deploy /opt/bluviboard /opt/bluviboard/releases /opt/bluviboard/tmp
install -d -m 755 /opt/bluviboard/ops /etc/bluviboard /var/lib/bluviboard/acme
install -d -m 750 -o bluviboard -g bluviboard /var/lib/bluviboard/uploads
install -d -m 755 -o bluviboard -g bluviboard /var/lib/bluviboard/site-files
install -d -m 700 /var/backups/bluviboard
systemctl enable --now postgresql
python3 "$HERE/provision.py" "$HERE/private.env"
install -m 755 "$HERE/deploy.sh" /opt/bluviboard/ops/deploy.sh
install -m 755 "$HERE/backup.sh" /opt/bluviboard/ops/backup.sh
install -m 755 "$HERE/admin.sh" /opt/bluviboard/ops/admin.sh
install -m 644 "$HERE/bluviboard-api.service" /etc/systemd/system/
install -m 644 "$HERE/bluviboard-deploy.service" /etc/systemd/system/
install -m 644 "$HERE/bluviboard-deploy.timer" /etc/systemd/system/
install -m 644 "$HERE/bluviboard-backup.service" /etc/systemd/system/
install -m 644 "$HERE/bluviboard-backup.timer" /etc/systemd/system/
printf '%s\n' 'bluviboard-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart bluviboard-api' > /etc/sudoers.d/bluviboard-deploy
chmod 440 /etc/sudoers.d/bluviboard-deploy
visudo -cf /etc/sudoers.d/bluviboard-deploy
install -m 644 "$HERE/nginx-http.conf" /etc/nginx/conf.d/bluviboard.conf
nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable bluviboard-api
systemctl enable --now bluviboard-deploy.timer bluviboard-backup.timer
echo 'Base infrastructure is ready; request the TLS certificate after DNS propagation.'
