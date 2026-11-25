
import { getFinancialSummary } from './dashboard.repository.js';

import type {
  DashboardSummaryParams,
  DashboardSummary
} from './dashboard.types.js';

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

export async function getDashboardSummary(
  params: DashboardSummaryParams
): Promise<DashboardSummary> {
  if (params.from && !isValidDate(params.from)) {
    throw new Error('La fecha inicial no tiene un formato válido.');
  }

  if (params.to && !isValidDate(params.to)) {
    throw new Error('La fecha final no tiene un formato válido.');
  }

  if (
    params.from &&
    params.to &&
    params.from > params.to
  ) {
    throw new Error(
      'La fecha inicial no puede ser posterior a la fecha final.'
    );
  }

  const financial = await getFinancialSummary(params);

  return {
    financial
  };
}
