/**
 * =============================================================================
 *  Token service — issuing, rotating and revoking sessions.
 * =============================================================================
 *  THE DESIGN, and why:
 *
 *  ┌─ Access token ──────────────────────────────────────────────────────────┐
 *  │ A JWT, 15 minutes, returned in the JSON body and held in memory by the  │
 *  │ React app (a JS variable — NOT localStorage).                           │
 *  │                                                                          │
 *  │ Why not localStorage? Any successful XSS can read it. Keeping it in a    │
 *  │ closure means it dies with the tab and is never persisted anywhere an    │
 *  │ injected script can reach with a one-line `localStorage.getItem`.       │
 *  │                                                                          │
 *  │ Why so short? A JWT cannot be revoked — that is the trade for not        │
 *  │ hitting the database on every request. 15 minutes bounds the damage.     │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ Refresh token ─────────────────────────────────────────────────────────┐
 *  │ Opaque random string, 30 days, in an httpOnly + SameSite=Lax cookie,     │
 *  │ stored HASHED in the database.                                          │
 *  │                                                                          │
 *  │ httpOnly means JavaScript cannot read it at all, so XSS cannot steal a   │
 *  │ long-lived credential. Because it is a database row and not a JWT, it is │
 *  │ genuinely revocable — "log out on all devices" actually works.           │
 *  │                                                                          │
 *  │ ROTATION + THEFT DETECTION: every refresh consumes the old token and     │
 *  │ issues a new one in the same "family". If a token that was already used  │
 *  │ is presented again, either the legitimate user or a thief has a stale    │
 *  │ copy — we cannot tell which, so we revoke the entire family and force a  │
 *  │ fresh login. This turns a silent, permanent compromise into a single     │
 *  │ visible logout.                                                          │
 *  └──────────────────────────────────────────────────────────────────────────┘
 *
 *  ┌─ MFA token ─────────────────────────────────────────────────────────────┐
 *  │ 5-minute JWT proving "this person passed the password step". It carries  │
 *  │ no permissions and is signed with its OWN secret, so it can never be     │
 *  │ mistaken for an access token by a coding slip.                           │
 *  └──────────────────────────────────────────────────────────────────────────┘
 * =============================================================================
 */

import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { generateToken, hashToken, generateFamilyId } from '../utils/crypto.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/** Name of the refresh cookie. */
export const REFRESH_COOKIE = 'lrc_refresh';

/**
 * `typ` claim distinguishes token purposes. Combined with separate secrets this
 * gives defence in depth: even if two secrets were accidentally set the same,
 * an MFA token still could not be replayed as an access token.
 */
const TOKEN_TYPES = { ACCESS: 'access', MFA: 'mfa' };

// -----------------------------------------------------------------------------
//  Access token
// -----------------------------------------------------------------------------

/**
 * The payload is deliberately MINIMAL — id and type only.
 *
 * Permissions are NOT embedded. It is tempting (it saves a query), but a JWT is
 * valid until it expires: if the super admin revokes someone's access, an
 * embedded permission list would keep working for up to 15 more minutes. For an
 * access-control system whose whole point is that the super admin is in charge,
 * that is the wrong trade. We re-read permissions per request instead — a single
 * indexed lookup.
 */
export const signAccessToken = (userId) =>
  jwt.sign(
    {
      sub: userId,
      typ: TOKEN_TYPES.ACCESS,
      /**
       * Issued-at in MILLISECONDS.
       *
       * The standard `iat` claim is whole seconds, which is too coarse for the
       * `sessionsRevokedAt` cut-off: a token minted 300ms before a revocation
       * and one minted 300ms after carry the same `iat`, so the comparison had
       * to choose between letting a stolen token through for up to a second, or
       * falsely rejecting a token that was issued legitimately.
       *
       * Both symptoms showed up in the scenario suite. This claim removes the
       * ambiguity entirely — the comparison becomes exact.
       */
      ims: Date.now(),
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.ACCESS_TOKEN_TTL, issuer: 'lrc-401' },
  );

/** @throws {jwt.JsonWebTokenError} handled centrally by middleware/error.js */
export function verifyAccessToken(token) {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'lrc-401' });

  if (payload.typ !== TOKEN_TYPES.ACCESS) {
    throw ApiError.unauthorized('Invalid token type');
  }

  return payload;
}

// -----------------------------------------------------------------------------
//  MFA (half-authenticated) token
// -----------------------------------------------------------------------------

export const signMfaToken = (userId) =>
  jwt.sign({ sub: userId, typ: TOKEN_TYPES.MFA }, env.JWT_MFA_SECRET, {
    expiresIn: env.MFA_TOKEN_TTL,
    issuer: 'lrc-401',
  });

export function verifyMfaToken(token) {
  const payload = jwt.verify(token, env.JWT_MFA_SECRET, { issuer: 'lrc-401' });

  if (payload.typ !== TOKEN_TYPES.MFA) {
    throw ApiError.unauthorized('Invalid token type');
  }

  return payload;
}

// -----------------------------------------------------------------------------
//  Refresh tokens
// -----------------------------------------------------------------------------

/** Expiry date for a newly issued refresh token. */
const refreshExpiry = () =>
  new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

/**
 * Creates a refresh token row and returns the RAW token (the only time it
 * exists in plain text — after this only its hash is stored).
 *
 * @param {string} userId
 * @param {{ userAgent?: string, ipAddress?: string, familyId?: string }} context
 * @returns {Promise<{ token: string, expiresAt: Date, familyId: string }>}
 */
export async function issueRefreshToken(userId, { userAgent, ipAddress, familyId } = {}) {
  const token = generateToken(48);
  const expiresAt = refreshExpiry();
  // A new login starts a new family; a rotation continues the existing one.
  const family = familyId ?? generateFamilyId();

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      familyId: family,
      // Truncated: some bots send kilobyte-long user agents, and we only need
      // enough to show "Chrome on Windows" in a sessions list.
      userAgent: userAgent?.slice(0, 255),
      ipAddress,
      expiresAt,
    },
  });

  return { token, expiresAt, familyId: family };
}

/**
 * Validates and rotates a refresh token.
 *
 * @returns {Promise<{ userId: string, token: string, expiresAt: Date }>}
 * @throws  {ApiError} 401 when the token is unknown, expired, or reused.
 */
export async function rotateRefreshToken(rawToken, { userAgent, ipAddress } = {}) {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { id: true, userId: true, familyId: true, expiresAt: true, revokedAt: true },
  });

  if (!existing) {
    throw ApiError.unauthorized('Session not recognised. Please sign in again.', {
      code: 'REFRESH_INVALID',
    });
  }

  // --- Theft detection ------------------------------------------------------
  // This token was already spent. Either a thief is replaying a captured token,
  // or the real user is replaying an old one. We cannot distinguish, so we take
  // the safe branch and kill every session in the family.
  if (existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    logger.warn(
      { userId: existing.userId, familyId: existing.familyId, ipAddress },
      'Refresh token reuse detected — revoked entire token family',
    );

    throw ApiError.unauthorized('Your session was ended for security reasons. Please sign in again.', {
      code: 'REFRESH_REUSED',
    });
  }

  if (existing.expiresAt < new Date()) {
    throw ApiError.unauthorized('Your session has expired. Please sign in again.', {
      code: 'REFRESH_EXPIRED',
    });
  }

  // --- Rotate ---------------------------------------------------------------
  // Both writes in one transaction: if issuing the new token failed after
  // revoking the old one, the user would be logged out by a transient error.
  const newToken = generateToken(48);
  const expiresAt = refreshExpiry();

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(newToken),
        userId: existing.userId,
        familyId: existing.familyId,
        userAgent: userAgent?.slice(0, 255),
        ipAddress,
        expiresAt,
      },
    }),
  ]);

  return { userId: existing.userId, token: newToken, expiresAt };
}

/** Revokes a single session (normal logout). Silent if already gone. */
export async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;

  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes EVERY session for a user.
 * Called on password change, on 2FA changes, and when an admin suspends an
 * account — all moments where any existing session must stop being trusted.
 */
export async function revokeAllUserTokens(userId) {
  const now = new Date();

  // Two halves, and BOTH are needed:
  //
  //   1. Revoking the refresh tokens stops new access tokens being minted.
  //   2. Stamping `sessionsRevokedAt` invalidates the access tokens that are
  //      ALREADY out there. Without this second half, a stolen access token
  //      kept working for up to ACCESS_TOKEN_TTL (15 minutes) after the victim
  //      changed their password — which is precisely the window a password
  //      change is meant to close.
  //
  // One transaction so a session can never be half-revoked.
  const [revoked] = await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { sessionsRevokedAt: now },
    }),
  ]);

  logger.info({ userId, count: revoked.count }, 'Revoked all sessions for user');
  return revoked.count;
}

// -----------------------------------------------------------------------------
//  Cookie helpers
// -----------------------------------------------------------------------------

/**
 * Cookie options, in one place so login/refresh/logout can never disagree.
 * A mismatch here is a classic bug: the browser keeps a cookie the server
 * thinks it cleared, because one call omitted `path`.
 */
const cookieOptions = (expiresAt) => ({
  // Unreadable from JavaScript — the whole point.
  httpOnly: true,
  // Only sent over HTTPS in production; allowed on http://localhost in dev.
  secure: env.isProduction,
  // 'lax' still sends the cookie on top-level navigation (so the emailed
  // invitation link works) while blocking the cross-site POSTs that CSRF needs.
  sameSite: 'lax',
  // Scoped to the refresh endpoints only, so the cookie is not attached to
  // every ordinary API call — it cannot leak where it is not needed.
  path: '/api/auth',
  expires: expiresAt,
});

export const setRefreshCookie = (res, token, expiresAt) =>
  res.cookie(REFRESH_COOKIE, token, cookieOptions(expiresAt));

export const clearRefreshCookie = (res) =>
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(new Date(0)), expires: undefined });

/**
 * Housekeeping: delete expired/revoked rows. Run from a scheduled job.
 * Without it, `RefreshToken` grows forever — on a 0.5 GB free-tier database
 * that eventually matters.
 */
export async function pruneExpiredTokens() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const { count } = await prisma.refreshToken.deleteMany({
    // Keep revoked tokens for a week: they are the evidence trail if we need to
    // investigate a suspected theft.
    where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
  });

  return count;
}
