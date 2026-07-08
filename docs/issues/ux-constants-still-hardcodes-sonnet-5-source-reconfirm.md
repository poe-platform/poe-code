# UX: src/cli/constants.ts still hard-codes anthropic/claude-sonnet-5 (source reconfirm)

## Summary

src/cli/constants.ts still has FRONTIER_MODELS anthropic/claude-sonnet-5, CLAUDE_CODE_VARIANTS.sonnet → sonnet-5, DEFAULT_CLAUDE_CODE_MODEL from that, GOOSE_MODELS = FRONTIER_MODELS. Catalog search sonnet-5 = 0. Source of Critical dead default cluster still present mid-2026-07-08.

## Evidence

```ts
// src/cli/constants.ts
FRONTIER_MODELS includes "anthropic/claude-sonnet-5"
CLAUDE_CODE_VARIANTS.sonnet = "anthropic/claude-sonnet-5"
DEFAULT_CLAUDE_CODE_MODEL = CLAUDE_CODE_VARIANTS.sonnet
GOOSE_MODELS = FRONTIER_MODELS
DEFAULT_GEMINI_MODEL = "gemini-2.5-pro" // unnamespaced
DEFAULT_KIMI_MODEL = KIMI_MODELS[0] // novitaai/kimi-k2.5
```
Live: models --search sonnet-5 → 0/341

## Why it matters

One-line product fix still unapplied; all configure defaults feed from this.

## Suggested direction

Replace sonnet-5 → anthropic/claude-sonnet-4.6; fix gemini/kimi namespaces; CI FRONTIER_MODELS resolve.

## Severity

**High**

## Area

Config / models
