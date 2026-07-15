---
severity: low-medium
impact: polish
comment: "Instance of ux-problems-footer-on-every-success.md; retire into it. Its example is the most pointed in that family and worth quoting: a validation that succeeds ends by asking whether you have problems, which is where the footer's noise becomes self-parody."
---

# UX: pipeline validate success still ends with Problems? footer

## Summary

Valid pipeline validation ends with Problems? GitHub link after Plan is valid success.

## Evidence

```bash
$ poe-code pipeline validate …/tiny-http…md
◆  Plan is valid.
└  Problems? https://github.com/…/issues
```

## Why it matters

Reaffirms Problems-on-success for a pure validation success path.

## Suggested direction

Skip Problems footer on successful validate.

## Severity

Low–Medium

## Area

Pipeline
