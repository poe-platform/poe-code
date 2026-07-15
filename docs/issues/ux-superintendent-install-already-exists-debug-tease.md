---
severity: high
impact: usability
comment: "Two known families intersecting: already-exists treated as an error (the installer-idempotency umbrella) plus a --debug stack tease on a non-crash. Retire into those. Worth noting this is the fifth installer with its own answer to 'what happens when the skill exists' - error with debug tease here, hard error in experiment, silent skip plus false success in pipeline - the strongest evidence yet for one installer contract."
---

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
