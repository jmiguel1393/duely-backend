import { Router } from 'express';

import { authMiddleware } from '../../shared/middleware/auth.middleware.js';
import { uploadExcel } from '../../shared/middleware/upload.middleware.js';

import {
  previewImportController
} from './imports.controller.js';

const router = Router();

router.post(
  '/preview',
  authMiddleware,
  uploadExcel.single('file'),
  previewImportController
);

export default router;