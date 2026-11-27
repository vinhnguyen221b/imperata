---
applyTo: "**"
---

# Imperata — rules for every agent (GitHub Copilot)

<!-- Part of the Imperata kit: `imperata-kit.mjs update` replaces this file. Put this project's own rules in `.orchestra/project.md` or in `.github/copilot-instructions.md`, not here. -->

## Scope and authority

- The product being built, its sources, the tracker and this project's engineering rules are described in `.orchestra/project.md`. Read it before any work. Do not confuse **Imperata** (this development workflow) with the product.
- The product sources are inputs, not decisions: an item they mark open stays open until the owner decides it.
- Read the applicable requirements, domain rules, decision register and acceptance criteria before proposing changes. Stop and ask the owner to approve any consequential ambiguity. Never silently revise an accepted acceptance criterion to match code.
- When an `AGENTS.md` file is present at the repository root, follow it as well; where two rules differ, the stricter one applies.
- Where the repository also has the Claude Code layer, VS Code loads its `CLAUDE.md` into this session as well, with the files it imports, among them the rules for Claude Code (`.claude/orchestra-rules.md`). A line there that names Claude Code does not apply here: its agents, its skills folder, its permission rules and its hooks are not those of this session. Follow this file.

## Engineering rules for every project

- Make the smallest scoped change for the assigned task. Avoid unrequested infrastructure and dependency upgrades.
- Verify the affected tests before the full suite; never report PASS without command output and test artifacts.
- Treat authentication, authorization, permissions, audit, secrets, git writes and a service that answers without authentication where a browser or the network can reach it (any web page the user opens can send it requests) as security-sensitive, together with the areas `.orchestra/project.md` names.
- Use synthetic data. Never place secrets or proprietary or private source in prompts, logs or snapshots.
- No automatic pull request merge, production deployment or tracker transition to Done.
- Follow the architecture and stack rules in `.orchestra/project.md`; where it gives none, follow the patterns already in the repository and ask before introducing a new one.

## Work protocol

An Imperata run is driven by the SDLC Orchestrator agent, which delegates to six specialist agents in `.github/agents/`. A specialist never delegates further and never approves its own work.

Each phase reports: outcome, artifact paths, actual evidence, assumptions, blockers, risks and next gate. Stop on tool/permission failures; do not fabricate external results. All approval gates require explicit decision recorded in run artifacts.

- **Human gates.** A person passes a gate by merging the pull request for that step, or, where the run has no GitHub remote, by a decision recorded in the run folder. An agent never merges such a pull request.
- **Track.** A run is on the `full` track unless the owner agreed to the `light` track for it, which the manifest records in `track` and `trackDecision`. A light run has no separate plan approval (`planApproval` is `WAIVED`); its plan holds at most three tasks, none of them `high`, and no stack-skill task (`TASK-00`), and it moves to `full` as soon as it outgrows that. No agent chooses the light track, and no agent splits or re-rates a task to stay on it.
- **Test evidence.** In pull-request mode the tests gate is the CI run on the delivery pull request. A local run or an agent's report does not pass it.
- **Templates.** Run artifacts follow `.orchestra/templates/`. A result that no real command produced is `NOT_RUN`.
- **Skills.** For a task, read the skill files its `Skills` field names and no others. Stack conventions live in `.github/skills/<stack>/`; do not invent a convention that no skill or product document states. Where no skill exists yet, the plan's stack-skill task (`TASK-00`), approved with the plan, is where the conventions are written down.
- **Language.** Write in English, whatever language the command and the owner's own words are in: what the owner reads (questions, why they matter, options and their consequences, recommendations, reports and summaries), the specification and the technical plan, their assumptions and decisions included. Keep as they are what tools read: IDs, file and field names, template headings and table column names, the words the templates fix (`Open`, `Proposals`, `Verdict:`), stage, gate and result values, commands and code.
- **Test lock.** After the QA step, `scripts/lock-tests.mjs` records the run's test files in `sdlc/runs/<runId>/evidence/test-lock.json`. Until the run is delivered, only the QA Engineer changes a locked test; the Developer fixes the application code, or reports a test it believes is wrong. The gate validator rejects a run whose locked tests changed. No agent edits the lock, and it is recorded again only after a QA step.
- **Test calibration.** A test that also passes without the run's change does not test it, and one that does not give the same verdict every time proves nothing. Once the run's tests pass, `scripts/lock-tests.mjs calibrate` runs the whole suite several times on the delivery checkout, then each locked test file on the delivery checkout and on the commit the run started from, and writes `sdlc/runs/<runId>/evidence/test-calibration.json`. The gate validator keeps a run out of review while a calibrated file passes on both, unless the test plan lists the file as expected to pass without the change, and while the whole suite failed in one of its runs. No agent edits the result, and a calibration that did not run is never reported as passed.
- **Run board.** Where a run stands, what blocks it and which decisions wait on the owner is shown by `scripts/render-run-board.mjs` (`sdlc/board.html`, `sdlc/runs/<runId>/board.md`). Nobody draws a status diagram by hand or edits the generated board files. Diagrams inside a specification or plan follow the `run-board` skill. Decisions the owner sends from the board are saved in `sdlc/runs/<runId>/decisions/`; no agent writes there.
- **Shell commands.** Run one command per shell call; the call's result shows its output and, when it fails, its exit code. Do not join commands with `;`, `&&`, `||` or `|`, group them in `{ }`, or add `echo "exit=$?"`, `$( )` or a heredoc: a tool approval names one command, so a call that joins several is asked of the owner, or, in a session nobody watches, denied. Write and change files with the edit tool, not with `cat >`, `tee`, `sed -i`, `python3` or `node -e`, so that every change of a file is an edit the session shows.
