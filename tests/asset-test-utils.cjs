const path = require('node:path');
const { rm } = require('node:fs/promises');
const { Pool } = require('pg');

async function cleanupAssets(ids, directory) {
  if (!ids.length) return;
  if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(__dirname, '../apps/server/.env'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Only assets created by the current test, and only after their boards have been removed.
    const result = await pool.query(`
      DELETE FROM image_assets a WHERE a.id = ANY($1::uuid[]) AND NOT EXISTS (
        SELECT 1 FROM boards b, jsonb_array_elements(b.document->'elements') e WHERE e->>'assetId' = a.id::text
      ) RETURNING storage_provider, storage_key`, [ids]);
    for (const row of result.rows) {
      if (row.storage_provider === 'local') await rm(path.resolve(directory, row.storage_key), { force: true });
    }
  } finally {
    await pool.end();
  }
}

module.exports = { cleanupAssets };
