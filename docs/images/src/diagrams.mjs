#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Draws the explanatory diagrams of the guides as SVG.
//   node docs/images/src/diagrams.mjs [outDir]      (default: docs/images/)
// Each diagram is written as <name>.en.svg. The SVGs carry their own background and a
// dark variant (prefers-color-scheme), so they read the same on GitHub in a light or a dark theme.
// Change a diagram here and run the script again; do not edit the SVG files by hand.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] || join(here, '..');
mkdirSync(outDir, { recursive: true });

// ------------------------------------------------------------------------------------------------ drawing kit
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const KINDS = ['owner', 'agent', 'orch', 'check', 'board', 'repo', 'danger', 'plain'];

const STYLE = `
text{font-family:${FONT};fill:var(--ink)}
.mono{font-family:${MONO}}
svg{--bg:#ffffff;--ink:#1f2328;--muted:#59636e;--line:#d1d9e0;--arrow:#59636e;
--owner-f:#fff4d6;--owner-s:#d4a72c;--owner-t:#6c4400;
--agent-f:#ddf4ff;--agent-s:#54aeff;--agent-t:#0a3069;
--orch-f:#0969da;--orch-s:#0969da;--orch-t:#ffffff;
--check-f:#dafbe1;--check-s:#4ac26b;--check-t:#0f4a1f;
--board-f:#fbefff;--board-s:#c297ff;--board-t:#3e1f79;
--repo-f:#f6f8fa;--repo-s:#d1d9e0;--repo-t:#1f2328;
--danger-f:#ffebe9;--danger-s:#cf222e;--danger-t:#82071e;
--plain-f:#ffffff;--plain-s:#d1d9e0;--plain-t:#1f2328}
@media (prefers-color-scheme:dark){svg{--bg:#0d1117;--ink:#e6edf3;--muted:#9198a1;--line:#3d444d;--arrow:#9198a1;
--owner-f:#3b2a05;--owner-s:#bb8009;--owner-t:#f2cc60;
--agent-f:#0c2d6b;--agent-s:#1f6feb;--agent-t:#cae8ff;
--orch-f:#1f6feb;--orch-s:#388bfd;--orch-t:#ffffff;
--check-f:#0b3a1c;--check-s:#2ea043;--check-t:#aff5b4;
--board-f:#2b1659;--board-s:#8957e5;--board-t:#e2d1ff;
--repo-f:#151b23;--repo-s:#3d444d;--repo-t:#e6edf3;
--danger-f:#3c0d0d;--danger-s:#f85149;--danger-t:#ffdcd7;
--plain-f:#0d1117;--plain-s:#3d444d;--plain-t:#e6edf3}}
.bg{fill:var(--bg)}
.muted{fill:var(--muted)}
.line{stroke:var(--line);fill:none}
${KINDS.map((k) => `.f-${k}{fill:var(--${k}-f);stroke:var(--${k}-s)}.t-${k}{fill:var(--${k}-t)}.s-${k}{stroke:var(--${k}-s);fill:none}.m-${k}{fill:var(--${k}-s)}`).join('\n')}
.a-ink{stroke:var(--arrow);fill:none}.m-ink{fill:var(--arrow)}
`;

function svg(w, h, title, desc, body) {
  const markers = ['ink', ...KINDS].map((k) => `<marker id="ah-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="m-${k}"/></marker>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<style>${STYLE}</style>
<defs>${markers}</defs>
<rect class="bg" x="0" y="0" width="${w}" height="${h}" rx="16"/>
${body}
</svg>
`;
}

// Text, one tspan per line. A string with \n makes several lines.
function text(x, y, s, o = {}) {
  const { size = 14, weight = 400, anchor = 'start', cls = '', lh = 1.32, mono = false } = o;
  const lines = Array.isArray(s) ? s : String(s).split('\n');
  const c = [cls, mono ? 'mono' : ''].filter(Boolean).join(' ');
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${c ? ` class="${c}"` : ''}>${lines.map((l, i) => `<tspan x="${x}"${i ? ` dy="${(size * lh).toFixed(1)}"` : ''}>${esc(l)}</tspan>`).join('')}</text>`;
}
// Greedy word wrap by an estimate of the glyph width.
function wrap(s, width, size, mono = false) {
  const per = Math.max(8, Math.floor(width / (size * (mono ? 0.61 : 0.53))));
  const out = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= per) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}
function rect(x, y, w, h, kind = 'plain', o = {}) {
  const { r = 12, dash = false, sw = 1.5 } = o;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" class="f-${kind}" stroke-width="${sw}"${dash ? ' stroke-dasharray="6 5"' : ''}/>`;
}
// A box with a bold title and wrapped lines under it.
function box(x, y, w, h, kind, title, sub = '', o = {}) {
  const { align = 'center', ts = 15, ss = 12.5, pad = 14, top = 26, icon = null, subMono = false, dash = false } = o;
  const tx = align === 'center' ? x + w / 2 : x + pad;
  let out = rect(x, y, w, h, kind, { dash });
  let ty = y + top;
  if (icon === 'person') { out += person(x + w / 2, y + 26, 22, kind); ty += 26; }
  if (title) out += text(tx, ty, wrap(title, w - 2 * pad, ts), { size: ts, weight: 650, anchor: align === 'center' ? 'middle' : 'start', cls: `t-${kind}` });
  const tl = title ? wrap(title, w - 2 * pad, ts).length : 0;
  if (sub) out += text(tx, ty + (tl ? (tl - 1) * ts * 1.3 + ts + 6 : 0), wrap(sub, w - 2 * pad, ss, subMono), { size: ss, anchor: align === 'center' ? 'middle' : 'start', cls: `t-${kind}`, mono: subMono });
  return out;
}
function person(cx, cy, s, kind = 'owner') {
  const r = s * 0.2;
  return `<g class="m-${kind}"><circle cx="${cx}" cy="${cy - s * 0.18}" r="${r}"/><path d="M${cx - s * 0.36} ${cy + s * 0.42}a${s * 0.36} ${s * 0.34} 0 0 1 ${s * 0.72} 0z"/></g>`;
}
function check(cx, cy, s, kind = 'check') {
  return `<circle cx="${cx}" cy="${cy}" r="${s / 2}" class="m-${kind}"/><path d="M${cx - s * 0.22} ${cy}l${s * 0.15} ${s * 0.16} ${s * 0.3}-${s * 0.32}" stroke="#fff" stroke-width="${s * 0.12}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
}
// A path through points with an arrow head at the end (and at the start with both).
function arrow(pts, o = {}) {
  const { kind = 'ink', dash = false, both = false, sw = 1.8, curve = false } = o;
  const cls = kind === 'ink' ? 'a-ink' : `s-${kind}`;
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  if (curve && pts.length === 3) d += ` Q${pts[1][0]} ${pts[1][1]} ${pts[2][0]} ${pts[2][1]}`;
  else for (const p of pts.slice(1)) d += ` L${p[0]} ${p[1]}`;
  return `<path d="${d}" class="${cls}" stroke-width="${sw}" stroke-linejoin="round"${dash ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#ah-${kind})"${both ? ` marker-start="url(#ah-${kind})"` : ''}/>`;
}
function chip(x, y, w, h, kind, label, o = {}) {
  const { size = 12.5, mono = true, anchor = 'start', weight = 500 } = o;
  const tx = anchor === 'middle' ? x + w / 2 : x + 10;
  return rect(x, y, w, h, kind, { r: 7, sw: 1 }) + text(tx, y + h / 2 + size * 0.36, label, { size, mono, anchor, cls: `t-${kind}`, weight });
}
const heading = (t, sub) => text(32, 46, t, { size: 21, weight: 700 }) + (sub ? text(32, 72, sub, { size: 13.5, cls: 'muted' }) : '');

// ------------------------------------------------------------------------------------------------ diagrams
const D = {};

D.overview = () => {
  const W = 1180, H = 640;
  let b = heading('How Imperata works',
    'One requirement per run. Agents do the work, you make the decisions, the repository keeps the evidence.');
  const y = 110, h = 150;
  b += box(32, y, 168, h, 'owner', 'You, the owner', 'answer questions, approve each gate, accept the delivery', { icon: 'person', top: 22 });
  b += box(278, y, 212, h, 'board', 'Run board', 'every run at a glance: question cards, approval cards, progress', { top: 34 });
  b += box(568, y, 212, h, 'orch', 'Orchestrator', 'plans the run, delegates one task at a time, checks every gate, reports', { top: 34 });
  // specialists
  b += rect(846, 96, 302, 178, 'repo', { dash: true });
  b += text(997, 118, 'Specialists (subagents)', { size: 12.5, weight: 650, anchor: 'middle', cls: 'muted' });
  const names = ['Business Analyst', 'UX Designer', 'Architect', 'Developer', 'QA Engineer', 'Code Reviewer'];
  names.forEach((n, i) => { const cx = 858 + (i % 2) * 145; const cy = 130 + Math.floor(i / 2) * 46; b += chip(cx, cy, 133, 38, 'agent', n, { mono: false, anchor: 'middle', size: 13, weight: 600 }); });
  // arrows on the top row
  b += arrow([[200, 168], [278, 168]], { kind: 'owner' }) + text(239, 156, 'decide', { size: 12, anchor: 'middle', cls: 'muted' });
  b += arrow([[278, 206], [200, 206]]) + text(239, 226, 'your move', { size: 12, anchor: 'middle', cls: 'muted' });
  b += arrow([[490, 185], [568, 185]], { kind: 'board' }) + text(529, 173, 'Send', { size: 12, anchor: 'middle', cls: 'muted' }) + text(529, 205, '(or paste)', { size: 11.5, anchor: 'middle', cls: 'muted' });
  b += arrow([[780, 185], [846, 185]], { kind: 'agent' }) + text(813, 173, 'delegates', { size: 12, anchor: 'middle', cls: 'muted' });
  // repository band
  const ry = 340;
  b += rect(32, ry, 1116, 236, 'repo', { r: 14 });
  b += text(52, ry + 30, 'Your project repository', { size: 16, weight: 700 }) + text(52, ry + 52, 'every decision and every piece of evidence lives here, in git', { size: 12.5, cls: 'muted' });
  b += text(52, ry + 86, 'sdlc/runs/<runId>/', { size: 13, weight: 650, mono: true });
  const files = ['run.json', 'input.md', 'clarification.md', 'feature-spec.md', 'technical-plan.md', 'test-report.md', 'review.md', 'delivery.md', 'decisions/'];
  files.forEach((f, i) => { b += chip(52 + (i % 3) * 196, ry + 100 + Math.floor(i / 3) * 40, 184, 32, f === 'decisions/' ? 'owner' : 'plain', f); });
  b += text(680, ry + 86, 'scripts/', { size: 13, weight: 650, mono: true });
  b += chip(680, ry + 100, 220, 32, 'check', 'validate-gates.mjs');
  b += text(680, ry + 148, 'gate check before every stage', { size: 11.5, cls: 'muted' });
  b += chip(680, ry + 160, 220, 32, 'board', 'render-run-board.mjs');
  b += text(680, ry + 208, 'draws the board from the files', { size: 11.5, cls: 'muted' });
  b += text(926, ry + 86, 'rules', { size: 13, weight: 650 });
  b += chip(926, ry + 100, 202, 32, 'owner', '.orchestra/project.md');
  b += text(926, ry + 148, 'your product, read by every agent', { size: 11.5, cls: 'muted' });
  b += chip(926, ry + 160, 202, 32, 'agent', '.claude/  .github/');
  b += text(926, ry + 208, 'agents, hooks, skills', { size: 11.5, cls: 'muted' });
  // vertical arrows
  b += arrow([[384, ry], [384, y + h]], { kind: 'board' }) + text(374, 298, 'rendered from', { size: 12, anchor: 'end', cls: 'muted' }) + text(374, 314, 'the run files', { size: 12, anchor: 'end', cls: 'muted' });
  b += arrow([[674, y + h], [674, ry]], { both: true }) + text(686, 298, 'records decisions,', { size: 12, cls: 'muted' }) + text(686, 314, 'updates run.json', { size: 12, cls: 'muted' });
  b += arrow([[997, 274], [997, ry]], { kind: 'agent' }) + text(1009, 302, 'specs, plans,', { size: 12, cls: 'muted' }) + text(1009, 318, 'code, tests', { size: 12, cls: 'muted' });
  b += text(32, 606, 'The board decides nothing. A gate passes only on a person\'s decision or on real evidence: exit codes, CI runs, merged pull requests.', { size: 12.5, cls: 'muted' });
  return svg(W, H, 'How Imperata works', 'The owner decides on the run board; the Orchestrator delegates to six specialists; the repository holds the run files.', b);
};

D['kit-install'] = () => {
  const W = 1180, H = 620;
  let b = heading('Install the kit into any project',
    'The kit stays in its own folder. imperata-kit.mjs copies only what a project needs and records what it installed.');
  // the kit's repository
  b += rect(32, 104, 340, 420, 'repo', { r: 14 });
  b += text(52, 136, 'imperata', { size: 17, weight: 700, mono: true });
  b += text(52, 158, 'this repository, cloned once per machine', { size: 12.5, cls: 'muted' });
  const items = [
    ['kit.json', 'what goes where, for which tool'],
    ['imperata-kit.mjs', 'install · status · update'],
    ['starter/', 'shared parts and the Copilot layer'],
    ['starter-claude-code/', 'the Claude Code layer'],
    ['docs/', 'blueprint, guides, images'],
  ];
  items.forEach(([n, d], i) => { const yy = 196 + i * 62; b += chip(52, yy, 300, 30, i === 1 ? 'orch' : 'plain', n); b += text(56, yy + 48, d, { size: 12, cls: 'muted' }); });
  // commands
  b += text(548, 140, 'node imperata-kit.mjs', { size: 14, weight: 650, anchor: 'middle', mono: true });
  const cmds = [
    ['install <repo> --tools claude,copilot', 'first time; add --dry-run to preview', 'orch'],
    ['status <repo>', 'what an update would change; writes nothing', 'plain'],
    ['update <repo>', 'replaces only kit files you did not change', 'plain'],
  ];
  cmds.forEach(([c, d], i) => { const yy = 170 + i * 92; b += chip(396, yy, 304, 34, c[0] === 'i' ? 'orch' : 'agent', c, { size: 12 }); b += text(400, yy + 54, wrap(d, 300, 12), { size: 12, cls: 'muted' }); });
  b += arrow([[372, 314], [392, 314]], { sw: 2.2 }) + arrow([[704, 314], [728, 314]], { sw: 2.2 });
  // project (with a second one behind it)
  b += rect(742, 112, 418, 424, 'repo', { r: 14 });
  b += rect(732, 104, 418, 424, 'plain', { r: 14 });
  b += text(752, 136, 'your project repository', { size: 16, weight: 700 });
  b += text(752, 158, 'as many projects as you like', { size: 12.5, cls: 'muted' });
  b += rect(752, 172, 378, 150, 'agent', { r: 10, sw: 1 });
  b += text(766, 194, 'Kit files: replaced on update, unless you changed them', { size: 12.5, weight: 650, cls: 't-agent' });
  ['.claude/  agents · hooks · skills', '.github/  agents · skills · instructions', 'scripts/  validate · render · board-server', '.orchestra/  schemas · templates · guide', '/imperata-*  commands, as skills'].forEach((l, i) => { b += text(766, 218 + i * 21, l, { size: 12, mono: true, cls: 't-agent' }); });
  b += rect(752, 332, 378, 132, 'owner', { r: 10, sw: 1 });
  b += text(766, 354, 'Yours: never overwritten', { size: 12.5, weight: 650, cls: 't-owner' });
  [['.orchestra/project.md', '← fill this in'], ['CLAUDE.md', '+ 2 import lines'], ['.claude/settings.json', 'missing rules added'], ['.gitignore', 'missing lines added']].forEach(([f, d], i) => {
    b += text(766, 378 + i * 21, f, { size: 12, mono: true, cls: 't-owner' }) + text(950, 378 + i * 21, d, { size: 12, cls: 't-owner' });
  });
  b += rect(752, 474, 378, 42, 'check', { r: 10, sw: 1 });
  b += text(766, 500, '.orchestra/installed.json', { size: 12, mono: true, cls: 't-check' }) + text(960, 500, 'version + hash per file', { size: 12, cls: 't-check' });
  b += text(32, 570, 'Never copy the kit\'s repository into a project, and never put product documents in it.', { size: 13, weight: 600 });
  b += text(32, 594, 'The installer commits nothing: review the result with git status and git diff, then commit it in the project.', { size: 12.5, cls: 'muted' });
  return svg(W, H, 'Installing the Imperata kit', 'imperata-kit.mjs copies kit files from the kit\'s repository into a project, keeps the project-owned files, and records the install.', b);
};

D.workflow = () => {
  const W = 1280, H = 530;
  let b = heading('One run, from requirement to Done',
    'Seven steps, six gates. Three gates are yours; the other three pass only on evidence.');
  b += rect(28, 92, 1224, 34, 'orch', { r: 8, sw: 1 }) + text(640, 114, 'Orchestrator: delegates each step, records the result, runs the gate validator before every stage change', { size: 13, weight: 600, anchor: 'middle', cls: 't-orch' });
  const steps = [
    ['Analysis', 'Business Analyst', 'feature-spec.md\nclarification.md', 'businessApproval', 'you approve the spec', true],
    ['Design & plan', 'Architect\n(+ UX Designer for UI)', 'technical-plan.md\n(Complexity, Skills)', 'planApproval', 'you approve the plan', true],
    ['Implementation', 'Developer', 'code +\ntargeted tests', 'implementation', 'build, typecheck, tests', false],
    ['Verification', 'QA Engineer', 'test-plan.md\ntest-report.md', 'tests', 'real runs; CI in PR mode', false],
    ['Review', 'Code Reviewer', 'review.md', 'review', 'no open blocker', false],
    ['Acceptance', 'You', 'delivery.md', 'humanAcceptance', 'you accept', true],
    ['Done', '—', 'delivery merged:\nPR or local merge', 'DONE', '', null],
  ];
  const cw = 156, gap = 22, x0 = 28, cy = 146, ch = 214;
  steps.forEach(([name, actor, out, gate, gnote, human], i) => {
    const x = x0 + i * (cw + gap);
    const kind = human === null ? 'check' : (actor === 'You' ? 'owner' : 'plain');
    b += rect(x, cy, cw, ch, kind === 'owner' ? 'owner' : 'plain');
    const tl = wrap(`${i + 1} · ${name}`, cw - 20, 14.5);
    const dy = (tl.length - 1) * 19;
    b += text(x + 12, cy + 26, tl, { size: 14.5, weight: 700 });
    b += text(x + 12, cy + 50 + dy, actor.split('\n'), { size: 12.5, weight: 600, cls: actor === '—' ? 'muted' : (kind === 'owner' ? 't-owner' : 't-agent') });
    b += text(x + 12, cy + 96 + dy, out.split('\n'), { size: 11.5, mono: true, cls: 'muted' });
    // gate footer
    const gy = cy + ch - 58;
    const gk = human === null ? 'check' : human ? 'owner' : 'check';
    b += `<path d="M${x} ${gy}H${x + cw}V${cy + ch - 12}a12 12 0 0 1 -12 12H${x + 12}a12 12 0 0 1 -12 -12z" class="f-${gk}" stroke-width="1.5"/>`;
    if (human) b += person(x + 20, gy + 22, 20, 'owner'); else b += check(x + 20, gy + 21, 16, 'check');
    b += text(x + 36, gy + 24, gate, { size: 11.5, mono: true, weight: 650, cls: `t-${gk}` });
    if (gnote) b += text(x + 12, gy + 44, gnote, { size: 11, cls: `t-${gk}` });
    if (i < steps.length - 1) b += arrow([[x + cw + 2, cy + 90], [x + cw + gap - 2, cy + 90]], { sw: 2 });
  });
  // repair loop
  const xImpl = x0 + 2 * (cw + gap) + cw / 2, xVer = x0 + 3 * (cw + gap) + cw / 2, xRev = x0 + 4 * (cw + gap) + cw / 2;
  const ly = cy + ch + 34;
  b += `<path d="M${xRev} ${cy + ch}V${ly}" class="s-danger" stroke-width="1.8" stroke-dasharray="6 5"/>`;
  b += arrow([[xVer, cy + ch], [xVer, ly], [xImpl, ly], [xImpl, cy + ch + 4]], { kind: 'danger', dash: true });
  b += `<path d="M${xRev} ${ly}H${xVer}" class="s-danger" stroke-width="1.8" stroke-dasharray="6 5"/>`;
  b += text(xVer, ly + 24, 'defect → scoped fix by the Developer, then the tests again · at most 2 automatic attempts, then BLOCKED and back to you', { size: 12.5, anchor: 'middle', cls: 't-danger' });
  // legend
  const lg = ly + 76;
  b += person(44, lg, 20, 'owner') + text(62, lg + 5, 'a person decides; in pull-request mode, by merging the pull request', { size: 12.5 });
  b += check(674, lg, 16, 'check') + text(690, lg + 5, 'evidence decides: exit codes, test reports, CI', { size: 12.5 });
  b += text(32, lg + 36, 'A question that changes an acceptance criterion must be answered before businessApproval. Nothing reaches the main branch before independent tests and review.', { size: 12.5, cls: 'muted' });
  return svg(W, H, 'Workflow and gates of a run', 'Analysis, design and plan, implementation, verification, review, acceptance and done, each ending in a gate.', b);
};

D['decision-loop'] = () => {
  const W = 1120, H = 660;
  let b = heading('How you decide: the loop at every gate',
    'You never edit run files. You answer on the board; the Orchestrator records what you sent.');
  const bw = 280, bh = 112;
  const nodes = [
    [420, 100, 'agent', '1 · Agents draft', 'The Business Analyst drafts the spec and lists what the sources leave open, with options; the Orchestrator saves them in the run folder.'],
    [800, 236, 'board', '2 · The board shows them', 'render-run-board.mjs turns the run files into question cards and, at your gate, an approval card.'],
    [660, 434, 'owner', '3 · You decide', 'One card at a time: pick an option (keys 1–9) or write your own. Then Approve or Request changes.'],
    [180, 434, 'repo', '4 · Send to Orchestrator', 'board-server.mjs saves your reply verbatim as decisions/<time>.md. No agent may write there.'],
    [40, 236, 'agent', '5 · The Orchestrator records', 'It cites the file in clarification.md, updates run.json, checks the version you approved and moves to the next step.'],
  ];
  nodes.forEach(([x, y, k, t, s]) => { b += box(x, y, bw, bh, k, t, s, { align: 'left', ts: 15, ss: 12.5, top: 28 }); });
  const c = (i) => [nodes[i][0] + bw / 2, nodes[i][1] + bh / 2];
  b += arrow([[700, 156], [940, 160], [945, 230]], { curve: true, kind: 'board' });
  b += arrow([[1010, 348], [1010, 400], [945, 428]], { curve: true, kind: 'owner' });
  b += arrow([[656, 490], [550, 490], [464, 490]]);
  b += arrow([[250, 428], [180, 400], [180, 352]], { curve: true, kind: 'agent' });
  b += arrow([[180, 232], [200, 160], [414, 156]], { curve: true, kind: 'agent' });
  void c;
  b += text(560, 330, 'one loop', { size: 22, weight: 700, anchor: 'middle', cls: 'muted' });
  b += text(560, 358, 'per gate', { size: 22, weight: 700, anchor: 'middle', cls: 'muted' });
  // notes
  b += rect(32, 572, 520, 66, 'plain', { r: 10, dash: true });
  b += text(48, 596, wrap('No server? Open sdlc/board.html as a file, press Copy reply and paste it into the Orchestrator session.', 490, 12.5), { size: 12.5 });
  b += rect(568, 572, 520, 66, 'plain', { r: 10, dash: true });
  b += text(584, 596, wrap('board-server.mjs --auto-run claude|copilot: each Send starts a fresh, non-interactive Orchestrator that stops at the next human gate.', 490, 12.5), { size: 12.5 });
  return svg(W, H, 'The decision loop', 'Agents draft questions, the board shows them, you decide and send, the Orchestrator records and continues.', b);
};

D['approval-modes'] = () => {
  const W = 1180, H = 580;
  let b = heading('Two ways to pass a human gate',
    'Each run declares its approvalMode in run.json. Start with local-record; move to pull-request once the roles work.');
  // local-record
  b += rect(32, 100, 420, 440, 'repo', { r: 14 });
  b += text(52, 132, 'local-record', { size: 17, weight: 700, mono: true }) + text(52, 154, 'first pilot · no GitHub remote needed', { size: 12.5, cls: 'muted' });
  b += box(72, 176, 340, 54, 'owner', 'You press Approve on the board', '', { top: 33, ts: 14 });
  b += arrow([[242, 230], [242, 254]]);
  b += box(72, 258, 340, 54, 'plain', '', '', {}) + text(242, 290, 'decisions/<time>.md', { size: 13, mono: true, anchor: 'middle', weight: 600 });
  b += arrow([[242, 312], [242, 336]]);
  b += box(72, 340, 340, 54, 'plain', '', '') + text(242, 372, 'run.json  approvals.<gate>.recordPath', { size: 12, mono: true, anchor: 'middle', weight: 600 });
  b += text(52, 428, 'Tests gate: the QA test report in the run folder.', { size: 12.5 });
  b += rect(52, 446, 380, 74, 'owner', { r: 10, sw: 1 });
  b += text(66, 470, wrap('Nothing outside the repository confirms who approved. The validator prints a warning, and the delivery dossier says so.', 350, 12.5), { size: 12.5, cls: 't-owner' });
  // pull-request
  b += rect(472, 100, 676, 440, 'repo', { r: 14 });
  b += text(492, 132, 'pull-request', { size: 17, weight: 700, mono: true }) + text(492, 154, 'GitHub remote · gh signed in · protected main branch', { size: 12.5, cls: 'muted' });
  const my = 330;
  b += `<path d="M500 ${my}H1124" class="s-repo" stroke-width="5" stroke-linecap="round" style="stroke:var(--muted)"/>`;
  b += text(500, my + 26, 'main', { size: 12.5, mono: true, weight: 650, cls: 'muted' });
  const branches = [
    [508, 672, 'sdlc/<runId>/spec', 'businessApproval', 'spec, clarification', 'agent'],
    [704, 868, 'sdlc/<runId>/plan', 'planApproval', 'plan and tasks', 'agent'],
    [900, 1076, 'sdlc/<runId>/delivery', 'humanAcceptance', 'code, tests, review', 'agent'],
  ];
  branches.forEach(([x1, x2, name, gate, holds], i) => {
    const by = 230;
    b += `<path d="M${x1} ${my}C${x1 + 20} ${my} ${x1 + 10} ${by} ${x1 + 40} ${by}H${x2 - 40}C${x2 - 10} ${by} ${x2 - 20} ${my} ${x2} ${my}" class="s-agent" stroke-width="3" fill="none"/>`;
    for (let k = 0; k < (i === 2 ? 3 : 2); k += 1) b += `<circle cx="${x1 + 60 + k * 36}" cy="${by}" r="6" class="f-agent" stroke-width="2"/>`;
    b += text(x1 + 34, by - 16, name, { size: 11.5, mono: true, weight: 650, cls: 't-agent' });
    b += text(x1 + 34, by + 26, holds, { size: 11, cls: 'muted' });
    b += `<circle cx="${x2}" cy="${my}" r="11" class="f-owner" stroke-width="2"/>` + person(x2, my + 1, 14, 'owner');
    b += text(x2, my + 40, 'merge =', { size: 11.5, anchor: 'middle', cls: 't-owner' }) + text(x2, my + 56, gate, { size: 11.5, mono: true, weight: 650, anchor: 'middle', cls: 't-owner' });
  });
  b += text(934, 274, 'draft PR · CI = test evidence', { size: 11, cls: 't-check', weight: 650 });
  const notes = [
    'The Orchestrator pushes branches and opens pull requests only after you allow it. It never merges.',
    'validate-gates.mjs --verify-remote asks GitHub who merged each pull request and whether CI passed.',
    'Only the delivery pull request may close the tracker item (Closes #N); the others say Refs #N.',
  ];
  notes.forEach((n, i) => { b += text(492, 442 + i * 26, `•  ${n}`, { size: 12.5 }); });
  return svg(W, H, 'Approval modes: local-record and pull-request', 'In local-record a decision file is the record; in pull-request each human gate is the merge of its own pull request.', b);
};

// The two modes side by side, step by step through one run: what passes each gate, and what you do.
D['approval-modes-steps'] = () => {
  const W = 1200, H = 668;
  let b = heading('local-record or pull-request: the same run, step by step',
    'The agents do the same work in both modes. What changes is how each gate is passed, and where the proof of it lives.');
  const x0 = 196, cw = 184, gap = 13;
  const cx = (i) => x0 + i * (cw + gap);
  const cols = [
    ['1 · Specification', 'businessApproval'],
    ['2 · Plan', 'planApproval'],
    ['3 · Tests', 'tests'],
    ['4 · Delivery', 'humanAcceptance'],
    ['5 · Done', 'DONE'],
  ];
  cols.forEach(([t, g], i) => {
    b += rect(cx(i), 96, cw, 46, 'repo', { r: 9, sw: 1 });
    b += text(cx(i) + 12, 115, t, { size: 13, weight: 700 });
    b += text(cx(i) + 12, 133, g, { size: 11.5, mono: true, cls: 'muted' });
  });
  b += arrow([[x0, 154], [x0 + 5 * cw + 4 * gap, 154]]);
  const lanes = [
    {
      y: 168, mode: 'local-record', sub: 'your decision, saved in the repository',
      cells: [
        ['owner', 'You press Approve on the board', 'saved in decisions/; run.json points at it'],
        ['owner', 'You press Approve on the board', 'for the version of the plan you saw'],
        ['check', 'QA runs the tests locally', 'the test report in the run folder is the evidence'],
        ['owner', 'You press Approve on the board', 'the run is Accepted, not yet merged'],
        ['owner', 'You merge into main, or send /imperata-merge', 'git confirms the commit is on main'],
      ],
      note: 'Nothing is pushed and no pull request is opened. Nothing outside the repository confirms who approved: the gate check warns, and the delivery says so.',
    },
    {
      y: 356, mode: 'pull-request', sub: 'your merge of a pull request on GitHub',
      cells: [
        ['owner', 'You merge the spec pull request', 'sdlc/<runId>/spec'],
        ['owner', 'You merge the plan pull request', 'sdlc/<runId>/plan'],
        ['check', 'CI passes on the delivery pull request', 'a draft until tests and review pass'],
        ['owner', 'You merge the delivery pull request', 'sdlc/<runId>/delivery'],
        ['owner', 'You send /imperata-close', 'the Orchestrator records DONE'],
      ],
      note: 'The Orchestrator pushes three branches and opens three pull requests, only with your permission, and never merges. GitHub records who merged each one; --verify-remote checks it.',
    },
  ];
  for (const lane of lanes) {
    const ch = 116;
    b += rect(32, lane.y, 152, ch, 'repo', { r: 12 });
    b += text(46, lane.y + 32, lane.mode, { size: 15, weight: 700, mono: true });
    b += text(46, lane.y + 56, wrap('A gate passes on', 130, 12), { size: 12, cls: 'muted' });
    b += text(46, lane.y + 74, wrap(lane.sub, 126, 12.5), { size: 12.5, weight: 600 });
    lane.cells.forEach(([k, t, s], i) => {
      const mono = s.startsWith('sdlc/');
      b += box(cx(i), lane.y, cw, ch, k, t, s, { align: 'left', ts: 13.5, ss: mono ? 11 : 12, top: 26, pad: 12, subMono: mono });
    });
    b += rect(x0, lane.y + ch + 10, 5 * cw + 4 * gap, 46, 'plain', { r: 9, dash: true });
    b += text(x0 + 14, lane.y + ch + 29, wrap(lane.note, 5 * cw + 4 * gap - 28, 12.5), { size: 12.5 });
  }
  const cy = 544;
  b += box(32, cy, 560, 96, 'plain', 'Choose local-record for', 'your first runs · a repository with no GitHub remote · when pushes are not allowed · a security fix that must stay unpublished until it is accepted', { align: 'left', ts: 14, ss: 12.5, top: 28 });
  b += box(608, cy, 560, 96, 'plain', 'Choose pull-request for', 'a GitHub remote with gh signed in · you allow the Orchestrator to push and open pull requests · a main branch only a person can merge · the required CI checks set up', { align: 'left', ts: 14, ss: 12.5, top: 28 });
  return svg(W, H, 'Approval modes, step by step', 'The five steps of a run in local-record mode and in pull-request mode: what you do at each gate, what passes the tests gate, and when to choose each mode.', b);
};

D['run-folder'] = () => {
  const rows = [
    ['run.json', 'Orchestrator', 'orch', 'stage, gate results, approvals, blockers', 'every gate'],
    ['input.md', 'Orchestrator', 'orch', 'the original request and its sources', '—'],
    ['clarification.md', 'BA drafts, Orchestrator records', 'agent', 'questions, options, your decisions', 'businessApproval'],
    ['feature-spec.md', 'Orchestrator, from the BA', 'agent', 'business rules, acceptance criteria', 'businessApproval'],
    ['design.md', 'Orchestrator, from the UX Designer', 'agent', 'flows, states, Figma links, or N/A', 'planApproval'],
    ['technical-plan.md', 'Orchestrator, from the Architect', 'agent', 'tasks with Complexity and Skills', 'planApproval'],
    ['test-plan.md · test-report.md', 'QA Engineer', 'agent', 'test matrix; real commands, exit codes', 'tests'],
    ['review.md', 'Orchestrator, from the Reviewer', 'agent', 'findings and what was done with each', 'review'],
    ['delivery.md', 'Orchestrator', 'orch', 'traceability, model per task, proven / unproven', 'humanAcceptance'],
    ['evidence/', 'QA, Developer, lock-tests.mjs', 'agent', 'logs, JUnit, traces, test lock, calibration, diff', 'tests · review'],
    ['decisions/', 'board-server.mjs only', 'owner', 'your replies, verbatim', 'your gates'],
    ['board.md', 'render-run-board.mjs', 'board', 'the board as Mermaid, for pull requests', '—'],
  ];
  const W = 1080, top = 132, rh = 38, H = top + rows.length * rh + 90;
  let b = heading('Inside a run folder', 'sdlc/runs/<runId>/ is committed with the run. Every file follows a template in .orchestra/templates/.');
  const cx = [40, 300, 550, 900];
  ['File', 'Written by', 'What it holds', 'Used at gate'].forEach((h, i) => { b += text(cx[i], top - 14, h, { size: 12, weight: 700, cls: 'muted' }); });
  rows.forEach(([f, by, k, what, gate], i) => {
    const y = top + i * rh;
    if (i % 2 === 0) b += `<rect x="28" y="${y}" width="${W - 56}" height="${rh}" rx="6" class="f-repo" stroke-width="0"/>`;
    b += text(cx[0], y + 24, f, { size: 12.5, mono: true, weight: 600 });
    b += chip(cx[1], y + 6, 232, rh - 12, k, by, { mono: false, size: 12, weight: 600 });
    b += text(cx[2], y + 24, what, { size: 12.5 });
    b += text(cx[3], y + 24, gate, { size: 12, mono: gate !== '—' && !gate.includes(' '), cls: 'muted' });
  });
  b += text(40, H - 46, 'Next to the runs: sdlc/board.html, the live board page. It is generated and not committed.', { size: 12.5, cls: 'muted' });
  b += text(40, H - 24, 'In Claude Code, hooks keep an agent\'s file edits out of decisions/ and the QA Engineer\'s to test files and the run folder.', { size: 12.5, cls: 'muted' });
  return svg(W, H, 'Files of a run folder', 'Each file of sdlc/runs/<runId>/, who writes it, what it holds and the gate that uses it.', b);
};

D['your-moves'] = () => {
  // [your move, is it a command, under it, who acts, what they do, what you get, kind of what you get]
  const rows = [
    ['/imperata-start <feature>', true, 'in a new Orchestrator session',
      'Business Analyst', 'drafts the specification and lists what the sources leave open',
      'Question cards on the board', 'board'],
    ['Answer the questions', false, 'on the board; Send, then tell it "decisions sent"',
      'Orchestrator', 'records each answer; the analyst completes the specification',
      'A specification to approve', 'board'],
    ['Approve the specification', false, 'or request changes, with a comment',
      'Orchestrator', 'checks that you approved the version it has',
      'Gate 1 · businessApproval', 'check'],
    ['/imperata-plan <runId>', true, 'in a new session',
      'Architect', 'writes the plan: decisions, tasks, complexity, skills',
      'A plan to approve', 'board'],
    ['Approve the plan', false, 'its decisions are approved with it',
      'Orchestrator', 'passes the gate on your decision, never on its own',
      'Gate 2 · planApproval', 'check'],
    ['/imperata-implement <runId>', true, 'for each task: try it, then say go on',
      'Developer, then QA Engineer', 'build one task and test the criteria it names',
      'A task to try: its owner check', 'board'],
    ['/imperata-verify <runId>', true, 'after the last task, in a new session',
      'QA Engineer, Code Reviewer', 'whole suite, test lock, calibration, review',
      'A delivery to accept', 'board'],
    ['Accept the delivery', false, 'after reading the dossier, tests and review',
      'Orchestrator', 'records your acceptance',
      'Gate 3 · humanAcceptance', 'check'],
    ['/imperata-merge <runId>', true, 'pull-request mode: merge the pull request, then /imperata-close',
      'Orchestrator', 'merges at your word and records the merge',
      'DONE', 'check'],
  ];
  const W = 1120, top = 150, rh = 62, pitch = 72, H = top + (rows.length - 1) * pitch + rh + 112;
  const col = [[72, 350], [458, 350], [844, 244]];
  let b = heading('Your part of a run: nine moves',
    'Five commands, one round of answers and three approvals. The agents do the rest and keep it as files in the run folder.');
  ['You send or decide', 'The agents', 'You get'].forEach((h, i) => { b += text(col[i][0] + 4, top - 14, h, { size: 12, weight: 700, cls: 'muted' }); });
  const cell = (x, y, w, kind, title, sub, mono) => rect(x, y, w, rh, kind, { r: 10 })
    + text(x + 14, y + 24, title, { size: 13.5, weight: 650, mono, cls: `t-${kind}` })
    + (sub ? text(x + 14, y + 42, wrap(sub, w - 28, 12), { size: 12, cls: `t-${kind}`, lh: 1.22 }) : '');
  rows.forEach(([move, isCommand, under, who, what, get, kind], i) => {
    const y = top + i * pitch;
    b += text(46, y + rh / 2 + 6, String(i + 1), { size: 16, weight: 700, anchor: 'middle', cls: 'muted' });
    b += cell(col[0][0], y, col[0][1], 'owner', move, under, isCommand);
    b += cell(col[1][0], y, col[1][1], 'agent', who, what, false);
    b += rect(col[2][0], y, col[2][1], rh, kind, { r: 10 }) + text(col[2][0] + col[2][1] / 2, y + rh / 2 + 5, get, { size: 13, weight: 650, anchor: 'middle', cls: `t-${kind}`, mono: get === 'DONE' });
    b += arrow([[col[0][0] + col[0][1] + 4, y + rh / 2], [col[1][0] - 4, y + rh / 2]]);
    b += arrow([[col[1][0] + col[1][1] + 4, y + rh / 2], [col[2][0] - 4, y + rh / 2]]);
  });
  const ny = top + (rows.length - 1) * pitch + rh + 22;
  b += rect(32, ny, 520, 66, 'plain', { r: 10, dash: true });
  b += text(48, ny + 24, wrap('Send each command but the first in a new Orchestrator session. The board gives the command for the next step, with the run\'s ID filled in.', 490, 12.5), { size: 12.5 });
  b += rect(568, ny, 520, 66, 'plain', { r: 10, dash: true });
  b += text(584, ny + 24, wrap('On the light track there is no move 5: the plan has no approval of its own. A bug starts with /imperata-bug instead of /imperata-start.', 490, 12.5), { size: 12.5 });
  return svg(W, H, 'Your part of a run', 'The nine moves of the owner in one run: five commands, one round of answers and three approvals, with what the agents do and what the owner gets after each.', b);
};

D.conventions = () => {
  const W = 1120, H = 668;
  let b = heading('Your conventions: written once, read at every step',
    'A stack skill holds the rules of one stack. A team\'s coding convention enters a project through it.');
  // What you bring, on the left.
  const left = [
    [104, 112, 'repo', 'The team\'s document', 'references/<convention>.md, kept as the team wrote it: the reason and an example for each rule.'],
    [240, 112, 'repo', 'The linter', 'Checks the rules a script can check. Its command stands in the skill, and the Developer runs it for each task.'],
    [376, 130, 'owner', 'The project profile', '.orchestra/project.md says that the convention holds and where it is, and names the security-sensitive areas. Every agent reads it first.'],
  ];
  left.forEach(([y, h, k, t, s]) => { b += box(32, y, 304, h, k, t, s, { align: 'left', ts: 15, ss: 12.5, top: 28 }); });
  // The stack skill, in the middle.
  const sx = 396, sy = 150, sw = 300, sh = 310;
  b += rect(sx, sy, sw, sh, 'board');
  b += text(sx + 16, sy + 30, '<stack>/SKILL.md', { size: 15, weight: 650, mono: true, cls: 't-board' });
  b += text(sx + 16, sy + 52, 'the stack skill', { size: 12.5, cls: 't-board' });
  const parts = [
    'Where things live',
    'Conventions: one sentence for each rule, under the team\'s numbers',
    'Commands: lint, tests, one test file',
    'Review points: the security rules',
    'References: which file to read, and when',
  ];
  let py = sy + 84;
  for (const part of parts) {
    const lines = wrap(part, sw - 56, 12.5);
    b += `<circle cx="${sx + 22}" cy="${py - 4}" r="3" class="m-board"/>` + text(sx + 34, py, lines, { size: 12.5, cls: 't-board' });
    py += lines.length * 16.5 + 12;
  }
  b += text(sx + sw / 2, sy + sh + 24, wrap('.claude/skills/ for Claude Code, .github/skills/ for Copilot: the same skill in both.', sw + 20, 12), { size: 12, anchor: 'middle', cls: 'muted' });
  // Who reads it, on the right.
  const readers = [
    ['agent', 'Business Analyst', 'takes a rule as decided: an approved constraint, never a question for you'],
    ['agent', 'Architect', 'names the skill in the Skills field of every task of the plan'],
    ['agent', 'Developer · QA Engineer', 'read it for each task; the Developer quotes the rule that shaped the code'],
    ['agent', 'Code Reviewer', 'checks the patch against the review points; a finding names the rule'],
    ['check', 'Gate check', 'looks every quoted rule up in the skill file, word for word'],
  ];
  const rx = 760, rw = 328, rhh = 84, rp = 96, ry = 104;
  readers.forEach(([k, t, s], i) => {
    const y = ry + i * rp;
    b += box(rx, y, rw, rhh, k, t, s, { align: 'left', ts: 14.5, ss: 12.5, top: 26 });
    b += arrow([[sx + sw + 4, sy + 60 + i * 48], [rx - 4, y + rhh / 2]], { kind: k === 'check' ? 'check' : 'agent' });
  });
  b += arrow([[340, 160], [sx - 4, sy + 60]], { kind: 'board' });
  b += arrow([[sx - 4, sy + 190], [340, 296]], { kind: 'board', dash: true });
  b += rect(32, 596, 1056, 50, 'plain', { r: 10, dash: true });
  b += text(48, 626, 'A rule written in neither the skill nor the profile reaches nobody. Keep SKILL.md short, since it is read for every task, and put the depth under references/.', { size: 12.5 });
  return svg(W, H, 'Conventions and who reads them', 'The team\'s document, the linter and the project profile on the left; the stack skill in the middle; on the right the Business Analyst, the Architect, the Developer and the QA Engineer, the Code Reviewer and the gate check, each with what it does with a rule.', b);
};

// ------------------------------------------------------------------------------------------------ write
for (const [name, draw] of Object.entries(D)) writeFileSync(join(outDir, `${name}.en.svg`), draw());
console.log(`${Object.keys(D).length} diagrams written to ${outDir}`);
