#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// Run board for Imperata.
//
// Reads every sdlc/runs/<runId>/run.json and the artifacts it names, and writes:
//   sdlc/runs/<runId>/board.md  Mermaid diagrams and tables that GitHub renders; committed with the run
//   sdlc/board.html             one offline page for all runs, where the owner answers
//                               questions and approves gates; local, not committed
//
// The board shows what the manifest and the artifacts say. It decides nothing: no stage, gate or decision
// comes from it, and a green step on it is only as true as the manifest behind it. The gate check it shows
// is scripts/validate-gates.mjs without --verify-remote.
//
// Run from the repository root:
//   node scripts/render-run-board.mjs                 render every run's board.md, then sdlc/board.html
//   node scripts/render-run-board.mjs --run <runId>   render that run's board.md only (and sdlc/board.html)
//   node scripts/render-run-board.mjs --no-html       leave sdlc/board.html alone
//   node scripts/render-run-board.mjs --check         write nothing; exit 1 when a board.md is not current
//   node scripts/render-run-board.mjs --quiet         print nothing on success (for hooks)
//   node scripts/render-run-board.mjs --html-only     write sdlc/board.html only
//   node scripts/render-run-board.mjs --stdout        print the page instead of writing any file (for scripts/board-server.mjs)
//   node scripts/render-run-board.mjs --gate-version <runId> <gate>
//                                                     print the version of the documents behind a human gate,
//                                                     as the board's approval card names it
//
// Owner decisions sent from the board (scripts/board-server.mjs) sit in sdlc/runs/<runId>/decisions/. A file
// that clarification.md does not cite yet is shown as sent and waiting for the Orchestrator to record it.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { resolve, relative, dirname, basename, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// What this script prints can hold text from the run files, which agents write: control characters are shown as
// "?" so that none reaches the terminal as a command (clearing a line, writing to the clipboard).
for (const level of ['log', 'error', 'warn']) {
  const out = console[level].bind(console);
  console[level] = (...xs) => out(...xs.map((x) => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '?') : x)));
}

function usage() {
  console.error('Usage: node scripts/render-run-board.mjs [--run <runId>] [--no-html] [--html-only] [--stdout] [--check] [--quiet] | --gate-version <runId> <gate>');
}
const args = process.argv.slice(2);
let only = null;
let writeHtml = true;
let check = false;
let quiet = false;
let htmlOnly = false;
let toStdout = false;
let gateVersionOf = null;
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--run') { only = args[i + 1] || null; i += 1; if (!only) { usage(); process.exit(2); } }
  else if (a === '--no-html') writeHtml = false;
  else if (a === '--check') check = true;
  else if (a === '--quiet') quiet = true;
  else if (a === '--html-only') htmlOnly = true;
  else if (a === '--stdout') { toStdout = true; htmlOnly = true; quiet = true; }
  else if (a === '--gate-version') { gateVersionOf = { run: args[i + 1], gate: args[i + 2] }; i += 2; if (!gateVersionOf.run || !gateVersionOf.gate) { usage(); process.exit(2); } }
  else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
  else { console.error(`Unknown argument: ${a}`); usage(); process.exit(2); }
}

const root = process.cwd();
const runsDir = join(root, 'sdlc', 'runs');
const htmlPath = join(root, 'sdlc', 'board.html');
const posix = (p) => p.split(sep).join('/');
const relPath = (p) => posix(relative(root, p));
function read(p) { try { return readFileSync(resolve(root, p), 'utf8'); } catch { return null; } }

// ---------------------------------------------------------------------------------------------
// Vocabulary shared with the manifest schema and docs/04_WORKFLOW_AND_GATES.md

const GATES = ['businessApproval', 'planApproval', 'implementation', 'tests', 'review', 'humanAcceptance'];
const GATE_LABEL = {
  businessApproval: 'Business approval', planApproval: 'Plan approval', implementation: 'Implementation',
  tests: 'Tests', review: 'Review', humanAcceptance: 'Human acceptance',
};
const HUMAN = new Set(['businessApproval', 'planApproval', 'humanAcceptance']);
// When several approvals no longer cover their documents, the earliest gate is asked first.
const STALE_ORDER = ['businessApproval', 'planApproval', 'humanAcceptance'];
const PR_OF = { businessApproval: 'specification', planApproval: 'plan', humanAcceptance: 'delivery' };
const STEPS = [
  { label: 'Analysis', stages: ['NEW', 'ANALYSIS', 'AWAITING_BUSINESS_DECISION'], gate: 'businessApproval' },
  { label: 'Design and plan', stages: ['READY_FOR_DESIGN_PLAN'], gate: 'planApproval' },
  { label: 'Implementation', stages: ['READY_FOR_IMPLEMENTATION', 'IMPLEMENTING', 'FIX_REQUIRED'], gate: 'implementation' },
  { label: 'Verification', stages: ['VERIFYING'], gate: 'tests' },
  { label: 'Review', stages: ['REVIEWING'], gate: 'review' },
  { label: 'Acceptance', stages: ['READY_FOR_ACCEPTANCE'], gate: 'humanAcceptance' },
  { label: 'Done', stages: ['DONE'], gate: null },
];
const MODEL = { low: 'haiku', standard: 'sonnet', high: 'opus' };
// The analyst asks at most this many questions needed before one gate at a time; a point the sources leave open
// and a reasonable default settles is an assumption of the specification, approved with it. More open
// questions than this before the gate the run is at is a gap the owner sees. Whether a question needed asking,
// or an assumption should have been a question, is not judged.
const MAX_OPEN_QUESTIONS = 5;
// Past five, only questions in a security-sensitive area, up to ten in all. Under a limit of five alone, a point
// such as the length of a session or the rules for a password tends to be approved as an assumption instead.
const MOST_OPEN_QUESTIONS = 10;
const NOT_SENSITIVE = /^(no|none|n\/a|-|—|–)\.?$/i;
// The documents a person approves at each human gate, and the stage in which the board offers that approval.
const GATE_DOCS = { businessApproval: ['spec'], planApproval: ['plan', 'tasks'], humanAcceptance: ['delivery', 'testReport', 'review'] };
// Documents read with a gate's own when the run has them: at the path the manifest names, else under their
// usual name in the run folder. The approval card names them and its version covers them. Alone they open no
// approval: a run with a design brief and no plan has nothing to approve yet.
const GATE_WITH = { businessApproval: [['reproduction', 'evidence/reproduction.json']], planApproval: [['design', 'design.md']] };
const GATE_STAGE = { businessApproval: 'AWAITING_BUSINESS_DECISION', planApproval: 'READY_FOR_DESIGN_PLAN', humanAcceptance: 'READY_FOR_ACCEPTANCE' };
const GATE_ASK = { businessApproval: 'Approve the specification?', planApproval: 'Approve the technical plan?', humanAcceptance: 'Accept the delivery?' };
const GATE_LINE = /^(businessApproval|planApproval|humanAcceptance):[ \t]+(APPROVE|REQUEST CHANGES)\b[ \t]*(.*)$/gm;
// The id of a criterion, or of a case of one: the criterion's id, a point and a number (AC-03.2).
const AC_RE = /\bAC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:\.[0-9]+)?/g;
const CASE_RE = /^(AC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\.([0-9]+)$/;
const CASE_RANGE = /\b(AC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\.([0-9]+)\s*(?:\.{2,}|…|–|—|\bto\b)\s*\1\.([0-9]+)\b/g;
const CASE_AT_START = /^(AC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\.([0-9]+)(?=$|[^0-9A-Za-z.-])/;
const MANY_CRITERIA = 12;
const caseId = (id) => { const m = id.match(CASE_RE); return m ? `${m[1]}.${Number(m[2])}` : id; };
// A range of cases of one criterion, AC-03.1..AC-03.4, written out as every case in it, as the gate validator reads it.
// The prefix of an id in capitals, whatever the case it was written in, as the gate validator reads it.
const acPrefix = (s) => String(s ?? '').replace(/\bac-/gi, 'AC-');
const spellCases = (text) => acPrefix(text).replace(CASE_RANGE, (whole, ac, from, to) => {
  const first = Number(from);
  const last = Number(to);
  if (last < first || last - first > 999) return whole;
  return Array.from({ length: last - first + 1 }, (_, i) => `${ac}.${first + i}`).join(', ');
});
const idsOf = (text) => [...new Set((spellCases(text).match(AC_RE) || []).map(caseId))];
const TASK_RE = /\bTASK-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g;
// The criteria a task carries out, from its "Acceptance criteria" field. A field that opens with "none" names
// no criterion, whatever it goes on to mention ("none directly; enables AC-01..AC-12"). A range such as
// AC-03..AC-07 is every id in it when both ends have the same shape; any other id is taken as written.
// This is how the board reads a plan. The test report is read one id at a time, as the gate validator reads it.
const AC_RANGE = /\b(AC-(?:[A-Za-z][A-Za-z0-9]*-)*)(\d+)\s*(?:\.{2,}|…|–|—|\bto\b)\s*\1(\d+)\b/g;
function taskCriteria(field) {
  const text = stripMd(field || '');
  if (/^none\b/i.test(text)) return [];
  const spelled = spellCases(text).replace(AC_RANGE, (whole, prefix, from, to) => {
    const first = Number(from);
    const last = Number(to);
    if (last < first || last - first > 999) return whole;
    return Array.from({ length: last - first + 1 }, (_, i) => `${prefix}${String(first + i).padStart(from.length, '0')}`).join(', ');
  });
  return uniq((spelled.match(AC_RE) || []).map(caseId));
}

// ---------------------------------------------------------------------------------------------
// Words on the board. The same functions write board.md and run in the
// browser (embedded as source), so a sentence exists once. Content written by agents is shown as it is.

function boardMessages() {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const PR = { businessApproval: 'specification', planApproval: 'plan', humanAcceptance: 'delivery' };
  // What the owner approved at each human gate, and the verb for it: the board asks again when it changed.
  const AGAIN = { businessApproval: ['specification', 'approved', 'approve'], planApproval: ['plan', 'approved', 'approve'], humanAcceptance: ['delivery', 'accepted', 'accept'] };
  const en = {
    'stage.NEW':'New', 'stage.ANALYSIS': 'Analysis', 'stage.AWAITING_BUSINESS_DECISION': 'Waiting for your decisions', 'stage.READY_FOR_DESIGN_PLAN': 'Planning', 'stage.READY_FOR_IMPLEMENTATION': 'Ready to build', 'stage.IMPLEMENTING': 'Building', 'stage.VERIFYING': 'Testing', 'stage.REVIEWING': 'In review', 'stage.FIX_REQUIRED': 'Fixing', 'stage.READY_FOR_ACCEPTANCE': 'Ready for acceptance', 'stage.DONE': 'Done', 'stage.BLOCKED': 'Blocked', 'stage.CANCELLED': 'Cancelled',
    'step.0': 'Analysis', 'step.1': 'Design and plan', 'step.2': 'Implementation', 'step.3': 'Verification', 'step.4': 'Review', 'step.5': 'Acceptance', 'step.6': 'Done',
    'gate.businessApproval': 'Business approval', 'gate.planApproval': 'Plan approval', 'gate.implementation': 'Implementation', 'gate.tests': 'Tests', 'gate.review': 'Review', 'gate.humanAcceptance': 'Human acceptance',
    'ask.businessApproval': 'Approve the specification?', 'ask.planApproval': 'Approve the technical plan?', 'ask.humanAcceptance': 'Accept the delivery?',
    'badge.owner': 'Your move', 'badge.agents': 'In progress', 'badge.repair': 'Repair', 'badge.done': 'Delivered', 'badge.accepted': 'Accepted', 'badge.cancelled': 'Cancelled', 'badge.blocked': 'Blocked', 'badge.sent': 'Sent',
    how: (p) => (p.mode === 'pull-request' ? `merge the ${PR[p.gate]} pull request; the Orchestrator never merges it` : 'use the approval card on the board, or tell the Orchestrator'),
    waiting: (p) => (p.waiting && p.waiting.length ? ` Waiting for ${p.waiting.map((d) => `${d.id} (${d.stage || 'not opened'})`).join(', ')}.` : ''),
    'next.sent': (p) => `You sent ${p.sent ? n(p.sent, 'decision', 'decisions') : 'a reply'} from the board (${p.files.join(', ')}). The Orchestrator records ${p.sent === 1 ? 'it' : 'them'} when you tell it "decisions sent" in its session, or resume it.${p.left ? ` ${n(p.left, 'open question', 'open questions')} needed now still ${p.left === 1 ? 'has' : 'have'} no answer.` : ''}`,
    'next.analysis': (p) => `The Business Analyst is drafting the specification and its open questions.${en.waiting(p)}`,
    'next.awaitingBusiness': (p) => `${p.pending ? `Decide ${n(p.pending, 'open question', 'open questions')}, then approve` : 'Approve'} the specification: ${en.how({ ...p, gate: 'businessApproval' })}.`,
    'next.planReview': (p) => `Review the technical plan (${n(p.tasks, 'task', 'tasks')}, ${p.high} high complexity)${p.pending ? ` and decide ${n(p.pending, 'open question', 'open questions')}` : ''}, then approve it: ${en.how({ ...p, gate: 'planApproval' })}.`,
    'next.planDraft': () => 'The Architect is drafting the technical plan and the task breakdown.',
    'next.readyToPlan': (p) => `The specification is approved and no plan is written yet. Planning runs in an Orchestrator session: start a new one and send /imperata-plan ${p.id}, unless one is running.`,
    'next.planLight': () => 'The plan is written. This run is on the light track, so it has no plan approval: the Orchestrator checks the plan against the light-track limits and starts implementation.',
    'run.light': 'light track', 'run.lightTitle': (p) => `Light track: no separate plan approval.${p.by ? ` Agreed by ${p.by}${p.reason ? `: ${p.reason}` : ''}` : ''}`,
    'gate.lightNote': 'This run is on the light track. Approving the specification also lets implementation start once the plan is written; you will see the plan with the delivery. Request changes if this change should have its plan approved first.',
    'next.implementing': (p) => `The Developer is implementing: ${p.left} of ${n(p.total, 'task', 'tasks')} not delegated yet.`,
    'next.implementedAll': () => 'Every task has been delegated to the Developer; the last one is being built and tested.',
    'next.readyToVerify': (p) => `Every task is built and checked. Verification is next: the whole suite, the calibration and the review. It runs in an Orchestrator session of its own: start a new one and send /imperata-verify ${p.id}, unless one is running.`,
    'next.taskCheck': (p) => `${p.task}${p.title ? ` (${p.title})` : ''} is done and waits for your check${p.check ? `: ${p.check}` : '.'}${p.check && !/[.!?]$/.test(p.check) ? '.' : ''} ${p.left ? `Then tell the Orchestrator to go on, in its session or with /imperata-implement ${p.id} in a new one; if something is wrong, tell it that instead. ${n(p.left, 'task', 'tasks')} not delegated yet.` : `It is the last task. Then send /imperata-verify ${p.id} in a new Orchestrator session: it is your word for this task, and it runs the whole suite, the calibration and the review. If something is wrong, tell the Orchestrator that instead.`}`,
    'next.repair': () => 'A scoped repair is under way: at most two per defect, then the run is BLOCKED.',
    'next.verifying': () => 'The QA Engineer is testing independently.',
    'next.reviewing': () => 'The Code Reviewer is reviewing the delivery diff.',
    'next.acceptance': (p) => `Accept or refuse the delivery: ${en.how({ ...p, gate: 'humanAcceptance' })}.`,
    'next.done': () => 'Nothing pending.',
    'next.readyToBuild': (p) => `No task has been delegated yet. Implementation runs in an interactive Orchestrator session: start a new one and send /imperata-implement ${p.id}, unless one is running. A session that Send starts on the board (auto-run) may not change code, so it does not implement.`,
    'next.acceptedLocal': (p) => `You accepted the delivery${p.by ? ` (${p.by}${p.at ? `, ${p.at}` : ''})` : ''}. One step is left: merge it into the main branch, yourself or by sending /imperata-merge ${p.id} in a new Orchestrator session, not the session that implemented it. The Orchestrator then records DONE, and the runs that wait for this one can go on.`,
    'next.acceptedPr': (p) => `The delivery pull request is merged. Start a new Orchestrator session and send /imperata-close ${p.id}: it records DONE in a closing commit once it has checked the merge and the tracker status.`,
    'next.reapprove': (p) => { const [doc, did, act] = AGAIN[p.gate]; return `The ${doc} changed after you ${did} it: you ${did} ${p.approved}, and it is now ${p.now}. Read it again and ${act} this version, or have it restored as you ${did} it.`; },
    'next.blocked': (p) => `${p.reason || en['next.noReason']()}${en.waiting(p)}`,
    'next.noReason': () => 'The manifest records no reason.',
    'next.unknown': () => 'The stage is not one the manifest schema knows.',
    'attn.gateRejected': (p) => `The gate check rejects this manifest: ${n(p.n, 'problem', 'problems')}.`,
    'attn.late': (p) => `${p.id} is still open, but ${en[`gate.${p.gate}`] || p.gate} has already passed.`,
    'attn.noTask': (p) => `${p.n} acceptance ${p.n === 1 ? 'criterion' : 'criteria'} with no task in the plan: ${p.ids}.`,
    'attn.noTest': (p) => `${p.n} acceptance ${p.n === 1 ? 'criterion' : 'criteria'} with no test in the test report: ${p.ids}.`,
    'attn.failing': (p) => `${p.n} acceptance ${p.n === 1 ? 'criterion' : 'criteria'} with a failing test: ${p.ids}${p.gatePassed ? ', although the tests gate is PASSED' : ''}.`,
    'attn.reviewOpen': (p) => `Review findings still open: ${p.blocker} blocker, ${p.major} major, ${p.minor} minor${p.ids ? ` (${p.ids})` : ''}. Read them in review.md before you decide.`,
    'attn.uncontrolled': (p) => `${n(p.n, 'test file fails', 'test files fail')} on the code from before the run, but no other test passed there, so the calibration does not show that the tests check the change: where the run's code is missing, or tests cannot run, every test fails.`,
    'attn.unrated': (p) => `Tasks with no valid Complexity: ${p.ids}.`,
    'attn.gapOpen': (p) => `${n(p.n, 'row', 'rows')} under "Not covered" in the test plan ${p.n === 1 ? 'has' : 'have'} nobody who accepted the gap: ${p.what}. Only you accept a gap: say so with your decision, or have the row taken out.`,
    'attn.manyCriteria': (p) => `The specification holds ${p.n} acceptance criteria. A criterion is one behaviour, and the values it holds for are its cases: above ${p.max}, values of one rule usually stand as criteria of their own, or the run holds more than one ticket.`,
    'attn.tableRows': (p) => `${n(p.n, 'table row has', 'table rows have')} more or fewer cells than the table has columns, so what this page shows of ${p.n === 1 ? 'it' : 'them'} may come from the wrong column: ${p.where}. A "|" inside a cell ends the cell; it is written "\\|".`,
    'attn.cycle': (p) => `Task dependencies form a cycle: ${p.ids}.`,
    'attn.manyQuestions': (p) => `${p.n} questions are open before ${en[`gate.${p.gate}`] || p.gate}${p.security ? `, ${p.security} of them in a security-sensitive area` : ''}; the analyst asks at most ${p.max} at a time, and up to ${p.most} only when those past ${p.max} are in a security-sensitive area. You can ask for the ones that matter most, and for the others that have a reasonable default to become assumptions of the specification.`,
    'gate.assumptionsTitle': 'Assumptions',
    'gate.reproTitle': 'Reproduction',
    'gate.reproduced': (p) => `the bug is shown before any change: ${p.files} ${p.n === 1 ? 'fails' : 'fail'} on commit ${p.commit}.`,
    'gate.reproFailed': (p) => `the bug is not shown: ${p.files} did not fail on commit ${p.commit}. A bug nobody has shown is not fixed; the Orchestrator brings it back to you.`,
    'gate.notReproduced': 'not reproduced yet. The bug has to be shown by a failing test before you approve.',
    'spec.kind': 'Kind', 'run.bug': 'bug fix', 'run.bugConfidential': 'bug fix, confidential',
    'gate.assumptions': (p) => `Where the sources leave a point open, the specification takes a default: ${n(p.n, 'assumption', 'assumptions')}. Approving the specification approves ${p.n === 1 ? 'it' : 'them'}. To decide one yourself, request changes and name it.`,
    'ui.title': 'Imperata board', 'ui.live': 'live', 'ui.board': 'Run board', 'ui.file': 'static file', 'tb.repo': 'Repo', 'tb.runs': 'Runs', 'tb.rendered': 'Rendered', 'tb.sync': 'Sync', 'ui.home': 'Overview', 'ui.updated': 'Board updated · Reload', 'ui.noscript': 'This board needs JavaScript. Read sdlc/runs/<runId>/board.md instead.',
    'group.owner': 'Waiting on you', 'group.blocked': 'Blocked', 'group.repair': 'In repair', 'group.agents': 'In progress', 'group.done': 'Closed',
    'stat.owner': 'Waiting on you', 'stat.blocked': 'Blocked', 'stat.agents': 'In progress', 'stat.questions': 'Open questions', 'stat.done': 'Closed',
    'home.needsYou': 'What needs you', 'home.nothing': 'Nothing waits on you right now.', 'home.open': 'Open', 'home.decide': (p) => `Decide ${p.n}`, 'home.approve': 'Approve', 'home.allRuns': 'All runs', 'home.order': 'Delivery order', 'home.first': 'First', 'home.then': (p) => `Then ${p.n}`, 'home.sentWaiting': 'Sent, waiting for the Orchestrator',
    'run.back': 'Overview', 'run.step': (p) => `Step ${p.n}/${p.total}`, 'spec.run': 'Run', 'spec.stage': 'Stage', 'spec.mode': 'Approval', 'spec.track': 'Track', 'spec.rev': 'Revision', 'spec.updated': 'Updated', 'spec.owner': 'Owner', 'spec.ticket': 'Ticket', 'run.unreadable': 'The manifest cannot be read.',
    'tab.decisions': 'Decisions', 'tab.tasks': 'Tasks', 'tab.trace': 'Traceability',
    'gate.title': 'Your approval', 'gate.read': 'Read first', 'gate.andDecisions': 'and the decisions in', 'gate.version': (p) => `You are deciding on version ${p.v}. If the documents change before the Orchestrator records your decision, it asks you again.`,
    'gate.planNote': (p) => `${n(p.tasks, 'task', 'tasks')}, ${p.high} of them high complexity, in ${n(p.waves, 'wave', 'waves')}.`,
    'gate.decisionsTitle': 'Decisions of the plan', 'gate.sensitive': 'security-sensitive',
    'gate.decisions': (p) => `Where the criteria leave the plan a choice, it takes one: ${n(p.n, 'decision', 'decisions')}${p.s ? `, ${p.s} of them in a security-sensitive area` : ''}. Approving the plan approves ${p.n === 1 ? 'it' : 'them'}. To decide one yourself, request changes and name it.`,
    'gate.approve': 'Approve', 'gate.approveHint': 'The documents are right; move to the next stage.', 'gate.request': 'Request changes', 'gate.requestHint': 'Say what to change; the author revises and you decide again.', 'gate.commentPh': 'Comment (required when you request changes)',
    'gate.locked': (p) => `Answer ${p.ids} first: the gate cannot pass while a question it depends on is open.`, 'gate.goto': 'Go to the questions',
    'gate.pr': (p) => `In pull-request mode this gate passes only when you merge the ${PR[p.gate]} pull request on GitHub; the Orchestrator never merges it. You can still ask for changes here.`,
    'gate.sent': (p) => `Sent ${p.at}: ${p.verdict}. Waiting for the Orchestrator to record it.`,
    'check.title': 'Check before you decide', 'check.notice': 'Worth a look',
    'dec.progress': (p) => `${p.done} of ${p.total} answered`, 'dec.progressHint': 'needed before the next gate', 'dec.allDone': 'Every question needed now has an answer. Send them when you are ready.',
    'dec.now': (p) => `Decide now — needed before ${p.gate}`, 'dec.unsorted': 'Open, no gate named', 'dec.open': 'Open questions', 'dec.later': 'Can wait — needed at a later gate', 'dec.decided': (p) => `Decided (${p.n})`,
    'dec.none': 'No open question.', 'dec.noLog': 'No clarification log yet.', 'dec.expandAll': 'Expand all', 'dec.collapseAll': 'Collapse all', 'dec.keys': 'Tip: keys 1–9 choose an option in the open card.',
    'q.why': 'Why it matters', 'q.affects': 'Affects', 'q.decider': 'Decider', 'q.needed': (p) => `Needed before ${p.gate}`, 'q.late': 'gate already passed', 'q.note': 'Note', 'q.recommended': 'Recommended', 'q.recNote': 'Recommended, not a decision', 'q.own': 'Write my own answer', 'q.ownPh': 'Your decision, in your own words', 'q.answered': 'Answered', 'q.sent': (p) => `Sent ${p.at}`, 'q.sentWait': 'waiting for the Orchestrator to record it', 'q.change': 'Choose again only to change it.', 'q.options': 'Options',
    'sent.files': 'Sent from the board, not yet recorded:',
    'col.id': 'ID', 'col.decision': 'Decision', 'col.by': 'By', 'col.at': 'At', 'col.ac': 'AC', 'col.then': 'Then', 'col.tasks': 'Tasks', 'col.tests': 'Tests', 'col.result': 'Result', 'col.cases': 'Cases',
    'trace.given': 'Given', 'trace.when': 'When', 'trace.rules': 'Business rules', 'trace.case': 'Case', 'trace.casesOf': (p) => `${p.passed} of ${p.total}`, 'trace.open': (p) => `Open or close ${p.id}`, 'trace.hint': 'Select a criterion to read it in full, with its cases and their tests.',
    'tasks.none': 'No technical plan yet.', 'tasks.wave': (p) => `Wave ${p.n}`, 'tasks.after': 'after', 'tasks.noComplexity': 'no complexity', 'tasks.noSkills': 'no skills', 'tasks.checked': 'checked', 'tasks.yourCheck': 'your check', 'tasks.legend': 'The bars show a task\'s complexity, next to the model it calls for. Tasks in one wave do not depend on each other.',
    'tasks.cycle': (p) => `The dependencies of ${p.ids} form a cycle.`, 'tasks.unknown': (p) => `Depends on tasks that are not in the plan: ${p.ids}.`, 'level.low': 'low', 'level.standard': 'standard', 'level.high': 'high',
    'trace.none': 'No acceptance criteria found in the specification yet.', 'trace.summary': (p) => `${n(p.total, 'criterion', 'criteria')} · ${p.planned} planned · ${p.tested} with a test · ${p.passed} passed`, 'trace.missing': 'none', 'trace.planned': 'In a task', 'trace.tested': 'Covered by a test', 'trace.passed': 'Passing',
    'side.blockers': 'Blockers', 'side.noBlockers': 'None recorded.', 'side.deps': 'Dependencies', 'side.first': 'Must be delivered first', 'side.waitingThis': 'Waiting for this run', 'side.notOpened': 'not opened',
    'side.check': 'Gate check', 'side.accepted': 'accepted', 'side.rejected': 'rejected', 'side.noValidator': 'scripts/validate-gates.mjs is not in this repository.', 'side.localOnly': 'Local check only. Merges, CI and tracker state were not asked of GitHub.', 'side.warnings': (p) => n(p.n, 'warning', 'warnings'), 'side.more': (p) => `${p.n} more`,
    'side.docs': 'Documents', 'side.missing': 'missing', 'side.review': (p) => `Review: ${p.verdict || 'no verdict yet'} · open findings: ${p.b} blocker, ${p.m} major, ${p.mi} minor`,
    'comp.ready': (p) => n(p.n, 'decision ready', 'decisions ready'), 'comp.clear': 'Clear', 'comp.preview': 'Preview', 'comp.copy': 'Copy reply', 'comp.send': 'Send to Orchestrator',
    'dlg.title': 'Reply for the Orchestrator', 'dlg.note': 'Paste this into the Orchestrator session, or send it from the board. It records each decision with your name and the time; the board itself changes nothing.', 'dlg.close': 'Close', 'dlg.copy': 'Copy',
    'toast.pickFirst': 'Pick an option or write an answer first', 'toast.copied': 'Copied. Paste it into the Orchestrator session.', 'toast.selectCopy': 'Select the text and copy it', 'toast.started': 'Sent. The Orchestrator is starting.', 'toast.queued': 'Sent. It runs after the session in progress.', 'toast.sent': 'Sent. Tell the Orchestrator "decisions sent".', 'toast.notSent': (p) => `Not sent. ${p.msg}`, 'toast.partly': (p) => `Partly sent. ${p.msg}`,
    'auto.on': (p) => `Auto-run is on (${p.tool}${p.budget ? `, up to $${p.budget} a session` : ', no budget cap'}). Each Send starts the Orchestrator; it stops at the next human gate.`,
    'auto.running': (p) => `The Orchestrator (${p.tool}) is working on ${p.run} since ${p.at}, started by your Send. The board updates as it writes.${p.queued ? ` ${p.queued} more waiting.` : ''}`,
    'auto.stale': (p) => `The Orchestrator's auto-run session for ${p.run} ended at ${p.at}, and the run has changed since${p.stage ? `: it is now at ${p.stage}` : ''}. Its report is older than the board, so it is not shown here; read the board. Auto-run is on for the next Send.`,
    'auto.finished': (p) => `The Orchestrator finished ${p.run} at ${p.at} (${p.result}${p.cost ? `, $${p.cost}` : ''}). Auto-run is on for the next Send.`, 'auto.output': 'Output',
    'legend.title': 'Legend', 'legend.owner': 'waiting on you', 'legend.agents': 'agents working', 'legend.blocked': 'blocked or failed', 'legend.passed': 'gate passed', 'legend.human': 'gate only a person passes', 'legend.note': 'This page shows what the manifests and artifacts say. It proves nothing and passes no gate; the gate check is the local validator only.',
    'empty.title': 'No run yet', 'empty.text': 'A run appears here once sdlc/runs/<runId>/run.json exists.',
  };
  return { en };
}
const MSG = boardMessages();
const say = (key, p) => { const m = MSG.en[key]; return typeof m === 'function' ? m(p || {}) : m; };
// The reproduction of a bug run, in the words of `t` (the page's or board.md's).
function reproText(r, t) {
  const rep = r.reproduction;
  if (!rep) return t('gate.notReproduced');
  if (rep.shown.length === rep.files.length) return t('gate.reproduced', { files: rep.files.join(', '), n: rep.files.length, commit: rep.commit });
  return t('gate.reproFailed', { files: rep.files.filter((f) => !rep.shown.includes(f)).join(', '), commit: rep.commit });
}

// ---------------------------------------------------------------------------------------------
// Markdown reading

function stripMd(s) {
  return String(s ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function splitRow(line) {
  const t = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '');
  return t.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}
// Every pipe table outside code fences, with the heading it sits under.
function parseTables(text) {
  const tables = [];
  if (!text) return tables;
  let inFence = false;
  let heading = '';
  let cur = null;
  const flush = () => { if (cur?.sepSeen) tables.push(cur); cur = null; };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { flush(); inFence = !inFence; continue; }
    if (inFence) continue;
    const h = line.match(/^#{1,6}\s+(.*?)\s*$/);
    if (h) { flush(); heading = stripMd(h[1]); continue; }
    if (/^\s*\|/.test(line)) {
      const cells = splitRow(line);
      if (!cur) cur = { heading, header: cells, rows: [], sepSeen: false };
      else if (!cur.sepSeen && cells.every((c) => /^:?-+:?$/.test(c))) cur.sepSeen = true;
      else if (cur.sepSeen) cur.rows.push(cells);
      else cur = { heading, header: cells, rows: [], sepSeen: false };
    } else flush();
  }
  flush();
  return tables;
}
const colIndex = (header, re) => header.findIndex((h) => re.test(stripMd(h).toLowerCase()));
const uniq = (xs) => [...new Set(xs)];

function normalizeGate(s) {
  const raw = stripMd(s);
  const k = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!k) return null;
  for (const g of GATES) {
    if (k === g.toLowerCase() || k === GATE_LABEL[g].toLowerCase().replace(/[^a-z]/g, '')) return { gate: g, label: GATE_LABEL[g] };
  }
  const alias = { acceptance: 'humanAcceptance', specification: 'businessApproval', spec: 'businessApproval', plan: 'planApproval', test: 'tests' };
  if (alias[k]) return { gate: alias[k], label: GATE_LABEL[alias[k]] };
  return { gate: null, label: raw };
}

// Options written as "(a) ...; (b) ..." or as "**label**: ... **label**: ...". Anything else is free text.
// Letter markers are taken in order, so a reference to another option inside an option's text
// ("(c) as (a), plus ...") stays part of that text. Before "(a)" a few words are dropped, and a longer
// text that ends a sentence (". " or ": ") is kept as the context the options share (the list's `lead`),
// as when an example common to every option comes first. A longer text that does not end a sentence
// leaves the whole cell free text: "(a)" is then more likely a reference inside a sentence.
function splitOptions(raw) {
  const s = String(raw ?? '').trim();
  const plain = stripMd(s);
  if (!plain || /^[—–-]+(\s|$)/.test(plain)) return [];
  const letters = [];
  for (const m of plain.matchAll(/(^|[\s;,.:])\(([a-h])\)\s+/g)) if (m[2] === String.fromCharCode(97 + letters.length)) letters.push(m);
  const lead = letters.length ? plain.slice(0, letters[0].index).trim() : '';
  if (letters.length >= 2 && (lead.length <= 12 || /[.:]$/.test(lead))) {
    const opts = letters.map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < letters.length ? letters[i + 1].index + letters[i + 1][1].length : plain.length;
      const text = plain.slice(start, end).trim().replace(/[;,]\s*$/, '').replace(/\s+or$/i, '').replace(/[;,]$/, '').trim();
      return { label: `(${m[2]})`, text, value: `(${m[2]}) ${text}` };
    });
    opts.lead = lead.length > 12 ? lead : '';
    return opts;
  }
  const bold = [...s.matchAll(/\*\*([^*]+?)\*\*\s*:/g)];
  if (bold.length >= 2) {
    return bold.map((m, i) => {
      const start = m.index + m[0].length;
      const end = i + 1 < bold.length ? bold[i + 1].index : s.length;
      const label = stripMd(m[1]);
      return { label, text: stripMd(s.slice(start, end)).replace(/[;.]$/, ''), value: label };
    });
  }
  return [];
}

// The option a recommendation names: "(b) ..." for lettered options, or the label it starts with. The letter may
// follow a word or two that say it is the choice: "Choose (b)", "I recommend (b)". An analyst may begin a
// recommendation that way; read from its first character only, it would mark no option as recommended.
function recommendedOption(opts, rec) {
  if (!rec || !opts.length) return null;
  const plain = stripMd(rec);
  const letter = plain.match(/^(?:[^\s()]+\s+){0,2}\(([a-h])\)/);
  if (letter) return opts.find((o) => o.label === `(${letter[1]})`) || null;
  return opts.find((o) => plain.toLowerCase().startsWith(o.label.toLowerCase())) || null;
}

function parseClarification(text) {
  const questions = [];
  const recommendations = new Map();
  if (!text) return { questions, recommendations };
  for (const t of parseTables(text)) {
    const iId = colIndex(t.header, /^id$/);
    const iDec = colIndex(t.header, /^decision$/);
    if (iId < 0 || iDec < 0) continue;
    const get = (row, re) => { const i = colIndex(t.header, re); return i < 0 ? '' : (row[i] ?? '').trim(); };
    for (const row of t.rows) {
      const id = stripMd(row[iId]);
      const question = get(row, /^question/);
      if (!id || !stripMd(question)) continue;
      const decision = (row[iDec] ?? '').trim();
      const plain = stripMd(decision);
      const open = !plain || /^open\b/i.test(plain);
      questions.push({
        id,
        section: t.heading.replace(/^[A-Z0-9]{1,3}[.)]\s+/, ''),
        question,
        why: get(row, /^why/),
        affects: get(row, /^affects/),
        options: get(row, /^options/),
        decision,
        open,
        note: open ? plain.replace(/^open\b\s*[—–:-]*\s*/i, '') : '',
        by: stripMd(get(row, /^decided by/)),
        at: stripMd(get(row, /^decided at/)),
        evidence: get(row, /^evidence/),
        neededBefore: normalizeGate(get(row, /^needed before/)),
        security: (() => { const a = stripMd(get(row, /^security/)); return a && !NOT_SENSITIVE.test(a) ? a : ''; })(),
      });
    }
  }
  // Recommendations: "- <ID>: <text>" bullets under a heading that starts with "Proposals".
  const ids = new Set(questions.map((q) => q.id));
  let inProposals = false;
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { inProposals = /^proposals?\b/i.test(stripMd(h[1])); continue; }
    if (!inProposals) continue;
    const b = line.match(/^\s*[-*]\s+\*{0,2}`?([A-Za-z][A-Za-z0-9]*-[A-Za-z0-9-]*[A-Za-z0-9])`?\*{0,2}\s*[:—–]\s*(.+)$/);
    if (b && ids.has(b[1])) recommendations.set(b[1], b[2].trim());
  }
  return { questions, recommendations };
}

// "### TASK-NN — title" sections, as scripts/validate-gates.mjs reads them, with their bold fields.
function parseTasks(text, file) {
  const tasks = [];
  if (!text) return tasks;
  let inFence = false;
  let cur = null;
  let field = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const m = h[2].match(/^(TASK-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*)\s*(?:[—–:-]+\s*(.*))?$/);
      if (m) { cur = { id: m[1], title: stripMd(m[2] || ''), depth: h[1].length, fields: {}, file }; tasks.push(cur); field = null; }
      else if (cur && h[1].length <= cur.depth) cur = null;
      continue;
    }
    if (!cur) continue;
    const f = line.match(/^\s?[-*]\s+\*\*([^*:]+):?\*\*:?\s*(.*)$/);
    if (f) { field = f[1].trim().toLowerCase(); cur.fields[field] = f[2].trim(); continue; }
    const sub = line.match(/^\s{2,}[-*]\s+(.*)$/);
    if (sub && field) cur.fields[field] = `${cur.fields[field]} ${sub[1]}`.trim();
  }
  return tasks.map((t) => {
    const c = (t.fields.complexity || '').match(/^`?([A-Za-z]+)`?\s*(?:[—–:-]+\s*(.*))?$/);
    const level = c && MODEL[c[1].toLowerCase()] ? c[1].toLowerCase() : null;
    const dependsText = t.fields['depends on'] || '';
    return {
      id: t.id,
      title: t.title,
      file: t.file,
      level,
      reason: c ? stripMd(c[2] || '') : '',
      acs: taskCriteria(t.fields['acceptance criteria']),
      dependsOn: uniq((dependsText.match(TASK_RE) || []).filter((d) => d !== t.id)),
      hasSkills: Boolean(stripMd(t.fields.skills || '')),
      ownerCheck: /^none\b/i.test(stripMd(t.fields['owner check'] || '')) ? '' : stripMd(t.fields['owner check'] || ''),
    };
  });
}

function parseSpecAcs(text) {
  const acs = [];
  const tables = parseTables(text);
  for (const t of tables) {
    const iId = colIndex(t.header, /^id$/);
    if (iId < 0) continue;
    const iGiven = colIndex(t.header, /^given$/);
    const iWhen = colIndex(t.header, /^when$/);
    const iThen = colIndex(t.header, /^then$/);
    const iRules = colIndex(t.header, /^(business )?rules?$/);
    for (const row of t.rows) {
      const id = acPrefix(stripMd(row[iId]));
      if (!/^AC-/.test(id) || acs.some((a) => a.id === id)) continue;
      const at = (i) => (i >= 0 ? stripMd(row[i] || '') : '');
      acs.push({ id, given: at(iGiven), when: at(iWhen), then: stripMd(iThen >= 0 ? row[iThen] : row[1] || ''), rules: at(iRules), cases: [] });
    }
  }
  if (!acs.length && text) for (const id of uniq((acPrefix(text).match(AC_RE) || []).filter((x) => !CASE_RE.test(x)))) acs.push({ id, given: '', when: '', then: '', rules: '', cases: [] });
  // The cases of a criterion, as the gate validator reads them: in a table that is not a table of criteria, every
  // row whose first cell begins with the id of a case (AC-03.2). The values a criterion holds for are its cases,
  // not criteria of their own: written as criteria, the values of a few business rules make dozens of them.
  for (const t of tables) {
    if (colIndex(t.header, /^id$/) >= 0) continue;
    for (const row of t.rows) {
      const m = acPrefix(stripMd(row[0] || '')).match(CASE_AT_START);
      const ac = m && acs.find((a) => a.id === m[1]);
      const id = m ? `${m[1]}.${Number(m[2])}` : '';
      if (!ac || ac.cases.some((c) => c.id === id)) continue;
      ac.cases.push({ id, cells: t.header.slice(1).map((h, i) => [stripMd(h), stripMd(row[i + 1] || '')]) });
    }
  }
  return acs;
}

// The rows `A-NN` of a table with an ID column, as the "Assumptions" section of the specification template has
// them: the default the analyst took where the sources leave a point open.
function parseSpecAssumptions(text) {
  const out = [];
  for (const t of parseTables(text)) {
    const iId = colIndex(t.header, /^id$/);
    if (iId < 0) continue;
    const iText = colIndex(t.header, /^(assumption|default)/);
    for (const row of t.rows) {
      const id = stripMd(row[iId]);
      if (!/^A-\d+$/i.test(id) || out.some((a) => a.id === id)) continue;
      const said = stripMd(iText >= 0 ? row[iText] : row[iId + 1] || '');
      if (said) out.push({ id, text: said });
    }
  }
  return out;
}

// The rows of the "Decisions" table of the technical plan: what the plan decides where the criteria leave it a
// choice, each with the security-sensitive area it settles, or none. The owner approves them with the plan, so
// the approval card of the plan lists them, as the card of the specification lists its assumptions. A card
// that names only the number of tasks and waves hides them, and the owner cannot tell which of them needs a
// decision of the owner's own.
function parsePlanDecisions(text) {
  const out = [];
  for (const t of parseTables(text)) {
    if (!/^decisions$/i.test(t.heading)) continue;
    const iId = colIndex(t.header, /^id$/);
    const iText = colIndex(t.header, /^decision/);
    const iArea = colIndex(t.header, /^security-sensitive/);
    if (iId < 0 || iText < 0) continue;
    for (const row of t.rows) {
      const id = stripMd(row[iId]);
      const said = stripMd(row[iText] || '');
      if (!id || !said || out.some((d) => d.id === id)) continue;
      const area = iArea >= 0 ? stripMd(row[iArea] || '') : '';
      out.push({ id, text: said, area: /^(no|none|n\/a|-)?$/i.test(area) ? '' : area });
    }
  }
  // Those in a security-sensitive area first, each group in the order of the plan.
  return [...out.filter((d) => d.area), ...out.filter((d) => !d.area)];
}

function parseTests(text) {
  const tests = [];
  for (const t of parseTables(text)) {
    const iT = colIndex(t.header, /^test id$/);
    const iR = colIndex(t.header, /^result/);
    if (iT < 0 || iR < 0) continue;
    const iA = colIndex(t.header, /^ac$/);
    for (const row of t.rows) {
      const id = stripMd(row[iT]);
      if (!id) continue;
      const result = (stripMd(row[iR]).toUpperCase().match(/[A-Z_]+/) || [''])[0];
      tests.push({ id, result, acs: idsOf((iA >= 0 ? row[iA] : '') || '') });
    }
  }
  return tests;
}

function parseModelRows(text) {
  const rows = [];
  for (const t of parseTables(text)) {
    if (!/^model per task$/i.test(t.heading)) continue;
    const idx = { task: colIndex(t.header, /^task/), step: colIndex(t.header, /^step/), level: colIndex(t.header, /^complexity/), model: colIndex(t.header, /^model/), confirmed: colIndex(t.header, /^confirmed/) };
    if (idx.task < 0 || idx.step < 0) continue;
    for (const row of t.rows) {
      const cell = (k) => (idx[k] >= 0 ? stripMd(row[idx[k]]) : '');
      const tasks = uniq(cell('task').match(TASK_RE) || []);
      if (!tasks.length) continue;
      rows.push({ tasks, step: cell('step').toLowerCase(), level: cell('level').toLowerCase(), model: cell('model'), confirmed: cell('confirmed').toUpperCase() });
    }
  }
  return rows;
}

// The rows of "Checked by the owner" in the delivery dossier: after each task the Orchestrator stops for the
// owner to check it, and writes the owner's word into the task's row. A row without a word is a task that
// waits for the owner.
function parseOwnerChecks(text) {
  const rows = [];
  for (const t of parseTables(text)) {
    if (!/^checked by the owner$/i.test(t.heading)) continue;
    const idx = { task: colIndex(t.header, /^task/), word: colIndex(t.header, /^owner/), at: colIndex(t.header, /^at$/) };
    if (idx.task < 0 || idx.word < 0) continue;
    for (const row of t.rows) {
      const cell = (k) => (idx[k] >= 0 ? stripMd(row[idx[k]]) : '');
      const word = /^<.*>$/.test(cell('word')) ? '' : cell('word');
      for (const id of uniq(cell('task').match(TASK_RE) || [])) rows.push({ task: id, word, at: cell('at') });
    }
  }
  return rows;
}

function parseReview(text) {
  if (!text) return null;
  // The last verdict stands, as the gate validator reads it: a later round of the review is written below the first.
  const v = [...text.matchAll(/Verdict:\s*`?(APPROVE_FOR_HUMAN_REVIEW|CHANGES_REQUIRED)`?(.*)$/gm)].filter((m) => !/\bor\b/.test(m[2])).pop();
  const verdict = v ? v[1] : null;
  const open = { BLOCKER: 0, MAJOR: 0, MINOR: 0 };
  const openIds = [];
  let total = 0;
  for (const t of parseTables(text)) {
    const iS = colIndex(t.header, /^severity/);
    const iD = colIndex(t.header, /^disposition/);
    const iId = colIndex(t.header, /^id$/);
    if (iS < 0) continue;
    for (const row of t.rows) {
      const sev = (stripMd(row[iS]).toUpperCase().match(/BLOCKER|MAJOR|MINOR/) || [])[0];
      if (!sev) continue;
      total += 1;
      const disp = iD >= 0 ? stripMd(row[iD]).toUpperCase() : 'OPEN';
      if (!disp || /^OPEN/.test(disp)) {
        open[sev] += 1;
        const fid = iId >= 0 ? stripMd(row[iId]) : '';
        if (fid) openIds.push(fid);
      }
    }
  }
  return { verdict, open, openIds, total };
}

function runValidator(manifestRel) {
  const validator = join(root, 'scripts', 'validate-gates.mjs');
  if (!existsSync(validator)) return { status: 'missing', problems: [], warnings: [] };
  const r = spawnSync(process.execPath, [validator, manifestRel], { cwd: root, encoding: 'utf8' });
  const problems = [];
  const warnings = [];
  for (const line of `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/)) {
    if (line.startsWith('- ')) problems.push(line.slice(2));
    else if (line.startsWith('WARNING: ') && !/^WARNING: manifest only/.test(line)) warnings.push(line.slice(9));
  }
  return { status: r.status === 0 ? 'accepted' : 'rejected', problems, warnings };
}

// ---------------------------------------------------------------------------------------------
// One run, read from disk

function titleFrom(m, inputText, runId) {
  if (typeof m?.title === 'string' && m.title.trim()) return m.title.trim();
  if (inputText) {
    const sec = inputText.match(/^#{2,3}\s+(?:feature )?title\s*$([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im);
    const line = sec?.[1].split(/\r?\n/).map((x) => stripMd(x)).find(Boolean);
    if (line) return line;
    const h1 = inputText.match(/^#\s+(.*)$/m);
    if (h1) {
      const t = stripMd(h1[1]).replace(new RegExp(`\\s*[—–-]\\s*${runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '');
      if (t && !/^(original requirement|input)$/i.test(t)) return t;
    }
  }
  return runId;
}

// What scripts/lock-tests.mjs reproduce wrote for a bug run: the commit, and which test files failed there.
function readReproduction(p) {
  if (!p) return null;
  try {
    const j = JSON.parse(read(p) || 'null');
    if (!j || typeof j.files !== 'object' || !j.files) return null;
    const files = Object.keys(j.files).sort();
    return { commit: String(j.commit || '').slice(0, 10), files, shown: files.filter((f) => j.files[f]?.result === 'REPRODUCED') };
  } catch { return null; }
}

// What scripts/lock-tests.mjs calibrate wrote: the files that failed on the base while no control passed
// there. Such a result tells nothing: a base without the code fails every test.
function readCalibration(p) {
  if (!p) return null;
  try {
    const j = JSON.parse(read(p) || 'null');
    if (!j || typeof j.files !== 'object' || !j.files) return null;
    const uncontrolled = Object.keys(j.files).filter((f) => j.files[f]?.result === 'DEPENDS_ON_CHANGE' && !j.files[f].control).sort();
    return { uncontrolled };
  } catch { return null; }
}

function loadRun(dir) {
  const folder = basename(dir);
  const manifestRel = relPath(join(dir, 'run.json'));
  let m;
  try { m = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { return { id: folder, folder, dir, manifestRel, error: `run.json cannot be read (${e.message.split('\n')[0]})` }; }
  const ap = m.artifactPaths && typeof m.artifactPaths === 'object' ? m.artifactPaths : {};
  const path = (key, fallback) => {
    if (typeof ap[key] === 'string' && ap[key]) return ap[key];
    const f = fallback && relPath(join(dir, fallback));
    return f && existsSync(join(root, f)) ? f : null;
  };
  const id = typeof m.runId === 'string' && m.runId ? m.runId : folder;
  const manifestText = read(manifestRel) || '';
  const inputPath = path('input', 'input.md');
  const clarText = read(path('clarification', 'clarification.md')) || '';
  const clar = parseClarification(clarText);
  // Replies the owner sent from the board. A file is recorded once clarification.md cites it.
  const decisionFiles = [];
  const decisionsDir = join(dir, 'decisions');
  if (existsSync(decisionsDir)) {
    const known = new Set(clar.questions.map((q) => q.id));
    for (const name of readdirSync(decisionsDir).filter((n) => n.endsWith('.md')).sort()) {
      const text = read(relPath(join(decisionsDir, name))) || '';
      const lines = new Map();
      for (const m of text.matchAll(/^([A-Za-z][A-Za-z0-9]*-[A-Za-z0-9-]*[A-Za-z0-9]):[ \t]+(.+)$/gm)) if (known.has(m[1])) lines.set(m[1], m[2].trim());
      const gateLines = new Map();
      for (const g of text.matchAll(GATE_LINE)) gateLines.set(g[1], { verdict: g[2], rest: g[3].trim() });
      // Recorded once the Orchestrator cites the file: in clarification.md for decisions, in run.json for a gate approval.
      decisionFiles.push({ name, path: relPath(join(decisionsDir, name)), at: (text.match(/^- Sent at:\s*(\S+)/m) || [])[1] || '', lines, gateLines, recorded: clarText.includes(name) || manifestText.includes(name) });
    }
    for (const f of decisionFiles.filter((x) => !x.recorded)) {
      for (const q of clar.questions) if (q.open && f.lines.has(q.id)) q.sent = { value: f.lines.get(q.id), at: f.at, file: f.name };
    }
  }
  const planPath = path('plan');
  const tasksPath = path('tasks');
  const tasks = [];
  for (const p of uniq([planPath, tasksPath].filter(Boolean))) tasks.push(...parseTasks(read(p), p));
  const modelRows = parseModelRows(read(path('delivery')) || '');
  const ownerChecks = parseOwnerChecks(read(path('delivery')) || '');
  // Rows with more or fewer cells than their table has columns. A "|" inside a cell ends the cell, also inside a
  // code span, so everything after it is read from the wrong column: a decision of the plan that quotes a usage
  // line can then show on the approval card as a decision in a security-sensitive area.
  const tableRows = [];
  for (const p of uniq([path('clarification', 'clarification.md'), path('spec'), planPath, tasksPath, path('testPlan'), path('testReport'), path('delivery'), path('review')].filter(Boolean))) {
    for (const t of parseTables(read(p) || '')) {
      for (const row of t.rows) {
        if (row.length === t.header.length || row.every((c) => !stripMd(c))) continue;
        tableRows.push({ file: basename(p), first: stripMd(row[0]).slice(0, 40), heading: t.heading });
      }
    }
  }
  // Rows under "Not covered" in the test plan that nobody accepted. Such a row may name no criterion, so no
  // other check reads it, and the owner could accept the delivery from a list that does not name it.
  const openGaps = [];
  for (const t of parseTables(read(path('testPlan', 'test-plan.md')) || '')) {
    if (!/^not covered$/i.test(stripMd(t.heading))) continue;
    const iWho = t.header.findIndex((h) => /accepted/i.test(stripMd(h)));
    for (const row of t.rows) {
      const what = stripMd(row[0] ?? '');
      const who = iWho >= 0 ? stripMd(row[iWho] ?? '') : '';
      if (what && (!who || /^<.*>$/.test(who))) openGaps.push(what.length > 60 ? `${what.slice(0, 60)}…` : what);
    }
  }
  for (const t of tasks) {
    const rows = modelRows.filter((r) => r.tasks.includes(t.id));
    t.dev = rows.some((r) => r.step === 'developer');
    t.qa = rows.some((r) => r.step === 'qa');
    t.repairs = rows.filter((r) => r.step === 'repair').length;
    // Checked: the owner's word is in the task's row. Awaiting: the row is there and the word is not.
    const checks = ownerChecks.filter((c) => c.task === t.id);
    t.checked = checks.some((c) => c.word);
    t.awaitsCheck = checks.length > 0 && !t.checked;
    t.model = rows.length ? rows[rows.length - 1].model : (t.level ? MODEL[t.level] : '');
  }
  // The version of the documents behind each human gate: what an approval card names, so that an approval
  // given for one version is never recorded for another.
  const gateVersions = {};
  for (const [gate, keys] of Object.entries(GATE_DOCS)) {
    const there = (p) => p && existsSync(resolve(root, p));
    const own = uniq(keys.map((k) => path(k)).filter(there));
    if (!own.length) continue;
    const files = uniq([...own, ...(GATE_WITH[gate] || []).map(([k, usual]) => path(k, usual)).filter(there)]);
    const h = createHash('sha256');
    for (const f of files) h.update(`${basename(f)}\0`).update(readFileSync(resolve(root, f))).update('\0');
    gateVersions[gate] = { files, label: `${files.map((f) => basename(f)).join('+')}@${h.digest('hex').slice(0, 12)}` };
  }
  // A passed human gate whose local record approved its documents at another version than they have now. The
  // record is read as the gate validator reads it: the last "<gate>: APPROVE <documents>@<version>" line. The
  // validator rejects such a run, so the board gives the owner the approval again instead of calling the gate
  // passed: it would otherwise read "Accepted … One step is left: merge it" while the validator rejects the run.
  // A record without such a line is not judged here; the validator says so in the gate check.
  const staleApprovals = {};
  if (m.currentStage !== 'CANCELLED') {
    for (const gate of Object.keys(GATE_DOCS)) {
      const rec = m.approvals?.[gate];
      if (m.gateResults?.[gate] !== 'PASSED' || !gateVersions[gate] || rec?.kind !== 'local-record' || typeof rec.recordPath !== 'string') continue;
      const said = [...(read(rec.recordPath) || '').matchAll(new RegExp(`\\b${gate}:\\s*APPROVE\\s+\x60?([^\\s\x60@]+@[0-9a-f]{12})`, 'g'))];
      const approved = said.length ? said[said.length - 1][1] : null;
      if (approved && approved !== gateVersions[gate].label) staleApprovals[gate] = { approved, now: gateVersions[gate].label };
    }
  }
  const sentGates = new Map();
  for (const f of decisionFiles.filter((x) => !x.recorded)) for (const [g, v] of f.gateLines) sentGates.set(g, { ...v, at: f.at, file: f.name });
  const artifacts = Object.entries(ap).map(([key, p]) => ({ key, path: typeof p === 'string' && p ? p : null, exists: typeof p === 'string' && p ? existsSync(resolve(root, p)) : false }));
  const gates = {};
  for (const g of GATES) gates[g] = m.gateResults?.[g] || 'MISSING';
  return {
    id,
    folder,
    dir,
    manifestRel,
    m,
    title: titleFrom(m, read(inputPath) || '', id),
    stage: m.currentStage || 'UNKNOWN',
    mode: m.approvalMode || 'unknown',
    light: m.track === 'light',
    trackDecision: m.track === 'light' && m.trackDecision && typeof m.trackDecision === 'object' ? m.trackDecision : null,
    revision: m.revision ?? '?',
    updatedAt: m.updatedAt || '',
    owner: m.owner || 'the owner',
    ticketRef: m.ticketRef || '',
    gates,
    approvals: m.approvals || {},
    blockers: Array.isArray(m.openBlockers) ? m.openBlockers.filter((x) => typeof x === 'string') : [],
    blockedReason: typeof m.notes?.blockedReason === 'string' ? m.notes.blockedReason : null,
    dependsOn: Array.isArray(m.dependsOn) ? uniq(m.dependsOn.filter((x) => typeof x === 'string' && x)) : [],
    prUrl: m.externalEvidence?.prUrl || null,
    questions: clar.questions,
    recommendations: clar.recommendations,
    decisionFiles,
    gateVersions,
    staleApprovals,
    sentGates,
    clarificationPath: path('clarification', 'clarification.md'),
    tasks,
    hasPlan: Boolean(planPath && existsSync(resolve(root, planPath))),
    acs: parseSpecAcs(read(path('spec')) || ''),
    assumptions: parseSpecAssumptions(read(path('spec')) || ''),
    decisions: parsePlanDecisions(read(path('plan')) || ''),
    bug: m.kind === 'bug',
    confidential: m.confidential === true,
    reproduction: readReproduction(path('reproduction', 'evidence/reproduction.json')),
    calibration: readCalibration(path('testCalibration')),
    tests: parseTests(read(path('testReport')) || ''),
    modelRows,
    tableRows,
    openGaps,
    review: parseReview(read(path('review'))),
    validator: runValidator(manifestRel),
    artifacts,
  };
}

// ---------------------------------------------------------------------------------------------
// What the board shows, derived from one run and the others it depends on

function findRun(runs, ref) {
  return runs.find((r) => r.id === ref || r.folder === ref) || runs.find((r) => r.id.startsWith(`${ref}-`) || r.folder.startsWith(`${ref}-`)) || null;
}

function view(r, runs) {
  if (r.error) return null;
  const deps = r.dependsOn.map((ref) => { const d = findRun(runs, ref); return { ref, run: d, stage: d ? d.stage : null }; });
  const dependents = runs.filter((o) => o !== r && !o.error && o.dependsOn.some((ref) => findRun(runs, ref) === r));

  let cur = STEPS.findIndex((s) => s.stages.includes(r.stage));
  if (cur < 0) { cur = STEPS.findIndex((s) => s.gate && r.gates[s.gate] !== 'PASSED'); if (cur < 0) cur = STEPS.length - 1; }

  const open = r.questions.filter((q) => q.open);
  const decided = r.questions.filter((q) => !q.open);
  const curGate = STEPS[cur].gate;
  const order = (g) => GATES.indexOf(g);
  const now = [];
  const later = [];
  const unsorted = [];
  for (const q of open) {
    const g = q.neededBefore?.gate;
    if (!g || !curGate) unsorted.push(q);
    else if (order(g) <= order(curGate)) now.push({ ...q, late: r.gates[g] === 'PASSED' });
    else later.push(q);
  }

  const unrecorded = r.decisionFiles.filter((f) => !f.recorded);
  // The human gate the owner can decide on the board now, if any.
  // An approval that no longer covers its documents is offered again, whatever the stage, for the documents now.
  let gate = null;
  const again = STALE_ORDER.find((g) => r.staleApprovals[g]);
  for (const g of HUMAN) {
    if (again ? g !== again : (r.stage !== GATE_STAGE[g] || r.gates[g] === 'PASSED' || !r.gateVersions[g])) continue;
    if (g === 'planApproval' && r.light) continue; // a light run has no plan approval
    const ord = GATES.indexOf(g);
    const needs = open.filter((q) => !q.sent && (!q.neededBefore?.gate || GATES.indexOf(q.neededBefore.gate) <= ord)).map((q) => q.id);
    gate = { gate: g, ask: GATE_ASK[g], version: r.gateVersions[g], needs, sent: r.sentGates.get(g) || null };
  }
  const next = nextAction(r, { deps, now, unsorted, open, unrecorded });
  const steps = STEPS.map((s, i) => {
    const g = s.gate ? r.gates[s.gate] : null;
    let state = 'todo';
    if (i === cur) {
      if (r.stage === 'BLOCKED') state = 'blocked';
      else if (r.stage === 'CANCELLED') state = 'cancelled';
      else if (r.stage === 'DONE') state = 'passed';
      else if (r.stage === 'FIX_REQUIRED') state = 'repair';
      else if (s.gate && r.staleApprovals[s.gate]) state = 'owner';
      else if (next.who === 'done' || (s.gate && g === 'PASSED')) state = 'passed';
      else if (next.who === 'owner') state = 'owner';
      else state = 'current';
    } else if (s.gate && r.staleApprovals[s.gate]) state = 'owner';
    else if (g === 'PASSED' || (!s.gate && r.stage === 'DONE')) state = 'passed';
    else if (g === 'FAILED') state = 'failed';
    else if (g === 'WAIVED') state = 'waived';
    else if (g === 'BLOCKED') state = 'blocked';
    const a = s.gate && HUMAN.has(s.gate) ? r.approvals?.[s.gate] : null;
    const evidence = a && typeof a === 'object' ? [a.by && `by ${a.by}`, a.at && fmtDate(a.at), a.kind === 'pull-request' ? a.prUrl : a.recordPath].filter(Boolean) : [];
    return { ...s, state, result: g, human: Boolean(s.gate && HUMAN.has(s.gate)), evidence };
  });

  // Tasks in waves: a task runs after every task it depends on.
  const byId = new Map(r.tasks.map((t) => [t.id, t]));
  const level = new Map();
  const visiting = new Set();
  const cyclic = new Set();
  const lv = (id) => {
    if (level.has(id)) return level.get(id);
    if (visiting.has(id)) { cyclic.add(id); return 1; }
    visiting.add(id);
    let l = 1;
    for (const d of byId.get(id).dependsOn) if (byId.has(d)) l = Math.max(l, lv(d) + 1);
    visiting.delete(id);
    level.set(id, l);
    return l;
  };
  r.tasks.forEach((t) => lv(t.id));
  const waves = [];
  for (const t of r.tasks) { const l = level.get(t.id); (waves[l - 1] ||= []).push(t); }
  const unknownDeps = uniq(r.tasks.flatMap((t) => t.dependsOn.filter((d) => !byId.has(d))));

  // Traceability: each accepted criterion, the tasks that claim it and the tests that cover it. A criterion with
  // cases stands as its cases stand: failed with one case failed, passed only when every case passed. A test that
  // names such a criterion alone covers none of its cases, as the gate validator reads it.
  const bare = (id) => id.replace(/\.[0-9]+$/, '');
  const acList = r.acs.length ? r.acs : uniq([...r.tasks.flatMap((t) => t.acs), ...r.tests.flatMap((t) => t.acs)].map(bare)).map((id) => ({ id, given: '', when: '', then: '', rules: '', cases: [] }));
  const verdict = (tests) => {
    if (tests.some((t) => t.result === 'FAILED')) return 'FAILED';
    if (tests.some((t) => t.result === 'BLOCKED')) return 'BLOCKED';
    if (tests.length && tests.every((t) => t.result === 'PASSED')) return 'PASSED';
    return tests.length ? 'NOT_RUN' : '';
  };
  const trace = acList.map((ac) => {
    const naming = (id) => r.tests.filter((t) => t.acs.includes(id));
    const own = naming(ac.id);
    const cases = (ac.cases || []).map((c) => { const mine = naming(c.id); return { ...c, tests: mine.map((t) => t.id), result: verdict(mine) }; });
    const tasks = r.tasks.filter((t) => t.acs.includes(ac.id) || cases.some((c) => t.acs.includes(c.id))).map((t) => t.id);
    const mine = cases.length ? uniq([...own, ...cases.flatMap((c) => naming(c.id))]) : own;
    let result = verdict(own);
    if (cases.length) {
      if (cases.some((c) => c.result === 'FAILED') || own.some((t) => t.result === 'FAILED')) result = 'FAILED';
      else if (cases.some((c) => c.result === 'BLOCKED') || own.some((t) => t.result === 'BLOCKED')) result = 'BLOCKED';
      else if (cases.every((c) => c.result === 'PASSED')) result = 'PASSED';
      else result = mine.length ? 'NOT_RUN' : '';
    }
    // Covered: a criterion without cases that a test names, or one whose every case a test names.
    const covered = cases.length ? cases.every((c) => c.tests.length) : own.length > 0;
    return { ...ac, cases, tasks, tests: mine.map((t) => t.id), testResults: mine.map((t) => ({ id: t.id, result: t.result })), result, covered };
  });

  // Gaps the owner should see before deciding anything. Each one is read from an artifact, not judged.
  const attentionKeys = [];
  const add = (key, p) => attentionKeys.push({ key, p });
  const ids = (xs) => xs.map((t) => t.id).join(', ');
  if (r.validator.status === 'rejected') add('attn.gateRejected', { n: r.validator.problems.length });
  for (const q of now.filter((x) => x.late)) add('attn.late', { id: q.id, gate: q.neededBefore.gate });
  const sensitive = now.filter((q) => q.security).length;
  if (now.length > MOST_OPEN_QUESTIONS || now.length - sensitive > MAX_OPEN_QUESTIONS) add('attn.manyQuestions', { n: now.length, max: MAX_OPEN_QUESTIONS, most: MOST_OPEN_QUESTIONS, security: sensitive, gate: curGate });
  if (r.tasks.length && trace.length) {
    const noTask = trace.filter((t) => !t.tasks.length);
    if (noTask.length) add('attn.noTask', { n: noTask.length, ids: ids(noTask) });
  }
  if (r.tests.length && trace.length) {
    const noTest = trace.filter((t) => !t.covered);
    if (noTest.length) add('attn.noTest', { n: noTest.length, ids: ids(noTest) });
  }
  const failing = trace.filter((t) => t.result === 'FAILED');
  if (failing.length) add('attn.failing', { n: failing.length, ids: ids(failing), gatePassed: r.gates.tests === 'PASSED' });
  // Every finding left open, a MINOR one too: the owner accepts the delivery with it, so the list does not read
  // "nothing flagged" while one is open.
  if (r.review && (r.review.open.BLOCKER || r.review.open.MAJOR || r.review.open.MINOR)) add('attn.reviewOpen', { blocker: r.review.open.BLOCKER, major: r.review.open.MAJOR, minor: r.review.open.MINOR, ids: r.review.openIds.join(', ') });
  // On a repository with no code before the run, every test file fails on the base by its import: that shows
  // nothing about the tests, though a report to the owner may count it as proof.
  if (r.calibration?.uncontrolled.length && !['DONE', 'CANCELLED'].includes(r.stage)) add('attn.uncontrolled', { n: r.calibration.uncontrolled.length });
  if (r.openGaps.length && !['DONE', 'CANCELLED'].includes(r.stage)) add('attn.gapOpen', { n: r.openGaps.length, what: `${r.openGaps.slice(0, 3).map((x) => `"${x}"`).join(', ')}${r.openGaps.length > 3 ? `, and ${r.openGaps.length - 3} more` : ''}` });
  const unrated = r.tasks.filter((t) => !t.level);
  if (unrated.length) add('attn.unrated', { ids: ids(unrated) });
  // Many criteria, while the specification can still change: a long list is hard to read before the approval,
  // and every later document repeats it.
  if (r.acs.length > MANY_CRITERIA && r.gates.businessApproval !== 'PASSED' && r.stage !== 'CANCELLED') add('attn.manyCriteria', { n: r.acs.length, max: MANY_CRITERIA });
  if (r.tableRows.length && !['DONE', 'CANCELLED'].includes(r.stage)) add('attn.tableRows', { n: r.tableRows.length, where: `${r.tableRows.slice(0, 4).map((x) => `${x.first || '(empty first cell)'} in ${x.file}`).join(', ')}${r.tableRows.length > 4 ? `, and ${r.tableRows.length - 4} more` : ''}` });
  if (cyclic.size) add('attn.cycle', { ids: [...cyclic].join(', ') });
  const attention = attentionKeys.map((a) => say(a.key, a.p));

  return { deps, dependents, cur, steps, next, open, decided, now, later, unsorted, waves, cyclic, unknownDeps, trace, attention, attentionKeys, unrecorded, gate };
}

function nextAction(r, v) {
  // A key into the board's messages and its values, which the page says again; badge and text are the
  // sentence itself, for board.md and the console.
  const out = (who, badgeKey, key, p = {}) => ({ who, badgeKey, key, p, badge: say(badgeKey) || badgeKey, text: say(key, p) });
  const mode = r.mode;
  const pending = v.now.length + v.unsorted.length;
  if (v.unrecorded.length && r.stage !== 'DONE' && r.stage !== 'CANCELLED') {
    const sent = v.open.filter((q) => q.sent).length;
    const left = [...v.now, ...v.unsorted].filter((q) => !q.sent).length;
    return out('agents', 'badge.sent', 'next.sent', { sent, left, files: v.unrecorded.map((f) => `decisions/${f.name}`) });
  }
  // An approval that no longer covers its documents comes before whatever the stage would say next.
  const again = STALE_ORDER.find((g) => r.staleApprovals[g]);
  if (again) return out('owner', 'badge.owner', 'next.reapprove', { gate: again, ...r.staleApprovals[again] });
  const waiting = v.deps.filter((d) => d.stage !== 'DONE').map((d) => ({ id: d.run ? d.run.id : d.ref, stage: d.run ? d.stage : null }));
  switch (r.stage) {
    case 'NEW':
    case 'ANALYSIS':
      return out('agents', 'badge.agents', 'next.analysis', { waiting });
    case 'AWAITING_BUSINESS_DECISION':
      return out('owner', 'badge.owner', 'next.awaitingBusiness', { pending, mode });
    case 'READY_FOR_DESIGN_PLAN':
      // Approved, and no plan yet: planning waits for a session, which the owner starts with the plan command.
      // The start command ends at the business decisions, so no session is drafting the plan here.
      if (!r.hasPlan) return out('owner', 'badge.owner', 'next.readyToPlan', { id: r.id });
      if (r.light) return out('agents', 'badge.agents', 'next.planLight');
      if (r.hasPlan && r.gates.planApproval !== 'PASSED') return out('owner', 'badge.owner', 'next.planReview', { tasks: r.tasks.length, high: r.tasks.filter((t) => t.level === 'high').length, pending, mode });
      return out('agents', 'badge.agents', 'next.planDraft');
    case 'READY_FOR_IMPLEMENTATION':
    case 'IMPLEMENTING': {
      const left = r.tasks.filter((t) => !t.dev).length;
      // A task is built and its row under "Checked by the owner" has no word yet: the Orchestrator has stopped,
      // and the move is the owner's. The board says so, rather than that the agents are at work.
      const waitsFor = r.tasks.find((t) => t.awaitsCheck);
      if (waitsFor) return out('owner', 'badge.owner', 'next.taskCheck', { id: r.id, task: waitsFor.id, title: waitsFor.title, check: waitsFor.ownerCheck, left });
      // Ready, and no task delegated: implementation waits for an interactive session, which the owner starts.
      // A session started by auto-run may not change code, so nobody is implementing yet. It names the command
      // for that session, with the run's ID.
      if (r.stage === 'READY_FOR_IMPLEMENTATION' && left === r.tasks.length) return out('owner', 'badge.owner', 'next.readyToBuild', { id: r.id });
      // Every task is built and has the owner's word: verification waits for a session of its own, which the owner
      // starts with the verify command, as planning and the first task wait for theirs.
      if (!left && r.tasks.length && r.tasks.every((t) => t.checked)) return out('owner', 'badge.owner', 'next.readyToVerify', { id: r.id });
      return left ? out('agents', 'badge.agents', 'next.implementing', { left, total: r.tasks.length }) : out('agents', 'badge.agents', 'next.implementedAll');
    }
    case 'FIX_REQUIRED':
      return out('repair', 'badge.repair', 'next.repair');
    case 'VERIFYING':
      return out('agents', 'badge.agents', 'next.verifying');
    case 'REVIEWING':
      return out('agents', 'badge.agents', 'next.reviewing');
    case 'READY_FOR_ACCEPTANCE':
      // Accepted already. In local-record mode one step is left, the owner's: merge the delivery into the main
      // branch, or tell the Orchestrator to; it then records DONE. In pull-request mode the merge was the
      // acceptance, and the Orchestrator records DONE.
      if (r.gates.humanAcceptance === 'PASSED') {
        if (mode === 'pull-request') return out('agents', 'badge.agents', 'next.acceptedPr', { id: r.id });
        const a = r.approvals?.humanAcceptance;
        return out('owner', 'badge.accepted', 'next.acceptedLocal', { id: r.id, by: (a && a.by) || '', at: a && a.at ? fmtDate(a.at) : '' });
      }
      return out('owner', 'badge.owner', 'next.acceptance', { mode });
    case 'DONE':
      return out('done', 'badge.done', 'next.done');
    case 'CANCELLED':
      return out('done', 'badge.cancelled', 'next.done');
    case 'BLOCKED': {
      const raw = String(r.blockedReason || r.blockers[0] || '').trim();
      const reason = raw ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}${/[.!?]$/.test(raw) ? '' : '.'}` : '';
      return out('blocked', 'badge.blocked', 'next.blocked', { reason, waiting });
    }
    default:
      return out('agents', r.stage, 'next.unknown');
  }
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function fmtDate(s) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return String(s || '');
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
const clip = (s, n) => { const t = stripMd(s); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const rank = { owner: 0, blocked: 1, repair: 2, agents: 3, done: 4 };

// ---------------------------------------------------------------------------------------------
// board.md: Mermaid and tables, for GitHub and for the pull request that carries the run folder

const mmd = (s) => String(s ?? '').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/[\r\n]+/g, ' ');
const nid = (s) => `n_${String(s).replace(/[^A-Za-z0-9]/g, '_')}`;
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const ICON = { passed: '✓', current: '●', owner: '!', blocked: '■', failed: '✕', waived: '~', repair: '↺', cancelled: '–', todo: '' };
const MERMAID_CLASSES = [
  'classDef passed fill:#dcfce7,stroke:#16a34a,color:#14532d',
  'classDef current fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:3px',
  'classDef owner fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:3px',
  'classDef blocked fill:#fee2e2,stroke:#dc2626,color:#7f1d1d,stroke-width:3px',
  'classDef failed fill:#fee2e2,stroke:#dc2626,color:#7f1d1d',
  'classDef repair fill:#ffedd5,stroke:#ea580c,color:#7c2d12,stroke-width:3px',
  'classDef waived fill:#ede9fe,stroke:#7c3aed,color:#4c1d95',
  'classDef cancelled fill:#f4f4f5,stroke:#71717a,color:#3f3f46',
  'classDef todo fill:#f8fafc,stroke:#cbd5e1,color:#64748b',
  'classDef missing fill:#f8fafc,stroke:#94a3b8,color:#64748b,stroke-dasharray:4 3',
  'classDef low fill:#ecfdf5,stroke:#10b981,color:#064e3b',
  'classDef standard fill:#eff6ff,stroke:#3b82f6,color:#1e3a8a',
  'classDef high fill:#fdf2f8,stroke:#db2777,color:#831843,stroke-width:2px',
  'classDef unrated fill:#f8fafc,stroke:#94a3b8,color:#475569',
];
function stageClass(stage) {
  if (stage === 'DONE') return 'passed';
  if (stage === 'BLOCKED') return 'blocked';
  if (stage === 'CANCELLED') return 'cancelled';
  if (stage === 'FIX_REQUIRED') return 'repair';
  if (stage === 'AWAITING_BUSINESS_DECISION' || stage === 'READY_FOR_ACCEPTANCE') return 'owner';
  return 'current';
}
const ALERT = { owner: 'IMPORTANT', blocked: 'CAUTION', repair: 'WARNING', agents: 'NOTE', done: 'TIP' };

function renderMd(r, v) {
  const L = [];
  L.push(`<!-- Generated by scripts/render-run-board.mjs from run.json revision ${r.revision}. Do not edit: change the run's artifacts and render again. -->`, '');
  L.push(`# Run board — ${r.id}`, '');
  if (r.title !== r.id) L.push(`**${cell(r.title)}**`, '');
  L.push(`Stage \`${r.stage}\` · approval mode \`${r.mode}\`${r.light ? ' · light track' : ''}${r.bug ? ` · bug fix${r.confidential ? ', confidential' : ''}` : ''} · revision ${r.revision} · updated ${fmtDate(r.updatedAt)} · owner ${r.owner}${r.ticketRef ? ` · ticket \`${r.ticketRef}\`` : ''}`, '');

  L.push(`> [!${ALERT[v.next.who]}]`, `> **${v.next.badge}.** ${v.next.text}`);
  if (v.gate) {
    const tick = String.fromCharCode(96);
    const docs = v.gate.version.files.map((f) => tick + basename(f) + tick).join(', ');
    const how = r.mode === 'pull-request' ? ` Merge the ${PR_OF[v.gate.gate]} pull request to approve.` : ` Approve on the approval card of ${tick}sdlc/board.html${tick}, or tell the Orchestrator.`;
    const first = v.gate.needs.length ? ` First answer ${v.gate.needs.join(', ')}.` : '';
    L.push('>', `> **${v.gate.ask}** You decide on version ${tick}${v.gate.version.label}${tick} (${docs}).${how}${first}`);
    if (r.light && v.gate.gate === 'businessApproval') L.push('>', `> ${say('gate.lightNote')}`);
    if (v.gate.gate === 'businessApproval' && r.bug) L.push('>', `> **${say('gate.reproTitle')}:** ${reproText(r, say)}`);
    if (v.gate.gate === 'businessApproval' && r.assumptions.length) {
      L.push('>', `> **${say('gate.assumptionsTitle')}.** ${say('gate.assumptions', { n: r.assumptions.length })}`);
      for (const a of r.assumptions) L.push(`> - ${a.id}: ${cell(a.text)}`);
    }
    if (v.gate.gate === 'planApproval' && r.decisions.length) {
      L.push('>', `> **${say('gate.decisionsTitle')}.** ${say('gate.decisions', { n: r.decisions.length, s: r.decisions.filter((d) => d.area).length })}`);
      for (const d of r.decisions) L.push(`> - ${d.id}${d.area ? ` (${say('gate.sensitive')}: ${cell(d.area)})` : ''}: ${cell(clip(d.text, 220))}`);
    }
  }
  if (v.attention.length) {
    L.push('>', '> **Check before you decide:**');
    for (const a of v.attention) L.push(`> - ${a}`);
  } else if (v.gate) {
    // Said even when empty, so that whoever repeats the list can tell an empty list from a missing one.
    L.push('>', '> **Check before you decide:** nothing flagged.');
  }
  L.push('');

  L.push('## Pipeline', '', '```mermaid', 'flowchart LR');
  v.steps.forEach((s, i) => {
    const sub = s.gate ? `${s.human ? '👤 ' : ''}${GATE_LABEL[s.gate]}: ${s.result}` : (r.stage === 'DONE' ? 'delivered' : 'not yet');
    const ev = s.evidence.length ? `<br/>${mmd(s.evidence.slice(0, 2).join(' · '))}` : '';
    L.push(`  S${i}["${ICON[s.state] ? `${ICON[s.state]} ` : ''}${mmd(s.label)}<br/>${mmd(sub)}${ev}"]`);
  });
  L.push(`  ${v.steps.map((_, i) => `S${i}`).join(' --> ')}`);
  v.steps.forEach((s, i) => L.push(`  class S${i} ${s.state}`));
  L.push(...MERMAID_CLASSES.slice(0, 10).map((c) => `  ${c}`), '```', '');
  L.push('👤 marks a gate that only a person passes. A step is green only when its gate is `PASSED` in the manifest.', '');

  L.push(`## Decisions — ${v.open.length} open, ${v.decided.length} decided`, '');
  if (!r.questions.length) L.push('No clarification log yet.', '');
  if (v.unrecorded.length) L.push(`Sent from the board and not yet recorded in \`clarification.md\`: ${v.unrecorded.map((f) => `\`decisions/${f.name}\``).join(', ')}.`, '');
  const qTable = (qs) => {
    L.push('| ID | Question | Options | Needed before | Decider |', '| --- | --- | --- | --- | --- |');
    for (const q of qs) {
      const opts = splitOptions(q.options);
      const rec = r.recommendations.get(q.id);
      const recOpt = recommendedOption(opts, rec);
      const optText = opts.length ? (opts.lead ? `${clip(opts.lead, 200)}<br>` : '') + opts.map((o) => `**${o.label}** ${clip(o.text, 140)}${o === recOpt ? ' _(recommended)_' : ''}`).join('<br>') : clip(q.options, 220);
      const extra = [q.why && `<br>Why: ${clip(q.why, 200)}`, q.note && `<br>_Note: ${clip(q.note, 200)}_`, rec && `<br>_Recommended (not a decision): ${clip(rec, 200)}_`, q.sent && `<br>**Sent ${q.sent.at}, not yet recorded:** ${clip(q.sent.value, 200)}`].filter(Boolean).join('');
      const need = q.neededBefore ? `${q.neededBefore.label}${q.late ? ' ⚠ gate already passed' : ''}` : '—';
      L.push(`| ${cell(q.id)} | ${cell(clip(q.question, 260))}${cell(extra)} | ${cell(optText) || '—'} | ${cell(need)} | ${cell(q.by) || '—'} |`);
    }
    L.push('');
  };
  if (v.now.length) { L.push(`### Decide now — needed before ${GATE_LABEL[v.steps[v.cur].gate] || 'the next gate'}`, ''); qTable(v.now); }
  if (v.unsorted.length) { L.push(v.now.length || v.later.length ? '### Open, no gate named' : '### Open questions', ''); qTable(v.unsorted); }
  if (v.later.length) { L.push('### Can wait — needed at a later gate', ''); qTable(v.later); }
  if (v.open.length) {
    L.push('<details><summary>Reply template for the Orchestrator</summary>', '', '```text', `My decisions as owner (${r.owner}) for run ${r.id}. Record each one in clarification.md with my name and the time, update run.json, then render the board.`, '');
    for (const q of [...v.now, ...v.unsorted, ...v.later]) L.push(`${q.id}: `);
    L.push('```', '', 'Leave out a line you do not want to decide yet. `sdlc/board.html` builds the same reply from options you click.', '', '</details>', '');
  }
  if (v.decided.length) {
    const latest = v.decided.map((q) => q.at).filter(Boolean).sort().pop();
    L.push(`<details><summary>${plural(v.decided.length, 'decided question')}${latest ? `, latest ${latest}` : ''}</summary>`, '', '| ID | Decision | By | At |', '| --- | --- | --- | --- |');
    for (const q of v.decided) L.push(`| ${cell(q.id)} | ${cell(clip(q.decision, 220))} | ${cell(q.by)} | ${cell(q.at)} |`);
    L.push('', '</details>', '');
  }

  L.push(`## Blockers — ${r.blockers.length}`, '');
  if (r.blockers.length) r.blockers.forEach((b, i) => L.push(`${i + 1}. ${b}`));
  else L.push('None recorded in the manifest.');
  L.push('');

  if (v.deps.length || v.dependents.length) {
    L.push('## Dependencies', '', '```mermaid', 'flowchart LR');
    L.push(`  ${nid(r.id)}["${mmd(r.id)}<br/>${mmd(r.stage)}"]`, `  class ${nid(r.id)} ${stageClass(r.stage)}`);
    for (const d of v.deps) {
      const key = nid(d.run ? d.run.id : `missing_${d.ref}`);
      L.push(`  ${key}["${mmd(d.run ? d.run.id : d.ref)}<br/>${mmd(d.run ? d.stage : 'not opened')}"] --> ${nid(r.id)}`, `  class ${key} ${d.run ? stageClass(d.stage) : 'missing'}`);
    }
    for (const o of v.dependents) L.push(`  ${nid(r.id)} --> ${nid(o.id)}["${mmd(o.id)}<br/>${mmd(o.stage)}"]`, `  class ${nid(o.id)} ${stageClass(o.stage)}`);
    L.push(...MERMAID_CLASSES.slice(0, 10).map((c) => `  ${c}`), '```', '');
    L.push('An arrow points from the run that must be delivered first. Stages of other runs are as of this rendering.', '');
  }

  L.push('## Tasks', '');
  if (!r.tasks.length) L.push(r.hasPlan ? 'The plan has no `### TASK-NN` section.' : 'No technical plan yet.', '');
  else {
    L.push('```mermaid', 'flowchart LR');
    v.waves.forEach((wave, i) => {
      L.push(`  subgraph W${i + 1}["Wave ${i + 1}"]`, '    direction TB');
      for (const t of wave) {
        const status = [t.dev && 'dev ✓', t.qa && 'qa ✓', t.checked && 'checked ✓', t.awaitsCheck && 'your check', t.repairs && `repairs ${t.repairs}`].filter(Boolean).join(' · ') || 'not delegated';
        L.push(`    ${nid(t.id)}["${mmd(t.id)} · ${mmd(clip(t.title, 42))}<br/>${t.level ? `${t.level} → ${mmd(t.model || MODEL[t.level])}` : 'no complexity'} · ${mmd(status)}"]`);
      }
      L.push('  end');
    });
    for (const t of r.tasks) for (const d of t.dependsOn) if (r.tasks.some((x) => x.id === d)) L.push(`  ${nid(d)} --> ${nid(t.id)}`);
    for (const t of r.tasks) L.push(`  class ${nid(t.id)} ${t.level || 'unrated'}`);
    L.push(...MERMAID_CLASSES.slice(10).map((c) => `  ${c}`), '```', '');
    L.push('Colour is the task\'s `Complexity` and the model it calls for: low → haiku, standard → sonnet, high → opus. A task runs after the tasks it depends on; tasks in one wave do not depend on each other.', '');
    if (v.cyclic.size) L.push(`⚠ The dependencies of ${[...v.cyclic].join(', ')} form a cycle; the plan has to be corrected.`, '');
    if (v.unknownDeps.length) L.push(`⚠ Depends on tasks that are not in the plan: ${v.unknownDeps.join(', ')}.`, '');
  }

  L.push('## Traceability', '');
  if (!v.trace.length) L.push('No acceptance criteria found in the specification yet.', '');
  else {
    const planned = v.trace.filter((t) => t.tasks.length).length;
    const tested = v.trace.filter((t) => t.covered).length;
    const passed = v.trace.filter((t) => t.result === 'PASSED').length;
    const caseCount = v.trace.reduce((sum, t) => sum + t.cases.length, 0);
    L.push(`${v.trace.length} criteria${caseCount ? ` with ${caseCount} cases` : ''} · ${planned} planned · ${tested} with a test · ${passed} passed`, '');
    // A criterion with cases shows how many of them passed; the cases themselves are on the page, where a row opens.
    const casesOf = (t) => (t.cases.length ? `${t.cases.filter((c) => c.result === 'PASSED').length} of ${t.cases.length} passed` : '—');
    L.push(caseCount ? '| AC | Then | Cases | Tasks | Tests | Result |' : '| AC | Then | Tasks | Tests | Result |', caseCount ? '| --- | --- | --- | --- | --- | --- |' : '| --- | --- | --- | --- | --- |');
    for (const t of v.trace) L.push(`| ${cell(t.id)} | ${cell(clip(t.then, 120))} | ${caseCount ? `${casesOf(t)} | ` : ''}${cell(t.tasks.join(', ')) || '—'} | ${cell(t.tests.join(', ')) || '—'} | ${t.result || '—'} |`);
    L.push('');
  }

  L.push('## Gate check', '');
  if (r.validator.status === 'missing') L.push('`scripts/validate-gates.mjs` is not in this repository; the manifest was not checked.', '');
  else {
    L.push(`\`node scripts/validate-gates.mjs ${r.manifestRel}\`: **${r.validator.status}**`, '');
    for (const p of r.validator.problems) L.push(`- ✕ ${p}`);
    for (const w of r.validator.warnings) L.push(`- ⚠ ${w}`);
    if (r.validator.problems.length || r.validator.warnings.length) L.push('');
    L.push('Local check only: pull request merges, CI results and tracker state were not asked of GitHub.', '');
  }

  L.push('## Artifacts', '', '| Key | Path | On disk |', '| --- | --- | --- |');
  for (const a of r.artifacts) L.push(`| ${cell(a.key)} | ${a.path ? `\`${cell(a.path)}\`` : '—'} | ${a.path ? (a.exists ? 'yes' : '**missing**') : '—'} |`);
  L.push('', '---', '', 'This board reads what the manifest and the artifacts say. It proves nothing and passes no gate.', '');
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------------
// board.html: one offline page for every run. Node computes a model of the runs and embeds it as JSON;
// the page draws itself from that model in the browser, so it can switch run and tab without a
// server. Nothing on it is fetched from the internet.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const href = (p) => posix(relative(dirname(htmlPath), resolve(root, p)));
const stageTone = (stage) => ({ passed: 'done', owner: 'owner', blocked: 'blocked', repair: 'repair', cancelled: 'muted', current: 'agents' })[stageClass(stage)];

function questionModel(r, q) {
  const opts = splitOptions(q.options);
  const rec = r.recommendations.get(q.id) || '';
  const recOpt = recommendedOption(opts, rec);
  const free = !opts.length && q.options && !/^[—–-]+$/.test(stripMd(q.options)) ? q.options : '';
  return {
    id: q.id,
    question: q.question,
    why: q.why,
    affects: q.affects,
    note: q.note,
    by: q.by,
    needed: q.neededBefore ? { gate: q.neededBefore.gate, label: q.neededBefore.label } : null,
    late: Boolean(q.late),
    options: opts.map((o) => {
      const parts = o.text.split(/\s*→\s*/);
      return { label: o.label, main: parts[0], cons: parts.slice(1).join(' → '), value: o.value, recommended: o === recOpt };
    }),
    lead: opts.lead || '',
    free,
    rec,
    sent: q.sent ? { value: q.sent.value, at: fmtDate(q.sent.at) } : null,
  };
}

function runModel(r, v) {
  if (!v) return { id: r.id, folder: r.folder, title: r.id, who: 'blocked', error: r.error };
  const g = v.gate;
  return {
    id: r.id,
    folder: r.folder,
    title: r.title,
    stage: r.stage,
    tone: stageTone(r.stage),
    mode: r.mode,
    light: r.light,
    bug: r.bug,
    confidential: r.confidential,
    trackDecision: r.trackDecision ? { by: r.trackDecision.by || '', reason: r.trackDecision.reason || '' } : null,
    revision: r.revision,
    updatedAt: fmtDate(r.updatedAt),
    owner: r.owner,
    ticketRef: r.ticketRef,
    who: v.next.who,
    next: { badge: v.next.badgeKey, key: v.next.key, p: v.next.p },
    cur: v.cur,
    steps: v.steps.map((s) => ({ gate: s.gate, state: s.state, result: s.result, human: s.human, evidence: s.evidence })),
    nowGate: v.steps[v.cur].gate,
    gate: g ? {
      gate: g.gate,
      version: g.version.label,
      files: g.version.files.map((f) => ({ name: basename(f), href: href(f) })),
      needs: g.needs,
      sent: g.sent ? { verdict: `${g.sent.verdict} ${g.sent.rest}`.trim(), at: fmtDate(g.sent.at) } : null,
      clar: g.gate === 'businessApproval' && r.clarificationPath ? { name: basename(r.clarificationPath), href: href(r.clarificationPath) } : null,
      plan: g.gate === 'planApproval' ? { tasks: r.tasks.length, high: r.tasks.filter((t) => t.level === 'high').length, waves: v.waves.length } : null,
      assumptions: g.gate === 'businessApproval' ? r.assumptions : [],
      decisions: g.gate === 'planApproval' ? r.decisions.map((d) => ({ id: d.id, text: clip(d.text, 220), area: d.area })) : [],
      reproduction: g.gate === 'businessApproval' && r.bug ? { rep: r.reproduction } : null,
    } : null,
    attention: v.attentionKeys,
    groups: { now: v.now.map((q) => questionModel(r, q)), unsorted: v.unsorted.map((q) => questionModel(r, q)), later: v.later.map((q) => questionModel(r, q)) },
    hasLog: r.questions.length > 0,
    decided: v.decided.map((q) => ({ id: q.id, decision: q.decision, by: q.by, at: q.at })),
    unrecorded: v.unrecorded.map((f) => ({ name: f.name, href: href(f.path) })),
    blockers: r.blockers,
    deps: v.deps.map((d) => ({ ref: d.ref, id: d.run ? d.run.id : null, stage: d.stage })),
    dependents: v.dependents.map((o) => ({ id: o.id, stage: o.stage })),
    waves: v.waves.map((w) => w.map((t) => ({ id: t.id, title: t.title, level: t.level, model: t.model || (t.level ? MODEL[t.level] : ''), reason: t.reason, acs: t.acs, dependsOn: t.dependsOn, dev: t.dev, qa: t.qa, checked: t.checked, awaitsCheck: t.awaitsCheck, repairs: t.repairs, hasSkills: t.hasSkills }))),
    taskCount: r.tasks.length,
    hasPlan: r.hasPlan,
    cyclic: [...v.cyclic],
    unknownDeps: v.unknownDeps,
    trace: v.trace.map((t) => ({ id: t.id, given: t.given || '', when: t.when || '', then: stripMd(t.then), rules: t.rules || '', cases: t.cases, tasks: t.tasks, tests: t.tests, testResults: t.testResults, result: t.result, covered: t.covered })),
    validator: r.validator,
    review: r.review,
    artifacts: r.artifacts.map((a) => ({ key: a.key, name: a.path ? basename(a.path) : null, href: a.path ? href(a.path) : null, exists: a.exists })),
    board: href(relPath(join(r.dir, 'board.md'))),
  };
}

function buildModel(runs, views) {
  const ordered = runs.map((r, i) => ({ r, v: views[i] })).sort((a, b) => {
    const ra = a.v ? rank[a.v.next.who] : 1;
    const rb = b.v ? rank[b.v.next.who] : 1;
    return ra - rb || String(b.r.updatedAt || '').localeCompare(String(a.r.updatedAt || ''));
  });
  // Runs in delivery order, when any run names another in dependsOn.
  const lanes = [];
  const valid = runs.filter((r) => !r.error);
  if (valid.some((r) => r.dependsOn.length)) {
    const nodes = new Map();
    const lvl = new Map();
    const visiting = new Set();
    const keyFor = (ref) => { const d = findRun(valid, ref); const k = d ? d.id : `?${ref}`; if (!nodes.has(k)) nodes.set(k, { run: d, ref }); return k; };
    const levelOf = (key) => {
      if (lvl.has(key)) return lvl.get(key);
      if (visiting.has(key)) return 1;
      visiting.add(key);
      const node = nodes.get(key);
      let l = 1;
      if (node.run) for (const ref of node.run.dependsOn) l = Math.max(l, levelOf(keyFor(ref)) + 1);
      visiting.delete(key);
      lvl.set(key, l);
      return l;
    };
    valid.forEach((r) => keyFor(r.id));
    valid.forEach((r) => r.dependsOn.forEach(keyFor));
    [...nodes.keys()].forEach(levelOf);
    for (const [k, nd] of nodes) (lanes[lvl.get(k) - 1] ||= []).push({ id: nd.run ? nd.run.id : null, ref: nd.ref, stage: nd.run ? nd.run.stage : null, title: nd.run ? nd.run.title : null });
  }
  return { repo: basename(root), renderedAt: fmtDate(new Date().toISOString()), runs: ordered.map(({ r, v }) => runModel(r, v)), lanes };
}

// The Imperata app tile (brand/ in the kit's repository): the symbol in bone and red on a dark rounded square,
// legible on a light or a dark browser tab.
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="44" fill="#181818"/><g transform="translate(34 34) scale(.734375)"><g fill="none" stroke="#F2F0E9" stroke-width="13"><path d="M119 26 42 72v40"/><path d="M42 133v49l77 45"/><path d="m137 26 77 46v40"/><path d="M214 133v49l-77 45"/></g><path fill="#F2F0E9" d="M100 76h56l-6 12h-11v82h11l6 12h-56l6-12h11V88h-11z"/><path fill="#E84C3D" d="m118 217 10 25 10-25z"/></g></svg>');

// The look: a drawing sheet. A soft blueprint grid behind hairline panels, labels in small monospace capitals,
// a title block for a header, square status marks. Status colours are reserved for status and always come
// with a mark and a word. System fonts only: the page loads nothing.
const BOARD_CSS = `
:root{color-scheme:light dark;
--bg:#f1f4f9;--grid:rgba(38,88,190,.055);--grid-2:rgba(38,88,190,.105);--chrome:#f9fbfe;
--surface:#fff;--surface-2:#f6f8fc;--sunk:#e8edf5;--ink:#0f1a2b;--ink-2:#34435a;--muted:#5b6a80;--line:#dbe2ed;--line-2:#b6c2d6;--tick:#8ea1c0;
--accent:#1f55d0;--accent-ink:#1a48b3;--accent-bg:#e6eeff;--on-accent:#fff;
--good:#0ca30c;--good-ink:#006300;--good-bg:#e4f4e6;--warn:#fab219;--warn-ink:#734d00;--warn-bg:#fff4d6;--warn-line:#dfa010;
--serious:#ec835a;--serious-ink:#94401d;--serious-bg:#fdece4;--crit:#d03b3b;--crit-ink:#a32020;--crit-bg:#fbe7e7;
--violet:#6d4fc4;--violet-ink:#553ba8;--violet-bg:#eeeafb;--on-violet:#fff;--focus:#1f55d0;--lift:0 10px 30px rgba(15,26,43,.22);--r:4px;--top:52px;
--mono:ui-monospace,"SF Mono",SFMono-Regular,"JetBrains Mono","Cascadia Mono",Menlo,Consolas,monospace;
--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0a111e;--grid:rgba(126,166,255,.05);--grid-2:rgba(126,166,255,.095);--chrome:#0c1525;
--surface:#101a2c;--surface-2:#142036;--sunk:#0b1424;--ink:#e7edf8;--ink-2:#c4cee0;--muted:#8d9db8;--line:#1f2d46;--line-2:#31456a;--tick:#4a6190;
--accent:#7ea6ff;--accent-ink:#a6c1ff;--accent-bg:#14254a;--on-accent:#0a111e;
--good-ink:#4cc94c;--good-bg:#0f2a1c;--warn-ink:#fbc552;--warn-bg:#2e2610;--warn-line:#b98510;--serious-ink:#f3a27f;--serious-bg:#33211b;--crit-ink:#ff9292;--crit-bg:#361b20;
--violet:#b9a4f2;--violet-ink:#c9b8f7;--violet-bg:#241f42;--on-violet:#120c26;--focus:#7ea6ff;--lift:0 10px 30px rgba(0,0,0,.5)}}
*{box-sizing:border-box}[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;color:var(--ink);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased;background-color:var(--bg);
background-image:linear-gradient(var(--grid-2) 1px,transparent 1px),linear-gradient(90deg,var(--grid-2) 1px,transparent 1px),linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);
background-size:120px 120px,120px 120px,24px 24px,24px 24px;background-position:-1px 3px}
a{color:var(--accent-ink);text-decoration:none}a:hover{text-decoration:underline}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:3px}
::selection{background:var(--accent-bg)}
code,.mono{font-family:var(--mono);font-size:12.5px}
code{background:var(--sunk);padding:1px 5px;border-radius:2px}
h1{font-size:24px;line-height:1.25;margin:0;letter-spacing:-.015em;font-weight:700}
h2{font-size:18px;line-height:1.3;margin:0}
.muted{color:var(--muted)}.small{font-size:13px}.grow{flex:1}
button{font:inherit;color:inherit}
.noscript{padding:24px}
.ic{width:14px;height:14px;display:block;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.ic.solid{fill:currentColor;stroke:none}.ic.bold{stroke-width:2.3}.ic.inl{display:inline-block;vertical-align:-2px;margin-right:5px}
.rule{flex:1;height:1px;min-width:12px;background:var(--line-2)}
.bp{position:relative}
.bp::after{content:"";position:absolute;inset:-5px;pointer-events:none;--c:var(--tick);background-repeat:no-repeat;
background-image:linear-gradient(var(--c),var(--c)),linear-gradient(var(--c),var(--c)),linear-gradient(var(--c),var(--c)),linear-gradient(var(--c),var(--c)),linear-gradient(var(--c),var(--c)),linear-gradient(var(--c),var(--c)),linear-gradient(var(--c),var(--c)),linear-gradient(var(--c),var(--c));
background-size:9px 1px,1px 9px,9px 1px,1px 9px,9px 1px,1px 9px,9px 1px,1px 9px;
background-position:left top,left top,right top,right top,left bottom,left bottom,right bottom,right bottom}
.top{position:sticky;top:0;z-index:20;height:var(--top);display:flex;align-items:stretch;background:var(--chrome);border-bottom:1px solid var(--line-2)}
.brand{flex:0 0 264px;display:flex;align-items:center;gap:10px;padding:0 16px;border-right:1px solid var(--line-2);color:var(--ink)}
.brand:hover{text-decoration:none}.logo{display:block;width:24px;height:28px;flex:0 0 auto;color:var(--ink)}
.brand-text{display:flex;flex-direction:column;min-width:0}
.brand-text b{font:700 13px/1.25 var(--mono);letter-spacing:.16em;text-transform:uppercase}
.brand-text small{font:500 10.5px/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.tbs{flex:1;display:flex;min-width:0;overflow:hidden}
.tb{display:flex;flex-direction:column;justify-content:center;gap:1px;padding:0 16px;border-right:1px solid var(--line);white-space:nowrap}
.tb-k{font:500 10.5px/1.3 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.tb-v{font:500 12.5px/1.3 var(--mono);color:var(--ink)}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--good-ink);font-weight:600}.live i{width:7px;height:7px;border-radius:1px;background:var(--good);animation:pulse 2s ease-in-out infinite}
.layout{display:grid;grid-template-columns:264px minmax(0,1fr);align-items:start}
.side{position:sticky;top:var(--top);height:calc(100vh - var(--top));overflow:auto;padding:14px 10px 120px;background:var(--chrome);border-right:1px solid var(--line-2)}
main{padding:24px 28px 140px;min-width:0;max-width:1290px}
.nav-home,.nav-item{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid transparent;border-radius:3px;color:var(--ink);font-size:14px}
.nav-home{font-weight:650;margin-bottom:4px}
.nav-home:hover,.nav-item:hover{background:var(--surface-2);border-color:var(--line);text-decoration:none}
.nav-home.active,.nav-item.active{background:var(--surface);border-color:var(--line-2);box-shadow:inset 2px 0 0 var(--accent)}
.nav-group{display:flex;align-items:center;gap:8px;font:600 10.5px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:18px 8px 6px}
.nav-group .rule{background:var(--line)}
.nav-text{display:flex;flex-direction:column;min-width:0;flex:1}
.nav-title{font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nav-id{font:11.5px/1.5 var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{margin-left:auto;flex:0 0 auto;min-width:20px;height:20px;padding:0 5px;border-radius:2px;display:inline-grid;place-items:center;font:700 11px var(--mono);font-variant-numeric:tabular-nums;letter-spacing:0;background:var(--sunk);color:var(--ink-2);border:1px solid var(--line)}
.badge.warn{background:var(--warn);border-color:var(--warn-line);color:#0b0b0b}
.dot{flex:0 0 22px;width:22px;height:22px;border-radius:3px;display:inline-grid;place-items:center;color:var(--ink-2);background:var(--sunk);border:1px solid var(--line-2)}
.dot.owner{background:var(--warn);border-color:var(--warn-line);color:#0b0b0b}.dot.blocked{background:var(--crit);border-color:var(--crit);color:#fff}.dot.agents{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.dot.repair{background:var(--serious);border-color:var(--serious);color:#0b0b0b}.dot.done{background:var(--good);border-color:var(--good);color:#fff}.dot.sent{background:var(--violet);border-color:var(--violet);color:var(--on-violet)}
.chip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:2px;font:600 12px/1.5 var(--sans);letter-spacing:0;text-transform:none;background:var(--surface);color:var(--ink-2);border:1px solid var(--line-2);white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.chip i{flex:0 0 7px;height:7px;border-radius:1px;background:var(--muted)}
.chip.owner i{background:var(--warn)}.chip.blocked i{background:var(--crit)}.chip.agents i{background:var(--accent)}.chip.repair i{background:var(--serious)}.chip.done i{background:var(--good)}
.card{background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r);padding:16px}
.page-h{margin-bottom:16px}
.section-title{display:flex;align-items:center;gap:10px;margin:32px 0 12px;font:600 11.5px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2)}
.section-title .no{color:var(--accent-ink)}.section-title .count{color:var(--muted)}
.stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r)}
.stat{padding:13px 16px 12px;border-left:1px solid var(--line);min-width:0}.stat:first-child{border-left:0}
.stat .l{display:flex;align-items:center;gap:7px;font:600 10.5px/1.4 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.stat .l i{flex:0 0 8px;height:8px;border-radius:1px;background:var(--line-2)}
.stat .v{font:600 30px/1.1 var(--mono);letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin-top:8px}
.stat.zero .v{color:var(--muted);font-weight:400}
.stat.owner .l i{background:var(--warn)}.stat.blocked .l i{background:var(--crit)}.stat.agents .l i{background:var(--accent)}.stat.done .l i{background:var(--good)}.stat.q .l i{background:var(--violet)}
.inbox{display:flex;flex-direction:column;gap:10px}
.inbox-item{display:flex;gap:14px;align-items:center;padding:13px 16px;border-left:3px solid var(--warn)}
.inbox-item.sentw{border-left-color:var(--violet)}
.inbox-text{flex:1;min-width:0}.inbox-title{font-weight:650}.inbox-title .mono{white-space:nowrap;font-weight:500}.inbox-next{font-size:14px;color:var(--ink-2);margin-top:2px}
.btn{display:inline-flex;align-items:center;gap:7px;min-height:34px;border:1px solid var(--line-2);background:var(--surface);color:var(--ink);border-radius:3px;padding:6px 13px;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.btn:hover{text-decoration:none;border-color:var(--ink-2)}
.btn.primary{background:var(--ink);color:var(--surface);border-color:var(--ink)}.btn.primary:hover{opacity:.9}
.btn.warn{background:var(--warn);color:#0b0b0b;border-color:var(--warn-line)}.btn.warn:hover{border-color:#0b0b0b}
.card.empty{padding:16px;color:var(--muted);border-style:dashed}
.runs{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.run-card{display:flex;flex-direction:column;padding:0;color:var(--ink);transition:border-color .15s}
.run-card:hover{text-decoration:none;border-color:var(--ink-2)}
.rc-top{display:flex;align-items:center;justify-content:space-between;gap:8px 10px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--line);background:var(--surface-2);border-radius:var(--r) var(--r) 0 0}
.rc-run{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:100%}
.rc-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-2)}
.rc-body{flex:1;display:flex;flex-direction:column;gap:12px;padding:14px}
.rc-title{font-weight:650;font-size:16px;line-height:1.35}
.rc-next{font-size:14px;color:var(--ink-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.rc-foot{display:flex;flex-wrap:wrap;border-top:1px solid var(--line);font:500 11px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.rc-foot>span{flex:1 1 auto;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;border-left:1px solid var(--line)}.rc-foot>span:first-child{border-left:0}
.rc-foot b{font-size:12.5px;color:var(--ink);font-variant-numeric:tabular-nums}.rc-foot .nil{color:var(--muted);font-weight:400}
.rc-foot .bad{flex-basis:100%;border-left:0;border-top:1px solid var(--line);color:var(--crit-ink);font-weight:700;justify-content:flex-start}
.track-wrap{display:flex;flex-direction:column;gap:6px}
.track{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.track i{height:6px;border-radius:1px;background:var(--sunk);box-shadow:inset 0 0 0 1px var(--line)}
.track i.passed{background:var(--good);box-shadow:none}.track i.current{background:var(--accent);box-shadow:none}.track i.owner{background:var(--warn);box-shadow:none}.track i.blocked,.track i.failed{background:var(--crit);box-shadow:none}.track i.repair{background:var(--serious);box-shadow:none}.track i.waived{background:var(--violet);box-shadow:none}
.track-cap{display:flex;justify-content:space-between;gap:10px;font:500 11px/1.4 var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.track-cap b{color:var(--ink-2);font-weight:600;text-align:right}
.lanes{display:flex;gap:30px;overflow-x:auto;padding:2px 2px 8px}
.lane{position:relative;flex:0 0 244px;display:flex;flex-direction:column;gap:8px}
.lane-h{display:flex;align-items:center;gap:8px;font:600 10.5px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.lane+.lane::before,.wave+.wave::before{content:"";position:absolute;left:-24px;top:7px;width:14px;height:1px;background:var(--tick)}
.lane+.lane::after,.wave+.wave::after{content:"";position:absolute;left:-11px;top:4px;border:3.5px solid transparent;border-left:5px solid var(--tick)}
.lane-item{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:10px 12px;border:1px solid var(--line-2);border-radius:var(--r);background:var(--surface);color:var(--ink)}
.lane-item:hover{text-decoration:none;border-color:var(--ink-2)}.lane-item.ghost{border-style:dashed;color:var(--muted)}
.lane-title{font-weight:600;font-size:14px;line-height:1.35}
.crumb{display:inline-flex;align-items:center;gap:5px;font:600 11px/1.4 var(--mono);letter-spacing:.09em;text-transform:uppercase;margin-bottom:10px;color:var(--muted)}
.crumb:hover{color:var(--ink);text-decoration:none}
.run-head{display:flex;flex-direction:column;gap:12px;margin-bottom:14px}
.spec{display:grid;grid-template-columns:repeat(auto-fit,minmax(176px,1fr));background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r);overflow:hidden}
.spec>div{display:flex;flex-direction:column;gap:3px;padding:7px 12px 8px;min-width:0;box-shadow:1px 0 0 var(--line),0 1px 0 var(--line)}
.spec .k{font:500 10.5px/1.3 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.spec .v{font:500 12px/1.6 var(--mono);color:var(--ink);overflow-wrap:anywhere}
.next{display:flex;gap:16px;align-items:flex-start;padding:13px 16px;border-radius:var(--r);border:1px solid var(--line-2);border-left-width:3px;background:var(--surface);margin-bottom:16px}
.next .who{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;font:700 11px/1.4 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--ink);padding-top:1px}
.next.owner{background:var(--warn-bg);border-color:var(--warn-line)}.next.blocked{background:var(--crit-bg);border-color:var(--crit)}
.next.agents{border-left-color:var(--accent)}.next.repair{border-left-color:var(--serious)}.next.done{border-left-color:var(--good)}
.next .what{font-size:16px;line-height:1.5;min-width:0}
.attn{margin:8px 0 0;padding:8px 12px 8px 30px;border-radius:3px;background:var(--surface);border:1px solid var(--line);font-size:14px}
.attn li{margin:3px 0}
.attn-title{font:700 11px/1.4 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--crit-ink)}
.stepper{list-style:none;margin:0 0 20px;padding:18px 20px 16px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r)}
.step{position:relative;display:flex;flex-direction:column;gap:10px;min-width:0;padding-right:12px}
.step::before{content:"";position:absolute;top:13px;left:28px;right:0;border-top:1px dashed var(--line-2)}
.step:last-child::before{display:none}
.step.s-passed::before{top:13px;border-top:2px solid var(--good)}
.node{position:relative;z-index:1;width:28px;height:28px;border-radius:3px;display:grid;place-items:center;background:var(--surface);border:1px solid var(--line-2);color:var(--muted)}
.node .ic{width:15px;height:15px}
.s-todo .node{border-style:dashed}
.s-passed .node{background:var(--good);border-color:var(--good);color:#fff}
.s-current .node{background:var(--accent);border-color:var(--accent);color:var(--on-accent);box-shadow:0 0 0 4px var(--accent-bg)}
.s-owner .node{background:var(--warn);border-color:var(--warn-line);color:#0b0b0b;box-shadow:0 0 0 4px var(--warn-bg)}
.s-blocked .node,.s-failed .node{background:var(--crit);border-color:var(--crit);color:#fff;box-shadow:0 0 0 4px var(--crit-bg)}
.s-repair .node{background:var(--serious);border-color:var(--serious);color:#0b0b0b;box-shadow:0 0 0 4px var(--serious-bg)}
.s-waived .node{border-color:var(--violet);color:var(--violet-ink)}
.s-text{display:flex;flex-direction:column;gap:2px;min-width:0}
.s-no{font:500 10.5px/1.3 var(--mono);letter-spacing:.1em;color:var(--muted)}
.s-name{font-weight:650;font-size:14px;line-height:1.25}.s-todo .s-name{color:var(--muted);font-weight:600}
.s-gate{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted)}.s-human{display:inline-flex;color:var(--ink-2)}.s-human .ic{width:12px;height:12px}
.s-ev{display:flex;flex-direction:column;font:11px/1.45 var(--mono);color:var(--muted);max-width:100%;margin-top:2px}.s-ev span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.s-res{font:700 10.5px/1.4 var(--mono);letter-spacing:.08em;color:var(--muted);margin-top:2px}.s-todo .s-res{display:none}
.r-passed{color:var(--good-ink)}.r-failed,.r-blocked{color:var(--crit-ink)}.r-waived{color:var(--violet-ink)}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line-2);margin:0 0 16px;overflow-x:auto}
.tab{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;font:600 11.5px/1.4 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.tab:hover{color:var(--ink);text-decoration:none}.tab[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--accent)}
.tab .badge{margin-left:0}
.run-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:20px;align-items:start}
.main-col{min-width:0;display:flex;flex-direction:column;gap:14px}
.side-col{display:flex;flex-direction:column;gap:14px}
.side-col .card{padding:0}
.card-title{display:flex;align-items:center;gap:8px;margin:0;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--surface-2);border-radius:var(--r) var(--r) 0 0;font:700 10.5px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--ink-2)}
.card-body{padding:12px 14px}
.card-body>:first-child{margin-top:0}.card-body>:last-child{margin-bottom:0}
.note{margin:0;padding:9px 12px;border-radius:3px;border-left:2px solid var(--line-2);background:var(--sunk);font-size:14px}
.note.violet{background:var(--violet-bg);border-left-color:var(--violet)}
.gate-card{background:var(--surface);border:1px solid var(--warn-line);border-radius:var(--r);display:flex;flex-direction:column}
.gate-card.bp::after{--c:var(--warn-line)}
.gate-head{display:flex;flex-direction:column;gap:4px;padding:12px 18px 13px;background:var(--warn-bg);border-bottom:1px solid var(--warn-line);border-radius:var(--r) var(--r) 0 0}
.gate-kicker{display:flex;align-items:center;gap:7px;font:700 10.5px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--warn-ink)}
.gate-steps{list-style:none;counter-reset:gs;margin:0;padding:16px 18px 18px;display:flex;flex-direction:column;gap:14px}
.gate-steps>li{counter-increment:gs;position:relative;padding-left:38px;font-size:15px;min-width:0}
.gate-steps>li::before{content:counter(gs,decimal-leading-zero);position:absolute;left:0;top:1px;width:26px;height:22px;border-radius:2px;display:grid;place-items:center;font:700 11px var(--mono);background:var(--surface-2);border:1px solid var(--line-2);color:var(--ink-2)}
.doc{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid var(--line-2);border-radius:2px;font:600 12.5px/1.5 var(--mono);margin:2px 4px 2px 0;background:var(--surface-2);vertical-align:middle}
.doc:hover{border-color:var(--accent);text-decoration:none}.doc .ic{width:13px;height:13px}
.choices{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.choice{position:relative;display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid var(--line-2);border-radius:var(--r);cursor:pointer;background:var(--surface)}
.choice:hover{background:var(--surface-2)}
.choice input{position:absolute;opacity:0;pointer-events:none}
.choice b{display:block;font-size:15px}.choice .muted{display:block}
.c-icon{flex:0 0 28px;height:28px;border-radius:3px;display:grid;place-items:center;background:var(--sunk);border:1px solid var(--line-2);color:var(--ink-2)}
.choice.approve:has(input:checked){border-color:var(--good);background:var(--good-bg);box-shadow:inset 0 0 0 1px var(--good)}.choice.approve:has(input:checked) .c-icon{background:var(--good);border-color:var(--good);color:#fff}
.choice.request:has(input:checked){border-color:var(--serious);background:var(--serious-bg);box-shadow:inset 0 0 0 1px var(--serious)}.choice.request:has(input:checked) .c-icon{background:var(--serious);border-color:var(--serious);color:#0b0b0b}
.choice:has(input:focus-visible){outline:2px solid var(--focus);outline-offset:2px}
.choice.disabled{opacity:.5;cursor:not-allowed}
.locked{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:0;padding:9px 12px;border-radius:3px;border:1px solid var(--crit);background:var(--crit-bg);color:var(--ink);font-size:14px}
.locked>span{flex:1 1 240px}
textarea{display:block;width:100%;border:1px solid var(--line-2);border-radius:3px;padding:9px 11px;background:var(--surface);color:var(--ink);font:inherit;font-size:15px;resize:vertical}
textarea:focus{border-color:var(--accent)}
.link{border:0;background:none;padding:0;color:var(--accent-ink);font-weight:600;cursor:pointer;font-size:14px}
.link:hover{text-decoration:underline}
.own-toggle{align-self:flex-start}
.progress{display:flex;flex-direction:column;gap:7px}
.progress-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.meter{position:relative;height:8px;border-radius:1px;background:var(--sunk);overflow:hidden}.meter i{display:block;height:100%;background:var(--accent);transition:width .25s ease}
.meter::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(100%/var(--n,1) - 2px),var(--surface) calc(100%/var(--n,1) - 2px),var(--surface) calc(100%/var(--n,1)))}
.p-done{margin:0;color:var(--good-ink);font-weight:600;font-size:14px}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.group-title{display:flex;align-items:center;gap:8px;margin:8px 0 0;font:700 11px/1.4 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--ink-2)}
.group-title.now{color:var(--ink)}.group-title.now::before{content:"";flex:0 0 8px;height:8px;border-radius:1px;background:var(--warn)}
details.group>summary{cursor:pointer;list-style:none}details.group>summary::-webkit-details-marker{display:none}
details.group>summary .group-title::before{content:"";flex:0 0 auto;border:4px solid transparent;border-left:6px solid var(--muted);margin-right:-2px}
details.group[open]>summary .group-title::before{border:4px solid transparent;border-top:6px solid var(--muted);margin:4px 0 0}
details.group[open]>summary{margin-bottom:10px}
details.card.group>summary .group-title{margin:0}
.qlist{display:flex;flex-direction:column;gap:8px}
.qc{background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--line-2);border-radius:var(--r);transition:border-color .15s}
.qc.open{border-top-color:var(--line-2);border-right-color:var(--line-2);border-bottom-color:var(--line-2)}
.qc.answered{border-left-color:var(--good)}.qc.sent{border-left-color:var(--violet)}.qc.todo{border-left-color:var(--warn)}
.qc-head{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:0;padding:11px 14px;cursor:pointer;border-radius:var(--r)}
.qc-head:hover .qc-title{color:var(--accent-ink)}
.qid{flex:0 0 auto;font:700 11.5px/1.4 var(--mono);padding:1px 6px;border-radius:2px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--ink-2)}
.qc-title{flex:1;min-width:0;font-weight:600;font-size:15px;line-height:1.4}
.qc:not(.open) .qc-title{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.qc-sum{flex:0 1 auto;max-width:40%;font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qc.answered .qc-sum{color:var(--good-ink);font-weight:600}.qc.sent .qc-sum{color:var(--violet-ink);font-weight:600}
.qc.open .qc-sum{display:none}
.chev{flex:0 0 16px;height:16px;display:grid;place-items:center;color:var(--muted);transition:transform .15s}
.chev::before{content:"";width:7px;height:7px;border-right:1.5px solid;border-bottom:1.5px solid;transform:translateY(-2px) rotate(45deg)}
.qc.open .chev{transform:rotate(180deg)}
.qc-body{display:none;padding:2px 16px 16px;flex-direction:column;gap:10px}
.qc.open .qc-body{display:flex}
.why{margin:0;font-size:15px;color:var(--ink)}
.qmeta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;color:var(--muted)}.qmeta .bad{color:var(--crit-ink);font-weight:600}
.qnote,.qrec,.qfree{margin:0;font-size:14px;color:var(--ink-2)}
.qrec{padding:8px 12px;border-radius:3px;border-left:2px solid var(--accent);background:var(--accent-bg);color:var(--ink)}
.opts{display:flex;flex-direction:column;gap:6px}
.opt{position:relative;display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:3px;cursor:pointer;background:var(--surface)}
.opt:hover{border-color:var(--line-2);background:var(--surface-2)}
.opt input{margin-top:4px;accent-color:var(--accent);flex:0 0 auto}
.opt:has(input:checked){border-color:var(--accent);background:var(--accent-bg);box-shadow:inset 2px 0 0 var(--accent)}
.key{flex:0 0 20px;height:20px;margin-top:1px;border-radius:2px;display:grid;place-items:center;font:600 11px var(--mono);border:1px solid var(--line-2);color:var(--muted);background:var(--surface-2)}
.opt-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.opt-main{font-size:15px}.opt-cons{font-size:14px;color:var(--muted)}
.tag{flex:0 0 auto;font:700 10.5px/1.5 var(--mono);letter-spacing:.07em;text-transform:uppercase;padding:1px 7px;border-radius:2px;border:1px solid var(--line-2);background:var(--surface-2);color:var(--ink-2);white-space:nowrap}
.tag.rec{border-color:var(--accent);background:var(--accent-bg);color:var(--accent-ink)}
.decided-table,.tbl{width:100%;border-collapse:collapse;font-size:14px}
.tbl th,.tbl td{border-bottom:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top}
.tbl tbody tr:last-child td{border-bottom:0}.tbl tbody tr:hover td{background:var(--surface-2)}
.tbl th{font:600 10.5px/1.4 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted);white-space:nowrap;border-bottom-color:var(--line-2)}
.tbl-card{padding:0;overflow:hidden}.tbl-card .tbl th{background:var(--surface-2)}.tbl-card .tbl th:first-child,.tbl-card .tbl td:first-child{padding-left:14px}.tbl-card .tbl th:last-child,.tbl-card .tbl td:last-child{padding-right:14px}
.tbl-wrap{overflow-x:auto}
.tbl.trace tr.ac-row{cursor:pointer}.tbl.trace tr.ac-row.open td{border-bottom-color:transparent}
.ac-toggle{appearance:none;background:none;border:0;padding:0;margin:0;color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.ac-toggle::before{content:'';width:6px;height:6px;border-right:1.5px solid var(--muted);border-bottom:1.5px solid var(--muted);transform:rotate(-45deg);transition:transform .12s}
.ac-row.open .ac-toggle::before{transform:rotate(45deg)}
.ac-toggle:focus-visible{outline:2px solid currentColor;outline-offset:3px;border-radius:3px}
.tbl.trace tr.ac-detail>td,.tbl.trace tr.ac-detail:hover>td{background:var(--surface-2);padding:4px 14px 16px 27px}
.ac-dl{margin:0 0 4px;display:grid;gap:7px}.ac-f{display:grid;grid-template-columns:120px minmax(0,1fr);gap:12px}
.ac-f dt{font:600 10.5px/1.9 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}.ac-f dd{margin:0}
.tbl.cases{margin-top:10px;font-size:13px}.tbl-card .tbl.cases th,.tbl-card .tbl.cases td{padding:6px 14px 6px 0;background:none}.tbl-card .tbl.cases tbody tr:hover td{background:none}
.ac-tests{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px 14px}.ac-test{display:inline-flex;align-items:center;gap:6px}
.ac-hint{margin:0 0 8px}
@media (max-width:640px){.ac-f{grid-template-columns:1fr;gap:0}}
@media (prefers-reduced-motion:reduce){.ac-toggle::before{transition:none}}
.nw,.tbl td.mono:first-child{white-space:nowrap}
.res{display:inline-flex;align-items:center;gap:4px;font:700 10.5px/1.5 var(--mono);letter-spacing:.06em;white-space:nowrap;padding:1px 6px;border-radius:2px;border:1px solid currentColor}
.res .ic{width:11px;height:11px}
.res.passed{color:var(--good-ink);background:var(--good-bg)}.res.failed,.res.blocked{color:var(--crit-ink);background:var(--crit-bg)}.res.not_run{color:var(--muted)}.res.none{color:var(--muted);border:0;padding:0}
.gap{color:var(--crit-ink);font-size:13px;font-weight:600}
.waves{display:flex;gap:30px;overflow-x:auto;padding:2px 2px 8px}
.wave{position:relative;flex:0 0 258px;display:flex;flex-direction:column;gap:10px}
.wave-h{display:flex;align-items:center;gap:8px;font:600 10.5px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.wave-h b{color:var(--ink-2);font-weight:700}
.task{background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r);display:flex;flex-direction:column}
.t-head{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--line);background:var(--surface-2);border-radius:var(--r) var(--r) 0 0}
.t-id{font-weight:700;color:var(--ink)}
.t-body{display:flex;flex-direction:column;gap:7px;padding:10px 12px 12px}
.lv{display:inline-flex;align-items:center;gap:6px;font:600 11px/1.4 var(--mono);letter-spacing:.03em;color:var(--ink-2);white-space:nowrap}
.lvb{display:inline-flex;align-items:flex-end;gap:2px;height:11px}
.lvb i{width:3px;border-radius:.5px;background:var(--line-2)}.lvb i:nth-child(1){height:5px}.lvb i:nth-child(2){height:8px}.lvb i:nth-child(3){height:11px}
.lvb.lv-low i:nth-child(1),.lvb.lv-standard i:nth-child(-n+2),.lvb.lv-high i{background:var(--ink)}
.t-title{font-weight:650;line-height:1.35}.t-reason{font-size:13px;color:var(--muted)}
.t-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;font-size:13px;color:var(--muted)}
.ac{font:11.5px/1.5 var(--mono);padding:0 5px;border:1px solid var(--line);border-radius:2px;color:var(--ink-2);background:var(--surface-2)}
.t-status{display:flex;flex-wrap:wrap;border-top:1px solid var(--line)}
.t-status span{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;font:700 10.5px/1.4 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);border-right:1px solid var(--line)}
.t-status span.on{color:var(--good-ink);background:var(--good-bg)}.t-status span.warn{color:var(--warn-ink);background:var(--warn-bg)}
.t-status .ic{width:11px;height:11px}
.level-legend{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;font-size:13px;color:var(--muted)}
.mini-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:var(--surface);border:1px solid var(--line-2);border-radius:var(--r)}
.mini{padding:11px 14px 13px;border-left:1px solid var(--line);min-width:0}.mini:first-child{border-left:0}
.mini .l{font:600 10.5px/1.4 var(--mono);letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.mini .v{font:600 22px/1.2 var(--mono);font-variant-numeric:tabular-nums;margin:6px 0 9px}.mini .v small{font-size:14px;font-weight:400;color:var(--muted)}
.mini .meter{height:6px}
.blockers{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:8px;font-size:14px}
.blockers li::marker{font:700 11.5px var(--mono);color:var(--crit-ink)}
.dep{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:8px 10px;border:1px solid var(--line);border-radius:3px;margin-top:6px;color:var(--ink)}
.dep:hover{text-decoration:none;border-color:var(--ink-2)}.dep.ghost{border-style:dashed;color:var(--muted)}
.check-line{display:flex;gap:6px;font-size:13px;margin:7px 0 0}.check-line.bad{color:var(--crit-ink)}
.check-line .ic{width:12px;height:12px;margin-top:4px}
.docs{list-style:none;margin:0;padding:0}
.docs li{display:flex;align-items:baseline;gap:8px;padding:4px 0;font:12.5px/1.6 var(--mono)}
.docs .k{color:var(--muted)}.docs .lead{flex:1;min-width:12px;border-bottom:1px dotted var(--line-2);transform:translateY(-4px)}
.auto{display:flex;gap:12px;align-items:flex-start;border-radius:var(--r);padding:11px 14px;margin:0 0 16px;border:1px solid var(--line-2);border-left-width:3px;background:var(--surface);font-size:14px}
.auto.running{background:var(--accent-bg);border-color:var(--accent)}.auto.error{background:var(--crit-bg);border-color:var(--crit)}.auto.done{border-left-color:var(--good)}
.auto .pulse{flex:0 0 8px;height:8px;border-radius:1px;margin-top:7px;background:var(--muted)}
.auto.running .pulse{background:var(--accent);animation:pulse 1.2s ease-in-out infinite}.auto.done .pulse{background:var(--good)}.auto.error .pulse{background:var(--crit)}
.auto pre{white-space:pre-wrap;font:12.5px/1.5 var(--mono);margin:8px 0 0;max-height:220px;overflow:auto}
.legend{margin-top:40px;border:1px solid var(--line-2);border-radius:var(--r);background:var(--surface);font-size:13px;color:var(--ink-2)}
.legend-h{padding:7px 14px;border-bottom:1px solid var(--line);background:var(--surface-2);border-radius:var(--r) var(--r) 0 0;font:700 10.5px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.legend-items{display:flex;flex-wrap:wrap;gap:8px 22px;padding:12px 14px 4px}
.lg{display:inline-flex;align-items:center;gap:8px}.lg .dot{flex-basis:18px;width:18px;height:18px}.lg .dot .ic{width:11px;height:11px}
.legend-note{margin:0;padding:6px 14px 12px;color:var(--muted)}
.composer{position:fixed;left:50%;bottom:18px;transform:translate(-50%,170%);transition:transform .2s ease;display:flex;gap:4px;align-items:center;padding:6px 6px 6px 16px;border-radius:6px;background:var(--ink);color:var(--surface);box-shadow:var(--lift);max-width:calc(100% - 32px);z-index:30}
.composer.active{transform:translate(-50%,0)}
.composer .c-count{font:600 11.5px/1.4 var(--mono);letter-spacing:.07em;text-transform:uppercase;margin-right:10px;white-space:nowrap}
.composer button{border:0;border-radius:3px;padding:8px 13px;font-size:13.5px;font-weight:600;cursor:pointer;background:transparent;color:inherit;white-space:nowrap}
.composer button:hover{background:rgba(128,128,128,.25)}
.composer button.primary,.composer button.primary:hover{background:var(--warn);color:#0b0b0b}
.composer button:disabled{opacity:.5;cursor:default}
dialog{border:1px solid var(--line-2);border-radius:6px;background:var(--surface);color:var(--ink);width:min(720px,calc(100% - 32px));padding:20px;box-shadow:var(--lift)}
dialog::backdrop{background:rgba(8,14,26,.5)}
dialog textarea{min-height:260px;font:12.5px/1.55 var(--mono);background:var(--surface-2)}
.dlg-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.toast{position:fixed;left:50%;top:14px;transform:translate(-50%,-160%);transition:transform .2s;background:var(--ink);color:var(--surface);padding:9px 14px;border-radius:3px;font-size:14px;font-weight:600;box-shadow:var(--lift);z-index:40;max-width:calc(100% - 32px)}
.toast.show{transform:translate(-50%,0)}
.updated{position:fixed;right:16px;bottom:84px;z-index:35;border:0;border-radius:3px;padding:9px 14px;font:600 11.5px/1.4 var(--mono);letter-spacing:.07em;text-transform:uppercase;background:var(--accent);color:var(--on-accent);cursor:pointer;box-shadow:var(--lift)}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media (max-width:1180px){.tb.wide{display:none}}
@media (max-width:1100px){.run-grid{grid-template-columns:1fr}}
@media (max-width:900px){
.layout{grid-template-columns:1fr}
.side{position:sticky;top:0;z-index:15;height:auto;display:flex;gap:6px;overflow-x:auto;padding:8px 12px;border-right:0;border-bottom:1px solid var(--line-2)}
.nav-group{display:none}
.nav-home,.nav-item{flex:0 0 auto;margin:0;padding:5px 9px;border-color:var(--line-2);background:var(--surface)}
.nav-item .nav-text{max-width:150px}.nav-title{-webkit-line-clamp:1}.nav-id{display:none}
.top{position:static}.brand{flex:0 0 auto}
main{padding:16px 16px 140px}
}
@media (max-width:700px){
.tb.narrow{display:none}
.stepper{grid-template-columns:1fr;padding:14px 14px 2px}
.step{flex-direction:row;gap:12px;padding:0 0 14px}
.step::before,.step.s-passed::before{top:28px;bottom:0;left:13px;right:auto;border-top:0;border-left:1px dashed var(--line-2)}
.step.s-passed::before{border-left:2px solid var(--good)}
.s-text{flex-direction:row;flex-wrap:wrap;align-items:baseline;gap:0 8px;padding-top:4px}
.s-ev{display:none}
.step.s-todo .s-gate,.step.s-passed .s-gate{display:none}
.next{flex-direction:column;gap:8px}
.choices{grid-template-columns:1fr}
.qc-sum{display:none}
.mini-stats{grid-template-columns:1fr}.mini{border-left:0;border-top:1px solid var(--line)}.mini:first-child{border-top:0}
.composer{left:12px;right:12px;transform:translateY(170%);flex-wrap:wrap;justify-content:flex-end;gap:2px;padding:8px}.composer.active{transform:none}
.composer .c-count{flex-basis:100%;text-align:center;margin:0 0 2px}
.composer button{padding:8px 10px}#c-clear,.composer .when-wide{display:none}
.opt .key,.keys-tip{display:none}
.stats{grid-template-columns:repeat(3,minmax(0,1fr))}.stat{padding:10px 12px}.stat .v{font-size:22px}
.stat:nth-child(n+4){border-top:1px solid var(--line)}.stat:nth-child(4){border-left:0}.stat:nth-child(5){grid-column:span 2}
.inbox-item{flex-wrap:wrap;align-items:flex-start;gap:10px 12px}.inbox-text{flex:1 1 calc(100% - 40px)}.inbox-item .btn{flex:1 1 auto;justify-content:center}
.opt .tag.rec{position:absolute;top:-10px;right:10px}
.gate-steps{padding:14px}.gate-head{padding:12px 14px}
}
`;

function renderHtml(runs, views) {
  const model = buildModel(runs, views);
  const json = JSON.stringify(model).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Imperata board — ${esc(model.repo)}</title>
<link rel="icon" href="${FAVICON}">
<style>${BOARD_CSS}</style>
</head>
<body>
<noscript><p class="noscript">${esc(say('ui.noscript'))}</p></noscript>
<div id="app"></div>
<script type="application/json" id="board-data">${json}</script>
<script>(${boardApp.toString()})((${boardMessages.toString()})());</script>
</body>
</html>
`;
}

// The page itself. Embedded as source text: it must not use anything from this Node module.
function boardApp(MSG) {
  const DATA = JSON.parse(document.getElementById('board-data').textContent);
  const SERVER = window.__BOARD_SERVER__ || null;
  const PREFIX = 'orchestra-board:';
  const store = {
    get(k) { try { return window.localStorage.getItem(PREFIX + k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null || v === '') window.localStorage.removeItem(PREFIX + k); else window.localStorage.setItem(PREFIX + k, v); } catch (e) { /* storage unavailable: the page still works */ } },
  };
  const session = {
    get(k) { try { return window.sessionStorage.getItem(PREFIX + k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) window.sessionStorage.removeItem(PREFIX + k); else window.sessionStorage.setItem(PREFIX + k, v); } catch (e) { /* no session storage */ } },
  };
  function t(key, p) {
    const m = MSG.en[key];
    if (typeof m === 'function') return m(p || {});
    return m === undefined ? key : m;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const plain = (s) => String(s == null ? '' : s).replace(/\*\*|`/g, '');
  const clip = (s, n) => { const x = plain(s); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const runs = DATA.runs;
  const byId = {};
  runs.forEach((r) => { byId[r.id] = r; });
  // Line icons on a 16-unit square, drawn in the ink of the element that holds them. No emoji and no icon
  // font: every mark is the same weight in a light or a dark theme, and on every system.
  const ICON = {
    check: 'M3.2 8.6l3.1 3.1 6.5-7.4', alert: 'M8 3.2v6M8 12.3v.5', stop: 'M5 5h6v6H5z', dot: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    repair: 'M12.6 8.2a4.6 4.6 0 1 1-1.5-3.6M11.4 2.4v2.5H8.9', cross: 'M4.3 4.3l7.4 7.4M11.7 4.3l-7.4 7.4', minus: 'M4 8h8', wave: 'M3 9c1.6-3 3.3-3 5 0s3.4 3 5 0',
    user: 'M8 7.8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3.2 13.4c.5-2.3 2.4-3.5 4.8-3.5s4.3 1.2 4.8 3.5', doc: 'M4.4 2.4h4.5l2.7 2.7v8.5H4.4zM8.8 2.6v2.7h2.6',
    back: 'M9.5 4.2L5.7 8l3.8 3.8', go: 'M3.5 8h8.6M8.8 4.6L12.2 8l-3.4 3.4', edit: 'M3.2 12.8l.6-2.7 6.7-6.7 2.1 2.1-6.7 6.7zM9.4 4.5l2.1 2.1',
    warn: 'M8 2.9l5.5 9.7h-11zM8 6.7v2.8M8 11.3v.3', grid: 'M2.7 2.7h4.3v4.3H2.7zM9 2.7h4.3v4.3H9zM2.7 9h4.3v4.3H2.7zM9 9h4.3v4.3H9z',
    lock: 'M4.6 7.4h6.8v5.6H4.6zM6 7.4V5.5a2 2 0 0 1 4 0v1.9', more: 'M4 8h.01M8 8h.01M12 8h.01',
  };
  const ICON_CLASS = { stop: ' solid', dot: ' solid', more: ' bold', alert: ' bold' };
  const ic = (name, cls) => (ICON[name] ? '<svg class="ic' + (ICON_CLASS[name] || '') + (cls ? ' ' + cls : '') + '" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="' + ICON[name] + '"/></svg>' : '');
  const STEP_ICON = { passed: 'check', current: 'dot', owner: 'alert', blocked: 'stop', failed: 'cross', waived: 'wave', repair: 'repair', cancelled: 'minus' };
  const WHO_ICON = { owner: 'alert', blocked: 'stop', repair: 'repair', agents: 'dot', done: 'check', sent: 'more' };
  // The square status mark of a run: who has the next move.
  const mark = (who) => '<span class="dot ' + esc(who) + '" aria-hidden="true">' + ic(WHO_ICON[who] || 'alert') + '</span>';
  const pad2 = (n) => (Number(n) < 10 ? '0' : '') + n;
  const app = document.getElementById('app');
  const ui = { open: {}, active: null, seeded: {} };
  try { const saved = JSON.parse(session.get('open') || 'null'); if (saved) { ui.open = saved.open || {}; ui.seeded = saved.seeded || {}; } session.set('open', null); } catch (e) { /* ignore */ }

  // ---- answers kept in this browser until sent ------------------------------------------------
  const picks = {};
  const pkey = (runId, qid) => runId + '::' + qid;
  function getPick(runId, qid) {
    const k = pkey(runId, qid);
    if (!(k in picks)) { let v = {}; try { v = JSON.parse(store.get(k) || '{}') || {}; } catch (e) { v = {}; } picks[k] = v; }
    return picks[k];
  }
  function setPick(runId, qid, v) {
    const k = pkey(runId, qid);
    picks[k] = v;
    store.set(k, v && (v.pick || (v.own && v.own.trim())) ? JSON.stringify(v) : null);
  }
  const allQuestions = (r) => (r.groups ? r.groups.now.concat(r.groups.unsorted, r.groups.later) : []);
  const neededNow = (r) => (r.groups ? r.groups.now.concat(r.groups.unsorted) : []);
  function answerOf(r, q) {
    const s = getPick(r.id, q.id);
    if (s.pick === '__own') return String(s.own || '').trim();
    if (s.pick && q.options.some((o) => o.value === s.pick)) return s.pick;
    return '';
  }
  function missingFor(r) {
    if (!r.gate) return [];
    return r.gate.needs.filter((id) => { const q = allQuestions(r).find((x) => x.id === id); return q && !q.sent && !answerOf(r, q); });
  }
  function gateAnswer(r) {
    const g = r.gate;
    if (!g) return '';
    const s = getPick(r.id, g.gate);
    const approve = 'APPROVE ' + g.version;
    const request = 'REQUEST CHANGES ' + g.version;
    if (s.pick !== approve && s.pick !== request) return '';
    if (s.pick === approve && (r.mode === 'pull-request' || missingFor(r).length)) return '';
    const note = String(s.own || '').trim().replace(/\s+/g, ' ');
    if (s.pick === request && !note) return '';
    return s.pick + (note ? ' — ' + note : '');
  }
  // A line that begins with the name of a human gate is the owner's decision on that gate, and only the approval
  // card writes one. Text agents wrote (the owner's name in the manifest, the id of a question) goes into the reply
  // on one line, and an answer to a question whose id is a gate's name is marked as an answer. Otherwise the
  // owner's name could carry an APPROVE line into the reply of an owner who asked for changes.
  const HUMAN_GATES = ['businessApproval', 'planApproval', 'humanAcceptance'];
  const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  function linesFor(r) {
    const lines = [];
    allQuestions(r).forEach((q) => {
      const v = answerOf(r, q);
      const id = oneLine(q.id);
      if (v) lines.push((HUMAN_GATES.some((g) => id.startsWith(g)) ? 'Question ' : '') + id + ': ' + v.replace(/\s+/g, ' '));
    });
    const g = gateAnswer(r);
    if (g) lines.push(r.gate.gate + ': ' + g);
    return lines;
  }
  const readyRuns = () => runs.filter((r) => !r.error && linesFor(r).length);
  const replyFor = (r) => 'My decisions as owner (' + oneLine(r.owner) + ') for run ' + oneLine(r.id) + '. Record each answer in clarification.md and each gate decision in approvals, with my name and the time, update run.json, then render the board.\n\n' + linesFor(r).join('\n');
  const reply = () => readyRuns().map(replyFor).join('\n\n---\n\n');
  function progressOf(r) {
    const qs = neededNow(r);
    return { done: qs.filter((q) => q.sent || answerOf(r, q)).length, total: qs.length };
  }

  // ---- routing --------------------------------------------------------------------------------
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    if (parts[0] === 'run' && byId[decodeURIComponent(parts[1] || '')]) return { view: 'run', run: byId[decodeURIComponent(parts[1])], tab: parts[2] || null };
    return { view: 'home' };
  }
  const runHash = (r, tab) => '#/run/' + encodeURIComponent(r.id) + (tab ? '/' + tab : '');
  const openCount = (r) => (r.groups ? neededNow(r).filter((q) => !q.sent).length : 0);

  // ---- pieces -----------------------------------------------------------------------------------
  const stageName = (stage) => { const s = t('stage.' + stage); return s === 'stage.' + stage ? stage : s; };
  const stageChip = (r) => '<span class="chip ' + esc(r.tone || 'muted') + '" title="' + esc(r.stage) + '"><i></i>' + esc(stageName(r.stage)) + '</span>';
  const nextText = (r) => t(r.next.key, r.next.p);
  const badgeText = (r) => { const b = t(r.next.badge); return b === r.next.badge ? r.stage : b; };
  // The seven steps as a strip, with the step the run is at spelled out under it.
  const track = (r) => '<div class="track-wrap"><div class="track" aria-hidden="true">' + r.steps.map((s) => '<i class="' + esc(s.state) + '"></i>').join('') + '</div>'
    + '<div class="track-cap"><span>' + esc(t('run.step', { n: pad2(r.cur + 1), total: pad2(r.steps.length) })) + '</span><b>' + esc(t('step.' + r.cur)) + '</b></div></div>';
  const resChip = (res) => (res ? '<span class="res ' + esc(res.toLowerCase()) + '">' + ic(res === 'PASSED' ? 'check' : res === 'FAILED' || res === 'BLOCKED' ? 'cross' : 'minus') + esc(res) + '</span>' : '<span class="res none">—</span>');
  const section = (no, label, count) => '<h2 class="section-title"><span class="no">' + no + '</span><span>' + esc(label) + '</span><span class="rule"></span>' + (count === undefined ? '' : '<span class="count">' + pad2(count) + '</span>') + '</h2>';

  // The Imperata symbol: a broken hexagon round an I, in the ink of the theme, with the brand's red point.
  const LOGO = '<svg class="logo" viewBox="30 20 196 226" aria-hidden="true" focusable="false">'
    + '<g fill="none" stroke="currentColor" stroke-width="13"><path d="M119 26 42 72v40"/><path d="M42 133v49l77 45"/><path d="m137 26 77 46v40"/><path d="M214 133v49l-77 45"/></g>'
    + '<path fill="currentColor" d="M100 76h56l-6 12h-11v82h11l6 12h-56l6-12h11V88h-11z"/><path fill="#E84C3D" d="m118 217 10 25 10-25z"/></svg>';

  // The header is the title block of the sheet: the name, then one cell per fact about this board.
  function header() {
    const cell = (k, v, cls) => '<div class="tb' + (cls ? ' ' + cls : '') + '"><span class="tb-k">' + esc(k) + '</span><span class="tb-v">' + v + '</span></div>';
    return '<header class="top"><a class="brand" href="#/" aria-label="' + esc(t('ui.title')) + '">' + LOGO + '<span class="brand-text"><b>Imperata</b><small>' + esc(t('ui.board')) + '</small></span></a>'
      + '<div class="tbs">' + cell(t('tb.repo'), esc(DATA.repo)) + cell(t('tb.runs'), pad2(runs.length), 'narrow') + cell(t('tb.rendered'), esc(DATA.renderedAt), 'wide')
      + cell(t('tb.sync'), SERVER ? '<span class="live"><i></i>' + esc(t('ui.live')) + '</span>' : esc(t('ui.file')), 'narrow') + '</div></header>';
  }

  function side(rt) {
    const inbox = runs.filter((r) => r.who === 'owner').length;
    let html = '<a class="nav-home' + (rt.view === 'home' ? ' active' : '') + '" href="#/"><span class="dot" aria-hidden="true">' + ic('grid') + '</span><span class="nav-text"><span class="nav-title">' + esc(t('ui.home')) + '</span></span>' + (inbox ? '<span class="badge warn">' + inbox + '</span>' : '') + '</a>';
    ['owner', 'blocked', 'repair', 'agents', 'done'].forEach((g) => {
      const list = runs.filter((r) => (r.who || 'blocked') === g);
      if (!list.length) return;
      html += '<div class="nav-group"><span>' + esc(t('group.' + g)) + '</span><span class="rule"></span><span>' + pad2(list.length) + '</span></div>';
      list.forEach((r) => {
        const n = openCount(r);
        html += '<a class="nav-item' + (rt.view === 'run' && rt.run === r ? ' active' : '') + '" href="' + runHash(r) + '">' + mark(r.who || 'blocked')
          + '<span class="nav-text"><span class="nav-title">' + esc(r.title || r.id) + '</span><span class="nav-id">' + esc(r.id) + '</span></span>'
          + (n ? '<span class="badge' + (r.who === 'owner' ? ' warn' : '') + '" title="' + esc(t('stat.questions')) + '">' + n + '</span>' : '') + '</a>';
      });
    });
    return html;
  }

  function home() {
    if (!runs.length) return '<div class="card empty"><h2>' + esc(t('empty.title')) + '</h2><p>' + esc(t('empty.text')) + '</p></div>';
    const count = (w) => runs.filter((r) => r.who === w).length;
    const questions = runs.reduce((n, r) => n + openCount(r), 0);
    const stat = (cls, v, label) => '<div class="stat ' + cls + (v ? '' : ' zero') + '"><div class="l"><i></i>' + esc(label) + '</div><div class="v">' + pad2(v) + '</div></div>';
    let html = '<h1 class="page-h">' + esc(t('ui.home')) + '</h1><div id="auto" class="auto" hidden></div><div class="stats bp">' + stat('owner', count('owner'), t('stat.owner')) + stat('blocked', count('blocked'), t('stat.blocked'))
      + stat('agents', count('agents') + count('repair'), t('stat.agents')) + stat('q', questions, t('stat.questions')) + stat('done', count('done'), t('stat.done')) + '</div>';
    const mine = runs.filter((r) => r.who === 'owner');
    const sentWaiting = runs.filter((r) => r.unrecorded && r.unrecorded.length && r.who !== 'owner');
    html += section('01', t('home.needsYou'), mine.length) + '<div class="inbox">';
    if (!mine.length && !sentWaiting.length) html += '<div class="card empty">' + esc(t('home.nothing')) + '</div>';
    mine.forEach((r) => {
      const n = openCount(r);
      const actions = (n ? '<a class="btn warn" href="' + runHash(r, 'decisions') + '">' + esc(t('home.decide', { n: n })) + ic('go') + '</a>' : '')
        + (r.gate && !n ? '<a class="btn warn" href="' + runHash(r, 'decisions') + '">' + esc(t('home.approve')) + ic('go') + '</a>' : '')
        + '<a class="btn" href="' + runHash(r) + '">' + esc(t('home.open')) + '</a>';
      html += '<div class="card inbox-item">' + mark('owner') + '<div class="inbox-text"><div class="inbox-title">' + esc(r.title) + ' <span class="mono muted">' + esc(r.id) + '</span></div><div class="inbox-next">' + esc(nextText(r)) + '</div></div>' + actions + '</div>';
    });
    sentWaiting.forEach((r) => {
      html += '<div class="card inbox-item sentw">' + mark('sent') + '<div class="inbox-text"><div class="inbox-title">' + esc(r.title) + ' <span class="mono muted">' + esc(r.id) + '</span></div><div class="inbox-next">' + esc(t('home.sentWaiting')) + '</div></div><a class="btn" href="' + runHash(r) + '">' + esc(t('home.open')) + '</a></div>';
    });
    html += '</div>' + section('02', t('home.allRuns'), runs.length) + '<div class="runs">';
    runs.forEach((r) => {
      if (r.error) { html += '<a class="card run-card blocked" href="' + runHash(r) + '"><div class="rc-top"><span class="rc-run">' + mark('blocked') + '<span class="mono rc-id">' + esc(r.id) + '</span></span></div><div class="rc-body"><div class="rc-next">' + esc(r.error) + '</div></div></a>'; return; }
      const n = openCount(r);
      const num = (v) => '<b' + (v ? '' : ' class="nil"') + '>' + pad2(v) + '</b>';
      html += '<a class="card run-card ' + esc(r.who) + '" href="' + runHash(r) + '"><div class="rc-top"><span class="rc-run">' + mark(r.who) + '<span class="mono rc-id">' + esc(r.id) + '</span></span>' + stageChip(r) + '</div>'
        + '<div class="rc-body"><div class="rc-title">' + esc(r.title) + '</div>' + track(r) + '<div class="rc-next"><b>' + esc(badgeText(r)) + '.</b> ' + esc(nextText(r)) + '</div></div>'
        + '<div class="rc-foot"><span>' + esc(t('stat.questions')) + num(n) + '</span><span>' + esc(t('side.blockers')) + num(r.blockers.length) + '</span>' + (r.validator.status === 'rejected' ? '<span class="bad">' + ic('cross') + esc(t('side.check')) + ': ' + esc(t('side.rejected')) + '</span>' : '') + '</div></a>';
    });
    html += '</div>';
    if (DATA.lanes.length) {
      html += section('03', t('home.order')) + '<div class="lanes">' + DATA.lanes.map((col, i) => '<div class="lane"><div class="lane-h"><span>' + esc(i === 0 ? t('home.first') : t('home.then', { n: i + 1 })) + '</span><span class="rule"></span></div>'
        + col.map((nd) => (nd.id ? '<a class="lane-item" href="' + runHash(byId[nd.id]) + '"><span class="mono small">' + esc(nd.id) + '</span>' + (nd.title && nd.title !== nd.id ? '<span class="lane-title">' + esc(nd.title) + '</span>' : '') + stageChip(byId[nd.id]) + '</a>' : '<div class="lane-item ghost"><span class="mono small">' + esc(nd.ref) + '</span><span class="small">' + esc(t('side.notOpened')) + '</span></div>')).join('') + '</div>').join('') + '</div>';
    }
    html += legend();
    return html;
  }

  // What each mark means. A status is never colour alone: the mark and its word go together everywhere.
  function legend() {
    const item = (who, label) => '<span class="lg">' + mark(who) + esc(label) + '</span>';
    return '<div class="legend"><div class="legend-h">' + esc(t('legend.title')) + '</div><div class="legend-items">' + item('owner', t('legend.owner')) + item('agents', t('legend.agents')) + item('blocked', t('legend.blocked')) + item('done', t('legend.passed'))
      + '<span class="lg"><span class="dot" aria-hidden="true">' + ic('user') + '</span>' + esc(t('legend.human')) + '</span></div><p class="legend-note">' + esc(t('legend.note')) + '</p></div>';
  }

  function stepper(r) {
    return '<ol class="stepper bp">' + r.steps.map((s, i) => {
      const gate = s.gate ? t('gate.' + s.gate) : '';
      return '<li class="step s-' + esc(s.state) + '"' + (i === r.cur ? ' aria-current="step"' : '') + '><span class="node" aria-hidden="true">' + ic(STEP_ICON[s.state]) + '</span><span class="s-text"><span class="s-no">' + pad2(i + 1) + '</span><span class="s-name">' + esc(t('step.' + i)) + '</span>'
        + (gate && (s.human || gate !== t('step.' + i)) ? '<span class="s-gate">' + (s.human ? '<span class="s-human" title="' + esc(t('legend.human')) + '">' + ic('user') + '</span>' : '') + esc(gate) + '</span>' : '')
        + (s.result ? '<span class="s-res r-' + esc(String(s.result).toLowerCase()) + '">' + esc(s.result) + '</span>' : '')
        + (s.evidence.length ? '<span class="s-ev" title="' + esc(s.evidence.join(' · ')) + '">' + s.evidence.slice(0, 2).map((x) => '<span>' + esc(x) + '</span>').join('') + '</span>' : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  const reproLine = (rep) => (!rep ? t('gate.notReproduced')
    : rep.shown.length === rep.files.length ? t('gate.reproduced', { files: rep.files.join(', '), n: rep.files.length, commit: rep.commit })
      : t('gate.reproFailed', { files: rep.files.filter((f) => rep.shown.indexOf(f) < 0).join(', '), commit: rep.commit }));
  const attnList = (r) => '<ul class="attn">' + r.attention.map((a) => '<li>' + esc(t(a.key, a.p)) + '</li>').join('') + '</ul>';

  function runView(r, tabArg) {
    const crumb = '<a class="crumb" href="#/">' + ic('back') + esc(t('run.back')) + '</a>';
    if (r.error) return crumb + '<div class="next blocked"><span class="who">' + mark('blocked') + esc(r.id) + '</span><div class="what">' + esc(t('run.unreadable')) + ' ' + esc(r.error) + '</div></div>';
    const tab = ['decisions', 'tasks', 'trace'].indexOf(tabArg) >= 0 ? tabArg : (r.gate || allQuestions(r).length || r.hasLog ? 'decisions' : r.taskCount ? 'tasks' : r.trace.length ? 'trace' : 'decisions');
    // The facts of the run, one cell each, as on the title block of a drawing.
    const spec = (k, v, title) => '<div' + (title ? ' title="' + esc(title) + '"' : '') + '><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>';
    let html = crumb + '<div class="run-head"><h1>' + esc(r.title) + '</h1><div class="spec">' + spec(t('spec.run'), esc(r.id)) + spec(t('spec.stage'), stageChip(r)) + spec(t('spec.mode'), esc(r.mode))
      + (r.light ? spec(t('spec.track'), esc(t('run.light')), t('run.lightTitle', r.trackDecision || {})) : '')
      + (r.bug ? spec(t('spec.kind'), esc(t(r.confidential ? 'run.bugConfidential' : 'run.bug'))) : '') + spec(t('spec.rev'), esc(r.revision)) + spec(t('spec.updated'), esc(r.updatedAt)) + spec(t('spec.owner'), esc(r.owner))
      + (r.ticketRef ? spec(t('spec.ticket'), esc(r.ticketRef)) : '') + '</div></div>';
    html += '<div id="auto" class="auto" hidden></div>';
    html += '<div class="next ' + esc(r.who) + '"><span class="who">' + mark(r.who) + esc(badgeText(r)) + '</span><div class="what">' + esc(nextText(r))
      + (!r.gate && r.attention.length ? '<div class="attn-title" style="margin-top:10px">' + esc(t(r.who === 'owner' ? 'check.title' : 'check.notice')) + '</div>' + attnList(r) : '') + '</div></div>';
    html += stepper(r);
    const tabBtn = (id, label, n) => '<a class="tab" role="tab" href="' + runHash(r, id) + '" aria-selected="' + (tab === id) + '">' + esc(label) + (n ? '<span class="badge' + (id === 'decisions' && r.who === 'owner' ? ' warn' : '') + '">' + n + '</span>' : '') + '</a>';
    html += '<div class="run-grid"><div class="main-col"><nav class="tabs" role="tablist">' + tabBtn('decisions', t('tab.decisions'), openCount(r)) + tabBtn('tasks', t('tab.tasks'), r.taskCount) + tabBtn('trace', t('tab.trace'), r.trace.length) + '</nav>';
    html += tab === 'tasks' ? tasksTab(r) : tab === 'trace' ? traceTab(r) : decisionsTab(r);
    html += '</div><aside class="side-col">' + sideCards(r) + '</aside></div>';
    return html;
  }

  // ---- decisions ------------------------------------------------------------------------------
  function seedOpen(r) {
    if (ui.seeded[r.id]) return;
    ui.seeded[r.id] = true;
    const first = neededNow(r).find((q) => !q.sent && !answerOf(r, q));
    if (first) ui.open[pkey(r.id, first.id)] = true;
  }
  function qState(r, q) { return answerOf(r, q) ? 'answered' : q.sent ? 'sent' : 'todo'; }
  function qSummary(r, q) {
    const v = answerOf(r, q);
    if (v) { const o = q.options.find((x) => x.value === v); return '✓ ' + esc(clip(o ? o.label + ' ' + o.main : v, 60)); }
    if (q.sent) return esc(t('q.sent', { at: q.sent.at }));
    return q.needed ? esc(t('q.needed', { gate: t('gate.' + q.needed.gate) === 'gate.' + q.needed.gate ? q.needed.label : t('gate.' + q.needed.gate) })) : '';
  }
  function qCard(r, q) {
    const k = pkey(r.id, q.id);
    const s = getPick(r.id, q.id);
    const open = Boolean(ui.open[k]);
    const own = s.pick === '__own' || !q.options.length;
    const gateName = q.needed ? (q.needed.gate ? t('gate.' + q.needed.gate) : q.needed.label) : '';
    const meta = [q.affects && '<span>' + esc(t('q.affects')) + ': ' + inline(q.affects) + '</span>', q.by && '<span>' + esc(t('q.decider')) + ': ' + esc(q.by) + '</span>',
      q.needed && '<span class="' + (q.late ? 'bad' : '') + '">' + esc(t('q.needed', { gate: gateName })) + (q.late ? ' · ' + esc(t('q.late')) : '') + '</span>'].filter(Boolean).join('');
    return '<article class="qc ' + qState(r, q) + (open ? ' open' : '') + '" data-run="' + esc(r.id) + '" data-q="' + esc(q.id) + '">'
      + '<button type="button" class="qc-head" aria-expanded="' + open + '"><span class="qid">' + esc(q.id) + '</span><span class="qc-title">' + inline(q.question) + '</span><span class="qc-sum">' + qSummary(r, q) + '</span><span class="chev" aria-hidden="true"></span></button>'
      + '<div class="qc-body">' + (q.why ? '<p class="why"><b>' + esc(t('q.why')) + '.</b> ' + inline(q.why) + '</p>' : '') + (meta ? '<div class="qmeta">' + meta + '</div>' : '')
      + (q.note ? '<p class="qnote"><b>' + esc(t('q.note')) + '.</b> ' + inline(q.note) + '</p>' : '')
      + (q.rec ? '<p class="qrec"><b>' + esc(t('q.recNote')) + ':</b> ' + inline(q.rec) + '</p>' : '')
      + (q.sent ? '<p class="note violet"><b>' + esc(t('q.sent', { at: q.sent.at })) + '</b> — ' + esc(q.sent.value) + ' · ' + esc(t('q.sentWait')) + '. ' + esc(t('q.change')) + '</p>' : '')
      + (q.free ? '<p class="qfree"><b>' + esc(t('q.options')) + '.</b> ' + inline(q.free) + '</p>' : '')
      + (q.lead ? '<p class="qfree"><b>' + esc(t('q.options')) + '.</b> ' + esc(q.lead) + '</p>' : '')
      + (q.options.length ? '<div class="opts" role="radiogroup" aria-label="' + esc(q.id) + '">' + q.options.map((o, i) => '<label class="opt"><input type="radio" name="' + esc(k) + '" value="' + esc(o.value) + '" aria-label="' + esc(optionName(o)) + '"' + (s.pick === o.value ? ' checked' : '') + '>'
        + (i < 9 ? '<span class="key" aria-hidden="true">' + (i + 1) + '</span>' : '') + '<span class="opt-body"><span class="opt-main"><b>' + esc(o.label) + '</b> ' + esc(o.main) + '</span>' + (o.cons ? '<span class="opt-cons">→ ' + esc(o.cons) + '</span>' : '') + '</span>'
        + (o.recommended ? '<span class="tag rec">' + esc(t('q.recommended')) + '</span>' : '') + '</label>').join('') + '</div>' : '')
      + (q.options.length ? '<button type="button" class="link own-toggle"' + (own ? ' hidden' : '') + '>' + esc(t('q.own')) + '</button>' : '')
      + '<textarea class="own" rows="2" placeholder="' + esc(t('q.ownPh')) + '"' + (own ? '' : ' hidden') + '>' + esc(s.own || '') + '</textarea></div></article>';
  }
  function gateCard(r) {
    const g = r.gate;
    const k = pkey(r.id, g.gate);
    const s = getPick(r.id, g.gate);
    const missing = missingFor(r);
    const approve = 'APPROVE ' + g.version;
    const request = 'REQUEST CHANGES ' + g.version;
    const pr = r.mode === 'pull-request';
    const doc = (f) => '<a class="doc" href="' + esc(f.href) + '" target="_blank" rel="noopener">' + ic('doc') + esc(f.name) + '</a>';
    const docs = g.files.map(doc).join('') + (g.clar ? ' <span class="muted small">' + esc(t('gate.andDecisions')) + '</span> ' + doc(g.clar) : '');
    return '<section class="gate-card bp" data-run="' + esc(r.id) + '" data-gate="' + esc(g.gate) + '"><div class="gate-head"><div class="gate-kicker">' + ic('user') + esc(t('gate.title')) + ' · ' + esc(t('gate.' + g.gate)) + '</div><h2>' + esc(t('ask.' + g.gate)) + '</h2></div>'
      + '<ol class="gate-steps"><li><b>' + esc(t('gate.read')) + ':</b> ' + docs + (g.plan ? ' <span class="muted small">' + esc(t('gate.planNote', g.plan)) + '</span>' : '') + '<div class="muted small" style="margin-top:4px">' + esc(t('gate.version', { v: g.version })) + '</div></li>'
      + (g.reproduction ? '<li><b>' + esc(t('gate.reproTitle')) + ':</b> ' + esc(reproLine(g.reproduction.rep)) + '</li>' : '')
      + (g.assumptions.length ? '<li><b>' + esc(t('gate.assumptionsTitle')) + ':</b> <span class="muted small">' + esc(t('gate.assumptions', { n: g.assumptions.length })) + '</span><ul class="attn">' + g.assumptions.map((a) => '<li><b>' + esc(a.id) + '</b> ' + esc(a.text) + '</li>').join('') + '</ul></li>' : '')
      + (g.decisions.length ? '<li><b>' + esc(t('gate.decisionsTitle')) + ':</b> <span class="muted small">' + esc(t('gate.decisions', { n: g.decisions.length, s: g.decisions.filter((d) => d.area).length })) + '</span><ul class="attn">' + g.decisions.map((d) => '<li><b>' + esc(d.id) + '</b> ' + (d.area ? '<span class="muted small">(' + esc(t('gate.sensitive')) + ': ' + esc(d.area) + ')</span> ' : '') + esc(d.text) + '</li>').join('') + '</ul></li>' : '')
      + (r.attention.length ? '<li><b>' + esc(t('check.title')) + ':</b>' + attnList(r) + '</li>' : '')
      + '<li>' + (g.sent ? '<p class="note violet" style="margin-bottom:8px">' + esc(t('gate.sent', { at: g.sent.at, verdict: g.sent.verdict })) + '</p>' : '')
      + (r.light && g.gate === 'businessApproval' ? '<p class="note" style="margin-bottom:8px">' + esc(t('gate.lightNote')) + '</p>' : '')
      + (pr ? '<p class="note" style="margin-bottom:8px">' + esc(t('gate.pr', { gate: g.gate })) + '</p>' : '')
      + '<p class="locked" data-locked' + (missing.length && !pr ? '' : ' hidden') + '>' + ic('lock') + '<span data-locked-text>' + esc(t('gate.locked', { ids: missing.join(', ') })) + '</span> <button type="button" class="link goto-q">' + esc(t('gate.goto')) + '</button></p>'
      + '<div class="choices" role="radiogroup" aria-label="' + esc(t('ask.' + g.gate)) + '" style="margin-top:8px">'
      + (pr ? '' : '<label class="choice approve' + (missing.length ? ' disabled' : '') + '"><input type="radio" name="' + esc(k) + '" value="' + esc(approve) + '" aria-label="' + esc(t('gate.approve') + ': ' + t('gate.approveHint')) + '" data-approve' + (s.pick === approve && !missing.length ? ' checked' : '') + (missing.length ? ' disabled' : '') + '><span class="c-icon" aria-hidden="true">' + ic('check') + '</span><span><b>' + esc(t('gate.approve')) + '</b><span class="muted small">' + esc(t('gate.approveHint')) + '</span></span></label>')
      + '<label class="choice request"><input type="radio" name="' + esc(k) + '" value="' + esc(request) + '" aria-label="' + esc(t('gate.request') + ': ' + t('gate.requestHint')) + '"' + (s.pick === request ? ' checked' : '') + '><span class="c-icon" aria-hidden="true">' + ic('edit') + '</span><span><b>' + esc(t('gate.request')) + '</b><span class="muted small">' + esc(t('gate.requestHint')) + '</span></span></label></div>'
      + '<textarea class="gate-note" rows="2" style="margin-top:8px" placeholder="' + esc(t('gate.commentPh')) + '">' + esc(s.own || '') + '</textarea></li></ol></section>';
  }
  // One cell of the meter per question, so the bar counts as well as fills.
  function progressBar(r) {
    const p = progressOf(r);
    if (!p.total) return '';
    const pct = Math.round((p.done / p.total) * 100);
    return '<div class="progress" data-run="' + esc(r.id) + '"><div class="progress-row"><b data-p-label>' + esc(t('dec.progress', p)) + '</b><span class="muted small">' + esc(t('dec.progressHint')) + '</span></div>'
      + '<div class="meter" style="--n:' + p.total + '" role="progressbar" aria-valuemin="0" aria-valuemax="' + p.total + '" aria-valuenow="' + p.done + '"><i data-p-fill style="width:' + pct + '%"></i></div><p class="p-done" data-p-done' + (p.done === p.total ? '' : ' hidden') + '>' + esc(t('dec.allDone')) + '</p></div>';
  }
  function decisionsTab(r) {
    seedOpen(r);
    let html = '';
    if (r.unrecorded.length) html += '<p class="note violet">' + esc(t('sent.files')) + ' ' + r.unrecorded.map((f) => '<a href="' + esc(f.href) + '" target="_blank" rel="noopener">decisions/' + esc(f.name) + '</a>').join(', ') + '</p>';
    if (r.gate) html += gateCard(r);
    const qs = allQuestions(r);
    if (qs.length) {
      html += '<div class="card" style="display:flex;flex-direction:column;gap:12px">' + progressBar(r)
        + '<div class="toolbar"><span class="muted small keys-tip">' + (qs.some((q) => q.options.length) ? esc(t('dec.keys')) : '') + '</span><span><button type="button" class="link" data-expand="1">' + esc(t('dec.expandAll')) + '</button> · <button type="button" class="link" data-expand="0">' + esc(t('dec.collapseAll')) + '</button></span></div>';
      const list = (items) => '<div class="qlist">' + items.map((q) => qCard(r, q)).join('') + '</div>';
      const title = (label, n, cls) => '<div class="group-title' + (cls || '') + '"><span>' + esc(label) + '</span><span class="rule"></span><span class="badge">' + n + '</span></div>';
      const g = r.groups;
      const nowGate = r.nowGate ? t('gate.' + r.nowGate) : '';
      if (g.now.length) html += title(t('dec.now', { gate: nowGate }), g.now.length, ' now') + list(g.now);
      if (g.unsorted.length) html += title(g.now.length || g.later.length ? t('dec.unsorted') : t('dec.open'), g.unsorted.length) + list(g.unsorted);
      if (g.later.length) html += '<details class="group"><summary>' + title(t('dec.later'), g.later.length) + '</summary>' + list(g.later) + '</details>';
      html += '</div>';
    } else html += '<div class="card empty">' + esc(r.hasLog ? t('dec.none') : t('dec.noLog')) + '</div>';
    if (r.decided.length) {
      html += '<details class="card group"><summary><div class="group-title"><span>' + esc(t('dec.decided', { n: r.decided.length })) + '</span></div></summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + esc(t('col.id')) + '</th><th>' + esc(t('col.decision')) + '</th><th>' + esc(t('col.by')) + '</th><th>' + esc(t('col.at')) + '</th></tr></thead><tbody>'
        + r.decided.map((q) => '<tr><td class="mono">' + esc(q.id) + '</td><td>' + inline(q.decision) + '</td><td>' + esc(q.by) + '</td><td class="mono small">' + esc(q.at) + '</td></tr>').join('') + '</tbody></table></div></details>';
    }
    return html;
  }

  // ---- tasks and traceability ------------------------------------------------------------------
  function tasksTab(r) {
    if (!r.taskCount) return '<div class="card empty">' + esc(t('tasks.none')) + '</div>';
    // Complexity is an amount, so it is drawn as one to three bars in one ink, not as a colour.
    const bars = (l) => '<span class="lvb lv-' + esc(l || 'none') + '" aria-hidden="true"><i></i><i></i><i></i></span>';
    const lv = (l) => '<span class="lv">' + bars(l) + esc(t('level.' + l)) + '</span>';
    let html = '<div class="level-legend">' + lv('low') + lv('standard') + lv('high') + '<span>' + esc(t('tasks.legend')) + '</span></div><div class="waves">';
    html += r.waves.map((w, i) => '<div class="wave"><div class="wave-h"><b>' + esc(t('tasks.wave', { n: pad2(i + 1) })) + '</b><span class="rule"></span><span>' + pad2(w.length) + '</span></div>' + w.map((k) => '<div class="task"><div class="t-head"><span class="mono t-id">' + esc(k.id) + '</span><span class="lv">' + bars(k.level) + (k.level ? esc(t('level.' + k.level)) + ' · ' + esc(k.model) : esc(t('tasks.noComplexity'))) + '</span></div>'
      + '<div class="t-body"><div class="t-title">' + esc(k.title || '—') + '</div>' + (k.reason ? '<div class="t-reason">' + esc(k.reason) + '</div>' : '')
      + (k.acs.length || k.dependsOn.length ? '<div class="t-meta">' + k.acs.map((a) => '<span class="ac">' + esc(a) + '</span>').join('') + (k.dependsOn.length ? '<span>' + esc(t('tasks.after')) + ' ' + esc(k.dependsOn.join(', ')) + '</span>' : '') + '</div>' : '') + '</div>'
      + '<div class="t-status"><span class="' + (k.dev ? 'on' : '') + '">' + (k.dev ? ic('check') : '') + 'dev</span><span class="' + (k.qa ? 'on' : '') + '">' + (k.qa ? ic('check') : '') + 'qa</span>' + (k.checked ? '<span class="on">' + ic('check') + esc(t('tasks.checked')) + '</span>' : k.awaitsCheck ? '<span class="warn">' + esc(t('tasks.yourCheck')) + '</span>' : '') + (k.repairs ? '<span class="warn">' + ic('repair') + 'repair ×' + k.repairs + '</span>' : '') + (k.hasSkills ? '' : '<span class="warn">' + esc(t('tasks.noSkills')) + '</span>') + '</div></div>').join('') + '</div>').join('');
    html += '</div>';
    if (r.cyclic.length) html += '<p class="note">' + esc(t('tasks.cycle', { ids: r.cyclic.join(', ') })) + '</p>';
    if (r.unknownDeps.length) html += '<p class="note">' + esc(t('tasks.unknown', { ids: r.unknownDeps.join(', ') })) + '</p>';
    return html;
  }
  function traceTab(r) {
    if (!r.trace.length) return '<div class="card empty">' + esc(t('trace.none')) + '</div>';
    const total = r.trace.length;
    const planned = r.trace.filter((x) => x.tasks.length).length;
    const tested = r.trace.filter((x) => x.covered).length;
    const passed = r.trace.filter((x) => x.result === 'PASSED').length;
    const withCases = r.trace.some((x) => x.cases.length);
    const mini = (v, label) => '<div class="mini"><div class="l">' + esc(label) + '</div><div class="v">' + pad2(v) + '<small>/' + pad2(total) + '</small></div><div class="meter" style="--n:' + total + '"><i style="width:' + Math.round((v / total) * 100) + '%"></i></div></div>';
    const cols = ['col.ac', 'col.then'].concat(withCases ? ['col.cases'] : [], ['col.tasks', 'col.tests', 'col.result']);
    const ids = (xs) => xs.map((id) => '<span class="nw">' + esc(id) + '</span>').join(', ');
    const none = '<span class="gap">' + esc(t('trace.missing')) + '</span>';
    const field = (label, value) => (value ? '<div class="ac-f"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>' : '');
    // What a row opens to: the criterion in full, each case with its tests and its result, and the tests by name.
    // A long table of rows cut to their "Then" tells the owner little unless each row opens.
    const detail = (x) => {
      let html = '<dl class="ac-dl">' + field(t('trace.given'), x.given) + field(t('trace.when'), x.when) + field(t('col.then'), x.then) + field(t('trace.rules'), x.rules) + '</dl>';
      if (x.cases.length) {
        // One table for each set of columns: cases of one criterion may stand in tables that name different ones.
        const groups = [];
        x.cases.forEach((c) => { const key = c.cells.map((v) => v[0]).join('\u0000'); const g = groups.find((y) => y.key === key); if (g) g.cases.push(c); else groups.push({ key, cases: [c] }); });
        groups.forEach((g) => {
          html += '<div class="tbl-wrap"><table class="tbl cases"><thead><tr><th>' + esc(t('trace.case')) + '</th>' + g.cases[0].cells.map((c) => '<th>' + esc(c[0]) + '</th>').join('') + '<th>' + esc(t('col.tests')) + '</th><th>' + esc(t('col.result')) + '</th></tr></thead><tbody>'
            + g.cases.map((c) => '<tr><td class="mono">' + esc(c.id) + '</td>' + c.cells.map((v) => '<td>' + esc(v[1]) + '</td>').join('') + '<td class="mono small">' + (c.tests.length ? ids(c.tests) : none) + '</td><td>' + resChip(c.result) + '</td></tr>').join('')
            + '</tbody></table></div>';
        });
      } else if (x.testResults.length) {
        html += '<div class="ac-tests">' + x.testResults.map((y) => '<span class="ac-test"><span class="mono small nw">' + esc(y.id) + '</span>' + resChip(y.result) + '</span>').join('') + '</div>';
      }
      return html;
    };
    const row = (x) => '<tr class="ac-row"><td class="mono"><button type="button" class="ac-toggle" aria-expanded="false" aria-label="' + esc(t('trace.open', { id: x.id })) + '">' + esc(x.id) + '</button></td><td>' + esc(x.then) + '</td>'
      + (withCases ? '<td class="small nw">' + (x.cases.length ? esc(t('trace.casesOf', { passed: x.cases.filter((c) => c.result === 'PASSED').length, total: x.cases.length })) : '—') + '</td>' : '')
      + '<td class="mono small">' + (x.tasks.length ? ids(x.tasks) : none) + '</td><td class="mono small">' + (x.tests.length ? ids(x.tests) : none) + '</td><td>' + resChip(x.result) + '</td></tr>'
      + '<tr class="ac-detail" hidden><td colspan="' + cols.length + '">' + detail(x) + '</td></tr>';
    return '<div class="mini-stats">' + mini(planned, t('trace.planned')) + mini(tested, t('trace.tested')) + mini(passed, t('trace.passed')) + '</div>'
      + '<p class="small muted ac-hint">' + esc(t('trace.hint')) + '</p>'
      + '<div class="card tbl-card"><div class="tbl-wrap"><table class="tbl trace"><thead><tr>' + cols.map((c) => '<th>' + esc(t(c)) + '</th>').join('') + '</tr></thead><tbody>'
      + r.trace.map(row).join('')
      + '</tbody></table></div></div>';
  }

  // ---- side column ----------------------------------------------------------------------------
  function sideCards(r) {
    const panel = (title, body, n) => '<div class="card"><div class="card-title"><span>' + esc(title) + '</span>' + (n === undefined ? '' : '<span class="badge">' + n + '</span>') + '</div><div class="card-body">' + body + '</div></div>';
    const bad = (p) => '<p class="check-line bad">' + ic('cross') + '<span>' + esc(p) + '</span></p>';
    const dep = (id) => '<a class="dep" href="' + runHash(byId[id]) + '"><span class="mono small">' + esc(id) + '</span>' + stageChip(byId[id]) + '</a>';
    let html = panel(t('side.blockers'), r.blockers.length ? '<ol class="blockers">' + r.blockers.map((b) => '<li>' + inline(b) + '</li>').join('') + '</ol>' : '<p class="muted small" style="margin:0">' + esc(t('side.noBlockers')) + '</p>', r.blockers.length);
    if (r.deps.length || r.dependents.length) {
      html += panel(t('side.deps'), (r.deps.length ? '<div class="muted small">' + esc(t('side.first')) + '</div>' + r.deps.map((d) => (d.id ? dep(d.id) : '<div class="dep ghost"><span class="mono small">' + esc(d.ref) + '</span><span class="small">' + esc(t('side.notOpened')) + '</span></div>')).join('') : '')
        + (r.dependents.length ? '<div class="muted small"' + (r.deps.length ? ' style="margin-top:12px"' : '') + '>' + esc(t('side.waitingThis')) + '</div>' + r.dependents.map((o) => dep(o.id)).join('') : ''));
    }
    const v = r.validator;
    html += panel(t('side.check'), (v.status === 'missing' ? '<p class="muted small">' + esc(t('side.noValidator')) + '</p>'
      : '<span class="chip ' + (v.status === 'accepted' ? 'done' : 'blocked') + '"><i></i>' + esc(t('side.' + v.status)) + '</span>' + v.problems.slice(0, 3).map(bad).join('')
        + (v.problems.length > 3 ? '<details><summary class="small muted" style="cursor:pointer;margin-top:7px">' + esc(t('side.more', { n: v.problems.length - 3 })) + '</summary>' + v.problems.slice(3).map(bad).join('') + '</details>' : '')
        + (v.warnings.length ? '<details style="margin-top:9px"><summary class="small muted" style="cursor:pointer">' + ic('warn', 'inl') + esc(t('side.warnings', { n: v.warnings.length })) + '</summary>' + v.warnings.map((w) => '<p class="check-line"><span>' + esc(w) + '</span></p>').join('') + '</details>' : '')
        + '<p class="muted small" style="margin:9px 0 0">' + esc(t('side.localOnly')) + '</p>')
      + (r.review ? '<p class="small" style="margin:9px 0 0">' + esc(t('side.review', { verdict: r.review.verdict, b: r.review.open.BLOCKER, m: r.review.open.MAJOR, mi: r.review.open.MINOR })) + '</p>' : ''));
    const row = (k, val) => '<li><span class="k">' + esc(k) + '</span><span class="lead"></span>' + val + '</li>';
    html += panel(t('side.docs'), '<ul class="docs">' + r.artifacts.map((a) => row(a.key, a.href ? (a.exists ? '<a href="' + esc(a.href) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a>' : '<span class="gap">' + esc(a.name) + ' · ' + esc(t('side.missing')) + '</span>') : '<span class="muted">—</span>')).join('')
      + row('board', '<a href="' + esc(r.board) + '" target="_blank" rel="noopener">board.md</a>') + '</ul>');
    return html;
  }

  // ---- composer, dialog, toast --------------------------------------------------------------------
  function chrome() {
    return '<div class="composer" id="composer" role="region" aria-label="' + esc(t('dlg.title')) + '"><span class="c-count" id="c-count"></span><button type="button" id="c-clear">' + esc(t('comp.clear')) + '</button><button type="button" id="c-preview">' + esc(t('comp.preview')) + '</button>'
      + '<button type="button" id="c-copy"' + (SERVER ? ' class="when-wide"' : ' class="primary"') + '>' + esc(t('comp.copy')) + '</button>' + (SERVER ? '<button type="button" class="primary" id="c-send">' + esc(t('comp.send')) + '</button>' : '') + '</div>'
      + '<dialog id="dlg"><h2>' + esc(t('dlg.title')) + '</h2><p class="muted small">' + esc(t('dlg.note')) + '</p><textarea id="dlg-text" spellcheck="false"></textarea><form method="dialog" class="dlg-actions"><button class="btn" type="submit">' + esc(t('dlg.close')) + '</button><button class="btn primary" type="button" id="dlg-copy">' + esc(t('dlg.copy')) + '</button></form></dialog>'
      + '<div class="toast" id="toast" role="status" aria-live="polite"></div><button type="button" class="updated" id="updated" hidden>' + esc(t('ui.updated')) + '</button>';
  }
  let toastTimer = null;
  function flash(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  function refreshComposer() {
    const n = readyRuns().reduce((acc, r) => acc + linesFor(r).length, 0);
    const bar = document.getElementById('composer');
    document.getElementById('c-count').textContent = t('comp.ready', { n: n });
    bar.classList.toggle('active', n > 0);
  }
  function openDialog(text) {
    const d = document.getElementById('dlg');
    const area = document.getElementById('dlg-text');
    area.value = text || t('toast.pickFirst');
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    area.focus();
    area.select();
  }
  async function copy(text) {
    if (!text) { flash(t('toast.pickFirst')); return; }
    try { await navigator.clipboard.writeText(text); flash(t('toast.copied')); } catch (e) { openDialog(text); flash(t('toast.selectCopy')); }
  }
  let sending = false;
  async function send() {
    const list = readyRuns();
    if (!list.length) { flash(t('toast.pickFirst')); return; }
    sending = true;
    const btn = document.getElementById('c-send');
    btn.disabled = true;
    let saved = 0;
    let lastAuto = 'off';
    try {
      for (const r of list) {
        const res = await fetch('/decisions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: SERVER.token, run: r.folder, text: replyFor(r) }) });
        const body = await res.text();
        if (!res.ok) throw new Error(body);
        lastAuto = JSON.parse(body).auto || 'off';
        saved += 1;
        const gateSent = Boolean(r.gate && gateAnswer(r));
        allQuestions(r).forEach((q) => { if (answerOf(r, q)) setPick(r.id, q.id, {}); });
        if (gateSent) setPick(r.id, r.gate.gate, {});
      }
      flash(lastAuto === 'started' ? t('toast.started') : lastAuto === 'queued' ? t('toast.queued') : t('toast.sent'));
      setTimeout(reloadKeepingPlace, 1400);
    } catch (e) {
      flash((saved ? t('toast.partly', { msg: String(e.message || e).slice(0, 160) }) : t('toast.notSent', { msg: String(e.message || e).slice(0, 160) })));
    } finally {
      sending = false;
      btn.disabled = false;
      refreshComposer();
    }
  }
  function reloadKeepingPlace() {
    session.set('scroll', String(window.scrollY));
    session.set('open', JSON.stringify({ open: ui.open, seeded: ui.seeded }));
    window.location.reload();
  }

  // ---- render ---------------------------------------------------------------------------------------
  let current = null;
  function render() {
    current = route();
    document.title = t('ui.title') + ' — ' + DATA.repo;
    app.innerHTML = header() + '<div class="layout"><nav class="side" aria-label="' + esc(t('ui.home')) + '">' + side(current) + '</nav><main id="main">' + (current.view === 'run' ? runView(current.run, current.tab) : home()) + '</main></div>' + chrome();
    refreshComposer();
    showAuto(SERVER && SERVER.auto);
  }
  function refreshRun(r) {
    const main = document.getElementById('main');
    main.querySelectorAll('.qc[data-run="' + CSS.escape(r.id) + '"]').forEach((card) => {
      const q = allQuestions(r).find((x) => x.id === card.dataset.q);
      if (!q) return;
      card.classList.remove('todo', 'answered', 'sent');
      card.classList.add(qState(r, q));
      card.querySelector('.qc-sum').innerHTML = qSummary(r, q);
    });
    const prog = main.querySelector('.progress[data-run="' + CSS.escape(r.id) + '"]');
    if (prog) {
      const p = progressOf(r);
      prog.querySelector('[data-p-label]').textContent = t('dec.progress', p);
      prog.querySelector('[data-p-fill]').style.width = Math.round((p.done / p.total) * 100) + '%';
      prog.querySelector('.meter').setAttribute('aria-valuenow', p.done);
      prog.querySelector('[data-p-done]').hidden = p.done !== p.total;
    }
    const gc = main.querySelector('.gate-card[data-run="' + CSS.escape(r.id) + '"]');
    if (gc && r.mode !== 'pull-request') {
      const missing = missingFor(r);
      const approve = gc.querySelector('input[data-approve]');
      if (approve) {
        approve.disabled = missing.length > 0;
        if (approve.disabled && approve.checked) { approve.checked = false; const s = getPick(r.id, r.gate.gate); setPick(r.id, r.gate.gate, { pick: '', own: s.own }); }
        approve.closest('.choice').classList.toggle('disabled', approve.disabled);
      }
      gc.querySelector('[data-locked]').hidden = !missing.length;
      gc.querySelector('[data-locked-text]').textContent = t('gate.locked', { ids: missing.join(', ') });
    }
    refreshComposer();
  }
  function setOpen(card, open) {
    const k = pkey(card.dataset.run, card.dataset.q);
    ui.open[k] = open;
    card.classList.toggle('open', open);
    card.querySelector('.qc-head').setAttribute('aria-expanded', String(open));
    if (open) ui.active = card;
  }
  // The name a radio is read by: the option as the card shows it. A radio inside its label has that name already;
  // a tool that reads only the attributes does not find it there, and an agent driving the board needs it.
  const optionName = (o) => o.label + ' ' + o.main + (o.cons ? ' → ' + o.cons : '') + (o.recommended ? ' (' + t('q.recommended') + ')' : '');
  const KEY_PAUSE = 700;
  function advanceFrom(card) {
    const cards = Array.from(document.querySelectorAll('.qc[data-run="' + CSS.escape(card.dataset.run) + '"]')).filter((c) => !c.closest('details:not([open])'));
    const i = cards.indexOf(card);
    const next = cards.slice(i + 1).concat(cards.slice(0, i)).find((c) => c.classList.contains('todo'));
    setOpen(card, false);
    if (next) {
      setOpen(next, true);
      next.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      const first = next.querySelector('input[type=radio]');
      if (first) first.focus({ preventScroll: true });
    }
  }
  function choose(card, input) {
    const r = byId[card.dataset.run];
    const q = allQuestions(r).find((x) => x.id === card.dataset.q);
    const wasTodo = card.classList.contains('todo');
    const s = getPick(r.id, q.id);
    setPick(r.id, q.id, { pick: input.value, own: s.own });
    const own = card.querySelector('textarea.own');
    if (own && q.options.length) { own.hidden = true; card.querySelector('.own-toggle').hidden = false; }
    refreshRun(r);
    if (wasTodo) {
      // Number keys wait until the next card has opened and been in view for a moment. Otherwise keys pressed
      // in quick succession land on the next card before the owner has seen it, and choose answers the owner
      // did not mean.
      ui.keysAfter = Date.now() + (reduceMotion ? 0 : 260) + KEY_PAUSE;
      setTimeout(() => advanceFrom(card), reduceMotion ? 0 : 260);
    }
  }

  // ---- events -----------------------------------------------------------------------------------
  app.addEventListener('click', (e) => {
    // A criterion of the Traceability tab opens and closes: the row below it holds the criterion in full.
    const acRow = e.target.closest('tr.ac-row');
    if (acRow) {
      const d = acRow.nextElementSibling;
      const open = Boolean(d && d.hidden);
      if (d) d.hidden = !open;
      acRow.classList.toggle('open', open);
      const b = acRow.querySelector('.ac-toggle');
      if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    const head = e.target.closest('.qc-head');
    if (head) { const card = head.closest('.qc'); setOpen(card, !card.classList.contains('open')); return; }
    const ownToggle = e.target.closest('.own-toggle');
    if (ownToggle) { const card = ownToggle.closest('.qc'); ownToggle.hidden = true; const ta = card.querySelector('textarea.own'); ta.hidden = false; ta.focus(); return; }
    const expand = e.target.closest('[data-expand]');
    if (expand) { const open = expand.dataset.expand === '1'; document.querySelectorAll('#main .qc').forEach((c) => setOpen(c, open)); if (open) document.querySelectorAll('#main details.group').forEach((d) => { d.open = true; }); return; }
    const gotoQ = e.target.closest('.goto-q');
    if (gotoQ) {
      const r = byId[gotoQ.closest('.gate-card').dataset.run];
      const id = missingFor(r)[0];
      const card = id && document.querySelector('.qc[data-run="' + CSS.escape(r.id) + '"][data-q="' + CSS.escape(id) + '"]');
      if (card) { const d = card.closest('details'); if (d) d.open = true; setOpen(card, true); card.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); }
      return;
    }
    if (e.target.closest('#c-clear')) { runs.forEach((r) => { allQuestions(r).forEach((q) => setPick(r.id, q.id, {})); if (r.gate) setPick(r.id, r.gate.gate, {}); }); render(); return; }
    if (e.target.closest('#c-preview')) { openDialog(reply()); return; }
    if (e.target.closest('#c-copy')) { copy(reply()); return; }
    if (e.target.closest('#c-send')) { send(); return; }
    if (e.target.closest('#dlg-copy')) { copy(document.getElementById('dlg-text').value); return; }
    if (e.target.closest('#updated')) { reloadKeepingPlace(); }
  });
  app.addEventListener('change', (e) => {
    const input = e.target;
    if (input.type !== 'radio') return;
    const card = input.closest('.qc');
    if (card) { choose(card, input); return; }
    const gc = input.closest('.gate-card');
    if (gc) { const r = byId[gc.dataset.run]; const s = getPick(r.id, r.gate.gate); setPick(r.id, r.gate.gate, { pick: input.value, own: s.own }); refreshRun(r); }
  });
  app.addEventListener('input', (e) => {
    const ta = e.target;
    if (ta.matches('textarea.own')) {
      const card = ta.closest('.qc');
      const r = byId[card.dataset.run];
      const text = ta.value;
      if (text.trim()) card.querySelectorAll('input[type=radio]').forEach((x) => { x.checked = false; });
      setPick(r.id, card.dataset.q, { pick: text.trim() ? '__own' : '', own: text });
      refreshRun(r);
    } else if (ta.matches('textarea.gate-note')) {
      const r = byId[ta.closest('.gate-card').dataset.run];
      const s = getPick(r.id, r.gate.gate);
      setPick(r.id, r.gate.gate, { pick: s.pick, own: ta.value });
      refreshRun(r);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    if (Date.now() < (ui.keysAfter || 0)) { e.preventDefault(); return; }
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'radio'))) return;
    if (el && el.closest && el.closest('.gate-card, dialog')) return;
    const card = (el && el.closest && el.closest('.qc.open')) || (ui.active && ui.active.isConnected && ui.active.classList.contains('open') ? ui.active : null) || document.querySelector('#main .qc.open');
    if (!card) return;
    const input = card.querySelectorAll('.opts input[type=radio]')[Number(e.key) - 1];
    if (!input) return;
    e.preventDefault();
    input.checked = true;
    choose(card, input);
  });
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  // ---- live updates from scripts/board-server.mjs --------------------------------------------------
  function showAuto(a) {
    const box = document.getElementById('auto');
    if (!box) return;
    if (!a) { box.hidden = true; return; }
    box.hidden = false;
    let cls = 'idle';
    let text = t('auto.on', { tool: a.toolName, budget: a.budgetUsd });
    let log = '';
    if (a.running) {
      cls = 'running';
      text = t('auto.running', { tool: a.toolName, run: a.running.run, at: String(a.running.startedAt).slice(11, 16) + ' UTC', queued: a.queued });
      log = a.running.log;
    } else if (a.last && a.last.stale) {
      // The run changed after that session ended: its report would show an older state above a newer one.
      const l = a.last;
      text = t('auto.stale', { run: l.run, at: String(l.endedAt).slice(11, 16) + ' UTC', stage: l.stageNow ? stageName(l.stageNow) : '' });
      log = l.log;
    } else if (a.last) {
      const l = a.last;
      cls = l.error || (l.exitCode !== 0 && l.exitCode !== undefined) ? 'error' : 'done';
      text = t('auto.finished', { run: l.run, at: String(l.endedAt).slice(11, 16) + ' UTC', result: l.error ? l.error : 'exit ' + l.exitCode, cost: typeof l.costUsd === 'number' ? l.costUsd.toFixed(2) : '' });
      log = l.log;
    }
    box.className = 'auto ' + cls;
    box.innerHTML = '<span class="pulse" aria-hidden="true"></span><div><div>' + esc(text) + '</div>' + (log ? '<div class="muted small">' + esc(t('auto.output')) + ': ' + esc(log) + '</div>' : '') + '</div>';
    if (!a.running && a.last && a.last.report && !a.last.stale) { const pre = document.createElement('pre'); pre.textContent = a.last.report; box.lastChild.appendChild(pre); }
  }

  render();
  const y = session.get('scroll');
  if (y) { session.set('scroll', null); window.scrollTo(0, Number(y)); }
  if (SERVER) {
    setInterval(async () => {
      try {
        const res = await fetch('/version', { cache: 'no-store' });
        const body = await res.json();
        showAuto(body.auto);
        if (body.version === SERVER.version) return;
        const typing = document.activeElement && document.activeElement.tagName === 'TEXTAREA';
        const dlg = document.getElementById('dlg');
        if (sending || typing || (dlg && dlg.open)) { document.getElementById('updated').hidden = false; return; }
        reloadKeepingPlace();
      } catch (e) { /* the server stopped; keep the page as it is */ }
    }, 3000);
  }
}

// ---------------------------------------------------------------------------------------------

const dirs = existsSync(runsDir)
  ? readdirSync(runsDir).map((d) => join(runsDir, d)).filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'run.json'))).sort()
  : [];
const runs = dirs.map(loadRun);
if (gateVersionOf) {
  const r = runs.find((x) => x.id === gateVersionOf.run || x.folder === gateVersionOf.run);
  if (!r || r.error) { console.error(`No readable run "${gateVersionOf.run}" under sdlc/runs/.`); process.exit(2); }
  if (!GATE_DOCS[gateVersionOf.gate]) { console.error('The gate is businessApproval, planApproval or humanAcceptance.'); process.exit(2); }
  const gv = r.gateVersions[gateVersionOf.gate];
  if (!gv) { console.error(`Run ${r.id} has no document for ${gateVersionOf.gate} yet.`); process.exit(1); }
  console.log(gv.label);
  process.exit(0);
}
const views = runs.map((r) => view(r, runs));

let targets = runs.map((r, i) => i);
if (only) {
  targets = targets.filter((i) => runs[i].id === only || runs[i].folder === only);
  if (!targets.length) { console.error(`No run "${only}" under sdlc/runs/ (a folder holding run.json).`); process.exit(2); }
}

const stale = [];
let written = 0;
for (const i of targets) {
  const r = runs[i];
  if (htmlOnly) continue;
  if (!views[i]) { if (!quiet) console.error(`${r.manifestRel}: ${r.error}; no board written`); continue; }
  const file = join(r.dir, 'board.md');
  const text = renderMd(r, views[i]);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (check) { if (current !== text) stale.push(relPath(file)); continue; }
  if (current !== text) { writeFileSync(file, text); written += 1; }
}

if (check) {
  if (stale.length) {
    console.error('Run boards out of date:');
    for (const s of stale) console.error(`- ${s}`);
    console.error('Render them with: node scripts/render-run-board.mjs');
    process.exit(1);
  }
  if (!quiet) console.log(`${plural(targets.length, 'run board')} up to date.`);
  process.exit(0);
}
// No process.exit after the write: on a pipe it would cut the page short.
if (toStdout) process.stdout.write(renderHtml(runs, views));
else if (writeHtml) { mkdirSync(dirname(htmlPath), { recursive: true }); writeFileSync(htmlPath, renderHtml(runs, views)); }
if (!quiet) {
  const rendered = htmlOnly ? 0 : targets.filter((i) => views[i]).length;
  console.log(`${plural(rendered, 'run board')} rendered (${written} changed)${writeHtml ? ', and sdlc/board.html' : ''}.`);
  for (const i of targets) if (views[i]) console.log(`- ${runs[i].id}: ${runs[i].stage} — ${views[i].next.badge}: ${views[i].next.text}`);
}
