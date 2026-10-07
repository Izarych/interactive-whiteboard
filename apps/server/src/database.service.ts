import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      max: 10,
    });
    this.pool.on('error', (error) => console.error('PostgreSQL connection error:', error.message));
  }

  async onModuleInit() {
    // Initial idempotent schema migration. Future schema changes should be versioned.
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS boards (
        id uuid PRIMARY KEY,
        title varchar(120) NOT NULL,
        document jsonb NOT NULL DEFAULT '{"version":1,"elements":[]}'::jsonb,
        revision integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS boards_updated_at_idx ON boards (updated_at DESC);
      CREATE TABLE IF NOT EXISTS image_assets (
        id uuid PRIMARY KEY,
        storage_provider varchar(10) NOT NULL CHECK (storage_provider IN ('local', 's3')),
        storage_bucket text,
        storage_key text NOT NULL,
        width integer NOT NULL,
        height integer NOT NULL,
        size integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY,
        email varchar(254) NOT NULL UNIQUE,
        password_hash text NOT NULL,
        name varchar(80) NOT NULL,
        avatar_asset_id uuid REFERENCES image_assets(id) ON DELETE SET NULL,
        verified_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS workspace_owners (
        id uuid PRIMARY KEY,
        user_id uuid UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        merged_into_id uuid REFERENCES workspace_owners(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE boards ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES workspace_owners(id) ON DELETE CASCADE;
      ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES workspace_owners(id) ON DELETE CASCADE;
      ALTER TABLE image_assets ADD COLUMN IF NOT EXISTS purpose varchar(16) NOT NULL DEFAULT 'board' CHECK (purpose IN ('board', 'avatar'));
      CREATE INDEX IF NOT EXISTS boards_owner_updated_idx ON boards (owner_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS image_assets_owner_idx ON image_assets (owner_id);
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash char(64) PRIMARY KEY,
        workspace_id uuid NOT NULL REFERENCES workspace_owners(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sessions_workspace_idx ON sessions (workspace_id);
      CREATE TABLE IF NOT EXISTS auth_challenges (
        id uuid PRIMARY KEY,
        email varchar(254) NOT NULL,
        purpose varchar(16) NOT NULL CHECK (purpose IN ('register', 'reset')),
        workspace_id uuid REFERENCES workspace_owners(id) ON DELETE CASCADE,
        code_hash char(64) NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        expires_at timestamptz NOT NULL,
        sent_at timestamptz NOT NULL DEFAULT now(),
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE (email, purpose)
      );
      CREATE TABLE IF NOT EXISTS auth_rate_limits (
        key text PRIMARY KEY,
        count integer NOT NULL,
        expires_at timestamptz NOT NULL
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
      ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
      ALTER TABLE workspace_owners ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
      ALTER TABLE workspace_owners ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
      ALTER TABLE workspace_owners ADD COLUMN IF NOT EXISTS tool_shortcuts jsonb NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
      CREATE TABLE IF NOT EXISTS activity_events (
        id bigserial PRIMARY KEY,
        type varchar(40) NOT NULL,
        workspace_id uuid REFERENCES workspace_owners(id) ON DELETE SET NULL,
        user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS activity_events_date_idx ON activity_events(created_at, type);
      CREATE TABLE IF NOT EXISTS admin_audit (
        id bigserial PRIMARY KEY,
        actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
        action varchar(50) NOT NULL,
        target_id uuid,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async event(type: string, workspaceId: string | null, userId: string | null, client?: PoolClient) {
    const query = (client ?? this.pool).query('INSERT INTO activity_events (type, workspace_id, user_id) VALUES ($1, $2, $3)', [type, workspaceId, userId]);
    if (client) await query;
    else await query.catch((error) => console.error('Activity recording failed:', error.message));
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
