# AuraPMS — Build Task List

**Version** 1.0 · **Date** 10 August 2026
**Derived from** [PRD.md](PRD.md) + [TECH_STACK.md](TECH_STACK.md) · **Audit context** [PLAN.md](PLAN.md)

---

## How to use this document

### On "atomic with no interdependencies"

Full independence is not achievable — you cannot write the auth middleware test before a `User` table exists,
and no amount of task decomposition changes that. Pretending otherwise produces a list that breaks on contact
with the first task.

What *is* achievable, and what this list delivers:

- **Waves** are ordered. Wave *N* may depend on wave *N−1* being complete.
- **Within a wave, tasks are genuinely independent.** They touch disjoint files, can be done in any order or in
  parallel, and no task in a wave blocks another in the same wave.
- **Every task is independently verifiable.** Each has a self-contained Definition of Done and a single command
  that proves it. No task is "done" pending some later task.
- **Every task is one sitting.** Estimates run 30 minutes to 3 hours. Anything larger was split.

Three structural choices make the within-wave independence real rather than aspirational:

1. **Prisma multi-file schema** (`prismaSchemaFolder`) — each model is its own `.prisma` file, so Wave 1's
   model tasks never collide.
2. **`packages/core` is pure** — no I/O, no database, no HTTP. Wave 2's tasks are pure functions with unit
   tests and depend on nothing but TypeScript.
3. **One router file per domain** — Wave 4's endpoint tasks each own a distinct file.

### The automation contract

Every task ends with the same gate. It is one command, it is identical to what CI runs, and it is
non-negotiable:

```bash
pnpm verify
```

which is defined in Wave 0 as:

```jsonc
// package.json
"scripts": {
  "verify":  "turbo run lint typecheck test build",
  "verify:integration": "turbo run test:integration",
  "verify:full": "pnpm verify && pnpm verify:integration && pnpm test:e2e"
}
```

**The per-task loop — run this for every single task:**

```
1. Read the task's Do / Done when.
2. Implement it. Nothing beyond its scope.
3. pnpm verify                       ← must be green
4. Fix anything red. Repeat 3.
5. Tick the checkbox in this file.
6. git commit -m "<type>(<scope>): <summary> [<TASK-ID>]"
```

If step 3 cannot go green without touching a file outside the task's scope, **stop** — the task was scoped
wrong. Note it in the task and split it rather than widening it silently.

### Automating the loop

A Claude Code command is provided at [`.claude/commands/next-task.md`](.claude/commands/next-task.md). Running
`/next-task` picks the first unchecked task, implements it, runs the gate, fixes failures, ticks the box, and
commits. `/next-task W2` restricts it to a wave.

CI enforces the same gate on every push, so a bypassed local gate is caught before merge.

### Conventions

| | |
|---|---|
| Commit format | `type(scope): summary [TASK-ID]` — e.g. `feat(core): add weightage validator [W2-02]` |
| Branch | One branch per wave: `wave/0-harness`, `wave/1-data`, … |
| Definition of Done | Gate green **+** the task's stated criteria **+** committed |
| Estimates | Solo developer, focused. Total ≈ 175h ≈ 10–11 weeks at 20h/week |

### Progress

| Wave | Tasks | Est. | Status |
|---|---|---|---|
| [W0 — Harness](#wave-0--harness) | 8 | 12h | **8/8 ✅** |
| [W1 — Data foundation](#wave-1--data-foundation) | 14 | 22h | **14/14 ✅** |
| [W2 — Pure domain logic](#wave-2--pure-domain-logic) | 10 | 20h | ☐ |
| [W3 — Auth & identity](#wave-3--auth--identity) | 9 | 20h | ☐ |
| [W4 — API surface](#wave-4--api-surface) | 21 | 42h | ☐ |
| [W5 — Jobs & notifications](#wave-5--jobs--notifications) | 7 | 15h | ☐ |
| [W6 — Frontend](#wave-6--frontend) | 19 | 40h | ☐ |
| [W7 — Production readiness](#wave-7--production-readiness) | 10 | 22h | ☐ |
| **Total** | **98** | **193h** | |

---

## Wave 0 — Harness

> **Goal:** the gate exists and is green before any product code is written.
> **Sequential caveat:** W0-01 must land first; W0-02…W0-08 are independent after it.

- [x] **`W0-01` · Create the pnpm + Turborepo skeleton**
  **Est** 2h
  **Do:** Initialize `pnpm-workspace.yaml` with `apps/*` and `packages/*`. Create empty `apps/web`, `apps/api`,
  `apps/worker`, `packages/db`, `packages/contracts`, `packages/core`, `packages/config`, each with a minimal
  `package.json`. Add `turbo.json` defining the `lint`, `typecheck`, `test`, `build` pipelines. Move the
  existing `frontend/` into `apps/web` and `backend/` into `apps/api` unchanged — no code edits.
  **Done when:** `pnpm install` succeeds from root; `pnpm turbo run build` executes for every package (even if
  some are no-ops); the old top-level `frontend/` and `backend/` directories no longer exist.
  **Verify:** `pnpm install && pnpm turbo run build`

  > **Note (W0-01):** Two deviations from [TECH_STACK.md](TECH_STACK.md), neither blocking.
  > **(1) Node 22.17.1, not 24.** That is what is installed on the dev machine; every dependency in the stack
  > supports it. `.nvmrc` and `engines` are pinned to 22 accordingly. Upgrading to 24 later is a one-line change
  > to both — do it before W7-03 so CI, Railway, and local all match.
  > **(2) pnpm installed via `npm i -g pnpm`, not corepack.** `corepack enable` fails with `EPERM` on this
  > machine because Node lives in `C:\Program Files\nodejs`. Version is still pinned via the root
  > `packageManager` field, so the outcome is equivalent.
  >
  > Turbo resolved to 2.10.9. The six `no output files found` warnings are expected — placeholder `echo no-op`
  > build scripts produce no artifacts, and they disappear as real builds land in W0-02 onward.

- [x] **`W0-02` · Shared TypeScript config package**
  **Est** 1h
  **Do:** `packages/config/tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `moduleResolution: bundler`. Add `tsconfig.node.json` and
  `tsconfig.react.json` variants. Every package extends one.
  **Done when:** `pnpm turbo run typecheck` runs across all packages and reports zero config errors.
  **Verify:** `pnpm turbo run typecheck`

  > **Note (W0-02):** `apps/web` and `apps/api` are still JavaScript, so both set `allowJs: true` +
  > `checkJs: false` and are wired to the shared base anyway — they gain real checking when W6-01 and Waves 3-4
  > convert them. `apps/web/jsconfig.json` was deleted in favour of `tsconfig.json` (paths alias preserved).
  > `packages/config` keeps a no-op typecheck: it ships JSON, not TypeScript. Strictness was proven live by a
  > throwaway probe — `xs[0]` correctly errored as `string | undefined` under `noUncheckedIndexedAccess`.

- [x] **`W0-03` · Shared ESLint + Prettier config**
  **Est** 1h
  **Do:** `packages/config/eslint.config.js` (flat config) with `typescript-eslint` recommended-type-checked,
  `eslint-plugin-react-hooks`, and an `import/no-restricted-paths` rule forbidding `packages/core` from
  importing anything with I/O. Prettier config + `.editorconfig`.
  **Done when:** `pnpm turbo run lint` passes on all packages; the restricted-path rule is proven by a
  deliberately bad import that errors, then removed.
  **Verify:** `pnpm turbo run lint`

  > **Note (W0-03):** Purity is enforced with the built-in `no-restricted-imports` rather than
  > `import/no-restricted-paths` — it expresses "core may not import I/O" directly and avoids pulling in
  > `eslint-plugin-import`. Proven live: importing `node:fs` from `@aura/core` errors with the intended message.
  >
  > Linting the prototype surfaced 25 real findings, all in code with a scheduled rewrite date. They are
  > **quarantined in two scoped blocks, not fixed**, because W1-14 and Wave 4 replace `apps/api/server.js` and
  > Waves 2/6 replace the pages:
  > - `apps/api` — 16 `catch (error)` bindings that are never used or logged (part of F-14). Remove the block at
  >   **W1-14**.
  > - `apps/web/src/pages` — unused catch bindings and dead state (F-14), a useless `progressFraction`
  >   assignment in the duplicated scoring code (F-07), and `react-hooks/immutability` on the fetch-in-effect
  >   pattern (F-12). Remove entries as **W6-06 … W6-11** land.
  >
  > One permanent override: `src/components/ui/**` allows `react-refresh/only-export-components`, since shadcn
  > exports a component and its cva variants from the same module upstream.
  >
  > `pnpm format` is **not** run over the legacy tree — reformatting files scheduled for rewrite would bury the
  > real diffs. Prettier applies to new code; run it per-file as pages get rewritten. `format:check` is
  > deliberately outside `pnpm verify` until Wave 6 completes.

- [x] **`W0-04` · Vitest setup with coverage thresholds**
  **Est** 1.5h
  **Do:** Root `vitest.workspace.ts`. Per-package `vitest.config.ts`. Coverage via v8 with thresholds:
  `packages/core` ≥ 90%, global ≥ 80%. Add one trivial passing test per package so the runner has work.
  **Done when:** `pnpm turbo run test` passes and prints a coverage table; artificially dropping a threshold
  fails the run.
  **Verify:** `pnpm turbo run test`

  > **Note (W0-04):** Vitest resolved to 4.1.10, which **removed `vitest.workspace.ts`** — the root config uses
  > `test.projects` instead. Turborepo runs tests per package anyway, so the root config only serves watch mode
  > and IDE integration.
  >
  > Thresholds: `@aura/core` 90%, `@aura/contracts` / `@aura/db` / `worker` 80%. `apps/api` and `apps/web` get
  > coverage reporting but **no thresholds yet** — both are still the prototype's JavaScript, so there is no
  > TypeScript source to measure. Thresholds land with their migrations (Waves 3-4 and W6-01).
  >
  > With only placeholder modules the thresholds pass vacuously (0/0 statements reports as 100%), so enforcement
  > was proven with a throwaway probe: an untested exported function dropped core to 0% and correctly failed the
  > run against the 90% threshold on all four metrics.

- [x] **`W0-05` · Define the `verify` gate**
  **Est** 0.5h
  **Do:** Add the `verify`, `verify:integration`, `verify:full` scripts from §"The automation contract" to the
  root `package.json`.
  **Done when:** `pnpm verify` runs lint + typecheck + test + build in one command and exits non-zero if any
  stage fails.
  **Verify:** `pnpm verify`

  > **Note (W0-05):** The scripts were added in W0-01; this task proved the gate end to end. **28 tasks across
  > 7 packages, exit 0** — and exit 1 with `Failed: @aura/core#lint` while a real config bug was outstanding, so
  > the non-zero path is confirmed rather than assumed.
  >
  > Warm runs are **68ms (FULL TURBO)** against ~32s cold. That margin is what makes a per-task gate something
  > you actually run rather than skip.
  >
  > `format:check` is deliberately **not** in the gate — see the W0-03 note on the legacy tree.

- [x] **`W0-06` · GitHub Actions CI running the same gate**
  **Est** 1.5h
  **Do:** `.github/workflows/ci.yml` — Node 24 via `.nvmrc`, pnpm with store caching, Turborepo cache, then
  `pnpm verify`. Trigger on push and pull_request. Add a status badge to the README.
  **Done when:** a pushed commit shows a green CI run; a deliberately broken commit shows red, then is fixed.
  **Verify:** `gh run list --limit 1` shows success

  > **Note (W0-06):** Verified end to end against the real runner, both directions:
  > - `4422d2f` (clean) → **success** in ~60s
  > - `0aebdc8` (a deliberate `const x: number = 'string'` in `@aura/core`) → **failure** in ~40s
  > - `4c44f79` (revert) → **success**
  >
  > The negative case matters: without it a workflow that silently passes everything looks identical to a
  > working one. Both unprovable-locally assumptions held — `pnpm/action-setup@v4` picked up pnpm from the root
  > `packageManager` field, and `actions/setup-node@v4` read `.nvmrc` (22.17.1, not the 24 in TECH_STACK.md —
  > see the W0-01 note).
  >
  > `gh` is not installed here; run status was polled from the public REST API at
  > `/repos/:owner/:repo/actions/runs?branch=…`, which needs no auth for a public repo.

- [x] **`W0-07` · Local Postgres via Docker Compose**
  **Est** 1h
  **Do:** `docker-compose.yml` with Postgres 17 on a non-default port, a named volume, and a healthcheck.
  `.env.example` documenting every variable the project will use. `.env` added to `.gitignore` (verify the
  existing entries still apply after the move).
  **Done when:** `docker compose up -d` yields a reachable database; `psql` connects using the documented URL.
  **Verify:** `docker compose up -d && docker compose exec -T db pg_isready`

  > **Note (W0-07):** Postgres **17.10-alpine**, container `aurapms-db`, healthcheck reporting `healthy`. Host
  > port is **5433**, not 5432, so it never collides with an existing local Postgres — `DATABASE_URL` in
  > `.env.example` reflects that. Verified three ways: `pg_isready` accepting connections, `psql` round-trip via
  > the documented URL, and a host-side TCP check on 5433.
  >
  > Docker Desktop was installed but not running; it had to be started before `compose up` would work. Worth
  > mentioning in the README prerequisites (W0-08).
  >
  > Gitignore confirmed against what git will actually stage: `.env` and `apps/api/.env` ignored,
  > `.env.example` stageable. Note that `git check-ignore -v` is **not** a reliable test here — it exits 0 on
  > negation matches too, which reads as a false positive. Use `git ls-files --others --exclude-standard`.

- [x] **`W0-08` · Contributor documentation**
  **Est** 1.5h
  **Do:** Rewrite the root `README.md`: what it is, the monorepo layout, prerequisites, a 5-command local
  setup, the task loop, and the verify gate. **Remove the false "verified via a programmatic end-to-end
  regression test suite" claim** ([PLAN.md](PLAN.md) §1).
  **Done when:** a clean clone reaches a running dev environment following only the README; the false claim is
  gone.
  **Verify:** `pnpm verify` — and follow your own README on a fresh clone

  > **Note (W0-08):** The "verified via a programmatic end-to-end regression test suite" claim is **removed** —
  > it was false, and on a public repo it read as an overclaim. The README now states plainly what works and
  > what does not. The two remaining MongoDB mentions are accurate descriptions of the current API, not
  > leftovers.
  >
  > Prerequisites call out that **Docker Desktop must be running**, not merely installed — that cost time in
  > W0-07. The README also documents an honest limitation: the API will not run against the Postgres container
  > until Wave 1 lands, since it is still on Mongoose.
  >
  > The fresh-clone walkthrough has **not** been executed literally (no second clone on this machine). Every
  > command in it was run in this working tree, and all seven referenced files were confirmed to exist.

---

## Wave 1 — Data foundation

> **Goal:** the complete schema exists, with constraints, migrations, and a realistic seed.
> **Independence:** W1-01 first (Prisma init). W1-02…W1-11 each own one `.prisma` file and are fully parallel.

- [x] **`W1-01` · Prisma init with multi-file schema**
  **Est** 1.5h
  **Do:** Install Prisma in `packages/db`. Enable `prismaSchemaFolder`. Create `prisma/schema/schema.prisma`
  holding only the datasource, generator, and shared enums. Export a singleton `PrismaClient` with the pino
  logger attached.
  **Done when:** `pnpm --filter @aura/db prisma migrate dev --name init` produces a migration; the generated
  client imports and type-checks from another package.
  **Verify:** `pnpm verify`

  > **Note (W1-01): Prisma resolved to 7.9.1, not the 6 in TECH_STACK.md.** Version 7 changed enough to matter,
  > and later tasks need to know:
  > - **`url` is no longer allowed in `datasource`.** The connection moves to `prisma.config.ts` for the CLI,
  >   and reaches the runtime client through a **driver adapter** — `@prisma/adapter-pg` + `pg`. Added both.
  > - **`prisma migrate` needs `datasource.url` in `prisma.config.ts`** specifically; setting only the env var
  >   is not enough.
  > - **The generator is `prisma-client`, not `prisma-client-js`**, and emits `.ts` to an explicit `output`
  >   path rather than into `node_modules`. Output goes to `packages/db/generated/` — gitignored, lint-ignored,
  >   regenerate with `pnpm db:generate`. It typechecks cleanly under our strict flags, which was not a given.
  > - **pnpm blocks Prisma's postinstall by default.** `allowBuilds` in `pnpm-workspace.yaml` enables
  >   `@prisma/engines` and `prisma`; without it the query engine binaries never download.
  >
  > Multi-file schema (`prisma/schema/`) is **GA in 7** — no preview flag needed. `schema.prisma` holds the
  > datasource, generator, and the five enums shared by two or more models; every model gets its own file, which
  > is what keeps W1-02 … W1-11 free of collisions.
  >
  > **Design fix found by the gate:** the first version constructed the PrismaClient eagerly at module load, so
  > importing a single *enum* from `@aura/db` opened a database connection — which broke `apps/api`'s tests
  > immediately and would have broken every consumer without a database (`packages/core` unit tests, the
  > contract schemas, any typecheck-only CI job). It is now a lazy proxy: construction is deferred to first
  > property access, and `prisma.user.findMany()` ergonomics are unchanged. `src/client.test.ts` locks this in
  > with a regression test, and covers the missing-`DATABASE_URL` error, singleton reuse, method binding, and
  > disconnect — 100% statements/functions on the file.

- [x] **`W1-02` · `Organization` model** · **Est** 1h
  **Do:** `prisma/schema/organization.prisma` — `id`, `name`, `slug` (unique), `fiscalYearStart`, `settings`
  (Json), timestamps. Migration + a test asserting slug uniqueness is rejected at the DB level.
  **Done when:** migration applies; duplicate-slug insert throws.
  **Verify:** `pnpm verify`

- [x] **`W1-03` · `User` model with self-referential manager** · **Est** 1.5h
  **Do:** `user.prisma` — `id`, `orgId` FK, `email` (unique per org), `name`, `managerId` FK → User (nullable),
  `status` enum, timestamps. Index `(orgId, managerId)`. Test asserts the self-relation resolves and that a
  cross-org `managerId` is rejected.
  **Done when:** migration applies; both tests pass.
  **Verify:** `pnpm verify`

- [x] **`W1-04` · `Team` model** · **Est** 1h
  **Do:** `team.prisma` — `orgId`, `name`, `leadId` FK → User, `parentTeamId` FK → Team (nullable). Optional
  `User.teamId`.
  **Done when:** migration applies; a two-level team hierarchy can be created in a test.
  **Verify:** `pnpm verify`

  > **Note (W1-02 / W1-03 / W1-04): shipped as one migration, `20260811104453_identity`.** They cannot be
  > separated: `User.teamId → Team` and `Team.leadId → User` are mutually referential, so either table alone
  > fails to create. 13 integration tests cover all three.
  >
  > **Cross-org managers are rejected by Postgres, not by application code.** `User` carries
  > `@@unique([id, orgId])`, and the manager self-relation is the composite FK
  > `(managerId, orgId) → (id, orgId)`. Pointing at a manager in another tenant finds no matching row and the
  > insert fails. Null `managerId` still works — a composite FK with a NULL column passes under MATCH SIMPLE —
  > so the reporting chain still has a top. This makes the tenancy boundary structural rather than something
  > every future query has to remember.
  >
  > **`prisma generate` is now wired into `build` and `postinstall`.** `generated/` is gitignored, so a fresh
  > clone and CI would otherwise have no client at all. Verified by deleting `generated/` and every turbo cache:
  > `pnpm verify` regenerates and passes 28/28. Note that `pnpm install` alone is **not** sufficient — it
  > short-circuits with "Already up to date" and skips postinstall. `@aura/db`'s lint/typecheck/test tasks
  > therefore declare an explicit dependency on `@aura/db#build` in turbo.json.
  >
  > Email uniqueness is `@@unique([orgId, email])` — the same address in two tenants is two different people.

- [x] **`W1-05` · `ReviewCycle` + `CyclePhase` models** · **Est** 1.5h
  **Do:** `cycle.prisma` — cycle with `orgId`, `name`, `fiscalYear`, `status` enum, `ratingScale` (Json
  snapshot per PRD US-203). Phase with `cycleId`, `key` enum, `label`, `startsAt`, `endsAt`. Partial unique
  index enforcing at most one `ACTIVE` cycle per org.
  **Done when:** migration applies; a second active cycle in the same org is rejected by the database.
  **Verify:** `pnpm verify`

  > **Note (W1-05):** This is the *time* axis from [PLAN.md](PLAN.md) §2. 9 integration tests.
  >
  > **The single-active-cycle rule is a hand-written partial unique index.** Prisma's schema language cannot
  > express `WHERE status = 'ACTIVE'`, so the migration was generated with `--create-only` and the index appended
  > before applying:
  > ```sql
  > CREATE UNIQUE INDEX "review_cycles_one_active_per_org"
  >   ON "review_cycles" ("orgId") WHERE "status" = 'ACTIVE';
  > ```
  > Enforcing it in Postgres means no service, seed, or bulk import can open a second active cycle by accident.
  > Tested from both sides: a second ACTIVE in one org is rejected, while many DRAFT/CLOSED cycles coexist and
  > two organizations may each hold one. **Use `--create-only` for any future constraint Prisma can't model.**
  >
  > `status` defaults to `DRAFT`, so a cycle is never live by accident. `ratingScale` is snapshotted onto the
  > cycle as JSON rather than referenced, so changing the scale later cannot rewrite a historical rating
  > (PRD US-203).

- [x] **`W1-06` · `GoalSheet` model** · **Est** 1.5h
  **Do:** `goalsheet.prisma` — `orgId`, `userId` FK, `cycleId` FK, `status` enum, `submittedAt`, `approvedAt`,
  `approverId`, `lockedAt`, `revision`. **`@@unique([userId, cycleId])`** — this is PRD US-202 and
  [PLAN.md](PLAN.md) F-03 fixed at the storage layer.
  **Done when:** migration applies; a second sheet for the same user+cycle is rejected by the database.
  **Verify:** `pnpm verify`

- [x] **`W1-07` · `Goal` model with explicit direction** · **Est** 1.5h
  **Do:** `goal.prisma` — `sheetId` FK, `thrustArea` enum, `title`, `uom` enum, **`direction` enum
  (`HIGHER_IS_BETTER` | `LOWER_IS_BETTER`)**, `target`, `weightage` Decimal(5,2), `actualAchievement`,
  `status` enum, `sharedGoalId` FK (nullable), `isPrimaryOwner`. This kills [PLAN.md](PLAN.md) F-06 at the
  schema level.
  **Done when:** migration applies; a test asserts `direction` has no default that silently guesses.
  **Verify:** `pnpm verify`

- [x] **`W1-08` · `SharedGoal` model** · **Est** 1h
  **Do:** `sharedgoal.prisma` — `orgId`, `cycleId`, **`ownerUserId` FK → User** (F-05's fix: a display-name
  string cannot be stored here), `audience` Json, template fields, `createdById`.
  **Done when:** migration applies; a test asserts inserting a non-existent owner id fails.
  **Verify:** `pnpm verify`

  > **Note (W1-06 / W1-07 / W1-08):** One migration, `20260811105710_goal_sheets`. 11 integration tests.
  >
  > **Correction to this document's parallelism claim** (see "On atomic with no interdependencies", point 1).
  > Prisma requires *both* sides of every relation, so adding `GoalSheet` also required a back-reference line in
  > `user.prisma` and `cycle.prisma`. Model files are therefore **nearly**, not perfectly, collision-free: a new
  > model adds one line to each related model's file. Two people working in parallel would hit a trivial
  > one-line merge, not a rewrite — but the original claim was too strong.
  >
  > **`Goal.direction` deliberately has no default**, verified two ways: Prisma's generated type makes it
  > required so omitting it will not compile, and a test queries `information_schema` to assert the column has no
  > database-level default either. A default would reintroduce F-06 in a quieter form — a silently wrong
  > direction nobody chose.
  >
  > **Weightage is `Decimal(5,2)`, not `Float`.** Float drift is precisely why the prototype ended up with
  > `Math.round(t) !== 100` in one route and a strict `!== 100` in another (F-10).
  >
  > `@@unique([sheetId, sharedGoalId])` means re-broadcasting a KPI cannot duplicate it on a sheet.
  > `SharedGoal.owner` is `onDelete: Restrict` — an owner cannot be deleted out from under a live KPI; deactivate
  > instead (PRD US-106).

- [x] **`W1-09` · `SheetRevision` model** · **Est** 1h
  **Do:** `revision.prisma` — `sheetId`, `revision` int, `snapshot` Json, `reason` enum
  (`SUBMIT`|`APPROVE`|`ADJUST`), `actorId`, `createdAt`. `@@unique([sheetId, revision])`. No update or delete
  path.
  **Done when:** migration applies; uniqueness enforced.
  **Verify:** `pnpm verify`

- [x] **`W1-10` · `Appraisal` model** · **Est** 1.5h
  **Do:** `appraisal.prisma` — `sheetId` unique FK, `selfRating`, `selfNarrative`, `selfSubmittedAt`,
  `managerRating`, `managerNarrative`, `managerSubmittedAt`, `finalRating`, `calibratedById`,
  `calibrationReason`, `releasedAt`, `acknowledgedAt`. Per-goal ratings as a child table.
  **Done when:** migration applies; the full appraisal lifecycle can be represented in a test.
  **Verify:** `pnpm verify`

  > **Note (W1-09 / W1-10):** One migration, `20260811110212_revisions_appraisals`. 10 integration tests.
  >
  > **`Appraisal` is the schema for the gap named in [PLAN.md](PLAN.md) §6** — the half of a PMS the prototype
  > did not have at all. It is built up in four stages on one row (self → manager → calibration → release), so
  > each stage keeps its own value, timestamp, and actor. A test asserts the manager's rating of 3 is still
  > readable after calibration moved the final to 4, which is what makes an adjustment defensible (PRD US-802).
  > Landing the schema now, even though the UI is W6-08/W6-11, is deliberate: it means the model does not churn
  > late.
  >
  > `SheetRevision` is append-only by construction — `@@unique([sheetId, revision])` makes a silent overwrite
  > fail rather than pass, and both `SheetRevision.actor` and `SharedGoal.owner` are `onDelete: Restrict`, since
  > an audit trail that loses its actor is not one. Deactivate people instead (PRD US-106).
  >
  > Caught by the gate: an unused destructured `user` in a test. Worth noting that **Vitest does not typecheck**
  > — all 42 integration tests passed while `tsc` was failing. The two checks are independent, which is why the
  > gate runs both.

- [x] **`W1-11` · `AuditEvent`, `Escalation`, `Notification` models** · **Est** 2h
  **Do:** Three files. `AuditEvent` — `orgId`, `actorId`, `action`, `entityType`, `entityId`, `before` Json,
  `after` Json, `ip`, `userAgent`, `createdAt`; indexed on `(orgId, entityType, entityId)` and
  `(orgId, createdAt)`. `Escalation` — `orgId`, `cycleId`, `subjectUserId`, `rule`, `dueAt`, `level`, `status`,
  `resolvedById`, `resolutionNote`. `Notification` — `userId`, `type`, `payload`, `channel`, `sentAt`,
  `readAt`.
  **Done when:** all three migrations apply and are queryable by their indexes.
  **Verify:** `pnpm verify`

  > **Note (W1-11):** One migration, `20260811110745_governance`. 12 integration tests. **The schema is now
  > complete** — 54 integration tests across all models.
  >
  > `AuditEvent.actor` is `onDelete: Restrict`: a trail that loses its actor is not a trail. `before`/`after`
  > are nullable JSON, and W2-09's builder redacts password hashes and tokens before they land, so a GDPR
  > erasure is never blocked by an audit row (PRD §9).
  >
  > `Escalation` carries `dueAt` from the cycle's phase dates and
  > `@@unique([cycleId, subjectUserId, rule])` — the nightly job must *update* the existing row, not pile up a
  > duplicate every night. `notifiedAt` is a timestamp array, one entry per notification actually sent, so the
  > chain is auditable rather than asserted. Different rules may breach for the same person simultaneously.
  >
  > `Notification` is a row per delivery with a status and a failure reason, replacing the prototype's chain —
  > which was a string on a document with nothing ever sent (F-08). `@@index([userId, readAt])` serves the
  > unread badge without a table scan.

- [x] **`W1-12` · Testcontainers integration-test harness** · **Est** 2h
  **Do:** `packages/db/src/testing.ts` — start a disposable Postgres container, run `migrate deploy`, expose
  `withTestDb()` giving each test an isolated transaction rolled back afterwards. Wire a `test:integration`
  turbo task.
  **Done when:** `pnpm verify:integration` runs a sample test against real Postgres and cleans up its
  container.
  **Verify:** `pnpm verify:integration`

  > **Note (W1-12): done ahead of W1-02 … W1-11, deliberately.** Those tasks assert *database-level* constraints
  > — unique indexes, foreign keys, enum types — which cannot be tested without a database. Order within a wave
  > is free, so the harness comes first.
  >
  > Postgres 17-alpine in a disposable container, provisioned with **`migrate deploy`** rather than `db push`,
  > so the same migration files that reach production are what tests execute against. A broken migration fails
  > here instead of on deploy.
  >
  > Isolation is transaction-per-test via `withTestDb()`, always rolled back — no truncation, so tests can run
  > in any order. **Caveat for every later task:** the body must use the `tx` it is handed. Writes through the
  > ambient `prisma` singleton fall outside the transaction and will not be undone.
  >
  > Three bugs the gate caught: `vitest.config.ts` also matched `*.integration.test.ts`, so the fast gate tried
  > to run them with no container (now excluded); the hand-rolled `TestDb` type omitted a different set of
  > methods than Prisma's real transaction client and would not assign (now derived to match); and the rollback
  > sentinel is an `Error` subclass rather than a `Symbol`, since throwing a non-Error loses the stack trace.
  >
  > 85s on first run (image pull), 18s cached. Integration stays **out** of `pnpm verify`, so the fast gate
  > needs no Docker.

- [x] **`W1-13` · Seed script — realistic organization** · **Est** 2.5h
  **Do:** `packages/db/prisma/seed.ts` — one org, 25 users across 4 teams with a 3-level reporting chain, two
  review cycles (one `CLOSED` with full history and ratings, one `ACTIVE` mid-goal-setting), goal sheets in
  every status, one shared goal, audit events, escalations. Deterministic via a fixed seed.
  **Done when:** `pnpm db:seed` on an empty database produces the full org; running it twice is idempotent.
  **Verify:** `pnpm verify && pnpm db:seed && pnpm db:seed`

  > **Note (W1-13):** Produces 25 users · 4 teams · 2 cycles · 50 sheets · 200 goals · 25 appraisals ·
  > 2 escalations. Both runs returned **identical counts**, so idempotency holds. The first run went against a
  > database carrying only migrations — integration tests use the disposable container, never this one — so the
  > from-empty condition is met.
  >
  > **Every id is written explicitly, never generated.** Two runs on two machines produce byte-identical data,
  > so a failing test is reproducible rather than "worked on mine". Everything upserts on its known id, which is
  > what makes a second run a no-op instead of a duplicate-key error.
  >
  > One seeded goal is titled *"Reduce cost per transaction"* on purpose — it contains the substring `cost`,
  > which used to flip scoring direction by accident (F-06). With `direction` explicit, the title is just a
  > title, and the seed data proves it.
  >
  > **`pnpm db:reset` is blocked for AI agents.** Prisma 7 refuses `migrate reset` from an agent without
  > recorded human consent, since it irreversibly destroys all data. That is a good guardrail and the script is
  > kept as-is — a human running it interactively is unaffected. Do not work around it; if an agent needs a
  > clean database, use the Testcontainers harness (W1-12), which is empty by construction.

- [x] **`W1-14` · Delete the MongoDB implementation** · **Est** 1h
  **Do:** Remove `apps/api/models/`, the Mongoose dependency, the `connectDb` logic, and `MONGO_URI`
  references. `apps/api/server.js` remains temporarily but with all DB access removed — route bodies become
  `501 Not Implemented` stubs, rewritten in Wave 4.
  **Done when:** no `mongoose` import remains anywhere; `pnpm verify` is green.
  **Verify:** `pnpm verify && ! grep -rq mongoose apps packages --include=*.ts --include=*.js`

  > **Note (W1-14): Wave 1 complete.** `apps/api/models/` deleted, `mongoose` removed from dependencies,
  > `server.js` reduced to a transitional shell — a CORS allowlist, `/healthz`, and a single `501` handler for
  > `/api/*` that names the task rewriting it. Keeping the shell rather than deleting the file means the route
  > surface stays reviewable while it is replaced endpoint by endpoint, and `apps/web` keeps something to point
  > at until W6-02.
  >
  > **The W0-03 lint quarantine for `apps/api` is lifted** — it covered 16 unused `catch (error)` bindings in
  > code that no longer exists. `apps/api/eslint.config.js` is now the plain shared config. The `apps/web`
  > quarantine remains until Wave 6.
  >
  > `prisma/seed.ts` needed adding to `packages/db/tsconfig.json`'s `include`, or the type-aware linter cannot
  > resolve it — same failure mode as `vitest.config.ts` in W0-04. **Anything new outside `src/` needs the same
  > treatment.** `no-console` is disabled for the seed alone: reporting what it wrote is its job.
  >
  > **Gotcha worth remembering:** when Docker is not running, the integration gate fails with
  > `No test files found, exiting with code 1` — which is entirely misleading. The real error is Testcontainers
  > failing to reach the daemon in global setup. Check `docker info` first. Docker Desktop had stopped between
  > runs during this wave.
  >
  > `apps/api/.env` still contains the old `MONGO_URI`. It is gitignored and was never committed, so it was left
  > alone rather than edited — but it is the Atlas credential flagged for rotation in PLAN.md §8.

---

## Wave 2 — Pure domain logic · **10/10 ✅**

> **Goal:** every business rule exists once, as a pure function, exhaustively tested.
> **Independence:** total. No task here touches the database, HTTP, or another task's files. Fully parallel.
>
> **Outcome:** 595 tests in `@aura/core` at **100% coverage on every module**, 80 in `@aura/contracts`, 17
> enum-drift tests in `@aura/db`, 9 in `apps/api`. `pnpm verify` 28/28, `pnpm verify:integration` 54/54.
>
> The independence claim held in the sense that matters — no shared state, no ordering requirement — but
> "no task touches another task's files" turned out approximate, as it already had in Wave 1. Three shared
> modules were extracted rather than duplicated: `numeric.ts` (W2-02), `assertValidDate` and `sameCivilDay`
> from `cycle.ts`/`deadlines.ts` (W2-04, W2-05). Each is recorded in its task's note. Duplicating a number
> parser across two files is precisely the failure this rebuild exists to remove.

- [x] **`W2-01` · Scoring engine** · **Est** 3h
  **Do:** `packages/core/src/scoring.ts` — `scoreGoal(goal): number` covering every `uom` × `direction`
  combination: Numeric and `%` linear both directions, `Zero-based` binary, `Timeline` by milestone status.
  Clamp to [0,1]. `scoreSheet(goals)` weights by `weightage`. **No string inspection of `title` anywhere** —
  this is [PLAN.md](PLAN.md) F-06 and F-07 closed permanently.
  **Done when:** a table-driven test covers all UoM × direction × edge-case combinations (zero target, zero
  actual, actual > target, negative, null); ≥ 95% coverage on the file.
  **Verify:** `pnpm verify --filter=@aura/core`

  > **Note (W2-01):** 79 table-driven tests, 100% coverage on `scoring.ts` (target was ≥ 95%).
  >
  > **Lower-is-better is deliberately not the prototype's formula.** The prototype used `target / actual`,
  > which never reaches zero — missing a 5-defect target by 5× still scored 0.2 — and inverted outright on a
  > negative actual. `scoring.ts` uses the symmetric linear form `1 ± (actual − target) / |target|`, which is
  > monotone across the whole number line, reduces to plain `actual / target` in the ordinary
  > higher-is-better case, and has a rule you can say out loud: *double the target, lose the goal*. Concrete
  > difference — target 5, actual 6 scores 0.8 here and 0.833 in the prototype.
  >
  > **Malformed goals throw rather than score.** The prototype wrote `Number(goal.target) || 1`, so a target
  > of `0`, `''`, or `'N/A'` silently became a target of 1 and produced a plausible-looking number. The
  > engine distinguishes *absent* (`null` / blank → scores 0, "nothing reported yet") from *invalid*
  > (`'N/A'`, `NaN`, `Infinity` → `InvalidGoalError` naming the field). A failed appraisal beats a wrong one.
  >
  > **`ZERO_BASED` validates rather than ignores.** It is the degenerate `target = 0` case of the linear
  > rule, so a `ZERO_BASED` goal carrying a non-zero target throws instead of having its target quietly
  > discarded, and `HIGHER_IS_BETTER` on it throws too — "more incidents is better" is not a goal.
  >
  > **`TIMELINE`'s `ON_TRACK = 0.5`** is inherited policy, now a single exported constant (`TIMELINE_SCORES`)
  > rather than a literal in two JSX files.
  >
  > **Enum drift risk, accepted and tracked.** `Uom`, `GoalDirection` and `GoalStatus` are re-declared as
  > `as const` arrays in core because the purity rule forbids importing `@aura/db`. The guard — a test in
  > `packages/db` asserting the Prisma enums and these arrays hold identical members — is **not yet written**;
  > it belongs with W2-10, which faces the same mirroring problem for Zod schemas. Until then the two can
  > drift silently.
  >
  > `smoke.test.ts` was deleted as its own comment instructed, now that the package has real tests.

- [x] **`W2-02` · Weightage validation** · **Est** 1.5h
  **Do:** `packages/core/src/weightage.ts` — `validateWeightages(goals)` returning structured errors, not
  booleans. Rules: total = 100 ± 0.01, each ≥ 10, count 3–8. Export the constants so no call site can invent
  its own. Closes F-10.
  **Done when:** tests cover each rule and the float-tolerance boundary (99.995 passes, 99.98 fails); errors
  name the offending goal.
  **Verify:** `pnpm verify --filter=@aura/core`

  > **Note (W2-02):** 143 tests across the package, 100% coverage on every module.
  >
  > **A shared `numeric.ts` was extracted, which makes W2-01 and W2-02 not quite independent.** Both need the
  > same tri-state parse of Prisma's `string | number | null` columns, and two copies of a number parser is
  > precisely the duplication this rebuild exists to remove — the prototype's bugs were *all* coercion bugs
  > (`Number(x) || 1`, `Number(x) || 0`), and they were bugs because each call site coerced differently.
  > `parseNumeric` and `roundTo` now live in `numeric.ts` and `scoring.ts` imports them. Wave 2's tasks are
  > independent in the sense that matters — no shared state, no ordering requirement — but the "no task
  > touches another task's files" claim in this wave's header is now approximate, as it already is in Wave 1.
  >
  > **The tests caught a real bug in the implementation and two wrong assumptions in the tests.** Worth
  > recording because the details are not guessable:
  >
  > - `33.34 + 33.33 + 33.33` is **exactly** 100 in IEEE 754. My float-residue example was fiction. A genuine
  >   one, found by search: `10 + 58.01 + 31.99` = `99.999999999999985789`. That is a legitimate sheet the
  >   prototype's strict `total !== 100` **rejected**, while its `Math.round(total) !== 100` **accepted** a
  >   sheet totalling 99.6. Both are now regression tests.
  > - `100.01 - 100` evaluates to `0.010000000000005116`, which is greater than a 0.01 tolerance. The stated
  >   inclusive boundary was therefore unreachable — a real bug. The drift is rounded before comparison now,
  >   as well as the total.
  > - `roundTo(-2.345, 2)` is `-2.35`, not `-2.34`: `-2.345 * 100` is `-234.50000000000003`, so there is no
  >   half to break. Half-way behaviour follows the bits, not a rule, and the test now documents that rather
  >   than pinning a value the function cannot honour.
  >
  > **Unreadable weightages are excluded from the total**, not counted as zero, so a bad value produces one
  > issue naming it rather than a second confusing "your sheet does not add up".
  >
  > `remainingWeightage` is exported so the UI's "15% left to allocate" hint is computed from the same total
  > as the validation that will reject the sheet — the prototype's third, disagreeing rule was a UI
  > `totalWeightage >= 100` button guard.

- [x] **`W2-03` · Cycle phase resolver** · **Est** 1.5h
  **Do:** `packages/core/src/cycle.ts` — `activePhase(cycle, at)`, `isActionAllowed(action, cycle, at)`,
  `phasesOverlap(phases)`. Replaces the global mutable period flag (F-03).
  **Done when:** tests cover before-first-phase, between phases, exact boundaries, and after-last-phase.
  **Verify:** `pnpm verify --filter=@aura/core`

  > **Note (W2-03):** 258 tests across the package, 100% coverage on every module.
  >
  > **Phases are half-open, `[startsAt, endsAt)`.** This is the load-bearing decision and every boundary test
  > pins it: the instant a phase starts is inside it, the instant it ends is not. It is the only convention
  > under which back-to-back phases tile a cycle with neither a gap nor a double-booked instant, and it means
  > a phase ending "on 31 March" is stored as ending at 1 April 00:00. W2-04's `daysOverdue` inherits the
  > same convention — overdue begins at `endsAt`.
  >
  > **Status gates the dates.** `activePhase` returns `null` on a `DRAFT` or `CLOSED` cycle whatever its
  > dates say: the dates describe a plan, the status says whether the plan is in force. `nextPhase`
  > deliberately does *not* gate on status, because "goal setting opens on 1 April" is exactly what a draft
  > cycle needs to be able to say.
  >
  > **Timing and permission are kept apart on purpose.** `isActionAllowed` answers *is it the right time* and
  > nothing else; *is this the right person* is `can()` in W2-06, and an endpoint must satisfy both. Merging
  > them is how the prototype let a manager's authority read as an open window and accepted a check-in write
  > against a locked sheet (F-04).
  >
  > **`VIEW_RESULTS` was dropped from `CYCLE_ACTIONS`** — reading is never time-gated, and putting it in this
  > table would have made a closed cycle invisible. Only state changes are listed; a test asserts no `VIEW_*`
  > action ever creeps back in.
  >
  > Two additions beyond the task text, both small and both needed by callers: `nextPhase` (the UI has to say
  > when a window opens) and `findPhaseOverlaps`, which returns the colliding pairs *and* their intersection
  > rather than the specified bare boolean — `phasesOverlap` is kept as the boolean built on top. Overlapping
  > phases are malformed data, but `activePhase` still resolves them deterministically to the
  > earliest-starting match rather than picking arbitrarily.
  >
  > Loops use `.entries()` rather than indices: an indexed read is `T | undefined` under
  > `noUncheckedIndexedAccess`, and guarding a case that cannot happen would add an untestable branch.

- [x] **`W2-04` · Deadline calculator** · **Est** 1h
  **Do:** `packages/core/src/deadlines.ts` — `deadlineFor(action, cycle)`, `daysOverdue(dueAt, now)` returning
  **real elapsed days with no floor** (F-08's fabricated minimum of 4 is what this replaces). Timezone-safe.
  **Done when:** tests assert 0 for not-yet-due, exact boundaries at midnight, and correct values across a DST
  transition.
  **Verify:** `pnpm verify --filter=@aura/core`

  > **Note (W2-04):** 304 tests across the package, 100% coverage on every module.
  >
  > **"Days overdue" means calendar days, not 24-hour periods.** This is the decision the DST requirement
  > forces, and it is not an implementation detail. When someone reads *3 days overdue* in an escalation
  > email they mean three dates have turned over. Counting elapsed hours reports **0** across a
  > spring-forward — the deadline was yesterday lunchtime, it is lunchtime again, and only 23 hours have
  > passed. A test asserts both answers side by side so the difference is visible rather than assumed.
  >
  > The implementation reduces both instants to their civil date in the org's timezone and subtracts those
  > as UTC midnights, which are exactly 86,400,000 ms apart with no exceptions. `Intl` is a pure lookup — no
  > network, no filesystem, no clock — so it sits inside the purity rule, and it throws on an unknown
  > timezone at construction, which is tested.
  >
  > **`isOverdue` is deliberately separate from `daysOverdue(...) > 0`.** Something due at midnight and read
  > at 09:00 is *late* but is *0 days* late. Collapsing the two means either treating a fresh miss as
  > not-late or inflating it to a full day — the smaller cousin of the F-08 bug this task exists to remove.
  > The F-08 regression test asserts 0, 1, 2, 3, 4 at one-day intervals; the prototype's
  > `Math.max(elapsedDays, 4)` read every one of them as 4.
  >
  > **The deadline is the phase's `endsAt`**, the same boundary at which `isActionAllowed` goes false. One
  > instant, two readings, agreeing by construction rather than by coincidence.
  >
  > **Two of my own timezone assertions were wrong and the run caught them.** Being east of UTC does not
  > mean being further overdue — what matters is whether a local midnight falls between the two instants.
  > For an instant pair of `16 Apr 22:00Z` → `17 Apr 02:00Z`: UTC counts 1, `Europe/London` (UTC+1) counts
  > 1, but `Asia/Tokyo` (UTC+9) counts **0** and `America/New_York` (UTC-4) counts **0**, because both land
  > on a single local date. All four are now tests.
  >
  > `assertValidDate` was exported from `cycle.ts` rather than copied, on the same reasoning as W2-02's
  > `numeric.ts`: `deadlines.ts` already builds on `cycle.ts`, so the dependency direction is unchanged.

- [x] **`W2-05` · Escalation rule evaluator** · **Est** 2h
  **Do:** `packages/core/src/escalation.ts` — `evaluate(state, rules, now)` returning the tier
  (`EMPLOYEE`|`MANAGER`|`SKIP_LEVEL_HR`) and whether a notification is due. Pure: takes deadlines and current
  state, returns intent. Never sends anything.
  **Done when:** tests cover each tier threshold, resolved items being excluded, and idempotency across repeat
  evaluation on the same day.
  **Verify:** `pnpm verify --filter=@aura/core`

  > **Note (W2-05):** 350 tests across the package, 100% coverage on every module.
  >
  > **Every decision carries a `reason`, including the silent ones.** `NOT_OVERDUE`, `RESOLVED`,
  > `FIRST_BREACH`, `TIER_RAISED`, `DAILY_REMINDER`, `ALREADY_NOTIFIED_TODAY`. An escalation job that
  > silently does nothing is indistinguishable from one that is broken — which is precisely what the
  > prototype's was, since its "notification chain" was a string in a document describing sends that never
  > happened. `evaluateAll` returns a decision per input including the ones that came to nothing, so the
  > caller can log them.
  >
  > **Idempotency is split honestly between the function and its caller.** The function is pure, so
  > re-running it against *unchanged* state repeats the decision — that is stated in the doc comment and
  > asserted in a test, rather than being quietly implied. Safe re-runs come from the caller recording the
  > send into `notifiedAt`; the test drives both passes to prove the second decides `ALREADY_NOTIFIED_TODAY`.
  >
  > **A tier climb overrides the daily quiet period.** Reaching HR is not something to hold until tomorrow,
  > so `TIER_RAISED` notifies even when something was already sent today. Only a steady tier respects the
  > once-per-day rule.
  >
  > **"Today" is a calendar date in the org's timezone**, not a rolling 24 hours — a send at 23:00 and one at
  > 01:00 are two days apart despite the two hours between them. Reuses `sameCivilDay`, newly exported from
  > `deadlines.ts` for this.
  >
  > **`now` has no default**, and neither does `thresholds`. A defaulted `now` is exactly the ambient-clock
  > smell the purity rule exists to prevent; it was written that way first and removed before the gate ran.
  >
  > Resolved breaches never notify and never climb past the tier they were resolved at, but still report
  > their real day count — resolved is not the same as untrue.

- [x] **`W2-06` · Permission policy** · **Est** 2.5h
  **Do:** `packages/core/src/policy.ts` — `can(actor, action, resource): boolean` for every action in
  [PRD.md](PRD.md) §6. Relationship-aware: self, direct manager, manager chain, HR, org admin.
  **Done when:** a table-driven test enumerates every role × action × relationship combination with an expected
  result. This table is the source of truth for W3-09's endpoint matrix.
  **Verify:** `pnpm verify --filter=@aura/core`

  > **Note (W2-06):** 450 tests across the package, 100% coverage on every module. **34 actions × 4 roles ×
  > 5 relationships = 680 cells**, every one asserted.
  >
  > **A role's permissions are not a flat list — they are a set of relationships per role.** The first
  > attempt modelled `roles` and `relationships` as two independent lists and it was wrong: "HR may view any
  > sheet" and "an employee may view their own" cannot both come out of one cross-product without also
  > granting an employee every sheet in the org. So each action maps role → the relationships that role may
  > exercise, and a role absent from an action cannot perform it at all. "HR may view goal sheets" is true;
  > "HR may write your self-appraisal" is not, and the two axes compose to say so.
  >
  > **The expectation table in the test is written from the PRD stories, not read back off `POLICY`.** A
  > test that derives its expectations from the code under test proves only that the code equals itself. All
  > 680 cells passed on the first run against the independent table.
  >
  > **Three self-dealing exclusions are deliberate and individually tested.** `APPROVE_GOAL_SHEET`,
  > `RETURN_GOAL_SHEET`, `ADJUST_WEIGHTAGE` and `RATE_REPORT` never permit `SELF` for *any* role including
  > `ORG_ADMIN` — approving your own goals is the thing an approval workflow exists to prevent.
  > `ADJUST_RATING_IN_CALIBRATION` excludes `SELF` so calibration is not a back route to your own rating.
  > `DEACTIVATE_USER` excludes `SELF` so the last org admin cannot lock the organisation out of its own
  > account.
  >
  > **`RATE_REPORT` is `DIRECT_REPORT` only.** A skip-level manager influences an outcome through
  > calibration, not by overwriting the rating of someone they do not work with (US-802). Asserted in both
  > directions.
  >
  > **Tenancy is not a permission.** `OTHER_ORG` appears in no entry, and a test asserts it never will:
  > every action, for every role, across an org boundary, is refused (US-105). Relationship resolution puts
  > the org check first, so a resource in another org with the *same* user id resolves to `OTHER_ORG` rather
  > than `SELF`.
  >
  > **Invariants that are genuinely independent of the table**, and therefore worth more than the grid:
  > roles form a strict ladder (`ORG_ADMIN` ⊇ `HR_ADMIN` ⊇ `MANAGER` ⊇ `EMPLOYEE`) with at least one real
  > gain per step; an `EMPLOYEE` reaches nothing beyond `SELF` on any of the 34 actions; a deactivated actor
  > is refused all 680 cells; no entry is an empty relationship list, which would be a silent denial.
  >
  > `check()` returns the reason (`INACTIVE_ACTOR`, `CROSS_ORG`, `ROLE_NOT_PERMITTED`,
  > `RELATIONSHIP_NOT_PERMITTED`) in order of how fundamental it is, so a 403 can say something true. This
  > table is the source W3-09's endpoint matrix reads from.

- [x] **`W2-07` · Cascade planner** · **Est** 2h
  **Do:** `packages/core/src/cascade.ts` — `planCascade(sharedGoal, recipients)` returning
  `{ willReceive, skipped: [{ userId, reason }] }`. Skips recipients who would exceed 100% weightage or the
  8-goal cap. **Returns a plan; performs nothing.** This is PRD US-402 and F-05's fix.
  **Done when:** tests cover exact-100 boundary, over-cap, at-goal-limit, already-has-this-goal, and the empty
  audience.
  **Verify:** `pnpm verify --filter=@aura/core`

  > **Note (W2-07):** 485 tests across the package, 100% coverage on every module.
  >
  > **Skip reasons are ordered by how decisive they are**, so the answer a manager sees is the most
  > fundamental one: duplicate → owner → already has it → unreadable weightage → at the goal limit → over
  > 100%. Someone who is both the owner *and* at the goal limit is reported as the owner. In particular the
  > goal-count check runs **before** the weightage check — eight goals worth one point each have plenty of
  > headroom and no room, and reporting the headroom would be misleading.
  >
  > **The 100% boundary uses `WEIGHTAGE_TOTAL` and `WEIGHTAGE_TOTAL_TOLERANCE` from W2-02**, not its own
  > numbers. A planner with an independent threshold would accept sheets the validator rejects, or refuse
  > sheets it accepts — the same class of disagreement as the prototype's three different totals rule
  > (F-10). A test pins the shared hundredth of tolerance in both directions.
  >
  > **F-05 closed the same way F-06 was:** the types carry no name. `CascadableGoal` has `ownerUserId` and
  > nothing resembling a display name, so the prototype's string comparison — which made namesakes share an
  > identity and broke ownership on rename — cannot be written. Tests assert a namesake and a
  > differently-cased id both still receive the goal.
  >
  > **An unreadable weightage skips the recipient rather than counting as zero.** Treating it as zero would
  > overstate the headroom and produce exactly the over-100 sheet the check exists to prevent.
  >
  > **Coverage found dead code, not a missing test.** The first version parsed each weightage twice — once
  > to validate, once to sum — leaving the sum with an "if unreadable" branch the earlier check had already
  > made unreachable. That is caution that looks like caution but does nothing. Replaced with a single pass
  > returning either the values or the index of the first bad one, which removed the branch and the double
  > parse together.
  >
  > A test asserts every recipient appears exactly once across `willReceive` and `skipped` — a planner that
  > loses someone silently is worse than one that refuses them.

- [x] **`W2-08` · Safe CSV serializer** · **Est** 1.5h
  **Do:** `packages/core/src/csv.ts` — RFC 4180 compliant: quote all fields, double internal quotes, `\r\n`
  line endings. Neutralize leading `= + - @ \t \r` with a `'` prefix. Closes F-11.
  **Done when:** tests cover embedded commas, quotes, newlines, unicode, and each formula-injection prefix
  vector.
  **Verify:** `pnpm verify --filter=@aura/core`

  > **Note (W2-08):** 539 tests across the package, 100% coverage on every module.
  >
  > **Neutralisation applies to strings only, and that is the one judgement call here.** A real `number`
  > renders as digits with at most a leading `-`, which no spreadsheet can read as anything but a negative
  > number. Guarding it would turn every negative value in an export into text and break the arithmetic the
  > export exists for. The danger is user-supplied text, so `-5` the number is exported plainly while `'-5'`
  > the string is guarded — both are tests, as is a payload disguised as a negative
  > (`-2+3+cmd|' /c calc'!A0`).
  >
  > **F-11 is two problems, not one.** A comma in a goal title silently shifted every later column on the
  > row (structure); a title beginning `=` was handed to the spreadsheet as an expression (execution). A cell
  > starting `=` can invoke `HYPERLINK`, `WEBSERVICE`, or with DDE enabled a shell command — and the person
  > opening the file is usually HR, on a corporate laptop, from a system they trust. Both are covered
  > separately.
  >
  > **Every field is quoted, always.** A few extra bytes in exchange for removing the entire class of "which
  > characters need escaping" bugs, and it is what keeps a field containing CRLF from being read as two
  > records.
  >
  > **The trigger set is exactly OWASP's:** `=`, `+`, `-`, `@`, tab, carriage return. Tab and CR are in there
  > because leading whitespace is stripped before evaluation, so `\t=1+1` still evaluates — both are tested.
  > A test pins the list so nothing is quietly dropped, and another asserts a full-width `＝` (U+FF1D) is
  > *not* guarded, since spreadsheets do not parse it and guarding it would corrupt legitimate text.
  >
  > **No trailing line ending**, so a round trip through a strict parser gains no phantom empty row. A
  > `UTF8_BOM` option is provided but off by default — without it Excel reads the local codepage and every
  > non-ASCII name arrives mangled, which the unicode tests would not have caught on their own.
  >
  > An invalid `Date` throws rather than exporting the string "Invalid Date", which is a defect that travels.

- [x] **`W2-09` · Audit diff builder** · **Est** 1.5h
  **Do:** `packages/core/src/audit.ts` — `buildAuditEvent(actor, action, before, after)` producing a
  field-level diff with a PII redaction list (never store `passwordHash` or tokens in an audit payload — PRD
  §9 GDPR).
  **Done when:** tests cover added / removed / changed fields, nested objects, no-op changes producing no
  event, and redaction.
  **Verify:** `pnpm verify --filter=@aura/core`

  > **Note (W2-09):** 595 tests across the package, 100% coverage on every module.
  >
  > **Signature deviation:** `buildAuditEvent(actor, action, target, before, after, options?)` — a `target`
  > was added. An `AuditEvent` row is keyed by `entityType` and `entityId`, so the four-argument form in the
  > task text would produce rows nobody could look up.
  >
  > **A no-op returns `null`, and that is the design rather than an optimisation.** A trail that records
  > saves which altered nothing trains people to ignore it, and "who changed this field" stops being
  > answerable by reading.
  >
  > **Added and removed are represented by an absent key, not by `null`.** `{ note: null }` and `{}` are
  > different histories — one says the note was cleared, the other says it never existed. The change objects
  > omit `before` entirely on an add and `after` entirely on a remove, so the stored JSON carries that
  > distinction. Both are tested against each other.
  >
  > **Added and removed subtrees are walked leaf by leaf**, which is a security property rather than a
  > cosmetic one: recording a newly-added object as a single opaque value would store
  > `{ email, passwordHash }` verbatim and defeat the redaction entirely. A test asserts the raw hash appears
  > nowhere in `JSON.stringify(event)`.
  >
  > **Redaction over-redacts on purpose.** Matching is by substring on normalised path segments, so
  > `passwordHash`, `password_hash` and `hashedPassword` all match `password`, and `refreshToken` matches
  > `token` — but `secretary` is also caught by `secret`. That trade is explicit in the doc comment and in a
  > test: an over-redacted row loses one value, an under-redacted one puts a credential in an append-only
  > table that erasure requests cannot easily clear (PRD §9).
  >
  > **Arrays are compared whole, objects are descended.** Element-wise diffing of `notifiedAt` or `tags`
  > produces noise nobody reads; a nested `manager.email` change is exactly what someone is looking for. A
  > type change from object to scalar is one `CHANGED` entry rather than a demolition of every leaf.
  >
  > `diffRecords` is exported separately because W1-09's `SheetRevision` needs the same comparison without
  > an audit row wrapped around it.

- [x] **`W2-10` · Shared Zod contracts** · **Est** 3h
  **Do:** `packages/contracts/src/` — one file per domain, exporting request and response schemas for every
  endpoint in Wave 4, plus inferred types. `goalSheetSchema` embeds the W2-02 weightage rules via `.refine()`.
  **Done when:** every schema has a round-trip test (valid parses, invalid rejects with a useful message);
  `packages/web` and `apps/api` both import it and type-check.
  **Verify:** `pnpm verify`

  > **Note (W2-10):** Zod **4.4.3**. 80 contract tests, 100% coverage in `@aura/contracts`; 17 enum-drift
  > tests in `@aura/db`; 9 in `apps/api`. Full `pnpm verify` green at **28/28**.
  >
  > **No business rule is restated here.** `goalSheetInputSchema` calls `validateWeightages` from
  > `@aura/core` (W2-02) and maps each issue onto the offending goal's path; `createCycleRequestSchema` calls
  > `findPhaseOverlaps` (W2-03). A schema that re-implemented either would be a *fourth* opinion on a
  > question that already had three too many (F-10) — and a cycle that parses is now, by construction, a
  > cycle `activePhase` can answer unambiguously about.
  >
  > **Enums come from `@aura/core`'s arrays, not a third copy.** `z.enum(UOMS)` rather than retyping the
  > members. That collapses three declarations to two, and the remaining pair is now guarded: **the enum
  > drift test owed since W2-01 is written**, in `packages/db/src/enum-drift.test.ts`, because that package
  > is the only one allowed to import Prisma, core *and* contracts at once. Fifteen enums, compared by
  > membership against the **generated** client rather than a hand-copied list, with a count assertion so a
  > new enum cannot be added without a deliberate update here.
  >
  > **Two real bugs in my own code, both caught by the round-trip tests:**
  >
  > - `weightageSchema`'s two-decimal check was `Number.isInteger(Math.round(value * 100))`, which is
  >   **always true** — the predicate tested nothing at all. Now compares the scaled value against its own
  >   rounding with a tolerance, because `33.33 * 100` is `3332.9999999999995`.
  > - `emailSchema` validated before trimming, so `" a@b.com "` — an ordinary paste out of a mail client —
  >   was rejected outright. Normalisation now runs first via `.pipe`, which is why the order is called out
  >   in the doc comment.
  >
  > **A third failure was my test being wrong, not the code:** the goal-count bound test built nine goals at
  > `100/9 = 11.111…`, so the *precision* rule fired before the count rule. Rewritten with 11.11 (totalling
  > 99.99, inside tolerance) so the count is the only fault, with the trap named in a comment.
  >
  > **`checkInRequestSchema` has no room for `target` or `weightage`.** Zod strips unknown keys, so a
  > check-in payload carrying them silently loses them — F-04 closed by the shape of the contract rather
  > than by a guard someone has to remember. A test asserts the stripping directly.
  >
  > **`loginRequestSchema` deliberately does not reuse `passwordSchema`.** Rejecting a short password at
  > login leaks that the stored one is longer, and locks out anyone whose password predates a raised
  > minimum. The floor belongs on the way in.
  >
  > **Consumers are real, not token imports.** `apps/api/src/validate.ts` is `parseBody`, which returns a
  > result rather than throwing (a bad body is an ordinary 400) and groups messages **by field** so a form
  > shows every problem in one round trip (US-305) — covered to 100%. `apps/web/src/lib/contracts.ts` is the
  > app's single import point for API types plus the weightage constants, so W6's "15% left to allocate"
  > hint cannot be computed from a number typed into a component.
  >
  > **One config change, and it is not a weakened assertion.** `packages/db`'s unit `testTimeout` is now 30s.
  > The lazy-client regression test imports the generated Prisma client, and with Zod newly in that package's
  > graph a **cold** transform crossed the 5s default — failing a test that asserts *side-effect freedom*,
  > not speed. Warm, the same suite runs in 761ms. CI always runs cold, so this was a real flake, not a
  > local quirk.
  >
  > New dependency: **`zod`** in `@aura/contracts` and `apps/api`. `@aura/core` remains dependency-free.

---

## Wave 3 — Auth & identity

> **Goal:** every request has a verified actor and every actor is constrained. Closes F-01 and F-02.
> **Independence:** W3-01 first. W3-02…W3-08 are parallel; W3-09 is the wave's closing gate.

- [x] **`W3-01` · Better Auth install + Prisma adapter** · **Est** 2.5h
  **Do:** Install Better Auth into `apps/api/src/auth/`. Configure the Prisma adapter against `packages/db`,
  email/password provider, session and cookie config. Generate and apply its schema migration.
  **First confirm the current version and its organization/access-control plugin APIs against the official
  docs** ([TECH_STACK.md](TECH_STACK.md) §6). If the org plugin is unsuitable, fall back to core sessions plus
  our own `Role`/`Membership` tables and note the deviation here.
  **Done when:** a user can be created and a session issued in an integration test.
  **Verify:** `pnpm verify && pnpm verify:integration`

  > **Note (W3-01):** Better Auth **1.6.26** (1.6.27 published mid-task; 1.7.0 is still RC). It declares peer
  > support for `prisma ^7` and `@prisma/client ^7`, which matches our 7.9.1. 12 auth integration tests;
  > `pnpm verify` 28/28, `pnpm verify:integration` 67 (55 db + 12 api).
  >
  > **The organization plugin was evaluated and rejected — the fallback this task anticipated.** It is a
  > good plugin for a different shape of product, and four things make it wrong here:
  >
  > 1. It models a role as a column on a `member` join table, so permissions come from membership. W2-06's
  >    policy engine — 680 asserted cells — reads roles from the actor. Adopting it means rewriting Wave 2.
  > 2. It makes `User` organization-less, with the link in `member`. Our tenancy is a *database constraint*:
  >    `(managerId, orgId)` references `(id, orgId)`, so Postgres rejects a cross-org manager. That
  >    composite key needs `orgId` on the user row — removing it turns F-02 back into a convention.
  > 3. Its `team`/`teamMember` tables duplicate the `Team` model W1-04 already built.
  > 4. Its central feature is one user across many organizations. The PRD has no such case.
  >
  > So Better Auth owns credentials and sessions and does **not** own identity. Core only: `Session`,
  > `Account`, `Verification` added in `auth.prisma`; `emailVerified`/`image` added to `User`.
  >
  > **Two schema decisions from Wave 1 were deliberately reversed, and both are recorded where they live:**
  >
  > - **`email` is now globally unique**, not `@@unique([orgId, email])`. Better Auth resolves a login by
  >   email alone and a login form has no second field to disambiguate with, so a duplicate address makes
  >   "who is signing in" genuinely unanswerable. One person belongs to one organization (PRD E1), so the
  >   wider constraint costs nothing real. W1-03's integration test was **rewritten, not deleted** — the case
  >   still matters, the expected answer changed — and a new test asserts the composite-FK tenancy guarantee
  >   is untouched by the widening.
  > - **`Actor.role` became `Actor.roles`** in `@aura/core`. This is a defect W3-01 surfaced rather than
  >   created: `User.roles` has been a `Role[]` since W1-03 (an HR admin is also an employee with their own
  >   goal sheet), while W2-06 typed a single role. An action is permitted if **any** held role permits it —
  >   a union, not a maximum, so it does not depend on the role ladder continuing to hold. All 680 cells
  >   still pass; 8 tests added, including that holding every role still cannot approve your own sheet.
  >
  > **`orgId` is the only `additionalField`, and `roles`/`status` are deliberately absent.** A client able to
  > name its own roles at sign-up would make the whole of W2-06 decorative. They take their Prisma defaults
  > and are set by our handlers in W3-03/W3-08.
  >
  > **`prisma migrate dev` cannot run non-interactively** when it has a data-loss warning — here, the new
  > unique index on `users.email`. Neither `migrate dev` nor `--create-only` will proceed. The migration was
  > generated with `prisma migrate diff --from-config-datasource --to-schema`, which is read-only and
  > non-interactive, then applied with `migrate deploy`. Same approach as W1-05's hand-appended partial index.
  >
  > **Gotchas hit, all previously documented and all hit anyway:**
  > - `migrate deploy` does **not** regenerate the client. `Unknown argument 'emailVerified'` is what a stale
  >   generated client looks like — run `pnpm --filter @aura/db build`.
  > - `apps/api`'s unit config matched `*.integration.test.ts`, exactly as `packages/db`'s did in W1-12. Now
  >   excluded. `src/auth/**` is excluded from *coverage* but not from testing: it is covered by the
  >   integration suite, and measuring it in the unit run would report 0% for well-tested code and invite
  >   someone to "fix" that with a mock.
  > - `@aura/db`'s export map pointed `./testing` at `./src/testing.ts`, which does not exist (the file is
  >   `src/testing/index.ts`). Latent since W1-12 because nothing imported it across a package boundary.
  >   Fixed, and `./testing/global-setup` added so `apps/api` reuses the same container and migrations.
  >
  > **The integration suite supplies its own `BETTER_AUTH_SECRET`** from the vitest config rather than
  > reading `.env`. CI has no `.env`, and a test that passes only on one machine is worse than no test. The
  > local `.env` secret was empty and has been generated (gitignored, never committed).
  >
  > `config.ts` throws at startup if the secret is missing or under 32 characters. A weak secret breaks
  > nothing visibly — sessions still issue, and they are simply forgeable — which is the worst failure mode
  > a config error can have.

- [x] **`W3-02` · Internal auth interface** · **Est** 1.5h
  **Do:** `apps/api/src/auth/index.ts` exporting only `getActor(req)`, `requireAuth`, `requireRole`,
  `createSession`, `revokeSession`. **No other file in the codebase may import Better Auth directly** — enforce
  with an `import/no-restricted-paths` ESLint rule. This is the reversibility guarantee from
  [TECH_STACK.md](TECH_STACK.md) §6.
  **Done when:** the lint rule fails on a deliberate direct import, then passes once removed.
  **Verify:** `pnpm verify`

  > **Note (W3-02):** 16 interface integration tests (28 in `apps/api` total). `pnpm verify` 28/28,
  > `pnpm verify:integration` 83 (55 db + 28 api).
  >
  > **`no-restricted-imports` rather than `import/no-restricted-paths`.** `eslint-plugin-import` is not
  > installed and its flat-config support is still awkward; the built-in rule scoped by `files`/`ignores` is
  > the same mechanism W0-03 already proved on the `@aura/core` purity rule, and it needs no new dependency.
  >
  > **The rule blocks two vectors, not one.** `better-auth` itself, *and* `**/auth/config` — importing the
  > config module hands you the raw Better Auth instance, which routes around this boundary just as
  > effectively as importing the library. Proven in both directions with a throwaway `boundary-probe.ts`:
  > two errors with the violations present, clean once removed, and no restriction errors *inside*
  > `src/auth/`.
  >
  > **`authRoutes` is exported as a built handler, not as the auth instance.** Exporting the instance so
  > `server.ts` could call `toNodeHandler(auth)` itself would put `better-auth` back into a second file and
  > make the whole boundary decorative. The first draft did exactly that, under an
  > `_authInstanceForMountingOnly` name that was its own admission of the problem.
  >
  > **`getActor` re-reads roles and status from the database on every request.** The session carries
  > identity; the database carries authority. Taking roles from the session payload would leave a demoted or
  > deactivated user with their old permissions until the cookie expired — up to seven days of access
  > someone has already had removed (PRD US-106). Two tests pin this: a promotion visible on the
  > already-issued session, and a deactivation taking effect immediately.
  >
  > **`requireRole` calls `next(new Error(...))` when used without `requireAuth`**, rather than answering
  > 403. A 403 would hide a misconfigured route behind a plausible response, and the route would look like it
  > was working.
  >
  > **Three things the tests corrected:**
  > - `signUpEmail` **issues a session of its own**, so a freshly signed-up user already holds one before
  >   `createSession` runs. The revoke test asserted a count of zero; it now asserts the count decreased,
  >   because zero was asserting something untrue about the library.
  > - `prisma` is a process-wide singleton shared across integration files. An `afterAll` calling
  >   `$disconnect()` in one file closed the connection the next file was still using — "Server has closed
  >   the connection" from an unrelated `create`. Both removed; container teardown closes everything.
  > - `exactOptionalPropertyTypes` refuses `req.actor = actor ?? undefined`. That is the flag doing its job:
  >   "absent" and "present and undefined" are different states, and the middleware only produces the first.
  >
  > **Two type dependencies were needed and are worth naming:** `@types/express`, and `@types/express-serve-static-core`
  > — the latter because pnpm's strict layout makes the `declare module` augmentation target unresolvable
  > unless it is a direct dependency (`TS2664: Invalid module name in augmentation`).
  >
  > **One observed flake, not yet explained.** `verify:integration` failed once with a single API test
  > failing, then passed twice in a row including a standalone run. Both suites start their own Postgres
  > container under turbo, so resource contention is the likely cause, but I have not reproduced it and am
  > not claiming it is fixed. Recorded here so the next occurrence is a second data point rather than a
  > surprise.

- [ ] **`W3-03` · Signup, login, logout endpoints** · **Est** 2h
  **Do:** `POST /auth/signup` (creates org + first admin), `/auth/login`, `/auth/logout`, `GET /auth/session`.
  Access token short-lived; refresh in an httpOnly `SameSite=Lax` cookie. PRD US-102.
  **Done when:** integration tests cover the happy path, wrong password, unknown email (identical response and
  timing), and that logout revokes server-side.
  **Verify:** `pnpm verify:integration`

- [ ] **`W3-04` · Password reset flow** · **Est** 2h
  **Do:** `POST /auth/forgot`, `POST /auth/reset`. Single-use token, 60-minute expiry, all sessions invalidated
  on success. **Identical response for known and unknown emails** (PRD US-103, no enumeration).
  **Done when:** tests cover expiry, reuse rejection, session invalidation, and response-identical enumeration
  protection.
  **Verify:** `pnpm verify:integration`

- [ ] **`W3-05` · `requireAuth` middleware** · **Est** 1h
  **Do:** Populates `req.actor` as a **non-optional** type after the middleware, so forgetting it downstream is
  a compile error rather than a data leak.
  **Done when:** an unauthenticated request to a guarded route returns 401 with no body leakage; the type
  narrowing is proven by a `tsd`-style type test.
  **Verify:** `pnpm verify:integration`

- [ ] **`W3-06` · Org-scoping middleware** · **Est** 2h
  **Do:** A Prisma client extension that injects `orgId` from `req.actor` into every query's `where` clause.
  `orgId` is **never** read from a request parameter or body. Closes F-02.
  **Done when:** an integration test creates two orgs and asserts every read endpoint returns 404 (not 403 —
  no existence leak) for the other org's resources.
  **Verify:** `pnpm verify:integration`

- [ ] **`W3-07` · Security middleware** · **Est** 1.5h
  **Do:** `helmet`; `cors` with an **explicit origin allowlist from env** (replacing the prototype's bare
  `cors()` — F-01); `express-rate-limit` with a Postgres store on all `/auth/*` routes; body size limits.
  **Done when:** a disallowed origin is rejected; the 11th login attempt in a window returns 429.
  **Verify:** `pnpm verify:integration`

- [ ] **`W3-08` · User invite & deactivation endpoints** · **Est** 2h
  **Do:** `POST /users/invite` (role + managerId at invite time), `POST /users/accept-invite`,
  `POST /users/:id/deactivate`. PRD US-101, US-106.
  **Done when:** tests cover single-use invites, expiry, that a deactivated user cannot log in, and that their
  historical records remain readable to their manager.
  **Verify:** `pnpm verify:integration`

- [ ] **`W3-09` · Permission matrix test suite** · **Est** 3h
  **Do:** `apps/api/src/__tests__/permission-matrix.test.ts` — every registered route × every role × expected
  status, driven by the W2-06 policy table. Enumerate the Express router at runtime so **a new route with no
  matrix entry fails the build.**
  **Done when:** the suite passes; adding a dummy unguarded route makes it fail; removing the route makes it
  pass.
  **Verify:** `pnpm verify:integration`

---

## Wave 4 — API surface

> **Goal:** every PRD user story reachable over HTTP, validated, scoped, and audited.
> **Independence:** W4-01 first (the service/audit wrapper). W4-02…W4-21 each own one router + service file
> pair and are fully parallel.

- [ ] **`W4-01` · Transactional service wrapper** · **Est** 2.5h
  **Do:** `apps/api/src/services/withAudit.ts` — wraps a mutation so the change and its `AuditEvent` commit in
  one `prisma.$transaction`. An audit write failure rolls back the mutation. Every mutating service must use
  it. Closes F-09 and satisfies PRD US-1101.
  **Done when:** a test forcing an audit-write failure proves the mutation rolled back.
  **Verify:** `pnpm verify:integration`

- [ ] **`W4-02` · Audit completeness test** · **Est** 1.5h
  **Do:** Reflect over `apps/api/src/services/`, identify every exported mutating function, and assert each is
  wrapped by `withAudit`. **A new unaudited mutation fails the build.**
  **Done when:** the test passes; adding an unwrapped mutation fails it.
  **Verify:** `pnpm verify:integration`

- [ ] **`W4-03` · `GET /me` and profile update** · **Est** 1h · PRD US-102
- [ ] **`W4-04` · Team & org-chart endpoints** · **Est** 2h · PRD US-105, US-1003
  **Do:** Includes the recursive reporting-chain query as a `WITH RECURSIVE` CTE.
- [ ] **`W4-05` · Review cycle CRUD** · **Est** 2.5h · PRD US-201, 202, 203
  **Do:** Validates non-overlapping phases via W2-03 and the single-active-cycle constraint from W1-05.
- [ ] **`W4-06` · Goal sheet create & read** · **Est** 2h · PRD US-301, US-304
- [ ] **`W4-07` · Goal sheet submit** · **Est** 2h · PRD US-302
  **Do:** Validates with W2-02 + W2-10, writes a `SheetRevision`, transitions status.
- [ ] **`W4-08` · Approve endpoint** · **Est** 2h · PRD US-502
  **Do:** Snapshot + lock + audit + notification enqueue, all in one transaction.
- [ ] **`W4-09` · Rework endpoint** · **Est** 1.5h · PRD US-305
  **Do:** Reason is **required**; per-goal comments supported.
- [ ] **`W4-10` · Manager inline adjustment** · **Est** 2h · PRD US-503
  **Do:** Re-runs full validation; preserves the original in revision history.
- [ ] **`W4-11` · Check-in endpoint with field whitelist** · **Est** 2.5h · PRD US-601
  **Do:** **Server-side whitelist — only `actualAchievement` and `status` are writable on a locked sheet.**
  Everything else in the payload is ignored, not trusted. Closes F-04.
  **Done when:** a test sends a payload mutating `title`, `target`, and `weightage` on a locked sheet and
  asserts none of them changed.
- [ ] **`W4-12` · Discussion comments** · **Est** 1.5h · PRD US-602
- [ ] **`W4-13` · Shared goal create + cascade preview + commit** · **Est** 3h · PRD US-401, 402, 403
  **Do:** `POST /shared-goals/preview` returns the W2-07 plan; `POST /shared-goals` commits it atomically.
- [ ] **`W4-14` · Sheet revision history + diff** · **Est** 2h · PRD US-1103
- [ ] **`W4-15` · Self-appraisal endpoints** · **Est** 2.5h · PRD US-701
- [ ] **`W4-16` · Manager rating endpoints** · **Est** 2.5h · PRD US-702, US-703
  **Do:** Blocked until self-appraisal submits or its deadline passes.
- [ ] **`W4-17` · Calibration endpoints** · **Est** 2.5h · PRD US-801, 802, 803
- [ ] **`W4-18` · Analytics via SQL aggregation** · **Est** 2.5h · PRD US-1001
  **Do:** `GROUP BY` in Postgres — **not** `findMany` + `forEach`. Closes F-13.
  **Done when:** a test seeds 10,000 sheets and asserts the endpoint returns in under 500ms.
- [ ] **`W4-19` · Audit log query endpoint** · **Est** 1.5h · PRD US-1102
  **Do:** Filter by actor/entity/action/date, paginated, HR + org-admin only.
- [ ] **`W4-20` · Escalation list & resolve** · **Est** 1.5h · PRD US-903, US-904
- [ ] **`W4-21` · OpenAPI generation from Zod** · **Est** 2h
  **Do:** `zod-openapi` over `packages/contracts` → `/openapi.json` + Scalar docs UI.
  **Done when:** every route appears in the document; a route missing a contract schema fails the build.

*(Each W4 task's gate: `pnpm verify:integration`. Each is done when its endpoints pass integration tests
covering the happy path, validation failure, permission denial, and cross-org isolation.)*

---

## Wave 5 — Jobs & notifications

> **Goal:** the system acts on its own schedule. Closes F-08.
> **Independence:** W5-01 first. W5-02…W5-07 are parallel.

- [ ] **`W5-01` · pg-boss setup + worker process** · **Est** 2.5h
  **Do:** `apps/worker` as a standalone process. pg-boss schema migration, graceful shutdown, job-failure
  logging to Sentry.
  **Done when:** the worker starts, processes a test job, and shuts down cleanly on SIGTERM.
  **Verify:** `pnpm verify:integration`

- [ ] **`W5-02` · Nightly escalation job** · **Est** 2.5h · PRD US-901, 902
  **Do:** Cron-scheduled. Loads active cycles, evaluates via W2-05 using real `CyclePhase.endsAt` deadlines,
  writes `Escalation` rows, enqueues notifications. **No admin button anywhere.**
  **Done when:** a test with a seeded overdue sheet produces the correct tier and a real day count; running it
  twice in a day is idempotent.

- [ ] **`W5-03` · Email adapter (Resend) + React Email templates** · **Est** 2.5h
  **Do:** Behind `packages/core/notifications`. Templates for invite, reset, submitted, approved, returned,
  overdue, rating released.
  **Done when:** templates render to HTML in tests; the adapter is mocked in tests and never sends live mail.

- [ ] **`W5-04` · Notification dispatcher** · **Est** 2h · PRD US-1201, 1202
  **Do:** Consumes the queue, writes the in-app `Notification` row, respects per-category preferences, sends
  email unless suppressed. Compliance-mandatory notices ignore suppression and are labelled.
  **Done when:** tests cover preference suppression, the mandatory override, and delivery-status recording.

- [ ] **`W5-05` · Background CSV export job** · **Est** 2h · PRD US-1002
  **Do:** Serializes via W2-08, uploads to R2, returns a signed URL, records an audit event for the export
  itself.
  **Done when:** a test generates an export for a seeded cycle and asserts correct quoting and injection
  neutralization in the stored object.

- [ ] **`W5-06` · Weekly digest job** · **Est** 1.5h
- [ ] **`W5-07` · Cycle metrics snapshot job** · **Est** 2h
  **Do:** Nightly write of PRD §8 metrics into a `cycle_metrics` table so historical trend survives.

---

## Wave 6 — Frontend

> **Goal:** every user story usable in a browser.
> **Independence:** W6-01…W6-05 are the foundation and are parallel with each other. W6-06…W6-19 each own one
> route/feature directory and are parallel after the foundation.

- [ ] **`W6-01` · TypeScript migration of `apps/web`** · **Est** 3h
  **Do:** Rename `.jsx` → `.tsx`, add types, extend the shared tsconfig. No behaviour change.
  **Done when:** `pnpm turbo run typecheck --filter=web` passes with zero `any` in `src/pages`.

- [ ] **`W6-02` · Typed API client** · **Est** 2h
  **Do:** `src/lib/api.ts` — one client from `packages/contracts` types, `VITE_API_URL` from env, credentials
  included, typed errors. **Delete all 20 hardcoded `aurapms-backend.vercel.app` URLs.** Closes F-12.
  **Done when:** `grep -r "aurapms-backend" apps/web/src` returns nothing.

- [ ] **`W6-03` · TanStack Query setup** · **Est** 1.5h
  **Do:** Provider, sensible defaults, devtools in dev, a global error handler wired to toasts.

- [ ] **`W6-04` · Auth context, login page, route guards** · **Est** 3h
  **Do:** Replace `ProtectedRoute`'s `localStorage` check with a real server-backed session. Global 401
  interceptor redirecting to login and preserving the return URL. Closes the client half of F-01.
  **Done when:** clearing localStorage grants no access; a direct URL to a guarded route redirects to login and
  returns after auth.

- [ ] **`W6-05` · Toast & error system — remove every `alert()`** · **Est** 2h
  **Do:** `sonner` toasts, inline field errors from Zod, error boundaries per route. Closes F-14's UX half.
  **Done when:** `grep -rn "alert(" apps/web/src` returns nothing.

- [ ] **`W6-06` · Goal builder rewrite** · **Est** 3h · PRD US-301, 302, 303
  **Do:** React Hook Form + the shared schema. Live weightage meter. **Direction selector with a plain-language
  explanation of its scoring effect.** Specific submit-blocked reasons, never a generic error.
- [ ] **`W6-07` · Check-in view** · **Est** 2.5h · PRD US-601
- [ ] **`W6-08` · Self-appraisal view** · **Est** 3h · PRD US-701
  **Do:** Pre-populated with goals, targets, actuals, and computed score — never a blank page.
- [ ] **`W6-09` · Manager queue with filter/sort/bulk** · **Est** 3h · PRD US-501
- [ ] **`W6-10` · Manager sheet review & inline adjust** · **Est** 3h · PRD US-503
- [ ] **`W6-11` · Manager rating view** · **Est** 3h · PRD US-702
  **Do:** Self-appraisal, computed score, and check-in history visible side by side while rating.
- [ ] **`W6-12` · Admin cycle setup wizard** · **Est** 3h · PRD US-201, 203, 204
- [ ] **`W6-13` · Admin user management + CSV import** · **Est** 3h · PRD US-101, 205
  **Do:** Dry-run preview with row-level errors before commit.
- [ ] **`W6-14` · Calibration view** · **Est** 3h · PRD US-801, 802
- [ ] **`W6-15` · Analytics dashboard with charts** · **Est** 2.5h · PRD US-1001
  **Do:** Recharts replacing the prototype's key-value lists.
- [ ] **`W6-16` · Compliance & escalation board** · **Est** 2.5h · PRD US-903, 904
- [ ] **`W6-17` · Audit log viewer with diff** · **Est** 2.5h · PRD US-1102, 1103
- [ ] **`W6-18` · Notification inbox** · **Est** 2h · PRD US-1201
- [ ] **`W6-19` · Accessibility & responsive pass** · **Est** 3h
  **Do:** Focus states, form labels, ARIA on custom controls, contrast, keyboard navigation, table behaviour on
  narrow screens.
  **Done when:** `axe` reports zero violations on every route; full keyboard navigation verified; Lighthouse
  accessibility ≥ 95.

---

## Wave 7 — Production readiness

> **Goal:** meet every technical target in [PRD.md](PRD.md) §8.5.
> **Independence:** all parallel except W7-09, which requires everything else deployed.

- [ ] **`W7-01` · Sentry on both apps** · **Est** 1.5h
  **Do:** Source maps uploaded on build, release tagging, PII scrubbing.
- [ ] **`W7-02` · pino structured logging + request IDs** · **Est** 1.5h
  **Do:** `x-request-id` generated or propagated, attached to every log line and Sentry event.
- [ ] **`W7-03` · Health endpoints + Railway deploy** · **Est** 2.5h
  **Do:** `/healthz` (liveness) and `/readyz` (DB + queue reachable). Deploy api and worker as separate
  services with private networking.
- [ ] **`W7-04` · Neon setup + migrations in CI** · **Est** 2h
  **Do:** Production branch, PR branches for CI, `prisma migrate deploy` gated on tests, **before** the app
  deploy.
- [ ] **`W7-05` · Vercel frontend deploy** · **Est** 1h
  **Do:** SPA rewrites, env per environment, preview deploys per PR.
- [ ] **`W7-06` · Playwright E2E — full cycle happy path** · **Est** 3.5h
  **Do:** One test: admin creates a cycle → invites a user → employee drafts and submits goals → manager
  approves → employee checks in → employee self-appraises → manager rates → HR releases → employee
  acknowledges.
  **Done when:** it passes headless in CI against a seeded preview environment.
  **Verify:** `pnpm test:e2e`
- [ ] **`W7-07` · Demo environment + seeded data** · **Est** 1.5h
- [ ] **`W7-08` · Security review pass** · **Est** 2.5h
  **Do:** Run `/security-review`. Verify: no endpoint without `requireAuth`; no query without org scope; rate
  limits present; secrets only in env; dependency audit clean.
  **Done when:** zero critical or high findings (PRD §8.5).
- [ ] **`W7-09` · Load test at 10,000 sheets** · **Est** 2h
  **Do:** Seed 10k sheets across 500 users; k6 against the read endpoints.
  **Done when:** p95 < 200ms reads, < 500ms writes (PRD §8.5). Add indexes until met.
- [ ] **`W7-10` · Documentation** · **Est** 2.5h
  **Do:** `ARCHITECTURE.md`, `RUNBOOK.md` (deploy, rollback, on-call, migration recovery), API docs published,
  README final.

---

## Traceability

Every [PLAN.md](PLAN.md) finding maps to the task that closes it. Nothing is dropped.

| Finding | Closed by |
|---|---|
| F-01 unauthenticated API | W3-01, W3-05, W3-07, W3-09, W6-04 |
| F-02 hardcoded employee, unscoped reads | W1-03, W3-06 |
| F-03 destructive cycle switch | W1-05, W1-06, W2-03, W4-05 |
| F-04 unvalidated check-in overwrite | W4-11 |
| F-05 cascade bypasses validation | W1-08, W2-07, W4-13 |
| F-06 title-substring scoring | W1-07, W2-01 |
| F-07 duplicated client scoring | W2-01, W6-02 |
| F-08 fake escalation engine | W2-04, W2-05, W5-02 |
| F-09 near-empty audit trail | W2-09, W4-01, W4-02 |
| F-10 inconsistent validation | W2-02, W2-10 |
| F-11 CSV injection | W2-08, W5-05 |
| F-12 hardcoded URLs | W6-02 |
| F-13 in-memory analytics | W4-18, W7-09 |
| F-14 no tests, `alert()` UX | W0-04, W0-06, W6-05 |
