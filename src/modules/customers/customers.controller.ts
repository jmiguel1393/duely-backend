import type { NextFunction, Request, Response } from 'express';

import { createCustomer, deactivateCustomer, listCustomers, updateCustomer } from './customers.repository.js';
import { createCustomerSchema, customerIdSchema, listCustomersSchema, updateCustomerSchema } from './customers.schemas.js';

function handleError(error: unknown, res: Response, next: NextFunction): void {
  if (
    typeof error === 'object' && error !== null &&
    'code' in error && error.code === '23505' &&
    'constraint' in error && error.constraint === 'uq_customers_company_code'
  ) {
    res.status(409).json({ success: false, message: 'Ya existe un cliente con ese código.' });
    return;
  }
  next(error);
}

export async function listCustomersController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
      return;
    }
    const input = listCustomersSchema.parse(req.query);
    const result = await listCustomers(req.auth.companyId, input);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function createCustomerController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
      return;
    }
    const input = createCustomerSchema.parse(req.body);
    const data = await createCustomer(req.auth.companyId, input);
    res.status(201).json({ success: true, data });
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function updateCustomerController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
      return;
    }
    const customerId = customerIdSchema.parse(req.params.customerId);
    const input = updateCustomerSchema.parse(req.body);
    const data = await updateCustomer(req.auth.companyId, customerId, input);
    if (!data) {
      res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
      return;
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    handleError(error, res, next);
  }
}

export async function deleteCustomerController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
      return;
    }
    const customerId = customerIdSchema.parse(req.params.customerId);
    const data = await deactivateCustomer(req.auth.companyId, customerId);
    if (!data) {
      res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
      return;
    }
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}