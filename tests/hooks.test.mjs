// SPDX-License-Identifier: MIT
// The Claude Code hooks of the kit: which writes each one lets through, and which it blocks.
// A hook gets the tool call as JSON on its standard input and blocks it by exiting 2.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, installedRepo, write, read, run, hook, expectExit, expectOutput } from './helpers.mjs';
import { makeRun } from './run-fixture.mjs';

const call = (name, root, toolInput, { raw } = {}) => run(process.execPath, [hook(name)], {
  cwd: root,
  input: raw ?? JSON.stringify({ tool_input: toolInput, cwd: root }),
  env: { CLAUDE_PROJECT_DIR: root },
});
const edit = (name, root, path) => call(name, root, { file_path: path });

describe('qa-write-guard: the QA Engineer writes test files and the run folder only', () => {
  it('lets test files of the usual conventions through', (t) => {
    const root = tempDir(t);
    for (const path of [
      'tests/cart.test.js', 'src/__tests__/cart.ts', 'e2e/login.spec.ts', 'web/src/cart.spec.tsx', 'pkg/order_test.go',
      'tests/test_cart.py', 'spec/cart_spec.rb', 'App.Tests/CartTests.cs', 'src/test/java/CartTest.java', 'AppTests/LoginTests.swift',
      join(root, 'tests/absolute.test.js'),
    ]) expectExit(edit('qa-write-guard.mjs', root, path), 0);
  });

  it('lets the files of a run folder through, except the manifest, the lock and the calibration', (t) => {
    const root = tempDir(t);
    expectExit(edit('qa-write-guard.mjs', root, 'sdlc/runs/R1/test-plan.md'), 0);
    expectExit(edit('qa-write-guard.mjs', root, 'sdlc/runs/R1/evidence/unit.log'), 0);
    for (const [path, reason] of [
      ['sdlc/runs/R1/run.json', /owned by the Orchestrator/],
      ['sdlc/runs/R1/evidence/test-lock.json', /written by scripts\/lock-tests\.mjs/],
      ['sdlc/runs/R1/evidence/test-calibration.json', /written by scripts\/lock-tests\.mjs/],
      ['sdlc/runs/R1/evidence/reproduction.json', /written by scripts\/lock-tests\.mjs/],
    ]) {
      const r = edit('qa-write-guard.mjs', root, path);
      expectExit(r, 2);
      expectOutput(r, /QA Engineer write blocked/);
      expectOutput(r, reason);
    }
  });

  it('blocks application code, other files and paths outside the repository', (t) => {
    const root = tempDir(t);
    for (const path of ['src/cart.ts', 'README.md', 'package.json', 'contest/entry.js', '../outside.test.js', '/etc/hosts']) {
      expectExit(edit('qa-write-guard.mjs', root, path), 2);
    }
  });

  // Spec Kit keeps its feature documents in a top-level specs/ folder, which the folder convention of the hook
  // would take for a test folder, letting the QA Engineer rewrite them.
  it('treats the specs/ folder of Spec Kit as documents where Spec Kit is installed', (t) => {
    const root = tempDir(t);
    expectExit(edit('qa-write-guard.mjs', root, 'specs/001-cart/spec.md'), 0);
    write(root, '.specify/init-options.json', '{ "integration": "claude" }\n');
    for (const path of ['specs/001-cart/spec.md', 'specs/001-cart/plan.md', 'specs/001-cart/checklists/requirements.md']) {
      const r = edit('qa-write-guard.mjs', root, path);
      expectExit(r, 2);
      expectOutput(r, /QA Engineer write blocked/);
    }
    for (const path of ['spec/cart_spec.rb', 'tests/cart.test.js', 'specs/001-cart/contract.test.js', 'web/specs/cart.ts', 'sdlc/runs/R1/test-plan.md']) {
      expectExit(edit('qa-write-guard.mjs', root, path), 0);
    }
  });

  it('lets a location through once the project profile lists it', (t) => {
    const root = tempDir(t);
    expectExit(edit('qa-write-guard.mjs', root, 'integration/api/OrdersSuite.cs'), 2);
    write(root, '.orchestra/project.md', '# Project profile\n\n## Test file locations\n\n- `integration/**/*.cs`\n- <for example `x/**`>\n');
    expectExit(edit('qa-write-guard.mjs', root, 'integration/api/OrdersSuite.cs'), 0);
    expectExit(edit('qa-write-guard.mjs', root, 'integration/api/helper.py'), 2);
  });

  it('lets a call without a file path through, and blocks one it cannot read', (t) => {
    const root = tempDir(t);
    expectExit(call('qa-write-guard.mjs', root, { command: 'npm test' }), 0);
    expectExit(call('qa-write-guard.mjs', root, null, { raw: 'not json' }), 2);
  });
});

describe('dev-test-guard: the Developer leaves locked tests alone', () => {
  const locked = (root, stage) => makeRun(root, { stage });

  it('blocks a locked test file while its run is open', (t) => {
    const root = tempDir(t);
    locked(root, 'FIX_REQUIRED');
    const r = edit('dev-test-guard.mjs', root, 'tests/price.test.js');
    expectExit(r, 2);
    expectOutput(r, /Developer write blocked: tests\/price\.test\.js/);
    expectOutput(r, /locked for run R1 after its QA step/);
  });

  it('lets application code and unlocked tests through', (t) => {
    const root = tempDir(t);
    locked(root, 'FIX_REQUIRED');
    expectExit(edit('dev-test-guard.mjs', root, 'src/price.js'), 0);
    expectExit(edit('dev-test-guard.mjs', root, 'tests/other.test.js'), 0);
    expectExit(call('dev-test-guard.mjs', root, { command: 'npm test' }), 0);
  });

  it('blocks the manifest, the lock and the calibration of any run', (t) => {
    const root = tempDir(t);
    for (const path of ['sdlc/runs/R1/run.json', 'sdlc/runs/R1/evidence/test-lock.json', 'sdlc/runs/R1/evidence/test-calibration.json', 'sdlc/runs/R1/evidence/reproduction.json']) {
      expectExit(edit('dev-test-guard.mjs', root, path), 2);
    }
    expectExit(call('dev-test-guard.mjs', root, { notebook_path: 'sdlc/runs/R1/run.json' }), 2);
  });

  it('lets the file go once the run is done or cancelled', (t) => {
    for (const stage of ['DONE', 'CANCELLED']) {
      const root = tempDir(t);
      locked(root, stage);
      expectExit(edit('dev-test-guard.mjs', root, 'tests/price.test.js'), 0);
    }
  });

  it('keeps the lock when the manifest cannot be read, and blocks input it cannot read', (t) => {
    const root = tempDir(t);
    locked(root, 'FIX_REQUIRED');
    write(root, 'sdlc/runs/R1/run.json', '{ broken');
    expectExit(edit('dev-test-guard.mjs', root, 'tests/price.test.js'), 2);
    expectExit(call('dev-test-guard.mjs', root, null, { raw: 'not json' }), 2);
  });
});

describe('owner-decisions-guard: no agent writes the owner\'s replies', () => {
  it('blocks a write into decisions/ and lets the rest of the run folder through', (t) => {
    const root = tempDir(t);
    const r = edit('owner-decisions-guard.mjs', root, 'sdlc/runs/R1/decisions/2026-11-16T03-00-00Z.md');
    expectExit(r, 2);
    expectOutput(r, /Owner decision file write blocked/);
    expectExit(edit('owner-decisions-guard.mjs', root, 'sdlc/runs/R1/clarification.md'), 0);
    expectExit(edit('owner-decisions-guard.mjs', root, 'docs/decisions/adr-1.md'), 0);
  });
});

// On macOS and Windows a path matches its folder whatever the case of its letters. Compared as written,
// `SDLC/runs/R1/decisions/x.md` and `sdlc/runs/R1/RUN.json` would go through and land in the real folders.
// This reads the guards' verdicts on such a system only; on Linux the case is part of the name.
describe('the guards on a file system that ignores case', { skip: !['darwin', 'win32'].includes(process.platform) && 'the case of a path is part of its name here' }, () => {
  it('block the owner\'s folder, the manifest and a locked test whatever the case of the path', (t) => {
    const root = tempDir(t);
    makeRun(root, { stage: 'FIX_REQUIRED' });
    expectExit(edit('owner-decisions-guard.mjs', root, 'SDLC/runs/R1/Decisions/x.md'), 2);
    expectExit(edit('dev-test-guard.mjs', root, 'sdlc/runs/R1/RUN.json'), 2);
    expectExit(edit('dev-test-guard.mjs', root, 'Tests/Price.test.js'), 2);
    expectExit(edit('qa-write-guard.mjs', root, 'Sdlc/Runs/R1/run.JSON'), 2);
    expectExit(edit('qa-write-guard.mjs', root, 'sdlc/runs/R1/evidence/Test-Lock.json'), 2);
  });

  // APFS folds a letter such as the long s (U+017F) to its plain form, so `deciſions` names `decisions`; and an
  // absolute path whose root differs only in case names the repository.
  it('block a path that only looks different: lookalike letters, or the root in another case', (t) => {
    const root = tempDir(t);
    makeRun(root, { stage: 'FIX_REQUIRED' });
    expectExit(edit('owner-decisions-guard.mjs', root, 'sdlc/runs/R1/deci\u017Fions/x.md'), 2);
    expectExit(edit('owner-decisions-guard.mjs', root, join(root.toUpperCase(), 'sdlc/runs/R1/decisions/x.md')), 2);
    expectExit(edit('dev-test-guard.mjs', root, 'sdlc/runs/R1/run.j\u017Fon'), 2);
    expectExit(edit('dev-test-guard.mjs', root, 'tests/price.te\u017Ft.js'), 2);
    expectExit(edit('dev-test-guard.mjs', root, join(root.toUpperCase(), 'sdlc/runs/R1/run.json')), 2);
    expectExit(edit('qa-write-guard.mjs', root, 'sdlc/runs/R1/run.j\u017Fon'), 2);
    // APFS folds the sharp s to "ss" as well.
    write(root, 'tests/session.test.js', 'test');
    const lock = JSON.parse(read(root, 'sdlc/runs/R1/evidence/test-lock.json'));
    lock.files['tests/session.test.js'] = 'x';
    write(root, 'sdlc/runs/R1/evidence/test-lock.json', JSON.stringify(lock));
    expectExit(edit('dev-test-guard.mjs', root, 'tests/se\u00DFion.test.js'), 2);
  });

  // The QA Engineer's guard reads a path folded where it lets a test through as well as where it blocks: read as
  // written there, another spelling of application code would pass as a test, `AudIT.java` for the existing
  // `Audit.java`, or `src/laTest/` for the existing `src/latest/`.
  it('block application code that another spelling of its name makes look like a test', (t) => {
    const root = tempDir(t);
    write(root, 'probe.txt', 'x');
    if (!existsSync(join(root, 'PROBE.TXT'))) { t.skip('this volume tells the case of a name'); return; }
    write(root, 'src/main/java/app/Audit.java', 'class Audit {}\n');
    write(root, 'src/latest/index.js', 'export {};\n');
    expectExit(edit('qa-write-guard.mjs', root, 'src/main/java/app/AudIT.java'), 2);
    expectExit(edit('qa-write-guard.mjs', root, 'src/laTest/index.js'), 2);
    expectExit(edit('qa-write-guard.mjs', root, 'src/main/java/app/AuditIT.java'), 0);
  });
});

describe('the guards and another name of the repository\'s folder', { skip: process.platform === 'win32' && 'links need rights there' }, () => {
  // A path that reaches the repository through another name of its folder: a link such as /tmp to /private/tmp,
  // or on macOS the firmlink /System/Volumes/Data. Its text alone does not match the root.
  it('block a path that reaches the repository through a link or a firmlink to its folder', (t) => {
    const root = tempDir(t);
    makeRun(root, { stage: 'FIX_REQUIRED' });
    const alias = tempDir(t) + '-alias';
    symlinkSync(root, alias);
    t.after(() => rmSync(alias, { force: true }));
    expectExit(edit('owner-decisions-guard.mjs', root, join(alias, 'sdlc/runs/R1/decisions/x.md')), 2);
    expectExit(edit('dev-test-guard.mjs', root, join(alias, 'sdlc/runs/R1/run.json')), 2);
    expectExit(edit('dev-test-guard.mjs', root, join(alias, 'tests/price.test.js')), 2);
    const firm = join('/System/Volumes/Data', realpathSync(root));
    if (process.platform === 'darwin' && existsSync(firm)) {
      expectExit(edit('owner-decisions-guard.mjs', root, join(firm, 'sdlc/runs/R1/decisions/x.md')), 2);
      expectExit(edit('dev-test-guard.mjs', root, join(firm, 'sdlc/runs/R1/run.json')), 2);
    }
  });

  // A link inside the repository to a run folder (r1link to sdlc/runs/R1) would let a write into decisions/
  // through if the guards read only the names of a path, and never where its links lead.
  it('block a write through a link inside the repository, and one that a link leads out of it', (t) => {
    const root = tempDir(t);
    makeRun(root, { stage: 'FIX_REQUIRED' });
    symlinkSync('sdlc/runs/R1', join(root, 'r1link'));
    expectExit(edit('owner-decisions-guard.mjs', root, 'r1link/decisions/x.md'), 2);
    expectExit(edit('dev-test-guard.mjs', root, 'r1link/run.json'), 2);
    expectExit(edit('qa-write-guard.mjs', root, 'r1link/run.json'), 2);
    write(root, 'src/app.js', 'export {};\n');
    symlinkSync(join(root, 'src'), join(root, 'tests/linked'));
    expectExit(edit('qa-write-guard.mjs', root, 'tests/linked/app.js'), 2);
    const away = tempDir(t);
    symlinkSync(away, join(root, 'tests/away'));
    const r = edit('qa-write-guard.mjs', root, 'tests/away/cart.test.js');
    expectExit(r, 2);
    expectOutput(r, /leads out of it through a link/);
    expectExit(edit('qa-write-guard.mjs', root, 'tests/cart.test.js'), 0);
  });});

describe('the hooks that run after a write', () => {
  it('validate-run-manifest returns the validator\'s findings for an invalid manifest', (t) => {
    const root = installedRepo(t, 'claude');
    const { manifest } = makeRun(root, { stage: 'REVIEWING' });
    expectExit(edit('validate-run-manifest.mjs', root, manifest), 0);
    makeRun(root, { stage: 'REVIEWING', gates: { tests: 'NOT_RUN' } });
    const r = edit('validate-run-manifest.mjs', root, manifest);
    expectExit(r, 2);
    expectOutput(r, /Gate validator rejected sdlc\/runs\/R1\/run\.json/);
    expectOutput(r, /tests is NOT_RUN; it must be PASSED before stage REVIEWING/);
    expectExit(edit('validate-run-manifest.mjs', root, 'sdlc/runs/R1/delivery.md'), 0);
  });

  it('validate-run-manifest says so when the repository has no validator', (t) => {
    const root = tempDir(t);
    const { manifest } = makeRun(root, {});
    const r = edit('validate-run-manifest.mjs', root, manifest);
    expectExit(r, 2);
    expectOutput(r, /scripts\/validate-gates\.mjs is not in this repository/);
  });

  it('render-run-board renders the board of the run whose file was written', (t) => {
    const root = installedRepo(t, 'claude');
    makeRun(root, { stage: 'REVIEWING' });
    assert.ok(!existsSync(join(root, 'sdlc/runs/R1/board.md')));
    expectExit(edit('render-run-board.mjs', root, 'sdlc/runs/R1/delivery.md'), 0);
    assert.ok(existsSync(join(root, 'sdlc/runs/R1/board.md')));
    assert.ok(existsSync(join(root, 'sdlc/board.html')));
    expectExit(edit('render-run-board.mjs', root, 'src/price.js'), 0);
  });
});
