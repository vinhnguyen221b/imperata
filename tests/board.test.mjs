// SPDX-License-Identifier: MIT
// scripts/render-run-board.mjs over the two sample runs behind the guides' screenshots, in a repository
// with the kit installed. This checks that the board is written, kept current and versioned; what the page
// looks like in a browser is not tested here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, basename, sep } from 'node:path';
import { installedRepo, write, read, node, kitRoot, expectExit, expectOutput } from './helpers.mjs';
import { validate, accepted, silentAbout, makeRun, SPEC, planOf, TASKS } from './run-fixture.mjs';

const R1 = 'R1-leave-balance';
const R2 = 'R2-leave-request';
const render = (root, ...args) => node(root, join(root, 'scripts/render-run-board.mjs'), ...args);

function sampleRepo(t) {
  const root = installedRepo(t);
  expectExit(node(root, join(kitRoot, 'docs/images/src/sample-runs.mjs'), root), 0);
  return root;
}

describe('the sample runs', () => {
  it('validate, with their tests calibrated and their skills quoted', (t) => {
    const root = sampleRepo(t);
    const r1 = validate(root, `sdlc/runs/${R1}/run.json`);
    accepted(r1);
    expectOutput(r1, /Test calibration: 2 of 2 locked test file\(s\)/);
    expectOutput(r1, /Acceptance criteria: 4 of 4 have a test that passed/);
    expectOutput(r1, /Skills applied: 4 row\(s\)/);
    silentAbout(r1, /calibrat|Skills applied|acceptance criteri/);
    accepted(validate(root, `sdlc/runs/${R2}/run.json`));
  });

  // The board speaks English only: a profile that names another language changes nothing on the page, and the
  // page offers no language to switch to.
  it('render a board in English only, whatever the profile names', (t) => {
    const root = sampleRepo(t);
    write(root, '.orchestra/project.md', `${read(root, '.orchestra/project.md')}\n## Language\n\n- **Owner-facing language:** vi\n`);
    expectExit(render(root), 0);
    const page = read(root, 'sdlc/board.html');
    assert.match(page, /<html lang="en">/);
    assert.doesNotMatch(page, /data-lang|"lang":|navigator\.language/, 'the page still switches language');
    assert.doesNotMatch(page, /\bvi\s*[:=]\s*\{|'vi'/, 'the page still carries a second language');
  });

  // The agents take the name and place of an artifact from the index of templates; the guides and their
  // screenshots show the sample run. The two put each artifact in the same place.
  it('keep each artifact where the index of templates says it is', (t) => {
    const root = sampleRepo(t);
    const index = readFileSync(join(kitRoot, 'starter/.orchestra/templates/README.md'), 'utf8');
    const named = [...index.matchAll(/^\| `([\w./-]+\.md)` \| `[\w-]+\.template\.md` \|/gm)].map((m) => m[1]);
    assert.ok(named.length >= 7, `only ${named.length} artifacts found in the index of templates`);
    const inRun = readdirSync(join(root, `sdlc/runs/${R1}`), { recursive: true }).map((f) => String(f).split(sep).join('/'));
    let found = 0;
    for (const artifact of named) {
      for (const file of inRun.filter((f) => basename(f) === basename(artifact))) {
        found += 1;
        assert.equal(file, artifact, `the index of templates says ${artifact}; the sample run keeps ${file}`);
      }
    }
    assert.ok(found >= 5, `the sample run holds only ${found} of the artifacts the index names`);
  });
});

describe('render', () => {
  // A run ID with control characters could reach the person's terminal through the renderer's summary: a sequence
  // that clears the line, or writes to the clipboard.
  it('prints no control character from a manifest to the terminal', (t) => {
    const root = installedRepo(t);
    const { manifest } = makeRun(root, {});
    const m = JSON.parse(read(root, manifest));
    write(root, manifest, JSON.stringify({ ...m, runId: 'R1\u001b]52;c;eA==\u0007\u001b[2K' }, null, 2));
    const r = node(root, join(root, 'scripts/render-run-board.mjs'));
    assert.doesNotMatch(r.out, /[\u0000-\u0008\u000b-\u001f\u007f]/, 'a control character reached the terminal');
  });

  it('writes a board for each run and one page for all of them', (t) => {
    const root = sampleRepo(t);
    const r = render(root);
    expectExit(r, 0);
    expectOutput(r, /2 run boards rendered/);
    const board = read(root, `sdlc/runs/${R1}/board.md`);
    assert.match(board, /## Traceability/);
    for (const id of ['AC-01', 'AC-04', 'TASK-01', 'T-05']) assert.ok(board.includes(id), `board.md does not name ${id}`);
    assert.ok(existsSync(join(root, `sdlc/runs/${R2}/board.md`)));
    const page = read(root, 'sdlc/board.html');
    assert.ok(page.includes(R1) && page.includes(R2));
    assert.ok(!/\bundefined\b|\[object Object\]/.test(board), 'board.md holds a value that was never filled in');
  });

  it('renders one run when asked, and refuses a run that does not exist', (t) => {
    const root = sampleRepo(t);
    expectExit(render(root, '--run', R2, '--no-html'), 0);
    assert.ok(existsSync(join(root, `sdlc/runs/${R2}/board.md`)));
    assert.ok(!existsSync(join(root, `sdlc/runs/${R1}/board.md`)));
    assert.ok(!existsSync(join(root, 'sdlc/board.html')));
    expectExit(render(root, '--run', 'R9-nothing'), 2);
    expectExit(render(root, '--sideways'), 2);
  });

  it('names the design brief on the approval card of the plan, beside the plan', (t) => {
    const root = installedRepo(t);
    const { id, R } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN' });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\*\*Approve the technical plan\?\*\* You decide on version `technical-plan\.md@[0-9a-f]{12}` \(`technical-plan\.md`\)/);
    write(root, `${R}/design.md`, '# Design brief\n\nOne screen.\n');
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\*\*Approve the technical plan\?\*\* You decide on version `technical-plan\.md\+design\.md@[0-9a-f]{12}` \(`technical-plan\.md`, `design\.md`\)/);
    const page = read(root, 'sdlc/board.html');
    assert.ok(page.includes(`sdlc/runs/${id}/design.md`) || page.includes('design.md'), 'the page does not link the design brief');
  });

  // A task names the criteria it carries out one by one or as a range, and one that carries out none says
  // "none". Taking every id in the field would read "none directly; enables AC-01..AC-03" as AC-01 and
  // AC-03, set a stack-skill task against two criteria and hide a criterion that no task carries out.
  it('reads a range of criteria in a task as every id in it, and "none" as no criterion', (t) => {
    const root = installedRepo(t);
    const task = (id, title, criteria) => `### ${id} — ${title}\n\n- **Acceptance criteria:** ${criteria}\n- **Depends on:** none\n- **Complexity:** low — one small change\n- **Skills:**\n  - core: \`web\`\n`;
    const plan = `# Technical plan\n\n## Tasks\n\n${[
      task('TASK-00', 'Stack skill', 'none directly; enables AC-01..AC-03 (every later task depends on it).'),
      task('TASK-01', 'Discount code', 'AC-01..AC-02'),
      task('TASK-02', 'Seed data', '`none`'),
    ].join('\n')}`;
    const { R } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN', plan });
    expectExit(render(root), 0);
    const board = read(root, `${R}/board.md`);
    const row = (ac) => board.split('\n').find((l) => l.startsWith(`| ${ac} |`)) || '';
    assert.match(row('AC-01'), /\| TASK-01 \| T-01 \|/, 'AC-01 is carried out by TASK-01 alone');
    assert.match(row('AC-02'), /\| TASK-01 \| T-02 \|/, 'AC-02 lies inside the range AC-01..AC-02');
    assert.match(row('AC-03'), /\| — \| T-03 \|/, 'a task that says "none" was listed against AC-03');
    assert.match(board, /1 acceptance criterion with no task in the plan: AC-03\./);
  });

  // Some editors write a byte-order mark before a manifest's JSON; and a criterion written ac-01 in the
  // specification has to meet its test in the report, which names AC-01.
  it('reads a manifest with a byte-order mark, and the prefix of a criterion\'s id whatever its case', (t) => {
    const root = installedRepo(t);
    const { R, manifest } = makeRun(root, { stage: 'REVIEWING', spec: SPEC.replace(/\| AC-0/g, '| ac-0') });
    write(root, manifest, `\uFEFF${read(root, manifest)}`);
    expectExit(render(root), 0);
    const board = read(root, `${R}/board.md`);
    assert.doesNotMatch(board, /cannot be read/, 'the manifest with a byte-order mark was not read');
    const row = board.split('\n').find((l) => l.startsWith('| AC-01 |')) || '';
    assert.match(row, /T-01/, 'AC-01, written ac-01, is not shown with its test');
  });

  // Approving the specification approves the defaults the analyst took where the sources leave a point open, so
  // the approval card names them. They belong to that approval only.
  it('lists the assumptions of the specification on its approval card, and on no other', (t) => {
    const root = installedRepo(t);
    const spec = `${SPEC}\n## Assumptions\n\n| ID | Assumption | Why it is a reasonable default | Affects (BR / AC) |\n| --- | --- | --- | --- |\n| A-01 | A code is case-insensitive | The shop treats every other code so | AC-01 |\n| A-02 | Codes do not stack | Common convention | BR-01 |\n| A-03 |  |  |  |\n`;
    const { R } = makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION', spec });
    expectExit(render(root), 0);
    const board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*Assumptions\.\*\* Where the sources leave a point open, the specification takes a default: 2 assumptions\. Approving the specification approves them\./);
    assert.match(board, /^> - A-01: A code is case-insensitive$/m);
    assert.match(board, /^> - A-02: Codes do not stack$/m);
    assert.ok(!board.includes('A-03'), 'an empty row of the template was listed as an assumption');
    assert.ok(read(root, 'sdlc/board.html').includes('A code is case-insensitive'), 'the page does not show the assumptions');
    makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN', spec });
    expectExit(render(root), 0);
    assert.ok(!read(root, `${R}/board.md`).includes('A-01'), 'the assumptions were shown at the plan approval');
  });

  // An approval card that counts tasks and waves does not tell the owner which decisions they approve with the
  // plan, or whether they need decisions of their own. The card of the plan lists the decisions, those in a
  // security-sensitive area first, and says that approving the plan approves them.
  it('lists the decisions of the plan on its approval card, the security-sensitive ones first, and on no other', (t) => {
    const root = installedRepo(t);
    const plan = `${planOf(TASKS)}\n## Decisions\n\n| ID | Decision | Alternatives rejected | Security-sensitive area | Needs approval from |\n| --- | --- | --- | --- | --- |\n| ADR-01 | Codes are stored in **upper case** | Case as typed | no | owner |\n| ADR-02 | The code travels in the request body, never in the URL | A query parameter | secrets | owner |\n| ADR-03 |  |  |  |  |\n`;
    const { R } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN', plan });
    expectExit(render(root), 0);
    const board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*Decisions of the plan\.\*\* Where the criteria leave the plan a choice, it takes one: 2 decisions, 1 of them in a security-sensitive area\. Approving the plan approves them\. To decide one yourself, request changes and name it\./);
    assert.match(board, /^> - ADR-02 \(security-sensitive: secrets\): The code travels in the request body, never in the URL\n> - ADR-01: Codes are stored in upper case$/m);
    assert.ok(!board.includes('ADR-03'), 'an empty row of the template was listed as a decision');
    const page = read(root, 'sdlc/board.html');
    assert.ok(page.includes('The code travels in the request body') && page.includes('"area":"secrets"'), 'the page does not show the decisions of the plan');
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION', plan });
    expectExit(render(root), 0);
    assert.ok(!read(root, `${R}/board.md`).includes('Decisions of the plan'), 'the decisions of the plan were shown at the business approval');
    makeRun(root, { stage: 'IMPLEMENTING', plan });
    expectExit(render(root), 0);
    assert.ok(!read(root, `${R}/board.md`).includes('Decisions of the plan'), 'the decisions of the plan were shown once the plan was approved');
  });

  // An analyst with no limit can ask the owner dozens of questions in one round. The analyst asks at most five
  // needed before one gate at a time, and the board shows the owner when more are open.
  // Past five, only questions in a security-sensitive area, up to ten in all: points such as the length of a
  // session or the rules for a password are not settled as assumptions to stay under five.
  it('flags more than five open questions before the gate the run is at, or more than ten when those past five are security-sensitive', (t) => {
    const root = installedRepo(t);
    const { R } = makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const row = (i, area) => `| Q-${String(i).padStart(2, '0')} | Question ${i}? | It matters. | AC-01 | ${area} | (a) yes; (b) no | businessApproval | OPEN | owner |  |  |`;
    const clarification = (plain, sensitive = 0) => `# Clarification log\n\n| ID | Question | Why it matters | Affects (BR / AC) | Security-sensitive area | Options and their consequences | Needed before | Decision | Decided by | Decided at | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${[...Array.from({ length: plain }, (_, i) => row(i + 1, 'no')), ...Array.from({ length: sensitive }, (_, i) => row(plain + i + 1, 'authentication'))].join('\n')}\n| Q-99 | A later question? | It matters later. | AC-02 | no | (a) yes; (b) no | planApproval | OPEN | owner |  |  |\n`;
    const flagged = () => { expectExit(render(root), 0); return /questions are open before/.test(read(root, `${R}/board.md`)); };
    write(root, `${R}/clarification.md`, clarification(5));
    assert.ok(!flagged(), 'five open questions were flagged');
    write(root, `${R}/clarification.md`, clarification(6));
    assert.ok(flagged());
    assert.match(read(root, `${R}/board.md`), /6 questions are open before Business approval; the analyst asks at most 5 at a time, and up to 10 only when those past 5 are in a security-sensitive area\./);
    write(root, `${R}/clarification.md`, clarification(5, 5));
    assert.ok(!flagged(), 'ten questions, five of them security-sensitive, were flagged');
    write(root, `${R}/clarification.md`, clarification(6, 3));
    assert.ok(flagged(), 'six questions that are not security-sensitive were not flagged');
    write(root, `${R}/clarification.md`, clarification(4, 7));
    assert.ok(flagged(), 'eleven questions were not flagged');
    assert.match(read(root, `${R}/board.md`), /11 questions are open before Business approval, 7 of them in a security-sensitive area;/);
  });

  // A sentence common to all the options may stand before "(a)": the options after it are still offered, and a
  // card with no option to choose shows no hint that the keys 1–9 choose one.
  it('keeps the options of a question after a sentence they share, and names no keys where a card has no option', (t) => {
    const root = installedRepo(t);
    const { R } = makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const log = (options) => `# Clarification log\n\n| ID | Question | Why it matters | Affects (BR / AC) | Security-sensitive area | Options and their consequences | Needed before | Decision | Decided by | Decided at | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| Q-01 | When is a new item due? | It matters. | AC-01 | no | ${options} | businessApproval | OPEN | owner |  |  |\n`;
    const model = () => {
      expectExit(render(root), 0);
      return { board: read(root, `${R}/board.md`), page: read(root, 'sdlc/board.html') };
    };
    write(root, `${R}/clarification.md`, log('Common example: an item added on 2026-11-01 with a 14-day cycle. (a) Due on the day it is added → it shows at once. (b) Due when its first cycle ends → it shows on 2026-11-15.'));
    let { board, page } = model();
    assert.match(board, /Common example: an item added on 2026-11-01 with a 14-day cycle\.<br>\*\*\(a\)\*\* Due on the day it is added → it shows at once\.<br>\*\*\(b\)\*\* Due when its first cycle ends/, 'the options after a shared sentence were not split');
    assert.match(page, /"lead":"Common example: an item added on 2026-11-01 with a 14-day cycle\."/, 'the card does not carry the shared sentence');
    assert.match(page, /"label":"\(b\)","main":"Due when its first cycle ends"/, 'the card offers no option (b)');

    write(root, `${R}/clarification.md`, log('As decided for the first question, (a) applies, and (b) only when the owner says so'));
    ({ board, page } = model());
    assert.match(board, /As decided for the first question, \(a\) applies, and \(b\) only when the owner says so/, 'a sentence that names options in passing was split');
    assert.match(page, /"options":\[\],"lead":"","free":"As decided/, 'a sentence that names options in passing became options');
    assert.match(page, /qs\.some\(\(q\) => q\.options\.length\) \? esc\(t\('dec\.keys'\)\) : ''/, 'the hint for the number keys shows where no card has an option');
  });

  // A recommendation may begin "Choose (b)" or "I recommend (b)", not only "(b)": the card marks the option it
  // names after such a word or two.
  it('marks the option a recommendation names after a word or two that say it is the choice', (t) => {
    const root = installedRepo(t);
    const { R } = makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    const log = (rec) => `# Clarification log\n\n| ID | Question | Why it matters | Affects (BR / AC) | Security-sensitive area | Options and their consequences | Needed before | Decision | Decided by | Decided at | Evidence |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n| Q-01 | Ask before removing? | It matters. | AC-01 | no | (a) Remove at once → history is lost. (b) Ask for a flag → one more word. | businessApproval | OPEN | owner |  |  |\n\n## Proposals not yet decided\n\n- Q-01: ${rec}\n`;
    const recommended = () => {
      expectExit(render(root), 0);
      const page = read(root, 'sdlc/board.html');
      return ['a', 'b'].filter((l) => new RegExp(`"label":"\\(${l}\\)","main":"[^"]*","cons":"[^"]*","value":"[^"]*","recommended":true`).test(page));
    };
    for (const rec of ['(b) — a flag is a small price.', 'Choose (b), the `--yes` flag — a removal cannot be undone.', 'I recommend (b) — a flag is a small price.']) {
      write(root, `${R}/clarification.md`, log(rec));
      assert.deepEqual(recommended(), ['b'], `"${rec}" marked no option (b)`);
    }
    write(root, `${R}/clarification.md`, log('Either works; if in doubt, (b) — a flag is a small price.'));
    assert.deepEqual(recommended(), [], 'a letter deep in a sentence was taken as the choice');
  });

  // Number keys pressed in quick succession could choose options on a card the owner has not seen yet, and a tool
  // that reads the names of the radios needs one for each. The page is tried in a browser, not here: this checks
  // that the page carries both answers.
  it('names every radio of a card, and holds number keys back until the next card has been in view', (t) => {
    const root = sampleRepo(t);
    expectExit(render(root), 0);
    const page = read(root, 'sdlc/board.html');
    assert.match(page, /aria-label="' \+ esc\(optionName\(o\)\)/, 'an option radio has no explicit name');
    assert.match(page, /aria-label="' \+ esc\(t\('gate\.approve'\) \+ ': ' \+ t\('gate\.approveHint'\)\)/, 'the Approve radio has no explicit name');
    assert.match(page, /aria-label="' \+ esc\(t\('gate\.request'\) \+ ': ' \+ t\('gate\.requestHint'\)\)/, 'the Request changes radio has no explicit name');
    assert.match(page, /ui\.keysAfter = Date\.now\(\) \+ \(reduceMotion \? 0 : 260\) \+ KEY_PAUSE/, 'a choice does not hold the number keys back');
    assert.match(page, /if \(Date\.now\(\) < \(ui\.keysAfter \|\| 0\)\) \{ e\.preventDefault\(\); return; \}/, 'a number key is not held back');
  });

  // The reply puts the owner's name from the manifest into its first line, and an agent writes that name: put in
  // as it stands, a name with an APPROVE line in it would approve a gate for an owner who asked for changes.
  // The page is tried in a browser, not here: this checks that the reply writes what agents wrote on one
  // line, and never begins a line with a gate's name for a question.
  it('writes the owner\'s name and the ids of questions into the reply on one line, and never as a gate decision', (t) => {
    const root = sampleRepo(t);
    expectExit(render(root), 0);
    const page = read(root, 'sdlc/board.html');
    assert.match(page, /'My decisions as owner \(' \+ oneLine\(r\.owner\) \+ '\) for run ' \+ oneLine\(r\.id\)/, 'the owner\'s name goes into the reply as the manifest holds it');
    assert.match(page, /const oneLine = \(s\) => String\(s \?\? ''\)\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)/, 'oneLine does not join the lines of a text');
    assert.match(page, /\(HUMAN_GATES\.some\(\(g\) => id\.startsWith\(g\)\) \? 'Question ' : ''\) \+ id \+ ': '/, 'a question whose id is a gate\'s name reads as a gate decision');
  });

  it('shows the validator\'s verdict of a run it rejects', (t) => {
    const root = sampleRepo(t);
    write(root, `sdlc/runs/${R1}/tests-note.md`, 'x\n');
    write(root, 'tests/leave-balance.test.mjs', '// the assertions were removed\n');
    expectExit(render(root), 0);
    assert.match(read(root, `sdlc/runs/${R1}/board.md`), /test files changed after the QA step that locked them/);
  });

  // A run at READY_FOR_IMPLEMENTATION with no task delegated waits for a session of the owner's, not for the
  // Developer. The board gives the command for that session with the run's ID.
  it('tells the owner to start implementation when a run is ready and no task is delegated', (t) => {
    const root = installedRepo(t);
    const { R } = makeRun(root, { stage: 'READY_FOR_IMPLEMENTATION', models: null });
    expectExit(render(root), 0);
    const board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*Your move\.\*\* No task has been delegated yet\. Implementation runs in an interactive Orchestrator session: start a new one and send \/imperata-implement R1, unless one is running/);
    assert.ok(!/is implementing/.test(board), 'the board says the Developer is implementing');
    makeRun(root, { stage: 'IMPLEMENTING', models: [['TASK-01', 'developer', 'low', 'haiku', 'NOT_CONFIRMED']] });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\*\*In progress\.\*\* The Developer is implementing: 1 of 2 tasks not delegated yet\./);
  });

  // After the business approval no session runs: the start command ends at the business decisions, and the next
  // move is the owner's command, not the Architect's drafting. After the last task the next command is the verify
  // command, which runs the whole suite, the calibration and the review. The board names the command of each step,
  // with the run's ID.
  it('names the plan command once the specification is approved, and the verify command once every task is built', (t) => {
    const root = installedRepo(t);
    const { R, manifest } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN', models: null });
    rmSync(join(root, R, 'technical-plan.md'));
    const m = JSON.parse(read(root, manifest));
    m.artifactPaths.plan = null;
    write(root, manifest, JSON.stringify(m, null, 2));
    expectExit(render(root), 0);
    let board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*Your move\.\*\* The specification is approved and no plan is written yet\. Planning runs in an Orchestrator session: start a new one and send \/imperata-plan R1, unless one is running\./);
    assert.ok(!/is drafting the technical plan/.test(board), 'the board says the Architect is drafting a plan that nobody was asked for');

    const dev = (id) => [id, 'developer', 'low', 'haiku', 'NOT_CONFIRMED'];
    makeRun(root, { stage: 'IMPLEMENTING', models: [dev('TASK-01'), dev('TASK-02')], checks: [['TASK-01', '4f2c1ab', '"go on"', '2026-11-16T04:00:00Z'], ['TASK-02', '8a41f06', '"/imperata-verify R1"', '2026-11-16T04:30:00Z']] });
    expectExit(render(root), 0);
    board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*Your move\.\*\* Every task is built and checked\. Verification is next: the whole suite, the calibration and the review\. It runs in an Orchestrator session of its own: start a new one and send \/imperata-verify R1, unless one is running\./);
    // The last task is delegated and not yet at its stop: nothing waits for the owner.
    makeRun(root, { stage: 'IMPLEMENTING', models: [dev('TASK-01'), dev('TASK-02')], checks: [['TASK-01', '4f2c1ab', '"go on"', '2026-11-16T04:00:00Z']] });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\*\*In progress\.\*\* Every task has been delegated to the Developer; the last one is being built and tested\./);
  });

  // A "|" inside a cell, as in a quoted usage line, ends the cell, so the approval card can read a decision as one
  // in a security-sensitive area for a plan that marks none. The board says which rows have more or fewer cells
  // than their table has columns, under "Check before you decide".
  // A row under "Not covered" that nobody accepted and that names no criterion is read by no check: the board
  // lists it for the owner, so that a run does not reach DONE with it open.
  it('lists under "Check before you decide" the rows under "Not covered" that nobody accepted', (t) => {
    const root = installedRepo(t);
    const gaps = (rows) => `# Test plan\n\n## Not covered\n\n| AC, decision or risk | Reason | Who accepted the gap |\n| --- | --- | --- |\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
    const OPEN = /> - 1 row under "Not covered" in the test plan has nobody who accepted the gap: "Mutation check of the fix"\. Only you accept a gap: say so with your decision, or have the row taken out\./;
    const { R } = makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', testPlan: gaps([['Mutation check of the fix', 'QA may not edit the code', ''], ['Load above 1,000 requests', 'no tool for it', 'owner (decisions/owner.md)']]), artifactPaths: { testPlan: 'sdlc/runs/R1/test-plan.md' } });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), OPEN);

    makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', testPlan: gaps([['Mutation check of the fix', 'QA may not edit the code', 'owner (decisions/owner.md)']]), artifactPaths: { testPlan: 'sdlc/runs/R1/test-plan.md' } });
    expectExit(render(root), 0);
    assert.doesNotMatch(read(root, `${R}/board.md`), /nobody who accepted the gap/);

    // The plan is found in the run folder where the manifest does not name it, and a run that is over is not read.
    makeRun(root, { stage: 'REVIEWING', testPlan: gaps([['Mutation check of the fix', 'QA may not edit the code', '<owner>']]) });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), OPEN);
    makeRun(root, { stage: 'CANCELLED', testPlan: gaps([['Mutation check of the fix', 'QA may not edit the code', '']]) });
    expectExit(render(root), 0);
    assert.doesNotMatch(read(root, `${R}/board.md`), /nobody who accepted the gap/);
  });

  it('says under "Check before you decide" which table rows a "|" cut, and nothing once it is written with a backslash', (t) => {
    const root = installedRepo(t);
    const decisions = (cell) => `${planOf(TASKS)}
## Decisions

| ID | Decision | Alternatives rejected | Security-sensitive area | Needs approval from |
| --- | --- | --- | --- | --- |
| ADR-01 | The usage line reads ${cell} | Another place | no | Owner |
`;
    const { R } = makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN', plan: decisions('`apply <code|none>`'), gates: { planApproval: 'NOT_RUN' }, approvals: { planApproval: null } });
    expectExit(render(root), 0);
    let board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*Check before you decide:\*\*[\s\S]*1 table row has more or fewer cells than the table has columns, so what this page shows of it may come from the wrong column: ADR-01 in technical-plan\.md\. A "\|" inside a cell ends the cell; it is written "\\\|"\./);
    assert.match(board, /1 of them in a security-sensitive area/, 'the fixture no longer shows what the row is read as');
    makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN', plan: decisions('`apply <code\\|none>`'), gates: { planApproval: 'NOT_RUN' }, approvals: { planApproval: null } });
    expectExit(render(root), 0);
    board = read(root, `${R}/board.md`);
    assert.ok(!/table row/.test(board), 'the board still flags a row whose "|" is written with a backslash');
    assert.ok(!/in a security-sensitive area/.test(board), 'the decision is still read as one in a security-sensitive area');
  });

  // A specification with many criteria makes a long table on the page, each row cut to its "Then". A criterion is
  // one behaviour and the values it holds for are its cases; the board shows a criterion as its cases stand, and
  // gives the page what a row opens to.
  it('shows a criterion as its cases stand, counts the cases, and gives the page each criterion in full', (t) => {
    const root = installedRepo(t);
    const spec = `${SPEC}
### Cases of AC-03

| Case | Code | Expected |
| --- | --- | --- |
| AC-03.1 | expired yesterday | rejected with EXPIRED |
| AC-03.2 | expired a year ago | rejected with EXPIRED |
| AC-03.3 | expires today | accepted |
`;
    const two = [['T-01', 'AC-01', 'PASSED'], ['T-02', 'AC-02', 'PASSED']];
    const { R } = makeRun(root, { spec, rows: [...two, ['T-03', 'AC-03.1..AC-03.2', 'PASSED'], ['T-04', 'AC-03.3', 'FAILED']] });
    expectExit(render(root), 0);
    let board = read(root, `${R}/board.md`);
    assert.match(board, /3 criteria with 3 cases · \d planned · 3 with a test · 2 passed/);
    assert.match(board, /\| AC \| Then \| Cases \| Tasks \| Tests \| Result \|/);
    assert.match(board, /\| AC-03 \| it is rejected with EXPIRED \| 2 of 3 passed \| [^|]* \| T-03, T-04 \| FAILED \|/);
    assert.match(board, /\| AC-01 \| the total is ten percent lower \| — \| [^|]* \| T-01 \| PASSED \|/);
    assert.match(board, /1 acceptance criterion with a failing test: AC-03/);
    const page = read(root, 'sdlc/board.html');
    assert.match(page, /"id":"AC-03","given":"a basket","when":"an expired code is applied","then":"it is rejected with EXPIRED","rules":"BR-02","cases":\[\{"id":"AC-03\.1","cells":\[\["Code","expired yesterday"\],\["Expected","rejected with EXPIRED"\]\],"tests":\["T-03"\],"result":"PASSED"\}/);
    assert.match(page, /tr class="ac-row"[\s\S]*tr class="ac-detail" hidden/, 'the page has no row that opens');

    // A failed test that names the criterion itself decides it, although every case passed.
    makeRun(root, { spec, rows: [...two, ['T-03', 'AC-03.1..AC-03.3', 'PASSED'], ['T-04', 'AC-03', 'FAILED']] });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\| AC-03 \| it is rejected with EXPIRED \| 3 of 3 passed \| [^|]* \| T-04, T-03 \| FAILED \|/);

    // A test that names the criterion alone covers none of its cases, as the gate validator reads it.
    makeRun(root, { spec });
    expectExit(render(root), 0);
    board = read(root, `${R}/board.md`);
    assert.match(board, /3 criteria with 3 cases · \d planned · 2 with a test · 2 passed/);
    assert.match(board, /\| AC-03 \| it is rejected with EXPIRED \| 0 of 3 passed \|/);
    assert.match(board, /1 acceptance criterion with no test in the test report: AC-03/);

    // Without cases the table is as it was.
    makeRun(root, {});
    expectExit(render(root), 0);
    board = read(root, `${R}/board.md`);
    assert.match(board, /3 criteria · \d planned · 3 with a test · 3 passed/);
    assert.match(board, /\| AC \| Then \| Tasks \| Tests \| Result \|/);
  });

  it('says before the business approval that a specification holds more than twelve criteria', (t) => {
    const root = installedRepo(t);
    const specOf = (n) => `# Feature specification

## Acceptance criteria

| ID | Given | When | Then | Business rules |
| --- | --- | --- | --- | --- |
${Array.from({ length: n }, (_, i) => `| AC-${String(i + 1).padStart(2, '0')} | a basket | code ${i + 1} is applied | the total changes | BR-01 |`).join('\n')}
`;
    const { R } = makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION', spec: specOf(13) });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\*\*Check before you decide:\*\*[\s\S]*The specification holds 13 acceptance criteria\. A criterion is one behaviour, and the values it holds for are its cases: above 12/);
    makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION', spec: specOf(12) });
    expectExit(render(root), 0);
    assert.ok(!/The specification holds/.test(read(root, `${R}/board.md`)), 'twelve criteria are flagged');
    makeRun(root, { stage: 'READY_FOR_DESIGN_PLAN', spec: specOf(13) });
    expectExit(render(root), 0);
    assert.ok(!/The specification holds/.test(read(root, `${R}/board.md`)), 'an approved specification is still flagged for its count');
  });

  // Implementation does not go from task to task with nobody asked: the Orchestrator stops after each task. The
  // task's row under "Checked by the owner" has no word while the run waits, and the board then gives the move to
  // the owner, with the check the plan names for that task.
  it('gives the owner the move while a task waits for their check, with the check the plan names', (t) => {
    const root = installedRepo(t);
    const tasks = [{ id: 'TASK-01', title: 'Discount code', ownerCheck: 'run `npm start` and apply the code TEN: the total is ten percent lower' }, { id: 'TASK-02', title: 'Seed data', ownerCheck: 'none — data only' }];
    const dev = (id) => [id, 'developer', 'low', 'haiku', 'NOT_CONFIRMED'];
    const { R } = makeRun(root, { stage: 'IMPLEMENTING', tasks, models: [dev('TASK-01')], checks: [['TASK-01', '4f2c1ab', '', '']] });
    expectExit(render(root), 0);
    let board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*Your move\.\*\* TASK-01 \(Discount code\) is done and waits for your check: run npm start and apply the code TEN: the total is ten percent lower\. Then tell the Orchestrator to go on, in its session or with \/imperata-implement R1 in a new one; if something is wrong, tell it that instead\. 1 task not delegated yet\./);
    assert.match(board, /TASK-01 · Discount code<br\/>[^"]*dev ✓ · your check/);
    assert.match(read(root, 'sdlc/board.html'), /"awaitsCheck":true/);

    // The owner's word is recorded: the move is the agents' again, and the task reads as checked.
    makeRun(root, { stage: 'IMPLEMENTING', tasks, models: [dev('TASK-01')], checks: [['TASK-01', '4f2c1ab', '"go on"', '2026-11-16T04:00:00Z']] });
    expectExit(render(root), 0);
    board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*In progress\.\*\* The Developer is implementing: 1 of 2 tasks not delegated yet\./);
    assert.match(board, /dev ✓ · checked ✓/);

    // The last task, with nothing to try: no check is named, and the board says it is the last.
    makeRun(root, { stage: 'IMPLEMENTING', tasks, models: [dev('TASK-01'), dev('TASK-02')], checks: [['TASK-01', '4f2c1ab', '"go on"', '2026-11-16T04:00:00Z'], ['TASK-02', '8a41f06', '', '']] });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\*\*Your move\.\*\* TASK-02 \(Seed data\) is done and waits for your check\. It is the last task\. Then send \/imperata-verify R1 in a new Orchestrator session: it is your word for this task, and it runs the whole suite, the calibration and the review\./);
  });

  // Once the owner has accepted, the board stops asking for the acceptance. In local-record mode one step is left,
  // the merge. A merge sent to the resumed implementation session costs many times what it costs in a new session,
  // and may record the acceptance a second time. The board names the command for a new session, with the run's ID,
  // and in pull-request mode the command that records DONE after the owner's merge.
  it('shows an accepted delivery as accepted, not as waiting on the owner', (t) => {
    const root = installedRepo(t);
    const { R } = makeRun(root, { stage: 'READY_FOR_ACCEPTANCE' });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\*\*Your move\.\*\* Accept or refuse the delivery/);
    makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', gates: { humanAcceptance: 'PASSED' } });
    expectExit(render(root), 0);
    const local = read(root, `${R}/board.md`);
    assert.match(local, /\*\*Accepted\.\*\* You accepted the delivery \(owner, [^)]+\)\. One step is left: merge it into the main branch, yourself or by sending \/imperata-merge R1 in a new Orchestrator session, not the session that implemented it\. The Orchestrator then records DONE/);
    assert.match(local, /class S5 passed/, 'the acceptance step is not drawn as passed');
    assert.ok(!/Accept or refuse/.test(local), 'the board still asks for the acceptance');
    makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', mode: 'pull-request', gates: { humanAcceptance: 'PASSED' } });
    rmSync(join(root, R, 'decisions'), { recursive: true }); // a pull-request run cites no reply of the owner's
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\*\*In progress\.\*\* The delivery pull request is merged\. Start a new Orchestrator session and send \/imperata-close R1: it records DONE/);
  });

  // The Orchestrator repeats the board's "Check before you decide" list when it asks for a decision. An empty list
  // left out of board.md reads as no list at all, so the board says that nothing is flagged.
  it('says that nothing is flagged when the owner has a gate to decide and nothing to check', (t) => {
    const root = installedRepo(t);
    const { R } = makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', plan: planOf(TASKS).replace('- **Acceptance criteria:** AC-01', '- **Acceptance criteria:** AC-01..AC-03') });
    expectExit(render(root), 0);
    const board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*Accept the delivery\?\*\*/);
    assert.match(board, /> \*\*Check before you decide:\*\* nothing flagged\./);
    makeRun(root, { stage: 'READY_FOR_ACCEPTANCE' });
    expectExit(render(root), 0);
    const flagged = read(root, `${R}/board.md`);
    assert.match(flagged, /> \*\*Check before you decide:\*\*\n> - 2 acceptance criteria with no task in the plan/);
    assert.ok(!/nothing flagged/.test(flagged));
  });

  // A MINOR finding left open in review.md is still open at acceptance: the list names it, and does not read
  // "nothing flagged".
  it('lists every review finding left open, a MINOR one too, with its id', (t) => {
    const root = installedRepo(t);
    const plan = planOf(TASKS).replace('- **Acceptance criteria:** AC-01', '- **Acceptance criteria:** AC-01..AC-03');
    const { R } = makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', plan });
    const finding = (id, severity, disposition) => `| ${id} | ${severity} | src/price.js:3 | A scenario | AC-01 | A fix | ${disposition} |`;
    write(root, `${R}/review.md`, ['# Code review', '', '- Verdict: `APPROVE_FOR_HUMAN_REVIEW`', '', '## Findings', '',
      '| ID | Severity (BLOCKER / MAJOR / MINOR) | File and line | Scenario and impact | AC | Suggested fix | Disposition |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      finding('R-01', 'MINOR', 'OPEN'), finding('R-02', 'MINOR', 'FIXED in a1b2c3d'), finding('R-03', '**MINOR**', ''), ''].join('\n'));
    expectExit(render(root), 0);
    const board = read(root, `${R}/board.md`);
    assert.match(board, /> - Review findings still open: 0 blocker, 0 major, 2 minor \(R-01, R-03\)\. Read them in review\.md before you decide\./);
    assert.ok(!/nothing flagged/.test(board), 'the board says nothing is flagged');
  });

  // A repository with no application code before the run: every test file fails on the base by its import, no
  // control can pass there, and the calibration does not show that the tests check the change.
  it('flags a calibration whose base ran no test that passes', (t) => {
    const root = installedRepo(t);
    const plan = planOf(TASKS).replace('- **Acceptance criteria:** AC-01', '- **Acceptance criteria:** AC-01..AC-03');
    const result = (control) => ({ runId: 'R1', calibratedAt: '2026-11-16T05:10:00Z', files: { 'tests/price.test.js': { sha256: 'ab'.repeat(32), result: 'DEPENDS_ON_CHANGE', exitHere: 0, exitOnBase: 1, base: 'c0ffee', control, at: '2026-11-16T05:10:00Z' } } });
    const { R } = makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', plan, calibration: result(null) });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /> - 1 test file fails on the code from before the run, but no other test passed there, so the calibration does not show that the tests check the change/);
    makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', plan, calibration: result('tests/other.test.js') });
    expectExit(render(root), 0);
    assert.ok(!/no other test passed there/.test(read(root, `${R}/board.md`)), 'a calibration with a control was flagged');
  });

  // When delivery.md changes after the owner accepted it, the gate check rejects the run, and the board's first
  // line must not read "Accepted. You accepted the delivery … One step is left: merge it into the main branch".
  it('asks the owner to approve again when a gate\'s documents changed after the approval', (t) => {
    const root = installedRepo(t);
    const { R } = makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', gates: { humanAcceptance: 'PASSED' } });
    const was = read(root, `${R}/decisions/owner.md`).match(/humanAcceptance: APPROVE (\S+)/)[1];
    write(root, `${R}/delivery.md`, `${read(root, `${R}/delivery.md`)}\nA line written after the acceptance.\n`);
    assert.ok(validate(root, `${R}/run.json`).problems.some((p) => /humanAcceptance was approved for .* they changed after the approval/.test(p)), 'the validator rejects the run');
    expectExit(render(root), 0);
    const board = read(root, `${R}/board.md`);
    const now = /delivery\.md\+test-report\.md\+review\.md@[0-9a-f]{12}/;
    assert.match(board, new RegExp(`\\*\\*Your move\\.\\*\\* The delivery changed after you accepted it: you accepted ${was.replace(/[.+]/g, '\\$&')}, and it is now ${now.source}\\. Read it again and accept this version, or have it restored as you accepted it\\.`));
    assert.ok(!/One step is left|\*\*Accepted\.\*\*/.test(board), 'the board still says the delivery is accepted');
    assert.match(board, /class S5 owner/, 'the acceptance step is not drawn as the owner\'s');
    assert.match(board, new RegExp(`\\*\\*Accept the delivery\\?\\*\\* You decide on version \`${now.source}\``), 'no approval card for the current version');
    assert.ok(!board.includes(`You decide on version \`${was}\``));

    // The same at an earlier gate: the specification changed after its approval, while the run waits to be built.
    const { R: R2 } = makeRun(root, { id: 'R2', stage: 'READY_FOR_IMPLEMENTATION', models: null });
    write(root, `${R2}/feature-spec.md`, `${read(root, `${R2}/feature-spec.md`)}\nA criterion added after the approval.\n`);
    expectExit(render(root), 0);
    const board2 = read(root, `${R2}/board.md`);
    assert.match(board2, /\*\*Your move\.\*\* The specification changed after you approved it: you approved feature-spec\.md@[0-9a-f]{12}, and it is now feature-spec\.md@[0-9a-f]{12}\. Read it again and approve this version, or have it restored as you approved it\./);
    assert.match(board2, /\*\*Approve the specification\?\*\* You decide on version `feature-spec\.md@[0-9a-f]{12}`/);
    assert.ok(!/No task has been delegated yet/.test(board2), 'the board sends the owner to implementation');

    // Nothing changes for an approval that still holds.
    makeRun(root, { stage: 'READY_FOR_ACCEPTANCE', gates: { humanAcceptance: 'PASSED' } });
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /\*\*Accepted\.\*\* You accepted the delivery/);
  });
});

describe('--check', () => {
  it('passes on boards that are current, and fails once an artifact changed', (t) => {
    const root = sampleRepo(t);
    expectExit(render(root), 0);
    const current = render(root, '--check');
    expectExit(current, 0);
    expectOutput(current, /2 run boards up to date/);
    const manifest = JSON.parse(read(root, `sdlc/runs/${R2}/run.json`));
    write(root, `sdlc/runs/${R2}/run.json`, JSON.stringify({ ...manifest, title: 'Another title' }, null, 2));
    const stale = render(root, '--check');
    expectExit(stale, 1);
    expectOutput(stale, new RegExp(`Run boards out of date:\\n- sdlc/runs/${R2}/board\\.md`));
    expectExit(render(root), 0);
    expectExit(render(root, '--check'), 0);
  });

  it('writes nothing', (t) => {
    const root = sampleRepo(t);
    expectExit(render(root, '--check'), 1);
    assert.ok(!existsSync(join(root, `sdlc/runs/${R1}/board.md`)));
    assert.ok(!existsSync(join(root, 'sdlc/board.html')));
  });
});

describe('--gate-version', () => {
  const version = (root, run, gate) => render(root, '--gate-version', run, gate);

  it('names the documents behind a gate and changes when one of them changes', (t) => {
    const root = sampleRepo(t);
    const before = version(root, R1, 'businessApproval');
    expectExit(before, 0);
    assert.match(before.stdout.trim(), /^feature-spec\.md@[0-9a-f]{12}$/);
    assert.equal(version(root, R1, 'businessApproval').stdout, before.stdout);
    write(root, `sdlc/runs/${R1}/feature-spec.md`, `${read(root, `sdlc/runs/${R1}/feature-spec.md`)}\nOne more rule.\n`);
    const after = version(root, R1, 'businessApproval');
    assert.match(after.stdout.trim(), /^feature-spec\.md@[0-9a-f]{12}$/);
    assert.notEqual(after.stdout, before.stdout);
    assert.match(version(root, R1, 'humanAcceptance').stdout.trim(), /^delivery\.md\+test-report\.md\+review\.md@[0-9a-f]{12}$/);
  });

  // The design brief is read with the plan, so the version the owner approves covers it. It is not what
  // opens the plan approval: a run with a brief and no plan has nothing to approve yet.
  it('covers the design brief with the plan, and offers no plan approval for a brief alone', (t) => {
    const root = sampleRepo(t);
    assert.match(version(root, R1, 'planApproval').stdout.trim(), /^technical-plan\.md@[0-9a-f]{12}$/);
    write(root, `sdlc/runs/${R1}/design.md`, '# Design brief\n\nOne screen.\n');
    const withBrief = version(root, R1, 'planApproval');
    expectExit(withBrief, 0);
    assert.match(withBrief.stdout.trim(), /^technical-plan\.md\+design\.md@[0-9a-f]{12}$/);
    write(root, `sdlc/runs/${R1}/design.md`, '# Design brief\n\nTwo screens.\n');
    const changed = version(root, R1, 'planApproval');
    assert.match(changed.stdout.trim(), /^technical-plan\.md\+design\.md@[0-9a-f]{12}$/);
    assert.notEqual(changed.stdout, withBrief.stdout);
    assert.match(version(root, R1, 'businessApproval').stdout.trim(), /^feature-spec\.md@/, 'the brief belongs to the plan approval only');
    write(root, `sdlc/runs/${R2}/design.md`, '# Design brief\n');
    expectExit(version(root, R2, 'planApproval'), 1);
  });

  it('takes the design brief from the path the manifest names, when it names one', (t) => {
    const root = sampleRepo(t);
    const manifest = JSON.parse(read(root, `sdlc/runs/${R1}/run.json`));
    write(root, `sdlc/runs/${R1}/ux/brief.md`, '# Design brief\n');
    write(root, `sdlc/runs/${R1}/run.json`, JSON.stringify({ ...manifest, artifactPaths: { ...manifest.artifactPaths, design: `sdlc/runs/${R1}/ux/brief.md` } }, null, 2));
    assert.match(version(root, R1, 'planApproval').stdout.trim(), /^technical-plan\.md\+brief\.md@[0-9a-f]{12}$/);
  });

  it('exits 1 for a gate that has no document yet, and 2 for an unknown run or gate', (t) => {
    const root = sampleRepo(t);
    expectExit(version(root, R2, 'planApproval'), 1);
    expectExit(version(root, 'R9-nothing', 'planApproval'), 2);
    expectExit(version(root, R1, 'tests'), 2);
  });
});

// The specification of a bug run is approved with the evidence that the bug is there: the card says whether it
// was reproduced, and the version the owner approves covers the reproduction.
describe('a bug run', () => {
  it('shows on the approval card of the specification whether the bug was reproduced', (t) => {
    const root = installedRepo(t);
    const { R, id } = makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION', manifest: { kind: 'bug' } });
    expectExit(render(root), 0);
    let board = read(root, `${R}/board.md`);
    assert.match(board, /· bug fix ·/);
    assert.match(board, /\*\*Reproduction:\*\* not reproduced yet\. The bug has to be shown by a failing test before you approve\./);
    write(root, `${R}/evidence/reproduction.json`, JSON.stringify({ runId: id, commit: 'a1b2c3d4e5f6a7b8', control: null, files: { 'tests/price.test.js': { result: 'REPRODUCED', exit: 1 } } }));
    expectExit(render(root), 0);
    board = read(root, `${R}/board.md`);
    assert.match(board, /\*\*Reproduction:\*\* the bug is shown before any change: tests\/price\.test\.js fails on commit a1b2c3d4e5\./);
    assert.match(board, /You decide on version `feature-spec\.md\+reproduction\.json@[0-9a-f]{12}`/);
    assert.ok(read(root, 'sdlc/board.html').includes('a1b2c3d4e5'), 'the page does not carry the reproduction');
  });

  it('says nothing of a reproduction for a feature run', (t) => {
    const root = installedRepo(t);
    const { R } = makeRun(root, { stage: 'AWAITING_BUSINESS_DECISION' });
    expectExit(render(root), 0);
    const board = read(root, `${R}/board.md`);
    assert.ok(!/Reproduction|bug fix/.test(board), 'a feature run speaks of a reproduction');
  });
});

// A run waits for the runs it depends on until they are DONE. A local-record run that could never be DONE would
// keep a run that depends on it waiting for ever.
describe('runs that depend on a local-record run', () => {
  it('wait until it is merged and DONE, and no longer', (t) => {
    const root = installedRepo(t);
    makeRun(root, { id: 'R1', stage: 'READY_FOR_ACCEPTANCE', gates: { humanAcceptance: 'PASSED' } });
    const { R } = makeRun(root, { id: 'R2', stage: 'ANALYSIS', manifest: { dependsOn: ['R1'] } });
    rmSync(join(root, R, 'decisions'), { recursive: true }); // R2 has no reply of the owner's yet
    expectExit(render(root), 0);
    assert.match(read(root, `${R}/board.md`), /Waiting for R1 \(READY_FOR_ACCEPTANCE\)\./);
    makeRun(root, { id: 'R1', stage: 'DONE' });
    expectExit(render(root), 0);
    assert.ok(!/Waiting for R1/.test(read(root, `${R}/board.md`)), 'R2 still waits for R1, which is DONE');
  });
});
