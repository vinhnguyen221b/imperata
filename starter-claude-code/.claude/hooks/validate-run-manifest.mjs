#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// PostToolUse hook (wired in .claude/settings.json for Edit and Write).
// Every time a run manifest (sdlc/runs/<runId>/run.json) is written, run the gate validator on it.
// In pull-request mode the validator is run with --verify-remote, as the Orchestrator's rules require.
// Exit 2 returns the validator's findings to the agent.
//
// Limit: the write has already happened when this hook runs. It reports an invalid manifest at once;
// it does not prevent one, and it does not see a manifest written by a shell command. The required
// CI job on the pull request is what keeps an invalid manifest from being merged.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch { process.exit(0); }

const target = input?.tool_input?.file_path;
if (!target) process.exit(0);

const root = resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
const abs = isAbsolute(target) ? resolve(target) : resolve(input.cwd || root, target);
const rel = relative(root, abs).split(sep).join('/');
// The path as the repository knows it, whatever name leads to it: a link such as /tmp to /private/tmp, the APFS
// firmlink /System/Volumes/Data, or other letters for the same name. The deepest folder of the path that exists
// is walked up until it is the repository's own folder, compared by device and inode; the rest is appended.
// On macOS and Windows a name matches whatever the case of its letters, and APFS also folds letters such as the
// long s (U+017F) and the sharp s: compare folded names there.
const caseless = process.platform === 'darwin' || process.platform === 'win32';
const fold = (p) => p.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC');
function fromRoot(target) {
  let home;
  try { home = statSync(root); } catch { return null; }
  const rest = [];
  for (let p = target; ; p = dirname(p)) {
    let st = null;
    try { st = statSync(p); } catch { /* not there yet */ }
    if (st) {
      const up = [];
      for (let q = p; ; q = dirname(q)) {
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
if (!/^sdlc\/runs\/[^/]+\/run\.json$/.test(key)) process.exit(0);

const validator = resolve(root, 'scripts/validate-gates.mjs');
if (!existsSync(validator)) {
  console.error(`Run manifest ${rel} was written, but scripts/validate-gates.mjs is not in this repository.`);
  console.error('The manifest is unchecked. Copy the validator from the starter before changing a stage; report the gate check as NOT_RUN until then.');
  process.exit(2);
}

const args = [validator, rel];
let mode = 'unknown';
try { mode = JSON.parse(readFileSync(abs, 'utf8')).approvalMode; } catch { /* the validator reports unreadable JSON */ }
if (mode === 'pull-request') args.push('--verify-remote');

const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
if (run.status === 0) process.exit(0);

console.error(`Gate validator rejected ${rel} (exit ${run.status ?? 'unknown'}${mode === 'pull-request' ? ', with --verify-remote' : ''}):`);
console.error((run.stderr || run.stdout || String(run.error || '')).trim());
console.error('The stage change is not allowed. Restore the previous stage in the manifest, or correct the listed fields from real evidence, before any other step. Do not set a gate to PASSED to get past this check.');
process.exit(2);
