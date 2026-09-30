const { Pool } = require('pg');
const { rm } = require('node:fs/promises');

module.exports = async () => {
  const schema = process.env.BB_E2E_SCHEMA;
  if (!/^bb_e2e_test_[a-f0-9]{32}$/.test(schema ?? '')) throw new Error('Invalid browser test schema');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
  finally { await pool.end(); }
  if (process.env.BB_E2E_IMAGE_DIRECTORY) await rm(process.env.BB_E2E_IMAGE_DIRECTORY, { recursive: true, force: true });
};
