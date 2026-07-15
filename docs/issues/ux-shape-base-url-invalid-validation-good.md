---
severity: low
impact: none
comment: "Duplicate of ux-shape-base-url-invalid-format-validation-good.md; retire into it. One of the two should survive as part of the consolidated 'configure validates its own flags well' note, alongside the unknown-shape and unknown-provider positives."
---

# UX: --shape-base-url invalid format validates cleanly (positive)

## Summary

Invalid --shape-base-url value returns Use <shape-id>=<url> clearly.

## Evidence

```bash
$ poe-code configure claude --shape-base-url "not-an-equals" --yes --dry-run
■  Error: Invalid --shape-base-url value "not-an-equals". Use <shape-id>=<url>.
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep.

## Severity

Low

## Area

Configure / positive pattern
