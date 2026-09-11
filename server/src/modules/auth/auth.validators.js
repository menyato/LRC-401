/**
 * =============================================================================
 *  Auth — request schemas
 * =============================================================================
 *  Every auth endpoint's accepted input, in one file. Keeping schemas beside
 *  the module (rather than in a global `validators/` folder) means a change to
 *  the login flow touches one directory, not three.
 * =============================================================================
 */

import { z } from 'zod';
import { passwordSchema } from '../../utils/password.js';

/**
 * Email normalisation applied everywhere an address is accepted.
 * Without it, "Ali@LRC.org" and "ali@lrc.org" become two accounts, and the
 * unique constraint in the database would not catch it.
 */
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('Please enter a valid email address')
  .max(254); // RFC 5321 maximum length.

/** A 6-digit TOTP code, or an 8-character backup code like "4F7K-92QD". */
const otpField = z
  .string()
  .trim()
  .min(6, 'Enter the 6-digit code')
  .max(12)
  .transform((value) => value.replace(/\s/g, ''));

export const loginSchema = z.object({
  email: emailField,
  // NOT `passwordSchema` here. Login must accept whatever the user types so we
  // can reject it with "invalid credentials". Applying the strength rules at
  // login would tell an attacker which passwords are the wrong SHAPE versus
  // simply wrong — and would lock out anyone whose password predates a policy
  // change.
  password: z.string().min(1, 'Password is required').max(128),
});

export const verifyTwoFactorSchema = z.object({
  /** Short-lived token proving the password step already passed. */
  mfaToken: z.string().min(10),
  code: otpField,
  /** Set when the user is entering a recovery code instead of an app code. */
  isBackupCode: z.boolean().default(false),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(10, 'Invitation token is required'),
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  locale: z.enum(['en', 'ar']).default('en'),
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Your current password is required'),
    newPassword: passwordSchema,
  })
  // Blocks the no-op "change" that leaves the account on a password the user
  // may already believe was compromised.
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'The new password must be different from the current one',
  });

export const confirmTwoFactorSchema = z.object({
  code: otpField,
});

export const disableTwoFactorSchema = z.object({
  // Re-authentication before weakening account security. Without it, a briefly
  // unlocked laptop is enough for someone to remove the second factor.
  password: z.string().min(1, 'Your password is required'),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(30).nullish(),
  locale: z.enum(['en', 'ar']).optional(),
});

/** Used by the "check my invitation is still valid" screen. */
export const invitationTokenQuery = z.object({
  token: z.string().min(10),
});
