# Delivery dossier — <runId>

Final label: `READY_FOR_ACCEPTANCE`. It becomes `DONE` only after the delivery is merged by an authorized person: the delivery pull request in `pull-request` mode, a merge into the main branch that git confirms (`externalEvidence.localMerge`) in `local-record` mode; and, when the ticket names a real tracker, after its state is verified.

## Traceability

| BR | AC | Task | Implementation | Test ID | Result | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| BR-01 | AC-01 | TASK-01 |  | T-01 | NOT_RUN |  |

## Model per task

One row for each delegation of a task to the Developer or the QA Engineer, repairs included, and one for the whole suite after the last task. `scripts/validate-gates.mjs` reads this table.

- **Task:** the `TASK-NN` id from the plan. When one delegation covered several tasks, list them all in the cell.
- **Step:** `developer`, `qa`, `repair` or `verification`. Every task of the plan needs at least one `developer` row before `READY_FOR_ACCEPTANCE`. `verification`: the whole suite after the last task. Write `all` under Task; it runs at `standard`, whatever the levels of the tasks, each of which was tested at its own.
- **Complexity:** the level the delegation ran at, `low`, `standard` or `high`. It is the plan's level or a higher one, never a lower one; for several tasks, the highest among them. A repair runs one level above the attempt that failed and records that level; on a light run, a repair at `high` moves the run to the full track.
- **Model requested:** the model the delegation named, or `NOT_SELECTED` when the delegation tool took no model.
- **Confirmed:** `CONFIRMED` only where the tool showed the model that ran, otherwise `NOT_CONFIRMED`.

| Task | Step (developer / qa / repair / verification) | Complexity | Model requested | Confirmed |
| --- | --- | --- | --- | --- |
| TASK-01 | developer |  |  | NOT_CONFIRMED |

## Checked by the owner

Implementation goes one task at a time. One row for each task, added when the task is built and tested and the Orchestrator stops for the owner to check it. `scripts/validate-gates.mjs` and the run board read this table.

- **Task:** the `TASK-NN` id from the plan.
- **Commit:** the commit that holds the task and its tests.
- **Owner's word:** what the owner said after the check, in the owner's words, or the command the owner sent to go on. Empty while the run waits for the owner. Nobody writes it for the owner.
- **At:** the time of that word.

| Task | Commit | Owner's word | At |
| --- | --- | --- | --- |
| TASK-01 |  |  |  |

## Skills applied

Which guidance the code was written against, taken unchanged from the Developer's result for each task. `scripts/validate-gates.mjs` reads this table and looks each quote up in the file the row names.

- **Task:** the `TASK-NN` id from the plan.
- **Skill file:** a file the task's `Skills` field names, by its path in the repository: `.claude/skills/<stack>/SKILL.md`, `.github/skills/<stack>/references/<topic>.md`, `docs/<file>.md#<section>`.
- **Rule applied:** the rule that shaped the code, quoted word for word from that file: one short sentence, not the file's introduction. `none` when nothing in the file bore on the task. Several rules from one file are several rows.
- **Where:** the file where the rule was applied; for `none`, the reason.

| Task | Skill file | Rule applied (verbatim quote) | Where |
| --- | --- | --- | --- |
|  |  |  |  |

## Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Business approval |  | Specification pull request, merged by, at; in `local-record` mode the decision file |
| Plan approval |  | Plan pull request, merged by, at; in `local-record` mode the decision file. On a light run: `WAIVED`, with who agreed to the light track, when and why |
| Implementation |  | Commit, targeted test commands |
| Tests |  | CI run URL and commit; in `local-record` mode the test report. Test calibration: `evidence/test-calibration.json`, or why it was not run |
| Review |  | `review.md`, open blockers: |
| Human acceptance | NOT_RUN | Merge of the delivery pull request; in `local-record` mode the decision file, then the merge into the main branch |

Before the review the table reads what the manifest holds for every gate above the acceptance: from `REVIEWING` on `scripts/validate-gates.mjs` warns where a row differs. The acceptance keeps `NOT_RUN` here: the owner approves the dossier with that row, and the dossier does not change afterwards.

## Proven, unproven, blocked

Proven is what evidence shows that could have shown the opposite. A test calibration that ran without a control could not: where the run's code is missing, every test fails. It goes under Unproven.

- Proven (with evidence):
- Unproven (not run, tool unavailable):
- Blocked:

## Pending human actions

-

## External references

Real URLs and IDs only. Leave empty when the action did not happen.

- Delivery pull request:
- Tracker item:
