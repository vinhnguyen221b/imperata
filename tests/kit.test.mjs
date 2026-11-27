// SPDX-License-Identifier: MIT
// The kit as a set of files: what kit.json promises exists, the version is the same wherever it is written,
// the two layers have not drifted apart, and no instruction points at a file the kit does not install.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { kitRoot, kit, run, expectExit } from './helpers.mjs';

const text = (rel) => readFileSync(join(kitRoot, rel), 'utf8');
const list = (rel, filter) => readdirSync(join(kitRoot, rel)).filter(filter).sort();
// What git ignores in the kit's repository is not part of the kit: generated copies, and anything kept locally.
const ignored = (() => {
  const r = run('git', ['-C', kitRoot, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory']);
  return r.status === 0 ? new Set(r.stdout.split('\n').filter(Boolean).map((p) => p.replace(/\/$/, ''))) : new Set();
})();
function walk(rel) {
  const out = [];
  for (const name of readdirSync(join(kitRoot, rel)).sort()) {
    const child = `${rel}/${name}`;
    if (name === '.git' || name === 'node_modules' || ignored.has(child.replace(/^\.\//, ''))) continue;
    if (statSync(join(kitRoot, child)).isDirectory()) out.push(...walk(child)); else out.push(child);
  }
  return out;
}
const CLAUDE = 'starter-claude-code/.claude';
const COPILOT = 'starter/.github';

describe('kit.json', () => {
  it('names only files and folders that are in the kit', () => {
    for (const entry of kit.entries) assert.ok(existsSync(join(kitRoot, entry.src)), `kit.json names ${entry.src}, which is not in the kit`);
  });

  it('gives every entry a known mode and known tools, and no destination twice for one tool', () => {
    const seen = new Set();
    for (const entry of kit.entries) {
      assert.ok(['kit', 'project', 'lines', 'json'].includes(entry.mode ?? 'kit'), `${entry.src}: mode ${entry.mode}`);
      for (const tool of entry.tools ?? ['claude', 'copilot']) {
        assert.ok(['claude', 'copilot'].includes(tool), `${entry.src}: tool ${tool}`);
        const key = `${tool}:${entry.dest}`;
        assert.ok(!seen.has(key), `${entry.dest} is installed twice for ${tool}`);
        seen.add(key);
      }
      if (entry.mode === 'lines') assert.ok(entry.header, `${entry.src}: a lines entry needs a header`);
    }
  });

  it('does not install the tests of the kit', () => {
    for (const mine of ['tests']) {
      assert.ok(!kit.entries.some((e) => e.src === mine || e.src.startsWith(`${mine}/`)), `${mine} must stay in the kit's repository`);
    }
  });

  // The kit stands apart from the repositories that use it. A file of the kit that cites a run by its id points at
  // a run that a project receiving the file does not have, so what a run shows is written without the id: the
  // record has to stand without the repository it came from. The ids left are the kit's own: `R001-example` in
  // the documents, and `R` with one digit in the tests and in the run-board skill.
  // This finds an id in backticks or after the word "run". It cannot tell an id written another way, or the id of
  // a question, a criterion or a file of such a run.
  it('names no run of another repository, in any file of the kit', () => {
    const files = walk('.').map((f) => f.slice(2)).filter((f) => /\.(md|mjs|json|ya?ml|example|svg)$/.test(f));
    assert.ok(files.length > 80, `only ${files.length} files of the kit were read`);
    const own = (id, file) => id === 'R001-example' || (/^R\d$/.test(id) && /^tests\/|\/skills\/run-board\//.test(file));
    for (const file of files) {
      for (const [cited, , id] of text(file).matchAll(/(\b[Rr]un `?|`)(R\d+[\w-]*)/g)) {
        assert.ok(own(id, file), `${file} cites "${cited}": the kit names no run of another repository`);
      }
    }
  });

  // The table tells a user who owns each file the kit installs and what an update does to it, so it names every
  // destination, `.vscode/mcp.example.json` among them, which the kit installs for Copilot and replaces on update.
  it('has every destination named in "What lands where" of KIT_GUIDE.md', () => {
    const table = text('KIT_GUIDE.md').split(/^## What lands where$/m)[1]?.split(/^## /m)[0];
    assert.ok(table, 'KIT_GUIDE.md has no section "What lands where"');
    const named = [...table.matchAll(/`([^`\s]+)`/g)].map((m) => m[1].replace(/\/$/, ''));
    for (const { dest } of kit.entries) {
      assert.ok(named.some((path) => dest === path || dest.startsWith(`${path}/`)), `KIT_GUIDE.md, "What lands where", does not name ${dest}`);
    }
  });
});

describe('the scripts and the data files', () => {
  it('every script and hook parses', () => {
    const scripts = ['imperata-kit.mjs', ...walk('starter/scripts'), ...walk(`${CLAUDE}/hooks`), ...walk('docs/images/src'), ...walk('tests')].filter((f) => f.endsWith('.mjs'));
    assert.ok(scripts.length > 10);
    for (const file of scripts) expectExit(run(process.execPath, ['--check', join(kitRoot, file)]), 0);
  });

  // The QA guard decides where the QA Engineer may write; the test lock decides which files it records. Each
  // carries its own copy of what a test file is, because a hook cannot count on a script being installed. A
  // file one of them takes for a test and the other does not would be written and never locked, or the reverse.
  it('the QA guard and the test lock agree on what a test file is', () => {
    const guard = text(`${CLAUDE}/hooks/qa-write-guard.mjs`);
    const lock = text('starter/scripts/lock-tests.mjs');
    const fn = (source, name) => source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0].replace(/\s+/g, ' ');
    for (const name of ['projectGlobs', 'globToRegex']) {
      assert.ok(fn(guard, name), `the QA guard has no ${name} any more`);
      assert.equal(fn(lock, name), fn(guard, name), `${name} is not the same in the QA guard and in the test lock`);
    }
    // The patterns each one tests a path against, apart from those about the run folder.
    const patterns = (source) => source.split('\n').map((line) => line.match(/(\/\S.*\/)\.test\((?:rel|plain)\)/)?.[1]).filter((p) => p && !p.startsWith('/^sdlc')).sort();
    assert.equal(patterns(guard).length, 7, 'one folder pattern, the specs/ folder of Spec Kit and five name patterns were expected in the QA guard');
    assert.deepEqual(patterns(lock), patterns(guard));
  });

  // A non-interactive session is denied every call outside this list, with nobody to ask, so the list holds the
  // commands a session needs, `echo` among them. `echo` is safe in the list only while the list lets files be
  // written under sdlc/ alone: Claude Code holds the target of a redirect to the Edit rules.
  it('the auto-run tool list for Claude Code allows echo, and writing under sdlc/ only', () => {
    const list = JSON.parse(text('starter/.orchestra/auto-run.json')).claude.allowedTools;
    assert.ok(list.includes('Bash(echo *)'), 'Bash(echo *) is not in the list');
    assert.deepEqual(list.filter((rule) => /^(Edit|Write|NotebookEdit)\b/.test(rule)), ['Edit(sdlc/**)']);
    const wide = list.filter((rule) => /^Bash(\(\*\))?$/.test(rule) || /^Bash\((sh|bash|zsh|node|npx|npm|git|tee|cp|mv|rm|sed|curl|eval)( \*)?\)$/.test(rule));
    assert.deepEqual(wide, [], 'the list allows a shell command that can write anywhere');
  });

  // `git log` and `git diff` write their output to any file with `--output=<file>`, which no Edit rule holds:
  // `git log -1 --format=tformat:<code> --output=scripts/render-run-board.mjs`, then the allowed
  // `node scripts/render-run-board.mjs`, runs code of the session's choosing with nobody watching. `git branch`
  // with a wildcard also allows `-D`. A session the board server starts needs only `git branch --show-current`.
  // This reads the rules as written; it cannot tell what another git command with a wildcard can write.
  it('the auto-run tool lists allow no git command that can write a file or delete a branch', () => {
    const auto = JSON.parse(text('starter/.orchestra/auto-run.json'));
    const git = [...auto.claude.allowedTools, ...auto.copilot.allowTool]
      .map((rule) => rule.match(/^(?:Bash|shell)\((git .*)\)$/)?.[1])
      .filter(Boolean)
      .map((rule) => rule.replace(/:\*$/, ' *'));
    const safe = ['git status', 'git status *', 'git rev-parse *', 'git branch --show-current'];
    assert.deepEqual(git.filter((rule) => !safe.includes(rule)), [], 'the list allows a git command beyond status, rev-parse and the current branch');
  });

  // A bare `Read` matches every file read, so an unattended session could read outside the repository (a key in
  // the home folder, for example) with nobody asked. Claude Code checks Grep and Glob against the Read rules.
  it('the auto-run tool list for Claude Code allows reading inside the repository only', () => {
    const list = JSON.parse(text('starter/.orchestra/auto-run.json')).claude.allowedTools;
    const reads = list.filter((rule) => /^Read\b/.test(rule));
    assert.deepEqual(reads, ['Read(./**)']);
  });

  // The hook that keeps agents out of decisions/ sees the file tools only. An auto-run session is allowed
  // `Edit(sdlc/**)` and `echo`, and Claude Code holds a redirect to the Edit rules, so `echo … > decisions/x.md`
  // could write a reply the owner never sent. A deny rule holds the file tools and redirects alike.
  it('the Claude Code settings deny every edit of the owner\'s decisions', () => {
    const { permissions } = JSON.parse(text('starter-claude-code/.claude/settings.json'));
    assert.ok(permissions.deny.includes('Edit(./sdlc/runs/*/decisions/**)'), 'edits of decisions/ are not denied');
  });

  // GNU `date -f <file>` prints every line of a file it cannot read as a date, so `date` with a wildcard lets an
  // unattended session read any file, `.env` and files outside the repository among them. The Orchestrator takes
  // the time with one command only.
  it('the auto-run tool lists allow date in the one form the Orchestrator uses', () => {
    const auto = JSON.parse(text('starter/.orchestra/auto-run.json'));
    const dates = [...auto.claude.allowedTools, ...auto.copilot.allowTool].filter((rule) => /^(Bash|shell)\(date\b/.test(rule));
    assert.deepEqual(dates.sort(), ['Bash(date -u +%Y-%m-%dT%H:%M:%SZ)', 'Bash(date)', 'shell(date -u +%Y-%m-%dT%H:%M:%SZ)'].sort());
  });

  // In pull-request mode on GitHub, the validator's --verify-remote asks gh for a pull request's statusCheckRollup,
  // which reads the workflow run behind each check. A token without actions: read fails the Imperata gates job on
  // the plan pull request with "Resource not accessible by integration (…checkSuite.workflowRun)".
  it('the CI example\'s token may read the workflow runs that --verify-remote asks gh about', () => {
    const validator = text('starter/scripts/validate-gates.mjs');
    assert.match(validator, /'pr', 'view'[^\n]*statusCheckRollup/, 'the validator no longer reads statusCheckRollup: check whether actions: read is still needed');
    const ci = text('starter/.github/workflows/pr-checks.yml.example');
    const block = ci.match(/^permissions:\n((?:[ \t]+.*\n)+)/m);
    assert.ok(block, 'the CI example has no top-level permissions block');
    const granted = Object.fromEntries([...block[1].matchAll(/^\s+([a-z-]+):\s*(\w+)/gm)].map((m) => [m[1], m[2]]));
    for (const scope of ['contents', 'pull-requests', 'checks', 'statuses', 'actions']) {
      assert.equal(granted[scope], 'read', `the CI example's token has no ${scope}: read`);
    }
    assert.ok(Object.values(granted).every((level) => level === 'read'), 'the CI example grants more than read');
  });

  // A job that runs the validator and the renderer from the pull request itself lets a pull request that changes
  // them judge itself with its own copy; and `for … in $(…)` over the changed manifests splits a path at a space.
  // An agent could also change those scripts, the workflows or the auto-run tool list unasked.
  it('the CI example judges a pull request with the base branch\'s scripts, and the settings ask before an edit of them', () => {
    const ci = text('starter/.github/workflows/pr-checks.yml.example');
    assert.match(ci, /git show "\$BASE_SHA:scripts\/\$script\.mjs"/, 'the validator is not taken from the base branch');
    // A pull request that changes only a locked test of a run in review, and not its manifest, is checked as well.
    assert.match(ci, /git ls-files -z -- 'sdlc\/runs\/\*\/run\.json'/, 'the job does not check every run of the repository');
    assert.doesNotMatch(ci, /for manifest in \$\(/, 'the changed manifests are split at spaces');
    const { permissions } = JSON.parse(text('starter-claude-code/.claude/settings.json'));
    for (const rule of ['Edit(./scripts/validate-gates.mjs)', 'Edit(./scripts/render-run-board.mjs)', 'Edit(./scripts/board-server.mjs)', 'Edit(./scripts/record-run.mjs)', 'Edit(./scripts/lock-tests.mjs)', 'Edit(./.github/workflows/**)', 'Edit(./.orchestra/auto-run.json)', 'Edit(./.orchestra/installed.json)']) {
      assert.ok(permissions.ask.includes(rule), `${rule} is not asked`);
    }
  });

  // A job that validates the manifests on the pull request's head only lets a pull request that deletes a run's
  // run.json, and weakens the run's locked test, pass "Imperata gates". The job's step is run here as GitHub runs
  // it, with stand-ins for the validator and the renderer that the base branch holds.
  it('the CI example fails a pull request that deletes the manifest of a run that is not finished', { skip: process.platform === 'win32' ? 'the step is a bash script' : false }, (t) => {
    const ci = text('starter/.github/workflows/pr-checks.yml.example').split('\n');
    const at = ci.findIndex((l) => l.includes('- name: Validate every run manifest'));
    const from = ci.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
    assert.ok(at > 0 && from > at, 'the step that validates every run manifest is not in the CI example');
    const indent = ci[from].match(/^\s*/)[0].length + 2;
    const body = [];
    for (const l of ci.slice(from + 1)) { if (l.trim() && l.match(/^\s*/)[0].length < indent) break; body.push(l.slice(indent)); }
    const root = mkdtempSync(join(tmpdir(), 'imperata-ci-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const sh = (...args) => { const r = run('git', args, { cwd: root }); assert.equal(r.status, 0, r.out); return r.stdout.trim(); };
    const put = (rel, content) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), content); };
    sh('init', '-q', '-b', 'main');
    put('scripts/validate-gates.mjs', "console.log('checked ' + process.argv[2]);\n");
    put('scripts/render-run-board.mjs', 'process.exit(0);\n');
    put('sdlc/runs/R1/run.json', '{ "runId": "R1", "currentStage": "IMPLEMENTING" }\n');
    put('sdlc/runs/R1/clarification.md', '# Clarification log\n');
    put('sdlc/runs/R2/run.json', '{ "runId": "R2", "currentStage": "DONE" }\n');
    put('sdlc/runs/R2/delivery.md', '# Delivery\n');
    put('tests/price.test.js', 'assert.equal(price(), 9);\n');
    sh('add', '-A');
    sh('commit', '-q', '-m', 'base');
    const base = sh('rev-parse', 'HEAD');
    const runner = mkdtempSync(join(tmpdir(), 'imperata-runner-'));
    t.after(() => rmSync(runner, { recursive: true, force: true }));
    const step = join(runner, 'step.sh');
    writeFileSync(step, body.join('\n'));
    const job = (...gone) => {
      sh('checkout', '-q', '--detach', base);
      sh('rm', '-q', '-r', ...gone);
      put('tests/price.test.js', 'assert.ok(true);\n');
      sh('commit', '-q', '-a', '-m', 'the pull request');
      return run('bash', ['--noprofile', '--norc', '-eo', 'pipefail', step], { cwd: root, env: { BASE_SHA: base, RUNNER_TEMP: runner, GH_TOKEN: 'none' } });
    };
    let r = job('sdlc/runs/R1/run.json');
    expectExit(r, 1);
    assert.match(r.out, /deletes sdlc\/runs\/R1\/run\.json and keeps the rest of the run's folder/);
    r = job('sdlc/runs/R1');
    expectExit(r, 1);
    assert.match(r.out, /deletes run R1, which is IMPLEMENTING on the base branch/);
    r = job('sdlc/runs/R2/run.json');
    expectExit(r, 1);
    r = job('sdlc/runs/R2');
    expectExit(r, 0);
    assert.match(r.out, /Run R2, DONE on the base branch, is removed with its folder/);
    assert.match(r.out, /checked sdlc\/runs\/R1\/run\.json/);
  });

  // A guard that names only some of the tools that write a file lets the others through: one that names Edit and
  // Write lets NotebookEdit through, and MultiEdit, which edits a file in several places.
  it('the Claude Code hooks that guard writes match every tool that writes a file', () => {
    const settings = JSON.parse(text(`${CLAUDE}/settings.json`));
    const matchers = [...settings.hooks.PreToolUse, ...settings.hooks.PostToolUse].map((h) => h.matcher);
    for (const role of ['developer', 'qa-engineer']) matchers.push(text(`${CLAUDE}/agents/${role}.md`).match(/matcher: "([^"]+)"/)[1]);
    for (const m of matchers) assert.deepEqual(m.split('|').sort(), ['Edit', 'MultiEdit', 'NotebookEdit', 'Write'], `the matcher "${m}" leaves out a tool that writes a file`);
  });

  // Claude Code reads `.env` files unless a rule denies them. Rules for `./.env` and `./.env.local` alone leave
  // `.env.production` and a `.env` in a sub-folder readable.
  it('the Claude Code settings deny reading every .env file, in any folder', () => {
    const { permissions } = JSON.parse(text('starter-claude-code/.claude/settings.json'));
    for (const rule of ['Read(**/.env)', 'Read(**/.env.*)']) assert.ok(permissions.deny.includes(rule), `${rule} is not denied`);
  });

  // `npx -y <package>@latest` downloads and runs whatever was published last, with nobody asked.
  it('the MCP examples run a pinned version of every package', () => {
    for (const file of ['starter/.mcp.example.json', 'starter/.vscode/mcp.example.json', 'starter-claude-code/.mcp.example.json']) {
      const servers = Object.values(JSON.parse(text(file)).mcpServers ?? JSON.parse(text(file)).servers);
      for (const s of servers.filter((s) => s.command === 'npx')) {
        const pkg = s.args.find((a) => !a.startsWith('-'));
        assert.match(pkg, /@\d+\.\d+\.\d+$/, `${file} runs ${pkg}, which names no version`);
      }
    }
  });

  // The rules for every agent say that the settings deny force-pushing. A rule matches the command text, so a
  // flag is denied only where a rule puts it: in Claude Code 2.1.326, a rule that denies
  // `git push --force origin main` does not deny `git push origin main --force`, `-f` at the end or `+main`.
  it('the Claude Code settings deny a force push wherever its flag stands', () => {
    const deny = JSON.parse(text(`${CLAUDE}/settings.json`)).permissions.deny;
    for (const flag of ['--force', '--force-with-lease', '-f']) {
      for (const rule of [`Bash(git push ${flag} *)`, `Bash(git push * ${flag})`, `Bash(git push * ${flag} *)`]) {
        assert.ok(deny.includes(rule), `${rule} is not among the denied rules`);
      }
    }
    assert.ok(deny.includes('Bash(git push * +*)'), 'a refspec that starts with "+" is not denied');
    // `--force-with-lease=<ref>` has no space after the flag, so `Bash(git push --force-with-lease *)` does not
    // match it; and `--mirror` overwrites and deletes every branch of the remote. Both are denied, not only asked for.
    for (const rule of ['Bash(git push --force-with-lease=*)', 'Bash(git push * --force-with-lease=*)', 'Bash(git push --mirror *)', 'Bash(git push * --mirror)', 'Bash(git push * --mirror *)']) {
      assert.ok(deny.includes(rule), `${rule} is not among the denied rules`);
    }
    assert.match(text(`${CLAUDE}/orchestra-rules.md`), /`\.claude\/settings\.json` denies merging a pull request with `gh` and force-pushing/);
  });

  // A plan can set a rule in a security-sensitive area that is approved with it, and a matrix the QA Engineer
  // derives from the criteria alone leaves that rule untested. Both layers have the plan say which decisions settle
  // such an area, and the Architect and the QA Engineer hold each one to a test; the validator reads it.
  it('the plan marks the decisions in a security-sensitive area, and both layers hold each to a test', () => {
    assert.match(text('starter/.orchestra/templates/technical-plan.template.md'), /\| ID \| Decision \| Alternatives rejected \| Security-sensitive area \| Needs approval from \|/);
    assert.match(text('starter/.orchestra/templates/test-plan.template.md'), /so has every decision of the technical plan that names a security-sensitive area: its ID goes in the AC column/);
    for (const layer of [[CLAUDE, 'agents/architect.md', 'agents/qa-engineer.md'], [COPILOT, 'agents/architect.agent.md', 'agents/qa-engineer.agent.md']]) {
      assert.match(text(`${layer[0]}/${layer[1]}`), /name under `Security-sensitive area` the area a decision settles[\s\S]*held by a test the QA Engineer writes, not by the code review alone/, `${layer[0]}: the Architect`);
      assert.match(text(`${layer[0]}/${layer[2]}`), /Every decision of the technical plan that names a security-sensitive area is a scenario of the matrix as well[\s\S]*name the decision's ID in the AC column/, `${layer[0]}: the QA Engineer`);
    }
  });

  // In `claude -p --permission-mode auto` nobody watches the session: a Developer can write a stack skill under
  // .claude/skills/, or a session edit .claude/hooks/owner-decisions-guard.mjs, with no denial. Claude Code's own
  // protection of .claude/ does not hold in auto mode. In Claude Code 2.1.326 the `Edit` rule alone denies such a
  // session an edit of a hook, a new skill file and .claude/settings.local.json, and allows a write to docs/. A
  // shell write is not covered. A `Write(<path>)` rule holds nothing: at the start of a session Claude Code 2.1.326
  // reports that `Write(./.claude/**)` "is not matched by file permission checks — only Edit(path) rules are".
  it('the Claude Code settings ask before every edit under .claude/, and allow none', () => {
    const { permissions } = JSON.parse(text(`${CLAUDE}/settings.json`));
    assert.ok(permissions.ask.includes('Edit(./.claude/**)'), 'Edit(./.claude/**) is not among the asked rules');
    const rules = [...(permissions.allow ?? []), ...permissions.ask, ...(permissions.deny ?? [])];
    assert.deepEqual(rules.filter((rule) => rule.startsWith('Write(')), [], 'Claude Code matches no Write(<path>) rule; an Edit rule covers every file-editing tool');
    const allowed = (permissions.allow ?? []).filter((rule) => /^(Edit|Write|NotebookEdit)\(.*\.claude/.test(rule));
    assert.deepEqual(allowed, [], 'a rule allows a write under .claude/');
    assert.match(text(`${CLAUDE}/orchestra-rules.md`), /asks before every push, pull request and issue write and before every edit under `\.claude\/`, of the kit's scripts, of the workflows and of `\.orchestra\/auto-run\.json` made with the file tools/);
  });

  it('every JSON file parses', () => {
    const files = ['kit.json', ...walk('starter'), ...walk('starter-claude-code')].filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 5);
    for (const file of files) assert.doesNotThrow(() => JSON.parse(text(file)), `${file} is not JSON`);
  });
});

describe('the kit version', () => {
  const v = kit.version.replaceAll('.', '\\.');

  it('is the one written in the guides', () => {
    for (const file of ['docs/README.md', 'KIT_GUIDE.md', 'USER_GUIDE.md']) {
      assert.match(text(file), new RegExp(`\\*\\*Kit version:\\*\\* ${v} `), `${file} gives another version`);
    }
    assert.match(text('USER_GUIDE.md'), new RegExp(`^imperata ${v} → `, 'm'));
  });

  it('has an entry in the changelog', () => {
    assert.match(text('CHANGELOG.md'), new RegExp(`^- \\*\\*Kit ${v} \\(\\d{4}-\\d{2}-\\d{2}\\):\\*\\*`, 'm'));
  });

  it('is the one on the landing page of the repository', () => {
    assert.match(text('README.md'), new RegExp(`\\*\\*Kit ${v}\\*\\*`));
  });

  // An install command that clones main takes whatever main holds that day. The install commands take the release
  // this version is, and a full clone: the installer reads the kit's history to recognise older kit files.
  it('is the release the install and update commands take', () => {
    for (const file of ['README.md', 'USER_GUIDE.md']) {
      const body = text(file);
      const clones = body.match(/^git clone .*$/gm) ?? [];
      assert.ok(clones.length, `${file} has no clone command`);
      for (const line of clones) {
        assert.match(line, new RegExp(`^git clone --branch v${v} https://\\S+/imperata\\.git `), `${file} clones another release: ${line}`);
        assert.doesNotMatch(line, /--depth|--single-branch/, `${file} makes a clone without the kit's history: ${line}`);
      }
      assert.doesNotMatch(body, /git -C \S+ pull/, `${file} updates the kit by pulling a branch`);
    }
    assert.match(text('USER_GUIDE.md'), new RegExp(`^git -C ~/tools/imperata checkout v${v}$`, 'm'));
  });

  // The commands that verify a release check the one the install commands take.
  it('is the release the verify commands check', () => {
    const commands = text('SECURITY.md').match(/^gh (?:release|attestation) .*$/gm) ?? [];
    assert.ok(commands.length, 'SECURITY.md has no command to verify a release');
    for (const line of commands) {
      assert.match(line, /--repo \S+\/imperata(?: |$)/, `a verify command names no repository: ${line}`);
      const versions = [...line.matchAll(/(?:v|imperata-)(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
      assert.ok(versions.length, `a verify command names no release: ${line}`);
      for (const found of versions) assert.equal(found, kit.version, `a verify command checks another release: ${line}`);
    }
  });
});

describe('the two layers', () => {
  const roles = (dir, suffix) => list(dir, (f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length));
  const sections = (rel) => text(rel).split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim());
  const ruleNames = (rel) => [...text(rel).matchAll(/^- \*\*([^*]+?)\.\*\*/gm)].map((m) => m[1]);

  it('have the same roles', () => {
    assert.deepEqual(roles(`${CLAUDE}/agents`, '.md'), roles(`${COPILOT}/agents`, '.agent.md'));
  });

  it('give the Orchestrator the same sections, in the same order', () => {
    assert.deepEqual(sections(`${CLAUDE}/agents/sdlc-orchestrator.md`), sections(`${COPILOT}/agents/sdlc-orchestrator.agent.md`));
  });

  it('state the same rules for every agent, apart from the one about hooks', () => {
    const claude = ruleNames(`${CLAUDE}/orchestra-rules.md`);
    const copilot = ruleNames(`${COPILOT}/instructions/orchestra.instructions.md`);
    assert.ok(copilot.length >= 8, `only ${copilot.length} rules found`);
    assert.deepEqual(claude.filter((n) => n !== 'Permission rules and hooks'), copilot);
  });

  // VS Code loads CLAUDE.md for GitHub Copilot as well, with the files it imports, so in a repository with both
  // layers a Copilot session reads the rules for Claude Code beside its own. A line there that names an agent
  // folder, a skills folder, a permission check or a hook of Claude Code without saying so reads as true of the
  // Copilot session. This shows that each such line names Claude Code; it cannot tell a line that holds in
  // Claude Code only but names none of these.
  it('name Claude Code in each rule of Claude Code that a Copilot session also reads, and tell Copilot such a rule is not its own', () => {
    const claudeOnly = /\.claude\/(agents|skills|hooks|settings\.json)|claude --agent|permission check|\bhooks?\b/i;
    let lines = 0;
    for (const line of text(`${CLAUDE}/orchestra-rules.md`).split('\n')) {
      if (!/^(- |[A-Z])/.test(line) || !claudeOnly.test(line)) continue;
      lines += 1;
      assert.ok(line.includes('Claude Code'), `a rule that holds in Claude Code only does not say so: ${line.trim().slice(0, 100)}`);
    }
    assert.ok(lines >= 4, `only ${lines} lines found that name a part of Claude Code; the pattern no longer matches`);
    assert.match(text(`${CLAUDE}/orchestra-rules.md`), /VS Code loads `CLAUDE\.md` for GitHub Copilot as well, with the files it imports/);
    assert.match(text(`${COPILOT}/instructions/orchestra.instructions.md`), /VS Code loads its `CLAUDE\.md` into this session as well, with the files it imports, among them the rules for Claude Code \(`\.claude\/orchestra-rules\.md`\)\. A line there that names Claude Code does not apply here/);
  });

  // Rules that hold whatever the agent tool is, so both layers state each one.
  const LAYERS = [['Claude Code', (role) => `${CLAUDE}/agents/${role}.md`, /\b(Edit|Write)\b/], ['Copilot', (role) => `${COPILOT}/agents/${role}.agent.md`, /'edit'/]];
  const SPECIALISTS = ['architect', 'business-analyst', 'code-reviewer', 'developer', 'qa-engineer', 'ux-designer'];
  const canWrite = ([, file, writes], role) => writes.test(text(file(role)).match(/^tools:.*$/m)[0]);

  // A specialist of Claude Code starts with what `CLAUDE.md` imports: the rules for every agent and the project
  // profile. VS Code loads neither into a specialist's session; otherwise a Copilot specialist would know nothing of
  // the rules for shell commands, the owner's decisions folder or the language of what the owner reads. So each
  // Copilot specialist is told, before anything else, to read both.
  it('give every specialist the rules for every agent and the project profile before any work', () => {
    const imports = text('starter-claude-code/CLAUDE.md');
    assert.match(imports, /^@\.claude\/orchestra-rules\.md$/m, 'CLAUDE.md does not import the rules for every agent');
    assert.match(imports, /^@\.orchestra\/project\.md$/m, 'CLAUDE.md does not import the project profile');
    for (const role of SPECIALISTS) {
      const body = text(LAYERS[1][1](role)).split(/^# .+$/m)[1].trim();
      const first = body.split(/\n\s*\n/)[0];
      assert.equal(first, "VS Code does not load `.github/instructions/orchestra.instructions.md`, the rules for every agent, or `.orchestra/project.md`, the project profile, into a specialist's session. Read both before any work, and follow them.", `Copilot: the ${role} is not told first to read the rules for every agent and the project profile`);
    }
  });

  it('let the same roles write files', () => {
    const writers = (layer) => SPECIALISTS.filter((role) => canWrite(layer, role));
    assert.deepEqual(writers(LAYERS[0]), ['developer', 'qa-engineer']);
    assert.deepEqual(writers(LAYERS[1]), writers(LAYERS[0]));
  });

  // A session can start on the model the Orchestrator's file names, and the Orchestrator needs no stronger, dearer
  // model than the Sonnet class. A role names the same class of model in both layers, and the tables of the guides
  // give what the files name.
  it('name the same class of model for every role, the Sonnet class for the Orchestrator, as the guides say', () => {
    const roles = ['sdlc-orchestrator', ...SPECIALISTS];
    const classOf = (file) => text(file).match(/^model: (?:claude-)?(opus|sonnet|haiku)\b/m)?.[1];
    const [claude, copilot] = LAYERS.map(([, file]) => Object.fromEntries(roles.map((role) => [role, classOf(file(role))])));
    for (const role of roles) assert.ok(claude[role], `Claude Code: ${role} names no model of a known class`);
    assert.deepEqual(copilot, claude);
    assert.equal(claude['sdlc-orchestrator'], 'sonnet', 'the Orchestrator\'s file does not name the Sonnet class');
    const NAMES = { 'sdlc-orchestrator': 'Orchestrator', architect: 'Architect', 'business-analyst': 'Business Analyst', 'code-reviewer': 'Code Reviewer', developer: 'Developer', 'qa-engineer': 'QA Engineer', 'ux-designer': 'UX Designer' };
    const layerGuide = text('starter-claude-code/CLAUDE_CODE_GUIDE.md');
    const userGuide = text('USER_GUIDE.md');
    for (const role of roles) {
      assert.ok(layerGuide.includes(`| \`${role}\` | \`${claude[role]}\` |`), `CLAUDE_CODE_GUIDE.md gives another model than the file of ${role}`);
      assert.match(userGuide, new RegExp(`^\\| \\*\\*${NAMES[role]}\\*\\*.*\\| \`${claude[role]}\`(, or per task)? \\|$`, 'm'), `USER_GUIDE.md gives another model than the file of ${role}`);
    }
    assert.match(text('starter/STARTER_GUIDE.md'), /`claude-sonnet-5\.5` for the Orchestrator, /, 'STARTER_GUIDE.md does not give the Orchestrator\'s model');
  });

  it('tell every specialist which outcomes it may return', () => {
    for (const [name, file] of LAYERS) {
      for (const role of SPECIALISTS) {
        const outcomes = role === 'code-reviewer' ? /APPROVE_FOR_HUMAN_REVIEW or CHANGES_REQUIRED/ : /COMPLETED \| BLOCKED \| NEEDS_DECISION \| FAILED/;
        assert.match(text(file(role)), outcomes, `${name}: ${role} is not told what to return`);
      }
    }
  });

  it('tell an agent that can write files to leave the run manifest alone', () => {
    for (const layer of LAYERS) {
      for (const role of SPECIALISTS.filter((r) => canWrite(layer, r))) {
        assert.match(text(layer[1](role)), /Do not edit `(sdlc\/runs\/<runId>\/)?run\.json`/, `${layer[0]}: ${role} may edit run.json`);
      }
    }
  });

  it('tell an agent that cannot write files to return its work as text', () => {
    for (const layer of LAYERS) {
      for (const role of SPECIALISTS.filter((r) => !canWrite(layer, r))) {
        assert.match(text(layer[1](role)), /[Rr]eturn [^.]* as text/, `${layer[0]}: ${role} cannot write a file and is not told to return its work`);
      }
    }
  });

  it('have the Orchestrator save the diff that the Code Reviewer, who has no shell, reads', () => {
    for (const [name, file] of LAYERS) {
      assert.match(text(file('sdlc-orchestrator')), /evidence\/delivery\.diff/, `${name}: the Orchestrator saves no diff`);
      assert.match(text(file('code-reviewer')), /evidence\/delivery\.diff/, `${name}: the Code Reviewer is not told where the diff is`);
    }
  });

  // Every agent reads this summary. A hook does not see a manifest written by a shell command, so the summary
  // says that hooks act on edits made with the file tools only.
  it('say in the rules for every agent of Claude Code what the hooks do not cover', () => {
    assert.match(text(`${CLAUDE}/orchestra-rules.md`), /Hooks act on edits made with the file tools, not on shell writes: they validate each run manifest after it is edited, render the run board after each edit in a run folder/);
  });

  // In a session nobody watches, a call that joins commands (`…; echo "exit=$?"`, `{ }`, a heredoc, `node -e`
  // writing run.json) is denied, and a delegation whose calls are denied may run no test at all. One command per
  // call, and files written with the file tools, pass the permission rules.
  it('tell every agent to run one command per shell call and to write files with the file tools', () => {
    for (const rel of [`${CLAUDE}/orchestra-rules.md`, `${COPILOT}/instructions/orchestra.instructions.md`]) {
      assert.match(text(rel), /Run one command per shell call; the call's result shows its output and, when it fails, its exit code\. Do not join commands with `;`, `&&`, `\|\|` or `\|`, group them in `\{ \}`, or add `echo "exit=\$\?"`, `\$\( \)` or a heredoc/, rel);
      assert.match(text(rel), /Write and change files with the (file tools|edit tool), not with `cat >`, `tee`, `sed -i`, `python3` or `node -e`/, rel);
    }
  });

  // A character that cannot be seen, such as a decomposed input of a criterion, can be lost between saves with
  // nobody seeing it go.
  it('have the Business Analyst write a character that cannot be seen as an escape', () => {
    for (const [name, file] of LAYERS) {
      assert.match(text(file('business-analyst')), /Write a character that cannot be seen, or that looks like another[\s\S]*as its escape, such as `\\u0302`/, `${name}: the analyst is not told`);
    }
  });

  // In a repository that holds a team's coding convention in a stack skill, an analyst that reads only the product
  // sources and the profile may ask the owner what a rule of the skill decides, or assume against that rule. This
  // shows that the analyst is sent to the skills of its own layer and told what a rule there is. It cannot tell
  // whether a draft follows it.
  it('have the Business Analyst read the stack skills and take a rule of one as decided', () => {
    for (const [name, file] of LAYERS) {
      const analyst = text(file('business-analyst'));
      const folder = name === 'Claude Code' ? '.claude/skills/' : '.github/skills/';
      assert.ok(analyst.includes(`Read the \`SKILL.md\` of every stack skill of the repository: each folder under \`${folder}\``), `${name}: the analyst is not sent to the stack skills under ${folder}`);
      assert.match(analyst, /A rule of a stack skill is decided[\s\S]*approved constraint[\s\S]*Do not ask the owner what such a rule settles, and write no assumption and no criterion against it/, `${name}: the analyst may ask about a rule of a stack skill, or assume against it`);
      assert.match(analyst, /cannot both hold, that is a question for the owner/, `${name}: the analyst is not told what to do when a skill and a confirmed rule disagree`);
    }
  });

  it('say that a specialist neither delegates further nor approves its own work', () => {
    for (const rel of [`${CLAUDE}/orchestra-rules.md`, `${COPILOT}/instructions/orchestra.instructions.md`]) {
      assert.match(text(rel), /never delegates further and never approves its own work/, rel);
    }
  });

  // The description is what a tool shows for an agent and what the Orchestrator's model reads when it picks
  // one, so every specialist has a description of its own, in the same words in both layers.
  it('describe every specialist in the same words', () => {
    const description = (rel) => text(rel).match(/^description: (.+)$/m)?.[1];
    for (const role of SPECIALISTS) {
      const claude = description(LAYERS[0][1](role));
      assert.ok(claude && claude.length > 60, `Claude Code: ${role} is not described`);
      assert.equal(description(LAYERS[1][1](role)), claude, `Copilot: ${role} is described in other words`);
    }
  });

  // Every run artifact follows a template, and the Orchestrator is told to invent no other structure. The
  // design brief, which a specialist returns as text, has a template as well to give it its shape.
  it('give the UX Designer, who cannot write files, the shape of the design brief', () => {
    for (const [name, file] of LAYERS) {
      assert.match(text(file('ux-designer')), /in the shape of `\.orchestra\/templates\/design\.template\.md`[^.]*persist as `design\.md`/, `${name}: the UX Designer is not told the shape of its brief`);
    }
  });

  // The design brief is written before the plan and approved with it. Unless those who work after the UX Designer
  // are told to read it, it can be approved and then built from the plan alone.
  it('tell the Architect and the Developer to read the design brief, when the run has one', () => {
    for (const [name, file] of LAYERS) {
      assert.match(text(file('architect')), /When the run has a design brief \(`sdlc\/runs\/<runId>\/design\.md`\), read it before planning/, `${name}: the Architect is not told to read the design brief`);
      assert.match(text(file('developer')), /the run has a design brief \(`sdlc\/runs\/<runId>\/design\.md`\), read the brief before you write code/, `${name}: the Developer is not told to read the design brief`);
    }
  });

  // The two who check the work independently read the brief as well: the QA Engineer takes its states and
  // criteria into the test matrix, the Code Reviewer holds the patch against it and marks it in the review.
  it('tell the QA Engineer and the Code Reviewer to read the design brief, when the run has one', () => {
    for (const [name, file] of LAYERS) {
      assert.match(text(file('qa-engineer')), /When the run has a design brief \(`sdlc\/runs\/<runId>\/design\.md`\), read it before you write the matrix/, `${name}: the QA Engineer is not told to read the design brief`);
      assert.match(text(file('code-reviewer')), /When the run has a design brief \(`sdlc\/runs\/<runId>\/design\.md`\), read it\. For each screen the patch builds or changes, check the patch against/, `${name}: the Code Reviewer is not told to read the design brief`);
    }
    assert.match(text('starter/.orchestra/templates/review.template.md'), /^- The design brief, when the run has one/m, 'the review template has no line for the design brief');
  });

  // An analyst with no limit can ask the owner dozens of questions, many in one round, where the owner would take
  // its recommendation on most. The analyst asks at most five at a time and writes a point a reasonable default
  // settles as an assumption of the specification, approved with it.
  it('have the Business Analyst ask at most five questions and write a reasonable default as an assumption', () => {
    for (const [name, file] of LAYERS) {
      assert.match(text(file('business-analyst')), /do not ask: write the default under "Assumptions" in the specification[\s\S]*Return at most five questions needed before one gate, counting those still open before that gate/, `${name}: the Business Analyst is not held to five questions and assumptions`);
    }
    for (const rel of [`${CLAUDE}/skills/run-board/SKILL.md`, `${COPILOT}/skills/run-board/SKILL.md`]) {
      assert.match(text(rel), /List only the questions needed before the next gate, at most five, or up to ten when each one past five is in a security-sensitive area;[^\n]*list the specification's assumptions as well/, `${rel}: the decision brief allows more than five questions or leaves out the assumptions`);
    }
    assert.match(text('starter/.orchestra/templates/feature-spec.template.md'), /^## Assumptions\n[\s\S]*^\| ID \| Assumption \|/m, 'the specification template has no "Assumptions" table');
  });

  // Spec Kit's coverage categories lead an analyst to points of the sources it would otherwise pass over. Under a
  // limit of five questions, an analyst may also move an open question to a later gate to stay under it, or write
  // criteria that hold the outcome of each option; it is told to do neither.
  it('have the Business Analyst scan every category, keep a question at its gate, and write no criterion that waits on one', () => {
    for (const [name, file] of LAYERS) {
      const analyst = text(file('business-analyst'));
      assert.match(analyst, /scan the sources for the feature against each of these categories and mark it Clear, Partial or Missing/, `${name}: the analyst does not scan the categories`);
      for (const category of ['identity and uniqueness', 'lifecycle and the changes after creation', 'data volume and scale', 'accessibility and localization', 'conflicting or concurrent changes', 'one term for one concept']) {
        assert.ok(analyst.includes(category), `${name}: the scan has no "${category}"`);
      }
      assert.match(analyst, /Each category marked Partial or Missing that matters to the feature becomes a question or an assumption/, `${name}: a gap the scan finds goes nowhere`);
      assert.match(analyst, /A question past the limit waits for that round: its gate is the one before which its answer changes something, never a later gate chosen to stay under the limit/, `${name}: a question may move to a later gate to stay under five`);
      assert.match(analyst, /A criterion whose outcome depends on an open question is not written yet/, `${name}: the analyst may write a criterion that waits on a question`);
    }
  });

  // A bug run shows its bug before the specification is approved, plans from the root cause, and has its review
  // check that the patch removes that cause.
  it('give the Business Analyst, the QA Engineer, the Architect and the Code Reviewer their part of a bug run', () => {
    for (const [name, file] of LAYERS) {
      assert.match(text(file('business-analyst')), /In a bug run \(`kind: bug`\), fill the "Defect" section of the specification/, `${name}: the Business Analyst has no Defect section to write`);
      assert.match(text(file('qa-engineer')), /In a bug run \(`kind: bug`\) you are first delegated to reproduce the bug[\s\S]*fails on the code as committed because of the bug; change no application code/, `${name}: the QA Engineer is not told to reproduce the bug`);
      assert.match(text(file('architect')), /In a bug run \(`kind: bug`\), begin the plan with the root cause/, `${name}: the Architect is not told to start from the root cause`);
      assert.match(text(file('code-reviewer')), /In a bug run \(`kind: bug`\), check that the patch removes the root cause the plan names/, `${name}: the Code Reviewer does not check the root cause`);
    }
    assert.match(text('starter/.orchestra/templates/feature-spec.template.md'), /^## Defect\n/m, 'the specification template has no Defect section');
    assert.match(text('starter/.orchestra/templates/technical-plan.template.md'), /^## Root cause\n/m, 'the plan template has no Root cause section');
    for (const dir of [CLAUDE, COPILOT]) assert.ok(existsSync(join(kitRoot, `${dir}/skills/imperata-bug/SKILL.md`)), `${dir}: no command starts a bug run`);
  });

  // A bug run can grow past its bug: criteria for behaviour the fix leaves alone, which tests of the repository
  // already hold, bring tests that fail for no fault put into the code. A plan that says which tests the QA
  // Engineer writes takes them from the one who derives them, and a row under "Not covered" that names no
  // criterion stays open to DONE unless the QA Engineer is told what a gap is.
  it('keep a bug run to its regression criterion, leave the tests to the QA Engineer, and say what a gap is', () => {
    for (const [name, file] of LAYERS) {
      assert.match(text(file('business-analyst')), /It is the only criterion unless the fix needs another\. Behaviour next to the defect that the fix must leave as it is gets a criterion only where no test of the repository holds it: search the tests, name what they hold under "Must stay as it is"/, `${name}: the Business Analyst writes a criterion for what a test already holds`);
      assert.match(text(file('qa-engineer')), /After the fix, test the criteria of the specification and no others/, `${name}: the QA Engineer tests more than the criteria of a bug run`);
      assert.match(text(file('qa-engineer')), /"Not covered" holds a criterion, a case, a decision or a mandatory test that has no passed test, and nothing else: whether your tests fail without the change is the calibration's to show and no gap/, `${name}: the QA Engineer is not told what a gap is`);
      assert.match(text(file('qa-engineer')), /not solely from developer tests, and not from a list of tests in the plan/, `${name}: the QA Engineer may take its tests from the plan`);
      assert.match(text(file('architect')), /How the criteria are tested is the QA Engineer's to derive from them: name no test file to write and give no table of what a test asserts/, `${name}: the Architect may plan the tests`);
      assert.match(text(file('architect')), /reads `N\/A — <reason>`, in one line, and a diagram is drawn only where the fix changes a boundary or an interaction: a change inside one function changes neither\. A decision is a choice the owner approves/, `${name}: the Architect is not told how short the plan of a bug run is`);
    }
    const template = (f) => text(`starter/.orchestra/templates/${f}.template.md`);
    assert.match(template('feature-spec'), /^- Must stay as it is: .*the test file of the repository that holds it/m, 'the specification template has no place for what must stay');
    assert.match(template('feature-spec'), /It is the only criterion unless the fix needs another/, 'the specification template does not bound a bug run');
    assert.match(template('technical-plan'), /It names no test file to write and says nothing of what a test asserts/, 'the plan template lets the plan set the tests');
    assert.match(template('test-plan'), /What the calibration shows, such as whether the tests fail without the change, is no gap/, 'the test plan template does not say what a gap is');
    assert.match(template('delivery'), /from `REVIEWING` on `scripts\/validate-gates\.mjs` warns where a row differs/, 'the dossier template does not say that its Gates table is compared with the manifest');
  });

  // A plan that has the tests written and locked before implementation, and cuts the work into layers that only
  // the last task joins, leaves the QA Engineer no code to run: it may write the application a second time outside
  // the repository. Implementation that goes from task to task with nobody asked leaves the owner nothing to check
  // until the end. A run is implemented one task at a time: the Developer, then the QA Engineer for that task's
  // criteria, then a stop for the owner, with the check the plan names for the task.
  it('implement a run one task at a time, with the owner\'s check after each, in every file that has a part in it', () => {
    for (const [name, file] of LAYERS) {
      const architect = text(file('architect'));
      assert.match(architect, /Cut the work into tasks that each add behaviour a person can reach when the task is done[\s\S]*ahead of layers that only the last task joins/, `${name}: the Architect may cut the work into layers nobody can try`);
      assert.match(architect, /Give every task an `Owner check` field: what the owner runs or opens once the task is done, and what to expect/, `${name}: the Architect gives a task no Owner check`);
      assert.match(architect, /The plan does not set the order of the roles\.[\s\S]*do not plan tests that are written before the code they test, or one test step for several tasks/, `${name}: the Architect may plan the tests before the code`);
      const qa = text(file('qa-engineer'));
      assert.match(qa, /the Orchestrator delegates one task to you at a time, after the Developer has implemented it\. Test the criteria that task names/, `${name}: the QA Engineer is not told that it tests one task at a time`);
      assert.match(qa, /Write no implementation of the application to try them against, in the repository or outside it, and write no file outside the repository/, `${name}: the QA Engineer may write the application a second time`);
      assert.match(qa, /If the code a test needs does not exist yet, return `BLOCKED`; no test is written before the code it tests, except to reproduce a bug/, `${name}: the QA Engineer may write a test before its code`);
      const developer = text(file('developer'));
      assert.match(developer, /implement the task you are delegated and no other/, `${name}: the Developer may take several tasks at once`);
      assert.match(developer, /In a later task or a repair, do not change, delete, rename, skip or weaken a locked test/, `${name}: the Developer may change a locked test in a later task`);
    }
    const plan = text('starter/.orchestra/templates/technical-plan.template.md');
    assert.match(plan, /^- \*\*Owner check:\*\* /m, 'the plan template gives a task no Owner check');
    assert.match(plan, /The plan sets no other order, and no test is written before the code it tests\./, 'the plan template does not say in which order a task is built and tested');
    const delivery = text('starter/.orchestra/templates/delivery.template.md');
    assert.match(delivery, /^## Checked by the owner\n[\s\S]*^\| Task \| Commit \| Owner's word \| At \|$/m, 'the delivery template has no table for the owner\'s word after each task');
    assert.match(delivery, /Empty while the run waits for the owner\. Nobody writes it for the owner\./, 'the delivery template does not say who writes the owner\'s word');
    for (const dir of [CLAUDE, COPILOT]) {
      const command = text(`${dir}/skills/imperata-implement/SKILL.md`);
      assert.match(command, /Implement one task at a time \("Task by task"\): delegate the task to Developer, then have QA test that task's criteria \*\*independently\*\*[\s\S]*then stop with your report so that I can check the task\. Go on to the next task only when I tell you to\./, `${dir}: the implement command does not stop after a task`);
      assert.match(command, /When the last task built still waits for my check and the plan has a task left to build, this command is my word to go on, unless what I write after the run ID says otherwise/, `${dir}: the implement command, sent again, is not the owner's word to go on`);
    }
  });

  // A delegation given no model runs on the one the tool takes, and a rule of Copilot's own lets the agent set it
  // only when the user names a model. An approval card of the plan that names no decision has the owner approve
  // decisions unseen. An option that leaves a value to the owner, with an example, can be recorded as the choice
  // of the example.
  it('name the model of each task in the implement command, list the plan\'s decisions for the owner, and leave no value open in an option', () => {
    for (const dir of [CLAUDE, COPILOT]) {
      assert.match(text(`${dir}/skills/imperata-implement/SKILL.md`), /For each delegation of a task I name the model: the one your "Model per task" table gives for the task's `Complexity`\. Pass it wherever the delegation tool takes a model\./, `${dir}: the implement command does not name the model of a task for the owner`);
    }
    const preflight = text(`${COPILOT}/skills/imperata-preflight/SKILL.md`);
    assert.match(preflight, /whether the delegation tool takes a model argument/, 'the Copilot preflight does not look at the delegation tool\'s model argument');
    assert.match(preflight, /Say which model this session runs on, and remind me to select the model the Orchestrator's file names in the model picker/, 'the Copilot preflight does not say which model the session runs on');
    const guide = text('starter/STARTER_GUIDE.md');
    assert.match(guide, /Copilot's `task` tool takes a model argument, but by the Orchestrator's own account a rule of Copilot's lets it set a model only when the user names one/, 'the starter guide still does not say what Copilot\'s delegation tool does with a model');
    assert.match(guide, /runs on the model selected in the chat's model picker, not on the one its file names: select that model before you send a command/, 'the starter guide does not say which model the Orchestrator\'s session runs on');
    for (const [name, file] of LAYERS) {
      assert.match(text(file('business-analyst')), /Every option states the value the owner takes with it, so that choosing it decides the question: never leave a value for the owner to fill in/, `${name}: the analyst may leave the value of an option to the owner`);
      assert.match(text(file('architect')), /Begin every decision with what is decided, in one sentence: the owner approves the decisions with the plan, and the approval card of the plan lists them from that sentence/, `${name}: the Architect does not write a decision so that the approval card can show it`);
    }
    assert.match(text('starter/.orchestra/templates/clarification.template.md'), /Each option states the value the owner takes with it; none leaves a value for the owner to fill in/, 'the clarification template lets an option leave its value open');
    assert.match(text('starter/.orchestra/templates/technical-plan.template.md'), /The owner approves these decisions with the plan, and the approval card of the plan lists them, those in a security-sensitive area first\./, 'the plan template does not say that the owner approves the decisions with the plan');
  });

  // Each step has a command of its own that says what it does: the step after the start is the plan, and
  // verification (the whole suite, the calibration and the review) is not the implement command sent again. Each
  // task is tested at its own level, so the whole suite runs at standard: on the strongest model it would be the
  // dearest delegation of a run. An optional field that needs no migration does not make a task `high` by itself.
  // At `DONE` the owner hears whether the ticket and the product documents still list the delivery as work to come.
  it('name the step after the start "plan", verify with a command of its own at standard, rate an optional field no higher for itself, and say at DONE what still reads as planned', () => {
    for (const dir of [CLAUDE, COPILOT]) {
      const plan = text(`${dir}/skills/imperata-plan/SKILL.md`);
      assert.match(plan, /^name: imperata-plan$/m, `${dir}: the plan command has another name`);
      assert.match(plan, /^description: Plan an Imperata run once its specification is approved/m, `${dir}: the plan command does not say what it does`);
      assert.ok(!existsSync(join(kitRoot, `${dir}/skills/imperata-continue`)), `${dir}: the continue command is still shipped beside the plan command`);
      const implement = text(`${dir}/skills/imperata-implement/SKILL.md`);
      assert.match(implement, /This command builds tasks and nothing after them\. When every task of the plan is built, and what I write after the run ID reports nothing wrong with the last one, do nothing else: tell me to send `\/imperata-verify` with the run ID/, `${dir}: the implement command still verifies`);
      assert.ok(!/whole suite|Code Reviewer|READY_FOR_ACCEPTANCE/.test(implement), `${dir}: the implement command still names a step of verification`);
      const verify = text(`${dir}/skills/imperata-verify/SKILL.md`);
      assert.match(verify, /If a task of its plan is not built yet, do nothing else: tell me which, and to send `\/imperata-implement`/, `${dir}: the verify command builds tasks`);
      assert.match(verify, /When the last task still waits for my check, this command is my word to go on, unless what I write after the run ID says otherwise/, `${dir}: the verify command is not the owner's word for the last task`);
      assert.match(verify, /For that delegation I name the model: the one your "Model per task" table gives for `standard`, whatever the levels of the tasks/, `${dir}: the verify command does not name the model of the whole suite`);
      assert.match(verify, /Stop at READY_FOR_ACCEPTANCE for human review, and repeat the board's "Check before you decide" list when you ask for acceptance/, `${dir}: the verify command does not say where it stops`);
      assert.match(verify, /from the stage its manifest records/, `${dir}: the verify command begins again whatever the stage`);
      assert.match(verify, /Where the whole suite and the review are done already and I answered review findings or requested changes, do not start over: repair what I answered/, `${dir}: the verify command runs the whole suite again before a repair`);
      assert.match(verify, /For each repair I name the model as well: the one your table gives for the level the repair runs at/, `${dir}: the verify command names no model for a repair`);
      assert.match(text(`${dir}/skills/imperata-preflight/SKILL.md`), /the eight `imperata-\*` commands/, `${dir}: the preflight counts another number of commands`);
      for (const name of ['imperata-merge', 'imperata-close']) {
        assert.match(text(`${dir}/skills/${name}/SKILL.md`), /Tell me whether the run's ticket and the product sources still describe what was delivered as work to come, and change none of them unless I tell you to/, `${dir}: ${name} says nothing of a ticket or a document that still lists the delivery as planned`);
      }
    }
    const plan = text('starter/.orchestra/templates/technical-plan.template.md');
    assert.match(plan, /changes stored data so that it needs a migration, or so that data written before the change can no longer be read/, 'the plan template rates any change of data high');
    assert.match(plan, /An optional field, with no migration and with data written before it still read, does not make a task `high` by itself/, 'the plan template does not say that an optional field is not high by itself');
    const delivery = text('starter/.orchestra/templates/delivery.template.md');
    assert.match(delivery, /`verification`: the whole suite after the last task\. Write `all` under Task; it runs at `standard`/, 'the delivery template has no row for the whole suite');
  });

  // A specification can multiply its criteria: the line a command prints and its exit code as two of them, or each
  // refused value of one argument as one. A criterion is one behaviour, and the values it holds for are its cases,
  // each held to a test as a criterion is.
  it('write a criterion as one behaviour with its cases, and hold every case to a test', () => {
    const spec = text('starter/.orchestra/templates/feature-spec.template.md');
    assert.match(spec, /Each criterion is one behaviour a test can decide: one thing a person does, and what can be observed of its result/, 'the specification template still asks for one outcome a criterion');
    assert.match(spec, /What a command prints and its exit code are one result, not two criteria/, 'the specification template lets a result be split into criteria');
    assert.match(spec, /^### Cases of AC-01$[\s\S]*^\| Case \| Input \| Expected \|$[\s\S]*^\| AC-01\.1 \|/m, 'the specification template has no table for the cases of a criterion');
    assert.match(spec, /`scripts\/validate-gates\.mjs` warns above twelve/, 'the specification template does not say when there are too many criteria');
    assert.match(spec, /it requires every criterion without cases, and every case, to have a passed test in the test report or an accepted gap in the test plan/, 'the specification template does not hold a case to a test');
    const testPlan = text('starter/.orchestra/templates/test-plan.template.md');
    assert.match(testPlan, /Where a criterion has cases, every case is named by a test, alone \(`AC-03\.2`\) or in a range \(`AC-03\.1\.\.AC-03\.4`\)/, 'the test plan template does not say how a test names a case');
    assert.match(testPlan, /naming the criterion alone covers none of its cases/, 'the test plan template lets a test stand for every case of a criterion');
    assert.match(testPlan, /A row that names a criterion accepts the gap for all its cases/, 'the test plan template does not say what a gap of a criterion with cases covers');
    assert.match(text('starter/.orchestra/templates/test-report.template.md'), /Where a criterion has cases it names the cases, one \(`AC-03\.2`\) or a range \(`AC-03\.1\.\.AC-03\.4`\): a test over a table of cases is one row/, 'the test report template does not say how a row names cases');
    assert.match(text('starter/.orchestra/templates/technical-plan.template.md'), /where it carries out only some cases of a criterion, it names those cases \(`AC-03\.1\.\.AC-03\.4`\)/, 'the plan template does not say how a task names cases');
    const rules = text('starter/.orchestra/test-rules.md');
    assert.match(rules, /A test over the cases of one criterion counts as one test, when each case runs and fails by itself and its failure names the case/, 'the rules for tests do not say when a test over cases is one test');
    assert.match(rules, /when an accepted criterion, or a case of one, has no test and no accepted gap/, 'the rules for tests do not hold a case to a test');
    for (const [name, file] of LAYERS) {
      const analyst = text(file('business-analyst'));
      assert.match(analyst, /One behaviour per criterion: one thing a person does and all that can be observed of its result, so that what a command prints and its exit code are one criterion, not two/, `${name}: the analyst still writes one outcome a criterion`);
      assert.ok(!/One observable outcome per criterion/.test(analyst), `${name}: the analyst is told both to split outcomes and to keep them together`);
      assert.match(analyst, /write one criterion and give the values as its cases: a row each, with what a test observes, in a "Cases of AC-NN" table as the template shows/, `${name}: the analyst does not write the values of a rule as cases`);
      assert.match(analyst, /The id of a case is the id of its criterion, a point and a number \(`AC-03\.2`\)/, `${name}: the analyst is not told how a case is named`);
      assert.match(analyst, /A rule that rejects something gets a criterion for the rejection and its reason, with each refused value as a case/, `${name}: the analyst writes a criterion for each refused value`);
      assert.match(analyst, /A ticket seldom needs more than a dozen criteria/, `${name}: the analyst is not told when there are too many criteria`);
      const qa = text(file('qa-engineer'));
      assert.match(qa, /A criterion with cases is tested case by case: every case has a test, and the AC column of the matrix and of the test report names the cases a test covers, one \(`AC-03\.2`\) or a range \(`AC-03\.1\.\.AC-03\.4`\)/, `${name}: the QA Engineer does not test a criterion case by case`);
      assert.match(qa, /A test that runs over a table of cases is one row with that range; naming the criterion alone covers none of its cases/, `${name}: the QA Engineer may name the criterion for all its cases`);
      assert.match(text(file('code-reviewer')), /or when an accepted criterion, or a case of one, has neither a test nor an accepted gap in the test plan/, `${name}: the Code Reviewer does not look for a case without a test`);
    }
  });

  it('ship the same two skills', () => {
    for (const skill of ['quality-gates', 'run-board']) {
      assert.ok(existsSync(join(kitRoot, `${CLAUDE}/skills/${skill}/SKILL.md`)), `${skill} is missing in the Claude Code layer`);
      assert.ok(existsSync(join(kitRoot, `${COPILOT}/skills/${skill}/SKILL.md`)), `${skill} is missing in the Copilot layer`);
    }
  });

  // Each step is a command, `/imperata-start <feature>` and the like, not a prompt a person copies and fills in
  // by hand, with placeholders that may not apply in the run's approval mode. A command is a skill that only the
  // person can run: one the agent could load by itself would let the Orchestrator give itself the owner's
  // instructions, the one to merge among them. In Claude Code 2.1.326 the person's `/name <text>` runs in a session
  // started with `--agent`, with the text added as `ARGUMENTS: <text>`, and the agent's own call of the Skill tool
  // is refused. Under Copilot this rests on the VS Code documentation. Both tools get the same text, apart from the
  // preflight, which checks what each tool needs.
  it('give both tools the same commands, which only the person can run', () => {
    const commands = (dir) => list(`${dir}/skills`, (f) => f.startsWith('imperata-'));
    assert.deepEqual(commands(CLAUDE), ['imperata-bug', 'imperata-close', 'imperata-implement', 'imperata-merge', 'imperata-plan', 'imperata-preflight', 'imperata-start', 'imperata-verify']);
    assert.deepEqual(commands(COPILOT), commands(CLAUDE));
    for (const name of commands(CLAUDE)) {
      for (const [tool, dir] of [['claude', CLAUDE], ['copilot', COPILOT]]) {
        const src = `${dir}/skills/${name}/SKILL.md`;
        const head = text(src).split(/^---$/m)[1] ?? '';
        assert.match(head, new RegExp(`^name: ${name}$`, 'm'), `${src}: the name is not the folder's, and Copilot skips such a skill`);
        assert.match(head, /^description: \S/m, `${src} has no description`);
        // A colon and a space in a description make it no plain YAML value: the front matter cannot be read, and
        // the tool does not list the command.
        for (const line of head.split("\n").filter((l) => /^[a-z-]+: /.test(l))) assert.ok(!/: /.test(line.replace(/^[a-z-]+: /, "")) || /^[a-z-]+: ["']/.test(line), `${src}: "${line.slice(0, 60)}…" holds ": " in a plain value, so its front matter is not valid YAML and the command is not listed`);
        assert.match(head, /^disable-model-invocation: true$/m, `${src}: the agent could run the command by itself`);
        assert.ok(kit.entries.some((e) => e.tools?.includes(tool) && src.startsWith(`${e.src}/`)), `${src} is not installed for ${tool}`);
      }
      if (name === 'imperata-preflight') continue;
      assert.equal(text(`${COPILOT}/skills/${name}/SKILL.md`), text(`${CLAUDE}/skills/${name}/SKILL.md`), `${name} says something else under Copilot`);
      assert.match(text(`${CLAUDE}/skills/${name}/SKILL.md`), /If you are not the SDLC Orchestrator, do nothing else/, `${name} would run in a session that is not the Orchestrator's`);
    }
    assert.ok(!kit.entries.some((e) => e.dest.startsWith('prompts/')), 'kit.json still installs a prompt beside the commands');
    for (const { dest } of kit.entries) assert.ok(!kit.retired.some((r) => r.dest === dest), `${dest} is installed and retired at once`);
  });
});

describe('what the instructions point at', () => {
  // The source in the kit of a path as a project sees it, through kit.json; null when the kit installs no such path.
  function sourceOf(path) {
    for (const entry of kit.entries) {
      if (path === entry.dest) return entry.src;
      if (path.startsWith(`${entry.dest}/`)) return `${entry.src}${path.slice(entry.dest.length)}`;
    }
    return null;
  }
  const POINTER = /`((?:\.orchestra\/(?:templates|schemas)\/[^`<>*\s]*|\.orchestra\/test-rules\.md|\.orchestra\/project\.md|\.orchestra\/auto-run\.json|scripts\/[\w-]+\.mjs|\.claude\/hooks\/[\w-]+\.mjs))`/g;

  it('exists in the kit: templates, schemas, scripts, hooks and the rules for tests', () => {
    const instructions = [...walk('starter'), ...walk('starter-claude-code')].filter((f) => f.endsWith('.md'));
    let pointers = 0;
    for (const file of instructions) {
      for (const [, raw] of text(file).matchAll(POINTER)) {
        const path = raw.replace(/\/$/, '');
        const src = sourceOf(path);
        pointers += 1;
        assert.ok(src, `${file} points at ${raw}, which the kit does not install`);
        assert.ok(existsSync(join(kitRoot, src)), `${file} points at ${raw}, but ${src} is not in the kit`);
      }
    }
    assert.ok(pointers > 50, `only ${pointers} pointers found; the pattern no longer matches the instructions`);
  });

  it('every template the index of templates lists is there', () => {
    const index = text('starter/.orchestra/templates/README.md');
    const named = [...index.matchAll(/`([\w-]+\.template\.md)`/g)].map((m) => m[1]);
    assert.ok(named.length >= 7);
    for (const name of named) assert.ok(existsSync(join(kitRoot, 'starter/.orchestra/templates', name)), `${name} is listed but missing`);
    for (const name of list('starter/.orchestra/templates', (f) => f.endsWith('.template.md'))) assert.ok(named.includes(name), `${name} is in the kit but not in the index of templates`);
  });

  // A file installed for both tools speaks to both: one that sends stack skills or Spec Kit's skills to
  // `.github/skills/` alone sends the agents of Claude Code where they do not look.
  it('names the skills folders of both tools together, in a file installed for both', () => {
    const shared = kit.entries.filter((e) => !e.tools).flatMap((e) => (statSync(join(kitRoot, e.src)).isDirectory() ? walk(e.src) : [e.src])).filter((f) => f.endsWith('.md'));
    let lines = 0;
    for (const file of shared) {
      for (const line of text(file).split('\n')) {
        const claude = line.includes('.claude/skills/');
        const copilot = line.includes('.github/skills/');
        if (!claude && !copilot) continue;
        lines += 1;
        assert.ok(claude && copilot, `${file} names the skills folder of ${claude ? 'Claude Code' : 'Copilot'} alone, and both tools receive it: ${line.trim().slice(0, 100)}`);
      }
    }
    assert.ok(lines >= 4, `only ${lines} lines found that name a skills folder; the pattern no longer matches`);
  });

  // A service with no accounts that a web page can send requests to is a security-sensitive area, and no role looks
  // at it unless the list of such areas names it. The specification and the plan are written in English. The board
  // may not run on its default port, so the skill reads its address from the file the board server writes.
  it('the rules name a service without authentication that a browser can reach, keep the specification and plan in English, and the skill reads the board\'s address', () => {
    for (const rules of [`${CLAUDE}/orchestra-rules.md`, `${COPILOT}/instructions/orchestra.instructions.md`]) {
      assert.match(text(rules), /Treat authentication, authorization, permissions, audit, secrets, git writes and a service that answers without authentication where a browser or the network can reach it/, rules);
      assert.match(text(rules), /Write in English, whatever language the command and the owner's own words are in: what the owner reads[\s\S]*the specification and the technical plan, their assumptions and decisions included\./, rules);
    }
    for (const skill of [`${CLAUDE}/skills/run-board/SKILL.md`, `${COPILOT}/skills/run-board/SKILL.md`]) {
      assert.match(text(skill), /Board: the `url` in `sdlc\/\.board-server\.json`/, skill);
      assert.match(text(skill), /read the address there before you give it to the owner, never from memory/, skill);
      assert.ok(!/Board: http:\/\/127\.0\.0\.1:4319/.test(text(skill)), `${skill} still gives the default port as the board's address`);
    }
  });

  // A merge sent to the resumed implementation session costs many times what it costs in a new session, and may
  // record the acceptance twice. Both tools get a command for that new session, and the implementation command asks
  // for a new session as well, in the description the person sees with it.
  it('both tools get a command that merges an accepted delivery in a new session', () => {
    for (const dir of [CLAUDE, COPILOT]) {
      const merge = text(`${dir}/skills/imperata-merge/SKILL.md`);
      assert.match(merge, /^description: .*Send it in a new SDLC Orchestrator session, not the one that implemented the run/m, dir);
      assert.match(merge, /if `approvals\.humanAcceptance` already records my acceptance, do not record it again/, dir);
      assert.match(merge, /accepted its delivery, and I tell you to merge it into the branch I name after the run, or into the main branch if I name none/, dir);
      assert.match(text(`${dir}/skills/imperata-verify/SKILL.md`), /^description: .*or repair it after you answered review findings\. Send it in a new SDLC Orchestrator session, not one that worked on the run before/m, dir);
      assert.match(text(`${dir}/skills/imperata-implement/SKILL.md`), /^description: .*Send it in a new SDLC Orchestrator session, not one that worked on the run before/m, dir);
    }
  });

  // The start command is short, and keeps the sentence that asks the owner for the approval mode: without it, the
  // Orchestrator may record `local-record` itself and tell the owner it was chosen.
  it('the start command asks the owner for the approval mode, and says where the step ends', () => {
    for (const dir of [CLAUDE, COPILOT]) {
      const start = text(`${dir}/skills/imperata-start/SKILL.md`);
      assert.match(start, /Ask me which approval mode this run uses, `pull-request` or `local-record`, and record it in the run manifest\./, `${dir}: the start command no longer asks for the approval mode`);
      assert.match(start, /Use a local ticket artifact unless a GitHub Issues\/Jira tool is already explicitly authorized\./, `${dir}: the local ticket, which no other file states, is gone`);
      assert.match(start, /This step ends at the business decisions: stop there with your report\./, `${dir}: the start command does not say where the step ends`);
    }
  });

  // A light run has no plan pull request: its plan is committed on the delivery branch. A command that tells the
  // Orchestrator to confirm the plan pull request is merged would hold a light run at a pull request it never opens.
  it('a command that asks about the plan pull request says that a light run has none', () => {
    const commands = [CLAUDE, COPILOT].flatMap((dir) => walk(`${dir}/skills`).filter((f) => /\/imperata-[\w-]+\/SKILL\.md$/.test(f)));
    let asking = 0;
    for (const file of commands) {
      if (!/plan pull request/.test(text(file))) continue;
      asking += 1;
      assert.match(text(file), /light run|track: light/, `${file} asks about the plan pull request and says nothing of a light run`);
    }
    assert.ok(asking >= 4, `only ${asking} commands name the plan pull request`);
  });

  // The numbered documents of the blueprint stay in the kit's repository. In a project, `docs/` is usually
  // where the product's sources are, so such a path points at nothing there, or at the wrong folder. Nor does a
  // project have `.gitignore.example`: the installer makes it the project's `.gitignore`, or adds its lines.
  it('is never a numbered document of the blueprint or the kit\'s `.gitignore.example`, in a file a project receives', () => {
    const received = kit.entries.flatMap((e) => (statSync(join(kitRoot, e.src)).isDirectory() ? walk(e.src) : [e.src])).filter((f) => f.endsWith('.md'));
    assert.ok(received.length > 30, `only ${received.length} Markdown files found among what a project receives`);
    for (const file of received) {
      const found = text(file).match(/docs\/\d{2}_[A-Z0-9_.]+\.md/);
      assert.ok(!found, `${file} points at ${found?.[0]}, which the kit does not install`);
      assert.ok(!text(file).includes('.gitignore.example'), `${file} names .gitignore.example; a project has those lines in its .gitignore`);
    }
  });
});
