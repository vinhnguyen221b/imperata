#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// Test lock of an Imperata run. Once the QA Engineer has tested, the test files of the run are no longer
// the Developer's to change: a repair that makes a test pass by editing, deleting or skipping it proves nothing.
// Its name matches none of the files Node's test runner runs by default (`test-*.mjs`, `*-test.mjs` and the
// like): a name such as scripts/test-lock.mjs would make `node --test` of a project run it as a failing test.
//
//   node scripts/lock-tests.mjs record   <runId> [--base <ref>] [<test file> ...]
//   node scripts/lock-tests.mjs check     <runId>
//   node scripts/lock-tests.mjs calibrate <runId> --cmd "<command for one test file>" [--base <ref>]
//                                        [--suite "<command for all tests>"] [--repeat <n>]
//                                        [--link <path>] [--setup "<command>"] [--control <test file>] [--no-control]
//                                        [--guard <test file>] [--timeout <seconds>] [<test file> ...]
//   node scripts/lock-tests.mjs reproduce <runId> --cmd "<command for one test file>" [--control <test file>]
//                                        [--no-control] [--timeout <seconds>] <test file> ...
//
// record  writes sdlc/runs/<runId>/evidence/test-lock.json: the SHA-256 of every test file this run added or
//         changed. Without file arguments the files are found with git: everything that differs from the
//         merge base with the main branch (or --base), plus untracked files, kept when it is a test file by
//         the usual conventions or by the "## Test file locations" globs of .orchestra/project.md. File
//         arguments are added to that list. The Orchestrator runs it after each QA step it has accepted.
// check   compares the files with the lock. Exit 1 lists every locked file that changed or is gone.
// calibrate  asks whether the locked tests test the run's change: a test that also passes on the code as it
//         was before the run proves nothing about the run. Each locked test file is run with --cmd, in which
//         {file}, {dir} or {name} stands for the file: first here, where it must pass, then in a temporary
//         checkout of the base commit with the run's locked files copied in, where it must fail. Without
//         file arguments that is every locked file that is a test file by its own name or by a glob of the
//         project profile; a file that is one only by its folder may be a helper and is run only when named.
//         The result goes to sdlc/runs/<runId>/evidence/test-calibration.json:
//           DEPENDS_ON_CHANGE      passes here, fails on the base
//           PASSES_WITHOUT_CHANGE  passes here and on the base: it does not test the run's change (exit 1)
//           GUARD                  the same, for a file named with --guard: the test plan declares that it
//                                  must pass without the change (a regression guard, or a support file)
//           NOT_CALIBRATED         does not pass here with this command, or did not finish
//         A fresh checkout often lacks what tests need: --link <path> links a path of this checkout into it
//         (node_modules, .venv; a folder entry by entry, a workspace package at its base version), --setup
//         "<command>" runs there first (npm ci). To tell a base that fails
//         the test from a base that cannot run tests at all, a control is run first: a test file the run did
//         not touch, which passes here, must pass on the base too (--control names it, --no-control skips
//         it). Exit 2 when calibration could not be done. The Orchestrator runs it once the run's tests pass.
//         --suite "<command>" runs the whole suite here first, --repeat times (5 by default), as the test evidence
//         is produced: a test must give the same verdict every time, and one that fails only under the load of
//         the others can pass every time on its own. The exit codes go to "suites" in the same file. Runs of one
//         command add up across calls until the lock is recorded again, so running it again until every run
//         passes does not clear a failure. A suite that fails in some runs and passes in others exits 1; one
//         that fails in every run of the call stops calibration (exit 2).
// reproduce  for a bug run (kind: bug), before the specification is approved: shows the reported behaviour on
//         the code as committed. Each named test file, written by the QA Engineer to check the expected
//         behaviour, is run with --cmd on this checkout, where it must fail. Application code that differs from
//         HEAD stops it (exit 2): the bug is shown on the code nobody has changed yet. A control, a test file
//         that passes here (--control, or one the script picks), shows that the command runs tests at all.
//         The result goes to sdlc/runs/<runId>/evidence/reproduction.json, with the commit:
//           REPRODUCED      fails here: the bug is there
//           NOT_REPRODUCED  passes here: this test does not show the bug (exit 1)
//           DID_NOT_RUN     did not finish (exit 1)
//         The Orchestrator records the lock after this QA step as after any other, so the Developer does not
//         change the test that showed the bug; calibration later shows it passes with the fix and fails without.
//
// scripts/validate-gates.mjs makes the same comparison as check, so a run cannot reach review or acceptance
// with a test that changed after QA, and it reads the calibration: a locked file that passes without the
// change keeps the run out of review. In Claude Code a hook also keeps the Developer's file tools off locked
// files.
//
// Limits: the lock says that the files are the ones QA last worked with, not that the tests are good. The
// lock is a file in the repository, so whoever can write it can re-record it; the rules allow that only
// after a QA step. Calibration judges a whole file by the exit code of one command: a file with one real
// test hides an empty one beside it, and a file may fail on the base because something it imports is
// missing, not because an assertion caught the missing behaviour. It finds the test that cannot fail; it
// does not show that a test checks the right thing. Repeating the suite finds a test that does not give the
// same verdict only when it fails in one of the runs: one that fails once in twenty runs most often passes
// five. A reproduction counts any failure as the bug: a test
// that fails for another reason (a syntax error, an import the code lacks) reads REPRODUCED as well, and its
// last output lines are kept for whoever reads it. --cmd and --setup are run by the shell. Run from the
// repository root.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, lstatSync, readdirSync, realpathSync, mkdtempSync, rmSync, copyFileSync, symlinkSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = process.cwd();
const [cmd, runId, ...rest] = process.argv.slice(2);
function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: node scripts/lock-tests.mjs record <runId> [--base <ref>] [<test file> ...]');
  console.error('       node scripts/lock-tests.mjs check <runId>');
  console.error('       node scripts/lock-tests.mjs calibrate <runId> --cmd "<command with {file}>" [--base <ref>] [--link <path>]');
  console.error('                                    [--suite "<command for all tests>"] [--repeat <n>]');
  console.error('                                    [--setup "<command>"] [--control <test file>] [--no-control]');
  console.error('                                    [--guard <test file>] [--timeout <seconds>] [<test file> ...]');
  console.error('       node scripts/lock-tests.mjs reproduce <runId> --cmd "<command with {file}>" [--control <test file>]');
  console.error('                                    [--no-control] [--timeout <seconds>] <test file> ...');
  process.exit(2);
}
if (!['record', 'check', 'calibrate', 'reproduce'].includes(cmd) || !runId || /[\\/]|^\.\.?$/.test(runId)) usage();
const runDir = `sdlc/runs/${runId}`;
if (!existsSync(resolve(root, runDir, 'run.json'))) usage(`No run manifest at ${runDir}/run.json. Run from the repository root.`);
const lockRel = `${runDir}/evidence/test-lock.json`;
const lockAbs = resolve(root, lockRel);
const calRel = `${runDir}/evidence/test-calibration.json`;
const calAbs = resolve(root, calRel);
const repRel = `${runDir}/evidence/reproduction.json`;
const repAbs = resolve(root, repRel);

const sha = (rel) => createHash('sha256').update(readFileSync(resolve(root, rel))).digest('hex');
const isFile = (rel) => { try { return statSync(resolve(root, rel)).isFile(); } catch { return false; } };
const toRel = (p) => relative(root, isAbsolute(p) ? p : resolve(root, p)).split(sep).join('/');
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// The paths git lists, as they are: NUL-separated (-z), so that git neither quotes nor escapes them. Otherwise a
// test file named tests/giá.test.mjs comes out as "tests/gi\303\241.test.mjs", is no file, and is left out of the
// lock without a word, so a later edit of it passes `check`.
const gitList = (args) => execFileSync('git', [...args.slice(0, 1), '-z', ...args.slice(1)], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
const gitError = (e) => String(e.stderr || e.message).trim().split('\n')[0];

// The same conventions as the QA Engineer's write guard (.claude/hooks/qa-write-guard.mjs).
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
const declared = projectGlobs().map((g) => { try { return globToRegex(g); } catch { return null; } }).filter(Boolean);
// A test file by its own name, whatever folder it is in. A file that is one only by its folder may be a helper.
function isTestByName(rel) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel)
    || /(^|\/)test_[^/]+\.py$/.test(rel)
    || /_test\.(py|go|dart|exs)$/.test(rel)
    || /_spec\.rb$/.test(rel)
    || /(^|\/)[A-Z][^/]*(Test|Tests|Spec|IT)\.(java|kt|kts|scala|groovy|cs|fs|vb|swift|php)$/.test(rel);
}
// Spec Kit keeps its feature documents in a top-level specs/ folder. Where it is installed (.specify/ at the
// root), that folder is not a test folder; a file in it can still be a test by its own name or by the profile.
const specKit = existsSync(join(root, '.specify'));
function isTestFile(rel) {
  if (/^sdlc\//.test(rel)) return false;
  const specKitDocs = specKit && /^specs\//.test(rel);
  return (!specKitDocs && /(^|\/)(tests?|__tests__|e2e|specs?|androidTest|testFixtures|[^/]*Tests?)\//.test(rel))
    || isTestByName(rel)
    || declared.some((re) => re.test(rel));
}

function readLock() {
  let lock;
  try { lock = JSON.parse(readFileSync(lockAbs, 'utf8')); }
  catch (e) { console.error(`Cannot read ${lockRel}: ${e.message}`); process.exit(2); }
  if (!lock || typeof lock.files !== 'object' || !lock.files) { console.error(`${lockRel} has no "files" object.`); process.exit(2); }
  return lock;
}

// The commit the run's work started from: the merge base of HEAD with the main branch, or with the ref given.
function findBase(ref) {
  if (!ref) {
    const candidates = [];
    try { candidates.push(git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])); } catch { /* no remote head */ }
    candidates.push('main', 'master');
    ref = candidates.find((c) => { try { git(['rev-parse', '--verify', '--quiet', `${c}^{commit}`]); return true; } catch { return false; } }) || null;
  }
  if (!ref) throw new Error('no main branch found; name one with --base');
  return { ref, mergeBase: git(['merge-base', 'HEAD', ref]) };
}

// One command per file. A path goes in bare when it is plain, in double quotes otherwise, and not at all
// when it holds a character that a shell would expand inside double quotes.
const UNSAFE = /["$`\\!%\r\n]/;
const word = (s) => (/^[\w./@+=,-]+$/.test(s) ? s : `"${s}"`);
function commandWith(template, f) {
  const leaf = f.split('/').pop();
  const part = { file: f, dir: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.', name: leaf.replace(/\.[^.]+$/, '') };
  return template.replace(/\{(file|dir|name)\}/g, (_, k) => word(part[k]));
}
const tail = (text) => text.split(/\r?\n/).filter((line) => line.trim()).slice(-10).join('\n').slice(-800).trim();
function runShell(command, cwd, seconds) {
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', timeout: seconds * 1000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.error ? null : r.status, timedOut: r.error?.code === 'ETIMEDOUT', tail: tail(`${r.stdout || ''}\n${r.stderr || ''}`) };
}
const exitText = (r) => (r.timedOut ? 'timed out' : `exit ${r.code ?? 'none'}`);

if (cmd === 'check') {
  if (!existsSync(lockAbs)) { console.error(`No test lock for ${runId} (${lockRel}). Record one after the QA step: node scripts/lock-tests.mjs record ${runId}`); process.exit(1); }
  const lock = readLock();
  const bad = [];
  for (const [rel, hash] of Object.entries(lock.files)) {
    if (!isFile(rel)) bad.push(`${rel}: deleted`);
    else if (sha(rel) !== hash) bad.push(`${rel}: changed`);
  }
  if (bad.length) {
    console.error(`TEST LOCK BROKEN for ${runId}: ${bad.length} of ${Object.keys(lock.files).length} locked test file(s) differ from the lock recorded ${lock.recordedAt}`);
    for (const b of bad) console.error(`- ${b}`);
    console.error('A locked test file is changed only by the QA Engineer. Restore these files, or have the QA Engineer decide on the change and record the lock again after that step.');
    process.exit(1);
  }
  console.log(`Test lock holds for ${runId}: ${Object.keys(lock.files).length} test file(s) unchanged since ${lock.recordedAt}.`);
  process.exit(0);
}

if (cmd === 'calibrate') {
  const opt = { cmd: null, base: null, suite: null, repeat: null, links: [], setup: null, control: null, noControl: false, guards: [], timeout: 300, files: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const value = () => { i += 1; if (rest[i] === undefined) usage(`${a} needs a value`); return rest[i]; };
    if (a === '--cmd') opt.cmd = value();
    else if (a === '--base') opt.base = value();
    else if (a === '--suite') opt.suite = value();
    else if (a === '--repeat') { opt.repeat = Number(value()); if (!Number.isInteger(opt.repeat) || opt.repeat < 2) usage('--repeat needs a whole number of 2 or more'); }
    else if (a === '--link') opt.links.push(toRel(value()));
    else if (a === '--setup') opt.setup = value();
    else if (a === '--control') opt.control = toRel(value());
    else if (a === '--no-control') opt.noControl = true;
    else if (a === '--guard') opt.guards.push(toRel(value()));
    else if (a === '--timeout') { opt.timeout = Number(value()); if (!(opt.timeout > 0)) usage('--timeout needs a number of seconds'); }
    else if (a.startsWith('--')) usage(`Unknown option ${a}`);
    else opt.files.push(toRel(a));
  }
  if (!opt.cmd || !/\{(file|dir|name)\}/.test(opt.cmd)) usage('calibrate needs --cmd "<command>" with {file}, {dir} or {name} where the test file goes, for example --cmd "npx vitest run {file}".');
  if (opt.repeat !== null && !opt.suite) usage('--repeat counts the runs of the whole suite; give its command with --suite "<command>", for example --suite "npx vitest run".');
  const repeat = opt.repeat ?? 5;
  const stop = (msg) => { console.error(`Cannot calibrate the tests of ${runId}: ${msg}`); process.exit(2); };

  if (!existsSync(lockAbs)) stop(`no test lock (${lockRel}). Record one after the QA step: node scripts/lock-tests.mjs record ${runId}`);
  const lock = readLock();
  const locked = Object.keys(lock.files).sort();
  const broken = locked.filter((f) => !isFile(f) || sha(f) !== lock.files[f]);
  if (broken.length) stop(`the test lock does not hold (${broken.slice(0, 5).join(', ')}${broken.length > 5 ? ', ...' : ''}). Calibration reads the locked files; see node scripts/lock-tests.mjs check ${runId}`);
  const unknown = [...opt.files, ...opt.guards].filter((f) => !(f in lock.files));
  if (unknown.length) stop(`not in the test lock: ${unknown.join(', ')}`);
  // Unless files are named, only what is a test file by its own name or by a glob of the project profile is
  // run. A locked file that is one only by its folder (tests/helpers/…) is as likely a helper or a fixture,
  // and some runners report success for a file that holds no test.
  const runnable = (f) => isTestByName(f) || declared.some((re) => re.test(f));
  const targets = opt.files.length ? [...new Set([...opt.files, ...opt.guards])].sort() : locked.filter(runnable);
  const byFolderOnly = opt.files.length ? [] : locked.filter((f) => !runnable(f));
  if (!locked.length) stop('the test lock holds no file');
  if (!targets.length) stop(`no locked file is a test file by its own name; name the files to calibrate: node scripts/lock-tests.mjs calibrate ${runId} --cmd "..." <test file> ...`);

  let baseSha;
  try {
    let fromLock = null;
    if (!opt.base && typeof lock.base === 'string') { try { fromLock = git(['rev-parse', '--verify', '--quiet', `${lock.base}^{commit}`]); } catch { /* the lock's base is not in this clone */ } }
    baseSha = fromLock || findBase(opt.base).mergeBase;
  } catch (e) { stop(`no base commit (${gitError(e)}). Name the commit the run started from: --base <ref>`); }
  let changed;
  let untracked;
  try {
    changed = new Set(gitList(['diff', '--name-only', baseSha]));
    untracked = gitList(['ls-files', '--others', '--exclude-standard']);
  } catch (e) { stop(`git could not compare this checkout with ${baseSha.slice(0, 10)} (${gitError(e)})`); }
  // Nothing but run artifacts differs: the base would be the code with the change, and every test would pass there.
  if (![...changed, ...untracked].some((f) => !/^sdlc\//.test(f))) stop(`this checkout does not differ from the base ${baseSha.slice(0, 10)}. Name the commit before the run's work: --base <ref>`);

  const commandFor = (f) => commandWith(opt.cmd, f);
  const run = (command, cwd, seconds = opt.timeout) => runShell(command, cwd, seconds);
  const exit = exitText;
  let earlierCal = {};
  try { earlierCal = JSON.parse(readFileSync(calAbs, 'utf8')) || {}; } catch { /* first calibration */ }

  // The whole suite, run several times here, as the test evidence is produced. Earlier runs of the same
  // command on the same lock count with this call's, so a failure stays until the lock is recorded again.
  const lockAt = lock.recordedAt ?? null;
  const sameLock = (s) => s && typeof s.command === 'string' && Array.isArray(s.exits) && s.lockRecordedAt === lockAt;
  const suites = (Array.isArray(earlierCal.suites) ? earlierCal.suites : []).filter((s) => sameLock(s) && s.command !== opt.suite);
  let suite = null;
  if (opt.suite) {
    console.log(`Running the whole suite ${repeat} times here: ${opt.suite}`);
    const runs = [];
    for (let i = 0; i < repeat; i += 1) runs.push(run(opt.suite, root));
    const failedRuns = runs.filter((r) => r.code !== 0);
    if (failedRuns.length === runs.length) stop(`the whole suite does not pass here: it failed in each of ${runs.length} run(s) (${exit(runs[0])}). Calibrate once the run's tests pass, with the command that runs all of them.${runs[0].tail ? `\n${runs[0].tail}` : ''}`);
    const before = (Array.isArray(earlierCal.suites) ? earlierCal.suites : []).find((s) => sameLock(s) && s.command === opt.suite);
    const tailOfFailure = failedRuns[0]?.tail || before?.failedOutputTail;
    suite = {
      command: opt.suite,
      exits: [...(before ? before.exits : []), ...runs.map((r) => (r.timedOut ? null : r.code))],
      lockRecordedAt: lockAt, at: null,
      ...(tailOfFailure ? { failedOutputTail: tailOfFailure } : {}),
    };
    suites.push(suite);
  }

  console.log(`Calibrating ${targets.length} locked test file(s) of ${runId} against the base ${baseSha.slice(0, 10)}.`);
  const here = {};
  const skipped = {};
  for (const f of targets) {
    if (UNSAFE.test(f)) skipped[f] = 'the path holds a character a command line cannot carry safely';
    else here[f] = run(commandFor(f), root);
  }
  const passing = targets.filter((f) => here[f]?.code === 0);
  if (!passing.length) {
    const first = targets.find((f) => here[f]);
    stop(`none of the ${targets.length} file(s) passes here with this command${first ? ` (${first}: ${exit(here[first])})` : ''}. Calibrate once the run's tests pass, with the command that runs one test file.${first && here[first].tail ? `\n${here[first].tail}` : ''}`);
  }

  // The base checkout: a detached worktree outside the repository, so that no tool walking up from it finds
  // this checkout's configuration.
  const work = mkdtempSync(join(tmpdir(), 'imperata-base-'));
  let added = false;
  const cleanup = () => {
    if (added) { try { git(['worktree', 'remove', '--force', work]); } catch { /* removed below */ } }
    try { rmSync(work, { recursive: true, force: true }); } catch { /* left for the system to clear */ }
    try { git(['worktree', 'prune']); } catch { /* nothing to prune */ }
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { cleanup(); process.exit(130); });
  class Stop extends Error {}
  const base = {};
  let control = null;
  try {
    try { git(['worktree', 'add', '--detach', work, baseSha]); added = true; }
    catch (e) { throw new Stop(`git could not check out the base ${baseSha.slice(0, 10)} (${gitError(e)})`); }
    for (const l of opt.links) {
      const src = resolve(root, l);
      const dst = resolve(work, l);
      if (l.startsWith('..') || !existsSync(src)) throw new Stop(`--link ${l}: not found in this checkout`);
      if (existsSync(dst)) continue; // tracked at the base: the base has its own
      mkdirSync(dirname(dst), { recursive: true });
      if (!statSync(src).isDirectory()) { symlinkSync(src, dst, 'file'); continue; }
      // A folder is linked entry by entry, one level deeper in a scope folder (@scope/name). An entry that is a link
      // into this repository, as npm, pnpm and yarn workspaces make node_modules/<package> point at
      // packages/<package>, is pointed at the same path of the base checkout, where that package is as it was before
      // the run. Linked as a whole, node_modules would lead the base checkout to the workspace package with the
      // run's change in it, and a test that depends on the change would read PASSES_WITHOUT_CHANGE. This follows
      // links into the repository at the first level and in scope folders only. It cannot tell a package that the
      // base checkout would have built differently.
      const realRoot = realpathSync(root);
      const linkEntry = (from, to) => {
        let target = from;
        if (lstatSync(from).isSymbolicLink()) {
          let real = null;
          try { real = realpathSync(from); } catch { real = null; }
          if (real && real.startsWith(realRoot + sep)) target = join(work, relative(realRoot, real));
        }
        let dir = false;
        try { dir = statSync(existsSync(target) ? target : from).isDirectory(); } catch { dir = false; }
        symlinkSync(target, to, dir ? 'junction' : 'file');
      };
      mkdirSync(dst, { recursive: true });
      for (const entry of readdirSync(src, { withFileTypes: true })) {
        const from = join(src, entry.name);
        const to = join(dst, entry.name);
        if (entry.name.startsWith('@') && entry.isDirectory()) {
          mkdirSync(to, { recursive: true });
          for (const inner of readdirSync(from)) linkEntry(join(from, inner), join(to, inner));
        } else linkEntry(from, to);
      }
    }
    if (opt.setup) {
      const s = run(opt.setup, work, Math.max(opt.timeout, 1800));
      if (s.code !== 0) throw new Stop(`--setup did not succeed in the base checkout (${exit(s)}).\n${s.tail}`);
    }

    // Control, before the run's files are copied in: a test file the run did not touch, which passes here,
    // must pass on the base as well. Otherwise every failure there may come from the environment.
    if (!opt.noControl) {
      let candidates = [opt.control];
      if (!opt.control) {
        const exts = new Set(targets.map((f) => f.slice(f.lastIndexOf('.'))));
        candidates = gitList(['ls-tree', '-r', '--name-only', baseSha])
          .filter((f) => f && !(f in lock.files) && !changed.has(f) && isTestFile(f) && isTestByName(f) && isFile(f) && !UNSAFE.test(f))
          .sort((a, b) => Number(exts.has(b.slice(b.lastIndexOf('.')))) - Number(exts.has(a.slice(a.lastIndexOf('.')))))
          .slice(0, 3);
      }
      for (const c of candidates) {
        if (!isFile(c)) throw new Stop(`--control ${c}: not a file in this checkout`);
        if (UNSAFE.test(c)) throw new Stop(`--control ${c}: the path holds a character a command line cannot carry safely`);
        const h = run(commandFor(c), root);
        if (h.code !== 0) {
          if (opt.control) throw new Stop(`--control ${c} does not pass here (${exit(h)}); name a test file that passes and that the run did not change`);
          continue;
        }
        const b = run(commandFor(c), work);
        if (b.code !== 0) throw new Stop(`the base checkout cannot run a test that passes here and that the run did not touch: ${c} (${exit(b)}). It most likely lacks installed dependencies: add --link <path> (for example node_modules) or --setup "<install command>". If that test really fails on the base, name another with --control, or pass --no-control.\n${b.tail}`);
        control = c;
        break;
      }
    }

    for (const f of locked) {
      const dst = resolve(work, f);
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(resolve(root, f), dst);
    }
    for (const f of passing) base[f] = run(commandFor(f), work);
  } catch (e) {
    cleanup();
    if (e instanceof Stop) stop(e.message);
    throw e;
  }
  cleanup();

  const guards = new Set(opt.guards);
  const at = now();
  const results = {};
  for (const f of targets) {
    const h = here[f];
    const b = base[f];
    let result = 'NOT_CALIBRATED';
    let note = null;
    if (skipped[f]) note = skipped[f];
    else if (h.code !== 0) note = `does not pass here (${exit(h)})`;
    else if (b.code === null) note = `did not finish on the base (${exit(b)})`;
    else if (b.code === 0) result = guards.has(f) ? 'GUARD' : 'PASSES_WITHOUT_CHANGE';
    else { result = 'DEPENDS_ON_CHANGE'; if (guards.has(f)) note = 'named with --guard, but it fails on the base'; }
    results[f] = {
      sha256: lock.files[f], result,
      ...(skipped[f] ? {} : { command: commandFor(f), exitHere: h.code, exitOnBase: b ? b.code : null }),
      base: baseSha, control, at,
      ...(note ? { note } : {}),
      ...(result === 'DEPENDS_ON_CHANGE' && b.tail ? { baseOutputTail: b.tail } : {}),
    };
  }
  // Results of an earlier call stay while the file is still locked with the same content: a run with tests
  // on several stacks is calibrated one stack at a time.
  const earlier = (earlierCal.files && typeof earlierCal.files === 'object') ? earlierCal.files : {};
  const files = {};
  for (const f of locked) {
    if (results[f]) files[f] = results[f];
    else if (earlier[f] && earlier[f].sha256 === lock.files[f]) files[f] = earlier[f];
  }
  if (suite) suite.at = at;
  mkdirSync(dirname(calAbs), { recursive: true });
  writeFileSync(calAbs, `${JSON.stringify({ runId, calibratedAt: at, lockRecordedAt: lockAt, files, ...(suites.length ? { suites } : {}) }, null, 2)}\n`);

  const width = Math.max(...Object.values(results).map((r) => r.result.length));
  for (const f of targets) console.log(`- ${results[f].result.padEnd(width)}  ${f}${results[f].note ? `: ${results[f].note}` : ''}`);
  const count = (name) => targets.filter((f) => results[f].result === name).length;
  // Over the whole file, so that a result of an earlier call that still stands is not lost from sight.
  const empty = Object.keys(files).filter((f) => files[f].result === 'PASSES_WITHOUT_CHANGE');
  console.log(`${count('DEPENDS_ON_CHANGE')} of ${targets.length} file(s) pass here and fail on the base${count('GUARD') ? `, ${count('GUARD')} declared to pass on both` : ''}${count('NOT_CALIBRATED') ? `, ${count('NOT_CALIBRATED')} not calibrated` : ''}. Written to ${calRel}.`);
  if (control) console.log(`Control: ${control} passes here and on the base, so the base checkout can run tests.`);
  else console.log(`WARNING: no control${opt.noControl ? ' (--no-control)' : ': no test file that the run did not touch passes here'}. Nothing shows that the base checkout can run tests, so a failure there may come from the environment, or from code the base does not have yet (a repository with no code before the run fails every test). The files above are not shown to test the run's change: report this calibration under "Unproven".`);
  if (byFolderOnly.length) console.log(`Not run: ${byFolderOnly.length} locked file(s) that are test files only by their folder, so they may be helpers or fixtures: ${byFolderOnly.slice(0, 5).join(', ')}${byFolderOnly.length > 5 ? ', ...' : ''}. Name on the command line those that hold tests.`);
  const without = locked.filter((f) => !files[f]).length;
  if (without) console.log(`${without} of ${locked.length} locked file(s) have no calibration result.`);
  const failures = (s) => s.exits.filter((e) => e !== 0).length;
  for (const s of suites) if (!failures(s)) console.log(`Whole suite: passed in each of ${s.exits.length} run(s) since the lock was recorded (${s.command}).`);
  if (!suites.length) console.log('WARNING: the whole suite was not run more than once (--suite "<command for all tests>"), so nothing shows that the tests give the same verdict every time.');
  const unsteady = suites.filter((s) => failures(s));
  if (empty.length) {
    console.error(`TEST CALIBRATION FAILED for ${runId}: ${empty.length} locked test file(s) pass without the run's change, so they do not test it:`);
    for (const f of empty) console.error(`- ${f}${results[f] ? '' : ` (calibrated ${files[f].at})`}`);
    console.error('Have the QA Engineer make each one depend on the change, or declare it in the test plan as a file that must pass without the change (a regression guard, or a support file that holds no test). Then record the lock again and calibrate again, with --guard <file> for each declared file.');
  }
  if (unsteady.length) {
    console.error(`TESTS DO NOT GIVE THE SAME VERDICT for ${runId}: on the same code, the whole suite failed in some runs and passed in others:`);
    for (const s of unsteady) console.error(`- ${s.command}: failed in ${failures(s)} of ${s.exits.length} run(s)${s.failedOutputTail ? `. The end of a failed run:\n${s.failedOutputTail}` : ''}`);
    console.error('A test that does not give the same verdict every time proves nothing (.orchestra/test-rules.md). Have the QA Engineer find the test that failed and make it give the same verdict, or report the behaviour of the application that varies for the Developer to repair. Running the suite again does not clear this; after that step, record the lock again and calibrate again.');
  }
  process.exit(empty.length || unsteady.length ? 1 : 0);
}

if (cmd === 'reproduce') {
  const opt = { cmd: null, control: null, noControl: false, timeout: 300, files: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    const value = () => { i += 1; if (rest[i] === undefined) usage(`${a} needs a value`); return rest[i]; };
    if (a === '--cmd') opt.cmd = value();
    else if (a === '--control') opt.control = toRel(value());
    else if (a === '--no-control') opt.noControl = true;
    else if (a === '--timeout') { opt.timeout = Number(value()); if (!(opt.timeout > 0)) usage('--timeout needs a number of seconds'); }
    else if (a.startsWith('--')) usage(`Unknown option ${a}`);
    else opt.files.push(toRel(a));
  }
  if (!opt.cmd || !/\{(file|dir|name)\}/.test(opt.cmd)) usage('reproduce needs --cmd "<command>" with {file}, {dir} or {name} where the test file goes, for example --cmd "npx vitest run {file}".');
  const stop = (msg) => { console.error(`Cannot reproduce the bug of ${runId}: ${msg}`); process.exit(2); };
  const files = [...new Set(opt.files)].sort();
  if (!files.length) stop(`name the test file(s) that show the bug: node scripts/lock-tests.mjs reproduce ${runId} --cmd "..." <test file> ...`);
  for (const f of files) {
    if (f.startsWith('..')) stop(`${f} is outside the repository`);
    if (!isFile(f)) stop(`${f} is not a file`);
    if (!isTestFile(f)) stop(`${f} is not a test file by the usual conventions or by the test file locations of .orchestra/project.md`);
    if (UNSAFE.test(f)) stop(`${f}: the path holds a character a command line cannot carry safely`);
  }
  let commit;
  let modified;
  try {
    commit = git(['rev-parse', 'HEAD']);
    modified = gitList(['diff', '--name-only', 'HEAD']).filter((f) => f && !/^sdlc\//.test(f) && !isTestFile(f));
  } catch (e) { stop(`git could not name the commit to reproduce on (${gitError(e)})`); }
  // The bug is shown on the code as committed. Application code that differs from it would be something else,
  // perhaps a fix begun already.
  if (modified.length) stop(`files other than tests differ from ${commit.slice(0, 10)}: ${modified.slice(0, 5).join(', ')}${modified.length > 5 ? ', ...' : ''}. Reproduce on the code as committed, before anyone changes it`);

  // Control: a test file the run did not write, which passes here. Without one, a reproduction test that fails
  // may fail only because the command runs no test at all.
  let control = null;
  if (!opt.noControl) {
    let candidates = [opt.control];
    if (!opt.control) {
      const exts = new Set(files.map((f) => f.slice(f.lastIndexOf('.'))));
      candidates = gitList(['ls-files'])
        .filter((f) => f && !files.includes(f) && isTestFile(f) && isTestByName(f) && isFile(f) && !UNSAFE.test(f))
        .sort((a, b) => Number(exts.has(b.slice(b.lastIndexOf('.')))) - Number(exts.has(a.slice(a.lastIndexOf('.')))))
        .slice(0, 3);
    }
    for (const c of candidates) {
      if (!isFile(c)) stop(`--control ${c}: not a file in this checkout`);
      if (UNSAFE.test(c)) stop(`--control ${c}: the path holds a character a command line cannot carry safely`);
      const h = runShell(commandWith(opt.cmd, c), root, opt.timeout);
      if (h.code === 0) { control = c; break; }
      if (opt.control) stop(`--control ${c} does not pass here (${exitText(h)}). Name a test file that passes, so that a reproduction test that fails cannot fail only because the command runs no test.${h.tail ? `\n${h.tail}` : ''}`);
    }
  }

  const at = now();
  const results = {};
  for (const f of files) {
    const r = runShell(commandWith(opt.cmd, f), root, opt.timeout);
    const result = r.code === null ? 'DID_NOT_RUN' : r.code === 0 ? 'NOT_REPRODUCED' : 'REPRODUCED';
    results[f] = { sha256: sha(f), result, command: commandWith(opt.cmd, f), exit: r.code, ...(r.timedOut ? { note: 'timed out' } : {}), ...(r.tail ? { outputTail: r.tail } : {}) };
  }
  mkdirSync(dirname(repAbs), { recursive: true });
  writeFileSync(repAbs, `${JSON.stringify({ runId, reproducedAt: at, commit, control, files: results }, null, 2)}\n`);

  const width = Math.max(...Object.values(results).map((r) => r.result.length));
  for (const f of files) console.log(`- ${results[f].result.padEnd(width)}  ${f}: ${exitText({ code: results[f].exit, timedOut: Boolean(results[f].note) })}`);
  const shown = files.filter((f) => results[f].result === 'REPRODUCED');
  console.log(`${shown.length} of ${files.length} test file(s) fail on ${commit.slice(0, 10)}, the code as committed. Written to ${repRel}.`);
  if (control) console.log(`Control: ${control} passes here, so the command runs tests.`);
  else console.log(`WARNING: no control${opt.noControl ? ' (--no-control)' : ': no test file that the run did not write passes here'}. Nothing shows that the command runs tests, so a failure may come from the environment.`);
  console.log(`Set artifactPaths.reproduction to "${repRel}" in the run manifest. Whether a test fails for the reported reason was not checked; read its output.`);
  const notShown = files.filter((f) => results[f].result !== 'REPRODUCED');
  if (notShown.length) {
    console.error(`BUG NOT REPRODUCED for ${runId}: ${notShown.length} test file(s) did not fail on the code as committed:`);
    for (const f of notShown) console.error(`- ${f} (${results[f].result})`);
    console.error('No fix is planned for a bug nobody has shown. Have the QA Engineer check the test against the Defect section of the specification, or put the question to the owner.');
    process.exit(1);
  }
  process.exit(0);
}

// record
let base = null;
const given = [];
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i] === '--base') { i += 1; base = rest[i] || usage('--base needs a ref'); }
  else if (rest[i].startsWith('--')) usage(`Unknown option ${rest[i]}`);
  else given.push(toRel(rest[i]));
}
const found = new Set();
let how = '';
let baseCommit = null;
try {
  const { ref, mergeBase } = findBase(base);
  const changed = gitList(['diff', '--name-only', '--diff-filter=d', mergeBase]);
  const untracked = gitList(['ls-files', '--others', '--exclude-standard']);
  for (const f of [...changed, ...untracked]) if (f && isTestFile(f) && isFile(f)) found.add(f);
  how = `git: files that differ from ${mergeBase.slice(0, 10)} (merge base with ${ref}) and untracked files`;
  baseCommit = mergeBase;
} catch (e) {
  if (!given.length) {
    console.error(`Cannot find the run's test files with git (${gitError(e)}).`);
    console.error('Name them: node scripts/lock-tests.mjs record <runId> <test file> ...');
    process.exit(2);
  }
  how = 'the files named on the command line (git could not be asked)';
}
const problems = [];
for (const f of given) {
  if (f.startsWith('..')) problems.push(`${f}: outside the repository`);
  else if (!isFile(f)) problems.push(`${f}: not a file`);
  else if (/^sdlc\//.test(f)) problems.push(`${f}: a run artifact, not a test file`);
  else found.add(f);
}
if (problems.length) { console.error('Cannot record the test lock:'); for (const p of problems) console.error(`- ${p}`); process.exit(2); }

// Markers that switch a test off or narrow a run to a few tests. Reported, not judged: QA may have a reason.
const SKIP = /\b(?:it|test|describe|context)\.(?:skip|only|todo)\b|\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(|@(?:Ignore|Disabled)\b|pytest\.mark\.(?:skip|skipif|xfail)|unittest\.skip|\bt\.Skip(?:f|Now)?\(|\[Ignore\b|Skip\s*=\s*"/;
const files = {};
const skipping = [];
for (const f of [...found].sort()) {
  files[f] = sha(f);
  try { if (SKIP.test(readFileSync(resolve(root, f), 'utf8'))) skipping.push(f); } catch { /* binary fixture */ }
}
const previous = existsSync(lockAbs) ? readLock() : null;
// base: the commit the run's work is compared with; calibrate checks the tests against it.
const lock = { runId, recordedAt: now(), found: how, ...(baseCommit ? { base: baseCommit } : {}), files, skipMarkers: skipping };
mkdirSync(dirname(lockAbs), { recursive: true });
writeFileSync(lockAbs, `${JSON.stringify(lock, null, 2)}\n`);

const n = Object.keys(files).length;
console.log(`Test lock recorded for ${runId}: ${n} test file(s) in ${lockRel}.`);
console.log(`Found by ${how}${given.length ? `, plus ${given.length} named file(s)` : ''}.`);
if (previous) {
  const dropped = Object.keys(previous.files).filter((f) => !(f in files));
  const changed = Object.keys(previous.files).filter((f) => f in files && files[f] !== previous.files[f]);
  if (changed.length) console.log(`Changed since the previous lock (${previous.recordedAt}): ${changed.join(', ')}`);
  if (dropped.length) console.log(`WARNING: no longer locked, because the file is gone or no longer differs from the base: ${dropped.join(', ')}`);
}
if (skipping.length) console.log(`WARNING: ${skipping.length} locked file(s) carry a skip, only or ignore marker: ${skipping.join(', ')}`);
if (!n) console.log('WARNING: the lock holds no file. If the run has tests, name them: node scripts/lock-tests.mjs record <runId> <test file> ...');
console.log(`Set artifactPaths.testLock to "${lockRel}" in the run manifest.`);
