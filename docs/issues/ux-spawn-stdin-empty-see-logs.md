---
severity: medium
impact: usability
comment: "Instance of the systemic UserError chrome issue; retire into ux-user-errors-look-like-system-failures.md. Same message as the no-prompt and empty-@file filings - one condition, three files, one chrome fix."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:192-193 sets shouldReadFromStdin for --stdin, line 211-217 trims empty stdin to '', then line 220 throws a plain Error('No prompt provided via argument or stdin') which is not a CliError, so src/cli/bootstrap.ts:70-79 prints 'Error: ...' plus 'See logs at .../errors.log' system chrome"
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
