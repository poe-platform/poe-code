# UX: --cwd missing path error is good (positive)

## Summary

spawn --cwd /no/such/dir returns Workspace path does not exist clearly (still See logs).

## Evidence

```bash
$ poe-code spawn pi "ok" --mode read --cwd /no/such/dir
■  Error: Workspace path "/no/such/dir" does not exist.
```

## Why it matters

Positive not-found message.

## Suggested direction

Keep; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern
