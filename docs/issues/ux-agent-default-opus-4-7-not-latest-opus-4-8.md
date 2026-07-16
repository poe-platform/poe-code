---
severity: low-medium
impact: polish
reproduced: n
recommendation: no-fix
evidence: "src/cli/constants.ts:9 confirms DEFAULT_FRONTIER_MODEL = anthropic/claude-opus-4.7 (also lines 2, 15), so the pin is real and resolves; the 'catalog has opus-4.8' half is unverifiable statically because the catalog is fetched live from the Poe API (src/cli/commands/models.ts:224, needs credentials) and no source or fixture mentions opus-4.8 (rg over src/ and packages/). Working default plus unconfirmed newer model = currency/pin-policy question, not a defect."
comment: "Not a defect: 4.7 resolves and works, so this is a currency/pin-policy question rather than a bug, and it should not be swept into the Critical sonnet-5 cluster where the default is genuinely dead. Absorbs the contentless ux-agent-default-model-hardcoded.md. Resolve by picking one policy and writing it down: either track the latest frontier automatically or state that DEFAULT_FRONTIER_MODEL is pinned deliberately for stability."
---

# UX: agent default is opus-4.7 while catalog has newer opus-4.8

## Summary

agent --model default is anthropic/claude-opus-4.7; catalog has anthropic/claude-opus-4.8 (Date Added 2026-05-28). Not broken (4.7 exists) but defaults lag latest frontier.

## Evidence

DEFAULT_FRONTIER_MODEL = opus-4.7; catalog has opus-4.8.

## Why it matters

Defaults may lag; optional upgrade path.

## Suggested direction

Consider DEFAULT_FRONTIER_MODEL = opus-4.8 or document pin policy.

## Severity

Low–Medium

## Area

Config / models
