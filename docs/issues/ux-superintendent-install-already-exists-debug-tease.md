# UX: superintendent install already exists uses --debug stack tease

## Summary

superintendent install when skill exists: Skill already exists … Use --debug for a stack trace — toolcraft style, wrong for exists case.

## Evidence

```bash
$ poe-code superintendent install claude-code --scope local
■  Skill already exists: … Use --debug for a stack trace.
```

## Why it matters

Exists should be skip/info or --force, not debug stack tease.

## Suggested direction

Idempotent skip; --force overwrite; no --debug tease.

## Severity

**High**

## Area

Superintendent / install
