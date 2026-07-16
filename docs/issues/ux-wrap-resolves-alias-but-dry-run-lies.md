---
severity: medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/ui/ui.test.ts:137-144 asserts no wrap command is registered; `npm run dev -- --help` lists no wrap/w command"
comment: "Duplicate of ux-wrap-dry-run-forwards-flag.md and equally obsolete - wrap no longer exists. Close both. The dry-run principle they identify is sound and belongs in any future wrap design: a preview must show the real argv, not an argv with the preview flag injected into it."
---

# UX: wrap alias dry-run lies

## Summary

kimi-cli --dry-run invented.

## Evidence

wrap kimi --dry-run.

## Why it matters

Partial truth.

## Suggested direction

Real argv.

## Severity

Medium

## Area

Dry-run
