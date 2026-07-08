# UX: auth status has no --json (whoami is the machine path)

## Summary

auth status --json unknown; whoami is JSON. Split is OK if documented; status --help does not mention whoami for scripts.

## Evidence

```bash
$ poe-code auth status --json
error: unknown option '--json'
```

## Why it matters

Discoverability of machine auth identity.

## Suggested direction

Cross-link whoami from status help; or add status --json.

## Severity

Low–Medium

## Area

Auth
