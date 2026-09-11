# 01 — Stack Decision

## Question asked: "is MERN the best choice?"

**Short answer: no — PERN (PostgreSQL) is the better fit, and you already have PostgreSQL 16 installed.**

MERN is not *wrong*; it would work. But the shape of this specific data pushes hard toward a
relational database, and the one advantage Mongo would have given us (flexible/dynamic fields)
is fully covered by PostgreSQL's `JSONB` type.

### Why PostgreSQL over MongoDB *for this project*

| Requirement in the brief | Why Postgres wins |
| --- | --- |
| Stock in/out log, balance must always be correct | Stock movement + balance update must be **one atomic transaction**. Postgres gives real ACID transactions across tables by default. A wrong balance on a medical inventory is a safety problem, not a bug. |
| Item ↔ lot ↔ movement ↔ team ↔ user ↔ vehicle relations | These are genuinely relational. In Mongo you either duplicate data (and it drifts) or you do manual joins in application code. Postgres does them in one query. |
| "Summary log", thresholds, statistics dashboards | Aggregation over joins is SQL's home turf. `GROUP BY`, window functions, `SUM(CASE WHEN ...)` — all one query, no map/reduce. |
| Expiry tracking + "warn me what is low/expiring" | Date range queries with indexes; trivial in SQL. |
| Dynamic fields set by the super admin | `JSONB` columns + GIN indexes. We get Mongo's flexibility **where we want it** (form definitions, form answers, custom item attributes) while keeping strict integrity everywhere else. |
| Audit log / who changed what | Foreign keys guarantee the audit trail can never point at a deleted-but-not-really user. |
| You already run PostgreSQL 16 locally | Zero setup friction; same engine local and in production. |

### The chosen stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Database | **PostgreSQL 16** | See above. Already installed. |
| ORM / migrations | **Prisma** | One readable `schema.prisma` file is the single source of truth for the whole data model. Generates a typed client, and `prisma migrate` gives us versioned, reviewable SQL migrations — important when a future volunteer takes this over. |
| API | **Node.js + Express 4** | Small, boring, extremely well documented. Easy for the next maintainer. |
| Validation | **Zod** | One schema validates the request *and* documents it. Used by a single generic `validate()` middleware — no repeated `if (!req.body.x)` checks anywhere. |
| Auth | **JWT access token (short) + rotating refresh token (httpOnly cookie)** | Access token stays in memory on the client (not localStorage → immune to XSS token theft); refresh token is httpOnly + SameSite so JS cannot read it. |
| 2FA | **TOTP (`otplib`) + QR (`qrcode`)** | Works with Google Authenticator / Microsoft Authenticator / Authy. No SMS cost. Backup codes included. |
| Email | **Nodemailer** with a pluggable transport | Local = Ethereal (fake inbox, prints a preview URL). Production = Brevo/Resend SMTP, both have free tiers. |
| Frontend | **React 18 + Vite** | Vite gives instant dev reload and a tiny static build that hosts free anywhere. |
| Routing / data | **React Router 6 + TanStack Query** | TanStack Query removes ~all hand-written loading/error/caching code — a large source of repetition. |
| Styling | **Tailwind CSS** | Utility classes keep the LRC palette in one config file; responsive (mobile + laptop) is built into the class names, which matters because EMTs will fill reports on a phone. |
| Forms | **React Hook Form + Zod** | The *same* Zod schemas can be shared with the API, so validation rules are written once. |
| i18n | **i18next** | The report form is bilingual EN/AR and Arabic needs RTL. Handled centrally, not per-component. |

### What we are deliberately NOT doing (and why)

- **No TypeScript on day one.** You asked for heavily commented, readable code that you can keep
  working on. TS would be the "correct" answer for a team, but it doubles the friction for a solo
  maintainer. We compensate with Zod (runtime validation at every boundary), JSDoc comments, and
  Prisma's generated client which gives editor autocomplete in plain JS anyway.
  *The folder layout is TS-ready if you ever want to migrate.*
- **No microservices.** One API process. This app will serve tens of concurrent users, not
  thousands. A modular monolith is the right size and costs the least to host.
- **No GraphQL.** REST + pagination is simpler to secure, cache and rate-limit.
