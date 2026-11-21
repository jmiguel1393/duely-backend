
import 'dotenv/config';

import argon2 from 'argon2';
import { pool } from '../infrastructure/database/connection.js';

interface InitialAdmin {
  companyName: string;
  companySlug: string;
  fullName: string;
  email: string;
  password: string;
}

function getRequiredEnv(key: string): string {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }

  return value;
}

async function createAdmin(data: InitialAdmin): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const companyResult = await client.query(
      `INSERT INTO companies (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug)
       DO UPDATE SET name = EXCLUDED.name,
                     updated_at = NOW()
       RETURNING id`,
      [data.companyName, data.companySlug]
    );

    const companyId = companyResult.rows[0].id;

    const passwordHash = await argon2.hash(data.password, {
      type: argon2.argon2id
    });

    const userResult = await client.query(
      `INSERT INTO users (
         company_id,
         full_name,
         email,
         password_hash,
         role,
         status
       )
       VALUES ($1, $2, $3, $4, 'ADMIN', 'ACTIVE')
       ON CONFLICT (company_id, email)
       DO NOTHING
       RETURNING id`,
      [
        companyId,
        data.fullName,
        data.email.toLowerCase(),
        passwordHash
      ]
    );

    await client.query('COMMIT');

    console.log(
      userResult.rowCount
        ? `Admin created: ${data.email} (${data.companySlug})`
        : `Admin already exists: ${data.email} (${data.companySlug})`
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function bootstrap(): Promise<void> {
  try {
    const admins: InitialAdmin[] = [
      {
        companyName: getRequiredEnv('COMPANY_A_NAME'),
        companySlug: getRequiredEnv('COMPANY_A_SLUG'),
        fullName: getRequiredEnv('ADMIN_A_NAME'),
        email: getRequiredEnv('ADMIN_A_EMAIL'),
        password: getRequiredEnv('ADMIN_A_PASSWORD')
      },
      {
        companyName: getRequiredEnv('COMPANY_B_NAME'),
        companySlug: getRequiredEnv('COMPANY_B_SLUG'),
        fullName: getRequiredEnv('ADMIN_B_NAME'),
        email: getRequiredEnv('ADMIN_B_EMAIL'),
        password: getRequiredEnv('ADMIN_B_PASSWORD')
      }
    ];

    for (const admin of admins) {
      await createAdmin(admin);
    }

    console.log('Duely initial setup completed.');
  } catch (error) {
    console.error('Seed error:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

bootstrap();
