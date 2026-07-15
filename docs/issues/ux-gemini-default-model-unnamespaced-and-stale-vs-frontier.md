---
severity: high
impact: correctness
comment: "Real and distinct from the sonnet-5 cluster: the id is not dead but the namespace is wrong (gemini-2.5-pro against the catalog's google/gemini-2.5-pro), an id-shape inconsistency in the same constants file rather than a stale value. That makes it a likely latent bug anywhere the id is matched against catalog entries, and it belongs in the same constants pass as ux-constants-source-of-dead-sonnet-5.md. Keep the namespace fix; treat the 2.5-versus-3.1 currency question as a separate pin-policy decision."
---

# UX: gemini default is unnamespaced gemini-2.5-pro while FRONTIER uses google/gemini-3.1-pro

## Summary

DEFAULT_GEMINI_MODEL is gemini-2.5-pro (no google/ prefix). Catalog shows google/gemini-2.5-pro. FRONTIER_MODELS includes google/gemini-3.1-pro. configure gemini --yes --dry-run defaults to gemini-2.5-pro.

## Evidence

```ts
// src/cli/constants.ts
DEFAULT_GEMINI_MODEL = "gemini-2.5-pro"
FRONTIER_MODELS includes "google/gemini-3.1-pro"
```
configure gemini → Gemini model gemini-2.5-pro
models --search gemini-2.5 → google/gemini-2.5-pro

## Why it matters

Inconsistent id shape vs anthropic defaults; may lag frontier default.

## Suggested direction

Use google/gemini-2.5-pro or google/gemini-3.1-pro; CI catalog check.

## Severity

**High**

## Area

Config / models
