# Tests of the kit

These tests check the kit's own scripts: the gate validator, the test lock, the hooks, the installer and the run board. They are for whoever changes the kit. `kit.json` does not name this folder, so nothing here reaches a project.

```bash
node --test tests/*.test.mjs
```

Run it from the root of this repository. It is written for Node 20 or later, needs git, downloads nothing and takes under a minute.

## What each file covers

| File | Covers |
| --- | --- |
| `validate-gates.test.mjs` | `scripts/validate-gates.mjs`: the manifest, what each stage requires, human gates, the tests gate, the light track, task complexity, the "Model per task" table, the "Checked by the owner" table, the test lock, the test calibration, acceptance criteria, the "Skills applied" table, bug runs and their reproduction, and `--verify-remote` with `--ignore-check` against a stand-in for `gh` |
| `test-lock.test.mjs` | `scripts/lock-tests.mjs`: `record`, `check`, `calibrate` and `reproduce`, in git repositories made for each test, with and without a dependency folder that git does not track |
| `record-run.test.mjs` | `scripts/record-run.mjs`: the fields of a change written in one call and checked against the schema, the manifest put back when the validator rejects it, the boards, the commit of the run's records and of the paths named, and the refusal to commit in a session the board server started |
| `hooks.test.mjs` | The Claude Code hooks: which writes each guard lets through and which it blocks, and the two hooks that run after a write |
| `installer.test.mjs` | `imperata-kit.mjs`: `install`, `status` and `update`; files owned by the kit and by the project; lines and settings merged into existing files; conflicts and `--force`; the source it records, for a kit in its own repository and for a copy inside a project |
| `board.test.mjs` | `scripts/render-run-board.mjs` over the two sample runs of `docs/images/src/sample-runs.mjs`: rendering, the approval cards, the owner's move while a task waits for their check, `--check`, `--gate-version`, and that a sample run keeps each artifact where the index of templates says |
| `board-server.test.mjs` | `scripts/board-server.mjs` started as the owner starts it, with a stand-in for `claude` on the PATH: the prompt an auto-run session is given after a Send, and the variable that tells it the server started it |
| `instructions.test.mjs` | The Orchestrator's instructions in both layers: 193 rules of a run, each found in its section by the wording that carries its force, the rules that belong to one tool, and the eight sections that must read the same in both layers. It tells a shorter text from a text that lost or weakened a rule |
| `kit.test.mjs` | The kit as a set of files: `kit.json` names what exists, the version is the same wherever it is written and is the release the install commands take and the verify commands of `SECURITY.md` check, the two layers have the same roles, descriptions, sections and rules, no instruction points at a file the kit does not install, no file of the kit cites a run of another repository, and the QA guard and the test lock take the same files for test files |

`helpers.mjs` holds what the files share. `run-fixture.mjs` writes a run folder that the validator accepts; a test asks for the stage it needs and overrides the one thing it is about.

## How they work

- Every test works in a temporary directory of its own and removes it. Nothing is written into this repository.
- A script is run as a project runs it: as a child process, from the root of a repository. A test reads the exit code, the output and the files the script wrote.
- Child processes see no user or system git configuration, so a signing rule or a hook of the machine cannot change a result.
- `--verify-remote` is tested without a network: a script named `gh` is put first on the `PATH` and answers from a file. That suite is skipped on Windows.
- The tests of `calibrate` use plain Node scripts as the project's tests and `node {file}` as the command, so no test runner is involved.

## What they do not cover

- Whether an agent follows its instructions. That takes a run.
- What the run board looks like in a browser, and `scripts/board-server.mjs` beyond the start of an auto-run session.
- `--verify-remote` against GitHub itself, `pr-checks.yml.example` on GitHub Actions, and the kit's own `.github/workflows/release.yml`.
- A test runner other than `node` for `calibrate`.

## When the kit changes

- A change to a script comes with a test that fails without it.
- A new rule of the validator gets one test for the manifest it rejects and one for the manifest it still accepts.
- To see that the tests notice a fault, copy the kit, break one line in the copy and run the tests against it; they must fail.

```bash
IMPERATA_KIT_ROOT=/path/to/the/broken/copy node --test tests/*.test.mjs
```
