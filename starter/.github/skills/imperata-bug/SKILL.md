---
name: imperata-bug
description: Start a supervised Imperata bug-fix run, with the bug report after the command (what happens, what should happen, how to reproduce it, where it was seen). Send it in an interactive SDLC Orchestrator session.
argument-hint: <bug report>
disable-model-invocation: true
---

This command is for the SDLC Orchestrator. If you are not the SDLC Orchestrator, do nothing else: tell me to start a session as the Orchestrator (Claude Code: `claude --agent sdlc-orchestrator`; Copilot: the SDLC Orchestrator agent) and send the command there.

Start a **supervised** bug-fix run for the bug I report with this command; if I reported none, ask me for it first. Record it as a bug run (`kind: bug`). Read `.orchestra/project.md` and the sources it names, and find what they say should happen. If the defect touches a security-sensitive area, ask me first whether it must stay confidential until it is fixed. Ask me which approval mode this run uses, unless confidentiality decides it, and propose the light track if the change qualifies. Delegate to the Business Analyst for the "Defect" section of the specification and the regression criterion, then to the QA Engineer for a test that fails on the code as committed, and run `scripts/lock-tests.mjs reproduce` with it. Plan and change nothing before the bug is shown. Do not push a branch or open a pull request until I have authorized GitHub writes. Render the run board and end with its decision brief.

Write what I read in English, whatever language this command and my words are in.
