export function toCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}

export function fromCents(amount: number): number {
  return amount / 100;
}

export function distributeAmount(
  totalCents: number,
  installmentsCount: number
): number[] {
  const baseAmount = Math.floor(totalCents / installmentsCount);
  const remainder = totalCents % installmentsCount;

  return Array.from(
    { length: installmentsCount },
    (_, index) =>
      baseAmount + (index === installmentsCount - 1 ? remainder : 0)
  );
}

export function parseDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    throw new Error(`Fecha inválida: ${date}. Utiliza YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const result = new Date(Date.UTC(year, month - 1, day));

  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    throw new Error(`Fecha inválida: ${date}.`);
  }

  return result;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function getLastDayOfMonth(
  year: number,
  month: number
): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function createDate(
  year: number,
  month: number,
  day: number
): Date {
  const adjustedDay = Math.min(
    day,
    getLastDayOfMonth(year, month)
  );

  return new Date(Date.UTC(year, month, adjustedDay));
}