import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

import app from '../src/app.ts';
import { pool } from '../src/infrastructure/database/connection.ts';

test('customers CRUD stays within the authenticated company', async () => {
  const companyId = randomUUID();
  const otherCompanyId = randomUUID();
  const companyToken = 'customer-test-company';
  const otherToken = 'customer-test-other-company';
  const tokens = new Map([
    [createHash('sha256').update(companyToken).digest('hex'), companyId],
    [createHash('sha256').update(otherToken).digest('hex'), otherCompanyId]
  ]);
  const client = await pool.connect();
  const originalQuery = pool.query;
  let server;

  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE customers
      (LIKE public.customers INCLUDING DEFAULTS INCLUDING CONSTRAINTS)
      ON COMMIT DROP`);
    await client.query(`ALTER TABLE customers ADD CONSTRAINT uq_customers_company_code
      UNIQUE (company_id, code)`);
    await client.query(`CREATE TEMP TABLE loans (
      company_id uuid NOT NULL, customer_id uuid NOT NULL, status text NOT NULL
    ) ON COMMIT DROP`);

    pool.query = async (query, values) => {
      if (typeof query === 'string' && query.includes('FROM auth_sessions s')) {
        const sessionCompany = tokens.get(values[0]);
        return { rows: sessionCompany ? [{
          session_id: randomUUID(), id: randomUUID(), company_id: sessionCompany,
          company_name: 'Test', company_slug: 'test', full_name: 'Test',
          email: 'test@example.com', role: 'ADMIN'
        }] : [] };
      }
      await client.query('SAVEPOINT customer_request');
      try {
        const result = await client.query(query, values);
        await client.query('RELEASE SAVEPOINT customer_request');
        return result;
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT customer_request');
        await client.query('RELEASE SAVEPOINT customer_request');
        throw error;
      }
    };

    server = app.listen(0);
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}/api/customers`;
    const request = (path, method, token, body) => fetch(`${url}${path}`, {
      method,
      headers: {
        ...(token ? { Cookie: `duely_session=${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = {
      code: ' cli-test ', firstNames: 'Ana', lastNames: 'Perez',
      phone: '999111222', businessName: 'Empresa', address: 'Direccion'
    };

    assert.equal((await request('', 'GET')).status, 401);
    assert.equal((await request('', 'POST', companyToken, { ...payload, companyId })).status, 400);
    assert.equal((await request('', 'POST', companyToken, { ...payload, phone: '' })).status, 400);

    const createdResponse = await request('', 'POST', companyToken, payload);
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).data;
    assert.equal(created.companyId, companyId);
    assert.equal(created.code, 'CLI-TEST');
    assert.equal(created.status, 'ACTIVE');
    assert.equal((await request('', 'POST', companyToken, payload)).status, 409);
    assert.equal((await request('', 'POST', otherToken, payload)).status, 201);

    const secondResponse = await request('', 'POST', companyToken, {
      ...payload, code: 'cli-ana-otro', firstNames: 'Carlos', lastNames: 'Gomez', businessName: null
    });
    assert.equal(secondResponse.status, 201);
    const second = (await secondResponse.json()).data;
    await client.query(`INSERT INTO loans (company_id, customer_id, status)
      VALUES ($1, $2, 'ACTIVE'), ($3, $4, 'ACTIVE')`,
    [companyId, created.id, otherCompanyId, second.id]);
    const withoutLoan = await request('?withoutLoan=true&search=ana&page=1&limit=1', 'GET', companyToken);
    const withoutLoanBody = await withoutLoan.json();
    assert.deepEqual(withoutLoanBody.data.map(customer => customer.id), [second.id]);
    assert.equal(withoutLoanBody.data[0].loansCount, 0);
    assert.deepEqual(withoutLoanBody.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
    for (const loanStatus of ['PAID', 'CANCELLED', 'OVERDUE', 'PENDING_DISBURSEMENT']) {
      await client.query('UPDATE loans SET status = $1 WHERE company_id = $2 AND customer_id = $3',
        [loanStatus, companyId, created.id]);
      const filtered = await request('?withoutLoan=true', 'GET', companyToken);
      assert.deepEqual((await filtered.json()).data.map(customer => customer.id), [second.id]);
    }
    await client.query(`INSERT INTO loans (company_id, customer_id, status)
      VALUES ($1, $2, 'PAID'), ($1, $2, 'CANCELLED')`, [companyId, created.id]);
    const unfiltered = await request('?withoutLoan=false', 'GET', companyToken);
    const unfilteredBody = await unfiltered.json();
    assert.equal(unfilteredBody.pagination.total, 2);
    assert.equal(unfilteredBody.data.find(customer => customer.id === created.id).loansCount, 3);
    assert.equal(unfilteredBody.data.find(customer => customer.id === second.id).loansCount, 0);
    const noEligible = await request('?withoutLoan=true&search=cli-test', 'GET', companyToken);
    assert.deepEqual((await noEligible.json()).data, []);
    assert.equal((await request('?withoutLoan=yes', 'GET', companyToken)).status, 400);
    assert.equal((await request('?withoutLoan=true&withoutLoan=false', 'GET', companyToken)).status, 400);
    const firstPage = await request('?page=1&limit=1', 'GET', companyToken);
    const firstPageBody = await firstPage.json();
    assert.equal(firstPageBody.data.length, 1);
    assert.deepEqual(firstPageBody.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
    const secondPage = await request('?page=2&limit=1', 'GET', companyToken);
    const secondPageBody = await secondPage.json();
    assert.equal(secondPageBody.data.length, 1);
    assert.notEqual(firstPageBody.data[0].id, secondPageBody.data[0].id);
    assert.deepEqual([firstPageBody.data[0].loansCount, secondPageBody.data[0].loansCount].sort(), [0, 3]);
    const emptyPage = await request('?page=3&limit=1', 'GET', companyToken);
    assert.deepEqual((await emptyPage.json()).pagination, { page: 3, limit: 1, total: 2, totalPages: 2 });

    const byCode = await request('?search=otro', 'GET', companyToken);
    assert.equal((await byCode.json()).data[0].id, second.id);
    const byName = await request('?search=ana%20perez', 'GET', companyToken);
    assert.equal((await byName.json()).data[0].id, created.id);
    const byBusiness = await request('?search=empresa', 'GET', companyToken);
    assert.equal((await byBusiness.json()).data[0].id, created.id);
    const byEither = await request('?search=ana&limit=1&page=2', 'GET', companyToken);
    const byEitherBody = await byEither.json();
    assert.equal(byEitherBody.data.length, 1);
    assert.deepEqual(byEitherBody.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });
    const noMatch = await request('?search=not-found', 'GET', companyToken);
    const noMatchBody = await noMatch.json();
    assert.deepEqual(noMatchBody.data, []);
    assert.equal(noMatchBody.pagination.total, 0);
    const literalWildcard = await request('?search=%25', 'GET', companyToken);
    assert.equal((await literalWildcard.json()).pagination.total, 0);
    for (const query of ['?page=0', '?page=1.5', '?page=1&page=2', '?limit=101', '?limit=', '?search=a&search=b', '?code=otro']) {
      assert.equal((await request(query, 'GET', companyToken)).status, 400);
    }

    const otherList = await request('', 'GET', otherToken);
    const otherListBody = await otherList.json();
    assert.equal(otherListBody.data.length, 1);
    assert.equal(otherListBody.data[0].loansCount, 0);
    const otherSearch = await request('?search=otro', 'GET', otherToken);
    assert.equal((await otherSearch.json()).pagination.total, 0);
    assert.equal((await request(`/${created.id}`, 'PATCH', otherToken, { phone: '1' })).status, 404);
    assert.equal((await request(`/${created.id}`, 'DELETE', otherToken)).status, 404);
    assert.equal((await request('/not-a-uuid', 'DELETE', companyToken)).status, 400);
    assert.equal((await request(`/${created.id}`, 'PATCH', companyToken, {})).status, 400);

    const updated = await request(`/${created.id}`, 'PATCH', companyToken, {
      phone: '123', businessName: null
    });
    assert.equal(updated.status, 200);
    const updatedCustomer = (await updated.json()).data;
    assert.equal(updatedCustomer.phone, '123');
    assert.equal(updatedCustomer.businessName, null);
    assert.equal(updatedCustomer.firstNames, 'Ana');

    const deleted = await request(`/${created.id}`, 'DELETE', companyToken);
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).data.status, 'INACTIVE');
    const list = await request('?search=cli-test', 'GET', companyToken);
    assert.equal((await list.json()).data[0].status, 'INACTIVE');
    const reactivated = await request(`/${created.id}`, 'PATCH', companyToken, { status: 'ACTIVE' });
    assert.equal((await reactivated.json()).data.status, 'ACTIVE');
  } finally {
    if (server) {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    pool.query = originalQuery;
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});