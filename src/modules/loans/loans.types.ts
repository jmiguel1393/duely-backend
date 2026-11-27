export const FREQUENCY_MAP = {
  DIARIA: 'DAILY',
  SEMANAL: 'WEEKLY',
  QUINCENAL: 'BIWEEKLY',
  CATORCENAL: 'FORTNIGHTLY',
  MENSUAL: 'MONTHLY'
} as const;

export const INTEREST_TYPE_MAP = {
  PORCENTAJE: 'PERCENTAGE',
  MONTO: 'FIXED_AMOUNT'
} as const;

export const INTEREST_MODE_MAP = {
  TOTAL_PRESTAMO: 'TOTAL_LOAN',
  POR_CUOTA: 'PER_INSTALLMENT'
} as const;

export const WEEKDAY_MAP = {
  LUNES: 1,
  MARTES: 2,
  MIERCOLES: 3,
  JUEVES: 4,
  VIERNES: 5,
  SABADO: 6,
  DOMINGO: 7
} as const;

export type PaymentFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'FORTNIGHTLY'
  | 'MONTHLY';

export type InterestType =
  | 'PERCENTAGE'
  | 'FIXED_AMOUNT';

export type InterestMode =
  | 'TOTAL_LOAN'
  | 'PER_INSTALLMENT';

export type CollectionDayType =
  | 'DAY_OF_WEEK'
  | 'DAY_OF_MONTH';

export interface CollectionDayRule {
  type: CollectionDayType;
  value: number;
}

export interface LoanScheduleInput {
  principalAmount: number;
  installmentsCount: number;
  paymentFrequency: PaymentFrequency;

  interestType: InterestType;
  interestMode: InterestMode;
  interestValue: number;

  startDate: string;

  collectionDays?: CollectionDayRule[];
}

export interface LoanScheduleInstallment {
  installmentNumber: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
}

export interface LoanScheduleResult {
  principalAmount: number;
  totalInterest: number;
  totalAmount: number;
  installmentsCount: number;
  installments: LoanScheduleInstallment[];
}