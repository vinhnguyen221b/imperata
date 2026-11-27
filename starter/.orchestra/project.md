# Project profile

<!-- Owned by this project. The Imperata kit creates this file once and never changes it afterwards. Every Imperata agent reads it before any work, so what is written here steers the Business Analyst, Architect, QA Engineer and Code Reviewer. Replace each <…>; delete a line that does not apply rather than leave a placeholder. -->

## Product

- **Name:** <product name>
- **Sources and reading order:** <for example `docs/`, with the reading order in the root `README.md`>
- **Version of the sources:** <for example 1.0; copied into `productDocVersion` of each run manifest>
- **Status legend of the sources:** <how they mark confirmed, proposed and open items, or "none">
- **Tracker:** <for example Jira project ABC, GitHub Issues, or local tickets only>. Agents may cite its keys but never create, edit or transition an item without the owner's authorization.

## Architecture and stack rules

- <for example "React microfrontends separated by domain boundary; shared packages hold typed contracts only">
- <for example "business invariants live in server-side domain functions">

## Security-sensitive areas

A task that touches one of these is `Complexity: high`, the plan says how it proves the area holds, QA covers it and every review checks it.

- <for example "tenant isolation: data of two tenants never meets in one request">

## Test file locations

Where the QA Engineer may write tests, beyond the usual conventions (`tests/`, `__tests__/`, `*.test.ts`, `test_*.py`, `*_test.go`, `src/test/`, `*Tests/` folders, `*Test.java`, `*Tests.cs`, `*_spec.rb` and the like). One backticked glob per line; `**` matches any folders. In Claude Code a hook blocks the QA Engineer's edits elsewhere.

- <for example `integration/**/*.cs`>

## Business Analyst: questions to raise for this product

- <for example "which approvals are mandatory and who gives them">

## QA Engineer: areas to cover when they apply

- <for example "permission denial for each role">

## Code Reviewer: areas to check

- <for example "policy precedence">

## Architect: defaults

- <for example "prefer a modular monolith for the first backend">
