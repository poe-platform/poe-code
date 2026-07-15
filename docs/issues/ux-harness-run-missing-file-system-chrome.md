---
severity: medium
impact: usability
comment: "Keep as canonical of this pair. Standard instance of the systemic UserError chrome issue - message right, 'See logs' wrong - so retire into ux-user-errors-look-like-system-failures.md. The harness-specific residue worth keeping is the recovery: suggest harness list or harness new, which is more valuable here than elsewhere because both kinds and paths are hard to discover."
---

# UX: harness run missing md uses system chrome

## Summary

Missing harness md file: path + See logs — good message, unnecessary logs.

## Evidence

```bash
$ poe-code harness run /tmp/no.md
■  Error: Missing harness md file: /tmp/no.md
●  See logs …
```

## Why it matters

ValidationError without logs.

## Suggested direction

UserError; suggest harness new / harness list.

## Severity

Medium

## Area

Harness
