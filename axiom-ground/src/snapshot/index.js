import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ensureDir, fastCompare, readJsonIfExists, runGit, sha256, writeJson } from '../utils/core.js';
import { assertValidSchema, bundledSchemaPath } from '../utils/schema.js';
import { writeLockJson } from '../init/index.js';
import {
  buildDirectoryMap,
  detectEntryPoints,
  detectLanguage,
  extractCommands,
  extractDependencies,
  extractDocsFiles,
  isBinaryBuffer,
  normalizeTextContent,
  fastRedactSecrets,
  extractManifests,
  parsePackageJson,
  parseRequirements,
  walkFiles,
  DEFAULT_EXCLUDES,
  MAX_TEXT_BYTES
} from '../scanner/index.js';

// ---------------------------------------------------------------------------
// Stable sort / canonicalization helpers
// ---------------------------------------------------------------------------

function sortMarkersTuple(markers) {
  return [...markers].sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    if (a.line !== b.line) return a.line - b.line;
    if (a.marker < b.marker) return -1;
    if (a.marker > b.marker) return 1;
    if (a.text < b.text) return -1;
    if (a.text > b.text) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Fast git metadata — read .git/HEAD directly to avoid repeated spawnSync
// ---------------------------------------------------------------------------

function readGitMeta(root) {
  let branch = null;
  let commit = null;

  try {
    const headPath = path.join(root, '.git', 'HEAD');
    const head = readFileSync(headPath, 'utf8').trim();
    if (head.startsWith('ref: ')) {
      const ref = head.slice(5);
      branch = ref.replace('refs/heads/', '');
      try {
        const refPath = path.join(root, '.git', ref);
        commit = readFileSync(refPath, 'utf8').trim();
      } catch {
        // packed-refs or worktree; fall through to runGit
        commit = null;
      }
    } else if (/^[0-9a-f]{40}$/i.test(head)) {
      commit = head;
    }
  } catch {
    // not a standard git worktree
  }

  // Fallback: read packed-refs directly before spawning git
  if (!commit) {
    try {
      const packed = readFileSync(path.join(root, '.git', 'packed-refs'), 'utf8');
      const needle = branch ? `refs/heads/${branch}` : null;
      if (needle) {
        for (const line of packed.split('\n')) {
          if (line.includes(needle)) {
            const parts = line.trim().split(' ');
            if (parts[0] && /^[0-9a-f]{40}$/i.test(parts[0])) {
              commit = parts[0];
              break;
            }
          }
        }
      }
    } catch {}
  }
  // Fallback for edge cases
  if (!branch) branch = runGit(['branch', '--show-current'], root) || null;
  if (!commit) commit = runGit(['rev-parse', 'HEAD'], root) || null;

  const porcelain = runGit(['status', '--porcelain'], root);
  const dirty = porcelain ? porcelain.split('\n').some((line) => line.trim() && !line.includes('.contextlock')) : false;

  const log = runGit(['log', '--oneline', '-n', '3'], root);
  const recentCommits = log ? log.split('\n').filter(Boolean) : [];

  return { branch, commit, dirty, recentCommits };
}

function snapshotHashInput(snapshot) {
  return {
    machine_facts: snapshot.machine_facts,
    project_map: snapshot.project_map,
    debt_markers: snapshot.debt_markers,
    content_fingerprints: snapshot.content_fingerprints
  };
}

const SCANNER_VERSION = 1;
const SENSITIVE_FP = '017ad73325fcf108a972edac618f9edfc957c5b1de10f8b371b0a8bfa4f59e2d';
const MARKER_RE = /\b(TODO|FIXME|HACK)\b[:\- ]?(.*)$/i;

function snapshotCachePath(root) {
  return path.join(root, '.contextlock', 'cache', 'snapshot-index.json');
}

function configFingerprint(config) {
  return sha256(JSON.stringify({
    include: Array.isArray(config?.include) ? config.include : ['**/*'],
    exclude: Array.isArray(config?.exclude) ? config.exclude : DEFAULT_EXCLUDES,
    hash_spec_version: 1,
    scanner_version: SCANNER_VERSION
  }));
}

function isSensitivePath(rel) {
  const lower = rel.toLowerCase();
  return lower.startsWith('.env') || lower.endsWith('.pem') || lower.endsWith('.key') || lower.includes('/secrets/') || lower.includes('/credentials/');
}

// Static predicate: paths that are text but extremely unlikely to contain code
// markers and are expensive to split/scan (lock files, source maps, generated sums).
const SKIP_MARKER_EXTENSIONS = new Set([
  '.lock', '.sum', '.map'
]);

function shouldExtractMarkers(rel) {
  const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase();
  return !SKIP_MARKER_EXTENSIONS.has(ext);
}



function extractFingerprintsAndMarkersWithCache(root, files, generation) {
  const cache = generation.generationMode === 'incremental' ? readJsonIfExists(snapshotCachePath(root)) : null;
  const previousIndex = cache?.file_index && typeof cache.file_index === 'object' ? cache.file_index : {};
  const fingerprints = {};
  const fileIndex = {};
  const markers = [];
  let reused = 0;
  let recomputed = 0;
  let redactionCount = 0;
  let sensitivePathsSkipped = 0;

  for (const rel of files) {
    const full = path.join(root, rel);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.size > MAX_TEXT_BYTES) continue;

    const isSensitive = isSensitivePath(rel);
    if (isSensitive) sensitivePathsSkipped += 1;

    const previous = previousIndex[rel];
    if (previous && previous.size === stat.size && previous.mtime_ms === stat.mtimeMs && previous.fingerprint) {
      fingerprints[rel] = previous.fingerprint;
      fileIndex[rel] = { size: stat.size, mtime_ms: stat.mtimeMs, fingerprint: previous.fingerprint };
      reused += 1;
      continue;
    }

    let buffer;
    try {
      buffer = readFileSync(full);
    } catch {
      continue;
    }

    let fingerprint;
    if (isSensitive) {
      fingerprint = SENSITIVE_FP;
    } else if (isBinaryBuffer(buffer)) {
      fingerprint = crypto.hash('sha256', buffer, 'hex');
    } else {
      const needsMarkers = shouldExtractMarkers(rel);
      const hasMarker = needsMarkers && (
        buffer.indexOf('TODO') >= 0 || buffer.indexOf('FIXME') >= 0 || buffer.indexOf('HACK') >= 0
      );
      const hasCr = buffer.indexOf('\r') >= 0;

      if (!hasCr && !hasMarker) {
        fingerprint = crypto.hash('sha256', buffer, 'hex');
      } else {
        const text = normalizeTextContent(buffer.toString('utf8'));
        fingerprint = crypto.hash('sha256', text, 'hex');

        if (hasMarker && /\b(TODO|FIXME|HACK)\b/i.test(text)) {
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            const match = line.match(MARKER_RE);
            if (!match) continue;
            const redacted = fastRedactSecrets(line.trim());
            redactionCount += redacted.redactionCount;
            markers.push({
              file: rel,
              line: i + 1,
              marker: match[1].toUpperCase(),
              text: redacted.text
            });
          }
        }
      }
    }

    fingerprints[rel] = fingerprint;
    fileIndex[rel] = { size: stat.size, mtime_ms: stat.mtimeMs, fingerprint };
    recomputed += 1;
  }

  return {
    fingerprints,
    markers,
    stats: { reused_fingerprints: reused, recomputed_fingerprints: recomputed },
    fileIndex,
    redactionCount,
    sensitivePathsSkipped
  };
}

function resolveGenerationMetadata(root, config, requestedMode, requestedBaseHash) {
  if (requestedMode !== 'incremental') {
    return { generationMode: 'full', incrementalBaseSnapshotHash: null, fallbackToFull: false, fallbackReason: null };
  }

  const cache = readJsonIfExists(snapshotCachePath(root));
  const configHash = configFingerprint(config);
  const baseHash = requestedBaseHash || null;
  const reason = (() => {
    if (!baseHash) return 'missing baseline snapshot';
    if (!cache) return 'missing incremental cache';
    if (cache.latest_snapshot_hash !== baseHash) return 'cache baseline mismatch';
    if (cache.config_hash !== configHash) return 'config include/exclude or scanner version changed';
    if (cache.hash_spec_version !== 1) return 'hash spec version changed';
    if (cache.scanner_version !== SCANNER_VERSION) return 'scanner version changed';
    return null;
  })();

  if (reason) {
    return { generationMode: 'full', incrementalBaseSnapshotHash: baseHash, fallbackToFull: true, fallbackReason: reason };
  }

  return { generationMode: 'incremental', incrementalBaseSnapshotHash: baseHash, fallbackToFull: false, fallbackReason: null };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function joinLimited(items, limit = 12, format = (value) => `- ${value}`) {
  const shown = items.slice(0, limit).map(format);
  if (items.length > limit) {
    shown.push(`- … and ${items.length - limit} more`);
  }
  return shown.join('\n');
}

function renderSnapshotMarkdown(snapshot) {
  const facts = snapshot.machine_facts;
  const map = snapshot.project_map;
  const debt = snapshot.debt_markers;
  const docs = facts.docs_files || [];
  const entrypoints = facts.entrypoints || [];
  const testCommands = facts.test_commands || [];
  const buildCommands = facts.build_commands || [];
  const runCommands = facts.run_commands || [];
  const risks = snapshot.inferred_context?.risk_zones || [];
  const recentCommits = Array.isArray(snapshot.git.recent_commits) ? snapshot.git.recent_commits : [];
  const filesToReadFirst = map.important_files.slice(0, 5);
  const doNotAssume = [
    'Unhandled ecosystems are only partially understood.',
    'Inferred context is a summary, not a contract.',
    'Missing commands are unknown, not absent.'
  ];

  const lines = [];
  lines.push(`# ContextLock Snapshot`);
  lines.push('');
  lines.push(`- Project: ${snapshot.project_id}`);
  lines.push(`- Snapshot hash: ${snapshot.snapshot_hash}`);
  lines.push(`- Source commit: ${snapshot.git.commit || 'unknown'}`);
  lines.push(`- Branch: ${snapshot.git.branch || 'unknown'}`);
  lines.push(`- Dirty: ${snapshot.git.dirty ? 'yes' : 'no'}`);
  lines.push(`- Files: ${facts.file_count}`);
  lines.push('');
  lines.push('## Project summary');
  lines.push(snapshot.inferred_context?.summary || 'No summary inferred yet.');
  lines.push('');
  lines.push('## Known facts');
  lines.push(`- Languages: ${facts.languages.length ? facts.languages.join(', ') : 'None detected'}`);
  lines.push(`- Manifests: ${facts.manifests.length ? facts.manifests.join(', ') : 'None detected'}`);
  lines.push(`- Dependencies: ${facts.dependencies.length ? facts.dependencies.join(', ') : 'None detected'}`);
  lines.push('');
  lines.push('## Commands');
  lines.push(`- Test: ${testCommands.length ? testCommands.join(' | ') : 'None detected'}`);
  lines.push(`- Build: ${buildCommands.length ? buildCommands.join(' | ') : 'None detected'}`);
  lines.push(`- Run: ${runCommands.length ? runCommands.join(' | ') : 'None detected'}`);
  lines.push('');
  lines.push('## Entry points');
  lines.push(entrypoints.length ? joinLimited(entrypoints) : '- None detected');
  lines.push('');
  lines.push('## Module / directory map');
  lines.push(map.directories.length ? joinLimited(map.directories, 12, (item) => `- ${item.path} (${item.role}, ${item.file_count} files)`) : '- None detected');
  lines.push('');
  lines.push('## Docs map');
  lines.push(docs.length ? joinLimited(docs, 16) : '- None detected');
  lines.push('');
  lines.push('## Files to read first');
  lines.push(filesToReadFirst.length ? joinLimited(filesToReadFirst, 5, (item) => `- ${item.path} — ${item.reason}`) : '- None detected');
  lines.push('');
  lines.push('## Known debt markers');
  lines.push(debt.length ? joinLimited(debt, 12, (item) => `- ${item.file}:${item.line} ${item.marker} ${item.text}`) : '- None detected');
  lines.push('');
  lines.push('## Recent git context');
  lines.push(recentCommits.length ? joinLimited(recentCommits, 3) : '- No recent commits detected');
  lines.push('');
  lines.push('## Inferred risk zones');
  lines.push(risks.length ? joinLimited(risks) : '- None detected');
  lines.push('');
  lines.push('## Do not assume');
  lines.push(joinLimited(doNotAssume, 3));
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

export function buildSnapshot(root, config, lock, { generationMode = 'full', incrementalBaseSnapshotHash = null } = {}) {
  const generation = resolveGenerationMetadata(root, config, generationMode, incrementalBaseSnapshotHash);
  const files = walkFiles(root, Array.isArray(config?.exclude) ? config.exclude : DEFAULT_EXCLUDES);
  const manifests = extractManifests(root);
  const packageJson = parsePackageJson(root);
  const requirementsDeps = parseRequirements(root);
  const pythonDetected = manifests.includes('pyproject.toml') || manifests.includes('requirements.txt');
  const entrypoints = detectEntryPoints(root, files, packageJson);
  const commands = extractCommands(packageJson, pythonDetected, manifests);
  const docsFiles = extractDocsFiles(files);
  const { fingerprints, markers: debtMarkers, stats: fpStats, fileIndex, redactionCount, sensitivePathsSkipped } = extractFingerprintsAndMarkersWithCache(root, files, generation);
  const directories = buildDirectoryMap(files);
  const languages = new Set();
  const langCache = new Map();

  for (const rel of files) {
    let language = langCache.get(rel);
    if (language === undefined) {
      language = detectLanguage(rel, manifests);
      langCache.set(rel, language);
    }
    if (language) languages.add(language);
  }
  if (manifests.includes('package.json')) {
    if ([...languages].some((language) => language === 'javascript' || language === 'typescript') || entrypoints.some((item) => /\.(js|ts|tsx|mjs|cjs)$/.test(item))) {
      languages.add('javascript');
    }
  }
  if (manifests.includes('pyproject.toml') || manifests.includes('requirements.txt')) languages.add('python');
  if (manifests.includes('go.mod')) languages.add('go');
  if (manifests.includes('Cargo.toml')) languages.add('rust');

  const machineFacts = {
    languages: [...languages].sort((a, b) => fastCompare(a, b)),
    file_count: files.length,
    manifests,
    entrypoints,
    test_commands: commands.test_commands,
    build_commands: commands.build_commands,
    run_commands: commands.run_commands,
    dependencies: extractDependencies(packageJson, requirementsDeps),
    docs_files: docsFiles
  };

  const importantFilesSet = new Set();
  const importantFiles = [];
  for (const file of docsFiles) {
    if (importantFilesSet.has(file)) continue;
    importantFilesSet.add(file);
    const reason = path.basename(file).toLowerCase().startsWith('readme') ? 'primary documentation' : 'documentation';
    importantFiles.push({ path: file, reason });
  }
  for (const file of entrypoints) {
    if (importantFilesSet.has(file)) continue;
    importantFilesSet.add(file);
    importantFiles.push({ path: file, reason: 'entrypoint' });
  }
  importantFiles.sort((a, b) => fastCompare(a.path, b.path));

  const inferredContext = {
    summary: `${config?.project_name || path.basename(root)} has ${files.length} tracked files across ${machineFacts.languages.length} detected languages.`,
    architecture: directories.map((item) => `${item.path} (${item.role})`),
    risk_zones: debtMarkers.length ? [...new Set(debtMarkers.map((item) => path.dirname(item.file).split('/')[0]).filter((item) => item && item !== '.'))].sort((a, b) => fastCompare(a, b)) : []
  };

  const snapshot = {
    schema_version: 1,
    artifact_type: 'snapshot',
    project_id: config.project_id,
    hash_spec_version: 1,
    scanner_version: SCANNER_VERSION,
    config_hash: configFingerprint(config),
    generation_mode: generation.generationMode,
    incremental_base_snapshot_hash: generation.incrementalBaseSnapshotHash,
    fallback_to_full: generation.fallbackToFull,
    fallback_reason: generation.fallbackReason,
    created_at: new Date().toISOString(),
    git: (() => {
      const g = readGitMeta(root);
      return {
        branch: lock?.current_branch || g.branch || null,
        commit: lock?.current_commit || g.commit || null,
        dirty: g.dirty,
        recent_commits: g.recentCommits
      };
    })(),
    machine_facts: machineFacts,
    project_map: {
      directories,
      important_files: importantFiles
    },
    debt_markers: sortMarkersTuple(debtMarkers),
    inferred_context: inferredContext,
    human_annotations: {
      architecture_claims: [],
      known_debt: []
    },
    volatile_state: {
      incremental: fpStats
    },
    security: {
      redaction_count: redactionCount,
      sensitive_paths_skipped: sensitivePathsSkipped
    },
    content_fingerprints: fingerprints
  };

  const hashInput = snapshotHashInput(snapshot);
  const fullHash = sha256(JSON.stringify(hashInput));
  const snapshotHash = `ctxsnap_${fullHash.slice(0, 16)}`;
  snapshot.snapshot_hash = snapshotHash;
  snapshot.artifact_hash = fullHash;
  snapshot[Symbol.for('contextlock.fileIndex')] = fileIndex;

  return snapshot;
}

// ---------------------------------------------------------------------------
// Artifact persistence
// ---------------------------------------------------------------------------

export function writeSnapshotArtifacts(root, snapshot, fileIndex = null) {
  const snapshotsDir = path.join(root, '.contextlock', 'snapshots');
  ensureDir(snapshotsDir);
  const jsonPath = path.join(snapshotsDir, `${snapshot.snapshot_hash}.json`);
  const mdPath = path.join(snapshotsDir, `${snapshot.snapshot_hash}.md`);
  const existing = readJsonIfExists(jsonPath);
  if (existing?.snapshot_hash === snapshot.snapshot_hash && existing?.created_at) {
    snapshot.created_at = existing.created_at;
  }
  assertValidSchema(snapshot, bundledSchemaPath('snapshot'), 'snapshot');
  writeJson(jsonPath, snapshot);
  writeFileSync(mdPath, `${renderSnapshotMarkdown(snapshot)}\n`);
  ensureDir(path.dirname(snapshotCachePath(root)));
  const sym = Symbol.for('contextlock.fileIndex');
  if (!fileIndex && snapshot[sym]) {
    fileIndex = snapshot[sym];
    delete snapshot[sym];
  }
  if (!fileIndex) {
    fileIndex = {};
    for (const [rel, fingerprint] of Object.entries(snapshot.content_fingerprints || {})) {
      const full = path.join(root, rel);
      if (!existsSync(full)) continue;
      const stat = statSync(full);
      fileIndex[rel] = { size: stat.size, mtime_ms: stat.mtimeMs, fingerprint };
    }
  }
  writeJson(snapshotCachePath(root), {
    schema_version: 1,
    artifact_type: 'snapshot_cache_index',
    latest_snapshot_hash: snapshot.snapshot_hash,
    config_hash: snapshot.config_hash,
    hash_spec_version: snapshot.hash_spec_version,
    scanner_version: SCANNER_VERSION,
    file_index: fileIndex,
    updated_at: snapshot.created_at
  });
  return { jsonPath, mdPath };
}

export function updateLockAfterSnapshot(root, config, lock, snapshot) {
  const unchanged = lock?.project_id === config.project_id &&
    lock?.current_branch === snapshot.git.branch &&
    lock?.current_commit === snapshot.git.commit &&
    lock?.latest_snapshot_hash === snapshot.snapshot_hash;
  const next = {
    ...lock,
    project_id: config.project_id,
    current_branch: snapshot.git.branch,
    current_commit: snapshot.git.commit,
    latest_snapshot_hash: snapshot.snapshot_hash,
    updated_at: unchanged && lock?.updated_at ? lock.updated_at : new Date().toISOString()
  };
  writeLockJson(root, next);
  return next;
}

export function loadSnapshotArtifact(root, snapshotHash) {
  if (!snapshotHash) return null;
  const snapshotPath = path.join(root, '.contextlock', 'snapshots', `${snapshotHash}.json`);
  if (!existsSync(snapshotPath)) return null;
  return readJsonIfExists(snapshotPath);
}

export function listSnapshotArtifacts(root) {
  const dir = path.join(root, '.contextlock', 'snapshots');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const full = path.join(dir, file);
      const stat = statSync(full);
      return { hash: file.slice(0, -5), mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || fastCompare(a.hash, b.hash));
}

export function fingerprintKeys(snapshot) {
  return Object.keys(snapshot?.content_fingerprints || {}).sort((a, b) => fastCompare(a, b));
}
