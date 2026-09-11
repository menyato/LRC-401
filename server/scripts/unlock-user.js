/**
 * =============================================================================
 *  Unlock a locked-out account
 * =============================================================================
 *  After MAX_FAILED_LOGINS wrong passwords (default 5) an account is locked for
 *  ACCOUNT_LOCK_MINUTES (default 15). That is deliberate — it is what stops an
 *  attacker rotating through IP addresses to brute-force one person's password,
 *  since the per-IP rate limiter alone would not catch that.
 *
 *  But it means a volunteer who mistypes their password five times is locked out
 *  of a system they may need at 3am, and the station needs a way to clear it
 *  without waiting.
 *
 *      npm run unlock -- someone@example.com
 *      npm run unlock -- --all          (clears every lockout)
 *
 *  This ONLY clears the counter and the lock. It does not change, reveal or
 *  reset any password — an unlock must never be a way to take over an account.
 *  To issue a new password, use the super admin's "Reset password" action in
 *  the dashboard, which is audited.
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const argument = process.argv[2];

if (!argument) {
  console.error('\n  Usage:  npm run unlock -- <email>');
  console.error('          npm run unlock -- --all\n');
  process.exit(1);
}

/** The fields that constitute a lockout. Nothing else is touched. */
const CLEAR_LOCKOUT = { failedLoginAttempts: 0, lockedUntil: null };

if (argument === '--all') {
  // Only accounts that are actually locked or have failures pending, so the
  // reported count means something.
  const { count } = await prisma.user.updateMany({
    where: {
      OR: [{ lockedUntil: { not: null } }, { failedLoginAttempts: { gt: 0 } }],
    },
    data: CLEAR_LOCKOUT,
  });

  console.log(`\n  Cleared the lockout on ${count} account(s).\n`);
} else {
  const email = argument.toLowerCase().trim();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      fullName: true,
      status: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    console.error(`\n  No account found for ${email}\n`);
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.user.update({ where: { id: user.id }, data: CLEAR_LOCKOUT });

  console.log(`\n  Unlocked ${user.fullName} <${user.email}>`);
  console.log(`    was: ${user.failedLoginAttempts} failed attempt(s)` +
    (user.lockedUntil ? `, locked until ${user.lockedUntil.toISOString()}` : ', not locked'));
  console.log(`    now: 0 failed attempts, not locked`);

  // A suspended account will still refuse to sign in, and the reason would be
  // baffling if we did not say so here.
  if (user.status !== 'ACTIVE') {
    console.log(`\n  NOTE: this account is ${user.status}, so it still cannot sign in.`);
    console.log('        Reactivate it from the dashboard (People -> Reactivate).');
  }

  console.log('');
}

await prisma.$disconnect();
