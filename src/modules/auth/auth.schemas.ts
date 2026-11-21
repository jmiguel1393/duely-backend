
import { z } from 'zod';

export const loginSchema = z.object({
  companySlug: z.string().trim().toLowerCase().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(180),
  password: z.string().min(1).max(128)
});

export type LoginInput = z.infer<typeof loginSchema>;
