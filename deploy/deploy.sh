#!/usr/bin/env bash
set -euo pipefail
umask 0022
BASE=/opt/bluviboard
REPO=Izarych/interactive-whiteboard
test -d "$BASE/releases"
exec 9>"$BASE/deploy.lock"
flock -n 9 || exit 0
sha=$(git ls-remote "https://github.com/$REPO.git" refs/heads/main | awk '{print $1}')
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 1
current=$(readlink "$BASE/current" 2>/dev/null || true)
[[ "$current" != "$BASE/releases/$sha" ]] || exit 0
work=$(mktemp -d "$BASE/tmp/build.XXXXXX")
trap 'rm -rf "$work"' EXIT
api="https://api.github.com/repos/$REPO/actions/workflows/deploy.yml/runs?head_sha=$sha&branch=main&event=push&per_page=10"
if ! curl --fail --silent --show-error --max-time 30 --retry 2 "$api" -o "$work/ci.json"; then
  echo "CI status is unavailable; leaving the current deployment unchanged."
  exit 0
fi
if ! python3 - "$work/ci.json" "$sha" <<'PY'
import json, sys
runs = [run for run in json.load(open(sys.argv[1])).get('workflow_runs', [])
        if run.get('head_sha') == sys.argv[2] and run.get('head_branch') == 'main'
        and run.get('event') == 'push' and run.get('path') == '.github/workflows/deploy.yml']
latest = max(runs, key=lambda run: run['id'], default={})
sys.exit(0 if latest.get('status') == 'completed' and latest.get('conclusion') == 'success' else 1)
PY
then
  echo "Commit $sha has no successful completed CI run yet; retrying next minute."
  exit 0
fi
echo "Building CI-verified commit $sha without creating a Git tag or release."
git init -q "$work/source"
git -C "$work/source" remote add origin "https://github.com/$REPO.git"
git -C "$work/source" fetch --depth=1 origin "$sha"
git -C "$work/source" checkout -q --detach FETCH_HEAD
[[ $(git -C "$work/source" rev-parse HEAD) == "$sha" ]]
export NODE_OPTIONS=--max-old-space-size=512
( cd "$work/source"; npm ci; npm audit --audit-level=high; npm run build; npm prune --omit=dev )
stage="$work/release"
mkdir -p "$stage/apps/server" "$stage/apps/web" "$stage/packages"
cp "$work/source/package.json" "$work/source/package-lock.json" "$stage/"
cp -a "$work/source/node_modules" "$stage/"
cp -a "$work/source/apps/server/dist" "$work/source/apps/server/scripts" "$work/source/apps/server/package.json" "$stage/apps/server/"
if [[ -d "$work/source/apps/server/node_modules" ]]; then cp -a "$work/source/apps/server/node_modules" "$stage/apps/server/"; fi
cp -a "$work/source/apps/web/dist" "$work/source/apps/web/package.json" "$stage/apps/web/"
cp -a "$work/source/packages/shared" "$stage/packages/"
cp -a "$work/source/deploy" "$stage/"
printf '{"commit":"%s"}\n' "$sha" > "$stage/release.json"
chmod -R o+rX "$stage/apps/web/dist"
latest=$(git ls-remote "https://github.com/$REPO.git" refs/heads/main | awk '{print $1}')
[[ "$latest" == "$sha" ]] || { echo 'Main changed during the build; waiting for the new commit.'; exit 0; }
if [[ -e "$BASE/releases/$sha" ]]; then
  [[ $(readlink "$BASE/current" 2>/dev/null || true) != "$BASE/releases/$sha" ]]
  rm -rf -- "$BASE/releases/$sha"
fi
mv "$stage" "$BASE/releases/$sha"
ln -sfn "$BASE/releases/$sha" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"
sudo -n /usr/bin/systemctl restart bluviboard-api
healthy=0
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; data=sys.stdin.read(); sys.exit(0 if data and json.loads(data).get("commit")==sys.argv[1] else 1)' "$sha" 2>/dev/null; then healthy=1; break; fi
  sleep 2
done
if [[ "$healthy" != 1 ]]; then
  echo 'Deployment failed health check; restoring previous release.'
  if [[ -n "$current" ]]; then
    ln -sfn "$current" "$BASE/current.rollback"
    mv -Tf "$BASE/current.rollback" "$BASE/current"
    sudo -n /usr/bin/systemctl restart bluviboard-api
  fi
  exit 1
fi
echo "Deployed $sha successfully."
