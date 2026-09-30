#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]]
test -d /etc/ssh/sshd_config.d
install -d -m 700 /root/bluviboard-provision/backups
cp -a /etc/ssh/sshd_config /root/bluviboard-provision/backups/sshd_config
cat > /etc/ssh/sshd_config.d/00-bluviboard-key-auth.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
EOF
sshd -t
systemctl reload ssh
manager=/etc/nginx/ssl_cert_servers/manager.conf
if [[ -f "$manager" ]]; then
  cp -a "$manager" /root/bluviboard-provision/backups/manager.conf
  python3 - "$manager" <<'PY'
import sys
p=sys.argv[1]
s=open(p).read().replace('ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;', 'ssl_protocols TLSv1.2 TLSv1.3;')
open(p,'w').write(s)
PY
  nginx -t
  systemctl reload nginx
fi
sshd -T | awk '$1 == "passwordauthentication" || $1 == "permitrootlogin" || $1 == "pubkeyauthentication"'
