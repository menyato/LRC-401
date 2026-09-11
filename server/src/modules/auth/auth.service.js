/**
 * =============================================================================
 *  Auth service — all authentication business logic.
 * =============================================================================
 *  Controllers stay thin (parse -> call -> respond); everything that decides
 *  anything lives here. That separation is what lets the same login logic be
 *  reused later by, say, a mobile client or a CLI admin tool without dragging
 *  Express along.
 *
 *  THE LOGIN FLOW
 *  --------------
 *      POST /auth/login
 *          ├─ 2FA disabled -> access token + refresh cookie. Done.
 *          └─ 2FA enabled  -> { requiresTwoFactor: true, mfaToken }
 *                                  │
 *                                  ▼
 *      POST /auth/verify-2fa  -> access token + refresh cookie
 *
 *  The intermediate mfaToken carries NO permissions and is signed with its own
 *  secret, so a bug that leaked it could not be used to call the API.
 * =============================================================================
 */

import { prisma } from '../../config/db.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { generateToken, hashToken } from '../../utils/crypto.js';
import { logger } from '../../utils/logger.js';
import { loadActor } from '../../services/access.service.js';
import * as tokenService from '../../services/token.service.js';
import * as totpService from '../../services/totp.service.js';
import * as emailService from '../../services/email.service.js';
import { recordAudit, AUDIT_ACTIONS } from '../../services/audit.service.js';

/**
 * ONE message for every credential failure.
 *
 * Saying "no account with that email" versus "wrong password" tells an attacker
 * which addresses are registered — that is account enumeration, and for a
 * volunteer roster it is also a privacy leak (it confirms who is a member).
 */
const INVALID_CREDENTIALS = 'Incorrect email or password';

/** Shape of the user object returned to the client after a successful login. */
const publicUserFields = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  locale: true,
  status: true,
  isSuperAdmin: true,
  mustChangePassword: true,
  twoFactorEnabled: true,
  lastLoginAt: true,
};

// =============================================================================
//  LOGIN
// =============================================================================

/**
 * Step 1: email + password.
 *
 * @returns {Promise<{requiresTwoFactor: true, mfaToken: string}
 *                  |{requiresTwoFactor: false, user: object, accessToken: string,
 *                    refreshToken: string, refreshExpiresAt: Date}>}
 */
export async function login({ email, password }, context = {}) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      fullName: true,
      passwordHash: true,
      status: true,
      twoFactorEnabled: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });

  // --- Account lockout ------------------------------------------------------
  // Checked BEFORE the password comparison so a locked account cannot be used
  // as a password oracle even by someone who guesses correctly.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil - Date.now()) / 60000);

    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'User',
      entityId: user.id,
      after: { reason: 'account_locked' },
      req: context.req,
    });

    throw ApiError.tooManyRequests(
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      { code: 'ACCOUNT_LOCKED' },
    );
  }

  const passwordMatches = await verifyPassword(password, user?.passwordHash);

  if (!user || !passwordMatches) {
    // Only count failures against accounts that actually exist — otherwise an
    // attacker could lock out a colleague by guessing at their email.
    if (user) await registerFailedLogin(user, context);

    await recordAudit({
      actorId: user?.id ?? null,
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      entityType: 'User',
      entityId: user?.id,
      after: { email, reason: user ? 'bad_password' : 'unknown_email' },
      req: context.req,
    });

    throw ApiError.unauthorized(INVALID_CREDENTIALS, { code: 'INVALID_CREDENTIALS' });
  }

  // --- Account state --------------------------------------------------------
  // These come AFTER the password check on purpose: revealing "this account is
  // suspended" to someone who does not know the password is an enumeration leak.
  if (user.status === 'INVITED') {
    throw ApiError.forbidden(
      'Please accept your invitation email before signing in.',
      { code: 'INVITATION_PENDING' },
    );
  }

  if (user.status === 'SUSPENDED') {
    throw ApiError.forbidden(
      'Your account has been suspended. Please contact the station super admin.',
      { code: 'ACCOUNT_SUSPENDED' },
    );
  }

  // Password was correct: clear the failure counter.
  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  // --- Second factor --------------------------------------------------------
  if (user.twoFactorEnabled) {
    return { requiresTwoFactor: true, mfaToken: tokenService.signMfaToken(user.id) };
  }

  return { requiresTwoFactor: false, ...(await completeLogin(user.id, context)) };
}

/**
 * Increments the failure counter and locks the account once the limit is hit.
 *
 * This complements the rate limiter rather than duplicating it: the limiter is
 * per IP+email and forgets after 15 minutes, while this is per ACCOUNT and
 * persists — so an attacker rotating through IP addresses still gets locked out.
 */
async function registerFailedLogin(user, context) {
  const attempts = user.failedLoginAttempts + 1;
  const shouldLock = attempts >= env.MAX_FAILED_LOGINS;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: attempts,
      lockedUntil: shouldLock ? new Date(Date.now() + env.ACCOUNT_LOCK_MINUTES * 60_000) : null,
    },
  });

  if (shouldLock) {
    logger.warn({ userId: user.id, ip: context.req?.ip }, 'Account locked after failed logins');
  }
}

/**
 * Step 2: verify the 6-digit code (or a backup code).
 */
export async function verifyTwoFactor({ mfaToken, code, isBackupCode }, context = {}) {
  // Throws TOKEN_EXPIRED if the user took longer than MFA_TOKEN_TTL — which is
  // correct: they must re-enter their password.
  const payload = tokenService.verifyMfaToken(mfaToken);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      status: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
      backupCodes: true,
    },
  });

  if (!user || !user.twoFactorEnabled || user.status !== 'ACTIVE') {
    throw ApiError.unauthorized('Please sign in again', { code: 'MFA_INVALID' });
  }

  let isValid = false;

  if (isBackupCode) {
    const index = await totpService.verifyBackupCode(user.backupCodes, code);

    if (index >= 0) {
      isValid = true;
      // Consume it — backup codes are single use.
      const remaining = user.backupCodes.filter((_, position) => position !== index);
      await prisma.user.update({
        where: { id: user.id },
        data: { backupCodes: remaining },
      });

      logger.info({ userId: user.id, remaining: remaining.length }, 'Backup code used');
    }
  } else {
    isValid = totpService.verifyCode(user.twoFactorSecret, code);
  }

  if (!isValid) {
    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.TWO_FACTOR_FAILED,
      entityType: 'User',
      entityId: user.id,
      req: context.req,
    });

    throw ApiError.unauthorized('That code is not valid. Please try again.', {
      code: 'MFA_CODE_INVALID',
    });
  }

  return completeLogin(user.id, context);
}

/**
 * Issues the real session. The single place tokens are minted on success, so
 * the "logged in" side effects (timestamp, audit entry) can never be skipped by
 * one of the two login paths.
 */
async function completeLogin(userId, context) {
  const [user, refresh] = await Promise.all([
    prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
      select: publicUserFields,
    }),
    tokenService.issueRefreshToken(userId, {
      userAgent: context.req?.headers?.['user-agent'],
      ipAddress: context.req?.ip,
    }),
  ]);

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    entityType: 'User',
    entityId: userId,
    req: context.req,
  });

  return {
    user,
    accessToken: tokenService.signAccessToken(userId),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

/** Exchanges a refresh cookie for a new access token (silent re-auth). */
export async function refresh(rawRefreshToken, context = {}) {
  const rotated = await tokenService.rotateRefreshToken(rawRefreshToken, {
    userAgent: context.req?.headers?.['user-agent'],
    ipAddress: context.req?.ip,
  });

  const actor = await loadActor(rotated.userId);

  // The account may have been suspended since the session began. Refresh is the
  // moment we get to notice.
  if (!actor || actor.status !== 'ACTIVE') {
    await tokenService.revokeAllUserTokens(rotated.userId);
    throw ApiError.unauthorized('Your account is no longer active', { code: 'ACCOUNT_INACTIVE' });
  }

  return {
    accessToken: tokenService.signAccessToken(rotated.userId),
    refreshToken: rotated.token,
    refreshExpiresAt: rotated.expiresAt,
  };
}

export async function logout(rawRefreshToken, context = {}) {
  await tokenService.revokeRefreshToken(rawRefreshToken);

  if (context.userId) {
    await recordAudit({
      actorId: context.userId,
      action: AUDIT_ACTIONS.LOGOUT,
      entityType: 'User',
      entityId: context.userId,
      req: context.req,
    });
  }
}

// =============================================================================
//  INVITATIONS
// =============================================================================

/**
 * Reads an invitation for the "you have been invited" screen, before the user
 * has typed anything. Returns only what is safe to show an anonymous visitor.
 */
export async function getInvitation(token) {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      email: true,
      fullName: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      role: { select: { nameEn: true, nameAr: true } },
    },
  });

  if (!invitation || invitation.revokedAt) {
    throw ApiError.notFound('This invitation link is not valid', { code: 'INVITE_INVALID' });
  }
  if (invitation.acceptedAt) {
    throw ApiError.conflict('This invitation has already been used. Please sign in instead.', {
      code: 'INVITE_USED',
    });
  }
  if (invitation.expiresAt < new Date()) {
    throw ApiError.badRequest('This invitation has expired. Please ask for a new one.', {
      code: 'INVITE_EXPIRED',
    });
  }

  return {
    email: invitation.email,
    fullName: invitation.fullName,
    roleName: invitation.role?.nameEn ?? 'Member',
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Accepts an invitation: creates (or activates) the account with the password
 * the person chooses, applies the role/teams the inviting admin selected, and
 * logs them straight in.
 *
 * Wrapped in a transaction: a half-applied invitation (user created but team
 * membership missing) would be confusing to diagnose and awkward to repair.
 */
export async function acceptInvitation({ token, password, fullName, phone, locale }, context = {}) {
  const tokenHash = hashToken(token);

  const invitation = await prisma.invitation.findUnique({ where: { tokenHash } });

  if (!invitation || invitation.revokedAt) {
    throw ApiError.notFound('This invitation link is not valid', { code: 'INVITE_INVALID' });
  }
  if (invitation.acceptedAt) {
    throw ApiError.conflict('This invitation has already been used', { code: 'INVITE_USED' });
  }
  if (invitation.expiresAt < new Date()) {
    throw ApiError.badRequest('This invitation has expired', { code: 'INVITE_EXPIRED' });
  }

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    // upsert, not create: an admin may have invited someone who already has a
    // suspended or still-INVITED account, and a duplicate email would violate
    // the unique constraint.
    const created = await tx.user.upsert({
      where: { email: invitation.email },
      create: {
        email: invitation.email,
        fullName: fullName ?? invitation.fullName,
        phone: phone ?? null,
        locale,
        passwordHash,
        status: 'ACTIVE',
        roleId: invitation.roleId,
        isSuperAdmin: invitation.isSuperAdmin,
        extraPermissions: invitation.extraPermissions,
      },
      update: {
        fullName: fullName ?? invitation.fullName,
        phone: phone ?? undefined,
        locale,
        passwordHash,
        status: 'ACTIVE',
        roleId: invitation.roleId,
        isSuperAdmin: invitation.isSuperAdmin,
        extraPermissions: invitation.extraPermissions,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
      select: publicUserFields,
    });

    // Team memberships chosen by the inviting admin.
    if (invitation.teamIds.length > 0) {
      await tx.teamMembership.createMany({
        data: invitation.teamIds.map((teamId) => ({ userId: created.id, teamId })),
        // The user may already be in one of these teams from a previous account.
        skipDuplicates: true,
      });
    }

    await tx.invitation.update({
      where: { tokenHash },
      data: { acceptedAt: new Date() },
    });

    return created;
  });

  await recordAudit({
    actorId: user.id,
    action: AUDIT_ACTIONS.USER_INVITE_ACCEPTED,
    entityType: 'User',
    entityId: user.id,
    after: { email: user.email },
    req: context.req,
  });

  // Log them in immediately — asking someone to type the password they just
  // chose, on the very next screen, is friction with no security benefit.
  const session = await completeLogin(user.id, context);
  return { ...session, requiresTwoFactor: false };
}

// =============================================================================
//  PASSWORD MANAGEMENT
// =============================================================================

/**
 * Starts a password reset.
 *
 * ALWAYS resolves successfully, even for an unknown address. Reporting "no such
 * user" here would turn this endpoint into a free account-enumeration oracle —
 * the one thing the uniform login error was designed to prevent.
 */
export async function forgotPassword({ email }, context = {}) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, fullName: true, status: true },
  });

  // Suspended and not-yet-activated accounts get nothing: a reset link would
  // let a suspended volunteer back in.
  if (!user || user.status !== 'ACTIVE') {
    logger.info({ email }, 'Password reset requested for unknown or inactive account');
    return;
  }

  const token = generateToken();

  await prisma.$transaction([
    // Invalidate outstanding tokens: several live reset links for one account
    // multiply the chance of one being intercepted.
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    }),
  ]);

  await emailService.sendPasswordResetEmail({
    to: user.email,
    fullName: user.fullName,
    token,
  });

  await recordAudit({
    actorId: user.id,
    action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
    entityType: 'User',
    entityId: user.id,
    req: context.req,
  });
}

export async function resetPassword({ token, password }, context = {}) {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw ApiError.badRequest('This reset link is not valid or has expired', {
      code: 'RESET_INVALID',
    });
  }

  const passwordHash = await hashPassword(password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        mustChangePassword: false,
        // Someone resetting their password may have been locked out; clear it.
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  // If the reset happened because the account was compromised, any session the
  // attacker still holds must die.
  await tokenService.revokeAllUserTokens(record.userId);

  await recordAudit({
    actorId: record.userId,
    action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
    entityType: 'User',
    entityId: record.userId,
    req: context.req,
  });
}

/** Self-service password change for a signed-in user. */
export async function changePassword(userId, { currentPassword, newPassword }, context = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, passwordHash: true },
  });

  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw ApiError.unauthorized('Your current password is incorrect', {
      code: 'INVALID_CREDENTIALS',
    });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });

  await tokenService.revokeAllUserTokens(userId);

  // Fire-and-forget: a failing mail server must not make a successful password
  // change look like an error to the user.
  emailService
    .sendPasswordChangedEmail({ to: user.email, fullName: user.fullName })
    .catch((error) => logger.error({ err: error }, 'Password-changed email failed'));

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    entityType: 'User',
    entityId: userId,
    req: context.req,
  });
}

// =============================================================================
//  TWO-FACTOR ENROLMENT
// =============================================================================

/**
 * Step 1: produce a secret + QR code.
 *
 * The secret is stored but `twoFactorEnabled` stays false until the user proves
 * they can generate a valid code. Enabling first would lock out anyone whose
 * scan failed.
 */
export async function startTwoFactorEnrollment(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, twoFactorEnabled: true },
  });

  if (user.twoFactorEnabled) {
    throw ApiError.conflict('Two-factor authentication is already enabled', {
      code: 'MFA_ALREADY_ENABLED',
    });
  }

  const enrollment = await totpService.generateEnrollment(user.email);

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: enrollment.encryptedSecret },
  });

  return {
    secret: enrollment.secret,
    otpauthUrl: enrollment.otpauthUrl,
    qrCodeDataUrl: enrollment.qrCodeDataUrl,
  };
}

/** Step 2: confirm with a live code, then hand over the backup codes. */
export async function confirmTwoFactorEnrollment(userId, { code }, context = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  });

  if (user.twoFactorEnabled) {
    throw ApiError.conflict('Two-factor authentication is already enabled');
  }
  if (!user.twoFactorSecret) {
    throw ApiError.badRequest('Start the setup first', { code: 'MFA_NOT_STARTED' });
  }
  if (!totpService.verifyCode(user.twoFactorSecret, code)) {
    throw ApiError.badRequest('That code is not correct. Check your authenticator app.', {
      code: 'MFA_CODE_INVALID',
    });
  }

  const { plainCodes, hashedCodes } = await totpService.generateBackupCodes();

  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true, twoFactorConfirmedAt: new Date(), backupCodes: hashedCodes },
  });

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.TWO_FACTOR_ENABLED,
    entityType: 'User',
    entityId: userId,
    req: context.req,
  });

  // The ONLY time the plain codes exist. The client must make the user save
  // them before leaving the screen — we cannot show them again.
  return { backupCodes: plainCodes };
}

export async function disableTwoFactor(userId, { password }, context = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, twoFactorEnabled: true, isSuperAdmin: true },
  });

  if (!user.twoFactorEnabled) {
    throw ApiError.badRequest('Two-factor authentication is not enabled');
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw ApiError.unauthorized('Your password is incorrect', { code: 'INVALID_CREDENTIALS' });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorConfirmedAt: null,
      backupCodes: [],
    },
  });

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.TWO_FACTOR_DISABLED,
    entityType: 'User',
    entityId: userId,
    req: context.req,
  });
}

/** Profile self-service. Deliberately cannot touch role, permissions or status. */
export async function updateProfile(userId, data) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: publicUserFields,
  });
}
