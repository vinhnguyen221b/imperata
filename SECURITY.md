# Security

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab, **Report a vulnerability**. Please do not open a public issue for it. Say what you ran, what the kit did and what you expected, with the version from `kit.json`.

## Verify a release

Each release is built by `.github/workflows/release.yml` from the tagged commit, after the kit's tests pass. It carries `imperata-<version>.tar.gz`, an archive of that commit, and its `SHA256SUMS`, with two signed records: an attestation that the archive was built by that workflow from that commit, and the attestation GitHub makes of the release itself, which records its tag, commit and files. Releases are immutable: once one is published, its files cannot be changed, and its tag cannot be moved or deleted while the release exists.

You need the GitHub CLI (`gh`), signed in. Each command below exits with an error when its check fails.

To check a clone made with the command in `README.md`:

```bash
gh release verify v1.0.0 --repo vinhnguyen221b/imperata
git -C ~/tools/imperata rev-parse HEAD
```

The first prints the commit the tag names (`Resolved tag v1.0.0 to sha1:…`) and checks the release against its attestation; the second must print the same commit. The release notes end with it too.

To check the archive before you unpack it:

```bash
gh release download v1.0.0 --repo vinhnguyen221b/imperata --dir imperata-release
cd imperata-release
shasum -a 256 -c SHA256SUMS
gh release verify-asset v1.0.0 imperata-1.0.0.tar.gz --repo vinhnguyen221b/imperata
gh attestation verify imperata-1.0.0.tar.gz --repo vinhnguyen221b/imperata --signer-workflow vinhnguyen221b/imperata/.github/workflows/release.yml --source-ref refs/tags/v1.0.0
```

On Linux, `sha256sum -c SHA256SUMS` does what `shasum -a 256 -c` does. The checksum catches a damaged download; the two `verify` commands tie the archive to this release, and to the workflow that built it from the tagged commit. Check `imperata-<version>.tar.gz`, not the "Source code" archives GitHub adds to every release: those have no attestation. Unpacked, the archive holds the tagged commit's files without their git history; the install commands use a clone because `update` reads that history to recognise files of an earlier kit version.

What this proves: what you run is what this repository's workflow built from the tagged commit, unchanged since. It does not prove that the code is safe: read it, and run the installer with `--dry-run` first.

## What the kit guards, and how far

Imperata runs on the machine of the person who uses it. It guards the decisions of that person and the evidence of a run against an AI agent that works in the same repository, and against web pages that person opens. It is not a sandbox, and it trusts the person and their own tools.

- **The run board server** (`scripts/board-server.mjs`) listens on 127.0.0.1 only, answers only its own host name, refuses another origin, and saves a decision only with the token in the page it serves. It renders that page itself, escapes what agents wrote into it, serves files under `sdlc/` only, and refuses a run folder that leads outside the repository.
- **Claude Code** gets permission rules and hooks (`.claude/settings.json`, `.claude/hooks/`): no agent edits the owner's `decisions/`, a locked test, the test lock or a run manifest it does not own; asks before an edit of `.claude/`, the kit's scripts, the workflows and the auto-run and install records; denies a force push and a pull request merged with `gh`.
- **The gate validator** (`scripts/validate-gates.mjs`) holds each stage to its evidence. With `--verify-remote` it asks GitHub whether each approving pull request is merged, belongs to this repository and merges the run's branch for its gate, and whether the required check run succeeded.
- **The installer** (`imperata-kit.mjs`) writes only inside the target repository, never through a link that leads out of it, and removes only files git tracks there, in the folders the kit installs into.

## Known limits

These are part of the design, and the guides say so where they matter.

- In `local-record` mode an approval is a file in the repository. Nothing outside it confirms who wrote it; the validator says so in a warning on every such run.
- Any process of the same user can read the board server's token from the page, and an agent with a shell in an interactive session is such a process. Such a process can post a reply that the board saves as the owner's, and, with `--auto-run`, start an unattended Orchestrator session with it. The validator honours a request for changes the owner sends after an approval, but it cannot tell an approval posted this way from one the owner sent. Leave `--auto-run` off while an agent with a shell works in an interactive session on the same machine.
- Hooks see edits made with the file tools only. A shell command, or a program that writes a file itself, is not held by them; permission rules match the text of a command, not every way to write it.
- The tool lists of the unattended sessions (`.orchestra/auto-run.json`) are combined with the allow rules in the person's own settings of Claude Code or Copilot. Keep those narrow.
- The Copilot layer has no hooks: its rules are instructions, and its tool lists were written from the Copilot CLI documentation without a run.
- In `pull-request` mode, who may merge is decided by the repository's branch protection: the validator checks that the merger is the one the manifest names, not that this person may approve.
- `pull-request` mode and the CI example have had less use than `local-record` mode, and only on the Copilot layer.
