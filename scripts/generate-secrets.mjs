/**
 * Prints a fresh set of production secrets, ready to paste into Vercel
 * (Settings → Environment Variables) or Render.
 *
 *     npm run secrets
 *
 * Every run gives NEW values. Generate them once per environment (staging and
 * production each get their own) and do not reuse the ones from server/.env.
 *
 * These are random keys, not passwords anyone types: the JWT secrets sign
 * session tokens and TOTP_ENC_KEY encrypts two-factor secrets in the database.
 * The admin's login password is never stored in the environment — the seed
 * hashes it with bcrypt straight into the database.
 */

import crypto from 'node:crypto';

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

console.log(`
  Paste these into the host's environment variables (Production scope):

JWT_ACCESS_SECRET=${hex(48)}
JWT_REFRESH_SECRET=${hex(48)}
JWT_MFA_SECRET=${hex(48)}
TOTP_ENC_KEY=${hex(32)}

  ⚠  Save TOTP_ENC_KEY somewhere safe (a password manager) NOW.
     It encrypts everyone's two-factor setup. If it is lost or changed later,
     every user who enabled 2FA is locked out.

  The three JWT secrets can be regenerated at any time; doing so simply signs
  everyone out.
`);
