---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/commands/runtime-options.ts:19 accepts --runner-sync with no dependency check; packages/agent-harness-tools/src/poe-command-execution.ts:110 merges it into runner.sync unconditionally; packages/process-runner/src/host/host-execution-env.ts:11-23 upload/downloadWorkspace are no-ops and :6 supportsDetach false, so the flag has no effect inline and nothing warns"
comment: "One of two filings of the same silent no-op; consolidate with ux-runner-sync-without-runtime-silently-accepted.md. Real and part of the flag-dependency family with ux-detach-runtime-host-still-inline.md and ux-capture-otel-content-without-capture-silent.md: spawn accepts several flags whose preconditions are unmet and does nothing about it. One rule closes the family - reject a flag whose dependency is unsatisfied. Its error wording is the best-specified in the family."
---

# UX: --runner-sync without --detach is silently ignored

## Summary

spawn … --runner-sync both without --detach/--runtime succeeds inline — flag has no effect, no warning.

## Evidence

spawn --runner-sync both → inline success like normal spawn.

## Why it matters

Detached-runtime flags should require runtime context.

## Suggested direction

Error: --runner-sync requires --detach and --runtime docker|e2b.

## Severity

**High**

## Area

Spawn / runtime
