// SPDX-License-Identifier: MIT
// scripts/record-run.mjs: one call that writes the fields of a change to a run manifest, runs the gate
// validator, renders the run boards and commits. Each test has a repository of its own with one run that the
// validator accepts (tests/run-fixture.mjs) and the schema the script checks the fields against.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { gitRepo, installedRepo, tempDir, commitAll, git, run, node, script, write, read, readJson, kitRoot, expectExit, expectOutput } from './helpers.mjs';
import { makeRun, gateVersionOf } from './run-fixture.mjs';

const RECORD = script('record-run.mjs');
const SCHEMA = '.orchestra/schemas/run.schema.json';
function repo(t, options) {
  const root = gitRepo(t);
  write(root, SCHEMA, readFileSync(join(kitRoot, 'starter', SCHEMA), 'utf8'));
  write(root, '.gitignore', 'sdlc/board.html\n');
  return { root, ...makeRun(root, options) };
}
const record = (root, ...args) => node(root, RECORD, 'R1', ...args);
const TO_ACCEPTANCE = ['--set', 'currentStage=READY_FOR_ACCEPTANCE', '--set', 'gateResults.review=PASSED'];
const commits = (root) => Number(git(root, 'rev-list', '--count', 'HEAD'));

describe('a change to the manifest', () => {
  // Some editors on Windows write a byte-order mark before a manifest's JSON; the call reads such a manifest, and
  // does not stop with "is not JSON".
  it('reads a manifest with a byte-order mark, and writes it back without one', (t) => {
    const { root, manifest } = repo(t, { stage: 'REVIEWING' });
    write(root, manifest, `\uFEFF${read(root, manifest)}`);
    expectExit(record(root, ...TO_ACCEPTANCE), 0);
    assert.ok(!read(root, manifest).startsWith('\uFEFF'), 'the byte-order mark was written back');
    assert.equal(readJson(root, manifest).currentStage, 'READY_FOR_ACCEPTANCE');
  });

  // Made by hand, a stage change is one request for the time, one for each edit of the manifest, and one each for
  // the validator, the renderer and its check.
  it('is written in one call, with the revision raised, the time from the clock and the boards rendered', (t) => {
    const { root, manifest, R } = repo(t, { stage: 'REVIEWING' });
    const started = Date.now();
    const r = record(root, ...TO_ACCEPTANCE);
    expectExit(r, 0);
    const m = readJson(root, manifest);
    assert.equal(m.currentStage, 'READY_FOR_ACCEPTANCE');
    assert.equal(m.gateResults.review, 'PASSED');
    assert.equal(m.revision, 4);
    assert.match(m.updatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.ok(Math.abs(Date.parse(m.updatedAt) - started) < 120_000, `updatedAt ${m.updatedAt} is not the time of the call`);
    assert.ok(read(root, manifest).endsWith('}\n'));
    expectOutput(r, /run\.json: revision 3 -> 4, updatedAt \d{4}-/);
    expectOutput(r, /currentStage: "REVIEWING" -> "READY_FOR_ACCEPTANCE"/);
    expectOutput(r, /validator: accepted/);
    expectOutput(r, /board: rendered and current/);
    assert.ok(existsSync(join(root, R, 'board.md')), 'no board was rendered');
    expectExit(node(root, script('render-run-board.mjs'), '--check'), 0);
  });

  it('is undone when the validator rejects it, and nothing is rendered', (t) => {
    const { root, manifest, R } = repo(t, { stage: 'REVIEWING' });
    const before = read(root, manifest);
    const r = record(root, '--set', 'currentStage=READY_FOR_ACCEPTANCE', '--set', 'gateResults.humanAcceptance=PASSED');
    expectExit(r, 1);
    assert.equal(read(root, manifest), before, 'the manifest is not as it was');
    expectOutput(r, /humanAcceptance is PASSED but approvals\.humanAcceptance holds no record/);
    expectOutput(r, /Rejected by the gate validator: the manifest is as it was \(revision 3\)/);
    assert.ok(!existsSync(join(root, R, 'board.md')), 'a board was rendered for a change that was not made');
  });

  // Without the script the Orchestrator searches the schema, or the manifest of another run, for the name of a
  // stage or the shape of a record.
  it('is refused before anything is written when the schema does not name a field or allow a value', (t) => {
    const { root, manifest } = repo(t, { stage: 'REVIEWING' });
    const before = read(root, manifest);
    for (const [arg, pattern] of [
      ['curentStage=DONE', /The manifest has no field "curentStage"\. It has: .*currentStage.*notes/],
      ['currentStage=REVIEW', /currentStage cannot be "REVIEW"\. It is one of: .*REVIEWING/],
      ['gateResults.test=PASSED', /gateResults has no field "test"\. It has: .*tests/],
      ['externalEvidence.localMerge.sha=abc1234', /externalEvidence\.localMerge has no field "sha"\. It has: commit, branch, by, at/],
      ['externalEvidence.prMerged=yes', /externalEvidence\.prMerged is true or false, not "yes"/],
      ['approvals.humanAcceptance=yes', /approvals\.humanAcceptance holds fields: set them one by one \(approvals\.humanAcceptance\.kind/],
      ['openBlockers=waiting', /openBlockers is a list: give it as JSON/],
      ['currentStage.next=DONE', /currentStage holds a value, not fields/],
      ['revision=9', /revision goes up by one with every change recorded here: it cannot be set/],
      ['updatedAt=2026-01-01T00:00:00Z', /updatedAt is taken from the clock: it cannot be set/],
      ['runId=R2', /runId names the run: it cannot be set/],
    ]) {
      const r = record(root, '--set', 'gateResults.review=PASSED', '--set', arg);
      expectExit(r, 2);
      expectOutput(r, pattern);
      expectOutput(r, /Nothing was changed\./);
      assert.equal(read(root, manifest), before, `the manifest changed with ${arg}`);
    }
  });

  it('builds a record from its fields, with @now as the time of the call', (t) => {
    const { root, manifest, R } = repo(t, { stage: 'READY_FOR_ACCEPTANCE' });
    const reply = `${R}/decisions/acceptance.md`;
    write(root, reply, `# Reply\n\nhumanAcceptance: APPROVE ${gateVersionOf(root, [`${R}/delivery.md`, `${R}/test-report.md`, `${R}/review.md`])}\n`);
    const r = record(root, '--set', 'approvals.humanAcceptance.kind=local-record', '--set', 'approvals.humanAcceptance.by=owner',
      '--set', 'approvals.humanAcceptance.at=@now', '--set', `approvals.humanAcceptance.recordPath=${reply}`, '--set', 'gateResults.humanAcceptance=PASSED');
    expectExit(r, 0);
    const m = readJson(root, manifest);
    assert.deepEqual(m.approvals.humanAcceptance, { kind: 'local-record', by: 'owner', at: m.updatedAt, recordPath: reply });
    assert.equal(m.gateResults.humanAcceptance, 'PASSED');
    assert.equal(m.revision, 4);
  });

  it('leaves notes and the names of artifact paths free, and takes a list and null as the schema types them', (t) => {
    const { root, manifest, R } = repo(t, { stage: 'REVIEWING' });
    write(root, `${R}/ticket.md`, '# Ticket\n');
    const r = record(root, '--set', `artifactPaths.ticket=${R}/ticket.md`, '--set', 'notes.merge=the owner wrote: merge it into main',
      '--set', 'dependsOn=["R0"]', '--set', 'externalEvidence.prUrl=null', '--set', 'title=Discount codes, again');
    expectExit(r, 0);
    const m = readJson(root, manifest);
    assert.equal(m.artifactPaths.ticket, `${R}/ticket.md`);
    assert.deepEqual(m.notes, { merge: 'the owner wrote: merge it into main' });
    assert.deepEqual(m.dependsOn, ['R0']);
    assert.equal(m.externalEvidence.prUrl, null);
    assert.equal(m.title, 'Discount codes, again');
    assert.equal(m.revision, 4, 'a field that already held the value counted as a change');
  });

  it('is not made when the fields already hold the values', (t) => {
    const { root, manifest } = repo(t, { stage: 'REVIEWING' });
    const before = read(root, manifest);
    const r = record(root, '--set', 'currentStage=REVIEWING');
    expectExit(r, 0);
    expectOutput(r, /already hold these values; revision 3 stays/);
    assert.equal(read(root, manifest), before);
  });

  // `--set openBlockers=[]`, unquoted, stops in zsh before the script runs, and the board goes on showing the
  // owner a blocker that no longer holds.
  it('empties a list with an empty value, which needs no quoting in any shell', (t) => {
    const { root, manifest } = repo(t, { stage: 'REVIEWING' });
    write(root, manifest, read(root, manifest).replace(/"openBlockers":\s*\[\]/, '"openBlockers": ["Waiting for the owner"]'));
    const r = record(root, '--set', 'openBlockers=');
    expectExit(r, 0);
    assert.deepEqual(readJson(root, manifest).openBlockers, []);
    expectOutput(r, /openBlockers: \["Waiting for the owner"\] -> \[\]/);
    const bad = record(root, '--set', 'openBlockers=Waiting');
    expectExit(bad, 2);
    expectOutput(bad, /or empty it with openBlockers= and nothing after/);
  });

  // The kit writes for the owner in English only, whatever language a profile names.
  it('names no language for the owner, whatever the profile says', (t) => {
    const { root } = repo(t, { stage: 'REVIEWING' });
    write(root, '.orchestra/project.md', '# Project profile\n\n## Language\n\n- **Owner-facing language:** vi\n');
    const r = record(root);
    expectExit(r, 0);
    assert.doesNotMatch(r.out, /language/i);
  });

  // An edit of the manifest by hand can leave it without a closing brace.
  it('is not tried on a manifest that is not JSON', (t) => {
    const { root, manifest } = repo(t, { stage: 'REVIEWING' });
    write(root, manifest, read(root, manifest).replace(/\}\s*$/, ''));
    const before = read(root, manifest);
    const r = record(root, ...TO_ACCEPTANCE);
    expectExit(r, 2);
    expectOutput(r, /sdlc\/runs\/R1\/run\.json is not JSON/);
    assert.equal(read(root, manifest), before);
  });

  it('is checked against GitHub in pull-request mode', { skip: process.platform === 'win32' ? 'the stand-in is a script with a shebang' : false }, (t) => {
    const { root, manifest } = repo(t, { stage: 'REVIEWING', mode: 'pull-request' });
    const before = read(root, manifest);
    const bin = tempDir(t);
    const asked = join(bin, 'asked.txt');
    write(bin, 'gh', `#!/bin/sh\necho "$@" >> "${asked}"\nexit 1\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    const r = run(process.execPath, [RECORD, 'R1', ...TO_ACCEPTANCE, '--require-check', 'Build and test'], { cwd: root, env: { PATH: `${bin}${delimiter}${process.env.PATH}` } });
    expectExit(r, 1);
    assert.ok(existsSync(asked) && /pr view/.test(readFileSync(asked, 'utf8')), `the validator did not ask GitHub\n${r.out}`);
    assert.equal(read(root, manifest), before);
  });
});

describe('without a field to set', () => {
  it('the manifest is left alone, and the validator and the boards are run', (t) => {
    const { root, manifest, R } = repo(t, { stage: 'REVIEWING' });
    const before = read(root, manifest);
    const r = record(root);
    expectExit(r, 0);
    assert.equal(read(root, manifest), before);
    expectOutput(r, /validator: accepted/);
    assert.ok(existsSync(join(root, R, 'board.md')));
  });

  it('a manifest the validator rejects stops the call before the commit', (t) => {
    const { root } = repo(t, { stage: 'REVIEWING', gates: { humanAcceptance: 'PASSED' }, approvals: { humanAcceptance: null } });
    commitAll(root, 'start');
    const r = record(root, '--commit', 'R1: a commit that must not be made');
    expectExit(r, 1);
    expectOutput(r, /The gate validator rejects the manifest as it stands\. Nothing was rendered or committed\./);
    assert.equal(commits(root), 1);
  });
});

describe('--commit', () => {
  // Staging the run folder and committing are part of the call that records the change, not two more requests.
  it('commits the records under sdlc/ and the paths named, and nothing else', (t) => {
    const { root, manifest, R } = repo(t, { stage: 'REVIEWING' });
    write(root, 'src/app.js', '// app\n');
    write(root, 'README.md', '# Project\n');
    commitAll(root, 'start');
    write(root, 'src/app.js', '// app, changed\n');
    write(root, 'README.md', '# Project, changed\n');
    const r = record(root, ...TO_ACCEPTANCE, '--commit', 'R1: review approved', '--body', 'Co-authored-by: Someone <someone@example.invalid>', '--add', 'src');
    expectExit(r, 0);
    assert.equal(git(root, 'log', '-1', '--format=%s'), 'R1: review approved');
    assert.match(git(root, 'log', '-1', '--format=%b'), /Co-authored-by: Someone/);
    assert.deepEqual(git(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), [`${R}/board.md`, manifest, 'src/app.js'].sort());
    assert.equal(git(root, 'status', '--short'), 'M README.md');
    expectOutput(r, /commit: [0-9a-f]{7,} R1: review approved \(3 files\)/);
  });

  it('makes no commit when nothing changed', (t) => {
    const { root } = repo(t, { stage: 'REVIEWING' });
    expectExit(record(root), 0);
    commitAll(root, 'start');
    const r = record(root, '--commit', 'R1: nothing new');
    expectExit(r, 0);
    expectOutput(r, /commit: nothing to commit/);
    assert.equal(commits(root), 1);
  });

  // .orchestra/auto-run.json: in a session that the board server starts, commits stay with a person.
  it('is refused in a session the board server started, before anything is written', (t) => {
    const { root, manifest } = repo(t, { stage: 'REVIEWING' });
    commitAll(root, 'start');
    const before = read(root, manifest);
    const auto = (...args) => run(process.execPath, [RECORD, 'R1', ...args], { cwd: root, env: { IMPERATA_AUTO_RUN: '1' } });
    const r = auto(...TO_ACCEPTANCE, '--commit', 'R1: review approved');
    expectExit(r, 2);
    expectOutput(r, /The board server started this session \(auto-run\): nobody watches it, and it commits nothing\./);
    assert.equal(read(root, manifest), before);
    assert.equal(commits(root), 1);
    expectExit(auto(...TO_ACCEPTANCE), 0);
    assert.equal(readJson(root, manifest).currentStage, 'READY_FOR_ACCEPTANCE');
    assert.equal(commits(root), 1);
  });

  it('takes --body and --add only with --commit, and a run that exists', (t) => {
    const { root } = repo(t, { stage: 'REVIEWING' });
    expectOutput(record(root, '--add', 'src'), /--body and --add go with --commit/);
    expectExit(record(root, '--add', 'src'), 2);
    const r = node(root, RECORD, 'R9', '--set', 'currentStage=DONE');
    expectExit(r, 2);
    expectOutput(r, /No run manifest at sdlc\/runs\/R9\/run\.json/);
  });
});

describe('in a repository that got the kit', () => {
  it('finds the schema it reads and the scripts it runs', (t) => {
    const root = installedRepo(t);
    const { manifest } = makeRun(root, { stage: 'REVIEWING' });
    const r = node(root, join(root, 'scripts/record-run.mjs'), 'R1', ...TO_ACCEPTANCE);
    expectExit(r, 0);
    assert.equal(readJson(root, manifest).currentStage, 'READY_FOR_ACCEPTANCE');
  });
});
