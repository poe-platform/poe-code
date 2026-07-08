# UX: launch start triggers full monorepo turbo build then fails

## Summary

launch start foo -- echo hi runs turbo build across 68 packages (~24s) then Managed process failed to start + See logs. launch start without -- same monorepo noise.

## Evidence

```bash
$ poe-code launch start foo -- echo hi
• turbo … Running build in 68 packages
Tasks: 67 successful …
■  Error: Managed process "foo" failed to start.
●  See logs …
```

## Why it matters

Launching a simple process should not rebuild the monorepo; opaque failure after long wait.

## Suggested direction

Do not invoke turbo on launch start; clear UserError with log path; fail-fast on bad command.

## Severity

**High**

## Area

Launch
