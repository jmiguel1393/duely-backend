import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test'])
    .default('development'),

  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().min(1),

  FRONTEND_ORIGIN: z.string().url(),

  SESSION_TTL_HOURS: z.coerce.number().default(12)
});

export const env = envSchema.parse(process.env);