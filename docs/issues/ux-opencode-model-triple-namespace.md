---
severity: medium
impact: correctness
comment: "Keep of this pair. Real and part of the id-namespace family: opencode gets a third id shape (poe/owner/model) alongside the catalog's owner/model and claude's bare form - four id languages counting kimi's. Individually each rewrite is probably correct for its agent; collectively there is no documented mapping and no resolved-id echo, which is the actual defect. Consolidate the namespace filings (kimi, gemini, opencode, claude) into one id-normalisation issue."
---

# UX: OpenCode configure writes poe/anthropic/claude-opus-4.7 triple namespace

## Summary

configure opencode dry-run plans model poe/anthropic/claude-opus-4.7 — a third namespace style (poe/owner/model) unlike catalog anthropic/… or agent bare ids.

## Evidence

```bash
$ poe-code configure opencode --yes --dry-run
+"model": "poe/anthropic/claude-opus-4.7",
```

## Why it matters

Triple namespaces multiply lookup confusion with models --model and cross-agent configs.

## Suggested direction

Document OpenCode-specific model form; show resolved id; align where possible.

## Severity

Medium

## Area

Configure / models
