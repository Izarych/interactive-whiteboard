#!/usr/bin/env bash
set -euo pipefail
exec runuser -u bluviboard -- /usr/local/bin/node --env-file=/etc/bluviboard/server.env /opt/bluviboard/current/apps/server/scripts/create-admin.cjs "$@"
