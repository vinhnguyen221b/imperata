---
name: imperata-preflight
description: Read-only check that the Imperata kit can run under an organization-managed GitHub Copilot account. Send it before the first run.
disable-model-invocation: true
---

You are auditing whether this repository's Imperata kit can run under an organization-managed GitHub Copilot account. Do not change repository state or external tools. Check VS Code Copilot harness, custom agent discovery, skill discovery (the eight `imperata-*` commands in `.github/skills/`), subagent availability, whether the delegation tool takes a model argument, visible MCP tools, test commands, repository policy restrictions, whether the `gh` CLI is installed and signed in, whether branch protection and required checks exist on the main branch, and whether GitHub Actions may run in this repository. Return an ALLOWED/BLOCKED/UNKNOWN capability table, required IT approvals and a safe sequence for moving to the organization account. Say which model this session runs on, and remind me to select the model the Orchestrator's file names in the model picker before I start a run: a session runs on the selected model, whatever the agent's file names. Do not attempt to authenticate Jira/Figma or create an issue/PR without explicit permission.
