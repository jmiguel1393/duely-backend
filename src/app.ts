import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { env } from './config/env.js';

const app = express();

app.use(helmet());

app.use(cors({
  origin: env.FRONTEND_ORIGIN,
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    application: 'Duely API',
    status: 'UP'
  });
});

export default app;