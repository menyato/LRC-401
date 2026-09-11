/**
 * Proves what an EMT / first responder can and cannot see.
 *
 *   node scripts/check-responder-view.js <superAdminEmail> <password>
 *
 * Builds a real team, vehicle, EMT and shift through the API, then signs in as
 * the EMT and reports exactly what their dashboard and pickers return.
 * Everything it creates is prefixed RESPCHK- and retired at the end.
 */

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

const [adminEmail, adminPassword] = process.argv.slice(2);
if (!adminEmail || !adminPassword) {
  console.error('\n  Usage: node scripts/check-responder-view.js <email> <password>\n');
  process.exit(1);
}

const RUN = Date.now().toString(36);
const EMT_EMAIL = `respchk-${RUN}-emt@lrc401.local`;
const EMT_PASSWORD = 'RespCheck2026x';

function session() {
  return { accessToken: null, cookie: null };
}

async function call(s, path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(s?.accessToken ? { Authorization: `Bearer ${s.accessToken}` } : {}),
      ...(s?.cookie ? { Cookie: s.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc && s) s.cookie = sc.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function login(s, email, password) {
  const { status, body } = await call(s, '/auth/login', { method: 'POST', body: { email, password } });
  if (status !== 200) throw new Error(`login ${email} failed (${status}): ${JSON.stringify(body?.error)}`);
  s.accessToken = body.data.accessToken;
}

const tick = (ok) => (ok ? '\x1b[32mYES\x1b[0m' : '\x1b[31mNO \x1b[0m');

const admin = session();
const emt = session();

console.log('\n  Setting up a real EMT and shift...\n');

await login(admin, adminEmail, adminPassword);

// --- Role: exactly the built-in field responder -------------------------------
const roles = (await call(admin, '/roles')).body.data;
const responderRole = roles.find((r) => r.key === 'field_responder');
if (!responderRole) throw new Error('the built-in field_responder role is missing — re-run db:seed');

// --- Team + vehicle -----------------------------------------------------------
const team = (await call(admin, '/teams', {
  method: 'POST',
  body: { key: `respchk_${RUN}`, nameEn: 'RESPCHK Team', nameAr: 'فرقة', dayOfWeek: 1 },
})).body.data;

const vehicle = (await call(admin, '/vehicles', {
  method: 'POST',
  body: { code: `R${String(Date.now()).slice(-4)}`, nameEn: 'RESPCHK Ambulance', nameAr: 'سيارة', kind: 'AMBULANCE' },
})).body.data;

// A second vehicle the EMT is NOT on — the one they must not be able to file for.
const otherVehicle = (await call(admin, '/vehicles', {
  method: 'POST',
  body: { code: `X${String(Date.now()).slice(-4)}`, nameEn: 'RESPCHK Other', nameAr: 'أخرى', kind: 'AMBULANCE' },
})).body.data;

// --- Invite + accept, exactly as a real volunteer joins -----------------------
const invitation = (await call(admin, '/users/invitations', {
  method: 'POST',
  body: {
    email: EMT_EMAIL,
    fullName: 'RESPCHK Responder',
    roleId: responderRole.id,
    teamIds: [team.id],
    extraPermissions: [],
  },
})).body.data;

await call(null, '/auth/accept-invitation', {
  method: 'POST',
  body: { token: invitation.devInviteToken, password: EMT_PASSWORD, fullName: 'RESPCHK Responder', locale: 'en' },
});

const emtUser = await prisma.user.findUnique({ where: { email: EMT_EMAIL }, select: { id: true } });

// --- Roster them on ONE vehicle today ----------------------------------------
const today = new Date().toISOString().slice(0, 10);

await call(admin, '/assignments', {
  method: 'POST',
  body: { teamId: team.id, vehicleId: vehicle.id, shiftDate: today, firstPersonId: emtUser.id },
});

await login(emt, EMT_EMAIL, EMT_PASSWORD);

// =============================================================================
console.log('  ─────────────────────────────────────────────────────────');
console.log('   WHAT THE EMT SEES');
console.log('  ─────────────────────────────────────────────────────────\n');

const dash = (await call(emt, '/dashboard/overview?days=7')).body.data;

console.log(`   Their own shift (vehicle + what is missing)   ${tick(Boolean(dash.myShift))}`);
console.log(`   Station report COUNTS                         ${tick(Boolean(dash.reports))}   <- must be NO`);
console.log(`   "Most frequent shortages" ranking             ${tick(Boolean(dash.topShortages))}   <- must be NO`);
console.log(`   Inventory totals                              ${tick(Boolean(dash.inventory))}   <- must be NO`);
console.log(`   User / invitation counts                      ${tick(Boolean(dash.people))}   <- must be NO`);

const trend = await call(emt, '/dashboard/report-trend?days=30');
console.log(`   Statistics trend endpoint                     ${tick(trend.status === 200)}   <- must be NO (${trend.status})`);

if (dash.myShift?.assignments?.length) {
  const a = dash.myShift.assignments[0];
  console.log(`\n   Rostered on: ${a.vehicle.code} (${a.vehicle.nameEn}) on ${a.shiftDate.slice(0, 10)}`);
  console.log(`   Report filed yet: ${a.report ? a.report.status : 'not yet'}`);
}

console.log('\n  ─────────────────────────────────────────────────────────');
console.log('   WHICH VEHICLES THEY CAN FILE FOR');
console.log('  ─────────────────────────────────────────────────────────\n');

const mine = (await call(emt, `/assignments/mine?dateFrom=${today}&dateTo=${today}`)).body.data;
console.log(`   Assignments returned to the form: ${mine.length}`);
for (const a of mine) console.log(`     - ${a.vehicle.code}  ${a.vehicle.nameEn}  ${a.shiftDate.slice(0, 10)}`);

const template = (await call(emt, '/forms/active?scope=AMBULANCE')).body.data;

const onTheirs = await call(emt, '/submissions', {
  method: 'POST',
  body: {
    templateId: template.id,
    vehicleId: vehicle.id,
    teamId: team.id,
    shiftDate: today,
    answers: { airways: { red: 0, blue_orange: 1, yellow: 1, green: 1, white: 1 } },
    status: 'DRAFT',
  },
});
console.log(`\n   File for THEIR vehicle      ${tick(onTheirs.status === 201)}   (${onTheirs.status})`);

const onOthers = await call(emt, '/submissions', {
  method: 'POST',
  body: {
    templateId: template.id,
    vehicleId: otherVehicle.id,
    teamId: team.id,
    shiftDate: today,
    answers: {},
    status: 'DRAFT',
  },
});
console.log(`   File for ANOTHER vehicle    ${tick(onOthers.status !== 201)}   <- must be blocked (${onOthers.status} ${onOthers.body?.error?.code ?? ''})`);

// --- Can they see the shortages on their own report? --------------------------
const after = (await call(emt, '/dashboard/overview?days=7')).body.data;
const issues = after.myShift?.assignments?.[0]?.report?.issues ?? [];

console.log(`\n   Sees the shortages on their own report        ${tick(issues.length > 0)}`);
for (const issue of issues.slice(0, 3)) {
  console.log(`     - ${issue.label}: ${issue.value} of ${issue.expected}  [${issue.severity}]`);
}

// --- Cleanup ------------------------------------------------------------------
await prisma.user.updateMany({
  where: { email: { startsWith: 'respchk-' } },
  data: { status: 'SUSPENDED', passwordHash: null },
});
await prisma.vehicle.updateMany({ where: { nameEn: { startsWith: 'RESPCHK' } }, data: { isActive: false } });
await prisma.team.updateMany({ where: { nameEn: { startsWith: 'RESPCHK' } }, data: { isActive: false } });

console.log('\n  Cleaned up.\n');
await prisma.$disconnect();
