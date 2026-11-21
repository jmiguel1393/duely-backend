
import { Router } from 'express';

import {
  loginController,
  meController,
  logoutController
} from './auth.controller.js';

import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

const router = Router();

router.post('/login', loginController);

router.get('/me', authMiddleware, meController);

router.post('/logout', authMiddleware, logoutController);

export default router;
