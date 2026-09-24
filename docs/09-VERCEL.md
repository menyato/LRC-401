# 09 — Deploying on Vercel

An alternative to the Render setup in [08-DEPLOYMENT.md](08-DEPLOYMENT.md). Same
database (Neon), same email; only the host differs.

---

## How it runs on Vercel

```
  browser ──https──►  lrc401.vercel.app
                        ├── /assets, /index.html …  static files from client/dist (CDN)
                        └── /api/*                  one Vercel Function: api/index.mjs
                                                    → the same Express app as `npm start`
                                                    → Neon PostgreSQL (pooled)
```

Everything is on **one domain**, so the refresh cookie stays first-party. The
configuration is all in [`vercel.json`](../vercel.json):

- **Build:** installs `client/` and `server/`, builds the React app, and generates
  the Prisma client.
- **Region:** London (`lhr1`), next to the Neon database (eu-west-2). If you move the database, move this too.
- **Branches:** only `staging` deploys to this project. `dev` and `production` are
  switched off with `git.deploymentEnabled`, so everyday work on `dev` never
  touches the demo.
- **Security headers:** a strict Content-Security-Policy, `frame-ancestors 'none'`
  and HSTS on the static pages. Helmet sets the same on `/api`.

### Trade-offs compared to Render

| | Vercel | Render |
| --- | --- | --- |
| Cold start | ~1–2 s | ~40 s on the free plan |
| Rate limiters | Count **per function instance**, so they are weaker | One process, exact |
| Login brute force | Still stopped: the account lockout after `MAX_FAILED_LOGINS` is stored in the database | Same |
| Migrations | Run from your laptop | Run automatically at start |

The rate limiter gap is acceptable for a demo. Before production with real
volunteers, either move to Render or add a shared store (Upstash Redis via
`rate-limit-redis`).

---

## Step by step

### 1. Secrets

```powershell
npm run secrets
```

This prints four random values. **Save `TOTP_ENC_KEY` in a password manager
now.** If it is lost or changed later, everyone who enabled 2FA is locked out.
Generate a separate set for each environment.

### 2. Database (Neon)

1. <https://neon.tech> → New project → region **Frankfurt** → database `lrc401`.
2. Copy **both** connection strings:
   - **Pooled** (host contains `-pooler`): for Vercel. Add `&pgbouncer=true` at the end.
   - **Direct**: for running migrations from your laptop.
3. Create the tables and the main account (PowerShell, using the **direct** string):

```powershell
$env:DATABASE_URL = "<direct string>"
$env:SEED_SUPERADMIN_EMAIL = "afannouni@gmail.com"
$env:SEED_SUPERADMIN_PASSWORD = "<a strong first password>"   # changed at first sign-in
$env:SEED_SUPERADMIN_NAME = "Abdallah Fannouni"
npm --prefix server run db:deploy
npm --prefix server run db:seed
Remove-Item Env:DATABASE_URL, Env:SEED_SUPERADMIN_PASSWORD
```

### 3. Vercel project

1. <https://vercel.com/new> → import `menyato/LRC-401`.
   - Framework preset: **Other**. Leave the root directory as `./`.
     `vercel.json` supplies the build commands.
2. **Settings → Environments → Production → Branch Tracking:** set the branch to
   **`staging`**. GitHub's default branch is `dev`, and `dev` is switched off
   for deployments, so without this nothing deploys.
3. **Settings → Environment Variables** (scope: **Production**):

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `CLIENT_URL` | `https://<your-project>.vercel.app`, exactly as shown under Domains, with no trailing slash |
| `DATABASE_URL` | the **pooled** Neon string + `&pgbouncer=true` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `JWT_MFA_SECRET` / `TOTP_ENC_KEY` | from step 1 |
| `EMAIL_TRANSPORT` | `smtp` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `SMTP_USER` | `afannouni@gmail.com` |
| `SMTP_PASS` | the Gmail **App Password** (16 characters, no spaces) |
| `EMAIL_FROM` | `LRC Saida 401 <afannouni@gmail.com>` |
| `LOG_LEVEL` | `info` |

Leave `SERVE_CLIENT` unset: on Vercel the static files are served by Vercel itself.

4. **Deployments → Redeploy** so the new variables take effect. Environment
   variables are only read at deploy time.

### 4. Check it

- [ ] `https://<project>.vercel.app/api/health` shows `"status":"ok"`
- [ ] Sign in as `afannouni@gmail.com` and set a new password when asked
- [ ] Reload the page and you stay signed in
- [ ] Invite a second address; the email arrives from afannouni@gmail.com
- [ ] Enrol 2FA with an authenticator app, sign out, sign back in

### If something fails

| Symptom | Cause |
| --- | --- |
| Every `/api` call returns 500 and the function log says "Invalid environment configuration" | A variable is missing or weak. The log names it. |
| Sign-in shows "Origin not allowed" | `CLIENT_URL` does not match the address in the browser bar exactly |
| "prepared statement … already exists" | `&pgbouncer=true` is missing from `DATABASE_URL` |
| Emails do not arrive | Run `npm --prefix server run email:test -- you@x.com` locally with the same SMTP values; check spam |
| A push to `staging` did not deploy | Production Branch Tracking is not set to `staging` (step 3.2) |
