# AuraPMS — From Prototype to Product

**Architecture review and build plan**

| | |
|---|---|
| Repo | `KaushikVipransh/AURA-PMS` |
| Reviewed at | `main` @ `6b54be4` |
| Date | 10 August 2026 |
| Stack | React 19 · Vite 8 · Express 5 · Mongoose 9 · MongoDB Atlas · Vercel |
| Size | Backend 468 LOC (single file) · Frontend 4 pages, ~1,300 LOC |

---

## Contents

1. [Where the project stands today](#1-where-the-project-stands-today)
2. [Root diagnosis: two missing axes](#2-root-diagnosis-two-missing-axes)
3. [Findings](#3-findings)
4. [Target data model](#4-target-data-model)
5. [Roadmap](#5-roadmap)
6. [The feature gap worth naming](#6-the-feature-gap-worth-naming)
7. [Three decisions before Phase 0](#7-three-decisions-before-phase-0)
8. [Start here](#8-start-here)

---

## 1. Where the project stands today

### Repository state

The working branch is now current with `origin/main`. It was one commit behind — `6b54be4`, a README-only
reformat of the "Core Engines" section. Nothing else had diverged, and the tree is clean.

Recent history also shows a "master database flusher / reset button" feature added across four commits and then
removed in `7f4e48a`. Good call — that endpoint had no business existing on a publicly reachable API.

### What is actually built

```
atomquest-portal/
├── backend/
│   ├── server.js          # 468 lines: all routes, DB connection, business logic
│   ├── models/
│   │   ├── GoalSheet.js   # embedded Goal subdocuments
│   │   ├── AuditLog.js
│   │   └── Escalation.js
│   └── vercel.json        # single serverless function, 10s max duration
└── frontend/
    └── src/
        ├── App.jsx              # 4 routes
        ├── ProtectedRoute.jsx   # 14 lines, localStorage role check
        ├── components/ui/       # shadcn primitives
        └── pages/
            ├── LandingPage.jsx
            ├── EmployeeDashboard.jsx
            ├── ManagerWorkspace.jsx
            └── AdminPanel.jsx
```

**Three role views exist and are genuinely well-executed visually:**

- **Employee** — drafts up to 8 goals, enforces a 100% weightage ceiling and a 10% per-goal floor, submits for
  L1 approval, and after approval enters mid-quarter actuals against a multi-formula progress calculator.
- **Manager** — reviews the queue, approves (locking the sheet) or returns for rework, broadcasts a shared
  departmental KPI across the team, and logs threaded check-in discussion notes.
- **HR / Admin** — switches the global cycle phase, runs a compliance escalation checker, resolves escalations
  with a note, force-unlocks locked sheets (the one audited action), views distribution analytics, and exports
  a CSV.

**17 API endpoints** cover create, resubmit, approve, rework, adjust, cascade, check-in, discussion, period
get/set, audit log, force-unlock, CSV export, escalation evaluate/resolve/list, and analytics.

### The honest assessment

This is a well-made **demo** of a performance management system. Every screen does what it promises when one
person uses it, in one order, once. It is a prototype in the strict sense: it works because there is exactly
one user, and it has no memory of last quarter.

Three things separate it from an application — and they aren't a backlog of unrelated bugs. They are one
structural absence with many symptoms: **there is no user, there is no organization, and there is no clock.**

> **Housekeeping:** the README states the portal was "verified via a programmatic end-to-end regression test
> suite." There are zero test files in the repository. On a public repo that reads as an overclaim to anyone who
> looks. Worth correcting in Phase 0, alongside actually writing the tests.

---

## 2. Root diagnosis: two missing axes

Nearly every finding in §3 is downstream of one of these two. Fix them and a long tail of separate-looking
problems disappears at once. Patch around them and you will keep re-fixing the same class of bug.

### Axis 1 — Identity

There is no `User` model anywhere in the project.

- The employee is the string literal `'Vipransh Kaushik'`, hardcoded in a route handler ([`server.js:94-95`](backend/server.js#L94-L95)).
- Roles live in `localStorage` and are never checked by the server ([`ProtectedRoute.jsx:5`](frontend/src/ProtectedRoute.jsx#L5)).
- Manager-to-report relationships don't exist, so the manager view shows every sheet in the database.
- The shared-KPI cascade matches its primary owner by **case-insensitive display-name comparison**
  ([`server.js:198`](backend/server.js#L198)).
- `Escalation.managerName` defaults to the literal string `"L1 Team Manager"`.

### Axis 2 — Time

There is no `ReviewCycle` entity.

- The active period is a module-level variable, `GLOBAL_ACTIVE_PERIOD` ([`server.js:67`](backend/server.js#L67)).
  On Vercel this resets on every cold start, and concurrent instances disagree about what period it is.
- Changing it runs `updateMany({}, { $set: { quarter: newPeriod } })` — rewriting the period on **every
  historical sheet** ([`server.js:290`](backend/server.js#L290)).
- A person has exactly one goal sheet, forever, mutated in place. Resubmission overwrites the goals array.
- There are no dates anywhere, so nothing can be genuinely overdue.

---

## 3. Findings

Ranked by severity. "Severity" here means *how badly does this break when a second real person uses the
system*, not code aesthetics.

---

### F-01 · CRITICAL — The API is entirely unauthenticated

No auth exists at any layer. `ProtectedRoute` reads a role string that the landing page writes to
`localStorage` when you click a button — no password, no token, no server call. Every endpoint is publicly
writable: anyone on the internet can `curl` an approval, force-unlock a sheet, or rewrite the entire database.
`app.use(cors())` with no allowlist makes it browser-reachable from any origin as well.

*Refs:* [`ProtectedRoute.jsx:5`](frontend/src/ProtectedRoute.jsx#L5) · [`LandingPage.jsx:21-33`](frontend/src/pages/LandingPage.jsx#L21-L33) · [`server.js:13`](backend/server.js#L13) · all routes

---

### F-02 · CRITICAL — One hardcoded employee; every read returns everyone

Sheet creation hardcodes `employeeId: 'emp-123'` and `employeeName: 'Vipransh Kaushik'`.
`GET /api/goalsheets` returns every sheet in the database to every caller, unfiltered and unpaginated — the
employee dashboard simply takes `data[0]`. A second employee would see, and be able to edit, the first one's
goals.

*Refs:* [`server.js:94-95`](backend/server.js#L94-L95) · [`server.js:128-135`](backend/server.js#L128-L135) · [`EmployeeDashboard.jsx:37`](frontend/src/pages/EmployeeDashboard.jsx#L37)

---

### F-03 · CRITICAL — Cycle switch destroys historical data

`PUT /api/admin/active-period` runs `GoalSheet.updateMany({}, { $set: { quarter: newPeriod } })`. It stamps the
new period onto every sheet ever created, including closed ones. There is no way to answer "what were this
person's Q1 goals" afterwards. The backing variable is module-level state, so it is also unreliable across
serverless instances.

*Refs:* [`server.js:67`](backend/server.js#L67) · [`server.js:285-295`](backend/server.js#L285-L295)

---

### F-04 · CRITICAL — Check-in accepts arbitrary goal rewrites on locked sheets

`PUT /api/goalsheets/:id/checkin` assigns `currentSheet.goals = updatedGoals` wholesale with no validation. A
client can change titles, targets, and weightages on a sheet that was approved and locked — precisely what the
lock exists to prevent. The guard only confirms the sheet *is* locked, then trusts the payload completely.

*Refs:* [`server.js:227-250`](backend/server.js#L227-L250)

---

### F-05 · HIGH — Shared-KPI cascade bypasses every weightage rule

`push-shared` appends a goal and then recomputes `totalWeightage` to whatever the sum happens to be — no 100%
ceiling check, no 10% floor. Sheets silently end up at 115%. It also resolves the primary owner by lowercased
display-name string, so two employees named "A. Kumar" both become owner, and a rename breaks the link
permanently.

*Refs:* [`server.js:192-222`](backend/server.js#L192-L222) — especially [198](backend/server.js#L198), [211-216](backend/server.js#L211-L216)

---

### F-06 · HIGH — Scoring direction is inferred from substrings in the goal title

Whether a goal scores normally (`actual / target`) or inversely (`target / actual`) is decided by:

```js
goal.title.toLowerCase().includes('tat')
  || goal.title.toLowerCase().includes('cost')
  || goal.title.toLowerCase().includes('reduction')
```

So "Reduce customer wait time" scores inversely by accident, "Cost Awareness Training" is treated as a
cost-reduction metric, and any goal containing the letters *tat* — "Ro**tat**ion", "Total A**tta**inment" —
silently flips. Scoring direction must be an explicit field on the goal.

*Refs:* [`EmployeeDashboard.jsx:68`](frontend/src/pages/EmployeeDashboard.jsx#L68) · [`ManagerWorkspace.jsx:62`](frontend/src/pages/ManagerWorkspace.jsx#L62)

---

### F-07 · HIGH — Scoring logic is duplicated client-side and absent server-side

`calculateOverallProgress` and `calculateSheetProgress` are byte-identical copies in two files, and the server
never computes a score at all. The number an employee sees and the number their manager sees agree only by
coincidence, and neither is persisted or auditable. This is the product's core business logic living in the
least trustworthy place available.

*Refs:* [`EmployeeDashboard.jsx:52-79`](frontend/src/pages/EmployeeDashboard.jsx#L52-L79) · [`ManagerWorkspace.jsx:46-73`](frontend/src/pages/ManagerWorkspace.jsx#L46-L73)

---

### F-08 · HIGH — The escalation engine reports fabricated overdue counts

```js
const daysSinceUpdate = Math.max(Math.floor((currentDate - new Date(sheet.updatedAt)) / 86400000), 4);
```

The floor of `4` means a sheet updated ten seconds ago reports "4 days overdue." There are no real deadlines
anywhere to compare against, because there are no cycle dates. The "notification chain" only writes a status
string to a document — nothing is ever sent to anyone. And it runs only when an admin clicks a button.

*Refs:* [`server.js:363-399`](backend/server.js#L363-L399) — especially [369](backend/server.js#L369) · [`Escalation.js`](backend/models/Escalation.js)

---

### F-09 · HIGH — The audit trail records one action out of a dozen

Only `ADMIN_FORCE_UNLOCK` writes an `AuditLog` entry. Approvals, reworks, manager weightage adjustments,
corporate cascades, and period changes — every mutation a compliance reviewer would actually ask about — leave
no trace. `changedBy` is the hardcoded string `'System Compliance Board'`, because there is no actor to record.

*Refs:* [`server.js:312-335`](backend/server.js#L312-L335) · [`AuditLog.js:6`](backend/models/AuditLog.js#L6)

---

### F-10 · MEDIUM — Validation rules are inconsistent across the routes that share them

| Route | Weightage check | 8-goal cap | 10% floor | Lock check |
|---|---|---|---|---|
| `POST /goalsheets` | `Math.round(t) !== 100` | yes | yes | n/a |
| `PUT /:id/resubmit` | `Number(t) !== 100` | **no** | **no** | **no** |
| `PUT /:id/adjust` | `t !== 100` | **no** | **no** | **no** |
| `POST /push-shared` | **none** | yes | **no** | **no** |

A float-summed `99.99999` passes creation and fails resubmission. The same three business rules are written
four different ways in four places.

*Refs:* [`server.js:87-89`](backend/server.js#L87-L89) · [`server.js:112`](backend/server.js#L112) · [`server.js:172-187`](backend/server.js#L172-L187)

---

### F-11 · MEDIUM — CSV export is malformable and formula-injectable

Escaping is `title.replace(/,/g, ' ')` on one field only. A quote character in any field breaks the row;
commas in `uom`, `target`, or employee name shift columns. There is no guard against a leading `=`, `+`, `-`,
or `@`, so a goal titled `=cmd|...` becomes an executable formula when HR opens the file in Excel.

*Refs:* [`server.js:340-358`](backend/server.js#L340-L358) — especially [347-349](backend/server.js#L347-L349)

---

### F-12 · MEDIUM — Twenty hardcoded production URLs in the frontend

`https://aurapms-backend.vercel.app` appears **20 times** across three page components — 11 in `AdminPanel.jsx`
alone. There is no environment variable and no API client module, so running the frontend locally writes to the
production database. Every request also repeats its own error handling, or omits it entirely.

*Refs:* `AdminPanel.jsx` (11) · `ManagerWorkspace.jsx` (5) · `EmployeeDashboard.jsx` (4)

---

### F-13 · MEDIUM — Analytics and lists load the entire collection into memory

`/api/admin/analytics` does `GoalSheet.find()` and counts with a nested `forEach` in Node; the same pattern
appears in the escalation evaluator and every list route. No pagination, no projection, no indexes beyond
`_id`. Fine at one document, a timeout at ten thousand — especially against a 10-second Vercel function
ceiling.

*Refs:* [`server.js:435-459`](backend/server.js#L435-L459) · [`server.js:128`](backend/server.js#L128) · [`server.js:365`](backend/server.js#L365) · [`vercel.json:15-19`](backend/vercel.json#L15-L19)

---

### F-14 · MEDIUM — No tests, no CI, and `alert()` as the entire feedback layer

Zero test files, no CI workflow, no backend linting, no error boundaries. Every success and failure path in all
three dashboards is a blocking `window.alert()` — and several `catch` blocks only `console.error`, so a failed
write looks to the user like nothing happened at all. There is currently no way to change the weightage rules
with any confidence that you haven't broken them.

*Refs:* repo-wide · [`ManagerWorkspace.jsx:91-93`](frontend/src/pages/ManagerWorkspace.jsx#L91-L93), [104-106](frontend/src/pages/ManagerWorkspace.jsx#L104-L106), [117-119](frontend/src/pages/ManagerWorkspace.jsx#L117-L119)

---

## 4. Target data model

This is the shape that resolves both missing axes. Everything gains an `orgId`; everything performance-related
gains a `cycleId`; every person becomes a real referenced entity.

| Entity | Status | Key fields & relationships |
|---|---|---|
| `Organization` | **new** | Tenant root. `name`, `fiscalYearStart`, settings. Every other record carries `orgId`. |
| `User` | **new** | `email`, `passwordHash`, `name`, `orgId`, `managerId` → User, `teamId`, `roles[]`, `status`. Replaces the hardcoded employee and the localStorage role. |
| `Team` | **new** | `orgId`, `name`, `leadId` → User, optional `parentTeamId`. Provides the org chart escalations need. |
| `ReviewCycle` | **new** | `orgId`, `name`, `fiscalYear`, `phases[]` each with `key / label / startsAt / endsAt`, `status`. Replaces `GLOBAL_ACTIVE_PERIOD` and gives escalations real deadlines. |
| `GoalSheet` | rework | Add `orgId`, `userId` → User, `cycleId` → ReviewCycle, `approverId`, `submittedAt`, `approvedAt`, `revision`. Unique index on `(userId, cycleId)`. Drop the free-text `quarter` string. |
| `Goal` | rework | Add `direction` (`higher_is_better` \| `lower_is_better`) and `scoringMethod` as explicit enums. Replaces the title-substring inference in F-06. |
| `SharedGoal` | **new** | `orgId`, `cycleId`, `ownerUserId` → User, `audience` (team / role / explicit list), template fields. Cascaded instances reference it by id, never by name. |
| `SheetRevision` | **new** | Immutable snapshot written on every submit and approval. Makes "what did we agree to" answerable and gives the audit trail something to diff against. |
| `Appraisal` | **new** | `sheetId`, `selfRating`, `managerRating`, `finalRating`, `calibratedBy`, narrative fields. The missing half of the product — see §6. |
| `AuditEvent` | rework | `orgId`, `actorId` → User, `action`, `entityType`, `entityId`, `before`, `after`, `at`, `ip`. Written by a service wrapper so no mutation can skip it. |
| `Escalation` | rework | `subjectUserId`, `cycleId`, `rule`, `dueAt`, `level`, `notifiedAt[]`, `resolvedBy`. Deadlines come from the cycle, not from a floor of 4. |
| `Notification` | **new** | `userId`, `type`, `payload`, `channel`, `sentAt`, `readAt`. Makes the notification chain actually notify. |

---

## 5. Roadmap

Six phases, ordered by dependency rather than by appeal. **Phases 0–2 are not optional and not
parallelizable** — each makes the next one safe. Roughly **11 weeks solo** at a steady pace. Compress by cutting
Phase 3 scope; never by reordering.

---

### Phase 0 — Make the codebase safe to change · ~1 week

- [ ] Split the 468-line `server.js` into `routes/`, `controllers/`, `services/`, `middleware/`. Nothing else in
      this plan is pleasant until this is done.
- [ ] Add `VITE_API_BASE_URL` and one `src/lib/api.js` client with shared error handling; delete all 20
      hardcoded URLs *(F-12)*.
- [ ] Zod schemas on every request body; one central error handler; one consistent error response shape.
- [ ] Vitest + Supertest + `mongodb-memory-server`. Write the weightage rules and the scoring matrix **first** —
      they are the business core and are currently untested *(F-10, F-14)*.
- [ ] ESLint on the backend, Prettier on both, GitHub Actions running lint + test + build on every push.
- [ ] Correct the README's test-suite claim.

**Exit criteria** — CI is green; scoring and weightage rules have real test coverage; the frontend can point at
localhost without editing source.

---

### Phase 1 — Identity: users, roles, and real permissions · ~1.5 weeks

- [ ] `Organization`, `User`, `Team` models plus a seed script producing a realistic org of ~20 people with
      reporting lines.
- [ ] Auth: email + password with argon2id, short-lived access JWT, refresh token rotation in an httpOnly
      `SameSite=Lax` cookie.
- [ ] `requireAuth`, `requireRole`, `requireSelfOrManager` middleware applied to **every** route *(F-01)*.
- [ ] Scope all reads by actor: employees see their own sheet, managers see their direct reports, HR sees the
      org *(F-02)*.
- [ ] CORS allowlist, `helmet`, rate limiting on auth routes.
- [ ] Frontend: real login form, `AuthContext`, `ProtectedRoute` backed by a server session, global 401 →
      redirect.

**Exit criteria** — Every endpoint returns 401 unauthenticated; an employee provably cannot read or modify
another employee's sheet; a manager sees only their reports. Verified by tests, not by clicking.

---

### Phase 2 — Time: cycles, history, and one scoring engine · ~2 weeks

- [ ] `ReviewCycle` with dated phases; delete `GLOBAL_ACTIVE_PERIOD` and the destructive `updateMany` *(F-03)*.
- [ ] Re-key `GoalSheet` on `(userId, cycleId)` with a unique index; write a migration for existing documents.
- [ ] Add explicit `direction` and `scoringMethod` to goals; delete the title-substring inference *(F-06)*.
- [ ] Move scoring into `services/scoring.js`, computed and returned server-side; both dashboards render the
      number rather than deriving it *(F-07)*.
- [ ] Promote `SharedGoal` to its own collection keyed by `ownerUserId`; the cascade re-validates and refuses to
      breach 100% *(F-05)*.
- [ ] Validate check-in payloads field-by-field against the locked sheet — progress fields only *(F-04)*.
- [ ] `SheetRevision` snapshots on submit and approve; a history endpoint and a diff view.
- [ ] Route every mutation through an audited service wrapper recording actor, before, and after *(F-09)*.

**Exit criteria** — Two cycles coexist with independent sheets; last cycle's approved goals are still readable
and unchanged; all three views show an identical score because there is exactly one implementation of it.

---

### Phase 3 — The workflow the product is actually missing · ~3 weeks

- [ ] Self-appraisal at cycle end, then manager rating, then final rating — see §6 for why this is the biggest
      gap.
- [ ] Calibration view: rating distribution across managers and teams, so HR can normalize.
- [ ] Multi-level approval (L1 → L2 → skip-level) and delegation when a manager is unavailable.
- [ ] Deadlines derived from cycle phase dates; the escalation evaluator becomes a scheduled nightly job instead
      of an admin button, with honest day counts *(F-08)*.
- [ ] Notifications that notify: in-app inbox plus email via Resend or SES, wired to the existing three-tier
      chain.

**Exit criteria** — A complete cycle runs from setup to final rating without an administrator manually pressing
anything to advance it.

---

### Phase 4 — Scale and operations · ~1.5 weeks

- [ ] Pagination, filtering, and projection on every list endpoint; compound indexes on
      `(orgId, cycleId, userId)` and `(orgId, status)` *(F-13)*.
- [ ] Rewrite analytics as an aggregation pipeline rather than fetch-all-then-loop.
- [ ] Export becomes a background job producing a signed download, with correct RFC 4180 quoting and a
      formula-injection guard *(F-11)*.
- [ ] A real job runner (BullMQ or Inngest) for escalations, digests, and exports.
- [ ] Structured logging (pino), Sentry, `/healthz` and `/readyz`.
- [ ] Replace the boolean `isConnected` flag with a cached connection promise — the current pattern can open
      duplicate connections under concurrent cold starts. If jobs need more than 10s, move the API off the single
      Vercel function to Railway, Render, or Fly.

**Exit criteria** — 10,000 sheets seeded; list endpoints under 200 ms p95; escalations run unattended overnight
and the results are correct the next morning.

---

### Phase 5 — Product surface · ~2 weeks

- [ ] TanStack Query for server state; delete every `alert()` in favour of toasts and inline field errors;
      loading skeletons and error boundaries *(F-14)*.
- [ ] Turn the analytics key-value lists into actual charts.
- [ ] Admin surface: org chart, bulk CSV user import, cycle setup wizard, role management.
- [ ] Manager queue: search, filter, sort, bulk approve.
- [ ] Accessibility pass — focus states, form labels, contrast — and a genuine responsive pass on the tables.

**Exit criteria** — No `alert()` anywhere; the app is fully keyboard-navigable; Lighthouse accessibility ≥ 95.

---

## 6. The feature gap worth naming

Everything above is about robustness. This is about scope, and it is the single biggest difference between what
exists and what a performance management system is understood to be.

AuraPMS currently covers **goal setting and mid-cycle check-ins**. It has no concept of **appraisal** — no
self-assessment, no manager rating, no final rating, no calibration across teams, no link to compensation or
promotion.

In real PMS products, that back half is the reason an organization buys the tool. Goal setting is the setup
for it.

It sits in Phase 3 because it depends on identity and cycles being real first — a rating is meaningless without
a person to attach it to and a period to bound it. But when deciding how much of this plan to build, **cut
elsewhere before cutting here.**

---

## 7. Three decisions before Phase 0

Each of these changes the work materially. I've stated a recommendation rather than a menu — push back where you
disagree and the plan adjusts.

### 7.1 MongoDB or Postgres?

The target model is strongly relational — users reference managers, sheets reference users and cycles, ratings
reference sheets. Several operations need to be atomic across documents: approving a sheet, writing the audit
event, and queueing the notification must all succeed or all fail. You also want real constraints, like one
sheet per user per cycle.

> **Recommendation** — Move to Postgres + Prisma, at the Phase 1/2 boundary while data volume is still zero. It
> costs about a week and removes a category of bug permanently.
>
> Staying on Mongo is defensible for continuity. If you do, commit to ObjectId references everywhere and enable
> a replica set so transactions are available. What isn't viable is staying on Mongo *and* keeping name-string
> joins.

### 7.2 Adopt TypeScript?

The bugs in F-05, F-06, and F-10 are all shape-and-enum bugs — the kind a type checker catches at the moment you
write them. With a shared types package, the API contract stops being something the frontend guesses at.

> **Recommendation** — Yes, during Phase 0 while the codebase is still ~1,800 lines. It gets disproportionately
> more expensive after Phase 3.

### 7.3 Build auth or buy it?

Rolling your own email + password + JWT is roughly three days, and is a genuinely valuable thing to have built.
Managed auth (Clerk, WorkOS, Better Auth) takes a few hours and brings SSO and SCIM — which enterprise buyers of
a PMS will require.

> **Recommendation** — Build it if this is a portfolio and learning project; buy it if you're aiming at real
> organizations, where SAML SSO is table stakes. Either way, keep it behind your own middleware interface so the
> choice stays reversible.

---

## 8. Start here

Three concrete actions, in order, before any phase work begins.

**1. Rotate the MongoDB credentials and lock down the deployed API.**
A publicly writable database has been live at `aurapms-backend.vercel.app` for the duration of the prototype.
Even if nothing has touched it, treat the connection string as compromised and assume the data is untrustworthy.
This is not a Phase 0 task — it's today.

**2. Answer the three questions in §7.**
Database and language choices determine the shape of every file written from Phase 0 onward, and re-deciding at
Phase 3 is expensive.

**3. Then open Phase 0 with the backend split and the test harness.**
Not the auth work — the test harness. Phase 1 rewrites request handling across the board, and you want a way to
know you haven't broken the weightage rules while doing it.

---

*14 findings · 6 phases · ~11 weeks solo · reviewed at `6b54be4`*
