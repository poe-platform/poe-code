---
severity: critical
impact: correctness
comment: "Keep as canonical of this pair and a genuinely distinct member of the sonnet-5 cluster: even when the user explicitly selects a live model, poe-code still writes the dead sonnet-5 into goose's models list, so the bad id is injected into the agent's own catalog by our write rather than merely defaulted. That is a separate consumer from the default-model path and will not be closed by changing DEFAULT_CLAUDE_CODE_MODEL alone - it needs the GOOSE_MODELS/goose.ts map fixed too, exactly as ux-constants-source-of-dead-sonnet-5.md traces. Correctly Critical."
---

# UX: configure goose with haiku still embeds claude-sonnet-5 in models list

## Summary

configure goose --model anthropic/claude-haiku-4.5 --yes --dry-run sets GOOSE_MODEL to haiku but still includes anthropic/claude-sonnet-5 in models list array — dead model remains in agent catalog config.

## Evidence

```bash
$ poe-code configure goose --model anthropic/claude-haiku-4.5 --yes --dry-run
◇  Goose default model → anthropic/claude-haiku-4.5
+GOOSE_MODEL: anthropic/claude-haiku-4.5
+"name": "anthropic/claude-sonnet-5"  # still in models list
```

## Why it matters

Default model fixed but dead model remains selectable in goose catalog from our write.

## Suggested direction

Refresh models list from live catalog; never write sonnet-5.

## Severity

**Critical**

## Area

Config / models
