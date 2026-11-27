---
name: imperata-start
description: Start a supervised Imperata run for one bounded feature, given after the command. Send it in an SDLC Orchestrator session.
argument-hint: <feature>
disable-model-invocation: true
---

This command is for the SDLC Orchestrator. If you are not the SDLC Orchestrator, do nothing else: tell me to start a session as the Orchestrator (Claude Code: `claude --agent sdlc-orchestrator`; Copilot: the SDLC Orchestrator agent) and send the command there.

Start a **supervised** AI SDLC run for the feature I give with this command; if I gave none, ask me for it first. Use a local ticket artifact unless a GitHub Issues/Jira tool is already explicitly authorized. Ask me which approval mode this run uses, `pull-request` or `local-record`, and record it in the run manifest. This step ends at the business decisions: stop there with your report.

Write what I read in English, whatever language this command and my words are in.
