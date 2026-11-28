import { pool } from '../../infrastructure/database/connection.js';

interface HistoryInstallment {
  loanId: string;
  installmentId: string;
  installmentNumber: number;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  paidOn: string | null;
  daysLate: number | null;
  paymentStatus: string;
}

interface HistoryLoan {
  id: string;
  code: string;
  status: string;
  principalAmount: string;
  currency: string;
  startDate: string;
  disbursementDate: string | null;
  installmentsCount: number;
  outstandingAmount: string;
  overdueAmount: string;
  daysOverdue: number;
  isUpToDate: boolean | null;
}

export async function getCustomerLoanHistory(companyId: string, customerId: string) {
  const result = await pool.query<{
    customer: { id: string; code: string; firstNames: string; lastNames: string; status: string };
    asOf: string;
    loans: HistoryLoan[];
    installments: HistoryInstallment[];
  }>(
    `WITH customer AS (
       SELECT id, company_id, code, first_names, last_names, status
       FROM customers WHERE company_id = $1 AND id = $2
     ), customer_loans AS (
       SELECT loans.* FROM loans
       JOIN customer ON customer.company_id = loans.company_id AND customer.id = loans.customer_id
     ), current_date_lima AS (
       SELECT (NOW() AT TIME ZONE 'America/Lima')::date AS today
     ), loan_installments_scoped AS (
       SELECT li.* FROM loan_installments li
       JOIN customer_loans loan ON loan.company_id = li.company_id AND loan.id = li.loan_id
     ), running_payments AS (
       SELECT pa.installment_id, pa.principal_amount, pa.interest_amount, p.payment_date,
         SUM(pa.principal_amount) OVER payment_order AS principal_paid,
         SUM(pa.interest_amount) OVER payment_order AS interest_paid
       FROM payment_allocations pa
       JOIN loan_installments_scoped li ON li.company_id = pa.company_id
         AND li.loan_id = pa.loan_id AND li.id = pa.installment_id
       JOIN payments p ON p.company_id = pa.company_id AND p.id = pa.payment_id
         AND p.loan_id = pa.loan_id AND p.customer_id = $2
       WHERE p.status = 'CONFIRMED' AND p.payment_date <= NOW()
       WINDOW payment_order AS (PARTITION BY pa.installment_id ORDER BY p.payment_date, pa.id
         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
     ), payment_totals AS (
       SELECT li.id AS installment_id,
         COALESCE(SUM(rp.principal_amount), 0) AS principal_paid,
         COALESCE(SUM(rp.interest_amount), 0) AS interest_paid,
         MIN(rp.payment_date) FILTER (
           WHERE rp.principal_paid >= li.principal_amount AND rp.interest_paid >= li.interest_amount
         ) AS paid_at
       FROM loan_installments_scoped li
       LEFT JOIN running_payments rp ON rp.installment_id = li.id
       GROUP BY li.id
     ), installment_balances AS (
       SELECT li.*, loan.code AS loan_code, loan.status AS loan_status,
         loan.disbursement_date, today.today,
         LEAST(li.principal_amount, pt.principal_paid) + LEAST(li.interest_amount, pt.interest_paid) AS paid,
         GREATEST(li.principal_amount - pt.principal_paid, 0) +
           GREATEST(li.interest_amount - pt.interest_paid, 0) AS outstanding,
         (pt.paid_at AT TIME ZONE 'America/Lima')::date AS paid_on
       FROM loan_installments_scoped li
       JOIN customer_loans loan ON loan.company_id = li.company_id AND loan.id = li.loan_id
       JOIN payment_totals pt ON pt.installment_id = li.id
       CROSS JOIN current_date_lima today
     ), installment_metrics AS (
       SELECT *, CASE
         WHEN status = 'CANCELLED' OR loan_status = 'CANCELLED' THEN 'CANCELLED'
         WHEN total_amount = 0 THEN 'NO_AMOUNT_DUE'
         WHEN paid_on IS NOT NULL AND paid_on <= due_date THEN 'PAID_ON_TIME'
         WHEN paid_on IS NOT NULL THEN 'PAID_LATE'
         WHEN loan_status NOT IN ('ACTIVE', 'OVERDUE', 'PENDING_DISBURSEMENT') THEN 'CLOSED_UNPAID'
         WHEN loan_status = 'PENDING_DISBURSEMENT' OR disbursement_date IS NULL OR disbursement_date > today THEN 'NOT_DISBURSED'
         WHEN due_date < today THEN 'OVERDUE'
         WHEN due_date = today THEN 'DUE_TODAY'
         ELSE 'UPCOMING'
       END AS payment_status,
       CASE
         WHEN status = 'CANCELLED' OR loan_status = 'CANCELLED' THEN NULL
         WHEN paid_on IS NOT NULL THEN GREATEST(paid_on - due_date, 0)
         WHEN loan_status IN ('ACTIVE', 'OVERDUE') AND disbursement_date <= today AND outstanding > 0 AND due_date < today
           THEN today - due_date
         ELSE NULL
       END AS days_late
       FROM installment_balances
     ), loan_stats AS (
       SELECT loan.id,
         COALESCE(SUM(im.outstanding) FILTER (WHERE im.payment_status <> 'CANCELLED'), 0) AS outstanding_amount,
         COALESCE(SUM(im.outstanding) FILTER (WHERE im.payment_status = 'OVERDUE'), 0) AS overdue_amount,
         COALESCE(MAX(im.days_late) FILTER (WHERE im.payment_status = 'OVERDUE'), 0) AS days_overdue
       FROM customer_loans loan
       LEFT JOIN installment_metrics im ON im.company_id = loan.company_id AND im.loan_id = loan.id
       GROUP BY loan.id
     )
     SELECT json_build_object('id', customer.id, 'code', customer.code,
       'firstNames', customer.first_names, 'lastNames', customer.last_names, 'status', customer.status) AS customer,
       today.today::text AS "asOf",
       COALESCE((SELECT json_agg(json_build_object(
         'id', loan.id, 'code', loan.code, 'status', loan.status,
         'principalAmount', loan.principal_amount::text, 'currency', loan.currency,
         'startDate', loan.start_date::text, 'disbursementDate', loan.disbursement_date::text,
         'installmentsCount', loan.installments_count,
         'outstandingAmount', ROUND(stats.outstanding_amount, 2)::text, 'overdueAmount', ROUND(stats.overdue_amount, 2)::text,
         'daysOverdue', stats.days_overdue,
         'isUpToDate', CASE WHEN loan.status IN ('ACTIVE', 'OVERDUE') AND loan.disbursement_date <= today.today
           AND EXISTS (SELECT 1 FROM installment_metrics eligible
             WHERE eligible.loan_id = loan.id AND eligible.company_id = loan.company_id
               AND eligible.status <> 'CANCELLED' AND eligible.total_amount > 0)
           THEN stats.days_overdue = 0 ELSE NULL END
       ) ORDER BY loan.created_at DESC, loan.id) FROM customer_loans loan JOIN loan_stats stats ON stats.id = loan.id), '[]'::json) AS loans,
       COALESCE((SELECT json_agg(json_build_object(
         'loanId', im.loan_id, 'loanCode', im.loan_code, 'installmentId', im.id,
         'installmentNumber', im.installment_number, 'dueDate', im.due_date::text,
         'totalAmount', ROUND(im.total_amount, 2)::text, 'paidAmount', ROUND(im.paid, 2)::text,
         'outstandingAmount', ROUND(im.outstanding, 2)::text, 'paidOn', im.paid_on::text,
         'daysLate', im.days_late, 'paymentStatus', im.payment_status
       ) ORDER BY im.due_date, im.loan_id, im.installment_number) FROM installment_metrics im), '[]'::json) AS installments
     FROM customer CROSS JOIN current_date_lima today`,
    [companyId, customerId]
  );

  const row = result.rows[0];
  if (!row) return null;

  const currentLoans = row.loans.filter(loan => loan.isUpToDate !== null);
  const overdueInstallments = row.installments.filter(item => item.paymentStatus === 'OVERDUE');
  return {
    customer: row.customer,
    asOf: row.asOf,
    summary: {
      totalLoans: row.loans.length,
      activeLoans: row.loans.filter(loan => loan.status === 'ACTIVE' || loan.status === 'OVERDUE').length,
      completedLoans: row.loans.filter(loan => loan.status === 'PAID').length,
      pendingDisbursementLoans: row.loans.filter(loan => loan.status === 'PENDING_DISBURSEMENT').length,
      cancelledLoans: row.loans.filter(loan => loan.status === 'CANCELLED').length,
      overdueInstallments: overdueInstallments.length,
      daysOverdue: currentLoans.reduce((maximum, loan) => Math.max(maximum, loan.daysOverdue), 0),
      isUpToDate: currentLoans.length ? currentLoans.every(loan => loan.isUpToDate) : null
    },
    loans: row.loans,
    paymentBehavior: row.installments,
    overdueInstallments,
    upcomingCollections: row.installments.filter(item => item.paymentStatus === 'DUE_TODAY' || item.paymentStatus === 'UPCOMING')
  };
}