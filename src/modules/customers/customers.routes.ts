import { Router } from 'express';

import { authMiddleware } from '../../shared/middleware/auth.middleware.js';
import {
  createCustomerController,
  deleteCustomerController,
  getCustomerLoanHistoryController,
  listCustomersController,
  updateCustomerController
} from './customers.controller.js';

const router = Router();

router.use(authMiddleware);
router.get('/', listCustomersController);
router.get('/:customerId/loan-history', getCustomerLoanHistoryController);
router.post('/', createCustomerController);
router.patch('/:customerId', updateCustomerController);
router.delete('/:customerId', deleteCustomerController);

export default router;