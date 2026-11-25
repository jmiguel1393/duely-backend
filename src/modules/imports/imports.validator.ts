import {
  CollectionDayImport,
  ImportData,
  ImportError,
  ImportValidationResult
} from './imports.types.js';

import {
  findCustomersByCodes,
  findUsersByEmails,
  findCustomersWithActiveLoans
} from './imports.repository.js';

const frequencies = [
  'DIARIA',
  'SEMANAL',
  'QUINCENAL',
  'CATORCENAL',
  'MENSUAL'
];

const interestTypes = ['PORCENTAJE', 'MONTO'];
const interestModes = ['TOTAL_PRESTAMO', 'POR_CUOTA'];

const weekdays = [
  'LUNES',
  'MARTES',
  'MIERCOLES',
  'JUEVES',
  'VIERNES',
  'SABADO',
  'DOMINGO'
];

function addError(
  errors: ImportError[],
  sheet: string,
  row: number,
  field: string,
  message: string
): void {
  errors.push({ sheet, row, field, message });
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function validateInternalData(data: ImportData): ImportError[] {
  const errors: ImportError[] = [];

  const customerCodes = new Map<string, number>();
  const loanCodes = new Map<string, number>();
  const customerLoanCounts = new Map<string, number>();
  const assignmentCustomers = new Map<string, number>();

  // CLIENTES
  for (const customer of data.customers) {
    const code = customer.code.trim().toUpperCase();

    if (!code) {
      addError(errors, 'Clientes', customer.rowNumber, 'cliente_codigo',
        'El código del cliente es obligatorio.');
    } else if (customerCodes.has(code)) {
      addError(errors, 'Clientes', customer.rowNumber, 'cliente_codigo',
        `Código duplicado. También aparece en la fila ${customerCodes.get(code)}.`);
    } else {
      customerCodes.set(code, customer.rowNumber);
    }

    if (!customer.firstNames.trim()) {
      addError(errors, 'Clientes', customer.rowNumber, 'nombres',
        'Los nombres son obligatorios.');
    }

    if (!customer.lastNames.trim()) {
      addError(errors, 'Clientes', customer.rowNumber, 'apellidos',
        'Los apellidos son obligatorios.');
    }

    if (!customer.phone.trim()) {
      addError(errors, 'Clientes', customer.rowNumber, 'telefono',
        'El teléfono es obligatorio.');
    }
  }

  // PRÉSTAMOS
  for (const loan of data.loans) {
    const code = loan.code.trim().toUpperCase();

    if (!code) {
      addError(errors, 'Prestamos', loan.rowNumber, 'prestamo_codigo',
        'El código del préstamo es obligatorio.');
    } else if (loanCodes.has(code)) {
      addError(errors, 'Prestamos', loan.rowNumber, 'prestamo_codigo',
        `Código duplicado. También aparece en la fila ${loanCodes.get(code)}.`);
    } else {
      loanCodes.set(code, loan.rowNumber);
    }

    if (!loan.customerCode.trim()) {
      addError(errors, 'Prestamos', loan.rowNumber, 'cliente_codigo',
        'Debes indicar el cliente del préstamo.');
    } else if (!customerCodes.has(loan.customerCode.trim().toUpperCase())) {
      addError(errors, 'Prestamos', loan.rowNumber, 'cliente_codigo',
        'El cliente no existe en la hoja Clientes.');
    }

    if (!Number.isFinite(loan.principalAmount) || loan.principalAmount <= 0) {
      addError(errors, 'Prestamos', loan.rowNumber, 'monto_prestamo',
        'El monto debe ser mayor que cero.');
    }

    if (!Number.isInteger(loan.installmentsCount) || loan.installmentsCount <= 0) {
      addError(errors, 'Prestamos', loan.rowNumber, 'numero_cuotas',
        'El número de cuotas debe ser un entero mayor que cero.');
    }

    if (!frequencies.includes(loan.paymentFrequency)) {
      addError(errors, 'Prestamos', loan.rowNumber, 'frecuencia_pago',
        'La frecuencia de pago no es válida.');
    }

    if (!interestTypes.includes(loan.interestType)) {
      addError(errors, 'Prestamos', loan.rowNumber, 'tipo_interes',
        'Usa PORCENTAJE o MONTO.');
    }

    if (!interestModes.includes(loan.interestMode)) {
      addError(errors, 'Prestamos', loan.rowNumber, 'base_interes',
        'Usa TOTAL_PRESTAMO o POR_CUOTA.');
    }

    if (!Number.isFinite(loan.interestValue) || loan.interestValue < 0) {
      addError(errors, 'Prestamos', loan.rowNumber, 'tasa_interes',
        'El interés no puede ser negativo.');
    }

    if (
      loan.interestType === 'PORCENTAJE' &&
      loan.interestValue > 100
    ) {
      addError(errors, 'Prestamos', loan.rowNumber, 'tasa_interes',
        'El porcentaje no puede superar el 100%.');
    }

    if (!isValidDate(loan.startDate)) {
      addError(errors, 'Prestamos', loan.rowNumber, 'fecha_inicio',
        'La fecha debe tener formato AAAA-MM-DD y ser válida.');
    }

    if (loan.disbursementDate && !isValidDate(loan.disbursementDate)) {
      addError(errors, 'Prestamos', loan.rowNumber, 'fecha_desembolso',
        'La fecha de desembolso no es válida.');
    }

    const customerCode = loan.customerCode.trim().toUpperCase();

    if (customerCode) {
      const count = (customerLoanCounts.get(customerCode) ?? 0) + 1;
      customerLoanCounts.set(customerCode, count);

      if (count > 1) {
        addError(errors, 'Prestamos', loan.rowNumber, 'cliente_codigo',
          'Un cliente no puede recibir más de un préstamo en esta importación.');
      }
    }

    // Validar exclusividad de días de cobranza
    const collectionDaysByLoan = new Map<
      string,
      CollectionDayImport[]
    >();

    for (const day of data.collectionDays) {
      const current = collectionDaysByLoan.get(day.loanCode) ?? [];
      current.push(day);

      collectionDaysByLoan.set(day.loanCode, current);
    }

    for (const [loanCode, days] of collectionDaysByLoan) {
      const hasWeekdays = days.some(
        day => day.dayType === 'DIA_SEMANA'
      );

      const hasMonthDays = days.some(
        day => day.dayType === 'DIA_MES'
      );

      if (hasWeekdays && hasMonthDays) {
        for (const day of days) {
          addError(
            errors,
            'Dias_Cobro',
            day.rowNumber,
            'tipo_regla',
            `El préstamo ${loanCode} no puede combinar DIA_SEMANA y DIA_MES. Utiliza solamente un tipo de regla.`
          );
        }
      }
    }
  }

  // USUARIOS
  const userEmails = new Map<string, number>();

  for (const user of data.users) {
    const email = user.email.trim().toLowerCase();

    if (!email) {
      addError(errors, 'Usuarios', user.rowNumber, 'usuario_email',
        'El correo es obligatorio.');
    } else if (userEmails.has(email)) {
      addError(errors, 'Usuarios', user.rowNumber, 'usuario_email',
        `Correo duplicado. También aparece en la fila ${userEmails.get(email)}.`);
    } else {
      userEmails.set(email, user.rowNumber);
    }

    if (!['RESPONSABLE', 'SUPERVISOR'].includes(user.role)) {
      addError(errors, 'Usuarios', user.rowNumber, 'rol',
        'El rol debe ser RESPONSABLE o SUPERVISOR.');
    }
  }

  // ASIGNACIONES
  for (const assignment of data.assignments) {
    const customerCode = assignment.customerCode.trim().toUpperCase();

    if (!customerCodes.has(customerCode)) {
      addError(errors, 'Asignaciones', assignment.rowNumber, 'cliente_codigo',
        'El cliente no existe en la hoja Clientes.');
    }

    if (!assignment.assignedToEmail.trim()) {
      addError(errors, 'Asignaciones', assignment.rowNumber, 'asignado_a_email',
        'Debes indicar el responsable o supervisor.');
    }

    if (assignmentCustomers.has(customerCode)) {
      addError(errors, 'Asignaciones', assignment.rowNumber, 'cliente_codigo',
        'El cliente tiene más de una asignación en el archivo.');
    } else {
      assignmentCustomers.set(customerCode, assignment.rowNumber);
    }
  }

  // DÍAS PERSONALIZADOS
  for (const day of data.collectionDays) {
    const loanCode = day.loanCode.trim().toUpperCase();

    if (!loanCodes.has(loanCode)) {
      addError(errors, 'Dias_Cobro', day.rowNumber, 'prestamo_codigo',
        'El préstamo no existe en la hoja Prestamos.');
    }

    if (day.dayType === 'DIA_SEMANA') {
      if (
        typeof day.dayValue !== 'string' ||
        !weekdays.includes(day.dayValue)
      ) {
        addError(errors, 'Dias_Cobro', day.rowNumber, 'dia_cobro',
          'El día de semana no es válido.');
      }
    } else if (day.dayType === 'DIA_MES') {
      const value = Number(day.dayValue);

      if (!Number.isInteger(value) || value < 1 || value > 31) {
        addError(errors, 'Dias_Cobro', day.rowNumber, 'dia_cobro',
          'El día del mes debe estar entre 1 y 31.');
      }
    } else {
      addError(errors, 'Dias_Cobro', day.rowNumber, 'tipo_regla',
        'Usa DIA_SEMANA o DIA_MES.');
    }
  }

  return errors;
}

async function validateDatabaseData(
  data: ImportData,
  companyId: string
): Promise<ImportError[]> {
  const errors: ImportError[] = [];

  // 1. Clientes existentes
  const customerCodes = data.customers
    .map(customer => customer.code.trim().toUpperCase())
    .filter(Boolean);

  const existingCustomers = await findCustomersByCodes(
    companyId,
    customerCodes
  );

  const existingCustomerCodes = new Set(
    existingCustomers.map(customer => customer.code.toUpperCase())
  );

  for (const customer of data.customers) {
    if (existingCustomerCodes.has(customer.code.trim().toUpperCase())) {
      addError(
        errors,
        'Clientes',
        customer.rowNumber,
        'cliente_codigo',
        'Ya existe un cliente con este código en Duely.'
      );
    }
  }

  // 2. Usuarios existentes
  const emails = [
    ...data.users.map(user => user.email),
    ...data.assignments.flatMap(assignment => [
      assignment.assignedToEmail,
      assignment.supervisorEmail ?? ''
    ])
  ]
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);

  const uniqueEmails = [...new Set(emails)];

  const existingUsers = await findUsersByEmails(
    companyId,
    uniqueEmails
  );

  const usersByEmail = new Map(
    existingUsers.map(user => [user.email.toLowerCase(), user])
  );

  // Validar la hoja Usuarios
  for (const importedUser of data.users) {
    const email = importedUser.email.toLowerCase();
    const existingUser = usersByEmail.get(email);

    if (!existingUser) {
      addError(
        errors,
        'Usuarios',
        importedUser.rowNumber,
        'usuario_email',
        'El usuario no existe en esta empresa.'
      );
      continue;
    }

    if (existingUser.status !== 'ACTIVE') {
      addError(
        errors,
        'Usuarios',
        importedUser.rowNumber,
        'usuario_email',
        'El usuario no está activo.'
      );
    }

    if (existingUser.role !== importedUser.role) {
      addError(
        errors,
        'Usuarios',
        importedUser.rowNumber,
        'rol',
        `El rol registrado en Duely es ${existingUser.role}.`
      );
    }

    if (
      importedUser.reportsToEmail &&
      importedUser.reportsToEmail.toLowerCase() !==
      existingUser.reportsToEmail?.toLowerCase()
    ) {
      addError(
        errors,
        'Usuarios',
        importedUser.rowNumber,
        'reporta_a_email',
        'El supervisor indicado no coincide con la jerarquía registrada en Duely.'
      );
    }
  }

  // 3. Validar asignaciones
  for (const assignment of data.assignments) {
    const assignedEmail = assignment.assignedToEmail.toLowerCase();
    const assignedUser = usersByEmail.get(assignedEmail);

    if (!assignedUser) {
      addError(
        errors,
        'Asignaciones',
        assignment.rowNumber,
        'asignado_a_email',
        'El responsable o supervisor no existe en esta empresa.'
      );
      continue;
    }

    if (assignedUser.status !== 'ACTIVE') {
      addError(
        errors,
        'Asignaciones',
        assignment.rowNumber,
        'asignado_a_email',
        'El usuario asignado no está activo.'
      );
    }

    if (!['RESPONSABLE', 'SUPERVISOR'].includes(assignedUser.role)) {
      addError(
        errors,
        'Asignaciones',
        assignment.rowNumber,
        'asignado_a_email',
        'Solo puedes asignar clientes a responsables o supervisores.'
      );
    }

    if (assignment.supervisorEmail) {
      const supervisor = usersByEmail.get(
        assignment.supervisorEmail.toLowerCase()
      );

      if (!supervisor || supervisor.role !== 'SUPERVISOR') {
        addError(
          errors,
          'Asignaciones',
          assignment.rowNumber,
          'supervisor_email',
          'El supervisor indicado no existe o no tiene el rol SUPERVISOR.'
        );
      } else if (
        assignedUser.role !== 'RESPONSABLE' ||
        assignedUser.reportsToEmail?.toLowerCase() !==
        supervisor.email.toLowerCase()
      ) {
        addError(
          errors,
          'Asignaciones',
          assignment.rowNumber,
          'supervisor_email',
          'El supervisor no corresponde a la jerarquía del responsable asignado.'
        );
      }
    }
  }

  // 4. Clientes existentes con préstamos activos
  const existingCustomerIds = existingCustomers.map(customer => customer.id);

  const customersWithActiveLoans = new Set(
    await findCustomersWithActiveLoans(companyId, existingCustomerIds)
  );

  const existingCustomerIdByCode = new Map(
    existingCustomers.map(customer => [
      customer.code.toUpperCase(),
      customer.id
    ])
  );

  for (const loan of data.loans) {
    const customerId = existingCustomerIdByCode.get(
      loan.customerCode.trim().toUpperCase()
    );

    if (customerId && customersWithActiveLoans.has(customerId)) {
      addError(
        errors,
        'Prestamos',
        loan.rowNumber,
        'cliente_codigo',
        'El cliente ya tiene un préstamo activo en Duely.'
      );
    }
  }

  return errors;
}

export async function validateImport(
  data: ImportData,
  companyId: string
): Promise<ImportValidationResult> {
  const internalErrors = validateInternalData(data);

  const databaseErrors = await validateDatabaseData(
    data,
    companyId
  );

  const errors = [...internalErrors, ...databaseErrors];

  return {
    valid: errors.length === 0,
    summary: {
      customers: data.customers.length,
      loans: data.loans.length,
      users: data.users.length,
      assignments: data.assignments.length,
      collectionDays: data.collectionDays.length,
      errors: errors.length
    },
    errors
  };
}