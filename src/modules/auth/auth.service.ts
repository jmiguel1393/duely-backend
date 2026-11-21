
import argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';

import { env } from '../../config/env.js';

import {
  findUserForLogin,
  createSession,
  findSessionByTokenHash,
  revokeSession,
  type AuthenticatedUser,
  type SessionUser
} from './auth.repository.js';

import type { LoginInput } from './auth.schemas.js';

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

function hashToken(token: string): string {
  return createHash('sha256')
    .update(token)
    .digest('hex');
}

export async function login(
  input: LoginInput
): Promise<{
  token: string;
  user: AuthenticatedUser;
  expiresAt: Date;
}> {
  const user = await findUserForLogin(
    input.companySlug,
    input.email
  );

  if (!user) {
    throw new AuthError('Credenciales inválidas', 401);
  }

  if (
    user.user_status !== 'ACTIVE' ||
    user.company_status !== 'ACTIVE'
  ) {
    throw new AuthError('Credenciales inválidas', 401);
  }

  const passwordValid = await argon2.verify(
    user.password_hash,
    input.password
  );

  if (!passwordValid) {
    throw new AuthError('Credenciales inválidas', 401);
  }

  const token = randomBytes(32).toString('hex');

  const expiresAt = new Date(
    Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000
  );

  await createSession(
    user.id,
    hashToken(token),
    expiresAt
  );

  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      companyId: user.company_id,
      companyName: user.company_name,
      companySlug: user.company_slug,
      fullName: user.full_name,
      email: user.email,
      role: user.role
    }
  };
}

export async function getAuthenticatedUser(
  token: string
): Promise<SessionUser | null> {
  return findSessionByTokenHash(hashToken(token));
}

export async function logout(
  sessionId: string
): Promise<void> {
  await revokeSession(sessionId);
}
