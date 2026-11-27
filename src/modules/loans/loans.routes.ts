import { Router } from 'express';

import { authMiddleware } from '../../shared/middleware/auth.middleware.js';
import { createLoanController } from './loans.controller.js';

const router = Router();

router.post('/', authMiddleware, createLoanController);

export default router;