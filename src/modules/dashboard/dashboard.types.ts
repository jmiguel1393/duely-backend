
export interface DashboardSummaryParams {
  companyId: string;
  from?: string;
  to?: string;
}

export interface DashboardFinancialSummary {
  totalDisbursed: string;
  totalCollected: string;
  capitalCollected: string;
  interestCollected: string;
  capitalPending: string;
  interestPending: string;
  totalPending: string;
  overdueAmount: string;
}

export interface DashboardSummary {
  financial: DashboardFinancialSummary;
}
