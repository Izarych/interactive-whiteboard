const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { mkdir, rm, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const sharp = require('sharp');
const { createApiClient } = require('./http-client.cjs');
const { emailCode, cleanupMail } = require('./mailhog-utils.cjs');

const port = 3103;
const base = `http://localhost:${port}/api`;
const schema = `bb_auth_test_${randomUUID().replaceAll('-', '')}`;
const directory = path.resolve(__dirname, `../.test-data/${schema}`);
const email = `auth-${randomUUID()}@example.test`;
const secondEmail = `auth-${randomUUID()}@example.test`;
const limitedEmail = `auth-${randomUUID()}@example.test`;
const expiredEmail = `auth-${randomUUID()}@example.test`;
const legacyEmail = `legacy-${randomUUID()}@example.test`;
const adminEmail = `admin-${randomUUID()}@example.test`;
const previewEmail = `preview-${randomUUID()}@example.test`;
const password = 'Initial-test-password-123';
let server, connectionString;
let logs = '';

async function start() {
  logs = '';
  server = spawn(process.execPath, ['dist/main.js'], {
    cwd: path.resolve(__dirname, '../apps/server'),
    env: { ...process.env, DATABASE_URL: connectionString, PORT: String(port), AUTH_SECRET: 'test-auth-secret-that-is-at-least-thirty-two-characters',
      WEB_ORIGIN: 'http://localhost:5175', STORAGE_PROVIDER: 'local', STORAGE_LOCAL_PATH: directory,
      SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_SECURE: 'false', LEGACY_OWNER_EMAIL: legacyEmail, COOKIE_SECURE: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (data) => { logs += data; });
  server.stderr.on('data', (data) => { logs += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Auth API exited: ${logs}`);
    try { if ((await fetch(`${base}/health`)).ok && logs.includes('API listening')) return; } catch { /* Wait for server. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Auth API did not start: ${logs}`);
}
async function stop() {
  if (server && server.exitCode === null) { const exit = once(server, 'exit'); server.kill(); await exit; }
}
async function call(client, method, route, body, expected) {
  const result = await client.json(method, route, body);
  assert.equal(result.status, expected, JSON.stringify(result.data));
  return result.data;
}
async function upload(client, png, avatar = false) {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'test.png');
  const response = await client.fetch(avatar ? '/assets/avatar' : '/assets', { method: 'POST', body: form });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

test('auth: guest ownership, registration, mail codes, profile, login merging and password recovery', { timeout: 90000 }, async (t) => {
  if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(__dirname, '../apps/server/.env'));
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  let db;
  const anon = createApiClient(base), a = createApiClient(base), b = createApiClient(base), c = createApiClient(base);
  let guestA, guestB, board, asset, avatar, user;
  const eraserShortcuts = { eraser: { code: 'CapsLock', ctrl: false, alt: false, shift: false, meta: false } };
  const handShortcuts = { hand: { code: 'F1', ctrl: true, alt: false, shift: false, meta: false } };
  const seen = new Set();
  const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#2563eb' } }).png().toBuffer();
  const document = { version: 1, background: { pattern: 'grid', size: 37 }, elements: [] };
  try {
    // A separate schema makes legacy migration tests incapable of claiming real local boards.
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    connectionString = url.toString();
    db = new Pool({ connectionString });
    await start();

    await t.test('require sessions and reject writes from foreign origins', async () => {
      assert.equal((await call(anon, 'GET', '/auth/session', undefined, 200)).kind, 'anonymous');
      await call(anon, 'GET', '/boards', undefined, 401);
      await call(anon, 'POST', '/auth/register', { email, name: 'User', password }, 401);
      const forbidden = await fetch(`${base}/auth/guest`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } });
      assert.equal(forbidden.status, 403);
      const response = await a.json('POST', '/auth/guest');
      guestA = response.data;
      assert.equal(response.status, 200);
      assert.match(response.response.headers.get('set-cookie'), /HttpOnly/);
      assert.match(response.response.headers.get('set-cookie'), /SameSite=Lax/);
      guestB = await call(b, 'POST', '/auth/guest', undefined, 200);
      assert.equal((await call(a, 'POST', '/auth/guest', undefined, 200)).workspaceId, guestA.workspaceId);
      assert.notEqual(guestA.workspaceId, guestB.workspaceId);
      assert.deepEqual(await call(a, 'GET', '/preferences/tools', undefined, 200), { shortcuts: {} });
      await call(a, 'PUT', '/preferences/tools', { shortcuts: eraserShortcuts }, 200);
    });

    await t.test('guests cannot see, edit, delete or embed each other’s boards and images', async () => {
      board = await call(a, 'POST', '/boards', { title: 'Guest drawing' }, 201);
      asset = await upload(a, png);
      document.elements.push({ id: randomUUID(), kind: 'image', assetId: asset.id, x: 30, y: 40, width: 200, height: 100 });
      board = await call(a, 'PUT', `/boards/${board.id}`, { title: board.title, document, revision: 0 }, 200);
      await call(b, 'GET', `/boards/${board.id}`, undefined, 404);
      await call(b, 'PUT', `/boards/${board.id}`, { title: 'Stolen', document: { version: 1, elements: [] }, revision: 1 }, 404);
      await call(b, 'DELETE', `/boards/${board.id}`, undefined, 404);
      await call(b, 'GET', `/assets/${asset.id}`, undefined, 404);
      assert.equal((await fetch(`${base}/assets/${asset.id}`)).status, 401);
      const owned = await call(b, 'POST', '/boards', { title: 'Guest B' }, 201);
      await call(b, 'PUT', `/boards/${owned.id}`, { title: owned.title, document, revision: 0 }, 400);
      await call(b, 'PATCH', '/auth/profile', { name: 'Not registered' }, 401);
      assert.equal((await call(b, 'GET', '/boards', undefined, 200)).length, 1);
    });

    await t.test('send a mail code, keep failed attempts and require confirmation before account creation', async () => {
      avatar = await upload(a, png, true);
      assert.equal(avatar.width, 512);
      assert.equal(avatar.height, 512);
      const pending = await call(a, 'POST', '/auth/register', { email: email.toUpperCase(), name: '  New user  ', password, avatarAssetId: avatar.id }, 201);
      assert.equal(pending.email, email);
      assert.equal((await db.query('SELECT 1 FROM users WHERE email = $1', [email])).rowCount, 0);
      await call(anon, 'POST', '/auth/login', { email, password }, 401);
      await call(a, 'POST', '/auth/register/resend', { challengeId: pending.challengeId }, 429);
      const code = await emailCode(email, seen);
      await call(a, 'POST', '/auth/verify-email', { challengeId: pending.challengeId, code: code === '000000' ? '000001' : '000000' }, 400);
      assert.equal((await db.query('SELECT attempts FROM auth_challenges WHERE id = $1', [pending.challengeId])).rows[0].attempts, 1);
      const oldCookie = a.cookie;
      user = await call(a, 'POST', '/auth/verify-email', { challengeId: pending.challengeId, code }, 200);
      assert.equal(user.kind, 'user');
      assert.equal(user.user.name, 'New user');
      assert.equal(user.user.avatarUrl, avatar.url);
      assert.equal(user.workspaceId, guestA.workspaceId);
      assert.deepEqual(await call(a, 'GET', '/preferences/tools', undefined, 200), { shortcuts: eraserShortcuts });
      assert.notEqual(a.cookie, oldCookie);
      assert.equal((await fetch(`${base}/boards`, { headers: { Cookie: oldCookie } })).status, 401);
      assert.deepEqual((await call(a, 'GET', `/boards/${board.id}`, undefined, 200)).document, document);
      assert.equal((await a.fetch(asset.url)).status, 200);
      assert.equal((await a.fetch(avatar.url)).status, 200);
      assert.equal('password_hash' in user.user, false);
      const stored = (await db.query('SELECT password_hash FROM users WHERE email = $1', [email])).rows[0].password_hash;
      assert.match(stored, /^scrypt\$/);
      assert.equal(stored.includes(password), false);
    });

    await t.test('update profile name and avatar and reject a foreign or non-avatar image', async () => {
      const foreignAvatar = await upload(b, png, true);
      await call(a, 'PATCH', '/auth/profile', { name: 'Changed', avatarAssetId: foreignAvatar.id }, 400);
      await call(a, 'PATCH', '/auth/profile', { name: 'Changed', avatarAssetId: asset.id }, 400);
      const replacement = await upload(a, png, true);
      const profile = await call(a, 'PATCH', '/auth/profile', { name: 'Changed user', avatarAssetId: replacement.id }, 200);
      assert.equal(profile.name, 'Changed user');
      assert.equal(profile.avatarUrl, replacement.url);
      const cleared = await call(a, 'PATCH', '/auth/profile', { name: profile.name, avatarAssetId: null }, 200);
      assert.equal(cleared.avatarUrl, null);
    });

    await t.test('login merges a new guest workspace into the existing user and keeps both sets of images', async () => {
      const guest = await call(c, 'POST', '/auth/guest', undefined, 200);
      await call(c, 'PUT', '/preferences/tools', { shortcuts: handShortcuts }, 200);
      const extra = await call(c, 'POST', '/boards', { title: 'Second guest drawing' }, 201);
      const extraAsset = await upload(c, png);
      const oldCookie = c.cookie;
      const loggedIn = await call(c, 'POST', '/auth/login', { email, password }, 200);
      assert.equal(loggedIn.workspaceId, guestA.workspaceId);
      assert.notEqual(loggedIn.workspaceId, guest.workspaceId);
      assert.deepEqual(await call(c, 'GET', '/preferences/tools', undefined, 200), { shortcuts: eraserShortcuts });
      const list = await call(c, 'GET', '/boards', undefined, 200);
      assert.ok(list.some((item) => item.id === board.id));
      assert.ok(list.some((item) => item.id === extra.id));
      assert.equal((await c.fetch(asset.url)).status, 200);
      assert.equal((await c.fetch(extraAsset.url)).status, 200);
      assert.equal((await fetch(`${base}/boards`, { headers: { Cookie: oldCookie } })).status, 401);
      const pending = await call(b, 'POST', '/auth/register', { email: secondEmail, name: 'Second user', password }, 201);
      await call(b, 'POST', '/auth/verify-email', { challengeId: pending.challengeId, code: await emailCode(secondEmail, seen) }, 200);
      await call(b, 'GET', `/boards/${board.id}`, undefined, 404);
      await call(b, 'GET', `/assets/${asset.id}`, undefined, 404);
      const preferenceGuest = createApiClient(base);
      await call(preferenceGuest, 'POST', '/auth/guest', undefined, 200);
      await call(preferenceGuest, 'PUT', '/preferences/tools', { shortcuts: handShortcuts }, 200);
      await call(preferenceGuest, 'POST', '/auth/login', { email: secondEmail, password }, 200);
      assert.deepEqual(await call(preferenceGuest, 'GET', '/preferences/tools', undefined, 200), { shortcuts: handShortcuts });
    });

    await t.test('enforce code attempt/expiry limits, resend with a new code and bind confirmation to the guest', async () => {
      const limited = createApiClient(base), expired = createApiClient(base);
      await call(limited, 'POST', '/auth/guest', undefined, 200);
      await call(expired, 'POST', '/auth/guest', undefined, 200);
      const pending = await call(limited, 'POST', '/auth/register', { email: limitedEmail, name: 'Limited', password }, 201);
      const originalCode = await emailCode(limitedEmail, seen);
      const wrong = originalCode === '000000' ? '000001' : '000000';
      for (let attempt = 0; attempt < 5; attempt++) await call(limited, 'POST', '/auth/verify-email', { challengeId: pending.challengeId, code: wrong }, 400);
      await call(limited, 'POST', '/auth/verify-email', { challengeId: pending.challengeId, code: originalCode }, 400);
      await db.query('UPDATE auth_challenges SET sent_at = now() - interval \'61 seconds\' WHERE id = $1', [pending.challengeId]);
      const resent = await call(limited, 'POST', '/auth/register/resend', { challengeId: pending.challengeId }, 200);
      assert.notEqual(resent.challengeId, pending.challengeId);
      const replacementCode = await emailCode(limitedEmail, seen);
      await call(limited, 'POST', '/auth/verify-email', { challengeId: pending.challengeId, code: originalCode }, 400);
      await call(expired, 'POST', '/auth/verify-email', { challengeId: resent.challengeId, code: replacementCode }, 400);
      await call(limited, 'POST', '/auth/verify-email', { challengeId: resent.challengeId, code: replacementCode }, 200);
      const expiring = await call(expired, 'POST', '/auth/register', { email: expiredEmail, name: 'Expired', password }, 201);
      const expiredCode = await emailCode(expiredEmail, seen);
      await db.query('UPDATE auth_challenges SET expires_at = now() - interval \'1 second\' WHERE id = $1', [expiring.challengeId]);
      await call(expired, 'POST', '/auth/verify-email', { challengeId: expiring.challengeId, code: expiredCode }, 400);
      assert.equal((await db.query('SELECT id FROM users WHERE email = $1', [expiredEmail])).rowCount, 0);
    });

    await t.test('reset a forgotten password, invalidate all sessions and prevent code replay', async () => {
      const unknown = await call(anon, 'POST', '/auth/forgot-password', { email: `unknown-${randomUUID()}@example.test` }, 200);
      assert.equal('code' in unknown, false);
      const reset = await call(anon, 'POST', '/auth/forgot-password', { email }, 200);
      await call(anon, 'POST', '/auth/forgot-password', { email }, 429);
      const code = await emailCode(email, seen);
      const nextPassword = 'New-test-password-456';
      await call(anon, 'POST', '/auth/reset-password', { challengeId: reset.challengeId, code: code === '000000' ? '000001' : '000000', password: nextPassword }, 400);
      await call(anon, 'POST', '/auth/reset-password', { challengeId: reset.challengeId, code, password: nextPassword }, 204);
      await call(a, 'GET', '/boards', undefined, 401);
      await call(c, 'GET', '/boards', undefined, 401);
      await call(a, 'POST', '/auth/login', { email, password }, 401);
      await call(a, 'POST', '/auth/login', { email, password: nextPassword }, 200);
      assert.deepEqual((await call(a, 'GET', `/boards/${board.id}`, undefined, 200)).document, document);
      await call(anon, 'POST', '/auth/reset-password', { challengeId: reset.challengeId, code, password: nextPassword }, 400);
      assert.equal((await call(b, 'GET', '/auth/session', undefined, 200)).kind, 'user');
    });

    await t.test('claim legacy boards and files only after the configured email is confirmed', async () => {
      const legacy = createApiClient(base);
      const legacyBoardId = randomUUID(), legacyAssetId = randomUUID();
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${legacyAssetId}.png`), png);
      await db.query(`INSERT INTO image_assets (id, storage_provider, storage_key, width, height, size) VALUES ($1, 'local', $2, 200, 100, $3)`, [legacyAssetId, `${legacyAssetId}.png`, png.length]);
      await db.query('INSERT INTO boards (id, title) VALUES ($1, $2)', [legacyBoardId, 'Legacy local board']);
      await call(legacy, 'POST', '/auth/guest', undefined, 200);
      assert.equal((await call(legacy, 'GET', '/boards', undefined, 200)).length, 0);
      const pending = await call(legacy, 'POST', '/auth/register', { email: legacyEmail, name: 'Legacy owner', password }, 201);
      await call(legacy, 'GET', `/boards/${legacyBoardId}`, undefined, 404);
      await call(legacy, 'POST', '/auth/verify-email', { challengeId: pending.challengeId, code: await emailCode(legacyEmail, seen) }, 200);
      assert.equal((await call(legacy, 'GET', `/boards/${legacyBoardId}`, undefined, 200)).title, 'Legacy local board');
      assert.equal((await legacy.fetch(`/assets/${legacyAssetId}`)).status, 200);
      await call(a, 'GET', `/boards/${legacyBoardId}`, undefined, 404);
    });

    await t.test('create administrators only through the server command and deny guest/user access', async () => {
      const command = spawnSync(process.execPath, ['--env-file=.env', 'scripts/create-admin.cjs', '--email', adminEmail, '--name', 'Fixture Administrator'], {
        cwd: path.resolve(__dirname, '../apps/server'), env: { ...process.env, DATABASE_URL: connectionString, ADMIN_PASSWORD: password }, encoding: 'utf8',
      });
      assert.equal(command.status, 0, command.stderr);
      await call(anon, 'GET', '/admin/overview', undefined, 401);
      await call(a, 'GET', '/admin/overview', undefined, 403);
      const attacker = createApiClient(base);
      await call(attacker, 'POST', '/auth/guest', undefined, 200);
      await call(attacker, 'POST', '/auth/register', { email: `privilege-${randomUUID()}@example.test`, name: 'Attack', password, role: 'admin' }, 400);
      await call(attacker, 'GET', '/admin/users', undefined, 403);
      const duplicate = spawnSync(process.execPath, ['--env-file=.env', 'scripts/create-admin.cjs', '--email', email], {
        cwd: path.resolve(__dirname, '../apps/server'), env: { ...process.env, DATABASE_URL: connectionString, ADMIN_PASSWORD: password }, encoding: 'utf8',
      });
      assert.equal(duplicate.status, 1);
      assert.equal((await db.query('SELECT role FROM users WHERE email=$1', [email])).rows[0].role, 'user');
    });

    await t.test('admin analytics, management, guest transfer, image protection and audit log', async () => {
      const admin = createApiClient(base), managed = createApiClient(base), guest = createApiClient(base);
      const logged = await call(admin, 'POST', '/auth/login', { email: adminEmail, password }, 200);
      assert.equal(logged.user.role, 'admin');
      const summary = await call(admin, 'GET', '/admin/overview?days=7', undefined, 200);
      assert.equal(summary.trend.length, 7);
      assert.ok(summary.trend.some((point) => point.users > 0 && point.guests > 0 && point.boards > 0));
      assert.ok(summary.users >= 5 && summary.boards >= 3 && summary.bytes > 0);
      const users = await call(admin, 'GET', `/admin/users?search=${encodeURIComponent(email)}`, undefined, 200);
      assert.ok(users.items.some((item) => item.email === email));
      assert.equal(users.items.some((item) => 'password_hash' in item), false);
      const managedEmail = `managed-${randomUUID()}@example.test`;
      await call(admin, 'POST', '/admin/users', { email: managedEmail, name: 'Managed', password, role: 'admin' }, 400);
      const created = await call(admin, 'POST', '/admin/users', { email: managedEmail, name: 'Managed', password }, 201);
      assert.equal((await db.query('SELECT role FROM users WHERE id=$1', [created.id])).rows[0].role, 'user');
      await call(managed, 'POST', '/auth/login', { email: managedEmail, password }, 200);
      await call(admin, 'PATCH', `/admin/users/${created.id}`, { name: 'Managed changed', role: 'admin' }, 400);
      await call(admin, 'PATCH', `/admin/users/${created.id}`, { name: 'Managed changed' }, 204);
      assert.equal((await call(managed, 'GET', '/auth/session', undefined, 200)).user.name, 'Managed changed');
      const avatarForm = new FormData(); avatarForm.append('file', new Blob([png], { type: 'image/png' }), 'avatar.png');
      const uploaded = await admin.fetch(`/admin/users/${created.id}/avatar`, { method: 'POST', body: avatarForm });
      assert.equal(uploaded.status, 201);
      const managedAvatar = await uploaded.json();
      assert.equal((await managed.fetch(managedAvatar.url)).status, 200);
      await call(admin, 'POST', `/admin/users/${logged.user.id}/block`, { blocked: true }, 400);
      await call(admin, 'DELETE', `/admin/users/${logged.user.id}`, undefined, 400);
      const changedPassword = 'Managed-new-password-123';
      await call(admin, 'POST', `/admin/users/${created.id}/password`, { password: changedPassword }, 204);
      await call(managed, 'GET', '/boards', undefined, 401);
      await call(managed, 'POST', '/auth/login', { email: managedEmail, password: changedPassword }, 200);
      await call(admin, 'POST', `/admin/users/${created.id}/role`, { role: 'admin', password: 'incorrect-password' }, 403);
      await call(managed, 'POST', `/admin/users/${created.id}/role`, { role: 'admin', password: changedPassword }, 403);
      await call(admin, 'POST', `/admin/users/${created.id}/role`, { role: 'admin', password }, 204);
      await call(managed, 'GET', '/boards', undefined, 401);
      const promoted = await call(managed, 'POST', '/auth/admin/login', { email: managedEmail, password: changedPassword }, 200);
      assert.equal(promoted.user.role, 'admin');
      await call(managed, 'GET', '/admin/overview', undefined, 200);
      await call(admin, 'POST', `/admin/users/${created.id}/role`, { role: 'user', password }, 204);
      await call(managed, 'POST', '/auth/admin/login', { email: managedEmail, password: changedPassword }, 403);
      await call(managed, 'POST', '/auth/login', { email: managedEmail, password: changedPassword }, 200);
      await call(admin, 'POST', `/admin/users/${created.id}/block`, { blocked: true }, 204);
      await call(managed, 'POST', '/auth/login', { email: managedEmail, password: changedPassword }, 403);
      await call(admin, 'POST', `/admin/users/${created.id}/block`, { blocked: false }, 204);
      await call(managed, 'POST', '/auth/login', { email: managedEmail, password: changedPassword }, 200);
      await call(admin, 'POST', `/admin/users/${created.id}/revoke-sessions`, undefined, 204);
      await call(managed, 'GET', '/boards', undefined, 401);
      await call(managed, 'POST', '/auth/login', { email: managedEmail, password: changedPassword }, 200);
      const guestSession = await call(guest, 'POST', '/auth/guest', undefined, 200);
      const guestBoard = await call(guest, 'POST', '/boards', { title: 'Guest transfer from admin' }, 201);
      const guestAsset = await upload(guest, png);
      await call(admin, 'POST', `/admin/guests/${guestSession.workspaceId}/block`, { blocked: true }, 204);
      await call(guest, 'GET', '/boards', undefined, 401);
      await call(admin, 'POST', `/admin/guests/${guestSession.workspaceId}/block`, { blocked: false }, 204);
      await call(guest, 'GET', '/boards', undefined, 200);
      await call(admin, 'POST', `/admin/guests/${guestSession.workspaceId}/transfer`, { email: managedEmail }, 204);
      await call(guest, 'GET', '/boards', undefined, 401);
      await call(managed, 'GET', `/boards/${guestBoard.id}`, undefined, 200);
      assert.equal((await managed.fetch(guestAsset.url)).status, 200);
      const preview = await call(admin, 'GET', `/admin/boards/${board.id}`, undefined, 200);
      assert.equal(preview.ownerEmail, email);
      assert.equal((await admin.fetch(asset.url)).status, 200);
      await call(admin, 'DELETE', `/admin/images/${asset.id}`, undefined, 409);
      await call(admin, 'PATCH', `/admin/boards/${board.id}`, { title: 'Admin renamed' }, 204);
      await call(admin, 'POST', `/admin/boards/${board.id}/clear`, undefined, 204);
      const cleared = await call(a, 'GET', `/boards/${board.id}`, undefined, 200);
      assert.equal(cleared.document.elements.length, 0);
      assert.deepEqual(cleared.document.background, document.background);
      await call(admin, 'DELETE', `/admin/images/${asset.id}`, undefined, 204);
      await call(admin, 'DELETE', `/admin/users/${created.id}`, undefined, 204);
      assert.equal((await admin.fetch(managedAvatar.url)).status, 404);
      const images = await call(admin, 'GET', '/admin/images', undefined, 200);
      assert.ok(Array.isArray(images.items));
      const audit = await call(admin, 'GET', '/admin/audit?pageSize=100', undefined, 200);
      assert.ok(audit.items.some((item) => item.action === 'guest_transferred'));
      assert.ok(audit.items.some((item) => item.action === 'users_deleted'));
      assert.equal(JSON.stringify(audit).includes(changedPassword), false);
      await call(admin, 'POST', '/admin/mail/preview', { email: previewEmail }, 204);
      assert.equal(await emailCode(previewEmail, seen), '381924');
    });

    await t.test('persist user/guest sessions across restart, throttle login attempts and log out', async () => {
      await stop(); await start();
      assert.equal((await call(a, 'GET', '/auth/session', undefined, 200)).kind, 'user');
      assert.equal((await call(b, 'GET', '/auth/session', undefined, 200)).kind, 'user');
      await db.query('UPDATE auth_rate_limits SET count = 30, expires_at = now() + interval \'15 minutes\' WHERE key LIKE \'login-ip:%\'');
      await call(anon, 'POST', '/auth/login', { email, password }, 429);
      await call(a, 'POST', '/auth/logout', undefined, 204);
      assert.equal((await call(a, 'GET', '/auth/session', undefined, 200)).kind, 'anonymous');
      await call(a, 'GET', '/boards', undefined, 401);
    });
  } finally {
    await stop();
    await db?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
    for (const address of [email, secondEmail, limitedEmail, expiredEmail, legacyEmail, previewEmail]) await cleanupMail(address);
  }
});
