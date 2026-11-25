import { parseImportFile } from './imports.parser.js';

export async function previewImport(
  buffer: Buffer
) {
  const data = await parseImportFile(buffer);

  return {
    summary: {
      customers: data.customers.length,
      loans: data.loans.length,
      users: data.users.length,
      assignments: data.assignments.length,
      collectionDays: data.collectionDays.length
    },
    data
  };
}