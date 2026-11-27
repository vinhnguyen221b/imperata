# Run artifact templates

Copy a template into `sdlc/runs/<runId>/` when the run reaches that artifact. Do not invent another structure for these files.

| Artifact | Template | Written by |
| --- | --- | --- |
| `clarification.md` | `clarification.template.md` | Orchestrator, from the Business Analyst's questions |
| `feature-spec.md` | `feature-spec.template.md` | Orchestrator, from the Business Analyst's draft |
| `design.md` | `design.template.md` | Orchestrator, from the UX Designer's brief, only when the feature changes the UI |
| `technical-plan.md` | `technical-plan.template.md` | Orchestrator, from the Architect's output |
| `test-plan.md` | `test-plan.template.md` | QA Engineer |
| `test-report.md` | `test-report.template.md` | QA Engineer |
| `review.md` | `review.template.md` | Orchestrator, from the Code Reviewer's findings |
| `delivery.md` | `delivery.template.md` | Orchestrator |

The specification and the plan of every run are written from `feature-spec.template.md` and `technical-plan.template.md`, also where Spec Kit is installed: a run uses none of Spec Kit's templates, skills or folders, so each document of a gate exists once, in the run folder.

Two files in a run folder are not written from a template: `board.md`, and `sdlc/board.html` outside it. `scripts/render-run-board.mjs` generates them from the manifest and the artifacts above (the `run-board` skill). Never edit them by hand; correct the artifact they read and render again. A run folder may also hold `decisions/`: replies the owner sent from the board through `scripts/board-server.mjs`, verbatim. Only that server writes there; the Orchestrator records them in `clarification.md` and cites the file. `evidence/test-lock.json`, `evidence/test-calibration.json` and, in a bug run, `evidence/reproduction.json` are written by `scripts/lock-tests.mjs`; no agent edits them. The board reads the template shapes, so an artifact that leaves them shows up wrong or empty on the board.

`stack-skill/` holds the skeleton for a stack skill and its reference files. It is kept here, outside `.github/skills/` and `.claude/skills/`, so that neither Copilot nor Claude Code loads an empty skill.

## Rules for every template and every filled-in artifact

- A result that was not produced by a real command is `NOT_RUN`. Never write `PASS` as a placeholder.
- Never write a commit hash, URL, report path, duration or coverage figure that does not exist. Leave the field empty until it does.
- Do not keep a filled-in example run with invented results in the repository. An agent that reads it copies the habit.
- Reuse the same BR and AC IDs in every artifact.
