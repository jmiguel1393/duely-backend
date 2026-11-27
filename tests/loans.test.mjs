import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

import app from '../src/app.ts';
import { pool } from '../src/infrastructure/database/connection.ts';
import { createLoanSchema } from '../src/modules/loans/loans.schemas.ts';
import { generateLoanSchedule } from '../src/modules/loans/loans.schedule.ts';

test('Spanish loan options map to the existing schedule values', () => {
  const payload = {
    customerId: randomUUID(), code: 'P-001', principalAmount: 1000, installmentsCount: 2,
    paymentFrequency: 'SEMANAL', interestType: 'PORCENTAJE', interestMode: 'TOTAL_PRESTAMO',
    interestValue: 10, startDate: '2026-11-27'
  };
  for (const [spanish, internal] of Object.entries({
    DIARIA: 'DAILY', SEMANAL: 'WEEKLY', QUINCENAL: 'BIWEEKLY',
    CATORCENAL: 'FORTNIGHTLY', MENSUAL: 'MONTHLY'
  })) {
    assert.equal(createLoanSchema.parse({ ...payload, paymentFrequency: spanish }).paymentFrequency, internal);
  }
  for (const [spanish, internal] of Object.entries({ PORCENTAJE: 'PERCENTAGE', MONTO: 'FIXED_AMOUNT' })) {
    assert.equal(createLoanSchema.parse({ ...payload, interestType: spanish }).interestType, internal);
  }
  for (const [spanish, internal] of Object.entries({ TOTAL_PRESTAMO: 'TOTAL_LOAN', POR_CUOTA: 'PER_INSTALLMENT' })) {
    assert.equal(createLoanSchema.parse({ ...payload, interestMode: spanish }).interestMode, internal);
  }
  assert.equal(generateLoanSchedule(createLoanSchema.parse({ ...payload, interestMode: 'POR_CUOTA' })).totalAmount, 1200);
  assert.equal(createLoanSchema.safeParse({ ...payload, paymentFrequency: 'WEEKLY' }).success, false);
  assert.equal(createLoanSchema.safeParse({ ...payload, interestType: 'PORCENTAJE', interestValue: 101 }).success, false);
  assert.equal(createLoanSchema.safeParse({ ...payload, interestType: 'MONTO', interestValue: 1.001 }).success, false);
  for (const [index, day] of ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'].entries()) {
    const parsed = createLoanSchema.parse({ ...payload, collectionDays: [{ type: 'DIA_SEMANA', value: day }] });
    assert.deepEqual(parsed.collectionDays, [{ type: 'DAY_OF_WEEK', value: index + 1 }]);
  }
  for (const day of [1, 31]) {
    const parsed = createLoanSchema.parse({ ...payload, collectionDays: [{ type: 'DIA_MES', value: day }] });
    assert.deepEqual(parsed.collectionDays, [{ type: 'DAY_OF_MONTH', value: day }]);
  }
  const multipleDays = createLoanSchema.parse({
    ...payload, installmentsCount: 3,
    collectionDays: [{ type: 'DIA_SEMANA', value: 'LUNES' }, { type: 'DIA_SEMANA', value: 'VIERNES' }]
  });
  assert.deepEqual(generateLoanSchedule(multipleDays).installments.map(item => item.dueDate),
    ['2026-11-27', '2026-11-30', '2026-12-04']);
  for (const invalid of [
    [{ type: 'DIA_MES', value: 0 }], [{ type: 'DIA_MES', value: 32 }],
    [{ type: 'DIA_MES', value: '1' }], [{ type: 'DIA_SEMANA', value: 'LUNES' }, { type: 'DIA_MES', value: 1 }],
    [{ type: 'DIA_SEMANA', value: 'LUNES' }, { type: 'DIA_SEMANA', value: 'LUNES' }],
    [{ type: 'DIA_SEMANA', value: 'MONDAY' }], [{ type: 'DAY_OF_WEEK', value: 1 }]
  ]) {
    assert.equal(createLoanSchema.safeParse({ ...payload, collectionDays: invalid }).success, false);
  }
  const { code: _code, ...withoutCode } = payload;
  assert.equal(createLoanSchema.safeParse(withoutCode).success, true);
});

test('loan creation is validated, company-scoped and atomic', async () => {
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const customerId = randomUUID();
  const otherCustomerId = randomUUID();
  const inactiveCustomerId = randomUUID();
  const secondCustomerId = randomUUID();
  const tokens = new Map([
    [createHash('sha256').update('company-token').digest('hex'), companyId],
    [createHash('sha256').update('other-token').digest('hex'), otherCompanyId]
  ]);
  const client = await pool.connect();
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  let server;
  let failInstallment = false;
  let collideGeneratedOnce = false;
  let generatedAttempts = 0;

  try {
    await client.query('BEGIN');
    for (const table of ['customers', 'loans', 'loan_installments', 'loan_collection_days']) {
      await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP`);
    }
    await client.query('ALTER TABLE loans ADD CONSTRAINT uq_loans_company_code UNIQUE (company_id, code)');
    await client.query(`CREATE UNIQUE INDEX uq_customer_active_loan ON loans (company_id, customer_id)
      WHERE status IN ('PENDING_DISBURSEMENT', 'ACTIVE', 'OVERDUE')`);
    await client.query(`INSERT INTO customers (id, company_id, code, first_names, last_names, phone, status)
      VALUES ($1, $2, 'A', 'Ana', 'Perez', '123', 'ACTIVE'),
             ($3, $4, 'B', 'Juan', 'Perez', '123', 'ACTIVE'),
             ($5, $2, 'C', 'Maria', 'Perez', '123', 'INACTIVE'),
             ($6, $2, 'D', 'Luis', 'Perez', '123', 'ACTIVE')`,
    [customerId, companyId, otherCustomerId, otherCompanyId, inactiveCustomerId, secondCustomerId]);

    pool.query = async (query, values) => {
      if (typeof query === 'string' && query.includes('FROM auth_sessions s')) {
        const sessionCompany = tokens.get(values[0]);
        return { rows: sessionCompany ? [{
          session_id: randomUUID(), id: randomUUID(), company_id: sessionCompany,
          company_name: 'Test', company_slug: 'test', full_name: 'Test',
          email: 'test@example.com', role: 'ADMIN'
        }] : [] };
      }
      return client.query(query, values);
    };
    pool.connect = async () => ({
      query: async (query, values) => {
        if (query === 'BEGIN') return client.query('SAVEPOINT loan_request');
        if (query === 'COMMIT') return client.query('RELEASE SAVEPOINT loan_request');
        if (query === 'ROLLBACK') {
          await client.query('ROLLBACK TO SAVEPOINT loan_request');
          return client.query('RELEASE SAVEPOINT loan_request');
        }
        if (failInstallment && query.includes('INSERT INTO loan_installments')) {
          throw new Error('Simulated installment failure');
        }
        if (collideGeneratedOnce && query.includes('INSERT INTO loans')) {
          generatedAttempts++;
          if (generatedAttempts === 1) {
            return client.query(query, values.map((value, index) => index === 2 ? 'P-001' : value));
          }
        }
        return client.query(query, values);
      },
      release: () => {}
    });
    server = app.listen(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/loans`;
    const request = (body, token = 'company-token') => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Cookie: `duely_session=${token}` } : {}) },
      body: JSON.stringify(body)
    });
    const payload = {
      customerId, code: ' p-001 ', principalAmount: 1000, installmentsCount: 2,
      paymentFrequency: 'SEMANAL', interestType: 'PORCENTAJE', interestMode: 'TOTAL_PRESTAMO',
      interestValue: 10, startDate: '2026-11-27', disbursementDate: '2026-11-27',
      collectionDays: [{ type: 'DIA_SEMANA', value: 'VIERNES' }]
    };

    assert.equal((await request(payload, '')).status, 401);
    assert.equal((await request({ ...payload, customerId: otherCustomerId })).status, 404);
    assert.equal((await request({ ...payload, customerId: inactiveCustomerId })).status, 409);
    for (const invalid of [
      { principalAmount: 0 }, { principalAmount: 1.001 }, { interestValue: 101 },
      { startDate: '2026-02-30' }, { installmentsCount: 366 },
      { collectionDays: [{ type: 'DIA_SEMANA', value: 'LUNES' }, { type: 'DIA_MES', value: 1 }] },
      { collectionDays: [{ type: 'DIA_SEMANA', value: 'LUNES' }, { type: 'DIA_SEMANA', value: 'LUNES' }] },
      { companyId: otherCompanyId }
    ]) {
      assert.equal((await request({ ...payload, ...invalid })).status, 400);
    }

    const createdResponse = await request(payload);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).data;
    assert.equal(created.companyId, companyId);
    assert.equal(created.code, 'P-001');
    assert.equal(created.status, 'ACTIVE');
    assert.equal(created.currency, 'PEN');
    assert.equal(created.interestType, 'PERCENTAGE');
    assert.deepEqual(created.collectionDays, [{ type: 'DAY_OF_WEEK', value: 5 }]);
    assert.equal(created.schedule.totalAmount, 1100);
    assert.deepEqual(created.schedule.installments.map(item => item.dueDate), ['2026-11-27', '2026-12-04']);
    const installments = await client.query('SELECT * FROM loan_installments WHERE loan_id = $1 ORDER BY installment_number', [created.id]);
    assert.equal(installments.rowCount, 2);
    assert.equal(installments.rows[0].total_amount, '550.00');
    const days = await client.query('SELECT * FROM loan_collection_days WHERE loan_id = $1', [created.id]);
    assert.equal(days.rowCount, 1);
    assert.equal(days.rows[0].day_type, 'DAY_OF_WEEK');
    assert.equal(days.rows[0].day_value, 5);
    assert.equal((await request({ ...payload, code: 'other-code' })).status, 409);
    assert.equal((await request({ ...payload, customerId: secondCustomerId })).status, 409);

    const { code: _code, ...payloadWithoutCode } = payload;
    const fixedPayload = { ...payloadWithoutCode, customerId: secondCustomerId,
      interestType: 'MONTO', interestValue: 10.25, collectionDays: [{ type: 'DIA_MES', value: 31 }] };
    assert.equal((await request({ ...fixedPayload, interestValue: 1.001 })).status, 400);
    assert.equal((await request({ ...fixedPayload, startDate: '9999-12-31' })).status, 400);
    failInstallment = true;
    assert.equal((await request(fixedPayload)).status, 500);
    failInstallment = false;
    assert.equal((await client.query('SELECT id FROM loans WHERE customer_id = $1', [secondCustomerId])).rowCount, 0);
    collideGeneratedOnce = true;
    const fixedResponse = await request(fixedPayload);
    assert.equal(fixedResponse.status, 201);
    const fixedLoan = (await fixedResponse.json()).data;
    assert.match(fixedLoan.code, /^PRE-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
    assert.equal(generatedAttempts, 2);
    assert.equal(fixedLoan.schedule.totalAmount, 1010.25);
    assert.deepEqual(fixedLoan.schedule.installments.map(item => item.dueDate), ['2026-11-30', '2026-12-31']);
    const monthDays = await client.query('SELECT day_type, day_value FROM loan_collection_days WHERE loan_id = $1', [fixedLoan.id]);
    assert.deepEqual(monthDays.rows, [{ day_type: 'DAY_OF_MONTH', day_value: 31 }]);
    assert.equal((await client.query('SELECT code FROM loans WHERE id = $1', [fixedLoan.id])).rows[0].code, fixedLoan.code);
    collideGeneratedOnce = false;
    const otherGenerated = await request({ ...fixedPayload, customerId: otherCustomerId }, 'other-token');
    assert.equal(otherGenerated.status, 201);
    assert.notEqual((await otherGenerated.json()).data.code, fixedLoan.code);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    pool.connect = originalConnect;
    pool.query = originalQuery;
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});