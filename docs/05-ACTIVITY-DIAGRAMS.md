# 05 — Activity diagrams

Mermaid diagrams — they render directly on GitHub and in most Markdown viewers.

---

## 1. Onboarding a new volunteer

Note that **no password ever travels by email.** A password sent by email lives
in an inbox forever, is often reused elsewhere, and cannot be revoked. The
invitation carries a single-use token instead, and the person chooses their own
password on a page only that token can open.

```mermaid
flowchart TD
    A([Super admin opens People]) --> B[Fills in email, name, role, teams]
    B --> C{Creating another<br/>super admin?}
    C -->|yes| D{Is the caller<br/>a super admin?}
    D -->|no| E[/403 SUPER_ADMIN_ONLY/]
    D -->|yes| F
    C -->|no| F[Check the email is free]
    F --> G{Account already<br/>ACTIVE?}
    G -->|yes| H[/409 EMAIL_IN_USE<br/>suggest a password reset/]
    G -->|no| I[Revoke any older<br/>pending invitation]
    I --> J[Store the token HASH only<br/>+ role, teams, expiry]
    J --> K[Send the invitation email]
    K --> L([Volunteer clicks the link])

    L --> M{Token valid,<br/>unused, unexpired?}
    M -->|no| N[/Explain and offer<br/>to request a new one/]
    M -->|yes| O[Show name and role<br/>for confirmation]
    O --> P[Volunteer chooses<br/>their own password]
    P --> Q{Meets the<br/>policy?}
    Q -->|no| P
    Q -->|yes| R[[TRANSACTION:<br/>create user + memberships<br/>+ mark invitation accepted]]
    R --> S[Sign in immediately]
    S --> T([Dashboard])
    T --> U[Prompt to enrol 2FA]
```

---

## 2. Signing in

```mermaid
flowchart TD
    A([Enter email + password]) --> B{Rate limited?<br/>10 fails / 15 min<br/>per IP + email}
    B -->|yes| C[/429 Too many attempts/]
    B -->|no| D{Account locked?<br/>5 fails}
    D -->|yes| E[/429 with minutes remaining/]
    D -->|no| F[Verify the password hash]

    F -->|wrong| G[Increment the counter<br/>and audit the failure]
    G --> H[/401 'Incorrect email or password'/]
    H -.->|deliberately the SAME message<br/>for an unknown email| A

    F -->|correct| I{Account status}
    I -->|INVITED| J[/403 Accept your invitation first/]
    I -->|SUSPENDED| K[/403 Contact the super admin/]
    I -->|ACTIVE| L[Clear the failure counter]

    L --> M{2FA enabled?}
    M -->|no| Q
    M -->|yes| N[Issue a 5-minute MFA token<br/>carrying NO permissions]
    N --> O([Enter the 6-digit code])
    O --> P{Valid TOTP<br/>or backup code?}
    P -->|no| R[/401 — max 8 attempts/]
    P -->|backup code| S[Consume it: single use]
    S --> Q
    P -->|TOTP| Q[Issue the session]

    Q --> T[Access token, 15 min, in memory]
    Q --> U[Refresh token, 30 days,<br/>httpOnly cookie, hashed in the DB]
    T --> V([Signed in])
    U --> V
```

**Why the access token is not in `localStorage`:** any successful XSS can read
it in one line. A variable in a module closure cannot be reached that way, and
the httpOnly refresh cookie restores the session after a reload — so nothing is
lost.

---

## 3. Filling and acting on an equipment report

This is the loop the whole system exists for.

```mermaid
flowchart TD
    subgraph Setup["Before the shift"]
        A1[Super admin publishes<br/>the form + thresholds]
        A2[Team admin creates<br/>the shift assignment]
    end

    subgraph Shift["During the shift"]
        B1([EMT opens 'Fill a report']) --> B2[Choose vehicle, team, date]
        B2 --> B3{Assigned to this<br/>vehicle on this date?}
        B3 -->|no| B4[/403 NOT_ASSIGNED/]
        B3 -->|yes| B5[Load the newest<br/>PUBLISHED version]
        B5 --> B6[Answer, section by section]
        B6 --> B7[[Autosave as DRAFT<br/>every 5 seconds]]
        B7 --> B6
        B6 --> B8([Submit])
    end

    subgraph Server["On submit"]
        C1[Drop any answer key<br/>the form does not define]
        C1 --> C2{All required<br/>questions answered?}
        C2 -->|no| C3[/422 with the field keys —<br/>the UI jumps to the first/]
        C3 --> B6
        C2 -->|yes| C4[[Threshold engine:<br/>grade every answer and grid row]]
        C4 --> C5[Store answers + the computed<br/>summary + counts]
        C5 --> C6[Audit the submission]
    end

    subgraph After["After the shift"]
        D1([Team admin opens the Day board])
        D1 --> D2[Every vehicle, including<br/>those with NO report]
        D2 --> D3{Card status}
        D3 -->|MISSING| D4[Chase the crew]
        D3 -->|CRITICAL / WARN| D5[Open the shortage list]
        D3 -->|OK| D6[Nothing to do]
        D5 --> D7[Issue stock OUT<br/>to restock the vehicle]
        D7 --> D8[Mark the report reviewed]
    end

    A1 --> B5
    A2 --> B3
    B8 --> C1
    C6 --> D1
```

**The summary is computed once, at submit time, and stored.** So when the super
admin raises an expected quantity next month, last week's report still reads
against the rules that applied on the day it was filed. Recomputing on read
would silently rewrite history.

---

## 4. Recording a stock movement

```mermaid
flowchart TD
    A([Record stock in / out]) --> B{Direction}
    B -->|ADJUST| C{Has<br/>movement:adjust?}
    C -->|no| D[/403 — correcting a balance is<br/>a bigger deal than a receipt/]
    C -->|yes| E
    B -->|IN or OUT| E[Load the item]

    E --> F{Item tracks size?}
    F -->|yes, none given| G[/400 SIZE_REQUIRED/]
    F -->|yes, invalid| H[/400 INVALID_SIZE/]
    F -->|no| I[Force size to null<br/>so one item = one lot]
    F -->|yes, valid| J
    I --> J{Tracks expiry<br/>and direction = IN?}
    J -->|yes, no date| K[/400 EXPIRY_REQUIRED/]
    J -->|otherwise| L[Find or create the lot<br/>item + size + batch + expiry]

    L --> M{Direction = OUT<br/>and no lot exists?}
    M -->|yes| N[/400 NO_STOCK/]
    M -->|no| O[Compute the new balance]

    O --> P{Would it go<br/>negative?}
    P -->|yes| Q[/409 INSUFFICIENT_STOCK<br/>reports what IS available/]
    P -->|no| R[[ONE TRANSACTION:<br/>write the movement<br/>+ update the lot balance]]

    R --> S[Audit it]
    S --> T([Done — balance visible immediately])
```

**The invariant:** `StockLot.quantityOnHand` always equals the sum of that lot's
movements. It is a cache of the ledger, and it is only trustworthy because both
writes happen in the same transaction. Nothing outside `inventory.service.js`
may write it.

Movements are **immutable** — no edit, no delete. A mistake is corrected with a
compensating `ADJUST` row, so the ledger always explains itself.

---

## 5. How a permission decision is made

Two separate questions, and keeping them separate is the core of the design.

```mermaid
flowchart TD
    A([Request arrives]) --> B{Bearer token present?}
    B -->|no| C[/401 NO_TOKEN/]
    B -->|yes| D[Verify the signature]
    D -->|expired| E[/401 TOKEN_EXPIRED<br/>client silently refreshes once/]
    D -->|valid| F[Re-read the user<br/>from the database]

    F --> G{Still exists<br/>and ACTIVE?}
    G -->|no| H[/401 or 403 — a suspended account<br/>stops working immediately/]
    G -->|yes| I["Effective permissions =<br/>role ∪ granted − denied"]

    I --> J{mustChangePassword?}
    J -->|yes, and not an<br/>allow-listed path| K[/403 PASSWORD_CHANGE_REQUIRED/]
    J -->|no| L{Super admin?}

    L -->|yes| M[Allow — always]
    L -->|no| N{Holds the required<br/>permission?}
    N -->|no| O[/403 naming the missing permission/]
    N -->|yes| P{Does the endpoint<br/>read records?}

    P -->|no| Q([Handler runs])
    P -->|yes| R[Build the SCOPE filter]
    R --> S{Scope}
    S -->|read.all| T[no restriction]
    S -->|read.team| U[teams I lead, plus my own]
    S -->|read.own| V[only mine]
    T --> W[[Spread into the SQL WHERE<br/>BEFORE any user filter]]
    U --> W
    V --> W
    W --> Q
```

**Why permissions are re-read on every request** rather than embedded in the
JWT: if the super admin revokes someone's access, an embedded list would keep
working until the token expired. For a system whose entire purpose is that the
super admin is in charge, "revocation takes effect now" is worth one indexed
lookup.

**Why scope is a `WHERE` clause** and not a filter after loading: an
out-of-scope row is never selected, so it cannot leak through a forgotten check.
And an out-of-scope id returns **404, not 403** — a 403 would confirm the record
exists, which itself tells a team admin something about another team.

---

## 6. Publishing a change to the report form

```mermaid
flowchart TD
    A([Super admin edits the form]) --> B{Current status}

    B -->|DRAFT| C[Edit in place]
    C --> D[Replace sections and fields]

    B -->|PUBLISHED| E[[Fork to version N+1<br/>as a new DRAFT]]
    E --> F[The published version<br/>keeps serving crews]
    F --> G[The API returns the NEW id —<br/>the builder follows it]

    D --> H([Ready to publish])
    G --> H

    H --> I{Has at least<br/>one question?}
    I -->|no| J[/400 TEMPLATE_EMPTY/]
    I -->|yes| K[[ONE TRANSACTION:<br/>archive the old published version<br/>+ publish this one]]

    K --> L[Crews now get the new version]
    K --> M[Past submissions still point at<br/>the version they were filled with]

    M --> N([History reads correctly, forever])
```

Without versioning, raising "expected tourniquets" from 2 to 4 would turn every
past report red retroactively — reports that were correct on the day they were
filed. The transaction matters too: it guarantees there is never a moment with
two published versions of the same form, or none.
