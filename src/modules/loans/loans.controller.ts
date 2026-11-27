import type { NextFunction, Request, Response } from 'express';

import { createLoan } from './loans.repository.js';
import { generateLoanSchedule } from './loans.schedule.js';
import { createLoanSchema } from './loans.schemas.js';

export async function createLoanController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({ success: false, message: 'Usuario no autenticado.' });
      return;
    }
    const input = createLoanSchema.parse(req.body);
    const schedule = generateLoanSchedule(input);
    if (schedule.installments.some(installment => !/^\d{4}-\d{2}-\d{2}$/.test(installment.dueDate))) {
      res.status(400).json({ success: false, message: 'El cronograma excede el rango de fechas permitido.' });
      return;
    }
    if (schedule.installments.some(installment =>
      !Number.isSafeInteger(Math.round(installment.totalAmount * 100)) ||
      installment.totalAmount > 999999999999.99
    )) {
      res.status(400).json({ success: false, message: 'Los importes de las cuotas exceden el límite permitido.' });
      return;
    }
    const result = await createLoan(req.auth.companyId, input, schedule);
    if (result.kind === 'customer_not_found') {
      res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
      return;
    }
    if (result.kind === 'customer_inactive') {
      res.status(409).json({ success: false, message: 'El cliente está inactivo.' });
      return;
    }
    res.status(201).json({ success: true, data: { ...result.loan, collectionDays: input.collectionDays ?? [], schedule } });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint' in error) {
      if (error.constraint === 'uq_loans_company_code') {
        res.status(409).json({ success: false, message: 'Ya existe un préstamo con ese código.' });
        return;
      }
      if (error.constraint === 'uq_customer_active_loan' || error.constraint === 'uq_loans_one_current_per_customer') {
        res.status(409).json({ success: false, message: 'El cliente ya tiene un préstamo vigente.' });
        return;
      }
    }
    next(error);
  }
}