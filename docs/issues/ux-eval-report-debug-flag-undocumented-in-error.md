---
severity: low-medium
impact: usability
comment: "Duplicate within the eval empty-source cluster; retire into ux-eval-empty-source-message-inconsistent-skins.md. Its distinct angle is thin but fair - the error advertises --debug, a flag users have no other exposure to - which argues for dropping the tease rather than documenting it."
---

# UX: eval report error mentions --debug but may be undocumented

## Summary

eval report with no eval folders says Use --debug for a stack trace while primary help may not surface --debug clearly for users.

## Evidence

```bash
$ poe-code eval report
■  … does not contain any first-level <id>/eval.yaml files. Use --debug for a stack trace.
```

## Why it matters

Error points to a flag users may not know; recovery should suggest eval init.

## Suggested direction

Suggest eval init; document --debug; design-system consistency.

## Severity

Low–Medium

## Area

Eval
