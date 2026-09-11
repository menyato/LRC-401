/**
 * =============================================================================
 *  Request validation
 * =============================================================================
 *  ONE middleware validates every request in the application.
 *
 *  The alternative — hand-written checks inside controllers — fails in three
 *  ways we cannot afford:
 *    1. It is repetitive (`if (!req.body.email) return res.status(400)...`
 *       eighty times).
 *    2. It is easy to forget, and a forgotten check is a security hole.
 *    3. It does not strip unknown keys, which enables MASS ASSIGNMENT: a user
 *       PATCHes their profile with `{"fullName":"Ali","isSuperAdmin":true}` and
 *       if the controller spreads `req.body` into a Prisma update, they have
 *       just promoted themselves.
 *
 *  Zod solves all three. `.parse()` returns ONLY the keys declared in the
 *  schema, so unknown fields are dropped rather than passed through.
 *
 *  CRITICAL RULE: controllers must read from `req.validated`, never from the
 *  raw `req.body`. `req.validated` is the sanitised copy.
 * =============================================================================
 */

import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError.js';

/**
 * Turns Zod's issue list into `{ "field.path": "message" }`, which the React
 * forms map straight onto their inputs.
 */
function formatZodIssues(error) {
  const details = {};

  for (const issue of error.issues) {
    // Drop the leading segment ('body' / 'query' / 'params') so the key matches
    // the form field name the client actually uses.
    const path = issue.path.slice(1).join('.') || issue.path.join('.');
    // Keep the FIRST message per field: showing five errors on one input at
    // once is noise, and the first is normally the most actionable.
    if (!details[path]) details[path] = issue.message;
  }

  return details;
}

/**
 * Validates any combination of body, query and route params.
 *
 * @param {{ body?: import('zod').ZodTypeAny,
 *           query?: import('zod').ZodTypeAny,
 *           params?: import('zod').ZodTypeAny }} schemas
 * @returns {import('express').RequestHandler}
 *
 * @example
 *   router.post('/items',
 *     requirePermission('inventory.item:create'),
 *     validate({ body: createItemSchema }),
 *     asyncHandler(itemsController.create));
 *
 *   // inside the controller:
 *   const { nameEn, sizes } = req.validated.body;
 */
export const validate = (schemas) => (req, res, next) => {
  try {
    // Start from an empty object so a route that validates only `body` cannot
    // accidentally expose unvalidated `query` through req.validated.
    req.validated = {};

    if (schemas.body) req.validated.body = schemas.body.parse(req.body);
    if (schemas.query) req.validated.query = schemas.query.parse(req.query);
    if (schemas.params) req.validated.params = schemas.params.parse(req.params);

    next();
  } catch (error) {
    if (error instanceof ZodError) {
      // 422 rather than 400: the request was well-formed JSON, but its content
      // failed our rules. The distinction helps when reading logs.
      return next(ApiError.validation('Please check the highlighted fields', formatZodIssues(error)));
    }
    next(error);
  }
};

export default validate;
