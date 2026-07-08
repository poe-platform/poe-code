# UX: configure --skip-if-configured shows stale model as default

## Summary

Already-configured path prints anthropic/claude-sonnet-5 as default model though API rejects it.

## Evidence

Claude Code default model anthropic/claude-sonnet-5 + already configured.

## Why it matters

Celebrates configured while advertising broken model.

## Suggested direction

Label configured model; warn if missing from catalog.

## Severity

**High**

## Area

Configure / models
