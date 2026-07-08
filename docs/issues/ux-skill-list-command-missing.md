# UX: skill list is unknown command

## Summary

skill list → Unknown command: list + npm run dev recovery. skill only has install/configure/unconfigure; no list/ls of installed skills.

## Evidence

```bash
$ poe-code skill list
■  Unknown command: list
└  Run npm run dev -- skill --help
```

## Why it matters

Users cannot discover installed skills; help recovery uses npm run dev.

## Suggested direction

skill ls/list; displayBinaryName recovery.

## Severity

**High**

## Area

Skills
