# 07 — From a personal pilot to an organization

**Doc ID:** ORCH-007 | **Status:** Proposed

## Principle

A personal pilot proves the **workflow mechanics** in your own account, **not** that an organization's permissions and policies allow them. Re-run the capability and security checks after the move. An account the organization manages may restrict Copilot CLI, Claude Code, MCP servers, subagents, workspace trust, repository access or external domains.

## Pilot profile (`personal`)

- GitHub repository owned by user, private by default, synthetic data only.
- The agent tool selected: the Copilot harness in VS Code, or Claude Code. Check that role files load; test read-only delegation before code writes.
- Start with a **local ticket**; add GitHub Issues when authorized. Do not connect the organization's Jira or files.
- No unattended `--yolo`. A run uses no part of Spec Kit (`05_SPEC_KIT_AND_TRACEABILITY.md`).
- Run local services, such as a database in a container, only if the product code needs them; use mock external connectors.
- Playwright Test deterministic; optional Playwright MCP for exploratory.
- Figma optional; default reviewed Markdown UI spec if permission or time is constrained.

## Organization profile (`organization`)

- A new repository or workspace the organization approves, with approved synthetic product data.
- Request approval from whoever administers the tools: repository, Copilot CLI/SDK or Claude Code usage if planned, MCP endpoints, OAuth apps, the Figma workspace, the Jira project, GitHub Actions, artifact retention.
- Re-authenticate all integrations under the organization's identity; do **not** bring `~/.copilot`, `~/.claude`, OAuth tokens, `.env`, browser profiles or personal logs across.
- Keep identical **interface contracts**: agent roles, output schemas, stages, gates; swap tracker/design/test adapters as policy allows.
- Review outbound network access, data residency, audit logs, token budget, branch protection and PR review policy.

## Capability preflight checklist

| Check | Personal | Organization | Evidence |
| --- | --- | --- | --- |
| Agent tool usable and allowed | ☐ | ☐ | Agent picker or `claude --agent` + test message |
| Subagent delegation succeeds | ☐ | ☐ | Traced read-only worker task |
| Agent files recognized (`.github/agents` or `.claude/agents`) | ☐ | ☐ | Customizations editor or agent list |
| GitHub repo issue/PR scopes approved | ☐ | ☐ | Read test then approved write test |
| `gh` CLI installed and signed in | ☐ | ☐ | `gh auth status` |
| Main branch protected; a person must merge | ☐ | ☐ | Branch rule shown; a direct push is refused |
| GitHub Actions allowed; PR checks run | ☐ | ☐ | One green run of the checks workflow |
| Gate validator `--verify-remote` against a real merged pull request | ☐ | ☐ | Validator output |
| Playwright Test runs | ☐ | ☐ | Test report & exit status |
| Playwright MCP allowed | optional | ☐ | Browser smoke interaction |
| Jira MCP/OAuth allowed | optional | ☐ | Read issue (write separate approval) |
| Figma MCP allowed | optional | ☐ | Read node/file; write separately |
| Secrets/logs storage compliant | ☐ | ☐ | Security review |

## Migration sequence

1. Finish one **local-only vertical slice** on the personal account in `local-record` mode: requirement → spec → plan → implementation → tests → review → ready for acceptance. Then repeat one small ticket in `pull-request` mode on the personal repository before moving.
2. Remove personal references from agents/templates; pin tool versions or document installed versions; inspect `git status`/diff and secrets scan.
3. Export only reviewed source/docs/config. No authentication context, chat transcripts with private data, data of the organization or browser storage.
4. Start fresh in a repository the organization approves; run the capability preflight and re-authenticate.
5. Repeat an identical **small evaluation ticket** and compare AC coverage, CI, actual tool invocation and failures.
6. Turn on Jira/Figma one integration at a time; do not turn on external write+auto-approval simultaneously.
7. Have the organization review the result before a wider rollout.

## Fallback grid

| Constraint | Recommended fallback |
| --- | --- |
| Copilot CLI disallowed by the organization | VS Code Copilot interactive session |
| Subagents disallowed | Manually select same role agents in successive chats; maintain run artifacts |
| Jira MCP disallowed | GitHub Issues in approved repo, or signed local ticket mirror |
| Figma MCP unavailable | Design brief + screenshots, manually approved |
| GitHub PR scope unavailable | `local-record` approval mode: local branch, patch and review dossier; don't claim merged, and state that approvals were not confirmed outside the repository |
| GitHub Actions disallowed | `local-record` mode, or an approved CI system whose result the owner records; the tests gate is then not checked by the validator |
| Playwright MCP disallowed | Playwright Test CLI in approved runner |

## Cost awareness

Use smaller models where allowed for extraction, drafting and targeted checks; reserve more reasoning capacity for architecture/security. Limit retry to two iterations per defect and avoid repeatedly running all suites. Monitor the plan's request or credit limits; a seat the organization pays for does not imply unlimited use or permission for personal use.
