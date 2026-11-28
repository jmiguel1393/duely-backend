import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

import app from '../src/app.ts';
import { pool } from '../src/infrastructure/database/connection.ts';

test('customer loan history uses confirmed payments and company-scoped data', async () => {
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const customerId = randomUUID();
  const otherCustomerId = randomUUID();
  const emptyCustomerId = randomUUID();
  const activeLoanId = randomUUID();
  const completedLoanId = randomUUID();
  const pendingLoanId = randomUUID();
  const unpaidLoanId = randomUUID();
  const cancelledLoanId = randomUUID();
  const zeroLoanId = randomUUID();
  const overdueId = randomUUID();
  const todayId = randomUUID();
  const futureId = randomUUID();
  const onTimeId = randomUUID();
  const lateId = randomUUID();
  const pendingId = randomUUID();
  const undistributedId = randomUUID();
  const cancelledId = randomUUID();
  const zeroId = randomUUID();
  const client = await pool.connect();
  const originalQuery = pool.query;
  let server;

  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE customers (
      id uuid, company_id uuid, code text, first_names text, last_names text, status text
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE loans (
      id uuid, company_id uuid, customer_id uuid, code text, status text,
      principal_amount numeric(14,2), currency text, start_date date, disbursement_date date,
      installments_count integer, created_at timestamptz DEFAULT NOW()
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE loan_installments (
      id uuid, company_id uuid, loan_id uuid, installment_number integer, due_date date,
      principal_amount numeric(14,2), interest_amount numeric(14,2), total_amount numeric(14,2), status text
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE payments (
      id uuid, company_id uuid, loan_id uuid, customer_id uuid, payment_date timestamptz, status text
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE payment_allocations (
      id uuid, company_id uuid, loan_id uuid, installment_id uuid, payment_id uuid,
      principal_amount numeric(14,2), interest_amount numeric(14,2)
    ) ON COMMIT DROP`);
    await client.query(`INSERT INTO customers VALUES
      ($1, $2, 'A', 'Ana', 'Perez', 'ACTIVE'), ($3, $4, 'B', 'Other', 'User', 'ACTIVE'),
      ($5, $2, 'C', 'Empty', 'Customer', 'ACTIVE')`,
    [customerId, companyId, otherCustomerId, otherCompanyId, emptyCustomerId]);
    await client.query(`INSERT INTO loans
      (id, company_id, customer_id, code, status, principal_amount, currency, start_date, disbursement_date, installments_count)
      SELECT id, $1, $2, code, status, 100, 'PEN', today - 30, disbursed, count
      FROM (SELECT (NOW() AT TIME ZONE 'America/Lima')::date AS today) d,
      LATERAL (VALUES ($3::uuid, 'ACTIVE', 'ACTIVE', today - 30, 3),
        ($4::uuid, 'PAID', 'PAID', today - 30, 2),
        ($5::uuid, 'PENDING', 'PENDING_DISBURSEMENT', NULL::date, 1),
        ($6::uuid, 'UNDISBURSED', 'ACTIVE', NULL::date, 1))
        loans(id, code, status, disbursed, count)`,
    [companyId, customerId, activeLoanId, completedLoanId, pendingLoanId, unpaidLoanId]);
    await client.query(`INSERT INTO loans
      (id, company_id, customer_id, code, status, principal_amount, currency, start_date, disbursement_date, installments_count)
      VALUES ($1, $3, $4, 'CANCELLED', 'CANCELLED', 100, 'PEN', CURRENT_DATE - 30, CURRENT_DATE - 30, 1),
             ($2, $3, $4, 'ZERO', 'ACTIVE', 100, 'PEN', CURRENT_DATE - 30, CURRENT_DATE - 30, 1)`,
    [cancelledLoanId, zeroLoanId, companyId, customerId]);
    await client.query(`INSERT INTO loan_installments
      (id, company_id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount, status)
      SELECT id, $1, loan_id, number, today + day_offset, 80, 20, 100, 'PENDING'
      FROM (SELECT (NOW() AT TIME ZONE 'America/Lima')::date AS today) d,
      (VALUES ($2::uuid, $9::uuid, 1, -10), ($3::uuid, $9::uuid, 2, 0),
        ($4::uuid, $9::uuid, 3, 5), ($5::uuid, $10::uuid, 1, -20),
        ($6::uuid, $10::uuid, 2, -15), ($7::uuid, $11::uuid, 1, -30),
        ($8::uuid, $12::uuid, 1, -30)) rows(id, loan_id, number, day_offset)`,
    [companyId, overdueId, todayId, futureId, onTimeId, lateId, pendingId, undistributedId,
      activeLoanId, completedLoanId, pendingLoanId, unpaidLoanId]);
    await client.query(`INSERT INTO loan_installments
      (id, company_id, loan_id, installment_number, due_date, principal_amount, interest_amount, total_amount, status)
      VALUES ($1, $3, $4, 1, CURRENT_DATE - 10, 80, 20, 100, 'PENDING'),
             ($2, $3, $5, 1, CURRENT_DATE - 10, 0, 0, 0, 'PENDING')`,
    [cancelledId, zeroId, companyId, cancelledLoanId, zeroLoanId]);

    async function addPayment(loanId, installmentId, daysAgo, status, principal, interest) {
      const paymentId = randomUUID();
      await client.query(`INSERT INTO payments VALUES
        ($1, $2, $3, $4, NOW() - ($5 * INTERVAL '1 day'), $6)`,
      [paymentId, companyId, loanId, customerId, daysAgo, status]);
      await client.query('INSERT INTO payment_allocations VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [randomUUID(), companyId, loanId, installmentId, paymentId, principal, interest]);
    }
    await addPayment(activeLoanId, overdueId, 2, 'CONFIRMED', 40, 10);
    await addPayment(activeLoanId, overdueId, 1, 'VOIDED', 40, 10);
    await addPayment(activeLoanId, futureId, -1, 'CONFIRMED', 80, 20);
    await addPayment(completedLoanId, onTimeId, 21, 'CONFIRMED', 80, 20);
    await addPayment(completedLoanId, lateId, 16, 'CONFIRMED', 40, 10);
    await addPayment(completedLoanId, lateId, 13, 'CONFIRMED', 40, 10);

    const tokenHash = createHash('sha256').update('history-token').digest('hex');
    pool.query = async (query, values) => {
      if (typeof query === 'string' && query.includes('FROM auth_sessions s')) {
        return { rows: values[0] === tokenHash ? [{
          session_id: randomUUID(), id: randomUUID(), company_id: companyId,
          company_name: 'Test', company_slug: 'test', full_name: 'Test',
          email: 'test@example.com', role: 'ADMIN'
        }] : [] };
      }
      return client.query(query, values);
    };

    server = app.listen(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/customers`;
    const request = (id, authenticated = true) => fetch(`${url}/${id}/loan-history`, {
      headers: authenticated ? { Cookie: 'duely_session=history-token' } : {}
    });
    assert.equal((await request(customerId, false)).status, 401);
    assert.equal((await request('invalid')).status, 400);
    assert.equal((await request(otherCustomerId)).status, 404);
    assert.equal((await request(randomUUID())).status, 404);
    const empty = await request(emptyCustomerId);
    const emptyBody = (await empty.json()).data;
    assert.equal(emptyBody.summary.totalLoans, 0);
    assert.equal(emptyBody.summary.isUpToDate, null);
    assert.deepEqual(emptyBody.loans, []);
    assert.deepEqual(emptyBody.upcomingCollections, []);

    const response = await request(customerId);
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.customer.id, customerId);
    assert.deepEqual(data.summary, {
      totalLoans: 6, activeLoans: 3, completedLoans: 1, pendingDisbursementLoans: 1,
      cancelledLoans: 1, overdueInstallments: 1, daysOverdue: 10, isUpToDate: false
    });
    const active = data.loans.find(loan => loan.id === activeLoanId);
    assert.equal(active.isUpToDate, false);
    assert.equal(active.daysOverdue, 10);
    assert.equal(active.outstandingAmount, '250.00');
    assert.equal(active.overdueAmount, '50.00');
    assert.equal(data.loans.find(loan => loan.id === pendingLoanId).isUpToDate, null);
    assert.equal(data.loans.find(loan => loan.id === unpaidLoanId).isUpToDate, null);
    assert.equal(data.loans.find(loan => loan.id === zeroLoanId).isUpToDate, null);
    assert.equal(data.loans.find(loan => loan.id === cancelledLoanId).outstandingAmount, '0.00');
    const overdue = data.paymentBehavior.find(item => item.installmentId === overdueId);
    assert.equal(overdue.paymentStatus, 'OVERDUE');
    assert.equal(overdue.paidAmount, '50.00');
    assert.equal(overdue.outstandingAmount, '50.00');
    assert.equal(overdue.daysLate, 10);
    assert.equal(data.paymentBehavior.find(item => item.installmentId === onTimeId).paymentStatus, 'PAID_ON_TIME');
    const late = data.paymentBehavior.find(item => item.installmentId === lateId);
    assert.equal(late.paymentStatus, 'PAID_LATE');
    assert.equal(late.daysLate, 2);
    assert.equal(data.paymentBehavior.find(item => item.installmentId === pendingId).paymentStatus, 'NOT_DISBURSED');
    assert.equal(data.paymentBehavior.find(item => item.installmentId === undistributedId).paymentStatus, 'NOT_DISBURSED');
    assert.equal(data.paymentBehavior.find(item => item.installmentId === cancelledId).paymentStatus, 'CANCELLED');
    assert.equal(data.paymentBehavior.find(item => item.installmentId === zeroId).paymentStatus, 'NO_AMOUNT_DUE');
    assert.deepEqual(data.overdueInstallments.map(item => item.installmentId), [overdueId]);
    assert.deepEqual(data.upcomingCollections.map(item => item.installmentId), [todayId, futureId]);
    assert.equal(data.upcomingCollections[1].paidAmount, '0.00');

    await addPayment(activeLoanId, overdueId, 0, 'CONFIRMED', 40, 10);
    const settled = (await (await request(customerId)).json()).data;
    assert.equal(settled.summary.isUpToDate, true);
    assert.equal(settled.summary.daysOverdue, 0);
    assert.equal(settled.summary.overdueInstallments, 0);
    const settledInstallment = settled.paymentBehavior.find(item => item.installmentId === overdueId);
    assert.equal(settledInstallment.paymentStatus, 'PAID_LATE');
    assert.equal(settledInstallment.daysLate, 10);
    assert.equal(settledInstallment.outstandingAmount, '0.00');
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    pool.query = originalQuery;
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});