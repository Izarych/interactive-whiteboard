#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
CONTACT=${CERTBOT_EMAIL:-${1:?Pass a certificate contact email}}
certbot certonly --webroot -w /var/lib/bluviboard/acme -d bluviboard.ru --email "$CONTACT" --agree-tos --non-interactive
if [[ ! -f /etc/nginx/conf.d/bluviboard.conf ]] || cmp -s "$HERE/nginx-http.conf" /etc/nginx/conf.d/bluviboard.conf; then
  install -m 644 "$HERE/nginx-https.conf" /etc/nginx/conf.d/bluviboard.conf
else
  echo 'Keeping the server-managed Nginx configuration. Edit /etc/nginx/conf.d/bluviboard.conf on the server when needed.'
fi
nginx -t
systemctl reload nginx
install -d /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' > /etc/letsencrypt/renewal-hooks/deploy/bluviboard-reload
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/bluviboard-reload
systemctl enable --now certbot.timer
