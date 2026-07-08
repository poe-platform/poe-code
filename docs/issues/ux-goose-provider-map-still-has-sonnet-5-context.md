# UX: goose provider map still has anthropic/claude-sonnet-5 context entry (source reconfirm)

## Summary

src/providers/goose.ts still maps "anthropic/claude-sonnet-5": 983_040 — dead model context window entry (related goose configure embeds sonnet-5).

## Evidence

src/providers/goose.ts: "anthropic/claude-sonnet-5": 983_040

## Why it matters

Reconfirm goose source still ships dead sonnet-5 context map.

## Suggested direction

Replace with sonnet-4.6 context; remove dead keys.

## Severity

**High**

## Area

Config / models
