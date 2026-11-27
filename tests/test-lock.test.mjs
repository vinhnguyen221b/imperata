// SPDX-License-Identifier: MIT
// scripts/lock-tests.mjs: record, check and calibrate, in real git repositories.
// The "tests" of these repositories are plain Node scripts that exit 1 when an assertion fails, run with
// `node {file}`: no test runner is needed, and none can get in the way.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, commitAll, git, write, read, readJson, node, script, sha256, expectExit, expectOutput } from './helpers.mjs';

const lock = (root, ...args) => node(root, script('lock-tests.mjs'), ...args);
const LOCK = 'sdlc/runs/R1/evidence/test-lock.json';
const CAL = 'sdlc/runs/R1/evidence/test-calibration.json';
const CMD = ['--cmd', 'node {file}'];

const TOTAL = "import assert from 'node:assert/strict';\nimport { total } from '../src/price.js';\nassert.equal(total([{ price: 2, qty: 3 }]), 6);\n";
const DISCOUNT = "import assert from 'node:assert/strict';\nimport { total, discount } from '../src/price.js';\nimport { basket } from './helpers/items.js';\nassert.equal(discount(total(basket), 'TEN'), 18);\n";
const EMPTY = "import assert from 'node:assert/strict';\nimport { total } from '../src/price.js';\nimport { basket } from './helpers/items.js';\nassert.ok(total(basket) > 0);\n";
const FAILING = "import assert from 'node:assert/strict';\nimport { discount } from '../src/price.js';\nassert.equal(discount(100, 'TEN'), 80);\n";

// main holds the product before the run. The delivery branch adds a discount and four files under tests/:
// a test of the discount, a test that never touches it, a test that fails, and a helper that holds no test.
function featureRepo(t) {
  const root = gitRepo(t);
  write(root, 'package.json', '{ "name": "shop", "type": "module", "private": true }\n');
  write(root, 'src/price.js', 'export const total = (items) => items.reduce((sum, i) => sum + i.price * i.qty, 0);\n');
  write(root, 'tests/total.test.js', TOTAL);
  const base = commitAll(root, 'the product before the run');
  git(root, 'checkout', '-q', '-b', 'sdlc/R1/delivery');
  write(root, 'src/price.js', `${read(root, 'src/price.js')}export const discount = (amount, code) => (code === 'TEN' ? amount * 0.9 : amount);\n`);
  write(root, 'tests/helpers/items.js', 'export const basket = [{ price: 10, qty: 2 }];\n');
  write(root, 'tests/discount.test.js', DISCOUNT);
  write(root, 'tests/empty.test.js', EMPTY);
  write(root, 'tests/failing.test.js', FAILING);
  write(root, 'sdlc/runs/R1/run.json', '{ "runId": "R1", "currentStage": "VERIFYING" }\n');
  commitAll(root, 'the feature and its tests');
  return { root, base };
}
function recorded(t) {
  const repo = featureRepo(t);
  expectExit(lock(repo.root, 'record', 'R1'), 0);
  return repo;
}

describe('record', () => {
  it('records the test files the run added or changed, and the commit they are compared with', (t) => {
    const { root, base } = featureRepo(t);
    const r = lock(root, 'record', 'R1');
    expectExit(r, 0);
    expectOutput(r, /Test lock recorded for R1: 4 test file\(s\)/);
    expectOutput(r, /Set artifactPaths\.testLock to "sdlc\/runs\/R1\/evidence\/test-lock\.json"/);
    const recordedLock = readJson(root, LOCK);
    assert.deepEqual(Object.keys(recordedLock.files), ['tests/discount.test.js', 'tests/empty.test.js', 'tests/failing.test.js', 'tests/helpers/items.js']);
    assert.equal(recordedLock.files['tests/discount.test.js'], sha256(root, 'tests/discount.test.js'));
    assert.equal(recordedLock.base, base);
    assert.equal(recordedLock.runId, 'R1');
    assert.deepEqual(recordedLock.skipMarkers, []);
  });

  it('adds an untracked test file and a file named on the command line', (t) => {
    const { root } = featureRepo(t);
    write(root, 'tests/late.test.js', EMPTY);
    write(root, 'checks/smoke.js', 'process.exit(0);\n');
    expectExit(lock(root, 'record', 'R1', 'checks/smoke.js'), 0);
    const files = Object.keys(readJson(root, LOCK).files);
    assert.ok(files.includes('tests/late.test.js'), files.join(', '));
    assert.ok(files.includes('checks/smoke.js'), files.join(', '));
  });

  it('honours the test file locations of the project profile', (t) => {
    const { root } = featureRepo(t);
    write(root, '.orchestra/project.md', '# Project profile\n\n## Test file locations\n\n- `integration/**/*.js`\n\n## Other\n');
    write(root, 'integration/api/orders.js', 'process.exit(0);\n');
    write(root, 'scripts/build.js', 'process.exit(0);\n');
    expectExit(lock(root, 'record', 'R1'), 0);
    const files = Object.keys(readJson(root, LOCK).files);
    assert.ok(files.includes('integration/api/orders.js'), files.join(', '));
    assert.ok(!files.includes('scripts/build.js'), files.join(', '));
  });

  // Where Spec Kit is installed, spec.md, plan.md and the checklist under specs/ are documents, not test files.
  it('leaves the specs/ folder of Spec Kit out where Spec Kit is installed', (t) => {
    const { root } = featureRepo(t);
    write(root, 'specs/001-discount/spec.md', '# Feature Specification\n');
    write(root, 'specs/001-discount/contract.test.js', EMPTY);
    expectExit(lock(root, 'record', 'R1'), 0);
    assert.ok(Object.keys(readJson(root, LOCK).files).includes('specs/001-discount/spec.md'));
    write(root, '.specify/init-options.json', '{ "integration": "claude" }\n');
    expectExit(lock(root, 'record', 'R1'), 0);
    const files = Object.keys(readJson(root, LOCK).files);
    assert.ok(!files.includes('specs/001-discount/spec.md'), files.join(', '));
    assert.ok(files.includes('specs/001-discount/contract.test.js'), files.join(', '));
    assert.ok(files.includes('tests/discount.test.js'), files.join(', '));
  });

  it('refuses a named file that is missing or is a run artifact', (t) => {
    const { root } = featureRepo(t);
    const missing = lock(root, 'record', 'R1', 'tests/nowhere.test.js');
    expectExit(missing, 2);
    expectOutput(missing, /tests\/nowhere\.test\.js: not a file/);
    const artifact = lock(root, 'record', 'R1', 'sdlc/runs/R1/run.json');
    expectExit(artifact, 2);
    expectOutput(artifact, /a run artifact, not a test file/);
    assert.ok(!existsSync(join(root, LOCK)));
  });

  it('reports skip markers, and what changed since the previous lock', (t) => {
    const { root } = recorded(t);
    write(root, 'tests/discount.test.js', `${DISCOUNT}// test.skip('rounding', () => {});\n`);
    const r = lock(root, 'record', 'R1');
    expectExit(r, 0);
    expectOutput(r, /Changed since the previous lock .*: tests\/discount\.test\.js/);
    expectOutput(r, /WARNING: 1 locked file\(s\) carry a skip, only or ignore marker: tests\/discount\.test\.js/);
    assert.deepEqual(readJson(root, LOCK).skipMarkers, ['tests/discount.test.js']);
  });

  it('exits 2 for an unknown command, and for a run without a manifest', (t) => {
    const { root } = featureRepo(t);
    expectExit(lock(root, 'freeze', 'R1'), 2);
    const r = lock(root, 'record', 'R2');
    expectExit(r, 2);
    expectOutput(r, /No run manifest at sdlc\/runs\/R2\/run\.json/);
  });
});

describe('check', () => {
  it('holds while the locked files are as recorded', (t) => {
    const { root } = recorded(t);
    const r = lock(root, 'check', 'R1');
    expectExit(r, 0);
    expectOutput(r, /Test lock holds for R1: 4 test file\(s\) unchanged/);
  });

  it('fails and names a locked file that changed or is gone', (t) => {
    const { root } = recorded(t);
    write(root, 'tests/discount.test.js', '// the assertion was removed\n');
    rmSync(join(root, 'tests/empty.test.js'));
    const r = lock(root, 'check', 'R1');
    expectExit(r, 1);
    expectOutput(r, /TEST LOCK BROKEN for R1: 2 of 4/);
    expectOutput(r, /- tests\/discount\.test\.js: changed/);
    expectOutput(r, /- tests\/empty\.test\.js: deleted/);
  });

  // git prints a test file named tests/giá.test.mjs quoted and escaped, as "tests/gi\303\241.test.mjs", which is
  // no file: read that way, it would be left out of the lock without a word, and a later edit of it would pass
  // check.
  it('locks a test file whose name is not ASCII, and fails once it changed', (t) => {
    const { root } = featureRepo(t);
    write(root, 'tests/giá.test.js', "import assert from 'node:assert/strict';\nimport { discount } from '../src/price.js';\nassert.equal(discount(100, 'TEN'), 90);\n");
    commitAll(root, 'a test with a name in Vietnamese');
    expectExit(lock(root, 'record', 'R1'), 0);
    assert.ok('tests/giá.test.js' in readJson(root, LOCK).files, 'the file was left out of the lock');
    write(root, 'tests/giá.test.js', '// the assertion was removed\n');
    const r = lock(root, 'check', 'R1');
    expectExit(r, 1);
    expectOutput(r, /- tests\/giá\.test\.js: changed/);
  });

  it('fails when no lock was recorded', (t) => {
    const { root } = featureRepo(t);
    const r = lock(root, 'check', 'R1');
    expectExit(r, 1);
    expectOutput(r, /No test lock for R1/);
  });
});

describe('calibrate', () => {
  it('tells a test that depends on the change from one that passes without it', (t) => {
    const { root, base } = recorded(t);
    const r = lock(root, 'calibrate', 'R1', ...CMD);
    expectExit(r, 1);
    expectOutput(r, /TEST CALIBRATION FAILED for R1: 1 locked test file\(s\) pass without the run's change/);
    expectOutput(r, /Control: tests\/total\.test\.js passes here and on the base/);
    const { files } = readJson(root, CAL);
    assert.equal(files['tests/discount.test.js'].result, 'DEPENDS_ON_CHANGE');
    assert.equal(files['tests/empty.test.js'].result, 'PASSES_WITHOUT_CHANGE');
    assert.equal(files['tests/failing.test.js'].result, 'NOT_CALIBRATED');
    assert.deepEqual(
      { ...files['tests/discount.test.js'], at: null, baseOutputTail: null },
      { sha256: sha256(root, 'tests/discount.test.js'), result: 'DEPENDS_ON_CHANGE', command: 'node tests/discount.test.js', exitHere: 0, exitOnBase: 1, base, control: 'tests/total.test.js', at: null, baseOutputTail: null },
    );
    assert.match(files['tests/discount.test.js'].baseOutputTail, /discount/);
    assert.equal(files['tests/empty.test.js'].exitOnBase, 0);
    assert.match(files['tests/failing.test.js'].note, /does not pass here \(exit 1\)/);
  });

  it('does not run a file that is a test file only by its folder, unless it is named', (t) => {
    const { root } = recorded(t);
    const r = lock(root, 'calibrate', 'R1', ...CMD);
    expectOutput(r, /Not run: 1 locked file\(s\) that are test files only by their folder.*tests\/helpers\/items\.js/);
    assert.equal(readJson(root, CAL).files['tests/helpers/items.js'], undefined);
    lock(root, 'calibrate', 'R1', ...CMD, 'tests/helpers/items.js');
    assert.equal(readJson(root, CAL).files['tests/helpers/items.js'].result, 'PASSES_WITHOUT_CHANGE');
  });

  it('accepts a file that passes without the change when it is named with --guard', (t) => {
    const { root } = recorded(t);
    const r = lock(root, 'calibrate', 'R1', ...CMD, '--guard', 'tests/empty.test.js');
    expectExit(r, 0);
    assert.equal(readJson(root, CAL).files['tests/empty.test.js'].result, 'GUARD');
  });

  it('keeps an earlier result for a file it did not run, and still fails on it', (t) => {
    const { root } = recorded(t);
    expectExit(lock(root, 'calibrate', 'R1', ...CMD), 1);
    const r = lock(root, 'calibrate', 'R1', ...CMD, 'tests/discount.test.js');
    expectExit(r, 1);
    expectOutput(r, /- tests\/empty\.test\.js \(calibrated /);
    assert.equal(readJson(root, CAL).files['tests/empty.test.js'].result, 'PASSES_WITHOUT_CHANGE');
  });

  it('drops a result once the file changed and the lock was recorded again', (t) => {
    const { root } = recorded(t);
    expectExit(lock(root, 'calibrate', 'R1', ...CMD), 1);
    write(root, 'tests/empty.test.js', DISCOUNT);
    expectExit(lock(root, 'record', 'R1'), 0);
    expectExit(lock(root, 'calibrate', 'R1', ...CMD, 'tests/discount.test.js'), 0);
    assert.equal(readJson(root, CAL).files['tests/empty.test.js'], undefined);
    expectExit(lock(root, 'calibrate', 'R1', ...CMD, 'tests/empty.test.js'), 0);
    assert.equal(readJson(root, CAL).files['tests/empty.test.js'].result, 'DEPENDS_ON_CHANGE');
  });

  it('says so when it ran without a control', (t) => {
    const { root } = recorded(t);
    const r = lock(root, 'calibrate', 'R1', ...CMD, '--no-control', 'tests/discount.test.js');
    expectExit(r, 0);
    expectOutput(r, /WARNING: no control \(--no-control\)/);
    expectOutput(r, /report this calibration under "Unproven"/);
    assert.equal(readJson(root, CAL).files['tests/discount.test.js'].control, null);
  });

  it('quotes a path with a space, and fills {dir} and {name}', (t) => {
    const { root } = featureRepo(t);
    write(root, 'tests/my page/page.test.js', DISCOUNT.replaceAll("'../src", "'../../src").replace("'./helpers", "'../helpers"));
    expectExit(lock(root, 'record', 'R1'), 0);
    lock(root, 'calibrate', 'R1', ...CMD, 'tests/my page/page.test.js');
    const spaced = readJson(root, CAL).files['tests/my page/page.test.js'];
    assert.equal(spaced.command, 'node "tests/my page/page.test.js"');
    assert.equal(spaced.result, 'DEPENDS_ON_CHANGE');
    lock(root, 'calibrate', 'R1', '--cmd', 'node {file} {dir} {name}', 'tests/discount.test.js');
    assert.equal(readJson(root, CAL).files['tests/discount.test.js'].command, 'node tests/discount.test.js tests discount.test');
  });

  it('does not run a path that a command line cannot carry safely', (t) => {
    const { root } = featureRepo(t);
    write(root, 'tests/a$b.test.js', DISCOUNT);
    expectExit(lock(root, 'record', 'R1'), 0);
    lock(root, 'calibrate', 'R1', ...CMD, 'tests/a$b.test.js', 'tests/discount.test.js');
    const odd = readJson(root, CAL).files['tests/a$b.test.js'];
    assert.equal(odd.result, 'NOT_CALIBRATED');
    assert.match(odd.note, /cannot carry safely/);
    assert.equal(odd.command, undefined);
  });

  it('refuses a command without a placeholder, one that fits no file, a file outside the lock and a broken lock', (t) => {
    const { root } = recorded(t);
    const bare = lock(root, 'calibrate', 'R1', '--cmd', 'node');
    expectExit(bare, 2);
    expectOutput(bare, /needs --cmd "<command>" with \{file\}, \{dir\} or \{name\}/);
    const wrong = lock(root, 'calibrate', 'R1', '--cmd', 'no-such-runner {file}');
    expectExit(wrong, 2);
    expectOutput(wrong, /none of the 3 file\(s\) passes here with this command/);
    const outside = lock(root, 'calibrate', 'R1', ...CMD, 'tests/total.test.js');
    expectExit(outside, 2);
    expectOutput(outside, /not in the test lock: tests\/total\.test\.js/);
    write(root, 'tests/discount.test.js', '// changed after the lock\n');
    const broken = lock(root, 'calibrate', 'R1', ...CMD);
    expectExit(broken, 2);
    expectOutput(broken, /the test lock does not hold \(tests\/discount\.test\.js\)/);
    assert.ok(!existsSync(join(root, CAL)));
  });

  it('reports a command that does not finish in time', (t) => {
    const { root } = recorded(t);
    const r = lock(root, 'calibrate', 'R1', '--cmd', 'node -e "setTimeout(() => {}, 20000)" {file}', '--timeout', '1', 'tests/discount.test.js');
    expectExit(r, 2);
    expectOutput(r, /tests\/discount\.test\.js: timed out/);
  });

  it('asks for --base when the checkout does not differ from the base it would use', (t) => {
    const { root } = recorded(t);
    const withoutBase = readJson(root, LOCK);
    delete withoutBase.base;
    write(root, LOCK, JSON.stringify(withoutBase, null, 2));
    git(root, 'checkout', '-q', 'main');
    git(root, 'merge', '-q', '--ff-only', 'sdlc/R1/delivery');
    const r = lock(root, 'calibrate', 'R1', ...CMD);
    expectExit(r, 2);
    expectOutput(r, /this checkout does not differ from the base .* --base <ref>/);
    lock(root, 'calibrate', 'R1', ...CMD, '--base', 'HEAD~1');
    assert.equal(readJson(root, CAL).files['tests/discount.test.js'].result, 'DEPENDS_ON_CHANGE');
  });

  it('leaves no checkout of the base behind', (t) => {
    const { root } = recorded(t);
    lock(root, 'calibrate', 'R1', ...CMD);
    assert.equal(git(root, 'worktree', 'list').split('\n').length, 1);
    assert.equal(git(root, 'worktree', 'prune', '--dry-run'), '');
    assert.equal(git(root, 'status', '--porcelain', '--', 'src', 'tests'), '');
  });
});

// A test can fail now and then, more often when the whole suite runs than when its file runs alone, and still
// pass QA, the test lock and a calibration that runs each file once. Here the "whole suite" is a script that
// fails on every third run.
describe('calibrate, running the whole suite several times', () => {
  const FLAKY = "import { readFileSync, writeFileSync } from 'node:fs';\nlet n = 0;\ntry { n = Number(readFileSync('.suite-runs', 'utf8')); } catch {}\nwriteFileSync('.suite-runs', String(n + 1));\nif (n % 3 === 1) { console.log('not ok 3 - an oversized body to a missing id'); process.exit(1); }\nconsole.log('ok');\n";
  const STEADY = ['--suite', 'node tests/discount.test.js', '--guard', 'tests/empty.test.js'];
  function withSuite(t) {
    const repo = recorded(t);
    write(repo.root, 'run-all.js', FLAKY);
    return repo;
  }

  it('runs the suite five times, and records each exit code against the lock', (t) => {
    const { root } = withSuite(t);
    const r = lock(root, 'calibrate', 'R1', ...CMD, ...STEADY);
    expectExit(r, 0);
    expectOutput(r, /Running the whole suite 5 times here: node tests\/discount\.test\.js/);
    expectOutput(r, /Whole suite: passed in each of 5 run\(s\) since the lock was recorded/);
    const { suites } = readJson(root, CAL);
    assert.equal(suites.length, 1);
    assert.deepEqual(suites[0].exits, [0, 0, 0, 0, 0]);
    assert.equal(suites[0].lockRecordedAt, readJson(root, LOCK).recordedAt);
  });

  it('fails when the suite fails in some runs and passes in others, and still calibrates each file', (t) => {
    const { root } = withSuite(t);
    const r = lock(root, 'calibrate', 'R1', ...CMD, '--suite', 'node run-all.js', '--guard', 'tests/empty.test.js');
    expectExit(r, 1);
    expectOutput(r, /TESTS DO NOT GIVE THE SAME VERDICT for R1/);
    expectOutput(r, /- node run-all\.js: failed in 2 of 5 run\(s\)\. The end of a failed run:\nnot ok 3 - an oversized body to a missing id/);
    const cal = readJson(root, CAL);
    assert.deepEqual(cal.suites[0].exits, [0, 1, 0, 0, 1]);
    assert.equal(cal.files['tests/discount.test.js'].result, 'DEPENDS_ON_CHANGE');
  });

  it('keeps a failure when the suite is run again on the same lock, and drops it once the lock is recorded again', (t) => {
    const { root } = withSuite(t);
    const suite = ['--suite', 'node run-all.js', '--guard', 'tests/empty.test.js'];
    expectExit(lock(root, 'calibrate', 'R1', ...CMD, ...suite), 1);
    const again = lock(root, 'calibrate', 'R1', ...CMD, ...suite, '--repeat', '2');
    expectExit(again, 1);
    expectOutput(again, /failed in 2 of 7 run\(s\)/);
    expectExit(lock(root, 'calibrate', 'R1', ...CMD, '--guard', 'tests/empty.test.js'), 1);
    // The QA step after a repair records the lock again, later.
    write(root, LOCK, JSON.stringify({ ...readJson(root, LOCK), recordedAt: '2099-01-01T00:00:00Z' }, null, 2));
    const fresh = lock(root, 'calibrate', 'R1', ...CMD, ...STEADY);
    expectExit(fresh, 0);
    assert.deepEqual(readJson(root, CAL).suites.map((s) => s.command), ['node tests/discount.test.js']);
  });

  it('stops, and writes nothing, when the suite fails in every run', (t) => {
    const { root } = withSuite(t);
    const r = lock(root, 'calibrate', 'R1', ...CMD, '--suite', 'node tests/failing.test.js', '--repeat', '3');
    expectExit(r, 2);
    expectOutput(r, /the whole suite does not pass here: it failed in each of 3 run\(s\) \(exit 1\)/);
    assert.ok(!existsSync(join(root, CAL)));
  });

  it('says when the suite was not run, and refuses --repeat without a suite or below two', (t) => {
    const { root } = withSuite(t);
    expectOutput(lock(root, 'calibrate', 'R1', ...CMD), /WARNING: the whole suite was not run more than once/);
    const bare = lock(root, 'calibrate', 'R1', ...CMD, '--repeat', '3');
    expectExit(bare, 2);
    expectOutput(bare, /--repeat counts the runs of the whole suite; give its command with --suite/);
    const once = lock(root, 'calibrate', 'R1', ...CMD, '--suite', 'node run-all.js', '--repeat', '1');
    expectExit(once, 2);
    expectOutput(once, /--repeat needs a whole number of 2 or more/);
  });
});

// A product whose tests need a dependency folder that git does not track. The run's work is uncommitted on
// main, so the base is the current commit.
describe('calibrate, when a fresh checkout cannot run tests', () => {
  function dependentRepo(t) {
    const root = gitRepo(t);
    write(root, '.gitignore', 'node_modules/\n');
    write(root, 'package.json', '{ "name": "shop", "type": "module", "private": true }\n');
    write(root, 'node_modules/tiny/package.json', '{ "name": "tiny", "type": "module", "main": "index.js" }\n');
    write(root, 'node_modules/tiny/index.js', 'export const double = (n) => n * 2;\n');
    write(root, 'src/price.js', "import { double } from 'tiny';\nexport const price = (n) => double(n);\n");
    write(root, 'tests/price.test.js', "import assert from 'node:assert/strict';\nimport { price } from '../src/price.js';\nassert.equal(price(2), 4);\n");
    commitAll(root, 'the product before the run');
    write(root, 'src/price.js', `${read(root, 'src/price.js')}export const vat = (n) => n + n / 10;\n`);
    write(root, 'tests/vat.test.js', "import assert from 'node:assert/strict';\nimport { vat } from '../src/price.js';\nassert.equal(vat(100), 110);\n");
    write(root, 'sdlc/runs/R1/run.json', '{ "runId": "R1", "currentStage": "VERIFYING" }\n');
    expectExit(lock(root, 'record', 'R1'), 0);
    return root;
  }

  it('stops, and writes nothing, when a test the run did not touch fails on the base', (t) => {
    const root = dependentRepo(t);
    const r = lock(root, 'calibrate', 'R1', ...CMD);
    expectExit(r, 2);
    expectOutput(r, /the base checkout cannot run a test that passes here and that the run did not touch: tests\/price\.test\.js/);
    expectOutput(r, /--link <path>.*--setup/);
    assert.ok(!existsSync(join(root, CAL)));
  });

  it('runs once the dependency folder is linked with --link, and leaves the folder in place', (t) => {
    const root = dependentRepo(t);
    expectExit(lock(root, 'calibrate', 'R1', ...CMD, '--link', 'node_modules'), 0);
    assert.equal(readJson(root, CAL).files['tests/vat.test.js'].result, 'DEPENDS_ON_CHANGE');
    assert.ok(existsSync(join(root, 'node_modules/tiny/index.js')));
  });

  // npm, pnpm and yarn workspaces make node_modules/<package> a link to packages/<package>. Linked as a whole,
  // node_modules would lead the base checkout to the package with the run's change in it, and a test that depends
  // on the change would read PASSES_WITHOUT_CHANGE.
  it('links a workspace package of node_modules to its version in the base checkout', { skip: process.platform === 'win32' && 'links need rights there' }, (t) => {
    const root = gitRepo(t);
    write(root, '.gitignore', 'node_modules/\n');
    write(root, 'package.json', '{ "name": "shop", "type": "module", "private": true, "workspaces": ["packages/*"] }\n');
    write(root, 'packages/pricing/package.json', '{ "name": "@shop/pricing", "type": "module", "main": "index.js" }\n');
    write(root, 'packages/pricing/index.js', 'export const price = (n) => n;\n');
    write(root, 'node_modules/tiny/package.json', '{ "name": "tiny", "type": "module", "main": "index.js" }\n');
    write(root, 'node_modules/tiny/index.js', 'export const one = 1;\n');
    mkdirSync(join(root, 'node_modules/@shop'), { recursive: true });
    symlinkSync('../../packages/pricing', join(root, 'node_modules/@shop/pricing'));
    write(root, 'tests/one.test.js', "import assert from 'node:assert/strict';\nimport { one } from 'tiny';\nassert.equal(one, 1);\n");
    commitAll(root, 'the product before the run');
    write(root, 'packages/pricing/index.js', 'export const price = (n) => n * 2;\n');
    write(root, 'tests/price.test.js', "import assert from 'node:assert/strict';\nimport { price } from '@shop/pricing';\nassert.equal(price(2), 4);\n");
    write(root, 'sdlc/runs/R1/run.json', '{ "runId": "R1", "currentStage": "VERIFYING" }\n');
    expectExit(lock(root, 'record', 'R1'), 0);
    const r = lock(root, 'calibrate', 'R1', ...CMD, '--link', 'node_modules');
    expectExit(r, 0);
    assert.equal(readJson(root, CAL).files['tests/price.test.js'].result, 'DEPENDS_ON_CHANGE');
    assert.ok(existsSync(join(root, 'node_modules/tiny/index.js')), 'the linked folder was removed with the base checkout');
    assert.equal(read(root, 'packages/pricing/index.js'), 'export const price = (n) => n * 2;\n');
  });

  it('runs once --setup prepared the checkout, and stops when --setup fails', (t) => {
    const root = dependentRepo(t);
    const copy = `node -e "require('node:fs').cpSync(process.argv[1], 'node_modules', { recursive: true })" "${join(root, 'node_modules')}"`;
    expectExit(lock(root, 'calibrate', 'R1', ...CMD, '--setup', copy), 0);
    assert.equal(readJson(root, CAL).files['tests/vat.test.js'].result, 'DEPENDS_ON_CHANGE');
    const failed = lock(root, 'calibrate', 'R1', ...CMD, '--setup', 'node -e "process.exit(3)"');
    expectExit(failed, 2);
    expectOutput(failed, /--setup did not succeed in the base checkout \(exit 3\)/);
  });

  it('refuses a --link that is not in the checkout and a --control that does not pass', (t) => {
    const root = dependentRepo(t);
    const link = lock(root, 'calibrate', 'R1', ...CMD, '--link', 'vendor');
    expectExit(link, 2);
    expectOutput(link, /--link vendor: not found in this checkout/);
    const control = lock(root, 'calibrate', 'R1', ...CMD, '--link', 'node_modules', '--control', 'tests/nope.test.js');
    expectExit(control, 2);
    expectOutput(control, /--control tests\/nope\.test\.js: not a file in this checkout/);
  });
});

// A bug run shows its bug before anyone changes the code: the QA Engineer's test fails on the code as committed.
describe('reproduce', () => {
  const REP = 'sdlc/runs/R1/evidence/reproduction.json';
  const SHOWS = "import assert from 'node:assert/strict';\nimport { discount } from '../src/price.js';\nassert.equal(discount(100, 'TEN'), 90);\n";
  // The product as committed takes 20 percent off for TEN; what should happen is 10 percent.
  function bugRepo(t) {
    const root = gitRepo(t);
    write(root, 'package.json', '{ "name": "shop", "type": "module", "private": true }\n');
    write(root, 'src/price.js', "export const total = (items) => items.reduce((sum, i) => sum + i.price * i.qty, 0);\nexport const discount = (amount, code) => (code === 'TEN' ? amount * 0.8 : amount);\n");
    write(root, 'tests/total.test.js', TOTAL);
    write(root, 'sdlc/runs/R1/run.json', '{ "runId": "R1", "kind": "bug", "currentStage": "ANALYSIS" }\n');
    commitAll(root, 'the product with its bug');
    write(root, 'tests/discount-bug.test.js', SHOWS);
    return root;
  }

  it('records that the test fails on the code as committed, with the commit and a control', (t) => {
    const root = bugRepo(t);
    const r = lock(root, 'reproduce', 'R1', ...CMD, 'tests/discount-bug.test.js');
    expectExit(r, 0);
    expectOutput(r, /REPRODUCED\s+tests\/discount-bug\.test\.js: exit 1/);
    expectOutput(r, /1 of 1 test file\(s\) fail on [0-9a-f]{10}, the code as committed/);
    expectOutput(r, /Control: tests\/total\.test\.js passes here/);
    expectOutput(r, /Set artifactPaths\.reproduction to "sdlc\/runs\/R1\/evidence\/reproduction\.json"/);
    const rep = readJson(root, REP);
    assert.equal(rep.commit, git(root, 'rev-parse', 'HEAD'));
    assert.equal(rep.control, 'tests/total.test.js');
    const file = rep.files['tests/discount-bug.test.js'];
    assert.equal(file.result, 'REPRODUCED');
    assert.equal(file.sha256, sha256(root, 'tests/discount-bug.test.js'));
    assert.match(file.outputTail, /80/);
  });

  it('exits 1 when the test passes, so that no fix is planned for a bug nobody has shown', (t) => {
    const root = bugRepo(t);
    write(root, 'tests/discount-bug.test.js', SHOWS.replace('90', '80'));
    const r = lock(root, 'reproduce', 'R1', ...CMD, 'tests/discount-bug.test.js');
    expectExit(r, 1);
    expectOutput(r, /BUG NOT REPRODUCED for R1/);
    assert.equal(readJson(root, REP).files['tests/discount-bug.test.js'].result, 'NOT_REPRODUCED');
  });

  it('refuses when application code differs from the commit, and writes nothing', (t) => {
    const root = bugRepo(t);
    write(root, 'src/price.js', `${read(root, 'src/price.js')}// a fix begun already\n`);
    const r = lock(root, 'reproduce', 'R1', ...CMD, 'tests/discount-bug.test.js');
    expectExit(r, 2);
    expectOutput(r, /files other than tests differ from [0-9a-f]{10}: src\/price\.js/);
    assert.ok(!existsSync(join(root, REP)));
  });

  it('refuses a control that does not pass, a file that is no test, no file and a command without a placeholder', (t) => {
    const root = bugRepo(t);
    write(root, 'tests/broken.test.js', "throw new Error('broken');\n");
    let r = lock(root, 'reproduce', 'R1', ...CMD, '--control', 'tests/broken.test.js', 'tests/discount-bug.test.js');
    expectExit(r, 2);
    expectOutput(r, /--control tests\/broken\.test\.js does not pass here/);
    r = lock(root, 'reproduce', 'R1', ...CMD, 'src/price.js');
    expectExit(r, 2);
    expectOutput(r, /src\/price\.js is not a test file/);
    expectExit(lock(root, 'reproduce', 'R1', ...CMD), 2);
    expectExit(lock(root, 'reproduce', 'R1', '--cmd', 'node', 'tests/discount-bug.test.js'), 2);
    assert.ok(!existsSync(join(root, REP)));
  });

  it('says so when it ran without a control', (t) => {
    const root = bugRepo(t);
    const r = lock(root, 'reproduce', 'R1', ...CMD, '--no-control', 'tests/discount-bug.test.js');
    expectExit(r, 0);
    expectOutput(r, /WARNING: no control \(--no-control\)/);
    assert.equal(readJson(root, REP).control, null);
  });
});
