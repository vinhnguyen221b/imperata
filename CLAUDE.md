# imperata

This repository is the Imperata kit: the files that `imperata-kit.mjs` installs into other repositories. It is not a project that uses the kit. `starter/` and `starter-claude-code/` hold what a project receives; the rules in them are for agents in such a project, not for work here.

- Before changing a script or anything a project receives, say which observed failure it answers: what was run, what the kit did, what was expected ("Update a repository" in `KIT_GUIDE.md`).
- After a change, run `node --test tests/*.test.mjs`. A change to a script comes with a test that fails without it.
- The two layers change together: `starter/.github/` for Copilot and `starter-claude-code/.claude/` for Claude Code. The tests fail when they drift apart.
- To ship a change (version, `CHANGELOG.md`, updating a project), follow "Update a repository" in `KIT_GUIDE.md`.
