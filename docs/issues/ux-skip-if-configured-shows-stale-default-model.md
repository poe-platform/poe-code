---
severity: high
impact: correctness
comment: "Duplicate in substance of ux-skip-if-configured-dry-run-shows-dead-sonnet-5-default.md; retire into it. Its one-line framing is the sharpest in the cluster and should survive: the command 'celebrates configured while advertising broken model' - success framing over a dead value is worse than a plain error."
---

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
