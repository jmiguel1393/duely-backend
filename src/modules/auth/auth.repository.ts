
import { pool } from '../../infrastructure/database/connection.js';

export interface LoginUser {
  id: string;
  company_id: string;
  company_name: string;
  company_slug: string;
  company_status: string;
  full_name: string;
  email: string;
  password_hash: string;
  role: string;
  user_status: string;
}

export interface AuthenticatedUser {
  id: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  fullName: string;
  email: string;
  role: string;
}

export interface SessionUser extends AuthenticatedUser {
  sessionId: string;
}

export async function findUserForLogin(
  companySlug: string,
  email: string
): Promise<LoginUser | null> {
  const result = await pool.query(
    `SELECT
       u.id,
       u.company_id,
       c.name AS company_name,
       c.slug AS company_slug,
       c.status AS company_status,
       u.full_name,
       u.email,
       u.password_hash,
       u.role,
       u.status AS user_status
     FROM users u
     INNER JOIN companies c ON c.id = u.company_id
     WHERE c.slug = $1
       AND LOWER(u.email) = LOWER($2)
     LIMIT 1`,
    [companySlug, email]
  );

  return result.rows[0] ?? null;
}

export async function createSession(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO auth_sessions (
         user_id,
         token_hash,
         expires_at
       ) VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt]
    );

    await client.query(
      `UPDATE users
       SET last_login_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function findSessionByTokenHash(
  tokenHash: string
): Promise<SessionUser | null> {
  const result = await pool.query(
    `SELECT
       s.id AS session_id,
       u.id,
       u.company_id,
       c.name AS company_name,
       c.slug AS company_slug,
       u.full_name,
       u.email,
       u.role
     FROM auth_sessions s
     INNER JOIN users u ON u.id = s.user_id
     INNER JOIN companies c ON c.id = u.company_id
     WHERE s.token_hash = $1
       AND s.expires_at > NOW()
       AND s.revoked_at IS NULL
       AND u.status = 'ACTIVE'
       AND c.status = 'ACTIVE'
     LIMIT 1`,
    [tokenHash]
  );

  const row = result.rows[0];

  if (!row) return null;

  return {
    sessionId: row.session_id,
    id: row.id,
    companyId: row.company_id,
    companyName: row.company_name,
    companySlug: row.company_slug,
    fullName: row.full_name,
    email: row.email,
    role: row.role
  };
}

export async function revokeSession(
  sessionId: string
): Promise<void> {
  await pool.query(
    `UPDATE auth_sessions
     SET revoked_at = NOW()
     WHERE id = $1
       AND revoked_at IS NULL`,
    [sessionId]
  );
}
