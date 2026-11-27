// SPDX-License-Identifier: MIT
// Shared helpers of the kit's own tests. Nothing in tests/ is installed into a project (kit.json does not
// name it). Every test works in a temporary directory of its own and runs the kit's scripts as a project
// would: as a child process, from the root of a repository.
//
// IMPERATA_KIT_ROOT points the tests at another copy of the kit, for example one with a deliberate fault in a
// script, to see that the tests notice it.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir, devNull } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const kitRoot = process.env.IMPERATA_KIT_ROOT
  ? resolve(process.env.IMPERATA_KIT_ROOT)
  : dirname(dirname(fileURLToPath(import.meta.url)));
export const kit = JSON.parse(readFileSync(join(kitRoot, 'kit.json'), 'utf8'));
export const script = (name) => join(kitRoot, 'starter', 'scripts', name);
export const hook = (name) => join(kitRoot, 'starter-claude-code', '.claude', 'hooks', name);
export const installer = join(kitRoot, 'imperata-kit.mjs');

// What a child process sees: no user or system git configuration (signing, hooks, templates), a fixed
// identity, and nothing of the session the tests were started from. NODE_TEST_CONTEXT is removed because a
// `node --test` started under it runs no file and reports success.
const baseEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Kit Test',
  GIT_AUTHOR_EMAIL: 'kit-test@example.invalid',
  GIT_COMMITTER_NAME: 'Kit Test',
  GIT_COMMITTER_EMAIL: 'kit-test@example.invalid',
};
delete baseEnv.NODE_TEST_CONTEXT;
delete baseEnv.CLAUDE_PROJECT_DIR;

export function run(command, args = [], { cwd, input, env } = {}) {
  const r = spawnSync(command, args, { cwd, input, encoding: 'utf8', env: { ...baseEnv, ...env }, timeout: 120_000 });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
}
export const node = (cwd, file, ...args) => run(process.execPath, [file, ...args], { cwd });

export function git(cwd, ...args) {
  const r = run('git', args, { cwd });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}:\n${r.out}`);
  return r.stdout.trim();
}

// A directory that is removed when the test ends. The real path, because macOS reaches its temp folder
// through a symlink and the hooks compare paths.
export function tempDir(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'imperata-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
export function gitRepo(t) {
  const root = tempDir(t);
  git(root, 'init', '-q', '-b', 'main');
  return root;
}
export function commitAll(root, message) {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

export function write(root, rel, text) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return rel;
}
export const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
export const readJson = (root, rel) => JSON.parse(read(root, rel));
export const sha256 = (root, rel) => createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');

// A kit installed into a fresh repository, as a project gets it.
export function installedRepo(t, tools = 'claude,copilot') {
  const root = gitRepo(t);
  const r = node(root, installer, 'install', root, '--tools', tools);
  assert.equal(r.status, 0, r.out);
  return root;
}

export function expectExit(r, status) {
  assert.equal(r.status, status, `expected exit ${status}, got ${r.status}\n${r.out}`);
}
export function expectOutput(r, pattern) {
  assert.match(r.out, pattern, `the output does not match ${pattern}\n${r.out}`);
}
