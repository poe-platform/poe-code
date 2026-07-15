---
severity: high
impact: usability
comment: "Keep as canonical of the --since stack pair. Same defect as the endpoint stack cluster on a different flag: the message is excellent and names a valid duration, then an ERROR log and a full ValidationError stack undo it. Two flags in one command both leaking stacks points at the models error path rather than either flag - consolidate all four into one issue about ValidationError not printing stacks."
---

# UX: models --since invalid duration prints stack

## Summary

models --since bogus and --since 0d: good Invalid --since duration message but also ERROR log + full ValidationError stack.

## Evidence

Invalid --since duration "bogus". Use a positive duration such as 7d…
Stack trace: ValidationError at parseSinceDuration…

## Why it matters

Validation should not dump stacks (same class as invalid endpoint).

## Suggested direction

UserError without stack.

## Severity

**High**

## Area

Models
