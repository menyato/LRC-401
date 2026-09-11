/**
 * =============================================================================
 *  Set a user's password directly
 * =============================================================================
 *  A break-glass tool for the person who owns the server. It exists for exactly
 *  two situations:
 *
 *    • the last super admin is locked out and nobody can reset them from inside
 *      the app;
 *    • a fresh install where the seeded password has been changed and forgotten.
 *
 *      npm run set-password -- someone@example.com 'NewPassword123'
 *
 *  It applies the SAME policy the API does (10+ chars, upper, lower, digit), so
 *  this cannot be used to smuggle in a weak password that the app itself would
 *  reject.
 *
 *  It also clears any lockout and the mustChangePassword flag, and revokes every
 *  existing session — because if you needed this tool, you cannot be sure who
 *  else currently holds a session for that account.
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { passwordSchema } from '../src/utils/password.js';

const prisma = new PrismaClient();

const [emailArgument, password] = process.argv.slice(2);

if (!emailArgument || !password) {
  console.error("\n  Usage: npm run set-password -- <email> '<newPassword>'\n");
  process.exit(1);
}

const email = emailArgument.toLowerCase().trim();

// Same rules as the API. A back door that accepts "admin" would make the
// policy meaningless.
const parsed = passwordSchema.safeParse(password);

if (!parsed.success) {
  console.error('\n  That password does not meet the policy:\n');
  for (const issue of parsed.error.issues) {
    console.error(`    • ${issue.message}`);
  }
  console.error('');
  await prisma.$disconnect();
  process.exit(1);
}

const user = await prisma.user.findUnique({
  where: { email },
  select: { id: true, fullName: true, email: true, status: true },
});

if (!user) {
  console.error(`\n  No account found for ${email}\n`);
  await prisma.$disconnect();
  process.exit(1);
}

await prisma.$transaction([
  prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      // Cleared deliberately: this tool is used when someone is stuck, and
      // forcing another change immediately would leave them stuck again.
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  }),
  // Anyone holding a session for this account loses it.
  prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  }),
]);

console.log(`\n  Password set for ${user.fullName} <${user.email}>`);
console.log('    · lockout cleared');
console.log('    · mustChangePassword cleared');
console.log('    · all existing sessions revoked');

if (user.status !== 'ACTIVE') {
  console.log(`\n  NOTE: this account is ${user.status} and still cannot sign in.`);
}

console.log('');

await prisma.$disconnect();
