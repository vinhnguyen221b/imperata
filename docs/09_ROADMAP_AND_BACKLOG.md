# 09 — Imperata roadmap and implementation backlog

**Doc ID:** ORCH-009 | **Status:** Candidate milestones

## Separate two schedules

**Imperata enabling work:** configure role agents, spec workflow, state/evidence, validation, adapter contracts.  
**Product delivery:** the product's own releases and features, from its sources. Do not confuse a product issue with an Imperata infrastructure issue.

## Milestones and exit gates

| Stage | Deliverable | Exit gate |
| --- | --- | --- |
| O0 — Personal preflight | Personal agent tool (Copilot in VS Code or Claude Code), safe repo, test command and role inventory | Read-only subagent works; no secrets |
| O1 — Role workflow | Orchestrator + BA + Architect + Developer + QA + Reviewer | One manually supervised handoff with artifacts |
| O2 — Spec/traceability | Run-folder specification and plan + BR→AC→task mapping | BA clarification and approval gate demonstrated |
| O3 — Testing & review | Test runner and Playwright evidence + independent review | A planted defect detected and fixed |
| O3b — Pull request gates and CI | `pull-request` approval mode, PR checks workflow, gate validator as required check | One small ticket through three merged pull requests; `--verify-remote` agrees with GitHub |
| O4 — Ticket integration | Local → authorized GitHub Issues, later Jira | Real created IDs, transitions, comments verified |
| O5 — Design integration | Figma as optional conditional stage | Approved design or documented N/A |
| O6 — Organization pilot | Fresh policy preflight, safe repo, same representative ticket | A comparable successful run without personal credentials |

**Product releases** from the product's sources are scheduled separately.

## Imperata backlog (candidate)

| ID | Story / task | Priority | Done condition |
| --- | --- | --- | --- |
| BL-01 | Initialize config and 6 specialist agents | P0 | Files parsed; roles reachable |
| BL-02 | Define immutable source + clarification protocol | P0 | Unknown BR forces decision gate |
| BL-03 | Feature traceability through the run folder (no Spec Kit) | P0 | IDs persist from spec to tests |
| BL-04 | State manifest + transition schema (no event log: `04`, "What the manifest keeps of a transition") | P0 | Invalid states rejected |
| BL-05 | Deterministic quality-gate validation | P0 | Missing evidence fails closed |
| BL-06 | QA test plan and Playwright Test evidence | P0 | Intentional defect reported |
| BL-07 | Independent reviewer contract | P0 | Reviewer reports issues without rewriting code |
| BL-08 | Local tracker adapter | P0 | Draft ticket and mock transition recorded |
| BL-09 | GitHub Issues adapter | P1 | Real approved issue create/read/update |
| BL-10 | Jira adapter | P1 | Scoped read then approved write in sandbox |
| BL-11 | Figma conditional design stage | P1 | UI feature has approved design link/spec |
| BL-12 | Repair loop retry cap & triage | P1 | Stop after two failed attempts |
| BL-13 | Personal-to-organization transfer dry run | P0 | Secrets excluded, reauthorization completed |
| BL-14 | Baseline vs Imperata evaluation | P1 | Evidence-backed comparison report |
| BL-15 | Pull request merges as human gates (`pull-request` mode) | P0 | Three gates passed by real merges; `--verify-remote` run against them |
| BL-16 | PR checks workflow with the gate validator as a required job | P0 | First green run on GitHub; a failing manifest blocks a merge |
| BL-17 | Stack skills for the stacks in the repository, written by a plan's `TASK-00` from `.orchestra/templates/stack-skill/` | P1 | One skill per existing stack; no placeholders; a task's `Skills` field resolves to real files |
| BL-18 | Artifact templates in use | P1 | One run whose artifacts all follow `.orchestra/templates/` |

## First vertical slice (recommended)

- Product baseline exists or is created as a **separately accepted foundation run**.
- Requirement: one feature chosen by the criteria in `01_EXECUTIVE_BLUEPRINT.md` (a rule left open, an invariant enforced on the server, versioning or concurrency, contrasting data).
- BA clarifies the open rules with the owner.
- Architect designs how the rule is enforced and how revisions or conflicts are checked.
- Developer adds the domain logic, the API and a minimal UI.
- QA uses unit/API tests and one Playwright UI flow; the reviewer audits the security-sensitive areas of `.orchestra/project.md`.
- No Jira/Figma integration is required to prove the vertical slice; add them later, one at a time.
- Run the slice first in `local-record` mode. Move to `pull-request` mode (BL-15, BL-16) once the role workflow works.

## Scope-control rules

A milestone is not complete because generated files exist; it needs proof from real agent runs, tests and review. Do not build a dedicated background scheduler or production agent-hosting system in this workstream. What gets into the kit at all is the bar in `KIT_GUIDE.md`, "Update a repository".
