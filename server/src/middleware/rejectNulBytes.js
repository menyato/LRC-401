/**
 * =============================================================================
 *  NUL-byte guard
 * =============================================================================
 *  PostgreSQL cannot store the character U+0000 in a text column. A string
 *  containing one passes every Zod rule we have (it is a perfectly valid JS
 *  string) and then fails INSIDE the database — as a 500, on any endpoint that
 *  writes or searches text. The security test found it on the profile, the
 *  category editor and every search box.
 *
 *  Checking once, here, before any route runs, covers every field of every
 *  endpoint — including ones written after this — instead of relying on each
 *  schema to remember. No legitimate input contains a NUL byte.
 * =============================================================================
 */

import { ApiError } from '../utils/ApiError.js';

/** Nesting deeper than any real request; bounds the walk on a hostile body. */
const MAX_DEPTH = 20;

/** Returns the dotted path of the first string (or key) containing U+0000. */
function findNul(value, path = '', depth = 0) {
  if (typeof value === 'string') return value.includes('\u0000') ? path || '(value)' : null;
  if (value === null || typeof value !== 'object' || depth > MAX_DEPTH) return null;

  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key.includes('\u0000')) return childPath;
    const found = findNul(child, childPath, depth + 1);
    if (found) return found;
  }

  return null;
}

export function rejectNulBytes(req, _res, next) {
  // Route params are not parsed yet at this point; they are cuids, validated
  // per route, and a cuid pattern already rejects U+0000.
  const field = findNul(req.body) ?? findNul(req.query);

  if (field) {
    return next(
      ApiError.validation('Please check the highlighted fields', {
        [field]: 'Contains an invalid character',
      }),
    );
  }

  next();
}

export default rejectNulBytes;
