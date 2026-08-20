import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveGitRoot, readJsonIfExists, fail } from '../../utils/core.js';
import { addMemoryEntry, verifyMemory, supersedeMemory, listMemory } from '../../memory/index.js';
import { hasFlag, outputFormat } from '../shared.js';

export function parseRelates(args, startIndex) {
  const relates = [];
  for (let i = startIndex; i < args.length; i += 1) {
    relates.push(args[i].replace(/\\/g, '/'));
  }
  return relates;
}

export function memoryCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  const lockPath = path.join(root, '.contextlock', 'lock.json');
  if (!existsSync(configPath) || !existsSync(lockPath)) {
    return fail('ContextLock is not initialized; run `ctx init` first');
  }

  const config = readJsonIfExists(configPath);
  const lock = readJsonIfExists(lockPath);
  const [subcommand, ...rest] = args;

  if (!subcommand || subcommand === 'list') {
    const staleOnly = hasFlag(args, '--stale');
    const jsonOut = outputFormat(args) === 'json';
    const entries = listMemory(root, { staleOnly });
    if (jsonOut) {
      console.log(JSON.stringify({ entries, count: entries.length }, null, 2));
    } else if (!entries.length) {
      console.log(staleOnly ? 'No stale memory entries.' : 'No memory entries yet.');
    } else {
      for (const entry of entries) {
        const flags = [entry.stale ? 'stale' : 'fresh', entry.superseded_by ? `superseded_by:${entry.superseded_by}` : null]
          .filter(Boolean)
          .join(' ');
        console.log(`${entry.id} [${entry.type}] (${flags})`);
        console.log(`  anchor: ${entry.anchor_hash}`);
        console.log(`  relates: ${(entry.related_files || []).join(', ') || 'none'}`);
        console.log(`  ${entry.content.split('\n')[0].slice(0, 100)}`);
      }
    }
    return 0;
  }

  if (subcommand === 'add') {
    let type = null;
    let content = null;
    const relates = [];
    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i];
      if (token === '--type' && rest[i + 1]) {
        type = rest[i + 1];
        i += 1;
      } else if (token === '--relates' && rest[i + 1]) {
        relates.push(rest[i + 1]);
        i += 1;
      } else if (!token.startsWith('-') && content === null) {
        content = token;
      } else if (!token.startsWith('-') && content !== null) {
        content = `${content} ${token}`;
      }
    }

    const res = addMemoryEntry(root, { type, content, relatedFiles: relates, config, lock });
    if (!res.ok) return fail(res.error.message, res.error);
    const verb = res.alreadyExisted ? 'Memory entry already exists' : 'Created memory entry';
    console.log(`${verb} ${res.entry.id}`);
    console.log(`Type: ${res.entry.type}`);
    console.log(`Anchor: ${res.entry.anchor_hash}`);
    console.log(`Related: ${(res.entry.related_files || []).join(', ') || 'none'}`);
    if (res.suppressedRedaction) console.log('Note: secrets in content were redacted before write.');
    return 0;
  }

  if (subcommand === 'verify') {
    const jsonOut = outputFormat(args) === 'json';
    const res = verifyMemory(root, config, lock);
    if (jsonOut) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`Verified ${res.entry_count} memory entries (min severity ${res.stale_min_severity}).`);
      console.log(`Stale: ${res.stale_count}`);
      for (const result of res.results) {
        console.log(`- ${result.id}: ${result.stale ? `stale (${result.reason})` : 'fresh'}`);
      }
    }
    return 0;
  }

  if (subcommand === 'supersede') {
    const [id, newId] = rest;
    if (!id || !newId) {
      return fail('supersede requires <id> and <new-id>', {
        reason: 'Both the original and replacement entry ids must be provided.',
        recovery: 'Run `ctx memory list` to find ids.',
        command: 'ctx memory supersede <id> <new-id>',
        code: 2
      });
    }
    const res = supersedeMemory(root, id, newId);
    if (!res.ok) return fail(res.error.message, res.error);
    console.log(`Linked ${id} -> superseded_by ${newId}`);
    return 0;
  }

  return fail(`memory subcommand "${subcommand}" is not implemented yet`, {
    reason: 'The memory command supports add, list, verify, and supersede.',
    recovery: 'Use one of the implemented memory subcommands.',
    command: 'ctx memory list',
    code: 2
  });
}
