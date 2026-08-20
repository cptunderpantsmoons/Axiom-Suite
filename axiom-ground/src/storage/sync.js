import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir, readJsonIfExists, sha256 } from '../utils/core.js';
import { writeLockJson } from '../init/index.js';

// ---------------------------------------------------------------------------
// Artifact enumeration
// ---------------------------------------------------------------------------

export function gatherArtifacts(root) {
  const artifacts = [];
  const ctxDir = path.join(root, '.contextlock');

  const snapDir = path.join(ctxDir, 'snapshots');
  if (existsSync(snapDir)) {
    for (const file of readdirSync(snapDir)) {
      const full = path.join(snapDir, file);
      if (statSync(full).isFile()) {
        artifacts.push({ localPath: full, remotePath: `snapshots/${file}`, label: `snapshot:${file}` });
      }
    }
  }

  const promptsDir = path.join(ctxDir, 'prompts');
  if (existsSync(promptsDir)) {
    const stack = [promptsDir];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else {
          const rel = path.relative(promptsDir, full).replace(/\\/g, '/');
          artifacts.push({ localPath: full, remotePath: `prompts/${rel}`, label: `prompt:${rel}` });
        }
      }
    }
  }

  const auditDir = path.join(ctxDir, 'audits');
  if (existsSync(auditDir)) {
    for (const file of readdirSync(auditDir)) {
      const full = path.join(auditDir, file);
      if (statSync(full).isFile()) {
        artifacts.push({ localPath: full, remotePath: `audits/${file}`, label: `audit:${file}` });
      }
    }
  }

  const lockPath = path.join(ctxDir, 'lock.json');
  if (existsSync(lockPath)) {
    artifacts.push({ localPath: lockPath, remotePath: 'lock/latest.json', label: 'lock:latest.json' });
  }

  return artifacts;
}

// ---------------------------------------------------------------------------
// Sync logic
// ---------------------------------------------------------------------------

export async function syncArtifacts(root, backend, { dryRun = false, quiet = false } = {}) {
  const artifacts = gatherArtifacts(root);
  const uploaded = [];
  const skipped = [];
  const failed = [];

  const lockArtifact = artifacts.find((a) => a.remotePath === 'lock/latest.json');
  const otherArtifacts = artifacts.filter((a) => a.remotePath !== 'lock/latest.json');

  const toUpload = [...otherArtifacts];
  if (lockArtifact) toUpload.push(lockArtifact);

  for (const artifact of toUpload) {
    try {
      const content = readFileSync(artifact.localPath);
      const contentHash = sha256(content.toString('utf8'));

      if (await backend.exists(artifact.remotePath)) {
        try {
          const remoteContent = await backend.get(artifact.remotePath);
          if (remoteContent) {
            const remoteHash = sha256(remoteContent.toString('utf8'));
            if (remoteHash === contentHash) {
              skipped.push(artifact.label);
              continue;
            }
            failed.push({ label: artifact.label, reason: 'remote hash mismatch — refusing to overwrite' });
            continue;
          }
        } catch {
          // Can't read remote — proceed with upload
        }
      }

      if (!dryRun) {
        await backend.put(artifact.remotePath, content);
      }
      uploaded.push(artifact.label);
    } catch (err) {
      failed.push({ label: artifact.label, reason: err.message });
    }
  }

  if (!quiet) {
    if (uploaded.length) console.log(`Uploaded: ${uploaded.join(', ')}`);
    if (skipped.length) console.log(`Skipped (already synced): ${skipped.length} artifacts`);
    if (failed.length) {
      console.error(`Failed: ${failed.map((f) => `${f.label} (${f.reason})`).join(', ')}`);
    }
  }

  return { uploaded, skipped, failed };
}

// ---------------------------------------------------------------------------
// Pull logic
// ---------------------------------------------------------------------------

export async function pullArtifacts(root, backend, { quiet = false, specificHash = null } = {}) {
  let remoteLock = null;
  try {
    const lockBuf = await backend.get('lock/latest.json');
    if (lockBuf) remoteLock = JSON.parse(lockBuf.toString('utf8'));
  } catch {
    if (!quiet) console.error('No remote lockfile found.');
    return { downloaded: [], failed: [] };
  }

  if (!remoteLock) {
    if (!quiet) console.error('No remote lockfile found.');
    return { downloaded: [], failed: [] };
  }

  const downloaded = [];
  const failed = [];

  const remoteFiles = await backend.list('');
  const toDownload = specificHash
    ? remoteFiles.filter((f) => f.includes(specificHash))
    : remoteFiles.filter((f) => !f.startsWith('lock/'));

  for (const remotePath of toDownload) {
    try {
      const localPath = path.join(root, '.contextlock', remotePath);
      if (existsSync(localPath)) continue;
      const content = await backend.get(remotePath);
      if (content) {
        ensureDir(path.dirname(localPath));
        writeFileSync(localPath, content);
        downloaded.push(remotePath);
      }
    } catch (err) {
      failed.push({ path: remotePath, reason: err.message });
    }
  }

  if (!specificHash) {
    const localLockPath = path.join(root, '.contextlock', 'lock.json');
    const localLock = readJsonIfExists(localLockPath) || {};
    const merged = { ...localLock, ...remoteLock, updated_at: new Date().toISOString() };
    writeLockJson(root, merged);
  }

  if (!quiet) {
    if (downloaded.length) console.log(`Downloaded: ${downloaded.join(', ')}`);
    if (failed.length) console.error(`Failed: ${failed.map((f) => `${f.path} (${f.reason})`).join(', ')}`);
  }

  return { downloaded, failed };
}
