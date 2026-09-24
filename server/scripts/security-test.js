/**
 * =============================================================================
 *  Security & crash test
 * =============================================================================
 *  The smoke and scenario suites prove the app WORKS. This one tries to BREAK
 *  it, the way a curious volunteer, a scanner or an attacker would, and checks
 *  two things about every response:
 *
 *    1. It never crashes: no 5xx, whatever garbage goes in. A 500 is at best a
 *       confusing screen at 7am and at worst an unhandled path an attacker can
 *       keep probing.
 *    2. It never leaks or grants anything: forged tokens, foreign origins,
 *       mass assignment, privilege escalation and path traversal all fail.
 *
 *      npm start                      (in one terminal)
 *      npm --prefix server run test:security
 *
 *  Safe to re-run. It uses two dedicated accounts it creates and retires
 *  itself, every write targets an id that does not exist or carries a body the
 *  validator must reject, and it refuses to run with NODE_ENV=production.
 *
 *  A 429 counts as "did not crash" everywhere below: re-running the suite in
 *  quick succession legitimately trips the limiters, and a limiter answering is
 *  the system working.
 * =============================================================================
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const BASE = process.env.SECURITY_BASE_URL ?? 'http://localhost:4000/api';
const ORIGIN = new URL(BASE).origin;

/** A syntactically valid cuid that matches no row, so writes cannot land. */
const FAKE_ID = 'cjld2cjxh0000qzrmn831i7rn';

const ADMIN = {
  email: 'security-admin@lrc401.local',
  password: 'SecurityTest!2026a',
  fullName: 'SECURITY Test Admin',
  isSuperAdmin: true,
};

/** No role, no permissions: what any freshly invited volunteer starts with. */
const NOBODY = {
  email: 'security-nobody@lrc401.local',
  password: 'SecurityTest!2026b',
  fullName: 'SECURITY Test Nobody',
  isSuperAdmin: false,
};

const prisma = new PrismaClient();

async function setupAccount(account) {
  const state = {
    fullName: account.fullName,
    passwordHash: await bcrypt.hash(account.password, 12),
    status: 'ACTIVE',
    isSuperAdmin: account.isSuperAdmin,
    mustChangePassword: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    twoFactorEnabled: false,
    roleId: null,
    extraPermissions: [],
    deniedPermissions: [],
  };

  return prisma.user.upsert({
    where: { email: account.email },
    create: { email: account.email, ...state },
    update: state,
    select: { id: true },
  });
}

/** Users are never deleted (the schema forbids it) — suspend and disarm. */
async function teardownAccounts() {
  await prisma.user.updateMany({
    where: { email: { in: [ADMIN.email, NOBODY.email] } },
    data: { status: 'SUSPENDED', isSuperAdmin: false, passwordHash: null },
  });
  await prisma.$disconnect();
}

// --- Tiny test harness (same shape as smoke-test.js) -------------------------

let passed = 0;
let failed = 0;
const failures = [];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

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

/**
 * Raw request. `body` may be a pre-serialised string so we can send malformed
 * JSON; `headers` overrides anything.
 */
async function request(path, { method = 'GET', token, body, headers = {}, base = BASE } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { status: response.status, headers: response.headers, body: json, text };
}

async function login(account) {
  const { status, body, headers } = await request('/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password },
  });
  assert(status === 200, `login for ${account.email} returned ${status}: ${JSON.stringify(body)}`);
  return { token: body.data.accessToken, setCookie: headers.get('set-cookie') ?? '' };
}

/** "Did not crash": any status below 500. */
function assertNoCrash(result, label) {
  assert(
    result.status < 500,
    `${label} -> ${result.status} ${JSON.stringify(result.body?.error ?? result.body).slice(0, 200)}`,
  );
}

// =============================================================================
//  Every endpoint, for the sweeps. `:id` is replaced with FAKE_ID.
// =============================================================================

const LIST_ENDPOINTS = [
  '/users',
  '/users/invitations',
  '/teams',
  '/vehicles',
  '/assignments',
  '/inventory/items',
  '/inventory/movements',
  '/inventory/expiring',
  '/forms/templates',
  '/submissions',
  '/submissions/board',
  '/restock/board',
  '/audit',
];

const WRITE_ENDPOINTS = [
  ['PATCH', '/auth/profile'],
  ['POST', '/auth/change-password'],
  ['POST', '/users/invitations'],
  ['DELETE', '/users/invitations/:id'],
  ['PATCH', '/users/:id'],
  ['PATCH', '/users/:id/access'],
  ['PUT', '/users/:id/teams'],
  ['PATCH', '/users/:id/status'],
  ['POST', '/users/:id/reset-password'],
  ['POST', '/roles'],
  ['PATCH', '/roles/:id'],
  ['DELETE', '/roles/:id'],
  ['POST', '/teams'],
  ['PATCH', '/teams/:id'],
  ['DELETE', '/teams/:id'],
  ['POST', '/vehicles'],
  ['PATCH', '/vehicles/:id'],
  ['DELETE', '/vehicles/:id'],
  ['PUT', '/vehicles/:id/rules'],
  ['DELETE', `/vehicles/:id/rules/${FAKE_ID}`],
  ['POST', '/assignments'],
  ['PATCH', '/assignments/:id'],
  ['DELETE', '/assignments/:id'],
  ['POST', '/inventory/categories'],
  ['PATCH', '/inventory/categories/:id'],
  ['PUT', '/inventory/categories/:id/fields'],
  ['DELETE', '/inventory/fields/:id'],
  ['POST', '/inventory/movements'],
  ['POST', '/inventory/movements/bulk'],
  ['POST', '/inventory/items'],
  ['PATCH', '/inventory/items/:id'],
  ['DELETE', '/inventory/items/:id'],
  ['POST', '/forms/templates'],
  ['PUT', '/forms/templates/:id'],
  ['POST', '/forms/templates/:id/publish'],
  ['POST', '/forms/templates/:id/new-version'],
  ['POST', '/submissions'],
  ['POST', '/submissions/:id/review'],
  ['POST', '/restock/from-submission/:id'],
  ['PATCH', '/restock/:id/status'],
  ['PATCH', '/restock/:id/assign'],
  ['PATCH', `/restock/:id/lines/${FAKE_ID}`],
  ['PUT', '/settings/not-a-real-setting'],
];

/** Bodies no validator should accept, each targeting a different weakness. */
const HOSTILE_BODIES = {
  // A JSON array where an object is expected.
  array: [{ id: FAKE_ID }],
  // Prototype pollution, NoSQL-style operators, wrong types, a 32-bit overflow,
  // a NUL byte (Postgres cannot store one) and an oversized string.
  poison: JSON.parse(
    JSON.stringify({
      id: { $ne: null },
      email: ['a@b.c', { $gt: '' }],
      fullName: 'x'.repeat(5000),
      nameEn: 'bad\u0000name',
      quantity: 3_000_000_000,
      direction: { toString: 1 },
      isSuperAdmin: true,
      permissions: '*',
    }).replace('"id"', '"__proto__":{"isSuperAdmin":true},"constructor":{"prototype":{"polluted":1}},"id"'),
  ),
};

// =============================================================================
//  The test run
// =============================================================================

async function run() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  LRC-401 — security & crash test');
  console.log(`  ${BASE}`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (process.env.NODE_ENV === 'production') {
    console.error('  Refusing to run against NODE_ENV=production.\n');
    process.exit(1);
  }

  let admin;
  let nobody;
  let nobodyId;

  // ---------------------------------------------------------------------------
  console.log('0. Setup');
  // ---------------------------------------------------------------------------

  await check('create the two dedicated test accounts', async () => {
    await setupAccount(ADMIN);
    nobodyId = (await setupAccount(NOBODY)).id;
    admin = await login(ADMIN);
    nobody = await login(NOBODY);
  });

  if (!admin || !nobody) {
    throw new Error('Could not sign in the test accounts — is the API running?');
  }

  // ---------------------------------------------------------------------------
  console.log('\n1. Tokens');
  // ---------------------------------------------------------------------------

  const adminId = JSON.parse(Buffer.from(admin.token.split('.')[1], 'base64url')).sub;

  await check('an unsigned token (alg: none) is rejected', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: adminId, typ: 'access', iss: 'lrc-401', exp: Date.now() / 1000 + 600 }),
    ).toString('base64url');
    const { status } = await request('/auth/me', { token: `${header}.${payload}.` });
    assert(status === 401, `expected 401, got ${status}`);
  });

  await check('a token signed with the MFA secret cannot be used as an access token', async () => {
    const forged = jwt.sign({ sub: adminId, typ: 'access' }, process.env.JWT_MFA_SECRET, {
      issuer: 'lrc-401',
      expiresIn: '5m',
    });
    const { status } = await request('/auth/me', { token: forged });
    assert(status === 401, `expected 401, got ${status}`);
  });

  await check('an MFA-typed token signed with the ACCESS secret is rejected', async () => {
    const forged = jwt.sign({ sub: adminId, typ: 'mfa' }, process.env.JWT_ACCESS_SECRET, {
      issuer: 'lrc-401',
      expiresIn: '5m',
    });
    const { status } = await request('/auth/me', { token: forged });
    assert(status === 401, `expected 401, got ${status}`);
  });

  await check('an expired token is rejected with TOKEN_EXPIRED, not a 500', async () => {
    const expired = jwt.sign(
      { sub: adminId, typ: 'access', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_ACCESS_SECRET,
      { issuer: 'lrc-401' },
    );
    const { status, body } = await request('/auth/me', { token: expired });
    assert(status === 401, `expected 401, got ${status}`);
    assert(body?.error?.code === 'TOKEN_EXPIRED', `expected TOKEN_EXPIRED, got ${body?.error?.code}`);
  });

  await check('garbage in the Authorization header is a 401, not a crash', async () => {
    for (const value of ['Bearer', 'Bearer ', 'Bearer a.b', 'Basic YWRtaW46YWRtaW4=', 'Bearer ' + 'x'.repeat(8000)]) {
      const result = await request('/auth/me', { headers: { Authorization: value } });
      assert(result.status === 401 || result.status === 431, `"${value.slice(0, 20)}…" -> ${result.status}`);
    }
  });

  await check('the refresh cookie is HttpOnly, SameSite=Lax and scoped to /api/auth', async () => {
    const cookie = admin.setCookie;
    assert(/HttpOnly/i.test(cookie), `missing HttpOnly: ${cookie}`);
    assert(/SameSite=Lax/i.test(cookie), `missing SameSite=Lax: ${cookie}`);
    assert(/Path=\/api\/auth/i.test(cookie), `cookie path is not /api/auth: ${cookie}`);
  });

  // ---------------------------------------------------------------------------
  console.log('\n2. Transport and headers');
  // ---------------------------------------------------------------------------

  await check('security headers are present and the framework is not advertised', async () => {
    const { headers } = await request('/health');
    assert(!headers.get('x-powered-by'), 'X-Powered-By is exposed');
    assert(headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
    assert(/frame-ancestors 'none'/.test(headers.get('content-security-policy') ?? ''), 'no frame-ancestors');
  });

  await check('a request from a foreign origin is refused with 403 and no CORS grant', async () => {
    const result = await request('/auth/login', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: { email: ADMIN.email, password: ADMIN.password },
    });
    assert(result.status === 403, `expected 403, got ${result.status}`);
    assert(!result.headers.get('access-control-allow-origin'), 'CORS header was granted');
  });

  await check('the configured web origin IS granted CORS with credentials', async () => {
    const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173';
    const { headers } = await request('/health', { headers: { Origin: clientUrl } });
    assert(headers.get('access-control-allow-origin') === clientUrl, 'allowed origin not echoed');
    assert(headers.get('access-control-allow-credentials') === 'true', 'credentials not allowed');
  });

  await check('malformed JSON is a 400, not a 500', async () => {
    const { status } = await request('/auth/login', { method: 'POST', body: '{"email": "a@b.c", ' });
    assert(status === 400, `expected 400, got ${status}`);
  });

  await check('a 2 MB body is refused without crashing', async () => {
    const huge = JSON.stringify({ fullName: 'x'.repeat(2 * 1024 * 1024) });
    const result = await request('/auth/profile', { method: 'PATCH', token: nobody.token, body: huge });
    assert(result.status === 400 || result.status === 413, `expected 400/413, got ${result.status}`);
  });

  await check('a non-JSON content type does not bypass validation', async () => {
    const result = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: `email=${ADMIN.email}&password=${ADMIN.password}`,
    });
    assert(result.status === 422 || result.status === 429, `expected 422, got ${result.status}`);
  });

  await check('path traversal cannot read files outside the web app', async () => {
    for (const path of [
      '/..%2f..%2fserver%2f.env',
      '/%2e%2e/%2e%2e/server/.env',
      '/..%5c..%5cserver%5c.env',
      '/assets/..%2f..%2f..%2fserver%2f.env',
    ]) {
      const result = await request(path, { base: ORIGIN });
      assert(!/JWT_ACCESS_SECRET|DATABASE_URL/.test(result.text), `${path} leaked the .env file`);
      assertNoCrash(result, path);
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\n3. Authorisation');
  // ---------------------------------------------------------------------------

  await check('a user with no permissions is refused every admin endpoint', async () => {
    const attempts = [
      ['GET', '/users'],
      ['GET', '/audit'],
      ['GET', '/inventory/movements'],
      ['POST', '/roles', { key: 'x', nameEn: 'x', nameAr: 'x', permissions: [] }],
      ['POST', '/users/invitations', { email: 'victim@example.com', fullName: 'Victim' }],
      ['POST', `/users/${adminId}/reset-password`, {}],
      ['PATCH', `/users/${adminId}/status`, { status: 'SUSPENDED' }],
      ['PUT', '/settings/any', { value: 1 }],
    ];

    for (const [method, path, body] of attempts) {
      const { status } = await request(path, { method, token: nobody.token, body });
      assert(status === 403, `${method} ${path} -> ${status}, expected 403`);
    }
  });

  await check('a user cannot grant themselves permissions or super admin', async () => {
    const attempts = [
      ['PATCH', `/users/${nobodyId}/access`, { isSuperAdmin: true, extraPermissions: ['user:read'] }],
      ['PATCH', `/users/${nobodyId}`, { isSuperAdmin: true }],
      ['PATCH', `/users/${nobodyId}/status`, { status: 'ACTIVE' }],
    ];
    for (const [method, path, body] of attempts) {
      const { status } = await request(path, { method, token: nobody.token, body });
      assert(status === 403, `${method} ${path} -> ${status}, expected 403`);
    }
  });

  await check('mass assignment through the profile endpoint changes nothing it should not', async () => {
    await request('/auth/profile', {
      method: 'PATCH',
      token: nobody.token,
      body: HOSTILE_BODIES.poison,
    });
    await request('/auth/profile', {
      method: 'PATCH',
      token: nobody.token,
      body: '{"__proto__":{"isSuperAdmin":true},"isSuperAdmin":true,"status":"ACTIVE","roleId":"x",' +
        '"extraPermissions":["*"],"email":"admin@lrc401.local","locale":"en"}',
    });

    const user = await prisma.user.findUnique({
      where: { id: nobodyId },
      select: { isSuperAdmin: true, email: true, extraPermissions: true, roleId: true },
    });
    assert(user.isSuperAdmin === false, 'became super admin');
    assert(user.email === NOBODY.email, `email changed to ${user.email}`);
    assert(user.extraPermissions.length === 0, 'gained permissions');
    assert(user.roleId === null, 'gained a role');
  });

  await check('a user cannot read a report outside their scope by guessing its id', async () => {
    const list = await request('/submissions?limit=1', { token: admin.token });
    const id = list.body?.data?.[0]?.id;
    if (!id) return; // No reports in this database — nothing to guess.
    const { status } = await request(`/submissions/${id}`, { token: nobody.token });
    assert(status === 403 || status === 404, `expected 403/404, got ${status}`);
  });

  // ---------------------------------------------------------------------------
  console.log('\n4. Pagination and query abuse');
  // ---------------------------------------------------------------------------

  await check('no list endpoint ever returns more than 100 rows', async () => {
    for (const path of LIST_ENDPOINTS) {
      const result = await request(`${path}?limit=100000`, { token: admin.token });
      assertNoCrash(result, path);
      if (result.status === 200 && Array.isArray(result.body?.data)) {
        assert(result.body.data.length <= 100, `${path} returned ${result.body.data.length} rows`);
      }
    }
  });

  await check('hostile query strings never crash a list endpoint', async () => {
    const hostile = [
      'page=abc&limit=-5',
      'page=0&limit=0',
      'page=99999999999999999999',
      'page=1e308',
      'limit=1.5',
      'sortBy=passwordHash&sortDir=sideways',
      'sortBy[]=a&sortBy[]=b&page[]=1',
      'page[$gt]=1&search[$ne]=x',
      `search=${encodeURIComponent("' OR 1=1; DROP TABLE users; --")}`,
      `search=${encodeURIComponent('%_\\')}`,
      `search=${'x'.repeat(500)}`,
      'search=%00',
      'search=a%00b',
      'dateFrom=not-a-date&dateTo=2026-13-45',
      'dateFrom=99999-01-01',
      'includeInactive=maybe&status=HACKED&days=99999',
      'categoryId=../../etc/passwd',
    ];

    for (const path of LIST_ENDPOINTS) {
      for (const query of hostile) {
        assertNoCrash(await request(`${path}?${query}`, { token: admin.token }), `${path}?${query}`);
      }
    }
  });

  await check('an SQL-injection search is treated as plain text', async () => {
    const result = await request(`/users?search=${encodeURIComponent("' OR '1'='1")}`, { token: admin.token });
    assert(result.status === 200, `expected 200, got ${result.status}`);
    assert(result.body.data.length === 0, `returned ${result.body.data.length} users`);
  });

  await check('hostile ids in the URL never crash', async () => {
    for (const id of ['1', 'null', '%00', '..%2f..', "1'OR'1'='1", 'c'.repeat(300), FAKE_ID]) {
      for (const path of ['/users/', '/inventory/items/', '/submissions/', '/forms/templates/', '/restock/']) {
        assertNoCrash(await request(`${path}${id}`, { token: admin.token }), `${path}${id}`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  console.log('\n5. Hostile bodies on every write endpoint');
  // ---------------------------------------------------------------------------

  for (const [label, body] of Object.entries(HOSTILE_BODIES)) {
    await check(`every write endpoint survives the "${label}" body`, async () => {
      const crashes = [];
      for (const [method, template] of WRITE_ENDPOINTS) {
        const path = template.replace(':id', FAKE_ID);
        const result = await request(path, { method, token: admin.token, body });
        if (result.status >= 500) crashes.push(`${method} ${path} -> ${result.status}`);
      }
      assert(crashes.length === 0, crashes.join('; '));
    });
  }

  await check('Object.prototype was not polluted (the server still answers normally)', async () => {
    const { status, body } = await request('/auth/me', { token: nobody.token });
    assert(status === 200, `expected 200, got ${status}`);
    assert(body.data.user.isSuperAdmin === false, 'the no-permission user reads as super admin');
    assert(body.data.permissions.length === 0, 'the no-permission user gained permissions');
    const users = await request('/users', { token: nobody.token });
    assert(users.status === 403, `the no-permission user can now list users (${users.status})`);
  });

  await check('an out-of-range quantity is a validation error, not a database crash', async () => {
    // A fake item id is enough: validation must reject the number before the
    // service ever looks the item up. Anything but a 422 on `quantity` means
    // the value got past the schema.
    const result = await request('/inventory/movements', {
      method: 'POST',
      token: admin.token,
      body: { itemId: FAKE_ID, direction: 'IN', quantity: 3_000_000_000, reason: 'security_test' },
    });
    assert(result.status === 422, `expected 422, got ${result.status} ${JSON.stringify(result.body)}`);
    assert(result.body.error.details?.quantity, `422 was not about quantity: ${JSON.stringify(result.body)}`);
  });

  await check('a NUL byte in a text field is a validation error, not a database crash', async () => {
    const result = await request('/auth/profile', {
      method: 'PATCH',
      token: nobody.token,
      body: { fullName: 'Nul\u0000Byte' },
    });
    assert(result.status === 422, `expected 422, got ${result.status}`);
  });

  // ---------------------------------------------------------------------------
  console.log('\n6. Public endpoints');
  // ---------------------------------------------------------------------------

  await check('public auth endpoints survive hostile bodies', async () => {
    for (const path of ['/auth/login', '/auth/verify-2fa', '/auth/forgot-password', '/auth/reset-password', '/auth/accept-invitation']) {
      for (const body of Object.values(HOSTILE_BODIES)) {
        assertNoCrash(await request(path, { method: 'POST', body }), path);
      }
    }
    assertNoCrash(await request('/auth/invitation?token[$ne]=x'), '/auth/invitation');
    assertNoCrash(await request('/auth/refresh', { method: 'POST', headers: { Cookie: 'refreshToken=%00%ff' } }), '/auth/refresh');
  });

  await check('forgot-password does not reveal whether an account exists', async () => {
    const known = await request('/auth/forgot-password', { method: 'POST', body: { email: ADMIN.email } });
    const unknown = await request('/auth/forgot-password', {
      method: 'POST',
      body: { email: 'nobody-here-at-all@lrc401.local' },
    });
    if (known.status === 429 || unknown.status === 429) return;
    assert(known.status === unknown.status, `status differs: ${known.status} vs ${unknown.status}`);
    assert(
      JSON.stringify(known.body) === JSON.stringify(unknown.body),
      'response body differs between a real and an unknown address',
    );
  });

  await check('the API is still healthy after all of the above', async () => {
    const { status } = await request('/health');
    assert(status === 200, `health returned ${status}`);
  });

  await check('retire the test accounts', teardownAccounts);

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
  console.error('\nSecurity test crashed:', error);
  await teardownAccounts().catch(() => {});
  process.exit(1);
});
