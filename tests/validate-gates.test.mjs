// SPDX-License-Identifier: MIT
// scripts/validate-gates.mjs: what it accepts, what it rejects and what it only warns about.
import { describe, it } from 'node:test';
import { chmodSync, symlinkSync, mkdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import assert from 'node:assert/strict';
import { tempDir, gitRepo, git, commitAll, write, read, node, run, script, kitRoot, sha256, expectExit, expectOutput } from './helpers.mjs';
import {
  makeRun, validate, check, accepted, rejected, warned, silentAbout,
  ALL_PASSED, notCovered, planOf, SPEC, TASKS, skillsTable, MODELS, SKILLS, SKILL_FILE, LOCKED_TEST, PRS, deliveryOf,
} from './run-fixture.mjs';

const validator = script('validate-gates.mjs');

describe('the manifest itself', () => {
  it('accepts the example manifest the kit ships', (t) => {
    const r = validate(tempDir(t), join(kitRoot, 'starter/.orchestra/runs/EXAMPLE.run.json'));
    accepted(r);
    expectOutput(r, /Manifest accepted for EXAMPLE in stage ANALYSIS/);
  });

  it('accepts a complete run in every stage', (t) => {
    for (const stage of ['ANALYSIS', 'READY_FOR_DESIGN_PLAN', 'IMPLEMENTING', 'FIX_REQUIRED', 'VERIFYING', 'REVIEWING', 'READY_FOR_ACCEPTANCE', 'DONE']) {
      accepted(check(tempDir(t), { stage }));
    }
  });

  it('exits 2 without a manifest, and on a file that is not JSON', (t) => {
    const root = tempDir(t);
    expectExit(node(root, validator), 2);
    write(root, 'run.json', '{ not json');
    const r = node(root, validator, 'run.json');
    expectExit(r, 2);
    expectOutput(r, /Cannot read JSON/);
  });

  // A manifest under sdlc/runs/ that names another run in runId would take that run's approvals and pull requests
  // as its own; and a runId with control characters would reach the person's terminal.
  it('rejects a run whose runId is not the name of its folder, or not a plain name', (t) => {
    const root = tempDir(t);
    const { manifest } = makeRun(root, {});
    const m = JSON.parse(read(root, manifest));
    write(root, 'sdlc/runs/R5/run.json', JSON.stringify(m, null, 2));
    rejected(validate(root, 'sdlc/runs/R5/run.json'), /runId R1 is not the name of the run's folder, R5/);
    write(root, manifest, JSON.stringify({ ...m, runId: 'R1\u001b]52;c;eA==\u0007' }, null, 2));
    rejected(validate(root, manifest), /runId .* is not a plain name/);
  });

  // Some editors write a byte-order mark before the manifest's JSON; and a record path or an artifact path that
  // names a folder is rejected, rather than stopping the validator with EISDIR.
  it('reads a manifest with a byte-order mark, and rejects a folder where a file is named', (t) => {
    const root = tempDir(t);
    const { R, manifest } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN' });
    write(root, manifest, `\uFEFF${read(root, manifest)}`);
    accepted(validate(root, manifest));
    const rec = { kind: 'local-record', by: 'owner', at: '2026-11-16T03:00:00Z', recordPath: `${R}/decisions` };
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: rec } }), /approvals\.businessApproval\.recordPath is not a file: sdlc\/runs\/R1\/decisions/);
    const { manifest: again } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN' });
    const m = JSON.parse(read(root, again));
    m.artifactPaths.spec = `${R}/decisions`;
    write(root, again, JSON.stringify(m, null, 2));
    rejected(validate(root, again), /artifact is not a file: sdlc\/runs\/R1\/decisions/);
  });

  it('rejects a manifest without a required property', (t) => {
    rejected(check(tempDir(t), { manifest: { owner: undefined } }), /missing property owner/);
  });

  it('rejects an unknown stage, approval mode, track and gate value', (t) => {
    const root = tempDir(t);
    rejected(check(root, { manifest: { currentStage: 'SHIPPED' } }), /invalid currentStage/);
    rejected(check(root, { manifest: { approvalMode: 'verbal' } }), /invalid approvalMode/);
    rejected(check(root, { manifest: { track: 'express' } }), /invalid track/);
    rejected(check(root, { gates: { review: 'OK' } }), /missing\/invalid gate review/);
    rejected(check(root, { manifest: { revision: -1 } }), /invalid revision/);
  });

  it('rejects a run that depends on itself', (t) => {
    rejected(check(tempDir(t), { manifest: { dependsOn: ['R1'] } }), /dependsOn names the run itself/);
  });
});

describe('what a stage requires', () => {
  it('rejects a stage whose gate has not passed', (t) => {
    const root = tempDir(t);
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN', gates: { businessApproval: 'NOT_RUN' } }), /businessApproval is NOT_RUN; it must be PASSED before stage READY_FOR_DESIGN_PLAN/);
    rejected(check(root, { stage: 'IMPLEMENTING', gates: { planApproval: 'NOT_RUN' } }), /planApproval is NOT_RUN/);
    rejected(check(root, { stage: 'REVIEWING', gates: { tests: 'FAILED' } }), /tests is FAILED/);
    rejected(check(root, { stage: 'READY_FOR_ACCEPTANCE', gates: { review: 'NOT_RUN' } }), /review is NOT_RUN/);
  });

  it('does not take WAIVED for PASSED on the full track', (t) => {
    rejected(check(tempDir(t), { stage: 'IMPLEMENTING', gates: { planApproval: 'WAIVED' } }), /planApproval is WAIVED; it must be PASSED/);
  });

  it('rejects a stage whose artifact is not named or not on disk', (t) => {
    const root = tempDir(t);
    rejected(check(root, { stage: 'IMPLEMENTING', artifactPaths: { plan: null } }), /required artifact path missing for stage IMPLEMENTING: plan/);
    rejected(check(root, { stage: 'REVIEWING', artifactPaths: { testReport: 'sdlc/runs/R1/nowhere.md' } }), /artifact not found on disk: sdlc\/runs\/R1\/nowhere\.md/);
  });

  it('rejects readiness for acceptance while a blocker is open', (t) => {
    rejected(check(tempDir(t), { stage: 'READY_FOR_ACCEPTANCE', manifest: { openBlockers: ['CI is red'] } }), /open blockers remain/);
  });

  it('rejects DONE without a verified merge, tracker state and pull request, in pull-request mode', (t) => {
    const r = check(tempDir(t), { stage: 'DONE', mode: 'pull-request', evidence: { prUrl: null, prMerged: false, trackerStatusVerified: false } });
    rejected(r, /PR merge not verified/);
    rejected(r, /tracker status not verified/);
    rejected(r, /actual PR URL missing/);
  });
});

describe('human gates', () => {
  it('rejects a passed human gate with no record of who approved', (t) => {
    rejected(check(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: null } }), /businessApproval is PASSED but approvals\.businessApproval holds no record/);
  });

  it('rejects a record without a name, a date or a known kind', (t) => {
    const root = tempDir(t);
    const rec = { kind: 'local-record', by: 'owner', at: '2026-11-16T03:00:00Z', recordPath: 'sdlc/runs/R1/decisions/owner.md' };
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: { ...rec, by: '' } } }), /approvals\.businessApproval\.by is missing/);
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: { ...rec, at: 'yesterday' } } }), /\.at is missing or not a date/);
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: { ...rec, kind: 'chat' } } }), /kind must be pull-request or local-record/);
  });

  it('accepts a local record that exists, with a warning that nothing outside confirms it', (t) => {
    const r = check(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN' });
    accepted(r);
    warned(r, /businessApproval rests on the owner's reply as the board server saved it \(sdlc\/runs\/R1\/decisions\/owner\.md\)/);
    expectOutput(r, /Approved versions: businessApproval feature-spec\.md@[0-9a-f]{12}; the documents are unchanged since/);
  });

  // A local record says what was approved: the line the board sends, for the version of the documents the owner
  // saw. That the file exists is not enough: a reply that asks for changes approves nothing, and the documents
  // behind a gate can change after the owner approved them.
  it('rejects a record that asks for changes, or that names no version', (t) => {
    const root = tempDir(t);
    const { R, manifest } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN' });
    write(root, `${R}/decisions/owner.md`, '# Reply\n\nbusinessApproval: REQUEST CHANGES feature-spec.md@0123456789ab — AC-03 is wrong\n');
    rejected(validate(root, manifest), /the record of businessApproval \(sdlc\/runs\/R1\/decisions\/owner\.md\) asks for changes and approves nothing/);
    write(root, `${R}/decisions/owner.md`, '# Reply\n\nApproved.\n');
    rejected(validate(root, manifest), /holds no "businessApproval: APPROVE <documents>@<version>" line/);
  });

  it('rejects documents changed after their approval, until the owner approves them again', (t) => {
    const root = tempDir(t);
    const { R, manifest } = makeRun(root, { stage: 'READY_FOR_ACCEPTANCE' });
    const reply = read(root, `${R}/decisions/owner.md`);
    write(root, `${R}/feature-spec.md`, read(root, `${R}/feature-spec.md`).replace('ten percent lower', 'twenty percent lower'));
    rejected(validate(root, manifest), /businessApproval was approved for feature-spec\.md@[0-9a-f]{12}, but its documents are now feature-spec\.md@[0-9a-f]{12}: they changed after the approval/);
    const now = node(root, script('render-run-board.mjs'), '--gate-version', 'R1', 'businessApproval').stdout.trim();
    write(root, `${R}/decisions/owner.md`, `${reply}businessApproval: APPROVE ${now}\n`);
    accepted(validate(root, manifest));
  });

  it('says when the record was written by the Orchestrator, and reads the line inside its text', (t) => {
    const root = tempDir(t);
    makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN' });
    const version = node(root, script('render-run-board.mjs'), '--gate-version', 'R1', 'businessApproval').stdout.trim();
    write(root, 'sdlc/runs/R1/clarification.md', `# Clarification log\n\n- E-4: the owner answered "Approve the specification". In the board's reply form: \`businessApproval: APPROVE ${version}\`.\n`);
    const r = check(root, { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: { kind: 'local-record', by: 'owner', at: '2026-11-16T03:00:00Z', recordPath: 'sdlc/runs/R1/clarification.md' } } });
    accepted(r);
    warned(r, /businessApproval rests on a record the Orchestrator wrote from the owner's words \(sdlc\/runs\/R1\/clarification\.md\)/);
    // A link in decisions/ to a file the Orchestrator wrote is not the owner's reply as the board saved it.
    if (process.platform !== 'win32') {
      mkdirSync(join(root, 'sdlc/runs/R1/decisions'), { recursive: true });
      symlinkSync(join(root, 'sdlc/runs/R1/clarification.md'), join(root, 'sdlc/runs/R1/decisions/linked.md'));
      const linked = check(root, { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: { kind: 'local-record', by: 'owner', at: '2026-11-16T03:00:00Z', recordPath: 'sdlc/runs/R1/decisions/linked.md' } } });
      silentAbout(linked, /as the board server saved it/);
    }
    // Nor is a path that only passes through decisions/.
    const via = check(root, { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: { kind: 'local-record', by: 'owner', at: '2026-11-16T03:00:00Z', recordPath: 'sdlc/runs/R1/decisions/../clarification.md' } } });
    warned(via, /businessApproval rests on a record the Orchestrator wrote from the owner's words/);
    silentAbout(via, /as the board server saved it/);
  });

  // The validator, the board and the test fixture compute the version of a gate's documents the same way, the
  // design brief included: a version the board shows is one the validator accepts.
  it('computes the version of a gate as the board does, with the design brief', (t) => {
    const root = tempDir(t);
    write(root, 'sdlc/runs/R1/design.md', '# Design brief\n\nOne screen.\n');
    const { R, manifest } = makeRun(root, { stage: 'READY_FOR_IMPLEMENTATION' });
    const board = node(root, script('render-run-board.mjs'), '--gate-version', 'R1', 'planApproval').stdout.trim();
    assert.match(board, /^technical-plan\.md\+design\.md@[0-9a-f]{12}$/);
    assert.ok(read(root, `${R}/decisions/owner.md`).includes(`planApproval: APPROVE ${board}`), 'the fixture approved another version than the board shows');
    accepted(validate(root, manifest));
  });

  it('rejects a local record whose file is missing, and one used in pull-request mode', (t) => {
    const root = tempDir(t);
    const rec = { kind: 'local-record', by: 'owner', at: '2026-11-16T03:00:00Z', recordPath: 'sdlc/runs/R1/decisions/none.md' };
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: rec } }), /recordPath not found on disk/);
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN', mode: 'pull-request', approvals: { businessApproval: { ...rec, recordPath: 'sdlc/runs/R1/decisions/owner.md' } } }), /is a local record, but approvalMode is pull-request/);
  });

  it('rejects a pull request approval without a pull request URL', (t) => {
    const rec = { kind: 'pull-request', by: 'owner', at: '2026-11-16T03:00:00Z', prUrl: 'https://github.com/acme/shop/issues/1' };
    rejected(check(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN', mode: 'pull-request', approvals: { businessApproval: rec } }), /prUrl is not a pull request URL/);
  });

  it('rejects two gates approved by one pull request, and an early gate approved by the delivery one', (t) => {
    const root = tempDir(t);
    const rec = (n) => ({ kind: 'pull-request', by: 'owner', at: '2026-11-16T03:00:00Z', prUrl: `https://github.com/acme/shop/pull/${n}` });
    rejected(check(root, { stage: 'IMPLEMENTING', mode: 'pull-request', approvals: { businessApproval: rec(1), planApproval: rec(1) } }), /two human gates name the same pull request/);
    rejected(check(root, { stage: 'IMPLEMENTING', mode: 'pull-request', approvals: { planApproval: rec(3) } }), /approvals\.planApproval names the delivery pull request/);
  });

  // A gate can be recorded as passed while a question needed before it is still OPEN in clarification.md: the
  // validator rejects that, not only the run board.
  it('rejects a passed gate while a question needed before it is still open', (t) => {
    const root = tempDir(t);
    const log = (decision, needed) => `# Clarification log — R1\n\n| ID | Question | Why it matters | Affects (BR / AC) | Security-sensitive area | Options and their consequences | Needed before | Decision | Decided by | Decided at | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| Q-01 | Which codes stack? | It sets the total. | AC-01 | no | (a) one; (b) two | ${needed} | ${decision} | owner |  |  |\n| Q-02 |  |  |  | no | (a) ; (b) |  | OPEN |  |  |  |\n`;
    makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN' });
    write(root, 'sdlc/runs/R1/clarification.md', log('OPEN', 'businessApproval'));
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN' }), /clarification\.md holds 1 question\(s\) still OPEN at a gate that has passed: Q-01 \(needed before businessApproval\)/);
    write(root, 'sdlc/runs/R1/clarification.md', log('OPEN — the owner is asking finance', 'Business approval'));
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN' }), /Q-01 \(needed before businessApproval\)/);
    write(root, 'sdlc/runs/R1/clarification.md', log('OPEN', 'humanAcceptance'));
    accepted(check(root, { stage: 'READY_FOR_DESIGN_PLAN' }));
    write(root, 'sdlc/runs/R1/clarification.md', log('(a) one code', 'businessApproval'));
    accepted(check(root, { stage: 'READY_FOR_DESIGN_PLAN' }));
  });

  // In local-record mode nothing asks GitHub, so a made-up pull request URL could pass every human gate of a DONE
  // run, with the owner's decisions folder empty.
  it('rejects a pull request approval in local-record mode', (t) => {
    const pr = (n) => ({ kind: 'pull-request', by: 'owner', at: '2026-11-16T03:00:00Z', prUrl: `https://example.com/nobody/nothing/pull/${n}` });
    const r = check(tempDir(t), { stage: 'DONE', approvals: { businessApproval: pr(1), planApproval: pr(2), humanAcceptance: pr(3) } });
    rejected(r, /approvals\.businessApproval is a pull request, but approvalMode is local-record/);
    rejected(r, /approvals\.humanAcceptance is a pull request, but approvalMode is local-record/);
  });

  // The owner's last word on a gate decides it: a REQUEST CHANGES written after the last APPROVE line of a record,
  // or a newer reply of the owner's that asks for changes while the manifest names an older one.
  it('takes the owner\'s last decision on a gate, in the record and in a later reply', (t) => {
    const root = tempDir(t);
    const { R, manifest } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN' });
    const reply = read(root, `${R}/decisions/owner.md`);
    const v = node(root, script('render-run-board.mjs'), '--gate-version', 'R1', 'businessApproval').stdout.trim();
    write(root, `${R}/decisions/owner.md`, `${reply}businessApproval: REQUEST CHANGES ${v} — AC-03 is wrong\n`);
    rejected(validate(root, manifest), /asks for changes after it approves: its last decision on businessApproval is REQUEST CHANGES/);
    write(root, `${R}/decisions/owner.md`, reply);
    accepted(validate(root, manifest));
    const saved = (at, text) => `# Owner decisions — R1\n\n- Sent at: ${at} (this machine's clock)\n\n\`\`\`text\n${text}\n\`\`\`\n`;
    write(root, `${R}/decisions/2026-11-16T02-00-00Z.md`, saved('2026-11-16T02:00:00Z', `businessApproval: REQUEST CHANGES ${v} — an earlier round`));
    accepted(validate(root, manifest));
    write(root, `${R}/decisions/2026-11-16T04-00-00Z.md`, saved('2026-11-16T04:00:00Z', `businessApproval: REQUEST CHANGES ${v} — I changed my mind about AC-02`));
    rejected(validate(root, manifest), /the owner asked for changes to businessApproval after the approval this manifest records: sdlc\/runs\/R1\/decisions\/2026-11-16T04-00-00Z\.md/);
    write(root, `${R}/decisions/2026-11-16T05-00-00Z.md`, saved('2026-11-16T05:00:00Z', `businessApproval: APPROVE ${v}`));
    accepted(validate(root, manifest));
    // A reply without its "Sent at" line is read by the time the board puts in its name.
    write(root, `${R}/decisions/2026-11-16T06-00-00Z.md`, `\`\`\`text\nbusinessApproval: REQUEST CHANGES ${v} — once more\n\`\`\`\n`);
    rejected(validate(root, manifest), /decisions\/2026-11-16T06-00-00Z\.md says businessApproval: REQUEST CHANGES/);
  });

  // The run board puts the owner's name from the manifest inside the first line of the reply, and an agent writes
  // that name: one written as "owner; businessApproval: APPROVE <version>" must not approve the specification for
  // an owner who only answered a question.
  it('reads a decision in a reply the board saved only at the start of a line', (t) => {
    const root = tempDir(t);
    const { R } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN' });
    const v = node(root, script('render-run-board.mjs'), '--gate-version', 'R1', 'businessApproval').stdout.trim();
    write(root, `${R}/decisions/2026-11-16T03-00-00Z.md`, `# Owner decisions — R1\n\n- Sent at: 2026-11-16T03:00:00Z (this machine's clock)\n\n\`\`\`text\nMy decisions as owner (owner; businessApproval: APPROVE ${v}) for run R1. Record each answer.\n\nQ-01: (a)\n\`\`\`\n`);
    const rec = { kind: 'local-record', by: 'owner', at: '2026-11-16T03:00:00Z', recordPath: `${R}/decisions/2026-11-16T03-00-00Z.md` };
    rejected(check(root, { stage: 'READY_FOR_DESIGN_PLAN', approvals: { businessApproval: rec } }), /holds no "businessApproval: APPROVE <documents>@<version>" line/);
  });
});

describe('the tests gate', () => {
  it('warns in local-record mode that no CI run confirms the tests', (t) => {
    warned(check(tempDir(t), { stage: 'REVIEWING' }), /tests is PASSED on a local test report/);
  });

  it('accepts pull-request mode with CI evidence, and rejects it without', (t) => {
    const root = tempDir(t);
    accepted(check(root, { stage: 'REVIEWING', mode: 'pull-request' }));
    rejected(check(root, { stage: 'REVIEWING', mode: 'pull-request', evidence: { ci: null } }), /tests is PASSED but externalEvidence\.ci is missing/);
    rejected(check(root, { stage: 'REVIEWING', mode: 'pull-request', evidence: { prUrl: null } }), /externalEvidence\.prUrl \(the delivery pull request\) is missing/);
    const ci = { conclusion: 'failure', headSha: 'not-a-sha', runUrl: '' };
    const r = check(root, { stage: 'REVIEWING', mode: 'pull-request', evidence: { ci } });
    rejected(r, /ci\.conclusion is failure; it must be success/);
    rejected(r, /ci\.headSha is missing or not a commit hash/);
    rejected(r, /ci\.runUrl is missing/);
  });
});

// A criterion whose input is a string in decomposed form is written with an escape. Saved as the combining marks
// themselves, it looks like the composed letters, and a later revision can hold the composed letter: the approved
// criterion then says "NFD" and holds NFC, and nobody can see either change.
describe('characters that cannot be seen', () => {
  const at = (spec) => `${SPEC}\n${spec}\n`;
  it('warns about a decomposed letter or a zero-width mark in a document the owner approves', (t) => {
    const nfd = check(tempDir(t), { spec: at('An example title: "Cre\u0300me bru\u0302le\u0301e".') });
    accepted(nfd);
    warned(nfd, /feature-spec\.md line \d+ holds characters that cannot be seen \(U\+0300, U\+0302, U\+0301\): what the owner reads is not all the file holds\. Write each as an escape such as \\u0302/);
    warned(check(tempDir(t), { spec: at('A title with a zero-width space: "Hello\u200Bworld".') }), /feature-spec\.md line \d+ holds characters that cannot be seen \(U\+200B\)/);
    warned(check(tempDir(t), { plan: `${planOf(TASKS)}\nRight-to-left mark: "a\u200Fb".\n` }), /technical-plan\.md line \d+ holds characters that cannot be seen \(U\+200F\)/);
  });

  it('says nothing of an escape, or of composed letters', (t) => {
    const r = check(tempDir(t), { spec: at('An example title: `"Cre\\u0300me bru\\u0302le\\u0301e"`, and "Crème brûlée" composed.') });
    accepted(r);
    silentAbout(r, /cannot be seen/);
  });
});

describe('the light track', () => {
  it('accepts a small light run without a plan approval', (t) => {
    const r = check(tempDir(t), { stage: 'IMPLEMENTING', track: 'light' });
    accepted(r);
    expectOutput(r, /Light track: the plan has no approval of its own/);
  });

  it('rejects a light run without the record of the owner agreeing', (t) => {
    const root = tempDir(t);
    rejected(check(root, { stage: 'IMPLEMENTING', track: 'light', manifest: { trackDecision: null } }), /track is light but trackDecision holds no record/);
    rejected(check(root, { stage: 'IMPLEMENTING', track: 'light', manifest: { trackDecision: { by: 'owner', at: '2026-11-16T02:00:00Z', reason: ' ' } } }), /trackDecision\.reason is missing/);
  });

  it('rejects a light run whose plan approval is not WAIVED, or holds a record', (t) => {
    const root = tempDir(t);
    rejected(check(root, { stage: 'IMPLEMENTING', track: 'light', gates: { planApproval: 'PASSED' } }), /on the light track it is WAIVED/);
    const rec = { kind: 'local-record', by: 'owner', at: '2026-11-16T03:00:00Z', recordPath: 'sdlc/runs/R1/decisions/owner.md' };
    rejected(check(root, { stage: 'IMPLEMENTING', track: 'light', approvals: { planApproval: rec } }), /the light track has no plan approval/);
  });

  it('rejects a light run with more than three tasks, or with a high task', (t) => {
    const root = tempDir(t);
    const four = ['TASK-01', 'TASK-02', 'TASK-03', 'TASK-04'].map((id) => ({ id }));
    rejected(check(root, { stage: 'IMPLEMENTING', track: 'light', tasks: four }), /the plan has 4 tasks; the light track allows 3/);
    rejected(check(root, { stage: 'IMPLEMENTING', track: 'light', tasks: [{ id: 'TASK-01', complexity: 'high — changes the permission check' }] }), /TASK-01 is high complexity; the light track allows none/);
  });

  // A TASK-00 writes the stack skill that every later run follows; on the light track nobody would approve its
  // conventions before code and tests are built on them.
  it('rejects a light run whose plan writes a stack skill (TASK-00), and accepts it on the full track', (t) => {
    const tasks = ['TASK-00', 'TASK-01', 'TASK-02'].map((id) => ({ id }));
    rejected(check(tempDir(t), { stage: 'IMPLEMENTING', track: 'light', tasks }), /TASK-00 writes a stack skill, whose conventions every later run follows; the light track allows none\. Set track to full and get the plan approved/);
    accepted(check(tempDir(t), { stage: 'IMPLEMENTING', tasks }));
  });

  // A run whose specification was approved on the full track does not move to light afterwards, with a later
  // trackDecision.at and the plan approval WAIVED.
  it('rejects an agreement to the light track dated after the business approval', (t) => {
    const late = { by: 'owner', at: '2026-11-16T04:00:00Z', reason: 'one small change in one module' };
    rejected(check(tempDir(t), { stage: 'IMPLEMENTING', track: 'light', manifest: { trackDecision: late } }), /trackDecision\.at \(2026-11-16T04:00:00Z\) is after the business approval \(2026-11-16T03:00:00Z\)/);
    accepted(check(tempDir(t), { stage: 'AWAITING_BUSINESS_DECISION', track: 'light', manifest: { trackDecision: late } }));
  });

  it('warns about a waived plan approval on the full track', (t) => {
    warned(check(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN', gates: { planApproval: 'WAIVED' } }), /planApproval is WAIVED on the full track/);
  });
});

describe('task complexity', () => {
  it('reports how many tasks carry a level', (t) => {
    expectOutput(check(tempDir(t), { stage: 'IMPLEMENTING' }), /Task complexity: 2 task\(s\)/);
  });

  it('rejects a task without the field, with an unknown level or without a reason', (t) => {
    const root = tempDir(t);
    rejected(check(root, { stage: 'IMPLEMENTING', tasks: [{ id: 'TASK-01', complexity: null }] }), /TASK-01 has no Complexity field/);
    rejected(check(root, { stage: 'IMPLEMENTING', tasks: [{ id: 'TASK-01', complexity: 'medium — a guess' }] }), /TASK-01 Complexity is "medium — a guess"/);
    rejected(check(root, { stage: 'IMPLEMENTING', tasks: [{ id: 'TASK-01', complexity: 'low' }] }), /Complexity low has no reason/);
    rejected(check(root, { stage: 'IMPLEMENTING', tasks: [{ id: 'TASK-01', complexity: 'low — <one-line reason>' }] }), /Complexity low has no reason/);
  });

  it('rejects a task that appears twice', (t) => {
    rejected(check(tempDir(t), { stage: 'IMPLEMENTING', tasks: [{ id: 'TASK-01' }, { id: 'TASK-01' }] }), /TASK-01 appears more than once/);
  });

  it('rejects a plan without task sections once the stage needs the plan, and warns before', (t) => {
    const root = tempDir(t);
    rejected(check(root, { stage: 'IMPLEMENTING', plan: '# Plan\n\nWe will see.\n' }), /no task section found/);
    const early = check(root, { stage: 'READY_FOR_DESIGN_PLAN', plan: '# Plan\n\nWe will see.\n' });
    accepted(early);
    warned(early, /no task section found.*does not require tasks yet/);
  });

  it('ignores a task heading inside a code fence', (t) => {
    const plan = `${planOf([{ id: 'TASK-01' }])}\n\`\`\`md\n### TASK-99 — an example in the template\n\`\`\`\n`;
    const r = check(tempDir(t), { stage: 'IMPLEMENTING', plan, models: [MODELS[0]], skills: [SKILLS[0]] });
    accepted(r);
    expectOutput(r, /Task complexity: 1 task\(s\)/);
  });
});

describe('the "Model per task" table', () => {
  it('rejects a row with an unknown step, level or confirmation, or without a model', (t) => {
    const root = tempDir(t);
    const row = (over) => [Object.assign([...MODELS[0]], over), MODELS[1]];
    rejected(check(root, { models: row({ 1: 'coder' }) }), /row 1 step is "coder"; use developer, qa, repair or verification/);
    rejected(check(root, { models: row({ 2: 'medium' }) }), /row 1 complexity is "medium"/);
    rejected(check(root, { models: row({ 3: '' }) }), /row 1 has no model requested/);
    rejected(check(root, { models: row({ 4: 'YES' }) }), /row 1 confirmed is "YES"/);
    rejected(check(root, { models: row({ 0: 'the first one' }) }), /row 1 names no task/);
  });

  it('rejects a task the plan does not have, and a level below the plan', (t) => {
    const root = tempDir(t);
    rejected(check(root, { models: [...MODELS, ['TASK-07', 'developer', 'low', 'haiku', 'NOT_CONFIRMED']] }), /names TASK-07, which is not a task of the plan/);
    const tasks = [{ id: 'TASK-01', complexity: 'high — changes the permission check' }, { id: 'TASK-02' }];
    rejected(check(root, { tasks }), /ran TASK-01 at low, below the plan's high/);
  });

  it('requires the table and a developer row for every task only once the dossier is due', (t) => {
    const root = tempDir(t);
    const early = check(root, { stage: 'REVIEWING', models: null });
    accepted(early);
    warned(early, /has no "Model per task" table/);
    rejected(check(root, { stage: 'READY_FOR_ACCEPTANCE', models: null }), /has no "Model per task" table/);
    rejected(check(root, { stage: 'READY_FOR_ACCEPTANCE', models: [MODELS[0]] }), /no developer row for TASK-02/);
  });

  it('warns about unconfirmed models, unselected ones and a model weaker than the level', (t) => {
    const root = tempDir(t);
    warned(check(root, {}), /2 of 2 delegation\(s\) record a requested model that no tool output confirmed/);
    warned(check(root, { models: [['TASK-01', 'developer', 'low', 'NOT_SELECTED', 'NOT_CONFIRMED'], MODELS[1]] }), /1 delegation\(s\) ran without a model chosen/);
    const tasks = [{ id: 'TASK-01', complexity: 'high — changes the permission check' }, { id: 'TASK-02' }];
    warned(check(root, { tasks, models: [['TASK-01', 'developer', 'high', 'haiku', 'CONFIRMED'], MODELS[1]] }), /haiku looks weaker than the high level/);
  });

  // The whole suite after the last task is not a delegation over every task at the highest of their levels, which
  // would make it the dearest delegation of a run. It is a row of its own, which names no task and runs at
  // standard whatever the tasks' levels.
  it('takes a row for the whole suite, which names no task and is held to no task\'s level', (t) => {
    const root = tempDir(t);
    const tasks = [{ id: 'TASK-01', complexity: 'high — changes the permission check' }, { id: 'TASK-02' }];
    const built = [['TASK-01', 'developer', 'high', 'opus', 'NOT_CONFIRMED'], ['TASK-01', 'qa', 'high', 'opus', 'NOT_CONFIRMED'], MODELS[1]];
    const whole = ['all', 'verification', 'standard', 'sonnet', 'NOT_CONFIRMED'];
    const r = check(root, { stage: 'READY_FOR_ACCEPTANCE', tasks, models: [...built, whole] });
    accepted(r);
    expectOutput(r, /Model per task: 4 delegation row\(s\)/);
    rejected(check(root, { stage: 'READY_FOR_ACCEPTANCE', tasks, models: [...built, ['TASK-01, TASK-02', 'qa', 'standard', 'sonnet', 'NOT_CONFIRMED']] }), /ran TASK-01 at standard, below the plan's high/);
    rejected(check(root, { stage: 'READY_FOR_ACCEPTANCE', tasks, models: [...built, ['all', 'qa', 'standard', 'sonnet', 'NOT_CONFIRMED']] }), /row 4 names no task/);
  });
});

// A decision of the plan may quote a usage line with a "|" in it. Every script ends a cell there, so the row has
// six cells for five columns, its "Alternatives rejected" is read as its "Security-sensitive area", and the
// approval card tells the owner that the plan holds a decision in such an area.
describe('a table row whose cells do not match its columns', () => {
  const decisions = (cell) => `${planOf(TASKS)}
## Decisions

| ID | Decision | Alternatives rejected | Security-sensitive area | Needs approval from |
| --- | --- | --- | --- | --- |
| ADR-01 | The usage line reads ${cell} | Another place | no | Owner |
`;

  it('warns, names the row, and says how to write the character', (t) => {
    const r = check(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN', plan: decisions('`apply <code|none>`') });
    accepted(r);
    warned(r, /technical-plan\.md: 1 table row\(s\) do not have as many cells as their table has columns: "ADR-01" under "Decisions" \(6 cells for 5 columns\)/);
    warned(r, /A "\|" inside a cell ends the cell, also inside a code span: write it as "\\\|"/);
  });

  it('says nothing of a row that writes the character with a backslash, or of a document without such a row', (t) => {
    const root = tempDir(t);
    silentAbout(check(root, { stage: 'READY_FOR_DESIGN_PLAN', plan: decisions('`apply <code\\|none>`') }), /table row\(s\)/);
    silentAbout(check(root, { stage: 'READY_FOR_ACCEPTANCE' }), /table row\(s\)/);
  });

  it('reads the specification and the clarification log as well', (t) => {
    const root = tempDir(t);
    const spec = SPEC.replace('the total is unchanged', 'it prints `usage: apply <code|none>`');
    warned(check(root, { spec }), /feature-spec\.md: 1 table row\(s\) do not have as many cells as their table has columns: "AC-02" under "Acceptance criteria" \(6 cells for 5 columns\)/);
    const made = makeRun(root, {});
    write(root, 'sdlc/runs/R1/clarification.md', '# Clarification log\n\n| ID | Question | Decision |\n| --- | --- | --- |\n| Q-01 | `a|b` or neither | a |\n');
    warned(validate(root, made.manifest), /clarification\.md: 1 table row\(s\) do not have as many cells as their table has columns: "Q-01"/);
  });
});

// A specification can multiply its criteria: the line a command prints and its exit code as two of them, or each
// refused value of one argument as one. A criterion is one behaviour, and the values it holds for are its cases:
// the rows AC-NN.M of a table whose first column is "Case".
describe('the cases of a criterion', () => {
  const CASES = `${SPEC}
### Cases of AC-03

| Case | Code | Expected |
| --- | --- | --- |
| AC-03.1 | expired yesterday | rejected with EXPIRED |
| AC-03.2 | expired a year ago | rejected with EXPIRED |
| AC-03.3 | expires today | accepted |
`;
  const two = [['T-01', 'AC-01', 'PASSED'], ['T-02', 'AC-02', 'PASSED']];

  it('accepts a run whose tests name every case, one by one or in a range, and counts the cases', (t) => {
    const root = tempDir(t);
    const r = check(root, { spec: CASES, rows: [...two, ['T-03', 'AC-03.1..AC-03.3', 'PASSED']] });
    accepted(r);
    expectOutput(r, /Acceptance criteria: 3 of 3 have a test that passed in [^,]*, with 3 of their 3 cases/);
    accepted(check(root, { spec: CASES, rows: [...two, ['T-03', 'AC-03.1, AC-03.2', 'PASSED'], ['T-04', 'AC-03.3', 'PASSED']] }));
  });

  it('rejects a test that names the criterion alone, and says how to name the cases', (t) => {
    const r = check(tempDir(t), { spec: CASES });
    rejected(r, /3 acceptance criteria or cases of [^ ]* have no test in [^:]*: AC-03\.1, AC-03\.2[^.]*AC-03\.3/);
    rejected(r, /A test that names a criterion with cases covers none of them: name the cases in the AC column, one \(AC-03\.2\) or a range \(AC-03\.1\.\.AC-03\.4\)/);
  });

  it('rejects a case without a test, and a case whose test failed or did not pass', (t) => {
    const root = tempDir(t);
    rejected(check(root, { spec: CASES, rows: [...two, ['T-03', 'AC-03.1, AC-03.3', 'PASSED']] }), /1 acceptance criterion or case of [^ ]* has no test in [^:]*: AC-03\.2\./);
    rejected(check(root, { spec: CASES, rows: [...two, ['T-03', 'AC-03.1..AC-03.2', 'PASSED'], ['T-04', 'AC-03.3', 'FAILED']] }), /records a FAILED test for AC-03\.3 \(T-04\)/);
    rejected(check(root, { spec: CASES, rows: [...two, ['T-03', 'AC-03.1..AC-03.2', 'PASSED'], ['T-04', 'AC-03.3', 'NOT_RUN']] }), /no test passed in [^ ]* for AC-03\.3 \(T-04 NOT_RUN\)/);
  });

  it('takes a gap the owner accepted for one case, or for the criterion and so for all its cases', (t) => {
    const root = tempDir(t);
    const one = check(root, { spec: CASES, rows: [...two, ['T-03', 'AC-03.1, AC-03.3', 'PASSED']], testPlan: notCovered([['AC-03.2', 'no clock a year back in the test environment', 'owner (decisions/owner.md)']]) });
    accepted(one);
    warned(one, /1 acceptance criterion or case has no test, by an accepted gap: AC-03\.2 \(owner/);
    accepted(check(root, { spec: CASES, rows: two, testPlan: notCovered([['AC-03', 'the codes cannot be made to expire in a test', 'owner (decisions/owner.md)']]) }));
    rejected(check(root, { spec: CASES, rows: two, testPlan: notCovered([['AC-03', 'the codes cannot be made to expire in a test', '']]) }), /under "Not covered" without saying who accepted the gap/);
  });

  // A FAILED row that names a criterion with cases counts in the verdict, and a table of cases with another
  // heading, or a cell that goes on after the id, is read: otherwise a test naming the criterion would pass it.
  it('rejects a failed test that names a criterion with cases, although every case passed', (t) => {
    rejected(check(tempDir(t), { spec: CASES, rows: [...two, ['T-03', 'AC-03.1..AC-03.3', 'PASSED'], ['T-04', 'AC-03', 'FAILED']] }), /records a FAILED test for AC-03 \(T-04\)/);
  });

  it('reads a case by the id its first cell begins with, whatever the column is called', (t) => {
    const root = tempDir(t);
    const other = CASES.replace('| Case | Code | Expected |', '| Case ID | Code | Expected |').replace('| AC-03.1 |', '| AC-03.1 (yesterday) |').replace('| AC-03.2 |', '| `AC-03.02` |');
    rejected(check(root, { spec: other }), /3 acceptance criteria or cases of [^ ]* have no test in [^:]*: AC-03\.1, AC-03\.2[^.]*AC-03\.3/);
    accepted(check(root, { spec: other, rows: [...two, ['T-03', 'AC-03.1..AC-03.3', 'PASSED']] }));
  });

  it('warns about a row of a table of cases that is not read as a case', (t) => {
    const root = tempDir(t);
    const short = CASES.replace('| AC-03.1 |', '| .1 |').replace('| AC-03.2 |', '| case 2 |');
    const r = check(root, { spec: short, rows: [...two, ['T-03', 'AC-03.3', 'PASSED']] });
    accepted(r);
    warned(r, /feature-spec\.md: 2 row\(s\) of a table of cases are not read as cases: "\.1" under "Cases of AC-03", "case 2" under "Cases of AC-03"\. The first cell of a case begins with its id/);
    silentAbout(check(root, { spec: CASES, rows: [...two, ['T-03', 'AC-03.1..AC-03.3', 'PASSED']] }), /are not read as cases/);
  });

  it('counts a gap of a criterion with cases as one criterion left without a test', (t) => {
    const r = check(tempDir(t), { spec: CASES, rows: two, testPlan: notCovered([['AC-03', 'the codes cannot be made to expire in a test', 'owner (decisions/owner.md)']]) });
    accepted(r);
    expectOutput(r, /Acceptance criteria: 2 of 3 have a test that passed in [^,]*, with 0 of their 3 cases, 1 left without a test by an accepted gap/);
  });

  it('warns about cases of a criterion that the specification does not list', (t) => {
    const spec = `${CASES}
### Cases of AC-09

| Case | Code | Expected |
| --- | --- | --- |
| AC-09.1 | none | nothing |
`;
    const r = check(tempDir(t), { spec, rows: [...two, ['T-03', 'AC-03.1..AC-03.3', 'PASSED']] });
    accepted(r);
    warned(r, /gives cases for AC-09, which is no criterion of its tables/);
  });
});

describe('a specification with many criteria', () => {
  const specOf = (n) => `# Feature specification

## Acceptance criteria

| ID | Given | When | Then | Business rules |
| --- | --- | --- | --- | --- |
${Array.from({ length: n }, (_, i) => `| AC-${String(i + 1).padStart(2, '0')} | a basket | code ${i + 1} is applied | the total changes | BR-01 |`).join('\n')}
`;

  it('warns above twelve, before the business approval, and says what a case is', (t) => {
    const r = check(tempDir(t), { stage: 'ANALYSIS', spec: specOf(13) });
    accepted(r);
    warned(r, /feature-spec\.md holds 13 acceptance criteria\. A criterion is one behaviour, and the values it holds for are its cases, in a "Cases of AC-NN" table/);
  });

  it('says nothing of twelve criteria, of cases however many, or of a specification that is approved', (t) => {
    const root = tempDir(t);
    silentAbout(check(root, { stage: 'ANALYSIS', spec: specOf(12) }), /acceptance criteria\. A criterion is one behaviour/);
    const cases = `${specOf(3)}
### Cases of AC-03

| Case | Code | Expected |
| --- | --- | --- |
${Array.from({ length: 20 }, (_, i) => `| AC-03.${i + 1} | code ${i + 1} | rejected |`).join('\n')}
`;
    silentAbout(check(root, { stage: 'ANALYSIS', spec: cases }), /acceptance criteria\. A criterion is one behaviour/);
    silentAbout(check(root, { stage: 'READY_FOR_DESIGN_PLAN', spec: specOf(13) }), /acceptance criteria\. A criterion is one behaviour/);
  });

  it('counts the ids the text names where the specification has no table of criteria', (t) => {
    const prose = `# Feature specification\n\n${Array.from({ length: 13 }, (_, i) => `- AC-${String(i + 1).padStart(2, '0')}: code ${i + 1} changes the total.`).join('\n')}\n`;
    warned(check(tempDir(t), { stage: 'ANALYSIS', spec: prose }), /feature-spec\.md holds 13 acceptance criteria/);
  });
});

// An Orchestrator that estimates or rounds a time can write a full minute that has not come yet, although it read
// the clock shortly before. The rule is "never estimate or round one".
describe('a time ahead of the clock', () => {
  it('warns about a time in the manifest that has not come yet, and names it', (t) => {
    const r = check(tempDir(t), { manifest: { updatedAt: '2999-01-01T00:00:00Z' } });
    accepted(r);
    warned(r, /updatedAt \(2999-01-01T00:00:00Z\) is ahead of this machine's clock/);
    warned(r, /take every time from "date -u \+%Y-%m-%dT%H:%M:%SZ" at the moment you write it/);
  });

  it('reads the time of an approval too, and says nothing of a time that has passed', (t) => {
    const root = tempDir(t);
    const at = new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 19) + 'Z';
    warned(check(root, { approvals: { planApproval: { kind: 'local-record', by: 'owner', at, recordPath: 'sdlc/runs/R1/decisions/owner.md' } } }), /approvals\.planApproval\.at \(.*\) is ahead of this machine's clock/);
    silentAbout(check(root, {}), /ahead of this machine's clock/);
  });
});

// Implementation does not go on from task to task without a report or a question: the Orchestrator stops after
// each task and records the owner's word before the next. The validator warns where the dossier does not show
// that word; it rejects nothing, since a dossier may have no such table and only the owner knows what they
// checked.
describe('the "Checked by the owner" table', () => {
  const said = (id) => [id, '4f2c1ab', '"go on"', '2026-11-16T04:00:00Z'];
  const waits = (id) => [id, '4f2c1ab', '', ''];
  const UNCHECKED = /"Checked by the owner" holds no word of the owner's for/;

  it('is silent when every task that was followed has the owner\'s word, and says how many have it', (t) => {
    const root = tempDir(t);
    const r = check(root, {});
    accepted(r);
    silentAbout(r, /Checked by the owner/);
    expectOutput(r, /Checked by the owner: 2 of 2 task\(s\) delegated to the Developer carry the owner's word/);
  });

  it('warns about a task that another task followed without the owner\'s word', (t) => {
    const root = tempDir(t);
    const r = check(root, { stage: 'IMPLEMENTING', checks: [waits('TASK-01')] });
    accepted(r);
    warned(r, /holds no word of the owner's for TASK-01, and the run went on after it/);
    const none = check(root, { stage: 'IMPLEMENTING', checks: [] });
    accepted(none);
    warned(none, /holds no word of the owner's for TASK-01,/);
  });

  it('lets the task built last wait for the owner while the run is being implemented, and no longer', (t) => {
    const root = tempDir(t);
    const checks = [said('TASK-01'), waits('TASK-02')];
    const during = check(root, { stage: 'IMPLEMENTING', checks });
    accepted(during);
    silentAbout(during, UNCHECKED);
    expectOutput(during, /Checked by the owner: 1 of 2 task\(s\)/);
    for (const stage of ['VERIFYING', 'REVIEWING', 'READY_FOR_ACCEPTANCE']) {
      const after = check(root, { stage, checks });
      accepted(after);
      warned(after, /holds no word of the owner's for TASK-02, and the run went on after it/);
    }
  });

  it('warns, and rejects nothing, when the dossier of a run has no such table', (t) => {
    const root = tempDir(t);
    const r = check(root, { stage: 'READY_FOR_ACCEPTANCE', checks: null });
    accepted(r);
    warned(r, /has no "Checked by the owner" table.*nothing shows that the owner checked TASK-01, TASK-02 before the run went on/);
  });

  it('says nothing before a task is delegated, about a single task in progress, or of a run that is over', (t) => {
    const root = tempDir(t);
    silentAbout(check(root, { stage: 'READY_FOR_IMPLEMENTATION', models: null }), /Checked by the owner/);
    silentAbout(check(root, { stage: 'IMPLEMENTING', models: [MODELS[0]], checks: null }), /Checked by the owner/);
    silentAbout(check(root, { stage: 'DONE', checks: null }), /Checked by the owner/);
  });

  it('takes one row that names several tasks as the owner\'s word for each', (t) => {
    const root = tempDir(t);
    const r = check(root, { checks: [['TASK-01, TASK-02', '4f2c1ab', '"do both, then stop"', '2026-11-16T04:00:00Z']] });
    accepted(r);
    silentAbout(r, UNCHECKED);
  });
});

// The reviewer reads the dossier: a Gates table that reads NOT_RUN for gates the manifest holds as PASSED, or an
// empty "Proven, unproven, blocked", turns the review's findings to the dossier.
describe('the dossier at the review', () => {
  const gatesTable = (results) => `\n## Gates\n\n| Gate | Result | Evidence |\n| --- | --- | --- |\n${Object.entries(results).map(([gate, result]) => `| ${gate} | ${result} | ${result ? 'evidence' : ''} |`).join('\n')}\n`;
  const AT_REVIEW = { 'Business approval': 'PASSED', 'Plan approval': '`PASSED`', Implementation: 'PASSED', Tests: 'PASSED', Review: '', 'Human acceptance': 'NOT_RUN' };
  const proven = (a = '', b = '', c = '') => `\n## Proven, unproven, blocked\n\nProven is what evidence shows that could have shown the opposite.\n\n- Proven (with evidence):${a}\n- Unproven (not run, tool unavailable):${b}\n- Blocked:${c}\n\n## Pending human actions\n\n- Owner: accept or refuse the delivery.\n`;
  const FILLED = proven(' the suite passed five times of five.', ' no CI run.', ' none.');
  const dossier = (results, rest = FILLED) => `${deliveryOf()}${gatesTable(results)}${rest}`;
  const DIFFERS = /the Gates table of [^ ]*delivery\.md reads/;
  const EMPTY = /"Proven, unproven, blocked" of [^ ]*delivery\.md is not filled in/;

  it('is silent when the table reads what the manifest holds, an empty cell standing for NOT_RUN', (t) => {
    const root = tempDir(t);
    const r = check(root, { delivery: dossier(AT_REVIEW) });
    accepted(r);
    silentAbout(r, DIFFERS);
    silentAbout(r, EMPTY);
    // A dossier without the table is not read.
    silentAbout(check(root, {}), DIFFERS);
  });

  it('warns about a gate the table reads otherwise than the manifest holds it', (t) => {
    const root = tempDir(t);
    const stale = check(root, { delivery: dossier({ ...AT_REVIEW, Tests: 'NOT_RUN' }) });
    accepted(stale);
    warned(stale, /the Gates table of [^ ]*delivery\.md reads NOT_RUN for Tests, where the manifest holds PASSED\. The reviewer and the owner read the dossier: bring the table up to date before the review\. Whether either is true was not checked/);
    warned(check(root, { delivery: dossier({ ...AT_REVIEW, Implementation: '', Tests: 'see the report' }) }), /reads nothing for Implementation, where the manifest holds PASSED; "see the report" for Tests, where the manifest holds PASSED/);
    // A light run: the plan approval is WAIVED in the manifest, and the table says so.
    silentAbout(check(root, { track: 'light', delivery: dossier({ ...AT_REVIEW, 'Plan approval': 'WAIVED, agreed by the owner' }) }), DIFFERS);
    warned(check(root, { track: 'light', delivery: dossier(AT_REVIEW) }), /reads PASSED for Plan approval, where the manifest holds WAIVED/);
  });

  it('leaves the row of the acceptance alone, and reads the table from the review to the acceptance only', (t) => {
    const root = tempDir(t);
    // The owner approves the dossier with "Human acceptance" at NOT_RUN, and it cannot change afterwards.
    silentAbout(check(root, { stage: 'READY_FOR_ACCEPTANCE', delivery: dossier({ ...AT_REVIEW, Review: 'PASSED' }) }), DIFFERS);
    warned(check(root, { stage: 'READY_FOR_ACCEPTANCE', delivery: dossier(AT_REVIEW) }), /reads nothing for Review, where the manifest holds PASSED/);
    silentAbout(check(root, { stage: 'VERIFYING', delivery: dossier({ ...AT_REVIEW, Implementation: 'NOT_RUN' }) }), DIFFERS);
    silentAbout(check(root, { stage: 'DONE', delivery: dossier({ ...AT_REVIEW, Tests: 'NOT_RUN' }, proven()) }), /Gates table|is not filled in/);
  });

  it('warns about "Proven, unproven, blocked" with nothing filled in, and no longer once one line is', (t) => {
    const root = tempDir(t);
    const r = check(root, { delivery: dossier(AT_REVIEW, proven()) });
    accepted(r);
    warned(r, /"Proven, unproven, blocked" of [^ ]*delivery\.md is not filled in\. The reviewer and the owner read it: fill it in before the review/);
    silentAbout(check(root, { delivery: dossier(AT_REVIEW, proven('', ' no CI run.')) }), EMPTY);
    silentAbout(check(root, { delivery: dossier(AT_REVIEW, proven('\n  - the suite passed.')) }), EMPTY);
    silentAbout(check(root, { stage: 'IMPLEMENTING', delivery: dossier(AT_REVIEW, proven()) }), EMPTY);
  });
});

// A row under "Not covered" may name no criterion, as one that says the tests were not run on the code before the
// fix: no check reads it, and a run could be DONE with it open.
describe('a row under "Not covered" that no check reads', () => {
  const UNREAD = /under "Not covered" that name no criterion, case, decision or test, and that nobody accepted/;
  const METHOD = 'Mutation check of the fix, on the code before TASK-01';

  it('warns about a row that names nothing a check reads and that nobody accepted', (t) => {
    const root = tempDir(t);
    const r = check(root, { testPlan: notCovered([[METHOD, 'QA may not edit the code', '']]) });
    accepted(r);
    warned(r, /test-plan\.md lists 1 row\(s\) under "Not covered" that name no criterion, case, decision or test, and that nobody accepted: "Mutation check of the fix, on the code before TASK-01"\. No check reads such a row\..*what the calibration shows is none: have the QA Engineer take the row out, or write who accepted it/);
    warned(check(root, { stage: 'IMPLEMENTING', testPlan: notCovered([[METHOD, 'QA may not edit the code', '<owner>']]) }), UNREAD);
  });

  it('is silent about a risk the owner accepted, a row that names what a check reads, and a run that is DONE', (t) => {
    const root = tempDir(t);
    silentAbout(check(root, { testPlan: notCovered([['Load above 1,000 requests a second', 'no tool for it', 'owner (decisions/owner.md)']]) }), UNREAD);
    silentAbout(check(root, { testPlan: notCovered([['AC-03', 'needs a clock', 'owner (decisions/owner.md)']]) }), UNREAD);
    // A Test ID of the report, and a decision of the plan: the checks of mandatory tests and of decisions read them.
    silentAbout(check(root, { testPlan: notCovered([['T-02', 'fails one run in ten', '']]) }), UNREAD);
    const plan = `${planOf(TASKS)}\n## Decisions\n\n| ID | Decision | Alternatives rejected | Security-sensitive area | Needs approval from |\n| --- | --- | --- | --- | --- |\n| ADR-01 | Codes are compared without case | Exact match | no | Owner |\n`;
    silentAbout(check(root, { plan, testPlan: notCovered([['ADR-01', 'no test can tell', '']]) }), UNREAD);
    silentAbout(check(root, { stage: 'DONE', testPlan: notCovered([[METHOD, 'QA may not edit the code', '']]) }), UNREAD);
  });
});

describe('the test lock', () => {
  it('rejects review and acceptance without a lock, and accepts earlier stages', (t) => {
    const root = tempDir(t);
    rejected(check(root, { stage: 'REVIEWING', lock: null }), /artifactPaths\.testLock is missing; before stage REVIEWING/);
    rejected(check(root, { stage: 'READY_FOR_ACCEPTANCE', lock: null }), /artifactPaths\.testLock is missing/);
    accepted(check(root, { stage: 'VERIFYING', lock: null }));
  });

  it('rejects a locked test that changed or is gone, in repair, review and acceptance', (t) => {
    for (const stage of ['FIX_REQUIRED', 'REVIEWING', 'READY_FOR_ACCEPTANCE']) {
      const root = tempDir(t);
      const { manifest } = makeRun(root, { stage });
      write(root, LOCKED_TEST, '// weakened\n');
      rejected(validate(root, manifest), /test files changed after the QA step that locked them.*tests\/price\.test\.js \(changed\)/);
    }
    const root = tempDir(t);
    const lock = { runId: 'R1', recordedAt: '2026-11-16T05:00:00Z', files: { 'tests/gone.test.js': 'ab'.repeat(32) }, skipMarkers: [] };
    rejected(check(root, { lock }), /tests\/gone\.test\.js \(deleted\)/);
  });

  it('does not compare the lock once the run is done', (t) => {
    const root = tempDir(t);
    const { manifest } = makeRun(root, { stage: 'DONE' });
    write(root, LOCKED_TEST, '// changed by a later run\n');
    accepted(validate(root, manifest));
  });

  it('rejects a lock recorded for another run, and one without files', (t) => {
    const root = tempDir(t);
    rejected(check(root, { lock: { runId: 'R7', recordedAt: '2026-11-16T05:00:00Z', files: {}, skipMarkers: [] } }), /was recorded for run R7, not R1/);
    rejected(check(root, { lock: { runId: 'R1' } }), /has no "files" object/);
  });

  // A lock that holds no file, beside a test report with passed tests, is more than a warning at REVIEWING, and it
  // does not keep back the warning that the tests were not calibrated.
  it('warns about skip markers, and rejects a lock that holds no file beside passed tests', (t) => {
    const root = tempDir(t);
    const files = { [LOCKED_TEST]: null };
    makeRun(root, {});
    files[LOCKED_TEST] = sha256(root, LOCKED_TEST);
    warned(check(root, { lock: { runId: 'R1', recordedAt: '2026-11-16T05:00:00Z', files, skipMarkers: [LOCKED_TEST] } }), /1 locked test file\(s\) carry a skip, only or ignore marker/);
    const empty = { runId: 'R1', recordedAt: '2026-11-16T05:00:00Z', files: {}, skipMarkers: [] };
    rejected(check(root, { lock: empty }), /locks no test file, but sdlc\/runs\/R1\/test-report\.md records passed tests/);
    // Every criterion an accepted gap: no test passed, and a lock with no file is a warning.
    const gaps = notCovered([['AC-01', 'manual only', 'owner, clarification.md'], ['AC-02', 'manual only', 'owner, clarification.md'], ['AC-03', 'manual only', 'owner, clarification.md']]);
    const none = check(root, { lock: empty, rows: [], testPlan: gaps, artifactPaths: { testPlan: 'sdlc/runs/R1/test-plan.md' } });
    accepted(none);
    warned(none, /locks no test file/);
  });
});

describe('the test calibration', () => {
  // A calibration as scripts/lock-tests.mjs writes it, for the one locked file of the fixture.
  // The whole suite ran five times on the lock the fixture records (--suite), and passed each time.
  const SUITE = { command: 'node --test', exits: [0, 0, 0, 0, 0], lockRecordedAt: '2026-11-16T05:00:00Z', at: '2026-11-16T05:10:00Z' };
  const calibration = (root, result, over = {}, suites = [SUITE]) => {
    makeRun(root, {});
    return { runId: 'R1', calibratedAt: '2026-11-16T05:10:00Z', files: { [LOCKED_TEST]: { sha256: sha256(root, LOCKED_TEST), result, command: `node ${LOCKED_TEST}`, exitHere: 0, exitOnBase: 1, base: 'c0ffee', control: 'tests/other.test.js', at: '2026-11-16T05:10:00Z', ...over } }, ...(suites ? { suites } : {}) };
  };

  it('warns in review when the tests were not calibrated', (t) => {
    const r = check(tempDir(t), {});
    accepted(r);
    warned(r, /the run's tests were not calibrated/);
    expectOutput(r, /Whether the tests are good was not checked/);
  });

  it('accepts a file that passes with the change and fails without it', (t) => {
    const root = tempDir(t);
    const r = check(root, { calibration: calibration(root, 'DEPENDS_ON_CHANGE') });
    accepted(r);
    expectOutput(r, /Test calibration: 1 of 1 locked test file\(s\) pass with the run's change and fail without it/);
    silentAbout(r, /calibrat/);
  });

  it('rejects review and acceptance while a file passes without the change, and warns before', (t) => {
    const root = tempDir(t);
    const cal = calibration(root, 'PASSES_WITHOUT_CHANGE', { exitOnBase: 0 });
    rejected(check(root, { stage: 'REVIEWING', calibration: cal }), /1 locked test file\(s\) pass without the run's change, so they do not test it: tests\/price\.test\.js/);
    rejected(check(root, { stage: 'READY_FOR_ACCEPTANCE', calibration: cal }), /pass without the run's change/);
    const early = check(root, { stage: 'VERIFYING', calibration: cal });
    accepted(early);
    warned(early, /pass without the run's change/);
  });

  it('accepts a declared guard and shows it as a warning', (t) => {
    const root = tempDir(t);
    const r = check(root, { calibration: calibration(root, 'GUARD', { exitOnBase: 0 }) });
    accepted(r);
    warned(r, /1 locked test file\(s\) are declared to pass without the run's change/);
  });

  it('counts a result only for the content the lock holds', (t) => {
    const root = tempDir(t);
    const r = check(root, { calibration: calibration(root, 'PASSES_WITHOUT_CHANGE', { sha256: 'ab'.repeat(32) }) });
    accepted(r);
    warned(r, /1 locked test file\(s\) changed after they were calibrated/);
    warned(r, /holds no result for the locked test files as they are now/);
  });

  // A repository with no application code before the run: every file fails on the base by its import, and the
  // calibration does not show that the tests check the change.
  it('does not count a file as tested against the change when the calibration ran without a control', (t) => {
    const root = tempDir(t);
    const r = check(root, { calibration: calibration(root, 'DEPENDS_ON_CHANGE', { control: null }) });
    accepted(r);
    warned(r, /1 locked test file\(s\) fail on the base, but the calibration ran without a control.*does not have the code yet fails every test.*report it under "Unproven", not "Proven"/);
    expectOutput(r, /Test calibration: 0 of 1 locked test file\(s\) pass with the run's change and fail without it, 1 fail on a base where no control passed, which does not show that they test the change/);
  });

  // A manifest written straight to DONE is held to every check of review and acceptance, the calibration among
  // them: a locked test that passes without the change is not accepted at DONE.
  it('rejects a calibration written for another run, and holds a DONE run to it as in review', (t) => {
    const root = tempDir(t);
    const cal = calibration(root, 'PASSES_WITHOUT_CHANGE', { exitOnBase: 0 });
    rejected(check(root, { calibration: { ...cal, runId: 'R7' } }), /was written for run R7, not R1/);
    rejected(check(root, { stage: 'DONE', calibration: cal }), /pass without the run's change, so they do not test it/);
    accepted(check(root, { stage: 'DONE', calibration: calibration(root, 'DEPENDS_ON_CHANGE') }));
  });

  // A test that sends a body over the size limit to an id that does not exist can fail now and then with
  // ECONNRESET: the service answers before the client has sent the whole body. QA, the test lock and a
  // calibration that runs each file once can all pass it. Run five times with --suite, a suite like that one
  // fails in some runs.
  it('rejects review and acceptance while the whole suite failed in some of its runs, and warns before', (t) => {
    const root = tempDir(t);
    const cal = calibration(root, 'DEPENDS_ON_CHANGE', {}, [{ ...SUITE, exits: [0, 1, 0, 0, 0], failedOutputTail: 'not ok 3 - an oversized body to a missing id\nError: write ECONNRESET' }]);
    for (const stage of ['REVIEWING', 'READY_FOR_ACCEPTANCE']) {
      rejected(check(root, { stage, calibration: cal }), /the tests do not give the same verdict every time: on the same code the whole suite failed in 1 of 5 run\(s\) \("node --test"/);
    }
    const early = check(root, { stage: 'VERIFYING', calibration: cal });
    accepted(early);
    warned(early, /do not give the same verdict every time/);
  });

  it('warns in review when the whole suite was not run more than once, or only before the lock was last recorded', (t) => {
    const root = tempDir(t);
    const once = check(root, { calibration: calibration(root, 'DEPENDS_ON_CHANGE', {}, null) });
    accepted(once);
    warned(once, /the whole suite was not run more than once: nothing shows that the tests give the same verdict every time/);
    const before = check(root, { calibration: calibration(root, 'DEPENDS_ON_CHANGE', {}, [{ ...SUITE, exits: [0, 1, 0], lockRecordedAt: '2026-11-15T05:00:00Z' }]) });
    accepted(before);
    warned(before, /run several times only before the test lock was last recorded/);
  });

  it('says how many runs of the whole suite passed, and what that cannot show', (t) => {
    const root = tempDir(t);
    const r = check(root, { calibration: calibration(root, 'DEPENDS_ON_CHANGE', {}, [SUITE, { ...SUITE, command: 'npx playwright test', exits: [0, 0, 0] }]) });
    accepted(r);
    expectOutput(r, /The whole suite passed in each of 8 run\(s\) on the locked tests; a failure rarer than that can still be there/);
  });
});

describe('acceptance criteria and their tests', () => {
  it('accepts a run in which every criterion has a passed test', (t) => {
    const r = check(tempDir(t), {});
    accepted(r);
    expectOutput(r, /Acceptance criteria: 3 of 3 have a test that passed/);
  });

  // The specification's ids and the test report's are read alike, whatever their case, so a criterion written
  // ac-01 counts as tested by a test of AC-01.
  it('reads the prefix of an id whatever its case, in the specification and in the test report', (t) => {
    const lower = SPEC.replace(/\| AC-0/g, '| ac-0');
    accepted(check(tempDir(t), { spec: lower }));
    accepted(check(tempDir(t), { spec: lower, rows: [['T-01', 'ac-01', 'PASSED'], ['T-02', 'Ac-02', 'PASSED'], ['T-03', 'AC-03', 'PASSED']] }));
    rejected(check(tempDir(t), { spec: lower, rows: ALL_PASSED.slice(0, 2) }), /has no test in .*: AC-03/);
  });

  it('rejects a criterion without a test and without a test plan', (t) => {
    rejected(check(tempDir(t), { rows: ALL_PASSED.slice(0, 2) }), /1 acceptance criterion of .* has no test in .*: AC-03\..*named in artifactPaths\.testPlan/);
  });

  it('rejects a gap nobody accepted, and accepts one the owner accepted as a warning', (t) => {
    const root = tempDir(t);
    const rows = ALL_PASSED.slice(0, 2);
    rejected(check(root, { rows, testPlan: notCovered([['AC-03', 'needs a clock the stack cannot fake', '']]) }), /lists AC-03 under "Not covered" without saying who accepted the gap/);
    rejected(check(root, { rows, testPlan: notCovered([['AC-03', 'needs a clock', '<owner>']]) }), /without saying who accepted the gap/);
    const r = check(root, { rows, testPlan: notCovered([['AC-03', 'needs a clock', 'owner, decisions/owner.md']]) });
    accepted(r);
    warned(r, /1 acceptance criterion has no test, by an accepted gap: AC-03 \(owner, decisions\/owner\.md\)/);
    expectOutput(r, /2 of 3 have a test that passed.*1 left without a test by an accepted gap/);
  });

  it('reads the test plan the manifest names, and rejects a named plan that is missing', (t) => {
    const root = tempDir(t);
    write(root, 'docs/qa/plan.md', notCovered([['AC-03', 'needs a clock', 'owner']]));
    accepted(check(root, { rows: ALL_PASSED.slice(0, 2), artifactPaths: { testPlan: 'docs/qa/plan.md' } }));
    rejected(check(root, { artifactPaths: { testPlan: 'sdlc/runs/R1/nope.md' } }), /artifact not found on disk: sdlc\/runs\/R1\/nope\.md/);
  });

  it('rejects a failed test under a passed tests gate, and a criterion whose tests did not pass', (t) => {
    const root = tempDir(t);
    rejected(check(root, { rows: [ALL_PASSED[0], ['T-02', 'AC-02', 'FAILED'], ALL_PASSED[2]] }), /tests is PASSED, but .* records a FAILED test for AC-02 \(T-02\)/);
    rejected(check(root, { rows: [ALL_PASSED[0], ['T-02', 'AC-02', 'NOT_RUN'], ALL_PASSED[2]] }), /no test passed in .* for AC-02 \(T-02 NOT_RUN\)/);
  });

  it('counts one test for every criterion it names', (t) => {
    const r = check(tempDir(t), { rows: [['T-01', 'AC-01, AC-02', 'PASSED'], ALL_PASSED[2]] });
    accepted(r);
    expectOutput(r, /3 of 3 have a test that passed/);
  });

  it('rejects a test report without a Results table', (t) => {
    rejected(check(tempDir(t), { report: '# Test report\n\nEverything passed.\n' }), /has no Results table with "Test ID", "AC" and "Result" columns/);
  });

  it('falls back to the ids in the text of a specification without an ID table', (t) => {
    const spec = '# Specification\n\n- AC-01: ten percent off\n- AC-02: an unknown code changes nothing\n';
    rejected(check(tempDir(t), { spec, rows: ALL_PASSED.slice(0, 1) }), /has no test in .*: AC-02/);
  });

  it('rejects a specification that names no criterion', (t) => {
    rejected(check(tempDir(t), { spec: '# Specification\n\nThe basket gets a discount.\n' }), /no AC id found/);
  });

  it('rejects a specification in the shape of Spec Kit, whose requirements are FR and SC ids', (t) => {
    const spec = [
      '# Feature Specification: Discount codes', '',
      '### Functional Requirements', '',
      '- **FR-001**: System MUST take ten percent off for the code TEN',
      '- **FR-002**: System MUST leave the total unchanged for an unknown code', '',
      '## Success Criteria', '',
      '- **SC-001**: A customer applies a code in one step', '',
    ].join('\n');
    rejected(check(tempDir(t), { spec, rows: [['T-01', 'FR-001', 'PASSED']] }), /no AC id found .*"ID" column of a table/);
  });

  it('does not ask for AC ids before review', (t) => {
    silentAbout(check(tempDir(t), { stage: 'IMPLEMENTING', spec: '# Specification\n\nThe basket gets a discount.\n' }), /no AC id found/);
  });

  it('warns about a criterion the report names and the specification does not have', (t) => {
    warned(check(tempDir(t), { rows: [...ALL_PASSED, ['T-09', 'AC-09', 'PASSED']] }), /names AC-09, which .* does not list as an acceptance criterion/);
  });

  it('does not judge the criteria before review', (t) => {
    const r = check(tempDir(t), { stage: 'VERIFYING', rows: ALL_PASSED.slice(0, 1) });
    accepted(r);
    silentAbout(r, /acceptance criteri/);
  });
});

describe('the "Skills applied" table', () => {
  it('finds a quote despite bold text, a code span, a line wrap and curly quotes', (t) => {
    const root = tempDir(t);
    const r = check(root, { stage: 'READY_FOR_ACCEPTANCE' });
    accepted(r);
    expectOutput(r, /Skills applied: 3 row\(s\) in .*, 1 of them none; every quoted rule is in the skill file it names/);
    accepted(check(root, { skills: [['TASK-01', SKILL_FILE, '“Every form” field has a visible label', '`src/form.js`'], SKILLS[2]] }));
  });

  it('rejects a quote that is not in the file', (t) => {
    const skills = [['TASK-01', `\`${SKILL_FILE}\``, 'Server state lives in Redux and nowhere else', '`src/api.js`'], SKILLS[2]];
    rejected(check(tempDir(t), { skills }), /row 1 quotes "Server state lives in Redux and nowhere else", which is not in \.claude\/skills\/web\/SKILL\.md/);
  });

  // The delivery dossier holds every quote, so a row that names the dossier as its skill file would find any rule
  // it invents there. A row names a file the task's Skills field names.
  it('rejects a skill file that the task\'s Skills field does not name', (t) => {
    const skills = [['TASK-01', '`sdlc/runs/R1/delivery.md`', 'Every price is rounded to the nearest ten', '`src/price.js`'], SKILLS[2]];
    rejected(check(tempDir(t), { skills }), /row 1 names sdlc\/runs\/R1\/delivery\.md, which the Skills field of TASK-01 in the plan does not name \(web\)/);
    // A reference inside the skill folder, and a product document with its anchor, are named by the field.
    const root = tempDir(t);
    write(root, '.claude/skills/web/references/api.md', '# API\n\nEvery request carries the session cookie.\n');
    write(root, 'docs/rules.md', '# Rules\n\n## Refunds\n\nA refund never exceeds the amount paid.\n');
    const plan = planOf([{ id: 'TASK-01' }, { id: 'TASK-02' }]).replace('  - core: `web`\n', '  - core: `web`\n  - references: `web/references/api.md`\n  - product: `docs/rules.md#refunds`\n');
    const more = [...SKILLS, ['TASK-01', '`.claude/skills/web/references/api.md`', 'Every request carries the session cookie.', '`src/api.js`'], ['TASK-01', '`docs/rules.md#refunds`', 'A refund never exceeds the amount paid.', '`src/refund.js`']];
    accepted(check(root, { plan, skills: more }));
  });

  it('rejects a skill file that is missing or outside the repository', (t) => {
    const root = tempDir(t);
    const row = (file) => [['TASK-01', file, 'Prices are integers in minor units', '`src/a.js`']];
    rejected(check(root, { skills: row('`.claude/skills/api/SKILL.md`') }), /names \.claude\/skills\/api\/SKILL\.md, which is not a file in this repository/);
    rejected(check(root, { skills: row('../../etc/hosts') }), /which is not a file in this repository/);
    rejected(check(root, { skills: row('/etc/hosts') }), /which is not a file in this repository/);
  });

  it('rejects a task the plan does not have, a quote too short and an empty "Where"', (t) => {
    const root = tempDir(t);
    rejected(check(root, { skills: [['TASK-07', SKILL_FILE, 'Prices are integers in minor units', '`src/a.js`']] }), /names TASK-07, which is not a task of the plan/);
    rejected(check(root, { skills: [['TASK-01', SKILL_FILE, 'Prices are', '`src/a.js`']] }), /quotes "Prices are", too short/);
    rejected(check(root, { skills: [['TASK-01', SKILL_FILE, 'Prices are integers in minor units', '']] }), /says nothing under "Where"/);
    rejected(check(root, { skills: [['TASK-01', SKILL_FILE, '', '`src/a.js`']] }), /quotes no rule/);
    rejected(check(root, { skills: [['TASK-01', '', 'Prices are integers in minor units', '`src/a.js`']] }), /names no skill file/);
  });

  it('rejects a table without one of its columns', (t) => {
    const skills = skillsTable([['TASK-01', SKILL_FILE, '`src/a.js`']], '| Task | Skill file | Where |');
    rejected(check(tempDir(t), { skills }), /the "Skills applied" table lacks column\(s\): rule/);
  });

  it('only warns about a missing table, an empty one or a task without a row, and only once the dossier is due', (t) => {
    const root = tempDir(t);
    const none = check(root, { stage: 'READY_FOR_ACCEPTANCE', skills: null });
    accepted(none);
    warned(none, /has no "Skills applied" table/);
    warned(check(root, { stage: 'READY_FOR_ACCEPTANCE', skills: [['', '', '', '']] }), /the "Skills applied" table has no row/);
    warned(check(root, { stage: 'READY_FOR_ACCEPTANCE', skills: SKILLS.slice(0, 2) }), /"Skills applied" has no row for TASK-02/);
    silentAbout(check(root, { stage: 'REVIEWING', skills: null }), /Skills applied/);
  });

  it('does not read the table once the run is done, when a skill file may have changed', (t) => {
    const skills = [['TASK-01', SKILL_FILE, 'Server state lives in Redux and nowhere else', '`src/api.js`']];
    accepted(check(tempDir(t), { stage: 'DONE', skills }));
  });
});

// --verify-remote asks GitHub through the gh CLI. Here a stand-in named gh answers from a file, so the
// logic is tested without a network: which pull request is merged, by whom, and what its checks say.
describe('--verify-remote, against a stand-in for gh', { skip: process.platform === 'win32' ? 'the stand-in is a script with a shebang' : false }, () => {
  // HEAD_SHA stands for the tested commit, which the repository of each test makes: the head of the delivery pull
  // request and the commit the CI run ran on.
  const merged = (by = 'owner', author = 'imperata-bot') => ({ state: 'MERGED', mergedAt: '2026-11-16T03:00:00Z', mergedBy: { login: by }, author: { login: author }, headRefOid: 'HEAD_SHA', baseRefName: 'main', statusCheckRollup: [] });
  const open = (checks, headRefOid = 'HEAD_SHA') => ({ state: 'OPEN', mergedAt: null, mergedBy: null, author: { login: 'imperata-bot' }, headRefOid, baseRefName: 'main', statusCheckRollup: checks });
  const ciRun = (over = {}) => ({ headSha: 'HEAD_SHA', conclusion: 'success', status: 'completed', url: 'https://github.com/acme/shop/actions/runs/1', ...over });
  const GREEN = [{ name: 'build-and-test', conclusion: 'SUCCESS' }, { name: 'Imperata gates', conclusion: 'SUCCESS' }];

  // A repository whose tested commit is its head, a run in review in pull-request mode, and gh answering `answers`.
  function remote(t, answers, { after, flags = [], runUrl = 'https://github.com/acme/shop/actions/runs/1' } = {}) {
    const root = gitRepo(t);
    git(root, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git');
    write(root, 'src/app.js', 'export const total = 1;\n');
    // The fixture's files outside the run folder belong to the tested commit; the manifest is written after it.
    makeRun(root, { stage: 'REVIEWING', mode: 'pull-request' });
    const headSha = commitAll(root, 'feature and tests');
    const { manifest } = makeRun(root, { stage: 'REVIEWING', mode: 'pull-request', evidence: { ci: { conclusion: 'success', headSha, runUrl } } });
    let later = null;
    if (after) { after(root); later = commitAll(root, 'after the tested commit'); }
    // Each gate's pull request merges the run's branch for that gate, unless a test says otherwise.
    const heads = { [PRS.businessApproval]: 'sdlc/R1/spec', [PRS.planApproval]: 'sdlc/R1/plan', [PRS.humanAcceptance]: 'sdlc/R1/delivery' };
    for (const [url, head] of Object.entries(heads)) if (answers[url] && !('headRefName' in answers[url])) answers[url] = { ...answers[url], headRefName: head };
    const bin = tempDir(t);
    write(bin, 'answers.json', JSON.stringify(answers).replaceAll('HEAD_SHA', headSha).replaceAll('LATER_SHA', later || headSha));
    // gh pr view <url> answers from answers[<url>]; gh run view <id> -R <repo> from answers['run:<repo>/<id>'].
    write(bin, 'gh', `#!/usr/bin/env node
const answers = JSON.parse(require('node:fs').readFileSync(process.env.GH_STUB, 'utf8'));
const [, , noun, verb, ref, flag, repo] = process.argv;
const key = noun === 'run' && verb === 'view' && flag === '-R' ? 'run:' + repo + '/' + ref : noun === 'pr' && verb === 'view' ? ref : null;
if (!key || !answers[key]) { console.error('not found: ' + noun + ' ' + ref); process.exit(1); }
console.log(JSON.stringify(answers[key]));
`);
    chmodSync(join(bin, 'gh'), 0o755);
    const r = run(process.execPath, [validator, manifest, '--verify-remote', ...flags], { cwd: root, env: { PATH: `${bin}${delimiter}${process.env.PATH}`, GH_STUB: join(bin, 'answers.json') } });
    const lines = r.out.split(/\r?\n/);
    return { ...r, problems: lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2)), warnings: lines.filter((l) => l.startsWith('WARNING: ')).map((l) => l.slice(9)) };
  }
  const answers = (over = {}) => ({ [PRS.businessApproval]: merged(), [PRS.planApproval]: merged(), [PRS.humanAcceptance]: open(GREEN), 'run:acme/shop/1': ciRun(), ...over });

  it('accepts merges and checks that agree with the manifest', (t) => {
    const r = remote(t, answers());
    accepted(r);
    expectOutput(r, /Remote verification: 3 pull request lookup\(s\) and 1 CI run lookup\(s\) against GitHub agreed with the manifest/);
  });

  // Whether a pull request was merged, and by whom, is not enough: any the owner merged, in any repository, would
  // pass a gate. It has to belong to this repository and merge the run's branch for that gate.
  it('rejects an approval whose pull request is of another repository or merges another branch', (t) => {
    const other = 'https://github.com/someone-else/old-project/pull/7';
    const r = remote(t, { ...answers(), [other]: merged() }, { after: (root) => {
      const m = JSON.parse(read(root, 'sdlc/runs/R1/run.json'));
      m.approvals.businessApproval.prUrl = other;
      write(root, 'sdlc/runs/R1/run.json', JSON.stringify(m, null, 2));
    } });
    rejected(r, /businessApproval: .*old-project\/pull\/7 is a pull request of github\.com\/someone-else\/old-project, not of this repository \(github\.com\/acme\/shop\)/);
    rejected(remote(t, answers({ [PRS.planApproval]: { ...merged(), headRefName: 'main' } })), /planApproval: .*\/pull\/2 merges main, not sdlc\/R1\/plan/);
  });

  // The repository is compared with its host: a pull request on a server of someone else's, with the same owner
  // and name, is not of this repository. Nor does a commit status with the required check's name stand in for it.
  it('rejects a pull request on another host, and a status that only bears the required check\'s name', (t) => {
    const elsewhere = 'https://git.example.invalid/acme/shop/pull/1';
    const r = remote(t, { ...answers(), [elsewhere]: { ...merged(), headRefName: 'sdlc/R1/spec' } }, { after: (root) => {
      const m = JSON.parse(read(root, 'sdlc/runs/R1/run.json'));
      m.approvals.businessApproval.prUrl = elsewhere;
      write(root, 'sdlc/runs/R1/run.json', JSON.stringify(m, null, 2));
    } });
    rejected(r, /businessApproval: .*\/pull\/1 is a pull request of git\.example\.invalid\/acme\/shop, not of this repository \(github\.com\/acme\/shop\)/);
    const status = [{ context: 'Build and test', state: 'SUCCESS' }, { name: 'Imperata gates', conclusion: 'SUCCESS' }];
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open(status) }), { flags: ['--require-check', 'Build and test'] }), /the required CI check "Build and test" is not on the delivery pull request/);
  });

  it('rejects an approval whose pull request is not merged, or was merged by someone else', (t) => {
    rejected(remote(t, answers({ [PRS.businessApproval]: open([]) })), /businessApproval: .*\/pull\/1 is OPEN, not MERGED/);
    rejected(remote(t, answers({ [PRS.planApproval]: merged('someone-else') })), /planApproval: manifest says approved by owner, GitHub says merged by someone-else/);
  });

  it('warns when a pull request was merged by its own author', (t) => {
    warned(remote(t, answers({ [PRS.businessApproval]: merged('owner', 'owner') })), /was merged by its own author \(owner\)/);
  });

  it('rejects a failing CI check, and a delivery pull request without checks', (t) => {
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open([GREEN[0], { name: 'Imperata gates', conclusion: 'FAILURE' }]) })), /CI check "Imperata gates" is FAILURE/);
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open([]) })), /the delivery pull request has no CI checks/);
  });

  // The job that runs this script on the pull request is one of the pull request's own checks, and it has
  // not finished while it asks. --ignore-check leaves that one check out, by name, and no other.
  it('leaves out the check named with --ignore-check, and only that one', (t) => {
    const own = { name: 'Imperata gates', status: 'IN_PROGRESS', conclusion: '' };
    const skipOwn = { flags: ['--ignore-check', 'Imperata gates'] };
    const running = answers({ [PRS.humanAcceptance]: open([GREEN[0], own]) });
    rejected(remote(t, running), /CI check "Imperata gates" is IN_PROGRESS/);
    accepted(remote(t, running, skipOwn));
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open([{ name: 'build-and-test', conclusion: 'FAILURE' }, own]) }), skipOwn), /CI check "build-and-test" is FAILURE/);
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open([own]) }), skipOwn), /the delivery pull request has no CI checks/);
  });

  it('accepts changes in the run folder after the tested commit, and rejects any other', (t) => {
    accepted(remote(t, answers(), { after: (root) => write(root, 'sdlc/runs/R1/delivery-note.md', 'note\n') }));
    rejected(remote(t, answers(), { after: (root) => write(root, 'src/app.js', 'export const total = 2;\n') }), /files outside sdlc\/runs\/R1\/ changed after the tested commit .*: src\/app\.js/);
  });

  // git reads the move of a file of the application into the run folder as a rename and shows only its new path,
  // inside the folder, so the delivered code could differ from the tested code unseen; and it prints a name outside
  // ASCII quoted, which reads as a file outside the run folder.
  it('sees a file moved into the run folder after the tested commit, and reads a name outside ASCII as it is', (t) => {
    const moved = { after: (root) => run('git', ['mv', 'src/app.js', 'sdlc/runs/R1/app.js'], { cwd: root }) };
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open(GREEN, 'LATER_SHA') }), moved), /the delivery pull request changes files outside sdlc\/runs\/R1\/ after the tested commit .*: src\/app\.js/);
    const named = { after: (root) => write(root, 'sdlc/runs/R1/evidence/kết-quả.log', 'ok\n') };
    accepted(remote(t, answers({ [PRS.humanAcceptance]: open(GREEN, 'LATER_SHA') }), named));
  });

  // A gate's pull request merged into a side branch, or into the branch of another gate, does not approve the gate:
  // the validator asks which branch it merged into.
  it('rejects a pull request merged into a branch of a run, or into another branch than the run\'s others', (t) => {
    rejected(remote(t, answers({ [PRS.planApproval]: { ...merged(), baseRefName: 'sdlc/R1/spec' } })), /planApproval: .*\/pull\/2 merges into sdlc\/R1\/spec, a branch of a run, not the main branch/);
    rejected(remote(t, answers({ [PRS.businessApproval]: { ...merged(), baseRefName: 'scratch' } })), /the pull requests of the run merge into different branches \(#1 into scratch, #2 into main, #3 into main\)/);
  });

  // In a clone whose origin is git@github-work:acme/shop.git, an entry of the person's SSH configuration, the host
  // names no server, so a pull request is tied to the repository by owner and name.
  it('ties a pull request to a clone whose origin names an SSH host alias by owner and name, and says so', (t) => {
    const alias = { after: (root) => { git(root, 'remote', 'set-url', 'origin', 'git@github-work:acme/shop.git'); write(root, 'sdlc/runs/R1/note.md', 'note\n'); } };
    const r = remote(t, answers(), alias);
    accepted(r);
    warned(r, /the origin remote names github-work, an SSH host alias rather than a host, so each pull request was tied to this repository by owner and name only/);
  });

  it('rejects when gh cannot answer', (t) => {
    rejected(remote(t, { [PRS.planApproval]: merged(), [PRS.humanAcceptance]: open(GREEN), 'run:acme/shop/1': ciRun() }), /businessApproval: cannot verify .*\/pull\/1 with gh/);
  });

  // A check that was skipped or neutral ran no test. Without these rules a delivery pull request whose checks
  // were all skipped would pass, its head would never be compared with the tested commit, and the CI run would be
  // taken from its URL alone.
  it('rejects a delivery pull request on which no check succeeded, and a required check that did not', (t) => {
    const skipped = [{ name: 'Build and test', conclusion: 'SKIPPED' }, { name: 'Imperata gates', conclusion: 'SKIPPED' }];
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open(skipped) })), /no CI check of the delivery pull request succeeded \(Build and test SKIPPED, Imperata gates SKIPPED\): nothing shows that the tests ran/);
    const half = [{ name: 'Build and test', conclusion: 'SKIPPED' }, { name: 'Imperata gates', conclusion: 'SUCCESS' }];
    const required = { flags: ['--require-check', 'Build and test'] };
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open(half) }), required), /the required CI check "Build and test" is SKIPPED; it must have succeeded/);
    rejected(remote(t, answers(), required), /the required CI check "Build and test" is not on the delivery pull request/);
    const green = remote(t, answers({ [PRS.humanAcceptance]: open([{ name: 'Build and test', conclusion: 'SUCCESS' }, { name: 'Docs', conclusion: 'SKIPPED' }]) }), required);
    accepted(green);
    expectOutput(green, /Required check\(s\) succeeded: Build and test\./);
    warned(green, /CI check\(s\) skipped or neutral, which prove nothing: Docs/);
  });

  it('rejects a delivery pull request whose head is not the tested commit or a later one that changes only the run folder', (t) => {
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open(GREEN, 'ab'.repeat(20)) })), /the head of the delivery pull request, abab.*, is not in this clone/);
    const runFolder = { after: (root) => write(root, 'sdlc/runs/R1/delivery-note.md', 'note\n') };
    accepted(remote(t, answers({ [PRS.humanAcceptance]: open(GREEN, 'LATER_SHA') }), runFolder));
    const code = { after: (root) => write(root, 'src/app.js', 'export const total = 2;\n') };
    rejected(remote(t, answers({ [PRS.humanAcceptance]: open(GREEN, 'LATER_SHA') }), code), /the delivery pull request changes files outside sdlc\/runs\/R1\/ after the tested commit .*: src\/app\.js/);
  });

  it('rejects a CI run that did not succeed, ran on another commit, or is no Actions run', (t) => {
    rejected(remote(t, answers({ 'run:acme/shop/1': ciRun({ conclusion: 'failure' }) })), /the CI run .*\/runs\/1 concluded failure, not success/);
    rejected(remote(t, answers({ 'run:acme/shop/1': ciRun({ status: 'in_progress', conclusion: '' }) })), /is in_progress, not completed/);
    rejected(remote(t, answers({ 'run:acme/shop/1': ciRun({ headSha: 'cd'.repeat(20) }) })), /ran on cdcdcdcdcd, not on the tested commit/);
    rejected(remote(t, answers(), { runUrl: 'https://ci.example.com/build/7' }), /is not the URL of a GitHub Actions run/);
    rejected(remote(t, answers({ 'run:acme/shop/1': undefined })), /cannot verify the CI run .*\/runs\/1 with gh/);
  });
});

// A bug run shows its bug before its specification is approved, keeps the test that showed it, and a
// confidential one publishes nothing before the fix.
describe('bug runs', () => {
  const REP = 'sdlc/runs/R1/evidence/reproduction.json';
  const bug = (root, options = {}, files = { [LOCKED_TEST]: 'REPRODUCED' }, over = {}) => {
    makeRun(root, {});
    const entries = Object.entries(files).map(([f, result]) => [f, { sha256: f === LOCKED_TEST ? sha256(root, f) : 'ab'.repeat(32), result, command: `node ${f}`, exit: result === 'REPRODUCED' ? 1 : 0 }]);
    write(root, REP, JSON.stringify({ runId: 'R1', reproducedAt: '2026-11-16T01:00:00Z', commit: 'a1b2c3d4e5f6a7b8', control: 'tests/other.test.js', files: Object.fromEntries(entries), ...over }, null, 2));
    return check(root, { ...options, manifest: { kind: 'bug', ...options.manifest }, artifactPaths: { reproduction: REP, ...options.artifactPaths } });
  };

  it('accepts a bug run whose bug was shown, and says so', (t) => {
    const r = bug(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN' });
    accepted(r);
    expectOutput(r, /\(approval mode: local-record, track: full, kind: bug\)/);
    expectOutput(r, /Reproduction: 1 of 1 test file\(s\) failed on a1b2c3d4e5, the code before the fix/);
  });

  it('rejects an approved specification of a bug run without a reproduction, and only warns before', (t) => {
    rejected(check(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN', manifest: { kind: 'bug' } }), /a bug run is reproduced before its specification is approved/);
    const waiting = check(tempDir(t), { stage: 'AWAITING_BUSINESS_DECISION', manifest: { kind: 'bug' } });
    accepted(waiting);
    warned(waiting, /the bug is not reproduced yet/);
    silentAbout(check(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN' }), /reproduc/);
  });

  it('rejects a reproduction whose test did not fail, or that names no commit', (t) => {
    rejected(bug(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN' }, { [LOCKED_TEST]: 'NOT_REPRODUCED' }), /1 reproduction test\(s\) did not fail on the code as committed/);
    rejected(bug(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN' }, undefined, { commit: '' }), /names no commit the bug was reproduced on/);
    warned(bug(tempDir(t), { stage: 'READY_FOR_DESIGN_PLAN' }, undefined, { control: null }), /reproduced without a control/);
  });

  it('keeps the test that showed the bug among the locked tests in review, and never a guard', (t) => {
    rejected(bug(tempDir(t), {}, { 'tests/other.test.js': 'REPRODUCED' }), /the test\(s\) that showed the bug are not among the run's locked tests: tests\/other\.test\.js/);
    const root = tempDir(t);
    makeRun(root, {});
    const cal = { runId: 'R1', files: { [LOCKED_TEST]: { sha256: sha256(root, LOCKED_TEST), result: 'GUARD', control: 'tests/other.test.js' } } };
    rejected(bug(root, { calibration: cal }), /showed the bug, and its calibration reads GUARD/);
    accepted(bug(tempDir(t), {}));
  });

  it('warns when the test that showed the bug changed since and was not calibrated', (t) => {
    const root = tempDir(t);
    makeRun(root, {});
    write(root, REP, JSON.stringify({ runId: 'R1', commit: 'a1b2c3d4e5f6', control: 'tests/other.test.js', files: { [LOCKED_TEST]: { sha256: 'cd'.repeat(32), result: 'REPRODUCED' } } }));
    warned(check(root, { manifest: { kind: 'bug' }, artifactPaths: { reproduction: REP } }), /changed after it showed the bug and is not calibrated/);
  });

  it('keeps a confidential run out of pull-request mode, and rejects an unknown kind', (t) => {
    rejected(check(tempDir(t), { stage: 'ANALYSIS', mode: 'pull-request', manifest: { kind: 'bug', confidential: true } }), /a confidential run stays in local-record mode/);
    accepted(check(tempDir(t), { stage: 'ANALYSIS', manifest: { kind: 'bug', confidential: true } }));
    rejected(check(tempDir(t), { stage: 'ANALYSIS', manifest: { kind: 'hotfix' } }), /invalid kind/);
    rejected(check(tempDir(t), { stage: 'ANALYSIS', manifest: { confidential: 'yes' } }), /confidential must be true or false/);
  });
});

// A local-record run has no pull request. It is DONE once the delivery the owner accepted is merged into the main
// branch, and git confirms the merge. Without this check such a run could never be DONE, and a run that depends on
// another waits for DONE.
describe('DONE in local-record mode', () => {
  it('accepts a delivery merged into the main branch, and says what nobody outside confirms', (t) => {
    const r = check(tempDir(t), { stage: 'DONE' });
    accepted(r);
    expectOutput(r, /Local merge: [0-9a-f]{10} is on main and holds the tests that were accepted \(merged by or for owner\)/);
    warned(r, /DONE rests on a local acceptance and a local merge/);
    silentAbout(r, /PR merge|PR URL/);
  });

  it('rejects DONE without a local merge, and a local merge that is incomplete', (t) => {
    rejected(check(tempDir(t), { stage: 'DONE', evidence: { localMerge: null } }), /externalEvidence\.localMerge is missing/);
    rejected(check(tempDir(t), { stage: 'DONE', evidence: { localMerge: { commit: 'a1b2c3d', branch: 'main' } } }), /externalEvidence\.localMerge\.by is missing/);
  });

  it('rejects a commit that is not in the repository, or not on the branch', (t) => {
    const root = gitRepo(t);
    makeRun(root, { stage: 'REVIEWING' });
    const merged = commitAll(root, 'the delivery, merged');
    rejected(check(root, { stage: 'DONE', evidence: { localMerge: { commit: 'ab'.repeat(20), branch: 'main', by: 'owner', at: '2026-11-16T06:00:00Z' } } }), /is not in this repository/);
    run('git', ['checkout', '-q', '-b', 'side'], { cwd: root });
    write(root, 'src/elsewhere.js', '// work that main does not have\n');
    const side = commitAll(root, 'not merged');
    run('git', ['checkout', '-q', 'main'], { cwd: root });
    rejected(check(root, { stage: 'DONE', evidence: { localMerge: { commit: side, branch: 'main', by: 'owner', at: '2026-11-16T06:00:00Z' } } }), /is not on main: the delivery is not merged there/);
    accepted(check(root, { stage: 'DONE', evidence: { localMerge: { commit: merged, branch: 'main', by: 'owner', at: '2026-11-16T06:00:00Z' } } }));
  });

  it('rejects a merge whose tests are not the ones that were accepted', (t) => {
    const root = gitRepo(t);
    makeRun(root, { stage: 'REVIEWING' });
    write(root, LOCKED_TEST, '// weakened before the merge\n');
    const merged = commitAll(root, 'merged with another test');
    const { manifest } = makeRun(root, { stage: 'DONE', evidence: { localMerge: { commit: merged, branch: 'main', by: 'owner', at: '2026-11-16T06:00:00Z' } } });
    write(root, LOCKED_TEST, "import assert from 'node:assert/strict';\nassert.equal(1 + 1, 2);\n");
    rejected(validate(root, manifest), /does not hold the tests that were accepted: tests\/price\.test\.js \(changed\)/);
  });

  // Read by its stage alone, a manifest written straight to DONE would skip every check of review and acceptance:
  // a run with no lock, a FAILED test and no test for two of its criteria would pass.
  it('holds a run written straight to DONE to what its review and acceptance rest on', (t) => {
    rejected(check(tempDir(t), { stage: 'DONE', lock: null }), /artifactPaths\.testLock is missing; before stage DONE/);
    const r = check(tempDir(t), { stage: 'DONE', rows: [['T-01', 'AC-01', 'FAILED']] });
    rejected(r, /records a FAILED test for AC-01/);
    rejected(r, /2 acceptance criteria of sdlc\/runs\/R1\/feature-spec\.md have no test/);
  });

  // The delivery branch holds the commit without any merge, so a manifest that names it is not DONE.
  it('rejects a local merge into a branch of the run, or into what is not a branch, and warns about another branch', (t) => {
    const root = gitRepo(t);
    makeRun(root, { stage: 'REVIEWING' });
    commitAll(root, 'before the delivery');
    run('git', ['checkout', '-q', '-b', 'sdlc/R1/delivery'], { cwd: root });
    write(root, 'src/discount.js', '// the delivery\n');
    const delivered = commitAll(root, 'the delivery');
    const merge = (branch) => ({ localMerge: { commit: delivered, branch, by: 'owner', at: '2026-11-16T06:00:00Z' } });
    rejected(check(root, { stage: 'DONE', evidence: merge('sdlc/R1/delivery') }), /localMerge\.branch sdlc\/R1\/delivery is a branch of a run/);
    rejected(check(root, { stage: 'DONE', evidence: merge(delivered) }), /is not a branch of this repository/);
    rejected(check(root, { stage: 'DONE', evidence: merge('HEAD') }), /localMerge\.branch HEAD is not a branch of this repository/);
    run('git', ['branch', '-q', 'release', delivered], { cwd: root });
    const other = check(root, { stage: 'DONE', evidence: merge('release') });
    accepted(other);
    warned(other, /the delivery is merged into release, not the main branch main/);
  });

  // A code change committed after the review and the owner's acceptance could be merged with the delivery, and the
  // run be DONE with no word of it.
  it('rejects a merge that holds code changed after the reviewed commit, and warns when the review names none', (t) => {
    const root = gitRepo(t);
    makeRun(root, { stage: 'REVIEWING' });
    write(root, 'src/discount.js', '// the delivery, as reviewed\n');
    const reviewed = commitAll(root, 'the delivery, reviewed');
    const review = `# Code review\n\n- Commit reviewed: ${reviewed.slice(0, 7)}\n- Verdict: \`APPROVE_FOR_HUMAN_REVIEW\`\n`;
    makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', review });
    const accepted_ = commitAll(root, 'the review and the acceptance');
    const at = (commit) => ({ localMerge: { commit, branch: 'main', by: 'owner', at: '2026-11-16T06:00:00Z' } });
    accepted(check(root, { stage: 'DONE', review, evidence: at(accepted_) }));
    write(root, 'src/discount.js', '// the delivery, and a code nobody reviewed\n');
    const unreviewed = commitAll(root, 'a change after the acceptance');
    rejected(check(root, { stage: 'DONE', review, evidence: at(unreviewed) }), /files outside sdlc\/runs\/R1\/ changed after the reviewed commit [0-9a-f]{7} and were merged: src\/discount\.js/);
    warned(check(tempDir(t), { stage: 'DONE' }), /names no "Commit reviewed:", so nothing shows that the code merged is the code reviewed/);
  });

  it('needs the tracker verified only when the ticket names a real tracker', (t) => {
    rejected(check(tempDir(t), { stage: 'DONE', manifest: { ticketRef: 'ABC-42' } }), /tracker status not verified/);
    accepted(check(tempDir(t), { stage: 'DONE', manifest: { ticketRef: 'ABC-42' }, evidence: { trackerStatusVerified: true } }));
  });
});

// The review gate passes on the Code Reviewer's verdict. Read from the manifest alone, a run could reach
// READY_FOR_ACCEPTANCE with review PASSED while review.md says CHANGES_REQUIRED and leaves a BLOCKER open.
describe('the code review behind a passed review gate', () => {
  const HEAD = '| ID | Severity (BLOCKER / MAJOR / MINOR) | File and line | Scenario and impact | AC | Suggested fix | Disposition |\n| --- | --- | --- | --- | --- | --- | --- |\n';
  const review = (verdict, rows = []) => `# Code review\n\n- Verdict: ${verdict}\n\n## Findings\n\n${HEAD}${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
  const withReview = (t, text, stage = 'READY_FOR_ACCEPTANCE') => {
    const root = tempDir(t);
    const { R, manifest } = makeRun(root, { stage });
    write(root, `${R}/review.md`, text);
    return validate(root, manifest);
  };

  it('rejects a passed review gate whose review requires changes, or gives no verdict', (t) => {
    rejected(withReview(t, review('`CHANGES_REQUIRED`')), /review is PASSED, but sdlc\/runs\/R1\/review\.md says CHANGES_REQUIRED/);
    rejected(withReview(t, review('`APPROVE_FOR_HUMAN_REVIEW` or `CHANGES_REQUIRED`')), /gives no verdict/);
    rejected(withReview(t, '# Code review\n\nLooks fine.\n'), /gives no verdict/);
  });

  // A review read again holds a later round below the first: where round one says APPROVE_FOR_HUMAN_REVIEW and
  // round two CHANGES_REQUIRED, the review gate goes by round two.
  it('takes the last verdict of a review read again', (t) => {
    const rounds = (first, second) => `${review(first)}\n## Round 2\n\n- Verdict: ${second}\n`;
    rejected(withReview(t, rounds('`APPROVE_FOR_HUMAN_REVIEW`', '`CHANGES_REQUIRED`')), /says CHANGES_REQUIRED/);
    accepted(withReview(t, rounds('`CHANGES_REQUIRED`', '`APPROVE_FOR_HUMAN_REVIEW`')));
  });

  it('rejects a BLOCKER left open, and only warns about a MAJOR', (t) => {
    const blocker = ['R-01', 'BLOCKER', 'src/auth.js:12', 'any user reads any project', 'AC-01', 'check membership'];
    rejected(withReview(t, review('`APPROVE_FOR_HUMAN_REVIEW`', [[...blocker, 'OPEN']])), /leaves 1 BLOCKER finding\(s\) open: R-01/);
    rejected(withReview(t, review('`APPROVE_FOR_HUMAN_REVIEW`', [[...blocker, '']])), /leaves 1 BLOCKER finding\(s\) open: R-01/);
    const major = withReview(t, review('`APPROVE_FOR_HUMAN_REVIEW`', [['R-02', 'MAJOR', 'src/a.js:3', 'slow', 'AC-02', 'cache', 'OPEN']]));
    accepted(major);
    warned(major, /leaves 1 MAJOR finding\(s\) open: R-02/);
  });

  it('accepts a review whose blockers were dealt with, and says what it read', (t) => {
    const r = withReview(t, review('`APPROVE_FOR_HUMAN_REVIEW`', [['R-01', 'BLOCKER', 'src/auth.js:12', 'any user reads any project', 'AC-01', 'check membership', 'Repaired in TASK-01, reviewed again'], ['R-02', 'MINOR', 'src/a.js:3', 'a name', 'AC-02', 'rename', 'OPEN']]));
    accepted(r);
    expectOutput(r, /Code review: APPROVE_FOR_HUMAN_REVIEW in sdlc\/runs\/R1\/review\.md, 2 finding\(s\), 1 left open and none of them a BLOCKER/);
  });

  it('does not judge the review before its gate passes', (t) => {
    accepted(withReview(t, review('`CHANGES_REQUIRED`', [['R-01', 'BLOCKER', 'x', 'y', 'AC-01', 'z', 'OPEN']]), 'REVIEWING'));
  });
});

// A test the test plan marks mandatory passes, or the owner accepted the gap for that test. Without this rule a
// passed test of the same criterion would stand in for it: AC-01 with T-01 PASSED and the mandatory T-04 NOT_RUN
// would pass. In a bug run the test left out may be the very one that shows the bug.
describe('mandatory tests', () => {
  const HEAD = '| Test ID | AC | Scenario | Category (unit / API / E2E / negative / concurrency / isolation) | Expected | Test file | Mandatory |\n| --- | --- | --- | --- | --- | --- | --- |\n';
  const plan = (rows, gaps = []) => `# Test plan\n\n## Matrix\n\n${HEAD}${rows.map(([id, ac, file, m]) => `| ${id} | ${ac} | a scenario | unit | an outcome | ${file} | ${m} |`).join('\n')}\n\n## Not covered\n\n| AC or risk | Reason | Who accepted the gap |\n| --- | --- | --- |\n${gaps.map((g) => `| ${g.join(' | ')} |`).join('\n')}\n`;
  const MATRIX = [['T-01', 'AC-01', 'tests/a.test.js', 'yes'], ['T-02', 'AC-02', 'tests/a.test.js', 'yes'], ['T-03', 'AC-03', 'tests/a.test.js', 'yes'], ['T-04', 'AC-01', 'tests/b.test.js', 'yes']];
  const run = (t, o) => check(tempDir(t), { stage: 'READY_FOR_ACCEPTANCE', ...o });

  it('rejects a mandatory test that did not run, though another test of its criterion passed', (t) => {
    const r = run(t, { testPlan: plan(MATRIX), rows: [...ALL_PASSED, ['T-04', 'AC-01', 'NOT_RUN']] });
    rejected(r, /1 mandatory test\(s\) of sdlc\/runs\/R1\/test-plan\.md did not pass in sdlc\/runs\/R1\/test-report\.md: T-04 for AC-01: NOT_RUN\. Another test of the same criterion does not stand in/);
    rejected(run(t, { testPlan: plan(MATRIX), rows: ALL_PASSED }), /T-04 for AC-01: not in the test report/);
    rejected(run(t, { testPlan: plan(MATRIX), rows: [...ALL_PASSED, ['T-04', 'AC-01', 'BLOCKED']] }), /T-04 for AC-01: BLOCKED/);
  });

  it('accepts a mandatory test the owner left out by name, with a warning, and not without the owner', (t) => {
    const r = run(t, { testPlan: plan(MATRIX, [['T-04', 'no browser in this environment', 'owner (decisions/2026-11-17.md)']]), rows: [...ALL_PASSED, ['T-04', 'AC-01', 'NOT_RUN']] });
    accepted(r);
    warned(r, /1 mandatory test\(s\) did not pass, by an accepted gap: T-04 \(owner/);
    rejected(run(t, { testPlan: plan(MATRIX, [['T-04', 'no browser in this environment', '']]), rows: [...ALL_PASSED, ['T-04', 'AC-01', 'NOT_RUN']] }), /T-04 for AC-01: NOT_RUN/);
  });

  it('leaves a test that is not mandatory alone, says what it checked, and warns of a matrix without the column', (t) => {
    const optional = MATRIX.map((m) => (m[0] === 'T-04' ? [...m.slice(0, 3), 'no'] : m));
    const r = run(t, { testPlan: plan(optional), rows: [...ALL_PASSED, ['T-04', 'AC-01', 'NOT_RUN']] });
    accepted(r);
    expectOutput(r, /Mandatory tests: 3 of 3 marked mandatory in sdlc\/runs\/R1\/test-plan\.md passed/);
    const noColumn = `# Test plan\n\n## Matrix\n\n| Test ID | AC | Scenario | Test file |\n| --- | --- | --- | --- |\n${MATRIX.map(([id, ac, file]) => `| ${id} | ${ac} | a scenario | ${file} |`).join('\n')}\n`;
    warned(run(t, { testPlan: noColumn, rows: ALL_PASSED }), /has no "Mandatory" column/);
  });

  it('does not judge mandatory tests before review', (t) => {
    accepted(check(tempDir(t), { stage: 'VERIFYING', testPlan: plan(MATRIX), rows: [...ALL_PASSED, ['T-04', 'AC-01', 'NOT_RUN']] }));
  });

  it('holds a test that showed the bug to be mandatory, and to have a row in the matrix', (t) => {
    const REP = 'sdlc/runs/R1/evidence/reproduction.json';
    const bugRun = (matrix, rows) => {
      const root = tempDir(t);
      makeRun(root, {});
      write(root, REP, JSON.stringify({ runId: 'R1', commit: 'a1b2c3d4e5f6', control: 'tests/other.test.js', files: { [LOCKED_TEST]: { sha256: sha256(root, LOCKED_TEST), result: 'REPRODUCED' } } }));
      return check(root, { stage: 'READY_FOR_ACCEPTANCE', manifest: { kind: 'bug' }, artifactPaths: { reproduction: REP }, testPlan: plan(matrix), rows });
    };
    const shown = [...MATRIX.slice(0, 3), ['T-09', 'AC-01', LOCKED_TEST, 'no']];
    rejected(bugRun(shown, [...ALL_PASSED, ['T-09', 'AC-01', 'NOT_RUN']]), /T-09 for AC-01: NOT_RUN/);
    accepted(bugRun(shown, [...ALL_PASSED, ['T-09', 'AC-01', 'PASSED']]));
    rejected(bugRun(MATRIX.slice(0, 3), ALL_PASSED), /the test\(s\) that showed the bug have no row in the matrix of sdlc\/runs\/R1\/test-plan\.md: tests\/price\.test\.js/);
  });
});

// A plan approved with its decisions can set a rule in a security-sensitive area, such as the exact boundary of a
// session's inactivity limit. A matrix derived from the criteria alone leaves it untested: a fault put into it
// (`>` for `>=`) leaves every test passing. A decision of the plan in a security-sensitive area is held by a
// test, as a criterion is.
describe('decisions of the plan in a security-sensitive area', () => {
  const decided = (rows, header = '| ID | Decision | Alternatives rejected | Security-sensitive area | Needs approval from |') =>
    `${planOf(TASKS)}\n## Decisions\n\n${header}\n|${' --- |'.repeat(header.split('|').length - 2)}\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
  const PLAN = decided([
    ['ADR-01', 'A session expires when now - last use >= 30 min', 'A sliding window', 'authentication', 'Owner'],
    ['ADR-02', 'Codes are stored in one JSON file', 'A database', 'no', 'Owner'],
  ]);

  it('rejects review and acceptance while such a decision has no test, and asks for none for a decision marked no', (t) => {
    const root = tempDir(t);
    for (const stage of ['REVIEWING', 'READY_FOR_ACCEPTANCE']) {
      const r = check(root, { stage, plan: PLAN });
      rejected(r, /1 decision of .*technical-plan\.md in a security-sensitive area has no test in .*test-report\.md: ADR-01 \(authentication\)\. A review reads a decision once; a test holds it in every later run/);
      assert.ok(!r.problems.some((p) => /ADR-02/.test(p)), 'a decision marked no was asked for a test');
    }
    accepted(check(root, { stage: 'VERIFYING', plan: PLAN }));
  });

  it('accepts a passed test that names the decision beside its criterion, and rejects a failed one', (t) => {
    const root = tempDir(t);
    const r = check(root, { plan: PLAN, rows: [['T-01', 'AC-01, ADR-01', 'PASSED'], ...ALL_PASSED.slice(1)] });
    accepted(r);
    expectOutput(r, /Decisions in a security-sensitive area: 1 of 1 in .*technical-plan\.md have a test that passed\. Whether a test checks its decision/);
    rejected(check(root, { plan: PLAN, rows: [...ALL_PASSED, ['T-04', 'ADR-01', 'FAILED']] }), /records a FAILED test for the decision ADR-01 \(T-04\)/);
    rejected(check(root, { plan: PLAN, rows: [...ALL_PASSED, ['T-04', 'ADR-01', 'NOT_RUN']] }), /no test passed in .* for the decision ADR-01 \(T-04 NOT_RUN\)/);
  });

  it('accepts a gap the owner accepted, as a warning, and rejects one nobody accepted', (t) => {
    const root = tempDir(t);
    const r = check(root, { plan: PLAN, testPlan: notCovered([['ADR-01', 'needs a clock the stack cannot fake', 'owner, decisions/owner.md']]) });
    accepted(r);
    warned(r, /1 decision in a security-sensitive area has no test, by an accepted gap: ADR-01 \(owner, decisions\/owner\.md\)/);
    rejected(check(root, { plan: PLAN, testPlan: notCovered([['ADR-01', 'needs a clock', '']]) }), /lists ADR-01 under "Not covered" without saying who accepted the gap/);
  });

  it('warns when the Decisions table does not say which decisions settle a security-sensitive area', (t) => {
    const root = tempDir(t);
    const old = decided([['ADR-01', 'A session expires after 30 min', 'A sliding window', 'Owner']], '| ID | Decision | Alternatives rejected | Needs approval from |');
    const r = check(root, { plan: old });
    accepted(r);
    warned(r, /the Decisions table of .*technical-plan\.md has no "Security-sensitive area" column/);
    const blank = check(root, { plan: decided([['ADR-01', 'A session expires after 30 min', 'A sliding window', '', 'Owner'], ['ADR-02', '', '', '', '']]) });
    accepted(blank);
    warned(blank, /ADR-01 in the Decisions table of .* does not say whether it settles a security-sensitive area/);
    assert.ok(!blank.warnings.some((w) => /ADR-02/.test(w)), 'an empty row of the template was read as a decision');
  });
});
