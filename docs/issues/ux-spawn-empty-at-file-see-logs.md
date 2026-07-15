---
severity: medium
impact: usability
comment: "Instance of the systemic UserError chrome issue; retire into ux-user-errors-look-like-system-failures.md. Its one fair point: the message could be more specific - the file was found and was empty, which differs from no prompt at all, and saying so would help."
---

# UX: spawn empty @file prompt has See logs

## Summary

spawn claude @/tmp/empty.txt: No prompt provided via argument or stdin + See logs — clear message, system chrome.

## Evidence

■  Error: No prompt provided via argument or stdin
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

UserError; mention empty file.

## Severity

Medium

## Area

Spawn
