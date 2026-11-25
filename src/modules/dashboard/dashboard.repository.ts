
import { pool } from '../../infrastructure/database/connection.js';

import type {
  DashboardSummaryParams,
  DashboardFinancialSummary
} from './dashboard.types.js';

export async function getFinancialSummary(
  params: DashboardSummaryParams
): Promise<DashboardFinancialSummary> {
  const result = await pool.query(
    `
    WITH confirmed_allocations AS (
      SELECT
        pa.company_id,
        pa.loan_id,
        pa.installment_id,
        SUM(pa.principal_amount) AS principal_paid,
        SUM(pa.interest_amount) AS interest_paid
      FROM payment_allocations pa
      INNER JOIN payments p
        ON p.id = pa.payment_id
        AND p.company_id = pa.company_id
      WHERE pa.company_id = $1
        AND p.status = 'CONFIRMED'
      GROUP BY
        pa.company_id,
        pa.loan_id,
        pa.installment_id
    ),

    current_installments AS (
      SELECT
        li.company_id,
        li.loan_id,
        li.id AS installment_id,
        li.due_date,

        GREATEST(
          li.principal_amount - COALESCE(ca.principal_paid, 0),
          0
        ) AS principal_pending,

        GREATEST(
          li.interest_amount - COALESCE(ca.interest_paid, 0),
          0
        ) AS interest_pending

      FROM loan_installments li

      INNER JOIN loans l
        ON l.id = li.loan_id
        AND l.company_id = li.company_id

      LEFT JOIN confirmed_allocations ca
        ON ca.company_id = li.company_id
        AND ca.loan_id = li.loan_id
        AND ca.installment_id = li.id

      WHERE li.company_id = $1
        AND li.status <> 'CANCELLED'
        AND l.status IN ('ACTIVE', 'OVERDUE')
        AND l.disbursement_date IS NOT NULL
        AND l.disbursement_date <=
            (NOW() AT TIME ZONE 'America/Lima')::date
    ),

    financial AS (
      SELECT
        COALESCE(SUM(principal_pending), 0) AS capital_pending,
        COALESCE(SUM(interest_pending), 0) AS interest_pending,

        COALESCE(
          SUM(principal_pending + interest_pending)
          FILTER (
            WHERE due_date <
              (NOW() AT TIME ZONE 'America/Lima')::date
          ),
          0
        ) AS overdue_amount

      FROM current_installments
    ),

    disbursements AS (
      SELECT
        COALESCE(SUM(principal_amount), 0) AS total_disbursed
      FROM loans
      WHERE company_id = $1
        AND disbursement_date IS NOT NULL
        AND disbursement_date <=
            (NOW() AT TIME ZONE 'America/Lima')::date
        AND status <> 'CANCELLED'
        AND ($2::date IS NULL OR disbursement_date >= $2::date)
        AND ($3::date IS NULL OR disbursement_date <= $3::date)
    ),

    collections AS (
      SELECT
        COALESCE(SUM(amount), 0) AS total_collected
      FROM payments
      WHERE company_id = $1
        AND status = 'CONFIRMED'
        AND ($2::date IS NULL OR
          (payment_date AT TIME ZONE 'America/Lima')::date >= $2::date)
        AND ($3::date IS NULL OR
          (payment_date AT TIME ZONE 'America/Lima')::date <= $3::date)
    ),

    collection_breakdown AS (
      SELECT
        COALESCE(SUM(pa.principal_amount), 0) AS capital_collected,
        COALESCE(SUM(pa.interest_amount), 0) AS interest_collected
      FROM payment_allocations pa
      INNER JOIN payments p
        ON p.id = pa.payment_id
        AND p.company_id = pa.company_id
      WHERE pa.company_id = $1
        AND p.status = 'CONFIRMED'
        AND ($2::date IS NULL OR
          (p.payment_date AT TIME ZONE 'America/Lima')::date >= $2::date)
        AND ($3::date IS NULL OR
          (p.payment_date AT TIME ZONE 'America/Lima')::date <= $3::date)
    )

    SELECT
      d.total_disbursed AS "totalDisbursed",
      c.total_collected AS "totalCollected",
      cb.capital_collected AS "capitalCollected",
      cb.interest_collected AS "interestCollected",
      f.capital_pending AS "capitalPending",
      f.interest_pending AS "interestPending",

      f.capital_pending + f.interest_pending AS "totalPending",

      f.overdue_amount AS "overdueAmount"

    FROM disbursements d
    CROSS JOIN collections c
    CROSS JOIN collection_breakdown cb
    CROSS JOIN financial f
    `,
    [
      params.companyId,
      params.from ?? null,
      params.to ?? null
    ]
  );

  return result.rows[0];
}
