#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// Manifest validator for an Imperata run.
// Default: checks the manifest only. With --verify-remote it also asks GitHub (through the gh CLI)
// whether the pull requests named as approvals were really merged and whether CI really passed,
// and asks git whether anything outside the run folder changed after the tested commit.
// Once the manifest names a plan, it also checks that every task of the plan carries a Complexity field,
// and once it names a delivery dossier, that the dossier's "Model per task" table is filled in. It warns when
// the dossier does not show the owner's word for a task that another task, or verification, followed.
// It warns when a row of a table in one of the run's documents has more or fewer cells than the table has columns,
// and when a time in the manifest is ahead of this machine's clock.
// A run on the light track (track: light) has no separate plan approval; in exchange its plan must stay small and write no stack skill (TASK-00).
// From the QA step on it compares the run's test files with their lock, and it reads the test calibration:
// a locked test file that passes without the run's change keeps the run out of review.
// From review on, every acceptance criterion of the specification needs a test that passed in the test
// report, or a gap the owner accepted in the test plan; where a criterion has cases, every case needs one.
// Before the business approval it warns about a specification with more than twelve criteria. Every quote in the dossier's "Skills applied" table
// must be in the skill file it names.
// A bug run (kind: bug) is reproduced before its specification is approved, and the tests that showed the bug
// stay among its locked tests. A confidential run stays in local-record mode.
// Once the review gate has passed, the review says APPROVE_FOR_HUMAN_REVIEW and leaves no BLOCKER open.
// DONE: in pull-request mode a merged delivery pull request; in local-record mode a merge into the main branch
// that git confirms (externalEvidence.localMerge).
// Run from the repository root: artifact paths in the manifest are resolved against the current directory.
import { readFileSync, existsSync, realpathSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
let file;
let verifyRemote = false;
const ignoredChecks = new Set();
const requiredChecks = new Set();
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--verify-remote') verifyRemote = true;
  else if (args[i] === '--ignore-check') { i += 1; if (args[i]) ignoredChecks.add(args[i]); }
  else if (args[i] === '--require-check') { i += 1; if (args[i]) requiredChecks.add(args[i]); }
  else if (!args[i].startsWith('--') && !file) file = args[i];
}
if (!file) {
  console.error('Usage: node scripts/validate-gates.mjs <path-to-run.json> [--verify-remote] [--ignore-check <name>] [--require-check <name>]');
  console.error('  --ignore-check   name of a CI check to leave out, for the job that runs this script on the pull request');
  console.error('  --require-check  name of a CI check that runs the build and the tests; it must have succeeded on the delivery pull request');
  process.exit(2);
}
let data;
// A byte-order mark before the JSON, as some editors on Windows write one, is no part of the manifest: read with
// it, such a manifest would be "Cannot read JSON".
try { data = JSON.parse(readFileSync(resolve(file), 'utf8').replace(/^\uFEFF/, '')); }
catch (e) { console.error(`Cannot read JSON: ${e.message}`); process.exit(2); }

const problems = [];
const warnings = [];
const required = ['runId', 'productDocVersion', 'ticketRef', 'currentStage', 'revision', 'owner', 'updatedAt', 'approvalMode', 'approvals', 'artifactPaths', 'gateResults', 'openBlockers', 'externalEvidence'];
for (const k of required) if (!(k in data)) problems.push(`missing property ${k}`);
// The run ID names the run's folder, its branches and its records: a plain name, and the name of the folder that
// holds the manifest. A manifest that named another run would take its approvals and pull requests as its own.
if ('runId' in data) {
  if (typeof data.runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(data.runId)) problems.push(`runId ${JSON.stringify(String(data.runId)).replace(/[\u0000-\u001f\u007f]/g, '?')} is not a plain name (letters, digits, dot, hyphen, underscore)`);
  else {
    const parts = relative(process.cwd(), resolve(file)).split(sep);
    if (parts.length === 4 && parts[0] === 'sdlc' && parts[1] === 'runs' && parts[3] === 'run.json' && parts[2] !== data.runId) problems.push(`runId ${data.runId} is not the name of the run's folder, ${parts[2]}`);
  }
}

const stages = new Set(['NEW', 'ANALYSIS', 'AWAITING_BUSINESS_DECISION', 'READY_FOR_DESIGN_PLAN', 'READY_FOR_IMPLEMENTATION', 'IMPLEMENTING', 'VERIFYING', 'REVIEWING', 'FIX_REQUIRED', 'READY_FOR_ACCEPTANCE', 'DONE', 'BLOCKED', 'CANCELLED']);
if (data.currentStage && !stages.has(data.currentStage)) problems.push('invalid currentStage');
if (!Number.isInteger(data.revision) || data.revision < 0) problems.push('invalid revision');
// Optional fields read by the run board.
if ('title' in data && typeof data.title !== 'string') problems.push('title must be a string');
if ('dependsOn' in data) {
  if (!Array.isArray(data.dependsOn) || data.dependsOn.some((x) => typeof x !== 'string' || !x)) problems.push('dependsOn must be a list of run IDs');
  else if (data.dependsOn.includes(data.runId)) problems.push('dependsOn names the run itself');
}

const modes = new Set(['pull-request', 'local-record']);
const mode = data.approvalMode;
if ('approvalMode' in data && !modes.has(mode)) problems.push('invalid approvalMode (use pull-request or local-record)');

// Track. full (the default): every gate. light: for a small, low-risk change the owner agreed to run that way;
// planApproval is not a gate of the run and is recorded as WAIVED, and the limits further down apply.
const tracks = new Set(['full', 'light']);
const track = 'track' in data ? data.track : 'full';
if (!tracks.has(track)) problems.push('invalid track (use full or light)');
const light = track === 'light';
const LIGHT_MAX_TASKS = 3;

const gates = ['businessApproval', 'planApproval', 'implementation', 'tests', 'review', 'humanAcceptance'];
const allowed = new Set(['PASSED', 'FAILED', 'NOT_RUN', 'BLOCKED', 'WAIVED']);
for (const gate of gates) if (!allowed.has(data.gateResults?.[gate])) problems.push(`missing/invalid gate ${gate}`);

// What must already hold before a run may be in a stage. A stage that is not listed has no prerequisite.
// Only PASSED satisfies a prerequisite; WAIVED does not.
const business = ['businessApproval'];
const planned = light ? [...business] : [...business, 'planApproval'];
const built = [...planned, 'implementation'];
const tested = [...built, 'tests'];
const reviewed = [...tested, 'review'];
const prerequisites = {
  READY_FOR_DESIGN_PLAN: { gates: business, artifacts: ['input', 'spec'] },
  READY_FOR_IMPLEMENTATION: { gates: planned, artifacts: ['input', 'spec', 'plan'] },
  IMPLEMENTING: { gates: planned, artifacts: ['input', 'spec', 'plan'] },
  FIX_REQUIRED: { gates: planned, artifacts: ['input', 'spec', 'plan'] },
  VERIFYING: { gates: built, artifacts: ['input', 'spec', 'plan'] },
  REVIEWING: { gates: tested, artifacts: ['input', 'spec', 'plan', 'testReport'] },
  READY_FOR_ACCEPTANCE: { gates: reviewed, artifacts: ['input', 'spec', 'plan', 'testReport', 'review', 'delivery'] },
  DONE: { gates: reviewed, artifacts: ['input', 'spec', 'plan', 'testReport', 'review', 'delivery'] },
};

const stage = data.currentStage;
const need = prerequisites[stage];
// The stages that hold a run to the evidence of its review and acceptance: what the run's own documents and
// evidence files say (the criteria and their tests, the decisions in a security-sensitive area, the calibration,
// the lock). DONE is among them: the validator reads only the manifest as it is, so a check left out of DONE would
// be skipped by a manifest written straight to DONE. What lies outside the run folder and may change after delivery
// (the test files in the working tree, the skill files) is not read at DONE.
const FROM_REVIEW = ['REVIEWING', 'READY_FOR_ACCEPTANCE', 'DONE'];
if (need) {
  for (const gate of need.gates) {
    const value = data.gateResults?.[gate];
    if (value !== 'PASSED') problems.push(`${gate} is ${value ?? 'missing'}; it must be PASSED before stage ${stage}`);
  }
  for (const key of need.artifacts) {
    const val = data.artifactPaths?.[key];
    if (!val || typeof val !== 'string') problems.push(`required artifact path missing for stage ${stage}: ${key}`);
    else if (!existsSync(resolve(val))) problems.push(`artifact not found on disk: ${val}`);
    else if (!statSync(resolve(val)).isFile()) problems.push(`artifact is not a file: ${val}`);
  }
}

// Characters that cannot be seen, in a document the owner approves: a letter in decomposed form, whose combining
// marks look like the composed letter, and zero-width, joiner and direction marks. An input written as an escape
// can be saved as the marks themselves, and the approved text then holds what nobody saw. A warning, not a problem:
// sources typed in decomposed form are real, and quoting them is no fault. It cannot tell whether a mark that
// can be seen was meant.
const UNSEEN = /[​-‏‪-‮⁠-⁤﻿]/gu;
for (const key of ['spec', 'plan', 'testReport', 'review', 'delivery']) {
  const val = data.artifactPaths?.[key];
  if (!isFileAt(val)) continue;
  let shown = 0;
  readFileSync(resolve(val), 'utf8').split(/\r?\n/).forEach((line, i) => {
    const marks = line === line.normalize('NFC') ? [] : [...line].filter((c) => /\p{M}/u.test(c) && !line.normalize('NFC').includes(c));
    const unseen = [...new Set([...marks, ...(line.match(UNSEEN) || [])])];
    if (!unseen.length || shown++ >= 3) return;
    const codes = unseen.map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
    warnings.push(`${basename(val)} line ${i + 1} holds characters that cannot be seen (${codes}): what the owner reads is not all the file holds. Write each as an escape such as \\u0302, and say in words what it is`);
  });
}

// Task complexity. The Orchestrator chooses the model for a task from its Complexity field, so every
// task of the plan must carry one: a level and a one-line reason. Tasks are the "### TASK-NN" sections
// of the plan, and of the file named in artifactPaths.tasks when the breakdown is kept in its own file.
// This checks that the field is there and well formed. It cannot tell whether the level is right.
const levels = new Set(['low', 'standard', 'high']);
function readTasks(path) {
  const tasks = [];
  let inFence = false;
  let inSkills = false;
  let current = null;
  for (const line of readFileSync(resolve(path), 'utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      inSkills = false;
      const id = heading[2].match(/^(TASK-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*)/);
      if (id) { current = { id: id[1], depth: heading[1].length, values: [], skills: [], file: path }; tasks.push(current); }
      else if (current && heading[1].length <= current.depth) current = null;
      continue;
    }
    if (!current) continue;
    const named = line.match(/^\s*[-*]\s+\*\*([^*]+?):?\*\*:?\s*(.*)$/);
    if (named && inSkills && /^\s+/.test(line) && /^(core|references?|product|template)$/i.test(named[1].trim())) current.skills.push(...skillRefs(named[2]));
    else if (named) {
      inSkills = /^skills$/i.test(named[1].trim());
      if (inSkills) current.skills.push(...skillRefs(named[2]));
      else if (/^complexity$/i.test(named[1].trim())) current.values.push(named[2].trim());
    } else if (inSkills && /^\s+[-*]\s+/.test(line)) current.skills.push(...skillRefs(line.replace(/^\s+[-*]\s+/, '')));
    else if (inSkills && line.trim() && !/^\s/.test(line)) inSkills = false;
  }
  return tasks;
}
// The files a line of a task's Skills field names: each code span, or else the word after "core:" and the like
// (`core: node`, `references: node/references/api.md`, `product: docs/rules.md#refunds`).
function skillRefs(text) {
  const body = String(text).replace(/^\s*[A-Za-z]+:\s*/, '');
  const spans = [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
  if (spans.length) return spans.filter((s) => s && !/^<.*>$/.test(s));
  const word = body.trim().split(/[\s(]/)[0];
  return word && !/^(none|n\/a|-|—)$/i.test(word) ? [word] : [];
}
function complexityProblem(value) {
  const m = value.match(/^`?([A-Za-z]+)`?\s*(?:[—–:-]+\s*(.*))?$/);
  if (!m || !levels.has(m[1].toLowerCase())) return `Complexity is "${value}"; write one of low, standard, high, then " — " and a one-line reason`;
  const reason = (m[2] || '').trim();
  if (!reason || /^<.*>$/.test(reason)) return `Complexity ${m[1].toLowerCase()} has no reason; add one line after the level`;
  return null;
}
let tasksChecked = null;
const planTaskIds = new Set();
const planLevels = new Map(); // task id -> level, for tasks whose Complexity is well formed
const planSkills = new Map(); // task id -> the files its Skills field names
{
  const planPath = data.artifactPaths?.plan;
  const tasksPath = data.artifactPaths?.tasks;
  if (typeof tasksPath === 'string' && tasksPath && !existsSync(resolve(tasksPath))) problems.push(`artifact not found on disk: ${tasksPath}`);
  const files = [...new Set([planPath, tasksPath].filter((p) => typeof p === 'string' && p && existsSync(resolve(p))))];
  if (files.length) {
    const tasks = [];
    for (const f of files) {
      try { tasks.push(...readTasks(f)); }
      catch (e) { problems.push(`cannot read ${f} to check task complexity (${e.message})`); }
    }
    if (!tasks.length) {
      const msg = `no task section found in ${files.join(', ')}; write each task as a "### TASK-NN" section with a Complexity field (.orchestra/templates/technical-plan.template.md)`;
      if (need?.artifacts.includes('plan')) problems.push(msg);
      else warnings.push(`${msg}. Stage ${stage} does not require tasks yet`);
    }
    for (const t of tasks) {
      if (planTaskIds.has(t.id)) problems.push(`${t.file}: ${t.id} appears more than once`);
      planTaskIds.add(t.id);
      if (t.skills.length) planSkills.set(t.id, t.skills);
      if (!t.values.length) problems.push(`${t.file}: ${t.id} has no Complexity field`);
      else if (t.values.length > 1) problems.push(`${t.file}: ${t.id} has ${t.values.length} Complexity fields; keep one`);
      else {
        const p = complexityProblem(t.values[0]);
        if (p) problems.push(`${t.file}: ${t.id} ${p}`);
        else planLevels.set(t.id, t.values[0].match(/[A-Za-z]+/)[0].toLowerCase());
      }
    }
    tasksChecked = { count: tasks.length, files };
  }
}

// Light track. The owner agreed to it, and the record says who, when and why. The plan was not approved
// on its own, so it has to stay within what the light track is for: a few tasks, none of them high, and no
// stack-skill task (TASK-00), whose conventions every later run follows and which the owner approves with the
// plan. A run that outgrows this moves to the full track and gets its plan approved.
if (light) {
  const rec = data.trackDecision;
  if (!rec || typeof rec !== 'object') problems.push('track is light but trackDecision holds no record of the owner agreeing to it');
  else {
    if (!rec.by || typeof rec.by !== 'string') problems.push('trackDecision.by is missing');
    if (!rec.at || Number.isNaN(Date.parse(rec.at))) problems.push('trackDecision.at is missing or not a date');
    if (!rec.reason || typeof rec.reason !== 'string' || !rec.reason.trim()) problems.push('trackDecision.reason is missing; say in one line why this change fits the light track');
    if ('recordPath' in rec && rec.recordPath && !existsSync(resolve(rec.recordPath))) problems.push(`trackDecision.recordPath not found on disk: ${rec.recordPath}`);
    // On a light run the business approval also lets implementation start, and the approval card of the
    // specification names the track: the owner's approval is the check of the agreement. An agreement dated after
    // that approval was never on the card: otherwise a run whose specification was approved on the full track could
    // move to light afterwards, with a later trackDecision.at, and pass at IMPLEMENTING.
    const approvedAt = Date.parse(data.approvals?.businessApproval?.at ?? '');
    const agreedAt = Date.parse(rec.at ?? '');
    if (data.gateResults?.businessApproval === 'PASSED' && !Number.isNaN(approvedAt) && !Number.isNaN(agreedAt) && agreedAt > approvedAt) {
      problems.push(`trackDecision.at (${rec.at}) is after the business approval (${data.approvals.businessApproval.at}): the owner approved the specification on the full track, and a run never moves to light once its specification is approved. Set track to full and get the plan approved`);
    }
  }
  if (data.gateResults?.planApproval !== 'WAIVED') problems.push(`planApproval is ${data.gateResults?.planApproval ?? 'missing'}; on the light track it is WAIVED, because the plan has no approval of its own`);
  if (data.approvals?.planApproval) problems.push('approvals.planApproval holds a record, but the light track has no plan approval; move the run to the full track if the plan was approved');
  if (planTaskIds.size > LIGHT_MAX_TASKS) problems.push(`the plan has ${planTaskIds.size} tasks; the light track allows ${LIGHT_MAX_TASKS}. Set track to full and get the plan approved`);
  const high = [...planLevels].filter(([, level]) => level === 'high').map(([id]) => id);
  if (high.length) problems.push(`${high.join(', ')} ${high.length === 1 ? 'is' : 'are'} high complexity; the light track allows none. Set track to full and get the plan approved`);
  if (planTaskIds.has('TASK-00')) problems.push('TASK-00 writes a stack skill, whose conventions every later run follows; the light track allows none. Set track to full and get the plan approved');
} else if (data.gateResults?.planApproval === 'WAIVED') {
  warnings.push('planApproval is WAIVED on the full track; it does not satisfy any stage that needs the plan approved');
}

// Model per task. The delivery dossier lists each delegation of a task: the step, the level it ran at,
// the model the Orchestrator asked for, and whether the tool confirmed that model. Checked once the
// manifest names a delivery dossier: every row is filled in, names tasks of the plan, and does not run
// a task below the level the plan gave it; from READY_FOR_ACCEPTANCE on, every task of the plan has a
// developer row. The whole suite after the last task is a row of its own, step "verification": it names no
// task and is held to no task's level, since each task was tested at its own: held to the highest level of the
// tasks, it would be the dearest delegation of the run. This reads what the Orchestrator wrote. It cannot tell
// which model really ran, or whether a delegation was left out of the table.
const rank = { low: 0, standard: 1, high: 2 };
const steps = new Set(['developer', 'qa', 'repair', 'verification']);
function readModelTable(path, title = /^model per task$/i) {
  let inFence = false;
  let inSection = false;
  let found = false;
  const rows = [];
  for (const line of readFileSync(resolve(path), 'utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const heading = line.match(/^#{1,6}\s+(.*?)\s*$/);
    if (heading) { inSection = !found && title.test(heading[1]); if (inSection) found = true; continue; }
    if (inSection && /^\s*\|/.test(line)) {
      rows.push(line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().replace(/^`+|`+$/g, '')));
    }
  }
  return { found, rows };
}
let modelTable = null;
const developedOrder = []; // task ids in the order of their first developer row
{
  const deliveryPath = data.artifactPaths?.delivery;
  if (typeof deliveryPath === 'string' && deliveryPath && existsSync(resolve(deliveryPath))) {
    const requiredNow = Boolean(need?.artifacts.includes('delivery'));
    const soft = (msg) => { if (requiredNow) problems.push(msg); else warnings.push(`${msg}. Stage ${stage} does not require the delivery dossier yet`); };
    let table = null;
    try { table = readModelTable(deliveryPath); }
    catch (e) { problems.push(`cannot read ${deliveryPath} to check the "Model per task" table (${e.message})`); }
    if (table) {
      const [header, ...rest] = table.rows;
      const body = rest.filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c)));
      if (!table.found || !header) soft(`${deliveryPath} has no "Model per task" table (.orchestra/templates/delivery.template.md)`);
      else {
        const col = (name) => header.findIndex((h) => h.toLowerCase().startsWith(name));
        const idx = { task: col('task'), step: col('step'), complexity: col('complexity'), model: col('model'), confirmed: col('confirmed') };
        const missing = Object.keys(idx).filter((k) => idx[k] < 0);
        if (missing.length) problems.push(`${deliveryPath}: the "Model per task" table lacks column(s): ${missing.join(', ')}`);
        else {
          const developed = new Set();
          let unconfirmed = 0;
          let unselected = 0;
          body.forEach((cells, n) => {
            const where = `${deliveryPath}: "Model per task" row ${n + 1}`;
            const cell = (k) => cells[idx[k]] ?? '';
            const ids = cell('task').match(/TASK-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g) || [];
            const step = cell('step').toLowerCase();
            const level = cell('complexity').toLowerCase();
            const model = cell('model');
            const confirmed = cell('confirmed').toUpperCase();
            const levelOk = Object.hasOwn(rank, level);
            const whole = step === 'verification';
            if (!ids.length && !whole) problems.push(`${where} names no task; write the TASK id, or several ids when one delegation covered several tasks`);
            if (!steps.has(step)) problems.push(`${where} step is "${cell('step')}"; use developer, qa, repair or verification`);
            if (!levelOk) problems.push(`${where} complexity is "${cell('complexity')}"; use low, standard or high`);
            if (!model || /^<.*>$/.test(model)) problems.push(`${where} has no model requested; write the model asked for, or NOT_SELECTED when the delegation tool took no model`);
            else if (model.toUpperCase() === 'NOT_SELECTED') unselected += 1;
            if (confirmed === 'NOT_CONFIRMED') unconfirmed += 1;
            else if (confirmed !== 'CONFIRMED') problems.push(`${where} confirmed is "${cell('confirmed')}"; use CONFIRMED or NOT_CONFIRMED`);
            for (const id of ids) {
              if (planTaskIds.size && !planTaskIds.has(id)) problems.push(`${where} names ${id}, which is not a task of the plan`);
              const planned = planLevels.get(id);
              if (planned && levelOk && !whole && rank[level] < rank[planned]) problems.push(`${where} ran ${id} at ${level}, below the plan's ${planned}; a level may be raised, never lowered`);
              if (step === 'developer') { developed.add(id); if (!developedOrder.includes(id)) developedOrder.push(id); }
            }
            if (light && level === 'high') problems.push(`${where} ran at high; a task raised to high does not belong on the light track. Set track to full and get the plan approved`);
            // Only Claude model names say their tier; any other name is left alone.
            const tier = /opus/i.test(model) ? 2 : /sonnet/i.test(model) ? 1 : /haiku/i.test(model) ? 0 : null;
            if (tier !== null && levelOk && tier < rank[level]) warnings.push(`${where}: ${model} looks weaker than the ${level} level calls for`);
          });
          if (!body.length) soft(`${deliveryPath}: the "Model per task" table has no row`);
          else {
            const uncovered = [...planTaskIds].filter((id) => !developed.has(id));
            if (uncovered.length) soft(`${deliveryPath}: "Model per task" has no developer row for ${uncovered.join(', ')}`);
          }
          if (unselected) warnings.push(`${unselected} delegation(s) ran without a model chosen for the task (NOT_SELECTED)`);
          if (unconfirmed) warnings.push(`${unconfirmed} of ${body.length} delegation(s) record a requested model that no tool output confirmed`);
          modelTable = { rows: body.length, file: deliveryPath };
        }
      }
    }
  }
}

// Checked by the owner. Implementation goes one task at a time, and after each task the Orchestrator stops for
// the owner to check it. The dossier holds one row for each such stop: the task, the commit, and the owner's
// word with its time, which stays empty while the run waits. Read once "Model per task" shows a task delegated
// to the Developer: a task that another task followed, or verification, has the owner's word. The task built
// last may still wait for it while the run is being implemented. A warning, never a problem: a run that began
// on an earlier kit has no such table, and only the owner knows what they checked. This reads what the
// Orchestrator wrote. It cannot tell whether the owner said those words, or whether the next task began
// before they were said. A run that is DONE or CANCELLED is not read: nothing can follow from it there.
let ownerChecks = null;
{
  const deliveryPath = data.artifactPaths?.delivery;
  const over = stage === 'DONE' || stage === 'CANCELLED';
  if (!over && developedOrder.length && typeof deliveryPath === 'string' && deliveryPath && existsSync(resolve(deliveryPath))) {
    const left = ['VERIFYING', 'REVIEWING', 'READY_FOR_ACCEPTANCE'].includes(stage);
    const due = left ? developedOrder : developedOrder.slice(0, -1);
    let table = null;
    try { table = readModelTable(deliveryPath, /^checked by the owner$/i); }
    catch (e) { warnings.push(`cannot read ${deliveryPath} to see which tasks the owner checked (${e.message})`); }
    if (table) {
      const [header, ...rest] = table.rows;
      const body = rest.filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c)));
      const iTask = header ? header.findIndex((h) => /^task/i.test(h)) : -1;
      const iWord = header ? header.findIndex((h) => /^owner/i.test(h)) : -1;
      if (!table.found || iTask < 0 || iWord < 0) {
        if (due.length) warnings.push(`${deliveryPath} has no "Checked by the owner" table with the columns Task and Owner's word, so nothing shows that the owner checked ${due.join(', ')} before the run went on (.orchestra/templates/delivery.template.md)`);
      } else {
        const said = new Set();
        for (const cells of body) {
          const word = (cells[iWord] ?? '').trim();
          if (!word || /^<.*>$/.test(word)) continue;
          for (const id of (cells[iTask] ?? '').match(/TASK-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g) || []) said.add(id);
        }
        const unchecked = due.filter((id) => !said.has(id));
        if (unchecked.length) warnings.push(`${deliveryPath}: "Checked by the owner" holds no word of the owner's for ${unchecked.join(', ')}, and the run went on after ${unchecked.length === 1 ? 'it' : 'them'}. After each task the Orchestrator stops for the owner to check it`);
        ownerChecks = { said: developedOrder.filter((id) => said.has(id)).length, of: developedOrder.length, file: deliveryPath };
      }
    }
  }
}

// Test lock. After the QA step, scripts/lock-tests.mjs records the hash of every test file of the run in
// artifactPaths.testLock. A run goes to review or acceptance only with the tests QA last worked with: a
// locked file that changed or is gone means someone changed a test after QA, most likely to make it pass.
// The files in the working tree are not compared once the run is DONE, when later runs may change them; there the
// merge is compared with the lock instead, further down. The lock must still exist at DONE: otherwise a manifest
// written straight to DONE, with no lock and a FAILED test, would pass. This compares files with the lock. It
// cannot tell whether the lock was recorded again without a QA step.
let testLock = null;
let lockData = null;
{
  const lockPath = data.artifactPaths?.testLock;
  const mustHold = ['FIX_REQUIRED', 'REVIEWING', 'READY_FOR_ACCEPTANCE'].includes(stage);
  const mustExist = FROM_REVIEW.includes(stage);
  if (typeof lockPath === 'string' && lockPath) {
    let lock = null;
    try { lock = JSON.parse(readFileSync(resolve(lockPath), 'utf8')); }
    catch (e) { problems.push(`cannot read the test lock ${lockPath} (${e.message})`); }
    if (lock && (typeof lock.files !== 'object' || !lock.files)) { problems.push(`${lockPath} has no "files" object`); lock = null; }
    if (lock && lock.runId && lock.runId !== data.runId) problems.push(`${lockPath} was recorded for run ${lock.runId}, not ${data.runId}`);
    lockData = lock;
    if (lock && mustHold) {
      const names = Object.keys(lock.files);
      const broken = [];
      for (const f of names) {
        let ok = false;
        try { ok = statSync(resolve(f)).isFile(); } catch { ok = false; }
        if (!ok) broken.push(`${f} (deleted)`);
        else if (createHash('sha256').update(readFileSync(resolve(f))).digest('hex') !== lock.files[f]) broken.push(`${f} (changed)`);
      }
      if (broken.length) problems.push(`test files changed after the QA step that locked them (${lock.recordedAt ?? 'no date'}): ${broken.slice(0, 5).join(', ')}${broken.length > 5 ? ', ...' : ''}. Restore them, or have the QA Engineer decide and record the lock again`);
      if (!names.length) warnings.push(`${lockPath} locks no test file`);
      if (Array.isArray(lock.skipMarkers) && lock.skipMarkers.length) warnings.push(`${lock.skipMarkers.length} locked test file(s) carry a skip, only or ignore marker: ${lock.skipMarkers.slice(0, 5).join(', ')}`);
      testLock = { count: names.length, file: lockPath, at: lock.recordedAt };
    }
  } else if (mustExist) {
    problems.push(`artifactPaths.testLock is missing; before stage ${stage} record the run's test files after the QA step: node scripts/lock-tests.mjs record ${data.runId ?? '<runId>'}`);
  }
}

const list = (names) => `${names.slice(0, 5).join(', ')}${names.length > 5 ? ', ...' : ''}`;
// A path the manifest names that is a file: a folder there is no artifact, and reading one would stop this script
// with EISDIR.
function isFileAt(p) { try { return typeof p === 'string' && p !== '' && statSync(resolve(p)).isFile(); } catch { return false; } }
const usable = isFileAt;
// The paths git says changed between two commits: both paths of a rename (--no-renames), each as it is written,
// with no quoting of a name outside ASCII (-z). With renames on, a file of the application moved into the run
// folder after the tested commit would show only its new path, inside the folder, so the delivered code would
// differ from the tested code unseen; and a file of the run folder with a name outside ASCII would be printed
// quoted and taken for one outside it.
const changedPaths = (from, to) => execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', `${from}..${to}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean);

// Test calibration. `scripts/lock-tests.mjs calibrate` runs each locked test file here and on the base commit
// and writes the outcome to artifactPaths.testCalibration. A locked file that passes without the run's change
// does not test it: the run stays out of review until the QA Engineer makes the test depend on the change, or
// the test plan declares the file one that must pass without it. A result counts only for the content the
// lock holds. Calibration is not required: from review on, DONE included, its absence is a warning. Not read
// once the run is CANCELLED. This reads what the script wrote. It cannot tell whether a guard is declared
// in the test plan, or whether a file fails on the base for the right reason.
// With --suite the script also ran the whole suite several times (`suites`): a suite that failed in any run
// on the lock as it is now keeps the run out of review, since a test must give the same verdict every time.
// A suite that passed every run shows only that no run failed; a rare failure can pass every one of them.
let calibration = null;
let calData = null;
{
  const calPath = data.artifactPaths?.testCalibration;
  const judged = FROM_REVIEW.includes(stage);
  const open = stage !== 'CANCELLED';
  if (typeof calPath === 'string' && calPath && open) {
    let cal = null;
    try { cal = JSON.parse(readFileSync(resolve(calPath), 'utf8')); }
    catch (e) { problems.push(`cannot read the test calibration ${calPath} (${e.message})`); }
    if (cal && (typeof cal.files !== 'object' || !cal.files)) { problems.push(`${calPath} has no "files" object`); cal = null; }
    if (cal && cal.runId && cal.runId !== data.runId) problems.push(`${calPath} was written for run ${cal.runId}, not ${data.runId}`);
    if (cal && !lockData) warnings.push(`${calPath} has no test lock to be read against; artifactPaths.testLock names none`);
    calData = cal;
    if (cal && lockData) {
      const names = Object.keys(lockData.files);
      const current = names.filter((f) => cal.files[f] && cal.files[f].sha256 === lockData.files[f]);
      const by = (result) => current.filter((f) => cal.files[f].result === result);
      const empty = by('PASSES_WITHOUT_CHANGE');
      const guards = by('GUARD');
      const proven = by('DEPENDS_ON_CHANGE');
      const stale = names.filter((f) => cal.files[f] && cal.files[f].sha256 !== lockData.files[f]);
      if (empty.length) {
        const msg = `${empty.length} locked test file(s) pass without the run's change, so they do not test it: ${list(empty)}. Have the QA Engineer make each one depend on the change, or declare it in the test plan as a file that must pass without the change; then record the lock and calibrate again`;
        if (judged) problems.push(msg); else warnings.push(msg);
      }
      if (guards.length) warnings.push(`${guards.length} locked test file(s) are declared to pass without the run's change (regression guards or support files): ${list(guards)}`);
      if (stale.length) warnings.push(`${stale.length} locked test file(s) changed after they were calibrated: ${list(stale)}. Calibrate again`);
      // Without a control nothing ran on the base that passes, so a base that cannot run tests, or one without
      // the code (a repository with no code before the run), fails every test, and the result tells nothing.
      // A report to the owner may still count such a result as proof.
      const uncontrolled = proven.filter((f) => !cal.files[f].control);
      if (uncontrolled.length) warnings.push(`${uncontrolled.length} locked test file(s) fail on the base, but the calibration ran without a control: nothing that ran there passes, and a base that cannot run tests or does not have the code yet fails every test. This does not show that they test the run's change; report it under "Unproven", not "Proven"`);
      if (names.length && !proven.length && !guards.length && !empty.length) warnings.push(`${calPath} holds no result for the locked test files as they are now; calibrate again`);
      const suites = (Array.isArray(cal.suites) ? cal.suites : []).filter((s) => s && typeof s.command === 'string' && Array.isArray(s.exits) && s.exits.length);
      const currentSuites = suites.filter((s) => s.lockRecordedAt === (lockData.recordedAt ?? null));
      const failures = (s) => s.exits.filter((e) => e !== 0).length;
      for (const s of currentSuites.filter(failures)) {
        const msg = `the tests do not give the same verdict every time: on the same code the whole suite failed in ${failures(s)} of ${s.exits.length} run(s) ("${s.command}", ${calPath}). Have the QA Engineer find the test that failed and make it give the same verdict, or the Developer repair the behaviour that varies; then record the lock and calibrate again`;
        if (judged) problems.push(msg); else warnings.push(msg);
      }
      if (judged && !currentSuites.length) {
        warnings.push(suites.length
          ? 'the whole suite was run several times only before the test lock was last recorded; calibrate again with --suite'
          : `the whole suite was not run more than once: nothing shows that the tests give the same verdict every time (node scripts/lock-tests.mjs calibrate ${data.runId ?? '<runId>'} --cmd "<command for one test file>" --suite "<command for all tests>")`);
      }
      const steady = currentSuites.length && !currentSuites.some(failures) ? currentSuites.reduce((n, s) => n + s.exits.length, 0) : 0;
      calibration = { file: calPath, total: names.length, proven: proven.length - uncontrolled.length, uncontrolled: uncontrolled.length, guards: guards.length, rest: names.length - proven.length - guards.length - empty.length, steady };
    }
  } else if (judged && lockData && Object.keys(lockData.files).length) {
    warnings.push(`the run's tests were not calibrated: nothing shows that they fail without the run's change (node scripts/lock-tests.mjs calibrate ${data.runId ?? '<runId>'} --cmd "<command for one test file>")`);
  }
}

// Bug runs. A run of kind bug fixes reported behaviour. Before its specification is approved,
// `scripts/lock-tests.mjs reproduce` shows the bug on the code as committed: each named test fails there
// (artifactPaths.reproduction). From review on, those tests are among the run's locked tests, and a calibration
// of them is never a guard. A confidential run stays in local-record mode, so that no pull request publishes
// the defect before its fix. This reads what the script wrote. It cannot tell whether a test fails for the
// reported reason, or whether a defect that touches a security-sensitive area was marked confidential.
const kinds = new Set(['feature', 'bug']);
const kind = 'kind' in data ? data.kind : 'feature';
if (!kinds.has(kind)) problems.push('invalid kind (use feature or bug)');
if ('confidential' in data && typeof data.confidential !== 'boolean') problems.push('confidential must be true or false');
if (data.confidential === true && mode === 'pull-request') problems.push('a confidential run stays in local-record mode until its fix is delivered: its pull requests would publish the defect before the fix. Set approvalMode to local-record');
let reproduction = null;
let reproFiles = []; // the test files that showed the bug of a bug run
if (kind === 'bug' && stage !== 'CANCELLED') {
  const repPath = data.artifactPaths?.reproduction;
  const how = `node scripts/lock-tests.mjs reproduce ${data.runId ?? '<runId>'} --cmd "<command for one test file>" <test file>`;
  let rep = null;
  if (typeof repPath === 'string' && repPath) {
    try { rep = JSON.parse(readFileSync(resolve(repPath), 'utf8')); }
    catch (e) { problems.push(`cannot read the reproduction ${repPath} (${e.message})`); }
    if (rep && (typeof rep.files !== 'object' || !rep.files || !Object.keys(rep.files).length)) { problems.push(`${repPath} names no test file`); rep = null; }
    if (rep && rep.runId && rep.runId !== data.runId) problems.push(`${repPath} was written for run ${rep.runId}, not ${data.runId}`);
  } else if (data.gateResults?.businessApproval === 'PASSED') {
    problems.push(`a bug run is reproduced before its specification is approved, and artifactPaths.reproduction names no reproduction (${how})`);
  } else if (stage === 'AWAITING_BUSINESS_DECISION') {
    warnings.push(`the bug is not reproduced yet; it must be before the specification is approved (${how})`);
  }
  if (rep) {
    const names = Object.keys(rep.files);
    reproFiles = names;
    const notShown = names.filter((f) => rep.files[f]?.result !== 'REPRODUCED');
    if (notShown.length) problems.push(`${notShown.length} reproduction test(s) did not fail on the code as committed: ${list(notShown)}. A bug run goes on only once its bug is shown`);
    if (!/^[0-9a-f]{7,40}$/i.test(rep.commit || '')) problems.push(`${repPath} names no commit the bug was reproduced on`);
    if (!rep.control) warnings.push('the bug was reproduced without a control: a reproduction test that fails may fail because of the environment');
    if (FROM_REVIEW.includes(stage) && lockData) {
      const unlocked = names.filter((f) => !(f in lockData.files));
      if (unlocked.length) problems.push(`the test(s) that showed the bug are not among the run's locked tests: ${list(unlocked)}. They stay in the run, and the lock is recorded after the QA step`);
      for (const f of names.filter((x) => x in lockData.files)) {
        const c = calData?.files?.[f] && calData.files[f].sha256 === lockData.files[f] ? calData.files[f] : null;
        if (c && (c.result === 'GUARD' || c.result === 'PASSES_WITHOUT_CHANGE')) problems.push(`${f} showed the bug, and its calibration reads ${c.result}: the test that showed the bug must fail without the fix`);
        else if (!c && lockData.files[f] !== rep.files[f]?.sha256) warnings.push(`${f} changed after it showed the bug and is not calibrated: nothing shows that it still fails without the fix`);
      }
    }
    reproduction = { file: repPath, shown: names.length - notShown.length, total: names.length, commit: String(rep.commit || '') };
  }
}

// Markdown tables of an artifact, read as the run board reads them: every pipe table outside code fences,
// with the heading it sits under.
const cellText = (s) => String(s ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
function readTables(path) {
  const tables = [];
  let inFence = false;
  let heading = '';
  let cur = null;
  const flush = () => { if (cur?.sep) tables.push(cur); cur = null; };
  for (const line of readFileSync(resolve(path), 'utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { flush(); inFence = !inFence; continue; }
    if (inFence) continue;
    const h = line.match(/^#{1,6}\s+(.*?)\s*$/);
    if (h) { flush(); heading = cellText(h[1]); continue; }
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
      if (!cur) cur = { heading, header: cells, rows: [], sep: false };
      else if (!cur.sep && cells.every((c) => /^:?-+:?$/.test(c))) cur.sep = true;
      else if (cur.sep) cur.rows.push(cells);
      else cur = { heading, header: cells, rows: [], sep: false };
    } else flush();
  }
  flush();
  return tables;
}
const column = (header, re) => header.findIndex((h) => re.test(cellText(h).toLowerCase()));
// The prefix of an id in capitals, whatever the case it was written in: read ignoring case in the specification
// and as written in the test report, a criterion written ac-01 could never count as tested.
const acPrefix = (s) => String(s ?? '').replace(/\bac-/gi, 'AC-');
// The id of a criterion, or of a case of one: the criterion's id, a point and a number (AC-03.2).
const AC_ID = /\bAC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:\.[0-9]+)?/g;
const CASE_ID = /^(AC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\.([0-9]+)$/;
const CASE_RANGE = /\b(AC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\.([0-9]+)\s*(?:\.{2,}|…|–|—|\bto\b)\s*\1\.([0-9]+)\b/g;
const CASE_AT_START = /^(AC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\.([0-9]+)(?=$|[^0-9A-Za-z.-])/;
const caseId = (id) => { const m = id.match(CASE_ID); return m ? `${m[1]}.${Number(m[2])}` : id; };
// The ids a cell names. A range of cases of one criterion, AC-03.1..AC-03.4, is every case in it. A range of
// criteria is read as its two ends, one id at a time.
const idsIn = (text) => {
  const spelled = acPrefix(text).replace(CASE_RANGE, (whole, ac, from, to) => {
    const first = Number(from);
    const last = Number(to);
    if (last < first || last - first > 999) return whole;
    return Array.from({ length: last - first + 1 }, (_, i) => `${ac}.${first + i}`).join(', ');
  });
  return [...new Set((spelled.match(AC_ID) || []).map(caseId))];
};
const TASK_ID = /TASK-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*/g;

// Acceptance criteria and their tests. From review on, every criterion of the specification has a test that
// passed in the Results table of the test report, or a row under "Not covered" in the test plan that says who
// accepted the gap. The criteria are the AC ids in the "ID" column of the specification's tables, or, where
// it has no such table, every AC id its text names. A specification with no AC id at all fails: Spec Kit's
// template numbers requirements FR-001 and SC-001, and a check that let such a run through would check nothing.
// The test plan is artifactPaths.testPlan, or test-plan.md in the run folder. This reads what the QA Engineer and the Orchestrator wrote. It cannot tell whether a
// test checks its criterion, or whether the owner really accepted a gap.
// A criterion may have cases: the rows AC-NN.M of a table whose first column is "Case". Then every case needs
// its test or its gap, named by its own id or in a range of cases; a test that names the criterion alone covers
// none of them, since nothing would then show which values were tried.
// The same stages, every test the matrix of the test plan marks mandatory: it passed in the test report, or its
// Test ID is listed under "Not covered" with who accepted the gap. A passed test of the same criterion does not
// stand in for it. In a bug run, a test in a file that showed the bug is mandatory whatever the column says, and
// has a row in the matrix. The QA Engineer fills the column: whether a test should have been marked is not checked.
// How many criteria. A criterion is one behaviour, and the values it holds for are its cases. Otherwise the values
// of one rule tend to become criteria of their own: the line a command prints and its exit code as two, ten refused
// values of one argument as ten, and every later document repeats them. A warning, before the business approval
// only: after it the specification stands as approved. This counts rows. It cannot tell whether a row is one
// behaviour.
const MANY_CRITERIA = 12;
// The cases of the specification, by criterion: in a table that is not a table of criteria (it has no "ID"
// column), every row whose first cell begins with the id of a case. The heading of the column and what follows
// the id in the cell do not matter, so that "Case ID" and "AC-03.1 (a sign)" are read as well.
function readCases(specPath) {
  const cases = new Map();
  for (const t of readTables(specPath)) {
    if (column(t.header, /^id$/) >= 0) continue;
    for (const row of t.rows) {
      const m = acPrefix(cellText(row[0])).match(CASE_AT_START);
      if (!m) continue;
      if (!cases.has(m[1])) cases.set(m[1], []);
      const id = `${m[1]}.${Number(m[2])}`;
      if (!cases.get(m[1]).includes(id)) cases.get(m[1]).push(id);
    }
  }
  return cases;
}
{
  const specPath = data.artifactPaths?.spec;
  if (usable(specPath) && !['DONE', 'CANCELLED'].includes(stage)) {
    try {
      const ids = new Set();
      const unread = [];
      for (const t of readTables(specPath)) {
        const i = column(t.header, /^id$/);
        if (i >= 0) { for (const row of t.rows) { const id = acPrefix(cellText(row[i])); if (/^AC-/.test(id)) ids.add(id); } continue; }
        // A table that says it holds cases, by its first column or its heading: a row that is not read as a case
        // is held to no test, and nothing else would say so.
        if (!/^cases?\b/i.test(cellText(t.header[0])) && !/^cases of\b/i.test(t.heading)) continue;
        for (const row of t.rows) { const first = cellText(row[0]); if (first && !CASE_AT_START.test(first)) unread.push(`"${first.slice(0, 30)}" under "${t.heading}"`); }
      }
      if (!ids.size) for (const id of acPrefix(readFileSync(resolve(specPath), 'utf8')).match(AC_ID) || []) if (!CASE_ID.test(id)) ids.add(id);
      if (unread.length) warnings.push(`${specPath}: ${unread.length} row(s) of a table of cases are not read as cases: ${list(unread)}. The first cell of a case begins with its id, the id of its criterion, a point and a number (AC-03.2). A row that is not read is held to no test`);
      if (ids.size > MANY_CRITERIA && data.gateResults?.businessApproval !== 'PASSED') warnings.push(`${specPath} holds ${ids.size} acceptance criteria. A criterion is one behaviour, and the values it holds for are its cases, in a "Cases of AC-NN" table (.orchestra/templates/feature-spec.template.md). Above ${MANY_CRITERIA}, values of one rule usually stand as criteria of their own, or the run holds more than one ticket`);
    } catch { /* the specification is read again where a stage requires it */ }
  }
}

let criteria = null;
let mandatory = null;
let reportRows = null; // the Results table of the test report, once read here
{
  const judged = FROM_REVIEW.includes(stage);
  const specPath = data.artifactPaths?.spec;
  const reportPath = data.artifactPaths?.testReport;
  const named = data.artifactPaths?.testPlan;
  if (typeof named === 'string' && named && !existsSync(resolve(named))) problems.push(`artifact not found on disk: ${named}`);
  const conventional = data.runId ? `sdlc/runs/${data.runId}/test-plan.md` : null;
  const planPath = usable(named) ? named : (usable(conventional) ? conventional : null);
  if (judged && usable(specPath) && usable(reportPath)) {
    let acs = null;
    let tests = null;
    const gaps = new Map(); // id of a criterion or of a case -> who accepted the gap
    const cases = new Map(); // id of a criterion -> the ids of its cases
    try {
      acs = [];
      for (const t of readTables(specPath)) {
        const i = column(t.header, /^id$/);
        if (i < 0) continue;
        for (const row of t.rows) { const id = acPrefix(cellText(row[i])); if (/^AC-/.test(id) && !acs.includes(id)) acs.push(id); }
      }
      if (!acs.length) for (const id of acPrefix(readFileSync(resolve(specPath), 'utf8')).match(AC_ID) || []) if (!CASE_ID.test(id) && !acs.includes(id)) acs.push(id);
      for (const [ac, ids] of readCases(specPath)) cases.set(ac, ids);
      let found = false;
      const rows = [];
      for (const t of readTables(reportPath)) {
        const iT = column(t.header, /^test id$/);
        const iR = column(t.header, /^result/);
        const iA = column(t.header, /^ac$/);
        if (iT < 0 || iR < 0) continue;
        found = true;
        for (const row of t.rows) {
          const id = cellText(row[iT]);
          if (id) rows.push({ id, result: (cellText(row[iR]).toUpperCase().match(/[A-Z_]+/) || [''])[0], acs: idsIn(iA >= 0 ? row[iA] : ''), cover: iA >= 0 ? cellText(row[iA]) : '' });
        }
      }
      if (found) { tests = rows; reportRows = rows; }
      if (planPath) {
        for (const t of readTables(planPath)) {
          if (!/^not covered$/i.test(t.heading)) continue;
          const iWho = column(t.header, /accepted/);
          for (const row of t.rows) for (const id of idsIn(row[0])) gaps.set(id, cellText(iWho >= 0 ? row[iWho] : ''));
        }
      }
    } catch (e) { problems.push(`cannot read the specification, the test report or the test plan to check the acceptance criteria (${e.message})`); acs = null; }
    if (acs && !acs.length) problems.push(`no AC id found in ${specPath}, so whether every acceptance criterion has a test cannot be checked; give each criterion an AC id in the "ID" column of a table (.orchestra/templates/feature-spec.template.md)`);
    else if (acs && !tests) problems.push(`${reportPath} has no Results table with "Test ID", "AC" and "Result" columns (.orchestra/templates/test-report.template.md), so the tests of the acceptance criteria cannot be read`);
    else if (acs) {
      const untested = [];
      const unaccepted = [];
      const failed = [];
      const unpassed = [];
      const accepted = [];
      // What needs a test: a criterion without cases, or each case of a criterion that has them.
      const units = acs.flatMap((ac) => (cases.get(ac)?.length ? cases.get(ac).map((id) => ({ id, ac })) : [{ id: ac, ac }]));
      const notPassed = new Set(); // criteria with a unit that has no passed test
      let casesPassed = 0;
      for (const { id, ac } of units) {
        const mine = tests.filter((t) => t.acs.includes(id));
        const gapOf = gaps.has(id) ? id : (gaps.has(ac) ? ac : null);
        const who = gapOf ? gaps.get(gapOf) : '';
        if (!mine.length) {
          notPassed.add(ac);
          if (!gapOf) untested.push(id);
          else if (!who || /^<.*>$/.test(who)) unaccepted.push(id);
          else accepted.push(`${id} (${who})`);
        } else if (mine.some((t) => t.result === 'FAILED')) { notPassed.add(ac); failed.push(`${id} (${mine.filter((t) => t.result === 'FAILED').map((t) => t.id).join(', ')})`); }
        else if (!mine.some((t) => t.result === 'PASSED')) { notPassed.add(ac); unpassed.push(`${id} (${mine.map((t) => `${t.id} ${t.result || 'no result'}`).join(', ')})`); }
        else if (id !== ac) casesPassed += 1;
      }
      // A test that names a criterion with cases covers none of them. Its failure still counts: a FAILED row is
      // never left out of the verdict.
      for (const ac of acs) {
        if (!cases.get(ac)?.length) continue;
        const own = tests.filter((t) => t.acs.includes(ac) && t.result === 'FAILED');
        if (own.length) { notPassed.add(ac); failed.push(`${ac} (${own.map((t) => t.id).join(', ')})`); }
      }
      const passed = acs.filter((ac) => !notPassed.has(ac)).length;
      const caseCount = units.filter((u) => u.id !== u.ac).length;
      const noun = (n) => (caseCount ? (n === 1 ? 'acceptance criterion or case' : 'acceptance criteria or cases') : (n === 1 ? 'acceptance criterion' : 'acceptance criteria'));
      // A test that names a criterion with cases says nothing of which case it tried.
      const namedWhole = untested.filter((id) => CASE_ID.test(id) && tests.some((t) => t.acs.includes(id.replace(/\.[0-9]+$/, ''))));
      if (untested.length) problems.push(`${untested.length} ${noun(untested.length)} of ${specPath} ${untested.length === 1 ? 'has' : 'have'} no test in ${reportPath}: ${list(untested)}. Add a test, or list the criterion under "Not covered" in the test plan${planPath ? '' : ' (named in artifactPaths.testPlan)'} with who accepted the gap${namedWhole.length ? `. A test that names a criterion with cases covers none of them: name the cases in the AC column, one (AC-03.2) or a range (AC-03.1..AC-03.4)` : ''}`);
      if (unaccepted.length) problems.push(`${planPath} lists ${list(unaccepted)} under "Not covered" without saying who accepted the gap; only the owner accepts one`);
      if (failed.length) problems.push(`tests is ${data.gateResults?.tests}, but ${reportPath} records a FAILED test for ${list(failed)}`);
      if (unpassed.length) problems.push(`no test passed in ${reportPath} for ${list(unpassed)}`);
      if (accepted.length) warnings.push(`${accepted.length} ${noun(accepted.length)} ${accepted.length === 1 ? 'has' : 'have'} no test, by an accepted gap: ${list(accepted)}`);
      const known = new Set([...acs, ...[...cases.values()].flat()]);
      const unknown = [...new Set(tests.flatMap((t) => t.acs))].filter((id) => !known.has(id));
      const orphans = [...cases.keys()].filter((ac) => !acs.includes(ac));
      if (orphans.length) warnings.push(`${specPath} gives cases for ${list(orphans)}, which ${orphans.length === 1 ? 'is no criterion' : 'are no criteria'} of its tables: they are held to no test`);
      if (unknown.length) warnings.push(`${reportPath} names ${list(unknown)}, which ${specPath} does not list as ${unknown.length === 1 ? 'an acceptance criterion' : 'acceptance criteria'}`);
      const withGap = new Set(units.filter((u) => accepted.some((x) => x.startsWith(`${u.id} (`))).map((u) => u.ac));
      criteria = { total: acs.length, passed, gaps: withGap.size, report: reportPath, cases: caseCount, casesPassed };

      if (planPath) {
        let matrix = null;
        const gapRows = [];
        for (const t of readTables(planPath)) {
          if (/^not covered$/i.test(t.heading)) {
            const iWho = column(t.header, /accepted/);
            for (const row of t.rows) gapRows.push({ what: cellText(row[0]), who: cellText(iWho >= 0 ? row[iWho] : '') });
            continue;
          }
          const iT = column(t.header, /^test id$/);
          if (iT < 0) continue;
          const iM = column(t.header, /^mandatory/);
          const iF = column(t.header, /^test file/);
          const iA = column(t.header, /^ac$/);
          matrix = matrix || { hasColumn: false, rows: [] };
          if (iM >= 0) matrix.hasColumn = true;
          for (const row of t.rows) {
            const id = cellText(row[iT]);
            if (!id) continue;
            const file = iF >= 0 ? cellText(row[iF]) : '';
            const marked = iM >= 0 && /^(yes|y|true|x|✓|✔)$/i.test(cellText(row[iM]));
            matrix.rows.push({ id, ac: iA >= 0 ? cellText(row[iA]) : '', file, mandatory: marked || reproFiles.includes(file) });
          }
        }
        if (matrix) {
          if (!matrix.hasColumn) warnings.push(`${planPath} has no "Mandatory" column in its matrix: nothing shows which tests must pass`);
          const unlisted = reproFiles.filter((f) => !matrix.rows.some((r) => r.file === f));
          if (unlisted.length) problems.push(`the test(s) that showed the bug have no row in the matrix of ${planPath}: ${list(unlisted)}`);
          const word = (id) => new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`);
          const must = matrix.rows.filter((r) => r.mandatory);
          const missing = [];
          const waived = [];
          for (const m of must) {
            const results = tests.filter((x) => x.id === m.id).map((x) => x.result || 'no result');
            if (results.includes('PASSED')) continue;
            const gap = gapRows.find((g) => word(m.id).test(g.what));
            if (gap && gap.who && !/^<.*>$/.test(gap.who)) waived.push(`${m.id} (${gap.who})`);
            else missing.push(`${m.id}${m.ac ? ` for ${m.ac}` : ''}: ${results.length ? results.join(', ') : 'not in the test report'}`);
          }
          if (missing.length) problems.push(`${missing.length} mandatory test(s) of ${planPath} did not pass in ${reportPath}: ${list(missing)}. Another test of the same criterion does not stand in for a mandatory one: run it, or list its Test ID under "Not covered" with who accepted the gap`);
          if (waived.length) warnings.push(`${waived.length} mandatory test(s) did not pass, by an accepted gap: ${list(waived)}`);
          mandatory = { total: must.length, passed: must.length - missing.length - waived.length, plan: planPath };
        }
      }
    }
  }
}

// Decisions of the technical plan in a security-sensitive area. A decision whose "Security-sensitive area" is
// not `no` is held by a test, as a criterion is: from review on it needs a test that passed in the test report,
// with the decision's ID in the AC column, or a row under "Not covered" in the test plan that says who accepted
// the gap. A matrix derived from the criteria alone leaves such a decision untested (the exact boundary of an
// inactivity limit, say), and a later fault in it leaves every test passing. A review reads a decision once; a test
// holds it in every later run. This reads the plan's table and the test report: it cannot tell whether a test
// checks its decision, or whether a decision marked `no` settles a security-sensitive area after all.
let decisions = null;
{
  const judged = FROM_REVIEW.includes(stage);
  const techPlan = data.artifactPaths?.plan;
  const reportPath = data.artifactPaths?.testReport;
  if (judged && usable(techPlan) && reportRows) {
    const marked = [];
    const unmarked = [];
    let hasTable = false;
    let hasColumn = false;
    try {
      for (const t of readTables(techPlan)) {
        if (!/^decisions\b/i.test(t.heading)) continue;
        const iId = column(t.header, /^id$/);
        if (iId < 0) continue;
        hasTable = true;
        const iS = column(t.header, /^security/);
        if (iS >= 0) hasColumn = true;
        for (const row of t.rows) {
          const id = cellText(row[iId]);
          if (!id || row.every((c, i) => i === iId || !cellText(c))) continue; // an empty row of the template
          if (iS < 0) continue;
          const area = cellText(row[iS]);
          if (!area) unmarked.push(id);
          else if (!/^(no|none|n\/a|-|—|–)\.?$/i.test(area)) marked.push({ id, area });
        }
      }
    } catch (e) { problems.push(`cannot read ${techPlan} to check the decisions in a security-sensitive area (${e.message})`); }
    if (hasTable && !hasColumn) warnings.push(`the Decisions table of ${techPlan} has no "Security-sensitive area" column (.orchestra/templates/technical-plan.template.md): nothing shows which decisions a test must hold`);
    if (unmarked.length) warnings.push(`${list(unmarked)} in the Decisions table of ${techPlan} ${unmarked.length === 1 ? 'does' : 'do'} not say whether ${unmarked.length === 1 ? 'it settles' : 'they settle'} a security-sensitive area`);
    if (marked.length) {
      const named = data.artifactPaths?.testPlan;
      const conventional = data.runId ? `sdlc/runs/${data.runId}/test-plan.md` : null;
      const testPlan = usable(named) ? named : (usable(conventional) ? conventional : null);
      const word = (id) => new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`);
      const gapRows = [];
      if (testPlan) {
        for (const t of readTables(testPlan)) {
          if (!/^not covered$/i.test(t.heading)) continue;
          const iWho = column(t.header, /accepted/);
          for (const row of t.rows) gapRows.push({ what: cellText(row[0]), who: cellText(iWho >= 0 ? row[iWho] : '') });
        }
      }
      const untested = [];
      const unaccepted = [];
      const failed = [];
      const unpassed = [];
      const waived = [];
      for (const { id, area } of marked) {
        const mine = reportRows.filter((t) => word(id).test(t.cover));
        const gap = gapRows.find((g) => word(id).test(g.what));
        const label = `${id} (${area})`;
        if (!mine.length) {
          if (!gap) untested.push(label);
          else if (!gap.who || /^<.*>$/.test(gap.who)) unaccepted.push(id);
          else waived.push(`${id} (${gap.who})`);
        } else if (mine.some((t) => t.result === 'FAILED')) failed.push(`${id} (${mine.filter((t) => t.result === 'FAILED').map((t) => t.id).join(', ')})`);
        else if (!mine.some((t) => t.result === 'PASSED')) unpassed.push(`${id} (${mine.map((t) => `${t.id} ${t.result || 'no result'}`).join(', ')})`);
      }
      const noun = (n) => (n === 1 ? 'decision' : 'decisions');
      if (untested.length) problems.push(`${untested.length} ${noun(untested.length)} of ${techPlan} in a security-sensitive area ${untested.length === 1 ? 'has' : 'have'} no test in ${reportPath}: ${list(untested)}. A review reads a decision once; a test holds it in every later run. Add a test that fails when the code breaks the decision, with its ID in the AC column, or list it under "Not covered" in the test plan with who accepted the gap`);
      if (unaccepted.length) problems.push(`${testPlan} lists ${list(unaccepted)} under "Not covered" without saying who accepted the gap; only the owner accepts one`);
      if (failed.length) problems.push(`${reportPath} records a FAILED test for the ${noun(failed.length)} ${list(failed)} of ${techPlan}`);
      if (unpassed.length) problems.push(`no test passed in ${reportPath} for the ${noun(unpassed.length)} ${list(unpassed)} of ${techPlan}`);
      if (waived.length) warnings.push(`${waived.length} ${noun(waived.length)} in a security-sensitive area ${waived.length === 1 ? 'has' : 'have'} no test, by an accepted gap: ${list(waived)}`);
      decisions = { total: marked.length, passed: marked.length - untested.length - unaccepted.length - failed.length - unpassed.length - waived.length, gaps: waived.length, plan: techPlan };
    }
  }
}

// A lock that holds no file, beside passed tests. From review on the run's tests are the ones QA last worked
// with, and the lock is what holds them. It is a problem, not a warning: a lock with no file also keeps the warning
// that the tests are not calibrated from being given. A run whose test report records no passed test, where every
// criterion is an accepted gap, may lock no file.
if (FROM_REVIEW.includes(stage) && lockData && !Object.keys(lockData.files).length && (reportRows || []).some((t) => t.result === 'PASSED')) {
  problems.push(`${data.artifactPaths.testLock} locks no test file, but ${data.artifactPaths.testReport} records passed tests: record the lock after the QA step with the run's test files (node scripts/lock-tests.mjs record ${data.runId ?? '<runId>'} <test file> ..., or --base <ref>)`);
}

// Questions left open at a gate that has passed. A question in clarification.md names the gate it must be
// decided before; the run board shows one still OPEN there once that gate has passed. Otherwise the business
// approval could be recorded while a question needed before it is OPEN, and only the board would say so. This
// reads clarification.md beside the manifest, as the board does. It cannot tell whether a decided row was decided
// by the owner.
{
  const named = data.artifactPaths?.clarification;
  const clarPath = typeof named === 'string' && named ? named : join(dirname(file), 'clarification.md');
  if (stage !== 'CANCELLED' && isFileAt(clarPath)) {
    const label = { businessapproval: 'businessApproval', planapproval: 'planApproval', implementation: 'implementation', tests: 'tests', review: 'review', humanacceptance: 'humanAcceptance', specification: 'businessApproval', spec: 'businessApproval', plan: 'planApproval', acceptance: 'humanAcceptance', test: 'tests' };
    const late = [];
    try {
      for (const t of readTables(clarPath)) {
        const iId = column(t.header, /^id$/);
        const iDec = column(t.header, /^decision$/);
        const iNeed = column(t.header, /^needed before/);
        const iQ = column(t.header, /^question/);
        if (iId < 0 || iDec < 0 || iNeed < 0) continue;
        for (const row of t.rows) {
          const id = cellText(row[iId]);
          if (!id || (iQ >= 0 && !cellText(row[iQ]))) continue;
          const decision = cellText(row[iDec]);
          if (decision && !/^open\b/i.test(decision)) continue;
          const gate = label[cellText(row[iNeed]).toLowerCase().replace(/[^a-z]/g, '')];
          if (gate && data.gateResults?.[gate] === 'PASSED') late.push(`${id} (needed before ${gate})`);
        }
      }
    } catch (e) { warnings.push(`cannot read ${clarPath} to see which questions are open (${e.message})`); }
    if (late.length) problems.push(`${clarPath} holds ${late.length} question(s) still OPEN at a gate that has passed: ${list(late)}. A gate passes only once every question needed before it is decided: record the owner's decision, or set the gate back`);
  }
}

// The dossier at the review. The Code Reviewer and the owner read the delivery dossier, and the Orchestrator
// writes it as the run goes. Left behind the run, its Gates table can read NOT_RUN for gates the manifest holds as
// PASSED, or "Proven, unproven, blocked" stay empty, and the review then spends its findings on that.
// Read in REVIEWING and READY_FOR_ACCEPTANCE, where the dossier has a Gates table: a row of a gate before the
// acceptance that reads another result than the manifest holds is a warning, and so is a "Proven, unproven,
// blocked" in which nothing is filled in. The acceptance's own row is not compared: the owner approves the
// dossier with it, and the dossier cannot change afterwards. A warning, never a problem: a run that began on an
// earlier kit may hold another table. This compares two things the Orchestrator wrote. It cannot tell whether
// either is true.
{
  const deliveryPath = data.artifactPaths?.delivery;
  if (['REVIEWING', 'READY_FOR_ACCEPTANCE'].includes(stage) && usable(deliveryPath)) {
    try {
      const table = readTables(deliveryPath).find((t) => /^gates$/i.test(t.heading) && column(t.header, /^gate$/) >= 0 && column(t.header, /^result/) >= 0);
      if (table) {
        const iG = column(table.header, /^gate$/);
        const iR = column(table.header, /^result/);
        const keyOf = (name) => (/business/.test(name) ? 'businessApproval' : /plan/.test(name) ? 'planApproval' : /implement/.test(name) ? 'implementation' : /^tests?\b/.test(name) ? 'tests' : /review/.test(name) ? 'review' : null);
        const differ = [];
        for (const row of table.rows) {
          const name = cellText(row[iG]);
          const key = keyOf(name.toLowerCase());
          const held = key ? data.gateResults?.[key] : null;
          if (!held) continue;
          const text = cellText(row[iR]);
          const reads = (text.toUpperCase().match(/\b(PASSED|FAILED|NOT_RUN|BLOCKED|WAIVED)\b/) || [''])[0] || (text ? `"${text.slice(0, 30)}"` : 'nothing');
          if (reads !== held && !(reads === 'nothing' && held === 'NOT_RUN')) differ.push(`${reads} for ${name}, where the manifest holds ${held}`);
        }
        if (differ.length) warnings.push(`the Gates table of ${deliveryPath} reads ${differ.join('; ')}. The reviewer and the owner read the dossier: bring the table up to date before the review. Whether either is true was not checked`);
      }
      const lines = readFileSync(resolve(deliveryPath), 'utf8').split(/\r?\n/);
      const from = lines.findIndex((l) => /^#{1,6}\s+proven, unproven, blocked\s*$/i.test(l));
      if (from >= 0) {
        const rest = lines.slice(from + 1);
        const to = rest.findIndex((l) => /^#{1,6}\s/.test(l));
        const bullets = (to < 0 ? rest : rest.slice(0, to)).filter((l) => /^\s*[-*]\s+/.test(l));
        if (bullets.length && bullets.every((l) => /^\s*[-*]\s+(proven|unproven|blocked)\b[^:]*:\s*$/i.test(l))) warnings.push(`"Proven, unproven, blocked" of ${deliveryPath} is not filled in. The reviewer and the owner read it: fill it in before the review`);
      }
    } catch (e) { warnings.push(`cannot read ${deliveryPath} to compare its Gates table with the manifest (${e.message})`); }
  }
}

// A row under "Not covered" that no check reads. The checks above read a row of that table by what its first
// cell names: a criterion, a case, a decision of the plan or a Test ID. A row may name none of them, such as a note
// that the tests were not run on the code before the fix, which is what the calibration does; if nobody accepts it,
// the run can reach DONE with the row open. A warning, in every stage but DONE and CANCELLED, for a row that names
// nothing a check reads and that nobody accepted. A risk the owner accepted stays as it is. This cannot tell
// whether a row that names a criterion is a real gap.
{
  const named = data.artifactPaths?.testPlan;
  const conventional = data.runId ? `sdlc/runs/${data.runId}/test-plan.md` : null;
  const testPlan = usable(named) ? named : (usable(conventional) ? conventional : null);
  if (testPlan && !['DONE', 'CANCELLED'].includes(stage)) {
    try {
      const known = new Set();
      const collect = (path, heading, idColumn) => {
        if (!usable(path)) return;
        for (const t of readTables(path)) {
          if (heading && !heading.test(t.heading)) continue;
          const i = column(t.header, idColumn);
          if (i >= 0) for (const row of t.rows) { const id = cellText(row[i]); if (id) known.add(id); }
        }
      };
      collect(data.artifactPaths?.plan, /^decisions\b/i, /^id$/);
      collect(testPlan, null, /^test id$/);
      collect(data.artifactPaths?.testReport, null, /^test id$/);
      const word = (id) => new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`);
      const unread = [];
      for (const t of readTables(testPlan)) {
        if (!/^not covered$/i.test(t.heading)) continue;
        const iWho = column(t.header, /accepted/);
        for (const row of t.rows) {
          const what = cellText(row[0]);
          const who = cellText(iWho >= 0 ? row[iWho] : '');
          if (!what || (who && !/^<.*>$/.test(who))) continue;
          if (idsIn(what).length || [...known].some((id) => word(id).test(what))) continue;
          unread.push(`"${what.length > 60 ? `${what.slice(0, 60)}…` : what}"`);
        }
      }
      if (unread.length) warnings.push(`${testPlan} lists ${unread.length} row(s) under "Not covered" that name no criterion, case, decision or test, and that nobody accepted: ${list(unread)}. No check reads such a row. A gap is a criterion, a case, a decision or a mandatory test without a passed test, and what the calibration shows is none: have the QA Engineer take the row out, or write who accepted it`);
    } catch (e) { warnings.push(`cannot read ${testPlan} to check its "Not covered" rows (${e.message})`); }
  }
}

// Skills applied. The delivery dossier lists, for each task, the rule of each skill file that shaped the
// code, quoted from the file. Read once the manifest names a dossier that has the table, in every stage but
// DONE and CANCELLED (a skill file may change after a run is delivered): each row names a task of the plan
// and a file in the repository, and its quote is in that file word for word. A missing table, or a task
// without a row, is a warning from READY_FOR_ACCEPTANCE on. This shows that a quote was copied from the file.
// It cannot tell whether the code follows the rule; the Code Reviewer checks that.
let skillsApplied = null;
// Whether a reference of a task's Skills field names a file: the path itself (an anchor aside), a stack skill by
// its name (`node` is .claude/skills/node/SKILL.md or .github/skills/node/SKILL.md), or a path inside a skill
// folder (`node/references/api.md`).
function skillNamed(ref, file) {
  const r = ref.replace(/#.*$/, '').replace(/^\.\//, '').trim();
  const f = file.replace(/^\.\//, '');
  if (!r) return false;
  if (r === f) return true;
  if (!r.includes('/')) return f === `.claude/skills/${r}/SKILL.md` || f === `.github/skills/${r}/SKILL.md`;
  return f.endsWith(`/skills/${r}`) || f.endsWith(`/${r}`);
}
{
  const deliveryPath = data.artifactPaths?.delivery;
  const late = stage === 'READY_FOR_ACCEPTANCE';
  if (usable(deliveryPath) && !['DONE', 'CANCELLED'].includes(stage)) {
    let table = null;
    let readable = true;
    try { table = readTables(deliveryPath).find((t) => /^skills applied$/i.test(t.heading)) || null; }
    catch (e) { readable = false; problems.push(`cannot read ${deliveryPath} to check the "Skills applied" table (${e.message})`); }
    if (readable && !table) {
      if (late) warnings.push(`${deliveryPath} has no "Skills applied" table, so nothing shows which guidance the code was written against (.orchestra/templates/delivery.template.md)`);
    } else if (table) {
      const idx = { task: column(table.header, /^task/), 'skill file': column(table.header, /^skill/), rule: column(table.header, /^rule|quote/), where: column(table.header, /^where/) };
      const missing = Object.keys(idx).filter((k) => idx[k] < 0);
      if (missing.length) problems.push(`${deliveryPath}: the "Skills applied" table lacks column(s): ${missing.join(', ')}`);
      else {
        // Compared without Markdown marks and with single spaces, so that bold, code spans and line wraps in
        // the skill file do not hide a quote that is otherwise word for word.
        const plain = (s) => String(s ?? '').replace(/[`*_]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
        const texts = new Map();
        const rows = table.rows.filter((cells) => cells.some((c) => c));
        const covered = new Set();
        let none = 0;
        rows.forEach((cells, n) => {
          const where = `${deliveryPath}: "Skills applied" row ${n + 1}`;
          const ids = (cells[idx.task] || '').match(TASK_ID) || [];
          const file = cellText(cells[idx['skill file']]).replace(/#.*$/, '').trim();
          const rule = plain(cells[idx.rule]).replace(/^["']+|["']+$/g, '').replace(/\s*(\.\.\.|…)$/, '').trim();
          if (!ids.length) problems.push(`${where} names no task`);
          for (const id of ids) {
            if (planTaskIds.size && !planTaskIds.has(id)) problems.push(`${where} names ${id}, which is not a task of the plan`);
            covered.add(id);
          }
          if (!cellText(cells[idx.where])) problems.push(`${where} says nothing under "Where"; name the file the rule was applied in, or for none the reason`);
          if (!file) { problems.push(`${where} names no skill file`); return; }
          // The file is one the Skills field of a task it names gives. Otherwise a row could quote an invented rule
          // from the delivery dossier itself, which holds every quote, and pass.
          const given = ids.flatMap((id) => planSkills.get(id) || []);
          if (given.length && !given.some((ref) => skillNamed(ref, file))) problems.push(`${where} names ${file}, which the Skills field of ${ids.join(', ')} in the plan does not name (${list(given)}): a quote is copied from a file the task names`);
          if (!texts.has(file)) {
            let text = null;
            try { if (!/^(\/|\.\.(\/|$)|[A-Za-z]:)/.test(file) && statSync(resolve(file)).isFile()) text = plain(readFileSync(resolve(file), 'utf8')); } catch { text = null; }
            texts.set(file, text);
          }
          const text = texts.get(file);
          if (text === null) { problems.push(`${where} names ${file}, which is not a file in this repository; write the path of the skill file as it was read`); return; }
          if (!rule) problems.push(`${where} quotes no rule; quote it from ${file}, or write none and the reason`);
          else if (/^none\b/i.test(rule)) none += 1;
          else if (rule.length < 12) problems.push(`${where} quotes "${rule}", too short to show which rule was applied`);
          else if (!text.includes(rule)) problems.push(`${where} quotes "${rule.slice(0, 70)}${rule.length > 70 ? '…' : ''}", which is not in ${file}; a quote is copied from the file word for word`);
        });
        if (!rows.length && late) warnings.push(`${deliveryPath}: the "Skills applied" table has no row`);
        const uncovered = [...planTaskIds].filter((id) => !covered.has(id));
        if (rows.length && uncovered.length && late) warnings.push(`${deliveryPath}: "Skills applied" has no row for ${list(uncovered)}`);
        if (rows.length) skillsApplied = { rows: rows.length, none, file: deliveryPath };
      }
    }
  }
}

// Human gates. A gate a person passes needs a record of that person's decision.
// pull-request: the decision is the merge of a pull request. local-record: a file in the run folder, which holds
// the line the board sends, `<gate>: APPROVE <documents>@<version>`; the version is that of the documents now,
// computed as scripts/render-run-board.mjs --gate-version computes it, so documents changed after the approval
// fail until the owner approves them again. A record under the run's decisions/ is the owner's reply as the board
// server saved it; any other record was written by the Orchestrator from the owner's words. This cannot tell
// whether those words were the owner's.
const GATE_DOCS = { businessApproval: ['spec'], planApproval: ['plan', 'tasks'], humanAcceptance: ['delivery', 'testReport', 'review'] };
const GATE_WITH = { businessApproval: [['reproduction', 'evidence/reproduction.json']], planApproval: [['design', 'design.md']] };
function gateVersion(gate) {
  const ap = data.artifactPaths && typeof data.artifactPaths === 'object' ? data.artifactPaths : {};
  const pathOf = (key, usual) => {
    if (typeof ap[key] === 'string' && ap[key]) return ap[key];
    if (!usual) return null;
    const f = join(dirname(file), usual);
    return existsSync(resolve(f)) ? f : null;
  };
  const there = (p) => isFileAt(p);
  const own = [...new Set(GATE_DOCS[gate].map((k) => pathOf(k)).filter(there))];
  if (!own.length) return null;
  const files = [...new Set([...own, ...(GATE_WITH[gate] || []).map(([k, usual]) => pathOf(k, usual)).filter(there)])];
  const h = createHash('sha256');
  for (const f of files) h.update(`${basename(f)}\0`).update(readFileSync(resolve(f))).update('\0');
  return `${files.map((f) => basename(f)).join('+')}@${h.digest('hex').slice(0, 12)}`;
}
const humanGates = ['businessApproval', 'planApproval', 'humanAcceptance'];
// The owner's decisions on a gate in a record, in the order they were written: `<gate>: APPROVE <version>` or
// `<gate>: REQUEST CHANGES <version>`. The last one stands. In a reply the board server saved, a decision is a
// line of its own: the board writes each one at the start of a line, after the answers. Otherwise the owner's name
// in the manifest, which the board puts inside the first line of the reply, could carry an APPROVE line, and the
// owner's REQUEST CHANGES below it would be read as an approval. In a record the Orchestrator wrote from the
// owner's words, the line may stand inside a sentence.
function decisionLines(gate, text, ownLine) {
  const start = ownLine ? '^[ \\t]*' : '\\b';
  return [...text.matchAll(new RegExp(`${start}${gate}:\\s*(APPROVE|REQUEST CHANGES)\\s+\x60?([^\\s\x60@]+@[0-9a-f]{12})`, ownLine ? 'gm' : 'g'))];
}
// A REQUEST CHANGES the owner sent from the board after the approval the manifest records: in a reply of the
// run's decisions/ folder saved later than approvals.<gate>.at (by its "Sent at", or the time in its name; at the
// same second, a file that sorts after the record), where it is the last decision on the gate. Otherwise a manifest
// that names an older reply that approved would hide a newer one that asks for changes. This reads the replies the
// board saved. It cannot tell a reply the owner sent from one another process posted to the board.
function laterRequest(gate, rec, fromBoard) {
  if (!data.runId) return null;
  const dir = resolve('sdlc/runs', data.runId, 'decisions');
  const at = Date.parse(rec.at);
  if (Number.isNaN(at) || !existsSync(dir)) return null;
  let own = null;
  try { own = realpathSync(resolve(rec.recordPath)); } catch { /* checked above */ }
  const found = [];
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort(); } catch { return null; }
  for (const name of names) {
    const path = join(dir, name);
    let text = null;
    try { if (realpathSync(path) !== own && statSync(path).isFile()) text = readFileSync(path, 'utf8'); } catch { text = null; }
    if (text === null) continue;
    // The board writes the time twice: in the "Sent at" line, and in the file's name (2026-11-16T04-00-00Z.md).
    const named = name.match(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}Z)/);
    const sent = Date.parse((text.match(/^- Sent at:\s*(\S+)/m) || [])[1] || (named ? `${named[1]}:${named[2]}:${named[3]}` : ''));
    if (Number.isNaN(sent) || sent < at || (sent === at && !(fromBoard && name > basename(rec.recordPath)))) continue;
    for (const m of decisionLines(gate, text, true)) found.push({ verb: m[1], version: m[2], file: relative(process.cwd(), path).split(sep).join('/') });
  }
  const last = found[found.length - 1];
  return last && last.verb === 'REQUEST CHANGES' ? last : null;
}
const prPattern = /^https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/\d+$/;
const deliveryPr = data.externalEvidence?.prUrl || null;
const prApprovals = [];
const approvedVersions = [];
for (const gate of humanGates) {
  if (data.gateResults?.[gate] !== 'PASSED') continue;
  const rec = data.approvals?.[gate];
  if (!rec || typeof rec !== 'object') { problems.push(`${gate} is PASSED but approvals.${gate} holds no record of who approved`); continue; }
  if (!rec.by || typeof rec.by !== 'string') problems.push(`approvals.${gate}.by is missing`);
  if (!rec.at || Number.isNaN(Date.parse(rec.at))) problems.push(`approvals.${gate}.at is missing or not a date`);
  if (rec.kind === 'pull-request') {
    // In local-record mode nothing asks GitHub, so a made-up pull request URL could pass every human gate of a DONE
    // run, with no reply of the owner's and no version of the documents.
    if (mode === 'local-record') problems.push(`approvals.${gate} is a pull request, but approvalMode is local-record: nothing asks GitHub in this mode, so a pull request URL shows nothing. Record the owner's reply (kind local-record, recordPath), or move the run to pull-request mode`);
    if (!prPattern.test(rec.prUrl || '')) problems.push(`approvals.${gate}.prUrl is not a pull request URL`);
    else prApprovals.push({ gate, rec });
  } else if (rec.kind === 'local-record') {
    if (mode === 'pull-request') problems.push(`approvals.${gate} is a local record, but approvalMode is pull-request`);
    if (!rec.recordPath || !existsSync(resolve(rec.recordPath))) problems.push(`approvals.${gate}.recordPath not found on disk: ${rec.recordPath ?? 'missing'}`);
    else if (!isFileAt(rec.recordPath)) problems.push(`approvals.${gate}.recordPath is not a file: ${rec.recordPath}`);
    else {
      // The path is resolved first: `decisions/../notes.md` is not a reply the board saved.
      // The real path is read: `decisions/../notes.md`, or a link in decisions/ to another file, is not a reply the
      // board server saved.
      let fromBoard = false;
      try { fromBoard = Boolean(data.runId) && realpathSync(resolve(rec.recordPath)).startsWith(realpathSync(resolve('sdlc/runs', data.runId, 'decisions')) + sep); } catch { /* no decisions folder */ }
      warnings.push(fromBoard
        ? `${gate} rests on the owner's reply as the board server saved it (${rec.recordPath}); nothing outside this repository confirms who sent it`
        : `${gate} rests on a record the Orchestrator wrote from the owner's words (${rec.recordPath}); nothing outside this repository confirms them`);
      if (stage !== 'CANCELLED') {
        const said = decisionLines(gate, readFileSync(resolve(rec.recordPath), 'utf8'), fromBoard);
        const approvals = said.filter((m) => m[1] === 'APPROVE');
        if (!approvals.length) {
          problems.push(said.length
            ? `the record of ${gate} (${rec.recordPath}) asks for changes and approves nothing: ${gate}: ${said[said.length - 1][1]} ${said[said.length - 1][2]}`
            : `the record of ${gate} (${rec.recordPath}) holds no "${gate}: APPROVE <documents>@<version>" line, so nothing shows which version of the documents was approved`);
        } else if (said[said.length - 1][1] !== 'APPROVE') {
          problems.push(`the record of ${gate} (${rec.recordPath}) asks for changes after it approves: its last decision on ${gate} is REQUEST CHANGES ${said[said.length - 1][2]}. The last decision of the owner stands: leave the gate NOT_RUN and send the request to the specialist who wrote the document`);
        } else {
          const approved = approvals[approvals.length - 1][2];
          const now = gateVersion(gate);
          if (now && now !== approved) problems.push(`${gate} was approved for ${approved}, but its documents are now ${now}: they changed after the approval. Ask the owner to approve this version, or restore the documents`);
          else if (now) approvedVersions.push(`${gate} ${approved}`);
        }
        const later = laterRequest(gate, rec, fromBoard);
        if (later) problems.push(`the owner asked for changes to ${gate} after the approval this manifest records: ${later.file} says ${gate}: REQUEST CHANGES ${later.version}. The last decision of the owner stands: leave the gate NOT_RUN, record the request and send it to the specialist who wrote the document`);
      }
    }
  } else {
    problems.push(`approvals.${gate}.kind must be pull-request or local-record`);
  }
}
// The specification and the plan are approved before the code exists, so they cannot share the delivery pull request.
const urls = prApprovals.map((x) => x.rec.prUrl);
if (new Set(urls).size !== urls.length) problems.push('two human gates name the same pull request; each gate needs its own');
for (const { gate, rec } of prApprovals) {
  if (gate === 'humanAcceptance' && deliveryPr && rec.prUrl !== deliveryPr) problems.push('approvals.humanAcceptance.prUrl differs from externalEvidence.prUrl (the delivery pull request)');
  if (gate !== 'humanAcceptance' && deliveryPr && rec.prUrl === deliveryPr) problems.push(`approvals.${gate} names the delivery pull request; it must be approved in an earlier one`);
}

// Tests gate. In pull-request mode the evidence is the CI run on the delivery pull request, not an agent's report.
const ci = data.externalEvidence?.ci;
if (mode === 'pull-request' && data.gateResults?.tests === 'PASSED') {
  if (!deliveryPr) problems.push('tests is PASSED but externalEvidence.prUrl (the delivery pull request) is missing');
  if (!ci || typeof ci !== 'object') problems.push('tests is PASSED but externalEvidence.ci is missing');
  else {
    if (ci.conclusion !== 'success') problems.push(`externalEvidence.ci.conclusion is ${ci.conclusion ?? 'missing'}; it must be success`);
    if (!/^[0-9a-f]{7,40}$/i.test(ci.headSha || '')) problems.push('externalEvidence.ci.headSha is missing or not a commit hash');
    if (!ci.runUrl) problems.push('externalEvidence.ci.runUrl is missing');
  }
} else if (mode === 'local-record' && data.gateResults?.tests === 'PASSED') {
  warnings.push('tests is PASSED on a local test report; no CI run confirms it');
}

if (stage === 'READY_FOR_ACCEPTANCE' || stage === 'DONE') {
  if ((data.openBlockers || []).length) problems.push('open blockers remain');
}
// Code review. The review gate passes on the Code Reviewer's verdict, which the Orchestrator writes into
// artifactPaths.review from the reviewer's findings (the reviewer is read-only). Once review is PASSED, the review
// must say APPROVE_FOR_HUMAN_REVIEW and leave no BLOCKER open (a Disposition that is empty or OPEN); a MAJOR left
// open is a warning the owner sees. Read as the run board reads it. It cannot tell whether the file holds every
// finding the reviewer returned, or whether a finding marked as dealt with really was.
let reviewChecked = null;
if (data.gateResults?.review === 'PASSED' && stage !== 'CANCELLED' && usable(data.artifactPaths?.review)) {
  const reviewPath = data.artifactPaths.review;
  // The last verdict stands: a review repaired and read again adds a round below the first. Read from the top, a
  // review whose round one says APPROVE_FOR_HUMAN_REVIEW and round two CHANGES_REQUIRED would pass on round one.
  // The template's own line, which names both verdicts, is no verdict.
  const v = [...readFileSync(resolve(reviewPath), 'utf8').matchAll(/Verdict:\s*`?(APPROVE_FOR_HUMAN_REVIEW|CHANGES_REQUIRED)`?(.*)$/gm)].filter((m) => !/\bor\b/.test(m[2])).pop();
  const verdict = v ? v[1] : null;
  if (!verdict) problems.push(`review is PASSED, but ${reviewPath} gives no verdict: write the Code Reviewer's APPROVE_FOR_HUMAN_REVIEW or CHANGES_REQUIRED on its "Verdict:" line`);
  else if (verdict === 'CHANGES_REQUIRED') problems.push(`review is PASSED, but ${reviewPath} says CHANGES_REQUIRED: the review gate passes only on APPROVE_FOR_HUMAN_REVIEW. Repair, review again, and set the gate from the new verdict`);
  const open = { BLOCKER: [], MAJOR: [], MINOR: [] };
  let total = 0;
  for (const t of readTables(reviewPath)) {
    const col = (re) => t.header.findIndex((h) => re.test(cellText(h)));
    const iSev = col(/^severity/i);
    const iDisp = col(/^disposition/i);
    const iId = col(/^id$/i);
    if (iSev < 0) continue;
    for (const row of t.rows) {
      const sev = (cellText(row[iSev]).toUpperCase().match(/BLOCKER|MAJOR|MINOR/) || [])[0];
      if (!sev) continue;
      total += 1;
      const disp = iDisp >= 0 ? cellText(row[iDisp]).toUpperCase() : 'OPEN';
      if (!disp || /^OPEN\b/.test(disp)) open[sev].push(iId >= 0 && cellText(row[iId]) ? cellText(row[iId]) : `a ${sev} row`);
    }
  }
  if (open.BLOCKER.length) problems.push(`review is PASSED, but ${reviewPath} leaves ${open.BLOCKER.length} BLOCKER finding(s) open: ${list(open.BLOCKER)}. A blocker is repaired and reviewed again before the gate passes`);
  if (open.MAJOR.length) warnings.push(`${reviewPath} leaves ${open.MAJOR.length} MAJOR finding(s) open: ${list(open.MAJOR)}`);
  reviewChecked = { file: reviewPath, verdict, total, open: open.BLOCKER.length + open.MAJOR.length + open.MINOR.length };
}

// DONE. In pull-request mode the delivery pull request is merged, and the tracker's status verified. In
// local-record mode there is no pull request: the run is DONE once the delivery the owner accepted is merged into
// the main branch, by the owner or at the owner's word, and git confirms here that the commit named in
// externalEvidence.localMerge is on that branch and holds the locked tests as they were accepted. A ticket that
// names a real tracker still needs its status verified. Nothing outside the repository confirms a local merge.
let localDone = null;
// The code merged is the code reviewed. In pull-request mode the head of the delivery pull request may differ
// from the tested commit only in the run's folder; in local-record mode the anchor is the commit the review
// names ("Commit reviewed:"), and the delivery as merged (the side of the merge that holds that commit, or the
// merged commit itself) may differ from it only in the run's folder as well. Otherwise a code change committed
// after the review and the owner's acceptance could be merged, and the run reach DONE with no word of it. A review
// that names no commit, a commit this repository does not have, or a merge that does not hold it (a squash) is a
// warning: nothing then shows which code was reviewed. This cannot see a change made in the merge commit itself.
function reviewedIsMerged(sha, shown, git) {
  const reviewPath = data.artifactPaths?.review;
  const named = usable(reviewPath) ? (readFileSync(resolve(reviewPath), 'utf8').match(/Commit reviewed:\s*`?([0-9a-f]{7,40})\b/i) || [])[1] : null;
  if (!named) { warnings.push(`${reviewPath || 'the review'} names no "Commit reviewed:", so nothing shows that the code merged is the code reviewed`); return; }
  let reviewed = null;
  try { reviewed = git(['rev-parse', '--verify', '--quiet', `${named}^{commit}`]).trim(); } catch { /* not here */ }
  if (!reviewed) { warnings.push(`the reviewed commit ${named} is not in this repository, so nothing shows that the code merged is the code reviewed`); return; }
  const holds = (c) => { try { git(['merge-base', '--is-ancestor', reviewed, c]); return true; } catch { return false; } };
  let parents = [];
  try { parents = git(['rev-list', '--parents', '-n', '1', sha]).trim().split(/\s+/).slice(1); } catch { parents = []; }
  // A merge commit: the side that holds the reviewed commit, the merged branch first. Any other commit: itself.
  const tip = parents.length > 1 ? [...parents.slice(1), parents[0]].find(holds) || null : (holds(sha) ? sha : null);
  if (!tip) { warnings.push(`the merged commit ${shown.slice(0, 10)} does not hold the reviewed commit ${named} (a squash or a rebase?), so nothing shows that the code merged is the code reviewed`); return; }
  let outside = [];
  try { outside = changedPaths(reviewed, tip).filter((f) => !f.startsWith(`sdlc/runs/${data.runId}/`)); }
  catch (e) { warnings.push(`git cannot compare the reviewed commit ${named} with the merge (${String(e.stderr || e.message).trim().split('\n')[0]})`); return; }
  if (outside.length) problems.push(`files outside sdlc/runs/${data.runId}/ changed after the reviewed commit ${named} and were merged: ${list(outside)}. The code merged is not the code reviewed and accepted: have the change reviewed and accepted, or merge the commit that was`);
}
if (stage === 'DONE') {
  if (data.gateResults?.humanAcceptance !== 'PASSED') problems.push('human acceptance not PASSED');
  const ev = data.externalEvidence || {};
  const realTracker = typeof data.ticketRef === 'string' && data.ticketRef !== '' && !/^local:/i.test(data.ticketRef);
  if (mode === 'local-record') {
    const lm = ev.localMerge;
    if (!lm || typeof lm !== 'object') {
      problems.push('externalEvidence.localMerge is missing: a local-record run is DONE once the delivery is merged into the main branch; record the commit, the branch, who merged it or asked for the merge, and when');
    } else {
      for (const k of ['commit', 'branch', 'by', 'at']) if (typeof lm[k] !== 'string' || !lm[k]) problems.push(`externalEvidence.localMerge.${k} is missing`);
      if (typeof lm.commit === 'string' && lm.commit && typeof lm.branch === 'string' && lm.branch) {
        const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const why = (e) => String(e.stderr || e.message).trim().split('\n')[0];
        let sha = null;
        try { sha = git(['rev-parse', '--verify', '--quiet', `${lm.commit}^{commit}`]).trim(); }
        catch (e) { problems.push(e.status === 1 ? `the merged commit ${lm.commit} is not in this repository` : `git cannot confirm the local merge (${why(e)})`); }
        // The branch is a branch of this repository, and not one of the run's own (sdlc/<runId>/…): otherwise a
        // manifest that names the delivery branch, or the commit itself, would be DONE with nothing merged. Another
        // branch than the main one is what the owner may name, and is said in a warning.
        let branchOk = true;
        try { git(['rev-parse', '--verify', '--quiet', `refs/heads/${lm.branch}`]); }
        catch { branchOk = false; problems.push(`externalEvidence.localMerge.branch ${lm.branch} is not a branch of this repository: name the branch the delivery was merged into`); }
        if (/^sdlc\//.test(lm.branch)) { branchOk = false; problems.push(`externalEvidence.localMerge.branch ${lm.branch} is a branch of a run, not the branch its delivery is merged into: merge the delivery into the main branch, or the branch the owner named`); }
        if (branchOk) {
          let main = null;
          try { main = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim().replace(/^origin\//, ''); } catch { /* no remote head */ }
          if (!main) main = ['main', 'master'].find((b) => { try { git(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]); return true; } catch { return false; } }) || null;
          if (main && main !== lm.branch) warnings.push(`the delivery is merged into ${lm.branch}, not the main branch ${main}: the owner names another branch in /imperata-merge, and the manifest's notes quote those words`);
        }
        if (sha && branchOk) {
          let onBranch = null;
          try { git(['merge-base', '--is-ancestor', sha, `refs/heads/${lm.branch}`]); onBranch = true; }
          catch (e) { if (e.status === 1) onBranch = false; else problems.push(`git cannot confirm that ${lm.commit} is on ${lm.branch} (${why(e)})`); }
          if (onBranch === false) problems.push(`the merged commit ${lm.commit.slice(0, 10)} is not on ${lm.branch}: the delivery is not merged there`);
          if (onBranch && lockData) {
            const differ = [];
            for (const [f, hash] of Object.entries(lockData.files)) {
              let content = null;
              try { content = execFileSync('git', ['show', `${sha}:${f}`], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch { content = null; }
              if (content === null) differ.push(`${f} (missing)`);
              else if (createHash('sha256').update(content).digest('hex') !== hash) differ.push(`${f} (changed)`);
            }
            if (differ.length) problems.push(`the merged commit ${lm.commit.slice(0, 10)} does not hold the tests that were accepted: ${list(differ)}`);
          }
          if (onBranch) localDone = { commit: sha, branch: lm.branch, by: lm.by };
          if (onBranch && data.runId) reviewedIsMerged(sha, lm.commit, git);
        }
      }
    }
    if (realTracker && !ev.trackerStatusVerified) problems.push('tracker status not verified in manifest');
    warnings.push('DONE rests on a local acceptance and a local merge; nothing outside this repository confirms them');
  } else {
    if (!ev.prMerged) problems.push('PR merge not verified in manifest');
    if (!ev.trackerStatusVerified) problems.push('tracker status not verified in manifest');
    if (!ev.prUrl) problems.push('actual PR URL missing');
  }
}

// Remote verification: ask GitHub instead of trusting the manifest.
let remoteChecked = 0;
let runChecked = 0;
let deliveryVerified = false;
function prView(url) {
  const out = execFileSync('gh', ['pr', 'view', url, '--json', 'state,mergedAt,mergedBy,author,headRefName,headRefOid,baseRefName,statusCheckRollup'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}
// The branch each pull request of the run merges into. The specification, the plan and the delivery go into one
// branch, the main one, and never into a branch of a run: a gate's pull request merged into a side branch, or into
// the branch of another gate, changes nothing on the main branch. Read from GitHub's answer; it cannot tell which
// branch the repository takes as its main one.
const bases = new Map();
// A merged pull request approves a gate only for this repository and this run: it must be a pull request of the
// repository the origin remote names, and merge the run's branch for that gate. Without this, any pull request the
// owner once merged, in any repository, would pass. It cannot tell whether the pull request held the documents.
let originRepo = null;
try {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // https://host/owner/name(.git), ssh://git@host/owner/name(.git) or git@host:owner/name(.git)
  const m = url.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (m) originRepo = `${m[1]}/${m[2]}/${m[3]}`.toLowerCase();
} catch { /* no origin remote */ }
// A host with no dot in an SSH remote (git@github-work:acme/shop.git) is the name of an entry of the person's SSH
// configuration, not a host: the repository is then compared by owner and name only, and a warning says so.
// Compared by host as well, every pull request of such a clone would be "not of this repository".
const originAlias = Boolean(originRepo) && !originRepo.split('/')[0].includes('.') && originRepo.split('/')[0] !== 'localhost';
if (verifyRemote && originAlias) warnings.push(`the origin remote names ${originRepo.split('/')[0]}, an SSH host alias rather than a host, so each pull request was tied to this repository by owner and name only`);
const repoOfPr = (url) => (String(url).match(/^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+$/) || []).slice(1).join('/').toLowerCase();
const ownerAndName = (repo) => repo.split('/').slice(1).join('/');
const branchOfGate = { businessApproval: 'spec', planApproval: 'plan', humanAcceptance: 'delivery' };
function tieToRun(gate, url, pr) {
  const same = originRepo && (repoOfPr(url) === originRepo || (originAlias && ownerAndName(repoOfPr(url)) === ownerAndName(originRepo)));
  if (!originRepo) problems.push(`${gate}: this clone has no origin remote, so ${url} cannot be tied to this repository`);
  else if (!same) problems.push(`${gate}: ${url} is a pull request of ${repoOfPr(url)}, not of this repository (${originRepo})`);
  const want = `sdlc/${data.runId}/${branchOfGate[gate]}`;
  if (pr.headRefName !== want) problems.push(`${gate}: ${url} merges ${pr.headRefName || 'an unknown branch'}, not ${want}`);
  if (typeof pr.baseRefName !== 'string' || !pr.baseRefName) problems.push(`${gate}: GitHub names no branch that ${url} merges into`);
  else if (/^sdlc\//.test(pr.baseRefName)) problems.push(`${gate}: ${url} merges into ${pr.baseRefName}, a branch of a run, not the main branch`);
  else bases.set(url, pr.baseRefName);
}
if (verifyRemote) {
  for (const { gate, rec } of prApprovals) {
    try {
      const pr = prView(rec.prUrl);
      remoteChecked += 1;
      if (pr.state !== 'MERGED') problems.push(`${gate}: ${rec.prUrl} is ${pr.state}, not MERGED`);
      tieToRun(gate, rec.prUrl, pr);
      const merger = pr.mergedBy?.login;
      if (merger && rec.by && merger.toLowerCase() !== rec.by.toLowerCase()) problems.push(`${gate}: manifest says approved by ${rec.by}, GitHub says merged by ${merger}`);
      if (merger && pr.author?.login && merger === pr.author.login) warnings.push(`${gate}: ${rec.prUrl} was merged by its own author (${merger})`);
    } catch (e) {
      problems.push(`${gate}: cannot verify ${rec.prUrl} with gh (${String(e.stderr || e.message).trim().split('\n')[0]})`);
    }
  }
  if (mode === 'pull-request' && data.gateResults?.tests === 'PASSED' && deliveryPr && ci) {
    const why = (e) => String(e.stderr || e.message).trim().split('\n')[0];
    const git = (a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    let tested = null;
    try { if (/^[0-9a-f]{7,40}$/i.test(ci.headSha || '')) tested = git(['rev-parse', '--verify', '--quiet', `${ci.headSha}^{commit}`]); }
    catch { problems.push(`the tested commit ${ci.headSha} is not in this clone; fetch the history of the delivery pull request`); }
    try {
      const pr = prView(deliveryPr);
      remoteChecked += 1;
      deliveryVerified = true;
      tieToRun('humanAcceptance', deliveryPr, pr);
      // GitHub reports checks for the current head of the pull request, so this is the live result. A check that
      // was skipped or neutral ran no test: it proves nothing, and only a check that succeeded counts.
      const checks = (pr.statusCheckRollup || []).filter((c) => !ignoredChecks.has(c.name || c.context));
      const resultOf = (c) => String(c.conclusion || c.state || c.status || '').toUpperCase();
      if (!checks.length) problems.push('the delivery pull request has no CI checks');
      const ok = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
      for (const c of checks) {
        const result = c.conclusion || c.state;
        if (!ok.has(result)) problems.push(`CI check "${c.name || c.context}" is ${result || c.status || 'unknown'}`);
      }
      for (const name of requiredChecks) {
        // A check run only: a commit status with the same name can be posted by anyone who can write statuses.
        const mine = checks.filter((c) => c.name === name && !c.context);
        if (!mine.length) problems.push(`the required CI check "${name}" is not on the delivery pull request`);
        else if (!mine.some((c) => resultOf(c) === 'SUCCESS')) problems.push(`the required CI check "${name}" is ${mine.map(resultOf).join(', ') || 'unknown'}; it must have succeeded, since it is the one that runs the build and the tests`);
      }
      if (checks.length && !requiredChecks.size && !checks.some((c) => resultOf(c) === 'SUCCESS')) problems.push(`no CI check of the delivery pull request succeeded (${checks.map((c) => `${c.name || c.context} ${resultOf(c) || 'unknown'}`).join(', ')}): nothing shows that the tests ran. Name the check that runs them with --require-check`);
      const idle = checks.filter((c) => ['SKIPPED', 'NEUTRAL'].includes(resultOf(c)) && !requiredChecks.has(c.name || c.context));
      if (idle.length) warnings.push(`CI check(s) skipped or neutral, which prove nothing: ${idle.map((c) => c.name || c.context).join(', ')}`);
      // The head of the pull request is the tested commit, or a later one that changes only this run's folder:
      // the code GitHub would merge is the code CI tested.
      if (tested && data.runId) {
        let head = null;
        try { head = git(['rev-parse', '--verify', '--quiet', `${pr.headRefOid}^{commit}`]); }
        catch { problems.push(`the head of the delivery pull request, ${pr.headRefOid || 'unknown'}, is not in this clone; fetch the history of the pull request`); }
        if (head && head !== tested) {
          let after = true;
          try { git(['merge-base', '--is-ancestor', tested, head]); } catch (e) { if (e.status === 1) after = false; else problems.push(`git cannot compare the tested commit with the head of the delivery pull request (${why(e)})`); }
          if (!after) problems.push(`the tested commit ${ci.headSha} is not in the delivery pull request, whose head is ${head.slice(0, 10)}: CI tested other code than the code delivered`);
          else {
            const outside = changedPaths(tested, head).filter((f) => !f.startsWith(`sdlc/runs/${data.runId}/`));
            if (outside.length) problems.push(`the delivery pull request changes files outside sdlc/runs/${data.runId}/ after the tested commit ${ci.headSha}: ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ', ...' : ''}`);
          }
        }
      }
    } catch (e) {
      problems.push(`tests: cannot verify ${deliveryPr} with gh (${why(e)})`);
    }
    // The CI run the manifest names: GitHub says it completed with success, on the tested commit.
    const runRef = String(ci.runUrl || '').match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/actions\/runs\/(\d+)(?:\/attempts\/\d+)?\/?$/);
    if (!runRef) problems.push(`externalEvidence.ci.runUrl is not the URL of a GitHub Actions run (https://github.com/<owner>/<repo>/actions/runs/<id>): ${ci.runUrl || 'missing'}`);
    else {
      try {
        const runInfo = JSON.parse(execFileSync('gh', ['run', 'view', runRef[2], '-R', runRef[1], '--json', 'headSha,conclusion,status,url'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        runChecked += 1;
        if (String(runInfo.status).toLowerCase() !== 'completed') problems.push(`the CI run ${ci.runUrl} is ${runInfo.status || 'unknown'}, not completed`);
        else if (String(runInfo.conclusion).toLowerCase() !== 'success') problems.push(`the CI run ${ci.runUrl} concluded ${runInfo.conclusion || 'unknown'}, not success`);
        const runSha = String(runInfo.headSha || '').toLowerCase();
        const want = String(tested || ci.headSha || '').toLowerCase();
        if (!runSha || !want || !(runSha.startsWith(want) || want.startsWith(runSha))) problems.push(`the CI run ${ci.runUrl} ran on ${runSha.slice(0, 10) || 'an unknown commit'}, not on the tested commit ${ci.headSha}`);
      } catch (e) {
        problems.push(`tests: cannot verify the CI run ${ci.runUrl} with gh (${why(e)})`);
      }
    }
    // The manifest is committed after the tested commit, so the head is always newer than ci.headSha.
    // That is acceptable only when everything changed since then lies in this run's folder.
    if (/^[0-9a-f]{7,40}$/i.test(ci.headSha || '') && data.runId) {
      try {
        const changed = changedPaths(ci.headSha, 'HEAD');
        const outside = changed.filter((p) => !p.startsWith(`sdlc/runs/${data.runId}/`));
        if (outside.length) problems.push(`files outside sdlc/runs/${data.runId}/ changed after the tested commit ${ci.headSha}: ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ', ...' : ''}`);
      } catch (e) {
        problems.push(`tests: cannot compare the tested commit ${ci.headSha} with HEAD (${String(e.stderr || e.message).trim().split('\n')[0]})`);
      }
    }
  }
}

if (new Set(bases.values()).size > 1) problems.push(`the pull requests of the run merge into different branches (${[...bases].map(([url, base]) => `${url.replace(/^.*\/pull\//, '#')} into ${base}`).join(', ')}): the specification, the plan and the delivery go into one branch, the main one`);

if (problems.length) { console.error('GATE VALIDATION FAILED'); for (const x of problems) console.error(`- ${x}`); process.exit(1); }
console.log(`Manifest accepted for ${data.runId} in stage ${data.currentStage} (approval mode: ${mode}, track: ${track}${kind === 'bug' ? `, kind: bug${data.confidential === true ? ', confidential' : ''}` : ''}).`);
if (light) console.log(`Light track: the plan has no approval of its own (planApproval WAIVED). Agreed by ${data.trackDecision.by}: ${data.trackDecision.reason.trim()}`);
if (tasksChecked?.count) console.log(`Task complexity: ${tasksChecked.count} task(s) in ${tasksChecked.files.join(', ')} each carry a level and a reason. Whether the levels are right was not checked.`);
else if (!tasksChecked) console.log('Task complexity: not checked; the manifest names no plan on disk yet.');
if (modelTable?.rows) console.log(`Model per task: ${modelTable.rows} delegation row(s) in ${modelTable.file} are filled in and agree with the plan. Which model really ran was not checked.`);
if (ownerChecks) console.log(`Checked by the owner: ${ownerChecks.said} of ${ownerChecks.of} task(s) delegated to the Developer carry the owner's word in ${ownerChecks.file}. Whether the owner said it was not checked.`);
if (testLock) console.log(`Test lock: ${testLock.count} test file(s) are unchanged since the QA step (${testLock.at ?? 'no date'}, ${testLock.file}).${calibration ? '' : ' Whether the tests are good was not checked.'}`);
if (calibration) console.log(`Test calibration: ${calibration.proven} of ${calibration.total} locked test file(s) pass with the run's change and fail without it${calibration.uncontrolled ? `, ${calibration.uncontrolled} fail on a base where no control passed, which does not show that they test the change` : ''}${calibration.guards ? `, ${calibration.guards} are declared to pass without it` : ''}${calibration.rest ? `, ${calibration.rest} have no result` : ''} (${calibration.file}). Whether they fail for the right reason was not checked.${calibration.steady ? ` The whole suite passed in each of ${calibration.steady} run(s) on the locked tests; a failure rarer than that can still be there.` : ''}`);
if (approvedVersions.length) console.log(`Approved versions: ${approvedVersions.join(', ')}; the documents are unchanged since. Whether the owner wrote the approval was not checked.`);
if (reviewChecked) console.log(`Code review: ${reviewChecked.verdict} in ${reviewChecked.file}, ${reviewChecked.total} finding(s), ${reviewChecked.open} left open and none of them a BLOCKER. Whether the file holds every finding the reviewer returned was not checked.`);
if (localDone) console.log(`Local merge: ${localDone.commit.slice(0, 10)} is on ${localDone.branch} and holds the tests that were accepted (merged by or for ${localDone.by}). Who really accepted and merged was not checked outside this repository.`);
if (reproduction) console.log(`Reproduction: ${reproduction.shown} of ${reproduction.total} test file(s) failed on ${reproduction.commit.slice(0, 10)}, the code before the fix (${reproduction.file}). Whether they fail for the reported reason was not checked.`);
if (mandatory) console.log(`Mandatory tests: ${mandatory.passed} of ${mandatory.total} marked mandatory in ${mandatory.plan} passed. Whether the right tests are marked was not checked.`);
if (criteria) console.log(`Acceptance criteria: ${criteria.passed} of ${criteria.total} have a test that passed in ${criteria.report}${criteria.cases ? `, with ${criteria.casesPassed} of their ${criteria.cases} cases` : ''}${criteria.gaps ? `, ${criteria.gaps} left without a test by an accepted gap` : ''}. Whether a test checks its criterion was not checked.`);
if (decisions) console.log(`Decisions in a security-sensitive area: ${decisions.passed} of ${decisions.total} in ${decisions.plan} have a test that passed${decisions.gaps ? `, ${decisions.gaps} left without a test by an accepted gap` : ''}. Whether a test checks its decision, and whether a decision marked "no" settles such an area after all, was not checked.`);
if (skillsApplied) console.log(`Skills applied: ${skillsApplied.rows} row(s) in ${skillsApplied.file}${skillsApplied.none ? `, ${skillsApplied.none} of them none` : ''}; every quoted rule is in the skill file it names. Whether the code follows the rules was not checked.`);
// Table rows. Every script of the kit ends a cell at a "|" that has no backslash before it, as Markdown does,
// also inside a code span. A row with a "|" in a cell then has one cell more than the table has columns, and
// what is read from it comes from the wrong column: when a decision of the plan quotes a usage line with a "|" in
// it, its "Alternatives rejected" is read as its "Security-sensitive area", and the approval card tells the owner
// that the plan holds a decision in such an area. A warning: this counts cells. It cannot tell which cell was cut,
// or whether a script reads the column that moved.
{
  const docs = new Set(Object.values(data.artifactPaths || {}).filter((p) => usable(p) && /\.md$/i.test(p)));
  for (const p of [...docs]) { const c = join(dirname(p), 'clarification.md'); if (existsSync(resolve(c))) docs.add(c); }
  for (const doc of docs) {
    let tables = [];
    try { tables = readTables(doc); } catch { continue; }
    const off = [];
    for (const t of tables) {
      for (const row of t.rows) {
        if (row.length === t.header.length || row.every((c) => !cellText(c))) continue;
        off.push(`"${cellText(row[0]).slice(0, 40) || '(empty first cell)'}" under "${t.heading || 'no heading'}" (${row.length} cells for ${t.header.length} columns)`);
      }
    }
    if (off.length) warnings.push(`${doc}: ${off.length} table row(s) do not have as many cells as their table has columns: ${off.slice(0, 5).join('; ')}${off.length > 5 ? `; and ${off.length - 5} more` : ''}. A "|" inside a cell ends the cell, also inside a code span: write it as "\\|". What the scripts and the board read from such a row may come from the wrong column`);
  }
}

// Times. Every time in the manifest is taken from the clock at the moment it is written. A time an agent writes by
// hand can be a minute that has not come yet. A warning: a time ahead of this machine's clock by more than a minute
// was not read from it. This cannot tell whether a time in the past was the real one.
{
  const now = Date.now();
  const times = [['updatedAt', data.updatedAt], ['trackDecision.at', data.trackDecision?.at], ['externalEvidence.localMerge.at', data.externalEvidence?.localMerge?.at]];
  for (const [gate, rec] of Object.entries(data.approvals || {})) times.push([`approvals.${gate}.at`, rec?.at]);
  const ahead = times.filter(([, t]) => typeof t === 'string' && !Number.isNaN(Date.parse(t)) && Date.parse(t) - now > 60_000);
  if (ahead.length) warnings.push(`${ahead.map(([k, t]) => `${k} (${t})`).join(', ')} ${ahead.length === 1 ? 'is' : 'are'} ahead of this machine's clock (${new Date(now).toISOString().slice(0, 19)}Z): take every time from "date -u +%Y-%m-%dT%H:%M:%SZ" at the moment you write it, never estimate or round one`);
}

for (const w of warnings) console.log(`WARNING: ${w}`);
if (verifyRemote) console.log(`Remote verification: ${remoteChecked} pull request lookup(s)${runChecked ? ` and ${runChecked} CI run lookup(s)` : ''} against GitHub agreed with the manifest.${requiredChecks.size && deliveryVerified ? ` Required check(s) succeeded: ${[...requiredChecks].join(', ')}.` : ''}`);
else console.log('WARNING: manifest only. Pull request merges, CI results and tracker state were NOT checked against GitHub; add --verify-remote for that.');
