import { Response } from 'express';

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'Request completed',
  statusCode = 200
) {
  return res.status(statusCode).json({
    success: true,
    data,
    message,
    meta: {
      requestId: res.locals.requestId || 'unknown',
      timestamp: new Date().toISOString(),
    },
  });
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    meta: {
      requestId: res.locals.requestId || 'unknown',
      timestamp: new Date().toISOString(),
    },
  });
}
