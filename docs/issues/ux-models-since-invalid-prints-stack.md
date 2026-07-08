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
