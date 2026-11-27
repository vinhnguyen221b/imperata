// SPDX-License-Identifier: MIT
// scripts/board-server.mjs, started as the owner starts it, with a stand-in for `claude` on the PATH that
// keeps the prompt an auto-run session is given. What the page does in a browser is not tested here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { installedRepo, write, tempDir } from './helpers.mjs';
import { makeRun } from './run-fixture.mjs';

const until = async (test, ms = 15_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    const v = test();
    if (v) return v;
  }
  throw new Error('timed out');
};

function startServer(t, root, port, env) {
  const child = spawn(process.execPath, [join(root, 'scripts/board-server.mjs'), '--port', String(port), '--auto-run', 'claude'], { cwd: root, env });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  t.after(() => child.kill());
  return { output: () => out };
}

describe('auto-run', () => {
  // The board may run on another port than the default, 4319, so the session is given the address the board is
  // served at, not the one the run-board skill gives.
  it('gives the session the address the board is served at', async (t) => {
    const root = installedRepo(t);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const bin = tempDir(t);
    const promptFile = join(bin, 'prompt.txt');
    write(bin, 'claude', `#!/bin/sh\ncat > "${promptFile}"\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
    delete env.NODE_TEST_CONTEXT;
    const port = 40000 + Math.floor(Math.random() * 20000);
    const server = startServer(t, root, port, env);
    await until(() => server.output().includes(`http://127.0.0.1:${port}/sdlc/board.html`));

    const page = await (await fetch(`http://127.0.0.1:${port}/sdlc/board.html`)).text();
    const token = page.match(/"token":"([0-9a-f]+)"/)?.[1];
    assert.ok(token, 'the page carries no token');
    const sent = await fetch(`http://127.0.0.1:${port}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, run: 'R1', text: 'Q-01: a' }) });
    assert.equal(sent.status, 200, await sent.text());

    const prompt = await until(() => existsSync(promptFile) && readFileSync(promptFile, 'utf8'));
    assert.match(prompt, new RegExp(`The run board is served at http://127\\.0\\.0\\.1:${port}/sdlc/board\\.html: give the owner that address`));
  });

  // scripts/record-run.mjs commits when asked to, and the tool list of an auto-run session holds no
  // commit. The script cannot see that list; it can see what the server gives the session it starts.
  it('tells the session that the board server started it', async (t) => {
    const root = installedRepo(t);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const bin = tempDir(t);
    const seen = join(bin, 'seen.txt');
    write(bin, 'claude', `#!/bin/sh\ncat > /dev/null\nprintf 'auto-run=%s' "$IMPERATA_AUTO_RUN" > "${seen}"\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
    delete env.NODE_TEST_CONTEXT;
    delete env.IMPERATA_AUTO_RUN;
    const port = 40000 + Math.floor(Math.random() * 20000);
    const server = startServer(t, root, port, env);
    await until(() => server.output().includes(`http://127.0.0.1:${port}/sdlc/board.html`));
    const page = await (await fetch(`http://127.0.0.1:${port}/sdlc/board.html`)).text();
    const token = page.match(/"token":"([0-9a-f]+)"/)?.[1];
    const sent = await fetch(`http://127.0.0.1:${port}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, run: 'R1', text: 'Q-01: a' }) });
    assert.equal(sent.status, 200, await sent.text());
    assert.equal(await until(() => existsSync(seen) && readFileSync(seen, 'utf8')), 'auto-run=1');
  });

  // An interactive session does not know which port the board runs on, and it may not be the default, 4319.
  // The server writes the address it serves at for the Orchestrator to read.
  it('writes the address it serves the board at while it runs, and removes it when it stops', async (t) => {
    const root = installedRepo(t);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const port = 40000 + Math.floor(Math.random() * 20000);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [join(root, 'scripts/board-server.mjs'), '--port', String(port)], { cwd: root, env });
    t.after(() => child.kill());
    const file = join(root, 'sdlc/.board-server.json');
    const address = await until(() => existsSync(file) && JSON.parse(readFileSync(file, 'utf8')));
    assert.equal(address.url, `http://127.0.0.1:${port}/sdlc/board.html`);
    assert.equal(address.port, port);
    assert.equal(address.pid, child.pid);
    child.kill('SIGTERM');
    await until(() => !existsSync(file));
    assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^sdlc\/\.board-server\.json$/m, 'the address file is not ignored by git');
  });

  // A GET needs no token, and any process of any user of the machine can reach 127.0.0.1, so a server that
  // answered for any Markdown, JSON, text, log or diff file would hand out the repository. The board links only to
  // files under sdlc/.
  it('serves files under sdlc/ only', async (t) => {
    const root = installedRepo(t);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    write(root, 'notes/secret.md', '# Not for the board\n');
    write(root, 'config.json', '{"key":"value"}\n');
    const port = 40000 + Math.floor(Math.random() * 20000);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [join(root, 'scripts/board-server.mjs'), '--port', String(port)], { cwd: root, env });
    t.after(() => child.kill());
    await until(() => existsSync(join(root, 'sdlc/.board-server.json')));
    const get = async (path) => (await fetch(`http://127.0.0.1:${port}/${path}`)).status;
    assert.equal(await get('sdlc/runs/R1/run.json'), 200);
    assert.equal(await get('notes/secret.md'), 404);
    assert.equal(await get('config.json'), 404);
    assert.equal(await get('sdlc/../config.json'), 404);
  });

  // An agent may write under sdlc/ (an auto-run session has Edit(sdlc/**)). A server that read sdlc/board.html
  // from disk and put its token in it would serve a page planted there with the token, and its script could save a
  // reply under decisions/ that the owner never sent.
  it('serves a page it rendered itself, never sdlc/board.html as an agent left it', async (t) => {
    const root = installedRepo(t);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const port = 40000 + Math.floor(Math.random() * 20000);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [join(root, 'scripts/board-server.mjs'), '--port', String(port)], { cwd: root, env });
    t.after(() => child.kill());
    await until(() => existsSync(join(root, 'sdlc/.board-server.json')));
    const page = async () => (await fetch(`http://127.0.0.1:${port}/sdlc/board.html`)).text();
    assert.match(await page(), /__BOARD_SERVER__/);
    write(root, 'sdlc/board.html', '<html><head></head><body>PLANTED</body></html>');
    const served = await page();
    assert.ok(!served.includes('PLANTED'), 'the server served the page an agent wrote, with its token');
    assert.match(served, /__BOARD_SERVER__/);
  });

  // The server puts the state of auto-run, with the last session's report, into a <script> of the page as JSON.
  // JSON.stringify leaves `</script>` as it is, so a report that holds it could close the script and run its own,
  // which reads the token and sends an approval the owner never made.
  it('keeps a session report from closing the script that holds the token', async (t) => {
    const root = installedRepo(t);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const bin = tempDir(t);
    const result = JSON.stringify({ type: 'result', result: 'done </script><script>window.PWNED=1</script>', num_turns: 1 });
    write(bin, 'claude', `#!/bin/sh\ncat > /dev/null\necho '${result}'\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
    delete env.NODE_TEST_CONTEXT;
    const port = 40000 + Math.floor(Math.random() * 20000);
    const server = startServer(t, root, port, env);
    await until(() => server.output().includes(`http://127.0.0.1:${port}/sdlc/board.html`));
    const page = async () => (await fetch(`http://127.0.0.1:${port}/sdlc/board.html`)).text();
    const token = (await page()).match(/"token":"([0-9a-f]+)"/)?.[1];
    const sent = await fetch(`http://127.0.0.1:${port}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, run: 'R1', text: 'Q-01: a' }) });
    assert.equal(sent.status, 200, await sent.text());
    const status = async () => (await (await fetch(`http://127.0.0.1:${port}/version`, { cache: 'no-store' })).json()).auto;
    for (const end = Date.now() + 15_000; Date.now() < end && !(await status()).last; await new Promise((r) => setTimeout(r, 100)));
    const served = await page();
    assert.ok(served.includes('PWNED'), 'the report is not in the page at all');
    assert.ok(!served.includes('</script><script>window.PWNED'), 'the report closed the script that holds the token');
  });

  // A body whose token is an object without a working toString could throw inside the request handler and stop
  // the server, with no token needed.
  it('refuses a malformed body and keeps serving', async (t) => {
    const root = installedRepo(t);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const port = 40000 + Math.floor(Math.random() * 20000);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [join(root, 'scripts/board-server.mjs'), '--port', String(port)], { cwd: root, env });
    t.after(() => child.kill());
    await until(() => existsSync(join(root, 'sdlc/.board-server.json')));
    for (const body of ['{"token":{"toString":1}}', '{"token":"x","run":{"toString":1}}', '[]', 'null']) {
      const r = await fetch(`http://127.0.0.1:${port}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      assert.ok(r.status >= 400 && r.status < 500, `${body} got ${r.status}`);
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/version`)).status, 200, 'the server stopped');
  });

  // A run folder that is a link to somewhere else would take the owner's reply there.
  it('saves a reply only inside the repository', { skip: process.platform === 'win32' && 'links need rights there' }, async (t) => {
    const root = installedRepo(t);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const outside = tempDir(t);
    write(outside, 'run.json', readFileSync(join(root, 'sdlc/runs/R1/run.json'), 'utf8'));
    symlinkSync(outside, join(root, 'sdlc/runs/R2'));
    const port = 40000 + Math.floor(Math.random() * 20000);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [join(root, 'scripts/board-server.mjs'), '--port', String(port)], { cwd: root, env });
    t.after(() => child.kill());
    await until(() => existsSync(join(root, 'sdlc/.board-server.json')));
    const token = (await (await fetch(`http://127.0.0.1:${port}/sdlc/board.html`)).text()).match(/"token":"([0-9a-f]+)"/)?.[1];
    const r = await fetch(`http://127.0.0.1:${port}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, run: 'R2', text: 'Q-01: a' }) });
    assert.equal(r.status, 400, await r.text());
    assert.deepEqual(readdirSync(outside), ['run.json'], 'a reply was written outside the repository');
  });

  // Copilot has no hooks, and `write(sdlc/**)` covers the owner's decisions/ folders: an unattended Copilot session
  // could write a reply the owner never sent. The server passes a deny rule for them.
  it('denies the Copilot session any write in the owner\'s decisions/', async (t) => {
    const root = installedRepo(t);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const bin = tempDir(t);
    const argsFile = join(bin, 'args.json');
    write(bin, 'copilot', `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n`);
    chmodSync(join(bin, 'copilot'), 0o755);
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
    delete env.NODE_TEST_CONTEXT;
    const port = 40000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [join(root, 'scripts/board-server.mjs'), '--port', String(port), '--auto-run', 'copilot'], { cwd: root, env });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    t.after(() => child.kill());
    await until(() => out.includes(`http://127.0.0.1:${port}/sdlc/board.html`));
    const token = (await (await fetch(`http://127.0.0.1:${port}/sdlc/board.html`)).text()).match(/"token":"([0-9a-f]+)"/)?.[1];
    const sent = await fetch(`http://127.0.0.1:${port}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, run: 'R1', text: 'Q-01: a' }) });
    assert.equal(sent.status, 200, await sent.text());
    const args = await until(() => existsSync(argsFile) && JSON.parse(readFileSync(argsFile, 'utf8')));
    const i = args.indexOf('--deny-tool');
    assert.ok(i >= 0, `the session was started without --deny-tool: ${args.join(' ')}`);
    assert.match(args[i + 1], /write\(sdlc\/runs\/\*\/decisions\/\*\*\)/);
  });

  // The server prints a run ID taken from the manifest, and control characters in it must not reach the terminal.
  it('prints no control character from a manifest to the terminal', async (t) => {
    const root = installedRepo(t);
    const { manifest } = makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const m = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    write(root, manifest, JSON.stringify({ ...m, runId: 'R1\u001b]52;c;eA==\u0007' }, null, 2));
    const bin = tempDir(t);
    write(bin, 'claude', '#!/bin/sh\ncat > /dev/null\n');
    chmodSync(join(bin, 'claude'), 0o755);
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
    delete env.NODE_TEST_CONTEXT;
    const port = 40000 + Math.floor(Math.random() * 20000);
    const server = startServer(t, root, port, env);
    await until(() => server.output().includes(`http://127.0.0.1:${port}/sdlc/board.html`));
    const token = (await (await fetch(`http://127.0.0.1:${port}/sdlc/board.html`)).text()).match(/"token":"([0-9a-f]+)"/)?.[1];
    await fetch(`http://127.0.0.1:${port}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, run: 'R1', text: 'Q-01: a' }) });
    await until(() => server.output().includes('auto-run: started'));
    assert.doesNotMatch(server.output(), /[\u0000-\u0008\u000b-\u001f\u007f]/, 'a control character reached the terminal');
  });

  // The panel at the top of the run page shows the report of the last auto-run session, such as "No code has been
  // written yet" at the plan approval. Once another session has changed the run, that report is older than the
  // run, and the page says so.
  it('marks the last session\'s report as older once the run changed after it', async (t) => {
    const root = installedRepo(t);
    const { manifest } = makeRun(root, { stage: 'READY_FOR_IMPLEMENTATION' });
    const bin = tempDir(t);
    const result = JSON.stringify({ type: 'result', result: 'No code has been written yet.', total_cost_usd: 0.5, num_turns: 3 });
    write(bin, 'claude', `#!/bin/sh\ncat > /dev/null\necho '${result}'\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
    delete env.NODE_TEST_CONTEXT;
    const port = 40000 + Math.floor(Math.random() * 20000);
    const server = startServer(t, root, port, env);
    await until(() => server.output().includes(`http://127.0.0.1:${port}/sdlc/board.html`));
    const page = await (await fetch(`http://127.0.0.1:${port}/sdlc/board.html`)).text();
    const token = page.match(/"token":"([0-9a-f]+)"/)?.[1];
    const sent = await fetch(`http://127.0.0.1:${port}/decisions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, run: 'R1', text: 'Q-01: a' }) });
    assert.equal(sent.status, 200, await sent.text());

    const status = async () => (await (await fetch(`http://127.0.0.1:${port}/version`, { cache: 'no-store' })).json()).auto;
    let last = null;
    for (const end = Date.now() + 15_000; Date.now() < end && !last; await new Promise((r) => setTimeout(r, 100))) last = (await status()).last;
    assert.ok(last, 'the session did not end');
    assert.equal(last.report, 'No code has been written yet.');
    assert.equal(last.stale, false);

    const m = JSON.parse(readFileSync(join(root, manifest), 'utf8'));
    write(root, manifest, JSON.stringify({ ...m, currentStage: 'READY_FOR_ACCEPTANCE', revision: m.revision + 1 }, null, 2));
    const after = (await status()).last;
    assert.equal(after.stale, true);
    assert.equal(after.stageNow, 'READY_FOR_ACCEPTANCE');
    const served = await (await fetch(`http://127.0.0.1:${port}/sdlc/board.html`)).text();
    assert.ok(served.includes('auto.stale'), 'the page has no message for an older report');
  });
});
