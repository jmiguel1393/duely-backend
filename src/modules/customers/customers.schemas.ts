import { z } from 'zod';

const customerFields = {
  code: z.string().trim().min(1).max(40).transform(value => value.toUpperCase()),
  firstNames: z.string().trim().min(1).max(150),
  lastNames: z.string().trim().min(1).max(150),
  businessName: z.string().trim().max(180).nullable().optional(),
  phone: z.string().trim().min(1).max(30),
  address: z.string().trim().nullable().optional()
};

export const createCustomerSchema = z.object(customerFields).strict();

export const updateCustomerSchema = z.object({
  ...customerFields,
  status: z.enum(['ACTIVE', 'INACTIVE'])
}).partial().strict().refine(value => Object.keys(value).length > 0, {
  message: 'Debes proporcionar al menos un campo.'
});

export const customerIdSchema = z.string().uuid();

const positiveInteger = z.string().regex(/^[1-9]\d*$/).transform(Number);

export const listCustomersSchema = z.object({
  page: positiveInteger.pipe(z.number().int().max(1000000)).default(1),
  limit: positiveInteger.pipe(z.number().int().max(100)).default(20),
  search: z.string().trim().max(180).optional(),
  withoutLoan: z.enum(['true', 'false']).transform(value => value === 'true').default(false)
}).strict();

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersInput = z.infer<typeof listCustomersSchema>;