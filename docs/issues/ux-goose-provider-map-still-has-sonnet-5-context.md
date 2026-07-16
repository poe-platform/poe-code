---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/providers/goose.ts:102 GOOSE_MODEL_CONTEXT_LIMIT_FALLBACKS has 'anthropic/claude-sonnet-5': 983_040; key reachable because src/cli/constants.ts:3 FRONTIER_MODELS still lists that id"
comment: "Source-level confirmation of the second sonnet-5 consumer that ux-constants-source-of-dead-sonnet-5.md traces: goose.ts hard-codes a context window for a model that no longer exists. Small and precise. Fold into the constants fix as one change rather than tracking separately - a dead key in a lookup map is only reachable while the dead id is still written (ux-goose-configure-still-embeds-sonnet-5-in-models-list.md), so both fall to the same edit."
---

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
