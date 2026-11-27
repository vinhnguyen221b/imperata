---
name: <stack-name>
description: Conventions for <stack> in this repository. Load when a task's Skills field names it.
---

# <Stack> conventions

Copy this folder to `.github/skills/<stack-name>/` (Copilot) or `.claude/skills/<stack-name>/` (Claude Code), rename this file to `SKILL.md`, and fill it in. Create a stack skill only for a stack that exists in the repository or that an approved plan introduces; do not add placeholders for stacks that might come later. In a new repository the plan's first task, `TASK-00`, writes this file.

Keep this file short: it is read for every task on this stack. Put depth in `references/`.

## Where things live

- Source layout:
- Tests:
- Shared contracts:

## Conventions

State each as a rule a reviewer can check. Take them from the product's architecture document and the code that already exists, not from general preference.

-

## Commands

| Purpose | Command |
| --- | --- |
| Typecheck |  |
| Lint |  |
| Unit tests |  |
| Affected tests only |  |
| One test file | Write `{file}`, `{dir}` or `{name}` where the file goes, for example `npx vitest run {file}`. `scripts/lock-tests.mjs calibrate` runs it for each test file of a run. |
| All tests | Every test of the project, as the test evidence and CI run them, for example `npx vitest run`. `scripts/lock-tests.mjs calibrate --suite` runs it several times. |
| Prepare a fresh checkout for tests | What a new checkout needs before that command works: an install command, or the paths to link from the working checkout (`node_modules`, `.venv`). `none` when it needs nothing. |

## Review points for this stack

-

## References

Loaded only when a task's `Skills` field names the file.

| Topic | File | Read it when |
| --- | --- | --- |
|  | `references/<topic>.md` |  |
