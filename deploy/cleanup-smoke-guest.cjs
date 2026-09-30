const { Pool } = require('pg');
const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id ?? '')) throw new Error('Pass the exact diagnostic guest workspace UUID');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`DELETE FROM workspace_owners w WHERE w.id=$1 AND w.user_id IS NULL AND w.merged_into_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM boards b WHERE b.owner_id=w.id)
  AND NOT EXISTS (SELECT 1 FROM image_assets a WHERE a.owner_id=w.id)`, [id])
  .then((result) => console.log(`Removed diagnostic guest: ${result.rowCount}`))
  .finally(() => pool.end());
