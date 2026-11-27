# 11 — Official reference sources and verification notes

**Reviewed for blueprint:** 2026-11-10 to 2026-11-16. Tool, entitlement and policy details can change; verify with the installed VS Code build or Claude Code version and with the organization's administrator.

- VS Code — Custom agents: https://code.visualstudio.com/docs/agent-customization/custom-agents
- VS Code — Custom agent file reference (aliases, invocation and permissions): https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference
- VS Code — Subagents and harness differences: https://code.visualstudio.com/docs/agents/run/subagents
- VS Code — MCP configuration reference: https://code.visualstudio.com/docs/agents/reference/mcp-configuration
- VS Code — Add MCP servers: https://code.visualstudio.com/docs/agent-customization/mcp-servers
- VS Code — Manage MCP servers and enterprise caveats: https://code.visualstudio.com/docs/agents/run/manage-mcp-servers
- GitHub Spec Kit documentation: https://github.github.com/spec-kit/
- GitHub Spec Kit repository: https://github.com/github/spec-kit (MIT licence). The Business Analyst's coverage categories (Clear / Partial / Missing), which it marks for the sources before it asks its questions, are adapted from Spec Kit's clarify step.
- Playwright Test: https://playwright.dev/docs/intro
- Microsoft Playwright MCP: https://github.com/microsoft/playwright-mcp
- GitHub — Linking a pull request to an issue (closing keywords): https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue
- GitHub — About protected branches: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- GitHub CLI — `gh pr view`: https://cli.github.com/manual/gh_pr_view
- Google Chrome — Modern Web Guidance, source repository with its evaluation harness: https://github.com/GoogleChrome/modern-web-guidance-src (read on 2026-11-16, not run; the test calibration follows its grader calibration: pass on reference solutions, fail on the untouched application; the rules for tests, the decidable acceptance criteria and the "Skills applied" evidence follow its rules for graders and expectations and its skill-usage disclosure)
- Cloudflare — security-audit skill: https://github.com/cloudflare/security-audit-skill (read on 2026-11-16, not run; the kit's own tests follow its practice of keeping each validator beside a test suite without dependencies)
- Matt Pocock — skills: https://github.com/mattpocock/skills (read on 2026-11-16, not run; the bar for a change in `KIT_GUIDE.md` follows its bar for changes)

## Interpretation warnings

- Agent file *schema* validation is not execution evidence.
- Copilot harness uses its own delegation mechanism; `runSubagent` belongs to Local harness.
- `.mcp.json` portable `mcpServers` and `.vscode/mcp.json` `servers` are different formats.
- MCP tools are not themselves permission enforcement, and prompts are not authorization checks.
- A seat or membership in an organization does not prove which capabilities are permitted.
- A merged pull request proves that some account with merge rights merged it. Who may merge is set by branch protection, not by this blueprint.
- Whether Copilot discovers skill folders nested inside other skill folders was not tested; the blueprint keeps skills flat under `.github/skills/` so that it does not matter.
