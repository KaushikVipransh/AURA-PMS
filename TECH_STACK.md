# AuraPMS — Technology Stack

**Version** 1.0 · **Date** 10 August 2026
**Derived from** [PRD.md](PRD.md) · **Audit context** [PLAN.md](PLAN.md) · **Execution** [TASKS.md](TASKS.md)

---

## Selection principles

Every choice below was made against these, in order. Where a "better" technology lost, it lost to one of these.

1. **Minimize the number of things that can break.** One developer. Each additional running service is a
   thing to monitor, pay for, and debug at 2am. Infrastructure count is a first-class cost.
2. **Correctness the compiler can check.** [PLAN.md](PLAN.md) findings F-05, F-06, and F-10 are all shape and
   enum bugs. The stack should make that class of bug unrepresentable rather than testable.
3. **Spend the learning budget where it pays.** The developer knows React and Express. Changing the database
   and adding types buys enormous safety; changing the HTTP framework buys milliseconds. Change the first, keep
   the second.
4. **Reversible over optimal.** Anything with lock-in risk sits behind an internal interface.
5. **Boring where it's load-bearing.** Novel technology is fine in the UI layer and unacceptable in auth,
   persistence, and money-adjacent paths.

---

## Decision summary

| Layer | Choice | One-line rationale |
|---|---|---|
| Monorepo | **pnpm workspaces + Turborepo** | Shared types between client and server; cached task graph makes the per-task verify gate fast |
| Language | **TypeScript 5.x (strict)** | Directly prevents the F-05/F-06/F-10 bug class |
| Frontend | **React 19 + Vite 8** | Already built and polished; no reason to discard it |
| Routing | **React Router 7** | Already in use, works, and the app has ~15 routes |
| Server state | **TanStack Query 5** | Removes hand-rolled fetch/loading/error in every component |
| UI | **Tailwind 4 + shadcn/ui** | Already adopted; the existing visual design is a genuine asset |
| Forms | **React Hook Form + Zod** | Same Zod schema validates on client and server — one definition of a rule |
| Charts | **Recharts** | React-native API, sufficient for distribution and trend charts |
| Runtime | **Node 24 LTS** | Current LTS; native `node:test`, fetch, and stable ESM |
| HTTP | **Express 5** | Kept deliberately — see §5.1 |
| Validation | **Zod 4** | One schema drives runtime validation, TS types, and OpenAPI |
| ORM | **Prisma 6** | Typed queries, real migrations, transactional audit writes |
| Database | **PostgreSQL (Neon)** | The domain is relational and needs transactions and constraints |
| Auth | **Better Auth** | Self-hosted in our own Postgres, TS-native, org + RBAC plugins |
| Jobs | **pg-boss** | A durable queue with **no new infrastructure** — it runs on the Postgres we already have |
| Email | **Resend** | Simple API, React Email templates, generous free tier |
| Testing | **Vitest + Supertest + Testcontainers + Playwright** | Fast unit, real-Postgres integration, real-browser E2E |
| Observability | **Sentry + pino** | Errors and structured logs; both free at this scale |
| CI | **GitHub Actions** | Where the code already lives |
| Frontend host | **Vercel** | Already deployed there; static SPA is the ideal case for it |
| API host | **Railway** | Persistent process — required for pg-boss and for jobs exceeding 10s |
| DB host | **Neon** | Branching gives every PR an isolated database |

**Estimated cost at 500 users: ~\$25–45/month.** Neon Launch ~\$19, Railway ~\$5–20, Vercel Hobby \$0, Resend
free tier, Sentry free tier.

---

## 1. Monorepo & tooling

### pnpm workspaces + Turborepo

```
aurapms/
├── apps/
│   ├── web/            # React SPA
│   ├── api/            # Express API
│   └── worker/         # pg-boss job processor
├── packages/
│   ├── db/             # Prisma schema, client, migrations, seed
│   ├── contracts/      # Zod schemas + inferred types — the API contract
│   ├── core/           # Pure domain logic: scoring, validation, policy
│   └── config/         # Shared tsconfig, eslint, prettier
└── turbo.json
```

**Why.** `packages/contracts` is the point. A Zod schema defined once is the server's runtime validator, the
client's form validator, and the TypeScript type on both sides. The prototype's F-10 — the same weightage rule
written four different ways in four places — becomes structurally impossible: there is one `goalSheetSchema`
and everything imports it.

`packages/core` holds pure functions with no I/O — scoring, weightage validation, escalation rules, permission
policy. That is what makes [TASKS.md](TASKS.md) Wave 2 genuinely atomic and parallelizable: those tasks need no
database, no HTTP, and no other task.

Turborepo caches task results by content hash, so `pnpm verify` after a change to `apps/web` skips the API's
tests entirely. With a verify gate running after **every** task, that difference compounds.

**Alternatives.** Nx — more powerful, considerably more configuration than three apps justify. npm/yarn
workspaces — no task graph or caching. Separate repos — kills the shared-contract benefit, which is the whole
reason for the structure.

### TypeScript 5.x, `strict: true`

Non-negotiable, and adopted in Wave 0 while the codebase is ~1,800 lines rather than after Wave 6.

Look at what strict mode would have caught for free in the prototype:

- **F-06** — `direction` as a union type `'higher_is_better' | 'lower_is_better'` makes
  `title.includes('tat')` inference impossible to write; there is nowhere to put it.
- **F-05** — `ownerUserId: UserId` cannot accept a display-name string.
- **F-10** — one exported `WeightageRules` constant that four call sites must satisfy.
- **F-02** — `req.user` typed as non-optional after `requireAuth` means forgetting the scope check is a
  compile error, not a data leak.

Additional flags beyond `strict`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `erasableSyntaxOnly`.

---

## 2. Frontend

### React 19 + Vite 8 — kept

**Why keep rather than move to Next.js.** The honest analysis:

| Consideration | Verdict |
|---|---|
| SEO / SSR | Irrelevant. Every page except the landing page is behind auth. The landing page is one static route. |
| Existing investment | Four polished pages and a configured shadcn setup. Real value that a rewrite discards. |
| Deployment simplicity | Next.js consolidates to one deploy — but we need a **persistent** API host for pg-boss regardless (§9), so we'd have two services either way. |
| Future mobile client | A standalone REST API serves a native client directly. A Next.js app with server actions does not. |
| Learning budget | Already spending it on Postgres, Prisma, TypeScript, Better Auth, and pg-boss. Adding App Router / RSC mental model on top is how solo projects stall. |

**Decision: keep Vite.** This is a data-dense authenticated dashboard, which is the archetypal SPA. Next.js
would be defensible; it would not be better here, and it would cost weeks.

**Rejected:** Next.js (above) · Remix/React Router framework mode (same reasoning, less ecosystem) · SvelteKit
or SolidStart (discards the entire existing frontend for no gain).

### React Router 7 — kept

Already in use and working. 15-ish routes with a straightforward nesting structure.

**Rejected:** TanStack Router. Genuinely better — fully type-safe params and search-param validation. But
React Router 7 covers this app's needs, and the migration cost is real while the benefit is marginal at this
route count. Revisit if routing grows complex.

### TanStack Query 5

**Why.** The prototype's data layer is `useEffect` + `fetch` + manual `loading` state + `alert()` on error,
repeated in every component, with several `catch` blocks that only `console.error` — so a failed write looks
to the user like nothing happened (F-14). TanStack Query replaces all of that with caching, background
refetch, request deduplication, optimistic updates with rollback, and one global error boundary.

Concretely: after an approval, [ManagerWorkspace.jsx:102](frontend/src/pages/ManagerWorkspace.jsx#L102) calls
`fetchGoalSheets()` to refetch everything. Query invalidation does this correctly and granularly.

**Rejected:** RTK Query (needs Redux, which this app has no other use for) · SWR (thinner; mutation and
invalidation ergonomics are weaker) · hand-rolled (that's the current state).

### Tailwind CSS 4 + shadcn/ui — kept

The existing design — the warm palette, the dark admin panel, the badge and card system — is legitimately good
and worth preserving. shadcn/ui components live in-repo, so they can be extended freely, and they are
accessible by default via Radix primitives, which materially helps the US-1801 accessibility target.

Add: **`sonner`** for toasts (replacing all 30+ `alert()` calls), **`cmdk`** for command-palette navigation.

### React Hook Form + Zod

**Why.** The same `goalSheetSchema` from `packages/contracts` validates the form and the API request. When
US-302's rules change, they change in one file, and both sides update together with a type error anywhere that
disagrees. RHF's uncontrolled model also avoids re-rendering a 8-goal form on every keystroke — a real problem
in the current `handleInlineGoalFieldChange` pattern.

### Recharts

Sufficient for what the PRD asks for: distribution bars (US-1001), progress trend lines (US-604), calibration
histograms (US-801). React-component API rather than an imperative escape hatch.

**Rejected:** Chart.js / D3 (imperative, more power than needed) · Nivo (heavier bundle) · Tremor (opinionated
styling that would fight the existing design system).

---

## 3. Database

### PostgreSQL — migrating from MongoDB

**This is the most consequential change in the plan.** The justification, against the actual data model in
PRD §5:

**1. The domain is relational and it is not close.** `User → managerId → User` recursively. `GoalSheet → User`
and `→ ReviewCycle`. `Goal → SharedGoal → ownerUser`. `Appraisal → GoalSheet`. `AuditEvent → actor`.
`Escalation → subject → manager chain`. Every escalation query (US-902) is a recursive walk up the reporting
chain — a `WITH RECURSIVE` CTE in Postgres, and an application-level N+1 loop in Mongo.

**2. Transactions are a hard requirement, not a nicety.** US-1101 states that an audit write failure must roll
back the mutation. US-502 requires approve + snapshot + audit + notification to be atomic. US-803 requires
calibration lock and release to be atomic org-wide. Mongo can do transactions only on a replica set, and the
prototype's Atlas free tier configuration makes this awkward.

**3. Constraints prevent bugs that tests only detect.** `UNIQUE (user_id, cycle_id)` makes duplicate sheets
impossible at the storage layer. A `CHECK` constraint enforces the weightage total. Foreign keys make F-05's
name-string join unrepresentable — you cannot store a display name in a `user_id` column.

**4. Analytics belong in SQL.** US-1001 requires distribution aggregation under 500ms at 10,000 sheets. The
prototype does `find()` then a nested `forEach` in Node (F-13). That is one `GROUP BY`.

**5. It removes an entire service.** pg-boss (§7) runs the job queue inside Postgres. Choosing Postgres means
not running Redis. That is one fewer service to operate, pay for, and monitor — principle 1.

**Migration risk: near zero.** There is no production data worth preserving — one hardcoded employee's test
sheets. This is exactly the moment to switch, which is why it lands in Wave 1 rather than later.

**Rejected:** Staying on MongoDB (workable, but every point above becomes application code the developer writes
and maintains) · MySQL/PlanetScale (no recursive CTEs historically, weaker JSON, no `pg-boss` equivalent) ·
SQLite/Turso (excellent, but concurrent writes from API plus worker plus migrations is not its strength) ·
CockroachDB/Yugabyte (distributed SQL solving a scale problem this app will never have).

### Prisma 6

**Why.** Typed query results end-to-end. A real, reviewable, version-controlled migration system —
`prisma migrate` produces SQL files in git, which the prototype's implicit Mongoose schema evolution never
did. `$transaction` gives the atomicity US-1101 requires. And the **multi-file schema** feature
(`prismaSchemaFolder`) is what makes Wave 1's model tasks genuinely parallel: each model gets its own
`.prisma` file, so `User`, `ReviewCycle`, and `AuditEvent` can be written independently without merge
conflicts.

**Rejected:** Drizzle — closer to SQL, lighter runtime, genuinely excellent. Lost on migration tooling
maturity and on relation ergonomics for the deep nesting this schema has. A reasonable person picks Drizzle
here; Prisma's introspection and Studio tooling tips it for a solo developer. · Kysely (query builder only, no
migrations or schema as source of truth) · TypeORM (decorator-heavy, weaker inference) · raw `pg` (rewrites
Prisma badly).

### Neon (managed Postgres)

**Why.** **Database branching** is the deciding feature. Every pull request gets an isolated database branch
seeded from production structure, so CI integration tests run against real Postgres with real constraints and
no shared-state flakiness. Nothing else in the managed-Postgres market makes that as cheap. Scale-to-zero also
keeps preview environments free.

**Rejected:** Supabase (excellent, but its value is the bundled auth/storage/realtime, and we're using Better
Auth — paying complexity for unused surface) · Railway Postgres (fine, but no branching; would still be the
fallback since the API is hosted there) · RDS (operational overhead unjustified at this scale) · self-hosted
(principle 1).

---

## 4. Backend runtime

### Node 24 LTS — *pinned to 22.17.1 in practice*

> **As built:** the development machine runs Node 22.17.1, so `.nvmrc` and `engines` pin 22 (see the W0-01 note
> in [TASKS.md](TASKS.md)). Every dependency here supports 22. Move to 24 before W7-03 so local, CI, and Railway
> agree; the rationale below applies to both.

Current LTS through the build window. Native `fetch`, stable ESM, and `node:test` available if Vitest ever
becomes the odd one out. Matches the frontend language, so `packages/core` and `packages/contracts` are shared
verbatim rather than duplicated.

**Rejected:** Bun (fast and improving, but ecosystem edge cases in Prisma and Playwright are not a risk worth
taking on the load-bearing layer — principle 5) · Deno (same reasoning) · Go/Rust (would forbid sharing
validation logic with the frontend, which is a primary design goal).

---

## 5. HTTP layer

### 5.1 Express 5 — kept, deliberately

This is the choice most likely to be questioned, so here is the full reasoning.

The plan already asks one developer to absorb: PostgreSQL, Prisma, TypeScript strict mode, Better Auth,
pg-boss, Turborepo, Testcontainers, and Playwright. That is a large amount of new surface. **Familiarity is a
real engineering asset and the risk budget is finite.**

What Fastify would actually buy here:

| Claimed benefit | Reality for this project |
|---|---|
| ~2–3× throughput | Irrelevant. At 500 users the bottleneck is Postgres and network, never the router. |
| Schema-based validation | We get this from Zod, which we need anyway for the shared contract. |
| Better TypeScript support | Express 5 with `@types/express` and typed handler generics is fine. |
| Structured plugin encapsulation | Solved by the monorepo layout and a router-per-domain convention. |
| Built-in pino | `pino-http` is one line in Express. |

Express 5 also finally handles async errors natively — the single biggest reason to have avoided Express 4.

**Reversibility.** All business logic lives in `packages/core` and `apps/api/src/services/`, which import
nothing from Express. Route handlers are thin: parse with Zod, call a service, serialize. Swapping to Fastify
later is a mechanical change to the routing layer only. **Switch if** throughput ever genuinely matters or the
plugin model becomes limiting — neither is true at PRD scale.

**Rejected:** Fastify (above) · Hono (excellent and edge-portable, but we deliberately need a persistent Node
process for pg-boss, so its main advantage doesn't apply) · NestJS (heavy DI and decorator ceremony; a
framework built for teams of ten) · tRPC (great DX, but PRD v2.0 wants a public REST API and possibly a native
client — an HTTP-shaped contract is the requirement).

### 5.2 Zod 4

One schema per concept, in `packages/contracts`, serving four purposes:

```ts
export const submitGoalSheetSchema = z.object({ /* … */ })
  .refine(s => Math.abs(sum(s.goals, 'weightage') - 100) < 0.01, 'Weightages must total 100%');

export type SubmitGoalSheet = z.infer<typeof submitGoalSheetSchema>;
```

1. Server runtime validation (`validate(schema)` middleware on every route)
2. Client form validation via `@hookform/resolvers`
3. The TypeScript type both sides share
4. The OpenAPI document, generated via `zod-openapi`

The `±0.01` tolerance in that refinement is the fix for F-10's `Math.round` vs strict `!==` inconsistency —
and now it exists exactly once.

### 5.3 Supporting middleware

`helmet` (security headers) · `express-rate-limit` with a Postgres store (auth endpoints, US-103's
enumeration protection) · `cors` with an **explicit origin allowlist** — the prototype's bare `app.use(cors())`
is F-01 · `pino-http` with request-ID correlation · `compression`.

---

## 6. Authentication

### Better Auth

**Why, against the PRD's specific requirements:**

| PRD requirement | How it's met |
|---|---|
| US-102 sessions surviving restart | Database-backed sessions with httpOnly refresh cookies, built in |
| US-103 password reset, no enumeration | Built-in flow with token expiry and session invalidation |
| US-104 server-enforced roles | Organization + access-control plugins provide roles and permissions |
| US-105 org scoping | Organization plugin models tenancy as a first-class concept |
| US-101 invite flow | Organization invitation flow included |
| GDPR / EU residency (§9) | **Self-hosted — user data lives in our own Neon Postgres**, not a third party |
| v2.0 SAML SSO + SCIM | Plugin architecture supports SSO; not needed at v1 |

The decisive property is that it is **self-hosted and TypeScript-native, storing into the same Postgres via the
same Prisma schema.** That means users, sessions, and organizations participate in the same transactions as
everything else — which US-1101's transactional audit requirement needs. A hosted provider puts identity in a
separate system that cannot join a local transaction.

**Reversibility, and why it matters here.** Better Auth is the youngest dependency in this stack, so it gets
the strongest isolation: all of it sits behind `apps/api/src/auth/` exposing our own
`requireAuth` / `requireRole` / `getActor` interface. **No route handler imports Better Auth directly.**
Replacing it is a change to one directory.

**Alternatives:**

| Option | Rejected because |
|---|---|
| **Clerk** | Excellent DX, but user data leaves our infrastructure (GDPR §9), per-MAU pricing scales badly for a per-seat B2B tool, and identity can't join local transactions |
| **WorkOS** | Right answer *if* enterprise SSO were a v1 requirement. It's v2.0. Revisit then. |
| **Auth.js** | Session/OAuth focused; org modelling and RBAC would be hand-rolled anyway |
| **Lucia** | Deprecated as a library — now a learning resource, not a dependency |
| **Roll your own** | Three days plus indefinite maintenance of password hashing, token rotation, reset flows, and enumeration protection. Auth is exactly where principle 5 (boring where load-bearing) applies most. |

> **Verify at install:** confirm the current Better Auth version, its Prisma adapter, and organization/access-control
> plugin APIs against the official docs before Wave 3. If the org plugin has moved or is unsuitable, fall back to
> Better Auth core for sessions plus our own `Role`/`Membership` tables — the isolation layer above makes that a
> contained change.

### Authorization

Separate from authentication and built in-house, in `packages/core/policy`:

```ts
can(actor, 'goalsheet:approve', sheet): boolean
```

Pure functions, no I/O, exhaustively unit-tested — the permission matrix in US-104 is a table-driven test over
every role × action × resource-relationship combination. Applied at the **service** layer, not the route layer,
so a new route cannot forget it.

---

## 7. Background jobs

### pg-boss

**Why this is the standout choice.** PRD requires scheduled escalation evaluation (US-901), notification
dispatch (US-1201/1202), background CSV export (US-1002), and digest emails. The reflexive answer is BullMQ,
which requires Redis.

pg-boss provides durable queues, cron scheduling, retries with exponential backoff, dead-letter queues, and
job archival — **entirely inside PostgreSQL.** So:

- **Zero new infrastructure.** No Redis to run, pay for, secure, back up, or monitor. Principle 1, directly.
- **Jobs are transactional with data.** Approving a sheet and enqueuing its notification happen in one
  transaction. With Redis they cannot, which produces the classic dual-write failure: the sheet is approved but
  the notification vanished, or fires for a rollback that never committed.
- **Durability comes free.** Jobs inherit Postgres's guarantees and Neon's backups.

The tradeoff is throughput — pg-boss handles hundreds of jobs/second, not tens of thousands. This application
needs *dozens per day*. The tradeoff is not real here.

**This is precisely why the escalation engine gets fixed properly.** F-08's engine only runs when an admin
clicks a button, and fabricates day counts. With pg-boss it becomes a cron job with real deadlines from
`CyclePhase.endsAt`.

**Rejected:** BullMQ (+Redis: better throughput this app cannot use, at the cost of a service and dual-write
inconsistency) · Inngest (great DX, external dependency and pricing, jobs can't be transactional with our DB) ·
Vercel Cron (HTTP-triggered only, subject to the same function timeout that already caused problems — see
[vercel.json](backend/vercel.json) `maxDuration: 10` and commit `6b23485`) · `node-cron` in-process (no
durability; a restart mid-job loses it, and it does not survive horizontal scaling).

### Worker topology

`apps/worker` runs as a **separate Railway process** from `apps/api`, sharing `packages/db` and
`packages/core`. Separation means a long export cannot degrade API latency, and the two scale independently.

---

## 8. Supporting services

### Email — Resend + React Email

Templates authored as React components in `packages/emails`, type-checked and previewable in Storybook-like
dev mode. Good deliverability, simple API, generous free tier. **Rejected:** SendGrid/Mailgun (heavier APIs,
worse DX) · SES (cheapest at volume, most setup; the right migration target if volume ever justifies it) ·
Nodemailer + SMTP (deliverability becomes our problem).

Abstracted behind `packages/core/notifications` so the provider is swappable — and because US-1202 requires
in-app and email to be two channels of one notification concept.

### File storage — Cloudflare R2

For generated CSV/XLSX exports (US-1002), served via time-limited signed URLs. S3-compatible, **zero egress
fees**, which matters for a download-heavy feature. **Rejected:** S3 (egress cost) · storing blobs in Postgres
(works at this size but bloats backups and complicates the branching workflow).

### Product analytics — PostHog

Required to actually measure PRD §8. Self-hostable and EU-cloud available, satisfying §9 data residency.
**Rejected:** Google Analytics (GDPR friction, weak product-analytics model) · Mixpanel/Amplitude (pricing,
no self-host option at this tier).

---

## 9. Testing

Four layers, each with a distinct job. This is the mechanism behind [TASKS.md](TASKS.md)'s "verify after every
task" requirement.

| Layer | Tool | Scope | Speed | Runs |
|---|---|---|---|---|
| **Unit** | Vitest | `packages/core` — scoring, weightage, policy, escalation rules. Pure functions, no I/O. | < 2s | Every save |
| **Integration** | Vitest + Supertest + **Testcontainers** | API routes against **real Postgres** with real constraints, real transactions, real Prisma | ~30s | Every task |
| **Contract** | Zod schema round-trip | Every request/response validates against `packages/contracts` | < 1s | Every task |
| **E2E** | Playwright | Full cycle happy path through a real browser | ~2min | Pre-merge, nightly |

**Why Testcontainers rather than mocks or an in-memory database.** The prototype's most dangerous bugs are
persistence-layer bugs: F-03's destructive `updateMany`, F-04's unvalidated overwrite, F-05's constraint
bypass. A mocked Prisma client cannot catch any of them. Testcontainers spins up disposable real Postgres, so
`UNIQUE (user_id, cycle_id)` and foreign keys are genuinely exercised. In CI, Neon branches do the same job
faster.

**Coverage targets** (PRD §8.5): `packages/core` ≥ 90%, overall ≥ 80%, enforced in CI as a hard gate.

**Two mandatory test suites, each asserting a PRD invariant directly:**

1. **Permission matrix** — every role × every endpoint × expected status. Fails the build if a new route is
   added without an entry. Closes F-01.
2. **Audit completeness** — every mutating service call must produce an `AuditEvent`. Enumerates the service
   layer by reflection so a new mutation without auditing fails. Closes F-09.

**Rejected:** Jest (slower, worse ESM/TS story than Vitest, which also shares Vite config with the frontend) ·
Cypress (Playwright has better parallelism, multi-browser, and trace debugging) · `mongodb-memory-server`
equivalents (see above).

---

## 10. Observability

| Concern | Tool | Why |
|---|---|---|
| Errors | **Sentry** | Both apps; source maps; release tracking; free tier sufficient |
| Logs | **pino** → Railway | Structured JSON with request-ID correlation; `pino-pretty` locally |
| Uptime | **Better Stack** | Probes `/healthz`; alerts on the escalation job's heartbeat (PRD §8.5 demands 100% job success) |
| Performance | Sentry tracing | p95 latency against the §8.5 targets |
| DB | Neon dashboard + `pg_stat_statements` | Slow query identification |

Every request carries an `x-request-id`, logged on the server and attached to Sentry events, so a user-reported
error maps to its exact log trace.

---

## 11. Deployment

### Topology

```
┌──────────────┐     ┌───────────────────────────┐     ┌────────────┐
│   Vercel     │     │         Railway           │     │   Neon     │
│              │────▶│  ┌─────────┐ ┌──────────┐ │────▶│            │
│  apps/web    │     │  │  api    │ │  worker  │ │     │ PostgreSQL │
│  static SPA  │◀────│  │ Express │ │ pg-boss  │ │◀────│ + branches │
│  global CDN  │     │  └─────────┘ └──────────┘ │     │            │
└──────────────┘     └───────────────────────────┘     └────────────┘
                                  │                          ▲
                        ┌─────────┴─────────┐                │
                        ▼                   ▼                │
                  ┌──────────┐       ┌────────────┐          │
                  │  Resend  │       │ Cloudflare │          │
                  │  email   │       │     R2     │          │
                  └──────────┘       └────────────┘          │
                                                             │
                    GitHub Actions ── migrations ────────────┘
```

### Frontend → Vercel

A static SPA build is Vercel's ideal workload: global CDN, atomic deploys, instant rollback, preview URL per
PR, free at this scale. Already in use.

### API + worker → Railway (moved off Vercel)

**This is a required change, and the repo history shows why.** Commit `6b23485` reduced the MongoDB timeout to
8s specifically to fit inside Vercel's 10s function limit — the platform was already constraining the
application. [vercel.json](backend/vercel.json) still pins `maxDuration: 10`.

Serverless functions cannot host this architecture:

- **pg-boss needs a persistent process** that holds a connection and polls. Serverless has no such thing.
- **Export and escalation jobs exceed 10s** at realistic data volumes.
- **Connection pooling** — every serverless invocation opening a database connection is the pathology the
  prototype's `isConnected` boolean is trying and failing to work around. A persistent process holds one pool.

Railway gives persistent containers, private networking between api and worker, per-service scaling, and
sensible pricing (~\$5–20/month here).

**Rejected:** Vercel functions (above) · Render (comparable; Railway's DX and private networking are better) ·
Fly.io (excellent, more operational surface than needed) · AWS ECS/Lambda (weeks of configuration, principle 1).

### Database → Neon

Production on the `main` branch; every PR gets an ephemeral branch for CI integration tests; a `dev` branch for
local development. Point-in-time recovery covers the migration-mistake case.

### Migrations

`prisma migrate deploy` runs in GitHub Actions **before** the API deploy, gated on tests passing. Never at
application startup — the prototype's implicit-schema approach is exactly what produces undetected drift. All
migrations must be backward-compatible for one release (expand/contract), so a rollback doesn't strand the
database.

### Environments

| Env | Frontend | API | Database |
|---|---|---|---|
| Local | Vite dev | `tsx watch` | Docker Postgres or Neon `dev` branch |
| Preview (per PR) | Vercel preview | Railway PR env | Neon branch, auto-created |
| Production | Vercel prod | Railway prod | Neon `main` |

---

## 12. CI/CD

**GitHub Actions**, because the code is already there and the free tier covers this comfortably.

```
push / PR
   ├── install (pnpm, cached)
   ├── turbo lint          ─┐
   ├── turbo typecheck      ├─ parallel
   ├── turbo test:unit     ─┘
   ├── test:integration    ── Neon branch, real Postgres
   ├── turbo build
   ├── coverage gate       ── core ≥90%, overall ≥80%
   └── on main:
        ├── prisma migrate deploy
        ├── deploy api + worker (Railway)
        └── deploy web (Vercel)
```

`pnpm verify` runs the first six steps identically on a developer machine. **That is the automation contract in
[TASKS.md](TASKS.md):** the gate a developer runs after every task is byte-identical to the gate CI runs, so
"works locally" and "passes CI" cannot diverge.

Turborepo's content-hash cache means an unchanged package is skipped entirely — which is what keeps a
per-task gate fast enough that it actually gets run.

---

## 13. What this stack fixes, mapped to the audit

Direct traceability from [PLAN.md](PLAN.md) findings to the choice that closes them:

| Finding | Closed by |
|---|---|
| **F-01** unauthenticated API | Better Auth + policy layer at the service boundary + permission matrix test + CORS allowlist |
| **F-02** hardcoded employee, unscoped reads | `User` table + org-scoped Prisma queries + cross-tenant test on every read endpoint |
| **F-03** destructive cycle switch | `ReviewCycle` rows + FK constraints; no global mutable state exists to overwrite |
| **F-04** unvalidated check-in overwrite | Zod field whitelist in `packages/contracts`, enforced server-side |
| **F-05** cascade bypasses validation | Shared validator in `packages/core` + FK `ownerUserId` making name-joins unrepresentable |
| **F-06** title-substring scoring | `direction` as a Postgres enum and a TS union type |
| **F-07** duplicated client scoring | Single implementation in `packages/core`, called only server-side |
| **F-08** fake escalation engine | pg-boss cron + real `CyclePhase.endsAt` deadlines |
| **F-09** near-empty audit trail | Prisma `$transaction` wrapping every mutation + audit-completeness test |
| **F-10** inconsistent validation | One Zod schema in `packages/contracts` imported by all call sites |
| **F-11** CSV injection | Hardened serializer in `packages/core`, unit-tested against injection vectors |
| **F-12** hardcoded URLs | `VITE_API_URL` + generated typed API client |
| **F-13** in-memory analytics | SQL `GROUP BY` + indexes + pagination |
| **F-14** no tests, `alert()` UX | Vitest/Playwright/CI gate + TanStack Query + `sonner` |

---

## 14. Version pinning

Exact versions are resolved at install time in Wave 0 and committed via `pnpm-lock.yaml`. Policy:

- **Pin exact** for anything load-bearing: Prisma, Better Auth, pg-boss.
- **Caret ranges** for well-behaved libraries: React, Tailwind, Zod.
- **Renovate** for automated dependency PRs, grouped and gated on the same `verify` job — no dependency
  merges without the full gate.
- Node version pinned via `.nvmrc` and `engines`, matched exactly in CI and on Railway.
