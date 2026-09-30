#!/usr/bin/env bash
set -euo pipefail
BASE=/opt/bluviboard
sha=${1:?Pass a commit SHA}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
test -d "$BASE/releases"
work=$(mktemp -d "$BASE/tmp/bootstrap.XXXXXX")
trap 'rm -rf "$work"' EXIT
git clone --depth=1 https://github.com/Izarych/interactive-whiteboard.git "$work/source"
[[ $(git -C "$work/source" rev-parse HEAD) == "$sha" ]]
export NODE_OPTIONS=--max-old-space-size=512
( cd "$work/source"; npm ci; npm audit --audit-level=high; npm run build; npm prune --omit=dev )
release="$BASE/releases/bootstrap-$sha"
mkdir -p "$release/apps/server" "$release/apps/web" "$release/packages"
cp "$work/source/package.json" "$work/source/package-lock.json" "$release/"
cp -a "$work/source/node_modules" "$release/"
cp -a "$work/source/apps/server/dist" "$work/source/apps/server/scripts" "$work/source/apps/server/package.json" "$release/apps/server/"
if [[ -d "$work/source/apps/server/node_modules" ]]; then cp -a "$work/source/apps/server/node_modules" "$release/apps/server/"; fi
cp -a "$work/source/apps/web/dist" "$work/source/apps/web/package.json" "$release/apps/web/"
cp -a "$work/source/packages/shared" "$release/packages/"
printf '{"commit":"%s","bootstrap":true}\n' "$sha" > "$release/release.json"
chmod -R o+rX "$release/apps/web/dist"
ln -s "$release" "$BASE/current.bootstrap"
mv -Tf "$BASE/current.bootstrap" "$BASE/current"
sudo -n /usr/bin/systemctl restart bluviboard-api
echo "Initial deployment installed: $sha. The timer will replace it with the verified CI artifact."
