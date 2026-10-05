import type { ErrorRequestHandler, RequestHandler } from 'express';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'not_found', 'Not found'));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON body' } });
    return;
  }
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'payload_too_large', message: 'The request body is too large' } });
    return;
  }
  // Errors raised by Express itself (a malformed address, an unsupported encoding) carry their
  // own 4xx status. They are the caller's mistake, so they must not be reported as a 500.
  const status = Number((err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode);
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'bad_request', message: 'The request could not be understood' } });
    return;
  }
  if (process.env.NODE_ENV !== 'test') console.error(err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
};

/** Express 4 does not forward rejected promises to the error handler. */
export const ah =
  (fn: (...args: Parameters<RequestHandler>) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
