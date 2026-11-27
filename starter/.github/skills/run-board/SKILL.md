---
name: run-board
description: Render and read the run board, the generated diagrams of where each Imperata run stands, what blocks it and which decisions wait on the owner. Use after any change to a run's artifacts, before every report to the owner, whenever you ask the owner to decide, and when anyone asks for the status of a run. Also gives the rules for diagrams drawn inside a specification or a plan.
---

# Run board

The run board turns the manifest and the artifacts of every run into a page the owner can read in a minute: where each run is, who has the next move, what blocks it, which questions wait for a decision, and which gaps to look at before approving a gate.

## Generated, never drawn

From the repository root, `node scripts/render-run-board.mjs` writes:

| File | Read by | Committed |
| --- | --- | --- |
| `sdlc/runs/<runId>/board.md` | GitHub and the gate pull requests: pipeline, dependencies and task waves as Mermaid diagrams; decisions, blockers, traceability and the gate check as tables | Yes, with the run folder |
| `sdlc/board.html` | The owner, locally: every run on one offline page, with option cards that build the owner's reply to you | No, it is in `.gitignore` |

- Never draw a diagram of status, progress, stages, gates or decisions yourself, in chat or in a file. Render the board and point at it. A drawn status diagram can disagree with the manifest; the rendered one cannot.
- Never edit `board.md` or `sdlc/board.html`. When the board shows something wrong, the artifact it reads is wrong or is not in the shape its template describes. Correct that artifact and render again.
- The board decides nothing and proves nothing. A green step means the manifest says `PASSED`. Whether that is true is for the evidence and for `scripts/validate-gates.mjs --verify-remote`.

## When to render

- After every change to a run's manifest or artifacts. Nothing renders it for you under Copilot; render it yourself.
- Before every report to the owner, and before you ask for any decision or approval.
- Before you commit run artifacts, run `node scripts/render-run-board.mjs --check`. It writes nothing and exits 1 when a committed `board.md` is out of date.

`--run <runId>` renders one run's `board.md` (the HTML always covers every run); `--no-html` leaves the HTML alone; `--quiet` prints nothing on success.

## What the board reads

The board is as good as the artifacts. Keep them in the shapes of `.orchestra/templates/`.

| Source | What the board takes from it |
| --- | --- |
| `run.json` | Stage, gates, approvals, open blockers, `notes.blockedReason`, and two optional fields: `title` (a short name of the feature, so the owner does not have to read run IDs) and `dependsOn` (the runs that must be delivered first, by runId or by a prefix such as `R0`; a run not opened yet shows as "not opened") |
| `clarification.md` | Every table with an `ID` and a `Decision` column. A question is open while its Decision is empty or starts with `OPEN`. Options written as `(a) …; (b) …`, or as `**label**: …` per option, become options the owner can click. `Needed before` names the gate a question must be decided before, and sorts it into "decide now" or "can wait". Under "Proposals not yet decided", a bullet `- <ID>: <recommendation> — <reason>` appears on that question as a recommendation |
| Plan, or the file in `artifactPaths.tasks` | `### TASK-NN — <title>` sections with `Acceptance criteria`, `Complexity`, `Depends on`, `Owner check` and `Skills`; and the rows of its Decisions table, which the approval card of the plan lists, those in a security-sensitive area first |
| `design.md`, or the file in `artifactPaths.design` | Nothing of its content. When the run has one, the approval card of the plan names it beside the plan, and the version the owner approves covers it; a brief without a plan opens no approval |
| Specification | The `AC-…` rows of its acceptance criteria table, and the cases of a criterion: in its other tables, every row whose first cell begins with the id of a case (`AC-03.2`) |
| Test report | The Results table: Test ID, AC, Result |
| Test plan, or `test-plan.md` in the run folder | The rows under "Not covered" whose "Who accepted the gap" is empty |
| `delivery.md` | The "Model per task" table, and "Checked by the owner": while a task's row there has no word of the owner's, the move is the owner's, and the board gives the task's `Owner check` |
| `review.md` | The verdict, and the findings still open by severity and ID, a `MINOR` one too |
| `evidence/test-calibration.json`, or the file in `artifactPaths.testCalibration` | The files that failed on the base while no control passed there: such a calibration does not show that a test checks the change |
| `scripts/validate-gates.mjs` | Run without `--verify-remote`; its problems and warnings are the board's gate check |

The board separates options at their letters, taken in order from `(a)`. A semicolon inside an option is fine, and so is a reference to another option ("(c) as (a), plus …"); there is no need to reword either. Start a recommendation with the option it picks, `(b) …` or the option's label, and the board marks that option as recommended on the owner's card. It never selects it.

## Asking the owner to decide

When a run needs the owner (a specialist returned NEEDS_DECISION, the stage is `AWAITING_BUSINESS_DECISION`, or a plan or a delivery waits for approval):

1. Record every question in `clarification.md` with its options and their consequences, `Needed before` and the decider, and the analyst's recommendation under "Proposals not yet decided" in the `- <ID>: …` form. Render the board.
2. End your report with a decision brief. List only the questions needed before the next gate, at most five, or up to ten when each one past five is in a security-sensitive area; name the others as able to wait. When you ask for the business approval, list the specification's assumptions as well: approving the specification approves them.

   ```text
   Decisions needed before <gate> — <runId>
   1. <ID> — <the question in one line>
      (a) <option> → <consequence>
      (b) <option> → <consequence>
      Recommended, not a decision: (<x>), because <reason>
   Can wait: <IDs> (needed before <later gate>)
   Assumptions approved with the specification: <ID> — <the default in one line>, one per line (business approval only; to decide one yourself, request changes and name it)
   Check before you decide: <the board's list, or "nothing flagged">
   Board: the `url` in `sdlc/.board-server.json`, or the address an auto-run prompt names, if `node scripts/board-server.mjs` runs (choose options and use the approval card, then "Send to Orchestrator"); otherwise sdlc/board.html ("Copy reply") or sdlc/runs/<runId>/board.md
   Reply with one line per decision: "<ID>: <your decision>"
   ```

3. Stop and wait. The owner answers in chat, often by pasting the reply the board built ("My decisions as owner (…) for run …", then `<ID>: <decision>` lines), or presses Send on the board, which saves that reply in the run's `decisions/` folder (next section). Either way that reply is the decision. Record it as you record any owner decision, with the owner's name and the time, and render the board again.
4. Before you ask for the approval of any gate, read the "Check before you decide" list on the board and repeat it in your report: criteria with no task or no test, failing tests, review findings still open, a row under "Not covered" in the test plan that nobody accepted, a calibration without a control, a question still open whose gate has passed, more than five questions open before the gate, more than twelve criteria before the business approval, a table row with more or fewer cells than its table has columns, a gate check that fails.

The board's reply builder assembles the owner's text. Opened as a file it can only copy it; served by `scripts/board-server.mjs` it can also save it to the run folder. It approves nothing either way: a decision exists once the owner sends it and you record it.

## Live board and decisions sent from it

The owner may run `node scripts/board-server.mjs` (port 4319 unless `--port` says otherwise). While it runs it writes the address it serves the board at to `sdlc/.board-server.json` (`url`): read the address there before you give it to the owner, never from memory. It serves the board at that address, renders the HTML again whenever a file under `sdlc/runs/` changes, reloads open pages, and adds a "Send to Orchestrator" button. It is the owner's process: do not start or stop it yourself. It never writes `board.md`; you still render after each change.

When the owner presses Send, the server saves the reply verbatim as `sdlc/runs/<runId>/decisions/<UTC time>.md`, with the time it was sent. Until `clarification.md` cites that file, the board shows its decisions as sent and waiting for you.

- When the owner tells you decisions were sent, and whenever you resume a run, read every file in `decisions/` that `clarification.md` does not cite yet.
- Record each `<ID>: <decision>` line as the owner's decision: the owner named in the reply decided, at the file's "Sent at" time, and the evidence is the file's path (for example `decisions/2026-11-14T11-39-16Z.md`). Write the decision as the owner wrote it; do not improve or reinterpret it. A line that matches no open question, or that you cannot read one way only, goes back to the owner as a question.
- Then update `run.json` and render the board, as for any decision.
- Never create, change or delete a file in `decisions/`. Those files are the owner's evidence.
- A reply approves a gate only when its own words say so.

**Gate decisions.** When a human gate is next — `AWAITING_BUSINESS_DECISION` with a specification, `READY_FOR_DESIGN_PLAN` with a plan, `READY_FOR_ACCEPTANCE` with a delivery dossier — the board shows an approval card. It names the documents to read and their version (for example `feature-spec.md@3fa2b1c9d0e4`, a hash of their content), repeats the "Check before you decide" list, and keeps Approve locked while a question needed before the gate has no answer. The owner's choice arrives as a line `<gate>: APPROVE <documents>@<version>` or `<gate>: REQUEST CHANGES <documents>@<version> — <comment>`, after the answers in the same reply.

- Record the reply's answers first.
- APPROVE in `local-record` mode: run `node scripts/render-run-board.mjs --gate-version <runId> <gate>`. If it prints the same version and no question needed before the gate is open, write `approvals.<gate>` with `kind: local-record`, `by` the owner named in the reply, `at` the file's "Sent at" and `recordPath` the decision file; set the gate `PASSED`, validate, render, and continue to the next stage. If the version differs or a question is still open, leave the gate as it is and tell the owner what changed or what is open; never pass a gate on a version the owner did not see.
- APPROVE in `pull-request` mode approves nothing: the gate passes only by the merge of its pull request.
- REQUEST CHANGES: leave the gate `NOT_RUN`, record the request in `clarification.md`, and send the comment to the specialist who wrote the document; the revised document gets a new version and a new card.

**Auto-run.** Started as `node scripts/board-server.mjs --auto-run claude` (or `copilot`), the server also starts a fresh, non-interactive Orchestrator session after each Send: `claude -p` or `copilot -p` with the decision file named in its prompt, allowed the tools listed in `.orchestra/auto-run.json` (writes under `sdlc/`, the validator, the renderer, `git status`, `git rev-parse` and the current branch, `date`) and whatever the owner's own settings of the tool allow, and for Claude Code a budget per session. One session runs at a time; a later Send waits in a queue and is skipped if an earlier session already recorded it. The board shows the session while it runs and its final report when it ends. Its output goes to `sdlc/.auto-run/`, which is neither served nor committed.

If your prompt says the session was started by auto-run, nobody can answer you during it and every other tool call is denied, not asked. Record the decisions, continue only with steps that need no approval you lack (delegating a revision to a read-only specialist is fine), stop at the next human gate or open decision, and end with your report and the decision brief. Never work around a denied call; name it in the report.

## Diagrams inside specifications and plans

These diagrams describe the product, never the run. The specialist who drafts the artifact draws them, in fenced `mermaid` blocks so that they render on GitHub and diff in review.

| Content | Diagram | Where |
| --- | --- | --- |
| The states of an entity, such as an order or an approval request | `stateDiagram-v2`, each transition labelled with its command or event and the BR it obeys | Specification |
| One journey across actors | `flowchart LR` with one subgraph per actor | Specification or design brief |
| Bounded contexts, frontends and services the plan touches | `flowchart LR`, one subgraph per bounded context, arrows labelled with the contract | Technical plan, "Components touched" |
| The riskiest interaction: authorization, isolation, concurrency | `sequenceDiagram` in which the check that enforces the invariant is a step of its own | Technical plan, "Contracts, data and invariants" |
| Data that changes | `erDiagram` of the changed entities only | Technical plan |

- One idea per diagram and about twelve nodes at most; split a diagram rather than crowd it.
- Label with the IDs the text uses (`BR-…`, `AC-…`, `TASK-…`, tracker keys), so that a reviewer can trace every box to a sentence.
- Every element of a diagram also appears in the text. A diagram is a view of the text, never an addition to it; an unresolved rule is drawn as unresolved, not as the answer you expect.
- No colour or marker that means status or progress. That is the board's job.
- Quote a label that contains punctuation: `A["Approve (Project Admin)"]`.
