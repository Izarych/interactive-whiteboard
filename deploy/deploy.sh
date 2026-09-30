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
archive="bluviboard-$sha.tar.gz"
url="https://github.com/$REPO/releases/download/deploy-$sha"
work=$(mktemp -d "$BASE/tmp/release.XXXXXX")
trap 'rm -rf "$work"' EXIT
if ! curl --fail --location --retry 2 --silent --show-error "$url/$archive.sha256" -o "$work/$archive.sha256"; then
  echo "Verified release for $sha is not published yet; retrying next minute."
  exit 0
fi
curl --fail --location --retry 3 --silent --show-error "$url/$archive" -o "$work/$archive"
( cd "$work"; sha256sum -c "$archive.sha256" )
mkdir -p "$BASE/releases/$sha"
tar --no-same-owner -xzf "$work/$archive" -C "$BASE/releases/$sha"
actual=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["commit"])' "$BASE/releases/$sha/release.json")
[[ "$actual" == "$sha" ]]
chmod -R o+rX "$BASE/releases/$sha/apps/web/dist"
ln -s "$BASE/releases/$sha" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"
sudo -n /usr/bin/systemctl restart bluviboard-api
healthy=0
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3000/api/health | python3 -c 'import json,sys; assert json.load(sys.stdin).get("commit")==sys.argv[1]' "$sha"; then healthy=1; break; fi
  sleep 2
done
if [[ "$healthy" != 1 ]]; then
  echo "Deployment failed health check; restoring previous release."
  if [[ -n "$current" ]]; then
    ln -s "$current" "$BASE/current.rollback"
    mv -Tf "$BASE/current.rollback" "$BASE/current"
    sudo -n /usr/bin/systemctl restart bluviboard-api
  fi
  exit 1
fi
echo "Deployed $sha successfully."
