---
severity: low-medium
impact: discoverability
comment: "Correctly diagnosed as discoverability rather than a missing feature: whoami already is the machine-readable path, so the gap is that status help never points at it. The cross-link is the cheap fix; adding status --json duplicates whoami and invites drift. Same 'no --json' family as ux-provider-list-no-json-flag.md and ux-usage-list-no-json-flag.md - answer the general question once (which commands are scriptable, and whether --json or a sibling command is the pattern)."
---

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
