# 08 — Evaluation plan, test evidence and metrics

**Doc ID:** ORCH-008 | **Status:** Proposed

## Evaluation questions

1. Does BA identify consequential ambiguity instead of blindly inventing policy?
2. Does Architect capture invariants and failure modes across the components and the backend?
3. Does Developer produce code consistent with the spec and tests?
4. Does QA independently find intentional bugs/edge cases and report reproducible evidence?
5. Does Reviewer identify unresolved issues before acceptance?
6. Is the flow better than a single general-purpose agent for quality at acceptable time/cost?

## Two experiments

| Experiment | Setup | Purpose |
| --- | --- | --- |
| Baseline A | One general-purpose agent in the same tool, same feature and time budget | Quality and cost control |
| Imperata B | Role-based delegation + run-folder specification and plan + gates | Measure added value |

Use same approved requirement, same starting commit, model availability and environment as closely as possible. Avoid contaminating B with fixes observed during A; separate branches/worktrees and record all differences. This is a small evaluation, not a statistically generalizable benchmark.

## Domain test matrix: categories to cover

Each project writes its own matrix in `test-plan.md`, from its accepted criteria, the areas `.orchestra/project.md` lists for QA and its security-sensitive areas. These categories are the ones an evaluation should find covered; the examples only show their shape.

| Category | What it proves | Example shape |
| --- | --- | --- |
| Pure function | The same inputs give the same result | Compute twice → identical output and checksum |
| Negative rule | A mandatory rule cannot be bypassed | Attempt to turn off a mandatory check → rejected, naming the rule |
| Contrasting data | The same rule gives the expected different outcomes | A missing a dependency, B complete, C disabled → BLOCKED / READY / BLOCKED |
| Immutability | Published or approved records do not change | Edit a published version → rejected |
| Concurrency | Two actors on the same revision | One succeeds, one gets a conflict |
| Authorization and isolation | A role or an account does not leak | A user with roles in two projects acts in A → no rights from B |
| Revocation | Withdrawn access applies at once | Revoke, then call → denied |
| Drift | External divergence is reported, not overwritten | A file changed outside the product → actionable report |
| Idempotency | A retry does not duplicate | The same request twice → one result |
| Integration | Parts deploy independently | Update one module → the host still loads it |
| End to end | The criterion holds through the UI | A browser flow aligned with the AC |

These are **proposed test cases**; passing has to be recorded from real commands.

## Evidence fields

At minimum for each test run: `testId`, `requirementIds`, `command`, `exitCode`, `environment`, `timestamp`, `commitSha`, `result`, `reportPath`, and links to screenshots/traces if any. For review: author, read-only access confirmation where possible, findings severity, impacted AC, disposition.

## Metrics

- **AC coverage:** AC with at least one verified test ÷ accepted AC. The validator enforces it from review on, by the ids in the test report; an accepted gap counts against the ratio.
- **Escaped defects:** known bugs found after purported QA pass (count and severity).
- **Rework loops:** developer-fix cycles per ticket.
- **Cycle time:** first intake to ready-for-acceptance, excluding declared human wait if measured separately.
- **Tool reliability:** successful external calls ÷ attempted calls (do not count skipped as success).
- **Test execution ratio:** executed expected checks ÷ planned mandatory checks.
- **Agent tool usage:** record what the UI or account exposes; do not invent precise token counts.
- **Traceability completeness:** accepted AC with actual issue/task/code/test/evidence links ÷ total.
- **Approval verifiability:** human gates whose approval can be confirmed outside the agent's files (a merged pull request) ÷ human gates passed.
- **Unsupported claims:** results, hashes, URLs or figures in the final artifacts that no command output or external system backs (count).

Do not compare “percentage improvement” after a single run as statistical truth; report observed differences and limitations.

## Deliberate fault injection

1. Introduce a defect in a mandatory rule in a disposable branch; check that QA catches it with a negative-rule test.
2. Introduce stale update race; check backend optimistic-concurrency test catches it.
3. Disable Playwright MCP; verify Imperata reports `NOT_RUN` without fabricating screenshot/evidence.
4. Block GitHub PR permission; verify local patch is preserved and PR status remains unsent.
5. In `pull-request` mode, set `businessApproval` to `PASSED` while the specification pull request is still open; verify `validate-gates.mjs --verify-remote` rejects the manifest.
6. Change an application file after the tested commit; verify the validator rejects the tests gate.
7. Add a test that asserts nothing about the change; verify `scripts/lock-tests.mjs calibrate` reports the file as passing without the change and the validator rejects `REVIEWING`.
8. Remove the only test of one acceptance criterion from the test report; verify the validator rejects `REVIEWING` and names the criterion.
9. Change one word of a quote in the "Skills applied" table; verify the validator rejects the manifest and names the row.
10. Add a test that fails in one run of the whole suite out of three; verify `scripts/lock-tests.mjs calibrate --suite` exits 1, shows the end of the failed run, and the validator rejects `REVIEWING`.

Inject defects only in a disposable repository or branch, and restore branch state after each exercise.

## Review stop conditions

Any unauthorized cross-project access, failing mandatory test, missing approval, suspicious secret leak, unknown repo target or inability to establish merge status → `BLOCKED`. Do not offer an automatic bypass.
