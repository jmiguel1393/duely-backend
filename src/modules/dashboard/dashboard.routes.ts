
import { Router } from 'express';

import { authMiddleware } from '../../shared/middleware/auth.middleware.js';

import {
  getDashboardSummaryController
} from './dashboard.controller.js';

const router = Router();

router.get(
  '/summary',
  authMiddleware,
  getDashboardSummaryController
);

export default router;
