#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// Local server for the run board. The owner runs it from the repository root:
//   node scripts/board-server.mjs [--port 4319] [--auto-run claude|copilot [--budget <usd>]]
//
// It serves the run board at http://127.0.0.1:<port>/sdlc/board.html, re-rendered (the HTML only, never a
// committed board.md) whenever a file under sdlc/runs/ has changed, and open pages reload when that happens.
// It writes one kind of file: when the owner presses "Send to Orchestrator", it saves the owner's reply
// verbatim as sdlc/runs/<run folder>/decisions/<UTC time>.md. The Orchestrator records decisions from those
// files and never writes there.
//
// With --auto-run, each Send also starts a fresh, non-interactive Orchestrator session (Claude Code's
// `claude -p` or Copilot CLI's `copilot -p`) that may use the tools listed in .orchestra/auto-run.json, and those
// that allow rules in the owner's own settings of the tool add. In such a session every other tool call is denied, so it records the decisions, continues only where no
// approval is needed and stops at the next human gate. One session runs at a time; later sends queue. Its
// output goes to sdlc/.auto-run/ (not served, not committed). Stopping the server stops a running session.
// The session runs with IMPERATA_AUTO_RUN set: scripts/record-run.mjs reads it and commits nothing there.
//
// It listens on 127.0.0.1 only, answers only requests addressed to 127.0.0.1 or localhost, and a send must
// carry the token written into the page at start, so another web page cannot post a decision. It cannot
// tell who pressed the button beyond access to this machine. It serves text files of the repository for the
// board's links, never a path with a segment that starts with a dot (.git, .env, .claude).
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, realpathSync, openSync, closeSync, rmSync } from 'node:fs';
import { join, resolve, relative, extname, sep, basename } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

// What this script prints can hold text from the run files, which agents write: control characters are shown as
// "?" so that none reaches the terminal as a command (clearing a line, writing to the clipboard).
for (const level of ['log', 'error', 'warn']) {
  const out = console[level].bind(console);
  console[level] = (...xs) => out(...xs.map((x) => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '?') : x)));
}

const args = process.argv.slice(2);
let port = 4319;
let autoTool = null;
let budgetArg = null;
const USAGE = 'Usage: node scripts/board-server.mjs [--port 4319] [--auto-run claude|copilot [--budget <usd>]]';
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--port') { port = Number(args[i + 1]); i += 1; }
  else if (args[i] === '--auto-run') { autoTool = args[i + 1]; i += 1; }
  else if (args[i] === '--budget') { budgetArg = Number(args[i + 1]); i += 1; }
  else if (args[i] === '--help' || args[i] === '-h') { console.log(USAGE); process.exit(0); }
  else { console.error(`Unknown argument: ${args[i]}`); console.error(USAGE); process.exit(2); }
}
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('--port needs a number between 1 and 65535'); process.exit(2); }
if (autoTool !== null && autoTool !== 'claude' && autoTool !== 'copilot') { console.error('--auto-run takes claude or copilot'); process.exit(2); }
if (budgetArg !== null && !(budgetArg > 0)) { console.error('--budget needs an amount in US dollars greater than 0'); process.exit(2); }

const root = realpathSync(process.cwd());
const runsDir = join(root, 'sdlc', 'runs');
const renderer = join(root, 'scripts', 'render-run-board.mjs');
if (!existsSync(renderer)) { console.error('scripts/render-run-board.mjs not found. Run this from the repository root.'); process.exit(2); }
const token = randomBytes(24).toString('hex');
const BOARD_PATH = '/sdlc/board.html';

// ---- auto-run --------------------------------------------------------------------------------
let auto = null;
if (autoTool) {
  const cfgPath = join(root, '.orchestra', 'auto-run.json');
  let cfg;
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch (e) { console.error(`--auto-run needs .orchestra/auto-run.json (${e.message.split('\n')[0]})`); process.exit(2); }
  const t = cfg[autoTool];
  const list = autoTool === 'claude' ? t?.allowedTools : t?.allowTool;
  if (!t || !Array.isArray(list) || !list.length || list.some((x) => typeof x !== 'string' || !x)) { console.error(`.orchestra/auto-run.json has no tool list for ${autoTool}`); process.exit(2); }
  const budget = budgetArg ?? (cfg.maxBudgetUsd > 0 ? cfg.maxBudgetUsd : null);
  if (autoTool === 'claude' && !budget) { console.error('--auto-run claude needs a budget: maxBudgetUsd in .orchestra/auto-run.json or --budget'); process.exit(2); }
  auto = { tool: autoTool, cfg: t, list, budget, running: null, queue: [], last: null };
}
const TOOL_NAME = { claude: 'Claude Code', copilot: 'Copilot CLI' };

function autoPrompt(job) {
  return [
    `Owner decisions for run ${job.run} were sent from the run board and saved verbatim as \`${job.path}\`.`,
    '',
    // The board may run on another port than 4319, the default, so the brief names the port it runs on.
    `The run board is served at http://127.0.0.1:${port}${BOARD_PATH}: give the owner that address in your report and decision brief.`,
    '',
    'This session was started automatically by scripts/board-server.mjs (auto-run) when the owner pressed "Send to Orchestrator". Nobody can answer you during it, and every tool call outside the allowed list is denied rather than asked.',
    '',
    `Pick up run ${job.run} from its artifacts in \`sdlc/runs/${job.folder}/\`. Record the decisions as the run-board skill describes under "Live board and decisions sent from it". Then update run.json, render the board, and continue only with steps that need no approval this session lacks. Stop at the next human gate or open decision, and end with your report and the decision brief. Do not commit, push, open a pull request or write outside sdlc/.`,
  ].join('\n');
}

function command(job) {
  const prompt = autoPrompt(job);
  const agent = auto.cfg.agent || 'sdlc-orchestrator';
  const model = auto.cfg.model ? ['--model', auto.cfg.model] : [];
  if (auto.tool === 'claude') {
    // The prompt goes on stdin: --allowedTools takes every argument after it.
    return { cmd: 'claude', args: ['-p', '--agent', agent, '--permission-mode', 'default', '--max-budget-usd', String(auto.budget), '--output-format', 'stream-json', '--verbose', ...model, '--allowedTools', ...auto.list], stdin: prompt };
  }
  // Copilot has no hooks: the owner's decisions/ folders are kept out of `write(sdlc/**)` by a deny rule, which
  // takes precedence over the allowed tools.
  const deny = ['write(sdlc/runs/*/decisions/**)', ...(Array.isArray(auto.cfg.denyTool) ? auto.cfg.denyTool.filter((x) => typeof x === 'string' && x) : [])];
  return { cmd: 'copilot', args: ['-p', prompt, '--agent', agent, '--no-ask-user', '--output-format', 'json', ...model, '--allow-tool', auto.list.join(', '), '--deny-tool', [...new Set(deny)].join(', ')], stdin: null };
}

function alreadyRecorded(job) {
  let clar = join(runsDir, job.folder, 'clarification.md');
  try { const p = JSON.parse(readFileSync(join(runsDir, job.folder, 'run.json'), 'utf8')).artifactPaths?.clarification; if (typeof p === 'string' && p) clar = resolve(root, p); } catch { /* default path */ }
  const cites = (p) => { try { return readFileSync(p, 'utf8').includes(job.name); } catch { return false; } };
  return cites(clar) || cites(join(runsDir, job.folder, 'run.json'));
}

// The end of a session's output: Claude Code's result event, when there is one.
function outcome(logPath) {
  let text = '';
  try { text = readFileSync(logPath, 'utf8'); } catch { return {}; }
  for (const line of text.trim().split('\n').reverse()) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'result') return { report: String(e.result ?? '').slice(0, 1500), costUsd: e.total_cost_usd ?? null, turns: e.num_turns ?? null, subtype: e.subtype ?? null };
  }
  return {};
}

// The run's manifest as it stands: what the last session's report is compared with. Without it the panel goes
// on showing an auto-run session's report after another session has moved the run on: at acceptance, a report
// from the plan approval that says no code has been written yet.
function manifestState(folder) {
  try {
    const m = JSON.parse(readFileSync(join(runsDir, folder, 'run.json'), 'utf8'));
    return { stage: m.currentStage ?? null, revision: m.revision ?? null, updatedAt: m.updatedAt ?? null };
  } catch { return null; }
}

function startNext() {
  if (!auto || auto.running) return;
  while (auto.queue.length) {
    const job = auto.queue.shift();
    if (alreadyRecorded(job)) { console.log(`auto-run: ${job.path} is already recorded; skipped`); continue; }
    launch(job);
    return;
  }
}

function launch(job) {
  const logDir = join(root, 'sdlc', '.auto-run');
  mkdirSync(logDir, { recursive: true });
  const startedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const logPath = join(logDir, `${job.folder}-${startedAt.replace(/:/g, '-')}.log`);
  const fd = openSync(logPath, 'a');
  const spec = command(job);
  const running = { run: job.run, folder: job.folder, file: job.name, tool: auto.tool, startedAt, log: relative(root, logPath).split(sep).join('/') };
  auto.running = running;
  let done = false;
  const finish = (fields) => {
    if (done) return;
    done = true;
    try { closeSync(fd); } catch { /* already closed */ }
    auto.last = { ...running, endedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...fields, ...outcome(logPath), left: manifestState(running.folder) };
    auto.running = null;
    console.log(`auto-run: ${TOOL_NAME[auto.tool]} session for ${job.run} ended (${fields.error || `exit ${fields.exitCode}`}); output in ${running.log}`);
    startNext();
  };
  let child;
  try { child = spawn(spec.cmd, spec.args, { cwd: root, stdio: [spec.stdin ? 'pipe' : 'ignore', fd, fd], env: { ...process.env, IMPERATA_AUTO_RUN: '1' } }); }
  catch (e) { finish({ error: e.message }); return; }
  child.on('error', (e) => finish({ error: e.code === 'ENOENT' ? `${spec.cmd} is not installed or not on PATH` : e.message }));
  child.on('exit', (code, signal) => finish({ exitCode: code, signal }));
  if (spec.stdin) { child.stdin.on('error', () => { /* reported through exit */ }); child.stdin.end(spec.stdin); }
  console.log(`auto-run: started ${TOOL_NAME[auto.tool]} for ${job.run} (${job.path}); output in ${running.log}`);
}

// A report is stale once the run's manifest changed after the session ended: another session took the run on.
function lastSession() {
  const l = auto.last;
  if (!l) return null;
  const now = manifestState(l.folder);
  const stale = Boolean(l.left && now && (now.stage !== l.left.stage || now.revision !== l.left.revision || now.updatedAt !== l.left.updatedAt));
  return { ...l, stale, stageNow: now?.stage ?? null };
}
const autoStatus = () => (auto ? { tool: auto.tool, toolName: TOOL_NAME[auto.tool], budgetUsd: auto.budget, running: auto.running, queued: auto.queue.length, last: lastSession() } : null);

// Changes under sdlc/runs/: number of files and the latest modification time.
function fingerprint() {
  let latest = 0;
  let count = 0;
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else { count += 1; try { latest = Math.max(latest, statSync(p).mtimeMs); } catch { /* removed meanwhile */ } }
    }
  };
  walk(runsDir);
  return `${count}-${Math.floor(latest)}`;
}

// The page is rendered into memory and served from there, never read back from sdlc/board.html: an agent may
// write under sdlc/, and the page served here carries the token that saves the owner's decisions.
let renderedFor = null;
let renderedHtml = null;
function render() {
  const fp = fingerprint();
  if (fp === renderedFor && renderedHtml) return null;
  const r = spawnSync(process.execPath, [renderer, '--stdout'], { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return (r.stderr || String(r.error || 'the renderer failed')).trim();
  renderedFor = fp;
  renderedHtml = r.stdout;
  return null;
}

const hostOk = (h) => h === `127.0.0.1:${port}` || h === `localhost:${port}`;
function reply(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
  res.end(body);
}

function servePage(res) {
  const err = render();
  if (err) return reply(res, 500, `The board could not be rendered:\n\n${err}`);
  // The state holds text an agent wrote (a session's report): escape `<` so that it cannot close the script.
  const state = JSON.stringify({ token, version: fingerprint(), auto: autoStatus() }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const html = renderedHtml.replace('</head>', () => `<script>window.__BOARD_SERVER__=${state};</script>\n</head>`);
  return reply(res, 200, html, 'text/html; charset=utf-8', {
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
}

// ---- Markdown pages: run artifacts are read as HTML, not as raw text ------------------------------------
const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function mdInline(src) {
  const codes = [];
  let t = escHtml(src).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => (/^(javascript|data|vbscript):/i.test(url) ? label : `<a href="${url}">${label}</a>`));
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  t = t.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}
const ALERTS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };
function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${mdInline(para.join(' '))}</p>`); para.length = 0; } };
  const isFence = (l) => /^\s*(```|~~~)/.test(l);
  const fenceBlock = (start) => {
    const open = lines[start].match(/^\s*(```+|~~~+)\s*([\w-]*)/);
    const body = [];
    let j = start + 1;
    const indent = lines[start].match(/^\s*/)[0].length;
    while (j < lines.length && !lines[j].trim().startsWith(open[1])) { body.push(lines[j].slice(Math.min(indent, lines[j].match(/^\s*/)[0].length))); j += 1; }
    const lang = open[2];
    const caption = lang === 'mermaid' ? 'Mermaid diagram (GitHub draws it; the run board shows the same status)' : lang;
    return { html: `<figure class="code">${caption ? `<figcaption>${escHtml(caption)}</figcaption>` : ''}<pre><code>${escHtml(body.join('\n'))}</code></pre></figure>`, next: j + 1 };
  };
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
  const itemRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isFence(line)) { flush(); const b = fenceBlock(i); out.push(b.html); i = b.next; continue; }
    if (!line.trim()) { flush(); i += 1; continue; }
    if (/^\s*<!--/.test(line)) { flush(); while (i < lines.length && !lines[i].includes('-->')) i += 1; i += 1; continue; }
    const det = line.trim().match(/^<details>(?:<summary>(.*)<\/summary>)?$/i);
    if (det) { flush(); out.push(`<details><summary>${mdInline(det[1] || 'Details')}</summary>`); i += 1; continue; }
    if (/^<\/details>$/i.test(line.trim())) { flush(); out.push('</details>'); i += 1; continue; }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { flush(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); i += 1; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i += 1; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      out.push(`<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { quoted.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      const alert = quoted[0]?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/);
      if (alert) out.push(`<div class="alert ${alert[1].toLowerCase()}"><b>${ALERTS[alert[1]]}</b>${renderMarkdown(quoted.slice(1).join('\n'))}</div>`);
      else out.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }
    if (itemRe.test(line)) {
      flush();
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const m = l.match(itemRe);
        if (m) { items.push({ indent: m[1].replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]), text: m[3], blocks: [] }); i += 1; continue; }
        if (items.length && isFence(l) && /^\s{2,}/.test(l)) { const b = fenceBlock(i); items[items.length - 1].blocks.push(b.html); i = b.next; continue; }
        if (items.length && l.trim() && /^\s{2,}/.test(l)) { items[items.length - 1].text += ` ${l.trim()}`; i += 1; continue; }
        if (!l.trim() && i + 1 < lines.length && (itemRe.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) { i += 1; continue; }
        break;
      }
      let html = '';
      const stack = [];
      for (const it of items) {
        while (stack.length && it.indent < stack[stack.length - 1].indent) html += `</li></${stack.pop().tag}>`;
        if (!stack.length || it.indent > stack[stack.length - 1].indent) { const tag = it.ordered ? 'ol' : 'ul'; stack.push({ indent: it.indent, tag }); html += `<${tag}><li>`; }
        else html += '</li><li>';
        html += mdInline(it.text) + it.blocks.join('');
      }
      while (stack.length) html += `</li></${stack.pop().tag}>`;
      out.push(html);
      continue;
    }
    para.push(line.trim());
    i += 1;
  }
  flush();
  return out.join('\n');
}
// The Imperata app tile, as in scripts/render-run-board.mjs: the tab icon of the document pages.
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="44" fill="#181818"/><g transform="translate(34 34) scale(.734375)"><g fill="none" stroke="#F2F0E9" stroke-width="13"><path d="M119 26 42 72v40"/><path d="M42 133v49l77 45"/><path d="m137 26 77 46v40"/><path d="M214 133v49l-77 45"/></g><path fill="#F2F0E9" d="M100 76h56l-6 12h-11v82h11l6 12h-56l6-12h11V88h-11z"/><path fill="#E84C3D" d="m118 217 10 25 10-25z"/></g></svg>');
// The same sheet as the run board (scripts/render-run-board.mjs): blueprint grid, hairlines, monospace labels.
const DOC_CSS = `:root{color-scheme:light dark;--bg:#f1f4f9;--grid:rgba(38,88,190,.055);--grid-2:rgba(38,88,190,.105);--panel:#fff;--ink:#0f1a2b;--muted:#5b6a80;--line:#dbe2ed;--line-2:#b6c2d6;--code:#eef2f8;--blue:#1a48b3;--blue-bg:#e6eeff;--amber:#dfa010;--amber-bg:#fff4d6;--red:#d03b3b;--red-bg:#fbe7e7;--green:#0ca30c;--green-bg:#e4f4e6;
--mono:ui-monospace,"SF Mono",SFMono-Regular,"JetBrains Mono","Cascadia Mono",Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0a111e;--grid:rgba(126,166,255,.05);--grid-2:rgba(126,166,255,.095);--panel:#101a2c;--ink:#e7edf8;--muted:#8d9db8;--line:#1f2d46;--line-2:#31456a;--code:#16233b;--blue:#a6c1ff;--blue-bg:#14254a;--amber:#b98510;--amber-bg:#2e2610;--red-bg:#361b20;--green-bg:#0f2a1c}}
*{box-sizing:border-box}body{margin:0;color:var(--ink);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background-color:var(--bg);
background-image:linear-gradient(var(--grid-2) 1px,transparent 1px),linear-gradient(90deg,var(--grid-2) 1px,transparent 1px),linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);
background-size:120px 120px,120px 120px,24px 24px,24px 24px;background-position:-1px -1px}
.doc{max-width:980px;margin:0 auto;padding:20px 16px 80px}a{color:var(--blue)}
nav{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;margin-bottom:14px;font:600 11px/1.5 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
nav span{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:500;font-size:12px;letter-spacing:0;text-transform:none}nav a{text-decoration:none}nav a:hover{text-decoration:underline}
article{background:var(--panel);border:1px solid var(--line-2);border-radius:4px;padding:8px 28px 24px;overflow-wrap:break-word}
h1{font-size:26px;line-height:1.25;letter-spacing:-.015em}h2{font-size:19px;margin-top:30px;border-bottom:1px solid var(--line);padding-bottom:5px}h3{font-size:16px;margin-top:22px}
code{font:12.5px var(--mono);background:var(--code);padding:1px 5px;border-radius:2px}
figure.code{margin:12px 0}figure.code figcaption{font:500 10.5px/1.8 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}pre{background:var(--code);border:1px solid var(--line);padding:12px;border-radius:3px;overflow:auto}pre code{background:none;padding:0}
.tbl{overflow-x:auto;margin:12px 0}table{border-collapse:collapse;font-size:14px;min-width:100%}th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top;min-width:9rem;overflow-wrap:normal}th:first-child,td:first-child{min-width:0;white-space:nowrap}
th{background:var(--code);font:600 10.5px/1.7 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
blockquote{margin:12px 0;padding:4px 14px;border-left:2px solid var(--line-2);color:var(--muted)}
.alert{margin:12px 0;padding:8px 14px;border-radius:3px;border-left:3px solid var(--blue);background:var(--blue-bg)}.alert>b{display:block;font:700 10.5px/1.9 var(--mono);letter-spacing:.1em;text-transform:uppercase}
.alert.important,.alert.warning{border-color:var(--amber);background:var(--amber-bg)}.alert.caution{border-color:var(--red);background:var(--red-bg)}.alert.tip{border-color:var(--green);background:var(--green-bg)}
details{margin:12px 0}summary{cursor:pointer;color:var(--muted)}li{margin:3px 0}hr{border:0;border-top:1px solid var(--line);margin:22px 0}
@media (max-width:700px){article{padding:4px 16px 18px}}`;
function serveMarkdownPage(rel, text, res) {
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(basename(rel))} — run board</title><link rel="icon" href="${FAVICON}"><style>${DOC_CSS}</style></head><body><div class="doc"><nav><a href="${BOARD_PATH}">← Run board</a><span>${escHtml(rel)}</span><a href="?raw=1">Raw</a></nav><article>${renderMarkdown(text)}</article></div></body></html>`;
  return reply(res, 200, page, 'text/html; charset=utf-8', { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
}

const TEXT = { '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.diff': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8' };
// Only files under sdlc/, which is all the board links to: the server answers any process of any user of the
// machine that reaches 127.0.0.1, with no token for a GET.
function serveFile(pathname, res, raw = false) {
  let rel;
  try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return reply(res, 400, 'Bad path'); }
  if (!rel || rel.split('/').some((seg) => seg.startsWith('.') || seg === '')) return reply(res, 404, 'Not found');
  const served = join(root, 'sdlc') + sep;
  const abs = resolve(root, rel);
  if (!abs.startsWith(served) || !TEXT[extname(abs)] || !existsSync(abs)) return reply(res, 404, 'Not found');
  let real;
  try { real = realpathSync(abs); } catch { return reply(res, 404, 'Not found'); }
  if (!real.startsWith(served) || !statSync(real).isFile()) return reply(res, 404, 'Not found');
  if (extname(abs) === '.md' && !raw) return serveMarkdownPage(rel, readFileSync(real, 'utf8'), res);
  return reply(res, 200, readFileSync(real), TEXT[extname(abs)]);
}

function receive(req, res) {
  const origin = req.headers.origin;
  if (origin && !hostOk(origin.replace(/^https?:\/\//, ''))) return reply(res, 403, 'Refused: the request comes from another site.');
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > 64 * 1024) { reply(res, 413, 'Refused: the reply is larger than 64 KB.'); req.destroy(); }
    else chunks.push(c);
  });
  const onEnd = () => {
    if (res.writableEnded) return;
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 400, 'Refused: the body is not JSON.'); }
    // Only strings are read: an object with a broken toString would throw here and stop the server.
    const field = (name) => (data && typeof data === 'object' && typeof data[name] === 'string' ? data[name] : '');
    const given = Buffer.from(field('token'));
    const expected = Buffer.from(token);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return reply(res, 403, 'Refused: the token does not match. Reload the board from this server and send again.');
    const folder = field('run');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(folder) || !existsSync(join(runsDir, folder, 'run.json'))) return reply(res, 400, 'Refused: no such run under sdlc/runs/.');
    const text = field('text').replace(/\r\n?/g, '\n').trim();
    if (!text) return reply(res, 400, 'Refused: the reply is empty.');

    // The run folder and its decisions/ must be real folders of this repository, not links to somewhere else.
    const inside = (p) => { try { const real = realpathSync(p); return real.startsWith(realpathSync(runsDir) + sep); } catch { return true; } };
    if (!inside(join(runsDir, folder)) || !inside(join(runsDir, folder, 'decisions'))) return reply(res, 400, 'Refused: the run folder leads outside sdlc/runs/.');
    const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const dir = join(runsDir, folder, 'decisions');
    mkdirSync(dir, { recursive: true });
    const stem = at.replace(/:/g, '-');
    let file = join(dir, `${stem}.md`);
    for (let n = 2; existsSync(file); n += 1) file = join(dir, `${stem}-${n}.md`);
    const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    const body = [
      `# Owner decisions — ${folder}`,
      '',
      'Saved by `scripts/board-server.mjs` when "Send to Orchestrator" was pressed on the run board.',
      '',
      `- Sent at: ${at} (this machine's clock)`,
      `- Run folder: sdlc/runs/${folder}/`,
      '- Who pressed the button: not known beyond access to this machine and to the board page',
      '',
      'The reply below is the owner\'s message, verbatim. The Orchestrator records each decision in `clarification.md` with this file as its evidence. Nobody edits this file.',
      '',
      `${fence}text`,
      text,
      fence,
      '',
    ].join('\n');
    writeFileSync(file, body, { flag: 'wx' });
    const rel = relative(root, file).split(sep).join('/');
    console.log(`${at}  decisions for ${folder} saved to ${rel}`);
    let autoState = 'off';
    if (auto) {
      let run = folder;
      try { const id = JSON.parse(readFileSync(join(runsDir, folder, 'run.json'), 'utf8')).runId; if (typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) run = id; } catch { /* folder name */ }
      auto.queue.push({ run, folder, path: rel, name: basename(file) });
      startNext();
      autoState = auto.running?.file === basename(file) ? 'started' : 'queued';
    }
    return reply(res, 200, JSON.stringify({ ok: true, path: rel, at, auto: autoState }), 'application/json; charset=utf-8');
  };
  // A request that throws is refused; it never stops the server.
  req.on('end', () => {
    try { onEnd(); } catch (e) { if (!res.writableEnded) reply(res, 500, `Refused: the reply could not be saved (${e.message}).`); }
  });
  return undefined;
}

function route(req, res) {
  if (!hostOk(req.headers.host)) return reply(res, 421, 'This server answers only http://127.0.0.1 and http://localhost.');
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/sdlc/' || url.pathname === '/sdlc')) return reply(res, 302, '', 'text/plain', { location: BOARD_PATH });
  if (req.method === 'GET' && url.pathname === BOARD_PATH) return servePage(res);
  if (req.method === 'GET' && url.pathname === '/version') return reply(res, 200, JSON.stringify({ version: fingerprint(), auto: autoStatus() }), 'application/json; charset=utf-8');
  if (req.method === 'POST' && url.pathname === '/decisions') return receive(req, res);
  if (req.method === 'GET') return serveFile(url.pathname, res, url.searchParams.has('raw'));
  return reply(res, 405, 'Method not allowed');
}
const server = http.createServer((req, res) => {
  try { return route(req, res); } catch (e) { if (!res.writableEnded) reply(res, 500, `Error: ${e.message}`); return undefined; }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${port} is in use. Start with --port <another number>.`);
  else console.error(e.message);
  process.exit(1);
});
// The address the board is served at, for the Orchestrator's briefs: an interactive session does not know the
// port, and a brief that names 4319, the default, sends the owner to the wrong address when the server runs on
// another. Written when the server starts listening, removed when it stops.
const addressFile = join(root, 'sdlc', '.board-server.json');
function removeAddress() {
  try { if (JSON.parse(readFileSync(addressFile, 'utf8')).pid === process.pid) rmSync(addressFile); } catch { /* not there, or another server's */ }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { removeAddress(); process.exit(0); });
process.on('exit', removeAddress);

server.listen(port, '127.0.0.1', () => {
  try {
    mkdirSync(join(root, 'sdlc'), { recursive: true });
    writeFileSync(addressFile, `${JSON.stringify({ url: `http://127.0.0.1:${port}${BOARD_PATH}`, port, pid: process.pid, startedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') }, null, 2)}\n`);
  } catch (e) { console.error(`Could not write sdlc/.board-server.json (${e.message}); give the Orchestrator the address yourself.`); }
  const err = render();
  if (err) console.error(`The board could not be rendered yet:\n${err}`);
  console.log(`Run board: http://127.0.0.1:${port}${BOARD_PATH}`);
  console.log('Decisions you send are saved under sdlc/runs/<run>/decisions/. Stop with Ctrl+C.');
  if (auto) console.log(`Auto-run is ON: each Send starts ${TOOL_NAME[auto.tool]} non-interactively with the tools in .orchestra/auto-run.json${auto.budget ? ` and a budget of $${auto.budget} per session` : ' (no budget cap: Copilot CLI has none)'}. Output goes to sdlc/.auto-run/.`);
});
