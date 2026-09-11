/**
 * Proves per-vehicle rule exceptions actually change the verdict, and that the
 * fleet panel reports what it should.
 *
 *   node scripts/check-vehicle-rules.js <superAdminEmail> <password>
 *
 * Cleans up after itself.
 */

import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:4000/api';
const prisma = new PrismaClient();

const [adminEmail, adminPassword] = process.argv.slice(2);
if (!adminEmail || !adminPassword) {
  console.error('\n  Usage: node scripts/check-vehicle-rules.js <email> <password>\n');
  process.exit(1);
}

const G = '\x1b[32m';
const R = '\x1b[31m';
const D = '\x1b[2m';
const X = '\x1b[0m';
const ok = (c) => (c ? `${G}OK${X}` : `${R}FAIL${X}`);

const session = { token: null, cookie: null };

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) session.cookie = sc.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Per-vehicle rule exceptions');
console.log('══════════════════════════════════════════════════════════\n');

const login = await call('/auth/login', {
  method: 'POST',
  body: { email: adminEmail, password: adminPassword },
});
if (login.status !== 200) {
  console.error('  login failed:', JSON.stringify(login.body?.error));
  process.exit(1);
}
session.token = login.body.data.accessToken;

const teams = (await call('/teams?limit=50')).body.data;
const vehicles = (await call('/vehicles?limit=50')).body.data;
const team = teams[0];
const vehicle = vehicles.find((v) => v.kind === 'AMBULANCE');
const template = (await call('/forms/active?scope=AMBULANCE')).body.data;

console.log(`  Vehicle ${vehicle.code}, team "${team.nameEn}"\n`);

/** Fills every required question adequately, then applies the given shortages. */
function buildAnswers(shortages = {}) {
  const answers = {};
  for (const section of template.sections) {
    for (const field of section.fields) {
      if (!field.isRequired) continue;
      if (field.type === 'GRID') {
        answers[field.key] = Object.fromEntries((field.config.rows ?? []).map((r) => [r.key, 5]));
      } else if (field.type === 'SINGLE_SELECT') {
        const safe = (field.config.options ?? []).find((o) => o.severity === 'OK');
        answers[field.key] = safe?.value ?? field.config.options?.[0]?.value;
      } else if (['NUMBER', 'NUMBER_CHOICE'].includes(field.type)) {
        answers[field.key] = 5;
      } else if (field.type === 'BOOLEAN') {
        answers[field.key] = true;
      } else {
        answers[field.key] = 'ok';
      }
    }
  }
  return { ...answers, ...shortages };
}

const today = new Date().toISOString().slice(0, 10);

/** Files a report and returns its issues. Replaces any existing one for the day. */
async function fileReport(shortages) {
  await prisma.formSubmission.deleteMany({
    where: { vehicleId: vehicle.id, shiftDate: new Date(`${today}T00:00:00Z`) },
  });

  const res = await call('/submissions', {
    method: 'POST',
    body: {
      templateId: template.id,
      vehicleId: vehicle.id,
      teamId: team.id,
      shiftDate: today,
      answers: buildAnswers(shortages),
      status: 'SUBMITTED',
    },
  });

  if (res.status !== 201) {
    console.error('   report failed:', JSON.stringify(res.body?.error).slice(0, 300));
    return null;
  }

  return res.body.data.summary.issues ?? [];
}

// --- 1. Baseline: no exception, the shortage IS flagged -----------------------
let issues = await fileReport({ ob_kit: 0 });
const flaggedBefore = issues?.some((i) => i.field === 'ob_kit');

console.log(`  1. Vehicle reports 0 OB-Kits (form requires 1)`);
console.log(`     flagged as a shortage             ${ok(flaggedBefore)}`);

// --- 2. Add an exception: this vehicle does not carry an OB-Kit ---------------
const rule = await call(`/vehicles/${vehicle.id}/rules`, {
  method: 'PUT',
  body: {
    fieldKey: 'ob_kit',
    isExcluded: true,
    note: 'Rule check: this vehicle does not carry an OB-Kit',
  },
});

console.log(`\n  2. Add exception "not carried on this vehicle" ${ok(rule.status === 200)} (${rule.status})`);
if (rule.status !== 200) console.error('     ', JSON.stringify(rule.body?.error).slice(0, 300));

// --- 3. Same report, same answer — now NOT flagged ---------------------------
issues = await fileReport({ ob_kit: 0 });
const flaggedAfter = issues?.some((i) => i.field === 'ob_kit');

console.log(`\n  3. Same answer, with the exception in place`);
console.log(`     no longer flagged                 ${ok(!flaggedAfter)}`);
console.log(`     ${D}other shortages still reported: ${issues?.length ?? 0}${X}`);

// --- 4. A different KIND of exception: needs fewer -----------------------------
const fewer = await call(`/vehicles/${vehicle.id}/rules`, {
  method: 'PUT',
  body: {
    fieldKey: 'tourniquet',
    expected: 1,
    note: 'Rule check: this vehicle only needs one tourniquet',
  },
});
console.log(`\n  4. Exception "needs 1 instead of 2"    ${ok(fewer.status === 200)} (${fewer.status})`);

issues = await fileReport({ tourniquet: 1 });
const tqFlagged = issues?.some((i) => i.field === 'tourniquet');
console.log(`     1 tourniquet now passes           ${ok(!tqFlagged)}`);

issues = await fileReport({ tourniquet: 0 });
const tqZero = issues?.find((i) => i.field === 'tourniquet');
console.log(`     0 still flagged, expected shows 1 ${ok(tqZero && tqZero.expected === 1)}`);
if (tqZero) console.log(`     ${D}"${tqZero.label}": ${tqZero.value} of ${tqZero.expected} [${tqZero.severity}]${X}`);

// --- 5. An exception with no reason is refused ---------------------------------
const noReason = await call(`/vehicles/${vehicle.id}/rules`, {
  method: 'PUT',
  body: { fieldKey: 'scissor', isExcluded: true, note: '' },
});
console.log(`\n  5. Exception with no reason is refused ${ok(noReason.status === 422)} (${noReason.status})`);

// --- 6. Fleet status ------------------------------------------------------------
const fleet = await call('/dashboard/fleet');
console.log(`\n  6. Fleet status endpoint              ${ok(fleet.status === 200)} (${fleet.status})`);

if (fleet.status === 200) {
  const { rows, totals } = fleet.body.data;
  console.log(`     ${totals.vehicles} vehicles · ${totals.checkedToday} checked today · ${totals.notChecked} not checked`);

  for (const row of rows.slice(0, 8)) {
    const exc = row.ruleExceptions > 0 ? `  ${D}(${row.ruleExceptions} exceptions)${X}` : '';
    console.log(`       ${row.vehicle.code.padEnd(5)} ${row.status.padEnd(12)}${exc}`);
  }
}

// --- Cleanup ---------------------------------------------------------------------
await prisma.vehicleRuleOverride.deleteMany({ where: { note: { startsWith: 'Rule check:' } } });
await prisma.formSubmission.deleteMany({
  where: { vehicleId: vehicle.id, shiftDate: new Date(`${today}T00:00:00Z`) },
});

console.log('\n  Cleaned up.\n');
await prisma.$disconnect();
