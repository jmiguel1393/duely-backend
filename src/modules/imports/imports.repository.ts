import { pool } from '../../infrastructure/database/connection.js';
import { generateLoanSchedule } from '../loans/loans.schedule.js';
import { mapLoanToScheduleInput } from './imports.mapper.js';
import type {
  ImportData,
  ImportError
} from './imports.types.js';

export interface ExistingCustomer {
  id: string;
  code: string;
}

export interface ExistingUser {
  id: string;
  email: string;
  role: string;
  status: string;
  reportsToEmail: string | null;
}

interface CreateImportBatchParams {
  companyId: string;
  userId: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  previewData: unknown;
}

interface ImportPreviewStored {
  data: ImportData;
  validation: {
    valid: boolean;
    errors: ImportError[];
  };
}

interface ConfirmImportParams {
  importBatchId: string;
  companyId: string;
  userId: string;
}

export interface ConfirmImportResult {
  importBatchId: string;
  customersCreated: number;
  loansCreated: number;
  installmentsCreated: number;
  assignmentsCreated: number;
  collectionDaysCreated: number;
}

export async function confirmImportBatch(
  params: ConfirmImportParams
): Promise<ConfirmImportResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Bloquear el lote para evitar confirmaciones simultáneas.
    const batchResult = await client.query(
      `SELECT id, company_id, created_by_user_id, status, preview_data
       FROM import_batches
       WHERE id = $1 AND company_id = $2
       FOR UPDATE`,
      [params.importBatchId, params.companyId]
    );

    if (batchResult.rowCount === 0) {
      throw new Error('Importación no encontrada.');
    }

    const batch = batchResult.rows[0];

    if (batch.status !== 'PREVIEWED') {
      throw new Error(
        `La importación no puede confirmarse. Estado actual: ${batch.status}`
      );
    }

    const preview = batch.preview_data as ImportPreviewStored;

    if (!preview?.data || !preview?.validation) {
      throw new Error('La previsualización almacenada es inválida.');
    }

    if (!preview.validation.valid) {
      throw new Error(
        'No se puede confirmar una importación que contiene errores.'
      );
    }

    const data = preview.data;

    // 2. Validaciones críticas contra la BD dentro de la transacción.
    const customerCodes = data.customers.map(
      customer => customer.code.toUpperCase()
    );

    const loanCodes = data.loans.map(
      loan => loan.code.toUpperCase()
    );

    const existingCustomers = await client.query(
      `SELECT code
       FROM customers
       WHERE company_id = $1
         AND UPPER(code) = ANY($2::text[])`,
      [params.companyId, customerCodes]
    );

    if (existingCustomers.rowCount) {
      throw new Error(
        'Uno o más códigos de cliente ya existen. Genera una nueva previsualización.'
      );
    }

    const existingLoans = await client.query(
      `SELECT code
       FROM loans
       WHERE company_id = $1
         AND UPPER(code) = ANY($2::text[])`,
      [params.companyId, loanCodes]
    );

    if (existingLoans.rowCount) {
      throw new Error(
        'Uno o más códigos de préstamo ya existen. Genera una nueva previsualización.'
      );
    }

    // 3. Resolver usuarios de las asignaciones.
    const assignmentEmails = [
      ...new Set(
        data.assignments.flatMap(assignment => [
          assignment.assignedToEmail.toLowerCase(),
          ...(assignment.supervisorEmail
            ? [assignment.supervisorEmail.toLowerCase()]
            : [])
        ])
      )];

    const userResult = await client.query(
      `SELECT
          u.id,
          LOWER(u.email) AS email,
          u.role,
          u.status,
          LOWER(supervisor.email) AS "reportsToEmail"
       FROM users u
       LEFT JOIN users supervisor
         ON supervisor.company_id = u.company_id
        AND supervisor.id = u.reports_to_user_id
       WHERE u.company_id = $1
         AND LOWER(u.email) = ANY($2::text[])`,
      [params.companyId, assignmentEmails]
    );

    const usersByEmail = new Map(
      userResult.rows.map(user => [user.email, user])
    );

    for (const assignment of data.assignments) {
      const assignedEmail = assignment.assignedToEmail.toLowerCase();
      const assignedUser = usersByEmail.get(assignedEmail);

      if (!assignedUser || assignedUser.status !== 'ACTIVE') {
        throw new Error(
          `El usuario ${assignedEmail} ya no está disponible para asignación.`
        );
      }

      if (
        assignedUser.role !== 'RESPONSABLE' &&
        assignedUser.role !== 'SUPERVISOR'
      ) {
        throw new Error(
          `El usuario ${assignedEmail} no tiene un rol permitido para asignación.`
        );
      }

      if (assignment.supervisorEmail) {
        const supervisorEmail = assignment.supervisorEmail.toLowerCase();
        const supervisor = usersByEmail.get(supervisorEmail);

        if (
          !supervisor ||
          supervisor.status !== 'ACTIVE' ||
          supervisor.role !== 'SUPERVISOR'
        ) {
          throw new Error(
            `El supervisor ${supervisorEmail} ya no es válido.`
          );
        }

        if (
          assignedUser.role !== 'RESPONSABLE' ||
          assignedUser.reportsToEmail !== supervisorEmail
        ) {
          throw new Error(
            `La jerarquía de ${assignedEmail} ha cambiado.`
          );
        }
      }
    }

    // 4. Crear clientes.
    const customersByCode = new Map<string, string>();

    for (const customer of data.customers) {
      const result = await client.query(
        `INSERT INTO customers (
          company_id,
          code,
          first_names,
          last_names,
          business_name,
          phone,
          address,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
        RETURNING id`,
        [
          params.companyId,
          customer.code,
          customer.firstNames,
          customer.lastNames,
          customer.businessName ?? null,
          customer.phone,
          customer.address ?? null
        ]
      );

      customersByCode.set(
        customer.code.toUpperCase(),
        result.rows[0].id
      );
    }

    // 5. Crear préstamos y sus cuotas.
    const loansByCode = new Map<string, string>();
    let installmentsCreated = 0;
    let collectionDaysCreated = 0;

    const collectionDaysByLoan = new Map<
      string,
      typeof data.collectionDays
    >();

    for (const day of data.collectionDays) {
      const key = day.loanCode.toUpperCase();
      const current = collectionDaysByLoan.get(key) ?? [];

      current.push(day);
      collectionDaysByLoan.set(key, current);
    }

    for (const loan of data.loans) {
      const customerId = customersByCode.get(
        loan.customerCode.toUpperCase()
      );

      if (!customerId) {
        throw new Error(
          `No se encontró el cliente ${loan.customerCode}.`
        );
      }

      const loanDays = collectionDaysByLoan.get(
        loan.code.toUpperCase()
      ) ?? [];

      // Generar cronograma reutilizando el motor independiente.
      const scheduleInput = mapLoanToScheduleInput(
        loan,
        loanDays
      );

      const schedule = generateLoanSchedule(scheduleInput);

      const loanResult = await client.query(
        `INSERT INTO loans (
          company_id,
          customer_id,
          code,
          principal_amount,
          currency,
          installments_count,
          payment_frequency,
          interest_type,
          interest_value,
          interest_mode,
          start_date,
          disbursement_date,
          observations,
          status
        )
        VALUES (
          $1, $2, $3, $4, 'PEN', $5, $6, $7, $8, $9, $10, $11, $12, 'ACTIVE'
        )
        RETURNING id`,
        [
          params.companyId,
          customerId,
          loan.code,
          loan.principalAmount,
          loan.installmentsCount,
          scheduleInput.paymentFrequency,
          scheduleInput.interestType,
          loan.interestValue,
          scheduleInput.interestMode,
          loan.startDate,
          loan.disbursementDate ?? null,
          loan.observations ?? null
        ]
      );

      const loanId = loanResult.rows[0].id;

      loansByCode.set(loan.code.toUpperCase(), loanId);

      // 5.1 Insertar las cuotas generadas.
      for (const installment of schedule.installments) {
        await client.query(
          `INSERT INTO loan_installments (
            company_id,
            loan_id,
            installment_number,
            due_date,
            principal_amount,
            interest_amount,
            total_amount,
            paid_amount,
            status
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'PENDING')`,
          [
            params.companyId,
            loanId,
            installment.installmentNumber,
            installment.dueDate,
            installment.principalAmount,
            installment.interestAmount,
            installment.totalAmount
          ]
        );

        installmentsCreated++;
      }

      // 5.2 Insertar días personalizados de cobranza.
      for (const day of loanDays) {
        const mappedDays = mapLoanToScheduleInput(
          loan,
          [day]
        ).collectionDays ?? [];

        const mappedDay = mappedDays[0];

        if (!mappedDay) {
          continue;
        }

        await client.query(
          `INSERT INTO loan_collection_days (
            company_id,
            loan_id,
            day_type,
            day_value
          )
          VALUES ($1, $2, $3, $4)`,
          [
            params.companyId,
            loanId,
            mappedDay.type,
            mappedDay.value
          ]
        );

        collectionDaysCreated++;
      }
    }

    // 6. Crear asignaciones.
    const customersByCodeForAssignment = customersByCode;

    let assignmentsCreated = 0;

    for (const assignment of data.assignments) {
      const customerId = customersByCodeForAssignment.get(
        assignment.customerCode.toUpperCase()
      );

      const assignedUser = usersByEmail.get(
        assignment.assignedToEmail.toLowerCase()
      );

      if (!customerId || !assignedUser) {
        throw new Error(
          `No se pudo resolver la asignación del cliente ${assignment.customerCode}.`
        );
      }

      await client.query(
        `INSERT INTO customer_assignments (
          company_id,
          customer_id,
          assigned_to_user_id,
          assigned_by_user_id
        )
        VALUES ($1, $2, $3, $4)`,
        [
          params.companyId,
          customerId,
          assignedUser.id,
          params.userId
        ]
      );

      assignmentsCreated++;
    }

    // 7. Marcar lote como confirmado.
    await client.query(
      `UPDATE import_batches
       SET status = 'CONFIRMED',
           confirmed_at = NOW()
       WHERE id = $1 AND company_id = $2`,
      [params.importBatchId, params.companyId]
    );

    // 8. Confirmar la transacción.
    await client.query('COMMIT');

    return {
      importBatchId: params.importBatchId,
      customersCreated: data.customers.length,
      loansCreated: data.loans.length,
      installmentsCreated,
      assignmentsCreated,
      collectionDaysCreated
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function findCustomersByCodes(
  companyId: string,
  codes: string[]
): Promise<ExistingCustomer[]> {
  if (!codes.length) return [];

  const normalizedCodes = codes.map(code => code.toUpperCase());

  const result = await pool.query(
    `SELECT id, code
     FROM customers
     WHERE company_id = $1
       AND UPPER(code) = ANY($2::text[])`,
    [companyId, normalizedCodes]
  );

  return result.rows;
}

export async function findUsersByEmails(
  companyId: string,
  emails: string[]
): Promise<ExistingUser[]> {
  if (!emails.length) return [];

  const result = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.role,
       u.status,
       supervisor.email AS "reportsToEmail"
     FROM users u
     LEFT JOIN users supervisor
       ON supervisor.company_id = u.company_id
      AND supervisor.id = u.reports_to_user_id
     WHERE u.company_id = $1
       AND LOWER(u.email) = ANY($2::text[])`,
    [companyId, emails]
  );

  return result.rows;
}

export async function findCustomersWithActiveLoans(
  companyId: string,
  customerIds: string[]
): Promise<string[]> {
  if (!customerIds.length) return [];

  const result = await pool.query(
    `SELECT DISTINCT customer_id
     FROM loans
     WHERE company_id = $1
       AND customer_id = ANY($2::uuid[])
       AND status IN (
         'PENDING_DISBURSEMENT',
         'ACTIVE',
         'OVERDUE'
       )`,
    [companyId, customerIds]
  );

  return result.rows.map((row) => row.customer_id);
}

export async function createImportBatch(
  params: CreateImportBatchParams
): Promise<{ id: string; createdAt: Date }> {
  const result = await pool.query(
    `INSERT INTO import_batches (
      company_id,
      created_by_user_id,
      file_name,
      status,
      total_rows,
      valid_rows,
      error_rows,
      preview_data
    )
    VALUES ($1, $2, $3, 'PREVIEWED', $4, $5, $6, $7::jsonb)
    RETURNING id, created_at AS "createdAt"`,
    [
      params.companyId,
      params.userId,
      params.fileName,
      params.totalRows,
      params.validRows,
      params.errorRows,
      JSON.stringify(params.previewData)
    ]
  );

  return result.rows[0];
}