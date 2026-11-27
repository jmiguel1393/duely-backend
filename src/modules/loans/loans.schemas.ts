import { z } from 'zod';

import { FREQUENCY_MAP, INTEREST_MODE_MAP, INTEREST_TYPE_MAP, WEEKDAY_MAP } from './loans.types.js';
import { parseDate } from './loans.utils.js';

const dateSchema = z.iso.date().refine(value => {
  try {
    parseDate(value);
    return true;
  } catch {
    return false;
  }
});

const collectionDaySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('DIA_SEMANA'),
    value: z.enum(['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'])
  }).strict(),
  z.object({ type: z.literal('DIA_MES'), value: z.number().int().min(1).max(31) }).strict()
]).transform(day => day.type === 'DIA_SEMANA'
  ? { type: 'DAY_OF_WEEK' as const, value: WEEKDAY_MAP[day.value] }
  : { type: 'DAY_OF_MONTH' as const, value: day.value });

export const createLoanSchema = z.object({
  customerId: z.string().uuid(),
  code: z.string().trim().min(1).max(40).transform(value => value.toUpperCase()).optional(),
  principalAmount: z.number().positive().max(999999999999.99).multipleOf(0.01),
  installmentsCount: z.number().int().min(1).max(365),
  paymentFrequency: z.enum(['DIARIA', 'SEMANAL', 'QUINCENAL', 'CATORCENAL', 'MENSUAL'])
    .transform(value => FREQUENCY_MAP[value]),
  interestType: z.enum(['PORCENTAJE', 'MONTO']).transform(value => INTEREST_TYPE_MAP[value]),
  interestMode: z.enum(['TOTAL_PRESTAMO', 'POR_CUOTA']).transform(value => INTEREST_MODE_MAP[value]),
  interestValue: z.number().min(0).max(99999999.999999).multipleOf(0.000001),
  startDate: dateSchema,
  disbursementDate: dateSchema.nullable().optional(),
  observations: z.string().trim().max(5000).nullable().optional(),
  collectionDays: z.array(collectionDaySchema).max(31).optional()
}).strict().superRefine((value, context) => {
  if (value.interestType === 'PERCENTAGE' && value.interestValue > 100) {
    context.addIssue({ code: 'custom', path: ['interestValue'], message: 'El porcentaje no puede superar 100.' });
  }
  if (value.interestType === 'FIXED_AMOUNT' && !z.number().multipleOf(0.01).safeParse(value.interestValue).success) {
    context.addIssue({ code: 'custom', path: ['interestValue'], message: 'El monto debe tener como máximo dos decimales.' });
  }
  const days = value.collectionDays ?? [];
  if (new Set(days.map(day => day.type)).size > 1 ||
      new Set(days.map(day => `${day.type}:${day.value}`)).size !== days.length) {
    context.addIssue({ code: 'custom', path: ['collectionDays'], message: 'Los días deben ser únicos y del mismo tipo.' });
  }
});

export type CreateLoanInput = z.infer<typeof createLoanSchema>;