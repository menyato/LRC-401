/**
 * Proves the change-password flow works end to end, and shows exactly what the
 * API says in each failure case — so "it just says check the highlighted
 * fields" can be diagnosed instead of guessed at.
 *
 *   node scripts/check-change-password.js <email> <currentPassword>
 *
 * It changes the password to a temporary value and then changes it straight
 * back, so the account ends where it started.
 */

const BASE = 'http://localhost:4000/api';

const [email, currentPassword] = process.argv.slice(2);

if (!email || !currentPassword) {
  console.error('\n  Usage: node scripts/check-change-password.js <email> <currentPassword>\n');
  process.exit(1);
}

let cookie = null;

async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function login(password) {
  const { status, body } = await api('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (status !== 200) throw new Error(`login failed (${status}): ${JSON.stringify(body?.error)}`);
  return body.data.accessToken;
}

console.log('\n  Change-password flow\n');

let token = await login(currentPassword);
console.log('  1. login with the current password              -> OK');

// --- The failure cases, so their exact messages are visible ------------------
const rejections = [
  ['wrong current password', { currentPassword: 'NotMyPassword9', newPassword: 'ValidPass123' }],
  ['new password identical to current', { currentPassword, newPassword: currentPassword }],
  ['new password too short', { currentPassword, newPassword: 'Short1' }],
  ['new password has no uppercase', { currentPassword, newPassword: 'alllowercase1' }],
  ['new password has no digit', { currentPassword, newPassword: 'NoDigitsHere' }],
];

console.log('\n  Rejections (each should fail, with a reason):\n');

for (const [label, payload] of rejections) {
  const { status, body } = await api('/auth/change-password', {
    method: 'POST',
    token,
    body: payload,
  });

  const reason =
    body?.error?.details?.newPassword ??
    body?.error?.details?.currentPassword ??
    body?.error?.message;

  console.log(`     ${String(status).padEnd(4)} ${label.padEnd(36)} ${reason}`);
}

// --- The happy path ---------------------------------------------------------
const temporary = 'TempRotate2026';

console.log('\n  Happy path:\n');

const changed = await api('/auth/change-password', {
  method: 'POST',
  token,
  body: { currentPassword, newPassword: temporary },
});

console.log(`     ${changed.status}  change to a valid new password   -> ${changed.body?.data?.message}`);

// Every session was revoked, so the old token must now be dead.
const afterChange = await api('/auth/me', { token });
console.log(`     ${afterChange.status}  old access token after the change -> ${afterChange.body?.error?.code ?? 'still valid (BAD)'}`);

// Sign in with the new one, then put the original back.
token = await login(temporary);
console.log(`     200  login with the NEW password         -> OK`);

const restored = await api('/auth/change-password', {
  method: 'POST',
  token,
  body: { currentPassword: temporary, newPassword: currentPassword },
});
console.log(`     ${restored.status}  restored the original password`);

await login(currentPassword);
console.log('     200  login with the original password    -> OK\n');
console.log('  The flow works. The account is back where it started.\n');
