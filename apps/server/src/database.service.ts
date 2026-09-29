import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      connectionTimeoutMillis: 5000,
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
    `);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
