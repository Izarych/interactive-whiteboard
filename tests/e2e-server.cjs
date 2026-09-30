const { Pool } = require('pg');
const path = require('node:path');

async function start() {
  const schema = process.env.BB_E2E_SCHEMA;
  if (!/^bb_e2e_test_[a-f0-9]{32}$/.test(schema ?? '')) throw new Error('Invalid browser test schema');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`); }
  finally { await pool.end(); }
  require(path.resolve(__dirname, '../apps/server/dist/main.js'));
}

start().catch((error) => { console.error(error.message); process.exitCode = 1; });
