---
severity: medium
impact: usability
comment: "Instance of the systemic UserError chrome issue; retire into ux-user-errors-look-like-system-failures.md. Same message as the no-prompt and empty-@file filings - one condition, three files, one chrome fix."
---

# UX: empty --stdin prompt has See logs

## Summary

spawn --stdin with empty stdin: No prompt provided via argument or stdin + See logs — good message, system chrome.

## Evidence

```bash
$ echo -n "" | poe-code spawn claude --mode read --model haiku --stdin
■  Error: No prompt provided via argument or stdin
●  See logs …
```

## Why it matters

ValidationError without logs.

## Suggested direction

UserError; suggest prompt arg or non-empty stdin.

## Severity

Medium

## Area

Spawn
