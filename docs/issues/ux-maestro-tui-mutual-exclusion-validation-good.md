---
severity: low
impact: none
comment: "Positive pattern, and the honest counterpart to the duplicate-flag complaints: the mutual-exclusion message is clear and well-framed, so the runtime behavior is sound - the flaw is that two flags exist for one concept at all, as its own suggestion concedes ('reduce to one flag long-term'). Keep as evidence that the validation need not change when the flags are consolidated."
reproduced: n
recommendation: no-fix
evidence: "src/cli/program.ts:646-648 throws ValidationError 'Specify only one of --config or --workflow for Maestro TUI.' exactly as documented; positive note, no defect to reproduce."
---

# UX: maestro tui mutual exclusion of config/workflow is good (positive)

## Summary

Specifying both --config and --workflow fails with clear mutual exclusion message.

## Evidence

```bash
$ poe-code maestro tui --config a --workflow b
■  Specify only one of --config or --workflow for Maestro TUI.
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep; reduce to one flag long-term.

## Severity

Low

## Area

Maestro / positive pattern
