# 04 — Launch roadmap

Where the project stands, what has to happen before real volunteer data goes in,
and what it costs to run.

---

## Part 1 — Current state

| Area | State |
| --- | --- |
| Database schema | **Done.** 20 models, 2 migrations applied |
| API | **Done.** 12 modules, 57/57 end-to-end tests passing |
| Web app | **Built and running.** Every route implemented, compiles clean |
| Seed data | **Done.** Your 85-question form, 57 items, 7 teams, 7 vehicles |
| Security | **Done.** 2FA, rotating refresh tokens, RBAC, rate limits, audit log |
| Bilingual EN/AR + RTL | **Done** throughout |
| Mobile layout | **Done.** Tables become cards below 640px, 44px touch targets |
| Deployment | **Not started** — this document |
| Real email delivery | **Not started** — currently prints to the terminal |
| CSV export | **Not built** |
| Automated backups | **Not set up** |

---

## Part 2 — Before real data goes in

These are not optional. Each one is a way to lose data or leak it.

### 2.1 Rotate every secret

The values in `server/.env` were generated on your laptop and have been on
screen during development. Generate fresh ones for production:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # x3, for the JWT secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # TOTP_ENC_KEY — exactly 64 hex chars
```

> **`TOTP_ENC_KEY` can never be changed afterwards** without destroying every
> 2FA enrolment. Set it once, and store it somewhere you will still have in two
> years.

### 2.2 Change the seeded admin password

`admin@lrc401.local` / `ChangeMe!2026` is in this repository. Before launch:
create a real super admin with a real email address, sign in as them, and
suspend the seeded one.

### 2.3 Turn on real email

Invitations are the only way people join. With `EMAIL_TRANSPORT=console` they
are never delivered.

Recommended: **Brevo** (300 emails/day free, no card required) or **Resend**
(3 000/month free).

```env
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<your smtp login>
SMTP_PASS=<your smtp key>
EMAIL_FROM="LRC Saida 401 <no-reply@yourdomain.org>"
```

Add SPF and DKIM records for the sending domain, or invitations will land in
spam and nobody will be able to join.

### 2.4 Set up backups

A volunteer roster and a year of equipment history are not recreatable. Neon and
Supabase both keep automatic point-in-time backups on their free tiers — confirm
it is enabled, and **test a restore once** before you rely on it.

Also take your own periodic dump:

```powershell
pg_dump "$env:DATABASE_URL" -Fc -f "lrc401-$(Get-Date -f yyyy-MM-dd).dump"
```

### 2.5 Review the thresholds

The expected quantities in the seeded form are **informed guesses** made from
reading your Google Form (a question offering 0/1 almost certainly expects 1).
Go through the form builder with someone who knows the vehicles and correct
them before the first shift, or the first week of reports will be full of false
red flags — and people stop reading a dashboard that cries wolf.

---

## Part 3 — Hosting

### The recommended stack (starts free)

| Layer | Service | Free tier | Paid when you outgrow it |
| --- | --- | --- | --- |
| Database | **Neon** (PostgreSQL) | 0.5 GB, auto-suspend, PITR backups | $19/mo |
| API | **Render** web service | 750 h/mo, sleeps after 15 min idle | $7/mo (no sleep) |
| Web app | **Cloudflare Pages** | unlimited static bandwidth | free indefinitely |
| Email | **Brevo** | 300/day | $9/mo |
| Domain | Namecheap / Cloudflare | — | ~$10/year |

**Realistic total: $0/month to start; ~$7/month to remove the cold start.**

### The one thing to know about the free API tier

Render's free plan sleeps after 15 minutes of inactivity, and the next request
takes 30–50 seconds to wake it. For a station where someone opens the app at
07:00 to check a vehicle, that first-load delay is genuinely annoying.

Options:
- **$7/month** on Render removes it entirely — the honest recommendation.
- **Fly.io** has a smaller always-on allowance that may fit within free credit.
- A free uptime pinger (UptimeRobot every 10 min) keeps it warm, at the cost of
  burning the 750 monthly hours faster.

### Why not Vercel for the API

Vercel's serverless functions open a new database connection per invocation,
which exhausts a free Postgres connection pool quickly. Prisma also has a slower
cold start there. A long-running Node process (Render/Fly/Railway) is the right
shape for this app.

---

## Part 4 — Deployment steps

### 4.1 Database (Neon)

1. Create a project, region **Frankfurt** or **Paris** — lowest latency to Lebanon.
2. Copy the pooled connection string.
3. Apply the schema from your machine:

```powershell
$env:DATABASE_URL="postgresql://...neon..."
npm --prefix server run db:deploy     # applies migrations; does NOT reset
npm --prefix server run db:seed
```

`db:deploy`, not `db:migrate` — `migrate dev` can prompt to reset the database,
which must never be possible against production.

### 4.2 API (Render)

- New **Web Service**, connect the repository, root directory `server`
- Build: `npm install && npx prisma generate`
- Start: `npm start`
- Health check path: `/api/health`
- Environment variables:

```env
NODE_ENV=production
PORT=10000
CLIENT_URL=https://lrc401.pages.dev      # or your domain — used for CORS and email links
DATABASE_URL=<neon pooled string>
JWT_ACCESS_SECRET=<fresh>
JWT_REFRESH_SECRET=<fresh, different>
JWT_MFA_SECRET=<fresh, different again>
TOTP_ENC_KEY=<fresh 64 hex chars>
EMAIL_TRANSPORT=smtp
SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASS=...
EMAIL_FROM="LRC Saida 401 <no-reply@yourdomain.org>"
LOG_LEVEL=info
```

The server **refuses to start** if any secret is missing, weak, duplicated, or
still the placeholder — and in production it additionally rejects
`EMAIL_TRANSPORT=console` and a non-HTTPS `CLIENT_URL`. A boot failure with a
clear message is the intended behaviour; a server that starts insecurely is not.

### 4.3 Web app (Cloudflare Pages)

- Root directory `client`, build `npm run build`, output `dist`
- Add a redirect so client-side routing works on refresh — create
  `client/public/_redirects`:

```
/api/*  https://your-api.onrender.com/api/:splat  200
/*      /index.html                               200
```

The first line makes the API same-origin in production too, exactly as the Vite
proxy does locally. That keeps the refresh cookie first-party — **this is the
single most common thing that breaks between local and production**, because a
cross-site cookie gets dropped and users are logged out on every reload.

### 4.4 Post-deploy checklist

- [ ] `https://your-api.onrender.com/api/health` returns `ok`
- [ ] Sign in works, and the session **survives a page refresh** (proves the cookie is first-party)
- [ ] Send a real invitation to your own address and accept it
- [ ] Enrol 2FA on a phone and sign in with it
- [ ] File one report on a phone, on mobile data, in both English and Arabic
- [ ] Confirm HTTPS everywhere and that the API rejects a request from an unknown origin
- [ ] Take one manual `pg_dump` and confirm it restores

---

## Part 5 — After launch

### Immediately valuable
1. **CSV export** for reports and stock movements — the first thing anyone will ask for.
2. **A shortage digest email** to team admins each morning. The threshold data already exists; only the scheduled job is missing.
3. **Token cleanup job.** `pruneExpiredTokens()` is written but nothing calls it yet — a daily cron keeps the table from growing forever.

### Worth doing next
4. **Photo attachments** on reports (a cracked splint is easier shown than described). Cloudflare R2 has a generous free tier.
5. **Offline drafts.** The basement of an ER has no signal. Saving to IndexedDB and syncing later is the single biggest usability win available.
6. **Arabic review** by a native speaker. The Arabic in the seed came from your own form where possible, but some strings are mine and should be checked.

### Later
7. Barcode scanning for stock movements.
8. Per-vehicle equipment history charts.
9. A real test framework (Vitest) if the team grows — the current smoke test is the right size for one or two maintainers.

---

## Part 6 — Handing it over

The three files a future maintainer should read, in order:

1. `docs/01-STACK-DECISION.md` — why PostgreSQL, why not MERN
2. `docs/02-DOMAIN-MODEL.md` — how the four concerns fit together
3. `server/prisma/schema.prisma` — the single source of truth for the data

The code is commented throughout with *why*, not *what*. The permission
catalogue (`server/src/config/permissions.js`) is the map of what the system can
do; the route index (`server/src/routes.js`) is the map of its whole surface.
