---
severity: low
impact: none
comment: "Positive pattern; near-duplicate of ux-plan-list-invalid-kind-output-validation-good.md, which covers --kind and --output together - consolidate. This is the good validation shape (reject, name the bad value, list the valid set) and it is the reference the models silent-filter cluster needs: cite it from ux-models-feature-bogus-silent-empty.md, since plan list and models handle invalid enums oppositely."
---

# UX: plan list --kind invalid validation is good (positive)

## Summary

Invalid --kind bogus lists Expected plan, pipeline, experiment, ralph, superintendent, superintendent-base.

## Evidence

```bash
$ poe-code plan list --kind bogus
■  Invalid --kind value "bogus". Expected plan, pipeline, …
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep.

## Severity

Low

## Area

Plan / positive pattern
