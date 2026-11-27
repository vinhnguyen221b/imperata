---
name: imperata-close
description: pull-request mode. After you merged the delivery pull request, record the acceptance and DONE. Send it in a new SDLC Orchestrator session, with the run ID after the command.
argument-hint: <runId> [pull request URL]
disable-model-invocation: true
---

This command is for the SDLC Orchestrator. If you are not the SDLC Orchestrator, do nothing else: tell me to start a session as the Orchestrator (Claude Code: `claude --agent sdlc-orchestrator`; Copilot: the SDLC Orchestrator agent) and send the command there.

I merged the delivery pull request of the run I name with this command: the URL I give after the run, or the pull request of its branch `sdlc/<runId>/delivery` if I give none. If I named no run, ask me which one first. If the run is in `local-record` mode, do nothing else: tell me to send `/imperata-merge` instead. Read the run from its manifest and artifacts, read the merge back with `gh`, record it as the human acceptance, verify the tracker status, and record `DONE` in a closing commit as the run's instructions say. Validate with `--verify-remote` and render the run board. Tell me whether the run's ticket and the product sources still describe what was delivered as work to come, and change none of them unless I tell you to. Report what you did, and stop at the first step that fails.

Write what I read in English, whatever language this command and my words are in.
