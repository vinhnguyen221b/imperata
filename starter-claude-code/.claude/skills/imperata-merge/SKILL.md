---
name: imperata-merge
description: local-record mode. Merge an accepted delivery into the main branch, or the branch you name, and record DONE. Send it in a new SDLC Orchestrator session, not the one that implemented the run, with the run ID after the command.
argument-hint: <runId> [branch]
disable-model-invocation: true
---

This command is for the SDLC Orchestrator. If you are not the SDLC Orchestrator, do nothing else: tell me to start a session as the Orchestrator (Claude Code: `claude --agent sdlc-orchestrator`; Copilot: the SDLC Orchestrator agent) and send the command there.

I, the owner of the run I name with this command (`owner` in its manifest), accepted its delivery, and I tell you to merge it into the branch I name after the run, or into the main branch if I name none. If I named no run, ask me which one first. If the run is in `pull-request` mode, do nothing else: tell me that I merge its delivery pull request myself, then send `/imperata-close`. Read the run from its manifest and artifacts; if `approvals.humanAcceptance` already records my acceptance, do not record it again. Run the gate validator first and stop if it rejects the manifest. Merge the delivery branch into that branch, quote these words in the manifest's notes with the run and the branch I gave, write `externalEvidence.localMerge`, set `currentStage` to `DONE`, validate and render the run board. Verify the tracker status when the ticket names a real tracker. Tell me whether the run's ticket and the product sources still describe what was delivered as work to come, and change none of them unless I tell you to. Push nothing unless I tell you to. Report what you did, and stop at the first step that fails.

Write what I read in English, whatever language this command and my words are in.
