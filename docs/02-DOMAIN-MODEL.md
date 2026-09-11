# 02 — Domain Model

Everything in the brief collapses into **four concerns**. Getting this grouping right is what
stops the code from becoming repetitive later.

```
1. IDENTITY & ACCESS   who you are, what you may do, and over which slice of data
2. ORG STRUCTURE       teams (= the day squads), vehicles / ER room, shift assignments
3. INVENTORY ENGINE    ONE engine serving BOTH "clothes" and "EMT gadgets"
4. DYNAMIC FORMS       the equipment report: template -> submission -> threshold summary
```

---

## 1. Identity & Access

### The insight

You described three *kinds* of people (super admin, several flavours of admin, normal user) but
also said the super admin must be able to invent new access combinations from the dashboard.
Hard-coding three roles would therefore be wrong.

So: **roles are data, permissions are a fixed catalogue in code.**

- `Permission` — a fixed list of strings defined in `server/src/config/permissions.js`
  (e.g. `inventory.movement:create`). Fixed *because every string must correspond to real code
  that enforces it*. Letting the UI invent new permission strings would create permissions that
  guard nothing — a security illusion.
- `Role` — a **database row** the super admin creates freely, holding an array of permission
  strings. "Clothing Officer", "Monday Team Leader", "Equipment Auditor" are all just rows.
- `User.extraPermissions` / `User.deniedPermissions` — per-person **grant** and **deny** overrides
  on top of their role. This is your *"giving access to different things, denying them"* — you can
  hand one person a single extra ability without inventing a whole new role.

**Effective permissions** = `role.permissions ∪ user.extraPermissions − user.deniedPermissions`

Computed in exactly one place (`services/access.service.js`). **Deny always wins.**
`user.isSuperAdmin = true` short-circuits every check to *allow*; there is always at least one.

### Data scope — the "this date only" requirement

A permission answers *"may you read equipment reports?"*. It does **not** answer *"whose
reports?"*. That second question is the **scope**, encoded as the permission string's suffix:

| Permission | Meaning |
| --- | --- |
| `submission:read.own` | only reports I personally submitted (normal EMT / FR) |
| `submission:read.team` | only reports for teams where I am `TEAM_ADMIN` |
| `submission:read.all` | everything (station-wide auditor / super admin) |

The API turns this into a **mandatory SQL `WHERE` clause** built by `buildSubmissionScope()`.
Scope is applied in the data layer, never in the UI — hiding a button is not security.

### Tables

| Table | Purpose |
| --- | --- |
| `User` | login, profile, 2FA secret, lockout counters, locale, `mustChangePassword` |
| `Role` | named permission bundles, editable by the super admin |
| `Invitation` | emailed one-time token; the user sets their own password on accept |
| `RefreshToken` | one row per device/session; rotated on use, revocable → real "log out everywhere" |
| `PasswordResetToken` | forgot-password flow |
| `AuditLog` | actor, action, entity, before/after JSONB, ip, user agent |

---

## 2. Org structure

| Table | Purpose |
| --- | --- |
| `Team` | "Monday Team" (`dayOfWeek = 1`). The unit an admin is scoped to. |
| `TeamMembership` | user ↔ team, with `teamRole` = `MEMBER` or `TEAM_ADMIN` |
| `Vehicle` | `470`…`475` and the ER Room. `kind` = `AMBULANCE` or `ER_ROOM`. |
| `Assignment` | *(team, vehicle, shiftDate, firstPerson, secondPerson)* — "you are on 472 today". Drives which report a user may open. |

---

## 3. Inventory engine — one engine, two catalogues

Clothing tracking and EMT-gadget tracking are **the same problem** with different flags:

| Your words | Modelled as |
| --- | --- |
| "clothes inventory … the sizes can be custom" | `Item.trackSize = true`, `Item.sizes = ['S','M','L','XL','42','44']` — free text, per item |
| "batches expiry not on items only" — your spreadsheet's `Track Expiry? YES/NO` column | `Item.trackExpiry` boolean. That column *is* the field. |
| "in and out … and also the date given" | `StockMovement.direction` + `StockMovement.movementDate` (user-chosen, **not** `createdAt`) |
| "a summary log for the in and out" | Paginated, filterable query over `StockMovement` |
| "super admin can change the field and tracked section" | `ItemAttributeDef` rows define extra per-category fields; values live in `Item.attributes` (JSONB) |

### Tables

| Table | Purpose |
| --- | --- |
| `ItemCategory` | `CLOTHING`, `MEDICAL_EQUIPMENT`, … — the super admin can add more |
| `ItemAttributeDef` | dynamic extra fields for a category (label EN/AR, type, options, required) |
| `Item` | the item list: `nameEn/nameAr`, `unit`, `trackExpiry`, `trackSize`, `sizes[]`, `lowStockThreshold`, `attributes` JSONB |
| `StockLot` | **the balance line.** One row per *(item, size, batchNumber, expiryDate)* holding `quantityOnHand`. An item with `trackSize=false, trackExpiry=false` simply has one lot with nulls. |
| `StockMovement` | the immutable ledger: `IN` / `OUT` / `ADJUST`, quantity, `movementDate`, counterparty (person/team), reason, note, who recorded it |

**Rule enforced in code:** a movement and its lot-balance update happen inside one
`prisma.$transaction`. Movements are never edited or deleted — a mistake is corrected with a
compensating `ADJUST` movement, so the ledger stays auditable.

Because it is one engine, the clothing screens and the equipment screens are the *same React
components* driven by a category key. Zero duplication.

---

## 4. Dynamic forms — the equipment report

Your Google Form is the specification. Reading through it, every question is one of six shapes:

| Shape | Example from your form | Field `type` |
| --- | --- | --- |
| Pick one number | "Portable Stretcher: 0 / 1" | `NUMBER_CHOICE` |
| **Matrix of rows × counts** | "Airways: Blue/Red/Yellow/Green/White × 0/1/2" | `GRID` |
| Pick one option | "Betadine Content: Empty→Quarter / …" | `SINGLE_SELECT` |
| Free number | "Oxygen Pressure" | `NUMBER` |
| Free text | "First Assigned Person" | `TEXT` |
| Yes / No | — | `BOOLEAN` |

`GRID` is the important one — a large part of your form is matrices, and modelling those as
"many separate questions" would make the form builder unusable and the mobile view unreadable.

### Tables

| Table | Purpose |
| --- | --- |
| `FormTemplate` | `titleEn/titleAr`, `scope` (`AMBULANCE` / `ER_ROOM`), `version`, `status` (`DRAFT` / `PUBLISHED` / `ARCHIVED`) |
| `FormSection` | "Transport Equipment", "Trauma Bag", … ordered |
| `FormField` | `key`, `labelEn/labelAr`, `type`, `required`, `order`, `config` JSONB |
| `FormSubmission` | template **version snapshot**, team, vehicle, `shiftDate`, submitter, `answers` JSONB, `summary` JSONB, `status` |

### Thresholds — "dynamic, decided by the super admin"

Each field — and each **row** of a `GRID` — carries in its `config`:

```jsonc
{
  "expected": 2,      // what should be on the vehicle
  "warnBelow": 2,     // amber if the reported count is under this
  "criticalBelow": 1  // red if under this
}
```

On submit, `services/threshold.service.js` compares every answer against these numbers and writes
a `summary` onto the submission:

```jsonc
{
  "counts": { "ok": 118, "warn": 6, "critical": 3 },
  "issues": [
    { "field": "airways", "row": "red", "label": "Airways — Red",
      "value": 0, "expected": 2, "severity": "critical" }
  ]
}
```

The team admin's screen renders `summary.issues` directly — **"what is missing" is a pre-computed
list, not something the browser recalculates.** Two benefits: the mobile view stays fast, and the
historical record shows the thresholds *as they were on that day* even if the super admin changes
them later.

### Versioning

Publishing a template freezes it. Editing a published template creates **version N+1**; existing
submissions keep pointing at the version they were filled with. Without this, changing a threshold
would silently rewrite history.

---

## How a normal shift flows

```
super admin  ──creates──►  Teams (Mon…Sun), Vehicles 470-475 + ER Room, Roles
             ──publishes─►  FormTemplate "Ambulance Equipment Report v3"  (+ thresholds)
             ──invites───►  users by email  ──►  they accept, set a password, enrol 2FA

team admin   ──creates──►  Assignment (Monday, 472, 2026-09-14, Ali + Sara)

EMT (Ali)    ──opens────►  his assignment  ──fills──►  FormSubmission  ──submits──►
                                                       threshold engine computes summary

team admin   ──sees─────►  Monday 2026-09-14 board: 6 vehicles, red/amber badges,
                           "Airways — Red: 0 of 2"  ──►  issues stock OUT from inventory
                           to restock the vehicle   ──►  StockMovement recorded
```
