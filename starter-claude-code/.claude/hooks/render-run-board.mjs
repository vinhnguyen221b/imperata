#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of Imperata: https://github.com/vinhnguyen221b/imperata
// PostToolUse hook (wired in .claude/settings.json for Edit and Write).
// After a file under sdlc/runs/<runId>/ is written with the file tools, render that run's board
// (sdlc/runs/<runId>/board.md) and sdlc/board.html, so that the board the owner reads is never older
// than the artifacts behind it.
//
// It never undoes or blocks anything: the edit has already happened. If the board cannot be rendered,
// exit 2 tells the session so; the edit stands and the board is stale until it is rendered again.
// Limit: a file written by a shell command does not trigger this hook; the Orchestrator renders after those.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch { process.exit(0); }

const target = input?.tool_input?.file_path;
if (!target) process.exit(0);

const root = resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
const abs = isAbsolute(target) ? resolve(target) : resolve(input.cwd || root, target);
const rel = relative(root, abs).split(sep).join('/');
const m = rel.match(/^sdlc\/runs\/([^/]+)\/(.+)$/);
if (!m || m[2] === 'board.md') process.exit(0);
if (!existsSync(resolve(root, 'sdlc/runs', m[1], 'run.json'))) process.exit(0);

const renderer = resolve(root, 'scripts/render-run-board.mjs');
if (!existsSync(renderer)) process.exit(0); // the board is not installed in this repository

const run = spawnSync(process.execPath, [renderer, '--run', m[1], '--quiet'], { cwd: root, encoding: 'utf8', timeout: 30000 });
if (run.status === 0) process.exit(0);

console.error(`The run board for ${m[1]} could not be rendered after ${rel} was written (exit ${run.status ?? 'unknown'}):`);
console.error((run.stderr || run.stdout || String(run.error || '')).trim());
console.error('The edit stands and is not affected. The board is out of date: run "node scripts/render-run-board.mjs" yourself, and report the error if it persists. Do not edit board.md by hand.');
process.exit(2);
