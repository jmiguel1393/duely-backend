import { Router } from 'express';

import { authMiddleware } from '../../shared/middleware/auth.middleware.js';
import {
  createCustomerController,
  deleteCustomerController,
  listCustomersController,
  updateCustomerController
} from './customers.controller.js';

const router = Router();

router.use(authMiddleware);
router.get('/', listCustomersController);
router.post('/', createCustomerController);
router.patch('/:customerId', updateCustomerController);
router.delete('/:customerId', deleteCustomerController);

export default router;