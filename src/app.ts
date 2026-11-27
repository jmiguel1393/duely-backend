
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { env } from './config/env.js';
import authRoutes from './modules/auth/auth.routes.js';
import importsRoutes from './modules/imports/imports.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import customersRoutes from './modules/customers/customers.routes.js';
import loansRoutes from './modules/loans/loans.routes.js';

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

app.use('/api/auth', authRoutes);
app.use('/api/imports', importsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/loans', loansRoutes);

// Manejo centralizado de errores
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof Error && error.name === 'ZodError') {
    res.status(400).json({
      success: false,
      message: 'Datos de entrada inválidos'
    });
    return;
  }

  console.error(error);

  res.status(500).json({
    success: false,
    message: 'Error interno del servidor'
  });
});

export default app;
