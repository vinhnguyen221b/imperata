# 05 — Spec Kit and requirements traceability

**Doc ID:** ORCH-005 | **Status:** Proposed

## Spec Kit

GitHub Spec Kit formalizes feature development as artifacts: `Spec → Clarify → Plan → Tasks → Implement`. **A run uses no part of it.** The Orchestrator writes the specification and the plan to `feature-spec.md` and `technical-plan.md` in the run folder, from `.orchestra/templates/`, also where Spec Kit is installed, and calls none of its skills or scripts. Where it is installed, its `speckit-*` skills are no task's skills, and no agent calls them.

Why: inside a run, Spec Kit makes a second place for the run's state. A session the board starts may not be allowed to write Spec Kit's `specs/` folder, so a revised specification waits in the run folder while the approval card shows the version before; an approved plan exists twice; and Spec Kit's clarify, plan, tasks and analyze skills would each start over or overwrite what the run has.

What is useful in Spec Kit enters a stage of the run as a rule instead. The Business Analyst scans the sources against the coverage categories of Spec Kit's clarify step and marks each one Clear, Partial or Missing (`11_SOURCES.md`).

## Artifacts and pull requests

`feature-spec.md` and `technical-plan.md` follow `.orchestra/templates/`, and so do the other run-level artifacts: `clarification.md`, `test-plan.md`, the test report, `review.md` and `delivery.md`. Every task carries a `Skills` field (`03_AGENT_ROLES_AND_CONTRACTS.md`).

In `pull-request` mode the specification and its clarifications go into the specification pull request, and the plan and tasks into the plan pull request, with the design brief when the run has one (`04_WORKFLOW_AND_GATES.md`).

## Artifact ownership / avoid duplication

- **Product sources** (where `.orchestra/project.md` says, often `docs/`): product vision and high-level candidate requirements.
- **Feature spec** (`sdlc/runs/<runId>/feature-spec.md`): approved details for a single ticket.
- **Tracker** (Jira or GitHub Issues): priority, owners, workflow states, comments and links; not the sole copy of detailed technical artifacts.
- **Imperata run** (`sdlc/runs/...`): traceability, decisions, quality gates, execution evidence.

The same AC ID must be reused across spec, tests and delivery matrix. The gate validator depends on it: from review on it reads the `AC` ids of the specification and requires for each a passed test in the test report, or a gap the owner accepted in the test plan. A specification with no `AC` id, such as one that numbers its requirements `FR-001` and its success criteria `SC-001` as Spec Kit's template does, is rejected from review on. Never update the original BR silently when a new interpretation is discovered; add an approved change note.

## Deliberately ambiguous inputs for BA evaluation

To evaluate the Business Analyst, start a run from a requirement written the way a stakeholder would say it, with its hard parts left open. Shapes that work:

- "Every customer can upgrade safely while keeping their customizations." (Which customizations? What is unsafe? Who approves?)
- "This check is mandatory from the next version." (For whom, from when, and what happens to those who cannot comply?)
- "Two teams may share the template without sharing access." (What exactly is shared, and what must never leak?)

The BA must elicit the rules behind such sentences, plus the questions `.orchestra/project.md` lists for it. Record recommended defaults as **proposals**, not approved requirements.

## Traceability matrix format

| BR | AC | Ticket | Task | Implementation | Tests | Verdict | PO signoff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BR-01 | AC-01 | local:R001-example | TASK-01 | `src/...` TBD | `feature.test.ts` TBD | NOT_RUN | pending |

Do not mark “PASS” until all referenced tests have actually been executed against the correct code revision.
