import { parseImportFile } from './imports.parser.js';
import { validateImport } from './imports.validator.js';
import { confirmImportBatch, createImportBatch } from './imports.repository.js';

interface PreviewImportParams {
  buffer: Buffer;
  companyId: string;
  userId: string;
  fileName: string;
}
interface ConfirmImportParams {
  importBatchId: string;
  companyId: string;
  userId: string;
}

export async function confirmImport(params: ConfirmImportParams) {
  return confirmImportBatch(params);
}

export async function previewImport(params: PreviewImportParams) {
  // 1. Leer el Excel
  const data = await parseImportFile(params.buffer);

  // 2. Validar datos internos y contra la BD
  const validation = await validateImport(data, params.companyId);

  // 3. Calcular cantidad total de filas procesadas
  const totalRows =
    data.customers.length +
    data.loans.length +
    data.users.length +
    data.assignments.length +
    data.collectionDays.length;

  // 4. Contar filas con errores, no cantidad de mensajes de error.
  const errorRowKeys = new Set(
    validation.errors.map(error => `${error.sheet}:${error.row}`)
  );

  const errorRows = errorRowKeys.size;
  const validRows = Math.max(0, totalRows - errorRows);

  // 5. Guardar la previsualización
  const batch = await createImportBatch({
    companyId: params.companyId,
    userId: params.userId,
    fileName: params.fileName.slice(0, 255),
    totalRows,
    validRows,
    errorRows,
    previewData: {
      data,
      validation: {
        valid: validation.valid,
        summary: validation.summary,
        errors: validation.errors
      }
    }
  });

  // 6. Devolver resultado
  return {
    importBatchId: batch.id,
    createdAt: batch.createdAt,
    valid: validation.valid,
    summary: validation.summary,
    rowSummary: {
      totalRows,
      validRows,
      errorRows
    },
    errors: validation.errors,
    data
  };
}