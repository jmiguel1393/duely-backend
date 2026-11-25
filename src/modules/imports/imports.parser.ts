import ExcelJS from 'exceljs';

import {
  ImportData,
  CustomerImport,
  LoanImport,
  UserImport,
  AssignmentImport,
  CollectionDayImport
} from './imports.types.js';

function getValue(
  row: ExcelJS.Row,
  column: number
): string {
  const value = row.getCell(column).value;

  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }

  if (typeof value === 'object' && 'text' in value) {
    return String(value.text).trim();
  }

  return String(value).trim();
}

function getNumber(
  row: ExcelJS.Row,
  column: number
): number {
  const value = row.getCell(column).value;

  if (typeof value === 'number') {
    return value;
  }

  if (value === null || value === undefined || value === '') {
    return 0;
  }

  return Number(value);
}

function getSheet(
  workbook: ExcelJS.Workbook,
  name: string
): ExcelJS.Worksheet {
  const sheet = workbook.getWorksheet(name);

  if (!sheet) {
    throw new Error(`No se encontró la hoja ${name}`);
  }

  return sheet;
}

export async function parseImportFile(
  buffer: Buffer
): Promise<ImportData> {
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer as never);

  const customersSheet = getSheet(workbook, 'Clientes');
  const loansSheet = getSheet(workbook, 'Prestamos');
  const usersSheet = getSheet(workbook, 'Usuarios');
  const assignmentsSheet = getSheet(workbook, 'Asignaciones');
  const collectionDaysSheet = getSheet(workbook, 'Dias_Cobro');

  const customers: CustomerImport[] = [];

  customersSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const code = getValue(row, 1);

    if (!code) return;

    customers.push({
      rowNumber,
      code,
      firstNames: getValue(row, 2),
      lastNames: getValue(row, 3),
      businessName: getValue(row, 4) || undefined,
      phone: getValue(row, 5),
      address: getValue(row, 6) || undefined
    });
  });

  const loans: LoanImport[] = [];

  loansSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const code = getValue(row, 1);

    if (!code) return;

    loans.push({
      rowNumber,
      code,
      customerCode: getValue(row, 2),
      principalAmount: getNumber(row, 3),
      installmentsCount: getNumber(row, 4),
      paymentFrequency: getValue(row, 5).toUpperCase(),
      interestType: getValue(row, 6).toUpperCase(),
      interestMode: getValue(row, 7).toUpperCase(),
      interestValue: getNumber(row, 8),
      startDate: getValue(row, 9),
      disbursementDate: getValue(row, 10) || undefined,
      observations: getValue(row, 11) || undefined
    });
  });

  const users: UserImport[] = [];

  usersSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const email = getValue(row, 1);

    if (!email) return;

    users.push({
      rowNumber,
      email: email.toLowerCase(),
      fullName: getValue(row, 2),
      role: getValue(row, 3).toUpperCase(),
      reportsToEmail: getValue(row, 4).toLowerCase() || undefined
    });
  });

  const assignments: AssignmentImport[] = [];

  assignmentsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const customerCode = getValue(row, 1);

    if (!customerCode) return;

    assignments.push({
      rowNumber,
      customerCode,
      assignedToEmail: getValue(row, 2).toLowerCase(),
      supervisorEmail: getValue(row, 3).toLowerCase() || undefined
    });
  });

  const collectionDays: CollectionDayImport[] = [];

  collectionDaysSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const loanCode = getValue(row, 1);

    if (!loanCode) return;

    collectionDays.push({
      rowNumber,
      loanCode,
      dayType: getValue(row, 2).toUpperCase(),
      dayValue: getValue(row, 3).toUpperCase()
    });
  });

  return {
    customers,
    loans,
    users,
    assignments,
    collectionDays
  };
}