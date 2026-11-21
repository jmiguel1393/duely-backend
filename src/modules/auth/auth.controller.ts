
import type { Request, Response, NextFunction } from 'express';

import { env } from '../../config/env.js';
import { loginSchema } from './auth.schemas.js';
import {
  login,
  logout,
  AuthError
} from './auth.service.js';

const COOKIE_NAME = 'duely_session';

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/'
};

export async function loginController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = loginSchema.parse(req.body);

    const result = await login(input);

    res.cookie(COOKIE_NAME, result.token, {
      ...cookieOptions,
      expires: result.expiresAt
    });

    res.status(200).json({
      success: true,
      message: 'Inicio de sesión exitoso',
      data: {
        user: result.user,
        expiresAt: result.expiresAt
      }
    });
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
      return;
    }

    next(error);
  }
}

export async function meController(
  req: Request,
  res: Response
): Promise<void> {
  const user = req.auth;

  if (!user) {
    res.status(401).json({
      success: false,
      message: 'No autenticado'
    });
    return;
  }

  res.status(200).json({
    success: true,
    data: {
      user: {
        id: user.id,
        companyId: user.companyId,
        companyName: user.companyName,
        companySlug: user.companySlug,
        fullName: user.fullName,
        email: user.email,
        role: user.role
      }
    }
  });
}

export async function logoutController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (req.auth) {
      await logout(req.auth.sessionId);
    }

    res.clearCookie(COOKIE_NAME, cookieOptions);

    res.status(200).json({
      success: true,
      message: 'Sesión cerrada correctamente'
    });
  } catch (error) {
    next(error);
  }
}
