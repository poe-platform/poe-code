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
