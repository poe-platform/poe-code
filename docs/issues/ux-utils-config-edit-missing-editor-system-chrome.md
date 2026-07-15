---
severity: medium
impact: usability
comment: "Keep as canonical of the missing-EDITOR cluster (four filings); cleanest repro (env -u EDITOR) and the crucial comparison: utils config edit fails fast while plan edit hangs (ux-plan-edit-hangs-without-editor.md), so the good behavior exists and only needs propagating. The chrome half retires into ux-user-errors-look-like-system-failures.md; ux-editor-missing-raw-error.md names the bare throw behind it."
---

# UX: utils config edit missing $EDITOR uses system chrome

## Summary

utils config edit without EDITOR says Set $EDITOR to use this command + See logs — good message, unnecessary logs (plan edit may hang instead).

## Evidence

```bash
$ env -u EDITOR poe-code utils config edit --global
■  Error: Set $EDITOR to use this command
●  See logs …
```

## Why it matters

Align editor errors; no logs for ValidationError.

## Suggested direction

ValidationError without logs; same for plan edit.

## Severity

Medium

## Area

Utils / editor
