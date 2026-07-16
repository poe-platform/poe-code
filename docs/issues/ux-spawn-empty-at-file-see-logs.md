---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:546-563 resolvePromptInput trims @file contents to empty string, then line 220 throws a plain Error('No prompt provided via argument or stdin') which is not a CliError, so src/cli/bootstrap.ts:71-78 renders 'Error: ...' plus 'See logs at .../errors.log' system chrome"
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
