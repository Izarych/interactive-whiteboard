require('reflect-metadata');
const { ConfigService } = require('@nestjs/config');
const { isEmail } = require('class-validator');
const { MailService } = require('../dist/auth/mail.service');

async function preview() {
  const index = process.argv.indexOf('--to');
  const recipient = index >= 0 ? process.argv[index + 1] : undefined;
  if (!recipient || !isEmail(recipient)) throw new Error('Usage: npm run mail:preview -- --to you@example.com');
  const mail = new MailService(new ConfigService(process.env));
  try { await mail.sendPreview(recipient); console.log(`Preview sent to ${recipient}`); }
  finally { mail.onModuleDestroy(); }
}
preview().catch((error) => { console.error(error.message); process.exitCode = 1; });
