/**
 * =============================================================================
 *  Central error handling
 * =============================================================================
 *  Every failure in the application funnels through here, which buys us:
 *    • ONE response shape, so the React client has one error handler;
 *    • a guarantee that internal details (SQL, stack traces, file paths) never
 *      reach the browser in production;
 *    • one place that decides what gets logged and at what level.
 *
 *  Response shape — always:
 *
 *      { "error": { "code": "VALIDATION_ERROR",
 *                   "message": "Please check the highlighted fields",
 *                   "details": { "email": "Invalid email address" } } }
 * =============================================================================
 */

import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * 404 handler. Mounted AFTER all routes: if execution reaches it, no route
 * matched. Converting it into an ApiError means an unknown URL produces the
 * same JSON shape as every other error, instead of Express's default HTML page.
 */
export const notFoundHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
};

/**
 * Translates a Prisma exception into a user-facing ApiError.
 * Returns null when the error is not a recognised Prisma error.
 *
 * This matters because raw Prisma messages are verbose and leak schema details
 * ("Unique constraint failed on the fields: (`email`)"). We map the few codes
 * that correspond to genuine user mistakes and treat the rest as bugs.
 */
function translatePrismaError(error) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;

  switch (error.code) {
    // Unique constraint violation — e.g. inviting an email that already exists,
    // or two reports for the same vehicle on the same day.
    case 'P2002': {
      const fields = error.meta?.target;
      const list = Array.isArray(fields) ? fields.join(', ') : 'value';
      return ApiError.conflict(`A record with this ${list} already exists`, {
        code: 'DUPLICATE_RECORD',
        details: Array.isArray(fields)
          ? Object.fromEntries(fields.map((field) => [field, 'Already in use']))
          : undefined,
      });
    }

    // Foreign key violation — pointing at a team/vehicle/item that is gone.
    case 'P2003':
      return ApiError.badRequest('A linked record does not exist', {
        code: 'INVALID_REFERENCE',
      });

    // Restrict violation — deleting something still referenced elsewhere. We
    // explain the fix, because "deactivate instead of delete" is our policy for
    // anything with history attached.
    case 'P2014':
      return ApiError.conflict(
        'This record is still in use elsewhere. Deactivate it instead of deleting it.',
        { code: 'RECORD_IN_USE' },
      );

    // update/delete matched no rows.
    case 'P2025':
      return ApiError.notFound(error.meta?.cause ?? 'Record not found');

    default:
      return null;
  }
}

/**
 * The error middleware.
 *
 * Express identifies an error handler purely by its FOUR-parameter signature,
 * so `next` must stay in the list even though it is unused. Removing it
 * silently turns this into a normal middleware that never runs.
 */
export const errorHandler = (error, req, res, next) => {
  let apiError;

  if (error instanceof ApiError) {
    apiError = error;
  } else if (error instanceof ZodError) {
    // A schema failing outside the validate() middleware — usually a service
    // parsing dynamic form answers.
    apiError = ApiError.validation('Validation failed');
  } else if (error?.name === 'TokenExpiredError') {
    apiError = ApiError.unauthorized('Your session has expired. Please sign in again.', {
      code: 'TOKEN_EXPIRED',
    });
  } else if (error?.name === 'JsonWebTokenError') {
    apiError = ApiError.unauthorized('Invalid session. Please sign in again.', {
      code: 'TOKEN_INVALID',
    });
  } else if (error?.type === 'entity.parse.failed') {
    // Malformed JSON body — thrown by express.json().
    apiError = ApiError.badRequest('Request body is not valid JSON');
  } else if (error?.type === 'entity.too.large') {
    apiError = ApiError.badRequest('Request body is too large');
  } else {
    apiError = translatePrismaError(error) ?? ApiError.internal(error?.message);
  }

  // --- Logging -------------------------------------------------------------
  // Expected user errors are noise at error level; genuine bugs must be loud.
  const logPayload = {
    statusCode: apiError.statusCode,
    code: apiError.code,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id,
    ip: req.ip,
  };

  if (apiError.statusCode >= 500) {
    logger.error({ ...logPayload, err: error }, apiError.message);
  } else {
    logger.warn(logPayload, apiError.message);
  }

  // --- Response ------------------------------------------------------------
  // In production, replace the message of any non-operational (bug) error with
  // a generic one. A stack trace or SQL fragment in the browser is a gift to an
  // attacker mapping the system.
  const exposeMessage = apiError.isOperational || !env.isProduction;

  res.status(apiError.statusCode).json({
    error: {
      code: apiError.code,
      message: exposeMessage ? apiError.message : 'Something went wrong. Please try again.',
      ...(apiError.details ? { details: apiError.details } : {}),
      // Stack traces only ever in development, and only for real bugs.
      ...(!env.isProduction && apiError.statusCode >= 500 ? { stack: error?.stack } : {}),
    },
  });
};
