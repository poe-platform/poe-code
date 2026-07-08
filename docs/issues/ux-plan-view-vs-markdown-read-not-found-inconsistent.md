# UX: plan view vs markdown-read not-found messages inconsistent

## Summary

plan view missing.md → Plan not found: missing.md (clean, no logs). plan markdown-read missing.md → file not found: missing.md + See logs. Same concept, different quality.

## Evidence

```bash
$ poe-code plan view missing.md
■  Plan not found: missing.md
$ poe-code plan markdown-read missing.md
■  Error: file not found: missing.md
●  See logs …
```

## Why it matters

Inconsistent not-found quality within plan group.

## Suggested direction

Unify Plan not found ValidationError; no logs.

## Severity

Medium

## Area

Plan
