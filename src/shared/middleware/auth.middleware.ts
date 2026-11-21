
import type { Request, Response, NextFunction } from 'express';

import { getAuthenticatedUser } from '../../modules/auth/auth.service.js';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = req.cookies?.duely_session;

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Sesión no autenticada'
      });
      return;
    }

    const user = await getAuthenticatedUser(token);

    if (!user) {
      res.clearCookie('duely_session', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/'
      });

      res.status(401).json({
        success: false,
        message: 'Sesión inválida o expirada'
      });
      return;
    }

    req.auth = user;

    next();
  } catch (error) {
    next(error);
  }
}
