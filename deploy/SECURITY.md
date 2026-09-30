# Security verification

The deployment is scoped to BluviBoard and its database/API/web configuration, not a claim of
an exhaustive penetration test of Ubuntu, ISPmanager, Exim, Dovecot or unknown future dependencies.

Implemented controls:

- Dedicated non-root API user, filesystem sandbox, 512 MiB memory limit, bounded SQL statements.
- Dedicated PostgreSQL role without superuser/database/role creation privileges; local-only listener.
- API loopback listener behind Nginx; forwarded IP is overwritten at the trusted proxy boundary.
- Trusted Let's Encrypt TLS, TLS 1.2/1.3, automatic renewal, HSTS, CSP, framing and MIME protections.
- HttpOnly/Secure/SameSite session cookies; server-side random-token hashes and immediate revocation.
- Owner-scoped board/image access, authoritative admin role checks, password-confirmed role changes.
- Administrative role changes revoke target sessions; registration cannot assign roles.
- Administrative login has no registration/guest UI and rejects non-admin credentials on the server.
- Origin/Fetch-Metadata validation; cookie-authenticated writes require Origin in production.
- Login/code rate limits, five code attempts, HMAC code hashes, expiry and resend cooldown.
- Password hashing with salted scrypt; no passwords in audit logs or production releases.
- Upload content validation, decoded-pixel/file limits, PNG normalization, and private image storage.
- Pinned GitHub Actions revisions; lockfile-based installs, vulnerability audit, tests before release.
- No production/SSH secrets in GitHub; artifact checksum/commit verification and health rollback.
- Root-only consistent daily DB/file/config backups with 14-day retention.
- SSH key-only authentication; legacy TLS 1.0/1.1 disabled for the Nginx management endpoint.

Residual operational items:

- Monitor sender-domain A/MX/SPF/DKIM and delivery reputation; external delivery depends on these operational settings.
- Existing hosting-panel/mail/FTP/DNS services retain their independent access surface and maintenance needs.
- Backups on the same disk need an off-server copy to cover total server loss.
- Keep dependencies, OS and server-panel software patched and periodically repeat application security tests.

## Verified deployment, 2026-09-30

- Commit `1e6256926f2484aa24f96e58dadcd7e7961ad4bb` passed GitHub-hosted Linux build, audit, 23 API checks and 11 browser scenarios.
- The release was automatically published and picked up by the server's deployment timer.
- HTTPS on `bluviboard.ru` serves a trusted certificate; `/api/health` reports the exact deployed commit.
- Public-browser smoke confirmed admin login-only UI, secure cookie flags, role denial, hidden-file denial and production Origin checks.
- PostgreSQL and API listeners were verified on 127.0.0.1, and SSH password authentication was verified disabled.
- A consistent database/upload/config backup was created successfully.
- Production SMTP accepted the test message locally, but Gmail rejected the sender `bluviboard-mail.ru` with 550 5.7.26 because SPF/DKIM did not pass.
- The DNS resource was backed up and migrated to the hosting user with all 12 original records preserved; the mail domain `bluviboard.ru` was created with DKIM/DMARC.
- The sender was changed to `no-reply@bluviboard.ru`. Authoritative DNS exposed SPF/DKIM, and Gmail accepted the new test message over verified TLS with `250 2.0.0 OK`.
