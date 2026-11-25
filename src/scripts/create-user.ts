import 'dotenv/config';

import argon2 from 'argon2';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';

import { pool } from '../infrastructure/database/connection.js';

const roles = ['ADMIN', 'RESPONSABLE', 'SUPERVISOR'] as const;

const userInputSchema = z.object({
  companyId: z.string().trim().uuid(),
  email: z.string().trim().email().max(180).transform(value => value.toLowerCase()),
  fullName: z.string().trim().min(1),
  role: z.enum(roles)
});

async function promptUserDetails(): Promise<z.infer<typeof userInputSchema>> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const companyId = await prompt.question('Company ID: ');
    const email = await prompt.question('Email: ');
    const fullName = await prompt.question('Full name: ');
    const roleInput = await prompt.question(
      'Role [ADMIN/RESPONSABLE/SUPERVISOR] (default ADMIN): '
    );
    const role = roleInput.trim().toUpperCase() || 'ADMIN';
    const result = userInputSchema.safeParse({
      companyId,
      email,
      fullName,
      role
    });

    if (!result.success) {
      throw new Error(result.error.issues.map(issue => issue.message).join('; '));
    }

    return result.data;
  } finally {
    prompt.close();
  }
}

function promptHidden(prompt: string): Promise<string> {
  const input = process.stdin;

  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(
      new Error('La contraseña requiere una terminal interactiva.')
    );
  }

  return new Promise((resolve, reject) => {
    let password = '';
    let finished = false;

    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');

      if (error) {
        reject(error);
      } else {
        resolve(password);
      }
    };

    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish(new Error('Operación cancelada.'));
          return;
        }

        if (character === '\r' || character === '\n') {
          finish();
          return;
        }

        if (character === '\u007f' || character === '\b') {
          password = [...password].slice(0, -1).join('');
        } else if (character >= ' ') {
          password += character;
        }
      }
    };

    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function createUser(): Promise<void> {
  const user = await promptUserDetails();
  const companyResult = await pool.query(
    'SELECT id FROM companies WHERE id = $1',
    [user.companyId]
  );

  if (!companyResult.rowCount) {
    throw new Error('No existe una compañía con ese ID.');
  }

  const password = await promptHidden('Password (input hidden): ');
  const passwordConfirmation = await promptHidden('Confirm password: ');

  if (!password || password.length > 128) {
    throw new Error('La contraseña debe tener entre 1 y 128 caracteres.');
  }

  if (password !== passwordConfirmation) {
    throw new Error('Las contraseñas no coinciden.');
  }

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id
  });
  const result = await pool.query(
    `INSERT INTO users (
       company_id,
       full_name,
       email,
       password_hash,
       role,
       status
     )
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
     ON CONFLICT (company_id, email) DO NOTHING
     RETURNING id`,
    [user.companyId, user.fullName, user.email, passwordHash, user.role]
  );

  if (!result.rowCount) {
    throw new Error('Ya existe un usuario con ese correo en la compañía.');
  }

  console.log(`Usuario creado: ${user.email} (${result.rows[0].id})`);
}

async function main(): Promise<void> {
  try {
    await createUser();
  } catch (error) {
    console.error(
      'Error al crear usuario:',
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();