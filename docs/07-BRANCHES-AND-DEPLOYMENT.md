# 07 — Branches and deployment

Three branches, three environments, one direction of travel.

```
   dev  ──────►  staging  ──────►  production
    │               │                  │
 you work      the station        the real thing
   here        tries it here      volunteers use
```

| Branch | Purpose | Database | Who sees it |
| --- | --- | --- | --- |
| `dev` | Day-to-day work. Broken states are fine here. | your local `lrc401` | you |
| `staging` | A real deployment with real-shaped data, for the station to try before it counts. | a separate staging database | you + whoever is testing |
| `production` | What the station actually runs on. | the live database | every volunteer |

**Nothing is ever committed directly to `production`.** Changes flow
`dev → staging → production`, and each step is a merge of something that has
already been seen working one level down.

---

## Why three and not two

Two branches (`dev` → `production`) is a common setup and it would half-work
here. The reason it is not enough:

The people who will find the real problems in this system are volunteers using
it on a phone in a garage, and the problems they find will be about **the
station's actual data** — "our 474 doesn't carry a Matlat", "this threshold is
wrong", "nobody understands this label". You cannot discover that on your
laptop, and you must not discover it on the system the station depends on.

`staging` is where that happens: a real deployment they can actually use,
against a database that is not the one holding the real equipment records.

---

## The rules

1. **`dev` is where you commit.** Small, frequent commits. It is allowed to be
   broken between them.
2. **`staging` only ever receives merges from `dev`**, and only when the tests
   pass:
   ```powershell
   npm --prefix server test          # 116 tests must be green
   npm --prefix server run typecheck
   npm run lint
   ```
3. **`production` only ever receives merges from `staging`**, and only after
   somebody at the station has actually used the staging deployment.
4. **A hotfix is still a branch.** Branch from `production`, fix, merge back to
   `production` AND down into `staging` and `dev` — otherwise the next release
   silently reverts the fix. That last step is the one people forget.

---

## Day-to-day

```powershell
# Work
git checkout dev
# ...make changes...
git add -A
git commit -m "What changed and why"
git push

# Promote to staging, once the tests are green
git checkout staging
git merge dev
git push
# ...the station tries it...

# Promote to production
git checkout production
git merge staging
git push

# Back to work
git checkout dev
```

---

## Branch protection (do this on GitHub)

**Settings → Branches → Add rule**, for `production`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass (once CI is set up)
- ✅ Do not allow bypassing the above
- ❌ Allow force pushes — leave OFF

The point is not bureaucracy. It is that `git push --force` to `production` at
2am, on the branch an ambulance station depends on, should not be one typo away.

Apply a lighter version to `staging` (require a PR, allow yourself to merge it).
Leave `dev` unprotected — it is your workspace.

---

## Environment per branch

Each environment needs its **own** `server/.env`. They must not share a
database, and they must not share secrets.

| Variable | dev | staging | production |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | `production` |
| `DATABASE_URL` | local `lrc401` | a separate staging database | the live database |
| `CLIENT_URL` | `http://localhost:5173` | the staging URL | the real domain |
| `EMAIL_TRANSPORT` | `console` | `smtp` (to a test inbox) | `smtp` |
| JWT secrets | dev values | **fresh** | **fresh, different again** |
| `TOTP_ENC_KEY` | dev value | **fresh** | **fresh — and never changed after** |

> **Staging must not send email to real volunteers.** Point `EMAIL_TRANSPORT`
> at a test inbox, or a staging invitation will land in a real person's inbox
> and they will try to use it.

> **`TOTP_ENC_KEY` can never be changed once production has real users.** It
> encrypts their two-factor secrets; changing it makes every enrolment
> unreadable and locks out everyone who has 2FA on.

Migrations run per environment with `npm run db:deploy` (never `db:migrate`,
which can offer to reset the database).

Full hosting setup is in [04-LAUNCH-ROADMAP.md](04-LAUNCH-ROADMAP.md).
