
import { Request, Response, NextFunction } from 'express';

import { getDashboardSummary } from './dashboard.service.js';

export async function getDashboardSummaryController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.auth) {
      res.status(401).json({
        success: false,
        message: 'Usuario no autenticado.'
      });
      return;
    }

    const from = req.query.from;
    const to = req.query.to;

    if (
      (from !== undefined && typeof from !== 'string') ||
      (to !== undefined && typeof to !== 'string')
    ) {
      res.status(400).json({
        success: false,
        message: 'Los parámetros de fecha deben ser valores únicos.'
      });
      return;
    }

    const result = await getDashboardSummary({
      companyId: req.auth.companyId,
      from: from as string | undefined,
      to: to as string | undefined
    });

    res.status(200).json({
      success: true,
      message: 'Resumen del dashboard obtenido correctamente.',
      data: result
    });
  } catch (error) {
    next(error);
  }
}
