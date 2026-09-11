/**
 * =============================================================================
 *  Two-factor authentication (TOTP)
 * =============================================================================
 *  TOTP = the 6-digit code that rotates every 30 seconds in Google
 *  Authenticator, Microsoft Authenticator, Authy, 1Password, etc.
 *
 *  Chosen over SMS because:
 *    • SMS costs money per message — a permanent bill for a volunteer station;
 *    • SMS to Lebanese networks is unreliable and slow;
 *    • SIM-swap and SS7 interception make SMS the weakest common second factor;
 *    • TOTP works with no signal at all, which matters in a basement ER room.
 *
 *  THE SECRET IS ENCRYPTED AT REST (see utils/crypto.js). Unlike a password, a
 *  TOTP secret must be recoverable to verify each code, so hashing is not an
 *  option — encryption with a key held outside the database is.
 * =============================================================================
 */

import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import { encryptSecret, decryptSecret, generateBackupCode } from '../utils/crypto.js';

/**
 * Allow the code from one 30-second step before and after the current one.
 *
 * Why not zero tolerance? Phone clocks drift, and a volunteer typing a code at
 * second 29 will otherwise fail through no fault of their own. A window of 1
 * means codes are accepted for ~90 seconds, which is still a negligible attack
 * surface given the rate limiter caps attempts at 8 per 15 minutes.
 */
authenticator.options = { window: 1 };

/** How the account appears inside the authenticator app. */
const ISSUER = 'LRC Saida 401';

/**
 * Step 1 of enrolment: generate a secret and the QR code to scan.
 *
 * The secret is NOT saved as enabled yet — see confirmEnrollment. A user who
 * abandons setup halfway must not be locked out of their own account by a
 * second factor they never finished configuring.
 *
 * @param {string} email  Shown as the account name in the app.
 * @returns {Promise<{ secret: string, encryptedSecret: string,
 *                     otpauthUrl: string, qrCodeDataUrl: string }>}
 */
export async function generateEnrollment(email) {
  const secret = authenticator.generateSecret();

  // otpauth:// URI — the standard format every authenticator app understands.
  const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);

  // Rendered as a data URL so the frontend can put it straight in an <img src>
  // with no extra request and no image file stored anywhere.
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });

  return {
    // Plain secret is returned ONCE so the user can type it manually if their
    // camera will not scan. It is never stored in this form.
    secret,
    encryptedSecret: encryptSecret(secret),
    otpauthUrl,
    qrCodeDataUrl,
  };
}

/**
 * Verifies a 6-digit code against an encrypted secret.
 *
 * @param {string} encrypted  The value stored in User.twoFactorSecret.
 * @param {string} code       What the user typed.
 * @returns {boolean}
 */
export function verifyCode(encrypted, code) {
  if (!encrypted || !code) return false;

  try {
    // Strip spaces: authenticator apps display "123 456" and people copy it
    // with the space, which would otherwise fail for no understandable reason.
    const token = String(code).replace(/\s/g, '');
    return authenticator.verify({ token, secret: decryptSecret(encrypted) });
  } catch {
    // Decryption failure (wrong TOTP_ENC_KEY, tampered ciphertext) or a
    // malformed token. Either way the answer is "no" — we never throw here,
    // because a thrown error would produce a 500 and tell an attacker that
    // something about this account is unusual.
    return false;
  }
}

/**
 * Generates recovery codes for the user to write down.
 *
 * Essential: a lost or wiped phone otherwise means permanent lockout, and the
 * only remedy would be a super admin manually disabling 2FA — which is both a
 * support burden and a social-engineering vector.
 *
 * Codes are stored as bcrypt HASHES, exactly like passwords, so a database leak
 * does not hand over a set of working second factors.
 *
 * @param {number} [count=8]
 * @returns {Promise<{ plainCodes: string[], hashedCodes: string[] }>}
 */
export async function generateBackupCodes(count = 8) {
  const plainCodes = Array.from({ length: count }, generateBackupCode);

  // Cost 10 rather than the 12 used for passwords: there are eight of them to
  // hash in one request, and the input is high-entropy random (not a guessable
  // human password), so the extra work buys nothing.
  const hashedCodes = await Promise.all(plainCodes.map((code) => bcrypt.hash(code, 10)));

  return { plainCodes, hashedCodes };
}

/**
 * Checks a backup code and reports which stored hash it consumed.
 *
 * Backup codes are SINGLE USE — the caller must remove the returned index from
 * the user's list. Reusable recovery codes would be a permanent second factor
 * sitting in someone's wallet.
 *
 * @param {string[]} hashedCodes
 * @param {string} candidate
 * @returns {Promise<number>} Index of the matching code, or -1.
 */
export async function verifyBackupCode(hashedCodes, candidate) {
  if (!candidate || !hashedCodes?.length) return -1;

  // Normalise "4f7k92qd" / "4F7K 92QD" to the stored "4F7K-92QD" shape.
  const normalized = String(candidate).trim().toUpperCase().replace(/\s/g, '');

  for (let index = 0; index < hashedCodes.length; index += 1) {
    // Sequential rather than Promise.all: we want to stop at the first match,
    // and hashing all eight in parallel on every attempt is wasted CPU.
    if (await bcrypt.compare(normalized, hashedCodes[index])) return index;
  }

  return -1;
}
