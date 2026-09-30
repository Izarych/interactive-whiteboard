#!/usr/bin/env bash
set -euo pipefail
umask 0077
test -d /var/backups/bluviboard
exec 9>/var/backups/bluviboard/backup.lock
flock -n 9 || exit 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="/var/backups/bluviboard/$stamp"
mkdir "$target"
running=0
if systemctl is-active --quiet bluviboard-api; then running=1; systemctl stop bluviboard-api; fi
trap 'if [[ "$running" == 1 ]]; then systemctl start bluviboard-api; fi' EXIT
runuser -u postgres -- pg_dump --format=custom bluviboard > "$target/database.dump"
tar -C /var/lib/bluviboard -czf "$target/uploads.tar.gz" uploads
cp /etc/bluviboard/server.env "$target/server.env"
chmod -R go-rwx "$target"
find /var/backups/bluviboard -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf -- {} +
echo "Consistent backup saved to $target"
