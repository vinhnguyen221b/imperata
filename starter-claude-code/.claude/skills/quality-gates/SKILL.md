---
name: quality-gates
description: Validate evidence and traceability before claiming a feature is ready for acceptance. Use before every stage change of an Imperata run and before any readiness claim.
---

# Quality gates

Inspect `sdlc/runs/<run-id>/run.json` and linked test evidence; do not mark PASS from chat testimony. Check original requirement source, accepted AC, mandatory test reports and independent review. Run `node scripts/validate-gates.mjs <run.json>` from the repository root, before every stage change and before any readiness claim. It checks the manifest's required fields, that the gates and artifacts a stage depends on are in place, that every passed human gate has a record in `approvals` (in `local-record` mode, one that approves the gate's documents as they are now), that a passed review gate rests on a review that says `APPROVE_FOR_HUMAN_REVIEW` and leaves no BLOCKER open, that every test the test plan marks mandatory passed, and the extra conditions for `DONE`. The manifest format is `.orchestra/schemas/run.schema.json`.

In `pull-request` mode add `--verify-remote`. The script then asks GitHub, through the `gh` CLI, whether each pull request named in `approvals` is merged and by whom, whether every CI check on the delivery pull request succeeded, with the checks named by `--require-check` (the ones that run the build and the tests) succeeded and not skipped, whether the head of that pull request is the tested commit or a later one that changes only the run folder, and whether the CI run in `externalEvidence.ci` completed with success on the tested commit; it asks git whether anything outside the run folder changed after the tested commit. If `gh` is missing or not signed in, the check fails; that is the intended result, not an error to work around.

Without `--verify-remote` the script is only a **manifest sanity checker**. In `local-record` mode nothing outside the repository confirms the human gates or the tests; say so in the report. Tracker state is never checked by the script.

A hook in `.claude/settings.json` runs the same script after every edit of a run manifest made with the file tools and returns its findings. It reports an invalid manifest; it does not prevent the edit and does not see a manifest written by a shell command. Run the script yourself as described above; do not rely on the hook alone.

If evidence is absent, write `NOT_RUN` or `BLOCKED`; never invent success. For `DONE`, require verified human approval and actual Git/issue state: the merged delivery pull request in `pull-request` mode, a merge into the main branch that git confirms (`externalEvidence.localMerge`) in `local-record` mode.
