// SPDX-License-Identifier: MIT
// What the Orchestrator's instructions must still say, in both layers. Each entry is one rule of a run and a
// marker of it: a command, a field, a file, or the fixed words of the rule. Shortening the instructions is
// welcome; losing a rule is not, and this test is what tells the two apart. A rule that is taken out on
// purpose is taken out here in the same change.
//
// A marker shows that the rule is still named. It does not show that the sentence round it still means the
// same; reading the diff does that.
//
// Where a marker quotes a whole phrase ("Never write or edit that file yourself"), the force of the rule is
// in the phrase. A shorter text can keep every rule named and still weaken some of them: a "never" becomes a
// description, a list of cases becomes "one", a rule for every run moves under a heading about light runs.
// These markers hold the wording.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitRoot } from './helpers.mjs';

const CLAUDE = 'starter-claude-code/.claude/agents/sdlc-orchestrator.md';
const COPILOT = 'starter/.github/agents/sdlc-orchestrator.agent.md';
const text = (rel) => readFileSync(join(kitRoot, rel), 'utf8');

// Rules that hold whatever the agent tool is.
const RULES = {
  'Before starting': [
    ['reads the project profile first', /Read `\.orchestra\/project\.md`/],
    ['creates the run folder from the schema and the example', /input\.md.*run\.json[\s\S]*run\.schema\.json[\s\S]*EXAMPLE\.run\.json/],
    ['checks branch, writable scope and tools before any change', /writable scope and available tools/],
    ['asks whether the tracker and Figma are real', /real or mocked/],
    ['asks the owner for the approval mode and records it', /approvalMode/],
    ['writes artifacts from the templates only', /\.orchestra\/templates\/.*another structure/],
  ],
  'Bug runs': [
    ['records a bug run as kind bug', /record `kind: bug` in `run\.json`/],
    ['asks before a security defect is published, and keeps it unpushed', /ask the owner before you delegate whether it must stay confidential[\s\S]*`confidential: true`[\s\S]*`local-record` mode: push no branch and open no pull request/],
    ['reproduces the bug with the script before any plan', /lock-tests\.mjs reproduce <runId>[\s\S]*`artifactPaths\.reproduction`/],
    ['locks the test that showed the bug', /Exit 0: the bug is shown; record the lock/],
    ['plans no fix for a bug nobody has shown', /Exit 1: the bug is not shown; do not plan a fix/],
    ['asks for the business approval only once the bug is shown', /Ask for the business approval only once the bug is shown/],
    // A bug run stays with its bug: no criterion for what a test of the repository already holds.
    ['has no criterion written for what a test of the repository holds', /becomes a criterion only where no test of the repository holds it[\s\S]*Send back a draft that writes criteria for what the tests already hold/],
    ['has the plan start with the root cause, and never guards the test that showed the bug', /its plan starts with the root cause[\s\S]*never pass it with `--guard`/],
  ],
  'Approval mode': [
    ['names the three human gates', /`businessApproval`, `planApproval`, `humanAcceptance`/],
    ['uses pull-request mode only with a remote and the owner\'s authorization', /GitHub remote and the owner has authorized you/],
    ['never merges', /you never merge/],
    // A resumed session whose context predates an acceptance another session recorded may record it again.
    ['merges in the new session the owner starts, and never records the acceptance twice', /a new session \(`\/imperata-merge`\)[\s\S]*never record it a second time/],
    ['has one branch for each gate', /sdlc\/<runId>\/spec[\s\S]*sdlc\/<runId>\/plan[\s\S]*sdlc\/<runId>\/delivery/],
    ['puts the design brief in the plan pull request, when the run has one', /\| `planApproval` \| `sdlc\/<runId>\/plan` \| the technical plan and its tasks, and `design\.md` when the run has a design brief \|/],
    ['drafts the plan only after the specification is merged', /only after the specification pull request is merged/],
    ['opens the delivery pull request as a draft before verification', /as a draft before verification/],
    ['lets only the delivery pull request close the tracker item', /Closes #N[\s\S]*Refs #N/],
    ['reads a merge back before recording it', /gh pr view <url> --json state,mergedBy,mergedAt[\s\S]*kind: pull-request/],
    ['does not pass a gate on an unmerged pull request', /not `MERGED` does not pass a gate/],
    ['passes tests only from the CI run and records it', /only from the CI run[\s\S]*externalEvidence\.ci/],
    ['changes only run files after the tested commit', /After the tested commit, change only files under `sdlc\/runs\/<runId>\/`/],
    ['records a local decision with its file', /kind: local-record[\s\S]*recordPath/],
    ['records the approved version, and leaves approved documents as they are', /The record holds the line `<gate>: APPROVE <documents>@<version>`[\s\S]*Once a gate has passed, leave the documents it approved as they are/],
    ['closes a local-record run with a merge the owner made or asked for, checked by git', /merged into the main branch by the owner, or by you only when the owner tells you to[\s\S]*`externalEvidence\.localMerge`[\s\S]*set `currentStage` to `DONE`/],
    ['says in the dossier what was not confirmed outside the repository', /not confirmed outside the repository/],
  ],
  Track: [
    ['is full unless the owner agrees to light', /unless the owner agrees/],
    ['proposes, and the owner decides', /You propose, the owner decides/],
    ['never chooses the light track itself', /Never choose `light` yourself/],
    ['does not take silence for agreement', /never read silence as agreement/],
    ['keeps the rules of both tracks under one heading', /^Rules:$/m],
    ['keeps plan, independent testing and review on a light run', /still writes a plan[\s\S]*still tests independently[\s\S]*still reviews/],
    ['proposes light only away from security-sensitive areas', /touches no security-sensitive area/],
    ['proposes light only without a data, contract or dependency change', /no data model, migration, public contract or dependency/],
    ['proposes light only without a UX step', /needs no `(ux-designer|UX Designer)`/],
    ['proposes light only for at most three tasks, none high', /at most three tasks, none of them `high`/],
    ['proposes light only where a stack skill already covers the code', /a stack skill already covers the code it changes, so the plan needs no `TASK-00`/],
    ['knows the validator rejects a light plan with a stack-skill task', /more than three tasks, a `high` task or a `TASK-00`/],
    ['records the owner\'s agreement and waives the plan approval', /track: light[\s\S]*trackDecision[\s\S]*WAIVED[\s\S]*approvals\.planApproval/],
    ['says the run is light when asking for the business approval', /also lets implementation start/],
    ['has two pull requests on a light run, the plan on the delivery branch', /Commit the plan on the delivery branch/],
    ['tells the Architect the run is light and validates first', /that the run is light\. When it returns, validate before anything else/],
    ['moves a run that outgrows light to full', /track: full[\s\S]*trackDecision: null[\s\S]*planApproval: NOT_RUN/],
    ['never shapes tasks to stay on the light track', /never split, merge or re-rate/i],
    ['never moves a run from full to light once planned', /never moves from `full` to `light`/],
  ],
  'Delegation protocol': [
    ['stops when a named agent is missing', /stop and report it[\s\S]*general-purpose|play the role yourself/],
    ['gives each delegation its scope and stop conditions', /runId, exact objective, approved source IDs[\s\S]*stop conditions/],
    ['expects one of four outcomes', /COMPLETED\/BLOCKED\/NEEDS_DECISION\/FAILED/],
    ['inspects artifacts, not claims', /inspect actual artifacts/],
    ['runs the specialists in order', /→[\s\S]*independent testing →[\s\S]*delivery review/],
    ['implements task by task between the plan and the independent testing of the whole', /planning → `(developer|Developer)` and `(qa-engineer|QA Engineer)` task by task \(see "Task by task"\) → `(qa-engineer|QA Engineer)` independent testing/],
    ['delegates the UX Designer before the Architect, and saves the brief first', /\(`(ux-designer|UX Designer)` when UI is material\) → `(architect|Architect)` planning[\s\S]*save its brief as `sdlc\/runs\/<runId>\/design\.md` before you delegate `(architect|Architect)`, which plans from it/],
    ['runs one at a time, one writer on a checkout', /one at a time[\s\S]{0,40}two writers on the same checkout/],
    ['asks the owner before ambiguous rules and high-impact actions', /ambiguous rules and high-impact actions/],
    // An Orchestrator not told what a NEEDS_DECISION does to a run may go on with its own reading, list its answer
    // among the decisions and set the question to the last gate.
    ['stops the run when a specialist needs a decision, and decides nothing itself', /returns `NEEDS_DECISION` stops the run there[\s\S]*wait for the owner's answer\. Never continue on a reading of your own, never write your choice or a specialist's as the decision, and never set the question to a later gate so that the work can go on/],
    ['checks with git what the QA Engineer changed', /check with git which files it changed[\s\S]*QA step FAILED/],
    ['records the test plan and the test report', /artifactPaths\.testPlan[\s\S]*artifactPaths\.testReport/],
    ['knows every criterion needs a passed test or an accepted gap', /"Not covered"/],
    // The reviewer reads the dossier, so it is brought up to date before the review.
    ['brings the dossier up to date before the review', /Bring the delivery dossier up to date before the review, since the reviewer reads it: its Gates table reads what the manifest holds for every gate before the acceptance, and "Proven, unproven, blocked" and the pending actions are filled in/],
    ['lets only the owner accept a gap', /Only the owner accepts a gap[\s\S]*own judgement/],
    ['knows that every case of a criterion needs its test', /Where a criterion has cases, the validator requires that of every case: a test names the cases it covers, and one that names the criterion alone covers none of them/],
    ['saves the diff the Code Reviewer reads', /evidence\/delivery\.diff/],
  ],
  // A plan that puts the tests before the code leaves the QA Engineer nothing to run, and it may write the
  // application a second time outside the repository; implementation that goes from task to task with nobody
  // asked leaves the owner nothing to check until the end. The order of the roles holds whatever the plan says.
  'Task by task': [
    ['implements one task at a time, in the plan\'s order', /one task at a time, in the order the plan's `Depends on` gives/],
    ['gives the Developer one task in a delegation', /one task in one delegation, never several/],
    ['has the QA Engineer test a task once its code is committed, that task\'s criteria only', /Commit, then delegate the task to `(qa-engineer|QA Engineer)`: it tests the criteria that task names/],
    ['gives a task without a criterion no QA step', /A task that names no criterion, such as a stack skill or a scaffold, has no such step/],
    ['records the lock after each task\'s QA step', /Check with git what `(qa-engineer|QA Engineer)` changed and record the test lock \("Test lock"\)/],
    // Run artifacts committed without a render leave `board.md` a revision behind the manifest, with only the
    // page the board server renders current.
    ['renders and checks the board before the commit of each task', /Render the board, run `node scripts\/render-run-board\.mjs --check`, commit, and stop with your report/],
    ['stops after each task with what the owner checks', /"Checked by the owner" in `delivery\.md`[\s\S]*stop with your report: what the task changed, which criteria its tests pass, and how the owner checks it, from the task's `Owner check`/],
    ['goes on only at the owner\'s word, and records it before the next task', /Go on only at the owner's word[\s\S]*Write that word and its time into the row before you delegate the next task/],
    ['stops after the last of several tasks the owner named', /do several tasks before the next stop[\s\S]*stop after the last of them/],
    ['never writes a word for the owner', /Never write a word the owner did not say/],
    ['treats what the owner finds wrong as a defect of that task, and stops there again', /is a defect of that task[\s\S]*stop again at the same task/],
    ['keeps the order of the roles whatever the plan says', /The order of the roles is this one whatever the plan says/],
    ['has no test written before the code it tests, a bug\'s reproduction apart', /only for code that exists and is committed: except to reproduce a bug \("Bug runs"\), no test is written before the code it tests/],
    ['allows no specialist what its own instructions forbid', /Never allow a specialist in a delegation what its own instructions forbid[\s\S]*writes no application code, in the repository or outside it/],
    // The QA Engineer derives the tests from the criteria, not from the plan.
    ['asks the Architect for no test design, and sends the QA Engineer to the plan for the task only', /ask `(architect|Architect)` for no test design, and send `(qa-engineer|QA Engineer)` to the plan for the task and its `Skills`, never for what to test/],
    ['sends back a plan with another order, and a task without an Owner check', /Send back to `(architect|Architect)` a plan that gives another order, and a task without `Owner check`/],
    ['goes on to verification once the last task has the owner\'s word', /When the last task has the owner's word, the run goes on to verification/],
    // Verification has a command of its own, not the implement command sent again, and the whole suite runs at
    // standard: each task has been tested at its own level.
    ['takes the verify command as the owner\'s word after the last task', /the implement command sent again, or the verify command after the last task/],
    ['stops after the last task too, and names the verify command', /After the last task you stop as after any other, and tell the owner that the verify command comes next/],
    ['starts verification with the verify command only, in a session of its own', /Verification starts with that command, in a session of its own: when the owner gives the word for the last task in the session that built it, write it into the row and name the command again/],
    ['delegates the whole suite at standard whatever the levels of the tasks', /The whole suite is no task's step: each task was tested at its own level, so delegate it at `standard` whatever the levels of the tasks/],
  ],
  'Test lock': [
    ['records the lock after an accepted QA step', /lock-tests\.mjs record <runId>[\s\S]*artifactPaths\.testLock/],
    ['names the files or a base when the script finds none', /--base <ref>/],
    ['records the lock only after an accepted QA step and its git check', /Record the lock only then/],
    ['never records the lock after a Developer step or to pass a check', /Never record it after a `(developer|Developer)` delegation, and never to make a failing check pass/],
    ['does not accept a changed test by recording the lock again', /Do not accept the change by recording the lock again/],
    ['checks the lock after every Developer delegation once it is recorded, a later task as well as a repair', /After every `(developer|Developer)` delegation made once a lock is recorded, a later task as well as a repair, run `node scripts\/lock-tests\.mjs check <runId>`/],
    ['fails a task or a repair that changed a locked test', /makes the task or the repair FAILED[\s\S]*restored from git[\s\S]*count the attempt/],
    ['sends a disputed test to the QA Engineer', /locked test is wrong[\s\S]*record the lock again/],
    ['sends the business question behind it to the owner', /business question behind it goes to the owner/],
    ['reports the skip-marker warning', /skip-marker warning/],
  ],
  'Test calibration': [
    ['calibrates with the command of the test plan', /lock-tests\.mjs calibrate <runId> --cmd[\s\S]*Environment section/],
    // A test that fails in some runs of the whole suite can pass every step up to the owner's acceptance when
    // calibration runs each file once.
    ['runs the whole suite several times when it calibrates', /--suite "<command>"`, with the commands the test plan's Environment section gives for one test file and for all tests/],
    ['knows the placeholders', /`\{file\}`, `\{dir\}` or `\{name\}`/],
    ['prepares the base checkout as the test plan says', /--link <path>[\s\S]*--setup/],
    ['calibrates once per stack', /once per stack/],
    ['calibrates before review and before taking the CI run', /`REVIEWING`[\s\S]*before you take the CI run as the tests gate/],
    ['records the result and leaves it to the script', /test-calibration\.json[\s\S]*artifactPaths\.testCalibration/],
    ['knows where the script runs each file', /temporary checkout of the base commit/],
    ['never writes or edits the result', /Never write or edit that file yourself/],
    ['sends a file that passes without the change to the QA Engineer', /Exit 1[\s\S]*"Expected to pass without the change"/],
    ['passes --guard only for what the test plan lists, never to pass the check', /Pass `--guard` only for a file listed there, never to make the check pass/],
    ['sends a suite that failed in a run to the QA Engineer, and does not run it again to clear it', /Exit 1 also follows a whole suite that failed in some of its runs[\s\S]*Running the suite again does not clear the failure/],
    ['corrects the command from the stack skill on exit 2', /Exit 2[\s\S]*stack skill/],
    ['reports a calibration that could not run as unproven', /"Unproven"[\s\S]*never report a calibration that did not run as passed/],
    ['names the test files the script left out', /only by their folder[\s\S]*Name on the command line/],
    ['calibrates again when the lock is recorded again', /Calibrate again/],
    ['knows the validator keeps a run with such a file out of review', /rejects `REVIEWING` and `READY_FOR_ACCEPTANCE` while a calibrated file passes without the change/],
    ['knows the validator keeps a run whose suite failed in a run out of review', /or while the whole suite failed in a run on the lock as it is now/],
    // On a repository with no code before the run, every file fails on the base by its import and no control
    // passes there: such a calibration proves nothing.
    ['reports a calibration without a control as unproven', /A calibration without a control goes under "Unproven" in the delivery dossier, never under "Proven"/],
    ['reports each kind of warning with the delivery', /warns when the tests were not calibrated, when the whole suite was not run more than once, when a file changed since, when there was no control, and for every guard[\s\S]*Report those warnings to the owner with the delivery/],
  ],
  'Stage changes': [
    ['raises the revision and validates before a stage change', /increase `revision`[\s\S]*validate-gates\.mjs sdlc\/runs\/<runId>\/run\.json/],
    ['verifies against GitHub in pull-request mode', /--verify-remote/],
    ['names the CI checks that run the build and the tests', /`--require-check <name>` for each CI check that runs the build and the tests/],
    ['restores the stage when the validator rejects', /restore the previous stage/],
    // A stage change made by hand takes many requests, an edit by hand can leave the manifest without a closing
    // brace, and the Orchestrator would search the schema for the name of a stage or the shape of a record.
    ['records a change to the manifest with one call of the script', /Record every change to `run\.json` with one call of `node scripts\/record-run\.mjs <runId>`/],
    ['runs none of the script\'s steps a second time', /run none of these again after it/],
    ['takes the name of a field from the script, not from the schema', /take a name from there, not from the schema or from another run's manifest/],
    ['knows that the script passes no gate', /It writes what you tell it and passes no gate/],
    ['edits the manifest by hand only where the script cannot be run', /Where that call is denied, or the script is not in the repository, make the change with the file tools/],
    ['passes a gate only on evidence', /evidence you can point to/],
    ['never passes a human gate itself', /never by you or a specialist|never by you or a worker/],
    // A session that ends with questions for the owner and the stage `ANALYSIS` leaves the board reading
    // "In progress. The Business Analyst is drafting". The file names the stage a run waits in.
    ['moves a run that waits for the owner\'s business decisions out of ANALYSIS before it reports', /set `currentStage` to `AWAITING_BUSINESS_DECISION` before you report[\s\S]*At `ANALYSIS` the board tells the owner that the analyst is still drafting/],
  ],
  'Run board': [
    ['uses the run-board skill', /`run-board` skill/],
    ['keeps the board current and checks it before a commit', /never be older than the artifacts[\s\S]*render-run-board\.mjs --check/],
    ['never draws status or edits the board', /Never draw a diagram[\s\S]*never edit the board files/],
    ['gives the run a title and its dependencies', /`title`[\s\S]*`dependsOn`/],
    ['writes each question for the owner', /`Why it matters`[\s\S]*`Needed before`[\s\S]*"Proposals not yet decided"/],
    ['writes the questions for the owner in English', /Write the question, `Why it matters`, the options and the recommendations in English\./],
    // The language of the command, of the sources or of a specialist's answer does not change the owner's.
    ['reports to the owner in English, whatever the language of the rest', /Write every report to the owner in English, whatever the language of the command, of the sources and of what the specialists return/],
    // An example under a question can be wrong: two orders of names that come out the same, under a question
    // about how to order them.
    ['works out every example of a question before the owner sees it', /Work out every example a question or an option gives[\s\S]*send back to the analyst a question whose example is wrong/],
    ['records the decisions sent from the board', /decisions\/<UTC time>\.md[\s\S]*"Sent at"/],
    ['never writes into decisions/', /Never create, change or delete a file in `decisions\/`/],
    ['takes an approval only from the reply\'s own words', /only if its own words say so/],
    ['passes a gate on APPROVE only for the same version', /APPROVE <documents>@<version>[\s\S]*--gate-version <runId> <gate>[\s\S]*prints the same version/],
    ['handles REQUEST CHANGES', /REQUEST CHANGES[\s\S]*leave the gate `NOT_RUN`/],
    ['takes no approval from the board in pull-request mode', /only the merge does/],
    ['stops at the next gate in an auto-run session', /auto-run[\s\S]*stop at the next human gate/],
    ['ends with the decision brief and the checks', /decision brief[\s\S]*"Check before you decide"/],
    // Past five only for a security-sensitive area, up to ten, so that points such as the length of a session or
    // the rules for a password are not approved as assumptions to stay under five.
    ['keeps at most five questions open before a gate, ten when those past five are security-sensitive, its own counted', /At most five questions needed before one gate are open at a time, and up to ten when each one past five is in a security-sensitive area[\s\S]*Write a question of your own[\s\S]*before you delegate `business-analyst`[\s\S]*send back a draft that would open more than that/],
    ['lists the assumptions when it asks for the business approval', /list the assumptions in the decision brief and say that approving the specification approves them/],
    // An approval card that names only the number of tasks does not tell the owner which decisions of the plan
    // they approve, those in a security-sensitive area among them.
    ['lists the decisions of the plan when it asks for the plan approval', /When you ask for the plan approval, list the decisions of the plan in the decision brief, those in a security-sensitive area first, and say that approving the plan approves them/],
    // An option such as "a zone you name, for example" and a zone, chosen with no zone named, would record the
    // zone of the example as the decision.
    ['sends back a question with an option that leaves its value to the owner', /Send back as well a question with an option that leaves its value to the owner[\s\S]*each option states the value the owner takes with it/],
    ['takes a reply only as far as its words go, and asks for a value it does not give', /A reply decides a question only as far as its words go[\s\S]*an example in the option is not the owner's choice\. Leave the question `OPEN` and ask for the value/],
  ],
  'Skills per task': [
    ['passes the Skills field with a task', /`Skills` field[\s\S]*pass that field with it/],
    ['delegates the stack-skill task first', /TASK-00 first/],
    ['copies the skills applied unchanged', /"Skills applied"[\s\S]*unchanged[\s\S]*returns without it/],
    ['never writes a quote itself', /Never write or mend a quote yourself/],
  ],
  'Model per task': [
    ['chooses the model from the Complexity field', /`Complexity` field/],
    ['sends back a task without a level, and never rates it', /send it back\. Do not rate it yourself/],
    ['knows what the validator rejects in a plan', /no `Complexity`, a level other than `low`, `standard` or `high`, or no reason/],
    ['does not add a Complexity line to get past the validator', /Do not add a `Complexity` line yourself to get past the validator/],
    ['records a separate tasks file', /artifactPaths\.tasks/],
    ['raises a level, never lowers one', /raise a level, never lower one/],
    ['raises a task on a security-sensitive area to high', /Raise to `high`[\s\S]*security-sensitive area/],
    ['moves a light run with a task raised to high, for whatever reason, to full', /On a light run, a task raised to `high` moves the run to the `full` track/],
    ['repairs one level up, at most twice', /one level up[\s\S]*two scoped repairs/],
    ['records a repair at the level it ran at, which moves a light run at high to full', /records the level it ran at\. On a light run, a repair that runs at `high` moves the run to the `full` track/],
    ['records every delegation when it happens', /"Model per task" table[\s\S]*at the time you delegate/],
    ['uses the highest level of several tasks', /highest `Complexity`/],
    ['records the whole suite as a verification row at standard', /The whole-suite delegation after the last task is the exception: write `all` under Task and `verification` under Step, and delegate it at `standard`/],
    ['knows a verification row is held to no task\'s level', /A `verification` row names no task and is held to no task's level/],
    ['writes CONFIRMED only when the tool showed the model', /`CONFIRMED` only if the tool showed/],
    ['knows every task needs a developer row before acceptance', /from `READY_FOR_ACCEPTANCE` on a task without a `developer` row/],
    ['never adds a row for a delegation that did not happen', /never add a row for a delegation that did not happen/],
  ],
  'Saving drafts': [
    ['persists what read-only specialists return', /read-only, so you persist their output/],
    ['saves an escape as written, not as the character it stands for', /Keep an escape such as `\\u0302` as the characters you read, the backslash included/],
    ['saves the specification and the plan in the run folder, and records them', /`sdlc\/runs\/<runId>\/feature-spec\.md`[\s\S]*`technical-plan\.md`[\s\S]*`artifactPaths\.spec` and `artifactPaths\.plan`/],
    // Where Spec Kit is installed, a run uses none of it: a session the board starts cannot write under specs/,
    // and a copy of the plan there would stand beside the approved one.
    ['uses no Spec Kit skill, script or folder in a run, whatever is installed', /also where Spec Kit is installed\. Do not call its skills \(`speckit-\*`\), run its scripts \(`\.specify\/scripts\/`\) or write under its `specs\/` folder during a run/],
    ['keeps every criterion with its AC id in a table', /`AC` id in a table with an `ID` column[\s\S]*rejects a specification with no `AC` id/],
    // A criterion is one behaviour: the values it holds for are its cases, in a table of their own, and the
    // validator warns above twelve criteria.
    ['keeps the cases of a criterion in their table', /Keep the cases of a criterion in their table as well, each with its id in the `Case` column/],
    ['sends a specification of more than twelve criteria back to the analyst once', /When the validator warns that the specification holds more than twelve criteria, send it back to the analyst once[\s\S]*where the count stays, say so in the decision brief/],
  ],
  'Must not do': [
    ['never passes a gate whose evidence is absent', /Never mark a gate PASSED when its required evidence is absent/],
    ['never fabricates', /Never fabricate/],
    ['never merges a pull request that stands for a human gate', /Never merge a pull request that stands for a human gate/],
    ['never merges or closes without approval', /merge or close tickets without explicit human and repository policy approval/],
    ['never pushes before the owner authorized it', /before the owner has authorized GitHub writes/],
    ['stops after two repairs, and only when more would be needed', /Never retry indefinitely\. At most two scoped repairs for one defect; then BLOCKED/],
    ['never claims background execution', /background asynchronous execution/],
  ],
  'Durable outputs': [
    ['keeps the clarification log', /clarification\.md` \(every question, the decision, who decided and when\)/],
    ['keeps the traceability', /BR→AC→Task→Test→PR/],
    ['takes every time from the clock', /date -u \+%Y-%m-%dT%H:%M:%SZ/],
    ['reports proven, unproven and blocked apart', /proven, unproven, blocked/],
    ['stays READY_FOR_ACCEPTANCE until DONE is justified', /READY_FOR_ACCEPTANCE until/],
    // A step a report promises, and no file of the run holds, is lost to the next session.
    ['leaves nothing for a later step in a report alone', /Leave nothing for a later step in a report alone: do it in this session, or write it under "Pending human actions" in the dossier[\s\S]*Never report that a later step will do something no file of the run holds/],
    // At `DONE` the ticket may still read "To do" and a product document list the delivered work as planned: the
    // report says so.
    ['says at DONE what still describes the delivery as work to come, and changes none of it', /When you report DONE, say whether the run's ticket and the product sources of `\.orchestra\/project\.md` still describe what the run delivered as work to come[\s\S]*Change none of them without the owner's word/],
  ],
};

// Rules that depend on the tool.
const ONLY = {
  [CLAUDE]: [
    ['delegates with the Agent tool, as the main session', /Agent tool[\s\S]*main session/],
    ['knows what a specialist starts with, and that it knows the run only from the delegation', /does not see this conversation[\s\S]*`CLAUDE\.md` loads for every session[\s\S]*of the run it knows only what you put in the delegation/],
    ['delegates in the foreground', /in the foreground/],
    ['knows what the hooks do and do not cover', /A hook blocks such edits made with the file tools, but not those made by a shell command[\s\S]*A hook runs the same validator after every edit of a run manifest made with the file tools, not after a shell write[\s\S]*A hook renders a run's board after each edit made with the file tools/],
    ['sets the model parameter', /`model` parameter of the Agent call/],
    ['never skips permissions', /--dangerously-skip-permissions/],
    ['reports a blocked command and does not reword it', /do not reword the command/],
    // A write of a stack skill under .claude/skills/ is denied in a session nobody watches, and an allow rule the
    // owner adds does not change that.
    ['knows that only the person in the session can allow a write under .claude/', /A write under `\.claude\/`, TASK-00's included, needs the approval of the person in the session: no permission rule allows it[\s\S]*do not tell the owner to add a permission rule for it/],
    // In auto mode, with nobody watching, the `ask` rules of the settings hold such a write as well.
    ['knows that the ask rules hold a write under .claude/ in auto mode too', /the `ask` rules of `\.claude\/settings\.json` hold it in every permission mode, auto mode included/],
  ],
  [COPILOT]: [
    ['delegates with native subagents', /native Copilot subagents[\s\S]*runSubagent/],
    ['uses the case-sensitive agent names', /case-sensitive/],
    // VS Code loads neither the rules for every agent nor the project profile into a specialist's session, so the
    // specialist's own file sends it to them.
    ['knows what a specialist starts with, and that it knows the run only from the delegation', /does not see this conversation\. It starts with its own file only: VS Code does not load `\.github\/instructions\/orchestra\.instructions\.md` or `\.orchestra\/project\.md` into a specialist's session, so each specialist's file tells it to read both first[\s\S]*of the run it knows only what you put in the delegation/],
    ['renders the board itself', /Render it after every change/],
    ['passes a model only where the tool takes one', /Look at the delegation tool you actually have[\s\S]*NOT_SELECTED/],
    // A rule of Copilot's own lets the Orchestrator set a model only when the user names it, so the implement
    // command names it.
    ['takes the implement command as the owner\'s word for the model of each task', /The owner names the model of each task in the implement command, by this table: where your tool lets you set a model only at the user's word, that is the word/],
    ['takes the verify command as the owner\'s word for the model of the whole suite and of a repair', /The verify command names the model of the whole-suite delegation and of each repair in the same way/],
    ['never passes --yolo', /--yolo/],
  ],
};

const sectionsOf = (body) => {
  const out = { '': '' };
  let current = '';
  for (const line of body.split('\n')) {
    const h = line.match(/^## (.+)$/);
    if (h) { current = h[1].trim(); out[current] = ''; } else out[current] += `${line}\n`;
  }
  return out;
};

for (const [layer, file] of [['the Claude Code layer', CLAUDE], ['the Copilot layer', COPILOT]]) {
  describe(`the Orchestrator's instructions in ${layer}`, () => {
    const sections = sectionsOf(text(file));
    for (const [section, rules] of Object.entries(RULES)) {
      it(`"${section}" keeps its ${rules.length} rules`, () => {
        assert.ok(section in sections, `the section "${section}" is gone`);
        for (const [rule, marker] of rules) assert.match(sections[section], marker, `"${section}" no longer says that the Orchestrator ${rule}`);
      });
    }
    it('keeps the rules that belong to its tool', () => {
      for (const [rule, marker] of ONLY[file]) assert.match(text(file), marker, `no longer says that the Orchestrator ${rule}`);
    });
  });
}

// Sections that say the same thing in both layers must say it in the same words, so that a change to one is a
// change to both. Role names and the skills folder are the only differences allowed.
describe('the sections the two layers share', () => {
  const SAME = ['Before starting', 'Approval mode', 'Track', 'Bug runs', 'Task by task', 'Test lock', 'Test calibration', 'Durable outputs'];
  const ROLES = [['business-analyst', 'Business Analyst'], ['ux-designer', 'UX Designer'], ['architect', 'Architect'], ['developer', 'Developer'], ['qa-engineer', 'QA Engineer'], ['code-reviewer', 'Code Reviewer']];
  const neutral = (s) => ROLES.reduce((acc, [slug, name]) => acc.replaceAll(`\`${slug}\``, `\`${name}\``), s).replaceAll('.claude/skills', '<skills>').replaceAll('.github/skills', '<skills>').trim();

  for (const section of SAME) {
    it(`"${section}" reads the same in both layers`, () => {
      assert.equal(neutral(sectionsOf(text(COPILOT))[section]), neutral(sectionsOf(text(CLAUDE))[section]));
    });
  }
});

// The kit writes for the owner in English only. The rule names the command's language because a report tends to
// follow the language of the command it answers.
describe('the language the owner reads', () => {
  const RULE_FILES = ['starter-claude-code/.claude/orchestra-rules.md', 'starter/.github/instructions/orchestra.instructions.md'];
  const COMMANDS = ['imperata-start', 'imperata-bug', 'imperata-plan', 'imperata-implement', 'imperata-verify', 'imperata-merge', 'imperata-close'];
  for (const rel of RULE_FILES) {
    it(`${rel} writes in English whatever language the command is written in, and names no other language`, () => {
      const rules = text(rel);
      assert.match(rules, /\*\*Language\.\*\* Write in English, whatever language the command and the owner's own words are in:/);
      assert.doesNotMatch(rules, /owner-facing language|Vietnamese/);
    });
  }
  for (const dir of ['starter-claude-code/.claude/skills', 'starter/.github/skills']) {
    it(`every command of a run in ${dir} asks for English`, () => {
      for (const name of COMMANDS) {
        assert.match(text(`${dir}/${name}/SKILL.md`), /Write what I read in English, whatever language this command and my words are in\./, `${name} does not ask for English`);
      }
    });
  }
  it('the project profile has no language to choose', () => {
    assert.doesNotMatch(text('starter/.orchestra/project.md'), /language/i);
  });
});

// Where the plan says a case behaves otherwise until a later task, a test of the first task that asserts the
// interim behaviour is locked, and the later task's Developer stops on it.
describe('the QA Engineer and behaviour a later task changes', () => {
  for (const rel of ['starter-claude-code/.claude/agents/qa-engineer.md', 'starter/.github/agents/qa-engineer.agent.md']) {
    it(`${rel} asserts nothing of a behaviour the plan calls interim`, () => {
      assert.match(text(rel), /Where the plan says a behaviour holds only until a later task, assert nothing of it[\s\S]{0,200}A locked test holds what the run delivers, and a later task must not have to change it\./);
    });
  }
});

// An unquoted `openBlockers=[]` stops in some shells, and the blocker stays. A diff saved before the dossier
// changes and is committed gives the reviewer the diff from before that commit. A quote missing from a
// Developer's list is the Developer's to add, at the task's level and with a row in "Model per task", not a
// lower model's.
describe('blockers, the review diff and the quotes of a task', () => {
  const layers = [
    { orchestrator: 'starter-claude-code/.claude/agents/sdlc-orchestrator.md', developer: 'starter-claude-code/.claude/agents/developer.md', dev: '`developer`' },
    { orchestrator: 'starter/.github/agents/sdlc-orchestrator.agent.md', developer: 'starter/.github/agents/developer.agent.md', dev: '`Developer`' },
  ];
  for (const { orchestrator, developer, dev } of layers) {
    it(`${orchestrator} empties openBlockers without quoting, in the call that records the decision`, () => {
      assert.match(text(orchestrator), /`--set openBlockers=`, with nothing after it, empties the list and needs no quoting\. When you record the decision a blocker waits for, clear that blocker in the same call\./);
    });
    it(`${orchestrator} saves the review diff after the last commit and names that commit`, () => {
      assert.match(text(orchestrator), /commit everything the review covers, the delivery dossier with it; then save the diff[\s\S]{0,160}change nothing more before the reviewer returns\. Give the reviewer that path, the commit the diff ends at/);
    });
    it(`${orchestrator} sends missing quotes back to the Developer at the task's level, with a row`, () => {
      const s = text(orchestrator);
      assert.ok(s.includes(`or without an entry for each file of its \`Skills\` field: to ${dev}, at the level the task ran at, as a delegation with its own row in "Model per task".`), 'the send-back names no agent, level or row');
      assert.match(s, /never ask another agent, or a lower model, for them alone\./);
    });
    it(`${developer} checks its list against the Skills field before returning`, () => {
      assert.match(text(developer), /Before you return, check that the list has an entry for every file of the `Skills` field\./);
    });
  }
});
