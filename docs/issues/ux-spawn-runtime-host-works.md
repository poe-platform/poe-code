---
severity: low
impact: none
comment: "Positive pattern; consolidate with the spawn-works positives. Its 'document default is host' suggestion is the actionable half and is a real gap - nothing states which runtime is the default, which matters because the detach flags behave differently per runtime (ux-detach-runtime-host-still-inline.md)."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect: src/cli/commands/runtime-options.ts:15 accepts --runtime host and src/cli/commands/spawn.ts:177 forwards it to spawn"
---

# UX: spawn --runtime host works (positive)

## Summary

spawn … --runtime host succeeds for claude with valid model — host runtime path works.

## Evidence

spawn claude … --runtime host → ✓ agent: ok

## Why it matters

Positive runtime host path.

## Suggested direction

Keep; document default is host.

## Severity

Low

## Area

Spawn / positive pattern
