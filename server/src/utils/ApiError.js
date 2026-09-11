/**
 * =============================================================================
 *  ApiError — the ONE way this codebase reports a failure.
 * =============================================================================
 *  Without this, error handling degenerates into every route inventing its own
 *  shape:
 *
 *      res.status(404).json({ error: 'not found' });
 *      res.status(404).send('Item missing');
 *      res.json({ ok: false, msg: '...' });
 *
 *  ...and the frontend needs a special case for each. Instead, any layer simply
 *  `throw new ApiError.notFound('Item not found')` and the central error
 *  middleware (middleware/error.js) converts it into one consistent response.
 *
 *  `isOperational` distinguishes:
 *    • operational errors — expected, the user's fault, safe to describe
 *      ("that email is already registered")
 *    • programmer errors — a bug. The message is hidden from the client in
 *      production because it may reveal internals, and is logged at error level.
 * =============================================================================
 */

export class ApiError extends Error {
  /**
   * @param {number} statusCode  HTTP status to return.
   * @param {string} message     Human-readable, safe to show to the user.
   * @param {object} [options]
   * @param {string} [options.code]    Stable machine code for the frontend to
   *                                   branch on, e.g. 'TWO_FACTOR_REQUIRED'.
   *                                   Never branch on the message text — it is
   *                                   translated and will change.
   * @param {object} [options.details] Field-level errors, e.g. from Zod.
   */
  constructor(statusCode, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code ?? defaultCodeFor(statusCode);
    this.details = details;
    this.isOperational = true;

    // Keep the stack trace pointing at the throw site, not at this constructor.
    Error.captureStackTrace(this, this.constructor);
  }

  // --- Named constructors ----------------------------------------------------
  // These read better at the call site than remembering status numbers, and
  // they keep our status codes consistent across the whole API.

  /** 400 — the request itself is malformed or fails a business rule. */
  static badRequest(message = 'Invalid request', options) {
    return new ApiError(400, message, options);
  }

  /** 401 — we do not know who you are (missing/expired/invalid credentials). */
  static unauthorized(message = 'Authentication required', options) {
    return new ApiError(401, message, options);
  }

  /** 403 — we know who you are, and you may not do this. */
  static forbidden(message = 'You do not have permission to do this', options) {
    return new ApiError(403, message, options);
  }

  /** 404 — no such record, OR one you are not scoped to see (see note below). */
  static notFound(message = 'Not found', options) {
    return new ApiError(404, message, options);
  }

  /** 409 — conflicts with existing data (duplicate email, duplicate report). */
  static conflict(message = 'This conflicts with existing data', options) {
    return new ApiError(409, message, options);
  }

  /** 422 — well-formed but semantically invalid; used by the Zod validator. */
  static validation(message = 'Validation failed', details) {
    return new ApiError(422, message, { code: 'VALIDATION_ERROR', details });
  }

  /** 429 — rate limit tripped. */
  static tooManyRequests(message = 'Too many requests, please slow down', options) {
    return new ApiError(429, message, options);
  }

  /** 500 — our bug. Message is suppressed in production. */
  static internal(message = 'Something went wrong', options) {
    const error = new ApiError(500, message, options);
    error.isOperational = false;
    return error;
  }
}

/**
 * SECURITY NOTE — why we return 404 rather than 403 for out-of-scope records:
 *
 * If a team admin requests a report belonging to another team, replying 403
 * confirms that the record exists. Replying 404 leaks nothing. This is why
 * scope filters are applied as SQL `WHERE` clauses (the row simply is not
 * found) rather than as a permission check after loading.
 */

/** Sensible default machine codes so callers rarely need to pass one. */
function defaultCodeFor(statusCode) {
  const map = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
    422: 'VALIDATION_ERROR',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
  };
  return map[statusCode] ?? 'ERROR';
}

export default ApiError;
