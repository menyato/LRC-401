/**
 * =============================================================================
 *  Authentication & authorisation middleware
 * =============================================================================
 *  Two distinct steps, always in this order:
 *
 *      authenticate            -> establishes WHO you are  (401 if unknown)
 *      requirePermission(...)  -> establishes WHAT you may do (403 if not)
 *
 *  Routes read as a sentence, and the guard is impossible to miss on review:
 *
 *      router.post('/items',
 *        requirePermission('inventory.item:create'),
 *        validate({ body: createItemSchema }),
 *        asyncHandler(controller.create));
 *
 *  `authenticate` is applied ONCE to the whole /api router rather than being
 *  repeated per route — forgetting it on a single route would silently expose
 *  that endpoint to the world, and that is exactly the kind of mistake that
 *  survives code review.
 * =============================================================================
 */

import { verifyAccessToken } from '../services/token.service.js';
import { loadActor, hasPermission, hasAnyPermission } from '../services/access.service.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * Extracts a bearer token from the Authorization header.
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  // Case-insensitive because some HTTP clients normalise the scheme casing.
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

  return token;
}

/**
 * Verifies the access token and attaches the full actor to `req.user`.
 *
 * We re-read the user from the database on every request. That is one indexed
 * lookup, and it buys correctness that a self-contained JWT cannot give:
 *   • a suspended account stops working immediately, not in 15 minutes;
 *   • a permission the super admin just revoked is gone immediately;
 *   • a deleted user cannot keep acting.
 * For a system whose entire purpose is that the super admin controls access,
 * "revocation takes effect now" is worth far more than the saved query.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearerToken(req);

  if (!token) {
    throw ApiError.unauthorized('Please sign in to continue', { code: 'NO_TOKEN' });
  }

  // Throws on expiry/tampering; middleware/error.js turns those into clean 401s
  // with the codes TOKEN_EXPIRED / TOKEN_INVALID that the client uses to decide
  // whether to attempt a silent refresh.
  const payload = verifyAccessToken(token);

  const actor = await loadActor(payload.sub);

  if (!actor) {
    throw ApiError.unauthorized('Your account no longer exists', { code: 'USER_NOT_FOUND' });
  }

  if (actor.status === 'SUSPENDED') {
    throw ApiError.forbidden('Your account has been suspended. Please contact the station admin.', {
      code: 'ACCOUNT_SUSPENDED',
    });
  }

  if (actor.status === 'INVITED') {
    // Should be unreachable (no password = no token), but defence in depth.
    throw ApiError.forbidden('Please accept your invitation before signing in', {
      code: 'INVITATION_PENDING',
    });
  }

  // --- Has this token been invalidated since it was issued? ------------------
  // An access token is a stateless JWT: revoking the refresh token does not
  // stop it, so without this check a stolen token kept working for up to
  // ACCESS_TOKEN_TTL after the victim changed their password — exactly the
  // window that changing a password is supposed to close.
  //
  // `sessionsRevokedAt` is stamped by revokeAllUserTokens(), which every
  // "stop trusting this account" path already calls.
  //
  // The comparison uses our own millisecond `ims` claim rather than the
  // standard `iat`, which is whole seconds. With second granularity there was
  // no correct comparison available: `<` let a token minted in the same second
  // as the revocation slip through, and `<=` falsely rejected a token that was
  // issued legitimately moments after one. The scenario suite hit both.
  //
  // `ims` makes it exact. `iat` remains the fallback for any token issued
  // before this claim existed, erring on the side of rejecting.
  if (actor.sessionsRevokedAt) {
    const issuedAtMs = typeof payload.ims === 'number' ? payload.ims : payload.iat * 1000;

    if (issuedAtMs < actor.sessionsRevokedAt.getTime()) {
      throw ApiError.unauthorized('Your session has ended. Please sign in again.', {
        code: 'SESSION_REVOKED',
      });
    }
  }

  req.user = actor;
  next();
});

/**
 * Blocks a user who must change their password from doing anything except
 * changing it.
 *
 * Without this, "mustChangePassword" would be a suggestion the frontend could
 * simply skip by navigating directly to another page. Mounted globally with a
 * small allow-list of endpoints they still need.
 */
export const enforcePasswordChange = (req, _res, next) => {
  if (!req.user?.mustChangePassword) return next();

  const allowedPaths = ['/auth/me', '/auth/change-password', '/auth/logout'];
  if (allowedPaths.some((path) => req.path.startsWith(path))) return next();

  return next(
    ApiError.forbidden('You must set a new password before continuing', {
      code: 'PASSWORD_CHANGE_REQUIRED',
    }),
  );
};

/**
 * Requires ONE specific permission.
 * @param {string} permission  A key from config/permissions.js.
 */
export const requirePermission = (permission) => (req, _res, next) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Please sign in to continue'));
  }

  if (!hasPermission(req.user, permission)) {
    // The message names the missing permission deliberately: the person hitting
    // this is a trusted volunteer, and "you need inventory.item:create" tells
    // them exactly what to ask the super admin for. It reveals nothing an
    // attacker could not read in the public role editor anyway.
    return next(
      ApiError.forbidden(`You do not have permission to do this (${permission})`, {
        code: 'MISSING_PERMISSION',
        details: { required: permission },
      }),
    );
  }

  next();
};

/**
 * Requires AT LEAST ONE of several permissions.
 * Used where the same endpoint serves several audiences — e.g. the report list
 * is open to anyone with `read.own`, `read.team` or `read.all`, and the SCOPE
 * (from access.service.js) then decides which rows they actually get.
 */
export const requireAnyPermission = (permissions) => (req, _res, next) => {
  if (!req.user) {
    return next(ApiError.unauthorized('Please sign in to continue'));
  }

  if (!hasAnyPermission(req.user, permissions)) {
    return next(
      ApiError.forbidden('You do not have permission to do this', {
        code: 'MISSING_PERMISSION',
        details: { requiredAnyOf: permissions },
      }),
    );
  }

  next();
};

/**
 * Super-admin-only routes: creating other super admins, editing system roles,
 * changing station settings.
 */
export const requireSuperAdmin = (req, _res, next) => {
  if (!req.user?.isSuperAdmin) {
    return next(
      ApiError.forbidden('Only the super admin can do this', { code: 'SUPER_ADMIN_ONLY' }),
    );
  }
  next();
};
