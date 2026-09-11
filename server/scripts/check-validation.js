/**
 * Quick probe: shows the EXACT 422 body the API returns for a weak password,
 * so we can confirm the field-level `details` reach the client and the form can
 * highlight the offending input.
 *
 *   node scripts/check-validation.js <email> <currentPassword>
 */

const BASE = 'http://localhost:4000/api';

const [email, currentPassword] = process.argv.slice(2);

if (!email || !currentPassword) {
  console.error('\n  Usage: node scripts/check-validation.js <email> <currentPassword>\n');
  process.exit(1);
}

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: currentPassword }),
});

if (!login.ok) {
  console.error(`\n  Login failed (${login.status}):`, await login.text(), '\n');
  process.exit(1);
}

const token = (await login.json()).data.accessToken;

// Deliberately invalid candidates — none of these will be accepted, so this
// probe cannot change the password.
const candidates = ['admin', 'admin12345', 'ADMIN12345', 'Short1'];

console.log('\n  Password policy responses\n');

for (const candidate of candidates) {
  const response = await fetch(`${BASE}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword: candidate }),
  });

  const body = await response.json();

  console.log(`  "${candidate}"  ->  ${response.status}`);
  console.log(`      message: ${body.error?.message}`);
  console.log(`      details: ${JSON.stringify(body.error?.details)}\n`);
}
