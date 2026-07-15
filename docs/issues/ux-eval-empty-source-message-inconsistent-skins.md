---
severity: medium
impact: usability
comment: "Keep as canonical of the eval empty-source cluster: it is the only filing that shows the same condition rendered two different ways in the same product - bare text from check/lint, design-system error plus a --debug tease from report. That side-by-side is the argument; the other three each see one half. Fix once: one ValidationError, no --debug tease, suggest eval init."
---

# UX: eval empty source messages use mixed skins

## Summary

eval check/lint print bare Eval source does not contain… lines; eval report uses design-system ■ Error for same message.

## Evidence

```bash
$ poe-code eval check
Eval source "…" does not contain any first-level <id>/eval.yaml files.
$ poe-code eval report
■  Eval source "…" does not contain any first-level <id>/eval.yaml files. Use --debug for a stack trace.
```

## Why it matters

Same condition, different presentation and --debug hint inconsistency.

## Suggested direction

Unify ValidationError framing; no --debug stack tease for empty source.

## Severity

Medium

## Area

Eval
