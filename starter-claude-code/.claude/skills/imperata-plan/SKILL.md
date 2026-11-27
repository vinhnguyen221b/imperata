---
name: imperata-plan
description: Plan an Imperata run once its specification is approved. It writes the design brief when the feature changes the UI, then the technical plan and its tasks, up to the plan approval. Send it in a new SDLC Orchestrator session, with the run ID after the command.
argument-hint: <runId>
disable-model-invocation: true
---

This command is for the SDLC Orchestrator. If you are not the SDLC Orchestrator, do nothing else: tell me to start a session as the Orchestrator (Claude Code: `claude --agent sdlc-orchestrator`; Copilot: the SDLC Orchestrator agent) and send the command there.

Continue the run I name with this command, using the business decisions newly approved in its run folder; if I named no run, ask me which one first. Verify the run manifest revision and source versions. In `pull-request` mode, confirm with `gh` that the specification pull request of the run (branch `sdlc/<runId>/spec`) is merged and record who merged it before treating business approval as passed. Delegate UX design first, when the feature changes the UI, then technical planning; produce traceable tasks that each carry a `Skills` field, then ask for plan approval before implementation (in `pull-request` mode: open the plan pull request and stop). On a light run (`track: light`) there is no plan approval: validate the manifest, which checks the plan against the light-track limits, and either continue to implementation or move the run to the full track and say why. Do not run unrelated infrastructure work or external writes. Record unavailable tools and keep status BLOCKED if any required approval is missing. Render the run board before each report, and ask for plan approval with its decision brief and its "Check before you decide" list.

Write what I read in English, whatever language this command and my words are in.
