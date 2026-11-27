import type { LoanImport, CollectionDayImport } from './imports.types.js';

import { FREQUENCY_MAP, INTEREST_MODE_MAP, INTEREST_TYPE_MAP, WEEKDAY_MAP } from '../loans/loans.types.js';
import type {
  LoanScheduleInput,
  CollectionDayRule
} from '../loans/loans.types.js';

export function mapCollectionDays(
  collectionDays: CollectionDayImport[]
): CollectionDayRule[] {
  return collectionDays.map(day => {
    if (day.dayType === 'DIA_SEMANA') {
      const weekday =
        WEEKDAY_MAP[day.dayValue as keyof typeof WEEKDAY_MAP];

      if (!weekday) {
        throw new Error(
          `Día de semana inválido: ${day.dayValue}`
        );
      }

      return {
        type: 'DAY_OF_WEEK',
        value: weekday
      };
    }

    if (day.dayType === 'DIA_MES') {
      const dayOfMonth = Number(day.dayValue);

      if (
        !Number.isInteger(dayOfMonth) ||
        dayOfMonth < 1 ||
        dayOfMonth > 31
      ) {
        throw new Error(
          `Día de mes inválido: ${day.dayValue}`
        );
      }

      return {
        type: 'DAY_OF_MONTH',
        value: dayOfMonth
      };
    }

    throw new Error(`Tipo de regla inválido: ${day.dayType}`);
  });
}

export function mapLoanToScheduleInput(
  loan: LoanImport,
  collectionDays: CollectionDayImport[]
): LoanScheduleInput {
  const paymentFrequency =
    FREQUENCY_MAP[
      loan.paymentFrequency as keyof typeof FREQUENCY_MAP
    ];

  const interestType =
    INTEREST_TYPE_MAP[
      loan.interestType as keyof typeof INTEREST_TYPE_MAP
    ];

  const interestMode =
    INTEREST_MODE_MAP[
      loan.interestMode as keyof typeof INTEREST_MODE_MAP
    ];

  if (!paymentFrequency) {
    throw new Error(
      `Frecuencia inválida para el préstamo ${loan.code}`
    );
  }

  if (!interestType) {
    throw new Error(
      `Tipo de interés inválido para el préstamo ${loan.code}`
    );
  }

  if (!interestMode) {
    throw new Error(
      `Base de interés inválida para el préstamo ${loan.code}`
    );
  }

  return {
    principalAmount: loan.principalAmount,
    installmentsCount: loan.installmentsCount,
    paymentFrequency,
    interestType,
    interestMode,
    interestValue: loan.interestValue,
    startDate: loan.startDate,
    collectionDays: mapCollectionDays(collectionDays)
  };
}