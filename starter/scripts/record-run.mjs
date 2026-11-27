#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// Records one change to an Imperata run in one call: the fields of the manifest, the gate validator, the run
// boards and, when asked, the commit.
//
//   node scripts/record-run.mjs <runId> [--set <field>=<value> ...] [--require-check <name> ...]
//                               [--commit "<subject>" [--body "<text>"] [--add <path> ...]]
//
// --set   writes one field of sdlc/runs/<runId>/run.json. <field> is the path to it, with dots: currentStage,
//         gateResults.tests, artifactPaths.plan, approvals.humanAcceptance.by, externalEvidence.localMerge.commit.
//         The value is read as the schema of the manifest (.orchestra/schemas/run.schema.json) types the field:
//         text, a whole number, true or false. null empties a field that may be empty, a list is given as JSON
//         and an empty value empties it (openBlockers=), and @now is the time of this call, the same in every
//         field of the call. A record such as
//         approvals.humanAcceptance is built from its fields, one --set each. A field the schema does not name,
//         or a value it does not allow, stops the call before anything is written and lists what it does allow.
//         `notes` and the fields of `artifactPaths` are free. `revision` goes up by one and `updatedAt` is taken
//         from the clock: neither can be set, and neither can `runId`.
// Then, in this order, stopping at the first step that fails:
//   1. the gate validator reads the manifest as written, in pull-request mode with --verify-remote, and with
//      each --require-check. When it rejects the manifest, the manifest is put back as it was.
//   2. the run boards are rendered, and checked.
//   3. with --commit: everything under sdlc/ and each --add path is staged and committed. --body is the second
//      paragraph of the message, where a trailer goes.
// Without --set the manifest is left alone and the three steps run: after a change to a document of the run.
//
// Exit 0: done. Exit 1: the validator rejected the change and the manifest is as it was, or the boards or the
// commit failed after the manifest was recorded; the last line says which. Exit 2: nothing was changed (usage, a
// field or a value the schema does not allow, a manifest that is not JSON, a commit in an auto-run session).
//
// By hand, a stage change takes the Orchestrator many requests: one for the time, one for each edit of the
// manifest, one each for the validator, the renderer, its check, the staging and the commit. An edit by hand can
// leave the manifest without a closing brace, which takes more requests to find and repair, and the Orchestrator
// tends to search the schema, or the manifest of another run, for the name of a stage or the shape of a record.
//
// Unquoted, `--set openBlockers=[]` never reaches the script: zsh reads the brackets as a pattern and stops the
// call. The blockers then stay, and the board shows the owner a wait that is over. An empty value empties a list,
// and needs no quoting in any shell.
//
// A session that scripts/board-server.mjs starts (auto-run) runs with IMPERATA_AUTO_RUN set, and --commit stops
// there before anything is written: nobody watches that session, and its commits stay with a person.
//
// Limits: this script writes what it is told. It decides no stage and passes no gate: whether the evidence
// behind a PASSED is there is the validator's to check as far as it can, and a person's decision is still a
// record in `approvals` that the validator reads. It checks a field against the schema by name and type only;
// the validator judges the manifest. It cannot tell whether a time given as text is the real one; @now is this
// machine's clock. A commit holds everything under sdlc/ and under the paths named, whoever changed it, and
// whatever was staged before. A manifest written here is not seen by the hooks of the Claude Code layer, which
// act on the file tools; the validator and the renderer they would start are run here instead. Run from the
// repository root.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = '.orchestra/schemas/run.schema.json';
const USAGE = [
  'Usage: node scripts/record-run.mjs <runId> [--set <field>=<value> ...] [--require-check <name> ...]',
  '                                   [--commit "<subject>" [--body "<text>"] [--add <path> ...]]',
  '  --set            one field of the manifest, by its path: currentStage=REVIEWING, gateResults.tests=PASSED,',
  '                   approvals.humanAcceptance.at=@now (@now: the time of this call); a list as JSON, or empty with',
  '                   openBlockers= ; revision and updatedAt are set here',
  '  --require-check  passed on to the gate validator (pull-request mode)',
  '  --commit         commit everything under sdlc/ with this subject; --add <path> stages more, --body adds a paragraph',
  'It writes the fields, runs the gate validator (and puts the manifest back if it rejects it), renders and checks the',
  'run boards, then commits. It writes what it is told and passes no gate.',
];
function stop(code, ...lines) {
  for (const l of lines) if (l) console.error(l);
  process.exit(code);
}
const usage = (msg) => stop(2, msg, ...USAGE);

const args = process.argv.slice(2);
let runId = null;
const sets = [];
const requireChecks = [];
let subject = null;
let body = null;
const adds = [];
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  const value = () => { i += 1; if (args[i] === undefined) usage(`${a} needs a value`); return args[i]; };
  if (a === '--set') {
    const v = value();
    const eq = v.indexOf('=');
    if (eq < 1) usage(`--set takes <field>=<value>, not "${v}"`);
    sets.push([v.slice(0, eq), v.slice(eq + 1)]);
  } else if (a === '--require-check') requireChecks.push(value());
  else if (a === '--commit') subject = value();
  else if (a === '--body') body = value();
  else if (a === '--add') adds.push(value());
  else if (a === '--help' || a === '-h') { for (const l of USAGE) console.log(l); process.exit(0); }
  else if (a.startsWith('--')) usage(`Unknown argument: ${a}`);
  else if (runId === null) runId = a;
  else usage(`Unexpected argument: ${a}`);
}
if (!runId || /[\\/]|^\.\.?$/.test(runId)) usage();
const manifestRel = `sdlc/runs/${runId}/run.json`;
const manifestAbs = resolve(root, manifestRel);
if (!existsSync(manifestAbs)) usage(`No run manifest at ${manifestRel}. Run from the repository root.`);
if (subject === null && (body !== null || adds.length)) usage('--body and --add go with --commit.');
if (subject !== null && !subject.trim()) usage('--commit needs the subject of the commit.');
if (subject !== null && process.env.IMPERATA_AUTO_RUN) {
  stop(2, 'The board server started this session (auto-run): nobody watches it, and it commits nothing.',
    'Nothing was changed. Make the same call without --commit, and leave the commit under "Pending human actions".');
}

const validator = join(here, 'validate-gates.mjs');
const renderer = join(here, 'render-run-board.mjs');
for (const s of [validator, renderer]) if (!existsSync(s)) stop(2, `scripts/${basename(s)} is not beside this script. Nothing was changed.`);
const git = (a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
const node = (a) => spawnSync(process.execPath, a, { cwd: root, encoding: 'utf8' });
const outOf = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `${r.error.message}\n` : ''}`.trimEnd();
if (subject !== null && git(['rev-parse', '--is-inside-work-tree']).status !== 0) stop(2, 'This is not a git repository: nothing can be committed here. Nothing was changed.');

const before = readFileSync(manifestAbs, 'utf8');
let data;
try { data = JSON.parse(before.replace(/^\uFEFF/, '')); } catch (e) { stop(2, `${manifestRel} is not JSON (${e.message}). Repair it with the file tools first. Nothing was changed.`); }
if (data === null || typeof data !== 'object' || Array.isArray(data)) stop(2, `${manifestRel} does not hold a manifest. Nothing was changed.`);

// ---------------------------------------------------------------------------------------------
// The fields

const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const FREE = ['notes'];   // a field of the manifest that the schema does not name and the kit reads or writes
const FIXED = { revision: 'goes up by one with every change recorded here', updatedAt: 'is taken from the clock', runId: 'names the run' };
const typesOf = (n) => (n?.type === undefined ? [] : [].concat(n.type));
const short = (v) => { const s = JSON.stringify(v); return s === undefined ? 'nothing' : s.length > 90 ? `${s.slice(0, 87)}...` : s; };
const bad = (msg) => stop(2, msg, 'Nothing was changed.');

function valueOf(node, raw, field) {
  if (raw === '@now' && (!node || typesOf(node).includes('string'))) return now;
  if (!node) {
    if (raw === 'null') return null;
    if (/^\s*[[{]/.test(raw)) { try { return JSON.parse(raw); } catch (e) { bad(`${field}: the value starts as JSON and is not (${e.message}).`); } }
    return raw;
  }
  if (node.enum) {
    if (!node.enum.includes(raw)) bad(`${field} cannot be "${raw}". It is one of: ${node.enum.join(', ')}.`);
    return raw;
  }
  const types = typesOf(node);
  if (raw === 'null' && types.includes('null')) return null;
  if (types.includes('string')) {
    if (node.minLength && raw.length < node.minLength) bad(`${field} cannot be empty.`);
    return raw;
  }
  if (types.includes('integer')) {
    if (!/^-?\d+$/.test(raw)) bad(`${field} is a whole number, not "${raw}".`);
    return Number(raw);
  }
  if (types.includes('boolean')) {
    if (raw !== 'true' && raw !== 'false') bad(`${field} is true or false, not "${raw}".`);
    return raw === 'true';
  }
  if (types.includes('array') || types.includes('object')) {
    const list = types.includes('array');
    const names = Object.keys(node.properties || {});
    if (list && raw === '') return [];
    const how = list ? `${field} is a list: give it as JSON in quotes, for example ${field}='["..."]', or empty it with ${field}= and nothing after.`
      : `${field} holds fields: set them one by one${names.length ? ` (${names.map((n) => `${field}.${n}`).join(', ')})` : ''}${types.includes('null') ? ', or null to empty it' : ''}.`;
    let v;
    try { v = JSON.parse(raw); } catch { bad(how); }
    if (v === null || typeof v !== 'object' || Array.isArray(v) !== list) bad(how);
    const unknown = !list && node.properties ? Object.keys(v).filter((k) => !(k in node.properties)) : [];
    if (unknown.length) bad(`${field} has no field "${unknown[0]}". It has: ${names.join(', ')}.`);
    return v;
  }
  return raw;
}

const changes = [];
function apply(target, schema, field, raw) {
  const segs = field.split('.');
  if (segs.some((s) => !s)) bad(`"${field}" is not the path of a field.`);
  if (segs.length === 1 && field in FIXED) bad(`${field} ${FIXED[field]}: it cannot be set.`);
  let node = schema;   // the schema of the object the path is in; null where the schema leaves it open
  let obj = target;
  for (let i = 0; i < segs.length; i += 1) {
    const key = segs[i];
    const upTo = segs.slice(0, i + 1).join('.');
    let child = null;
    if (node?.properties) {
      if (key in node.properties) child = node.properties[key];
      else if (!(i === 0 && FREE.includes(key))) {
        const names = Object.keys(node.properties).filter((k) => !(i === 0 && k in FIXED)).concat(i === 0 ? FREE : []);
        bad(`${i === 0 ? 'The manifest' : segs.slice(0, i).join('.')} has no field "${key}". It has: ${names.join(', ')}.`);
      }
    }
    if (i === segs.length - 1) {
      const prev = obj[key];
      const val = valueOf(child, raw, field);
      if (JSON.stringify(prev) !== JSON.stringify(val)) {
        obj[key] = val;
        changes.push(`  ${field}: ${short(prev)} -> ${short(val)}`);
      }
      return;
    }
    if (child && !typesOf(child).includes('object')) bad(`${upTo} holds a value, not fields: "${field}" is not a field of the manifest.`);
    const cur = obj[key];
    if (cur === null || cur === undefined) obj[key] = {};
    else if (typeof cur !== 'object' || Array.isArray(cur)) bad(`${upTo} holds ${short(cur)}, not fields: set it as a whole, or empty it with ${upTo}=null first.`);
    obj = obj[key];
    node = child;
  }
}

let next = null;
if (sets.length) {
  let schema;
  try { schema = JSON.parse(readFileSync(resolve(root, SCHEMA), 'utf8')); }
  catch (e) { stop(2, `Cannot read ${SCHEMA} (${e.message.split('\n')[0]}): the fields cannot be checked without it. Nothing was changed.`); }
  next = JSON.parse(before.replace(/^\uFEFF/, ''));
  for (const [field, raw] of sets) apply(next, schema, field, raw);
  if (!changes.length) {
    next = null;
    console.log(`run.json: the fields already hold these values; revision ${data.revision} stays.`);
  } else {
    if (Number.isInteger(next.revision)) next.revision += 1;
    next.updatedAt = now;
    writeFileSync(manifestAbs, `${JSON.stringify(next, null, 2)}\n`);
  }
}

// ---------------------------------------------------------------------------------------------
// The validator, the boards, the commit

const recorded = next ? 'The manifest is recorded' : 'The manifest was not changed';
const mode = (next ?? data).approvalMode;
const v = node([validator, manifestRel, ...(mode === 'pull-request' ? ['--verify-remote'] : []), ...requireChecks.flatMap((c) => ['--require-check', c])]);
if (v.status !== 0) {
  if (next) writeFileSync(manifestAbs, before);
  stop(1, outOf(v), ...(next ? ['Not recorded:', ...changes] : []), next
    ? `Rejected by the gate validator: the manifest is as it was (revision ${short(data.revision)}). Nothing was rendered or committed.`
    : 'The gate validator rejects the manifest as it stands. Nothing was rendered or committed.');
}
if (next) {
  console.log(`run.json: revision ${short(data.revision)} -> ${short(next.revision)}, updatedAt ${now}`);
  for (const c of changes) console.log(c);
}
console.log('validator: accepted');
if (outOf(v)) console.log(outOf(v));

const rendered = node([renderer, '--quiet']);
if (rendered.status !== 0) stop(1, outOf(rendered), `The run boards were not rendered. ${recorded}; nothing was committed.`);
const current = node([renderer, '--check', '--quiet']);
if (current.status !== 0) stop(1, outOf(current), `The run boards are not current after rendering. ${recorded}; nothing was committed.`);
console.log('board: rendered and current');

if (subject !== null) {
  const add = git(['add', '-A', '--', 'sdlc', ...adds]);
  if (add.status !== 0) stop(1, outOf(add), `Nothing was staged or committed. ${recorded} and the boards are rendered.`);
  const staged = git(['diff', '--cached', '--name-only']).stdout.split('\n').filter(Boolean);
  if (!staged.length) console.log('commit: nothing to commit');
  else {
    const c = git(['commit', '-q', '-m', subject, ...(body !== null ? ['-m', body] : [])]);
    if (c.status !== 0) stop(1, outOf(c), `The commit failed. ${recorded} and the boards are rendered; the files are staged.`);
    console.log(`commit: ${git(['rev-parse', '--short', 'HEAD']).stdout.trim()} ${subject} (${staged.length} file${staged.length === 1 ? '' : 's'})`);
  }
}
