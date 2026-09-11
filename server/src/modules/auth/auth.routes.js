/**
 * =============================================================================
 *  Auth routes
 * =============================================================================
 *  Read this file top to bottom to see the entire authentication surface of the
 *  application, including exactly which endpoints are public.
 *
 *  Each route reads as: [rate limit] -> [auth?] -> [validate] -> [controller].
 *  Keeping that order consistent means a reviewer can spot a missing guard at a
 *  glance, which is the whole point of writing routes this way.
 * =============================================================================
 */

import { Router } from 'express';
import * as controller from './auth.controller.js';
import * as schema from './auth.validators.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  loginLimiter,
  refreshLimiter,
  twoFactorLimiter,
  passwordResetLimiter,
  invitationLimiter,
  writeLimiter,
} from '../../middleware/rateLimiters.js';

const router = Router();

// =============================================================================
//  PUBLIC — no authentication required.
//  Every route below is reachable by anyone on the internet, so each one is
//  individually rate limited.
// =============================================================================

router.post(
  '/login',
  loginLimiter,
  validate({ body: schema.loginSchema }),
  asyncHandler(controller.login),
);

router.post(
  '/verify-2fa',
  twoFactorLimiter,
  validate({ body: schema.verifyTwoFactorSchema }),
  asyncHandler(controller.verifyTwoFactor),
);

/**
 * Uses the httpOnly cookie, not a body or header — nothing to validate.
 *
 * Uses `refreshLimiter`, NOT `loginLimiter`. See the comment on refreshLimiter:
 * the login limiter keys on `ip + body.email`, and a refresh has no body, so
 * sharing it collapsed every refresh from one address onto a single counter of
 * ten and broke the app after ten page loads.
 */
router.post('/refresh', refreshLimiter, asyncHandler(controller.refresh));

/** Read the invitation to render "Hello <name>, you were invited as <role>". */
router.get(
  '/invitation',
  invitationLimiter,
  validate({ query: schema.invitationTokenQuery }),
  asyncHandler(controller.getInvitation),
);

router.post(
  '/accept-invitation',
  invitationLimiter,
  validate({ body: schema.acceptInvitationSchema }),
  asyncHandler(controller.acceptInvitation),
);

router.post(
  '/forgot-password',
  passwordResetLimiter,
  validate({ body: schema.forgotPasswordSchema }),
  asyncHandler(controller.forgotPassword),
);

router.post(
  '/reset-password',
  passwordResetLimiter,
  validate({ body: schema.resetPasswordSchema }),
  asyncHandler(controller.resetPassword),
);

// =============================================================================
//  AUTHENTICATED
//  `authenticate` is applied to every route below this line. Anything added
//  after it is protected by default — the safe direction for a mistake.
// =============================================================================

router.use(authenticate);

/** Logout is authenticated so the action can be attributed in the audit log. */
router.post('/logout', asyncHandler(controller.logout));

router.get('/me', asyncHandler(controller.me));

router.patch(
  '/profile',
  writeLimiter,
  validate({ body: schema.updateProfileSchema }),
  asyncHandler(controller.updateProfile),
);

router.post(
  '/change-password',
  writeLimiter,
  validate({ body: schema.changePasswordSchema }),
  asyncHandler(controller.changePassword),
);

// --- Two-factor enrolment ----------------------------------------------------

router.post('/2fa/setup', writeLimiter, asyncHandler(controller.startTwoFactor));

router.post(
  '/2fa/confirm',
  twoFactorLimiter,
  validate({ body: schema.confirmTwoFactorSchema }),
  asyncHandler(controller.confirmTwoFactor),
);

router.post(
  '/2fa/disable',
  twoFactorLimiter,
  validate({ body: schema.disableTwoFactorSchema }),
  asyncHandler(controller.disableTwoFactor),
);

export default router;
