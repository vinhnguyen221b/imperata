// SPDX-License-Identifier: MIT
// Writes two synthetic Imperata runs into a sample repository that already has the kit installed, so that
// the run board can be rendered and photographed for the guides.
// TeamLeave is fictional: nothing here describes a real product. Used by screenshots.mjs.
//   node docs/images/src/sample-runs.mjs <repo>
//
//   R1-leave-balance  READY_FOR_ACCEPTANCE: four tasks in three waves, tests, review, model per task, one repair
//   R2-leave-request  AWAITING_BUSINESS_DECISION: depends on R1, three questions before the spec gate, two later
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';

const [repo] = process.argv.slice(2);
if (!repo) { console.error('usage: sample-runs.mjs <repo>'); process.exit(2); }
const w = (rel, text) => { const p = join(repo, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, text.replace(/^\n/, '')); };
const gateVersion = (files) => {
  const h = createHash('sha256');
  for (const f of files) h.update(`${basename(f)}\0`).update(readFileSync(join(repo, f))).update('\0');
  return `${files.map((f) => basename(f)).join('+')}@${h.digest('hex').slice(0, 12)}`;
};

// ---------------------------------------------------------------------------------------------- profile
w('.orchestra/project.md', `
# Project profile

## Product

- **Name:** TeamLeave (${'fictional, for illustration'})
- **Sources and reading order:** \`docs/\`, ${'reading order in'} \`README.md\`
- **Version of the sources:** 1.0
- **Status legend of the sources:** none
- **Tracker:** ${'local tickets only'}

## Architecture and stack rules

- ${'Node API with a domain module; React web client'}
- ${'business invariants live in server-side domain functions'}

## Security-sensitive areas

- ${'an employee reads and changes only their own requests and balance'}

## Business Analyst: questions to raise for this product

- ${'who approves, and what happens when the approver is away'}

## QA Engineer: areas to cover when they apply

- ${'permission denial for each role'}

## Code Reviewer: areas to check

- ${'balance arithmetic at year boundaries'}
`);

// ---------------------------------------------------------------------------------------------- R1: ready for acceptance
const R1 = 'R1-leave-balance';
const r1 = `sdlc/runs/${R1}`;
w(`${r1}/input.md`, `
# ${'Original requirement'} — ${R1}

## Title

${'Show employees their leave balance'}

## Requirement

BR-01 (\`docs/requirements.md\`, 1.0). ${'Driven by Claude Code. Approval mode chosen by the owner: local-record.'}
`);
w(`${r1}/feature-spec.md`, `
# Feature specification — ${R1}

Status: APPROVED (businessApproval, local record).

## Business rules

| ID | Rule | Kind | Source |
| --- | --- | --- | --- |
| BR-01 | ${'An employee sees their own remaining leave days for the current year'} | fact | docs/requirements.md |

## Acceptance criteria

| ID | Given | When | Then | Business rules |
| --- | --- | --- | --- | --- |
| AC-01 | ${'a signed-in employee'} | ${'they open the home page'} | ${'they see their remaining days for this year'} | BR-01 |
| AC-02 | ${'days granted and days approved this year'} | ${'the balance is computed'} | ${'it shows the days granted less the days approved'} | BR-01 |
| AC-03 | ${'an employee'} | ${"they ask for another employee's balance"} | ${'the API answers 403 and discloses nothing'} | BR-01 |
| AC-04 | ${'the balance service is down'} | ${'the home page loads'} | ${'a message replaces the number; no stale value'} | BR-01 |

### Cases of AC-02

| Case | ${'Granted'} | ${'Approved'} | Expected |
| --- | --- | --- | --- |
| AC-02.1 | 20 | 3 | ${'it shows 17'} |
| AC-02.2 | 20 | 20 | ${'it shows 0'} |
`);
w(`${r1}/clarification.md`, `
# Clarification log — ${R1}

| ID | Question | Why it matters | Affects (BR / AC) | Options and their consequences | Needed before | Decision | Decided by | Decided at | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q-01 | ${'Does the balance include requests still waiting for approval?'} | ${'Employees may plan on days they will not get'} | AC-02 | (a) ${'only approved days count'}; (b) ${'pending days count too'} | businessApproval | **(a)** | demo-owner | 2026-11-12T09:10:00Z | \`decisions/2026-11-12T09-10-00Z.md\` |
| Q-02 | ${'Which year does the balance cover?'} | ${'Changes what employees see in January'} | AC-01 | (a) ${'calendar year'}; (b) ${'contract year'} | businessApproval | **(a)** | demo-owner | 2026-11-12T09:10:00Z | \`decisions/2026-11-12T09-10-00Z.md\` |
`);
w(`${r1}/technical-plan.md`, `
# Technical plan — ${R1}

Status: APPROVED (planApproval, local record).

## Tasks

### TASK-01 — ${'Balance calculation in the domain module'}

- **Acceptance criteria:** AC-01, AC-02
- **Depends on:** none
- **Owner check:** ${'run `npm test -- balance`: an employee with 12 days and 3 taken has 9 left'}
- **Complexity:** standard — ${'new domain function that follows the existing module pattern'}
- **Skills:**
  - core: \`node-api\`

### TASK-02 — ${'GET /me/balance with an ownership check'}

- **Acceptance criteria:** AC-01, AC-03
- **Depends on:** TASK-01
- **Owner check:** ${'start the API and request `GET /me/balance` as each of the two seeded employees: each sees their own balance only'}
- **Complexity:** high — ${'enforces the security-sensitive rule that an employee reads only their own data'}
- **Skills:**
  - core: \`node-api\`

### TASK-03 — ${'Balance card on the home page'}

- **Acceptance criteria:** AC-01, AC-04
- **Depends on:** TASK-02
- **Owner check:** ${'open the home page as a seeded employee: the card shows the balance, and an error message when the API is stopped'}
- **Complexity:** standard — ${'new UI component with an error state'}
- **Skills:**
  - core: \`react-web\`

### TASK-04 — ${'Seed fixtures for two employees'}

- **Acceptance criteria:** AC-02
- **Depends on:** none
- **Owner check:** ${'open `seed/employees.json`: two employees with fixed ids'}
- **Complexity:** low — ${'fixture data following the existing seed file'}
- **Skills:**
  - core: \`node-api\`
`);
w(`${r1}/test-report.md`, `
# Test report — ${R1}

## Runs

| Command | Exit code | Commit | Environment | Timestamp | Log or report path |
| --- | --- | --- | --- | --- | --- |
| \`npm test\` | 0 | 4f2c1ab | local, Node 20 | 2026-11-13T15:02:00Z | \`evidence/unit.junit.xml\` |
| \`npx playwright test balance\` | 0 | 4f2c1ab | local, Chromium | 2026-11-13T15:06:00Z | \`evidence/e2e/\` |

## Results

| Test ID | AC | Result (PASSED / FAILED / NOT_RUN / BLOCKED) | Evidence path | Notes |
| --- | --- | --- | --- | --- |
| T-01 | AC-01 | PASSED | \`evidence/unit.junit.xml\` | |
| T-02 | AC-02.1 | PASSED | \`evidence/unit.junit.xml\` | |
| T-03 | AC-02.2 | PASSED | \`evidence/unit.junit.xml\` | ${'boundary: 0 days left'} |
| T-04 | AC-03 | PASSED | \`evidence/unit.junit.xml\` | ${'negative: another employee → 403'} |
| T-05 | AC-04 | PASSED | \`evidence/e2e/\` | ${'failed once, fixed by repair 1'} |
| T-06 | AC-03 | PASSED | \`evidence/e2e/\` | |

## Defects

| ID | Test ID | Severity | Actual vs expected | Reproduction | Repair attempt (max 2) | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D-01 | T-05 | MAJOR | ${'stale balance shown when the service is down'} | \`npx playwright test balance\` | 1 | FIXED |
`);
w(`${r1}/review.md`, `
# Code review — ${R1}

- Commit reviewed: 4f2c1ab
- Verdict: \`APPROVE_FOR_HUMAN_REVIEW\`

## Findings

| ID | Severity (BLOCKER / MAJOR / MINOR) | File and line | Scenario and impact | AC | Suggested fix | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | MINOR | api/balance.ts:41 | ${'error message names the internal service'} | AC-04 | ${'generic message'} | FIXED in 4f2c1ab |
`);
w(`${r1}/delivery.md`, `
# Delivery dossier — ${R1}

Final label: \`READY_FOR_ACCEPTANCE\`.

## Model per task

| Task | Step (developer / qa / repair) | Complexity | Model requested | Confirmed |
| --- | --- | --- | --- | --- |
| TASK-04 | developer | low | haiku | NOT_CONFIRMED |
| TASK-01 | developer | standard | sonnet | NOT_CONFIRMED |
| TASK-02 | developer | high | opus | NOT_CONFIRMED |
| TASK-03 | developer | standard | sonnet | NOT_CONFIRMED |
| TASK-01, TASK-03, TASK-04 | qa | standard | sonnet | NOT_CONFIRMED |
| TASK-02 | qa | high | opus | NOT_CONFIRMED |
| TASK-03 | repair | high | opus | NOT_CONFIRMED |

## Checked by the owner

| Task | Commit | Owner's word | At |
| --- | --- | --- | --- |
| TASK-04 | 1c9e7d2 | "${'go on'}" | 2026-11-12T17:35:00Z |
| TASK-01 | 8a41f06 | "${'9 days left, as expected. Go on'}" | 2026-11-13T08:50:00Z |
| TASK-02 | 3be92c7 | "${'each employee sees only their own balance. Go on'}" | 2026-11-13T10:40:00Z |
| TASK-03 | 4f2c1ab | "${'the card and its error state look right'}" | 2026-11-13T13:15:00Z |

## Skills applied

| Task | Skill file | Rule applied (verbatim quote) | Where |
| --- | --- | --- | --- |
| TASK-04 | \`.claude/skills/node-api/SKILL.md\` | "Seed data lives in seed/ as one file per entity, with fixed ids." | \`seed/employees.json\` |
| TASK-01 | \`.claude/skills/node-api/SKILL.md\` | "A domain function is pure: it takes its data as arguments and reads no clock, database or request." | \`api/domain/balance.ts\` |
| TASK-02 | \`.claude/skills/node-api/SKILL.md\` | "A route reads the employee id from the session, never from the request." | \`api/balance.ts\` |
| TASK-03 | \`.claude/skills/react-web/SKILL.md\` | "A component that loads data renders three states: loading, loaded and failed." | \`web/BalanceCard.tsx\` |
`);
// The two stack skills the tasks name, with the rules the table above quotes: the validator looks every quote
// up in the file its row names.
w('.claude/skills/node-api/SKILL.md', `
---
name: node-api
description: Conventions for the Node API of TeamLeave (fictional). Load when a task's Skills field names it.
---

# Node API conventions

## Conventions

- A domain function is pure: it takes its data as arguments and reads no clock, database or request.
- A route reads the employee id from the session, never from the request.
- Seed data lives in \`seed/\` as one file per entity, with fixed ids.
`);
w('.claude/skills/react-web/SKILL.md', `
---
name: react-web
description: Conventions for the React web app of TeamLeave (fictional). Load when a task's Skills field names it.
---

# React web conventions

## Conventions

- A component that loads data renders three states: loading, loaded and failed.
`);
const bizVer = gateVersion([`${r1}/feature-spec.md`]);
const planVer = gateVersion([`${r1}/technical-plan.md`]);
const decision = (at, body) => `
# Owner decisions — ${R1}

Saved by \`scripts/board-server.mjs\` when "Send to Orchestrator" was pressed on the run board.

- Sent at: ${at}
- Run folder: ${r1}/

\`\`\`text
${body}
\`\`\`
`;
w(`${r1}/decisions/2026-11-12T09-10-00Z.md`, decision('2026-11-12T09:10:00Z', `Q-01: (a)\nQ-02: (a)\nbusinessApproval: APPROVE ${bizVer}`));
w(`${r1}/decisions/2026-11-12T16-40-00Z.md`, decision('2026-11-12T16:40:00Z', `planApproval: APPROVE ${planVer}`));
// The test lock of R1, as `scripts/lock-tests.mjs record` writes it after the QA step: without it the validator
// rejects a run that is ready for acceptance.
const r1Tests = {
  'tests/leave-balance.test.mjs': "import test from 'node:test';\n\ntest('T-01 an employee sees their own balance', () => {});\ntest('T-03 zero days left', () => {});\ntest('T-04 another employee gets 403', () => {});\n",
  'e2e/balance.spec.mjs': "import { test } from '@playwright/test';\n\ntest('T-05 balance page when the service is down', async () => {});\ntest('T-06 balance page of another employee', async () => {});\n",
};
for (const [rel, text] of Object.entries(r1Tests)) w(rel, text);
w(`${r1}/evidence/test-lock.json`, `${JSON.stringify({
  runId: R1,
  recordedAt: '2026-11-13T15:08:00Z',
  found: 'the files named on the command line (git could not be asked)',
  files: Object.fromEntries(Object.keys(r1Tests).sort().map((rel) => [rel, createHash('sha256').update(readFileSync(join(repo, rel))).digest('hex')])),
  skipMarkers: [],
}, null, 2)}\n`);
// Its calibration, as `scripts/lock-tests.mjs calibrate` writes it once the tests pass: without it the validator
// warns that nothing shows the tests fail without the run's change.
w(`${r1}/evidence/test-calibration.json`, `${JSON.stringify({
  runId: R1,
  calibratedAt: '2026-11-13T15:12:00Z',
  lockRecordedAt: '2026-11-13T15:08:00Z',
  files: Object.fromEntries(Object.keys(r1Tests).sort().map((rel) => [rel, {
    sha256: createHash('sha256').update(readFileSync(join(repo, rel))).digest('hex'),
    result: 'DEPENDS_ON_CHANGE',
    command: `${rel.startsWith('e2e/') ? 'npx playwright test' : 'node --test'} ${rel}`,
    exitHere: 0,
    exitOnBase: 1,
    base: '4f1c2d7a9b3e5f60718293a4b5c6d7e8f9012345',
    control: 'tests/health.test.mjs',
    at: '2026-11-13T15:12:00Z',
  }])),
  // The whole suite of each stack, run five times with --suite: it passed every time.
  suites: ['node --test', 'npx playwright test'].map((command) => ({
    command, exits: [0, 0, 0, 0, 0], lockRecordedAt: '2026-11-13T15:08:00Z', at: '2026-11-13T15:12:00Z',
  })),
}, null, 2)}\n`);
w(`${r1}/run.json`, `${JSON.stringify({
  runId: R1,
  title: 'Show employees their leave balance',
  productDocVersion: '1.0',
  ticketRef: `local:${R1}`,
  dependsOn: [],
  currentStage: 'READY_FOR_ACCEPTANCE',
  revision: 9,
  owner: 'demo-owner',
  updatedAt: '2026-11-13T15:20:00Z',
  approvalMode: 'local-record',
  approvals: {
    businessApproval: { kind: 'local-record', by: 'demo-owner', at: '2026-11-12T09:10:00Z', recordPath: `${r1}/decisions/2026-11-12T09-10-00Z.md` },
    planApproval: { kind: 'local-record', by: 'demo-owner', at: '2026-11-12T16:40:00Z', recordPath: `${r1}/decisions/2026-11-12T16-40-00Z.md` },
    humanAcceptance: null,
  },
  artifactPaths: {
    input: `${r1}/input.md`, clarification: `${r1}/clarification.md`, spec: `${r1}/feature-spec.md`, plan: `${r1}/technical-plan.md`,
    testReport: `${r1}/test-report.md`, review: `${r1}/review.md`, delivery: `${r1}/delivery.md`,
    testLock: `${r1}/evidence/test-lock.json`, testCalibration: `${r1}/evidence/test-calibration.json`,
  },
  gateResults: { businessApproval: 'PASSED', planApproval: 'PASSED', implementation: 'PASSED', tests: 'PASSED', review: 'PASSED', humanAcceptance: 'NOT_RUN' },
  openBlockers: [],
  externalEvidence: { prUrl: null, prMerged: false, trackerStatusVerified: false, ci: null },
}, null, 2)}\n`);

// ---------------------------------------------------------------------------------------------- R2: awaiting decisions
const R2 = 'R2-leave-request';
const r2 = `sdlc/runs/${R2}`;
w(`${r2}/input.md`, `
# ${'Original requirement'} — ${R2}

## Title

${'Submit and approve a leave request'}

## Requirement

BR-02 (\`docs/requirements.md\`, 1.0).
`);
w(`${r2}/feature-spec.md`, `
# Feature specification — ${R2}

Status: DRAFT until the business approval gate passes.

## Acceptance criteria

| ID | Given | When | Then | Business rules |
| --- | --- | --- | --- | --- |
| AC-01 | ${'an employee with days left'} | ${'they submit a request'} | ${'it waits for their manager'} | BR-02 |
| AC-02 | ${'a request longer than the balance'} | ${'it is submitted'} | ${'see Q-02'} | BR-02 |
| AC-03 | ${'a pending request'} | ${'the manager approves it'} | ${'the balance drops by its days'} | BR-02 |
| AC-04 | ${'a pending request'} | ${'the manager rejects it with a reason'} | ${'the employee sees the reason'} | BR-02 |
| AC-05 | ${'another employee'} | ${'they try to approve it'} | ${'403, nothing changes'} | BR-02 |
`);
w(`${r2}/clarification.md`, `
# Clarification log — ${R2}

| ID | Question | Why it matters | Affects (BR / AC) | Options and their consequences | Needed before | Decision | Decided by | Decided at | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q-01 | ${'Do public holidays inside a request count as leave days?'} | ${'Decides how many days a request costs'} | AC-03 | (a) ${'no, only working days count'}; (b) ${'yes, every calendar day'} | businessApproval | **(a)** | demo-owner | 2026-11-14T10:05:00Z | ${'owner message in the session'} |
| Q-02 | ${'What happens when a request asks for more days than the employee has left?'} | ${'Employees could end the year owing days, or be stopped from planning a long holiday'} | AC-02 | (a) ${'reject at submission with a clear reason; the employee shortens the request'}; (b) ${'accept the extra days as unpaid leave, flagged to the manager'}; (c) ${'allow a negative balance of up to 3 days'} | businessApproval | OPEN | demo-owner | | |
| Q-03 | ${'Who approves when the manager is on leave themselves?'} | ${'Requests could wait for weeks with nobody able to answer them'} | AC-01, AC-03 | (a) ${"the manager's own manager"}; (b) ${'any HR user'}; (c) ${'the request waits until the manager returns'} | businessApproval | OPEN | demo-owner | | |
| Q-04 | ${'Can an employee cancel a request after it was approved?'} | ${'Decides whether approved days can come back to the balance'} | AC-03 | (a) ${'yes, until the first day of leave; the days return'}; (b) ${"only with the manager's approval"}; (c) ${'no'} | businessApproval | OPEN | demo-owner | | |
| Q-05 | ${'How soon must the manager hear about a new request?'} | ${'Changes whether the plan needs an email service'} | AC-01 | (a) ${'an email at once'}; (b) ${'a daily summary'} | planApproval | OPEN | demo-owner | | |
| Q-06 | ${"Who may read the manager's reason for a rejection?"} | ${'Decides what the audit record stores and shows'} | AC-04 | (a) ${'the employee and HR'}; (b) ${'HR only'} | planApproval | OPEN | demo-owner | | |

## Proposals not yet decided

- Q-02: (a) — ${'keeps the balance rule simple; unpaid leave is not in the sources'}
- Q-03: (a) — ${'follows the reporting line already in the HR data'}
- Q-04: (a) — ${'the employee owns the request until the leave starts'}
- Q-05: (a) — ${'a request often needs an answer the same day'}
- Q-06: (a) — ${'the employee needs the reason to change the request'}
`);
w(`${r2}/run.json`, `${JSON.stringify({
  runId: R2,
  title: 'Submit and approve a leave request',
  productDocVersion: '1.0',
  ticketRef: `local:${R2}`,
  dependsOn: [R1],
  currentStage: 'AWAITING_BUSINESS_DECISION',
  revision: 3,
  owner: 'demo-owner',
  updatedAt: '2026-11-14T10:20:00Z',
  approvalMode: 'local-record',
  approvals: { businessApproval: null, planApproval: null, humanAcceptance: null },
  artifactPaths: { input: `${r2}/input.md`, clarification: `${r2}/clarification.md`, spec: `${r2}/feature-spec.md`, plan: null, testReport: null, review: null, delivery: null },
  gateResults: { businessApproval: 'NOT_RUN', planApproval: 'NOT_RUN', implementation: 'NOT_RUN', tests: 'NOT_RUN', review: 'NOT_RUN', humanAcceptance: 'NOT_RUN' },
  openBlockers: ['Q-02 to Q-04 are OPEN and change acceptance criteria; businessApproval cannot be requested until they are decided'],
  externalEvidence: { prUrl: null, prMerged: false, trackerStatusVerified: false, ci: null },
}, null, 2)}\n`);
console.log(`sample written to ${repo}`);
