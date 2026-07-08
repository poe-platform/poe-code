# UX: provider list has no --json flag

## Summary

provider list --json is unknown; only design-system table available for scripting.

## Evidence

```bash
$ poe-code provider list --json
error: unknown option '--json'
```

## Why it matters

CI cannot machine-parse provider status.

## Suggested direction

Add --json with status, env, agents fields.

## Severity

Medium

## Area

Providers
