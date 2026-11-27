# 01 — Executive Blueprint

**Doc ID:** ORCH-001 | **Status:** Proposed

## Context & intended result

Imperata runs on GitHub Copilot in VS Code or on Claude Code, whichever a team may use. The **product** is chosen per project: each repository names it, with its sources and constraints, in its project profile `.orchestra/project.md`. The kit names no product.

**Imperata** is a *development workflow* to build that product from source requirements with specialist agents and audited gates. Name the product and Imperata separately in every artifact.

## Hypothesis to test

> A single engineering lead can use Imperata, a supervised workflow for GitHub Copilot or Claude Code, to advance one nontrivial business requirement through BA, architecture, implementation, QA, and review while preserving requirements traceability and verifiable evidence.

This is a hypothesis, not an automation capability already established.

## Choosing a feature that challenges Imperata

A pilot feature should exercise what Imperata is for. Prefer one that has:

1. **A business rule the sources leave open**, so that the Business Analyst has to ask instead of invent.
2. **An invariant enforced on the server**: authorization, isolation between accounts or projects, or a mandatory policy, with at least one case that must be rejected.
3. **Versioning or concurrency**: two versions or two actors meet, and one must lose with a clear reason.
4. **Contrasting data setups** in which the same rule gives different, explainable outcomes.

**Primary scripted feature:** chosen per project and named in the run's `input.md`, with a sentence on how it meets these four points. A first run on a repository without code is usually a foundation run that builds the baseline the feature needs.

## Success criteria for a pilot

- BA produces at least one material ambiguity and explicit question/decision request instead of silently inventing policy.
- Requirements map to acceptance criteria, test IDs, tasks and code/PR references.
- Two contrasting data setups give different outcomes under the same rule.
- A rejected case fails with a traceable reason; an accepted case succeeds under controlled data.
- QA reports independently generated negative/boundary tests, including one intentional regression or injected defect.
- Reviewer issues actionable findings and verifies fixes; no “all passed” without execution evidence.
- End result: a reviewable PR plus delivery dossier; **Done requires authorized human approval and real conditions**, not the agent's narrative.

## Scope / non-scope

**In scope:** agent roles, conventions, delegation protocol, requirements traceability, optional external integrations, quality gates, evidence schema, a personal pilot, adoption by an organization, measurement, pull request merges as human gates, CI as test evidence, skills named per task and artifact templates.

**Out of scope:** unattended 24/7 agent service, automatic hand-over from one agent to the next through GitHub Actions, self-hosted scheduler, universal multi-provider runtime, full enterprise IAM/SSO, production deployment or automatic approvals.

## Operating principles

- Artifacts over chat: persist specs, decisions, tests, diff, evidence.
- One owner of authoritative state per phase; use optimistic concurrency for shared writes.
- Deterministic checks over model self-evaluation wherever possible.
- A person's decision is recorded where it can be checked outside the agent's own files: a merged pull request where there is a remote.
- Fail closed: inaccessible tools, ambiguous permissions and missing evidence cause `BLOCKED`, not `PASSED`.
- Keep the business problem intentionally partially open until BA clarifies; maintain source-of-truth precedence.

## Source precedence

1. Explicit, approved product decisions and the organization's policies.
2. Product requirements / accepted change requests.
3. Agent-produced feature specifications after human clarification.
4. Architectural decisions and implementation plans.
5. Agent suggestions (lowest authority).

A lower layer cannot silently change a higher one. When they conflict, record an issue and request a decision.
