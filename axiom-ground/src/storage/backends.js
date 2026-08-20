import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../utils/core.js';

// ---------------------------------------------------------------------------
// Generic file-based backend (used by local and mock HF)
// ---------------------------------------------------------------------------

function fileBackend(base) {
  return {
    name: 'file',
    async put(remotePath, content) {
      const dest = path.join(base, remotePath);
      ensureDir(path.dirname(dest));
      writeFileSync(dest, content);
    },
    async get(remotePath) {
      const src = path.join(base, remotePath);
      if (!existsSync(src)) return null;
      return readFileSync(src);
    },
    async exists(remotePath) {
      return existsSync(path.join(base, remotePath));
    },
    async list(prefix = '') {
      const dir = path.join(base, prefix);
      if (!existsSync(dir)) return [];
      const results = [];
      const walk = (d) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
          const rel = path.relative(base, path.join(d, entry.name)).replace(/\\/g, '/');
          if (entry.isFile()) results.push(rel);
          else if (entry.isDirectory()) walk(path.join(d, entry.name));
        }
      };
      walk(dir);
      return results.sort((a, b) => a.localeCompare(b));
    }
  };
}

// ---------------------------------------------------------------------------
// Local backend (for testing and offline operation)
// ---------------------------------------------------------------------------

function localBackend(root) {
  const backend = fileBackend(path.join(root, '.contextlock', 'remote-cache'));
  return { ...backend, name: 'local' };
}

// ---------------------------------------------------------------------------
// Mock HuggingFace backend (for testing)
// ---------------------------------------------------------------------------

function mockHfBackend(base) {
  const backend = fileBackend(base);
  return { ...backend, name: 'huggingface-mock' };
}

// ---------------------------------------------------------------------------
// HuggingFace backend
// ---------------------------------------------------------------------------

function hfBackend({ repo, repoType = 'dataset', token }) {
  const baseUrl = `https://huggingface.co/api/${repoType}s/${repo}`;
  const resolveBase = `https://huggingface.co/${repoType}s/${repo}/resolve/main`;
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  async function hfRequest(method, urlPath, body = null) {
    const url = urlPath.startsWith('http') ? urlPath : `${baseUrl}${urlPath}`;
    const opts = { method, headers: { ...authHeaders } };
    if (body !== null) {
      opts.body = body;
      opts.headers['Content-Type'] = 'application/octet-stream';
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HF API ${method} ${urlPath}: ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`);
    }
    return res;
  }

  return {
    name: 'huggingface',

    async put(remotePath, content) {
      const uploadPath = `/upload/main/${remotePath}`;
      await hfRequest('PUT', uploadPath, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
    },

    async get(remotePath) {
      const url = `${resolveBase}/${remotePath}`;
      try {
        const res = await hfRequest('GET', url);
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        if (err.message && err.message.includes('404')) return null;
        throw err;
      }
    },

    async exists(remotePath) {
      const url = `${resolveBase}/${remotePath}`;
      try {
        const res = await fetch(url, { method: 'HEAD', headers: { ...authHeaders } });
        return res.ok;
      } catch {
        return false;
      }
    },

    async list(prefix = '') {
      try {
        const res = await hfRequest('GET', '?blobs=true');
        const data = await res.json();
        const files = (data.siblings || []).map((s) => s.rfilename);
        if (prefix) return files.filter((f) => f.startsWith(prefix)).sort((a, b) => a.localeCompare(b));
        return files.sort((a, b) => a.localeCompare(b));
      } catch {
        return [];
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Backend factory
// ---------------------------------------------------------------------------

export function createBackend(remoteConfig) {
  if (!remoteConfig || !remoteConfig.repo) return null;

  if (remoteConfig.provider === 'huggingface' || remoteConfig.provider === 'hf') {
    if (process.env.CONTEXTLOCK_HF_MOCK_DIR) {
      return mockHfBackend(process.env.CONTEXTLOCK_HF_MOCK_DIR);
    }
    const token = process.env[remoteConfig.token_env || 'HF_TOKEN'] || null;
    if (!token) return null;
    return hfBackend({
      repo: remoteConfig.repo,
      repoType: remoteConfig.repo_type || 'dataset',
      token
    });
  }

  if (remoteConfig.provider === 'local') {
    return localBackend(process.cwd());
  }

  return null;
}
