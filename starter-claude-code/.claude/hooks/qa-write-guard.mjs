#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// PreToolUse hook for the qa-engineer subagent (wired in .claude/agents/qa-engineer.md).
// The QA Engineer may create or change only test files and files under sdlc/runs/<runId>/, except the run
// manifest, the test lock, the test calibration and the reproduction of a bug run.
// Exit 2 blocks the tool call and returns the message on stderr to the agent.
//
// Test files are recognised by the usual conventions of JS/TS, Python, Go, Java/Kotlin, .NET, Swift, Android,
// Ruby, Dart and PHP, and by the globs listed under "## Test file locations" in .orchestra/project.md.
//
// Limit: this covers the file-editing tools only. A shell command can still write any file,
// so the Orchestrator's git check after the QA step stays in place.
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname, basename } from 'node:path';

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch { console.error('qa-write-guard: hook input is not JSON; blocking the write.'); process.exit(2); }

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
  console.error(`QA Engineer write blocked: ${rel || target}`);
  console.error(reason);
  console.error('Allowed: test files, files under sdlc/runs/<runId>/, and the test file locations listed in .orchestra/project.md. Do not change application code; report the defect with reproduction steps and evidence instead. If this is a test file in a location the profile does not list yet, report it so the owner can add it.');
  process.exit(2);
}

if (rel.startsWith('..') || isAbsolute(rel) || inside === null) block('The path is outside the repository, or leads out of it through a link.');

// The run manifest belongs to the Orchestrator; a specialist must not move a gate or a stage.
if (/^sdlc\/runs\/[^/]+\/run\.json$/.test(key)) block('The run manifest is owned by the Orchestrator.');
// The lock, the calibration and the reproduction judge the QA Engineer's own tests, so they are not the QA
// Engineer's to write.
if (/^sdlc\/runs\/[^/]+\/evidence\/(test-lock|test-calibration|reproduction)\.json$/.test(key)) block('The test lock, the test calibration and the reproduction are written by scripts/lock-tests.mjs, which the Orchestrator runs. No agent edits them.');

const inRunFolder = /^sdlc\/runs\/[^/]+\/.+/.test(key);
// Folders: tests/, test/, __tests__/, e2e/, spec(s)/, androidTest/, testFixtures/, and folders whose name ends in
// Test or Tests (.NET test projects such as App.Tests or App.UnitTests, Xcode targets such as AppTests or AppUITests).
// Spec Kit keeps its feature documents in a top-level specs/ folder: where it is installed (.specify/ at the root),
// that folder is not a test folder, and a file in it passes only as a test by its own name or by the profile.
// The real path, plain, is what the checks below read: a name in other letters, or a link, is the file it leads to.
const specKitDocs = existsSync(resolve(root, '.specify')) && /^specs\//.test(plain);
const inTestFolder = !specKitDocs && /(^|\/)(tests?|__tests__|e2e|specs?|androidTest|testFixtures|[^/]*Tests?)\//.test(plain);
const isTestFile = /\.(test|spec)\.[cm]?[jt]sx?$/.test(plain)
  || /(^|\/)test_[^/]+\.py$/.test(plain)
  || /_test\.(py|go|dart|exs)$/.test(plain)
  || /_spec\.rb$/.test(plain)
  || /(^|\/)[A-Z][^/]*(Test|Tests|Spec|IT)\.(java|kt|kts|scala|groovy|cs|fs|vb|swift|php)$/.test(plain);

// Extra locations the project declares: backticked globs in the "## Test file locations" section of its profile.
function projectGlobs() {
  let text = '';
  try { text = readFileSync(resolve(root, '.orchestra/project.md'), 'utf8'); } catch { return []; }
  const section = text.match(/^##\s+Test file locations\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!section) return [];
  return [...section[1].matchAll(/^\s*[-*]\s+`([^`]+)`/gm)].map((m) => m[1].trim()).filter((g) => g && !g.startsWith('<'));
}
function globToRegex(glob) {
  const body = glob.replace(/^\.?\//, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*$/, '\u0001')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${body}$`);
}
const declared = projectGlobs().some((g) => { try { return globToRegex(g).test(plain); } catch { return false; } });

if (inRunFolder || inTestFolder || isTestFile || declared) process.exit(0);
block('It is neither a test file nor part of the run folder.');
