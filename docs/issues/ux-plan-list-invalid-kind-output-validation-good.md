---
severity: low
impact: none
comment: "Keep as canonical of this positive pair (covers both --kind and --output). Its suggested direction is the actionable one and worth routing: apply this exact pattern to the models features/modalities filters, which currently return silent empties for the same class of mistake. Two commands, opposite behaviors, one obvious winner."
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
