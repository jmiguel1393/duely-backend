import {
  CollectionDayRule,
  LoanScheduleInput,
  LoanScheduleInstallment,
  LoanScheduleResult
} from './loans.types.js';

import {
  addDays,
  createDate,
  distributeAmount,
  formatDate,
  fromCents,
  getLastDayOfMonth,
  parseDate,
  toCents
} from './loans.utils.js';

const WEEK_DAYS = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7
};

function getIsoWeekDay(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

function validateCollectionDays(
  collectionDays: CollectionDayRule[]
): void {
  const types = new Set(collectionDays.map(day => day.type));

  if (types.size > 1) {
    throw new Error(
      'No se pueden combinar días de semana y días del mes.'
    );
  }

  for (const day of collectionDays) {
    if (day.type === 'DAY_OF_WEEK') {
      if (!Number.isInteger(day.value) || day.value < 1 || day.value > 7) {
        throw new Error(
          `Día de semana inválido: ${day.value}. Utiliza valores del 1 al 7.`
        );
      }
    }

    if (day.type === 'DAY_OF_MONTH') {
      if (!Number.isInteger(day.value) || day.value < 1 || day.value > 31) {
        throw new Error(
          `Día del mes inválido: ${day.value}. Utiliza valores del 1 al 31.`
        );
      }
    }
  }
}

function generateRegularDates(
  startDate: Date,
  frequency: LoanScheduleInput['paymentFrequency'],
  count: number
): Date[] {
  const dates: Date[] = [];

  if (
    frequency === 'DAILY' ||
    frequency === 'WEEKLY' ||
    frequency === 'FORTNIGHTLY'
  ) {
    const interval =
      frequency === 'DAILY' ? 1 :
      frequency === 'WEEKLY' ? 7 : 14;

    for (let i = 0; i < count; i++) {
      dates.push(addDays(startDate, i * interval));
    }

    return dates;
  }

  if (frequency === 'MONTHLY') {
    const anchorDay = startDate.getUTCDate();

    for (let i = 0; i < count; i++) {
      dates.push(
        createDate(
          startDate.getUTCFullYear(),
          startDate.getUTCMonth() + i,
          anchorDay
        )
      );
    }

    return dates;
  }

  if (frequency === 'BIWEEKLY') {
    let year = startDate.getUTCFullYear();
    let month = startDate.getUTCMonth();

    while (dates.length < count) {
      const candidates = [
        createDate(year, month, 15),
        createDate(year, month, getLastDayOfMonth(year, month))
      ];

      for (const candidate of candidates) {
        if (
          candidate.getTime() >= startDate.getTime() &&
          !dates.some(date => date.getTime() === candidate.getTime())
        ) {
          dates.push(candidate);
        }
      }

      month++;

      if (month > 11) {
        month = 0;
        year++;
      }
    }

    return dates.slice(0, count);
  }

  throw new Error(`Frecuencia de pago no soportada: ${frequency}`);
}

function generateCustomDates(
  startDate: Date,
  collectionDays: CollectionDayRule[],
  count: number
): Date[] {
  validateCollectionDays(collectionDays);

  const dates: Date[] = [];
  const type = collectionDays[0]?.type;

  if (!type) {
    return dates;
  }

  if (type === 'DAY_OF_WEEK') {
    const selectedDays = new Set(
      collectionDays.map(day => day.value)
    );

    let currentDate = new Date(startDate);
    let attempts = 0;

    while (dates.length < count) {
      if (selectedDays.has(getIsoWeekDay(currentDate))) {
        dates.push(new Date(currentDate));
      }

      currentDate = addDays(currentDate, 1);
      attempts++;

      if (attempts > 3650) {
        throw new Error('No fue posible generar el cronograma.');
      }
    }

    return dates;
  }

  if (type === 'DAY_OF_MONTH') {
    const selectedDays = [...new Set(
      collectionDays.map(day => day.value)
    )].sort((a, b) => a - b);

    let year = startDate.getUTCFullYear();
    let month = startDate.getUTCMonth();
    let attempts = 0;

    while (dates.length < count) {
      for (const selectedDay of selectedDays) {
        const candidate = createDate(year, month, selectedDay);

        if (
          candidate.getTime() >= startDate.getTime() &&
          !dates.some(date => date.getTime() === candidate.getTime())
        ) {
          dates.push(candidate);
        }

        if (dates.length >= count) {
          break;
        }
      }

      month++;

      if (month > 11) {
        month = 0;
        year++;
      }

      attempts++;

      if (attempts > 1200) {
        throw new Error('No fue posible generar el cronograma.');
      }
    }

    return dates.slice(0, count);
  }

  return dates;
}

function calculateInterest(
  input: LoanScheduleInput,
  principalCents: number
): number[] {
  const { installmentsCount, interestType, interestMode, interestValue } = input;

  const interestValueCents = toCents(interestValue);

  if (interestType === 'PERCENTAGE') {
    if (interestMode === 'TOTAL_LOAN') {
      const totalInterest = Math.round(
        principalCents * interestValue / 100
      );

      return distributeAmount(totalInterest, installmentsCount);
    }

    const interestPerInstallment = Math.round(
      principalCents * interestValue / 100
    );

    return Array(installmentsCount).fill(interestPerInstallment);
  }

  if (interestMode === 'TOTAL_LOAN') {
    return distributeAmount(interestValueCents, installmentsCount);
  }

  return Array(installmentsCount).fill(interestValueCents);
}

export function generateLoanSchedule(
  input: LoanScheduleInput
): LoanScheduleResult {
  if (!Number.isFinite(input.principalAmount) || input.principalAmount <= 0) {
    throw new Error('El capital del préstamo debe ser mayor a cero.');
  }

  if (
    !Number.isInteger(input.installmentsCount) ||
    input.installmentsCount <= 0
  ) {
    throw new Error('La cantidad de cuotas debe ser un entero mayor a cero.');
  }

  if (!Number.isFinite(input.interestValue) || input.interestValue < 0) {
    throw new Error('El interés debe ser un valor mayor o igual a cero.');
  }

  const startDate = parseDate(input.startDate);
  const collectionDays = input.collectionDays ?? [];

  validateCollectionDays(collectionDays);

  const dates = collectionDays.length
    ? generateCustomDates(startDate, collectionDays, input.installmentsCount)
    : generateRegularDates(startDate, input.paymentFrequency, input.installmentsCount);

  if (dates.length !== input.installmentsCount) {
    throw new Error('No se pudo generar la cantidad de cuotas solicitada.');
  }

  const principalCents = toCents(input.principalAmount);

  const principalAmounts = distributeAmount(
    principalCents,
    input.installmentsCount
  );

  const interestAmounts = calculateInterest(input, principalCents);

  const installments: LoanScheduleInstallment[] = dates.map(
    (date, index) => {
      const principal = principalAmounts[index];
      const interest = interestAmounts[index];

      return {
        installmentNumber: index + 1,
        dueDate: formatDate(date),
        principalAmount: fromCents(principal),
        interestAmount: fromCents(interest),
        totalAmount: fromCents(principal + interest)
      };
    }
  );

  const totalInterestCents = interestAmounts.reduce(
    (total, amount) => total + amount,
    0
  );

  return {
    principalAmount: fromCents(principalCents),
    totalInterest: fromCents(totalInterestCents),
    totalAmount: fromCents(principalCents + totalInterestCents),
    installmentsCount: input.installmentsCount,
    installments
  };
}