/**
 * =============================================================================
 *  Full workflow & security scenario suite
 * =============================================================================
 *  Where `smoke-test.js` proves each endpoint works, THIS proves the system
 *  behaves correctly when several different people use it at once — which is
 *  where an access-control system actually succeeds or fails.
 *
 *  It creates real users with real, limited roles and then tries to make them
 *  see and do things they must not. The single most important assertion in the
 *  whole project is in scenario 4:
 *
 *      Team Admin A must NOT be able to read Team B's equipment reports,
 *      even when asking for them by id.
 *
 *  Run against a running server:
 *
 *      npm start                (terminal 1)
 *      npm run test:scenarios   (terminal 2)
 *
 *  Everything it creates is prefixed SCENARIO- and is retired at the end.
 *  It refuses to run against NODE_ENV=production.
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';

const BASE = process.env.SCENARIO_BASE_URL ?? 'http://localhost:4000/api';
const prisma = new PrismaClient();

/** Matches the server so generated codes verify first time. */
authenticator.options = { window: 1 };

// -----------------------------------------------------------------------------
//  Harness
// -----------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ${GREEN}PASS${RESET}  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.message });
    console.log(`  ${RED}FAIL${RESET}  ${name}`);
    console.log(`        ${DIM}${error.message}${RESET}`);
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, label) => {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};

/**
 * A named session. Each actor keeps its own token and cookie, so the script can
 * hold several people signed in simultaneously — which is the whole point.
 */
function createSession(label) {
  return { label, accessToken: null, cookie: null };
}

async function call(session, path, { method = 'GET', body, useCookie = true } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      ...(useCookie && session?.cookie ? { Cookie: session.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie && session) session.cookie = setCookie.split(';')[0];

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { status: response.status, body: json };
}

/** Signs a session in, handling the 2FA step when the account requires it. */
async function signIn(session, email, password, totpSecret = null) {
  const { status, body } = await call(session, '/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  if (status !== 200) {
    throw new Error(`login for ${email} failed (${status}): ${JSON.stringify(body?.error)}`);
  }

  if (body.data.requiresTwoFactor) {
    if (!totpSecret) throw new Error(`${email} needs 2FA but no secret was supplied`);

    const verified = await call(session, '/auth/verify-2fa', {
      method: 'POST',
      body: {
        mfaToken: body.data.mfaToken,
        code: authenticator.generate(totpSecret),
        isBackupCode: false,
      },
    });

    if (verified.status !== 200) {
      throw new Error(`2FA for ${email} failed: ${JSON.stringify(verified.body?.error)}`);
    }

    session.accessToken = verified.body.data.accessToken;
    return;
  }

  session.accessToken = body.data.accessToken;
}

// -----------------------------------------------------------------------------
//  Fixtures
// -----------------------------------------------------------------------------

const PREFIX = 'scenario';
const PASSWORD = 'Scenario!2026x';

/**
 * A per-run identifier baked into every email this suite creates.
 *
 * WHY: the teardown SUSPENDS its accounts rather than deleting them, because a
 * user who has filed a report or recorded stock cannot be deleted (the schema
 * refuses — see smoke-test.js). A suspended account still occupies its email
 * address, so a second run got 409 EMAIL_IN_USE on the very first invitation
 * and every later assertion collapsed behind it.
 *
 * Giving each run its own addresses makes the suite genuinely repeatable
 * without weakening the "never delete a user" rule that the failure exposed.
 */
const RUN = Date.now().toString(36);

const userEmail = (suffix) => `${PREFIX}-${RUN}-${suffix}@lrc401.local`;

// The driver is stable across runs: seedDriver() upserts it, so it never
// collides, and this avoids accumulating one super admin per run.
const ADMIN = { email: `${PREFIX}-admin@lrc401.local`, name: 'SCENARIO Super Admin' };

/**
 * Creates the driving super admin directly in the database.
 * Everything else in this file is created THROUGH THE API, as a real admin
 * would — otherwise the test would be proving the database works rather than
 * proving the application does.
 */
async function seedDriver() {
  await prisma.user.upsert({
    where: { email: ADMIN.email },
    create: {
      email: ADMIN.email,
      fullName: ADMIN.name,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      status: 'ACTIVE',
      isSuperAdmin: true,
      mustChangePassword: false,
    },
    update: {
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      status: 'ACTIVE',
      isSuperAdmin: true,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      twoFactorEnabled: false,
      twoFactorSecret: null,
      backupCodes: [],
    },
  });
}

/**
 * Retires every account this run created.
 * Suspends rather than deletes — users who have recorded stock or sent
 * invitations cannot be deleted, by design (see the note in smoke-test.js).
 */
async function retireScenarioUsers() {
  await prisma.user.updateMany({
    where: { email: { startsWith: PREFIX } },
    data: { status: 'SUSPENDED', isSuperAdmin: false, passwordHash: null, twoFactorEnabled: false },
  });
}

/**
 * Deactivates the teams and vehicles this suite created.
 *
 * Necessary because they are referenced by the reports it filed, so they cannot
 * be deleted — the same "history must keep its references" rule that applies to
 * users. Left active, they accumulated one extra ambulance per run and broke an
 * unrelated assertion in the smoke suite about the size of the fleet.
 *
 * Deactivating is exactly what the application itself does, so this also keeps
 * them out of every picker and day board.
 */
async function retireScenarioOrgData() {
  await prisma.vehicle.updateMany({
    where: { nameEn: { startsWith: 'SCENARIO' } },
    data: { isActive: false },
  });

  await prisma.team.updateMany({
    where: { nameEn: { startsWith: 'SCENARIO' } },
    data: { isActive: false },
  });
}

// =============================================================================
//  The run
// =============================================================================

const admin = createSession('super admin');
const teamAdminA = createSession('team admin A');
const teamAdminB = createSession('team admin B');
const responder = createSession('EMT');

/** Ids created along the way, shared between scenarios. */
const ctx = {};

async function run() {
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  LRC-401 — workflow & security scenarios${RESET}`);
  console.log(`  ${BASE}`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}`);

  if (process.env.NODE_ENV === 'production') {
    console.error('\n  Refusing to run against NODE_ENV=production.\n');
    process.exit(1);
  }

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 1 — Station setup by the super admin${RESET}`);
  // ===========================================================================

  await check('driver super admin exists and signs in', async () => {
    await seedDriver();
    await signIn(admin, ADMIN.email, PASSWORD);
    assert(admin.accessToken, 'no access token');
  });

  await check('create two teams', async () => {
    for (const key of ['a', 'b']) {
      const { status, body } = await call(admin, '/teams', {
        method: 'POST',
        body: {
          key: `${PREFIX}_team_${key}_${Date.now()}`,
          nameEn: `SCENARIO Team ${key.toUpperCase()}`,
          nameAr: `فرقة ${key.toUpperCase()}`,
          dayOfWeek: key === 'a' ? 1 : 2,
        },
      });
      assertEqual(status, 201, `team ${key} status`);
      ctx[`team${key.toUpperCase()}`] = body.data.id;
    }
  });

  await check('create a vehicle', async () => {
    const { status, body } = await call(admin, '/vehicles', {
      method: 'POST',
      body: {
        code: `S${String(Date.now()).slice(-4)}`,
        nameEn: 'SCENARIO Ambulance',
        nameAr: 'سيارة سيناريو',
        kind: 'AMBULANCE',
      },
    });
    assertEqual(status, 201, 'status');
    ctx.vehicle = body.data.id;
  });

  await check('create a restricted role (report filling only)', async () => {
    const { status, body } = await call(admin, '/roles', {
      method: 'POST',
      body: {
        key: `${PREFIX}_responder_${Date.now()}`,
        nameEn: 'SCENARIO Responder',
        nameAr: 'مستجيب سيناريو',
        permissions: [
          'dashboard:view',
          'submission:create',
          'submission:read.own',
          'team:read',
          'vehicle:read',
          'form.template:read',
          'assignment:read.team',
        ],
      },
    });
    assertEqual(status, 201, 'status');
    ctx.responderRole = body.data.id;
  });

  await check('create a team-admin role (team-scoped reads)', async () => {
    const { status, body } = await call(admin, '/roles', {
      method: 'POST',
      body: {
        key: `${PREFIX}_teamadmin_${Date.now()}`,
        nameEn: 'SCENARIO Team Admin',
        nameAr: 'مسؤول فرقة سيناريو',
        permissions: [
          'dashboard:view',
          'submission:create',
          'submission:read.own',
          'submission:read.team',
          'submission:review',
          'team:read',
          'vehicle:read',
          'form.template:read',
          'assignment:read.team',
          'assignment:manage',
        ],
      },
    });
    assertEqual(status, 201, 'status');
    ctx.teamAdminRole = body.data.id;
  });

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 2 — Invitation lifecycle (the real onboarding path)${RESET}`);
  // ===========================================================================

  /** Invites someone, accepts the invitation, and returns their session. */
  async function inviteAndAccept({ email, fullName, roleId, teamIds }) {
    const invited = await call(admin, '/users/invitations', {
      method: 'POST',
      body: { email, fullName, roleId, teamIds, extraPermissions: [] },
    });

    if (invited.status !== 201) {
      throw new Error(`invite failed (${invited.status}): ${JSON.stringify(invited.body?.error)}`);
    }

    const token = invited.body.data.devInviteToken;
    assert(token, 'no dev invite token — is NODE_ENV=development?');

    // Anonymous read, exactly as the invitation page does before anyone types.
    const preview = await call(null, `/auth/invitation?token=${encodeURIComponent(token)}`);
    assertEqual(preview.status, 200, 'invitation preview status');
    assertEqual(preview.body.data.email, email, 'previewed email');

    const accepted = await call(null, '/auth/accept-invitation', {
      method: 'POST',
      body: { token, password: PASSWORD, fullName, locale: 'en' },
    });

    if (accepted.status !== 201) {
      throw new Error(`accept failed (${accepted.status}): ${JSON.stringify(accepted.body?.error)}`);
    }

    return { token, userId: accepted.body.data.user.id };
  }

  await check('invite + accept: team admin A', async () => {
    const result = await inviteAndAccept({
      email: userEmail('admin-a'),
      fullName: 'SCENARIO Team Admin A',
      roleId: ctx.teamAdminRole,
      teamIds: [ctx.teamA],
    });
    ctx.userA = result.userId;
  });

  await check('invite + accept: team admin B', async () => {
    const result = await inviteAndAccept({
      email: userEmail('admin-b'),
      fullName: 'SCENARIO Team Admin B',
      roleId: ctx.teamAdminRole,
      teamIds: [ctx.teamB],
    });
    ctx.userB = result.userId;
  });

  await check('invite + accept: a plain responder on team A', async () => {
    const result = await inviteAndAccept({
      email: userEmail('emt'),
      fullName: 'SCENARIO Responder',
      roleId: ctx.responderRole,
      teamIds: [ctx.teamA],
    });
    ctx.userEmt = result.userId;
  });

  await check('an accepted invitation cannot be reused', async () => {
    const invited = await call(admin, '/users/invitations', {
      method: 'POST',
      body: {
        email: userEmail('reuse'),
        fullName: 'SCENARIO Reuse',
        roleId: ctx.responderRole,
        teamIds: [],
        extraPermissions: [],
      },
    });

    const token = invited.body.data.devInviteToken;

    const first = await call(null, '/auth/accept-invitation', {
      method: 'POST',
      body: { token, password: PASSWORD, fullName: 'SCENARIO Reuse', locale: 'en' },
    });
    assertEqual(first.status, 201, 'first acceptance');

    const second = await call(null, '/auth/accept-invitation', {
      method: 'POST',
      body: { token, password: 'Different!2026x', fullName: 'Attacker', locale: 'en' },
    });
    assertEqual(second.status, 409, 'replayed acceptance must be rejected');
    assertEqual(second.body.error.code, 'INVITE_USED', 'error code');
  });

  await check('promote A and B to TEAM_ADMIN of their own teams', async () => {
    for (const [userId, teamId] of [
      [ctx.userA, ctx.teamA],
      [ctx.userB, ctx.teamB],
    ]) {
      const { status } = await call(admin, `/teams/${teamId}/members/${userId}`, {
        method: 'PUT',
        body: { teamRole: 'TEAM_ADMIN' },
      });
      assertEqual(status, 200, 'membership status');
    }
  });

  await check('all three new users can sign in', async () => {
    await signIn(teamAdminA, userEmail('admin-a'), PASSWORD);
    await signIn(teamAdminB, userEmail('admin-b'), PASSWORD);
    await signIn(responder, userEmail('emt'), PASSWORD);
    assert(teamAdminA.accessToken && teamAdminB.accessToken && responder.accessToken, 'missing token');
  });

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 3 — Role-based access control${RESET}`);
  // ===========================================================================

  await check('the responder cannot list users', async () => {
    const { status, body } = await call(responder, '/users');
    assertEqual(status, 403, 'status');
    assertEqual(body.error.code, 'MISSING_PERMISSION', 'error code');
  });

  await check('the responder cannot read the audit log', async () => {
    assertEqual((await call(responder, '/audit')).status, 403, 'status');
  });

  await check('the responder cannot create inventory items', async () => {
    const { status } = await call(responder, '/inventory/items', {
      method: 'POST',
      body: { categoryId: 'x', nameEn: 'nope' },
    });
    assertEqual(status, 403, 'status');
  });

  await check('the responder cannot manage roles', async () => {
    const { status } = await call(responder, '/roles', {
      method: 'POST',
      body: { key: 'nope', nameEn: 'Nope', nameAr: 'Nope', permissions: [] },
    });
    assertEqual(status, 403, 'status');
  });

  await check('the responder CAN reach what their role allows', async () => {
    assertEqual((await call(responder, '/teams')).status, 200, 'teams');
    assertEqual((await call(responder, '/vehicles')).status, 200, 'vehicles');
    assertEqual((await call(responder, '/dashboard/overview?days=7')).status, 200, 'dashboard');
  });

  await check('/auth/me reports exactly the granted permissions', async () => {
    const { body } = await call(responder, '/auth/me');
    const permissions = body.data.permissions;

    assert(permissions.includes('submission:create'), 'missing a granted permission');
    assert(!permissions.includes('user:read'), 'holds a permission it was never granted');
    assert(!permissions.includes('submission:read.all'), 'holds station-wide read');
  });

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 4 — Data scoping (the critical security property)${RESET}`);
  // ===========================================================================

  const template = (await call(admin, '/forms/active?scope=AMBULANCE')).body.data;
  const today = new Date().toISOString().slice(0, 10);

  await check('each team admin files a report for their OWN team', async () => {
    for (const [session, teamId, key] of [
      [teamAdminA, ctx.teamA, 'A'],
      [teamAdminB, ctx.teamB, 'B'],
    ]) {
      // Distinct dates so the unique (vehicle, date, template) constraint is
      // satisfied while both reports share one vehicle.
      const shiftDate = key === 'A' ? today : new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      const { status, body } = await call(session, '/submissions', {
        method: 'POST',
        body: {
          templateId: template.id,
          vehicleId: ctx.vehicle,
          teamId,
          shiftDate,
          answers: { airways: { red: 0, blue_orange: 1, yellow: 1, green: 1, white: 1 } },
          status: 'DRAFT',
        },
      });

      assertEqual(status, 201, `report ${key} status`);
      ctx[`report${key}`] = body.data.id;
    }
  });

  await check('team admin A sees their OWN report in the list', async () => {
    const { body } = await call(teamAdminA, '/submissions?limit=100');
    const ids = body.data.map((row) => row.id);
    assert(ids.includes(ctx.reportA), "A cannot see A's own report");
  });

  await check(`${BOLD}A CANNOT see B's report in the list${RESET}`, async () => {
    const { body } = await call(teamAdminA, '/submissions?limit=100');
    const ids = body.data.map((row) => row.id);
    assert(!ids.includes(ctx.reportB), "SCOPE LEAK: A can see B's report in the list");
  });

  await check(`${BOLD}A CANNOT fetch B's report by id — and gets 404, not 403${RESET}`, async () => {
    const { status } = await call(teamAdminA, `/submissions/${ctx.reportB}`);
    // 404 rather than 403 on purpose: a 403 would CONFIRM the record exists,
    // which itself tells A something about team B's operations.
    assertEqual(status, 404, 'status');
  });

  await check('B likewise cannot reach A\'s report', async () => {
    const { status } = await call(teamAdminB, `/submissions/${ctx.reportA}`);
    assertEqual(status, 404, 'status');
  });

  await check('filtering by another team does not widen the scope', async () => {
    // A explicitly asks for team B's rows. The scope is spread into the WHERE
    // clause FIRST, so a caller-supplied filter can only narrow it.
    const { body } = await call(teamAdminA, `/submissions?teamId=${ctx.teamB}&limit=100`);
    assertEqual(body.data.length, 0, 'a team filter widened the scope');
  });

  await check('the plain responder sees only reports they submitted', async () => {
    const { body } = await call(responder, '/submissions?limit=100');
    const ids = body.data.map((row) => row.id);

    assert(!ids.includes(ctx.reportA), 'a read.own user can see a team-mate\'s report');
    assert(!ids.includes(ctx.reportB), 'a read.own user can see another team\'s report');
  });

  await check('the super admin sees both reports', async () => {
    // limit=100 is MAX_LIMIT. Asking for 200 is rejected with 422 by design —
    // an earlier version of this test did exactly that and failed, which is the
    // pagination clamp doing its job.
    const { body } = await call(admin, '/submissions?limit=100');
    const ids = body.data.map((row) => row.id);
    assert(ids.includes(ctx.reportA) && ids.includes(ctx.reportB), 'super admin cannot see all');
  });

  await check('the day board is scoped too', async () => {
    const { body } = await call(teamAdminA, `/submissions/board?teamId=${ctx.teamB}&date=${today}`);
    const submissions = body.data.rows.map((row) => row.submission).filter(Boolean);
    assert(
      !submissions.some((submission) => submission.id === ctx.reportB),
      "SCOPE LEAK: B's report appeared on A's board",
    );
  });

  await check('a responder cannot file for a vehicle they are not assigned to', async () => {
    const { status, body } = await call(responder, '/submissions', {
      method: 'POST',
      body: {
        templateId: template.id,
        vehicleId: ctx.vehicle,
        teamId: ctx.teamA,
        shiftDate: '2026-01-15',
        answers: {},
        status: 'DRAFT',
      },
    });
    assertEqual(status, 403, 'status');
    assertEqual(body.error.code, 'NOT_ASSIGNED', 'error code');
  });

  await check('...but CAN once the team admin rosters them', async () => {
    const assignment = await call(teamAdminA, '/assignments', {
      method: 'POST',
      body: {
        teamId: ctx.teamA,
        vehicleId: ctx.vehicle,
        shiftDate: '2026-01-15',
        firstPersonId: ctx.userEmt,
      },
    });
    assertEqual(assignment.status, 201, 'assignment status');

    const { status } = await call(responder, '/submissions', {
      method: 'POST',
      body: {
        templateId: template.id,
        vehicleId: ctx.vehicle,
        teamId: ctx.teamA,
        shiftDate: '2026-01-15',
        answers: { portable_stretcher: 1 },
        status: 'DRAFT',
      },
    });
    assertEqual(status, 201, 'submission status');
  });

  await check('a team admin can load the crew picker WITHOUT user:read', async () => {
    // Regression test for the bug that made the shift-assignment form unusable.
    //
    // The form used to populate its crew dropdowns from `GET /users?limit=200`,
    // which failed twice over: 200 exceeds the API's limit of 100 (422), and
    // `/users` needs `user:read`, which the Team Admin role does not have. Both
    // failures produced the same silent symptom — an empty dropdown, so nobody
    // could be rostered, so every EMT's report was refused with NOT_ASSIGNED.
    //
    // The form now reads the team's own members, which needs only `team:read`.

    // First: confirm the old call really is refused for this role.
    const viaUsers = await call(teamAdminA, '/users?limit=100&status=ACTIVE');
    assertEqual(viaUsers.status, 403, 'a team admin should not be able to list all users');

    // And that the limit the old code used is rejected outright.
    const overLimit = await call(admin, '/users?limit=200&status=ACTIVE');
    assertEqual(overLimit.status, 422, 'limit=200 should be rejected — MAX_LIMIT is 100');

    // Now: the picker's actual data source works for them.
    const { status, body } = await call(teamAdminA, `/teams/${ctx.teamA}/members`);
    assertEqual(status, 200, 'a team admin cannot read their own team members');

    const crew = body.data.map((membership) => membership.user);
    assert(crew.length > 0, 'the crew picker would be empty');
    assert(
      crew.some((user) => user.id === ctx.userEmt),
      'the EMT assigned to this team does not appear in the crew picker',
    );
    assert(
      crew.every((user) => user.fullName && user.status),
      'the picker needs fullName and status on every member',
    );
  });

  await check('a team admin cannot roster a team they do not lead', async () => {
    const { status, body } = await call(teamAdminA, '/assignments', {
      method: 'POST',
      body: {
        teamId: ctx.teamB,
        vehicleId: ctx.vehicle,
        shiftDate: '2026-01-20',
        firstPersonId: ctx.userEmt,
      },
    });
    assertEqual(status, 403, 'status');
    assertEqual(body.error.code, 'NOT_TEAM_ADMIN', 'error code');
  });

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 5 — Two-factor authentication, end to end${RESET}`);
  // ===========================================================================

  await check('enrol 2FA and confirm with a real TOTP code', async () => {
    const setup = await call(responder, '/auth/2fa/setup', { method: 'POST' });
    assertEqual(setup.status, 200, 'setup status');
    assert(setup.body.data.qrCodeDataUrl.startsWith('data:image/png'), 'no QR code returned');

    ctx.totpSecret = setup.body.data.secret;

    const confirmed = await call(responder, '/auth/2fa/confirm', {
      method: 'POST',
      body: { code: authenticator.generate(ctx.totpSecret) },
    });

    assertEqual(confirmed.status, 200, 'confirm status');
    assertEqual(confirmed.body.data.backupCodes.length, 8, 'backup code count');
    ctx.backupCodes = confirmed.body.data.backupCodes;
  });

  await check('the TOTP secret is ENCRYPTED at rest, not stored in clear', async () => {
    const stored = await prisma.user.findUnique({
      where: { id: ctx.userEmt },
      select: { twoFactorSecret: true, backupCodes: true },
    });

    assert(stored.twoFactorSecret, 'no secret stored');
    assert(
      !stored.twoFactorSecret.includes(ctx.totpSecret),
      'SECURITY: the TOTP secret is stored in plain text',
    );
    // iv:authTag:ciphertext
    assertEqual(stored.twoFactorSecret.split(':').length, 3, 'not the AES-GCM envelope');

    // Backup codes are bcrypt hashes, never the codes themselves.
    assert(
      !stored.backupCodes.some((hash) => ctx.backupCodes.includes(hash)),
      'SECURITY: backup codes are stored in plain text',
    );
    assert(stored.backupCodes.every((hash) => hash.startsWith('$2')), 'backup codes are not bcrypt hashes');
  });

  await check('login now requires the second factor', async () => {
    const fresh = createSession('emt-2fa');
    const { status, body } = await call(fresh, '/auth/login', {
      method: 'POST',
      body: { email: userEmail('emt'), password: PASSWORD },
    });

    assertEqual(status, 200, 'status');
    assertEqual(body.data.requiresTwoFactor, true, 'requiresTwoFactor');
    assert(body.data.mfaToken, 'no MFA token');
    assert(!body.data.accessToken, 'SECURITY: an access token was issued before 2FA');
    ctx.pendingMfaToken = body.data.mfaToken;
  });

  await check('a WRONG code is rejected', async () => {
    const fresh = createSession('emt-badcode');
    const { status } = await call(fresh, '/auth/verify-2fa', {
      method: 'POST',
      body: { mfaToken: ctx.pendingMfaToken, code: '000000', isBackupCode: false },
    });
    assertEqual(status, 401, 'status');
  });

  await check('the correct code completes the login', async () => {
    const fresh = createSession('emt-goodcode');
    const { status, body } = await call(fresh, '/auth/verify-2fa', {
      method: 'POST',
      body: {
        mfaToken: ctx.pendingMfaToken,
        code: authenticator.generate(ctx.totpSecret),
        isBackupCode: false,
      },
    });
    assertEqual(status, 200, 'status');
    assert(body.data.accessToken, 'no access token issued');
  });

  await check('a backup code works, and is single-use', async () => {
    const backupCode = ctx.backupCodes[0];

    const startLogin = async () => {
      const session = createSession('emt-backup');
      const { body } = await call(session, '/auth/login', {
        method: 'POST',
        body: { email: userEmail('emt'), password: PASSWORD },
      });
      return { session, mfaToken: body.data.mfaToken };
    };

    const first = await startLogin();
    const used = await call(first.session, '/auth/verify-2fa', {
      method: 'POST',
      body: { mfaToken: first.mfaToken, code: backupCode, isBackupCode: true },
    });
    assertEqual(used.status, 200, 'first use of the backup code');

    const second = await startLogin();
    const reused = await call(second.session, '/auth/verify-2fa', {
      method: 'POST',
      body: { mfaToken: second.mfaToken, code: backupCode, isBackupCode: true },
    });
    assertEqual(reused.status, 401, 'a backup code was accepted TWICE');

    const remaining = await prisma.user.findUnique({
      where: { id: ctx.userEmt },
      select: { backupCodes: true },
    });
    assertEqual(remaining.backupCodes.length, 7, 'the used code was not consumed');
  });

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 6 — Session handling${RESET}`);
  // ===========================================================================

  await check('refresh rotates the token and keeps the session alive', async () => {
    const before = teamAdminA.cookie;

    const { status, body } = await call(teamAdminA, '/auth/refresh', { method: 'POST' });
    assertEqual(status, 200, 'status');
    assert(body.data.accessToken, 'no new access token');
    assert(teamAdminA.cookie !== before, 'the refresh cookie was not rotated');

    teamAdminA.accessToken = body.data.accessToken;
    ctx.spentCookie = before;
  });

  await check('reusing a SPENT refresh token kills the whole family', async () => {
    // Replay the old cookie — either a thief, or the real user with a stale
    // copy. The server cannot tell, so it takes the safe branch.
    const attacker = createSession('attacker');
    attacker.cookie = ctx.spentCookie;

    const replay = await call(attacker, '/auth/refresh', { method: 'POST' });
    assertEqual(replay.status, 401, 'status');
    assertEqual(replay.body.error.code, 'REFRESH_REUSED', 'error code');

    // ...and the legitimate session is now dead too, which is the point.
    const victim = await call(teamAdminA, '/auth/refresh', { method: 'POST' });
    assertEqual(victim.status, 401, 'the token family was not revoked');
  });

  await check('team admin A signs back in after the revocation', async () => {
    await signIn(teamAdminA, userEmail('admin-a'), PASSWORD);
    assertEqual((await call(teamAdminA, '/auth/me')).status, 200, 'status');
  });

  await check('logout revokes the session', async () => {
    const temp = createSession('temp');
    await signIn(temp, userEmail('admin-b'), PASSWORD);

    const cookieBeforeLogout = temp.cookie;
    assertEqual((await call(temp, '/auth/logout', { method: 'POST' })).status, 204, 'logout status');

    const stale = createSession('stale');
    stale.cookie = cookieBeforeLogout;
    assertEqual((await call(stale, '/auth/refresh', { method: 'POST' })).status, 401, 'a revoked token still refreshed');
  });

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 7 — Updates take effect immediately${RESET}`);
  // ===========================================================================

  await check('removing a permission from a ROLE revokes it for its holders', async () => {
    // Take audit:read away by rewriting the role, then confirm the holder is
    // blocked — proving permissions are re-read per request rather than being
    // frozen into the access token.
    await call(admin, `/roles/${ctx.teamAdminRole}`, {
      method: 'PATCH',
      body: { permissions: ['dashboard:view', 'team:read', 'vehicle:read'] },
    });

    // The role change revoked their sessions, so sign in again.
    await signIn(teamAdminA, userEmail('admin-a'), PASSWORD);

    const { status } = await call(teamAdminA, '/submissions');
    assertEqual(status, 403, 'a removed permission still worked');
  });

  await check('restoring the permission restores access', async () => {
    await call(admin, `/roles/${ctx.teamAdminRole}`, {
      method: 'PATCH',
      body: {
        permissions: [
          'dashboard:view',
          'submission:create',
          'submission:read.own',
          'submission:read.team',
          'submission:review',
          'team:read',
          'vehicle:read',
          'form.template:read',
          'assignment:read.team',
          'assignment:manage',
        ],
      },
    });

    await signIn(teamAdminA, userEmail('admin-a'), PASSWORD);
    assertEqual((await call(teamAdminA, '/submissions')).status, 200, 'status');
  });

  await check('a per-user DENY overrides the role (deny always wins)', async () => {
    await call(admin, `/users/${ctx.userA}/access`, {
      method: 'PATCH',
      body: { deniedPermissions: ['submission:read.team'] },
    });

    await signIn(teamAdminA, userEmail('admin-a'), PASSWORD);

    const { body } = await call(teamAdminA, '/auth/me');
    assert(
      !body.data.permissions.includes('submission:read.team'),
      'a denied permission survived',
    );

    // They drop to read.own, so their own report is still visible...
    const list = await call(teamAdminA, '/submissions?limit=100');
    assertEqual(list.status, 200, 'list status');
  });

  await check('a per-user GRANT adds a permission the role lacks', async () => {
    await call(admin, `/users/${ctx.userA}/access`, {
      method: 'PATCH',
      body: { deniedPermissions: [], extraPermissions: ['audit:read'] },
    });

    await signIn(teamAdminA, userEmail('admin-a'), PASSWORD);
    assertEqual((await call(teamAdminA, '/audit?limit=5')).status, 200, 'granted permission did not work');
  });

  await check('changing a password kills the EXISTING access token at once', async () => {
    // Regression test for a real bug. Revoking the refresh token does not stop
    // an access token — it is a stateless JWT, valid until it expires. Before
    // the `sessionsRevokedAt` cut-off existed, a stolen access token kept
    // working for up to 15 minutes AFTER the victim changed their password.
    const victim = createSession('victim');
    await signIn(victim, userEmail('admin-b'), PASSWORD);

    // A thief copies the access token.
    const stolen = createSession('thief');
    stolen.accessToken = victim.accessToken;

    assertEqual((await call(stolen, '/auth/me')).status, 200, 'stolen token should work before the change');

    // The victim changes their password.
    const changed = await call(victim, '/auth/change-password', {
      method: 'POST',
      body: { currentPassword: PASSWORD, newPassword: 'Rotated!2026x' },
    });
    assertEqual(changed.status, 200, 'password change');

    // The stolen token must now be dead — not in 15 minutes, now.
    const after = await call(stolen, '/auth/me');
    assertEqual(after.status, 401, 'a stolen access token survived a password change');
    assertEqual(after.body.error.code, 'SESSION_REVOKED', 'error code');

    // Put the password back so later scenarios still work.
    const reSignedIn = createSession('victim-2');
    await signIn(reSignedIn, userEmail('admin-b'), 'Rotated!2026x');
    await call(reSignedIn, '/auth/change-password', {
      method: 'POST',
      body: { currentPassword: 'Rotated!2026x', newPassword: PASSWORD },
    });
  });

  await check('SUSPENDING a user takes effect immediately', async () => {
    await call(admin, `/users/${ctx.userA}/status`, {
      method: 'PATCH',
      body: { status: 'SUSPENDED' },
    });

    // The existing access token must stop working at once, not in 15 minutes.
    const { status, body } = await call(teamAdminA, '/auth/me');
    assertEqual(status, 403, 'a suspended user kept working');
    assertEqual(body.error.code, 'ACCOUNT_SUSPENDED', 'error code');
  });

  await check('a suspended user cannot sign in again', async () => {
    const blocked = createSession('suspended');
    const { status, body } = await call(blocked, '/auth/login', {
      method: 'POST',
      body: { email: userEmail('admin-a'), password: PASSWORD },
    });
    assertEqual(status, 403, 'status');
    assertEqual(body.error.code, 'ACCOUNT_SUSPENDED', 'error code');
  });

  await check('reactivating restores access', async () => {
    await call(admin, `/users/${ctx.userA}/status`, { method: 'PATCH', body: { status: 'ACTIVE' } });
    await signIn(teamAdminA, userEmail('admin-a'), PASSWORD);
    assertEqual((await call(teamAdminA, '/auth/me')).status, 200, 'status');
  });

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 8 — Form versioning protects history${RESET}`);
  // ===========================================================================

  await check('editing a PUBLISHED template forks it to a new draft version', async () => {
    const { status, body } = await call(admin, `/forms/templates/${template.id}`, {
      method: 'PUT',
      body: { titleEn: `${template.titleEn} (edited)` },
    });

    assertEqual(status, 200, 'status');
    assert(body.meta.forkedToNewVersion, 'a published template was edited in place');
    assertEqual(body.data.status, 'DRAFT', 'the fork is not a draft');
    // The new version is MAX(version) + 1 across the whole key family, NOT
    // publishedVersion + 1 — a previous run may already have created later
    // drafts. All that matters is that it is strictly newer.
    assert(
      body.data.version > template.version,
      `fork version ${body.data.version} is not newer than the published ${template.version}`,
    );

    ctx.forkedTemplate = body.data.id;
  });

  await check('the OLD version is still the one crews are served', async () => {
    const { body } = await call(admin, '/forms/active?scope=AMBULANCE');
    assertEqual(body.data.id, template.id, 'an unpublished draft was served to crews');
  });

  await check('existing reports still point at the version they were filled with', async () => {
    const { body } = await call(admin, `/submissions/${ctx.reportA}`);
    assertEqual(body.data.templateVersion, template.version, 'a report was re-pointed at a new version');
  });

  await check('an empty template cannot be published', async () => {
    const created = await call(admin, '/forms/templates', {
      method: 'POST',
      body: {
        key: `${PREFIX}_empty_${Date.now()}`,
        titleEn: 'SCENARIO Empty',
        titleAr: 'فارغ',
        scope: 'GENERIC',
        sections: [],
      },
    });

    const { status, body } = await call(admin, `/forms/templates/${created.body.data.id}/publish`, {
      method: 'POST',
    });
    assertEqual(status, 400, 'status');
    assertEqual(body.error.code, 'TEMPLATE_EMPTY', 'error code');
  });

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 9 — Database integrity${RESET}`);
  // ===========================================================================

  await check('every stock lot balance equals the sum of its movements', async () => {
    // The invariant the whole inventory engine rests on. Checked against the
    // real data, not a fixture.
    const lots = await prisma.stockLot.findMany({ select: { id: true, quantityOnHand: true } });

    const mismatches = [];

    for (const lot of lots) {
      const movements = await prisma.stockMovement.findMany({
        where: { lotId: lot.id },
        select: { direction: true, quantity: true },
      });

      const computed = movements.reduce((sum, movement) => {
        if (movement.direction === 'IN') return sum + movement.quantity;
        if (movement.direction === 'OUT') return sum - movement.quantity;
        return sum + movement.quantity; // ADJUST is signed
      }, 0);

      if (computed !== lot.quantityOnHand) {
        mismatches.push(`lot ${lot.id}: cached ${lot.quantityOnHand}, ledger ${computed}`);
      }
    }

    assert(
      mismatches.length === 0,
      `${mismatches.length} lot(s) disagree with the ledger:\n        ${mismatches.join('\n        ')}`,
    );

    console.log(`        ${DIM}checked ${lots.length} lots${RESET}`);
  });

  await check('no submission has a denormalised count that disagrees with its summary', async () => {
    const submissions = await prisma.formSubmission.findMany({
      select: { id: true, criticalCount: true, warnCount: true, summary: true },
    });

    const bad = submissions.filter((submission) => {
      const counts = submission.summary?.counts;
      if (!counts) return false;
      return (
        submission.criticalCount !== counts.critical + counts.missing ||
        submission.warnCount !== counts.warn
      );
    });

    assert(bad.length === 0, `${bad.length} submission(s) have stale denormalised counts`);
    console.log(`        ${DIM}checked ${submissions.length} submissions${RESET}`);
  });

  await check('no user record leaks a password hash through the API', async () => {
    const { body } = await call(admin, '/users?limit=50');
    const leaked = body.data.filter(
      (user) => 'passwordHash' in user || 'twoFactorSecret' in user || 'backupCodes' in user,
    );
    assert(leaked.length === 0, 'SECURITY: sensitive user fields are exposed by the users endpoint');
  });

  await check('the audit trail recorded this run', async () => {
    const { body } = await call(admin, '/audit?limit=1');
    assert(body.meta.total > 0, 'no audit entries');
    console.log(`        ${DIM}${body.meta.total} audit entries total${RESET}`);
  });

  // ===========================================================================
  console.log(`\n${BOLD}SCENARIO 10 — Cleanup${RESET}`);
  // ===========================================================================

  await check('retire every account this run created', retireScenarioUsers);

  await check('deactivate the teams and vehicles this run created', retireScenarioOrgData);

  await check('retired accounts can no longer sign in', async () => {
    const blocked = createSession('retired');
    const { status } = await call(blocked, '/auth/login', {
      method: 'POST',
      body: { email: userEmail('admin-b'), password: PASSWORD },
    });
    // 401 (no usable password) or 403 (suspended) are both correct refusals.
    assert(status === 401 || status === 403, `expected a refusal, got ${status}`);
  });

  // ===========================================================================
  console.log(`\n${BOLD}══════════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log(`${BOLD}══════════════════════════════════════════════════════════${RESET}\n`);

  if (failed > 0) {
    console.log(`${RED}Failures:${RESET}`);
    for (const failure of failures) {
      console.log(`  • ${failure.name}\n    ${failure.message}`);
    }
    console.log('');
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.$disconnect();
}

run().catch(async (error) => {
  console.error('\nScenario suite crashed:', error);
  await retireScenarioUsers().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
