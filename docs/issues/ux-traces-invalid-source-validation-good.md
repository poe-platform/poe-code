---
severity: low
impact: none
comment: "Positive pattern: 'Unsupported trace source \"bogus\". Expected one of: claude, codex, poe-code' is the right shape - reject, name the value, list the valid set. Notable within traces itself, whose path errors are raw fs throws: the same command validates its enum properly and its paths not at all, a useful internal contrast for the bare-throw work. Consolidate with the other traces source positives."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/traces.ts:31-35 throws ValidationError listing TRACE_SOURCES (claude, codex, pi, poe-code); positive note, no defect. Doc omits 'pi' from the quoted list."
---

# UX: traces invalid --source validation is good (positive)

## Summary

traces --source bogus: Unsupported trace source "bogus". Expected one of: claude, codex, poe-code — clear ValidationError.

## Evidence

Expected one of: claude, codex, poe-code.

## Why it matters

Positive source validation.

## Suggested direction

Keep.

## Severity

Low

## Area

Traces / positive pattern
