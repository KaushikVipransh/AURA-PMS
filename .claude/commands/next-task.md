---
description: Implement the next unchecked task from TASKS.md, run the verify gate until green, tick it off, and commit.
argument-hint: "[wave id e.g. W2, or a specific task id e.g. W2-03]"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash, PowerShell, TodoWrite
---

# Execute the next build task

You are executing the AuraPMS build plan. Work **one task at a time**, to completion, with the gate green.

## Context

- Task list: @TASKS.md
- Requirements: @PRD.md
- Stack decisions and rationale: @TECH_STACK.md
- Original audit (what each fix is for): @PLAN.md

Argument: `$1` — optional. May be a wave id (`W2`) to restrict selection to that wave, or a specific task id
(`W2-03`) to run exactly that task. If empty, take the first unchecked task in document order.

## Procedure

### 1. Select

Read `TASKS.md` and find the target task.

- If `$1` is a task id, use it. If it is already checked, say so and stop.
- If `$1` is a wave id, take the first unchecked task in that wave.
- If `$1` is empty, take the first unchecked task in the whole file.

**Check the wave gate.** If the selected task is in wave *N*, verify every task in waves *0…N−1* is checked.
If not, stop and report which earlier tasks are outstanding — waves are ordered and later work will break on
missing foundations.

Announce: the task id, its title, its estimate, and a one-line statement of what you are about to do.

### 2. Plan

Use `TodoWrite` to track the sub-steps of this single task. Do not create todos for other tasks.

Re-read the task's **Do** and **Done when** lines carefully, plus any PRD user story it cites. If the task
references a finding from `PLAN.md`, read that finding — it tells you what the fix must actually prevent.

### 3. Implement

Write the code. Constraints:

- **Stay inside the task's stated scope.** Touch only the files the task names or clearly implies.
- **Write the tests the task requires.** "Done when" clauses that describe test coverage are requirements, not
  suggestions. Where a task says a test must fail under some condition, actually verify it fails, then restore
  it.
- **Follow `TECH_STACK.md`.** Do not substitute a different library because it seems easier. If a choice in
  that document turns out to be genuinely unworkable, stop and report rather than silently deviating.
- **Match surrounding code.** Same naming, same structure, same comment density.
- Never weaken a test, lint rule, or type to make the gate pass.

### 4. Verify — the gate

Run:

```bash
pnpm verify
```

Plus the task's own **Verify** command if it specifies a different or additional one (several tasks require
`pnpm verify:integration`).

**If red:** diagnose and fix the root cause, then re-run. Repeat until green.

Two hard rules:
- Do not skip, comment out, or loosen a failing test to get green.
- If you cannot go green without editing files outside the task's scope, **stop**. The task was scoped wrong.
  Report the collision and propose how to split it. Do not widen the task silently.

### 5. Record

Once green:

1. Tick the task's checkbox in `TASKS.md` (`- [ ]` → `- [x]`).
2. If the task revealed something the plan got wrong — a wrong assumption, a missing prerequisite, an API that
   does not work as `TECH_STACK.md` expected — append a short `> **Note:**` line under that task. Future tasks
   depend on this being accurate.
3. If every task in the wave is now checked, update the wave's row in the Progress table.

### 6. Commit

```
<type>(<scope>): <summary> [<TASK-ID>]
```

`type` is `feat` | `fix` | `chore` | `test` | `docs` | `refactor`. `scope` is the package or app touched.
Example: `feat(core): add weightage validator [W2-02]`

Include `TASKS.md` in the commit. Do not push unless asked.

### 7. Report

Four lines, no more:

- Task completed and what now works that did not before
- Gate result (which commands ran, green)
- Anything noted in step 5.2
- The next unchecked task id and title

## Rules

- **One task per invocation.** Do not continue to the next task, however small it looks.
- **Never fabricate a gate result.** If `pnpm verify` was not run, say so. If it failed and you stopped, say
  that plainly with the output.
- **If the task is already checked**, say so and report the next unchecked one instead.
- **If blocked** — a task genuinely cannot be done as written — stop, explain precisely why, propose a revised
  version of the task, and leave the checkbox unticked. Do not implement a rough approximation.
