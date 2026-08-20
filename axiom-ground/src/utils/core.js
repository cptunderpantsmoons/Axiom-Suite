import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim();
}

function printError(message, options = {}) {
  const reason = options.reason || message;
  const recovery = options.recovery || 'Run this command inside an initialized Git repository, or initialize Git first with `git init` and `ctx init`.';
  const command = options.command || null;

  console.error(`ContextLock error: ${message}`);
  console.error(`Reason: ${reason}`);
  console.error(`Recovery: ${recovery}`);
  if (command) console.error(`Command: ${command}`);
}

function fail(message, options = {}) {
  const code = Number.isInteger(options.code) ? options.code : 1;
  printError(message, options);
  return code;
}

function resolveGitRoot(cwd) {
  const root = runGit(['rev-parse', '--show-toplevel'], cwd);
  return root || null;
}

function readJsonIfExists(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function normalizePosix(value) {
  return value.split(/[\\/]+/).join('/');
}

function sha256(text) {
  return crypto.hash('sha256', text, 'hex');
}

function fastCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export {
  ensureDir,
  escapeHtml,
  fail,
  fastCompare,
  normalizePosix,
  printError,
  readJsonIfExists,
  resolveGitRoot,
  runGit,
  sha256,
  writeJson
};
