/**
 * =============================================================================
 *  Send one test email
 * =============================================================================
 *  Proves the SMTP settings in .env actually deliver, BEFORE a volunteer is
 *  waiting for an invitation that never arrives.
 *
 *      npm run email:test -- you@example.com
 *
 *  It uses the same validated config as the server, logs in to the SMTP server
 *  first (so a wrong password is reported as exactly that), then sends a short
 *  message. With EMAIL_TRANSPORT=console it refuses, because nothing would be
 *  sent and a "success" would be misleading.
 * =============================================================================
 */

import nodemailer from 'nodemailer';
import { env } from '../src/config/env.js';

const [to] = process.argv.slice(2);

if (!to) {
  console.error('\n  Usage: npm run email:test -- <recipient@example.com>\n');
  process.exit(1);
}

if (env.EMAIL_TRANSPORT !== 'smtp') {
  console.error('\n  EMAIL_TRANSPORT is "console" — nothing would be sent.');
  console.error('  Set EMAIL_TRANSPORT=smtp and the SMTP_* values in server/.env first.\n');
  process.exit(1);
}

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

console.log(`\n  SMTP  ${env.SMTP_USER} @ ${env.SMTP_HOST}:${env.SMTP_PORT} (secure=${env.SMTP_SECURE})`);
console.log(`  From  ${env.EMAIL_FROM}`);

try {
  await transport.verify();
  console.log('  ✓ signed in to the SMTP server');
} catch (error) {
  console.error(`\n  ✗ Could not sign in: ${error.message}`);
  if (/gmail/i.test(env.SMTP_HOST ?? '')) {
    console.error('\n  For Gmail, SMTP_PASS must be a 16-character App Password, not your');
    console.error('  normal Google password: https://myaccount.google.com/apppasswords');
    console.error('  (2-Step Verification must be ON for that page to exist.)');
  }
  console.error('');
  process.exit(1);
}

const info = await transport.sendMail({
  from: env.EMAIL_FROM,
  to,
  subject: 'LRC Saida 401 — test email',
  text: `If you can read this, email delivery from ${env.CLIENT_URL} works.\n\nSent ${new Date().toISOString()}`,
});

console.log(`  ✓ sent to ${to}  (message id ${info.messageId})`);
console.log('\n  Check the inbox AND the spam folder.\n');
