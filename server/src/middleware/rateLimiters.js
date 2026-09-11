/**
 * =============================================================================
 *  Rate limiting
 * =============================================================================
 *  Different endpoints deserve very different limits, so instead of one global
 *  limiter we define a small set of named ones and attach the right one per
 *  route. A single global limit would either be too loose to stop password
 *  guessing, or so tight that filling in a 150-question equipment report on a
 *  phone would start failing.
 *
 *  Threat model this addresses:
 *    • Password / 2FA brute force              -> loginLimiter, twoFactorLimiter
 *    • Account enumeration via password reset  -> passwordResetLimiter
 *    • Invitation email flooding (cost + spam
 *      reputation on a free email tier)        -> inviteLimiter
 *    • General API abuse / scraping            -> apiLimiter
 *
 *  NOTE ON SCALING: express-rate-limit keeps counters in this process's memory.
 *  That is correct for a single instance. If the API is ever run as more than
 *  one instance, add `rate-limit-redis` so the counters are shared — otherwise
 *  the effective limit silently multiplies by the instance count.
 * =============================================================================
 */

import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Normalises a client IP into a rate-limiting key.
 *
 * IPv4 is used as-is. IPv6 is TRUNCATED TO ITS /64 PREFIX (the first four
 * hextets) because a single home or mobile connection is routinely handed a
 * whole /64 — often a /48. Keying on the full address would let one client
 * get a fresh counter for every request simply by using a different address
 * from its own range, which silently defeats the login limiter.
 *
 * (express-rate-limit ships an `ipKeyGenerator` helper for this, but only from
 * v8; we are on v7, so this is the equivalent.)
 */
function ipKey(req) {
  const ip = req.ip ?? 'unknown';

  // No colon means IPv4 (or the "unknown" fallback).
  if (!ip.includes(':')) return ip;

  // "::ffff:1.2.3.4" is an IPv4 address in IPv6 form — unwrap it.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1];

  // Expand "::" so the prefix is counted correctly, then keep four hextets.
  const [head, tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;

  const full = ip.includes('::')
    ? [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts]
    : ip.split(':');

  return `${full.slice(0, 4).join(':')}::/64`;
}

/**
 * Shared factory so every limiter behaves identically: same error shape, same
 * headers, same logging.
 *
 * @param {object} options
 * @param {number} options.windowMs
 * @param {number} options.max
 * @param {string} options.message
 * @param {string} options.name             Appears in logs.
 * @param {Function} [options.keyGenerator]
 * @param {boolean} [options.skipSuccessfulRequests]
 */
function createLimiter({ windowMs, max, message, name, keyGenerator, skipSuccessfulRequests }) {
  return rateLimit({
    windowMs,
    max,
    skipSuccessfulRequests: skipSuccessfulRequests ?? false,
    // Modern `RateLimit-*` headers so the client can show "try again in 4:32".
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    // Never rate-limit ourselves out of development.
    skip: () => env.isTest,
    handler: (req, _res, next) => {
      logger.warn(
        { limiter: name, ip: req.ip, path: req.originalUrl, userId: req.user?.id },
        'Rate limit exceeded',
      );
      // Route through our normal error pipeline so the response shape matches
      // every other error the frontend has to handle.
      next(ApiError.tooManyRequests(message));
    },
  });
}

/**
 * Baseline for the whole API. Generous, because a single dashboard page load
 * legitimately fires a handful of parallel requests.
 *
 * KEYED PER USER where possible, falling back to IP for anonymous traffic.
 *
 * Keyed on IP alone this was the last and broadest instance of the same bug
 * that affected the login, 2FA, invitation and password-reset limiters: at a
 * station where twenty volunteers share one public address, they also shared
 * one allowance of 600 — about 30 requests each per 15 minutes, which an admin
 * working through the inventory can exhaust on their own, taking everyone else
 * down with them.
 *
 * The user id is read from the bearer token WITHOUT verifying it, because this
 * middleware runs before `authenticate`. That is safe: the value only chooses
 * which counter to consume and grants nothing, and the token is still fully
 * verified before any request is served. Forging one would only let an attacker
 * consume their own quota.
 */
export const apiLimiter = createLimiter({
  name: 'api',
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600,
  message: 'Too many requests. Please wait a moment and try again.',
  keyGenerator: (req) => {
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');

    if (scheme?.toLowerCase() === 'bearer' && token) {
      const subject = unverifiedSubject(token);
      if (subject) return `user:${subject}`;
    }

    return ipKey(req);
  },
});

/**
 * Login. Deliberately strict.
 *
 * Keyed on IP **plus email** so that:
 *   • guessing many passwords for one account is blocked, and
 *   • a whole station sharing one public IP does not lock each other out by
 *     each mistyping their own password once.
 *
 * `skipSuccessfulRequests` means a person who logs in correctly does not burn
 * quota — only failures count.
 */
export const loginLimiter = createLimiter({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  keyGenerator: (req) => {
    // ipKey() collapses IPv6 to its /64 prefix, so an attacker holding a large
    // IPv6 range cannot get a fresh counter for every request.
    const ip = ipKey(req);
    const email = String(req.body?.email ?? '').toLowerCase().trim();
    return `${ip}:${email}`;
  },
});

/**
 * Silent session refresh.
 *
 * THIS MUST NOT REUSE `loginLimiter`, and doing so was a real bug:
 * `loginLimiter`'s key is `ip + body.email`, but a refresh request has no body
 * at all — so every refresh from one IP collapsed onto the single key `ip:` and
 * shared one counter of 10 per 15 minutes. Since the React app calls
 * /auth/refresh once on every page load (and gets a legitimate 401 when there
 * is no session yet, which `skipSuccessfulRequests` counts as a failure),
 * roughly ten page loads bricked authentication for a quarter of an hour.
 *
 * The limit here is about traffic volume, not credential guessing: a refresh
 * token is 48 bytes of randomness and cannot be guessed. The genuine protection
 * against a STOLEN one is rotation with reuse detection — presenting a spent
 * token revokes the whole family (see token.service.js) — not a rate limit.
 *
 * So: keyed on IP alone, and generous enough for a station where twenty
 * volunteers share one public address and reload the app freely.
 */
export const refreshLimiter = createLimiter({
  name: 'refresh',
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many session refreshes. Please wait a moment and reload.',
  keyGenerator: ipKey,
});

/**
 * Reads the `sub` claim from a JWT WITHOUT verifying it.
 *
 * Safe here, and only here: the value is used solely as a rate-limiting bucket.
 * It grants nothing — the token is still fully verified by verifyMfaToken()
 * before any code is accepted. A forged token would only choose which counter
 * to consume, which is not an advantage.
 */
function unverifiedSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString());
    return payload?.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * TOTP verification. A 6-digit code is only 1,000,000 possibilities, and the
 * attacker at this point has already passed the password step — so this limit
 * is the last line of defence and is the tightest in the app.
 *
 * KEYED PER USER, not per IP, and that was a bug fix. Keyed on IP alone, a
 * station where several volunteers sign in from the same wi-fi shared one
 * allowance of 8: one person mistyping their code three times ate everybody
 * else's attempts, and the next person to sign in was told to "log in again"
 * for no reason they could see.
 *
 * The user id comes from the MFA token, which is the only identifier present
 * on this request. Falling back to IP keeps a malformed request limited too.
 */
export const twoFactorLimiter = createLimiter({
  name: 'two-factor',
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: 'Too many verification attempts. Please sign in again.',
  keyGenerator: (req) => {
    const subject = unverifiedSubject(req.body?.mfaToken);
    // The IP is still part of the key so one user cannot be locked out by
    // someone else replaying their token from elsewhere.
    return subject ? `${ipKey(req)}:${subject}` : ipKey(req);
  },
});

/**
 * Password reset requests. Limits both email-bombing a volunteer and using
 * timing differences to discover which addresses are registered.
 *
 * Keyed on IP **plus email**, like the login limiter. Keying on IP alone would
 * mean that at a station where twenty volunteers share one public address, the
 * fifth person to forget their password in an hour would be told to "try again
 * later" because of four other people's requests.
 */
export const passwordResetLimiter = createLimiter({
  name: 'password-reset',
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: 'Too many password reset requests for this address. Please try again later.',
  keyGenerator: (req) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim();
    return `${ipKey(req)}:${email}`;
  },
});

/**
 * Reading and accepting an invitation.
 *
 * SEPARATE FROM the password-reset limiter, and that separation was a bug fix:
 * both invitation routes previously shared it, so a station onboarding a group
 * of volunteers over one wi-fi connection hit "too many password reset
 * requests" on the sixth person — who then could not join for an hour.
 *
 * The security here does not come from the rate limit. An invitation token is
 * 32 bytes of randomness (256 bits) and is stored only as a hash, so guessing
 * one is not a threat model. This limit exists only to stop somebody hammering
 * the endpoint, so it can be generous enough for a real onboarding session.
 */
export const invitationLimiter = createLimiter({
  name: 'invitation',
  windowMs: 60 * 60 * 1000,
  max: 40,
  message: 'Too many invitation requests. Please wait a few minutes and try again.',
  keyGenerator: ipKey,
});

/**
 * Invitation sending. Keyed by the ADMIN's user id rather than IP: the concern
 * is a compromised admin account draining the free email tier (300/day on
 * Brevo) or getting the sending domain flagged as spam.
 */
export const inviteLimiter = createLimiter({
  name: 'invite',
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Invitation limit reached for this hour.',
  keyGenerator: (req) => req.user?.id ?? ipKey(req),
});

/**
 * Writes (POST/PATCH/DELETE) by an authenticated user. Catches a runaway script
 * or a stuck "Save" button without affecting normal reading.
 *
 * WHY 120 AND NOT 60: the original 60/minute was tripped by legitimate bursts.
 * The end-to-end smoke test hit it on a second consecutive run, and the same
 * shape of traffic happens for real during a stock-take — a storekeeper working
 * through a shelf with the quick-entry form, or an admin restocking a vehicle
 * from a report's shortage list, produces a rapid run of small writes.
 *
 * 120/minute is still two per second sustained, which no person reaches by
 * hand, so it keeps the protection against a runaway loop while no longer
 * punishing fast, legitimate data entry. The limiter exists to stop a bug or a
 * script, not to pace a volunteer.
 */
export const writeLimiter = createLimiter({
  name: 'write',
  windowMs: 60 * 1000,
  max: 120,
  message: 'You are making changes too quickly. Please slow down.',
  keyGenerator: (req) => req.user?.id ?? ipKey(req),
});
