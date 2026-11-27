# Imperata blueprint

**Kit version:** 1.0.0 (`kit.json`) · **Date:** 2026-11-27 · **Status:** a design proposal, published as open source. What it has been tried on is in "Status and boundaries" of the [README](../README.md#status-and-boundaries).

A **supervised, evidence-driven** AI SDLC workflow for Claude Code and GitHub Copilot. One business requirement is refined, planned, broken into tracked tasks, implemented, tested and reviewed independently, then prepared for a person's acceptance. An Orchestrator agent coordinates six specialists (Business Analyst, UX Designer, Architect, Developer, QA Engineer, Code Reviewer), applies explicit quality gates and keeps every decision and every piece of evidence in the repository. A run board shows the owner where each run stands and takes the owner's decisions.

The kit names no product. Each repository that receives it describes its own product, sources and constraints in `.orchestra/project.md`.

**This is a blueprint and a starter kit, not a claim of autonomous end-to-end delivery.** It contains no accounts, credentials, linked Jira site or Figma workspace.

![How Imperata works: the owner decides on the run board, the Orchestrator delegates to six specialists, and the repository keeps every run file](images/overview.en.svg)

**New here?** Start with the illustrated [`USER_GUIDE.md`](../USER_GUIDE.md). It walks through installing the kit, the first run, deciding on the run board, acceptance, approval modes and updates, with screenshots of the board.

## Use it in a project

```bash
node <imperata>/imperata-kit.mjs install <repo> --tools claude,copilot
```

Then fill in `<repo>/.orchestra/project.md` and follow `<repo>/.orchestra/STARTER_GUIDE.md`. Updates and the ownership of each file are in [`KIT_GUIDE.md`](../KIT_GUIDE.md). Keep this repository apart from the projects: install the kit with the script, never copy this repository into a project.

## Reading order

| File (from the root of the repository) | Questions answered |
| --- | --- |
| [`USER_GUIDE.md`](../USER_GUIDE.md) | How do I use the kit, step by step, from install to acceptance? (illustrated) |
| [`KIT_GUIDE.md`](../KIT_GUIDE.md) | How is the kit installed, updated and checked in a repository? |
| [`docs/01_EXECUTIVE_BLUEPRINT.md`](01_EXECUTIVE_BLUEPRINT.md) | What is Imperata for, which feature makes a good first run, boundaries? |
| [`docs/02_RUNTIME_AND_ARCHITECTURE.md`](02_RUNTIME_AND_ARCHITECTURE.md) | How do delegation and state work? |
| [`docs/03_AGENT_ROLES_AND_CONTRACTS.md`](03_AGENT_ROLES_AND_CONTRACTS.md) | What does each agent do and return? |
| [`docs/04_WORKFLOW_AND_GATES.md`](04_WORKFLOW_AND_GATES.md) | How does a ticket move to Done, and what does the run board show? |
| [`docs/05_SPEC_KIT_AND_TRACEABILITY.md`](05_SPEC_KIT_AND_TRACEABILITY.md) | How do product sources become specs and tasks? |
| [`docs/06_INTEGRATIONS_AND_PERMISSIONS.md`](06_INTEGRATIONS_AND_PERMISSIONS.md) | How do Jira, Figma, GitHub, Playwright fit safely? |
| [`docs/07_PERSONAL_TO_ENTERPRISE_MIGRATION.md`](07_PERSONAL_TO_ENTERPRISE_MIGRATION.md) | How to try the kit alone first, then adopt it in an organization? |
| [`docs/08_EVALUATION_AND_TEST_PLAN.md`](08_EVALUATION_AND_TEST_PLAN.md) | How to prove results, not just produce plausible text? |
| [`docs/09_ROADMAP_AND_BACKLOG.md`](09_ROADMAP_AND_BACKLOG.md) | What to set up first, with exit criteria? |
| [`docs/10_DECISIONS_RISKS_AND_OPEN_QUESTIONS.md`](10_DECISIONS_RISKS_AND_OPEN_QUESTIONS.md) | Which decisions remain open? |
| [`docs/11_SOURCES.md`](11_SOURCES.md) | Official tool documentation URLs |
| [`kit.json`](../kit.json), [`imperata-kit.mjs`](../imperata-kit.mjs) | What the kit installs, and the script that installs it |
| [`starter/`](../starter/) | Shared parts (manifest schema, templates, validator, run board and its server, commands, CI example, project profile template) and the Copilot layer |
| [`starter-claude-code/`](../starter-claude-code/) | The Claude Code layer: agents, rules, permission rules and hooks; start with `CLAUDE_CODE_GUIDE.md` |

## Separation of concerns

- **Product sources:** in each project repository, where its `.orchestra/project.md` says. This repository never holds them.
- **Development process:** this kit. Imperata does **not** become part of the product's runtime.
- **Spec Kit:** not part of a run. A run writes its specification and plan in its own folder from the kit's templates, and those are the documents its gates approve.

## Pilot defaults (proposed)

1. **One agent tool per run**: Claude Code with `claude --agent sdlc-orchestrator`, or the Copilot harness in VS Code with the custom agents in `.github/agents/`.
2. **Supervised autonomy**: delegates routine steps, pauses for business decisions, tool grants and PR merge/Done.
3. **GitHub Issues / local mock issue** as pilot tracker; optional Jira adapter later.
4. **Playwright Test** for deterministic E2E; Playwright MCP for exploratory browser interaction.
5. **Figma** only when the UI feature needs reviewed design; not required for backend rules.
6. **No secrets in repository, prompt, artifacts or tests.** Use synthetic data.
7. **No `--yolo`/auto-approve by default.** Respect personal and corporate policy controls.
8. **A human gate is a pull request merge** where the repository has a GitHub remote (`pull-request` mode), and a decision recorded in the run folder where it has none (`local-record` mode).
9. **CI is the test evidence** in `pull-request` mode. QA and review happen on the delivery branch before it is merged.
10. **Skills are loaded per task.** One stack skill per stack that exists; each task names the files it needs.
11. **Status is rendered, not drawn.** `scripts/render-run-board.mjs` turns the run manifests and artifacts into the run board the owner follows and decides from (`sdlc/board.html`, and `sdlc/runs/<runId>/board.md` for GitHub). No agent draws a status diagram.

## Quick pilot

1. Read `docs/07_PERSONAL_TO_ENTERPRISE_MIGRATION.md` and complete the capability preflight.
2. Install the kit into an authorized disposable repository with `imperata-kit.mjs install` (`KIT_GUIDE.md`), fill in `.orchestra/project.md`, place the product's sources where it says, and review each file the script added. Do not assume tools are available just because an agent file lists them.
3. Open the repository in VS Code and check that the agents load: `/agents` in Claude Code, the Agent Customizations editor in the Copilot harness.
4. Choose the approval mode and, for `pull-request` mode, set up the CI example (`.orchestra/STARTER_GUIDE.md`, steps 5 and 6).
5. Start the Orchestrator (`claude --agent sdlc-orchestrator`, or the SDLC Orchestrator agent in Copilot) and send `/imperata-start` followed by one bounded feature, chosen by the criteria in `docs/01_EXECUTIVE_BLUEPRINT.md`.
6. Follow and decide on the run board (`node scripts/board-server.mjs`). Review actual files, tests, issue updates and evidence; do not treat the final agent answer as proof.

## Other agent tools

The run protocol (manifest, validator, templates, pull request gates, CI evidence, run board) names no tool. `starter-claude-code/` holds what differs for Claude Code: agent definitions, rules, the skill location, and the rules that are instructions under Copilot but permission rules and hooks under Claude Code, listed with their limits in its guide. The docs `01`–`11` follow the Copilot setup and apply to Claude Code except where `CLAUDE_CODE_GUIDE.md` says otherwise. A runtime that works across providers stays out of scope.

The changes of each version are in [`CHANGELOG.md`](../CHANGELOG.md).
