# AuraPMS — Product Requirements Document

**Version** 1.0 · **Date** 10 August 2026 · **Status** Approved for build
**Companion docs** [PLAN.md](PLAN.md) (audit of the prototype) · [TECH_STACK.md](TECH_STACK.md) · [TASKS.md](TASKS.md)

---

## Contents

1. [Problem](#1-problem)
2. [Vision & positioning](#2-vision--positioning)
3. [Goals and non-goals](#3-goals-and-non-goals)
4. [Personas](#4-personas)
5. [The performance cycle](#5-the-performance-cycle)
6. [User stories](#6-user-stories)
7. [Feature list](#7-feature-list)
8. [Success metrics](#8-success-metrics)
9. [Constraints, risks, assumptions](#9-constraints-risks-assumptions)
10. [Release plan](#10-release-plan)

---

## 1. Problem

Mid-size organizations — roughly 100 to 2,000 employees — run performance management on spreadsheets, shared
drives, and email threads. That produces five predictable failures:

| Failure | What it looks like in practice |
|---|---|
| **Goals are set once and abandoned** | A goal sheet is filled in April and opened again in March. Nothing in between. |
| **Structure isn't enforced** | Weightages sum to 87% or 130%. Targets are unmeasurable prose. Nobody notices until rating time. |
| **Chasing is manual** | HR maintains a spreadsheet of who hasn't submitted and sends reminders by hand, every cycle, forever. |
| **HR is blind until it's too late** | Cycle health is invisible until the deadline passes and half the org is non-compliant. |
| **Ratings aren't defensible** | An employee disputes a rating. There is no record of what was agreed, when it changed, or who changed it. |

The cost is not primarily administrative. It is that performance conversations become an annual compliance
ritual rather than a continuous management practice — which is the thing the process was supposed to produce.

---

## 2. Vision & positioning

> **AuraPMS makes the performance cycle a system of record rather than a season of paperwork.**

Goals are set with structure the system enforces. Progress is visible continuously, not retroactively.
Appraisal is a natural continuation of the goal sheet rather than a separate exercise starting from a blank
page. And every state change is attributable, so a rating can be defended a year later.

**Positioning.** Between the spreadsheet the org has outgrown and the enterprise HRIS suite (Workday, SuccessFactors)
it cannot justify. AuraPMS does performance management specifically, does it completely, and integrates rather
than replaces.

**What makes it different.** Two things the spreadsheet cannot do and the enterprise suites do badly:

1. **Enforced goal structure at entry time.** Weightage ceilings, floors, caps, and measurability are validated
   when the goal is written, not discovered at rating time.
2. **A continuous compliance engine.** Deadlines derive from the cycle configuration, escalations run on a
   schedule through a defined chain, and HR sees a live compliance picture instead of assembling one manually.

---

## 3. Goals and non-goals

### 3.1 Business goals

| ID | Goal | Metric it moves |
|---|---|---|
| **BG-1** | Get the whole org through goal setting on time, without manual chasing | Cycle completion rate; HR hours spent chasing |
| **BG-2** | Turn performance management from annual to continuous | Check-ins per sheet per quarter |
| **BG-3** | Make every rating defensible | % of rating changes with a complete audit record |
| **BG-4** | Cut the time a manager spends on appraisal admin | Median manager minutes per report |
| **BG-5** | Give HR a real-time view of cycle health | Time from non-compliance occurring to HR being aware of it |

### 3.2 Product goals

- **PG-1 — Correctness is verifiable.** Progress scores are computed in exactly one place, server-side, and
  every scoring rule is covered by a test. Employee, manager, and HR always see the same number.
- **PG-2 — Nothing is ever lost.** Every cycle is preserved and readable. Every submitted and approved version
  of a goal sheet is snapshotted immutably.
- **PG-3 — HR is self-serve.** An HR admin configures a complete review cycle — phases, dates, rating scale,
  escalation rules — without engineering involvement.
- **PG-4 — Secure by default.** Every endpoint authenticated, every query scoped to the actor's organization
  and permission, every mutation audited. No exceptions and no "internal-only" endpoints.

### 3.3 Non-goals for v1

Explicitly out of scope. Each is a defensible product in its own right and would dilute the release.

- Compensation, bonus calculation, or payroll integration
- 360° peer and upward review
- Public company-wide OKR trees with cross-org key result linking
- Learning management, succession planning, recruitment
- Native mobile apps (the web app will be responsive; that is the v1 answer)
- Custom per-org workflow scripting or a rules DSL
- Multi-language / localization

---

## 4. Personas

### P1 · Priya — Individual Contributor

Software engineer, 4 years in. Cares about performance management exactly twice a year and resents it the rest
of the time. **Wants:** to write her goals once, correctly, and not have them bounced back. To know where she
stands without asking. **Frustrated by:** vague targets she can't prove she hit, and a self-appraisal form that
makes her reconstruct twelve months from memory.

### P2 · Marcus — Line Manager (L1)

Manages 7 direct reports alongside his own delivery work. **Wants:** to review and approve a batch of goal
sheets in one sitting, and to write ratings that are backed by something. **Frustrated by:** chasing his own
team, and rating conversations where he and the employee remember the goal differently.

### P3 · Dana — Skip-Level Manager (L2)

Manages 4 managers, ~30 people. **Wants:** to see whether her org is on track without reading 30 documents, and
to sanity-check her managers' rating distributions before they're final.

### P4 · Ravi — HR Business Partner

Owns the process for the whole company. **Wants:** to configure a cycle and have it run itself. To see
compliance live. To calibrate ratings across managers. To export defensible data on demand. **Frustrated by:**
being the human reminder system.

### P5 · Sam — Org Admin

IT/People Ops. **Wants:** users provisioned correctly, the org chart accurate, roles enforced, and an audit
trail that survives a compliance review.

---

## 5. The performance cycle

The domain model exists to serve this loop. Every feature maps to a phase of it.

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                                                                  │
   ▼                                                                  │
┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌───────────┐ │
│ 1. SETUP    │──▶│ 2. GOAL      │──▶│ 3. CHECK-IN  │──▶│ 4.APPRAISE│─┘
│             │   │    SETTING   │   │  (recurring) │   │           │
│ HR defines  │   │ Draft →      │   │ Update       │   │ Self →    │
│ cycle,      │   │ Submit →     │   │ actuals,     │   │ Manager → │
│ phases,     │   │ Approve/     │   │ log          │   │ Calibrate │
│ dates,      │   │ Rework →     │   │ discussion   │   │ → Final   │
│ scale       │   │ Lock         │   │              │   │           │
└─────────────┘   └──────────────┘   └──────────────┘   └───────────┘
        │                 │                  │                 │
        └─────────────────┴──────────────────┴─────────────────┘
                                   │
                     ┌─────────────▼─────────────┐
                     │  ALWAYS ON, ACROSS PHASES │
                     │  Escalation · Notification│
                     │  Audit · Analytics        │
                     └───────────────────────────┘
```

**Phase gating.** Each phase has configured start and end dates. Actions are legal only in their phase: you
cannot submit goals during the appraisal window, and you cannot rate before check-ins close. The active phase
is derived from dates, never from a mutable global flag.

---

## 6. User stories

Format: **`ID` · As a `persona`, I want `capability`, so that `outcome`.** Acceptance criteria are the
testable definition.

### E1 — Identity & access

**US-101** · As **Sam**, I want to invite users by email with a role and a manager, so that the org chart is
accurate from day one.
*AC:* Invite sends an email with a single-use expiring link · role and `managerId` set at invite time · invited
user sets their own password · invite cannot be reused.

**US-102** · As **Priya**, I want to sign in with email and password and stay signed in across browser restarts,
so that I'm not re-authenticating constantly.
*AC:* Session persists via httpOnly refresh cookie · access token short-lived · sign-out revokes the session
server-side · 401 anywhere redirects to login preserving the return URL.

**US-103** · As **Priya**, I want to reset my password without contacting IT.
*AC:* Reset link single-use, expires in 60 min · all existing sessions invalidated on reset · no user
enumeration in responses.

**US-104** · As **Sam**, I want roles to be enforced by the server, so that permissions can't be bypassed by a
modified client.
*AC:* Every endpoint checks the authenticated actor · role changes take effect on next request · a permission
matrix test asserts the full grid of role × endpoint × expected status.

**US-105** · As **Sam**, I want a user's data scoped to their organization, so that a multi-tenant deployment
cannot leak across tenants.
*AC:* Every query filters by `orgId` derived from the session, never from a request parameter · a test attempts
cross-org access on every read endpoint and expects 404.

**US-106** · As **Sam**, I want to deactivate a departing employee without deleting their history.
*AC:* Deactivated users cannot sign in · their sheets, ratings, and audit records remain readable to
manager/HR · they disappear from assignment pickers.

### E2 — Organization & cycle setup

**US-201** · As **Ravi**, I want to create a review cycle with named phases and dates, so that the system knows
what should be happening when.
*AC:* Phases have `key`, `label`, `startsAt`, `endsAt` · phases cannot overlap · a cycle cannot open without at
least a goal-setting and an appraisal phase · cycles are per-organization.

**US-202** · As **Ravi**, I want multiple cycles to coexist, so that closing one doesn't destroy the last.
*AC:* A prior cycle's sheets, goals, and ratings remain readable and immutable after close · exactly one cycle
may be `active` at a time · each user has at most one sheet per cycle (enforced by unique constraint).

**US-203** · As **Ravi**, I want to define the rating scale and its labels per cycle.
*AC:* Configurable point scale with labels and optional descriptors · scale is snapshotted onto the cycle so
changing it later doesn't rewrite historical ratings.

**US-204** · As **Ravi**, I want to configure escalation rules per cycle — how many days late triggers which
tier.
*AC:* Thresholds and tiers configurable · defaults provided · changes apply to future evaluations only.

**US-205** · As **Sam**, I want to bulk-import users from CSV, so that onboarding 300 people isn't 300 forms.
*AC:* Dry-run preview showing creates/updates/errors before commit · row-level error reporting · manager
references resolved by email · partial import never leaves a broken org chart.

### E3 — Goal setting

**US-301** · As **Priya**, I want to draft goals with a thrust area, title, unit of measure, target, and
weightage, so that my objectives are unambiguous.
*AC:* All fields required · target validated per UoM (numeric for Numeric/%, date for Timeline) · draft
autosaves.

**US-302** · As **Priya**, I want the system to stop me submitting an invalid sheet, so that it isn't returned
for something mechanical.
*AC:* Weightages must total exactly 100% (±0.01 float tolerance) · minimum 10% per goal · maximum 8 goals ·
minimum 3 goals · submit disabled with a specific reason shown, not a generic error.

**US-303** · As **Priya**, I want to declare whether higher or lower is better for each goal, so that a
reduction target scores correctly.
*AC:* Explicit `direction` field, defaulted sensibly per UoM but always user-overridable · scoring never
inferred from the goal's text · the effect on scoring is previewed in the UI.

**US-304** · As **Priya**, I want to see my sheet's status and what's expected of me next.
*AC:* Status and current phase visible on load · next action and its deadline stated in plain language · days
remaining shown.

**US-305** · As **Priya**, I want a returned sheet to tell me exactly what to change.
*AC:* Rework requires the manager to supply a reason · reason displayed against the sheet · per-goal comments
supported · resubmission re-runs full validation.

### E4 — Shared & cascaded goals

**US-401** · As **Marcus**, I want to push a departmental KPI to my team, so that shared objectives are
consistent.
*AC:* Target audience selectable (team / role / explicit list) · one designated primary owner by **user
reference**, never by name · cascade is previewed before commit showing exactly who receives it.

**US-402** · As **Marcus**, I want the cascade to refuse to break anyone's weightage.
*AC:* Recipients whose total would exceed 100% are reported and skipped, not silently overfilled · the
preview shows skips with reasons · recipients at the 8-goal cap are skipped and reported.

**US-403** · As **Priya**, I want a cascaded goal's progress to update from its owner automatically, so that we
aren't entering the same number five times.
*AC:* Only the primary owner can edit actuals · non-owner instances are read-only and labelled · owner updates
propagate atomically to all linked instances.

**US-404** · As **Priya**, I want to be unable to delete a mandated goal but able to see why it's there.
*AC:* Delete blocked with an explanation naming who cascaded it and when.

### E5 — Approval workflow

**US-501** · As **Marcus**, I want one queue of everything awaiting my action, sorted by urgency.
*AC:* Filter by status, sort by deadline · shows only direct reports · overdue items visually distinct · counts
badge on nav.

**US-502** · As **Marcus**, I want to approve a sheet and have it lock, so that goals can't shift after
agreement.
*AC:* Approval snapshots the sheet immutably · post-approval, only progress fields are writable · approver and
timestamp recorded · audit event written in the same transaction.

**US-503** · As **Marcus**, I want to adjust weightages inline before approving, with the employee notified.
*AC:* Adjustment re-runs full validation · original preserved in the revision history · employee notified with
a diff of what changed.

**US-504** · As **Dana**, I want second-level approval for sheets above a configured threshold.
*AC:* L2 step configurable per cycle · sheet is not locked until all required levels approve · each level's
approver and time recorded separately.

**US-505** · As **Marcus**, I want to delegate my approvals while I'm away.
*AC:* Time-bounded delegation to a named user · delegate's actions recorded as "on behalf of" in the audit
trail · delegation auto-expires.

**US-506** · As **Ravi**, I want to force-unlock a sheet in exceptional cases, with it recorded.
*AC:* Requires a typed justification · audit event captures actor, reason, before/after state · both employee
and manager notified · surfaced in a dedicated override report.

### E6 — Check-ins & progress

**US-601** · As **Priya**, I want to update actual achievement during the cycle and see my score move.
*AC:* Only progress fields writable on a locked sheet — server-side field whitelist, not client trust · score
recomputed server-side and returned · previous values retained in history.

**US-602** · As **Priya** and **Marcus**, I want a threaded discussion on the sheet, so that context isn't lost
in email.
*AC:* Attributed to a real user with a timestamp · visible to employee, manager chain, and HR · edit window
then immutable · optionally scoped to a specific goal.

**US-603** · As **Marcus**, I want to be reminded when a report hasn't checked in during a check-in window.
*AC:* Reminder derived from cycle phase dates · escalates per configured rules · stops immediately on check-in.

**US-604** · As **Priya**, I want to see my progress trend over the cycle, not just the current number.
*AC:* Score history per check-in charted over time · per-goal breakdown drillable.

### E7 — Appraisal & rating

**US-701** · As **Priya**, I want to write a self-appraisal pre-populated with my goals and final achievement,
so that I'm not starting from a blank page.
*AC:* Each goal shown with target, actual, computed score · free-text reflection per goal plus an overall
summary · optional self-rating on the cycle's scale · submit locks it from further editing.

**US-702** · As **Marcus**, I want to rate a report with their self-appraisal and actual data side by side.
*AC:* Self-appraisal, computed score, and check-in history all visible while rating · per-goal and overall
rating · narrative justification required · cannot rate before self-appraisal submits or its deadline passes.

**US-703** · As **Priya**, I want to see my final rating with its justification, and to acknowledge it.
*AC:* Released only when HR opens the results phase · acknowledgement recorded with timestamp · a comment can
be attached · disagreement can be flagged for HR.

**US-704** · As **Ravi**, I want the computed score and the manager rating shown together, so that large
divergences are visible.
*AC:* Divergence beyond a configured threshold flagged for review in the calibration view.

### E8 — Calibration

**US-801** · As **Dana**, I want to see rating distribution across my managers before finalizing.
*AC:* Distribution per manager and per team · comparison against org distribution · outlier managers
highlighted.

**US-802** · As **Ravi**, I want to adjust a rating during calibration with a mandatory reason.
*AC:* Original manager rating preserved and displayed alongside · reason required · audit event with both
values · manager notified.

**US-803** · As **Ravi**, I want to lock calibration and release results org-wide in one action.
*AC:* Locking prevents further rating changes · release is atomic and notifies everyone · a pre-release preview
report is available.

### E9 — Compliance & escalation

**US-901** · As **Ravi**, I want overdue actions detected automatically on a schedule, not when I click a button.
*AC:* Scheduled job runs nightly · deadlines derived from cycle phase dates · real elapsed days, never a
floor or synthetic minimum · job failures alert.

**US-902** · As **Ravi**, I want escalation to move up the real reporting chain over time.
*AC:* Tier 1 employee → tier 2 their manager → tier 3 skip-level and HR · chain resolved from actual
`managerId` relationships · thresholds configurable per cycle · each notification recorded with channel and
timestamp.

**US-903** · As **Ravi**, I want a live compliance dashboard for the current cycle.
*AC:* Submitted / approved / overdue counts by team and manager · drill-through to the specific people ·
exportable.

**US-904** · As **Ravi**, I want to resolve an escalation with a note and have it stop notifying.
*AC:* Resolution note required · resolved items excluded from future evaluation · re-opens automatically if the
underlying condition recurs.

### E10 — Analytics & reporting

**US-1001** · As **Ravi**, I want distribution analytics across thrust area, UoM, and status, computed in the
database.
*AC:* Aggregation runs as SQL, not application loops · filterable by cycle, team, manager · returns in under
500 ms at 10,000 sheets.

**US-1002** · As **Ravi**, I want to export cycle data to CSV/XLSX for offline analysis.
*AC:* Generated as a background job with a signed download link · RFC 4180 correct quoting · leading
`= + - @` neutralized against formula injection · export itself is audited.

**US-1003** · As **Dana**, I want a team rollup of progress and completion.
*AC:* Recursive rollup through the org chart · per-team average score, completion %, overdue count.

### E11 — Audit & governance

**US-1101** · As **Sam**, I want every state change recorded with actor, timestamp, and before/after.
*AC:* Written in the same transaction as the mutation — an audit failure rolls back the change · append-only,
no update or delete path exists · captures actor, IP, and user agent.

**US-1102** · As **Sam**, I want to search and filter the audit trail.
*AC:* Filter by actor, entity, action type, date range · paginated · exportable · readable by Org Admin and HR
only.

**US-1103** · As **Ravi**, I want to see every version of a goal sheet and diff them.
*AC:* Revision list with actor and timestamp · field-level diff between any two revisions.

### E12 — Notifications

**US-1201** · As **Priya**, I want in-app notification of anything needing my action.
*AC:* Inbox with unread count · deep-links to the relevant action · mark read individually or in bulk.

**US-1202** · As **Priya**, I want email for things I'd otherwise miss, and control over which.
*AC:* Per-category preferences · digest option instead of per-event · unsubscribe honored except for
compliance-mandatory notices, which are labelled as such.

**US-1203** · As **Ravi**, I want to see what was sent to whom and when.
*AC:* Delivery log with status · failures visible and retryable.

---

## 7. Feature list

### 7.1 v1.0 — MVP (ship-blocking)

| # | Feature | Stories | Notes |
|---|---|---|---|
| F-01 | Email/password auth, sessions, password reset | US-102, 103 | |
| F-02 | User invite, roles, deactivation | US-101, 104, 106 | |
| F-03 | Organization, teams, reporting lines | US-105 | Multi-tenant from day one |
| F-04 | Review cycle with dated phases + rating scale | US-201, 202, 203 | Replaces the global period flag |
| F-05 | Goal drafting with enforced validation | US-301, 302, 303 | Core |
| F-06 | Explicit scoring direction + server-side scoring engine | US-303 | Single source of truth |
| F-07 | Submit / approve / rework with reasons | US-501, 502, 505 | |
| F-08 | Immutable sheet snapshots on submit & approve | US-1103 | |
| F-09 | Manager inline weightage adjustment | US-503 | |
| F-10 | Shared goal cascade with validation & preview | US-401, 402, 403, 404 | |
| F-11 | Check-ins with server-side field whitelist | US-601 | Closes prototype F-04 |
| F-12 | Threaded discussion on sheets | US-602 | |
| F-13 | Self-appraisal | US-701 | **The missing half** |
| F-14 | Manager rating with justification | US-702 | **The missing half** |
| F-15 | Rating release & acknowledgement | US-703 | |
| F-16 | Scheduled escalation engine with real deadlines | US-901, 902, 904 | |
| F-17 | In-app + email notifications | US-1201, 1202 | |
| F-18 | Full audit trail, transactional | US-1101, 1102 | |
| F-19 | HR compliance dashboard | US-903 | |
| F-20 | Analytics via SQL aggregation | US-1001 | |
| F-21 | Safe CSV export as a background job | US-1002 | |
| F-22 | Audited force-unlock override | US-506 | |

### 7.2 v1.1 — Fast follow

| # | Feature | Stories |
|---|---|---|
| F-23 | Calibration view + adjustment with reason | US-801, 802, 803 |
| F-24 | Second-level (L2) approval | US-504 |
| F-25 | Bulk CSV user import with dry-run | US-205 |
| F-26 | Progress trend charts | US-604 |
| F-27 | Team rollup reporting | US-1003 |
| F-28 | Configurable escalation rules per cycle | US-204 |
| F-29 | Manager bulk approve | US-501 |
| F-30 | Notification delivery log | US-1203 |

### 7.3 v2.0 — Later

Goal templates and a library · goal-to-goal alignment (cascade upward to org objectives) · SAML SSO and SCIM
provisioning · Slack/Teams notification channels · public REST API with API keys · custom rating scales per
job family · continuous feedback outside the cycle · HRIS sync.

---

## 8. Success metrics

### 8.1 North Star

> **Percentage of employees who complete a full cycle — approved goals, at least one check-in, and a submitted
> self-appraisal — without any manual HR intervention.**

It is the only metric that captures adoption, engagement, and automation simultaneously. **Target: ≥ 85% in the
first full cycle after launch.**

### 8.2 Adoption

| Metric | Baseline (spreadsheets) | v1.0 target |
|---|---|---|
| Employees with an approved goal sheet within 14 days of cycle open | ~60% | **≥ 95%** |
| Managers completing all approvals by the phase deadline | ~55% | **≥ 90%** |
| HR hours per cycle spent chasing submissions | 20–40 hrs | **< 2 hrs** |
| Manual reminder emails sent by HR | dozens | **0** |

### 8.3 Engagement

| Metric | v1.0 target |
|---|---|
| Check-ins per sheet per quarter | **≥ 1.0** (stretch 1.5) |
| Sheets with ≥ 1 discussion comment per cycle | **≥ 70%** |
| Self-appraisals submitted before deadline | **≥ 90%** |
| Weekly active managers during an active phase | **≥ 80%** of managers |

### 8.4 Quality

| Metric | v1.0 target | Why |
|---|---|---|
| Sheets returned for rework | **10–20%** | Zero means approval is rubber-stamping; above 25% means guidance is unclear |
| Sheets rejected for *mechanical* reasons (weightage, count) | **< 2%** | Validation should catch these before submission |
| Ratings formally disputed | **< 2%** | |
| Divergence between computed score and manager rating beyond threshold | **< 15%** | Large divergence means goals aren't measuring the right thing |

### 8.5 Technical

| Metric | v1.0 target |
|---|---|
| p95 API latency, read endpoints | **< 200 ms** |
| p95 API latency, write endpoints | **< 500 ms** |
| Uptime | **≥ 99.5%** |
| Scheduled escalation job success rate | **100%**, alerting on any failure |
| Test coverage, `services/` layer | **≥ 90%** |
| Test coverage, overall | **≥ 80%** |
| Critical/high security findings at release | **0** |
| Mutations lacking an audit record | **0** — asserted by test |
| Cross-tenant data leaks | **0** — asserted by test on every read endpoint |

### 8.6 Instrumentation

Every metric above needs a source before launch, not after:

- **Product analytics** — PostHog (self-hostable, EU-hostable) for funnels and WAU.
- **Cycle metrics** — computed from the database by a scheduled job into a `cycle_metrics` table, so
  historical trend survives.
- **Technical metrics** — Sentry for errors, structured pino logs for latency, an uptime probe on `/healthz`.

---

## 9. Constraints, risks, assumptions

### Constraints

- **Team:** one developer. The roadmap assumes ~11 weeks of focused solo work.
- **Budget:** free/hobby tiers where possible; the stack must run under roughly \$50/month at 500 users.
- **Data residency:** the architecture must permit EU-only hosting because HR data is in scope for GDPR.
- **Compliance:** GDPR applies — right to access and right to erasure must be technically possible, which is
  why audit records reference users by ID and store no denormalized PII.

### Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Scope creep from "well-rounded" into an HRIS | High | §3.3 non-goals are binding. Anything not in §7.1 is v1.1 at the earliest. |
| Solo developer bus factor | High | Everything documented in-repo; no undocumented deploy steps; infra as code. |
| Appraisal (F-13/F-14) is the largest new surface and is scheduled late | High | Build the data model for it in Wave 1 even though the UI lands in Wave 6, so the schema doesn't need to change late. |
| Postgres migration mid-build | Medium | Do it before any real data exists — Wave 1, not later. |
| Email deliverability | Medium | Resend with a verified domain, SPF/DKIM configured before launch; in-app notification is the guaranteed channel, email is best-effort. |
| Auth library immaturity | Medium | Keep auth behind an internal interface so the provider is swappable without touching route handlers. |

### Assumptions

- Organizations have a single reporting line per employee (no matrix management in v1).
- One active cycle at a time per organization.
- Managers have ≤ 15 direct reports (UI is designed for that scale, not 100).
- Employees have ≤ 8 goals — carried over from the prototype's rule, which is sound.
- English only.

---

## 10. Release plan

| Release | Contents | Gate to ship |
|---|---|---|
| **0.1 — Internal alpha** | Waves 0–4 complete: auth, cycles, goals, approval, check-ins, API | Full permission matrix test passes; seeded org runs a cycle via API |
| **0.5 — Closed beta** | + Waves 5–6: jobs, notifications, full UI | One real team completes goal setting end-to-end |
| **1.0 — GA** | + Wave 7: appraisal UI, production hardening, E2E, load test | All §8.5 technical targets met; security review clean |
| **1.1** | §7.2 features | Post-launch, driven by beta feedback |

**Definition of Done for v1.0** — A new organization can sign up, import users, configure a cycle, and run it
end-to-end from goal setting through released ratings, with zero engineering involvement and zero manual HR
chasing.
