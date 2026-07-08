# UX: --cwd file path error is good (positive)

## Summary

spawn --cwd package.json returns Workspace path … is not a directory clearly.

## Evidence

```bash
$ poe-code spawn pi "ok" --mode read --cwd …/package.json
■  Error: Workspace path "…/package.json" is not a directory.
```

## Why it matters

Positive path validation (still See logs).

## Suggested direction

Keep; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern
