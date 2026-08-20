import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveGitRoot, readJsonIfExists, ensureDir, fail } from '../../utils/core.js';
import { buildSiteArtifacts, updateLockAfterSite, copyDirRecursive } from '../../site/index.js';
import { buildRagBundle } from '../../export/rag.js';
import { hasFlag } from '../shared.js';

export function siteCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  if (!existsSync(configPath) || !existsSync(lockPath)) {
    return fail('ContextLock is not initialized; run `ctx init` first');
  }

  const quiet = hasFlag(args, '--quiet');
  const [subcommand, target] = args;
  const lock = readJsonIfExists(lockPath);

  if (!subcommand || subcommand === 'build') {
    const siteData = buildSiteArtifacts(root, lock);
    updateLockAfterSite(root, lock, siteData);
    if (!quiet) {
      console.log(`Built ContextLock site ${siteData.siteHash}`);
      console.log(`Pages: ${siteData.siteDirJson.pages.join(', ')}`);
    }
    return 0;
  }

  if (subcommand === 'export') {
    const rag = hasFlag(args, '--rag');
    const ragPos = args.indexOf('--rag');
    const destArg = rag ? args[ragPos + 1] : target;
    if (!destArg || destArg.startsWith('-')) {
      return fail(rag ? 'rag export requires a destination directory' : 'site export requires a destination directory', {
        reason: 'The export command needs a target path to write artifacts.',
        recovery: rag
          ? 'Run ctx snapshot first, then export the RAG bundle to a directory.'
          : 'Run site build first, then export to a destination directory.',
        command: rag ? 'ctx snapshot && ctx site export --rag <dir>' : 'ctx site build && ctx site export <dir>',
        code: 2
      });
    }
    if (rag) {
      const dest = path.resolve(root, destArg);
      ensureDir(dest);
      const res = buildRagBundle(root, lock, dest, { includeCode: hasFlag(args, '--code') });
      if (!res.ok) return fail(res.error.message, res.error);
      if (!quiet) {
        console.log(`Exported RAG bundle to ${dest} (${res.docCount} docs, determinism ${res.bundle_determinism_hash.slice(0, 12)})`);
      }
      return 0;
    }
    const sourceDir = path.join(root, '.contextlock', 'site');
    if (!existsSync(sourceDir)) {
      const siteData = buildSiteArtifacts(root, lock);
      updateLockAfterSite(root, lock, siteData);
    }
    const destination = path.resolve(root, destArg);
    copyDirRecursive(sourceDir, destination);
    if (!quiet) console.log(`Exported site to ${destination}`);
    return 0;
  }

  if (subcommand === 'open') {
    const sitePath = path.join(root, '.contextlock', 'site', 'index.html');
    if (!existsSync(sitePath)) {
      const siteData = buildSiteArtifacts(root, lock);
      updateLockAfterSite(root, lock, siteData);
    }
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawnSync(opener, [sitePath], { stdio: 'ignore', shell: process.platform === 'win32' });
    if (!quiet) console.log(`Opened ${sitePath}`);
    return 0;
  }

  return fail(`site subcommand "${subcommand}" is not implemented yet`, {
    reason: 'The static site command supports build, open, and export only.',
    recovery: 'Use one of the implemented site subcommands.',
    command: 'ctx site build',
    code: 2
  });
}
