# 03 — Running and testing locally

Everything below has been executed on this machine and works. Where a value is
already set up for you, it says so.

---

## 0. What is already installed

| Tool | Where | Status |
| --- | --- | --- |
| Node.js 24.19.0 + npm 11.17.0 | `C:\Users\abdallah2013\tools\nodejs\` | installed, on your user PATH |
| PostgreSQL 16.11 | `C:\Program Files\PostgreSQL\16\bin\` | was already yours |
| Database `lrc401` | localhost:5432 | created, migrated, seeded |
| Node installers (spare copies) | `C:\Users\abdallah2013\tools\_downloads\` | kept in case you reinstall |

Node was installed **portable** — no admin rights were needed, and nothing was
written to `Program Files`. It works in any new terminal. If you open a terminal
that predates the install, run this from the project root:

```powershell
. .\tools.ps1        # note the leading dot
```

---

## 1. First-time setup (already done — for reference / a new machine)

```powershell
npm run setup                       # installs server + client dependencies
psql -U postgres -c "CREATE DATABASE lrc401;"
npm run db:migrate                  # creates the tables
npm run db:seed                     # roles, teams, vehicles, items, the forms
```

Secrets live in `server/.env`, which is git-ignored. It already holds real
randomly-generated values for the three JWT secrets and the TOTP encryption key.
**Never commit that file.**

---

## 2. Start it

From the project root:

```powershell
npm run dev
```

That runs both halves together:

| | URL |
| --- | --- |
| Web app | <http://localhost:5173> |
| API | <http://localhost:4000> |
| Health check | <http://localhost:4000/api/health> |

Vite proxies `/api` from :5173 to :4000, so the browser sees a single origin —
which is exactly how it will behave in production behind one domain.

To run them separately:

```powershell
npm run dev:server
npm run dev:client
```

---

## 3. Sign in

| Field | Value |
| --- | --- |
| Email | `admin@lrc401.local` |
| Password | whatever `SEED_SUPERADMIN_PASSWORD` is set to in `server/.env` |

**The live password is deliberately not written here.** This file is committed
to git; a working credential in a repository is a credential in every clone,
every fork and every laptop that has ever checked the project out — and it
survives in the history even after being edited out.

On a fresh install the seed uses `SEED_SUPERADMIN_PASSWORD` from `server/.env`
(which is git-ignored) and sets `mustChangePassword`, so the first login forces
a change.

If you do not know the current one, set a new one — this does not reveal the
old password, it replaces it:

```powershell
npm --prefix server run set-password -- admin@lrc401.local 'YourNewPassword1'
```

The forced-change rule is not a UI prompt you can navigate around — the API
blocks every other endpoint until it is done (`enforcePasswordChange` in
`server/src/middleware/auth.js`). The first smoke-test run proved it by failing
44 assertions with `PASSWORD_CHANGE_REQUIRED`.

If you ever get locked out:

```powershell
npm --prefix server run unlock -- admin@lrc401.local            # clear a lockout
npm --prefix server run set-password -- admin@lrc401.local 'NewPassword123'
```

---

## 4. The automated test suite

```powershell
npm start                              # terminal 1 — the API must be running
npm --prefix server test               # terminal 2 — runs BOTH suites
```

**Current result: 115 passed, 0 failed** (57 smoke + 58 scenario), verified over
three consecutive full passes to confirm both suites are re-runnable.

Full breakdown, including every bug the tests found, is in
[06-TEST-RESULTS.md](06-TEST-RESULTS.md).

It is an **end-to-end** test, not a unit-test suite: it drives the real HTTP API
against the real database, exactly as the browser does. For a project this size
that is the higher-value test to have first, because integration is where the
bugs actually were — see section 6.

What it covers:

| Section | Checks |
| --- | --- |
| Health & bootstrap | 3 |
| Authentication | 8 — wrong password, unknown email, enumeration resistance, tampered tokens, httpOnly cookie |
| Seeded data | 6 — vehicles, teams, categories, roles, items, pagination clamping |
| The equipment form | 3 — 85 questions present, grid rows carry thresholds, option-level severity |
| Inventory ledger | 11 — size/expiry enforcement, transactional balances, negative-stock refusal, no partial writes |
| Threshold engine | 8 — short rows flagged, sufficient rows not flagged, required-field enforcement, unknown answer keys dropped |
| Access control | 7 — self-escalation blocked, unknown permissions rejected, built-in roles undeletable |
| Audit trail | 3 |
| Dashboard | 3 |
| Rate limiting | 1 |
| Setup / cleanup | 4 |

The test creates a dedicated `smoke-runner@lrc401.local` super admin and retires
it afterwards. It never touches your real administrator account, and it refuses
to run against `NODE_ENV=production`.

---

## 5. Manual walkthrough

The path worth clicking through, in order:

1. **Sign in** → forced password change → dashboard.
2. **My account → turn on two-factor.** Scan the QR with Google Authenticator,
   enter the 6-digit code, **save the backup codes** (shown once). Sign out and
   back in to see the two-step flow.
3. **People → Invite a user.** Because `EMAIL_TRANSPORT=console`, no email is
   sent — the dialog shows the invitation link directly, and the API also prints
   it in the server terminal. Open it in a private window to accept as that
   person.
4. **Roles → create a role**, tick some permissions, assign it to the new user,
   sign in as them and confirm the navigation is shorter.
5. **Teams → Monday Team → members**, make someone `TEAM_ADMIN`.
6. **Shift assignments → add one** for today, a vehicle, and that person.
7. **Sign in as them → Fill a report.** 85 questions across 6 sections, with
   autosave. Leave something short.
8. **Sign back in as the team admin → Day board.** The vehicle shows red with
   the shortage listed on its card.
9. **Inventory → Clothing store.** Add an item with custom sizes, record stock
   in, then issue some out to a named volunteer. Try to issue more than you have
   — it refuses.
10. **Form builder.** Change a threshold, save. Because the form is published,
    the API forks it into version 2 as a draft and the page follows it. Publish
    it, and confirm the old reports still read against version 1.

---

## 6. Bugs this testing actually found

Nine, of which **six were real product defects** — including a stolen access
token surviving a password change, and a rate limiter that locked the whole app
out after ten page loads.

The full record, with what each would have cost in use, is in
**[06-TEST-RESULTS.md](06-TEST-RESULTS.md)**.

---

## 7. Useful commands

```powershell
npm run db:studio     # browse the database in a GUI
npm run db:migrate    # after editing prisma/schema.prisma
npm run db:reset      # WIPES everything and re-seeds — local only
npm run db:seed       # safe to re-run; it will not duplicate or overwrite
npm run build         # production build of the web app
npm run lint
```

Diagnostics added while testing:

```powershell
npm --prefix server run db:status                        # what is in the database
npm --prefix server run unlock -- <email>                # clear a lockout
npm --prefix server run unlock -- --all
npm --prefix server run set-password -- <email> '<pw>'   # break-glass; enforces the real policy
node server/scripts/check-change-password.js <email> '<pw>'   # shows every rejection reason
```

---

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `node` not recognised | Terminal predates the PATH change. Open a new one, or `. .\tools.ps1` |
| Server exits listing env problems | `server/.env` is missing or a secret is still a placeholder. Compare with `.env.example` |
| `Can't reach database server` | PostgreSQL service is stopped. `Get-Service postgresql*` |
| Every request returns 403 `PASSWORD_CHANGE_REQUIRED` | Working as designed. Change the password first |
| 429 on login | 10 failed attempts per IP+email per 15 min. Wait, or `npm --prefix server run unlock -- <email>` |
| 429 on `/auth/refresh` | Was a bug (fixed): refresh shared the login limiter. If you still see it, the API predates the fix — restart it |
| Invitation email never arrives | Expected locally. `EMAIL_TRANSPORT=console` prints the link in the server terminal instead |
