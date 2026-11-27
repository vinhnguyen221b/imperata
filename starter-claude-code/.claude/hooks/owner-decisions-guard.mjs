#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// PreToolUse hook (wired in .claude/settings.json for Edit, Write and NotebookEdit).
// sdlc/runs/<runId>/decisions/ holds the owner's replies as scripts/board-server.mjs saved them when the
// owner pressed "Send to Orchestrator". They are the evidence of the owner's decisions, so no agent creates,
// changes or replaces a file there. Exit 2 blocks the tool call and returns the message to the agent.
//
// Limit: this covers the file-editing tools only. A shell command can still write there; git shows it.
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname, basename } from 'node:path';

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch { process.exit(0); }

const target = input?.tool_input?.file_path || input?.tool_input?.notebook_path;
if (!target) process.exit(0);

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
if (!/^sdlc\/runs\/[^/]+\/decisions(\/|$)/.test(key)) process.exit(0);

console.error(`Owner decision file write blocked: ${rel}`);
console.error('Files in decisions/ are the owner\'s replies, saved by scripts/board-server.mjs when the owner pressed "Send to Orchestrator". No agent writes them.');
console.error('Record the decisions in clarification.md and cite the file as evidence. If you need the owner to decide or correct something, ask in your report.');
process.exit(2);
