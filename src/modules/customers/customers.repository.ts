import { pool } from '../../infrastructure/database/connection.js';
import type { CreateCustomerInput, ListCustomersInput, UpdateCustomerInput } from './customers.schemas.js';

const customerColumns = `id, company_id AS "companyId", code,
  first_names AS "firstNames", last_names AS "lastNames",
  business_name AS "businessName", phone, address, status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listCustomers(companyId: string, input: ListCustomersInput) {
  const result = await pool.query(
    `WITH filtered AS (
       SELECT * FROM customers
       WHERE company_id = $1
            AND ($2::text = '' OR POSITION(LOWER($2) IN LOWER(code)) > 0
              OR POSITION(LOWER($2) IN LOWER(first_names || ' ' || last_names)) > 0
              OR POSITION(LOWER($2) IN LOWER(COALESCE(business_name, ''))) > 0)
     )
     SELECT page.*, counts.total
     FROM (SELECT COUNT(*)::text AS total FROM filtered) counts
     LEFT JOIN LATERAL (
       SELECT ${customerColumns} FROM filtered
       ORDER BY created_at DESC, id
      LIMIT $3 OFFSET $4
     ) page ON TRUE
     ORDER BY page."createdAt" DESC, page.id`,
    [companyId, input.search ?? '', input.limit, (input.page - 1) * input.limit]
  );
  const total = Number(result.rows[0].total);
  const data = result.rows
    .filter(row => row.id !== null)
    .map(({ total: _total, ...customer }) => customer);
  return {
    data,
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit)
    }
  };
}

export async function createCustomer(companyId: string, input: CreateCustomerInput) {
  const result = await pool.query(
    `INSERT INTO customers (company_id, code, first_names, last_names, business_name, phone, address)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${customerColumns}`,
    [companyId, input.code, input.firstNames, input.lastNames,
      input.businessName ?? null, input.phone, input.address ?? null]
  );
  return result.rows[0];
}

export async function updateCustomer(
  companyId: string,
  customerId: string,
  input: UpdateCustomerInput
) {
  const columnNames: Record<keyof UpdateCustomerInput, string> = {
    code: 'code',
    firstNames: 'first_names',
    lastNames: 'last_names',
    businessName: 'business_name',
    phone: 'phone',
    address: 'address',
    status: 'status'
  };
  const values: unknown[] = [companyId, customerId];
  const assignments = (Object.keys(input) as (keyof UpdateCustomerInput)[]).map(key => {
    values.push(input[key]);
    return `${columnNames[key]} = $${values.length}`;
  });
  const result = await pool.query(
    `UPDATE customers SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE company_id = $1 AND id = $2
     RETURNING ${customerColumns}`,
    values
  );
  return result.rows[0] ?? null;
}

export async function deactivateCustomer(companyId: string, customerId: string) {
  const result = await pool.query(
    `UPDATE customers SET status = 'INACTIVE', updated_at = NOW()
     WHERE company_id = $1 AND id = $2
     RETURNING ${customerColumns}`,
    [companyId, customerId]
  );
  return result.rows[0] ?? null;
}