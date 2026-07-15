---
severity: medium
impact: usability
comment: "Instance of the systemic UserError chrome issue; retire into ux-user-errors-look-like-system-failures.md. Its suggested recovery is the most useful of the spawn-prompt filings and worth carrying: name the three input forms (argument, @file, stdin), which are otherwise undiscoverable."
---

# UX: spawn no prompt uses system chrome + See logs

## Summary

No prompt provided via argument or stdin is correct message but still See logs system chrome.

## Evidence

```bash
$ poe-code spawn claude --mode read --model haiku
■  Error: No prompt provided via argument or stdin
●  See logs …
```

## Why it matters

User error should not point at errors.log.

## Suggested direction

ValidationError; suggest prompt, @file, or -.

## Severity

Medium

## Area

Spawn
