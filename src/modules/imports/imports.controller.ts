import { Request, Response, NextFunction } from 'express';
import { previewImport, confirmImport } from './imports.service.js';

export async function previewImportController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'Debes adjuntar un archivo Excel.'
      });
      return;
    }

    if (!req.auth) {
      res.status(401).json({
        success: false,
        message: 'Usuario no autenticado.'
      });
      return;
    }

    const result = await previewImport({
      buffer: req.file.buffer,
      companyId: req.auth.companyId,
      userId: req.auth.id,
      fileName: req.file.originalname
    });

    res.status(200).json({
      success: true,
      message: result.valid
        ? 'Archivo validado y previsualización guardada correctamente.'
        : 'Previsualización guardada. El archivo contiene errores de validación.',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

export async function confirmImportController(
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

    const importBatchId = req.params.importBatchId;

    if (typeof importBatchId !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Identificador de importación inválido',
      });
      return;
    }

    const result = await confirmImport({
      importBatchId,
      companyId: req.auth.companyId,
      userId: req.auth.id,
    });

    res.status(200).json({
      success: true,
      message: 'Importación confirmada correctamente.',
      data: result
    });
  } catch (error) {
    next(error);
  }
}