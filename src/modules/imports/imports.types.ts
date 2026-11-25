export interface ImportRow {
  rowNumber: number;
}

export interface CustomerImport extends ImportRow {
  code: string;
  firstNames: string;
  lastNames: string;
  businessName?: string;
  phone: string;
  address?: string;
}

export interface LoanImport extends ImportRow {
  code: string;
  customerCode: string;
  principalAmount: number;
  installmentsCount: number;
  paymentFrequency: string;
  interestType: string;
  interestMode: string;
  interestValue: number;
  startDate: string;
  disbursementDate?: string;
  observations?: string;
}

export interface UserImport extends ImportRow {
  email: string;
  fullName: string;
  role: string;
  reportsToEmail?: string;
}

export interface AssignmentImport extends ImportRow {
  customerCode: string;
  assignedToEmail: string;
  supervisorEmail?: string;
}

export interface CollectionDayImport extends ImportRow {
  loanCode: string;
  dayType: string;
  dayValue: string | number;
}

export interface ImportData {
  customers: CustomerImport[];
  loans: LoanImport[];
  users: UserImport[];
  assignments: AssignmentImport[];
  collectionDays: CollectionDayImport[];
}

export interface ImportError {
  sheet: string;
  row: number;
  field: string;
  message: string;
}

export interface ImportValidationResult {
  valid: boolean;
  summary: {
    customers: number;
    loans: number;
    users: number;
    assignments: number;
    collectionDays: number;
    errors: number;
  };
  errors: ImportError[];
}