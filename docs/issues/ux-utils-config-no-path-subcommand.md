# UX: utils config has no path subcommand (show/init/edit only)

## Summary

utils config path fails too many arguments; only show/init/edit — users cannot print config file paths alone.

## Evidence

```bash
$ poe-code utils config path
error: too many arguments for 'config'. Expected 0 arguments but got 1.
```
Commands: show, init, edit.

## Why it matters

Path discovery requires reading show header lines.

## Suggested direction

Add config path or print paths at top of show only (already) and document.

## Severity

Low–Medium

## Area

Utils
