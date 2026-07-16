---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/utils/command-checks.ts:163 hardcodes binaryName: 'poe-code' for the hooks path (createSpawnHealthCheck), re-exec'ing from PATH; no detectExecutionContext/execution-context usage in command-checks.ts or src/cli/commands/test.ts, so a tsx/npm-run-dev host yields 'spawn poe-code ENOENT'."
comment: "Distinct from the rest of the hooks cluster and the most serious of it: --hooks-from re-execs 'poe-code' from PATH, which fails with a bare ENOENT when the CLI runs from a tsx entry - so the feature breaks precisely in the dev/test context and the error blames a missing binary rather than the miswiring. Its fix is right and worth doing regardless of the hooks matrix work: resolve the host binary from argv rather than assuming PATH. Same host-identity root as ux-development-mode-usage-intentional-but-leaks.md - the CLI does not reliably know how it was invoked."
---

# UX: --hooks-from can fail with spawn poe-code ENOENT

## Summary

test/spawn with --hooks-from may exec poe-code not on PATH (tsx entry), opaque ENOENT.

## Evidence

test codex --hooks-from claude-code → spawn poe-code ENOENT.

## Why it matters

Looks like missing binary not miswired hooks.

## Suggested direction

Resolve host binary from argv; clear error.

## Severity

**High**

## Area

Hooks / spawn
