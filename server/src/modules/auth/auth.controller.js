/**
 * =============================================================================
 *  Auth controller
 * =============================================================================
 *  Controllers are deliberately THIN. Their only jobs are:
 *
 *      1. read already-validated input from `req.validated`
 *      2. call one service function
 *      3. shape the HTTP response (status code, cookies)
 *
 *  No business rules, no database calls, no conditionals about who may do what.
 *  If a controller starts growing an `if`, that logic belongs in the service.
 *
 *  This is what keeps the code non-repetitive: the rules live in ONE place and
 *  are reachable from anywhere, not copy-pasted between similar endpoints.
 * =============================================================================
 */

import * as authService from './auth.service.js';
import { setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE } from '../../services/token.service.js';
import { ApiError } from '../../utils/ApiError.js';
import { loadActor } from '../../services/access.service.js';
import { PERMISSION_GROUPS } from '../../config/permissions.js';

/**
 * Sends a successful session response.
 *
 * The refresh token goes into an httpOnly cookie (invisible to JavaScript) and
 * the access token into the JSON body (held in memory by the client). Shared by
 * login, 2FA verification and invitation acceptance so the three can never
 * drift apart.
 */
function sendSession(res, session, statusCode = 200) {
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);

  return res.status(statusCode).json({
    data: {
      user: session.user,
      accessToken: session.accessToken,
      // Lets the client schedule a silent refresh slightly before expiry rather
      // than waiting for a 401 and making the user watch a failed request.
      expiresIn: session.expiresIn ?? undefined,
    },
  });
}

// -----------------------------------------------------------------------------
//  POST /api/auth/login
// -----------------------------------------------------------------------------
export async function login(req, res) {
  const result = await authService.login(req.validated.body, { req });

  // 2FA users get a challenge, not a session. 200 (not 401): the credentials
  // were correct — this is a successful first step, not a failure.
  if (result.requiresTwoFactor) {
    return res.status(200).json({
      data: { requiresTwoFactor: true, mfaToken: result.mfaToken },
    });
  }

  return sendSession(res, result);
}

// -----------------------------------------------------------------------------
//  POST /api/auth/verify-2fa
// -----------------------------------------------------------------------------
export async function verifyTwoFactor(req, res) {
  const session = await authService.verifyTwoFactor(req.validated.body, { req });
  return sendSession(res, session);
}

// -----------------------------------------------------------------------------
//  POST /api/auth/refresh
// -----------------------------------------------------------------------------
export async function refresh(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];

  if (!token) {
    throw ApiError.unauthorized('No active session', { code: 'NO_REFRESH_TOKEN' });
  }

  const session = await authService.refresh(token, { req });
  setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);

  return res.json({ data: { accessToken: session.accessToken } });
}

// -----------------------------------------------------------------------------
//  POST /api/auth/logout
// -----------------------------------------------------------------------------
export async function logout(req, res) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE], { req, userId: req.user?.id });

  clearRefreshCookie(res);

  // 204: nothing to say. Logging out is idempotent — calling it twice, or
  // without a session, is still a success.
  return res.status(204).send();
}

// -----------------------------------------------------------------------------
//  GET /api/auth/me
// -----------------------------------------------------------------------------
/**
 * The client calls this on every page load to rebuild its session state.
 *
 * It returns the resolved permission list, which the UI uses to decide which
 * navigation entries and buttons to render. That is CONVENIENCE ONLY — every
 * endpoint independently enforces the same permissions, so a user who edits
 * this response in their browser gains nothing but a button that returns 403.
 */
export async function me(req, res) {
  const actor = await loadActor(req.user.id);

  return res.json({
    data: {
      user: {
        id: actor.id,
        email: actor.email,
        fullName: actor.fullName,
        locale: actor.locale,
        status: actor.status,
        isSuperAdmin: actor.isSuperAdmin,
        mustChangePassword: actor.mustChangePassword,
        twoFactorEnabled: actor.twoFactorEnabled,
        role: actor.role,
      },
      permissions: actor.permissions,
      teams: {
        adminOf: actor.adminTeamIds,
        memberOf: actor.memberTeamIds,
        /**
         * True for the District Equipment Chief and their deputy: they oversee
         * every team WITHOUT being crew members of any.
         *
         * The UI uses this to offer all teams in its pickers. Without it, the
         * person with the most authority had empty team dropdowns, because
         * those were driven by `memberOf` — and adding them as a real member of
         * all five teams would be wrong: they would then appear on crew lists
         * and be rosterable for shifts they do not work.
         *
         * Supervision is a capability, not a membership.
         */
        supervisesAll:
          actor.isSuperAdmin || actor.permissions.includes('submission:read.all'),
      },
      // Shipped so the role editor can render its checkboxes without a second
      // request, and so the catalogue can never drift out of sync with the API.
      permissionCatalogue: PERMISSION_GROUPS,
    },
  });
}

// -----------------------------------------------------------------------------
//  Invitations
// -----------------------------------------------------------------------------

/** GET /api/auth/invitation?token=... — public "you were invited" screen. */
export async function getInvitation(req, res) {
  return res.json({ data: await authService.getInvitation(req.validated.query.token) });
}

/** POST /api/auth/accept-invitation — sets the password and signs the user in. */
export async function acceptInvitation(req, res) {
  const session = await authService.acceptInvitation(req.validated.body, { req });
  return sendSession(res, session, 201);
}

// -----------------------------------------------------------------------------
//  Password management
// -----------------------------------------------------------------------------

/**
 * POST /api/auth/forgot-password
 *
 * Always 202 with the same message, whether or not the address exists. See the
 * enumeration note in auth.service.js.
 */
export async function forgotPassword(req, res) {
  await authService.forgotPassword(req.validated.body, { req });

  return res.status(202).json({
    data: {
      message: 'If that email is registered, a reset link has been sent to it.',
    },
  });
}

/** POST /api/auth/reset-password */
export async function resetPassword(req, res) {
  await authService.resetPassword(req.validated.body, { req });

  return res.json({
    data: { message: 'Your password has been reset. You can now sign in.' },
  });
}

/** POST /api/auth/change-password */
export async function changePassword(req, res) {
  await authService.changePassword(req.user.id, req.validated.body, { req });

  // Every session was revoked, including this one, so clear the cookie too.
  clearRefreshCookie(res);

  return res.json({
    data: { message: 'Password changed. Please sign in again.', reauthenticate: true },
  });
}

// -----------------------------------------------------------------------------
//  Two-factor enrolment
// -----------------------------------------------------------------------------

/** POST /api/auth/2fa/setup — returns the QR code to scan. */
export async function startTwoFactor(req, res) {
  return res.json({ data: await authService.startTwoFactorEnrollment(req.user.id) });
}

/** POST /api/auth/2fa/confirm — verifies a code and returns the backup codes. */
export async function confirmTwoFactor(req, res) {
  const result = await authService.confirmTwoFactorEnrollment(req.user.id, req.validated.body, {
    req,
  });

  return res.json({
    data: {
      ...result,
      message: 'Two-factor authentication is on. Save these backup codes now — they are shown once.',
    },
  });
}

/** POST /api/auth/2fa/disable */
export async function disableTwoFactor(req, res) {
  await authService.disableTwoFactor(req.user.id, req.validated.body, { req });

  return res.json({ data: { message: 'Two-factor authentication has been turned off.' } });
}

// -----------------------------------------------------------------------------
//  PATCH /api/auth/profile
// -----------------------------------------------------------------------------
export async function updateProfile(req, res) {
  return res.json({ data: await authService.updateProfile(req.user.id, req.validated.body) });
}
