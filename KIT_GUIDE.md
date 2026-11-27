# Using the Imperata kit in any project

**Kit version:** 1.0.0 (`kit.json`) · **Date:** 2026-11-27

Imperata is a kit that any repository can receive: the run protocol, the agents for Claude Code and GitHub Copilot, the gate validator, the run board and its server. Everything that belongs to one product lives in that repository's **project profile**, `.orchestra/project.md`, which the kit creates once and never changes. The kit itself names no product.

![imperata-kit.mjs copies kit files from the kit's repository into each project, keeps the project's own files and records what it installed](docs/images/kit-install.en.svg)

For the whole path from install to a first accepted run, see [`USER_GUIDE.md`](USER_GUIDE.md).

| Here | What it is |
| --- | --- |
| `kit.json` | Which kit file goes where in a project, for which tool, and who owns it afterwards |
| `imperata-kit.mjs` | Installs, updates and checks the kit in a project repository (Node 20 or later, no dependencies) |
| `starter/` | The shared parts, the project profile template and the Copilot layer |
| `starter-claude-code/` | The Claude Code layer |

## Install into a repository

```bash
node <imperata>/imperata-kit.mjs install <repo> --tools claude,copilot
```

- `--tools` is `claude`, `copilot` or both (the default). A tool you leave out gets none of its files. Run `install` again with another tool to add it: the tools a repository already has stay.
- `--profile <file>` seeds `.orchestra/project.md` from a filled-in profile, for example the `.orchestra/project.md` of another repository of the same product. Without it the repository gets the template to fill in.
- `--dry-run` shows what would happen and writes nothing.
- Nothing is committed. Review the result with `git status` and `git diff`, then commit it.

Then fill in `.orchestra/project.md`, place the product's sources where it says they are, and follow `.orchestra/STARTER_GUIDE.md` (approval mode, CI, stack skills). A run starts in `claude --agent sdlc-orchestrator`, or with the SDLC Orchestrator agent in VS Code, with the command `/imperata-start` followed by the feature; a bug fix with `/imperata-bug` followed by the report. Each later step has a command of its own (`USER_GUIDE.md`, "The commands").

## What lands where

| In the repository | Owner | On update |
| --- | --- | --- |
| `.orchestra/schemas/`, `.orchestra/templates/`, `.orchestra/test-rules.md`, `.orchestra/runs/EXAMPLE.run.json`, `.orchestra/STARTER_GUIDE.md`, `.orchestra/examples/` | kit | Replaced, unless changed in the repository |
| `scripts/validate-gates.mjs`, `scripts/render-run-board.mjs`, `scripts/board-server.mjs`, `scripts/lock-tests.mjs`, `scripts/record-run.mjs` | kit | Replaced, unless changed |
| `.github/agents/`, `.github/instructions/orchestra.instructions.md`, `.vscode/mcp.example.json`, and in `.github/skills/` the kit's skills `quality-gates/`, `run-board/` and the commands `imperata-*/` (Copilot) | kit | Replaced, unless changed |
| `.claude/agents/`, `.claude/hooks/`, `.claude/orchestra-rules.md`, and in `.claude/skills/` the kit's skills `quality-gates/`, `run-board/` and the commands `imperata-*/` (Claude Code) | kit | Replaced, unless changed |
| `.github/workflows/pr-checks.yml.example` | kit | Replaced, unless changed |
| `.orchestra/project.md`, `.orchestra/auto-run.json` | project | Never touched after the first install |
| `CLAUDE.md` | project | The two import lines `@.claude/orchestra-rules.md` and `@.orchestra/project.md` are added when missing; nothing else changes |
| `.claude/settings.json` | project | Settings, permission rules and hooks of the kit are added when missing; nothing is changed or removed. A key the kit adds to that holds another kind of value (a string where the kit has a list, null where it has an object) is reported as a conflict and the file is kept; `--force` gives that key the kit's value |
| `.gitignore` | project | Lines of the kit are added when missing, before the project's first exception (`!pattern`) when it has one, so that the exception still wins |
| `.orchestra/installed.json` | written by the script | The kit version and commit, the tools, and a hash of every kit-owned file |

The generic rules for every agent are kit files (`.claude/orchestra-rules.md`, `.github/instructions/orchestra.instructions.md`). A repository's own instructions stay in its `CLAUDE.md`, `.github/copilot-instructions.md` and `AGENTS.md`, which the kit does not overwrite. A stack skill in `.claude/skills/` or `.github/skills/` belongs to the repository: the kit replaces and removes only its own skills there.

## The project profile

`.orchestra/project.md` tells every agent what the kit cannot know:

- the product, where its sources are, their version and status legend, and the tracker;
- architecture and stack rules;
- security-sensitive areas: a task that touches one is `Complexity: high`, the plan says how it proves the area holds, QA covers it and every review checks it;
- questions the Business Analyst raises for this product, areas QA covers, areas the Code Reviewer checks, defaults for the Architect;
- test file locations beyond the usual conventions, where the QA Engineer may write (Claude Code enforces them with a hook).

To start another repository of the same product, pass the first repository's `.orchestra/project.md` with `--profile`. Profiles live with the product, in its repositories; this kit holds none.

## Update a repository

```bash
node <imperata>/imperata-kit.mjs status <repo>
node <imperata>/imperata-kit.mjs update <repo>
```

- `status` writes nothing and exits 1 when something would change.
- `update` replaces a kit file only if the repository has not changed it: its content matches the hash recorded at the last install, or any committed version of the file in this kit, with its line endings as they are or with CRLF read as LF, as a checkout with `core.autocrlf=true` writes them. A changed file is reported as a conflict and kept; merge the kit version by hand, or rerun with `--force` to take it.
- A file the kit no longer ships is removed if nobody changed it, with any folder that this leaves empty, and reported otherwise.
- A session or a run in progress is not affected by an update, except that a Claude Code session resumed later keeps the agent instructions it started with.

Change the kit here, in this repository, never inside a project. First check the change against the bar: it answers a failure that was observed and written down (what was run, what the kit did, what was expected), or it waits for one. Then edit the files, add or move entries in `kit.json`, raise `version` (with the version in the guides and in the install commands of `README.md` and `USER_GUIDE.md`), add an entry to `CHANGELOG.md`, run the kit's tests (`node --test tests/*.test.mjs`, see `tests/README.md`) and commit. To publish the version, push the commit to `main`, then the tag `v<version>` on it. `.github/workflows/release.yml` then runs the tests on Node 20, 22 and 24, checks that the tag names the version in `kit.json` and is on `main`, and publishes a release with an archive of the tagged commit, its `SHA256SUMS` and an attestation of the build. The rules of this repository keep a tag `v*` from being moved or deleted once it is pushed: a tag on the wrong commit is followed by the next version, not moved. Then run `update` in each project. A rule that belongs to one product goes into its profile instead.

## What the script does not do

- Commit, push or open a pull request.
- Install MCP servers or the `gh` CLI, or create stack skills (`.orchestra/templates/stack-skill/`). How to write one, and how to bring in a team's coding convention, is in section 7 of `USER_GUIDE.md`. A run uses no part of Spec Kit (`.orchestra/STARTER_GUIDE.md`, step 8).
- Copy the product's sources into the repository.
- Remove a setting, permission rule or hook the kit no longer adds; delete it by hand.
- Bring a file the project owns up to a newer kit: `.orchestra/project.md` and `.orchestra/auto-run.json` stay as the project has them. After an update, compare them with the copies in `starter/.orchestra/` here for a section or a line that the newer kit adds.

`tests/installer.test.mjs` covers a fresh install with both tools and with Claude Code only, `status`, an update over a locally changed file with and without `--force`, and a settings file with the project's own rules and hooks.
