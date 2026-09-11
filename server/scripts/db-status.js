/**
 * =============================================================================
 *  Database status
 * =============================================================================
 *  Prints what is actually in the database. Useful after a seed, after a
 *  deployment, or when someone asks "is it set up?".
 *
 *      npm run db:status
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const rows = [
  ['Users', () => prisma.user.count()],
  ['  · active', () => prisma.user.count({ where: { status: 'ACTIVE' } })],
  ['  · super admins', () => prisma.user.count({ where: { isSuperAdmin: true } })],
  ['Roles', () => prisma.role.count()],
  ['Teams', () => prisma.team.count()],
  ['Vehicles', () => prisma.vehicle.count()],
  ['Item categories', () => prisma.itemCategory.count()],
  ['  · custom fields', () => prisma.itemAttributeDef.count()],
  ['Items', () => prisma.item.count()],
  ['  · tracking expiry', () => prisma.item.count({ where: { trackExpiry: true } })],
  ['  · tracking size', () => prisma.item.count({ where: { trackSize: true } })],
  ['Stock lots', () => prisma.stockLot.count()],
  ['Stock movements', () => prisma.stockMovement.count()],
  ['Form templates', () => prisma.formTemplate.count()],
  ['  · published', () => prisma.formTemplate.count({ where: { status: 'PUBLISHED' } })],
  ['Form sections', () => prisma.formSection.count()],
  ['Form questions', () => prisma.formField.count()],
  ['Submissions', () => prisma.formSubmission.count()],
  ['Assignments', () => prisma.assignment.count()],
  ['Audit entries', () => prisma.auditLog.count()],
];

const results = await Promise.all(rows.map(async ([label, fn]) => [label, await fn()]));

console.log('\n══════════════════════════════════════════');
console.log('  LRC-401 — database contents');
console.log('══════════════════════════════════════════');
for (const [label, count] of results) {
  console.log(`  ${label.padEnd(26)} ${String(count).padStart(5)}`);
}
console.log('══════════════════════════════════════════\n');

await prisma.$disconnect();
