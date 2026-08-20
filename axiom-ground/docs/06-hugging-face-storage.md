# 06 — Hugging Face Storage

## Role of Hugging Face

Hugging Face should be treated as a remote artifact backend for context objects, not as the core product.

ContextLock must work locally first. Hugging Face sync is a portability and sharing layer.

## Storage model

Use a Hugging Face Dataset repo or model repo as a versioned artifact bucket.

Recommended layout:

```txt
/{project_id}/
  lock/
    latest.json
  snapshots/
    {snapshot_hash}.json
    {snapshot_hash}.md
  prompts/
    {snapshot_hash}/
      onboarding.md
      bugfix.md
      review.md
      refactor.md
      audit.md
      metadata.json
  audits/
    {audit_id}.json
    {audit_id}.md
  plans/
    {plan_id}.json
    {plan_id}.md
```

## Artifact naming

Use content-addressed names where possible:

```txt
ctxsnap_{hash}.json
ctxprompt_{hash}.md
audit_{from}_{to}.json
```

## Remote config

```json
{
  "remote": {
    "provider": "huggingface",
    "repo": "username/project-context-cache",
    "repo_type": "dataset",
    "token_env": "HF_TOKEN",
    "auto_sync": true
  }
}
```

## Sync commands

```bash
ctx remote add hf username/project-context-cache
ctx sync
ctx sync --push
ctx pull
ctx pull --snapshot ctxsnap_789
```

## Sync rules

1. Local artifacts are source of truth unless explicitly pulling.
2. Never overwrite a different artifact with the same hash.
3. Upload new artifacts only.
4. Update `lock/latest.json` last.
5. Failed syncs go into retry queue.

## Retry queue

```json
{
  "pending_uploads": [
    ".contextlock/snapshots/ctxsnap_789.json",
    ".contextlock/prompts/ctxsnap_789/onboarding.md"
  ],
  "last_error": "network unavailable",
  "next_retry_after": "2026-05-16T00:10:00Z"
}
```

## Security and privacy defaults

Do not upload automatically until explicitly configured.

Default excludes:

- `.env`,
- secret files,
- private keys,
- credentials,
- raw logs,
- database dumps,
- large binary assets.

Add secret scanning before sync.

## Why HF is strategically useful

Hugging Face provides:

- public/private repositories,
- dataset-like artifact storage,
- easy sharing with AI workflows,
- natural alignment with model/prompt ecosystems,
- versioned remote state.

## Elevating idea: prompt datasets

Over time, ContextLock can create a structured prompt dataset:

```json
{
  "project_type": "typescript-web-app",
  "snapshot_features": {},
  "prompt_type": "bugfix",
  "prompt": "...",
  "audit_outcome": {},
  "accepted": true
}
```

This can become a valuable training/evaluation corpus for AI coding context quality.

## Future backend abstraction

Design storage behind an interface:

```ts
interface ArtifactBackend {
  put(path: string, content: Buffer): Promise<void>
  get(path: string): Promise<Buffer>
  exists(path: string): Promise<boolean>
  list(prefix: string): Promise<string[]>
}
```

Backends:

- local filesystem,
- Hugging Face,
- S3,
- Cloudflare R2,
- GitHub Releases,
- plain Git repo.
