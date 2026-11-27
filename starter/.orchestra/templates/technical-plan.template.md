# Technical plan — <runId>

Status: DRAFT until the plan approval gate passes. Written from the approved specification, and from the design brief when the run has one.

## Root cause

Only in a bug run (`kind: bug`); delete this section otherwise. The cause as found in the code, with file and line, and why it produces the reported behaviour. Plan the smallest change that removes it. A section below that the fix does not touch reads `N/A — <reason>`, in one line, and a diagram is drawn only where the fix changes a boundary or an interaction: a change inside one function changes neither. That the fix is the smallest change is no decision of the plan.

## Approach

1.

## Components touched

Draw the bounded contexts this plan touches as a Mermaid `flowchart`, one subgraph per context, arrows labelled with the contract ("Diagrams inside specifications and plans" in the `run-board` skill).

| Path | Change (new / modify / delete) | Bounded context |
| --- | --- | --- |
|  |  |  |

## Contracts, data and invariants

- API and typed contracts:
- Data changes, migration and rollback:
- Invariants enforced on the server:
- Authorization boundaries and the security-sensitive areas of `.orchestra/project.md`:
- Concurrency control:

Draw the riskiest interaction (authorization, isolation or concurrency) as a Mermaid `sequenceDiagram`, with the check that enforces the invariant as a step of its own.

## Decisions

| ID | Decision | Alternatives rejected | Security-sensitive area | Needs approval from |
| --- | --- | --- | --- | --- |
| ADR-01 |  |  |  |  |

The owner approves these decisions with the plan, and the approval card of the plan lists them, those in a security-sensitive area first. Begin each with what is decided, in one sentence.

`Security-sensitive area` names the area a decision settles when it is authentication, authorization, permissions, audit, secrets, git writes, a service that answers without authentication where a browser or the network can reach it, or an area `.orchestra/project.md` names, and reads `no` otherwise. Such a decision is held by a test, not by a review that reads it once: write it so that a test can tell whether it holds (the exact boundary, the check that runs, the answer given). The QA Engineer writes that test and names the decision's ID in its AC column, or lists the decision under "Not covered" in the test plan for the owner to accept. From review on, `scripts/validate-gates.mjs` rejects a run in which such a decision has neither.

## Tasks

One section per task. A task is small enough to implement and verify on its own, and once it is done it leaves something the owner can check. A task names the criteria it carries out; where it carries out only some cases of a criterion, it names those cases (`AC-03.1..AC-03.4`).

### TASK-01 — <title>

- **Acceptance criteria:** AC-01
- **Depends on:** `none` | TASK-NN, TASK-NN
- **Description:**
- **Files:**
- **Verification command:**
- **Owner check:** <what the owner runs or opens once the task is done, and what to expect> | `none` — <reason>
- **Complexity:** `low | standard | high` — <one-line reason>
- **Skills:**
  - core: `<skill-name>` (the `SKILL.md` of a stack skill in `.github/skills/` for Copilot, `.claude/skills/` for Claude Code)
  - references: `<skill-name>/references/<topic>.md` (only when this task depends on it)
  - product: `docs/<file>.md#<section>` (product rule, architecture or test strategy this task must honor)

`Acceptance criteria` names the criteria the task carries out, one id each or a range such as `AC-03..AC-07`. A task that carries out none directly, such as a stack skill or a scaffold, writes `none` and says under `Description` what it enables; the run board then lists it against no criterion.

Implementation goes one task at a time: the Developer implements the task, the QA Engineer then tests the criteria it names, and the Orchestrator stops for the owner to check it before the next task begins. The plan sets no other order, and no test is written before the code it tests. It names no test file to write and says nothing of what a test asserts: the QA Engineer derives the tests from the criteria. `Owner check` says how the owner checks the task at that stop: what to run or open, and what to expect. So cut the work into tasks that each add behaviour a person can reach (a request, a command, a screen), ahead of layers that only the last task joins. A task that leaves nothing to try, such as a stack skill, writes `none` and the reason.

The Developer and the QA Engineer read the files named in `Skills` for the task in hand and no other skill file. If a task needs guidance that no skill or product document gives, stop and report it; do not invent a convention.

When no stack skill exists yet for a stack the plan needs, the first task is `TASK-00 — Stack skill <stack>`, with `Skills` naming `template: .orchestra/templates/stack-skill/SKILL.template.md` and the `product:` sources the conventions come from. Its deliverable is the skill itself; every other task on that stack depends on it and names `core: <stack>`. Conventions the sources do not state go in the Decisions table above as proposals, so the owner approves them with the plan.

`Complexity` decides which model the Orchestrator asks for when it delegates the task:

- `high`: the task touches auth, permissions, audit, git writes or a security-sensitive area named in `.orchestra/project.md`; changes stored data so that it needs a migration, or so that data written before the change can no longer be read; changes a contract shared between bounded contexts; involves concurrency; or has no existing pattern in the repository to follow. An optional field, with no migration and with data written before it still read, does not make a task `high` by itself.
- `low`: a mechanical change in one place that follows an existing pattern and touches no invariant (copy, configuration, a fixture, a rename).
- `standard`: everything else. When in doubt between two levels, take the higher one.

`Depends on` names the tasks that must be done before this one. The run board draws the tasks in waves from it: tasks in one wave do not depend on each other.

`scripts/validate-gates.mjs` reads these sections. Keep the heading form `### TASK-NN — <title>` and write the field as a level, a dash and a reason, for example `- **Complexity:** high — changes the authorization check`. A task without the field, with another level or without a reason fails the validator.

## Traceability

| BR | AC | Task | Test ID |
| --- | --- | --- | --- |
| BR-01 | AC-01 | TASK-01 |  |
