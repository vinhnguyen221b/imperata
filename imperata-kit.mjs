#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// Install, update and check the Imperata kit in a project repository.
//
//   node <kit>/imperata-kit.mjs install <repo> [--tools claude,copilot] [--profile <file>] [--dry-run] [--force]
//   node <kit>/imperata-kit.mjs update  <repo> [--dry-run] [--force]
//   node <kit>/imperata-kit.mjs status  <repo>
//
// <kit> is the folder that holds this script and kit.json. kit.json says which file goes where, for which agent
// tool, and who owns it afterwards:
//   kit      the kit's file: replaced on update, unless the project changed it (reported and kept; --force replaces)
//   project  created once (the project profile from --profile when given), then the project's file
//   lines    lines added to a project file when missing (.gitignore, the two imports in CLAUDE.md); in a .gitignore
//            before its first exception (!pattern), so that the exception still wins
//   json     keys and list items added to a project JSON file when missing (.claude/settings.json); a key of
//            another kind than the kit's is a conflict, kept unless --force
// The repository records what it received in .orchestra/installed.json: kit version and commit, the tools, and a
// hash of every kit-owned file, so an update can tell a file nobody touched from one the project changed. A file
// equal to any committed version of its kit source also counts as untouched. Nothing is committed: review the
// result with git.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, lstatSync, realpathSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, relative, dirname, sep, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const kitRoot = dirname(fileURLToPath(import.meta.url));
const kit = JSON.parse(readFileSync(join(kitRoot, 'kit.json'), 'utf8'));
const TOOLS = ['claude', 'copilot'];
const USAGE = `Usage:
  node imperata-kit.mjs install <repo> [--tools claude,copilot] [--profile <file>] [--dry-run] [--force]
  node imperata-kit.mjs update  <repo> [--dry-run] [--force]
  node imperata-kit.mjs status  <repo>`;
const fail = (msg, code = 2) => { console.error(msg); process.exit(code); };

const [cmd, target, ...rest] = process.argv.slice(2);
if (cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(0); }
if (!['install', 'update', 'status'].includes(cmd) || !target) fail(USAGE);
let tools = null;
let profilePath = null;
let dryRun = cmd === 'status';
let force = false;
for (let i = 0; i < rest.length; i += 1) {
  const a = rest[i];
  if (a === '--tools' && cmd === 'install') { tools = String(rest[i + 1] || '').split(',').map((t) => t.trim()).filter(Boolean); i += 1; }
  else if (a === '--profile' && cmd === 'install') { profilePath = rest[i + 1]; i += 1; }
  else if (a === '--dry-run') dryRun = true;
  else if (a === '--force' && cmd !== 'status') force = true;
  else fail(`Unknown or misplaced argument: ${a}\n${USAGE}`);
}

const repo = resolve(target);
if (!existsSync(repo) || !statSync(repo).isDirectory()) fail(`Not a directory: ${repo}`);
if (resolve(repo) === resolve(kitRoot) || resolve(repo).startsWith(resolve(kitRoot) + sep)) fail('The target is the kit itself; give the path of a project repository.');
const recordPath = join(repo, '.orchestra', 'installed.json');
// The record is read and written in place: a link there could lead the write to any file of the user's.
try { if (lstatSync(recordPath).isSymbolicLink()) fail('.orchestra/installed.json is a link; replace it with the file itself, then run again.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
let record = null;
if (existsSync(recordPath)) {
  try { record = JSON.parse(readFileSync(recordPath, 'utf8')); } catch (e) { fail(`.orchestra/installed.json cannot be read (${e.message})`); }
}
if (cmd !== 'install' && !record) fail(`${repo} has no .orchestra/installed.json. Run "install" first; it adopts files that came from the kit by hand.`);
// --tools adds to the tools a repository already has: dropping one would remove its files and leave the
// settings and imports that point at them. To stop using a tool, delete its files by hand.
if (tools && record?.tools) tools = [...new Set([...record.tools, ...tools])].sort((a, b) => TOOLS.indexOf(a) - TOOLS.indexOf(b));
tools = tools || record?.tools || TOOLS;
const badTool = tools.find((t) => !TOOLS.includes(t));
if (badTool || !tools.length) fail(`--tools takes claude, copilot or both (claude,copilot); got "${tools.join(',')}"`);
let profileContent = null;
if (profilePath) {
  try { profileContent = readFileSync(resolve(profilePath)); } catch (e) { fail(`--profile: ${e.message}`); }
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
// A text file as git writes it on a checkout with core.autocrlf=true, the default of Git for Windows: every line
// ends in CRLF. Compared only as it is, every kit file on such a clone would read as a CONFLICT to `update`, and
// `status` would never come clean, although nobody changed one. A file is compared as it is and with
// its CRLF turned into LF; a file holding a NUL byte is taken as binary and compared as it is. This cannot tell a
// file whose line endings a person changed on purpose from one git changed; git shows either.
const lf = (buf) => (buf.includes(0) || !buf.includes('\r\n') ? buf : Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));
const shas = (buf) => [...new Set([sha(buf), sha(lf(buf))])];
const posix = (p) => p.split(sep).join('/');

// ---- git history of the kit's sources ---------------------------------------------------------
const git = (args) => execFileSync('git', ['-C', kitRoot, ...args], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
let kitRepoRoot = null;
try { kitRepoRoot = git(['rev-parse', '--show-toplevel']).toString().trim(); } catch { /* the kit is not in a git repository */ }
// The repository around the kit is the kit's own only when it tracks the kit. A copy that npm or a tarball put
// inside a project (node_modules/, an ignored folder) has no history, and its remote and commit are the project's.
if (kitRepoRoot) { try { git(['ls-files', '--error-unmatch', '--', 'kit.json']); } catch { kitRepoRoot = null; } }
const historyCache = new Map();
function history(src) {
  if (historyCache.has(src)) return historyCache.get(src);
  const hashes = new Set();
  if (kitRepoRoot) {
    // `:(top)` makes the pathspec relative to the repository root, as `<commit>:<path>` is.
    const rel = posix(join(relative(kitRepoRoot, kitRoot), src));
    let commits = [];
    try { commits = git(['rev-list', 'HEAD', '--', `:(top)${rel}`]).toString().split('\n').filter(Boolean); } catch { /* no history */ }
    for (const c of commits) {
      try { hashes.add(sha(git(['show', `${c}:${rel}`]))); } catch { /* the file was deleted in that commit */ }
    }
  }
  historyCache.set(src, hashes);
  return hashes;
}

// ---- what the selected tools need ---------------------------------------------------------------
function expand(entry) {
  const abs = join(kitRoot, entry.src);
  if (!existsSync(abs)) fail(`kit.json names ${entry.src}, which is not in the kit.`);
  if (!statSync(abs).isDirectory()) return [entry];
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      if (n === '.DS_Store') continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p); else out.push(p);
    }
  };
  walk(abs);
  return out.map((p) => ({ ...entry, src: posix(relative(kitRoot, p)), dest: posix(join(entry.dest, relative(abs, p))) }));
}
const files = kit.entries.filter((e) => !e.tools || e.tools.some((t) => tools.includes(t))).flatMap(expand);
// A folder or file on the way may be a link out of the repository: follow the deepest part that exists.
const repoReal = realpathSync(repo);
const present = (p) => { try { lstatSync(p); return true; } catch { return false; } };
const destOf = (rel) => {
  const abs = resolve(repo, rel);
  if (!abs.startsWith(repo + sep)) fail(`kit.json path leaves the repository: ${rel}`);
  let p = abs;
  while (!present(p)) p = dirname(p);
  let real = null;
  try { real = realpathSync(p); } catch { /* a link that leads nowhere */ }
  if (!real || (real !== repoReal && !real.startsWith(repoReal + sep))) fail(`${rel} leads outside the repository through a link (${real ?? p}); remove the link, then install again.`);
  return abs;
};

// ---- JSON union: add what is missing, never change or remove what is there -----------------------
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
// What a value is, for a key the kit adds to: a list, an object, or another type.
const kindOf = (v) => (Array.isArray(v) ? 'a list' : v === null ? 'null' : typeof v === 'object' ? 'an object' : `a ${typeof v}`);
// A key the kit adds to whose value in the project is of another kind than the kit's (a string where the kit has a
// list, null where it has an object) cannot take the kit's entries. Otherwise a project's settings with "deny" as
// a string and "PreToolUse" as null would read as merged while the kit's whole deny list and the guard of the
// owner's decisions are missing, with no word of it. Such a key is a clash: listed in
// `clashes` and left as it is, or, with `replace` (--force), given the kit's value. A value of the same kind is
// never changed. This cannot tell whether a value of the right kind does what the kit's would.
function union(a, b, path = '', clashes = [], replace = false) {
  let added = 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (const item of b) {
      // Hook groups are matched by their matcher, so a hook the kit adds joins the existing group.
      const peer = item && typeof item === 'object' && 'matcher' in item ? a.find((x) => x && typeof x === 'object' && x.matcher === item.matcher) : null;
      if (peer) added += union(peer, item, `${path}[matcher ${item.matcher}]`, clashes, replace);
      else if (!a.some((x) => canon(x) === canon(item))) { a.push(item); added += 1; }
    }
  } else if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const [k, v] of Object.entries(b)) {
      const at = path ? `${path}.${k}` : k;
      if (!(k in a)) { a[k] = v; added += 1; continue; }
      const structured = v !== null && typeof v === 'object';
      if (structured && kindOf(a[k]) !== kindOf(v)) {
        clashes.push(`${at} is ${kindOf(a[k])}, the kit's is ${kindOf(v)}`);
        if (replace) { a[k] = v; added += 1; }
        continue;
      }
      added += union(a[k], v, at, clashes, replace);
    }
  }
  return added;
}

// ---- plan and apply ---------------------------------------------------------------------------
const actions = [];
const act = (kind, path, note = '') => actions.push({ kind, path, note });
const write = (abs, content) => { if (!dryRun) { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, content); } };
const newFiles = {};

for (const f of files) {
  const mode = f.mode || 'kit';
  const abs = destOf(f.dest);
  const content = f.profile && profileContent ? profileContent : readFileSync(join(kitRoot, f.src));
  const exists = existsSync(abs);
  if (mode === 'kit') {
    const hs = sha(content);
    if (!exists) { write(abs, content); act('add', f.dest); newFiles[f.dest] = hs; continue; }
    const hd = shas(readFileSync(abs));
    if (hd.includes(hs) || hd.includes(sha(lf(content)))) { act('same', f.dest); newFiles[f.dest] = hs; continue; }
    const untouched = hd.some((h) => record?.files?.[f.dest] === h || history(f.src).has(h));
    if (untouched || force) { write(abs, content); act(untouched ? 'update' : 'force', f.dest); newFiles[f.dest] = hs; }
    else { act('conflict', f.dest, 'changed in this repository, kept; merge the kit version by hand or rerun with --force'); if (record?.files?.[f.dest]) newFiles[f.dest] = record.files[f.dest]; }
  } else if (mode === 'project') {
    if (!exists) { write(abs, content); act('add', f.dest, f.profile ? (profileContent ? `from ${profilePath}` : 'template: fill it in') : 'now owned by the project'); }
    else act('keep', f.dest, f.profile && profileContent ? 'exists, so --profile was not applied' : 'owned by the project');
  } else if (mode === 'lines') {
    const text = content.toString('utf8');
    if (!exists) { write(abs, content); act('add', f.dest); continue; }
    const current = readFileSync(abs, 'utf8');
    const hd = shas(Buffer.from(current));
    if (!hd.includes(sha(content)) && !hd.includes(sha(lf(content))) && hd.some((h) => history(f.src).has(h))) { write(abs, content); act('update', f.dest, 'was an unchanged earlier kit version'); continue; }
    const have = new Set(current.split(/\r?\n/).map((l) => l.trim()));
    const missing = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('<!--') && !have.has(l));
    if (!missing.length) { act('same', f.dest); continue; }
    // In a .gitignore the last rule that matches a path wins, so the kit's lines appended after a project's
    // exception (`!pattern`) can ignore again what the project un-ignored: in a project .gitignore of `.env*` and
    // `!.env.example`, the kit's `.env.*` below the exception would ignore a new .env.example again. There the
    // kit's lines go in just before the project's first exception: every exception of
    // the project still comes after them and wins, and the project's own lines keep their order. Any other file of
    // this mode (CLAUDE.md's imports) gets them at its end. This cannot tell an exception the project no longer needs.
    const lines = current.split('\n');
    const firstException = basename(f.dest) === '.gitignore' ? lines.findIndex((l) => l.trim().startsWith('!')) : -1;
    if (firstException >= 0) {
      const block = [f.header, ...missing, ''];
      write(abs, [...lines.slice(0, firstException), ...block, ...lines.slice(firstException)].join('\n'));
      act('merge', f.dest, `added ${missing.length} line(s), before the project's first exception (!), which still wins`);
      continue;
    }
    write(abs, `${current}${current.endsWith('\n') || !current ? '' : '\n'}\n${f.header}\n${missing.join('\n')}\n`);
    act('merge', f.dest, `added ${missing.length} line(s)`);
  } else if (mode === 'json') {
    if (!exists) { write(abs, content); act('add', f.dest); continue; }
    let current;
    try { current = JSON.parse(readFileSync(abs, 'utf8')); } catch { act('conflict', f.dest, 'not valid JSON, so the kit settings were not merged'); continue; }
    const theirs = JSON.parse(content.toString('utf8'));
    // The clashes are found on a copy first, so that a file with one is left exactly as it is.
    const clashes = [];
    if (kindOf(current) !== kindOf(theirs)) clashes.push(`the file holds ${kindOf(current)}, the kit's ${kindOf(theirs)}`);
    else union(structuredClone(current), theirs, '', clashes, false);
    if (clashes.length && !force) { act('conflict', f.dest, `${clashes.join('; ')}: kept, and the kit settings were not merged; correct the key(s) by hand or rerun with --force, which gives them the kit's value`); continue; }
    let added;
    if (kindOf(current) !== kindOf(theirs)) { current = theirs; added = 1; }
    else added = union(current, theirs, '', [], force);
    if (!added) { act('same', f.dest); continue; }
    write(abs, `${JSON.stringify(current, null, 2)}\n`);
    act(clashes.length ? 'force' : 'merge', f.dest, clashes.length ? `${clashes.join('; ')}: given the kit's value; added ${added} setting(s)` : `added ${added} setting(s)`);
  } else fail(`kit.json: unknown mode "${mode}" for ${f.src}`);
}

// Files the kit no longer ships: removed when nobody changed them. A folder that a removal leaves empty goes
// too, up to the repository root, so a retired folder leaves no empty folders behind.
// A folder that still holds anything stays.
const pruneEmpty = (dir) => {
  while (dir.startsWith(repo + sep) && readdirSync(dir).length === 0) { rmdirSync(dir); dir = dirname(dir); }
};
const produced = new Set(files.map((f) => f.dest));
// The record is a file in the project: whoever can write it could name any file with its hash. So a removal is
// limited to a file git tracks, which git can always restore, in a folder the kit installs into, and never one
// under .git/ or owned by the project.
let tracked = new Set();
try { tracked = new Set(execFileSync('git', ['-C', repo, 'ls-files', '-z'], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).toString().split('\0').filter(Boolean)); } catch { /* not a git repository: nothing is removed */ }
const kitFolders = new Set(kit.entries.filter((e) => !['project', 'lines'].includes(e.mode) && e.dest.includes('/')).map((e) => e.dest.split('/')[0]));
const projectOwned = new Set([...kit.entries.filter((e) => e.mode === 'project').map((e) => e.dest), '.orchestra/installed.json']);
const removable = (dest) => tracked.has(dest) && kitFolders.has(dest.split('/')[0]) && !dest.split('/').includes('..') && !dest.startsWith('.git/') && !projectOwned.has(dest);
const retiredHistory = new Map((kit.retired || []).map((r) => [r.dest, r.history || []]));
const candidates = new Set([...retiredHistory.keys(), ...Object.keys(record?.files || {})]);
for (const dest of candidates) {
  if (produced.has(dest)) continue;
  const abs = destOf(dest);
  if (!existsSync(abs)) continue;
  const hd = shas(readFileSync(abs));
  const untouched = hd.some((h) => record?.files?.[dest] === h || (retiredHistory.get(dest) || []).some((src) => history(src).has(h)));
  if (untouched && !removable(dest)) act('keep', dest, 'named in .orchestra/installed.json, but not a file the kit removes (untracked, or outside the kit\'s folders); left as it is');
  else if (untouched) { if (!dryRun) { unlinkSync(abs); pruneEmpty(dirname(abs)); } act('remove', dest, 'no longer part of the kit, and unchanged'); }
  else act('keep', dest, 'no longer part of the kit, but changed here; delete it yourself once it is not needed');
}

// ---- record and report -------------------------------------------------------------------------
let commit = null;
let dirty = false;
let origin = null;
if (kitRepoRoot) {
  try { commit = git(['rev-parse', 'HEAD']).toString().trim(); } catch { /* no commit yet */ }
  try { dirty = git(['status', '--porcelain', '--', '.']).toString().trim().length > 0; } catch { /* unknown */ }
  try { origin = git(['remote', 'get-url', 'origin']).toString().trim().replace(/\/\/[^@/]+@/, '//'); } catch { /* no remote */ }
}
const changes = actions.filter((a) => !['same', 'keep'].includes(a.kind));
if (!dryRun) {
  const out = {
    kit: kit.name,
    version: kit.version,
    source: { repository: origin, path: kitRepoRoot ? posix(relative(kitRepoRoot, kitRoot)) || '.' : basename(kitRoot), commit, uncommittedChanges: dirty },
    tools,
    updatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    files: Object.fromEntries(Object.entries(newFiles).sort(([x], [y]) => x.localeCompare(y))),
  };
  // Nothing but the time would differ: keep the record as it is, so that an update that changed nothing leaves no change.
  const same = record && JSON.stringify({ ...record, updatedAt: null }) === JSON.stringify({ ...out, updatedAt: null });
  if (!same) {
    destOf('.orchestra/installed.json');
  mkdirSync(dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, `${JSON.stringify(out, null, 2)}\n`);
  }
}

const LABEL = { add: 'added', update: 'updated', force: 'replaced (--force)', merge: 'merged', remove: 'removed', conflict: 'CONFLICT', keep: 'kept', same: 'up to date' };
const order = ['conflict', 'add', 'update', 'force', 'merge', 'remove', 'keep'];
console.log(`${kit.name} ${kit.version} → ${repo}${dryRun ? '  (dry run: nothing written)' : ''}`);
console.log(`tools: ${tools.join(', ')}${commit ? `   kit commit: ${commit.slice(0, 7)}${dirty ? ' + uncommitted changes' : ''}` : ''}`);
for (const kind of order) {
  const list = actions.filter((a) => a.kind === kind);
  if (!list.length) continue;
  console.log(`\n${LABEL[kind]} (${list.length})`);
  for (const a of list) console.log(`  ${a.path}${a.note ? `  — ${a.note}` : ''}`);
}
const same = actions.filter((a) => a.kind === 'same').length;
if (same) console.log(`\nup to date: ${same} file(s)`);
const conflicts = actions.filter((a) => a.kind === 'conflict').length;
if (!dryRun && cmd === 'install') {
  console.log(`\nNext:
  1. Fill in .orchestra/project.md: the product, its sources, stack rules and security-sensitive areas.
  2. Review the changes with git and commit them.
  3. node scripts/validate-gates.mjs .orchestra/runs/EXAMPLE.run.json
  4. node scripts/board-server.mjs   (board at http://127.0.0.1:4319/sdlc/board.html)
  5. Start a run: in ${tools.includes('claude') ? '"claude --agent sdlc-orchestrator"' : ''}${tools.length === 2 ? ' or ' : ''}${tools.includes('copilot') ? 'the SDLC Orchestrator agent in VS Code' : ''}, send /imperata-start <feature>.
     Each later step has a command too: type /imperata to list them.
  The steps of .orchestra/STARTER_GUIDE.md that set up approval modes, CI and stack skills still apply.`);
}
if (cmd === 'status') process.exit(changes.length ? 1 : 0);
process.exit(conflicts ? 1 : 0);
