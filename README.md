# AuraPMS — Enterprise Performance Management

[![CI](https://github.com/KaushikVipransh/AURA-PMS/actions/workflows/ci.yml/badge.svg)](https://github.com/KaushikVipransh/AURA-PMS/actions/workflows/ci.yml)

Performance management for mid-size organizations: structured goal setting with enforced weightage rules,
continuous check-ins, appraisal and calibration, and a compliance engine that chases deadlines so HR doesn't
have to.

> **Status: under active reconstruction.**
> The original hackathon prototype demonstrated the product with a single hardcoded user and no authentication.
> It is being rebuilt into a complete application against a documented plan. See
> [Where this is going](#where-this-is-going) for what works today and what doesn't.

---

## Contents

- [Quick start](#quick-start)
- [Repository layout](#repository-layout)
- [The verify gate](#the-verify-gate)
- [How work gets done here](#how-work-gets-done-here)
- [Where this is going](#where-this-is-going)
- [Documentation](#documentation)

---

## Quick start

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node | **22.17.1** | Pinned in `.nvmrc`. Use `nvm use` if you have nvm. |
| pnpm | **11.x** | `npm install -g pnpm` |
| Docker Desktop | any recent | Must be **running** before `docker compose up` — starting the app is not enough on a fresh boot. |

### Five commands

```bash
git clone https://github.com/KaushikVipransh/AURA-PMS.git
cd AURA-PMS
pnpm install
cp .env.example .env          # defaults already match docker-compose.yml
docker compose up -d          # Postgres 17 on localhost:5433
```

Then confirm everything is wired up:

```bash
pnpm verify
```

That should print `Tasks: 28 successful, 28 total` and exit 0.

### Running the app

```bash
pnpm dev                      # every app in parallel
pnpm --filter web dev         # just the frontend
```

> The API is still the prototype's Express + MongoDB server and is mid-migration to Prisma + Postgres. It will
> not run against the Postgres container until Wave 1 lands. The frontend builds and runs today.

---

## Repository layout

pnpm workspaces + Turborepo.

```
apps/
  web/          React 19 + Vite single-page app
  api/          Express REST API
  worker/       pg-boss job processor — escalations, notifications, exports
packages/
  core/         Pure domain logic: scoring, weightage, policy. No I/O, enforced by lint.
  contracts/    Zod schemas shared by API and web — the API contract
  db/           Prisma schema, client, migrations, seed
  config/       Shared tsconfig, ESLint, Prettier
```

Two boundaries carry most of the design:

**`packages/contracts` is the single definition of every API shape.** One Zod schema serves runtime validation
on the server, form validation on the client, the TypeScript type both sides share, and the generated OpenAPI
document. The prototype had the same weightage rule written four different ways in four places; this makes that
impossible.

**`packages/core` is pure and stays that way.** No database, no HTTP, no filesystem — enforced by an ESLint
`no-restricted-imports` rule, not by convention. Anything needing I/O belongs in a service in `apps/api`, which
may import core freely. Never the other way round.

---

## The verify gate

One command, run after every task, identical to what CI runs:

```bash
pnpm verify              # lint · typecheck · test · build
```

| Command | Scope |
|---|---|
| `pnpm verify` | The gate. Must be green before any commit. |
| `pnpm verify:integration` | Adds integration tests against real Postgres (from W1-12) |
| `pnpm verify:full` | Adds Playwright end-to-end (from W7-06) |
| `pnpm format` | Prettier. Not in the gate — see below. |

Turborepo caches by content hash, so a warm `pnpm verify` finishes in well under a second against roughly 30s
cold. That margin is deliberate: a gate you actually run beats a thorough one you skip.

**Coverage thresholds** are enforced in CI — `packages/core` at 90%, other TypeScript packages at 80%.
`apps/api` and `apps/web` report coverage but have no threshold yet, because both are still the prototype's
JavaScript and there is nothing to measure. Thresholds arrive with their TypeScript migrations.

**`format:check` is deliberately outside the gate** until the prototype's pages are rewritten. Reformatting
files that are scheduled for replacement would bury real diffs in whitespace noise. Prettier applies to new
code; run it per-file as pages get rewritten.

---

## How work gets done here

Every change maps to a numbered task in [TASKS.md](TASKS.md) — 98 tasks across 8 dependency-ordered waves.
Waves are sequential; **within** a wave, tasks touch disjoint files and can be done in any order.

The loop for a single task:

```
1. Read the task's Do / Done when.
2. Implement it — nothing beyond its scope.
3. pnpm verify                    ← must be green
4. Fix anything red. Repeat 3.
5. Tick the checkbox in TASKS.md.
6. git commit -m "type(scope): summary [TASK-ID]"
```

Two rules that matter more than they look:

- **Never weaken a test, lint rule, or type to get green.** If a rule is wrong, change it deliberately and say
  why in the commit.
- **If a task can't go green without touching files outside its scope, stop.** The task was scoped wrong.
  Split it rather than widening it silently.

Working in Claude Code? `/next-task` runs the loop above for the next unchecked task; `/next-task W2` restricts
it to a wave.

Branches are one per wave — `wave/0-harness`, `wave/1-data`, and so on. Commits are
`type(scope): summary [TASK-ID]`.

---

## Where this is going

**What works today:** the frontend builds and runs; the monorepo, type checking, linting, tests, coverage
gates, and CI are all in place.

**What doesn't, yet:** there is no authentication, no user model, and no review-cycle concept. The API still
runs on MongoDB with a single hardcoded employee. None of that is a backlog of unrelated bugs — it is one
structural absence with many symptoms, diagnosed in [PLAN.md](PLAN.md).

| Wave | Focus |
|---|---|
| **0** | Harness — monorepo, TypeScript, lint, tests, CI |
| **1** | Data foundation — Prisma, Postgres, the full schema |
| **2** | Pure domain logic — scoring, weightage, policy, escalation rules |
| **3** | Identity — users, real auth, org-scoped permissions |
| **4** | API surface — every user story over HTTP, validated and audited |
| **5** | Jobs — scheduled escalation, notifications, exports |
| **6** | Frontend — TypeScript, real UI for every flow |
| **7** | Production readiness — observability, deploy, E2E, load test |

Roughly 11 weeks of solo work. Live progress is in the table at the top of [TASKS.md](TASKS.md).

---

## Documentation

| Document | What it's for |
|---|---|
| [PLAN.md](PLAN.md) | Architecture review of the prototype — 14 findings, ranked, with the fix for each |
| [PRD.md](PRD.md) | Goals, personas, user stories, feature list, success metrics |
| [TECH_STACK.md](TECH_STACK.md) | Every technology choice with its justification and the alternatives rejected |
| [TASKS.md](TASKS.md) | The 98-task build plan, with per-task verification |

---

## License

ISC
