---
severity: critical
impact: correctness
comment: "Excellent diagnostic work and the most immediately actionable file in the sonnet-5 cluster: it checks every FRONTIER_MODELS entry against the catalog and proves only sonnet-5 is dead (0/341) while the rest resolve, narrowing the Critical fix to one string plus the goose context map. Keep alongside ux-constants-source-of-dead-sonnet-5.md - that names the location, this bounds the change. Together they reduce the fix to a few lines plus the CI check that prevents recurrence."
---

# UX: FRONTIER_MODELS only sonnet-5 is dead; others resolve in catalog

## Summary

Catalog check: claude-opus-4.7, gpt-5.3-codex, gpt-5.4-pro, gemini-3.1-pro each 1/341; claude-sonnet-5 is 0/341. Only the sonnet entry in FRONTIER_MODELS is dead — minimal fix is sonnet-5 → sonnet-4.6.

## Evidence

```bash
models --search sonnet-5 → 0
models --search sonnet-4.6 → 1
models --search gpt-5.3-codex → 1
models --search claude-opus-4.7 → 1
```

## Why it matters

Narrows Critical fix to one string in constants + goose map.

## Suggested direction

Replace anthropic/claude-sonnet-5 with anthropic/claude-sonnet-4.6.

## Severity

**Critical**

## Area

Config / models
