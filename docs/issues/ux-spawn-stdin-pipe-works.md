---
severity: low
impact: none
comment: "Positive pattern; consolidate with ux-spawn-at-file-works.md into one note about spawn's prompt input forms. Its 'document in Examples' suggestion is the actionable half and matters more than the positive: argument, @file and stdin are three undocumented input forms, exactly what the missing-examples work should cover."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:191-217 - --stdin flag sets shouldReadFromStdin and the prompt is read from process.stdin; covered by spawn-command.test.ts:2428 'consumes prompt text from stdin'. Positive note, no defect."
---

# UX: spawn --stdin from pipe works (positive)

## Summary

echo "say only: ok" | spawn claude --mode read --model haiku --stdin succeeds.

## Evidence

pipe + --stdin → ✓ agent: ok

## Why it matters

Positive stdin prompt form.

## Suggested direction

Keep; document in Examples.

## Severity

Low

## Area

Spawn / positive pattern
