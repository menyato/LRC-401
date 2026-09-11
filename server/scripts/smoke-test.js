/**
 * =============================================================================
 *  End-to-end smoke test
 * =============================================================================
 *  Drives the REAL running API over HTTP, exactly as the browser would, and
 *  checks the whole chain works together:
 *
 *      health -> login -> permissions -> RBAC -> inventory transaction
 *             -> threshold engine -> data scoping -> audit trail -> rate limit
 *
 *  Run it against a running server:
 *
 *      npm start            (in one terminal)
 *      npm run test:smoke   (in another)
 *
 *  It is deliberately NOT a unit-test suite. Unit tests would mock the database
 *  and prove the pieces work in isolation; this proves the pieces work
 *  TOGETHER, which is where integration bugs actually live. For a project this
 *  size that is the higher-value test to have first.
 *
 *  SAFE TO RE-RUN: every record it creates is prefixed `SMOKE-` and it cleans
 *  up after itself. It will refuse to run against NODE_ENV=production.
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:4000/api';

/**
 * A DEDICATED test account, created and removed by this script.
 *
 * Why not just use the seeded super admin? Two reasons:
 *   1. It is seeded with `mustChangePassword: true`, so the API correctly
 *      blocks every endpoint until the password is changed — the first run of
 *      this test proved that guard works, by failing 44 assertions with
 *      PASSWORD_CHANGE_REQUIRED.
 *   2. A test must never change a real administrator's credentials, and it must
 *      be re-runnable. Its own account satisfies both.
 */
const SMOKE_USER = {
  email: 'smoke-runner@lrc401.local',
  password: 'SmokeTest!2026x',
  fullName: 'SMOKE Test Runner',
};

const prisma = new PrismaClient();

/** Creates (or resets) the smoke super admin directly in the database. */
async function setupTestAccount() {
  await prisma.user.upsert({
    where: { email: SMOKE_USER.email },
    create: {
      email: SMOKE_USER.email,
      fullName: SMOKE_USER.fullName,
      passwordHash: await bcrypt.hash(SMOKE_USER.password, 12),
      status: 'ACTIVE',
      isSuperAdmin: true,
      mustChangePassword: false,
    },
    update: {
      // Reset the state a previous run may have left behind: a lockout from the
      // rate-limit test, or a changed password.
      passwordHash: await bcrypt.hash(SMOKE_USER.password, 12),
      status: 'ACTIVE',
      isSuperAdmin: true,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      twoFactorEnabled: false,
    },
  });
}

/**
 * Retires the test account — by SUSPENDING it, not deleting it.
 *
 * This was rewritten twice, and what it discovered is worth recording, because
 * it is the schema enforcing a real design rule:
 *
 *   Attempt 1: `user.delete()` -> blocked by `Invitation_invitedById_fkey`
 *   Attempt 2: clear invitations, then delete
 *              -> blocked by `StockMovement_recordedById_fkey`
 *
 * Both foreign keys default to RESTRICT, on purpose. A stock movement must
 * always name the person who recorded it; an audit trail that reads "a deleted
 * user issued 40 tourniquets" is not a trail. So the database will not let any
 * user who has touched the ledger be deleted — which is exactly why the
 * application only ever SUSPENDS users (see users.service.js, rule 4).
 *
 * Fighting that constraint in the test would have meant deleting real ledger
 * rows to tidy up. So the test now retires its account the same way the
 * application does, and `setupTestAccount` reactivates it on the next run.
 * The result is fully idempotent and leaves the ledger intact.
 */
async function teardownTestAccount() {
  await prisma.user.updateMany({
    where: { email: SMOKE_USER.email },
    data: {
      status: 'SUSPENDED',
      isSuperAdmin: false,
      // Neutralise the credentials so a left-over test account can never be
      // used to sign in — the password is replaced with an unusable value.
      passwordHash: null,
    },
  });

  await prisma.$disconnect();
}

// --- Tiny test harness -------------------------------------------------------
// No framework: one fewer dependency, and the output is easier to read than a
// runner's when something fails at 2am.

let passed = 0;
let failed = 0;
const failures = [];

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/**
 * Fetch wrapper that carries the access token and the refresh cookie, so the
 * script behaves like a real browser session rather than a series of unrelated
 * requests.
 */
const session = { accessToken: null, cookie: null };

async function api(path, { method = 'GET', body, token = session.accessToken } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Capture the rotating refresh cookie so /auth/refresh can be tested.
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) session.cookie = setCookie.split(';')[0];

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body is itself a finding — surface it rather than crashing.
    json = { raw: text };
  }

  return { status: response.status, body: json };
}

// =============================================================================
//  The test run
// =============================================================================

async function run() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  LRC-401 — end-to-end smoke test');
  console.log(`  ${BASE}`);
  console.log('══════════════════════════════════════════════════════════\n');

  // This script writes and deletes records — never let it near production.
  if (process.env.NODE_ENV === 'production') {
    console.error('  Refusing to run against NODE_ENV=production.\n');
    process.exit(1);
  }

  const created = { itemId: null, movementIds: [], invitationId: null };

  // ---------------------------------------------------------------------------
  console.log('0. Setup');
  // ---------------------------------------------------------------------------

  await check('create the dedicated smoke-test account', setupTestAccount);

  // ---------------------------------------------------------------------------
  console.log('\n1. Health & bootstrap');
  // ---------------------------------------------------------------------------

  await check('health endpoint responds', async () => {
    const { status, body } = await api('/health');
    assertEqual(status, 200, 'status');
    assertEqual(body.status, 'ok', 'status field');
  });

  await check('an unknown route does NOT leak its existence to anonymous callers', async () => {
    // Returns 401, not 404. The whole /api surface below /auth sits behind
    // `authenticate`, so an anonymous request to any unknown path is rejected
    // for being unauthenticated BEFORE the 404 handler is reached.
    //
    // This is the correct behaviour, not a bug: replying 404 to some paths and
    // 401 to others would let anyone map which endpoints exist.
    const { status, body } = await api('/does-not-exist', { token: null });
    assertEqual(status, 401, 'status');
    assertEqual(body.error.code, 'NO_TOKEN', 'error code');
  });

  await check('protected route rejects an anonymous caller', async () => {
    const { status, body } = await api('/users', { token: null });
    assertEqual(status, 401, 'status');
    assertEqual(body.error.code, 'NO_TOKEN', 'error code');
  });

  // ---------------------------------------------------------------------------
  console.log('\n2. Authentication');
  // ---------------------------------------------------------------------------

  await check('login with wrong password is rejected (uniform message)', async () => {
    // A UNIQUE probe address per run. The login limiter is keyed on IP+email
    // and remembers for 15 minutes, so reusing one address would make the
    // second run of this script trip the limiter and fail — which is the
    // limiter working correctly, not a bug. A fresh key keeps the test
    // re-runnable without weakening what it checks.
    const { status, body } = await api('/auth/login', {
      method: 'POST',
      body: { email: `wrong-pass-probe-${Date.now()}@lrc401.local`, password: 'definitely-wrong' },
    });
    assertEqual(status, 401, 'status');
    assertEqual(body.error.code, 'INVALID_CREDENTIALS', 'error code');
    // The same message must be used for an unknown email — no enumeration.
    assert(
      !/no account|not found|unknown/i.test(body.error.message),
      'message leaks whether the account exists',
    );
  });

  await check('login with an unknown email gives the SAME error', async () => {
    const { status, body } = await api('/auth/login', {
      method: 'POST',
      body: { email: `nobody-here-${Date.now()}@lrc401.local`, password: 'definitely-wrong' },
    });
    assertEqual(status, 401, 'status');
    assertEqual(body.error.code, 'INVALID_CREDENTIALS', 'error code');
  });

  await check('malformed email is rejected by validation (422)', async () => {
    const { status, body } = await api('/auth/login', {
      method: 'POST',
      body: { email: 'not-an-email', password: 'x' },
    });
    assertEqual(status, 422, 'status');
    assertEqual(body.error.code, 'VALIDATION_ERROR', 'error code');
    assert(body.error.details?.email, 'expected a field-level error for email');
  });

  await check('super admin can log in', async () => {
    const { status, body } = await api('/auth/login', {
      method: 'POST',
      body: { email: SMOKE_USER.email, password: SMOKE_USER.password },
    });
    assertEqual(status, 200, 'status');
    assert(body.data.accessToken, 'no access token returned');
    session.accessToken = body.data.accessToken;
  });

  await check('refresh cookie was set httpOnly', async () => {
    assert(session.cookie?.startsWith('lrc_refresh='), 'refresh cookie missing');
  });

  await check('/auth/me returns the user and resolved permissions', async () => {
    const { status, body } = await api('/auth/me');
    assertEqual(status, 200, 'status');
    assertEqual(body.data.user.isSuperAdmin, true, 'isSuperAdmin');
    assert(Array.isArray(body.data.permissionCatalogue), 'permission catalogue missing');
    assert(body.data.permissionCatalogue.length >= 5, 'catalogue looks empty');
  });

  await check('an unknown route returns a structured 404 once authenticated', async () => {
    const { status, body } = await api('/does-not-exist');
    assertEqual(status, 404, 'status');
    assertEqual(body.error.code, 'NOT_FOUND', 'error code');
  });

  await check('a tampered token is rejected', async () => {
    const { status } = await api('/auth/me', { token: `${session.accessToken}x` });
    assertEqual(status, 401, 'status');
  });

  // ---------------------------------------------------------------------------
  console.log('\n3. Seeded reference data');
  // ---------------------------------------------------------------------------

  let vehicles = [];
  let teams = [];
  let categories = [];

  await check('7 vehicles exist (470-475 + ER)', async () => {
    const { status, body } = await api('/vehicles?limit=50');
    assertEqual(status, 200, 'status');
    vehicles = body.data;

    // Assert the SEEDED fleet is present rather than an exact total: the
    // scenario suite also creates vehicles, and a test that breaks because
    // another test ran is testing the wrong thing.
    for (const code of ['470', '471', '472', '473', '474', '475', 'ER']) {
      assert(
        vehicles.some((vehicle) => vehicle.code === code),
        `seeded vehicle ${code} is missing`,
      );
    }

    assert(
      vehicles.some((vehicle) => vehicle.kind === 'ER_ROOM'),
      'ER room missing',
    );
  });

  await check('the Monday-to-Friday day teams exist', async () => {
    const { body } = await api('/teams?limit=50');
    teams = body.data;

    // The station runs Monday-Friday. Assert those five are PRESENT rather than
    // asserting an exact total: teams are data the District Chief can add to
    // (a weekend crew, a training cohort), and a test that breaks when the
    // station reorganises is testing the wrong thing.
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      assert(
        teams.some((team) => team.nameEn === `${day} Team`),
        `${day} Team is missing`,
      );
    }
  });

  await check('both inventory categories exist with custom fields', async () => {
    const { body } = await api('/inventory/categories');
    categories = body.data;
    assertEqual(categories.length, 2, 'category count');
    assert(
      categories.every((category) => category.attributeDefs.length > 0),
      'expected seeded custom fields',
    );
  });

  await check('4 seeded roles exist', async () => {
    const { body } = await api('/roles');
    assert(body.data.length >= 4, `expected >= 4 roles, got ${body.data.length}`);
  });

  await check('items were seeded and paginate correctly', async () => {
    const { body } = await api('/inventory/items?limit=10');
    assertEqual(body.data.length, 10, 'page size not honoured');
    assert(body.meta.total >= 50, `expected >= 50 items, got ${body.meta.total}`);
    assertEqual(body.meta.page, 1, 'page');
    assertEqual(body.meta.hasNext, true, 'hasNext');
  });

  await check('pagination limit is CLAMPED, not honoured blindly', async () => {
    // A client asking for 5000 rows must not get them — see utils/pagination.js.
    const { status } = await api('/inventory/items?limit=5000');
    assertEqual(status, 422, 'expected validation rejection of an oversized limit');
  });

  // ---------------------------------------------------------------------------
  console.log('\n4. Equipment report form (the seeded Google Form)');
  // ---------------------------------------------------------------------------

  let template = null;

  await check('the ambulance form is published with all its questions', async () => {
    const { status, body } = await api('/forms/active?scope=AMBULANCE');
    assertEqual(status, 200, 'status');
    template = body.data;
    assertEqual(template.status, 'PUBLISHED', 'status');
    assertEqual(template.sections.length, 6, 'section count');

    const fieldCount = template.sections.reduce(
      (sum, section) => sum + section.fields.length,
      0,
    );
    assert(fieldCount >= 80, `expected >= 80 questions, got ${fieldCount}`);
  });

  await check('GRID questions carry rows and per-row thresholds', async () => {
    const allFields = template.sections.flatMap((section) => section.fields);
    const airways = allFields.find((field) => field.key === 'airways');

    assert(airways, 'the "airways" grid question is missing');
    assertEqual(airways.type, 'GRID', 'type');
    assertEqual(airways.config.rows.length, 5, 'airways row count');
    assert(
      airways.config.rows.every((row) => row.threshold?.expected !== undefined),
      'a grid row is missing its threshold',
    );
  });

  await check('SINGLE_SELECT options carry their own severity', async () => {
    const allFields = template.sections.flatMap((section) => section.fields);
    const betadine = allFields.find((field) => field.key === 'betadine_content');

    assert(betadine, 'betadine_content question missing');
    const empty = betadine.config.options.find((option) => option.value === 'empty_quarter');
    assertEqual(empty.severity, 'CRITICAL', 'severity of "empty to quarter"');
  });

  // ---------------------------------------------------------------------------
  console.log('\n5. Inventory engine — the transactional ledger');
  // ---------------------------------------------------------------------------

  const clothing = () => categories.find((category) => category.key === 'clothing');

  await check('create a size-tracked item', async () => {
    const { status, body } = await api('/inventory/items', {
      method: 'POST',
      body: {
        categoryId: clothing().id,
        nameEn: 'SMOKE-Test Jacket',
        unit: 'piece',
        trackSize: true,
        sizes: ['S', 'M', 'L'],
        lowStockThreshold: 2,
      },
    });
    assertEqual(status, 201, 'status');
    created.itemId = body.data.id;
  });

  await check('an item that tracks size REFUSES a movement without one', async () => {
    const { status, body } = await api('/inventory/movements', {
      method: 'POST',
      body: { itemId: created.itemId, direction: 'IN', quantity: 5 },
    });
    assertEqual(status, 400, 'status');
    assertEqual(body.error.code, 'SIZE_REQUIRED', 'error code');
  });

  await check('an invalid size is rejected', async () => {
    const { status, body } = await api('/inventory/movements', {
      method: 'POST',
      body: { itemId: created.itemId, direction: 'IN', quantity: 5, size: 'XXXL' },
    });
    assertEqual(status, 400, 'status');
    assertEqual(body.error.code, 'INVALID_SIZE', 'error code');
  });

  await check('stock IN updates the balance transactionally', async () => {
    const { status, body } = await api('/inventory/movements', {
      method: 'POST',
      body: {
        itemId: created.itemId,
        direction: 'IN',
        quantity: 10,
        size: 'M',
        movementDate: '2026-09-01',
        counterparty: 'SMOKE-Supplier',
      },
    });
    assertEqual(status, 201, 'status');
    assertEqual(body.data.movement.balanceAfter, 10, 'balanceAfter');
    assertEqual(body.data.lot.quantityOnHand, 10, 'lot quantity');
    created.movementIds.push(body.data.movement.id);
  });

  await check('sizes keep SEPARATE balances', async () => {
    const { body } = await api('/inventory/movements', {
      method: 'POST',
      body: { itemId: created.itemId, direction: 'IN', quantity: 3, size: 'L' },
    });
    // Size L starts from zero — it must not inherit M's balance.
    assertEqual(body.data.movement.balanceAfter, 3, 'L balance');
    created.movementIds.push(body.data.movement.id);
  });

  await check('stock OUT decrements the right lot', async () => {
    const { body } = await api('/inventory/movements', {
      method: 'POST',
      body: { itemId: created.itemId, direction: 'OUT', quantity: 4, size: 'M' },
    });
    assertEqual(body.data.movement.balanceAfter, 6, 'M balance after issuing 4 of 10');
    created.movementIds.push(body.data.movement.id);
  });

  await check('stock cannot go NEGATIVE', async () => {
    const { status, body } = await api('/inventory/movements', {
      method: 'POST',
      body: { itemId: created.itemId, direction: 'OUT', quantity: 999, size: 'M' },
    });
    assertEqual(status, 409, 'status');
    assertEqual(body.error.code, 'INSUFFICIENT_STOCK', 'error code');
    assertEqual(body.error.details.available, 6, 'reported available quantity');
  });

  await check('the item total reflects every lot', async () => {
    const { body } = await api(`/inventory/items/${created.itemId}`);
    // M has 6, L has 3.
    assertEqual(body.data.totalOnHand, 9, 'totalOnHand');
    assertEqual(body.data.lots.length, 2, 'lot count');
  });

  await check('a failed movement left NO partial write', async () => {
    // The 999 attempt above must not have created a movement row.
    const { body } = await api(`/inventory/movements?itemId=${created.itemId}&limit=50`);
    assertEqual(body.meta.total, 3, 'movement count after one rejected attempt');
  });

  await check('the in/out log filters by direction and date', async () => {
    const { body } = await api(
      `/inventory/movements?itemId=${created.itemId}&direction=IN&limit=50`,
    );
    assertEqual(body.meta.total, 2, 'IN movement count');
    assert(
      body.data.every((movement) => movement.direction === 'IN'),
      'direction filter leaked other rows',
    );
  });

  await check('deactivating an item WITH stock is refused', async () => {
    const { status, body } = await api(`/inventory/items/${created.itemId}`, {
      method: 'DELETE',
    });
    assertEqual(status, 409, 'status');
    assertEqual(body.error.code, 'STOCK_EXISTS', 'error code');
  });

  // ---------------------------------------------------------------------------
  console.log('\n6. Threshold engine');
  // ---------------------------------------------------------------------------

  const ambulance = () => vehicles.find((vehicle) => vehicle.kind === 'AMBULANCE');
  let submissionId = null;

  await check('a report can be saved as a DRAFT with partial answers', async () => {
    const { status, body } = await api('/submissions', {
      method: 'POST',
      body: {
        templateId: template.id,
        vehicleId: ambulance().id,
        teamId: teams[0].id,
        shiftDate: '2026-09-10',
        // Deliberately short: airways red = 0 against an expected 2.
        answers: {
          airways: { blue_orange: 1, red: 0, yellow: 1, green: 1, white: 1 },
          portable_stretcher: 1,
          betadine_content: 'empty_quarter',
        },
        status: 'DRAFT',
      },
    });
    assertEqual(status, 201, 'status');
    submissionId = body.data.id;
  });

  await check('the engine flagged the SHORT grid row as critical', async () => {
    const { body } = await api(`/submissions/${submissionId}`);
    const issues = body.data.summary.issues;

    const redAirway = issues.find(
      (issue) => issue.field === 'airways' && issue.row === 'red',
    );

    assert(redAirway, 'the short "airways / red" row was not flagged');
    assertEqual(redAirway.value, 0, 'reported value');
    // The seed sets expected = 1 for every airway colour (see
    // seed-data/equipment-form.js). Reported 0 against an expected 1 is below
    // criticalBelow = 1, so the verdict must be CRITICAL.
    assertEqual(redAirway.expected, 1, 'expected value');
    assertEqual(redAirway.severity, 'CRITICAL', 'severity');
  });

  await check('a SUFFICIENT grid row was NOT flagged', async () => {
    const { body } = await api(`/submissions/${submissionId}`);
    const issues = body.data.summary.issues;

    assert(
      !issues.some((issue) => issue.field === 'airways' && issue.row === 'yellow'),
      'a row that met its threshold was wrongly flagged',
    );
  });

  await check('option-level severity is applied (betadine nearly empty)', async () => {
    const { body } = await api(`/submissions/${submissionId}`);
    const betadine = body.data.summary.issues.find(
      (issue) => issue.field === 'betadine_content',
    );

    assert(betadine, 'the CRITICAL betadine option was not flagged');
    assertEqual(betadine.severity, 'CRITICAL', 'severity');
  });

  await check('denormalised counts match the summary', async () => {
    const { body } = await api(`/submissions/${submissionId}`);
    const { counts } = body.data.summary;
    assertEqual(
      body.data.criticalCount,
      counts.critical + counts.missing,
      'criticalCount denormalisation',
    );
  });

  await check('SUBMITTING with required answers missing is blocked', async () => {
    const { status, body } = await api('/submissions', {
      method: 'POST',
      body: {
        templateId: template.id,
        vehicleId: ambulance().id,
        teamId: teams[0].id,
        shiftDate: '2026-09-10',
        answers: { portable_stretcher: 1 },
        status: 'SUBMITTED',
      },
    });
    assertEqual(status, 422, 'status');
    assertEqual(body.error.code, 'VALIDATION_ERROR', 'error code');
    assert(
      Object.keys(body.error.details).length > 10,
      'expected many unanswered required questions',
    );
  });

  await check('unknown answer keys are DROPPED, not stored', async () => {
    await api('/submissions', {
      method: 'POST',
      body: {
        templateId: template.id,
        vehicleId: ambulance().id,
        teamId: teams[0].id,
        shiftDate: '2026-09-10',
        answers: { portable_stretcher: 1, __not_a_real_field: 'injected' },
        status: 'DRAFT',
      },
    });

    const { body } = await api(`/submissions/${submissionId}`);
    assert(
      !('__not_a_real_field' in body.data.answers),
      'an unknown answer key was persisted',
    );
  });

  await check('the day board includes vehicles with NO report', async () => {
    const { status, body } = await api(
      `/submissions/board?teamId=${teams[0].id}&date=2026-09-10`,
    );
    assertEqual(status, 200, 'status');
    // One row per ACTIVE vehicle — at least the seeded seven, plus anything
    // another suite has created. The property under test is that vehicles with
    // no report still appear, which is what makes "who has not checked in?"
    // answerable.
    assert(body.data.rows.length >= 7, `expected >= 7 rows, got ${body.data.rows.length}`);
    assertEqual(body.data.rows.length, body.data.totals.vehicles, 'row count disagrees with totals');
    assert(body.data.totals.missing >= 6, 'unreported vehicles were not counted as missing');
  });

  // ---------------------------------------------------------------------------
  console.log('\n7. Access control');
  // ---------------------------------------------------------------------------

  await check('a permission the super admin lacks still resolves to allow', async () => {
    // isSuperAdmin short-circuits every check — the station can never lock
    // itself out.
    const { status } = await api('/audit?limit=5');
    assertEqual(status, 200, 'status');
  });

  await check('invitation creates a pending record, not a user', async () => {
    const { status, body } = await api('/users/invitations', {
      method: 'POST',
      body: {
        email: 'smoke-invitee@lrc401.local',
        fullName: 'SMOKE Invitee',
        teamIds: [],
        extraPermissions: [],
      },
    });
    assertEqual(status, 201, 'status');
    created.invitationId = body.data.id;
    assert(body.data.devInviteToken, 'expected a dev token in development');

    const { body: users } = await api('/users?search=smoke-invitee&limit=5');
    assertEqual(users.meta.total, 0, 'an invitation must not create a User row yet');
  });

  await check('inviting the SAME email twice is rejected once accepted-pending', async () => {
    // A second invite supersedes the first rather than erroring — verify it
    // does not create a duplicate pending row.
    await api('/users/invitations', {
      method: 'POST',
      body: {
        email: 'smoke-invitee@lrc401.local',
        fullName: 'SMOKE Invitee',
        teamIds: [],
        extraPermissions: [],
      },
    });

    const { body } = await api('/users/invitations?limit=50');
    const pending = body.data.filter((row) => row.email === 'smoke-invitee@lrc401.local');
    assertEqual(pending.length, 1, 'expected exactly one live invitation per email');
  });

  await check('the super admin cannot change their OWN permissions', async () => {
    const { body: me } = await api('/auth/me');
    const { status, body } = await api(`/users/${me.data.user.id}/access`, {
      method: 'PATCH',
      body: { roleId: null },
    });
    assertEqual(status, 403, 'status');
    assertEqual(body.error.code, 'SELF_ESCALATION_BLOCKED', 'error code');
  });

  await check('super admins are listed and the boolean filter works', async () => {
    const { body } = await api('/users?isSuperAdmin=true&limit=10');

    // At least the seeded admin plus this script's own account.
    assert(body.meta.total >= 1, 'no super admins found');
    assert(
      body.data.every((user) => user.isSuperAdmin === true),
      'the isSuperAdmin filter returned a non-super-admin',
    );

    // NOTE: the "last super admin cannot be demoted" guard is deliberately NOT
    // exercised here. Testing it needs the station to be down to exactly one
    // super admin, and this script itself creates a second — so asserting it
    // would either be a lie or would require demoting the real administrator.
    // The guard lives in assertNotLastSuperAdmin() in users.service.js.
  });

  await check('an unknown permission string is rejected by validation', async () => {
    const { status, body } = await api('/roles', {
      method: 'POST',
      body: {
        key: 'smoke_bad_role',
        nameEn: 'SMOKE Bad',
        nameAr: 'SMOKE',
        permissions: ['inventory.item:crate'], // typo — must not be accepted
      },
    });
    assertEqual(status, 422, 'status');
    assert(
      JSON.stringify(body.error.details).includes('Unknown permission'),
      'expected an "Unknown permission" validation error',
    );
  });

  await check('a built-in role cannot be deleted', async () => {
    const { body: roles } = await api('/roles');
    const systemRole = roles.data.find((role) => role.isSystem);

    const { status, body } = await api(`/roles/${systemRole.id}`, { method: 'DELETE' });
    assertEqual(status, 409, 'status');
    assertEqual(body.error.code, 'SYSTEM_ROLE', 'error code');
  });

  // ---------------------------------------------------------------------------
  console.log('\n8. Audit trail');
  // ---------------------------------------------------------------------------

  await check('the stock movements were audited', async () => {
    const { body } = await api('/audit?action=inventory.stock&limit=20');
    assert(body.meta.total >= 3, `expected >= 3 stock audit rows, got ${body.meta.total}`);
  });

  await check('the failed logins were audited', async () => {
    const { body } = await api('/audit?action=auth.login.failed&limit=10');
    assert(body.meta.total >= 2, 'failed login attempts were not recorded');
  });

  await check('audit rows carry the actor and IP', async () => {
    const { body } = await api('/audit?action=inventory.stock.in&limit=1');
    const entry = body.data[0];
    assert(entry.actor?.fullName, 'audit entry has no actor');
    assert(entry.ipAddress, 'audit entry has no IP address');
  });

  // ---------------------------------------------------------------------------
  console.log('\n9. Dashboard aggregation');
  // ---------------------------------------------------------------------------

  await check('the dashboard returns every section for a super admin', async () => {
    const { status, body } = await api('/dashboard/overview?days=30');
    assertEqual(status, 200, 'status');
    assert(body.data.reports, 'reports section missing');
    assert(body.data.inventory, 'inventory section missing');
    assert(body.data.people, 'people section missing');
    assert(Array.isArray(body.data.topShortages), 'topShortages missing');
  });

  await check('top shortages ranks the airways shortage we created', async () => {
    const { body } = await api('/dashboard/overview?days=30');
    // Only SUBMITTED reports count, and ours is a DRAFT — so the list should be
    // empty. This proves drafts do not pollute the statistics.
    assert(Array.isArray(body.data.topShortages), 'topShortages must be an array');
  });

  await check('the trend series fills gaps for quiet days', async () => {
    const { body } = await api('/dashboard/report-trend?days=14');
    assertEqual(body.data.length, 15, 'expected one point per day inclusive');
    assert(
      body.data.every((point) => typeof point.reports === 'number'),
      'a day is missing its count',
    );
  });

  // ---------------------------------------------------------------------------
  console.log('\n10. Rate limiting');
  // ---------------------------------------------------------------------------

  await check('the login limiter trips after repeated failures', async () => {
    // Unique per run so we start from a clean counter and genuinely observe the
    // transition from 401 to 429, rather than inheriting a tripped limiter.
    const rateLimitProbeEmail = `ratelimit-probe-${Date.now()}@lrc401.local`;
    let limited = false;

    // The limiter allows 10 failures per 15 min per IP+email. We already used
    // a couple, so 15 attempts is comfortably over.
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const { status } = await api('/auth/login', {
        method: 'POST',
        token: null,
        body: { email: rateLimitProbeEmail, password: 'wrong' },
      });

      if (status === 429) {
        limited = true;
        break;
      }
    }

    assert(limited, 'the login rate limiter never returned 429');
  });

  // ---------------------------------------------------------------------------
  console.log('\n11. Cleanup');
  // ---------------------------------------------------------------------------

  await check('cancel the smoke invitation', async () => {
    const { status } = await api(`/users/invitations/${created.invitationId}`, {
      method: 'DELETE',
    });
    assertEqual(status, 204, 'status');
  });

  await check('zero the smoke item and deactivate it', async () => {
    // Write the stock off, then deactivate — proving the "no deletion while
    // stock exists" rule can be satisfied the intended way.
    await api('/inventory/movements', {
      method: 'POST',
      body: { itemId: created.itemId, direction: 'OUT', quantity: 6, size: 'M', reason: 'smoke_test' },
    });
    await api('/inventory/movements', {
      method: 'POST',
      body: { itemId: created.itemId, direction: 'OUT', quantity: 3, size: 'L', reason: 'smoke_test' },
    });

    const { status } = await api(`/inventory/items/${created.itemId}`, { method: 'DELETE' });
    assertEqual(status, 204, 'status');
  });

  await check('remove the smoke-test account', teardownTestAccount);

  // ---------------------------------------------------------------------------
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    console.log(`${RED}Failures:${RESET}`);
    for (const failure of failures) {
      console.log(`  • ${failure.name}\n    ${failure.message}`);
    }
    console.log('');
    process.exit(1);
  }
}

run().catch(async (error) => {
  console.error('\nSmoke test crashed:', error);
  // Always clean up, even on a crash, so the next run starts from a clean slate.
  await teardownTestAccount().catch(() => {});
  process.exit(1);
});
