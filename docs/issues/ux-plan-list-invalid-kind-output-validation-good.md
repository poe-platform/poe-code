---
severity: low
impact: none
comment: "Keep as canonical of this positive pair (covers both --kind and --output). Its suggested direction is the actionable one and worth routing: apply this exact pattern to the models features/modalities filters, which currently return silent empties for the same class of mistake. Two commands, opposite behaviors, one obvious winner."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:113 throws ValidationError 'Invalid --output value ... Expected one of: terminal, md, json.' and src/cli/commands/plan.ts:133 throws 'Invalid --kind value ... Expected plan, pipeline, experiment, ralph, superintendent, superintendent-base.'; asserted at src/cli/commands/plan-root-command.test.ts:250 - positive note, no defect"
---

# UX: plan list invalid --kind/--output validation is good (positive)

## Summary

plan list --kind bogus and --output bogus return clear Expected … lists without See logs.

## Evidence

Invalid --kind value "bogus". Expected plan, pipeline, …
Invalid --output value "bogus". Expected one of: terminal, md, json.

## Why it matters

Positive validation pattern.

## Suggested direction

Keep; apply to models features/modalities.

## Severity

Low

## Area

Plan list / positive pattern
