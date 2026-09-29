const { Client } = require('pg');

async function setup() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in apps/server/.env');
  const url = new URL(process.env.DATABASE_URL);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database) throw new Error('DATABASE_URL must include a database name');
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!exists.rowCount) {
      await client.query(`CREATE DATABASE "${database.replaceAll('"', '""')}"`);
      console.log(`Created database ${database}`);
    } else {
      console.log(`Database ${database} already exists`);
    }
  } finally {
    await client.end();
  }
}

setup().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
