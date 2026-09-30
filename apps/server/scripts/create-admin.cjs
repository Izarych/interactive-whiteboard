require('reflect-metadata');
const { randomUUID } = require('node:crypto');
const { Writable } = require('node:stream');
const { createInterface } = require('node:readline');
const { ConfigService } = require('@nestjs/config');
const { isEmail } = require('class-validator');
const { DatabaseService } = require('../dist/database.service');
const { hashPassword } = require('../dist/auth/auth.crypto');

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function password() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('Set ADMIN_PASSWORD for non-interactive use, or run the command in a terminal');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    input.question('Password (at least 8 characters): ', (value) => { muted = false; input.close(); process.stdout.write('\n'); resolve(value); });
    muted = true;
  });
}
async function create() {
  const email = option('--email')?.trim().toLowerCase();
  const name = option('--name')?.trim() || 'Администратор';
  if (!email || !isEmail(email) || !name || name.length > 80) throw new Error('Usage: npm run admin:create -- --email admin@example.com --name Administrator');
  const secret = await password();
  if (secret.length < 8 || secret.length > 128) throw new Error('Password must contain 8–128 characters');
  const db = new DatabaseService(new ConfigService(process.env));
  try {
    await db.onModuleInit();
    const id = randomUUID(), workspace = randomUUID();
    const hash = await hashPassword(secret);
    await db.transaction(async (client) => {
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rowCount) throw new Error('An account with this email already exists; choose a different email for the new administrator');
      await client.query(`INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'admin')`, [id, email, name, hash]);
      await client.query('INSERT INTO workspace_owners (id, user_id) VALUES ($1, $2)', [workspace, id]);
      await client.query(`INSERT INTO admin_audit (action, target_id, details) VALUES ('admin_created_cli', $1, $2::jsonb)`, [id, JSON.stringify({ email, name, source: 'server command' })]);
    });
    console.log(`Administrator created: ${email}. Sign in and open /admin.`);
  } finally { await db.onModuleDestroy(); }
}
create().catch((error) => { console.error(error.message); process.exitCode = 1; });
