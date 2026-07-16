---
severity: medium
impact: usability
comment: "Duplicate within the --cwd chrome trio; retire into ux-user-errors-look-like-system-failures.md. Its recovery suggestion (create the directory or pick an existing path) is a reasonable garnish but the message already tells users what is wrong."
reproduced: y
recommendation: no-fix
evidence: "packages/workspace-resolver/src/resolve.ts:82 throws a plain Error; src/cli/commands/spawn.ts:225 does not wrap it, so src/cli/bootstrap.ts:71-79 treats it as non-user error and appends the 'See logs' line"
---

# UX: missing --cwd path has See logs on ValidationError

## Summary

spawn --cwd /tmp/does-not-exist: Workspace path does not exist + See logs — clear message, system chrome.

## Evidence

```bash
$ poe-code spawn … --cwd /tmp/does-not-exist-cwd
■  Error: Workspace path "…" does not exist.
●  See logs …
```

## Why it matters

User validation without logs.

## Suggested direction

UserError; suggest create dir or pick existing path.

## Severity

Medium

## Area

Spawn
