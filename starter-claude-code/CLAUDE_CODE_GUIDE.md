# Claude Code starter guide

**Status:** design proposal, written against the Claude Code documentation (see "Sources"). This layer has taken feature runs and bug runs to `DONE` in `local-record` mode, through owner decisions, auto-run, the design brief, technical planning, the plan approval, implementation, independent testing, review, the test lock and its calibration. `pull-request` mode has not been run on this layer. The five hook scripts are tested with simulated hook input (`tests/hooks.test.mjs`); step 8 below checks that they act in a session.

This folder is the Claude Code counterpart of `starter/` (the Copilot starter). It is an **overlay**: it holds only the files that differ between the two tools. Everything that is tool-neutral stays in `starter/` and is copied from there, so the run protocol exists once.

| Part | Source | Same for both tools? |
| --- | --- | --- |
| Run manifest schema, sample manifest, artifact templates | `starter/.orchestra/` | Yes |
| Gate validator | `starter/scripts/validate-gates.mjs` | Yes |
| Run board renderer | `starter/scripts/render-run-board.mjs` | Yes |
| Run board server (live board, Send button, optional auto-run) | `starter/scripts/board-server.mjs`, `starter/.orchestra/auto-run.json` | Yes; `--auto-run claude` or `--auto-run copilot` picks the tool |
| CI example with the validator as a required check | `starter/.github/workflows/pr-checks.yml.example` | Yes |
| Rules for every agent | `.claude/orchestra-rules.md` here, imported by `CLAUDE.md`; `.github/instructions/orchestra.instructions.md` there | No |
| Project profile (product, sources, constraints) | `starter/.orchestra/project.md`, installed once as `.orchestra/project.md` | Yes |
| Orchestrator and six specialists | `.claude/agents/*.md` here, `.github/agents/*.agent.md` there | No |
| Skills | `.claude/skills/` here, `.github/skills/` there | Location; `quality-gates`, `run-board` and `imperata-preflight` also differ in text |
| Permission rules and hooks | `.claude/settings.json`, `.claude/hooks/` | Claude Code only |
| MCP sample | `.mcp.example.json` here (no Copilot-specific fields), installed as `.orchestra/examples/claude-code.mcp.example.json` | No |
| Commands (`/imperata-start` and the others) | `.claude/skills/imperata-*/` here, `.github/skills/imperata-*/` there | The same text, apart from `/imperata-preflight` |

## What changes from the Copilot starter

| Topic | Copilot starter | Claude Code starter |
| --- | --- | --- |
| Agent names | `Business Analyst`, `QA Engineer`, … (case-sensitive display names) | `business-analyst`, `qa-engineer`, … |
| Orchestrator | A custom agent selected in the Copilot harness | The main session, started with `claude --agent sdlc-orchestrator` |
| Who may be delegated to | Named in the Orchestrator's instructions | Allowlist in the Orchestrator's `tools` field: `Agent(business-analyst, …)`. No other subagent can be started from that session |
| Specialists delegating further | Instruction (the rules for every agent) | Not possible: no specialist has the `Agent` tool |
| Specialists loading other skills | Instruction only | No specialist has the `Skill` tool; they read the files a task's `Skills` field names with `Read` |
| QA Engineer limited to test files | Instruction, checked with git afterwards | A hook blocks other edits made with the file tools; the git check stays, because a shell command is not covered |
| Developer kept off test files locked after QA | Instruction, plus the gate validator comparing each locked file with its hash | The same, plus a hook that blocks such edits made with the file tools |
| Tests shown to fail without the run's change, and the whole suite to pass in several runs | `scripts/lock-tests.mjs calibrate`, read by the gate validator | The same, plus hooks that keep the QA Engineer and the Developer from writing the calibration result with the file tools |
| Gate validator before a stage change | Instruction | Instruction, plus a hook that runs the validator after every edit of a run manifest made with the file tools and returns its findings |
| Run board kept current | Instruction | Instruction, plus a hook that renders a run's board after every edit made with the file tools in its folder |
| Owner decisions sent from the board (`decisions/`) written by no agent | Instruction | Instruction, plus a hook that blocks writes there with the file tools |
| Merging, force-pushing | Instruction | Denied by permission rules |
| Pushing, opening pull requests, issue writes | Instruction: only after the owner authorizes | The owner is asked each time |

The stages, gates, approval modes, manifest format and evidence rules are unchanged. `docs/04_WORKFLOW_AND_GATES.md` applies as written.

## Install

In an **authorized** repository, with `<imperata>` standing for the folder where you cloned the kit:

0. Install the kit (details in `KIT_GUIDE.md`):

   ```bash
   node <imperata>/imperata-kit.mjs install <repo> --tools claude
   ```

   Use `--tools claude,copilot` for both tools. The script adds the shared parts and the Claude Code layer, its commands among the skills in `.claude/skills/`, adds the two import lines to `CLAUDE.md`, merges the kit's settings into `.claude/settings.json` and its lines into `.gitignore`, and records what it installed in `.orchestra/installed.json`. It commits nothing.
1. Fill in `.orchestra/project.md` (or pass `--profile <file>` at install), and place the product's sources where it says they are.
2. Review the changes with git and commit them.
3. Open the repository in VS Code and start Claude Code in the integrated terminal. Run `/agents` and check that the seven agents are listed; run `/hooks` and `/permissions` and check that the hooks and the rules from `.claude/settings.json` are active; type `/imperata` and check that the eight commands are listed. Claude Code ignores a frontmatter field it does not recognize without reporting an error, so a listed agent is not proof that its `tools` and `hooks` fields were applied. Check with the test in step 8.
4. Run `node scripts/validate-gates.mjs .orchestra/runs/EXAMPLE.run.json` from the repository root to check the sample manifest. It does not report delivery readiness.
5. Choose the approval mode for the pilot, as in step 5 of `.orchestra/STARTER_GUIDE.md` (installed from `starter/STARTER_GUIDE.md`). `local-record` needs nothing more. `pull-request` needs a GitHub remote, the `gh` CLI signed in, and a protected main branch.
6. For `pull-request` mode, set up the CI example as in step 6 of `.orchestra/STARTER_GUIDE.md`. The workflow file is the same for both tools.
7. For each stack that really exists in the repository, create one stack skill from `.orchestra/templates/stack-skill/` under `.claude/skills/<stack-name>/`, or leave it to the first plan: when no skill exists, the Architect plans a `TASK-00` that writes it, and you approve its conventions with the plan. Claude Code asks you to approve the Developer's write under `.claude/skills/`: no permission rule allows a write under `.claude/`, so TASK-00 runs in a session you are in, and in a session nobody watches the write is denied. This holds on Claude Code 2.1.326 for `Edit` and `Write` rules in `.claude/settings.json`, `.claude/settings.local.json` and `--allowedTools`, with and without a leading `/`. In auto mode Claude Code's own protection of `.claude/` does not hold; the kit's `ask` rule `Edit(./.claude/**)` holds it there, for the `Write` tool as well (see "What is enforced, and how far").
8. Before the first real run, test the hooks on purpose:
   - Start `claude --agent sdlc-orchestrator` and ask it to delegate to `qa-engineer` the task "create the file `src/hook-test.ts`". The edit must be refused with "QA Engineer write blocked".
   - In the same session, copy the sample manifest to `sdlc/runs/HOOKTEST/run.json` and ask the Orchestrator to change `currentStage` to `READY_FOR_IMPLEMENTATION` with its file edit tool, not with `scripts/record-run.mjs`: the hooks see only the file tools. The session must receive "Gate validator rejected". Delete the folder afterwards.

   - Still in that session, after the manifest edit, check that `sdlc/runs/HOOKTEST/board.md` exists and that `sdlc/board.html` lists the run (under the sample's own ID, `EXAMPLE`). If not, the board hook is not active; the Orchestrator still renders the board itself before each report.

   If either of the first two does not happen, the enforcement described in this guide is not in effect; fall back to the instruction-only rules of the Copilot starter and say so in every report.
9. Optional: `cp .orchestra/examples/claude-code.mcp.example.json .mcp.json` if Playwright MCP is allowed. Claude Code asks for approval before it uses a server from `.mcp.json`. The sample pins a version of the server; change it only to a version you have tried.
10. Spec Kit is not part of a run, also where it is installed: the Orchestrator writes the specification and the plan in the run folder and uses none of Spec Kit's skills, scripts or `specs/` folder (`.orchestra/STARTER_GUIDE.md`, step 8).

## Start a run

In the VS Code integrated terminal, at the repository root:

```bash
claude --agent sdlc-orchestrator
```

then send `/imperata-start` with the feature after it. Start it at the root, not in a subfolder: Claude Code reads the shared `.claude/settings.json` from the folder it starts in, and the kit's path rules (`Edit(./sdlc/runs/*/decisions/**)`, `Edit(./.claude/**)`) are read from there as well. The kit's commands (`/imperata-*`, listed in the user guide under "The commands") are skills that only you can run: each has `disable-model-invocation: true`, so the agent cannot run one by itself, and what you type after the command reaches the Orchestrator as `ARGUMENTS: …` after the command's text. Both hold on Claude Code 2.1.326, in a session started with `--agent`. To make the Orchestrator the default for your own sessions in this repository, put `{ "agent": "sdlc-orchestrator" }` in `.claude/settings.local.json`. Do not put it in the shared `.claude/settings.json`: every session in the repository would then start as the Orchestrator.

Run the pilot in the default permission mode. A mode that skips approvals removes the questions the "ask" rules depend on. Auto mode keeps them: a classifier decides the calls that no rule matches, and a call an `ask` rule matches is still put to the person, or denied in a session nobody watches (Claude Code 2.1.326).

## What is enforced, and how far

| Rule | Mechanism | Limit |
| --- | --- | --- |
| The Orchestrator delegates only to the six specialists | `Agent(...)` allowlist in its `tools` | Applies when the session is started with `--agent sdlc-orchestrator`. A plain `claude` session is not bound by it |
| Only the person runs a command, `/imperata-merge` included | `disable-model-invocation: true` in each `.claude/skills/imperata-*/SKILL.md` | The agent's own call of the Skill tool is refused. A command does not choose the agent: sent in a plain session, its first lines tell the agent to stop and say how to start the Orchestrator, which is an instruction only |
| Read-only specialists cannot edit or run commands | Their `tools` list holds only `Read`, `Grep`, `Glob` | None known |
| QA Engineer edits only test files and the run folder, never `run.json`, the test lock, the test calibration or the reproduction of a bug run | `PreToolUse` hook in `qa-engineer.md` | Covers `Edit` and `Write`. A shell command can still write any file; the Orchestrator's git check detects that |
| Developer does not edit a test file locked after the QA step, the lock, the test calibration, the reproduction of a bug run, or `run.json` | `PreToolUse` hook in `developer.md` | Covers `Edit`, `Write` and `NotebookEdit`. A shell command can still write any file; the gate validator finds a locked file whose hash changed |
| A run manifest is validated whenever it is edited | `PostToolUse` hook in `.claude/settings.json` | Runs after the write: it reports, it does not prevent. Does not see a manifest written by a shell command; `scripts/record-run.mjs`, which writes it that way, runs the validator itself and puts the manifest back on a rejection |
| The run board is rendered after each edit in a run folder | `PostToolUse` hook in `.claude/settings.json` | Does not see a file written by a shell command; the Orchestrator renders after those. A failed render is reported to the session and changes nothing else |
| No agent writes the owner's decision files in `sdlc/runs/<runId>/decisions/` | `deny` rule `Edit(./sdlc/runs/*/decisions/**)`, and a `PreToolUse` hook in `.claude/settings.json` | The rule holds the file tools and a shell redirect; the hook folds case and lookalike letters on macOS and Windows. A program that writes the file itself, such as `node -e`, is held by neither, and git shows the file |
| No merge, no pull request approval, no force-push | `deny` rules | `--force`, `--force-with-lease` and `-f` are denied wherever they stand after `git push`, and so is a refspec that starts with `+`. A rule matches the command text as written. `git -C . push --force`, joined flags such as `-uf`, or a script that calls `gh` is not matched. This is a guard against the usual invocation, not a security boundary |
| Pushes, pull requests and issue writes need the owner's consent | `ask` rules | Same limit as above |
| No agent changes the agents, hooks or settings under `.claude/`, or writes a skill there, without the person in the session | `ask` rule `Edit(./.claude/**)`, which holds the `Write` tool as well; outside auto mode Claude Code's own protection of `.claude/` asks as well | In a session nobody watches the call is denied. On Claude Code 2.1.326, with `claude -p` in auto mode, a session without the rule can edit a hook, write a skill and write `.claude/settings.local.json`; with it all three are denied and a write to `docs/` goes through. A `Write(./.claude/**)` rule holds nothing: Claude Code reports at the start of a session that it is not matched, and with that rule alone all three go through. The path is relative to the folder the session starts in. A shell command can still write there: `>>` and `sed -i` into a hook both go through in auto mode. Git shows such a change, and `imperata-kit.mjs status` reports a kit file that changed |
| No agent changes the kit's scripts, the workflows or the auto-run tool list without the person in the session | `ask` rules on `scripts/validate-gates.mjs`, `render-run-board.mjs`, `board-server.mjs`, `record-run.mjs`, `lock-tests.mjs`, `.github/workflows/**`, `.orchestra/auto-run.json` and `.orchestra/installed.json` | In a session nobody watches the edit is denied. A shell command is not held by them |
| `.env` files are not read | `deny` rules `Read(**/.env)` and `Read(**/.env.*)` | Cover `.env` and every `.env.*` in any folder, `.env.example` included; add the repository's other secret files |

What actually keeps an unapproved or untested change out of the main branch is unchanged from the Copilot design: branch protection, the required CI job that runs the validator with `--verify-remote`, and a person who reads the pull request before merging.

## Auto-run from the board

`node scripts/board-server.mjs --auto-run claude` starts a fresh `claude -p --agent sdlc-orchestrator` session after each Send, with the decision file named in its prompt, `--allowedTools` from `.orchestra/auto-run.json` and `--max-budget-usd` from the same file (or `--budget`). The cap is checked between turns, not during one, so a session can end a little above it. In print mode a call that needs approval is denied, so the session can write only under `sdlc/` and run only the listed commands, together with what allow rules in your own Claude Code settings allow: nobody is there to approve those, so keep them narrow. The deny rules and hooks of `.claude/settings.json` still apply. It records the decisions, may delegate drafting to read-only specialists, and stops at the next human gate.

- A fresh session is started rather than the one the owner worked in, because a resumed session keeps the system prompt it started with: rules changed since then would not apply.
- A session that auto-run starts uses the agent's own model, unless `claude.model` in `.orchestra/auto-run.json` names another.
- Claude Code also has channels, which push an event into a session that is already open. It is a research preview that needs a development flag for a custom server, so the board does not use it.

## Model per role

Each agent file names its model in the `model` field of its frontmatter. That is the default for the role. For `developer` and `qa-engineer` the Orchestrator overrides it per task, as described under "Model per task" below.

| Agent | `model` | Reason |
|---|---|---|
| `architect` | `opus` | Architecture, authorization boundaries, threat model |
| `code-reviewer` | `opus` | Independent review of correctness and security |
| `sdlc-orchestrator` | `sonnet` | Keeps the run's records, delegates, and passes a gate on what the scripts and the specialists return |
| `business-analyst` | `sonnet` | Drafting a specification from approved inputs |
| `ux-designer` | `sonnet` | Drafting a design brief |
| `developer` | `sonnet` | Bounded tasks guided by the plan and stack skills |
| `qa-engineer` | `sonnet` | Test matrix and tests from approved acceptance criteria |

This follows the cost guidance in `docs/07_PERSONAL_TO_ENTERPRISE_MIGRATION.md`. It is a starting point and not a measured result: which pilot model and budget are allowed is still open question 9 in `docs/10_DECISIONS_RISKS_AND_OPEN_QUESTIONS.md`.

- To change a role, edit `model` in its file. The values are the aliases `opus`, `sonnet`, `haiku`, a full model ID, or `inherit` for the model of the main session.
- The aliases resolve to whatever the installed Claude Code version and the account's plan offer. If the plan does not include a model, set that role to `inherit`.
- For `sdlc-orchestrator`, started with `claude --agent`, the field sets the model of the main session; check with `/model` after starting, and treat that as untested.
- The Orchestrator's file names `sonnet`. To run it on a stronger model, set `model: opus` in `.claude/agents/sdlc-orchestrator.md`, or `claude.model` in `.orchestra/auto-run.json` for the sessions the board server starts.
- The Copilot starter's agent files carry the same split with Copilot model identifiers (`claude-opus-5.5`, `claude-sonnet-5.5`). Those identifiers are unconfirmed and depend on the Copilot plan; see step 2 of `starter/STARTER_GUIDE.md`.

### Model per task

The Architect gives every task in the plan a `Complexity` (`low`, `standard`, `high`) with a one-line reason; the criteria are in `.orchestra/templates/technical-plan.template.md`. Because the plan is what the owner approves at the plan gate, the ratings are reviewed by a person before any task runs. When the Orchestrator delegates a task to `developer` or `qa-engineer` it passes `model` on the Agent call: `haiku` for `low`, `sonnet` for `standard`, `opus` for `high`. It may raise a level but not lower one, a repair runs one level above the attempt that failed, and each delegation is listed in the "Model per task" table of `delivery.md`.

What this does not give you:

- A measured choice. The rating is the Architect's judgement and the mapping is a starting point; nothing here compares cost or quality between levels.
- Proof of the model that ran. The table records what the Orchestrator requested. The per-call `model` parameter of the Agent tool is taken from the documentation and has not been tried with these files.
- Full enforcement. `scripts/validate-gates.mjs` rejects a manifest whose plan has a task without a `Complexity`, with a level other than the three, or without a reason, so the plan pull request cannot pass its required check that way. It reads tasks written as `### TASK-NN` sections in the plan or in the file named by `artifactPaths.tasks`; Spec Kit's own task format is not read. Once the manifest names the delivery dossier it also reads the "Model per task" table: every row must be filled in, name tasks of the plan and keep the plan's level or a higher one, and from `READY_FOR_ACCEPTANCE` on every task needs a `developer` row. A Claude model that looks weaker than the row's level is a warning only, as are `NOT_SELECTED` and `NOT_CONFIRMED` rows. Nothing checks that the level is right, that a delegation was left out of the table, or which model really ran; the table is the Orchestrator's own record.

## Using both tools in one repository

Install with `--tools claude,copilot`; the two layers do not share file names. The rules for every agent then exist twice, as kit files that `imperata-kit.mjs update` keeps in step (`.claude/orchestra-rules.md` and `.github/instructions/orchestra.instructions.md`), and the product's rules exist once, in `.orchestra/project.md`, which both tools read. VS Code loads `CLAUDE.md` for Copilot as well, with the files it imports, so a Copilot session in such a repository reads `.claude/orchestra-rules.md` beside its own rules, and whatever else the project keeps in `CLAUDE.md`. Each line of the rules for Claude Code that holds in Claude Code only names it, and the rules for Copilot say that such a line does not apply to a Copilot session. To keep `CLAUDE.md` out of Copilot altogether, set VS Code's `chat.useClaudeMdFile` to `false` in the repository's `.vscode/settings.json`; the project's own instructions in `CLAUDE.md` then no longer reach Copilot either. The skills exist twice as well (`.claude/skills/` and `.github/skills/`); a stack skill you write must be copied to both. A run should be driven by one tool from start to finish; the manifest does not record which tool produced an artifact.

## Handing a repository from one tool to the other

A common split is to build the product's foundation in runs driven by Claude Code and then a later feature in a run driven by Copilot (or the other way round). The run protocol allows this because the unit is the run: each run has its own `runId`, its own folder and its own three pull requests. The steps below have not been tried; treat the first handover as part of the pilot.

**Before the first run**

1. Install the kit with `--tools claude,copilot`.
2. If the repository has an `AGENTS.md` (many product repositories have one), add the line `@AGENTS.md` to `CLAUDE.md`. Copilot reads `AGENTS.md` itself.
3. Keep runs bounded. The Orchestrator is written for one feature per run; a foundation that spans several releases is several runs, one after another.

**At the handover, after the last run of the first tool**

1. Finish that run completely: delivery pull request merged, `run.json` at `DONE`, and `node scripts/validate-gates.mjs sdlc/runs/<runId>/run.json --verify-remote` exits 0 on the main branch. The second tool starts from a clean main branch, never from an open delivery branch.
2. Copy every stack skill the first tool's runs created into the other tool's skills folder, for example `.claude/skills/<stack>/` to `.github/skills/<stack>/`, with its `references/` folder. Without this the second tool's Architect has no skill file to name in a task's `Skills` field and must return NEEDS_DECISION. Do not copy `quality-gates` or `run-board` (each starter has its own text).
3. From then on a stack skill exists twice. Change both copies in the same commit, or the two tools will write code against different conventions.
4. Check that `pr-checks.yml` carries the repository's real commands and that both jobs are required checks. The second tool's run depends on that CI for its tests gate; set it up during the first tool's runs, not during the second tool's run.
5. MCP: the two kit samples (`.orchestra/examples/claude-code.mcp.example.json` and `copilot-cli.mcp.example.json`) differ, and whether one root `.mcp.json` serves both tools has not been tested. Give Copilot its servers through `.vscode/mcp.json` (`starter/.vscode/mcp.example.json`) and leave the root `.mcp.json` to Claude Code, or enable a server only for the tool that drives the current run.

**During the second tool's run**

- Write in the run's `input.md` which tool drives the run. The manifest has no field for it, and the delivery dossier and any evaluation should be able to say it.
- The enforcement differs. The permission rules and hooks in `.claude/` act only in Claude Code. A run driven by Copilot rests on the agents' instructions, branch protection and CI, as `starter/STARTER_GUIDE.md` describes; do not carry the stronger claims of this guide over to it.
- Try the second tool on one run before you rely on it. The code it builds on was written by another model, and the stack skills are the only place where that code's conventions are stated.

**When reporting results**

Keep the evaluation of the two tools apart (`docs/08_EVALUATION_AND_TEST_PLAN.md`). A feature run that succeeds under Copilot on a foundation built under Claude Code supports the blueprint's hypothesis for that feature run only, and a report of the results should say which tool built what.

## Never assume

Everything under "Never assume" in `starter/STARTER_GUIDE.md` applies here, with "Copilot" read as "Claude Code". In addition, do not assume that:

- These agent files load as intended on your version. Check in your first run that the Orchestrator delegates to each specialist it needs, that each runs on the model its file names, and that the `hooks` fields of `developer` and `qa-engineer` act (step 8).
- A hook that is listed is a hook that fires for subagents on your version. Step 8 is the test.
- A denied command cannot be run some other way. See the limits above.
- The Orchestrator's behavior matches its behavior under Copilot. The instructions are the same; the model and the harness are not, so the evaluation in `docs/08_EVALUATION_AND_TEST_PLAN.md` has to be repeated.
- An organization that approved Copilot has approved Claude Code. That is a separate decision with its own data-handling review.

## Sources

Claude Code documentation, read on 2026-11-11: sub-agents (frontmatter fields, `--agent`, `Agent(...)` allowlist, hooks in frontmatter), hooks (input fields, exit code 2, `CLAUDE_PROJECT_DIR`, hooks firing inside subagents), permissions (rule syntax, compound commands, the stated limits of Bash rules), skills, memory (`CLAUDE.md`, `@AGENTS.md`), MCP (`.mcp.json`), all under `https://code.claude.com/docs/en/`.
