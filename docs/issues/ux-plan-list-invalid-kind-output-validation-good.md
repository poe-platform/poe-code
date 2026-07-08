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
