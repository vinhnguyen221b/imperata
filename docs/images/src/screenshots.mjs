#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Photographs the run board for the guides.
//   node docs/images/src/screenshots.mjs [outDir] [--only <name-part>] [--quality <1-100>]
//                                                   (default outDir: docs/images/, default quality: 90)
//
// Screenshots are WebP: about half the size of PNG at a quality where the text stays sharp.
// It makes a scratch git repository in the system temp folder, installs the kit there with
// imperata-kit.mjs, writes the synthetic runs of sample-runs.mjs, renders the board, starts
// scripts/board-server.mjs and drives a headless Chrome through the DevTools protocol (Node 22 or later,
// for the built-in WebSocket). Nothing is downloaded. Chrome is found at CHROME, else at the usual macOS and
// Linux locations. The scratch repository is removed at the end.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const blueprint = resolve(here, '..', '..', '..');
const args = process.argv.slice(2);
let outDir = join(here, '..');
let only = null;
let quality = 90;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--only') { only = args[i + 1]; i += 1; }
  else if (args[i] === '--quality') { quality = Number(args[i + 1]); i += 1; }
  else outDir = resolve(args[i]);
}
if (!Number.isInteger(quality) || quality < 1 || quality > 100) { console.error('--quality takes a whole number from 1 to 100'); process.exit(2); }
mkdirSync(outDir, { recursive: true });
if (typeof WebSocket === 'undefined') { console.error('Needs Node 22 or later (global WebSocket).'); process.exit(2); }
const chromePath = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && existsSync(p));
if (!chromePath) { console.error('Chrome not found; set CHROME to its executable.'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, argv, cwd) => { const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed:\n${r.stdout}${r.stderr}`); return r.stdout; };
const work = mkdtempSync(join(tmpdir(), 'imperata-shots-'));
const children = [];
const stop = () => { for (const c of children) c.kill(); rmSync(work, { recursive: true, force: true }); };
process.on('exit', stop);

// ---- sample repositories and their board servers
const servers = {};
for (const [lang, port] of [['en', 4411]]) {
  const repo = join(work, lang, 'teamleave');
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# TeamLeave\n\nA fictional leave-request app used to illustrate the Imperata kit.\n');
  writeFileSync(join(repo, 'docs', 'requirements.md'), '# Requirements (synthetic)\n\n- BR-01: An employee sees their own leave balance.\n- BR-02: An employee submits a leave request; their manager approves or rejects it.\n');
  run('git', ['init', '-q'], repo);
  run(process.execPath, [join(blueprint, 'imperata-kit.mjs'), 'install', '.', '--tools', 'claude,copilot'], repo);
  run(process.execPath, [join(here, 'sample-runs.mjs'), repo], repo);
  run(process.execPath, ['scripts/render-run-board.mjs'], repo);
  const srv = spawn(process.execPath, ['scripts/board-server.mjs', '--port', String(port)], { cwd: repo, stdio: 'ignore' });
  children.push(srv);
  servers[lang] = `http://127.0.0.1:${port}`;
}
for (const base of Object.values(servers)) {
  let ok = false;
  for (let i = 0; i < 50 && !ok; i += 1) { try { ok = (await fetch(`${base}/sdlc/board.html`)).ok; } catch { await sleep(100); } }
  if (!ok) throw new Error(`board server at ${base} did not start`);
}

// ---- Chrome
const PORT = 9333;
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(work, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', '--lang=en-US', 'about:blank'], { stdio: 'ignore' });
children.push(chrome);
let version;
for (let i = 0; i < 50 && !version; i += 1) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(200); } }
if (!version) throw new Error('Chrome did not start');

async function page() {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } else if (m.method) for (const w of waiters.filter((x) => x.method === m.method)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m.params); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { id += 1; pending.set(id, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id, method, params })); });
  const once = (method) => new Promise((res) => waiters.push({ method, resolve: res }));
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`);
    return r.result.value;
  };
  return { send, once, evaluate, close: () => ws.close() };
}

// ---- the shots: a URL, a viewport, steps run in the page, then the viewport or one element is captured
const B = '/sdlc/board.html';
const clickOpt = (q, n) => `{ const o = document.querySelector('article.qc[data-q="${q}"] label.opt:nth-of-type(${n}) input'); o.click(); await new Promise(r => setTimeout(r, 450)); }`;
const scrollTo = (sel, off = 16) => `{ const el = document.querySelector('${sel}'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - ${off}); await new Promise(r => setTimeout(r, 250)); }`;
const shots = [];
for (const [lang, base] of Object.entries(servers)) {
  shots.push(
    { name: `board-overview.${lang}`, url: `${base}${B}#/`, w: 1280, h: 820 },
    { name: `board-overview-dark.${lang}`, url: `${base}${B}#/`, w: 1280, h: 820, dark: true },
    { name: `board-run-acceptance.${lang}`, url: `${base}${B}#/run/R1-leave-balance`, w: 1280, h: 1000 },
    { name: `board-questions.${lang}`, url: `${base}${B}#/run/R2-leave-request/decisions`, w: 1280, h: 900, steps: `${clickOpt('Q-02', 1)} ${scrollTo('.card .meter', 140)}` },
    { name: `board-approval-card.${lang}`, url: `${base}${B}#/run/R2-leave-request/decisions`, w: 1280, h: 900, clip: 'section.gate-card', pad: 16 },
    { name: `board-tasks.${lang}`, url: `${base}${B}#/run/R1-leave-balance/tasks`, w: 1600, h: 900, steps: scrollTo('.tabs, [role=tablist]', 12) },
    { name: `board-traceability.${lang}`, url: `${base}${B}#/run/R1-leave-balance/trace`, w: 1280, h: 900, steps: `${scrollTo('.tabs, [role=tablist]', 12)} { document.querySelectorAll('tr.ac-row')[1].click(); await new Promise(r => setTimeout(r, 300)); }` },
    { name: `board-reply-preview.${lang}`, url: `${base}${B}#/run/R2-leave-request/decisions`, w: 1280, h: 860,
      steps: `${clickOpt('Q-02', 1)} ${clickOpt('Q-03', 1)} ${clickOpt('Q-04', 1)} const b = [...document.querySelectorAll('button')].find(x => /^Preview$/.test(x.textContent.trim())); b.click(); await new Promise(r => setTimeout(r, 400));` },
    { name: `board-phone.${lang}`, url: `${base}${B}#/run/R2-leave-request/decisions`, w: 390, h: 844, dpr: 3, mobile: true, steps: scrollTo('.card .meter', 120) },
    { name: `board-markdown-page.${lang}`, url: `${base}/sdlc/runs/R2-leave-request/feature-spec.md`, w: 1280, h: 820 },
  );
}

for (const s of shots) {
  if (only && !s.name.includes(only)) continue;
  const p = await page();
  await p.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: s.dpr || 2, mobile: Boolean(s.mobile) });
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: s.dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  let loaded = p.once('Page.loadEventFired');
  await p.send('Page.navigate', { url: s.url });
  await loaded;
  if (s.url.includes('board.html')) {
    // Answers chosen in an earlier shot live in the page's storage; start every shot from none.
    loaded = p.once('Page.loadEventFired');
    await p.evaluate('localStorage.clear(); sessionStorage.clear(); setTimeout(() => location.reload(), 10);');
    await loaded;
  }
  await sleep(700);
  await p.evaluate('const st = document.createElement("style"); st.textContent = "button.updated,.toast{display:none!important}"; document.head.appendChild(st);');
  if (s.steps) await p.evaluate(s.steps);
  await sleep(300);
  let clip;
  if (s.clip) {
    const pad = s.pad || 0;
    // The board's header is sticky: the element is scrolled to just below it, or the header covers its top.
    const r = await p.evaluate(`const el = document.querySelector('${s.clip}'); const bar = document.querySelector('.top'); const off = (bar ? bar.getBoundingClientRect().height : 0) + ${pad}; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off); await new Promise(r => setTimeout(r, 200)); const b = el.getBoundingClientRect(); return { x: b.left + window.scrollX, y: b.top + window.scrollY, width: b.width, height: b.height };`);
    clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + 2 * pad, height: r.height + 2 * pad, scale: 1 };
  }
  const shot = await p.send('Page.captureScreenshot', { format: 'webp', quality, ...(clip ? { clip, captureBeyondViewport: true } : {}) });
  writeFileSync(join(outDir, `${s.name}.webp`), Buffer.from(shot.data, 'base64'));
  console.log(`${s.name}.webp`);
  p.close();
}
process.exit(0);
