# 10 — Decisions, assumptions, risks and open questions

**Doc ID:** ORCH-010 | **Status:** Living register

## Accepted decisions

| ID | Item |
| --- | --- |
| OD-01 | Support GitHub Copilot in VS Code and Claude Code as the agent tools |
| OD-02 | Prove the workflow in a personal pilot before an organization adopts it (`07_PERSONAL_TO_ENTERPRISE_MIGRATION.md`) |
| OD-03 | The kit names no product; each repository names its product in `.orchestra/project.md` |
| OD-04 | Prove Imperata on a domain-heavy feature (`01_EXECUTIVE_BLUEPRINT.md`) |
| OD-05 | Keep product documentation separate from Imperata config |
| OD-06 | Include BA, Architect, Developer, QA, Reviewer plus Orchestrator; Designer conditional |

## Proposed, needs pilot validation

| ID | Proposal | Validation |
| --- | --- | --- |
| OP-01 | Copilot harness, `.github/agents` custom agents | Delegation by name works in VS Code on a personal account. The Orchestrator sets a model for each task, as the implement command asks, and a specialist it sets none for runs on the model of its own file. Still to validate: an account an organization manages |
| OP-02 | Local/GitHub Issues before Jira | Validate issue lifecycle manually |
| OP-03 | Test runner, not MCP screenshot, is quality evidence | CI command and trace path |
| OP-04 | Two attempts per defect repair loop | Rehearse injected test failure |
| OP-05 | GitHub PR/Done human approval | Confirm branch/tracker policy |
| OP-06 | A human gate is a pull request merge, one pull request per gate | Three real merges checked with `--verify-remote` |
| OP-07 | CI on the delivery pull request is the tests gate | First green run of the checks workflow; a planted failure blocks the merge |
| OP-08 | One stack skill per existing stack; tasks name the skills they need | A Developer task completed reading only the named files |
| OP-09 | Artifact templates with `NOT_RUN` defaults; no filled-in example run | One run's artifacts reviewed against the templates |
| OP-10 | A test file of the run must fail on the commit the run started from (test calibration) | One agent-driven run in which the calibration catches a planted empty test, on the test runner of a real stack |
| OP-11 | Rules for tests, a passed test or an accepted gap for every acceptance criterion, and quoted "Skills applied" evidence | One agent-driven run whose review reports a test by its rule, whose validator output shows the criteria and the quotes checked, and one planted false quote that is rejected |

## Important open decisions

1. Which repository hosts the personal pilot, and which repository of the organization hosts the adoption?
2. Is the organization's account a managed user or a normal account with a seat the organization pays for? What tool policies apply?
3. Does the organization require Jira (and which project/workflow transitions), or will GitHub Issues be acceptable?
4. Are Figma edit access and MCP use approved by the organization?
5. Are there mandatory testing/security scanners and data-retention requirements?
6. Does the pilot go as far as a real GitHub PR and merge, or end at a delivery dossier?
7. Who owns the business decisions of a run, and who signs off Done?
8. May screenshots and logs of a run be kept, and where?
9. Which pilot model and usage budget will be allowed?
10. What is acceptable autonomy: supervised default or explicit approval at every stage?
11. May the Orchestrator push branches and open pull requests in the pilot repository, or does the owner open them? Who is allowed to merge each of the three pull requests in the organization's repository?
12. Is three pull requests per ticket acceptable overhead for small tickets, or should small tickets use `local-record` mode? Partly answered: a small, low-risk change can run on the light track (two human gates, two pull requests; `04_WORKFLOW_AND_GATES.md`, "Tracks"). Still open: whether three tasks is the right limit, and whether a still lighter track without a plan artifact is wanted.
13. Which stacks get a stack skill first, and who reviews its content? Answered: when a plan needs a stack that no skill describes, its `TASK-00` writes the skill from `.orchestra/templates/stack-skill/`, and the owner approves the skill's conventions with the plan.

## Risk table

| Risk | Severity | Mitigation |
| --- | --- | --- |
| The organization's policy blocks the agent tool's CLI or MCP | High | Check early; local/manual role fallback |
| Specs silently resolve business ambiguity | High | Mandatory BA decision gate |
| Multiple agents edit same file concurrently | High | Specialists run one at a time, and only the Orchestrator writes the manifest (no revision is compared before a write) |
| Reviewer/QA merely repeats developer success claims | High | Independent test plan and raw results |
| Secrets leak into agent context or artifacts | High | Synthetic input, credential isolation, secret scan |
| Jira/Figma changes accidentally affect the organization's real data | High | Sandbox-first, approval, service scopes |
| E2E flaky and runs stall | Medium | Deterministic CI suite, seeded data, rehearsed alternate path |
| VS Code and Claude Code behaviors change | Medium | Official docs + preflight lock/version log |
| Infrastructure work dominates the pilot | Medium | One thin vertical slice on a baseline built in a separate run |
| Cost/token budget overruns | Medium | Bounded stages/retries and targeted tests |
| Pull request merged by its own author is read as independent approval | High | Branch protection and reviewer rules in the organization's repository; validator warns in the pilot |
| The CI example or `--verify-remote` fails on first real use (neither was run on GitHub) | Medium | Treat the first run as a pilot task (BL-15, BL-16); `local-record` fallback |
| Stack skills grow into unread bulk or state conventions nobody approved | Medium | One skill per existing stack, no placeholders, content reviewed like code |
| Three pull requests per ticket slow small changes | Low | The light track for small, low-risk changes; `local-record` mode if the owner agrees |
| A change is put on the light track although it is not small, or tasks are shaped to fit its limits | Medium | The owner agrees to the track and sees it on the specification approval card; the validator rejects more than three tasks or a `high` task; the plan is shown with the delivery |

## Decision record template

```markdown
Decision ID: DR-___
Context:
Options considered:
Decision:
Owner / approver:
Effective date:
Impacted AC/tests:
Alternative rejected and reason:
```
