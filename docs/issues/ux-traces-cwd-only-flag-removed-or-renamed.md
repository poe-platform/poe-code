# UX: traces workspace filter is --all-workspaces; --cwd-only no longer exists

## Summary

traces defaults to cwd-only listing; expansion is via --all-workspaces. The flag --cwd-only is unknown. Earlier audit notes and possibly stale help/docs referenced --cwd-only, creating drift.

## Evidence

```bash
$ poe-code traces --help
  --all-workspaces       Read traces from every workspace, not just cwd
  # no --cwd-only

$ poe-code traces --cwd-only
error: unknown option '--cwd-only'
```

## Why it matters

Muscle memory / old docs fail. Default cwd-only is fine if documented; the inverted flag name is the surprise.

## Suggested direction

Document default = cwd; --all-workspaces to expand. If --cwd-only was ever public, keep as no-op alias for compatibility.

## Severity

Low–Medium

## Area

Traces
