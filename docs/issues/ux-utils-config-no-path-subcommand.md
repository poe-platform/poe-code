---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/config.ts:54-75 registers only show/init/edit; `npm run dev -- utils config path` prints: error: too many arguments for 'config'. Expected 0 arguments but got 1."
comment: "Duplicate of ux-utils-config-path-subcommand-missing.md; consolidate. Its own hedge is worth noting - show already prints the paths in its header - so the gap is only that scripts must scrape them, a smaller problem than a missing capability. Same machine-output question as the --json family."
---

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
