# LRC Saida 401

Equipment reporting, inventory and access management for the Lebanese Red Cross,
Saida 401 station.

Three things in one system:

1. **Equipment reports** — the daily vehicle check, as a dynamic form the super
   admin builds from the dashboard, with thresholds that turn a filled report
   into "what is missing on 472 today".
2. **Inventory** — one engine serving both the clothing store (custom sizes per
   item) and the medical equipment store (batches and expiry dates), on an
   immutable in/out ledger.
3. **People and access** — invitations by email, two-factor authentication, and
   roles the super admin composes freely, with data scoped so a team admin sees
   only their own team's reports.

Bilingual English / Arabic with full RTL, and built mobile-first because the
people filling these forms are standing next to an ambulance with a phone.

---

## Quick start

```powershell
npm run setup        # first time only
npm run dev          # web on :5173, API on :4000
```

Sign in with `admin@lrc401.local` / `ChangeMe!2026` — you will be required to
change it immediately.

Full instructions, the manual walkthrough and troubleshooting:
**[docs/03-LOCAL-TESTING.md](docs/03-LOCAL-TESTING.md)**

---

## Tests

```powershell
npm start                  # terminal 1
npm --prefix server test   # terminal 2 — runs all three suites
```

**147 tests, 0 failures.**

| Suite | Tests | What it proves |
| --- | --- | --- |
| `test:smoke` | 57 | Every endpoint works, against the real database over real HTTP |
| `test:scenarios` | 59 | Four people with different roles signed in at once — and unable to see each other's data |
| `test:security` | 31 | Forged tokens, foreign origins, mass assignment, privilege escalation, path traversal, and hostile input on every endpoint — nothing may return a 5xx |

Testing found **six real product bugs**, including a stolen access token
surviving a password change and a rate limiter that locked the whole app out
after ten page loads. All are documented in
[docs/06-TEST-RESULTS.md](docs/06-TEST-RESULTS.md).

---

## Documentation

| Document | What it answers |
| --- | --- |
| [01 — Stack decision](docs/01-STACK-DECISION.md) | Why PostgreSQL rather than the MERN stack that was asked about |
| [02 — Domain model](docs/02-DOMAIN-MODEL.md) | How the four concerns fit together, and why roles are data but permissions are code |
| [03 — Local testing](docs/03-LOCAL-TESTING.md) | Running it, the test suite, the manual walkthrough, the bugs testing found |
| [04 — Launch roadmap](docs/04-LAUNCH-ROADMAP.md) | Hosting, costs, deployment steps, and what must happen before real data |
| [05 — Activity diagrams](docs/05-ACTIVITY-DIAGRAMS.md) | The six main flows as diagrams |
| [06 — Test results](docs/06-TEST-RESULTS.md) | What is verified, and every bug the tests found |
| [07 — Branches](docs/07-BRANCHES-AND-DEPLOYMENT.md) | dev → staging → production |
| [08 — Deployment](docs/08-DEPLOYMENT.md) | Putting it online: Render + Neon + email, step by step |

---

## Stack

| Layer | Choice |
| --- | --- |
| Database | PostgreSQL 16 + Prisma |
| API | Node.js + Express 4, ES modules |
| Validation | Zod at every request boundary |
| Auth | JWT access token (15 min, in memory) + rotating refresh token (httpOnly cookie) + TOTP 2FA |
| Web | React 18 + Vite + Tailwind + TanStack Query |
| i18n | i18next, EN/AR with RTL |

Full reasoning in [docs/01-STACK-DECISION.md](docs/01-STACK-DECISION.md).

---

## Layout

```
server/
  prisma/
    schema.prisma        the single source of truth for the data model
    seed.js              roles, teams, vehicles, items, the equipment forms
    seed-data/           your item list and your Google Form, as data
  scripts/
    smoke-test.js        the end-to-end suite
  src/
    config/              env validation, database, the permission catalogue
    middleware/          auth, validation, rate limits, error handling
    services/            access, tokens, TOTP, email, audit, thresholds
    modules/             one folder per resource: routes + service + validators
    routes.js            the map of the entire API surface

client/
  src/
    components/          DataTable, Modal, StatusBadge, CrudPage…
    features/            auth, reports, inventory, users
    pages/               one per route
    locales/             en.js / ar.js
    lib/                 api client, i18n, chart theme
```

---

## Design decisions worth knowing

- **Roles are data; permissions are code.** The super admin composes any role
  they like from a fixed catalogue, because a permission string only means
  something if some route enforces it. Letting the UI invent new ones would
  create checkboxes that guard nothing.
- **Permissions answer "may you?"; scope answers "whose?"** Scope is applied as
  a mandatory SQL `WHERE` clause, so an out-of-scope row is never selected.
- **The stock balance is a cache of the ledger**, updated in the same
  transaction as every movement. Movements are immutable; mistakes are corrected
  with a compensating adjustment.
- **Report verdicts are computed once, at submit time, and stored**, so changing
  a threshold next month cannot retroactively re-grade last month's reports.
- **Users are never deleted, only suspended** — the database itself enforces
  this, because audit entries and stock movements must always name a real
  person.

---

## Status

Backend complete, 147 automated tests passing. Web app complete and building
clean. Ready to deploy — see [docs/08-DEPLOYMENT.md](docs/08-DEPLOYMENT.md).

The React app itself has no automated tests yet; that is the largest remaining
gap and is listed in [docs/06-TEST-RESULTS.md](docs/06-TEST-RESULTS.md).
