---
severity: medium
impact: usability
comment: "Instance of the systemic UserError chrome issue; retire into ux-user-errors-look-like-system-failures.md. Its suggested recovery is the most useful of the spawn-prompt filings and worth carrying: name the three input forms (argument, @file, stdin), which are otherwise undiscoverable."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:220 throws a plain Error('No prompt provided via argument or stdin'), not a CliError, so src/cli/bootstrap.ts:70-79 prints 'Error: ...' plus 'See logs at ~/.poe-code/logs/errors.log'; contrast src/cli/poe-agent-main.ts:110 which throws ValidationError for the same condition"
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
