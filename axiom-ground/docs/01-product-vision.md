# 01 — Product Vision

## Problem

AI coding tools are increasingly capable at local implementation, but weak at long-lived project continuity. They lose architectural context, repeat obsolete patterns, miss project-specific invariants, and produce code that is locally correct but globally inconsistent.

The missing primitive is not another chatbot memory layer. The missing primitive is a **reproducible project context artifact**.

## Thesis

AI coding needs a context layer equivalent to what Git is for source control:

- reproducible,
- diffable,
- versioned,
- branch-aware,
- automatable,
- auditable,
- portable across tools.

## Product category

ContextLock should define a new category:

> **AI Project Context Infrastructure**

It is not a task manager, not a general agent framework, and not merely a summarizer.

## Core users

### Primary users

- solo developers using AI heavily,
- small teams using AI coding agents,
- engineering leads worried about AI-generated technical debt,
- consultants onboarding into unfamiliar repos,
- agent platforms needing reliable project context.

### Secondary users

- open-source maintainers,
- auditors,
- QA teams,
- devtools companies,
- enterprise AI governance teams.

## Primary jobs-to-be-done

1. **Onboard an AI into a repo quickly.**
2. **Prevent AI-generated context drift.**
3. **Know when prompts are stale.**
4. **Compare project meaning across commits/branches.**
5. **Store reusable context artifacts outside a chat session.**

## What makes this different

Most tools answer:

> What files exist?

ContextLock should answer:

> What does this project believe about itself, and where has that belief become false?

## Non-negotiable principles

1. **Source-derived first** — generated from repo state, not hand-written memory.
2. **Deterministic enough to diff** — same repo state should produce same artifact hashes where possible.
3. **Branch-aware** — context must not leak across branches without tracking.
4. **Prompt lineage** — every prompt must point to its snapshot.
5. **Storage-agnostic** — local first, Hugging Face as first remote backend.
6. **Human annotations are inputs, not truth** — code, tests, docs, and git history remain primary.

## MVP product statement

ContextLock scans a repository, generates a canonical project snapshot, compiles AI onboarding prompts from that snapshot, audits future commits for drift, and optionally syncs artifacts to Hugging Face.

## Strongest future product statement

ContextLock becomes the universal context substrate for AI coding: every agent, IDE, CI pipeline, and repository can ask for the current project context, retrieve validated prompt packs, and check whether changes violate the project's declared architecture.
