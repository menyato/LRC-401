# 06 — Test results and the bugs testing found

**115 automated tests. Three consecutive full passes, zero failures.**

```powershell
npm start                              # terminal 1
npm --prefix server test               # terminal 2 — runs both suites
```

| Suite | Tests | What it proves |
| --- | --- | --- |
| `test:smoke` | 57 | Every endpoint works, against the real database over real HTTP |
| `test:scenarios` | 58 | Several people with different roles use the system at once, and cannot see each other's data |

Both are re-runnable. Both refuse to run against `NODE_ENV=production`.

---

## Why two suites

`smoke-test.js` asks *"does each endpoint behave?"*.

`scenario-test.js` asks the harder question: *"when four different people are
signed in at the same time, does the access control actually hold?"* It creates
real users with real limited roles, then tries to make them see things they must
not. The single most important assertion in the project is in scenario 4:

> Team Admin A must not be able to read Team B's equipment reports —
> not in a list, not by guessing the id, and not by filtering for them.

---

## Scenario coverage

| # | Scenario | Tests |
| --- | --- | --- |
| 1 | Station setup — teams, vehicles, roles | 5 |
| 2 | Invitation lifecycle: invite → preview → accept → sign in; replay rejected | 6 |
| 3 | RBAC — a restricted user blocked from six admin surfaces | 6 |
| 4 | **Data scoping** — cross-team isolation, 404-not-403, filters cannot widen scope, assignment gating | 12 |
| 5 | 2FA end to end — enrol, real TOTP, wrong code, backup codes single-use, secret encrypted at rest | 6 |
| 6 | Sessions — rotation, reuse detection, logout revocation | 4 |
| 7 | Live updates — role edits, per-user grant/deny, suspension, password change | 8 |
| 8 | Form versioning — publishing does not rewrite history | 4 |
| 9 | Database integrity — ledger invariant, denormalised counts, no field leaks | 4 |
| 10 | Cleanup | 3 |

### The security properties actually verified

- A stolen **access token dies the instant** its owner changes their password.
- A **spent refresh token** revokes the entire session family (theft detection).
- A **backup code works exactly once**.
- **TOTP secrets are AES-GCM encrypted at rest**; backup codes are bcrypt hashes.
  The test reads the raw database row and asserts the plaintext is *not* there.
- **Suspension is immediate**, not "when the token expires".
- **Deny beats grant** in the permission calculation.
- No endpoint leaks `passwordHash`, `twoFactorSecret` or `backupCodes`.
- `StockLot.quantityOnHand` equals the sum of its movements — checked against
  every lot in the live database, not a fixture.

---

## Bugs found

Nine, of which **six were real product defects**. Each is listed with what it
would have cost in use.

### 1. Server would not boot — `express-rate-limit` v7 has no `ipKeyGenerator`

That helper arrived in v8. Wrote a local IPv6 `/64` normaliser instead.
*Impact: total. The API did not start.*

### 2. Every invitation returned **500**

`Invitation.roleId` existed but the `role` relation was never declared, so
`include: { role: … }` threw. **Nobody could be invited — the only way to join
the system.** Added the relation plus a migration.

### 3. A stolen access token survived a password change

Changing a password revoked the refresh tokens, but an access token is a
stateless JWT: it stayed valid for up to 15 minutes. **The single most important
thing a password change is supposed to do — cut off whoever has your session —
did not happen.**

Fixed with a `sessionsRevokedAt` cut-off on the user, stamped by
`revokeAllUserTokens()` (which every "stop trusting this account" path already
called) and enforced in the auth middleware.

This one took two attempts. The first compared the JWT's `iat` claim, which is
whole seconds — too coarse, because a token minted 300 ms before a revocation
carries the same second as one minted 300 ms after. `<` let a stolen token
through for up to a second; `<=` falsely rejected legitimate tokens. **The
scenario suite caught both symptoms.** The fix was a millisecond `ims` claim of
our own, which makes the comparison exact.

### 4. `/auth/refresh` locked the whole app out after ~10 page loads

The refresh route reused `loginLimiter`, whose key is `ip + body.email` — but a
refresh has no body, so every refresh from one address collapsed onto the single
key `ip:` and shared one allowance of ten. The React app calls refresh on every
page load and legitimately gets a 401 when there is no session yet, which counts
as a failure. **Ten page loads bricked authentication for fifteen minutes.**
This is the `429 (Too Many Requests)` seen in the browser console.

Gave it its own limiter. The real protection against a stolen refresh token is
rotation with reuse detection, not a rate limit.

### 5. Onboarding more than five volunteers was impossible

`/auth/accept-invitation` shared the password-reset limiter: five per hour per
IP. **At a station where everyone joins over the same wi-fi, the sixth person
could not accept their invitation for an hour.** Gave invitations their own,
generous limiter — the token is 256 bits of randomness, so guessing was never
the threat.

### 6. Shared-IP limiters punished the whole station

The same flaw in four more places. Every limiter keyed on IP alone meant twenty
volunteers on one public address shared one allowance:

| Limiter | Was | Now |
| --- | --- | --- |
| Global API | 600 per **IP** — ~30 requests each per 15 min | keyed per **user** |
| Two-factor | 8 per **IP** — one person mistyping locked everyone out | keyed per **user** |
| Password reset | 5 per **IP** | keyed per **IP + email** |
| Writes | 60/min — tripped by ordinary stock-take entry | 120/min |

### 7–9. Three test bugs, not product bugs

Recorded because the *reason* each was wrong is itself documentation:

- The suites asked for `limit=200`; the API caps at 100 and returns 422. The
  clamp working as designed.
- A test asserted the forked template would be version 2; it is
  `MAX(version) + 1` across the family, so earlier runs made it 3.
- The suites polluted each other — the scenario run created vehicles that broke
  a smoke assertion about fleet size. Both sides fixed: the scenario suite now
  deactivates its own org data, and the smoke suite asserts the *seeded* fleet is
  present rather than an exact total.

---

## Behaviour that looked like a bug and is not

Two findings were the system working correctly, and the tests were changed
rather than the code:

**The database refuses to delete a user who has recorded stock.** Two foreign
keys (`StockMovement.recordedById`, `Invitation.invitedById`) default to
RESTRICT. An audit trail reading "a deleted user issued 40 tourniquets" is not a
trail — so the application only ever *suspends* users, and the test now does the
same.

**An unknown route returns 401, not 404, to an anonymous caller.** Everything
below `/auth` sits behind `authenticate`, so the request is rejected for being
unauthenticated before the 404 handler is reached. Replying 404 to some paths
and 401 to others would let anyone map which endpoints exist.

---

## Running them

```powershell
npm --prefix server test               # both suites
npm --prefix server run test:smoke
npm --prefix server run test:scenarios
npm --prefix server run db:status      # what is in the database
```

Diagnostic helpers added along the way:

```powershell
npm --prefix server run unlock -- <email>              # clear a lockout
npm --prefix server run unlock -- --all
npm --prefix server run set-password -- <email> '<pw>' # break-glass, enforces the real policy
node scripts/check-change-password.js <email> '<pw>'   # shows every rejection reason
```

---

## What is still untested

Honest list, so nobody assumes more coverage than exists:

- **The React app has no automated tests.** It compiles clean and has been
  driven by hand, but there is no Playwright or Testing Library suite. This is
  the largest remaining gap.
- **Email delivery** — the tests run with `EMAIL_TRANSPORT=console`, so SMTP is
  exercised only by the manual walkthrough.
- **Concurrency** — no test issues two simultaneous stock movements against one
  lot. The transaction and the unique constraint should make it correct, but
  that is reasoning, not evidence.
- **Load** — no performance testing at all.
