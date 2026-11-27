# Changelog

What each version of the kit changes. The version is in `kit.json`; `imperata-kit.mjs` records it in each project it installs.

- **Kit 1.0.0 (2026-11-27):** the first public release. It holds:
  - an Orchestrator agent and six specialists (Business Analyst, UX Designer, Architect, Developer, QA Engineer, Code Reviewer) for Claude Code and for GitHub Copilot, with the same roles, rules and commands in both layers; every specialist starts from the rules for every agent and the project profile, and in a repository with both layers each layer's rules say which of their lines hold for that tool only;
  - a run manifest with its schema, templates for every artifact of a run, and a gate validator that holds each stage to its evidence;
  - the full track with three human gates, the light track with two, and bug runs that show the defect with a failing test before a fix is planned;
  - two approval modes, `local-record` and `pull-request`, and a CI example for the second;
  - a test lock and a test calibration, so that the tests a run is accepted on are the ones QA wrote and do test the change;
  - the run board (`scripts/render-run-board.mjs`) and its local server, which saves the owner's decisions verbatim and can start an auto-run session after each one;
  - permission rules and hooks for Claude Code, and an installer (`imperata-kit.mjs`) that installs, checks and updates the kit in a project without touching what the project changed;
  - a release workflow (`.github/workflows/release.yml`) that tests each tagged version and publishes an archive of the tagged commit with its `SHA256SUMS` and an attestation of the build; `SECURITY.md` says how to verify a release.
