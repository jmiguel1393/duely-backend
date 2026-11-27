import { randomUUID } from 'node:crypto';

import { pool } from '../../infrastructure/database/connection.js';
import type { CreateLoanInput } from './loans.schemas.js';
import type { LoanScheduleResult } from './loans.types.js';

export async function createLoan(companyId: string, input: CreateLoanInput, schedule: LoanScheduleResult) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const customer = await client.query(
      'SELECT status FROM customers WHERE company_id = $1 AND id = $2 FOR SHARE',
      [companyId, input.customerId]
    );
    if (!customer.rowCount) {
      await client.query('ROLLBACK');
      return { kind: 'customer_not_found' as const };
    }
    if (customer.rows[0].status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return { kind: 'customer_inactive' as const };
    }

    let loan;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = input.code ?? `PRE-${randomUUID().toUpperCase()}`;
      loan = await client.query(
        `INSERT INTO loans (
           company_id, customer_id, code, principal_amount, currency, installments_count,
           payment_frequency, interest_type, interest_value, interest_mode, start_date,
           disbursement_date, observations, status
         ) VALUES ($1, $2, $3, $4, 'PEN', $5, $6, $7, $8, $9, $10, $11, $12, 'ACTIVE')
         ${input.code === undefined ? 'ON CONFLICT (company_id, code) DO NOTHING' : ''}
         RETURNING id, company_id AS "companyId", customer_id AS "customerId", code,
           principal_amount AS "principalAmount", currency, installments_count AS "installmentsCount",
           payment_frequency AS "paymentFrequency", interest_type AS "interestType",
           interest_value AS "interestValue", interest_mode AS "interestMode",
           start_date AS "startDate", disbursement_date AS "disbursementDate", observations,
           status, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [companyId, input.customerId, code, input.principalAmount, input.installmentsCount,
          input.paymentFrequency, input.interestType, input.interestValue, input.interestMode,
          input.startDate, input.disbursementDate ?? null, input.observations ?? null]
      );
      if (loan.rowCount) break;
    }
    if (!loan?.rowCount) {
      throw new Error('No se pudo generar un código de préstamo único.');
    }
    const loanId = loan.rows[0].id;

    for (const installment of schedule.installments) {
      await client.query(
        `INSERT INTO loan_installments (
           company_id, loan_id, installment_number, due_date,
           principal_amount, interest_amount, total_amount, paid_amount, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'PENDING')`,
        [companyId, loanId, installment.installmentNumber, installment.dueDate,
          installment.principalAmount, installment.interestAmount, installment.totalAmount]
      );
    }

    for (const day of input.collectionDays ?? []) {
      await client.query(
        `INSERT INTO loan_collection_days (company_id, loan_id, day_type, day_value)
         VALUES ($1, $2, $3, $4)`,
        [companyId, loanId, day.type, day.value]
      );
    }

    await client.query('COMMIT');
    return { kind: 'created' as const, loan: loan.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}