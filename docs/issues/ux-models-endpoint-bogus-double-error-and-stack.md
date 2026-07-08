# UX: models --endpoint bogus prints stack and double error panel

## Summary

models --endpoint bogus: good Available endpoints message but ERROR log + ValidationError stack + Error during models panel then second Unsupported endpoint panel.

## Evidence

```bash
$ poe-code models --endpoint bogus
■  Error during models: Unsupported endpoint "/bogus". Available endpoints: …
Stack trace: ValidationError at models.ts:400
■  Unsupported endpoint "/bogus". Available endpoints: …
```

## Why it matters

Validation should not dump stacks or double-render.

## Suggested direction

Single UserError/ValidationError without stack.

## Severity

**High**

## Area

Models
