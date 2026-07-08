# UX: src/cli/constants.ts is the source of dead sonnet-5 defaults

## Summary

Root cause pin: FRONTIER_MODELS includes anthropic/claude-sonnet-5; CLAUDE_CODE_VARIANTS.sonnet and DEFAULT_CLAUDE_CODE_MODEL point at it; GOOSE_MODELS = FRONTIER_MODELS; goose.ts maps sonnet-5 context. Catalog has sonnet-4.6 not sonnet-5.

## Evidence

src/cli/constants.ts:
FRONTIER_MODELS includes anthropic/claude-sonnet-5
CLAUDE_CODE_VARIANTS.sonnet = anthropic/claude-sonnet-5
DEFAULT_CLAUDE_CODE_MODEL = sonnet variant
GOOSE_MODELS = FRONTIER_MODELS
src/providers/goose.ts: "anthropic/claude-sonnet-5": 983_040

## Why it matters

Single constants change unblocks many Critical configure/runtime failures.

## Suggested direction

Replace sonnet-5 with sonnet-4.6; add CI that FRONTIER_MODELS resolve in models API.

## Severity

**Critical**

## Area

Config / models
