export interface CustomerImport {
  code: string;
  firstNames: string;
  lastNames: string;
  businessName?: string;
  phone: string;
  address?: string;
}

export interface LoanImport {
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

export interface UserImport {
  email: string;
  fullName: string;
  role: string;
  reportsToEmail?: string;
}

export interface AssignmentImport {
  customerCode: string;
  assignedToEmail: string;
  supervisorEmail?: string;
}

export interface CollectionDayImport {
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