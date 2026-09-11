/**
 * =============================================================================
 *  Cryptographic helpers
 * =============================================================================
 *  Small, deliberate wrappers over Node's built-in `crypto`. Kept in one file
 *  so that every security-sensitive primitive in the project can be reviewed in
 *  a single sitting.
 * =============================================================================
 */

import crypto from 'node:crypto';
import { env } from '../config/env.js';

// -----------------------------------------------------------------------------
//  Random tokens (invitations, password resets, refresh tokens)
// -----------------------------------------------------------------------------

/**
 * Generates a cryptographically secure random token for emailing to a user.
 *
 * base64url (not hex) because it packs the same entropy into ~33% fewer
 * characters, keeping invitation links short enough not to wrap in an email
 * client, and it is URL-safe with no escaping.
 *
 * @param {number} [bytes=32]  32 bytes = 256 bits. Unguessable.
 */
export const generateToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/**
 * Hashes a token for storage.
 *
 * WHY: invitation and reset tokens are bearer credentials — whoever holds the
 * string can use it. If we stored them in plain text, a database leak (or a
 * careless `SELECT *` in a support session) would let someone take over any
 * pending account. We store only the hash, exactly as we do for passwords.
 *
 * SHA-256 rather than bcrypt is correct HERE because the input is already 256
 * bits of randomness: there is no dictionary to attack, so the deliberate
 * slowness of bcrypt would buy nothing while making every lookup expensive.
 * (Passwords are the opposite case — see password.js.)
 */
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Compares two strings in constant time.
 *
 * A normal `===` returns as soon as it finds a differing character. An attacker
 * who can measure response times can exploit that to recover a secret one
 * character at a time. `timingSafeEqual` always takes the same time.
 */
export const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  // timingSafeEqual throws on length mismatch, so check length first. Leaking
  // the LENGTH of a hash is harmless — both sides are fixed-length digests.
  if (bufferA.length !== bufferB.length) return false;

  return crypto.timingSafeEqual(bufferA, bufferB);
};

// -----------------------------------------------------------------------------
//  Symmetric encryption — for TOTP secrets
// -----------------------------------------------------------------------------
//  A TOTP secret must be RECOVERABLE (we need the original value to verify each
//  6-digit code), so it cannot be hashed. But storing it in clear would mean a
//  database leak defeats two-factor authentication entirely: an attacker with
//  the secret can generate valid codes forever.
//
//  So we encrypt it with AES-256-GCM using a key that lives in the environment,
//  NOT in the database. Stealing the database alone is then not enough.
//
//  GCM (rather than CBC) because it is authenticated: tampering with the stored
//  ciphertext makes decryption fail loudly instead of silently producing
//  garbage.
// -----------------------------------------------------------------------------

const ALGORITHM = 'aes-256-gcm';
/** 96-bit IV is the size GCM is specified and optimised for. */
const IV_LENGTH = 12;

/** Parsed once at module load; env.js has already validated it is 64 hex chars. */
const getKey = () => Buffer.from(env.TOTP_ENC_KEY, 'hex');

/**
 * @param {string} plaintext
 * @returns {string} "iv:authTag:ciphertext", all base64url — one DB column.
 */
export function encryptSecret(plaintext) {
  // A fresh random IV per encryption. Reusing an IV with GCM is catastrophic:
  // it leaks the XOR of the two plaintexts and breaks authentication.
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64url'), authTag.toString('base64url'), encrypted.toString('base64url')].join(
    ':',
  );
}

/**
 * @param {string} payload  The string produced by encryptSecret.
 * @returns {string} The original plaintext.
 * @throws  If the key is wrong or the ciphertext was tampered with.
 */
export function decryptSecret(payload) {
  const [ivPart, tagPart, dataPart] = String(payload).split(':');

  if (!ivPart || !tagPart || !dataPart) {
    throw new Error('Malformed encrypted payload');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivPart, 'base64url'),
  );
  // Must be set before final(); this is what makes the decryption authenticated.
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

// -----------------------------------------------------------------------------
//  Misc
// -----------------------------------------------------------------------------

/**
 * Human-friendly recovery code, e.g. "4F7K-92QD".
 *
 * The alphabet deliberately omits 0/O and 1/I/L: these codes get written on
 * paper and read back by a volunteer under pressure, and those pairs are the
 * ones people mistranscribe.
 */
export function generateBackupCode() {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const pick = () =>
    Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');

  return `${pick()}-${pick()}`;
}

/** Random identifier for grouping a refresh-token rotation chain. */
export const generateFamilyId = () => crypto.randomUUID();
