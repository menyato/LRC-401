/**
 * =============================================================================
 *  Mapping server validation errors onto form fields
 * =============================================================================
 *  The API returns field-level detail on a 422:
 *
 *      {
 *        "error": {
 *          "code": "VALIDATION_ERROR",
 *          "message": "Please check the highlighted fields",
 *          "details": { "newPassword": "Password must be at least 10 characters" }
 *        }
 *      }
 *
 *  Without this helper the forms showed only the message — so the user was told
 *  to "check the highlighted fields" while nothing was highlighted and no reason
 *  was given. That is worse than no message at all: it tells someone something
 *  is wrong and then hides what.
 *
 *  This maps `details` onto react-hook-form so the offending input turns red and
 *  states the actual rule, and only falls back to the banner when the server
 *  gave no field detail (a 401, a conflict, a network failure).
 * =============================================================================
 */

/**
 * @param {Error}    error         Normalised error from lib/api.js.
 * @param {Function} setError      react-hook-form's `setError`.
 * @param {Function} setFormError  Sets the form-level banner message.
 * @param {string[]} [knownFields] Field names this form actually renders.
 *                                 A detail key not in the form would otherwise
 *                                 be set on a field that does not exist, and
 *                                 the message would never be displayed.
 */
export function applyServerErrors(error, setError, setFormError, knownFields = []) {
  const details = error?.details;

  // No field-level detail — show the banner and stop.
  if (!details || typeof details !== 'object' || Object.keys(details).length === 0) {
    setFormError(error?.message ?? 'Something went wrong. Please try again.');
    return;
  }

  const unmatched = [];

  for (const [field, message] of Object.entries(details)) {
    if (knownFields.length === 0 || knownFields.includes(field)) {
      setError(field, { type: 'server', message });
    } else {
      // Surface it in the banner rather than losing it silently.
      unmatched.push(message);
    }
  }

  // Only keep the banner if something could not be attached to an input.
  setFormError(unmatched.length > 0 ? unmatched.join(' ') : null);
}

export default applyServerErrors;
