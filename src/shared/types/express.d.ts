
import type { SessionUser } from '../../modules/auth/auth.repository.js';

declare global {
  namespace Express {
    interface Request {
      auth?: SessionUser;
    }
  }
}

export {};
