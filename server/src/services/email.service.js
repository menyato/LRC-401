/**
 * =============================================================================
 *  Email service
 * =============================================================================
 *  Two transports behind one interface:
 *
 *    console  (development) — prints the email, including the invitation link,
 *                             to the terminal. No SMTP account, no signup, no
 *                             risk of accidentally emailing a real volunteer
 *                             while testing.
 *    smtp     (production)  — Brevo (300/day free) or Resend (3 000/month free).
 *
 *  Callers never know or care which is active. Switching is one line in .env.
 *
 *  All templates are bilingual (English + Arabic) because the station operates
 *  in both, and a volunteer should not have to guess what an email says.
 * =============================================================================
 */

import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Built lazily and cached: creating an SMTP transport opens a connection pool,
 * which we do not want at import time (it would slow every boot, including
 * tests that never send anything).
 */
let cachedTransport = null;

function getTransport() {
  if (cachedTransport) return cachedTransport;

  if (env.EMAIL_TRANSPORT === 'smtp') {
    cachedTransport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE, // true only for port 465
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  } else {
    // `jsonTransport` builds the message but sends nothing, so we can log it.
    cachedTransport = nodemailer.createTransport({ jsonTransport: true });
  }

  return cachedTransport;
}

/**
 * Sends one email.
 *
 * NOTE ON FAILURES: this throws. Unlike the audit log, a failed invitation is
 * something the admin must see immediately — otherwise they tell a volunteer
 * "check your email" for a message that was never sent. The controller decides
 * how to surface it.
 */
async function send({ to, subject, html, text }) {
  const message = { from: env.EMAIL_FROM, to, subject, html, text };

  if (env.EMAIL_TRANSPORT === 'console') {
    // Print prominently — during development this is how you get the invite link.
    logger.info(
      `\n${'='.repeat(78)}\n  EMAIL (not actually sent — EMAIL_TRANSPORT=console)\n` +
        `${'='.repeat(78)}\n  To:      ${to}\n  Subject: ${subject}\n\n${text}\n${'='.repeat(78)}\n`,
    );
    return { messageId: 'console' };
  }

  const info = await getTransport().sendMail(message);
  logger.info({ to, subject, messageId: info.messageId }, 'Email sent');
  return info;
}

// -----------------------------------------------------------------------------
//  Layout
// -----------------------------------------------------------------------------

/**
 * Escapes text for the HTML body of an email.
 *
 * Names are user-controlled — anyone can set their own `fullName` from the
 * account page — and they appear in emails sent to OTHER people (the inviter's
 * name is in every invitation). Unescaped, a name such as
 * `<a href="https://evil.example">Click here</a>` would become a working link
 * inside an official-looking Red Cross email: a phishing kit for free.
 */
const escapeHtml = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );

/**
 * Wraps content in a minimal, table-free HTML shell.
 *
 * Deliberately plain: email clients (especially Outlook and older Android mail
 * apps, which volunteers do use) mangle modern CSS. Inline styles and simple
 * block elements are the only things that render reliably everywhere.
 */
const layout = (bodyHtml) => `
<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
      <div style="background:#ED1B2E;padding:20px 24px;">
        <div style="color:#ffffff;font-size:18px;font-weight:bold;">Lebanese Red Cross</div>
        <div style="color:#ffffff;opacity:.9;font-size:13px;">Saida 401 &middot; الصليب الأحمر اللبناني</div>
      </div>
      <div style="padding:24px;line-height:1.6;font-size:15px;">
        ${bodyHtml}
      </div>
      <div style="padding:16px 24px;background:#fafafa;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;">
        This is an automated message from the LRC Saida 401 system. Please do not reply.<br />
        هذه رسالة آلية من نظام الصليب الأحمر اللبناني - صيدا ٤٠١. الرجاء عدم الرد.
      </div>
    </div>
  </body>
</html>`;

/** Big red call-to-action button that survives most email clients. */
const button = (url, label) => `
  <p style="text-align:center;margin:28px 0;">
    <a href="${url}" style="background:#ED1B2E;color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:8px;display:inline-block;font-weight:bold;">${label}</a>
  </p>`;

// -----------------------------------------------------------------------------
//  Templates
// -----------------------------------------------------------------------------

/**
 * Invitation — "they receive an email, accept, then set their own password."
 *
 * The link carries a one-time token. We never email a password: a password sent
 * by email exists forever in an inbox, is often reused, and cannot be revoked.
 * Letting the person choose their own on a secure page avoids all of that.
 */
export async function sendInvitationEmail({ to, fullName, roleName, inviterName, token }) {
  const safe = {
    fullName: escapeHtml(fullName),
    roleName: escapeHtml(roleName),
    inviterName: escapeHtml(inviterName),
  };
  const url = `${env.CLIENT_URL}/accept-invitation?token=${encodeURIComponent(token)}`;
  const hours = env.INVITE_TTL_HOURS;

  const text = [
    `Hello ${fullName},`,
    '',
    `${inviterName} has invited you to the Lebanese Red Cross Saida 401 system as "${roleName}".`,
    `Open this link to set your password and activate your account:`,
    url,
    '',
    `This link expires in ${hours} hours.`,
    '',
    '— — —',
    '',
    `مرحباً ${fullName}،`,
    `تمت دعوتك للانضمام إلى نظام الصليب الأحمر اللبناني - صيدا ٤٠١ بصفة "${roleName}".`,
    `افتح الرابط أعلاه لتعيين كلمة المرور وتفعيل حسابك. تنتهي صلاحية الرابط خلال ${hours} ساعة.`,
  ].join('\n');

  const html = layout(`
    <p>Hello <strong>${safe.fullName}</strong>,</p>
    <p><strong>${safe.inviterName}</strong> has invited you to the Lebanese Red Cross Saida 401 system
       as <strong>${safe.roleName}</strong>.</p>
    <p>Click below to set your own password and activate your account.</p>
    ${button(url, 'Accept invitation')}
    <p style="color:#71717a;font-size:13px;">This link expires in ${hours} hours. If you were not
       expecting this invitation, you can ignore this email.</p>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
    <div dir="rtl" style="text-align:right;">
      <p>مرحباً <strong>${safe.fullName}</strong>،</p>
      <p>تمت دعوتك للانضمام إلى نظام الصليب الأحمر اللبناني - صيدا ٤٠١ بصفة <strong>${safe.roleName}</strong>.</p>
      <p>اضغط على الزر أعلاه لتعيين كلمة المرور الخاصة بك وتفعيل حسابك.
         تنتهي صلاحية الرابط خلال ${hours} ساعة.</p>
    </div>`);

  return send({ to, subject: 'Your Lebanese Red Cross Saida 401 account invitation', html, text });
}

/** Password reset link. */
export async function sendPasswordResetEmail({ to, fullName, token }) {
  const url = `${env.CLIENT_URL}/reset-password?token=${encodeURIComponent(token)}`;
  const minutes = env.PASSWORD_RESET_TTL_MINUTES;

  const text = [
    `Hello ${fullName},`,
    '',
    'We received a request to reset your password. Open this link to choose a new one:',
    url,
    '',
    `This link expires in ${minutes} minutes.`,
    'If you did not request this, ignore this email — your password has not changed.',
  ].join('\n');

  const html = layout(`
    <p>Hello <strong>${escapeHtml(fullName)}</strong>,</p>
    <p>We received a request to reset your password.</p>
    ${button(url, 'Choose a new password')}
    <p style="color:#71717a;font-size:13px;">This link expires in ${minutes} minutes. If you did not
       request it, you can ignore this email — your password has not been changed.</p>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
    <div dir="rtl" style="text-align:right;">
      <p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بك.
         اضغط على الزر أعلاه لاختيار كلمة مرور جديدة. تنتهي صلاحية الرابط خلال ${minutes} دقيقة.</p>
    </div>`);

  return send({ to, subject: 'Reset your Lebanese Red Cross Saida 401 password', html, text });
}

/**
 * Security notification after a password change.
 * Sent even though the user just did it on purpose: if they did NOT, this email
 * is the only way they find out their account was taken over.
 */
export async function sendPasswordChangedEmail({ to, fullName }) {
  const text = [
    `Hello ${fullName},`,
    '',
    'Your password was just changed, and all other sessions were signed out.',
    'If this was not you, contact the station super admin immediately.',
  ].join('\n');

  const html = layout(`
    <p>Hello <strong>${escapeHtml(fullName)}</strong>,</p>
    <p>Your password was just changed. For your security, every other signed-in device
       has been signed out.</p>
    <p style="color:#b91c1c;"><strong>If this was not you, contact the station super admin
       immediately.</strong></p>
    <hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />
    <div dir="rtl" style="text-align:right;">
      <p>تم تغيير كلمة المرور الخاصة بك، وتم تسجيل الخروج من كل الأجهزة الأخرى.
         إذا لم تكن أنت من قام بذلك، تواصل مع مسؤول المركز فوراً.</p>
    </div>`);

  return send({ to, subject: 'Your password was changed', html, text });
}
