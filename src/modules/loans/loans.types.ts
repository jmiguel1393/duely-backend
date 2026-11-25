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