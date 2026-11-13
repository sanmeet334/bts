import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors.js';
import { sendError } from '../utils/response.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.code, err.message, err.details);
  }

  // Multer file validation errors
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as any).code === 'LIMIT_FILE_SIZE'
  ) {
    return sendError(
      res,
      400,
      'FILE_TOO_LARGE',
      'Uploaded image exceeds the 3MB size limit'
    );
  }

  // Never leak stack traces or internal secrets to clients
  if (process.env.NODE_ENV !== 'test') {
    console.error('[TRAFFIX_SERVER_ERROR]', (err as Error)?.message || err);
  }

  return sendError(
    res,
    500,
    'INTERNAL_SERVER_ERROR',
    'An unexpected server error occurred'
  );
}
