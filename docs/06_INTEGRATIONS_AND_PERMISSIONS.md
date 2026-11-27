# 06 — Integrations, identities, access and failure policy

**Doc ID:** ORCH-006 | **Status:** Proposed

## Adapter approach

A tracker adapter abstracts create/read/comment/transition operations. Implementation options:

1. **Local tracker (pilot safety):** `ticketRef: local:<runId>` in the run manifest, no external writes.
2. **GitHub Issues:** in authorized personal test repo; exact issue URLs captured after successful operation.
3. **Jira:** an organization or personal sandbox only after OAuth approval; map to workflow transitions available in that project, do not invent status names.

A read operation never implies write permission. “Service connected” in configuration is distinct from runtime authorization.

## Tool inventory and release gates

| Integration | Purpose | Personal pilot | Organization |
| --- | --- | --- | --- |
| GitHub repo | Branch, PR, checks, issues | Disposable own repo | Approved project/org repository |
| Jira / Atlassian MCP | Issue lifecycle | Off unless sandbox | Enable only if admin grants & OAuth succeeds |
| Figma MCP | Design context and possibly create/edit | Optional; mock Markdown design | Verify seat, edit grants, and feature support |
| Playwright MCP | Exploratory browser testing | Local only | Approved browser + tool policies |
| Playwright Test | Repeatable end-to-end CI | Yes | Yes; CI runner configured |
| GitHub pull requests + `gh` CLI | Human gates in `pull-request` mode; reading merges back | Own repo, after the owner authorizes pushes and pull requests | Approved repository; branch protection and reviewer rules required |
| GitHub Actions | CI as the test evidence; gate validator as a required check | Optional; needed for `pull-request` mode | Only if Actions are allowed; pin action versions to policy |

## Suggested MCP files

- Portable Copilot harness workspace format: **root `.mcp.json`** using `mcpServers`.
- VS Code workspace format: **`.vscode/mcp.json`** using `servers`.
- Do not copy examples interchangeably. The kit installs portable **Playwright-only** samples in a project as `.orchestra/examples/claude-code.mcp.example.json` and `.orchestra/examples/copilot-cli.mcp.example.json` (and `.vscode/mcp.example.json` for VS Code); review one and copy it to the file your tool reads if needed. OAuth-based Jira/Figma should be installed via documented flow and verified on each account.
- **Never commit tokens, personal OAuth exports or authenticated browser storage.** Use `.gitignore` for local secrets, .env, test recordings and agent session files.

## Permission boundaries

```text
Human/organization policy
   ↓
OAuth/app identity + service scopes
   ↓
Allowed MCP tools / GitHub repository permissions
   ↓
Agent role tool allowlist
   ↓
Human approval for external writes/merge
```

Agent role prompts are the lowest layer: they guide behavior but do not enforce access controls. At every write, check project, repo, actor, action, environment and approval. **Do not delegate admin OAuth scopes to a general-purpose agent.**

## Least-privilege policy table

| Agent | File read | Code write | Local test | Tracker read | Tracker write | Figma write | Merge |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BA | Yes | No | No | Conditional | Draft/approved only | No | No |
| Architect | Yes | No | No | Conditional | No | No | No |
| Designer | Yes | No | No | Conditional | No | Approved only | No |
| Developer | Yes | Yes | Yes | Conditional | Update assigned ticket if approved | No | No |
| QA | Yes | Test files only | Yes | Conditional | Draft defect if approved | No | No |
| Reviewer | Yes | No | No | Conditional | Review comments | No | No |
| Orchestrator | Yes | State/docs only by default | Can request | Conditional | Conditional | No | `local-record` only: into the main branch at the owner's explicit word |

In `pull-request` mode the Orchestrator additionally needs to push its three run branches and open pull requests. It must not hold permission to merge into the main branch: protect that branch so that a merge requires a person, and in an organization's repository a reviewer other than the author.

In reality edit privileges are often workspace-wide, not path-level. Where path-level enforcement is needed, use branch protection, repository permissions and CI, not a prose restriction alone.

## Failure rules

- MCP server missing → record the step as `BLOCKED` or the check as `NOT_RUN`, use local artifact, request human setup; never fabricate ticket IDs.
- OAuth denied → `BLOCKED` for action requiring remote write.
- Figma write unavailable → use a design spec in Markdown and document that frames were not created.
- GitHub remote unavailable → preserve local branch/diff; no “PR opened” claim. The run uses `local-record` mode and says so in the delivery dossier.
- `gh` missing or not signed in → `--verify-remote` fails; do not drop the flag to get a pass. Fix the sign-in or switch the run to `local-record` with the owner's agreement.
- CI not configured or Actions disabled → the tests gate cannot pass in `pull-request` mode; report `BLOCKED`.
- Browser MCP unavailable → use deterministic Playwright CLI tests if installed; record exploratory test `NOT_RUN`.
- The organization's policy blocks subagents or CLI → switch to supervised manual role transitions, preserving output contracts; report reduced autonomy.

## Environments

Use synthetic names and repositories in a personal pilot. An organization's environment uses only test data and repositories the organization has authorized. Never copy personal accounts or credentials into the organization's workspace; docs and code may move after a security review.
