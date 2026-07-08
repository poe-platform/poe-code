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
