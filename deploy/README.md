# Production deployment

Target: Ubuntu 24.04, Node.js 24.15, PostgreSQL 16, Nginx, systemd.

## Layout

- `/opt/bluviboard/releases/<commit>` — production builds of CI-verified commits.
- `/opt/bluviboard/current` — active release symlink.
- `/etc/bluviboard/server.env` — production secrets (root:bluviboard, 0640), excluded from Git.
- `/var/lib/bluviboard/uploads` — private image storage; served only through authenticated API.
- `/var/backups/bluviboard` — root-only daily database/images/configuration backups, retained 14 days.

The API runs as `bluviboard`, binds `127.0.0.1:3000`, and has systemd filesystem/resource isolation.
PostgreSQL is accessible only locally. The app role has no superuser/role/database creation privileges.

## Initial provisioning

Upload deployment files into a root-only directory on the server. Optional `private.env` contains
SMTP credentials; it must never be committed. Run as root:

```sh
bash bootstrap.sh
bash tls.sh your-contact@example.com
bash harden-host.sh
```

`tls.sh` requires `bluviboard.ru` DNS A to point at the server. Certbot renews the certificate automatically.
Existing ISPmanager sites/mail services are preserved. SSH password login is disabled after key access is verified.

## Automatic deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`:

1. Locked dependency installation and vulnerability audit.
2. Build, integration tests with PostgreSQL/MailHog, and browser tests.
3. Production Linux archive retained in GitHub Actions artifacts for diagnostics.
4. A successful completed CI run authorizes that exact commit for deployment.

The server polls every minute using `bluviboard-deploy.timer`. It checks the latest push CI run for
the exact current `main` commit, fetches that commit, installs locked dependencies, repeats the audit,
and builds under the unprivileged deploy user with a bounded Node heap. It then atomically switches
the symlink, restarts the API, and checks the exact commit in `/api/health`.
A failed build leaves the active deployment untouched; a failed health check restores the previous release.
No inbound deployment endpoint, root SSH key, or server secret is stored in GitHub Actions.

```sh
systemctl status bluviboard-api bluviboard-deploy.timer
journalctl -u bluviboard-deploy -n 50
systemctl start bluviboard-deploy
```

Deployment creates no Git tags or GitHub Releases and requires only read permission in CI.
The separate `.github/workflows/release.yml` publishes an official GitHub Release only when a
semantic version tag such as `1.0.0` is pushed; its release job has scoped `contents: write` permission.
The `1.0.0` release removes the legacy `deploy-<commit>` prereleases/tags after server migration.

## Administrator

```sh
sudo /opt/bluviboard/ops/admin.sh --email admin@example.com --name "Administrator"
```

The password is requested without echo. Sign in at `https://bluviboard.ru/admin`.

## Mail

The existing server's Exim is used through a trusted loopback relay (`127.0.0.1:25`). TLS is not
disabled for remote SMTP: the plaintext exception is limited to loopback. The mailbox credentials
are stored only in `server.env`; local trusted relay does not require them.
For remote submission switch to the mailbox hostname, port 587, `SMTP_REQUIRE_TLS=true`,
`SMTP_LOCAL_RELAY=false`. DNS A/MX/SPF/DKIM for the sender domain must be valid for Gmail delivery.
The production sender is `no-reply@bluviboard.ru`.

## Backups

`bluviboard-backup.timer` runs daily at 03:15 server time. The API is briefly stopped to obtain a
consistent database/file snapshot, and restarted even on backup failure. Store a copy off-server
for protection against complete server loss.

## Verification scope

Checks cover owner isolation, administrative authorization, role escalation, code expiry/guessing,
session revocation, CSRF origin enforcement, upload validation, headers, TLS and private DB/API ports.
They do not constitute a guarantee against all unknown vulnerabilities or an audit of ISPmanager's code.
