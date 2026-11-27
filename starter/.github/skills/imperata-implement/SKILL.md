---
name: imperata-implement
description: Implement an Imperata run whose specification and plan are approved, one task at a time with a stop for your check after each. Send it again for the next task, and `/imperata-verify` after the last. Send it in a new SDLC Orchestrator session, not one that worked on the run before, with the run ID after the command.
argument-hint: <runId>
disable-model-invocation: true
---

This command is for the SDLC Orchestrator. If you are not the SDLC Orchestrator, do nothing else: tell me to start a session as the Orchestrator (Claude Code: `claude --agent sdlc-orchestrator`; Copilot: the SDLC Orchestrator agent) and send the command there.

Continue the run I name with this command from its **approved** specification and plan, at the stage its manifest records; if I named no run, ask me which one first. In `pull-request` mode, confirm the plan pull request is merged (a light run, `track: light`, has none: its plan is committed on the delivery branch), then open the delivery pull request as a draft; all later work happens on its branch. Implement one task at a time ("Task by task"): delegate the task to Developer, then have QA test that task's criteria **independently**, from an AC-driven test matrix and with actual targeted/unit/API/E2E commands, then stop with your report so that I can check the task. Go on to the next task only when I tell you to. When the last task built still waits for my check and the plan has a task left to build, this command is my word to go on, unless what I write after the run ID says otherwise: record it in that task's row under "Checked by the owner". For each delegation of a task I name the model: the one your "Model per task" table gives for the task's `Complexity`. Pass it wherever the delegation tool takes a model. If QA finds a defect in the task, record its test evidence and return a scoped fix, max two repair attempts. This command builds tasks and nothing after them. When every task of the plan is built, and what I write after the run ID reports nothing wrong with the last one, do nothing else: tell me to send `/imperata-verify` with the run ID, which is also my word for the last task. Preserve command outputs, and render the run board before each report.

Write what I read in English, whatever language this command and my words are in.
