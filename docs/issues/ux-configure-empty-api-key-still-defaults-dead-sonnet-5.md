---
severity: high
impact: correctness
comment: "Bundles two already-filed defects (empty flag silently ignored; dead sonnet-5 default) and adds no new observation about either - the empty --api-key is incidental to the default it happens to reveal. Retire into ux-agent-empty-api-key-silently-uses-stored.md and the sonnet-5 cluster. This is issue-count inflation from combinatorial flag probing, not a distinct defect."
---

# UX: configure with empty --api-key still defaults dead sonnet-5

## Summary

configure claude --api-key "" --yes --dry-run without --model still shows default model anthropic/claude-sonnet-5 — empty api-key ignored; dead default cluster reconfirmed.

## Evidence

◇  Claude Code default model → anthropic/claude-sonnet-5

## Why it matters

Reconfirm Critical dead default; empty --api-key should ValidationError.

## Suggested direction

Reject empty --api-key; fix default model sonnet-4.6.

## Severity

**High**

## Area

Configure / models
