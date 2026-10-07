#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]]
test -d /var/lib/bluviboard
test -d /etc/bluviboard
test -d /etc/systemd/system
test -f /etc/nginx/conf.d/bluviboard.conf
directory=/var/lib/bluviboard/site-files
install -d -m 755 -o bluviboard -g bluviboard "$directory"
for name in robots.txt sitemap.xml; do
  if [[ ! -e "$directory/$name" ]]; then
    source="/opt/bluviboard/current/apps/web/dist/$name"
    test -f "$source"
    install -m 644 -o bluviboard -g bluviboard "$source" "$directory/$name"
  fi
done
if ! grep -Fxq 'Allow: /api/auth/session$' "$directory/robots.txt"; then
  cp -p "$directory/robots.txt" "/etc/bluviboard/robots-before-session-$(date -u +%Y%m%dT%H%M%SZ).txt"
  printf '\nAllow: /api/auth/session$\n' >> "$directory/robots.txt"
fi
if grep -q '^SITE_FILES_PATH=' /etc/bluviboard/server.env; then
  grep -Eq '^SITE_FILES_PATH="?/var/lib/bluviboard/site-files"?$' /etc/bluviboard/server.env
else
  printf '\nSITE_FILES_PATH=/var/lib/bluviboard/site-files\n' >> /etc/bluviboard/server.env
fi
install -d -m 755 /etc/systemd/system/bluviboard-api.service.d
python3 - <<'PY'
from pathlib import Path
from datetime import datetime, timezone
import subprocess

override = Path('/etc/systemd/system/bluviboard-api.service.d/site-files.conf')
content = '[Service]\nReadWritePaths=/var/lib/bluviboard/site-files\n'
if override.exists() and override.read_text() != content:
    raise SystemExit('Existing site-files service override requires manual review')
override.write_text(content)

config = Path('/etc/nginx/conf.d/bluviboard.conf')
original = config.read_text()
updated = original
for name in ('robots.txt', 'sitemap.xml'):
    previous = 'location = /%s { try_files $uri =404; }' % name
    replacement = 'location = /%s { alias /var/lib/bluviboard/site-files/%s; }' % (name, name)
    if replacement not in updated:
        if previous not in updated:
            raise SystemExit('Existing %s Nginx location requires manual review' % name)
        updated = updated.replace(previous, replacement, 1)
if updated != original:
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    Path('/etc/bluviboard/nginx-before-site-files-%s.conf' % stamp).write_text(original)
    config.write_text(updated)
    if subprocess.run(['nginx', '-t']).returncode:
        config.write_text(original)
        raise SystemExit('Nginx validation failed; previous configuration restored')
PY
nginx -t
systemctl daemon-reload
systemctl reload nginx
echo 'Persistent site files are ready; the next API restart uses the writable directory.'
