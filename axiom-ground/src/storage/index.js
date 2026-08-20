import { existsSync } from 'node:fs';
import path from 'node:path';
import { readJsonIfExists, resolveGitRoot, fail } from '../utils/core.js';
import { writeConfigJson } from '../init/index.js';
import { runSecretScan, enqueueRetry, clearRetryQueue, getRetryQueue } from './secrets.js';
import { createBackend } from './backends.js';
import { gatherArtifacts, syncArtifacts, pullArtifacts } from './sync.js';

// ---------------------------------------------------------------------------
// Re-exports for backward compatibility
// ---------------------------------------------------------------------------

export { runSecretScan, enqueueRetry } from './secrets.js';
export { createBackend } from './backends.js';
export { gatherArtifacts, syncArtifacts, pullArtifacts } from './sync.js';

// ---------------------------------------------------------------------------
// CLI: ctx remote add
// ---------------------------------------------------------------------------

export async function remoteAddCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  if (!existsSync(configPath)) return fail('ContextLock is not initialized; run `ctx init` first');

  const [provider, repo] = args;
  if (!provider || !repo) {
    return fail('remote add requires a provider and repository', {
      reason: 'Both backend provider and repository id are required.',
      recovery: 'Provide the Hugging Face shorthand provider and target repository.',
      command: 'ctx remote add hf username/project-context-cache',
      code: 2
    });
  }

  const config = readJsonIfExists(configPath);
  config.remote = {
    ...(config.remote || {}),
    provider: provider === 'hf' ? 'huggingface' : provider,
    repo,
    repo_type: 'dataset',
    token_env: 'HF_TOKEN'
  };
  writeConfigJson(root, config);

  console.log(`Remote configured: ${config.remote.provider}://${config.remote.repo}`);
  return 0;
}

// ---------------------------------------------------------------------------
// CLI: ctx sync
// ---------------------------------------------------------------------------

export async function syncCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  if (!existsSync(configPath)) return fail('ContextLock is not initialized; run `ctx init` first');

  const quiet = args.includes('--quiet');
  const dryRun = args.includes('--dry-run');

  const scanResult = runSecretScan(root);
  if (!scanResult.passed) {
    const evidence = scanResult.findings.map((finding) => `${finding.file}: ${finding.pattern}`).join('; ');
    return fail('Secret scan failed — refusing to sync', {
      reason: evidence || 'Secret-like content was found in ContextLock artifacts.',
      recovery: 'Remove secrets from artifacts, regenerate snapshots, and retry sync.',
      command: 'ctx snapshot && ctx sync',
      code: 2
    });
  }

  const config = readJsonIfExists(configPath);
  const remoteConfig = config?.remote;
  if (!remoteConfig || !remoteConfig.repo) {
    return fail('no remote configured', {
      reason: 'Sync requires a configured artifact backend.',
      recovery: 'Add a Hugging Face remote repository before syncing.',
      command: 'ctx remote add hf <repo>',
      code: 2
    });
  }

  const backend = createBackend(remoteConfig);
  if (!backend) {
    const tokenEnv = remoteConfig.token_env || 'HF_TOKEN';
    if (!process.env[tokenEnv]) {
      return fail(`${tokenEnv} environment variable is not set`, {
        reason: 'The configured remote backend requires an access token.',
        recovery: `Set ${tokenEnv} and try again, or configure a different provider.`,
        command: `export ${tokenEnv}=<token>`,
        code: 2
      });
    }
    return fail('unable to initialize remote backend', {
      reason: 'The remote provider configuration could not create a backend client.',
      recovery: 'Check provider, repository, credentials, and network configuration.',
      command: 'ctx remote add hf <repo>',
      code: 2
    });
  }

  const queued = getRetryQueue(root);
  if (queued.length && !quiet) {
    console.log(`Processing ${queued.length} queued uploads...`);
  }

  try {
    const result = await syncArtifacts(root, backend, { dryRun, quiet });

    if (result.failed.length) {
      const failedPaths = result.failed.map((f) => f.label);
      enqueueRetry(root, failedPaths);
      if (!quiet) console.log('Failed uploads added to retry queue.');
    } else {
      clearRetryQueue(root);
    }

    if (!quiet) console.log('Sync complete.');
    return result.failed.length > 0 ? 1 : 0;
  } catch (err) {
    const artifacts = gatherArtifacts(root);
    enqueueRetry(root, artifacts.map((a) => a.label));
    if (quiet) return 1;
    return fail('sync failed', {
      reason: err.message,
      recovery: 'All artifacts were queued for retry. Fix connectivity or credentials and rerun sync.',
      command: 'ctx sync',
      code: 1
    });
  }
}

// ---------------------------------------------------------------------------
// CLI: ctx pull
// ---------------------------------------------------------------------------

export async function pullCommand(args, cwd) {
  const root = resolveGitRoot(cwd);
  if (!root) return fail('not inside a Git repository');

  const configPath = path.join(root, '.contextlock', 'config.json');
  if (!existsSync(configPath)) return fail('ContextLock is not initialized; run `ctx init` first');

  const quiet = args.includes('--quiet');
  const snapshotIndex = args.indexOf('--snapshot');
  const specificHash = snapshotIndex !== -1 ? args[snapshotIndex + 1] : null;

  const config = readJsonIfExists(configPath);
  const remoteConfig = config?.remote;
  if (!remoteConfig || !remoteConfig.repo) {
    return fail('no remote configured', {
      reason: 'Pull requires a configured artifact backend.',
      recovery: 'Add a Hugging Face remote repository before pulling.',
      command: 'ctx remote add hf <repo>',
      code: 2
    });
  }

  const backend = createBackend(remoteConfig);
  if (!backend) {
    const tokenEnv = remoteConfig.token_env || 'HF_TOKEN';
    if (!process.env[tokenEnv]) {
      return fail(`${tokenEnv} environment variable is not set`, {
        reason: 'The configured remote backend requires an access token.',
        recovery: `Set ${tokenEnv} and try again, or configure a different provider.`,
        command: `export ${tokenEnv}=<token>`,
        code: 2
      });
    }
    return fail('unable to initialize remote backend', {
      reason: 'The remote provider configuration could not create a backend client.',
      recovery: 'Check provider, repository, credentials, and network configuration.',
      command: 'ctx remote add hf <repo>',
      code: 2
    });
  }

  try {
    const result = await pullArtifacts(root, backend, { quiet, specificHash });

    if (!quiet) {
      if (result.downloaded.length) {
        console.log(`Pulled ${result.downloaded.length} artifacts.`);
      } else {
        console.log('Local artifacts are up to date.');
      }
    }
    return result.failed.length > 0 ? 1 : 0;
  } catch (err) {
    return fail('pull failed', {
      reason: err.message,
      recovery: 'Check remote configuration, credentials, and network connectivity, then retry.',
      command: 'ctx pull',
      code: 1
    });
  }
}
