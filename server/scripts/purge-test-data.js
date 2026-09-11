/**
 * =============================================================================
 *  Purge test data
 * =============================================================================
 *  The automated suites create teams, vehicles, items, roles and accounts. They
 *  retire their own users (suspend — a user who has touched the ledger cannot be
 *  deleted), but the org rows they create accumulate and clutter the real
 *  station's pickers.
 *
 *  This removes anything whose name marks it as test data, and ONLY when no
 *  real record depends on it. Nothing belonging to the station is touched.
 *
 *      npm run purge:test-data
 *
 *  Safe to run any time. It refuses to run against NODE_ENV=production.
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production') {
  console.error('\n  Refusing to run against NODE_ENV=production.\n');
  process.exit(1);
}

/** Name prefixes the test suites stamp on everything they create. */
const TEST_PREFIXES = ['SMOKE', 'SCENARIO', 'RESPCHK'];
const TEST_EMAIL_PREFIXES = ['smoke-runner', 'smoke-invitee', 'scenario-', 'respchk-'];

const nameMatches = { OR: TEST_PREFIXES.map((prefix) => ({ nameEn: { startsWith: prefix } })) };

console.log('\n  Purging test data\n');

// ---------------------------------------------------------------------------
//  1. Submissions and assignments belonging to test teams or vehicles.
//     These must go first — they are what keeps the teams and vehicles alive.
// ---------------------------------------------------------------------------
const testTeams = await prisma.team.findMany({ where: nameMatches, select: { id: true } });
const testVehicles = await prisma.vehicle.findMany({ where: nameMatches, select: { id: true } });

const teamIds = testTeams.map((team) => team.id);
const vehicleIds = testVehicles.map((vehicle) => vehicle.id);

if (teamIds.length || vehicleIds.length) {
  const scope = { OR: [{ teamId: { in: teamIds } }, { vehicleId: { in: vehicleIds } }] };

  const subs = await prisma.formSubmission.deleteMany({ where: scope });
  const asgs = await prisma.assignment.deleteMany({ where: scope });

  console.log(`    submissions removed   ${subs.count}`);
  console.log(`    assignments removed   ${asgs.count}`);
}

// Submissions filed by a test ACCOUNT against a real team (older suites did
// this before they created their own teams).
const byTestUser = await prisma.formSubmission.deleteMany({
  where: { submittedBy: { OR: TEST_EMAIL_PREFIXES.map((p) => ({ email: { startsWith: p } })) } },
});
if (byTestUser.count) console.log(`    test-user submissions ${byTestUser.count}`);

// ---------------------------------------------------------------------------
//  2. Test items — and the lots/movements that reference them.
// ---------------------------------------------------------------------------
const testItems = await prisma.item.findMany({ where: nameMatches, select: { id: true } });
const itemIds = testItems.map((item) => item.id);

if (itemIds.length) {
  // Movements reference lots, so movements go first.
  const moves = await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
  const lots = await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
  const items = await prisma.item.deleteMany({ where: { id: { in: itemIds } } });

  console.log(`    stock movements       ${moves.count}`);
  console.log(`    stock lots            ${lots.count}`);
  console.log(`    items                 ${items.count}`);
}

// ---------------------------------------------------------------------------
//  3. Teams and vehicles — now that nothing points at them.
// ---------------------------------------------------------------------------
if (teamIds.length) {
  await prisma.teamMembership.deleteMany({ where: { teamId: { in: teamIds } } });
  const teams = await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  console.log(`    teams                 ${teams.count}`);
}

if (vehicleIds.length) {
  const vehicles = await prisma.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
  console.log(`    vehicles              ${vehicles.count}`);
}

// ---------------------------------------------------------------------------
//  4. Test roles and form templates.
// ---------------------------------------------------------------------------
const roles = await prisma.role.deleteMany({
  where: { key: { startsWith: 'scenario_' }, users: { none: {} } },
});
if (roles.count) console.log(`    roles                 ${roles.count}`);

const templates = await prisma.formTemplate.findMany({
  where: { key: { startsWith: 'scenario_' }, submissions: { none: {} } },
  select: { id: true },
});
if (templates.length) {
  await prisma.formTemplate.deleteMany({ where: { id: { in: templates.map((x) => x.id) } } });
  console.log(`    form templates        ${templates.length}`);
}

// ---------------------------------------------------------------------------
//  5. Test ACCOUNTS — deleted where possible, suspended where the ledger
//     still names them (the schema refuses, and rightly so).
// ---------------------------------------------------------------------------
const testUsers = await prisma.user.findMany({
  where: { OR: TEST_EMAIL_PREFIXES.map((prefix) => ({ email: { startsWith: prefix } })) },
  select: {
    id: true,
    email: true,
    _count: { select: { stockMovements: true, submissions: true, invitationsSent: true } },
  },
});

let deleted = 0;
let suspended = 0;

for (const user of testUsers) {
  const referenced =
    user._count.stockMovements + user._count.submissions + user._count.invitationsSent;

  if (referenced === 0) {
    await prisma.teamMembership.deleteMany({ where: { userId: user.id } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    deleted += 1;
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { status: 'SUSPENDED', isSuperAdmin: false, passwordHash: null },
    });
    suspended += 1;
  }
}

console.log(`    accounts deleted      ${deleted}`);
console.log(`    accounts suspended    ${suspended}   (still named in the ledger)`);

// Pending invitations from the suites.
const invites = await prisma.invitation.deleteMany({
  where: { OR: TEST_EMAIL_PREFIXES.map((prefix) => ({ email: { startsWith: prefix } })) },
});
if (invites.count) console.log(`    invitations           ${invites.count}`);

// ---------------------------------------------------------------------------
console.log('\n  Remaining teams:');
const remaining = await prisma.team.findMany({
  orderBy: { dayOfWeek: 'asc' },
  select: { nameEn: true, nameAr: true, dayOfWeek: true, isActive: true },
});
for (const team of remaining) {
  console.log(
    `    ${String(team.dayOfWeek ?? '-').padEnd(3)} ${team.nameEn.padEnd(16)} ${team.nameAr}` +
      `${team.isActive ? '' : '  (inactive)'}`,
  );
}

console.log('');
await prisma.$disconnect();
