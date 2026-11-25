import { Request, Response, NextFunction } from 'express';
import { previewImport } from './imports.service.js';

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

    const result = await previewImport(req.file.buffer);

    res.status(200).json({
      success: true,
      message: 'Archivo procesado correctamente.',
      data: result
    });
  } catch (error) {
    next(error);
  }
}