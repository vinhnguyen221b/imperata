#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// PreToolUse hook for the developer subagent (wired in .claude/agents/developer.md).
// Once the QA Engineer has tested a run, scripts/lock-tests.mjs records the run's test files in
// sdlc/runs/<runId>/evidence/test-lock.json. From then until the run is delivered or cancelled the Developer
// may not create, change or replace those files, the lock itself, the calibration result or the reproduction
// written beside it, or any run manifest.
// Exit 2 blocks the tool call and returns the message on stderr to the agent.
//
// Limit: this covers the file-editing tools only. A shell command can still write any file. The gate
// validator compares the locked files with their recorded hashes, so such a change is found before review.
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname, basename } from 'node:path';

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch { console.error('dev-test-guard: hook input is not JSON; blocking the write.'); process.exit(2); }

const target = input?.tool_input?.file_path || input?.tool_input?.notebook_path;
if (!target) process.exit(0); // not a file-writing call

const root = resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
const abs = isAbsolute(target) ? resolve(target) : resolve(input.cwd || root, target);
const rel = relative(root, abs).split(sep).join('/');
// The path as the repository knows it, whatever name leads to it: a link such as /tmp to /private/tmp or one inside
// the repository, the APFS firmlink /System/Volumes/Data, or other letters for the same name. The deepest part of
// the path that exists is resolved to its real path (links followed, each name in the letters the disk holds), then
// walked up until it is the repository's own folder, compared by device and inode; the rest is appended as given.
// Read as written, a write to src/laTest/index.js, where src/latest/ holds application code, passes the QA
// Engineer's guard as a test folder, and one through a link to a run folder (r1link/decisions/x.md) passes the
// guard of the owner's decisions. A name that does not exist yet keeps the letters it was given.
// On macOS and Windows a name matches whatever the case of its letters, and APFS also folds letters such as the
// long s (U+017F) and the sharp s: compare folded names there.
const caseless = process.platform === 'darwin' || process.platform === 'win32';
const fold = (p) => p.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC');
function fromRoot(target) {
  let home;
  try { home = statSync(root); } catch { return null; }
  const rest = [];
  for (let p = target; ; p = dirname(p)) {
    let real = null;
    try { real = realpathSync.native(p); } catch { /* not there yet */ }
    if (real !== null) {
      const up = [];
      for (let q = real; ; q = dirname(q)) {
        let s;
        try { s = statSync(q); } catch { return null; }
        if (s.dev === home.dev && s.ino === home.ino) return [...up.reverse(), ...rest].join('/');
        if (dirname(q) === q) return null;
        up.push(basename(q));
      }
    }
    if (dirname(p) === p) return null;
    rest.unshift(basename(p));
  }
}
const inside = fromRoot(abs);
const plain = inside ?? rel;
const key = caseless ? (inside === null ? relative(fold(root), fold(abs)).split(sep).join('/') : fold(inside)) : plain;

function block(reason) {
  console.error(`Developer write blocked: ${rel || target}`);
  console.error(reason);
  process.exit(2);
}

if (/^sdlc\/runs\/[^/]+\/run\.json$/.test(key)) block('The run manifest is owned by the Orchestrator.');
if (/^sdlc\/runs\/[^/]+\/evidence\/test-lock\.json$/.test(key)) block('The test lock is recorded by scripts/lock-tests.mjs after a QA step. No agent edits it.');
if (/^sdlc\/runs\/[^/]+\/evidence\/test-calibration\.json$/.test(key)) block('The test calibration is written by scripts/lock-tests.mjs calibrate. No agent edits it.');
if (/^sdlc\/runs\/[^/]+\/evidence\/reproduction\.json$/.test(key)) block('The reproduction of a bug run is written by scripts/lock-tests.mjs reproduce. No agent edits it.');

// A lock binds while its run is still open.
const closed = new Set(['DONE', 'CANCELLED']);
let runs = [];
try { runs = readdirSync(resolve(root, 'sdlc/runs'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { process.exit(0); }
for (const run of runs) {
  let lock;
  try { lock = JSON.parse(readFileSync(resolve(root, 'sdlc/runs', run, 'evidence/test-lock.json'), 'utf8')); } catch { continue; }
  if (!lock || typeof lock.files !== 'object' || !lock.files || !Object.keys(lock.files).some((f) => (caseless ? fold(f) : f) === key)) continue;
  let stage = null;
  try { stage = JSON.parse(readFileSync(resolve(root, 'sdlc/runs', run, 'run.json'), 'utf8')).currentStage; } catch { /* unreadable manifest: keep the lock */ }
  if (closed.has(stage)) continue;
  block(`It is a test file locked for run ${run} after its QA step (sdlc/runs/${run}/evidence/test-lock.json). Fix the application code so the test passes. If the test is wrong or contradicts an acceptance criterion, do not change it: return NEEDS_DECISION with the test, what it asserts and why that is wrong, so the QA Engineer can decide.`);
}
process.exit(0);
