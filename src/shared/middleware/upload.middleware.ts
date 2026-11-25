import multer from 'multer';

const storage = multer.memoryStorage();

const fileFilter: multer.Options['fileFilter'] = (
  _req,
  file,
  callback
) => {
  const isExcel = file.originalname
    .toLowerCase()
    .endsWith('.xlsx');

  if (!isExcel) {
    return callback(
      new Error('Solo se permiten archivos Excel .xlsx')
    );
  }

  callback(null, true);
};

export const uploadExcel = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  }
});