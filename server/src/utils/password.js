/**
 * =============================================================================
 *  Password hashing and policy
 * =============================================================================
 *  bcryptjs (pure JavaScript) rather than the native `bcrypt` or `argon2`
 *  packages. Those are objectively stronger, but they require a C++ toolchain
 *  to compile on install — which fails on a locked-down Windows machine and on
 *  some free hosting build images. A deployment that cannot build is worse than
 *  a slightly slower hash, and bcrypt at cost 12 remains entirely adequate for
 *  a station of this size.
 *
 *  If you later move to a host with a build toolchain, swapping to argon2 means
 *  changing only this file.
 * =============================================================================
 */

import bcrypt from 'bcryptjs';
import { z } from 'zod';

/**
 * Cost factor. Each +1 doubles the work.
 * 12 ≈ 200–300ms on typical hardware: unnoticeable to a person logging in,
 * but it caps an offline cracking attempt at a few thousand guesses per second
 * instead of billions.
 */
const SALT_ROUNDS = 12;

/** @param {string} plain @returns {Promise<string>} bcrypt hash (salt included) */
export const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);

/**
 * @param {string} plain
 * @param {string|null|undefined} hash
 * @returns {Promise<boolean>}
 */
export const verifyPassword = async (plain, hash) => {
  // A user who was invited but never accepted has passwordHash = null.
  // bcrypt.compare would throw on null, so guard explicitly.
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
};

/**
 * The password policy, as a Zod schema so it is enforced identically at every
 * entry point (invitation acceptance, self-service change, admin reset) and can
 * be imported by the React client to show the same rules live as the user types.
 *
 * Reasoning behind the specific rules:
 *   • 10 characters minimum — length dominates every other factor for strength.
 *   • Mixed classes — a modest hurdle against dictionary guessing.
 *   • 128 maximum — bcrypt silently truncates beyond 72 bytes, so accepting a
 *     very long passphrase would give a false sense of security; we also avoid
 *     wasting CPU hashing megabyte-long input sent by an attacker.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

/**
 * Rough strength indicator (0–4) for the UI meter only.
 * NEVER used to accept or reject — `passwordSchema` is the single gate. A
 * client-side score is advisory; the server rule is the rule.
 */
export function scorePassword(password = '') {
  let score = 0;

  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password)) score += 1;

  return Math.min(score, 4);
}
