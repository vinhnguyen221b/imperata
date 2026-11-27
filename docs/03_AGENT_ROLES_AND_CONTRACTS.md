# 03 — Agent roles, contracts and authority

**Doc ID:** ORCH-003 | **Status:** Proposed

## Role matrix

| Agent | Owns | Input | Required output | May change code? | External writes? |
| --- | --- | --- | --- | --- | --- |
| Orchestrator | Flow, state, task handoff | Approved input and evidence | Next step, gate decision, delivery report | Workflow artifacts only by default | Only explicit authorized sync |
| Business Analyst | Business spec and AC | Product PRD, open questions | Clarifications, use cases, AC, decision log | No | Issue drafts only |
| Architect / Tech Lead | Architecture, boundaries, task breakdown | Approved AC, the design brief when the run has one, codebase | ADR, API/domain design, tasks, risk | No application code | No |
| UX Designer | UI behavior and handoff | Approved UX stories, design system | Flows, accessibility states, design spec, Figma link if authorized | No application code | Figma only after permission |
| Developer | Implementation | Approved spec/plan, assigned tasks, the design brief for a task that changes the UI | Diff, tests, implementation report | Yes | Branch/PR if explicitly authorized |
| QA Engineer | Independent verification | Approved AC and build, the design brief when the run has one | QA matrix, executed tests, defects, evidence | Test files only (when safe) | Bug drafts after approval |
| Code Reviewer | Independent review | Diff, plan, tests, policies, the design brief when the run has one | Findings severity, security/contract concerns | No | Review comment drafts |

**No agent may approve its own work.** Policy is enforced by review gates and actual credentials, not instruction text alone.

## Delegation contract

Every request from Orchestrator to a subagent must include:

```yaml
runId: R001-example
role: Business Analyst
objective: Clarify the behavior of <feature>
approvedSources:
  - <product sources named in .orchestra/project.md, with version>
  - Approved previous decisions
allowedChanges: none
requiredOutputs:
  - feature requirements with IDs
  - decision requests
  - risk and unknowns
stopConditions:
  - unknown mandatory policy
  - missing business approval
```

Return a **structured report** with outcome `COMPLETED | BLOCKED | NEEDS_DECISION | FAILED`, paths of produced files, summary, evidence, risks, next recommendation. Never return only “Done.”

## Authority / approvals

| Action | Proposer | Approval owner |
| --- | --- | --- |
| Decide ambiguous business rule | BA | Product Owner |
| Accept architecture/security trade-off | Architect | Tech Lead or authorized lead |
| Approve the design brief, with the plan | UX Designer | Product Owner or delegate |
| Authorize Jira issue creation/edits | BA/Orchestrator | Tracker policy / user confirmation |
| Execute tests locally | Developer/QA | Tool permission policy |
| Merge PR and mark Done | Orchestrator recommends | Authorized human + required CI/branch policy |

In `pull-request` mode the first, second, third and last rows are exercised by merging the specification, plan (with the design brief, when the run has one) and delivery pull requests. The merge is the approval; the manifest records it and the validator can check it (`04_WORKFLOW_AND_GATES.md`).

## Conflict handling

Example: BA wants auto-upgrade; the specification and the product sources leave it open. Do not implement auto-upgrade by assumption. Move to `AWAITING_BUSINESS_DECISION`, summarize options and downstream impact, await approved decision.

## Agent instruction strategy

- **Global rules:** `.github/instructions/orchestra.instructions.md` from the kit (scope, safety, tests, work protocol) and `.orchestra/project.md`, the project profile (product, sources, stack, security-sensitive areas). A repository keeps its own `.github/copilot-instructions.md` beside them. VS Code loads the rules into the Orchestrator's session and neither file into a specialist's, so each specialist's file tells it to read both before any work.
- **Role behaviors:** `.github/agents/*.agent.md` (specific tasks/tools/outputs).
- **Repeatable procedures:** `.github/skills/.../SKILL.md` (e.g., requirement traceability/quality gate).
- **Stack conventions:** one skill per stack that exists in the repository, `.github/skills/<stack>/SKILL.md`, kept short, with deeper single-topic files in its `references/` folder. Skills sit flat under `.github/skills/`; do not nest one skill inside another.
- **Rules for tests:** `.orchestra/test-rules.md`, read by the QA Engineer and the Developer before writing a test and by the Code Reviewer as the bar for a run's tests. It is not loaded by the other roles.
- **Artifact shapes:** `.orchestra/templates/`. Agents fill templates; they do not design document structures.
- **One-time tickets:** issue description/spec, not permanent agent rules.
- **Spec Kit:** not used in a run (`05_SPEC_KIT_AND_TRACEABILITY.md`). Where it is installed, its `speckit-*` skills are no task's skills, and no agent calls them.

The paths above are those of the Copilot layer. On the Claude Code layer the rules for every agent are `.claude/orchestra-rules.md`, imported with the project profile by `CLAUDE.md`, which every session loads, a specialist's included; the role files are `.claude/agents/*.md` and the skills sit under `.claude/skills/`.

### Loading skills per task

Every task in the plan carries a `Skills` field naming the stack skill (`core`), any reference file it depends on (`references`) and the product document section it must honor (`product`). The Developer, QA Engineer and Code Reviewer read those files for the task in hand and no other skill file. The Architect writes the field and may name only files that exist. A task that needs guidance no file gives is reported as NEEDS_DECISION; the missing guidance is written and reviewed as separate work, not improvised during the task.

The point is twofold: the context stays small, and for every task it is on record which guidance the code was written against.

That record is more than the field. With each task the Developer returns the rule of each named file that shaped the code, quoted from the file, and where it was applied. The Orchestrator copies the list into the "Skills applied" table of the delivery dossier, the gate validator looks every quote up in the file, and the Code Reviewer checks the code against it (`04_WORKFLOW_AND_GATES.md`, "Tests, criteria and skills").

Tools in starter files are intentionally constrained. For business writes to Jira/Figma/GitHub use explicit, tested tool namespaces and scopes rather than granting a blanket `*` to every agent.
