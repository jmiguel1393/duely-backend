import pg from 'pg';
import { env } from '../../config/env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL error:', error);
});

export async function checkDatabaseConnection(): Promise<void> {
  const result = await pool.query('SELECT NOW()');

  console.log('PostgreSQL connected:', result.rows[0].now);
}