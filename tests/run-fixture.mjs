// SPDX-License-Identifier: MIT
// A run folder that the gate validator accepts, written into a temporary repository. A test asks for the
// stage it needs and overrides the one thing it is about, so that each case differs from a valid run in
// exactly one way.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { write, sha256, node, script, git } from './helpers.mjs';

export const SPEC = `# Feature specification

## Acceptance criteria

| ID | Given | When | Then | Business rules |
| --- | --- | --- | --- | --- |
| AC-01 | a basket | the code TEN is applied | the total is ten percent lower | BR-01 |
| AC-02 | a basket | an unknown code is applied | the total is unchanged | BR-01 |
| AC-03 | a basket | an expired code is applied | it is rejected with EXPIRED | BR-02 |
`;

export const ALL_PASSED = [['T-01', 'AC-01', 'PASSED'], ['T-02', 'AC-02', 'PASSED'], ['T-03', 'AC-03', 'PASSED']];
export const reportOf = (rows) => `# Test report

## Results

| Test ID | AC | Result (PASSED / FAILED / NOT_RUN / BLOCKED) | Evidence path | Notes |
| --- | --- | --- | --- | --- |
${rows.map(([id, ac, result]) => `| ${id} | ${ac} | ${result} | \`evidence/unit.log\` | |`).join('\n')}

## Defects

| ID | Test ID | Severity | Actual vs expected | Reproduction | Repair attempt (max 2) | Status |
| --- | --- | --- | --- | --- | --- | --- |
`;

export const notCovered = (rows) => `# Test plan

## Not covered

| AC or risk | Reason | Who accepted the gap |
| --- | --- | --- |
${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}
`;

export const TASKS = [{ id: 'TASK-01', title: 'Discount code' }, { id: 'TASK-02', title: 'Seed data' }];
export const planOf = (tasks) => `# Technical plan

## Tasks

${tasks.map((t) => `### ${t.id} — ${t.title ?? 'A task'}

- **Acceptance criteria:** AC-01
- **Depends on:** none
${t.ownerCheck ? `- **Owner check:** ${t.ownerCheck}\n` : ''}${t.complexity === null ? '' : `- **Complexity:** ${t.complexity ?? 'low — one small change'}\n`}- **Skills:**
  - core: \`web\`
`).join('\n')}`;

const table = (header, rows) => `${header}\n|${' --- |'.repeat(header.split('|').length - 2)}\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}`;
export const MODELS = [['TASK-01', 'developer', 'low', 'haiku', 'NOT_CONFIRMED'], ['TASK-02', 'developer', 'low', 'haiku', 'NOT_CONFIRMED']];
export const modelTable = (rows) => table('| Task | Step (developer / qa / repair) | Complexity | Model requested | Confirmed |', rows);

export const SKILL_FILE = '.claude/skills/web/SKILL.md';
export const SKILL = `# Web conventions

## Conventions

- Server state lives in **TanStack Query**; no \`fetch\` call inside a
  component.
- Prices are integers in minor units, never floats.
- “Every form” field has a visible label.
`;
export const SKILLS = [
  ['TASK-01', `\`${SKILL_FILE}\``, '"Server state lives in TanStack Query; no fetch call inside a component."', '`src/api.js`'],
  ['TASK-01', `\`${SKILL_FILE}#conventions\``, 'Prices are integers in minor units, never floats', '`src/price.js`'],
  ['TASK-02', `\`${SKILL_FILE}\``, 'none', 'seed data only; no convention bears on it'],
];
export const skillsTable = (rows, header = '| Task | Skill file | Rule applied (verbatim quote) | Where |') => table(header, rows);
// The owner's word after each task the Developer was delegated, in the order of the delegations: what a run
// holds whose Orchestrator stopped after each task. `checks: null` leaves the table out.
export const checksTable = (rows) => table("| Task | Commit | Owner's word | At |", rows);
const checksOf = (models) => [...new Set((Array.isArray(models) ? models : []).filter((r) => r[1] === 'developer').flatMap((r) => r[0].match(/TASK-[\w.-]+/g) || []))].map((id) => [id, '4f2c1ab', '"go on"', '2026-11-16T04:00:00Z']);
export const deliveryOf = ({ models = MODELS, skills = SKILLS, checks } = {}) => `# Delivery dossier
${models === null ? '' : `\n## Model per task\n\n${typeof models === 'string' ? models : modelTable(models)}\n`}${checks === null || (checks === undefined && !checksOf(models).length) ? '' : `\n## Checked by the owner\n\n${typeof checks === 'string' ? checks : checksTable(checks ?? checksOf(models))}\n`}${skills === null ? '' : `\n## Skills applied\n\n${typeof skills === 'string' ? skills : skillsTable(skills)}\n`}`;

const ORDER = ['businessApproval', 'planApproval', 'implementation', 'tests', 'review', 'humanAcceptance'];
const PASSED_AT = {
  NEW: 0, ANALYSIS: 0, AWAITING_BUSINESS_DECISION: 0, BLOCKED: 0, CANCELLED: 0,
  READY_FOR_DESIGN_PLAN: 1,
  READY_FOR_IMPLEMENTATION: 2, IMPLEMENTING: 2, FIX_REQUIRED: 2,
  VERIFYING: 3, REVIEWING: 4, READY_FOR_ACCEPTANCE: 5, DONE: 6,
};
const HUMAN = ['businessApproval', 'planApproval', 'humanAcceptance'];
export const LOCKED_TEST = 'tests/price.test.js';
const pr = (n) => `https://github.com/acme/shop/pull/${n}`;
export const PRS = { businessApproval: pr(1), planApproval: pr(2), humanAcceptance: pr(3) };

// options:
//   stage, mode ('local-record' | 'pull-request'), track, id
//   spec, plan, tasks, report, rows, testPlan, review, delivery, models, skills, checks   contents of the artifacts
//   lock          null for no lock, or an object that replaces the recorded one
//   calibration   an object written as evidence/test-calibration.json and named in the manifest
//   gates, approvals, artifactPaths, evidence, manifest   merged over what the stage implies (null removes a key)
// The version of the documents behind a human gate, as scripts/render-run-board.mjs --gate-version and the gate
// validator compute it: the files in order, each as its name, a NUL, its content and a NUL. tests/board.test.mjs
// holds the three to the same result.
export function gateVersionOf(root, files) {
  const h = createHash('sha256');
  for (const f of files) h.update(`${f.split('/').pop()}\0`).update(readFileSync(join(root, f))).update('\0');
  return `${files.map((f) => f.split('/').pop()).join('+')}@${h.digest('hex').slice(0, 12)}`;
}

export function makeRun(root, o = {}) {
  const id = o.id ?? 'R1';
  const R = `sdlc/runs/${id}`;
  const stage = o.stage ?? 'REVIEWING';
  const mode = o.mode ?? 'local-record';
  const light = o.track === 'light';
  const done = stage === 'DONE';
  assert.ok(stage in PASSED_AT, `unknown stage ${stage}`);

  write(root, `${R}/input.md`, '# Requirement\n');
  write(root, `${R}/feature-spec.md`, o.spec ?? SPEC);
  write(root, `${R}/technical-plan.md`, o.plan ?? planOf(o.tasks ?? TASKS));
  write(root, `${R}/test-report.md`, o.report ?? reportOf(o.rows ?? ALL_PASSED));
  if (o.testPlan) write(root, `${R}/test-plan.md`, o.testPlan);
  write(root, `${R}/review.md`, o.review ?? '# Code review\n\n- Verdict: `APPROVE_FOR_HUMAN_REVIEW`\n');
  write(root, `${R}/delivery.md`, o.delivery ?? deliveryOf({ models: o.models, skills: o.skills, checks: o.checks }));
  write(root, `${R}/decisions/owner.md`, '# Reply\n\nApproved.\n');
  write(root, SKILL_FILE, SKILL);
  write(root, LOCKED_TEST, "import assert from 'node:assert/strict';\nassert.equal(1 + 1, 2);\n");

  const paths = { input: `${R}/input.md`, spec: `${R}/feature-spec.md`, plan: `${R}/technical-plan.md`, testReport: `${R}/test-report.md`, review: `${R}/review.md`, delivery: `${R}/delivery.md` };
  if (o.lock !== null) {
    write(root, `${R}/evidence/test-lock.json`, JSON.stringify(o.lock ?? { runId: id, recordedAt: '2026-11-16T05:00:00Z', found: 'the files named on the command line', files: { [LOCKED_TEST]: sha256(root, LOCKED_TEST) }, skipMarkers: [] }, null, 2));
    paths.testLock = `${R}/evidence/test-lock.json`;
  }
  if (o.calibration) {
    write(root, `${R}/evidence/test-calibration.json`, JSON.stringify(o.calibration, null, 2));
    paths.testCalibration = `${R}/evidence/test-calibration.json`;
  }

  const gates = Object.fromEntries(ORDER.map((g, i) => [g, i < PASSED_AT[stage] ? 'PASSED' : 'NOT_RUN']));
  if (light) gates.planApproval = 'WAIVED';
  Object.assign(gates, o.gates);
  const approvals = {};
  for (const g of HUMAN) {
    if (gates[g] !== 'PASSED') { approvals[g] = null; continue; }
    approvals[g] = mode === 'pull-request'
      ? { kind: 'pull-request', by: 'owner', at: '2026-11-16T03:00:00Z', prUrl: PRS[g] }
      : { kind: 'local-record', by: 'owner', at: '2026-11-16T03:00:00Z', recordPath: `${R}/decisions/owner.md` };
  }
  Object.assign(approvals, o.approvals);
  const evidence = { prUrl: null, prMerged: false, trackerStatusVerified: false, ci: null };
  if (mode === 'pull-request') {
    evidence.prUrl = PRS.humanAcceptance;
    if (gates.tests === 'PASSED') evidence.ci = { conclusion: 'success', headSha: '4f2c1ab', runUrl: 'https://github.com/acme/shop/actions/runs/1' };
  }
  if (done && mode === 'pull-request') Object.assign(evidence, { prUrl: evidence.prUrl ?? PRS.humanAcceptance, prMerged: true, trackerStatusVerified: true });
  // A local-record run is DONE once its delivery is merged into the main branch: the files are committed on main
  // in a repository of their own, unless the test names the merge itself.
  if (done && mode === 'local-record' && !(o.evidence && 'localMerge' in o.evidence)) {
    if (!existsSync(join(root, '.git'))) git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'the delivery, merged');
    evidence.localMerge = { commit: git(root, 'rev-parse', 'HEAD'), branch: git(root, 'rev-parse', '--abbrev-ref', 'HEAD'), by: 'owner', at: '2026-11-16T06:00:00Z' };
  }
  Object.assign(evidence, o.evidence);
  Object.assign(paths, o.artifactPaths);
  for (const k of Object.keys(paths)) if (paths[k] === null) delete paths[k];
  // The owner's reply approves each passed gate for the version of its documents as they are now.
  const exists = (p) => p && existsSync(join(root, p));
  const OWN = { businessApproval: ['spec'], planApproval: ['plan', 'tasks'], humanAcceptance: ['delivery', 'testReport', 'review'] };
  const WITH = { businessApproval: [paths.reproduction ?? `${R}/evidence/reproduction.json`], planApproval: [paths.design ?? `${R}/design.md`], humanAcceptance: [] };
  const docsOf = (gate) => [...new Set([...new Set(OWN[gate].map((k) => paths[k]).filter(exists)), ...WITH[gate].filter(exists)])];
  const reply = HUMAN.filter((g) => gates[g] === 'PASSED' && approvals[g]?.recordPath === `${R}/decisions/owner.md` && docsOf(g).length).map((g) => `${g}: APPROVE ${gateVersionOf(root, docsOf(g))}`);
  write(root, `${R}/decisions/owner.md`, `# Reply\n\n${reply.join('\n') || 'Approved.'}\n`);

  const manifest = {
    runId: id, title: 'Discount codes', productDocVersion: '1.0', ticketRef: `local:${id}`, dependsOn: [],
    currentStage: stage, revision: 3, owner: 'owner', updatedAt: '2026-11-16T05:00:00Z', approvalMode: mode,
    track: light ? 'light' : 'full',
    trackDecision: light ? { by: 'owner', at: '2026-11-16T02:00:00Z', reason: 'one small change in one module' } : null,
    approvals, artifactPaths: paths, gateResults: gates, openBlockers: [], externalEvidence: evidence,
    ...o.manifest,
  };
  for (const k of Object.keys(manifest)) if (manifest[k] === undefined) delete manifest[k];
  write(root, `${R}/run.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { id, R, manifest: `${R}/run.json` };
}

// The validator's verdict, read as the run board reads it: a line "- …" is a problem, "WARNING: …" a warning.
export function validate(root, manifest, ...flags) {
  const r = node(root, script('validate-gates.mjs'), manifest, ...flags);
  const lines = r.out.split(/\r?\n/);
  return {
    ...r,
    problems: lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2)),
    warnings: lines.filter((l) => l.startsWith('WARNING: ')).map((l) => l.slice(9)),
  };
}
export const check = (root, options, ...flags) => validate(root, makeRun(root, options).manifest, ...flags);

export function accepted(r) {
  assert.equal(r.status, 0, `expected the manifest to be accepted\n${r.out}`);
}
export function rejected(r, pattern) {
  assert.equal(r.status, 1, `expected a rejection matching ${pattern}\n${r.out}`);
  assert.ok(r.problems.some((p) => pattern.test(p)), `no problem matches ${pattern}\n${r.out}`);
}
export function warned(r, pattern) {
  assert.ok(r.warnings.some((w) => pattern.test(w)), `no warning matches ${pattern}\n${r.out}`);
}
export function silentAbout(r, pattern) {
  const hit = [...r.problems, ...r.warnings].find((x) => pattern.test(x));
  assert.equal(hit, undefined, `did not expect: ${hit}`);
}
